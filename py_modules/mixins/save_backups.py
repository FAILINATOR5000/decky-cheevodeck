import asyncio

from cheevo_check_systems import by_console_id
from mixins._context import PluginContext
from services.game_clock import EXIT_WAIT_SECONDS
from services.save_backups import clean_game_id, emulator_running


def _choice(value):
    return value if isinstance(value, dict) else None


class SaveBackupsMixin(PluginContext):

    async def save_backups_play_started(self, game_id: int = 0, choice=None):
        game_id = clean_game_id(game_id)
        await asyncio.to_thread(self.game_clock.put_back)
        await self.save_backups.end("play")
        if not game_id:
            return {"ok": False}
        await asyncio.to_thread(self.multiplayer_service.check_play_clock, game_id, _choice(choice))
        target = await asyncio.to_thread(self.multiplayer_service.play_backup_target, game_id, _choice(choice))
        if target is not None:
            await asyncio.to_thread(self.save_backups.back_up, target, "launch", "play")
            self.save_backups.follow("play", target, "play")
        return {"ok": True}

    async def save_backups_play_ended(self):
        await asyncio.to_thread(self.game_clock.put_back, EXIT_WAIT_SECONDS)
        await self.save_backups.end("play")
        return {"ok": True}

    def _game_running(self) -> bool:
        session = self.multiplayer_service.status()["session"]
        return (session is not None and session["state"] != "ended") or emulator_running()

    def _backups_info(self, game_id: int) -> dict:
        system_id, system_name = self.multiplayer_service.game_system(game_id)
        if not system_id:
            system_id = self.save_backups.system_of(game_id)
            system = by_console_id(system_id) if system_id else None
            system_name = system.name if system is not None else ""
        settings = self.save_backup_settings_store.get(game_id)
        return {
            "ok": True,
            "groups": self.save_backups.list_game(game_id),
            "interval": settings["interval"],
            "off": settings["off"],
            "systemId": system_id,
            "system": system_name,
            "consoleOff": self.save_backup_settings_store.console_off(system_id),
            "undoable": self.save_backups.restore_backs_up(game_id, system_id),
            "running": self._game_running(),
        }

    async def save_backups_info(self, game_id: int = 0):
        game_id = clean_game_id(game_id)
        if not game_id:
            return {"ok": False}
        return await asyncio.to_thread(self._backups_info, game_id)

    async def save_backups_restore(self, game_id: int = 0, backup_id: str = ""):
        game_id = clean_game_id(game_id)
        if not game_id:
            return {"ok": False, "error": "gone"}
        if await asyncio.to_thread(self._game_running):
            return {"ok": False, "error": "running"}
        return await asyncio.to_thread(self.save_backups.restore, game_id, str(backup_id or "")[:128])

    async def save_backups_clear(self, game_id: int = 0):
        game_id = clean_game_id(game_id)
        return {"ok": bool(game_id) and await asyncio.to_thread(self.save_backups.clear_game, game_id)}

    async def save_backups_set_game(self, game_id: int = 0, interval=None, off=None):
        game_id = clean_game_id(game_id)
        if not game_id or (interval is not None and type(interval) is not int) or (off is not None and type(off) is not bool):
            return {"ok": False}
        saved = await asyncio.to_thread(self.save_backup_settings_store.set, game_id, interval=interval, off=off)
        if saved is None:
            return {"ok": False}
        return {"ok": True, **saved}

    async def clear_all_save_backups(self):
        return {"ok": await asyncio.to_thread(self.save_backups.clear_all)}

    async def save_backups_set_console(self, system_id: int = 0, off: bool = False):
        if type(system_id) is not int or type(off) is not bool:
            return {"ok": False}
        saved = await asyncio.to_thread(self.save_backup_settings_store.set_console, system_id, off)
        return {"ok": saved is not None, "consoleOff": bool(saved)}
