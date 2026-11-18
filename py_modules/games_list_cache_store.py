from pathlib import Path

import re
import threading
import time

from utils import ensure_dir, load_json_file, save_json_file, to_int


_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")

_PATCH_CAP = 2000
_PATCH_COUNTS = ("numAwarded", "numAwardedHardcore", "maxPossible")
_PATCH_DETAILS = ("title", "consoleId", "consoleName", "imageIcon")
_AWARD_RANK = {"beaten-softcore": 1, "beaten-hardcore": 2, "completed": 3, "mastered": 4}


def _award_rank(kind) -> int:
    return _AWARD_RANK.get(str(kind or "").strip().lower(), 0)


def _covers(row: dict, entry: dict) -> bool:
    if to_int(row.get("numAwarded"), 0) < to_int(entry.get("numAwarded"), 0):
        return False
    if to_int(row.get("numAwardedHardcore"), 0) < to_int(entry.get("numAwardedHardcore"), 0):
        return False
    return _award_rank(row.get("highestAwardKind")) >= _award_rank(entry.get("highestAwardKind"))


def _raise_row(row: dict, entry: dict) -> None:
    for field in _PATCH_COUNTS:
        row[field] = max(to_int(row.get(field), 0), to_int(entry.get(field), 0))
    if _award_rank(entry.get("highestAwardKind")) > _award_rank(row.get("highestAwardKind")):
        row["highestAwardKind"] = entry["highestAwardKind"]
        row["highestAwardDate"] = entry.get("highestAwardDate")


LOADED_KEPT = 4


def _stat_key(path: Path):
    try:
        st = path.stat()
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size, st.st_ino)


class GamesListCacheStore:
    """Global cache of friend All-Games payloads, one JSON file per ULID.

    Storage layout: ``<store_dir>/<ULID>.json``, each holding ``{schema,
    payload, cachedAt}``. Unlike the per-account stores this one is shared
    across every plugin account on purpose: a friend's library is theirs rather
    than the viewer's, so two accounts that both follow the same person reuse
    one file and it stays warm across an account switch. That is also why there
    is no ``repoint``, since the directory never moves and adding one would be
    dead scaffolding. It is deliberately left off ``_apply_user_scope``.

    Threading mirrors PlayersNearYouStore: every method that touches a file
    takes that ULID's lock, and the master lock only guards the lock dict, the
    clear walk and the generation. The one extra wrinkle is ``_generation``, a
    monotonic counter bumped on every clear. A full fetch can run for several
    seconds, so a clear can land mid-fetch; the fetch captures the generation
    up front and ``save`` drops the write if it moved, so a clear is never
    silently undone.
    """

    def __init__(self, *, store_dir: Path):
        self._store_dir = Path(store_dir)
        ensure_dir(self._store_dir)

        self._master_lock = threading.Lock()
        self._key_locks: dict[str, threading.Lock] = {}
        self._loaded: dict[str, tuple] = {}

        self._generation = 0

        self._last_patched: dict[tuple, tuple] = {}

    def _key(self, ulid) -> str | None:
        key = str(ulid or "").strip().upper()
        return key if _ULID_RE.match(key) else None

    def _path_for_key(self, key: str) -> Path:
        return self._store_dir / f"{key}.json"

    def _patch_path_for_key(self, key: str) -> Path:
        return self._store_dir / "patches" / f"{key}.json"

    def _load_patches(self, key: str) -> dict:
        data = load_json_file(self._patch_path_for_key(key), {})
        if not isinstance(data, dict) or data.get("schemaVersion") != 1 or not isinstance(data.get("games"), dict):
            return {}
        return {gid: entry for gid, entry in data["games"].items() if isinstance(entry, dict)}

    def _save_patches(self, key: str, games: dict) -> None:
        path = self._patch_path_for_key(key)
        if not games:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            return
        ensure_dir(path.parent)
        save_json_file(path, {"schemaVersion": 1, "games": games}, compact=True)

    def _lock_for_key(self, key: str) -> threading.Lock:
        with self._master_lock:
            lock = self._key_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._key_locks[key] = lock
            return lock

    def current_generation(self) -> int:
        with self._master_lock:
            return self._generation

    def snapshot_active_keys(self) -> set:
        with self._master_lock:
            return set(self._key_locks)

    def load(self, ulid, max_age_seconds) -> dict:
        key = self._key(ulid)
        if not key:
            return {"hit": False}
        with self._lock_for_key(key):
            found = self._read(key)
        if found is None:
            return {"hit": False}
        payload, cached_at = found
        if max_age_seconds is not None and (
            cached_at <= 0 or (int(time.time()) - cached_at) > max(1, int(max_age_seconds))
        ):
            return {"hit": False}
        return {"hit": True, "payload": payload, "cachedAt": cached_at}

    def _stamp(self, key: str) -> tuple:
        return (_stat_key(self._path_for_key(key)), _stat_key(self._patch_path_for_key(key)))

    def _read(self, key: str):
        stamp = self._stamp(key)
        held = self._loaded.get(key)
        if held is not None and held[0] == stamp:
            return held[1]
        data = load_json_file(self._path_for_key(key), {})
        if not isinstance(data, dict) or "payload" not in data:
            if self._patch_path_for_key(key).exists():
                self._save_patches(key, {})
            found = None
        else:
            payload = data["payload"]
            patches = self._load_patches(key)
            if patches and isinstance(payload, dict) and isinstance(payload.get("results"), list):
                self._merge_patches(key, payload, patches)
            found = (payload, to_int(data.get("cachedAt", 0), 0))
        with self._master_lock:
            self._loaded.pop(key, None)
            if found is None:
                return None
            while len(self._loaded) >= LOADED_KEPT:
                self._loaded.pop(next(iter(self._loaded)))
            self._loaded[key] = (stamp, found)
        return found

    def _merge_patches(self, key: str, payload: dict, patches: dict) -> None:
        rows = {}
        for row in payload["results"]:
            if isinstance(row, dict):
                rows[str(to_int(row.get("gameId"), 0))] = row
        covered = []
        added = 0
        for gid, entry in patches.items():
            row = rows.get(gid)
            if row is None:
                if to_int(gid, 0) <= 0:
                    continue
                row = {"gameId": to_int(gid, 0), "title": entry.get("title") or "Unknown Game"}
                for field in _PATCH_DETAILS[1:]:
                    row[field] = entry.get(field)
                row["highestAwardKind"] = None
                row["highestAwardDate"] = None
                _raise_row(row, entry)
                payload["results"].append(row)
                added += 1
                continue
            if _covers(row, entry):
                covered.append(gid)
                continue
            _raise_row(row, entry)
        if added:
            payload["results"].sort(key=lambda r: (r.get("title") or "").lower() if isinstance(r, dict) else "")
            payload["count"] = to_int(payload.get("count"), 0) + added
            payload["total"] = to_int(payload.get("total"), 0) + added
        if covered:
            for gid in covered:
                patches.pop(gid, None)
            self._save_patches(key, patches)

    def patch(self, ulid, game_id, fields: dict) -> bool:
        key = self._key(ulid)
        gid = to_int(game_id, 0)
        if not key or gid <= 0:
            return False
        if to_int(fields.get("numAwarded"), 0) <= 0 and to_int(fields.get("numAwardedHardcore"), 0) <= 0:
            return False
        counts = tuple(to_int(fields.get(field), 0) for field in _PATCH_COUNTS) + (
            _award_rank(fields.get("highestAwardKind")),
        )
        with self._master_lock:
            if self._last_patched.get((key, gid)) == counts:
                return False
        with self._lock_for_key(key):
            if not self._path_for_key(key).exists():
                return False
            patches = self._load_patches(key)
            old = patches.get(str(gid))
            entry = dict(old) if old else {}
            for field in _PATCH_DETAILS:
                if fields.get(field) not in (None, "", 0):
                    entry[field] = fields[field]
            before = {field: entry.get(field) for field in _PATCH_COUNTS + ("highestAwardKind",)}
            _raise_row(entry, fields)
            changed = old is None or any(entry.get(field) != value for field, value in before.items())
            if changed:
                entry["at"] = int(time.time())
                patches[str(gid)] = entry
                if len(patches) > _PATCH_CAP:
                    oldest = sorted(patches, key=lambda g: to_int(patches[g].get("at"), 0))
                    for drop in oldest[: len(patches) - _PATCH_CAP]:
                        patches.pop(drop, None)
                self._save_patches(key, patches)
        with self._master_lock:
            self._last_patched[(key, gid)] = counts
        return changed

    def save(self, ulid, payload, expected_generation=None) -> None:
        key = self._key(ulid)
        if not key:
            return
        with self._lock_for_key(key):
            if expected_generation is not None and expected_generation != self.current_generation():
                return
            record = {"schema": 1, "payload": payload, "cachedAt": int(time.time())}
            save_json_file(self._path_for_key(key), record, compact=True)
            self._purge_patches(key, payload)

    def _purge_patches(self, key: str, payload) -> None:
        patches = self._load_patches(key)
        if not patches or not isinstance(payload, dict):
            return
        rows = {}
        for row in payload.get("results") or []:
            if isinstance(row, dict):
                rows[str(to_int(row.get("gameId"), 0))] = row
        keep = {gid: entry for gid, entry in patches.items() if gid not in rows or not _covers(rows[gid], entry)}
        if len(keep) != len(patches):
            self._save_patches(key, keep)

    def clear_all(self) -> list:
        cleared = []
        with self._master_lock:
            self._generation += 1
            for path in [*self._store_dir.glob("*.json"), *(self._store_dir / "patches").glob("*.json")]:
                try:
                    path.unlink()
                    cleared.append(str(path))
                except FileNotFoundError:
                    pass
            self._last_patched.clear()
            self._loaded.clear()

            self._key_locks.clear()

        return cleared
