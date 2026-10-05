import hashlib
import math
import secrets
import threading
import time
from pathlib import Path
from typing import Any

import decky

from utils import (
    NewerSchemaFile,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    save_json_file,
    to_float,
    to_int,
)


CURRENT_SCHEMA_VERSION = 1

INCIDENTS_FILENAME = "freeze_incidents.json"

INCIDENT_EVENT = "cheevodeck_freeze_incident"

MAX_ENTRIES = 200

KINDS = ("prevented", "recovered", "manual")

CONFIRMATIONS = ("fresh", "cpu", "memory", "focus")

ENDINGS = ("quiet", "cap")

MAX_GAME_LENGTH = 128
MAX_CAPTURE_LENGTH = 96
MAX_VERDICT_LENGTH = 300
MAX_CONTROLLER_LENGTH = 32

MAX_TIMESTAMP = 8_640_000_000_000

FAILED_CAPTURE_SUFFIX = " (failed)"

MAX_COUNT = 1_000_000
MAX_MS = 3_600_000
MAX_SECONDS = 86_400
MAX_SCORE = 100_000
MAX_KILLED = 10_000
MAX_CORES = 1_000.0
MAX_MB = 10_000_000


def _bounded_int(raw: Any, upper: int) -> int:
    if isinstance(raw, bool):
        return 0
    if isinstance(raw, float):
        if not math.isfinite(raw):
            return 0
        raw = round(raw)
    return min(max(to_int(raw, 0), 0), upper)


def _optional_int(raw: Any, upper: int):
    if raw is None:
        return None
    return _bounded_int(raw, upper)


def _bounded_float(raw: Any, upper: float) -> float:
    if isinstance(raw, bool):
        return 0.0
    value = to_float(raw, 0.0)
    if not math.isfinite(value):
        return 0.0
    return round(min(max(value, 0.0), upper), 2)


def _text(raw: Any, limit: int) -> str:
    if not isinstance(raw, str):
        return ""
    return " ".join(raw.split())[:limit]


def _optional_text(raw: Any, limit: int):
    text = _text(raw, limit)
    return text or None


def _capture(raw: Any):
    if isinstance(raw, str) and raw.endswith(FAILED_CAPTURE_SUFFIX):
        return None
    return _optional_text(raw, MAX_CAPTURE_LENGTH)


class FreezeIncidentsStore:

    def __init__(self, *, base_dir: Path, on_change=None):
        self._base_dir = base_dir
        self._on_change = on_change
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def _path(self) -> Path:
        return self._base_dir / INCIDENTS_FILENAME

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "totals": {kind: 0 for kind in KINDS},
            "entries": [],
        }

    def _clean_totals(self, raw: Any) -> dict:
        if not isinstance(raw, dict):
            raw = {}
        return {kind: _bounded_int(raw.get(kind), 2**53) for kind in KINDS}

    def _clean_prevented(self, raw: dict) -> dict:
        ended_by = raw.get("endedBy")
        return {
            "changes": _bounded_int(raw.get("changes"), MAX_COUNT),
            "spanMs": _bounded_int(raw.get("spanMs"), MAX_MS),
            "afterHiding": _bounded_int(raw.get("afterHiding"), MAX_COUNT),
            "lastChangeMs": _bounded_int(raw.get("lastChangeMs"), MAX_MS),
            "endedBy": ended_by if ended_by in ENDINGS else "cap",
            "viewShown": raw.get("viewShown") is True,
            "hiddenMs": _bounded_int(raw.get("hiddenMs"), MAX_MS),
            "game": _text(raw.get("game"), MAX_GAME_LENGTH),
        }

    def _clean_recovered(self, raw: dict) -> dict:
        confirmations = raw.get("confirmations")
        if not isinstance(confirmations, list):
            confirmations = []
        return {
            "silenceS": _bounded_int(raw.get("silenceS"), MAX_SECONDS),
            "score": _bounded_int(raw.get("score"), MAX_SCORE),
            "confirmations": [name for name in CONFIRMATIONS if name in confirmations],
            "busiestCores": _bounded_float(raw.get("busiestCores"), MAX_CORES),
            "rssGrowthMb": _bounded_int(raw.get("rssGrowthMb"), MAX_MB),
            "killed": _bounded_int(raw.get("killed"), MAX_KILLED),
            "verdict": _optional_text(raw.get("verdict"), MAX_VERDICT_LENGTH),
            "capture": _capture(raw.get("capture")),
            "pausedAfter": raw.get("pausedAfter") is True,
            "backAfterS": _optional_int(raw.get("backAfterS"), MAX_SECONDS),
        }

    def _clean_manual(self, raw: dict) -> dict:
        return {
            "controller": _text(raw.get("controller"), MAX_CONTROLLER_LENGTH),
            "killed": _bounded_int(raw.get("killed"), MAX_KILLED),
            "capture": _capture(raw.get("capture")),
        }

    def _clean_entry(self, raw: Any) -> dict:
        if not isinstance(raw, dict):
            return {}
        kind = raw.get("kind")
        if kind not in KINDS:
            return {}
        at = _bounded_int(raw.get("at"), MAX_TIMESTAMP)
        if kind == "prevented":
            fields = self._clean_prevented(raw)
        elif kind == "recovered":
            fields = self._clean_recovered(raw)
        else:
            fields = self._clean_manual(raw)
        entry_id = raw.get("id")
        if not isinstance(entry_id, str) or not entry_id.strip():
            entry_id = self._stable_id(kind, at, fields)
        return {"id": entry_id.strip()[:64], "kind": kind, "at": at, **fields}

    def _stable_id(self, kind: str, at: int, fields: dict) -> str:
        digest = hashlib.sha256(f"{kind}\n{at}\n{sorted(fields.items())}".encode("utf-8")).hexdigest()
        return f"inc_{digest[:12]}"

    def _new_id(self) -> str:
        return f"inc_{secrets.token_urlsafe(8)}"

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
            entries = []
        cleaned = []
        seen = set()
        for row in entries[:MAX_ENTRIES]:
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
            "totals": self._clean_totals(raw.get("totals")),
            "entries": cleaned,
        }

    def _save(self, data: dict) -> bool:
        try:
            refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
        except NewerSchemaFile:
            return False
        save_json_file(self._path(), data, compact=True)
        return True

    def _changed(self) -> None:
        if self._on_change is None:
            return
        try:
            self._on_change()
        except Exception as exc:
            decky.logger.warning("freeze incidents: change event failed (%s: %s)", type(exc).__name__, exc)

    def snapshot(self) -> dict:
        with self._lock:
            data = self._load_raw()
        return {"totals": data["totals"], "entries": data["entries"]}

    def _add(self, kind: str, fields: dict):
        entry = self._clean_entry({**fields, "id": self._new_id(), "kind": kind, "at": int(time.time())})
        try:
            with self._lock:
                data = self._load_raw()
                data["entries"].insert(0, entry)
                del data["entries"][MAX_ENTRIES:]
                data["totals"][kind] += 1
                if not self._save(data):
                    return None
        except Exception as exc:
            decky.logger.warning("freeze incidents: recording a %s failed (%s: %s)", kind, type(exc).__name__, exc)
            return None
        self._changed()
        return entry["id"]

    def add_prevented(self, fields: Any):
        if not isinstance(fields, dict):
            return None
        return self._add("prevented", fields)

    def add_recovered(self, **fields):
        return self._add("recovered", fields)

    def add_manual(self, **fields):
        return self._add("manual", fields)

    def mark_back(self, entry_id: str, seconds: float) -> bool:
        try:
            with self._lock:
                data = self._load_raw()
                entry = next((row for row in data["entries"] if row["id"] == entry_id), None)
                if entry is None or entry["kind"] != "recovered":
                    return False
                entry["backAfterS"] = _bounded_int(seconds, MAX_SECONDS)
                if not self._save(data):
                    return False
        except Exception as exc:
            decky.logger.warning("freeze incidents: marking %s back failed (%s: %s)", entry_id, type(exc).__name__, exc)
            return False
        self._changed()
        return True

    def clear(self) -> bool:
        try:
            with self._lock:
                data = self._load_raw()
                data["entries"] = []
                if not self._save(data):
                    return False
        except Exception as exc:
            decky.logger.warning("freeze incidents: clearing failed (%s: %s)", type(exc).__name__, exc)
            return False
        self._changed()
        return True
