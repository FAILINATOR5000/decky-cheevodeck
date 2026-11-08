import hashlib
import os
import secrets
import shutil
import threading
from pathlib import Path

import decky

import emulator_catalog as catalog
import multiplayer_session as session
import steam_shortcuts
import subprocess_util
from cheevo_check_systems import by_console_id
from utils import child_owner, ensure_dir


FLATPAK_SECONDS = 30
WORK_FOLDER = "emulators"


def path_key(path: str) -> str:
    return hashlib.sha256(path.encode("utf-8")).hexdigest()[:16]


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

    def _run(self, argv, timeout=FLATPAK_SECONDS):
        try:
            return subprocess_util.run_command(argv, timeout=timeout, env=self._flatpak_env(), as_data_owner=True)
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
        cores = {}
        for name in names:
            if name.endswith("_libretro.info"):
                core = name[: -len("_libretro.info")]
                info = ra.info(core)
                if info is not None:
                    cores[core] = info
        return cores

    def _retroarch(self, record: dict, flatpaks) -> dict:
        entry = catalog.BY_KIND[catalog.RETROARCH]
        ra = session.RetroArch(self._user_home)
        flatpak = self._flatpak_row(entry, flatpaks)
        installed = set(ra.installed_cores()) if ra.found else set()
        infos = self._info_cores(ra) if ra.found else {}
        bundle = record["bundle"].get("cores") or {}
        ours = record["installed"]["cores"]
        games = self._systems_with_games()
        systems = []
        for system_id in catalog.SYSTEM_DATABASES:
            cores = []
            for core, info in infos.items():
                if not catalog.runs_system(catalog.core_databases(info), system_id):
                    continue
                if bundle and core not in bundle and core not in installed:
                    continue
                cores.append({
                    "core": core,
                    "name": info.get("corename") or core,
                    "version": ra.version(core),
                    "installed": core in installed,
                    "ours": core in ours,
                    "update": False,
                    "newerThanStable": False,
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
            "systems": systems,
        }

    def inventory(self, refresh: bool = False) -> dict:
        with self._lock:
            if self._inventory is not None and not refresh:
                return self._inventory
            record = self._store.get()
            flatpaks = self._flatpaks()
            self._inventory = {
                "ok": True,
                "appsDir": str(self._user_home / "Applications"),
                "flatpakAvailable": flatpaks is not None,
                "retroarch": self._retroarch(record, flatpaks),
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
