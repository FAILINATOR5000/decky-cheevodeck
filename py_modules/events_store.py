from pathlib import Path
from typing import Any, Optional

import threading
import time

from utils import (
    NOTE_STORED_MAX_LEN,
    TAG_PREFIX_PATTERN,
    clean_bulk_tag,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    norm_game_id,
    refuse_newer_file,
    refuses_newer_schema,
    report_newer_schema,
    save_json_file,
    to_int,
)


CURRENT_SCHEMA_VERSION = 1

NOTE_MAX_LEN = NOTE_STORED_MAX_LEN
_COLLAPSE_KEY_MAX_LEN = 64
_MAX_COLLAPSED_TAGS = 400

_NOTE_COLOR_OPTIONS = (
    "default", "green", "amber", "orange", "red", "pink", "purple",
    "blue", "sky", "cyan", "teal", "lime", "gray", "indigo",
    "rose", "fuchsia", "violet", "emerald", "yellow", "brown",
    "slate", "crimson", "mint", "coral", "gold", "steel",
)

UNTAGGED_COLLAPSE_KEY = "__UNTAGGED__"
COMPLETED_COLLAPSE_KEY = "__COMPLETED__"
_RESERVED_TAG_KEYS = frozenset({"completed"})

MAX_ACTIVITY = 400
MAX_CHECKLIST_VIEWS = 100

_SHOW_VALUES = {
    "all": ("all", "active", "evergreen", "ended", "completed"),
    "tracked": ("all", "active", "evergreen", "ended"),
}
_TYPE_VALUES = ("all", "automated", "checklist", "spreadsheet", "other", "unscanned")
_SORT_VALUES = {
    "all": ("latest", "activity", "name", "progress"),
    "tracked": ("manual", "latest", "activity", "name", "progress"),
}
_DEFAULT_SORT = {"all": "latest", "tracked": "manual"}
_LIST_VIEWS = ("all", "tracked")
_CHECKLIST_VIEWS = ("sections", "system", "systemYear")
_CHECKLIST_FILTERS = ("all", "todo", "ticked")
_TICK_LEVELS = ("beaten", "mastered")


def _is_tick_value(value: Any) -> bool:
    return isinstance(value, bool) or value in _TICK_LEVELS


def _now_ms() -> int:
    return int(time.time() * 1000)


def _event_key(value: Any) -> Optional[str]:
    game_id = norm_game_id(value)
    if game_id is None or game_id <= 0:
        return None
    return str(game_id)


def _clean_note(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:NOTE_MAX_LEN]


def _clean_color(value: Any) -> str:
    color = str(value or "").strip().lower()
    if color in _NOTE_COLOR_OPTIONS and color != "default":
        return color
    return ""


def collapse_key_for_note(note: Any) -> str:
    if not isinstance(note, str):
        return UNTAGGED_COLLAPSE_KEY
    match = TAG_PREFIX_PATTERN.match(note)
    if not match:
        return UNTAGGED_COLLAPSE_KEY
    key = match.group(1).strip().lower()
    if not key or key in _RESERVED_TAG_KEYS:
        return UNTAGGED_COLLAPSE_KEY
    return key


def _pick(value: Any, allowed, default: str) -> str:
    text = str(value or "").strip()
    return text if text in allowed else default


def _normalize_view_prefs(raw: Any, view: str) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "show": _pick(raw.get("show"), _SHOW_VALUES[view], "all"),
        "type": _pick(raw.get("type"), _TYPE_VALUES, "all"),
        "sort": _pick(raw.get("sort"), _SORT_VALUES[view], _DEFAULT_SORT[view]),
    }


def _normalize_prefs(raw: Any) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "all": _normalize_view_prefs(raw.get("all"), "all"),
        "tracked": _normalize_view_prefs(raw.get("tracked"), "tracked"),
        "listView": _pick(raw.get("listView"), _LIST_VIEWS, "all"),
    }


def _normalize_checklist_view(raw: Any) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "view": _pick(raw.get("view"), _CHECKLIST_VIEWS, "sections"),
        "filter": _pick(raw.get("filter"), _CHECKLIST_FILTERS, "all"),
    }


def _normalize_tracked_item(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    note = _clean_note(raw.get("note"))
    return {
        "trackedAt": to_int(raw.get("trackedAt"), 0),
        "note": note,
        "noteColor": _clean_color(raw.get("noteColor")) if note else "",
        "noteEditedAt": to_int(raw.get("noteEditedAt"), 0) if note else 0,
    }


def _normalize_progress(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    earned = to_int(raw.get("earned"), -1)
    total = to_int(raw.get("total"), -1)
    if earned < 0 or total < 0:
        return None
    points = raw.get("points")
    return {
        "earned": earned,
        "total": total,
        "points": to_int(points, 0) if points is not None else None,
        "checkedAt": to_int(raw.get("checkedAt"), 0),
    }


def _normalize_activity(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    return {
        "lastOpenedAt": to_int(raw.get("lastOpenedAt"), 0),
        "lastEarnedSeenAt": to_int(raw.get("lastEarnedSeenAt"), 0),
        "lastProgress": _normalize_progress(raw.get("lastProgress")),
    }


class EventsStore:
    def __init__(self, *, base_dir: Path, owner: str = ""):
        self._base_dir = base_dir
        self._owner = owner
        self._lock = threading.Lock()

    def repoint(self, base_dir: Path, owner: str) -> None:
        with self._lock:
            self._base_dir = base_dir
            self._owner = str(owner or "")
            ensure_dir(self._base_dir)

    def _path(self) -> Path:
        return self._base_dir / "events.json"

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "tracked": {"order": [], "collapsedTags": [], "items": {}},
            "prefs": _normalize_prefs(None),
            "completed": {},
            "checklistTicks": {},
            "checklistViews": {},
            "activity": {},
        }

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(self._path())
            return self._empty_file()
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return self._empty_file()

        data = self._empty_file()

        tracked = raw.get("tracked") if isinstance(raw.get("tracked"), dict) else {}
        items = {}
        raw_items = tracked.get("items") if isinstance(tracked.get("items"), dict) else {}
        for key, value in raw_items.items():
            event_key = _event_key(key)
            item = _normalize_tracked_item(value)
            if event_key is None or item is None or event_key in items:
                continue
            items[event_key] = item
        data["tracked"]["items"] = items
        data["tracked"]["order"] = self._reconcile_order(tracked.get("order"), items)
        data["tracked"]["collapsedTags"] = self._sanitize_collapsed(tracked.get("collapsedTags"), items)

        data["prefs"] = _normalize_prefs(raw.get("prefs"))

        completed = {}
        raw_completed = raw.get("completed") if isinstance(raw.get("completed"), dict) else {}
        for key, value in raw_completed.items():
            event_key = _event_key(key)
            if event_key is None or not isinstance(value, dict):
                continue
            completed[event_key] = {"at": to_int(value.get("at"), 0)}
        data["completed"] = completed

        ticks = {}
        raw_ticks = raw.get("checklistTicks") if isinstance(raw.get("checklistTicks"), dict) else {}
        for key, value in raw_ticks.items():
            event_key = _event_key(key)
            if event_key is None or not isinstance(value, dict):
                continue
            games = {}
            for game_key, flag in value.items():
                game_id = _event_key(game_key)
                if game_id is None or not _is_tick_value(flag):
                    continue
                games[game_id] = flag
            if games:
                ticks[event_key] = games
        data["checklistTicks"] = ticks

        views = {}
        raw_views = raw.get("checklistViews") if isinstance(raw.get("checklistViews"), dict) else {}
        for key, value in raw_views.items():
            event_key = _event_key(key)
            if event_key is None or not isinstance(value, dict):
                continue
            views[event_key] = _normalize_checklist_view(value)
            if len(views) >= MAX_CHECKLIST_VIEWS:
                break
        data["checklistViews"] = views

        activity = {}
        raw_activity = raw.get("activity") if isinstance(raw.get("activity"), dict) else {}
        for key, value in raw_activity.items():
            event_key = _event_key(key)
            entry = _normalize_activity(value)
            if event_key is None or entry is None:
                continue
            activity[event_key] = entry
        data["activity"] = self._trim_activity(activity)

        return data

    def _save_raw(self, data: dict) -> None:
        refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
        save_json_file(self._path(), data, compact=True)

    def _reconcile_order(self, raw_order: Any, items: dict) -> list:
        order = []
        seen = set()
        for value in raw_order if isinstance(raw_order, list) else []:
            key = _event_key(value)
            if key is None or key in seen or key not in items:
                continue
            seen.add(key)
            order.append(key)
        missing = [key for key in items if key not in seen]
        missing.sort(key=lambda key: items[key]["trackedAt"])
        return order + missing

    def _live_collapse_keys(self, items: dict) -> set:
        keys = {collapse_key_for_note(item["note"]) for item in items.values()}
        keys.add(UNTAGGED_COLLAPSE_KEY)
        keys.add(COMPLETED_COLLAPSE_KEY)
        return keys

    def _sanitize_collapsed(self, raw: Any, items: dict) -> list:
        if not isinstance(raw, list):
            return []
        live = self._live_collapse_keys(items)
        cleaned = []
        for entry in raw:
            if not isinstance(entry, str):
                continue
            key = entry.strip()
            if not key or len(key) > _COLLAPSE_KEY_MAX_LEN or key in cleaned or key not in live:
                continue
            cleaned.append(key)
            if len(cleaned) >= _MAX_COLLAPSED_TAGS:
                break
        return cleaned

    def _trim_activity(self, activity: dict) -> dict:
        if len(activity) <= MAX_ACTIVITY:
            return activity
        newest = sorted(activity, key=lambda key: activity[key]["lastOpenedAt"], reverse=True)
        return {key: activity[key] for key in newest[:MAX_ACTIVITY]}

    def _owner_matches(self, ulid: Any) -> bool:
        return str(ulid or "").strip() == self._owner

    def _public(self, data: dict) -> dict:
        return {
            "tracked": data["tracked"],
            "prefs": data["prefs"],
            "completed": data["completed"],
            "checklistTicks": data["checklistTicks"],
            "checklistViews": data["checklistViews"],
            "activity": data["activity"],
        }

    def load(self) -> dict:
        with self._lock:
            return self._public(self._load_raw())

    @refuses_newer_schema
    def set_tracked(self, ulid: Any, event_game_id: Any, tracked: bool) -> dict:
        key = _event_key(event_game_id)
        if key is None:
            return {"ok": False, "error": "invalid_event"}
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            items = data["tracked"]["items"]
            if tracked:
                if key not in items:
                    items[key] = {"trackedAt": _now_ms(), "note": "", "noteColor": "", "noteEditedAt": 0}
                    data["tracked"]["order"].append(key)
            else:
                items.pop(key, None)
                data["tracked"]["order"] = [k for k in data["tracked"]["order"] if k != key]
            data["tracked"]["collapsedTags"] = self._sanitize_collapsed(data["tracked"]["collapsedTags"], items)
            self._save_raw(data)
            return {"ok": True, "tracked": tracked, "state": data["tracked"]}

    @refuses_newer_schema
    def save_order(self, ulid: Any, order: Any) -> dict:
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            data["tracked"]["order"] = self._reconcile_order(order, data["tracked"]["items"])
            self._save_raw(data)
            return {"ok": True, "state": data["tracked"]}

    @refuses_newer_schema
    def save_note(self, ulid: Any, event_game_id: Any, note: Any, color: Any) -> dict:
        key = _event_key(event_game_id)
        if key is None:
            return {"ok": False, "error": "invalid_event"}
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            items = data["tracked"]["items"]
            item = items.get(key)
            if item is None:
                return {"ok": False, "error": "not_tracked"}
            text = _clean_note(note)
            item["note"] = text
            item["noteColor"] = _clean_color(color) if text else ""
            item["noteEditedAt"] = _now_ms() if text else 0
            data["tracked"]["collapsedTags"] = self._sanitize_collapsed(data["tracked"]["collapsedTags"], items)
            self._save_raw(data)
            return {"ok": True, "state": data["tracked"]}

    @refuses_newer_schema
    def bulk_tag(self, ulid: Any, event_game_ids: Any, tag: Any) -> dict:
        clean_tag = clean_bulk_tag(tag)
        if clean_tag is None:
            return {"ok": False, "error": "invalid_tag"}
        keys = []
        for value in event_game_ids if isinstance(event_game_ids, list) else []:
            key = _event_key(value)
            if key is not None and key not in keys:
                keys.append(key)
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            items = data["tracked"]["items"]
            stamp = _now_ms()
            for key in keys:
                item = items.get(key)
                if item is None:
                    continue
                body = TAG_PREFIX_PATTERN.sub("", item["note"])
                item["note"] = _clean_note("[%s]%s" % (clean_tag, body))
                item["noteEditedAt"] = stamp
            data["tracked"]["collapsedTags"] = self._sanitize_collapsed(data["tracked"]["collapsedTags"], items)
            self._save_raw(data)
            return {"ok": True, "state": data["tracked"]}

    @refuses_newer_schema
    def save_collapsed(self, ulid: Any, keys: Any) -> dict:
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            data["tracked"]["collapsedTags"] = self._sanitize_collapsed(keys, data["tracked"]["items"])
            self._save_raw(data)
            return {"ok": True, "state": data["tracked"]}

    @refuses_newer_schema
    def save_prefs(self, ulid: Any, prefs: Any) -> dict:
        prefs = prefs if isinstance(prefs, dict) else {}
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            merged = {
                "all": dict(data["prefs"]["all"]),
                "tracked": dict(data["prefs"]["tracked"]),
                "listView": prefs.get("listView", data["prefs"]["listView"]),
            }
            for view in ("all", "tracked"):
                if isinstance(prefs.get(view), dict):
                    merged[view].update(prefs[view])
            data["prefs"] = _normalize_prefs(merged)
            self._save_raw(data)
            return {"ok": True, "prefs": data["prefs"]}

    @refuses_newer_schema
    def set_completed(self, ulid: Any, event_game_id: Any, completed: Any) -> dict:
        key = _event_key(event_game_id)
        if key is None:
            return {"ok": False, "error": "invalid_event"}
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            marks = data["completed"]
            if completed:
                marks[key] = {"at": _now_ms()}
            elif key in marks:
                del marks[key]
                order = data["tracked"]["order"]
                if key in order:
                    order.remove(key)
                    order.append(key)
            self._save_raw(data)
            return {"ok": True, "completed": marks, "state": data["tracked"]}

    @refuses_newer_schema
    def set_checklist_tick(self, ulid: Any, event_game_id: Any, game_id: Any, value: Any) -> dict:
        key = _event_key(event_game_id)
        game_key = _event_key(game_id)
        if key is None or game_key is None:
            return {"ok": False, "error": "invalid_event"}
        if value is not None and not _is_tick_value(value):
            return {"ok": False, "error": "invalid_value"}
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            ticks = data["checklistTicks"]
            games = ticks.get(key, {})
            if value is None:
                games.pop(game_key, None)
            else:
                games[game_key] = value
            if games:
                ticks[key] = games
            else:
                ticks.pop(key, None)
            self._save_raw(data)
            return {"ok": True, "ticks": ticks.get(key, {})}

    @refuses_newer_schema
    def save_checklist_view(self, ulid: Any, event_game_id: Any, view: Any, filter_value: Any) -> dict:
        key = _event_key(event_game_id)
        if key is None:
            return {"ok": False, "error": "invalid_event"}
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            views = data["checklistViews"]
            if key not in views and len(views) >= MAX_CHECKLIST_VIEWS:
                del views[next(iter(views))]
            views.pop(key, None)
            views[key] = _normalize_checklist_view({"view": view, "filter": filter_value})
            self._save_raw(data)
            return {"ok": True, "view": views[key]}

    @refuses_newer_schema
    def touch_opened(self, ulid: Any, event_game_id: Any, progress: Any = None) -> dict:
        key = _event_key(event_game_id)
        if key is None:
            return {"ok": False, "error": "invalid_event"}
        now = _now_ms()
        with self._lock:
            if not self._owner_matches(ulid):
                return {"ok": False, "error": "account_changed"}
            data = self._load_raw()
            activity = data["activity"]
            entry = activity.get(key) or {"lastOpenedAt": 0, "lastEarnedSeenAt": 0, "lastProgress": None}
            entry["lastOpenedAt"] = now
            fresh = _normalize_progress(progress)
            if fresh is not None:
                previous = entry["lastProgress"]
                if previous is not None and fresh["earned"] > previous["earned"]:
                    entry["lastEarnedSeenAt"] = now
                fresh["checkedAt"] = now
                entry["lastProgress"] = fresh
            activity[key] = entry
            data["activity"] = self._trim_activity(activity)
            self._save_raw(data)
            return {"ok": True, "activity": entry}
