"""
Everything File Watcher keeps on disk, which is two files with very different
shapes.

``file_watcher.json``
    The configuration: watched roots, their exclusions, the schedule, the
    blackout window, and the two clocks. Small, rewritten whole on every edit,
    and read exactly once per plugin load — the tick holds what it needs in
    memory precisely so it never comes back here.

``file_watcher.db``
    SQLite. The map of every file and its hash, the work list for the pass in
    flight, and the findings the last completed pass produced. Findings are
    dismissed one row at a time, which is the write pattern a JSON blob is worst
    at and a database is best at.

Global rather than per-account, so both files sit at the runtime_dir root and
never repoint: whether a file on disk rotted has nothing to do with which
RetroAchievements account is signed in. Your ROMs are your ROMs. There is
deliberately no repoint() here for _apply_user_scope to call.

``weekday`` is 0=Monday through 6=Sunday, matching ``datetime.weekday()``. The
frontend agrees; nothing anywhere in this feature uses any other ordering.
"""

from pathlib import Path

import contextlib
import fnmatch
import os
import sqlite3
import threading
import time

import decky

from utils import chown_to_data_owner, ensure_dir, load_json_file, save_json_file, to_int


CURRENT_SCHEMA_VERSION = 1

MAX_ROOTS = 512

MAX_EXCLUDES = 64
EXCLUDE_MAX_LEN = 128

LABEL_MAX_LEN = 64

DB_TIMEOUT_SECONDS = 20.0

ALLOWED_EVERY_WEEKS = (1, 2, 4, 8, 13, 26, 52)

BUCKET_CORRUPTED = "corrupted"
BUCKET_UNREADABLE = "unreadable"
BUCKET_REPLACED = "replaced"
BUCKET_MISSING = "missing"
BUCKET_ADDED = "added"
BUCKET_VERIFIED = "verified"

FINDING_BUCKETS = (
    BUCKET_CORRUPTED,
    BUCKET_UNREADABLE,
    BUCKET_REPLACED,
    BUCKET_MISSING,
    BUCKET_ADDED,
    BUCKET_VERIFIED,
)

ACTION_ACCEPT = "accept"
ACTION_FORGET = "forget"

_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS files (
        root_id       INTEGER NOT NULL,
        rel_path      TEXT    NOT NULL,
        size          INTEGER NOT NULL,
        mtime_ns      INTEGER NOT NULL,
        sha256        TEXT    NOT NULL,
        first_seen    INTEGER NOT NULL,
        last_verified INTEGER NOT NULL,
        PRIMARY KEY (root_id, rel_path)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pass_queue (
        root_id  INTEGER NOT NULL,
        rel_path TEXT    NOT NULL,
        size     INTEGER NOT NULL,
        done     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (root_id, rel_path)
    )
    """,
    "DROP INDEX IF EXISTS pass_queue_todo",
    "CREATE INDEX IF NOT EXISTS pass_queue_next ON pass_queue (root_id, rel_path) WHERE done = 0",
    """
    CREATE TABLE IF NOT EXISTS pass_state (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        origin      TEXT    NOT NULL,
        phase       TEXT    NOT NULL,
        started_at  INTEGER NOT NULL,
        total_files INTEGER NOT NULL,
        total_bytes INTEGER NOT NULL,
        done_files  INTEGER NOT NULL,
        done_bytes  INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS findings (
        root_id      INTEGER NOT NULL,
        rel_path     TEXT    NOT NULL,
        bucket       TEXT    NOT NULL,
        old_sha      TEXT,
        new_sha      TEXT,
        old_size     INTEGER,
        new_size     INTEGER,
        old_mtime_ns INTEGER,
        new_mtime_ns INTEGER,
        PRIMARY KEY (root_id, rel_path)
    )
    """,
    "DROP INDEX IF EXISTS findings_bucket",
    "CREATE INDEX IF NOT EXISTS findings_browse ON findings (bucket, root_id, rel_path)",
    """
    CREATE TABLE IF NOT EXISTS findings_pending (
        root_id      INTEGER NOT NULL,
        rel_path     TEXT    NOT NULL,
        bucket       TEXT    NOT NULL,
        old_sha      TEXT,
        new_sha      TEXT,
        old_size     INTEGER,
        new_size     INTEGER,
        old_mtime_ns INTEGER,
        new_mtime_ns INTEGER,
        PRIMARY KEY (root_id, rel_path)
    )
    """,
    "CREATE INDEX IF NOT EXISTS findings_pending_bucket ON findings_pending (bucket)",
    """
    CREATE TABLE IF NOT EXISTS skipped_roots (
        root_id    INTEGER PRIMARY KEY,
        reason     TEXT    NOT NULL,
        file_count INTEGER NOT NULL,
        last_ok_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS skipped_roots_pending (
        root_id    INTEGER PRIMARY KEY,
        reason     TEXT    NOT NULL,
        file_count INTEGER NOT NULL,
        last_ok_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS excluded (
        root_id  INTEGER NOT NULL,
        rel_path TEXT    NOT NULL,
        is_dir   INTEGER NOT NULL,
        rule     TEXT    NOT NULL,
        PRIMARY KEY (root_id, rel_path)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS excluded_pending (
        root_id  INTEGER NOT NULL,
        rel_path TEXT    NOT NULL,
        is_dir   INTEGER NOT NULL,
        rule     TEXT    NOT NULL,
        PRIMARY KEY (root_id, rel_path)
    )
    """,
)

_FINDING_COLUMNS = (
    "root_id, rel_path, bucket, old_sha, new_sha, "
    "old_size, new_size, old_mtime_ns, new_mtime_ns"
)


def excluding_rule(rel_path: str, patterns):
    """Which rule excludes this path, relative to its root, or None.

    Every component is tested as well as the whole path, which is what makes a
    bare directory name like ``@eaDir`` exclude everything underneath it without
    the caller having to write ``@eaDir/*``. It also means the walk's directory
    prune and the map prune that runs when exclusions are edited agree by
    construction: a file whose parent got pruned would have matched here too.

    First match in list order wins, so the rule the walk reports is the rule the
    walk acted on. Two rules covering one path is normal — ".*" and ".stfolder"
    both cover a Syncthing marker — and picking the first keeps that answer
    stable between passes.
    """
    if not patterns:
        return None
    parts = [part for part in str(rel_path or "").split("/") if part]
    for pattern in patterns:
        if fnmatch.fnmatch(rel_path, pattern):
            return pattern
        for part in parts:
            if fnmatch.fnmatch(part, pattern):
                return pattern
    return None


def path_excluded(rel_path: str, patterns) -> bool:
    """Whether an exclusion list covers this path. See excluding_rule.

    One implementation behind both, deliberately. The agreement the docstring
    above describes is load-bearing, and two matchers that could drift apart is
    exactly how it would stop holding.
    """
    return excluding_rule(rel_path, patterns) is not None


def paths_overlap(left: str, right: str) -> bool:
    """Whether one of these directories contains the other, or they're the same.

    Both sides are expected to be realpaths already. Overlap matters more than
    an exact duplicate does: watching /roms when /roms/wii is already watched
    enumerates every file twice, maps it under two root ids, and shows it twice
    in every findings list, with nothing about the symptom pointing back at the
    cause.
    """
    a = str(left or "").rstrip("/") or "/"
    b = str(right or "").rstrip("/") or "/"
    if a == b:
        return True
    return a.startswith(b + "/") or b.startswith(a + "/")


MAX_OVERLAP_PROBE_DIRS = 20000


def reachable_dir_ids(path: str, cap: int = MAX_OVERLAP_PROBE_DIRS) -> set:
    """Every directory reachable from here, identified by (st_dev, st_ino).

    Follows symlinks, because that's what the walk does — and identity is the
    inode rather than the path for the same reason the walk's loop guard uses
    it: two paths reaching one directory are one directory.

    This exists for the EmuDeck layout, which is the common case on this
    hardware and which a path-prefix check cannot see. ``~/Emulation/roms`` is a
    real directory whose console folders are each a symlink to the SD card, so
    watching it and watching the SD path are string-wise unrelated and
    file-wise identical.
    """
    found = set()
    for dirpath, dirnames, _ in os.walk(path, followlinks=True):
        try:
            info = os.stat(dirpath)
        except OSError:
            dirnames[:] = []
            continue
        key = (info.st_dev, info.st_ino)
        if key in found:
            dirnames[:] = []
            continue
        found.add(key)
        if len(found) >= cap:
            decky.logger.warning(
                "filewatcher: stopped probing %s for overlaps after %d directories", path, cap
            )
            break
    return found


class FileWatcherStore:
    """The config file and the database, and nothing else knows either exists.

    Connections are opened per operation rather than held. That's not just
    tidiness: a factory reset deletes store directories mid-session, and a held
    handle onto a deleted file is a live failure mode with no symptom until the
    next write. Opening fresh means ensure_dir gets a chance to rebuild the
    parent every time, the same self-healing save_json_file does.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.RLock()
        self._schema_ready = False
        self._corruption_logged = False

    def config_path(self) -> Path:
        return self._base_dir / "file_watcher.json"

    def db_path(self) -> Path:
        return self._base_dir / "file_watcher.db"

    def _chown_db_files(self) -> None:
        """Hand the database and both WAL sidecars back to the data owner.

        Every other store gets this free — ensure_dir chowns the directory and
        save_json_file chowns the file — but SQLite creates the .db, -wal and
        -shm itself, as root, at moments we don't control. The sidecars in
        particular are recreated every time a connection opens, so a one-time
        chown at creation is not enough and this runs on every open.

        Best-effort three times over, like the helper itself: an exFAT SD card
        carries no Unix ownership and failing there is the expected answer.
        """
        base = self.db_path()
        for path in (base, Path(str(base) + "-wal"), Path(str(base) + "-shm")):
            if path.exists():
                chown_to_data_owner(path)

    @contextlib.contextmanager
    def _db(self):
        ensure_dir(self._base_dir)
        path = self.db_path()
        existed = path.exists()
        conn = sqlite3.connect(str(path), timeout=DB_TIMEOUT_SECONDS)
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = FULL")
            if not existed or not self._schema_ready:
                for statement in _SCHEMA:
                    conn.execute(statement)
                conn.commit()
                self._schema_ready = True
            self._chown_db_files()
            yield conn
        except sqlite3.OperationalError:
            raise
        except sqlite3.DatabaseError as exc:
            self._note_corruption(exc)
            raise
        finally:
            conn.close()

    def _note_corruption(self, exc) -> None:
        """Say so when the database file itself has stopped being one.

        Nothing here tries to repair it. Recovery is Remove File Watcher Data
        in Options, which unlinks the files rather than going through SQL and
        so still works when every other call in this module doesn't — and
        rebuilding automatically would mean deciding, from one failed read, that
        somebody's recorded hashes should go. This only makes sure the reason is
        in the log rather than left as a feature that quietly stopped working.

        Once per store. Every read would otherwise repeat it, and the pass
        thread never starts in this state, so one line is the whole story.
        """
        if self._corruption_logged:
            return
        self._corruption_logged = True
        decky.logger.error(
            "filewatcher: %s is unreadable (%s) — the recorded hashes are gone. "
            "Options → Data & Cache → Remove File Watcher Data rebuilds it; "
            "the directories and schedule live in the .json and survive.",
            self.db_path().name, exc,
        )

    def _empty_config(self) -> dict:
        return {
            "version": CURRENT_SCHEMA_VERSION,
            "nextRootId": 1,
            "roots": [],
            "schedule": {
                "enabled": False,
                "everyWeeks": 4,
                "weekday": 6,
                "hour": 3,
                "minute": 0,
                "anchorAt": 0,
            },
            "window": {
                "enabled": False,
                "blockFrom": [8, 0],
                "blockTo": [23, 0],
            },
            "lastCompletedAt": 0,
            "lastScheduledAt": 0,
            "nextDueAt": 0,
            "startDir": "",
        }

    def load(self) -> dict:
        with self._lock:
            return self._load_locked()

    def _load_locked(self) -> dict:
        raw = load_json_file(self.config_path(), None)
        if not isinstance(raw, dict):
            return self._empty_config()
        if to_int(raw.get("version", 0), 0) != CURRENT_SCHEMA_VERSION:
            return self._empty_config()
        return self._normalize(raw)

    def _save_locked(self, data: dict) -> None:
        save_json_file(self.config_path(), data)

    def _normalize(self, raw: dict) -> dict:
        clean = self._empty_config()

        roots = []
        used_ids = set()
        raw_roots = raw.get("roots")
        for entry in (raw_roots if isinstance(raw_roots, list) else [])[:MAX_ROOTS]:
            root = self._clean_root(entry)
            if root is None or root["id"] in used_ids:
                continue
            used_ids.add(root["id"])
            roots.append(root)
        clean["roots"] = roots

        highest = max(used_ids) if used_ids else 0
        clean["nextRootId"] = max(to_int(raw.get("nextRootId", 1), 1), highest + 1)

        schedule = raw.get("schedule")
        if isinstance(schedule, dict):
            clean["schedule"] = self._clean_schedule(schedule)
        window = raw.get("window")
        if isinstance(window, dict):
            clean["window"] = self._clean_window(window)

        clean["lastCompletedAt"] = max(0, to_int(raw.get("lastCompletedAt", 0), 0))
        clean["lastScheduledAt"] = max(0, to_int(raw.get("lastScheduledAt", 0), 0))
        clean["nextDueAt"] = max(0, to_int(raw.get("nextDueAt", 0), 0))
        clean["startDir"] = str(raw.get("startDir") or "").strip()
        return clean

    def _clean_root(self, raw):
        if not isinstance(raw, dict):
            return None
        root_id = to_int(raw.get("id", 0), 0)
        path = str(raw.get("path") or "").strip()
        if root_id <= 0 or not path:
            return None

        label = str(raw.get("label") or "").strip()[:LABEL_MAX_LEN]
        if not label:
            label = default_label_for(path)

        excludes = []
        raw_excludes = raw.get("excludes")
        for pattern in (raw_excludes if isinstance(raw_excludes, list) else [])[:MAX_EXCLUDES]:
            cleaned = clean_exclude(pattern)
            if cleaned and cleaned not in excludes:
                excludes.append(cleaned)

        return {
            "id": root_id,
            "path": path,
            "label": label,
            "excludes": excludes,
            "addedAt": to_int(raw.get("addedAt", 0), 0),
        }

    def _clean_schedule(self, raw: dict) -> dict:
        every = to_int(raw.get("everyWeeks", 4), 4)
        if every not in ALLOWED_EVERY_WEEKS:
            every = 4
        weekday = to_int(raw.get("weekday", 6), 6)
        hour = to_int(raw.get("hour", 3), 3)
        minute = to_int(raw.get("minute", 0), 0)
        return {
            "enabled": bool(raw.get("enabled", False)),
            "everyWeeks": every,
            "weekday": weekday if 0 <= weekday <= 6 else 6,
            "hour": hour if 0 <= hour <= 23 else 3,
            "minute": minute if 0 <= minute <= 59 else 0,
            "anchorAt": max(0, to_int(raw.get("anchorAt", 0), 0)),
        }

    def _clean_window(self, raw: dict) -> dict:
        return {
            "enabled": bool(raw.get("enabled", False)),
            "blockFrom": _clean_clock(raw.get("blockFrom"), 8, 0),
            "blockTo": _clean_clock(raw.get("blockTo"), 23, 0),
        }

    def add_root(self, path: str, label: str = "") -> dict:
        """Adopt a directory, rejecting duplicates and overlaps.

        The caller is expected to have resolved the realpath already — the
        picker can hand back a symlink into a directory that's watched under its
        real name, and both checks below only mean anything against resolved
        paths.
        """
        resolved = str(path or "").strip().rstrip("/")
        if not resolved:
            return {"ok": False, "error": "bad_path"}
        if not os.path.isdir(resolved):
            return {"ok": False, "error": "not_a_directory"}

        with self._lock:
            data = self._load_locked()
            if len(data["roots"]) >= MAX_ROOTS:
                return {"ok": False, "error": "too_many_roots"}
            for existing in data["roots"]:
                if existing["path"] == resolved:
                    return {"ok": False, "error": "duplicate_root"}
                if paths_overlap(resolved, existing["path"]):
                    return {"ok": False, "error": "overlapping_root", "label": existing["label"]}

            if data["roots"]:
                candidate = reachable_dir_ids(resolved)
                for existing in data["roots"]:
                    if candidate & reachable_dir_ids(existing["path"]):
                        return {
                            "ok": False,
                            "error": "overlapping_root",
                            "label": existing["label"],
                        }

            root_id = self._mint_root_id(data)
            root = {
                "id": root_id,
                "path": resolved,
                "label": str(label or "").strip()[:LABEL_MAX_LEN] or default_label_for(resolved),
                "excludes": [],
                "addedAt": int(time.time()),
            }
            data["nextRootId"] = root_id + 1
            data["roots"].append(root)
            self._save_locked(data)

        decky.logger.info("filewatcher: now watching %s (root %d)", resolved, root["id"])
        return {"ok": True, "root": root}

    def _mint_root_id(self, data) -> int:
        """The next id to hand out, floored by what the map has already spent.

        root_id is the only thing tying the roots list to the map — a row in
        files records no path — and the counter that mints it lives in the JSON
        while the map lives in the database. So any reset of that one file drops
        the counter back to 1 with every map row still sitting there, and the
        next directory added inherits a dead root's hashes: the old root's files
        report Missing, and any name the two folders happen to share reports
        Replaced.

        The reset that matters isn't corruption, it's a version bump.
        _load_locked falls back to an empty config whenever the stored version
        doesn't match CURRENT_SCHEMA_VERSION, and bumping that constant is a
        one-line change that looks entirely safe on a pre-1.0 project where
        migrations are free.

        Reading the floor out of the map is what closes it, because the map is
        the thing that survives. Ids only ever go up, nothing is deleted, and the
        rows an old root leaves behind are inert — sweep_missing only runs for
        roots in the current list, so they are never walked and never reported.
        """
        with self._db() as conn:
            spent = conn.execute("SELECT MAX(root_id) FROM files").fetchone()[0]
        return max(to_int(data["nextRootId"], 1), to_int(spent, 0) + 1, 1)

    def remove_root(self, root_id) -> dict:
        """Drop a root and every hash recorded under it.

        Pruning the map is not optional. Rows left behind are unreachable by any
        future walk, which means they'd report as Missing forever and there
        would be nothing on the page to remove them with.
        """
        wanted = to_int(root_id, 0)
        with self._lock:
            data = self._load_locked()
            remaining = [root for root in data["roots"] if root["id"] != wanted]
            if len(remaining) == len(data["roots"]):
                return {"ok": False, "error": "not_found"}
            data["roots"] = remaining
            self._save_locked(data)
            self._forget_root_rows(wanted)

        decky.logger.info("filewatcher: stopped watching root %d", wanted)
        return {"ok": True}

    def update_root(self, root_id, label=None, excludes=None) -> dict:
        """Rename a root and/or replace its exclusion list.

        A newly excluded pattern prunes the map in the same operation, for the
        same reason removing a root does: 500 mapped .txt files that the walk
        will never visit again are 500 permanent Missing findings otherwise.
        """
        wanted = to_int(root_id, 0)
        with self._lock:
            data = self._load_locked()
            target = None
            for root in data["roots"]:
                if root["id"] == wanted:
                    target = root
                    break
            if target is None:
                return {"ok": False, "error": "not_found"}

            if label is not None:
                cleaned = str(label).strip()[:LABEL_MAX_LEN]
                target["label"] = cleaned or default_label_for(target["path"])

            pruned = 0
            if excludes is not None:
                patterns = []
                for pattern in list(excludes)[:MAX_EXCLUDES]:
                    cleaned = clean_exclude(pattern)
                    if cleaned and cleaned not in patterns:
                        patterns.append(cleaned)
                target["excludes"] = patterns
                pruned = self._prune_excluded_rows(wanted, patterns)

            self._save_locked(data)

        if pruned:
            decky.logger.info(
                "filewatcher: exclusions on root %d dropped %d mapped files", wanted, pruned
            )
        return {"ok": True, "root": target}

    def forget_root_hashes(self, root_id) -> dict:
        """Drop one root's recorded hashes without unwatching it.

        The per-root half of "Forget all recorded hashes", so a failing NAS
        doesn't force nuking the map for every drive in the house. The next pass
        re-baselines this root and reports it as such.

        Reports what's left across every root, because forgetting the last of
        them has to take "Last verified" with it the way the all-roots tier
        does. Counted here rather than by the caller so it happens under the
        same lock as the delete.
        """
        wanted = to_int(root_id, 0)
        with self._lock:
            removed = self._forget_root_rows(wanted)
            remaining = self._mapped_row_count()
        decky.logger.info(
            "filewatcher: forgot %d hashes for root %d (%d left across all roots)",
            removed, wanted, remaining,
        )
        return {"ok": True, "removed": removed, "remaining": remaining}

    def _mapped_row_count(self) -> int:
        with self._db() as conn:
            row = conn.execute("SELECT COUNT(*) FROM files").fetchone()
        return int(row[0]) if row else 0

    def _forget_root_rows(self, root_id: int) -> int:
        with self._db() as conn:
            cursor = conn.execute("DELETE FROM files WHERE root_id = ?", (root_id,))
            removed = cursor.rowcount or 0
            conn.execute("DELETE FROM findings WHERE root_id = ?", (root_id,))
            conn.execute("DELETE FROM findings_pending WHERE root_id = ?", (root_id,))
            conn.execute("DELETE FROM pass_queue WHERE root_id = ?", (root_id,))
            conn.execute("DELETE FROM skipped_roots WHERE root_id = ?", (root_id,))
            conn.execute("DELETE FROM skipped_roots_pending WHERE root_id = ?", (root_id,))
            conn.execute("DELETE FROM excluded WHERE root_id = ?", (root_id,))
            conn.execute("DELETE FROM excluded_pending WHERE root_id = ?", (root_id,))
            conn.commit()
        return removed

    def _prune_excluded_rows(self, root_id: int, patterns) -> int:
        if not patterns:
            return 0
        doomed = []
        with self._db() as conn:
            for (rel_path,) in conn.execute(
                "SELECT rel_path FROM files WHERE root_id = ?", (root_id,)
            ):
                if path_excluded(rel_path, patterns):
                    doomed.append((root_id, rel_path))
            if doomed:
                conn.executemany(
                    "DELETE FROM files WHERE root_id = ? AND rel_path = ?", doomed
                )
                conn.executemany(
                    "DELETE FROM findings WHERE root_id = ? AND rel_path = ?", doomed
                )
                conn.commit()
        return len(doomed)

    def set_schedule(self, *, enabled, every_weeks, weekday, hour, minute) -> dict:
        with self._lock:
            data = self._load_locked()
            previous = data["schedule"]
            schedule = self._clean_schedule({
                "enabled": enabled,
                "everyWeeks": every_weeks,
                "weekday": weekday,
                "hour": hour,
                "minute": minute,
                "anchorAt": previous["anchorAt"],
            })
            if schedule["enabled"] and not schedule["anchorAt"]:
                schedule["anchorAt"] = int(time.time())
            data["schedule"] = schedule
            self._save_locked(data)
        return {"ok": True, "schedule": schedule}

    def set_window(self, *, enabled, block_from, block_to) -> dict:
        with self._lock:
            data = self._load_locked()
            window = self._clean_window({
                "enabled": enabled,
                "blockFrom": block_from,
                "blockTo": block_to,
            })
            data["window"] = window
            self._save_locked(data)
        return {"ok": True, "window": window}

    def set_clocks(self, *, last_completed_at=None, last_scheduled_at=None, next_due_at=None) -> dict:
        """Move any of the three clocks.

        They're separate because they answer different questions. A cancel
        advances nextDueAt so the consumed slot doesn't retry immediately, and
        leaves lastCompletedAt alone so the page keeps reporting the older,
        honest verification date — a cancel must never buy false confidence.
        lastScheduledAt is the third because only a scheduled run is allowed to
        suppress the next scheduled run; a manual Verify Now moving it would
        make the schedule unpredictable, which is the one thing a schedule has
        to be. It holds when that run *began*, not when it finished — a slow
        pass would otherwise push the guard past its own next slot and halve the
        cadence. See _finish in the service.
        """
        with self._lock:
            data = self._load_locked()
            if last_completed_at is not None:
                data["lastCompletedAt"] = max(0, to_int(last_completed_at, 0))
            if last_scheduled_at is not None:
                data["lastScheduledAt"] = max(0, to_int(last_scheduled_at, 0))
            if next_due_at is not None:
                data["nextDueAt"] = max(0, to_int(next_due_at, 0))
            self._save_locked(data)
        return {"ok": True, "lastCompletedAt": data["lastCompletedAt"], "nextDueAt": data["nextDueAt"]}

    def set_start_dir(self, path) -> None:
        """Remember where the folder picker was last pointed.

        Written from the picker's answer rather than from the root list, so a
        directory that got refused (an overlap) or later removed still leaves
        the picker where the user was working.
        """
        cleaned = str(path or "").strip()
        if not cleaned:
            return
        with self._lock:
            data = self._load_locked()
            if data["startDir"] == cleaned:
                return
            data["startDir"] = cleaned
            self._save_locked(data)

    def bucket_counts(self) -> dict:
        """One row per bucket that has anything in it, plus the skipped roots.

        A GROUP BY rather than seven counts, and never a list — Added can hold
        forty thousand rows on a first run and the page only wants the number.
        """
        counts = {bucket: 0 for bucket in FINDING_BUCKETS}
        with self._db() as conn:
            for bucket, total in conn.execute(
                "SELECT bucket, COUNT(*) FROM findings GROUP BY bucket"
            ):
                if bucket in counts:
                    counts[bucket] = total
            (skipped,) = conn.execute("SELECT COUNT(*) FROM skipped_roots").fetchone()
        counts["skipped"] = skipped
        return counts

    def has_report(self) -> bool:
        with self._db() as conn:
            (rows,) = conn.execute("SELECT COUNT(*) FROM findings").fetchone()
            if rows:
                return True
            (skipped,) = conn.execute("SELECT COUNT(*) FROM skipped_roots").fetchone()
        return bool(skipped)


    def skipped_rows(self) -> list:
        with self._db() as conn:
            return [
                {
                    "rootId": root_id,
                    "reason": reason,
                    "fileCount": file_count,
                    "lastOkAt": last_ok_at,
                }
                for root_id, reason, file_count, last_ok_at in conn.execute(
                    "SELECT root_id, reason, file_count, last_ok_at FROM skipped_roots"
                )
            ]

    def root_stats(self) -> dict:
        """Mapped file count and newest verification stamp, per root.

        What the directory cards print under the path. Two aggregates off one
        pass over the index rather than a query per card.
        """
        stats = {}
        with self._db() as conn:
            for root_id, files, verified in conn.execute(
                "SELECT root_id, COUNT(*), MAX(last_verified) FROM files GROUP BY root_id"
            ):
                stats[str(root_id)] = {
                    "files": files,
                    "lastVerified": to_int(verified, 0),
                }
        return stats

    def findings_roots(self, bucket: str) -> list:
        """Which roots this bucket has findings in, with counts.

        Drives the conditional category step in the findings modal: one root
        means no step at all, several means a list of exactly the roots that
        have something in them. A category with zero rows is a dead end the user
        only discovers by pressing it, so it never gets listed.
        """
        with self._db() as conn:
            return [
                {"rootId": root_id, "count": total}
                for root_id, total in conn.execute(
                    "SELECT root_id, COUNT(*) FROM findings WHERE bucket = ? GROUP BY root_id",
                    (str(bucket or ""),),
                )
            ]

    def findings_page(self, bucket: str, limit: int, root_id=None,
                      after_root_id=0, after_rel_path="") -> list:
        """One page of rows, seeked to rather than counted to.

        Paged because Added really can be forty thousand rows. Keyset rather
        than OFFSET, for two reasons. Dismissing a row deletes it out from under
        an in-flight page walk, and every later offset then shifts by one — so
        the next page silently skips a row. And the seek rides the
        (bucket, root_id, rel_path) index straight to the right place instead of
        walking and discarding everything before it, which is what OFFSET does.

        The ordering is load-bearing rather than cosmetic: without it SQLite is
        free to hand back a different order per query, and rows would appear
        twice or not at all as the user scrolled.
        """
        want_root = to_int(root_id, 0) if root_id is not None else 0
        query = f"SELECT {_FINDING_COLUMNS} FROM findings WHERE bucket = ?"
        args = [str(bucket or "")]
        if want_root:
            query += " AND root_id = ?"
            args.append(want_root)
        query += " AND (root_id, rel_path) > (?, ?) ORDER BY root_id, rel_path LIMIT ?"
        args.extend([
            to_int(after_root_id, 0),
            str(after_rel_path or ""),
            max(1, to_int(limit, 50)),
        ])

        with self._db() as conn:
            return [_finding_row(row) for row in conn.execute(query, args)]

    def dismiss_finding(self, root_id, rel_path: str, action: str) -> dict:
        """Apply one row's action and re-file the row, in one transaction.

        Immediate rather than deferred so the bucket counts behind the modal are
        right the moment the user backs out of it, and so a QAM close and reopen
        can't resurrect what they just dealt with.

        Accepting doesn't drop the row, it moves it to Verified. The new hash is
        now the known-good one, which is exactly what a Verified row says, and a
        row that vanished from every bucket read as the dismissal having missed —
        the user had to run a whole pass to see it land somewhere. Forgetting
        does drop it: the file is gone or has stopped being watched, so there is
        nothing left to have a verdict about.
        """
        wanted = to_int(root_id, 0)
        path = str(rel_path or "")
        verb = str(action or "").strip()
        if verb not in (ACTION_ACCEPT, ACTION_FORGET):
            return {"ok": False, "error": "bad_action"}

        with self._lock, self._db() as conn:
            row = conn.execute(
                f"SELECT {_FINDING_COLUMNS} FROM findings WHERE root_id = ? AND rel_path = ?",
                (wanted, path),
            ).fetchone()
            if row is None:
                return {"ok": False, "error": "not_found"}

            finding = _finding_row(row)
            if verb == ACTION_ACCEPT:
                if not finding["newSha"]:
                    return {"ok": False, "error": "nothing_to_accept"}
                now = int(time.time())
                conn.execute(
                    """
                    INSERT INTO files (root_id, rel_path, size, mtime_ns, sha256, first_seen, last_verified)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (root_id, rel_path) DO UPDATE SET
                        size = excluded.size,
                        mtime_ns = excluded.mtime_ns,
                        sha256 = excluded.sha256,
                        last_verified = excluded.last_verified
                    """,
                    (
                        wanted,
                        path,
                        finding["newSize"] or 0,
                        finding["newMtimeNs"] or 0,
                        finding["newSha"],
                        now,
                        now,
                    ),
                )
                conn.execute(
                    """
                    UPDATE findings
                    SET bucket = ?, old_sha = new_sha, old_size = new_size,
                        old_mtime_ns = new_mtime_ns
                    WHERE root_id = ? AND rel_path = ?
                    """,
                    (BUCKET_VERIFIED, wanted, path),
                )
            else:
                conn.execute(
                    "DELETE FROM files WHERE root_id = ? AND rel_path = ?", (wanted, path)
                )
                conn.execute(
                    "DELETE FROM findings WHERE root_id = ? AND rel_path = ?", (wanted, path)
                )
            conn.commit()

        return {"ok": True}

    def begin_pass(self, origin: str) -> int:
        """Clear anything a previous attempt left behind and open a new pass.

        Returns the pass's stamp, which is what every map row it verifies gets
        written with — so "verified by this pass" is an equality test rather
        than a range, and complete_pass can derive the Verified bucket from the
        map exactly.

        The stamp is a wall-clock second forced to be strictly greater than any
        already in the map. Two passes really can begin inside one second (finish
        one, press Verify Now), and a plain timestamp would then make the
        previous pass's rows indistinguishable from this one's — which reads as
        the whole library verifying when it didn't.
        """
        now = int(time.time())
        with self._db() as conn:
            highest = conn.execute("SELECT COALESCE(MAX(last_verified), 0) FROM files").fetchone()
            now = max(now, to_int(highest[0], 0) + 1)
            conn.execute("DELETE FROM pass_queue")
            conn.execute("DELETE FROM findings_pending")
            conn.execute("DELETE FROM skipped_roots_pending")
            conn.execute("DELETE FROM excluded_pending")
            conn.execute("DELETE FROM pass_state")
            conn.execute(
                """
                INSERT INTO pass_state
                    (id, origin, phase, started_at, total_files, total_bytes, done_files, done_bytes)
                VALUES (1, ?, 'enumerate', ?, 0, 0, 0, 0)
                """,
                (str(origin or "manual"), now),
            )
            conn.commit()
        return now

    def load_pass_state(self):
        """The pass in flight, or None. Read once at plugin load.

        This is what lets a pass survive a reload: the queue on disk says
        exactly which files still need hashing, so a resume is exact rather
        than a re-walk that starts over.
        """
        with self._db() as conn:
            row = conn.execute(
                """
                SELECT origin, phase, started_at, total_files, total_bytes, done_files, done_bytes
                FROM pass_state WHERE id = 1
                """
            ).fetchone()
        if row is None:
            return None
        return {
            "origin": row[0],
            "phase": row[1],
            "startedAt": row[2],
            "totalFiles": row[3],
            "totalBytes": row[4],
            "doneFiles": row[5],
            "doneBytes": row[6],
        }

    def write_excluded(self, rows) -> None:
        """Append part of the ignored list. Batched by the walk, same as below.

        Lands in the pending table, so a walk that dies partway through leaves
        the live list on its previous answer rather than a half-populated one
        that reads as complete.
        """
        batch = list(rows)
        if not batch:
            return
        with self._db() as conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO excluded_pending (root_id, rel_path, is_dir, rule)
                VALUES (?, ?, ?, ?)
                """,
                batch,
            )
            conn.commit()

    def clear_excluded_pending(self, root_id) -> None:
        """Drop a root's half-written ignored rows before its walk restarts.

        A pass parked during enumeration resumes by walking every root again
        from the top. Without this, leftovers from the interrupted walk would be
        promoted alongside the new ones, so a file deleted in between would come
        back as a row describing a path that isn't there any more.
        """
        with self._db() as conn:
            conn.execute("DELETE FROM excluded_pending WHERE root_id = ?", (to_int(root_id, 0),))
            conn.commit()

    def promote_excluded(self, root_id) -> None:
        """Swap one root's pending rows into the live list.

        Per root at walk completion rather than per pass, unlike findings. The
        ignored list is settled the moment the walk of that root finishes — it
        has nothing to do with hashing — so waiting for complete_pass() would
        mean cancelling a long pass threw away an answer that was already
        correct. That is the case this whole feature exists to serve.
        """
        wanted = to_int(root_id, 0)
        with self._db() as conn:
            conn.execute("DELETE FROM excluded WHERE root_id = ?", (wanted,))
            conn.execute(
                """
                INSERT OR REPLACE INTO excluded (root_id, rel_path, is_dir, rule)
                SELECT root_id, rel_path, is_dir, rule FROM excluded_pending WHERE root_id = ?
                """,
                (wanted,),
            )
            conn.execute("DELETE FROM excluded_pending WHERE root_id = ?", (wanted,))
            conn.commit()

    def excluded_roots(self) -> list:
        """Which roots ignored something, split into folders and files.

        Folders and files are counted apart because a pruned folder stands for
        its whole subtree and says nothing about how much is in it. Presenting
        them as one number would claim an inventory this cannot give.
        """
        totals = {}
        with self._db() as conn:
            for root_id, is_dir, total in conn.execute(
                "SELECT root_id, is_dir, COUNT(*) FROM excluded GROUP BY root_id, is_dir"
            ):
                entry = totals.setdefault(root_id, {"rootId": root_id, "dirs": 0, "files": 0})
                entry["dirs" if is_dir else "files"] = total
        rows = list(totals.values())
        for row in rows:
            row["count"] = row["dirs"] + row["files"]
        return rows

    def excluded_total(self) -> int:
        with self._db() as conn:
            (total,) = conn.execute("SELECT COUNT(*) FROM excluded").fetchone()
        return total

    def excluded_page(self, limit: int, root_id=None,
                      after_root_id=0, after_rel_path="") -> list:
        """One page of ignored paths, seeked to the same way findings_page is.

        Keyset rather than OFFSET for the index-seek half of that method's
        reasoning; nothing deletes rows out from under this one. The two pagers
        share a loop on the frontend, so they have no room to disagree anyway.
        """
        want_root = to_int(root_id, 0) if root_id is not None else 0
        query = (
            "SELECT root_id, rel_path, is_dir, rule FROM excluded "
            "WHERE (root_id, rel_path) > (?, ?)"
        )
        args = [to_int(after_root_id, 0), str(after_rel_path or "")]
        if want_root:
            query += " AND root_id = ?"
            args.append(want_root)
        query += " ORDER BY root_id, rel_path LIMIT ?"
        args.append(max(1, to_int(limit, 50)))
        with self._db() as conn:
            return [
                {
                    "rootId": row[0],
                    "relPath": row[1],
                    "isDir": bool(row[2]),
                    "rule": row[3],
                }
                for row in conn.execute(query, args)
            ]

    def write_queue(self, rows) -> None:
        """Append part of the work list. Called once per root by the walk."""
        batch = list(rows)
        if not batch:
            return
        with self._db() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO pass_queue (root_id, rel_path, size, done) VALUES (?, ?, ?, 0)",
                batch,
            )
            conn.commit()

    def finish_enumerate(self) -> dict:
        """Close the walk and settle the denominator off the queue itself.

        Counted here rather than tallied by the walk so the number the bar
        divides by is the number of rows that actually landed, however many
        duplicates or excluded files the walk dropped along the way.
        """
        with self._db() as conn:
            total_files, total_bytes = conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM pass_queue"
            ).fetchone()
            conn.execute(
                "UPDATE pass_state SET phase = 'hash', total_files = ?, total_bytes = ? WHERE id = 1",
                (total_files, total_bytes),
            )
            conn.commit()
        return {"totalFiles": total_files, "totalBytes": total_bytes}

    def queue_chunk(self, limit: int) -> list:
        """The next slice of files still needing a hash."""
        with self._db() as conn:
            return [
                {"rootId": root_id, "relPath": rel_path, "size": size}
                for root_id, rel_path, size in conn.execute(
                    "SELECT root_id, rel_path, size FROM pass_queue WHERE done = 0 "
                    "ORDER BY root_id, rel_path LIMIT ?",
                    (max(1, to_int(limit, 256)),),
                )
            ]

    def drop_root_from_queue(self, root_id) -> dict:
        """Take a skipped root's remaining work out of the pass.

        Its rows are deleted rather than marked done, and the totals come back
        off the queue afterwards, so the progress bar's denominator becomes the
        work that is actually going to happen instead of a target it can never
        reach. The new totals are returned because the page reads its own copy
        of them rather than the database.
        """
        wanted = to_int(root_id, 0)
        with self._db() as conn:
            conn.execute("DELETE FROM pass_queue WHERE root_id = ? AND done = 0", (wanted,))
            total_files, total_bytes = conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM pass_queue"
            ).fetchone()
            conn.execute(
                "UPDATE pass_state SET total_files = ?, total_bytes = ? WHERE id = 1",
                (total_files, total_bytes),
            )
            conn.commit()
        return {"totalFiles": total_files, "totalBytes": total_bytes}

    def pending_skipped_rows(self) -> list:
        with self._db() as conn:
            return [
                {"rootId": root_id, "reason": reason}
                for root_id, reason in conn.execute(
                    "SELECT root_id, reason FROM skipped_roots_pending"
                )
            ]

    def map_for_root(self, root_id: int) -> dict:
        """This root's recorded hashes, keyed by relative path.

        The caller holds this for the whole pass so the compare costs nothing
        per file. Forty thousand rows is a few megabytes, which is a far better
        trade than a SELECT per file on an SD card — or than re-reading the
        whole map once per chunk, which is what it used to do.
        """
        mapped = {}
        with self._db() as conn:
            for rel_path, size, mtime_ns, sha256 in conn.execute(
                "SELECT rel_path, size, mtime_ns, sha256 FROM files WHERE root_id = ?",
                (to_int(root_id, 0),),
            ):
                mapped[rel_path] = (size, mtime_ns, sha256)
        return mapped

    def checkpoint(self, *, mapped, findings, done_keys, done_bytes) -> None:
        """Commit one batch of hashing work.

        Everything the batch produced lands in a single transaction: the map
        rows it wrote, the verdicts it wrote, and the queue rows it can stop
        asking about. A power cut costs whatever hasn't been checkpointed yet,
        which is bounded by the caller at a few seconds of hashing.

        ``mapped`` carries the two verdicts that earn a place in the map — a
        file that verified, and a file that was adopted as Added. Corrupted,
        Replaced and Unreadable deliberately leave their existing row alone,
        stamp and all: nothing about them was verified, and moving last_verified
        would say otherwise.
        """
        if not mapped and not findings and not done_keys and not done_bytes:
            return
        with self._db() as conn:
            if mapped:
                conn.executemany(
                    """
                    INSERT INTO files (root_id, rel_path, size, mtime_ns, sha256, first_seen, last_verified)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (root_id, rel_path) DO UPDATE SET
                        size = excluded.size,
                        mtime_ns = excluded.mtime_ns,
                        sha256 = excluded.sha256,
                        last_verified = excluded.last_verified
                    """,
                    mapped,
                )
            if findings:
                conn.executemany(
                    f"INSERT OR REPLACE INTO findings_pending ({_FINDING_COLUMNS}) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    findings,
                )
            if done_keys:
                conn.executemany(
                    "UPDATE pass_queue SET done = 1 WHERE root_id = ? AND rel_path = ?",
                    done_keys,
                )
            conn.execute(
                "UPDATE pass_state SET done_files = done_files + ?, done_bytes = done_bytes + ? WHERE id = 1",
                (len(done_keys), to_int(done_bytes, 0)),
            )
            conn.commit()

    def record_skipped_root(self, root_id, reason: str, file_count: int, last_ok_at: int) -> None:
        """Park a root the pass couldn't reach, and undo what it already said.

        The rollback is the part that gets forgotten. A NAS that drops mid-pass
        fails its first few reads before anything notices the mount is gone, and
        those already landed as Unreadable — the loudest bucket in the feature,
        and the one with no way to dismiss a row. Twenty thousand "hard media
        failure" rows because an access point rebooted is the worst thing this
        feature could do.

        Missing comes back too, and for the same reason: an unmounted share
        answers ENOENT for every file under it, so the reads that fail before
        the guard trips look exactly like deletions. sweep_missing runs later,
        in _finish, and skips these roots entirely — so anything sitting in this
        bucket for this root right now came from the hash phase and is wrong.
        """
        wanted = to_int(root_id, 0)
        with self._db() as conn:
            conn.execute(
                "DELETE FROM findings_pending WHERE root_id = ? AND bucket IN (?, ?)",
                (wanted, BUCKET_UNREADABLE, BUCKET_MISSING),
            )
            conn.execute(
                "INSERT OR REPLACE INTO skipped_roots_pending (root_id, reason, file_count, last_ok_at) "
                "VALUES (?, ?, ?, ?)",
                (wanted, str(reason or "unreachable"), to_int(file_count, 0), to_int(last_ok_at, 0)),
            )
            conn.commit()

    def sweep_missing(self, root_ids) -> int:
        """Anything mapped under these roots that the walk never reached.

        Runs against pass_queue rather than against a set the walk carried, so
        the answer is exactly "in the map, not in the work list". Only roots
        that completed are passed in: fabricating twenty thousand Missing rows
        because a share was down is the same failure as the Unreadable one, and
        the guard is that a skipped root never reaches this list.
        """
        wanted = [to_int(root_id, 0) for root_id in root_ids]
        if not wanted:
            return 0
        total = 0
        with self._db() as conn:
            for root_id in wanted:
                cursor = conn.execute(
                    f"""
                    INSERT OR REPLACE INTO findings_pending ({_FINDING_COLUMNS})
                    SELECT f.root_id, f.rel_path, ?, f.sha256, NULL, f.size, NULL, f.mtime_ns, NULL
                    FROM files f
                    WHERE f.root_id = ?
                      AND NOT EXISTS (
                          SELECT 1 FROM pass_queue q
                          WHERE q.root_id = f.root_id AND q.rel_path = f.rel_path
                      )
                    """,
                    (BUCKET_MISSING, root_id),
                )
                total += cursor.rowcount or 0
            conn.commit()
        return total

    def complete_pass(self) -> dict:
        """Swap the pending report in and clear the pass, in one transaction.

        This swap is what makes an interrupted pass leave the previous report
        whole rather than a truncated list that looks complete. A cancel never
        reaches here, so findings_pending is simply dropped and the older answer
        survives — and the work isn't lost either, since every verified row was
        already committed into the map with a fresh stamp as the pass went.

        The Verified rows are built here rather than carried through the pass.
        A verified file is definitionally one this pass stamped and had nothing
        else to say about, so it can be derived from the map at the end instead
        of written into findings_pending inside every checkpoint, copied across
        here, and deleted again. That mattered: a Verified row is the fattest
        one in the schema (it carries a hash twice) and on a healthy library it
        is nearly every row, so it was the single biggest thing riding along in
        each fsync'd commit — to say that nothing was wrong.
        """
        with self._db() as conn:
            row = conn.execute("SELECT started_at FROM pass_state WHERE id = 1").fetchone()
            started_at = to_int(row[0], 0) if row else 0

            conn.execute("DELETE FROM findings")
            conn.execute(
                f"INSERT INTO findings ({_FINDING_COLUMNS}) "
                f"SELECT {_FINDING_COLUMNS} FROM findings_pending"
            )
            conn.execute(
                f"""
                INSERT INTO findings ({_FINDING_COLUMNS})
                SELECT f.root_id, f.rel_path, ?, f.sha256, f.sha256,
                       f.size, f.size, f.mtime_ns, f.mtime_ns
                FROM files f
                WHERE f.last_verified = ?
                  AND NOT EXISTS (
                      SELECT 1 FROM findings v
                      WHERE v.root_id = f.root_id AND v.rel_path = f.rel_path
                  )
                """,
                (BUCKET_VERIFIED, started_at),
            )
            conn.execute("DELETE FROM skipped_roots")
            conn.execute(
                "INSERT INTO skipped_roots (root_id, reason, file_count, last_ok_at) "
                "SELECT root_id, reason, file_count, last_ok_at FROM skipped_roots_pending"
            )
            counts = {}
            for bucket, total in conn.execute(
                "SELECT bucket, COUNT(*) FROM findings GROUP BY bucket"
            ):
                counts[bucket] = total
            (skipped,) = conn.execute("SELECT COUNT(*) FROM skipped_roots").fetchone()
            conn.execute("DELETE FROM findings_pending")
            conn.execute("DELETE FROM skipped_roots_pending")
            conn.execute("DELETE FROM pass_queue")
            conn.execute("DELETE FROM pass_state")
            conn.commit()
        counts["skipped"] = skipped
        return counts

    def abandon_pass(self) -> None:
        """Drop the pass in flight without touching the last report."""
        with self._db() as conn:
            conn.execute("DELETE FROM findings_pending")
            conn.execute("DELETE FROM skipped_roots_pending")
            conn.execute("DELETE FROM excluded_pending")
            conn.execute("DELETE FROM pass_queue")
            conn.execute("DELETE FROM pass_state")
            conn.commit()

    def clear_report(self) -> list:
        with self._db() as conn:
            conn.execute("DELETE FROM findings")
            conn.execute("DELETE FROM skipped_roots")
            conn.execute("DELETE FROM excluded")
            conn.execute("DELETE FROM excluded_pending")
            conn.commit()
        return ["file_watcher findings"]

    def clear_map(self) -> list:
        """Forget every recorded hash, keeping the roots and their exclusions.

        The configuration deliberately survives. One mis-press shouldn't destroy
        a carefully tuned set of exclusions, and the feature is still able to
        re-baseline on the next run. What it does cost is the corruption
        history, which is the consequence the wording has to make obvious.
        """
        with self._db() as conn:
            conn.execute("DELETE FROM files")
            conn.execute("DELETE FROM findings")
            conn.execute("DELETE FROM findings_pending")
            conn.execute("DELETE FROM skipped_roots")
            conn.execute("DELETE FROM skipped_roots_pending")
            conn.execute("DELETE FROM excluded")
            conn.execute("DELETE FROM excluded_pending")
            conn.execute("DELETE FROM pass_queue")
            conn.execute("DELETE FROM pass_state")
            conn.commit()
        return ["file_watcher.db"]

    def clear_everything(self) -> list:
        """The database and the configuration both. Nothing survives this."""
        removed = []
        with self._lock:
            base = self.db_path()
            for path in (base, Path(str(base) + "-wal"), Path(str(base) + "-shm"), self.config_path()):
                try:
                    path.unlink()
                    removed.append(path.name)
                except (FileNotFoundError, OSError):
                    pass
            self._schema_ready = False
            self._corruption_logged = False
        return removed


def default_label_for(path: str) -> str:
    """The watched folder's basename, which is what the cards and the findings
    modal's category rows are named with.

    Not cosmetic: a bare default that reads as a system name ("wii") is worth
    more than an empty field, because a user who curates per-system roots ends
    up with a category list that reads exactly like Cheevo Check's for free.
    """
    name = os.path.basename(str(path or "").rstrip("/"))
    return (name or str(path or "")).strip()[:LABEL_MAX_LEN]


def clean_exclude(pattern) -> str:
    if not isinstance(pattern, str):
        return ""
    return pattern.strip().strip("/")[:EXCLUDE_MAX_LEN]


def _clean_clock(raw, hour_default: int, minute_default: int) -> list:
    if not isinstance(raw, (list, tuple)) or len(raw) != 2:
        return [hour_default, minute_default]
    hour = to_int(raw[0], hour_default)
    minute = to_int(raw[1], minute_default)
    return [
        hour if 0 <= hour <= 23 else hour_default,
        minute if 0 <= minute <= 59 else minute_default,
    ]


def _finding_row(row) -> dict:
    return {
        "rootId": row[0],
        "relPath": row[1],
        "bucket": row[2],
        "oldSha": row[3],
        "newSha": row[4],
        "oldSize": row[5],
        "newSize": row[6],
        "oldMtimeNs": row[7],
        "newMtimeNs": row[8],
    }
