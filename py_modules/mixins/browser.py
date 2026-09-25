from pathlib import Path
from urllib.parse import unquote, urlparse

import asyncio
import os
import re
import shutil
import threading
import urllib.error
import urllib.request
import uuid

import decky

from browser_store import MAX_BOOKMARK_CATEGORIES, MAX_BOOKMARKS, MAX_TABS
from utils import chown_to_data_owner, ssl_context, to_int
from mixins._context import PluginContext


BROWSER_DOWNLOAD_EVENT = "cheevodeck_browser_download"

BROWSER_DOWNLOAD_MAX_BYTES = 4 * 1024 * 1024 * 1024
BROWSER_DOWNLOAD_MAX_ACTIVE = 2
BROWSER_DOWNLOAD_CHUNK = 1024 * 1024
BROWSER_DOWNLOAD_TIMEOUT_SECONDS = 30
BROWSER_DOWNLOAD_MAX_NAME = 200

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_DISPOSITION_STAR = re.compile(r"filename\*\s*=\s*([^';]*)'[^']*'([^;]+)", re.IGNORECASE)
_DISPOSITION_PLAIN = re.compile(r'filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))', re.IGNORECASE)

_active_downloads: dict = {}
_active_lock = threading.Lock()


def _scrub_name(raw: str) -> str:
    base = re.split(r"[/\\]", str(raw or ""))[-1]
    cleaned = _CONTROL_CHARS.sub("", base).strip().lstrip(".").strip()
    if len(cleaned) > BROWSER_DOWNLOAD_MAX_NAME:
        stem, dot, ext = cleaned.rpartition(".")
        if dot and 0 < len(ext) <= 16:
            cleaned = stem[:BROWSER_DOWNLOAD_MAX_NAME - len(ext) - 1] + "." + ext
        else:
            cleaned = cleaned[:BROWSER_DOWNLOAD_MAX_NAME]
    return cleaned


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
    for candidate in (
        _name_from_disposition(disposition),
        suggested,
        unquote(urlparse(url).path).rsplit("/", 1)[-1],
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
    while candidate.exists() or candidate in claimed or Path(str(candidate) + ".part").exists():
        candidate = folder / f"{stem} ({index}){suffix}"
        index += 1
    _active_downloads[download_id]["path"] = candidate
    return candidate


class _DownloadError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail or code


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


def _default_download_folder(home: Path, stored: str) -> Path:
    if stored and Path(stored).is_dir():
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

    async def save_browser_page_zoom(self, value=100):
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

    async def save_links_open_in_web_browser(self, value: bool = True):
        return {
            "ok": True,
            "linksOpenInWebBrowser": self.settings_store.update_links_open_in_web_browser(value),
        }

    async def save_browser_download_folder(self, path: str = ""):
        if Path(str(path or "")).is_dir():
            self.browser_store.set_download_folder(path)
        return _settings_response(self.user_home, self.browser_store.list_settings())

    async def save_browser_remember_download_folder(self, value: bool = False):
        return _settings_response(self.user_home, self.browser_store.set_remember_download_folder(value))

    async def save_browser_expanded(self, value: bool = False):
        return _settings_response(self.user_home, self.browser_store.set_expanded(value))

    async def get_browser_download_folder(self):
        state = self.browser_store.list_settings()
        last = state["lastDownloadFolder"]
        if state["rememberDownloadFolder"] and last and Path(last).is_dir():
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
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return {"ok": False, "error": "bad_link"}
        destination = Path(str(folder or "").strip())
        if not str(folder or "").strip() or not destination.is_dir():
            return {"ok": False, "error": "bad_folder"}

        download_id = uuid.uuid4().hex
        with _active_lock:
            if len(_active_downloads) >= BROWSER_DOWNLOAD_MAX_ACTIVE:
                decky.logger.warning("browser download refused, %d already running", len(_active_downloads))
                return {"ok": False, "error": "busy"}
            _active_downloads[download_id] = {"path": None}

        headers = {}
        if cookie:
            headers["Cookie"] = str(cookie)
        if user_agent:
            headers["User-Agent"] = str(user_agent)
        if referer and urlparse(str(referer)).scheme in ("http", "https"):
            headers["Referer"] = str(referer)

        self.browser_store.set_last_download_folder(str(destination))

        worker = threading.Thread(
            target=self._run_browser_download,
            args=(download_id, target, destination, str(suggested_name or ""), str(chosen_name or ""), headers),
            name=f"browser-download-{download_id[:8]}",
            daemon=True,
        )
        worker.start()
        return {"ok": True, "id": download_id}

    def _run_browser_download(self, download_id, url, folder, suggested, chosen, headers):
        host = urlparse(url).hostname or ""
        name = _scrub_name(chosen) or _scrub_name(suggested) or "download"
        result = {"id": download_id, "ok": False, "name": name, "folder": str(folder), "error": ""}
        try:
            path = self._fetch_browser_download(download_id, url, folder, suggested, chosen, headers, host)
            result["ok"] = True
            result["name"] = path.name
        except _DownloadError as exc:
            result["error"] = exc.code
            claimed = _active_downloads.get(download_id, {}).get("path")
            if claimed is not None:
                result["name"] = claimed.name
            decky.logger.error("browser download from %s failed: %s (%s)", host, exc.code, exc.detail)
        except Exception as exc:
            result["error"] = "failed"
            decky.logger.error("browser download from %s failed (%s: %s)", host, type(exc).__name__, exc)
        finally:
            with _active_lock:
                _active_downloads.pop(download_id, None)
        self._emit_browser_download(result)

    def _fetch_browser_download(self, download_id, url, folder, suggested, chosen, headers, host) -> Path:
        request = urllib.request.Request(url, headers=headers)
        try:
            response = urllib.request.urlopen(
                request, context=ssl_context(), timeout=BROWSER_DOWNLOAD_TIMEOUT_SECONDS
            )
        except urllib.error.HTTPError as exc:
            raise _DownloadError("refused" if 400 <= exc.code < 500 else "failed", f"HTTP {exc.code}") from exc
        except (urllib.error.URLError, OSError) as exc:
            raise _DownloadError("failed", f"{type(exc).__name__}: {exc}") from exc

        with response:
            final = response.geturl()
            if urlparse(final).scheme not in ("http", "https"):
                raise _DownloadError("bad_link", "redirected off http(s)")

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
            part = Path(str(path) + ".part")
            decky.logger.info(
                "browser download from %s started: %s (%s)",
                host, path, f"{length} bytes" if length >= 0 else "size unknown",
            )

            written = 0
            try:
                with open(part, "wb") as out:
                    while True:
                        try:
                            chunk = response.read(BROWSER_DOWNLOAD_CHUNK)
                        except (OSError, ValueError) as exc:
                            raise _DownloadError("failed", f"{type(exc).__name__}: {exc}") from exc
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > BROWSER_DOWNLOAD_MAX_BYTES:
                            raise _DownloadError("too_big", f"over {BROWSER_DOWNLOAD_MAX_BYTES} bytes")
                        try:
                            out.write(chunk)
                        except OSError as exc:
                            raise _DownloadError("write_failed", f"{type(exc).__name__}: {exc}") from exc
                if length >= 0 and written < length:
                    raise _DownloadError("failed", f"ended at {written} of {length} bytes")
                os.replace(part, path)
            except _DownloadError:
                self._remove_part(part)
                raise
            except OSError as exc:
                self._remove_part(part)
                raise _DownloadError("write_failed", f"{type(exc).__name__}: {exc}") from exc

        chown_to_data_owner(path)
        decky.logger.info("browser download saved to %s (%d bytes)", path, written)
        return path

    def _remove_part(self, part: Path) -> None:
        try:
            part.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            decky.logger.warning("couldn't remove %s (%s)", part, exc)

    def _emit_browser_download(self, payload: dict) -> None:
        loop = getattr(self, "_asyncio_loop", None)
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(decky.emit(BROWSER_DOWNLOAD_EVENT, payload), loop)
        except Exception as exc:
            decky.logger.warning("browser download: event emit failed (%s: %s)", type(exc).__name__, exc)

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
        return _history_response(self.browser_store.clear_history())

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

