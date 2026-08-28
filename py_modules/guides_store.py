from pathlib import Path

import decky
import os
import re
import secrets
import threading
import time

from utils import (
    chown_to_data_owner,
    ensure_dir,
    load_json_file,
    norm_game_id,
    save_json_file,
    to_int,
)


BOOKMARK_NAME_MAX_LEN = 40

GUIDE_TITLE_MAX_LEN = 160
GUIDE_AUTHOR_MAX_LEN = 120
GUIDE_TYPE_MAX_LEN = 80

CURRENT_SCHEMA_VERSION = 1

REVALIDATE_COOLDOWN_SECONDS = 6 * 60 * 60

GUIDE_SECTION_SLUG_MAX = 200

REVALIDATE_STAMP_MAX = 32

_ALLOWED_KINDS = {"formatted", "plaintext"}

CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

CACHE_SWEEP_AGE_SECONDS = 60 * 24 * 60 * 60

STALE_NUDGE_SECONDS = CACHE_MAX_AGE_SECONDS + 24 * 60 * 60

_PAGE_TOKEN_PATTERN = re.compile(r"[^A-Za-z0-9_-]")

_GAME_URL_PATTERN = re.compile(r"^/[a-z0-9_-]+/\d+-", re.IGNORECASE)


class GuidesStore:
    """Per-account GameFAQs guide data: the resolved game mapping, bookmarks,
    reading positions, plus a regenerable page/list cache.

    Storage layout (under ``<guides_dir>``, which is ``<ulid>/guides``)::

        <gameId>_guides.json            # per-game mapping + per-guide user data
        cache/
            <gameId>_<faqId>_<page>.html   # cached page HTML (regenerable)
            <gameId>_faqlist.json          # cached guide-list metadata

    Threading mirrors NotesStore exactly: one master lock guards the per-game
    lock dict (held only long enough to look up or create an entry), and each
    game's file is touched under that game's own lock. The state file and the
    cache get their own locks so they don't contend on a game's lock.

    Everything writes through ``save_json_file`` / ``ensure_dir`` (or the
    text saver below), so the chown-back to the data owner rides every write
    for free -- the backend runs as root and would otherwise self-lock-out.
    """

    def __init__(self, *, guides_dir: Path):
        self._guides_dir = guides_dir

        self._master_lock = threading.Lock()
        self._game_locks: dict[str, threading.Lock] = {}
        self._cache_lock = threading.Lock()

        self._cache_generation = 0

    def repoint(self, guides_dir: Path) -> None:
        with self._cache_lock:
            self._cache_generation += 1
        with self._master_lock:
            self._guides_dir = guides_dir

    def _game_key(self, game_id) -> str | None:
        normalized = norm_game_id(game_id)
        if normalized is None:
            return None
        key = str(normalized)
        if not key.isdigit():
            return None
        return key

    def _path_for_game_key(self, key: str) -> Path:
        if not key or not key.isdigit():
            raise ValueError(f"invalid guides game key: {key!r}")
        return self._guides_dir / f"{key}_guides.json"

    def _cache_dir(self) -> Path:
        return self._guides_dir / "cache"

    def _lock_for_game(self, key: str) -> threading.Lock:
        with self._master_lock:
            lock = self._game_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._game_locks[key] = lock
            return lock

    def _save_text_atomic(self, path: Path, text: str, *, create_dir: bool = True) -> None:
        if create_dir:
            ensure_dir(path.parent)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        chown_to_data_owner(tmp)
        tmp.replace(path)

    def _empty_game_record(self, game_id: int) -> dict:
        return {
            "gameId": game_id,
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "gamefaqs": None,
            "guides": {},
            "typeFilter": "all",
        }

    def _load_raw(self, key: str) -> dict:
        path = self._path_for_game_key(key)
        raw = load_json_file(path, {})
        if not isinstance(raw, dict):
            return self._empty_game_record(int(key))
        schema = to_int(raw.get("schemaVersion", 0), 0)
        if schema != CURRENT_SCHEMA_VERSION:
            return self._empty_game_record(int(key))
        return self._normalize_record(raw, int(key))

    def _save_raw(self, key: str, record: dict) -> None:
        path = self._path_for_game_key(key)
        ensure_dir(self._guides_dir)
        save_json_file(path, record, compact=True)

    def _clean_mapping(self, raw):
        if not isinstance(raw, dict):
            return None
        game_url = str(raw.get("gameUrl") or "").strip()
        if not game_url or not _GAME_URL_PATTERN.match(game_url):
            return None
        return {
            "platformSlug": str(raw.get("platformSlug") or "").strip(),
            "gameUrl": game_url,
            "productName": str(raw.get("productName") or "").strip(),
        }

    def _clean_str(self, raw, cap: int) -> str:
        if not isinstance(raw, str):
            return ""
        return raw.strip()[:cap]

    def _clean_bookmark(self, raw):
        if not isinstance(raw, dict):
            return None
        bid = raw.get("id")
        if not isinstance(bid, str) or not bid:
            return None
        name = self._clean_str(raw.get("name"), BOOKMARK_NAME_MAX_LEN)
        if not name:
            return None
        return {
            "id": bid,
            "name": name,
            "page": to_int(raw.get("page"), 0),
            "anchor": str(raw.get("anchor") or ""),
            "scroll": self._clean_scroll(raw.get("scroll")),
            "createdAt": to_int(raw.get("createdAt"), 0),
        }

    def _clean_scroll(self, raw) -> float:
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return 0.0
        if value < 0.0:
            return 0.0
        if value > 1.0:
            return 1.0
        return value

    def _normalize_guide(self, raw):
        if not isinstance(raw, dict):
            return None
        kind = raw.get("kind")
        if kind not in _ALLOWED_KINDS:
            kind = "plaintext"
        bookmarks = []
        for raw_bm in raw.get("bookmarks", []) or []:
            cleaned = self._clean_bookmark(raw_bm)
            if cleaned is not None:
                bookmarks.append(cleaned)
        bookmarks.sort(key=lambda b: (b["page"], b["scroll"]))
        return {
            "title": self._clean_str(raw.get("title"), GUIDE_TITLE_MAX_LEN),
            "author": self._clean_str(raw.get("author"), GUIDE_AUTHOR_MAX_LEN),
            "type": self._clean_str(raw.get("type"), GUIDE_TYPE_MAX_LEN),
            "version": self._clean_str(raw.get("version"), GUIDE_TYPE_MAX_LEN),
            "gameUrl": str(raw.get("gameUrl") or ""),
            "lastOpenedAt": to_int(raw.get("lastOpenedAt"), 0),
            "lastPage": to_int(raw.get("lastPage"), 0),
            "lastAnchor": str(raw.get("lastAnchor") or ""),
            "lastScroll": self._clean_scroll(raw.get("lastScroll")),
            "pageCount": to_int(raw.get("pageCount"), 0),
            "kind": kind,
            "updatedAt": to_int(raw.get("updatedAt"), 0),
            "bookmarks": bookmarks,
            "revalidateFailedAt": self._clean_revalidate_stamps(raw.get("revalidateFailedAt")),
            "sectionSlugs": self._clean_section_slugs(raw.get("sectionSlugs")),
        }

    def _clean_section_slugs(self, raw) -> list:
        if not isinstance(raw, list):
            return []
        slugs = []
        for value in raw:
            if isinstance(value, str) and value:
                slugs.append(value[:200])
            if len(slugs) >= GUIDE_SECTION_SLUG_MAX:
                break
        return slugs

    def _clean_revalidate_stamps(self, raw) -> dict:
        if not isinstance(raw, dict):
            return {}
        stamps = {}
        for token, value in raw.items():
            if not isinstance(token, str) or not token:
                continue
            seconds = to_int(value, 0)
            if seconds > 0:
                stamps[self._page_token(token)] = seconds
            if len(stamps) >= REVALIDATE_STAMP_MAX:
                break
        return stamps

    def _empty_guide(self) -> dict:
        return {
            "title": "",
            "author": "",
            "type": "",
            "version": "",
            "gameUrl": "",
            "lastOpenedAt": 0,
            "lastPage": 0,
            "lastAnchor": "",
            "lastScroll": 0.0,
            "pageCount": 0,
            "kind": "plaintext",
            "updatedAt": 0,
            "bookmarks": [],
            "revalidateFailedAt": {},
            "sectionSlugs": [],
        }

    def _normalize_record(self, raw: dict, game_id: int) -> dict:
        guides = {}
        raw_guides = raw.get("guides")
        if isinstance(raw_guides, dict):
            for faq_id, raw_guide in raw_guides.items():
                if not isinstance(faq_id, str) or not faq_id.isdigit():
                    continue
                cleaned = self._normalize_guide(raw_guide)
                if cleaned is not None:
                    guides[faq_id] = cleaned
        return {
            "gameId": game_id,
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "gamefaqs": self._clean_mapping(raw.get("gamefaqs")),
            "guides": guides,
            "typeFilter": self._clean_type_filter(raw.get("typeFilter")),
        }

    def _clean_type_filter(self, raw) -> str:
        return self._clean_str(raw, GUIDE_TYPE_MAX_LEN) or "all"

    def _clean_faq_id(self, faq_id) -> str | None:
        text = str(faq_id or "").strip()
        if not text or not text.isdigit():
            return None
        return text

    def _new_bookmark_id(self) -> str:
        return f"bm_{secrets.token_urlsafe(8)}"

    def get_game_guides(self, game_id) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return self._empty_game_record(0)
        lock = self._lock_for_game(key)
        with lock:
            return self._load_raw(key)

    def save_mapping(self, game_id, platform_slug: str, game_url: str, product_name: str) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        mapping = self._clean_mapping({
            "platformSlug": platform_slug,
            "gameUrl": game_url,
            "productName": product_name,
        })
        if mapping is None:
            return {"ok": False, "error": "invalid_mapping"}
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            record["gamefaqs"] = mapping
            self._save_raw(key, record)
        return {"ok": True, "gamefaqs": mapping}

    def save_type_filter(self, game_id, value) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        cleaned = self._clean_type_filter(value)
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            record["typeFilter"] = cleaned
            self._save_raw(key, record)
        return {"ok": True, "typeFilter": cleaned}

    def clear_mapping(self, game_id) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            record["gamefaqs"] = None
            self._save_raw(key, record)
        return {"ok": True}

    def _guide_entry(self, record: dict, faq_id: str) -> dict:
        guide = record["guides"].get(faq_id)
        if guide is None:
            guide = self._empty_guide()
            record["guides"][faq_id] = guide
        mapping = record.get("gamefaqs")
        if isinstance(mapping, dict) and mapping.get("gameUrl"):
            guide["gameUrl"] = mapping["gameUrl"]
        return guide

    def upsert_guide_meta(
        self,
        game_id,
        faq_id,
        *,
        title: str = "",
        author: str = "",
        type: str = "",
        version: str = "",
        kind: str = "",
    ) -> dict:
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "error": "invalid_id"}
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            guide = self._guide_entry(record, faq)
            if title:
                guide["title"] = self._clean_str(title, GUIDE_TITLE_MAX_LEN)
            if author:
                guide["author"] = self._clean_str(author, GUIDE_AUTHOR_MAX_LEN)
            if type:
                guide["type"] = self._clean_str(type, GUIDE_TYPE_MAX_LEN)
            if version:
                guide["version"] = self._clean_str(version, GUIDE_TYPE_MAX_LEN)
            guide["lastOpenedAt"] = int(time.time())
            if kind in _ALLOWED_KINDS:
                guide["kind"] = kind
            guide["updatedAt"] = int(time.time())
            self._save_raw(key, record)
            return {"ok": True, "guide": dict(guide)}

    def save_position(
        self,
        game_id,
        faq_id,
        *,
        last_page=0,
        last_anchor: str = "",
        last_scroll=0.0,
        page_count=0,
        kind: str = "",
    ) -> dict:
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "error": "invalid_id"}
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            guide = self._guide_entry(record, faq)
            guide["lastPage"] = to_int(last_page, 0)
            guide["lastAnchor"] = str(last_anchor or "")
            guide["lastScroll"] = self._clean_scroll(last_scroll)
            if to_int(page_count, 0) > 0:
                guide["pageCount"] = to_int(page_count, 0)
            if kind in _ALLOWED_KINDS:
                guide["kind"] = kind
            guide["updatedAt"] = int(time.time())
            self._save_raw(key, record)
        return {"ok": True}

    def add_bookmark(
        self,
        game_id,
        faq_id,
        name: str,
        *,
        page=0,
        anchor: str = "",
        scroll=0.0,
    ) -> dict:
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "error": "invalid_id"}
        clean_name = self._clean_str(name, BOOKMARK_NAME_MAX_LEN)
        if not clean_name:
            return {"ok": False, "error": "empty_name"}
        bookmark = {
            "id": self._new_bookmark_id(),
            "name": clean_name,
            "page": to_int(page, 0),
            "anchor": str(anchor or ""),
            "scroll": self._clean_scroll(scroll),
            "createdAt": int(time.time()),
        }
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            guide = self._guide_entry(record, faq)
            guide["bookmarks"].append(bookmark)
            guide["bookmarks"].sort(key=lambda b: (b["page"], b["scroll"]))
            self._save_raw(key, record)
        return {"ok": True, "bookmark": bookmark}

    def remove_bookmark(self, game_id, faq_id, bookmark_id: str) -> dict:
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "error": "invalid_id"}
        if not isinstance(bookmark_id, str) or not bookmark_id:
            return {"ok": False, "error": "invalid_bookmark_id"}
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            guide = record["guides"].get(faq)
            if guide is None:
                return {"ok": False, "error": "not_found"}
            before = len(guide["bookmarks"])
            guide["bookmarks"] = [b for b in guide["bookmarks"] if b["id"] != bookmark_id]
            if len(guide["bookmarks"]) == before:
                return {"ok": False, "error": "not_found"}
            self._save_raw(key, record)
        return {"ok": True, "deletedId": bookmark_id}

    def rename_bookmark(self, game_id, faq_id, bookmark_id: str, name: str) -> dict:
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "error": "invalid_id"}
        clean_name = self._clean_str(name, BOOKMARK_NAME_MAX_LEN)
        if not clean_name:
            return {"ok": False, "error": "empty_name"}
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            guide = record["guides"].get(faq)
            if guide is None:
                return {"ok": False, "error": "not_found"}
            target = None
            for bm in guide["bookmarks"]:
                if bm["id"] == bookmark_id:
                    target = bm
                    break
            if target is None:
                return {"ok": False, "error": "not_found"}
            target["name"] = clean_name
            self._save_raw(key, record)
        return {"ok": True, "bookmark": dict(target)}

    def _page_token(self, page) -> str:
        text = str(page if page is not None else "0").strip() or "0"
        return _PAGE_TOKEN_PATTERN.sub("_", text)[:80]

    def _cache_page_path(self, game_key: str, faq: str, page) -> Path:
        return self._cache_dir() / f"{game_key}_{faq}_{self._page_token(page)}.html"

    def cached_guide_pages(self, game_id, faq_id, slugs) -> dict:
        """Which of the guide's pages are on disk. Ask with real section slugs,
        get real section slugs back.

        This used to take nothing and answer with the page TOKENS off the
        filenames. Tokens read like slugs and aren't: _page_token sanitises one
        way, so Update Guide handed "_page_1_Materials_Checklist" to GameFAQs
        as a section, GameFAQs served the base page, and that got written over
        every section the user had read.

        Update Guide re-fetches exactly what comes back and no more: a page
        never opened has nothing cached to compare against, so pulling it now
        would be a download the user didn't ask for. A classic guide has the
        one page ("0"); a formatted one has that plus a file per section read.
        """
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None or not isinstance(slugs, list):
            return {"ok": False, "pages": []}
        held = []
        with self._cache_lock:
            for slug in slugs:
                if isinstance(slug, str) and self._cache_page_path(key, faq, slug).exists():
                    held.append(slug)
        return {"ok": True, "pages": held}

    def offline_guides(self, game_id) -> dict:
        """Guides this device is holding on its own: a record entry with page
        HTML still in the cache, stamped to the game we're currently mapped to.

        This is what lets a guide GameFAQs has since deleted keep a row in the
        list. The record already carries the title, author and type we copied
        off the row when it was opened, so a card can be drawn from it without
        the live list knowing the guide exists. Anything without cached HTML is
        left out -- a row that opens onto an error is worse than no row.
        """
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "guides": []}

        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
        mapping = record.get("gamefaqs") or {}
        game_url = mapping.get("gameUrl") or ""

        with self._cache_lock:
            held = set()
            prefix = f"{key}_"
            for path in self._cache_dir().glob(f"{key}_*.html"):
                rest = path.stem[len(prefix):]
                faq = rest.split("_", 1)[0]
                if faq.isdigit():
                    held.add(faq)

        guides = []
        for faq_id, guide in record["guides"].items():
            if faq_id not in held:
                continue
            stamped = guide.get("gameUrl") or ""
            if stamped and stamped != game_url:
                continue
            guides.append({
                "faqId": faq_id,
                "title": guide.get("title") or "",
                "author": guide.get("author") or "",
                "type": guide.get("type") or "",
            })
        return {"ok": True, "guides": guides}

    def _is_cache_fresh(self, path, keep_offline=False) -> bool:
        if keep_offline:
            return True
        try:
            return (time.time() - path.stat().st_mtime) < CACHE_MAX_AGE_SECONDS
        except OSError:
            return False

    def get_cached_guide_page(self, game_id, faq_id, page="0", allow_stale=False, keep_offline=False) -> dict:
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "cached": False}
        path = self._cache_page_path(key, faq, page)
        with self._cache_lock:
            fresh = self._is_cache_fresh(path, keep_offline)
            if not fresh and not allow_stale:
                return {"ok": True, "cached": False}
            try:
                html = path.read_text(encoding="utf-8")
            except (FileNotFoundError, OSError, UnicodeDecodeError):
                return {"ok": True, "cached": False}
        return {"ok": True, "cached": True, "stale": not fresh, "html": html}

    def save_cached_guide_page(self, game_id, faq_id, html: str, page="0", section_slugs=None) -> dict:
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "error": "invalid_id"}
        if not isinstance(html, str):
            return {"ok": False, "error": "invalid_html"}

        path = self._cache_page_path(key, faq, page)
        with self._cache_lock:
            try:
                self._save_text_atomic(path, html)
            except OSError:
                return {"ok": True, "cached": False}

        shape_moved = self._shape_moved(key, faq, section_slugs)
        if shape_moved:
            with self._cache_lock:
                self._nudge_siblings_stale(key, faq, self._page_token(page))
        return {"ok": True, "cached": True, "shapeMoved": shape_moved}

    def begin_revalidate(self, game_id, faq_id, page="0") -> dict:
        """May this page be revalidated in the background, and under which
        cache generation.

        The generation comes back so the write at the far end can be refused if
        the cache turned into a different cache while the fetch was out.
        """
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "allowed": False, "generation": 0, "why": "invalid-id"}
        token = self._page_token(page)

        with self._cache_lock:
            if self._is_cache_fresh(self._cache_page_path(key, faq, page)):
                return {"ok": True, "allowed": False, "generation": 0, "why": "already-fresh"}
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
        guide = record["guides"].get(faq)
        failed_at = 0
        if guide is not None:
            failed_at = to_int(guide["revalidateFailedAt"].get(token), 0)
        if failed_at > 0:
            since = time.time() - failed_at
            if 0 <= since < REVALIDATE_COOLDOWN_SECONDS:
                return {"ok": True, "allowed": False, "generation": 0, "why": "cooling-off"}
        with self._cache_lock:
            generation = self._cache_generation
        return {"ok": True, "allowed": True, "generation": generation}

    def finish_revalidate(self, game_id, faq_id, html, page="0", generation=-1, section_slugs=None) -> dict:
        """Land a background revalidate: write the page, or stamp the failure.

        An empty html is the fetch saying it came back with nothing. Anything
        else is written whether or not it differs from what was on disk —
        matching byte for byte is the common case and still worth the write,
        because it resets the file's thirty-day clock.
        """
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "error": "invalid_id"}
        token = self._page_token(page)

        if not isinstance(html, str) or not html:
            lock = self._lock_for_game(key)
            with lock:
                if not self._path_for_game_key(key).exists():
                    return {"ok": True, "written": False}
                record = self._load_raw(key)
                guide = self._guide_entry(record, faq)
                stamps = guide["revalidateFailedAt"]
                if token not in stamps and len(stamps) >= REVALIDATE_STAMP_MAX:
                    stamps.pop(min(stamps, key=stamps.get), None)
                stamps[token] = int(time.time())
                self._save_raw(key, record)
            return {"ok": True, "written": False}

        with self._cache_lock:
            if to_int(generation, -1) != self._cache_generation:
                decky.logger.info("guides: dropped a revalidate for %s that the cache moved out from under", faq)
                return {"ok": True, "written": False, "superseded": True}
            if not self._cache_dir().is_dir():
                return {"ok": True, "written": False}
            path = self._cache_page_path(key, faq, page)
            token = self._page_token(page)
            try:
                self._save_text_atomic(path, html, create_dir=False)
            except OSError:
                return {"ok": True, "written": False}

        changed = self._shape_moved(key, faq, section_slugs)
        if changed:
            with self._cache_lock:
                if to_int(generation, -1) == self._cache_generation:
                    self._nudge_siblings_stale(key, faq, token)

        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            guide = record["guides"].get(faq)
            if guide is not None and guide["revalidateFailedAt"].pop(token, None) is not None:
                self._save_raw(key, record)
        return {"ok": True, "written": True, "changed": changed}

    def prune_guide_to(self, game_id, faq_id, pages) -> dict:
        """Drop cached files for this guide that are not in `pages`.

        The healing half of Update Guide, and the order it runs in is the whole
        of its safety. Update Guide fetches everything first and only calls this
        once every page has landed, so a guide is never left with less than it
        started with. Clearing first and fetching after would look tidier and
        would turn a Cloudflare wall into a guide the user no longer has —
        which, with Offline Guides on, is the one thing they were promised
        wouldn't happen.

        What this actually reclaims is sections GameFAQs no longer lists.
        Update Guide re-fetches what it holds, so a section deleted upstream is
        never refreshed and never removed: it sits there forever, unreachable
        because it is not in the contents any more, quietly wrong if anything
        ever does reach it.
        """
        key = self._game_key(game_id)
        faq = self._clean_faq_id(faq_id)
        if key is None or faq is None:
            return {"ok": False, "removed": 0}
        if not isinstance(pages, list):
            return {"ok": False, "removed": 0}
        keep = {self._page_token(p) for p in pages if isinstance(p, str) and p}
        if not keep:
            return {"ok": True, "removed": 0}
        removed = []
        prefix = f"{key}_{faq}_"
        with self._cache_lock:
            for path in self._cache_dir().glob(f"{prefix}*.html"):
                if path.stem[len(prefix):] in keep:
                    continue
                try:
                    path.unlink()
                    removed.append(path.name)
                except (FileNotFoundError, OSError):
                    pass
        if removed:
            decky.logger.info(
                "guides: dropped %d cached page(s) of %s that the guide no longer lists",
                len(removed),
                faq,
            )
        return {"ok": True, "removed": len(removed)}

    def _shape_moved(self, key: str, faq: str, section_slugs) -> bool:
        """Did the guide's contents list change since we last saw it?

        This is the whole of the "has this guide been edited" test, and it is
        deliberately the ONLY one. Comparing the page's bytes against the copy
        being replaced was the obvious alternative and it was worse twice over:
        it cost a read of the old file — 1.2MB for the biggest guide measured,
        off an SD card — and what it answered was the wrong question. One
        section's text changing is poor evidence that the OTHER sections
        changed, so an author fixing a typo would have sent every other section
        off to re-fetch itself for nothing.

        A contents list that moved means sections were added, removed, renamed
        or reordered, which is exactly when the sections already on disk start
        describing a document that no longer exists. That is the case worth
        acting on, and the list is a handful of short strings on a record we
        are already opening.
        """
        incoming = self._clean_section_slugs(section_slugs)
        if not incoming:
            return False
        lock = self._lock_for_game(key)
        with lock:
            record = self._load_raw(key)
            guide = self._guide_entry(record, faq)
            stored = guide["sectionSlugs"]
            moved = bool(stored) and stored != incoming
            if stored != incoming:
                guide["sectionSlugs"] = incoming
                self._save_raw(key, record)
        return moved

    def _nudge_siblings_stale(self, key: str, faq: str, keep_token: str) -> int:
        """The guide moved, so put its OTHER cached sections back on the stale
        side of the line.

        A formatted guide is a file per section and only the section being read
        is ever re-checked, so a guide that gets edited ends up part new and
        part old — sections you read tracking upstream while the ones you don't
        sit at whatever version they were saved at. Nothing noticed, because
        there is no version to compare and the sections are cached
        independently.

        Backdating rather than deleting is the whole point. A deleted section
        costs a blocking scrape and a Cloudflare wall the next time it is
        opened; a stale one is served off disk immediately and re-checks itself
        once the reader closes, which is the behaviour this cache already has.
        The user waits for nothing either way, and the guide converges.

        Caller holds the cache lock. Plaintext guides have no siblings, so this
        finds nothing and costs a glob.
        """
        when = time.time() - STALE_NUDGE_SECONDS
        nudged = 0
        prefix = f"{key}_{faq}_"
        for path in self._cache_dir().glob(f"{prefix}*.html"):
            if path.stem[len(prefix):] == keep_token:
                continue
            try:
                os.utime(path, (when, when))
                nudged += 1
            except OSError:
                pass
        if nudged > 0:
            decky.logger.info(
                "guides: %s changed, so %d other cached section(s) will re-check themselves",
                faq,
                nudged,
            )
        return nudged

    def get_cached_faqlist(self, game_id, allow_stale=False, keep_offline=False) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "cached": False}
        path = self._cache_dir() / f"{key}_faqlist.json"
        with self._cache_lock:
            if not self._is_cache_fresh(path, keep_offline) and not allow_stale:
                return {"ok": True, "cached": False}
            raw = load_json_file(path, None)
        if not isinstance(raw, list):
            return {"ok": True, "cached": False}
        return {"ok": True, "cached": True, "entries": raw}

    def save_cached_faqlist(self, game_id, entries) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(entries, list):
            return {"ok": False, "error": "invalid_entries"}
        path = self._cache_dir() / f"{key}_faqlist.json"
        with self._cache_lock:
            try:
                save_json_file(path, entries, compact=True)
            except OSError as exc:
                decky.logger.warning(
                    "guides store: faqlist cache write failed for %s: %s (%s)",
                    key,
                    exc,
                    type(exc).__name__,
                )
                return {"ok": True, "cached": False}
        return {"ok": True, "cached": True}

    def clear_cache(self) -> dict:
        removed = []
        with self._cache_lock:
            self._cache_generation += 1
            cache_dir = self._cache_dir()
            if cache_dir.exists():
                for path in cache_dir.glob("*"):
                    try:
                        path.unlink()
                        removed.append(path.name)
                    except (FileNotFoundError, IsADirectoryError, OSError):
                        pass
        decky.logger.info(
            "guides: cleared %d cached file(s) from %s",
            len(removed),
            self._cache_dir(),
        )
        return {"ok": True, "removedFiles": len(removed), "removed": removed}

    def clear_all_guide_data(self) -> dict:
        removed = 0
        with self._master_lock:
            for path in self._guides_dir.glob("*_guides.json"):
                try:
                    path.unlink()
                    removed += 1
                except (FileNotFoundError, OSError):
                    pass
            self._game_locks.clear()
        self.clear_cache()
        return {"ok": True, "removedGames": removed}

    def touch_cache(self) -> dict:
        """Stamp every cached file to now.

        For the moment Truly Offline Guides is switched back OFF. Nothing
        rewrites an mtime while the freeze is on — no expiry, no re-scrape, no
        revalidate — so the whole cache ages in place, and six months of that
        means the next startup sweep is entitled to delete every guide the user
        has in one pass. Restarting the clock here gives them a clean thirty
        days of normal policy, during which whatever they actually read gets
        refreshed and only what they don't gets reclaimed.

        The alternative — exempting the sweep for a while after the untoggle —
        would be state about a transition rather than about the files, and it
        would have to be persisted and reasoned about forever after.
        """
        touched = 0
        now = time.time()
        with self._cache_lock:
            for path in self._cache_dir().glob("*"):
                try:
                    if not path.is_file():
                        continue
                    os.utime(path, (now, now))
                    touched += 1
                except OSError:
                    pass
        decky.logger.info("guides: restarted the cache clock on %d file(s)", touched)
        return {"ok": True, "touched": touched}
