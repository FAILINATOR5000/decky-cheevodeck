import asyncio
import functools
import hashlib
import secrets
import socket
import time
from collections import deque
from pathlib import Path

import decky
import nearby_protocol as proto

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

    def connection_made(self, transport):
        self._transport = transport

    def datagram_received(self, data, addr):
        self._service._heard(self._transport, data, addr)

    def error_received(self, exc):
        pass


class _Collector(asyncio.DatagramProtocol):
    def __init__(self, on_datagram):
        self._on_datagram = on_datagram

    def datagram_received(self, data, addr):
        self._on_datagram(data, addr)

    def error_received(self, exc):
        pass


class NearbyTransferService:
    def __init__(
        self, *, settings_store, transfer, video_busy, adopt_lock, game_mode,
        port: int = proto.PORT, peer_port: int = proto.PORT, broadcast: str = "255.255.255.255",
    ):
        self._settings_store = settings_store
        self._transfer = transfer
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
        self._visible_until = 0.0
        self._cap_until = 0.0
        self._expiry = None
        self._udp = None
        self._server = None
        self._seen = {}
        self._answered = deque()
        self._handshakes = 0
        self._sending = False
        self._peers = {}
        self._summary = None
        self._summary_at = 0.0
        self._tasks = set()

    def set_event_loop(self, loop) -> None:
        self._loop = loop

    def _live(self) -> bool:
        return self._key is not None and time.monotonic() < self._visible_until

    def _current_key(self):
        cfg = self._settings_store.load_config()
        return proto.session_key(cfg.get("webApiKey") or "", cfg.get("activeUlid") or "")

    async def set_visible(self, visible: bool, entry: bool = False) -> dict:
        async with self._visibility_lock:
            if not visible:
                if self._key is not None:
                    decky.logger.info("nearby: no longer visible, the page was left")
                self.close()
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
                self._cap_until = now + VISIT_CAP_SECONDS
            elif now >= self._cap_until:
                if self._key is not None:
                    decky.logger.info("nearby: no longer visible, the visit reached its cap")
                self.close()
                return {"ok": False, "error": ERROR_CAP_REACHED}

            if self._key is not None and key != self._key:
                self._shut()
            self._key = key
            if self._udp is None or self._server is None:
                if not await self._open():
                    self._shut()
                    return {"ok": False, "error": ERROR_UNAVAILABLE}

            self._visible_until = min(now + LEASE_SECONDS, self._cap_until)
            if self._expiry is not None:
                self._expiry.cancel()
            self._expiry = asyncio.get_running_loop().call_later(
                max(0.0, self._visible_until - now), self._lease_ran_out
            )
            return {"ok": True, "visible": True}

    async def _open(self) -> bool:
        loop = asyncio.get_running_loop()
        try:
            self._udp, _ = await loop.create_datagram_endpoint(
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

    def _lease_ran_out(self) -> None:
        self._expiry = None
        try:
            decky.logger.info("nearby: no longer visible, the lease ran out")
        finally:
            self._shut()

    def _shut(self) -> None:
        if self._expiry is not None:
            self._expiry.cancel()
            self._expiry = None
        udp, server = self._udp, self._server
        self._udp = None
        self._server = None
        self._key = None
        self._visible_until = 0.0
        self._seen.clear()
        self._answered.clear()
        self._summary = None
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
        self._cap_until = 0.0
        self._peers.clear()
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
        if not self._live():
            return
        nonce = proto.read_who(self._key, proto.decode(data), time.time())
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
        self._spawn(self._answer(transport, nonce, addr))

    async def _answer(self, transport, nonce, addr) -> None:
        summary = await self._library_summary()
        if summary is None or not self._live() or transport.is_closing():
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

    async def discover(self) -> dict:
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        if not self._live():
            return {"ok": False, "error": ERROR_NOT_VISIBLE}

        key = self._key
        nonce = secrets.token_hex(16)
        found = {}

        def heard(data, addr):
            row = proto.read_here(key, proto.decode(data), nonce)
            if row is not None and row["id"] != self._id:
                row["address"] = addr[0]
                found[row["id"]] = row

        self._seen[nonce] = time.monotonic()
        packet = proto.make_who(key, nonce, int(time.time()))
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

        now = time.monotonic()
        for row in found.values():
            self._peers[row["id"]] = (row, now)
        for device_id, (_row, at) in list(self._peers.items()):
            if now - at > PEER_SEEN_SECONDS:
                del self._peers[device_id]
        rows = sorted((row for row, _at in self._peers.values()), key=_address_order)
        return {"ok": True, "devices": [_device_row(row) for row in rows]}

    async def start_pull(self, device_id: str, include_videos: bool, mode: str) -> dict:
        if not self._game_mode():
            return {"ok": False, "error": ERROR_NOT_GAME_MODE}
        if not self._live():
            return {"ok": False, "error": ERROR_NOT_VISIBLE}
        seen = self._peers.get(device_id)
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
        if not self._live() or self._handshakes >= MAX_HANDSHAKES:
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
            if hello is not None and self._live():
                await self._send(reader, writer, *hello)
        except Exception as e:
            decky.logger.exception("nearby: the send stopped (%s)", type(e).__name__)
        finally:
            writer.close()

    async def _handshake(self, reader, writer):
        nc = proto.read_pull(await proto.read_frame(reader))
        if nc is None:
            return None
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
