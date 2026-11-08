import json
import os
import re
import secrets
import stat
import subprocess
import threading
import time
from pathlib import Path

import decky
import subprocess_util
from services.multiplayer_service import (
    GAME_AUDIO_BINARIES,
    GAME_AUDIO_KEYS,
    SILENCE_BYTES,
    WIREPLUMBER_ESCAPES,
    WIREPLUMBER_STATE,
    WIREPLUMBER_STATE_MAX,
)
from utils import child_owner

EC_SOURCE = "cheevodeck_ec_source"
EC_SINK = "cheevodeck_ec_sink"
GAME_SINK = "cheevodeck_game_sink"
OUR_NODES = (EC_SOURCE, EC_SINK, GAME_SINK)
NODE_PROPS = "state.restore-props=false state.restore-target=false"
AEC_ARGS = "webrtc.noise_suppression=false webrtc.gain_control=false"

PACTL_SECONDS = 5
WATCH_SECONDS = 1.5
SAVED_SECONDS = 1.5
STAND_IN_SECONDS = 3.0

DUCK_DEPTHS = (-6, -12, -18, -24)
DUCK_DB = -12.0
DUCK_DOWN_SECONDS = 0.4
DUCK_UP_SECONDS = 1.5
DUCK_HOLD_SECONDS = 2.0
DUCK_STEP = 0.01
DUCKED_KINDS = ("speaker", "external")

SAVED_TARGET = re.compile(r'"target"\s*:\s*"([^"]*)"')


HEADSET_PORTS = ("Headphones", "Headset")
LOOPBACK_PREFIX = "alsa_loopback_device."
HEADSET_FORMS = ("headset", "headphone", "hands-free", "handset")


def output_kind(sink: str, source: str, port: str = "", form: str = "", bus: str = "") -> str:
    if port in HEADSET_PORTS or form in HEADSET_FORMS or "__Headphones__" in sink or "__Headset__" in sink:
        return "headset"
    if source.startswith(LOOPBACK_PREFIX):
        source = source[len(LOOPBACK_PREFIX):]
    for out_prefix, in_prefix in (("bluez_output.", "bluez_input."), ("alsa_output.usb-", "alsa_input.usb-")):
        if sink.startswith(out_prefix) and source.startswith(in_prefix) \
                and sink[len(out_prefix):].split(".")[0] == source[len(in_prefix):].split(".")[0]:
            return "headset"
    if (port == "Speaker" and bus == "pci") or (sink.startswith("alsa_output.pci-") and "__Speaker__" in sink):
        return "speaker"
    return "external"


class VoiceCanceller:
    def __init__(self, *, user_home):
        self._user_home = Path(user_home)
        self._lock = threading.RLock()
        self._ramp_wake = threading.Condition()
        self._wanted = False
        self._watching = False
        self._still_wanted = None
        self._changed = None
        self._watcher = None
        self._seen = None
        self._modules = []
        self._kind = ""
        self._game_sink = None
        self._moved = {}
        self._ramp = None
        self._ducked = False
        self._duck_db = DUCK_DB
        self._released_at = 0.0
        self._shut = False
        self._hold = False
        self._live = None
        self._cancelling = False
        self._pinned = {}
        self._pin_apps = set()
        self._pin_targets = set()

    def _env(self) -> dict:
        owner = child_owner()
        uid = owner[0] if owner else os.getuid()
        return {
            "HOME": str(self._user_home),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "XDG_RUNTIME_DIR": f"/run/user/{uid}",
        }

    def _run(self, *argv):
        try:
            return subprocess_util.run_command(list(argv), timeout=PACTL_SECONDS, env=self._env(), as_data_owner=True)
        except Exception as e:
            decky.logger.warning("voice: %s failed (%s)", argv[0], type(e).__name__)
            return 1, "", ""

    def _json(self, *argv):
        code, out, _err = self._run("pactl", "-f", "json", *argv)
        try:
            rows = json.loads(out) if code == 0 else None
        except ValueError:
            return None
        return rows if isinstance(rows, list) else None

    def _defaults(self):
        code, sink, _err = self._run("pactl", "get-default-sink")
        code2, source, _err2 = self._run("pactl", "get-default-source")
        sink, source = sink.strip(), source.strip() if code2 == 0 else ""
        if code != 0 or not sink:
            return None
        if sink in OUR_NODES or source in OUR_NODES:
            return None
        mic = next((row for row in self._json("list", "sources") or []
                    if isinstance(row, dict) and row.get("name") == source), None) if source else None
        mic_props = mic.get("properties") if mic is not None and isinstance(mic.get("properties"), dict) else {}
        if mic is None or mic_props.get("device.class") == "monitor":
            source = ""
        row = next((row for row in self._json("list", "sinks") or []
                    if isinstance(row, dict) and row.get("name") == sink), None)
        if row is None:
            return None
        props = row.get("properties") if isinstance(row.get("properties"), dict) else {}
        active = row.get("active_port")
        port = next((entry.get("type") for entry in row.get("ports") or []
                     if isinstance(entry, dict) and entry.get("name") == active), "")
        return (sink, source, str(port or ""), str(props.get("device.form_factor") or ""),
                str(props.get("device.bus") or ""))

    def output(self) -> str:
        defaults = self._defaults()
        return output_kind(*defaults) if defaults is not None else "speaker"

    def output_volume(self):
        code, sink, _err = self._run("pactl", "get-default-sink")
        sink = sink.strip()
        if code != 0 or not sink or sink in OUR_NODES:
            return None
        code, out, _err = self._run("pactl", "get-sink-volume", sink)
        found = re.search(r"(\d+)%", out) if code == 0 else None
        return int(found.group(1)) if found else None

    def set_output_volume(self, percent: int) -> bool:
        if type(percent) is not int or not 0 <= percent <= 100:
            return False
        code, sink, _err = self._run("pactl", "get-default-sink")
        sink = sink.strip()
        if code != 0 or not sink or sink in OUR_NODES:
            return False
        code, _out, _err = self._run("pactl", "set-sink-volume", sink, f"{percent}%")
        return code == 0

    def watch(self, still_wanted, changed) -> None:
        with self._lock:
            if self._shut:
                return
            self._watching = True
            self._still_wanted = still_wanted
            self._changed = changed
            if self._watcher is None or not self._watcher.is_alive():
                self._watcher = threading.Thread(target=self._watch, name="voice-canceller", daemon=True)
                self._watcher.start()

    def start(self, still_wanted, changed) -> dict:
        self.watch(still_wanted, changed)
        with self._lock:
            if self._shut:
                return {"active": False, "duck": False, "kind": ""}
            self._wanted = True
            defaults = self._defaults()
            if defaults is None:
                return {"active": False, "duck": False, "kind": ""}
            kind = output_kind(*defaults)
            cancel = kind != "headset" and bool(defaults[1])
            if self._modules and defaults == self._seen:
                if self._cancelling or not cancel:
                    return self._state()
                if self._live is not None and self._live():
                    return {"active": False, "duck": False, "kind": kind}
            moved = self._seen is not None and defaults != self._seen
            self._unload()
            self._seen = defaults
            if cancel or self._hold:
                self._load(defaults, kind, cancel)
            state = self._state() if self._modules else {"active": False, "duck": False, "kind": kind}
        if moved and changed is not None:
            try:
                changed("output", kind)
            except Exception as e:
                decky.logger.warning("voice: couldn't tell the panel (%s)", type(e).__name__)
        return state

    def _state(self) -> dict:
        return {"active": self._cancelling, "duck": self._cancelling and self._kind in DUCKED_KINDS, "kind": self._kind}

    def stop(self) -> None:
        with self._lock:
            self._wanted = False
            if not self._hold:
                self._unload()

    def shutdown(self) -> None:
        self._shut = True
        with self._lock:
            self._hold = False
            self._live = None
        self.close()

    def close(self) -> None:
        with self._lock:
            self._wanted = False
            if self._hold:
                return
            self._watching = False
            self._seen = None
            self._unload()

    def hold(self, still_wanted, changed, live) -> str:
        self.watch(still_wanted, changed)
        with self._lock:
            if self._shut:
                return ""
            self._hold = True
            self._live = live
            if not self._modules:
                defaults = self._defaults()
                if defaults is None:
                    return ""
                self._seen = defaults
                if not self._load(defaults, output_kind(*defaults), cancel=False):
                    return ""
            return GAME_SINK

    def release(self) -> None:
        with self._lock:
            self._hold = False
            self._live = None
            if not self._wanted:
                self._seen = None
                self._unload()
            else:
                self._unpin()

    def _load(self, defaults, kind, cancel=True) -> bool:
        sink, source = defaults[:2]
        self._unload_strays()
        master = sink
        if cancel:
            code, out, _err = self._run(
                "pactl", "load-module", "module-echo-cancel", "aec_method=webrtc",
                f"source_master={source}", f"sink_master={sink}", f"source_name={EC_SOURCE}", f"sink_name={EC_SINK}",
                f"source_properties={NODE_PROPS}", f"sink_properties={NODE_PROPS}", f"aec_args={AEC_ARGS}",
            )
            if code != 0 or not out.strip().isdigit():
                decky.logger.warning("voice: couldn't load the echo canceller")
                return False
            self._modules.append(out.strip())
            master = EC_SINK
        code, out, _err = self._run(
            "pactl", "load-module", "module-remap-sink", f"sink_name={GAME_SINK}", f"master={master}",
            f"sink_properties={NODE_PROPS}",
        )
        if code != 0 or not out.strip().isdigit():
            decky.logger.warning("voice: couldn't load the game sink")
            self._unload()
            return False
        self._modules.append(out.strip())
        sinks = self._json("list", "sinks") or []
        found = next((row.get("properties", {}) for row in sinks
                      if isinstance(row, dict) and row.get("name") == GAME_SINK), {})
        if not str(found.get("object.id", "")).isdigit() or not str(found.get("object.serial", "")).isdigit():
            decky.logger.warning("voice: the game sink didn't appear")
            self._unload()
            return False
        self._game_sink = (str(found["object.id"]), str(found["object.serial"]))
        self._kind = kind
        self._cancelling = cancel
        self._move_games()
        if cancel and kind in DUCKED_KINDS:
            link = next((str(row["properties"].get("object.id")) for row in self._sink_inputs()
                         if row["properties"].get("node.name") == f"output.{GAME_SINK}"), "")
            stop = threading.Event()
            with self._ramp_wake:
                self._ducked = False
                self._ramp = stop
            threading.Thread(target=self._ramp_loop, args=(stop, link if link.isdigit() else self._game_sink[0]),
                             name="voice-duck", daemon=True).start()
        if cancel:
            decky.logger.info("voice: echo canceller on (%s)", kind)
        else:
            decky.logger.info("voice: game sink on, no echo canceller (%s)", kind)
        return True

    def _unload(self) -> None:
        if not self._modules:
            return
        with self._ramp_wake:
            if self._ramp is not None:
                self._ramp.set()
                self._ramp = None
                self._ramp_wake.notify_all()
        live = {str(row["properties"].get("object.id")) for row in self._sink_inputs()}
        for node in [*self._moved, *self._pinned]:
            if node in live:
                self._run("pw-metadata", "-n", "default", "-d", node, "target.object")
        self._moved = {}
        self._pinned = {}
        pins = frozenset() if self._hold else self._take_pins()
        for module in reversed(self._modules):
            self._run("pactl", "unload-module", module)
        self._modules = []
        self._game_sink = None
        self._kind = ""
        decky.logger.info("voice: %s off", "echo canceller" if self._cancelling else "game sink")
        self._cancelling = False
        threading.Thread(target=self._tidy_later, args=(pins,), name="voice-tidy", daemon=True).start()

    def _take_pins(self) -> frozenset:
        targets = frozenset(self._pin_targets)
        pins = frozenset((app, targets) for app in self._pin_apps)
        self._pin_apps, self._pin_targets = set(), set()
        return pins

    def _unpin(self) -> None:
        if self._pinned:
            live = {str(row["properties"].get("object.id")) for row in self._sink_inputs()}
            for node in self._pinned:
                if node in live:
                    self._run("pw-metadata", "-n", "default", "-d", node, "target.object")
            self._pinned = {}
        pins = self._take_pins()
        if pins:
            threading.Thread(target=self._tidy_later, args=(pins,), name="voice-tidy", daemon=True).start()

    def _tidy_later(self, pins=frozenset()) -> None:
        time.sleep(SAVED_SECONDS)
        self.clear_saved_targets()
        if not pins:
            return
        try:
            saved = self._saved_targets(None)
        except OSError:
            return
        for app, targets in pins:
            prop, _sep, value = app.partition(":")
            if saved.get(app) in targets and prop in GAME_AUDIO_KEYS and value:
                self._clear_target(prop, value)

    def _watch(self) -> None:
        while True:
            time.sleep(WATCH_SECONDS)
            with self._lock:
                if not self._watching:
                    self._watcher = None
                    return
                still_wanted, changed = self._still_wanted, self._changed
            try:
                wanted = still_wanted() if still_wanted else False
            except Exception:
                wanted = False
            reason = ""
            defaults = None
            with self._lock:
                if not self._watching:
                    continue
                if not wanted and not self._hold:
                    self._watching = False
                    self._wanted = False
                    self._seen = None
                    self._unload()
                    reason = "room"
                else:
                    defaults = self._defaults()
                    if defaults is not None and self._seen is None:
                        self._seen = defaults
                    elif defaults is not None and defaults != self._seen:
                        self._unload()
                        self._seen = defaults
                        reason = "output"
                        if self._hold:
                            self._load(defaults, output_kind(*defaults), cancel=False)
                    elif self._modules:
                        self._move_games()
            if reason:
                decky.logger.info("voice: the sound output %s", "changed" if reason == "output" else "is out of voice")
                kind = output_kind(*defaults) if defaults is not None else ""
                if changed is not None:
                    try:
                        changed(reason, kind)
                    except Exception as e:
                        decky.logger.warning("voice: couldn't tell the panel (%s)", type(e).__name__)

    def _sink_inputs(self):
        return [row for row in self._json("list", "sink-inputs") or []
                if isinstance(row, dict) and isinstance(row.get("properties"), dict)]

    def _move_games(self) -> None:
        if self._game_sink is None:
            return
        rows = self._sink_inputs()
        live = set()
        for row in rows:
            props = row["properties"]
            node = str(props.get("object.id", ""))
            live.add(node)
            if props.get("application.process.binary") not in GAME_AUDIO_BINARIES or not node.isdigit():
                continue
            if node in self._moved:
                continue
            app = next((f"{key}:{props[key]}" for key in GAME_AUDIO_KEYS
                        if isinstance(props.get(key), str) and props[key]), "")
            code, _out, _err = self._run("pw-metadata", "-n", "default", node, "target.object", self._game_sink[1])
            if code == 0:
                self._moved[node] = app
        for node in [node for node in self._moved if node not in live]:
            del self._moved[node]
        if self._hold and self._seen is not None:
            self._pin_others(rows, live)

    def _pin_others(self, rows, live) -> None:
        hardware = self._seen[0]
        sink = next((row for row in self._json("list", "sinks") or []
                     if isinstance(row, dict) and row.get("name") == hardware), None)
        serial = str((sink or {}).get("properties", {}).get("object.serial", ""))
        if not serial.isdigit():
            return
        for row in rows:
            props = row["properties"]
            node = str(props.get("object.id", ""))
            binary = props.get("application.process.binary")
            names = f"{props.get('node.name', '')} {props.get('media.name', '')}"
            if not node.isdigit() or node in self._moved or node in self._pinned or not binary \
                    or binary in GAME_AUDIO_BINARIES or props.get("target.object") \
                    or any(ours in names for ours in (*OUR_NODES, "cheevodeck-tidy-")):
                continue
            app = next((f"{key}:{props[key]}" for key in GAME_AUDIO_KEYS
                        if isinstance(props.get(key), str) and props[key]), "")
            if app and app not in self._pin_apps:
                try:
                    saved = self._saved_targets(None)
                except OSError:
                    saved = {}
                if saved.get(app) is None or saved.get(app) in self._pin_targets:
                    self._pin_apps.add(app)
            code, _out, _err = self._run("pw-metadata", "-n", "default", node, "target.object", serial)
            if code == 0:
                self._pinned[node] = app
                self._pin_targets.add(hardware)
        for node in [node for node in self._pinned if node not in live]:
            del self._pinned[node]

    def duck(self, on: bool, db=DUCK_DB) -> bool:
        with self._ramp_wake:
            if self._ramp is None:
                return False
            self._duck_db = float(db) if type(db) in (int, float) and db in DUCK_DEPTHS else DUCK_DB
            if self._ducked and not on:
                self._released_at = time.monotonic()
            self._ducked = bool(on)
            self._ramp_wake.notify_all()
            return True


    def _ramp_loop(self, stop, node) -> None:
        owner = child_owner()
        argv = ["setpriv", "--pdeathsig", "KILL"]
        if owner and os.geteuid() == 0:
            argv[1:1] = [f"--reuid={owner[0]}", f"--regid={owner[1]}", "--init-groups"]
        argv.append("pw-cli")
        try:
            proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, env=self._env(), text=True)
        except OSError as e:
            decky.logger.warning("voice: couldn't start the game duck (%s)", type(e).__name__)
            with self._ramp_wake:
                if self._ramp is stop:
                    self._ramp = None
            return
        level = 0.0
        try:
            while True:
                with self._ramp_wake:
                    while True:
                        if stop.is_set():
                            return
                        target = self._duck_db if self._ducked else 0.0
                        depth = abs(self._duck_db)
                        if not self._ducked and level < 0.0:
                            hold_left = self._released_at + DUCK_HOLD_SECONDS - time.monotonic()
                            if hold_left > 0:
                                self._ramp_wake.wait(hold_left)
                                continue
                        if level != target:
                            break
                        self._ramp_wake.wait()
                span = max(depth, 1.0) * DUCK_STEP
                if target < level:
                    level = max(target, level - span / DUCK_DOWN_SECONDS)
                else:
                    level = min(target, level + span / DUCK_UP_SECONDS)
                gain = 10 ** (level / 20)
                proc.stdin.write(f"s {node} Props {{ channelVolumes: [ {gain:.6f} {gain:.6f} ] }}\n")
                proc.stdin.flush()
                time.sleep(DUCK_STEP)
        except (OSError, ValueError) as e:
            decky.logger.warning("voice: the game duck stopped (%s)", type(e).__name__)
            with self._ramp_wake:
                if self._ramp is stop:
                    self._ramp = None
        finally:
            try:
                proc.stdin.write("quit\n")
                proc.stdin.close()
            except (OSError, ValueError):
                pass
            try:
                proc.wait(2)
            except subprocess.TimeoutExpired:
                proc.kill()

    def _unload_strays(self) -> bool:
        code, out, _err = self._run("pactl", "list", "short", "modules")
        if code != 0:
            return False
        ours = set(self._modules)
        found = False
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) >= 3 and parts[0] not in ours and any(f"={name}" in parts[2] for name in OUR_NODES):
                self._run("pactl", "unload-module", parts[0])
                found = True
        return found

    def _saved_targets(self, targets=OUR_NODES) -> dict:
        fd = os.open(self._user_home / WIREPLUMBER_STATE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > WIREPLUMBER_STATE_MAX:
                raise OSError("not a plain file")
            text = os.read(fd, WIREPLUMBER_STATE_MAX + 1).decode("utf-8", errors="replace")
        finally:
            os.close(fd)
        found = {}
        for line in text.splitlines():
            key, sep, body = line.partition("=")
            if not sep or not key.startswith("Output/Audio:"):
                continue
            target = SAVED_TARGET.search(body)
            if target is None or (targets is not None and target.group(1) not in targets):
                continue
            name = re.sub(r"\\(.)", lambda m: WIREPLUMBER_ESCAPES.get(m.group(1), m.group(0)), key[len("Output/Audio:"):])
            found[name] = target.group(1)
        return found

    def clear_saved_targets(self) -> int:
        try:
            saved = self._saved_targets()
        except OSError:
            return 0
        with self._lock:
            moving = set(self._moved.values())
        cleared = 0
        for app in saved:
            prop, _sep, value = app.partition(":")
            if prop in GAME_AUDIO_KEYS and value and app not in moving and self._clear_target(prop, value):
                cleared += 1
        return cleared

    def _clear_target(self, prop: str, value: str) -> bool:
        name = f"cheevodeck-tidy-{secrets.token_hex(4)}"
        argv = ["pacat", "--playback", "--raw", "--format=s16le", "--rate=48000", "--channels=2",
                f"--property={prop}={value}", f"--stream-name={name}"]
        if prop == "application.name":
            argv.append(f"--client-name={value}")
        owner = child_owner()
        try:
            proc = subprocess.Popen(
                argv, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                env=self._env(), user=owner[0] if owner else None, group=owner[1] if owner else None,
                extra_groups=[] if owner and os.geteuid() == 0 else None,
            )
        except OSError as e:
            decky.logger.warning("voice: couldn't open the stand-in stream (%s)", type(e).__name__)
            return False
        try:
            proc.stdin.write(bytes(SILENCE_BYTES))
            proc.stdin.flush()
            node = None
            deadline = time.monotonic() + STAND_IN_SECONDS
            while node is None and proc.poll() is None and time.monotonic() < deadline:
                time.sleep(0.2)
                node = next((str(row["properties"].get("object.id")) for row in self._sink_inputs()
                             if row["properties"].get("media.name") == name), None)
            if node is None:
                return False
            self._run("pw-metadata", "-n", "default", "--", node, "target.object", "-1")
            self._run("pw-metadata", "-n", "default", "-d", node, "target.object")
            time.sleep(SAVED_SECONDS)
            try:
                return f"{prop}:{value}" not in self._saved_targets()
            except OSError:
                return False
        except OSError:
            return False
        finally:
            try:
                proc.stdin.close()
            except OSError:
                pass
            proc.kill()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                pass

    def repair(self) -> bool:
        with self._lock:
            if self._modules:
                return False
            unloaded = self._unload_strays()
        return bool(self.clear_saved_targets()) or unloaded
