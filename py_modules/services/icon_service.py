import base64
import mimetypes
import threading
import time
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed, wait, FIRST_COMPLETED

import decky

from utils import norm_game_id, to_int

GAME_IMAGE_KINDS = ("icon", "ingame", "title", "boxart")


class IconService:
    """Fetches and caches achievement icons, leaderboard icons, and game images.

    All image data is stored as data URIs so the frontend never has to make
    its own network requests for binary assets.
    """

    def __init__(
        self,
        *,
        ra,
        cache_store,
        achievement_icon_max_age_seconds: int,
        achievement_icon_max_workers: int,
        leaderboard_icon_max_age_seconds: int,
        game_icon_max_age_seconds: int,
        game_image_max_age_seconds: int,
        user_avatar_max_age_seconds: int,
        user_avatar_max_workers: int = 4,
        game_icon_max_workers: int = 6,
        resolved_avatar_store=None,
        debug_logging_provider=None,
    ):
        self._ra = ra
        self._cache_store = cache_store
        self._resolved_avatars = resolved_avatar_store
        self._achievement_icon_max_age_seconds = achievement_icon_max_age_seconds
        self._achievement_icon_max_workers = achievement_icon_max_workers
        self._leaderboard_icon_max_age_seconds = leaderboard_icon_max_age_seconds
        self._game_icon_max_age_seconds = game_icon_max_age_seconds
        self._game_image_max_age_seconds = game_image_max_age_seconds
        self._user_avatar_max_age_seconds = user_avatar_max_age_seconds
        self._user_avatar_max_workers = user_avatar_max_workers
        self._game_icon_max_workers = game_icon_max_workers
        self._tab_icon_seq = 0
        self._tab_icon_seq_lock = threading.Lock()
        self._debug_logging_provider = debug_logging_provider

    def _debug_logging_on(self) -> bool:
        if self._debug_logging_provider is None:
            return False
        return bool(self._debug_logging_provider())

    def _describe_exc(self, exc) -> str:
        if isinstance(exc, urllib.error.HTTPError):
            return f"HTTPError({exc.code})"
        return type(exc).__name__

    def _sanitize_worker_count(self, value):
        try:
            workers = int(value)
        except (TypeError, ValueError):
            return None
        if workers < 1:
            workers = 1
        return workers

    def set_achievement_icon_max_workers(self, value: int) -> None:
        workers = self._sanitize_worker_count(value)
        if workers is not None:
            self._achievement_icon_max_workers = workers

    def set_user_avatar_max_workers(self, value: int) -> None:
        workers = self._sanitize_worker_count(value)
        if workers is not None:
            self._user_avatar_max_workers = workers

    def set_game_icon_max_workers(self, value: int) -> None:
        workers = self._sanitize_worker_count(value)
        if workers is not None:
            self._game_icon_max_workers = workers

    def _fetch_image_data_uri(self, url: str):
        """Fetch any image URL and return a data URI, or None on failure.

        One retry on transient failures. The Cloudflare-fronted RA CDN
        occasionally drops individual requests under burst load -- a
        connection reset, an empty body, a slow first byte -- and the
        immediate retry almost always succeeds because the issue is
        per-connection rather than something we did wrong. Without
        this, ~10% of icons on a cold-cache page load end up letter-
        tiled until the 24h disk TTL clears.
        """
        url = str(url or "").strip()
        if not url:
            return None

        def _one_attempt():
            raw_bytes, content_type = self._ra.get_image_bytes(url)
            if not raw_bytes:
                return None
            if not content_type or content_type == "application/octet-stream":
                guessed_content_type, _ = mimetypes.guess_type(url)
                content_type = guessed_content_type or "image/png"
            encoded = base64.b64encode(raw_bytes).decode("ascii")
            return f"data:{content_type};base64,{encoded}"

        first_failure_kind = None
        try:
            result = _one_attempt()
            if result:
                return result
            first_failure_kind = "empty body"
        except Exception as e:
            first_failure_kind = self._describe_exc(e)

        if self._debug_logging_on():
            decky.logger.info(
                "icon_service: image fetch first attempt failed (%s), retrying url=%s",
                first_failure_kind,
                url,
            )

        time.sleep(0.75)

        try:
            result = _one_attempt()
            if result:
                return result
            if self._debug_logging_on():
                decky.logger.info("icon_service: image fetch failed: empty body after retry")
            return None
        except Exception as e:
            if self._debug_logging_on():
                decky.logger.info(
                    "icon_service: image fetch failed: %s after retry",
                    self._describe_exc(e),
                )
            return None

    def achievement_badge_url(self, badge_name: str):
        badge = str(badge_name or "").strip()
        if not badge:
            return None
        return f"https://media.retroachievements.org/Badge/{badge}.png"

    def game_icon_url(self, raw_image_icon):
        value = str(raw_image_icon or "").strip()
        if not value:
            return None
        if value.startswith("https://retroachievements.org/Images/"):
            return "https://media.retroachievements.org" + value[len("https://retroachievements.org"):]
        if value.startswith("http://") or value.startswith("https://"):
            return value
        if value.startswith("/"):
            return f"https://media.retroachievements.org{value}"
        return f"https://media.retroachievements.org/{value}"

    def site_award_badge_url(self, award_type, award_data):
        label = str(award_type or "").strip()
        base = "https://static.retroachievements.org/assets/images/badge"
        if label == "Achievement Unlocks Yield":
            return f"{base}/contribYield-{to_int(award_data, 0)}.png"
        if label == "Achievement Points Yield":
            return f"{base}/contribPoints-{to_int(award_data, 0)}.png"
        if label == "Patreon Supporter":
            return f"{base}/patreon.png"
        if label == "Certified Legend":
            return f"{base}/legend.png"
        return None

    def _fresh_data_uri(self, entry, max_age_seconds):
        if not isinstance(entry, dict):
            return None
        data_uri = str(entry.get("dataUri") or "").strip()
        cached_at = to_int(entry.get("cachedAt"), 0)
        if not data_uri or not cached_at:
            return None
        if (int(time.time()) - cached_at) >= max_age_seconds:
            return None
        return data_uri

    def _get_cached_achievement_icon(self, badge_name, bundle):
        """Look up one badge inside a pre-loaded bundle dict.

        The bundle is always the per-game blob from
        cache_store.load_game_bundle(game_id), so we only need the
        badge name to key in here -- the game id is implicit.
        """
        badge = str(badge_name or "").strip()
        if not badge or not isinstance(bundle, dict):
            return None
        achievement_icons = bundle.get("achievementIcons") or {}
        if not isinstance(achievement_icons, dict):
            return None
        entry = achievement_icons.get(badge) or {}
        return self._fresh_data_uri(entry, self._achievement_icon_max_age_seconds)

    def _fetch_achievement_icon_data_uri(self, badge_name):
        url = self.achievement_badge_url(badge_name)
        if not url:
            return None
        return self._fetch_image_data_uri(url)

    def get_achievement_icons(self, game_id, badge_names) -> dict:
        game_id_int = norm_game_id(game_id)
        if game_id_int is None:
            return {"icons": {}}

        cleaned_badges = []
        seen_badges = set()
        for badge_name in badge_names or []:
            badge = str(badge_name or "").strip()
            if not badge or badge in seen_badges:
                continue
            seen_badges.add(badge)
            cleaned_badges.append(badge)

        if not cleaned_badges:
            return {"icons": {}}

        bundle_snapshot = self._cache_store.load_game_bundle(game_id_int)
        icons = {}
        missing_badges = []

        for badge_name in cleaned_badges:
            cached_icon = self._get_cached_achievement_icon(badge_name, bundle_snapshot)
            if cached_icon:
                icons[badge_name] = cached_icon
            else:
                missing_badges.append(badge_name)

        if not missing_badges:
            return {"icons": icons}

        now = int(time.time())
        fetched = {}
        worker_count = min(self._achievement_icon_max_workers, max(1, len(missing_badges)))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            future_map = {
                executor.submit(self._fetch_achievement_icon_data_uri, badge_name): badge_name
                for badge_name in missing_badges
            }
            for future in as_completed(future_map):
                badge_name = future_map[future]
                data_uri = future.result()
                if not data_uri:
                    continue
                icons[badge_name] = data_uri
                fetched[badge_name] = data_uri

        if not fetched:
            return {"icons": icons}

        with self._cache_store.game_bundle_lock(game_id_int):
            bundle = self._cache_store.load_game_bundle(game_id_int)
            achievement_icons = bundle.get("achievementIcons")
            if not isinstance(achievement_icons, dict):
                achievement_icons = {}
                bundle["achievementIcons"] = achievement_icons
            added_anything = False
            for badge_name, data_uri in fetched.items():
                if self._fresh_data_uri(achievement_icons.get(badge_name), self._achievement_icon_max_age_seconds):
                    continue
                achievement_icons[badge_name] = {
                    "dataUri": data_uri,
                    "cachedAt": now,
                }
                added_anything = True
            if added_anything:
                self._cache_store.save_game_bundle(game_id_int, bundle)

        return {"icons": icons}

    def _leaderboard_icon_cache_key(self, game_id, leaderboard_id):
        game_id_int = norm_game_id(game_id)
        leaderboard_id_int = norm_game_id(leaderboard_id)
        if game_id_int is None or leaderboard_id_int is None:
            return None
        return f"{game_id_int}:{leaderboard_id_int}"

    def _get_cached_leaderboard_icon(self, game_id, leaderboard_id, cache=None):
        cache = cache if isinstance(cache, dict) else self._cache_store.load_leaderboard_icons()
        cache_key = self._leaderboard_icon_cache_key(game_id, leaderboard_id)
        if not cache_key:
            return None
        entry = cache.get(cache_key) or {}
        return self._fresh_data_uri(entry, self._leaderboard_icon_max_age_seconds)

    def _leaderboard_icon_theme(self, fmt, rank_asc=False):
        text = str(fmt or "").strip().upper()
        if "MILLI" in text or "SEC" in text or "TIME" in text or rank_asc:
            return ("#173b63", "#2f7ed8", "TIME")
        if "POINT" in text or "SCORE" in text or "VALUE" in text:
            return ("#5a1d1d", "#e45f5f", "SCORE")
        return ("#2d2d2d", "#8a8a8a", text[:5] or "RANK")

    def _generate_leaderboard_icon_data_uri(self, title, fmt, rank_asc=False):
        bg1, bg2, label = self._leaderboard_icon_theme(fmt, rank_asc)
        safe_label = (label or "RANK")[:5]
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="{bg1}"/><stop offset="100%" stop-color="{bg2}"/></linearGradient></defs>
  <rect x="0" y="0" width="128" height="128" rx="16" fill="url(#g)"/>
  <text x="64" y="74" text-anchor="middle" font-size="22" font-weight="700" fill="#ffffff" font-family="Arial, sans-serif">{safe_label}</text>
</svg>"""
        encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
        return f"data:image/svg+xml;base64,{encoded}"

    def get_leaderboard_icons(self, game_id, leaderboard_rows) -> dict:
        game_id_int = norm_game_id(game_id)
        if game_id_int is None:
            return {"icons": {}}

        cleaned_rows = []
        seen_ids = set()
        for row in leaderboard_rows or []:
            if not isinstance(row, dict):
                continue
            leaderboard_id = to_int(row.get("id"), 0)
            if not leaderboard_id or leaderboard_id in seen_ids:
                continue
            seen_ids.add(leaderboard_id)
            cleaned_rows.append({
                "id": leaderboard_id,
                "title": row.get("title"),
                "format": row.get("format"),
                "rankAsc": bool(row.get("rankAsc", False)),
            })

        if not cleaned_rows:
            return {"icons": {}}

        cache_snapshot = self._cache_store.load_leaderboard_icons()
        icons = {}
        generated = {}
        now = int(time.time())

        for row in cleaned_rows:
            leaderboard_id = row["id"]
            cached_icon = self._get_cached_leaderboard_icon(game_id_int, leaderboard_id, cache=cache_snapshot)
            if cached_icon:
                icons[str(leaderboard_id)] = cached_icon
                continue
            data_uri = self._generate_leaderboard_icon_data_uri(row.get("title"), row.get("format"), row.get("rankAsc"))
            icons[str(leaderboard_id)] = data_uri
            cache_key = self._leaderboard_icon_cache_key(game_id_int, leaderboard_id)
            if cache_key:
                generated[cache_key] = data_uri

        if not generated:
            return {"icons": icons}

        with self._cache_store.leaderboard_icons_lock():
            cache = self._cache_store.load_leaderboard_icons()
            for cache_key, data_uri in generated.items():
                if self._fresh_data_uri(cache.get(cache_key), self._leaderboard_icon_max_age_seconds):
                    continue
                cache[cache_key] = {"dataUri": data_uri, "cachedAt": now}
            self._cache_store.save_leaderboard_icons(cache)

        return {"icons": icons}

    def _get_cached_game_icon(self, bundle):
        """Look up the game icon entry inside a pre-loaded bundle.

        The bundle is the per-game blob from
        cache_store.load_game_bundle(game_id); we only care about the
        single "gameIcon" slot inside it.
        """
        if not isinstance(bundle, dict):
            return None
        entry = bundle.get("gameIcon") or {}
        return self._fresh_data_uri(entry, self._game_icon_max_age_seconds)

    def get_game_icon(self, game_id, image_icon=None) -> dict:
        game_id_int = norm_game_id(game_id)
        if game_id_int is None:
            return {"dataUri": None}

        bundle_snapshot = self._cache_store.load_game_bundle(game_id_int)
        cached = self._get_cached_game_icon(bundle_snapshot)
        if cached:
            return {"dataUri": cached}

        url = self.game_icon_url(image_icon)
        if not url:
            return {"dataUri": None}

        data_uri = self._fetch_image_data_uri(url)
        if not data_uri:
            return {"dataUri": None}

        with self._cache_store.game_bundle_lock(game_id_int):
            bundle = self._cache_store.load_game_bundle(game_id_int)
            if not self._get_cached_game_icon(bundle):
                bundle["gameIcon"] = {
                    "dataUri": data_uri,
                    "cachedAt": int(time.time()),
                    "srcUrl": url,
                }
                self._cache_store.save_game_bundle(game_id_int, bundle)
        return {"dataUri": data_uri}

    def get_game_icons(self, entries) -> dict:
        """Batch version of get_game_icon.

        Takes a list of ``{"gameId": int, "imageIcon": str}`` pairs
        and returns ``{"icons": {gameId: dataUri | None, ...}}``. Same
        shape as get_user_avatars_cached: one call into here takes one
        image-lane slot in the IPC wrapper (the CDN lane, not the RA slot),
        and the per-game fetches that miss the cache run inside a bounded
        thread pool.

        New Sets pages render up to 50 rows at once, each of which
        used to fire its own get_game_icon IPC. At parallelRaCalls=3
        that meant 17+ rounds of serialised IPCs queued behind
        whatever else (avatars, comments) was firing alongside, and
        every transient CDN flake left a row with a blank tile and
        no retry. Batching this gives every row's URL one shot under
        one slot and the safety-net retry in the frontend catches
        anything that still slips through.

        Missing or invalid game ids are dropped silently. The fetches
        run on the dedicated game-icon worker pool (Game Icon Workers),
        since game icons sit on the RA media host rather than the badge
        CDN.
        """
        cleaned = []
        seen = set()
        for raw in entries or []:
            if not isinstance(raw, dict):
                continue
            game_id_int = norm_game_id(raw.get("gameId"))
            if game_id_int is None or game_id_int in seen:
                continue
            seen.add(game_id_int)
            url = self.game_icon_url(raw.get("imageIcon")) or ""
            cleaned.append((game_id_int, url))

        if not cleaned:
            return {"icons": {}}

        icons = {}
        missing = []
        for game_id_int, url in cleaned:
            bundle_snapshot = self._cache_store.load_game_bundle(game_id_int)
            cached = self._get_cached_game_icon(bundle_snapshot)
            if cached:
                icons[game_id_int] = cached
                continue
            icons[game_id_int] = None
            if url:
                missing.append((game_id_int, url))

        if not missing:
            return {"icons": icons}

        worker_count = min(self._game_icon_max_workers, max(1, len(missing)))

        def _fetch_one(game_id_int, url):
            data_uri = self._fetch_image_data_uri(url)
            return game_id_int, data_uri

        fetched = {}
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            future_map = {
                executor.submit(_fetch_one, gid, url): gid
                for gid, url in missing
            }
            for future in as_completed(future_map):
                gid, data_uri = future.result()
                if not data_uri:
                    if self._debug_logging_on():
                        decky.logger.info("icon_service: no game icon for %d", gid)
                    continue
                icons[gid] = data_uri
                fetched[gid] = data_uri

        if not fetched:
            return {"icons": icons}

        now = int(time.time())
        url_by_gid = dict(missing)
        for gid, data_uri in fetched.items():
            with self._cache_store.game_bundle_lock(gid):
                bundle = self._cache_store.load_game_bundle(gid)
                if not self._get_cached_game_icon(bundle):
                    bundle["gameIcon"] = {
                        "dataUri": data_uri,
                        "cachedAt": now,
                        "srcUrl": url_by_gid.get(gid),
                    }
                    self._cache_store.save_game_bundle(gid, bundle)

        return {"icons": icons}

    def get_award_icons(self, entries) -> dict:
        """Batch-fetch badge art for site / event awards that have no gameId.

        Takes a list of ``{"url": str}`` pairs and returns
        ``{"icons": {url: dataUri | None, ...}}`` keyed by the badge-art URL.
        Same one-slot-per-batch shape as get_game_icons: the IPC wrapper holds
        a single image-lane slot and the cache misses fan out across the game-icon
        worker pool (these render on the Badges page, the same page that runs
        the game-icon batch on that pool).

        Keyed by URL rather than gameId on purpose. These awards all report
        AwardData = 0, so the gameId path would collapse every one of them onto
        the single game-id-0 bundle slot and they'd show each other's art. Each
        award's URL is unique, so the per-URL file gives each its own slot and
        the collision can't happen. There's no TTL -- a present dataUri is a
        hit, full stop; badge art doesn't change.

        Blank URLs are dropped silently.
        """
        cleaned = []
        seen = set()
        for raw in entries or []:
            if not isinstance(raw, dict):
                continue
            url = str(raw.get("url") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            cleaned.append(url)

        if not cleaned:
            return {"icons": {}}

        icons = {}
        missing = []
        for url in cleaned:
            entry = self._cache_store.load_award_icon(url)
            cached = str((entry or {}).get("dataUri") or "").strip()
            if cached:
                icons[url] = cached
                continue
            icons[url] = None
            missing.append(url)

        if not missing:
            return {"icons": icons}

        worker_count = min(self._game_icon_max_workers, max(1, len(missing)))

        def _fetch_one(url):
            data_uri = self._fetch_image_data_uri(url)
            return url, data_uri

        fetched = {}
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            future_map = {
                executor.submit(_fetch_one, url): url
                for url in missing
            }
            for future in as_completed(future_map):
                url, data_uri = future.result()
                if not data_uri:
                    if self._debug_logging_on():
                        decky.logger.info("icon_service: no award icon for %s", url)
                    continue
                icons[url] = data_uri
                fetched[url] = data_uri

        if not fetched:
            return {"icons": icons}

        now = int(time.time())
        for url, data_uri in fetched.items():
            with self._cache_store.award_icon_lock(url):
                if not self._cache_store.load_award_icon(url):
                    self._cache_store.save_award_icon(url, {
                        "dataUri": data_uri,
                        "cachedAt": now,
                    })

        return {"icons": icons}

    def _next_tab_icon_seq(self) -> int:
        with self._tab_icon_seq_lock:
            self._tab_icon_seq += 1
            return self._tab_icon_seq

    def _tab_icon_seq_is_current(self, my_seq: int) -> bool:
        with self._tab_icon_seq_lock:
            return my_seq == self._tab_icon_seq

    def cancel_tab_game_icons(self) -> None:
        self._next_tab_icon_seq()

    def get_tab_game_icons(self, entries, max_workers=None) -> dict:
        """Cancelable batch game-icon fetch for the letter-tabbed views.

        Same cache-first contract and return shape as get_game_icons. The
        difference is cancellation: each call claims a monotonic request id,
        and the moment a newer call -- a tab switch firing its own batch, or
        cancel_tab_game_icons -- bumps that id, this one stops submitting the
        rest of its queue. The handful already in flight (at most worker_count)
        finish as the pool drains and we return what we have. That's how a
        letter-tab switch walks away from the previous tab's icon work without
        waiting on a slow CDN round-trip.

        AllGamesPage and BadgesPage drive this: one cancelable batch per tab /
        filter, with the frontend holding a single batch in flight at a time so
        even a fast A-Z sweep can't burst the media host the way the old
        per-row IPCs did.
        """
        my_seq = self._next_tab_icon_seq()

        cleaned = []
        seen = set()
        for raw in entries or []:
            if not isinstance(raw, dict):
                continue
            game_id_int = norm_game_id(raw.get("gameId"))
            if game_id_int is None or game_id_int in seen:
                continue
            seen.add(game_id_int)
            url = self.game_icon_url(raw.get("imageIcon")) or ""
            cleaned.append((game_id_int, url))

        if not cleaned:
            return {"icons": {}}

        icons = {}
        missing = []
        for game_id_int, url in cleaned:
            bundle_snapshot = self._cache_store.load_game_bundle(game_id_int)
            cached = self._get_cached_game_icon(bundle_snapshot)
            if cached:
                icons[game_id_int] = cached
                continue
            icons[game_id_int] = None
            if url:
                missing.append((game_id_int, url))

        if not missing or not self._tab_icon_seq_is_current(my_seq):
            return {"icons": icons}

        pool = self._game_icon_max_workers if max_workers is None else max_workers
        worker_count = max(1, min(pool, len(missing)))

        def _fetch_one(game_id_int, url):
            data_uri = self._fetch_image_data_uri(url)
            return game_id_int, data_uri

        fetched = {}
        fut_to_gid = {}
        it = iter(missing)
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            pending = set()

            def _submit_next():
                nxt = next(it, None)
                if nxt is None:
                    return False
                gid, url = nxt
                fut = executor.submit(_fetch_one, gid, url)
                fut_to_gid[fut] = gid
                pending.add(fut)
                return True

            for _ in range(worker_count):
                if not _submit_next():
                    break

            while pending:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                for fut in done:
                    gid = fut_to_gid.pop(fut)
                    _, data_uri = fut.result()
                    if not data_uri:
                        if self._debug_logging_on():
                            decky.logger.info("icon_service: no game icon for %d", gid)
                        continue
                    icons[gid] = data_uri
                    fetched[gid] = data_uri
                if not self._tab_icon_seq_is_current(my_seq):
                    break
                while len(pending) < worker_count:
                    if not _submit_next():
                        break

        if not fetched:
            return {"icons": icons}

        now = int(time.time())
        url_by_gid = dict(missing)
        for gid, data_uri in fetched.items():
            with self._cache_store.game_bundle_lock(gid):
                bundle = self._cache_store.load_game_bundle(gid)
                if not self._get_cached_game_icon(bundle):
                    bundle["gameIcon"] = {
                        "dataUri": data_uri,
                        "cachedAt": now,
                        "srcUrl": url_by_gid.get(gid),
                    }
                    self._cache_store.save_game_bundle(gid, bundle)

        return {"icons": icons}

    def _norm_game_image_kind(self, kind):
        text = str(kind or "").strip().lower()
        if text in GAME_IMAGE_KINDS:
            return text
        return None

    def _get_cached_game_image(self, kind, bundle):
        """Look up one non-icon game image inside a pre-loaded bundle."""
        norm_kind = self._norm_game_image_kind(kind)
        if norm_kind is None:
            return None
        if norm_kind == "icon":
            return self._get_cached_game_icon(bundle)

        if not isinstance(bundle, dict):
            return None
        game_images = bundle.get("gameImages") or {}
        if not isinstance(game_images, dict):
            return None
        entry = game_images.get(norm_kind) or {}
        return self._fresh_data_uri(entry, self._game_image_max_age_seconds)

    def get_game_image(self, game_id, kind=None, image_url=None) -> dict:
        game_id_int = norm_game_id(game_id)
        norm_kind = self._norm_game_image_kind(kind)
        if game_id_int is None or norm_kind is None:
            return {"dataUri": None}

        if norm_kind == "icon":
            return self.get_game_icon(game_id_int, image_url)

        bundle_snapshot = self._cache_store.load_game_bundle(game_id_int)
        cached = self._get_cached_game_image(norm_kind, bundle_snapshot)
        if cached:
            return {"dataUri": cached}

        url = str(image_url or "").strip()
        if not url:
            return {"dataUri": None}

        data_uri = self._fetch_image_data_uri(url)
        if not data_uri:
            return {"dataUri": None}

        with self._cache_store.game_bundle_lock(game_id_int):
            bundle = self._cache_store.load_game_bundle(game_id_int)
            game_images = bundle.get("gameImages")
            if not isinstance(game_images, dict):
                game_images = {}
                bundle["gameImages"] = game_images
            if not self._get_cached_game_image(norm_kind, bundle):
                game_images[norm_kind] = {
                    "dataUri": data_uri,
                    "cachedAt": int(time.time()),
                }
                self._cache_store.save_game_bundle(game_id_int, bundle)
        return {"dataUri": data_uri}

    def _normalise_avatar_key(self, username):
        text = str(username or "").strip().lower()
        return text or None

    def user_avatar_url(self, username):
        name = str(username or "").strip()
        if not name:
            return None
        return f"https://media.retroachievements.org/UserPic/{name}.png"

    def _avatar_url_from_pic_path(self, user_pic):
        path = str(user_pic or "").strip()
        if not path:
            return None
        if path.startswith("http://") or path.startswith("https://"):
            return path
        if not path.startswith("/"):
            path = "/" + path
        return "https://media.retroachievements.org" + path

    def _get_cached_user_avatar(self, entry):
        return self._fresh_data_uri(entry, self._user_avatar_max_age_seconds)

    def get_user_avatar_cached(self, username, web_api_key=None) -> dict:
        """Return a data URI for the avatar, fetching + caching if needed.

        Same shape as get_game_icon's response so the frontend layer
        can use the same pattern -- ``{"dataUri": str | None}``.

        Kept around for callers that only ever want one avatar at a
        time. The body just calls into get_user_avatars_cached with a
        one-element list so we don't have to maintain two copies of
        the cache / fetch / write logic.

        web_api_key is accepted for compatibility with the RPC wrapper
        in main.py but not used -- this path uses the convention URL
        which doesn't need credentials.
        """
        key = self._normalise_avatar_key(username)
        if not key:
            return {"dataUri": None}
        name = str(username or "").strip()
        result = self.get_user_avatars_cached([name], web_api_key)
        avatars = result.get("avatars") if isinstance(result, dict) else None
        if not isinstance(avatars, dict):
            return {"dataUri": None}
        return {"dataUri": avatars.get(key)}

    def get_user_avatars_cached(self, usernames, web_api_key=None, max_workers=None) -> dict:
        """Batch version of get_user_avatar_cached.

        Takes a list of usernames, returns ``{"avatars": {lowered_name:
        dataUri | None, ...}}``. Mirrors get_achievement_icons' shape:
        one call into this method takes one image-lane slot in the
        IPC wrapper, and the per-username fetches that miss the cache
        run inside a bounded thread pool. That keeps an AOTW page's
        20-row avatar warm-up to one slot instead of 20.

        Avatar URLs are built via the convention path
        (media.retroachievements.org/UserPic/<name>.png), not the
        profile endpoint. The profile endpoint is rate-limited
        aggressively and even one batch of ten users was enough to
        burst-trip it. The convention URL hits a CDN that doesn't
        rate-limit at our scale, so we can keep the parallel worker
        pool without ending up in a 429 spiral.

        Custom avatars come through fine here as long as the name is
        cased the way RA spells it -- the CDN path is case-sensitive,
        and the earlier "convention is inaccurate" belief was really
        just the URL being lowercased before the fetch. We now build
        the URL from the cased name (see user_avatar_url) and key the
        cache lowercased, so this path returns the real picture.

        ``max_workers`` lets a caller pin the pool size for this one
        batch (independently of the constructor-time default).

        web_api_key is accepted for compatibility with the RPC wrapper
        in main.py but is not used by the convention-URL path.

        Usernames in the result dict are lower-cased -- callers should
        look them up with the same normalisation. Missing or empty
        usernames are dropped silently.
        """
        cleaned = []
        cased_by_key = {}
        seen = set()
        for raw in usernames or []:
            key = self._normalise_avatar_key(raw)
            if not key or key in seen:
                continue
            seen.add(key)
            cleaned.append(key)
            cased_by_key[key] = str(raw or "").strip()

        if not cleaned:
            return {"avatars": {}}

        avatars = {}
        missing = []

        for key in cleaned:
            cached = self._get_cached_user_avatar(self._cache_store.load_user_avatar(key))
            if cached:
                avatars[key] = cached
            else:
                avatars[key] = None
                missing.append(key)

        if not missing:
            return {"avatars": avatars}

        routes = {}
        if self._resolved_avatars is not None:
            try:
                routes = self._resolved_avatars.get_user_pics_for_usernames(missing)
            except Exception:
                routes = {}

        now = int(time.time())
        fetched = {}
        if max_workers is not None:
            try:
                requested = max(1, int(max_workers))
            except (TypeError, ValueError):
                requested = self._user_avatar_max_workers
        else:
            requested = self._user_avatar_max_workers
        worker_count = min(requested, max(1, len(missing)))

        def _fetch_one(key):
            override_pic = routes.get(key)
            if override_pic:
                url = self._avatar_url_from_pic_path(override_pic)
                source = "profile"
            else:
                url = self.user_avatar_url(cased_by_key[key])
                source = "convention"
            if not url:
                return key, None, None, None
            data_uri = self._fetch_image_data_uri(url)
            return key, data_uri, url, source

        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            future_map = {
                executor.submit(_fetch_one, key): key
                for key in missing
            }
            for future in as_completed(future_map):
                key, data_uri, source_url, source = future.result()
                if not data_uri:
                    if self._debug_logging_on():
                        decky.logger.info("icon_service: no avatar for %s", key)
                    continue
                avatars[key] = data_uri
                fetched[key] = (data_uri, source_url, source)

        if not fetched:
            return {"avatars": avatars}

        for key, (data_uri, source_url, source) in fetched.items():
            with self._cache_store.user_avatar_lock(key):
                if source != "profile" and self._get_cached_user_avatar(self._cache_store.load_user_avatar(key)):
                    continue
                entry = {
                    "dataUri": data_uri,
                    "cachedAt": now,
                    "sourceUrl": source_url,
                    "source": source,
                }
                self._cache_store.save_user_avatar(key, entry)

        return {"avatars": avatars}

    def put_profile_avatar(self, username, data_uri, source_url) -> None:
        """Write a healed, profile-sourced avatar into the reservoir.

        The friend-pic healer calls this once it has resolved a renamed
        friend's real picture. The convention write paths yield to an
        entry that's still fresh; this one is the opposite, on purpose,
        because a profile entry is the authoritative answer and has to
        overwrite whatever's there (a stale convention joystick, in the
        case we care about). Keyed lowercased like every other reservoir
        entry. The "profile" tag is a record of how the bytes were
        settled, for reading the reservoir by eye; nothing branches on it.
        """
        key = self._normalise_avatar_key(username)
        data_uri = str(data_uri or "").strip()
        if not key or not data_uri:
            return
        now = int(time.time())
        with self._cache_store.user_avatar_lock(key):
            entry = {
                "dataUri": data_uri,
                "cachedAt": now,
                "sourceUrl": str(source_url or ""),
                "source": "profile",
            }
            self._cache_store.save_user_avatar(key, entry)

    def put_convention_avatar(self, username, data_uri, source_url, *, force=False) -> None:
        """Keep bytes the healer fetched from a user's convention file.

        The other half of put_profile_avatar. Before settling a verdict the
        healer downloads whatever is sitting at a user's convention path so
        it can fingerprint it against the stock joystick, and those bytes
        are exactly what the render path goes and asks the same CDN for the
        next time a panel needs that user. Handing them over here is what
        stops the picture being pulled twice.

        Follows the batch write's rule rather than put_profile_avatar's: a
        still-fresh entry stays put, a stale one gets replaced. The freshness
        test is what protects a renamed friend, whose entry holds their real
        picture from another path entirely and must not be overwritten with
        the joystick (or the stranger) living at their own name.

        force=True skips that freshness test, for the on-demand resolve: the
        entry it means to replace is by definition still inside its TTL, and
        the bytes in hand were just fetched past it on purpose. It stays on
        this method rather than borrowing put_profile_avatar, which would
        overwrite just as happily but would file convention bytes under the
        "profile" tag and leave anyone reading the reservoir by eye with the
        wrong story about where the picture came from.
        """
        key = self._normalise_avatar_key(username)
        data_uri = str(data_uri or "").strip()
        if not key or not data_uri:
            return
        now = int(time.time())
        with self._cache_store.user_avatar_lock(key):
            if not force and self._get_cached_user_avatar(self._cache_store.load_user_avatar(key)):
                return
            entry = {
                "dataUri": data_uri,
                "cachedAt": now,
                "sourceUrl": str(source_url or ""),
                "source": "convention",
            }
            self._cache_store.save_user_avatar(key, entry)

    def cached_avatar_bytes(self, username, source_url):
        """Raw bytes of a fresh reservoir entry that came from ``source_url``.

        The healer's fingerprint step asks a narrower question than "what is
        this user's avatar" -- it asks what is sitting at one specific file.
        A renamed friend's entry holds their real picture from some other
        path, and hashing that would answer the wrong question and could
        flip their verdict. Every entry records the URL it was fetched from,
        so matching on it is the thing that makes reuse sound: a mismatch
        falls through to a real fetch, which is the only answer that would
        have been right for that user anyway.

        None whenever there's nothing usable (no entry, past its TTL, filed
        under a different URL, or a data URI we can't decode), and the
        caller goes to the CDN exactly as it did before.
        """
        key = self._normalise_avatar_key(username)
        wanted = str(source_url or "").strip()
        if not key or not wanted:
            return None
        entry = self._cache_store.load_user_avatar(key)
        if str(entry.get("sourceUrl") or "").strip() != wanted:
            return None
        data_uri = self._get_cached_user_avatar(entry)
        if not data_uri:
            return None
        try:
            return base64.b64decode(data_uri.split(",", 1)[1])
        except (ValueError, IndexError):
            return None

