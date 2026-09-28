from pathlib import Path
from typing import Any, Optional

import threading
import time

from utils import ensure_dir, load_json_file, norm_game_id, save_json_file, to_int


SITE_SCHEMA_VERSION = 1

MAX_EVENTS = 2000
MAX_CHECKLIST_GAMES = 1000
MAX_RULE_TEXT = 4000
MAX_SOURCES = 2000
MAX_GAMES = 20000
MAX_LINKS = 20

_KINDS = ("automated", "checklist", "spreadsheet", "paused")
_STATES = ("active", "evergreen", "concluded")
_RULE_KINDS = ("points", "masterAll")

_SHORT_TEXT = 300
_URL_TEXT = 2000


def _text(value: Any, limit: int = _SHORT_TEXT) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _optional_text(value: Any, limit: int = _SHORT_TEXT) -> Optional[str]:
    text = _text(value, limit)
    return text or None


def _positive_id(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    number = norm_game_id(value)
    if number is None or number <= 0:
        return None
    return number


def _clean_url(value: Any) -> Optional[str]:
    text = _text(value, _URL_TEXT)
    if text.startswith("https://") or text.startswith("http://"):
        return text
    return None


def _clean_sources(raw: Any) -> dict:
    sources = {}
    if not isinstance(raw, dict):
        return sources
    for key, value in raw.items():
        mirror_id = _positive_id(key)
        if mirror_id is None or not isinstance(value, dict):
            continue
        achievement_id = _positive_id(value.get("achievementId"))
        game_id = _positive_id(value.get("gameId"))
        if achievement_id is None or game_id is None:
            continue
        points = value.get("points")
        sources[str(mirror_id)] = {
            "achievementId": achievement_id,
            "points": to_int(points, 0) if points is not None else None,
            "gameId": game_id,
            "gameTitle": _text(value.get("gameTitle")),
            "consoleId": to_int(value.get("consoleId"), 0),
            "consoleName": _text(value.get("consoleName")),
            "obfuscated": value.get("obfuscated") is True,
        }
        if len(sources) >= MAX_SOURCES:
            break
    return sources


def _clean_checklist(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    sections = []
    total = 0
    for section in raw.get("sections") if isinstance(raw.get("sections"), list) else []:
        if not isinstance(section, dict):
            continue
        game_ids = []
        for value in section.get("gameIds") if isinstance(section.get("gameIds"), list) else []:
            game_id = _positive_id(value)
            if game_id is not None and game_id not in game_ids:
                game_ids.append(game_id)
        total += len(game_ids)
        if total > MAX_CHECKLIST_GAMES:
            raise ValueError("checklist too long")
        if game_ids:
            sections.append({"label": _text(section.get("label")), "gameIds": game_ids})
    if not sections:
        return None

    rule_raw = raw.get("rule") if isinstance(raw.get("rule"), dict) else {}
    text = rule_raw.get("text") if isinstance(rule_raw.get("text"), str) else ""
    if len(text) > MAX_RULE_TEXT:
        raise ValueError("rule text too long")
    kind = rule_raw.get("kind") if rule_raw.get("kind") in _RULE_KINDS else None
    target = to_int(rule_raw.get("target"), 0)
    bonus = rule_raw.get("masteryBonus")
    rule = {
        "text": text.strip(),
        "kind": kind if target > 0 else None,
        "target": target if target > 0 else None,
        "masteryBonus": to_int(bonus, 0) if bonus is not None else None,
    }
    return {"sections": sections, "rule": rule}


def _clean_links(raw: Any) -> list:
    links = []
    for value in raw if isinstance(raw, list) else []:
        if not isinstance(value, dict):
            continue
        url = _clean_url(value.get("url"))
        if url is None:
            continue
        links.append({"label": _text(value.get("label")), "url": url})
        if len(links) >= MAX_LINKS:
            break
    return links


def _clean_event(key: str, raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("event is not an object")
    if not key.isdigit() or str(raw.get("gameId")) != key:
        raise ValueError("key does not match gameId")
    kind = raw.get("kind")
    if kind is not None and kind not in _KINDS:
        raise ValueError("bad kind")
    forum_topic = _positive_id(raw.get("forumTopicId"))
    return {
        "gameId": int(key),
        "eventId": _positive_id(raw.get("eventId")),
        "title": _text(raw.get("title")),
        "imageIcon": _optional_text(raw.get("imageIcon"), _URL_TEXT),
        "badgeUrl": _clean_url(raw.get("badgeUrl")),
        "kind": kind,
        "evergreen": raw.get("evergreen") is True,
        "state": raw.get("state") if raw.get("state") in _STATES else None,
        "activeFrom": _optional_text(raw.get("activeFrom"), 40),
        "activeThrough": _optional_text(raw.get("activeThrough"), 40),
        "activeUntil": _optional_text(raw.get("activeUntil"), 40),
        "createdAt": _optional_text(raw.get("createdAt"), 40),
        "forumTopicId": forum_topic,
        "infoUrl": _clean_url(raw.get("infoUrl")),
        "links": _clean_links(raw.get("links")),
        "sources": _clean_sources(raw.get("sources")),
        "checklist": _clean_checklist(raw.get("checklist")),
    }


def clean_site_doc(doc: Any) -> Optional[dict]:
    if not isinstance(doc, dict) or doc.get("schemaVersion") != SITE_SCHEMA_VERSION:
        return None
    raw_events = doc.get("events")
    if not isinstance(raw_events, dict) or len(raw_events) > MAX_EVENTS:
        return None
    try:
        events = {key: _clean_event(key, value) for key, value in raw_events.items()}
    except (ValueError, TypeError):
        return None

    games = {}
    raw_games = doc.get("games") if isinstance(doc.get("games"), dict) else {}
    for key, value in raw_games.items():
        game_id = _positive_id(key)
        if game_id is None or not isinstance(value, dict):
            continue
        games[str(game_id)] = {
            "title": _text(value.get("title")),
            "consoleId": to_int(value.get("consoleId"), 0),
            "consoleName": _text(value.get("consoleName")),
            "imageIcon": _optional_text(value.get("imageIcon"), _URL_TEXT),
        }
        if len(games) >= MAX_GAMES:
            break

    return {
        "schemaVersion": SITE_SCHEMA_VERSION,
        "generatedAt": _text(doc.get("generatedAt"), 40),
        "events": events,
        "games": games,
    }


class EventsCacheStore:
    def __init__(self, *, store_dir: Path, seed_path: Optional[Path] = None):
        self._store_dir = Path(store_dir)
        self._seed_path = seed_path
        self._lock = threading.Lock()
        self._generation = 0
        self._seed_cache = None
        self._site_memo = None
        ensure_dir(self._store_dir)

    def current_generation(self) -> int:
        with self._lock:
            return self._generation

    def _list_path(self) -> Path:
        return self._store_dir / "list.json"

    def _site_path(self) -> Path:
        return self._store_dir / "site.json"

    def load_list(self) -> Optional[dict]:
        with self._lock:
            data = load_json_file(self._list_path(), {})
        if not isinstance(data, dict) or not isinstance(data.get("events"), list):
            return None
        return {"events": data["events"], "fetchedAt": to_int(data.get("fetchedAt"), 0)}

    def save_list(self, events: list, expected_generation: int) -> bool:
        with self._lock:
            if expected_generation != self._generation:
                return False
            save_json_file(self._list_path(), {"events": events, "fetchedAt": int(time.time())}, compact=True)
            return True

    def _load_seed(self) -> Optional[dict]:
        if self._seed_cache is None and self._seed_path is not None:
            self._seed_cache = clean_site_doc(load_json_file(self._seed_path, None)) or {}
        return self._seed_cache or None

    def load_site(self) -> dict:
        with self._lock:
            if self._site_memo is None:
                data = load_json_file(self._site_path(), {})
                memo = {"doc": None, "fetchedAt": 0}
                if isinstance(data, dict):
                    memo["doc"] = clean_site_doc(data.get("doc"))
                    if memo["doc"] is not None:
                        memo["fetchedAt"] = to_int(data.get("fetchedAt"), 0)
                self._site_memo = memo
            doc = self._site_memo["doc"]
            fetched_at = self._site_memo["fetchedAt"]
        seed = self._load_seed()
        if seed is not None and (doc is None or seed["generatedAt"] > doc["generatedAt"]):
            doc = seed
        return {"doc": doc, "fetchedAt": fetched_at}

    def save_site(self, doc: dict, expected_generation: int) -> bool:
        with self._lock:
            if expected_generation != self._generation:
                return False
            fetched_at = int(time.time())
            save_json_file(self._site_path(), {"doc": doc, "fetchedAt": fetched_at}, compact=True)
            self._site_memo = {"doc": doc, "fetchedAt": fetched_at}
            return True

    def clear_all(self) -> list:
        cleared = []
        with self._lock:
            self._generation += 1
            self._site_memo = None
            for path in (self._list_path(), self._site_path()):
                try:
                    path.unlink()
                    cleared.append(str(path))
                except FileNotFoundError:
                    pass
        return cleared
