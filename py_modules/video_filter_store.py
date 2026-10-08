import json
import math
import re
import threading
from pathlib import Path
from typing import Any, Optional

import decky

from utils import load_json_file, save_json_file, to_int


FILTER_FORMAT = 1

STATE_FILENAME = "video_filters.json"

MAX_FILE_BYTES = 16 * 1024

MAX_REVISION = 2 ** 31 - 1

MAX_NAMES = 16
MAX_GLOBALS = 4
MAX_TEXT_PATHS = 8
MAX_DISGUISES = 8
MAX_EDITS = 8
MAX_PATH_SEGMENTS = 6
MAX_VALUE_LENGTH = 64
MAX_OBJECT_ENTRIES = 8

STRIKES_TO_DEAD = 2

MIN_HOLD_SECONDS = 2
MAX_HOLD_SECONDS = 20

_IDENTIFIER = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]{0,63}")
_TEXT_PATH = re.compile(r"/[A-Za-z0-9_/.-]{1,63}")
_NAME = re.compile(r"[a-z0-9-]{1,32}")
_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{1,16}")

_UNSAFE_NAMES = ("__proto__", "prototype", "constructor")

class _Invalid(Exception):
    pass


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value) or value in _UNSAFE_NAMES:
        raise _Invalid
    return value


def _identifier_list(value: Any, low: int, high: int) -> list:
    if not isinstance(value, list) or not low <= len(value) <= high:
        raise _Invalid
    names = [_identifier(item) for item in value]
    if len(set(names)) != len(names):
        raise _Invalid
    return names


def _flag(value: Any) -> bool:
    if not isinstance(value, bool):
        raise _Invalid
    return value


def _number(value: Any):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _Invalid
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise _Invalid
    return value


def _scalar(value: Any):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if len(value) > MAX_VALUE_LENGTH:
            raise _Invalid
        return value
    return _number(value)


def _edit_value(value: Any):
    if not isinstance(value, dict):
        return _scalar(value)
    if not 1 <= len(value) <= MAX_OBJECT_ENTRIES:
        raise _Invalid
    return {_identifier(key): _scalar(item) for key, item in value.items()}


def _edit_path(key: Any) -> str:
    if not isinstance(key, str):
        raise _Invalid
    segments = key.split(".")
    if len(segments) > MAX_PATH_SEGMENTS:
        raise _Invalid
    for segment in segments:
        _identifier(segment)
    return key


def _disguises(value: Any) -> list:
    if not isinstance(value, list) or len(value) > MAX_DISGUISES:
        raise _Invalid
    disguises = []
    seen = set()
    for entry in value:
        if not isinstance(entry, dict):
            raise _Invalid
        name = entry.get("name")
        if not isinstance(name, str) or not _NAME.fullmatch(name) or name in seen:
            raise _Invalid
        seen.add(name)
        edits = entry.get("set")
        if not isinstance(edits, dict) or not 1 <= len(edits) <= MAX_EDITS:
            raise _Invalid
        disguises.append({
            "name": name,
            "set": {_edit_path(key): _edit_value(item) for key, item in edits.items()},
        })
    return disguises


def _text_paths(value: Any) -> list:
    if not isinstance(value, list) or len(value) > MAX_TEXT_PATHS:
        raise _Invalid
    for item in value:
        if not isinstance(item, str) or not _TEXT_PATH.fullmatch(item):
            raise _Invalid
    if len(set(value)) != len(value):
        raise _Invalid
    return list(value)


def _revision(value: Any) -> int:
    if type(value) is not int or not 1 <= value <= MAX_REVISION:
        raise _Invalid
    return value


def _hold_seconds(value: Any):
    if not MIN_HOLD_SECONDS <= _number(value) <= MAX_HOLD_SECONDS:
        raise _Invalid
    return value


def clean_video_filters(doc: Any) -> Optional[dict]:
    if not isinstance(doc, dict) or type(doc.get("format")) is not int or doc.get("format") != FILTER_FORMAT:
        return None
    try:
        return {
            "format": FILTER_FORMAT,
            "revision": _revision(doc.get("revision")),
            "enabled": _flag(doc.get("enabled")),
            "marker": _identifier_list(doc.get("marker"), 1, MAX_NAMES),
            "within": _identifier_list(doc.get("within"), 0, MAX_NAMES),
            "remove": _identifier_list(doc.get("remove"), 0, MAX_NAMES),
            "removeWithDisguise": _identifier_list(doc.get("removeWithDisguise"), 0, MAX_NAMES),
            "removeAllOnNavigation": _flag(doc.get("removeAllOnNavigation")),
            "globals": _identifier_list(doc.get("globals"), 0, MAX_GLOBALS),
            "textPaths": _text_paths(doc.get("textPaths")),
            "disguises": _disguises(doc.get("disguises")),
            "holdSeconds": _hold_seconds(doc.get("holdSeconds")),
        }
    except _Invalid:
        return None


def parse_video_filters(raw: bytes) -> Optional[dict]:
    if not isinstance(raw, (bytes, bytearray)) or len(raw) > MAX_FILE_BYTES:
        return None
    try:
        doc = json.loads(bytes(raw).decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        return None
    return clean_video_filters(doc)


def _clean_dead(raw: Any) -> dict:
    if not isinstance(raw, dict):
        return {"revision": 0, "names": [], "strikes": {}}
    names = []
    for name in raw.get("names") if isinstance(raw.get("names"), list) else []:
        if isinstance(name, str) and _NAME.fullmatch(name) and name not in names:
            names.append(name)
    strikes = {}
    raw_strikes = raw.get("strikes") if isinstance(raw.get("strikes"), dict) else {}
    for name, videos in raw_strikes.items():
        if len(strikes) >= MAX_DISGUISES:
            break
        if not isinstance(name, str) or not _NAME.fullmatch(name) or not isinstance(videos, list):
            continue
        clean = []
        for video in videos:
            if isinstance(video, str) and _VIDEO_ID.fullmatch(video) and video not in clean:
                clean.append(video)
        if clean:
            strikes[name] = clean[:STRIKES_TO_DEAD]
    return {"revision": to_int(raw.get("revision"), 0), "names": names[:MAX_DISGUISES], "strikes": strikes}


class VideoFilterStore:
    def __init__(self, *, base_dir: Path, seed_paths: tuple = ()):
        self._base_dir = Path(base_dir)
        self._seed_paths = tuple(seed_paths)
        self._seed = None
        self._lock = threading.Lock()

    def _path(self) -> Path:
        return self._base_dir / STATE_FILENAME

    def _load_seed(self) -> Optional[dict]:
        if self._seed is None:
            self._seed = {}
            for path in self._seed_paths:
                try:
                    raw = Path(path).read_bytes()
                except OSError:
                    continue
                doc = parse_video_filters(raw)
                if doc is not None:
                    self._seed = doc
                    break
        return self._seed or None

    def _load_state(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            raw = {}
        return {
            "fetchedAt": to_int(raw.get("fetchedAt"), 0),
            "attemptAt": to_int(raw.get("attemptAt"), 0),
            "doc": clean_video_filters(raw.get("doc")),
            "dead": _clean_dead(raw.get("dead")),
        }

    def _save_state(self, state: dict) -> None:
        doc = state["doc"]
        try:
            save_json_file(self._path(), {
                "fetchedAt": state["fetchedAt"],
                "attemptAt": state["attemptAt"],
                "revision": doc["revision"] if doc else 0,
                "doc": doc,
                "dead": state["dead"],
            }, compact=True)
        except OSError as exc:
            decky.logger.warning("video filters: cache write failed (%s: %s)", type(exc).__name__, exc)

    def _current(self, state: dict) -> Optional[dict]:
        cached = state["doc"]
        seed = self._load_seed()
        if seed is not None and (cached is None or seed["revision"] > cached["revision"]):
            return seed
        return cached

    def load(self) -> dict:
        with self._lock:
            state = self._load_state()
            doc = self._current(state)
        revision = doc["revision"] if doc else 0
        dead = state["dead"]["names"] if state["dead"]["revision"] == revision and revision else []
        return {
            "doc": doc,
            "revision": revision,
            "dead": list(dead),
            "fetchedAt": state["fetchedAt"],
            "attemptAt": state["attemptAt"],
        }

    def accept(self, doc: dict, now: int) -> str:
        with self._lock:
            state = self._load_state()
            current = self._current(state)
            if current is not None and doc["revision"] < current["revision"]:
                return "stale"
            outcome = "same" if current is not None and doc["revision"] == current["revision"] else "new"
            state["fetchedAt"] = now
            state["attemptAt"] = now
            state["doc"] = doc
            self._save_state(state)
            return outcome

    def note_attempt(self, now: int) -> None:
        with self._lock:
            state = self._load_state()
            state["attemptAt"] = now
            self._save_state(state)

    def record_failure(self, revision: Any, name: Any, video_id: Any) -> Optional[bool]:
        with self._lock:
            state = self._load_state()
            doc = self._current(state)
            if doc is None or type(revision) is not int or revision != doc["revision"]:
                return None
            if not any(entry["name"] == name for entry in doc["disguises"]):
                return None
            if not isinstance(video_id, str) or not _VIDEO_ID.fullmatch(video_id):
                return None
            dead = state["dead"] if state["dead"]["revision"] == revision else {"revision": revision, "names": [], "strikes": {}}
            if name not in dead["names"]:
                videos = dead["strikes"].setdefault(name, [])
                if video_id not in videos:
                    videos.append(video_id)
                if len(videos) >= STRIKES_TO_DEAD:
                    dead["names"].append(name)
            state["dead"] = dead
            self._save_state(state)
            return name in dead["names"]
