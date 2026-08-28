import time

import decky

from utils import frontend_error, norm_game_id, to_int


LEADERBOARDS_CACHE_MAX_GAMES = 50


class LeaderboardsService:
    """Fetches, normalises, and caches leaderboard data from RetroAchievements."""

    def __init__(self, *, ra, cache_store, leaderboards_cache_max_age_seconds: int):
        self._ra = ra
        self._cache_store = cache_store
        self._leaderboards_cache_max_age_seconds = leaderboards_cache_max_age_seconds

    def _normalize_leaderboard_user_entry(self, raw):
        if not isinstance(raw, dict):
            return None
        return {
            "user": raw.get("User", raw.get("user")),
            "ulid": raw.get("ULID", raw.get("ulid")),
            "score": raw.get("Score", raw.get("score")),
            "formattedScore": raw.get("FormattedScore", raw.get("formattedScore")),
            "rank": to_int(raw.get("Rank", raw.get("rank")), 0) or None,
            "dateUpdated": raw.get("DateUpdated", raw.get("dateUpdated")),
        }

    def _normalize_game_leaderboards_payload(self, game_id, raw_list, raw_user_list=None):
        list_results = raw_list.get("Results", raw_list.get("results", [])) or []
        user_results = raw_user_list.get("Results", raw_user_list.get("results", [])) if isinstance(raw_user_list, dict) else []
        user_by_id = {}
        for item in user_results or []:
            lid = to_int(item.get("ID", item.get("id")), 0)
            if lid:
                user_by_id[lid] = self._normalize_leaderboard_user_entry(item.get("UserEntry", item.get("userEntry")))
        rows = []
        for item in list_results:
            lid = to_int(item.get("ID", item.get("id")), 0)
            if not lid:
                continue
            rows.append({
                "id": lid,
                "rankAsc": bool(item.get("RankAsc", item.get("rankAsc", False))),
                "title": item.get("Title", item.get("title")) or f"Leaderboard {lid}",
                "description": item.get("Description", item.get("description")) or "",
                "format": item.get("Format", item.get("format")),
                "state": item.get("State", item.get("state")),
                "userEntry": user_by_id.get(lid),
            })
        return {
            "gameId": norm_game_id(game_id),
            "count": to_int(raw_list.get("Count", raw_list.get("count", len(rows))), len(rows)),
            "total": to_int(raw_list.get("Total", raw_list.get("total", len(rows))), len(rows)),
            "results": rows,
            "refreshedAt": int(time.time()),
        }

    def _normalize_leaderboard_entries_payload(self, leaderboard_id, raw_entries):
        results = []
        for item in raw_entries.get("Results", raw_entries.get("results", [])) or []:
            results.append({
                "rank": to_int(item.get("Rank", item.get("rank")), 0),
                "user": item.get("User", item.get("user")) or "Unknown",
                "ulid": item.get("ULID", item.get("ulid")),
                "score": item.get("Score", item.get("score")),
                "formattedScore": item.get("FormattedScore", item.get("formattedScore")),
                "dateSubmitted": item.get("DateSubmitted", item.get("dateSubmitted")),
            })
        return {
            "leaderboardId": norm_game_id(leaderboard_id),
            "count": to_int(raw_entries.get("Count", raw_entries.get("count", len(results))), len(results)),
            "total": to_int(raw_entries.get("Total", raw_entries.get("total", len(results))), len(results)),
            "results": results,
            "refreshedAt": int(time.time()),
        }

    def _cap_leaderboards_cache(self, cache):
        if len(cache) <= LEADERBOARDS_CACHE_MAX_GAMES:
            return cache

        def refreshed_at(item):
            payload = item[1]
            if not isinstance(payload, dict):
                return 0
            return to_int(payload.get("refreshedAt"), 0)

        ranked = sorted(cache.items(), key=refreshed_at, reverse=True)
        return dict(ranked[:LEADERBOARDS_CACHE_MAX_GAMES])

    def get_game_leaderboards(self, user: str, web_api_key: str, game_id, force: bool = False) -> dict:
        game_id_int = norm_game_id(game_id)
        if game_id_int is None:
            return {"error": "No game selected.", "payload": None, "changed": False}

        cache_snapshot = self._cache_store.load_leaderboards()
        cache_key = str(game_id_int)
        cached_payload = cache_snapshot.get(cache_key) if isinstance(cache_snapshot.get(cache_key), dict) else None
        cached_refreshed = to_int((cached_payload or {}).get("refreshedAt"), 0)
        if cached_payload and not force and cached_refreshed and (int(time.time()) - cached_refreshed) < self._leaderboards_cache_max_age_seconds:
            return {"payload": cached_payload, "changed": False}

        try:
            raw_list = self._ra.get_game_leaderboards(game_id_int, web_api_key, count=500, offset=0)
            try:
                raw_user_list = self._ra.get_user_game_leaderboards(user, game_id_int, web_api_key, count=500, offset=0)
            except Exception as exc:
                if getattr(exc, "code", None) != 422:
                    decky.logger.warning("user-leaderboards fetch failed for game %s: %s (%s)", game_id_int, type(exc).__name__, exc)
                raw_user_list = {"Count": 0, "Total": 0, "Results": []}
            payload = self._normalize_game_leaderboards_payload(game_id_int, raw_list, raw_user_list)
            with self._cache_store.leaderboards_lock():
                cache = self._cache_store.load_leaderboards()
                if not isinstance(cache, dict):
                    cache = {}
                cache[cache_key] = payload
                cache = self._cap_leaderboards_cache(cache)
                self._cache_store.save_leaderboards(cache)
            return {"payload": payload, "changed": True}
        except Exception as exc:
            error = frontend_error("Couldn't load leaderboards for this game.", exc)
            if cached_payload:
                return {"payload": cached_payload, "error": error, "changed": False}
            return {"error": error, "payload": None, "changed": False}

    def get_leaderboard_entries(self, web_api_key: str, leaderboard_id, count: int = 25, offset: int = 0) -> dict:
        leaderboard_id_int = norm_game_id(leaderboard_id)
        if leaderboard_id_int is None:
            return {"error": "No leaderboard selected.", "payload": None, "changed": False}
        try:
            raw_entries = self._ra.get_leaderboard_entries(leaderboard_id_int, web_api_key, count=count, offset=offset)
            payload = self._normalize_leaderboard_entries_payload(leaderboard_id_int, raw_entries)
            return {"payload": payload, "changed": True}
        except Exception as exc:
            error = frontend_error("Couldn't load the leaderboard's top scores.", exc)
            return {"error": error, "payload": None, "changed": False}

    def get_leaderboard_user_entry(self, user: str, web_api_key: str, leaderboard_id, game_id) -> dict:
        leaderboard_id_int = norm_game_id(leaderboard_id)
        game_id_int = norm_game_id(game_id)
        if leaderboard_id_int is None:
            return {"error": "No leaderboard selected.", "payload": None, "changed": False}
        if game_id_int is None:
            return {"error": "No game selected.", "payload": None, "changed": False}
        try:
            raw_user_list = self._ra.get_user_game_leaderboards(user, game_id_int, web_api_key, count=500, offset=0)
            user_entry = None
            for item in raw_user_list.get("Results", raw_user_list.get("results", [])) or []:
                lid = to_int(item.get("ID", item.get("id")), 0)
                if lid == leaderboard_id_int:
                    user_entry = self._normalize_leaderboard_user_entry(item.get("UserEntry", item.get("userEntry")))
                    break
            payload = {"leaderboardId": leaderboard_id_int, "userEntry": user_entry, "refreshedAt": int(time.time())}
            return {"payload": payload, "changed": True}
        except Exception as exc:
            if getattr(exc, "code", None) == 422:
                payload = {"leaderboardId": leaderboard_id_int, "userEntry": None, "refreshedAt": int(time.time())}
                return {"payload": payload, "changed": True}
            error = frontend_error("Couldn't load your standing on this leaderboard.", exc)
            return {"error": error, "payload": None, "changed": False}
