from pathlib import Path
from typing import Any, Optional

import hashlib
import threading
import time

from utils import ensure_dir, load_json_file, norm_game_id, save_json_file, to_int


MAX_SAVED_COMMENTS = 500

_ALLOWED_KINDS = {"game", "achievement", "userWall"}

CURRENT_SCHEMA_VERSION = 1

_TEXT_HASH_LEN = 16


def _clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _source_id_for(kind: str, source: dict) -> Optional[str]:
    if kind == "game":
        game_id = norm_game_id(source.get("gameId"))
        return None if game_id is None else str(game_id)
    if kind == "achievement":
        ach_id = norm_game_id(source.get("achievementId"))
        return None if ach_id is None else str(ach_id)
    if kind == "userWall":
        wall_user = _clean_text(source.get("wallUser"))
        return wall_user or None
    return None


def saved_comment_id(kind: str, source_id: str, ulid: Any, submitted: Any, comment_text: Any) -> str:
    """Stable identifier for one saved comment.

    Defined here so the store owns the one authoritative derivation and the
    frontend can mirror it to answer "is this already saved?" against its
    in-memory id set without a round-trip. RA hands back no comment id, so we
    synthesize one from the parts that make a comment unique: which surface
    (kind + source_id), who posted (ulid), when (submitted), and a digest of
    the text to separate a genuine different-content double-post at the same
    second while still collapsing an identical re-save.
    """
    text = comment_text if isinstance(comment_text, str) else ""
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:_TEXT_HASH_LEN]
    ulid_part = _clean_text(ulid)
    submitted_part = _clean_text(submitted)
    return "{}:{}:{}:{}:{}".format(kind, source_id, ulid_part, submitted_part, digest)


class SavedCommentsStore:
    """The comments the user has starred to keep.

    Storage layout: one user-level file, ``<base_dir>/saved_comments.json``,
    holding a flat list of at most MAX_SAVED_COMMENTS snapshots. Each row is a
    self-contained snapshot — the four RA comment fields plus the source
    context (which game / achievement / wall it came from, with icon urls) —
    so the Saved Comments tab rebuilds every card straight off disk with no RA
    call. The avatar and the banner icon resolve lazily off the shared image
    cache keyed on username / url, same as every other comment surface.

    Threading: one master lock guards the whole read-modify-write, same
    threading.Lock (not asyncio.Lock) reasoning as the subscriptions store —
    the RPC handlers can come from different threads and we want them to
    serialize cleanly. The list is small, so holding the lock across a
    load/save is never a problem.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def repoint(self, base_dir: Path) -> None:
        with self._lock:
            self._base_dir = base_dir
            ensure_dir(self._base_dir)

    def _path(self) -> Path:
        return self._base_dir / "saved_comments.json"

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "comments": [],
        }

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()

        schema = to_int(raw.get("schemaVersion", 0), 0)
        if schema != CURRENT_SCHEMA_VERSION:
            return self._empty_file()

        entries = raw.get("comments")
        if not isinstance(entries, list):
            return self._empty_file()

        cleaned = []
        seen_ids = set()
        for item in entries:
            normalized = self._normalize_entry(item)
            if normalized is None:
                continue
            if normalized["id"] in seen_ids:
                continue
            seen_ids.add(normalized["id"])
            cleaned.append(normalized)

        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "comments": cleaned,
        }

    def _save_raw(self, data: dict) -> None:
        save_json_file(self._path(), data, compact=True)

    def _normalize_source(self, raw: Any) -> Optional[dict]:
        if not isinstance(raw, dict):
            return None

        kind = raw.get("kind")
        if kind not in _ALLOWED_KINDS:
            return None

        source_id = _source_id_for(kind, raw)
        if source_id is None:
            return None

        game_id = norm_game_id(raw.get("gameId"))
        ach_id = norm_game_id(raw.get("achievementId"))

        return {
            "kind": kind,
            "sourceId": source_id,
            "gameId": game_id,
            "gameTitle": _clean_text(raw.get("gameTitle")),
            "gameImageIcon": _clean_text(raw.get("gameImageIcon")),
            "achievementId": ach_id,
            "achievementTitle": _clean_text(raw.get("achievementTitle")),
            "achievementImageIcon": _clean_text(raw.get("achievementImageIcon")),
            "achievementBadgeName": _clean_text(raw.get("achievementBadgeName")),
            "wallUser": _clean_text(raw.get("wallUser")),
        }

    def _normalize_entry(self, raw: Any) -> Optional[dict]:
        if not isinstance(raw, dict):
            return None

        source = self._normalize_source(raw.get("source"))
        if source is None:
            return None

        comment_text = _clean_text(raw.get("commentText"))
        if not comment_text:
            return None

        user = _clean_text(raw.get("user"))
        ulid = _clean_text(raw.get("ulid"))
        submitted = _clean_text(raw.get("submitted"))

        entry_id = saved_comment_id(
            source["kind"], source["sourceId"], ulid, submitted, comment_text
        )

        return {
            "id": entry_id,
            "user": user,
            "ulid": ulid,
            "submitted": submitted,
            "commentText": comment_text,
            "source": source,
            "savedAt": to_int(raw.get("savedAt", 0), 0),
            "openedAt": to_int(raw.get("openedAt", 0), 0),
        }

    def _find(self, data: dict, entry_id: str) -> Optional[dict]:
        for entry in data["comments"]:
            if entry["id"] == entry_id:
                return entry
        return None

    def _match_key(self, entry: dict) -> str:
        source = entry["source"]
        return "{}:{}:{}:{}".format(
            source["kind"], source["sourceId"], entry["ulid"], entry["submitted"]
        )

    def list_all(self) -> dict:
        with self._lock:
            data = self._load_raw()
        data["comments"].sort(key=lambda entry: entry["savedAt"], reverse=True)
        return data

    def list_keys(self) -> dict:
        with self._lock:
            data = self._load_raw()
        return {
            "keys": [
                {"id": entry["id"], "matchKey": self._match_key(entry)}
                for entry in data["comments"]
            ]
        }

    def add(self, record: Any) -> dict:
        normalized = self._normalize_entry(record)
        if normalized is None:
            return {"ok": False, "error": "invalid_record"}

        with self._lock:
            data = self._load_raw()
            existing = self._find(data, normalized["id"])
            if existing is not None:
                return {"ok": True, "record": existing, "alreadySaved": True}

            if len(data["comments"]) >= MAX_SAVED_COMMENTS:
                return {"ok": False, "error": "saved_full"}

            normalized["savedAt"] = int(time.time())
            data["comments"].append(normalized)
            self._save_raw(data)

        return {"ok": True, "record": normalized}

    def remove(self, comment_id: Any) -> dict:
        entry_id = _clean_text(comment_id)
        if not entry_id:
            return {"ok": False, "error": "not_found"}

        with self._lock:
            data = self._load_raw()
            before = len(data["comments"])
            data["comments"] = [
                entry for entry in data["comments"] if entry["id"] != entry_id
            ]
            if len(data["comments"]) == before:
                return {"ok": False, "error": "not_found"}
            self._save_raw(data)

        return {"ok": True, "id": entry_id}

    def touch_opened(self, comment_id: Any) -> dict:
        entry_id = _clean_text(comment_id)
        if not entry_id:
            return {"ok": False, "error": "not_found"}

        with self._lock:
            data = self._load_raw()
            entry = self._find(data, entry_id)
            if entry is None:
                return {"ok": False, "error": "not_found"}
            entry["openedAt"] = int(time.time())
            self._save_raw(data)

        return {"ok": True, "id": entry_id}

    def clear(self) -> dict:
        with self._lock:
            self._save_raw(self._empty_file())
        return {"ok": True}
