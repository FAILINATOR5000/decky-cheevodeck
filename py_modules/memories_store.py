from pathlib import Path

import re
import secrets
import shutil
import threading
import time

import decky

from settings_store import _NOTE_COLOR_OPTIONS
from utils import (
    TAG_MAX_LEN,
    ensure_dir,
    load_json_file,
    norm_game_id,
    save_json_file,
    to_int,
)


MEMORY_CAPTION_MAX_LEN = 300

MEMORY_TAG_MAX_LEN = TAG_MAX_LEN

TAG_VOCAB_LIMIT = 20

MISC_GAME_ID = -1

ALL_GAMES_ID = 0

ALL_GAMES_RECORD_CAP = 1500

MISC_FOLDER_NAME = "Misc"

CURRENT_SCHEMA_VERSION = 1

_ALLOWED_SOURCES = {"steam", "cheevodeck"}

_ALLOWED_CONTEXT_STATES = {"pending", "resolved"}

MAX_BOUND_ACHIEVEMENTS = 6

MAX_ACHIEVEMENT_DESCRIPTION_LEN = 200

_ALLOWED_ACHIEVEMENT_TYPES = {"", "missable", "progression", "win_condition"}

_ALLOWED_MEDIA_FILTERS = {"", "picture", "video"}

_ALLOWED_DATE_ORDERS = {"desc", "asc"}
_ALLOWED_TAG_SORTS = {"recent", "alpha"}

GRID_COLUMN_OPTIONS = (1, 2, 3)
DEFAULT_GRID_COLUMNS = 2

_GAME_KEY_PATTERN = re.compile(r"^-?\d+$")

_TAG_CLEAN_PATTERN = re.compile(r"[\[\]\n\r\t]")

_CLIP_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,120}$")

STASHED_SUFFIX = ".previous"

GAMES_INDEX_NAME = "_games.json"
VIEW_PREFS_NAME = "_index.json"


def _clean_relative_path(raw):
    """Return ``raw`` if it is a safe relative picture path, else ``None``.

    Records are written with a path relative to the pictures root so they
    survive a different home directory. An absolute path or one containing
    ".." came from somewhere other than this store and is dropped rather than
    resolved.
    """
    if not isinstance(raw, str):
        return None
    path = raw.strip()
    if not path or path.startswith("/"):
        return None
    parts = path.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return None
    return path


def _clean_video(raw):
    """The video source on a record, or ``None`` when there is not one.

    A source is owned when it carries a relative path under the video root and
    referenced when it carries a Steam clip id. Both keys are always present so
    a caller tests one for emptiness rather than testing the record for a
    missing key, and a source with neither reads back as no video at all.

    ``kind`` says how an owned copy is laid out on disk: ``mp4`` is one
    fragmented file with an index beside it, ``dash`` is Steam's own manifest
    and segments carried across. A record written before the remux existed says
    neither, and reads back as dash, which is what it is.
    """
    if not isinstance(raw, dict):
        return None

    clip_id = raw.get("clipId")
    if not isinstance(clip_id, str) or not _CLIP_ID_PATTERN.match(clip_id):
        clip_id = ""

    session_id = raw.get("sessionId")
    if not isinstance(session_id, str) or not _CLIP_ID_PATTERN.match(session_id):
        session_id = ""

    path = _clean_relative_path(raw.get("path")) or ""
    if not clip_id and not path:
        return None

    kind = raw.get("kind")
    if kind not in ("mp4", "dash"):
        kind = "dash"

    return {
        "clipId": clip_id,
        "sessionId": session_id,
        "path": path,
        "kind": kind,
        "startMs": max(to_int(raw.get("startMs"), 0), 0),
        "durationMs": max(to_int(raw.get("durationMs"), 0), 0),
        "sizeBytes": max(to_int(raw.get("sizeBytes"), 0), 0),
    }


class MemoriesStore:
    """Screenshots the user kept, one JSON file per game, per account.

    Storage layout: ``<memories_dir>/<gameid>.json`` holds every memory for one
    game, ``<memories_dir>/_games.json`` indexes the games that have any, and
    ``<memories_dir>/_index.json`` holds the page's view preferences. Thumbnails
    live in a sibling tree at ``<thumbs_dir>/<gameid>/`` so clearing them can
    never reach a metadata file. The pictures themselves live under
    ``<pictures_dir>`` in the user's own Pictures folder and are addressed by the
    relative path on each record.

    ``games_with_memories`` answers out of the index file rather than by listing
    the store, so a user with thousands of games pays one read. Nothing here ever
    enumerates the pictures or the thumbnails.

    Tags are per game. A game's vocabulary lives in its own file and the page
    builds its filter from the memories it has loaded, so a tag only ever appears
    next to memories that carry it.

    Threading: one lock per game file, a master lock guarding the lock dict, and
    a separate lock for the two index files, taken after a game lock and never
    before one. threading.Lock rather than asyncio.Lock because adoption and the
    resolve pass run on worker threads.
    """

    def __init__(self, *, memories_dir: Path, thumbs_dir: Path, pictures_dir: Path, videos_dir: Path):
        self._memories_dir = memories_dir
        self._thumbs_dir = thumbs_dir
        self._pictures_dir = pictures_dir
        self._videos_dir = videos_dir
        self._account_key = ""

        self._master_lock = threading.Lock()
        self._game_locks: dict[str, threading.Lock] = {}
        self._index_lock = threading.Lock()

    def repoint(self, memories_dir: Path, thumbs_dir: Path, account_key: str = "") -> None:
        """Point both trees and the picture folder at a different account.

        Takes them together so they cannot end up describing two different
        accounts, which is the failure _apply_user_scope warns about.
        ``account_key`` is the account's ULID and names its folder under the
        pictures root; empty means no account is set up yet, and the pictures
        then sit directly under the root, matching what the data dirs do.
        """
        with self._master_lock:
            self._memories_dir = memories_dir
            self._thumbs_dir = thumbs_dir
            self._account_key = account_key or ""

    def set_videos_root(self, videos_dir: Path) -> None:
        """Point owned videos at a different directory.

        Separate from repoint because the two change for different reasons: the
        account switches on sign-in, the video root only when the user picks a
        new one. Records carry a path relative to whichever root is current, so
        moving the files and calling this have to happen together.
        """
        with self._master_lock:
            self._videos_dir = videos_dir

    def _game_key(self, game_id):
        normalized = norm_game_id(game_id)
        if normalized is None:
            return None
        return str(normalized)

    def _path_for_game_key(self, key: str) -> Path:
        if not key or not _GAME_KEY_PATTERN.match(key):
            raise ValueError(f"invalid memories game key: {key!r}")
        return self._memories_dir / f"{key}.json"

    def _lock_for_game(self, key: str) -> threading.Lock:
        with self._master_lock:
            lock = self._game_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._game_locks[key] = lock
            return lock

    def account_key(self) -> str:
        with self._master_lock:
            return self._account_key

    def account_picture_root(self) -> Path:
        with self._master_lock:
            return self._pictures_dir / self._account_key if self._account_key else self._pictures_dir

    def account_video_root(self) -> Path:
        with self._master_lock:
            return self._videos_dir / self._account_key if self._account_key else self._videos_dir

    def pictures_root(self) -> Path:
        """The folder every record's relative path is measured from."""
        return self._pictures_dir

    def picture_path(self, relative: str) -> Path:
        """Absolute path of a picture from the relative path on its record."""
        return self._pictures_dir / relative

    def videos_root(self) -> Path:
        """The folder an owned video's relative path is measured from."""
        return self._videos_dir

    def video_path(self, relative: str) -> Path:
        """Absolute path of an owned video from the path on its record."""
        return self._videos_dir / relative

    def thumb_path(self, game_id, relative: str) -> Path:
        """Where the thumbnail for a picture goes.

        Derived from the picture's own basename, so nothing has to list the
        thumbnail directory to find one.
        """
        key = self._game_key(game_id)
        if key is None:
            key = str(MISC_GAME_ID)
        return self._thumbs_dir / key / (Path(relative).stem + ".webp")

    def ensure_thumb_dir(self, game_id) -> Path:
        """Create the per-game thumbnail directory, chowning each level."""
        key = self._game_key(game_id)
        if key is None:
            key = str(MISC_GAME_ID)
        ensure_dir(self._thumbs_dir)
        folder = self._thumbs_dir / key
        ensure_dir(folder)
        return folder

    def folder_for_game(self, game_id) -> str:
        """The directory name under the pictures root for one game.

        The RetroAchievements game id. A capture taken while RA has no game
        loaded goes to a shared folder instead.
        """
        normalized = norm_game_id(game_id)
        if normalized is None or normalized == MISC_GAME_ID:
            return MISC_FOLDER_NAME
        return str(normalized)

    def ensure_picture_dir(self, game_id) -> Path:
        """Create the per-game picture folder, chowning every level on the way.

        Each level goes through ensure_dir separately: mkdir(parents=True) only
        chowns the leaf, and a root-owned directory inside somebody's Pictures
        folder locks them out of it entirely.
        """
        ensure_dir(self._pictures_dir)
        account_root = self._pictures_dir
        if self._account_key:
            account_root = account_root / self._account_key
            ensure_dir(account_root)
        folder = account_root / self.folder_for_game(game_id)
        ensure_dir(folder)
        return folder

    def ensure_video_dir(self, game_id, clip_id: str) -> Path:
        """Create the directory one clip's copy goes in, chowning every level.

        One directory per clip rather than one file, because a copy is the
        manifest and its segments rather than a single video. Same level-by-
        level walk ensure_picture_dir does, and for the same reason.
        """
        if not _CLIP_ID_PATTERN.match(str(clip_id or "")):
            raise ValueError(f"invalid clip id: {clip_id!r}")
        ensure_dir(self._videos_dir)
        account_root = self._videos_dir
        if self._account_key:
            account_root = account_root / self._account_key
            ensure_dir(account_root)
        game_root = account_root / self.folder_for_game(game_id)
        ensure_dir(game_root)
        folder = game_root / clip_id
        ensure_dir(folder)
        return folder

    def _games_index_path(self) -> Path:
        return self._memories_dir / GAMES_INDEX_NAME

    def _load_games_index(self) -> dict:
        raw = load_json_file(self._games_index_path(), {})
        games = []
        if isinstance(raw, dict) and to_int(raw.get("schemaVersion"), 0) == CURRENT_SCHEMA_VERSION:
            for row in raw.get("games", []) or []:
                if not isinstance(row, dict):
                    continue
                game_id = norm_game_id(row.get("gameId"))
                if game_id is None:
                    continue
                games.append({
                    "gameId": game_id,
                    "gameTitle": row.get("gameTitle") if isinstance(row.get("gameTitle"), str) else "",
                    "consoleName": row.get("consoleName") if isinstance(row.get("consoleName"), str) else "",
                    "imageIcon": row.get("imageIcon") if isinstance(row.get("imageIcon"), str) else "",
                    "count": to_int(row.get("count"), 0),
                })
        return {"schemaVersion": CURRENT_SCHEMA_VERSION, "games": games}

    def _save_games_index(self, index: dict) -> None:
        ensure_dir(self._memories_dir)
        save_json_file(self._games_index_path(), index, compact=True)

    def _index_row_from_entry(self, entry: dict) -> dict:
        return {
            "gameId": entry["gameId"],
            "gameTitle": entry["gameTitle"],
            "consoleName": entry["consoleName"],
            "imageIcon": entry["imageIcon"],
            "count": len(entry["memories"]),
        }

    def _write_index_row(self, entry: dict) -> None:
        """Rewrite one game's row in the index.

        A game the user is still on keeps its row at a count of zero. Deleting
        its last memory would otherwise drop it from the index, and the page,
        having nothing to show for the game it was told to show, would land on
        whichever game sorts first. Zero rows are pruned as soon as the pick
        moves, so at most one ever exists.
        """
        with self._index_lock:
            index = self._load_games_index()
            held = norm_game_id(self.load_view_prefs().get("lastGameId"))
            rows = [row for row in index["games"] if row["gameId"] != entry["gameId"]]
            if entry["memories"] or entry["gameId"] == held:
                rows.append(self._index_row_from_entry(entry))
            rows = [row for row in rows if row["count"] > 0 or row["gameId"] == held]
            rows.sort(key=lambda row: (row["gameId"] == MISC_GAME_ID, row["gameTitle"].lower()))
            index["games"] = rows
            self._save_games_index(index)

    def games_with_memories(self) -> dict:
        """Every game this account has memories for, with its count.

        One file read. The Misc bucket sorts last because it has no title to
        sort by. A game the user is still on is listed even at zero, so emptying
        it leaves the page on it rather than sliding to another game.
        """
        with self._index_lock:
            index = self._load_games_index()
            held = norm_game_id(self.load_view_prefs().get("lastGameId"))
        return {
            "ok": True,
            "games": [
                {
                    "gameId": row["gameId"],
                    "gameTitle": row["gameTitle"],
                    "consoleName": row["consoleName"],
                    "imageIcon": row["imageIcon"],
                    "count": row["count"],
                }
                for row in index["games"]
                if row["count"] > 0 or row["gameId"] == held
            ],
        }

    def clear_thumbs(self) -> list:
        """Delete every generated tile and report what went.

        A thumbnail is a derived artifact and nothing reads it as a source of
        truth, so losing the lot costs only the time to make them again. The
        separate tree is what makes this safe: there is no path by which it
        reaches a metadata file.
        """
        removed = []
        if not self._thumbs_dir.is_dir():
            return removed
        try:
            for folder in sorted(self._thumbs_dir.iterdir()):
                if not folder.is_dir():
                    continue
                for tile in sorted(folder.glob("*.webp")):
                    try:
                        tile.unlink()
                        removed.append(tile.name)
                    except OSError:
                        pass
                try:
                    folder.rmdir()
                except OSError:
                    pass
        except OSError:
            pass
        return removed

    def rebuild_games_index(self) -> bool:
        """Rebuild _games.json from the game files, and report whether it ran.

        Only called when the file is missing, which is a restored backup or a
        half-deleted store. Reads without the per-game locks because it runs at
        boot before anything else touches the store, and taking them here would
        invert the lock order every other path uses.
        """
        if self._games_index_path().exists():
            return False
        if not self._memories_dir.is_dir():
            return False

        rows = []
        try:
            candidates = sorted(self._memories_dir.glob("*.json"))
        except OSError:
            return False

        for path in candidates:
            key = path.stem
            if not _GAME_KEY_PATTERN.match(key):
                continue
            entry = self._normalize_entry(load_json_file(path, {}), int(key))
            if entry["memories"]:
                rows.append(self._index_row_from_entry(entry))

        rows.sort(key=lambda row: (row["gameId"] == MISC_GAME_ID, row["gameTitle"].lower()))
        with self._index_lock:
            self._save_games_index({"schemaVersion": CURRENT_SCHEMA_VERSION, "games": rows})
        return True

    def _view_prefs_path(self) -> Path:
        return self._memories_dir / VIEW_PREFS_NAME

    def load_view_prefs(self) -> dict:
        """What the page opens on: game, tag filter, columns and date order.

        These are preferences rather than resume state. The test that separates
        the two is whether the value should survive a reboot, and these should.
        """
        raw = load_json_file(self._view_prefs_path(), {})
        if not isinstance(raw, dict):
            raw = {}

        columns = to_int(raw.get("gridColumns"), DEFAULT_GRID_COLUMNS)
        if columns not in GRID_COLUMN_OPTIONS:
            columns = DEFAULT_GRID_COLUMNS

        date_order = raw.get("dateOrder")
        if date_order not in _ALLOWED_DATE_ORDERS:
            date_order = "desc"

        tag_sort = raw.get("tagSort")
        if tag_sort not in _ALLOWED_TAG_SORTS:
            tag_sort = "recent"

        last_tag = raw.get("lastTagFilter")
        if not isinstance(last_tag, str):
            last_tag = ""

        last_color = raw.get("lastColorFilter")
        if last_color not in _NOTE_COLOR_OPTIONS:
            last_color = ""

        last_media = raw.get("lastMediaFilter")
        if last_media not in _ALLOWED_MEDIA_FILTERS:
            last_media = ""

        page_index = to_int(raw.get("lastPageIndex"), 0)
        if page_index < 0:
            page_index = 0

        return {
            "ok": True,
            "gridColumns": columns,
            "dateOrder": date_order,
            "lastGameId": norm_game_id(raw.get("lastGameId")),
            "seededForGameId": norm_game_id(raw.get("seededForGameId")),
            "lastPageIndex": page_index,
            "lastTagFilter": last_tag[:MEMORY_TAG_MAX_LEN],
            "lastColorFilter": last_color,
            "lastMediaFilter": last_media,
            "tagSort": tag_sort,
        }

    def save_view_prefs(
        self,
        *,
        grid_columns=None,
        date_order=None,
        last_game_id=None,
        seeded_for_game_id=None,
        last_tag_filter=None,
        last_color_filter=None,
        last_media_filter=None,
        tag_sort=None,
        last_page_index=None,
    ) -> dict:
        """Merge whatever was passed into the stored preferences.

        Every argument is optional and None means leave that one alone, so a
        caller changing the grid columns does not have to know the rest.
        """
        with self._index_lock:
            current = self.load_view_prefs()

            if grid_columns is not None and to_int(grid_columns, 0) in GRID_COLUMN_OPTIONS:
                current["gridColumns"] = to_int(grid_columns, DEFAULT_GRID_COLUMNS)
            if date_order in _ALLOWED_DATE_ORDERS:
                current["dateOrder"] = date_order
            if tag_sort in _ALLOWED_TAG_SORTS:
                current["tagSort"] = tag_sort
            if last_game_id is not None:
                current["lastGameId"] = norm_game_id(last_game_id)
            if seeded_for_game_id is not None:
                current["seededForGameId"] = norm_game_id(seeded_for_game_id)
            if isinstance(last_tag_filter, str):
                current["lastTagFilter"] = last_tag_filter.strip()[:MEMORY_TAG_MAX_LEN]
            if isinstance(last_color_filter, str):
                current["lastColorFilter"] = (
                    last_color_filter if last_color_filter in _NOTE_COLOR_OPTIONS else ""
                )
            if isinstance(last_media_filter, str):
                current["lastMediaFilter"] = (
                    last_media_filter if last_media_filter in _ALLOWED_MEDIA_FILTERS else ""
                )
            if last_page_index is not None:
                current["lastPageIndex"] = max(to_int(last_page_index, 0), 0)

            self._write_view_prefs(current)

        return current

    def forget_seeded_game(self) -> None:
        """Forget which game the Memories page last seeded its filter to.

        The page seeds itself once per game id, so a game loaded again after
        the user picked a different game never pulls the filter back until
        this runs.
        """
        with self._index_lock:
            current = self.load_view_prefs()
            if current.get("seededForGameId") is None:
                return
            current["seededForGameId"] = None
            self._write_view_prefs(current)

    def _write_view_prefs(self, current: dict) -> None:
        payload = dict(current)
        payload.pop("ok", None)
        ensure_dir(self._memories_dir)
        save_json_file(self._view_prefs_path(), payload, compact=True)

    def _clean_caption(self, raw) -> str:
        if not isinstance(raw, str):
            return ""
        return raw.strip()[:MEMORY_CAPTION_MAX_LEN]

    def _clean_tag(self, raw):
        if not isinstance(raw, str):
            return None
        cleaned = _TAG_CLEAN_PATTERN.sub("", raw).strip()[:MEMORY_TAG_MAX_LEN]
        return cleaned or None

    def _clean_color(self, raw) -> str:
        if raw in _NOTE_COLOR_OPTIONS:
            return raw
        return "default"

    def _clean_progress(self, raw):
        if not isinstance(raw, dict):
            return None
        total = to_int(raw.get("total"), 0)
        if total <= 0:
            return None
        return {
            "unlocked": to_int(raw.get("unlocked"), 0),
            "total": total,
            "points": to_int(raw.get("points"), 0),
        }

    def _clean_achievement(self, raw):
        if not isinstance(raw, dict):
            return None
        achievement_id = norm_game_id(raw.get("id"))
        if achievement_id is None:
            return None
        badge = raw.get("badgeName")
        kind = raw.get("type")
        description = raw.get("description")
        return {
            "id": achievement_id,
            "title": raw.get("title") if isinstance(raw.get("title"), str) else "",
            "description": (
                description[:MAX_ACHIEVEMENT_DESCRIPTION_LEN]
                if isinstance(description, str) else ""
            ),
            "hardcore": bool(raw.get("hardcore")),
            "trueRatio": to_int(raw.get("trueRatio"), 0),
            "badgeName": badge if isinstance(badge, str) else "",
            "points": to_int(raw.get("points"), 0),
            "numAwarded": to_int(raw.get("numAwarded"), 0),
            "type": kind if kind in _ALLOWED_ACHIEVEMENT_TYPES else "",
            "unlockedAt": to_int(raw.get("unlockedAt"), 0) or None,
        }

    def _clean_achievements(self, raw) -> list:
        if not isinstance(raw, list):
            return []
        out = []
        for item in raw:
            cleaned = self._clean_achievement(item)
            if cleaned is not None:
                out.append(cleaned)
            if len(out) >= MAX_BOUND_ACHIEVEMENTS:
                break
        return out

    def _normalize_memory(self, raw, game_id: int):
        if not isinstance(raw, dict):
            return None

        memory_id = raw.get("id")
        if not isinstance(memory_id, str) or not memory_id:
            return None

        path = _clean_relative_path(raw.get("path"))
        if path is None:
            return None

        context_state = raw.get("contextState")
        if context_state not in _ALLOWED_CONTEXT_STATES:
            context_state = "pending"

        source = raw.get("source")
        if source not in _ALLOWED_SOURCES:
            source = "steam"

        achievements = self._clean_achievements(raw.get("achievements"))
        captured = to_int(raw.get("capturedAt"), 0)
        return {
            "id": memory_id,
            "gameId": game_id,
            "path": path,
            "video": _clean_video(raw.get("video")),
            "capturedAt": captured,
            "updatedAt": to_int(raw.get("updatedAt"), 0) or captured,
            "appid": to_int(raw.get("appid"), 0),
            "gameTitle": raw.get("gameTitle") if isinstance(raw.get("gameTitle"), str) else "",
            "consoleName": raw.get("consoleName") if isinstance(raw.get("consoleName"), str) else "",
            "imageIcon": raw.get("imageIcon") if isinstance(raw.get("imageIcon"), str) else "",
            "source": source,
            "caption": self._clean_caption(raw.get("caption")),
            "tag": self._clean_tag(raw.get("tag")),
            "color": self._clean_color(raw.get("color")),
            "contextState": context_state,
            "progress": self._clean_progress(raw.get("progress")),
            "achievements": achievements,
            "achievementCount": max(to_int(raw.get("achievementCount"), 0), len(achievements)),
        }

    def _empty_entry(self, game_id: int) -> dict:
        return {
            "gameId": game_id,
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "gameTitle": "",
            "consoleName": "",
            "imageIcon": "",
            "tagVocabulary": [],
            "memories": [],
        }

    def _normalize_entry(self, raw, game_id: int) -> dict:
        entry = self._empty_entry(game_id)
        if not isinstance(raw, dict):
            return entry
        if to_int(raw.get("schemaVersion"), 0) != CURRENT_SCHEMA_VERSION:
            return entry

        memories = []
        for raw_memory in raw.get("memories", []) or []:
            cleaned = self._normalize_memory(raw_memory, game_id)
            if cleaned is not None:
                memories.append(cleaned)
        memories.sort(key=lambda m: m["capturedAt"], reverse=True)

        seen = set()
        vocab = []
        for raw_tag in raw.get("tagVocabulary", []) or []:
            cleaned = self._clean_tag(raw_tag)
            if cleaned is None:
                continue
            lower = cleaned.lower()
            if lower in seen:
                continue
            seen.add(lower)
            vocab.append(cleaned)
            if len(vocab) >= TAG_VOCAB_LIMIT:
                break

        title = raw.get("gameTitle")
        console = raw.get("consoleName")
        entry["gameTitle"] = title if isinstance(title, str) else ""
        entry["consoleName"] = console if isinstance(console, str) else ""
        icon = raw.get("imageIcon")
        entry["imageIcon"] = icon if isinstance(icon, str) else ""
        entry["tagVocabulary"] = vocab
        entry["memories"] = memories
        return entry

    def _load_raw(self, key: str) -> dict:
        return self._normalize_entry(load_json_file(self._path_for_game_key(key), {}), int(key))

    def _save_raw(self, key: str, entry: dict) -> None:
        path = self._path_for_game_key(key)
        if entry["memories"]:
            ensure_dir(self._memories_dir)
            save_json_file(path, entry, compact=True)
        else:
            try:
                path.unlink()
            except OSError:
                pass
        self._write_index_row(entry)

    def _add_tag_to_vocab(self, entry: dict, tag) -> None:
        if tag is None:
            return
        lower = tag.lower()
        entry["tagVocabulary"] = [tag] + [t for t in entry["tagVocabulary"] if t.lower() != lower]
        del entry["tagVocabulary"][TAG_VOCAB_LIMIT:]

    def _prune_tag_vocab(self, entry: dict) -> None:
        """Drop vocabulary entries no longer carried by any memory.

        Called after a write that can orphan a tag, so clearing the last memory
        that used one takes it out of the suggestions rather than leaving a tag
        nothing can ever match.
        """
        in_use = {m["tag"].lower() for m in entry["memories"] if m.get("tag")}
        entry["tagVocabulary"] = [t for t in entry["tagVocabulary"] if t.lower() in in_use]

    def _new_memory_id(self) -> str:
        return f"mem_{secrets.token_urlsafe(8)}"

    def load_for_game(self, game_id) -> dict:
        """One game's memories, newest first, with its tag vocabulary.

        Records whose picture has gone missing are dropped and the pruned list
        is written back: deleting a picture in desktop mode is an ordinary thing
        to do and the page should simply not show it.
        """
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id", "memories": [], "tagVocabulary": []}

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            kept = [m for m in entry["memories"] if self.picture_path(m["path"]).exists()]
            if len(kept) != len(entry["memories"]):
                entry["memories"] = kept
                self._prune_tag_vocab(entry)
                self._save_raw(key, entry)

        return {
            "ok": True,
            "gameId": entry["gameId"],
            "gameTitle": entry["gameTitle"],
            "memories": list(entry["memories"]),
            "tagVocabulary": list(entry["tagVocabulary"]),
        }

    def load_all(self) -> dict:
        """Every memory this account has, newest first.

        Reads one file per game that has any, which is the one place this store
        lists anything. It runs only when somebody picks All Games, and the file
        count follows games captured in rather than library size.
        """
        with self._index_lock:
            index = self._load_games_index()

        memories = []
        vocabulary = []
        seen_tags = set()
        for row in index["games"]:
            key = str(row["gameId"])
            lock = self._lock_for_game(key)
            with lock:
                try:
                    entry = self._load_raw(key)
                except ValueError:
                    continue
            for memory in entry["memories"]:
                if self.picture_path(memory["path"]).exists():
                    memories.append(memory)
            for tag in entry["tagVocabulary"]:
                lower = tag.lower()
                if lower not in seen_tags:
                    seen_tags.add(lower)
                    vocabulary.append(tag)

        memories.sort(key=lambda m: m["capturedAt"], reverse=True)
        dropped = max(0, len(memories) - ALL_GAMES_RECORD_CAP)
        if dropped:
            decky.logger.info("memories: All Games capped at %s, %s not listed", ALL_GAMES_RECORD_CAP, dropped)
            memories = memories[:ALL_GAMES_RECORD_CAP]

        return {
            "ok": True,
            "gameId": ALL_GAMES_ID,
            "gameTitle": "",
            "memories": memories,
            "tagVocabulary": vocabulary[:TAG_VOCAB_LIMIT],
            "truncated": dropped,
        }

    def all_entries(self) -> dict:
        with self._index_lock:
            index = self._load_games_index()

        entries = {}
        for row in index["games"]:
            key = str(row["gameId"])
            lock = self._lock_for_game(key)
            with lock:
                try:
                    entries[key] = self._load_raw(key)
                except ValueError:
                    continue
        return entries

    def memory_ids(self) -> set:
        held = set()
        for entry in self.all_entries().values():
            for memory in entry["memories"]:
                held.add(memory["id"])
        return held

    def insert_memories(self, game_id, memories, tag_vocabulary=None) -> dict:
        key = self._game_key(game_id)
        if key is None:
            return {
                "ok": False, "error": "invalid_game_id",
                "inserted": 0, "skipped": 0, "insertedIds": [],
            }

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            held = {m["id"] for m in entry["memories"]}
            inserted = 0
            skipped = 0
            arriving = []
            for raw in memories or []:
                cleaned = self._normalize_memory(raw, int(key))
                if cleaned is None:
                    skipped += 1
                    continue
                if cleaned["id"] in held:
                    skipped += 1
                    continue
                held.add(cleaned["id"])
                arriving.append(cleaned)
                entry["memories"].append(cleaned)
                inserted += 1
                if cleaned["gameTitle"] and not entry["gameTitle"]:
                    entry["gameTitle"] = cleaned["gameTitle"]
                if cleaned["consoleName"] and not entry["consoleName"]:
                    entry["consoleName"] = cleaned["consoleName"]
                if cleaned["imageIcon"] and not entry["imageIcon"]:
                    entry["imageIcon"] = cleaned["imageIcon"]

            for tag in reversed(list(tag_vocabulary or [])):
                self._add_tag_to_vocab(entry, self._clean_tag(tag))
            for memory in arriving:
                self._add_tag_to_vocab(entry, memory.get("tag"))

            entry["memories"].sort(key=lambda m: m["capturedAt"], reverse=True)
            if inserted:
                self._save_raw(key, entry)

        return {
            "ok": True,
            "inserted": inserted,
            "skipped": skipped,
            "insertedIds": [m["id"] for m in arriving],
        }

    def pending_memories(self, game_id) -> list:
        """Every memory for a game still waiting on the context resolver."""
        key = self._game_key(game_id)
        if key is None:
            return []
        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
        return [dict(m) for m in entry["memories"] if m["contextState"] == "pending"]

    def video_source_for(self, game_id, memory_id: str):
        """The directory holding one memory's owned clip, or None.

        Returns None for a screenshot, for a record whose video was never
        copied, and for a memory that is not there. The caller gets a directory
        rather than a file because a copy is a manifest and its segments.
        """
        key = self._game_key(game_id)
        if key is None:
            return None
        lock = self._lock_for_game(key)
        with lock:
            try:
                entry = self._load_raw(key)
            except ValueError:
                return None
        for memory in entry["memories"]:
            if memory["id"] != memory_id:
                continue
            relative = (memory.get("video") or {}).get("path") or ""
            return self.video_path(relative) if relative else None
        return None

    def add_memory(
        self,
        game_id,
        *,
        path: str,
        captured_at: int,
        app_id: int = 0,
        game_title: str = "",
        console_name: str = "",
        image_icon: str = "",
        source: str = "steam",
        video=None,
    ) -> dict:
        """Record one adopted capture.

        ``path`` is relative to the pictures root, never absolute: the home
        directory is resolved fresh on every read, so a relative path survives a
        restored backup and a different ``$HOME``. ``video`` names the clip
        behind a poster image and is left out for a screenshot.
        """
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}

        relative = _clean_relative_path(path)
        if relative is None:
            return {"ok": False, "error": "invalid_path"}

        stamp = to_int(captured_at, 0)
        if stamp <= 0:
            stamp = int(time.time())

        memory = {
            "id": self._new_memory_id(),
            "gameId": int(key),
            "path": relative,
            "video": _clean_video(video),
            "capturedAt": stamp,
            "updatedAt": stamp,
            "appid": to_int(app_id, 0),
            "gameTitle": game_title if isinstance(game_title, str) else "",
            "consoleName": console_name if isinstance(console_name, str) else "",
            "imageIcon": image_icon if isinstance(image_icon, str) else "",
            "source": source if source in _ALLOWED_SOURCES else "steam",
            "caption": "",
            "tag": None,
            "color": "default",
            "contextState": "pending",
            "progress": None,
            "achievements": [],
            "achievementCount": 0,
        }

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            if memory["gameTitle"]:
                entry["gameTitle"] = memory["gameTitle"]
            if memory["consoleName"]:
                entry["consoleName"] = memory["consoleName"]
            if memory["imageIcon"]:
                entry["imageIcon"] = memory["imageIcon"]
            entry["memories"].insert(0, memory)
            entry["memories"].sort(key=lambda m: m["capturedAt"], reverse=True)
            self._save_raw(key, entry)

        return {"ok": True, "memory": memory}

    def update_memory(self, game_id, memory_id: str, *, caption=None, tag=None, color=None) -> dict:
        """Change a memory's caption, tag or color.

        Each field is optional and None leaves it alone. Clearing a tag is
        passing an empty string, which cleans to None. Anything that lands moves
        ``updatedAt``, which is what tells two copies of one record apart.
        """
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(memory_id, str) or not memory_id:
            return {"ok": False, "error": "invalid_memory_id"}

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            target = None
            for memory in entry["memories"]:
                if memory["id"] == memory_id:
                    target = memory
                    break
            if target is None:
                return {"ok": False, "error": "not_found"}

            changed = False
            if caption is not None:
                target["caption"] = self._clean_caption(caption)
                changed = True
            if tag is not None:
                target["tag"] = self._clean_tag(tag)
                self._add_tag_to_vocab(entry, target["tag"])
                changed = True
            if color is not None:
                target["color"] = self._clean_color(color)
                changed = True
            if changed:
                target["updatedAt"] = int(time.time())

            if tag is not None:
                self._prune_tag_vocab(entry)
            self._save_raw(key, entry)
            result = dict(target)
            vocabulary = list(entry["tagVocabulary"])

        return {"ok": True, "memory": result, "tagVocabulary": vocabulary}

    def apply_resolution(self, game_id, resolved) -> dict:
        """Write the resolver's progress and bound achievements onto memories.

        ``resolved`` maps a memory id to ``{progress, achievements,
        achievementCount, contextState}``. Idempotent: a memory the map does not
        name is left alone, and re-running with the same map changes nothing.
        """
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(resolved, dict) or not resolved:
            return {"ok": True, "updated": 0}

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            updated = 0
            for memory in entry["memories"]:
                patch = resolved.get(memory["id"])
                if not isinstance(patch, dict):
                    continue
                achievements = self._clean_achievements(patch.get("achievements"))
                memory["progress"] = self._clean_progress(patch.get("progress"))
                memory["achievements"] = achievements
                memory["achievementCount"] = max(
                    to_int(patch.get("achievementCount"), 0), len(achievements)
                )
                state = patch.get("contextState")
                memory["contextState"] = state if state in _ALLOWED_CONTEXT_STATES else "pending"
                updated += 1

            if updated:
                self._save_raw(key, entry)

        return {"ok": True, "updated": updated}

    def _unlink_memory_files(self, game_id, memory: dict) -> None:
        targets = [self.thumb_path(game_id, memory["path"]), self.picture_path(memory["path"])]
        for target in targets:
            try:
                target.unlink()
            except OSError:
                pass

        owned = (memory.get("video") or {}).get("path")
        if owned:
            try:
                shutil.rmtree(self.video_path(owned))
            except OSError:
                pass

    def _unlink_thumb(self, game_id, memory: dict) -> None:
        # Deliberately not _unlink_memory_files, which also takes the picture
        try:
            self.thumb_path(game_id, memory["path"]).unlink()
        except OSError:
            pass

    def move_memory(
        self,
        source_game_id,
        memory_id: str,
        destination_game_id,
        *,
        game_title: str = "",
        console_name: str = "",
        image_icon: str = "",
    ) -> dict:
        """Re-file one memory under a different game.

        Rewrites only the four fields that say which game a memory belongs to
        and leaves everything else on the record alone, the id included. The
        media does not move: ``path`` is relative to the pictures root and does
        not have to sit under its own game's folder.

        Returns ``{"ok": True, "gameId": <destination>}``, or ok False with
        ``error`` one of invalid_game_id, invalid_memory_id, same_game,
        not_found.
        """
        source_key = self._game_key(source_game_id)
        destination_key = self._game_key(destination_game_id)
        if source_key is None or destination_key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(memory_id, str) or not memory_id:
            return {"ok": False, "error": "invalid_memory_id"}
        if source_key == destination_key:
            return {"ok": False, "error": "same_game"}

        first_key, second_key = sorted((source_key, destination_key))
        with self._lock_for_game(first_key), self._lock_for_game(second_key):
            source_entry = self._load_raw(source_key)
            target = None
            for memory in source_entry["memories"]:
                if memory["id"] == memory_id:
                    target = memory
                    break
            if target is None:
                return {"ok": False, "error": "not_found"}

            moved = dict(target)
            moved["gameId"] = to_int(destination_game_id, 0)
            moved["gameTitle"] = str(game_title or "")
            moved["consoleName"] = str(console_name or "")
            moved["imageIcon"] = str(image_icon or "")

            destination_entry = self._load_raw(destination_key)
            if moved["gameTitle"]:
                destination_entry["gameTitle"] = moved["gameTitle"]
            if moved["consoleName"]:
                destination_entry["consoleName"] = moved["consoleName"]
            if moved["imageIcon"]:
                destination_entry["imageIcon"] = moved["imageIcon"]
            destination_entry["memories"] = [
                m for m in destination_entry["memories"] if m["id"] != memory_id
            ]
            destination_entry["memories"].append(moved)
            destination_entry["memories"].sort(key=lambda m: m["capturedAt"], reverse=True)
            self._add_tag_to_vocab(destination_entry, moved.get("tag"))
            self._save_raw(destination_key, destination_entry)

            source_entry["memories"] = [
                m for m in source_entry["memories"] if m["id"] != memory_id
            ]
            self._prune_tag_vocab(source_entry)
            self._save_raw(source_key, source_entry)

            self._unlink_thumb(source_key, target)

        return {"ok": True, "gameId": to_int(destination_game_id, 0)}

    def _prune_empty_dirs(self, game_id, memory: dict) -> None:
        picture_dir = self.picture_path(memory["path"]).parent
        thumb_dir = self.thumb_path(game_id, memory["path"]).parent
        folders = [thumb_dir, picture_dir]
        owned = (memory.get("video") or {}).get("path")
        if owned:
            folders.append(self.video_path(owned).parent)
        for folder in folders:
            try:
                folder.rmdir()
            except OSError:
                pass

    def delete_memory(self, game_id, memory_id: str) -> dict:
        """Remove a memory, its thumbnail and its picture.

        Files first, then the row: a crash between them leaves a record pointing
        at a missing file, which the next page load prunes by itself. The other
        order leaves a picture nothing can see, which nothing repairs.
        """
        key = self._game_key(game_id)
        if key is None:
            return {"ok": False, "error": "invalid_game_id"}
        if not isinstance(memory_id, str) or not memory_id:
            return {"ok": False, "error": "invalid_memory_id"}

        lock = self._lock_for_game(key)
        with lock:
            entry = self._load_raw(key)
            target = None
            for memory in entry["memories"]:
                if memory["id"] == memory_id:
                    target = memory
                    break
            if target is None:
                return {"ok": False, "error": "not_found"}

            self._unlink_memory_files(key, target)
            entry["memories"] = [m for m in entry["memories"] if m["id"] != memory_id]
            self._prune_tag_vocab(entry)
            self._save_raw(key, entry)
            if not entry["memories"]:
                self._prune_empty_dirs(key, target)
            remaining = len(entry["memories"])

        return {"ok": True, "deletedId": memory_id, "remaining": remaining}

    def _account_trees(self) -> list:
        with self._master_lock:
            picture_root = self._pictures_dir / self._account_key if self._account_key else self._pictures_dir
            video_root = self._videos_dir / self._account_key if self._account_key else self._videos_dir
            return [self._memories_dir, picture_root, video_root]

    def stashed_trees(self) -> list:
        found = []
        for tree in self._account_trees():
            stashed = tree.with_name(tree.name + STASHED_SUFFIX)
            if stashed.is_dir():
                found.append([str(stashed), str(tree)])
        return found

    def stash_account_trees(self) -> dict:
        trees = self._account_trees()
        for tree in trees:
            if tree.with_name(tree.name + STASHED_SUFFIX).exists():
                return {"ok": False, "error": "stash_pending", "moved": []}

        moved = []
        for tree in trees:
            if not tree.is_dir():
                continue
            stashed = tree.with_name(tree.name + STASHED_SUFFIX)
            try:
                tree.rename(stashed)
            except OSError as e:
                decky.logger.error(
                    "memories: couldn't move %s aside (%s)", tree.name, type(e).__name__
                )
                self.restore_account_trees(moved)
                return {"ok": False, "error": "stash_failed", "moved": []}
            moved.append([str(stashed), str(tree)])
        return {"ok": True, "moved": moved}

    def restore_account_trees(self, moved) -> int:
        restored = 0
        for pair in moved or []:
            stashed, original = Path(pair[0]), Path(pair[1])
            if not stashed.is_dir():
                continue
            try:
                shutil.rmtree(original)
            except OSError:
                pass
            try:
                stashed.rename(original)
            except OSError as e:
                decky.logger.error(
                    "memories: couldn't put %s back (%s)", original.name, type(e).__name__
                )
                continue
            restored += 1
        return restored

    def discard_stashed_trees(self, moved) -> int:
        removed = 0
        for pair in moved or []:
            stashed = Path(pair[0])
            try:
                shutil.rmtree(stashed)
            except OSError as e:
                decky.logger.warning(
                    "memories: the replaced library stayed at %s (%s)", stashed, type(e).__name__
                )
                continue
            removed += 1
        return removed

    def delete_all(self) -> dict:
        try:
            keys = [p.stem for p in self._memories_dir.glob("*.json") if _GAME_KEY_PATTERN.match(p.stem)]
        except OSError:
            keys = []

        removed = 0
        media_dirs = set()
        account_dirs = set()

        def note_dirs(root: Path, relative: str) -> None:
            media_dirs.add((root / relative).parent)
            segments = relative.split("/")
            if len(segments) >= 3:
                account_dirs.add(root / segments[0])

        for key in keys:
            lock = self._lock_for_game(key)
            with lock:
                entry = self._load_raw(key)
                for memory in entry["memories"]:
                    self._unlink_memory_files(key, memory)
                    note_dirs(self._pictures_dir, memory["path"])
                    owned = (memory.get("video") or {}).get("path")
                    if owned:
                        note_dirs(self._videos_dir, owned)
                removed += len(entry["memories"])
                entry["memories"] = []
                self._save_raw(key, entry)

        for folder in sorted(media_dirs) + sorted(account_dirs):
            try:
                folder.rmdir()
            except OSError:
                pass
        try:
            shutil.rmtree(self._thumbs_dir)
        except OSError:
            pass

        with self._index_lock:
            self._save_games_index({"schemaVersion": CURRENT_SCHEMA_VERSION, "games": []})

        return {"ok": True, "removed": removed}
