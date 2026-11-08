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
