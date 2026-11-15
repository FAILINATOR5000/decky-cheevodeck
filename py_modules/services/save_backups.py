import asyncio
import hashlib
import os
import re
import shutil
import stat
import threading
import time
from pathlib import Path

import decky
from services import wii_saves
from utils import (
    atomic_file,
    child_owner,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    open_dir,
    save_json_file,
    to_int,
    user_file_target,
)

ROOT = "save-backups"
META = "backup.json"
SCHEMA_VERSION = 1
KEPT = 10
REASONS = ("launch", "couch", "link", "stream", "end", "mid", "wii-copy-back", "restore")
TRIGGERS = ("play", "together", "restore")
STEADY_SECONDS = 5
STEADY_TRIES = 3
OFF_RECHECK_MINUTES = 5
TMP_SUFFIX = ".cheevodeck-tmp"
RUNNING_NAMES = (b"retroarch", b"dolphin-emu")

_GROUP = re.compile(r"[a-z0-9_]{1,64}(-[a-z0-9_]{1,64}){0,2}")
_STAMP = re.compile(r"(\d{14})-(" + "|".join(re.escape(reason) for reason in REASONS) + r")")
_SHA = re.compile(r"[0-9a-f]{64}")
_CORE = re.compile(r"[a-z0-9_]{1,64}")
_TITLE = re.compile(r"[0-9a-f]{16}")
_MATCH = re.compile(r"[0-9A-Z]{2}-[0-9A-Z]{4}-")


class SaveBackups:

    def __init__(self, *, runtime_dir, settings_store, game_settings):
        self._root = Path(runtime_dir) / ROOT
        self._settings_store = settings_store
        self._game_settings = game_settings
        self._follows = {}
        self._lock = threading.RLock()

    def _debug(self, message: str, *args) -> None:
        try:
            on = self._settings_store.get_debug_logging(self._settings_store.load_config())
        except Exception:
            on = False
        if on:
            decky.logger.info("save backups: " + message, *args)

    def has_backups(self, game_id: int) -> bool:
        try:
            return game_id > 0 and any(_GROUP.fullmatch(name) for name in os.listdir(self._root / str(game_id)))
        except OSError:
            return False

    def _wanted(self, target: dict, trigger: str) -> bool:
        game_id = target["gameId"]
        if trigger not in TRIGGERS or game_id < 0:
            return False
        cfg = self._settings_store.load_config()
        play_on = cfg.get("playBackups", True) is not False
        together_on = cfg.get("playTogetherBackups", True) is not False
        if trigger == "play" and not play_on:
            return False
        if trigger == "together" and not together_on:
            return False
        if trigger == "restore" and not (play_on or together_on):
            return False
        if self._game_settings.console_off(target.get("systemId", 0)):
            return False
        return game_id == 0 or not self._game_settings.get(game_id)["off"]

    def restore_backs_up(self, game_id: int, system_id: int) -> bool:
        return self._wanted({"gameId": game_id, "systemId": system_id}, "restore")

    def back_up(self, target: dict, reason: str, trigger: str, spare: str = "") -> bool:
        game_id = target["gameId"]
        group = group_name(target)
        if reason not in REASONS or group is None or not self._wanted(target, trigger):
            return True
        reads = target["paths"]
        if reason == "mid":
            if "live" in target:
                live = target["live"]()
                if live is None:
                    self._debug("%s has no session save to copy yet", game_id)
                    return True
                reads = [live]
            if not _steady(reads):
                self._debug("%s's save is still being written, no mid-session copy this time", game_id)
                return True
        with self._lock:
            try:
                sources = _snapshot(target["paths"], reads, target.get("match", ""))
            except (OSError, wii_saves.Refused) as e:
                decky.logger.warning("save backups: couldn't read the save for %s (%s)", game_id, type(e).__name__)
                return False
            if not sources:
                return True
            folder = self._root / str(game_id) / group
            newest = self._newest(folder)
            if reason != "restore" and newest is not None and _same(newest["sources"], sources):
                self._debug("%s's save hasn't changed since the last backup (%s)", game_id, reason)
                return True
            try:
                self._write(folder, target, reason, sources)
            except (OSError, wii_saves.Refused) as e:
                decky.logger.warning("save backups: couldn't back up the save for %s (%s)", game_id, type(e).__name__)
                return False
            decky.logger.info("save backups: backed up %s (%s, %s)", game_id, group, reason)
            self._prune(folder, spare)
        return True

    def _write(self, folder: Path, target: dict, reason: str, sources: list) -> None:
        ensure_dir(folder)
        moment = int(time.time())
        names = self._backups_in(folder)
        if names:
            try:
                last = int(time.mktime(time.strptime(names[-1][:14], "%Y%m%d%H%M%S")))
            except (ValueError, OverflowError):
                last = 0
            moment = max(moment, last + 1)
        name = f"{time.strftime('%Y%m%d%H%M%S', time.localtime(moment))}-{reason}"
        building = folder / f".{name}{TMP_SUFFIX}"
        if os.path.lexists(building) and not self._remove(building):
            raise wii_saves.Refused("a half-built backup is in the way")
        ensure_dir(building)
        try:
            for source in sources:
                if source["kind"] == "file":
                    _write_bytes(building / source["file"], source["data"])
                    continue
                for relative, data in source["files"].items():
                    path = building / source["file"] / relative
                    ensure_dir(path.parent)
                    _write_bytes(path, data)
            save_json_file(building / META, {
                "schemaVersion": SCHEMA_VERSION,
                "raGameId": target["gameId"],
                "systemId": target.get("systemId", 0),
                "emulator": target["emulator"],
                "install": target.get("install", ""),
                "core": target.get("core", ""),
                "coreName": target.get("coreName", ""),
                "title": target.get("title", ""),
                "reason": reason,
                "at": int(moment),
                "sources": [_recorded(source) for source in sources],
            }, compact=True)
            if not self._inside(folder):
                raise wii_saves.Refused("the backup folder is a link")
            os.rename(building, folder / name)
        except BaseException:
            self._remove(building)
            raise

    def _backups_in(self, folder: Path) -> list:
        try:
            return sorted(name for name in os.listdir(folder) if _STAMP.fullmatch(name))
        except OSError:
            return []

    def _newest(self, folder: Path):
        for name in reversed(self._backups_in(folder)):
            meta = self._meta(folder / name)
            if meta is not None:
                return meta
        return None

    def _prune(self, folder: Path, spare: str) -> None:
        names = self._backups_in(folder)
        extra = len(names) - KEPT
        for name in names:
            if extra <= 0:
                break
            if name != spare:
                self._remove(folder / name)
                extra -= 1

    def _inside(self, path: Path) -> bool:
        try:
            parts = path.relative_to(self._root).parts
        except ValueError:
            return False
        level = self._root
        for part in (None, *parts):
            if part is not None:
                level = level / part
            try:
                if stat.S_ISLNK(os.lstat(level).st_mode):
                    return False
            except FileNotFoundError:
                return True
        return True

    def _remove(self, path: Path) -> bool:
        if not self._inside(path):
            decky.logger.warning("save backups: refusing to remove %s, a folder on its way is a link", path.name)
            return False
        try:
            if not os.path.lexists(path):
                return True
            shutil.rmtree(path)
            return True
        except OSError as e:
            decky.logger.warning("save backups: couldn't remove %s (%s)", path.name, type(e).__name__)
            return False

    def _meta(self, folder: Path):
        raw = load_json_file(folder / META, None)
        if not isinstance(raw, dict) or is_newer_schema(raw, SCHEMA_VERSION):
            return None
        game_id, reason, at, sources = raw.get("raGameId"), raw.get("reason"), raw.get("at"), raw.get("sources")
        if type(game_id) is not int or reason not in REASONS or type(at) is not int or not isinstance(sources, list):
            return None
        cleaned = []
        for source in sources:
            if not isinstance(source, dict):
                return None
            path, file, kind, sha = source.get("path"), source.get("file"), source.get("kind"), source.get("sha256")
            if not (isinstance(path, str) and path.startswith("/") and isinstance(file, str) and _plain_name(file)
                    and kind in ("file", "folder", "files") and isinstance(sha, str) and _SHA.fullmatch(sha)):
                return None
            match = source.get("match")
            if kind == "files" and not (isinstance(match, str) and _MATCH.fullmatch(match)):
                return None
            cleaned.append({"path": path, "file": file, "kind": kind, "sha256": sha, "match": match or ""})
        if not cleaned:
            return None
        texts = {key: raw.get(key) if isinstance(raw.get(key), str) else "" for key in
                 ("emulator", "install", "core", "coreName", "title")}
        system_id = raw.get("systemId") if type(raw.get("systemId")) is int else 0
        return {"raGameId": game_id, "systemId": system_id, "reason": reason, "at": at, "sources": cleaned, **texts}

    def follow(self, key: str, target: dict, trigger: str) -> None:
        self.forget(key)
        self._follows[key] = (target, trigger, asyncio.ensure_future(self._mid_session(target, trigger)))

    async def _mid_session(self, target: dict, trigger: str) -> None:
        while True:
            settings = await asyncio.to_thread(self._game_settings.get, target["gameId"])
            minutes = 0 if settings["off"] else settings["interval"]
            await asyncio.sleep((minutes or OFF_RECHECK_MINUTES) * 60)
            if minutes:
                await asyncio.to_thread(self.back_up, target, "mid", trigger)

    async def end(self, key: str) -> None:
        found = self._follows.pop(key, None)
        if found is None:
            return
        target, trigger, task = found
        task.cancel()
        await asyncio.to_thread(self.back_up, target, "end", trigger)

    def forget(self, key: str) -> None:
        found = self._follows.pop(key, None)
        if found is not None:
            found[2].cancel()

    def stop_timer(self, key: str) -> None:
        found = self._follows.get(key)
        if found is not None:
            found[2].cancel()

    def stop(self) -> None:
        for key in list(self._follows):
            self.forget(key)

    def list_game(self, game_id: int) -> list:
        base = self._root / str(game_id)
        try:
            groups = sorted(name for name in os.listdir(base) if _GROUP.fullmatch(name))
        except OSError:
            return []
        listed = []
        for group in groups:
            rows, label = [], ""
            for name in reversed(self._backups_in(base / group)):
                meta = self._meta(base / group / name)
                if meta is None or meta["raGameId"] != game_id:
                    continue
                label = label or group_label(meta)
                rows.append({"id": f"{group}/{name}", "at": meta["at"], "reason": meta["reason"]})
            if rows:
                listed.append({"group": group, "label": label, "backups": rows})
        return listed

    def system_of(self, game_id: int) -> int:
        base = self._root / str(game_id)
        try:
            groups = sorted(name for name in os.listdir(base) if _GROUP.fullmatch(name))
        except OSError:
            return 0
        for group in groups:
            meta = self._newest(base / group)
            if meta is not None and meta["systemId"]:
                return meta["systemId"]
        return 0

    def restore(self, game_id: int, backup_id: str) -> dict:
        group, _sep, name = str(backup_id).partition("/")
        if game_id <= 0 or not _GROUP.fullmatch(group) or not _STAMP.fullmatch(name):
            return {"ok": False, "error": "gone"}
        if emulator_running():
            return {"ok": False, "error": "running"}
        with self._lock:
            folder = self._root / str(game_id) / group / name
            meta = self._meta(folder) if self._inside(folder) else None
            if meta is None or meta["raGameId"] != game_id:
                return {"ok": False, "error": "gone"}
            for source in meta["sources"]:
                where = source["path"] if source["kind"] == "files" else os.path.dirname(source["path"])
                if not os.path.isdir(where):
                    return {"ok": False, "error": "missing_folder"}
            target = {"gameId": game_id, "systemId": meta["systemId"], "emulator": meta["emulator"],
                      "install": meta["install"], "core": meta["core"], "coreName": meta["coreName"],
                      "title": meta["title"], "paths": [Path(source["path"]) for source in meta["sources"]]}
            match = next((source["match"] for source in meta["sources"] if source["match"]), "")
            if match:
                target["match"] = match
            if group_name(target) != group:
                return {"ok": False, "error": "gone"}
            owner = child_owner()
            try:
                stored = {}
                for source in meta["sources"]:
                    held = folder / source["file"]
                    if source["kind"] == "file":
                        stored[source["file"]] = wii_saves.read_plain(held)
                    elif source["kind"] == "files":
                        stored[source["file"]] = {entry: wii_saves.read_plain(held / entry)
                                                  for entry in _gci_names(held, source["match"])}
                    else:
                        wii_saves.contents(held)
                for source in meta["sources"]:
                    if source["kind"] == "folder" and not os.path.lexists(source["path"]):
                        user_file_target(os.path.dirname(source["path"]), owner)
                    else:
                        user_file_target(source["path"], owner)
            except (OSError, wii_saves.Refused) as e:
                decky.logger.warning("save backups: won't restore %s for %s (%s: %s)", name, game_id,
                                     type(e).__name__, e)
                return {"ok": False, "error": "failed"}
            if not self.back_up(target, "restore", "restore", spare=name):
                return {"ok": False, "error": "failed"}
            try:
                for source in meta["sources"]:
                    path = Path(source["path"])
                    if source["kind"] == "file":
                        _put_file(path, stored[source["file"]])
                    elif source["kind"] == "files":
                        _put_files(path, source["match"], stored[source["file"]])
                    else:
                        if not os.path.lexists(path):
                            ensure_dir(path, trusted=path.parent)
                        wii_saves.match_folder(folder / source["file"], path, exact=True)
            except (OSError, wii_saves.Refused) as e:
                decky.logger.warning("save backups: couldn't restore %s for %s (%s: %s)", name, game_id,
                                     type(e).__name__, e)
                return {"ok": False, "error": "failed"}
        decky.logger.info("save backups: restored %s/%s for %s", group, name, game_id)
        return {"ok": True}

    def clear_game(self, game_id: int) -> bool:
        if game_id < 0:
            return False
        with self._lock:
            return self._remove(self._root / str(game_id))

    def clear_all(self) -> bool:
        with self._lock:
            if not self._inside(self._root):
                decky.logger.warning("save backups: save-backups is a link, not clearing it")
                return False
            try:
                names = os.listdir(self._root)
            except FileNotFoundError:
                return True
            except OSError:
                return False
            ok = True
            for name in names:
                ok = self._remove(self._root / name) and ok
        decky.logger.info("save backups: cleared every backup")
        return ok


def group_name(target: dict):
    emulator = target.get("emulator")
    if emulator == "retroarch":
        core = str(target.get("core") or "").lower()
        return f"retroarch-{core}" if _CORE.fullmatch(core) else None
    if emulator == "dolphin":
        install = target.get("install") or ""
        if install not in ("", "flatpak", "appimage"):
            return None
        group = f"dolphin-{install}" if install else "dolphin"
        title = str(target.get("title") or "").lower()
        if target["gameId"] == 0 and _TITLE.fullmatch(title):
            group = f"{group}-{title}"
        return group
    return None


def group_label(meta: dict) -> str:
    if meta["emulator"] == "retroarch":
        return f"RetroArch · {meta['coreName'] or meta['core']}"
    if meta["install"]:
        return f"Dolphin ({'Flatpak' if meta['install'] == 'flatpak' else 'AppImage'})"
    return "Dolphin"


def emulator_running() -> bool:
    return wii_saves.running(RUNNING_NAMES)


def _plain_name(name: str) -> bool:
    return bool(name) and "/" not in name and "\0" not in name and not name.startswith(".") and len(name) <= 255


def _snapshot(paths, reads, match: str = "") -> list:
    owner = child_owner()
    sources = []
    for path, read in zip(paths, reads, strict=True):
        path = Path(path)
        if not _plain_name(path.name):
            continue
        try:
            real = user_file_target(read, owner)
            st = os.stat(real)
        except FileNotFoundError:
            continue
        if stat.S_ISDIR(st.st_mode):
            if match:
                files = {entry: wii_saves.read_plain(real / entry) for entry in _gci_names(real, match)}
                files = {entry: data for entry, data in files.items() if data}
            else:
                files = {relative: wii_saves.read_plain(real / relative) for relative in sorted(wii_saves.contents(real))
                         if wii_saves.CONFLICT_MARK not in relative}
            if not files:
                continue
            summary = "".join(f"{relative}\0{hashlib.sha1(data).hexdigest()}\n" for relative, data in files.items())
            source = {"path": str(path), "file": path.name, "kind": "files" if match else "folder", "files": files,
                      "sha256": hashlib.sha256(summary.encode("utf-8")).hexdigest()}
            if match:
                source["match"] = match
            sources.append(source)
            continue
        if not stat.S_ISREG(st.st_mode) or st.st_size == 0:
            continue
        data = wii_saves.read_plain(real)
        if not data:
            continue
        sources.append({"path": str(path), "file": path.name, "kind": "file", "data": data,
                        "sha256": hashlib.sha256(data).hexdigest()})
    return sources


def _recorded(source: dict) -> dict:
    kept = {"path": source["path"], "file": source["file"], "kind": source["kind"], "sha256": source["sha256"]}
    if source.get("match"):
        kept["match"] = source["match"]
    return kept


def _gci_names(folder: Path, match: str) -> list:
    names = []
    for entry in sorted(os.listdir(folder)):
        if not (entry.startswith(match) and entry.endswith(".gci") and wii_saves.CONFLICT_MARK not in entry
                and _plain_name(entry)):
            continue
        if stat.S_ISREG(os.lstat(folder / entry).st_mode):
            names.append(entry)
    return names


def _same(kept: list, sources: list) -> bool:
    return {(source["file"], source["sha256"]) for source in kept} == \
        {(source["file"], source["sha256"]) for source in sources}


def _newest_mtime(paths) -> float:
    newest = 0.0
    for path in paths:
        try:
            st = os.stat(path)
        except OSError:
            continue
        if stat.S_ISDIR(st.st_mode):
            for top, _dirs, files in os.walk(path):
                for name in files:
                    try:
                        newest = max(newest, os.lstat(os.path.join(top, name)).st_mtime)
                    except OSError:
                        pass
        newest = max(newest, st.st_mtime)
    return newest


def _steady(paths) -> bool:
    for attempt in range(STEADY_TRIES):
        if time.time() - _newest_mtime(paths) >= STEADY_SECONDS:
            return True
        if attempt + 1 < STEADY_TRIES:
            time.sleep(STEADY_SECONDS)
    return False


def _write_bytes(path: Path, data: bytes) -> None:
    with atomic_file(path, tmp_name=f".{path.name}{TMP_SUFFIX}") as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def _put_file(path: Path, data: bytes) -> None:
    target = user_file_target(path, child_owner())
    _write_into(target.parent, target.name, data)
    _sync_dir(target.parent)


def _put_files(folder: Path, match: str, files: dict) -> None:
    real = user_file_target(folder, child_owner())
    if not real.is_dir():
        raise wii_saves.Refused("the GCI folder isn't a folder")
    have = _gci_names(real, match)
    for entry, data in files.items():
        _write_into(real, entry, data)
    for entry in sorted(set(have) - set(files)):
        fd = open_dir(real, real)
        try:
            os.unlink(entry, dir_fd=fd)
        except FileNotFoundError:
            pass
        finally:
            os.close(fd)
    _sync_dir(real)


def _write_into(folder: Path, name: str, data: bytes) -> None:
    keep = None
    try:
        st = os.lstat(folder / name)
        if not stat.S_ISREG(st.st_mode):
            raise wii_saves.Refused(f"{name} isn't a plain file")
        keep = stat.S_IMODE(st.st_mode)
    except FileNotFoundError:
        pass
    with atomic_file(folder / name, trusted=folder, keep_mode=keep, tmp_name=f".{name}{TMP_SUFFIX}") as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def _sync_dir(folder: Path) -> None:
    fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def clean_game_id(value) -> int:
    game_id = to_int(value, 0)
    return game_id if 0 < game_id < 1 << 31 else 0
