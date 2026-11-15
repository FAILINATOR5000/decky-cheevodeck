import asyncio

from mixins._context import PluginContext
from services.save_backups import clean_game_id


def _choice(value):
    return value if isinstance(value, dict) else None


class SaveBackupsMixin(PluginContext):

    async def save_backups_play_started(self, game_id: int = 0, choice=None):
        game_id = clean_game_id(game_id)
        await self.save_backups.end("play")
        if not game_id:
            return {"ok": False}
        target = await asyncio.to_thread(self.multiplayer_service.play_backup_target, game_id, _choice(choice))
        if target is not None:
            await asyncio.to_thread(self.save_backups.back_up, target, "launch", "play")
            self.save_backups.follow("play", target, "play")
        return {"ok": True}

    async def save_backups_play_ended(self):
        await self.save_backups.end("play")
        return {"ok": True}
