from pathlib import Path

import secrets
import threading
import time
import re

from settings_store import _NOTE_COLOR_OPTIONS
from utils import ensure_dir, load_json_file, norm_game_id, save_json_file, to_int


NOTE_TITLE_MAX_LEN = 80
NOTE_BODY_MAX_LEN = 500

NOTE_TAG_MAX_LEN = 24

TAG_VOCAB_LIMIT = 20

_ALLOWED_SORT_MODES = {"newest", "oldest", "manual"}
_ALLOWED_REMINDER_MODES = {"off", "once", "every"}

_ALLOWED_REMINDER_UNITS = {"minutes", "hours", "days"}

_RESERVED_TAG_KEYS = {"completed"}

REMINDER_MIN_MINUTES = 1
REMINDER_MAX_MINUTES = 60 * 24 * 365

_TAG_CLEAN_PATTERN = re.compile(r"[\[\]\n\r\t]")

CURRENT_SCHEMA_VERSION = 1


class NotesStore:
    """Per-game free-form notes, one JSON file per game.

    Storage layout: ``<notes_dir>/<gameid>.json``. Single file per game,
    all notes inside, plus the per-game top-level fields (sortMode,
    tagVocabulary, schemaVersion). Single-file-per-game keeps reorder
    writes atomic and gives the reminder service one read per tick.

    Threading: every public method that touches a game's file does so
    under that game's lock. The master lock guards the lock-dict itself
    and is only held long enough to look up or create an entry -- never
    held simultaneously with a per-game lock. This is the same shape as
    SettingsStore's tracked-file locking, lifted on purpose so anyone
    reading both files sees the same pattern.

    Why threading.Lock and not asyncio.Lock: the reminder service
    (phase 4) runs on its own OS thread, not on the event loop. We need
    a primitive that serializes across threads, not just within the
    event loop. RPC handlers calling in from the loop will block
    briefly on contention, but the read-modify-write here is microsecond-
    scale so the loop hitch is invisible.
    """

    def __init__(self, *, notes_dir: Path):
        self._notes_dir = notes_dir

        self._notes_master_lock = threading.Lock()
        self._notes_game_locks: dict[str, threading.Lock] = {}

    def repoint(self, notes_dir: Path) -> None:
        with self._notes_master_lock:
            self._notes_dir = notes_dir

    def _game_key(self, game_id) -> str | None:
        normalized = norm_game_id(game_id)
        if normalized is None:
            return None
        return str(normalized)

    def _path_for_game_key(self, key: str) -> Path:
        if not key or not key.isdigit():
            raise ValueError(f"invalid notes game key: {key!r}")
        return self._notes_dir / f"{key}.json"

    def _lock_for_game(self, key: str) -> threading.Lock:
        with self._notes_master_lock:
            lock = self._notes_game_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._notes_game_locks[key] = lock
            return lock

    def _load_raw(self, key: str) -> dict:
        path = self._path_for_game_key(key)
        raw = load_json_file(path, {})
        if not isinstance(raw, dict):
            return self._empty_entry(int(key))

        schema = to_int(raw.get("schemaVersion", 0), 0)
        if schema != CURRENT_SCHEMA_VERSION:
            return self._empty_entry(int(key))

        return self._normalize_entry(raw, int(key))

    def _save_raw(self, key: str, entry: dict) -> None:
        path = self._path_for_game_key(key)
        ensure_dir(self._notes_dir)
        save_json_file(path, entry, compact=True)

    def _empty_entry(self, game_id: int) -> dict:
        return {
            "gameId": game_id,
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "sortMode": "newest",
            "tagVocabulary": [],
            "notes": [],
        }

    def _clean_title(self, raw) -> str:
        if not isinstance(raw, str):
            return ""
        return raw.strip()[:NOTE_TITLE_MAX_LEN]

    def _clean_body(self, raw) -> str:
        if not isinstance(raw, str):
            return ""
        return raw.strip()[:NOTE_BODY_MAX_LEN]

    def _clean_tag(self, raw):
        if not isinstance(raw, str):
            return None
        cleaned = _TAG_CLEAN_PATTERN.sub("", raw).strip()[:NOTE_TAG_MAX_LEN]
        if not cleaned:
            return None
        if cleaned.lower() in _RESERVED_TAG_KEYS:
            return None
        return cleaned

    def _clean_color(self, raw) -> str:
        if raw in _NOTE_COLOR_OPTIONS:
            return raw
        return "default"

    def _clean_sort_mode(self, raw) -> str:
        if raw in _ALLOWED_SORT_MODES:
            return raw
        return "newest"

    def _clean_reminder(self, mode_raw, every_raw, value_raw, unit_raw):
        mode = mode_raw if mode_raw in _ALLOWED_REMINDER_MODES else "off"
        if mode == "off":
            return ("off", None, None, None)

        every = to_int(every_raw, 0)
        if every < REMINDER_MIN_MINUTES or every > REMINDER_MAX_MINUTES:
            return ("off", None, None, None)

        unit = unit_raw if unit_raw in _ALLOWED_REMINDER_UNITS else "minutes"
        value = to_int(value_raw, 0)
        if value <= 0 or unit == "minutes":
            value = every
            unit = "minutes"
        return (mode, every, value, unit)

    def _normalize_note(self, raw):
        if not isinstance(raw, dict):
            return None

        note_id = raw.get("id")
        if not isinstance(note_id, str) or not note_id:
            return None

        body = self._clean_body(raw.get("body"))
        if not body:
            return None

        reminder_mode, reminder_every, reminder_value, reminder_unit = self._clean_reminder(
            raw.get("reminderMode"),
            raw.get("reminderEveryMinutes"),
            raw.get("reminderEveryValue"),
            raw.get("reminderEveryUnit"),
        )

        created = to_int(raw.get("createdAt"), 0)
        updated = to_int(raw.get("updatedAt"), created)
        last_fired = raw.get("reminderLastFiredAt")
        if last_fired is not None:
            last_fired = to_int(last_fired, 0) or None

        completed_at = raw.get("completedAt")
        if completed_at is not None:
            completed_at = to_int(completed_at, 0) or None

        return {
            "id": note_id,
            "title": self._clean_title(raw.get("title")),
            "body": body,
            "tag": self._clean_tag(raw.get("tag")),
            "color": self._clean_color(raw.get("color")),
            "createdAt": created,
            "updatedAt": updated,
            "manualOrder": to_int(raw.get("manualOrder"), 0),
            "reminderMode": reminder_mode,
            "reminderEveryMinutes": reminder_every,
            "reminderEveryValue": reminder_value,
            "reminderEveryUnit": reminder_unit,
            "reminderLastFiredAt": last_fired,
            "completedAt": completed_at,
            "showFiredDot": bool(raw.get("showFiredDot", False)),
        }

    def _normalize_entry(self, raw: dict, game_id: int) -> dict:
        notes = []
        for raw_note in raw.get("notes", []) or []:
            cleaned = self._normalize_note(raw_note)
            if cleaned is not None:
                notes.append(cleaned)

        notes.sort(key=lambda n: n["manualOrder"])
        for index, note in enumerate(notes):
            note["manualOrder"] = index

        tag_vocab_raw = raw.get("tagVocabulary", []) or []
        seen = set()
        tag_vocab = []
        for tag_raw in tag_vocab_raw:
            cleaned = self._clean_tag(tag_raw)
            if cleaned is None:
                continue
            lower = cleaned.lower()
            if lower in seen:
                continue
            seen.add(lower)
            tag_vocab.append(cleaned)
            if len(tag_vocab) >= TAG_VOCAB_LIMIT:
                break

        return {
            "gameId": game_id,
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "sortMode": self._clean_sort_mode(raw.get("sortMode")),
            "tagVocabulary": tag_vocab,
            "notes": notes,
        }

    def _add_tag_to_vocab(self, entry: dict, tag) -> None:
        if tag is None:
            return
        lower = tag.lower()
        vocab = entry["tagVocabulary"]
        entry["tagVocabulary"] = [tag] + [t for t in vocab if t.lower() != lower]
        del entry["tagVocabulary"][TAG_VOCAB_LIMIT:]

    def _sorted_notes_for_return(self, entry: dict) -> list:
        notes = list(entry["notes"])
        mode = entry["sortMode"]
        if mode == "newest":
            notes.sort(key=lambda n: n["createdAt"], reverse=True)
        elif mode == "oldest":
            notes.sort(key=lambda n: n["createdAt"])
        else:
            notes.sort(key=lambda n: n["manualOrder"])
        return notes

    def _new_note_id(self) -> str:
        return f"note_{secrets.token_urlsafe(8)}"

    def load_notes_for_game(self, game_id) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return self._empty_entry(0)

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)

        response = dict(entry)
        response["notes"] = self._sorted_notes_for_return(entry)
        response["pendingReminderBadge"] = any(
            bool(n.get("showFiredDot")) for n in entry.get("notes", [])
        )
        return response

    def create_note(
        self,
        game_id,
        *,
        title: str = "",
        body: str = "",
        tag=None,
        color: str = "default",
        reminder_mode: str = "off",
        reminder_every_minutes=None,
        reminder_every_value=None,
        reminder_every_unit=None,
    ) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}

        clean_body = self._clean_body(body)
        if not clean_body:
            return {"ok": False, "error": "empty_body"}

        clean_title = self._clean_title(title)
        clean_tag = self._clean_tag(tag)
        clean_color = self._clean_color(color)
        mode, every, every_value, every_unit = self._clean_reminder(
            reminder_mode,
            reminder_every_minutes,
            reminder_every_value,
            reminder_every_unit,
        )

        now = int(time.time())
        new_note = {
            "id": self._new_note_id(),
            "title": clean_title,
            "body": clean_body,
            "tag": clean_tag,
            "color": clean_color,
            "createdAt": now,
            "updatedAt": now,
            "manualOrder": 0,
            "reminderMode": mode,
            "reminderEveryMinutes": every,
            "reminderEveryValue": every_value,
            "reminderEveryUnit": every_unit,
            "reminderLastFiredAt": now if mode != "off" else None,
            "completedAt": None,
        }

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            for existing in entry["notes"]:
                existing["manualOrder"] += 1
            entry["notes"].insert(0, new_note)
            self._add_tag_to_vocab(entry, clean_tag)
            self._save_raw(key, entry)

        return {"ok": True, "note": new_note}

    def update_note(
        self,
        game_id,
        note_id: str,
        *,
        title: str = "",
        body: str = "",
        tag=None,
        color: str = "default",
        reminder_mode: str = "off",
        reminder_every_minutes=None,
        reminder_every_value=None,
        reminder_every_unit=None,
        reset_reminder_timer: bool = False,
    ) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(note_id, str) or not note_id:
            return {"ok": False, "error": "invalid_note_id"}

        clean_body = self._clean_body(body)
        if not clean_body:
            return self.delete_note(game_id, note_id)

        clean_title = self._clean_title(title)
        clean_tag = self._clean_tag(tag)
        clean_color = self._clean_color(color)
        mode, every, every_value, every_unit = self._clean_reminder(
            reminder_mode,
            reminder_every_minutes,
            reminder_every_value,
            reminder_every_unit,
        )

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            target = None
            for note in entry["notes"]:
                if note["id"] == note_id:
                    target = note
                    break
            if target is None:
                return {"ok": False, "error": "not_found"}

            now = int(time.time())
            was_on = target["reminderMode"] != "off"
            will_be_on = mode != "off"

            target["title"] = clean_title
            target["body"] = clean_body
            target["tag"] = clean_tag
            target["color"] = clean_color
            target["reminderMode"] = mode
            target["reminderEveryMinutes"] = every
            target["reminderEveryValue"] = every_value
            target["reminderEveryUnit"] = every_unit
            target["updatedAt"] = now

            if not will_be_on:
                target["reminderLastFiredAt"] = None
            elif not was_on:
                target["reminderLastFiredAt"] = now
            elif reset_reminder_timer:
                target["reminderLastFiredAt"] = now

            self._add_tag_to_vocab(entry, clean_tag)
            self._save_raw(key, entry)

        return {"ok": True, "note": target}

    def delete_note(self, game_id, note_id: str) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(note_id, str) or not note_id:
            return {"ok": False, "error": "invalid_note_id"}

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            before = len(entry["notes"])
            entry["notes"] = [n for n in entry["notes"] if n["id"] != note_id]
            if len(entry["notes"]) == before:
                return {"ok": False, "error": "not_found"}

            for index, note in enumerate(entry["notes"]):
                note["manualOrder"] = index

            self._save_raw(key, entry)

        return {"ok": True, "deletedId": note_id}

    def reorder_notes(self, game_id, ordered_ids) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(ordered_ids, (list, tuple)):
            return {"ok": False, "error": "invalid_order"}

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            by_id = {note["id"]: note for note in entry["notes"]}

            new_order = []
            seen = set()
            for note_id in ordered_ids:
                if not isinstance(note_id, str):
                    continue
                if note_id in seen:
                    continue
                note = by_id.get(note_id)
                if note is None:
                    continue
                seen.add(note_id)
                new_order.append(note)

            leftovers = [n for n in entry["notes"] if n["id"] not in seen]
            leftovers.sort(key=lambda n: n["manualOrder"])
            new_order.extend(leftovers)

            for index, note in enumerate(new_order):
                note["manualOrder"] = index
            entry["notes"] = new_order

            self._save_raw(key, entry)

        return {"ok": True}

    def set_sort_mode(self, game_id, mode: str) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}

        cleaned = self._clean_sort_mode(mode)
        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            entry["sortMode"] = cleaned
            self._save_raw(key, entry)

        return {"ok": True, "sortMode": cleaned}

    def stamp_reminder_fired(self, game_id, note_id: str, now_ts=None) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(note_id, str) or not note_id:
            return {"ok": False, "error": "invalid_note_id"}

        if now_ts is None:
            now = int(time.time())
        else:
            now = to_int(now_ts, int(time.time()))

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            target = None
            for note in entry["notes"]:
                if note["id"] == note_id:
                    target = note
                    break
            if target is None:
                return {"ok": False, "error": "not_found"}

            target["reminderLastFiredAt"] = now
            target["showFiredDot"] = True
            if target["reminderMode"] == "once":
                target["reminderMode"] = "off"
                target["reminderEveryMinutes"] = None

            self._save_raw(key, entry)

        return {"ok": True, "note": target}

    def set_show_fired_dot(self, game_id, note_id: str, value: bool) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(note_id, str) or not note_id:
            return {"ok": False, "error": "invalid_note_id"}

        flag = bool(value)
        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            target = None
            for note in entry["notes"]:
                if note["id"] == note_id:
                    target = note
                    break
            if target is None:
                return {"ok": False, "error": "not_found"}

            target["showFiredDot"] = flag
            self._save_raw(key, entry)

        return {"ok": True, "note": target}

    def mark_note_completed(self, game_id, note_id: str, completed: bool) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(note_id, str) or not note_id:
            return {"ok": False, "error": "invalid_note_id"}

        flag = bool(completed)
        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            target = None
            for note in entry["notes"]:
                if note["id"] == note_id:
                    target = note
                    break
            if target is None:
                return {"ok": False, "error": "not_found"}

            now = int(time.time())
            if flag:
                target["completedAt"] = now
                target["showFiredDot"] = False
            else:
                target["completedAt"] = None
                if target["reminderMode"] != "off":
                    target["reminderLastFiredAt"] = now

            self._save_raw(key, entry)

        return {"ok": True, "note": target}

    def delete_all_notes(self) -> dict:
        with self._notes_master_lock:
            deleted_notes = 0
            for path in self._notes_dir.glob("*.json"):
                raw = load_json_file(path, {})
                if isinstance(raw, dict):
                    notes = raw.get("notes")
                    if isinstance(notes, list):
                        deleted_notes += len(notes)
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass

            self._notes_game_locks.clear()

        return {"ok": True, "deletedNotes": deleted_notes}
