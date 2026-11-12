import asyncio
import re
import secrets
import socket

import decky
import multiplayer_protocol as proto
import nearby_protocol
from nearby_protocol import FrameError

DEFAULT_PORT = 49733
CONNECT_SECONDS = 5
LEG_SECONDS = 5
PING_SECONDS = 10
SILENT_SECONDS = 30
RETRY_SECONDS = (2, 5, 10, 30)
LIST_MAX = 200
LIST_SECONDS = 15
PAGE_ROOMS = 64
CENSUS_FRAMES_MAX = 4
CENSUS_IDS_MAX = 4096
CURSOR_CHARS = 160
CONVERSATIONS_MAX = 32
FRAME_HEAD_BYTES = 4
CONVERSATION_FRAMES_MAX = 8
TUNNEL_ASKS_MAX = 64
REFUSALS = ("taken", "full", "busy")

ENVELOPE_BYTES = proto.MAX_FRAME_BYTES + 256

_HOST_NAME = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*")
_HEX16 = re.compile(r"[0-9a-f]{16}")
_TOKEN = re.compile(r"[0-9a-f]{64}")


def parse_server(value):
    text = str(value or "").strip().lower()
    if not text or len(text) > 260:
        return None
    host, _sep, port_text = text.partition(":")
    port = DEFAULT_PORT
    if port_text:
        if not port_text.isdigit() or not 0 < int(port_text) < 65536:
            return None
        port = int(port_text)
    if not proto.is_ipv4(host) and (len(host) > 253 or _HOST_NAME.fullmatch(host) is None):
        return None
    return host, port


async def connect(server):
    host, port = server
    return await asyncio.wait_for(
        asyncio.open_connection(host, port, family=socket.AF_INET), CONNECT_SECONDS
    )


def envelope(message: dict) -> bytes:
    return nearby_protocol.frame(message, ENVELOPE_BYTES)


async def read_envelope(reader) -> dict:
    return await nearby_protocol.read_frame(reader, ENVELOPE_BYTES)


async def read_envelope_or_skip(reader):
    length = nearby_protocol.frame_length(await reader.readexactly(FRAME_HEAD_BYTES), ENVELOPE_BYTES)
    raw = await reader.readexactly(length)
    try:
        return nearby_protocol.frame_body(raw, ENVELOPE_BYTES)
    except FrameError:
        return None


async def list_rooms(server, ulid: str = "", page=None, census=None) -> dict:
    return await asyncio.wait_for(_list_rooms(server, ulid, page, census), LIST_SECONDS)


async def _list_rooms(server, ulid: str, page, census) -> dict:
    reader, writer = await connect(server)
    try:
        asking = {"op": "list", "v": proto.VERSION}
        if ulid:
            asking["u"] = ulid
        if page is not None:
            asking["page"] = page
        if census is not None:
            asking["census"] = census
        writer.write(envelope(asking))
        await asyncio.wait_for(writer.drain(), LEG_SECONDS)
        rooms, ids = [], []
        total = more = None
        for _frame in range(LIST_MAX + CENSUS_FRAMES_MAX + 1):
            message = await asyncio.wait_for(read_envelope_or_skip(reader), LEG_SECONDS)
            if message is None:
                continue
            op = message.get("op")
            if op == "room":
                rooms.append((message.get("room"), message.get("away") is True))
                continue
            if op == "games":
                found = message.get("ids")
                if isinstance(found, list):
                    ids.extend(game for game in found if type(game) is int and 0 < game < 2 ** 31)
                continue
            if op == "end":
                if type(message.get("total")) is int and message["total"] >= 0:
                    total = message["total"]
                cursor = message.get("next")
                if isinstance(cursor, str) and 0 < len(cursor) <= CURSOR_CHARS:
                    more = cursor
            break
        if total is not None:
            rooms = rooms[:PAGE_ROOMS]
        return {"rooms": rooms, "ids": ids[:CENSUS_IDS_MAX], "total": total, "next": more}
    finally:
        writer.close()


async def open_ask(server, room_id: str, first: dict):
    reader, writer = await connect(server)
    try:
        writer.write(envelope({"op": "ask", "v": proto.VERSION, "room": room_id, "frame": first}))
        await asyncio.wait_for(writer.drain(), LEG_SECONDS)
    except BaseException:
        writer.close()
        raise
    return reader, writer


class LanConversation:
    door = "lan"

    def __init__(self, reader, writer):
        self._reader = reader
        self._writer = writer
        self.peer = (writer.get_extra_info("peername") or ("",))[0]
        self.own_ip = (writer.get_extra_info("sockname") or ("",))[0]

    async def read(self) -> dict:
        return await proto.read_frame(self._reader)

    async def say(self, message: dict, _more: bool = False) -> bool:
        try:
            self._writer.write(proto.frame(message))
            await asyncio.wait_for(self._writer.drain(), LEG_SECONDS)
        except FrameError:
            decky.logger.warning("multiplayer: a reply was too big to send")
            return False
        except (OSError, asyncio.TimeoutError):
            return False
        return True


class ServerConversation:
    door = "server"
    own_ip = "127.0.0.1"

    def __init__(self, link, rid: str, peer: str):
        self.peer = peer
        self._link = link
        self._rid = rid
        self._frames = asyncio.Queue(maxsize=CONVERSATION_FRAMES_MAX)

    def take(self, message: dict) -> None:
        try:
            self._frames.put_nowait(message)
        except asyncio.QueueFull:
            pass

    async def read(self) -> dict:
        return await self._frames.get()

    async def say(self, message: dict, more: bool = False) -> bool:
        try:
            proto.encode(message)
        except FrameError:
            decky.logger.warning("multiplayer: a reply was too big to send")
            return False
        return await self._link.send({"op": "resp", "rid": self._rid, "frame": message, "more": more})


class HostLink:
    def __init__(self, *, server, body: dict, on_request, on_tunnel, on_change, debug):
        self.server = server
        self.secret = secrets.token_hex(16)
        self.up = False
        self._body = body
        self._on_request = on_request
        self._on_tunnel = on_tunnel
        self._on_change = on_change
        self._debug = debug
        self._writer = None
        self._send_lock = asyncio.Lock()
        self._conversations = {}
        self._task = None
        self._tasks = set()
        self._closed = False
        self._turn_wait = None

    async def open(self) -> bool:
        reader = await self._attach()
        if reader is None:
            return False
        self._task = asyncio.ensure_future(self._run(reader))
        return True

    def update(self, body: dict) -> None:
        if body == self._body:
            return
        self._body = body
        if self.up:
            self._spawn(self.send({"op": "update", "room": body}))

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        writer = self._writer
        if writer is not None:
            try:
                writer.write(envelope({"op": "close"}))
            except (OSError, FrameError):
                pass
            writer.close()
        if self._task is not None:
            self._task.cancel()
        self._set_up(False)

    async def send(self, message: dict) -> bool:
        writer = self._writer
        if writer is None:
            return False
        async with self._send_lock:
            try:
                writer.write(envelope(message))
                await asyncio.wait_for(writer.drain(), LEG_SECONDS)
            except (OSError, asyncio.TimeoutError, FrameError):
                return False
        return True

    def _spawn(self, coro):
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _set_up(self, up: bool) -> None:
        if up != self.up:
            self.up = up
            self._on_change()

    def _log(self, message: str, *args) -> None:
        if self._task is None:
            decky.logger.info("multiplayer: " + message, *args)
        else:
            self._debug(message, *args)

    async def _attach(self):
        try:
            reader, writer = await connect(self.server)
        except (OSError, asyncio.TimeoutError) as e:
            self._log("couldn't reach the online lobby (%s)", type(e).__name__)
            return None
        try:
            writer.write(envelope({"op": "host", "v": proto.VERSION, "room": self._body, "secret": self.secret}))
            await asyncio.wait_for(writer.drain(), LEG_SECONDS)
            hello = await asyncio.wait_for(read_envelope(reader), LEG_SECONDS)
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError) as e:
            self._log("the online lobby didn't take the room (%s)", type(e).__name__)
            writer.close()
            return None
        except BaseException:
            writer.close()
            raise
        if hello.get("op") != "hosted" or hello.get("ok") is not True:
            error = hello.get("error")
            self._log("the online lobby refused the room (%s)", error if error in REFUSALS else "no reason")
            writer.close()
            return None
        if self._closed:
            writer.close()
            return None
        self._writer = writer
        self._set_up(True)
        return reader

    async def _run(self, reader) -> None:
        while not self._closed:
            pinger = asyncio.ensure_future(self._ping())
            try:
                await self._serve(reader)
            finally:
                pinger.cancel()
                writer, self._writer = self._writer, None
                if writer is not None:
                    writer.close()
                self._conversations.clear()
            if self._closed:
                return
            self._set_up(False)
            decky.logger.info("multiplayer: lost the online lobby, trying again")
            reader = None
            attempt = 0
            while reader is None and not self._closed:
                await asyncio.sleep(RETRY_SECONDS[min(attempt, len(RETRY_SECONDS) - 1)])
                attempt += 1
                reader = await self._attach()
            if reader is not None:
                decky.logger.info("multiplayer: back on the online lobby")

    async def _ping(self) -> None:
        while True:
            await asyncio.sleep(PING_SECONDS)
            self._debug("lobby ping")
            await self.send({"op": "ping"})

    async def _serve(self, reader) -> None:
        while not self._closed:
            try:
                message = await asyncio.wait_for(read_envelope(reader), SILENT_SECONDS)
            except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError):
                return
            op = message.get("op")
            if op == "req":
                self._request(message)
            elif op == "tunnel_ask":
                self._tunnel(message)
            elif op == "turn_ok":
                self._turn_answer(message)

    async def ask_turn(self, count: int):
        if self._turn_wait is not None or not self.up:
            return None
        waiting = asyncio.get_running_loop().create_future()
        self._turn_wait = waiting
        try:
            if not await self.send({"op": "turn", "n": count}):
                return None
            return await asyncio.wait_for(waiting, LEG_SECONDS)
        except asyncio.TimeoutError:
            return None
        finally:
            self._turn_wait = None

    def _turn_answer(self, message: dict) -> None:
        waiting = self._turn_wait
        creds = message.get("creds")
        if waiting is None or waiting.done() or not isinstance(creds, list) or len(creds) > proto.MAX_SEATS + 1:
            return
        kept = [{"u": cred["u"], "p": cred["p"], "ttl": cred["ttl"]} for cred in creds
                if isinstance(cred, dict) and proto.is_turn_user(cred.get("u")) and proto.is_turn_password(cred.get("p"))
                and type(cred.get("ttl")) is int and 60 <= cred["ttl"] < 2 ** 31]
        waiting.set_result(kept)

    def _request(self, message: dict) -> None:
        rid, peer, inner = message.get("rid"), message.get("peer"), message.get("frame")
        if (
            not isinstance(rid, str) or _HEX16.fullmatch(rid) is None
            or not isinstance(peer, str) or _HEX16.fullmatch(peer) is None
            or not isinstance(inner, dict)
        ):
            return
        conversation = self._conversations.get(rid)
        if conversation is not None:
            conversation.take(inner)
            return
        if len(self._conversations) >= CONVERSATIONS_MAX:
            return
        conversation = ServerConversation(self, rid, peer)
        conversation.take(inner)
        self._conversations[rid] = conversation
        task = self._spawn(self._on_request(conversation))
        task.add_done_callback(lambda _task: self._conversations.pop(rid, None))

    def _tunnel(self, message: dict) -> None:
        tid, seat, port, kind, token = (message.get("tid"), message.get("seat"), message.get("port"),
                                        message.get("kind"), message.get("token"))
        if (
            not isinstance(tid, str) or _HEX16.fullmatch(tid) is None
            or type(seat) is not int or not 1 <= seat < proto.MAX_SEATS
            or type(port) is not int or not 0 < port < 65536
            or kind not in ("tcp", "udp")
            or not isinstance(token, str) or _TOKEN.fullmatch(token) is None
            or len(self._tasks) >= TUNNEL_ASKS_MAX
        ):
            return
        ask = {"tid": tid, "seat": seat, "port": port, "kind": kind, "token": token}
        self._spawn(self._on_tunnel(self, ask))
