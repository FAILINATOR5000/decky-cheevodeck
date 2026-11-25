import asyncio
import contextlib
import functools
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
import emulator_catalog as catalog
import multiplayer_lounge as lounge
import multiplayer_protocol as proto
from services import dolphin_game_mappings, game_clock, game_pipes, stream_room, wii_saves
import multiplayer_session as session
import rom_headers
import rtc_formats
import steam_shortcuts
import subprocess_util
from cheevo_check_systems import RAW_DISC_EXTENSIONS, by_console_id
from multiplayer_game_options_store import MultiplayerGameOptionsStore
from play_picks_store import PlayPicksStore, clean_pick
from multiplayer_protocol import decode, frame, read_frame
from nearby_protocol import FrameError, clean_title, is_nonce, verify
from notifications import emit_notification
from services import lobby_client, lobby_tunnel
from services.file_watcher_service import steam_game_running
from services.round_saves import _write_real
from services.stream_host import graphics_drivers, has_amd_graphics
from services.update_checker_service import parse_version
from utils import atomic_file, child_owner, chown_to_data_owner, ensure_dir, load_json_file, to_int, user_file_target

LEASE_SECONDS = 30
CRC_MAX_BYTES = 64 << 20
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
GAMES_FAST_SECONDS = 30
STREAM_RETRY_SECONDS = 60
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
JOIN_TOAST_SECONDS = 5

LAUNCH_WAIT_SECONDS = 300
LAUNCH_START_SECONDS = 60
SLEEP_JUMP_SECONDS = 60

HOUSEKEEPING_SECONDS = 5
LIBRARY_WARM_SECONDS = 5
INDEX_START_SECONDS = 8
INDEX_TICK_SECONDS = 60
INDEX_SETTLE_SECONDS = 30
INDEX_CHECK_SECONDS = 3600

DOLPHIN_TUNNEL_PORT = 2627

LIST_GRACE_SECONDS = 0.5
PAGE_RENEW_ROUNDS = 3
PAGE_RETRY_SECONDS = 1.0
QUERY_CHARS = 64
STATUS_CODES_MAX = 8
GAMES_BYTES_MAX = 15000
VERDICTS_HELD = 512
PAGE_CHOICES = {
    "mode": ("link", "couch", "stream"),
    "kind": ("play", "watch"),
    "access": ("public", "friends", "private"),
    "seats": ("open",),
    "where": ("local", "online"),
}
NO_PAGE = {"q": "", "statuses": (), "mode": "", "kind": "", "access": "", "seats": "", "where": "",
           "mine": False, "after": None}
NO_PAGE_INFO = {"total": None, "next": None, "checkHere": False}
DEVICE_MODELS = {"Jupiter": "l", "Galileo": "o", "Fremont": "m"}
ROOM_OPTION_KEYS = ("checkFrames", "share", "watch", "bitrate")
_STATUS_CODE = re.compile(r"[a-z_]{1,16}")

BAD_TAGS_PER_ADDRESS = 3
LOCKOUT_SECONDS = 60
BAD_TAGS_PER_ROOM = 10

SESSION_DIR = "multiplayer"
RESTORE_RECORD = "multiplayer_restore.json"
INSTALL_NAMES = {"flatpak": "Flatpak", "appimage": "AppImage"}
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
SAVE_PING_SECONDS = 3
SAVE_FOLLOW_UP_SECONDS = 1
SAVE_REPLY_SECONDS = 1
SAVE_SILENT_WARN_SECONDS = 30
RETROARCH_NETPLAY_AUTOSAVE_SINCE = None
RETROARCH_COMMAND_PORT = 55355
ROUND_FOLDER_PROBE_SECONDS = 10
SKEW_LOG_SECONDS = 60

SESSION_EVENT = "multiplayer_session"
ROOM_EVENT = "multiplayer_room"
VOICE_EVENT = "multiplayer_voice"
VOICE_DEBUG_EVENT = "multiplayer_voice_debug"
VOICE_CANCELLER_EVENT = "multiplayer_voice_canceller"

ARGV_SECONDS = 15
PAIR_WAIT_SECONDS = 30
MOONLIGHT_AUDIO_SECONDS = 30
SUNSHINE_RETRY_SECONDS = 2
SETTLE_SECONDS = 5
SUNSHINE_PARK_SECONDS = 120
PARK_UNPAIR_AGAIN_SECONDS = 21
APP_ENDED_GRACE_SECONDS = 10
STREAM_GAME_CHECK_SECONDS = 3
STREAM_GAME_GONE_CHECKS = 2
FLATPAK_SECONDS = 10
FLATPAK_RECHECK_SECONDS = 10
HASH_WAIT_SECONDS = 900
HASH_RETRY_SECONDS = 60

EMULATOR_NAMES = ("retroarch", "PPSSPPSDL", "PPSSPPQt", "dolphin-emu", "RMG")
GAME_AUDIO_BINARIES = (*EMULATOR_NAMES, "moonlight")
FALLBACK_NAMES = {"retroarch": "RetroArch", "ppsspp": "PPSSPP", "dolphin": "Dolphin", "rmg": "RMG",
                  "duckstation": "DuckStation", "pcsx2": "PCSX2", "melonds": "melonDS"}

RMG_SERVER_NAME = "rmg-netplay-server"
RMG_SERVER_LOG = "rmg-netplay-server.log"
RMG_SERVER_GAMES = 4
RMG_SERVER_START_SECONDS = 3.0
RMG_TCP_PORTS = tuple(range(session.RMG_SERVER_PORT, session.RMG_SERVER_PORT + RMG_SERVER_GAMES + 1))
RMG_UDP_PORTS = RMG_TCP_PORTS[1:]
PIPE_TCP_PORTS = (proto.RETROARCH_NETPLAY_PORT, proto.GAMBATTE_LINK_PORT, *RMG_TCP_PORTS)
PIPE_UDP_PORTS = ((DOLPHIN_TUNNEL_PORT, proto.DOLPHIN_NETPLAY_PORT), *RMG_UDP_PORTS)
SESSION_SUFFIXES = {".cfg": "retroarch", ".ini": "ppsspp", ".dolphin": "dolphin", ".rmg": "rmg"}
GUEST_SAVES = ".saves"

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
ERROR_STREAM_UNREACHABLE = "stream_unreachable"
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
ERROR_HOST_SETUP = "host_setup"
ERROR_HOST_NEVER = "host_never"
ERROR_VOTE_OPEN = "vote_open"
ERROR_VOTE_GAMES = "vote_games"
ERROR_VOTE_LOBBY = "vote_wait_lobby"
ERROR_SWITCHING = "room_switching"
ERROR_ROOM_LOCKED = "room_locked"
ERROR_UPDATE_REQUIRED = "update_required"

CHAT_GAP_SECONDS = 1

_JOIN_REFUSALS = {
    "bad_code": ERROR_BAD_CODE,
    "locked": ERROR_LOCKED_OUT,
    "full": ERROR_FULL,
    "closed": ERROR_ROOM_GONE,
    "dropped": ERROR_DROPPED,
    "expired": ERROR_INVITE_EXPIRED,
    "friends_only": ERROR_FRIENDS_ONLY,
    "room_locked": ERROR_ROOM_LOCKED,
    "update_required": ERROR_UPDATE_REQUIRED,
}

_SESSION_ID = re.compile(r"session-([0-9a-f]{16})\.")
ROUND_STATE = ".state"

PLUGIN_VERSION = str(getattr(decky, "DECKY_PLUGIN_VERSION", "") or "").strip()

GB_SYSTEMS = session.GB_SYSTEMS
PSP_SYSTEM = session.PSP_SYSTEM
PS2_SYSTEM = 21
DSI_SYSTEM = 78
GCI_REGIONS = {"E": ("USA", "USA"), "J": ("JAP", "JPN"),
               **{letter: ("EUR", "EUR") for letter in "PDFSIHUXYZ"}}
GCI_FOLDER_DEVICE = "8"
NO_SAVE_BACKUP_SYSTEMS = frozenset({9, 39, 40, 27, 81, 14, 29, 43, 24, PS2_SYSTEM, PSP_SYSTEM,
                                    25, 51, 13, 45, 46, 23, 57, 63})
VIRTUAL_PADS = ".local/share/Steam/config/virtualgamepadinfo.txt"
SUNSHINE_PAD = ("0x045e", "0x0b13")
INPUT_DEVICES = Path("/proc/bus/input/devices")
GUEST_SLOT = ("name=Xbox One controller", f"VID={SUNSHINE_PAD[0]}", f"PID={SUNSHINE_PAD[1]}", "handle=0x{}",
              "type=xboxone")
TAP_NAMES = {"team": "Team Player", "4way": "4-Way Play", "port1": "the multitap on port 1",
             "port2": "the multitap on port 2"}
PORT_TWO_GAMES = {6294}
STREAM_EMULATOR_NAMES = {
    "retroarch": "RetroArch", "ppsspp": "PPSSPP", "dolphin": "Dolphin", "rmg": "RMG", "duckstation": "DuckStation",
    "pcsx2": "PCSX2", "melonds": "melonDS",
}
SETUP_GATES = {
    "stream_not_set_up", "stream_needs_update", "no_play_core", "emulator_missing", "retroarch_first_run", "needs_dolphin",
    "host_core_missing", "couch_core_missing", "no_couch_core", "core_cant_couch", "match_host_core",
    "link_needs_gambatte", "link_needs_gambatte_both", "link_needs_gpsp", "link_needs_melondsds", "link_needs_ppsspp",
    "gpsp_too_old", "melondsds_too_old",
    "dolphin_version_mismatch", "rmg_version_mismatch", "ppsspp_version_mismatch",
    "no_scan", "not_in_results", "rom_missing", "dolphin_game_list",
}
VERSION_GATES = {"dolphin_version_mismatch", "rmg_version_mismatch", "ppsspp_version_mismatch"}
PICK_GATES = {"no_scan", "not_in_results", "rom_missing"}
PICK_STEP = {"do": "pick_game_file", "where": "client"}
PLAN_STAGES = 6
STEP_ORDER = {"enable_shortcut_fallback": 0, "enable_play_shortcut_fallback": 0, "setup_streaming": 0,
              "install_emulator": 1, "update_emulator": 1, "add_to_steam": 2, "install_core": 3, "update_core": 3,
              "add_dolphin_folder": 3, "pick_game_file": 4}
PLANNED_GATES = {
    "stream_not_set_up", "no_shortcut", "host_core_missing", "couch_core_missing", "no_couch_core",
    "link_needs_gambatte", "link_needs_gambatte_both", "link_needs_gpsp", "link_needs_melondsds", "link_needs_ppsspp",
    "gpsp_too_old", "melondsds_too_old", "no_emulator_shortcut", "no_dolphin_emulator_shortcut", "no_rmg_shortcut",
    "duckstation_no_multiplayer", "dolphin_version_mismatch", "rmg_version_mismatch", "ppsspp_version_mismatch",
    "no_play_core", "emulator_missing", "needs_dolphin", "dolphin_game_list",
}
ROUND_KINDS = {"link": "pt_round_link", "couch": "pt_round_couch", "stream": "pt_round_stream"}
LOUNGE_WIN_KINDS = {"ttt": "pt_win_ttt", "c4": "pt_win_c4", "rev": "pt_win_rev", "chk": "pt_win_chk"}


class _Overlay:
    def __init__(self):
        self.mp_fallback = None
        self.play_fallback = None
        self.streaming = False
        self.flatpaks = set()
        self.shortcuts = []
        self.cores = set()
        self.versions = {}
        self.files = set()
        self.dolphin_folders = set()


class _RetroArchAfter(session.RetroArch):
    def __init__(self, home, cores, listed):
        super().__init__(home)
        self._after = cores
        self._listed = listed

    def info(self, core: str):
        found = super().info(core)
        if found is None and core in self._after and self._listed is not None:
            found = self._listed(core)
            self._info[core] = found
        return found

    def installed(self, core: str) -> bool:
        return (core in self._after and self.info(core) is not None) or super().installed(core)

    def installed_cores(self) -> list:
        cores = set(super().installed_cores())
        cores.update(core for core in self._after if self.info(core) is not None)
        return sorted(cores)

    def version(self, core: str) -> str:
        return "" if core in self._after else super().version(core)


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


def _read_page(raw) -> dict:
    page = dict(NO_PAGE)
    if not isinstance(raw, dict):
        return page
    query = raw.get("q")
    if isinstance(query, str):
        page["q"] = query.strip()[:QUERY_CHARS]
    statuses = raw.get("statuses")
    if isinstance(statuses, list):
        page["statuses"] = tuple(code for code in statuses
                                 if isinstance(code, str) and _STATUS_CODE.fullmatch(code))[:STATUS_CODES_MAX]
    for name, allowed in PAGE_CHOICES.items():
        value = raw.get(name)
        page[name] = value if isinstance(value, str) and value in allowed else ""
    page["mine"] = raw.get("mine") is True
    after = raw.get("after")
    page["after"] = after if isinstance(after, str) and 0 < len(after) <= lobby_client.CURSOR_CHARS else None
    return page


def _wire_filters(page: dict) -> dict:
    wire = {name: page[name] for name in ("mode", "kind", "access", "seats") if page[name]}
    if page["q"]:
        wire["q"] = page["q"]
        if page["statuses"]:
            wire["statuses"] = list(page["statuses"])
    return wire


def _wire_page(page: dict, games) -> dict:
    wire = {"size": lobby_client.PAGE_ROOMS, **_wire_filters(page)}
    if page["after"]:
        wire["after"] = page["after"]
    if games is not None:
        wire["games"] = games
    return wire


def _in_one_pass(method):
    @functools.wraps(method)
    def wrapped(self, *args, **kwargs):
        with self._one_pass():
            return method(self, *args, **kwargs)
    return wrapped


class MultiplayerService:
    def __init__(
        self, *, settings_store, game_mode, user_home, runtime_dir, cheevo_check_service, cheevo_check_store,
        port: int = proto.PORT, peer_port: int = proto.PORT,
        broadcast: str = "255.255.255.255", bin_dir=None, voice_canceller=None, voice_room_changed=None,
        stream_setup=None, stream_host=None, emulator_service=None, save_backups=None, dolphin_mappings=None,
        steady_wifi=None, round_saves=None, clock=None,
    ):
        self._settings_store = settings_store
        self._clock = clock
        self._steady = steady_wifi
        self._round_saves = round_saves
        self._mappings = dolphin_mappings
        self._emulators = emulator_service
        self._backups = save_backups
        self._stream_setup = stream_setup
        self._stream_host = stream_host
        self._voice_canceller = voice_canceller
        self._voice_room_changed = voice_room_changed
        self._in_voice_room = False
        self._game_mode = game_mode
        self._user_home = Path(user_home)
        self._session_dir = Path(runtime_dir) / SESSION_DIR
        if round_saves is not None:
            round_saves.set_running(lambda: _running_sessions(str(self._session_dir)))
        self._picks = PlayPicksStore(base_dir=Path(runtime_dir))
        self._game_options = MultiplayerGameOptionsStore(base_dir=Path(runtime_dir), settings_store=settings_store)
        self._sunshine_parked = False
        self._park_task = None
        self._session_picks = {}
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
        self._joined = None
        self._rooms = {}
        self._round = 0
        self._link = None
        self._listing = None
        self._online = {}
        self._online_error = ""
        self._prefer_server = False
        self._no_amd_debug = False
        self._said_no_amd = False
        self._page = NO_PAGE
        self._page_info = NO_PAGE_INFO
        self._page_gen = 0
        self._page_round = 0

        self._housekeeper = None
        self._poller = None
        self._tasks = set()
        self._swept = False
        self._model = _device_model()
        self._pads = 0

        self._session = None
        self._stopping = False
        self._goodbye = None
        self._library_cache = (None, None)
        self._library_lock = threading.RLock()
        self._picked_cache = (None, {})
        self._picked_watch = ()
        self._scanned_real = (None, {})
        self._picked_real = (None, {})
        self._restore_cache = (None, None)
        self._index_check = None
        steam_shortcuts.configure(decky.logger, lambda: self._settings_store.get_debug_logging(
            self._settings_store.load_config()))
        self._pass = threading.local()
        self._verdict_memo = {}
        self._verdict_lock = threading.Lock()
        self._hash_memo = {}
        self._hash_reads = {}
        self._hash_failed = {}
        self._hash_lock = threading.Lock()
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
        self._friend_sent = {}
        self._hotspot = None
        self._voice_relay = False
        self._overlays = threading.local()
        self._dolphin_picks = {}
        self._milestone_event = None

    def set_friends(self, friends) -> None:
        self._friends = friends

    def set_hotspot(self, hotspot) -> None:
        self._hotspot = hotspot

    def set_milestone_event(self, record) -> None:
        self._milestone_event = record

    def _count(self, *kinds) -> None:
        record = self._milestone_event
        if record is None:
            return
        for kind in kinds:
            record(kind)

    def _count_round(self, mode: str, together: bool, full: bool, watching: bool) -> None:
        if not together:
            return
        kinds = [ROUND_KINDS[mode]]
        if full:
            kinds.append("pt_full_house")
        hotspot = self._hotspot
        if hotspot is not None and hotspot.lan_address():
            kinds.append("pt_round_hotspot")
        if watching:
            kinds.append("pt_watch")
        self._count(*kinds)

    def _count_host_round(self, room: dict) -> None:
        current = self._session
        if (room["countedRound"] == room["round"] or current is None or not current["started"]
                or current["exited"] or not _guests(room)):
            return
        room["countedRound"] = room["round"]
        self._count_round(current["mode"], True, all(seat is not None for seat in room["seats"]), False)

    def _count_lounge(self, game: str, board: dict, seat: int) -> None:
        players = board["players"]
        if not any(player["seat"] == seat and not player["gone"] for player in players):
            return
        kinds = ["pt_lounge_played"]
        winner = board["winner"]
        if board["end"] == "win" and 0 <= winner < len(players) and players[winner]["seat"] == seat:
            kinds.append(LOUNGE_WIN_KINDS[game])
        self._count(*kinds)

    def room_role(self) -> str:
        if self._room is not None:
            return "host"
        return "guest" if self._joined is not None else ""

    def _lan_address(self) -> str:
        hotspot = self._hotspot
        return (hotspot.lan_address() if hotspot is not None else "") or _route_address()

    def _identity(self) -> tuple:
        friends = self._friends
        return friends.identity() if friends is not None else ("", "")

    def _rank(self):
        friends = self._friends
        return friends.rank() if friends is not None else None

    def set_event_loop(self, loop) -> None:
        self._loop = loop
        if not self._swept:
            self._swept = True
            loop.run_in_executor(None, self._startup_sweep)
            self._spawn(self._shortcut_upkeep())

    async def _shortcut_upkeep(self) -> None:
        await asyncio.sleep(INDEX_START_SECONDS)
        seen = None
        try:
            await asyncio.to_thread(steam_shortcuts.current, self._user_home)
            seen = await asyncio.to_thread(self._index_marks)
            await asyncio.to_thread(self.games)
        except Exception as e:
            decky.logger.warning("multiplayer: couldn't build the shortcut index (%s)", type(e).__name__)
        checked_at, changed_at = time.monotonic(), None
        while True:
            await asyncio.sleep(INDEX_TICK_SECONDS)
            try:
                if not self._game_mode():
                    continue
                marks = await asyncio.to_thread(self._index_marks)
                if seen is None:
                    seen = marks
                if marks != seen:
                    seen, changed_at = marks, time.monotonic()
                now = time.monotonic()
                due = (changed_at is not None and now - changed_at >= INDEX_SETTLE_SECONDS) \
                    or now - checked_at >= INDEX_CHECK_SECONDS
                if not due or not await asyncio.to_thread(self._idle):
                    continue
                await asyncio.to_thread(self.check_shortcut_index)
                checked_at, changed_at = time.monotonic(), None
                seen = await asyncio.to_thread(self._index_marks)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                decky.logger.warning("multiplayer: the shortcut index check failed (%s)", type(e).__name__)
                checked_at, changed_at = time.monotonic(), None

    def _index_marks(self) -> tuple:
        return steam_shortcuts.stamps(self._user_home), hashlib.sha1(steam_shortcuts.mounts()).hexdigest()

    def _idle(self) -> bool:
        if not self._game_mode():
            return False
        current = self._session
        if current is not None and not current["exited"]:
            return False
        if self.restore_record()["record"] is not None:
            return False
        room = self._room
        if room is not None and room["state"] != "lobby":
            return False
        joined = self._joined
        if joined is not None and (joined["status"] or {}).get("state", "lobby") != "lobby":
            return False
        return not steam_game_running()

    def check_shortcut_index(self) -> dict:
        index = steam_shortcuts.verify(self._user_home) or {}
        moved = []
        for known in (self._scanned_real[1], self._picked_real[1]):
            for path, real in list(known.items()):
                now = os.path.realpath(path)
                if now != real:
                    moved.append(path)
                    known[path] = now
        if moved:
            with self._library_lock:
                self._library_cache = (None, None)
        stale = index.get("stale", 0)
        if stale or moved:
            decky.logger.warning("multiplayer: shortcut index: %d stale matches, %d stale paths, rebuilt (%s)",
                                 stale, len(moved), ", ".join((index.get("examples") or []) + moved[:3]))
        else:
            self._debug("shortcut index checked, nothing stale (%s ms)", index.get("ms", 0))
        self._index_check = {"at": int(time.time()), "stale": stale, "movedPaths": len(moved)}
        return self._index_check

    def shortcut_index_info(self, check: bool) -> dict:
        if check:
            self.check_shortcut_index()
        return {"ok": True, **steam_shortcuts.describe(self._user_home),
                "scannedPaths": len(self._scanned_real[1]), "pickedPaths": len(self._picked_real[1]),
                "libraryGeneration": self._library_cache[0][3] if self._library_cache[0] else 0,
                "libraryCheck": self._index_check}

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
                    self._page_info = NO_PAGE_INFO
                    self._page_gen += 1
            elif now >= self._cap_until:
                if self._live():
                    decky.logger.info("multiplayer: the visit reached its cap")
                self._end_visit()
                return {"ok": False, "error": ERROR_CAP_REACHED}

            self._visible_until = min(now + LEASE_SECONDS, self._cap_until)
            changed = self._emulators.changed if self._emulators is not None else 0
            if self._room is not None and self._room["state"] == "lobby" \
                    and (entry or changed != self._room.get("versionsChecked") or self._room["hostState"]):
                self._room["versionsChecked"] = changed
                self._spawn(self.refresh_room_version())
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
        self._forget_page()

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
        steam_shortcuts.stop()
        if self._round_saves is not None:
            self._round_saves.flush()
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

    def _output_size(self):
        uid = self._user_home.stat().st_uid
        env = {"HOME": str(self._user_home), "PATH": "/usr/bin:/bin", "DISPLAY": ":0",
               "XDG_RUNTIME_DIR": f"/run/user/{uid}"}
        try:
            code, out, _err = subprocess_util.run_command(["xrandr", "--current"], timeout=3, env=env,
                                                          as_data_owner=True)
        except Exception:
            return None
        match = re.search(r"current (\d+) x (\d+)", out) if code == 0 else None
        return stream_room.parse_screen(f"{match.group(1)}x{match.group(2)}") if match else None

    def _stream_size(self, side: str, screen: str):
        size = self._output_size()
        if size is not None:
            self._debug("stream: sizing the %s at %sx%s (display)", side, *size)
            return size
        self._debug("stream: sizing the %s at %s (page)", side, screen or "unknown")
        return stream_room.parse_screen(screen)

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
            gpipe = joined.get("gpipe")
            if self._guest_tunnels is not None or gpipe is not None:
                self._close_guest_tunnels()
                if gpipe is not None:
                    await gpipe.shut()
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
                               "ready": bool(seat) and index > 0 and self._seat_shown_ready(room, index, seat)}
                              for index, seat in enumerate(room["seats"])],
                    "rev": room["rev"], "round": room["round"], "state": self._public_state(room),
                    "chat": dict(room["chat"][-1]) if room["chat"] else None, "chatBacklog": 0, "lobby": self._lobby_state(),
                    "voice": self._voice_view(), "roomVoice": bool(room["voice"]), "locked": room["locked"],
                    "gameId": room["gameId"], "imageIcon": room["imageIcon"],
                    "size": len(room["seats"]), "taken": 1 + len(_guests(room)), "own": None,
                    "vote": _vote_marker(lounge.vote_view(room["vote"], lounge.voter_key(room["seats"][0]))),
                    "lounge": _lounge_marker(lounge.lounge_view(room["lounge"])),
                    "pads": [self._seat_pads(index, seat) for index, seat in enumerate(room["seats"])]}
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
                    "chat": dict(joined["chat"][-1]) if joined["chat"] else None, "chatBacklog": joined["chatBacklog"],
                    "autostart": self._pending_start(joined), "voice": self._voice_view(),
                    "roomVoice": bool(joined["row"].get("voice")), "locked": joined["row"]["locked"],
                    "gameId": joined["row"]["gameId"], "size": len(members),
                    "taken": sum(1 for name in members if name), **self._guest_game(joined),
                    "vote": _vote_marker(status.get("vote")), "lounge": _lounge_marker(status.get("lounge")),
                    "pads": status.get("pads") or []}
        return {"role": None, "title": "", "host": "", "seated": 0, "error": "", "seat": 0, "ready": False,
                "seats": [], "rev": 0, "round": 0, "state": "lobby", "chat": None, "voice": None}

    def _guest_game(self, joined: dict) -> dict:
        local = joined["local"]
        if local is None:
            return {"imageIcon": "", "own": None}
        if local["gameId"] == joined["row"]["gameId"]:
            return {"imageIcon": local.get("imageIcon", ""), "own": None}
        return {"imageIcon": "", "own": {"gameId": local["gameId"], "title": local["title"],
                                          "imageIcon": local.get("imageIcon", "")}}

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

    def set_pads(self, count) -> dict:
        if type(count) is not int or not 0 <= count <= proto.PADS_MAX:
            return {"ok": False}
        if self._in_game() or count == self._pads:
            return {"ok": True}
        self._pads = count
        self._debug("this device has %s controllers", count)
        self._announce()
        return {"ok": True}

    def _seat_pads(self, index: int, seat) -> int:
        if seat is None:
            return 0
        return self._pads if index == 0 else seat["pads"]

    def _in_game(self) -> bool:
        current = self._session
        return current is not None and bool(current["started"]) and not current["exited"]

    def _toast_seat(self, name: str, title: str, line: str) -> None:
        force = not self._in_game()
        emit_notification(
            ntype="system",
            settings_store=self._settings_store,
            event_loop=self._loop,
            title_key=title,
            line_key=line,
            template_vars={"name": name},
            force_toast=force,
            dnd_exempt=True,
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
        held = self._held("library")
        if held is not None:
            return held[0]
        with self._library_lock:
            library = self._library_unlocked()
        self._hold("library", library)
        return library

    @contextlib.contextmanager
    def _one_pass(self):
        if getattr(self._pass, "memo", None) is not None:
            yield
            return
        self._pass.memo = {}
        try:
            yield
        finally:
            self._pass.memo = None

    def _held(self, name):
        memo = getattr(self._pass, "memo", None)
        return memo.get(name) if memo is not None else None

    def _hold(self, name, value):
        memo = getattr(self._pass, "memo", None)
        if memo is not None:
            memo[name] = (value,)

    def _library_unlocked(self):
        results_stamp = self._cheevo_check_store.results_fingerprint()
        picked_stamp = self._cheevo_check_store.picked_fingerprint()
        if results_stamp is None and picked_stamp is None:
            return None
        shortcuts = steam_shortcuts.current(self._user_home)
        by_rom = shortcuts.by_rom
        held = self.restore_record()["record"]
        if self._picked_cache[0] != picked_stamp:
            self._picked_cache = (picked_stamp, self._cheevo_check_store.load_picked() if picked_stamp is not None else {})
        picked = self._picked_cache[1]
        unchanged = {key: self._picked_unchanged(row) for key, row in picked.items()}
        mounted = hashlib.sha1(shortcuts.mounts).hexdigest()
        if steam_shortcuts.mounts() != shortcuts.mounts:
            steam_shortcuts.rebuild_soon(self._user_home)
        stamp = (results_stamp, picked_stamp, tuple(unchanged.items()), shortcuts.generation,
                 held and (held["appid"], held["original"]), mounted,
                 tuple(os.path.isfile(path) for path in self._picked_watch))
        if self._library_cache[0] == stamp:
            return self._library_cache[1]
        results = self._cheevo_check_store.load_results() if results_stamp is not None else None
        if results is None and not picked:
            return None
        results = results or {}
        self._dolphin_skipped = bool(results.get("skippedDolphin"))
        if self._scanned_real[0] != (results_stamp, mounted):
            self._scanned_real = ((results_stamp, mounted), {})
        if self._picked_real[0] != (picked_stamp, mounted):
            self._picked_real = ((picked_stamp, mounted), {})
        scanned_real = self._scanned_real[1]
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
                real = scanned_real.get(path)
                if real is None:
                    real = scanned_real[path] = os.path.realpath(path)
                found = []
                for shortcut in by_rom.get(real) or by_rom.get(path) or []:
                    if held is not None and shortcut["appid"] == held["appid"]:
                        shortcut = {**shortcut, "launchOptions": held["original"]}
                        if not {real, path} & set(steam_shortcuts.rom_candidates(shortcut["exe"], held["original"] or None)):
                            continue
                    found.append(shortcut)
                entry["paths"].append({
                    "path": path,
                    "real": real,
                    "hash": hashes.get(path, ""),
                    "shortcut": found[0] if found else None,
                    "shortcuts": found,
                })
        watched = []
        for key, row in picked.items():
            game_id = int(key)
            scanned = library.get(game_id)
            if scanned is not None:
                watched.extend(entry["path"] for entry in scanned["paths"])
                if unchanged[key] and not any(os.path.isfile(entry["path"]) for entry in scanned["paths"]):
                    scanned["paths"].append(self._picked_path(row, by_rom, held))
                continue
            system = by_console_id(row["systemId"])
            entry = {
                "gameId": game_id,
                "title": clean_title(row["title"]) or str(game_id),
                "systemId": row["systemId"],
                "system": system.name if system is not None else "",
                "imageIcon": row["imageIcon"],
                "paths": [],
                "picked": True,
                "changed": not unchanged[key],
            }
            library[game_id] = entry
            if entry["changed"]:
                continue
            entry["paths"].append(self._picked_path(row, by_rom, held))
        self._picked_watch = tuple(watched)
        self._library_cache = (stamp[:-1] + (tuple(os.path.isfile(path) for path in watched),), library)
        return library

    def _picked_path(self, row: dict, by_rom: dict, held) -> dict:
        path = row["path"]
        known = self._picked_real[1]
        real = known.get(path)
        if real is None:
            real = known[path] = os.path.realpath(path)
        found = [shortcut for shortcut in by_rom.get(real) or by_rom.get(path) or []
                 if held is None or shortcut["appid"] != held["appid"]]
        return {"path": path, "real": real, "hash": row["raHash"], "shortcut": found[0] if found else None,
                "shortcuts": found}

    def pick_game_file(self, game_id: int, path: str, game: dict, hashes: list) -> dict:
        self._dolphin_picks.pop(game_id, None)
        try:
            before = os.stat(path)
        except OSError:
            return {"ok": False, "error": "unreadable"}
        system_id = to_int(game.get("ConsoleID"), 0)
        if not stat.S_ISREG(before.st_mode) or system_id <= 0 or self._cheevo_check is None:
            return {"ok": False, "error": "unreadable"}
        digest = (self._cheevo_check.hash_rom_for_room(path, system_id) or "").lower()
        if not digest and system_id in session.DOLPHIN_SYSTEMS and Path(path).suffix.lower() not in RAW_DISC_EXTENSIONS \
                and self._flatpak_installed(session.DOLPHIN_FLATPAK) is False:
            self._dolphin_picks[game_id] = path
            return {"ok": False, "error": "needs_dolphin"}
        if not digest:
            return {"ok": False, "error": "unreadable"}
        match = next((row for row in hashes if str(row.get("md5") or "").lower() == digest), None)
        title = clean_title(str(game.get("Title") or "")) or str(game_id)
        if match is None:
            return {"ok": False, "error": "not_this_game", "title": title}
        try:
            after = os.stat(path)
        except OSError:
            return {"ok": False, "error": "unreadable"}
        if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
            return {"ok": False, "error": "unreadable"}
        label = str(match.get("name") or "")
        saved = self._cheevo_check_store.save_picked(game_id, {
            "path": path, "raHash": digest, "label": label, "systemId": system_id, "title": title,
            "imageIcon": str(game.get("ImageIcon") or ""), "size": after.st_size, "mtimeNs": after.st_mtime_ns,
        })
        if not saved:
            return {"ok": False, "error": "unreadable"}
        decky.logger.info("multiplayer: picked a file for game %d (%s)", game_id, label or "no label")
        return {"ok": True, "title": title, "label": label}

    def forget_picked_game(self, game_id: int) -> dict:
        held = self._dolphin_picks.pop(game_id, None) is not None
        return {"ok": self._cheevo_check_store.forget_picked(game_id) or held}

    def pick_start_folder(self) -> str:
        results = self._cheevo_check_store.load_results() if self._cheevo_check_store.results_fingerprint() else None
        previous = str((results or {}).get("root") or "")
        if previous.startswith("/") and os.path.isdir(previous):
            return previous
        return str(catalog.roms_folder(self._user_home) or self._user_home)

    def _picked_unchanged(self, row: dict) -> bool:
        try:
            st = os.stat(row["path"])
        except OSError:
            return False
        return stat.S_ISREG(st.st_mode) and st.st_size == row["size"] and st.st_mtime_ns == row["mtimeNs"]

    def _hash_of(self, entry: dict, system_id: int) -> str:
        if entry["hash"]:
            return entry["hash"]
        try:
            st = os.stat(entry["real"])
        except OSError:
            return ""
        key = (entry["real"], st.st_mtime_ns, st.st_size)
        if key in self._hash_memo:
            return self._hash_memo[key]
        if self._failed_recently(key):
            return ""
        with self._hash_lock:
            reading = self._hash_reads.get(key)
            mine = reading is None
            if mine:
                reading = self._hash_reads[key] = threading.Event()
        if not mine:
            reading.wait(HASH_WAIT_SECONDS)
            return self._hash_memo.get(key, "")
        try:
            found = ""
            if self._cheevo_check is not None:
                found = self._cheevo_check.hash_rom_for_room(entry["real"], system_id)
            if found:
                self._hash_memo[key] = found
            else:
                self._hash_failed[key] = (self._emulators.changed if self._emulators is not None else 0, time.monotonic())
            return found
        finally:
            with self._hash_lock:
                self._hash_reads.pop(key, None)
            reading.set()

    def _failed_recently(self, key: tuple) -> bool:
        failed = self._hash_failed.get(key)
        changed = self._emulators.changed if self._emulators is not None else 0
        return failed is not None and failed[0] == changed and time.monotonic() - failed[1] < HASH_RETRY_SECONDS

    def _read_ahead(self, local: dict, system_id: int) -> None:
        if local["hash"] or system_id not in session.DOLPHIN_SYSTEMS or self._cheevo_check is None \
                or self._overlay() is not None:
            return
        try:
            st = os.stat(local["real"])
        except OSError:
            return
        key = (local["real"], st.st_mtime_ns, st.st_size)
        if key in self._hash_memo or key in self._hash_reads or self._failed_recently(key) \
                or self._hash_needs_dolphin(local, system_id) or self._cheevo_check.cached_room_hash(local["real"], system_id):
            return
        entry = {"hash": "", "real": local["real"]}
        threading.Thread(target=self._hash_of, args=(entry, system_id), name="room-hash", daemon=True).start()

    def _hash_needs_dolphin(self, entry: dict, system_id: int) -> bool:
        if entry["hash"] or system_id not in session.DOLPHIN_SYSTEMS or self._cheevo_check is None:
            return False
        if Path(entry["real"]).suffix.lower() in RAW_DISC_EXTENSIONS:
            return False
        try:
            st = os.stat(entry["real"])
        except OSError:
            return False
        if self._hash_memo.get((entry["real"], st.st_mtime_ns, st.st_size)):
            return False
        if self._cheevo_check.cached_room_hash(entry["real"], system_id):
            return False
        return self._flatpak_installed(session.DOLPHIN_FLATPAK) is False

    def _crc_of(self, path: str) -> str:
        try:
            st = os.stat(path)
        except OSError:
            return ""
        if st.st_size > CRC_MAX_BYTES and not path.lower().endswith(".zip"):
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
        overlay = self._overlay()
        if overlay is not None and Path(path).name.removesuffix("_libretro.so") in overlay.cores:
            return True
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
        overlay = self._overlay()
        if overlay is not None and app in overlay.versions:
            return overlay.versions[app]
        return self._flatpak_listing()[1].get(app, "")

    def _flatpak_installed(self, app: str):
        overlay = self._overlay()
        if overlay is not None and app in overlay.flatpaks:
            return True
        listed, versions, read_at = self._flatpak_listing()
        if listed and app not in versions and time.monotonic() - read_at > FLATPAK_RECHECK_SECONDS:
            listed, versions, read_at = self._flatpak_listing(fresh=True)
        return app in versions if listed else None

    def _flatpak_listing(self, fresh: bool = False) -> tuple:
        changed = self._emulators.changed if self._emulators is not None else 0
        found = self._versions
        if fresh or found is None or found[2] != changed:
            if found is not None:
                self._permissions = {}
            versions = {}
            out = self._flatpak("list", "--app", "--columns=application,version")
            for line in (out or "").splitlines():
                parts = line.split("\t")
                if len(parts) >= 2:
                    versions[parts[0].strip()] = parts[1].strip()
            found = (out is not None, versions, changed, time.monotonic())
            self._versions = found
        return found[0], found[1], found[3]

    def _flatpak_reads_home(self, app: str) -> bool:
        overlay = self._overlay()
        if overlay is not None and app in overlay.flatpaks:
            return True
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

    def _retroarch(self):
        overlay = self._overlay()
        if overlay is not None and overlay.cores:
            listed = self._emulators.listed_core_info if self._emulators is not None else None
            return _RetroArchAfter(self._user_home, overlay.cores, listed)
        return session.retroarch(self._user_home)

    def _compatible(self, ra, mode: str, system_id: int) -> list:
        cores = []
        for core in ra.installed_cores():
            if not ra.runs_system(core, system_id):
                continue
            if mode == "couch" and not ra.can_couch(core):
                continue
            if mode == "couch" and core in proto.NETPACKET_CORES:
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

    def _couch_override(self, ra, local: dict, compatible: list, usual: str) -> str:
        system_id, shortcut_core = local["systemId"], local["shortcutCore"]
        table = session.COUCH_RECOMMENDED.get(system_id, "")
        if not table or table == session.COUCH_CORES.get(system_id) or (ra.installed(table) and table not in compatible):
            return ""
        if ra.info(table) is not None and not ra.runs_system(table, system_id):
            return ""
        if not ra.installed(table) and (self._emulators is None or not self._emulators.core_listed(table)):
            return ""
        if local["fallback"]:
            return table if usual == table else ""
        if not session.shares_saves(table, shortcut_core, system_id):
            return ""
        rom = Path(local["path"])
        if ra.save_paths(table, rom) != ra.save_paths(shortcut_core, rom) and not self._owner_save_ok(ra, local, table):
            return ""
        return table

    def _could_couch(self, ra, core: str, system_id: int) -> bool:
        if not core or ra.info(core) is None:
            return False
        return ra.runs_system(core, system_id) and ra.can_couch(core) and core not in proto.NETPACKET_CORES

    def _owner_save_ok(self, ra, local: dict, core: str) -> bool:
        if self._round_saves is None or not self._round_saves.takes(core, local["systemId"]) \
                or self._retroarch_saves_netplay() or not local.get("opensRom"):
            return False
        found = ra.save_settings(core, Path(local["path"]))
        return not found["overrideFolder"] and not found["overrideContentDir"]

    def _default_core(self, ra, compatible: list, shortcut_core: str, room_core: str) -> str:
        if room_core and ra.installed(room_core):
            return room_core
        if shortcut_core in compatible:
            return shortcut_core
        four_seats = [core for core in compatible if core in session.MULTITAP]
        if four_seats:
            return four_seats[0]
        return compatible[0] if compatible else ""

    def my_games(self) -> list | None:
        library = self._library()
        if library is None:
            return None
        return [
            {
                "gameId": entry["gameId"],
                "title": entry["title"],
                "systemId": entry["systemId"],
                "system": entry["system"],
                "imageIcon": entry["imageIcon"],
            }
            for entry in library.values()
        ]

    def installed_cores(self) -> list:
        ra = self._retroarch()
        return ra.installed_cores() if ra.found else []

    @_in_one_pass
    def games(self) -> dict:
        ra = self._retroarch()
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
            shortcut = self._pick_shortcut(linked["shortcuts"], "couch", system_id) if linked else None
            if shortcut is not None:
                detected = session.detect(shortcut["exe"], shortcut["launchOptions"])
                emulator = detected["emulator"] if detected else "retroarch"
                path, launchable = linked, True
            elif not fallback_on:
                emulator, path, launchable = "retroarch", None, False
            else:
                emulator = self._fallback_kinds("couch", system_id)[0]
                path = next((p for p in entry["paths"] if os.path.isfile(p["path"])), None)
                kinds = set(self._play_kinds(system_id) + self._fallback_kinds("couch", system_id))
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
                "appid": self._pick_shortcut(linked["shortcuts"], "play", system_id)["appid"] if linked else 0,
                "launchable": launchable,
                "canLink": can_link,
                "canCouch": can_couch,
            })
        games.sort(key=lambda row: row["title"].lower())
        return {"ok": True, "scanned": True, "games": games, "installedCores": installed}

    def _can_couch(self, ra, by_system: dict, system_id: int, emulator: str) -> bool:
        if system_id == session.N64_SYSTEM:
            return self._has_emulator_shortcut(by_system, "rmg")
        if emulator == "dolphin":
            return system_id in session.DOLPHIN_SYSTEMS
        if emulator == "duckstation":
            if not self._has_emulator_shortcut(by_system, "retroarch"):
                return False
            system_id = session.PS1_SYSTEM
        elif emulator != "retroarch" or system_id == session.DS_SYSTEM:
            return False
        if not ra.found:
            return False
        if system_id not in by_system:
            by_system[system_id] = bool(self._compatible(ra, "couch", system_id))
        return by_system[system_id]

    def _has_emulator_shortcut(self, by_system: dict, kind: str) -> bool:
        if kind not in by_system:
            by_system[kind] = self._emulator_shortcut(kind) is not None
        return by_system[kind]

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

    def _launch_local(self, mode: str, game_id: int, core: str, room):
        self._fresh_shortcuts()
        found = self._local(mode, game_id, core, room)
        if found[0] is not None and self._rom_moved(found[0]["gameId"], found[0].get("path")):
            found = self._local(mode, game_id, core, room)
        return found

    def _fresh_shortcuts(self) -> None:
        steam_shortcuts.current(self._user_home, fresh=True)

    def _rom_moved(self, game_id: int, path) -> bool:
        game = (self._library() or {}).get(game_id)
        entry = next((row for row in game["paths"] if row["path"] == path), None) if game is not None and path else None
        if entry is None or os.path.exists(entry["real"]) or not os.path.exists(path):
            return False
        decky.logger.info("multiplayer: %s isn't where it was last found, matching it again", path)
        self._scanned_real[1].pop(path, None)
        self._picked_real[1].pop(path, None)
        steam_shortcuts.forget_matches([entry["real"]], self._user_home)
        with self._library_lock:
            self._library_cache = (None, None)
        return True

    def _local(self, mode: str, game_id: int, core: str, room):
        local, gate, detail = self._route(mode, game_id, core, room)
        if local is not None and local["fallback"] and not local["appid"]:
            return None, "no_emulator_shortcut", {"emulator": FALLBACK_NAMES[local["emulator"]]}
        vehicle = self._emulator_by_appid(local["appid"]) if local is not None else None
        gone = self._gone(vehicle) if vehicle is not None else None
        if gone is not None:
            return None, "emulator_missing", gone
        return local, gate, detail

    def _gone(self, shortcut: dict):
        kind = session.emulator_kind(shortcut["exe"], shortcut["launchOptions"])
        if kind not in catalog.BY_KIND:
            return None
        try:
            tokens = shlex.split(f'{shortcut["exe"]} {shortcut["launchOptions"]}', posix=True)
        except ValueError:
            return None
        script = next((token for token in tokens[:2] if token.endswith(".sh")), None)
        if script is not None:
            path = self._user_home / script[1:].lstrip("/") if script.startswith("~") else Path(script)
            if path.is_absolute() and not path.exists():
                return {"emulator": FALLBACK_NAMES[kind], "kind": kind, "via": "", "path": str(path)}
            return None
        via, image = catalog.shortcut_install(kind, shortcut["exe"], shortcut["launchOptions"], self._user_home)
        detail = {"emulator": FALLBACK_NAMES[kind], "kind": kind, "via": via, "path": image}
        if via == "flatpak" and self._flatpak_installed(catalog.BY_KIND[kind]["flatpak"]) is False:
            return detail
        overlay = self._overlay()
        if via == "appimage" and not os.path.isfile(image) and (overlay is None or image not in overlay.files):
            return detail
        return None

    def _route(self, mode: str, game_id: int, core: str, room, use_saved: bool = True):
        if mode not in proto.MODES:
            return None, "unsupported_emulator", {}
        if mode == "stream":
            return self._stream_local(game_id, room)
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
        if game.get("changed"):
            return None, "rom_missing", {"picked": "1"}
        system_id = game["systemId"]
        if mode == "link" and system_id not in session.LINK_CORES:
            return None, "link_system", {}
        if mode == "link" and system_id == session.GAMECUBE_SYSTEM and game_id not in session.GC_LAN_GAMES:
            return None, "link_gc_no_lan", {}
        if mode == "couch" and system_id == session.DS_SYSTEM:
            return None, "ds_no_couch", {}
        on_disk = [entry for entry in game["paths"] if os.path.isfile(entry["path"])]
        if not on_disk:
            return None, "rom_missing", {}
        saved = self._game_options.get(game_id)["pick"] if use_saved and room is None and mode == "couch" else None
        own_pick, vehicle, saved_core = None, None, ""
        if saved is not None:
            saved_core = saved["core"]
            for entry in game["paths"]:
                own_pick = own_pick or next((row for row in entry["shortcuts"] if row["appid"] == saved["appid"]), None)
            if own_pick is None and saved["appid"]:
                vehicle = self._emulator_by_appid(saved["appid"])
        candidates = [{**entry, "shortcut": own_pick if own_pick in entry["shortcuts"]
                       else self._pick_shortcut(entry["shortcuts"], mode, system_id)}
                      for entry in on_disk if entry["shortcut"]]
        fallback = None
        if not candidates:
            if not self._fallback_on():
                return None, "no_shortcut", {}
            fallback = self._fallback(mode, system_id)
            candidates = [{**entry, "shortcut": fallback} for entry in on_disk]

        pick = candidates[0]
        if room is not None and mode == "couch":
            if not room["hash"]:
                return None, "host_unchecked", {}
            pick = next((entry for entry in candidates if self._hash_of(entry, system_id) == room["hash"]), None)
            if pick is None:
                if any(self._hash_needs_dolphin(entry, system_id) for entry in candidates):
                    return None, "needs_dolphin", {}
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
            "imageIcon": game.get("imageIcon", ""),
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
            "picked": own_pick is not None and pick["shortcut"] is own_pick,
        }
        if n64_couch:
            return self._rmg_couch_local(local, vehicle)
        emulator = detected["emulator"]
        if emulator == "pcsx2":
            return None, "pcsx2_no_multiplayer", {}
        if emulator == "melonds":
            return None, "melonds_standalone", {}
        if emulator == "duckstation" and mode == "couch":
            return self._duckstation_couch_local(local, core, room, saved_core)
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
            return self._dolphin_local(mode, local, pick, vehicle)
        if emulator != "retroarch":
            return None, "unsupported_emulator", {}

        ra = self._retroarch()
        if not ra.found:
            if not local["fallback"]:
                return None, "unsupported_emulator", {}
            return self._no_retroarch(pick["shortcut"])
        local["ra"] = ra
        local["shortcutCoreName"] = ra.core_name(detected["core"])
        compatible = self._compatible(ra, mode, system_id)
        local["choices"] = [{"core": name, "name": ra.core_name(name)} for name in compatible]
        room_core = room["core"] if room is not None else ""
        usual = detected["core"]
        if local["fallback"]:
            table = session.COUCH_RECOMMENDED.get(system_id, "") if mode == "couch" \
                else session.COUCH_CORES.get(system_id, "")
            usual = self._core_with_save(ra, compatible, Path(pick["path"]), table)
        local["opensRom"] = local["fallback"] or str(pick["path"]) in pick["shortcut"]["launchOptions"]
        override = self._couch_override(ra, local, compatible, usual) \
            if mode == "couch" and room is None and not saved_core and own_pick is None else ""
        recommended = override if not core else ""
        chosen = core or recommended or self._default_core(ra, compatible, usual, room_core)
        if not core and mode == "couch" and saved_core in compatible:
            chosen = saved_core
        missing = ""
        if mode == "couch" and room is None and not core:
            shortcut = usual if not local["fallback"] and self._could_couch(ra, usual, system_id) else ""
            wanted = saved_core or recommended or shortcut
            if wanted and not ra.installed(wanted):
                missing = chosen = wanted
        if mode == "couch" and saved_core and chosen == saved_core:
            local["picked"] = True
        local["recommended"] = bool(override) and chosen == override
        local["missingCore"] = bool(missing)

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
        elif chosen not in compatible and not missing:
            if room is not None and room_core and not ra.installed(room_core):
                return None, "host_core_missing", {"core": room["coreName"] or room_core, "coreId": room_core}
            works = [ra.core_name(name) for name in compatible]
            if not works:
                return None, "no_couch_core", {}
            return None, "core_cant_couch", {"core": ra.core_name(chosen) if chosen else "", "works": ", ".join(works)}
        if not ra.installed(chosen) and not missing:
            return None, "host_core_missing", {"core": ra.core_name(chosen), "coreId": chosen}

        local.update(core=chosen, coreName=ra.core_name(chosen),
                     emuVersion=f"{self._flatpak_version(session.RETROARCH_FLATPAK)}|{ra.version(chosen)}")
        if mode == "couch":
            local["coreBuild"] = self._core_build_of(ra.core_path(chosen))
        return local, None, {}

    def _no_retroarch(self, shortcut: dict):
        if not shortcut["appid"]:
            return None, "no_emulator_shortcut", {"emulator": FALLBACK_NAMES["retroarch"]}
        if self._flatpak_installed(session.RETROARCH_FLATPAK):
            return None, "retroarch_first_run", {}
        gone = self._gone(shortcut)
        if gone is not None:
            return None, "emulator_missing", gone
        return None, "no_emulator_shortcut", {"emulator": FALLBACK_NAMES["retroarch"]}

    def _dolphin_local(self, mode: str, local: dict, pick: dict, vehicle=None):
        if mode == "couch":
            return self._dolphin_netplay_local(local, pick, vehicle)
        if local["gameId"] not in session.GC_LAN_GAMES:
            return None, "link_gc_no_lan", {}
        install = session.dolphin_install(pick["shortcut"]["exe"], pick["shortcut"]["launchOptions"], self._user_home)
        disc = rom_headers.disc_game_id(pick["real"])
        if disc and session.dolphin_sets_adapter(session.dolphin_game_settings(self._user_home, install), disc):
            return None, "dolphin_game_setting", {}
        local.update(core=session.DOLPHIN_STANDALONE, coreName="Dolphin", shortcutCoreName="Dolphin",
                     install=install, gameCode=disc[:4], automap=self._automap(pick["shortcut"]),
                     emuVersion=self._flatpak_version(session.DOLPHIN_FLATPAK) if install == "flatpak" else "")
        return local, None, {}

    def _dolphin_netplay_local(self, local: dict, pick: dict, vehicle=None):
        if local["systemId"] not in session.DOLPHIN_SYSTEMS:
            return None, "unsupported_emulator", {}
        if vehicle is not None and session.emulator_kind(vehicle["exe"], vehicle["launchOptions"]) == "dolphin":
            emulator = vehicle
            install = session.dolphin_install(vehicle["exe"], vehicle["launchOptions"], self._user_home)
            local["picked"] = True
        else:
            exe, options = pick["shortcut"]["exe"], pick["shortcut"]["launchOptions"]
            install = session.dolphin_install(exe, options, self._user_home)
            emulator = self._emulator_shortcut("dolphin", install)
        local["vehicles"] = self._emulator_count("dolphin")
        if emulator is None:
            return None, "no_dolphin_emulator_shortcut", {"install": install}
        folder = session.dolphin_missing_folder(self._user_home, install, pick["real"])
        overlay = self._overlay()
        if folder and not (overlay is not None and folder in overlay.dolphin_folders):
            return None, "dolphin_game_list", {"folder": folder, "install": install}
        disc = rom_headers.disc_game_id(pick["real"])
        local.update(core=session.DOLPHIN_STANDALONE, coreName="Dolphin", shortcutCoreName="Dolphin",
                     install=install, gameCode=disc[:4], gameAppid=local["appid"], appid=emulator["appid"],
                     automap=self._automap(emulator), emuVersion=self._dolphin_version(install, emulator))
        return local, None, {}

    def _rmg_couch_local(self, local: dict, vehicle=None):
        emulator = self._emulator_shortcut("rmg")
        if vehicle is not None and session.emulator_kind(vehicle["exe"], vehicle["launchOptions"]) == "rmg":
            emulator = vehicle
            local["picked"] = True
        local["vehicles"] = self._emulator_count("rmg")
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

    def _duckstation_couch_local(self, local: dict, core: str, room, saved_core: str = ""):
        ra = self._retroarch()
        if not ra.found:
            return None, "duckstation_no_multiplayer", {}
        compatible = self._compatible(ra, "couch", session.PS1_SYSTEM)
        emulator = self._emulator_shortcut("retroarch")
        if not compatible or emulator is None:
            return None, "duckstation_no_multiplayer", {}
        room_core = room["core"] if room is not None else ""
        if core in compatible:
            chosen = core
        elif saved_core in compatible and not room_core:
            chosen = saved_core
        elif room_core:
            if not ra.installed(room_core) or room_core not in compatible:
                return None, "host_core_missing", {"core": room["coreName"] or room_core, "coreId": room_core}
            chosen = room_core
        else:
            chosen = session.BEETLE_PSX_HW if session.BEETLE_PSX_HW in compatible else compatible[0]
        if saved_core and chosen == saved_core and room is None:
            local["picked"] = True
        local.update(
            emulator="retroarch", ra=ra, core=chosen, coreName=ra.core_name(chosen), shortcutCore="",
            shortcutCoreName="DuckStation", gameAppid=local["appid"], appid=emulator["appid"], duckstation=True,
            choices=[{"core": name, "name": ra.core_name(name)} for name in compatible],
            emuVersion=f"{self._flatpak_version(session.RETROARCH_FLATPAK)}|{ra.version(chosen)}",
            coreBuild=self._core_build_of(ra.core_path(chosen)),
        )
        return local, None, {}

    def _fallback_on(self) -> bool:
        overlay = self._overlay()
        if overlay is not None and overlay.mp_fallback is not None:
            return overlay.mp_fallback
        return bool(self._pass_config().get("mpShortcutFallback", True))

    def _pass_config(self) -> dict:
        held = self._held("config")
        if held is not None:
            return held[0]
        cfg = self._settings_store.load_config()
        self._hold("config", cfg)
        return cfg

    def _stream_shaders_off(self) -> bool:
        return bool(self._settings_store.load_config().get("mpStreamShadersOff", True))

    def _play_fallback_on(self) -> bool:
        overlay = self._overlay()
        if overlay is not None and overlay.play_fallback is not None:
            return overlay.play_fallback
        return bool(self._pass_config().get("playShortcutFallback", True))

    def _play_route(self, game_id: int, fallback_on=None, choice=None, session_pick: bool = False):
        library = self._library()
        if library is None:
            return None, "no_scan", {}
        game = library.get(game_id)
        if game is None:
            return None, "not_in_results", {}
        if game.get("changed"):
            return None, "rom_missing", {"picked": "1"}
        on_disk = [entry for entry in game["paths"] if os.path.isfile(entry["path"])]
        if not on_disk:
            return None, "rom_missing", {}
        picked = "chosen"
        if choice is None and session_pick and game_id in self._session_picks:
            choice, picked = self._session_picks[game_id], "session"
        if choice is None:
            choice, picked = self._picks.get(game_id, "play"), "saved"
        pick = clean_pick(choice) if choice else None
        if pick is not None:
            route = self._choice_route(game, pick)
            if route is not None:
                route["picked"] = picked
                return route, None, {}
        linked = next((entry for entry in on_disk if entry["shortcut"]), None)
        if linked is not None:
            own = self._pick_shortcut(linked["shortcuts"], "play", game["systemId"])
            return {"appid": own["appid"], "fallback": False, "shortcut": own, "rom": linked["path"]}, None, {}
        if fallback_on is None:
            fallback_on = self._play_fallback_on()
        if not fallback_on:
            return None, "no_shortcut", {}
        rom = on_disk[0]["path"]
        system_id = game["systemId"]
        kinds = self._play_kinds(system_id)
        coreless, first_run, missing = False, False, None
        for kind in kinds:
            shortcut = self._emulator_shortcut(kind, None)
            if shortcut is None:
                continue
            gone = self._gone(shortcut)
            if gone is not None:
                missing = missing or gone
                continue
            route = {"appid": shortcut["appid"], "fallback": True, "kind": kind, "rom": rom, "corePath": ""}
            if kind == "retroarch":
                ra = self._retroarch()
                if not ra.found:
                    first_run = True
                    continue
                core = self._play_core(ra, system_id, Path(rom))
                if not core:
                    coreless = True
                    continue
                route["corePath"] = str(ra.core_path(core))
                route["core"] = core
            return route, None, {}
        if missing is not None:
            return None, "emulator_missing", missing
        if first_run:
            return None, "retroarch_first_run", {}
        if coreless:
            return None, "no_play_core", {}
        return None, "no_emulator_shortcut", {"emulator": FALLBACK_NAMES[kinds[0]]}

    def _choice_route(self, game: dict, pick: dict):
        system_id = game["systemId"]
        linked = next((entry for entry in game["paths"] if entry["shortcuts"]), None)
        own = next((row for row in linked["shortcuts"] if row["appid"] == pick["appid"]), None) \
            if linked is not None and pick["appid"] else None
        core = pick["core"]
        ra = self._retroarch() if core else None
        if core and (not ra.found or not ra.installed(core) or not ra.runs_system(core, system_id)):
            return None
        if own is not None:
            route = {"appid": own["appid"], "fallback": False, "shortcut": own, "rom": linked["path"]}
            detected = session.detect(own["exe"], own["launchOptions"])
            if core and detected and detected["emulator"] == "retroarch" and core != detected["core"]:
                route.update(kind="retroarch", core=core, corePath=str(ra.core_path(core)))
            return route
        if pick["appid"]:
            shortcut = self._emulator_by_appid(pick["appid"])
            kind = session.emulator_kind(shortcut["exe"], shortcut["launchOptions"]) if shortcut else ""
        else:
            kind = pick["kind"]
            shortcut = self._emulator_shortcut(kind, None)
        if shortcut is None or (kind == "retroarch") != bool(core):
            return None
        rom = next((entry["path"] for entry in game["paths"] if os.path.isfile(entry["path"])), None)
        if rom is None:
            return None
        route = {"appid": shortcut["appid"], "fallback": True, "kind": kind, "rom": rom, "corePath": ""}
        if core:
            route.update(core=core, corePath=str(ra.core_path(core)))
        return route

    def _route_name(self, route: dict, ra) -> str:
        if route.get("core"):
            return ra.core_name(route["core"]) if ra.found else route["core"]
        if route["fallback"]:
            return STREAM_EMULATOR_NAMES.get(route["kind"], route["kind"])
        return self._shortcut_entry(route["shortcut"], ra)["detail"]

    def _shortcut_entry(self, shortcut: dict, ra) -> dict:
        detected = session.detect(shortcut["exe"], shortcut["launchOptions"])
        kind = detected["emulator"] if detected else session.emulator_kind(shortcut["exe"], shortcut["launchOptions"])
        core = detected["core"] if detected and kind == "retroarch" else ""
        if core:
            detail = f"RetroArch · {ra.core_name(core) if ra.found else core}"
        else:
            name = STREAM_EMULATOR_NAMES.get(kind, "")
            install = session.install_type(kind, shortcut["exe"], shortcut["launchOptions"], self._user_home) \
                if name else ""
            detail = f"{name} {INSTALL_NAMES[install]}" if install in INSTALL_NAMES else name or shortcut["name"]
        return {"appid": shortcut["appid"], "name": shortcut["name"], "kind": kind, "core": "", "detail": detail}

    def _standalone_entries(self, kinds) -> list:
        entries = []
        for shortcut in self._emulator_shortcuts():
            kind = session.emulator_kind(shortcut["exe"], shortcut["launchOptions"])
            if kind not in kinds or kind == "retroarch":
                continue
            install = session.install_type(kind, shortcut["exe"], shortcut["launchOptions"], self._user_home)
            name = STREAM_EMULATOR_NAMES.get(kind, kind)
            label = f"{name} ({INSTALL_NAMES[install]})" if install in INSTALL_NAMES \
                else shortcut["name"] or name
            entries.append({"appid": shortcut["appid"], "kind": kind, "core": "", "label": label, "install": install,
                            "noAchievements": kind in ("rmg", "melonds")})
        return entries

    def play_choices(self, game_id: int) -> dict:
        game = (self._library() or {}).get(game_id)
        if game is None:
            return {"ok": False, "error": ERROR_NO_GAME}
        system_id = game["systemId"]
        ra = self._retroarch()
        linked = next((entry for entry in game["paths"] if entry["shortcuts"]), None)
        own = linked["shortcuts"] if linked is not None else []
        default = self._pick_shortcut(own, "play", system_id) if own else None
        shortcuts = [{**self._shortcut_entry(row, ra), "default": row is default} for row in own]
        route, _gate, _detail = self._play_route(game_id, choice={})
        recommended = self._route_name(route, ra) if route is not None and not own else ""
        vehicle = next((row for row in own if self._shortcut_entry(row, ra)["kind"] == "retroarch"), None) \
            or self._emulator_shortcut("retroarch", None)
        cores, missing = [], []
        if vehicle is not None and ra.found:
            cores = [{"appid": vehicle["appid"], "kind": "retroarch", "core": core, "label": ra.core_name(core)}
                     for core in self._compatible(ra, "", system_id)]
            missing = self._missing_cores(system_id, False)
        saved = self._picks.get(game_id, "play")
        saved_missing = saved is not None and self._choice_route(game, saved) is None
        table = catalog.RECOMMENDED_CORES.get(system_id, "")
        standalones = self._standalone_entries(self._play_kinds(system_id))
        if route is not None:
            emulator, core = _route_emulator(route)
            shortcut = self._route_shortcut(route)
            if emulator == "retroarch" and core:
                if not own:
                    table = core
                cores = [row for row in cores if row["core"] != core]
                missing = [row for row in missing if row["core"] != core]
                if saved is not None and saved["kind"] == "retroarch" and saved["core"] == core:
                    saved = None
            elif emulator and shortcut is not None:
                install = session.install_type(emulator, shortcut["exe"], shortcut["launchOptions"], self._user_home)
                same = {row["appid"] for row in standalones if row["kind"] == emulator and row["install"] == install}
                standalones = [row for row in standalones if row["appid"] not in same]
                if saved is not None and saved["appid"] in same:
                    saved = None
        return {
            "ok": True,
            "shortcuts": shortcuts,
            "recommended": recommended,
            "cores": cores,
            "missing": missing,
            "recommendedCore": table if any(row["core"] == table for row in cores + missing) else "",
            "standalones": standalones,
            "saved": saved,
            "savedMissing": saved_missing,
            "session": self._session_picks.get(game_id),
            "clockSwitchSafe": self._clock_switch_safe(game, [row["core"] for row in cores]),
        }

    def couch_choices(self, game_id: int) -> dict:
        game = (self._library() or {}).get(game_id)
        if game is None:
            return {"ok": False, "error": ERROR_NO_GAME}
        system_id = game["systemId"]
        ra = self._retroarch()
        linked = next((entry for entry in game["paths"] if entry["shortcuts"]), None)
        own = [row for row in (linked["shortcuts"] if linked is not None else [])
               if self._shortcut_entry(row, ra)["kind"] in self._couch_kinds(system_id)]
        default = self._pick_shortcut(own, "couch", system_id) if own else None
        shortcuts = [{**self._shortcut_entry(row, ra), "default": row is default} for row in own]
        emulators = []
        if system_id in session.DOLPHIN_SYSTEMS or system_id == session.N64_SYSTEM:
            emulators = self._standalone_entries(("dolphin",) if system_id in session.DOLPHIN_SYSTEMS else ("rmg",))
        local, _gate, _detail = self._route("couch", game_id, "", None, use_saved=False)
        cores = local["choices"] if local is not None else []
        missing = [row for row in self._missing_cores(system_id, True) if row["core"] not in proto.NETPACKET_CORES] \
            if local is not None and local["emulator"] == "retroarch" else []
        recommended = session.COUCH_RECOMMENDED.get(system_id, "")
        return {
            "ok": True,
            "shortcuts": shortcuts,
            "emulators": emulators,
            "defaultCore": local["coreName"] if local is not None and local.get("coreName") else "",
            "cores": cores,
            "missing": missing,
            "recommendedCore": recommended if any(row["core"] == recommended for row in cores + missing) else "",
            "overrides": local is not None and bool(local.get("recommended")),
            "saved": self._game_options.get(game_id)["pick"],
            "clockSwitchSafe": self._clock_switch_safe(game, [row["core"] for row in cores]),
        }

    def _missing_cores(self, system_id: int, couch: bool) -> list:
        return self._emulators.missing_cores(system_id, couch) if self._emulators is not None else []

    def _clock_switch_safe(self, game: dict, cores: list) -> bool:
        if self._clock is None or game["systemId"] not in session.GB_SYSTEMS \
                or not all(core in cores for core in rtc_formats.SIZES):
            return False
        ra = self._retroarch()
        rom = next((Path(entry["path"]) for entry in game["paths"] if os.path.isfile(entry["path"])), None)
        return ra.found and rom is not None and any(ra.save_paths(core, rom)[1].is_file() for core in rtc_formats.SIZES)

    def save_play_pick(self, game_id: int, use: str, pick) -> dict:
        if use == "couch":
            return {"ok": self._game_options.set(game_id, {"pick": clean_pick(pick) if pick else None})}
        return {"ok": self._picks.set(game_id, use, clean_pick(pick) if pick else None)}

    def game_options(self, game_id: int) -> dict:
        saved = self._game_options.get(game_id)
        return {"ok": True, "options": {key: saved[key] for key in ROOM_OPTION_KEYS}}

    def set_game_options(self, game_id: int, changes: dict) -> dict:
        if self._room is not None or self._joined is not None:
            return {"ok": False, "error": ERROR_BUSY}
        wanted = {key: value for key, value in changes.items() if key in ROOM_OPTION_KEYS}
        return {"ok": self._game_options.set(game_id, wanted)}

    def forget_game_options(self, ulid) -> None:
        self._game_options.remove_account(ulid)

    def set_stream_pick(self, game_id: int, pick, remember: bool) -> dict:
        cleaned = clean_pick(pick) if pick else None
        if remember:
            self._session_picks.pop(game_id, None)
            return {"ok": self._picks.set(game_id, "play", cleaned)}
        self._session_picks[game_id] = cleaned or {}
        return {"ok": True}

    def _stream_local(self, game_id: int, room):
        if room is not None:
            return self._stream_guest_local(room)
        gated = self._stream_gates(None)
        if gated is not None:
            return None, gated[0], gated[1]
        library = self._library()
        if library is None:
            return None, "no_scan", {}
        game = library.get(game_id)
        if game is None:
            return None, "not_in_results", {}
        system_id = game["systemId"]
        route, gate, detail = self._play_route(game_id, self._fallback_on(), session_pick=True)
        if route is None:
            return None, gate, detail
        emulator, core = _route_emulator(route)
        rom = route["rom"]
        core_name = STREAM_EMULATOR_NAMES.get(emulator, "")
        if core:
            ra = self._retroarch()
            core_name = ra.core_name(core) if ra.found else core
        local = {
            "gameId": game_id,
            "title": game["title"],
            "imageIcon": game.get("imageIcon", ""),
            "systemId": system_id,
            "path": rom,
            "real": rom,
            "appid": route["appid"],
            "emulator": emulator,
            "core": core,
            "coreName": core_name,
            "shortcutCore": core,
            "shortcutCoreName": core_name,
            "choices": [],
            "hash": "",
            "coreBuild": "",
            "gameCode": "",
            "fallback": route["fallback"],
            "emuVersion": "",
            "route": route,
            "picked": bool(route.get("picked")),
            "install": self._route_install(route) if emulator == "dolphin" else "",
            "automap": emulator == "dolphin" and self._automap(self._route_shortcut(route)),
        }
        return local, None, {}

    def _stream_guest_local(self, room):
        record = self._stream_setup.status() if self._stream_setup is not None else None
        if record is None or not record["ready"]:
            return None, "stream_not_set_up", {}
        local = {
            "gameId": room["gameId"],
            "title": room["title"],
            "systemId": room["systemId"],
            "path": "",
            "real": "",
            "appid": record["appid"],
            "emulator": "moonlight",
            "core": "",
            "coreName": "",
            "shortcutCore": "",
            "shortcutCoreName": "",
            "choices": [],
            "hash": "",
            "coreBuild": "",
            "gameCode": "",
            "fallback": False,
            "emuVersion": "",
        }
        return local, None, {}

    def _stream_warnings(self, local: dict) -> list:
        home = self._user_home
        files = {
            "pcsx2": (home / ".config/PCSX2/inis/PCSX2.ini",
                      home / ".var/app/net.pcsx2.PCSX2/config/PCSX2/inis/PCSX2.ini"),
            "duckstation": (home / ".local/share/duckstation/settings.ini",
                            home / ".var/app/org.duckstation.DuckStation/config/duckstation/settings.ini"),
        }.get(local.get("emulator", ""))
        if files is None:
            return []
        found = next((path for path in files if path.is_file()), None)
        if found is None:
            return []
        pad = _ini_section(found, "Pad2")
        if pad.get("Type", "None") != "None" and any("SDL-1/" in value for value in pad.values()):
            return []
        return [{"code": "stream_player_two", "detail": {"emulator": STREAM_EMULATOR_NAMES[local["emulator"]]}}]

    def _stream_gates(self, room):
        if room is not None:
            return None
        if self._no_amd_debug or not has_amd_graphics():
            if not self._said_no_amd:
                self._said_no_amd = True
                decky.logger.info("stream: Stream Play hosting is off on this device, no AMD graphics found "
                                  "(%s, graphics drivers: %s)",
                                  "aarch64" if cheevo_check_tools.host_is_arm64() else "x86_64", graphics_drivers())
            return "stream_host_needs_amd", {}
        record = self._stream_setup.status() if self._stream_setup is not None else None
        overlay = self._overlay()
        if overlay is not None and overlay.streaming:
            record = {"ready": True, "busy": False}
        if record is None or not record["ready"] or record["busy"]:
            self._debug("stream: not set up (%s)", "no setup" if record is None
                        else "busy" if record["busy"] else "not ready")
            return "stream_not_set_up", {}
        if self._room is None and self._stream_host is not None and self._stream_host.foreign_sunshine():
            return "sunshine_running", {}
        return None

    def _play_core(self, ra, system_id: int, rom: Path) -> str:
        if not ra.found:
            return ""
        compatible = self._compatible(ra, "", system_id)
        core = self._core_with_save(ra, compatible, rom, session.COUCH_CORES.get(system_id, ""))
        if core in compatible:
            return core
        return compatible[0] if compatible else ""

    def shortcut_changes(self, kind: str) -> dict:
        if not self._play_fallback_on():
            return {"ok": True, "changes": []}
        library = self._library() or {}
        have = {session.emulator_kind(row["exe"], row["launchOptions"]) for row in self._emulator_shortcuts()}
        changes = []
        for system_id in sorted({game["systemId"] for game in library.values()}):
            kinds = self._play_kinds(system_id)
            if kind not in kinds:
                continue
            current = next((found for found in kinds if found in have), "")
            after = next(found for found in kinds if found in have or found == kind)
            if after != current:
                system = by_console_id(system_id)
                changes.append({"system": system.name if system is not None else str(system_id),
                                "current": STREAM_EMULATOR_NAMES.get(current, "")})
        return {"ok": True, "changes": changes}

    def play_info(self, game_id: int, choice=None) -> dict:
        route, gate, detail = self._play_route(game_id, choice=choice)
        backups = self._backups is not None and (
            self._backups.has_backups(game_id) or (route is not None and self._route_target(game_id, route) is not None))
        if route is None:
            fix = self._fix(gate, detail, "play", game_id, None)
            plan = self._plan_ahead("play", game_id, "", None, (gate, detail, fix), choice=choice)
            state = "setup" if plan["steps"] else _gate_state(gate, fix, self._emulators is not None and gate in PLANNED_GATES)
            return {"ok": True, "appid": 0, "launchable": False, "fallback": False, "gate": gate, "detail": detail,
                    "tools": self.desktop_tools(), "state": state, "plan": plan, "backups": backups,
                    "dolphinMappings": False}
        return {"ok": True, "appid": route["appid"], "launchable": True, "fallback": bool(_route_args(route)),
                "gate": None, "detail": {}, "tools": self.desktop_tools(), "kind": _route_kind(route), "state": "ready",
                "plan": {"outcome": "ready", "stages": [], "steps": [], "blocker": None}, "backups": backups,
                "dolphinMappings": self._mapping_target(game_id, route) is not None}

    def play_mapping_target(self, game_id: int, choice=None):
        route, _gate, _detail = self._play_route(game_id, choice=choice)
        return self._mapping_target(game_id, route) if route is not None else None

    def _mapping_target(self, game_id: int, route: dict):
        game = (self._library() or {}).get(game_id)
        if self._mappings is None or game is None:
            return None
        emulator, _core = _route_emulator(route)
        install = self._route_install(route) if emulator == "dolphin" else ""
        if not dolphin_game_mappings.takes_mappings(game["systemId"], emulator, install):
            return None
        return {"systemId": game["systemId"], "install": install,
                "automap": self._automap(self._route_shortcut(route))}

    def game_system(self, game_id: int) -> tuple:
        game = (self._library() or {}).get(game_id)
        if game is None:
            return 0, ""
        system = by_console_id(game["systemId"])
        return game["systemId"], system.name if system is not None else ""

    def check_play_clock(self, game_id: int, choice=None) -> None:
        route, _gate, _detail = self._play_route(game_id, choice=choice)
        if route is not None:
            self._check_launch_clock(game_id, route, "play")

    def fill_play_save(self, game_id: int, choice=None) -> None:
        route, _gate, _detail = self._play_route(game_id, choice=choice)
        if route is not None:
            self._fill_launch_save(game_id, route)

    def _fill_launch_save(self, game_id: int, route: dict) -> None:
        game = (self._library() or {}).get(game_id)
        emulator, core = _route_emulator(route)
        if game is None or emulator != "retroarch" or core not in session.SAVE_FILL:
            return
        ra = self._retroarch()
        if not ra.found:
            return
        rom = Path(route["rom"])
        owner, folder = self._launch_save(game, route, ra)
        path = folder / f"{rom.stem}.srm" if folder is not None else ra.save_paths(owner, rom)[0]
        self._fill_save(path, core, game["systemId"], game["title"])

    def _fill_save(self, path: Path, core: str, system_id: int, title: str) -> None:
        fill = session.SAVE_FILL.get(core, 0)
        if not fill or not session.shares_saves("genesis_plus_gx", core, system_id):
            return
        data = _read_quietly(path)
        if not data or len(data) >= fill or _power_of_two(len(data)) or data[-1] == 0xFF:
            return
        try:
            _write_real(path, data + b"\xff" * (fill - len(data)))
        except OSError as e:
            decky.logger.warning("saves: couldn't fill out %s's save for %s (%s)", title, core, type(e).__name__)
            return
        decky.logger.info("saves: filled %s's save out from %s bytes for PicoDrive", title, len(data))

    def _check_launch_clock(self, game_id: int, route: dict, trigger: str) -> bool:
        game = (self._library() or {}).get(game_id)
        emulator, core = _route_emulator(route)
        if self._clock is None or game is None or emulator != "retroarch" \
                or game["systemId"] not in session.GB_SYSTEMS or core not in rtc_formats.SIZES:
            return False
        ra = self._retroarch()
        if not ra.found:
            return False
        rom = Path(route["rom"])
        owner, folder = self._launch_save(game, route, ra)
        path = folder / f"{rom.stem}.rtc" if folder is not None else ra.save_paths(owner, rom)[1]
        if owner == core and route["fallback"]:
            owner = _clock_format(_read_quietly(path)) or core
        if owner not in rtc_formats.SIZES or (folder is None and ra.save_paths(owner, rom)[1] != path):
            owner = core
        self._clock.check(path, core, game["title"], self._clock_backup(self._route_target(game_id, route), trigger))
        if owner == core:
            return False
        self._clock.hold(path, core, owner, game["title"])
        return True

    def _launch_save(self, game: dict, route: dict, ra) -> tuple:
        emulator, core = _route_emulator(route)
        if emulator != "retroarch" or not core or not ra.found:
            return core, None
        system_id, rom = game["systemId"], Path(route["rom"])
        if route["fallback"]:
            partner = next((other for pair in session.SAVE_PAIRS for other in pair
                            if core in pair and other != core and session.shares_saves(core, other, system_id)), "")
            lone = partner and ra.save_paths(partner, rom) != ra.save_paths(core, rom) \
                and ra.save_paths(partner, rom)[0].is_file() and not ra.save_paths(core, rom)[0].is_file()
            owner = partner if lone else core
        else:
            detected = session.detect(route["shortcut"]["exe"], route["shortcut"]["launchOptions"])
            owner = detected["core"] if detected and detected["emulator"] == "retroarch" else ""
        if not session.shares_saves(core, owner, system_id):
            return core, None
        paths = ra.save_paths(owner, rom)
        if paths == ra.save_paths(core, rom):
            return owner, None
        if ra.overriding_key(core, rom, session.SAVE_FOLDER_KEYS):
            decky.logger.info("saves: an override sets where %s's saves go, so it plays its own save of %s",
                              ra.core_name(core), game["title"])
            return core, None
        return owner, paths[0].parent

    def _clock_backup(self, target, trigger: str):
        if self._backups is None or target is None:
            return None
        return lambda: self._backups.back_up(target, "rtc", trigger)

    def play_backup_target(self, game_id: int, choice=None):
        route, _gate, _detail = self._play_route(game_id, choice=choice)
        return self._route_target(game_id, route) if route is not None else None

    def _route_target(self, game_id: int, route: dict):
        game = (self._library() or {}).get(game_id)
        if game is None:
            return None
        emulator, core = _route_emulator(route)
        owner = self._launch_save(game, route, self._retroarch())[0] if emulator == "retroarch" else ""
        return self._backup_target({"gameId": game_id, "systemId": game["systemId"], "emulator": emulator,
                                    "core": core, "path": route["rom"], "route": route},
                                   owner if owner != core else "")

    def _backup_target(self, local: dict, owner: str = ""):
        system_id, emulator = local["systemId"], local["emulator"]
        if emulator == "retroarch" and local.get("core") and local.get("path") \
                and system_id not in NO_SAVE_BACKUP_SYSTEMS:
            ra = self._retroarch()
            if not ra.found:
                return None
            core = owner or local["core"]
            return {"gameId": local["gameId"], "systemId": system_id, "emulator": "retroarch", "core": core,
                    "coreName": ra.core_name(core), "paths": ra.save_paths(core, Path(local["path"]))}
        if emulator != "dolphin" or system_id not in session.DOLPHIN_SYSTEMS:
            return None
        install = local.get("install")
        if install is None:
            install = self._route_install(local.get("route"))
        disc = rom_headers.disc_game_id(local.get("real") or local.get("path") or "")
        if system_id == session.GAMECUBE_SYSTEM:
            folder = self._gci_folder(install, disc)
            if folder is None:
                return None
            return {"gameId": local["gameId"], "systemId": system_id, "emulator": "dolphin", "install": install,
                    "title": disc, "paths": [folder], "match": f"{disc[4:]}-{disc[:4]}-"}
        code = local.get("gameCode") or disc[:4]
        user_dir = session.dolphin_user_dir(self._user_home, install)
        data = wii_saves.title_data(user_dir, code) if user_dir is not None else None
        if data is None:
            return None
        return {"gameId": local["gameId"], "systemId": system_id, "emulator": "dolphin", "install": install,
                "title": wii_saves.DISC_TYPE + data.parent.name, "paths": [data]}

    def _gci_folder(self, install: str, disc: str):
        config = session.dolphin_config(self._user_home, install)
        user_dir = session.dolphin_user_dir(self._user_home, install)
        if config is None or user_dir is None or len(disc) != 6 or disc[3] not in GCI_REGIONS:
            return None
        core = _ini_section(config, "Core")
        if core.get("SlotA", GCI_FOLDER_DEVICE) != GCI_FOLDER_DEVICE or core.get("GCIFolderAPathOverride"):
            return None
        default_region, chosen_region = GCI_REGIONS[disc[3]]
        chosen = core.get("GCIFolderAPath", "").rstrip("/")
        if not chosen:
            return user_dir / "GC" / default_region / "Card A"
        for region in ("USA", "JPN", "EUR", "DEV"):
            if chosen.endswith("/" + region):
                chosen = chosen[:-len(region) - 1]
                break
        return Path(chosen) / chosen_region if chosen.startswith("/") else None

    def _route_shortcut(self, route):
        if route is None:
            return None
        return self._emulator_by_appid(route["appid"]) if route["fallback"] else route["shortcut"]

    def _route_install(self, route) -> str:
        shortcut = self._route_shortcut(route)
        if shortcut is None:
            return ""
        return session.dolphin_install(shortcut["exe"], shortcut["launchOptions"], self._user_home)

    def _automap(self, shortcut) -> bool:
        return shortcut is not None and session.emudeck_automap(
            shortcut["exe"], shortcut["launchOptions"], self._user_home)

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

    def prepare_play(self, game_id: int, original: str, name: str = "", choice=None) -> dict:
        current = self._session
        if current is not None and not current["exited"]:
            return {"ok": False, "error": ERROR_BUSY}
        if self.restore_record()["record"] is not None:
            return {"ok": False, "error": ERROR_BUSY}
        self._fresh_shortcuts()
        route, gate, detail = self._play_route(game_id, choice=choice)
        if route is not None and self._rom_moved(game_id, route.get("rom")):
            route, gate, detail = self._play_route(game_id, choice=choice)
        if route is None:
            return {"ok": False, "error": ERROR_GATE, "gate": gate, "detail": detail}
        args = _route_args(route)
        if not args:
            return {"ok": False, "error": ERROR_NOT_READY}
        game = (self._library() or {}).get(game_id)
        rename = _status_title(game["title"] if game is not None else "", name)
        sid = secrets.token_hex(8)
        try:
            ensure_dir(self._session_dir)
            chown_to_data_owner(self._session_dir)
            folder = self._launch_save(game, route, self._retroarch())[1] if game is not None else None
            if folder is not None:
                cfg_path = self._session_dir / f"session-{sid}.cfg"
                self._write(cfg_path, session.save_folder_session(folder))
                if not self._readable_by_owner([cfg_path]):
                    raise OSError("session files are not the home owner's")
                args = f"--appendconfig {session.quote(str(cfg_path))} {args}"
                decky.logger.info("play: %s plays its own shortcut core's save from %s", game["title"], folder)
            self._write_restore(route["appid"], original, sid, play_game=game_id, name=name, renamed=rename)
        except OSError as e:
            decky.logger.warning("play: couldn't write the restore record (%s)", type(e).__name__)
            return {"ok": False, "error": ERROR_WRITE_FAILED}
        decky.logger.info("play: launching %s through the %s shortcut%s", game_id, route["kind"],
                          f" ({route['picked']} pick)" if route.get("picked") else "")
        return {
            "ok": True,
            "appid": route["appid"],
            "options": session.compose_launch_options(original, args),
            "original": original,
            "session": sid,
            "rename": rename,
            "name": name,
        }

    def _fallback_kinds(self, mode: str, system_id: int) -> tuple:
        if system_id in session.DOLPHIN_SYSTEMS:
            return ("dolphin",)
        if system_id == session.N64_SYSTEM:
            return ("retroarch", "rmg")
        if system_id == PSP_SYSTEM and mode == "link":
            return ("ppsspp", "retroarch")
        return ("retroarch",)

    def _play_kinds(self, system_id: int) -> tuple:
        if system_id == session.PS1_SYSTEM:
            return ("duckstation", "retroarch")
        if system_id == PS2_SYSTEM:
            return ("pcsx2", "retroarch")
        if system_id == PSP_SYSTEM:
            return ("ppsspp", "retroarch")
        if system_id in (session.DS_SYSTEM, DSI_SYSTEM):
            return ("retroarch", "melonds")
        return self._fallback_kinds("link", system_id)

    def _couch_kinds(self, system_id: int) -> tuple:
        if system_id in session.DOLPHIN_SYSTEMS:
            return ("dolphin",)
        if system_id == session.N64_SYSTEM:
            return ("rmg", "retroarch")
        return ("retroarch",)

    def _pick_shortcut(self, shortcuts: list, mode: str, system_id: int) -> dict:
        if mode == "couch":
            kinds = self._couch_kinds(system_id)
        elif mode == "link":
            kinds = self._fallback_kinds("link", system_id)
        else:
            kinds = self._play_kinds(system_id)
        detected = []
        for shortcut in shortcuts:
            found = session.detect(shortcut["exe"], shortcut["launchOptions"])
            detected.append((found["emulator"] if found else "", shortcut))
        for kind in kinds:
            for emulator, shortcut in detected:
                if emulator == kind:
                    return shortcut
        return shortcuts[0]

    def _fallback(self, mode: str, system_id: int) -> dict:
        kinds = self._fallback_kinds(mode, system_id)
        for kind in kinds:
            shortcut = self._emulator_shortcut(kind, None)
            if shortcut is not None:
                return {**shortcut, "kind": kind}
        return {"appid": 0, "name": "", "exe": "", "launchOptions": "", "kind": kinds[0]}

    def _emulator_shortcuts(self) -> list:
        held = self.restore_record()["record"]
        held = (held["appid"], held["original"]) if held is not None else None
        found = steam_shortcuts.emulator_shortcuts(self._user_home, held)
        overlay = self._overlay()
        if overlay is not None and overlay.shortcuts:
            return found + overlay.shortcuts
        return found

    def _emulator_by_appid(self, appid: int):
        return next((row for row in self._emulator_shortcuts() if row["appid"] == appid), None)

    def _emulator_count(self, kind: str) -> int:
        return sum(1 for row in self._emulator_shortcuts()
                   if session.emulator_kind(row["exe"], row["launchOptions"]) == kind)

    def _emulator_shortcut(self, kind: str, install=""):
        first = None
        for shortcut in self._emulator_shortcuts():
            if session.emulator_kind(shortcut["exe"], shortcut["launchOptions"]) != kind:
                continue
            if kind == "dolphin" and install is not None and session.dolphin_install(
                    shortcut["exe"], shortcut["launchOptions"], self._user_home) != install:
                continue
            if self._gone(shortcut) is None:
                return shortcut
            first = first or shortcut
        return first

    def _dolphin_version(self, install: str, shortcut: dict) -> str:
        if install == "flatpak":
            return self._flatpak_version(session.DOLPHIN_FLATPAK)
        if install != "appimage":
            return ""
        return self._appimage_version(
            session.dolphin_appimage(shortcut["exe"], shortcut["launchOptions"], self._user_home))

    def _appimage_version(self, image: str) -> str:
        overlay = self._overlay()
        if overlay is not None and image in overlay.versions:
            return overlay.versions[image]
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

    def _gates(self, mode: str, local: dict, room, players: int, warn_crc: bool = True):
        warnings = []
        if mode == "stream":
            return self._stream_gates(room), self._stream_warnings(local) if room is None else warnings
        rom = Path(local["path"])
        system_id = local["systemId"]
        ra = local.get("ra")

        if local["fallback"] and not os.path.isfile(local["path"]):
            return ("rom_missing", {}), warnings
        if room is None and mode == "couch" and self._hash_needs_dolphin(local, system_id):
            return ("needs_dolphin", {}), warnings
        if local.get("missingCore"):
            return ("couch_core_missing", {"core": local["coreName"], "coreId": local["core"]}), warnings

        if room is not None:
            if room.get("where") == "online" and _lan_only(mode, local):
                return (ERROR_LAN_ONLY, {}), warnings
            if mode == "couch":
                if local["core"] != room["core"]:
                    if not ra or not ra.installed(room["core"]):
                        return ("host_core_missing", {"core": room["coreName"] or room["core"], "coreId": room["core"]}), \
                            warnings
                    return ("match_host_core", {"core": room["coreName"] or room["core"]}), warnings
                check_crc = local["emulator"] == "retroarch" and (warn_crc or system_id == session.NES_SYSTEM)
                crc = self._crc_of(local["real"]) if check_crc else ""
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
            gen3_pair = room["gameCode"][:3] in session.GEN3_POKEMON_CODES \
                and local["gameCode"][:3] in session.GEN3_POKEMON_CODES
            if mode == "link" and room["gameId"] != local["gameId"] and not gen3_pair:
                warnings.append({"code": "game_differs", "detail": {}})
            versions_differ = local["core"] not in proto.NETPACKET_CORES and local["emulator"] not in ("dolphin", "rmg") \
                and _known(room["emuVersion"]) and _known(local["emuVersion"]) \
                and room["emuVersion"] != local["emuVersion"]
            if mode == "couch" and local["emulator"] == "dolphin" and room["emuVersion"] and local["emuVersion"] \
                    and room["emuVersion"] != local["emuVersion"]:
                return ("dolphin_version_mismatch", {"version": room["emuVersion"], "install": local.get("install", ""),
                                                     "appid": local["appid"]}), warnings
            if local["emulator"] == "rmg" and room["emuVersion"] and local["emuVersion"] \
                    and room["emuVersion"] != local["emuVersion"]:
                return ("rmg_version_mismatch", {"version": room["emuVersion"], "install": local.get("install", ""),
                                                 "appid": local["appid"]}), warnings
            if mode == "couch" and room["coreBuild"] and local["coreBuild"] \
                    and room["coreBuild"] != local["coreBuild"]:
                warnings.append({"code": "core_build_differs", "detail": {"core": room["coreName"]}})
            elif versions_differ:
                warnings.append({"code": "version_mismatch", "detail": {}})

        if ra is not None:
            key = ra.overriding_key(local["core"], rom)
            if key:
                return ("override", {"key": key}), warnings
            devices = session.multitap(local["core"], self._current_tap()).get("devices") \
                if mode == "couch" and players > 2 else None
            if devices and session.remap_port_conflict(ra, core=local["core"], rom=rom, devices=devices):
                return ("remap", {}), warnings
            if devices:
                key = ra.overriding_key(local["core"], rom, session.MULTITAP_CFG_KEYS)
                if key:
                    return ("override", {"key": key}), warnings
            if local.get("duckstation") or (local["fallback"] and system_id == session.PS1_SYSTEM
                                            and self._emulator_shortcut("duckstation") is not None):
                warnings.append({"code": "duckstation_switch", "detail": {"core": local["coreName"]}})
            elif local["core"] != local["shortcutCore"] and not local["fallback"]:
                carried = session.shares_saves(local["core"], local["shortcutCore"], system_id) and (
                    (mode == "couch" and room is not None) or self._owner_save_ok(ra, local, local["core"]))
                if ra.sorts_saves_by_core(local["core"], rom) and not carried:
                    detail = {"core": local["coreName"], "shortcutCore": local["shortcutCoreName"]}
                    if mode == "link":
                        return ("saves_by_core", detail), warnings
                    warnings.append({"code": "saves_by_core", "detail": detail})
                swapped = mode == "couch" and local["shortcutCore"] not in self._compatible(ra, "couch", system_id)
                if not local.get("recommended"):
                    warnings.append({"code": "core_swap_couch" if swapped else "core_override",
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
        return self._check(mode, game_id, core, room)

    def modes(self, game_id: int, room_id: str = "") -> dict:
        answer = {"ok": True, "modes": {}, "shortcutFallback": self._fallback_on(), "tools": self.desktop_tools()}
        joined = self._joined
        if joined is not None and self._room is None:
            answer["modes"][joined["row"]["mode"]] = _mode_state(self._joined_check(joined))
            return answer
        room = self._room_row(room_id) if self._room is None else None
        hosted = self._room
        if hosted is not None:
            game_id = hosted["gameId"]
        for mode in proto.MODES:
            core = hosted["core"] if hosted is not None and mode == hosted["mode"] else ""
            answer["modes"][mode] = _mode_state(self._check(mode, game_id, core, room))
        if room is None and hosted is None:
            game = (self._library() or {}).get(game_id)
            for entry in (game or {}).get("paths") or []:
                if os.path.isfile(entry["real"]):
                    self._read_ahead(entry, game["systemId"])
        return answer

    def _fix(self, gate, detail: dict, mode: str, game_id: int, room, inventory=None):
        if self._emulators is None or gate not in PLANNED_GATES:
            return None
        library = self._library() or {}
        game = library.get(room["gameId"] if room is not None and mode == "couch" else game_id) or {}
        context = {
            "mode": mode,
            "systemId": game.get("systemId"),
            "shortcutFallback": self._fallback_on() if mode != "play" else self._play_fallback_on(),
            "hostVersion": str(room.get("emuVersion") or "") if room is not None and mode == "couch" else "",
            "raShortcut": self._emulator_shortcut("retroarch") is not None,
        }
        if gate == "no_emulator_shortcut":
            context["kind"] = next((kind for kind, name in FALLBACK_NAMES.items() if name == detail.get("emulator")), "")
        if gate == "emulator_missing":
            context["kind"] = detail.get("kind", "")
        if gate in ("dolphin_version_mismatch", "rmg_version_mismatch"):
            shortcut = self._emulator_by_appid(detail.get("appid") or 0)
            if shortcut is not None:
                find = session.dolphin_appimage if gate.startswith("dolphin") else session.rmg_appimage
                context["path"] = find(shortcut["exe"], shortcut["launchOptions"], self._user_home)
        return self._emulators.plan(gate, detail, context, inventory)

    def _gate_answer(self, gate, detail: dict, mode: str, game_id: int, room) -> dict:
        fix = self._fix(gate, detail, mode, game_id, room)
        planned = self._emulators is not None and gate in PLANNED_GATES \
            and (gate not in VERSION_GATES or self._emulators.latest_known())
        return {"fix": fix, "state": _gate_state(gate, fix, planned)}

    def _check(self, mode: str, game_id: int, core: str, room) -> dict:
        local, gate, detail = self._local(mode, game_id, core, room)
        if local is None:
            return self._with_plan({"ok": True, "gate": gate, "detail": detail, "warnings": [], "local": None,
                                    **self._gate_answer(gate, detail, mode, game_id, room)}, mode, game_id, core, room)
        found, warnings = self._gates(mode, local, room, self._players(mode, room))
        gate, detail = (found[0], found[1]) if found else (None, {})
        return self._with_plan({
            "ok": True,
            "gate": gate,
            "detail": detail,
            "warnings": warnings,
            "local": _local_view(local),
            "lanOnly": _lan_only(mode, local),
            **self._gate_answer(gate, detail, mode, game_id, room),
        }, mode, game_id, core, room)

    def _with_plan(self, checked: dict, mode: str, game_id: int, core: str, room, joined=None) -> dict:
        checked["plan"] = self._plan_ahead(mode, game_id, core, room, (checked["gate"], checked["detail"], checked["fix"]),
                                           joined=joined)
        if checked["plan"]["steps"]:
            checked["state"] = "setup"
        return checked

    def _overlay(self):
        return getattr(self._overlays, "now", None)

    def _gate_now(self, target: str, game_id: int, core: str, room, joined=None, choice=None):
        if target == "play":
            _route, gate, detail = self._play_route(game_id, choice=choice)
            return gate, detail
        if joined is not None:
            local, gate, detail = self._decide(joined["row"], joined["own"], joined["core"])
            return (None, {}) if local is not None else (gate, detail)
        local, gate, detail = self._local(target, game_id, core, room)
        if local is None:
            return gate, detail
        found, _warnings = self._gates(target, local, room, self._players(target, room), warn_crc=False)
        return (found[0], found[1]) if found else (None, {})

    def plan_ahead(self, target: str, game_id: int, room_id: str = "", choice=None) -> dict:
        if target == "play":
            first = self._gate_now("play", game_id, "", None, choice=choice)
            fix = self._fix(first[0], first[1], "play", game_id, None) if first[0] else None
            return self._plan_ahead("play", game_id, "", None, (*first, fix), choice=choice)
        joined = self._joined if self._room is None else None
        if joined is not None:
            checked = self._joined_check(joined)
            return checked["plan"]
        room = self._room_row(room_id) if self._room is None else None
        core = ""
        if self._room is not None:
            target, game_id, core = self._room["mode"], self._room["gameId"], self._room["core"]
        return self._check(target, game_id, core, room)["plan"]

    def _plan_ahead(self, target: str, game_id: int, core: str, room, first, joined=None, choice=None) -> dict:
        mode = joined["row"]["mode"] if joined is not None else target
        fix_game = (joined["own"] or joined["row"]["gameId"]) if joined is not None else game_id
        fix_room = joined["row"] if joined is not None else room
        gate, detail, fix = first
        first_gate = gate
        stages, steps, outcome, blocker = [], [], "blocked", None
        overlay = _Overlay()
        self._overlays.now = overlay
        try:
            while True:
                if not gate:
                    outcome = "ready"
                    break
                tried = self._dolphin_picks.get(fix_game) if gate in PICK_GATES else None
                if tried is not None and self._flatpak_installed(session.DOLPHIN_FLATPAK) is False:
                    gate, detail = "needs_dolphin", {}
                if gate in PICK_GATES:
                    pick = {**PICK_STEP, "path": tried} if tried is not None else dict(PICK_STEP)
                    stages.append({"gate": gate, "detail": detail, "steps": [pick]})
                    steps = steps + [pick]
                    outcome = "after_pick"
                    break
                if stages or gate != first_gate:
                    fix = None
                    if len(stages) < PLAN_STAGES and self._emulators is not None:
                        fix = self._fix(gate, detail, mode, fix_game, fix_room,
                                        self._emulators.inventory_after(steps) if steps else None)
                merged = _merge_steps(steps, fix or [])
                if len(merged) == len(steps):
                    blocker = {"gate": gate, "detail": detail}
                    break
                stages.append({"gate": gate, "detail": detail, "steps": fix})
                steps = merged
                self._imagine(overlay, fix, detail)
                gate, detail = self._gate_now(target, game_id, core, room, joined, choice)
        finally:
            self._overlays.now = None
        return {"outcome": outcome, "stages": stages, "steps": steps, "blocker": blocker}

    def _imagine(self, overlay: _Overlay, steps: list, detail: dict) -> None:
        for step in steps:
            do = step["do"]
            if do == "enable_shortcut_fallback":
                overlay.mp_fallback = True
            elif do == "enable_play_shortcut_fallback":
                overlay.play_fallback = True
            elif do == "setup_streaming":
                overlay.streaming = True
            elif do in ("install_core", "update_core"):
                overlay.cores.add(step["core"])
            elif do == "install_emulator":
                choice = next((option for option in step.get("choices") or [] if option["via"] == step["via"]), {})
                if step["via"] == "flatpak":
                    overlay.flatpaks.add(choice.get("id") or catalog.BY_KIND[step["kind"]]["flatpak"])
                else:
                    overlay.files.add(choice.get("path", ""))
            elif do == "update_emulator":
                key = catalog.BY_KIND[step["kind"]]["flatpak"] if step["via"] == "flatpak" else step.get("path", "")
                overlay.versions[key] = str(detail.get("version") or "")
            elif do == "add_to_steam":
                overlay.shortcuts.append(_planned_shortcut(step, len(overlay.shortcuts)))
            elif do == "add_dolphin_folder":
                overlay.dolphin_folders.add(step["folder"])

    def _redecide(self, joined: dict, always: bool = False) -> None:
        changed = self._emulators.changed if self._emulators is not None else 0
        if not always and joined.get("changed") == changed:
            return
        rev = joined["rowRev"]
        local, reason, detail, state = self._verdict(joined)
        if joined["rowRev"] == rev:
            joined.update(local=local, can=local is not None, reason=reason, detail=detail, seatState=state,
                          changed=changed)

    def redecide_if_changed(self) -> None:
        joined = self._joined
        if joined is not None:
            self._redecide(joined)

    def _joined_check(self, joined: dict) -> dict:
        self._redecide(joined, always=not joined["can"])
        local = joined["local"]
        warnings = []
        if local is not None:
            row = joined["row"]
            _found, warnings = self._gates(row["mode"], local, row, self._players(row["mode"], row))
        gate = None if joined["can"] else joined["reason"]
        detail = {} if joined["can"] else joined["detail"]
        return self._with_plan({
            "ok": True,
            "gate": gate,
            "detail": detail,
            "warnings": warnings,
            "local": _local_view(local) if local is not None else None,
            **self._gate_answer(gate, detail, joined["row"]["mode"], joined["own"] or joined["row"]["gameId"],
                                joined["row"]),
        }, joined["row"]["mode"], joined["own"] or joined["row"]["gameId"], "", joined["row"], joined=joined)

    def _decide(self, row: dict, own_game: int, core: str):
        mode = row["mode"]
        players = self._players(mode, row)
        if row["hostState"] and mode != "stream":
            local, gate, detail = self._local(mode, own_game or row["gameId"], core if own_game else "", None)
            if local is not None:
                found, _warnings = self._gates(mode, local, None, players, warn_crc=False)
                if found:
                    gate, detail = found
            return (local, "", {}) if not gate else (None, gate, detail)
        if mode in ("couch", "stream"):
            local, gate, detail = self._local(mode, row["gameId"], "", row)
            if local is not None:
                found, _warnings = self._gates(mode, local, row, players, warn_crc=False)
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
                found, _warnings = self._gates(mode, local, row, players, warn_crc=False)
                if not found:
                    return local, "", {}
                gate, detail = found
            failed = failed or (gate, detail)
        return None, failed[0], failed[1]

    async def vote_start(self, kind: str, game_ids: list) -> dict:
        room = self._room
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if room["state"] != "lobby":
            return {"ok": False, "error": ERROR_VOTE_LOBBY}
        current = room["vote"]
        if current is not None and not current["ended"]:
            return {"ok": False, "error": ERROR_VOTE_OPEN}
        library = await asyncio.to_thread(self._library) or {}
        ids = list(dict.fromkeys(game_ids))
        if not lounge.VOTE_GAMES_MIN <= len(ids) <= lounge.VOTE_GAMES_MAX or any(game not in library for game in ids):
            return {"ok": False, "error": ERROR_VOTE_GAMES}
        if self._room is not room or room["state"] != "lobby" or (room["vote"] is not current):
            return {"ok": False, "error": ERROR_VOTE_OPEN}
        games = [{"gameId": game, "systemId": library[game]["systemId"],
                  "title": proto.clean_title(library[game]["title"]) or str(game),
                  "icon": proto.clean_icon(library[game].get("imageIcon"))} for game in ids]
        vote = lounge.new_vote((current["id"] if current else 0) + 1, kind, games)
        room["vote"] = vote
        if kind == "pick":
            vote["winner"] = secrets.randbelow(len(games))
            self._spawn(self._land_pick(room, vote["id"]))
        decky.logger.info("multiplayer: %s over %s games", "a vote" if kind == "vote" else "a random pick", len(games))
        self._announce()
        return {"ok": True, "room": self._host_view(room)}

    def vote_cancel(self) -> dict:
        room = self._room
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        vote = room["vote"]
        if vote is not None and vote["open"]:
            vote.update(open=False, ended="canceled")
            decky.logger.info("multiplayer: the vote was canceled")
            self._announce()
        return {"ok": True, "room": self._host_view(room)}

    async def _land_pick(self, room: dict, number: int) -> None:
        await asyncio.sleep(lounge.PICK_SECONDS)
        vote = room["vote"]
        if self._room is not room or vote is None or vote["id"] != number or vote["ended"]:
            return
        vote["ended"] = "won"
        room["switching"] = room["gameId"] != vote["games"][vote["winner"]]["gameId"]
        self._count("pt_vote_won")
        self._announce()
        await self._switch_to_winner(room, vote)

    async def _switch_to_winner(self, room: dict, vote: dict) -> None:
        game = vote["games"][vote["winner"]]
        if self._room is not room or room["gameId"] == game["gameId"]:
            return
        room["switching"] = True
        try:
            switched = await self.change_game(room["mode"], game["gameId"], "")
        finally:
            room["switching"] = False
            self._announce()
        if not switched.get("ok"):
            decky.logger.info("multiplayer: the room couldn't move to the winner (%s)", switched.get("error"))

    def _voters(self, room: dict) -> list:
        return [lounge.voter_key(seat) for seat in room["seats"] if seat is not None]

    def _cast(self, room: dict, seat: dict, number: int, pick: int) -> str:
        vote = room["vote"]
        if vote is None:
            return lounge.VOTE_NONE
        if room["state"] != "lobby":
            return lounge.VOTE_IN_GAME
        if vote["id"] != number or not vote["open"] or not 0 <= pick < len(vote["games"]):
            return lounge.VOTE_OVER
        key = lounge.voter_key(seat)
        if key in vote["ballots"]:
            return lounge.VOTE_VOTED
        vote["ballots"][key] = pick
        self._vote_maybe_done(room)
        self._announce()
        return ""

    def _vote_maybe_done(self, room: dict) -> None:
        vote = room["vote"]
        if vote is None or not vote["open"] or not lounge.everyone_voted(vote, self._voters(room)):
            return
        vote.update(open=False, ended="won", winner=lounge.winner(vote))
        self._count("pt_vote_won")
        decky.logger.info("multiplayer: the vote is in, %s wins", vote["games"][vote["winner"]]["gameId"])
        room["switching"] = room["gameId"] != vote["games"][vote["winner"]]["gameId"]
        self._spawn(self._switch_to_winner(room, vote))

    def _lounge_press(self, room: dict, index: int, seat: dict, game: str, act: str, cell: int, to: int) -> str:
        board = room["lounge"][game]
        was_over = board["end"]
        if act == "clear":
            lounge.clear(room["lounge"], game)
            error = ""
        elif game == "ttt":
            error = lounge.ttt_move(room["lounge"]["ttt"], index, seat, cell) if act == "move" else ERROR_UNAVAILABLE
        elif game == "rev":
            error = lounge.rev_act(room["lounge"]["rev"], index, seat, act, cell) if act != "start" else ERROR_UNAVAILABLE
        elif game == "chk":
            error = lounge.chk_act(room["lounge"]["chk"], index, seat, act, cell, to) if act != "start" else ERROR_UNAVAILABLE
        else:
            error = lounge.c4_act(room["lounge"]["c4"], index, seat, act, cell) if act != "join" else ERROR_UNAVAILABLE
        if not error:
            if act != "clear" and not was_over and board["end"]:
                self._count_lounge(game, board, 0)
            self._announce()
        return error

    def _seat_press(self, room: dict, index: int, seat: dict, op: str, raw) -> str:
        if op == "vote":
            pressed = proto.read_vote_press(raw)
            return self._cast(room, seat, *pressed) if pressed is not None else ERROR_UNAVAILABLE
        pressed = proto.read_lounge_press(raw)
        return self._lounge_press(room, index, seat, *pressed) if pressed is not None else ERROR_UNAVAILABLE

    def _games_seat_left(self, room: dict, index: int) -> None:
        if lounge.seat_left(room["lounge"], index):
            self._announce()
        self._vote_maybe_done(room)

    async def vote(self, number: int, pick: int) -> dict:
        room = self._room
        if room is not None:
            error = self._cast(room, room["seats"][0], number, pick)
            return {"ok": False, "error": error} if error else {"ok": True, "room": self._host_view(room)}
        return await self._guest_press("vote", {"vote": number, "pick": pick})

    async def lounge_press(self, game: str, act: str, cell: int, to: int = 0) -> dict:
        pressed = proto.read_lounge_press({"game": game, "act": act, "cell": cell, "to": to})
        if pressed is None:
            return {"ok": False, "error": ERROR_UNAVAILABLE}
        room = self._room
        if room is not None:
            error = self._lounge_press(room, 0, room["seats"][0], *pressed)
            return {"ok": False, "error": error} if error else {"ok": True, "room": self._host_view(room)}
        return await self._guest_press("lounge", {"game": game, "act": act, "cell": cell, "to": to})

    async def _guest_press(self, op: str, extra: dict) -> dict:
        joined = self._joined
        if joined is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        async with joined["asking"]:
            nonce, reply = await self._ask(joined, op, extra)
            if self._joined is not joined:
                return {"ok": False, "error": ERROR_NO_ROOM}
            status = proto.read_status_reply(joined["key"], reply, nonce) if reply is not None else None
            if status is not None:
                joined["fastUntil"] = max(joined["fastUntil"], time.monotonic() + GAMES_FAST_SECONDS)
                await self._apply_status(joined, status)
                if self._joined is not joined:
                    return {"ok": False, "error": ERROR_NO_ROOM}
                return {"ok": True, **self._guest_view(joined)}
        error = reply.get("error") if isinstance(reply, dict) else None
        return {"ok": False, "error": error if error and proto.is_reason(error) else ERROR_UNAVAILABLE}

    def _verdict(self, joined: dict):
        self._fresh_shortcuts()
        local, reason, detail = self._decide(joined["row"], joined["own"], joined["core"])
        if local is not None and self._rom_moved(local["gameId"], local.get("path")):
            local, reason, detail = self._decide(joined["row"], joined["own"], joined["core"])
        if local is not None:
            return local, reason, detail, ""
        row = joined["row"]
        game = joined["own"] or row["gameId"]
        answer = self._gate_answer(reason, detail, row["mode"], game, row)
        state = answer["state"]
        if state != "setup":
            plan = self._plan_ahead(row["mode"], game, "", row, (reason, detail, answer["fix"]), joined=joined)
            state = "setup" if plan["steps"] else "never"
        return None, reason, detail, state

    async def host(self, mode: str, game_id: int, hardcore: bool, core: str = "", share: bool = False,
                   name: str = "", size: int = proto.DEFAULT_SEATS, password: str = "", status: str = "",
                   where: str = "local", watch: bool = False, friends: bool = False, voice: bool = False,
                   screen: str = "", check_frames: int = session.DEFAULT_CHECK_FRAMES,
                   steady_wifi: bool = True) -> dict:
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
            local, gate, detail = await asyncio.to_thread(self._launch_local, mode, game_id, core, None)
            if local is not None:
                found, _warnings = await asyncio.to_thread(self._gates, mode, local, None, 2)
                if found:
                    gate, detail = found
            if gate:
                return {"ok": False, "error": ERROR_GATE, "gate": gate, "detail": detail}
            if online and _lan_only(mode, local):
                return {"ok": False, "error": ERROR_GATE, "gate": ERROR_LAN_ONLY, "detail": {}}
            described = await asyncio.to_thread(self._describe, mode, local)
            saved = await asyncio.to_thread(self._game_options.get, local["gameId"])

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
                "share": bool(share) and mode == "couch",
                "watch": bool(watch) and mode in ("couch", "stream"),
                "adapter": saved["adapter"] if saved["adapter"] in session.adapters_for(described["core"]) else "auto",
                "checkFrames": check_frames if mode == "couch" and check_frames in session.CHECK_FRAMES
                else session.DEFAULT_CHECK_FRAMES,
                "bitrate": saved["bitrate"] if mode == "stream" else 0,
                "uhd": False,
                "voice": bool(voice),
                "steadyWifi": bool(steady_wifi),
                "locked": False,
                "max": seats,
                "seats": [{"name": user, "host": True, "said": 0.0, "ulid": ulid, "pic": pic, "vc": False,
                           "vstamp": 1, "model": self._model}] + [None] * (seats - 1),
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
                "address": self._lan_address(),
                "pv": PLUGIN_VERSION,
                "local": local,
                "hostState": "",
                "hostGate": "",
                "hostDetail": {},
                "carried": {},
                "vote": None,
                "switching": False,
                "lounge": lounge.new_lounge(),
                "countedRound": 0,
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
                    return {"ok": False, "error": ERROR_UPDATE_REQUIRED if link.outdated else ERROR_LOBBY_UNREACHABLE}
                self._link = link
            meet = await asyncio.to_thread(stream_room.resolve_meet, server) if online else None
            digest = hashlib.sha256(self._link.secret.encode("ascii")).digest() if online else b""
            room.update(meet=meet, digest=digest)
            self._room = room
            self._friend_sent = {}
            if mode == "stream":
                failed = await self._open_streams(room, server)
                if failed:
                    self._close_room("")
                    return {"ok": False, "error": ERROR_GATE, "gate": failed, "detail": {}}
                room["streams"].host_size = await asyncio.to_thread(self._stream_size, "host", screen)
            if online:
                room["pipes"] = game_pipes.HostPipes(
                    room_id=room_id, meet=meet, digest=digest, tcp_ports=PIPE_TCP_PORTS, udp_ports=PIPE_UDP_PORTS,
                    gate=lambda index, kind, port: self._room is room and self._game_port_open(room, index, kind, port),
                    debug=self._debug,
                )
            self._tell_voice_room()
            self._closed_reason = ""
            self._seen.clear()
            self._seen_order.clear()
            self._housekeeper = self._spawn(self._keep_house(room))
            self._announce()
            await asyncio.to_thread(self._game_options.set, room["gameId"], self._hosted_options(room))
            decky.logger.info(
                "multiplayer: hosting %s, %s on %s, %s seats%s%s",
                local["gameId"], mode, local["core"], seats,
                f", with a password (key in {key_ms:.0f} ms)" if private else "",
                ", online" if online else "",
            )
            self._count("pt_host")
            return {"ok": True, "room": self._host_view(room)}

    def _hosted_options(self, room: dict) -> dict:
        options = {}
        if room["mode"] in ("couch", "stream"):
            options["watch"] = room["watch"]
        if room["mode"] == "couch":
            options.update(share=room["share"], checkFrames=room["checkFrames"])
        return options

    def _describe(self, mode: str, local: dict) -> dict:
        return {
            "title": local["title"],
            "gameId": local["gameId"],
            "systemId": local["systemId"],
            "emulator": local["emulator"],
            "core": local["core"],
            "coreName": local["coreName"],
            "emuVersion": local["emuVersion"],
            "hash": self._hash_of_path(local, local["systemId"]) if mode != "stream" else "",
            "crc": self._crc_of(local["real"]) if mode == "couch" and local["emulator"] == "retroarch" else "",
            "coreBuild": local["coreBuild"],
            "gameCode": local["gameCode"],
            "tapAuto": self._tap_auto(local),
            "imageIcon": local.get("imageIcon", ""),
        }

    def _describe_unsettled(self, game_id: int):
        game = (self._library() or {}).get(game_id)
        if game is None:
            return None
        return {"title": game["title"], "gameId": game_id, "systemId": game["systemId"], "emulator": "", "core": "",
                "coreName": "", "emuVersion": "", "hash": "", "crc": "", "coreBuild": "", "gameCode": "",
                "tapAuto": "", "imageIcon": game.get("imageIcon", "")}

    def _host_answer(self, mode: str, game_id: int, core: str, online: bool = False):
        local, gate, detail = self._local(mode, game_id, core, None)
        if local is not None:
            found, _warnings = self._gates(mode, local, None, self._players(mode, None))
            if found:
                gate, detail = found
            elif online and _lan_only(mode, local):
                return None, ERROR_LAN_ONLY, {}, "never"
        if not gate:
            return local, "", {}, ""
        state = self._check(mode, game_id, core, None)["state"]
        return None, gate, detail, "never" if state == "never" else "setup"

    def _tap_auto(self, local: dict) -> str:
        if local["emulator"] != "retroarch":
            return ""
        if local["core"] in session.TEAM_PLAYER:
            return "team" if rom_headers.genesis_team_player(local["real"]) else "4way"
        if local["core"] in session.PORT_TWO:
            return "port2" if local["gameId"] in PORT_TWO_GAMES else "port1"
        return ""

    def _room_tap(self, room: dict) -> str:
        if room["tapAuto"] and room["adapter"] in session.adapters_for(room["core"]):
            return room["adapter"]
        return room["tapAuto"]

    def _current_tap(self) -> str:
        if self._room is not None:
            return self._room_tap(self._room)
        status = self._joined["status"] if self._joined is not None else None
        return status.get("adapter", "") if status else ""

    async def room_options(self, hardcore=None, core=None, share=None, watch=None, voice=None, adapter=None,
                           check_frames=None, steady_wifi=None, bitrate=None, uhd=None, locked=None) -> dict:
        room = self._room
        joined = self._joined
        if room is None and joined is not None and uhd is not None:
            joined["uhd"] = await asyncio.to_thread(self._settings_store.update_mp_stream_accept_uhd, bool(uhd))
            return {"ok": True, "acceptUhd": joined["uhd"]}
        if room is None and joined is not None and hardcore is not None:
            joined["hardcore"] = bool(hardcore)
            return {"ok": True}
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if voice is not None and bool(voice) != room["voice"]:
            self._set_room_voice(room, bool(voice))
        if steady_wifi is not None and bool(steady_wifi) != room["steadyWifi"]:
            room["steadyWifi"] = bool(steady_wifi)
            decky.logger.info("multiplayer: Steady Wi-Fi turned %s for the room", "on" if steady_wifi else "off")
            self._announce()
        if locked is not None and bool(locked) != room["locked"]:
            room["locked"] = bool(locked)
            decky.logger.info("multiplayer: room %s", "locked" if locked else "unlocked")
            self._announce()
        if uhd is not None and room["mode"] == "stream" and bool(uhd) != room["uhd"]:
            room["uhd"] = bool(uhd)
            decky.logger.info("multiplayer: 4K Support turned %s for the room", "on" if uhd else "off")
            self._check_upload_for_uhd(room)
        if (voice is not None or steady_wifi is not None or uhd is not None or locked is not None) \
                and hardcore is None and core is None \
                and share is None and watch is None and adapter is None and check_frames is None and bitrate is None:
            return {"ok": True, "room": self._host_view(room)}
        if room["state"] != "lobby":
            return {"ok": False, "error": ERROR_SEATED}
        if core is not None and core != room["core"]:
            return await self.change_game(room["mode"], room["gameId"], core)
        changed = {}
        hardcore_changed = hardcore is not None and bool(hardcore) != room["hardcore"]
        if hardcore_changed:
            room["hardcore"] = bool(hardcore)
        if share is not None and bool(share) != room["share"]:
            room["share"] = changed["share"] = bool(share)
        if watch is not None and bool(watch) != room["watch"]:
            room["watch"] = changed["watch"] = bool(watch)
        if (adapter == "auto" or adapter in session.adapters_for(room["core"])) and adapter != room["adapter"]:
            room["adapter"] = changed["adapter"] = adapter
        if room["mode"] == "couch" and check_frames in session.CHECK_FRAMES and check_frames != room["checkFrames"]:
            room["checkFrames"] = changed["checkFrames"] = check_frames
        if changed or hardcore_changed:
            self._changed(room)
        if room["mode"] == "stream" and bitrate in session.STREAM_BITRATES and bitrate != room["bitrate"]:
            room["bitrate"] = changed["bitrate"] = bitrate
        if changed:
            await asyncio.to_thread(self._game_options.set, room["gameId"], changed)
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
        if on and room.get("streams") is not None:
            self._spawn(self._stream_voice_on(room))
        if not on:
            for seat in room["seats"]:
                if seat is not None:
                    seat["vc"] = False
                    if "vq" in seat:
                        seat["vq"] = []
        decky.logger.info("multiplayer: voice chat turned %s for the room", "on" if on else "off")
        self._announce()

    def _changed(self, room: dict, carried: dict | None = None) -> None:
        room["rev"] += 1
        room["notice"] = None
        room["carried"] = carried or {}
        decky.logger.info("multiplayer: the room changed, rev %s", room["rev"])
        self._announce()

    def _host_changed(self, room: dict) -> None:
        carried = {index: (seat, seat["seq"]) for index, seat in enumerate(room["seats"])
                   if index > 0 and seat is not None and self._seat_ready(room, seat)}
        self._changed(room, carried)

    def _seat_shown_ready(self, room: dict, index: int, seat: dict) -> bool:
        if self._seat_ready(room, seat):
            return True
        held = room["carried"].get(index)
        return room["state"] == "lobby" and held is not None and held[0] is seat and held[1] == seat["seq"]

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
            local, gate, detail, state = await asyncio.to_thread(self._host_answer, mode, game_id, core,
                                                                 room["where"] == "online")
            if local is not None:
                described = await asyncio.to_thread(self._describe, mode, local)
            else:
                described = await asyncio.to_thread(self._describe_unsettled, game_id)
            if described is None:
                return {"ok": False, "error": ERROR_NO_GAME}
            if self._room is not room or room["state"] != "lobby":
                return {"ok": False, "error": ERROR_SEATED}
            if mode == "stream" and room.get("streams") is None and local is not None:
                failed = await self._open_streams(room, self._lobby_server() if room["where"] == "online" else None)
                if self._room is not room:
                    return {"ok": False, "error": ERROR_NO_ROOM}
                if failed:
                    decky.logger.info("multiplayer: the host's change to %s, stream was refused (%s)", game_id, failed)
                    room["notice"] = {"code": failed, "detail": {}}
                    self._announce()
                    return {"ok": False, "error": ERROR_GATE, "gate": failed, "detail": {}}
            elif mode != "stream" and room.get("streams") is not None:
                room["streams"].close()
                room["streams"] = None
                self._release_game_sink()
                if self._stream_host is not None:
                    unpaired = await asyncio.to_thread(self._stream_host.unpair_quietly)
                    if unpaired and self._room is room:
                        self._park_sunshine()
                    else:
                        await asyncio.to_thread(self._stream_host.stop)
            if game_id != room["gameId"]:
                saved = await asyncio.to_thread(self._game_options.get, game_id)
                if self._room is not room or room["state"] != "lobby":
                    return {"ok": False, "error": ERROR_SEATED}
                self._take_game_options(room, mode, described["core"], saved)
            room.update(described, mode=mode, local=local, hostState=state, hostGate=gate or "", hostDetail=detail)
            if state:
                decky.logger.info("multiplayer: the host changed to %s, %s, and isn't set up for it (%s)", game_id, mode, gate)
            else:
                decky.logger.info("multiplayer: the host changed to %s, %s on %s", game_id, mode, local["core"])
            self._changed(room)
            return {"ok": True, "room": self._host_view(room)}

    def _take_game_options(self, room: dict, mode: str, core: str, saved: dict) -> None:
        room["adapter"] = saved["adapter"] if saved["adapter"] in session.adapters_for(core) else "auto"
        room["share"] = saved["share"] and mode == "couch"
        room["watch"] = saved["watch"] and mode in ("couch", "stream")
        room["checkFrames"] = saved["checkFrames"] if mode == "couch" else session.DEFAULT_CHECK_FRAMES
        room["bitrate"] = saved["bitrate"] if mode == "stream" else 0

    async def refresh_room_pick(self, game_id: int) -> None:
        async with self._lock:
            room = self._room
            if room is None or room["state"] != "lobby" or room["gameId"] != game_id or room["mode"] == "link" \
                    or room["hostState"]:
                return
            mode = room["mode"]
            local, gate, _detail = await asyncio.to_thread(self._launch_local, mode, game_id, "", None)
            if local is not None:
                found, _warnings = await asyncio.to_thread(self._gates, mode, local, None, 2)
                gate = found[0] if found else None
            if gate:
                decky.logger.info("multiplayer: the pick for %s doesn't fit the room (%s), left as it was", game_id, gate)
                return
            described = await asyncio.to_thread(self._describe, mode, local)
            if self._room is not room or room["state"] != "lobby":
                return
            if _runs_same(room["local"], local):
                return
            room.update(described, local=local)
            decky.logger.info("multiplayer: the room now runs %s on %s", game_id, local["core"] or local["emulator"])
            self._changed(room)

    async def refresh_room_version(self) -> None:
        async with self._lock:
            room = self._room
            if room is None or room["state"] != "lobby":
                return
            mode = room["mode"]
            if room["hostState"]:
                await self._settle_host(room)
                return
            local, gate, _detail = await asyncio.to_thread(self._launch_local, mode, room["gameId"], room["core"], None)
            if local is not None:
                found, _warnings = await asyncio.to_thread(self._gates, mode, local, None, 2, False)
                gate = found[0] if found else None
            if gate or self._room is not room or room["state"] != "lobby":
                return
            if not _runs_same(room["local"], local):
                return
            if (local["emuVersion"], local["coreBuild"]) == (room["emuVersion"], room["coreBuild"]):
                return
            if _known(room["emuVersion"]) and not _known(local["emuVersion"]):
                return
            decky.logger.info("multiplayer: the room's %s is now %s", local["coreName"] or local["emulator"],
                              local["emuVersion"] or "an unknown version")
            room.update(emuVersion=local["emuVersion"], coreBuild=local["coreBuild"], local=local)
            self._changed(room)

    async def _settle_host(self, room: dict) -> None:
        mode = room["mode"]
        if time.monotonic() < room.get("streamRetryAt", 0.0):
            return
        local, gate, detail, state = await asyncio.to_thread(self._host_answer, mode, room["gameId"], "",
                                                             room["where"] == "online")
        if self._room is not room or room["state"] != "lobby":
            return
        if gate:
            if (state, gate) != (room["hostState"], room["hostGate"]):
                room.update(hostState=state, hostGate=gate, hostDetail=detail)
                self._host_changed(room)
            return
        described = await asyncio.to_thread(self._describe, mode, local)
        if mode == "stream" and room.get("streams") is None:
            failed = await self._open_streams(room, self._lobby_server() if room["where"] == "online" else None)
            if self._room is not room:
                return
            if failed:
                room["streamRetryAt"] = time.monotonic() + STREAM_RETRY_SECONDS
                if room["hostGate"] != failed:
                    room.update(hostState="setup", hostGate=failed, hostDetail={})
                    self._host_changed(room)
                return
        if self._room is not room or room["state"] != "lobby":
            return
        room.update(described, local=local, hostState="", hostGate="", hostDetail={})
        decky.logger.info("multiplayer: the host is set up for %s now", room["gameId"])
        self._host_changed(room)

    async def _hold_game_sink(self, room: dict) -> str:
        canceller = self._voice_canceller
        if canceller is None or not room["voice"]:
            return ""
        return await asyncio.to_thread(canceller.hold, self._in_voice, self._output_changed,
                                       lambda: self._room is room and room["state"] != "lobby")

    def _release_game_sink(self) -> None:
        canceller, loop = self._voice_canceller, self._loop
        if canceller is None:
            return
        if self._stopping or loop is None or loop.is_closed():
            canceller.release()
            return
        loop.run_in_executor(None, canceller.release)

    async def _stream_voice_on(self, room: dict) -> None:
        sink = await self._hold_game_sink(room)
        if not sink or self._room is not room or room.get("streams") is None or self._stream_host is None:
            return
        if self._stream_host.use_sink(sink) and room["state"] == "lobby":
            decky.logger.info("stream: voice chat is on, restarting Sunshine to leave it out of the stream")
            failed = await self._sunshine_restart(room)
            if failed:
                decky.logger.warning("stream: Sunshine didn't come back (%s)", failed)

    async def _open_streams(self, room: dict, server) -> str:
        if self._stream_host is None:
            return "stream_not_set_up"
        sink = await self._hold_game_sink(room)
        parked = self._unpark()
        if parked and await asyncio.to_thread(self._stream_host.running_as, room["name"], sink):
            decky.logger.info("stream: Sunshine was still up, the room goes back to it")
        else:
            failed = await asyncio.to_thread(self._stream_host.start, room["name"], sink)
            if failed:
                if sink:
                    self._release_game_sink()
                return failed
        if self._room is not room:
            await asyncio.to_thread(self._stream_host.stop)
            if sink:
                self._release_game_sink()
            return ERROR_NO_ROOM
        online = room["where"] == "online"
        room["streams"] = stream_room.HostStreams(
            sunshine=self._stream_host, room_id=room["id"], online=online, meet=room["meet"], digest=room["digest"],
            ceiling=lambda: room["bitrate"], uhd=lambda: room["uhd"], debug=self._debug,
        )
        for index, seat in enumerate(room["seats"]):
            if index > 0 and seat is not None:
                room["streams"].seat_taken(index, seat["peer"] if seat["door"] == "lan" else "", seat["door"] == "server")
        if online and server is not None:
            self._spawn(room["streams"].measure(
                server, stream_room.CEILING_KBPS if room["uhd"] else stream_room.SPEED_CHECK_KBPS))
        return ""

    def _park_sunshine(self) -> None:
        self._sunshine_parked = True
        if self._park_task is not None:
            self._park_task.cancel()
        self._park_task = self._spawn(self._stop_parked_later())

    def _unpark(self) -> bool:
        parked, self._sunshine_parked = self._sunshine_parked, False
        if self._park_task is not None:
            self._park_task.cancel()
            self._park_task = None
        return parked

    async def _stop_parked_later(self) -> None:
        await asyncio.sleep(PARK_UNPAIR_AGAIN_SECONDS)
        async with self._lock:
            if self._sunshine_parked and not await asyncio.to_thread(self._stream_host.unpair_quietly):
                self._sunshine_parked = False
                self._park_task = None
                await asyncio.to_thread(self._stream_host.stop)
                return
        await asyncio.sleep(max(0.0, SUNSHINE_PARK_SECONDS - PARK_UNPAIR_AGAIN_SECONDS))
        async with self._lock:
            room = self._room
            if not self._sunshine_parked or (room is not None and room["mode"] == "stream"):
                return
            self._sunshine_parked = False
            self._park_task = None
            decky.logger.info("stream: the room left Stream Play %ss ago, stopping Sunshine", SUNSHINE_PARK_SECONDS)
            await asyncio.to_thread(self._stream_host.stop)

    async def stop_parked_for_game(self) -> None:
        async with self._lock:
            room = self._room
            if not self._sunshine_parked or self._stream_host is None or (room is not None and room["mode"] == "stream"):
                return
            self._unpark()
            decky.logger.info("stream: a game started, stopping the idle Sunshine")
            await asyncio.to_thread(self._stream_host.stop)

    async def _stop_parked(self) -> None:
        if self._unpark() and self._stream_host is not None:
            decky.logger.info("stream: stopping the idle Sunshine before the round")
            await asyncio.to_thread(self._stream_host.stop)

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
        self._pipes_seat_gone(room, seat)
        self._voice_forget(room, seat)
        self._turn_forget(room, seat, dropped.get("ulid", ""))
        room["notice"] = None
        self._games_seat_left(room, seat)
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
        if room.get("streams") is not None:
            room["streams"].close()
            self._release_game_sink()
        if room.get("pipes") is not None:
            room["pipes"].close()
        parked = self._unpark()
        if (room["mode"] == "stream" or parked) and self._stream_host is not None:
            self._stop_sunshine()
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

    def _end_moonlight(self, stream) -> None:
        loop = self._loop
        if self._stopping or loop is None or loop.is_closed():
            stream.kill_moonlight()
            return
        self._spawn(asyncio.to_thread(stream.kill_moonlight))

    def _pipes_seat_gone(self, room: dict, index: int) -> None:
        if room.get("streams") is not None:
            room["streams"].seat_gone(index)
        if room.get("pipes") is not None:
            room["pipes"].seat_gone(index)

    def _slow_connection(self) -> bool:
        return bool(self._settings_store.load_config().get("mpStreamSlowConnection", False))

    def _accept_uhd(self) -> bool:
        return bool(self._settings_store.load_config().get("mpStreamAcceptUhd", False))

    def _full_4k(self) -> bool:
        return bool(self._settings_store.load_config().get("mpStreamFull4k", False))

    def _stream_overlay(self) -> bool:
        return bool(self._settings_store.load_config().get("mpStreamOverlay", False))

    def stream_pad_swap(self) -> dict:
        room = self._room
        current = self._session
        if room is None or room["mode"] != "stream" or current is None or current["exited"]:
            return {"ok": True, "swap": None, "done": True}
        pads = _virtual_pads(self._user_home)
        guests = [index for index, pad in enumerate(pads) if pad == SUNSHINE_PAD]
        if len(guests) > _sunshine_pads():
            return {"ok": True, "swap": None, "done": False}
        wanted = [index for index in range(len(pads)) if index not in guests] + guests
        for position, index in enumerate(wanted):
            if index != position:
                self._debug("stream: moving controller %s to %s so the host stays first", index, position)
                return {"ok": True, "swap": [index, position], "done": False}
        return {"ok": True, "swap": None, "done": False}

    def hosting_stream(self) -> bool:
        room = self._room
        return (room is not None and room["mode"] == "stream") or self._sunshine_parked

    def stream_round_running(self) -> bool:
        room, joined = self._room, self._joined
        if room is not None:
            return room["mode"] == "stream" and room["state"] != "lobby"
        if joined is None or joined["row"]["mode"] != "stream":
            return False
        status = joined["status"]
        return joined["launched"] or (status is not None and status["state"] != "lobby")

    def release_sunshine(self) -> None:
        if self.hosting_stream() and self._stream_host is not None:
            self._sunshine_parked = False
            self._stream_host.stop()

    def streaming_removed(self) -> None:
        room, joined = self._room, self._joined
        if room is not None and room.get("streams") is not None:
            room["streams"].forget_pairings()
        elif joined is not None and joined.get("stream") is not None:
            joined["stream"].forget_pairing()
            joined.update(local=None, can=False, reason="stream_not_set_up", detail={}, seatState="setup")
        self._announce()

    async def streaming_ready(self) -> None:
        room = self._room
        if room is None or room.get("streams") is None or room["state"] != "lobby" or self._stream_host is None \
                or await asyncio.to_thread(self._stream_host.unit_active):
            return
        decky.logger.info("stream: streaming is set up again, starting Sunshine for the room")
        failed = await self._sunshine_restart(room)
        if failed:
            decky.logger.warning("stream: Sunshine didn't start after setup (%s)", failed)

    def _stop_sunshine(self) -> None:
        loop = self._loop
        if self._stopping or loop is None or loop.is_closed():
            self._stream_host.stop()
            return
        self._spawn(asyncio.to_thread(self._stream_host.stop))

    def _cut_streams(self, room: dict) -> None:
        loop = self._loop
        if room.get("streams") is None or self._stream_host is None or self._stopping \
                or loop is None or loop.is_closed():
            return
        decky.logger.info("stream: the round is over, restarting Sunshine to end its streams")
        self._spawn(self._restart_sunshine(room))

    async def _restart_sunshine(self, room: dict) -> None:
        failed = await self._sunshine_restart(room)
        if failed and failed != "stream_not_set_up" and self._room is room:
            decky.logger.warning("stream: Sunshine didn't come back after the round (%s), trying once more", failed)
            await asyncio.sleep(SUNSHINE_RETRY_SECONDS)
            failed = await self._sunshine_restart(room)
        if failed and self._room is room:
            decky.logger.warning("stream: Sunshine didn't come back after the round (%s)", failed)
            if failed != "stream_not_set_up":
                self._emit({"state": "sunshine_down"})

    async def _sunshine_restart(self, room: dict) -> str:
        try:
            return await asyncio.to_thread(self._stream_host.restart, lambda: self._room is room)
        except Exception as e:
            decky.logger.warning("stream: restarting Sunshine failed (%s)", type(e).__name__)
            return "sunshine_failed"

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
            "adapter": room["adapter"],
            "adapterAuto": room["tapAuto"],
            "checkFrames": room["checkFrames"],
            "bitrate": room["bitrate"],
            "uhd": room["uhd"],
            "adapterShown": bool(room["tapAuto"]) and room["max"] > 2
                and (room["mode"] == "stream" or (room["mode"] == "couch" and not room["watch"])),
            "voice": room["voice"],
            "steadyWifi": room["steadyWifi"],
            "locked": room["locked"],
            "hostState": room["hostState"],
            "hostGate": room["hostGate"],
            "hostDetail": dict(room["hostDetail"]),
            "max": room["max"],
            "seats": [
                None if seat is None
                else {"name": seat["name"], "launched": False, "ready": False, "can": not room["hostState"],
                      "seatState": room["hostState"], "title": room["title"],
                      "ulid": seat.get("ulid", ""), "pic": seat.get("pic", ""), "rank": self._rank(),
                      "model": seat["model"], "pads": self._pads}
                if index == 0
                else {"name": seat["name"], "launched": seat["launched"], "ready": self._seat_shown_ready(room, index, seat),
                      "can": seat["can"], "reason": seat["reason"], "seatState": seat["seatState"], "title": seat["title"],
                      "ulid": seat["ulid"], "pic": seat["pic"], "rank": seat.get("rank"), "model": seat["model"],
                      "pads": seat["pads"], "st": room["streams"].seat_state(index) if room.get("streams") is not None else ""}
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
            "vote": lounge.vote_view(room["vote"], lounge.voter_key(room["seats"][0])),
            "lounge": lounge.lounge_view(room["lounge"]),
        }

    def _public_state(self, room: dict) -> str:
        if room["state"] == "lobby":
            return "lobby"
        current = self._session
        if current is None or not current["seen"]:
            return "starting"
        if room["mode"] == "stream":
            return "playing"
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
                self._steady_sweep()
                self._round_saves_sweep()
        finally:
            self._stop_rmg_server(room["id"], wait=False)

    def _free_seat(self, room: dict, index: int, seat: dict) -> None:
        room["freed"][index] = seat["key"]
        room["seats"][index] = None
        self._host_tunnels.close_seat(index)
        self._pipes_seat_gone(room, index)
        self._voice_forget(room, index)
        self._turn_forget(room, index, seat.get("ulid", ""))
        self._games_seat_left(room, index)
        self._roster_left(room, index)

    def _tidy(self, room: dict) -> None:
        now = time.monotonic()
        for index, seat in enumerate(room["seats"]):
            if index == 0 or seat is None or (seat.get("launched") and room["state"] != "lobby"):
                continue
            if _boot_clock() - seat["last"] > SEAT_FREE_SECONDS:
                decky.logger.info("multiplayer: seat %s went quiet, freed", index)
                self._free_seat(room, index, seat)
                self._toast_seat(seat["name"], "Left Room", "{{name}} left.")

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
                self._drop_unlaunched(current)
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
            title_key="Play Together",
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
        self._check_upload_for_uhd(room)
        self._cut_streams(room)
        self._close_host_tunnels()
        self._announce()

    def _check_upload_for_uhd(self, room: dict) -> None:
        streams = room.get("streams")
        if not room["uhd"] or room["where"] != "online" or streams is None or room["state"] != "lobby":
            return
        loop = self._loop

        def start() -> None:
            self._spawn(streams.measure(self._lobby_server(), stream_room.CEILING_KBPS))

        try:
            on_loop = asyncio.get_running_loop() is loop
        except RuntimeError:
            on_loop = False
        if on_loop:
            start()
        elif loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(start)

    def _close_host_tunnels(self) -> None:
        loop = self._loop
        try:
            on_loop = asyncio.get_running_loop() is loop
        except RuntimeError:
            on_loop = False
        if on_loop:
            self._host_tunnels.close()
        elif loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._host_tunnels.close)

    def launch_started(self) -> dict:
        current = self._session
        if current is None or current["started"]:
            return {"ok": False, "error": ERROR_NOT_READY}
        room = self._room
        if room is not None and room["state"] == "lobby":
            self._drop_unlaunched(current)
            return {"ok": False, "error": ERROR_NO_GUESTS}
        current["started"] = time.monotonic()
        current["startedAt"] = time.time()
        joined = self._joined
        if room is not None:
            current["steadyWifi"] = room["steadyWifi"]
        elif joined is not None and not joined["launched"]:
            status = joined["status"]
            current["steadyWifi"] = (status["room"] if status is not None else joined["row"])["steadyWifi"]
        self._write_round_state(current)
        current["watch"] = self._spawn(self._watch(current))
        game_id = current.get("gameId", 0)
        if room is not None:
            decky.logger.info("multiplayer: host launched with %s guests", len(room["roster"]))
            self._steady_start(current["steadyWifi"])
            pads = _virtual_pads(self._user_home)
            if pads and pads[0] == SUNSHINE_PAD and not _sunshine_pads():
                decky.logger.warning("multiplayer: Steam's controller list starts with a Stream Play guest who "
                                     "isn't connected, so the host's controller may have the wrong name in game")
            self._count_host_round(room)
            return {"ok": True, "gameId": game_id}
        if joined is not None and not joined["launched"]:
            joined["launched"] = True
            status = joined["status"]
            self._steady_start(current["steadyWifi"])
            if status is not None:
                joined["launchedRound"] = status["round"]
            if status is not None and joined["countedRound"] != status["round"]:
                joined["countedRound"] = status["round"]
                watching = joined["row"]["watch"] and (
                    current["mode"] == "stream" or (current["mode"] == "couch" and current["emulator"] == "retroarch"))
                self._count_round(current["mode"], sum(1 for name in status["members"] if name) > 1,
                                  all(status["members"]), watching)
            self._spawn(self._ask(joined, "launched"))
            if joined.get("stream") is not None:
                self._spawn(self._unmute_moonlight())
            decky.logger.info("multiplayer: joined game launched")
            self._announce()
        return {"ok": True, "gameId": game_id}

    def _heard(self, transport, data, addr) -> None:
        room = self._room
        if room is None:
            return
        message = decode(data)
        nonce = proto.read_seek(message)
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
            if proto.too_old(opening) and opening.get("op") in ("info", "join"):
                await conversation.say({"ok": False, "error": "update_required"})
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
        returning = [index for index, taken in enumerate(room["seats"])
                     if index > 0 and taken is not None and taken["device"] == params["device"]
                     and taken["ulid"] == params["ulid"] and taken["name"].lower() == params["user"].lower()]
        if room["locked"] and invite is None and not returning:
            await conversation.say({"ok": False, "error": "room_locked"})
            return
        for index in returning:
            decky.logger.info("multiplayer: seat %s joined again from the same device, its old seat freed", index)
            self._free_seat(room, index, room["seats"][index])
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
            "rank": params["rank"],
            "model": params["model"],
            "pads": 0,
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
            "seatState": "",
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
        if room.get("streams") is not None:
            room["streams"].seat_taken(seat, peer if door == "lan" else "", door == "server")
        if invite is not None:
            room["passesUsed"].add(invite)
        await conversation.say({"ok": True, "seat": seat, "ip": address, "now": int(time.time()),
                                "t": proto.joined_tag(key, nc, ns, seat, address, ga, gb)})
        decky.logger.info("multiplayer: seat %s taken%s", seat, " through the online lobby" if door == "server" else "")
        self._announce()
        toast_keys = [params["device"] if door == "server" else peer, "name:" + params["user"].lower()]
        for stale in [name for name, at in self._join_toasts.items() if now - at >= JOIN_TOAST_SECONDS]:
            del self._join_toasts[stale]
        if all(key not in self._join_toasts for key in toast_keys):
            for key in toast_keys:
                self._join_toasts[key] = now
            self._toast_seat(params["user"], "Joined Room", "{{name}} joined.")

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

    def _game_port_open(self, room: dict, index: int, kind: str, port: int) -> bool:
        seat = room["seats"][index] if index < room["max"] else None
        if seat is None or seat["door"] != "server" or room["state"] == "lobby" or index not in room["roster"]:
            return False
        if room["emulator"] == "rmg":
            return room.get("rmgRound") == room["round"] and port in (RMG_TCP_PORTS if kind == "tcp" else RMG_UDP_PORTS)
        return (kind, port) in proto.tunnel_ports(room["mode"], room["emulator"], room["core"])

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
            sent = self._friend_sent.get(seat.get("ulid", ""))
            if sent is not None and sent[0] <= proto.inbox_since(message.get("p")):
                sent[1] = True
            room["seats"][index] = None
            self._host_tunnels.close_seat(index)
            self._pipes_seat_gone(room, index)
            self._voice_forget(room, index)
            self._turn_forget(room, index, seat.get("ulid", ""))
            decky.logger.info("multiplayer: seat %s left", index)
            await conversation.say({"ok": True})
            self._toast_seat(seat["name"], "Left Room", "{{name}} left.")
            self._games_seat_left(room, index)
            self._roster_left(room, index)
            self._announce()
            return
        self._take_report(room, index, seat, proto.read_report(message.get("p")))
        seat["since"] = proto.chat_since(message.get("p"))
        delivered = proto.inbox_since(message.get("p"))
        seat["inbox"] = [item for item in seat["inbox"] if item["seq"] > delivered]
        sent = self._friend_sent.get(seat["ulid"])
        if sent is not None and sent[0] <= delivered:
            sent[1] = True
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
        if op in ("vote", "lounge"):
            error = self._seat_press(room, index, seat, op, message.get("p"))
            if error:
                await conversation.say({"ok": False, "error": error})
                return
        if op == "launched":
            decky.logger.info("multiplayer: seat %s launched", index)
            if room["state"] != "lobby":
                self._count_host_round(room)
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
        if asked["act"] != "got" and asked["n"]:
            key = proto.unwrap(seat["key"], "pair", asked["n"], asked["k"])
        if asked["act"] == "ask" and key is None:
            return False
        if asked["to"] == 0:
            if asked["act"] == "ask":
                return friends.local_request(seat["ulid"], seat["name"], seat["pic"], key)
            if asked["act"] == "got":
                return friends.local_got(seat["ulid"], asked["ok"])
            return friends.local_answer(seat["ulid"], asked["act"] == "accept", seat["name"], seat["pic"], key)
        target = room["seats"][asked["to"]] if asked["to"] < room["max"] else None
        if target is None or not target["ulid"]:
            return False
        self._push_inbox(room, target, index, asked["act"], key, asked["ok"])
        return True

    def _push_inbox(self, room: dict, target: dict, sender: int, act: str, key, ok: bool = False) -> int:
        room["inboxSeq"] += 1
        item = {"seq": room["inboxSeq"], "from": sender, "ulid": room["seats"][sender].get("ulid", ""), "act": act}
        if act == "got":
            item["ok"] = ok
        if key is not None:
            item["n"] = secrets.token_hex(16)
            item["k"] = proto.wrap(target["key"], "pair", item["n"], key)
        target["inbox"] = (target["inbox"] + [item])[-proto.INBOX_MAX:]
        return item["seq"]

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
            joined["fastUntil"] = max(joined["fastUntil"], time.monotonic() + VOICE_FAST_SECONDS)
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
        joined["fastUntil"] = max(joined["fastUntil"], time.monotonic() + VOICE_FAST_SECONDS)
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
        relay = self._voice_relay
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
            due = any(_turn_due(cred, now) for cred in room["turn"].values())
            kept = {} if due else dict(room["turn"])
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
        if not room["private"] and not (room["locked"] and not room["friends"]):
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
        if item["act"] == "got":
            friends.local_got(ulid, item["ok"])
            return
        key = proto.unwrap(joined["key"], "pair", item["n"], item["k"]) if item["n"] else None
        if item["act"] == "ask":
            if key is not None:
                friends.local_request(ulid, name, pic, key)
            return
        found = friends.local_answer(ulid, item["act"] == "accept", name, pic, key)
        self._spawn(self.send_friend(sender, "got", ok=bool(found)))

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

    def friend_confirms(self, index: int) -> bool:
        return self._room is None and self._joined is not None and index == 0

    def friend_taken(self, ulid: str):
        if self._room is None:
            return None
        sent = self._friend_sent.get(ulid)
        return None if sent is None else sent[1]

    async def send_friend(self, index: int, act: str, key=None, ok: bool = False):
        room = self._room
        if room is not None:
            target = room["seats"][index] if 0 < index < room["max"] else None
            if target is None or not target["ulid"]:
                return False
            seq = self._push_inbox(room, target, 0, act, key, ok)
            if act != "got":
                self._friend_sent[target["ulid"]] = [seq, False]
            return True
        joined = self._joined
        if joined is None or index == joined["seat"]:
            return False
        extra = {"act": act, "to": index}
        if act == "got":
            extra["ok"] = ok
        if key is not None:
            extra["n"] = secrets.token_hex(16)
            extra["k"] = proto.wrap(joined["key"], "pair", extra["n"], key)
        _nonce, reply = await self._ask(joined, "friend", extra)
        if not isinstance(reply, dict):
            return None
        return reply.get("ok") is True

    async def invite_pass(self, ulid: str):
        room = self._room
        if room is not None:
            signed = room["private"] or room["locked"]
            expires = proto.pass_expiry(time.time()) if signed else 0
            key = proto.pass_key(room["key"], room["id"], ulid, expires) if signed else None
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
        if reply["exp"] > 0:
            key = proto.unwrap(joined["key"], "pass", nonce, reply.get("k"))
            if key is None:
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
                    title=report["title"], launched=report["launched"], seatState=report["seatState"],
                    rank=report["rank"], pads=report["pads"])
        if room.get("streams") is not None:
            room["streams"].report(index, report["st"], report["kb"], report["uhd"])
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
        if room["state"] != "lobby" or room["hostState"] or self._in_game():
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
            "models": "".join(taken["model"] if taken else "-" for taken in room["seats"]),
            "pads": [self._seat_pads(position, taken) for position, taken in enumerate(room["seats"])],
            "hardcore": room["hardcore"],
            "ip": seat["ip"],
            "chatTop": room["chatSeq"],
            "rev": room["rev"],
            "round": room["round"],
            "start": index in roster,
            "port": room["ports"].get(index, 0) if room["state"] != "lobby" else 0,
            "players": room["players"] if room["state"] != "lobby" else self._players(room["mode"], room),
            "adapter": self._room_tap(room),
            "seats": [
                {"ready": False, "can": True, "launched": False, "playing": False, "title": "",
                 "seatState": room["hostState"] if position == 0 else ""}
                if taken is None or position == 0
                else {"ready": self._seat_shown_ready(room, position, taken), "can": taken["can"], "launched": taken["launched"],
                      "playing": position in roster, "title": taken["title"], "seatState": taken["seatState"]}
                for position, taken in enumerate(room["seats"])
            ],
            "lastStart": dict(last) if last else None,
            "room": proto.status_room_fields(room),
            "chat": [],
            "ids": [{"ulid": taken.get("ulid", ""), "pic": taken.get("pic", ""),
                     "rank": self._rank() if position == 0 else taken.get("rank")}
                    if taken else {"ulid": "", "pic": "", "rank": None}
                    for position, taken in enumerate(room["seats"])],
            "inbox": list(seat["inbox"]),
            "vote": lounge.vote_view(room["vote"], lounge.voter_key(seat)),
            "lounge": lounge.lounge_view(room["lounge"]),
        }
        for position, taken in enumerate(room["seats"]):
            if taken is not None:
                body["seats"][position]["vc"] = taken.get("vc", False)
                body["seats"][position]["vs"] = taken.get("vstamp", 0)
        streams = room.get("streams")
        if streams is not None:
            for position, taken in enumerate(room["seats"]):
                if taken is not None and position > 0:
                    body["seats"][position]["st"] = streams.seat_state(position)
            body["stream"] = streams.body(index, seat["key"])
        pipes = room.get("pipes")
        if pipes is not None and seat["door"] == "server":
            if room["mode"] == "stream":
                pipes.seat_gone(index)
            else:
                body["pipe"] = pipes.body(index, seat["key"])
        if room.get("rmgRound"):
            body["rmg"] = room["rmgRound"]
        if room["uhd"] and room["mode"] == "stream":
            body["uhd"] = True
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

    async def start_round(self, screen: str = "") -> dict:
        room = self._room
        if room is not None and room["hostState"]:
            return self.start()
        if room is not None and room.get("streams") is not None:
            size = await asyncio.to_thread(self._stream_size, "host", screen)
            if size is not None:
                room["streams"].host_size = size
        if room is not None and room["mode"] == "stream" and room["state"] == "lobby" \
                and self._stream_host is not None and not await asyncio.to_thread(self._stream_host.unit_active):
            decky.logger.info("stream: Sunshine isn't running at the round's start, starting it")
            failed = await self._sunshine_restart(room)
            if failed:
                return {"ok": False, "error": failed}
        if room is not None and room["mode"] != "stream" and room["state"] == "lobby":
            await self._stop_parked()
        return self.start()

    def start(self) -> dict:
        room = self._room
        if room is None:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        if room["state"] != "lobby":
            return {"ok": False, "error": ERROR_NOT_LOBBY}
        if room["hostState"]:
            return {"ok": False, "error": ERROR_HOST_SETUP if room["hostState"] == "setup" else ERROR_HOST_NEVER}
        if room["switching"]:
            return {"ok": False, "error": ERROR_SWITCHING}
        if self._in_game():
            return {"ok": False, "error": ERROR_BUSY}
        drop_in = _drop_in(room)
        if not drop_in and not _guests(room):
            return {"ok": False, "error": ERROR_NO_GUESTS}
        if not self._can_start(room):
            return {"ok": False, "error": ERROR_NOBODY_READY}
        vote = room["vote"]
        if vote is not None and not vote["ended"]:
            vote.update(open=False, ended="started")
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
        if room["mode"] == "stream":
            try:
                if _seed_guest_slots(self._user_home, len(room["roster"])):
                    decky.logger.info("stream: wrote %s guest slots into Steam's controller list before the launch",
                                      len(room["roster"]))
            except OSError as e:
                decky.logger.warning("stream: couldn't write the guests' slots into Steam's controller list (%s)",
                                     type(e).__name__)
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
            self._drop_unlaunched(current)
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
        subnet = self._hotspot.broadcast_address() if self._hotspot is not None else ""
        return [self._broadcast, subnet] if subnet else [self._broadcast]

    async def discover(self, find: str = "") -> dict:
        refused = self._refusal()
        if refused is not None:
            return {"ok": False, "error": refused}
        server = self._lobby_server()
        if server is None:
            self._forget_page()
        elif self._listing is None or self._listing.done():
            if find:
                self._listing = self._spawn(self._list_online(server, "find", find))
            elif not self._online or self._round - self._page_round >= PAGE_RENEW_ROUNDS:
                self._listing = self._spawn(self._list_online(server, "renew"))
        found = await self._seek()
        if server is not None and self._listing is not None and not self._listing.done():
            await asyncio.wait({self._listing}, timeout=LIST_GRACE_SECONDS)
        self._round += 1
        self._take_lan(found)
        self._debug("discovery round %s found %s, %s online", self._round, len(found), len(self._online))
        return await self._rooms_reply()

    async def rooms_page(self, raw: dict, seek: bool = False) -> dict:
        refused = self._refusal()
        if refused is not None:
            return {"ok": False, "error": refused}
        self._page = _read_page(raw)
        self._page_gen += 1
        server = self._lobby_server()
        if server is None:
            self._forget_page()
            listing = None
        else:
            listing = self._listing = self._spawn(self._list_online(server, "page"))
        if seek:
            seeking = self._spawn(self._seek())
            if listing is not None:
                await asyncio.wait({listing}, timeout=SEEK_SECONDS)
                online = list(self._online.values())
                if listing.done() and online and self._room is None and self._joined is None:
                    await asyncio.to_thread(self._verdicts, online)
            found = await seeking
            self._round += 1
            self._take_lan(found)
            if listing is not None and not listing.done():
                await asyncio.wait({listing}, timeout=LIST_GRACE_SECONDS)
            return await self._rooms_reply()
        if listing is not None:
            await asyncio.wait({listing})
        return await self._rooms_reply()

    def _forget_page(self) -> None:
        self._online = {}
        self._online_error = ""
        self._page = NO_PAGE
        self._page_info = NO_PAGE_INFO
        self._page_gen += 1

    async def _seek(self) -> dict:
        nonce = secrets.token_hex(16)
        self._fresh_nonce(nonce, time.monotonic())
        return await self._collect(
            proto.make_seek(nonce, int(time.time()), self._identity()[0]),
            lambda message: proto.read_room(message, nonce),
        )

    def _take_lan(self, found: dict) -> None:
        own = self._room["id"] if self._room is not None else None
        for room_id, row in found.items():
            held = self._rooms.get(room_id)
            if held is not None and held[0]["door"] == "lan" and held[0]["address"] != row["address"] \
                    and (held[2] or self._round - held[1] < MISSED_ROUNDS):
                continue
            if room_id != own:
                self._rooms[room_id] = (row, self._round, False)
        for room_id, (row, seen, manual) in list(self._rooms.items()):
            if row["door"] != "server" and not manual and self._round - seen >= MISSED_ROUNDS:
                del self._rooms[room_id]

    async def _rooms_reply(self) -> dict:
        own = self._room["id"] if self._room is not None else None
        for room_id, (row, _seen, _manual) in list(self._rooms.items()):
            if row["door"] == "server" and room_id not in self._online:
                del self._rooms[room_id]
        online_kept = sum(1 for kept, _seen, _manual in self._rooms.values() if kept["door"] == "server")
        for room_id, row in self._online.items():
            held = self._rooms.get(room_id)
            if room_id == own or not (held is None or held[0]["door"] == "server" or self._prefer_server):
                continue
            if held is None or held[0]["door"] != "server":
                if online_kept >= ROOMS_KEPT_MAX:
                    continue
                online_kept += 1
            self._rooms[room_id] = (row, self._round, False)
        rows = self._room_rows()
        if rows and self._room is None and self._joined is None:
            verdicts = await asyncio.to_thread(self._verdicts, rows)
            have = await asyncio.to_thread(self._game_ids)
            for row in rows:
                row["verdict"] = verdicts[row["room"]]
                row["mine"] = row["mode"] == "stream" or row["gameId"] in have
        return {"ok": True, "rooms": rows, "total": self._page_info["total"], "next": self._page_info["next"],
                "checkHere": self._page_info["checkHere"], "size": lobby_client.PAGE_ROOMS,
                "onlineError": self._online_error}

    async def _list_online(self, server, mode: str, find: str = "") -> None:
        generation = self._page_gen
        page = self._page
        self._page_round = self._round
        try:
            try:
                listing = await self._page_listing(server, page, find)
            except asyncio.IncompleteReadError:
                if mode != "page":
                    raise
                await asyncio.sleep(PAGE_RETRY_SECONDS)
                if generation != self._page_gen:
                    return
                listing = await self._page_listing(server, page, find)
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError,
                lobby_client.UpdateRequired) as e:
            if generation != self._page_gen or (mode != "page" and self._online):
                return
            update = isinstance(e, lobby_client.UpdateRequired)
            if not self._online_error:
                decky.logger.info("multiplayer: couldn't reach the online lobby (%s)", type(e).__name__)
            self._online = {}
            self._online_error = "update_required" if update else "unreachable"
            self._page_info = NO_PAGE_INFO
            return
        if generation != self._page_gen:
            return
        online = {}
        for body, away in listing["rooms"]:
            row = proto.read_room(body)
            if row is not None and row["where"] == "online":
                row.update(address="", door="server", away=away)
                online[row["room"]] = row
        if mode == "find":
            self._online.update(online)
        elif mode == "renew" and self._online:
            for room_id in self._online:
                if room_id in online:
                    self._online[room_id] = online[room_id]
        else:
            self._online = online
            self._page_info = {"total": listing["total"], "next": listing["next"],
                               "checkHere": listing.get("checkHere", False)}
        self._online_error = ""

    async def _page_listing(self, server, page: dict, find: str) -> dict:
        ulid = self._identity()[0]
        if find:
            return {**await lobby_client.list_rooms(server, ulid, page={"size": 1, "room": find})}
        if page["where"] == "local":
            return {"rooms": [], "ids": [], "total": 0, "next": None}
        games = None
        if page["mine"]:
            census = await lobby_client.list_rooms(server, ulid, census=_wire_filters(page))
            if census["total"] == 0:
                return {"rooms": [], "ids": [], "total": 0, "next": None}
            have = await asyncio.to_thread(self._game_ids)
            games = sorted(set(census["ids"]) & have)
            if len(",".join(str(game) for game in games)) > GAMES_BYTES_MAX:
                listing = await lobby_client.list_rooms(server, ulid, page=_wire_page(page, None))
                return {**listing, "checkHere": True}
        return {**await lobby_client.list_rooms(server, ulid, page=_wire_page(page, games))}

    def _game_ids(self) -> set:
        return set(self._library() or {})

    def _verdicts(self, rows: list) -> dict:
        with self._verdict_lock:
            return self._verdicts_held(rows)

    @_in_one_pass
    def _verdicts_held(self, rows: list) -> dict:
        self._library()
        stamp = (self._cheevo_check_store.results_fingerprint(), self._cheevo_check_store.picked_fingerprint(),
                 self._library_cache[0], self._emulators.changed if self._emulators is not None else 0)
        if len(self._verdict_memo) > VERDICTS_HELD:
            self._verdict_memo.clear()
        found = {}
        for row in rows:
            key = (json.dumps(row, sort_keys=True, separators=(",", ":")), stamp)
            verdict = self._verdict_memo.get(key)
            if verdict is None or not verdict["can"]:
                local, reason, detail = self._decide(row, 0, "")
                verdict = {"can": local is not None, "reason": reason, "detail": detail,
                           **self._gate_answer(reason, detail, row["mode"], row["gameId"], row)}
                self._verdict_memo[key] = verdict
            found[row["room"]] = verdict
        return found

    def _room_rows(self) -> list:
        rows = [dict(row) for row, _seen, _manual in self._rooms.values()
                if not row["friends"] or self._friend_pair(row["owner"]) is not None]
        local = sorted((row for row in rows if row["door"] != "server"), key=lambda row: (row["locked"], row["user"].lower(), row["room"]))
        online = [row for row in rows if row["door"] == "server"]
        order = {room_id: index for index, room_id in enumerate(self._online)}
        online.sort(key=lambda row: order.get(row["room"], len(order)))
        return local + online

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
            reply = await asyncio.wait_for(read_frame(reader), HANDSHAKE_SECONDS)
            row = proto.read_room(reply)
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError):
            reply = row = None
        finally:
            writer.close()
        if row is None and isinstance(reply, dict) and reply.get("error") == "update_required":
            return {"ok": False, "error": ERROR_UPDATE_REQUIRED}
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
            local, reason, detail, seat_state = await asyncio.to_thread(self._verdict, {"row": row, "own": 0, "core": ""})
            digest = await asyncio.to_thread(self._hash_of_path, local, local["systemId"]) \
                if local and row["mode"] != "stream" else ""
            crc = await asyncio.to_thread(self._crc_of, local["real"]) \
                if local and row["mode"] == "couch" and local["emulator"] == "retroarch" else ""
            params = proto.join_params(
                self._user(),
                digest,
                crc,
                local["core"] if local else "",
                local["emuVersion"] if local else "",
                self._device_id(),
                *self._identity(),
                self._model,
                rank=self._rank(),
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
            online = row["door"] == "server"
            meet = await asyncio.to_thread(stream_room.resolve_meet, self._lobby_server()) if online else None
            output = await asyncio.to_thread(self._output_size)
            big_screen = output is not None and output[1] > stream_room.STREAM_HEIGHT_MAX
            self._joined = {
                "row": row,
                "seat": answer["seat"],
                "ip": "127.0.0.1" if row["door"] == "server" else row["address"],
                "ownIp": answer["ownIp"],
                "key": answer["key"],
                "skew": answer["skew"],
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
                "seatState": seat_state,
                "own": 0,
                "core": "",
                "rowRev": 0,
                "changed": self._emulators.changed if self._emulators is not None else 0,
                "hardcore": bool(hardcore),
                "uhd": self._accept_uhd(),
                "bigScreen": big_screen,
                "seq": 0,
                "said": None,
                "ready": False,
                "readyRev": 0,
                "readyRound": 0,
                "consentRound": 0,
                "fanfareRound": 0,
                "autostartRound": 0,
                "launchedRound": 0,
                "retryRound": 0,
                "cutRound": 0,
                "hostLeftRound": 0,
                "notice": "",
                "clock": (time.time(), time.monotonic()),
                "chat": [],
                "chatSince": 0,
                "chatBacklog": -1,
                "fsince": 0,
                "vc": False,
                "vsince": 0,
                "fastUntil": 0.0,
                "games": None,
                "asking": asyncio.Lock(),
                "turn": None,
                "turnSeq": 0,
                "meet": meet,
                "gpipe": None,
                "countedRound": 0,
                "countedVote": 0,
                "countedMatches": {},
            }
            if row["mode"] == "stream" and self._stream_setup is not None:
                self._joined["stream"] = stream_room.GuestStream(
                    user_home=self._user_home, config=self._stream_setup.moonlight_config(), room_id=row["room"],
                    seat=answer["seat"], online=online, meet=meet, host_ip=row["address"], debug=self._debug,
                )
            self._tell_voice_room()
            self._closed_reason = ""
            self._poller = self._spawn(self._poll(self._joined))
            decky.logger.info("multiplayer: joined a room, seat %s%s", answer["seat"],
                              " through the online lobby" if row["door"] == "server" else "")
            self._announce()
            self._count("pt_join")
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
            if hello.get("op") == "update_required":
                return {"ok": False, "error": ERROR_UPDATE_REQUIRED}
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
            or type(answer.get("now")) is not int
            or not verify(key, answer.get("t"), "joined", nc, ns, str(seat), address, ga, gb)
        ):
            return {"ok": False, "error": ERROR_HOST_GONE}
        shared = await asyncio.to_thread(proto.dh_shared, private, other)
        skew = answer["now"] - int(time.time())
        if abs(skew) > SKEW_LOG_SECONDS:
            decky.logger.info("multiplayer: this device's clock is %s s off the host's, following the host's", skew)
        return {"ok": True, "seat": seat, "ip": address, "ownIp": own, "key": proto.seat_key(key, nc, ns, shared),
                "skew": skew}

    async def _poll(self, joined: dict) -> None:
        while self._joined is joined:
            try:
                answered = await self._poll_once(joined)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                decky.logger.warning("multiplayer: a status poll failed (%s)", type(e).__name__)
                answered = False
            self._steady_sweep()
            self._round_saves_sweep()
            if not answered:
                await asyncio.sleep(POLL_BACKOFF_SECONDS)
            elif time.monotonic() < joined["fastUntil"] or _in_lounge_match(joined["status"], joined["seat"]):
                await asyncio.sleep(VOICE_POLL_SECONDS)
            else:
                await asyncio.sleep(POLL_SECONDS)

    async def _poll_once(self, joined: dict) -> bool:
        async with joined["asking"]:
            return await self._poll_status(joined)

    async def _poll_status(self, joined: dict) -> bool:
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
        await self._apply_status(joined, status)
        return True

    async def _apply_status(self, joined: dict, status: dict) -> None:
        if status["rev"] != joined["rowRev"]:
            before, readied_on = joined["row"], joined["rowRev"]
            decided = await self._follow_room(joined, status)
            if self._joined is not joined:
                return
            if (decided and joined["ready"] and joined["can"] and before["hostState"]
                    and status["state"] == "lobby"
                    and joined["readyRev"] == readied_on and joined["readyRound"] == status["round"]
                    and (before["mode"], before["gameId"]) == (joined["row"]["mode"], joined["row"]["gameId"])):
                joined["readyRev"] = status["rev"]
                self._spawn(self._push_ready(joined))
        self._take_status(joined, status)

    async def _follow_room(self, joined: dict, status: dict) -> bool:
        row = {**status["room"], "address": joined["row"]["address"], "door": joined["row"]["door"], "away": False}
        rev = status["rev"]
        if (row["mode"], row["gameId"]) != (joined["row"]["mode"], joined["row"]["gameId"]):
            joined.update(own=0, core="")
        stream = joined.get("stream")
        if row["mode"] == "stream" and stream is None and self._stream_setup is not None:
            joined["stream"] = stream_room.GuestStream(
                user_home=self._user_home, config=self._stream_setup.moonlight_config(), room_id=row["room"],
                seat=joined["seat"], online=row["door"] == "server", meet=joined["meet"], host_ip=row["address"],
                debug=self._debug,
            )
            decky.logger.info("stream: the room switched to Stream, getting ready to pair")
        elif row["mode"] != "stream" and stream is not None:
            stream.close()
            joined["stream"] = None
        joined["row"] = row
        joined["rowRev"] = rev
        own = joined["own"]
        local, reason, detail, state = await asyncio.to_thread(self._verdict, joined)
        if self._joined is not joined or joined["rowRev"] != rev or joined["own"] != own:
            return False
        joined.update(local=local, can=local is not None, reason=reason, detail=detail, seatState=state)
        self._debug("the room changed, this seat %s", "can play" if local is not None else f"can't ({reason})")
        return True

    def _take_game_pipe(self, joined: dict, status: dict) -> None:
        raw = status["pipe"]
        current = joined["gpipe"]
        if current is not None and (raw is None or raw["occ"] != current.occ):
            current.close()
            joined["gpipe"] = current = None
        if (raw is None or joined["row"]["door"] != "server" or joined["launched"]
                or self._guest_tunnels is not None or joined["meet"] is None):
            return
        if current is not None and (not current.dead
                                    or time.monotonic() - current.opened_at < game_pipes.RETRY_SECONDS):
            return
        joined["gpipe"] = game_pipes.GuestPipe(
            room_id=joined["row"]["room"], seat=joined["seat"], meet=joined["meet"], occ=raw["occ"],
            tcp_ports=PIPE_TCP_PORTS, udp_ports=PIPE_UDP_PORTS, debug=self._debug,
        )
        joined["gpipe"].take(raw, joined["key"])

    def _take_status(self, joined: dict, status: dict) -> None:
        joined["status"] = status
        self._take_game_pipe(joined, status)
        stream = joined.get("stream")
        if stream is not None:
            if self._stream_setup is None or self._stream_setup.moonlight_present():
                stream.take(status["stream"], joined["key"], not joined["launched"])
            if joined["launched"] and (status["state"] == "lobby" or status["round"] != joined["launchedRound"]):
                if joined["cutRound"] != joined["launchedRound"]:
                    joined["cutRound"] = joined["launchedRound"]
                    decky.logger.info("stream: the host's round is over, closing Moonlight")
                self._end_moonlight(stream)
        if (joined["launched"]
                and (status["state"] == "lobby" or status["round"] != joined["launchedRound"])
                and joined["hostLeftRound"] != joined["launchedRound"]):
            joined["hostLeftRound"] = joined["launchedRound"]
            couch = joined["row"]["mode"] == "couch"
            decky.logger.info("multiplayer: the host's round is over while this guest is still in it")
            emit_notification(
                ntype="system",
                settings_store=self._settings_store,
                event_loop=self._loop,
                title_key="Host Left Game" if couch else "Host Quit Game",
                line_key="Host has left the game" if couch else "Host has quit the game",
                force_toast=True,
                dnd_exempt=True,
            )
        for item in status["inbox"]:
            if item["seq"] > joined["fsince"]:
                joined["fsince"] = item["seq"]
                self._inbox_item(joined, status, item)
        allowed = status["room"]["voice"]
        if allowed != joined["row"]["voice"]:
            joined["row"] = {**joined["row"], "voice": allowed}
        if status["room"]["locked"] != joined["row"]["locked"]:
            joined["row"] = {**joined["row"], "locked": status["room"]["locked"]}
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
            joined["fastUntil"] = max(joined["fastUntil"], time.monotonic() + VOICE_FAST_SECONDS)
        self._count_guest_games(joined, status)
        games = (status["vote"], status["lounge"])
        if games != joined["games"]:
            if joined["games"] is not None:
                joined["fastUntil"] = max(joined["fastUntil"], time.monotonic() + GAMES_FAST_SECONDS)
            joined["games"] = games
        if joined["chatBacklog"] < 0:
            joined["chatBacklog"] = status["chatTop"]
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

    def _count_guest_games(self, joined: dict, status: dict) -> None:
        first = joined["games"] is None
        if first and any(index != joined["seat"] and self._friend_pair(entry["ulid"]) is not None
                         for index, entry in enumerate(status["ids"])):
            self._count("pt_join_friend")
        vote = status["vote"]
        if vote is not None and vote["ended"] == "won" and vote["id"] != joined["countedVote"]:
            joined["countedVote"] = vote["id"]
            if not first:
                self._count("pt_vote_won")
        counted = joined["countedMatches"]
        for game, board in status["lounge"].items():
            if not board["end"] or counted.get(game) == board["match"]:
                continue
            counted[game] = board["match"]
            if not first:
                self._count_lounge(game, board, joined["seat"])

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
            return _drop_in(joined["row"])
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
            or joined["launchedRound"] == status["round"] or joined["retryRound"] == status["round"]
            or status["state"] != "playing"
        ):
            return None
        return {"room": joined["row"]["room"], "round": status["round"], "appid": joined["local"]["appid"],
                "steps": _steps(joined["row"]), "game": joined["row"]["title"]}

    def _report(self, joined: dict) -> dict:
        local = joined["local"]
        reason = joined["reason"] if proto.is_reason(joined["reason"]) else "unsupported_emulator"
        rank = self._rank()
        said = (joined["ready"], joined["readyRev"], joined["readyRound"], joined["can"], reason,
                local["gameId"] if local else 0, local["title"] if local else "", joined["launched"], joined["hardcore"],
                joined["seatState"], rank, joined["uhd"], self._pads)
        if said != joined["said"]:
            joined["said"] = said
            joined["seq"] += 1
        stream = joined.get("stream")
        state = ""
        kb = 0
        if stream is not None:
            current = self._session
            state = stream.state(joined["launched"], current is not None and current["seen"])
            kb = stream.kbps if joined["launched"] else 0
            if (state, kb) != (joined.get("st", ""), joined.get("kb", 0)):
                joined["st"] = state
                joined["kb"] = kb
                joined["seq"] += 1
        return proto.report(
            seq=joined["seq"], ready=joined["ready"], rev=joined["readyRev"], round_=joined["readyRound"],
            can=joined["can"], reason=reason, game_id=local["gameId"] if local else 0,
            title=local["title"] if local else "", launched=joined["launched"], hardcore=joined["hardcore"],
            seat_state=joined["seatState"], st=state, kb=kb, rank=rank,
            uhd=joined["uhd"] and joined["row"]["mode"] == "stream", pads=self._pads,
        )

    @_in_one_pass
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
        local, reason, detail, state = await asyncio.to_thread(self._verdict, joined)
        if self._joined is not joined:
            return {"ok": False, "error": ERROR_NO_ROOM}
        if joined["own"] == game_id and joined["rowRev"] == rev:
            joined.update(local=local, can=local is not None, reason=reason, detail=detail, seatState=state,
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
            if (status is not None and status["state"] == "playing" and status["start"] and _drop_in(joined["row"])
                    and not joined["launched"] and joined["consentRound"] == status["round"]):
                joined["retryRound"] = status["round"]
            else:
                joined["consentRound"] = 0
            if reason and proto.is_reason(reason):
                joined["notice"] = reason
        joined["ready"] = bool(ready)
        self._spawn(self._push_ready(joined))
        self._announce()
        return {"ok": True, **self._guest_view(joined)}

    async def _push_ready(self, joined: dict) -> None:
        async with joined["asking"]:
            nonce, reply = await self._ask(joined, "ready")
            status = proto.read_status_reply(joined["key"], reply, nonce) if reply is not None else None
            if status is not None and self._joined is joined:
                await self._apply_status(joined, status)

    async def _ask(self, joined: dict, op: str, extra=None):
        nonce = secrets.token_hex(16)
        payload = {**self._report(joined), "since": joined["chatSince"], "fsince": joined["fsince"],
                   "vc": joined["vc"], "vsince": joined["vsince"], **(extra or {})}
        message = proto.make_tagged(joined["key"], op, joined["row"]["room"], joined["seat"], nonce,
                                    int(time.time()) + joined["skew"],
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
        if self._session is None:
            self._steady_end()
        self._closed_reason = reason
        self._close_guest_tunnels()
        if joined.get("gpipe") is not None:
            joined["gpipe"].close()
        if joined.get("stream") is not None:
            joined["stream"].close()
            self._end_moonlight(joined["stream"])
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
        if reason == ERROR_CLOSED:
            emit_notification(
                ntype="system",
                settings_store=self._settings_store,
                event_loop=self._loop,
                title_key="Room Closed",
                line_key="The host closed the room",
                force_toast=True,
                dnd_exempt=True,
                page="multiplayer",
            )

    def _guest_view(self, joined: dict) -> dict:
        status = joined["status"]
        return {
            "room": dict(joined["row"]),
            "seat": joined["seat"],
            "ip": joined["ip"],
            "status": {name: value for name, value in status.items()
                       if name not in ("inbox", "voice", "turn", "stream", "pipe")}
                      if status else None,
            "launched": joined["launched"],
            "error": joined["error"],
            "ready": joined["ready"],
            "consented": status is not None and joined["consentRound"] == status["round"] and status["start"],
            "streamBusy": joined.get("stream") is not None and joined["stream"].busy,
            "rejoin": status is not None and status["state"] == "playing" and status["start"]
                      and not joined["launched"] and self._may_launch(joined, status)
                      and (joined["launchedRound"] == status["round"] or joined["retryRound"] == status["round"]),
            "notice": joined["notice"],
            "hardcore": joined["hardcore"],
            "acceptUhd": joined["uhd"],
            "bigScreen": joined["bigScreen"],
            "local": _local_view(joined["local"]) if joined["local"] is not None else None,
            "can": joined["can"],
            "reason": joined["reason"],
            "detail": joined["detail"],
            "chat": list(joined["chat"]),
            "autostart": self._pending_start(joined),
            "hostVersion": _version_gap(joined["row"].get("pv", "")),
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

    def _write_remap(self, folder: Path, remap) -> Path:
        relative, text = remap
        path = folder / relative
        for level in (folder, path.parent):
            ensure_dir(level)
            chown_to_data_owner(level)
        self._write(path, text)
        return path

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

    def prepare_launch(self, original: str, hardcore: bool, screen: str = "", name: str = "") -> dict:
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
            self._drop_unlaunched(stale)
            self._close_guest_tunnels_soon()
        self._fresh_shortcuts()
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
            hardcore = room["hardcore"] if mode in ("couch", "stream") else bool(hardcore)
            share = room["share"]
            watch = room["watch"]
            check_frames = room["checkFrames"]
            adapter = self._room_tap(room)
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
            watch = joined["row"]["watch"]
            check_frames = session.DEFAULT_CHECK_FRAMES
            adapter = status.get("adapter", "")
            players = status["players"]
            peer = joined["row"]
            relay = self._relay_host() if joined["row"]["where"] == "online" else ""
        else:
            return {"ok": False, "error": ERROR_NO_ROOM}

        if self._rom_moved(local["gameId"], local.get("path")):
            game = (self._library() or {}).get(local["gameId"])
            entry = next((row for row in game["paths"] if row["path"] == local["path"]), None) if game else None
            if entry is not None:
                local["real"] = entry["real"]
        found, _warnings = self._gates(mode, local, peer, players)
        if found:
            return {"ok": False, "error": ERROR_GATE, "gate": found[0], "detail": found[1]}
        if held is not None and held["renamed"]:
            name = held["name"]
        if mode == "stream":
            return self._prepare_stream(role, local, original, held, screen, name)
        where = room["where"] if room is not None else joined["row"]["where"]
        if local["emulator"] == "rmg" and room is not None and where != "online" and not self._start_rmg_server(room):
            return {"ok": False, "error": ERROR_RMG_SERVER}
        if local["emulator"] == "rmg" and room is not None and where == "online":
            room["rmgRound"] = room["round"] if self._rmg_round_here(room) else 0
        rmg_here = local["emulator"] == "rmg" and where == "online" and (
            room["rmgRound"] == room["round"] if room is not None else status["rmg"] == status["round"])
        if held is not None:
            if held["appid"] != local["appid"]:
                return {"ok": False, "error": ERROR_BUSY}
            original = held["original"]

        relayed = joined is not None and room is None and joined["row"]["door"] == "server"
        if relayed:
            gpipe = joined["gpipe"]
            piped = gpipe is not None and gpipe.ready(game_pipes.LAUNCH_WAIT_SECONDS)
            if local["emulator"] == "rmg":
                if rmg_here and not piped:
                    decky.logger.warning("multiplayer: the host's N64 server is reached by a game pipe with no path")
                how = f"the host's server over the pipe ({gpipe.path if gpipe else 'none'})" if rmg_here \
                    else "the lobby's server"
            else:
                if not piped and not self._open_guest_tunnels(joined, mode, local):
                    return {"ok": False, "error": ERROR_TUNNEL}
                how = f"the pipe ({gpipe.path})" if piped else "the lobby tunnel"
            self._debug("game pipe: launching over %s", how)

        sid = secrets.token_hex(8)
        rom = Path(local["path"])
        nick = self._user()
        save_port = 0
        save_files = []
        save_dir = None
        owner, keep = "", False
        clock_held = False
        fill_path = None
        wii_nand = None
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
                remap_dir = self._session_dir / f"session-{sid}.remaps"
                guest = mode == "couch" and role == "guest"
                if not guest:
                    self._check_round_clock(local, ra, rom)
                owner, keep = self._clock_owner(local, ra, rom) if not guest else ("", False)
                if not guest and not owner and not keep:
                    owner = self._save_owner(local)
                if ((mode == "couch" and role == "host") or local["core"] in proto.NETPACKET_CORES or owner or keep) \
                        and not self._retroarch_saves_netplay():
                    save_port = _command_port()
                    save_files = ra.save_paths(local["core"], rom)
                    save_dir = self._round_folder(sid, local, ra, rom, original, owner, keep)
                    if save_dir is not None:
                        save_files = []
                if save_dir is None and owner and self._owner_save_ok(ra, local, local["core"]) \
                        and ra.save_paths(owner, rom) != ra.save_paths(local["core"], rom):
                    decky.logger.info("saves: %s's round can't reach %s's save, not starting it", local["title"],
                                      ra.core_name(owner))
                    if relayed:
                        self._close_guest_tunnels_soon()
                    return {"ok": False, "error": ERROR_GATE, "gate": "saves_by_core",
                            "detail": {"core": local["coreName"], "shortcutCore": ra.core_name(owner)}}
                if save_dir is None and not guest:
                    clock_held = self._hold_round_clock(local, ra, rom)
                    fill_path = ra.save_paths(local["core"], rom)[0]
                guest_dir = self._guest_save_folder(sid, local, ra, rom) if guest else None
                cfg_text, opt_text, remap = session.retroarch_session(
                    ra, core=local["core"], rom=rom, mode=mode, role=role, hardcore=hardcore, opt_path=opt_path,
                    guests=players - 1, seat=seat, host_ip=host_ip, players=players, game_code=local["gameCode"],
                    system_dir=system_dir, share_controls=share, watch_only=watch, remap_dir=remap_dir,
                    adapter=adapter, command_port=save_port, check_frames=check_frames, save_dir=save_dir or guest_dir,
                )
                if adapter and mode == "couch" and players > 2 and not watch:
                    decky.logger.info("multiplayer: %s plugs in %s for %s players", local["core"],
                                      TAP_NAMES[adapter], players)
                self._write(opt_path, opt_text)
                self._write(cfg_path, cfg_text)
                files = [cfg_path, opt_path]
                if remap is not None:
                    files.append(self._write_remap(remap_dir, remap))
                core_path = ra.core_path(local["core"]) if local["core"] != local["shortcutCore"] else None
                args = session.retroarch_args(mode=mode, role=role, host_ip=host_ip, nick=nick,
                                              cfg_path=cfg_path, core_path=core_path, core=local["core"],
                                              rom=rom if local.get("duckstation") or local["fallback"] else None)
            elif local["emulator"] == "dolphin":
                marker = self._session_dir / f"session-{sid}.dolphin"
                self._write(marker, "")
                files = [marker]
                if mode == "couch" and role == "host":
                    user_dir = session.dolphin_user_dir(self._user_home, local["install"])
                    config = session.dolphin_config(self._user_home, local["install"])
                    if user_dir is not None and config is not None:
                        wii_nand = {"user": user_dir, "config": config, "install": local["install"],
                                    "before": wii_saves.session_id(user_dir), "gameId": local["gameId"],
                                    "code": local["gameCode"]}
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
                if where != "online":
                    rmg_server = host_ip
                elif rmg_here:
                    rmg_server = "127.0.0.1" if room is not None else host_ip
                else:
                    rmg_server = self._relay_host()
                self._build_rmg_home(home, local, nick, rmg_server, rom)
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
            backup = None
            if self._backups is not None and not (mode == "couch" and role == "guest"):
                backup = self._backup_target(local, owner)
            if backup is not None:
                self._backups.back_up(backup, mode, "together")
            if fill_path is not None:
                self._fill_save(fill_path, local["core"], local["systemId"], local["title"])
            rename = _status_title(local["title"], name) if local["fallback"] else ""
            self._write_restore(local["appid"], original, sid, name=name, renamed=rename)
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't write the session files (%s)", type(e).__name__)
            if save_dir is not None:
                self._abandon_round_saves(sid)
            if clock_held:
                self._clock.put_back()
            if relayed:
                self._close_guest_tunnels_soon()
            return {"ok": False, "error": ERROR_WRITE_FAILED}

        self._apply_mapping(local, "play")
        self._session = {
            "id": sid,
            "appid": local["appid"],
            "gameId": local["gameId"],
            "role": role,
            "mode": mode,
            "emulator": local["emulator"],
            "files": files,
            "started": 0.0,
            "seen": False,
            "exited": False,
            "error": "",
            "watch": None,
            "savePort": save_port,
            "saveFiles": save_files,
            "roundSaves": save_dir is not None,
            "clockHeld": clock_held,
            "wiiNand": wii_nand,
            "backup": backup,
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
            "rename": rename,
            "name": name,
        }

    def _prepare_moonlight(self, local: dict, original: str, screen: str, name: str) -> dict:
        joined = self._joined
        stream = joined.get("stream") if joined is not None else None
        if stream is not None and stream.busy:
            return {"ok": False, "error": ERROR_GATE, "gate": "stream_busy", "detail": {}}
        if stream is not None and stream.ports_taken:
            return {"ok": False, "error": ERROR_GATE, "gate": "sunshine_running_guest", "detail": {}}
        if stream is not None:
            stream.wait_paired(PAIR_WAIT_SECONDS)
            if stream.paired and stream.unpaired_after_all():
                decky.logger.info("stream: Moonlight isn't paired with the host after all, pairing again")
                stream.forget_pairing()
                stream.wait_paired(PAIR_WAIT_SECONDS)
        if stream is None or not stream.paired:
            return {"ok": False, "error": ERROR_STREAM_UNREACHABLE}
        if stream.full:
            return {"ok": False, "error": ERROR_GATE, "gate": "host_too_slow", "detail": {}}
        status = joined["status"]
        if status is not None:
            stream.wait_turn(sum(1 for index, seat in enumerate(status["seats"])
                                 if 0 < index < joined["seat"] and seat["playing"]))
        size = self._stream_size("guest", screen) or (0, 0)
        joined["bigScreen"] = size[1] > stream_room.STREAM_HEIGHT_MAX
        if stream.uhd and self._full_4k():
            self._debug("stream: full 4K asked for in place of a %sx%s screen", *size)
            size = (3840, 2160)
        options = stream.launch_options(
            *size, self._slow_connection(), joined["row"]["watch"], overlay=self._stream_overlay(),
        )
        sid = secrets.token_hex(8)
        rename = _status_title(local["title"], name)
        try:
            ensure_dir(self._session_dir)
            chown_to_data_owner(self._session_dir)
            self._write_restore(local["appid"], original, sid, name=name, renamed=rename)
        except OSError as e:
            decky.logger.warning("stream: couldn't write the restore record (%s)", type(e).__name__)
            return {"ok": False, "error": ERROR_WRITE_FAILED}
        self._session = {
            "id": sid,
            "appid": local["appid"],
            "gameId": local["gameId"],
            "role": "guest",
            "mode": "stream",
            "emulator": "moonlight",
            "files": [],
            "started": 0.0,
            "seen": False,
            "exited": False,
            "error": "",
            "watch": None,
        }
        return {"ok": True, "appid": local["appid"], "options": options, "original": original, "session": sid,
                "rename": rename, "name": name}

    def _prepare_stream(self, role: str, local: dict, original: str, held, screen: str, name: str) -> dict:
        if held is not None:
            if held["appid"] != local["appid"]:
                return {"ok": False, "error": ERROR_BUSY}
            original = held["original"]
        if role == "guest":
            return self._prepare_moonlight(local, original, screen, name)
        route = local["route"]
        sid = secrets.token_hex(8)
        parts = []
        clock_held = False
        try:
            ensure_dir(self._session_dir)
            chown_to_data_owner(self._session_dir)
            if _route_args(route):
                parts.append(_route_args(route))
            room = self._room
            taps = local["emulator"] == "retroarch" and local["core"] in session.MULTITAP \
                and room is not None and room["max"] > 2
            shaders_off = local["emulator"] == "retroarch" and self._stream_shaders_off()
            game = (self._library() or {}).get(local["gameId"])
            owner, folder = self._launch_save(game, route, self._retroarch()) if game is not None else ("", None)
            if taps or shaders_off or folder is not None:
                ra = self._retroarch()
                rom = Path(local["path"])
                adapter = self._room_tap(room) if taps else ""
                devices = session.multitap(local["core"], adapter).get("devices", {}) if taps else {}
                if devices and (session.remap_port_conflict(ra, core=local["core"], rom=rom, devices=devices)
                                or ra.overriding_key(local["core"], rom, session.MULTITAP_CFG_KEYS)):
                    decky.logger.info("stream: %s's own remap or override sets its controller ports, no multiplayer "
                                      "adapter", local["core"])
                    taps = False
                if taps or shaders_off or folder is not None:
                    cfg_path = self._session_dir / f"session-{sid}.cfg"
                    opt_path = self._session_dir / f"session-{sid}.opt"
                    remap_dir = self._session_dir / f"session-{sid}.remaps"
                    cfg_text, opt_text, remap = session.stream_host_session(ra, core=local["core"], rom=rom,
                                                                            opt_path=opt_path, remap_dir=remap_dir,
                                                                            adapter=adapter, taps=taps,
                                                                            shaders_off=shaders_off, save_dir=folder)
                    files = [cfg_path]
                    if opt_text is not None:
                        self._write(opt_path, opt_text)
                        files.append(opt_path)
                    if remap is not None:
                        files.append(self._write_remap(remap_dir, remap))
                    self._write(cfg_path, cfg_text)
                    if not self._readable_by_owner(files):
                        raise OSError("session files are not the home owner's")
                    parts.insert(0, f"--appendconfig {session.quote(str(cfg_path))}")
                    if taps:
                        decky.logger.info("stream: %s gets its multiplayer adapter for %s seats%s", local["core"],
                                          room["max"], f" ({TAP_NAMES[adapter]})" if adapter else "")
                    if shaders_off:
                        decky.logger.info("stream: RetroArch starts with its shaders off for this session")
            clock_held = self._check_launch_clock(local["gameId"], route, "together")
            backup = self._backup_target(local, owner if owner != local["core"] else "") \
                if self._backups is not None else None
            if backup is not None:
                self._backups.back_up(backup, "stream", "together")
            self._fill_launch_save(local["gameId"], route)
            rename = _status_title(local["title"], name) if route["fallback"] else ""
            self._write_restore(local["appid"], original, sid, name=name, renamed=rename)
        except OSError as e:
            decky.logger.warning("stream: couldn't write the session files (%s)", type(e).__name__)
            if clock_held:
                self._clock.put_back()
            return {"ok": False, "error": ERROR_WRITE_FAILED}
        self._apply_mapping(local, "stream")
        self._session = {
            "id": sid,
            "appid": local["appid"],
            "gameId": local["gameId"],
            "role": role,
            "mode": "stream",
            "emulator": local["emulator"],
            "backup": backup,
            "clockHeld": clock_held,
            "files": [],
            "started": 0.0,
            "seen": False,
            "exited": False,
            "error": "",
            "watch": None,
        }
        decky.logger.info("stream: session %s ready as %s", sid, role)
        return {
            "ok": True,
            "appid": local["appid"],
            "options": session.compose_launch_options(original, " ".join(parts)) if parts else original,
            "original": original,
            "session": sid,
            "rename": rename,
            "name": name,
        }

    def _rmg_round_here(self, room: dict) -> bool:
        pipes = room.get("pipes")
        seats = [room["seats"][index] for index in room["roster"]]
        if pipes is None or not seats or any(seat is None or seat["door"] != "server" for seat in seats):
            self._debug("game pipe: N64 round on the lobby's server, not every guest is relayed")
            return False
        paths = pipes.confirmed_paths(room["roster"])
        if any(path not in game_pipes.USABLE for path in paths.values()):
            self._debug("game pipe: N64 round on the lobby's server, guest paths %s", paths)
            return False
        if not self._start_rmg_server(room):
            return False
        self._debug("game pipe: N64 round on this device's server, guest paths %s", paths)
        return True

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

    def _stop_rmg_server(self, room_id: str = "", wait: bool = True) -> None:
        current = self._rmg_server
        if current is None or (room_id and current["room"] != room_id):
            return
        self._rmg_server = None
        proc = current["proc"]
        if proc.poll() is None:
            proc.terminate()
            if wait:
                _reap_rmg_server(proc)
            else:
                threading.Thread(target=_reap_rmg_server, args=(proc,), name="rmg-server-stop", daemon=True).start()


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

    def _round_folder(self, sid: str, local: dict, ra, rom: Path, original: str, owner: str = "", keep: bool = False):
        if self._round_saves is None or not self._round_saves.takes(local["core"], local["systemId"]):
            return None
        found = ra.save_settings(local["core"], rom)
        reason = ""
        if local["core"] == "mesen" and not rom_headers.nes_save_ram_only(rom):
            reason = "this cart keeps save files of its own"
        elif found["overrideContentDir"]:
            reason = "an override saves beside the game"
        elif found["overrideFolder"]:
            reason = "an override sets the save folder"
        elif not local["fallback"] and str(rom) not in original:
            reason = "the shortcut opens the game by another path"
        if reason:
            decky.logger.info("saves: %s's round saves go straight to the save (%s)", local["title"], reason)
            return None
        root = self._round_saves.root(sid)
        real = ra.save_paths(owner or local["core"], rom)
        pairs = list(zip(real, ra.save_paths(local["core"], rom, root=root), strict=True))
        flatpak = ra.cfg_path is not None and session.RETROARCH_FLATPAK in ra.cfg_path.parts
        probe = self._probe_round_folder if flatpak else None
        clock = (local["core"], owner) if owner in rtc_formats.SIZES and local["core"] in rtc_formats.SIZES else None
        fill = session.SAVE_FILL.get(local["core"], 0) \
            if session.shares_saves("genesis_plus_gx", local["core"], local["systemId"]) else 0
        if not self._round_saves.begin(sid, local["gameId"], local["title"], pairs, probe, clock, keep, fill):
            return None
        if clock:
            decky.logger.info("saves: %s's clock goes into the round as %s's and comes back as %s's",
                              local["title"], local["coreName"], ra.core_name(owner))
        elif owner:
            decky.logger.info("saves: %s's round plays %s's save on %s", local["title"], ra.core_name(owner),
                              local["coreName"])
        return root

    def _save_owner(self, local: dict) -> str:
        owner = local.get("shortcutCore", "")
        if local["emulator"] != "retroarch" or local["fallback"] \
                or not session.shares_saves(local["core"], owner, local["systemId"]):
            return ""
        return owner

    def _clock_owner(self, local: dict, ra, rom: Path) -> tuple:
        core = local.get("core", "")
        if local["emulator"] != "retroarch" or local["systemId"] not in session.GB_SYSTEMS \
                or core not in rtc_formats.SIZES:
            return "", False
        owner = local.get("shortcutCore", "")
        if not owner:
            owner = next((name for name in rtc_formats.SIZES
                          if rtc_formats.fits(name, _read_quietly(ra.save_paths(name, rom)[1]))), "")
            if not owner and any(ra.save_paths(name, rom)[1].exists() for name in rtc_formats.SIZES):
                decky.logger.info("saves: %s's clock file is neither Gambatte's nor SameBoy's, the round reads it as "
                                  "it is and leaves it alone", local["title"])
                return "", True
            if not owner:
                owner = self._play_core(ra, local["systemId"], rom)
        if owner == core or owner not in rtc_formats.SIZES:
            return "", False
        clock = _read_quietly(ra.save_paths(owner, rom)[1])
        if clock is not None and not rtc_formats.fits(owner, clock):
            other = any(rtc_formats.fits(name, clock) for name in rtc_formats.SIZES)
            decky.logger.info("saves: %s's clock file isn't %s's (%s bytes), the round reads it as it is%s",
                              local["title"], ra.core_name(owner), len(clock), "" if other else " and leaves it alone")
            return "", not other
        return owner, False

    def _check_round_clock(self, local: dict, ra, rom: Path) -> None:
        core = local.get("core", "")
        if self._clock is None or local["emulator"] != "retroarch" or local["systemId"] not in session.GB_SYSTEMS \
                or core not in rtc_formats.SIZES:
            return
        owner = local.get("shortcutCore", "")
        if owner not in rtc_formats.SIZES:
            owner = _clock_format(_read_quietly(ra.save_paths(core, rom)[1]))
        if owner not in rtc_formats.SIZES:
            owner = self._play_core(ra, local["systemId"], rom)
        if owner not in rtc_formats.SIZES:
            owner = core
        backup = self._backup_target(local, owner) if self._backups is not None else None
        self._clock.check(ra.save_paths(owner, rom)[1], owner, local["title"], self._clock_backup(backup, "together"))

    def _hold_round_clock(self, local: dict, ra, rom: Path) -> bool:
        core = local.get("core", "")
        if self._clock is None or local["emulator"] != "retroarch" or local["systemId"] not in session.GB_SYSTEMS \
                or core not in rtc_formats.SIZES:
            return False
        path = ra.save_paths(core, rom)[1]
        found = _clock_format(_read_quietly(path))
        if not found and not path.exists():
            owner = local.get("shortcutCore", "") or self._play_core(ra, local["systemId"], rom)
            if owner == core or owner not in rtc_formats.SIZES or ra.save_paths(owner, rom)[1] != path:
                return False
            self._clock.hold(path, core, owner, local["title"])
            decky.logger.info("saves: %s's round reads the save directly, the clock it makes goes to %s's format "
                              "when it ends", local["title"], ra.core_name(owner))
            return True
        if not found or found == core:
            return False
        backup = self._backup_target(local) if self._backups is not None else None
        if not self._clock.check(path, core, local["title"], self._clock_backup(backup, "together")):
            return False
        self._clock.hold(path, core, found, local["title"])
        decky.logger.info("saves: %s's round reads the save directly, its clock goes back to %s's format when it "
                          "ends", local["title"], ra.core_name(found))
        return True

    def _guest_save_folder(self, sid: str, local: dict, ra, rom: Path):
        if local["core"] != session.GAMBATTE or local["systemId"] not in session.GB_SYSTEMS:
            return None
        found = ra.save_settings(local["core"], rom)
        if found["overrideFolder"] or found["overrideContentDir"]:
            self._debug("an override sets %s's save folder, the guest's round keeps it", local["title"])
            return None
        folder = self._session_dir / f"session-{sid}{GUEST_SAVES}"
        ensure_dir(folder)
        return folder

    def _probe_round_folder(self, root: Path) -> bool:
        marker, answer = root / ".probe", root / ".probe-ok"
        began = time.monotonic()
        try:
            with atomic_file(marker) as out:
                out.write(b"")
            code, _out, _err = subprocess_util.run_command(
                ["flatpak", "run", "--command=sh", session.RETROARCH_FLATPAK, "-c", 'test -r "$1" && : > "$2"', "sh",
                 str(marker), str(answer)],
                timeout=ROUND_FOLDER_PROBE_SECONDS, env=self._flatpak_env(), as_data_owner=True,
            )
            seen = code == 0 and answer.is_file()
        except Exception as e:
            self._debug("the round folder probe failed (%s)", type(e).__name__)
            seen = False
        finally:
            marker.unlink(missing_ok=True)
            answer.unlink(missing_ok=True)
        self._debug("the round folder probe took %.2f s", time.monotonic() - began)
        return seen

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

    def _write_restore(self, appid: int, original: str, sid: str, play_game: int = 0, name: str = "",
                       renamed: str = "") -> None:
        record = {"schemaVersion": RESTORE_SCHEMA, "appid": appid, "original": original, "session": sid,
                  "at": int(time.time())}
        if play_game:
            record["play"] = True
            record["gameId"] = play_game
        if renamed:
            record["name"] = name
            record["renamed"] = renamed
        self._write(self._session_dir / RESTORE_RECORD, json.dumps(record))

    def restore_record(self) -> dict:
        held = self._held("restore")
        if held is not None:
            return held[0]
        found = self._read_restore()
        self._hold("restore", found)
        return found

    def _read_restore(self) -> dict:
        path = self._session_dir / RESTORE_RECORD
        try:
            st = os.stat(path)
            key = (st.st_mtime_ns, st.st_size, st.st_ino)
        except OSError:
            key = None
        if key is None:
            raw = None
        elif self._restore_cache[0] == key:
            raw = self._restore_cache[1]
        else:
            raw = load_json_file(path, None)
            self._restore_cache = (key, raw)
        if (
            not isinstance(raw, dict)
            or type(raw.get("appid")) is not int
            or not isinstance(raw.get("original"), str)
            or not isinstance(raw.get("session"), str)
        ):
            return {"ok": True, "record": None}
        game_id = raw.get("gameId")
        name, renamed = raw.get("name"), raw.get("renamed")
        if not (isinstance(name, str) and isinstance(renamed, str) and name):
            name = renamed = ""
        return {"ok": True, "record": {"appid": raw["appid"], "original": raw["original"], "session": raw["session"],
                                       "play": raw.get("play") is True,
                                       "gameId": game_id if type(game_id) is int else 0,
                                       "name": name, "renamed": renamed}}

    def warm_library_soon(self) -> None:
        async def warm():
            await asyncio.sleep(LIBRARY_WARM_SECONDS)
            try:
                await asyncio.to_thread(self._warm_library)
            except Exception as e:
                decky.logger.warning("multiplayer: couldn't rebuild the game list after a launch (%s)", type(e).__name__)

        self._spawn(warm())

    def _warm_library(self) -> None:
        self._fresh_shortcuts()
        self._library()

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
            self._drop_unlaunched(current)
            self._close_guest_tunnels_soon()
        elif current is not None and current["id"] == sid and current["exited"]:
            self._remove_files(current)
        elif sid and sid not in _running_sessions(str(self._session_dir)):
            self._late_wii_copy_back(sid)
            self._remove_session_files(sid)
        return {"ok": True}

    def launch_ended(self) -> dict:
        current = self._session
        if current is None or current["exited"]:
            return {"ok": True}
        if current.get("mode") == "stream" and current["seen"]:
            self._finish(current)
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
        if current.get("mode") == "stream":
            current["seen"] = True
            self._emit({"state": "playing", "session": current["id"], "emulator": current["emulator"],
                        "mode": "stream"})
            self._follow_backups(current)
            await self._follow_steam_game(current)
            return
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
        self._follow_backups(current)
        self._emit({"state": "playing", "session": current["id"], "emulator": current["emulator"],
                    "mode": current.get("mode", "")})
        if current["emulator"] in ("dolphin", "rmg") and current.get("mode") == "couch":
            self._notify_steps(current["role"], current["emulator"])
        if current.get("savePort"):
            self._spawn(self._ping_saves(current))
        await asyncio.to_thread(self._wait_exit, pid)
        if current.get("backup") is not None:
            self._backups.stop_timer(current["id"])
        if not self._stopping:
            if current.get("roundSaves"):
                await asyncio.to_thread(self._round_saves.end, current["id"])
            if current.get("saveCopies"):
                await asyncio.to_thread(self._repair_empty_saves, current)
            if current.get("wiiNand"):
                await asyncio.to_thread(self._put_wii_saves_back, current)
            if current["emulator"] == "dolphin" and current.get("backup") is not None:
                await asyncio.to_thread(wii_saves.dolphin_gone)
            await self._end_backup(current)
            self._finish(current)

    async def _follow_steam_game(self, current: dict) -> None:
        reaper = 0
        gone = 0
        while self._session is current and not current["exited"] and not self._stopping:
            await asyncio.sleep(STREAM_GAME_CHECK_SECONDS)
            if self._session is not current or current["exited"]:
                return
            if not (reaper and _is_reaper(reaper)):
                reaper = await asyncio.to_thread(_steam_reaper)
            gone = 0 if reaper else gone + 1
            if gone >= STREAM_GAME_GONE_CHECKS:
                decky.logger.info("multiplayer: the round's Steam app is gone and Steam never said so, ending the session")
                self._finish(current)
                return

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

    async def _ping_saves(self, current: dict) -> None:
        loop = asyncio.get_running_loop()
        port = current["savePort"]
        paths = current["saveFiles"]
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setblocking(False)
        began = loop.time()
        answered = False
        heard = False
        warned = False
        quiet = True
        delay = SAVE_PING_SECONDS
        try:
            while True:
                await asyncio.sleep(delay)
                if self._session is not current or current["exited"] or self._stopping:
                    return
                delay = SAVE_PING_SECONDS
                before = await asyncio.to_thread(_save_stamps, paths)
                for path, stamp in zip(paths, before, strict=True):
                    if stamp is not None and stamp[2]:
                        current.setdefault("saveCopies", {})[path] = stamp[2]
                try:
                    await loop.sock_sendto(sock, b"SAVE_FILES", ("127.0.0.1", port))
                    reply = await asyncio.wait_for(loop.sock_recv(sock, 64), SAVE_REPLY_SECONDS)
                except (OSError, asyncio.TimeoutError):
                    reply = b""
                self._debug("SAVE_FILES on port %s: %s", port, reply.strip().decode("ascii", "replace") or "no reply")
                heard = heard or bool(reply)
                if reply.strip().endswith(b"OK"):
                    if not answered:
                        decky.logger.info("multiplayer: RetroArch is saving every %s s", SAVE_PING_SECONDS)
                    answered = True
                    if current.get("roundSaves"):
                        changed = await asyncio.to_thread(self._round_saves.tick, current["id"])
                    else:
                        changed = await asyncio.to_thread(_keep_save_mtimes, paths, before)
                    if changed and quiet:
                        delay = SAVE_FOLLOW_UP_SECONDS
                    quiet = not changed
                elif not heard and not warned and loop.time() - began > SAVE_SILENT_WARN_SECONDS:
                    decky.logger.warning("multiplayer: RetroArch's command port never answered, in-game saves "
                                         "won't be kept")
                    warned = True
        finally:
            sock.close()

    def _repair_empty_saves(self, current: dict) -> None:
        for path, data in current["saveCopies"].items():
            try:
                st = os.stat(path)
            except OSError:
                continue
            if not stat.S_ISREG(st.st_mode) or st.st_size != 0:
                continue
            try:
                target = user_file_target(path, child_owner())
                with atomic_file(target, trusted=target.parent, keep_mode=stat.S_IMODE(st.st_mode),
                                 tmp_name=f".{target.name}.cheevodeck-tmp") as out:
                    out.write(data)
                    out.flush()
                    os.fsync(out.fileno())
            except OSError as e:
                decky.logger.warning("multiplayer: couldn't put back %s (%s)", path.name, type(e).__name__)
                continue
            decky.logger.info("multiplayer: RetroArch was closed in the middle of saving %s, CheevoDeck put back "
                              "the last complete copy", path.name)

    def _follow_backups(self, current: dict) -> None:
        backup = current.get("backup")
        if backup is None:
            return
        nand = current.get("wiiNand")
        if nand is not None:
            since = current["startedAt"]
            backup = {**backup, "live": lambda: wii_saves.session_data(nand["user"], nand["code"], since)}
        self._backups.follow(current["id"], backup, "together")

    async def _end_backup(self, current: dict) -> None:
        if current.pop("clockHeld", False):
            await asyncio.to_thread(self._clock.put_back, game_clock.EXIT_WAIT_SECONDS)
        if current.pop("backup", None) is not None:
            await self._backups.end(current["id"])

    def _put_wii_saves_back(self, current: dict, late: bool = False) -> None:
        nand = current["wiiNand"]
        own = wii_saves.title_data(nand["user"], nand["code"])

        def back_up(kind: str, title: str, data: Path) -> bool:
            if self._backups is None:
                return True
            game_id = nand["gameId"] if own is not None and data == own else 0
            return self._backups.back_up({"gameId": game_id, "systemId": session.WII_SYSTEM, "emulator": "dolphin",
                                          "install": nand["install"], "title": kind + title, "paths": [data]},
                                         "wii-copy-back", "together")

        try:
            if _ini_section(nand["config"], "NetPlay").get("WriteSaveData", "True").lower() == "false":
                self._debug("Wii saves: the host's Write Save Data is off")
                return
            outcome = wii_saves.put_back(nand["user"], since=current["startedAt"], back_up=back_up,
                                         before=nand["before"], late=late)
            self._debug("Wii saves: %s", outcome)
        except Exception as e:
            decky.logger.warning("multiplayer: the Wii save copy-back failed (%s)", type(e).__name__)

    def _retroarch_saves_netplay(self) -> bool:
        if RETROARCH_NETPLAY_AUTOSAVE_SINCE is None:
            return False
        version = session.version_tuple(self._flatpak_version(session.RETROARCH_FLATPAK))
        return version is not None and version >= RETROARCH_NETPLAY_AUTOSAVE_SINCE

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
        if (current.get("backup") is not None or current.get("clockHeld")) and not self._stopping:
            self._spawn(self._end_backup(current))
        self._remove_files(current)
        self._emit({"state": "ended", "session": current["id"]})
        self._session_over(current)

    def _apply_mapping(self, local: dict, slot: str) -> bool:
        if self._mappings is None or not dolphin_game_mappings.takes_mappings(
                local["systemId"], local["emulator"], local.get("install", "")):
            return False
        if local.get("automap"):
            decky.logger.info("dolphin mappings: EmuDeck's AutoMap sets the controls for this launch, game %s's "
                              "%s mapping is not applied", local["gameId"], slot)
            return False
        return self._mappings.apply(local["gameId"], local["systemId"], local["install"], slot)

    def _steady_start(self, on: bool) -> None:
        if self._steady is not None:
            self._steady.start_round(on)

    def _steady_end(self) -> None:
        if self._steady is not None:
            self._steady.end_round()

    def _steady_sweep(self) -> None:
        if self._steady is not None and self._steady.active and self._session is None:
            self._debug("no round is running, putting Wi-Fi back")
            self._steady.end_round()

    def _round_saves_sweep(self) -> None:
        if self._round_saves is not None and self._round_saves.pending:
            live = self._session["id"] if self._session is not None else ""
            self._spawn(asyncio.to_thread(self._round_saves.sweep, live))

    def _abandon_round_saves(self, sid: str) -> None:
        if self._round_saves is not None:
            self._round_saves.abandon(sid)

    def _drop_unlaunched(self, current: dict) -> None:
        self._session = None
        self._remove_session_files(current["id"])
        self._abandon_round_saves(current["id"])
        if current.pop("clockHeld", False):
            self._clock.put_back()

    def _session_over(self, current: dict) -> None:
        self._steady_end()
        if not current["seen"] and current.pop("clockHeld", False):
            threading.Thread(target=self._clock.put_back, name="clock-put-back", daemon=True).start()
        if current.get("roundSaves"):
            threading.Thread(target=self._round_saves.end, args=(current["id"],), name="round-saves-end",
                             daemon=True).start()
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
        for suffix in (".opt", ROUND_STATE, GUEST_SAVES, *SESSION_SUFFIXES):
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
        _remove_system_folder(self._session_dir / f"session-{sid}.remaps")

    def _emit(self, payload: dict, event: str = SESSION_EVENT) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(decky.emit(event, payload), loop)
        except Exception as e:
            decky.logger.warning("multiplayer: couldn't tell the panel (%s)", type(e).__name__)

    def debug_stream_relay(self, on: bool) -> dict:
        if not self._settings_store.get_debug_logging(self._settings_store.load_config()):
            return {"ok": False, "error": ERROR_UNAVAILABLE}
        stream_room.FORCE_RELAY[0] = bool(on)
        decky.logger.info("multiplayer: debug, new stream and game pipes %s", "relay only" if on else "try direct first")
        return {"ok": True, "on": stream_room.FORCE_RELAY[0]}

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

    def debug_no_amd(self, on: bool) -> dict:
        if not self._settings_store.get_debug_logging(self._settings_store.load_config()):
            return {"ok": False, "error": ERROR_UNAVAILABLE}
        self._no_amd_debug = bool(on)
        self._said_no_amd = False
        decky.logger.info("multiplayer: debug, Stream Play hosting %s",
                          "acts as if there's no AMD graphics" if on else "uses the real graphics check")
        return {"ok": True, "on": self._no_amd_debug}

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

    async def _unmute_moonlight(self) -> None:
        deadline = time.monotonic() + MOONLIGHT_AUDIO_SECONDS
        while time.monotonic() < deadline:
            await asyncio.sleep(1)
            rows = await asyncio.to_thread(self._sink_inputs) or []
            stream = next((row for row in rows if row["properties"].get("application.name") == "Moonlight"), None)
            if stream is None:
                continue
            if stream.get("mute") is not True:
                return
            code, _out, _err = await asyncio.to_thread(self._pactl, "set-sink-input-mute", str(stream["index"]), "0")
            if code == 0:
                decky.logger.info("stream: Moonlight's audio came up muted, unmuted it")
                return

    def _game_stream_rows(self):
        rows = self._sink_inputs()
        if rows is None:
            return None
        streams = []
        for row in rows:
            props = row["properties"]
            if props.get("application.process.binary") not in GAME_AUDIO_BINARIES:
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
        if self._stream_host is not None and self._room is None:
            try:
                ended = self._stream_host.end_strays()
            except Exception as e:
                decky.logger.warning("stream: the stray sweep failed (%s)", type(e).__name__)
                ended = []
            if ended:
                decky.logger.info("stream: ended %s left by an earlier run", ", ".join(ended))
        if self._stream_setup is not None and self._joined is None and self._stream_setup.end_stray_moonlight():
            decky.logger.info("stream: ended a Moonlight left by an earlier run")
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
                if entry.name.endswith(ROUND_STATE):
                    self._late_wii_copy_back(found.group(1))
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
        current.update(self._read_round_state(sid))
        if self._round_saves is not None and self._round_saves.adopt(sid):
            cfg = session.read_cfg(self._session_dir / f"session-{sid}.cfg")
            current.update({"roundSaves": True, "saveFiles": [], "savePort": to_int(cfg.get("network_cmd_port"), 0)})
        self._session = current
        current["watch"] = self._spawn(self._watch(current))
        decky.logger.info("multiplayer: re-adopted session %s after a restart", sid)
        if current.get("steadyWifi"):
            self._steady_start(True)

    def _write_round_state(self, current: dict) -> None:
        nand = current.get("wiiNand")
        backup = current.get("backup")
        state = {
            "gameId": current.get("gameId", 0),
            "role": current.get("role", ""),
            "savePort": current.get("savePort", 0),
            "saveFiles": [str(path) for path in current.get("saveFiles", [])],
            "startedAt": current["startedAt"],
            "steadyWifi": current.get("steadyWifi", False),
            "wiiNand": {**nand, "user": str(nand["user"]), "config": str(nand["config"]),
                        "before": list(nand["before"]) if nand["before"] else None} if nand else None,
            "backup": {**backup, "paths": [str(path) for path in backup["paths"]]} if backup else None,
        }
        try:
            self._write(self._session_dir / f"session-{current['id']}{ROUND_STATE}", json.dumps(state))
        except (OSError, TypeError, ValueError) as e:
            decky.logger.warning("multiplayer: couldn't keep the round's state for a restart (%s)", type(e).__name__)

    def _late_wii_copy_back(self, sid: str) -> None:
        state = self._read_round_state(sid)
        if state.get("wiiNand"):
            decky.logger.info("multiplayer: a Dolphin round ended while CheevoDeck wasn't running, checking its "
                              "Wii save")
            self._put_wii_saves_back(state, late=True)

    def _read_round_state(self, sid: str) -> dict:
        raw = load_json_file(self._session_dir / f"session-{sid}{ROUND_STATE}", None)
        if not isinstance(raw, dict):
            return {}
        found = {}
        if type(raw.get("gameId")) is int:
            found["gameId"] = raw["gameId"]
        if raw.get("role") in ("host", "guest"):
            found["role"] = raw["role"]
        files = raw.get("saveFiles")
        if type(raw.get("savePort")) is int and 0 < raw["savePort"] < 65536 and isinstance(files, list) \
                and all(isinstance(path, str) and os.path.isabs(path) for path in files):
            found["savePort"] = raw["savePort"]
            found["saveFiles"] = [Path(path) for path in files]
        if type(raw.get("startedAt")) in (int, float):
            found["startedAt"] = float(raw["startedAt"])
        if raw.get("steadyWifi") is True:
            found["steadyWifi"] = True
        nand = raw.get("wiiNand")
        if isinstance(nand, dict) and "startedAt" in found and all(
                isinstance(nand.get(key), str) for key in ("user", "config", "install", "code")) \
                and type(nand.get("gameId")) is int:
            before = nand.get("before")
            found["wiiNand"] = {"user": Path(nand["user"]), "config": Path(nand["config"]), "install": nand["install"],
                                "code": nand["code"], "gameId": nand["gameId"],
                                "before": tuple(before) if isinstance(before, list) and len(before) == 2
                                and all(type(part) is int for part in before) else None}
        backup = raw.get("backup")
        if isinstance(backup, dict) and type(backup.get("gameId")) is int and type(backup.get("systemId")) is int \
                and isinstance(backup.get("emulator"), str) and isinstance(backup.get("paths"), list) \
                and all(isinstance(path, str) and os.path.isabs(path) for path in backup["paths"]):
            found["backup"] = {**backup, "paths": [Path(path) for path in backup["paths"]]}
        return found

    def _restore_sessions(self) -> set:
        raw = load_json_file(self._session_dir / RESTORE_RECORD, None)
        if not isinstance(raw, dict):
            return set()
        session_id = raw.get("session")
        return {session_id} if isinstance(session_id, str) else set()


def _reap_rmg_server(proc) -> None:
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    decky.logger.info("multiplayer: RMG netplay server stopped")


def _remove_system_folder(folder: Path) -> None:
    if not folder.is_dir() or folder.is_symlink():
        return
    try:
        shutil.rmtree(folder)
    except OSError as e:
        decky.logger.warning("multiplayer: couldn't remove a session system folder (%s)", type(e).__name__)


def _clock_format(data) -> str:
    now = int(time.time())
    return next((core for core in rtc_formats.SIZES if rtc_formats.valid(core, data, now)), "")


def _read_quietly(path: Path):
    try:
        return path.read_bytes()
    except OSError:
        return None


def _ini_section(path: Path, name: str) -> dict:
    values = {}
    inside = False
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if line.startswith("["):
                    inside = line == f"[{name}]"
                elif inside and "=" in line:
                    key, _sep, value = line.partition("=")
                    values[key.strip()] = value.strip()
    except OSError:
        return {}
    return values


def _is_reaper(pid: int) -> bool:
    try:
        with open(f"/proc/{pid}/comm", "rb") as handle:
            return handle.read(32).strip() == b"reaper"
    except OSError:
        return False


def _steam_reaper() -> int:
    try:
        entries = os.listdir("/proc")
    except OSError:
        return 0
    for entry in entries:
        if not entry.isdigit() or not _is_reaper(int(entry)):
            continue
        try:
            with open(f"/proc/{entry}/cmdline", "rb") as handle:
                if b"SteamLaunch" in handle.read(4096):
                    return int(entry)
        except OSError:
            continue
    return 0


def _slot_blocks(text: str) -> list:
    blocks = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("[slot "):
            blocks.append([])
        elif blocks and line:
            blocks[-1].append(line)
    return blocks


def _block_pad(block: list) -> tuple:
    fields = dict(line.split("=", 1) for line in block if "=" in line)
    return fields.get("VID", "").lower(), fields.get("PID", "").lower()


def _seed_guest_slots(home: Path, guests: int) -> bool:
    path = home / VIRTUAL_PADS
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        owner = path.stat()
    except FileNotFoundError:
        return False
    slots = _slot_blocks(text)
    hosts = [block for block in slots if _block_pad(block) != SUNSHINE_PAD]
    kept = [block for block in slots if _block_pad(block) == SUNSHINE_PAD]
    written = [[line.format(number) for line in GUEST_SLOT] for number in range(1, guests + 1)]
    blocks = hosts + (kept + written)[:guests]
    wanted = "".join(f"[slot {index}]\n" + "".join(line + "\n" for line in block) for index, block in enumerate(blocks))
    if wanted == text:
        return False
    temp = path.with_name(path.name + ".cheevodeck")
    temp.write_text(wanted, encoding="utf-8")
    try:
        os.chown(temp, owner.st_uid, owner.st_gid)
    except OSError:
        pass
    os.chmod(temp, stat.S_IMODE(owner.st_mode))
    os.replace(temp, path)
    return True


def _sunshine_pads() -> int:
    vendor, product = (part.removeprefix("0x") for part in SUNSHINE_PAD)
    try:
        text = INPUT_DEVICES.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0
    return sum(1 for block in text.split("\n\n")
               if f"Vendor={vendor} Product={product}" in block and "libvirtualhid" in block)


def _virtual_pads(home: Path) -> list:
    try:
        text = (home / VIRTUAL_PADS).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    pads = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("[slot "):
            pads.append({})
        elif pads and "=" in line:
            name, _sep, value = line.partition("=")
            pads[-1][name.strip()] = value.strip().lower()
    return [(pad.get("VID", ""), pad.get("PID", "")) for pad in pads]


def _status_title(title: str, name: str) -> str:
    title = (title or "").strip()
    return title if title and name and title != name else ""


def _fallback_args(route: dict) -> str:
    rom = session.quote(route["rom"])
    if route["kind"] == "retroarch":
        return f"-L {session.quote(route['corePath'])} {rom}"
    if route["kind"] == "dolphin":
        return f"-b -e {rom}"
    if route["kind"] == "rmg":
        return f"--fullscreen --quit-after-emulation {rom}"
    if route["kind"] == "duckstation":
        return f"-batch -fullscreen {rom}"
    if route["kind"] == "pcsx2":
        return f"-batch -fullscreen -nogui {rom}"
    if route["kind"] == "ppsspp":
        return f"--fullscreen {rom}"
    if route["kind"] == "melonds":
        return f"-f {rom}"
    return rom


def _runs_same(old: dict, new: dict) -> bool:
    fields = ("appid", "emulator", "core", "gameAppid", "install")
    if any(old.get(field) != new.get(field) for field in fields):
        return False
    return _route_args(old["route"]) == _route_args(new["route"]) if "route" in old and "route" in new else True


def _route_args(route: dict) -> str:
    if route["fallback"]:
        return _fallback_args(route)
    if route.get("corePath"):
        return f"-L {session.quote(route['corePath'])}"
    return ""


def _route_kind(route: dict) -> str:
    if route.get("kind"):
        return route["kind"]
    detected = session.detect(route["shortcut"]["exe"], route["shortcut"]["launchOptions"])
    return detected["emulator"] if detected else ""


def _power_of_two(size: int) -> bool:
    return size > 0 and size & (size - 1) == 0


def _route_emulator(route: dict):
    if route["fallback"]:
        return route["kind"], route.get("core", "")
    detected = session.detect(route["shortcut"]["exe"], route["shortcut"]["launchOptions"])
    emulator = detected["emulator"] if detected else ""
    return emulator, route.get("core") or (detected["core"] if detected and emulator == "retroarch" else "")


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
    return room.get("mode") == "stream" or (room.get("mode") == "couch" and room.get("emulator") == "retroarch")


def _steps(row: dict) -> str:
    if row["mode"] == "couch" and row["emulator"] in ("dolphin", "rmg"):
        return row["emulator"]
    return ""


def _gate_state(gate, fix=None, planned: bool = False) -> str:
    if not gate:
        return "ready"
    if planned:
        return "setup" if fix else "never"
    return "setup" if gate in SETUP_GATES else "never"


def _mode_state(checked: dict) -> dict:
    return {"state": checked["state"], "gate": checked["gate"], "detail": checked["detail"], "fix": checked["fix"],
            "plan": checked["plan"]}


def _merge_steps(steps: list, more: list) -> list:
    merged = list(steps)
    seen = {_step_key(step) for step in steps}
    for step in more:
        if _step_key(step) not in seen:
            seen.add(_step_key(step))
            merged.append(step)
    merged.sort(key=lambda step: STEP_ORDER.get(step["do"], 2))
    return merged


def _step_key(step: dict) -> tuple:
    return step["do"], step.get("kind") or step.get("core") or ""


def _planned_shortcut(step: dict, index: int) -> dict:
    if step["via"] == "flatpak":
        scope = "system" if step.get("scope") == "system" else "user"
        exe, options = "/usr/bin/flatpak", f"run --{scope} {step.get('id', '')}"
    else:
        exe, options = f'"{step.get("path", "")}"', ""
    return {"appid": -1 - index, "name": step.get("name", ""), "exe": exe, "launchOptions": options}


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
        "fallback": local["fallback"],
        "picked": bool(local.get("picked")),
        "recommended": bool(local.get("recommended")),
        "vehicles": local.get("vehicles", 0),
        "dolphinMappings": dolphin_game_mappings.takes_mappings(local["systemId"], local["emulator"],
                                                                local.get("install", "")),
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


def _device_model() -> str:
    try:
        product = Path(session.PRODUCT_NAME).read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return "u"
    return DEVICE_MODELS.get(product, "u")


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


def _command_port() -> int:
    while True:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.bind(("0.0.0.0", 0))
            port = probe.getsockname()[1]
        finally:
            probe.close()
        if port not in (RETROARCH_COMMAND_PORT, proto.RETROARCH_NETPLAY_PORT):
            return port


def _save_stamp(path: Path):
    try:
        with open(path, "rb") as handle:
            st = os.fstat(handle.fileno())
            data = handle.read()
    except OSError:
        return None
    return st, hashlib.sha1(data).digest(), data


def _save_stamps(paths: list) -> list:
    return [_save_stamp(path) for path in paths]


def _keep_save_mtimes(paths: list, before: list) -> bool:
    changed = [_keep_save_mtime(path, stamp) for path, stamp in zip(paths, before, strict=True)]
    return any(changed)


def _keep_save_mtime(path: Path, before) -> bool:
    after = _save_stamp(path)
    if after is None:
        return False
    if before is None or after[1] != before[1]:
        return True
    if after[0].st_mtime_ns == before[0].st_mtime_ns:
        return False
    try:
        now = os.stat(path)
        if (now.st_mtime_ns, now.st_size) != (after[0].st_mtime_ns, after[0].st_size):
            return False
        os.utime(path, ns=(now.st_atime_ns, before[0].st_mtime_ns))
        check = _save_stamp(path)
        if check is None or check[1] != before[1]:
            os.utime(path)
            return True
    except OSError:
        pass
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
            with open(f"/proc/{name}/environ", "rb") as handle:
                cmdline += b"\0" + handle.read()
        except OSError:
            continue
        found.update(pattern.findall(cmdline.decode("utf-8", "replace")))
    return found



def _vote_marker(view):
    if view is None:
        return None
    won = view["games"][view["winner"]]["title"] if view["ended"] == "won" and view["winner"] >= 0 else ""
    return {"id": view["id"], "kind": view["kind"], "open": view["open"], "ended": view["ended"], "game": won,
            "voted": view["mine"] >= 0, "counts": list(view["counts"])}


def _in_lounge_match(status, seat: int) -> bool:
    boards = (status or {}).get("lounge") or {}
    return any(not board["end"] and any(player["seat"] == seat and not player["gone"] for player in board["players"])
               for board in boards.values())


def _version_gap(host: str) -> str:
    theirs, ours = parse_version(host), parse_version(PLUGIN_VERSION)
    if theirs is None or ours is None or theirs == ours:
        return ""
    return "older" if theirs < ours else "newer"


def _lounge_marker(view):
    if view is None:
        return None
    marker = {}
    for name, board in view.items():
        players = board["players"]
        won = board["end"] == "win" and 0 <= board["winner"] < len(players)
        marker[name] = {"match": board["match"], "opener": players[0]["seat"] if players else -1,
                        "openerName": players[0]["name"] if players else "", "end": board["end"],
                        "winnerName": players[board["winner"]]["name"] if won else "", "board": board["board"],
                        "players": len(players)}
    return marker
