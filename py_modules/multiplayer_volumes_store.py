import threading
import time
from pathlib import Path

import decky
from multiplayer_protocol import is_ulid

from utils import (
    NewerSchemaFile,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    save_json_file,
)


CURRENT_SCHEMA_VERSION = 1
FILENAME = "multiplayer_volumes.json"

DEFAULT_GAMES = {"speaker": 40, "headset": 90, "external": 40}
DEFAULT_INCOMING = 80
OUTPUTS = tuple(DEFAULT_GAMES)
DEFAULT_DUCKS = {"speaker": True, "external": False}
DEFAULT_DUCK_STRENGTH = 2
DUCK_STRENGTHS = (1, 2, 3, 4)


def _level(raw):
    if type(raw) is not int or not 0 <= raw <= 100:
        return None
    return raw - raw % 5


def _duck(output: str, pair: dict) -> dict:
    if output not in DEFAULT_DUCKS:
        return {"duck": False, "duckStrength": DEFAULT_DUCK_STRENGTH}
    duck = pair.get("duck")
    strength = pair.get("duckStrength")
    return {
        "duck": duck if type(duck) is bool else DEFAULT_DUCKS[output],
        "duckStrength": strength if type(strength) is int and strength in DUCK_STRENGTHS else DEFAULT_DUCK_STRENGTH,
    }


class MultiplayerVolumesStore:

    def __init__(self, *, base_dir: Path, ulid: str = ""):
        self._base_dir = base_dir
        self._ulid = ulid if is_ulid(ulid) else ""
        self._lock = threading.Lock()

    def repoint(self, base_dir: Path, ulid: str) -> None:
        with self._lock:
            self._base_dir = base_dir
            self._ulid = ulid if is_ulid(ulid) else ""

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
            levels = {}
            for output in OUTPUTS:
                pair = row.get(output)
                if isinstance(pair, dict):
                    game = _level(pair.get("game"))
                    incoming = _level(pair.get("incoming"))
                    if game is not None and incoming is not None:
                        levels[output] = {"game": game, "incoming": incoming, **_duck(output, pair)}
            if not levels:
                continue
            used = row.get("used")
            kept[key] = {**levels, "used": used if type(used) is int else 0}
        return kept

    def _save(self, games: dict) -> bool:
        try:
            refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
            save_json_file(self._path(), {"schemaVersion": CURRENT_SCHEMA_VERSION, "games": games}, compact=True)
        except NewerSchemaFile:
            return False
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't save the room volumes (%s)", type(e).__name__)
            return False
        return True

    def get(self, game_id: int, output: str = "speaker") -> dict:
        output = output if output in OUTPUTS else "speaker"
        with self._lock:
            row = self._games().get(str(game_id)) if self._ulid and game_id > 0 else None
        pair = row.get(output) if row is not None else None
        if pair is None:
            return {"game": DEFAULT_GAMES[output], "incoming": DEFAULT_INCOMING, **_duck(output, {})}
        return dict(pair)

    def set(self, game_id: int, game, incoming, output: str = "speaker", duck=None, duck_strength=None) -> bool:
        game = _level(game)
        incoming = _level(incoming)
        if game is None or incoming is None or game_id <= 0 or output not in OUTPUTS:
            return False
        if output in DEFAULT_DUCKS and (type(duck) is not bool or duck_strength not in DUCK_STRENGTHS
                                        or type(duck_strength) is not int):
            duck, duck_strength = DEFAULT_DUCKS[output], DEFAULT_DUCK_STRENGTH
        with self._lock:
            if not self._ulid:
                return False
            games = self._games()
            row = games.get(str(game_id), {})
            row[output] = {"game": game, "incoming": incoming}
            if output in DEFAULT_DUCKS:
                row[output].update(duck=duck, duckStrength=duck_strength)
            row["used"] = int(time.time())
            games[str(game_id)] = row
            return self._save(games)

    def clear(self) -> None:
        with self._lock:
            try:
                self._path().unlink(missing_ok=True)
            except OSError as e:
                decky.logger.warning("multiplayer: couldn't clear the room volumes (%s)", type(e).__name__)
