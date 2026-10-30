import asyncio
import os
import re
import secrets
import socket
import time
from collections import deque
from pathlib import Path

import decky
import multiplayer_protocol as proto
from nearby_protocol import FrameError, clean_title, decode, frame, is_nonce, read_frame, verify
from utils import load_json_file

LEASE_SECONDS = 30
VISIT_CAP_SECONDS = 600

SEEK_SECONDS = 1.2
SEEK_SENDS = 3
MISSED_ROUNDS = 2

HANDSHAKE_SECONDS = 5
MAX_HANDSHAKES = 4
ANSWERS_PER_SECOND = 10

POLL_SECONDS = 2
POLL_FAILURES = 3
SEAT_SILENCE_SECONDS = 30

HANDOFF_SECONDS = 300
HOUSEKEEPING_SECONDS = 5

BAD_TAGS_PER_ADDRESS = 3
LOCKOUT_SECONDS = 60
BAD_TAGS_PER_ROOM = 10

SESSION_DIR = "multiplayer"
RESTORE_RECORD = "multiplayer_restore.json"

ERROR_NOT_GAME_MODE = "not_game_mode"
ERROR_NO_ACCOUNT = "no_account"
ERROR_NOT_VISIBLE = "not_visible"
ERROR_CAP_REACHED = "cap_reached"
ERROR_UNAVAILABLE = "unavailable"
ERROR_BUSY = "busy"
ERROR_NO_GAME = "no_game"
ERROR_NO_ROOM = "no_room"
ERROR_ROOM_GONE = "room_gone"
ERROR_NEEDS_CODE = "needs_code"
ERROR_BAD_CODE = "bad_code"
ERROR_LOCKED_OUT = "locked_out"
ERROR_FULL = "full"
ERROR_STARTED = "started"
ERROR_WRONG_CORE = "wrong_core"
ERROR_BAD_ADDRESS = "bad_address"
ERROR_NOT_FOUND = "not_found"
ERROR_HOST_GONE = "host_gone"
ERROR_DROPPED = "dropped"
ERROR_CLOSED = "closed"
ERROR_NETWORK_CHANGED = "network_changed"
ERROR_NO_GUESTS = "no_guests"
ERROR_SEATED = "seated"

_JOIN_REFUSALS = {
    "bad_code": ERROR_BAD_CODE,
    "locked": ERROR_LOCKED_OUT,
    "full": ERROR_FULL,
    "started": ERROR_STARTED,
    "core": ERROR_WRONG_CORE,
    "closed": ERROR_ROOM_GONE,
}

_SESSION_ID = re.compile(r"session-([0-9a-f]{16})\.")

PLUGIN_VERSION = str(getattr(decky, "DECKY_PLUGIN_VERSION", "") or "").strip()

GB_SYSTEMS = (4, 6)
PSP_SYSTEM = 41


class _Responder(asyncio.DatagramProtocol):
    def __init__(self, service):
        self._service = service
        self._transport = None
        self.closed = asyncio.get_running_loop().create_future()

    def connection_made(self, transport):
        self._transport = transport

    def datagram_received(self, data, addr):
        self._service._heard(self._transport, data, addr)

    def error_received(self, exc):
        pass

    def connection_lost(self, _exc):
        if not self.closed.done():
            self.closed.set_result(None)


class _Collector(asyncio.DatagramProtocol):
    def __init__(self, on_datagram):
        self._on_datagram = on_datagram

    def datagram_received(self, data, addr):
        self._on_datagram(data, addr)

    def error_received(self, exc):
        pass


class MultiplayerService:
    def __init__(
        self, *, settings_store, game_mode, user_home, runtime_dir, cheevo_check_service, cheevo_check_store,
        port: int = proto.PORT, peer_port: int = proto.PORT, broadcast: str = "255.255.255.255",
    ):
        self._settings_store = settings_store
        self._game_mode = game_mode
        self._user_home = Path(user_home)
        self._session_dir = Path(runtime_dir) / SESSION_DIR
        self._cheevo_check = cheevo_check_service
        self._cheevo_check_store = cheevo_check_store
        self._port = port
        self._peer_port = peer_port
        self._broadcast = broadcast

        self._loop = None
        self._lock = asyncio.Lock()
        self._visible_until = 0.0
        self._cap_until = 0.0
        self._expiry = None

        self._udp = None
        self._responder = None
        self._server = None
        self._closing = []
        self._seen = {}
        self._answered = deque()
        self._handshakes = 0

        self._room = None
        self._closed_reason = ""
        self._joined = None
        self._rooms = {}
        self._round = 0

        self._housekeeper = None
        self._poller = None
        self._tasks = set()
        self._swept = False

    def set_event_loop(self, loop) -> None:
        self._loop = loop
        if not self._swept:
            self._swept = True
            loop.run_in_executor(None, self._startup_sweep)

    def _live(self) -> bool:
        return time.monotonic() < self._visible_until

    def _user(self) -> str:
        cfg = self._settings_store.load_config()
        return proto.clean_user(cfg.get("username") or "")

    def _refusal(self):
        if not self._game_mode():
            return ERROR_NOT_GAME_MODE
        if not self._user():
            return ERROR_NO_ACCOUNT
        if not self._live():
            return ERROR_NOT_VISIBLE
        return None

    async def set_visible(self, visible: bool, entry: bool = False) -> dict:
        async with self._lock:
            if not visible:
                if self._live():
                    decky.logger.info("multiplayer: the page was left")
                self._end_visit()
                return {"ok": True, "visible": False}
            if not self._game_mode():
                self.close()
                return {"ok": False, "error": ERROR_NOT_GAME_MODE}
            if not self._user():
                self.close()
                return {"ok": False, "error": ERROR_NO_ACCOUNT}

            now = time.monotonic()
            if entry:
                self._cap_until = now + VISIT_CAP_SECONDS
            elif now >= self._cap_until:
                if self._live():
                    decky.logger.info("multiplayer: the visit reached its cap")
                self._end_visit()
                return {"ok": False, "error": ERROR_CAP_REACHED}

            self._visible_until = min(now + LEASE_SECONDS, self._cap_until)
            if self._expiry is not None:
                self._expiry.cancel()
            self._expiry = asyncio.get_running_loop().call_later(
                max(0.0, self._visible_until - now), self._lease_ran_out
            )
            return {"ok": True, "visible": True}

    def _lease_ran_out(self) -> None:
        self._expiry = None
        decky.logger.info("multiplayer: the lease ran out")
        self._visible_until = 0.0
        self._wind_down()

    def _end_visit(self) -> None:
        if self._expiry is not None:
            self._expiry.cancel()
            self._expiry = None
        self._visible_until = 0.0
        self._cap_until = 0.0
        self._wind_down()

    def _wind_down(self) -> None:
        self._rooms.clear()
        if self._room is not None and self._room["state"] == "lobby":
            self._close_room("")
        self._drop_joined(tell_host=True)

    def close(self) -> None:
        if self._expiry is not None:
            self._expiry.cancel()
            self._expiry = None
        self._visible_until = 0.0
        self._cap_until = 0.0
        self._rooms.clear()
        if self._room is not None:
            self._close_room("")
        self._drop_joined(tell_host=True)

    def sync(self) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self._follow_mode)

    def _follow_mode(self) -> None:
        if not self._game_mode() and (self._live() or self._room is not None or self._joined is not None):
            decky.logger.info("multiplayer: left Game Mode, closing")
            self.close()

    def account_changed(self) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self.close)

    def stop(self) -> None:
        self.close()
        for task in list(self._tasks):
            task.cancel()

    def _spawn(self, coro):
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def _open(self) -> bool:
        loop = asyncio.get_running_loop()
        closing, self._closing = self._closing, []
        for closed in closing:
            try:
                await asyncio.wait_for(asyncio.shield(closed), 1.0)
            except asyncio.TimeoutError:
                pass
        try:
            self._udp, self._responder = await loop.create_datagram_endpoint(
                lambda: _Responder(self), local_addr=("0.0.0.0", self._port)
            )
            self._server = await asyncio.start_server(
                self._serve, host="0.0.0.0", port=self._port, reuse_address=True, backlog=8
            )
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't listen on port %s (%s)", self._port, type(e).__name__)
            self._shut()
            return False
        return True

    def _shut(self) -> None:
        udp, server = self._udp, self._server
        if self._responder is not None:
            self._closing.append(self._responder.closed)
        self._udp = None
        self._responder = None
        self._server = None
        self._answered.clear()
        if udp is not None:
            try:
                udp.close()
            except Exception as e:
                decky.logger.warning("multiplayer: the responder would not close (%s)", type(e).__name__)
        if server is not None:
            try:
                server.close()
            except Exception as e:
                decky.logger.warning("multiplayer: the listener would not close (%s)", type(e).__name__)

    def _debug(self, message: str, *args) -> None:
        try:
            on = self._settings_store.get_debug_logging(self._settings_store.load_config())
        except Exception:
            on = False
        if on:
            decky.logger.info("multiplayer: " + message, *args)

    def _describe_game(self, mode: str, game_id: int):
        results = self._cheevo_check_store.load_results() or {}
        for game in results.get("supportedGames") or []:
            if not isinstance(game, dict) or game.get("gameId") != game_id:
                continue
            system_id = game.get("systemId")
            if type(system_id) is not int:
                return None
            if mode == "link" and system_id not in GB_SYSTEMS and system_id != PSP_SYSTEM:
                return None
            hashes = [row.get("raHash") for row in game.get("files") or [] if isinstance(row, dict)]
            return {
                "title": clean_title(str(game.get("title") or "")) or str(game_id),
                "gameId": game_id,
                "systemId": system_id,
                "emulator": "ppsspp" if system_id == PSP_SYSTEM else "retroarch",
                "core": "",
                "coreName": "",
                "emuVersion": "",
                "hash": next((h for h in hashes if isinstance(h, str) and len(h) == 32), ""),
                "crc": "",
            }
        return None

    async def host(self, mode: str, game_id: int, hardcore: bool, private: bool) -> dict:
        async with self._lock:
            refused = self._refusal()
            if refused is not None:
                return {"ok": False, "error": refused}
            if self._room is not None or self._joined is not None:
                return {"ok": False, "error": ERROR_BUSY}
            if mode not in proto.MODES:
                return {"ok": False, "error": ERROR_NO_GAME}
            game = await asyncio.to_thread(self._describe_game, mode, game_id)
            if game is None:
                return {"ok": False, "error": ERROR_NO_GAME}

            seats = 2 if mode == "link" and game["emulator"] == "retroarch" else proto.MAX_SEATS
            user = self._user()
            room = {
                **game,
                "id": secrets.token_hex(8),
                "code": _new_code() if private else "",
                "user": user,
                "mode": mode,
                "hardcore": bool(hardcore),
                "private": bool(private),
                "max": seats,
                "seats": [{"name": user, "host": True}] + [None] * (seats - 1),
                "state": "lobby",
                "handoffUntil": 0.0,
                "badAddresses": {},
                "badTotal": 0,
                "pv": PLUGIN_VERSION,
            }
            if not await self._open():
                return {"ok": False, "error": ERROR_UNAVAILABLE}
            self._room = room
            self._closed_reason = ""
            self._seen.clear()
            self._housekeeper = self._spawn(self._keep_house(room))
            decky.logger.info(
                "multiplayer: hosting %s, %s, %s seats%s", game["gameId"], mode, seats, ", private" if private else ""
            )
            return {"ok": True, "room": self._host_view(room)}

    def room_options(self, hardcore=None, private=None) -> dict:
        room = self._room
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if _guests(room):
            return {"ok": False, "error": ERROR_SEATED}
        if hardcore is not None:
            room["hardcore"] = bool(hardcore)
        if private is not None and bool(private) != room["private"]:
            room["private"] = bool(private)
            room["code"] = _new_code() if private else ""
            room["badAddresses"].clear()
            room["badTotal"] = 0
        return {"ok": True, "room": self._host_view(room)}

    def close_room(self) -> dict:
        if self._room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        self._close_room("")
        return {"ok": True}

    def drop_seat(self, seat: int) -> dict:
        room = self._room
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if type(seat) is not int or not 1 <= seat < room["max"] or room["seats"][seat] is None:
            return {"ok": False, "error": ERROR_DROPPED}
        decky.logger.info("multiplayer: dropped seat %s", seat)
        room["seats"][seat] = None
        return {"ok": True, "room": self._host_view(room)}

    def _close_room(self, reason: str) -> None:
        room = self._room
        if room is None:
            return
        self._room = None
        self._closed_reason = reason
        if self._housekeeper is not None:
            self._housekeeper.cancel()
            self._housekeeper = None
        self._shut()
        decky.logger.info("multiplayer: room closed%s", f" ({reason})" if reason else "")

    def _host_view(self, room: dict) -> dict:
        return {
            "id": room["id"],
            "code": room["code"],
            "mode": room["mode"],
            "title": room["title"],
            "gameId": room["gameId"],
            "systemId": room["systemId"],
            "emulator": room["emulator"],
            "core": room["core"],
            "coreName": room["coreName"],
            "hardcore": room["hardcore"],
            "private": room["private"],
            "max": room["max"],
            "seats": [{"name": seat["name"], "launched": bool(seat.get("launched"))} if seat else None
                      for seat in room["seats"]],
            "state": self._public_state(room),
            "handoff": room["state"] == "handoff",
        }

    def _public_state(self, room: dict) -> str:
        if room["state"] == "lobby":
            return "lobby"
        if _listening(proto.game_port(room["mode"], room["emulator"])):
            return "playing"
        return "starting"

    async def _keep_house(self, room: dict) -> None:
        while self._room is room:
            await asyncio.sleep(HOUSEKEEPING_SECONDS)
            if self._room is not room:
                return
            try:
                self._tidy(room)
            except Exception as e:
                decky.logger.warning("multiplayer: housekeeping failed (%s)", type(e).__name__)

    def _tidy(self, room: dict) -> None:
        now = time.monotonic()
        for index, seat in enumerate(room["seats"]):
            if index == 0 or seat is None or seat.get("launched"):
                continue
            if now - seat["last"] > SEAT_SILENCE_SECONDS:
                decky.logger.info("multiplayer: seat %s went quiet, dropped", index)
                room["seats"][index] = None

        for address in {seat["ip"] for seat in _guests(room)}:
            if not _address_exists(address):
                decky.logger.info("multiplayer: this device no longer has %s", address)
                self._close_room(ERROR_NETWORK_CHANGED)
                return

        if room["state"] != "handoff":
            return
        if not _guests(room):
            decky.logger.info("multiplayer: handoff over, no guests left")
            self._close_room("")
        elif all(seat.get("launched") for seat in _guests(room)):
            decky.logger.info("multiplayer: handoff over, every seat launched")
            self._close_room("")
        elif now >= room["handoffUntil"]:
            decky.logger.info("multiplayer: handoff over, timed out")
            self._close_room("")

    def launch_started(self) -> dict:
        room = self._room
        if room is not None:
            if room["state"] != "lobby":
                return {"ok": True}
            if not _guests(room):
                return {"ok": False, "error": ERROR_NO_GUESTS}
            room["state"] = "handoff"
            room["handoffUntil"] = time.monotonic() + HANDOFF_SECONDS
            decky.logger.info("multiplayer: host launched, handing off to %s guests", len(_guests(room)))
            return {"ok": True}
        joined = self._joined
        if joined is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if not joined["launched"]:
            joined["launched"] = True
            if self._poller is not None:
                self._poller.cancel()
                self._poller = None
            self._spawn(self._ask(joined, "launched"))
            decky.logger.info("multiplayer: joined game launched")
        return {"ok": True}

    def _heard(self, transport, data, addr) -> None:
        room = self._room
        if room is None or room["state"] != "lobby":
            return
        nonce = proto.read_seek(decode(data), time.time())
        if nonce is None:
            return
        now = time.monotonic()
        self._forget_old_nonces(now)
        if nonce in self._seen:
            return
        self._seen[nonce] = now
        while self._answered and now - self._answered[0] > 1.0:
            self._answered.popleft()
        if len(self._answered) >= ANSWERS_PER_SECOND:
            return
        self._answered.append(now)
        try:
            transport.sendto(proto.make_room(room, nonce), addr)
        except OSError:
            pass

    def _forget_old_nonces(self, now: float) -> None:
        for seen, at in list(self._seen.items()):
            if now - at > proto.CLOCK_SKEW_SECONDS:
                del self._seen[seen]

    async def _serve(self, reader, writer) -> None:
        if self._room is None or self._handshakes >= MAX_HANDSHAKES:
            writer.close()
            return
        self._handshakes += 1
        try:
            await asyncio.wait_for(self._answer(reader, writer), HANDSHAKE_SECONDS)
        except (asyncio.TimeoutError, asyncio.IncompleteReadError, OSError, FrameError):
            pass
        except Exception as e:
            decky.logger.exception("multiplayer: a request failed (%s)", type(e).__name__)
        finally:
            self._handshakes -= 1
            writer.close()

    async def _answer(self, reader, writer) -> None:
        opening = await read_frame(reader)
        hello = proto.read_hello(opening)
        room = self._room
        if hello is None or room is None:
            return
        op, nc = hello
        if op == "info":
            if room["state"] == "lobby":
                await _say(writer, proto.room_body(room))
            return
        if op == "join":
            await self._admit(reader, writer, room, nc)
            return
        await self._seat_request(writer, room, opening)

    async def _admit(self, reader, writer, room: dict, nc: str) -> None:
        peer = (writer.get_extra_info("peername") or ("",))[0]
        now = time.monotonic()
        if self._locked_out(room, peer, now):
            await _say(writer, {"ok": False, "error": "locked"})
            return
        ns = secrets.token_hex(16)
        await _say(writer, {"ns": ns, "room": room["id"]})
        request = await read_frame(reader)
        raw = request.get("params")
        params = proto.read_join_params(raw)
        if params is None:
            return
        if self._room is not room:
            await _say(writer, {"ok": False, "error": "closed"})
            return
        key = proto.room_key(room["code"], room["id"])
        if not verify(key, request.get("t"), "join", nc, ns, room["id"], proto.canonical(raw)):
            self._bad_tag(room, peer, now)
            await _say(writer, {"ok": False, "error": "bad_code"})
            return
        if room["state"] != "lobby":
            await _say(writer, {"ok": False, "error": "started"})
            return
        if room["core"] and params["core"] != room["core"]:
            await _say(writer, {"ok": False, "error": "core"})
            return
        seat = next((index for index, taken in enumerate(room["seats"]) if taken is None), None)
        if seat is None:
            await _say(writer, {"ok": False, "error": "full"})
            return
        address = (writer.get_extra_info("sockname") or ("",))[0]
        if not proto.is_ipv4(address):
            return
        room["seats"][seat] = {
            "name": params["user"],
            "peer": peer,
            "ip": address,
            "key": proto.seat_key(key, nc, ns),
            "last": now,
            "launched": False,
        }
        await _say(writer, {"ok": True, "seat": seat, "ip": address, "t": proto.joined_tag(key, nc, ns, seat, address)})
        decky.logger.info("multiplayer: seat %s taken", seat)

    def _locked_out(self, room: dict, peer: str, now: float) -> bool:
        entry = room["badAddresses"].get(peer)
        return entry is not None and entry[1] > now

    def _bad_tag(self, room: dict, peer: str, now: float) -> None:
        count, until = room["badAddresses"].get(peer, (0, 0.0))
        count += 1
        if count >= BAD_TAGS_PER_ADDRESS:
            room["badAddresses"][peer] = (0, now + LOCKOUT_SECONDS)
            decky.logger.info("multiplayer: too many wrong codes from one device, locked out for %ss", LOCKOUT_SECONDS)
        else:
            room["badAddresses"][peer] = (count, until)
        room["badTotal"] += 1
        if room["badTotal"] >= BAD_TAGS_PER_ROOM:
            room["code"] = _new_code()
            room["badTotal"] = 0
            decky.logger.info("multiplayer: too many wrong codes, the room code changed")

    async def _seat_request(self, writer, room: dict, message: dict) -> None:
        parsed = proto.read_tagged(message)
        if parsed is None:
            return
        room_id, index, nonce, _stamp = parsed
        if room_id != room["id"]:
            await _say(writer, {"ok": False, "error": "closed"})
            return
        seat = room["seats"][index] if index < room["max"] else None
        if seat is None:
            await _say(writer, {"ok": False, "error": "dropped"})
            return
        if not proto.tagged_ok(seat["key"], message, time.time()):
            return
        now = time.monotonic()
        self._forget_old_nonces(now)
        if nonce in self._seen:
            return
        self._seen[nonce] = now
        seat["last"] = now

        op = message["op"]
        if op == "leave":
            room["seats"][index] = None
            decky.logger.info("multiplayer: seat %s left", index)
            await _say(writer, {"ok": True})
            return
        if op == "launched":
            seat["launched"] = True
            decky.logger.info("multiplayer: seat %s launched", index)
            await _say(writer, {"ok": True})
            return
        body = {
            "ok": True,
            "seat": index,
            "state": self._public_state(room),
            "members": [taken["name"] if taken else "" for taken in room["seats"]],
            "hardcore": room["hardcore"],
            "ip": seat["ip"],
        }
        await _say(writer, proto.status_reply(seat["key"], nonce, body))

    async def _collect(self, packet: bytes, read) -> dict:
        found = {}

        def heard(data, addr):
            row = read(decode(data))
            if row is not None:
                row["address"] = addr[0]
                found[row["room"]] = row

        transport = None
        try:
            transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(
                lambda: _Collector(heard), local_addr=("0.0.0.0", 0), allow_broadcast=True
            )
            gap = SEEK_SECONDS / SEEK_SENDS
            for _ in range(SEEK_SENDS):
                for target in self._broadcast_targets():
                    transport.sendto(packet, (target, self._peer_port))
                await asyncio.sleep(gap)
        except OSError as e:
            decky.logger.info("multiplayer: couldn't ask the network (%s)", type(e).__name__)
        finally:
            if transport is not None:
                transport.close()
        return found

    def _broadcast_targets(self) -> list:
        return [self._broadcast]

    async def discover(self) -> dict:
        refused = self._refusal()
        if refused is not None:
            return {"ok": False, "error": refused}
        nonce = secrets.token_hex(16)
        self._seen[nonce] = time.monotonic()
        found = await self._collect(
            proto.make_seek(nonce, int(time.time())),
            lambda message: proto.read_room(message, nonce),
        )
        self._round += 1
        own = self._room["id"] if self._room is not None else None
        for room_id, row in found.items():
            if room_id != own:
                self._rooms[room_id] = (row, self._round, False)
        for room_id, (_row, seen, manual) in list(self._rooms.items()):
            if not manual and self._round - seen >= MISSED_ROUNDS:
                del self._rooms[room_id]
        self._debug("discovery round %s found %s", self._round, len(found))
        return {"ok": True, "rooms": self._room_rows()}

    def _room_rows(self) -> list:
        rows = [dict(row) for row, _seen, _manual in self._rooms.values()]
        return sorted(rows, key=lambda row: (row["user"].lower(), row["room"]))

    async def lookup(self, address: str) -> dict:
        refused = self._refusal()
        if refused is not None:
            return {"ok": False, "error": refused}
        if not proto.is_ipv4(address):
            return {"ok": False, "error": ERROR_BAD_ADDRESS}
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(address, self._peer_port), HANDSHAKE_SECONDS
            )
        except (OSError, asyncio.TimeoutError):
            return {"ok": False, "error": ERROR_NOT_FOUND}
        try:
            writer.write(frame({"op": "info", "v": proto.VERSION}))
            await asyncio.wait_for(writer.drain(), HANDSHAKE_SECONDS)
            row = proto.read_room(await asyncio.wait_for(read_frame(reader), HANDSHAKE_SECONDS))
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError):
            row = None
        finally:
            writer.close()
        if row is None:
            return {"ok": False, "error": ERROR_NOT_FOUND}
        row["address"] = address
        self._rooms[row["room"]] = (row, self._round, True)
        return {"ok": True, "room": dict(row)}

    def _join_params(self, row: dict) -> dict:
        return proto.join_params(self._user(), "", "", row["core"], "")

    async def join(self, room_id: str, code: str) -> dict:
        async with self._lock:
            refused = self._refusal()
            if refused is not None:
                return {"ok": False, "error": refused}
            if self._room is not None or self._joined is not None:
                return {"ok": False, "error": ERROR_BUSY}
            seen = self._rooms.get(room_id)
            if seen is None:
                return {"ok": False, "error": ERROR_ROOM_GONE}
            row = dict(seen[0])
            if row["private"] and not proto.is_code(code):
                return {"ok": False, "error": ERROR_NEEDS_CODE}
            params = await asyncio.to_thread(self._join_params, row)
            try:
                answer = await asyncio.wait_for(
                    self._ask_to_join(row, code if row["private"] else "", params), HANDSHAKE_SECONDS * 2
                )
            except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError):
                answer = {"ok": False, "error": ERROR_HOST_GONE}
            if not answer["ok"]:
                return answer
            self._joined = {
                "row": row,
                "seat": answer["seat"],
                "ip": answer["ip"],
                "key": answer["key"],
                "status": None,
                "failures": 0,
                "launched": False,
                "error": "",
            }
            self._closed_reason = ""
            self._poller = self._spawn(self._poll(self._joined))
            decky.logger.info("multiplayer: joined a room, seat %s", answer["seat"])
            return {"ok": True, **self._guest_view(self._joined)}

    async def _ask_to_join(self, row: dict, code: str, params: dict) -> dict:
        nc = secrets.token_hex(16)
        reader, writer = await asyncio.open_connection(row["address"], self._peer_port)
        try:
            writer.write(frame({"op": "join", "v": proto.VERSION, "nc": nc}))
            await writer.drain()
            hello = await read_frame(reader)
            if hello.get("ok") is False:
                return {"ok": False, "error": _JOIN_REFUSALS.get(hello.get("error"), ERROR_HOST_GONE)}
            ns = hello.get("ns")
            if not is_nonce(ns) or hello.get("room") != row["room"]:
                return {"ok": False, "error": ERROR_ROOM_GONE}
            key = proto.room_key(code, row["room"])
            writer.write(frame({"op": "join", "params": params, "t": proto.join_tag(key, nc, ns, row["room"], params)}))
            await writer.drain()
            answer = await read_frame(reader)
        finally:
            writer.close()
        if answer.get("ok") is not True:
            return {"ok": False, "error": _JOIN_REFUSALS.get(answer.get("error"), ERROR_HOST_GONE)}
        seat = answer.get("seat")
        address = answer.get("ip")
        if (
            type(seat) is not int
            or not 1 <= seat < proto.MAX_SEATS
            or not proto.is_ipv4(address)
            or not verify(key, answer.get("t"), "joined", nc, ns, str(seat), address)
        ):
            return {"ok": False, "error": ERROR_HOST_GONE}
        return {"ok": True, "seat": seat, "ip": address, "key": proto.seat_key(key, nc, ns)}

    async def _poll(self, joined: dict) -> None:
        while self._joined is joined and not joined["launched"] and not joined["error"]:
            await self._poll_once(joined)
            await asyncio.sleep(POLL_SECONDS)

    async def _poll_once(self, joined: dict) -> None:
        nonce, reply = await self._ask(joined, "status")
        if self._joined is not joined:
            return
        if reply is not None and reply.get("ok") is False and reply.get("error") in ("dropped", "closed"):
            joined["error"] = ERROR_DROPPED if reply["error"] == "dropped" else ERROR_CLOSED
            decky.logger.info("multiplayer: the host %s", "dropped this seat" if reply["error"] == "dropped" else "closed the room")
            return
        status = proto.read_status_reply(joined["key"], reply, nonce) if reply is not None else None
        if status is None:
            joined["failures"] += 1
            self._debug("status poll failed (%s in a row)", joined["failures"])
            if joined["failures"] >= POLL_FAILURES:
                joined["error"] = ERROR_HOST_GONE
                decky.logger.info("multiplayer: lost the host")
            return
        joined["failures"] = 0
        joined["status"] = status
        joined["ip"] = status["ip"]

    async def _ask(self, joined: dict, op: str):
        nonce = secrets.token_hex(16)
        message = proto.make_tagged(joined["key"], op, joined["row"]["room"], joined["seat"], nonce, int(time.time()))
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(joined["row"]["address"], self._peer_port), HANDSHAKE_SECONDS
            )
        except (OSError, asyncio.TimeoutError):
            return nonce, None
        try:
            writer.write(frame(message))
            await asyncio.wait_for(writer.drain(), HANDSHAKE_SECONDS)
            return nonce, await asyncio.wait_for(read_frame(reader), HANDSHAKE_SECONDS)
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError):
            return nonce, None
        finally:
            writer.close()

    def leave(self) -> dict:
        if self._joined is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        self._drop_joined(tell_host=True)
        return {"ok": True}

    def _drop_joined(self, *, tell_host: bool) -> None:
        joined = self._joined
        if joined is None:
            return
        self._joined = None
        if self._poller is not None:
            self._poller.cancel()
            self._poller = None
        if tell_host and not joined["launched"] and not joined["error"]:
            loop = self._loop
            if loop is not None and not loop.is_closed():
                self._spawn(self._ask(joined, "leave"))
        decky.logger.info("multiplayer: left the room")

    def _guest_view(self, joined: dict) -> dict:
        return {
            "room": dict(joined["row"]),
            "seat": joined["seat"],
            "ip": joined["ip"],
            "status": joined["status"],
            "launched": joined["launched"],
            "error": joined["error"],
        }

    def room_status(self) -> dict:
        if self._room is not None:
            return {"ok": True, "role": "host", "room": self._host_view(self._room)}
        if self._joined is not None:
            return {"ok": True, "role": "guest", **self._guest_view(self._joined)}
        return {"ok": True, "role": None, "closedReason": self._closed_reason}

    def _startup_sweep(self) -> None:
        try:
            if not self._session_dir.is_dir():
                return
            keep = _running_sessions(str(self._session_dir)) | self._restore_sessions()
            for entry in self._session_dir.iterdir():
                found = _SESSION_ID.match(entry.name)
                if found is None or found.group(1) in keep or not entry.is_file():
                    continue
                try:
                    entry.unlink()
                except OSError as e:
                    decky.logger.warning("multiplayer: couldn't remove %s (%s)", entry.name, type(e).__name__)
            if keep:
                decky.logger.info("multiplayer: kept %s session(s) still in use", len(keep))
        except Exception as e:
            decky.logger.warning("multiplayer: the startup sweep failed (%s)", type(e).__name__)

    def _restore_sessions(self) -> set:
        raw = load_json_file(self._session_dir / RESTORE_RECORD, None)
        if not isinstance(raw, dict):
            return set()
        session = raw.get("session")
        return {session} if isinstance(session, str) else set()


def _new_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def _guests(room: dict) -> list:
    return [seat for index, seat in enumerate(room["seats"]) if index > 0 and seat is not None]


def _listening(port: int) -> bool:
    wanted = f":{port:04X}"
    for table in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(table, "r", encoding="ascii", errors="replace") as handle:
                next(handle, None)
                for line in handle:
                    fields = line.split()
                    if len(fields) > 3 and fields[3] == "0A" and fields[1].endswith(wanted):
                        return True
        except OSError:
            continue
    return False


def _address_exists(address: str) -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.bind((address, 0))
    except OSError:
        return False
    finally:
        probe.close()
    return True


def _running_sessions(folder: str) -> set:
    pattern = re.compile(re.escape(folder.rstrip("/")) + r"/session-([0-9a-f]{16})\.")
    found = set()
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/cmdline", "rb") as handle:
                cmdline = handle.read()
        except OSError:
            continue
        found.update(pattern.findall(cmdline.decode("utf-8", "replace")))
    return found


async def _say(writer, message: dict) -> bool:
    try:
        writer.write(frame(message))
        await asyncio.wait_for(writer.drain(), HANDSHAKE_SECONDS)
    except (OSError, asyncio.TimeoutError):
        return False
    return True
