from pathlib import Path

import re
import threading
import time
import uuid

import decky

from local_days import is_month, is_week, parse_day, this_month
from utils import (
    NewerSchemaFile,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    save_json_file,
    to_int,
)


CURRENT_SCHEMA_VERSION = 1

_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
_DEVICE_RE = re.compile(r"^[0-9a-f]{32}$")
_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")

EARLIEST_START = 1325376000

MAX_KINDS_PER_DEVICE = 200
MAX_DEVICES = 32
MAX_DONE_ENTRIES = 5000

SEALED_SCHEMA_VERSION = 1

MAX_SEALED_IDS = 500000
MAX_SEALED_DAYS = 20000


def new_device_id():
    return uuid.uuid4().hex


def _is_ulid(value):
    return isinstance(value, str) and bool(_ULID_RE.match(value))


def _clean_id(value):
    return value if isinstance(value, str) and _ID_RE.match(value) else None


def _clean_count(value):
    if isinstance(value, bool):
        return None
    count = to_int(value, -1)
    return count if count >= 0 else None


def _clean_ts(value):
    if isinstance(value, bool):
        return None
    ts = to_int(value, 0)
    return ts if ts > 0 else None


def _clean_claims(raw):
    out = {}
    if not isinstance(raw, dict):
        return out
    for key, claim in raw.items():
        if _clean_id(key) is None or not isinstance(claim, dict):
            continue
        at = _clean_ts(claim.get("at"))
        xp = _clean_count(claim.get("xp"))
        if at is None or xp is None:
            continue
        out[key] = {"at": at, "xp": xp}
    return out


def _clean_tally(raw):
    out = {}
    if not isinstance(raw, dict):
        return out
    for kind, count in raw.items():
        if len(out) >= MAX_KINDS_PER_DEVICE:
            break
        count = _clean_count(count)
        if _clean_id(kind) is not None and count is not None:
            out[kind] = count
    return out


def _per_device(raw, cleaner):
    out = {}
    if not isinstance(raw, dict):
        return out
    for device, value in raw.items():
        if len(out) >= MAX_DEVICES:
            break
        if not isinstance(device, str) or not _DEVICE_RE.match(device):
            continue
        cleaned = cleaner(value)
        if cleaned is not None:
            out[device] = cleaned
    return out


def _clean_id_list(value):
    if not isinstance(value, list):
        return None
    out = []
    for item in value:
        if _clean_id(item) is not None and item not in out:
            out.append(item)
    return out


def _clean_combo(raw):
    if not isinstance(raw, dict):
        return {"length": 0, "lastDay": None, "xpEarned": 0}
    last_day = raw.get("lastDay") if parse_day(raw.get("lastDay")) is not None else None
    return {
        "length": _clean_count(raw.get("length")) or 0,
        "lastDay": last_day,
        "xpEarned": _clean_count(raw.get("xpEarned")) or 0,
    }


def _clean_done(raw, key_ok):
    out = {}
    if not isinstance(raw, dict):
        return out
    for key, entry in raw.items():
        if len(out) >= MAX_DONE_ENTRIES:
            break
        if not key_ok(key) or not isinstance(entry, dict):
            continue
        quest = _clean_id(entry.get("quest"))
        xp = _clean_count(entry.get("xp"))
        if quest is None or xp is None:
            continue
        out[key] = {"quest": quest, "xp": xp}
    return out


def _clean_period(raw, key_name, key_ok):
    if not isinstance(raw, dict) or not key_ok(raw.get(key_name)):
        return None
    quest = _clean_id(raw.get("quest"))
    if quest is None:
        return None
    return {
        key_name: raw[key_name],
        "quest": quest,
        "rerolled": bool(raw.get("rerolled")),
        "progress": _clean_count(raw.get("progress")) or 0,
        "actions": _clean_tally(raw.get("actions")),
    }


def _clean_derived(raw):
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key in ("at", "beatenAt", "masteredAt"):
        out[key] = _clean_ts(raw.get(key))
    for key in ("unlocks", "hardcore", "activeDays"):
        out[key] = _clean_count(raw.get(key)) or 0
    return out


def _is_day(value):
    return parse_day(value) is not None


def normalize(raw, *, now=None):
    if not isinstance(raw, dict):
        raw = {}
    file_ulid = raw.get("ulid") if _is_ulid(raw.get("ulid")) else None
    device = raw.get("deviceId") if isinstance(raw.get("deviceId"), str) and _DEVICE_RE.match(raw.get("deviceId")) else None
    started = _clean_ts(raw.get("startedAt"))
    if started is not None and now is not None and (started > now or started < EARLIEST_START):
        started = None
    return {
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "ulid": file_ulid,
        "deviceId": device,
        "startedAt": started,
        "claims": _clean_claims(raw.get("claims")),
        "counters": _per_device(raw.get("counters"), _clean_tally),
        "tabsVisited": _per_device(raw.get("tabsVisited"), _clean_id_list),
        "combo": _clean_combo(raw.get("combo")),
        "dailyDone": _clean_done(raw.get("dailyDone"), _is_day),
        "weeklyDone": _clean_done(raw.get("weeklyDone"), is_week),
        "daily": _clean_period(raw.get("daily"), "date", _is_day),
        "weekly": _clean_period(raw.get("weekly"), "week", is_week),
        "lastSeenAt": _per_device(raw.get("lastSeenAt"), _clean_ts),
        "collapsed": _per_device(raw.get("collapsed"), _clean_id_list),
        "rankSeen": _per_device(raw.get("rankSeen"), _clean_count),
        "padSeen": _per_device(raw.get("padSeen"), lambda value: True if value is True else None),
        "derived": _clean_derived(raw.get("derived")),
    }


def empty_sealed():
    return {"sealedThrough": None, "ids": set(), "hardcoreIds": set(), "days": set()}


def _clean_achievement_ids(raw, limit):
    out = set()
    if not isinstance(raw, list):
        return out
    for value in raw:
        if len(out) >= limit:
            break
        if isinstance(value, bool):
            continue
        achievement_id = to_int(value, 0)
        if achievement_id > 0:
            out.add(achievement_id)
    return out


def normalize_sealed(raw, *, ulid, started_at, current_month):
    if not isinstance(raw, dict) or raw.get("ulid") != ulid or _clean_ts(raw.get("startedAt")) != started_at:
        return empty_sealed()
    through = raw.get("sealedThrough")
    if not is_month(through) or through >= current_month:
        return empty_sealed()
    ids = _clean_achievement_ids(raw.get("ids"), MAX_SEALED_IDS)
    hardcore = _clean_achievement_ids(raw.get("hardcoreIds"), MAX_SEALED_IDS) & ids
    days = set()
    for value in raw.get("days") if isinstance(raw.get("days"), list) else []:
        if len(days) >= MAX_SEALED_DAYS:
            break
        if _is_day(value):
            days.add(value)
    return {"sealedThrough": through, "ids": ids, "hardcoreIds": hardcore, "days": days}


def _pick(a, b, key):
    if a is None:
        return b
    if b is None:
        return a
    return a if key(a) >= key(b) else b


def _merge_maps(a, b, combine):
    out = dict(a)
    for key, value in b.items():
        out[key] = combine(out[key], value) if key in out else value
    return out


def _merge_lists(a, b):
    return sorted(set(a) | set(b))


def _done_key(entry):
    return (entry["xp"], entry["quest"])


def _period_key(name):
    return lambda record: (record[name], record["rerolled"], record["progress"], record["quest"])


def _merge_period(a, b, name):
    if a is None or b is None or a[name] != b[name]:
        return _pick(a, b, _period_key(name))
    winner = _pick(a, b, _period_key(name))
    merged = dict(winner)
    merged["actions"] = _merge_maps(a["actions"], b["actions"], max)
    return merged


def _merge_combo(a, b):
    winner = _pick(a, b, lambda c: (c["lastDay"] or "", c["length"], c["xpEarned"]))
    return dict(winner, xpEarned=max(a["xpEarned"], b["xpEarned"]))


def merge(a, b):
    a = normalize(a)
    b = normalize(b)
    if a["ulid"] is None or a["ulid"] != b["ulid"]:
        raise ValueError("milestones files belong to different accounts")

    starts = [ts for ts in (a["startedAt"], b["startedAt"]) if ts is not None]
    claims = _merge_maps(a["claims"], b["claims"], lambda x, y: _pick(x, y, lambda c: (-c["at"], -c["xp"])))
    return {
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "ulid": a["ulid"],
        "deviceId": a["deviceId"] or b["deviceId"],
        "startedAt": min(starts) if starts else None,
        "claims": claims,
        "counters": _merge_maps(a["counters"], b["counters"], lambda x, y: _merge_maps(x, y, max)),
        "tabsVisited": _merge_maps(a["tabsVisited"], b["tabsVisited"], _merge_lists),
        "combo": _merge_combo(a["combo"], b["combo"]),
        "dailyDone": _merge_maps(a["dailyDone"], b["dailyDone"], lambda x, y: _pick(x, y, _done_key)),
        "weeklyDone": _merge_maps(a["weeklyDone"], b["weeklyDone"], lambda x, y: _pick(x, y, _done_key)),
        "daily": _merge_period(a["daily"], b["daily"], "date"),
        "weekly": _merge_period(a["weekly"], b["weekly"], "week"),
        "lastSeenAt": _merge_maps(a["lastSeenAt"], b["lastSeenAt"], max),
        "collapsed": _merge_maps(a["collapsed"], b["collapsed"], _merge_lists),
        "rankSeen": _merge_maps(a["rankSeen"], b["rankSeen"], max),
        "padSeen": _merge_maps(a["padSeen"], b["padSeen"], max),
        "derived": {},
    }


class MilestonesStore:
    def __init__(self, *, base_dir: Path, ulid: str = ""):
        self._base_dir = base_dir
        self._ulid = ulid if _is_ulid(ulid) else ""
        self._lock = threading.Lock()

    def repoint(self, base_dir: Path, ulid: str) -> None:
        with self._lock:
            self._base_dir = base_dir
            self._ulid = ulid if _is_ulid(ulid) else ""

    @property
    def ulid(self) -> str:
        return self._ulid

    def _path(self) -> Path:
        return self._base_dir / "milestones.json"

    def _sealed_path(self) -> Path:
        return self._base_dir / "milestones_sealed.json"

    def _set_aside(self, path, why):
        aside = path.with_name("milestones.foreign-%d.json" % int(time.time()))
        try:
            path.replace(aside)
            decky.logger.warning("milestones: %s, moved %s aside to %s", why, path.name, aside.name)
        except OSError as e:
            decky.logger.warning("milestones: %s, and couldn't move it aside: %s", why, type(e).__name__)
            return False
        return True

    def _fresh(self, now):
        return normalize({
            "ulid": self._ulid,
            "deviceId": new_device_id(),
            "startedAt": now,
        }, now=now)

    def _read(self, now):
        path = self._path()
        raw = load_json_file(path, None)
        if raw is None:
            if path.exists():
                decky.logger.warning("milestones: %s unreadable, starting fresh", path.name)
                self._set_aside(path, "unreadable file")
            return self._fresh(now), True
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(path)
            return None, False
        if not isinstance(raw, dict):
            self._set_aside(path, "file is not an object")
            return self._fresh(now), True
        if raw.get("ulid") != self._ulid:
            reason = "malformed account id" if not _is_ulid(raw.get("ulid")) else "file belongs to another account"
            if self._set_aside(path, reason):
                return self._fresh(now), True
            return None, False
        data = normalize(raw, now=now)
        needs_save = False
        if data["deviceId"] is None:
            data["deviceId"] = new_device_id()
            needs_save = True
        if data["startedAt"] is None:
            data["startedAt"] = _earliest_evidence(data) or now
            needs_save = True
        return data, needs_save

    def _write(self, data):
        ensure_dir(self._base_dir)
        refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
        save_json_file(self._path(), data, compact=True)

    def load(self):
        with self._lock:
            if not self._ulid:
                return None
            now = int(time.time())
            data, needs_save = self._read(now)
            if data is not None and needs_save:
                self._write(data)
            return data

    def mutate(self, change, *, ulid=None):
        with self._lock:
            if not self._ulid or (ulid is not None and ulid != self._ulid):
                return None, None
            now = int(time.time())
            data, needs_save = self._read(now)
            if data is None:
                return None, None
            result = change(data)
            if result or needs_save:
                self._write(data)
            return data, result

    def clear(self) -> bool:
        with self._lock:
            if not self._ulid:
                return False
            try:
                self._path().unlink()
            except FileNotFoundError:
                pass
            try:
                self._sealed_path().unlink()
            except OSError:
                pass
            return True

    def clear_sealed(self) -> None:
        with self._lock:
            if not self._ulid:
                return
            try:
                self._sealed_path().unlink()
            except OSError:
                pass

    def load_sealed(self, started_at):
        with self._lock:
            if not self._ulid:
                return empty_sealed()
            raw = load_json_file(self._sealed_path(), None)
            if is_newer_schema(raw, SEALED_SCHEMA_VERSION):
                report_newer_schema(self._sealed_path())
                return empty_sealed()
            return normalize_sealed(raw, ulid=self._ulid, started_at=started_at, current_month=this_month())

    def save_sealed(self, sealed, started_at) -> bool:
        with self._lock:
            if not self._ulid:
                return False
            path = self._sealed_path()
            try:
                ensure_dir(self._base_dir)
                refuse_newer_file(path, SEALED_SCHEMA_VERSION)
                save_json_file(path, {
                    "schemaVersion": SEALED_SCHEMA_VERSION,
                    "ulid": self._ulid,
                    "startedAt": started_at,
                    "sealedThrough": sealed["sealedThrough"],
                    "ids": sorted(sealed["ids"]),
                    "hardcoreIds": sorted(sealed["hardcoreIds"]),
                    "days": sorted(sealed["days"]),
                }, compact=True)
            except (OSError, NewerSchemaFile) as e:
                decky.logger.warning("milestones: couldn't save the sealed summary: %s", type(e).__name__)
                return False
            return True

    def repair(self) -> list:
        with self._lock:
            path = self._path()
            if not self._ulid or not path.exists():
                return []
            raw = load_json_file(path, None)
            if not isinstance(raw, dict) or is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
                return []
            now = int(time.time())
            if not _is_ulid(raw.get("ulid")):
                return ["ulid"] if self._set_aside(path, "malformed account id") else []
            if raw.get("ulid") != self._ulid:
                return []
            data = normalize(raw, now=now)
            fixed = []
            if data["deviceId"] is None:
                data["deviceId"] = new_device_id()
                fixed.append("deviceId")
            if data["startedAt"] is None:
                data["startedAt"] = _earliest_evidence(data) or now
                fixed.append("startedAt")
            if fixed:
                self._write(data)
            return fixed


def _earliest_evidence(data):
    stamps = [claim["at"] for claim in data["claims"].values()]
    for day in data["dailyDone"]:
        parsed = parse_day(day)
        if parsed is not None:
            stamps.append(int(time.mktime(parsed.timetuple())))
    stamps = [ts for ts in stamps if ts >= EARLIEST_START]
    return min(stamps) if stamps else None
