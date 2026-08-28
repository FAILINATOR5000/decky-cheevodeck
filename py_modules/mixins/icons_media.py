import asyncio

from mixins._context import PluginContext


class IconsMediaMixin(PluginContext):

    async def save_show_icons(self, show_icons: bool):
        value = self.settings_store.update_show_icons(show_icons)

        return {
            "ok": True,
            "showIcons": value,
        }

    async def get_achievement_icons(self, game_id=None, badge_names=None):
        async with self._image_slot():
            return await asyncio.to_thread(self.icon_service.get_achievement_icons, game_id, badge_names)

    async def get_award_icons(self, entries=None):
        async with self._image_slot():
            return await asyncio.to_thread(self.icon_service.get_award_icons, entries)

    async def get_game_icon(self, game_id=None, image_icon=None):
        async with self._image_slot():
            return await asyncio.to_thread(self.icon_service.get_game_icon, game_id, image_icon)

    async def get_game_icons(self, entries=None):
        async with self._image_slot():
            return await asyncio.to_thread(self.icon_service.get_game_icons, entries)

    async def get_tab_game_icons(self, entries=None):
        async with self._image_slot():
            return await asyncio.to_thread(self.icon_service.get_tab_game_icons, entries)

    async def cancel_tab_game_icons(self):
        self.icon_service.cancel_tab_game_icons()
        return {"ok": True}

    async def get_game_image(self, game_id=None, kind=None, image_url=None):
        async with self._image_slot():
            return await asyncio.to_thread(self.icon_service.get_game_image, game_id, kind, image_url)

    async def get_user_avatar_cached(self, username=None):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        async with self._image_slot():
            return await asyncio.to_thread(
                self.icon_service.get_user_avatar_cached, username, web_api_key
            )

    async def get_user_avatars_cached(self, usernames=None):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        async with self._image_slot():
            return await asyncio.to_thread(
                self.icon_service.get_user_avatars_cached, usernames, web_api_key
            )
