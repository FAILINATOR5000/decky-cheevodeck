import asyncio

from mixins._context import PluginContext


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
