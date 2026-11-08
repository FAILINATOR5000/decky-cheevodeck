import os
import socket
import struct
import threading

SYSTEM_BUS = "/run/dbus/system_bus_socket"

DBUS = "org.freedesktop.DBus"
DBUS_PATH = "/org/freedesktop/DBus"
PROPERTIES = "org.freedesktop.DBus.Properties"
DISCONNECTED = "org.freedesktop.DBus.Error.Disconnected"
NO_REPLY = "org.freedesktop.DBus.Error.NoReply"

NM = "org.freedesktop.NetworkManager"
NM_PATH = "/org/freedesktop/NetworkManager"
NM_SETTINGS_PATH = "/org/freedesktop/NetworkManager/Settings"
NM_SETTINGS = "org.freedesktop.NetworkManager.Settings"
NM_CONNECTION = "org.freedesktop.NetworkManager.Settings.Connection"
NM_DEVICE = "org.freedesktop.NetworkManager.Device"
NM_WIRELESS = "org.freedesktop.NetworkManager.Device.Wireless"
NM_ACCESS_POINT = "org.freedesktop.NetworkManager.AccessPoint"
NM_ACTIVE = "org.freedesktop.NetworkManager.Connection.Active"
NM_IP4_CONFIG = "org.freedesktop.NetworkManager.IP4Config"

LOGIN1 = "org.freedesktop.login1"
LOGIN1_MANAGER = "org.freedesktop.login1.Manager"

DEVICE_TYPE_WIFI = 2
ACTIVE_ACTIVATED = 2
ACTIVE_DEACTIVATED = 4
CONNECTIVITY_FULL = 4
CONNECTION_UNSAVED = 0x1
CONNECTION_VOLATILE = 0x4

METHOD_CALL = 1
METHOD_RETURN = 2
ERROR = 3
SIGNAL = 4

_FIELD_PATH = 1
_FIELD_INTERFACE = 2
_FIELD_MEMBER = 3
_FIELD_ERROR_NAME = 4
_FIELD_REPLY_SERIAL = 5
_FIELD_DESTINATION = 6
_FIELD_SENDER = 7
_FIELD_SIGNATURE = 8
_FIELD_TYPES = {1: "o", 2: "s", 3: "s", 4: "s", 5: "u", 6: "s", 7: "s", 8: "g"}

_ALIGN = {
    "y": 1, "b": 4, "n": 2, "q": 2, "i": 4, "u": 4, "x": 8, "t": 8, "d": 8, "h": 4,
    "s": 4, "o": 4, "g": 1, "v": 1, "a": 4, "(": 8, "{": 8,
}
_FIXED = {"y": "B", "b": "I", "n": "h", "q": "H", "i": "i", "u": "I", "x": "q", "t": "Q", "d": "d", "h": "I"}

MESSAGE_MAX = 16 * 1024 * 1024
AUTH_LINE_MAX = 512


class DBusError(Exception):
    def __init__(self, name: str, message: str = ""):
        super().__init__(f"{name}: {message}" if message else name)
        self.name = name


class Variant:
    __slots__ = ("signature", "value")

    def __init__(self, signature: str, value):
        self.signature = signature
        self.value = value

    def __repr__(self):
        return f"Variant({self.signature!r}, {self.value!r})"


class Message:
    __slots__ = ("body", "destination", "error_name", "flags", "interface", "kind", "member",
                 "path", "reply_serial", "sender", "serial", "signature")

    def __init__(self):
        self.kind = 0
        self.flags = 0
        self.serial = 0
        self.path = ""
        self.interface = ""
        self.member = ""
        self.error_name = ""
        self.reply_serial = 0
        self.destination = ""
        self.sender = ""
        self.signature = ""
        self.body = []


def split_signature(signature: str) -> list:
    types = []
    index = 0
    while index < len(signature):
        end = _type_end(signature, index)
        types.append(signature[index:end])
        index = end
    return types


def _type_end(signature: str, index: int) -> int:
    while signature[index] == "a":
        index += 1
    if signature[index] not in "({":
        if signature[index] not in _ALIGN:
            raise ValueError(f"unknown type {signature[index]!r} in {signature!r}")
        return index + 1
    depth = 0
    for at in range(index, len(signature)):
        if signature[at] in "({":
            depth += 1
        elif signature[at] in ")}":
            depth -= 1
            if depth == 0:
                return at + 1
    raise ValueError(f"unbalanced signature {signature!r}")


class _Writer:
    def __init__(self):
        self.buf = bytearray()

    def pad(self, size: int) -> None:
        self.buf.extend(b"\0" * (-len(self.buf) % size))

    def write(self, signature: str, value) -> None:
        code = signature[0]
        self.pad(_ALIGN[code])
        if code in _FIXED:
            if code == "b":
                value = 1 if value else 0
            self.buf.extend(struct.pack("<" + _FIXED[code], value))
        elif code in "so":
            data = str(value).encode("utf-8")
            self.buf.extend(struct.pack("<I", len(data)))
            self.buf.extend(data + b"\0")
        elif code == "g":
            data = str(value).encode("ascii")
            self.buf.append(len(data))
            self.buf.extend(data + b"\0")
        elif code == "v":
            if not isinstance(value, Variant):
                raise TypeError(f"a variant needs a Variant, not {type(value).__name__}")
            self.write("g", value.signature)
            self.write(value.signature, value.value)
        elif code == "a":
            self._write_array(signature[1:], value)
        elif code in "({":
            parts = split_signature(signature[1:-1])
            for part, item in zip(parts, value, strict=True):
                self.write(part, item)
        else:
            raise ValueError(f"can't write type {code!r}")

    def _write_array(self, inner: str, value) -> None:
        self.pad(4)
        at = len(self.buf)
        self.buf.extend(b"\0\0\0\0")
        self.pad(_ALIGN[inner[0]])
        start = len(self.buf)
        if inner == "y" and isinstance(value, (bytes, bytearray)):
            self.buf.extend(value)
        elif inner[0] == "{":
            for key, item in value.items():
                self.write(inner, (key, item))
        else:
            for item in value:
                self.write(inner, item)
        struct.pack_into("<I", self.buf, at, len(self.buf) - start)


class _Reader:
    def __init__(self, data, endian: str, offset: int = 0, *, keep_variants: bool = False):
        self.data = data
        self.endian = endian
        self.pos = offset
        self.keep_variants = keep_variants

    def _need(self, size: int) -> None:
        if self.pos + size > len(self.data):
            raise ValueError("message ends inside a value")

    def read(self, signature: str):
        code = signature[0]
        self.pos += -self.pos % _ALIGN[code]
        if code in _FIXED:
            fmt = self.endian + _FIXED[code]
            size = struct.calcsize(fmt)
            self._need(size)
            (value,) = struct.unpack_from(fmt, self.data, self.pos)
            self.pos += size
            return bool(value) if code == "b" else value
        if code in "so":
            (size,) = self._u32()
            return self._text(size)
        if code == "g":
            self._need(1)
            size = self.data[self.pos]
            self.pos += 1
            return self._text(size)
        if code == "v":
            inner = self.read("g")
            value = self.read(inner)
            return Variant(inner, value) if self.keep_variants else value
        if code == "a":
            return self._read_array(signature[1:])
        if code in "({":
            return tuple(self.read(part) for part in split_signature(signature[1:-1]))
        raise ValueError(f"can't read type {code!r}")

    def _u32(self):
        self._need(4)
        value = struct.unpack_from(self.endian + "I", self.data, self.pos)
        self.pos += 4
        return value

    def _text(self, size: int) -> str:
        self._need(size + 1)
        text = bytes(self.data[self.pos:self.pos + size]).decode("utf-8", "replace")
        self.pos += size + 1
        return text

    def _read_array(self, inner: str):
        (size,) = self._u32()
        self.pos += -self.pos % _ALIGN[inner[0]]
        end = self.pos + size
        if end > len(self.data):
            raise ValueError("array runs past the message")
        if inner == "y":
            value = bytes(self.data[self.pos:end])
            self.pos = end
            return value
        if inner[0] == "{":
            out = {}
            while self.pos < end:
                key, item = self.read(inner)
                out[key] = item
            return out
        items = []
        while self.pos < end:
            items.append(self.read(inner))
        return items


def encode_message(kind: int, serial: int, *, path: str = "", interface: str = "", member: str = "",
                   destination: str = "", error_name: str = "", reply_serial: int = 0,
                   signature: str = "", args=(), flags: int = 0) -> bytes:
    body = _Writer()
    for part, value in zip(split_signature(signature), args, strict=True):
        body.write(part, value)
    fields = []
    for code, value in (
        (_FIELD_PATH, path), (_FIELD_INTERFACE, interface), (_FIELD_MEMBER, member),
        (_FIELD_ERROR_NAME, error_name), (_FIELD_REPLY_SERIAL, reply_serial),
        (_FIELD_DESTINATION, destination), (_FIELD_SIGNATURE, signature),
    ):
        if value:
            fields.append((code, Variant(_FIELD_TYPES[code], value)))
    header = _Writer()
    header.buf.extend(b"l")
    header.buf.extend(struct.pack("<BBB", kind, flags, 1))
    header.write("u", len(body.buf))
    header.write("u", serial)
    header.write("a(yv)", fields)
    header.pad(8)
    return bytes(header.buf + body.buf)


def message_length(data) -> int:
    if len(data) < 16:
        return 0
    endian = _endian(data[0])
    body_length, _serial, fields_length = struct.unpack_from(endian + "III", data, 4)
    header_end = 16 + fields_length
    total = header_end + (-header_end % 8) + body_length
    if total > MESSAGE_MAX:
        raise ValueError(f"message of {total} bytes")
    return total


def decode_message(data, *, keep_variants: bool = False, body: bool = True) -> Message:
    endian = _endian(data[0])
    message = Message()
    message.kind, message.flags = data[1], data[2]
    _body_length, message.serial = struct.unpack_from(endian + "II", data, 4)
    reader = _Reader(data, endian, 12)
    for code, value in reader.read("a(yv)"):
        if code == _FIELD_PATH:
            message.path = value
        elif code == _FIELD_INTERFACE:
            message.interface = value
        elif code == _FIELD_MEMBER:
            message.member = value
        elif code == _FIELD_ERROR_NAME:
            message.error_name = value
        elif code == _FIELD_REPLY_SERIAL:
            message.reply_serial = value
        elif code == _FIELD_DESTINATION:
            message.destination = value
        elif code == _FIELD_SENDER:
            message.sender = value
        elif code == _FIELD_SIGNATURE:
            message.signature = value
    if body:
        reader.pos += -reader.pos % 8
        reader.keep_variants = keep_variants
        message.body = [reader.read(part) for part in split_signature(message.signature)]
    return message


def _endian(flag: int) -> str:
    if flag == ord("l"):
        return "<"
    if flag == ord("B"):
        return ">"
    raise ValueError(f"bad endian flag {flag!r}")


class _Waiter:
    __slots__ = ("event", "raw")

    def __init__(self):
        self.event = threading.Event()
        self.raw = b""


class Bus:
    def __init__(self, *, on_signal=None, on_close=None, path: str = SYSTEM_BUS):
        self._path = path
        self._on_signal = on_signal
        self._on_close = on_close
        self._sock = None
        self._send_lock = threading.Lock()
        self._lock = threading.Lock()
        self._pending = {}
        self._serial = 0
        self._closed = False
        self.unique_name = ""

    @property
    def closed(self) -> bool:
        return self._closed

    def open(self, timeout: float = 5.0) -> "Bus":
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            sock.settimeout(timeout)
            sock.connect(self._path)
            uid = str(os.getuid()).encode("ascii").hex().encode("ascii")
            sock.sendall(b"\0AUTH EXTERNAL " + uid + b"\r\n")
            line = _read_line(sock)
            if not line.startswith(b"OK "):
                raise DBusError("org.freedesktop.DBus.Error.AuthFailed", line.decode("ascii", "replace"))
            sock.sendall(b"BEGIN\r\n")
            sock.settimeout(None)
        except BaseException:
            sock.close()
            raise
        self._sock = sock
        threading.Thread(target=self._read_loop, name="nm-dbus", daemon=True).start()
        try:
            self.unique_name = self.call(DBUS, DBUS_PATH, DBUS, "Hello", timeout=timeout)[0]
        except BaseException:
            self.close()
            raise
        return self

    def close(self) -> None:
        with self._lock:
            sock = self._sock
        if sock is None:
            return
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        sock.close()

    def call(self, destination: str, path: str, interface: str, member: str, signature: str = "",
             args=(), *, timeout: float = 10.0, keep_variants: bool = False) -> list:
        waiter = _Waiter()
        with self._lock:
            if self._closed or self._sock is None:
                raise DBusError(DISCONNECTED, "not connected")
            self._serial += 1
            serial = self._serial
            self._pending[serial] = waiter
        data = encode_message(METHOD_CALL, serial, path=path, interface=interface, member=member,
                              destination=destination, signature=signature, args=args)
        try:
            with self._send_lock:
                self._sock.sendall(data)
        except OSError as exc:
            with self._lock:
                self._pending.pop(serial, None)
            raise DBusError(DISCONNECTED, str(exc)) from exc
        if not waiter.event.wait(timeout):
            with self._lock:
                self._pending.pop(serial, None)
            raise DBusError(NO_REPLY, f"{interface}.{member} timed out")
        if not waiter.raw:
            raise DBusError(DISCONNECTED, "connection closed")
        try:
            reply = decode_message(waiter.raw, keep_variants=keep_variants)
        except (ValueError, struct.error) as exc:
            raise DBusError(NO_REPLY, f"unreadable reply to {interface}.{member}") from exc
        if reply.kind == ERROR:
            text = reply.body[0] if reply.body and isinstance(reply.body[0], str) else ""
            raise DBusError(reply.error_name, text)
        return reply.body

    def get(self, destination: str, path: str, interface: str, name: str, *, timeout: float = 10.0):
        return self.call(destination, path, PROPERTIES, "Get", "ss", (interface, name), timeout=timeout)[0]

    def get_all(self, destination: str, path: str, interface: str, *, timeout: float = 10.0) -> dict:
        return self.call(destination, path, PROPERTIES, "GetAll", "s", (interface,), timeout=timeout)[0]

    def add_match(self, rule: str) -> None:
        self.call(DBUS, DBUS_PATH, DBUS, "AddMatch", "s", (rule,))

    def _read_loop(self) -> None:
        buf = bytearray()
        try:
            while True:
                chunk = self._sock.recv(65536)
                if not chunk:
                    break
                buf.extend(chunk)
                while True:
                    total = message_length(buf)
                    if not total or len(buf) < total:
                        break
                    raw = bytes(buf[:total])
                    del buf[:total]
                    self._dispatch(raw)
        except (OSError, ValueError, struct.error):
            pass
        finally:
            self._finish()

    def _dispatch(self, raw: bytes) -> None:
        header = decode_message(raw, body=False)
        if header.kind in (METHOD_RETURN, ERROR):
            with self._lock:
                waiter = self._pending.pop(header.reply_serial, None)
            if waiter is not None:
                waiter.raw = raw
                waiter.event.set()
        elif header.kind == SIGNAL and self._on_signal is not None:
            try:
                self._on_signal(decode_message(raw))
            except Exception:
                pass

    def _finish(self) -> None:
        with self._lock:
            self._closed = True
            waiters = list(self._pending.values())
            self._pending.clear()
        for waiter in waiters:
            waiter.event.set()
        try:
            self._sock.close()
        except OSError:
            pass
        if self._on_close is not None:
            try:
                self._on_close()
            except Exception:
                pass


def _read_line(sock: socket.socket) -> bytes:
    line = bytearray()
    while not line.endswith(b"\r\n"):
        chunk = sock.recv(1)
        if not chunk:
            raise DBusError(DISCONNECTED, "closed during authentication")
        line.extend(chunk)
        if len(line) > AUTH_LINE_MAX:
            raise DBusError("org.freedesktop.DBus.Error.AuthFailed", "authentication line too long")
    return bytes(line[:-2])


def ipv4_number(address: str) -> int:
    return struct.unpack("=I", socket.inet_aton(address))[0]


class NetworkManager:
    def __init__(self, bus: Bus):
        self.bus = bus

    def _get(self, path: str, interface: str, name: str):
        return self.bus.get(NM, path, interface, name)

    def wireless_enabled(self) -> bool:
        return bool(self._get(NM_PATH, NM, "WirelessEnabled"))

    def connectivity(self) -> int:
        return int(self._get(NM_PATH, NM, "Connectivity"))

    def check_connectivity(self) -> int:
        return int(self.bus.call(NM, NM_PATH, NM, "CheckConnectivity", timeout=30.0)[0])

    def devices(self) -> list:
        return self.bus.call(NM, NM_PATH, NM, "GetDevices")[0]

    def device(self, path: str) -> dict:
        return self.bus.get_all(NM, path, NM_DEVICE)

    def wifi_device(self, interface: str = "") -> tuple:
        for path in self.devices():
            props = self.device(path)
            if int(props.get("DeviceType", 0)) != DEVICE_TYPE_WIFI:
                continue
            if not interface or props.get("Interface") == interface:
                return path, props
        return "", {}

    def device_by_interface(self, interface: str) -> str:
        try:
            return self.bus.call(NM, NM_PATH, NM, "GetDeviceByIpIface", "s", (interface,))[0]
        except DBusError:
            return ""

    def add_and_activate(self, settings: dict, device: str, options: dict) -> tuple:
        reply = self.bus.call(
            NM, NM_PATH, NM, "AddAndActivateConnection2", "a{sa{sv}}ooa{sv}",
            (settings, device, "/", options), timeout=30.0,
        )
        return reply[0], reply[1]

    def deactivate(self, active: str) -> None:
        self.bus.call(NM, NM_PATH, NM, "DeactivateConnection", "o", (active,), timeout=20.0)

    def connections(self) -> list:
        return self.bus.call(NM, NM_SETTINGS_PATH, NM_SETTINGS, "ListConnections")[0]

    def connection_settings(self, path: str) -> dict:
        return self.bus.call(NM, path, NM_CONNECTION, "GetSettings")[0]

    def connection_flags(self, path: str) -> int:
        return int(self._get(path, NM_CONNECTION, "Flags"))

    def delete(self, path: str) -> None:
        self.bus.call(NM, path, NM_CONNECTION, "Delete")

    def active_state(self, active: str) -> int:
        return int(self._get(active, NM_ACTIVE, "State"))

    def request_scan(self, device: str) -> None:
        self.bus.call(NM, device, NM_WIRELESS, "RequestScan", "a{sv}", ({},), timeout=15.0)

    def last_scan(self, device: str) -> int:
        return int(self._get(device, NM_WIRELESS, "LastScan"))

    def access_points(self, device: str) -> list:
        points = []
        for path in self.bus.call(NM, device, NM_WIRELESS, "GetAllAccessPoints")[0]:
            try:
                props = self.bus.get_all(NM, path, NM_ACCESS_POINT)
            except DBusError:
                continue
            props["Path"] = path
            points.append(props)
        return points

    def applied_connection(self, device: str) -> tuple:
        reply = self.bus.call(NM, device, NM_DEVICE, "GetAppliedConnection", "u", (0,), keep_variants=True)
        return reply[0], reply[1]

    def reapply(self, device: str, settings: dict, version: int) -> None:
        self.bus.call(NM, device, NM_DEVICE, "Reapply", "a{sa{sv}}tu", (settings, version, 0), timeout=20.0)

    def nameservers(self, device: str) -> list:
        config = self._get(device, NM_DEVICE, "Ip4Config")
        if not config or config == "/":
            return []
        data = self._get(config, NM_IP4_CONFIG, "NameserverData")
        return [str(entry.get("address", "")) for entry in data if entry.get("address")]
