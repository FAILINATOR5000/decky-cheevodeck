from pathlib import Path

import threading

from utils import ensure_dir, load_json_file, norm_game_id, save_json_file


PLAYERS_NEAR_YOU_MODES = ("classic", "enhanced", "recent", "off")

PLAYERS_NEAR_YOU_DEFAULT_MODE = "enhanced"


def normalise_mode(value) -> str:
    return value if value in PLAYERS_NEAR_YOU_MODES else PLAYERS_NEAR_YOU_DEFAULT_MODE


class PlayersNearYouStore:
    """Per-game storage for the Players Near You feed, one JSON file per game.

    Storage layout: ``<store_dir>/<gameid>.json``. Each file holds that one
    game's feed: ``{items, lastRefreshAt, watermarkByAchievement}``, plus the
    game's ``mode`` — its Playstyle, the one field in here the background
    service doesn't own and the only copy of that preference anywhere. The feed
    used to live in a single flat per-user file pooled across every game, which
    is what let one game's unlockers bleed into another's list on a game switch.
    One small file per game fixes that -- the read only ever touches the current
    game's file, so switching games swaps the whole feed.

    Threading mirrors NotesStore exactly. Every public method that touches a
    game's file takes that game's lock; the master lock only guards the lock
    dict itself and is never held at the same time as a per-game lock. The
    background service is the sole writer and the RPC reader is read-only, so
    there's no multi-writer race -- the per-game lock is here for the same
    reason NotesStore's is: keep a save atomic against a concurrent read, and
    serialize cleanly with whatever path is current after a repoint.
    """

    def __init__(self, *, store_dir: Path):
        self._store_dir = store_dir

        self._master_lock = threading.Lock()
        self._game_locks: dict[str, threading.Lock] = {}

    def repoint(self, store_dir: Path) -> None:
        with self._master_lock:
            self._store_dir = store_dir

    def _game_key(self, game_id) -> str | None:
        normalized = norm_game_id(game_id)
        if normalized is None:
            return None
        return str(normalized)

    def _path_for_game_key(self, key: str) -> Path:
        if not key or not key.isdigit():
            raise ValueError(f"invalid players-near-you game key: {key!r}")
        return self._store_dir / f"{key}.json"

    def _lock_for_game(self, key: str) -> threading.Lock:
        with self._master_lock:
            lock = self._game_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._game_locks[key] = lock
            return lock

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
            path = self._path_for_game_key(key)
            stored = load_json_file(path, {})
            mode = stored.get("mode") if isinstance(stored, dict) else None
            document = dict(cache)
            if mode in PLAYERS_NEAR_YOU_MODES:
                document["mode"] = mode
            else:
                document.pop("mode", None)
            ensure_dir(self._store_dir)
            save_json_file(path, document, compact=True)

    def set_mode_for_game(self, game_id, mode: str) -> str | None:
        key = self._game_key(game_id)
        if key is None or mode not in PLAYERS_NEAR_YOU_MODES:
            return None
        lock = self._lock_for_game(key)
        with lock:
            path = self._path_for_game_key(key)
            cache = load_json_file(path, {})
            if not isinstance(cache, dict):
                cache = {}
            cache["mode"] = mode
            ensure_dir(self._store_dir)
            save_json_file(path, cache, compact=True)
        return mode

    def clear_all_games(self) -> list:
        cleared = []
        with self._master_lock:
            for path in self._store_dir.glob("*.json"):
                try:
                    raw = load_json_file(path, {})
                    mode = raw.get("mode") if isinstance(raw, dict) else None
                    if mode in PLAYERS_NEAR_YOU_MODES:
                        save_json_file(path, {"mode": mode}, compact=True)
                    else:
                        path.unlink()
                    cleared.append(str(path))
                except FileNotFoundError:
                    pass

            self._game_locks.clear()

        return cleared
