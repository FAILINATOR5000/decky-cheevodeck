import asyncio

from mixins._context import PluginContext


class OfflineHotspotMixin(PluginContext):

    async def hotspot_status(self):
        return self.offline_hotspot_service.status()

    async def hotspot_set(self, on: bool = False, private: bool = False):
        return await asyncio.to_thread(self.offline_hotspot_service.set_on, bool(on), bool(private))

    async def hotspot_scan(self):
        return await asyncio.to_thread(self.offline_hotspot_service.scan)

    async def hotspot_join(self, ssid: str = "", code: str = ""):
        return await asyncio.to_thread(self.offline_hotspot_service.join, str(ssid or ""), str(code or ""))

    async def hotspot_leave(self):
        return await asyncio.to_thread(self.offline_hotspot_service.leave)
