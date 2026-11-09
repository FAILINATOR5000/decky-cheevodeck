import re
from pathlib import Path

import threading
import time

import decky

from utils import (
    NewerSchemaFile,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    save_json_file,
    to_int,
)


CURRENT_SCHEMA_VERSION = 1

MAX_ROWS_PER_SECTION = 10000

MAX_SUPPORTED_ROWS = 25000

MAX_NO_SET_ROWS = 25000

PICKED_SCHEMA_VERSION = 1
MAX_PICKED_GAMES = 500
_PICKED_HASH = re.compile(r"^[0-9a-f]{32}$")


class CheevoCheckStore:
    """Everything Cheevo Check keeps on disk, which is four separate files.

    Deliberately isolated from the rest of the plugin: its own directory, its
    own RA data, its own idea of freshness. It does not share
    games_list_cache_store, which is a decision rather than an oversight,
    because the set picker's list is filtered to games that have achievements
    and that is exactly the distinction this feature exists to draw.

    Global rather than per-account, so the directory sits at the runtime_dir
    root and never repoints. None of the files depend on who is signed in:
    ra_data.json is RA's public hash list, identical for everyone, and the rest
    describe the user's own files on their own drive.

    ``results.json``
        The last scan's verdict. Written once, at the end, as a replacement, so
            an
        interrupted scan leaves the previous results whole rather than a
            truncated
        list that looks complete.

    ``ra_data.json``
        Every hash RetroAchievements knows, for the consoles the last Scan
            touched.
        One file rather than one per console, because the all-or-nothing
            property is
        what Offline Scan's availability rests on: presence means complete, and
            a
        single atomic replace is the only way that is true rather than assumed.

    ``hashes.json``
        The hashes computed for the user's own files, behind the Cache Local
            Hashes
        toggle. Keyed on (console, realpath, size, mtime_ns), and the mtime is
            what
        makes a swapped-in different dump of the same size re-hash instead of
            silently
        returning the old answer.

    ``verify_results.json``
        What the full-hash check made of those same files, when the Verify Full
            Hashes
        toggle was on. A separate file rather than more keys in results.json,
            and the
        reason is one-directional: save_results runs at the end of every scan,
            so
        verification living in there would mean a single Scan with the toggle
            off
        silently destroying an hour of work. Separate file, same lifetime:
        clear_results drops both, because these rows describe the files that
            scan
        found and mean nothing once it is gone.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()

    def _dir(self) -> Path:
        return self._base_dir / "cheevo_check"

    def _results_path(self) -> Path:
        return self._dir() / "results.json"

    def _ra_data_path(self) -> Path:
        return self._dir() / "ra_data.json"

    def _hash_cache_path(self) -> Path:
        return self._dir() / "hashes.json"

    def _verify_results_path(self) -> Path:
        return self._dir() / "verify_results.json"

    def _picked_path(self) -> Path:
        return self._dir() / "picked_games.json"

    _SECTIONS = (
        ("unsupported", MAX_ROWS_PER_SECTION),
        ("noAchievements", MAX_NO_SET_ROWS),
        ("failed", MAX_ROWS_PER_SECTION),
        ("supportedGames", MAX_SUPPORTED_ROWS),
    )

    def results_fingerprint(self):
        """What identifies the current results file, without reading it.

        The library badge asks on every game page a user opens, and on a big
        library results.json is megabytes, so parsing the whole thing to read
        one timestamp is the wrong shape entirely. A stat is microseconds and
        moves whenever save_results replaces the file, which is the only way
        the contents ever change.

        None when there is no file, which is the same answer an empty scan
        gives and needs no special case at the caller.
        """
        try:
            stat = self._results_path().stat()
        except OSError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def load_results(self):
        """The last scan's verdict, with every list field guaranteed present.

        The filling-in is the point. A results file written before a section
        existed passes the version check and comes back missing that key, and
        the page then reads .length off undefined and takes the whole plugin
        down with it. Sections get added; a read of an older file has to heal
        rather than half-answer.
        """
        raw = load_json_file(self._results_path(), None)
        if not isinstance(raw, dict):
            return None
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return None
        for section, _ in self._SECTIONS:
            if not isinstance(raw.get(section), list):
                raw[section] = []
        if not isinstance(raw.get("missingConsoles"), list):
            raw["missingConsoles"] = []
        return raw

    def save_results(self, results: dict) -> None:
        payload = dict(results)
        payload["schemaVersion"] = CURRENT_SCHEMA_VERSION
        for section, cap in self._SECTIONS:
            rows = payload.get(section)
            payload[section] = list(rows)[:cap] if isinstance(rows, list) else []
            if isinstance(rows, list) and len(rows) > cap:
                decky.logger.warning(
                    "cheevocheck: %s truncated to %d rows, %d dropped from the results file",
                    section, cap, len(rows) - cap,
                )
        ensure_dir(self._dir())
        save_json_file(self._results_path(), payload, compact=True)
        self._drop_foreign_verify_results(str(payload.get("root") or ""))

    def _drop_foreign_verify_results(self, root: str) -> None:
        stored = self.load_verify_results()
        if stored is None or str(stored.get("root") or "") == root:
            return
        decky.logger.info(
            "cheevocheck: dropped verification results describing %s",
            stored.get("root") or "an earlier build",
        )
        self._unlink(self._verify_results_path())

    def clear_results(self) -> list:
        return self._unlink(self._results_path()) + self._unlink(self._verify_results_path())

    def clear_picked(self) -> list:
        return self._unlink(self._picked_path())

    def picked_fingerprint(self):
        try:
            stat = self._picked_path().stat()
        except OSError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def load_picked(self) -> dict:
        raw = load_json_file(self._picked_path(), {})
        if is_newer_schema(raw, PICKED_SCHEMA_VERSION):
            report_newer_schema(self._picked_path())
            return {}
        return _clean_picked(raw.get("games") if isinstance(raw, dict) else None)

    def _write_picked(self, edit) -> bool:
        with self._lock:
            raw = load_json_file(self._picked_path(), {})
            games = _clean_picked(raw.get("games") if isinstance(raw, dict) else None)
            edit(games)
            try:
                refuse_newer_file(self._picked_path(), PICKED_SCHEMA_VERSION)
                ensure_dir(self._dir())
                save_json_file(self._picked_path(), {"schemaVersion": PICKED_SCHEMA_VERSION,
                                                     "games": _clean_picked(games)}, compact=True)
            except NewerSchemaFile:
                return False
            except OSError as e:
                decky.logger.warning("cheevocheck: couldn't save a picked game (%s)", type(e).__name__)
                return False
        return True

    def save_picked(self, game_id: int, row: dict) -> bool:
        return self._write_picked(lambda games: games.__setitem__(str(game_id), row))

    def forget_picked(self, game_id: int) -> bool:
        return self._write_picked(lambda games: games.pop(str(game_id), None))

    _VERIFY_SECTIONS = (
        "verified",
        "raFull",
        "raPartial",
        "mismatch",
        "unrecognised",
        "unverifiable",
    )

    def load_verify_results(self):
        raw = load_json_file(self._verify_results_path(), None)
        if not isinstance(raw, dict):
            return None
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return None
        for section in self._VERIFY_SECTIONS:
            if not isinstance(raw.get(section), list):
                raw[section] = []
        return raw

    def save_verify_results(self, results: dict) -> None:
        payload = dict(results)
        payload["schemaVersion"] = CURRENT_SCHEMA_VERSION
        for section in self._VERIFY_SECTIONS:
            rows = payload.get(section)
            payload[section] = list(rows)[:MAX_ROWS_PER_SECTION] if isinstance(rows, list) else []
            if isinstance(rows, list) and len(rows) > MAX_ROWS_PER_SECTION:
                decky.logger.warning(
                    "cheevocheck: verify %s truncated to %d rows, %d dropped from the results file",
                    section, MAX_ROWS_PER_SECTION, len(rows) - MAX_ROWS_PER_SECTION,
                )
        ensure_dir(self._dir())
        save_json_file(self._verify_results_path(), payload, compact=True)

    def load_ra_data(self):
        raw = load_json_file(self._ra_data_path(), None)
        if not isinstance(raw, dict):
            return None
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return None
        if not isinstance(raw.get("consoles"), dict):
            return None
        return raw

    def ra_data_summary(self) -> dict:
        """What the page needs to know without loading megabytes of hashes.

        Two questions, and both come off the same read: is Offline Scan allowed
        (does any data exist), and how old is what it would use.
        """
        data = self.load_ra_data()
        if data is None:
            return {"available": False, "builtAt": 0, "consoles": 0}
        return {
            "available": True,
            "builtAt": to_int(data.get("builtAt", 0), 0),
            "consoles": len(data.get("consoles") or {}),
        }

    def save_ra_data(self, consoles: dict) -> None:
        """Replace the whole database with what this fetch produced.

        Blank slate, every time. Nothing merges with what was there, so a
        console's entry can never be part old and part new, and there is one
        build date for the lot instead of a patchwork. save_json_file writes
        through a sibling .tmp and renames, which is what makes the replacement
        atomic: an interrupted Scan leaves the previous database intact rather
        than a half-built one that would pass the presence check and classify
        against missing consoles.
        """
        ensure_dir(self._dir())
        save_json_file(
            self._ra_data_path(),
            {
                "schemaVersion": CURRENT_SCHEMA_VERSION,
                "builtAt": int(time.time()),
                "consoles": consoles,
            },
            compact=True,
        )

    def clear_ra_data(self) -> list:
        return self._unlink(self._ra_data_path())

    def load_hash_cache(self) -> dict:
        raw = load_json_file(self._hash_cache_path(), None)
        if not isinstance(raw, dict):
            return {}
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return {}
        entries = raw.get("entries")
        return entries if isinstance(entries, dict) else {}

    def save_hash_cache(self, entries: dict) -> None:
        ensure_dir(self._dir())
        save_json_file(
            self._hash_cache_path(),
            {
                "schemaVersion": CURRENT_SCHEMA_VERSION,
                "entries": entries,
            },
            compact=True,
        )

    def has_hash_cache(self) -> bool:
        return self._hash_cache_path().exists()

    def clear_hash_cache(self) -> list:
        return self._unlink(self._hash_cache_path())

    def _unlink(self, path: Path) -> list:
        with self._lock:
            try:
                path.unlink()
            except (FileNotFoundError, OSError):
                return []
        return [path.name]


def _picked_text(value, limit: int) -> str:
    return value if isinstance(value, str) and len(value) <= limit else ""


def _clean_picked(raw) -> dict:
    games = {}
    for key, row in (raw if isinstance(raw, dict) else {}).items():
        if len(games) >= MAX_PICKED_GAMES:
            break
        if not isinstance(key, str) or not key.isdigit() or not isinstance(row, dict):
            continue
        path = _picked_text(row.get("path"), 4096)
        ra_hash = _picked_text(row.get("raHash"), 32).lower()
        system_id = row.get("systemId")
        size, mtime = row.get("size"), row.get("mtimeNs")
        if not path.startswith("/") or "\0" in path or not _PICKED_HASH.match(ra_hash):
            continue
        if type(system_id) is not int or system_id <= 0 or type(size) is not int or type(mtime) is not int:
            continue
        games[key] = {
            "path": path,
            "raHash": ra_hash,
            "label": _picked_text(row.get("label"), 300),
            "systemId": system_id,
            "title": _picked_text(row.get("title"), 300),
            "imageIcon": _picked_text(row.get("imageIcon"), 300),
            "size": size,
            "mtimeNs": mtime,
        }
    return games
