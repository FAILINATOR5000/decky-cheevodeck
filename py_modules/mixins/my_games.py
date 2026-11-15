import asyncio
import time

from mixins._context import PluginContext
from utils import to_int


MY_GAMES_STALE_SECONDS = 6 * 60 * 60


class MyGamesMixin(PluginContext):
    async def my_games_list(self):
        return await asyncio.to_thread(self._my_games_list_sync)

    def _my_games_list_sync(self) -> dict:
        cfg = self.settings_store.load_config()
        ulid = str(cfg.get("activeUlid") or "").strip()
        cached = self.games_list_cache_store.load(ulid, None) if ulid else {"hit": False}
        payload = cached.get("payload") if cached.get("hit") else None
        rows = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            rows = None
        cached_at = to_int(cached.get("cachedAt"), 0) if rows is not None else 0

        by_game = {}
        for row in rows or []:
            if isinstance(row, dict) and to_int(row.get("gameId"), 0) > 0:
                by_game[to_int(row["gameId"], 0)] = row

        scanned = self.multiplayer_service.my_games()
        if scanned is not None:
            games = [{**game, "progress": _progress(by_game.get(game["gameId"]))} for game in scanned]
        else:
            games = _profile_games(by_game)
        games.sort(key=lambda game: game["title"].lower())
        return {
            "ok": True,
            "scanned": scanned is not None,
            "cached": rows is not None,
            "stale": rows is None or int(time.time()) - cached_at > MY_GAMES_STALE_SECONDS,
            "games": games,
        }

    async def refresh_my_games(self):
        cfg = self.settings_store.load_config()
        result = await self.fetch_friend_all_games_full(
            self._active_ra_user(cfg), str(cfg.get("activeUlid") or "").strip()
        )
        listing = await self.my_games_list()
        if result.get("needsSettings"):
            listing["needsSettings"] = True
        if result.get("error"):
            listing["error"] = result["error"]
        return listing


def _progress(row) -> dict | None:
    if row is None:
        return None
    return {
        "numAwarded": to_int(row.get("numAwarded"), 0),
        "maxPossible": to_int(row.get("maxPossible"), 0),
        "highestAwardKind": row.get("highestAwardKind") or None,
    }


def _profile_games(by_game: dict) -> list:
    ids_by_name = {}
    for row in by_game.values():
        console_id = to_int(row.get("consoleId"), 0)
        if console_id > 0 and row.get("consoleName"):
            ids_by_name[row["consoleName"]] = console_id
    games = []
    for game_id, row in by_game.items():
        name = str(row.get("consoleName") or "")
        games.append({
            "gameId": game_id,
            "title": str(row.get("title") or game_id),
            "systemId": to_int(row.get("consoleId"), 0) or ids_by_name.get(name, 0),
            "system": name,
            "imageIcon": str(row.get("imageIcon") or ""),
            "progress": _progress(row),
        })
    return games
