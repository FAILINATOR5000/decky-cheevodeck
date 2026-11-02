import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import select
import shutil
import socket
import time
from collections import deque
from pathlib import Path

import decky
import multiplayer_protocol as proto
import multiplayer_session as session
import rom_headers
import steam_shortcuts
import subprocess_util
from multiplayer_protocol import decode, frame, read_frame
from nearby_protocol import FrameError, clean_title, is_nonce, verify
from notifications import emit_notification, is_type_enabled
from services import lobby_client, lobby_tunnel
from utils import atomic_file, child_owner, chown_to_data_owner, ensure_dir, load_json_file

LEASE_SECONDS = 30
VISIT_CAP_SECONDS = 600

SEEK_SECONDS = 1.2
SEEK_SENDS = 3
MISSED_ROUNDS = 2

HANDSHAKE_SECONDS = 5
FIRST_FRAME_SECONDS = 2
MAX_HANDSHAKES = 8
HANDSHAKES_PER_ADDRESS = 2
HANDSHAKES_PER_RELAYED_ADDRESS = 4
ANSWERS_PER_SECOND = 10
SEEN_NONCES_MAX = 4096

POLL_SECONDS = 2
POLL_BACKOFF_SECONDS = 5
SEAT_SILENCE_SECONDS = 30
SEAT_FREE_SECONDS = 90
ADDRESS_GRACE_SECONDS = 60
HOST_GONE_GRACE_SECONDS = 60

CLOSED_TAIL_SECONDS = 10
JOIN_TOAST_SECONDS = 300

LAUNCH_WAIT_SECONDS = 300
LAUNCH_START_SECONDS = 60
READY_EXPIRY_SECONDS = 600
SLEEP_JUMP_SECONDS = 60

HOUSEKEEPING_SECONDS = 5

DOLPHIN_TUNNEL_PORT = 2627

LIST_GRACE_SECONDS = 0.5

BAD_TAGS_PER_ADDRESS = 3
LOCKOUT_SECONDS = 60
BAD_TAGS_PER_ROOM = 10

SESSION_DIR = "multiplayer"
RESTORE_RECORD = "multiplayer_restore.json"
RESTORE_SCHEMA = 1
SAVE_BACKUPS = "save-backups"
SAVE_BACKUPS_KEPT = 5

SESSION_EVENT = "multiplayer_session"
ROOM_EVENT = "multiplayer_room"

DOLPHIN_HOST_STEPS = ("In Dolphin, open Tools, then Start NetPlay, then Host. "
                      "Pick the game and press Start once everyone has joined.")
DOLPHIN_GUEST_STEPS = "In Dolphin, open Tools, then Start NetPlay, then Connect. The host's address is filled in."

ARGV_SECONDS = 15
SETTLE_SECONDS = 5
APP_ENDED_GRACE_SECONDS = 10
FLATPAK_SECONDS = 10

EMULATOR_NAMES = ("retroarch", "PPSSPPSDL", "PPSSPPQt", "dolphin-emu")

SESSION_SUFFIXES = {".cfg": "retroarch", ".ini": "ppsspp", ".dolphin": "dolphin"}

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
ERROR_CHAT = "chat_refused"
ERROR_NO_LOBBY = "no_lobby"
ERROR_LOBBY_UNREACHABLE = "lobby_unreachable"
ERROR_LAN_ONLY = "lan_only"
ERROR_TUNNEL = "tunnel_failed"
ERROR_INVITE_EXPIRED = "invite_expired"

CHAT_GAP_SECONDS = 1

_JOIN_REFUSALS = {
    "bad_code": ERROR_BAD_CODE,
    "locked": ERROR_LOCKED_OUT,
    "full": ERROR_FULL,
    "closed": ERROR_ROOM_GONE,
    "dropped": ERROR_DROPPED,
    "expired": ERROR_INVITE_EXPIRED,
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
        notifications_store=None, port: int = proto.PORT, peer_port: int = proto.PORT,
        broadcast: str = "255.255.255.255",
    ):
        self._settings_store = settings_store
        self._notifications = notifications_store
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
        self._page_seen = 0.0

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
            self._page_seen = now
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
                    "chat": dict(room["chat"][-1]) if room["chat"] else None, "lobby": self._lobby_state()}
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
                    "autostart": self._pending_start(joined)}
        return {"role": None, "title": "", "host": "", "seated": 0, "error": "", "seat": 0, "ready": False,
                "seats": [], "rev": 0, "round": 0, "state": "lobby", "chat": None}

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

    def _toast_seat(self, name: str, line: str) -> None:
        emit_notification(
            ntype="system",
            settings_store=self._settings_store,
            event_loop=self._loop,
            toast_title=name,
            line_key=line,
            force_toast=not self._in_game(),
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
        stamp = (results_stamp, id(by_rom))
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
                entry["paths"].append({
                    "path": path,
                    "real": real,
                    "hash": hashes.get(path, ""),
                    "shortcut": by_rom.get(real) or by_rom.get(path),
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
        for entry in library.values():
            linked = next((p for p in entry["paths"] if p["shortcut"]), None)
            shortcut = linked["shortcut"] if linked else None
            can_couch = self._can_couch(ra, couch_systems, entry["systemId"], shortcut)
            can_link = entry["systemId"] in session.LINK_CORES
            if entry["systemId"] == session.GAMECUBE_SYSTEM:
                can_link = entry["gameId"] in session.GC_LAN_GAMES
            if can_link and entry["systemId"] == session.GBA_SYSTEM:
                can_link = linked is not None \
                    and self._game_code_of(linked["real"], session.GBA_SYSTEM) in session.GBA_LINK_CODES
            games.append({
                "gameId": entry["gameId"],
                "title": entry["title"],
                "systemId": entry["systemId"],
                "system": entry["system"],
                "imageIcon": entry["imageIcon"],
                "appid": shortcut["appid"] if shortcut else 0,
                "canLink": can_link,
                "canCouch": can_couch,
            })
        games.sort(key=lambda row: row["title"].lower())
        return {"ok": True, "scanned": True, "games": games, "installedCores": installed}

    def _can_couch(self, ra, by_system: dict, system_id: int, shortcut) -> bool:
        detected = session.detect(shortcut["exe"], shortcut["launchOptions"]) if shortcut else None
        emulator = detected["emulator"] if detected else "retroarch"
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
        candidates = [entry for entry in game["paths"] if entry["shortcut"]]
        if not candidates:
            return None, "no_shortcut", {}
        system_id = game["systemId"]

        pick = candidates[0]
        if room is not None and mode == "couch":
            pick = next((entry for entry in candidates
                         if room["hash"] and self._hash_of(entry, system_id) == room["hash"]), None)
            if pick is None:
                return None, "rom_mismatch", {}
        detected = session.detect(pick["shortcut"]["exe"], pick["shortcut"]["launchOptions"])
        if detected is None:
            return None, "unsupported_emulator", {}

        local = {
            "gameId": game_id,
            "title": game["title"],
            "systemId": system_id,
            "path": pick["path"],
            "real": pick["real"],
            "appid": pick["shortcut"]["appid"],
            "emulator": detected["emulator"],
            "shortcutCore": detected["core"],
            "shortcutCoreName": detected["core"],
            "choices": [],
            "hash": pick["hash"],
            "coreBuild": "",
            "gameCode": "",
        }
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
            return None, "unsupported_emulator", {}
        local["ra"] = ra
        local["shortcutCoreName"] = ra.core_name(detected["core"])
        compatible = self._compatible(ra, mode, system_id)
        local["choices"] = [{"core": name, "name": ra.core_name(name)} for name in compatible]
        room_core = room["core"] if room is not None else ""
        chosen = core or self._default_core(ra, compatible, detected["core"], room_core)

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

    def _emulator_shortcut(self, kind: str, install: str = ""):
        for shortcut in steam_shortcuts.emulator_shortcuts(self._user_home):
            if session.emulator_kind(shortcut["exe"], shortcut["launchOptions"]) != kind:
                continue
            if kind == "dolphin" and session.dolphin_install(
                    shortcut["exe"], shortcut["launchOptions"], self._user_home) != install:
                continue
            return shortcut
        return None

    def _dolphin_version(self, install: str, shortcut: dict) -> str:
        if install == "flatpak":
            return self._flatpak_version(session.DOLPHIN_FLATPAK)
        if install != "appimage":
            return ""
        image = session.dolphin_appimage(shortcut["exe"], shortcut["launchOptions"], self._user_home)
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
            versions_differ = local["core"] not in proto.NETPACKET_CORES and local["emulator"] != "dolphin" \
                and _known(room["emuVersion"]) and _known(local["emuVersion"]) \
                and room["emuVersion"] != local["emuVersion"]
            if mode == "couch" and local["emulator"] == "dolphin" and room["emuVersion"] and local["emuVersion"] \
                    and room["emuVersion"] != local["emuVersion"]:
                return ("dolphin_version_mismatch", {"version": room["emuVersion"]}), warnings
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
            if local.get("duckstation"):
                warnings.append({"code": "duckstation_switch", "detail": {"core": local["coreName"]}})
            elif local["core"] != local["shortcutCore"]:
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
        return None, warnings

    def _hash_of_path(self, local: dict, system_id: int) -> str:
        return self._hash_of({"hash": local["hash"], "real": local["real"]}, system_id)

    def _players(self, mode: str, room) -> int:
        if mode != "couch":
            return 2
        if self._room is not None:
            return 1 + len(_guests(self._room))
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
                   where: str = "local") -> dict:
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
            private = proto.is_password(password)
            room_id = secrets.token_hex(8)
            started = time.monotonic()
            key = await asyncio.to_thread(proto.room_key, password if private else "", room_id)
            key_ms = (time.monotonic() - started) * 1000
            user = self._user()
            ulid, pic = self._identity()
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
                "share": bool(share),
                "max": seats,
                "seats": [{"name": user, "host": True, "said": 0.0, "ulid": ulid, "pic": pic}] + [None] * (seats - 1),
                "inboxSeq": 0,
                "passesUsed": set(),
                "state": "lobby",
                "rev": 1,
                "round": 0,
                "roster": [],
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

    async def room_options(self, hardcore=None, core=None, share=None) -> dict:
        room = self._room
        joined = self._joined
        if room is None and joined is not None and hardcore is not None:
            joined["hardcore"] = bool(hardcore)
            return {"ok": True}
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
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
        if changed:
            self._changed(room)
        return {"ok": True, "room": self._host_view(room)}

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
        room["notice"] = None
        self._roster_left(room, seat)
        self._announce()
        return {"ok": True, "room": self._host_view(room)}

    def _close_room(self, reason: str) -> None:
        room = self._room
        if room is None:
            return
        self._room = None
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
            "share": room["share"],
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
        if room["where"] == "online" and room["emulator"] == "ppsspp":
            return "playing"
        if room["emulator"] == "dolphin":
            return "playing" if _listening(session.DOLPHIN_NETPLAY_PORT, udp=True) else "starting"
        if _listening(proto.game_port(room["mode"], room["emulator"], room["core"])):
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
            if index == 0 or seat is None or (seat.get("launched") and room["state"] != "lobby"):
                continue
            if _boot_clock() - seat["last"] > SEAT_FREE_SECONDS:
                decky.logger.info("multiplayer: seat %s went quiet, freed", index)
                room["freed"][index] = seat["key"]
                room["seats"][index] = None
                self._host_tunnels.close_seat(index)
                self._toast_seat(seat["name"], "Left your room")
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
        if room["state"] != "lobby" and self._public_state(room) == "playing":
            if room["playingSince"] is None:
                room["playingSince"] = now
            elif now - room["playingSince"] > LAUNCH_WAIT_SECONDS:
                waiting = [index for index in room["roster"]
                           if room["seats"][index] is not None and not room["seats"][index]["launched"]]
                if waiting:
                    decky.logger.info("multiplayer: seats %s never launched, no longer waiting for them", waiting)
                    room["roster"] = [index for index in room["roster"] if index not in waiting]

        self._announce()

    def _notify_steps(self, role: str) -> None:
        body = DOLPHIN_HOST_STEPS if role == "host" else DOLPHIN_GUEST_STEPS
        if self._notifications is not None and is_type_enabled("system", self._settings_store):
            try:
                self._notifications.append({
                    "type": "system",
                    "kind": "info",
                    "iconSource": "none",
                    "title": "EZ Multiplayer",
                    "body": body,
                    "source": "notifications",
                    "target": {"view": "multiplayer"},
                    "meta": {"multiplayer": "dolphinSteps"},
                })
            except Exception as e:
                decky.logger.warning("multiplayer: the notification could not be filed (%s)", type(e).__name__)
        emit_notification(
            ntype="system",
            settings_store=self._settings_store,
            event_loop=self._loop,
            title_key="EZ Multiplayer",
            line_key="Host in NetPlay" if role == "host" else "Connect in NetPlay",
            force_toast=True,
        )

    def _back_to_lobby(self, room: dict, error: str = "") -> None:
        room["state"] = "lobby"
        room["notice"] = None
        room["roster"] = []
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
        nonce = proto.read_seek(decode(data), time.time())
        if nonce is None:
            return
        now = time.monotonic()
        while self._answered and now - self._answered[0] > 1.0:
            self._answered.popleft()
        if len(self._answered) >= ANSWERS_PER_SECOND:
            return
        if not self._fresh_nonce(nonce, now):
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
        if (
            not verify(key, request.get("t"), "join", nc, ns, room["id"], ga, gb, proto.canonical(raw))
            or (invite is not None and (params["ulid"] != invite[0] or invite in room["passesUsed"]))
        ):
            self._bad_tag(room, peer, now)
            await conversation.say({"ok": False, "error": "bad_code"})
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
        }
        if invite is not None:
            room["passesUsed"].add(invite)
        await conversation.say({"ok": True, "seat": seat, "ip": address,
                                "t": proto.joined_tag(key, nc, ns, seat, address, ga, gb)})
        decky.logger.info("multiplayer: seat %s taken%s", seat, " through the online lobby" if door == "server" else "")
        self._announce()
        toast_key = params["device"] if door == "server" else peer
        for stale in [name for name, at in self._join_toasts.items() if now - at >= JOIN_TOAST_SECONDS]:
            del self._join_toasts[stale]
        last = self._join_toasts.get(toast_key)
        if last is None or now - last >= JOIN_TOAST_SECONDS:
            self._join_toasts[toast_key] = now
            self._toast_seat(params["user"], "Joined your room")

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
            decky.logger.info("multiplayer: seat %s left", index)
            await conversation.say({"ok": True})
            self._toast_seat(seat["name"], "Left your room")
            self._roster_left(room, index)
            self._announce()
            return
        self._take_report(room, index, seat, proto.read_report(message.get("p")))
        seat["since"] = proto.chat_since(message.get("p"))
        delivered = proto.inbox_since(message.get("p"))
        seat["inbox"] = [item for item in seat["inbox"] if item["seq"] > delivered]
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
            return {"id": room["id"], "name": room["name"], "where": room["where"]}
        joined = self._joined
        if joined is not None:
            row = joined["row"]
            return {"id": row["room"], "name": row["name"], "where": row["where"]}
        return None

    def _take_report(self, room: dict, index: int, seat: dict, report) -> None:
        if report is None or report["seq"] <= seat["seq"]:
            return
        was_ready = self._seat_ready(room, seat)
        seat.update(seq=report["seq"], ready=report["ready"], rev=report["rev"], round=report["round"],
                    can=report["can"], reason=report["reason"], gameId=report["gameId"],
                    title=report["title"], launched=report["launched"])
        if self._seat_ready(room, seat) != was_ready:
            self._debug("seat %s %s", index, "ready" if not was_ready else "not ready")

    def _seat_ready(self, room: dict, seat: dict) -> bool:
        return (
            room["state"] == "lobby"
            and seat["ready"]
            and seat["can"]
            and not seat["launched"]
            and seat["rev"] == room["rev"]
            and seat["round"] == room["round"]
        )

    def _can_start(self, room: dict) -> bool:
        if room["state"] != "lobby" or self._in_game():
            return False
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
            "players": room["players"] if room["state"] != "lobby" else 1 + len(_guests(room)),
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
        if not _guests(room):
            return {"ok": False, "error": ERROR_NO_GUESTS}
        if not self._can_start(room):
            return {"ok": False, "error": ERROR_NOBODY_READY}
        room["roster"] = [index for index, seat in enumerate(room["seats"])
                          if index > 0 and seat is not None and self._seat_ready(room, seat)]
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
            proto.make_seek(nonce, int(time.time())),
            lambda message: proto.read_room(message, nonce),
        )
        if server is not None and not self._listing.done():
            await asyncio.wait({self._listing}, timeout=LIST_GRACE_SECONDS)
        self._round += 1
        own = self._room["id"] if self._room is not None else None
        for room_id, row in found.items():
            if room_id != own:
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
            listed = await lobby_client.list_rooms(server)
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
            if verdict is None:
                local, reason, detail = self._decide(row, 0, "")
                verdict = {"can": local is not None, "reason": reason, "detail": detail}
                self._verdict_memo[key] = verdict
            found[row["room"]] = verdict
        return found

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
            if invite is not None:
                key, shown = invite["key"], {"ulid": invite["ulid"], "exp": invite["exp"]}
            else:
                key = await asyncio.to_thread(proto.room_key, password if row["private"] else "", row["room"])
                shown = None
            try:
                answer = await asyncio.wait_for(self._ask_to_join(row, key, params, shown), HANDSHAKE_SECONDS * 2)
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
                "readyAt": 0.0,
                "consentRound": 0,
                "fanfareRound": 0,
                "autostartRound": 0,
                "launchedRound": 0,
                "notice": "",
                "clock": (time.time(), time.monotonic()),
                "chat": [],
                "chatSince": 0,
                "fsince": 0,
            }
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

    async def _ask_to_join(self, row: dict, key: bytes, params: dict, shown=None) -> dict:
        nc = secrets.token_hex(16)
        private = proto.dh_private()
        ga = await asyncio.to_thread(proto.dh_public, private)
        first = {"op": "join", "v": proto.VERSION, "nc": nc, "ga": ga}
        if shown is not None:
            first["pass"] = shown
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
            await asyncio.sleep(POLL_SECONDS if answered else POLL_BACKOFF_SECONDS)

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
        fresh = [entry for entry in status["chat"] if entry["seq"] > joined["chatSince"]]
        if fresh:
            joined["chat"] = (joined["chat"] + fresh)[-proto.CHAT_KEPT:]
            joined["chatSince"] = fresh[-1]["seq"]
        if joined["ready"] and (status["rev"] != joined["readyRev"] or status["round"] != joined["readyRound"]):
            if status["start"] and status["round"] == joined["readyRound"] + 1 and status["rev"] == joined["readyRev"]:
                joined["consentRound"] = status["round"]
            joined["ready"] = False
        self._expire_ready(joined)
        self._follow_start(joined, status)
        self._announce()

    def _expire_ready(self, joined: dict) -> None:
        wall, mono = time.time(), time.monotonic()
        then_wall, then_mono = joined["clock"]
        joined["clock"] = (wall, mono)
        slept = (wall - then_wall) - (mono - then_mono) > SLEEP_JUMP_SECONDS
        idle = not self._live() and mono - max(joined["readyAt"], self._page_seen) > READY_EXPIRY_SECONDS
        if joined["ready"] and (slept or idle):
            decky.logger.info("multiplayer: ready cleared, %s", "the device slept" if slept else "nobody looked for a while")
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
                        "dolphin": _dolphin_couch(joined["row"]),
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
                "dolphin": _dolphin_couch(joined["row"])}

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
        for entry in library.values():
            if not any(path["shortcut"] for path in entry["paths"]):
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
            if status is None or status["state"] != "lobby":
                return {"ok": False, "error": ERROR_NOT_LOBBY}
            if joined["local"] is None:
                return {"ok": False, "error": ERROR_GATE, "gate": joined["reason"], "detail": joined["detail"]}
            if self._in_game():
                return {"ok": False, "error": ERROR_IN_GAME}
            joined["readyRev"] = status["rev"]
            joined["readyRound"] = status["round"]
            joined["readyAt"] = time.monotonic()
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
        payload = {**self._report(joined), "since": joined["chatSince"], "fsince": joined["fsince"], **(extra or {})}
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
        self._closed_reason = reason
        self._close_guest_tunnels()
        if self._poller is not None:
            self._poller.cancel()
            self._poller = None
        if tell_host and joined["error"] != ERROR_HOST_GONE:
            loop = self._loop
            if loop is not None and not loop.is_closed():
                self._spawn(self._ask(joined, "leave"))
        decky.logger.info("multiplayer: left the room")
        self._announce()

    def _guest_view(self, joined: dict) -> dict:
        status = joined["status"]
        return {
            "room": dict(joined["row"]),
            "seat": joined["seat"],
            "ip": joined["ip"],
            "status": {name: value for name, value in status.items() if name != "inbox"} if status else None,
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
            return {"ok": True, "seq": seq, "role": "host", "room": self._host_view(self._room)}
        if self._joined is not None:
            return {"ok": True, "seq": seq, "role": "guest", **self._guest_view(self._joined)}
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
        if stale is not None and not stale["started"]:
            self._session = None
            self._remove_session_files(stale["id"])
            self._close_guest_tunnels_soon()
        room = self._room
        joined = self._joined
        if room is not None:
            if room["state"] != "launching":
                return {"ok": False, "error": ERROR_NOT_READY}
            roster = [room["seats"][index] for index in room["roster"] if room["seats"][index] is not None]
            if not roster:
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
            players = 1 + len(roster)
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
            players = status["players"]
            peer = joined["row"]
            relay = self._relay_host() if joined["row"]["where"] == "online" else ""
        else:
            return {"ok": False, "error": ERROR_NO_ROOM}

        found, _warnings = self._gates(mode, local, peer, players)
        if found:
            return {"ok": False, "error": ERROR_GATE, "gate": found[0], "detail": found[1]}

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
                    system_dir=system_dir, share_controls=share,
                )
                self._write(opt_path, opt_text)
                self._write(cfg_path, cfg_text)
                files = [cfg_path, opt_path]
                core_path = ra.core_path(local["core"]) if local["core"] != local["shortcutCore"] else None
                args = session.retroarch_args(mode=mode, role=role, host_ip=host_ip, nick=nick,
                                              cfg_path=cfg_path, core_path=core_path, core=local["core"],
                                              rom=rom if local.get("duckstation") else None)
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
                                                    hardcore=hardcore, marker=marker)
            else:
                ini_path = self._session_dir / f"session-{sid}.ini"
                text = session.ppsspp_session(role=role, host_ip=host_ip, nick=nick,
                                              mac=session.psp_mac(self._machine_id()), hardcore=hardcore, relay=relay)
                self._write(ini_path, text)
                files = [ini_path]
                args = session.ppsspp_args(home=self._user_home, ini_path=ini_path)
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
        decky.logger.info("multiplayer: session %s ready for %s as %s", sid, mode, role)
        return {
            "ok": True,
            "appid": local["appid"],
            "options": session.compose_launch_options(original, args),
            "original": original,
            "session": sid,
        }

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
        for source in ra.save_paths(local["shortcutCore"], Path(local["path"])):
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

    def _write_restore(self, appid: int, original: str, sid: str) -> None:
        record = {"schemaVersion": RESTORE_SCHEMA, "appid": appid, "original": original, "session": sid,
                  "at": int(time.time())}
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
        return {"ok": True, "record": {"appid": raw["appid"], "original": raw["original"], "session": raw["session"]}}

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
        pid = await asyncio.to_thread(self._find_emulator, needle, ARGV_SECONDS)
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
        if current["emulator"] == "dolphin" and current.get("mode") == "couch":
            self._notify_steps(current["role"])
        await asyncio.to_thread(self._wait_exit, pid)
        if not self._stopping:
            self._finish(current)

    def _find_emulator(self, needle: str, limit: float):
        deadline = time.monotonic() + limit
        settle = None
        while time.monotonic() < deadline and not self._stopping:
            matches = _processes_naming(needle)
            emulators = [pid for pid, name in matches if name in EMULATOR_NAMES]
            if emulators:
                return min(emulators)
            if matches and settle is None:
                settle = time.monotonic() + SETTLE_SECONDS
            if settle is not None and time.monotonic() >= settle:
                return min(pid for pid, _name in matches) if matches else None
            time.sleep(0.5)
        matches = _processes_naming(needle)
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
            try:
                (self._session_dir / f"session-{sid}{suffix}").unlink()
            except FileNotFoundError:
                pass
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


def _dolphin_couch(row: dict) -> bool:
    return row["mode"] == "couch" and row["emulator"] == "dolphin"


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


def _processes_naming(needle: str) -> list:
    wanted = needle.encode()
    found = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/cmdline", "rb") as handle:
                cmdline = handle.read()
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
        except OSError:
            continue
        found.update(pattern.findall(cmdline.decode("utf-8", "replace")))
    return found

