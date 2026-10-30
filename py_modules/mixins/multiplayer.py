from mixins._context import PluginContext
from utils import to_int


class MultiplayerMixin(PluginContext):

    async def multiplayer_set_visible(self, visible: bool = False, entry: bool = False):
        return await self.multiplayer_service.set_visible(bool(visible), bool(entry))

    async def multiplayer_discover(self):
        return await self.multiplayer_service.discover()

    async def multiplayer_lookup(self, address: str = ""):
        return await self.multiplayer_service.lookup(str(address or "").strip())

    async def multiplayer_host(self, mode: str = "", game_id: int = 0, hardcore: bool = False, private: bool = False):
        return await self.multiplayer_service.host(str(mode or ""), to_int(game_id, 0), bool(hardcore), bool(private))

    async def multiplayer_room_options(self, hardcore=None, private=None):
        return self.multiplayer_service.room_options(
            None if hardcore is None else bool(hardcore),
            None if private is None else bool(private),
        )

    async def multiplayer_close_room(self):
        return self.multiplayer_service.close_room()

    async def multiplayer_drop_seat(self, seat: int = 0):
        return self.multiplayer_service.drop_seat(to_int(seat, 0))

    async def multiplayer_join(self, room_id: str = "", code: str = ""):
        return await self.multiplayer_service.join(str(room_id or ""), str(code or ""))

    async def multiplayer_leave(self):
        return self.multiplayer_service.leave()

    async def multiplayer_room_status(self):
        return self.multiplayer_service.room_status()

    async def multiplayer_launch_started(self):
        return self.multiplayer_service.launch_started()
