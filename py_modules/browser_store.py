import secrets
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from utils import ensure_dir, load_json_file, save_json_file, to_int


CURRENT_SCHEMA_VERSION = 1

TABS_FILENAME = "tabs.json"

HISTORY_FILENAME = "history.json"

BOOKMARKS_FILENAME = "bookmarks.json"

SETTINGS_FILENAME = "settings.json"

MAX_TABS = 100

MAX_TAB_HISTORY = 100

MAX_HISTORY_ENTRIES = 2000

MAX_BOOKMARKS = 2000

MAX_BOOKMARK_CATEGORIES = 50

MAX_CATEGORY_NAME_LENGTH = 48

DEFAULT_CATEGORY_ID = "cat_default"

DEFAULT_CATEGORY_NAME = "Default"

BOOKMARKS_SCHEMA_VERSION = 2

MAX_URL_LENGTH = 2048
MAX_FOLDER_LENGTH = 4096

MAX_TITLE_LENGTH = 256

MAX_ANCHOR_LENGTH = 2048

MAX_ID_LENGTH = 64

ALLOWED_PAGE_ZOOM = (75, 90, 100, 110, 125, 150, 175, 200)

ALLOWED_HISTORY_RETENTION = ("off", "7", "30", "forever")

ALLOWED_PANEL_TABS = ("bookmarks", "history", "options")

DEFAULT_PAGE_ZOOM = 100

DEFAULT_HISTORY_RETENTION = "forever"

DEFAULT_PANEL_TAB = "bookmarks"

ALLOWED_SEARCH_ENGINES = ("google", "brave", "duckduckgo", "youtube", "retroachievements", "custom")

ALLOWED_NEW_TAB_PAGES = ("google", "brave", "duckduckgo", "retroachievements", "custom")

DEFAULT_SEARCH_ENGINE = "google"

DEFAULT_NEW_TAB_PAGE = "google"

DEFAULT_CUSTOM_SEARCH_URL = "https://gamefaqs.gamespot.com/search?game=%s"

_CONTROL_CHARS = frozenset(chr(code) for code in range(0x20)) | frozenset("\x7f")


def _clean_text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    stripped = "".join(ch for ch in value if ch not in _CONTROL_CHARS)
    return stripped.strip()[:limit]


def _clean_url(value: Any) -> str:
    text = _clean_text(value, MAX_URL_LENGTH + 1)
    return "" if len(text) > MAX_URL_LENGTH else text


def _clean_folder(value: Any) -> str:
    text = _clean_text(value, MAX_FOLDER_LENGTH + 1)
    if not text.startswith("/") or len(text) > MAX_FOLDER_LENGTH:
        return ""
    return text


def _clean_web_url(value: Any) -> str:
    text = _clean_url(value)
    if not text.lower().startswith(("http://", "https://")):
        return ""
    return text


def _clean_search_url(value: Any) -> str:
    text = _clean_web_url(value)
    return text if "%s" in text else ""


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(8)}"


class BrowserStore:
    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def repoint(self, base_dir: Path) -> None:
        with self._lock:
            self._base_dir = base_dir
            ensure_dir(self._base_dir)

    def _tabs_path(self) -> Path:
        return self._base_dir / TABS_FILENAME

    def _history_path(self) -> Path:
        return self._base_dir / HISTORY_FILENAME

    def _bookmarks_path(self) -> Path:
        return self._base_dir / BOOKMARKS_FILENAME

    def _settings_path(self) -> Path:
        return self._base_dir / SETTINGS_FILENAME

    def _empty_tabs(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "tabs": [],
            "activeTabId": "",
            "panelTab": DEFAULT_PANEL_TAB,
        }

    def _empty_history(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "entries": [],
        }

    def _default_category(self) -> dict:
        return {
            "id": DEFAULT_CATEGORY_ID,
            "name": DEFAULT_CATEGORY_NAME,
            "createdAt": 0,
        }

    def _empty_bookmarks(self) -> dict:
        return {
            "schemaVersion": BOOKMARKS_SCHEMA_VERSION,
            "categories": [self._default_category()],
            "defaultCategoryId": DEFAULT_CATEGORY_ID,
            "collapsedCategoryIds": [],
            "bookmarks": [],
        }

    def _clean_tab(self, raw: Any) -> dict:
        if not isinstance(raw, dict):
            return {}

        history = []
        positions = []
        anchors = []
        rows = raw.get("history")
        marks = raw.get("historyScroll")
        if not isinstance(marks, list):
            marks = []
        pins = raw.get("historyAnchor")
        if not isinstance(pins, list):
            pins = []
        wanted = to_int(raw.get("historyIndex", -1), -1)
        index = -1
        if isinstance(rows, list):
            for slot, row in enumerate(rows[:MAX_TAB_HISTORY]):
                url = _clean_text(row, MAX_URL_LENGTH)
                if not url:
                    continue
                if not history or history[-1] != url:
                    history.append(url)
                    mark = marks[slot] if slot < len(marks) else 0
                    positions.append(max(to_int(mark, 0), 0))
                    anchors.append(_clean_text(pins[slot], MAX_ANCHOR_LENGTH) if slot < len(pins) else "")
                if slot == wanted:
                    index = len(history) - 1

        if index < 0 or index >= len(history):
            index = len(history) - 1

        url = history[index] if index >= 0 else _clean_text(raw.get("url"), MAX_URL_LENGTH)
        scroll = max(to_int(raw.get("scroll", 0), 0), 0)
        anchor = _clean_text(raw.get("anchor"), MAX_ANCHOR_LENGTH)
        if index >= 0:
            positions[index] = scroll
            anchors[index] = anchor

        return {
            "id": _clean_text(raw.get("id"), MAX_ID_LENGTH) or _new_id("tab"),
            "url": url,
            "title": _clean_text(raw.get("title"), MAX_TITLE_LENGTH),
            "history": history,
            "historyScroll": positions,
            "historyAnchor": anchors,
            "historyIndex": index,
            "scroll": scroll,
            "anchor": anchor,
            "usedAt": to_int(raw.get("usedAt", 0), 0),
        }

    def _load_tabs(self) -> dict:
        raw = load_json_file(self._tabs_path(), {})
        if not isinstance(raw, dict):
            return self._empty_tabs()
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return self._empty_tabs()
        rows = raw.get("tabs")
        if not isinstance(rows, list):
            return self._empty_tabs()

        tabs = []
        for row in rows[:MAX_TABS]:
            tab = self._clean_tab(row)
            if tab:
                tabs.append(tab)

        active = _clean_text(raw.get("activeTabId"), MAX_ID_LENGTH)
        if not any(tab["id"] == active for tab in tabs):
            active = tabs[0]["id"] if tabs else ""

        panel = _clean_text(raw.get("panelTab"), MAX_ID_LENGTH)

        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "tabs": tabs,
            "activeTabId": active,
            "panelTab": panel if panel in ALLOWED_PANEL_TABS else DEFAULT_PANEL_TAB,
        }

    def _save_tabs(self, data: dict) -> dict:
        save_json_file(self._tabs_path(), data, compact=True)
        return data

    def _find_tab(self, data: dict, tab_id: Any) -> Optional[dict]:
        wanted = _clean_text(tab_id, MAX_ID_LENGTH)
        if not wanted:
            return None
        for tab in data["tabs"]:
            if tab["id"] == wanted:
                return tab
        return None

    def list_tabs(self) -> dict:
        with self._lock:
            return self._load_tabs()

    def add_tab(self, url: Any = "", title: Any = "", *, evict_oldest: bool = False) -> Optional[dict]:
        with self._lock:
            data = self._load_tabs()

            if len(data["tabs"]) >= MAX_TABS:
                if not evict_oldest:
                    return None
                oldest = min(data["tabs"], key=lambda tab: tab["usedAt"])
                data["tabs"] = [tab for tab in data["tabs"] if tab["id"] != oldest["id"]]

            clean_url = _clean_text(url, MAX_URL_LENGTH)
            tab = {
                "id": _new_id("tab"),
                "url": clean_url,
                "title": _clean_text(title, MAX_TITLE_LENGTH),
                "history": [clean_url] if clean_url else [],
                "historyScroll": [0] if clean_url else [],
                "historyAnchor": [""] if clean_url else [],
                "historyIndex": 0 if clean_url else -1,
                "scroll": 0,
                "anchor": "",
                "usedAt": int(time.time()),
            }
            data["tabs"].append(tab)
            data["activeTabId"] = tab["id"]

            return self._save_tabs(data)

    def close_tab(self, tab_id: Any) -> dict:
        wanted = _clean_text(tab_id, MAX_ID_LENGTH)
        with self._lock:
            data = self._load_tabs()
            position = -1
            for offset, tab in enumerate(data["tabs"]):
                if tab["id"] == wanted:
                    position = offset
                    break
            if position < 0:
                return data

            del data["tabs"][position]
            if data["activeTabId"] == wanted:
                if data["tabs"]:
                    data["activeTabId"] = data["tabs"][min(position, len(data["tabs"]) - 1)]["id"]
                else:
                    data["activeTabId"] = ""

            return self._save_tabs(data)

    def close_all_tabs(self) -> dict:
        with self._lock:
            data = self._load_tabs()
            data["tabs"] = []
            data["activeTabId"] = ""
            return self._save_tabs(data)

    def set_panel_tab(self, panel_tab: Any) -> dict:
        wanted = _clean_text(panel_tab, MAX_ID_LENGTH)
        with self._lock:
            data = self._load_tabs()
            if wanted not in ALLOWED_PANEL_TABS:
                return data
            data["panelTab"] = wanted
            return self._save_tabs(data)

    def set_active_tab(self, tab_id: Any) -> dict:
        with self._lock:
            data = self._load_tabs()
            tab = self._find_tab(data, tab_id)
            if tab is None:
                return data
            tab["usedAt"] = int(time.time())
            data["activeTabId"] = tab["id"]
            return self._save_tabs(data)

    def set_tab_scroll(self, tab_id: Any, scroll: Any, anchor: Any = "", url: Any = "") -> dict:
        wanted = _clean_text(url, MAX_URL_LENGTH)
        with self._lock:
            data = self._load_tabs()
            tab = self._find_tab(data, tab_id)
            if tab is None:
                return data

            index = tab["historyIndex"]
            if wanted:
                while index >= 0 and tab["history"][index] != wanted:
                    index -= 1
                if index < 0:
                    return data

            offset = max(to_int(scroll, 0), 0)
            pin = _clean_text(anchor, MAX_ANCHOR_LENGTH)
            if index >= 0:
                tab["historyScroll"][index] = offset
                tab["historyAnchor"][index] = pin
            if index == tab["historyIndex"]:
                tab["scroll"] = offset
                tab["anchor"] = pin
            return self._save_tabs(data)

    def set_tab_title(self, tab_id: Any, title: Any) -> dict:
        with self._lock:
            data = self._load_tabs()
            tab = self._find_tab(data, tab_id)
            if tab is None:
                return data
            tab["title"] = _clean_text(title, MAX_TITLE_LENGTH)
            return self._save_tabs(data)

    def navigate_tab(self, tab_id: Any, url: Any, title: Any = "") -> dict:
        clean_url = _clean_text(url, MAX_URL_LENGTH)
        with self._lock:
            data = self._load_tabs()
            tab = self._find_tab(data, tab_id)
            if tab is None or not clean_url:
                return data

            if tab["historyIndex"] >= 0 and tab["history"][tab["historyIndex"]] == clean_url:
                tab["title"] = _clean_text(title, MAX_TITLE_LENGTH) or tab["title"]
                tab["usedAt"] = int(time.time())
                return self._save_tabs(data)

            del tab["history"][tab["historyIndex"] + 1:]
            del tab["historyScroll"][tab["historyIndex"] + 1:]
            del tab["historyAnchor"][tab["historyIndex"] + 1:]
            tab["history"].append(clean_url)
            tab["historyScroll"].append(0)
            tab["historyAnchor"].append("")
            del tab["history"][:-MAX_TAB_HISTORY]
            del tab["historyScroll"][:-MAX_TAB_HISTORY]
            del tab["historyAnchor"][:-MAX_TAB_HISTORY]

            tab["historyIndex"] = len(tab["history"]) - 1
            tab["url"] = clean_url
            tab["title"] = _clean_text(title, MAX_TITLE_LENGTH)
            tab["scroll"] = 0
            tab["anchor"] = ""
            tab["usedAt"] = int(time.time())

            return self._save_tabs(data)

    def set_tab_history_index(self, tab_id: Any, index: Any) -> dict:
        wanted = to_int(index, -1)
        with self._lock:
            data = self._load_tabs()
            tab = self._find_tab(data, tab_id)
            if tab is None or wanted < 0 or wanted >= len(tab["history"]):
                return data

            tab["historyIndex"] = wanted
            tab["url"] = tab["history"][wanted]
            tab["scroll"] = tab["historyScroll"][wanted]
            tab["anchor"] = tab["historyAnchor"][wanted]
            tab["usedAt"] = int(time.time())

            return self._save_tabs(data)

    def _clean_history_entry(self, raw: Any) -> dict:
        if not isinstance(raw, dict):
            return {}
        url = _clean_url(raw.get("url"))
        if not url:
            return {}
        return {
            "id": _clean_text(raw.get("id"), MAX_ID_LENGTH) or _new_id("hist"),
            "url": url,
            "title": _clean_text(raw.get("title"), MAX_TITLE_LENGTH),
            "visitedAt": to_int(raw.get("visitedAt", 0), 0),
        }

    def _load_history(self) -> dict:
        raw = load_json_file(self._history_path(), {})
        if not isinstance(raw, dict):
            return self._empty_history()
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return self._empty_history()
        rows = raw.get("entries")
        if not isinstance(rows, list):
            return self._empty_history()

        entries = []
        for row in rows[:MAX_HISTORY_ENTRIES]:
            entry = self._clean_history_entry(row)
            if entry:
                entries.append(entry)

        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "entries": entries,
        }

    def _save_history(self, data: dict) -> dict:
        save_json_file(self._history_path(), data, compact=True)
        return data

    def list_history(self) -> dict:
        with self._lock:
            return self._load_history()

    def replace_tab_entry(self, tab_id: Any, old_url: Any, new_url: Any) -> dict:
        old = _clean_text(old_url, MAX_URL_LENGTH)
        new = _clean_text(new_url, MAX_URL_LENGTH)
        with self._lock:
            data = self._load_tabs()
            tab = self._find_tab(data, tab_id)
            if tab is None or not old or not new or old == new:
                return data

            index = tab["historyIndex"]
            if index < 0:
                return data
            if tab["history"][index] == old:
                tab["history"][index] = new
                tab["url"] = new
            elif tab["history"][index] == new and index > 0 and tab["history"][index - 1] == old:
                del tab["history"][index - 1]
                del tab["historyScroll"][index - 1]
                del tab["historyAnchor"][index - 1]
                tab["historyIndex"] = index - 1
            else:
                return data

            return self._save_tabs(data)

    def replace_history_entry(self, old_url: Any, new_url: Any) -> dict:
        old = _clean_url(old_url)
        new = _clean_url(new_url)
        with self._lock:
            data = self._load_history()
            entries = data["entries"]
            if not old or not new or old == new or not entries:
                return data
            if entries[0]["url"] == old:
                entries[0]["url"] = new
            elif entries[0]["url"] == new and len(entries) > 1 and entries[1]["url"] == old:
                entries[0]["title"] = entries[0]["title"] or entries[1]["title"]
                del entries[1]
            else:
                return data
            return self._save_history(data)

    def add_history_entry(self, url: Any, title: Any = "") -> dict:
        entry = self._clean_history_entry({
            "id": _new_id("hist"),
            "url": url,
            "title": title,
            "visitedAt": int(time.time()),
        })
        if not entry:
            return self.list_history()

        with self._lock:
            data = self._load_history()
            if data["entries"] and data["entries"][0]["url"] == entry["url"]:
                data["entries"][0]["title"] = entry["title"] or data["entries"][0]["title"]
                data["entries"][0]["visitedAt"] = entry["visitedAt"]
            else:
                data["entries"].insert(0, entry)
                del data["entries"][MAX_HISTORY_ENTRIES:]

            return self._save_history(data)

    def remove_history_entry(self, entry_id: Any) -> dict:
        wanted = _clean_text(entry_id, MAX_ID_LENGTH)
        with self._lock:
            data = self._load_history()
            kept = [entry for entry in data["entries"] if entry["id"] != wanted]
            if len(kept) == len(data["entries"]):
                return data
            data["entries"] = kept
            return self._save_history(data)

    def clear_history(self) -> dict:
        with self._lock:
            return self._save_history(self._empty_history())

    def clear_recent_history(self, days: Any) -> dict:
        wanted = to_int(days, 0)
        with self._lock:
            data = self._load_history()
            if wanted <= 0:
                return data
            cutoff = int(time.time()) - wanted * 86400
            kept = [entry for entry in data["entries"] if entry["visitedAt"] < cutoff]
            if len(kept) == len(data["entries"]):
                return data
            data["entries"] = kept
            return self._save_history(data)

    def prune_history(self, max_age_days: Any) -> dict:
        days = to_int(max_age_days, 0)
        with self._lock:
            data = self._load_history()
            if days <= 0:
                return data
            cutoff = int(time.time()) - days * 86400
            kept = [entry for entry in data["entries"] if entry["visitedAt"] >= cutoff]
            if len(kept) == len(data["entries"]):
                return data
            data["entries"] = kept
            return self._save_history(data)

    def _clean_bookmark(self, raw: Any) -> dict:
        if not isinstance(raw, dict):
            return {}
        url = _clean_url(raw.get("url"))
        if not url:
            return {}
        return {
            "id": _clean_text(raw.get("id"), MAX_ID_LENGTH) or _new_id("mark"),
            "url": url,
            "title": _clean_text(raw.get("title"), MAX_TITLE_LENGTH),
            "createdAt": to_int(raw.get("createdAt", 0), 0),
            "categoryId": _clean_text(raw.get("categoryId"), MAX_ID_LENGTH),
        }

    def _clean_category(self, raw: Any) -> dict:
        if not isinstance(raw, dict):
            return {}
        name = _clean_text(raw.get("name"), MAX_CATEGORY_NAME_LENGTH)
        if not name:
            return {}
        return {
            "id": _clean_text(raw.get("id"), MAX_ID_LENGTH) or _new_id("cat"),
            "name": name,
            "createdAt": to_int(raw.get("createdAt", 0), 0),
        }

    def _load_bookmarks(self) -> dict:
        raw = load_json_file(self._bookmarks_path(), {})
        if not isinstance(raw, dict):
            return self._empty_bookmarks()
        if to_int(raw.get("schemaVersion", 0), 0) > BOOKMARKS_SCHEMA_VERSION:
            return self._empty_bookmarks()

        categories = [self._default_category()]
        known = {DEFAULT_CATEGORY_ID}
        rows = raw.get("categories")
        if isinstance(rows, list):
            for row in rows:
                category = self._clean_category(row)
                if not category or category["id"] in known:
                    continue
                known.add(category["id"])
                categories.append(category)
                if len(categories) >= MAX_BOOKMARK_CATEGORIES:
                    break

        default_id = _clean_text(raw.get("defaultCategoryId"), MAX_ID_LENGTH)
        if default_id not in known:
            default_id = DEFAULT_CATEGORY_ID

        collapsed = []
        rows = raw.get("collapsedCategoryIds")
        if isinstance(rows, list):
            for row in rows:
                wanted = _clean_text(row, MAX_ID_LENGTH)
                if wanted in known and wanted not in collapsed:
                    collapsed.append(wanted)

        bookmarks = []
        rows = raw.get("bookmarks")
        if isinstance(rows, list):
            for row in rows[:MAX_BOOKMARKS]:
                bookmark = self._clean_bookmark(row)
                if not bookmark:
                    continue
                if bookmark["categoryId"] not in known:
                    bookmark["categoryId"] = default_id
                bookmarks.append(bookmark)

        return {
            "schemaVersion": BOOKMARKS_SCHEMA_VERSION,
            "categories": categories,
            "defaultCategoryId": default_id,
            "collapsedCategoryIds": collapsed,
            "bookmarks": bookmarks,
        }

    def _save_bookmarks(self, data: dict) -> dict:
        known = {row["id"] for row in data["categories"]}
        if data["defaultCategoryId"] not in known:
            data["defaultCategoryId"] = DEFAULT_CATEGORY_ID
        data["collapsedCategoryIds"] = [row for row in data["collapsedCategoryIds"] if row in known]
        for row in data["bookmarks"]:
            if row["categoryId"] not in known:
                row["categoryId"] = data["defaultCategoryId"]

        save_json_file(self._bookmarks_path(), data, compact=True)
        return data

    def list_bookmarks(self) -> dict:
        with self._lock:
            return self._load_bookmarks()

    def add_bookmark(self, url: Any, title: Any = "") -> Optional[dict]:
        bookmark = self._clean_bookmark({
            "id": _new_id("mark"),
            "url": url,
            "title": title,
            "createdAt": int(time.time()),
        })
        if not bookmark:
            return self.list_bookmarks()

        with self._lock:
            data = self._load_bookmarks()
            if any(row["url"] == bookmark["url"] for row in data["bookmarks"]):
                return data
            if len(data["bookmarks"]) >= MAX_BOOKMARKS:
                return None

            bookmark["categoryId"] = data["defaultCategoryId"]
            data["bookmarks"].insert(0, bookmark)
            return self._save_bookmarks(data)

    def remove_bookmark(self, bookmark_id: Any) -> dict:
        wanted = _clean_text(bookmark_id, MAX_ID_LENGTH)
        with self._lock:
            data = self._load_bookmarks()
            kept = [row for row in data["bookmarks"] if row["id"] != wanted]
            if len(kept) == len(data["bookmarks"]):
                return data
            data["bookmarks"] = kept
            return self._save_bookmarks(data)

    def rename_bookmark(self, bookmark_id: Any, title: Any) -> dict:
        wanted = _clean_text(bookmark_id, MAX_ID_LENGTH)
        renamed = _clean_text(title, MAX_TITLE_LENGTH)
        if not renamed:
            return self.list_bookmarks()

        with self._lock:
            data = self._load_bookmarks()
            for row in data["bookmarks"]:
                if row["id"] != wanted:
                    continue
                if row["title"] == renamed:
                    return data
                row["title"] = renamed
                return self._save_bookmarks(data)
            return data

    def add_bookmark_category(self, name: Any) -> Optional[dict]:
        category = self._clean_category({
            "id": _new_id("cat"),
            "name": name,
            "createdAt": int(time.time()),
        })
        if not category:
            return self.list_bookmarks()

        with self._lock:
            data = self._load_bookmarks()
            taken = category["name"].casefold()
            if any(row["name"].casefold() == taken for row in data["categories"]):
                return data
            if len(data["categories"]) >= MAX_BOOKMARK_CATEGORIES:
                return None

            data["categories"].append(category)
            return self._save_bookmarks(data)

    def rename_bookmark_category(self, category_id: Any, name: Any) -> dict:
        wanted = _clean_text(category_id, MAX_ID_LENGTH)
        renamed = _clean_text(name, MAX_CATEGORY_NAME_LENGTH)
        if not renamed or wanted == DEFAULT_CATEGORY_ID:
            return self.list_bookmarks()

        with self._lock:
            data = self._load_bookmarks()
            for row in data["categories"]:
                if row["id"] == wanted:
                    row["name"] = renamed
                    return self._save_bookmarks(data)
            return data

    def remove_bookmark_category(self, category_id: Any) -> dict:
        wanted = _clean_text(category_id, MAX_ID_LENGTH)
        if wanted == DEFAULT_CATEGORY_ID:
            return self.list_bookmarks()

        with self._lock:
            data = self._load_bookmarks()
            kept = [row for row in data["categories"] if row["id"] != wanted]
            if len(kept) == len(data["categories"]):
                return data

            data["categories"] = kept
            data["bookmarks"] = [row for row in data["bookmarks"] if row["categoryId"] != wanted]
            if data["defaultCategoryId"] == wanted:
                data["defaultCategoryId"] = DEFAULT_CATEGORY_ID
            return self._save_bookmarks(data)

    def set_bookmark_category_collapsed(self, category_id: Any, collapsed: Any) -> dict:
        wanted = _clean_text(category_id, MAX_ID_LENGTH)
        with self._lock:
            data = self._load_bookmarks()
            if not any(row["id"] == wanted for row in data["categories"]):
                return data
            shut = wanted in data["collapsedCategoryIds"]
            if bool(collapsed) == shut:
                return data
            if collapsed:
                data["collapsedCategoryIds"].append(wanted)
            else:
                data["collapsedCategoryIds"].remove(wanted)
            return self._save_bookmarks(data)

    def set_default_bookmark_category(self, category_id: Any) -> dict:
        wanted = _clean_text(category_id, MAX_ID_LENGTH)
        with self._lock:
            data = self._load_bookmarks()
            if not any(row["id"] == wanted for row in data["categories"]):
                return data
            data["defaultCategoryId"] = wanted
            return self._save_bookmarks(data)

    def _empty_settings(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "pageZoom": DEFAULT_PAGE_ZOOM,
            "historyRetention": DEFAULT_HISTORY_RETENTION,
            "searchEngine": DEFAULT_SEARCH_ENGINE,
            "newTabPage": DEFAULT_NEW_TAB_PAGE,
            "customNewTabUrl": "",
            "customSearchUrl": DEFAULT_CUSTOM_SEARCH_URL,
            "openLinksInNewTab": True,
            "blockAds": True,
            "fastForwardYouTubeAds": True,
            "downloadFolder": "",
            "rememberDownloadFolder": False,
            "lastDownloadFolder": "",
            "expanded": False,
        }

    def _load_settings(self) -> dict:
        raw = load_json_file(self._settings_path(), {})
        if not isinstance(raw, dict):
            return self._empty_settings()

        zoom = to_int(raw.get("pageZoom", DEFAULT_PAGE_ZOOM), DEFAULT_PAGE_ZOOM)
        retention = _clean_text(raw.get("historyRetention"), MAX_ID_LENGTH)
        engine = _clean_text(raw.get("searchEngine"), MAX_ID_LENGTH)
        new_tab = _clean_text(raw.get("newTabPage"), MAX_ID_LENGTH)
        open_links = raw.get("openLinksInNewTab", True)
        block_ads = raw.get("blockAds", True)
        fast_forward = raw.get("fastForwardYouTubeAds", True)
        remember_folder = raw.get("rememberDownloadFolder", False)
        expanded = raw.get("expanded", False)

        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "pageZoom": zoom if zoom in ALLOWED_PAGE_ZOOM else DEFAULT_PAGE_ZOOM,
            "historyRetention": retention if retention in ALLOWED_HISTORY_RETENTION else DEFAULT_HISTORY_RETENTION,
            "searchEngine": engine if engine in ALLOWED_SEARCH_ENGINES else DEFAULT_SEARCH_ENGINE,
            "newTabPage": new_tab if new_tab in ALLOWED_NEW_TAB_PAGES else DEFAULT_NEW_TAB_PAGE,
            "customNewTabUrl": _clean_web_url(raw.get("customNewTabUrl")),
            "customSearchUrl": _clean_search_url(raw.get("customSearchUrl")) or DEFAULT_CUSTOM_SEARCH_URL,
            "openLinksInNewTab": open_links if isinstance(open_links, bool) else True,
            "blockAds": block_ads if isinstance(block_ads, bool) else True,
            "fastForwardYouTubeAds": fast_forward if isinstance(fast_forward, bool) else True,
            "downloadFolder": _clean_folder(raw.get("downloadFolder")),
            "rememberDownloadFolder": remember_folder if isinstance(remember_folder, bool) else False,
            "lastDownloadFolder": _clean_folder(raw.get("lastDownloadFolder")),
            "expanded": expanded if isinstance(expanded, bool) else False,
        }

    def _save_settings(self, data: dict) -> dict:
        save_json_file(self._settings_path(), data, compact=True)
        return data

    def list_settings(self) -> dict:
        with self._lock:
            return self._load_settings()

    def set_page_zoom(self, value: Any) -> dict:
        with self._lock:
            data = self._load_settings()
            zoom = to_int(value, DEFAULT_PAGE_ZOOM)
            if zoom not in ALLOWED_PAGE_ZOOM:
                return data
            data["pageZoom"] = zoom
            return self._save_settings(data)

    def set_history_retention(self, value: Any) -> dict:
        with self._lock:
            data = self._load_settings()
            wanted = _clean_text(value, MAX_ID_LENGTH)
            if wanted not in ALLOWED_HISTORY_RETENTION:
                return data
            data["historyRetention"] = wanted
            return self._save_settings(data)

    def set_search_engine(self, value: Any) -> dict:
        with self._lock:
            data = self._load_settings()
            wanted = _clean_text(value, MAX_ID_LENGTH)
            if wanted not in ALLOWED_SEARCH_ENGINES:
                return data
            data["searchEngine"] = wanted
            return self._save_settings(data)

    def set_new_tab_page(self, value: Any) -> dict:
        with self._lock:
            data = self._load_settings()
            wanted = _clean_text(value, MAX_ID_LENGTH)
            if wanted not in ALLOWED_NEW_TAB_PAGES:
                return data
            data["newTabPage"] = wanted
            return self._save_settings(data)

    def set_custom_new_tab_url(self, value: Any) -> dict:
        return self._set_custom_url("customNewTabUrl", value, _clean_web_url)

    def set_custom_search_url(self, value: Any) -> dict:
        return self._set_custom_url("customSearchUrl", value, _clean_search_url)

    def _set_custom_url(self, key: str, value: Any, clean: Callable[[Any], str]) -> dict:
        wanted = _clean_text(value, MAX_URL_LENGTH + 1)
        cleaned = clean(wanted)
        with self._lock:
            data = self._load_settings()
            if wanted and not cleaned:
                return data
            data[key] = cleaned
            return self._save_settings(data)

    def set_open_links_in_new_tab(self, value: Any) -> dict:
        with self._lock:
            data = self._load_settings()
            data["openLinksInNewTab"] = bool(value)
            return self._save_settings(data)

    def set_block_ads(self, value: Any) -> dict:
        with self._lock:
            data = self._load_settings()
            data["blockAds"] = bool(value)
            return self._save_settings(data)

    def set_fast_forward_youtube_ads(self, value: Any) -> dict:
        with self._lock:
            data = self._load_settings()
            data["fastForwardYouTubeAds"] = bool(value)
            return self._save_settings(data)

    def set_download_folder(self, value: Any) -> dict:
        wanted = _clean_folder(value)
        with self._lock:
            data = self._load_settings()
            if not wanted:
                return data
            data["downloadFolder"] = wanted
            return self._save_settings(data)

    def set_remember_download_folder(self, value: Any) -> dict:
        with self._lock:
            data = self._load_settings()
            data["rememberDownloadFolder"] = bool(value)
            if not data["rememberDownloadFolder"]:
                data["lastDownloadFolder"] = ""
            return self._save_settings(data)

    def set_last_download_folder(self, value: Any) -> dict:
        wanted = _clean_folder(value)
        with self._lock:
            data = self._load_settings()
            if not wanted or not data["rememberDownloadFolder"]:
                return data
            data["lastDownloadFolder"] = wanted
            return self._save_settings(data)

    def set_expanded(self, value: Any) -> dict:
        with self._lock:
            data = self._load_settings()
            data["expanded"] = bool(value)
            return self._save_settings(data)
