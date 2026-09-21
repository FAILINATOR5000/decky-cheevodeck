import secrets
import threading
import time
from pathlib import Path
from typing import Any

from utils import ensure_dir, load_json_file, save_json_file, to_int


CURRENT_SCHEMA_VERSION = 1

HISTORY_FILENAME = "calculator_history.json"

MAX_HISTORY_ENTRIES = 30

MAX_EXPRESSION_LENGTH = 512

MAX_RESULT_LENGTH = 64


class CalculatorStore:

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def repoint(self, base_dir: Path) -> None:
        with self._lock:
            self._base_dir = base_dir
            ensure_dir(self._base_dir)

    def _path(self) -> Path:
        return self._base_dir / HISTORY_FILENAME

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "entries": [],
        }

    def _clean_entry(self, raw: Any) -> dict:
        if not isinstance(raw, dict):
            return {}
        expression = str(raw.get("expression") or "")[:MAX_EXPRESSION_LENGTH]
        result = str(raw.get("result") or "")[:MAX_RESULT_LENGTH]
        if not expression or not result:
            return {}
        return {
            "id": str(raw.get("id") or "") or self._new_id(),
            "expression": expression,
            "result": result,
            "createdAt": to_int(raw.get("createdAt", 0), 0),
        }

    def _new_id(self) -> str:
        return f"calc_{secrets.token_urlsafe(8)}"

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return self._empty_file()
        entries = raw.get("entries")
        if not isinstance(entries, list):
            return self._empty_file()
        cleaned = []
        for row in entries[:MAX_HISTORY_ENTRIES]:
            entry = self._clean_entry(row)
            if entry:
                cleaned.append(entry)
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "entries": cleaned,
        }

    def list_entries(self) -> list:
        with self._lock:
            return self._load_raw()["entries"]

    def add_entry(self, expression: Any, result: Any) -> list:
        entry = self._clean_entry({
            "id": self._new_id(),
            "expression": expression,
            "result": result,
            "createdAt": int(time.time()),
        })
        if not entry:
            return self.list_entries()

        with self._lock:
            data = self._load_raw()
            data["entries"].insert(0, entry)
            del data["entries"][MAX_HISTORY_ENTRIES:]
            save_json_file(self._path(), data, compact=True)

            return data["entries"]

    def clear(self) -> list:
        with self._lock:
            save_json_file(self._path(), self._empty_file(), compact=True)

            return []
