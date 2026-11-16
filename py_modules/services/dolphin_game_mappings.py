import base64
import os
import re
import stat
import threading
import time
from pathlib import Path

import decky
import multiplayer_session as session
from utils import (
    atomic_file,
    child_owner,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    report_newer_schema,
    save_json_file,
    user_file_target,
)

CURRENT_SCHEMA_VERSION = 1
PUT_BACK_RECORD = "dolphin_mapping_put_back.json"
CONTROLLER_FILES = ("GCPadNew.ini", "WiimoteNew.ini")
SI_KEYS = tuple(f"SIDevice{port}" for port in range(4))
SYSTEMS = {session.GAMECUBE_SYSTEM: "gamecube", session.WII_SYSTEM: "wii"}
INSTALLS = ("flatpak", "appimage")
GONE_WAIT_SECONDS = 30
GONE_CHECK_SECONDS = 1
_KEY_LINE = re.compile(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$")


def mapping_system(system_id: int) -> str:
    return SYSTEMS.get(system_id, "")


def takes_mappings(system_id: int, emulator: str, install: str) -> bool:
    return bool(mapping_system(system_id)) and emulator == "dolphin" and install in INSTALLS


def _core_values(text: str) -> dict:
    values = {key: None for key in SI_KEYS}
    section = ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped[1:-1]
            continue
        found = _KEY_LINE.match(line)
        if section == "Core" and found and found.group(1) in values:
            values[found.group(1)] = found.group(2)
    return values


def _with_core_values(text: str, values: dict) -> str:
    out = []
    section = ""
    pending = dict(values)
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            if section == "Core":
                out.extend(f"{key} = {value}" for key, value in pending.items() if value is not None)
                pending = {}
            section = stripped[1:-1]
            out.append(line)
            continue
        found = _KEY_LINE.match(line)
        if section == "Core" and found and found.group(1) in values:
            value = pending.pop(found.group(1), None)
            if value is not None:
                out.append(f"{found.group(1)} = {value}")
            continue
        out.append(line)
    if section == "Core":
        out.extend(f"{key} = {value}" for key, value in pending.items() if value is not None)
        pending = {}
    if any(value is not None for value in pending.values()):
        if out and out[-1].strip():
            out.append("")
        out.append("[Core]")
        out.extend(f"{key} = {value}" for key, value in pending.items() if value is not None)
    return "\n".join(out) + "\n"


class DolphinGameMappings:
    def __init__(self, *, store, mappings_store, settings_store, apply, dolphin_running, runtime_dir, user_home):
        self._store = store
        self._settings_store = settings_store
        self._mappings = mappings_store
        self._apply = apply
        self._dolphin_running = dolphin_running
        self._record = Path(runtime_dir) / PUT_BACK_RECORD
        self._home = Path(user_home)
        self._lock = threading.Lock()

    def live_ids(self) -> set:
        return {mapping["id"] for mapping in self._mappings.load_all().get("mappings", [])}

    def mappings_for(self, system: str) -> list:
        return [mapping for mapping in self._mappings.load_all().get("mappings", []) if mapping.get("system") == system]

    def slots(self, game_id: int) -> dict:
        return self._store.get(game_id, self.live_ids())

    def set_slot(self, game_id: int, slot: str, mapping_id: str):
        return self._store.set(game_id, slot, mapping_id, self.live_ids())

    def apply(self, game_id: int, system_id: int, install: str, slot: str) -> bool:
        with self._lock:
            self._put_back_locked(wait=False)
            system = mapping_system(system_id)
            config = session.dolphin_config(self._home, install) if install in INSTALLS else None
            if not system or config is None:
                return False
            mappings = {mapping["id"]: mapping for mapping in self._mappings.load_all().get("mappings", [])}
            mapping_id = self._store.get(game_id, set(mappings))[slot]
            if not mapping_id:
                self._debug("game %s has no %s mapping", game_id, slot)
                return False
            if mappings[mapping_id].get("system") != system:
                self._debug("game %s's %s mapping is for the other console", game_id, slot)
                return False
            if self._record.exists():
                decky.logger.warning("dolphin mappings: an earlier mapping is still waiting to be put back, "
                                     "launching without game %s's", game_id)
                return False
            config_dir = config.parent
            if not self._save_record(config_dir):
                return False
            result = self._apply(mapping_id, [config_dir])
            if not result.get("ok"):
                decky.logger.info("dolphin mappings: launching game %s without its %s mapping (%s)", game_id, slot,
                                  result.get("error", "failed"))
                self._remove_record()
                return False
            decky.logger.info("dolphin mappings: applied game %s's %s mapping to the %s install", game_id, slot,
                              install)
            return True

    def forget_put_back(self) -> None:
        with self._lock:
            if self._record.exists():
                decky.logger.info("dolphin mappings: a mapping applied by hand replaces the waiting put-back")
                self._remove_record()

    def put_back(self, wait: bool = True) -> bool:
        with self._lock:
            return self._put_back_locked(wait)

    def _put_back_locked(self, wait: bool) -> bool:
        raw = load_json_file(self._record, None)
        if raw is None:
            return True
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(self._record)
            return False
        deadline = time.monotonic() + (GONE_WAIT_SECONDS if wait else 0)
        while self._dolphin_running():
            if time.monotonic() >= deadline:
                self._debug("Dolphin is still running, the controls go back later")
                return False
            time.sleep(GONE_CHECK_SECONDS)
        if not isinstance(raw, dict) or not isinstance(raw.get("configDir"), str) \
                or not isinstance(raw.get("files"), dict) or not isinstance(raw.get("siDevices"), dict):
            self._remove_record()
            return True
        config_dir = Path(raw["configDir"])
        put_back = True
        for name in CONTROLLER_FILES:
            if name in raw["files"]:
                put_back = self._restore_file(config_dir / name, raw["files"][name]) and put_back
        values = {key: raw["siDevices"].get(key) for key in SI_KEYS}
        if all(value is None or isinstance(value, str) for value in values.values()):
            put_back = self._restore_core(config_dir / "Dolphin.ini", values) and put_back
        if not put_back:
            decky.logger.warning("dolphin mappings: couldn't put all of the controls back")
            return False
        self._remove_record()
        decky.logger.info("dolphin mappings: put the controls back")
        return True

    def _save_record(self, config_dir: Path) -> bool:
        files = {}
        for name in CONTROLLER_FILES:
            try:
                files[name] = base64.b64encode((config_dir / name).read_bytes()).decode("ascii")
            except FileNotFoundError:
                files[name] = None
            except OSError as e:
                decky.logger.warning("dolphin mappings: couldn't copy %s before applying (%s)", name, type(e).__name__)
                return False
        try:
            text = (config_dir / "Dolphin.ini").read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            text = ""
        except OSError as e:
            decky.logger.warning("dolphin mappings: couldn't read Dolphin.ini before applying (%s)", type(e).__name__)
            return False
        record = {"schemaVersion": CURRENT_SCHEMA_VERSION, "configDir": str(config_dir), "files": files,
                  "siDevices": _core_values(text)}
        try:
            ensure_dir(self._record.parent)
            save_json_file(self._record, record, compact=True)
        except OSError as e:
            decky.logger.warning("dolphin mappings: couldn't keep the put-back copy (%s)", type(e).__name__)
            return False
        return True

    def _remove_record(self) -> None:
        try:
            os.unlink(self._record)
        except FileNotFoundError:
            pass
        except OSError as e:
            decky.logger.warning("dolphin mappings: couldn't remove the put-back copy (%s)", type(e).__name__)

    def _restore_file(self, path: Path, saved) -> bool:
        try:
            target = user_file_target(path, child_owner())
            if saved is None:
                try:
                    os.unlink(target)
                except FileNotFoundError:
                    pass
                return True
            self._replace(target, base64.b64decode(saved))
        except (OSError, ValueError) as e:
            decky.logger.warning("dolphin mappings: couldn't put %s back (%s)", path.name, type(e).__name__)
            return False
        return True

    def _restore_core(self, path: Path, values: dict) -> bool:
        try:
            target = user_file_target(path, child_owner())
            try:
                text = target.read_text(encoding="utf-8", errors="surrogateescape")
            except FileNotFoundError:
                if all(value is None for value in values.values()):
                    return True
                text = ""
            if _core_values(text) == values:
                return True
            self._replace(target, _with_core_values(text, values).encode("utf-8", errors="surrogateescape"))
        except OSError as e:
            decky.logger.warning("dolphin mappings: couldn't put Dolphin.ini's ports back (%s)", type(e).__name__)
            return False
        return True

    def _replace(self, target: Path, data: bytes) -> None:
        try:
            mode = stat.S_IMODE(os.stat(target).st_mode)
        except FileNotFoundError:
            mode = None
        with atomic_file(target, trusted=target.parent, keep_mode=mode,
                         tmp_name=f".{target.name}.cheevodeck-tmp") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())

    def _debug(self, message: str, *args) -> None:
        try:
            on = self._settings_store.get_debug_logging(self._settings_store.load_config())
        except Exception:
            on = False
        if on:
            decky.logger.info("dolphin mappings: " + message, *args)
