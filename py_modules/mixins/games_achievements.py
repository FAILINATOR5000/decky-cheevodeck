import asyncio
from utils import frontend_error

from mixins._context import PluginContext


class GamesAchievementsMixin(PluginContext):

    async def save_show_all_toggle_main(self, show_all_toggle_main: bool):
        value = self.settings_store.update_show_all_toggle_main(show_all_toggle_main)

        return {
            "ok": True,
            "showAllToggleMain": value,
        }

    async def save_show_retro_points(self, show_retro_points: bool):
        value = self.settings_store.update_show_retro_points(show_retro_points)

        return {
            "ok": True,
            "showRetroPoints": value,
        }

    async def save_achievement_style(self, achievement_style: str):
        value = self.settings_store.update_achievement_style(achievement_style)

        return {
            "ok": True,
            "achievementStyle": value,
        }

    async def save_main_achievement_filter(self, main_achievement_filter: str):
        value = self.settings_store.update_main_achievement_filter(main_achievement_filter)

        return {
            "ok": True,
            "mainAchievementFilter": value,
        }

    async def save_main_achievement_sort(self, main_achievement_sort: str):
        value = self.settings_store.update_main_achievement_sort(main_achievement_sort)

        return {
            "ok": True,
            "mainAchievementSort": value,
        }

    async def save_unlock_lookback_minutes(self, unlock_lookback_minutes: int):
        value = self.settings_store.update_unlock_lookback_minutes(unlock_lookback_minutes)

        return {
            "ok": True,
            "unlockLookbackMinutes": value,
        }

    async def save_unlock_history_days(self, unlock_history_days: int):
        value = self.settings_store.update_unlock_history_days(unlock_history_days)

        return {
            "ok": True,
            "unlockHistoryDays": value,
        }

    async def save_show_all_achievements(self, show_all_achievements: bool):
        value = self.settings_store.update_show_all_achievements(show_all_achievements)

        return {
            "ok": True,
            "showAllAchievements": value,
        }

    async def save_show_a_button_mode(self, show_a_button_mode: bool):
        value = self.settings_store.update_show_a_button_mode(show_a_button_mode)

        return {
            "ok": True,
            "showAButtonMode": value,
        }

    async def save_main_achievement_action(self, main_achievement_action: str):
        value = self.settings_store.update_main_achievement_action(main_achievement_action)

        return {
            "ok": True,
            "mainAchievementAction": value,
        }

    async def check_current_game(self):
        async with self._game_check_slot():
            return await asyncio.to_thread(self._check_current_game_sync)

    def _check_current_game_sync(self):
        cfg = self.settings_store.load_config()
        username = self._active_ra_user(cfg)
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        unlock_lookback_minutes = self.settings_store.get_unlock_lookback_minutes(cfg)
        auto_refresh = bool(cfg.get("autoRefresh", True))

        if not username or not web_api_key:
            cached = self.cache_store.load_payload()
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": cached.get("payload"),
                "sameGame": False,
                "changed": False,
                "currentGameId": None,
                "cachedGameId": None,
            }

        return self.current_game_service.check_current_game(username, web_api_key, unlock_lookback_minutes, auto_refresh)

    async def refresh_current_game(self, force: bool = False):
        async with self._game_check_slot():
            return await asyncio.to_thread(self._refresh_current_game_sync, bool(force))

    def _refresh_current_game_sync(self, force):
        cfg = self.settings_store.load_config()
        username = self._active_ra_user(cfg)
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        unlock_lookback_minutes = self.settings_store.get_unlock_lookback_minutes(cfg)

        if not username or not web_api_key:
            cached = self.cache_store.load_payload()
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": cached.get("payload"),
                "changed": False,
            }

        return self.current_game_service.refresh_current_game(username, web_api_key, unlock_lookback_minutes, force=force)

    async def get_game_payload(self, game_id=None, force: bool = False):
        async with self._ra_slot():
            return await asyncio.to_thread(self._get_game_payload_sync, game_id, bool(force))

    def _get_game_payload_sync(self, game_id, force=False):
        cfg = self.settings_store.load_config()
        username = self._active_ra_user(cfg)
        web_api_key = str(cfg.get("webApiKey", "")).strip()

        if not username or not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": None,
            }

        return self.friends_service.get_user_game_payload(web_api_key, username, game_id, force)

    async def clear_current_game(self):
        return self.current_game_service.clear_current_game()

    async def get_recent_unlock_history(self, game_id=None):
        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = self._active_ra_user(cfg)
        if not web_api_key or not username:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": None,
                "changed": False,
            }

        try:
            history_days = self.settings_store.get_unlock_history_days(cfg)
            if history_days == -1:
                lookback_minutes = 99999999
            else:
                lookback_minutes = history_days * 24 * 60

            payload = self.current_game_service.get_recent_unlock_history(
                username,
                web_api_key,
                game_id,
                minutes=lookback_minutes,
            )
            return {
                "needsSettings": False,
                "payload": payload,
                "changed": True,
            }
        except Exception as e:
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't load your recent unlocks right now.", e),
                "payload": None,
                "changed": False,
            }
