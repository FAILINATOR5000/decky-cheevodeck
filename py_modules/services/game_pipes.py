import asyncio
import hashlib
import hmac
import secrets
import time

import decky

import multiplayer_protocol as proto
from services import stream_room
from services.stream_pipe import StreamPipe

LABEL = "game"
MBIT = 4
USABLE = ("direct", "relay")
LAUNCH_WAIT_SECONDS = 10.0
MEET_GRACE_SECONDS = 6.0
RETRY_SECONDS = 30.0
RELAY_CONFIRM_SECONDS = 1.5


def game_token(digest: bytes, label: str) -> str:
    return hmac.new(digest, (LABEL + "|" + label).encode("ascii"), hashlib.sha256).hexdigest()


def _report_crash(task) -> None:
    if not task.cancelled() and task.exception() is not None:
        decky.logger.warning("multiplayer: a game pipe task failed (%r)", task.exception())


class HostPipes:
    def __init__(self, *, room_id: str, meet, digest: bytes, tcp_ports, udp_ports, gate, debug):
        self._room_id = room_id
        self._meet = meet
        self._digest = digest
        self._tcp_ports = tcp_ports
        self._udp_ports = udp_ports
        self._gate = gate
        self._debug = debug
        self._loop = asyncio.get_running_loop()
        self._seats = {}
        self._closed = False

    def body(self, index: int, key: bytes) -> dict:
        entry = self._seats.get(index)
        if entry is None:
            entry = {"occ": secrets.token_hex(4), "n": secrets.token_hex(16), "pipe": None}
            self._seats[index] = entry
            if self._meet is not None:
                asyncio.ensure_future(self._open(index, entry)).add_done_callback(_report_crash)
        token = bytes.fromhex(game_token(self._digest, f"{index}|{entry['occ']}"))
        return {"token": proto.wrap(key, "gtoken", entry["n"], token), "n": entry["n"], "occ": entry["occ"]}

    async def _open(self, index: int, entry: dict) -> None:
        pipe = StreamPipe(role="host", meet=self._meet, room=self._room_id, seat=index, label=LABEL,
                          token=game_token(self._digest, "host"), mbit=MBIT, occupant=entry["occ"],
                          source=f"127.0.0.{index + 1}", tcp_ports=self._tcp_ports, udp_ports=self._udp_ports,
                          gate=lambda kind, port: self._gate(index, kind, port),
                          allow_direct=not stream_room.FORCE_RELAY[0],
                          on_path=lambda path: self._debug("game pipe: seat %s path %s", index, path),
                          debug=self._debug)
        if not await pipe.start():
            decky.logger.warning("multiplayer: couldn't open the game pipe for seat %s", index)
            return
        if self._closed or self._seats.get(index) is not entry:
            pipe.close()
            return
        entry["pipe"] = pipe

    def path(self, index: int) -> str:
        entry = self._seats.get(index)
        if entry is None or entry["pipe"] is None:
            return ""
        return entry["pipe"].path

    def confirmed_paths(self, indexes) -> dict:
        relayed = [self._seats[index]["pipe"] for index in indexes
                   if self.path(index) == "relay" and self._seats[index]["pipe"] is not None]
        if relayed:
            for pipe in relayed:
                self._loop.call_soon_threadsafe(pipe.confirm_relay)
            time.sleep(RELAY_CONFIRM_SECONDS)
        return {index: self.path(index) for index in indexes}

    def seat_gone(self, index: int) -> None:
        entry = self._seats.pop(index, None)
        if entry is not None and entry["pipe"] is not None:
            entry["pipe"].close()

    def close(self) -> None:
        self._closed = True
        for entry in self._seats.values():
            if entry["pipe"] is not None:
                entry["pipe"].close()
        self._seats.clear()


class GuestPipe:
    def __init__(self, *, room_id: str, seat: int, meet, occ: str, tcp_ports, udp_ports, debug):
        self._room_id = room_id
        self._seat = seat
        self.occ = occ
        self._meet = meet
        self._tcp_ports = tcp_ports
        self._udp_ports = udp_ports
        self._debug = debug
        self._pipe = None
        self._task = None
        self._loop = None
        self._closed = False
        self.opened_at = time.monotonic()

    @property
    def dead(self) -> bool:
        return self._closed or (self._task is not None and self._task.done() and self._pipe is None)

    @property
    def path(self) -> str:
        return self._pipe.path if self._pipe is not None else ""

    def take(self, raw, key: bytes) -> None:
        if raw is None or self._closed or self._task is not None or self._meet is None:
            return
        token = proto.unwrap(key, "gtoken", raw["n"], raw["token"])
        if token is None:
            return
        self._loop = asyncio.get_running_loop()
        self._task = asyncio.ensure_future(self._open(token.hex(), self.occ))
        self._task.add_done_callback(_report_crash)

    async def _open(self, token: str, occupant: str) -> None:
        pipe = StreamPipe(role="guest", meet=self._meet, room=self._room_id, seat=self._seat, label=LABEL,
                          token=token, mbit=MBIT, occupant=occupant, tcp_ports=self._tcp_ports,
                          udp_ports=self._udp_ports, skip_busy=True, allow_direct=not stream_room.FORCE_RELAY[0],
                          on_path=lambda path: self._debug("game pipe: path %s", path), debug=self._debug)
        if not await pipe.start():
            decky.logger.warning("multiplayer: couldn't open the game pipe (its ports are taken here?)")
            return
        if self._closed:
            pipe.close()
            return
        self._pipe = pipe

    def ready(self, seconds: float) -> bool:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and not self._closed:
            pipe = self._pipe
            if pipe is not None and (pipe.path in USABLE or pipe.path == "busy" or pipe.unanswered):
                break
            if pipe is not None and not pipe.met and time.monotonic() - self.opened_at > MEET_GRACE_SECONDS:
                break
            if self._task is not None and self._task.done() and pipe is None:
                break
            time.sleep(0.25)
        pipe = self._pipe
        if not self._closed and pipe is not None and pipe.path == "relay":
            self._loop.call_soon_threadsafe(pipe.confirm_relay)
            time.sleep(RELAY_CONFIRM_SECONDS)
        return not self._closed and self.path in USABLE

    def close(self) -> None:
        self._closed = True
        if self._pipe is not None:
            self._pipe.close()
            self._pipe = None

    async def shut(self) -> None:
        self.close()
        if self._task is not None and not self._task.done():
            await asyncio.wait([self._task], timeout=2)
