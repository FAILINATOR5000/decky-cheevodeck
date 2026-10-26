import asyncio

from mixins._context import PluginContext
from services import data_transfer_service, nearby_transfer_service


class DataTransferMixin(PluginContext):

    async def discover_data_devices(self):
        return await self.nearby_transfer_service.discover_data()

    async def start_data_import(self, device_id: str = "", kind: str = "", mode: str = "merge"):
        if kind not in data_transfer_service.KINDS:
            return {"ok": False, "error": nearby_transfer_service.ERROR_UNAVAILABLE}
        mode = "replace" if kind == "milestones" or mode == "replace" else "merge"
        return await self.nearby_transfer_service.start_data_pull(str(device_id or ""), kind, mode)

    async def data_transfer_status(self):
        return self.data_transfer_service.status()

    async def cancel_data_transfer(self):
        return self.data_transfer_service.cancel()

    async def get_data_transfer_local_summary(self):
        summary = await asyncio.to_thread(self.data_transfer_service.summary)
        return {"ok": True, **summary}
