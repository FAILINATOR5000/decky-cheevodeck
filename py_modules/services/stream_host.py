import base64
import json
import os
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import decky

import subprocess_util
from services.stream_setup import (
    CREDENTIALS_FILE,
    STATE_FILE,
    UNIT_NAME,
    _write_root,
    ensure_root_dir,
)
from utils import child_owner


API = "https://127.0.0.1:47990"
SUNSHINE_PORTS = (47984, 47989, 47990, 48010)
CONF_FILE = "sunshine.conf"
APPS_FILE = "apps.json"
LOG_FILE = "sunshine.log"
KEY_FILE = "cakey.pem"
CERT_FILE = "cacert.pem"
MARKER_DIR = Path("/run/cheevodeck")
COMPOSITE_MARKER = "force-composite"

RUNTIME_MAX_SECONDS = 4 * 3600
RENEW_BEFORE_SECONDS = 15 * 60
START_SECONDS = 25
API_SECONDS = 5
PIN_SECONDS = 20
STOP_SECONDS = 15
SYSTEMCTL_SECONDS = 20
LOG_TAIL_LINES = 12

ERROR_SUNSHINE_RUNNING = "sunshine_running"
ERROR_NEEDS_UPDATE = "stream_needs_update"
ERROR_SUNSHINE_FAILED = "sunshine_failed"
ERROR_NOT_SET_UP = "stream_not_set_up"


class ApiShapeError(Exception):
    pass


def _port_open(port: int) -> bool:
    for family, address in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        probe = socket.socket(family, socket.SOCK_STREAM)
        probe.settimeout(0.3)
        try:
            if probe.connect_ex((address, port)) == 0:
                return True
        except OSError:
            pass
        finally:
            probe.close()
    return False


class StreamHost:
    def __init__(self, *, setup, user_home: Path, debug=None, debug_on=None):
        self._setup = setup
        self._user_home = Path(user_home)
        self._debug = debug or (lambda *_args: None)
        self._debug_on = debug_on or (lambda: False)
        self._started_at = 0.0
        self._context = None
        self._name = ""
        self._sink = ""
        self._lock = threading.RLock()

    def _owner(self):
        owner = child_owner()
        return owner if owner is not None else (os.getuid(), os.getgid())

    def _uid(self) -> int:
        return self._owner()[0]

    def _xprop(self, *args) -> bool:
        env = {
            "HOME": str(self._user_home),
            "PATH": "/usr/bin:/bin",
            "DISPLAY": ":0",
            "XDG_RUNTIME_DIR": f"/run/user/{self._uid()}",
        }
        try:
            code, _out, err = subprocess_util.run_command(["xprop", "-root", *args], timeout=5, env=env,
                                                          as_data_owner=True)
        except Exception as e:
            decky.logger.warning("stream: xprop failed (%s)", type(e).__name__)
            return False
        if code != 0:
            decky.logger.warning("stream: xprop failed (%s)", err.strip()[:200])
        return code == 0

    def _force_composite(self, on: bool) -> None:
        marker = MARKER_DIR / COMPOSITE_MARKER
        if on:
            ensure_root_dir(MARKER_DIR)
            _write_root(marker, "1", 0o600)
            self._xprop("-f", "GAMESCOPE_COMPOSITE_FORCE", "32c", "-set", "GAMESCOPE_COMPOSITE_FORCE", "1")
            return
        self._xprop("-remove", "GAMESCOPE_COMPOSITE_FORCE")
        try:
            marker.unlink()
        except OSError:
            pass

    def _systemctl(self, *args):
        try:
            return subprocess_util.run_command(["systemctl", *args], timeout=SYSTEMCTL_SECONDS)
        except Exception as e:
            return 1, "", type(e).__name__

    def unit_active(self) -> bool:
        code, out, _err = self._systemctl("is-active", UNIT_NAME)
        return code == 0 and out.strip() == "active"

    def foreign_sunshine(self) -> bool:
        if self.unit_active():
            return False
        return any(_port_open(port) for port in SUNSHINE_PORTS)

    def _write_config(self, state: Path, name: str, sink: str) -> Path:
        lines = [
            f"sunshine_name = {name}",
            "capture = kms",
            "encoder = vaapi",
            "system_tray = disabled",
            "upnp = disabled",
            "origin_web_ui_allowed = pc",
            "keyboard = disabled",
            "mouse = disabled",
            "gamepad = xseries",
            "external_ip = 127.0.0.1",
            f"file_apps = {state / APPS_FILE}",
            f"log_path = {state / LOG_FILE}",
            f"credentials_file = {state / CREDENTIALS_FILE}",
            f"file_state = {state / STATE_FILE}",
            f"pkey = {state / KEY_FILE}",
            f"cert = {state / CERT_FILE}",
            f"min_log_level = {'debug' if self._debug_on() else 'info'}",
        ]
        if sink:
            lines.append(f"audio_sink = {sink}")
        conf = state / CONF_FILE
        _write_root(conf, "\n".join(lines) + "\n", 0o600)
        _write_root(state / APPS_FILE, json.dumps({"env": {}, "apps": [{"name": "Game", "image-path": ""}]}), 0o600)
        return conf

    def start(self, name: str, sink: str = "") -> str:
        with self._lock:
            return self._start(name, sink)

    def _start(self, name: str, sink: str) -> str:
        tree = self._setup.sunshine_dir()
        if tree is None or self._setup.login() is None:
            return ERROR_NOT_SET_UP
        if self.foreign_sunshine():
            return ERROR_SUNSHINE_RUNNING
        if self.unit_active():
            self.stop()
        state = self._setup.state_dir()
        try:
            ensure_root_dir(state, 0o700)
            conf = self._write_config(state, name, sink)
        except OSError as e:
            decky.logger.warning("stream: couldn't write Sunshine's config (%s)", type(e).__name__)
            return ERROR_SUNSHINE_FAILED
        self._name, self._sink = name, sink
        self._force_composite(True)
        uid = self._uid()
        env = {
            "HOME": str(state),
            "XDG_RUNTIME_DIR": f"/run/user/{uid}",
            "PULSE_SERVER": f"unix:/run/user/{uid}/pulse/native",
            "DISPLAY": ":0",
            "WAYLAND_DISPLAY": "gamescope-0",
            "LIBVA_DRIVERS_PATH": "/usr/lib/dri",
            "LIBVA_DRIVER_NAME": "radeonsi",
        }
        argv = ["systemd-run", f"--unit={UNIT_NAME}", "--collect", "--quiet",
                f"--property=RuntimeMaxSec={RUNTIME_MAX_SECONDS}",
                "--property=BindsTo=plugin_loader.service", "--property=After=plugin_loader.service",
                f"--working-directory={state}"]
        argv += [f"--setenv={key}={value}" for key, value in env.items()]
        argv += [str(tree / "AppRun"), str(conf)]
        try:
            code, _out, err = subprocess_util.run_command(argv, timeout=SYSTEMCTL_SECONDS)
        except Exception as e:
            code, err = 1, type(e).__name__
        if code != 0:
            decky.logger.warning("stream: Sunshine didn't start (%s)", str(err).strip()[:200])
            self._force_composite(False)
            return ERROR_SUNSHINE_FAILED
        self._started_at = time.monotonic()
        self._context = None
        deadline = time.monotonic() + START_SECONDS
        while time.monotonic() < deadline:
            time.sleep(0.5)
            if not self.unit_active():
                break
            try:
                self.clients()
                decky.logger.info("stream: Sunshine %s is up", tree.name)
                return ""
            except ApiShapeError:
                self.stop()
                return ERROR_NEEDS_UPDATE
            except (OSError, ValueError, urllib.error.URLError):
                continue
        decky.logger.warning("stream: Sunshine never answered its API")
        self._log_tail()
        self.stop()
        return ERROR_SUNSHINE_FAILED

    def _log_tail(self) -> None:
        try:
            with open(self._setup.state_dir() / LOG_FILE, encoding="utf-8", errors="replace") as handle:
                lines = handle.readlines()[-LOG_TAIL_LINES:]
        except OSError:
            return
        for line in lines:
            decky.logger.warning("stream: sunshine: %s", line.rstrip()[:300])

    def stop(self, unpair: bool = True) -> None:
        with self._lock:
            self._stop(unpair)

    def _stop(self, unpair: bool) -> None:
        if self.unit_active():
            if unpair:
                try:
                    self.unpair_all()
                except Exception as e:
                    self._debug("stream: unpair at stop failed (%s)", type(e).__name__)
            self._systemctl("stop", UNIT_NAME)
            deadline = time.monotonic() + STOP_SECONDS
            while self.unit_active() and time.monotonic() < deadline:
                time.sleep(0.3)
            decky.logger.info("stream: Sunshine stopped")
        self._systemctl("reset-failed", UNIT_NAME)
        self._force_composite(False)
        self._started_at = 0.0

    def renew_if_due(self) -> None:
        if not self._started_at or time.monotonic() - self._started_at < RUNTIME_MAX_SECONDS - RENEW_BEFORE_SECONDS:
            return
        decky.logger.info("stream: renewing Sunshine before its time limit")
        self.restart(lambda: True)

    def restart(self, wanted) -> str:
        with self._lock:
            self.stop(unpair=False)
            if not wanted():
                return ""
            return self.start(self._name, self._sink)

    def end_strays(self) -> list:
        fixed = []
        if self.unit_active():
            self._systemctl("stop", UNIT_NAME)
            fixed.append("stream_sunshine")
        self._systemctl("reset-failed", UNIT_NAME)
        if (MARKER_DIR / COMPOSITE_MARKER).exists():
            self._force_composite(False)
            fixed.append("stream_composite")
        return fixed

    def _ssl(self) -> ssl.SSLContext:
        if self._context is None:
            context = ssl.create_default_context(cafile=str(self._setup.state_dir() / CERT_FILE))
            context.check_hostname = False
            self._context = context
        return self._context

    def _call(self, method: str, path: str, body=None, timeout: float = API_SECONDS):
        login = self._setup.login()
        if login is None:
            raise OSError("no Sunshine login")
        token = base64.b64encode(f"{login[0]}:{login[1]}".encode("utf-8")).decode("ascii")
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(API + path, data=data, method=method, headers={
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        })
        with urllib.request.urlopen(request, timeout=timeout, context=self._ssl()) as response:
            raw = response.read()
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as e:
            raise ApiShapeError(path) from e

    def clients(self) -> list:
        answer = self._call("GET", "/api/clients/list")
        clients = answer.get("named_certs") if isinstance(answer, dict) else None
        if not isinstance(clients, list):
            raise ApiShapeError("/api/clients/list")
        return clients

    def pending_pins(self) -> list:
        answer = self._call("GET", "/api/pin")
        pairings = answer.get("pairings") if isinstance(answer, dict) else None
        if not isinstance(pairings, list):
            raise ApiShapeError("/api/pin")
        return [row for row in pairings if isinstance(row, dict) and isinstance(row.get("id"), str)
                and isinstance(row.get("address"), str)]

    def answer_pin(self, pairing_id: str, pin: str, name: str) -> bool:
        answer = self._call("POST", "/api/pin", {"pairing_id": pairing_id, "pin": pin, "name": name}, timeout=PIN_SECONDS)
        if not isinstance(answer, dict) or "status" not in answer:
            raise ApiShapeError("/api/pin")
        return answer.get("status") is True or answer.get("status") == "true"

    def unpair_name(self, name: str) -> None:
        for client in self.clients():
            if isinstance(client, dict) and client.get("name") == name and isinstance(client.get("uuid"), str):
                self._call("POST", "/api/clients/unpair", {"uuid": client["uuid"]})

    def unpair_all(self) -> None:
        self._call("POST", "/api/clients/unpair-all", {})

