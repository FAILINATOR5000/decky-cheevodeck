import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import shlex
import select
import shutil
import signal
import socket
import stat
import subprocess
import threading
import time
from collections import deque
from pathlib import Path

import cheevo_check_tools
import decky
import multiplayer_protocol as proto
import multiplayer_session as session
import rom_headers
import steam_shortcuts
import subprocess_util
from multiplayer_protocol import decode, frame, read_frame
from nearby_protocol import FrameError, clean_title, is_nonce, verify
from notifications import emit_notification
from services import lobby_client, lobby_tunnel
from utils import atomic_file, child_owner, chown_to_data_owner, ensure_dir, load_json_file

LEASE_SECONDS = 30
VISIT_CAP_SECONDS = 600

SEEK_SECONDS = 1.2
SEEK_SENDS = 3
MISSED_ROUNDS = 2
ROOMS_FOUND_MAX = 64
ROOMS_KEPT_MAX = 128

HANDSHAKE_SECONDS = 5
FIRST_FRAME_SECONDS = 2
MAX_HANDSHAKES = 24
HANDSHAKES_PER_ADDRESS = 2
HANDSHAKES_PER_RELAYED_ADDRESS = 4
ANSWERS_PER_SECOND = 10
SEEN_NONCES_MAX = 4096

POLL_SECONDS = 2
POLL_BACKOFF_SECONDS = 5
VOICE_POLL_SECONDS = 0.4
VOICE_FAST_SECONDS = 8
VOICE_PER_SEAT = 40
VOICE_RATE_SECONDS = 60
TURN_PORT = 3478
TURN_DEBOUNCE_SECONDS = 2
TURN_RENEW_SECONDS = 7200
TURN_RETRY_SECONDS = 60
SEAT_SILENCE_SECONDS = 30
SEAT_FREE_SECONDS = 90
ADDRESS_GRACE_SECONDS = 60
HOST_GONE_GRACE_SECONDS = 60

CLOSED_TAIL_SECONDS = 10
JOIN_TOAST_SECONDS = 300
FORCED_TOASTS_PER_MINUTE = 3

LAUNCH_WAIT_SECONDS = 300
LAUNCH_START_SECONDS = 60
SLEEP_JUMP_SECONDS = 60

HOUSEKEEPING_SECONDS = 5

DOLPHIN_TUNNEL_PORT = 2627

LIST_GRACE_SECONDS = 0.5

BAD_TAGS_PER_ADDRESS = 3
LOCKOUT_SECONDS = 60
BAD_TAGS_PER_ROOM = 10

SESSION_DIR = "multiplayer"
RESTORE_RECORD = "multiplayer_restore.json"
GAME_VOLUME_RECORD = "game_volume.json"
GAME_VOLUME_APP_MAX = 128
GAME_AUDIO_KEYS = ("application.id", "application.name")
WIREPLUMBER_STATE = ".local/state/wireplumber/stream-properties"
WIREPLUMBER_ESCAPES = {"s": " ", "e": "=", "o": "[", "c": "]", "\\": "\\"}
LEVEL_SLACK = 0.01
PUT_BACK_SECONDS = 3.0
WIREPLUMBER_STATE_MAX = 1 << 20
SILENCE_BYTES = 32768
RESTORE_SCHEMA = 1

DESKTOP_TOOLS = ("emudeck", "srm")
SRM_FLATPAK = "com.steamgriddb.steam-rom-manager"
SRM_IMAGE_NAMES = ("Steam-ROM-Manager.AppImage", "Steam ROM Manager.AppImage")
EMUDECK_SETTINGS = ".config/EmuDeck/settings.sh"
OPEN_TOOL_ENTRY = "cheevodeck-open-tool.desktop"
OPEN_TOOL_SCRIPT = "open-tool.sh"
OPEN_TOOL_WINDOW_SECONDS = 900
SAVE_BACKUPS = "save-backups"
SAVE_BACKUPS_KEPT = 5

SESSION_EVENT = "multiplayer_session"
ROOM_EVENT = "multiplayer_room"
VOICE_EVENT = "multiplayer_voice"
VOICE_DEBUG_EVENT = "multiplayer_voice_debug"
VOICE_CANCELLER_EVENT = "multiplayer_voice_canceller"

ARGV_SECONDS = 15
SETTLE_SECONDS = 5
APP_ENDED_GRACE_SECONDS = 10
FLATPAK_SECONDS = 10

EMULATOR_NAMES = ("retroarch", "PPSSPPSDL", "PPSSPPQt", "dolphin-emu", "RMG")
FALLBACK_NAMES = {"retroarch": "RetroArch", "ppsspp": "PPSSPP", "dolphin": "Dolphin", "rmg": "RMG"}

RMG_SERVER_NAME = "rmg-netplay-server"
RMG_SERVER_LOG = "rmg-netplay-server.log"
RMG_SERVER_GAMES = 4
RMG_SERVER_START_SECONDS = 3.0
SESSION_SUFFIXES = {".cfg": "retroarch", ".ini": "ppsspp", ".dolphin": "dolphin", ".rmg": "rmg"}

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
ERROR_BAD_ADDRESS = "bad_address"
ERROR_NOT_FOUND = "not_found"
ERROR_HOST_GONE = "host_gone"
ERROR_DROPPED = "dropped"
ERROR_TIMED_OUT = "timed_out"
ERROR_CLOSED = "closed"
ERROR_NETWORK_CHANGED = "network_changed"
ERROR_NO_GUESTS = "no_guests"
ERROR_SEATED = "seated"
ERROR_GATE = "gate"
ERROR_NOT_READY = "not_ready"
ERROR_WRITE_FAILED = "write_failed"
ERROR_ARGS_DROPPED = "args_dropped"
ERROR_NOBODY_READY = "nobody_ready"
ERROR_IN_GAME = "other_game"
ERROR_NOT_LOBBY = "not_lobby"
ERROR_LAUNCH_FAILED = "launch_failed"
ERROR_RMG_SERVER = "rmg_server"
ERROR_CHAT = "chat_refused"
ERROR_NO_LOBBY = "no_lobby"
ERROR_LOBBY_UNREACHABLE = "lobby_unreachable"
ERROR_LAN_ONLY = "lan_only"
ERROR_TUNNEL = "tunnel_failed"
ERROR_INVITE_EXPIRED = "invite_expired"
ERROR_FRIENDS_ONLY = "friends_only"
ERROR_FRIENDS_OFF = "friends_off"

CHAT_GAP_SECONDS = 1

_JOIN_REFUSALS = {
    "bad_code": ERROR_BAD_CODE,
    "locked": ERROR_LOCKED_OUT,
    "full": ERROR_FULL,
    "closed": ERROR_ROOM_GONE,
    "dropped": ERROR_DROPPED,
    "expired": ERROR_INVITE_EXPIRED,
    "friends_only": ERROR_FRIENDS_ONLY,
}

_SESSION_ID = re.compile(r"session-([0-9a-f]{16})\.")

PLUGIN_VERSION = str(getattr(decky, "DECKY_PLUGIN_VERSION", "") or "").strip()

GB_SYSTEMS = session.GB_SYSTEMS
PSP_SYSTEM = session.PSP_SYSTEM


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
        port: int = proto.PORT, peer_port: int = proto.PORT,
        broadcast: str = "255.255.255.255", bin_dir=None, voice_canceller=None, voice_room_changed=None,
    ):
        self._settings_store = settings_store
        self._voice_canceller = voice_canceller
        self._voice_room_changed = voice_room_changed
        self._in_voice_room = False
        self._game_mode = game_mode
        self._user_home = Path(user_home)
        self._session_dir = Path(runtime_dir) / SESSION_DIR
        self._volume_lock = threading.Lock()
        self._cheevo_check = cheevo_check_service
        self._cheevo_check_store = cheevo_check_store
        self._port = port
        self._peer_port = peer_port
        self._broadcast = broadcast
        self._bin_dir = Path(bin_dir) if bin_dir is not None else None
        self._rmg_server = None

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
        self._seen_order = deque()
        self._answered = deque()
        self._handshakes = 0
        self._peer_handshakes = {}

        self._room = None
        self._closed_tail = None
        self._closed_reason = ""
        self._announced = None
        self._event_seq = 0
        self._join_toasts = {}
        self._forced_toasts = []
        self._joined = None
        self._rooms = {}
        self._round = 0
        self._link = None
        self._listing = None
        self._online = {}
        self._online_error = ""
        self._prefer_server = False

        self._housekeeper = None
        self._poller = None
        self._tasks = set()
        self._swept = False

        self._session = None
        self._stopping = False
        self._goodbye = None
        self._library_cache = (None, None)
        self._verdict_memo = {}
        self._hash_memo = {}
        self._crc_memo = {}
        self._build_memo = {}
        self._code_memo = {}
        self._dolphin_skipped = False
        self._cable_memo = {}
        self._appimage_versions = {}
        self._versions = None
        self._permissions = {}
        self._device = ""
        self._host_tunnels = lobby_tunnel.HostTunnels(debug=self._debug)
        self._guest_tunnels = None
        self._friends = None
        self._voice_relay = False

    def set_friends(self, friends) -> None:
        self._friends = friends

    def _identity(self) -> tuple:
        friends = self._friends
        return friends.identity() if friends is not None else ("", "")

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
                self._closed_reason = ""
                self._end_visit()
                return {"ok": True, "visible": False}
            if not self._game_mode():
                self.close()
                return {"ok": False, "error": ERROR_NOT_GAME_MODE}
            if not self._user():
                self.close()
                return {"ok": False, "error": ERROR_NO_ACCOUNT}

            now = time.monotonic()
            if entry or self._room is not None or self._joined is not None:
                self._cap_until = now + VISIT_CAP_SECONDS
                self._versions = None
                self._permissions = {}
                self._verdict_memo.clear()
                if entry:
                    self._rooms.clear()
                    self._online = {}
                    self._online_error = ""
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
        self._rooms.clear()

    def _end_visit(self) -> None:
        if self._expiry is not None:
            self._expiry.cancel()
            self._expiry = None
        self._visible_until = 0.0
        self._cap_until = 0.0
        self._rooms.clear()
        self._online = {}

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
        self._stopping = True
        for task in list(self._tasks):
            task.cancel()
        self._stop_rmg_server()
        if self._voice_canceller is not None:
            self._voice_canceller.shutdown()
        self.close()

    def settle(self, seconds: float) -> None:
        goodbye, self._goodbye = self._goodbye, None
        if goodbye is None:
            return
        worker = threading.Thread(target=asyncio.run, args=(goodbye,), name="multiplayer-goodbye", daemon=True)
        worker.start()
        worker.join(seconds)

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
        self._closed_tail = None
        if self._link is not None:
            self._link.close()
            self._link = None
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

    def lobby_server(self):
        return self._lobby_server()

    def has_room(self, room_id: str) -> bool:
        return room_id in self._rooms

    def room_row(self, room_id: str):
        held = self._rooms.get(room_id)
        return dict(held[0]) if held is not None else None

    def _friend_pair(self, ulid: str):
        friends = self._friends
        return friends.pair_key(ulid) if friends is not None and proto.is_ulid(ulid) else None

    def _lobby_server(self):
        return lobby_client.parse_server(self._settings_store.get_lobby_server(self._settings_store.load_config()))

    def _relay_host(self) -> str:
        server = self._lobby_server()
        return server[0] if server is not None else ""

    def _open_guest_tunnels(self, joined: dict, mode: str, local: dict) -> bool:
        server = self._lobby_server()
        loop = self._loop
        if server is None or loop is None or loop.is_closed():
            return False
        ports = [(kind, DOLPHIN_TUNNEL_PORT if kind == "udp" else port, port)
                 for kind, port in proto.tunnel_ports(mode, local["emulator"], local["core"])]
        if not ports:
            return True

        async def open_them():
            if self._guest_tunnels is not None:
                self._close_guest_tunnels()
                await asyncio.sleep(0.05)
            tunnels = lobby_tunnel.GuestTunnels(server=server, room_id=joined["row"]["room"], seat=joined["seat"],
                                                seat_key=joined["key"], ports=ports, debug=self._debug)
            if not await tunnels.start():
                return False
            self._guest_tunnels = tunnels
            return True

        try:
            return asyncio.run_coroutine_threadsafe(open_them(), loop).result(10)
        except Exception as e:
            decky.logger.warning("multiplayer: couldn't open the game tunnel (%s)", type(e).__name__)
            return False

    def _close_guest_tunnels(self) -> None:
        tunnels, self._guest_tunnels = self._guest_tunnels, None
        if tunnels is not None:
            tunnels.close()

    def _close_guest_tunnels_soon(self) -> None:
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._close_guest_tunnels)

    def _room_view(self) -> dict:
        room = self._room
        if room is not None:
            return {"role": "host", "title": room["title"], "host": room["user"],
                    "seated": len(_guests(room)), "error": "", "seat": 0, "ready": False,
                    "seats": [{"name": seat["name"] if seat else "",
                               "ready": bool(seat) and index > 0 and self._seat_ready(room, seat)}
                              for index, seat in enumerate(room["seats"])],
                    "rev": room["rev"], "round": room["round"], "state": self._public_state(room),
                    "chat": dict(room["chat"][-1]) if room["chat"] else None, "lobby": self._lobby_state(),
                    "voice": self._voice_view()}
        joined = self._joined
        if joined is not None:
            status = joined["status"] or {}
            members = status.get("members") or joined["row"]["seats"]
            flags = status.get("seats") or []
            return {"role": "guest", "title": joined["row"]["title"], "host": joined["row"]["user"],
                    "seated": max(0, sum(1 for name in members if name) - 1), "error": joined["error"],
                    "seat": joined["seat"], "ready": joined["ready"],
                    "seats": [{"name": name, "ready": index < len(flags) and flags[index]["ready"]}
                              for index, name in enumerate(members)],
                    "rev": status.get("rev", 0), "round": status.get("round", 0),
                    "state": status.get("state", "lobby"),
                    "chat": dict(joined["chat"][-1]) if joined["chat"] else None,
                    "autostart": self._pending_start(joined), "voice": self._voice_view()}
        return {"role": None, "title": "", "host": "", "seated": 0, "error": "", "seat": 0, "ready": False,
                "seats": [], "rev": 0, "round": 0, "state": "lobby", "chat": None, "voice": None}

    def _voice_view(self):
        room = self._room
        if room is not None:
            if not room["voice"]:
                return None
            return {"room": room["id"], "game": room["gameId"], "where": room["where"], "access": _access(room),
                    "cfg": f"{room['turnSeq']}:{int(self._voice_relay)}",
                    "seats": [{"vc": seat.get("vc", False), "vs": seat.get("vstamp", 0)} if seat else None
                              for seat in room["seats"]]}
        joined = self._joined
        if joined is None or not joined["row"]["voice"]:
            return None
        status = joined["status"] or {}
        members = status.get("members") or []
        flags = status.get("seats") or []
        local = joined["local"]
        return {"room": joined["row"]["room"], "game": local["gameId"] if local is not None else joined["row"]["gameId"],
                "where": joined["row"]["where"], "access": _access(joined["row"]),
                "cfg": f"{joined['turnSeq']}:{int(self._voice_relay)}",
                "seats": [{"vc": flags[index]["vc"], "vs": flags[index]["vs"]} if name and index < len(flags) else None
                          for index, name in enumerate(members)]}

    def _lobby_state(self) -> str:
        if self._link is None:
            return ""
        return "up" if self._link.up else "down"

    def _announce(self) -> None:
        room = self._room
        if room is not None and self._link is not None:
            self._link.update(proto.room_body(room))
        view = self._room_view()
        if view == self._announced:
            return
        self._announced = view
        self._event_seq += 1
        self._emit({**view, "seq": self._event_seq}, ROOM_EVENT)
        if self._friends is not None:
            self._friends.room_changed()

    def _in_game(self) -> bool:
        current = self._session
        return current is not None and bool(current["started"]) and not current["exited"]

    def _toast_seat(self, name: str, title: str, line: str) -> None:
        now = time.monotonic()
        self._forced_toasts = [at for at in self._forced_toasts if now - at < 60]
        force = not self._in_game() and len(self._forced_toasts) < FORCED_TOASTS_PER_MINUTE
        if force:
            self._forced_toasts.append(now)
        emit_notification(
            ntype="system",
            settings_store=self._settings_store,
            event_loop=self._loop,
            title_key=title,
            line_key=line,
            template_vars={"name": name},
            force_toast=force,
        )

    def _fresh_nonce(self, nonce: str, now: float) -> bool:
        order = self._seen_order
        while order and (now - order[0][0] > 2 * proto.CLOCK_SKEW_SECONDS or len(order) > SEEN_NONCES_MAX):
            _at, old = order.popleft()
            self._seen.pop(old, None)
        if nonce in self._seen:
            return False
        self._seen[nonce] = now
        order.append((now, nonce))
        return True

    def _library(self):
        results_stamp = self._cheevo_check_store.results_fingerprint()
        if results_stamp is None:
            return None
        by_rom = steam_shortcuts.shortcuts_by_rom(self._user_home)
        held = self.restore_record()["record"]
        stamp = (results_stamp, id(by_rom), held and (held["appid"], held["original"]))
        if self._library_cache[0] == stamp:
            return self._library_cache[1]
        results = self._cheevo_check_store.load_results()
        if results is None:
            return None
        self._dolphin_skipped = bool(results.get("skippedDolphin"))
        library = {}
        games = list(results.get("supportedGames") or [])
        for row in results.get("noAchievements") or []:
            if isinstance(row, dict) and isinstance(row.get("path"), str):
                games.append({**row, "paths": [row["path"]],
                              "files": [{"path": row["path"], "raHash": row.get("raHash")}]})
        for game in games:
            if not isinstance(game, dict):
                continue
            game_id = game.get("gameId")
            system_id = game.get("systemId")
            if type(game_id) is not int or type(system_id) is not int:
                continue
            hashes = {}
            for row in game.get("files") or []:
                if isinstance(row, dict) and isinstance(row.get("path"), str):
                    hashes[row["path"]] = row.get("raHash") if isinstance(row.get("raHash"), str) else ""
            entry = library.setdefault(game_id, {
                "gameId": game_id,
                "title": clean_title(str(game.get("title") or "")) or str(game_id),
                "systemId": system_id,
                "system": str(game.get("system") or ""),
                "imageIcon": str(game.get("imageIcon") or ""),
                "paths": [],
            })
            for raw in game.get("paths") or []:
                path = str(raw or "")
                if not path:
                    continue
                real = os.path.realpath(path)
                shortcut = by_rom.get(real) or by_rom.get(path)
                if shortcut is not None and held is not None and shortcut["appid"] == held["appid"]:
                    shortcut = {**shortcut, "launchOptions": held["original"]}
                    if not {real, path} & set(steam_shortcuts.rom_candidates(shortcut["exe"], held["original"] or None)):
                        shortcut = None
                entry["paths"].append({
                    "path": path,
                    "real": real,
                    "hash": hashes.get(path, ""),
                    "shortcut": shortcut,
                })
        self._library_cache = (stamp, library)
        return library

    def _hash_of(self, entry: dict, system_id: int) -> str:
        if entry["hash"]:
            return entry["hash"]
        try:
            st = os.stat(entry["real"])
        except OSError:
            return ""
        key = (entry["real"], st.st_mtime_ns, st.st_size)
        if key not in self._hash_memo:
            found = ""
            if self._cheevo_check is not None:
                found = self._cheevo_check.hash_rom_for_room(entry["real"], system_id)
            self._hash_memo[key] = found
        return self._hash_memo[key]

    def _crc_of(self, path: str) -> str:
        try:
            st = os.stat(path)
        except OSError:
            return ""
        key = (path, st.st_mtime_ns, st.st_size)
        if key not in self._crc_memo:
            self._crc_memo[key] = session.rom_crc(path)
        return self._crc_memo[key]

    def _core_build_of(self, path: Path) -> str:
        try:
            st = os.stat(path)
        except OSError:
            return ""
        key = (str(path), st.st_mtime_ns, st.st_size)
        if key not in self._build_memo:
            self._build_memo[key] = session.core_build(path)
        return self._build_memo[key]

    def _game_code_of(self, path: str, system_id: int) -> str:
        try:
            st = os.stat(path)
        except OSError:
            return ""
        key = (path, system_id, st.st_mtime_ns, st.st_size)
        if key not in self._code_memo:
            self._code_memo[key] = rom_headers.game_code(path, system_id)
        return self._code_memo[key]

    def _gpsp_has_cable(self, path: Path) -> bool:
        try:
            st = os.stat(path)
        except OSError:
            return False
        key = (str(path), st.st_mtime_ns, st.st_size)
        if key not in self._cable_memo:
            self._cable_memo[key] = session.gpsp_has_cable(path)
        return self._cable_memo[key]

    def _flatpak_env(self) -> dict:
        owner = child_owner()
        uid = owner[0] if owner else os.getuid()
        return {
            "HOME": str(self._user_home),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "XDG_RUNTIME_DIR": f"/run/user/{uid}",
            "XDG_DATA_HOME": str(self._user_home / ".local" / "share"),
        }

    def _flatpak(self, *args):
        try:
            code, out, _err = subprocess_util.run_command(
                ["flatpak", *args], timeout=FLATPAK_SECONDS, env=self._flatpak_env(), as_data_owner=True,
            )
        except Exception as e:
            self._debug("flatpak %s failed (%s)", args[0], type(e).__name__)
            return None
        return out if code == 0 else None

    def _flatpak_version(self, app: str) -> str:
        versions = self._versions
        if versions is None:
            versions = {}
            out = self._flatpak("list", "--app", "--columns=application,version") or ""
            for line in out.splitlines():
                parts = line.split("\t")
                if len(parts) >= 2:
                    versions[parts[0].strip()] = parts[1].strip()
            self._versions = versions
        return versions.get(app, "")

    def _flatpak_reads_home(self, app: str) -> bool:
        if app not in self._permissions:
            out = self._flatpak("info", "--show-permissions", app)
            reads = out is None
            for line in (out or "").splitlines():
                if line.startswith("filesystems="):
                    granted = {item.split(":")[0] for item in line.split("=", 1)[1].split(";")}
                    reads = "host" in granted or "home" in granted
                    break
            self._permissions[app] = reads
        return self._permissions[app]

    def _compatible(self, ra, mode: str, system_id: int) -> list:
        cores = []
        for core in ra.installed_cores():
            if not ra.runs_system(core, system_id):
                continue
            if mode == "couch" and not ra.can_couch(core):
                continue
            if mode == "link" and core != session.LINK_CORES.get(system_id):
                continue
            cores.append(core)
        return cores

    def _core_with_save(self, ra, compatible: list, rom: Path, table_core: str) -> str:
        for core in ([table_core] if table_core in compatible else []) + compatible:
            if ra.sorts_saves_by_core(core, rom) and any(path.is_file() for path in ra.save_paths(core, rom)):
                return core
        return table_core

    def _default_core(self, ra, compatible: list, shortcut_core: str, room_core: str) -> str:
        if room_core and ra.installed(room_core):
            return room_core
        if shortcut_core in compatible:
            return shortcut_core
        four_seats = [core for core in compatible if core in session.MULTITAP]
        if four_seats:
            return four_seats[0]
        return compatible[0] if compatible else ""

    def games(self) -> dict:
        ra = session.RetroArch(self._user_home)
        installed = ra.installed_cores() if ra.found else []
        library = self._library()
        if library is None:
            return {"ok": True, "scanned": False, "games": [], "installedCores": installed}
        games = []
        couch_systems = {}
        emulators = {}
        fallback_on = self._fallback_on()
        for entry in library.values():
            system_id = entry["systemId"]
            linked = next((p for p in entry["paths"] if p["shortcut"]), None)
            shortcut = linked["shortcut"] if linked else None
            if shortcut is not None:
                detected = session.detect(shortcut["exe"], shortcut["launchOptions"])
                emulator = detected["emulator"] if detected else "retroarch"
                path, launchable = linked, True
            elif not fallback_on:
                emulator, path, launchable = "retroarch", None, False
            else:
                emulator = self._fallback_kinds("couch", system_id)[0]
                path = next((p for p in entry["paths"] if os.path.isfile(p["real"])), None)
                kinds = set(self._fallback_kinds("link", system_id) + self._fallback_kinds("couch", system_id))
                for kind in kinds - emulators.keys():
                    emulators[kind] = self._emulator_shortcut(kind, None) is not None
                launchable = path is not None and any(emulators[kind] for kind in kinds)
            can_couch = self._can_couch(ra, couch_systems, system_id, emulator)
            can_link = system_id in session.LINK_CORES
            if system_id == session.GAMECUBE_SYSTEM:
                can_link = entry["gameId"] in session.GC_LAN_GAMES
            if can_link and system_id == session.GBA_SYSTEM:
                can_link = path is not None \
                    and self._game_code_of(path["real"], session.GBA_SYSTEM) in session.GBA_LINK_CODES
            games.append({
                "gameId": entry["gameId"],
                "title": entry["title"],
                "systemId": system_id,
                "system": entry["system"],
                "imageIcon": entry["imageIcon"],
                "appid": shortcut["appid"] if shortcut else 0,
                "launchable": launchable,
                "canLink": can_link,
                "canCouch": can_couch,
            })
        games.sort(key=lambda row: row["title"].lower())
        return {"ok": True, "scanned": True, "games": games, "installedCores": installed}

    def _can_couch(self, ra, by_system: dict, system_id: int, emulator: str) -> bool:
        if system_id == session.N64_SYSTEM:
            return self._emulator_shortcut("rmg") is not None
        if emulator == "dolphin":
            return system_id in session.DOLPHIN_SYSTEMS
        if emulator == "duckstation":
            if self._emulator_shortcut("retroarch") is None:
                return False
            system_id = session.PS1_SYSTEM
        elif emulator != "retroarch" or system_id == session.DS_SYSTEM:
            return False
        if not ra.found:
            return False
        if system_id not in by_system:
            by_system[system_id] = bool(self._compatible(ra, "couch", system_id))
        return by_system[system_id]

    def cores(self, mode: str, game_id: int, room_id: str = "") -> dict:
        local, gate, detail = self._local(mode, game_id, "", self._room_row(room_id))
        if local is None:
            return {"ok": True, "cores": [], "default": "", "gate": gate, "detail": detail}
        return {
            "ok": True,
            "cores": local["choices"],
            "default": local["core"],
            "shortcutCore": local["shortcutCore"],
            "shortcutCoreName": local["shortcutCoreName"],
            "gate": None,
            "detail": {},
        }

    def _room_row(self, room_id: str):
        if self._joined is not None:
            return self._joined["row"]
        seen = self._rooms.get(room_id) if room_id else None
        return seen[0] if seen else None

    def _local(self, mode: str, game_id: int, core: str, room):
        local, gate, detail = self._route(mode, game_id, core, room)
        if local is not None and local["fallback"] and not local["appid"]:
            return None, "no_emulator_shortcut", {"emulator": FALLBACK_NAMES[local["emulator"]]}
        return local, gate, detail

    def _route(self, mode: str, game_id: int, core: str, room):
        if mode not in proto.MODES:
            return None, "unsupported_emulator", {}
        library = self._library()
        if library is None:
            return None, "no_scan", {}
        if room is not None and mode == "couch":
            game_id = room["gameId"]
        game = library.get(game_id)
        if game is None:
            if self._dolphin_skipped and not self._flatpak_version(session.DOLPHIN_FLATPAK):
                return None, "not_in_results", {"dolphinSkipped": "1"}
            return None, "not_in_results", {}
        system_id = game["systemId"]
        candidates = [entry for entry in game["paths"] if entry["shortcut"]]
        fallback = None
        if not candidates:
            if not self._fallback_on():
                return None, "no_shortcut", {}
            fallback = self._fallback(mode, system_id)
            candidates = [{**entry, "shortcut": fallback} for entry in game["paths"] if os.path.isfile(entry["real"])]
            if not candidates:
                return None, "rom_missing", {}

        pick = candidates[0]
        if room is not None and mode == "couch":
            pick = next((entry for entry in candidates
                         if room["hash"] and self._hash_of(entry, system_id) == room["hash"]), None)
            if pick is None:
                return None, "rom_mismatch", {}
        if fallback is not None:
            detected = {"emulator": fallback["kind"], "core": ""}
        else:
            detected = session.detect(pick["shortcut"]["exe"], pick["shortcut"]["launchOptions"])
        n64_couch = mode == "couch" and system_id == session.N64_SYSTEM
        if detected is None and not n64_couch:
            return None, "unsupported_emulator", {}

        local = {
            "gameId": game_id,
            "title": game["title"],
            "systemId": system_id,
            "path": pick["path"],
            "real": pick["real"],
            "appid": pick["shortcut"]["appid"],
            "emulator": detected["emulator"] if detected else "",
            "shortcutCore": detected["core"] if detected else "",
            "shortcutCoreName": detected["core"] if detected else "",
            "choices": [],
            "hash": pick["hash"],
            "coreBuild": "",
            "gameCode": "",
            "fallback": fallback is not None,
        }
        if n64_couch:
            return self._rmg_couch_local(local)
        emulator = detected["emulator"]
        if emulator == "pcsx2":
            return None, "pcsx2_no_multiplayer", {}
        if emulator == "melonds":
            return None, "melonds_standalone", {}
        if emulator == "duckstation" and mode == "couch":
            return self._duckstation_couch_local(local, core, room)
        if mode == "link" and system_id not in session.LINK_CORES:
            return None, "link_system", {}
        if mode == "couch" and system_id == session.DS_SYSTEM:
            return None, "ds_no_couch", {}
        if mode == "link" and system_id == session.GBA_SYSTEM:
            local["gameCode"] = self._game_code_of(pick["real"], system_id)
            if not local["gameCode"]:
                return None, "link_no_game_code", {}
            if local["gameCode"] not in session.GBA_LINK_CODES:
                return None, "link_gba_cant_link", {}
        if mode == "link" and system_id == session.DS_SYSTEM and rom_headers.dsi_only(pick["real"]):
            return None, "melondsds_dsi_mode", {}

        if emulator == "ppsspp":
            if mode == "couch":
                return None, "no_couch_core", {}
            if system_id != PSP_SYSTEM:
                return None, "unsupported_emulator", {}
            local.update(core=session.PPSSPP_STANDALONE, coreName="PPSSPP", shortcutCoreName="PPSSPP",
                         emuVersion=self._flatpak_version(session.PPSSPP_FLATPAK))
            return local, None, {}
        if emulator == "dolphin":
            return self._dolphin_local(mode, local, pick)
        if emulator != "retroarch":
            return None, "unsupported_emulator", {}

        ra = session.RetroArch(self._user_home)
        if not ra.found:
            return None, "no_shortcut" if local["fallback"] else "unsupported_emulator", {}
        local["ra"] = ra
        local["shortcutCoreName"] = ra.core_name(detected["core"])
        compatible = self._compatible(ra, mode, system_id)
        local["choices"] = [{"core": name, "name": ra.core_name(name)} for name in compatible]
        room_core = room["core"] if room is not None else ""
        usual = detected["core"]
        if local["fallback"]:
            usual = self._core_with_save(ra, compatible, Path(pick["path"]), session.COUCH_CORES.get(system_id, ""))
        chosen = core or self._default_core(ra, compatible, usual, room_core)

        if mode == "link":
            needed = session.LINK_CORES[system_id]
            if needed == session.DOLPHIN_STANDALONE:
                return None, "link_needs_dolphin", {}
            if not core:
                chosen = needed if needed in compatible else ""
            if chosen != needed:
                return None, f"link_needs_{needed}", {}
            if needed == session.GPSP and not self._gpsp_has_cable(ra.core_path(needed)):
                return None, "gpsp_too_old", {}
            if needed == session.MELONDS_DS:
                version = session.version_tuple(ra.version(needed))
                if version is not None and version < session.MELONDS_DS_MIN_VERSION:
                    return None, "melondsds_too_old", {}
                if dict(ra.effective_options(needed, Path(pick["path"]))).get("melonds_console_mode") == "dsi":
                    return None, "melondsds_dsi_mode", {}
        elif chosen not in compatible:
            if room is not None and room_core and not ra.installed(room_core):
                return None, "host_core_missing", {"core": room["coreName"] or room_core}
            works = [ra.core_name(name) for name in compatible]
            if not works:
                return None, "no_couch_core", {}
            return None, "core_cant_couch", {"core": ra.core_name(chosen) if chosen else "", "works": ", ".join(works)}
        if not ra.installed(chosen):
            return None, "host_core_missing", {"core": ra.core_name(chosen)}

        local.update(core=chosen, coreName=ra.core_name(chosen),
                     emuVersion=f"{self._flatpak_version(session.RETROARCH_FLATPAK)}|{ra.version(chosen)}")
        if mode == "couch":
            local["coreBuild"] = self._core_build_of(ra.core_path(chosen))
        return local, None, {}

    def _dolphin_local(self, mode: str, local: dict, pick: dict):
        if mode == "couch":
            return self._dolphin_netplay_local(local, pick)
        if local["gameId"] not in session.GC_LAN_GAMES:
            return None, "link_gc_no_lan", {}
        install = session.dolphin_install(pick["shortcut"]["exe"], pick["shortcut"]["launchOptions"], self._user_home)
        disc = rom_headers.disc_game_id(pick["real"])
        if disc and session.dolphin_sets_adapter(session.dolphin_game_settings(self._user_home, install), disc):
            return None, "dolphin_game_setting", {}
        local.update(core=session.DOLPHIN_STANDALONE, coreName="Dolphin", shortcutCoreName="Dolphin",
                     install=install, gameCode=disc[:4],
                     emuVersion=self._flatpak_version(session.DOLPHIN_FLATPAK) if install == "flatpak" else "")
        return local, None, {}

    def _dolphin_netplay_local(self, local: dict, pick: dict):
        if local["systemId"] not in session.DOLPHIN_SYSTEMS:
            return None, "unsupported_emulator", {}
        exe, options = pick["shortcut"]["exe"], pick["shortcut"]["launchOptions"]
        install = session.dolphin_install(exe, options, self._user_home)
        emulator = self._emulator_shortcut("dolphin", install)
        if emulator is None:
            return None, "no_dolphin_emulator_shortcut", {}
        folder = session.dolphin_missing_folder(self._user_home, install, pick["real"])
        if folder:
            return None, "dolphin_game_list", {"folder": folder}
        disc = rom_headers.disc_game_id(pick["real"])
        local.update(core=session.DOLPHIN_STANDALONE, coreName="Dolphin", shortcutCoreName="Dolphin",
                     install=install, gameCode=disc[:4], gameAppid=local["appid"], appid=emulator["appid"],
                     emuVersion=self._dolphin_version(install, emulator))
        return local, None, {}

    def _rmg_couch_local(self, local: dict):
        emulator = self._emulator_shortcut("rmg")
        if emulator is None:
            return None, "no_rmg_shortcut", {}
        install = session.rmg_install(emulator["exe"], emulator["launchOptions"], self._user_home)
        local.update(
            emulator="rmg", core=session.RMG_STANDALONE, coreName="RMG", shortcutCore="", shortcutCoreName="RMG",
            install=install, gameAppid=local["appid"], appid=emulator["appid"],
            emuVersion=self._rmg_version(install, emulator),
        )
        return local, None, {}

    def _rmg_version(self, install: str, shortcut: dict) -> str:
        if install == "flatpak":
            return self._flatpak_version(session.RMG_FLATPAK)
        if install != "appimage":
            return ""
        return self._appimage_version(session.rmg_appimage(shortcut["exe"], shortcut["launchOptions"], self._user_home))

    def _duckstation_couch_local(self, local: dict, core: str, room):
        ra = session.RetroArch(self._user_home)
        if not ra.found:
            return None, "duckstation_no_multiplayer", {}
        compatible = self._compatible(ra, "couch", session.PS1_SYSTEM)
        emulator = self._emulator_shortcut("retroarch")
        if not compatible or emulator is None:
            return None, "duckstation_no_multiplayer", {}
        room_core = room["core"] if room is not None else ""
        if core in compatible:
            chosen = core
        elif room_core:
            if not ra.installed(room_core) or room_core not in compatible:
                return None, "host_core_missing", {"core": room["coreName"] or room_core}
            chosen = room_core
        else:
            chosen = session.BEETLE_PSX_HW if session.BEETLE_PSX_HW in compatible else compatible[0]
        local.update(
            emulator="retroarch", ra=ra, core=chosen, coreName=ra.core_name(chosen), shortcutCore="",
            shortcutCoreName="DuckStation", gameAppid=local["appid"], appid=emulator["appid"], duckstation=True,
            choices=[{"core": name, "name": ra.core_name(name)} for name in compatible],
            emuVersion=f"{self._flatpak_version(session.RETROARCH_FLATPAK)}|{ra.version(chosen)}",
            coreBuild=self._core_build_of(ra.core_path(chosen)),
        )
        return local, None, {}

    def _fallback_on(self) -> bool:
        return bool(self._settings_store.load_config().get("mpShortcutFallback", True))

    def _play_route(self, game_id: int):
        library = self._library()
        if library is None:
            return None, "no_scan", {}
        game = library.get(game_id)
        if game is None:
            return None, "not_in_results", {}
        linked = next((entry for entry in game["paths"] if entry["shortcut"]), None)
        if linked is not None:
            return {"appid": linked["shortcut"]["appid"], "fallback": False}, None, {}
        if not bool(self._settings_store.load_config().get("playShortcutFallback", True)):
            return None, "no_shortcut", {}
        rom = next((entry["path"] for entry in game["paths"] if os.path.isfile(entry["real"])), None)
        if rom is None:
            return None, "rom_missing", {}
        system_id = game["systemId"]
        kinds = self._fallback_kinds("link", system_id)
        coreless = False
        for kind in kinds:
            shortcut = self._emulator_shortcut(kind, None)
            if shortcut is None:
                continue
            route = {"appid": shortcut["appid"], "fallback": True, "kind": kind, "rom": rom, "corePath": ""}
            if kind == "retroarch":
                ra = session.RetroArch(self._user_home)
                core = self._play_core(ra, system_id, Path(rom))
                if not core:
                    coreless = True
                    continue
                route["corePath"] = str(ra.core_path(core))
            return route, None, {}
        if coreless:
            return None, "no_shortcut", {}
        return None, "no_emulator_shortcut", {"emulator": FALLBACK_NAMES[kinds[0]]}

    def _play_core(self, ra, system_id: int, rom: Path) -> str:
        if not ra.found:
            return ""
        compatible = self._compatible(ra, "", system_id)
        core = self._core_with_save(ra, compatible, rom, session.COUCH_CORES.get(system_id, ""))
        if core in compatible:
            return core
        return compatible[0] if compatible else ""

    def play_info(self, game_id: int) -> dict:
        route, gate, detail = self._play_route(game_id)
        if route is None:
            return {"ok": True, "appid": 0, "launchable": False, "fallback": False, "gate": gate, "detail": detail,
                    "tools": self.desktop_tools()}
        return {"ok": True, "appid": route["appid"], "launchable": True, "fallback": route["fallback"],
                "gate": None, "detail": {}, "tools": {}}

    def _desktop_tool_command(self, tool: str):
        home = self._user_home
        if tool == "emudeck":
            image = home / "Applications" / "EmuDeck.AppImage"
            return [str(image)] if image.is_file() else None
        if tool != "srm":
            return None
        for folder in self._srm_folders():
            for name in SRM_IMAGE_NAMES:
                image = folder / name
                if image.is_file():
                    return [str(image)]
        if (home / ".local/share/flatpak/app" / SRM_FLATPAK).is_dir() or (Path("/var/lib/flatpak/app") / SRM_FLATPAK).is_dir():
            return ["flatpak", "run", SRM_FLATPAK]
        return None

    def _srm_folders(self) -> list:
        home = self._user_home
        folders = [home / "Applications", home / "Applications" / "srm"]
        tools = [home / "Emulation" / "tools"]
        try:
            text = (home / EMUDECK_SETTINGS).read_text(encoding="utf-8", errors="replace")
        except OSError:
            text = ""
        found = re.search(r"^toolsPath=(.+)$", text, re.M)
        if found:
            value = found.group(1).strip().replace('"', "").replace("'", "")
            value = value.replace("${HOME}", str(home)).replace("$HOME", str(home))
            if value.startswith("/"):
                tools.insert(0, Path(value))
        for folder in tools:
            folders += [folder, folder / "srm"]
        return folders

    def desktop_tools(self) -> dict:
        return {tool: self._desktop_tool_command(tool) is not None for tool in DESKTOP_TOOLS}

    def open_in_desktop(self, tool: str) -> dict:
        command = self._desktop_tool_command(tool) if tool in DESKTOP_TOOLS else None
        if command is None:
            return {"ok": False, "error": "not_found"}
        autostart = self._user_home / ".config" / "autostart"
        entry = autostart / OPEN_TOOL_ENTRY
        script = self._session_dir / OPEN_TOOL_SCRIPT
        if any(char in str(script) for char in '"`$\\'):
            return {"ok": False, "error": "not_found"}
        text = (
            "#!/bin/sh\n"
            f"rm -f {shlex.quote(str(entry))} \"$0\"\n"
            f"[ $(( $(date +%s) - {int(time.time())} )) -lt {OPEN_TOOL_WINDOW_SECONDS} ] || exit 0\n"
            f"exec {shlex.join(command)}\n"
        )
        desktop = (
            "[Desktop Entry]\n"
            "Type=Application\n"
            "Name=CheevoDeck\n"
            f"Exec=/bin/sh \"{script}\"\n"
            "NoDisplay=true\n"
        )
        try:
            ensure_dir(self._session_dir)
            ensure_dir(autostart)
            self._write(script, text)
            chown_to_data_owner(script)
            self._write(entry, desktop)
            chown_to_data_owner(entry)
        except OSError as e:
            decky.logger.warning("play: couldn't write the autostart entry (%s)", type(e).__name__)
            return {"ok": False, "error": ERROR_WRITE_FAILED}
        env = self._flatpak_env()
        env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={env['XDG_RUNTIME_DIR']}/bus"
        try:
            code, _out, err = subprocess_util.run_command(
                ["steamosctl", "switch-to-desktop-mode"], timeout=FLATPAK_SECONDS, env=env, as_data_owner=True,
            )
        except Exception as e:
            code, err = -1, type(e).__name__
        if code != 0:
            decky.logger.warning("play: SteamOS didn't switch to Desktop Mode (%s)", str(err).strip()[:200])
            for path in (entry, script):
                try:
                    path.unlink()
                except OSError:
                    pass
            return {"ok": False, "error": "switch_failed"}
        decky.logger.info("play: switching to Desktop Mode to open %s", tool)
        return {"ok": True}

    def prepare_play(self, game_id: int, original: str) -> dict:
        current = self._session
        if current is not None and not current["exited"]:
            return {"ok": False, "error": ERROR_BUSY}
        if self.restore_record()["record"] is not None:
            return {"ok": False, "error": ERROR_BUSY}
        route, gate, detail = self._play_route(game_id)
        if route is None:
            return {"ok": False, "error": ERROR_GATE, "gate": gate, "detail": detail}
        if not route["fallback"]:
            return {"ok": False, "error": ERROR_NOT_READY}
        rom = session.quote(route["rom"])
        if route["kind"] == "retroarch":
            args = f"-L {session.quote(route['corePath'])} {rom}"
        elif route["kind"] == "dolphin":
            args = f"-e {rom}"
        elif route["kind"] == "rmg":
            args = f"--fullscreen --quit-after-emulation {rom}"
        else:
            args = rom
        sid = secrets.token_hex(8)
        try:
            ensure_dir(self._session_dir)
            chown_to_data_owner(self._session_dir)
            self._write_restore(route["appid"], original, sid, play_game=game_id)
        except OSError as e:
            decky.logger.warning("play: couldn't write the restore record (%s)", type(e).__name__)
            return {"ok": False, "error": ERROR_WRITE_FAILED}
        decky.logger.info("play: launching %s through the %s shortcut", game_id, route["kind"])
        return {
            "ok": True,
            "appid": route["appid"],
            "options": session.compose_launch_options(original, args),
            "original": original,
            "session": sid,
        }

    def _fallback_kinds(self, mode: str, system_id: int) -> tuple:
        if system_id in session.DOLPHIN_SYSTEMS:
            return ("dolphin",)
        if system_id == session.N64_SYSTEM:
            return ("retroarch", "rmg")
        if system_id == PSP_SYSTEM and mode == "link":
            return ("ppsspp", "retroarch")
        return ("retroarch",)

    def _fallback(self, mode: str, system_id: int) -> dict:
        kinds = self._fallback_kinds(mode, system_id)
        for kind in kinds:
            shortcut = self._emulator_shortcut(kind, None)
            if shortcut is not None:
                return {**shortcut, "kind": kind}
        return {"appid": 0, "name": "", "exe": "", "launchOptions": "", "kind": kinds[0]}

    def _emulator_shortcut(self, kind: str, install=""):
        held = self.restore_record()["record"]
        held = (held["appid"], held["original"]) if held is not None else None
        for shortcut in steam_shortcuts.emulator_shortcuts(self._user_home, held):
            if session.emulator_kind(shortcut["exe"], shortcut["launchOptions"]) != kind:
                continue
            if kind == "dolphin" and install is not None and session.dolphin_install(
                    shortcut["exe"], shortcut["launchOptions"], self._user_home) != install:
                continue
            return shortcut
        return None

    def _dolphin_version(self, install: str, shortcut: dict) -> str:
        if install == "flatpak":
            return self._flatpak_version(session.DOLPHIN_FLATPAK)
        if install != "appimage":
            return ""
        return self._appimage_version(
            session.dolphin_appimage(shortcut["exe"], shortcut["launchOptions"], self._user_home))

    def _appimage_version(self, image: str) -> str:
        try:
            st = os.stat(image)
        except OSError:
            return ""
        key = (image, st.st_mtime_ns, st.st_size)
        if key not in self._appimage_versions:
            self._appimage_versions[key] = self._read_appimage_version(image)
        return self._appimage_versions[key]

    def _read_appimage_version(self, image: str) -> str:
        folder = self._session_dir / f"appimage-{secrets.token_hex(4)}"
        try:
            ensure_dir(self._session_dir)
            chown_to_data_owner(self._session_dir)
            ensure_dir(folder)
            chown_to_data_owner(folder)
            code, _out, _err = subprocess_util.run_command(
                ["sh", "-c", 'cd "$1" && exec "$2" --appimage-extract "*.desktop"', "sh", str(folder), image],
                timeout=FLATPAK_SECONDS, env=self._flatpak_env(), as_data_owner=True,
            )
            if code != 0:
                return ""
            for desktop in (folder / "squashfs-root").glob("*.desktop"):
                for line in desktop.read_text(encoding="utf-8", errors="replace").splitlines():
                    if line.startswith("X-AppImage-Version="):
                        return proto.clean_user(line.split("=", 1)[1])
        except Exception as e:
            self._debug("reading the Dolphin AppImage's version failed (%s)", type(e).__name__)
        finally:
            shutil.rmtree(folder, ignore_errors=True)
        return ""

    def _device_id(self) -> str:
        if not self._device:
            machine_id = self._machine_id()
            self._device = (hashlib.sha256(f"cheevodeck-play-device|{machine_id}".encode("utf-8")).hexdigest()[:16]
                            if machine_id else secrets.token_hex(8))
        return self._device

    def _machine_id(self) -> str:
        machine_id = ""
        try:
            machine_id = Path("/etc/machine-id").read_text(encoding="ascii", errors="replace").strip()
        except OSError:
            pass
        if not machine_id or machine_id == "uninitialized":
            for path in sorted(Path("/sys/class/net").glob("*/address")):
                if path.parent.name != "lo":
                    try:
                        machine_id = path.read_text(encoding="ascii", errors="replace").strip()
                    except OSError:
                        continue
                    break
        return machine_id

    def _gates(self, mode: str, local: dict, room, players: int):
        warnings = []
        rom = Path(local["path"])
        system_id = local["systemId"]
        ra = local.get("ra")

        if local["fallback"] and not os.path.isfile(local["real"]):
            return ("rom_missing", {}), warnings

        if room is not None:
            if room.get("where") == "online" and _lan_only(mode, local):
                return (ERROR_LAN_ONLY, {}), warnings
            if mode == "couch":
                if local["core"] != room["core"]:
                    if not ra or not ra.installed(room["core"]):
                        return ("host_core_missing", {"core": room["coreName"] or room["core"]}), warnings
                    return ("match_host_core", {"core": room["coreName"] or room["core"]}), warnings
                crc = self._crc_of(local["real"]) if local["emulator"] == "retroarch" else ""
                if room["crc"] and crc and crc != room["crc"]:
                    if system_id == session.NES_SYSTEM:
                        return ("crc_mismatch", {}), warnings
                    warnings.append({"code": "crc_mismatch", "detail": {}})
            elif room["systemId"] == session.GBA_SYSTEM or system_id == session.GBA_SYSTEM:
                if room["systemId"] != system_id:
                    return ("different_game", {}), warnings
            elif room["systemId"] == session.GAMECUBE_SYSTEM or system_id == session.GAMECUBE_SYSTEM:
                if room["systemId"] != system_id:
                    return ("different_game", {}), warnings
                if room["gameId"] == local["gameId"] and room["gameCode"][3:] and local["gameCode"][3:] \
                        and room["gameCode"][3:] != local["gameCode"][3:]:
                    return ("region_differs", {}), warnings
            elif room["systemId"] == session.DS_SYSTEM or system_id == session.DS_SYSTEM:
                if room["systemId"] != system_id:
                    return ("different_game", {}), warnings
            elif room["systemId"] in GB_SYSTEMS or system_id in GB_SYSTEMS:
                if system_id not in GB_SYSTEMS or room["systemId"] not in GB_SYSTEMS:
                    return ("link_gb_both", {}), warnings
                if room["core"] != session.GAMBATTE or local["core"] != session.GAMBATTE:
                    return ("link_needs_gambatte_both", {}), warnings
            else:
                if room["systemId"] != system_id:
                    return ("different_game", {}), warnings
                if room["core"] not in (session.PPSSPP_CORE, session.PPSSPP_STANDALONE):
                    return ("link_needs_ppsspp", {}), warnings
                if room["core"] == local["core"] == session.PPSSPP_STANDALONE and room["emuVersion"] \
                        and local["emuVersion"] and room["emuVersion"] != local["emuVersion"]:
                    return ("ppsspp_version_mismatch", {"version": room["emuVersion"]}), warnings
                if room["gameId"] == local["gameId"] and room["hash"] \
                        and self._hash_of_path(local, system_id) not in ("", room["hash"]):
                    warnings.append({"code": "revision_differs", "detail": {}})
            if mode == "link" and room["gameId"] != local["gameId"]:
                warnings.append({"code": "game_differs", "detail": {}})
            versions_differ = local["core"] not in proto.NETPACKET_CORES and local["emulator"] not in ("dolphin", "rmg") \
                and _known(room["emuVersion"]) and _known(local["emuVersion"]) \
                and room["emuVersion"] != local["emuVersion"]
            if mode == "couch" and local["emulator"] == "dolphin" and room["emuVersion"] and local["emuVersion"] \
                    and room["emuVersion"] != local["emuVersion"]:
                return ("dolphin_version_mismatch", {"version": room["emuVersion"]}), warnings
            if local["emulator"] == "rmg" and room["emuVersion"] and local["emuVersion"] \
                    and room["emuVersion"] != local["emuVersion"]:
                return ("rmg_version_mismatch", {"version": room["emuVersion"]}), warnings
            if mode == "couch" and room["coreBuild"] and local["coreBuild"] \
                    and room["coreBuild"] != local["coreBuild"]:
                warnings.append({"code": "core_build_differs", "detail": {"core": room["coreName"]}})
            elif versions_differ:
                warnings.append({"code": "version_mismatch", "detail": {}})

        if ra is not None:
            key = ra.overriding_key(local["core"], rom)
            if key:
                return ("override", {"key": key}), warnings
            if mode == "couch" and players > 2 and local["core"] in session.MULTITAP \
                    and ra.remap_sets_device(local["core"], rom):
                return ("remap", {}), warnings
            if local.get("duckstation") or (local["fallback"] and system_id == session.PS1_SYSTEM
                                            and self._emulator_shortcut("duckstation") is not None):
                warnings.append({"code": "duckstation_switch", "detail": {"core": local["coreName"]}})
            elif local["core"] != local["shortcutCore"] and not local["fallback"]:
                if ra.sorts_saves_by_core(local["core"], rom):
                    detail = {"core": local["coreName"], "shortcutCore": local["shortcutCoreName"]}
                    if mode == "link":
                        return ("saves_by_core", detail), warnings
                    warnings.append({"code": "saves_by_core", "detail": detail})
                warnings.append({"code": "core_override",
                                 "detail": {"core": local["coreName"], "shortcutCore": local["shortcutCoreName"]}})
            if session.emudeck_netplay_on(self._user_home):
                return ("emudeck_netplay", {}), warnings
            if not self._flatpak_reads_home(session.RETROARCH_FLATPAK):
                return ("flatpak_permission", {}), warnings
        elif local["emulator"] == "ppsspp" and not self._flatpak_reads_home(session.PPSSPP_FLATPAK):
            return ("flatpak_permission", {}), warnings
        elif local["emulator"] == "rmg" and local["install"] == "flatpak" \
                and not self._flatpak_reads_home(session.RMG_FLATPAK):
            return ("flatpak_permission", {}), warnings
        return None, warnings

    def _hash_of_path(self, local: dict, system_id: int) -> str:
        return self._hash_of({"hash": local["hash"], "real": local["real"]}, system_id)

    def _players(self, mode: str, room) -> int:
        if mode != "couch":
            return 2
        if self._room is not None:
            return self._room["max"] if _drop_in(self._room) else 1 + len(_guests(self._room))
        if room is not None and _drop_in(room):
            return room["max"]
        if room is not None:
            seated = sum(1 for name in room["seats"] if name)
            joined = self._joined
            return max(2, seated if joined is not None and room is joined["row"] else seated + 1)
        return 2

    def check(self, mode: str, game_id: int, core: str, room_id: str = "") -> dict:
        joined = self._joined
        if joined is not None and self._room is None:
            return self._joined_check(joined)
        room = self._room_row(room_id) if self._room is None else None
        if self._room is not None:
            mode = self._room["mode"]
            game_id = self._room["gameId"]
            core = core or self._room["core"]
        local, gate, detail = self._local(mode, game_id, core, room)
        if local is None:
            return {"ok": True, "gate": gate, "detail": detail, "warnings": [], "local": None}
        found, warnings = self._gates(mode, local, room, self._players(mode, room))
        return {
            "ok": True,
            "gate": found[0] if found else None,
            "detail": found[1] if found else {},
            "warnings": warnings,
            "local": _local_view(local),
            "lanOnly": _lan_only(mode, local),
        }

    def _joined_check(self, joined: dict) -> dict:
        local = joined["local"]
        warnings = []
        if local is not None:
            row = joined["row"]
            _found, warnings = self._gates(row["mode"], local, row, self._players(row["mode"], row))
        return {
            "ok": True,
            "gate": None if joined["can"] else joined["reason"],
            "detail": {} if joined["can"] else joined["detail"],
            "warnings": warnings,
            "local": _local_view(local) if local is not None else None,
        }

    def _decide(self, row: dict, own_game: int, core: str):
        mode = row["mode"]
        players = self._players(mode, row)
        if mode == "couch":
            local, gate, detail = self._local(mode, row["gameId"], "", row)
            if local is not None:
                found, _warnings = self._gates(mode, local, row, players)
                if found:
                    gate, detail = found
            return (local, "", {}) if not gate else (None, gate, detail)
        library = self._library() or {}
        own = library.get(own_game) if own_game else None
        tries = []
        if own is not None and session.same_link_family(row["systemId"], own["systemId"]):
            tries.append((own_game, core))
        if row["gameId"] != own_game:
            tries.append((row["gameId"], ""))
        failed = None
        for game_id, chosen in tries:
            local, gate, detail = self._local(mode, game_id, chosen, row)
            if local is not None:
                found, _warnings = self._gates(mode, local, row, players)
                if not found:
                    return local, "", {}
                gate, detail = found
            failed = failed or (gate, detail)
        return None, failed[0], failed[1]

    async def host(self, mode: str, game_id: int, hardcore: bool, core: str = "", share: bool = False,
                   name: str = "", size: int = proto.DEFAULT_SEATS, password: str = "", status: str = "",
                   where: str = "local", watch: bool = False, friends: bool = False, voice: bool = False) -> dict:
        async with self._lock:
            refused = self._refusal()
            if refused is not None:
                return {"ok": False, "error": refused}
            if self._room is not None or self._joined is not None:
                return {"ok": False, "error": ERROR_BUSY}
            if mode not in proto.MODES:
                return {"ok": False, "error": ERROR_NO_GAME}
            online = where == "online"
            server = self._lobby_server() if online else None
            if online and server is None:
                return {"ok": False, "error": ERROR_NO_LOBBY}
            local, gate, detail = await asyncio.to_thread(self._local, mode, game_id, core, None)
            if local is not None:
                found, _warnings = await asyncio.to_thread(self._gates, mode, local, None, 2)
                if found:
                    gate, detail = found
            if gate:
                return {"ok": False, "error": ERROR_GATE, "gate": gate, "detail": detail}
            if online and _lan_only(mode, local):
                return {"ok": False, "error": ERROR_GATE, "gate": ERROR_LAN_ONLY, "detail": {}}
            described = await asyncio.to_thread(self._describe, mode, local)

            seats = min(max(size, 2), proto.MAX_SEATS)
            ulid, pic = self._identity()
            if friends and not ulid:
                return {"ok": False, "error": ERROR_FRIENDS_OFF}
            private = proto.is_password(password) and not friends
            room_id = secrets.token_hex(8)
            started = time.monotonic()
            if friends:
                key = secrets.token_bytes(32)
            else:
                key = await asyncio.to_thread(proto.room_key, password if private else "", room_id)
            key_ms = (time.monotonic() - started) * 1000
            user = self._user()
            room = {
                **described,
                "id": room_id,
                "key": key,
                "user": user,
                "name": proto.clean_room_name(name) or "Room",
                "status": status if status in proto.STATUSES else "",
                "where": "online" if online else "local",
                "mode": mode,
                "hardcore": bool(hardcore),
                "private": private,
                "friends": bool(friends),
                "owner": ulid if friends else "",
                "share": bool(share),
                "watch": bool(watch) and mode == "couch",
                "voice": bool(voice),
                "max": seats,
                "seats": [{"name": user, "host": True, "said": 0.0, "ulid": ulid, "pic": pic, "vc": False,
                           "vstamp": 1}] + [None] * (seats - 1),
                "inboxSeq": 0,
                "stampSeq": 1,
                "voiceSeq": 0,
                "turn": {},
                "turnSeq": 0,
                "turnAsk": None,
                "turnLeft": {},
                "turnAfter": 0.0,
                "passesUsed": set(),
                "state": "lobby",
                "rev": 1,
                "round": 0,
                "roster": [],
                "rosterAt": {},
                "ports": {},
                "players": 1,
                "startedAt": 0.0,
                "lastStart": None,
                "playingSince": None,
                "notice": None,
                "chat": [],
                "chatSeq": 0,
                "badAddresses": {},
                "badTotal": 0,
                "lockedUntil": 0.0,
                "bannedPeers": set(),
                "bannedNames": set(),
                "bannedDevices": set(),
                "freed": {},
                "addressGoneAt": 0.0,
                "address": _route_address(),
                "pv": PLUGIN_VERSION,
                "local": local,
            }
            if self._closed_tail is not None:
                self._shut()
            if not await self._open():
                return {"ok": False, "error": ERROR_UNAVAILABLE}
            if online:
                link = lobby_client.HostLink(
                    server=server, body=proto.room_body(room), on_request=self._converse,
                    on_tunnel=self._tunnel_ask, on_change=self._announce, debug=self._debug,
                )
                if not await link.open():
                    self._shut()
                    return {"ok": False, "error": ERROR_LOBBY_UNREACHABLE}
                self._link = link
            self._room = room
            self._tell_voice_room()
            self._closed_reason = ""
            self._seen.clear()
            self._seen_order.clear()
            self._housekeeper = self._spawn(self._keep_house(room))
            self._announce()
            decky.logger.info(
                "multiplayer: hosting %s, %s on %s, %s seats%s%s",
                local["gameId"], mode, local["core"], seats,
                f", with a password (key in {key_ms:.0f} ms)" if private else "",
                ", online" if online else "",
            )
            return {"ok": True, "room": self._host_view(room)}

    def _describe(self, mode: str, local: dict) -> dict:
        return {
            "title": local["title"],
            "gameId": local["gameId"],
            "systemId": local["systemId"],
            "emulator": local["emulator"],
            "core": local["core"],
            "coreName": local["coreName"],
            "emuVersion": local["emuVersion"],
            "hash": self._hash_of_path(local, local["systemId"]),
            "crc": self._crc_of(local["real"]) if mode == "couch" and local["emulator"] == "retroarch" else "",
            "coreBuild": local["coreBuild"],
            "gameCode": local["gameCode"],
        }

    async def room_options(self, hardcore=None, core=None, share=None, watch=None, voice=None) -> dict:
        room = self._room
        joined = self._joined
        if room is None and joined is not None and hardcore is not None:
            joined["hardcore"] = bool(hardcore)
            return {"ok": True}
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if voice is not None:
            if bool(voice) != room["voice"]:
                self._set_room_voice(room, bool(voice))
            if hardcore is None and core is None and share is None and watch is None:
                return {"ok": True, "room": self._host_view(room)}
        if room["state"] != "lobby":
            return {"ok": False, "error": ERROR_SEATED}
        if core is not None and core != room["core"]:
            return await self.change_game(room["mode"], room["gameId"], core)
        changed = False
        if hardcore is not None and bool(hardcore) != room["hardcore"]:
            room["hardcore"] = bool(hardcore)
            changed = True
        if share is not None and bool(share) != room["share"]:
            room["share"] = bool(share)
            changed = True
        if watch is not None and bool(watch) != room["watch"]:
            room["watch"] = bool(watch)
            changed = True
        if changed:
            self._changed(room)
        return {"ok": True, "room": self._host_view(room)}

    def _tell_voice_room(self) -> None:
        now = bool(self._room is not None and self._room["voice"]) or bool(
            self._joined is not None and self._joined["row"]["voice"])
        if now == self._in_voice_room:
            return
        self._in_voice_room = now
        if self._voice_room_changed is not None:
            try:
                self._voice_room_changed(now)
            except Exception as e:
                decky.logger.warning("multiplayer: couldn't tell the back buttons about voice (%s)", type(e).__name__)

    def _set_room_voice(self, room: dict, on: bool) -> None:
        room["voice"] = on
        self._tell_voice_room()
        if not on:
            for seat in room["seats"]:
                if seat is not None:
                    seat["vc"] = False
                    if "vq" in seat:
                        seat["vq"] = []
        decky.logger.info("multiplayer: voice chat turned %s for the room", "on" if on else "off")
        self._announce()

    def _changed(self, room: dict) -> None:
        room["rev"] += 1
        room["notice"] = None
        decky.logger.info("multiplayer: the room changed, rev %s", room["rev"])
        self._announce()

    async def change_game(self, mode: str, game_id: int, core: str = "") -> dict:
        async with self._lock:
            room = self._room
            if room is None:
                return {"ok": False, "error": ERROR_NO_ROOM}
            if room["state"] != "lobby":
                return {"ok": False, "error": ERROR_SEATED}
            if mode not in proto.MODES:
                return {"ok": False, "error": ERROR_NO_GAME}
            if mode == room["mode"] and game_id == room["gameId"] and core in ("", room["core"]):
                if room["notice"]:
                    room["notice"] = None
                    self._announce()
                return {"ok": True, "room": self._host_view(room)}
            local, gate, detail = await asyncio.to_thread(self._local, mode, game_id, core, None)
            if local is not None:
                found, _warnings = await asyncio.to_thread(self._gates, mode, local, None, 2)
                if found:
                    gate, detail = found
            if gate:
                decky.logger.info("multiplayer: the host's change to %s, %s was refused (%s)", game_id, mode, gate)
                room["notice"] = {"code": gate, "detail": detail}
                self._announce()
                return {"ok": False, "error": ERROR_GATE, "gate": gate, "detail": detail}
            described = await asyncio.to_thread(self._describe, mode, local)
            if self._room is not room or room["state"] != "lobby":
                return {"ok": False, "error": ERROR_SEATED}
            room.update(described, mode=mode, local=local)
            decky.logger.info("multiplayer: the host changed to %s, %s on %s", local["gameId"], mode, local["core"])
            self._changed(room)
            return {"ok": True, "room": self._host_view(room)}

    def close_room(self) -> dict:
        if self._room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        self._close_room("")
        return {"ok": True}

    def drop_seat(self, seat: int, name: str = "") -> dict:
        room = self._room
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if type(seat) is not int or not 1 <= seat < room["max"] or room["seats"][seat] is None:
            return {"ok": False, "error": ERROR_DROPPED}
        if name and room["seats"][seat]["name"] != name:
            return {"ok": False, "error": "seat_changed"}
        decky.logger.info("multiplayer: dropped seat %s", seat)
        dropped = room["seats"][seat]
        if dropped["door"] == "lan":
            room["bannedPeers"].add(dropped["peer"])
        room["bannedNames"].add(dropped["name"].lower())
        room["bannedDevices"].add(dropped["device"])
        room["seats"][seat] = None
        self._host_tunnels.close_seat(seat)
        self._voice_forget(room, seat)
        self._turn_forget(room, seat, dropped.get("ulid", ""))
        room["notice"] = None
        self._roster_left(room, seat)
        self._announce()
        return {"ok": True, "room": self._host_view(room)}

    def _close_room(self, reason: str) -> None:
        room = self._room
        if room is None:
            return
        self._room = None
        self._tell_voice_room()
        self._closed_reason = reason
        self._host_tunnels.close()
        if self._housekeeper is not None:
            self._housekeeper.cancel()
            self._housekeeper = None
        loop = self._loop
        if self._stopping or loop is None or loop.is_closed() or self._server is None:
            self._shut()
        else:
            tail = {"room": room["id"]}
            self._closed_tail = tail
            loop.call_later(CLOSED_TAIL_SECONDS, self._end_tail, tail)
        decky.logger.info("multiplayer: room closed%s", f" ({reason})" if reason else "")
        self._announce()

    def _end_tail(self, tail: dict) -> None:
        if self._closed_tail is tail and self._room is None:
            self._shut()

    def _host_view(self, room: dict) -> dict:
        return {
            "id": room["id"],
            "name": room["name"],
            "status": room["status"],
            "where": room["where"],
            "lobby": self._lobby_state(),
            "mode": room["mode"],
            "title": room["title"],
            "gameId": room["gameId"],
            "systemId": room["systemId"],
            "emulator": room["emulator"],
            "core": room["core"],
            "coreName": room["coreName"],
            "hardcore": room["hardcore"],
            "private": room["private"],
            "friends": room["friends"],
            "share": room["share"],
            "watch": room["watch"],
            "voice": room["voice"],
            "max": room["max"],
            "seats": [
                None if seat is None
                else {"name": seat["name"], "launched": False, "ready": False, "can": True, "title": room["title"],
                      "ulid": seat.get("ulid", ""), "pic": seat.get("pic", "")}
                if index == 0
                else {"name": seat["name"], "launched": seat["launched"], "ready": self._seat_ready(room, seat),
                      "can": seat["can"], "reason": seat["reason"], "title": seat["title"],
                      "ulid": seat["ulid"], "pic": seat["pic"]}
                for index, seat in enumerate(room["seats"])
            ],
            "state": self._public_state(room),
            "rev": room["rev"],
            "round": room["round"],
            "roster": list(room["roster"]),
            "canStart": self._can_start(room),
            "lastStart": dict(room["lastStart"]) if room["lastStart"] else None,
            "notice": dict(room["notice"]) if room["notice"] else None,
            "chat": list(room["chat"]),
        }

    def _public_state(self, room: dict) -> str:
        if room["state"] == "lobby":
            return "lobby"
        current = self._session
        if current is None or not current["seen"]:
            return "starting"
        if room["emulator"] == "dolphin" and room["mode"] == "link":
            return "playing"
        if room["emulator"] == "rmg":
            return "playing"
        if room["where"] == "online" and room["emulator"] == "ppsspp":
            return "playing"
        if room["emulator"] == "dolphin":
            return "playing" if _listening(session.DOLPHIN_NETPLAY_PORT, udp=True) else "starting"
        if _listening(proto.game_port(room["mode"], room["emulator"], room["core"])):
            return "playing"
        return "starting"

    async def _keep_house(self, room: dict) -> None:
        try:
            while self._room is room:
                await asyncio.sleep(HOUSEKEEPING_SECONDS)
                if self._room is not room:
                    return
                try:
                    self._tidy(room)
                except Exception as e:
                    decky.logger.warning("multiplayer: housekeeping failed (%s)", type(e).__name__)
        finally:
            self._stop_rmg_server(room["id"])

    def _tidy(self, room: dict) -> None:
        now = time.monotonic()
        for index, seat in enumerate(room["seats"]):
            if index == 0 or seat is None or (seat.get("launched") and room["state"] != "lobby"):
                continue
            if _boot_clock() - seat["last"] > SEAT_FREE_SECONDS:
                decky.logger.info("multiplayer: seat %s went quiet, freed", index)
                room["freed"][index] = seat["key"]
                room["seats"][index] = None
                self._host_tunnels.close_seat(index)
                self._voice_forget(room, index)
                self._turn_forget(room, index, seat.get("ulid", ""))
                self._toast_seat(seat["name"], "Left Room", "{{name}} left.")
                self._roster_left(room, index)

        addresses = set()
        if room["where"] == "local":
            addresses = {seat["ip"] for seat in _guests(room)}
            if room["address"]:
                addresses.add(room["address"])
        missing = sorted(address for address in addresses if not _address_exists(address))
        if not missing:
            room["addressGoneAt"] = 0.0
        elif not room["addressGoneAt"]:
            room["addressGoneAt"] = now
            decky.logger.info("multiplayer: this device no longer has %s, waiting for it", ", ".join(missing))
        elif now - room["addressGoneAt"] >= ADDRESS_GRACE_SECONDS:
            decky.logger.info("multiplayer: this device no longer has %s", ", ".join(missing))
            self._close_room(ERROR_NETWORK_CHANGED)
            return

        current = self._session
        if (
            room["state"] == "launching" and (current is None or not current["started"])
            and now - room["startedAt"] > LAUNCH_START_SECONDS
        ):
            decky.logger.info("multiplayer: the host's launch never started, back to the lobby")
            if current is not None:
                self._session = None
                self._remove_session_files(current["id"])
            self._back_to_lobby(room, ERROR_LAUNCH_FAILED)
        self._want_turn(room)
        if room["state"] != "lobby" and self._public_state(room) == "playing":
            if room["playingSince"] is None:
                room["playingSince"] = now
            else:
                waiting = [index for index in room["roster"]
                           if room["seats"][index] is not None and not room["seats"][index]["launched"]
                           and now - max(room["playingSince"], room["rosterAt"].get(index, 0.0)) > LAUNCH_WAIT_SECONDS]
                if waiting:
                    decky.logger.info("multiplayer: seats %s never launched, no longer waiting for them", waiting)
                    room["roster"] = [index for index in room["roster"] if index not in waiting]

        self._announce()

    def _notify_steps(self, role: str, emulator: str) -> None:
        if emulator == "rmg":
            line = "Create Session in RMG Netplay" if role == "host" else "Join in RMG Netplay"
        else:
            line = "Host in NetPlay" if role == "host" else "Connect in NetPlay"
        emit_notification(
            ntype="system",
            settings_store=self._settings_store,
            event_loop=self._loop,
            title_key="EZ Multiplayer",
            line_key=line,
            force_toast=True,
        )

    def _back_to_lobby(self, room: dict, error: str = "") -> None:
        room["state"] = "lobby"
        room["notice"] = None
        room["roster"] = []
        room["rosterAt"] = {}
        room["ports"] = {}
        room["playingSince"] = None
        if error:
            room["lastStart"] = {"round": room["round"], "ok": False, "error": error}
        decky.logger.info("multiplayer: the room is back in the lobby%s", f" ({error})" if error else "")
        self._announce()

    def launch_started(self) -> dict:
        current = self._session
        if current is None or current["started"]:
            return {"ok": False, "error": ERROR_NOT_READY}
        room = self._room
        if room is not None and room["state"] == "lobby":
            self._session = None
            self._remove_session_files(current["id"])
            return {"ok": False, "error": ERROR_NO_GUESTS}
        current["started"] = time.monotonic()
        current["watch"] = self._spawn(self._watch(current))
        if room is not None:
            decky.logger.info("multiplayer: host launched with %s guests", len(room["roster"]))
            return {"ok": True}
        joined = self._joined
        if joined is not None and not joined["launched"]:
            joined["launched"] = True
            if joined["status"] is not None:
                joined["launchedRound"] = joined["status"]["round"]
            self._spawn(self._ask(joined, "launched"))
            decky.logger.info("multiplayer: joined game launched")
            self._announce()
        return {"ok": True}

    def _heard(self, transport, data, addr) -> None:
        room = self._room
        if room is None:
            return
        message = decode(data)
        nonce = proto.read_seek(message, time.time())
        if nonce is None:
            return
        now = time.monotonic()
        while self._answered and now - self._answered[0] > 1.0:
            self._answered.popleft()
        if len(self._answered) >= ANSWERS_PER_SECOND:
            return
        if not self._fresh_nonce(nonce, now):
            return
        if room["friends"] and self._friend_pair(proto.seek_asker(message)) is None:
            return
        self._answered.append(now)
        try:
            transport.sendto(proto.make_room(room, nonce), addr)
        except OSError:
            pass

    async def _serve(self, reader, writer) -> None:
        try:
            await self._converse(lobby_client.LanConversation(reader, writer))
        finally:
            writer.close()

    async def _converse(self, conversation) -> None:
        peer = conversation.peer
        cap = HANDSHAKES_PER_ADDRESS if conversation.door == "lan" else HANDSHAKES_PER_RELAYED_ADDRESS
        if (
            (self._room is None and self._closed_tail is None)
            or self._handshakes >= MAX_HANDSHAKES
            or self._peer_handshakes.get(peer, 0) >= cap
        ):
            return
        self._handshakes += 1
        self._peer_handshakes[peer] = self._peer_handshakes.get(peer, 0) + 1
        try:
            await asyncio.wait_for(self._answer(conversation), HANDSHAKE_SECONDS)
        except (asyncio.TimeoutError, asyncio.IncompleteReadError, OSError, FrameError):
            pass
        except Exception as e:
            decky.logger.exception("multiplayer: a request failed (%s)", type(e).__name__)
        finally:
            self._handshakes -= 1
            left = self._peer_handshakes.get(peer, 1) - 1
            if left > 0:
                self._peer_handshakes[peer] = left
            else:
                self._peer_handshakes.pop(peer, None)

    async def _answer(self, conversation) -> None:
        opening = await asyncio.wait_for(conversation.read(), FIRST_FRAME_SECONDS)
        hello = proto.read_hello(opening)
        room = self._room
        if hello is None:
            return
        op, opened = hello
        if room is None:
            if self._closed_tail is not None and op in proto.TAGGED_OPS:
                await conversation.say({"ok": False, "error": "closed"})
            return
        if op == "info":
            if room["friends"] and self._friend_pair(proto.seek_asker(opening)) is None:
                return
            await conversation.say(proto.room_body(room))
            return
        if op == "join":
            await self._admit(conversation, room, opened)
            return
        await self._seat_request(conversation, room, opening)

    async def _admit(self, conversation, room: dict, opened: dict) -> None:
        peer = conversation.peer
        door = conversation.door
        now = time.monotonic()
        if self._locked_out(room, peer, now):
            await conversation.say({"ok": False, "error": "locked"})
            return
        nc = opened["nc"]
        invite = proto.read_pass(opened["pass"], time.time()) if opened["pass"] is not None else None
        if opened["pass"] is not None and invite is None:
            await conversation.say({"ok": False, "error": "expired"})
            return
        friend = opened["friend"] if room["friends"] and invite is None else ""
        pair = self._friend_pair(friend) if friend else None
        if room["friends"] and invite is None and pair is None:
            await conversation.say({"ok": False, "error": "friends_only"})
            return
        ns = secrets.token_hex(16)
        private = proto.dh_private()
        ga = format(opened["ga"], "0512x")
        gb = proto.dh_public(private)
        await conversation.say({"ns": ns, "room": room["id"], "gb": gb}, True)
        request = await conversation.read()
        raw = request.get("params")
        params = proto.read_join_params(raw)
        if params is None:
            return
        if self._room is not room:
            await conversation.say({"ok": False, "error": "closed"})
            return
        key = room["key"]
        if invite is not None:
            key = proto.pass_key(key, room["id"], invite[0], invite[1])
        elif pair is not None:
            key = proto.friend_key(pair, room["id"])
        if (
            not verify(key, request.get("t"), "join", nc, ns, room["id"], ga, gb, proto.canonical(raw))
            or (invite is not None and (params["ulid"] != invite[0] or invite in room["passesUsed"]))
            or (pair is not None and params["ulid"] != friend)
        ):
            self._bad_tag(room, peer, now)
            await conversation.say({"ok": False, "error": "friends_only" if pair is not None else "bad_code"})
            return
        if (
            (door == "lan" and peer in room["bannedPeers"])
            or params["user"].lower() in room["bannedNames"]
            or params["device"] in room["bannedDevices"]
        ):
            await conversation.say({"ok": False, "error": "dropped"})
            return
        seat = next((index for index, taken in enumerate(room["seats"]) if taken is None), None)
        if seat is None:
            await conversation.say({"ok": False, "error": "full"})
            return
        address = conversation.own_ip
        if not proto.is_ipv4(address):
            return
        room["seats"][seat] = {
            "name": params["user"],
            "peer": peer,
            "door": door,
            "device": params["device"],
            "ulid": params["ulid"],
            "pic": params["pic"],
            "ip": address,
            "key": proto.seat_key(key, nc, ns, proto.dh_shared(private, opened["ga"])),
            "inbox": [],
            "last": _boot_clock(),
            "launched": False,
            "seq": -1,
            "ready": False,
            "rev": 0,
            "round": 0,
            "can": True,
            "reason": "",
            "title": "",
            "gameId": 0,
            "since": 0,
            "said": 0.0,
            "vc": False,
            "vstamp": room["stampSeq"] + 1,
            "vq": [],
            "vtimes": deque(),
        }
        room["stampSeq"] += 1
        if invite is not None:
            room["passesUsed"].add(invite)
        await conversation.say({"ok": True, "seat": seat, "ip": address,
                                "t": proto.joined_tag(key, nc, ns, seat, address, ga, gb)})
        decky.logger.info("multiplayer: seat %s taken%s", seat, " through the online lobby" if door == "server" else "")
        self._announce()
        toast_keys = [params["device"] if door == "server" else peer, "name:" + params["user"].lower()]
        for stale in [name for name, at in self._join_toasts.items() if now - at >= JOIN_TOAST_SECONDS]:
            del self._join_toasts[stale]
        if all(key not in self._join_toasts for key in toast_keys):
            for key in toast_keys:
                self._join_toasts[key] = now
            self._toast_seat(params["user"], "Join Room", "{{name}} joined.")

    async def _tunnel_ask(self, link, ask: dict) -> None:
        room = self._room
        index = ask["seat"]
        seat = room["seats"][index] if room is not None and index < room["max"] else None
        if (
            room is None
            or seat is None
            or seat["door"] != "server"
            or room["state"] == "lobby"
            or index not in room["roster"]
            or (ask["kind"], ask["port"]) not in proto.tunnel_ports(room["mode"], room["emulator"], room["core"])
            or not hmac.compare_digest(ask["token"], proto.tunnel_token(seat["key"], ask["port"]))
            or self._host_tunnels.full(index)
        ):
            self._debug("refused a tunnel for seat %s, %s %s", index, ask["kind"], ask["port"])
            await link.send({"op": "tunnel_no", "tid": ask["tid"]})
            return
        self._host_tunnels.answer(link, ask)

    def _locked_out(self, room: dict, peer: str, now: float) -> bool:
        if room["lockedUntil"] > now:
            return True
        entry = room["badAddresses"].get(peer)
        return entry is not None and entry[1] > now

    def _bad_tag(self, room: dict, peer: str, now: float) -> None:
        count, until = room["badAddresses"].get(peer, (0, 0.0))
        count += 1
        if count >= BAD_TAGS_PER_ADDRESS:
            room["badAddresses"][peer] = (0, now + LOCKOUT_SECONDS)
            decky.logger.info("multiplayer: too many wrong passwords from one device, locked out for %ss",
                              LOCKOUT_SECONDS)
        else:
            room["badAddresses"][peer] = (count, until)
        room["badTotal"] += 1
        if room["badTotal"] >= BAD_TAGS_PER_ROOM:
            room["lockedUntil"] = now + LOCKOUT_SECONDS
            room["badTotal"] = 0
            decky.logger.info("multiplayer: too many wrong passwords, no joins for %ss", LOCKOUT_SECONDS)

    async def _seat_request(self, conversation, room: dict, message: dict) -> None:
        parsed = proto.read_tagged(message)
        if parsed is None:
            return
        room_id, index, nonce, _stamp = parsed
        if room_id != room["id"]:
            await conversation.say({"ok": False, "error": "closed"})
            return
        seat = room["seats"][index] if index < room["max"] else None
        if seat is None or not proto.tagged_ok(seat["key"], message, time.time()):
            freed = room["freed"].get(index)
            if freed is not None and proto.tagged_ok(freed, message, time.time()):
                await conversation.say({"ok": False, "error": "timed_out"})
            elif seat is None:
                await conversation.say({"ok": False, "error": "dropped"})
            return
        now = time.monotonic()
        if not self._fresh_nonce(nonce, now):
            return
        seat["last"] = _boot_clock()

        op = message["op"]
        if op == "leave":
            room["seats"][index] = None
            self._host_tunnels.close_seat(index)
            self._voice_forget(room, index)
            self._turn_forget(room, index, seat.get("ulid", ""))
            decky.logger.info("multiplayer: seat %s left", index)
            await conversation.say({"ok": True})
            self._toast_seat(seat["name"], "Left Room", "{{name}} left.")
            self._roster_left(room, index)
            self._announce()
            return
        self._take_report(room, index, seat, proto.read_report(message.get("p")))
        seat["since"] = proto.chat_since(message.get("p"))
        delivered = proto.inbox_since(message.get("p"))
        seat["inbox"] = [item for item in seat["inbox"] if item["seq"] > delivered]
        self._take_voice_flags(room, index, seat, message.get("p"))
        if op == "voice":
            await conversation.say(self._seat_voice(room, index, seat, message.get("p"), now))
            return
        if op == "friend":
            await conversation.say({"ok": self._seat_friend(room, index, seat, message.get("p"))})
            return
        if op == "pass":
            await conversation.say(self._seat_pass(room, seat, nonce, message.get("p")))
            return
        if op == "say":
            said = self._chat(room, seat, (message.get("p") or {}).get("text"), now)
            await conversation.say({"ok": said})
            return
        if op == "launched":
            decky.logger.info("multiplayer: seat %s launched", index)
            await conversation.say({"ok": True})
            self._announce()
            return
        await conversation.say(proto.status_reply(seat["key"], nonce, self._status_body(room, index, seat)))
        self._announce()

    def _seat_friend(self, room: dict, index: int, seat: dict, raw) -> bool:
        asked = proto.read_friend_ask(raw)
        friends = self._friends
        if asked is None or friends is None or not seat["ulid"] or asked["to"] == index:
            return False
        key = None
        if asked["act"] == "ask":
            key = proto.unwrap(seat["key"], "pair", asked["n"], asked["k"])
            if key is None:
                return False
        if asked["to"] == 0:
            if asked["act"] == "ask":
                return friends.local_request(seat["ulid"], seat["name"], seat["pic"], key)
            return friends.local_answer(seat["ulid"], asked["act"] == "accept", seat["name"], seat["pic"])
        target = room["seats"][asked["to"]] if asked["to"] < room["max"] else None
        if target is None or not target["ulid"]:
            return False
        self._push_inbox(room, target, index, asked["act"], key)
        return True

    def _push_inbox(self, room: dict, target: dict, sender: int, act: str, key) -> None:
        room["inboxSeq"] += 1
        item = {"seq": room["inboxSeq"], "from": sender, "ulid": room["seats"][sender].get("ulid", ""), "act": act}
        if key is not None:
            item["n"] = secrets.token_hex(16)
            item["k"] = proto.wrap(target["key"], "pair", item["n"], key)
        target["inbox"] = (target["inbox"] + [item])[-proto.INBOX_MAX:]

    def _take_voice_flags(self, room: dict, index: int, seat: dict, raw) -> None:
        delivered = proto.voice_since(raw)
        seat["vq"] = [item for item in seat["vq"] if item["n"] > delivered]
        wanted = proto.voice_wanted(raw) and room["voice"]
        if wanted == seat["vc"]:
            return
        seat["vc"] = wanted
        if not wanted:
            self._voice_forget(room, index)
        else:
            self._want_turn(room)
        self._debug("voice: seat %s %s", index, "joined" if wanted else "left")
        self._announce()

    def _seat_voice(self, room: dict, index: int, seat: dict, raw, now: float) -> dict:
        if not room["voice"]:
            return {"ok": False, "error": "off"}
        times = seat["vtimes"]
        while times and now - times[0] > VOICE_RATE_SECONDS:
            times.popleft()
        if len(times) >= VOICE_PER_SEAT:
            self._debug("voice: seat %s is sending too fast", index)
            return {"ok": False, "error": "rate"}
        times.append(now)
        item = proto.read_voice_send(raw)
        if item is None:
            return {"ok": False, "error": "seat"}
        to = item["to"]
        target = room["seats"][to] if to < room["max"] else None
        if to == index or target is None or not seat["vc"] or not target.get("vc"):
            return {"ok": False, "error": "seat"}
        sent = {"from": index, "vs": seat["vstamp"], "kind": item["kind"], "sdp": item["sdp"], "gen": item["gen"]}
        self._debug("voice: %s from seat %s to seat %s, gen %s", item["kind"], index, to, item["gen"])
        if to == 0:
            self._emit(sent, VOICE_EVENT)
        else:
            self._push_voice(room, target, sent)
        return {"ok": True}

    def _push_voice(self, room: dict, target: dict, item: dict) -> None:
        room["voiceSeq"] += 1
        queue = target["vq"]
        if item["kind"] == "offer":
            queue = [old for old in queue if not (old["from"] == item["from"] and old["kind"] == "offer")]
        elif item["kind"] == "bye":
            queue = [old for old in queue if old["from"] != item["from"]]
        target["vq"] = (queue + [{**item, "n": room["voiceSeq"]}])[-proto.VOICE_INBOX_MAX:]

    def _voice_forget(self, room: dict, index: int) -> None:
        for seat in room["seats"]:
            if seat is not None and "vq" in seat:
                seat["vq"] = [item for item in seat["vq"] if item["from"] != index]

    def voice_join(self, on: bool) -> dict:
        room = self._room
        if room is not None:
            own = room["seats"][0]
            wanted = bool(on) and room["voice"]
            if wanted != own["vc"]:
                own["vc"] = wanted
                if not wanted:
                    self._voice_forget(room, 0)
                else:
                    self._want_turn(room)
                decky.logger.info("multiplayer: %s voice chat", "joined" if wanted else "left")
                self._watch_output(wanted)
                self._announce()
            return {"ok": True, "on": wanted}
        joined = self._joined
        if joined is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        wanted = bool(on) and joined["row"]["voice"]
        if wanted != joined["vc"]:
            joined["vc"] = wanted
            joined["fastUntil"] = time.monotonic() + VOICE_FAST_SECONDS
            decky.logger.info("multiplayer: %s voice chat", "joined" if wanted else "left")
            self._watch_output(wanted)
            self._spawn(self._poll_once(joined))
        return {"ok": True, "on": wanted}

    def _in_voice(self) -> bool:
        room, joined = self._room, self._joined
        if room is not None:
            return bool(room["voice"] and room["seats"][0]["vc"])
        return joined is not None and bool(joined["vc"])

    def voice_canceller(self, on: bool) -> dict:
        canceller = self._voice_canceller
        if canceller is None:
            return {"ok": True, "active": False, "duck": False, "kind": ""}
        if not on:
            canceller.stop()
            return {"ok": True, "active": False, "duck": False, "kind": ""}
        if not self._in_voice():
            return {"ok": False, "error": ERROR_NO_ROOM}
        state = canceller.start(self._in_voice, self._output_changed)
        return {"ok": True, **state}

    def _output_changed(self, reason: str, kind: str) -> None:
        self._emit({"reason": reason, "output": kind}, VOICE_CANCELLER_EVENT)

    def _watch_output(self, on: bool) -> None:
        canceller = self._voice_canceller
        loop = self._loop
        if canceller is None or loop is None or loop.is_closed():
            return
        if on:
            loop.run_in_executor(None, canceller.watch, self._in_voice, self._output_changed)
        else:
            loop.run_in_executor(None, canceller.close)

    def voice_duck(self, on: bool, db=-12) -> dict:
        canceller = self._voice_canceller
        return {"ok": canceller is not None and canceller.duck(on, db)}

    async def voice_send(self, to: int, kind: str, sdp: str, gen: int) -> dict:
        item = proto.read_voice_send({"voice": {"to": to, "kind": kind, "sdp": sdp, "gen": gen}})
        if item is None:
            return {"ok": False, "error": "seat"}
        room = self._room
        if room is not None:
            own = room["seats"][0]
            target = room["seats"][to] if 0 < to < room["max"] else None
            if not room["voice"]:
                return {"ok": False, "error": "off"}
            if target is None or not own["vc"] or not target.get("vc"):
                return {"ok": False, "error": "seat"}
            self._debug("voice: %s to seat %s, gen %s", kind, to, gen)
            self._push_voice(room, target, {"from": 0, "vs": own["vstamp"], "kind": item["kind"], "sdp": item["sdp"],
                                            "gen": item["gen"]})
            return {"ok": True}
        joined = self._joined
        if joined is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if not joined["vc"] or to == joined["seat"]:
            return {"ok": False, "error": "seat"}
        joined["fastUntil"] = time.monotonic() + VOICE_FAST_SECONDS
        _nonce, reply = await self._ask(joined, "voice", {"voice": item})
        if self._joined is joined:
            self._spawn(self._poll_once(joined))
        if isinstance(reply, dict) and reply.get("ok") is True:
            return {"ok": True}
        error = reply.get("error") if isinstance(reply, dict) else None
        return {"ok": False, "error": error if error in ("rate", "seat", "off") else ERROR_HOST_GONE}

    def voice_config(self) -> dict:
        room, joined = self._room, self._joined
        row = room if room is not None else joined["row"] if joined is not None else None
        if row is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if row["where"] != "online":
            return {"ok": True, "servers": [], "policy": "all", "available": True}
        server = self._lobby_server()
        cred = room["turn"].get(0) if room is not None else joined["turn"]
        relay = _access(row) == "public" or self._voice_relay
        if server is None or (relay and cred is None):
            return {"ok": True, "servers": [], "policy": "relay", "available": False}
        servers = [] if relay else [{"urls": [f"stun:{server[0]}:{TURN_PORT}"]}]
        if cred is not None:
            servers.append({"urls": [f"turn:{server[0]}:{TURN_PORT}?transport=udp"], "username": cred["u"],
                            "credential": cred["p"]})
        return {"ok": True, "servers": servers, "policy": "relay" if relay else "all", "available": True}

    def _want_turn(self, room: dict) -> None:
        if (
            room["where"] != "online" or not room["voice"] or self._link is None or room["turnAsk"] is not None
            or time.monotonic() < room["turnAfter"]
            or not any(seat is not None and seat.get("vc") for seat in room["seats"])
        ):
            return
        held = room["turn"]
        for index, seat in enumerate(room["seats"]):
            left = room["turnLeft"].get(index)
            if seat is None or left is None:
                continue
            if left["ulid"] and seat.get("ulid") == left["ulid"]:
                held[index] = left["cred"]
            del room["turnLeft"][index]
        now = time.time()
        missing = any(seat is not None and seat.get("vc") and index not in held for index, seat in enumerate(room["seats"]))
        if not missing and not any(_turn_due(cred, now) for cred in held.values()):
            return
        room["turnAsk"] = self._spawn(self._mint_turn(room))

    def _turn_forget(self, room: dict, index: int, ulid: str = "") -> None:
        cred = room["turn"].pop(index, None)
        if cred is not None:
            room["turnLeft"][index] = {"ulid": ulid, "cred": cred}
            self._debug("voice: seat %s's relay credential dropped", index)

    async def _mint_turn(self, room: dict) -> None:
        try:
            await asyncio.sleep(TURN_DEBOUNCE_SECONDS)
            link = self._link
            if self._room is not room or link is None:
                return
            creds = await link.ask_turn(room["max"])
            if self._room is not room:
                return
            creds = [cred for cred in creds or [] if cred["u"].split(":")[1] == room["id"]]
            if len(creds) < room["max"]:
                room["turnAfter"] = time.monotonic() + TURN_RETRY_SECONDS
                decky.logger.info("multiplayer: the online lobby gave no voice relay credentials")
                return
            renewed = bool(room["turn"])
            now = time.time()
            fresh = {index: {**cred, "expires": int(cred["u"].split(":")[0]), "n": secrets.token_hex(16)}
                     for index, cred in enumerate(creds)}
            kept = {index: cred for index, cred in room["turn"].items() if not _turn_due(cred, now)}
            room["turn"] = {**fresh, **kept}
            room["turnSeq"] += 1
            if renewed and kept:
                seats = ", ".join(str(index) for index in sorted(set(fresh) - set(kept)))
                decky.logger.info("multiplayer: voice relay credentials ready for seat %s", seats)
            else:
                decky.logger.info("multiplayer: voice relay credentials %s", "renewed" if renewed else "ready")
            self._announce()
        finally:
            room["turnAsk"] = None

    def _seat_pass(self, room: dict, seat: dict, nonce: str, raw) -> dict:
        ulid = raw.get("ulid") if isinstance(raw, dict) else None
        if not proto.is_ulid(ulid):
            return {"ok": False}
        if not room["private"]:
            return {"ok": True, "exp": 0, "k": ""}
        expires = proto.pass_expiry(time.time())
        key = proto.pass_key(room["key"], room["id"], ulid, expires)
        return {"ok": True, "exp": expires, "k": proto.wrap(seat["key"], "pass", nonce, key)}

    def _inbox_item(self, joined: dict, status: dict, item: dict) -> None:
        friends = self._friends
        sender = item["from"]
        if friends is None or sender >= len(status["members"]):
            return
        ulid = status["ids"][sender]["ulid"]
        name = status["members"][sender]
        pic = status["ids"][sender]["pic"]
        if not ulid or not name or ulid != item["ulid"]:
            return
        if item["act"] == "ask":
            key = proto.unwrap(joined["key"], "pair", item["n"], item["k"])
            if key is not None:
                friends.local_request(ulid, name, pic, key)
            return
        friends.local_answer(ulid, item["act"] == "accept", name, pic)

    def seat_identity(self, index: int):
        room = self._room
        if room is not None:
            seat = room["seats"][index] if 0 <= index < room["max"] else None
            if seat is None or not seat.get("ulid"):
                return None
            return {"ulid": seat["ulid"], "name": seat["name"], "pic": seat.get("pic", "")}
        joined = self._joined
        status = joined["status"] if joined is not None else None
        if status is None or not 0 <= index < len(status["members"]) or not status["ids"][index]["ulid"]:
            return None
        return {"ulid": status["ids"][index]["ulid"], "name": status["members"][index], "pic": status["ids"][index]["pic"]}

    def seat_of(self, ulid: str):
        room = self._room
        if room is not None:
            return next((index for index, seat in enumerate(room["seats"])
                         if index > 0 and seat is not None and seat["ulid"] == ulid), None)
        joined = self._joined
        status = joined["status"] if joined is not None else None
        if status is None:
            return None
        return next((index for index, entry in enumerate(status["ids"])
                     if index != joined["seat"] and entry["ulid"] == ulid), None)

    async def send_friend(self, index: int, act: str, key=None) -> bool:
        room = self._room
        if room is not None:
            target = room["seats"][index] if 0 < index < room["max"] else None
            if target is None or not target["ulid"]:
                return False
            self._push_inbox(room, target, 0, act, key)
            return True
        joined = self._joined
        if joined is None or index == joined["seat"]:
            return False
        extra = {"act": act, "to": index}
        if key is not None:
            extra["n"] = secrets.token_hex(16)
            extra["k"] = proto.wrap(joined["key"], "pair", extra["n"], key)
        _nonce, reply = await self._ask(joined, "friend", extra)
        return isinstance(reply, dict) and reply.get("ok") is True

    async def invite_pass(self, ulid: str):
        room = self._room
        if room is not None:
            expires = proto.pass_expiry(time.time()) if room["private"] else 0
            key = proto.pass_key(room["key"], room["id"], ulid, expires) if room["private"] else None
            address = next((seat["ip"] for seat in _guests(room) if seat["door"] == "lan"), "") \
                or _route_address() or room["address"]
            return {"room": room["id"], "name": room["name"], "title": room["title"], "where": room["where"],
                    "exp": expires, "key": key, "address": address}
        joined = self._joined
        if joined is None:
            return None
        nonce, reply = await self._ask(joined, "pass", {"ulid": ulid})
        if not isinstance(reply, dict) or reply.get("ok") is not True or type(reply.get("exp")) is not int:
            return None
        row = joined["row"]
        key = None
        if row["private"]:
            key = proto.unwrap(joined["key"], "pass", nonce, reply.get("k"))
            if key is None or reply["exp"] <= 0:
                return None
        return {"room": row["room"], "name": row["name"], "title": row["title"], "where": row["where"],
                "exp": reply["exp"], "key": key, "address": row["address"] if row["door"] == "lan" else ""}

    def current_room(self):
        room = self._room
        if room is not None:
            return {"id": room["id"], "name": room["name"], "where": room["where"], "playing": room["state"] != "lobby"}
        joined = self._joined
        if joined is not None:
            row = joined["row"]
            status = joined["status"]
            return {"id": row["room"], "name": row["name"], "where": row["where"],
                    "playing": status is not None and status["state"] != "lobby"}
        return None

    def room_game(self) -> str:
        if self._room is not None:
            return self._room["title"]
        if self._joined is not None:
            return self._joined["row"]["title"]
        return ""

    def _take_report(self, room: dict, index: int, seat: dict, report) -> None:
        if report is None or report["seq"] <= seat["seq"]:
            return
        was_ready = self._seat_ready(room, seat)
        seat.update(seq=report["seq"], ready=report["ready"], rev=report["rev"], round=report["round"],
                    can=report["can"], reason=report["reason"], gameId=report["gameId"],
                    title=report["title"], launched=report["launched"])
        if self._seat_ready(room, seat) != was_ready:
            self._debug("seat %s %s", index, "ready" if not was_ready else "not ready")
        if self._late_ready(room, index, seat):
            room["roster"].append(index)
            room["ports"][index] = index
            room["rosterAt"][index] = time.monotonic()
            decky.logger.info("multiplayer: seat %s joined round %s while it runs", index, room["round"])
            self._announce()

    def _seat_ready(self, room: dict, seat: dict) -> bool:
        return (
            room["state"] == "lobby"
            and seat["ready"]
            and seat["can"]
            and not seat["launched"]
            and seat["rev"] == room["rev"]
            and seat["round"] == room["round"]
        )

    def _late_ready(self, room: dict, index: int, seat: dict) -> bool:
        return (
            _drop_in(room)
            and room["state"] != "lobby"
            and index not in room["roster"]
            and seat["ready"]
            and seat["can"]
            and not seat["launched"]
            and seat["rev"] == room["rev"]
            and seat["round"] == room["round"]
        )

    def _can_start(self, room: dict) -> bool:
        if room["state"] != "lobby" or self._in_game():
            return False
        if _drop_in(room):
            return True
        return any(self._seat_ready(room, seat) for seat in _guests(room))

    def _status_body(self, room: dict, index: int, seat: dict) -> dict:
        roster = room["roster"] if room["state"] != "lobby" else []
        last = room["lastStart"]
        body = {
            "ok": True,
            "seat": index,
            "state": self._public_state(room),
            "members": [taken["name"] if taken else "" for taken in room["seats"]],
            "hardcore": room["hardcore"],
            "ip": seat["ip"],
            "rev": room["rev"],
            "round": room["round"],
            "start": index in roster,
            "port": room["ports"].get(index, 0) if room["state"] != "lobby" else 0,
            "players": room["players"] if room["state"] != "lobby" else self._players(room["mode"], room),
            "seats": [
                {"ready": False, "can": True, "launched": False, "playing": False, "title": ""}
                if taken is None or position == 0
                else {"ready": self._seat_ready(room, taken), "can": taken["can"], "launched": taken["launched"],
                      "playing": position in roster, "title": taken["title"]}
                for position, taken in enumerate(room["seats"])
            ],
            "lastStart": dict(last) if last else None,
            "room": proto.status_room_fields(room),
            "chat": [],
            "ids": [{"ulid": taken.get("ulid", ""), "pic": taken.get("pic", "")} if taken else {"ulid": "", "pic": ""}
                    for taken in room["seats"]],
            "inbox": list(seat["inbox"]),
        }
        for position, taken in enumerate(room["seats"]):
            if taken is not None:
                body["seats"][position]["vc"] = taken.get("vc", False)
                body["seats"][position]["vs"] = taken.get("vstamp", 0)
        cred = room.get("turn", {}).get(index)
        if cred is not None and seat.get("vc"):
            body["turn"] = {"u": cred["u"], "p": proto.wrap_turn(seat["key"], cred["n"], cred["p"]), "ttl": cred["ttl"],
                            "n": cred["n"]}
        body["voice"] = []
        queue = seat.get("vq", [])
        if queue:
            budget = proto.REPLY_BYTES - len(proto.canonical(body)) - proto.CHAT_REPLY_BYTES
            if len(proto.canonical(queue[0])) + 1 > budget:
                for entry in body["seats"]:
                    entry["title"] = ""
                budget = proto.REPLY_BYTES - len(proto.canonical(body)) - proto.CHAT_REPLY_BYTES
            body["voice"] = proto.voice_page(queue, budget)
        if proto.REPLY_BYTES - len(proto.canonical(body)) < proto.CHAT_REPLY_BYTES // 2:
            for entry in body["seats"]:
                entry["title"] = ""
        body["chat"] = proto.chat_page(room["chat"], seat["since"], proto.REPLY_BYTES - len(proto.canonical(body)))
        return body

    def _chat(self, room: dict, seat: dict, raw, now: float) -> bool:
        text = proto.clean_chat(raw)
        if not text or len(text) > proto.CHAT_MAX or now - seat["said"] < CHAT_GAP_SECONDS:
            return False
        seat["said"] = now
        room["chatSeq"] += 1
        room["chat"].append({"seq": room["chatSeq"], "name": seat["name"], "text": text})
        del room["chat"][:-proto.CHAT_KEPT]
        self._announce()
        return True

    async def say(self, text: str) -> dict:
        room = self._room
        if room is not None:
            ok = self._chat(room, room["seats"][0], text, time.monotonic())
            if ok and room["notice"] and room["notice"]["code"] == ERROR_CHAT:
                room["notice"] = None
            if not ok:
                room["notice"] = {"code": ERROR_CHAT, "detail": {}}
                self._announce()
                return {"ok": False, "error": ERROR_CHAT}
            return {"ok": True}
        joined = self._joined
        if joined is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        cleaned = proto.clean_chat(text)
        reply = None
        if cleaned and len(cleaned) <= proto.CHAT_MAX:
            _nonce, reply = await self._ask(joined, "say", {"text": cleaned})
        if not (isinstance(reply, dict) and reply.get("ok") is True):
            if self._joined is joined:
                joined["notice"] = ERROR_CHAT
                self._announce()
            return {"ok": False, "error": ERROR_CHAT}
        if self._joined is joined:
            joined["notice"] = ""
            self._spawn(self._poll_once(joined))
        return {"ok": True}

    def start(self) -> dict:
        room = self._room
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        if room["state"] != "lobby":
            return {"ok": False, "error": ERROR_NOT_LOBBY}
        if self._in_game():
            return {"ok": False, "error": ERROR_BUSY}
        drop_in = _drop_in(room)
        if not drop_in and not _guests(room):
            return {"ok": False, "error": ERROR_NO_GUESTS}
        if not self._can_start(room):
            return {"ok": False, "error": ERROR_NOBODY_READY}
        room["roster"] = [index for index, seat in enumerate(room["seats"])
                          if index > 0 and seat is not None and self._seat_ready(room, seat)]
        room["rosterAt"] = {}
        if drop_in:
            room["ports"] = {index: index for index in room["roster"]}
            room["players"] = room["max"]
        else:
            room["ports"] = {index: position + 1 for position, index in enumerate(room["roster"])}
            room["players"] = 1 + len(room["roster"])
        room["round"] += 1
        room["state"] = "launching"
        room["startedAt"] = time.monotonic()
        room["lastStart"] = None
        room["notice"] = None
        room["playingSince"] = None
        decky.logger.info("multiplayer: start, round %s with seats %s", room["round"], room["roster"])
        self._announce()
        return {"ok": True, "appid": room["local"]["appid"], "title": room["title"], "round": room["round"]}

    def start_cancel(self, error: str) -> dict:
        room = self._room
        if room is None or room["state"] == "lobby":
            return {"ok": True}
        current = self._session
        if current is not None and current["started"]:
            return {"ok": False, "error": ERROR_BUSY}
        if current is not None:
            self._session = None
            self._remove_session_files(current["id"])
        self._back_to_lobby(room, error if error and proto.is_reason(error) else ERROR_LAUNCH_FAILED)
        return {"ok": True}

    def _roster_left(self, room: dict, index: int) -> None:
        if index not in room["roster"]:
            return
        room["roster"] = [taken for taken in room["roster"] if taken != index]
        current = self._session
        if not room["roster"] and room["state"] != "lobby" and (current is None or not current["started"]):
            decky.logger.info("multiplayer: everyone in the start left before the game, back to the lobby")
            self._back_to_lobby(room)

    async def _collect(self, packet: bytes, read) -> dict:
        found = {}

        def heard(data, addr):
            if len(found) >= ROOMS_FOUND_MAX:
                return
            row = read(decode(data))
            if row is not None:
                row.update(address=addr[0], door="lan", away=False)
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
        self._fresh_nonce(nonce, time.monotonic())
        server = self._lobby_server()
        if server is None:
            self._online = {}
            self._online_error = ""
        elif self._listing is None or self._listing.done():
            self._listing = self._spawn(self._list_online(server))
        found = await self._collect(
            proto.make_seek(nonce, int(time.time()), self._identity()[0]),
            lambda message: proto.read_room(message, nonce),
        )
        if server is not None and not self._listing.done():
            await asyncio.wait({self._listing}, timeout=LIST_GRACE_SECONDS)
        self._round += 1
        own = self._room["id"] if self._room is not None else None
        for room_id, row in found.items():
            held = self._rooms.get(room_id)
            if held is not None and held[0]["door"] == "lan" and held[0]["address"] != row["address"] \
                    and (held[2] or self._round - held[1] < MISSED_ROUNDS):
                continue
            if room_id != own and (held is not None or len(self._rooms) < ROOMS_KEPT_MAX):
                self._rooms[room_id] = (row, self._round, False)
        for room_id, (row, seen, manual) in list(self._rooms.items()):
            if row["door"] == "server" and room_id not in self._online:
                del self._rooms[room_id]
            elif not manual and self._round - seen >= MISSED_ROUNDS:
                del self._rooms[room_id]
        for room_id, row in self._online.items():
            held = self._rooms.get(room_id)
            if room_id != own and (held is None or held[0]["door"] == "server" or self._prefer_server):
                self._rooms[room_id] = (row, self._round, False)
        self._debug("discovery round %s found %s, %s online", self._round, len(found), len(self._online))
        rows = self._room_rows()
        if rows and self._room is None and self._joined is None:
            verdicts = await asyncio.to_thread(self._verdicts, rows)
            for row in rows:
                row["verdict"] = verdicts[row["room"]]
        return {"ok": True, "rooms": rows, "onlineError": self._online_error}

    async def _list_online(self, server) -> None:
        try:
            listed = await lobby_client.list_rooms(server, self._identity()[0])
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError) as e:
            if not self._online_error:
                decky.logger.info("multiplayer: couldn't reach the online lobby (%s)", type(e).__name__)
            self._online = {}
            self._online_error = "unreachable"
            return
        online = {}
        for body, away in listed:
            row = proto.read_room(body)
            if row is not None and row["where"] == "online":
                row.update(address="", door="server", away=away)
                online[row["room"]] = row
        self._online = online
        self._online_error = ""

    def _verdicts(self, rows: list) -> dict:
        stamp = self._cheevo_check_store.results_fingerprint()
        if len(self._verdict_memo) > 64:
            self._verdict_memo.clear()
        found = {}
        for row in rows:
            key = (row["room"], row["mode"], row["gameId"], row["core"], row["hash"], row["coreBuild"],
                   row["emuVersion"], row["gameCode"], stamp)
            verdict = self._verdict_memo.get(key)
            if verdict is None or not verdict["can"]:
                local, reason, detail = self._decide(row, 0, "")
                verdict = {"can": local is not None, "reason": reason, "detail": detail}
                self._verdict_memo[key] = verdict
            found[row["room"]] = verdict
        return found

    def _room_rows(self) -> list:
        rows = [dict(row) for row, _seen, _manual in self._rooms.values()
                if not row["friends"] or self._friend_pair(row["owner"]) is not None]
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
            asking = {"op": "info", "v": proto.VERSION}
            me = self._identity()[0]
            if me:
                asking["u"] = me
            writer.write(frame(asking))
            await asyncio.wait_for(writer.drain(), HANDSHAKE_SECONDS)
            row = proto.read_room(await asyncio.wait_for(read_frame(reader), HANDSHAKE_SECONDS))
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError):
            row = None
        finally:
            writer.close()
        if row is None:
            return {"ok": False, "error": ERROR_NOT_FOUND}
        row.update(address=address, door="lan", away=False)
        self._rooms[row["room"]] = (row, self._round, True)
        return {"ok": True, "room": dict(row)}

    async def join(self, room_id: str, password: str, hardcore: bool = False, invite=None) -> dict:
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
            if row["private"] and invite is None and not proto.is_password(password):
                return {"ok": False, "error": ERROR_NEEDS_CODE}
            pair = self._friend_pair(row["owner"]) if row["friends"] and invite is None else None
            if row["friends"] and invite is None and pair is None:
                return {"ok": False, "error": ERROR_FRIENDS_ONLY}
            local, reason, detail = await asyncio.to_thread(self._decide, row, 0, "")
            params = proto.join_params(
                self._user(),
                self._hash_of_path(local, local["systemId"]) if local else "",
                self._crc_of(local["real"]) if local and row["mode"] == "couch" and local["emulator"] == "retroarch" else "",
                local["core"] if local else "",
                local["emuVersion"] if local else "",
                self._device_id(),
                *self._identity(),
            )
            friend = ""
            if invite is not None:
                key, shown = invite["key"], {"ulid": invite["ulid"], "exp": invite["exp"]}
            elif pair is not None:
                key, shown, friend = proto.friend_key(pair, row["room"]), None, params["ulid"]
            else:
                key = await asyncio.to_thread(proto.room_key, password if row["private"] else "", row["room"])
                shown = None
            try:
                answer = await asyncio.wait_for(self._ask_to_join(row, key, params, shown, friend),
                                                HANDSHAKE_SECONDS * 2)
            except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError):
                answer = {"ok": False, "error": ERROR_HOST_GONE}
            if not answer["ok"]:
                return answer
            self._joined = {
                "row": row,
                "seat": answer["seat"],
                "ip": "127.0.0.1" if row["door"] == "server" else row["address"],
                "ownIp": answer["ownIp"],
                "key": answer["key"],
                "status": None,
                "failures": 0,
                "heard": time.monotonic(),
                "goneAt": 0.0,
                "launched": False,
                "error": "",
                "local": local,
                "can": local is not None,
                "reason": reason,
                "detail": detail,
                "own": 0,
                "core": "",
                "rowRev": 0,
                "hardcore": bool(hardcore),
                "seq": 0,
                "said": None,
                "ready": False,
                "readyRev": 0,
                "readyRound": 0,
                "consentRound": 0,
                "fanfareRound": 0,
                "autostartRound": 0,
                "launchedRound": 0,
                "notice": "",
                "clock": (time.time(), time.monotonic()),
                "chat": [],
                "chatSince": 0,
                "fsince": 0,
                "vc": False,
                "vsince": 0,
                "fastUntil": 0.0,
                "turn": None,
                "turnSeq": 0,
            }
            self._tell_voice_room()
            self._closed_reason = ""
            self._poller = self._spawn(self._poll(self._joined))
            decky.logger.info("multiplayer: joined a room, seat %s%s", answer["seat"],
                              " through the online lobby" if row["door"] == "server" else "")
            self._announce()
            return {"ok": True, **self._guest_view(self._joined)}

    async def _dial(self, row: dict, first: dict):
        if row["door"] == "server":
            server = self._lobby_server()
            if server is None:
                raise OSError("no lobby server")
            return await lobby_client.open_ask(server, row["room"], first)
        reader, writer = await asyncio.open_connection(row["address"], self._peer_port)
        try:
            writer.write(frame(first))
            await asyncio.wait_for(writer.drain(), HANDSHAKE_SECONDS)
        except BaseException:
            writer.close()
            raise
        return reader, writer

    async def _ask_to_join(self, row: dict, key: bytes, params: dict, shown=None, friend: str = "") -> dict:
        nc = secrets.token_hex(16)
        private = proto.dh_private()
        ga = await asyncio.to_thread(proto.dh_public, private)
        first = {"op": "join", "v": proto.VERSION, "nc": nc, "ga": ga}
        if shown is not None:
            first["pass"] = shown
        if friend:
            first["friend"] = friend
        reader, writer = await self._dial(row, first)
        own = (writer.get_extra_info("sockname") or ("",))[0]
        try:
            hello = await read_frame(reader)
            if hello.get("ok") is False:
                return {"ok": False, "error": _JOIN_REFUSALS.get(hello.get("error"), ERROR_HOST_GONE)}
            ns = hello.get("ns")
            gb = hello.get("gb")
            other = proto.read_dh(gb)
            if not is_nonce(ns) or hello.get("room") != row["room"] or other is None:
                return {"ok": False, "error": ERROR_ROOM_GONE}
            writer.write(frame({"op": "join", "params": params,
                                "t": proto.join_tag(key, nc, ns, row["room"], params, ga, gb)}))
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
            or not proto.is_ipv4(own)
            or not verify(key, answer.get("t"), "joined", nc, ns, str(seat), address, ga, gb)
        ):
            return {"ok": False, "error": ERROR_HOST_GONE}
        shared = await asyncio.to_thread(proto.dh_shared, private, other)
        return {"ok": True, "seat": seat, "ip": address, "ownIp": own, "key": proto.seat_key(key, nc, ns, shared)}

    async def _poll(self, joined: dict) -> None:
        while self._joined is joined:
            try:
                answered = await self._poll_once(joined)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                decky.logger.warning("multiplayer: a status poll failed (%s)", type(e).__name__)
                answered = False
            if not answered:
                await asyncio.sleep(POLL_BACKOFF_SECONDS)
            elif time.monotonic() < joined["fastUntil"]:
                await asyncio.sleep(VOICE_POLL_SECONDS)
            else:
                await asyncio.sleep(POLL_SECONDS)

    async def _poll_once(self, joined: dict) -> bool:
        nonce, reply = await self._ask(joined, "status")
        if self._joined is not joined:
            return True
        if reply is not None and reply.get("ok") is False and reply.get("error") in ("dropped", "timed_out", "closed"):
            gone = {"dropped": ERROR_DROPPED, "timed_out": ERROR_TIMED_OUT}.get(reply["error"], ERROR_CLOSED)
            decky.logger.info("multiplayer: the host %s", {
                ERROR_DROPPED: "dropped this seat",
                ERROR_TIMED_OUT: "freed this seat while this device was away",
            }.get(gone, "closed the room"))
            self._drop_joined(tell_host=False, reason=gone)
            return True
        status = proto.read_status_reply(joined["key"], reply, nonce) if reply is not None else None
        now = time.monotonic()
        if status is None:
            joined["failures"] += 1
            self._debug("status poll failed (%s in a row)", joined["failures"])
            if joined["error"] == ERROR_HOST_GONE:
                if now - joined["goneAt"] >= HOST_GONE_GRACE_SECONDS:
                    self._drop_joined(tell_host=False, reason=ERROR_HOST_GONE)
            elif not joined["launched"] and now - joined["heard"] > SEAT_SILENCE_SECONDS:
                joined["error"] = ERROR_HOST_GONE
                joined["goneAt"] = now
                decky.logger.info("multiplayer: lost the host")
                self._announce()
            return False
        joined["failures"] = 0
        joined["heard"] = now
        if joined["error"] == ERROR_HOST_GONE:
            joined["error"] = ""
            decky.logger.info("multiplayer: the host answered again")
        if status["rev"] != joined["rowRev"]:
            await self._follow_room(joined, status)
            if self._joined is not joined:
                return True
        self._take_status(joined, status)
        return True

    async def _follow_room(self, joined: dict, status: dict) -> None:
        row = {**status["room"], "address": joined["row"]["address"], "door": joined["row"]["door"], "away": False}
        rev = status["rev"]
        if (row["mode"], row["gameId"]) != (joined["row"]["mode"], joined["row"]["gameId"]):
            joined.update(own=0, core="")
        joined["row"] = row
        joined["rowRev"] = rev
        own = joined["own"]
        local, reason, detail = await asyncio.to_thread(self._decide, row, own, joined["core"])
        if self._joined is not joined or joined["rowRev"] != rev or joined["own"] != own:
            return
        joined.update(local=local, can=local is not None, reason=reason, detail=detail)
        self._debug("the room changed, this seat %s", "can play" if local is not None else f"can't ({reason})")

    def _take_status(self, joined: dict, status: dict) -> None:
        joined["status"] = status
        for item in status["inbox"]:
            if item["seq"] > joined["fsince"]:
                joined["fsince"] = item["seq"]
                self._inbox_item(joined, status, item)
        allowed = status["room"]["voice"]
        if allowed != joined["row"]["voice"]:
            joined["row"] = {**joined["row"], "voice": allowed}
        if not allowed and joined["vc"]:
            joined["vc"] = False
            decky.logger.info("multiplayer: the host turned voice chat off")
        self._tell_voice_room()
        turn = status["turn"]
        if turn is not None and turn["u"] != (joined["turn"] or {}).get("u"):
            password = proto.unwrap_turn(joined["key"], turn["n"], turn["p"])
            if password is not None:
                joined["turn"] = {"u": turn["u"], "p": password}
                joined["turnSeq"] += 1
                self._debug("voice: a relay credential from the host")
        heard = [item for item in status["voice"] if item["n"] > joined["vsince"]]
        if heard:
            joined["vsince"] = heard[-1]["n"]
            joined["fastUntil"] = time.monotonic() + VOICE_FAST_SECONDS
        fresh = [entry for entry in status["chat"] if entry["seq"] > joined["chatSince"]]
        if fresh:
            joined["chat"] = (joined["chat"] + fresh)[-proto.CHAT_KEPT:]
            joined["chatSince"] = fresh[-1]["seq"]
        if (
            joined["ready"] and status["state"] != "lobby" and status["start"] and _drop_in(joined["row"])
            and status["round"] == joined["readyRound"] and status["rev"] == joined["readyRev"]
        ):
            joined["consentRound"] = status["round"]
            joined["ready"] = False
        if joined["ready"] and (status["rev"] != joined["readyRev"] or status["round"] != joined["readyRound"]):
            if status["start"] and status["round"] == joined["readyRound"] + 1 and status["rev"] == joined["readyRev"]:
                joined["consentRound"] = status["round"]
            joined["ready"] = False
        self._expire_ready(joined)
        self._follow_start(joined, status)
        self._announce()
        for item in heard:
            self._debug("voice: %s from seat %s, gen %s", item["kind"], item["from"], item["gen"])
            self._emit({name: item[name] for name in ("from", "vs", "kind", "sdp", "gen")}, VOICE_EVENT)

    def _expire_ready(self, joined: dict) -> None:
        wall, mono = time.time(), time.monotonic()
        then_wall, then_mono = joined["clock"]
        joined["clock"] = (wall, mono)
        slept = (wall - then_wall) - (mono - then_mono) > SLEEP_JUMP_SECONDS
        if joined["ready"] and slept:
            decky.logger.info("multiplayer: ready cleared, the device slept")
            joined["ready"] = False

    def _may_launch(self, joined: dict, status: dict) -> bool:
        if joined["consentRound"] != status["round"]:
            return False
        if joined["launchedRound"] == status["round"]:
            return joined["row"]["mode"] == "couch" and joined["row"]["emulator"] == "retroarch"
        return True

    def _follow_start(self, joined: dict, status: dict) -> None:
        number = status["round"]
        if not status["start"] or status["state"] == "lobby" or joined["consentRound"] != number:
            return
        if joined["fanfareRound"] != number:
            joined["fanfareRound"] = number
            self._emit({"state": "starting", "room": joined["row"]["room"], "round": number})
        if (
            status["state"] == "playing"
            and joined["autostartRound"] != number
            and not joined["launched"]
            and joined["local"] is not None
        ):
            joined["autostartRound"] = number
            decky.logger.info("multiplayer: the host is in game, starting round %s here", number)
            self._emit({"state": "autostart", "room": joined["row"]["room"], "round": number,
                        "steps": _steps(joined["row"]), "game": joined["row"]["title"],
                        "appid": joined["local"]["appid"]})

    def _pending_start(self, joined: dict):
        status = joined["status"]
        if (
            status is None or joined["launched"] or joined["local"] is None
            or joined["autostartRound"] != status["round"] or joined["consentRound"] != status["round"]
            or joined["launchedRound"] == status["round"] or status["state"] != "playing"
        ):
            return None
        return {"room": joined["row"]["room"], "round": status["round"], "appid": joined["local"]["appid"],
                "steps": _steps(joined["row"]), "game": joined["row"]["title"]}

    def _report(self, joined: dict) -> dict:
        local = joined["local"]
        reason = joined["reason"] if proto.is_reason(joined["reason"]) else "unsupported_emulator"
        said = (joined["ready"], joined["readyRev"], joined["readyRound"], joined["can"], reason,
                local["gameId"] if local else 0, local["title"] if local else "", joined["launched"], joined["hardcore"])
        if said != joined["said"]:
            joined["said"] = said
            joined["seq"] += 1
        return proto.report(
            seq=joined["seq"], ready=joined["ready"], rev=joined["readyRev"], round_=joined["readyRound"],
            can=joined["can"], reason=reason, game_id=local["gameId"] if local else 0,
            title=local["title"] if local else "", launched=joined["launched"], hardcore=joined["hardcore"],
        )

    def guest_games(self) -> dict:
        joined = self._joined
        if joined is None or joined["row"]["mode"] != "link":
            return {"ok": False, "error": ERROR_NO_ROOM}
        row = joined["row"]
        library = self._library() or {}
        players = self._players("link", row)
        games = []
        fallback_on = self._fallback_on()
        for entry in library.values():
            if not fallback_on and not any(path["shortcut"] for path in entry["paths"]):
                continue
            if not session.same_link_family(row["systemId"], entry["systemId"]):
                continue
            local, _gate, _detail = self._local("link", entry["gameId"], "", row)
            if local is None or self._gates("link", local, row, players)[0] is not None:
                continue
            games.append({"gameId": entry["gameId"], "title": entry["title"], "systemId": entry["systemId"],
                          "system": entry["system"], "imageIcon": entry["imageIcon"]})
        games.sort(key=lambda game: game["title"].lower())
        return {"ok": True, "games": games}

    async def guest_game(self, game_id: int) -> dict:
        joined = self._joined
        if joined is None or joined["row"]["mode"] != "link":
            return {"ok": False, "error": ERROR_NO_ROOM}
        joined.update(own=game_id, core="", ready=False, consentRound=0)
        rev = joined["rowRev"]
        local, reason, detail = await asyncio.to_thread(self._decide, joined["row"], game_id, "")
        if self._joined is not joined:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if joined["own"] == game_id and joined["rowRev"] == rev:
            joined.update(local=local, can=local is not None, reason=reason, detail=detail,
                          notice="" if local is not None else reason)
        self._spawn(self._push_ready(joined))
        self._announce()
        return {"ok": True, **self._guest_view(joined)}

    def set_ready(self, ready: bool, reason: str = "") -> dict:
        joined = self._joined
        if joined is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        status = joined["status"]
        if ready:
            late = (status is not None and status["state"] == "playing" and _drop_in(joined["row"])
                    and not status["start"] and not joined["launched"])
            if status is None or (status["state"] != "lobby" and not late):
                return {"ok": False, "error": ERROR_NOT_LOBBY}
            if joined["local"] is None:
                return {"ok": False, "error": ERROR_GATE, "gate": joined["reason"], "detail": joined["detail"]}
            if self._in_game():
                return {"ok": False, "error": ERROR_IN_GAME}
            joined["readyRev"] = status["rev"]
            joined["readyRound"] = status["round"]
            joined["notice"] = ""
        else:
            joined["consentRound"] = 0
            if reason and proto.is_reason(reason):
                joined["notice"] = reason
        joined["ready"] = bool(ready)
        self._spawn(self._push_ready(joined))
        self._announce()
        return {"ok": True, **self._guest_view(joined)}

    async def _push_ready(self, joined: dict) -> None:
        nonce, reply = await self._ask(joined, "ready")
        status = proto.read_status_reply(joined["key"], reply, nonce) if reply is not None else None
        if status is not None and self._joined is joined:
            self._take_status(joined, status)

    async def _ask(self, joined: dict, op: str, extra=None):
        nonce = secrets.token_hex(16)
        payload = {**self._report(joined), "since": joined["chatSince"], "fsince": joined["fsince"],
                   "vc": joined["vc"], "vsince": joined["vsince"], **(extra or {})}
        message = proto.make_tagged(joined["key"], op, joined["row"]["room"], joined["seat"], nonce, int(time.time()),
                                    payload)
        try:
            reader, writer = await asyncio.wait_for(self._dial(joined["row"], message), HANDSHAKE_SECONDS)
        except (OSError, asyncio.TimeoutError, FrameError):
            return nonce, None
        try:
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

    def _drop_joined(self, *, tell_host: bool, reason: str = "") -> None:
        joined = self._joined
        if joined is None:
            return
        self._joined = None
        self._tell_voice_room()
        self._closed_reason = reason
        self._close_guest_tunnels()
        if self._poller is not None:
            self._poller.cancel()
            self._poller = None
        if tell_host and joined["error"] != ERROR_HOST_GONE:
            loop = self._loop
            if self._stopping:
                self._goodbye = self._ask(joined, "leave")
            elif loop is not None and not loop.is_closed():
                self._spawn(self._ask(joined, "leave"))
        decky.logger.info("multiplayer: left the room")
        self._announce()

    def _guest_view(self, joined: dict) -> dict:
        status = joined["status"]
        return {
            "room": dict(joined["row"]),
            "seat": joined["seat"],
            "ip": joined["ip"],
            "status": {name: value for name, value in status.items() if name not in ("inbox", "voice", "turn")}
                      if status else None,
            "launched": joined["launched"],
            "error": joined["error"],
            "ready": joined["ready"],
            "consented": status is not None and joined["consentRound"] == status["round"] and status["start"],
            "rejoin": status is not None and status["state"] == "playing" and not joined["launched"]
                      and self._may_launch(joined, status) and joined["launchedRound"] == status["round"],
            "notice": joined["notice"],
            "hardcore": joined["hardcore"],
            "local": _local_view(joined["local"]) if joined["local"] is not None else None,
            "can": joined["can"],
            "reason": joined["reason"],
            "detail": joined["detail"],
            "chat": list(joined["chat"]),
            "autostart": self._pending_start(joined),
        }

    def room_status(self) -> dict:
        seq = self._event_seq
        if self._room is not None:
            return {"ok": True, "seq": seq, "role": "host", "room": self._host_view(self._room),
                    "voice": self._voice_view()}
        if self._joined is not None:
            return {"ok": True, "seq": seq, "role": "guest", **self._guest_view(self._joined),
                    "voice": self._voice_view()}
        return {"ok": True, "seq": seq, "role": None, "closedReason": self._closed_reason,
                "lobby": self._lobby_server() is not None}

    def _write(self, path: Path, text: str) -> None:
        with atomic_file(path) as out:
            out.write(text.encode("utf-8"))

    def _readable_by_owner(self, paths) -> bool:
        owner = child_owner()
        if owner is None:
            return True
        for path in paths:
            try:
                st = os.stat(path)
            except OSError:
                return False
            if st.st_uid != owner[0] or not st.st_mode & 0o400:
                return False
        return True

    def prepare_launch(self, original: str, hardcore: bool) -> dict:
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        stale = self._session
        if stale is not None and stale["started"] and not stale["exited"]:
            return {"ok": False, "error": ERROR_BUSY}
        held = self.restore_record()["record"]
        unlaunched = stale is not None and not stale["started"]
        if held is not None and not (unlaunched and held["session"] == stale["id"]):
            return {"ok": False, "error": ERROR_BUSY}
        if unlaunched:
            self._session = None
            self._remove_session_files(stale["id"])
            self._close_guest_tunnels_soon()
        room = self._room
        joined = self._joined
        if room is not None:
            if room["state"] != "launching":
                return {"ok": False, "error": ERROR_NOT_READY}
            roster = [room["seats"][index] for index in room["roster"] if room["seats"][index] is not None]
            if not roster and not _drop_in(room):
                return {"ok": False, "error": ERROR_NO_GUESTS}
            role = "host"
            mode = room["mode"]
            local = room["local"]
            seat = 0
            host_ip = next((taken["ip"] for taken in roster if taken["door"] == "lan"), "") \
                or _route_address() or room["address"]
            own_ip = host_ip
            hardcore = room["hardcore"] if mode == "couch" else bool(hardcore)
            share = room["share"]
            watch = room["watch"]
            players = room["max"] if _drop_in(room) else 1 + len(roster)
            peer = None
            relay = self._relay_host() if room["where"] == "online" else ""
        elif joined is not None:
            status = joined["status"]
            if (
                joined["launched"] or joined["error"] or status is None or status["state"] != "playing"
                or not status["start"] or not self._may_launch(joined, status) or joined["local"] is None
            ):
                return {"ok": False, "error": ERROR_NOT_READY}
            role = "guest"
            mode = joined["row"]["mode"]
            local = joined["local"]
            seat = status["port"]
            host_ip = joined["ip"]
            own_ip = joined["ownIp"]
            hardcore = status["hardcore"] if mode == "couch" else joined["hardcore"]
            share = joined["row"]["share"]
            watch = joined["row"].get("watch", False)
            players = status["players"]
            peer = joined["row"]
            relay = self._relay_host() if joined["row"]["where"] == "online" else ""
        else:
            return {"ok": False, "error": ERROR_NO_ROOM}

        found, _warnings = self._gates(mode, local, peer, players)
        if found:
            return {"ok": False, "error": ERROR_GATE, "gate": found[0], "detail": found[1]}
        where = room["where"] if room is not None else joined["row"]["where"]
        if local["emulator"] == "rmg" and room is not None and where != "online" and not self._start_rmg_server(room):
            return {"ok": False, "error": ERROR_RMG_SERVER}
        if held is not None:
            if held["appid"] != local["appid"]:
                return {"ok": False, "error": ERROR_BUSY}
            original = held["original"]

        relayed = joined is not None and room is None and joined["row"]["door"] == "server"
        if relayed:
            if not self._open_guest_tunnels(joined, mode, local):
                return {"ok": False, "error": ERROR_TUNNEL}

        sid = secrets.token_hex(8)
        rom = Path(local["path"])
        nick = self._user()
        try:
            ensure_dir(self._session_dir)
            chown_to_data_owner(self._session_dir)
            if local["emulator"] == "retroarch":
                ra = local["ra"]
                cfg_path = self._session_dir / f"session-{sid}.cfg"
                opt_path = self._session_dir / f"session-{sid}.opt"
                system_dir = None
                if mode == "link" and local["core"] == session.MELONDS_DS:
                    system_dir = self._session_dir / f"session-{sid}.system"
                    self._build_system_folder(ra, rom, system_dir)
                cfg_text, opt_text = session.retroarch_session(
                    ra, core=local["core"], rom=rom, mode=mode, role=role, hardcore=hardcore, opt_path=opt_path,
                    guests=players - 1, seat=seat, host_ip=host_ip, players=players, game_code=local["gameCode"],
                    system_dir=system_dir, share_controls=share, watch_only=watch,
                )
                self._write(opt_path, opt_text)
                self._write(cfg_path, cfg_text)
                files = [cfg_path, opt_path]
                core_path = ra.core_path(local["core"]) if local["core"] != local["shortcutCore"] else None
                args = session.retroarch_args(mode=mode, role=role, host_ip=host_ip, nick=nick,
                                              cfg_path=cfg_path, core_path=core_path, core=local["core"],
                                              rom=rom if local.get("duckstation") or local["fallback"] else None)
                guest_round = mode == "couch" and role == "guest"
                if (core_path is not None or guest_round) and not local.get("duckstation"):
                    self._back_up_save(ra, local)
            elif local["emulator"] == "dolphin":
                marker = self._session_dir / f"session-{sid}.dolphin"
                self._write(marker, "")
                files = [marker]
                if mode == "couch":
                    args = session.dolphin_netplay_args(
                        host_ip=own_ip if role == "host" else host_ip, nick=nick, hardcore=hardcore, marker=marker,
                        connect_port=DOLPHIN_TUNNEL_PORT if relayed else proto.DOLPHIN_NETPLAY_PORT,
                    )
                else:
                    args = session.dolphin_bba_args(own_ip=own_ip, mac=session.bba_mac(self._machine_id()),
                                                    hardcore=hardcore, marker=marker,
                                                    rom=rom if local["fallback"] else None)
            elif local["emulator"] == "rmg":
                home = self._session_dir / f"session-{sid}.rmg"
                self._build_rmg_home(home, local, nick, self._relay_host() if where == "online" else host_ip, rom)
                files = [home]
                options = session.rmg_launch_options(original, local["install"], home)
            else:
                ini_path = self._session_dir / f"session-{sid}.ini"
                text = session.ppsspp_session(role=role, host_ip=host_ip, nick=nick,
                                              mac=session.psp_mac(self._machine_id()), hardcore=hardcore, relay=relay)
                self._write(ini_path, text)
                files = [ini_path]
                args = session.ppsspp_args(home=self._user_home, ini_path=ini_path,
                                           rom=rom if local["fallback"] else None)
            if not self._readable_by_owner(files):
                raise OSError("session files are not the home owner's")
            self._write_restore(local["appid"], original, sid)
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't write the session files (%s)", type(e).__name__)
            if relayed:
                self._close_guest_tunnels_soon()
            return {"ok": False, "error": ERROR_WRITE_FAILED}

        self._session = {
            "id": sid,
            "appid": local["appid"],
            "role": role,
            "mode": mode,
            "emulator": local["emulator"],
            "files": files,
            "started": 0.0,
            "seen": False,
            "exited": False,
            "error": "",
            "watch": None,
        }
        if local["emulator"] != "rmg":
            options = session.compose_launch_options(original, args)
        decky.logger.info("multiplayer: session %s ready for %s as %s", sid, mode, role)
        return {
            "ok": True,
            "appid": local["appid"],
            "options": options,
            "original": original,
            "session": sid,
        }

    def _start_rmg_server(self, room: dict) -> bool:
        current = self._rmg_server
        if current is not None and current["proc"].poll() is None:
            return True
        if _listening(session.RMG_SERVER_PORT):
            return True
        path = self._rmg_server_path()
        if path is None or not path.is_file():
            decky.logger.warning("multiplayer: no RMG netplay server at %s", path)
            return False
        try:
            os.chmod(path, 0o755)
        except OSError:
            pass
        owner = child_owner()
        argv = [str(path), "-name", "local-server", "-enable-auth", "-max-games", str(RMG_SERVER_GAMES),
                "-log-path", str(self._session_dir / RMG_SERVER_LOG)]
        try:
            ensure_dir(self._session_dir)
            (self._session_dir / RMG_SERVER_LOG).unlink(missing_ok=True)
            proc = subprocess.Popen(
                argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                env={**subprocess_util.system_env(), "RMG_AUTH": session.RMG_AUTH},
                user=owner[0] if owner else None, group=owner[1] if owner else None,
                extra_groups=[] if owner else None, start_new_session=True,
            )
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't start the RMG netplay server (%s)", type(e).__name__)
            return False
        self._rmg_server = {"room": room["id"], "proc": proc}
        deadline = time.monotonic() + RMG_SERVER_START_SECONDS
        while time.monotonic() < deadline and proc.poll() is None:
            if _listening(session.RMG_SERVER_PORT):
                decky.logger.info("multiplayer: RMG netplay server started, pid %s", proc.pid)
                return True
            time.sleep(0.1)
        decky.logger.warning("multiplayer: the RMG netplay server didn't start listening")
        self._stop_rmg_server()
        return False

    def _stop_rmg_server(self, room_id: str = "") -> None:
        current = self._rmg_server
        if current is None or (room_id and current["room"] != room_id):
            return
        self._rmg_server = None
        proc = current["proc"]
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            decky.logger.info("multiplayer: RMG netplay server stopped")

    def _end_stray_rmg_servers(self) -> None:
        path = self._rmg_server_path()
        if path is None:
            return
        for name in os.listdir("/proc"):
            if not name.isdigit():
                continue
            try:
                exe = os.readlink(f"/proc/{name}/exe")
            except OSError:
                continue
            if exe.removesuffix(" (deleted)") == str(path):
                try:
                    os.kill(int(name), signal.SIGTERM)
                    decky.logger.info("multiplayer: stopped a leftover RMG netplay server, pid %s", name)
                except OSError:
                    pass

    def _rmg_server_path(self):
        if self._bin_dir is None:
            return None
        folder = self._bin_dir / cheevo_check_tools.ARM64_DIR if cheevo_check_tools.host_is_arm64() else self._bin_dir
        return folder / RMG_SERVER_NAME

    def _build_rmg_home(self, home: Path, local: dict, nick: str, server: str, rom: Path) -> None:
        folder = home / "RMG"
        for path in (home, folder):
            ensure_dir(path)
            chown_to_data_owner(path)
        own = session.rmg_config_dir(self._user_home, local["install"])
        text = ""
        if own.is_dir():
            for entry in own.iterdir():
                if not entry.is_file() or entry.is_symlink():
                    continue
                if entry.name == "mupen64plus.cfg":
                    text = entry.read_text(encoding="utf-8", errors="replace")
                    continue
                with atomic_file(folder / entry.name) as out:
                    out.write(entry.read_bytes())
        servers = home / "servers.json"
        self._write(servers, session.rmg_servers(server))
        self._write(folder / "mupen64plus.cfg", session.rmg_config(text, {
            (session.RMG_NETPLAY_SECTION, "Nickname"): session.rmg_nickname(nick),
            (session.RMG_NETPLAY_SECTION, "ServerJsonUrl"): str(servers),
            (session.RMG_NETPLAY_SECTION, "SelectedServer"): session.RMG_SERVER,
            (session.RMG_ROM_BROWSER_SECTION, "Directory"): str(rom.parent),
            (session.RMG_GUI_SECTION, "AutomaticFullscreen"): True,
            (session.RMG_CONTROLLER_1_SECTION, "PluggedIn"): True,
            (session.RMG_CONTROLLER_1_SECTION, "DeviceType"): session.RMG_DEVICE_AUTOMATIC,
            (session.RMG_CONTROLLER_1_SECTION, "DeviceName"): "Automatic",
        }))

    def _build_system_folder(self, ra, rom: Path, folder: Path) -> None:
        copies = session.melonds_firmware_names(dict(ra.effective_options(session.MELONDS_DS, rom)))
        ensure_dir(folder)
        chown_to_data_owner(folder)
        if ra.system_dir.is_dir():
            self._fill_system_folder(ra.system_dir, folder, copies, nested=False)

    def _fill_system_folder(self, source: Path, folder: Path, copies: set, *, nested: bool) -> None:
        for entry in source.iterdir():
            target = folder / entry.name
            if entry.name in copies and entry.is_file():
                with atomic_file(target) as out:
                    out.write(entry.read_bytes())
            elif not nested and entry.name == session.MELONDS_DS_FOLDER and entry.is_dir() and not entry.is_symlink():
                ensure_dir(target)
                chown_to_data_owner(target)
                self._fill_system_folder(entry, target, copies, nested=True)
            else:
                os.symlink(entry, target)
                chown_to_data_owner(target)

    def _back_up_save(self, ra, local: dict) -> None:
        folder = self._session_dir / SAVE_BACKUPS
        prefix = f"{local['gameId']}-"
        stamp = time.strftime("%Y%m%d%H%M%S")
        copied = False
        for source in ra.save_paths(local["shortcutCore"] or local["core"], Path(local["path"])):
            if not source.is_file():
                continue
            try:
                ensure_dir(folder)
                target = folder / f"{prefix}{stamp}-{source.name}"
                shutil.copy2(source, target)
                chown_to_data_owner(target)
                copied = True
            except OSError as e:
                decky.logger.warning("multiplayer: couldn't back up %s (%s)", source.name, type(e).__name__)
        if not copied:
            return
        decky.logger.info("multiplayer: backed up the save for %s", local["gameId"])
        backups = [entry for entry in folder.iterdir() if entry.name.startswith(prefix)]
        stamps = sorted({entry.name.split("-", 2)[1] for entry in backups})
        for entry in backups:
            if entry.name.split("-", 2)[1] in stamps[:-SAVE_BACKUPS_KEPT]:
                try:
                    entry.unlink()
                except OSError:
                    pass

    def _write_restore(self, appid: int, original: str, sid: str, play_game: int = 0) -> None:
        record = {"schemaVersion": RESTORE_SCHEMA, "appid": appid, "original": original, "session": sid,
                  "at": int(time.time())}
        if play_game:
            record["play"] = True
            record["gameId"] = play_game
        self._write(self._session_dir / RESTORE_RECORD, json.dumps(record))

    def restore_record(self) -> dict:
        raw = load_json_file(self._session_dir / RESTORE_RECORD, None)
        if (
            not isinstance(raw, dict)
            or type(raw.get("appid")) is not int
            or not isinstance(raw.get("original"), str)
            or not isinstance(raw.get("session"), str)
        ):
            return {"ok": True, "record": None}
        game_id = raw.get("gameId")
        return {"ok": True, "record": {"appid": raw["appid"], "original": raw["original"], "session": raw["session"],
                                       "play": raw.get("play") is True,
                                       "gameId": game_id if type(game_id) is int else 0}}

    def clear_restore(self, sid: str) -> dict:
        path = self._session_dir / RESTORE_RECORD
        raw = load_json_file(path, None)
        if isinstance(raw, dict) and raw.get("session") not in (sid, None):
            return {"ok": False, "error": ERROR_NOT_READY}
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't remove the restore record (%s)", type(e).__name__)
            return {"ok": False, "error": ERROR_WRITE_FAILED}
        current = self._session
        if current is not None and current["id"] == sid and not current["started"]:
            self._session = None
            self._remove_session_files(sid)
            self._close_guest_tunnels_soon()
        elif current is not None and current["id"] == sid and current["exited"]:
            self._remove_files(current)
        elif sid and sid not in _running_sessions(str(self._session_dir)):
            self._remove_session_files(sid)
        return {"ok": True}

    def launch_ended(self) -> dict:
        current = self._session
        if current is None or current["exited"]:
            return {"ok": True}
        if not current["seen"] and self._loop is not None:
            self._loop.call_later(APP_ENDED_GRACE_SECONDS, self._ended_unseen, current)
        return {"ok": True}

    def _ended_unseen(self, current: dict) -> None:
        if current["seen"] or current["exited"]:
            return
        decky.logger.info("multiplayer: Steam says the game ended and its process was never seen")
        self._finish(current)

    def status(self) -> dict:
        current = self._session
        if current is None:
            return {"ok": True, "session": None}
        return {"ok": True, "session": {
            "id": current["id"],
            "appid": current["appid"],
            "role": current["role"],
            "state": "ended" if current["exited"] else "playing" if current["seen"] else "launching",
            "error": current["error"],
        }}

    async def _watch(self, current: dict) -> None:
        needle = str(current["files"][0])
        pid = await asyncio.to_thread(self._find_emulator, needle, ARGV_SECONDS, current["emulator"] == "rmg")
        if self._session is not current:
            return
        if pid is None:
            current["error"] = ERROR_ARGS_DROPPED
            decky.logger.warning("multiplayer: the emulator never showed the session file in its arguments")
            current["exited"] = True
            self._emit({"state": "failed", "session": current["id"], "error": ERROR_ARGS_DROPPED})
            self._session_over(current)
            return
        current["seen"] = True
        current["pid"] = pid
        decky.logger.info("multiplayer: following the emulator, pid %s", pid)
        self._emit({"state": "playing", "session": current["id"], "emulator": current["emulator"],
                    "mode": current.get("mode", "")})
        if current["emulator"] in ("dolphin", "rmg") and current.get("mode") == "couch":
            self._notify_steps(current["role"], current["emulator"])
        await asyncio.to_thread(self._wait_exit, pid)
        if not self._stopping:
            self._finish(current)

    def _find_emulator(self, needle: str, limit: float, environ: bool = False):
        deadline = time.monotonic() + limit
        settle = None
        while time.monotonic() < deadline and not self._stopping:
            matches = _processes_naming(needle, environ)
            emulators = [pid for pid, name in matches if name in EMULATOR_NAMES]
            if emulators:
                return min(emulators)
            if matches and settle is None:
                settle = time.monotonic() + SETTLE_SECONDS
            if settle is not None and time.monotonic() >= settle:
                return min(pid for pid, _name in matches) if matches else None
            time.sleep(0.5)
        matches = _processes_naming(needle, environ)
        return min(pid for pid, _name in matches) if matches else None

    def _wait_exit(self, pid: int) -> None:
        try:
            fd = os.pidfd_open(pid)
        except OSError:
            return
        try:
            while not self._stopping:
                ready, _, _ = select.select([fd], [], [], 1.0)
                if ready:
                    return
        finally:
            os.close(fd)

    def _finish(self, current: dict) -> None:
        current["exited"] = True
        decky.logger.info("multiplayer: session %s ended", current["id"])
        self._remove_files(current)
        self._emit({"state": "ended", "session": current["id"]})
        self._session_over(current)

    def _session_over(self, current: dict) -> None:
        if self._session is current:
            self._session = None
        self._close_guest_tunnels()
        self._host_tunnels.close()
        failed = current["error"] or ("" if current["seen"] else ERROR_LAUNCH_FAILED)
        joined = self._joined
        if joined is not None and joined["launched"]:
            joined["launched"] = False
            joined["ready"] = False
            if failed:
                joined["consentRound"] = 0
            if failed:
                joined["notice"] = failed
            self._spawn(self._ask(joined, "status"))
            self._announce()
        room = self._room
        if room is not None and room["state"] != "lobby":
            self._back_to_lobby(room, failed)

    def _remove_files(self, current: dict) -> None:
        if current["id"] in self._restore_sessions():
            return
        self._remove_session_files(current["id"])

    def _remove_session_files(self, sid: str) -> None:
        for suffix in (".opt", *SESSION_SUFFIXES):
            path = self._session_dir / f"session-{sid}{suffix}"
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            except IsADirectoryError:
                _remove_system_folder(path)
            except OSError as e:
                decky.logger.warning("multiplayer: couldn't remove a session file (%s)", type(e).__name__)
        _remove_system_folder(self._session_dir / f"session-{sid}.system")

    def _emit(self, payload: dict, event: str = SESSION_EVENT) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(decky.emit(event, payload), loop)
        except Exception as e:
            decky.logger.warning("multiplayer: couldn't tell the panel (%s)", type(e).__name__)

    def debug_server_door(self, on: bool) -> dict:
        try:
            debugging = self._settings_store.get_debug_logging(self._settings_store.load_config())
        except Exception:
            debugging = False
        if not debugging:
            return {"ok": False, "error": ERROR_UNAVAILABLE}
        self._prefer_server = bool(on)
        self._rooms.clear()
        decky.logger.info("multiplayer: debug, Online rooms %s", "through the server" if on else "on the LAN when heard")
        return {"ok": True, "on": self._prefer_server}

    def _pactl(self, *args):
        try:
            return subprocess_util.run_command(
                ["pactl", *args], timeout=5, env=self._flatpak_env(), as_data_owner=True,
            )
        except Exception as e:
            self._debug("game volume: pactl failed (%s)", type(e).__name__)
            return 1, "", ""

    def _sink_inputs(self):
        code, out, _err = self._pactl("-f", "json", "list", "sink-inputs")
        try:
            rows = json.loads(out) if code == 0 else None
        except ValueError:
            rows = None
        if not isinstance(rows, list):
            return None
        return [row for row in rows
                if isinstance(row, dict) and type(row.get("index")) is int and isinstance(row.get("properties"), dict)]

    def _game_stream_rows(self):
        rows = self._sink_inputs()
        if rows is None:
            return None
        streams = []
        for row in rows:
            props = row["properties"]
            if props.get("application.process.binary") not in EMULATOR_NAMES:
                continue
            app = next((f"{key}:{props[key]}" for key in GAME_AUDIO_KEYS
                        if isinstance(props.get(key), str) and props[key]), "")
            if not app or len(app) > GAME_VOLUME_APP_MAX:
                continue
            channels = row.get("volume")
            first = next(iter(channels.values()), None) if isinstance(channels, dict) and channels else None
            value = first.get("value") if isinstance(first, dict) else None
            streams.append({"id": row["index"], "app": app,
                            "level": value / 65536 if type(value) is int else None})
        return streams

    def game_streams(self) -> dict:
        streams = self._game_stream_rows()
        if streams is None:
            return {"ok": False}
        return {"ok": True, "streams": [{"id": stream["id"], "app": stream["app"]} for stream in streams]}

    def _game_volume_records(self) -> dict:
        raw = load_json_file(self._session_dir / GAME_VOLUME_RECORD, {})
        if not isinstance(raw, dict):
            return {}
        records = {}
        for app, row in raw.items():
            if not _game_audio_key(app) or not isinstance(row, dict):
                continue
            original = row.get("original")
            level = row.get("set")
            if _volume_level(original) and _volume_level(level):
                records[app] = {"original": float(original), "set": float(level)}
        return records

    def _save_game_volume_records(self, records: dict) -> bool:
        path = self._session_dir / GAME_VOLUME_RECORD
        try:
            if records:
                ensure_dir(self._session_dir)
                self._write(path, json.dumps(records))
            else:
                path.unlink(missing_ok=True)
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't keep the game volume record (%s)", type(e).__name__)
            return False
        return True

    def game_volume_records(self) -> dict:
        with self._volume_lock:
            return {"ok": True, "records": self._game_volume_records()}

    def game_volume_record(self, app, original, level) -> dict:
        if not _game_audio_key(app):
            return {"ok": False}
        if original is not None and not (_volume_level(original) and _volume_level(level)):
            return {"ok": False}
        with self._volume_lock:
            records = self._game_volume_records()
            if original is None:
                records.pop(app, None)
                return {"ok": self._save_game_volume_records(records)}
            held = records.get(app)
            records[app] = {"original": held["original"] if held else float(original), "set": float(level)}
            return {"ok": self._save_game_volume_records(records), "original": records[app]["original"]}

    def _saved_game_level(self, app: str):
        fd = os.open(self._user_home / WIREPLUMBER_STATE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > WIREPLUMBER_STATE_MAX:
                raise OSError("not a plain file")
            text = os.read(fd, WIREPLUMBER_STATE_MAX + 1).decode("utf-8", errors="replace")
        finally:
            os.close(fd)
        for line in text.splitlines():
            key, sep, body = line.partition("=")
            if not sep or not key.startswith("Output/Audio:"):
                continue
            name = re.sub(r"\\(.)", lambda m: WIREPLUMBER_ESCAPES.get(m.group(1), m.group(0)), key[len("Output/Audio:"):])
            if name != app:
                continue
            try:
                volumes = json.loads(body).get("channelVolumes")
            except (ValueError, AttributeError):
                return None
            if not isinstance(volumes, list) or not volumes or type(volumes[0]) not in (int, float):
                return None
            return max(0.0, float(volumes[0])) ** (1 / 3)
        return None

    def _saved_level_settles(self, app: str, wanted) -> bool:
        deadline = time.monotonic() + PUT_BACK_SECONDS
        while True:
            try:
                saved = self._saved_game_level(app)
            except OSError:
                saved = None
            if saved is not None and any(abs(saved - level) <= LEVEL_SLACK for level in wanted):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.2)

    def _save_game_level(self, app: str, level: float) -> bool:
        prop, _sep, value = app.partition(":")
        name = f"cheevodeck-restore-{secrets.token_hex(4)}"
        argv = ["pacat", "--playback", "--raw", "--format=s16le", "--rate=48000", "--channels=2",
                f"--property={prop}={value}", f"--stream-name={name}"]
        if prop == "application.name":
            argv.append(f"--client-name={value}")
        owner = child_owner()
        try:
            proc = subprocess.Popen(
                argv, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                env=self._flatpak_env(), user=owner[0] if owner else None, group=owner[1] if owner else None,
                extra_groups=[] if owner and os.geteuid() == 0 else None,
            )
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't open the silent stream (%s)", type(e).__name__)
            return False
        try:
            proc.stdin.write(bytes(SILENCE_BYTES))
            proc.stdin.flush()
            index = None
            deadline = time.monotonic() + PUT_BACK_SECONDS
            while index is None and proc.poll() is None and time.monotonic() < deadline:
                time.sleep(0.2)
                rows = self._sink_inputs() or []
                index = next((row["index"] for row in rows if row["properties"].get("media.name") == name), None)
            if index is None:
                return False
            code, _out, _err = self._pactl("set-sink-input-volume", str(index), str(round(level * 65536)))
            return code == 0 and self._saved_level_settles(app, (level,))
        except OSError:
            return False
        finally:
            try:
                proc.stdin.close()
            except OSError:
                pass
            proc.kill()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                pass

    def put_back_game_volume(self, app, levels=()) -> dict:
        if not _game_audio_key(app):
            return {"ok": False}
        with self._volume_lock:
            records = self._game_volume_records()
            record = records.get(app)
            if record is None:
                return {"ok": True}
            streams = self._game_stream_rows()
            if streams is None or any(stream["app"] == app for stream in streams):
                return {"ok": False}
            try:
                saved = self._saved_game_level(app)
            except OSError as e:
                self._debug("game volume: couldn't read the saved levels (%s)", type(e).__name__)
                return {"ok": False}
            ours = [record["set"], *(level for level in levels if _volume_level(level))]
            if saved is not None and abs(saved - record["original"]) > LEVEL_SLACK \
                    and self._saved_level_settles(app, ours):
                if not self._save_game_level(app, record["original"]):
                    decky.logger.warning("multiplayer: couldn't put a game's volume back")
                    return {"ok": False}
                decky.logger.info("multiplayer: put a closed game's volume back")
            records.pop(app, None)
            return {"ok": self._save_game_volume_records(records)}

    def put_back_game_volumes(self) -> dict:
        try:
            with self._volume_lock:
                records = self._game_volume_records()
            streams = self._game_stream_rows()
            if streams is None:
                return records
            left = {}
            for app, record in records.items():
                playing = [stream for stream in streams if stream["app"] == app]
                for stream in playing:
                    if stream["level"] is not None and abs(stream["level"] - record["set"]) <= LEVEL_SLACK:
                        code, _out, _err = self._pactl(
                            "set-sink-input-volume", str(stream["id"]), str(round(record["original"] * 65536)))
                        if code != 0:
                            left[app] = record
                if not playing and not self.put_back_game_volume(app)["ok"]:
                    left[app] = record
            return left
        except Exception as e:
            decky.logger.warning("multiplayer: couldn't put the game volumes back (%s)", type(e).__name__)
            return {}

    def keep_game_volume_records(self, records: dict) -> None:
        if records:
            with self._volume_lock:
                self._save_game_volume_records(records)

    def debug_voice(self, name: str, on: bool) -> dict:
        try:
            debugging = self._settings_store.get_debug_logging(self._settings_store.load_config())
        except Exception:
            debugging = False
        if not debugging or name not in ("aec", "canceller", "steam", "relay", "limiter"):
            return {"ok": False, "error": ERROR_UNAVAILABLE}
        if name == "relay":
            self._voice_relay = on
            self._announce()
        else:
            self._emit({"name": name, "on": on}, VOICE_DEBUG_EVENT)
        decky.logger.info("multiplayer: debug, voice %s %s", name, "on" if on else "off")
        return {"ok": True, "on": on}

    def debug_processes(self) -> dict:
        try:
            on = self._settings_store.get_debug_logging(self._settings_store.load_config())
        except Exception:
            on = False
        if not on:
            return {"ok": False, "error": ERROR_UNAVAILABLE}
        rows = []
        for pid, name in _processes_naming(str(self._session_dir) + "/session-"):
            try:
                with open(f"/proc/{pid}/cmdline", "rb") as handle:
                    argv = [part.decode("utf-8", "replace") for part in handle.read().split(b"\0") if part]
            except OSError:
                argv = []
            try:
                fd = os.pidfd_open(pid)
                os.close(fd)
                pidfd = True
            except OSError:
                pidfd = False
            rows.append({"pid": pid, "name": name, "argv": argv[:12], "pidfd": pidfd})
        decky.logger.info("multiplayer: debug, %s process(es) name a session file", len(rows))
        return {"ok": True, "processes": rows}

    def _startup_sweep(self) -> None:
        self._end_stray_rmg_servers()
        try:
            if not self._session_dir.is_dir():
                return
            running = _running_sessions(str(self._session_dir))
            keep = running | self._restore_sessions()
            for entry in self._session_dir.iterdir():
                found = _SESSION_ID.match(entry.name)
                if found is None or found.group(1) in keep:
                    continue
                if entry.is_dir() and not entry.is_symlink():
                    _remove_system_folder(entry)
                    continue
                try:
                    entry.unlink()
                except OSError as e:
                    decky.logger.warning("multiplayer: couldn't remove %s (%s)", entry.name, type(e).__name__)
            if keep:
                decky.logger.info("multiplayer: kept %s session(s) still in use", len(keep))
            if running and self._loop is not None and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(self._adopt, min(running))
        except Exception as e:
            decky.logger.warning("multiplayer: the startup sweep failed (%s)", type(e).__name__)

    def _adopt(self, sid: str) -> None:
        if self._session is not None:
            return
        files = [self._session_dir / f"session-{sid}{suffix}" for suffix in SESSION_SUFFIXES]
        files = [path for path in files if path.exists()]
        if not files:
            return
        record = self.restore_record()["record"] or {}
        current = {
            "id": sid,
            "appid": record.get("appid", 0) if record.get("session") == sid else 0,
            "role": "",
            "emulator": SESSION_SUFFIXES[files[0].suffix],
            "files": files,
            "started": time.monotonic(),
            "seen": False,
            "exited": False,
            "error": "",
            "watch": None,
        }
        self._session = current
        current["watch"] = self._spawn(self._watch(current))
        decky.logger.info("multiplayer: re-adopted session %s after a restart", sid)

    def _restore_sessions(self) -> set:
        raw = load_json_file(self._session_dir / RESTORE_RECORD, None)
        if not isinstance(raw, dict):
            return set()
        session_id = raw.get("session")
        return {session_id} if isinstance(session_id, str) else set()


def _remove_system_folder(folder: Path) -> None:
    if not folder.is_dir() or folder.is_symlink():
        return
    try:
        shutil.rmtree(folder)
    except OSError as e:
        decky.logger.warning("multiplayer: couldn't remove a session system folder (%s)", type(e).__name__)


def _known(version: str) -> bool:
    return bool(version) and all(version.split("|"))


def _lan_only(mode: str, local: dict) -> bool:
    return mode == "link" and (local["emulator"] == "dolphin" or local["core"] == session.PPSSPP_CORE)


def _volume_level(value) -> bool:
    return type(value) in (int, float) and 0 <= value <= 10


def _game_audio_key(app) -> bool:
    if not isinstance(app, str) or not 0 < len(app) <= GAME_VOLUME_APP_MAX:
        return False
    prop, sep, value = app.partition(":")
    return bool(sep) and prop in GAME_AUDIO_KEYS and bool(value)


def _turn_due(cred: dict, now: float) -> bool:
    ttl = cred.get("ttl")
    lead = min(TURN_RENEW_SECONDS, ttl // 2) if type(ttl) is int and ttl > 0 else TURN_RENEW_SECONDS
    return cred["expires"] - now <= lead


def _access(room: dict) -> str:
    if room.get("friends"):
        return "friends"
    return "private" if room.get("private") else "public"


def _drop_in(room: dict) -> bool:
    return room.get("mode") == "couch" and room.get("emulator") == "retroarch"


def _steps(row: dict) -> str:
    if row["mode"] == "couch" and row["emulator"] in ("dolphin", "rmg"):
        return row["emulator"]
    return ""


def _local_view(local: dict) -> dict:
    return {
        "gameId": local["gameId"],
        "title": local["title"],
        "systemId": local["systemId"],
        "appid": local["appid"],
        "emulator": local["emulator"],
        "core": local["core"],
        "coreName": local["coreName"],
        "shortcutCore": local["shortcutCore"],
        "shortcutCoreName": local["shortcutCoreName"],
        "choices": local["choices"],
    }


def _processes_naming(needle: str, environ: bool = False) -> list:
    wanted = needle.encode()
    found = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/cmdline", "rb") as handle:
                cmdline = handle.read()
            if environ and wanted not in cmdline:
                with open(f"/proc/{name}/environ", "rb") as handle:
                    cmdline += b"\0" + handle.read()
        except OSError:
            continue
        if wanted not in cmdline:
            continue
        try:
            exe = os.path.basename(os.readlink(f"/proc/{name}/exe"))
        except OSError:
            exe = os.path.basename(cmdline.split(b"\0", 1)[0].decode("utf-8", "replace"))
        found.append((int(name), exe))
    return found


def _guests(room: dict) -> list:
    return [seat for index, seat in enumerate(room["seats"]) if index > 0 and seat is not None]


def _listening(port: int, udp: bool = False) -> bool:
    wanted = f":{port:04X}"
    tables = ("/proc/net/udp", "/proc/net/udp6") if udp else ("/proc/net/tcp", "/proc/net/tcp6")
    for table in tables:
        try:
            with open(table, "r", encoding="ascii", errors="replace") as handle:
                next(handle, None)
                for line in handle:
                    fields = line.split()
                    if len(fields) > 3 and (udp or fields[3] == "0A") and fields[1].endswith(wanted):
                        return True
        except OSError:
            continue
    return False


def _boot_clock() -> float:
    try:
        return time.clock_gettime(time.CLOCK_BOOTTIME)
    except (AttributeError, OSError):
        return time.monotonic()


def _route_address() -> str:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 9))
        address = probe.getsockname()[0]
    except OSError:
        return ""
    finally:
        probe.close()
    return address if proto.is_ipv4(address) and address != "0.0.0.0" else ""


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
            with open(f"/proc/{name}/environ", "rb") as handle:
                cmdline += b"\0" + handle.read()
        except OSError:
            continue
        found.update(pattern.findall(cmdline.decode("utf-8", "replace")))
    return found

