import os
import shutil
import threading
from pathlib import Path

import decky
from multiplayer_protocol import is_ulid
from utils import (
    NewerSchemaFile,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    save_json_file,
)

CURRENT_SCHEMA_VERSION = 1
FOLDER = "save_backup_settings"
INTERVALS = (0, 15, 30, 60)
DEFAULT_INTERVAL = 30
DEFAULTS = {"interval": DEFAULT_INTERVAL, "off": False}


class SaveBackupSettingsStore:

    def __init__(self, *, base_dir: Path, settings_store):
        self._root = Path(base_dir) / FOLDER
        self._settings_store = settings_store
        self._lock = threading.Lock()

    def _account(self) -> str:
        ulid = str(self._settings_store.load_config().get("activeUlid") or "")
        return ulid if is_ulid(ulid) else ""

    def _path(self, game_id: int):
        ulid = self._account()
        if not ulid or not 0 < game_id < 1 << 31:
            return None
        return self._root / ulid / f"{game_id}.json"

    def _read(self, path: Path) -> dict:
        raw = load_json_file(path, {})
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(path)
            return {}
        if not isinstance(raw, dict):
            return {}
        kept = {}
        if raw.get("interval") in INTERVALS and type(raw.get("interval")) is int:
            kept["interval"] = raw["interval"]
        if raw.get("off") is True:
            kept["off"] = True
        return kept

    def get(self, game_id: int) -> dict:
        path = self._path(game_id)
        if path is None:
            return dict(DEFAULTS)
        with self._lock:
            return {**DEFAULTS, **self._read(path)}

    def set(self, game_id: int, *, interval=None, off=None):
        path = self._path(game_id)
        if path is None or (interval is not None and (type(interval) is not int or interval not in INTERVALS)):
            return None
        with self._lock:
            row = self._read(path)
            if interval is not None:
                row["interval"] = interval
            if off is not None:
                row["off"] = bool(off)
            row = {key: value for key, value in row.items() if value != DEFAULTS[key]}
            try:
                refuse_newer_file(path, CURRENT_SCHEMA_VERSION)
                if row:
                    ensure_dir(path.parent)
                    save_json_file(path, {"schemaVersion": CURRENT_SCHEMA_VERSION, **row}, compact=True)
                else:
                    try:
                        os.unlink(path)
                    except FileNotFoundError:
                        pass
            except NewerSchemaFile:
                return None
            except OSError as e:
                decky.logger.warning("save backups: couldn't save the game's backup settings (%s)", type(e).__name__)
                return None
            return {**DEFAULTS, **row}

    def remove_account(self, ulid) -> None:
        if not is_ulid(ulid):
            return
        folder = self._root / ulid
        with self._lock:
            try:
                if folder.is_dir() and not folder.is_symlink():
                    shutil.rmtree(folder)
            except OSError as e:
                decky.logger.warning("save backups: couldn't remove the account's backup settings (%s)",
                                     type(e).__name__)
