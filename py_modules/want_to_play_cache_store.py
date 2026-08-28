from pathlib import Path

import re
import threading
import time

from utils import ensure_dir, load_json_file, save_json_file, to_int


_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


class WantToPlayCacheStore:
    """Global cache of a user's want-to-play list, one JSON file per ULID.

    Same layout and rationale as AwardsListCacheStore: ``<store_dir>/<ULID>.json``
    holding ``{schema, payload, cachedAt}``, shared across every plugin account
    because the list belongs to the player it describes, not to whoever is
    looking at it. No ``repoint``, and left off ``_apply_user_scope``.

    The window is sized like the games-list one rather than long. The membership
    is slow-moving — people add to it in ones and twos — but every row carries the
    user's unlock count for that game, and that moves whenever they play, so the
    numbers are what set the ceiling here, not the list. It still spares the two
    RA calls this used to spend on every single panel open. The window is read
    live from settings on every load, so changing it in Options takes effect on
    the next open with no reload.

    Threading mirrors the other two list caches: every method that touches a file
    takes that ULID's lock; the master lock only guards the lock dict (and the
    clear walk + generation). ``_generation`` is the monotonic counter bumped on
    every clear so a clear that lands mid-fetch is honoured — ``save`` drops the
    write if the generation moved while the RA call was in flight.
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
