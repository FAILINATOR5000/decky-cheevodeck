from pathlib import Path

import threading
import time
import uuid

from settings_store import _NOTE_COLOR_OPTIONS
from utils import ensure_dir, load_json_file, norm_game_id, save_json_file, to_int


SET_NAME_MAX_LEN = 60
GAME_NOTE_MAX_LEN = 2000

CONSOLE_NAME_MAX_LEN = 60

MAX_SETS = 500
MAX_GAMES_PER_SET = 500

GAME_SORT_OPTIONS = ("manual", "recent", "oldest")
DEFAULT_GAME_SORT = "manual"

AWARD_KINDS = ("mastered", "completed", "beaten-hardcore", "beaten-softcore")

GAME_FILTER_OPTIONS = ("all", "completed", "incomplete")
DEFAULT_GAME_FILTER = "all"

VIEW_MODE_OPTIONS = ("all", "system", "systemYear", "retroHistory", "retroHistoryAlpha")
DEFAULT_VIEW_MODE = "system"

ORDER_FIELD_BY_VIEW = {
    "all": "manualOrder",
    "system": "systemOrder",
    "systemYear": "systemYearOrder",
    "retroHistory": "retroOrder",
    "retroHistoryAlpha": "retroAlphaOrder",
}

CURRENT_SCHEMA_VERSION = 1


class TrackedSetsStore:
    """Whole-game completion goals, grouped into user-created sets.

    Storage layout: one user-level file, ``<base_dir>/tracked_sets.json``,
    holding every set and the game cards inside each. This is metadata
    only -- no images live here; the box art comes from the existing
    image cache keyed on the RA image URL. The file is small and loads
    in one read.

    Why one file and not per-set files: a set is just an in-file key,
    not a thing that needs its own atomic write surface. The page only
    ever renders one set's cards at a time, so "one file" never turns
    into "paint a thousand cards" -- that's a render choice handled on
    the frontend, not a storage problem. Keeping it one file means a
    reorder or a completion check is a single atomic read-modify-write.

    Threading: a single master lock guards the whole read-modify-write.
    Unlike the notes store there's no per-game lock dict -- there's only
    one file, so one lock is the whole story. Same threading.Lock (not
    asyncio.Lock) reasoning as the notes store: the auto-check path and
    the RPC handlers can come from different places and we want them to
    serialize against each other cleanly.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def repoint(self, base_dir: Path) -> None:
        with self._lock:
            self._base_dir = base_dir
            ensure_dir(self._base_dir)

    def _path(self) -> Path:
        return self._base_dir / "tracked_sets.json"

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()

        schema = to_int(raw.get("schemaVersion", 0), 0)
        if schema != CURRENT_SCHEMA_VERSION:
            return self._empty_file()

        return self._normalize_file(raw)

    def _save_raw(self, data: dict) -> None:
        save_json_file(self._path(), data, compact=True)

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "sets": [],
        }

    def _clean_name(self, raw) -> str:
        if not isinstance(raw, str):
            return ""
        return raw.strip()[:SET_NAME_MAX_LEN]

    def _clean_note(self, raw) -> str:
        if not isinstance(raw, str):
            return ""
        return raw.strip()[:GAME_NOTE_MAX_LEN]

    def _clean_console_name(self, raw) -> str:
        if not isinstance(raw, str):
            return ""
        return raw.strip()[:CONSOLE_NAME_MAX_LEN]

    def _clean_color(self, raw) -> str:
        if raw in _NOTE_COLOR_OPTIONS:
            return raw
        return "default"

    def _clean_game_sort(self, raw) -> str:
        if raw in GAME_SORT_OPTIONS:
            return raw
        return DEFAULT_GAME_SORT

    def _clean_game_filter(self, raw) -> str:
        if raw in GAME_FILTER_OPTIONS:
            return raw
        return DEFAULT_GAME_FILTER

    def _clean_view_mode(self, raw) -> str:
        if raw in VIEW_MODE_OPTIONS:
            return raw
        return DEFAULT_VIEW_MODE

    def _opt_timestamp(self, raw):
        if raw is None:
            return None
        coerced = to_int(raw, 0)
        return coerced or None

    def _opt_count(self, raw):
        if raw is None:
            return None
        return to_int(raw, 0)

    def _opt_award(self, raw):
        if not isinstance(raw, str):
            return None
        token = raw.strip().lower()
        if token in AWARD_KINDS:
            return token
        return None

    def _normalize_game(self, raw):
        if not isinstance(raw, dict):
            return None

        game_id = norm_game_id(raw.get("gameId"))
        if game_id is None:
            return None

        return {
            "gameId": game_id,
            "title": self._clean_name(raw.get("title")),
            "imageIcon": raw.get("imageIcon") if isinstance(raw.get("imageIcon"), str) else "",
            "consoleName": self._clean_console_name(raw.get("consoleName")),
            "note": self._clean_note(raw.get("note")),
            "color": self._clean_color(raw.get("color")),
            "manualOrder": to_int(raw.get("manualOrder"), 0),
            "systemOrder": to_int(raw.get("systemOrder"), 0),
            "systemYearOrder": to_int(raw.get("systemYearOrder"), 0),
            "retroOrder": to_int(raw.get("retroOrder"), 0),
            "retroAlphaOrder": to_int(raw.get("retroAlphaOrder"), 0),
            "numAwarded": self._opt_count(raw.get("numAwarded")),
            "maxPossible": self._opt_count(raw.get("maxPossible")),
            "highestAward": self._opt_award(raw.get("highestAward")),
            "lastCheckedAt": self._opt_timestamp(raw.get("lastCheckedAt")),
        }

    def _repack_orders(self, games) -> None:
        for field in ("systemOrder", "systemYearOrder", "retroOrder", "retroAlphaOrder", "manualOrder"):
            games.sort(key=lambda g, f=field: g[f])
            for index, game in enumerate(games):
                game[field] = index

    def _normalize_set(self, raw):
        if not isinstance(raw, dict):
            return None

        set_id = raw.get("id")
        if not isinstance(set_id, str) or not set_id:
            return None

        games = []
        for raw_game in raw.get("games", []) or []:
            cleaned = self._normalize_game(raw_game)
            if cleaned is not None:
                games.append(cleaned)
            if len(games) >= MAX_GAMES_PER_SET:
                break

        games.sort(key=lambda g: g["manualOrder"])
        self._repack_orders(games)

        return {
            "id": set_id,
            "name": self._clean_name(raw.get("name")),
            "color": self._clean_color(raw.get("color")),
            "manualOrder": to_int(raw.get("manualOrder"), 0),
            "gameSort": self._clean_game_sort(raw.get("gameSort")),
            "gameFilter": self._clean_game_filter(raw.get("gameFilter")),
            "viewMode": self._clean_view_mode(raw.get("viewMode")),
            "lastOpenedAt": self._opt_timestamp(raw.get("lastOpenedAt")),
            "games": games,
        }

    def _normalize_file(self, raw: dict) -> dict:
        sets = []
        for raw_set in raw.get("sets", []) or []:
            cleaned = self._normalize_set(raw_set)
            if cleaned is not None:
                sets.append(cleaned)
            if len(sets) >= MAX_SETS:
                break

        sets.sort(key=lambda s: s["manualOrder"])
        for index, item in enumerate(sets):
            item["manualOrder"] = index

        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "sets": sets,
        }

    def _new_set_id(self) -> str:
        return f"set_{uuid.uuid4().hex}"

    def _find_set(self, data: dict, set_id: str):
        for item in data["sets"]:
            if item["id"] == set_id:
                return item
        return None

    def load_all(self) -> dict:
        with self._lock:
            data = self._load_raw()
        return data

    def create_set(self, name) -> dict:
        cleaned = self._clean_name(name)
        if not cleaned:
            return {"ok": False, "error": "empty_name"}

        with self._lock:
            data = self._load_raw()
            if len(data["sets"]) >= MAX_SETS:
                return {"ok": False, "error": "too_many_sets"}

            new_set = {
                "id": self._new_set_id(),
                "name": cleaned,
                "color": "default",
                "manualOrder": len(data["sets"]),
                "gameSort": DEFAULT_GAME_SORT,
                "gameFilter": DEFAULT_GAME_FILTER,
                "viewMode": DEFAULT_VIEW_MODE,
                "lastOpenedAt": int(time.time()),
                "games": [],
            }
            data["sets"].append(new_set)
            self._save_raw(data)

        return {"ok": True, "set": new_set}

    def rename_set(self, set_id: str, name) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}

        cleaned = self._clean_name(name)
        if not cleaned:
            return {"ok": False, "error": "empty_name"}

        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            target["name"] = cleaned
            self._save_raw(data)

        return {"ok": True, "set": target}

    def set_game_sort(self, set_id: str, sort) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}

        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            target["gameSort"] = self._clean_game_sort(sort)
            self._save_raw(data)

        return {"ok": True, "set": target}

    def set_game_filter(self, set_id: str, game_filter) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}

        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            target["gameFilter"] = self._clean_game_filter(game_filter)
            self._save_raw(data)

        return {"ok": True, "set": target}

    def set_view_mode(self, set_id: str, mode) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}

        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            target["viewMode"] = self._clean_view_mode(mode)
            self._save_raw(data)

        return {"ok": True, "set": target}

    def touch_opened(self, set_id: str) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}

        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            target["lastOpenedAt"] = int(time.time())
            self._save_raw(data)

        return {"ok": True, "set": target}

    def delete_set(self, set_id: str) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}

        with self._lock:
            data = self._load_raw()
            before = len(data["sets"])
            data["sets"] = [s for s in data["sets"] if s["id"] != set_id]
            if len(data["sets"]) == before:
                return {"ok": False, "error": "not_found"}

            for index, item in enumerate(data["sets"]):
                item["manualOrder"] = index
            self._save_raw(data)

        return {"ok": True}

    def add_game(self, set_id: str, game) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}
        if not isinstance(game, dict):
            return {"ok": False, "error": "invalid_game"}

        game_id = norm_game_id(game.get("gameId"))
        if game_id is None:
            return {"ok": False, "error": "invalid_game_id"}

        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            if len(target["games"]) >= MAX_GAMES_PER_SET:
                return {"ok": False, "error": "set_full"}

            for existing in target["games"]:
                if existing["gameId"] == game_id:
                    return {"ok": True, "set": target, "alreadyPresent": True}

            card = self._normalize_game({
                "gameId": game_id,
                "title": game.get("title"),
                "imageIcon": game.get("imageIcon"),
                "consoleName": game.get("consoleName"),
                "note": "",
                "color": "default",
                "manualOrder": len(target["games"]),
                "systemOrder": len(target["games"]),
                "systemYearOrder": len(target["games"]),
                "retroOrder": len(target["games"]),
                "retroAlphaOrder": len(target["games"]),
                "numAwarded": None,
                "maxPossible": game.get("maxPossible"),
                "highestAward": None,
                "lastCheckedAt": None,
            })
            target["games"].append(card)
            self._save_raw(data)

        return {"ok": True, "set": target}

    def remove_game(self, set_id: str, game_id) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}

        normalized = norm_game_id(game_id)
        if normalized is None:
            return {"ok": False, "error": "invalid_game_id"}

        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            before = len(target["games"])
            target["games"] = [g for g in target["games"] if g["gameId"] != normalized]
            if len(target["games"]) == before:
                return {"ok": False, "error": "game_not_found"}

            self._repack_orders(target["games"])
            self._save_raw(data)

        return {"ok": True, "set": target}

    def update_game_note(self, set_id: str, game_id, note, color) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}

        normalized = norm_game_id(game_id)
        if normalized is None:
            return {"ok": False, "error": "invalid_game_id"}

        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            card = None
            for game in target["games"]:
                if game["gameId"] == normalized:
                    card = game
                    break
            if card is None:
                return {"ok": False, "error": "game_not_found"}

            card["note"] = self._clean_note(note)
            card["color"] = self._clean_color(color)
            self._save_raw(data)

        return {"ok": True, "set": target}

    def reorder_games(self, set_id: str, ordered_ids, order: str = "all") -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}
        if not isinstance(ordered_ids, list):
            return {"ok": False, "error": "invalid_order"}

        field = ORDER_FIELD_BY_VIEW.get(order, "manualOrder")

        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            by_id = {}
            for game in target["games"]:
                by_id[game["gameId"]] = game

            new_order = []
            seen = set()
            for raw_id in ordered_ids:
                normalized = norm_game_id(raw_id)
                if normalized is None or normalized in seen:
                    continue
                game = by_id.get(normalized)
                if game is None:
                    continue
                seen.add(normalized)
                new_order.append(game)

            leftovers = [g for g in target["games"] if g["gameId"] not in seen]
            leftovers.sort(key=lambda g: g[field])
            new_order.extend(leftovers)

            for index, game in enumerate(new_order):
                game[field] = index
            target["games"].sort(key=lambda g: g["manualOrder"])
            self._save_raw(data)

        return {"ok": True, "set": target}

    def _write_counts_onto_set(self, target, results, now):
        for card in target["games"]:
            entry = results.get(str(card["gameId"]))
            if not isinstance(entry, dict):
                card["numAwarded"] = 0
                card["highestAward"] = None
                card["lastCheckedAt"] = now
                continue

            awarded = to_int(entry.get("numAwarded"), 0)
            max_possible = to_int(entry.get("maxPossible"), 0)
            card["numAwarded"] = awarded
            if max_possible > 0:
                card["maxPossible"] = max_possible
            card["highestAward"] = self._opt_award(entry.get("highestAward"))
            card["lastCheckedAt"] = now

    def _is_set_completed(self, target) -> bool:
        awarded = 0
        possible = 0
        any_checked = False
        for card in target["games"]:
            num = card.get("numAwarded")
            if num is not None:
                any_checked = True
                awarded += to_int(num, 0)
            max_possible = card.get("maxPossible")
            if max_possible is not None and to_int(max_possible, 0) > 0:
                possible += to_int(max_possible, 0)
        return any_checked and possible > 0 and awarded >= possible

    def apply_completion_results(self, set_id: str, results: dict) -> dict:
        if not isinstance(set_id, str) or not set_id:
            return {"ok": False, "error": "invalid_set_id"}
        if not isinstance(results, dict):
            return {"ok": False, "error": "invalid_results"}

        now = int(time.time())
        with self._lock:
            data = self._load_raw()
            target = self._find_set(data, set_id)
            if target is None:
                return {"ok": False, "error": "not_found"}

            self._write_counts_onto_set(target, results, now)
            self._save_raw(data)

        return {"ok": True, "set": target}

    def apply_completion_results_all(self, results: dict) -> dict:
        if not isinstance(results, dict):
            return {"ok": False, "error": "invalid_results"}

        now = int(time.time())
        with self._lock:
            data = self._load_raw()
            for target in data["sets"]:
                self._write_counts_onto_set(target, results, now)

            self._save_raw(data)

        return {"ok": True, "sets": data["sets"]}

    def apply_completion_results_with_transitions(self, results: dict) -> dict:
        if not isinstance(results, dict):
            return {"ok": False, "error": "invalid_results", "completedSets": []}

        now = int(time.time())
        completed = []
        with self._lock:
            data = self._load_raw()
            for target in data["sets"]:
                before = self._is_set_completed(target)
                self._write_counts_onto_set(target, results, now)
                after = self._is_set_completed(target)
                if after and not before:
                    completed.append(target)

            self._save_raw(data)

        return {"ok": True, "completedSets": completed}

    def clear_all_tracked_sets(self) -> dict:
        with self._lock:
            data = self._load_raw()
            deleted_sets = len(data["sets"])
            deleted_games = sum(len(s["games"]) for s in data["sets"])
            try:
                self._path().unlink()
            except FileNotFoundError:
                pass

        return {
            "ok": True,
            "deletedSets": deleted_sets,
            "deletedGames": deleted_games,
        }
