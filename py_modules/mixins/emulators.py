import asyncio

from mixins._context import PluginContext


class EmulatorsMixin(PluginContext):

    async def emulators_inventory(self, refresh: bool = False):
        return await asyncio.to_thread(self.emulator_service.inventory, bool(refresh))
