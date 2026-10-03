from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse

import asyncio
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

from browser_store import MAX_AD_EXEMPTIONS, MAX_BOOKMARK_CATEGORIES, MAX_BOOKMARKS, MAX_TABS, clean_site
from utils import atomic_file, child_owner, open_dir, ssl_context, to_int
from mixins._context import PluginContext


BROWSER_DOWNLOAD_EVENT = "cheevodeck_browser_download"

BROWSER_DOWNLOAD_PROGRESS_EVENT = "cheevodeck_browser_download_progress"

BROWSER_DOWNLOAD_MAX_BYTES = 4 * 1024 * 1024 * 1024
BROWSER_DOWNLOAD_MAX_ACTIVE = 2
BROWSER_DOWNLOAD_TIMEOUT_SECONDS = 30

BROWSER_DOWNLOAD_READ = 64 * 1024

BROWSER_DOWNLOAD_STALL_SECONDS = 60
BROWSER_DOWNLOAD_STALL_BYTES = 32 * 1024

BROWSER_DOWNLOAD_PROGRESS_SECONDS = 1.0

BROWSER_DOWNLOAD_HEADERS_SECONDS = 60

BROWSER_DOWNLOAD_MTIME_SLACK = 2.0

BROWSER_DOWNLOAD_MAX_NAME_BYTES = 240

BROWSER_DATA_URL_MAX = 64 * 1024 * 1024

BROWSER_DOWNLOAD_MEDIA_ROOTS = (Path("/run/media"), Path("/media"))

_WEB_PAGE_TYPES = ("text/html", "application/xhtml+xml")
_WEB_PAGE_SUFFIXES = (".html", ".htm", ".xhtml", ".shtml", ".mht", ".mhtml")

_ROOT = Path("/")

_RUN_ID = uuid.uuid4().hex

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_FAT_CHARS = re.compile(r'[:?*"<>|]')
_DISPOSITION_STAR = re.compile(r"filename\*\s*=\s*([^';]*)'[^']*'([^;]+)", re.IGNORECASE)
_DISPOSITION_PLAIN = re.compile(r'filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))', re.IGNORECASE)

_active_downloads: dict = {}
_active_lock = threading.Lock()


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
        if entry["canceled"] or entry.get("stalled"):
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


class _DownloadError(Exception):
    def __init__(self, code: str, detail: str = "", why: str = ""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail or code
        self.why = why or (detail if detail.startswith("HTTP ") else "")


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


def _public_download(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "state": row["state"],
        "error": row["error"],
        "received": row["received"],
        "total": row["total"],
        "startedAt": row["startedAt"],
        "canDelete": row["state"] == "done" and row["file"] is not None and not row["fileGone"],
        "fileGone": row["fileGone"],
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


def _remove_stale_part(home: Path, row: dict) -> None:
    name = row.get("name") or ""
    if not name or "/" in name or row.get("part") is None:
        return
    dir_fd = _open_download_dir(home, row)
    if dir_fd is None:
        return
    try:
        if _matches(dir_fd, name + ".part", row["part"]) == "match":
            os.unlink(name + ".part", dir_fd=dir_fd)
    except OSError as exc:
        decky.logger.warning("browser download: leftover .part not removed (%s)", _why(exc))
    finally:
        os.close(dir_fd)


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
        "activeTabs": state["activeTabs"],
        "pauseMediaOnTabSwitch": state["pauseMediaOnTabSwitch"],
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

    async def save_browser_active_tabs(self, value: int = 3):
        return _settings_response(self.user_home, self.browser_store.set_active_tabs(value))

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

        download_id = uuid.uuid4().hex
        with _active_lock:
            if len(_active_downloads) >= BROWSER_DOWNLOAD_MAX_ACTIVE:
                decky.logger.warning("browser download refused, %d already running", len(_active_downloads))
                return {"ok": False, "error": "busy"}
            _active_downloads[download_id] = {"path": None, "canceled": False, "received": 0, "total": -1}

        headers = {}
        if not is_data:
            if cookie:
                headers["Cookie"] = str(cookie)
            if user_agent:
                headers["User-Agent"] = str(user_agent)
            if referer and urlparse(str(referer)).scheme in ("http", "https"):
                headers["Referer"] = str(referer)

        self.browser_store.set_last_download_folder(str(folder).strip())

        record = self.browser_store.downloads_path()
        name = _scrub_name(chosen_name) or _scrub_name(suggested_name) or "download"
        try:
            self.browser_store.add_download(record, {
                "id": download_id,
                "name": name,
                "folder": str(destination),
                "state": "downloading",
                "startedAt": int(time.time()),
                "run": _RUN_ID,
            })
        except Exception as exc:
            decky.logger.warning("browser download: couldn't record the download (%s)", type(exc).__name__)

        worker = threading.Thread(
            target=self._run_browser_download,
            args=(download_id, target, destination, str(suggested_name or ""), str(chosen_name or ""), headers, record),
            name=f"browser-download-{download_id[:8]}",
            daemon=True,
        )
        worker.start()
        return {"ok": True, "id": download_id}

    def _record_download(self, record: Path, download_id: str, **fields) -> None:
        try:
            self.browser_store.update_download(record, download_id, **fields)
        except Exception as exc:
            decky.logger.warning("browser download: couldn't update the list (%s)", type(exc).__name__)

    def _run_browser_download(self, download_id, url, folder, suggested, chosen, headers, record):
        host = urlparse(url).hostname or ""
        name = _scrub_name(chosen) or _scrub_name(suggested) or "download"
        result = {"id": download_id, "ok": False, "name": name, "folder": str(folder), "error": ""}
        fields = {}
        try:
            path, written, identity = self._fetch_browser_download(download_id, url, folder, suggested, chosen, headers, host, record)
            result["ok"] = True
            result["name"] = path.name
            fields = {"state": "done", "name": path.name, "received": written, "file": identity}
        except _DownloadError as exc:
            result["error"] = exc.code
            claimed = _active_downloads.get(download_id, {}).get("path")
            if claimed is not None:
                result["name"] = claimed.name
            state = "canceled" if exc.code == "canceled" else "failed"
            fields = {"state": state, "error": exc.code, "name": result["name"]}
            if state == "canceled":
                decky.logger.info("browser download canceled")
            else:
                decky.logger.error("browser download failed: %s%s", exc.code, f" ({exc.why})" if exc.why else "")
            if getattr(self, "_debug_logging", False):
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
        self._emit_browser_download(result)

    def _fetch_browser_download(self, download_id, url, folder, suggested, chosen, headers, host, record):
        is_data = url.startswith("data:")
        entry = _active_downloads[download_id]
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

        deadline = threading.Timer(BROWSER_DOWNLOAD_HEADERS_SECONDS, headers_overdue)
        deadline.daemon = True
        deadline.start()
        try:
            response = opener.open(request, timeout=BROWSER_DOWNLOAD_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as exc:
            raise _DownloadError("refused" if 400 <= exc.code < 500 else "failed", f"HTTP {exc.code}") from exc
        except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as exc:
            if entry["canceled"]:
                raise _DownloadError("canceled") from exc
            if entry.get("stalled"):
                raise _DownloadError("stalled", "no headers in time") from exc
            raise _DownloadError("bad_link" if is_data else "failed", f"{type(exc).__name__}: {exc}", _why(exc)) from exc
        finally:
            with _active_lock:
                entry["answered"] = True
            deadline.cancel()

        try:
            with response:
                return self._save_response(response, entry, download_id, folder, suggested, chosen, host, record, is_data)
        finally:
            with _active_lock:
                _release(entry)

    def _save_response(self, response, entry, download_id, folder, suggested, chosen, host, record, is_data):
        with _active_lock:
            canceled = entry["canceled"]
            stalled = entry.get("stalled", False)
        if canceled:
            raise _DownloadError("canceled")
        if stalled:
            raise _DownloadError("stalled", "no headers in time")

        final = response.geturl()
        if not is_data and urlparse(final).scheme not in ("http", "https"):
            raise _DownloadError("bad_link", "redirected off http(s)")
        status = getattr(response, "status", None)
        if not is_data and status is not None and (status < 200 or status >= 300 or status in (204, 205, 206)):
            raise _DownloadError("failed", f"HTTP {status}")

        expected = _scrub_name(suggested) or _download_name("", "", final)
        content_type = response.headers.get_content_type()
        if not is_data and content_type in _WEB_PAGE_TYPES and not expected.lower().endswith(_WEB_PAGE_SUFFIXES):
            raise _DownloadError("web_page", f"{content_type} for {expected}")

        length = to_int(response.headers.get("Content-Length"), -1)
        if length > BROWSER_DOWNLOAD_MAX_BYTES:
            raise _DownloadError("too_big", f"{length} bytes")
        if length > 0:
            try:
                free = shutil.disk_usage(folder).free
            except OSError:
                free = None
            if free is not None and free < length:
                raise _DownloadError("no_space", f"{length} bytes, {free} free")

        name = _scrub_name(chosen) or _download_name(response.headers.get("Content-Disposition", ""), suggested, final)
        with _active_lock:
            path = _claim_destination(folder, name, download_id)
            entry["total"] = length
        decky.logger.info("browser download started (%s)", f"{length} bytes" if length >= 0 else "size unknown")
        if getattr(self, "_debug_logging", False):
            decky.logger.info("browser download from %s to %s", host, path)

        read = getattr(response, "read1", None) or response.read
        written = 0
        try:
            with atomic_file(path, trusted=_ROOT, suffix=".part") as out:
                part = os.fstat(out.fileno())
                self._record_download(record, download_id, name=path.name, total=length, part=[part.st_dev, part.st_ino])
                window_start = last_report = time.monotonic()
                window_bytes = 0
                while True:
                    try:
                        chunk = read(BROWSER_DOWNLOAD_READ)
                    except (OSError, ValueError) as exc:
                        if entry["canceled"]:
                            raise _DownloadError("canceled") from exc
                        raise _DownloadError("failed", f"{type(exc).__name__}: {exc}", _why(exc)) from exc
                    if entry["canceled"]:
                        raise _DownloadError("canceled")
                    if not chunk:
                        break
                    written += len(chunk)
                    window_bytes += len(chunk)
                    if written > BROWSER_DOWNLOAD_MAX_BYTES:
                        raise _DownloadError("too_big", f"over {BROWSER_DOWNLOAD_MAX_BYTES} bytes")
                    try:
                        out.write(chunk)
                    except OSError as exc:
                        raise _DownloadError("write_failed", f"{type(exc).__name__}: {exc}", _why(exc)) from exc
                    now = time.monotonic()
                    if now - window_start >= BROWSER_DOWNLOAD_STALL_SECONDS:
                        if window_bytes < BROWSER_DOWNLOAD_STALL_BYTES:
                            raise _DownloadError("stalled", f"{window_bytes} bytes in {int(now - window_start)}s")
                        window_start = now
                        window_bytes = 0
                    if now - last_report >= BROWSER_DOWNLOAD_PROGRESS_SECONDS:
                        last_report = now
                        entry["received"] = written
                        self._emit_browser_event(BROWSER_DOWNLOAD_PROGRESS_EVENT, {"id": download_id, "received": written, "total": length})
                entry["received"] = written
                if length >= 0 and written < length:
                    raise _DownloadError("failed", f"ended at {written} of {length} bytes")
                out.flush()
                done = os.fstat(out.fileno())
        except OSError as exc:
            raise _DownloadError("write_failed", f"{type(exc).__name__}: {exc}", _why(exc)) from exc

        decky.logger.info("browser download saved (%d bytes)", written)
        return path, written, [done.st_dev, done.st_ino, written, done.st_mtime_ns]

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
        with _active_lock:
            live = {key: dict(entry) for key, entry in _active_downloads.items()}
        for row in rows:
            entry = live.get(row["id"])
            if entry is not None and row["state"] == "downloading":
                row["received"] = entry.get("received", row["received"])
                row["total"] = entry.get("total", row["total"])
        return {"ok": True, "downloads": [_public_download(row) for row in rows]}

    async def get_browser_downloads(self):
        record = self.browser_store.downloads_path()
        self._sweep_interrupted_downloads(record)
        return self._downloads_response(record)

    async def cancel_browser_download(self, download_id: str = ""):
        wanted = str(download_id or "")
        with _active_lock:
            entry = _active_downloads.get(wanted)
            if entry is None:
                return {"ok": False}
            entry["canceled"] = True
            if entry.get("fd") is not None:
                _shut(entry["fd"])
        return {"ok": True}

    async def remove_browser_download(self, download_id: str = ""):
        record = self.browser_store.downloads_path()
        self.browser_store.remove_download(record, download_id)
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
        try:
            stale = self.browser_store.settle_interrupted(record or self.browser_store.downloads_path(), _RUN_ID)
        except Exception as exc:
            decky.logger.warning("browser download: interrupted sweep failed (%s)", type(exc).__name__)
            return
        if not stale:
            return
        decky.logger.info("browser download: %d left unfinished by an earlier run", len(stale))
        home = self.user_home
        threading.Thread(
            target=lambda: [_remove_stale_part(home, row) for row in stale],
            name="browser-download-sweep",
            daemon=True,
        ).start()

    async def get_browser_tabs(self):
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
            return _history_response(self.browser_store.clear_recent_history(days))
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
