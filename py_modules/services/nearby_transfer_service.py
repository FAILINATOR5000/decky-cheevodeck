import asyncio
import functools
import hashlib
import hmac
import secrets
import socket
import time
from collections import deque
from pathlib import Path

import decky
import nearby_protocol as proto

from services import data_transfer_service as data_codes
from services import memories_transfer_service as transfer_codes

LEASE_SECONDS = 30
VISIT_CAP_SECONDS = 600

COLLECT_SECONDS = 1.5
RESEND_AFTER_SECONDS = 0.3

HANDSHAKE_SECONDS = 5
ANSWER_SECONDS = 20
IDLE_SECONDS = 30
PROGRESS_SECONDS = 2

MAX_HANDSHAKES = 4
ANSWERS_PER_SECOND = 10

PEER_SEEN_SECONDS = 12

SUMMARY_SECONDS = 4

STREAM_CHUNK_BYTES = 1024 * 1024

CLEARED_SECONDS = 10

PAGES = ("memories", "data")
_PAGE_NAMES = {"memories": "Transfer Memories", "data": "Data Transfer"}

ERROR_NOT_GAME_MODE = "not_game_mode"
ERROR_NO_ACCOUNT = "no_account"
ERROR_NOT_VISIBLE = "not_visible"
ERROR_CAP_REACHED = "cap_reached"
ERROR_UNAVAILABLE = "unavailable"

_REFUSALS = {
    "busy": transfer_codes.ERROR_PEER_BUSY,
    "nothing": transfer_codes.ERROR_PEER_NOTHING,
    "no_space": transfer_codes.ERROR_PEER_NO_SPACE,
    "up_to_date": transfer_codes.ERROR_UP_TO_DATE,
}

_DATA_REFUSALS = {
    "busy": data_codes.ERROR_PEER_BUSY,
    "nothing": data_codes.ERROR_PEER_NOTHING,
    "different_game": data_codes.ERROR_DIFFERENT_GAME,
    "no_game": data_codes.ERROR_DIFFERENT_GAME,
    "newer_schema": data_codes.ERROR_NEWER_SCHEMA,
    "too_big": data_codes.ERROR_PAYLOAD_MISMATCH,
}

_SEND_REFUSALS = {
    transfer_codes.ERROR_BUSY: "busy",
    transfer_codes.ERROR_NOTHING_TO_EXPORT: "nothing",
    transfer_codes.ERROR_NO_SPACE: "no_space",
    transfer_codes.ERROR_UP_TO_DATE: "up_to_date",
}


def _board_name() -> str:
    try:
        raw = Path("/sys/class/dmi/id/board_name").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return "".join(ch for ch in raw if ch.isprintable()).strip()[:32]


def _host_name() -> str:
    try:
        return socket.gethostname()[:64]
    except OSError:
        return ""


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


class NearbyTransferService:
    def __init__(
        self, *, settings_store, transfer, video_busy, adopt_lock, game_mode, data=None,
        port: int = proto.PORT, peer_port: int = proto.PORT, broadcast: str = "255.255.255.255",
    ):
        self._settings_store = settings_store
        self._transfer = transfer
        self._data = data
        self._video_busy = video_busy
        self._adopt_lock = adopt_lock
        self._game_mode = game_mode
        self._port = port
        self._peer_port = peer_port
        self._broadcast = broadcast

        self._id = secrets.token_hex(8)
        self._model = _board_name()
        self._host = _host_name()

        self._loop = None
        self._visibility_lock = asyncio.Lock()
        self._summary_lock = asyncio.Lock()
        self._key = None
        self._visible_until = dict.fromkeys(PAGES, 0.0)
        self._cap_until = dict.fromkeys(PAGES, 0.0)
        self._expiry = dict.fromkeys(PAGES)
        self._udp = None
        self._responder = None
        self._closing = []
        self._server = None
        self._seen = {}
        self._answered = deque()
        self._handshakes = 0
        self._sending = False
        self._peers = {page: {} for page in PAGES}
        self._summary = None
        self._summary_at = 0.0
        self._data_summary = None
        self._data_summary_at = 0.0
        self._tasks = set()

    def set_event_loop(self, loop) -> None:
        self._loop = loop

    def _live(self, page: str) -> bool:
        return self._key is not None and time.monotonic() < self._visible_until[page]

    def _any_live(self) -> bool:
        return any(self._live(page) for page in PAGES)

    def _current_key(self):
        cfg = self._settings_store.load_config()
        return proto.session_key(cfg.get("webApiKey") or "", cfg.get("activeUlid") or "")

    async def set_visible(self, visible: bool, entry: bool = False, page: str = "memories") -> dict:
        async with self._visibility_lock:
            if not visible:
                if self._live(page):
                    decky.logger.info("nearby: %s no longer visible, the page was left", _PAGE_NAMES[page])
                self._end(page)
                return {"ok": True, "visible": False}
            if not self._game_mode():
                self.close()
                return {"ok": False, "error": ERROR_NOT_GAME_MODE}
            key = self._current_key()
            if key is None:
                self.close()
                return {"ok": False, "error": ERROR_NO_ACCOUNT}

            now = time.monotonic()
            if entry:
                self._cap_until[page] = now + VISIT_CAP_SECONDS
            elif now >= self._cap_until[page]:
                if self._live(page):
                    decky.logger.info("nearby: %s no longer visible, the visit reached its cap", _PAGE_NAMES[page])
                self._end(page)
                return {"ok": False, "error": ERROR_CAP_REACHED}

            if self._key is not None and key != self._key:
                self._shut()
            self._key = key
            if self._udp is None or self._server is None:
                if not await self._open():
                    self._shut()
                    return {"ok": False, "error": ERROR_UNAVAILABLE}

            self._visible_until[page] = min(now + LEASE_SECONDS, self._cap_until[page])
            if self._expiry[page] is not None:
                self._expiry[page].cancel()
            self._expiry[page] = asyncio.get_running_loop().call_later(
                max(0.0, self._visible_until[page] - now), self._lease_ran_out, page
            )
            return {"ok": True, "visible": True}

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
            decky.logger.warning("nearby: couldn't listen on port %s (%s)", self._port, type(e).__name__)
            return False
        decky.logger.info("nearby: visible on port %s", self._port)
        return True

    def _lease_ran_out(self, page: str) -> None:
        self._expiry[page] = None
        try:
            decky.logger.info("nearby: %s no longer visible, the lease ran out", _PAGE_NAMES[page])
        finally:
            self._visible_until[page] = 0.0
            if not self._any_live():
                self._shut()

    def _end(self, page: str) -> None:
        if self._expiry[page] is not None:
            self._expiry[page].cancel()
            self._expiry[page] = None
        self._visible_until[page] = 0.0
        self._cap_until[page] = 0.0
        self._peers[page].clear()
        if not self._any_live():
            self._shut()

    def _shut(self) -> None:
        for page in PAGES:
            if self._expiry[page] is not None:
                self._expiry[page].cancel()
                self._expiry[page] = None
            self._visible_until[page] = 0.0
        udp, server = self._udp, self._server
        if self._responder is not None:
            self._closing.append(self._responder.closed)
        self._udp = None
        self._responder = None
        self._server = None
        self._key = None
        self._seen.clear()
        self._answered.clear()
        self._summary = None
        self._data_summary = None
        if udp is not None:
            try:
                udp.close()
            except Exception as e:
                decky.logger.warning("nearby: the responder would not close (%s)", type(e).__name__)
        if server is not None:
            try:
                server.close()
            except Exception as e:
                decky.logger.warning("nearby: the listener would not close (%s)", type(e).__name__)

    def close(self) -> None:
        for page in PAGES:
            self._cap_until[page] = 0.0
            self._peers[page].clear()
        self._shut()

    def sync(self) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self._follow_mode)

    def _follow_mode(self) -> None:
        if self._key is not None and not self._game_mode():
            decky.logger.info("nearby: no longer visible, left Game Mode")
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

    def _spawn(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _heard(self, transport, data, addr) -> None:
        if not self._any_live():
            return
        message = proto.decode(data)
        page = "memories"
        nonce = proto.read_who(self._key, message, time.time()) if self._live("memories") else None
        if nonce is None and self._live("data"):
            page = "data"
            nonce = proto.read_seek(self._key, message, time.time())
        if nonce is None:
            return
        now = time.monotonic()
        for seen, at in list(self._seen.items()):
            if now - at > proto.CLOCK_SKEW_SECONDS:
                del self._seen[seen]
        if nonce in self._seen:
            return
        self._seen[nonce] = now
        while self._answered and now - self._answered[0] > 1.0:
            self._answered.popleft()
        if len(self._answered) >= ANSWERS_PER_SECOND:
            return
        self._answered.append(now)
        if page == "memories":
            self._spawn(self._answer(transport, nonce, addr))
        else:
            self._spawn(self._offer(transport, nonce, addr))

    async def _answer(self, transport, nonce, addr) -> None:
        summary = await self._library_summary()
        if summary is None or not self._live("memories") or transport.is_closing():
            return
        reply = proto.make_here(self._key, nonce, {
            **summary,
            "id": self._id,
            "model": self._model,
            "host": self._host,
            "port": self._port,
        })
        try:
            transport.sendto(reply, addr)
        except OSError:
            pass

    async def _library_summary(self):
        async with self._summary_lock:
            now = time.monotonic()
            if self._summary is not None and now - self._summary_at < SUMMARY_SECONDS:
                return self._summary
            try:
                weight = await asyncio.to_thread(self._transfer.weigh)
            except Exception as e:
                decky.logger.warning("nearby: couldn't weigh the library to answer (%s)", type(e).__name__)
                return None
            self._summary = {
                "memories": weight["memories"],
                "memoriesNoVideos": weight["memoriesNoVideos"],
                "bytes": weight["bytes"],
                "bytesNoVideos": weight["bytesNoVideos"],
                "videos": weight["clips"] > 0,
            }
            self._summary_at = time.monotonic()
            return self._summary

    async def _offer(self, transport, nonce, addr) -> None:
        summary = await self._summary_for_data()
        if summary is None or not self._live("data") or transport.is_closing():
            return
        reply = proto.make_offer(self._key, nonce, {
            **summary,
            "id": self._id,
            "model": self._model,
            "host": self._host,
            "port": self._port,
        })
        try:
            transport.sendto(reply, addr)
        except OSError:
            pass

    async def _summary_for_data(self):
        if self._data is None:
            return None
        async with self._summary_lock:
            now = time.monotonic()
            if self._data_summary is not None and now - self._data_summary_at < SUMMARY_SECONDS:
                return self._data_summary
            self._data_summary = await asyncio.to_thread(self._data.summary)
            self._data_summary_at = time.monotonic()
            return self._data_summary

    async def _collect(self, packet: bytes, read) -> dict:
        found = {}

        def heard(data, addr):
            row = read(proto.decode(data))
            if row is not None and row["id"] != self._id:
                row["address"] = addr[0]
                found[row["id"]] = row

        transport = None
        try:
            transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(
                lambda: _Collector(heard), local_addr=("0.0.0.0", 0), allow_broadcast=True
            )
            transport.sendto(packet, (self._broadcast, self._peer_port))
            await asyncio.sleep(RESEND_AFTER_SECONDS)
            transport.sendto(packet, (self._broadcast, self._peer_port))
            await asyncio.sleep(COLLECT_SECONDS - RESEND_AFTER_SECONDS)
        except OSError as e:
            decky.logger.info("nearby: couldn't ask the network (%s)", type(e).__name__)
        finally:
            if transport is not None:
                transport.close()
        return found

    def _remember(self, page: str, found: dict) -> list:
        peers = self._peers[page]
        now = time.monotonic()
        for row in found.values():
            peers[row["id"]] = (row, now)
        for device_id, (_row, at) in list(peers.items()):
            if now - at > PEER_SEEN_SECONDS:
                del peers[device_id]
        return sorted((row for row, _at in peers.values()), key=_address_order)

    async def discover(self) -> dict:
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        if not self._live("memories"):
            return {"ok": False, "error": ERROR_NOT_VISIBLE}

        key = self._key
        nonce = secrets.token_hex(16)
        self._seen[nonce] = time.monotonic()
        found = await self._collect(
            proto.make_who(key, nonce, int(time.time())),
            lambda message: proto.read_here(key, message, nonce),
        )
        rows = self._remember("memories", found)
        return {"ok": True, "devices": [_device_row(row) for row in rows]}

    async def discover_data(self) -> dict:
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        if not self._live("data"):
            return {"ok": False, "error": ERROR_NOT_VISIBLE}

        key = self._key
        nonce = secrets.token_hex(16)
        self._seen[nonce] = time.monotonic()
        found = await self._collect(
            proto.make_seek(key, nonce, int(time.time())),
            lambda message: proto.read_offer(key, message, nonce),
        )
        rows = self._remember("data", found)
        return {"ok": True, "devices": [_data_row(row) for row in rows]}

    async def start_pull(self, device_id: str, include_videos: bool, mode: str) -> dict:
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        if not self._live("memories"):
            return {"ok": False, "error": ERROR_NOT_VISIBLE}
        seen = self._peers["memories"].get(device_id)
        if seen is None:
            return {"ok": False, "error": transfer_codes.ERROR_PEER_GONE}
        row = dict(seen[0])
        peer = {"model": row["model"], "host": row["host"], "address": row["address"]}
        pull = functools.partial(self._pull, self._key, row, bool(include_videos))
        started = await asyncio.to_thread(
            self._transfer.start_receive, pull, peer, mode, bool(include_videos) and row["videos"]
        )
        if started.get("ok"):
            decky.logger.info(
                "nearby: pulling from %s",
                proto.device_label(row["model"], row["host"], row["address"]),
            )
        return started

    def _pull(self, key, row, include_videos, *, held, stage, progress, on_bytes, should_stop,
              hold_socket, room_for, open_part) -> str:
        gone = transfer_codes.ERROR_PEER_GONE
        nc = secrets.token_hex(16)
        deadline = time.monotonic() + HANDSHAKE_SECONDS
        try:
            sock = socket.create_connection((row["address"], row["port"]), timeout=HANDSHAKE_SECONDS)
        except OSError:
            return gone
        hold_socket(sock)
        try:
            try:
                sock.sendall(proto.frame({"op": "pull", "v": proto.VERSION, "nc": nc}))
                sock.settimeout(_remaining(deadline))
                ns = proto.recv_frame(sock).get("ns")
                if not proto.is_nonce(ns):
                    return gone
                block = proto.held_block(held)
                params = proto.pull_params(include_videos, self._model, self._host, block)
                sock.sendall(proto.frame({"tag": proto.pull_tag(key, nc, ns, params), "params": params}))
                sock.sendall(block)
                sock.settimeout(ANSWER_SECONDS)
                answer = proto.recv_frame(sock)
            except (OSError, proto.FrameError):
                return gone

            if answer.get("ok") is not True:
                return _REFUSALS.get(answer.get("error"), gone)
            if not proto.verify(key, answer.get("tag"), "ok", ns, nc):
                return gone

            stage("preparing")
            sock.settimeout(IDLE_SECONDS)
            return self._take_bundle(sock, key, nc, ns, stage, progress, on_bytes,
                                     should_stop, room_for, open_part)
        finally:
            hold_socket(None)
            try:
                sock.close()
            except OSError:
                pass

    async def start_data_pull(self, device_id: str, kind: str, mode: str) -> dict:
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        if not self._live("data"):
            return {"ok": False, "error": ERROR_NOT_VISIBLE}
        seen = self._peers["data"].get(device_id)
        if seen is None:
            return {"ok": False, "error": data_codes.ERROR_PEER_GONE}
        row = dict(seen[0])
        peer = {"model": row["model"], "host": row["host"], "address": row["address"]}
        game_id = None if kind == "milestones" else row["gameId"]
        fetch = functools.partial(self._fetch, self._key, row, kind, game_id)
        started = await asyncio.to_thread(self._data.start_receive, fetch, peer, kind, mode, game_id)
        if started.get("ok"):
            decky.logger.info(
                "nearby: fetching %s from %s", kind, proto.device_label(row["model"], row["host"], row["address"])
            )
        return started

    def _fetch(self, key, row, kind, game_id, *, stage, should_stop, hold_socket, apply):
        gone = data_codes.ERROR_PEER_GONE
        interrupted = data_codes.ERROR_INTERRUPTED
        mismatch = data_codes.ERROR_PAYLOAD_MISMATCH
        nc = secrets.token_hex(16)
        deadline = time.monotonic() + HANDSHAKE_SECONDS
        try:
            sock = socket.create_connection((row["address"], row["port"]), timeout=HANDSHAKE_SECONDS)
        except OSError:
            return gone, None
        hold_socket(sock)
        try:
            try:
                sock.sendall(proto.frame({"op": "fetch", "v": proto.VERSION, "nc": nc}))
                sock.settimeout(_remaining(deadline))
                ns = proto.recv_frame(sock).get("ns")
                if not proto.is_nonce(ns):
                    return gone, None
                params = proto.fetch_params(kind, game_id, self._model, self._host)
                sock.sendall(proto.frame({"tag": proto.fetch_tag(key, nc, ns, params), "params": params}))
                sock.settimeout(ANSWER_SECONDS)
                answer = proto.recv_frame(sock)
            except (OSError, proto.FrameError):
                return gone, None
            if answer.get("ok") is not True:
                return _DATA_REFUSALS.get(answer.get("error"), gone), None
            if not proto.verify(key, answer.get("tag"), "ok", ns, nc):
                return gone, None

            stage("receiving")
            sock.settimeout(IDLE_SECONDS)
            try:
                header = proto.read_data_header(key, proto.recv_frame(sock), nc, ns, kind)
                if header is None:
                    return mismatch, None
                size, sha = header
                body = bytearray()
                while len(body) < size:
                    if should_stop():
                        return interrupted, None
                    chunk = sock.recv(min(STREAM_CHUNK_BYTES, size - len(body)))
                    if not chunk:
                        return interrupted, None
                    body += chunk
            except (OSError, proto.FrameError):
                return interrupted, None
            if not hmac.compare_digest(hashlib.sha256(body).hexdigest(), sha):
                return mismatch, None

            if not stage("saving"):
                return interrupted, None
            outcome = apply(bytes(body))
            if not outcome["ok"]:
                _tell(sock, {"op": "abort"})
                return outcome["error"], None
            result = outcome["result"]
            if kind != "milestones":
                _tell(sock, {"op": "got", "tag": proto.got_tag(key, nc, ns, sha)})
                return "", result

            stage("committing")
            try:
                sock.sendall(proto.frame({"op": "committed", "tag": proto.committed_tag(key, nc, ns, sha)}))
                sock.settimeout(CLEARED_SECONDS)
                reply = proto.recv_frame(sock)
                result["sourceCleared"] = proto.read_receipt(key, reply, "cleared", nc, ns, sha)
            except (OSError, proto.FrameError):
                result["sourceCleared"] = False
            return "", result
        finally:
            hold_socket(None)
            try:
                sock.close()
            except OSError:
                pass

    def _take_bundle(self, sock, key, nc, ns, stage, progress, on_bytes, should_stop,
                     room_for, open_part) -> str:
        interrupted = transfer_codes.ERROR_INTERRUPTED
        mismatch = transfer_codes.ERROR_BUNDLE_MISMATCH
        try:
            while True:
                message = proto.recv_frame(sock)
                op = message.get("op")
                if op == "progress":
                    records, total = message.get("records"), message.get("total")
                    if type(records) is int and type(total) is int and 0 <= records <= total:
                        progress(records, total)
                    continue
                if op == "stop":
                    return _REFUSALS.get(message.get("error"), interrupted)
                break

            size = proto.bundle_size(message)
            if size is None or not proto.verify(key, message.get("tag"), "bundle", nc, ns, str(size)):
                return mismatch
            if not room_for(size):
                return transfer_codes.ERROR_NO_SPACE

            stage("receiving", size)
            digest = hashlib.sha256()
            left = size
            try:
                with open_part() as out:
                    while left > 0:
                        if should_stop():
                            return interrupted
                        chunk = sock.recv(min(STREAM_CHUNK_BYTES, left))
                        if not chunk:
                            return interrupted
                        try:
                            out.write(chunk)
                        except OSError:
                            return transfer_codes.ERROR_WRITE_FAILED
                        digest.update(chunk)
                        left -= len(chunk)
                        on_bytes(len(chunk))
            except OSError as e:
                if isinstance(e, (socket.timeout, ConnectionError)):
                    return interrupted
                return transfer_codes.ERROR_WRITE_FAILED

            end = proto.recv_frame(sock)
            sha = end.get("sha256")
            if (
                end.get("op") != "end"
                or not proto.is_tag(sha)
                or sha != digest.hexdigest()
                or not proto.verify(key, end.get("tag"), "end", nc, ns, str(size), sha)
            ):
                return mismatch
            sock.sendall(proto.frame({"op": "got", "tag": proto.got_tag(key, nc, ns, sha)}))
            return ""
        except (OSError, proto.FrameError):
            return interrupted

    async def _serve(self, reader, writer) -> None:
        if not self._any_live() or self._handshakes >= MAX_HANDSHAKES:
            writer.close()
            return
        self._handshakes += 1
        try:
            hello = await asyncio.wait_for(self._handshake(reader, writer), HANDSHAKE_SECONDS)
        except (asyncio.TimeoutError, asyncio.IncompleteReadError, OSError, proto.FrameError):
            hello = None
        finally:
            self._handshakes -= 1
        try:
            if hello is not None and self._live(hello[0]):
                if hello[0] == "memories":
                    await self._send(reader, writer, *hello[1])
                else:
                    await self._send_data(reader, writer, *hello[1])
        except Exception as e:
            decky.logger.exception("nearby: the send stopped (%s)", type(e).__name__)
        finally:
            writer.close()

    async def _handshake(self, reader, writer):
        opening = await proto.read_frame(reader)
        nc = proto.read_pull(opening)
        if nc is not None and self._live("memories"):
            hello = await self._pull_handshake(reader, writer, nc)
            return None if hello is None else ("memories", hello)
        nc = proto.read_fetch(opening)
        if nc is not None and self._live("data"):
            hello = await self._fetch_handshake(reader, writer, nc)
            return None if hello is None else ("data", hello)
        return None

    async def _fetch_handshake(self, reader, writer, nc):
        ns = secrets.token_hex(16)
        writer.write(proto.frame({"ns": ns}))
        await writer.drain()
        request = await proto.read_frame(reader)
        key = self._key
        raw = request.get("params")
        params = proto.read_fetch_params(raw)
        if params is None or key is None:
            return None
        if not proto.verify(key, request.get("tag"), "fetch", nc, ns, proto.canonical(raw)):
            return None
        peer_address = (writer.get_extra_info("peername") or ("",))[0]
        return key, nc, ns, params, peer_address

    async def _pull_handshake(self, reader, writer, nc):
        ns = secrets.token_hex(16)
        writer.write(proto.frame({"ns": ns}))
        await writer.drain()
        request = await proto.read_frame(reader)
        key = self._key
        raw = request.get("params")
        params = proto.read_params(raw)
        if params is None or key is None:
            return None
        if not proto.verify(key, request.get("tag"), "pull", nc, ns, proto.canonical(raw)):
            return None
        held = proto.read_held(await reader.readexactly(params["heldBytes"]), params["heldSha256"])
        if held is None:
            return None
        params["held"] = held
        peer_address = (writer.get_extra_info("peername") or ("",))[0]
        return key, nc, ns, params, peer_address

    async def _refusal(self, params, peer):
        if not self._game_mode():
            return "not_game_mode"
        if self._sending:
            return "busy"
        self._sending = True
        async with self._adopt_lock:
            if self._video_busy() or self._transfer.running():
                self._sending = False
                return "busy"
            began = await asyncio.to_thread(
                self._transfer.begin_send, params["includeVideos"], peer, params["held"]
            )
        if not began["ok"]:
            self._sending = False
            return _SEND_REFUSALS.get(began["error"], "busy")
        return None

    async def _send(self, reader, writer, key, nc, ns, params, peer_address) -> None:
        peer = {"model": params["model"], "host": params["host"], "address": peer_address}
        refused = await self._refusal(params, peer)
        if refused is not None:
            await _say(writer, {"ok": False, "error": refused})
            return

        export = None
        packed = None
        error = ""
        listener = None
        try:
            if not await _say(writer, {"ok": True, "tag": proto.ok_tag(key, nc, ns)}):
                return
            decky.logger.info(
                "nearby: sending to %s", proto.device_label(peer["model"], peer["host"], peer["address"])
            )
            peer_left = asyncio.Event()
            confirmed = asyncio.Event()
            sent = {}
            listener = asyncio.ensure_future(self._listen(reader, key, nc, ns, sent, peer_left, confirmed))
            export = asyncio.ensure_future(
                asyncio.to_thread(self._transfer.export_for_send, params["includeVideos"], params["held"])
            )
            stopping = False
            while not export.done():
                await asyncio.wait({export}, timeout=PROGRESS_SECONDS)
                if export.done():
                    break
                if peer_left.is_set():
                    if not stopping:
                        stopping = True
                        self._transfer.cancel()
                    continue
                status = self._transfer.status()
                if not await _say(writer, {
                    "op": "progress",
                    "records": status["records"],
                    "total": status["totalRecords"],
                }):
                    peer_left.set()
            packed = export.result()

            if packed is None:
                error = transfer_codes.ERROR_INTERRUPTED if peer_left.is_set() else ""
            else:
                error = await self._stream(writer, key, nc, ns, packed[0], sent, peer_left, confirmed)
        except Exception as e:
            decky.logger.exception("nearby: the send stopped (%s)", type(e).__name__)
            error = transfer_codes.ERROR_WRITE_FAILED
            if export is not None and not export.done():
                self._transfer.cancel()
                await asyncio.wait({export})
        finally:
            if listener is not None:
                listener.cancel()
            self._transfer.discard_send()
            self._sending = False
            delivered = packed is not None and not error and not self._transfer.stop_requested()
            self._transfer.end_send(packed[1] if delivered else None, error)

    def _data_refusal(self):
        if not self._game_mode():
            return "not_game_mode"
        if self._sending or self._data is None or self._data.running():
            return "busy"
        self._sending = True
        return None

    async def _send_data(self, reader, writer, key, nc, ns, params, peer_address) -> None:
        refused = self._data_refusal()
        if refused is not None:
            await _say(writer, {"ok": False, "error": refused})
            return
        peer = {"model": params["model"], "host": params["host"], "address": peer_address}
        label = proto.device_label(peer["model"], peer["host"], peer["address"])
        kind = params["kind"]
        move = None
        try:
            if kind == "milestones":
                move = await asyncio.to_thread(self._data.begin_move)
                built = move
                if not move["ok"]:
                    move = None
            else:
                built = await asyncio.to_thread(self._data.payload_for_send, kind, params["gameId"])
            if built["ok"] and len(built["body"]) > proto.MAX_DATA_BYTES:
                built = {"ok": False, "error": "too_big"}
            if not built["ok"]:
                await _say(writer, {"ok": False, "error": built["error"]})
                return
            body = built["body"]
            if not await _say(writer, {"ok": True, "tag": proto.ok_tag(key, nc, ns)}):
                return
            sha = hashlib.sha256(body).hexdigest()
            header = {"op": "data", "kind": kind, "size": len(body), "sha256": sha,
                      "tag": proto.data_tag(key, nc, ns, kind, len(body), sha)}
            if not await _say(writer, header):
                return
            writer.write(body)
            try:
                await asyncio.wait_for(writer.drain(), IDLE_SECONDS)
            except (OSError, asyncio.TimeoutError):
                return
            decky.logger.info("nearby: sent %s to %s", kind, label)

            if move is None:
                try:
                    await asyncio.wait_for(proto.read_frame(reader), IDLE_SECONDS)
                except (asyncio.TimeoutError, asyncio.IncompleteReadError, OSError, proto.FrameError):
                    pass
                return

            left = max(0.0, move["until"] - time.monotonic())
            try:
                reply = await asyncio.wait_for(proto.read_frame(reader), left)
            except (asyncio.TimeoutError, asyncio.IncompleteReadError, OSError, proto.FrameError):
                reply = None
            committed = proto.read_receipt(key, reply, "committed", nc, ns, sha)
            token = move["token"]
            move = None
            cleared = await asyncio.to_thread(self._data.end_move, token, committed, peer)
            if cleared:
                await _say(writer, {"op": "cleared", "tag": proto.cleared_tag(key, nc, ns, sha)})
        finally:
            if move is not None:
                await asyncio.to_thread(self._data.end_move, move["token"], False, peer)
            self._sending = False

    async def _stream(self, writer, key, nc, ns, path: Path, sent, peer_left, confirmed) -> str:
        interrupted = transfer_codes.ERROR_INTERRUPTED
        size = path.stat().st_size
        self._transfer.sending(size)
        if not await _say(writer, {"op": "bundle", "size": size, "tag": proto.bundle_tag(key, nc, ns, size)}):
            return interrupted

        digest = hashlib.sha256()
        with path.open("rb") as source:
            while True:
                if self._transfer.stop_requested():
                    return ""
                if peer_left.is_set():
                    return interrupted
                chunk = await asyncio.to_thread(_read_and_hash, source, digest)
                if not chunk:
                    break
                writer.write(chunk)
                try:
                    await asyncio.wait_for(writer.drain(), IDLE_SECONDS)
                except (OSError, asyncio.TimeoutError):
                    return interrupted
                self._transfer.add_sent(len(chunk))

        sha = digest.hexdigest()
        sent["sha"] = sha
        if not await _say(writer, {"op": "end", "sha256": sha, "tag": proto.end_tag(key, nc, ns, size, sha)}):
            return interrupted
        waiting = {asyncio.ensure_future(confirmed.wait()), asyncio.ensure_future(peer_left.wait())}
        try:
            await asyncio.wait(waiting, timeout=IDLE_SECONDS, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in waiting:
                task.cancel()
        if confirmed.is_set():
            return ""
        return interrupted

    async def _listen(self, reader, key, nc, ns, sent, peer_left, confirmed) -> None:
        try:
            message = await proto.read_frame(reader)
            sha = sent.get("sha")
            if (
                message.get("op") == "got"
                and sha is not None
                and proto.verify(key, message.get("tag"), "got", nc, ns, sha)
            ):
                confirmed.set()
                return
        except (asyncio.IncompleteReadError, OSError, proto.FrameError):
            pass
        peer_left.set()


def _tell(sock, message: dict) -> None:
    try:
        sock.sendall(proto.frame(message))
    except OSError:
        pass


def _read_and_hash(source, digest) -> bytes:
    chunk = source.read(STREAM_CHUNK_BYTES)
    if chunk:
        digest.update(chunk)
    return chunk


async def _say(writer, message: dict) -> bool:
    try:
        writer.write(proto.frame(message))
        await asyncio.wait_for(writer.drain(), IDLE_SECONDS)
    except (OSError, asyncio.TimeoutError):
        return False
    return True


def _remaining(deadline: float) -> float:
    return max(0.05, deadline - time.monotonic())


def _address_order(row):
    try:
        return tuple(int(part) for part in row["address"].split("."))
    except ValueError:
        return (999,)


def _data_row(row: dict) -> dict:
    return {
        "id": row["id"],
        "model": row["model"],
        "host": row["host"],
        "address": row["address"],
        "gameId": row["gameId"],
        "title": row["title"],
        "tracked": row["tracked"],
        "notes": row["notes"],
        "milestones": row["milestones"],
    }


def _device_row(row: dict) -> dict:
    return {
        "id": row["id"],
        "model": row["model"],
        "host": row["host"],
        "address": row["address"],
        "memories": row["memories"],
        "memoriesNoVideos": row["memoriesNoVideos"],
        "bytes": row["bytes"],
        "bytesNoVideos": row["bytesNoVideos"],
        "includesVideo": row["videos"],
    }
