from pathlib import Path

import asyncio
import threading
import time
from collections import deque

import decky

from utils import ensure_dir, load_json_file, save_json_file, to_int


NOTIFICATION_EVENT = "cheevodeck_notification"

NOTIFICATIONS_FILENAME = "notifications.json"

NOTIFICATIONS_ARCHIVE_FILENAME = "notifications_archive.json"

MAX_ARCHIVED_NOTIFICATIONS = 2000

MAX_NOTIFICATIONS = 500

CURRENT_SCHEMA_VERSION = 1


NOTIFICATION_TYPES = {
    "noteReminder":   {"enabled_key": "notifyNoteReminderEnabled",   "enabled_default": True,
                       "toast_key":   "notifyNoteReminderToast",     "toast_default":   True,   "advanced": False},
    "trackedSet":     {"enabled_key": "notifyTrackedSetEnabled",     "enabled_default": True,
                       "toast_key":   "notifyTrackedSetToast",       "toast_default":   True,   "advanced": False},
    "commentTracker": {"enabled_key": "notifyCommentTrackerEnabled", "enabled_default": True,
                       "toast_key":   "notifyCommentTrackerToast",   "toast_default":   True,   "advanced": False},
    "wall":           {"enabled_key": "notifyWallEnabled",           "enabled_default": True,
                       "toast_key":   "notifyWallToast",             "toast_default":   True,   "advanced": False},
    "system":         {"enabled_key": "notifySystemEnabled",         "enabled_default": True,
                       "toast_key":   "notifySystemToast",           "toast_default":   True,   "advanced": False},
    "tracked":        {"enabled_key": "notifyTrackedEnabled",        "enabled_default": False,
                       "toast_key":   "notifyTrackedToast",          "toast_default":   False,  "advanced": False},
    "social":         {"enabled_key": "notifySocialUnlockEnabled",   "enabled_default": False,
                       "toast_key":   "notifySocialUnlockToast",     "toast_default":   False,  "advanced": False},
    "nearYou":        {"enabled_key": "notifyNearYouEnabled",        "enabled_default": False,
                       "toast_key":   "notifyNearYouToast",          "toast_default":   False,  "advanced": False},
    "debug":          {"enabled_key": "notifyDebugEnabled",          "enabled_default": False,
                       "toast_key":   "notifyDebugToast",            "toast_default":   False,  "advanced": True},
}


def is_type_enabled(ntype: str, settings_store, cfg=None) -> bool:
    spec = NOTIFICATION_TYPES.get(ntype)
    if spec is None:
        return False
    try:
        if cfg is None:
            cfg = settings_store.load_config()
        return bool(cfg.get(spec["enabled_key"], spec["enabled_default"]))
    except Exception:
        return False


def is_type_toast(ntype: str, settings_store, cfg=None) -> bool:
    spec = NOTIFICATION_TYPES.get(ntype)
    if spec is None:
        return False
    try:
        if cfg is None:
            cfg = settings_store.load_config()
        return bool(cfg.get(spec["toast_key"], spec["toast_default"]))
    except Exception:
        return False


def emit_notification(
    *,
    ntype: str,
    settings_store,
    event_loop,
    title_key=None,
    line_key=None,
    template_vars=None,
    toast_title=None,
    toast_line=None,
    force_toast=False,
) -> None:
    spec = NOTIFICATION_TYPES.get(ntype)
    if spec is None or event_loop is None:
        return
    try:
        cfg = settings_store.load_config()
        show_toast = force_toast or bool(cfg.get(spec["toast_key"], spec["toast_default"]))
    except Exception:
        if not force_toast:
            return
        cfg = {}
        show_toast = True

    if (
        not force_toast
        and cfg.get("doNotDisturb", False)
        and cfg.get("doNotDisturbDisablesToast", True)
        and ntype != "noteReminder"
    ):
        show_toast = False

    payload = {"type": ntype, "toast": show_toast}
    if title_key is not None:
        payload["titleKey"] = title_key
    if line_key is not None:
        payload["lineKey"] = line_key
    if template_vars:
        payload["vars"] = template_vars
    if toast_title is not None:
        payload["title"] = toast_title
    if toast_line is not None:
        payload["body"] = toast_line
    try:
        asyncio.run_coroutine_threadsafe(
            decky.emit(NOTIFICATION_EVENT, payload),
            event_loop,
        )
    except Exception as exc:
        decky.logger.warning(
            "notifications: event emit failed: %s (%s)",
            type(exc).__name__,
            exc,
        )


def push_debug_notification(*, store, settings_store, event_loop, title, body, toast_body=None):
    try:
        cfg = settings_store.load_config()
    except Exception:
        return

    row_enabled = is_type_enabled("debug", settings_store, cfg)
    toast_enabled = is_type_toast("debug", settings_store, cfg)
    if not row_enabled and not toast_enabled:
        return

    if store is not None and row_enabled:
        store.append({
            "type": "debug",
            "kind": "info",
            "iconSource": "none",
            "title": title,
            "body": body,
            "source": "notifications",
        })
    emit_notification(
        ntype="debug",
        toast_title=title,
        toast_line=toast_body if toast_body is not None else body,
        settings_store=settings_store,
        event_loop=event_loop,
    )


class NotificationsStore:
    """The notification list and a single last-seen timestamp.

    Passive on purpose: no tick loop, no RA calls, no _ra_semaphore. The
    things that detect events are the services (the reminder service to
    start with); they append from their own OS threads and the store just
    records. The frontend reads a snapshot when the modal opens and bumps
    last-seen when it closes.

    Threading: one lock guards the in-memory deque, the last-seen value,
    and the on-disk write together. threading.Lock (not asyncio.Lock) for
    the same reason the notes and tracked-sets stores use one -- appends
    arrive from producer threads while reads come off the asyncio side,
    and we want them to serialize cleanly against each other.

    Why in-memory and not load-modify-save per call like the other stores:
    appends are frequent and tiny, and re-reading the whole file on every
    one would be wasteful. We hold the list in a deque, persist on each
    mutation, and load once at construction (before any producer thread is
    running, so that load is single-threaded).
    """

    def __init__(self, *, base_dir: Path):
        self._path = base_dir / NOTIFICATIONS_FILENAME
        self._lock = threading.Lock()
        self._items = deque(maxlen=MAX_NOTIFICATIONS)
        self._last_seen = 0
        self._counter = 0
        self._load_from_disk()

    def repoint(self, base_dir: Path) -> None:
        with self._lock:
            self._path = base_dir / NOTIFICATIONS_FILENAME
            ensure_dir(self._path.parent)
            self._items = deque(maxlen=MAX_NOTIFICATIONS)
            self._last_seen = 0
            self._counter = 0
            self._load_from_disk()

    def get_payload(self) -> dict:
        with self._lock:
            items = list(self._items)
            last_seen = self._last_seen
        items.reverse()
        return {"notifications": items, "lastSeenAt": last_seen}

    def append(self, notification: dict) -> dict:
        with self._lock:
            self._counter += 1
            notification = dict(notification)
            notification["id"] = "n%08d" % self._counter
            notification.setdefault("createdAt", int(time.time()))

            self._items.append(notification)
            self._persist_locked()
            return dict(notification)

    def mark_seen(self) -> int:
        with self._lock:
            now = int(time.time())
            newest = self._items[-1]["createdAt"] if self._items else 0
            self._last_seen = max(self._last_seen, now, newest)
            self._persist_locked()
            return self._last_seen

    def clear_all(self) -> None:
        with self._lock:
            self._items.clear()
            self._last_seen = int(time.time())
            self._persist_locked()

    def _persist_locked(self) -> None:
        data = {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "notifications": list(self._items),
            "lastSeenAt": self._last_seen,
            "counter": self._counter,
        }
        try:
            save_json_file(self._path, data, compact=True)
        except Exception as exc:
            decky.logger.warning(
                "notifications: persist failed: %s (%s)",
                type(exc).__name__,
                exc,
            )

    def _load_from_disk(self) -> None:
        raw = load_json_file(self._path, {})
        if not isinstance(raw, dict):
            return
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return

        stored = raw.get("notifications", [])
        if isinstance(stored, list):
            clean = [item for item in stored if isinstance(item, dict)]
            self._items = deque(clean, maxlen=MAX_NOTIFICATIONS)

        self._last_seen = to_int(raw.get("lastSeenAt", 0), 0)

        self._counter = to_int(raw.get("counter", 0), 0)
        highest = 0
        for item in self._items:
            raw_id = str(item.get("id") or "")
            if raw_id.startswith("n") and raw_id[1:].isdigit():
                highest = max(highest, int(raw_id[1:]))
        self._counter = max(self._counter, highest)


class NotificationsArchiveStore:
    """The per-account archive of starred notifications.

    Sibling to NotificationsStore, kept as its own store because the two have
    opposite retention rules: the notifications list rotates (a deque that
    drops the oldest past 500), while the archive is a user-curated keep-pile
    that never drops on its own and is capped by refusal instead (2000).

    Each archived record is a full standalone copy of the notification the
    user starred, plus an `archivedAt` stamp — a copy, not a reference, so it
    survives the original aging out of the rotating list. The frontend hands
    us the whole notification dict on archive; we don't reach back into the
    notifications deque to find it, so an item can be kept even if it's on the
    verge of dropping out of the main list.

    Threading mirrors NotificationsStore: one threading.Lock guards the list
    and the on-disk write, since archive/unarchive calls arrive off the
    asyncio side while the file write happens under the same lock.
    """

    def __init__(self, *, base_dir: Path):
        self._path = base_dir / NOTIFICATIONS_ARCHIVE_FILENAME
        self._lock = threading.Lock()
        self._items = []
        self._load_from_disk()

    def repoint(self, base_dir: Path) -> None:
        with self._lock:
            self._path = base_dir / NOTIFICATIONS_ARCHIVE_FILENAME
            ensure_dir(self._path.parent)
            self._items = []
            self._load_from_disk()

    def get_payload(self) -> dict:
        with self._lock:
            return {"archived": list(self._items)}

    def archive(self, notification: dict) -> dict:
        if not isinstance(notification, dict):
            return {"ok": False, "error": "invalid"}
        notif_id = str(notification.get("id") or "").strip()
        if not notif_id:
            return {"ok": False, "error": "invalid"}

        with self._lock:
            for existing in self._items:
                if str(existing.get("id")) == notif_id:
                    return {"ok": True, "archived": dict(existing)}
            if len(self._items) >= MAX_ARCHIVED_NOTIFICATIONS:
                return {"ok": False, "error": "archive_full"}

            record = dict(notification)
            record["id"] = notif_id
            record["archivedAt"] = int(time.time())
            self._items.append(record)
            self._persist_locked()
            return {"ok": True, "archived": dict(record)}

    def unarchive(self, notification_id: str) -> dict:
        notif_id = str(notification_id or "").strip()
        if not notif_id:
            return {"ok": False, "error": "invalid"}
        with self._lock:
            before = len(self._items)
            self._items = [item for item in self._items if str(item.get("id")) != notif_id]
            if len(self._items) != before:
                self._persist_locked()
            return {"ok": True}

    def clear(self) -> None:
        with self._lock:
            self._items = []
            self._persist_locked()

    def _persist_locked(self) -> None:
        data = {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "archived": list(self._items),
        }
        try:
            save_json_file(self._path, data, compact=True)
        except Exception as exc:
            decky.logger.warning(
                "notifications archive: persist failed: %s (%s)",
                type(exc).__name__,
                exc,
            )

    def _load_from_disk(self) -> None:
        raw = load_json_file(self._path, {})
        if not isinstance(raw, dict):
            return
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return
        stored = raw.get("archived", [])
        if isinstance(stored, list):
            clean = [
                item for item in stored
                if isinstance(item, dict) and str(item.get("id") or "").strip()
            ]
            self._items = clean[:MAX_ARCHIVED_NOTIFICATIONS]
