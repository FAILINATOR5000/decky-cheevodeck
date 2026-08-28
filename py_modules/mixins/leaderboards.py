import asyncio

from mixins._context import PluginContext


class LeaderboardsMixin(PluginContext):

    async def get_game_leaderboards(self, game_id, force=False):
        async with self._ra_slot():
            return await asyncio.to_thread(self._get_game_leaderboards_sync, game_id, bool(force))

    def _get_game_leaderboards_sync(self, game_id, force):
        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            return {"needsSettings": True, "error": "Please enter your RetroAchievements username and Web API key.", "payload": None, "changed": False}
        return self.leaderboards_service.get_game_leaderboards(self._active_ra_user(cfg), web_api_key, game_id, force=force)

    async def get_leaderboard_entries(self, leaderboard_id, count=25, offset=0):
        async with self._ra_slot():
            return await asyncio.to_thread(self._get_leaderboard_entries_sync, leaderboard_id, count, offset)

    def _get_leaderboard_entries_sync(self, leaderboard_id, count, offset):
        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            return {"needsSettings": True, "error": "Please enter your RetroAchievements username and Web API key.", "payload": None, "changed": False}
        return self.leaderboards_service.get_leaderboard_entries(web_api_key, leaderboard_id, count=count, offset=offset)

    async def get_leaderboard_user_entry(self, leaderboard_id, game_id=None):
        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            return {"needsSettings": True, "error": "Please enter your RetroAchievements username and Web API key.", "payload": None, "changed": False}
        return self.leaderboards_service.get_leaderboard_user_entry(self._active_ra_user(cfg), web_api_key, leaderboard_id, game_id)

    async def get_leaderboard_icons(self, game_id, leaderboard_rows):
        async with self._image_slot():
            return await asyncio.to_thread(self.icon_service.get_leaderboard_icons, game_id, leaderboard_rows)
