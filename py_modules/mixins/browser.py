from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse

import asyncio
import errno
import http.client
import os
import re
import shutil
import socket
import stat
import threading
import time
import urllib.error
import urllib.request
import uuid

import decky

from browser_store import DOWNLOADS_FILENAME, MAX_AD_EXEMPTIONS, MAX_BOOKMARK_CATEGORIES, MAX_BOOKMARKS, MAX_TABS, clean_referer, clean_site
from utils import child_owner, chown_to_data_owner, open_dir, ssl_context, to_int
from mixins._context import PluginContext


BROWSER_DOWNLOAD_EVENT = "cheevodeck_browser_download"

BROWSER_DOWNLOAD_PROGRESS_EVENT = "cheevodeck_browser_download_progress"

BROWSER_DOWNLOAD_MAX_BYTES = 4 * 1024 * 1024 * 1024
BROWSER_DOWNLOAD_TIMEOUT_SECONDS = 30

BROWSER_DOWNLOAD_READ = 64 * 1024

BROWSER_DOWNLOAD_STALL_SECONDS = 60
BROWSER_DOWNLOAD_STALL_BYTES = 32 * 1024

BROWSER_DOWNLOAD_PROGRESS_SECONDS = 1.0

BROWSER_DOWNLOAD_CHECKPOINT_SECONDS = 10

BROWSER_DOWNLOAD_RESET_WAIT_SECONDS = 3.0

BROWSER_DOWNLOAD_HEADERS_SECONDS = 60

BROWSER_DOWNLOAD_MTIME_SLACK = 2.0

BROWSER_DOWNLOAD_MAX_NAME_BYTES = 240

BROWSER_DATA_URL_MAX = 64 * 1024 * 1024

BROWSER_DOWNLOAD_MEDIA_ROOTS = (Path("/run/media"), Path("/media"))

_WEB_PAGE_TYPES = ("text/html", "application/xhtml+xml")
_WEB_PAGE_SUFFIXES = (".html", ".htm", ".xhtml", ".shtml", ".mht", ".mhtml")

_ROOT = Path("/")

_RUN_ID = uuid.uuid4().hex


def _queue_stamp() -> int:
    return int(time.time() * 1000)


_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_FAT_CHARS = re.compile(r'[:?*"<>|]')
_DISPOSITION_STAR = re.compile(r"filename\*\s*=\s*([^';]*)'[^']*'([^;]+)", re.IGNORECASE)
_DISPOSITION_PLAIN = re.compile(r'filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))', re.IGNORECASE)
_RANGE_ANSWER = re.compile(r"bytes\s+(\d+)-(\d+)/(\d+|\*)", re.IGNORECASE)
_RANGE_UNSATISFIED = re.compile(r"bytes\s+\*/(\d+)", re.IGNORECASE)

_active_downloads: dict = {}
_active_lock = threading.Lock()

_removing: set = set()

_queued: dict = {}


def _fit_bytes(text: str, limit: int) -> str:
    return text.encode("utf-8")[:limit].decode("utf-8", errors="ignore")


def _scrub_name(raw: str) -> str:
    base = re.split(r"[/\\]", str(raw or ""))[-1]
    cleaned = _FAT_CHARS.sub("_", _CONTROL_CHARS.sub("", base)).strip().lstrip(".").strip()
    if len(cleaned.encode("utf-8")) > BROWSER_DOWNLOAD_MAX_NAME_BYTES:
        stem, dot, ext = cleaned.rpartition(".")
        ext_bytes = len(ext.encode("utf-8"))
        if dot and stem and 0 < ext_bytes <= 16:
            cleaned = _fit_bytes(stem, BROWSER_DOWNLOAD_MAX_NAME_BYTES - ext_bytes - 1).rstrip() + "." + ext
        else:
            cleaned = _fit_bytes(cleaned, BROWSER_DOWNLOAD_MAX_NAME_BYTES).rstrip()
    return cleaned


def _download_folder(home: Path, folder) -> Optional[Path]:
    text = str(folder or "").strip()
    if not text or not os.path.isabs(text):
        return None
    real = Path(os.path.realpath(text))
    if not real.is_dir():
        return None
    home_real = Path(os.path.realpath(home))
    if real == home_real or real.is_relative_to(home_real):
        return real
    for root in BROWSER_DOWNLOAD_MEDIA_ROOTS:
        if real != root and real.is_relative_to(root):
            return real
    return None


def _why(exc: BaseException) -> str:
    if isinstance(exc, OSError) and exc.strerror:
        return f"{type(exc).__name__}: {exc.strerror}"
    return type(exc).__name__


def _shut(fd: int) -> None:
    try:
        copy = socket.socket(fileno=os.dup(fd))
    except OSError:
        return
    try:
        copy.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    finally:
        copy.close()


def _hold(entry: dict, sock) -> None:
    with _active_lock:
        _release(entry)
        try:
            entry["fd"] = os.dup(sock.fileno())
        except OSError:
            return
        if _halted(entry) or entry.get("stalled"):
            _shut(entry["fd"])


def _release(entry: dict) -> None:
    fd = entry.pop("fd", None)
    if fd is not None:
        try:
            os.close(fd)
        except OSError:
            pass


def _recording(base, entry: dict):
    class Recording(base):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            create = self._create_connection

            def create_and_hold(*a, **k):
                sock = create(*a, **k)
                _hold(entry, sock)
                return sock

            self._create_connection = create_and_hold

    return Recording


class _RecordingHTTP(urllib.request.HTTPHandler):
    def __init__(self, entry: dict):
        super().__init__()
        self._entry = entry

    def http_open(self, req):
        return self.do_open(_recording(http.client.HTTPConnection, self._entry), req)


class _RecordingHTTPS(urllib.request.HTTPSHandler):
    def __init__(self, entry: dict, context):
        super().__init__(context=context)
        self._entry = entry

    def https_open(self, req):
        extra = {"check_hostname": self._check_hostname} if hasattr(self, "_check_hostname") else {}
        return self.do_open(_recording(http.client.HTTPSConnection, self._entry), req, context=self._context, **extra)


def _name_from_disposition(header: str) -> str:
    text = str(header or "")
    star = _DISPOSITION_STAR.search(text)
    if star:
        encoding = star.group(1).strip() or "utf-8"
        try:
            return unquote(star.group(2).strip().strip('"'), encoding=encoding)
        except LookupError:
            return unquote(star.group(2).strip().strip('"'))
    plain = _DISPOSITION_PLAIN.search(text)
    if plain:
        quoted = plain.group(1)
        if quoted is not None:
            return re.sub(r"\\(.)", r"\1", quoted)
        return plain.group(2).strip()
    return ""


def _download_name(disposition: str, suggested: str, url: str) -> str:
    from_url = unquote(urlparse(url).path).rsplit("/", 1)[-1] if url.startswith("http") else ""
    for candidate in (
        _name_from_disposition(disposition),
        suggested,
        from_url,
    ):
        cleaned = _scrub_name(candidate)
        if cleaned:
            return cleaned
    return "download"


def _claim_destination(folder: Path, name: str, download_id: str) -> Path:
    claimed = {entry["path"] for entry in _active_downloads.values() if entry.get("path") is not None}
    stem, suffix = os.path.splitext(name)
    candidate = folder / name
    index = 1
    while os.path.lexists(candidate) or candidate in claimed or os.path.lexists(str(candidate) + ".part"):
        candidate = folder / f"{stem} ({index}){suffix}"
        index += 1
    _active_downloads[download_id]["path"] = candidate
    return candidate


class _StartOver(Exception):
    pass


class _RangeEnded(Exception):
    def __init__(self, total: int):
        super().__init__(total)
        self.total = total


class _HeldPart:
    def __init__(self):
        self.dir_fd = None
        self.fd = None
        self.name = ""
        self.size = 0
        self.touched = False
        self.done = False

    def write(self, data: bytes) -> None:
        self.touched = True
        view = memoryview(data)
        while view:
            view = view[os.write(self.fd, view):]
        self.size += len(data)

    def close(self) -> None:
        for fd in (self.fd, self.dir_fd):
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass
        self.fd = self.dir_fd = None


def _halted(entry: dict) -> str:
    if entry.get("canceled"):
        return "canceled"
    if entry.get("paused"):
        return "paused"
    return ""


def _validator_of(response) -> dict:
    found = {}
    etag = (response.headers.get("ETag") or "").strip()
    if etag and not etag.startswith("W/") and len(etag) <= 256:
        found["etag"] = etag
    modified = (response.headers.get("Last-Modified") or "").strip()
    if modified and len(modified) <= 256:
        found["lastModified"] = modified
    return found


class _DownloadError(Exception):
    def __init__(self, code: str, detail: str = "", why: str = "", before_body: bool = False):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail or code
        self.why = why or (detail if detail.startswith("HTTP ") else "")
        self.before_body = before_body


def _site_of(url: str):
    parsed = urlparse(url)
    return (parsed.hostname or "").rstrip(".")


class _DownloadRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old = urlparse(req.full_url)
        new = urlparse(newurl)
        if new.scheme not in ("http", "https") or not new.hostname:
            if fp is not None:
                fp.close()
            raise _DownloadError("bad_link", "redirected off http(s)")
        follow = super().redirect_request(req, fp, code, msg, headers, newurl)
        if follow is None:
            return None
        downgrade = old.scheme == "https" and new.scheme == "http"
        if downgrade or _site_of(req.full_url) != _site_of(newurl):
            follow.remove_header("Cookie")
            referer = follow.get_header("Referer")
            if referer is not None:
                follow.remove_header("Referer")
                origin = urlparse(referer)
                if not downgrade and origin.scheme and origin.netloc:
                    follow.add_header("Referer", f"{origin.scheme}://{origin.netloc}/")
        return follow


def _download_action(row: dict) -> str:
    state = row["state"]
    if not (row["url"] or row["origin"]):
        return ""
    if state == "downloading":
        return "pause"
    if state == "paused":
        return "resume"
    if state in ("failed", "interrupted"):
        return "continue" if row["part"] is not None else "restart"
    if state == "canceled":
        return "restart"
    return ""


def _display_location(row: dict, home_real: str) -> str:
    folder = row["folder"]
    if not folder:
        return ""
    home = home_real.rstrip("/")
    if folder == home:
        folder = "~"
    elif folder.startswith(home + "/"):
        folder = "~" + folder[len(home):]
    return folder.rstrip("/") + "/" + row["name"]


def _public_download(row: dict, home_real: str) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "state": row["state"],
        "error": row["error"],
        "received": row["received"],
        "total": row["total"],
        "startedAt": row["startedAt"],
        "finishedAt": row["finishedAt"],
        "canDelete": row["state"] == "done" and row["file"] is not None and not row["fileGone"],
        "fileGone": row["fileGone"],
        "url": row["url"],
        "origin": row["origin"],
        "note": row["note"],
        "canResume": row["canResume"],
        "action": _download_action(row),
        "location": _display_location(row, home_real),
    }


def _open_download_dir(home: Path, row: dict) -> Optional[int]:
    folder = Path(row.get("folder") or "")
    if not folder.is_absolute() or _download_folder(home, folder) != folder:
        return None
    try:
        return open_dir(folder, trusted=_ROOT)
    except OSError:
        return None


_FAT_TYPES = ("vfat", "exfat", "msdos", "fat")


def _on_fat(folder: str) -> bool:
    best, fstype = "", ""
    try:
        with open("/proc/self/mounts", encoding="utf-8", errors="replace") as mounts:
            for line in mounts:
                parts = line.split()
                if len(parts) < 3:
                    continue
                point = parts[1].replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")
                inside = folder == point or folder.startswith(point.rstrip("/") + "/")
                if inside and len(point) >= len(best):
                    best, fstype = point, parts[2]
    except OSError:
        return False
    return fstype in _FAT_TYPES


def _matches(dir_fd: int, name: str, identity, fat: bool = False) -> str:
    try:
        st = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        return "gone"
    if not stat.S_ISREG(st.st_mode):
        return "changed"
    if [st.st_dev, st.st_ino] == list(identity[:2]) and (len(identity) < 3 or st.st_size == identity[2]):
        return "match"
    if fat and len(identity) == 4 and st.st_size == identity[2] and abs(st.st_mtime_ns - identity[3]) <= BROWSER_DOWNLOAD_MTIME_SLACK * 1e9:
        owner = child_owner()
        if owner is None or st.st_uid == owner[0]:
            return "match"
    return "changed"


def _unmounted(folder: str) -> bool:
    for root in BROWSER_DOWNLOAD_MEDIA_ROOTS:
        if folder.startswith(str(root) + "/"):
            try:
                return os.stat(folder).st_dev == os.stat(root).st_dev
            except OSError:
                return False
    return False


def _delete_download_file(home: Path, row: dict) -> str:
    name = row.get("name") or ""
    if not name or name in (".", "..") or "/" in name:
        return "changed"
    if _unmounted(row.get("folder") or ""):
        return "unavailable"
    dir_fd = _open_download_dir(home, row)
    if dir_fd is None:
        return "unavailable" if not os.path.isdir(row.get("folder") or "") else "changed"
    try:
        found = _matches(dir_fd, name, row["file"], _on_fat(row.get("folder") or ""))
        if found != "match":
            return found
        os.unlink(name, dir_fd=dir_fd)
        return "deleted"
    except FileNotFoundError:
        return "gone"
    except OSError as exc:
        decky.logger.warning("browser download: delete failed (%s)", _why(exc))
        return "failed"
    finally:
        os.close(dir_fd)


def _claimed_elsewhere(path: Path, download_id) -> bool:
    return any(key != download_id and entry.get("path") == path for key, entry in _active_downloads.items())


def _same_part(st, row: dict, fat: bool) -> bool:
    if not stat.S_ISREG(st.st_mode) or row.get("part") is None:
        return False
    check = row.get("partCheck")
    if not fat:
        return [st.st_dev, st.st_ino] == list(row["part"]) and (check is None or st.st_size >= check[0])
    if check is None:
        return False
    owner = child_owner()
    if owner is not None and st.st_uid != owner[0]:
        return False
    return st.st_size >= check[0] and st.st_mtime_ns >= check[1] - BROWSER_DOWNLOAD_MTIME_SLACK * 1e9


def _find_part(home: Path, row: dict):
    name = row.get("name") or ""
    if not name or name in (".", "..") or "/" in name or row.get("part") is None:
        return "gone", None
    folder = row.get("folder") or ""
    with _active_lock:
        if _claimed_elsewhere(Path(folder) / name, row.get("id")):
            return "changed", None
    if _unmounted(folder):
        return "unavailable", None
    dir_fd = _open_download_dir(home, row)
    if dir_fd is None:
        return ("unavailable" if not os.path.isdir(folder) else "changed"), None
    try:
        st = os.stat(name + ".part", dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        return "gone", None
    except OSError:
        return "unavailable", None
    finally:
        os.close(dir_fd)
    return ("match", st) if _same_part(st, row, _on_fat(folder)) else ("changed", None)


def _delete_part(home: Path, row: dict) -> str:
    found, _ = _find_part(home, row)
    if found != "match":
        return found
    dir_fd = _open_download_dir(home, row)
    if dir_fd is None:
        return "unavailable"
    name = row["name"] + ".part"
    try:
        st = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
        if not _same_part(st, row, _on_fat(row["folder"])):
            return "changed"
        os.unlink(name, dir_fd=dir_fd)
        return "deleted"
    except FileNotFoundError:
        return "gone"
    except OSError as exc:
        decky.logger.warning("browser download: .part not removed (%s)", _why(exc))
        return "failed"
    finally:
        os.close(dir_fd)


def _delete_parts(home: Path, rows: list) -> None:
    unavailable = 0
    for row in rows:
        if row.get("part") is not None and _delete_part(home, row) == "unavailable":
            unavailable += 1
    if unavailable:
        decky.logger.info("browser download: %d .part file(s) left on a folder that isn't available", unavailable)


def _tabs_response(state: dict, reason: str = "") -> dict:
    return {
        "ok": not reason,
        "reason": reason,
        "tabs": state["tabs"],
        "activeTabId": state["activeTabId"],
        "panelTab": state["panelTab"],
        "maxTabs": MAX_TABS,
    }


def _history_response(state: dict) -> dict:
    return {
        "ok": True,
        "entries": state["entries"],
    }


def _bookmarks_response(state: dict, reason: str = "") -> dict:
    return {
        "ok": not reason,
        "reason": reason,
        "bookmarks": state["bookmarks"],
        "categories": state["categories"],
        "defaultCategoryId": state["defaultCategoryId"],
        "collapsedCategoryIds": state["collapsedCategoryIds"],
        "maxBookmarks": MAX_BOOKMARKS,
        "maxCategories": MAX_BOOKMARK_CATEGORIES,
    }


def _ad_exemptions_response(state: dict, reason: str = "") -> dict:
    return {
        "ok": not reason,
        "reason": reason,
        "hosts": state["hosts"],
        "maxHosts": MAX_AD_EXEMPTIONS,
    }


def _default_download_folder(home: Path, stored: str) -> Path:
    if stored and _download_folder(home, stored) is not None:
        return Path(stored)
    downloads = home / "Downloads"
    return downloads if downloads.is_dir() else home


def _settings_response(home: Path, state: dict) -> dict:
    return {
        "ok": True,
        "pageZoom": state["pageZoom"],
        "historyRetention": state["historyRetention"],
        "searchEngine": state["searchEngine"],
        "newTabPage": state["newTabPage"],
        "customNewTabUrl": state["customNewTabUrl"],
        "customSearchUrl": state["customSearchUrl"],
        "openLinksInNewTab": state["openLinksInNewTab"],
        "blockAds": state["blockAds"],
        "fastForwardYouTubeAds": state["fastForwardYouTubeAds"],
        "fastForwardPrerollAds": state["fastForwardPrerollAds"],
        "activeTabs": state["activeTabs"],
        "pauseMediaOnTabSwitch": state["pauseMediaOnTabSwitch"],
        "maxDownloads": state["maxDownloads"],
        "downloadFolder": str(_default_download_folder(home, state["downloadFolder"])),
        "rememberDownloadFolder": state["rememberDownloadFolder"],
        "expanded": state["expanded"],
    }


_RETENTION_DAYS = {"7": 7, "30": 30}


class BrowserMixin(PluginContext):

    def _history_retention(self) -> str:
        return self.browser_store.list_settings()["historyRetention"]

    async def load_browser_settings(self):
        return _settings_response(self.user_home, self.browser_store.list_settings())

    async def save_browser_page_zoom(self, value=80):
        return _settings_response(self.user_home, self.browser_store.set_page_zoom(value))

    async def save_browser_history_retention(self, value: str = "forever"):
        return _settings_response(self.user_home, self.browser_store.set_history_retention(value))

    async def save_browser_search_engine(self, value: str = "google"):
        return _settings_response(self.user_home, self.browser_store.set_search_engine(value))

    async def save_browser_new_tab_page(self, value: str = "google"):
        return _settings_response(self.user_home, self.browser_store.set_new_tab_page(value))

    async def save_browser_custom_new_tab_url(self, value: str = ""):
        return _settings_response(self.user_home, self.browser_store.set_custom_new_tab_url(value))

    async def save_browser_custom_search_url(self, value: str = ""):
        return _settings_response(self.user_home, self.browser_store.set_custom_search_url(value))

    async def save_browser_open_links_in_new_tab(self, value: bool = False):
        return _settings_response(self.user_home, self.browser_store.set_open_links_in_new_tab(value))

    async def save_browser_block_ads(self, value: bool = True):
        return _settings_response(self.user_home, self.browser_store.set_block_ads(value))

    async def save_browser_fast_forward_youtube_ads(self, value: bool = True):
        return _settings_response(self.user_home, self.browser_store.set_fast_forward_youtube_ads(value))

    async def save_browser_fast_forward_preroll_ads(self, value: bool = False):
        return _settings_response(self.user_home, self.browser_store.set_fast_forward_preroll_ads(value))

    async def save_browser_active_tabs(self, value: int = 3):
        return _settings_response(self.user_home, self.browser_store.set_active_tabs(value))

    async def save_browser_max_downloads(self, value: int = 16):
        state = self.browser_store.set_max_downloads(value)
        await asyncio.to_thread(self._start_queued)
        return _settings_response(self.user_home, state)

    async def save_browser_pause_media_on_tab_switch(self, value: bool = False):
        return _settings_response(self.user_home, self.browser_store.set_pause_media_on_tab_switch(value))

    async def save_links_open_in_web_browser(self, value: bool = True):
        return {
            "ok": True,
            "linksOpenInWebBrowser": self.settings_store.update_links_open_in_web_browser(value),
        }

    async def save_browser_download_folder(self, path: str = ""):
        if _download_folder(self.user_home, path) is not None:
            self.browser_store.set_download_folder(path)
        return _settings_response(self.user_home, self.browser_store.list_settings())

    async def save_browser_remember_download_folder(self, value: bool = False):
        return _settings_response(self.user_home, self.browser_store.set_remember_download_folder(value))

    async def save_browser_expanded(self, value: bool = False):
        return _settings_response(self.user_home, self.browser_store.set_expanded(value))

    async def get_browser_download_folder(self):
        state = self.browser_store.list_settings()
        last = state["lastDownloadFolder"]
        if state["rememberDownloadFolder"] and last and _download_folder(self.user_home, last) is not None:
            return {"ok": True, "path": last}
        return {"ok": True, "path": str(_default_download_folder(self.user_home, state["downloadFolder"]))}

    async def start_browser_download(
        self,
        url: str = "",
        folder: str = "",
        suggested_name: str = "",
        cookie: str = "",
        user_agent: str = "",
        referer: str = "",
        chosen_name: str = "",
        origin: str = "",
    ):
        target = str(url or "").strip()
        parsed = urlparse(target)
        is_data = parsed.scheme == "data"
        if is_data:
            if len(target) > BROWSER_DATA_URL_MAX:
                return {"ok": False, "error": "too_big"}
        elif parsed.scheme not in ("http", "https") or not parsed.hostname:
            return {"ok": False, "error": "bad_link"}
        destination = _download_folder(self.user_home, folder)
        if destination is None:
            return {"ok": False, "error": "bad_folder"}

        limit = self.browser_store.list_settings()["maxDownloads"]
        download_id = uuid.uuid4().hex
        with _active_lock:
            queue = len(_active_downloads) >= limit or bool(_queued)
            if not queue:
                _active_downloads[download_id] = {"path": None, "canceled": False, "received": 0, "total": -1}

        headers = {}
        if not is_data:
            if cookie:
                headers["Cookie"] = str(cookie)
            if user_agent:
                headers["User-Agent"] = str(user_agent)
            if clean_referer(referer):
                headers["Referer"] = str(referer)

        self.browser_store.set_last_download_folder(str(folder).strip())

        record = self.browser_store.downloads_path()
        if not queue:
            with _active_lock:
                _active_downloads[download_id]["record"] = record
        name = _scrub_name(chosen_name) or _scrub_name(suggested_name) or "download"
        queued_at = _queue_stamp()
        self._add_download_row(record, {
            "id": download_id,
            "name": name,
            "folder": str(destination),
            "state": "queued" if queue else "downloading",
            "startedAt": int(time.time()),
            "queuedAt": queued_at if queue else 0,
            "run": _RUN_ID,
            "url": "" if is_data else target,
            "origin": "" if is_data or origin == target else str(origin or ""),
            "referer": headers.get("Referer", ""),
        })
        if queue:
            self._enqueue(download_id, {
                "record": record, "at": queued_at, "headers": headers, "kind": "start",
                "url": target, "suggested": str(suggested_name or ""), "chosen": str(chosen_name or ""),
            })
            await asyncio.to_thread(self._start_queued)
            with _active_lock:
                waiting = download_id in _queued
            return {"ok": True, "id": download_id, "queued": waiting}
        self._start_worker(download_id, target, destination, str(suggested_name or ""), str(chosen_name or ""), headers, record)
        return {"ok": True, "id": download_id}

    def _start_worker(self, download_id, url, folder, suggested, chosen, headers, record, resume=None, fallback=None) -> None:
        threading.Thread(
            target=self._run_browser_download,
            args=(download_id, url, folder, suggested, chosen, headers, record, resume, fallback),
            name=f"browser-download-{download_id[:8]}",
            daemon=True,
        ).start()

    def _add_download_row(self, record: Path, row: dict) -> None:
        try:
            dropped = self.browser_store.add_download(record, row)
        except Exception as exc:
            decky.logger.warning("browser download: couldn't record the download (%s)", type(exc).__name__)
            return
        if any(entry["part"] is not None for entry in dropped):
            home = self.user_home
            threading.Thread(target=_delete_parts, args=(home, dropped), name="browser-download-rotate", daemon=True).start()

    def _record_download(self, record: Path, download_id: str, **fields) -> None:
        try:
            self.browser_store.update_download(record, download_id, **fields)
        except Exception as exc:
            decky.logger.warning("browser download: couldn't update the list (%s)", type(exc).__name__)

    def _run_browser_download(self, download_id, url, folder, suggested, chosen, headers, record, resume=None, fallback=None):
        host = urlparse(url).hostname or ""
        name = _scrub_name(chosen) or _scrub_name(suggested) or "download"
        result = {"id": download_id, "ok": False, "name": name, "folder": str(folder), "error": ""}
        fields = {}
        try:
            try:
                path, written, identity = self._fetch_browser_download(download_id, url, folder, suggested, chosen, headers, host, record, resume)
            except _DownloadError as exc:
                if fallback is None or not exc.before_body or exc.code in ("canceled", "paused"):
                    raise
                decky.logger.info("browser download: the starting address failed (%s), trying the address it led to", exc.code)
                url, headers = fallback
                host = urlparse(url).hostname or ""
                with _active_lock:
                    _active_downloads[download_id]["stalled"] = False
                path, written, identity = self._fetch_browser_download(download_id, url, folder, suggested, chosen, headers, host, record, resume)
            result["ok"] = True
            result["name"] = path.name
            fields = {"state": "done", "name": path.name, "received": written, "file": identity, "part": None, "partCheck": None}
        except _DownloadError as exc:
            result["error"] = exc.code
            claimed = _active_downloads.get(download_id, {}).get("path")
            if claimed is not None:
                result["name"] = claimed.name
            debug = getattr(self, "_debug_logging", False)
            if exc.code in ("canceled", "paused"):
                fields = {"state": exc.code, "error": "" if exc.code == "paused" else exc.code, "name": result["name"]}
                decky.logger.info("browser download %s", exc.code)
                if debug:
                    decky.logger.info("browser download %s: %s from %s", exc.code, result["name"], host)
            else:
                fields = {"state": "failed", "error": exc.code, "name": result["name"]}
                decky.logger.error("browser download failed: %s%s", exc.code, f" ({exc.why})" if exc.why else "")
                if debug:
                    decky.logger.info("browser download failed: %s from %s: %s", result["name"], host, exc.detail)
        except Exception as exc:
            result["error"] = "failed"
            fields = {"state": "failed", "error": "failed"}
            decky.logger.error("browser download failed (%s)", _why(exc))
        finally:
            with _active_lock:
                entry = _active_downloads.pop(download_id, None) or {}
                _release(entry)
            fields.setdefault("received", entry.get("received", 0))
            fields["total"] = entry.get("total", -1)
            fields["finishedAt"] = int(time.time())
            self._record_download(record, download_id, **fields)
        self._start_queued()
        self._emit_browser_download(result)

    def _fetch_browser_download(self, download_id, url, folder, suggested, chosen, headers, host, record, resume=None):
        is_data = url.startswith("data:")
        entry = _active_downloads[download_id]
        held = _HeldPart()
        try:
            if resume is not None:
                self._reopen_part(held, folder, resume, download_id, record)
            offset = held.size
            validator = (resume or {}).get("validator") or {}
            known_total = to_int((resume or {}).get("total", -1), -1)
            ranged = offset > 0 and (bool(validator) or known_total >= 0)
            while True:
                request_headers = dict(headers)
                if ranged:
                    request_headers["Range"] = f"bytes={held.size}-"
                    if validator.get("etag"):
                        request_headers["If-Range"] = validator["etag"]
                    elif validator.get("lastModified"):
                        request_headers["If-Range"] = validator["lastModified"]
                try:
                    response = self._open_download(url, request_headers, entry, is_data)
                except _DownloadError as exc:
                    exc.before_body = True
                    raise
                except _RangeEnded as ended:
                    total = known_total if known_total >= 0 else ended.total
                    if total >= 0 and held.size == total:
                        entry["total"] = total
                        return self._finish_part(held, folder, download_id)
                    ranged = False
                    continue
                try:
                    with response:
                        return self._save_response(
                            response, entry, download_id, folder, suggested, chosen, host, record, is_data, held, ranged, known_total
                        )
                except _StartOver:
                    ranged = False
                finally:
                    with _active_lock:
                        _release(entry)
        except _DownloadError as exc:
            self._leave_part(held, exc.code, record, download_id)
            raise
        finally:
            held.close()

    def _open_download(self, url, headers, entry, is_data):
        request = urllib.request.Request(url, headers=headers)
        opener = urllib.request.build_opener(
            _RecordingHTTP(entry), _RecordingHTTPS(entry, ssl_context()), _DownloadRedirect()
        )

        def headers_overdue():
            with _active_lock:
                if not entry.get("answered"):
                    entry["stalled"] = True
                    if entry.get("fd") is not None:
                        _shut(entry["fd"])

        with _active_lock:
            entry["answered"] = False
        deadline = threading.Timer(BROWSER_DOWNLOAD_HEADERS_SECONDS, headers_overdue)
        deadline.daemon = True
        deadline.start()
        try:
            return opener.open(request, timeout=BROWSER_DOWNLOAD_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as exc:
            if exc.code == 416 and "Range" in headers:
                match = _RANGE_UNSATISFIED.search(exc.headers.get("Content-Range", "") if exc.headers else "")
                exc.close()
                raise _RangeEnded(to_int(match.group(1), -1) if match else -1) from exc
            raise _DownloadError("refused" if 400 <= exc.code < 500 else "failed", f"HTTP {exc.code}") from exc
        except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as exc:
            halted = _halted(entry)
            if halted:
                raise _DownloadError(halted) from exc
            if entry.get("stalled"):
                raise _DownloadError("stalled", "no headers in time") from exc
            raise _DownloadError("bad_link" if is_data else "failed", f"{type(exc).__name__}: {exc}", _why(exc)) from exc
        finally:
            with _active_lock:
                entry["answered"] = True
            deadline.cancel()

    def _save_response(self, response, entry, download_id, folder, suggested, chosen, host, record, is_data, held=None, ranged=False, known_total=-1):
        held = held or _HeldPart()
        with _active_lock:
            halted = _halted(entry)
            stalled = entry.get("stalled", False)
        if halted:
            raise _DownloadError(halted)
        if stalled:
            raise _DownloadError("stalled", "no headers in time")

        final = response.geturl()
        if not is_data and urlparse(final).scheme not in ("http", "https"):
            raise _DownloadError("bad_link", "redirected off http(s)")
        status = getattr(response, "status", None)
        partial = ranged and status == 206
        if partial:
            match = _RANGE_ANSWER.search(response.headers.get("Content-Range", ""))
            whole = to_int(match.group(3), -1) if match else -1
            if match is None or to_int(match.group(1), -1) != held.size or (known_total >= 0 and whole >= 0 and whole != known_total):
                raise _StartOver()
        elif not is_data and status is not None and (status < 200 or status >= 300 or status in (204, 205, 206)):
            raise _DownloadError("failed", f"HTTP {status}", before_body=True)

        expected = _scrub_name(suggested) or _download_name("", "", final)
        content_type = response.headers.get_content_type()
        if not is_data and content_type in _WEB_PAGE_TYPES and not expected.lower().endswith(_WEB_PAGE_SUFFIXES):
            raise _DownloadError("web_page", f"{content_type} for {expected}", before_body=True)

        length = to_int(response.headers.get("Content-Length"), -1)
        if partial:
            total = whole if whole >= 0 else (held.size + length if length >= 0 else -1)
        else:
            total = length
        if total > BROWSER_DOWNLOAD_MAX_BYTES:
            raise _DownloadError("too_big", f"{total} bytes")
        if held.fd is not None and not partial and held.size > 0:
            self._start_part_over(held, record, download_id)
        if length > 0:
            try:
                free = shutil.disk_usage(folder).free
            except OSError:
                free = None
            if free is not None and free < length:
                raise _DownloadError("no_space", f"{length} bytes, {free} free")

        validator = {} if is_data else _validator_of(response)
        can_resume = partial or "bytes" in (response.headers.get("Accept-Ranges") or "").lower()
        if held.fd is None:
            name = _scrub_name(chosen) or _download_name(response.headers.get("Content-Disposition", ""), suggested, final)
            with _active_lock:
                path = _claim_destination(folder, name, download_id)
            self._create_part(held, path, record, download_id)
        else:
            path = folder / held.name
        with _active_lock:
            entry["total"] = total
        decky.logger.info("browser download %s (%s)", "continued" if partial else "started", f"{total} bytes" if total >= 0 else "size unknown")
        if getattr(self, "_debug_logging", False):
            decky.logger.info("browser download from %s to %s", host, path)

        offset = held.size
        part = os.fstat(held.fd)
        self._record_download(
            record, download_id, name=path.name, total=total, part=[part.st_dev, part.st_ino],
            partCheck=[part.st_size, part.st_mtime_ns], validator=validator, canResume=can_resume,
        )
        os.lseek(held.fd, offset, os.SEEK_SET)

        read = getattr(response, "read1", None) or response.read
        written = 0
        window_start = last_report = last_checkpoint = time.monotonic()
        window_bytes = 0
        while True:
            try:
                chunk = read(BROWSER_DOWNLOAD_READ)
            except (OSError, ValueError) as exc:
                halted = _halted(entry)
                if halted:
                    raise _DownloadError(halted) from exc
                raise _DownloadError("failed", f"{type(exc).__name__}: {exc}", _why(exc)) from exc
            halted = _halted(entry)
            if halted:
                raise _DownloadError(halted)
            if not chunk:
                break
            if offset + written + len(chunk) > BROWSER_DOWNLOAD_MAX_BYTES:
                raise _DownloadError("too_big", f"over {BROWSER_DOWNLOAD_MAX_BYTES} bytes")
            try:
                held.write(chunk)
            except OSError as exc:
                code = "no_space" if exc.errno == errno.ENOSPC else "write_failed"
                raise _DownloadError(code, f"{type(exc).__name__}: {exc}", _why(exc)) from exc
            written += len(chunk)
            window_bytes += len(chunk)
            entry["received"] = offset + written
            now = time.monotonic()
            if now - window_start >= BROWSER_DOWNLOAD_STALL_SECONDS:
                if window_bytes < BROWSER_DOWNLOAD_STALL_BYTES:
                    raise _DownloadError("stalled", f"{window_bytes} bytes in {int(now - window_start)}s")
                window_start = now
                window_bytes = 0
            if now - last_report >= BROWSER_DOWNLOAD_PROGRESS_SECONDS:
                last_report = now
                self._emit_browser_event(BROWSER_DOWNLOAD_PROGRESS_EVENT, {"id": download_id, "received": offset + written, "total": total})
            if now - last_checkpoint >= BROWSER_DOWNLOAD_CHECKPOINT_SECONDS:
                last_checkpoint = now
                check = os.fstat(held.fd)
                self._record_download(record, download_id, received=offset + written, partCheck=[check.st_size, check.st_mtime_ns])
        if length >= 0 and written < length:
            raise _DownloadError("failed", f"ended at {offset + written} of {total} bytes")
        if partial and total >= 0 and offset + written != total:
            raise _DownloadError("failed", f"ended at {offset + written} of {total} bytes")
        return self._finish_part(held, folder, download_id)

    def _reopen_part(self, held, folder, resume, download_id, record) -> None:
        name = resume.get("name") or ""
        if not name or name in (".", "..") or "/" in name or resume.get("part") is None:
            return
        with _active_lock:
            elsewhere = _claimed_elsewhere(folder / name, download_id)
            _active_downloads[download_id]["path"] = None
        if elsewhere:
            self._note_restart(record, download_id, "missing")
            return
        try:
            dir_fd = open_dir(folder, trusted=_ROOT)
        except OSError as exc:
            raise _DownloadError("bad_folder", f"{type(exc).__name__}: {exc}", _why(exc)) from exc
        try:
            st = os.stat(name + ".part", dir_fd=dir_fd, follow_symlinks=False)
            if not _same_part(st, resume, _on_fat(str(folder))):
                raise FileNotFoundError(name)
            fd = os.open(name + ".part", os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=dir_fd)
        except OSError:
            os.close(dir_fd)
            decky.logger.warning("browser download: the .part is gone or is not this download's, starting over")
            self._note_restart(record, download_id, "missing")
            return
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (st.st_dev, st.st_ino):
            os.close(fd)
            os.close(dir_fd)
            self._note_restart(record, download_id, "missing")
            return
        held.dir_fd, held.fd, held.name, held.size = dir_fd, fd, name, opened.st_size
        with _active_lock:
            _active_downloads[download_id]["path"] = folder / name
            _active_downloads[download_id]["received"] = opened.st_size

    def _create_part(self, held, path: Path, record, download_id) -> None:
        dir_fd = open_dir(path.parent, trusted=_ROOT)
        try:
            fd = os.open(path.name + ".part", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o666, dir_fd=dir_fd)
        except OSError as exc:
            os.close(dir_fd)
            raise _DownloadError("write_failed", f"{type(exc).__name__}: {exc}", _why(exc)) from exc
        held.dir_fd, held.fd, held.name, held.size, held.touched = dir_fd, fd, path.name, 0, True
        chown_to_data_owner(fd)
        records = {record}
        try:
            records.update(Path(self.runtime_dir).glob(f"*/browser/{DOWNLOADS_FILENAME}"))
        except OSError:
            pass
        for other in records:
            try:
                self.browser_store.forget_part(other, str(path.parent), path.name, download_id)
            except Exception as exc:
                decky.logger.warning("browser download: couldn't update other rows (%s)", type(exc).__name__)

    def _start_part_over(self, held, record, download_id) -> None:
        if held.fd is not None and held.size > 0:
            os.ftruncate(held.fd, 0)
            os.lseek(held.fd, 0, os.SEEK_SET)
            held.size = 0
        held.touched = True
        self._note_restart(record, download_id)

    def _note_restart(self, record, download_id, note: str = "restarted") -> None:
        with _active_lock:
            entry = _active_downloads.get(download_id)
            if entry is not None:
                entry["received"] = 0
        if note == "missing":
            self._record_download(record, download_id, note=note, received=0, part=None, partCheck=None)
        else:
            self._record_download(record, download_id, note=note, received=0)

    def _finish_part(self, held, folder, download_id):
        done = os.fstat(held.fd)
        part = held.name + ".part"
        name = held.name
        try:
            while True:
                try:
                    os.link(part, name, src_dir_fd=held.dir_fd, dst_dir_fd=held.dir_fd, follow_symlinks=False)
                    os.unlink(part, dir_fd=held.dir_fd)
                    break
                except FileExistsError:
                    pass
                except OSError as exc:
                    if exc.errno not in (errno.EPERM, errno.EOPNOTSUPP, errno.ENOTSUP):
                        raise
                    try:
                        os.stat(name, dir_fd=held.dir_fd, follow_symlinks=False)
                    except FileNotFoundError:
                        os.replace(part, name, src_dir_fd=held.dir_fd, dst_dir_fd=held.dir_fd)
                        break
                with _active_lock:
                    name = _claim_destination(folder, held.name, download_id).name
        except OSError as exc:
            raise _DownloadError("write_failed", f"{type(exc).__name__}: {exc}", _why(exc)) from exc
        held.done = True
        size = done.st_size
        decky.logger.info("browser download saved (%d bytes)", size)
        return folder / name, size, [done.st_dev, done.st_ino, size, done.st_mtime_ns]

    def _leave_part(self, held, code: str, record, download_id) -> None:
        if held.fd is None or held.done:
            return
        if code != "canceled" and not held.touched:
            return
        try:
            size = os.fstat(held.fd).st_size
            keep = code not in ("canceled", "too_big", "web_page", "bad_link", "bad_folder") and size > 0
            if keep:
                os.fsync(held.fd)
                st = os.fstat(held.fd)
                with _active_lock:
                    entry = _active_downloads.get(download_id)
                    if entry is not None:
                        entry["received"] = st.st_size
                self._record_download(
                    record, download_id, received=st.st_size, part=[st.st_dev, st.st_ino], partCheck=[st.st_size, st.st_mtime_ns]
                )
                return
            os.unlink(held.name + ".part", dir_fd=held.dir_fd)
        except FileNotFoundError:
            pass
        except OSError as exc:
            decky.logger.warning("browser download: .part not settled (%s)", _why(exc))
            return
        self._record_download(record, download_id, part=None, partCheck=None)

    def _emit_browser_event(self, event: str, payload: dict) -> None:
        loop = getattr(self, "_asyncio_loop", None)
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(decky.emit(event, payload), loop)
        except Exception as exc:
            decky.logger.warning("browser download: event emit failed (%s: %s)", type(exc).__name__, exc)

    def _emit_browser_download(self, payload: dict) -> None:
        self._emit_browser_event(BROWSER_DOWNLOAD_EVENT, payload)

    def _downloads_response(self, record: Path) -> dict:
        rows = self.browser_store.list_downloads(record)["downloads"]
        rows = (
            [row for row in rows if row["state"] == "downloading"]
            + sorted((row for row in rows if row["state"] == "queued"), key=lambda row: row["queuedAt"])
            + [row for row in rows if row["state"] not in ("downloading", "queued")]
        )
        with _active_lock:
            live = {key: dict(entry) for key, entry in _active_downloads.items()}
        for row in rows:
            entry = live.get(row["id"])
            if entry is not None and row["state"] == "downloading":
                row["received"] = entry.get("received", row["received"])
                row["total"] = entry.get("total", row["total"])
        home_real = os.path.realpath(self.user_home)
        return {"ok": True, "downloads": [_public_download(row, home_real) for row in rows]}

    async def get_browser_downloads(self):
        record = self.browser_store.downloads_path()
        self._sweep_interrupted_downloads(record)
        return self._downloads_response(record)

    async def cancel_browser_download(self, download_id: str = ""):
        return self._halt_download(download_id, "canceled")

    async def pause_browser_download(self, download_id: str = ""):
        return self._halt_download(download_id, "paused")

    def _halt_download(self, download_id, how: str) -> dict:
        wanted = str(download_id or "")
        with _active_lock:
            entry = _active_downloads.get(wanted)
            if entry is None:
                return {"ok": False}
            entry[how] = True
            if entry.get("fd") is not None:
                _shut(entry["fd"])
        return {"ok": True}

    async def resume_browser_download(self, download_id: str = "", cookie: str = "", user_agent: str = "", fallback_cookie: str = ""):
        record = self.browser_store.downloads_path()
        row = self._download_row(record, download_id)
        if row is None or not (row["url"] or row["origin"]) or row["state"] not in ("paused", "failed", "interrupted"):
            return {**self._downloads_response(record), "ok": False, "error": "gone"}
        return await self._run_again(record, row, cookie, user_agent, fallback_cookie, restart=False)

    async def restart_browser_download(self, download_id: str = "", cookie: str = "", user_agent: str = "", fallback_cookie: str = ""):
        record = self.browser_store.downloads_path()
        row = self._download_row(record, download_id)
        restartable = row is not None and (row["url"] or row["origin"]) and (
            row["state"] == "canceled" or (row["state"] in ("failed", "interrupted") and row["part"] is None)
        )
        if not restartable:
            return {**self._downloads_response(record), "ok": False, "error": "gone"}
        return await self._run_again(record, row, cookie, user_agent, fallback_cookie, restart=True)

    def _download_row(self, record: Path, download_id) -> Optional[dict]:
        wanted = str(download_id or "")
        return next((entry for entry in self.browser_store.list_downloads(record)["downloads"] if entry["id"] == wanted), None)

    async def _run_again(self, record: Path, row: dict, cookie, user_agent, fallback_cookie, *, restart: bool) -> dict:
        folder = Path(row["folder"])
        if not row["folder"] or _download_folder(self.user_home, folder) != folder:
            return {**self._downloads_response(record), "ok": False, "error": "unavailable"}
        limit = self.browser_store.list_settings()["maxDownloads"]
        download_id = row["id"]
        headers = {}
        if cookie:
            headers["Cookie"] = str(cookie)
        if user_agent:
            headers["User-Agent"] = str(user_agent)
        if row["referer"]:
            headers["Referer"] = row["referer"]
        fallback = None
        if row["origin"] and row["url"] and row["origin"] != row["url"]:
            second = {key: value for key, value in headers.items() if key != "Cookie"}
            if fallback_cookie:
                second["Cookie"] = str(fallback_cookie)
            fallback = (row["url"], second)
        refused = queue = False
        with _active_lock:
            if download_id in _active_downloads or download_id in _removing or download_id in _queued:
                refused = True
            elif len(_active_downloads) >= limit or _queued:
                queue = True
            else:
                _active_downloads[download_id] = {"path": None, "canceled": False, "received": 0, "total": -1, "record": record}
        if refused:
            return {**self._downloads_response(record), "ok": False, "error": "gone"}
        if queue:
            at = _queue_stamp()
            self._record_download(record, download_id, state="queued", queuedAt=at, run=_RUN_ID, error="", finishedAt=0)
            self._enqueue(download_id, {"record": record, "at": at, "headers": headers, "fallback": fallback, "kind": "restart" if restart else "resume"})
            await asyncio.to_thread(self._start_queued)
            return {**self._downloads_response(record), "ok": True}
        if await asyncio.to_thread(self._launch_again, record, row, headers, restart, fallback) == "unavailable":
            with _active_lock:
                _active_downloads.pop(download_id, None)
            await asyncio.to_thread(self._start_queued)
            return {**self._downloads_response(record), "ok": False, "error": "unavailable"}
        return {**self._downloads_response(record), "ok": True}

    def _launch_again(self, record: Path, row: dict, headers: dict, restart: bool, fallback=None) -> str:
        download_id = row["id"]
        folder = Path(row["folder"])
        resume = None if restart or row["part"] is None else {
            "name": row["name"], "part": row["part"], "partCheck": row["partCheck"], "validator": row["validator"], "total": row["total"],
        }
        if resume:
            with _active_lock:
                _active_downloads[download_id]["received"] = row["received"]
                _active_downloads[download_id]["total"] = row["total"]
        if restart:
            if row["part"] is not None and _delete_part(self.user_home, row) == "unavailable":
                return "unavailable"
            self._add_download_row(record, {
                "id": download_id,
                "name": row["name"],
                "folder": row["folder"],
                "state": "downloading",
                "startedAt": int(time.time()),
                "run": _RUN_ID,
                "url": row["url"],
                "origin": row["origin"],
                "referer": row["referer"],
            })
        else:
            note = "missing" if resume is None and row["received"] > 0 else ""
            self._record_download(record, download_id, state="downloading", run=_RUN_ID, note=note, error="", finishedAt=0, queuedAt=0)
        decky.logger.info("browser download %s", "restarted" if restart else "resumed")
        self._start_worker(download_id, row["origin"] or row["url"], folder, row["name"], row["name"], headers, record, resume, fallback)
        return ""

    def _enqueue(self, download_id: str, job: dict) -> None:
        with _active_lock:
            _queued[download_id] = job
        decky.logger.info("browser download queued")

    def _start_queued(self) -> None:
        limit = self.browser_store.list_settings()["maxDownloads"]
        while True:
            picked = []
            with _active_lock:
                for download_id in sorted(_queued, key=lambda key: _queued[key]["at"]):
                    if len(_active_downloads) >= limit:
                        break
                    if download_id in _active_downloads or download_id in _removing:
                        continue
                    job = _queued.pop(download_id)
                    _active_downloads[download_id] = {"path": None, "canceled": False, "received": 0, "total": -1, "record": job["record"]}
                    picked.append((download_id, job))
            if not picked:
                return
            missed = False
            for download_id, job in picked:
                try:
                    started = self._launch_queued(download_id, job)
                except Exception as exc:
                    decky.logger.warning("browser download: a queued download couldn't start (%s)", _why(exc))
                    self._fail_queued(job["record"], download_id, "failed")
                    started = False
                if not started:
                    missed = True
                    with _active_lock:
                        entry = _active_downloads.pop(download_id, None) or {}
                        _release(entry)
            if not missed:
                return

    def _fail_queued(self, record: Path, download_id: str, error: str) -> None:
        row = self._download_row(record, download_id)
        if row is None:
            return
        self._record_download(record, download_id, state="failed", error=error, finishedAt=int(time.time()), queuedAt=0)
        self._emit_browser_download({"id": download_id, "ok": False, "name": row["name"], "folder": row["folder"], "error": error})

    def _launch_queued(self, download_id: str, job: dict) -> bool:
        record = job["record"]
        row = self._download_row(record, download_id)
        if row is None:
            return False
        folder = Path(row["folder"])
        if not row["folder"] or _download_folder(self.user_home, folder) != folder:
            self._fail_queued(record, download_id, "bad_folder")
            return False
        if job["kind"] == "start":
            self._record_download(record, download_id, state="downloading", startedAt=int(time.time()), queuedAt=0, run=_RUN_ID)
            self._start_worker(download_id, job["url"], folder, job["suggested"], job["chosen"], job["headers"], record)
            return True
        if self._launch_again(record, row, job["headers"], job["kind"] == "restart", job.get("fallback")) == "unavailable":
            self._fail_queued(record, download_id, "bad_folder")
            return False
        return True

    async def remove_browser_download(self, download_id: str = ""):
        record = self.browser_store.downloads_path()
        wanted = str(download_id or "")
        with _active_lock:
            busy = wanted in _active_downloads or wanted in _removing
            job = None
            if not busy:
                _removing.add(wanted)
                job = _queued.pop(wanted, None)
        if busy:
            return {**self._downloads_response(record), "ok": False, "error": "gone"}
        refused = ""
        removed = False
        try:
            row = self._download_row(record, wanted)
            if row is not None and row["state"] != "downloading" and row["part"] is not None:
                outcome = await asyncio.to_thread(_delete_part, self.user_home, row)
                if outcome in ("unavailable", "failed"):
                    refused = outcome
            if not refused:
                self.browser_store.remove_download(record, wanted)
                removed = True
        finally:
            with _active_lock:
                _removing.discard(wanted)
                if job is not None and not removed:
                    _queued[wanted] = job
            if job is not None and not removed:
                await asyncio.to_thread(self._start_queued)
        if refused:
            return {**self._downloads_response(record), "ok": False, "error": refused}
        return self._downloads_response(record)

    async def delete_browser_download_file(self, download_id: str = ""):
        record = self.browser_store.downloads_path()
        row = next((entry for entry in self.browser_store.list_downloads(record)["downloads"] if entry["id"] == str(download_id or "")), None)
        if row is None or row["state"] != "done" or row["file"] is None or row["fileGone"]:
            return {**self._downloads_response(record), "ok": False, "error": "gone"}
        outcome = await asyncio.to_thread(_delete_download_file, self.user_home, row)
        if outcome in ("deleted", "gone"):
            self.browser_store.update_download(record, row["id"], fileGone=True)
        if outcome != "deleted":
            decky.logger.warning("browser download: delete refused (%s)", outcome)
        response = self._downloads_response(record)
        if outcome != "deleted":
            return {**response, "ok": False, "error": outcome}
        return response

    def _sweep_interrupted_downloads(self, record: Optional[Path] = None) -> None:
        path = record or self.browser_store.downloads_path()
        try:
            stale = self.browser_store.settle_interrupted(path, _RUN_ID)
        except Exception as exc:
            decky.logger.warning("browser download: interrupted sweep failed (%s)", type(exc).__name__)
            return
        if not stale:
            return
        decky.logger.info("browser download: %d left unfinished by an earlier run", len(stale))
        threading.Thread(target=self._check_stale_parts, args=(path, stale), name="browser-download-sweep", daemon=True).start()

    def _check_stale_parts(self, record: Path, rows: list) -> None:
        for row in rows:
            if row["part"] is None:
                continue
            found, st = _find_part(self.user_home, row)
            if found == "match" and not (row["url"] or row["origin"]):
                _delete_part(self.user_home, row)
                self._record_download(record, row["id"], part=None, partCheck=None)
            elif found == "match":
                self._record_download(
                    record, row["id"], received=st.st_size, part=[st.st_dev, st.st_ino], partCheck=[st.st_size, st.st_mtime_ns]
                )
            elif found in ("gone", "changed"):
                self._record_download(record, row["id"], part=None, partCheck=None)

    def _stop_downloads(self, wait: float, under: Optional[Path] = None) -> None:
        def chosen(entry):
            record = entry.get("record")
            return under is None or (record is not None and Path(record).is_relative_to(under))

        with _active_lock:
            for download_id in [key for key, job in _queued.items() if chosen(job)]:
                del _queued[download_id]
            for entry in _active_downloads.values():
                if chosen(entry):
                    entry["canceled"] = True
                    if entry.get("fd") is not None:
                        _shut(entry["fd"])
        deadline = time.monotonic() + wait
        while time.monotonic() < deadline:
            with _active_lock:
                if not any(chosen(entry) for entry in _active_downloads.values()):
                    return
            time.sleep(0.05)
        decky.logger.warning("browser download: still stopping after %.0fs", wait)

    def _drop_download_parts(self, record: Path) -> None:
        self._stop_downloads(BROWSER_DOWNLOAD_RESET_WAIT_SECONDS, under=record.parent)
        try:
            rows = self.browser_store.list_downloads(record)["downloads"]
        except Exception as exc:
            decky.logger.warning("browser download: couldn't read a download list (%s)", type(exc).__name__)
            return
        _delete_parts(self.user_home, rows)

    def _clear_downloads_for_reset(self) -> None:
        self._stop_downloads(BROWSER_DOWNLOAD_RESET_WAIT_SECONDS)
        try:
            records = sorted(self.runtime_dir.glob(f"*/browser/{DOWNLOADS_FILENAME}"))
        except OSError:
            records = []
        for record in records:
            self._drop_download_parts(record)

    async def get_browser_tabs(self, prune: bool = False):
        days = _RETENTION_DAYS.get(self._history_retention(), 0) if prune else 0
        if days:
            return _tabs_response(self.browser_store.prune_back_history(days))
        return _tabs_response(self.browser_store.list_tabs())

    async def add_browser_tab(self, url: str = "", title: str = "", evict_oldest: bool = False):
        state = self.browser_store.add_tab(url, title, evict_oldest=evict_oldest)
        if state is None:
            return _tabs_response(self.browser_store.list_tabs(), "tabLimit")
        return _tabs_response(state)

    async def close_browser_tab(self, tab_id: str = ""):
        return _tabs_response(self.browser_store.close_tab(tab_id))

    async def close_all_browser_tabs(self):
        return _tabs_response(self.browser_store.close_all_tabs())

    async def set_active_browser_tab(self, tab_id: str = ""):
        return _tabs_response(self.browser_store.set_active_tab(tab_id))

    async def set_browser_panel_tab(self, panel_tab: str = "bookmarks"):
        return _tabs_response(self.browser_store.set_panel_tab(panel_tab))

    async def set_browser_tab_scroll(self, tab_id: str = "", scroll: int = 0, anchor: str = "", url: str = ""):
        return _tabs_response(self.browser_store.set_tab_scroll(tab_id, scroll, anchor, url))

    async def set_browser_tab_title(self, tab_id: str = "", title: str = ""):
        return _tabs_response(self.browser_store.set_tab_title(tab_id, title))

    async def navigate_browser_tab(self, tab_id: str = "", url: str = "", title: str = ""):
        return _tabs_response(self.browser_store.navigate_tab(tab_id, url, title))

    async def set_browser_tab_history_index(self, tab_id: str = "", index: int = 0):
        return _tabs_response(self.browser_store.set_tab_history_index(tab_id, index))

    async def replace_browser_tab_entry(self, tab_id: str = "", old_url: str = "", new_url: str = ""):
        self.browser_store.replace_history_entry(old_url, new_url)
        return _tabs_response(self.browser_store.replace_tab_entry(tab_id, old_url, new_url))

    async def get_browser_history(self):
        retention = self._history_retention()
        days = _RETENTION_DAYS.get(retention, 0)
        if days:
            return _history_response(self.browser_store.prune_history(days))
        if retention == "off":
            return _history_response(self.browser_store.clear_history())
        return _history_response(self.browser_store.list_history())

    async def add_browser_history_entry(self, url: str = "", title: str = ""):
        if self._history_retention() == "off":
            return _history_response(self.browser_store.list_history())
        return _history_response(self.browser_store.add_history_entry(url, title))

    async def remove_browser_history_entry(self, entry_id: str = ""):
        return _history_response(self.browser_store.remove_history_entry(entry_id))

    async def clear_browser_history(self, days: int = 0):
        if to_int(days, 0) > 0:
            response = _history_response(self.browser_store.clear_recent_history(days))
            response["tabs"] = _tabs_response(self.browser_store.clear_recent_back_history(days))
            return response
        response = _history_response(self.browser_store.clear_history())
        response["tabs"] = _tabs_response(self.browser_store.clear_back_history())
        return response

    async def forget_browser_back_history(self):
        self._forget_back_history_if_off()
        return _tabs_response(self.browser_store.list_tabs())

    def _forget_back_history_if_off(self) -> None:
        try:
            if self._history_retention() == "off":
                self.browser_store.clear_back_history()
        except Exception as exc:
            decky.logger.warning("browser: clearing back history failed (%s)", type(exc).__name__)

    async def get_browser_bookmarks(self):
        return _bookmarks_response(self.browser_store.list_bookmarks())

    async def add_browser_bookmark(self, url: str = "", title: str = ""):
        state = self.browser_store.add_bookmark(url, title)
        if state is None:
            return _bookmarks_response(self.browser_store.list_bookmarks(), "bookmarkLimit")
        return _bookmarks_response(state)

    async def remove_browser_bookmark(self, bookmark_id: str = ""):
        return _bookmarks_response(self.browser_store.remove_bookmark(bookmark_id))

    async def rename_browser_bookmark(self, bookmark_id: str = "", title: str = ""):
        return _bookmarks_response(self.browser_store.rename_bookmark(bookmark_id, title))

    async def add_browser_bookmark_category(self, name: str = ""):
        state = self.browser_store.add_bookmark_category(name)
        if state is None:
            return _bookmarks_response(self.browser_store.list_bookmarks(), "categoryLimit")
        return _bookmarks_response(state)

    async def rename_browser_bookmark_category(self, category_id: str = "", name: str = ""):
        return _bookmarks_response(self.browser_store.rename_bookmark_category(category_id, name))

    async def remove_browser_bookmark_category(self, category_id: str = ""):
        return _bookmarks_response(self.browser_store.remove_bookmark_category(category_id))

    async def set_default_browser_bookmark_category(self, category_id: str = ""):
        return _bookmarks_response(self.browser_store.set_default_bookmark_category(category_id))

    async def set_browser_category_collapsed(self, category_id: str = "", collapsed: bool = False):
        return _bookmarks_response(self.browser_store.set_bookmark_category_collapsed(category_id, collapsed))

    async def get_browser_ad_exemptions(self):
        return _ad_exemptions_response(self.browser_store.list_ad_exemptions())

    async def add_browser_ad_exemption(self, host: str = ""):
        if not clean_site(host):
            return _ad_exemptions_response(self.browser_store.list_ad_exemptions(), "badSite")
        state = self.browser_store.add_ad_exemption(host)
        if state is None:
            return _ad_exemptions_response(self.browser_store.list_ad_exemptions(), "exemptionLimit")
        return _ad_exemptions_response(state)

    async def remove_browser_ad_exemption(self, host: str = ""):
        return _ad_exemptions_response(self.browser_store.remove_ad_exemption(host))
