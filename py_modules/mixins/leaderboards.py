import asyncio

from mixins._context import PluginContext


class LeaderboardsMixin(PluginContext):

    async def get_game_leaderboards(self, game_id, force=False):
        if not force:
            cached = await asyncio.to_thread(self._cached_game_leaderboards_sync, game_id)
            if cached is not None:
                return cached
        async with self._ra_slot():
            return await asyncio.to_thread(self._get_game_leaderboards_sync, game_id, bool(force))

    def _cached_game_leaderboards_sync(self, game_id):
        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            return None
        return self.leaderboards_service.cached_game_leaderboards(game_id)

    def _get_game_leaderboards_sync(self, game_id, force):
        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            return {"needsSettings": True, "error": "Please enter your RetroAchievements username and Web API key.", "payload": None, "changed": False}
        return self.leaderboards_service.get_game_leaderboards(web_api_key, game_id, force=force)

    async def get_leaderboard_detail(self, leaderboard_id, count=25, game_id=None):
        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            return {"needsSettings": True, "error": "Please enter your RetroAchievements username and Web API key.", "entries": None, "userEntry": None}
        user = self._active_ra_user(cfg)
        async with self._ra_slot():
            entries, user_entry = await asyncio.gather(
                asyncio.to_thread(self.leaderboards_service.get_leaderboard_entries, web_api_key, leaderboard_id, count, 0),
                asyncio.to_thread(self.leaderboards_service.get_leaderboard_user_entry, user, web_api_key, leaderboard_id, game_id),
            )
        return {"entries": entries, "userEntry": user_entry}

    async def get_leaderboard_icons(self, game_id, leaderboard_rows):
        async with self._image_slot():
            return await asyncio.to_thread(self.icon_service.get_leaderboard_icons, game_id, leaderboard_rows)
