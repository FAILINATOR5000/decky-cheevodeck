import asyncio
from utils import norm_game_id

from mixins._context import PluginContext


class GameHashesMixin(PluginContext):

    async def get_game_hashes(self, game_id=None):
        async with self._ra_slot():
            return await asyncio.to_thread(self._get_game_hashes_sync, game_id)

    async def download_game_patch(self, url, dest_dir):
        """Save one compatibility patch where the user pointed.

        No _ra_slot(): this fetches a file from RA's patch repo on GitHub, not
        the rate-limited API, so it's the same lane as CDN media rather than a
        slot-taking task. One user press, one file, a few kilobytes.
        """
        return await asyncio.to_thread(
            self.game_hashes_service.download_patch, url, dest_dir
        )

    def _get_game_hashes_sync(self, game_id):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()

        if not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "results": [],
            }

        game_id_int = norm_game_id(game_id)
        if game_id_int is None:
            return {"results": []}

        return self.game_hashes_service.get_game_hashes(web_api_key, game_id_int)
