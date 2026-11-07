import asyncio
import hashlib
import hmac
import json
import re
import secrets
import socket
import threading
import time

import decky
import multiplayer_protocol as proto
import nm_dbus
from nm_dbus import Variant
from subprocess_util import run_command

HOTSPOT_EVENT = "cheevodeck_hotspot"

SSID_PREFIX = "CheevoDeck-"
_SSID = re.compile(r"CheevoDeck-([0-9A-F]{4})(-P)?")
HOST_PROFILE = "CheevoDeck-Host-"
GUEST_PROFILE = "CheevoDeck-Guest-"
PASSPHRASE_KEY = b"cheevodeck-hotspot-v1"
CODE_DIGITS = 8
CHANNEL = 6
BAND = "bg"

INFO_PORT = 49735
INFO_KIND = "cheevodeck.hotspot"
INFO_BYTES = 1024

CAP_SECONDS = 23 * 3600
WARN_SECONDS = 5 * 60
ACTIVATE_SECONDS = 25
TICK_SECONDS = 1.0
DEVICES_SECONDS = 5.0
HELLO_SECONDS = 5.0
NAME_SECONDS = 20.0
RECONNECT_SECONDS = 8.0
DAD_MS = 2000
JOIN_ATTEMPTS = 3

DEVICE_ACTIVATED = 100
DEVICE_DISCONNECTED = 30
REASON_NO_SECRETS = 7
REASON_IP_UNAVAILABLE = 5

REFUSED_GAME_MODE = "game_mode"
REFUSED_HOSTING = "hosting"
REFUSED_SEATED = "seated"
REFUSED_WIFI_OFF = "wifi_off"
REFUSED_NO_WIFI = "no_wifi"
REFUSED_BUSY = "busy"
FAILED = "failed"
NOT_FOUND = "not_found"
BAD_CODE = "code"

_MAC = re.compile(r"^Station ([0-9a-f:]{17}) ", re.MULTILINE)


def subnet_of(ssid: str) -> int:
    match = _SSID.fullmatch(ssid)
    if match is None:
        return 0
    return int(match.group(1), 16) % 250 + 1


def open_passphrase(ssid: str) -> str:
    return hmac.new(PASSPHRASE_KEY, ssid.encode("ascii"), hashlib.sha256).hexdigest()[:20]


def guest_number(mac: str, attempt: int) -> int:
    seed = int(hashlib.sha256(mac.lower().encode("ascii")).hexdigest(), 16) % 253
    return (seed + attempt) % 253 + 2


def _ap_settings(ssid: str, interface: str, passphrase: str, address: str, *, profile: str, mode: str,
                 channel: int = 0, band: str = "") -> dict:
    wireless = {"ssid": Variant("ay", ssid.encode("ascii")), "mode": Variant("s", mode)}
    if band:
        wireless["band"] = Variant("s", band)
    if channel:
        wireless["channel"] = Variant("u", channel)
    ipv4 = {
        "method": Variant("s", "manual"),
        "address-data": Variant("aa{sv}", [{"address": Variant("s", address), "prefix": Variant("u", 24)}]),
        "never-default": Variant("b", True),
    }
    if mode == "infrastructure":
        ipv4["dad-timeout"] = Variant("i", DAD_MS)
    return {
        "connection": {
            "id": Variant("s", profile),
            "type": Variant("s", "802-11-wireless"),
            "interface-name": Variant("s", interface),
            "autoconnect": Variant("b", False),
        },
        "802-11-wireless": wireless,
        "802-11-wireless-security": {"key-mgmt": Variant("s", "wpa-psk"), "psk": Variant("s", passphrase)},
        "ipv4": ipv4,
        "ipv6": {"method": Variant("s", "link-local")},
    }


_BOUND = {"persist": Variant("s", "volatile"), "bind-activation": Variant("s", "dbus-client")}


class OfflineHotspotService:
    def __init__(self, *, settings_store, game_mode, room_role):
        self._settings_store = settings_store
        self._game_mode = game_mode
        self._room_role = room_role
        self._loop = None
        self._lock = threading.RLock()
        self._op_lock = threading.Lock()

        self._state = "off"
        self._role = ""
        self._ssid = ""
        self._private = False
        self._code = ""
        self._subnet = 0
        self._address = ""
        self._interface = ""
        self._device = ""
        self._active = ""
        self._connection = ""
        self._resume = ""
        self._paused = ""
        self._internet = False
        self._started = 0.0
        self._started_wall = 0
        self._warned = False
        self._devices = []
        self._names = {}
        self._host_name = ""
        self._last_info = 0.0

        self._bus = None
        self._nm = None
        self._stop = None
        self._ending = False

    def set_event_loop(self, loop) -> None:
        self._loop = loop

    def status(self) -> dict:
        with self._lock:
            subnet = self._subnet
            return {
                "ok": True,
                "state": self._state,
                "role": self._role,
                "ssid": self._ssid,
                "private": self._private,
                "code": self._code if self._role == "host" else "",
                "address": self._address,
                "example": f"10.73.{subnet}.200" if self._role == "host" else "",
                "devices": list(self._devices),
                "host": self._host_name,
                "paused": self._paused,
                "internet": self._internet,
                "startedAt": self._started_wall,
                "endsAt": self._started_wall + CAP_SECONDS if self._started_wall else 0,
            }

    def lan_address(self) -> str:
        with self._lock:
            return self._address if self._state in ("host", "guest") else ""

    def broadcast_address(self) -> str:
        with self._lock:
            return f"10.73.{self._subnet}.255" if self._state in ("host", "guest") else ""

    def set_on(self, on: bool, private: bool = False) -> dict:
        role = self._room_role()
        if role:
            return {**self.status(), "ok": False, "error": REFUSED_HOSTING if role == "host" else REFUSED_SEATED}
        if not on:
            self.turn_off("user")
            return self.status()
        return self._host(bool(private))

    def turn_off(self, reason: str) -> None:
        with self._op_lock:
            self._end(reason)

    def sync(self) -> None:
        if not self._game_mode() and self.lan_address():
            self._off_soon("game_mode")

    def stop(self) -> None:
        if not self._op_lock.acquire(timeout=5):
            with self._lock:
                bus = self._bus
            if bus is not None:
                bus.close()
            return
        try:
            self._end("unload")
        finally:
            self._op_lock.release()

    def start(self) -> None:
        threading.Thread(target=self._sweep, name="hotspot-sweep", daemon=True).start()

    def _host(self, private: bool) -> dict:
        if not self._game_mode():
            return {**self.status(), "ok": False, "error": REFUSED_GAME_MODE}
        if not self._op_lock.acquire(blocking=False):
            return {**self.status(), "ok": False, "error": REFUSED_BUSY}
        try:
            if self._state == "host":
                return self.status()
            if self._state != "off":
                self._end("switch")
            error = self._bring_up_host(private)
        finally:
            self._op_lock.release()
        if error:
            return {**self.status(), "ok": False, "error": error}
        return self.status()

    def _open_bus(self) -> str:
        bus = nm_dbus.Bus(on_signal=self._signal, on_close=self._bus_closed)
        try:
            bus.open()
        except (OSError, nm_dbus.DBusError) as exc:
            decky.logger.warning("hotspot: couldn't reach the system bus (%s)", exc)
            return FAILED
        nm = nm_dbus.NetworkManager(bus)
        try:
            if not nm.wireless_enabled():
                bus.close()
                return REFUSED_WIFI_OFF
            device, props = nm.wifi_device("wlan0")
            if not device:
                device, props = nm.wifi_device()
        except nm_dbus.DBusError as exc:
            decky.logger.warning("hotspot: NetworkManager didn't answer (%s)", exc)
            bus.close()
            return FAILED
        if not device:
            bus.close()
            return REFUSED_NO_WIFI
        with self._lock:
            self._bus = bus
            self._nm = nm
            self._device = device
            self._interface = str(props.get("Interface") or "wlan0")
            self._resume = self._station_connection(nm, props)
            self._paused = self._network_name(nm, self._resume) if self._resume else ""
        return ""

    def _station_connection(self, nm, props: dict) -> str:
        active = props.get("ActiveConnection") or "/"
        if active == "/" or int(props.get("State", 0)) != DEVICE_ACTIVATED:
            return ""
        try:
            return str(nm.bus.get(nm_dbus.NM, active, nm_dbus.NM_ACTIVE, "Connection"))
        except nm_dbus.DBusError:
            return ""

    def _network_name(self, nm, connection: str) -> str:
        try:
            settings = nm.connection_settings(connection)
        except nm_dbus.DBusError:
            return ""
        ssid = settings.get("802-11-wireless", {}).get("ssid", b"")
        return bytes(ssid).decode("utf-8", "replace") if ssid else str(settings.get("connection", {}).get("id", ""))

    def _bring_up_host(self, private: bool) -> str:
        error = self._open_bus()
        if error:
            return error
        tag = secrets.token_hex(2).upper()
        ssid = SSID_PREFIX + tag + ("-P" if private else "")
        subnet = subnet_of(ssid)
        code = "".join(secrets.choice("0123456789") for _ in range(CODE_DIGITS)) if private else ""
        address = f"10.73.{subnet}.1"
        settings = _ap_settings(ssid, self._interface, code or open_passphrase(ssid), address,
                                profile=HOST_PROFILE + tag, mode="ap", channel=CHANNEL, band=BAND)
        with self._lock:
            self._state = "starting"
            self._role = "host"
        self._emit()
        error = self._activate(settings)
        if error:
            self._teardown()
            self._reset_state()
            self._emit()
            return error
        with self._lock:
            self._state = "host"
            self._ssid = ssid
            self._private = private
            self._code = code
            self._subnet = subnet
            self._address = address
        self._begin()
        decky.logger.info("hotspot: hosting %s on %s (%s)%s", ssid, self._interface, address,
                          f", {self._paused} paused" if self._paused else "")
        return ""

    def _activate(self, settings: dict) -> str:
        nm = self._nm
        try:
            connection, active = nm.add_and_activate(settings, self._device, _BOUND)
        except nm_dbus.DBusError as exc:
            decky.logger.warning("hotspot: NetworkManager refused the profile (%s)", exc)
            return FAILED
        with self._lock:
            self._connection = connection
            self._active = active
        try:
            self._bus.add_match("type='signal',sender='org.freedesktop.NetworkManager',"
                                f"interface='{nm_dbus.NM_ACTIVE}',member='StateChanged',path='{active}'")
        except nm_dbus.DBusError:
            pass
        deadline = time.monotonic() + ACTIVATE_SECONDS
        while time.monotonic() < deadline:
            try:
                state = nm.active_state(active)
            except nm_dbus.DBusError:
                state = nm_dbus.ACTIVE_DEACTIVATED
            if state == nm_dbus.ACTIVE_ACTIVATED:
                return ""
            if state == nm_dbus.ACTIVE_DEACTIVATED:
                break
            time.sleep(0.25)
        reason = self._device_reason()
        decky.logger.info("hotspot: activation didn't finish (device reason %s)", reason)
        if reason == REASON_NO_SECRETS:
            return BAD_CODE
        if reason == REASON_IP_UNAVAILABLE:
            return "address"
        return FAILED

    def _device_reason(self) -> int:
        try:
            state_reason = self._bus.get(nm_dbus.NM, self._device, nm_dbus.NM_DEVICE, "StateReason")
            return int(state_reason[1])
        except (nm_dbus.DBusError, TypeError, IndexError, ValueError):
            return 0

    def _begin(self) -> None:
        bus = self._bus
        for rule in (
            "type='signal',interface='org.freedesktop.login1.Manager',member='PrepareForSleep'",
            "type='signal',sender='org.freedesktop.NetworkManager',path='/org/freedesktop/NetworkManager',"
            "interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'",
        ):
            try:
                bus.add_match(rule)
            except nm_dbus.DBusError as exc:
                decky.logger.warning("hotspot: couldn't watch for %s (%s)", rule.split("member=")[-1], exc)
        with self._lock:
            self._started = time.monotonic()
            self._started_wall = int(time.time())
            self._warned = False
            self._ending = False
            self._devices = []
            self._names = {}
            self._internet = self._read_internet()
            stop = self._stop = threading.Event()
        threading.Thread(target=self._run, args=(stop,), name="hotspot", daemon=True).start()
        self._emit()

    def _read_internet(self) -> bool:
        nm = self._nm
        if nm is None:
            return False
        try:
            connectivity = nm.connectivity()
        except nm_dbus.DBusError:
            return False
        return connectivity == nm_dbus.CONNECTIVITY_FULL

    def scan(self) -> dict:
        with self._lock:
            if self._state == "host":
                return {"ok": True, "hotspots": []}
            nm = self._nm
            device = self._device
        bus = None
        if nm is None:
            bus = nm_dbus.Bus()
            try:
                bus.open()
                nm = nm_dbus.NetworkManager(bus)
                device, _props = nm.wifi_device("wlan0")
                if not device:
                    device, _props = nm.wifi_device()
            except (OSError, nm_dbus.DBusError) as exc:
                bus.close()
                decky.logger.info("hotspot: scan couldn't reach NetworkManager (%s)", exc)
                return {"ok": False, "error": FAILED, "hotspots": []}
        try:
            if not device:
                return {"ok": False, "error": REFUSED_NO_WIFI, "hotspots": []}
            try:
                nm.request_scan(device)
            except nm_dbus.DBusError:
                pass
            best = {}
            for point in nm.access_points(device):
                ssid = bytes(point.get("Ssid") or b"").decode("ascii", "replace")
                if not subnet_of(ssid):
                    continue
                strength = int(point.get("Strength", 0))
                if ssid not in best or strength > best[ssid]["strength"]:
                    best[ssid] = {"ssid": ssid, "private": ssid.endswith("-P"), "strength": strength}
            rows = sorted(best.values(), key=lambda row: (-row["strength"], row["ssid"]))
            return {"ok": True, "hotspots": rows}
        except nm_dbus.DBusError as exc:
            decky.logger.info("hotspot: scan failed (%s)", exc)
            return {"ok": False, "error": FAILED, "hotspots": []}
        finally:
            if bus is not None:
                bus.close()

    def join(self, ssid: str, code: str = "") -> dict:
        subnet = subnet_of(ssid)
        if not subnet:
            return {**self.status(), "ok": False, "error": NOT_FOUND}
        private = ssid.endswith("-P")
        if private and not (len(code) == CODE_DIGITS and code.isdigit()):
            return {**self.status(), "ok": False, "error": BAD_CODE}
        if not self._game_mode():
            return {**self.status(), "ok": False, "error": REFUSED_GAME_MODE}
        role = self._room_role()
        if role:
            return {**self.status(), "ok": False, "error": REFUSED_HOSTING if role == "host" else REFUSED_SEATED}
        if not self._op_lock.acquire(blocking=False):
            return {**self.status(), "ok": False, "error": REFUSED_BUSY}
        try:
            if self._state == "guest" and self._ssid == ssid:
                return self.status()
            if self._state != "off":
                self._end("switch")
            error = self._join(ssid, subnet, code if private else open_passphrase(ssid))
        finally:
            self._op_lock.release()
        if error:
            return {**self.status(), "ok": False, "error": error}
        return self.status()

    def _join(self, ssid: str, subnet: int, passphrase: str) -> str:
        error = self._open_bus()
        if error:
            return error
        try:
            mac = str(self._nm.device(self._device).get("HwAddress") or "")
        except nm_dbus.DBusError:
            mac = ""
        with self._lock:
            self._state = "joining"
            self._role = "guest"
            self._ssid = ssid
        self._emit()
        tag = ssid[len(SSID_PREFIX):len(SSID_PREFIX) + 4]
        for attempt in range(JOIN_ATTEMPTS):
            address = f"10.73.{subnet}.{guest_number(mac or secrets.token_hex(6), attempt)}"
            settings = _ap_settings(ssid, self._interface, passphrase, address, profile=GUEST_PROFILE + tag,
                                    mode="infrastructure")
            error = self._activate(settings)
            if error != "address":
                break
            decky.logger.info("hotspot: %s is taken on %s, trying another", address, ssid)
            self._drop_profile()
        if error:
            self._teardown()
            self._reset_state()
            self._emit()
            if error == FAILED and ssid.endswith("-P"):
                return BAD_CODE
            return FAILED if error == "address" else error
        with self._lock:
            self._state = "guest"
            self._private = ssid.endswith("-P")
            self._subnet = subnet
            self._address = address
        self._begin()
        decky.logger.info("hotspot: joined %s as %s", ssid, address)
        return ""

    def leave(self) -> dict:
        role = self._room_role()
        if role:
            return {**self.status(), "ok": False, "error": REFUSED_HOSTING if role == "host" else REFUSED_SEATED}
        self.turn_off("user")
        return self.status()

    def _off_soon(self, reason: str) -> None:
        with self._lock:
            if self._ending or self._state == "off":
                return
            self._ending = True
        threading.Thread(target=self.turn_off, args=(reason,), name="hotspot-off", daemon=True).start()

    def _end(self, reason: str) -> None:
        with self._lock:
            if self._state == "off" and self._bus is None:
                return
            role = self._role
            ssid = self._ssid
            stop = self._stop
            self._stop = None
            self._state = "stopping"
        if stop is not None:
            stop.set()
        self._emit()
        self._teardown(reconnect=reason not in ("unload", "switch"))
        self._reset_state()
        decky.logger.info("hotspot: %s %s ended (%s)", "hosting" if role == "host" else "joined", ssid, reason)
        toast = ""
        if reason == "cap":
            toast = "Off"
        elif reason == "host_gone":
            toast = "The hotspot ended"
        elif reason in ("wifi_off", "game_mode", "sleep", "dropped"):
            toast = "Off"
        self._emit(toast)

    def _teardown(self, *, reconnect: bool = False) -> None:
        with self._lock:
            bus, nm = self._bus, self._nm
            active, resume, device = self._active, self._resume, self._device
        if nm is not None and active:
            try:
                nm.deactivate(active)
            except nm_dbus.DBusError:
                pass
        self._drop_profile()
        if nm is not None and reconnect and resume:
            self._reconnect(nm, device, resume, active)
        with self._lock:
            self._bus = None
            self._nm = None
        if bus is not None:
            bus.close()

    def _drop_profile(self) -> None:
        with self._lock:
            nm, connection = self._nm, self._connection
            self._connection = ""
            self._active = ""
        if nm is None or not connection:
            return
        try:
            nm.delete(connection)
        except nm_dbus.DBusError:
            pass

    def _reconnect(self, nm, device: str, resume: str, ours: str) -> None:
        deadline = time.monotonic() + RECONNECT_SECONDS
        while time.monotonic() < deadline:
            try:
                props = nm.device(device)
            except nm_dbus.DBusError:
                return
            current = props.get("ActiveConnection") or "/"
            if current not in ("/", ours) and int(props.get("State", 0)) > DEVICE_DISCONNECTED:
                return
            time.sleep(0.5)
        try:
            nm.bus.call(nm_dbus.NM, nm_dbus.NM_PATH, nm_dbus.NM, "ActivateConnection", "ooo", (resume, device, "/"))
            decky.logger.info("hotspot: brought the previous network back")
        except nm_dbus.DBusError as exc:
            decky.logger.info("hotspot: couldn't bring the previous network back (%s)", exc)

    def _reset_state(self) -> None:
        with self._lock:
            self._state = "off"
            self._role = ""
            self._ssid = ""
            self._private = False
            self._code = ""
            self._subnet = 0
            self._address = ""
            self._active = ""
            self._connection = ""
            self._resume = ""
            self._paused = ""
            self._internet = False
            self._started = 0.0
            self._started_wall = 0
            self._devices = []
            self._names = {}
            self._host_name = ""
            self._ending = False

    def _signal(self, message) -> None:
        if message.member == "PrepareForSleep" and message.body and message.body[0]:
            self._off_soon("sleep")
        elif message.member == "PropertiesChanged" and message.path == nm_dbus.NM_PATH:
            changed = message.body[1] if len(message.body) > 1 and isinstance(message.body[1], dict) else {}
            if changed.get("WirelessEnabled") is False:
                self._off_soon("wifi_off")
            elif "Connectivity" in changed:
                with self._lock:
                    self._internet = changed["Connectivity"] == nm_dbus.CONNECTIVITY_FULL
                self._emit()
        elif message.member == "StateChanged" and message.interface == nm_dbus.NM_ACTIVE:
            with self._lock:
                ours = message.path == self._active and self._state in ("host", "guest")
                role = self._role
            if ours and message.body and message.body[0] == nm_dbus.ACTIVE_DEACTIVATED:
                self._off_soon("host_gone" if role == "guest" else "dropped")

    def _bus_closed(self) -> None:
        with self._lock:
            live = self._bus is not None and self._state in ("host", "guest")
        if live:
            decky.logger.warning("hotspot: lost the system bus, NetworkManager has dropped the hotspot")
            self._off_soon("dropped")

    def _run(self, stop: threading.Event) -> None:
        sock = None
        next_socket = 0.0
        next_devices = 0.0
        next_hello = 0.0
        try:
            while not stop.is_set():
                now = time.monotonic()
                with self._lock:
                    role = self._role
                    started = self._started
                    warned = self._warned
                if started and now - started >= CAP_SECONDS:
                    self._off_soon("cap")
                    return
                if started and not warned and now - started >= CAP_SECONDS - WARN_SECONDS:
                    with self._lock:
                        self._warned = True
                    self._emit("Off in 5 minutes")
                if sock is None and now >= next_socket:
                    next_socket = now + DEVICES_SECONDS
                    sock = self._open_info_socket()
                if role == "host" and now >= next_devices:
                    next_devices = now + DEVICES_SECONDS
                    self._refresh_devices()
                if role == "guest" and sock is not None and now >= next_hello:
                    next_hello = now + HELLO_SECONDS
                    self._hello(sock)
                if sock is None:
                    stop.wait(TICK_SECONDS)
                    continue
                try:
                    data, addr = sock.recvfrom(INFO_BYTES + 1)
                except socket.timeout:
                    continue
                except OSError:
                    stop.wait(TICK_SECONDS)
                    continue
                self._heard(sock, data, addr)
        finally:
            if sock is not None:
                sock.close()

    def _open_info_socket(self):
        with self._lock:
            address = self._address
            role = self._role
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.bind((address, INFO_PORT) if role == "host" else ("0.0.0.0", 0))
            sock.settimeout(TICK_SECONDS)
        except OSError as exc:
            decky.logger.warning("hotspot: couldn't open the info port (%s)", exc)
            sock.close()
            return None
        return sock

    def _hello(self, sock) -> None:
        with self._lock:
            host = f"10.73.{self._subnet}.1"
        packet = json.dumps({"k": INFO_KIND, "op": "hello", "name": self._user()}, separators=(",", ":"))
        try:
            sock.sendto(packet.encode("ascii"), (host, INFO_PORT))
        except OSError:
            pass

    def _heard(self, sock, data: bytes, addr) -> None:
        if len(data) > INFO_BYTES:
            return
        try:
            message = json.loads(data.decode("ascii"))
        except (ValueError, UnicodeDecodeError, RecursionError):
            return
        if not isinstance(message, dict) or message.get("k") != INFO_KIND:
            return
        with self._lock:
            role = self._role
            subnet = self._subnet
        sender = addr[0] if isinstance(addr, tuple) and addr else ""
        if role == "host" and message.get("op") == "hello" and sender.startswith(f"10.73.{subnet}."):
            with self._lock:
                self._names[sender] = (proto.clean_user(message.get("name") or ""), time.monotonic())
            reply = json.dumps(self._info(), separators=(",", ":")).encode("ascii")
            try:
                sock.sendto(reply, addr)
            except OSError:
                pass
        elif role == "guest" and message.get("op") == "info" and sender == f"10.73.{subnet}.1":
            self._take_info(message)

    def _info(self) -> dict:
        return {"k": INFO_KIND, "op": "info", "name": self._user()}

    def _take_info(self, message: dict) -> None:
        name = proto.clean_user(message.get("name") or "")
        with self._lock:
            changed = name != self._host_name
            self._host_name = name
            self._last_info = time.monotonic()
        if changed:
            self._emit()

    def _user(self) -> str:
        cfg = self._settings_store.load_config()
        return proto.clean_user(cfg.get("username") or "")

    def _refresh_devices(self) -> None:
        with self._lock:
            interface = self._interface
        code, out, _err = run_command(["iw", "dev", interface, "station", "dump"], timeout=5)
        macs = _MAC.findall(out) if code == 0 else []
        code, neigh, _err = run_command(["ip", "-4", "neigh", "show", "dev", interface], timeout=5)
        addresses = {}
        for line in neigh.splitlines() if code == 0 else []:
            parts = line.split()
            if len(parts) >= 3 and parts[1] == "lladdr":
                addresses[parts[2].lower()] = parts[0]
        now = time.monotonic()
        with self._lock:
            self._names = {ip: seen for ip, seen in self._names.items() if now - seen[1] < NAME_SECONDS}
            rows = []
            for mac in macs:
                ip = addresses.get(mac, "")
                rows.append({"mac": mac, "address": ip, "name": self._names.get(ip, ("", 0))[0]})
            changed = rows != self._devices
            self._devices = rows
        if changed:
            self._emit()

    def _sweep(self) -> None:
        with self._op_lock:
            bus = nm_dbus.Bus()
            try:
                bus.open()
            except (OSError, nm_dbus.DBusError) as exc:
                decky.logger.info("hotspot: startup sweep couldn't reach the system bus (%s)", exc)
                return
            try:
                nm = nm_dbus.NetworkManager(bus)
                removed = []
                for path in nm.connections():
                    try:
                        name = str(nm.connection_settings(path).get("connection", {}).get("id", ""))
                        if not name.startswith(SSID_PREFIX):
                            continue
                        if not nm.connection_flags(path) & (nm_dbus.CONNECTION_UNSAVED | nm_dbus.CONNECTION_VOLATILE):
                            continue
                        nm.delete(path)
                        removed.append(name)
                    except nm_dbus.DBusError:
                        continue
                if removed:
                    decky.logger.info("hotspot: removed leftover profiles %s", ", ".join(removed))
            except nm_dbus.DBusError as exc:
                decky.logger.info("hotspot: startup sweep failed (%s)", exc)
            finally:
                bus.close()

    def _emit(self, toast: str = "") -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        payload = self.status()
        if toast:
            payload["toast"] = toast
        try:
            asyncio.run_coroutine_threadsafe(decky.emit(HOTSPOT_EVENT, payload), loop)
        except RuntimeError:
            pass
