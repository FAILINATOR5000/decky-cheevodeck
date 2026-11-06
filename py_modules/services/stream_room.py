import asyncio
import hashlib
import hmac
import os
import secrets
import shlex
import socket
import subprocess
import time
from pathlib import Path

import decky

import multiplayer_protocol as proto
import subprocess_util
from services import lobby_client
from services.stream_pipe import StreamPipe
from services.stream_setup import MOONLIGHT_APP
from utils import child_owner


PAIR_POLL_SECONDS = 1.0
PAIR_GIVE_UP_SECONDS = 15
LIST_SECONDS = 10
GUEST_PAIR_RETRY_SECONDS = 10
KILL_SECONDS = 10
SPEED_SECONDS = 3
SPEED_CHUNK = 64 * 1024
SPEED_TIMEOUT = 30
SPEED_SHARE = 0.8

TIERS = ((800, 10000, 6000), (1080, 20000, 12000))
FLOOR_KBPS = TIERS[0][2]
CEILING_KBPS = TIERS[-1][1]
LAN_FULL_GUESTS = 3
SPEED_CONNECTIONS = 4
STREAM_HEIGHT_MAX = 1080
ONLINE_PACKET_SIZE = 1024
STREAM_MBIT_DECLARED = 20
FORCE_RELAY = [False]


def stream_token(digest: bytes, label: str) -> str:
    return hmac.new(digest, ("stream|" + label).encode("ascii"), hashlib.sha256).hexdigest()


def resolve_meet(server):
    if server is None:
        return None
    try:
        infos = socket.getaddrinfo(server[0], server[1], socket.AF_INET, socket.SOCK_DGRAM)
    except OSError:
        return None
    return infos[0][4][:2] if infos else None


def stream_size(width: int, height: int):
    if width <= 0 or height <= 0:
        return 1280, 800
    if height > STREAM_HEIGHT_MAX:
        width = round(width * STREAM_HEIGHT_MAX / height)
        height = STREAM_HEIGHT_MAX
    return width - width % 2, height - height % 2


def tier_kbps(height: int, relayed: bool) -> int:
    for top, direct, relay in TIERS:
        if height <= top:
            return relay if relayed else direct
    return TIERS[-1][2] if relayed else TIERS[-1][1]


def _bare(address: str) -> str:
    return address[7:] if address.startswith("::ffff:") else address


class HostStreams:
    def __init__(self, *, sunshine, room_id: str, online: bool, meet, digest: bytes, slow, debug):
        self._sunshine = sunshine
        self._room_id = room_id
        self._online = online
        self._meet = meet
        self._digest = digest
        self._slow = slow
        self._debug = debug
        self._seats = {}
        self._pairing = None
        self._closed = False
        self.speed_mbit = 0.0
        self.checking = False

    def seat_taken(self, index: int, ip: str, piped: bool) -> None:
        old = self._seats.pop(index, None)
        if old is not None and old["pipe"] is not None:
            old["pipe"].close()
        entry = {
            "pin": _fresh_pin(),
            "occ": secrets.token_hex(4),
            "n": secrets.token_hex(16),
            "ip": ip,
            "source": f"127.0.0.{index + 1}",
            "piped": piped and self._online,
            "paired": False,
            "confirmed": False,
            "since": time.monotonic(),
            "pipe": None,
            "path": "",
            "reported": "",
            "kb": 0,
        }
        self._seats[index] = entry
        if entry["piped"] and self._meet is not None:
            entry["opening"] = asyncio.ensure_future(self._open_pipe(index, entry))
        if self._pairing is None or self._pairing.done():
            self._pairing = asyncio.ensure_future(self._pair_loop())
            self._pairing.add_done_callback(_report_crash)

    async def _open_pipe(self, index: int, entry: dict) -> None:
        pipe = StreamPipe(role="host", meet=self._meet, room=self._room_id, seat=index,
                          token=stream_token(self._digest, "host"), mbit=STREAM_MBIT_DECLARED, occupant=entry["occ"],
                          allow_direct=not FORCE_RELAY[0],
                          source=entry["source"], on_path=lambda path: self._on_path(entry, path),
                          debug=self._debug)
        if not await pipe.start():
            decky.logger.warning("stream: couldn't open the pipe for seat %s", index)
            return
        if self._closed or self._seats.get(index) is not entry:
            pipe.close()
            return
        entry["pipe"] = pipe

    def _on_path(self, entry: dict, path: str) -> None:
        entry["path"] = path
        self._debug("stream: host pipe path %s", path)

    def seat_gone(self, index: int) -> None:
        entry = self._seats.pop(index, None)
        if entry is None:
            return
        if entry["pipe"] is not None:
            entry["pipe"].close()
        if entry["paired"]:
            asyncio.ensure_future(asyncio.to_thread(self._sunshine.unpair_name, _client_name(entry))) \
                .add_done_callback(_report_crash)

    def report(self, index: int, state: str, kb: int = 0) -> None:
        entry = self._seats.get(index)
        if entry is None:
            return
        entry["kb"] = kb
        if entry["paired"] and state in ("", "connecting", "streaming", "relay"):
            entry["confirmed"] = True
        lost = state == "pairing" and entry["paired"] and entry["confirmed"]
        if (state == "failed" and entry["paired"] and entry["reported"] != "failed") or lost:
            self._rearm(entry)
        entry["reported"] = state

    def _rearm(self, entry: dict) -> None:
        entry["pin"] = _fresh_pin(entry["pin"])
        entry["paired"] = False
        entry["confirmed"] = False
        if self._pairing is None or self._pairing.done():
            self._pairing = asyncio.ensure_future(self._pair_loop())
            self._pairing.add_done_callback(_report_crash)

    def forget_pairings(self) -> None:
        for entry in self._seats.values():
            self._rearm(entry)

    def streaming(self) -> bool:
        return any(entry["reported"] in ("connecting", "streaming", "relay") or not entry["paired"]
                   for entry in self._seats.values())

    def seat_state(self, index: int) -> str:
        entry = self._seats.get(index)
        if entry is None:
            return ""
        if entry["reported"] == "failed" or entry["paired"]:
            return entry["reported"]
        if entry["pipe"] is not None and entry["pipe"].unanswered:
            return "failed"
        return "pairing"

    def body(self, index: int, key: bytes) -> dict:
        entry = self._seats.get(index)
        if entry is None:
            return {"pin": "", "token": "", "n": secrets.token_hex(16), "cap": 0, "full": False, "occ": "",
                    "low": False, "half": False}
        label = f"{index}|{entry['occ']}"
        token = proto.wrap(key, "stoken", entry["n"], bytes.fromhex(stream_token(self._digest, label))) \
            if entry["piped"] else ""
        return {
            "pin": proto.wrap_pin(key, entry["n"], entry["pin"]) if not entry["paired"] else "",
            "token": token,
            "n": entry["n"],
            **self._share(index),
            "occ": entry["occ"],
            "low": not entry["piped"] and self._lan_order(index) > LAN_FULL_GUESTS,
            "half": bool(self._slow()),
        }

    def budget_kbps(self) -> int:
        return int(self.speed_mbit * 1000 * SPEED_SHARE) if self.speed_mbit > 0 else 0

    def _share(self, index: int) -> dict:
        budget = self.budget_kbps()
        entry = self._seats[index]
        if not entry["piped"] or budget <= 0:
            return {"cap": 0, "full": False}
        used = 0
        first = True
        for seat, other in self._seats.items():
            if seat == index or not other["piped"]:
                continue
            if seat < index:
                first = False
            if other["kb"]:
                used += other["kb"]
            elif seat < index:
                used += FLOOR_KBPS
        remaining = budget - used
        full = remaining < FLOOR_KBPS and not first and not entry["kb"]
        return {"cap": min(CEILING_KBPS, max(500, remaining)), "full": full}

    def _lan_order(self, index: int) -> int:
        return sum(1 for seat, entry in self._seats.items() if seat <= index and not entry["piped"])

    async def _pair_loop(self) -> None:
        while not self._closed:
            waiting = [entry for entry in self._seats.values() if not entry["paired"]]
            if not waiting:
                return
            for index, entry in list(self._seats.items()):
                opening = entry.get("opening")
                if entry["piped"] and entry["pipe"] is None and self._meet is not None \
                        and (opening is None or opening.done()):
                    entry["opening"] = asyncio.ensure_future(self._open_pipe(index, entry))
            try:
                pending = await asyncio.to_thread(self._sunshine.pending_pins)
            except Exception as e:
                self._debug("stream: reading Sunshine's pairing requests failed (%s)", type(e).__name__)
                pending = []
            if pending:
                self._debug("stream: pairing requests from %s, waiting on %s",
                            [_bare(request["address"]) for request in pending],
                            [each["source"] if each["piped"] else each["ip"] for each in waiting])
            for request in pending:
                address = _bare(request["address"])
                entry = next((each for each in waiting
                              if address == (each["source"] if each["piped"] else each["ip"])), None)
                if entry is None:
                    continue
                try:
                    ok = await asyncio.to_thread(self._sunshine.answer_pin, request["id"], entry["pin"],
                                                 _client_name(entry))
                except Exception as e:
                    self._debug("stream: answering a pairing request failed (%s)", type(e).__name__)
                    ok = False
                if ok:
                    entry["paired"] = True
                    decky.logger.info("stream: paired a guest from %s", "the pipe" if entry["piped"] else address)
            await asyncio.sleep(PAIR_POLL_SECONDS)

    async def measure(self, server) -> None:
        if server is None:
            return
        size = int(CEILING_KBPS * 1000 / 8 * SPEED_SECONDS * 4) // SPEED_CONNECTIONS
        self.checking = True
        try:
            results = await asyncio.wait_for(asyncio.gather(
                *(_speed_check(server, size) for _ in range(SPEED_CONNECTIONS)), return_exceptions=True),
                SPEED_TIMEOUT)
        except Exception as e:
            self._debug("stream: the upload check failed (%s)", type(e).__name__)
            return
        finally:
            self.checking = False
        mbit = sum(result for result in results if isinstance(result, float))
        if mbit <= 0:
            self._debug("stream: the upload check got no answer")
            return
        self.speed_mbit = mbit
        decky.logger.info("stream: upload %.1f Mbit/s, %s kbps for guests online", mbit, self.budget_kbps())

    def close(self) -> None:
        self._closed = True
        if self._pairing is not None:
            self._pairing.cancel()
        for entry in self._seats.values():
            if entry["pipe"] is not None:
                entry["pipe"].close()
        self._seats.clear()


def _fresh_pin(old: str = "") -> str:
    while True:
        pin = f"{secrets.randbelow(10000):04d}"
        if pin != old:
            return pin


def _client_name(entry: dict) -> str:
    return f"cheevodeck-{entry['source'].rsplit('.', 1)[1]}"


def _report_crash(task) -> None:
    if not task.cancelled() and task.exception() is not None:
        decky.logger.warning("stream: a background task failed (%r)", task.exception())


async def _speed_check(server, size: int) -> float:
    reader, writer = await asyncio.open_connection(server[0], server[1])
    try:
        writer.write(lobby_client.envelope({"op": "speed", "v": proto.VERSION, "bytes": size}))
        await writer.drain()
        first = await lobby_client.read_envelope(reader)
        if not isinstance(first, dict) or first.get("op") != "go":
            return 0.0
        filler = bytes(SPEED_CHUNK)
        sent = 0
        answer = asyncio.ensure_future(lobby_client.read_envelope(reader))
        try:
            while sent < size and not answer.done():
                writer.write(filler)
                await writer.drain()
                sent += len(filler)
        except OSError:
            pass
        try:
            result = await asyncio.wait_for(answer, SPEED_SECONDS * 2)
        finally:
            if not answer.done():
                answer.cancel()
        mbit = result.get("mbit") if isinstance(result, dict) and result.get("op") == "speed" else 0
        return float(mbit) if type(mbit) in (int, float) and mbit > 0 else 0.0
    finally:
        writer.close()


class GuestStream:
    def __init__(self, *, user_home: Path, config: Path, room_id: str, seat: int, online: bool, meet, host_ip: str,
                 debug):
        self._user_home = Path(user_home)
        self._config = Path(config)
        self._room_id = room_id
        self._seat = seat
        self._online = online
        self._meet = meet
        self._host_ip = host_ip
        self._debug = debug
        self.address = "127.0.0.1" if online else host_ip
        self.paired = False
        self.failed = False
        self.full = False
        self.cap = 0
        self.low = False
        self.half = False
        self.kbps = 0
        self._pin = ""
        self._pipe = None
        self._pipe_task = None
        self._pairing = None
        self._tried_at = 0.0
        self._closed = False

    @property
    def path(self) -> str:
        if not self._online:
            return "direct"
        return self._pipe.path if self._pipe is not None else "punching"

    def take(self, stream, key: bytes, idle: bool = True) -> None:
        if stream is None or self._closed:
            return
        self.cap = stream["cap"]
        self.full = stream["full"]
        self.low = stream["low"]
        self.half = stream["half"]
        if self._online and self._pipe is None and self._pipe_task is None and stream["token"] and self._meet:
            raw = proto.unwrap(key, "stoken", stream["n"], stream["token"])
            if raw is not None and stream["occ"]:
                self._pipe_task = asyncio.ensure_future(self._open_pipe(raw.hex(), stream["occ"]))
                self._pipe_task.add_done_callback(_report_crash)
        if not stream["pin"]:
            return
        pin = proto.unwrap_pin(key, stream["n"], stream["pin"])
        if pin is None:
            return
        if self.paired:
            if pin == self._pin or not idle:
                return
            self.paired = False
            self.failed = False
        busy = self._pairing is not None and not self._pairing.done()
        if busy or (self.failed and time.monotonic() - self._tried_at < GUEST_PAIR_RETRY_SECONDS):
            return
        if self._online and (self._pipe is None or self._pipe.path in ("punching", "busy")):
            return
        self._pin = pin
        self._tried_at = time.monotonic()
        self._pairing = asyncio.ensure_future(asyncio.to_thread(self._pair))

    async def _open_pipe(self, token: str, occupant: str) -> None:
        pipe = StreamPipe(role="guest", meet=self._meet, room=self._room_id, seat=self._seat, token=token,
                          mbit=STREAM_MBIT_DECLARED, occupant=occupant, debug=self._debug, allow_direct=not FORCE_RELAY[0])
        if not await pipe.start():
            decky.logger.warning("stream: couldn't open the guest pipe (Sunshine's ports taken here?)")
            self.failed = True
            return
        if self._closed:
            pipe.close()
            return
        self._pipe = pipe

    def forget_pairing(self) -> None:
        self.paired = False
        self.failed = False
        self._pin = ""

    def wait_paired(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while not self.paired and not self._closed and time.monotonic() < deadline:
            if self.failed and (self._pairing is None or self._pairing.done()):
                return
            time.sleep(0.5)

    @property
    def busy(self) -> bool:
        return self._online and self._pipe is not None and self._pipe.path == "busy"

    def state(self, launched: bool, seen: bool) -> str:
        if self.failed and not self.paired:
            return "failed"
        if self._online and self._pipe is not None and (self._pipe.path == "busy" or self._pipe.unanswered):
            return "failed"
        if not self.paired:
            return "pairing"
        if not launched:
            return ""
        if not seen:
            return "connecting"
        return "relay" if self.path == "relay" else "streaming"

    def _env(self) -> dict:
        owner = child_owner()
        uid = owner[0] if owner else os.getuid()
        return {
            "HOME": str(self._user_home),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "XDG_RUNTIME_DIR": f"/run/user/{uid}",
            "XDG_DATA_HOME": str(self._user_home / ".local" / "share"),
            "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{uid}/bus",
        }

    def _moonlight(self, inner: str) -> list:
        return ["flatpak", "run", "--user", "--env=QT_QPA_PLATFORM=offscreen", "--command=sh", MOONLIGHT_APP, "-c",
                f"export XDG_CONFIG_HOME={shlex.quote(str(self._config))}; exec moonlight {inner}"]

    def _owner_ids(self):
        owner = child_owner()
        return (owner[0], owner[1]) if owner else (None, None)

    def _pair(self) -> None:
        try:
            for argv in (["rm", "-rf", "--", str(self._config)], ["mkdir", "-p", "--", str(self._config)]):
                code, _out, err = subprocess_util.run_command(argv, timeout=LIST_SECONDS, env=self._env(),
                                                              as_data_owner=True)
                if code != 0:
                    raise OSError(err.strip()[:200])
        except Exception as e:
            decky.logger.warning("stream: couldn't make Moonlight's folder (%s)", type(e).__name__)
            self.failed = True
            return
        uid, gid = self._owner_ids()
        try:
            proc = subprocess.Popen(self._moonlight(f"pair {shlex.quote(self.address)} --pin {self._pin}"),
                                    env=self._env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    user=uid, group=gid, extra_groups=[] if uid is not None else None)
        except OSError as e:
            decky.logger.warning("stream: couldn't run Moonlight to pair (%s)", e)
            self.failed = True
            return
        deadline = time.monotonic() + PAIR_GIVE_UP_SECONDS
        paired = False
        try:
            while time.monotonic() < deadline and not self._closed:
                time.sleep(1.5)
                try:
                    code, _out, _err = subprocess_util.run_command(
                        self._moonlight(f"list {shlex.quote(self.address)}"), timeout=LIST_SECONDS, env=self._env(),
                        as_data_owner=True)
                except Exception:
                    code = 1
                if code == 0:
                    paired = True
                    break
        finally:
            self.kill_moonlight()
            try:
                proc.wait(timeout=KILL_SECONDS)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        self.paired = paired
        self.failed = not paired
        decky.logger.info("stream: %s with the host", "paired" if paired else "couldn't pair")

    def kill_moonlight(self) -> None:
        try:
            subprocess_util.run_command(["flatpak", "kill", MOONLIGHT_APP], timeout=KILL_SECONDS, env=self._env(),
                                        as_data_owner=True)
        except Exception as e:
            self._debug("stream: flatpak kill failed (%s)", type(e).__name__)

    def launch_options(self, width: int, height: int, slow: bool, watch: bool) -> str:
        width, height = stream_size(width, height)
        kbps = tier_kbps(height, self.path != "direct" or self.low)
        if self.half:
            kbps //= 2
        if slow:
            kbps //= 2
        if self.cap:
            kbps = min(kbps, self.cap)
        self.kbps = kbps
        parts = ["stream", self.address, "Game", "--resolution", f"{width}x{height}", "--fps", "60",
                 "--bitrate", str(kbps), "--video-codec", "H.264", "--display-mode", "fullscreen",
                 "--no-quit-after", "--audio-on-host"]
        if self._online:
            parts += ["--packet-size", str(ONLINE_PACKET_SIZE)]
        inner = f"export XDG_CONFIG_HOME={shlex.quote(str(self._config))}; "
        if watch:
            inner += ("export SDL_GAMECONTROLLER_ALLOW_STEAM_VIRTUAL_GAMEPAD=0 "
                      "SDL_GAMECONTROLLER_IGNORE_DEVICES_EXCEPT=0x0000/0x0000; ")
        inner += "exec moonlight " + " ".join(shlex.quote(part) for part in parts)
        decky.logger.info("stream: launching Moonlight at %sx%s, %s kbps%s", width, height, kbps,
                          ", relayed" if self.path == "relay" else "")
        return f"run --user --command=sh {MOONLIGHT_APP} -c {shlex.quote(inner)}"

    def close(self) -> None:
        self._closed = True
        if self._pipe is not None:
            self._pipe.close()
            self._pipe = None
