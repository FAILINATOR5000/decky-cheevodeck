import re
import threading
from pathlib import Path

import decky

from utils import (
    NewerSchemaFile,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    save_json_file,
)


CURRENT_SCHEMA_VERSION = 1
FILENAME = "emulators.json"
KINDS = ("retroarch", "dolphin", "pcsx2", "duckstation", "ppsspp", "rmg", "melonds")
PATHS_PER_KIND = 8

_CORE = re.compile(r"^[A-Za-z0-9_+.-]{1,64}$")
_CRC = re.compile(r"^[0-9a-f]{8}$")
_SHORTCUT = re.compile(r"^[a-z0-9]{1,16}:(flatpak|[0-9a-f]{16})$")


def _text(value, limit: int) -> str:
    return value if isinstance(value, str) and len(value) <= limit else ""


def _clean_path(value) -> str:
    path = _text(value, 4096)
    return path if path.startswith("/") and "\0" not in path else ""


def _clean(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    paths = {}
    for kind, rows in (raw.get("paths") if isinstance(raw.get("paths"), dict) else {}).items():
        if kind not in KINDS or not isinstance(rows, list):
            continue
        kept = []
        for row in rows:
            path = _clean_path(row)
            if path and path not in kept:
                kept.append(path)
        if kept:
            paths[kind] = kept[:PATHS_PER_KIND]
    installed = raw.get("installed") if isinstance(raw.get("installed"), dict) else {}
    cores = {}
    for core, row in (installed.get("cores") if isinstance(installed.get("cores"), dict) else {}).items():
        if isinstance(core, str) and _CORE.match(core) and isinstance(row, dict) and _CRC.match(_text(row.get("crc"), 8)):
            cores[core] = {"crc": row["crc"], "from": _text(row.get("from"), 64)}
    appimages = {}
    for path, row in (installed.get("appimages") if isinstance(installed.get("appimages"), dict) else {}).items():
        if _clean_path(path) and isinstance(row, dict):
            appimages[path] = {"version": _text(row.get("version"), 128), "repo": _text(row.get("repo"), 200)}
    backups = {}
    for path, row in (installed.get("backups") if isinstance(installed.get("backups"), dict) else {}).items():
        if _clean_path(path) and isinstance(row, dict) and _clean_path(row.get("of")) \
                and row.get("kind") in ("core", "appimage"):
            kept = row.get("record") if isinstance(row.get("record"), dict) else None
            if kept is not None:
                kept = {key: _text(value, 200) for key, value in kept.items() if key in ("crc", "from", "version", "repo")}
            backups[path] = {"of": row["of"], "kind": row["kind"], "version": _text(row.get("version"), 128),
                             "record": kept}
    bundle_raw = raw.get("bundle") if isinstance(raw.get("bundle"), dict) else {}
    bundle_cores = {}
    for core, row in (bundle_raw.get("cores") if isinstance(bundle_raw.get("cores"), dict) else {}).items():
        if isinstance(core, str) and _CORE.match(core) and isinstance(row, dict) and _CRC.match(_text(row.get("crc"), 8)) \
                and type(row.get("size")) is int and row["size"] >= 0:
            bundle_cores[core] = {"crc": row["crc"], "size": row["size"]}
    pack_size = bundle_raw.get("packSize") if type(bundle_raw.get("packSize")) is int else 0
    bundle = {"raVersion": _text(bundle_raw.get("raVersion"), 32), "packSize": max(0, pack_size),
              "cores": bundle_cores} if bundle_cores else {}
    shortcuts = {}
    for key, appid in (raw.get("shortcuts") if isinstance(raw.get("shortcuts"), dict) else {}).items():
        if isinstance(key, str) and _SHORTCUT.match(key) and type(appid) is int and 0 < appid <= 0xFFFFFFFF:
            shortcuts[key] = appid
    return {"paths": paths, "installed": {"cores": cores, "appimages": appimages, "backups": backups}, "bundle": bundle,
            "shortcuts": shortcuts}


class EmulatorsStore:

    def __init__(self, *, base_dir: Path):
        self._base_dir = Path(base_dir)
        self._lock = threading.Lock()

    def _path(self) -> Path:
        return self._base_dir / FILENAME

    def _read(self) -> dict:
        raw = load_json_file(self._path(), {})
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(self._path())
            return _clean({})
        return _clean(raw)

    def get(self) -> dict:
        with self._lock:
            return self._read()

    def change(self, edit) -> bool:
        with self._lock:
            record = self._read()
            edit(record)
            record = _clean(record)
            try:
                refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
                save_json_file(self._path(), {"schemaVersion": CURRENT_SCHEMA_VERSION, **record}, compact=True)
            except NewerSchemaFile:
                return False
            except OSError as e:
                decky.logger.warning("emulators: couldn't save the emulator record (%s)", type(e).__name__)
                return False
        return True
