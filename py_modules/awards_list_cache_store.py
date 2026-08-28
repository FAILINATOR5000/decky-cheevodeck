from pathlib import Path

import re
import threading
import time

from utils import ensure_dir, load_json_file, save_json_file, to_int


_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


class AwardsListCacheStore:
    """Global cache of a user's awards/badges payload, one JSON file per ULID.

    Storage layout: ``<store_dir>/<ULID>.json``, each holding
    ``{schema, payload, cachedAt}``. Same shape and rationale as
    GamesListCacheStore: a player's awards are theirs, not the viewer's, so the
    dir is shared across every plugin account and never moves -- two of our
    accounts that both open the same person's badges reuse one warm file across
    an account switch. That's why there's no ``repoint`` and it's left off
    ``_apply_user_scope``.

    Threading mirrors GamesListCacheStore: every method that touches a file takes
    that ULID's lock; the master lock only guards the lock dict (and the clear
    walk + generation). ``_generation`` is the monotonic counter bumped on every
    clear so a clear that lands mid-fetch is honoured -- ``save`` drops the write
    if the generation moved while the awards call was in flight.
    """

    def __init__(self, *, store_dir: Path):
        self._store_dir = Path(store_dir)
        ensure_dir(self._store_dir)

        self._master_lock = threading.Lock()
        self._key_locks: dict[str, threading.Lock] = {}

        self._generation = 0

    def _key(self, ulid) -> str | None:
        key = str(ulid or "").strip().upper()
        return key if _ULID_RE.match(key) else None

    def _path_for_key(self, key: str) -> Path:
        return self._store_dir / f"{key}.json"

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
            data = load_json_file(self._path_for_key(key), {})
        if not isinstance(data, dict) or "payload" not in data:
            return {"hit": False}
        cached_at = to_int(data.get("cachedAt", 0), 0)
        if cached_at <= 0 or (int(time.time()) - cached_at) > max(1, int(max_age_seconds)):
            return {"hit": False}
        return {"hit": True, "payload": data["payload"]}

    def save(self, ulid, payload, expected_generation=None) -> None:
        key = self._key(ulid)
        if not key:
            return
        with self._lock_for_key(key):
            if expected_generation is not None and expected_generation != self.current_generation():
                return
            record = {"schema": 1, "payload": payload, "cachedAt": int(time.time())}
            save_json_file(self._path_for_key(key), record, compact=True)

    def clear_all(self) -> list:
        cleared = []
        with self._master_lock:
            self._generation += 1
            for path in self._store_dir.glob("*.json"):
                try:
                    path.unlink()
                    cleared.append(str(path))
                except FileNotFoundError:
                    pass

            self._key_locks.clear()

        return cleared
