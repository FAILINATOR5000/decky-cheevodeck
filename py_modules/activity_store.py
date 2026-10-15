from pathlib import Path

import threading

from local_days import is_month, this_month
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

MAX_ROWS_PER_MONTH = 20000


def _clean_row(raw):
    if not isinstance(raw, dict):
        return None
    achievement_id = to_int(raw.get("achievementId"), 0)
    game_id = to_int(raw.get("gameId"), 0)
    ts = to_int(raw.get("ts"), 0)
    if achievement_id <= 0 or game_id <= 0 or ts <= 0:
        return None
    return {
        "achievementId": achievement_id,
        "gameId": game_id,
        "gameTitle": str(raw.get("gameTitle") or "")[:300],
        "consoleName": str(raw.get("consoleName") or "")[:100],
        "title": str(raw.get("title") or "")[:300],
        "description": str(raw.get("description") or "")[:2000],
        "points": max(0, to_int(raw.get("points"), 0)),
        "badgeName": str(raw.get("badgeName") or "")[:40],
        "hardcore": bool(raw.get("hardcore")),
        "ts": ts,
    }


def clean_rows(raw):
    out = []
    if not isinstance(raw, list):
        return out
    for item in raw[:MAX_ROWS_PER_MONTH]:
        row = _clean_row(item)
        if row is not None:
            out.append(row)
    return out


class ActivityStore:
    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()

    def repoint(self, base_dir: Path) -> None:
        with self._lock:
            self._base_dir = base_dir

    def _path(self, month) -> Path:
        return self._base_dir / ("%s.json" % month)

    def load_month(self, month):
        if not is_month(month):
            return None
        with self._lock:
            path = self._path(month)
            raw = load_json_file(path, None)
            if not isinstance(raw, dict):
                return None
            if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
                report_newer_schema(path)
                return None
            if raw.get("month") != month or not isinstance(raw.get("rows"), list):
                return None
            return clean_rows(raw["rows"])

    def save_month(self, month, rows) -> bool:
        if not is_month(month):
            return False
        with self._lock:
            path = self._path(month)
            try:
                ensure_dir(self._base_dir)
                refuse_newer_file(path, CURRENT_SCHEMA_VERSION)
                save_json_file(path, {
                    "schemaVersion": CURRENT_SCHEMA_VERSION,
                    "month": month,
                    "rows": clean_rows(rows),
                }, compact=True)
            except (OSError, NewerSchemaFile):
                return False
            return True

    def saved_months(self):
        with self._lock:
            try:
                names = [p.stem for p in self._base_dir.iterdir() if p.suffix == ".json"]
            except OSError:
                return []
        return sorted(name for name in names if is_month(name))

    def prune(self, keep_months, protect_after) -> int:
        if not is_month(protect_after) or keep_months <= 0:
            return 0
        removed = 0
        with self._lock:
            try:
                current = this_month()
                months = sorted((p.stem for p in self._base_dir.iterdir()
                                 if p.suffix == ".json" and is_month(p.stem) and p.stem <= current), reverse=True)
            except OSError:
                return 0
            for month in months[keep_months:]:
                if month > protect_after:
                    continue
                try:
                    self._path(month).unlink()
                    removed += 1
                except OSError:
                    pass
        return removed

    def clear(self) -> int:
        removed = 0
        with self._lock:
            try:
                paths = [p for p in self._base_dir.iterdir() if p.suffix == ".json" and is_month(p.stem)]
            except OSError:
                return 0
            for path in paths:
                try:
                    path.unlink()
                    removed += 1
                except OSError:
                    pass
        return removed
