from pathlib import Path

import json
import re
import time
import zipfile

import decky

from utils import chown_to_data_owner, ensure_dir, to_int


BUNDLE_KIND = "cheevodeck.memories.bundle"

BUNDLE_FORMAT = 1

MANIFEST_NAME = "manifest.json"

RECORDS_PREFIX = "records/"

PICTURES_PREFIX = "pictures/"

VIDEOS_PREFIX = "videos/"

BUNDLE_SUFFIX = ".zip"

_COPY_CHUNK_BYTES = 4 * 1024 * 1024

_MANIFEST_MAX_BYTES = 4 * 1024 * 1024

_RECORDS_MAX_BYTES = 64 * 1024 * 1024

_NAME_COUNTER_LIMIT = 500

_ZIP_EPOCH_YEAR = 1980

ERROR_NOT_A_BUNDLE = "not_a_bundle"
ERROR_FORMAT_TOO_NEW = "format_too_new"
ERROR_MANIFEST_BAD = "manifest_bad"
ERROR_NO_RECORDS = "no_records"
ERROR_MEDIA_MISSING = "media_missing"
ERROR_COUNT_MISMATCH = "count_mismatch"
ERROR_UNREADABLE = "unreadable"

_GAME_KEY_PATTERN = re.compile(r"^-?\d+$")

_TAIL_PATTERN = re.compile(r"^[^/\\\x00-\x1f]+(?:/[^/\\\x00-\x1f]+)*$")


def _safe_tail(raw) -> str:
    if not isinstance(raw, str):
        return ""
    tail = raw.strip()
    if not tail or not _TAIL_PATTERN.match(tail):
        return ""
    if any(part in (".", "..") for part in tail.split("/")):
        return ""
    return tail


def account_tail(relative: str, account_key: str) -> str:
    if not account_key:
        return relative
    prefix = f"{account_key}/"
    return relative[len(prefix):] if relative.startswith(prefix) else relative


def account_path(tail: str, account_key: str) -> str:
    return f"{account_key}/{tail}" if account_key else tail


def bundle_name(stamp: int = 0) -> str:
    when = time.localtime(max(to_int(stamp, 0), 0) or int(time.time()))
    return f"CheevoDeck-Memories-{time.strftime('%Y%m%d-%H%M%S', when)}{BUNDLE_SUFFIX}"


def free_path(target: Path) -> Path:
    if not target.exists():
        return target
    stem = target.stem
    suffix = target.suffix
    for counter in range(2, _NAME_COUNTER_LIMIT):
        candidate = target.with_name(f"{stem}-{counter}{suffix}")
        if not candidate.exists():
            return candidate
    return target.with_name(f"{stem}-{int(time.time())}{suffix}")


def portable_record(memory: dict, account_key: str) -> dict:
    out = dict(memory)
    out["path"] = account_tail(memory.get("path") or "", account_key)
    video = memory.get("video")
    if isinstance(video, dict):
        owned = video.get("path") or ""
        out["video"] = {**video, "path": account_tail(owned, account_key) if owned else ""}
    return out


def landed_record(memory: dict, account_key: str, *, picture_tail: str, video_tail: str) -> dict:
    out = dict(memory)
    out["path"] = account_path(picture_tail, account_key)
    out["appid"] = 0
    video = memory.get("video")
    if isinstance(video, dict):
        placed = account_path(video_tail, account_key) if video_tail else ""
        if placed or video.get("clipId"):
            out["video"] = {**video, "path": placed}
        else:
            out["video"] = None
    return out


def build_manifest(
    *,
    ulid: str,
    schema_version: int,
    games: list,
    total: int,
    videos: int,
    media_bytes: int,
    include_videos: bool,
) -> dict:
    return {
        "kind": BUNDLE_KIND,
        "format": BUNDLE_FORMAT,
        "createdAt": int(time.time()),
        "appVersion": str(getattr(decky, "DECKY_PLUGIN_VERSION", "") or ""),
        "ulid": str(ulid or ""),
        "schemaVersion": int(schema_version),
        "includesVideo": bool(include_videos),
        "games": games,
        "total": int(total),
        "videos": int(videos),
        "bytes": int(media_bytes),
    }


def _normalize_manifest(raw) -> dict:
    if not isinstance(raw, dict):
        return None
    if raw.get("kind") != BUNDLE_KIND:
        return None

    games = []
    for row in raw.get("games", []) or []:
        if not isinstance(row, dict):
            continue
        game_id = to_int(row.get("gameId"), 0)
        title = row.get("gameTitle")
        games.append({
            "gameId": game_id,
            "gameTitle": title if isinstance(title, str) else "",
            "count": to_int(row.get("count"), 0),
        })

    version = raw.get("appVersion")
    ulid = raw.get("ulid")
    return {
        "kind": BUNDLE_KIND,
        "format": to_int(raw.get("format"), 0),
        "createdAt": to_int(raw.get("createdAt"), 0),
        "appVersion": version if isinstance(version, str) else "",
        "ulid": ulid if isinstance(ulid, str) else "",
        "schemaVersion": to_int(raw.get("schemaVersion"), 0),
        "includesVideo": bool(raw.get("includesVideo")),
        "games": games,
        "total": to_int(raw.get("total"), 0),
        "videos": to_int(raw.get("videos"), 0),
        "bytes": to_int(raw.get("bytes"), 0),
    }


def probe(path: Path) -> dict:
    try:
        with zipfile.ZipFile(path) as archive:
            info = archive.getinfo(MANIFEST_NAME)
            if info.file_size > _MANIFEST_MAX_BYTES:
                return {"ok": False, "error": ERROR_NOT_A_BUNDLE}
            raw = json.loads(archive.read(info).decode("utf-8"))
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return {"ok": False, "error": ERROR_NOT_A_BUNDLE}

    manifest = _normalize_manifest(raw)
    if manifest is None:
        return {"ok": False, "error": ERROR_NOT_A_BUNDLE}
    if manifest["format"] < 1:
        return {"ok": False, "error": ERROR_MANIFEST_BAD, "manifest": manifest}
    if manifest["format"] > BUNDLE_FORMAT:
        return {"ok": False, "error": ERROR_FORMAT_TOO_NEW, "manifest": manifest}
    return {"ok": True, "manifest": manifest}


def list_bundles(folder: Path) -> dict:
    try:
        candidates = sorted(p for p in folder.iterdir() if p.is_file())
    except OSError:
        return {"ok": False, "error": ERROR_UNREADABLE, "bundles": [], "scanned": 0}

    bundles = []
    for candidate in candidates:
        found = probe(candidate)
        if not found["ok"]:
            if found["error"] == ERROR_FORMAT_TOO_NEW:
                decky.logger.info(
                    "memories: %s was written by a newer CheevoDeck, skipping it", candidate.name
                )
            continue
        manifest = found["manifest"]
        try:
            size = candidate.stat().st_size
        except OSError:
            size = 0
        bundles.append({
            "path": str(candidate),
            "name": candidate.name,
            "sizeBytes": size,
            "createdAt": manifest["createdAt"],
            "appVersion": manifest["appVersion"],
            "ulid": manifest["ulid"],
            "total": manifest["total"],
            "videos": manifest["videos"],
            "games": len(manifest["games"]),
            "includesVideo": manifest["includesVideo"],
        })

    bundles.sort(key=lambda row: (-row["createdAt"], row["name"].lower()))
    return {"ok": True, "bundles": bundles, "scanned": len(candidates)}


def bundle_sizes(path: Path) -> dict:
    totals = {"total": 0, "pictures": 0, "videos": 0}
    try:
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                totals["total"] += info.file_size
                if info.filename.startswith(PICTURES_PREFIX):
                    totals["pictures"] += info.file_size
                elif info.filename.startswith(VIDEOS_PREFIX):
                    totals["videos"] += info.file_size
    except (OSError, zipfile.BadZipFile):
        return totals
    return totals


def _read_entries(archive: zipfile.ZipFile) -> dict:
    entries = {}
    for name in archive.namelist():
        if not name.startswith(RECORDS_PREFIX) or not name.endswith(".json"):
            continue
        key = name[len(RECORDS_PREFIX):-len(".json")]
        if not _GAME_KEY_PATTERN.match(key):
            continue
        info = archive.getinfo(name)
        if info.file_size > _RECORDS_MAX_BYTES:
            continue
        try:
            raw = json.loads(archive.read(info).decode("utf-8"))
        except (OSError, ValueError, zipfile.BadZipFile):
            return None
        if isinstance(raw, dict):
            entries[key] = raw
    return entries


def validate(path: Path, *, on_bytes=None, should_stop=None) -> dict:
    found = probe(path)
    if not found["ok"]:
        return {"ok": False, "error": found["error"], "manifest": found.get("manifest")}
    manifest = found["manifest"]

    try:
        with zipfile.ZipFile(path) as archive:
            entries = _read_entries(archive)
            if entries is None:
                return {"ok": False, "error": ERROR_UNREADABLE, "manifest": manifest}
            if not entries:
                return {"ok": False, "error": ERROR_NO_RECORDS, "manifest": manifest}

            names = set(archive.namelist())
            records = 0
            videos = 0
            for entry in entries.values():
                for memory in entry.get("memories", []) or []:
                    if not isinstance(memory, dict):
                        continue
                    records += 1
                    tail = _safe_tail(memory.get("path"))
                    if not tail or f"{PICTURES_PREFIX}{tail}" not in names:
                        return {"ok": False, "error": ERROR_MEDIA_MISSING, "manifest": manifest}
                    owned = _safe_tail((memory.get("video") or {}).get("path"))
                    if owned:
                        prefix = f"{VIDEOS_PREFIX}{owned}/"
                        if not any(name.startswith(prefix) for name in names):
                            return {"ok": False, "error": ERROR_MEDIA_MISSING, "manifest": manifest}
                        videos += 1

            if manifest["total"] != records:
                decky.logger.error(
                    "memories: the bundle says %s memories and holds %s",
                    manifest["total"], records,
                )
                return {"ok": False, "error": ERROR_COUNT_MISMATCH, "manifest": manifest}

            for info in archive.infolist():
                if info.is_dir():
                    continue
                if should_stop is not None and should_stop():
                    return {"ok": False, "error": "", "canceled": True, "manifest": manifest}
                try:
                    with archive.open(info) as reader:
                        while True:
                            block = reader.read(_COPY_CHUNK_BYTES)
                            if not block:
                                break
                            if on_bytes is not None:
                                on_bytes(len(block))
                except (OSError, ValueError, zipfile.BadZipFile) as e:
                    decky.logger.error(
                        "memories: %s in the bundle would not read (%s)", info.filename, type(e).__name__
                    )
                    return {"ok": False, "error": ERROR_UNREADABLE, "manifest": manifest}
    except (OSError, zipfile.BadZipFile) as e:
        decky.logger.error("memories: the bundle would not open (%s)", type(e).__name__)
        return {"ok": False, "error": ERROR_UNREADABLE, "manifest": manifest}

    return {
        "ok": True,
        "error": "",
        "canceled": False,
        "manifest": manifest,
        "entries": entries,
        "records": records,
        "videos": videos,
    }


def picture_arcname(tail: str) -> str:
    return f"{PICTURES_PREFIX}{tail}"


def video_prefix(tail: str) -> str:
    return f"{VIDEOS_PREFIX}{tail}/"


def records_arcname(game_key: str) -> str:
    return f"{RECORDS_PREFIX}{game_key}.json"


def safe_tail(raw) -> str:
    return _safe_tail(raw)


def extract_entry(
    archive: zipfile.ZipFile,
    arcname: str,
    destination: Path,
    *,
    on_bytes=None,
    should_stop=None,
) -> bool:
    ensure_dir(destination.parent)
    with archive.open(arcname) as reader, destination.open("wb") as writer:
        chown_to_data_owner(destination)
        while True:
            block = reader.read(_COPY_CHUNK_BYTES)
            if not block:
                break
            writer.write(block)
            if on_bytes is not None:
                on_bytes(len(block))
            if should_stop is not None and should_stop():
                return False
    return True


def _zip_date(source: Path) -> tuple:
    try:
        when = time.localtime(source.stat().st_mtime)
    except OSError:
        return (_ZIP_EPOCH_YEAR, 1, 1, 0, 0, 0)
    if when.tm_year < _ZIP_EPOCH_YEAR:
        return (_ZIP_EPOCH_YEAR, 1, 1, 0, 0, 0)
    return when[:6]


class BundleWriter:

    def __init__(self, destination: Path):
        self._destination = destination
        self._temp = destination.with_name(f"{destination.name}.part")
        self._archive = None

    def open(self) -> None:
        ensure_dir(self._destination.parent)
        self._archive = zipfile.ZipFile(
            self._temp, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True
        )
        chown_to_data_owner(self._temp)

    def add_json(self, arcname: str, payload) -> None:
        self._archive.writestr(arcname, json.dumps(payload, separators=(",", ":")))

    def add_file(self, arcname: str, source: Path, *, on_bytes=None, should_stop=None) -> bool:
        info = zipfile.ZipInfo(arcname, date_time=_zip_date(source))
        info.compress_type = zipfile.ZIP_STORED
        with source.open("rb") as reader, self._archive.open(info, "w") as writer:
            while True:
                block = reader.read(_COPY_CHUNK_BYTES)
                if not block:
                    return True
                writer.write(block)
                if on_bytes is not None:
                    on_bytes(len(block))
                if should_stop is not None and should_stop():
                    return False

    def finish(self) -> Path:
        self._archive.close()
        self._archive = None
        landed = free_path(self._destination)
        self._temp.replace(landed)
        chown_to_data_owner(landed)
        return landed

    def abandon(self) -> None:
        if self._archive is not None:
            try:
                self._archive.close()
            except (OSError, zipfile.BadZipFile):
                pass
            self._archive = None
        try:
            self._temp.unlink()
        except OSError:
            pass
