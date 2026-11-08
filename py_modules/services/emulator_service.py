import fnmatch
import hashlib
import json
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
RELEASE_SECONDS = 600
PLAN_SETTLE_SECONDS = 30
FLATPAK_INSTALL_SECONDS = 1800
WATCH_SECONDS = 1.0
APPIMAGE_MAX = 512 << 20
FLATHUB_REPO = "https://dl.flathub.org/repo/flathub.flatpakrepo"
RELEASES_URL = "https://api.github.com/repos/{repo}/releases/{which}"
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

LINK_GATES = {"link_needs_gambatte": "gambatte", "link_needs_gpsp": "gpsp", "link_needs_melondsds": "melondsds",
              "link_needs_ppsspp": "ppsspp"}
UPDATE_GATES = {"gpsp_too_old": "gpsp", "melondsds_too_old": "melondsds"}
MISMATCH_GATES = {"dolphin_version_mismatch": "dolphin", "rmg_version_mismatch": "rmg", "ppsspp_version_mismatch": "ppsspp"}
CLIENT_UNDOS = ("remove_shortcut", "shortcut_fallback_off")

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
        self._releases = {}
        self._flathub = (0.0, None)
        self._sha256s = {}
        self._plan_run = None

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
        code, out, _err = self._run(["flatpak", "list", "--app", "--columns=application,version,installation,branch,active"])
        if code != 0:
            return None
        found = {}
        for line in out.splitlines():
            parts = [part.strip() for part in line.split("\t")] + ["", ""]
            if parts[0]:
                found[parts[0]] = {"version": parts[1], "scope": "system" if parts[2] == "system" else "user",
                                   "branch": parts[3], "commit": parts[4]}
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

    def _shortcuts_by_install(self) -> dict:
        try:
            shortcuts = steam_shortcuts.emulator_shortcuts(self._user_home)
        except Exception as e:
            decky.logger.info("emulators: couldn't read Steam's shortcuts (%s)", type(e).__name__)
            return {}
        found = {}
        for shortcut in shortcuts:
            kind = session.emulator_kind(shortcut["exe"], shortcut["launchOptions"])
            if kind not in catalog.BY_KIND:
                continue
            via, image = catalog.shortcut_install(kind, shortcut["exe"], shortcut["launchOptions"], self._user_home)
            if via == "flatpak":
                found.setdefault(f"{kind}:flatpak", shortcut["appid"])
            elif via == "appimage":
                found.setdefault(f"{kind}:{path_key(image)}", shortcut["appid"])
        return found

    def _steam(self, key: str, shortcuts: dict, record: dict):
        ours = record["shortcuts"].get(key)
        if ours is not None:
            return {"appid": ours, "ours": True, "key": key}
        if key in shortcuts:
            return {"appid": shortcuts[key], "ours": False, "key": key}
        return None

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
            "update": False,
            "newerThanStable": False,
        }

    def _standalones(self, record: dict, flatpaks, network: bool) -> list:
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
                                           "missing": True, "latest": "", "update": False,
                                           "newerThanStable": False})
        emulators = []
        shortcuts = self._shortcuts_by_install()
        for kind in catalog.STANDALONES:
            entry = catalog.BY_KIND[kind]
            for row in rows[kind]:
                row["steam"] = self._steam(f"{kind}:{row['key']}", shortcuts, record)
                release = self._release_for(kind, row["path"], network) if not row["missing"] else None
                if release is not None:
                    row["latest"] = release["version"]
                    row.update(self._appimage_compare(row, release))
            flatpak = self._flatpak_row(entry, flatpaks)
            flatpak["steam"] = self._steam(f"{kind}:flatpak", shortcuts, record)
            emulators.append({
                "kind": kind,
                "name": entry["name"],
                "achievements": entry["achievements"],
                "fileName": entry["fileName"],
                "flatpak": flatpak,
                "appimages": rows[kind],
                "found": bool(rows[kind]) or bool(flatpaks and entry["flatpak"] in flatpaks),
            })
        return emulators

    def _flatpak_row(self, entry: dict, flatpaks) -> dict:
        installed = (flatpaks or {}).get(entry["flatpak"])
        remote = (self._flathub[1] or {}).get(entry["flatpak"]) or {}
        row = {
            "id": entry["flatpak"],
            "installed": installed is not None,
            "version": installed["version"] if installed else "",
            "scope": installed["scope"] if installed else "",
            "latest": remote.get("version", ""),
            "size": remote.get("download", 0),
            "update": False,
            "newerThanStable": False,
        }
        if installed and remote.get("commit"):
            row.update(self._flatpak_compare(installed, remote))
        return row

    def _flatpak_compare(self, installed: dict, remote: dict) -> dict:
        if remote["commit"].startswith(installed["commit"][:12]) or installed["commit"].startswith(remote["commit"]):
            return {"update": False, "newerThanStable": False}
        mine, theirs = catalog.version_key(installed["version"]), catalog.version_key(remote.get("version", ""))
        newer = installed["branch"] not in ("", "stable") or (mine is not None and theirs is not None and mine > theirs)
        return {"update": not newer, "newerThanStable": newer}

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
        flatpak["steam"] = self._steam(f"{catalog.RETROARCH}:flatpak", self._shortcuts_by_install(), record)
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
            if network and flatpaks is not None and (refresh or self._flathub[1] is None):
                self._read_flathub(flatpaks)
            self._inventory = {
                "ok": True,
                "appsDir": str(self._user_home / "Applications"),
                "flatpakAvailable": flatpaks is not None,
                "retroarch": self._retroarch(record, flatpaks, network),
                "emulators": self._standalones(record, flatpaks, network),
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

    def _submit(self, kind: str, steps: list, *, target: str = "", names=None, kept: int = 0, plan: str = "") -> dict:
        if not self._repaired:
            self.repair()
        job = {"id": secrets.token_hex(6), "kind": kind, "steps": steps, "target": target,
               "names": list(names or []), "kept": kept, "plan": plan}
        with self._job_lock:
            if self._plan_run is not None and not plan:
                return {"ok": False, "error": "busy"}
            if plan and (self._plan_run is None or self._plan_run["id"] != plan):
                return {"ok": False, "error": "not_found"}
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
                    self._job_lock.notify_all()

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
        plan = self._open_plan(job["plan"]) if job["plan"] else None
        journal = plan["journal"] if plan is not None else \
            {"schemaVersion": 1, "job": job["id"], "kind": job["kind"], "done": [], "pendingClient": self.pending_client()}
        index = 0
        try:
            if job["plan"] and plan is None:
                raise StepFailed("not_found", "the plan is gone")
            self._journal_write(journal)
            for index, step in enumerate(job["steps"]):
                if self._stop.is_set():
                    raise StepFailed("stopped")
                job["at"] = index
                self._say(job, "step")
                self._apply(job, step, journal)
            if plan is None:
                self._finish(journal)
            self._say(job, "done", 100, step=len(job["steps"]) - 1)
        except Exception as e:
            code = e.code if isinstance(e, StepFailed) else "failed"
            decky.logger.warning("emulators: %s failed at step %d (%s: %s)", job["kind"], index + 1, code,
                                 e if isinstance(e, StepFailed) else type(e).__name__)
            left = []
            if plan is None:
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
        elif do == "install_emulator" and step.get("via") == "flatpak" and step.get("kind") in catalog.BY_KIND:
            self._install_flatpak_step(job, step, journal)
        elif do == "install_emulator" and step.get("via") == "appimage" and step.get("kind") in catalog.STANDALONES:
            self._install_appimage_step(job, step, journal)
        elif do == "update_emulator" and step.get("via") == "flatpak" and step.get("kind") in catalog.BY_KIND:
            self._update_flatpak_step(job, step, journal)
        elif do == "update_emulator" and step.get("via") == "appimage" and step.get("kind") in catalog.STANDALONES:
            self._update_appimage_step(job, step, journal)
        else:
            raise StepFailed("failed", f"unknown step {do}")

    def _finish(self, journal: dict) -> None:
        for trim in journal.get("trim") or []:
            path = Path(trim["path"])
            try:
                names = os.listdir(path.parent)
            except OSError:
                continue
            for name in names:
                old = path.parent / name
                if name.startswith(path.name + ".bak-") and str(old) != trim["keep"] and old.is_file() \
                        and not old.is_symlink():
                    try:
                        os.unlink(old)
                    except OSError:
                        pass
        self._close_journal(journal)

    def _close_journal(self, journal: dict) -> None:
        if journal.get("pendingClient"):
            self._journal_write({"schemaVersion": 1, "done": [], "pendingClient": journal["pendingClient"]})
            return
        try:
            os.unlink(self._journal_path())
        except FileNotFoundError:
            pass

    def _cores_retroarch(self):
        ra = session.RetroArch(self._user_home)
        return ra if ra.found else None

    def _allowed_roots(self) -> list:
        roots = [self._runtime_dir, self._user_home / "Applications"]
        ra = self._cores_retroarch()
        if ra is not None:
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
            if path.is_file() and (not undo.get("crc") or file_crc(path) == undo["crc"]) \
                    and (not undo.get("sha256") or self._sha256(str(path)) == undo["sha256"]):
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
        elif kind == "store_appimage":
            path, previous = undo["path"], undo.get("previous")

            def edit_appimage(record):
                if previous is None:
                    record["installed"]["appimages"].pop(path, None)
                else:
                    record["installed"]["appimages"][path] = previous

            self._store.change(edit_appimage)
        elif kind == "flatpak_uninstall":
            if undo["id"] in {row["flatpak"] for row in catalog.CATALOG}:
                self._run(["flatpak", "uninstall", "--user", "-y", "--noninteractive", undo["id"]],
                          FLATPAK_INSTALL_SECONDS)
        elif kind == "flatpak_commit":
            installed = self._installed_flatpak(undo["id"])
            if undo["id"] in {row["flatpak"] for row in catalog.CATALOG} and installed is not None \
                    and not undo["commit"].startswith(installed["commit"]) and undo["scope"] in ("user", "system"):
                code, _out, err = self._run(["flatpak", "update", f"--{undo['scope']}", "-y", "--noninteractive",
                                             f"--commit={undo['commit']}", undo["id"]], FLATPAK_INSTALL_SECONDS)
                if code != 0:
                    raise StepFailed("failed", err.strip()[-200:])
        elif kind == "client":
            journal.setdefault("pendingClient", []).append(undo)
            if undo.get("do") == "remove_shortcut" and undo.get("key"):
                self.forget_shortcut(str(undo["key"]))
        else:
            raise StepFailed("failed", f"unknown undo {kind}")

    def record_shortcut(self, key: str, appid: int) -> dict:
        kind = key.split(":", 1)[0]
        if kind not in catalog.BY_KIND or type(appid) is not int or not 0 < appid <= 0xFFFFFFFF:
            return {"ok": False}
        saved = self._store.change(lambda record: record["shortcuts"].__setitem__(key, appid))
        self._inventory = None
        return {"ok": saved}

    def forget_shortcut(self, key: str) -> dict:
        saved = self._store.change(lambda record: record["shortcuts"].pop(key, None))
        self._inventory = None
        return {"ok": saved}

    def _forget_gone_shortcuts(self) -> bool:
        if not any(True for _path in steam_shortcuts.iter_shortcuts_files(self._user_home)):
            return False
        gone = [key for key, appid in self._store.get()["shortcuts"].items()
                if steam_shortcuts.find_shortcut(appid, self._user_home) is None]
        if not gone:
            return False

        def edit(record):
            for key in gone:
                record["shortcuts"].pop(key, None)

        self._store.change(edit)
        return True

    def repair(self) -> list:
        self._repaired = True
        fixed = []
        if self._forget_gone_shortcuts():
            fixed.append("emulators_shortcuts")
        self._plan_run = None
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
        ra = self._cores_retroarch()
        if ra is None:
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

    def _flathub_scope(self) -> str:
        code, out, _err = self._run(["flatpak", "remotes", "--columns=name,options"])
        if code != 0:
            return ""
        scopes = [line.split("\t")[1] for line in out.splitlines()
                  if line.split("\t")[0].strip() == "flathub" and "\t" in line]
        if any("user" in scope for scope in scopes):
            return "--user"
        return "--system" if scopes else ""

    def _read_flathub(self, flatpaks: dict) -> None:
        scope = self._flathub_scope()
        if not scope:
            self._flathub = (time.monotonic(), {})
            return
        code, out, _err = self._run(["flatpak", "remote-ls", scope, "flathub", "--app",
                                     "--columns=application,version,commit,download-size"])
        remote = {}
        if code == 0:
            wanted = {row["flatpak"] for row in catalog.CATALOG}
            for line in out.splitlines():
                parts = [part.strip() for part in line.split("\t")]
                if len(parts) >= 4 and parts[0] in wanted:
                    remote[parts[0]] = {"version": parts[1], "commit": parts[2],
                                        "download": catalog.flatpak_size(parts[3])}
        for app in flatpaks:
            if app in {row["flatpak"] for row in catalog.CATALOG} and app not in remote:
                found = self._flathub_info(scope, app)
                if found:
                    remote[app] = found
        self._flathub = (time.monotonic(), remote)

    def _flathub_info(self, scope: str, app: str) -> dict:
        code, out, _err = self._run(["flatpak", "remote-info", scope, "flathub", app])
        if code != 0:
            return {}
        fields = {}
        for line in out.splitlines():
            key, sep, value = line.partition(":")
            if sep:
                fields[key.strip()] = value.strip()
        return {"version": fields.get("Version", ""), "commit": fields.get("Commit", "")[:12],
                "download": catalog.flatpak_size(fields.get("Download Size", ""))}

    def _release_source(self, kind: str, path: str = "") -> dict:
        entry = catalog.BY_KIND[kind]
        source = catalog.update_source(catalog.update_info(path)) if path else {}
        if source and catalog.valid_repo(source["repo"]) and catalog.kind_by_repo(source["repo"]) == kind:
            return {"repo": source["repo"], "tag": source["tag"], "asset": source["asset"]}
        return {"repo": entry["repo"], "tag": entry["tag"], "asset": entry["asset"]}

    def _release_for(self, kind: str, path: str, network: bool):
        source = self._release_source(kind, path)
        key = (source["repo"], source["tag"], source["asset"])
        cached = self._releases.get(key)
        if cached is not None and (not network or time.monotonic() - cached[0] < RELEASE_SECONDS):
            return cached[1]
        if not network:
            return None
        try:
            release = self._github_release(**source)
        except (StepFailed, urllib.error.URLError, OSError, ValueError) as e:
            decky.logger.info("emulators: couldn't read %s's latest release (%s)", source["repo"], type(e).__name__)
            return cached[1] if cached is not None else None
        self._releases[key] = (time.monotonic(), release)
        return release

    def _github_release(self, repo: str, tag: str, asset: str):
        which = f"tags/{tag}" if tag else "latest"
        with self._open(RELEASES_URL.format(repo=repo, which=which), {"Accept": "application/vnd.github+json"}) as response:
            raw = json.loads(response.read(4 << 20).decode("utf-8"))
        if not isinstance(raw, dict) or raw.get("prerelease") or raw.get("draft"):
            return None
        tag_name = str(raw.get("tag_name") or "")
        if not tag and not catalog.stable_tag(tag_name):
            return None
        for row in raw.get("assets") or []:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "")
            digest = str(row.get("digest") or "")
            url = str(row.get("browser_download_url") or "")
            size = row.get("size")
            if not fnmatch.fnmatch(name, asset) or name.endswith(".zsync") or "/" in name:
                continue
            if not url.startswith("https://github.com/") or type(size) is not int or not 0 < size <= APPIMAGE_MAX:
                continue
            if digest and (not digest.startswith("sha256:") or len(digest) != 71):
                continue
            version = catalog.tag_version(tag_name) if not tag else str(raw.get("published_at") or "")[:10]
            return {"version": version, "url": url, "sha256": digest[7:].lower(), "size": size, "name": name,
                    "zip": name.lower().endswith(".zip"), "repo": repo, "dated": bool(tag)}
        return None

    def _sha256(self, path: str) -> str:
        try:
            st = os.stat(path)
        except OSError:
            return ""
        key = (path, st.st_mtime_ns, st.st_size)
        if key not in self._sha256s:
            digest = hashlib.sha256()
            try:
                with open(path, "rb") as handle:
                    while True:
                        block = handle.read(1 << 20)
                        if not block:
                            break
                        digest.update(block)
            except OSError:
                return ""
            self._sha256s[key] = digest.hexdigest()
        return self._sha256s[key]

    def _appimage_compare(self, row: dict, release: dict) -> dict:
        mine = catalog.version_key(row["version"])
        theirs = None if release["dated"] else catalog.version_key(release["version"])
        if mine is not None and theirs is not None and mine != theirs:
            return {"update": mine < theirs, "newerThanStable": mine > theirs}
        if mine is not None and mine == theirs:
            return {"update": False, "newerThanStable": False}
        if release["sha256"] and self._sha256(row["path"]) == release["sha256"]:
            return {"update": False, "newerThanStable": False}
        return {"update": row["ours"], "newerThanStable": not row["ours"]}

    def _emulator(self, kind: str):
        return next((row for row in self.inventory()["emulators"] if row["kind"] == kind), None)

    def install_flatpak(self, kind: str, target: str = "") -> dict:
        if kind not in catalog.BY_KIND:
            return {"ok": False, "error": "not_found"}
        if running(kind):
            return {"ok": False, "error": "running"}
        return self._submit("install_emulator", [{"do": "install_emulator", "kind": kind, "via": "flatpak"}],
                            target=target, names=[catalog.BY_KIND[kind]["name"]])

    def update_flatpak(self, kind: str, force: bool = False, target: str = "") -> dict:
        if kind not in catalog.BY_KIND:
            return {"ok": False, "error": "not_found"}
        inventory = self.inventory(refresh=self._flathub[1] is None)
        rows = [inventory["retroarch"]] + inventory["emulators"]
        row = next(row for row in rows if row["kind"] == kind)["flatpak"]
        if not row["installed"]:
            return {"ok": False, "error": "not_found"}
        if running(kind):
            return {"ok": False, "error": "running"}
        if row["newerThanStable"] and not force:
            return {"ok": False, "error": "newer_than_stable", "name": catalog.BY_KIND[kind]["name"],
                    "installed": row["version"], "stable": row["latest"]}
        if not row["update"] and not force:
            return {"ok": True, "job": "", "kept": 0}
        return self._submit("update_emulator", [{"do": "update_emulator", "kind": kind, "via": "flatpak",
                                                 "force": bool(force)}],
                            target=target, names=[catalog.BY_KIND[kind]["name"]])

    def install_appimage(self, kind: str, target: str = "") -> dict:
        if kind not in catalog.STANDALONES:
            return {"ok": False, "error": "not_found"}
        if running(kind):
            return {"ok": False, "error": "running"}
        if self._release_for(kind, "", True) is None:
            return {"ok": False, "error": "no_network"}
        return self._submit("install_emulator", [{"do": "install_emulator", "kind": kind, "via": "appimage"}],
                            target=target, names=[catalog.BY_KIND[kind]["name"]])

    def update_appimage(self, path: str, force: bool = False, target: str = "") -> dict:
        found = None
        for emulator in self.inventory()["emulators"]:
            for row in emulator["appimages"]:
                if row["path"] == path and not row["missing"]:
                    found = (emulator, row)
        if found is None:
            return {"ok": False, "error": "not_found"}
        emulator, row = found
        if running(emulator["kind"]):
            return {"ok": False, "error": "running"}
        release = self._release_for(emulator["kind"], path, True)
        if release is None:
            return {"ok": False, "error": "no_network"}
        state = self._appimage_compare(row, release)
        if state["newerThanStable"] and not force:
            return {"ok": False, "error": "newer_than_stable", "name": emulator["name"],
                    "installed": row["version"] or row["fileName"], "stable": release["version"]}
        if not state["update"] and not force:
            return {"ok": True, "job": "", "kept": 0}
        return self._submit("update_emulator", [{"do": "update_emulator", "kind": emulator["kind"], "via": "appimage",
                                                 "path": path, "force": bool(force)}],
                            target=target, names=[emulator["name"]])

    def _watch_install(self, job: dict, expected: int, done: threading.Event) -> None:
        root = self._user_home / ".local" / "share"
        try:
            start = os.statvfs(root)
        except OSError:
            return
        while not done.wait(WATCH_SECONDS):
            if expected <= 0:
                continue
            try:
                now = os.statvfs(root)
            except OSError:
                return
            used = (start.f_bavail - now.f_bavail) * now.f_frsize
            self._say(job, "flatpak", max(0, min(95, used * 100 // expected)))

    def _flatpak_job(self, job: dict, argv: list, expected: int) -> None:
        done = threading.Event()
        watcher = threading.Thread(target=self._watch_install, args=(job, expected, done), daemon=True)
        watcher.start()
        try:
            code, _out, err = self._run(["flatpak", *argv], FLATPAK_INSTALL_SECONDS, self._stop)
        finally:
            done.set()
            watcher.join(WATCH_SECONDS * 2)
        if code != 0:
            raise StepFailed("stopped" if self._stop.is_set() else "failed",
                             f"flatpak {argv[0]} failed ({code}: {err.strip()[-200:]})")

    def _installed_flatpak(self, app: str):
        return (self._flatpaks() or {}).get(app)

    def _install_flatpak_step(self, job: dict, step: dict, journal: dict) -> None:
        app = catalog.BY_KIND[step["kind"]]["flatpak"]
        if self._installed_flatpak(app) is not None:
            return
        if running(step["kind"]):
            raise StepFailed("running")
        self._run(["flatpak", "remote-add", "--user", "--if-not-exists", "flathub", FLATHUB_REPO], FLATPAK_SECONDS)
        expected = ((self._flathub[1] or {}).get(app) or {}).get("download", 0) * 2
        self._note(journal, {"undo": "flatpak_uninstall", "id": app})
        self._say(job, "flatpak", 0)
        self._flatpak_job(job, ["install", "--user", "-y", "--noninteractive", "flathub", app], expected)
        if self._installed_flatpak(app) is None:
            raise StepFailed("failed", f"{app} didn't install")

    def _update_flatpak_step(self, job: dict, step: dict, journal: dict) -> None:
        app = catalog.BY_KIND[step["kind"]]["flatpak"]
        installed = self._installed_flatpak(app)
        if installed is None:
            raise StepFailed("not_found", f"{app} isn't installed")
        if running(step["kind"]):
            raise StepFailed("running")
        code, out, _err = self._run(["flatpak", "info", f"--{installed['scope']}", "--show-commit", app])
        previous = out.strip() if code == 0 else ""
        if not previous:
            raise StepFailed("failed", f"couldn't read {app}'s commit")
        self._note(journal, {"undo": "flatpak_commit", "id": app, "scope": installed["scope"], "commit": previous})
        self._say(job, "flatpak", 0)
        self._flatpak_job(job, ["update", f"--{installed['scope']}", "-y", "--noninteractive", app],
                          ((self._flathub[1] or {}).get(app) or {}).get("download", 0))

    def _download(self, job: dict, release: dict, folder: Path, name: str) -> Path:
        temp = folder / f".{name}.cheevodeck-download"
        digest = hashlib.sha256()
        got = 0
        try:
            with self._open(release["url"], timeout=DOWNLOAD_SECONDS) as response, \
                    exclusive_file(temp, replace=True) as out:
                while True:
                    if self._stop.is_set():
                        raise StepFailed("stopped")
                    chunk = response.read(CHUNK)
                    if not chunk:
                        break
                    got += len(chunk)
                    if got > release["size"]:
                        raise StepFailed("failed", "download larger than expected")
                    digest.update(chunk)
                    out.write(chunk)
                    self._say(job, "download", min(99, got * 100 // release["size"]))
        except (urllib.error.URLError, OSError) as e:
            if os.path.lexists(temp):
                os.unlink(temp)
            raise StepFailed("no_network", type(e).__name__) from e
        except StepFailed:
            if os.path.lexists(temp):
                os.unlink(temp)
            raise
        if got != release["size"] or (release["sha256"] and digest.hexdigest() != release["sha256"]):
            os.unlink(temp)
            raise StepFailed("failed", "download didn't match the release")
        return temp

    def _fetch_appimage(self, job: dict, release: dict, folder: Path, name: str) -> Path:
        if free_bytes(folder) < release["size"] * 3 + SPACE_MARGIN:
            raise StepFailed("no_space")
        if not release["zip"]:
            fetched = self._download(job, release, folder, name)
        else:
            work = self._work_dir() / ".work" / f"job-{job['id']}"
            ensure_dir(work)
            archive = self._download(job, release, work, "release.zip")
            fetched = folder / f".{name}.cheevodeck-download"
            try:
                with zipfile.ZipFile(archive) as bundle:
                    members = [row for row in bundle.infolist()
                               if row.filename.lower().endswith(".appimage") and not row.is_dir()]
                    if len(members) != 1 or members[0].file_size > APPIMAGE_MAX:
                        raise StepFailed("failed", "the release zip doesn't hold one AppImage")
                    with bundle.open(members[0]) as source, exclusive_file(fetched, replace=True) as out:
                        shutil.copyfileobj(source, out, CHUNK)
            except (OSError, zipfile.BadZipFile) as e:
                if os.path.lexists(fetched):
                    os.unlink(fetched)
                raise StepFailed("failed", type(e).__name__) from e
        os.chmod(fetched, 0o755)
        chown_to_data_owner(fetched)
        return fetched

    def _install_appimage_step(self, job: dict, step: dict, journal: dict) -> None:
        kind = step["kind"]
        entry = catalog.BY_KIND[kind]
        if any(not row["missing"] for row in (self._emulator(kind) or {}).get("appimages") or []):
            return
        folder = self._user_home / "Applications"
        ensure_dir(folder)
        target = folder / entry["fileName"]
        self._check_target(target)
        if os.path.lexists(target):
            raise StepFailed("unsafe", f"{target} is already there")
        if running(kind):
            raise StepFailed("running")
        release = self._release_for(kind, "", True)
        if release is None:
            raise StepFailed("no_network")
        fetched = self._fetch_appimage(job, release, folder, entry["fileName"])
        sha = self._sha256(str(fetched))
        self._note(journal, {"undo": "remove_file", "path": str(target), "sha256": sha})
        self._note(journal, {"undo": "store_appimage", "path": str(target), "previous": None})
        os.replace(fetched, target)
        self._verify(target)
        self._record_appimage(str(target), release)

    def _update_appimage_step(self, job: dict, step: dict, journal: dict) -> None:
        kind, path = step["kind"], Path(step["path"])
        self._check_target(path)
        if not path.is_file():
            raise StepFailed("not_found", f"{path} is gone")
        if running(kind):
            raise StepFailed("running")
        release = self._release_for(kind, str(path), True)
        if release is None:
            raise StepFailed("no_network")
        version = self._appimage_version(str(path))
        record = self._store.get()["installed"]["appimages"].get(str(path))
        row = {"path": str(path), "version": version, "ours": record is not None}
        state = self._appimage_compare(row, release)
        if state["newerThanStable"] and not step.get("force"):
            raise StepFailed("newer_than_stable")
        if not state["update"] and not state["newerThanStable"]:
            return
        fetched = self._fetch_appimage(job, release, path.parent, path.name)
        label = re.sub(r"[^A-Za-z0-9._-]", "_", version or "unknown")[:64]
        backup = path.with_name(f"{path.name}.bak-{label}")
        self._check_target(backup)
        if os.path.lexists(backup):
            os.unlink(backup)
        self._note(journal, {"undo": "restore", "path": str(path), "backup": str(backup)})
        self._note(journal, {"undo": "store_appimage", "path": str(path), "previous": record})
        journal.setdefault("trim", []).append({"path": str(path), "keep": str(backup)})
        os.replace(path, backup)
        os.replace(fetched, path)
        self._verify(path)
        self._record_appimage(str(path), release)

    def _record_appimage(self, path: str, release: dict) -> None:
        self._store.change(lambda record: record["installed"]["appimages"].__setitem__(
            path, {"version": release["version"], "repo": release["repo"]}))

    def _cores_by_name(self, inventory: dict) -> dict:
        found = {}
        for system in inventory["retroarch"]["systems"]:
            for core in system["cores"]:
                found.setdefault(core["core"], core)
        return found

    def _retroarch_steps(self, inventory: dict):
        return [] if inventory["retroarch"]["configFound"] else None

    def _core_step(self, inventory: dict, core: str, do: str = "install_core"):
        packed = (self._store.get()["bundle"].get("cores") or {})
        if not core or core not in packed:
            return None
        row = self._cores_by_name(inventory).get(core) or {}
        return {"do": do, "where": "backend", "core": core, "name": row.get("name") or self._core_names([core])[0],
                "size": (packed.get(core) or {}).get("size", 0)}

    def _core_plan(self, inventory: dict, core: str):
        if (self._cores_by_name(inventory).get(core) or {}).get("installed"):
            return None
        first = self._retroarch_steps(inventory)
        step = self._core_step(inventory, core)
        if first is None or step is None:
            return None
        return first + [step]

    def _couch_core_plan(self, inventory: dict, system_id):
        system = next((row for row in inventory["retroarch"]["systems"] if row["id"] == system_id), None)
        if system is None:
            return None
        ra = session.RetroArch(self._user_home)
        infos = self._info_cores(ra) if ra.found else {}
        packed = (self._store.get()["bundle"].get("cores") or {})
        couch = [core for core in system["cores"]
                 if ((infos.get(core["core"]) or {}).get("savestate_features") or "").strip() in ("", "deterministic")
                 and core["core"] in packed]
        if not couch:
            return None
        table = session.COUCH_CORES.get(system_id)
        recommended = table if any(core["core"] == table for core in couch) else couch[0]["core"]
        first = self._retroarch_steps(inventory)
        step = self._core_step(inventory, recommended)
        if first is None or step is None:
            return None
        step["choices"] = [{"core": core["core"], "name": core["name"], "size": core["size"],
                            "recommended": core["core"] == recommended} for core in couch]
        step["choices"].sort(key=lambda row: not row["recommended"])
        return first + [step]

    def _row_for(self, inventory: dict, kind: str):
        if kind == catalog.RETROARCH:
            return inventory["retroarch"]
        return next((row for row in inventory["emulators"] if row["kind"] == kind), None)

    def _install_choices(self, inventory: dict, kind: str, only: str, host_version: str) -> list:
        entry = catalog.BY_KIND[kind]
        row = self._row_for(inventory, kind)
        choices = []
        if inventory["flatpakAvailable"] and only in ("", "flatpak"):
            choices.append({"via": "flatpak", "size": row["flatpak"]["size"], "latest": row["flatpak"]["latest"],
                            "id": entry["flatpak"], "scope": "user"})
        if entry["repo"] and only in ("", "appimage"):
            source = self._release_source(kind)
            cached = self._releases.get((source["repo"], source["tag"], source["asset"]))
            release = cached[1] if cached is not None else None
            choices.append({"via": "appimage", "size": release["size"] if release else 0,
                            "latest": release["version"] if release else "",
                            "path": str(self._user_home / "Applications" / entry["fileName"])})
        if host_version:
            choices = [choice for choice in choices if choice["latest"] == host_version]
        for choice in choices:
            choice["recommended"] = choice["via"] == entry["via"]
        if choices and not any(choice["recommended"] for choice in choices):
            choices[0]["recommended"] = True
        choices.sort(key=lambda choice: not choice["recommended"])
        return choices

    def _add_step(self, kind: str, name: str, choice: dict) -> dict:
        step = {"do": "add_to_steam", "where": "client", "kind": kind, "name": name, "via": choice["via"]}
        if choice["via"] == "flatpak":
            step.update(id=choice["id"], scope=choice["scope"])
        else:
            step["path"] = choice["path"]
        return step

    def _shortcut_plan(self, inventory: dict, kind: str, only: str, host_version: str = ""):
        if kind not in catalog.BY_KIND:
            return None
        row = self._row_for(inventory, kind)
        entry = catalog.BY_KIND[kind]
        installed = []
        if row["flatpak"]["installed"]:
            installed.append({"via": "flatpak", "id": entry["flatpak"], "scope": row["flatpak"]["scope"]})
        for image in row.get("appimages") or []:
            if not image["missing"]:
                installed.append({"via": "appimage", "path": image["path"]})
        usable = [choice for choice in installed if not only or choice["via"] == only]
        if usable:
            usable.sort(key=lambda choice: choice["via"] != entry["via"])
            return [self._add_step(kind, entry["name"], usable[0])]
        choices = self._install_choices(inventory, kind, only, host_version)
        if not choices:
            return None
        reason = "game_shortcut" if only else "host_version" if host_version else "single" if len(choices) == 1 else ""
        install = {"do": "install_emulator", "where": "backend", "kind": kind, "name": entry["name"],
                   "via": choices[0]["via"], "choices": choices, "reason": reason}
        return [install, self._add_step(kind, entry["name"], choices[0])]

    def _duckstation_plan(self, inventory: dict, context: dict):
        steps = []
        ps1 = next((row for row in inventory["retroarch"]["systems"] if row["id"] == session.PS1_SYSTEM), None)
        ra = session.RetroArch(self._user_home)
        infos = self._info_cores(ra) if ra.found else {}
        couch_installed = ps1 is not None and any(
            core["installed"] and ((infos.get(core["core"]) or {}).get("savestate_features") or "").strip()
            in ("", "deterministic") for core in ps1["cores"])
        if not couch_installed:
            core_steps = self._core_plan(inventory, session.BEETLE_PSX_HW)
            if core_steps is None:
                return None
            steps.extend(core_steps)
        if not context.get("raShortcut"):
            entry = catalog.BY_KIND[catalog.RETROARCH]
            if not inventory["retroarch"]["found"] and not any(step["kind"] == catalog.RETROARCH
                                                               for step in steps if step["do"] == "install_emulator"):
                first = self._retroarch_steps(inventory)
                if first is None:
                    return None
                steps = first + steps
            scope = inventory["retroarch"]["flatpak"]["scope"] or "user"
            steps.append(self._add_step(catalog.RETROARCH, entry["name"],
                                        {"via": "flatpak", "id": entry["flatpak"], "scope": scope}))
        return steps or None

    def _match_plan(self, inventory: dict, kind: str, detail: dict, context: dict):
        host = str(detail.get("version") or "")
        row = self._row_for(inventory, kind)
        if not host or row is None:
            return None
        install = detail.get("install") or ("flatpak" if kind == "ppsspp" else "")
        if install == "flatpak":
            mine, latest = row["flatpak"]["version"], row["flatpak"]["latest"]
            target = {"via": "flatpak"}
        else:
            image = next((image for image in row["appimages"] if image["path"] == context.get("path")), None)
            if image is None:
                return None
            mine, latest = image["version"], image["latest"]
            target = {"via": "appimage", "path": image["path"]}
        older, newest = catalog.version_key(mine), catalog.version_key(latest)
        if not latest or host != latest or older is None or newest is None or not older < newest:
            return None
        return [{"do": "update_emulator", "where": "backend", "kind": kind, "name": row["name"], **target}]

    def plan(self, gate: str, detail: dict, context: dict):
        try:
            return self._plan(gate, detail or {}, context or {})
        except Exception as e:
            decky.logger.warning("emulators: planning a fix for %s failed (%s)", gate, type(e).__name__)
            return None

    def _plan(self, gate: str, detail: dict, context: dict):
        if gate == "stream_not_set_up":
            return [{"do": "setup_streaming", "where": "client"}]
        if gate == "no_shortcut":
            return None if context.get("shortcutFallback", True) else [{"do": "enable_shortcut_fallback", "where": "client"}]
        if gate == "link_needs_gambatte_both":
            return None
        inventory = self._inventory if self._inventory is not None else self.inventory(network=False)
        host = context.get("hostVersion", "")
        if gate in LINK_GATES:
            return self._core_plan(inventory, LINK_GATES[gate])
        if gate == "host_core_missing":
            return self._core_plan(inventory, str(detail.get("coreId") or ""))
        if gate == "no_couch_core":
            return self._couch_core_plan(inventory, context.get("systemId"))
        if gate in UPDATE_GATES:
            core = UPDATE_GATES[gate]
            step = self._core_step(inventory, core, "update_core")
            return [step] if step is not None and (self._cores_by_name(inventory).get(core) or {}).get("installed") else None
        if gate == "no_emulator_shortcut":
            return self._shortcut_plan(inventory, str(context.get("kind") or ""), "")
        if gate == "no_dolphin_emulator_shortcut":
            return self._shortcut_plan(inventory, "dolphin", str(detail.get("install") or ""), host)
        if gate == "no_rmg_shortcut":
            return self._shortcut_plan(inventory, "rmg", "", host)
        if gate == "duckstation_no_multiplayer":
            return self._duckstation_plan(inventory, context)
        if gate in MISMATCH_GATES:
            return self._match_plan(inventory, MISMATCH_GATES[gate], detail, context)
        return None

    def plan_begin(self) -> dict:
        if not self._repaired:
            self.repair()
        with self._job_lock:
            if self._plan_run is not None or self._job is not None or self._jobs:
                return {"ok": False, "error": "busy"}
            self._plan_run = {"id": secrets.token_hex(6), "journal": {"schemaVersion": 1, "job": "", "kind": "plan",
                                                                   "done": [], "pendingClient": self.pending_client()}}
            self._plan_run["journal"]["job"] = self._plan_run["id"]
            plan_id = self._plan_run["id"]
        self._journal_write(self._plan_run["journal"])
        return {"ok": True, "plan": plan_id}

    def _open_plan(self, plan_id: str):
        plan = self._plan_run
        return plan if plan is not None and plan["id"] == plan_id else None

    def plan_step(self, plan_id: str, step: dict, force: bool = False) -> dict:
        plan = self._open_plan(plan_id)
        if plan is None or not isinstance(step, dict):
            return {"ok": False, "error": "not_found"}
        do = step.get("do")
        if do in ("install_core", "update_core") and isinstance(step.get("core"), str) and _CORE.match(step["core"]):
            clean = {"do": do, "core": step["core"], "force": bool(force)}
            name = self._core_names([step["core"]])[0]
        elif do in ("install_emulator", "update_emulator") and step.get("kind") in catalog.BY_KIND \
                and step.get("via") in ("flatpak", "appimage"):
            clean = {"do": do, "kind": step["kind"], "via": step["via"], "force": bool(force)}
            if do == "update_emulator" and step["via"] == "appimage":
                clean["path"] = str(step.get("path") or "")
            name = catalog.BY_KIND[step["kind"]]["name"]
        else:
            return {"ok": False, "error": "not_found"}
        kind = "install_cores" if do == "install_core" else "update_cores" if do == "update_core" else do
        return self._submit(kind, [clean], target=f"plan:{plan_id}", names=[name], plan=plan_id)

    def plan_client(self, plan_id: str, undo: dict) -> dict:
        plan = self._open_plan(plan_id)
        if plan is None or not isinstance(undo, dict) or undo.get("do") not in CLIENT_UNDOS:
            return {"ok": False}
        record = {"undo": "client", "do": undo["do"]}
        if undo["do"] == "remove_shortcut":
            kind, via, path = undo.get("kind"), undo.get("via"), str(undo.get("path") or "")
            if type(undo.get("appid")) is not int or not 0 < undo["appid"] <= 0xFFFFFFFF or kind not in catalog.BY_KIND \
                    or via not in ("flatpak", "appimage") or (via == "appimage" and not path.startswith("/")):
                return {"ok": False}
            record["appid"] = undo["appid"]
            record["key"] = f"{kind}:flatpak" if via == "flatpak" else f"{kind}:{path_key(path)}"
        with self._job_lock:
            self._note(plan["journal"], record)
        if undo["do"] == "remove_shortcut":
            self.record_shortcut(record["key"], record["appid"])
        return {"ok": True}

    def plan_end(self, plan_id: str) -> dict:
        with self._job_lock:
            self._job_lock.wait_for(lambda: self._job is None and not self._jobs, PLAN_SETTLE_SECONDS)
            plan = self._open_plan(plan_id)
            if plan is None or self._job is not None:
                return {"ok": False}
            self._plan_run = None
        self._finish(plan["journal"])
        self._inventory = None
        return {"ok": True}

    def plan_abort(self, plan_id: str) -> dict:
        with self._job_lock:
            self._job_lock.wait_for(lambda: self._job is None and not self._jobs, PLAN_SETTLE_SECONDS)
            plan = self._open_plan(plan_id)
            if plan is None or self._job is not None:
                return {"ok": False, "client": []}
            self._plan_run = None
        journal = plan["journal"]
        left = self._rollback(journal)
        self._close_journal(journal)
        self._inventory = None
        return {"ok": True, "client": journal.get("pendingClient") or [], "left": left}

    def plan_abandon(self) -> dict:
        plan = self._plan_run
        if plan is None:
            return {"ok": True, "client": []}
        return self.plan_abort(plan["id"])

    def latest_known(self) -> bool:
        return self._flathub[1] is not None
