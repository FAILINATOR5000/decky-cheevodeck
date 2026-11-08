import asyncio

from mixins._context import PluginContext
from utils import to_int


class EmulatorsMixin(PluginContext):

    async def emulators_inventory(self, refresh: bool = False):
        return await asyncio.to_thread(self.emulator_service.inventory, bool(refresh))

    async def emulators_identify(self, path: str = ""):
        return await asyncio.to_thread(self.emulator_service.identify, str(path or ""))

    async def emulators_point(self, kind: str = "", path: str = ""):
        return await asyncio.to_thread(self.emulator_service.point, str(kind or ""), str(path or ""))

    async def emulators_forget(self, kind: str = "", path: str = ""):
        return await asyncio.to_thread(self.emulator_service.forget, str(kind or ""), str(path or ""))

    async def emulators_status(self):
        return await asyncio.to_thread(self.emulator_service.status)

    async def emulators_cores_offer(self):
        return await asyncio.to_thread(self.emulator_service.cores_offer)

    async def emulators_install_cores(self, cores=None, target: str = ""):
        return await asyncio.to_thread(self.emulator_service.install_cores, list(cores or []), str(target or ""))

    async def emulators_update_cores(self, cores=None, force: bool = False, skip_newer: bool = False, target: str = ""):
        return await asyncio.to_thread(self.emulator_service.update_cores, list(cores or []), bool(force),
                                       bool(skip_newer), str(target or ""))

    async def emulators_install_flatpak(self, kind: str = "", target: str = ""):
        return await asyncio.to_thread(self.emulator_service.install_flatpak, str(kind or ""), str(target or ""))

    async def emulators_update_flatpak(self, kind: str = "", force: bool = False, target: str = ""):
        return await asyncio.to_thread(self.emulator_service.update_flatpak, str(kind or ""), bool(force),
                                       str(target or ""))

    async def emulators_install_appimage(self, kind: str = "", target: str = ""):
        return await asyncio.to_thread(self.emulator_service.install_appimage, str(kind or ""), str(target or ""))

    async def emulators_update_appimage(self, path: str = "", force: bool = False, target: str = ""):
        return await asyncio.to_thread(self.emulator_service.update_appimage, str(path or ""), bool(force),
                                       str(target or ""))

    async def emulators_record_shortcut(self, key: str = "", appid: int = 0):
        return await asyncio.to_thread(self.emulator_service.record_shortcut, str(key or ""),
                                       to_int(appid, 0))

    async def emulators_forget_shortcut(self, key: str = ""):
        return await asyncio.to_thread(self.emulator_service.forget_shortcut, str(key or ""))

    async def emulators_shortcut_changes(self, kind: str = ""):
        return await asyncio.to_thread(self.multiplayer_service.shortcut_changes, str(kind or ""))

    async def emulators_plan_begin(self):
        return await asyncio.to_thread(self.emulator_service.plan_begin)

    async def emulators_plan_step(self, plan: str = "", step=None, force: bool = False):
        return await asyncio.to_thread(self.emulator_service.plan_step, str(plan or ""), step, bool(force))

    async def emulators_plan_client(self, plan: str = "", undo=None):
        return await asyncio.to_thread(self.emulator_service.plan_client, str(plan or ""), undo)

    async def emulators_plan_end(self, plan: str = ""):
        return await asyncio.to_thread(self.emulator_service.plan_end, str(plan or ""))

    async def emulators_plan_abort(self, plan: str = ""):
        return await asyncio.to_thread(self.emulator_service.plan_abort, str(plan or ""))

    async def emulators_pending_client(self):
        return {"ok": True, "client": await asyncio.to_thread(self.emulator_service.pending_client)}

    async def emulators_clear_pending_client(self):
        await asyncio.to_thread(self.emulator_service.clear_pending_client)
        return {"ok": True}

    async def emulators_plan_abandon(self):
        return await asyncio.to_thread(self.emulator_service.plan_abandon)
