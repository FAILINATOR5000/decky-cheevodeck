import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import decky

import subprocess_util
from cheevo_check_tools import host_is_arm64
from ra_client import build_user_agent
from utils import child_owner


SUNSHINE_RELEASE_URL = "https://api.github.com/repos/LizardByte/Sunshine/releases/latest"
MOONLIGHT_APP = "com.moonlight_stream.Moonlight"
MOONLIGHT_REMOTE = "flathub"
SHORTCUT_NAME = "Moonlight (CheevoDeck)"

STREAM_ROOT = Path("/var/lib/cheevodeck/sunshine")
STATE_DIR = "state"
LOGIN_FILE = "login.json"
CREDENTIALS_FILE = "credentials.json"
STATE_FILE = "sunshine_state.json"
PARTIAL_SUFFIX = ".partial"
DOWNLOAD_PREFIX = ".download-"

UNIT_NAME = "cheevodeck-sunshine"
MOONLIGHT_CONFIG = "cheevodeck-config"

FETCH_SECONDS = 20
DOWNLOAD_SECONDS = 600
EXTRACT_SECONDS = 300
FLATPAK_INSTALL_SECONDS = 900
FLATPAK_SECONDS = 30
INSTALLED_CACHE_SECONDS = 5
SALT_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
FLATHUB_REPO = "https://dl.flathub.org/repo/flathub.flatpakrepo"
CHUNK = 1 << 16
DOWNLOAD_MAX = 512 * 1024 * 1024

SETUP_EVENT = "stream_setup"

STAGE_SUNSHINE = "sunshine"
STAGE_MOONLIGHT = "moonlight"
STAGE_FINISHING = "finishing"
STAGE_DONE = "done"
STAGE_FAILED = "failed"

ERROR_BUSY = "busy"
ERROR_HOSTING = "hosting"
ERROR_FAILED = "failed"

_SIZE = re.compile(r"Download Size:\s*([\d.]+)\s*([kKMG]?B)")
_VERSION = re.compile(r"v?(\d+(?:\.\d+)+)")


class SetupFailed(Exception):
    pass


def _size_bytes(text: str) -> int:
    match = _SIZE.search(text or "")
    if match is None:
        return 0
    scale = {"B": 1, "kB": 1000, "KB": 1000, "MB": 1000 ** 2, "GB": 1000 ** 3}.get(match.group(2), 1)
    return int(float(match.group(1)) * scale)


def _lock_down(tree: Path) -> None:
    for top, dirs, files in os.walk(tree):
        for name in dirs + files:
            path = os.path.join(top, name)
            st = os.lstat(path)
            if stat.S_ISLNK(st.st_mode):
                continue
            os.chown(path, 0, 0)
            os.chmod(path, stat.S_IMODE(st.st_mode) & ~(stat.S_IWGRP | stat.S_IWOTH))
    os.chown(tree, 0, 0)
    os.chmod(tree, 0o755)


class StreamSetup:
    def __init__(self, *, store, ssl_context, user_home: Path, emit=None, hosting=None):
        self._store = store
        self._ssl_context = ssl_context
        self._user_home = Path(user_home)
        self._emit = emit
        self._hosting = hosting or (lambda: False)
        self._in_room = self._hosting
        self._lock = threading.Lock()
        self._busy = ""
        self._stage = ""
        self._error = ""
        self._size_text = ""
        self._size_for = None
        self._release = None
        self._moonlight_seen = False
        self._moonlight_at = 0.0

    def sunshine_dir(self):
        record = self._store.get()
        path = record["sunshinePath"]
        if not path or not record["sunshineVersion"]:
            return None
        tree = Path(path)
        version = record["sunshineVersion"]
        if _VERSION.fullmatch(version) is None or tree != STREAM_ROOT / version or not (tree / "AppRun").is_file():
            return None
        return tree

    def state_dir(self) -> Path:
        return STREAM_ROOT / STATE_DIR

    def login(self):
        try:
            with open(self.state_dir() / LOGIN_FILE, encoding="utf-8") as handle:
                raw = json.load(handle)
        except (OSError, ValueError):
            return None
        if not isinstance(raw, dict):
            return None
        user, password = raw.get("user"), raw.get("password")
        if not isinstance(user, str) or not isinstance(password, str) or not user or not password:
            return None
        return user, password

    def moonlight_config(self) -> Path:
        return self._user_home / ".var" / "app" / MOONLIGHT_APP / MOONLIGHT_CONFIG

    def _flatpak_env(self) -> dict:
        owner = child_owner()
        uid = owner[0] if owner else os.getuid()
        return {
            "HOME": str(self._user_home),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "XDG_RUNTIME_DIR": f"/run/user/{uid}",
            "XDG_DATA_HOME": str(self._user_home / ".local" / "share"),
        }

    def _flatpak(self, args, timeout=FLATPAK_SECONDS):
        try:
            return subprocess_util.run_command(["flatpak", *args], timeout=timeout, env=self._flatpak_env(),
                                               as_data_owner=True)
        except Exception as e:
            return 1, "", type(e).__name__

    def moonlight_installed(self) -> bool:
        if time.monotonic() - self._moonlight_at < INSTALLED_CACHE_SECONDS:
            return self._moonlight_seen
        code, _out, _err = self._flatpak(["info", "--user", MOONLIGHT_APP])
        self._moonlight_seen = code == 0
        self._moonlight_at = time.monotonic()
        return self._moonlight_seen

    def _forget_installed(self) -> None:
        self._moonlight_at = 0.0

    def _as_owner(self, argv) -> None:
        try:
            subprocess_util.run_command(argv, timeout=FLATPAK_SECONDS, env=self._flatpak_env(), as_data_owner=True)
        except Exception as e:
            decky.logger.warning("stream: %s failed (%s)", argv[0], type(e).__name__)

    def _user_flathub(self) -> None:
        self._flatpak(["remote-add", "--user", "--if-not-exists", MOONLIGHT_REMOTE, FLATHUB_REPO],
                      timeout=FLATPAK_INSTALL_SECONDS)

    def status(self) -> dict:
        record = self._store.get()
        sunshine = self.sunshine_dir() is not None and self.login() is not None
        moonlight = self.moonlight_installed()
        if not moonlight and not self._busy and self._store.moonlight_ours():
            self._store.update(moonlightOurs=False)
        return {
            "ok": True,
            "ready": sunshine and moonlight and record["moonlightAppid"] > 0,
            "sunshine": sunshine,
            "moonlight": moonlight,
            "appid": record["moonlightAppid"],
            "version": record["sunshineVersion"],
            "busy": self._busy,
            "stage": self._stage,
            "error": self._error,
        }

    def size(self) -> dict:
        missing = (self.sunshine_dir() is None, not self.moonlight_installed())
        if self._size_text and self._size_for == missing:
            return {"ok": True, "size": self._size_text}
        self._size_for = missing
        total = 0
        try:
            release = self._latest()
            if self.sunshine_dir() is None:
                total += release["size"]
        except SetupFailed:
            return {"ok": False, "size": ""}
        if not self.moonlight_installed():
            self._user_flathub()
            _code, out, _err = self._flatpak(["remote-info", "--user", MOONLIGHT_REMOTE, MOONLIGHT_APP])
            total += _size_bytes(out)
            runtime = re.search(r"Runtime:\s*(\S+)", out)
            if runtime:
                ref = runtime.group(1).replace("/x86_64/", "//").replace("/aarch64/", "//")
                code, _out, _err = self._flatpak(["info", ref])
                if code != 0:
                    _code, out, _err = self._flatpak(["remote-info", "--user", MOONLIGHT_REMOTE, runtime.group(1)])
                    total += _size_bytes(out)
        megabytes = max(1, round(total / 1000 ** 2))
        self._size_text = f"{megabytes} MB" if megabytes < 1000 else f"{total / 1000 ** 3:.1f} GB"
        return {"ok": True, "size": self._size_text}

    def _latest(self) -> dict:
        if self._release is not None and time.monotonic() - self._release["at"] < 600:
            return self._release
        request = urllib.request.Request(SUNSHINE_RELEASE_URL, headers={
            "User-Agent": build_user_agent(), "Accept": "application/vnd.github+json"})
        try:
            with urllib.request.urlopen(request, timeout=FETCH_SECONDS, context=self._ssl_context) as response:
                raw = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise SetupFailed(f"release lookup failed ({type(e).__name__})") from e
        if not isinstance(raw, dict) or raw.get("prerelease") or raw.get("draft"):
            raise SetupFailed("no stable release")
        match = _VERSION.fullmatch(str(raw.get("tag_name") or ""))
        if match is None:
            raise SetupFailed("release tag unreadable")
        version = match.group(1)
        arch = "aarch64" if host_is_arm64() else "x86_64"
        wanted = f"Sunshine_{version}_{arch}.AppImage"
        for asset in raw.get("assets") or []:
            if not isinstance(asset, dict) or asset.get("name") != wanted:
                continue
            digest = str(asset.get("digest") or "")
            url = str(asset.get("browser_download_url") or "")
            size = asset.get("size")
            if not digest.startswith("sha256:") or len(digest) != 71 or not url.startswith("https://github.com/") \
                    or type(size) is not int or not 0 < size <= DOWNLOAD_MAX:
                raise SetupFailed("release asset unusable")
            self._release = {"version": version, "url": url, "sha256": digest[7:].lower(), "size": size,
                             "name": wanted, "at": time.monotonic()}
            return self._release
        raise SetupFailed(f"no {wanted} in the release")

    def _download(self, release: dict, folder: Path) -> Path:
        target = folder / "Sunshine.AppImage"
        request = urllib.request.Request(release["url"], headers={"User-Agent": build_user_agent()})
        digest = hashlib.sha256()
        got = 0
        try:
            with urllib.request.urlopen(request, timeout=DOWNLOAD_SECONDS, context=self._ssl_context) as response, \
                    open(target, "wb") as out:
                while True:
                    chunk = response.read(CHUNK)
                    if not chunk:
                        break
                    got += len(chunk)
                    if got > DOWNLOAD_MAX:
                        raise SetupFailed("download larger than expected")
                    digest.update(chunk)
                    out.write(chunk)
        except (urllib.error.URLError, OSError) as e:
            raise SetupFailed(f"download failed ({type(e).__name__})") from e
        if digest.hexdigest() != release["sha256"]:
            raise SetupFailed("download digest mismatch")
        os.chmod(target, 0o700)
        return target

    def _install_sunshine(self, release: dict) -> Path:
        ensure_root_dir(STREAM_ROOT.parent)
        ensure_root_dir(STREAM_ROOT)
        final = STREAM_ROOT / release["version"]
        if (final / "AppRun").is_file():
            return final
        folder = Path(tempfile.mkdtemp(prefix=DOWNLOAD_PREFIX, dir=STREAM_ROOT))
        try:
            image = self._download(release, folder)
            code, err = _extract(image, folder)
            extracted = folder / "squashfs-root"
            if code != 0 or not (extracted / "AppRun").is_file():
                raise SetupFailed(f"extract failed ({code}: {err.strip()[-200:]})")
            _lock_down(extracted)
            partial = STREAM_ROOT / (release["version"] + PARTIAL_SUFFIX)
            shutil.rmtree(partial, ignore_errors=True)
            os.rename(extracted, partial)
            shutil.rmtree(final, ignore_errors=True)
            os.rename(partial, final)
        finally:
            shutil.rmtree(folder, ignore_errors=True)
        return final

    def _make_login(self) -> None:
        state = self.state_dir()
        ensure_root_dir(state, 0o700)
        if self.login() is not None and (state / CREDENTIALS_FILE).is_file():
            return
        user = "cheevodeck"
        password = secrets.token_urlsafe(24)
        salt = "".join(secrets.choice(SALT_ALPHABET) for _ in range(16))
        hashed = hashlib.sha256((password + salt).encode("utf-8")).digest()[::-1].hex().upper()
        _write_root(state / CREDENTIALS_FILE, json.dumps({"username": user, "salt": salt, "password": hashed}), 0o600)
        _write_root(state / LOGIN_FILE, json.dumps({"user": user, "password": password}), 0o600)

    def _install_moonlight(self) -> bool:
        if self.moonlight_installed():
            return False
        self._user_flathub()
        code, _out, err = self._flatpak(["install", "--user", "--noninteractive", "-y", MOONLIGHT_REMOTE, MOONLIGHT_APP],
                                        timeout=FLATPAK_INSTALL_SECONDS)
        self._forget_installed()
        if code != 0 or not self.moonlight_installed():
            raise SetupFailed(f"Moonlight install failed ({code}: {err.strip()[-200:]})")
        return True

    def _say(self, stage: str) -> None:
        self._stage = stage
        if self._emit is not None:
            self._emit(SETUP_EVENT, {"stage": stage, "job": self._busy, "error": self._error})

    def _claim(self, job: str):
        with self._lock:
            if self._busy:
                return ERROR_BUSY
            if (self._hosting if job == "update" else self._in_room)():
                return ERROR_HOSTING
            self._busy = job
            self._error = ""
            return None

    def _release_claim(self) -> None:
        with self._lock:
            self._busy = ""

    def setup(self) -> dict:
        refused = self._claim("setup")
        if refused:
            return {"ok": False, "error": refused}
        try:
            self._say(STAGE_SUNSHINE)
            release = self._latest()
            tree = self.sunshine_dir()
            if tree is None:
                tree = self._install_sunshine(release)
                if not self._store.update(sunshineVersion=release["version"], sunshinePath=str(tree)):
                    raise SetupFailed("couldn't save the install record")
            self._make_login()
            self._say(STAGE_MOONLIGHT)
            ours = self._install_moonlight()
            if ours and not self._store.update(moonlightOurs=True):
                raise SetupFailed("couldn't save the install record")
            self._say(STAGE_FINISHING)
            decky.logger.info("stream: set up Sunshine %s and Moonlight", release["version"])
            return {"ok": True, **self.status()}
        except SetupFailed as e:
            decky.logger.warning("stream: setup failed: %s", e)
            self._error = ERROR_FAILED
            self._say(STAGE_FAILED)
            return {"ok": False, "error": ERROR_FAILED}
        except Exception as e:
            decky.logger.warning("stream: setup failed (%s)", type(e).__name__)
            self._error = ERROR_FAILED
            self._say(STAGE_FAILED)
            return {"ok": False, "error": ERROR_FAILED}
        finally:
            self._release_claim()

    def finish(self, appid: int) -> dict:
        if appid <= 0 or not self._store.update(moonlightAppid=appid):
            return {"ok": False}
        self._say(STAGE_DONE)
        return {"ok": True, **self.status()}

    def update(self, verify=None) -> dict:
        refused = self._claim("update")
        if refused:
            return {"ok": False, "error": refused}
        try:
            self._say(STAGE_SUNSHINE)
            release = self._latest()
            old = self.sunshine_dir()
            if old is None or old.name != release["version"]:
                tree = self._install_sunshine(release)
                if verify is not None and not verify(tree):
                    if old is None or tree != old:
                        shutil.rmtree(tree, ignore_errors=True)
                    raise SetupFailed(f"Sunshine {release['version']} didn't start")
                self._store.update(sunshineVersion=release["version"], sunshinePath=str(tree))
                if old is not None and old != tree:
                    shutil.rmtree(old, ignore_errors=True)
                decky.logger.info("stream: Sunshine updated to %s", release["version"])
            self._say(STAGE_MOONLIGHT)
            code, _out, err = self._flatpak(["update", "--user", "--noninteractive", "-y", MOONLIGHT_APP],
                                            timeout=FLATPAK_INSTALL_SECONDS)
            if code != 0:
                raise SetupFailed(f"Moonlight update failed ({code}: {err.strip()[-200:]})")
            self._say(STAGE_DONE)
            return {"ok": True, **self.status()}
        except Exception as e:
            decky.logger.warning("stream: update failed: %s", e if isinstance(e, SetupFailed) else type(e).__name__)
            self._error = ERROR_FAILED
            self._say(STAGE_FAILED)
            return {"ok": False, "error": ERROR_FAILED}
        finally:
            self._release_claim()

    def remove(self) -> dict:
        refused = self._claim("remove")
        if refused:
            return {"ok": False, "error": refused}
        try:
            record = self._store.get()
            if self._store.moonlight_ours():
                code, _out, err = self._flatpak(["uninstall", "--user", "--noninteractive", "-y", MOONLIGHT_APP],
                                                timeout=FLATPAK_INSTALL_SECONDS)
                if code != 0 and self.moonlight_installed():
                    decky.logger.warning("stream: Moonlight didn't uninstall (%s)", err.strip()[-200:])
            self._as_owner(["rm", "-rf", "--", str(self.moonlight_config())])
            self._forget_installed()
            shutil.rmtree(STREAM_ROOT, ignore_errors=True)
            self._store.clear()
            self._size_text = ""
            decky.logger.info("stream: removed Sunshine and Moonlight")
            return {"ok": True, "appid": record["moonlightAppid"]}
        finally:
            self._release_claim()

    def repair(self, shortcut_exists=None) -> list:
        fixed = []
        if STREAM_ROOT.is_dir():
            for entry in STREAM_ROOT.iterdir():
                if entry.name.startswith(DOWNLOAD_PREFIX) or entry.name.endswith(PARTIAL_SUFFIX):
                    shutil.rmtree(entry, ignore_errors=True)
                    fixed.append("stream_partial")
        appid = self._store.get()["moonlightAppid"]
        if appid and shortcut_exists is not None and shortcut_exists(appid) is False:
            self._store.update(moonlightAppid=0)
            fixed.append("stream_shortcut")
        return fixed


def ensure_root_dir(path: Path, mode: int = 0o755) -> None:
    path.mkdir(mode=mode, exist_ok=True)
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
        raise SetupFailed(f"{path} is not a directory")
    if os.geteuid() == 0 and (st.st_uid != 0 or st.st_gid != 0):
        os.chown(path, 0, 0)
    os.chmod(path, mode)


def _write_root(path: Path, text: str, mode: int) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write(text)
    os.chmod(path, mode)


def _extract(image: Path, folder: Path):
    env = subprocess_util.system_env()
    env["HOME"] = str(folder)
    try:
        done = subprocess.run([str(image), "--appimage-extract"], cwd=str(folder), env=env, capture_output=True,
                              text=True, timeout=EXTRACT_SECONDS, check=False)
    except subprocess.TimeoutExpired:
        return 124, "timed out"
    except OSError as e:
        return 127, str(e)
    return done.returncode, done.stderr or ""
