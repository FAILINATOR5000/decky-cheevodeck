import asyncio

from mixins._context import PluginContext
from utils import to_int


class StreamPlayMixin(PluginContext):

    async def stream_status(self):
        return await asyncio.to_thread(self.stream_setup.status)

    async def stream_size(self):
        return await asyncio.to_thread(self.stream_setup.size)

    async def stream_set_up(self):
        return await asyncio.to_thread(self.stream_setup.setup)

    async def stream_finish_setup(self, appid: int = 0):
        return await asyncio.to_thread(self.stream_setup.finish, to_int(appid, 0))

    async def stream_update(self):
        return await asyncio.to_thread(self.stream_setup.update)

    async def stream_remove(self):
        return await asyncio.to_thread(self.stream_setup.remove)
