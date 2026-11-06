import asyncio
import ipaddress
import json
import os
import secrets
import socket
import struct
import time

UDP_PORTS = (47998, 47999, 48000)
TCP_PORTS = (47984, 47989, 48010)

SEGMENT_BYTES = 1100
SOCKET_BUFFER = 4 * 1024 * 1024
HELLO_SECONDS = 2.0
PUNCH_SECONDS = 8.0
PROBE_SECONDS = 0.1
V6_HEAD_START = 1.0
KEEPALIVE_SECONDS = 1.0
QUIET_SECONDS = 6.0
REPUNCH_SECONDS = 0.5
RENEW_FIRST_SECONDS = 10.0
RENEW_SECONDS = 60.0
OLD_LINK_SECONDS = 5.0
BUSY_RETRY_SECONDS = 20.0
MEET_SECONDS = 15.0
REPORT_SECONDS = 5.0
TICK_SECONDS = 0.01
IDLE_TICK_SECONDS = 0.1
RTO_INITIAL = 1.0
RTO_MIN = 0.2
RTO_MAX = 3.0
CWND_START = 4
CWND_MIN = 2
CWND_MAX = 128
DUPACKS = 3
HOLD_SEGMENTS = 1024
STREAMS_MAX = 64
STREAM_IDLE_SECONDS = 120.0
LINGER_SECONDS = 30.0

MEDIA = 0x10
OPEN = 0x20
DATA = 0x21
ACK = 0x22
FIN = 0x24
PROBE = 0x30
ANSWER = 0x31

_HEAD = struct.Struct("!BHI")
_PORT = struct.Struct("!H")
_PROBE = bytes((PROBE,))
_ANSWER = bytes((ANSWER,))


def lan_ip():
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("1.1.1.1", 80))
        return probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()


def global_ipv6():
    try:
        probe = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
    except OSError:
        return None
    try:
        probe.connect(("2001:4860:4860::8888", 80))
        address = ipaddress.IPv6Address(probe.getsockname()[0].split("%")[0])
    except (OSError, ValueError):
        return None
    finally:
        probe.close()
    if address.is_link_local or address in ipaddress.IPv6Network("fc00::/7") or not address.is_global:
        return None
    return str(address)


def _address(value):
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and type(value[1]) is int:
        return (value[0], value[1])
    return None


def _v6_address(value):
    found = _address(value)
    if found is None:
        return None
    try:
        ip = ipaddress.ip_address(found[0])
    except ValueError:
        return None
    if ip.version != 6:
        return None
    return (str(ip), found[1])


class _LinkProtocol(asyncio.DatagramProtocol):
    def __init__(self, on_datagram, on_error):
        self._on_datagram = on_datagram
        self._on_error = on_error

    def datagram_received(self, data, addr):
        self._on_datagram(data, addr)

    def error_received(self, exc):
        if self._on_error is not None:
            self._on_error(exc)


class _LocalProtocol(asyncio.DatagramProtocol):
    def __init__(self, pipe, index):
        self._pipe = pipe
        self._index = index

    def datagram_received(self, data, addr):
        self._pipe._media_out(self._index, data, addr)


class _Segment:
    __slots__ = ("frame", "resent", "sent_at")

    def __init__(self, frame):
        self.frame = frame
        self.sent_at = None
        self.resent = False


class _Stream:
    def __init__(self, pipe, cid, now):
        self.pipe = pipe
        self.cid = cid
        self.writer = None
        self.pending = []
        self.pump_task = None
        self.active_at = now

        self.send_next = 0
        self.unsent_from = 0
        self.una = 0
        self.unacked = {}
        self.room = asyncio.Event()
        self.room.set()
        self.cwnd = CWND_START
        self.grown = 0
        self.srtt = None
        self.rttvar = 0.0
        self.rto_base = RTO_INITIAL
        self.rto = RTO_INITIAL
        self.timer_at = None
        self.recover = None
        self.dupacks = 0
        self.credit = float(CWND_START)
        self.credit_at = now
        self.fin_sent = False

        self.recv_next = 0
        self.held = {}
        self.fin_received = False

    def done(self):
        return self.fin_sent and self.fin_received and not self.unacked

    def queue(self, kind, payload, now):
        self.unacked[self.send_next] = _Segment(_HEAD.pack(kind, self.cid, self.send_next) + payload)
        self.send_next += 1
        self.active_at = now
        if len(self.unacked) >= self.cwnd:
            self.room.clear()
        self.transmit(now)

    def finish(self, now):
        if not self.fin_sent:
            self.fin_sent = True
            self.queue(FIN, b"", now)

    def transmit(self, now):
        if not self.pipe.can_send():
            return
        if self.srtt is not None:
            rate = 2 * self.cwnd / max(self.srtt, 0.001)
            burst = max(4.0, rate * TICK_SECONDS)
            self.credit = min(burst, self.credit + (now - self.credit_at) * rate)
        self.credit_at = now
        while self.unsent_from < self.send_next and self.unsent_from - self.una < self.cwnd:
            if self.srtt is not None:
                if self.credit < 1:
                    break
                self.credit -= 1
            segment = self.unacked[self.unsent_from]
            self.unsent_from += 1
            segment.sent_at = now
            self.pipe.send_frame(segment.frame)
            if self.timer_at is None:
                self.timer_at = now + self.rto

    def resend_oldest(self, now):
        segment = self.unacked.get(self.una)
        if segment is None or segment.sent_at is None:
            return
        segment.sent_at = now
        segment.resent = True
        self.pipe.counters["resent"] += 1
        self.pipe.send_frame(segment.frame)
        self.timer_at = now + self.rto

    def on_timeout(self, now):
        self.cwnd = max(CWND_MIN, self.cwnd // 2)
        self.grown = 0
        self.rto = min(RTO_MAX, self.rto * 2)
        self.recover = self.unsent_from - 1
        self.dupacks = 0
        self.resend_oldest(now)

    def kick(self, now):
        self.rto = self.rto_base
        if self.unsent_from > self.una:
            self.resend_oldest(now)
        self.transmit(now)

    def on_ack(self, next_seq, now):
        if next_seq > self.unsent_from:
            return
        if next_seq <= self.una:
            if next_seq == self.una and self.unsent_from > self.una:
                self.dupacks += 1
                if self.dupacks == DUPACKS and self.recover is None:
                    self.cwnd = max(CWND_MIN, self.cwnd // 2)
                    self.grown = 0
                    self.recover = self.unsent_from - 1
                    self.resend_oldest(now)
            return
        clean = True
        newest = None
        for seq in range(self.una, next_seq):
            newest = self.unacked.pop(seq)
            if newest.resent:
                clean = False
        count = next_seq - self.una
        self.una = next_seq
        self.dupacks = 0
        self.active_at = now
        if clean:
            self._sample(now - newest.sent_at)
        self.rto = self.rto_base
        self.timer_at = None
        if self.recover is not None:
            if next_seq > self.recover:
                self.recover = None
            else:
                self.resend_oldest(now)
        if self.recover is None:
            self.grown += count
            if self.grown >= self.cwnd:
                self.grown -= self.cwnd
                self.cwnd = min(CWND_MAX, self.cwnd + 1)
        if self.timer_at is None and self.unsent_from > self.una:
            self.timer_at = now + self.rto
        self.transmit(now)
        if len(self.unacked) < self.cwnd:
            self.room.set()

    def _sample(self, rtt):
        if self.srtt is None:
            self.srtt = rtt
            self.rttvar = rtt / 2
        else:
            self.rttvar = 0.75 * self.rttvar + 0.25 * abs(self.srtt - rtt)
            self.srtt = 0.875 * self.srtt + 0.125 * rtt
        self.rto_base = min(RTO_MAX, max(RTO_MIN, self.srtt + 4 * self.rttvar))

    async def pump(self, reader):
        try:
            while True:
                while len(self.unacked) >= self.cwnd:
                    self.room.clear()
                    await self.room.wait()
                data = await reader.read(SEGMENT_BYTES)
                if not data:
                    break
                self.queue(DATA, data, time.monotonic())
        except (ConnectionError, OSError):
            pass
        self.pump_task = None
        self.finish(time.monotonic())
        self.pipe._check_done(self)

    def on_segment(self, kind, seq, payload, now):
        self.active_at = now
        if self.recv_next <= seq < self.recv_next + HOLD_SEGMENTS and seq not in self.held:
            self.held[seq] = (kind, payload)
        while self.recv_next in self.held:
            kind, payload = self.held.pop(self.recv_next)
            self.recv_next += 1
            self._deliver(kind, payload)
        self.pipe.send_frame(_HEAD.pack(ACK, self.cid, self.recv_next))

    def _deliver(self, kind, payload):
        if kind == DATA:
            if self.writer is None:
                self.pending.append(payload)
            elif not self.writer.is_closing():
                self.writer.write(payload)
        elif kind == FIN:
            self.fin_received = True
            if self.writer is not None:
                self.writer.close()
        elif kind == OPEN and len(payload) == _PORT.size:
            self.pipe._open_local(self, _PORT.unpack(payload)[0])

    def attach(self, writer):
        self.writer = writer
        for payload in self.pending:
            writer.write(payload)
        self.pending = []
        if self.fin_received:
            writer.close()

    def shut(self):
        if self.pump_task is not None and not self.pump_task.done():
            self.pump_task.cancel()
        self.pump_task = None
        if self.writer is not None:
            self.writer.close()
        self.room.set()


class StreamPipe:
    def __init__(self, *, role: str, meet: tuple, room: str, seat: int, token: str, mbit: int, occupant: str,
                 source: str = "127.0.0.1", on_path=None, debug=None,
                 tcp_ports=TCP_PORTS, udp_ports=UDP_PORTS, local_host: str = "127.0.0.1",
                 sunshine_host: str = "127.0.0.1", allow_direct: bool = True, drop_rate: float = 0.0,
                 v6_address=None):
        self._occupant = occupant
        if role not in ("host", "guest"):
            raise ValueError("role must be host or guest")
        self._role = role
        self._meet = (meet[0], int(meet[1]))
        self._room = room
        self._seat = seat
        self._token = token
        self._mbit = mbit
        self._source = source
        self._on_path = on_path
        self._debug = debug
        self._tcp_ports = tuple(tcp_ports)
        self._udp_ports = tuple(udp_ports)
        self._local_host = local_host
        self._sunshine_host = sunshine_host
        self._allow_direct = allow_direct
        self._drop_rate = drop_rate
        self._v6_address = v6_address
        self._blackout_until = 0.0

        self._path = "punching"
        self._closed = False
        self._started = False
        self._link = None
        self._link_sock = None
        self._link6 = None
        self._port = 0
        self._port6 = 0
        self._sockets = []
        self._transports = []
        self._servers = []
        self._tasks = set()
        self._media = []
        self._moonlight = []

        self._public = None
        self._started_at = 0.0
        self._peer_public = None
        self._peer_lan = None
        self._peer_v6 = None
        self._candidates = set()
        self._verified = set()
        self._direct = None
        self._direct_via = None
        self._heard_at = 0.0
        self._keepalive_at = 0.0
        self._punch_started = 0.0
        self._probe_at = 0.0
        self._relay_refused = False
        self._busy_at = 0.0
        self._was_direct = False
        self._renew_at = 0.0

        self._streams = {}
        self._lingering = {}
        self._next_cid = secrets.randbelow(32768) * 2 + 1

        self.counters = {"up": 0, "down": 0, "resent": 0, "probes_out": 0, "probes_in": 0, "answers_in": 0}
        self._reported = dict(self.counters)
        self._report_at = 0.0
        self._last_rtt = None
        self._last_cwnd = CWND_START

    @property
    def path(self) -> str:
        return self._path

    @property
    def unanswered(self) -> bool:
        return self._public is None and self._started_at > 0 and time.monotonic() - self._started_at > MEET_SECONDS

    async def start(self) -> bool:
        self._started_at = time.monotonic()
        loop = asyncio.get_running_loop()
        try:
            found = await loop.getaddrinfo(self._meet[0], self._meet[1], family=socket.AF_INET,
                                           type=socket.SOCK_DGRAM)
            self._meet = found[0][4][:2]
            link = self._socket(socket.AF_INET)
            link.bind(("0.0.0.0", 0))
            self._port = link.getsockname()[1]
            self._link_sock = link
            self._link = await self._endpoint(_LinkProtocol(self._received, None), link)
            if self._closed:
                raise OSError("closed while starting")
            await self._start_v6()

            for index, port in enumerate(self._udp_ports):
                local = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self._sockets.append(local)
                if self._role == "host":
                    local.bind((self._source, 0))
                    local.connect((self._sunshine_host, port))
                else:
                    local.bind((self._local_host, port))
                self._media.append(await self._endpoint(_LocalProtocol(self, index), local))
                self._moonlight.append(None)
                if self._closed:
                    raise OSError("closed while starting")

            if self._role == "guest":
                for port in self._tcp_ports:
                    server = await asyncio.start_server(self._accepter(port), self._local_host, port,
                                                        reuse_address=True)
                    self._servers.append(server)
                    if self._closed:
                        raise OSError("closed while starting")
        except OSError as error:
            self._say("stream pipe (%s seat %s) could not start: %s", self._role, self._seat, error)
            self._closed = True
            self._teardown()
            return False

        self._started = True
        self._report_at = time.monotonic() + REPORT_SECONDS
        self._spawn(self._hello_loop())
        self._spawn(self._path_loop())
        self._spawn(self._stream_loop())
        self._say("stream pipe (%s seat %s) up on udp %s%s", self._role, self._seat, self._port,
                  f", v6 udp {self._port6}" if self._link6 is not None else "")
        if self._on_path is not None:
            self._on_path(self._path)
        return True

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._path = "closed"
        self._teardown()

    def blackout(self, seconds: float) -> None:
        self._blackout_until = time.monotonic() + seconds

    def _teardown(self):
        self._path = "closed"
        for task in list(self._tasks):
            task.cancel()
        self._tasks.clear()
        for server in self._servers:
            server.close()
        self._servers = []
        for stream in list(self._streams.values()):
            stream.shut()
        self._streams.clear()
        for transport in self._transports:
            transport.abort()
        self._transports = []
        for sock in self._sockets:
            sock.close()
        self._sockets = []
        self._link = None
        self._link6 = None
        self._direct = None
        self._direct_via = None
        self._media = []

    def _socket(self, family):
        sock = socket.socket(family, socket.SOCK_DGRAM)
        self._sockets.append(sock)
        for option in (socket.SO_RCVBUF, socket.SO_SNDBUF):
            try:
                sock.setsockopt(socket.SOL_SOCKET, option, SOCKET_BUFFER)
            except OSError:
                pass
        return sock

    async def _endpoint(self, protocol, sock):
        transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(lambda: protocol, sock=sock)
        self._transports.append(transport)
        return transport

    async def _start_v6(self):
        if not self._allow_direct:
            return
        if self._v6_address is None and global_ipv6() is None:
            return
        try:
            sock = self._socket(socket.AF_INET6)
            sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            sock.bind(("::", 0))
            self._port6 = sock.getsockname()[1]
            self._link6 = await self._endpoint(_LinkProtocol(self._received6, self._link6_error), sock)
        except OSError:
            self._link6 = None

    def _spawn(self, coroutine):
        task = asyncio.ensure_future(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _say(self, message, *args):
        if self._debug is not None:
            self._debug(message, *args)

    async def _hello_loop(self):
        while True:
            self._hello()
            await asyncio.sleep(HELLO_SECONDS)

    def _hello(self):
        message = {"op": "hello", "room": self._room, "seat": self._seat, "role": self._role,
                   "occ": self._occupant, "token": self._token, "mbit": self._mbit}
        ip = lan_ip()
        if ip:
            message["lan"] = [ip, self._port]
        if self._link6 is not None:
            ip6 = self._v6_address or global_ipv6()
            if ip6:
                message["v6"] = [ip6, self._port6]
        self._link.sendto(b"\x00" + json.dumps(message, separators=(",", ":")).encode("ascii"), self._meet)

    def _control(self, raw):
        try:
            message = json.loads(raw.decode("ascii"))
        except (ValueError, UnicodeDecodeError):
            return
        if not isinstance(message, dict):
            return
        op = message.get("op")
        if op == "you":
            self._public = _address(message.get("addr"))
        elif op == "peer":
            self._on_peer(message)
        elif op == "busy":
            self._on_busy()

    def _on_peer(self, message):
        public = _address(message.get("addr"))
        if public is None:
            return
        self._peer_lan = _address(message.get("lan"))
        self._peer_v6 = _v6_address(message.get("v6"))
        self._candidates = {public}
        if self._peer_lan is not None:
            self._candidates.add(self._peer_lan)
        if self._peer_v6 is not None:
            self._candidates.add(self._peer_v6)
        self._verified &= self._candidates
        if public == self._peer_public:
            return
        first = self._peer_public is None
        self._peer_public = public
        self._say("stream pipe (%s seat %s): peer at %s:%s, lan %s, v6 %s", self._role, self._seat,
                  public[0], public[1], self._peer_lan, self._peer_v6)
        if self._path == "busy":
            return
        now = time.monotonic()
        if not self._allow_direct:
            self._fall_back("relay forced")
            return
        if self._direct is not None and self._direct in self._candidates:
            return
        self._direct = None
        if first or self._path == "punching":
            self._punch_started = now
            self._set_path("punching")
        else:
            self._probe_at = now
            self._fall_back("peer moved, punching again")

    def _on_busy(self):
        self._relay_refused = True
        self._busy_at = time.monotonic()
        if self._direct is None and self._path != "busy":
            self._say("stream pipe (%s seat %s): path busy (the meeting point can't relay)", self._role, self._seat)
            self._set_path("busy")

    def _set_path(self, path):
        if path == self._path or self._closed:
            return
        self._path = path
        if self._on_path is not None:
            self._on_path(path)

    def can_send(self):
        return self._direct is not None or self._path == "relay"

    def _fall_back(self, why):
        if self._direct is not None:
            self._renew_at = time.monotonic() + RENEW_FIRST_SECONDS
        self._direct = None
        self._direct_via = None
        if self._relay_refused:
            self._say("stream pipe (%s seat %s): path busy (%s)", self._role, self._seat, why)
            self._set_path("busy")
            return
        self._say("stream pipe (%s seat %s): path relay (%s)", self._role, self._seat, why)
        self._set_path("relay")
        self._out(self._link, b"\x01" + _PROBE, self._meet)
        self._kick_streams()

    def _go_direct(self, addr, now):
        self._direct = addr
        self._direct_via = self._link6 if ":" in addr[0] else self._link
        self._heard_at = now
        self._keepalive_at = now + KEEPALIVE_SECONDS
        self._say("stream pipe (%s seat %s): path direct via %s:%s after %.1f s", self._role, self._seat,
                  addr[0], addr[1], now - self._punch_started)
        self._was_direct = True
        self._set_path("direct")
        self._kick_streams()

    def _kick_streams(self):
        now = time.monotonic()
        for stream in list(self._streams.values()):
            stream.kick(now)

    async def _path_loop(self):
        while True:
            await asyncio.sleep(PROBE_SECONDS)
            now = time.monotonic()
            self._steer(now)
            if now >= self._report_at:
                self._report(now)

    def _steer(self, now):
        if self._path == "busy" and now - self._busy_at > BUSY_RETRY_SECONDS:
            self._relay_refused = False
            self._fall_back("asking the relay again")
        if self._peer_public is None or not self._allow_direct:
            return
        if self._direct is not None:
            if now - self._heard_at > QUIET_SECONDS:
                self._probe_at = now
                self._punch_started = now
                self._fall_back(f"direct path quiet for {QUIET_SECONDS:.0f} s, punching again")
            elif now >= self._keepalive_at:
                self._keepalive_at = now + KEEPALIVE_SECONDS
                self.counters["probes_out"] += 1
                self._out(self._direct_via, _PROBE, self._direct)
            return
        if self._path == "punching":
            if now - self._punch_started > PUNCH_SECONDS:
                self._probe_at = now + REPUNCH_SECONDS
                self._fall_back(f"no answer to probes in {PUNCH_SECONDS:.0f} s")
            else:
                self._send_probes(now - self._punch_started)
        elif now >= self._probe_at:
            self._probe_at = now + REPUNCH_SECONDS
            self._send_probes(PUNCH_SECONDS)
            if self._path == "relay" and self._was_direct and now >= self._renew_at:
                self._renew_at = now + RENEW_SECONDS
                self._spawn(self._renew_link())

    def _send_probes(self, elapsed):
        both_v6 = self._link6 is not None and self._peer_v6 is not None
        if both_v6:
            self.counters["probes_out"] += 1
            self._out(self._link6, _PROBE, self._peer_v6)
        if both_v6 and elapsed < V6_HEAD_START:
            return
        self.counters["probes_out"] += 1
        self._out(self._link, _PROBE, self._peer_public)
        if self._peer_lan is not None and self._peer_lan != self._peer_public:
            self._out(self._link, _PROBE, self._peer_lan)

    async def _renew_link(self):
        sock = self._socket(socket.AF_INET)
        try:
            sock.bind(("0.0.0.0", 0))
            link = await self._endpoint(_LinkProtocol(self._received, None), sock)
        except OSError as error:
            self._sockets.remove(sock)
            sock.close()
            self._say("stream pipe (%s seat %s): no fresh socket (%s)", self._role, self._seat, error)
            return
        if self._closed:
            return
        if self._direct is not None:
            self._retire(link, sock)
            return
        old, old_sock = self._link, self._link_sock
        old.get_protocol()._on_datagram = self._received_relay_only
        self._link, self._link_sock = link, sock
        self._port = sock.getsockname()[1]
        self._hello()
        self._probe_at = time.monotonic()
        self._say("stream pipe (%s seat %s): fresh socket on udp %s, punching again", self._role, self._seat,
                  self._port)
        await asyncio.sleep(OLD_LINK_SECONDS)
        self._retire(old, old_sock)

    def _retire(self, link, sock):
        link.abort()
        if link in self._transports:
            self._transports.remove(link)
        if sock in self._sockets:
            self._sockets.remove(sock)
        sock.close()

    def _received_relay_only(self, data, addr):
        if addr == self._meet:
            self._received(data, addr)

    def _drop_v6(self):
        if self._link6 is None:
            return
        self._link6.abort()
        self._link6 = None
        self._say("stream pipe (%s seat %s): IPv6 failed, carrying on without it", self._role, self._seat)
        if self._direct is not None and ":" in self._direct[0]:
            self._probe_at = time.monotonic()
            self._fall_back("IPv6 path failed, punching again")

    def _link6_error(self, error):
        if isinstance(error, OSError):
            self._drop_v6()

    def _out(self, transport, data, addr):
        if self._drop_rate or self._blackout_until:
            if addr != self._meet and time.monotonic() < self._blackout_until:
                return
            if self._drop_rate and int.from_bytes(os.urandom(2), "big") < self._drop_rate * 65536:
                return
        if transport is not None:
            transport.sendto(data, addr)

    def send_frame(self, frame):
        if self._direct is not None:
            self._out(self._direct_via, frame, self._direct)
        elif self._path == "relay":
            self._out(self._link, b"\x01" + frame, self._meet)
        else:
            return
        self.counters["up"] += len(frame)

    def _received6(self, data, addr):
        self._received(data, (addr[0], addr[1]))

    def _received(self, data, addr):
        if not data:
            return
        if addr == self._meet:
            if data[0] == 1:
                if len(data) > 1:
                    self._frame(data[1:])
            elif data[0] == 0:
                self._control(data[1:])
            return
        if self._blackout_until and time.monotonic() < self._blackout_until:
            return
        if not self._allow_direct:
            return
        kind = data[0]
        if addr == self._direct:
            self._heard_at = time.monotonic()
        elif addr not in self._verified:
            if (kind == PROBE or kind == ANSWER) and addr in self._candidates:
                self._probe(kind, addr)
            return
        if kind == PROBE or kind == ANSWER:
            self._probe(kind, addr)
            return
        self._frame(data)

    def _probe(self, kind, addr):
        if kind == PROBE:
            self.counters["probes_in"] += 1
            self._out(self._link6 if ":" in addr[0] else self._link, _ANSWER, addr)
        else:
            self.counters["answers_in"] += 1
        self._verified.add(addr)
        if self._direct is None and self._path in ("punching", "relay"):
            self._go_direct(addr, time.monotonic())

    def _frame(self, data):
        self.counters["down"] += len(data)
        kind = data[0]
        if kind == MEDIA:
            if len(data) > 2:
                self._media_in(data[1], data[2:])
            return
        if len(data) < _HEAD.size:
            return
        kind, cid, seq = _HEAD.unpack_from(data)
        if kind == ACK:
            stream = self._streams.get(cid)
            if stream is not None:
                stream.on_ack(seq, time.monotonic())
                self._last_rtt = stream.srtt
                self._last_cwnd = stream.cwnd
                self._check_done(stream)
        elif kind in (OPEN, DATA, FIN):
            self._segment(kind, cid, seq, data[_HEAD.size:])

    def _media_out(self, index, data, addr):
        if self._role == "guest":
            self._moonlight[index] = addr
        self.send_frame(bytes((MEDIA, index)) + data)

    def _media_in(self, index, payload):
        if index >= len(self._media):
            return
        if self._role == "host":
            self._media[index].sendto(payload)
        else:
            moonlight = self._moonlight[index]
            if moonlight is not None:
                self._media[index].sendto(payload, moonlight)

    def _accepter(self, port):
        async def accept(reader, writer):
            await self._accept(reader, writer, port)
        return accept

    async def _accept(self, reader, writer, port):
        if self._closed or self._path == "busy" or len(self._streams) >= STREAMS_MAX:
            writer.close()
            return
        now = time.monotonic()
        cid = self._new_cid()
        stream = _Stream(self, cid, now)
        self._streams[cid] = stream
        stream.attach(writer)
        stream.queue(OPEN, _PORT.pack(port), now)
        stream.pump_task = asyncio.current_task()
        await stream.pump(reader)

    def _new_cid(self):
        while True:
            cid = self._next_cid
            self._next_cid = cid + 2 if cid < 65533 else 1
            if cid not in self._streams and cid not in self._lingering:
                return cid

    def _segment(self, kind, cid, seq, payload):
        now = time.monotonic()
        stream = self._streams.get(cid)
        if stream is None:
            lingering = self._lingering.get(cid)
            if lingering is not None:
                self.send_frame(_HEAD.pack(ACK, cid, lingering[0]))
                return
            if (kind != OPEN or seq != 0 or self._role != "host" or cid % 2 == 0
                    or len(self._streams) >= STREAMS_MAX):
                return
            stream = _Stream(self, cid, now)
            self._streams[cid] = stream
        stream.on_segment(kind, seq, payload, now)
        self._check_done(stream)

    def _open_local(self, stream, port):
        if self._role != "host":
            return
        if port not in self._tcp_ports:
            stream.finish(time.monotonic())
            return
        self._spawn(self._connect(stream, port))

    async def _connect(self, stream, port):
        try:
            reader, writer = await asyncio.open_connection(self._sunshine_host, port,
                                                           local_addr=(self._source, 0))
        except OSError:
            stream.finish(time.monotonic())
            self._check_done(stream)
            return
        if self._streams.get(stream.cid) is not stream:
            writer.close()
            return
        stream.attach(writer)
        stream.pump_task = self._spawn(stream.pump(reader))

    def _check_done(self, stream):
        if stream.done() and self._streams.get(stream.cid) is stream:
            self._drop(stream, time.monotonic())

    def _drop(self, stream, now):
        del self._streams[stream.cid]
        self._lingering[stream.cid] = (stream.recv_next, now)
        stream.shut()

    async def _stream_loop(self):
        while True:
            await asyncio.sleep(TICK_SECONDS if self._streams else IDLE_TICK_SECONDS)
            now = time.monotonic()
            sending = self.can_send()
            for stream in list(self._streams.values()):
                if now - stream.active_at > STREAM_IDLE_SECONDS:
                    self._drop(stream, now)
                    continue
                if sending:
                    if stream.timer_at is not None and now >= stream.timer_at:
                        stream.on_timeout(now)
                    stream.transmit(now)
            if self._lingering:
                for cid in [cid for cid, (_, at) in self._lingering.items() if now - at > LINGER_SECONDS]:
                    del self._lingering[cid]

    def _report(self, now):
        self._report_at = now + REPORT_SECONDS
        last = self._reported
        self._reported = dict(self.counters)
        if self._debug is None:
            return
        change = {key: self.counters[key] - last[key] for key in self.counters}
        if not change["up"] and not change["down"]:
            return
        if self._direct is not None:
            where = f"direct {self._direct[0]}:{self._direct[1]}"
        else:
            where = self._path
        rtt = "-" if self._last_rtt is None else f"{self._last_rtt * 1000:.0f}"
        self._debug("stream pipe (%s seat %s) [%s] up %.2f Mbit/s down %.2f Mbit/s resent %d "
                    "probes out/in/answers %d/%d/%d rtt %s ms cwnd %d",
                    self._role, self._seat, where,
                    change["up"] * 8 / REPORT_SECONDS / 1e6, change["down"] * 8 / REPORT_SECONDS / 1e6,
                    change["resent"], change["probes_out"], change["probes_in"], change["answers_in"],
                    rtt, self._last_cwnd)
