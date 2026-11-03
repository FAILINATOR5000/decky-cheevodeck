from pathlib import Path

import json
import os
import threading

import decky
from multiplayer_friends_store import clean_message
from multiplayer_protocol import is_ulid

from utils import (
    atomic_file,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    open_dir,
    refuse_newer_file,
)


CURRENT_SCHEMA_VERSION = 1
FOLDER = "multiplayer_messages"

MAX_MESSAGES = 500


def _rows(raw, friend: str) -> list:
    if not isinstance(raw, dict) or raw.get("friend") != friend or not isinstance(raw.get("messages"), list):
        return []
    kept = [message for message in (clean_message(row) for row in raw["messages"]) if message is not None]
    return kept[-MAX_MESSAGES:]


class MultiplayerMessagesStore:
    def __init__(self, *, base_dir: Path, ulid: str = ""):
        self._base_dir = base_dir
        self._ulid = ulid if is_ulid(ulid) else ""
        self._lock = threading.Lock()

    def repoint(self, base_dir: Path, ulid: str) -> None:
        with self._lock:
            self._base_dir = base_dir
            self._ulid = ulid if is_ulid(ulid) else ""

    def _dir(self) -> Path:
        return self._base_dir / FOLDER

    def _path(self, friend: str) -> Path:
        return self._dir() / (friend + ".json")

    def _ready(self, friend: str, ulid) -> bool:
        return bool(self._ulid) and is_ulid(friend) and (ulid is None or ulid == self._ulid)

    def _read(self, friend: str):
        raw = load_json_file(self._path(friend), None)
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            return None
        return _rows(raw, friend)

    def _write(self, friend: str, rows: list) -> None:
        folder = self._dir()
        ensure_dir(folder)
        fd = open_dir(folder)
        try:
            os.fchmod(fd, 0o700)
        finally:
            os.close(fd)
        refuse_newer_file(self._path(friend), CURRENT_SCHEMA_VERSION)
        body = {"schemaVersion": CURRENT_SCHEMA_VERSION, "friend": friend, "messages": rows[-MAX_MESSAGES:]}
        with atomic_file(self._path(friend), keep_mode=0o600) as out:
            out.write(json.dumps(body, separators=(",", ":")).encode("utf-8"))

    def load(self, friend: str) -> list:
        with self._lock:
            if not self._ready(friend, None):
                return []
            return self._read(friend) or []

    def add(self, friend: str, message: dict, *, ulid=None) -> bool:
        row = clean_message(message)
        with self._lock:
            if row is None or not self._ready(friend, ulid):
                return False
            rows = self._read(friend)
            if rows is None or any(kept["id"] == row["id"] for kept in rows):
                return False
            rows.append(row)
            try:
                self._write(friend, rows)
            except Exception as e:
                decky.logger.warning("friends: couldn't save a message (%s)", type(e).__name__)
                return False
            return True

    def delete(self, friend: str, *, ulid=None) -> None:
        with self._lock:
            if not self._ready(friend, ulid):
                return
            try:
                fd = open_dir(self._dir())
                try:
                    os.unlink(friend + ".json", dir_fd=fd)
                finally:
                    os.close(fd)
            except FileNotFoundError:
                pass
            except OSError as e:
                decky.logger.warning("friends: couldn't delete a conversation (%s)", type(e).__name__)

    def repair(self, friends) -> list:
        fixed = []
        with self._lock:
            if not self._ulid:
                return []
            try:
                fd = open_dir(self._dir())
            except (FileNotFoundError, NotADirectoryError):
                return []
            try:
                if os.fstat(fd).st_mode & 0o077:
                    os.fchmod(fd, 0o700)
                    fixed.append("folder_mode")
                keep = {friend["ulid"] for friend in friends} if friends is not None else None
                for entry in os.scandir(fd):
                    if not entry.name.endswith(".json") or not entry.is_file(follow_symlinks=False):
                        continue
                    if keep is not None and entry.name[:-5] not in keep:
                        os.unlink(entry.name, dir_fd=fd)
                        if "orphans" not in fixed:
                            fixed.append("orphans")
                        continue
                    if entry.stat(follow_symlinks=False).st_mode & 0o077:
                        file_fd = os.open(entry.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                        try:
                            os.fchmod(file_fd, 0o600)
                        finally:
                            os.close(file_fd)
                        if "mode" not in fixed:
                            fixed.append("mode")
            finally:
                os.close(fd)
        return fixed
