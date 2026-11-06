import asyncio

from mixins._context import PluginContext
from utils import to_int


class StreamPlayMixin(PluginContext):

    async def stream_status(self):
        return await asyncio.to_thread(self.stream_setup.status)

    async def stream_size(self):
        return await asyncio.to_thread(self.stream_setup.size)

    async def stream_set_up(self):
        result = await asyncio.to_thread(self.stream_setup.setup)
        if result.get("ok"):
            await self.multiplayer_service.streaming_ready()
        return result

    async def stream_finish_setup(self, appid: int = 0):
        return await asyncio.to_thread(self.stream_setup.finish, to_int(appid, 0))

    async def stream_update(self):
        return await asyncio.to_thread(self.stream_setup.update)

    async def stream_remove(self):
        result = await asyncio.to_thread(self.stream_setup.remove, self.multiplayer_service.release_sunshine)
        if result.get("ok"):
            self.multiplayer_service.streaming_removed()
        return result
