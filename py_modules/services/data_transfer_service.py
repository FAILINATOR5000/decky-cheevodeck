import asyncio
import re
import socket
import threading
import time

import decky
import data_transfer
import nearby_protocol
from notifications import emit_notification
from notes_store import CURRENT_SCHEMA_VERSION as NOTES_SCHEMA
from utils import ensure_dir, norm_game_id, write_file_atomic

DATA_EVENT = "cheevodeck_data_imported"

KINDS = data_transfer.KINDS

GAME_KINDS = ("all", "tracked", "notes", "guides")

ERROR_BUSY = "busy"
ERROR_NOT_RUNNING = "not_running"
ERROR_NO_ACCOUNT = "no_account"
ERROR_NO_GAME = "no_game"
ERROR_DIFFERENT_GAME = "different_game"
ERROR_NEWER_SCHEMA = "newer_schema"
ERROR_ULID_MISMATCH = "ulid_mismatch"
ERROR_PEER_GONE = "peer_gone"
ERROR_PEER_BUSY = "peer_busy"
ERROR_PEER_NOTHING = "peer_nothing"
ERROR_INTERRUPTED = "transfer_interrupted"
ERROR_PAYLOAD_MISMATCH = "payload_mismatch"
ERROR_TOO_LATE = "too_late"
ERROR_WRITE_FAILED = "write_failed"

_RUNNING_STATES = ("connecting", "receiving", "saving", "committing")

_PAST_CANCEL = ("saving", "committing")

BACKUPS_DIR = "data-transfer-backups"
BACKUPS_KEPT = 5

_BACKUP_NAME = re.compile(
    r"^(tracked-\d+|notes-\d+|guides-\d+|events|milestones(?:_sealed)?(?:-moved)?)-(\d+)\.json$"
)

_KIND_TITLES = {
    "all": "Current Game Data Imported",
    "tracked": "Tracked Imported",
    "notes": "Notes Imported",
    "guides": "Bookmarks Imported",
    "events": "Events Imported",
    "milestones": "Milestones Moved",
}

_KIND_NOUNS = {"tracked": "tracked achievements", "notes": "notes", "guides": "bookmarks", "events": "tracked events"}
_ADDED_LINES = {"tracked": "Added {{count}} tracked", "notes": "Added {{count}} notes",
                "guides": "Added {{count}} bookmarks", "events": "Added {{count}} events"}
_UPDATED_LINES = {"tracked": "Updated {{count}} tracked", "notes": "Updated {{count}} notes",
                  "guides": "Updated {{count}} bookmarks", "events": "Updated {{count}} events"}


def _backup_kind(base: str) -> str:
    for kind in ("tracked", "notes", "guides"):
        if base.startswith(kind + "-"):
            return kind
    if base == "events":
        return "events"
    return "milestones-moved" if base.endswith("-moved") else "milestones"


class DataTransferService:
    def __init__(self, *, settings_store, cache_store, notes_store, events_store, guides_store, milestones_service,
                 notes_reminder_service, notifications_store, user_base):
        self._settings_store = settings_store
        self._cache_store = cache_store
        self._notes_store = notes_store
        self._events_store = events_store
        self._guides_store = guides_store
        self._milestones = milestones_service
        self._reminders = notes_reminder_service
        self._notifications = notifications_store
        self._user_base = user_base
        self._event_loop = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._socket = None
        self._thread = None
        self._ulid = ""
        self._reset("idle")

    def set_event_loop(self, loop) -> None:
        self._event_loop = loop

    def _reset(self, state: str) -> None:
        with self._lock:
            self._state = state
            self._direction = ""
            self._kind = ""
            self._mode = ""
            self._peer = None
            self._error = ""
            self._result = None

    def status(self) -> dict:
        with self._lock:
            return {
                "ok": True,
                "state": self._state,
                "direction": self._direction,
                "kind": self._kind,
                "mode": self._mode,
                "peer": self._peer,
                "error": self._error,
                "result": self._result,
            }

    def running(self) -> bool:
        with self._lock:
            return self._state in _RUNNING_STATES

    def cancel(self) -> dict:
        with self._lock:
            if self._state not in _RUNNING_STATES:
                return {"ok": False, "error": ERROR_NOT_RUNNING}
            if self._state in _PAST_CANCEL:
                return {"ok": False, "error": ERROR_TOO_LATE}
            self._stop.set()
            held = self._socket
        if held is not None:
            try:
                held.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        decky.logger.info("data transfer: canceled")
        return {"ok": True}

    def stop(self) -> None:
        self.cancel()

    def _current_game(self):
        payload = self._cache_store.load_payload().get("payload")
        return norm_game_id((payload or {}).get("gameId")) if isinstance(payload, dict) else None

    def start_receive(self, fetch, peer: dict, kind: str, mode: str, game_id) -> dict:
        if self.running():
            return {"ok": False, "error": ERROR_BUSY}
        ulid = str(self._settings_store.load_config().get("activeUlid") or "")
        if not ulid:
            return {"ok": False, "error": ERROR_NO_ACCOUNT}
        mode = "replace" if kind == "milestones" or mode == "replace" else "merge"
        if kind in GAME_KINDS:
            own = self._current_game()
            if own is None:
                return {"ok": False, "error": ERROR_NO_GAME}
            if own != game_id:
                return {"ok": False, "error": ERROR_DIFFERENT_GAME}
        else:
            game_id = None

        self._stop.clear()
        self._reset("connecting")
        with self._lock:
            self._ulid = ulid
            self._direction = "receive"
            self._kind = kind
            self._mode = mode
            self._peer = dict(peer)
            self._thread = threading.Thread(
                target=self._run, args=(fetch, kind, mode, game_id), name="data-receive", daemon=True
            )
            self._thread.start()
        return {"ok": True}

    def _run(self, fetch, kind, mode, game_id) -> None:
        try:
            code, result = fetch(
                stage=self._stage,
                should_stop=self._stop.is_set,
                hold_socket=self._hold_socket,
                apply=lambda body: self._apply(kind, mode, game_id, body),
            )
        except Exception as e:
            decky.logger.exception("data transfer: the receive stopped (%s)", type(e).__name__)
            code, result = ERROR_WRITE_FAILED, None
        if code and self._stop.is_set():
            with self._lock:
                self._state = "canceled"
                self._error = ""
            return
        if code:
            self._fail(code)
            return
        with self._lock:
            self._state = "done"
            self._error = ""
            self._result = result
        decky.logger.info("data transfer: %s imported (%s)", kind, mode)
        self._notify_done(kind, result)

    def _stage(self, state: str) -> bool:
        with self._lock:
            if state in _PAST_CANCEL and self._stop.is_set():
                return False
            self._state = state
            return True

    def _hold_socket(self, sock) -> None:
        with self._lock:
            self._socket = sock

    def _fail(self, code: str) -> None:
        with self._lock:
            self._state = "failed"
            self._error = code
            kind = self._kind
            peer = dict(self._peer or {})
        decky.logger.warning("data transfer: %s failed (%s)", kind, code)
        self._file_card("Data Transfer Failed", f"The transfer stopped: {code}",
                        {"transfer": "data", "outcome": "failed", "kind": kind, "reason": code,
                         "peerModel": peer.get("model") or "", "peerHost": peer.get("host") or "",
                         "peerAddress": peer.get("address") or ""})
        emit_notification(
            ntype="system",
            title_key="Data Transfer Failed",
            line_key="The transfer didn't finish",
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            force_toast=True,
        )

    def _apply(self, kind, mode, game_id, body) -> dict:
        raw = data_transfer.decode(body)
        if kind == "milestones":
            payload = data_transfer.read_milestones(raw)
            if payload is None:
                return {"ok": False, "error": ERROR_PAYLOAD_MISMATCH}
            if not self._same_account():
                return {"ok": False, "error": ERROR_ULID_MISMATCH}
            error = self._milestones.adopt(payload["milestones"], payload["sealed"], self._back_up_milestones)
            if error:
                return {"ok": False, "error": error}
            summary = self._milestones.move_summary() or {}
            return {"ok": True, "result": {"xp": summary.get("xp", 0), "tier": summary.get("tier"),
                                           "step": summary.get("step"), "sourceCleared": False}}

        if kind == "events":
            incoming = data_transfer.read_events(raw)
            if incoming is None:
                return {"ok": False, "error": ERROR_PAYLOAD_MISMATCH}
            if not self._same_account():
                return {"ok": False, "error": ERROR_ULID_MISMATCH}
            result = self._events_store.import_events(self._ulid, incoming, mode, backup=self._back_up_one)
            return self._landed(kind, None, result)

        if kind == "all":
            parts, error = data_transfer.read_all(raw, game_id, NOTES_SCHEMA)
            if parts is None:
                return {"ok": False, "error": error}
            return self._apply_all(mode, game_id, parts)
        if kind == "tracked":
            incoming = data_transfer.read_tracked(raw, game_id)
            error = ERROR_PAYLOAD_MISMATCH
        elif kind == "guides":
            incoming = data_transfer.read_guides(raw, game_id)
            error = ERROR_PAYLOAD_MISMATCH
        else:
            incoming, error = data_transfer.read_notes(raw, game_id, NOTES_SCHEMA)
        if incoming is None:
            return {"ok": False, "error": error}

        with self._cache_store.payload_lock():
            cached = self._cache_store.load_payload().get("payload")
            if not self._same_account():
                return {"ok": False, "error": ERROR_ULID_MISMATCH}
            own = norm_game_id(cached.get("gameId")) if isinstance(cached, dict) else None
            if own is None:
                return {"ok": False, "error": ERROR_NO_GAME}
            if own != game_id:
                return {"ok": False, "error": ERROR_DIFFERENT_GAME}
            if kind == "tracked":
                result = self._settings_store.import_tracked_for_game(cached, incoming, mode, backup=self._back_up_one)
            elif kind == "guides":
                result = self._guides_store.import_guides(game_id, incoming, mode, backup=self._back_up_one)
            else:
                result = self._notes_store.import_notes(game_id, incoming, mode, now=int(time.time()),
                                                        backup=self._back_up_one)
        return self._landed(kind, game_id, result)

    def _import_part(self, kind, mode, game_id, cached, incoming) -> dict:
        if kind == "tracked":
            return self._settings_store.import_tracked_for_game(cached, incoming, mode, backup=self._back_up_one)
        if kind == "guides":
            return self._guides_store.import_guides(game_id, incoming, mode, backup=self._back_up_one)
        return self._notes_store.import_notes(game_id, incoming, mode, now=int(time.time()), backup=self._back_up_one)

    def _part_file(self, kind, game_id):
        if kind == "tracked":
            return self._settings_store.tracked_file_for_game(game_id)
        if kind == "guides":
            return self._guides_store.file_for_game(game_id)
        return self._notes_store.file_for_game(game_id)

    def _apply_all(self, mode, game_id, parts) -> dict:
        results = {}
        written = []
        with self._cache_store.payload_lock():
            cached = self._cache_store.load_payload().get("payload")
            if not self._same_account():
                return {"ok": False, "error": ERROR_ULID_MISMATCH}
            own = norm_game_id(cached.get("gameId")) if isinstance(cached, dict) else None
            if own is None:
                return {"ok": False, "error": ERROR_NO_GAME}
            if own != game_id:
                return {"ok": False, "error": ERROR_DIFFERENT_GAME}
            try:
                for kind in data_transfer.ALL_PARTS:
                    incoming = parts[kind]
                    if incoming is None:
                        continue
                    path = self._part_file(kind, game_id)
                    before = path.read_bytes() if path.exists() else None
                    written.append((path, before))
                    result = self._import_part(kind, mode, game_id, cached, incoming)
                    if not result.get("ok"):
                        self._put_back(written)
                        return {"ok": False, "error": result.get("error") or ERROR_PAYLOAD_MISMATCH}
                    results[kind] = result
            except Exception:
                self._put_back(written)
                raise
        for kind, result in results.items():
            removed = result.pop("removedIds", None)
            if removed and self._reminders is not None:
                self._reminders.ack(game_id, removed)
            result.pop("ok", None)
            self._emit({"kind": kind, "gameId": game_id})
        return {"ok": True, "result": {"parts": results}}

    def _put_back(self, written) -> None:
        for path, before in reversed(written):
            try:
                if before is None:
                    path.unlink(missing_ok=True)
                else:
                    write_file_atomic(path, before)
            except OSError as e:
                decky.logger.error("data transfer: couldn't put %s back (%s)", path.name, type(e).__name__)

    def _landed(self, kind, game_id, result) -> dict:
        if not result.get("ok"):
            return {"ok": False, "error": result.get("error") or ERROR_PAYLOAD_MISMATCH}
        removed = result.pop("removedIds", None)
        if removed and self._reminders is not None:
            self._reminders.ack(game_id, removed)
        result.pop("ok", None)
        self._emit({"kind": kind, "gameId": game_id})
        return {"ok": True, "result": result}

    def _same_account(self) -> bool:
        return str(self._settings_store.load_config().get("activeUlid") or "") == self._ulid

    def payload_for_send(self, kind: str, game_id) -> dict:
        if kind == "all":
            own = self._current_game()
            if own is None:
                return {"ok": False, "error": "no_game"}
            if own != game_id:
                return {"ok": False, "error": "different_game"}
            parts = {}
            for part in data_transfer.ALL_PARTS:
                built = self.payload_for_send(part, game_id)
                parts[part] = data_transfer.decode(built["body"]) if built["ok"] else None
            if all(section is None for section in parts.values()):
                return {"ok": False, "error": "nothing"}
            return {"ok": True, "body": data_transfer.encode(data_transfer.all_payload(own, parts))}
        if kind == "events":
            state = self._events_store.load()
            if not state["tracked"]["items"] and not state["completed"] and not state["checklistTicks"]:
                return {"ok": False, "error": "nothing"}
            return {"ok": True, "body": data_transfer.encode(data_transfer.events_payload(state))}
        own = self._current_game()
        if own is None:
            return {"ok": False, "error": "no_game"}
        if own != game_id:
            return {"ok": False, "error": "different_game"}
        if kind == "tracked":
            tracked = self._settings_store.load_tracked_for_game(own)
            if not tracked["achievementIds"]:
                return {"ok": False, "error": "nothing"}
            payload = data_transfer.tracked_payload(own, tracked)
        elif kind == "guides":
            record = self._guides_store.get_game_guides(own)
            if not any(guide["bookmarks"] for guide in record["guides"].values()):
                return {"ok": False, "error": "nothing"}
            payload = data_transfer.guides_payload(own, record)
        else:
            entry = self._notes_store.load_notes_for_game(own)
            if not entry["notes"]:
                return {"ok": False, "error": "nothing"}
            payload = data_transfer.notes_payload(own, entry)
        return {"ok": True, "body": data_transfer.encode(payload)}

    def begin_move(self) -> dict:
        move = self._milestones.begin_move()
        if move["ok"]:
            move["body"] = data_transfer.encode(data_transfer.milestones_payload(move["milestones"], move["sealed"]))
        return move

    def end_move(self, token, committed: bool, peer: dict) -> bool:
        folder = None
        stamp = 0
        if committed:
            folder = self._backups_dir()
            stamp = self._free_stamp(folder, ("milestones-moved", "milestones_sealed-moved"))
        cleared = self._milestones.end_move(token, committed, folder, stamp)
        if cleared:
            self._prune(folder)
            label = nearby_protocol.device_label(peer.get("model") or "", peer.get("host") or "",
                                                 peer.get("address") or "")
            decky.logger.info("data transfer: milestones moved to %s", label)
            self._file_card(
                "Milestones Moved",
                f"Your milestones are now on {label}. This device starts over at zero.",
                {"transfer": "data", "outcome": "moved", "kind": "milestones",
                 "peerModel": peer.get("model") or "", "peerHost": peer.get("host") or "",
                 "peerAddress": peer.get("address") or ""},
            )
            emit_notification(
                ntype="system",
                title_key="Milestones Moved",
                line_key="Now starting at zero",
                settings_store=self._settings_store,
                event_loop=self._event_loop,
                force_toast=True,
            )
        return cleared

    def summary(self) -> dict:
        out = {"gameId": None, "title": None, "tracked": None, "notes": None, "guides": None, "events": None,
               "milestones": None}
        try:
            payload = self._cache_store.load_payload().get("payload")
            if isinstance(payload, dict):
                out["gameId"] = norm_game_id(payload.get("gameId"))
                out["title"] = nearby_protocol.clean_title(payload.get("title"))
        except Exception as e:
            decky.logger.warning("data transfer: couldn't read the current game (%s)", type(e).__name__)
        if out["gameId"] is not None and out["gameId"] > 0:
            try:
                out["tracked"] = len(self._settings_store.load_tracked_for_game(out["gameId"])["achievementIds"])
            except Exception as e:
                decky.logger.warning("data transfer: couldn't count tracked (%s)", type(e).__name__)
            try:
                out["notes"] = len(self._notes_store.load_notes_for_game(out["gameId"])["notes"])
            except Exception as e:
                decky.logger.warning("data transfer: couldn't count notes (%s)", type(e).__name__)
            try:
                record = self._guides_store.get_game_guides(out["gameId"])
                out["guides"] = sum(len(guide["bookmarks"]) for guide in record["guides"].values())
            except Exception as e:
                decky.logger.warning("data transfer: couldn't count bookmarks (%s)", type(e).__name__)
        else:
            out["gameId"] = None
        try:
            out["events"] = len(self._events_store.load()["tracked"]["items"])
        except Exception as e:
            decky.logger.warning("data transfer: couldn't count events (%s)", type(e).__name__)
        try:
            out["milestones"] = self._milestones.move_summary()
        except Exception as e:
            decky.logger.warning("data transfer: couldn't read milestones (%s)", type(e).__name__)
        return out

    def _backups_dir(self):
        return self._user_base() / BACKUPS_DIR

    def _free_stamp(self, folder, prefixes) -> int:
        stamp = int(time.time())
        while any((folder / f"{prefix}-{stamp}.json").exists() for prefix in prefixes):
            stamp += 1
        return stamp

    def _back_up(self, files: dict) -> None:
        folder = self._backups_dir()
        ensure_dir(folder)
        stamp = self._free_stamp(folder, files)
        for prefix, data in files.items():
            if data is not None:
                write_file_atomic(folder / f"{prefix}-{stamp}.json", data)
        self._prune(folder)

    def _back_up_one(self, name: str, data: bytes) -> None:
        self._back_up({name: data})

    def _back_up_milestones(self, milestones: bytes, sealed) -> None:
        self._back_up({"milestones": milestones, "milestones_sealed": sealed})

    def _prune(self, folder) -> None:
        try:
            groups = {}
            for path in folder.iterdir():
                match = _BACKUP_NAME.match(path.name)
                if match is None:
                    continue
                base = match.group(1).replace("_sealed", "")
                groups.setdefault(_backup_kind(base), {}).setdefault((int(match.group(2)), base), []).append(path)
            for sets in groups.values():
                for key in sorted(sets, reverse=True)[BACKUPS_KEPT:]:
                    for path in sets[key]:
                        path.unlink()
        except OSError as e:
            decky.logger.warning("data transfer: couldn't prune the backups (%s)", type(e).__name__)

    def _emit(self, payload: dict) -> None:
        loop = self._event_loop
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(decky.emit(DATA_EVENT, payload), loop)
        except Exception as e:
            decky.logger.warning("data transfer: the import event failed (%s)", type(e).__name__)

    def _file_card(self, title: str, body: str, meta: dict) -> None:
        if self._notifications is None:
            return
        try:
            self._notifications.append({
                "type": "system",
                "kind": "actionable",
                "iconSource": "none",
                "title": title,
                "body": body,
                "source": "notifications",
                "target": {"view": "dataTransfer"},
                "meta": meta,
            })
        except Exception as e:
            decky.logger.warning("data transfer: the notification could not be filed (%s)", type(e).__name__)

    def _notify_done(self, kind: str, result: dict) -> None:
        with self._lock:
            peer = dict(self._peer or {})
            mode = self._mode
        label = nearby_protocol.device_label(peer.get("model") or "", peer.get("host") or "", peer.get("address") or "")
        meta = {"transfer": "data", "outcome": "imported", "kind": kind, "mode": mode,
                "peerModel": peer.get("model") or "", "peerHost": peer.get("host") or "",
                "peerAddress": peer.get("address") or "", **{k: v for k, v in result.items() if k != "removedIds"}}
        title = _KIND_TITLES[kind]
        line_vars = None
        if kind == "milestones":
            if result.get("sourceCleared"):
                body = f"Milestones moved from {label}."
                line = "Now on this device"
            else:
                title = "Milestones Imported"
                body = f"Milestones imported, but {label} didn't confirm it cleared its copy."
                line = "Source not cleared"
        elif kind == "all":
            changed = [part for part, landed in result.get("parts", {}).items()
                       if landed.get("added") or landed.get("updated") or mode == "replace"]
            body = (f"Imported this game's {', '.join(_KIND_NOUNS[part] for part in changed)} from {label}."
                    if changed else f"Nothing new to add from {label}.")
            line = "Imported" if changed else "Nothing new to add"
        else:
            noun = _KIND_NOUNS[kind]
            count = result.get("added", 0)
            updated = result.get("updated", 0)
            if mode == "replace":
                body = f"Replaced with {count} {noun} from {label}."
            elif count or updated:
                body = f"Added {count} and updated {updated} {noun} from {label}."
            else:
                body = f"Nothing new to add from {label}."
            if mode == "replace" or count:
                line = _ADDED_LINES[kind]
                line_vars = {"count": count}
            elif updated:
                line = _UPDATED_LINES[kind]
                line_vars = {"count": updated}
            else:
                line = "Nothing new to add"
        self._file_card(title, body, meta)
        emit_notification(
            ntype="system",
            title_key=title,
            line_key=line,
            template_vars=line_vars,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            force_toast=True,
        )
