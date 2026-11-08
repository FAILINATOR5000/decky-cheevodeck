import hashlib
import os
import re
import secrets
import shutil
import stat
import struct
import threading
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from collections import deque
from pathlib import Path

import decky

import emulator_catalog as catalog
import multiplayer_session as session
import steam_shortcuts
import subprocess_util
from cheevo_check_systems import by_console_id
from ra_client import build_user_agent
from utils import child_owner, chown_to_data_owner, ensure_dir, exclusive_file, load_json_file, save_json_file


FLATPAK_SECONDS = 30
WORK_FOLDER = "emulators"
JOURNAL_FILE = "emulators_plan.json"
JOB_EVENT = "emulator_job"
PROGRESS_SECONDS = 0.5
FETCH_SECONDS = 20
DOWNLOAD_SECONDS = 1800
EXTRACT_SECONDS = 1200
STOP_SECONDS = 5
CHUNK = 1 << 16
PACK_MAX = 1 << 30
INFO_MAX = 8 << 20
PACK_LINGER_SECONDS = 30 * 60
SPACE_MARGIN = 64 << 20
STABLE_URL = "https://buildbot.libretro.com/stable/"
PACK_URL = STABLE_URL + "{version}/linux/x86_64/RetroArch_cores.7z"
INFO_URL = "https://buildbot.libretro.com/assets/frontend/info.zip"
PACK_PATH = "RetroArch-Linux-x86_64/RetroArch-Linux-x86_64.AppImage.home/.config/retroarch/cores/{core}_libretro.so"
PACK_PREFIX = "cores-"
DOWNLOAD_PREFIX = ".download-"
PROCESS_NAMES = {
    "retroarch": ("retroarch",),
    "dolphin": ("dolphin-emu", "dolphin-emu-nogui"),
    "pcsx2": ("pcsx2-qt", "pcsx2"),
    "duckstation": ("duckstation-qt", "duckstation"),
    "ppsspp": ("PPSSPPSDL", "PPSSPPQt", "ppsspp"),
    "rmg": ("RMG",),
    "melonds": ("melonDS",),
}

_CORE = re.compile(r"^[A-Za-z0-9_+.-]{1,64}$")
_STABLE = re.compile(r"^\d+(?:\.\d+)+$")


class StepFailed(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code


def path_key(path: str) -> str:
    return hashlib.sha256(path.encode("utf-8")).hexdigest()[:16]


def file_crc(path) -> str:
    crc = 0
    with open(path, "rb") as handle:
        while True:
            block = handle.read(1 << 20)
            if not block:
                break
            crc = zlib.crc32(block, crc)
    return f"{crc & 0xFFFFFFFF:08x}"


def running(kind: str) -> bool:
    names = {name[:15] for name in PROCESS_NAMES.get(kind, ())}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/comm", encoding="utf-8", errors="replace") as handle:
                if handle.read().strip() in names:
                    return True
        except OSError:
            continue
    return False


def free_bytes(path) -> int:
    try:
        st = os.statvfs(path)
    except OSError:
        return 0
    return st.f_bavail * st.f_frsize


class EmulatorService:
    def __init__(self, *, user_home, runtime_dir, ssl_context, store, cheevo_check_store, emit=None):
        self._user_home = Path(user_home)
        self._runtime_dir = Path(runtime_dir)
        self._ssl_context = ssl_context
        self._store = store
        self._cheevo_check_store = cheevo_check_store
        self._emit = emit
        self._lock = threading.Lock()
        self._inventory = None
        self._versions = {}
        self._games = (None, frozenset())
        self._crcs = {}
        self._zip_infos = (None, {})
        self._jobs = deque()
        self._job = None
        self._runner = None
        self._job_lock = threading.Condition()
        self._stop = threading.Event()
        self._repaired = False
        self._state = None
        self._said = (None, 0.0, -2)
        self._pack = None
        self._pack_timer = None

    def _work_dir(self) -> Path:
        return self._runtime_dir / WORK_FOLDER

    def _flatpak_env(self) -> dict:
        owner = child_owner()
        uid = owner[0] if owner else os.getuid()
        return {
            "HOME": str(self._user_home),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "XDG_RUNTIME_DIR": f"/run/user/{uid}",
            "XDG_DATA_HOME": str(self._user_home / ".local" / "share"),
        }

    def _run(self, argv, timeout=FLATPAK_SECONDS, cancel=None):
        try:
            return subprocess_util.run_command(argv, timeout=timeout, env=self._flatpak_env(), as_data_owner=True,
                                               cancel=cancel)
        except Exception as e:
            return 1, "", type(e).__name__

    def _flatpaks(self):
        code, out, _err = self._run(["flatpak", "list", "--app", "--columns=application,version,installation"])
        if code != 0:
            return None
        found = {}
        for line in out.splitlines():
            parts = [part.strip() for part in line.split("\t")]
            if len(parts) >= 3 and parts[0]:
                found[parts[0]] = {"version": parts[1], "scope": "system" if parts[2] == "system" else "user"}
        return found

    def _appimage_version(self, image: str) -> str:
        try:
            st = os.stat(image)
        except OSError:
            return ""
        key = (image, st.st_mtime_ns, st.st_size)
        if key not in self._versions:
            self._versions[key] = self._read_appimage_version(image) or catalog.version_from_name(Path(image).name)
        return self._versions[key]

    def _read_appimage_version(self, image: str) -> str:
        work = self._work_dir() / ".work"
        folder = work / f"appimage-{secrets.token_hex(4)}"
        try:
            ensure_dir(folder)
            code, _out, _err = self._run(
                ["sh", "-c", 'cd "$1" && exec "$2" --appimage-extract "*.desktop"', "sh", str(folder), image])
            if code != 0:
                return ""
            for desktop in (folder / "squashfs-root").glob("*.desktop"):
                for line in desktop.read_text(encoding="utf-8", errors="replace").splitlines():
                    if line.startswith("X-AppImage-Version="):
                        return line.split("=", 1)[1].strip()[:64]
        except Exception as e:
            decky.logger.info("emulators: couldn't read %s's version (%s)", Path(image).name, type(e).__name__)
        finally:
            shutil.rmtree(folder, ignore_errors=True)
        return ""

    def _launcher_images(self, tools: Path) -> list:
        found = []
        try:
            shortcuts = steam_shortcuts.emulator_shortcuts(self._user_home)
        except Exception as e:
            decky.logger.info("emulators: couldn't read Steam's shortcuts (%s)", type(e).__name__)
            shortcuts = []
        for shortcut in shortcuts:
            found.extend(catalog.command_images(shortcut["exe"], shortcut["launchOptions"], self._user_home))
        launchers = tools / "launchers"
        if not catalog.under_desktop(launchers, self._user_home):
            try:
                scripts = sorted(entry.path for entry in os.scandir(launchers)
                                 if entry.name.endswith(".sh") and entry.is_file())
            except OSError:
                scripts = []
            for script in scripts:
                found.extend(catalog.script_images(script, self._user_home,
                                                   catalog.kind_by_name(Path(script).stem)))
        return found

    def _candidates(self, folders) -> list:
        seen = []
        for folder in folders:
            if catalog.under_desktop(folder, self._user_home):
                continue
            try:
                entries = sorted(os.scandir(folder), key=lambda entry: entry.name)
            except OSError:
                continue
            for entry in entries:
                if catalog.is_candidate(entry.name) and entry.is_file() and entry.path not in seen:
                    seen.append(entry.path)
        return seen

    def _identify(self, path: str, pointed: dict, launched: dict):
        for kind, paths in pointed.items():
            if path in paths:
                return kind, "pointed"
        source = catalog.update_source(catalog.update_info(path))
        if source:
            kind = catalog.kind_by_repo(source["repo"])
            if kind:
                return kind, "updInfo"
        if path in launched:
            return launched[path], "launcher"
        kind = catalog.kind_by_name(Path(path).name)
        return (kind, "name") if kind else ("", "")

    def _appimage_row(self, path: str, how: str, record: dict) -> dict:
        source = catalog.update_source(catalog.update_info(path))
        ours = record["installed"]["appimages"].get(path)
        return {
            "path": path,
            "key": path_key(path),
            "fileName": Path(path).name,
            "version": self._appimage_version(path),
            "repo": source.get("repo") or (ours or {}).get("repo") or "",
            "howFound": how,
            "ours": ours is not None,
            "missing": False,
            "latest": "",
            "newerThanStable": False,
        }

    def _standalones(self, record: dict, flatpaks) -> list:
        emudeck = catalog.emudeck_paths(self._user_home)
        launched = {}
        for kind, image in self._launcher_images(emudeck["toolsPath"]):
            if not catalog.under_desktop(image, self._user_home):
                launched.setdefault(image, kind)
        folders = [self._user_home / relative for relative in catalog.SEARCH_FOLDERS]
        folders.append(emudeck["toolsPath"])
        for image in launched:
            folders.append(Path(image).parent)
        pointed = record["paths"]
        candidates = self._candidates(folders)
        for image in launched:
            if image not in candidates and os.path.isfile(image) and catalog.is_candidate(Path(image).name):
                candidates.append(image)
        rows = {kind: [] for kind in catalog.STANDALONES}
        for path in candidates:
            kind, how = self._identify(path, pointed, launched)
            if kind in rows:
                rows[kind].append(self._appimage_row(path, how, record))
        for kind, paths in pointed.items():
            for path in paths:
                if kind in rows and not any(row["path"] == path for row in rows[kind]):
                    if os.path.isfile(path):
                        rows[kind].append(self._appimage_row(path, "pointed", record))
                    else:
                        rows[kind].append({"path": path, "key": path_key(path), "fileName": Path(path).name,
                                           "version": "", "repo": "", "howFound": "pointed", "ours": False,
                                           "missing": True, "latest": "", "newerThanStable": False})
        emulators = []
        for kind in catalog.STANDALONES:
            entry = catalog.BY_KIND[kind]
            emulators.append({
                "kind": kind,
                "name": entry["name"],
                "achievements": entry["achievements"],
                "flatpak": self._flatpak_row(entry, flatpaks),
                "appimages": rows[kind],
                "found": bool(rows[kind]) or bool(flatpaks and entry["flatpak"] in flatpaks),
            })
        return emulators

    def _flatpak_row(self, entry: dict, flatpaks) -> dict:
        installed = (flatpaks or {}).get(entry["flatpak"])
        return {
            "id": entry["flatpak"],
            "installed": installed is not None,
            "version": installed["version"] if installed else "",
            "scope": installed["scope"] if installed else "",
            "latest": "",
            "newerThanStable": False,
        }

    def _systems_with_games(self) -> frozenset:
        stamp = self._cheevo_check_store.results_fingerprint()
        if stamp is not None and self._games[0] == stamp:
            return self._games[1]
        results = self._cheevo_check_store.load_results() if stamp is not None else None
        systems = set()
        for game in (results or {}).get("supportedGames") or []:
            if isinstance(game, dict) and type(game.get("systemId")) is int:
                systems.add(game["systemId"])
        self._games = (stamp, frozenset(systems))
        return self._games[1]

    def _info_cores(self, ra) -> dict:
        try:
            names = sorted(os.listdir(ra.info_dir))
        except OSError:
            names = []
        cores = dict(self._infos_from_zip())
        for name in names:
            if name.endswith("_libretro.info"):
                core = name[: -len("_libretro.info")]
                info = ra.info(core)
                if info is not None:
                    cores[core] = info
        return cores

    def _infos_from_zip(self) -> dict:
        path = self._work_dir() / "info.zip"
        try:
            stamp = os.stat(path).st_mtime_ns
        except OSError:
            return {}
        if self._zip_infos[0] == stamp:
            return self._zip_infos[1]
        infos = {}
        try:
            with zipfile.ZipFile(path) as archive:
                for member in archive.infolist():
                    name = member.filename.rsplit("/", 1)[-1]
                    if name.endswith("_libretro.info") and member.file_size <= 65536:
                        text = archive.read(member).decode("utf-8", "replace")
                        infos[name[: -len("_libretro.info")]] = catalog.parse_info(text)
        except (OSError, zipfile.BadZipFile) as e:
            decky.logger.info("emulators: couldn't read the core info list (%s)", type(e).__name__)
        self._zip_infos = (stamp, infos)
        return infos

    def _crc(self, path, st) -> str:
        key = (str(path), st.st_mtime_ns, st.st_size)
        if key not in self._crcs:
            try:
                self._crcs[key] = file_crc(path)
            except OSError:
                return ""
        return self._crcs[key]

    def _core_state(self, ra, core: str, packed: dict, ours: dict) -> dict:
        path = ra.core_path(core)
        state = {"installed": False, "ours": False, "update": False, "newerThanStable": False}
        try:
            st = os.stat(path)
        except OSError:
            return state
        state["installed"] = True
        stable = packed.get(core)
        record = ours.get(core)
        if record is None and (stable is None or st.st_size != stable["size"]):
            state["newerThanStable"] = stable is not None
            return state
        crc = self._crc(path, st)
        state["ours"] = record is not None and record["crc"] == crc
        if stable is not None and crc != stable["crc"]:
            state["update"] = state["ours"]
            state["newerThanStable"] = not state["ours"]
        return state

    def _retroarch(self, record: dict, flatpaks, network: bool) -> dict:
        entry = catalog.BY_KIND[catalog.RETROARCH]
        ra = session.RetroArch(self._user_home)
        flatpak = self._flatpak_row(entry, flatpaks)
        bundle = self._ensure_index(flatpak["version"], network) if ra.found else {}
        infos = self._info_cores(ra) if ra.found else {}
        packed = bundle.get("cores") or {}
        ours = record["installed"]["cores"]
        games = self._systems_with_games()
        states = {}
        systems = []
        for system_id in catalog.SYSTEM_DATABASES:
            cores = []
            for core, info in infos.items():
                if not catalog.runs_system(catalog.core_databases(info), system_id):
                    continue
                if core not in states:
                    states[core] = self._core_state(ra, core, packed, ours)
                if packed and core not in packed and not states[core]["installed"]:
                    continue
                cores.append({
                    "core": core,
                    "name": info.get("corename") or core,
                    "version": ra.version(core) if states[core]["installed"] else "",
                    "size": (packed.get(core) or {}).get("size", 0),
                    **states[core],
                })
            if not cores:
                continue
            cores.sort(key=lambda row: row["name"].lower())
            names = [row["core"] for row in cores]
            recommended = catalog.RECOMMENDED_CORES.get(system_id)
            system = by_console_id(system_id)
            systems.append({
                "id": system_id,
                "name": system.name if system is not None else catalog.SYSTEM_DATABASES[system_id][0],
                "hasGames": system_id in games,
                "recommendedCore": recommended if recommended in names else names[0],
                "cores": cores,
            })
        systems.sort(key=lambda row: (not row["hasGames"], row["name"].lower()))
        return {
            "kind": catalog.RETROARCH,
            "name": entry["name"],
            "flatpak": flatpak,
            "found": ra.found or flatpak["installed"],
            "configFound": ra.found,
            "coresDir": str(ra.cores_dir) if ra.found else "",
            "stable": bundle.get("raVersion", ""),
            "packSize": bundle.get("packSize", 0),
            "updates": sum(1 for state in states.values() if state["update"]),
            "systems": systems,
        }

    def inventory(self, refresh: bool = False, network: bool = True) -> dict:
        with self._lock:
            if self._inventory is not None and not refresh:
                return self._inventory
            record = self._store.get()
            flatpaks = self._flatpaks()
            self._inventory = {
                "ok": True,
                "appsDir": str(self._user_home / "Applications"),
                "flatpakAvailable": flatpaks is not None,
                "retroarch": self._retroarch(record, flatpaks, network),
                "emulators": self._standalones(record, flatpaks),
            }
            return self._inventory

    def identify(self, path: str) -> dict:
        path = os.path.abspath(path)
        if not catalog.is_candidate(Path(path).name) or catalog.under_desktop(path, self._user_home) \
                or not os.path.isfile(path):
            return {"ok": False, "error": "not_appimage"}
        source = catalog.update_source(catalog.update_info(path))
        kind = catalog.kind_by_repo(source["repo"]) if source else ""
        return {"ok": True, "path": path, "kind": kind or catalog.kind_by_name(Path(path).name)}

    def point(self, kind: str, path: str) -> dict:
        if kind not in catalog.STANDALONES:
            return {"ok": False, "error": "not_found"}
        found = self.identify(path)
        if not found["ok"]:
            return found

        def edit(record):
            for paths in record["paths"].values():
                if found["path"] in paths:
                    paths.remove(found["path"])
            record["paths"].setdefault(kind, []).insert(0, found["path"])

        saved = self._store.change(edit)
        return {"ok": saved, "inventory": self.inventory(refresh=True)}

    def forget(self, kind: str, path: str) -> dict:
        def edit(record):
            paths = record["paths"].get(kind) or []
            if path in paths:
                paths.remove(path)

        saved = self._store.change(edit)
        return {"ok": saved, "inventory": self.inventory(refresh=True)}

    def _open(self, url: str, headers=None, timeout=FETCH_SECONDS):
        request = urllib.request.Request(url, headers={"User-Agent": build_user_agent(), **(headers or {})})
        return urllib.request.urlopen(request, timeout=timeout, context=self._ssl_context)

    def _range(self, url: str, start: int, length: int):
        with self._open(url, {"Range": f"bytes={start}-{start + length - 1}"}) as response:
            data = response.read(length + 1)
            total = response.headers.get("Content-Range", "").rpartition("/")[2]
            partial = response.status == 206
        if not partial or len(data) != length or not total.isdigit():
            raise StepFailed("no_network", "range read refused")
        return data, int(total)

    def _latest_stable(self) -> str:
        with self._open(STABLE_URL) as response:
            listing = response.read(1 << 20).decode("utf-8", "replace")
        versions = catalog.stable_versions(listing)
        if not versions:
            raise StepFailed("no_network", "no stable versions listed")
        return versions[-1]

    def _read_index(self, version: str) -> dict:
        url = PACK_URL.format(version=version)
        start, total = self._range(url, 0, 32)
        if start[:6] != b"7z\xbc\xaf\x27\x1c":
            raise StepFailed("failed", "not a 7z pack")
        offset, size, _crc = struct.unpack("<QQI", start[12:32])
        if not 0 < size <= 1 << 20 or 32 + offset + size > total:
            raise StepFailed("failed", "pack header out of range")
        header, _total = self._range(url, 32 + offset, size)
        parts = [(0, start), (32 + offset, header)]
        if header[0] == 0x17:
            if header[1] != 0x06:
                raise StepFailed("failed", "pack header unreadable")
            packed_at, at = catalog.seven_zip_number(header, 2)
            _streams, at = catalog.seven_zip_number(header, at)
            if header[at] != 0x09:
                raise StepFailed("failed", "pack header unreadable")
            packed_size, at = catalog.seven_zip_number(header, at + 1)
            if not 0 < packed_size <= 1 << 22 or 32 + packed_at + packed_size > total:
                raise StepFailed("failed", "pack header out of range")
            packed, _total = self._range(url, 32 + packed_at, packed_size)
            parts.append((32 + packed_at, packed))
        elif header[0] != 0x01:
            raise StepFailed("failed", "pack header unreadable")
        folder = self._work_dir() / ".work"
        ensure_dir(folder)
        sparse = folder / f"index-{secrets.token_hex(4)}.7z"
        try:
            with exclusive_file(sparse, trusted=self._runtime_dir) as out:
                out.truncate(total)
                for at, data in parts:
                    out.seek(at)
                    out.write(data)
            code, listing, err = self._run(["7z", "l", "-slt", str(sparse)], FETCH_SECONDS, self._stop)
        finally:
            try:
                os.unlink(sparse)
            except OSError:
                pass
        cores = catalog.pack_listing(listing) if code == 0 else {}
        if not cores:
            raise StepFailed("failed", f"pack listing failed ({code}: {err.strip()[-200:]})")
        return {"raVersion": version, "packSize": total, "cores": cores}

    def _fetch_info(self) -> None:
        folder = self._work_dir()
        ensure_dir(folder)
        with self._open(INFO_URL) as response:
            data = response.read(INFO_MAX + 1)
        if len(data) > INFO_MAX:
            raise StepFailed("failed", "info list larger than expected")
        save_path = folder / "info.zip"
        with exclusive_file(folder / ".info.zip.tmp", trusted=self._runtime_dir, replace=True) as out:
            out.write(data)
        os.replace(folder / ".info.zip.tmp", save_path)

    def _ensure_index(self, ra_version: str, network: bool) -> dict:
        bundle = self._store.get()["bundle"]
        wanted = ra_version if _STABLE.match(ra_version or "") else ""
        if bundle and (not wanted or bundle["raVersion"] == wanted):
            return bundle
        if not network:
            return bundle
        try:
            try:
                fetched = self._read_index(wanted or self._latest_stable())
            except urllib.error.HTTPError as e:
                if e.code != 404 or not wanted:
                    raise
                fetched = self._read_index(self._latest_stable())
            try:
                self._fetch_info()
            except (StepFailed, urllib.error.URLError, OSError) as e:
                decky.logger.info("emulators: couldn't fetch the core info list (%s)", type(e).__name__)
        except (StepFailed, urllib.error.URLError, OSError, ValueError, IndexError, struct.error) as e:
            decky.logger.info("emulators: couldn't read the stable core pack's index (%s: %s)", type(e).__name__, e)
            return bundle
        self._store.change(lambda record: record.__setitem__("bundle", fetched))
        decky.logger.info("emulators: indexed RetroArch %s's stable cores (%d)", fetched["raVersion"],
                          len(fetched["cores"]))
        return self._store.get()["bundle"]

    def _say(self, job: dict, stage: str, progress: int = -1, *, step=None, error: str = "", left=None) -> None:
        step = job.get("at", 0) if step is None else step
        now = time.monotonic()
        marker = (job["id"], stage, step)
        if self._said[0] == marker and stage in ("download", "flatpak") and \
                (progress == self._said[2] or now - self._said[1] < PROGRESS_SECONDS):
            return
        self._said = (marker, now, progress)
        self._state = {
            "job": job["id"],
            "kind": job["kind"],
            "target": job["target"],
            "names": job["names"],
            "stage": stage,
            "progress": progress,
            "step": step,
            "steps": len(job["steps"]),
            "error": error,
            "left": left or [],
            "kept": job.get("kept", 0),
        }
        if self._emit is not None:
            self._emit(JOB_EVENT, dict(self._state))

    def status(self) -> dict:
        with self._job_lock:
            busy = self._job is not None or bool(self._jobs)
            queued = [job["id"] for job in self._jobs]
        return {"ok": True, "busy": busy, "queued": queued, "state": self._state}

    def _submit(self, kind: str, steps: list, *, target: str = "", names=None, kept: int = 0) -> dict:
        if not self._repaired:
            self.repair()
        job = {"id": secrets.token_hex(6), "kind": kind, "steps": steps, "target": target,
               "names": list(names or []), "kept": kept}
        with self._job_lock:
            self._jobs.append(job)
            if self._runner is None:
                self._runner = threading.Thread(target=self._run_jobs, name="emulator-jobs", daemon=True)
                self._runner.start()
            self._job_lock.notify()
        self._say(job, "queued")
        return {"ok": True, "job": job["id"], "kept": kept}

    def _run_jobs(self) -> None:
        while True:
            with self._job_lock:
                if not self._jobs or self._stop.is_set():
                    self._runner = None
                    return
                job = self._jobs.popleft()
                self._job = job
            try:
                self._run_job(job)
            finally:
                with self._job_lock:
                    self._job = None

    def _journal_path(self) -> Path:
        return self._runtime_dir / JOURNAL_FILE

    def _journal_write(self, journal: dict) -> None:
        save_json_file(self._journal_path(), journal, compact=True)

    def _note(self, journal: dict, undo: dict) -> None:
        journal["done"].append(undo)
        self._journal_write(journal)

    def _run_job(self, job: dict) -> None:
        if self._pack_timer is not None:
            self._pack_timer.cancel()
        journal = {"schemaVersion": 1, "job": job["id"], "kind": job["kind"], "done": [], "pendingClient": []}
        index = 0
        try:
            self._journal_write(journal)
            for index, step in enumerate(job["steps"]):
                if self._stop.is_set():
                    raise StepFailed("stopped")
                job["at"] = index
                self._say(job, "step")
                self._apply(job, step, journal)
            self._finish(journal)
            self._say(job, "done", 100, step=len(job["steps"]) - 1)
        except Exception as e:
            code = e.code if isinstance(e, StepFailed) else "failed"
            decky.logger.warning("emulators: %s failed at step %d (%s: %s)", job["kind"], index + 1, code,
                                 e if isinstance(e, StepFailed) else type(e).__name__)
            left = self._rollback(journal)
            self._close_journal(journal)
            self._say(job, "failed", step=index, error=code, left=left)
        finally:
            shutil.rmtree(self._work_dir() / ".work" / f"job-{job['id']}", ignore_errors=True)
            self._inventory = None
            if any(step["do"] in ("install_core", "update_core") for step in job["steps"]):
                self._linger_pack()

    def _apply(self, job: dict, step: dict, journal: dict) -> None:
        do = step.get("do")
        if do == "install_core":
            self._install_core(job, step, journal)
        elif do == "update_core":
            self._update_core(job, step, journal)
        else:
            raise StepFailed("failed", f"unknown step {do}")

    def _finish(self, journal: dict) -> None:
        self._close_journal(journal)

    def _close_journal(self, journal: dict) -> None:
        if journal.get("pendingClient"):
            self._journal_write({"schemaVersion": 1, "done": [], "pendingClient": journal["pendingClient"]})
            return
        try:
            os.unlink(self._journal_path())
        except FileNotFoundError:
            pass

    def _allowed_roots(self) -> list:
        roots = [self._runtime_dir, self._user_home / "Applications"]
        ra = session.RetroArch(self._user_home)
        if ra.found:
            roots.append(ra.cores_dir)
        inventory = self._inventory
        for emulator in (inventory or {}).get("emulators") or []:
            for image in emulator["appimages"]:
                roots.append(Path(image["path"]).parent)
        return [os.path.realpath(root) for root in roots]

    def _check_target(self, target) -> None:
        target = Path(target)
        parent = os.path.realpath(target.parent)
        if not any(parent == root or parent.startswith(root + "/") for root in self._allowed_roots()):
            raise StepFailed("unsafe", f"{target} is outside the folders CheevoDeck writes to")
        try:
            st = os.lstat(target)
        except FileNotFoundError:
            st = None
        if st is not None and not stat.S_ISREG(st.st_mode):
            raise StepFailed("unsafe", f"{target} is not a plain file")
        owner = child_owner()
        if owner is not None and os.stat(parent).st_uid != owner[0]:
            raise StepFailed("unsafe", f"{parent} does not belong to the user")

    def _verify(self, path) -> None:
        st = os.lstat(path)
        owner = child_owner()
        if not stat.S_ISREG(st.st_mode) or (owner is not None and st.st_uid != owner[0]):
            raise StepFailed("unsafe", f"{path} came out wrong")

    def _place(self, source: Path, target: Path, mode: int) -> None:
        os.chmod(source, mode)
        chown_to_data_owner(source)
        if os.stat(source).st_dev == os.stat(target.parent).st_dev:
            os.replace(source, target)
            return
        temp = target.parent / f".{target.name}.cheevodeck-tmp"
        with exclusive_file(temp, replace=True) as out, open(source, "rb") as handle:
            shutil.copyfileobj(handle, out, CHUNK)
        os.chmod(temp, mode)
        os.replace(temp, target)

    def _rollback(self, journal: dict) -> list:
        left = []
        for undo in reversed(journal.get("done") or []):
            try:
                self._undo(undo, journal)
            except Exception as e:
                decky.logger.warning("emulators: couldn't undo %s (%s)", undo.get("undo") if isinstance(undo, dict)
                                     else "?", type(e).__name__)
                left.append(str(undo.get("path") or undo.get("core") or undo.get("undo")) if isinstance(undo, dict)
                            else "?")
        journal["done"] = []
        return left

    def _undo(self, undo: dict, journal: dict) -> None:
        kind = undo["undo"]
        if kind == "remove_file":
            path = Path(undo["path"])
            self._check_target(path)
            if path.is_file() and (not undo.get("crc") or file_crc(path) == undo["crc"]):
                os.unlink(path)
        elif kind == "restore":
            path, backup = Path(undo["path"]), Path(undo["backup"])
            if os.path.lexists(backup):
                self._check_target(path)
                self._check_target(backup)
                os.replace(backup, path)
        elif kind == "store_core":
            core, previous = undo["core"], undo.get("previous")

            def edit(record):
                if previous is None:
                    record["installed"]["cores"].pop(core, None)
                else:
                    record["installed"]["cores"][core] = previous

            self._store.change(edit)
        elif kind == "client":
            journal.setdefault("pendingClient", []).append(undo)
        else:
            raise StepFailed("failed", f"unknown undo {kind}")

    def repair(self) -> list:
        self._repaired = True
        fixed = []
        journal = load_json_file(self._journal_path(), None)
        if isinstance(journal, dict) and isinstance(journal.get("done"), list):
            left = self._rollback(journal)
            journal["pendingClient"] = [undo for undo in journal.get("pendingClient") or [] if isinstance(undo, dict)]
            self._close_journal(journal)
            fixed.append("emulators_plan")
            if left:
                decky.logger.warning("emulators: an interrupted change left %s behind", ", ".join(left))
        work = self._work_dir()
        if os.path.isdir(work / ".work"):
            shutil.rmtree(work / ".work", ignore_errors=True)
            fixed.append("emulators_work")
        try:
            names = os.listdir(work)
        except OSError:
            names = []
        for name in names:
            if name.startswith(PACK_PREFIX) or name.startswith(DOWNLOAD_PREFIX):
                try:
                    os.unlink(work / name)
                    fixed.append("emulators_pack")
                except OSError:
                    pass
        return fixed

    def pending_client(self) -> list:
        journal = load_json_file(self._journal_path(), None)
        if not isinstance(journal, dict) or journal.get("done"):
            return []
        return [undo for undo in journal.get("pendingClient") or [] if isinstance(undo, dict)]

    def clear_pending_client(self) -> None:
        journal = load_json_file(self._journal_path(), None)
        if isinstance(journal, dict) and not journal.get("done"):
            try:
                os.unlink(self._journal_path())
            except FileNotFoundError:
                pass

    def stop(self) -> None:
        self._stop.set()
        if self._pack_timer is not None:
            self._pack_timer.cancel()
        runner = self._runner
        if runner is not None:
            runner.join(STOP_SECONDS)

    def _linger_pack(self) -> None:
        if self._pack_timer is not None:
            self._pack_timer.cancel()
        self._pack_timer = threading.Timer(PACK_LINGER_SECONDS, self._drop_pack)
        self._pack_timer.daemon = True
        self._pack_timer.start()

    def _drop_pack(self) -> None:
        with self._job_lock:
            if self._job is not None or self._jobs:
                return
            self._pack = None
        try:
            names = os.listdir(self._work_dir())
        except OSError:
            return
        for name in names:
            if name.startswith(PACK_PREFIX):
                try:
                    os.unlink(self._work_dir() / name)
                except OSError:
                    pass

    def _pack_file(self, job: dict, bundle: dict, wanted: int) -> Path:
        version = bundle["raVersion"]
        if self._pack is not None and self._pack[0] == version and os.path.isfile(self._pack[1]):
            return self._pack[1]
        folder = self._work_dir()
        ensure_dir(folder)
        total = bundle.get("packSize") or 0
        if free_bytes(folder) < total + wanted + SPACE_MARGIN:
            raise StepFailed("no_space")
        final = folder / f"{PACK_PREFIX}{version}.7z"
        partial = folder / f"{DOWNLOAD_PREFIX}{PACK_PREFIX}{version}.7z"
        got = 0
        try:
            with self._open(PACK_URL.format(version=version), timeout=DOWNLOAD_SECONDS) as response, \
                    exclusive_file(partial, trusted=self._runtime_dir, replace=True) as out:
                while True:
                    if self._stop.is_set():
                        raise StepFailed("stopped")
                    chunk = response.read(CHUNK)
                    if not chunk:
                        break
                    got += len(chunk)
                    if got > PACK_MAX:
                        raise StepFailed("failed", "core pack larger than expected")
                    out.write(chunk)
                    if total:
                        self._say(job, "download", min(99, got * 100 // total))
            if total and got != total:
                raise StepFailed("no_network", "core pack download cut short")
            os.replace(partial, final)
        except (urllib.error.URLError, OSError) as e:
            raise StepFailed("no_network", type(e).__name__) from e
        finally:
            if os.path.lexists(partial):
                os.unlink(partial)
        self._pack = (version, final)
        return final

    def _core_context(self, core: str):
        ra = session.RetroArch(self._user_home)
        if not ra.found:
            raise StepFailed("not_found", "RetroArch isn't set up")
        bundle = self._store.get()["bundle"]
        stable = (bundle.get("cores") or {}).get(core)
        if stable is None:
            raise StepFailed("not_found", f"{core} isn't in the stable pack")
        if running(catalog.RETROARCH):
            raise StepFailed("running")
        return ra, bundle, stable

    def _extracted(self, job: dict, core: str) -> Path:
        files = job.get("extracted")
        if files is None:
            ra, bundle, _stable = self._core_context(core)
            cores = [step["core"] for step in job["steps"] if step["do"] in ("install_core", "update_core")]
            sizes = sum(bundle["cores"].get(name, {}).get("size", 0) for name in cores)
            if free_bytes(ra.cores_dir) < sizes + SPACE_MARGIN:
                raise StepFailed("no_space")
            pack = self._pack_file(job, bundle, sizes)
            folder = self._work_dir() / ".work" / f"job-{job['id']}"
            ensure_dir(folder)
            self._say(job, "extract")
            members = [PACK_PATH.format(core=name) for name in cores]
            code, _out, err = self._run(["7z", "e", "-y", f"-o{folder}", str(pack), *members], EXTRACT_SECONDS, self._stop)
            if code != 0:
                raise StepFailed("stopped" if self._stop.is_set() else "failed",
                                 f"core extract failed ({code}: {err.strip()[-200:]})")
            files = {name: folder / f"{name}_libretro.so" for name in cores}
            job["extracted"] = files
        source = files.get(core)
        bundle = self._store.get()["bundle"]
        if source is None or not source.is_file() or file_crc(source) != bundle["cores"][core]["crc"]:
            raise StepFailed("failed", f"{core} came out of the pack damaged")
        return source

    def _record_core(self, core: str, crc: str, version: str) -> None:
        self._store.change(lambda record: record["installed"]["cores"].__setitem__(
            core, {"crc": crc, "from": f"stable-{version}"}))

    def _install_core(self, job: dict, step: dict, journal: dict) -> None:
        core = step["core"]
        ra, bundle, stable = self._core_context(core)
        target = ra.core_path(core)
        if os.path.lexists(target):
            return
        source = self._extracted(job, core)
        self._check_target(target)
        previous = self._store.get()["installed"]["cores"].get(core)
        self._note(journal, {"undo": "remove_file", "path": str(target), "crc": stable["crc"]})
        self._note(journal, {"undo": "store_core", "core": core, "previous": previous})
        self._place(source, target, 0o644)
        self._verify(target)
        self._record_core(core, stable["crc"], bundle["raVersion"])

    def _update_core(self, job: dict, step: dict, journal: dict) -> None:
        core = step["core"]
        ra, bundle, stable = self._core_context(core)
        target = ra.core_path(core)
        if not target.is_file():
            raise StepFailed("not_found", f"{core} isn't installed")
        crc = file_crc(target)
        if crc == stable["crc"]:
            return
        record = self._store.get()["installed"]["cores"].get(core)
        if not step.get("force") and (record is None or record["crc"] != crc):
            raise StepFailed("newer_than_stable")
        source = self._extracted(job, core)
        self._check_target(target)
        backup = target.with_name(target.name + ".prev")
        self._check_target(backup)
        if os.path.lexists(backup):
            os.unlink(backup)
        self._note(journal, {"undo": "restore", "path": str(target), "backup": str(backup)})
        self._note(journal, {"undo": "store_core", "core": core, "previous": record})
        os.replace(target, backup)
        self._place(source, target, 0o644)
        self._verify(target)
        self._record_core(core, stable["crc"], bundle["raVersion"])

    def _core_names(self, cores) -> list:
        ra = session.RetroArch(self._user_home)
        infos = self._info_cores(ra) if ra.found else {}
        return [(infos.get(core) or {}).get("corename") or core for core in cores]

    def cores_offer(self) -> dict:
        inventory = self.inventory()
        bundle = self._ensure_index(inventory["retroarch"]["flatpak"]["version"], True)
        packed = bundle.get("cores") or {}
        if not packed:
            return {"ok": False, "error": "no_network"}
        recommended, everything = [], []
        for system in inventory["retroarch"]["systems"]:
            if not system["hasGames"] or any(core["installed"] for core in system["cores"]):
                continue
            if system["recommendedCore"] in packed and system["recommendedCore"] not in recommended:
                recommended.append(system["recommendedCore"])
            for core in system["cores"]:
                if core["core"] in packed and core["core"] not in everything:
                    everything.append(core["core"])
        return {
            "ok": True,
            "recommended": recommended,
            "all": everything,
            "recommendedBytes": sum(packed[core]["size"] for core in recommended),
            "allBytes": sum(packed[core]["size"] for core in everything),
            "packBytes": bundle.get("packSize", 0),
        }

    def install_cores(self, cores, target: str = "") -> dict:
        cores = [core for core in dict.fromkeys(cores or []) if isinstance(core, str) and _CORE.match(core)]
        ra = session.RetroArch(self._user_home)
        if not cores or not ra.found:
            return {"ok": False, "error": "not_found"}
        if running(catalog.RETROARCH):
            return {"ok": False, "error": "running"}
        bundle = self._ensure_index(self.inventory()["retroarch"]["flatpak"]["version"], True)
        if not bundle:
            return {"ok": False, "error": "no_network"}
        if any(core not in bundle["cores"] for core in cores):
            return {"ok": False, "error": "not_found"}
        return self._submit("install_cores", [{"do": "install_core", "core": core} for core in cores],
                            target=target, names=self._core_names(cores))

    def update_cores(self, cores, force: bool = False, skip_newer: bool = False, target: str = "") -> dict:
        cores = [core for core in dict.fromkeys(cores or []) if isinstance(core, str) and _CORE.match(core)]
        ra = session.RetroArch(self._user_home)
        if not cores or not ra.found:
            return {"ok": False, "error": "not_found"}
        if running(catalog.RETROARCH):
            return {"ok": False, "error": "running"}
        bundle = self._ensure_index(self.inventory()["retroarch"]["flatpak"]["version"], True)
        if not bundle:
            return {"ok": False, "error": "no_network"}
        ours = self._store.get()["installed"]["cores"]
        steps, kept = [], 0
        for core in cores:
            state = self._core_state(ra, core, bundle["cores"], ours)
            if state["update"]:
                steps.append({"do": "update_core", "core": core})
            elif state["newerThanStable"] and force:
                steps.append({"do": "update_core", "core": core, "force": True})
            elif state["newerThanStable"] and skip_newer:
                kept += 1
            elif state["newerThanStable"]:
                return {"ok": False, "error": "newer_than_stable", "core": core,
                        "name": self._core_names([core])[0], "installed": ra.version(core),
                        "stable": bundle["raVersion"]}
        if not steps:
            return {"ok": True, "job": "", "kept": kept}
        return self._submit("update_cores", steps, target=target,
                            names=self._core_names([step["core"] for step in steps]), kept=kept)
