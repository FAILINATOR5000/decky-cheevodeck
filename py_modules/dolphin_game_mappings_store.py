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
FOLDER = "dolphin_game_mappings"
SLOTS = ("play", "stream")
MAPPING_ID_MAX_LEN = 64


def clean_mapping_id(value) -> str:
    if not isinstance(value, str) or not 0 < len(value) <= MAPPING_ID_MAX_LEN:
        return ""
    return value


class DolphinGameMappingsStore:
    def __init__(self, *, base_dir: Path, settings_store):
        self._root = Path(base_dir) / FOLDER
        self._settings_store = settings_store
        self._lock = threading.Lock()

    def _path(self, game_id: int):
        ulid = str(self._settings_store.load_config().get("activeUlid") or "")
        if not is_ulid(ulid) or type(game_id) is not int or not 0 < game_id < 1 << 31:
            return None
        return self._root / ulid / f"{game_id}.json"

    def _read(self, path: Path):
        raw = load_json_file(path, {})
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(path)
            return None
        if not isinstance(raw, dict):
            return {}
        return {slot: clean_mapping_id(raw.get(slot)) for slot in SLOTS if clean_mapping_id(raw.get(slot))}

    def _write(self, path: Path, row: dict) -> bool:
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
            return False
        except OSError as e:
            decky.logger.warning("dolphin mappings: couldn't save the game's mappings (%s)", type(e).__name__)
            return False
        return True

    def get(self, game_id: int, live_ids) -> dict:
        empty = {slot: "" for slot in SLOTS}
        path = self._path(game_id)
        if path is None:
            return empty
        with self._lock:
            row = self._read(path)
            if row is None:
                return empty
            kept = {slot: mapping_id for slot, mapping_id in row.items() if mapping_id in live_ids}
            if kept != row:
                self._write(path, kept)
            return {**empty, **kept}

    def set(self, game_id: int, slot: str, mapping_id: str, live_ids):
        path = self._path(game_id)
        if path is None or slot not in SLOTS:
            return None
        mapping_id = clean_mapping_id(mapping_id)
        if mapping_id and mapping_id not in live_ids:
            return None
        with self._lock:
            row = self._read(path)
            if row is None:
                return None
            row = {key: value for key, value in row.items() if value in live_ids}
            if mapping_id:
                row[slot] = mapping_id
            else:
                row.pop(slot, None)
            if not self._write(path, row):
                return None
            return {**{key: "" for key in SLOTS}, **row}

    def remove_account(self, ulid) -> None:
        if not is_ulid(ulid):
            return
        folder = self._root / ulid
        with self._lock:
            try:
                if folder.is_dir() and not folder.is_symlink():
                    shutil.rmtree(folder)
            except OSError as e:
                decky.logger.warning("dolphin mappings: couldn't remove the account's game mappings (%s)",
                                     type(e).__name__)
