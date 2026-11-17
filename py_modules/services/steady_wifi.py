import os
import queue
import shutil
import threading
import time
from pathlib import Path

import decky
import nm_dbus
import subprocess_util
from utils import child_owner, ensure_dir, is_newer_schema, load_json_file, report_newer_schema, save_json_file

CURRENT_SCHEMA_VERSION = 1
RECORD = "steady_wifi.json"

WPA = "fi.w1.wpa_supplicant1"
WPA_PATH = "/fi/w1/wpa_supplicant1"
WPA_INTERFACE = "fi.w1.wpa_supplicant1.Interface"
WPA_NETWORK = "fi.w1.wpa_supplicant1.Network"
IWD = "net.connman.iwd"
NO_NETWORK = "/"
AP_MODE = "2"

POLL_SECONDS = 10
CALL_SECONDS = 5
STEAMOSCTL_SECONDS = 10
LEFTOVER_RETRY_SECONDS = 180

POWER_ON = "enabled"
POWER_OFF = "disabled"


class SteadyWifi:
    def __init__(self, *, runtime_dir, user_home, debug_on):
        self._record = Path(runtime_dir) / RECORD
        self._user_home = Path(user_home)
        self._debug_on = debug_on
        self._lock = threading.Lock()
        self._jobs = queue.SimpleQueue()
        self._worker = None
        self._state = None
        self._watch_stop = None
        self._wake = threading.Event()
        self._failing = False

    @property
    def active(self) -> bool:
        return self._state is not None

    def start_round(self, on: bool) -> None:
        if not on:
            self._debug("off in this room, nothing changed")
            return
        self._submit(self.begin)

    def end_round(self) -> None:
        self._submit(self.end)

    def _submit(self, job) -> None:
        self._jobs.put(job)
        if self._worker is None:
            self._worker = threading.Thread(target=self._run_jobs, name="steady-wifi", daemon=True)
            self._worker.start()

    def _run_jobs(self) -> None:
        while True:
            job = self._jobs.get()
            try:
                job()
            except Exception as e:
                decky.logger.warning("steady wifi: %s failed (%s)", job.__name__, type(e).__name__)

    def _debug(self, message: str, *args) -> None:
        try:
            on = self._debug_on()
        except Exception:
            on = False
        if on:
            decky.logger.info("steady wifi: " + message, *args)

    def _failed(self, what: str, error: Exception) -> None:
        if not self._failing:
            self._failing = True
            decky.logger.warning("steady wifi: %s (%s)", what, error)

    def begin(self) -> None:
        with self._lock:
            if self._state is not None:
                return
            self._failing = False
            if self._record.exists():
                raw = self._load_record()
                if raw is not None and not self._put_back(raw, "an earlier round"):
                    return
            try:
                state = self._apply()
            except Exception as e:
                self._failed("couldn't change the Wi-Fi settings", e)
                return
            if state is not None:
                self._state = state
                self._start_watcher()

    def _apply(self):
        iface = _default_route_interface()
        if not iface:
            self._debug("skipped (no network)")
            return None
        bus = _open_bus()
        try:
            if not self._is_wifi(bus, iface):
                self._debug("skipped (not on Wi-Fi, %s)", iface)
                return None
            target = self._current_network(bus, iface)
            if target is not None and target["mode"] == AP_MODE:
                self._debug("skipped (this device is the hotspot)")
                return None
            power = self._read_power()
            state = {
                "schemaVersion": CURRENT_SCHEMA_VERSION,
                "iface": iface,
                "network": target["network"] if target is not None else "",
                "ssid": target["ssid"] if target is not None else "",
                "bgscanBefore": target["bgscan"] if target is not None else "",
                "bgscanChanged": target is not None and target["bgscan"] != "",
                "powerSaveChanged": power == POWER_ON,
                "at": int(time.time()),
            }
            self._save_record(state)
            if state["bgscanChanged"]:
                try:
                    _set_bgscan(bus, target["network"], "")
                except nm_dbus.DBusError as e:
                    state["bgscanChanged"] = False
                    self._failed("couldn't turn the scans off", e)
            if state["powerSaveChanged"] and not self._write_power(POWER_OFF):
                state["powerSaveChanged"] = False
            self._save_record(state)
        finally:
            bus.close()
        decky.logger.info("steady wifi: on for the round (%s; %s)",
                          _scan_words(target, state), _power_words(power, state["powerSaveChanged"]))
        return state

    def _is_wifi(self, bus, iface: str) -> bool:
        device = nm_dbus.NetworkManager(bus).device_by_interface(iface)
        if not device:
            return False
        kind = bus.get(nm_dbus.NM, device, nm_dbus.NM_DEVICE, "DeviceType", timeout=CALL_SECONDS)
        return int(kind) == nm_dbus.DEVICE_TYPE_WIFI

    def _current_network(self, bus, iface: str):
        if not _has_owner(bus, WPA):
            self._debug("scans left alone (%s)", "iwd backend" if _has_owner(bus, IWD) else "no wpa_supplicant")
            return None
        path = bus.call(WPA, WPA_PATH, WPA, "GetInterface", "s", (iface,), timeout=CALL_SECONDS)[0]
        network = bus.get(WPA, path, WPA_INTERFACE, "CurrentNetwork", timeout=CALL_SECONDS)
        if not network or network == NO_NETWORK:
            self._debug("scans left alone (not connected)")
            return None
        props = bus.get(WPA, network, WPA_NETWORK, "Properties", timeout=CALL_SECONDS)
        return {
            "network": network,
            "ssid": _unquote(props.get("ssid")),
            "bgscan": _unquote(props.get("bgscan")),
            "mode": _unquote(props.get("mode")) or "0",
        }

    def _session_env(self) -> dict:
        owner = child_owner()
        uid = owner[0] if owner else os.getuid()
        runtime = f"/run/user/{uid}"
        return {
            "HOME": str(self._user_home),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "XDG_RUNTIME_DIR": runtime,
            "DBUS_SESSION_BUS_ADDRESS": f"unix:path={runtime}/bus",
        }

    def _read_power(self) -> str:
        env = self._session_env()
        if shutil.which("steamosctl", path=env["PATH"]) is None:
            self._debug("power saving left alone (no steamosctl)")
            return ""
        code, out, err = subprocess_util.run_command(
            ["steamosctl", "get-wifi-power-management-state"], timeout=STEAMOSCTL_SECONDS, env=env,
            as_data_owner=True,
        )
        words = out.split()
        state = words[-1] if code == 0 and words else ""
        if state not in (POWER_ON, POWER_OFF):
            self._failed("couldn't read Wi-Fi power saving", RuntimeError(err.strip()[:200] or f"exit {code}"))
            return ""
        return state

    def _write_power(self, state: str) -> bool:
        code, _out, err = subprocess_util.run_command(
            ["steamosctl", "set-wifi-power-management-state", state], timeout=STEAMOSCTL_SECONDS,
            env=self._session_env(), as_data_owner=True,
        )
        if code != 0:
            self._failed(f"couldn't set Wi-Fi power saving {state}", RuntimeError(err.strip()[:200] or f"exit {code}"))
            return False
        return True

    def _start_watcher(self) -> None:
        stop = threading.Event()
        self._watch_stop = stop
        threading.Thread(target=self._watch, args=(stop,), name="steady-wifi-watch", daemon=True).start()

    def _stop_watcher(self) -> None:
        stop, self._watch_stop = self._watch_stop, None
        if stop is not None:
            stop.set()
            self._wake.set()

    def _watch(self, stop: threading.Event) -> None:
        bus = None
        try:
            while not stop.is_set():
                if bus is None or bus.closed:
                    bus = self._subscribe()
                self._wake.wait(POLL_SECONDS)
                self._wake.clear()
                with self._lock:
                    if stop.is_set() or self._state is None:
                        return
                    try:
                        self._keep_steady()
                        self._failing = False
                    except Exception as e:
                        self._failed("couldn't check the Wi-Fi settings", e)
        finally:
            if bus is not None:
                bus.close()

    def _subscribe(self):
        try:
            bus = nm_dbus.Bus(on_signal=self._signal).open(timeout=CALL_SECONDS)
        except Exception as e:
            self._debug("couldn't listen for reconnects (%s)", type(e).__name__)
            return None
        try:
            bus.add_match(f"type='signal',sender='{WPA}',interface='{nm_dbus.PROPERTIES}',"
                          f"member='PropertiesChanged',arg0='{WPA_INTERFACE}'")
        except Exception as e:
            self._debug("couldn't listen for reconnects (%s)", type(e).__name__)
        return bus

    def _signal(self, message) -> None:
        if message.member != "PropertiesChanged" or len(message.body) < 2 or message.body[0] != WPA_INTERFACE:
            return
        changed = message.body[1]
        if not isinstance(changed, dict):
            return
        if changed.get("State") == "completed" or "CurrentNetwork" in changed:
            self._wake.set()

    def _keep_steady(self) -> None:
        state = self._state
        bus = _open_bus()
        try:
            target = self._current_network(bus, state["iface"])
            if target is not None and target["mode"] != AP_MODE and target["bgscan"] != "":
                _set_bgscan(bus, target["network"], "")
                state.update(network=target["network"], ssid=target["ssid"], bgscanBefore=target["bgscan"],
                             bgscanChanged=True)
                self._save_record(state)
                decky.logger.info("steady wifi: reconnected, scans off again")
            elif target is not None and target["network"] != state["network"]:
                state.update(network=target["network"], ssid=target["ssid"])
                self._save_record(state)
        finally:
            bus.close()

    def end(self) -> None:
        self._stop_watcher()
        with self._lock:
            state, self._state = self._state, None
            if state is None:
                return
            if self._put_back(state, "the round"):
                return
        self._retry_soon()

    def put_back_leftover(self) -> bool:
        with self._lock:
            if self._state is not None or not self._record.exists():
                return False
            raw = self._load_record()
            if raw is None:
                return False
            if self._put_back(raw, "a round cut short"):
                return True
        self._retry_soon()
        return True

    def _retry_soon(self) -> None:
        threading.Thread(target=self._retry_leftover, name="steady-wifi-leftover", daemon=True).start()

    def _retry_leftover(self) -> None:
        deadline = time.monotonic() + LEFTOVER_RETRY_SECONDS
        while time.monotonic() < deadline:
            time.sleep(POLL_SECONDS)
            with self._lock:
                if self._state is not None or not self._record.exists():
                    return
                raw = self._load_record()
                if raw is None or self._put_back(raw, "a round cut short"):
                    return
        decky.logger.warning("steady wifi: couldn't put Wi-Fi power saving back, trying again next start")

    def _put_back(self, raw: dict, what: str) -> bool:
        scans = "scans left as they were"
        if raw.get("bgscanChanged") is True and isinstance(raw.get("bgscanBefore"), str):
            try:
                scans = self._put_scans_back(raw)
            except Exception as e:
                scans = f"scans not reachable ({type(e).__name__})"
        power = "power saving left as it was"
        if raw.get("powerSaveChanged") is True:
            now = self._read_power()
            if not now:
                self._debug("put back after %s (%s; power saving not readable yet)", what, scans)
                return False
            if now == POWER_OFF and self._write_power(POWER_ON):
                power = "power saving on"
            elif now == POWER_OFF:
                return False
            elif now == POWER_ON:
                power = "power saving already on"
        self._remove_record()
        decky.logger.info("steady wifi: put back after %s (%s; %s)", what, scans, power)
        return True

    def _put_scans_back(self, raw: dict) -> str:
        bus = _open_bus()
        try:
            if not isinstance(raw.get("iface"), str) or not _has_owner(bus, WPA):
                return "scans already back"
            path = bus.call(WPA, WPA_PATH, WPA, "GetInterface", "s", (raw["iface"],), timeout=CALL_SECONDS)[0]
            network = bus.get(WPA, path, WPA_INTERFACE, "CurrentNetwork", timeout=CALL_SECONDS)
            if network != raw.get("network"):
                return "scans already back"
            props = bus.get(WPA, network, WPA_NETWORK, "Properties", timeout=CALL_SECONDS)
            if _unquote(props.get("bgscan")) != "":
                return "scans already back"
            _set_bgscan(bus, network, raw["bgscanBefore"])
            return f"scans '{raw['bgscanBefore']}'"
        finally:
            bus.close()

    def _load_record(self):
        raw = load_json_file(self._record, None)
        if raw is None:
            return None
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(self._record)
            return None
        if not isinstance(raw, dict):
            self._remove_record()
            return None
        return raw

    def _save_record(self, state: dict) -> None:
        try:
            ensure_dir(self._record.parent)
            save_json_file(self._record, state, compact=True)
        except OSError as e:
            decky.logger.warning("steady wifi: couldn't keep the put-back record (%s)", type(e).__name__)

    def _remove_record(self) -> None:
        try:
            os.unlink(self._record)
        except FileNotFoundError:
            pass
        except OSError as e:
            decky.logger.warning("steady wifi: couldn't remove the put-back record (%s)", type(e).__name__)


def _open_bus():
    return nm_dbus.Bus().open(timeout=CALL_SECONDS)


def _has_owner(bus, name: str) -> bool:
    return bool(bus.call(nm_dbus.DBUS, nm_dbus.DBUS_PATH, nm_dbus.DBUS, "NameHasOwner", "s", (name,),
                         timeout=CALL_SECONDS)[0])


def _set_bgscan(bus, network: str, value: str) -> None:
    bus.set(WPA, network, WPA_NETWORK, "Properties",
            nm_dbus.Variant("a{sv}", {"bgscan": nm_dbus.Variant("s", value)}), timeout=CALL_SECONDS)


def _unquote(value) -> str:
    text = value if isinstance(value, str) else ""
    if len(text) >= 2 and text[0] == text[-1] == '"':
        return text[1:-1]
    return text


def _default_route_interface() -> str:
    best = None
    try:
        with open("/proc/net/route", encoding="ascii") as routes:
            next(routes, None)
            for line in routes:
                fields = line.split()
                if len(fields) < 8 or fields[1] != "00000000" or fields[7] != "00000000":
                    continue
                if not int(fields[3], 16) & 1:
                    continue
                metric = int(fields[6])
                if best is None or metric < best[0]:
                    best = (metric, fields[0])
    except (OSError, ValueError):
        return ""
    return best[1] if best is not None else ""


def _scan_words(target, state: dict) -> str:
    if target is None:
        return "scans left alone"
    if state["bgscanChanged"]:
        return f"scans off, was '{target['bgscan']}'"
    return "scans already off" if target["bgscan"] == "" else "scans left on"


def _power_words(power: str, changed: bool) -> str:
    if changed:
        return "power saving off, was on"
    if power == POWER_OFF:
        return "power saving already off, left alone"
    return "power saving left alone"
