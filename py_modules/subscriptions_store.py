from pathlib import Path
from typing import Any, Optional

import threading
import time

import decky

from utils import ensure_dir, load_json_file, norm_game_id, save_json_file, to_int


MAX_SUBSCRIPTIONS = 10

_ALLOWED_KINDS = {"game", "achievement"}

CURRENT_SCHEMA_VERSION = 1


def section_key(kind: Any, target_id: Any) -> str:
    """Stable identifier for one followed thread, ``"<kind>:<id>"``.

    Defined here so the store, the Comments Service baselines, and the
    frontend's isSubscribed check all derive the key the same way -- if
    the shape ever changes there's one place to change it. The id goes
    through norm_game_id first so "12345" and 12345 collapse to the same
    key (RA hands ids back as strings in some payloads, ints in others).
    """
    normalized = norm_game_id(target_id)
    return "{}:{}".format(kind, normalized)


def _clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


class SubscriptionsStore:
    """The handful of comment threads the user has chosen to follow.

    Storage layout: one user-level file, ``<base_dir>/subscriptions.json``,
    holding a flat list of at most MAX_SUBSCRIPTIONS entries. Metadata
    only -- each entry carries enough to render its card and navigate
    into the thread without an RA hit (title, parent game, console, an
    icon url), so the Subscribed Discussions tab paints straight off
    disk. The icons themselves come from the existing image cache keyed
    on the url, same as tracked sets.

    Threading: one master lock guards the whole read-modify-write, same
    threading.Lock (not asyncio.Lock) reasoning as the tracked sets
    store -- the RPC handlers and the Comments Service can come from
    different threads and we want them to serialize cleanly. The list is
    tiny, so holding the lock across a load/save is never a problem.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        self._last_read_degraded = False
        ensure_dir(self._base_dir)

    def repoint(self, base_dir: Path) -> None:
        with self._lock:
            self._base_dir = base_dir
            ensure_dir(self._base_dir)

    def base_dir(self) -> Path:
        with self._lock:
            return self._base_dir

    def _path(self) -> Path:
        return self._base_dir / "subscriptions.json"

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "subscriptions": [],
        }

    def _load_raw(self) -> dict:
        present = self._path().exists()
        self._last_read_degraded = False

        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            self._last_read_degraded = present
            return self._empty_file()

        schema = to_int(raw.get("schemaVersion", 0), 0)
        if schema != CURRENT_SCHEMA_VERSION:
            self._last_read_degraded = present
            return self._empty_file()

        entries = raw.get("subscriptions")
        if not isinstance(entries, list):
            self._last_read_degraded = present
            return self._empty_file()

        cleaned = []
        for item in entries:
            normalized = self._normalize_entry(item)
            if normalized is not None:
                cleaned.append(normalized)

        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "subscriptions": cleaned,
        }

    def _save_raw(self, data: dict) -> None:
        save_json_file(self._path(), data, compact=True)

    def _normalize_entry(self, raw: Any) -> Optional[dict]:
        if not isinstance(raw, dict):
            return None

        kind = raw.get("kind")
        if kind not in _ALLOWED_KINDS:
            return None

        target_id = norm_game_id(raw.get("id"))
        if target_id is None:
            return None

        game_id = norm_game_id(raw.get("gameId"))
        if game_id is None:
            game_id = target_id

        return {
            "key": section_key(kind, target_id),
            "kind": kind,
            "id": target_id,
            "gameId": game_id,
            "title": _clean_text(raw.get("title")),
            "gameTitle": _clean_text(raw.get("gameTitle")),
            "console": _clean_text(raw.get("console")),
            "iconUrl": _clean_text(raw.get("iconUrl")),
            "badgeName": _clean_text(raw.get("badgeName")),
            "addedAt": to_int(raw.get("addedAt", 0), 0),
        }

    def _find(self, data: dict, key: str) -> Optional[dict]:
        for entry in data["subscriptions"]:
            if entry["key"] == key:
                return entry
        return None

    def list_all(self) -> dict:
        with self._lock:
            data = self._load_raw()
            degraded = self._last_read_degraded
        data["subscriptions"].sort(key=lambda entry: entry["addedAt"])
        data["degraded"] = degraded
        return data

    def add(self, entry: Any) -> dict:
        normalized = self._normalize_entry(entry)
        if normalized is None:
            return {"ok": False, "error": "invalid_entry"}

        with self._lock:
            data = self._load_raw()
            if self._last_read_degraded:
                decky.logger.warning(
                    "subscriptions: refusing to add %s over an unreadable file",
                    normalized["key"],
                )
                return {"ok": False, "error": "unreadable"}
            existing = self._find(data, normalized["key"])
            if existing is not None:
                return {"ok": True, "subscription": existing, "alreadySubscribed": True}

            if len(data["subscriptions"]) >= MAX_SUBSCRIPTIONS:
                return {"ok": False, "error": "at_capacity"}

            normalized["addedAt"] = int(time.time())
            data["subscriptions"].append(normalized)
            self._save_raw(data)

        return {"ok": True, "subscription": normalized}

    def remove(self, kind: Any, target_id: Any) -> dict:
        key = section_key(kind, target_id)
        with self._lock:
            data = self._load_raw()
            before = len(data["subscriptions"])
            data["subscriptions"] = [
                entry for entry in data["subscriptions"] if entry["key"] != key
            ]
            if len(data["subscriptions"]) == before:
                return {"ok": False, "error": "not_found"}
            self._save_raw(data)

        return {"ok": True, "key": key}
