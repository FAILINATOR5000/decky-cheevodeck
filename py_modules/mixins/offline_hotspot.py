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

    async def hotspot_set_private(self, private: bool = False):
        return await asyncio.to_thread(self.offline_hotspot_service.set_private, bool(private))

    async def hotspot_leave(self):
        return await asyncio.to_thread(self.offline_hotspot_service.leave)

    async def save_hotspot_dedicated(self, hotspot_dedicated: bool):
        value = self.settings_store.update_hotspot_dedicated(hotspot_dedicated)
        self.offline_hotspot_service.apply_dedicated()
        return {
            "ok": True,
            "hotspotDedicated": value,
        }
