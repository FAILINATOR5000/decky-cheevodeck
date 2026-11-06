import asyncio
import os
import secrets
import shlex
import subprocess
import time
from pathlib import Path

import decky

import multiplayer_protocol as proto
import subprocess_util
from services.stream_setup import MOONLIGHT_APP
from utils import child_owner


PAIR_POLL_SECONDS = 1.0
PAIR_GIVE_UP_SECONDS = 45
LIST_SECONDS = 10
GUEST_PAIR_RETRY_SECONDS = 10
KILL_SECONDS = 10

TIERS = ((800, 10000, 6000), (1080, 20000, 12000))
STANDARD_KBPS = TIERS[0][1]
STREAM_MBIT_DECLARED = 20


def _bare(address: str) -> str:
    return address[7:] if address.startswith("::ffff:") else address


class HostStreams:
    def __init__(self, *, sunshine, room_id: str, online: bool, slow: bool, debug):
        self._sunshine = sunshine
        self._room_id = room_id
        self._online = online
        self._slow = slow
        self._debug = debug
        self._seats = {}
        self._pairing = None
        self._closed = False
        self.capacity = 0

    def seat_taken(self, index: int, ip: str, piped: bool) -> None:
        self._seats.pop(index, None)
        entry = {
            "pin": f"{secrets.randbelow(10000):04d}",
            "occ": secrets.token_hex(4),
            "n": secrets.token_hex(16),
            "ip": ip,
            "source": f"127.0.0.{index + 1}",
            "piped": piped and self._online,
            "paired": False,
            "since": time.monotonic(),
            "reported": "",
        }
        self._seats[index] = entry
        if self._pairing is None or self._pairing.done():
            self._pairing = asyncio.ensure_future(self._pair_loop())
            self._pairing.add_done_callback(_report_crash)

    def seat_gone(self, index: int) -> None:
        self._seats.pop(index, None)

    def report(self, index: int, state: str) -> None:
        entry = self._seats.get(index)
        if entry is None:
            return
        if state == "failed" and entry["paired"] and entry["reported"] != "failed":
            entry["pin"] = f"{secrets.randbelow(10000):04d}"
            entry["paired"] = False
            if self._pairing is None or self._pairing.done():
                self._pairing = asyncio.ensure_future(self._pair_loop())
                self._pairing.add_done_callback(_report_crash)
        entry["reported"] = state

    def streaming(self) -> bool:
        return any(entry["reported"] in ("connecting", "streaming", "relay") or not entry["paired"]
                   for entry in self._seats.values())

    def seat_state(self, index: int) -> str:
        entry = self._seats.get(index)
        if entry is None:
            return ""
        if entry["reported"] == "failed" or entry["paired"]:
            return entry["reported"]
        return "pairing"

    def body(self, index: int, key: bytes, order: int) -> dict:
        entry = self._seats.get(index)
        if entry is None:
            return {"pin": "", "token": "", "n": secrets.token_hex(16), "cap": 0, "full": False}
        return {
            "pin": proto.wrap_pin(key, entry["n"], entry["pin"]) if not entry["paired"] else "",
            "token": "",
            "n": entry["n"],
            "cap": self.cap_kbps(),
            "full": self.capacity > 0 and order > self.capacity,
            "occ": entry["occ"],
        }

    def cap_kbps(self) -> int:
        cap = 0
        if self._slow:
            cap = STANDARD_KBPS // 2 if cap == 0 else max(500, cap // 2)
        return cap

    async def _pair_loop(self) -> None:
        while not self._closed:
            waiting = [entry for entry in self._seats.values() if not entry["paired"]]
            if not waiting:
                return
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
                                                 f"cheevodeck-{entry['source'].rsplit('.', 1)[1]}")
                except Exception as e:
                    self._debug("stream: answering a pairing request failed (%s)", type(e).__name__)
                    ok = False
                if ok:
                    entry["paired"] = True
                    decky.logger.info("stream: paired a guest from %s", "the pipe" if entry["piped"] else address)
            await asyncio.sleep(PAIR_POLL_SECONDS)

    def close(self) -> None:
        self._closed = True
        if self._pairing is not None:
            self._pairing.cancel()
        self._seats.clear()


def _report_crash(task) -> None:
    if not task.cancelled() and task.exception() is not None:
        decky.logger.warning("stream: a background task failed (%r)", task.exception())


class GuestStream:
    def __init__(self, *, user_home: Path, config: Path, room_id: str, seat: int, online: bool, host_ip: str, debug):
        self._user_home = Path(user_home)
        self._config = Path(config)
        self._room_id = room_id
        self._seat = seat
        self._online = online
        self._host_ip = host_ip
        self._debug = debug
        self.address = "127.0.0.1" if online else host_ip
        self.paired = False
        self.failed = False
        self.full = False
        self.cap = 0
        self._pin = ""
        self._pairing = None
        self._tried_at = 0.0
        self._closed = False

    def take(self, stream, key: bytes) -> None:
        if stream is None or self._closed:
            return
        self.cap = stream["cap"]
        self.full = stream["full"]
        if self.paired or not stream["pin"]:
            return
        pin = proto.unwrap_pin(key, stream["n"], stream["pin"])
        if pin is None:
            return
        busy = self._pairing is not None and not self._pairing.done()
        if busy or (self.failed and time.monotonic() - self._tried_at < GUEST_PAIR_RETRY_SECONDS):
            return
        if self._online:
            return
        self._pin = pin
        self._tried_at = time.monotonic()
        self._pairing = asyncio.ensure_future(asyncio.to_thread(self._pair))

    def state(self, launched: bool, seen: bool) -> str:
        if self.failed and not self.paired:
            return "failed"
        if not self.paired:
            return "pairing"
        if not launched:
            return ""
        if not seen:
            return "connecting"
        return "streaming"

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

    def close(self) -> None:
        self._closed = True
