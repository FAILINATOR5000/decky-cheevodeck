from pathlib import Path

import threading

from utils import ensure_dir, load_json_file, norm_game_id, save_json_file


class GameActivityHistoryStore:
    """Per-game storage for the Now Playing -> Activity friend feed, one JSON
    file per game.

    Storage layout: ``<store_dir>/<gameid>.json``. Each file holds that one
    game's history: ``{events, lastWriteAt}``. The feed used to live in a
    single flat per-user file (``game_activity_history.json``) keyed by gameId
    inside, so every write loaded and rewrote the whole multi-game blob. One
    small file per game keeps a write scoped to the game it touches and lets
    the read pull only the current game.

    Threading mirrors NotesStore / PlayersNearYouStore, with one deliberate
    difference: the per-game locks are RLocks. This feed has two write paths
    that can land on the same game from different threads at once -- the
    trickle daemon's ``record_event`` and the Now Playing tab's
    ``snapshot_for_game`` (which runs on the asyncio loop when the RPC fires).
    The service has to hold one game's lock across a whole read-modify-write so
    the later writer can't clobber events the earlier one just appended. It
    does that with ``lock_for_game``, and the self-guarding ``load_for_game`` /
    ``save_for_game`` it calls inside that block re-acquire the same lock --
    hence RLock rather than a plain Lock. The master lock still only guards the
    lock dict and is never held alongside a per-game lock.
    """

    def __init__(self, *, store_dir: Path):
        self._store_dir = store_dir

        self._master_lock = threading.Lock()
        self._game_locks: dict[str, threading.RLock] = {}

    def repoint(self, store_dir: Path) -> None:
        with self._master_lock:
            self._store_dir = store_dir

    @property
    def store_dir(self) -> Path:
        return self._store_dir

    def _game_key(self, game_id) -> str | None:
        normalized = norm_game_id(game_id)
        if normalized is None:
            return None
        return str(normalized)

    def _path_for_game_key(self, key: str) -> Path:
        if not key or not key.isdigit():
            raise ValueError(f"invalid game-activity game key: {key!r}")
        return self._store_dir / f"{key}.json"

    def _lock_for_game(self, key: str) -> threading.RLock:
        with self._master_lock:
            lock = self._game_locks.get(key)
            if lock is None:
                lock = threading.RLock()
                self._game_locks[key] = lock
            return lock

    def lock_for_game(self, game_id) -> threading.RLock:
        key = self._game_key(game_id)
        if key is None:
            raise ValueError(f"invalid game-activity game id: {game_id!r}")
        return self._lock_for_game(key)

    def load_for_game(self, game_id) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {}
        lock = self._lock_for_game(key)
        with lock:
            raw = load_json_file(self._path_for_game_key(key), {})
            return raw if isinstance(raw, dict) else {}

    def save_for_game(self, game_id, cache: dict) -> None:
        key = self._game_key(game_id)
        if key is None:
            return
        lock = self._lock_for_game(key)
        with lock:
            ensure_dir(self._store_dir)
            save_json_file(self._path_for_game_key(key), cache, compact=True)

    def clear_all_games(self) -> list:
        cleared = []
        with self._master_lock:
            for path in self._store_dir.glob("*.json"):
                try:
                    path.unlink()
                    cleared.append(str(path))
                except FileNotFoundError:
                    pass

            self._game_locks.clear()

        return cleared
