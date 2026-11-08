import threading
from pathlib import Path

import decky

from utils import (
    NewerSchemaFile,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    save_json_file,
)


CURRENT_SCHEMA_VERSION = 1
FILENAME = "play_picks.json"
USES = ("play", "couch")


def clean_pick(raw):
    if not isinstance(raw, dict):
        return None
    appid, kind, core = raw.get("appid"), raw.get("kind"), raw.get("core")
    if type(appid) is not int or not 0 <= appid <= 0xFFFFFFFF or not isinstance(kind, str) \
            or not isinstance(core, str) or len(kind) > 32 or len(core) > 128:
        return None
    if not appid and not kind:
        return None
    return {"appid": appid, "kind": kind, "core": core}


class PlayPicksStore:

    def __init__(self, *, base_dir: Path):
        self._base_dir = Path(base_dir)
        self._lock = threading.Lock()

    def _path(self) -> Path:
        return self._base_dir / FILENAME

    def _games(self) -> dict:
        raw = load_json_file(self._path(), {})
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(self._path())
            return {}
        games = raw.get("games") if isinstance(raw, dict) else None
        if not isinstance(games, dict):
            return {}
        kept = {}
        for key, row in games.items():
            if not isinstance(key, str) or not key.isdigit() or not isinstance(row, dict):
                continue
            picks = {use: clean_pick(row.get(use)) for use in USES}
            picks = {use: pick for use, pick in picks.items() if pick is not None}
            if picks:
                kept[key] = picks
        return kept

    def get(self, game_id: int, use: str):
        if use not in USES or game_id <= 0:
            return None
        with self._lock:
            row = self._games().get(str(game_id))
        return dict(row[use]) if row is not None and use in row else None

    def set(self, game_id: int, use: str, pick) -> bool:
        if use not in USES or game_id <= 0:
            return False
        pick = clean_pick(pick) if pick is not None else None
        with self._lock:
            games = self._games()
            row = games.get(str(game_id), {})
            if pick is None:
                if use not in row:
                    return True
                row.pop(use)
            else:
                row[use] = pick
            if row:
                games[str(game_id)] = row
            else:
                games.pop(str(game_id), None)
            try:
                refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
                save_json_file(self._path(), {"schemaVersion": CURRENT_SCHEMA_VERSION, "games": games}, compact=True)
            except NewerSchemaFile:
                return False
            except OSError as e:
                decky.logger.warning("play: couldn't save the emulator pick (%s)", type(e).__name__)
                return False
        return True
