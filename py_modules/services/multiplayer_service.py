import asyncio
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
import steam_shortcuts
import subprocess_util
from nearby_protocol import FrameError, clean_title, decode, frame, is_nonce, read_frame, verify
from notifications import emit_notification
from utils import atomic_file, child_owner, chown_to_data_owner, ensure_dir, load_json_file

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
RESTORE_SCHEMA = 1
SAVE_BACKUPS = "save-backups"
SAVE_BACKUPS_KEPT = 5

SESSION_EVENT = "multiplayer_session"

ARGV_SECONDS = 15
SETTLE_SECONDS = 5
APP_ENDED_GRACE_SECONDS = 10
FLATPAK_SECONDS = 10

EMULATOR_NAMES = ("retroarch", "PPSSPPSDL", "PPSSPPQt")

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
ERROR_GATE = "gate"
ERROR_NOT_READY = "not_ready"
ERROR_WRITE_FAILED = "write_failed"
ERROR_ARGS_DROPPED = "args_dropped"

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

        self._session = None
        self._stopping = False
        self._library_cache = (None, None)
        self._hash_memo = {}
        self._crc_memo = {}
        self._versions = None
        self._permissions = {}

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
            if entry or self._room is not None or self._joined is not None:
                self._cap_until = now + VISIT_CAP_SECONDS
                self._versions = None
                self._permissions = {}
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
        library = {}
        for game in results.get("supportedGames") or []:
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
        if self._versions is None:
            versions = {}
            out = self._flatpak("list", "--app", "--columns=application,version") or ""
            for line in out.splitlines():
                parts = line.split("\t")
                if len(parts) >= 2:
                    versions[parts[0].strip()] = parts[1].strip()
            self._versions = versions
        return self._versions.get(app, "")

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
            if mode == "link" and core not in (session.GAMBATTE, session.PPSSPP_CORE):
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
        for entry in library.values():
            shortcut = next((p["shortcut"] for p in entry["paths"] if p["shortcut"]), None)
            games.append({
                "gameId": entry["gameId"],
                "title": entry["title"],
                "systemId": entry["systemId"],
                "system": entry["system"],
                "imageIcon": entry["imageIcon"],
                "appid": shortcut["appid"] if shortcut else 0,
            })
        games.sort(key=lambda row: row["title"].lower())
        return {"ok": True, "scanned": True, "games": games, "installedCores": installed}

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
        }
        if mode == "link" and system_id not in GB_SYSTEMS and system_id != PSP_SYSTEM:
            return None, "link_system", {}

        if detected["emulator"] == "ppsspp":
            if mode == "couch":
                return None, "no_couch_core", {}
            if system_id != PSP_SYSTEM:
                return None, "unsupported_emulator", {}
            local.update(core=session.PPSSPP_STANDALONE, coreName="PPSSPP", shortcutCoreName="PPSSPP",
                         emuVersion=self._flatpak_version(session.PPSSPP_FLATPAK))
            return local, None, {}

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
            needed = session.GAMBATTE if system_id in GB_SYSTEMS else session.PPSSPP_CORE
            if chosen != needed:
                return None, "link_needs_gambatte" if needed == session.GAMBATTE else "link_needs_ppsspp", {}
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
        return local, None, {}

    def _gates(self, mode: str, local: dict, room, players: int):
        warnings = []
        rom = Path(local["path"])
        system_id = local["systemId"]
        ra = local.get("ra")

        if room is not None:
            if mode == "couch":
                if local["core"] != room["core"]:
                    if not ra or not ra.installed(room["core"]):
                        return ("host_core_missing", {"core": room["coreName"] or room["core"]}), warnings
                    return ("match_host_core", {"core": room["coreName"] or room["core"]}), warnings
                crc = self._crc_of(local["real"])
                if room["crc"] and crc and crc != room["crc"]:
                    if system_id == session.NES_SYSTEM:
                        return ("crc_mismatch", {}), warnings
                    warnings.append({"code": "crc_mismatch", "detail": {}})
            elif room["systemId"] in GB_SYSTEMS or system_id in GB_SYSTEMS:
                if system_id not in GB_SYSTEMS or room["systemId"] not in GB_SYSTEMS:
                    return ("link_gb_both", {}), warnings
                if room["core"] != session.GAMBATTE or local["core"] != session.GAMBATTE:
                    return ("link_needs_gambatte_both", {}), warnings
            else:
                if room["gameId"] != local["gameId"]:
                    return ("different_game", {}), warnings
                if room["core"] not in (session.PPSSPP_CORE, session.PPSSPP_STANDALONE):
                    return ("link_needs_ppsspp", {}), warnings
                if room["hash"] and self._hash_of_path(local, system_id) not in ("", room["hash"]):
                    warnings.append({"code": "revision_differs", "detail": {}})
            if _known(room["emuVersion"]) and _known(local["emuVersion"]) and room["emuVersion"] != local["emuVersion"]:
                warnings.append({"code": "version_mismatch", "detail": {}})

        if ra is not None:
            key = ra.overriding_key(local["core"], rom)
            if key:
                return ("override", {"key": key}), warnings
            if mode == "couch" and players > 2 and local["core"] in session.MULTITAP \
                    and ra.remap_sets_device(local["core"], rom):
                return ("remap", {}), warnings
            if local["core"] != local["shortcutCore"]:
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
        elif not self._flatpak_reads_home(session.PPSSPP_FLATPAK):
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
            return max(2, sum(1 for name in room["seats"] if name) + 1)
        return 2

    def check(self, mode: str, game_id: int, core: str, room_id: str = "") -> dict:
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
        }

    async def host(self, mode: str, game_id: int, hardcore: bool, private: bool, core: str = "") -> dict:
        async with self._lock:
            refused = self._refusal()
            if refused is not None:
                return {"ok": False, "error": refused}
            if self._room is not None or self._joined is not None:
                return {"ok": False, "error": ERROR_BUSY}
            if mode not in proto.MODES:
                return {"ok": False, "error": ERROR_NO_GAME}
            local, gate, detail = await asyncio.to_thread(self._local, mode, game_id, core, None)
            if local is not None:
                found, _warnings = await asyncio.to_thread(self._gates, mode, local, None, 2)
                if found:
                    gate, detail = found
            if gate:
                return {"ok": False, "error": ERROR_GATE, "gate": gate, "detail": detail}
            described = await asyncio.to_thread(self._describe, mode, local)

            seats = _seat_count(mode, local)
            user = self._user()
            room = {
                **described,
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
                "local": local,
            }
            if not await self._open():
                return {"ok": False, "error": ERROR_UNAVAILABLE}
            self._room = room
            self._closed_reason = ""
            self._seen.clear()
            self._housekeeper = self._spawn(self._keep_house(room))
            decky.logger.info(
                "multiplayer: hosting %s, %s on %s, %s seats%s",
                local["gameId"], mode, local["core"], seats, ", private" if private else "",
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
            "crc": self._crc_of(local["real"]) if mode == "couch" else "",
        }

    def room_options(self, hardcore=None, private=None, core=None) -> dict:
        room = self._room
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if _guests(room) or room["state"] != "lobby":
            return {"ok": False, "error": ERROR_SEATED}
        if core is not None and core != room["core"]:
            local, gate, detail = self._local(room["mode"], room["gameId"], core, None)
            if local is None:
                return {"ok": False, "error": ERROR_GATE, "gate": gate, "detail": detail}
            seats = _seat_count(room["mode"], local)
            room.update(core=local["core"], coreName=local["coreName"], emuVersion=local["emuVersion"],
                        local=local, max=seats, seats=room["seats"][:1] + [None] * (seats - 1))
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
        current = self._session
        if current is not None and current["seen"] and _listening(proto.game_port(room["mode"], room["emulator"])):
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
        current = self._session
        if current is not None and (current["exited"] or current["error"]):
            decky.logger.info("multiplayer: handoff over, the game ended")
            self._close_room("")
        elif not _guests(room):
            decky.logger.info("multiplayer: handoff over, no guests left")
            self._close_room("")
        elif all(seat.get("launched") for seat in _guests(room)):
            decky.logger.info("multiplayer: handoff over, every seat launched")
            self._close_room("")
        elif now >= room["handoffUntil"]:
            decky.logger.info("multiplayer: handoff over, timed out")
            self._close_room("")

    def launch_started(self) -> dict:
        current = self._session
        if current is None or current["started"]:
            return {"ok": False, "error": ERROR_NOT_READY}
        current["started"] = time.monotonic()
        current["watch"] = self._spawn(self._watch(current))

        room = self._room
        if room is not None:
            if room["state"] == "lobby":
                room["state"] = "handoff"
                room["handoffUntil"] = time.monotonic() + HANDOFF_SECONDS
                decky.logger.info("multiplayer: host launched, handing off to %s guests", len(_guests(room)))
            return {"ok": True}
        joined = self._joined
        if joined is not None and not joined["launched"]:
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
        emit_notification(
            ntype="system",
            settings_store=self._settings_store,
            event_loop=self._loop,
            toast_title=params["user"],
            line_key="Joined your room",
            force_toast=True,
        )

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

    async def join(self, room_id: str, code: str, game_id: int = 0, core: str = "") -> dict:
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
            local, gate, detail = await asyncio.to_thread(self._local, row["mode"], game_id, core, row)
            if local is not None:
                found, _warnings = await asyncio.to_thread(
                    self._gates, row["mode"], local, row, self._players(row["mode"], row)
                )
                if found:
                    gate, detail = found
            if gate:
                return {"ok": False, "error": ERROR_GATE, "gate": gate, "detail": detail}
            params = proto.join_params(
                self._user(), self._hash_of_path(local, local["systemId"]),
                self._crc_of(local["real"]) if row["mode"] == "couch" else "", local["core"], local["emuVersion"],
            )
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
                "local": local,
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
        room = self._room
        joined = self._joined
        if room is not None:
            if room["state"] != "lobby":
                return {"ok": False, "error": ERROR_NOT_READY}
            if not _guests(room):
                return {"ok": False, "error": ERROR_NO_GUESTS}
            role = "host"
            mode = room["mode"]
            local = room["local"]
            seat = 0
            host_ip = _guests(room)[0]["ip"]
            hardcore = room["hardcore"] if mode == "couch" else bool(hardcore)
            players = 1 + len(_guests(room))
            peer = None
        elif joined is not None:
            status = joined["status"]
            if joined["launched"] or joined["error"] or status is None or status["state"] != "playing":
                return {"ok": False, "error": ERROR_NOT_READY}
            role = "guest"
            mode = joined["row"]["mode"]
            local = joined["local"]
            seat = joined["seat"]
            host_ip = joined["ip"]
            hardcore = status["hardcore"] if mode == "couch" else bool(hardcore)
            players = sum(1 for name in status["members"] if name)
            peer = joined["row"]
        else:
            return {"ok": False, "error": ERROR_NO_ROOM}

        found, _warnings = self._gates(mode, local, peer, players)
        if found:
            return {"ok": False, "error": ERROR_GATE, "gate": found[0], "detail": found[1]}

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
                cfg_text, opt_text = session.retroarch_session(
                    ra, core=local["core"], rom=rom, mode=mode, role=role, hardcore=hardcore, opt_path=opt_path,
                    guests=players - 1, seat=seat, host_ip=host_ip, players=players,
                )
                self._write(opt_path, opt_text)
                self._write(cfg_path, cfg_text)
                files = [cfg_path, opt_path]
                core_path = ra.core_path(local["core"]) if local["core"] != local["shortcutCore"] else None
                args = session.retroarch_args(mode=mode, role=role, host_ip=host_ip, nick=nick,
                                              cfg_path=cfg_path, core_path=core_path)
                if core_path is not None:
                    self._back_up_save(ra, local)
            else:
                ini_path = self._session_dir / f"session-{sid}.ini"
                self._write(ini_path, session.ppsspp_session(role=role, host_ip=host_ip, nick=nick, hardcore=hardcore))
                files = [ini_path]
                args = session.ppsspp_args(home=self._user_home, ini_path=ini_path)
            if not self._readable_by_owner(files):
                raise OSError("session files are not the home owner's")
            self._write_restore(local["appid"], original, sid)
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't write the session files (%s)", type(e).__name__)
            return {"ok": False, "error": ERROR_WRITE_FAILED}

        self._session = {
            "id": sid,
            "appid": local["appid"],
            "role": role,
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
        decky.logger.info("multiplayer: backed up the save for %s before switching cores", local["gameId"])
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
            if self._room is not None:
                self._close_room(ERROR_ARGS_DROPPED)
            self._emit({"state": "failed", "session": current["id"], "error": ERROR_ARGS_DROPPED})
            current["exited"] = True
            return
        current["seen"] = True
        current["pid"] = pid
        decky.logger.info("multiplayer: following the emulator, pid %s", pid)
        self._emit({"state": "playing", "session": current["id"]})
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
        if self._joined is not None and self._joined["launched"]:
            self._drop_joined(tell_host=False)
        if self._room is not None and self._room["state"] == "handoff":
            self._close_room("")
        self._remove_files(current)
        self._emit({"state": "ended", "session": current["id"]})

    def _remove_files(self, current: dict) -> None:
        if current["id"] in self._restore_sessions():
            return
        self._remove_session_files(current["id"])

    def _remove_session_files(self, sid: str) -> None:
        for suffix in (".cfg", ".opt", ".ini"):
            try:
                (self._session_dir / f"session-{sid}{suffix}").unlink()
            except FileNotFoundError:
                pass
            except OSError as e:
                decky.logger.warning("multiplayer: couldn't remove a session file (%s)", type(e).__name__)

    def _emit(self, payload: dict) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(decky.emit(SESSION_EVENT, payload), loop)
        except Exception as e:
            decky.logger.warning("multiplayer: couldn't tell the panel (%s)", type(e).__name__)

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
                if found is None or found.group(1) in keep or not entry.is_file():
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
        files = [path for path in (self._session_dir / f"session-{sid}.cfg", self._session_dir / f"session-{sid}.ini")
                 if path.exists()]
        if not files:
            return
        record = self.restore_record()["record"] or {}
        current = {
            "id": sid,
            "appid": record.get("appid", 0) if record.get("session") == sid else 0,
            "role": "",
            "emulator": "retroarch" if files[0].suffix == ".cfg" else "ppsspp",
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


def _new_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def _known(version: str) -> bool:
    return bool(version) and all(version.split("|"))


def _seat_count(mode: str, local: dict) -> int:
    if mode == "link":
        return 2 if local["systemId"] in GB_SYSTEMS else proto.MAX_SEATS
    return proto.MAX_SEATS if local["core"] in session.MULTITAP else 2


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
