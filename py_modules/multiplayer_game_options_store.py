import os
import shutil
import threading
from pathlib import Path

import decky
from multiplayer_protocol import is_ulid
from multiplayer_session import CHECK_FRAMES, DEFAULT_CHECK_FRAMES
from play_picks_store import clean_pick
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
FOLDER = "multiplayer_game_options"
ADAPTERS = ("auto", "team", "4way", "port1", "port2")
DEFAULTS = {
    "pick": None,
    "checkFrames": DEFAULT_CHECK_FRAMES,
    "share": False,
    "adapter": "auto",
    "watch": False,
}


def clean_option(key: str, value):
    if key == "pick":
        return clean_pick(value)
    if key == "checkFrames":
        return value if type(value) is int and value in CHECK_FRAMES else None
    if key == "adapter":
        return value if value in ADAPTERS else None
    if key in ("share", "watch"):
        return value if type(value) is bool else None
    return None


class MultiplayerGameOptionsStore:

    def __init__(self, *, base_dir: Path, settings_store):
        self._root = Path(base_dir) / FOLDER
        self._settings_store = settings_store
        self._lock = threading.Lock()

    def _path(self, game_id: int):
        ulid = str(self._settings_store.load_config().get("activeUlid") or "")
        if not is_ulid(ulid) or type(game_id) is not int or not 0 < game_id < 1 << 31:
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
        for key in DEFAULTS:
            value = clean_option(key, raw.get(key))
            if value is not None:
                kept[key] = value
        return kept

    def get(self, game_id: int) -> dict:
        path = self._path(game_id)
        if path is None:
            return dict(DEFAULTS)
        with self._lock:
            return {**DEFAULTS, **self._read(path)}

    def set(self, game_id: int, changes: dict) -> bool:
        path = self._path(game_id)
        if path is None:
            return False
        with self._lock:
            row = self._read(path)
            for key, value in changes.items():
                cleaned = clean_option(key, value)
                if key in DEFAULTS and (cleaned is not None or value is None):
                    row[key] = cleaned
            row = {key: value for key, value in row.items() if value is not None and value != DEFAULTS[key]}
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
                decky.logger.warning("multiplayer: couldn't save the game's room options (%s)", type(e).__name__)
                return False
        return True

    def remove_account(self, ulid) -> None:
        if not is_ulid(ulid):
            return
        folder = self._root / ulid
        with self._lock:
            try:
                if folder.is_dir() and not folder.is_symlink():
                    shutil.rmtree(folder)
            except OSError as e:
                decky.logger.warning("multiplayer: couldn't remove the account's room options (%s)", type(e).__name__)
