import urllib.error

from utils import frontend_error, normalize_ra_comment, to_int


_RA_MAX_PER_PAGE = 100


class GameCommentsService:
    """Fetches the comment wall for an arbitrary game OR achievement, paginated.

    Unlike AOTW (which slices a fixed window of comments into its
    main payload) Game Overview lets the user scroll through the
    full comment thread. We support offset/count pagination, with
    each call doing as many RA hits as it takes to assemble the
    requested page of *real* user comments. RA's comments endpoint
    mixes audit-log entries ("badge promoted", "type changed", etc.)
    authored by a system user named "Server" in with real user
    comments. We filter those out -- but the filter happens after
    the fetch, so a 10-row request can come back with fewer than
    10 real comments. The loop in _fetch_filtered_page keeps pulling
    until we have the requested count or RA runs dry. One slot per
    IPC still holds (handoff 5.1) -- the loop runs inside the
    caller's _ra_slot.

    The achievement-comments variant is the same shape pointed at
    a different RA endpoint kind ("achievement" instead of "game").
    It's a method on this class rather than a sibling service
    because the two share every line of logic except which int the
    backend passes for `t`. Keeping them together avoids a near-
    duplicate file.

    Avatars are NOT resolved here. Each <CommentCard> on the
    frontend mounts its own <UserAvatar> which lazy-loads after
    paint -- pre-resolving them inside this IPC's slot used to
    block "load more" for 2-5s on every page because each per-
    username CDN fetch sat behind Cloudflare's cold latency.

    There is intentionally NO on-disk cache here. Comments are a
    fresh-fetch surface -- caching them would risk showing stale
    comment trees, and the user generally paginates within a
    session and leaves. If we ever want a TTL'd recent-page cache
    we can add one later without changing the IPC shape.
    """

    def __init__(self, *, ra, icon_service):
        self._ra = ra
        self._icon_service = icon_service

    def get_game_comments(
        self,
        username: str,
        web_api_key: str,
        game_id,
        sort: str,
        offset: int,
        count: int,
    ) -> dict:
        del username

        return self._fetch_page("game", game_id, web_api_key, sort, offset, count,
                                "Couldn't load this game's comments.")

    def get_achievement_comments(
        self,
        username: str,
        web_api_key: str,
        achievement_id,
        sort: str,
        offset: int,
        count: int,
    ) -> dict:
        del username

        return self._fetch_page("achievement", achievement_id, web_api_key, sort, offset, count,
                                "Couldn't load this achievement's comments.")

    def get_user_comments(
        self,
        username: str,
        web_api_key: str,
        target_username,
        sort: str,
        offset: int,
        count: int,
    ) -> dict:
        del username

        return self._fetch_page("user", target_username, web_api_key, sort, offset, count,
                                "Couldn't load this wall's comments.", detect_restricted=True)

    def _fetch_page(self, kind, target_id, web_api_key, sort, offset, count, error_prefix, detect_restricted=False):
        sort_arg = "-submitted" if sort != "oldest" else "submitted"
        safe_offset = max(0, to_int(offset, 0))
        safe_count = max(1, min(_RA_MAX_PER_PAGE, to_int(count, 10)))

        try:
            return self._fetch_filtered_page(
                kind=kind,
                target_id=target_id,
                web_api_key=web_api_key,
                sort_arg=sort_arg,
                start_offset=safe_offset,
                want=safe_count,
            )
        except Exception as e:
            if (
                detect_restricted
                and isinstance(e, urllib.error.HTTPError)
                and e.code in (401, 403, 404)
            ):
                return {
                    "comments": [],
                    "total": None,
                    "nextOffset": safe_offset,
                    "hasMore": False,
                    "restricted": True,
                }
            rate_limited = isinstance(e, urllib.error.HTTPError) and e.code in (429, 503)
            return {
                "comments": [],
                "total": None,
                "nextOffset": safe_offset,
                "hasMore": False,
                "error": frontend_error(error_prefix, e),
                "rate_limited": rate_limited,
            }

    def _fetch_filtered_page(self, *, kind, target_id, web_api_key, sort_arg, start_offset, want):
        collected = []
        cursor = start_offset
        raw_total = None
        rows_seen = 0

        while len(collected) < want:
            remaining = want - len(collected)
            page_size = min(_RA_MAX_PER_PAGE, remaining * 3)

            if raw_total is not None and cursor >= raw_total:
                break

            raw = self._ra.get_comments(
                web_api_key,
                target_id,
                kind=kind,
                count=page_size,
                offset=cursor,
                sort=sort_arg,
            )
            if raw_total is None:
                raw_total = self._extract_total(raw)

            raw_rows = []
            if isinstance(raw, dict):
                raw_rows = raw.get("Results") or raw.get("results") or []

            rows_seen += len(raw_rows)

            if not raw_rows:
                break

            filtered, consumed = self._collect_filtered_page(raw_rows, remaining)
            collected.extend(filtered)
            cursor += consumed

            if len(raw_rows) < page_size and consumed == len(raw_rows):
                break

        if raw_total is not None:
            has_more = cursor < raw_total
        else:
            has_more = len(collected) > 0

        return {
            "comments": collected,
            "total": raw_total,
            "nextOffset": cursor,
            "hasMore": has_more,
            "rowsSeen": rows_seen,
        }

    def _collect_filtered_page(self, raw_rows, want):
        out = []
        consumed = 0
        for row in raw_rows:
            consumed += 1
            normalised = normalize_ra_comment(row)
            if normalised is None:
                continue
            out.append(normalised)
            if len(out) >= want:
                break
        return out, consumed

    def _extract_total(self, raw):
        if not isinstance(raw, dict):
            return None
        for key in ("Total", "total"):
            if key in raw:
                try:
                    return int(raw[key])
                except (ValueError, TypeError, OverflowError):
                    return None
        return None
