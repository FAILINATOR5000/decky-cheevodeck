import asyncio
import decky
from utils import WalkYieldedForClear, to_int

from mixins._context import PluginContext


class TrackedSetsMixin(PluginContext):

    async def save_tracked_sets_auto_check(self, tracked_sets_auto_check: bool):
        value = self.settings_store.update_tracked_sets_auto_check(tracked_sets_auto_check)

        return {
            "ok": True,
            "trackedSetsAutoCheck": value,
        }

    async def save_tracked_sets_service_enabled(self, tracked_sets_service_enabled: bool):
        value = self.settings_store.update_tracked_sets_service_enabled(tracked_sets_service_enabled)

        return {
            "ok": True,
            "trackedSetsServiceEnabled": value,
        }

    async def save_tracked_sets_refresh_minutes(self, tracked_sets_refresh_minutes: int):
        value = self.settings_store.update_tracked_sets_refresh_minutes(tracked_sets_refresh_minutes)

        return {
            "ok": True,
            "trackedSetsRefreshMinutes": value,
        }

    async def save_tracked_sets_selector_sort(self, tracked_sets_selector_sort: str = "alphabetical"):
        value = self.settings_store.update_tracked_sets_selector_sort(tracked_sets_selector_sort)

        return {
            "ok": True,
            "trackedSetsSelectorSort": value,
        }

    async def save_tracked_sets_selector_filter(self, tracked_sets_selector_filter: str = "all"):
        value = self.settings_store.update_tracked_sets_selector_filter(tracked_sets_selector_filter)

        return {
            "ok": True,
            "trackedSetsSelectorFilter": value,
        }

    async def save_tracked_set_a_button_mode(self, tracked_set_a_button_mode: str):
        value = self.settings_store.update_tracked_set_a_button_mode(tracked_set_a_button_mode)

        return {
            "ok": True,
            "trackedSetAButtonMode": value,
        }

    async def load_tracked_sets(self):
        return self.tracked_sets_store.load_all()

    async def create_tracked_set(self, name: str = ""):
        return self.tracked_sets_store.create_set(name)

    async def rename_tracked_set(self, set_id: str = "", name: str = ""):
        return self.tracked_sets_store.rename_set(set_id, name)

    async def delete_tracked_set(self, set_id: str = ""):
        return self.tracked_sets_store.delete_set(set_id)

    async def set_tracked_set_game_sort(self, set_id: str = "", sort: str = "manual"):
        return self.tracked_sets_store.set_game_sort(set_id, sort)

    async def set_tracked_set_game_filter(self, set_id: str = "", game_filter: str = "all"):
        return self.tracked_sets_store.set_game_filter(set_id, game_filter)

    async def set_tracked_set_view_mode(self, set_id: str = "", mode: str = "all"):
        return self.tracked_sets_store.set_view_mode(set_id, mode)

    async def touch_tracked_set_opened(self, set_id: str = ""):
        return self.tracked_sets_store.touch_opened(set_id)

    async def add_game_to_set(self, set_id: str = "", game=None):
        if game is None:
            game = {}
        return self.tracked_sets_store.add_game(set_id, game)

    async def remove_game_from_set(self, set_id: str = "", game_id=None):
        return self.tracked_sets_store.remove_game(set_id, game_id)

    async def update_set_game_note(self, set_id: str = "", game_id=None, note: str = "", color: str = "default"):
        return self.tracked_sets_store.update_game_note(set_id, game_id, note, color)

    async def reorder_set_games(self, set_id: str = "", ordered_ids=None, order: str = "all"):
        if ordered_ids is None:
            ordered_ids = []
        return self.tracked_sets_store.reorder_games(set_id, ordered_ids, order)

    async def clear_all_tracked_sets(self):
        return self.tracked_sets_store.clear_all_tracked_sets()

    async def get_set_console_list(self):
        cached = self.cache_store.get_cached_consoles()
        if cached is not None:
            return {"ok": True, "consoles": cached, "cached": True}

        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        if not web_api_key:
            return {
                "ok": False,
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "consoles": [],
            }

        async with self._ra_slot():
            raw = await asyncio.to_thread(self.ra.get_console_ids, web_api_key)

        consoles = self._shape_console_list(raw)
        try:
            self.cache_store.save_consoles(consoles)
        except Exception as e:
            decky.logger.warning("get_console_ids: cache save failed: %s", type(e).__name__)
        return {"ok": True, "consoles": consoles, "cached": False}

    async def get_set_game_list(self, console_id=None, refresh: bool = False):
        normalized = to_int(console_id, 0)
        if normalized <= 0:
            return {"ok": False, "error": "invalid_console_id", "games": []}

        if not refresh:
            cached = self.cache_store.get_cached_game_list(normalized)
            if cached is not None:
                return {"ok": True, "games": cached, "cached": True}

        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        if not web_api_key:
            return {
                "ok": False,
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "games": [],
            }

        async with self._ra_slot():
            raw = await asyncio.to_thread(self.ra.get_game_list, normalized, web_api_key)

        games = self._shape_game_list(raw)
        try:
            self.cache_store.save_game_list(normalized, games)
        except Exception as e:
            decky.logger.warning("get_set_game_list: cache save failed: %s", type(e).__name__)
        return {"ok": True, "games": games, "cached": False}

    async def check_set_completion(self, set_id: str = ""):
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}

        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        username = str(cfg.get("username", "")).strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        if not username or not web_api_key:
            return {
                "ok": False,
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
            }

        async with self._ra_slot():
            results = await asyncio.to_thread(
                self._completion_results,
                self._active_ra_user(cfg),
                web_api_key,
            )

        return self.tracked_sets_store.apply_completion_results(set_id, results)

    async def check_all_sets_completion(self):
        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        username = str(cfg.get("username", "")).strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        if not username or not web_api_key:
            return {
                "ok": False,
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
            }

        async with self._ra_slot():
            results = await asyncio.to_thread(
                self._completion_results,
                self._active_ra_user(cfg),
                web_api_key,
            )

        return self.tracked_sets_store.apply_completion_results_all(results)

    def _completion_results(self, user: str, web_api_key: str, abort_check=None) -> dict:
        gen0 = self.games_list_cache_store.current_generation()
        progress, truncated = self._gather_completion_progress(user, web_api_key, abort_check=abort_check)
        self._feed_games_list_cache(user, progress, truncated, gen0)
        results = {}
        for row in progress:
            game_id = to_int(row.get("GameID", row.get("gameId")), 0)
            if game_id <= 0:
                continue
            results[str(game_id)] = {
                "numAwarded": to_int(row.get("NumAwarded", row.get("numAwarded")), 0),
                "maxPossible": to_int(row.get("MaxPossible", row.get("maxPossible")), 0),
                "highestAward": row.get("HighestAwardKind", row.get("highestAward")),
            }
        return results

    def _feed_games_list_cache(self, user, raw_rows, truncated, gen0):
        if truncated:
            if bool(getattr(self, "_debug_logging", False)):
                decky.logger.info(
                    "tracked sets monitor: walk hit the page safety stop, skipping the games-list cache feed"
                )
            return
        if not raw_rows:
            return
        payload = self.friends_service.build_friend_all_games_payload(user, raw_rows)
        try:
            self.games_list_cache_store.save(user, payload, gen0)
        except Exception as e:
            decky.logger.warning("tracked sets games-list cache feed failed: %s", type(e).__name__)
        if bool(getattr(self, "_debug_logging", False)):
            decky.logger.info(
                "tracked sets monitor: games-list cache fed off the walk (%d games)",
                len(payload["results"]),
            )

    def _gather_completion_progress(self, user: str, web_api_key: str, abort_check=None) -> tuple:
        page_size = 500
        offset = 0
        rows = []
        truncated = False
        while True:
            if abort_check is not None and abort_check():
                raise WalkYieldedForClear()
            payload = self.ra.get_user_completion_progress(
                user,
                web_api_key,
                count=page_size,
                offset=offset,
            )
            results = (payload or {}).get("Results", []) if isinstance(payload, dict) else []
            if not isinstance(results, list) or not results:
                break
            rows.extend(results)
            if len(results) < page_size:
                break
            offset += page_size
            if offset >= page_size * 20:
                truncated = True
                break
        return rows, truncated

    def _shape_console_list(self, raw) -> list:
        if not isinstance(raw, list):
            return []
        consoles = []
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            if not bool(entry.get("IsGameSystem", False)):
                continue
            console_id = to_int(entry.get("ID"), 0)
            if console_id <= 0:
                continue
            consoles.append({
                "id": console_id,
                "name": str(entry.get("Name", "")).strip(),
                "iconUrl": str(entry.get("IconURL", "")).strip(),
                "active": bool(entry.get("Active", False)),
            })
        consoles.sort(key=lambda c: c["name"].lower())
        return consoles

    def _shape_game_list(self, raw) -> list:
        if not isinstance(raw, list):
            return []
        games = []
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            game_id = to_int(entry.get("ID"), 0)
            if game_id <= 0:
                continue
            games.append({
                "gameId": game_id,
                "title": str(entry.get("Title", "")).strip(),
                "imageIcon": self.icon_service.game_icon_url(entry.get("ImageIcon")) or "",
                "consoleName": str(entry.get("ConsoleName", "")).strip(),
                "maxPossible": to_int(entry.get("NumAchievements"), 0),
            })
        games.sort(key=lambda g: g["title"].lower())
        return games
