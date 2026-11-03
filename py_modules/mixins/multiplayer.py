import asyncio
import urllib.error

import decky
from mixins._context import PluginContext
from utils import to_int


class MultiplayerMixin(PluginContext):

    async def multiplayer_set_visible(self, visible: bool = False, entry: bool = False):
        return await self.multiplayer_service.set_visible(bool(visible), bool(entry))

    async def multiplayer_discover(self):
        return await self.multiplayer_service.discover()

    async def multiplayer_lookup(self, address: str = ""):
        return await self.multiplayer_service.lookup(str(address or "").strip())

    async def multiplayer_games(self):
        return await asyncio.to_thread(self.multiplayer_service.games)

    async def multiplayer_cores(self, mode: str = "", game_id: int = 0, room_id: str = ""):
        return await asyncio.to_thread(
            self.multiplayer_service.cores, str(mode or ""), to_int(game_id, 0), str(room_id or "")
        )

    async def multiplayer_check(self, mode: str = "", game_id: int = 0, core: str = "", room_id: str = ""):
        return await asyncio.to_thread(
            self.multiplayer_service.check, str(mode or ""), to_int(game_id, 0), str(core or ""), str(room_id or "")
        )

    async def multiplayer_host(
        self, mode: str = "", game_id: int = 0, hardcore: bool = False, core: str = "", share: bool = False,
        name: str = "", size: int = 4, password: str = "", status: str = "", where: str = "local",
        watch: bool = False,
    ):
        return await self.multiplayer_service.host(
            str(mode or ""), to_int(game_id, 0), bool(hardcore), str(core or ""), bool(share), str(name or ""),
            min(max(to_int(size, 4), 2), 10), str(password or ""), str(status or ""),
            "online" if where == "online" else "local", bool(watch),
        )

    async def multiplayer_room_options(self, hardcore=None, core=None, share=None, watch=None):
        return await self.multiplayer_service.room_options(
            None if hardcore is None else bool(hardcore),
            None if core is None else str(core),
            None if share is None else bool(share),
            None if watch is None else bool(watch),
        )

    async def multiplayer_change_game(self, mode: str = "", game_id: int = 0, core: str = ""):
        return await self.multiplayer_service.change_game(str(mode or ""), to_int(game_id, 0), str(core or ""))

    async def multiplayer_guest_games(self):
        return await asyncio.to_thread(self.multiplayer_service.guest_games)

    async def multiplayer_guest_game(self, game_id: int = 0):
        return await self.multiplayer_service.guest_game(to_int(game_id, 0))

    async def multiplayer_close_room(self):
        return self.multiplayer_service.close_room()

    async def multiplayer_drop_seat(self, seat: int = 0, name: str = ""):
        return self.multiplayer_service.drop_seat(to_int(seat, 0), str(name or ""))

    async def multiplayer_join(self, room_id: str = "", password: str = "", hardcore: bool = False):
        return await self.multiplayer_service.join(str(room_id or ""), str(password or ""), bool(hardcore))

    async def multiplayer_set_ready(self, ready: bool = False, reason: str = ""):
        return self.multiplayer_service.set_ready(bool(ready), str(reason or ""))

    async def multiplayer_say(self, text: str = ""):
        return await self.multiplayer_service.say(str(text or ""))

    async def multiplayer_start(self):
        return self.multiplayer_service.start()

    async def multiplayer_start_cancel(self, error: str = ""):
        return self.multiplayer_service.start_cancel(str(error or ""))

    async def multiplayer_leave(self):
        return self.multiplayer_service.leave()

    async def multiplayer_room_status(self):
        return self.multiplayer_service.room_status()

    async def multiplayer_prepare_launch(self, original: str = "", hardcore: bool = False):
        return await asyncio.to_thread(
            self.multiplayer_service.prepare_launch, str(original or ""), bool(hardcore)
        )

    async def multiplayer_launch_started(self):
        return self.multiplayer_service.launch_started()

    async def multiplayer_launch_ended(self):
        return self.multiplayer_service.launch_ended()

    async def multiplayer_status(self):
        return self.multiplayer_service.status()

    async def multiplayer_restore_record(self):
        return await asyncio.to_thread(self.multiplayer_service.restore_record)

    async def multiplayer_clear_restore(self, session: str = ""):
        return await asyncio.to_thread(self.multiplayer_service.clear_restore, str(session or ""))

    async def multiplayer_debug_server_door(self, on: bool = False):
        return self.multiplayer_service.debug_server_door(bool(on))

    async def multiplayer_debug_proc(self):
        return await asyncio.to_thread(self.multiplayer_service.debug_processes)

    async def multiplayer_friends(self):
        return self.multiplayer_friends_service.state()

    async def multiplayer_friend_add(self, name: str = ""):
        name = str(name or "").strip()
        if not name or len(name) > 32:
            return {"ok": False, "error": "no_user"}
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        try:
            async with self._ra_slot():
                profile = await asyncio.to_thread(self.ra.get_user_profile, name, web_api_key)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"ok": False, "error": "no_user"}
            return {"ok": False, "error": "ra_unreachable"}
        except Exception as e:
            decky.logger.warning("friends: the RetroAchievements lookup failed (%s)", type(e).__name__)
            return {"ok": False, "error": "ra_unreachable"}
        return await self.multiplayer_friends_service.add_profile(name, profile)

    async def multiplayer_friend_add_seat(self, seat: int = 0, ulid: str = ""):
        return await self.multiplayer_friends_service.add_seat(to_int(seat, 0), str(ulid or ""))

    async def multiplayer_friend_answer(self, ulid: str = "", accept: bool = False):
        return await self.multiplayer_friends_service.answer(str(ulid or ""), bool(accept))

    async def multiplayer_friend_remove(self, ulid: str = ""):
        return await self.multiplayer_friends_service.remove(str(ulid or ""))

    async def multiplayer_running_app(self, name: str = ""):
        self.multiplayer_friends_service.running_app(str(name or ""))
        return {"ok": True}

    async def multiplayer_friend_dismiss(self, ulid: str = ""):
        return await asyncio.to_thread(self.multiplayer_friends_service.dismiss, str(ulid or ""))

    async def multiplayer_friend_messages(self, ulid: str = ""):
        return await asyncio.to_thread(self.multiplayer_friends_service.messages, str(ulid or ""))

    async def multiplayer_friend_send(self, ulid: str = "", text: str = ""):
        return await self.multiplayer_friends_service.send_message(str(ulid or ""), str(text or ""))

    async def multiplayer_friend_invite(self, ulid: str = ""):
        return await self.multiplayer_friends_service.invite(str(ulid or ""))

    async def multiplayer_friend_join(self, ulid: str = "", password: str = "", hardcore: bool = False):
        return await self.multiplayer_friends_service.join_friend(str(ulid or ""), str(password or ""),
                                                                  bool(hardcore))

    async def multiplayer_accept_invite(self, invite: str = "", hardcore: bool = False):
        return await self.multiplayer_friends_service.accept_invite(str(invite or ""), bool(hardcore))

    async def multiplayer_friend_alert(self, device: str = "", revoke: bool = False):
        return await self.multiplayer_friends_service.alert(str(device or ""), bool(revoke))

    async def multiplayer_friend_avatars(self, pics=None, fetch=True):
        wanted = [str(pic) for pic in pics or [] if isinstance(pic, str)][:100]
        async with self._image_slot():
            return await asyncio.to_thread(self.icon_service.get_pic_avatars, wanted, fetch is not False)
