import asyncio
import time
import decky

from mixins._context import PluginContext


class NewsEventsMixin(PluginContext):

    async def get_news_feed(self):
        return await asyncio.to_thread(self._get_news_feed_sync)

    def _get_news_feed_sync(self):
        return self.news_service.get_news_feed()

    async def get_achievement_of_the_week(self):
        debug_on = bool(getattr(self, "_debug_logging", False))
        wait_start = time.monotonic() if debug_on else 0.0
        async with self._ra_slot():
            if debug_on:
                wait_ms = (time.monotonic() - wait_start) * 1000.0
                decky.logger.info("aotw ipc: semaphore wait %.0fms", wait_ms)
            return await asyncio.to_thread(self._get_achievement_of_the_week_sync)

    def _get_achievement_of_the_week_sync(self):
        cfg = self.settings_store.load_config()
        username = str(cfg.get("username", "")).strip()
        user_ref = self._active_ra_user(cfg)
        web_api_key = str(cfg.get("webApiKey", "")).strip()

        if not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": None,
                "comments": [],
                "currentUserHasUnlocked": False,
                "fromCache": False,
            }

        return self.aotw_service.get_achievement_of_the_week(user_ref, web_api_key, username)

    async def get_new_sets_and_revisions(self, filter: str = "new"):
        async with self._ra_slot():
            return await asyncio.to_thread(self._get_new_sets_and_revisions_sync, filter)

    def _get_new_sets_and_revisions_sync(self, filter_key):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()

        if not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": [],
                "fromCache": False,
                "filter": "revision" if filter_key == "revision" else "new",
            }

        return self.new_sets_service.get_new_sets_and_revisions(web_api_key, filter_key)
