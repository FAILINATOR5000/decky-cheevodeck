from pathlib import Path

import json
import re
import secrets
import threading
import time

import decky
from multiplayer_protocol import clean_pic, is_ulid

from utils import (
    atomic_file,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    to_int,
)


CURRENT_SCHEMA_VERSION = 1
FILENAME = "multiplayer_friends.json"

MAX_FRIENDS = 500
MAX_REQUESTS = 200
MAX_ALERTS = 20
MAX_OUTBOX = 100
MAX_DISMISSED = 200
MESSAGE_MAX = 500

_DEVICE_RE = re.compile(r"^[0-9a-f]{32}$")
_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
_ID_RE = re.compile(r"^[0-9a-f]{16}$")
_NAME_RE = re.compile(r"^[ -~]{1,32}$")

WAYS = ("in", "out")
VIAS = ("local", "server")


def clean_name(value) -> str:
    if not isinstance(value, str):
        return ""
    value = value.strip()
    return value if _NAME_RE.match(value) else ""


def clean_text(value) -> str:
    if not isinstance(value, str):
        return ""
    if value.isprintable():
        return value.strip()[:MESSAGE_MAX]
    kept = "".join(ch if ch.isprintable() or ch == "\n" else " " for ch in value)
    return kept.strip()[:MESSAGE_MAX]


def _ts(value) -> int:
    if isinstance(value, bool):
        return 0
    stamp = to_int(value, 0)
    return stamp if stamp > 0 else 0


def clean_message(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not _ID_RE.match(raw["id"]):
        return None
    text = clean_text(raw.get("text"))
    if not text or type(raw.get("mine")) is not bool:
        return None
    return {"id": raw["id"], "mine": raw["mine"], "text": text, "at": _ts(raw.get("at"))}


def _hex64(value) -> str:
    return value if isinstance(value, str) and _HEX64_RE.match(value) else ""


def _friend(raw):
    if not isinstance(raw, dict) or not is_ulid(raw.get("ulid")) or not _hex64(raw.get("pairKey")):
        return None
    name = clean_name(raw.get("name"))
    if not name:
        return None
    return {
        "ulid": raw["ulid"],
        "name": name,
        "pairKey": raw["pairKey"],
        "userPic": clean_pic(raw.get("userPic")),
        "added": _ts(raw.get("added")),
        "via": raw.get("via") if raw.get("via") in VIAS else "server",
        "healedAt": _ts(raw.get("healedAt")),
        "healTriedAt": _ts(raw.get("healTriedAt")),
    }


def _request(raw):
    if not isinstance(raw, dict) or not is_ulid(raw.get("ulid")) or raw.get("way") not in WAYS:
        return None
    name = clean_name(raw.get("name"))
    key = _hex64(raw.get("pairKey"))
    if not name or not key:
        return None
    return {
        "ulid": raw["ulid"],
        "name": name,
        "userPic": clean_pic(raw.get("userPic")),
        "at": _ts(raw.get("at")),
        "way": raw["way"],
        "pairKey": key,
        "via": raw.get("via") if raw.get("via") in VIAS else "server",
    }


def _rows(raw: dict, name: str) -> list:
    value = raw.get(name)
    return value if isinstance(value, list) else []


def _unique(rows, limit):
    seen = set()
    out = []
    for row in rows:
        if row is None or row["ulid"] in seen:
            continue
        seen.add(row["ulid"])
        out.append(row)
    return out[-limit:]


def normalize(raw: dict) -> dict:
    friends = _unique([_friend(row) for row in _rows(raw, "friends")], MAX_FRIENDS)
    friend_ids = {friend["ulid"] for friend in friends}
    requests = _unique([_request(row) for row in _rows(raw, "requests")], MAX_REQUESTS)
    requests = [request for request in requests if request["way"] == "in" or request["ulid"] not in friend_ids]
    raw_read = raw.get("lastRead") if isinstance(raw.get("lastRead"), dict) else {}
    raw_unread = raw.get("unread") if isinstance(raw.get("unread"), dict) else {}
    raw_newest = raw.get("newestAt") if isinstance(raw.get("newestAt"), dict) else {}
    alerts = []
    for row in _rows(raw, "alerts"):
        if isinstance(row, dict) and isinstance(row.get("device"), str) and _DEVICE_RE.match(row["device"]):
            alerts.append({"device": row["device"], "at": _ts(row.get("at"))})
    outbox = []
    for row in _rows(raw, "outbox"):
        if isinstance(row, dict) and row.get("op") == "remove" and is_ulid(row.get("ulid")) and _hex64(row.get("t")):
            outbox.append({"op": "remove", "ulid": row["ulid"], "t": row["t"]})
    known = friend_ids | {request["ulid"] for request in requests}
    dismissed = []
    for ulid in _rows(raw, "dismissed"):
        if is_ulid(ulid) and ulid not in known and ulid not in dismissed:
            dismissed.append(ulid)
    device = raw.get("deviceId")
    return {
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "ulid": raw.get("ulid") if is_ulid(raw.get("ulid")) else "",
        "deviceId": device if isinstance(device, str) and _DEVICE_RE.match(device) else None,
        "deviceSecret": _hex64(raw.get("deviceSecret")) or None,
        "selfPic": clean_pic(raw.get("selfPic")),
        "selfPicAt": _ts(raw.get("selfPicAt")),
        "friends": friends,
        "requests": requests,
        "lastRead": {ulid: _ts(at) for ulid, at in raw_read.items() if ulid in friend_ids and _ts(at)},
        "unread": {ulid: _ts(count) for ulid, count in raw_unread.items() if ulid in friend_ids and _ts(count)},
        "newestAt": {ulid: _ts(at) for ulid, at in raw_newest.items() if ulid in friend_ids and _ts(at)},
        "alerts": alerts[-MAX_ALERTS:],
        "outbox": outbox[-MAX_OUTBOX:],
        "dismissed": dismissed[-MAX_DISMISSED:],
    }


def _new_identity(data: dict) -> list:
    fixed = []
    if data["deviceId"] is None:
        data["deviceId"] = secrets.token_hex(16)
        fixed.append("deviceId")
    if data["deviceSecret"] is None:
        data["deviceSecret"] = secrets.token_hex(32)
        fixed.append("deviceSecret")
    return fixed


class MultiplayerFriendsStore:
    def __init__(self, *, base_dir: Path, ulid: str = ""):
        self._base_dir = base_dir
        self._ulid = ulid if is_ulid(ulid) else ""
        self._lock = threading.Lock()

    def repoint(self, base_dir: Path, ulid: str) -> None:
        with self._lock:
            self._base_dir = base_dir
            self._ulid = ulid if is_ulid(ulid) else ""

    @property
    def ulid(self) -> str:
        return self._ulid

    def _path(self) -> Path:
        return self._base_dir / FILENAME

    def _set_aside(self, path, why) -> bool:
        aside = path.with_name("multiplayer_friends.foreign-%d.json" % int(time.time()))
        try:
            path.replace(aside)
            decky.logger.warning("friends: %s, moved %s aside to %s", why, path.name, aside.name)
        except OSError as e:
            decky.logger.warning("friends: %s, and couldn't move it aside: %s", why, type(e).__name__)
            return False
        return True

    def _fresh(self) -> dict:
        data = normalize({"ulid": self._ulid})
        _new_identity(data)
        return data

    def _read(self):
        path = self._path()
        raw = load_json_file(path, None)
        if raw is None:
            if path.exists():
                self._set_aside(path, "unreadable file")
            return self._fresh(), True
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(path)
            return None, False
        if not isinstance(raw, dict) or raw.get("ulid") != self._ulid:
            if self._set_aside(path, "file belongs to another account"):
                return self._fresh(), True
            return None, False
        data = normalize(raw)
        return data, bool(_new_identity(data))

    def _write(self, data: dict) -> None:
        ensure_dir(self._base_dir)
        refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
        with atomic_file(self._path(), keep_mode=0o600) as out:
            out.write(json.dumps(data, separators=(",", ":")).encode("utf-8"))

    def load(self):
        with self._lock:
            if not self._ulid:
                return None
            raw = load_json_file(self._path(), None)
            if not isinstance(raw, dict) or is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
                return None
            if raw.get("ulid") != self._ulid:
                return None
            return normalize(raw)

    def ensure(self):
        data, _result = self.mutate(lambda _data: False)
        return data

    def mutate(self, change, *, ulid=None):
        with self._lock:
            if not self._ulid or (ulid is not None and ulid != self._ulid):
                return None, None
            try:
                data, needs_save = self._read()
                if data is None:
                    return None, None
                result = change(data)
                if result or needs_save:
                    self._write(data)
            except OSError as e:
                decky.logger.warning("friends: couldn't save (%s)", type(e).__name__)
                return None, None
            return data, result

    def repair(self) -> list:
        with self._lock:
            path = self._path()
            if not self._ulid or not path.exists():
                return []
            raw = load_json_file(path, None)
            if not isinstance(raw, dict) or is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
                return []
            if raw.get("ulid") != self._ulid:
                return []
            data = normalize(raw)
            fixed = _new_identity(data)
            if path.stat().st_mode & 0o077:
                fixed.append("mode")
            if fixed:
                self._write(data)
            return fixed
