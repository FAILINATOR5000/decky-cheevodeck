import contextlib
import re
import threading
import time

import decky

from services._tick_common import GenerationFence
from notifications import emit_notification, is_type_enabled


REMINDER_TICK_SECONDS = 30

REMINDER_STARTUP_DELAY_SECONDS = 5.0

REMINDER_TOAST_BODY_MAX_LEN = 100

_LEADING_TAG_PATTERN = re.compile(r"^\s*\[[^\]\n]{1,24}\]\s*")


_generation_fence = GenerationFence()


class NotesReminderService:
    """Background daemon that surfaces note reminders for the current game.

    One tick every REMINDER_TICK_SECONDS:
      1. Read the current game id from the cache_store payload.
      2. Load that game's notes file.
      3. For every note with a non-off reminder that's due, append it
         to the per-game unacked dict and stamp last-fired on disk.

    Reminders sit in an in-memory dict, keyed by game id, until the
    frontend calls get_pending_reminders() and then ack_reminders().
    Peek + ack semantics mean a panel that crashes mid-display gets
    to re-read the same reminder on the next open instead of losing
    it forever.

    Sleep-from-Deck robustness: when reminderLastFiredAt is way in
    the past (Deck slept for hours), we fire exactly once and stamp
    last-fired to now, not to "last + interval". The next firing is
    one full interval after the wake-up, which is what we want -- no
    burst of catch-up reminders.

    Threading: the tick runs on its own OS thread; RPC handlers
    calling in from the asyncio loop hit the unacked dict under
    _state_lock. NotesStore does its own per-game locking, so the
    load+stamp pair inside the tick is safe even if a user happens
    to edit the same note from the modal at the same moment.
    """

    def __init__(self, *, notes_store, cache_store, settings_store, notifications_store=None, plugin=None):
        self._notes_store = notes_store
        self._cache_store = cache_store
        self._settings_store = settings_store

        self._notifications = notifications_store

        self._plugin = plugin

        self._thread = None
        self._stop_event = threading.Event()
        self._lifecycle_lock = threading.Lock()

        self._generation = -1

        self._debug_logging = False

        self._event_loop = None

        self._state_lock = threading.Lock()

        self._pending_by_game: dict[int, list[dict]] = {}

    def _debug_log(self, message, *args):
        if self._debug_logging:
            decky.logger.info(message, *args)

    @contextlib.contextmanager
    def _maybe_hold_trickle_lock(self):
        plugin = self._plugin
        lock = getattr(plugin, "_trickle_tick_lock", None) if plugin is not None else None
        if lock is None:
            yield
            return
        with lock:
            yield

    def _active_account_changed(self, tick_ulid):
        try:
            cfg = self._settings_store.load_config()
        except Exception:
            return False
        current = str(cfg.get("activeUlid") or "").strip()
        return current != str(tick_ulid or "").strip()

    def set_event_loop(self, loop):
        self._event_loop = loop

    def start(self):
        with self._lifecycle_lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._stop_event.clear()
            self._generation = _generation_fence.claim()
            thread = threading.Thread(
                target=self._run_loop,
                name="notes-reminder",
                daemon=True,
            )
            self._thread = thread

        thread.start()
        decky.logger.info(
            "notes reminder: thread started (generation %d)",
            self._generation,
        )

    def stop(self):
        self._stop_event.set()
        decky.logger.info("notes reminder: stop requested")

    def _run_loop(self):
        my_generation = self._generation
        self._debug_log(
            "notes reminder: loop entered gen=%d tid=%d",
            my_generation,
            threading.get_ident(),
        )
        if self._stop_event.wait(REMINDER_STARTUP_DELAY_SECONDS):
            return

        while not self._stop_event.is_set():
            if not _generation_fence.is_live(my_generation):
                self._debug_log(
                    "notes reminder: gen=%d superseded, exiting tid=%d",
                    my_generation,
                    threading.get_ident(),
                )
                return

            try:
                self._run_one_tick()
            except Exception as exc:
                decky.logger.exception(
                    "notes reminder: tick crashed: %s (%s)",
                    type(exc).__name__,
                    exc,
                )

            if self._stop_event.wait(REMINDER_TICK_SECONDS):
                return

    def _run_one_tick(self):
        try:
            cfg = self._settings_store.load_config()
            self._debug_logging = self._settings_store.get_debug_logging(cfg)
            tick_ulid = str(cfg.get("activeUlid") or "").strip()
        except Exception:
            tick_ulid = ""

        self._debug_log(
            "notes reminder: tick gen=%d tid=%d",
            self._generation,
            threading.get_ident(),
        )

        current_game_id, current_game_title, current_game_image_icon = self._read_current_game()
        if current_game_id is None:
            return

        entry = self._notes_store.load_notes_for_game(current_game_id)
        notes = entry.get("notes") or []
        if not notes:
            return

        now = int(time.time())

        with self._maybe_hold_trickle_lock():
            if self._active_account_changed(tick_ulid):
                self._debug_log(
                    "notes reminder: account switched mid-tick, skipping reminder fire"
                )
                return
            for note in notes:
                if not self._is_due(note, now):
                    continue
                self._fire(current_game_id, note, now, current_game_title, current_game_image_icon)

    def _read_current_game(self):
        try:
            wrapper = self._cache_store.load_payload() or {}
        except Exception:
            return None, None, None
        payload = wrapper.get("payload") or {}
        raw = payload.get("gameId")
        if raw in (None, "", 0):
            return None, None, None
        try:
            game_id = int(raw)
        except (TypeError, ValueError):
            return None, None, None
        title = payload.get("title")
        if not isinstance(title, str):
            title = None
        image_icon = payload.get("imageIcon")
        if not isinstance(image_icon, str) or not image_icon.strip():
            image_icon = None
        return game_id, title, image_icon

    def _is_due(self, note, now_ts):
        mode = note.get("reminderMode")
        if mode not in ("once", "every"):
            return False

        if note.get("completedAt") is not None:
            return False

        every = note.get("reminderEveryMinutes")
        try:
            every_seconds = int(every) * 60
        except (TypeError, ValueError):
            return False
        if every_seconds <= 0:
            return False

        last = note.get("reminderLastFiredAt")
        if last is None:
            return True
        try:
            last_ts = int(last)
        except (TypeError, ValueError):
            return True

        return (now_ts - last_ts) >= every_seconds

    def _fire(self, game_id, note, now_ts, game_title, game_image_icon):
        note_id = note.get("id")
        if not isinstance(note_id, str) or not note_id:
            return

        result = self._notes_store.stamp_reminder_fired(game_id, note_id, now_ts)
        if not isinstance(result, dict) or not result.get("ok"):
            decky.logger.warning(
                "notes reminder: stamp failed for game=%s note=%s result=%s",
                game_id,
                note_id,
                result,
            )
            return

        item = {
            "noteId": note_id,
            "gameId": game_id,
            "title": note.get("title") or "",
            "body": note.get("body") or "",
            "color": note.get("color") or "default",
            "firedAt": now_ts,
        }

        with self._state_lock:
            bucket = self._pending_by_game.setdefault(int(game_id), [])
            replaced = False
            for i, existing in enumerate(bucket):
                if existing.get("noteId") == note_id:
                    bucket[i] = item
                    replaced = True
                    break
            if not replaced:
                bucket.append(item)

        decky.logger.info(
            "notes reminder: fired game=%s note=%s",
            game_id,
            note_id,
        )

        if self._notifications is not None and is_type_enabled("noteReminder", self._settings_store):
            self._notifications.append({
                "type": "noteReminder",
                "kind": "actionable",
                "title": self._notification_title_for_note(note, game_title),
                "body": self._notification_body_for_note(note),
                "iconSource": "game",
                "iconGameId": int(game_id),
                "iconImageIcon": game_image_icon,
                "target": {
                    "view": "gameNotes",
                    "gameId": int(game_id),
                    "noteId": note_id,
                },
                "source": "notifications",
                "meta": {
                    "color": note.get("color") or "default",
                    "reminderLabel": self._reminder_label_for_note(note, game_title),
                },
            })
        emit_notification(
            ntype="noteReminder",
            title_key="Reminder",
            toast_line=self._toast_text_for_note(note),
            settings_store=self._settings_store,
            event_loop=self._event_loop,
        )

    def _toast_text_for_note(self, note):
        title = (note.get("title") or "").strip()
        if title:
            return title

        body = (note.get("body") or "").strip()
        body = _LEADING_TAG_PATTERN.sub("", body, count=1).strip()
        if len(body) <= REMINDER_TOAST_BODY_MAX_LEN:
            return body

        clipped = body[:REMINDER_TOAST_BODY_MAX_LEN]
        last_space = clipped.rfind(" ")
        if last_space > REMINDER_TOAST_BODY_MAX_LEN // 2:
            clipped = clipped[:last_space]
        return clipped.rstrip() + "\u2026"

    def _reminder_label_for_note(self, note, game_title):
        game = (game_title or "").strip()
        title = (note.get("title") or "").strip()
        if game and title:
            return "%s \u2022 %s" % (game, title)
        if game:
            return game
        if title:
            return title
        return ""

    def _notification_title_for_note(self, note, game_title):
        label = self._reminder_label_for_note(note, game_title)
        if label:
            return "Reminder: %s" % label
        return "Reminder"

    def _notification_body_for_note(self, note):
        body = (note.get("body") or "")
        return _LEADING_TAG_PATTERN.sub("", body, count=1).strip()

    def get_pending(self, game_id):
        """Return (without clearing) all unacked reminders for a game.

        Returns an empty list if the game id is unknown or there's
        nothing pending. Safe to call from the event loop -- the lock
        is held for microseconds.
        """
        normalised = self._normalise_game_id(game_id)
        if normalised is None:
            return []

        with self._state_lock:
            bucket = self._pending_by_game.get(normalised)
            if not bucket:
                return []
            return [dict(item) for item in bucket]

    def ack(self, game_id, note_ids):
        """Drop the named reminders from the pending list for a game.

        Unknown ids are silently skipped -- it's normal for a stale
        ack to arrive after a re-fire has already replaced the entry.
        """
        normalised = self._normalise_game_id(game_id)
        if normalised is None:
            return {"ok": False, "error": "invalid_game_id", "removed": 0}

        if not isinstance(note_ids, (list, tuple)):
            return {"ok": False, "error": "invalid_note_ids", "removed": 0}

        wanted = set()
        for raw in note_ids:
            if isinstance(raw, str) and raw:
                wanted.add(raw)

        if not wanted:
            return {"ok": True, "removed": 0}

        with self._state_lock:
            bucket = self._pending_by_game.get(normalised)
            if not bucket:
                return {"ok": True, "removed": 0}
            keep = [item for item in bucket if item.get("noteId") not in wanted]
            removed = len(bucket) - len(keep)
            if keep:
                self._pending_by_game[normalised] = keep
            else:
                self._pending_by_game.pop(normalised, None)

        return {"ok": True, "removed": removed}

    def reset_pending(self):
        """Drop every pending reminder we're holding in RAM.

        Called when the account switches. _pending_by_game is the one bit
        of reminder state that never hits disk, so re-pointing the notes
        store doesn't touch it -- left alone, the daemon would keep handing
        the panel the previous account's due reminders until its next tick
        re-derived them. Clearing the dict is the whole fix; the next tick
        rebuilds from the re-pointed notes store.
        """
        with self._state_lock:
            self._pending_by_game.clear()

    def _normalise_game_id(self, raw):
        if raw in (None, "", 0):
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
