import re
import time
from datetime import datetime

import decky

from utils import frontend_error, to_int


class NewSetsService:
    """Fetches and caches the completed-claims feed split into two buckets.

    The upstream endpoint (API_GetClaims with k=1) returns up to 1000
    completed claims. The ordering is unreliable -- it's mostly recent-
    first but not strictly DoneTime-desc, so we sort each bucket
    ourselves after the split. We bucket by SetType (0 = new set,
    1 = revision) at fetch time and cache both in one file -- one API
    call, one TTL, two buckets ready to serve depending on which
    toggle the frontend has selected.

    The frontend asks for one bucket at a time via the ``filter``
    parameter. Both buckets are cached in one file, so toggling the
    filter is a free hit against an already-populated cache. We hand
    back the top 50 of the bucket; the frontend dynamic-mounts that
    list in batches as the user scrolls. Per-row game icons and
    author avatars lazy-load on the frontend side via the existing
    cached IPCs -- the response itself is text-only, so the page
    paints immediately and images fill in over the next second or
    two.
    """

    _CACHE_TTL_SECONDS = 60 * 60
    _CACHED_PER_BUCKET = 150
    _RETURNED_PER_REQUEST = 50

    _SUBSET_SUFFIX_RE = re.compile(r"\s*\[Subset\s*-\s*(.+?)\]\s*$")

    def __init__(self, *, ra, cache_store, icon_service):
        self._ra = ra
        self._cache_store = cache_store
        self._icon_service = icon_service

    def _split_subset_title(self, raw_title):
        text = (raw_title or "").strip()
        if not text:
            return None, None
        match = self._SUBSET_SUFFIX_RE.search(text)
        if not match:
            return text, None
        return text[: match.start()].rstrip(), match.group(1).strip() or None

    def _parse_done_time(self, raw):
        text = (raw or "").strip()
        if not text:
            return 0
        try:
            dt = datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
            return int(dt.timestamp())
        except (ValueError, TypeError):
            return 0

    def _normalize_claim(self, raw):
        if not isinstance(raw, dict):
            return None
        game_title, subset_name = self._split_subset_title(raw.get("GameTitle"))
        done_time_text = raw.get("DoneTime")
        done_time_unix = self._parse_done_time(done_time_text)
        return {
            "id": to_int(raw.get("ID"), 0) or None,
            "user": raw.get("User"),
            "userUlid": raw.get("ULID"),
            "userIsJrDev": bool(to_int(raw.get("UserIsJrDev"), 0)),
            "gameId": to_int(raw.get("GameID"), 0) or None,
            "gameTitle": game_title,
            "subsetName": subset_name,
            "gameIcon": self._icon_service.game_icon_url(raw.get("GameIcon")),
            "consoleId": to_int(raw.get("ConsoleID"), 0) or None,
            "consoleName": raw.get("ConsoleName"),
            "setType": to_int(raw.get("SetType"), 0),
            "doneTime": done_time_text,
            "doneTimeUnix": done_time_unix,
        }

    def _split_into_buckets(self, raw_claims) -> dict:
        new_sets = []
        revisions = []
        for raw in raw_claims or []:
            normalised = self._normalize_claim(raw)
            if normalised is None:
                continue
            if normalised["setType"] == 1:
                revisions.append(normalised)
            else:
                new_sets.append(normalised)
        new_sets.sort(key=lambda c: c["doneTimeUnix"], reverse=True)
        revisions.sort(key=lambda c: c["doneTimeUnix"], reverse=True)
        return {
            "new": new_sets[: self._CACHED_PER_BUCKET],
            "revision": revisions[: self._CACHED_PER_BUCKET],
        }

    def _cache_is_fresh(self, cached_meta) -> bool:
        refreshed_at = cached_meta.get("refreshedAt") if isinstance(cached_meta, dict) else None
        try:
            refreshed_at = int(refreshed_at) if refreshed_at is not None else 0
        except (ValueError, TypeError, OverflowError):
            refreshed_at = 0
        if refreshed_at <= 0:
            return False
        return (int(time.time()) - refreshed_at) < self._CACHE_TTL_SECONDS

    def _slice_for_filter(self, buckets: dict, filter_key: str) -> list:
        bucket_key = "revision" if filter_key == "revision" else "new"
        rows = buckets.get(bucket_key) if isinstance(buckets, dict) else None
        if not isinstance(rows, list):
            return []
        rows = sorted(rows, key=lambda c: c.get("doneTimeUnix", 0), reverse=True)
        sliced = rows[: self._RETURNED_PER_REQUEST]
        normalised = []
        for row in sliced:
            if not isinstance(row, dict):
                continue
            patched = dict(row)
            patched["gameIcon"] = self._icon_service.game_icon_url(row.get("gameIcon"))
            normalised.append(patched)
        return normalised

    def get_new_sets_and_revisions(self, web_api_key: str, filter_key: str = "new") -> dict:
        """Return the top 50 of the requested bucket.

        Returns {"payload": [...], "fromCache": bool, "filter": ...}
        on success, or a dict with an "error" key (and stale payload
        if we have one) on network failure.

        Note on icons + avatars: we do NOT pre-resolve them here. Each
        NewSetCard lazy-loads its own game icon via getGameIconCached
        and its own author avatar via <UserAvatar> after the row
        mounts, same as AotwHeader and every other surface in the
        plugin. Folding CDN image fetches into this one IPC slot
        front-loaded all the cold-cache work into a single multi-
        second response -- the lazy path is much friendlier even if
        the total network traffic is similar, because the page
        actually paints text immediately.
        """
        normalized_filter = "revision" if filter_key == "revision" else "new"

        cached_wrapper = self._cache_store.load_new_sets()
        cached_payload = cached_wrapper.get("payload")
        cached_meta = cached_wrapper.get("meta", {})

        if isinstance(cached_payload, dict) and self._cache_is_fresh(cached_meta):
            return {
                "payload": self._slice_for_filter(cached_payload, normalized_filter),
                "fromCache": True,
                "filter": normalized_filter,
            }

        try:
            raw = self._ra.get_completed_claims(web_api_key)
            buckets = self._split_into_buckets(raw)
            with self._cache_store.new_sets_lock():
                self._cache_store.save_new_sets(
                    buckets,
                    {"refreshedAt": int(time.time())},
                )
            return {
                "payload": self._slice_for_filter(buckets, normalized_filter),
                "fromCache": False,
                "filter": normalized_filter,
            }
        except Exception as e:
            decky.logger.warning("new_sets_service: fetch failed: %s", e)
            stale_rows = self._slice_for_filter(cached_payload, normalized_filter) if isinstance(cached_payload, dict) else []
            return {
                "payload": stale_rows,
                "fromCache": True,
                "filter": normalized_filter,
                "error": frontend_error("Couldn't load new sets.", e),
            }
