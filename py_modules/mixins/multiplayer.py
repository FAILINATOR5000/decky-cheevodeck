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

    async def multiplayer_modes(self, game_id: int = 0, room_id: str = ""):
        return await asyncio.to_thread(self.multiplayer_service.modes, to_int(game_id, 0), str(room_id or ""))

    async def multiplayer_host(
        self, mode: str = "", game_id: int = 0, hardcore: bool = False, core: str = "", share: bool = False,
        name: str = "", size: int = 4, password: str = "", status: str = "", where: str = "local",
        watch: bool = False, friends: bool = False, voice: bool = False, screen: str = "",
    ):
        return await self.multiplayer_service.host(
            str(mode or ""), to_int(game_id, 0), bool(hardcore), str(core or ""), bool(share), str(name or ""),
            min(max(to_int(size, 4), 2), 10), str(password or ""), str(status or ""),
            "online" if where == "online" else "local", bool(watch), bool(friends), voice is True, str(screen or ""),
        )

    async def multiplayer_room_options(self, hardcore=None, core=None, share=None, watch=None, voice=None,
                                       adapter=None):
        return await self.multiplayer_service.room_options(
            None if hardcore is None else bool(hardcore),
            None if core is None else str(core),
            None if share is None else bool(share),
            None if watch is None else bool(watch),
            None if voice is None else bool(voice),
            None if adapter is None else str(adapter),
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

    async def multiplayer_start(self, screen: str = ""):
        return await self.multiplayer_service.start_round(str(screen or ""))

    async def multiplayer_start_cancel(self, error: str = ""):
        return self.multiplayer_service.start_cancel(str(error or ""))

    async def multiplayer_leave(self):
        return self.multiplayer_service.leave()

    async def multiplayer_room_status(self):
        return self.multiplayer_service.room_status()

    async def stream_pad_swap(self):
        return await asyncio.to_thread(self.multiplayer_service.stream_pad_swap)

    async def multiplayer_prepare_launch(self, original: str = "", hardcore: bool = False, screen: str = "",
                                         name: str = ""):
        return await asyncio.to_thread(
            self.multiplayer_service.prepare_launch, str(original or ""), bool(hardcore), str(screen or "")[:16],
            str(name or "")[:256],
        )

    async def multiplayer_launch_started(self):
        return self.multiplayer_service.launch_started()

    async def multiplayer_launch_ended(self):
        return self.multiplayer_service.launch_ended()

    async def multiplayer_status(self):
        return self.multiplayer_service.status()

    async def multiplayer_play_info(self, game_id: int = 0, choice=None):
        return await asyncio.to_thread(self.multiplayer_service.play_info, to_int(game_id, 0), _choice(choice))

    async def multiplayer_prepare_play(self, game_id: int = 0, original: str = "", name: str = "", choice=None):
        return await asyncio.to_thread(
            self.multiplayer_service.prepare_play, to_int(game_id, 0), str(original or ""), str(name or "")[:256],
            _choice(choice),
        )

    async def multiplayer_play_choices(self, game_id: int = 0):
        return await asyncio.to_thread(self.multiplayer_service.play_choices, to_int(game_id, 0))

    async def multiplayer_couch_choices(self, game_id: int = 0):
        return await asyncio.to_thread(self.multiplayer_service.couch_choices, to_int(game_id, 0))

    async def multiplayer_save_play_pick(self, game_id: int = 0, use: str = "", pick=None):
        game_id = to_int(game_id, 0)
        saved = await asyncio.to_thread(self.multiplayer_service.save_play_pick, game_id, str(use or ""), _choice(pick))
        await self.multiplayer_service.refresh_room_pick(game_id)
        return saved

    async def multiplayer_set_stream_pick(self, game_id: int = 0, pick=None, remember: bool = False):
        game_id = to_int(game_id, 0)
        saved = await asyncio.to_thread(
            self.multiplayer_service.set_stream_pick, game_id, _choice(pick), remember is True
        )
        await self.multiplayer_service.refresh_room_pick(game_id)
        return saved

    async def multiplayer_open_in_desktop(self, tool: str = ""):
        return await asyncio.to_thread(self.multiplayer_service.open_in_desktop, str(tool or ""))

    async def multiplayer_restore_record(self):
        return await asyncio.to_thread(self.multiplayer_service.restore_record)

    async def multiplayer_clear_restore(self, session: str = ""):
        return await asyncio.to_thread(self.multiplayer_service.clear_restore, str(session or ""))

    async def multiplayer_voice_join(self, on: bool = False):
        return self.multiplayer_service.voice_join(on is True)

    async def multiplayer_voice_send(self, to: int = 0, kind: str = "", sdp: str = "", gen: int = 0):
        if type(to) is not int or type(gen) is not int or not isinstance(kind, str) or not isinstance(sdp, str):
            return {"ok": False, "error": "seat"}
        return await self.multiplayer_service.voice_send(to, kind, sdp, gen)

    async def multiplayer_voice_canceller(self, on: bool = False):
        return await asyncio.to_thread(self.multiplayer_service.voice_canceller, on is True)

    async def multiplayer_voice_duck(self, on: bool = False, db=-12):
        return self.multiplayer_service.voice_duck(on is True, db)

    async def multiplayer_voice_config(self):
        return self.multiplayer_service.voice_config()

    async def multiplayer_voice_log(self, line: str = "", debug: bool = True):
        text = " ".join(str(line or "").split())[:300]
        if text and (debug is False or getattr(self, "_debug_logging", False)):
            decky.logger.info("voice: %s", text)
        return {"ok": True}

    async def multiplayer_game_streams(self):
        return await asyncio.to_thread(self.multiplayer_service.game_streams)

    async def multiplayer_game_volume_records(self):
        return await asyncio.to_thread(self.multiplayer_service.game_volume_records)

    async def multiplayer_game_volume_record(self, app: str = "", original=None, level=None):
        return await asyncio.to_thread(self.multiplayer_service.game_volume_record, app, original, level)

    async def multiplayer_game_volume_put_back(self, app: str = "", levels=None):
        if not isinstance(levels, list):
            levels = []
        return await asyncio.to_thread(self.multiplayer_service.put_back_game_volume, app, levels[:32])

    async def multiplayer_room_volumes_get(self, game_id: int = 0):
        if type(game_id) is not int:
            return {"ok": False}
        output = await asyncio.to_thread(self.voice_canceller.output)
        levels = await asyncio.to_thread(self.multiplayer_volumes_store.get, game_id, output)
        return {"ok": True, "output": output, **levels}

    async def multiplayer_room_volumes_set(self, game_id: int = 0, game: int = 0, incoming: int = 0, output: str = "",
                                           duck=None, duck_strength=None):
        if type(game_id) is not int or not isinstance(output, str):
            return {"ok": False}
        return {"ok": await asyncio.to_thread(self.multiplayer_volumes_store.set, game_id, game, incoming, output,
                                              duck, duck_strength)}

    async def multiplayer_output_volume_get(self):
        volume = await asyncio.to_thread(self.voice_canceller.output_volume)
        return {"ok": volume is not None, "volume": volume}

    async def multiplayer_output_volume_set(self, volume: int = 0):
        return {"ok": await asyncio.to_thread(self.voice_canceller.set_output_volume, volume)}

    async def multiplayer_debug_voice(self, name: str = "", on: bool = False):
        return self.multiplayer_service.debug_voice(str(name or ""), on is True)

    async def multiplayer_debug_voice_relay(self, on: bool = False):
        return self.multiplayer_service.debug_voice("relay", on is True)

    async def multiplayer_debug_stream_relay(self, on: bool = False):
        return self.multiplayer_service.debug_stream_relay(bool(on))

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


def _choice(value):
    return value if isinstance(value, dict) else None
