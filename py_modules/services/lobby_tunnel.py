import asyncio
import struct

import decky
import multiplayer_protocol as proto
from nearby_protocol import FrameError
from services import lobby_client

PAIR_SECONDS = 8
TUNNELS_PER_SEAT = 4
CHUNK = 65536
_DATAGRAM = struct.Struct("!H")


async def _open(server, first: dict):
    reader, writer = await lobby_client.connect(server)
    try:
        writer.write(lobby_client.envelope(first))
        await asyncio.wait_for(writer.drain(), lobby_client.LEG_SECONDS)
        ack = await asyncio.wait_for(lobby_client.read_envelope(reader), PAIR_SECONDS)
    except BaseException:
        writer.close()
        raise
    if ack.get("op") != "spliced":
        writer.close()
        raise ConnectionError("not spliced")
    return reader, writer


async def splice(reader_a, writer_a, reader_b, writer_b) -> None:
    async def pump(reader, writer):
        try:
            while True:
                chunk = await reader.read(CHUNK)
                if not chunk:
                    return
                writer.write(chunk)
                await writer.drain()
        except (OSError, asyncio.IncompleteReadError):
            return

    one = asyncio.ensure_future(pump(reader_a, writer_b))
    two = asyncio.ensure_future(pump(reader_b, writer_a))
    try:
        await asyncio.wait({one, two}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in (one, two):
            task.cancel()
        for writer in (writer_a, writer_b):
            writer.close()


class _Datagrams(asyncio.DatagramProtocol):
    def __init__(self, on_datagram):
        self._on_datagram = on_datagram

    def datagram_received(self, data, addr):
        self._on_datagram(data, addr)

    def error_received(self, exc):
        pass


async def _carry_datagrams(reader, writer, send) -> None:
    try:
        while True:
            (length,) = _DATAGRAM.unpack(await reader.readexactly(_DATAGRAM.size))
            send(await reader.readexactly(length))
    except (OSError, asyncio.IncompleteReadError):
        return
    finally:
        writer.close()


def _frame_datagram(writer, data: bytes) -> None:
    if len(data) <= 0xFFFF:
        writer.write(_DATAGRAM.pack(len(data)) + data)


class GuestTunnels:
    def __init__(self, *, server, room_id: str, seat: int, seat_key: bytes, ports, debug):
        self._server = server
        self._room_id = room_id
        self._seat = seat
        self._key = seat_key
        self._ports = ports
        self._debug = debug
        self._listeners = []
        self._tasks = set()
        self._writers = set()
        self._udp = None
        self._closed = False

    async def start(self) -> bool:
        try:
            for kind, local_port, remote_port in self._ports:
                if kind == "tcp":
                    listener = await asyncio.start_server(
                        lambda r, w, port=remote_port: self._accept(r, w, port), host="127.0.0.1", port=local_port,
                        reuse_address=True,
                    )
                else:
                    listener, _protocol = await asyncio.get_running_loop().create_datagram_endpoint(
                        lambda port=remote_port: _Datagrams(lambda data, addr: self._datagram(data, addr, port)),
                        local_addr=("127.0.0.1", local_port),
                    )
                    self._udp = {"transport": listener, "peers": {}}
                self._listeners.append(listener)
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't open the game tunnel (%s)", type(e).__name__)
            self.close()
            return False
        decky.logger.info("multiplayer: game tunnel open on %s", ", ".join(
            f"{kind} {port}" for kind, port, _remote in self._ports))
        return True

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for listener in self._listeners:
            listener.close()
        for writer in list(self._writers):
            writer.close()
        for task in list(self._tasks):
            task.cancel()

    def _spawn(self, coro):
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _ask(self, kind: str, port: int) -> dict:
        return {"op": "tunnel", "v": proto.VERSION, "room": self._room_id, "seat": self._seat, "port": port,
                "kind": kind, "token": proto.tunnel_token(self._key, port)}

    def _accept(self, reader, writer, port: int) -> None:
        if self._closed:
            writer.close()
            return
        self._spawn(self._carry(reader, writer, port))

    async def _carry(self, reader, writer, port: int) -> None:
        self._writers.add(writer)
        try:
            far_reader, far_writer = await _open(self._server, self._ask("tcp", port))
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError, ConnectionError) as e:
            self._debug("the game tunnel couldn't reach the host (%s)", type(e).__name__)
            writer.close()
            self._writers.discard(writer)
            return
        self._writers.add(far_writer)
        self._debug("tunnel up for tcp %s", port)
        try:
            await splice(reader, writer, far_reader, far_writer)
        finally:
            self._writers.discard(writer)
            self._writers.discard(far_writer)
            self._debug("tunnel down for tcp %s", port)

    def _datagram(self, data: bytes, addr, port: int) -> None:
        if self._closed:
            return
        peers = self._udp["peers"]
        peer = peers.get(addr)
        if peer is None:
            peer = {"writer": None, "queue": [data]}
            peers[addr] = peer
            self._spawn(self._udp_peer(addr, peer, port))
        elif peer["writer"] is None:
            peer["queue"].append(data)
        else:
            _frame_datagram(peer["writer"], data)

    async def _udp_peer(self, addr, peer: dict, port: int) -> None:
        try:
            reader, writer = await _open(self._server, self._ask("udp", port))
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError, ConnectionError) as e:
            self._debug("the game tunnel couldn't reach the host (%s)", type(e).__name__)
            self._udp["peers"].pop(addr, None)
            return
        self._writers.add(writer)
        peer["writer"] = writer
        for data in peer["queue"]:
            _frame_datagram(writer, data)
        peer["queue"] = []
        self._debug("tunnel up for udp %s", port)
        transport = self._udp["transport"]
        try:
            await _carry_datagrams(reader, writer, lambda data: transport.sendto(data, addr))
        finally:
            self._writers.discard(writer)
            self._udp["peers"].pop(addr, None)
            self._debug("tunnel down for udp %s", port)


class HostTunnels:
    def __init__(self, *, debug):
        self._debug = debug
        self._tasks = set()
        self._closers = set()
        self._seats = {}

    def close(self) -> None:
        for close in list(self._closers):
            close()
        for task in list(self._tasks):
            task.cancel()
        self._seats.clear()

    def close_seat(self, seat: int) -> None:
        for task in list(self._seats.pop(seat, ())):
            task.cancel()

    def full(self, seat: int) -> bool:
        return len(self._seats.get(seat, ())) >= TUNNELS_PER_SEAT

    def answer(self, link, ask: dict) -> None:
        task = asyncio.ensure_future(self._answer(link, ask))
        held = self._seats.setdefault(ask["seat"], set())
        held.add(task)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        task.add_done_callback(held.discard)

    async def _answer(self, link, ask: dict) -> None:
        port = ask["port"]
        if ask["kind"] == "tcp":
            try:
                game_reader, game_writer = await asyncio.wait_for(
                    asyncio.open_connection("127.0.0.1", port), lobby_client.CONNECT_SECONDS
                )
            except (OSError, asyncio.TimeoutError):
                await link.send({"op": "tunnel_no", "tid": ask["tid"]})
                return
            self._closers.add(game_writer.close)
            try:
                far_reader, far_writer = await _open(link.server, {"op": "tunnel_back", "v": proto.VERSION,
                                                                    "tid": ask["tid"]})
            except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError, ConnectionError):
                game_writer.close()
                self._closers.discard(game_writer.close)
                return
            self._closers.add(far_writer.close)
            self._debug("tunnel up for seat %s, tcp %s", ask["seat"], port)
            try:
                await splice(game_reader, game_writer, far_reader, far_writer)
            finally:
                self._closers.discard(game_writer.close)
                self._closers.discard(far_writer.close)
            return
        await self._answer_udp(link, ask)

    async def _answer_udp(self, link, ask: dict) -> None:
        port = ask["port"]
        try:
            far_reader, far_writer = await _open(link.server, {"op": "tunnel_back", "v": proto.VERSION,
                                                                "tid": ask["tid"]})
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError, ConnectionError):
            return
        try:
            transport, _protocol = await asyncio.get_running_loop().create_datagram_endpoint(
                lambda: _Datagrams(lambda data, _addr: _frame_datagram(far_writer, data)),
                remote_addr=("127.0.0.1", port),
            )
        except OSError:
            far_writer.close()
            return
        self._closers.add(far_writer.close)
        self._closers.add(transport.close)
        self._debug("tunnel up for seat %s, udp %s", ask["seat"], port)
        try:
            await _carry_datagrams(far_reader, far_writer, transport.sendto)
        finally:
            transport.close()
            self._closers.discard(far_writer.close)
            self._closers.discard(transport.close)
