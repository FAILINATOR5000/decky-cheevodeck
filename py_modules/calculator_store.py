import hashlib
import math
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from utils import (
    NewerSchemaFile,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    save_json_file,
    to_int,
)


CURRENT_SCHEMA_VERSION = 1

HISTORY_FILENAME = "calculator_history.json"

MAX_HISTORY_ENTRIES = 30

MAX_EXPRESSION_LENGTH = 512

MAX_RESULT_LENGTH = 64

RESULT_PATTERN = re.compile(r"-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", re.ASCII)


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

    def _clean_result(self, raw: Any) -> str:
        result = str(raw)
        if len(result) > MAX_RESULT_LENGTH or not RESULT_PATTERN.fullmatch(result):
            return ""
        if not math.isfinite(float(result)):
            return ""
        return result

    def _clean_entry(self, raw: Any) -> dict:
        if not isinstance(raw, dict):
            return {}
        expression = str(raw.get("expression") or "")[:MAX_EXPRESSION_LENGTH]
        result = self._clean_result(raw.get("result"))
        if not expression or not result:
            return {}
        created_at = to_int(raw.get("createdAt", 0), 0)
        return {
            "id": str(raw.get("id") or "") or self._stable_id(expression, result, created_at),
            "expression": expression,
            "result": result,
            "createdAt": created_at,
        }

    def _stable_id(self, expression: str, result: str, created_at: int) -> str:
        digest = hashlib.sha256(f"{created_at}\n{result}\n{expression}".encode("utf-8")).hexdigest()
        return f"calc_{digest[:12]}"

    def _new_id(self) -> str:
        return f"calc_{secrets.token_urlsafe(8)}"

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(self._path())
            return self._empty_file()
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return self._empty_file()
        entries = raw.get("entries")
        if not isinstance(entries, list):
            return self._empty_file()
        cleaned = []
        seen = set()
        for row in entries[:MAX_HISTORY_ENTRIES]:
            entry = self._clean_entry(row)
            if not entry:
                continue
            base = entry["id"]
            suffix = 2
            while entry["id"] in seen:
                entry["id"] = f"{base}_{suffix}"
                suffix += 1
            seen.add(entry["id"])
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
            try:
                refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
            except NewerSchemaFile:
                return []
            save_json_file(self._path(), data, compact=True)

            return data["entries"]

    def clear(self) -> list:
        with self._lock:
            try:
                refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
            except NewerSchemaFile:
                return []
            save_json_file(self._path(), self._empty_file(), compact=True)

            return []
