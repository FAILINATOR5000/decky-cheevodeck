import asyncio
import hashlib
import hmac
import json
import re
import secrets
import socket
import threading
import time

from pathlib import Path

import decky
import multiplayer_protocol as proto
import nm_dbus
from notifications import NOTIFICATION_EVENT
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
AP_INTERFACE = "cdap0"
AP_INTERFACE_SECONDS = 8

SHARE_TABLE = "cheevodeck_hotspot"
RUN_DIR = Path("/run/cheevodeck")
FORWARD_RECORD = RUN_DIR / "hotspot-ip-forward"
RULES_FILE = RUN_DIR / "hotspot.nft"
IP_FORWARD = Path("/proc/sys/net/ipv4/ip_forward")
DNS_MAX = 3
STAY_DRIVERS = frozenset({"ath11k_pci"})

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
RECONNECT_SECONDS = 15.0
DAD_MS = 2000
JOIN_ATTEMPTS = 3

DEVICE_ACTIVATED = 100
DEVICE_DISCONNECTED = 30
DEVICE_FAILED = 120
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
_CHANNEL = re.compile(r"channel (\d+) \((\d+) MHz\)")


def station_channel(interface: str):
    code, out, _err = run_command(["iw", "dev", interface, "info"], timeout=5)
    if code != 0 or "type managed" not in out:
        return None
    match = _CHANNEL.search(out)
    return (int(match.group(1)), int(match.group(2))) if match else None


def can_host_on(mhz: int) -> bool:
    return mhz < 2500 or 5150 <= mhz < 5250 or 5735 <= mhz <= 5895


def _ap_mac(interface: str) -> str:
    try:
        octets = [int(part, 16) for part in Path(f"/sys/class/net/{interface}/address").read_text().strip().split(":")]
    except (OSError, ValueError):
        return ""
    if len(octets) != 6:
        return ""
    octets[0] |= 0x02
    octets[5] ^= 0x5A
    return ":".join(f"{octet:02x}" for octet in octets)


def default_route_interface(exclude: str) -> str:
    code, out, _err = run_command(["ip", "-4", "route", "show", "default"], timeout=5)
    for line in out.splitlines() if code == 0 else []:
        parts = line.split()
        if "dev" in parts:
            device = parts[parts.index("dev") + 1]
            if device != exclude:
                return device
    return ""


def stop_sharing() -> bool:
    changed = False
    code, _out, _err = run_command(["nft", "list", "table", "ip", SHARE_TABLE], timeout=5)
    if code == 0:
        code, _out, err = run_command(["nft", "delete", "table", "ip", SHARE_TABLE], timeout=5)
        if code != 0:
            decky.logger.warning("hotspot: couldn't remove the sharing table (%s)", err.strip())
        changed = True
    try:
        original = FORWARD_RECORD.read_text().strip()
    except OSError:
        original = ""
    if original in ("0", "1"):
        try:
            IP_FORWARD.write_text(original)
            FORWARD_RECORD.unlink()
        except OSError as exc:
            decky.logger.warning("hotspot: couldn't put forwarding back (%s)", exc)
        changed = True
    try:
        RULES_FILE.unlink()
    except OSError:
        pass
    return changed


def drop_ap_interface() -> bool:
    if not Path(f"/sys/class/net/{AP_INTERFACE}").exists():
        return False
    code, _out, err = run_command(["iw", "dev", AP_INTERFACE, "del"], timeout=5)
    if code != 0:
        decky.logger.warning("hotspot: couldn't remove %s (%s)", AP_INTERFACE, err.strip())
    return code == 0


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
        ipv4["may-fail"] = Variant("b", False)
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
    def __init__(self, *, settings_store, game_mode, room_role, notifications_store):
        self._settings_store = settings_store
        self._notifications = notifications_store
        self._game_mode = game_mode
        self._room_role = room_role
        self._loop = None
        self._lock = threading.RLock()
        self._op_lock = threading.Lock()

        self._state = "off"
        self._seq = 0
        self._role = ""
        self._ssid = ""
        self._private = False
        self._code = ""
        self._subnet = 0
        self._address = ""
        self._interface = ""
        self._device = ""
        self._ap_interface = ""
        self._ap_device = ""
        self._ap_channel = 0
        self._spec = None
        self._uplink = ""
        self._dfs = False
        self._sharing = False
        self._share_dns = []
        self._shared_in = False
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

        self._bus = None
        self._nm = None
        self._stop = None
        self._ending = False
        self._closed = False
        self._carried = ""
        self._failed_reason = 0

    def set_event_loop(self, loop) -> None:
        self._loop = loop

    def status(self) -> dict:
        with self._lock:
            subnet = self._subnet
            return {
                "ok": True,
                "seq": self._seq,
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
                "uplink": self._uplink,
                "dfs": self._dfs,
                "sharing": self._sharing,
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
        self._closed = True
        if not self._op_lock.acquire(timeout=5):
            with self._lock:
                bus = self._bus
            if bus is not None:
                bus.close()
            stop_sharing()
            drop_ap_interface()
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
        if self._closed or not self._op_lock.acquire(blocking=False):
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
        resume = self._station_connection(nm, props) or self._carried
        paused = self._network_name(nm, resume) if resume else ""
        with self._lock:
            self._bus = bus
            self._nm = nm
            self._device = device
            self._interface = str(props.get("Interface") or "wlan0")
            self._resume = resume
            self._paused = paused
            self._carried = ""
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
        passphrase = code or open_passphrase(ssid)
        with self._lock:
            self._state = "starting"
            self._role = "host"
            self._spec = (ssid, passphrase, address, HOST_PROFILE + tag)
        self._emit()
        error = self._stay_on_network() if self._resume else "plain"
        if error:
            if error != "plain":
                decky.logger.info("hotspot: hosting without staying on %s (%s)", self._paused, error)
            with self._lock:
                self._ap_interface = self._interface
                self._ap_device = self._device
                self._ap_channel = CHANNEL
            error = self._activate(_ap_settings(ssid, self._interface, passphrase, address, profile=HOST_PROFILE + tag,
                                                mode="ap", channel=CHANNEL, band=BAND), self._device)
        if error:
            self._teardown(reconnect=True)
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
        if self._closed:
            self._teardown()
            self._reset_state()
            return FAILED
        self._start_sharing()
        self._begin()
        self._file_card()
        decky.logger.info("hotspot: hosting %s on %s channel %s (%s)%s", ssid, self._ap_interface, self._ap_channel,
                          address, f", {self._paused} paused" if self._paused else
                          f", staying on {self._uplink}" if self._uplink else "")
        return ""

    def _stay_on_network(self) -> str:
        try:
            driver = Path(f"/sys/class/net/{self._interface}/device/driver").resolve().name
        except OSError:
            driver = ""
        if driver not in STAY_DRIVERS:
            return f"the {driver or 'unknown'} driver can't keep both"
        link = station_channel(self._interface)
        if link is None:
            return "plain"
        channel, mhz = link
        if not can_host_on(mhz):
            with self._lock:
                self._dfs = True
            return f"channel {channel} can't carry an access point"
        device = self._add_ap_interface()
        if not device:
            return f"no {AP_INTERFACE}"
        ssid, passphrase, address, profile = self._spec
        with self._lock:
            self._ap_interface = AP_INTERFACE
            self._ap_device = device
            self._ap_channel = channel
        error = self._activate(_ap_settings(ssid, AP_INTERFACE, passphrase, address, profile=profile, mode="ap",
                                            channel=channel, band="bg" if mhz < 3000 else "a"), device)
        if not error:
            with self._lock:
                self._uplink, self._paused = self._paused, ""
            return ""
        self._drop_profile()
        drop_ap_interface()
        with self._lock:
            self._ap_interface = ""
            self._ap_device = ""
        return error

    def _add_ap_interface(self) -> str:
        drop_ap_interface()
        mac = _ap_mac(self._interface)
        argv = ["iw", "dev", self._interface, "interface", "add", AP_INTERFACE, "type", "__ap"]
        code, _out, err = run_command(argv + (["addr", mac] if mac else []), timeout=5)
        if code != 0 and mac:
            code, _out, err = run_command(argv, timeout=5)
        if code != 0:
            decky.logger.info("hotspot: the Wi-Fi card refused a second interface (%s)", err.strip())
            return ""
        deadline = time.monotonic() + AP_INTERFACE_SECONDS
        while time.monotonic() < deadline:
            device = self._nm.device_by_interface(AP_INTERFACE)
            if device:
                try:
                    if int(self._nm.device(device).get("State", 0)) >= DEVICE_DISCONNECTED:
                        return device
                except nm_dbus.DBusError:
                    pass
            time.sleep(0.25)
        decky.logger.info("hotspot: NetworkManager didn't take up %s", AP_INTERFACE)
        drop_ap_interface()
        return ""

    def _start_sharing(self) -> None:
        with self._lock:
            ap, subnet = self._ap_interface, self._subnet
        uplink = default_route_interface(ap)
        if not uplink:
            return
        device = self._nm.device_by_interface(uplink)
        try:
            dns = [server for server in self._nm.nameservers(device) if proto.is_ipv4(server)][:DNS_MAX] if device else []
        except nm_dbus.DBusError:
            dns = []
        if not dns:
            decky.logger.info("hotspot: %s has no DNS servers to hand on, not sharing", uplink)
            return
        rules = (f"table ip {SHARE_TABLE} {{\n"
                 "    chain postrouting {\n"
                 "        type nat hook postrouting priority srcnat; policy accept;\n"
                 f"        ip saddr 10.73.{subnet}.0/24 oifname \"{uplink}\" masquerade\n"
                 "    }\n"
                 "    chain forward {\n"
                 "        type filter hook forward priority filter; policy accept;\n"
                 f"        iifname \"{ap}\" oifname != \"{uplink}\" drop\n"
                 "    }\n"
                 "}\n")
        try:
            RUN_DIR.mkdir(mode=0o700, exist_ok=True)
            if not FORWARD_RECORD.exists():
                FORWARD_RECORD.write_text(IP_FORWARD.read_text().strip())
            RULES_FILE.write_text(rules)
        except OSError as exc:
            decky.logger.warning("hotspot: couldn't prepare sharing (%s)", exc)
            return
        run_command(["nft", "delete", "table", "ip", SHARE_TABLE], timeout=5)
        code, _out, err = run_command(["nft", "-f", str(RULES_FILE)], timeout=5)
        if code != 0:
            decky.logger.warning("hotspot: couldn't add the sharing rule (%s)", err.strip())
            stop_sharing()
            return
        try:
            IP_FORWARD.write_text("1")
        except OSError as exc:
            decky.logger.warning("hotspot: couldn't turn on forwarding (%s)", exc)
            stop_sharing()
            return
        with self._lock:
            self._sharing = True
            self._share_dns = dns
        decky.logger.info("hotspot: sharing %s's internet", uplink)

    def _follow_channel(self) -> None:
        with self._lock:
            if self._ap_interface != AP_INTERFACE or self._state != "host":
                return
            current = self._ap_channel
            interface = self._interface
        link = station_channel(interface)
        if link is None or link[0] == current:
            return
        channel, mhz = link
        if not self._op_lock.acquire(blocking=False):
            return
        try:
            with self._lock:
                if self._state != "host" or self._nm is None:
                    return
            if not can_host_on(mhz):
                decky.logger.info("hotspot: the network moved to channel %s, which can't carry an access point", channel)
                self._end("channel")
                return
            decky.logger.info("hotspot: the network moved to channel %s, moving the access point", channel)
            with self._lock:
                active, ssid_spec, device = self._active, self._spec, self._ap_device
                self._state = "starting"
            try:
                self._nm.deactivate(active)
            except nm_dbus.DBusError:
                pass
            self._drop_profile()
            ssid, passphrase, address, profile = ssid_spec
            error = self._activate(_ap_settings(ssid, AP_INTERFACE, passphrase, address, profile=profile, mode="ap",
                                                channel=channel, band="bg" if mhz < 3000 else "a"), device)
            if error:
                self._end("channel")
                return
            with self._lock:
                self._ap_channel = channel
                self._state = "host"
            self._emit()
        finally:
            self._op_lock.release()

    def _activate(self, settings: dict, device: str) -> str:
        nm = self._nm
        with self._lock:
            self._failed_reason = 0
        try:
            self._bus.add_match("type='signal',sender='org.freedesktop.NetworkManager',"
                                f"interface='{nm_dbus.NM_DEVICE}',member='StateChanged',path='{device}'")
        except nm_dbus.DBusError:
            pass
        try:
            connection, active = nm.add_and_activate(settings, device, _BOUND)
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
        with self._lock:
            reason = self._failed_reason
        reason = reason or self._device_reason(device)
        decky.logger.info("hotspot: activation didn't finish (device reason %s)", reason)
        if reason == REASON_NO_SECRETS:
            return BAD_CODE
        if reason == REASON_IP_UNAVAILABLE:
            return "address"
        return FAILED

    def _device_reason(self, device: str) -> int:
        try:
            state_reason = self._bus.get(nm_dbus.NM, device, nm_dbus.NM_DEVICE, "StateReason")
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
        internet = self._read_internet()
        with self._lock:
            self._started = time.monotonic()
            self._started_wall = int(time.time())
            self._warned = False
            self._ending = False
            self._devices = []
            self._names = {}
            self._internet = internet
            stop = self._stop = threading.Event()
        threading.Thread(target=self._run, args=(stop,), name="hotspot", daemon=True).start()
        self._emit()
        if not self._game_mode():
            self._off_soon("game_mode")

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
            rows = sorted(best.values(), key=lambda row: row["ssid"])
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
        if self._closed or not self._op_lock.acquire(blocking=False):
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
            error = self._activate(settings, self._device)
            if error != "address":
                break
            decky.logger.info("hotspot: %s is taken on %s, trying another", address, ssid)
            self._drop_profile()
        if error:
            self._teardown(reconnect=True)
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
        carried = self._resume if reason == "switch" else ""
        self._teardown(reconnect=reason not in ("unload", "switch"))
        self._reset_state()
        self._carried = carried
        decky.logger.info("hotspot: %s %s ended (%s)", "hosting" if role == "host" else "joined", ssid, reason)
        toast = ""
        if reason == "cap":
            toast = "Off"
        elif reason == "host_gone":
            toast = "The hotspot ended"
        elif reason in ("wifi_off", "game_mode", "sleep", "dropped", "channel"):
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
        if self._sharing and stop_sharing():
            decky.logger.info("hotspot: stopped sharing and put forwarding back")
        if self._ap_interface == AP_INTERFACE:
            drop_ap_interface()
        if nm is not None and reconnect and resume:
            threading.Thread(target=self._reconnect, args=(device, resume, active), name="hotspot-reconnect",
                             daemon=True).start()
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

    def _reconnect(self, device: str, resume: str, ours: str) -> None:
        bus = nm_dbus.Bus()
        try:
            bus.open()
        except (OSError, nm_dbus.DBusError):
            return
        try:
            self._reconnect_on(nm_dbus.NetworkManager(bus), device, resume, ours)
        finally:
            bus.close()

    def _reconnect_on(self, nm, device: str, resume: str, ours: str) -> None:
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
            self._uplink = ""
            self._dfs = False
            self._ap_interface = ""
            self._ap_device = ""
            self._ap_channel = 0
            self._spec = None
            self._sharing = False
            self._share_dns = []
            self._shared_in = False
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
        elif message.member == "StateChanged" and message.interface == nm_dbus.NM_DEVICE:
            if len(message.body) > 2 and message.body[0] == DEVICE_FAILED:
                with self._lock:
                    self._failed_reason = int(message.body[2])
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
                    self._follow_channel()
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
        with self._lock:
            share, dns = self._sharing, list(self._share_dns)
        return {"k": INFO_KIND, "op": "info", "name": self._user(), "share": share, "dns": dns}

    def _take_info(self, message: dict) -> None:
        name = proto.clean_user(message.get("name") or "")
        dns = message.get("dns")
        dns = [server for server in dns if proto.is_ipv4(server)][:DNS_MAX] if isinstance(dns, list) else []
        share = message.get("share") is True and bool(dns)
        with self._lock:
            changed = name != self._host_name
            self._host_name = name
            applied = self._shared_in
        if share != applied:
            changed = self._use_shared(share, dns) or changed
        if changed:
            self._emit()

    def _use_shared(self, share: bool, dns: list) -> bool:
        with self._lock:
            device, interface, subnet, nm = self._device, self._interface, self._subnet, self._nm
        if nm is None or (share and default_route_interface(interface)):
            return False
        try:
            settings, version = nm.applied_connection(device)
            applied = settings.get("connection", {}).get("id")
            name = str(applied.value) if isinstance(applied, Variant) else ""
            if not name.startswith(GUEST_PROFILE):
                return False
            ipv4 = settings.get("ipv4", {})
            if "address-data" in ipv4:
                ipv4.pop("addresses", None)
            ipv4["never-default"] = Variant("b", not share)
            if share:
                ipv4["gateway"] = Variant("s", f"10.73.{subnet}.1")
            else:
                ipv4.pop("gateway", None)
            if "dns-data" in ipv4:
                ipv4["dns-data"] = Variant("as", dns if share else [])
            ipv4["dns"] = Variant("au", [nm_dbus.ipv4_number(server) for server in dns] if share else [])
            settings["ipv4"] = ipv4
            nm.reapply(device, settings, version)
        except (nm_dbus.DBusError, OSError) as exc:
            decky.logger.info("hotspot: couldn't %s the host's internet (%s)", "take" if share else "drop", exc)
            return False
        with self._lock:
            self._shared_in = share
        decky.logger.info("hotspot: %s the host's internet", "using" if share else "no longer using")
        try:
            internet = nm.check_connectivity() == nm_dbus.CONNECTIVITY_FULL
        except nm_dbus.DBusError:
            internet = share
        with self._lock:
            if self._state == "guest":
                self._internet = internet
        return True

    def _user(self) -> str:
        cfg = self._settings_store.load_config()
        return proto.clean_user(cfg.get("username") or "")

    def _refresh_devices(self) -> None:
        with self._lock:
            interface = self._ap_interface or self._interface
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
            if drop_ap_interface():
                decky.logger.info("hotspot: removed a leftover %s", AP_INTERFACE)
            if stop_sharing():
                decky.logger.info("hotspot: removed leftover sharing and put forwarding back")
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

    def _file_card(self) -> None:
        try:
            self._notifications.append({
                "type": "system",
                "kind": "actionable",
                "iconSource": "none",
                "title": "Offline Hotspot",
                "body": "Offline Hotspot is now on. Select here to go to the page to turn it back off.",
                "source": "notifications",
                "target": {"view": "offlineHotspot"},
            })
        except Exception as exc:
            decky.logger.warning("hotspot: the notification could not be filed (%s)", type(exc).__name__)
            return
        loop = self._loop
        if loop is not None and not loop.is_closed():
            asyncio.run_coroutine_threadsafe(decky.emit(NOTIFICATION_EVENT, {"toast": False}), loop)

    def _emit(self, toast: str = "") -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        with self._lock:
            self._seq += 1
            payload = self.status()
        if toast:
            payload["toast"] = toast
        try:
            asyncio.run_coroutine_threadsafe(decky.emit(HOTSPOT_EVENT, payload), loop)
        except RuntimeError:
            pass
