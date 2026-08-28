"""
The Cheevo Check worker: walk a ROM directory, hash everything, and say which
games RetroAchievements doesn't cover.

The approach here — work out the console from the folder, pull RA's hash lists
for the consoles you actually found, hash each file, look the hash up locally —
is the one ra-scan (https://github.com/TheDragonary/RetroAchievements-ROM-Scanner,
GPL-3.0) demonstrated, and it's credited in ATTRIBUTIONS.md. What we took is the
sequence, which is mostly dictated by RAHasher's command line and RA's API in the
first place; none of its code is here, and the systems table below was built from
RAHasher's own `--help` output rather than from theirs. Everything with real
substance in it is ours and mostly exists because ra-scan gets it wrong: batching
with resume-on-abort, zip introspection, one-archive-at-a-time extraction, the
dolphin-tool path for GameCube and Wii containers, and the three-state result
model.

Not a ticking daemon — it doesn't inherit _tick_common. One run per user request,
on its own thread, and the "a scan is running" flag lives in memory rather than on
disk so a reload or a reboot can never leave a stale one behind.
"""

from pathlib import Path

import hashlib
import os
import re
import shutil
import threading
import time
import urllib.error
import zipfile
import zlib

import decky
import cdi_reader
import chd_reader
import cheevo_check_systems as systems
import dat_index
import rom_headers
import subprocess_util
import switch_container

from dolphin_ini import DOLPHIN_FLATPAK_APP_ID
from notifications import emit_notification
from utils import to_int


HASHER_BATCH_SIZE = 24

HASHER_TIMEOUT_SECONDS = 300
DOLPHIN_TIMEOUT_SECONDS = 180
ARCHIVE_LIST_TIMEOUT_SECONDS = 120
ARCHIVE_EXTRACT_TIMEOUT_SECONDS = 1800
FLATPAK_QUERY_TIMEOUT_SECONDS = 30

FETCH_GAP_SECONDS = 1.0
FETCH_BACKOFF_SECONDS = 5.0
FETCH_MAX_RETRY_AFTER_SECONDS = 60.0

FETCH_NETWORK_BACKOFF_SECONDS = (5.0, 15.0, 30.0)
FETCH_ATTEMPTS = len(FETCH_NETWORK_BACKOFF_SECONDS) + 1

SCRATCH_HEADROOM = 1.10

_HASH_RE = re.compile(r"^[0-9a-f]{32}$")

_CUE_EXTENSIONS = (".cue", ".gdi", ".m3u", ".ccd", ".toc")
_TRACK_EXTENSIONS = (".bin", ".img")

FAILED_UNREADABLE = "unreadable"
FAILED_AMBIGUOUS = "ambiguous"
FAILED_NO_SPACE = "no_space"
FAILED_ARCHIVE = "archive"
FAILED_MARKERS = (FAILED_UNREADABLE, FAILED_AMBIGUOUS, FAILED_NO_SPACE, FAILED_ARCHIVE)

PASS_THROUGH = "passthrough"

PEEK_BYTES = 4096

SKIPPED_DOLPHIN = "skip_dolphin"

VERIFY_BUCKETS = (
    "verified",
    "raFull",
    "raPartial",
    "mismatch",
    "unrecognised",
    "unverifiable",
)

VERIFY_READ_FAILED = "read_failed"
VERIFY_CHD_EXTRACT_FAILED = "chd_extract_failed"
VERIFY_CHD_NO_MATCH = "chd_no_match"
VERIFY_TRIMMED = "trimmed"
VERIFY_NO_REFERENCE = "no_reference"
VERIFY_NO_SINGLE_ROM = "no_single_rom"
VERIFY_NO_SPACE = "no_space"
VERIFY_NO_TOOL = "no_tool"
VERIFY_SIGNATURE = "signature"
VERIFY_DISCS_OFF = "discs_off"
VERIFY_CARTS_OFF = "carts_off"
VERIFY_REBUILT = "rebuilt"

DISC_EXTENSIONS = frozenset((
    ".chd", ".rvz", ".wbfs", ".gcz", ".ciso", ".wia", ".nkit", ".iso", ".gcm", ".cdi", ".gdi",
))

CART_IMAGE_EXTENSIONS = frozenset((".3ds", ".cci", ".cxi", ".xci", ".nsp", ".xcz", ".nsz"))

VERIFY_URGENT_REASONS = (VERIFY_READ_FAILED, VERIFY_CHD_EXTRACT_FAILED)

VERIFY_SPEED_FACTORS = {"full": 0.0, "balanced": 1.0, "gentle": 3.0}

VERIFY_CHUNK_BYTES = 4 * 1024 * 1024

VERIFY_TIMEOUT_SECONDS = 600
VERIFY_TIMEOUT_PER_GB = 240

_LOGICAL_SIZE_RE = re.compile(r"^Logical size:\s+([0-9,]+)", re.MULTILINE)

_SIGNATURE_WORDS = ("signed", "signature", "common key", "certificate")

_ARCHIVE_VERIFY_REASONS = {
    FAILED_AMBIGUOUS: VERIFY_NO_SINGLE_ROM,
    FAILED_NO_SPACE: VERIFY_NO_SPACE,
    FAILED_ARCHIVE: VERIFY_READ_FAILED,
}


class Unscannable(Exception):
    """This file sits under a console RA has no sets for. Not an error — the
    walk drops it, the same as a file whose extension we don't recognise."""


ABORT_ROOT_GONE = "root_gone"
ABORT_NO_DATA = "no_data"
ABORT_FETCH_FAILED = "fetch_failed"
ABORT_NO_HASHER = "no_hasher"
ABORT_FAILED = "failed"
ABORT_CANCELLED = "cancelled"

_ABORT_BODIES = {
    ABORT_ROOT_GONE: "The scan stopped: that folder went away. Check the drive or share is still connected.",
    ABORT_FETCH_FAILED: "The scan stopped: we couldn't reach RetroAchievements. Your previous results are unchanged.",
    ABORT_NO_DATA: "There's no saved RetroAchievements data to check against yet. Run a Scan first.",
    ABORT_NO_HASHER: "The hashing tool is missing from this install. Reinstalling CheevoDeck should fix it.",
    None: "The scan stopped before it finished. Your previous results are unchanged.",
}


class CheevoCheckService:
    def __init__(
        self,
        *,
        ra,
        store,
        settings_store,
        notifications_store,
        hasher_path: Path,
        chdman_path: Path,
        dats_dir: Path,
        data_dats_dir: Path,
        scratch_dir: Path,
        ram_scratch_dir: Path,
        user_home: Path,
        debug_logging=None,
    ):
        self._ra = ra
        self._store = store
        self._settings_store = settings_store
        self._notifications = notifications_store
        self._hasher_path = hasher_path
        self._chdman_path = chdman_path
        self._dats_dir = dats_dir
        self._data_dats_dir = data_dats_dir
        self._scratch_dir = scratch_dir
        self._ram_scratch_dir = ram_scratch_dir
        self._user_home = user_home
        self._debug_logging = debug_logging or (lambda: False)

        self._event_loop = None
        self._lock = threading.Lock()
        self._running = False
        self._last_error = None
        self._progress = None
        self._cancel = threading.Event()
        self._dolphin_ready = None
        self._indexes = {}

    def set_event_loop(self, loop) -> None:
        self._event_loop = loop

    def _debug(self, message, *args):
        if self._debug_logging():
            decky.logger.info("cheevocheck: " + message, *args)

    def prepare(self) -> None:
        """Make the binary runnable and clear anything a killed scan left behind.

        The execute bit does not reliably survive packaging (the local deploy
        rsync flattens modes to 0644 outright), so it gets set every load rather
        than assumed.

        Wiping scan-temp here is the backstop for a reboot or a forced reload
        landing mid-extraction, which is the one case that can strand gigabytes.
        The per-archive delete in the scan itself is the primary mechanism.
        """
        for tool in (self._hasher_path, self._chdman_path):
            try:
                if tool.exists():
                    os.chmod(tool, 0o755)
                else:
                    decky.logger.warning("cheevocheck: no %s at %s", tool.name, tool)
            except OSError as exc:
                decky.logger.warning(
                    "cheevocheck: couldn't make %s executable (%s)", tool.name, exc
                )

        for scratch in (self._scratch_dir, self._ram_scratch_dir):
            try:
                if scratch.exists():
                    shutil.rmtree(scratch)
            except OSError as exc:
                decky.logger.warning(
                    "cheevocheck: couldn't clear the scratch directory %s (%s)", scratch, exc
                )

    def status(self) -> dict:
        with self._lock:
            progress = dict(self._progress) if self._progress else None
        return {"running": self._running, "error": self._last_error, "progress": progress}

    def _set_progress(self, phase: str, done: int, total: int) -> None:
        """Where the scan has got to. total 0 means there is no denominator —
        the walk is still discovering how much there is, and the bar says so by
        going indeterminate rather than by guessing."""
        with self._lock:
            self._progress = {"phase": phase, "done": done, "total": total}

    def _advance_progress(self, count: int) -> None:
        with self._lock:
            if self._progress is not None:
                self._progress["done"] += count

    def start(self, *, root: str, offline: bool, web_api_key: str) -> dict:
        target = Path(str(root or "").strip())
        if not target.is_dir():
            return {"ok": False, "error": "bad_root"}
        if not self._hasher_path.exists():
            with self._lock:
                self._last_error = ABORT_NO_HASHER
            return {"ok": False, "error": ABORT_NO_HASHER}
        if not offline and not web_api_key:
            return {"ok": False, "error": "no_credentials"}

        with self._lock:
            if self._running:
                return {"ok": False, "error": "already_running"}
            self._running = True
            self._last_error = None
            self._dolphin_ready = None
            self._cancel.clear()

        thread = threading.Thread(
            target=self._run,
            args=(target, bool(offline), str(web_api_key or "")),
            name="cheevo-check",
            daemon=True,
        )
        thread.start()
        return {"ok": True}

    def cancel(self) -> dict:
        """Ask a running scan to stop. Returns immediately -- the thread
        notices at its next check point, which is somewhere between instant
        and one archive extraction away."""
        with self._lock:
            running = self._running
            if running:
                self._cancel.set()
        decky.logger.info("cheevocheck: cancel requested (running=%s)", running)
        return {"ok": True, "running": running}

    def _run(self, root: Path, offline: bool, web_api_key: str) -> None:
        started = time.monotonic()
        results = None
        verify_results = None
        error = None
        cancelled = False
        try:
            outcome = self._scan(root, offline, web_api_key)
            if isinstance(outcome, str):
                error = outcome
            else:
                results, verify_results = outcome
        except Exception as exc:
            decky.logger.exception("cheevocheck: the scan failed (%s)", type(exc).__name__)
            error = ABORT_FAILED
        finally:
            cancelled = error == ABORT_CANCELLED
            if cancelled:
                error = None
            with self._lock:
                self._running = False
                self._last_error = error
                self._progress = None
        decky.logger.info(
            "cheevocheck: scan %s in %.1fs (offline=%s, error=%s)",
            "cancelled" if cancelled else "finished", time.monotonic() - started, offline, error,
        )
        if not cancelled:
            self._notify(results, verify_results, error)

    def _scan(self, root: Path, offline: bool, web_api_key: str):
        verifying = self._verify_hashes_enabled()
        self._indexes = {}
        walk_started = time.monotonic()
        candidates, verify_only = self._collect(root, verifying)
        self._debug("phase walk: %.1fs for %d candidate(s)", time.monotonic() - walk_started, len(candidates))
        if self._cancel.is_set():
            return ABORT_CANCELLED
        if not candidates:
            return self._empty_results(root, offline), None

        wanted = set()
        for candidate in candidates:
            for system in candidate["systems"]:
                wanted.add(system.console_id)
        asked_for = set(wanted)
        for console_id in list(wanted):
            wanted.update(systems.related_console_ids(console_id))

        if offline:
            data = self._store.load_ra_data()
            if data is None:
                return ABORT_NO_DATA
            stored = data["consoles"]
            missing = sorted(cid for cid in asked_for if str(cid) not in stored)
            candidates = self._drop_unknown_consoles(candidates, stored)
            if not candidates:
                return ABORT_NO_DATA
        else:
            fetch_started = time.monotonic()
            fetched = self._fetch(sorted(wanted), web_api_key)
            self._debug(
                "phase fetch: %.1fs for %d console(s)",
                time.monotonic() - fetch_started, len(wanted),
            )
            if self._cancel.is_set():
                return ABORT_CANCELLED
            if fetched is None:
                return ABORT_FETCH_FAILED
            self._store.save_ra_data(fetched)
            data = self._store.load_ra_data()
            stored = data["consoles"] if data else fetched
            missing = []

        candidates = self._add_console_fallbacks(candidates, stored)

        hash_started = time.monotonic()
        hashed = self._hash_all(root, candidates)
        self._debug("phase hash: %.1fs", time.monotonic() - hash_started)
        if self._cancel.is_set():
            return ABORT_CANCELLED
        if hashed is None:
            return ABORT_ROOT_GONE

        verify_results = None
        if verifying:
            verify_started = time.monotonic()
            rows = self._verify_all(root, hashed, verify_only, stored)
            self._debug("phase verify: %.1fs", time.monotonic() - verify_started)
            if self._cancel.is_set():
                return ABORT_CANCELLED
            if rows is None:
                return ABORT_ROOT_GONE
            verify_results = self._collect_verify(rows, int(time.time()), root)
        self._indexes = {}

        results = self._classify(hashed, stored)
        results.update({
            "root": str(root),
            "offline": bool(offline),
            "completedAt": int(time.time()),
            "dataBuiltAt": to_int((data or {}).get("builtAt", 0), 0),
            "missingConsoles": [
                system.name
                for system in (systems.by_console_id(cid) for cid in missing)
                if system is not None
            ],
        })
        self._store.save_results(results)
        if verify_results is not None:
            self._store.save_verify_results(verify_results)
        return results, verify_results

    def _empty_results(self, root: Path, offline: bool) -> dict:
        summary = self._store.ra_data_summary()
        results = {
            "root": str(root),
            "offline": bool(offline),
            "completedAt": int(time.time()),
            "dataBuiltAt": summary["builtAt"],
            "missingConsoles": [],
            "scanned": 0,
            "supported": 0,
            "supportedGames": [],
            "skippedDolphin": 0,
            "unsupported": [],
            "noAchievements": [],
            "failed": [],
        }
        self._store.save_results(results)
        return results

    def _collect(self, root: Path, verifying: bool = False) -> tuple:
        """Every file worth hashing, with the consoles it might belong to.

        Symlinks are followed, because roughly half a real EmuDeck ROM directory
        is symlinks out to other drives — that's a normal advanced-user layout,
        not an edge case. os.walk(followlinks=True) will happily spin forever on
        a circular link, so this keeps its own visited set of (device, inode)
        pairs instead.

        Returns two lists. The second is empty unless ``verifying``, and holds
        the files under a console the scan has no RA number for and verification
        does — 3DS and Switch. They ride this walk rather than getting one of
        their own, and they never reach the hashing pass.
        """
        found = []
        verify_only = []
        files_seen = 0
        seen_dirs = set()
        try:
            root_stat = root.stat()
        except OSError:
            return found, verify_only
        seen_dirs.add((root_stat.st_dev, root_stat.st_ino))

        pending = [root]
        while pending:
            if self._cancel.is_set():
                break
            current = pending.pop()
            try:
                entries = list(os.scandir(current))
            except OSError:
                continue

            if systems.is_container_dump(entry.name for entry in entries):
                continue

            files = []
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=True):
                        stat = entry.stat()
                        key = (stat.st_dev, stat.st_ino)
                        if key in seen_dirs:
                            continue
                        seen_dirs.add(key)
                        pending.append(Path(entry.path))
                    elif entry.is_file(follow_symlinks=True):
                        files.append(Path(entry.path))
                except OSError:
                    continue

            files_seen += len(files)
            found.extend(self._candidates_in(root, files))
            if verifying:
                verify_only.extend(self._verify_only_in(root, files))
            self._set_progress("walk", files_seen, 0)

        self._debug(
            "collected %d candidate(s) from %d file(s) under %s (%d ignored: junk, "
            "cover art, a console we don't scan, or disc tracks a cue sheet speaks for)",
            len(found), files_seen, root, files_seen - len(found),
        )
        return found, verify_only

    def _verify_only_in(self, root: Path, files: list) -> list:
        """The files under a console only verification has an answer for.

        3DS and Switch are both in UNSUPPORTED_FOLDERS and stay there — the scan
        needs an RA console number for everything it touches and RA has no sets
        for either. Verification is asking a different question, so it gets to
        look. Folder name only, never the extension: .cci and .xci name no
        console on their own, and a folder called n3ds does.
        """
        out = []
        for path in files:
            system = self._verify_only_system(root, path)
            if system is not None and path.suffix.lower() in system.extensions:
                out.append({"path": path, "systems": (system,), "kind": "plain",
                            "system": system, "hash": None})
        return out

    def _verify_only_system(self, root: Path, path: Path):
        current = path.parent
        while True:
            match = systems.verify_only_by_folder_name(current.name)
            if match is not None:
                return match
            if current == root or current.parent == current:
                return None
            current = current.parent

    def _candidates_in(self, root: Path, files: list) -> list:
        """Turn one directory's files into scan candidates.

        The track rule is the interesting part. A disc laid out loose is a cue
        sheet plus its .bin tracks, and only track one hashes to anything — the
        rest would show up as a row of corrupt-looking files that aren't. So when
        a directory holds a cue sheet and more than one track file, the tracks are
        left to the sheet. A single .bin beside its .cue is left alone: both hash
        identically (Silent Hill does exactly this), and the duplicate fold is
        what turns those into one row.
        """
        suffixes = {path: path.suffix.lower() for path in files}
        tracks = [path for path in files if suffixes[path] in _TRACK_EXTENSIONS]
        has_sheet = any(suffixes[path] in _CUE_EXTENSIONS for path in files)
        skip = set(tracks) if has_sheet and len(tracks) > 1 else set()

        out = []
        for path in files:
            if path in skip:
                continue
            suffix = suffixes[path]
            if suffix in systems.EXTRACT_EXTENSIONS:
                kind = "archive"
            elif suffix == systems.ZIP_EXTENSION:
                kind = "zip"
            elif suffix in systems.ROM_EXTENSIONS:
                kind = "plain"
            else:
                continue
            matches = self._systems_for(root, path, kind)
            if matches:
                out.append({"path": path, "systems": matches, "kind": kind})
        return out

    def _systems_for(self, root: Path, path: Path, kind: str) -> tuple:
        """Which console(s) this file could be for, best guess first.

        Folder name wins when there is one, because on a Deck it is nearly always
        right and it is free. Falling back to the extension gives a list rather
        than an answer — a bare .chd could be any of eight consoles — and the
        hashing pass tries each in turn, which costs milliseconds and removes a
        whole class of wrong "unsupported" verdicts.
        """
        try:
            folder = self._system_from_folders(root, path)
        except Unscannable:
            return ()
        if folder is not None:
            return (folder,)

        suffix = path.suffix.lower()
        if kind == "plain":
            return systems.by_extension(suffix)

        inner = self._archive_rom_suffix(path, kind)
        return systems.by_extension(inner) if inner else ()

    def _system_from_folders(self, root: Path, path: Path):
        """The console this file's folders name, or None to fall back to the
        extension. Raises Unscannable when a folder names a console RA doesn't
        support — that's a different answer from "don't know", and guessing by
        extension there is what produces bad-dump verdicts on perfectly good
        CD-i and Commodore discs.
        """
        current = path.parent
        while True:
            if systems.folder_is_unsupported(current.name):
                raise Unscannable
            match = systems.by_folder_name(current.name)
            if match is not None:
                return match
            if current == root or current.parent == current:
                return None
            current = current.parent

    def _archive_rom_suffix(self, path: Path, kind: str):
        try:
            names = self._archive_entries(path, kind)
        except Exception:
            return None
        picked = self._pick_rom_entry(
            [name for name, _ in names], peek=self._archive_peek(path, kind)
        )
        return Path(picked).suffix.lower() if picked else None

    def _fetch(self, console_ids: list, web_api_key: str):
        consoles = {}
        for index, console_id in enumerate(console_ids):
            if self._cancel.is_set():
                return None
            self._set_progress("fetch", index, len(console_ids))
            system = systems.by_console_id(console_id)
            rows = self._fetch_console(console_id, web_api_key)
            if rows is None:
                return None
            games = {}
            hashes = {}
            for row in rows:
                if not isinstance(row, dict):
                    continue
                game_id = to_int(row.get("ID"), 0)
                if game_id <= 0:
                    continue
                games[str(game_id)] = {
                    "title": str(row.get("Title") or ""),
                    "achievements": to_int(row.get("NumAchievements"), 0),
                    "imageIcon": str(row.get("ImageIcon") or ""),
                }
                for raw in row.get("Hashes") or []:
                    digest = str(raw or "").strip().lower()
                    if digest:
                        hashes[digest] = game_id
            consoles[str(console_id)] = {
                "name": system.name if system else str(console_id),
                "games": games,
                "hashes": hashes,
            }
            decky.logger.info(
                "cheevocheck: %s — %d games, %d hashes",
                system.name if system else console_id, len(games), len(hashes),
            )
            if index < len(console_ids) - 1:
                self._cancel.wait(FETCH_GAP_SECONDS)
        return consoles

    def _fetch_console(self, console_id: int, web_api_key: str):
        """One console's game list, with the rate limit handled here.

        This is the only RA caller in the plugin with nothing underneath it — no
        slot, no shared backoff — so a 429 and a dropped connection are both its
        own problem to solve.
        """
        for attempt in range(FETCH_ATTEMPTS):
            last_attempt = attempt == FETCH_ATTEMPTS - 1
            try:
                rows = self._ra.get_game_list_with_hashes(console_id, web_api_key)
            except urllib.error.HTTPError as exc:
                if exc.code != 429 or last_attempt:
                    decky.logger.error(
                        "cheevocheck: console %s fetch failed with HTTP %s", console_id, exc.code
                    )
                    return None
                wait = min(
                    FETCH_MAX_RETRY_AFTER_SECONDS,
                    max(FETCH_BACKOFF_SECONDS, to_int(exc.headers.get("Retry-After"), 0)),
                )
                decky.logger.warning(
                    "cheevocheck: RA asked us to wait %.0fs before console %s", wait, console_id
                )
                if self._cancel.wait(wait):
                    return None
            except OSError as exc:
                if last_attempt:
                    decky.logger.error(
                        "cheevocheck: console %s fetch failed (%s: %s)",
                        console_id, type(exc).__name__, exc,
                    )
                    return None
                wait = FETCH_NETWORK_BACKOFF_SECONDS[attempt]
                decky.logger.warning(
                    "cheevocheck: console %s lost the connection (%s), trying again in %.0fs",
                    console_id, type(exc).__name__, wait,
                )
                if self._cancel.wait(wait):
                    return None
            except Exception as exc:
                decky.logger.error(
                    "cheevocheck: console %s fetch failed (%s: %s)", console_id, type(exc).__name__, exc
                )
                return None
            else:
                return rows if isinstance(rows, list) else []
        return None

    def _drop_unknown_consoles(self, candidates: list, stored: dict) -> list:
        kept = []
        for candidate in candidates:
            usable = tuple(s for s in candidate["systems"] if str(s.console_id) in stored)
            if usable:
                kept.append({**candidate, "systems": usable})
        return kept

    def _add_console_fallbacks(self, candidates: list, stored: dict) -> list:
        """Give every disc a queue of other consoles to try when the confident
        one doesn't recognise it.

        RAHasher is handed one console and gives up the moment the disc isn't
        that console. rcheevos, which is what actually awards the achievements,
        walks every CD format until one identifies the file — so a Neo Geo CD
        game sitting in a saturn folder is unreadable to the first and perfectly
        ordinary to the second. Magical Drop 2 was exactly that, and it reported
        as a bad dump.

        Deliberately limited to consoles this scan already fetched: the retry
        reuses hash lists that are on disk either way, so it costs no API calls
        and the fetch set stays as small as the folder names made it. That
        matters because the fetch pacing is what earns this scan its exemption
        from _ra_slot(). The trade is a misfiled disc whose console appears
        nowhere else in the library, which stays unreadable.

        Only plain files get this. A retry happens solely when a hash *fails*,
        and cartridge hashing is an MD5 of the file that doesn't fail, so in
        practice this reaches nothing but discs.

        Runs for online and offline scans alike, which is why it sits here rather
        than inside _drop_unknown_consoles — that one is the offline branch's
        filter and an online scan never calls it.
        """
        out = []
        for candidate in candidates:
            if candidate["kind"] != "plain":
                out.append(candidate)
                continue
            taken = {system.console_id for system in candidate["systems"]}
            extra = tuple(
                system
                for system in systems.by_extension(candidate["path"].suffix.lower())
                if system.console_id not in taken and str(system.console_id) in stored
            )
            out.append({**candidate, "systems": candidate["systems"] + extra} if extra else candidate)
        return out

    def _hash_all(self, root: Path, candidates: list):
        """Hash every candidate, or None if the scan root went away mid-run.

        Aborting on a lost root is not tidiness. If an SD card is ejected or an
        SMB share drops while a scan is running, every remaining file fails to
        open, and the honest report of that is "the scan stopped" rather than
        several hundred rows telling the user their library is corrupt.
        """
        cache_on = self._cache_hashes_enabled()
        cache = self._store.load_hash_cache() if cache_on else {}
        scanned = []
        pending = []
        cache_hits = 0
        aborted = False
        self._set_progress("hash", 0, len(candidates))

        try:
            for candidate in candidates:
                if self._cancel.is_set() or not root.is_dir():
                    aborted = True
                    return None
                hit = self._cached_hash_any(cache, candidate) if cache_on else None
                if hit is not None:
                    cache_hits += 1
                    system, digest = hit
                    scanned.append({**candidate, "system": system, "hash": digest})
                    self._advance_progress(1)
                    continue
                if candidate["kind"] == "archive":
                    scanned.append(self._hash_archive(candidate, cache if cache_on else None))
                    self._advance_progress(1)
                else:
                    pending.append(candidate)

            batched = self._hash_batched(root, pending, cache if cache_on else None)
            if batched is None:
                aborted = True
                return None
            scanned.extend(batched)

            self._debug(
                "cache %s: %d hit(s), %d miss(es) of %d file(s), %d entries stored",
                "on" if cache_on else "off",
                cache_hits, len(candidates) - cache_hits, len(candidates), len(cache),
            )
            return scanned
        finally:
            if cache_on:
                self._store.save_hash_cache(cache if aborted else self._prune_cache(cache))

    def _hash_batched(self, root: Path, candidates: list, cache):
        """Everything that RAHasher (or dolphin-tool) can take a path to.

        Two passes. The first groups files under their best-guess console and
        hashes them in batches; the second only exists for files whose console
        was a guess in the first place, and re-hashes those under their next
        candidate. Since a hash is milliseconds, trying three consoles for an
        ambiguous .chd is cheaper than being wrong about it once.
        """
        done = []
        remaining = list(candidates)
        depth = 0
        exhausted = []

        while remaining:
            groups = {}
            for candidate in remaining:
                if depth >= len(candidate["systems"]):
                    exhausted.append(candidate)
                    continue
                groups.setdefault(candidate["systems"][depth].console_id, []).append(candidate)

            retry = []
            for console_id, group in groups.items():
                for start in range(0, len(group), HASHER_BATCH_SIZE):
                    batch = group[start:start + HASHER_BATCH_SIZE]
                    if self._cancel.is_set() or not root.is_dir():
                        return None
                    for candidate, digest in self._hash_group(console_id, batch, cache):
                        system = systems.by_console_id(console_id)
                        if digest is None and depth + 1 < len(candidate["systems"]):
                            retry.append(candidate)
                            continue
                        if digest is None:
                            exhausted.append(candidate)
                            continue
                        done.append({**candidate, "system": system, "hash": digest})
                        self._advance_progress(1)
            if retry:
                self._debug(
                    "hash pass depth %d left %d file(s) to try under their next console",
                    depth, len(retry),
                )
            remaining = retry
            depth += 1

        if exhausted:
            self._debug("%d file(s) no console would take; trying recovery", len(exhausted))
        for candidate in exhausted:
            if self._cancel.is_set() or not root.is_dir():
                return None
            done.append(self._recover_disc(candidate, cache))
            self._advance_progress(1)

        return done

    def _hash_group(self, console_id: int, group: list, cache):
        """Yields, rather than returning a list, so the caller can move the
        progress bar as answers arrive. Dolphin files are a subprocess apiece and
        a batch of them is minutes of work; the RAHasher pass at the bottom is
        one call and lands all at once regardless.
        """
        system = systems.by_console_id(console_id)
        direct = []

        for candidate in group:
            if self._cancel.is_set():
                return
            path = candidate["path"]
            suffix = path.suffix.lower()
            if system is not None and system.needs_dolphin and suffix not in systems.RAW_DISC_EXTENSIONS:
                digest = self._dolphin_hash(path)
                if digest is None and not self._dolphin_available():
                    yield (candidate, SKIPPED_DOLPHIN)
                    continue
                self._remember(cache, console_id, path, digest)
                yield (candidate, digest)
                continue
            if candidate["kind"] == "zip":
                prepared = self._prepare_zip(candidate, console_id)
                if prepared != PASS_THROUGH:
                    self._remember(cache, console_id, path, prepared)
                    yield (candidate, prepared)
                    continue
            direct.append(candidate)

        digests = self._run_hasher(console_id, [item["path"] for item in direct])
        for index, candidate in enumerate(direct):
            digest = digests[index]
            self._remember(cache, console_id, candidate["path"], digest)
            yield (candidate, digest)

    def _recover_disc(self, candidate, cache):
        """Last chance for a disc, once every console has turned it down.

        Two containers get one, for opposite reasons: a CHD RAHasher read the
        wrong sector out of, and a .cdi it declined to open at all. Both end the
        same way — the tracks written out plainly for it to read — so both wait
        until here, where the file has no verdict left to lose.
        """
        path = candidate["path"]
        give_up = {**candidate, "system": candidate["systems"][0], "hash": None}
        suffix = path.suffix.lower()
        if suffix == ".chd":
            return self._recover_chd(candidate, cache, give_up)
        if suffix == ".cdi":
            return self._recover_cdi(candidate, cache, give_up)
        return give_up

    def _recover_chd(self, candidate, cache, give_up):
        """A CHD whose boot sector RAHasher looked for in the wrong place.

        Some CHDs declare a pregap their track doesn't actually contain — the
        gap is described in the metadata and simply isn't in the file. RAHasher
        believes the description, skips a couple of hundred sectors that were
        never written, lands past the boot signature and reports the disc as not
        being the console it plainly is. Eight discs in a four thousand file
        library, every one of them a supported game with achievements.

        Handing it the same track as a plain cue+bin drops the declaration and
        the question with it. Only this shape of file gets here, and only after
        every console has already been tried, because writing the track out is
        seconds and tens of megabytes where a console retry is neither.
        """
        path = candidate["path"]
        try:
            with chd_reader.ChdFile(path) as chd:
                track = chd.first_data_track()
                if track is None or not track["pregap"] or track["pregap_in_file"]:
                    return give_up
                return self._hash_recovered_track(chd, track, candidate, cache) or give_up
        except (chd_reader.ChdError, OSError) as exc:
            self._debug("chd recovery declined %s (%s)", path.name, exc)
            return give_up

    def _hash_recovered_track(self, chd, track, candidate, cache):
        """Write the data track out as a cue+bin and hash that instead."""
        path = candidate["path"]
        needed = track["frames"] * chd_reader.USER_DATA_SIZE
        base = self._scratch_base(needed)
        if base is None:
            return {**candidate, "system": candidate["systems"][0], "hash": FAILED_NO_SPACE}

        scratch = base / "chd"
        try:
            self._reset_scratch(scratch)
            image = scratch / "track.bin"
            written = 0
            with open(image, "wb") as out:
                for index in range(track["frames"]):
                    if self._cancel.is_set():
                        return None
                    try:
                        out.write(chd.user_data(track["start"] + index, track["type"]))
                    except chd_reader.ChdError:
                        break
                    written += 1
            if not written:
                return None

            cue = scratch / "track.cue"
            cue.write_text(
                'FILE "track.bin" BINARY\n  TRACK 01 MODE1/2048\n    INDEX 01 00:00:00\n',
                encoding="utf-8",
            )
            complete = written == track["frames"]
            self._debug(
                "chd recovery wrote %d of %d sector(s) from %s", written, track["frames"], path.name
            )

            for system in candidate["systems"]:
                digest = self._run_hasher(system.console_id, [cue])
                digest = digest[0] if digest else None
                if digest is None:
                    continue
                self._remember(cache, system.console_id, path, digest)
                return {**candidate, "system": system, "hash": digest, "partial": not complete}
            return None
        except OSError as exc:
            self._debug("chd recovery couldn't write scratch for %s (%s)", path.name, exc)
            return None
        finally:
            self._remove_scratch(scratch)

    def _recover_cdi(self, candidate, cache, give_up):
        """A DiscJuggler image, which RAHasher will only read as cue+bin.

        Nothing is wrong with these — the container just isn't one the hasher
        opens, so it says "Could not open track" and the disc reads as a dump
        nobody has ever seen. The tracks are all in there uncompressed, so
        writing them back out under a cue answers it. Bare .cdi is one of the
        commoner Dreamcast formats and the whole of the Jaguar CD homebrew
        library ships this way.
        """
        path = candidate["path"]
        try:
            with cdi_reader.CdiFile(path) as cdi:
                return self._hash_recovered_cdi(cdi, candidate, cache) or give_up
        except (cdi_reader.CdiError, OSError) as exc:
            self._debug("cdi recovery declined %s (%s)", path.name, exc)
            return give_up

    def _hash_recovered_cdi(self, cdi, candidate, cache):
        """Lay the whole disc out as a cue and one bin per track, and hash that.

        Every track, not just the one carrying the game: a multisession hash
        reads the second session's first track and counts its way to it, so a
        disc missing its opening audio track is a disc with the wrong track
        numbers. That makes the scratch cost the size of the image.
        """
        path = candidate["path"]
        base = self._scratch_base(cdi.emit_size())
        if base is None:
            return {**candidate, "system": candidate["systems"][0], "hash": FAILED_NO_SPACE}

        scratch = base / "cdi"
        try:
            self._reset_scratch(scratch)
            cue = self._write_cdi_cue(cdi, scratch)
            if cue is None:
                return None
            for system in candidate["systems"]:
                digest = self._run_hasher(system.console_id, [cue])
                digest = digest[0] if digest else None
                if digest is None:
                    continue
                self._remember(cache, system.console_id, path, digest)
                return {**candidate, "system": system, "hash": digest}
            return None
        except (cdi_reader.CdiError, OSError) as exc:
            self._debug("cdi recovery couldn't write scratch for %s (%s)", path.name, exc)
            return None
        finally:
            self._remove_scratch(scratch)

    def _write_cdi_cue(self, cdi, scratch: Path):
        """One bin per track plus the cue over them, or None if we were stopped.

        Every track lands on the disc address the descriptor gives it, and the
        gaps between them are written out as silence. That padding is the whole
        reason this works on a Dreamcast disc: the filesystem inside the data
        track addresses itself in absolute sectors, so a track sitting at 452
        because that's where stacking the files put it sends the hasher looking
        for a boot executable eleven thousand sectors short of where it is.
        Jaguar CD reads the top of a track and doesn't care either way.

        Track files are numbered rather than named after the image, because the
        name would have to survive being quoted into a cue sheet and half this
        library is called things like "Alice's Mom's Rescue (World)".
        """
        lines = []
        session = 0
        for track in cdi.tracks():
            if self._cancel.is_set():
                return None
            first_of_session = track["session"] != session
            if first_of_session:
                session = track["session"]
                lines.append(f"REM SESSION {session:02d}")

            skip = track["pregap"]
            if first_of_session and session > 1:
                skip = cdi.content_start(track)

            name = f"track{track['number']:02d}.bin"
            with open(scratch / name, "wb") as out:
                written = cdi.copy_track(track, out, skip_sectors=skip, cancel=self._cancel)
                if self._cancel.is_set():
                    return None
                silence = cdi.gap_after(track) - written
                if silence > 0:
                    out.write(bytes(silence * track["sector_size"]))

            kind = cdi_reader.TRACK_MODES[track["mode"]]
            if track["mode"]:
                kind = f"{kind}/{track['sector_size']}"
            lines.append(f'FILE "{name}" BINARY')
            lines.append(f"  TRACK {track['number']:02d} {kind}")
            lines.append("    INDEX 01 00:00:00")

        cue = scratch / "disc.cue"
        cue.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return cue

    def _run_hasher(self, console_id: int, paths: list) -> list:
        """Hash a list of files, returning one entry per input in the same order.

        Two behaviours drive the shape of this. The output columns change with
        the argument count — one file prints a bare hash with no filename, two or
        more print "<hash> <filename>" — and a file RAHasher can't open aborts
        everything after it in the same invocation, silently. So the batch is
        re-issued from just past the failure point until the list is exhausted,
        and the file at that point is recorded as unreadable. A naive
        implementation loses the tail of every batch containing one bad file and
        reports those ROMs as never scanned.
        """
        digests = []
        remaining = list(paths)
        while remaining:
            if "\n" in remaining[0].name:
                chunk = remaining[:1]
            else:
                chunk = []
                for path in remaining[:HASHER_BATCH_SIZE]:
                    if "\n" in path.name:
                        break
                    chunk.append(path)

            lines = self._invoke_hasher(console_id, chunk)
            if not lines:
                digests.append(None)
                remaining = remaining[1:]
                continue

            consumed = min(len(lines), len(chunk))
            single = len(chunk) == 1
            for line in lines[:consumed]:
                digest = (line.strip() if single else line.split(" ", 1)[0]).lower()
                digests.append(digest if _HASH_RE.match(digest) else None)
            remaining = remaining[consumed:]

        return digests

    def _invoke_hasher(self, console_id: int, paths: list) -> list:
        if not paths:
            return []
        argv = [str(self._hasher_path), str(console_id), *[str(path) for path in paths]]
        started = time.monotonic()
        _, out, err = subprocess_util.run_command(argv, timeout=HASHER_TIMEOUT_SECONDS)
        elapsed = time.monotonic() - started
        if subprocess_util.TIMEOUT_MARKER in err:
            decky.logger.warning(
                "cheevocheck: hasher timed out after %ds on a batch of %d under console %s",
                HASHER_TIMEOUT_SECONDS, len(paths), console_id,
            )
        elif err.strip():
            self._debug("hasher stderr: %s", err.strip().splitlines()[0])
        self._debug("hasher batch: %d file(s) under console %s in %.1fs", len(paths), console_id, elapsed)
        return out.splitlines()

    def _prepare_zip(self, candidate, console_id: int):
        """Deal with a zip before RAHasher gets a chance to be confident about it.

        Handed a zip with more than one entry, RAHasher prints a note to stderr
        and then hashes the *whole zip* with rc=0 — a plausible hash, no error,
        wrong answer. Wrecking Crew '98 ships with a CDRomance.url next to the
        .sfc and reports as unsupported because of it, which is the feature
        producing exactly the wrong verdict for exactly its purpose.

        A single-entry zip goes straight through: RAHasher reads it natively and
        hashes it identically to the raw ROM, and that's faster than unpacking it.
        Anything else answers here, including the failures — falling back to
        handing the zip over is precisely the mistake this exists to stop.
        """
        path = candidate["path"]
        try:
            with zipfile.ZipFile(path) as archive:
                entries = [
                    (item.filename, item.file_size)
                    for item in archive.infolist() if not item.is_dir()
                ]
        except Exception:
            return FAILED_UNREADABLE

        if len(entries) <= 1:
            return PASS_THROUGH

        picked = self._pick_rom_entry(
            [name for name, _ in entries], console_id, self._archive_peek(path, "zip")
        )
        if picked is None:
            return FAILED_AMBIGUOUS

        needed = next(size for name, size in entries if name == picked)
        base = self._scratch_base(needed)
        if base is None:
            return FAILED_NO_SPACE

        scratch = base / "zip"
        try:
            self._reset_scratch(scratch)
            with zipfile.ZipFile(path) as archive:
                extracted = Path(archive.extract(picked, path=str(scratch)))
            digests = self._run_hasher(console_id, [extracted])
            return digests[0] if digests and digests[0] else FAILED_UNREADABLE
        except OSError:
            return FAILED_UNREADABLE
        finally:
            self._remove_scratch(scratch)

    def _hash_archive(self, candidate, cache):
        """Extract one .7z or .rar, hash what's inside it, and delete it again.

        One archive on disk at a time, always. A user with a nearly-full drive is
        exactly who this has to work for, so peak scratch usage is one archive's
        uncompressed size rather than the library's — which rules out expanding
        several and hashing them together.
        """
        path = candidate["path"]
        system = candidate["systems"][0]
        result = {**candidate, "system": system, "hash": None}

        try:
            entries = self._archive_entries(path, candidate["kind"])
        except Exception:
            result["hash"] = FAILED_ARCHIVE
            return result

        needed = sum(size for _, size in entries)
        base = self._scratch_base(needed)
        if base is None:
            result["hash"] = FAILED_NO_SPACE
            return result
        scratch = base / "archive"

        picked = self._pick_rom_entry([name for name, _ in entries], system.console_id)
        if picked is None:
            result["hash"] = FAILED_AMBIGUOUS
            return result

        try:
            self._reset_scratch(scratch)
            extract_started = time.monotonic()
            code, _, err = subprocess_util.run_command(
                ["7z", "x", "-y", f"-o{scratch}", str(path)],
                timeout=ARCHIVE_EXTRACT_TIMEOUT_SECONDS,
                cancel=self._cancel,
            )
            self._debug(
                "archive %s: extracted in %.1fs", path.name, time.monotonic() - extract_started
            )
            if subprocess_util.TIMEOUT_MARKER in err:
                decky.logger.warning(
                    "cheevocheck: extracting %s timed out after %ds",
                    path.name, ARCHIVE_EXTRACT_TIMEOUT_SECONDS,
                )
            if code != 0:
                self._debug("7z x failed for %s: %s", path.name, err.strip()[:200])
                result["hash"] = FAILED_ARCHIVE
                return result
            digests = self._run_hasher(system.console_id, [scratch / picked])
            result["hash"] = digests[0] if digests else None
            self._remember(cache, system.console_id, path, result["hash"])
            try:
                self._verify_extracted(result, scratch / picked, picked)
            except Exception as exc:
                self._debug("verification of %s failed (%s)", path.name, exc)
                result["verifyReason"] = VERIFY_READ_FAILED
            return result
        except OSError:
            result["hash"] = FAILED_ARCHIVE
            return result
        finally:
            self._remove_scratch(scratch)

    def _verify_extracted(self, result: dict, extracted: Path, entry_name: str) -> None:
        """Record the CRC of an archive's ROM while it is still unpacked.

        The verdict is about the inner ROM, exactly as it is for a zip, so an
        archive and a loose copy of the same game land in the same bucket for the
        same reason instead of one judging a container and the other its
        contents.
        """
        if not self._verify_hashes_enabled():
            return
        crc = self._file_crc(extracted, self._verify_speed())
        if crc is None:
            result["verifyReason"] = VERIFY_READ_FAILED
            return
        try:
            size = extracted.stat().st_size
        except OSError:
            result["verifyReason"] = VERIFY_READ_FAILED
            return
        result["verifyCrc"] = crc
        result["verifyName"] = Path(entry_name).name
        result["verifySize"] = size

    def _archive_entries(self, path: Path, kind: str) -> list:
        """(name, uncompressed size) for everything in an archive.

        Reads headers only, so the size check below costs nothing next to the
        extraction it's deciding about.
        """
        if kind == "zip":
            with zipfile.ZipFile(path) as archive:
                return [(item.filename, item.file_size) for item in archive.infolist() if not item.is_dir()]

        code, out, _ = subprocess_util.run_command(
            ["7z", "l", "-slt", str(path)], timeout=ARCHIVE_LIST_TIMEOUT_SECONDS
        )
        if code != 0:
            raise OSError(f"7z couldn't list {path.name}")

        entries = []
        name = None
        size = 0
        directory = False
        for line in out.splitlines():
            if line.startswith("Path = "):
                if name is not None and not directory:
                    entries.append((name, size))
                name, size, directory = line[7:], 0, False
            elif line.startswith("Size = "):
                size = to_int(line[7:].strip(), 0)
            elif line.startswith("Attributes = ") and line[13:].lstrip().startswith("D"):
                directory = True
        if name is not None and not directory:
            entries.append((name, size))
        return entries[1:] if entries else []

    def _pick_rom_entry(self, names: list, console_id=None, peek=None):
        """Which entry in an archive is the game, or None if it's a coin toss.

        Archive-site junk (.url, .txt, .nfo) is ignored rather than treated as a
        reason to skip the archive. A cue sheet wins outright when there is one,
        since a multi-track disc is several ROM-shaped files that are all one game.

        console_id is the console we're hashing under, and it's absent on the one
        path that calls this to *work out* the console — nothing to tie-break
        with there, so that caller keeps the conservative answer.
        """
        roms = [name for name in names if Path(name).suffix.lower() in systems.ROM_EXTENSIONS]
        sheets = [name for name in roms if Path(name).suffix.lower() in _CUE_EXTENSIONS]
        if len(sheets) == 1:
            return sheets[0]
        if len(roms) == 1:
            return roms[0]
        if roms:
            listed = self._playlist_first_disk(names, roms, peek)
            if listed is not None:
                return listed
            system = systems.by_console_id(console_id) if console_id is not None else None
            if system is not None:
                mine = [name for name in roms if Path(name).suffix.lower() in system.extensions]
                if len(mine) == 1:
                    return mine[0]
                if len(mine) > 1 and peek is not None:
                    roms_by_content = [name for name in mine if _looks_like_a_rom(peek(name))]
                    if len(roms_by_content) == 1:
                        return roms_by_content[0]
            return None

        rest = [name for name in names if Path(name).suffix.lower() not in systems.JUNK_EXTENSIONS]
        return rest[0] if len(rest) == 1 else None

    def _playlist_first_disk(self, names: list, roms: list, peek):
        """The first disk a playlist inside an archive names, or None.

        A multi-disk game packed into one archive is several ROM-shaped files
        with nothing to choose between them, and the playlist sitting alongside
        is the only thing that says which one is disk 1. Reading it turned 51 of
        141 Apple II archives from files that resolved to no console at all —
        dropped during the walk, absent from every bucket, not even counted as
        unscannable — into the supported games they are.

        Only inside an archive. A folder of loose disks is better off with the
        playlist ignored, which is what happens there: each disk hashes on its
        own and the results dedupe to one game, so the set is still found when
        disk 1 is the one nobody kept.
        """
        playlists = [name for name in names if Path(name).suffix.lower() == ".m3u"]
        if len(playlists) != 1 or peek is None:
            return None
        try:
            text = peek(playlists[0]).decode("utf-8", "replace")
        except Exception:
            return None

        by_base = {_archive_basename(name): name for name in roms}
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            match = by_base.get(_archive_basename(line))
            if match is not None:
                return match

        suffixes = {Path(name).suffix.lower() for name in roms}
        if len(suffixes) == 1:
            return sorted(roms)[0]
        return None

    def _archive_peek(self, path: Path, kind: str):
        """A reader for one entry, for the callers that have to look inside
        before deciding anything.

        Zip only. 7z has to spawn a process per entry, and the walk asks this of
        every archive in the library — a cost worth paying for a disc image is
        not one worth paying to find out which disk of a set comes first. Disc
        images are what .7z gets used for anyway; the multi-disk archives that
        need this are zips.
        """
        if kind != "zip":
            return None

        def peek(name):
            try:
                with zipfile.ZipFile(path) as archive:
                    with archive.open(name) as member:
                        return member.read(PEEK_BYTES)
            except Exception:
                return b""
        return peek

    def _scratch_base(self, needed: int):
        """Where an extraction of this size should go, or None if nowhere fits.

        RAM only when the user asked for it and the thing genuinely fits, and
        the fallback to disk is the entire reason this isn't a plain path swap.
        A disc image inside an archive is gigabytes — a zipped PS2 ISO is 4.7,
        a .7z of a dual-layer Wii disc more — and tmpfs is system memory, so
        the toggle must never be able to turn a game that scans fine into a
        "not enough free space" row.
        """
        if self._extract_to_ram_enabled() and self._has_room_in(self._ram_scratch_dir, needed):
            return self._ram_scratch_dir
        if self._has_room_in(self._scratch_dir, needed):
            return self._scratch_dir
        return None

    def _has_room_in(self, base: Path, needed: int) -> bool:
        try:
            base.mkdir(parents=True, exist_ok=True)
            return shutil.disk_usage(base).free > needed * SCRATCH_HEADROOM
        except OSError:
            return False

    def _reset_scratch(self, scratch: Path) -> None:
        self._remove_scratch(scratch)
        scratch.mkdir(parents=True, exist_ok=True)

    def _remove_scratch(self, scratch: Path) -> None:
        try:
            shutil.rmtree(scratch)
        except (FileNotFoundError, OSError):
            pass

    def _dolphin_available(self) -> bool:
        if self._dolphin_ready is not None:
            return self._dolphin_ready

        marker = self._user_home / ".var" / "app" / DOLPHIN_FLATPAK_APP_ID
        if marker.exists():
            self._dolphin_ready = True
            return True

        code, out, _ = subprocess_util.run_command(
            ["flatpak", "info", "--show-location", DOLPHIN_FLATPAK_APP_ID],
            timeout=FLATPAK_QUERY_TIMEOUT_SECONDS,
            env=self._deck_env(),
            user="deck",
            group="deck",
        )
        self._dolphin_ready = code == 0 and bool(out.strip())
        return self._dolphin_ready

    def _deck_env(self) -> dict:
        """The environment flatpak needs to find a --user install as the deck user.

        A replacement rather than system_env() with additions, which is what keeps
        PyInstaller's LD_LIBRARY_PATH out by construction instead of by scrubbing.
        Every variable here is load-bearing: drop HOME or XDG_DATA_HOME and
        flatpak looks in root's installation, finds nothing, and the failure reads
        exactly like "Dolphin isn't installed".
        """
        return {
            "HOME": "/home/deck",
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "XDG_RUNTIME_DIR": "/run/user/1000",
            "XDG_DATA_HOME": "/home/deck/.local/share",
        }

    def _dolphin_hash(self, path: Path):
        """Hash a GameCube or Wii image through Dolphin's own tool.

        RAHasher handles raw discs and nothing else — no .rvz, .wbfs, .gcz, .wia
        or .nkit — and those are precisely how GC and Wii libraries are stored,
        because a raw ISO is 4.7 GB. dolphin-tool reads every format Dolphin
        reads, so one path covers the lot instead of a per-extension routing table
        that would need updating whenever a new container appears.

        It has to go through `flatpak run`: the flatpak's own binary won't exec
        directly, and its path embeds a commit hash that changes on every Dolphin
        update, so it must never be hardcoded.
        """
        if not self._dolphin_available():
            return None
        code, out, _ = subprocess_util.run_command(
            [
                "flatpak", "run", "--command=dolphin-tool", DOLPHIN_FLATPAK_APP_ID,
                "verify", "-a", "rchash", "-i", str(path),
            ],
            timeout=DOLPHIN_TIMEOUT_SECONDS,
            env=self._deck_env(),
            user="deck",
            group="deck",
        )
        if code != 0:
            return None
        for line in out.splitlines():
            digest = line.strip().lower()
            if _HASH_RE.match(digest):
                return digest
        return None

    def _cache_hashes_enabled(self) -> bool:
        try:
            return self._settings_store.get_cheevo_check_cache_hashes(
                self._settings_store.load_config()
            )
        except Exception:
            return True

    def _extract_to_ram_enabled(self) -> bool:
        try:
            return self._settings_store.get_cheevo_check_extract_to_ram(
                self._settings_store.load_config()
            )
        except Exception:
            return False

    def _cache_key(self, console_id: int, path: Path) -> str:
        return f"{console_id}|{os.path.realpath(path)}"

    def _cached_hash_any(self, cache: dict, candidate: dict):
        """The stored hash for this file, under whichever console produced it.

        A file whose folder didn't name its console carries several candidates,
        and the hashing pass keeps whichever one actually matched — which is
        often not the first. Looking up only systems[0] meant those hashes were
        written under a key nothing ever read back, so an ambiguous .chd paid
        full price on every scan for the life of the cache.

        Walked in candidate order, the same order the hashing pass tries, so the
        console this returns is the one that pass would have arrived at anyway.
        """
        path = candidate["path"]
        for system in candidate["systems"]:
            digest = self._cached_hash(cache, self._cache_key(system.console_id, path), path)
            if digest is not None:
                return system, digest
        return None

    def _cached_hash(self, cache: dict, key: str, path: Path):
        entry = cache.get(key)
        if not isinstance(entry, dict):
            return None
        try:
            stat = path.stat()
        except OSError:
            return None
        if entry.get("size") != stat.st_size or entry.get("mtime") != stat.st_mtime_ns:
            return None
        digest = entry.get("hash")
        return digest if isinstance(digest, str) and _HASH_RE.match(digest) else None

    def _remember(self, cache, console_id: int, path: Path, digest) -> None:
        if cache is None or not isinstance(digest, str) or not _HASH_RE.match(digest):
            return
        try:
            stat = path.stat()
        except OSError:
            return
        cache[self._cache_key(console_id, path)] = {
            "size": stat.st_size,
            "mtime": stat.st_mtime_ns,
            "hash": digest,
        }

    def _prune_cache(self, cache: dict) -> dict:
        return {
            key: entry
            for key, entry in cache.items()
            if os.path.exists(key.split("|", 1)[-1])
        }

    def _console_for_hash(self, digest: str, item, stored: dict):
        """Which other fetched console claims this hash, if exactly one does.

        Candidate consoles first, since those are the ones the file's extension
        or folder already suggested, then everything else the scan fetched. Two
        consoles claiming the same hash means a game RA lists under both, and
        picking one on a coin toss would put it under a system the user doesn't
        even have a folder for — so that case is left alone.
        """
        ordered = [s.console_id for s in item["systems"]]
        ordered += [int(key) for key in stored if key.isdigit() and int(key) not in ordered]

        hits = []
        for console_id in ordered:
            console = stored.get(str(console_id)) or {}
            game_id = (console.get("hashes") or {}).get(digest)
            if game_id is not None:
                hits.append((console_id, console, game_id))
        if len(hits) != 1:
            return None

        console_id, console, game_id = hits[0]
        system = systems.by_console_id(console_id)
        if system is None:
            return None
        self._debug(
            "%s hashed under the wrong console; %s claims it",
            item["path"].name, system.name,
        )
        return system, console, game_id

    def _inner_rom_name(self, item):
        """The ROM inside an archive, when it isn't called what the archive is.

        Answered here rather than carried out of the hashing pass on purpose:
        _prepare_zip only runs on a cache miss, so a second scan would have left
        this blank on every file the first one had already hashed. A central
        directory read is the same handful of milliseconds either way — 506 NES
        zips came out in 0.62 seconds — and it gives the same answer every run.

        .7z and .rar are in here too. They used to be skipped outright, which is
        why a 7z named one thing and holding another never reached Archive Name
        Mismatches however plainly it qualified. Listing one costs a `7z l`
        subprocess where a zip costs a header read, so this is dearer than it
        looks on a cached re-scan where nothing else opens the archive at all —
        but .7z is what disc images get packed in, so a library holds dozens of
        them rather than the thousands it holds of zips.

        None when there is nothing to say, which is the ordinary case: a loose
        ROM, or an archive whose entry is named after it.

        The comparison goes through the catalogue's own normaliser rather than
        matching the stems literally, because a great many archives differ from
        what they hold only in punctuation — "Arkistas Ring.zip" holding
        "Arkista's Ring.nes" is a filesystem being careful, not a finding. On
        one library that distinction is the difference between 329 rows and the
        handful anyone would want to read.

        The entry is picked with the same console and the same peek the hashing
        pass used, which it wasn't before: calling _pick_rom_entry bare meant
        every tie it can only break with those came back None here while the
        hasher resolved it fine. A translation patch shipping a README.md beside
        its ROM is the documented case — .md is Mega Drive, so the archive reads
        as two games — and those simply went missing from this list. It can only
        find entries the bare call missed; nothing it already answered changes.
        """
        kind = item.get("kind")
        if kind not in ("zip", "archive"):
            return None
        path = item["path"]
        try:
            names = [name for name, _ in self._archive_entries(path, kind)]
        except Exception:
            return None
        if not names:
            return None
        system = item.get("system") or item["systems"][0]
        picked = names[0] if len(names) == 1 else self._pick_rom_entry(
            names, system.console_id, self._archive_peek(path, kind)
        )
        if picked is None:
            return None
        inner = Path(picked).name
        if dat_index.norm_full(dat_index.file_stem(inner)) == dat_index.norm_full(path.stem):
            return None
        return inner

    def _classify(self, scanned: list, stored: dict) -> dict:
        unsupported = []
        no_achievements = []
        failed = []
        supported = {}
        contributors = {}
        skipped_dolphin = 0
        seen = set()

        for item in scanned:
            system = item["system"] or item["systems"][0]
            digest = item["hash"]
            row = {
                "system": system.name,
                "systemId": system.console_id,
                "file": item["path"].name,
                "path": str(item["path"]),
            }
            inner = self._inner_rom_name(item)
            if inner:
                row["innerName"] = inner
            if isinstance(digest, str) and digest not in FAILED_MARKERS and digest != SKIPPED_DOLPHIN:
                row["raHash"] = digest

            if digest == SKIPPED_DOLPHIN:
                skipped_dolphin += 1
                continue
            if digest is None:
                failed.append({**row, "reason": FAILED_UNREADABLE})
                continue
            if digest in FAILED_MARKERS:
                failed.append({**row, "reason": digest})
                continue

            console = stored.get(str(system.console_id)) or {}
            game_id = (console.get("hashes") or {}).get(digest)
            if game_id is None:
                found = self._console_for_hash(digest, item, stored)
                if found is not None:
                    system, console, game_id = found
                    row["system"] = system.name
                    row["systemId"] = system.console_id
            if game_id is None:
                if item.get("partial"):
                    failed.append({**row, "reason": FAILED_UNREADABLE})
                    continue
                if (system.console_id, digest) in seen:
                    continue
                seen.add((system.console_id, digest))
                unsupported.append(row)
                continue

            game = (console.get("games") or {}).get(str(game_id)) or {}
            if to_int(game.get("achievements"), 0) > 0:
                supported[(system.console_id, game_id)] = {
                    "system": system.name,
                    "systemId": system.console_id,
                    "gameId": game_id,
                    "title": str(game.get("title") or ""),
                    "achievements": to_int(game.get("achievements"), 0),
                    "imageIcon": str(game.get("imageIcon") or ""),
                }
                contributors.setdefault((system.console_id, game_id), []).append(row)
                continue
            if (system.console_id, game_id) in seen:
                continue
            seen.add((system.console_id, game_id))
            no_achievements.append({
                **row,
                "gameId": game_id,
                "title": str(game.get("title") or ""),
                "imageIcon": str(game.get("imageIcon") or ""),
            })

        for key, rows in contributors.items():
            if len(rows) > 1 or any(r.get("innerName") for r in rows):
                supported[key]["files"] = rows

        return {
            "scanned": len(scanned),
            "supported": len(supported),
            "supportedGames": sorted(
                supported.values(), key=lambda r: (r["system"], r["title"].lower())
            ),
            "skippedDolphin": skipped_dolphin,
            "unsupported": sorted(unsupported, key=lambda r: (r["system"], r["file"].lower())),
            "noAchievements": sorted(no_achievements, key=lambda r: (r["system"], r["title"].lower())),
            "failed": sorted(failed, key=lambda r: (r["system"], r["file"].lower())),
        }

    def _verify_hashes_enabled(self) -> bool:
        try:
            return self._settings_store.get_cheevo_check_verify_hashes(
                self._settings_store.load_config()
            )
        except Exception:
            return False

    def _skip_disc_verify_enabled(self) -> bool:
        try:
            return self._settings_store.get_cheevo_check_skip_disc_verify(
                self._settings_store.load_config()
            )
        except Exception:
            return False

    def _skip_cart_verify_enabled(self) -> bool:
        try:
            return self._settings_store.get_cheevo_check_skip_cart_verify(
                self._settings_store.load_config()
            )
        except Exception:
            return False

    def _verify_speed(self) -> float:
        try:
            setting = self._settings_store.get_cheevo_check_verify_speed(
                self._settings_store.load_config()
            )
        except Exception:
            setting = "gentle"
        return VERIFY_SPEED_FACTORS.get(setting, VERIFY_SPEED_FACTORS["gentle"])

    def _indexes_for(self, system):
        """This system's catalogue first, then the ones its folder gets confused with.

        Same problem _console_for_hash solves for RetroAchievements, and it needs
        solving twice because the two lookups are separate: `dolphin` is a folder
        name for both GameCube and Wii, EmuDeck files DSi games under nds/, and
        people put Game Boy games in gbc/ on purpose. Both halves of the pair
        measured here — Animal Crossing (USA) sitting in wii/ and Animal Crossing
        City Folk sitting in gc/ — matched the *other* console's catalogue
        exactly and read as unrecognised dumps until this went in.

        Deliberately limited to the pairs the systems table already names rather
        than searching every catalogue. A bare "does this CRC exist anywhere"
        lookup attributes files to whichever system happens to own an identical
        hash, and disc systems really do share content — the investigation found
        one game's audio tracks matching another game's entry outright.
        """
        found = []
        for console_id in (system.console_id, *systems.related_console_ids(system.console_id)):
            related = systems.by_console_id(console_id) if console_id != system.console_id else system
            index = self._index_for(related) if related is not None else None
            if index is not None:
                found.append(index)
        return found

    def _index_for(self, system):
        """This system's catalogue, loaded once per scan and kept."""
        key = system.dat_key
        if not key:
            return None
        if key not in self._indexes:
            index = dat_index.load(
                key, bundled_dir=self._dats_dir, data_dir=self._data_dats_dir
            )
            self._indexes[key] = index
            if index is None:
                decky.logger.warning(
                    "cheevocheck: no usable reference catalogue for %s (%s)", system.name, key
                )
            else:
                self._debug("catalogue %s: %d entries", key, len(index))
        return self._indexes[key]

    def _verify_all(self, root: Path, scanned: list, verify_only: list, stored: dict):
        """Check every file against the published catalogues.

        Deduplicated on realpath before anything else. _collect follows symlinks
        deliberately, and a Deck library routinely has gamecube/ pointing at gc/
        pointing at another drive — without this the GameCube library is verified
        twice, at roughly fifty minutes a pass.

        Sorted smallest-first, which is the cheap half of making the progress bar
        honest. Verification is not uniform per file the way hashing is: a zip's
        CRC comes out of the central directory in microseconds and a 2 GB CHD
        takes over a minute. Ordering by size makes the bar start fast and slow
        down, which reads as progress, where the other order reads as a hang.
        """
        seen_paths = set()
        items = []
        for item in list(scanned) + list(verify_only):
            try:
                key = os.path.realpath(item["path"])
            except OSError:
                key = str(item["path"])
            if key in seen_paths:
                continue
            seen_paths.add(key)
            items.append(item)

        def size_of(item):
            try:
                return item["path"].stat().st_size
            except OSError:
                return 0

        items.sort(key=size_of)
        self._set_progress("verify", 0, len(items))

        rows = []
        for item in items:
            if self._cancel.is_set() or not root.is_dir():
                return None
            rows.append(self._verify_one(item, stored))
            self._advance_progress(1)
        return rows

    def _verify_one(self, item, stored: dict) -> dict:
        """One file's verdict, as a row the page can show.

        The order of the rules is the whole feature and §5.3 of the recipe spells
        out why. Rule 2 — same name, same exact size, different contents — runs
        BEFORE RetroAchievements recognition, not after. Get that backwards and
        the best findings in a real library vanish silently into the RA bucket:
        two DS ROMs that pass RA's check while differing from both No-Intro and
        the owner's own known-good copies simply stop appearing, with no error
        anywhere.

        Trimming answers below RA recognition, not above it. An earlier build had
        that the other way round on the strength of one line in §4.4, and it put
        ten of one library's seventeen trimmed DS cards — RA-recognised, one of
        them the patched build RA distributes itself — into Can't Verify. The
        trimming is still reported; it rides the row and the note leads with it.
        """
        path = item["path"]
        system = item.get("system") or item["systems"][0]
        try:
            size = path.stat().st_size
        except OSError:
            size = 0

        row = {
            "system": system.name,
            "systemId": system.console_id,
            "file": path.name,
            "path": str(path),
            "size": size,
        }

        recognised = self._ra_recognises(item, system, stored)
        row["raRecognised"] = recognised

        indexes = self._indexes_for(system)
        if not indexes:
            if recognised:
                return self._ra_row(row, system)
            if system.self_check == "switch":
                return self._switch_row(item, row)
            return self._unverifiable(row, VERIFY_NO_REFERENCE)

        computed = self._verify_read(item, system, row)
        if isinstance(computed, str):
            if recognised:
                return self._ra_row(row, system, reason=computed)
            return self._unverifiable(row, computed)

        crc, name, inner_size = computed
        row["crc"] = crc

        for index in indexes:
            entry = index.by_crc(crc)
            if entry is not None:
                row["matchedName"] = entry.name
                row["trackOnly"] = bool(entry.track_only)
                return {**row, "bucket": "verified"}

        if recognised:
            for index in indexes:
                claimed = index.claims(name, inner_size)
                if claimed is not None:
                    row["matchedName"] = claimed.name
                    row["datCrc"] = claimed.crc
                    break
            return self._ra_row(row, system, inner_size=inner_size)

        for index in indexes:
            claimed = index.claims(name, inner_size)
            if claimed is not None:
                row["matchedName"] = claimed.name
                row["datCrc"] = claimed.crc
                return {**row, "bucket": "mismatch"}

        if row.get("trimmed"):
            return self._unverifiable(row, VERIFY_TRIMMED)

        for index in indexes:
            shrunk = index.rebuilt(name, inner_size)
            if shrunk is not None:
                row["matchedName"] = shrunk.name
                row["datSize"] = shrunk.size
                return self._unverifiable(row, VERIFY_REBUILT)

        if row.get("signatureProblem"):
            return self._unverifiable(row, VERIFY_SIGNATURE)
        if item["path"].suffix.lower() == ".chd":
            return self._unverifiable(row, VERIFY_CHD_NO_MATCH)

        return {**row, "bucket": "unrecognised"}

    def _unverifiable(self, row: dict, reason: str) -> dict:
        return {**row, "bucket": "unverifiable", "reason": reason}

    def _switch_row(self, item, row: dict) -> dict:
        """A Switch dump's verdict, from its own checksums.

        Gated by the cart toggle like every other big cart image, and read here
        rather than in _verify_read because a system with no catalogue never
        reaches that function — the toggle would have had no effect on the one
        library where it matters most.

        A pass is Verified. It is not a catalogue match and the row says so, but
        it is the strongest statement anyone can make about a Switch file: every
        content byte hashes to the name Nintendo's own packaging gave it.

        A failure is a mismatch in the most literal sense the feature has — the
        NCA's name *is* its hash, so content that hashes differently does not
        match its name.
        """
        path = item["path"]
        if path.suffix.lower() in CART_IMAGE_EXTENSIONS and self._skip_cart_verify_enabled():
            return self._unverifiable(row, VERIFY_CARTS_OFF)

        outcome = self._verify_switch(path, row, self._verify_speed())
        if isinstance(outcome, str):
            return self._unverifiable(row, outcome)
        if outcome:
            return {**row, "bucket": "verified", "selfCheck": "passed"}
        return {**row, "bucket": "mismatch", "selfCheck": "failed"}

    def _ra_row(self, row: dict, system, inner_size=None, reason=None) -> dict:
        """The answer for a file RetroAchievements knows and no catalogue claims.

        Which of the two buckets it lands in is a question about the file rather
        than about its system: SNES is hashed whole unless a copier header is on
        the front, and a header is exactly the kind of thing one library has and
        the next does not.

        A reason arrives when the read itself failed or was skipped. It rides the
        row rather than deciding it — the bucket is still the better answer, and
        the card needs the reason to say why we could not add our own check to
        RetroAchievements'.
        """
        whole = systems.ra_covers_whole_file(system, inner_size)
        out = {**row, "bucket": "raFull" if whole else "raPartial"}
        if not whole and out.get("datCrc") and system.ra_hash in ("ines_header", "copier_header"):
            out["headerDiff"] = True
        if reason:
            out["reason"] = reason
        return out

    def _ra_recognises(self, item, system, stored: dict) -> bool:
        """Whether RetroAchievements knows this file's hash.

        Same two steps _classify uses, and for the same reason: a file in the
        wrong folder hashed under the wrong console still answers to the right
        one, and the lookup is a dictionary hit rather than a second read.
        """
        digest = item.get("hash")
        if not isinstance(digest, str) or not _HASH_RE.match(digest):
            return False
        console = stored.get(str(system.console_id)) or {}
        if (console.get("hashes") or {}).get(digest) is not None:
            return True
        return self._console_for_hash(digest, item, stored) is not None

    def _verify_read(self, item, system, row):
        """(crc, name to match on, size to match on), or a reason string.

        The name and size are the *inner* ROM's for an archive and the file's own
        otherwise, so an archive and a loose copy of the same ROM produce
        identical verdicts. That was measured rather than assumed: a .7z built
        from a loose .nds gave byte-identical results either way.
        """
        path = item["path"]
        suffix = path.suffix.lower()

        if suffix in DISC_EXTENSIONS and self._skip_disc_verify_enabled():
            return VERIFY_DISCS_OFF
        if suffix in CART_IMAGE_EXTENSIONS and self._skip_cart_verify_enabled():
            return VERIFY_CARTS_OFF

        speed = self._verify_speed()

        trimmed = rom_headers.is_trimmed(path, suffix, row["size"])
        if trimmed:
            row["trimmed"] = True

        if item["kind"] == "zip":
            return self._verify_zip(path)
        if item["kind"] == "archive":
            carried = item.get("verifyCrc")
            if isinstance(carried, str):
                return (carried, item.get("verifyName") or path.name,
                        to_int(item.get("verifySize"), 0))
            if item.get("verifyReason"):
                return item["verifyReason"]
            return _ARCHIVE_VERIFY_REASONS.get(item.get("hash"), VERIFY_READ_FAILED)

        if suffix == ".chd":
            return self._verify_chd(path, row)
        if system.needs_dolphin and suffix not in systems.RAW_DISC_EXTENSIONS:
            return self._verify_dolphin(path, row)

        crc = self._file_crc(path, speed)
        if crc is None:
            return VERIFY_READ_FAILED
        return (crc, path.name, row["size"])

    def _file_crc(self, path: Path, speed: float, limit=None):
        """CRC32 of a file, or of its first ``limit`` bytes.

        The limit is what lets a multi-track disc be checked: chdman writes one
        concatenated bin and the catalogue describes track one, so the comparison
        is against exactly that many bytes off the front.
        """
        crc = 0
        remaining = limit
        try:
            with open(path, "rb") as handle:
                while remaining is None or remaining > 0:
                    started = time.monotonic()
                    want = VERIFY_CHUNK_BYTES
                    if remaining is not None:
                        want = min(want, remaining)
                    block = handle.read(want)
                    if not block:
                        break
                    crc = zlib.crc32(block, crc)
                    if remaining is not None:
                        remaining -= len(block)
                    if self._cancel.is_set():
                        return None
                    if speed:
                        time.sleep((time.monotonic() - started) * speed)
        except OSError:
            return None
        if remaining:
            return None
        return format(crc & 0xFFFFFFFF, "08x")

    def _sha256_range(self, path: Path, offset: int, length: int, speed: float):
        """SHA-256 of one stretch of a file, or None if it wouldn't read.

        A range rather than a whole file because the thing being hashed lives
        inside a container: an NCA is a slice of an NSP, at an offset the
        partition table gives us. Paced the same way _file_crc is, so Gentle
        means the same thing here as everywhere else.
        """
        digest = hashlib.sha256()
        remaining = length
        try:
            with path.open("rb") as handle:
                handle.seek(offset)
                while remaining > 0:
                    started = time.monotonic()
                    block = handle.read(min(VERIFY_CHUNK_BYTES, remaining))
                    if not block:
                        break
                    digest.update(block)
                    remaining -= len(block)
                    if self._cancel.is_set():
                        return None
                    if speed:
                        time.sleep((time.monotonic() - started) * speed)
        except OSError:
            return None
        if remaining:
            return None
        return digest.hexdigest()

    def _verify_switch(self, path: Path, row, speed: float):
        """Check a Switch dump against itself.

        The one system here that needs no reference data at all. Every NCA in an
        NSP or XCI is named after the first sixteen bytes of its own SHA-256, so
        hashing the content and comparing it to the name it is filed under is a
        complete answer — no catalogue, no keys, nothing to download. Measured
        on a real library before this shipped: 475 NCAs across four files, all
        matching.

        Returns True when every NCA agreed, False when one didn't, or a reason
        string when we couldn't get far enough to say.
        """
        entries = switch_container.content_entries(path)
        if entries is None:
            return VERIFY_READ_FAILED
        wanted = [(entry, switch_container.named_hash(entry.name)) for entry in entries]
        wanted = [(entry, claim) for entry, claim in wanted if claim]
        if not wanted:
            return VERIFY_NO_REFERENCE
        for entry, claim in wanted:
            digest = self._sha256_range(path, entry.offset, entry.size, speed)
            if digest is None:
                if self._cancel.is_set():
                    return VERIFY_READ_FAILED
                return VERIFY_READ_FAILED
            if digest[:32] != claim:
                self._debug(
                    "switch self-check failed: %s in %s hashes to %s",
                    entry.name, path.name, digest[:32],
                )
                return False
        row["selfCheckCount"] = len(wanted)
        return True

    def _verify_zip(self, path: Path):
        """A zip needs no decompressing at all.

        The central directory already stores the CRC32 of every entry, so this is
        a header read whatever the archive weighs — 506 NES zips came out in
        0.62 seconds. _pick_rom_entry decides which entry is the game, the same
        one the hashing pass uses, so the two paths can't disagree about what
        they are talking about.
        """
        try:
            with zipfile.ZipFile(path) as archive:
                entries = [
                    (item.filename, item.file_size, item.CRC)
                    for item in archive.infolist() if not item.is_dir()
                ]
        except Exception:
            return VERIFY_READ_FAILED
        if not entries:
            return VERIFY_READ_FAILED

        if len(entries) == 1:
            picked = entries[0][0]
        else:
            picked = self._pick_rom_entry(
                [name for name, _size, _crc in entries], peek=self._archive_peek(path, "zip")
            )
        if picked is None:
            return VERIFY_NO_SINGLE_ROM

        for name, size, crc in entries:
            if name == picked:
                return (format(crc & 0xFFFFFFFF, "08x"), Path(name).name, size)
        return VERIFY_READ_FAILED

    def _verify_dolphin(self, path: Path, row):
        """GameCube, Wii and WAD, through Dolphin's own tool.

        Plain `verify` rather than `-a sha1`, and that choice buys two things at
        once: it prints CRC32 and SHA1 together, and CRC32 is what the catalogue
        indexes are keyed on — and it hands back the integrity problem list,
        which is the only way to say anything at all about a WAD.
        """
        if path.suffix.lower() == ".wad" and not _is_wii_wad(path):
            return VERIFY_NO_REFERENCE
        if not self._dolphin_available():
            return VERIFY_NO_TOOL
        code, out, _ = subprocess_util.run_command(
            [
                "flatpak", "run", "--command=dolphin-tool", DOLPHIN_FLATPAK_APP_ID,
                "verify", "-i", str(path),
            ],
            timeout=self._verify_timeout(row["size"]),
            env=self._deck_env(),
            user="deck",
            group="deck",
        )
        if code != 0:
            return VERIFY_READ_FAILED

        crc = None
        problems = []
        collecting = False
        for line in out.splitlines():
            text = line.strip()
            lowered = text.lower()
            if lowered.startswith("crc32:"):
                crc = text.split(":", 1)[1].strip().lower()
            elif lowered.startswith("problems found:"):
                collecting = text.split(":", 1)[1].strip().lower().startswith("y")
            elif collecting and lowered.startswith("summary:"):
                problems.append(text.split(":", 1)[1].strip())

        if problems:
            row["problems"] = problems[:4]
            if all(any(word in line.lower() for word in _SIGNATURE_WORDS) for line in problems):
                row["signatureProblem"] = True
            else:
                return VERIFY_READ_FAILED

        if crc is None or not re.match(r"^[0-9a-f]{8}$", crc):
            return VERIFY_READ_FAILED
        return (crc, path.name, row["size"])

    def _verify_timeout(self, size: int) -> int:
        return VERIFY_TIMEOUT_SECONDS + int(size / (1024 ** 3)) * VERIFY_TIMEOUT_PER_GB

    def _verify_chd(self, path: Path, row):
        """Unpack a CHD and compare what comes out against the catalogue.

        Two things about this tier are counter-intuitive and both are load
        bearing.

        **The extract command comes from the CHD's own metadata, never from the
        console.** chdman has three of them and picking the wrong one does not
        fail — it exits 0 and hands back a different number of bytes, which then
        fails the comparison and reports a perfectly good disc as not matching.
        "PlayStation 2 means DVD" is wrong for 24 of one library's 297 PS2 discs.
        There is no error to catch and trial-and-error cannot resolve it, so the
        tag is read up front and dispatched on.

        **A disc that does not match proves nothing.** CHDs do not always rebuild
        byte-for-byte: a disc that is genuinely in the catalogue came back 175
        sectors short during the investigation, with the correct command. So a
        miss here goes to Can't Verify and never to the review list, and only
        chdman actually failing is a fault.
        """
        if not self._chdman_path.exists():
            return VERIFY_NO_TOOL

        tags = chd_reader.shape_tags(path)
        if not tags:
            return VERIFY_READ_FAILED

        damaged = self._chd_self_check(path, row)
        if damaged is not None:
            return damaged

        gdrom = b"CHGD" in tags
        tracks = []
        if b"DVD " not in tags:
            try:
                with chd_reader.ChdFile(path) as chd:
                    tracks = chd.tracks()
            except (chd_reader.ChdError, OSError) as exc:
                self._debug("chd verify couldn't read the track table of %s (%s)", path.name, exc)
        if b"DVD " in tags:
            command, produced = "extractdvd", "disc.iso"
        elif gdrom or tags & {b"CHT2", b"CHTR"}:
            command, produced = "extractcd", "disc.cue"
        else:
            return VERIFY_CHD_EXTRACT_FAILED

        needed = self._chd_logical_size(path)
        if needed <= 0:
            return VERIFY_CHD_EXTRACT_FAILED
        base = self._scratch_base(needed)
        if base is None:
            return VERIFY_NO_SPACE

        scratch = base / "verify"
        try:
            self._reset_scratch(scratch)
            target = scratch / produced
            argv = [str(self._chdman_path), command, "-i", str(path), "-o", str(target)]
            if command == "extractcd":
                argv += ["-ob", str(scratch / ("track%t.bin" if gdrom else "disc.bin"))]
            started = time.monotonic()
            code, _, err = subprocess_util.run_command(
                argv, timeout=self._verify_timeout(needed), cancel=self._cancel
            )
            self._debug(
                "chd verify %s: %s in %.1fs", path.name, command, time.monotonic() - started
            )
            if self._cancel.is_set():
                return VERIFY_READ_FAILED
            if code != 0:
                self._debug("chdman %s failed for %s: %s", command, path.name, err.strip()[:200])
                return VERIFY_CHD_EXTRACT_FAILED

            image, limit = self._chd_extracted_image(scratch, command, tags, tracks)
            if image is None:
                return VERIFY_CHD_EXTRACT_FAILED
            crc = self._file_crc(image, self._verify_speed(), limit=limit)
            if crc is None:
                return VERIFY_CHD_EXTRACT_FAILED
            return (crc, path.name, row["size"])
        except OSError as exc:
            self._debug("chd verify couldn't write scratch for %s (%s)", path.name, exc)
            return VERIFY_CHD_EXTRACT_FAILED
        finally:
            self._remove_scratch(scratch)

    def _chd_self_check(self, path: Path, row):
        """Re-derive the CHD's own whole-image SHA-1, or None if it holds up.

        Returns a reason when it does not, which is one of the two things §2
        allows us to state as fact: the container failed to read. Everything
        else this feature reports is a suspicion with a reason attached, and
        this is deliberately not that.

        The row carries the outcome either way, so a disc that came through this
        can say so rather than only saying whether one track matched.
        """
        try:
            size = path.stat().st_size
        except OSError:
            return VERIFY_READ_FAILED

        started = time.monotonic()
        code, _, err = subprocess_util.run_command(
            [str(self._chdman_path), "verify", "-i", str(path)],
            timeout=self._verify_timeout(size),
            cancel=self._cancel,
        )
        self._debug(
            "chd self-check %s: rc=%d in %.1fs", path.name, code, time.monotonic() - started
        )
        if self._cancel.is_set():
            return VERIFY_READ_FAILED
        if subprocess_util.TIMEOUT_MARKER in err:
            decky.logger.warning(
                "cheevocheck: the whole-disc check of %s timed out", path.name
            )
            return VERIFY_NO_TOOL
        if code != 0:
            row["problems"] = _tool_complaints(err)
            return VERIFY_READ_FAILED

        row["selfCheck"] = "passed"
        return None

    def _chd_extracted_image(self, scratch: Path, command: str, tags, tracks):
        """Which file chdman produced, and how much of it the catalogue covers.

        A DVD comes out as one image and the catalogue describes the whole thing.
        A CD comes out as one concatenated bin holding every track, and the
        catalogue describes track one — libretro's Redump mirror keeps that track
        and drops the rest — so the comparison is against exactly the first
        track's worth of bytes. Track one's length comes off the CHD's own track
        table at 2352 bytes a frame, not out of the catalogue, so it is right even
        for a disc the catalogue has never heard of.

        A GD-ROM is the exception that needs no arithmetic: chdman writes it as
        separate per-track files rather than one concatenation, so the first one
        is already the whole of track one.
        """
        if command == "extractdvd":
            image = scratch / "disc.iso"
            return (image, None) if image.exists() else (None, None)

        if b"CHGD" in tags:
            written = [
                child for child in scratch.iterdir()
                if child.is_file() and child.suffix.lower() in (".bin", ".raw")
            ]
            if not written:
                return (None, None)
            return (max(written, key=lambda child: child.stat().st_size), None)

        image = scratch / "disc.bin"
        if not image.exists():
            return (None, None)
        limit = None
        if tracks and len(tracks) > 1:
            frames = to_int(tracks[0].get("frames"), 0)
            if frames > 0:
                limit = frames * chd_reader.CD_SECTOR_DATA
        return (image, limit)

    def _chd_logical_size(self, path: Path) -> int:
        """How much room unpacking this disc will want.

        Asked of chdman rather than worked out from the CHD's own size: the
        compression ratios across a real disc library run from about 1.05:1 to
        better than 4:1, and the free-space check is the thing standing between a
        user with a nearly-full drive and a scan that fills it.
        """
        code, out, _ = subprocess_util.run_command(
            [str(self._chdman_path), "info", "-i", str(path)],
            timeout=FLATPAK_QUERY_TIMEOUT_SECONDS,
        )
        if code != 0:
            return 0
        found = _LOGICAL_SIZE_RE.search(out)
        return to_int(found.group(1).replace(",", ""), 0) if found else 0

    def _collect_verify(self, rows: list, verified_at: int, root: Path) -> dict:
        """The six lists the page reads, plus the counts above them.

        Keyed on the path throughout, and never deduplicated by game the way
        _classify collapses its own buckets. Disc 3 of a four-disc set can fail
        while the other three pass, and "Final Fantasy VIII (Disc 3) doesn't
        match" is exactly the finding this feature exists to surface — folding it
        into one row per game would delete it.
        """
        buckets = {name: [] for name in VERIFY_BUCKETS}
        for row in rows:
            buckets.setdefault(row.get("bucket") or "unrecognised", []).append(row)

        for name, entries in buckets.items():
            if name == "unverifiable":
                entries.sort(key=lambda r: (
                    r.get("reason") not in VERIFY_URGENT_REASONS,
                    r.get("system") or "",
                    (r.get("file") or "").lower(),
                ))
            else:
                entries.sort(key=lambda r: (r.get("system") or "", (r.get("file") or "").lower()))

        out = {"verifiedAt": verified_at, "scanned": len(rows), "root": str(root)}
        out.update(buckets)
        return out

    def _notify(self, results, verify_results, error) -> None:
        if results is None and error is None:
            return

        title = "Cheevo Check"
        if error:
            row_body = _ABORT_BODIES.get(error, _ABORT_BODIES[None])
        elif verify_results is not None:
            row_body = "Cheevo Check finished checking your files against RA and the dump lists:"
        else:
            row_body = "Cheevo Check finished checking your files against RA:"
        toast_body = "Error: Check Notifications" if error else "Scan Completed"

        meta = {"scan": "stopped" if error else "done"}
        if error:
            meta["reason"] = error
        if results is not None:
            meta.update({
                "unsupported": len(results.get("unsupported") or []),
                "noAchievements": len(results.get("noAchievements") or []),
                "failed": len(results.get("failed") or []),
                "supported": to_int(results.get("supported"), 0),
            })
        if verify_results is not None:
            meta["verify"] = "done"
            for bucket in VERIFY_BUCKETS:
                meta[bucket] = len(verify_results.get(bucket) or [])

        if self._notifications is not None:
            self._notifications.append({
                "type": "system",
                "kind": "actionable",
                "iconSource": "none",
                "title": title,
                "body": row_body,
                "source": "notifications",
                "target": {"view": "cheevoCheck"},
                "meta": meta,
            })

        emit_notification(
            ntype="system",
            title_key=title,
            line_key=toast_body,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            force_toast=True,
        )


def _is_wii_wad(path: Path) -> bool:
    """Whether a .wad is a Wii title rather than something else's asset file.

    A Wii WAD opens with its header size as a big-endian word, and that size is
    always 0x20. Checked against a real library: all 14 Wii WADs start
    00000020, and 465 PlayStation 3 asset files sharing the extension start with
    whatever their own format felt like.

    Unreadable answers False. Refusing to call something a Wii title is the safe
    direction — the alternative is telling somebody their file is damaged.
    """
    try:
        with open(path, "rb") as handle:
            return handle.read(4) == b"\x00\x00\x00\x20"
    except OSError:
        return False


def _tool_complaints(text) -> list:
    """The lines of a tool's stderr worth putting in front of a person.

    chdman writes its progress to stderr with carriage returns, so the useful
    line arrives glued to the end of "Verifying, 8.8% complete..." and a naive
    read of the first few lines shows the user a percentage instead of the fault.
    Split on both, then drop the progress and the bare exit-code line.
    """
    out = []
    for chunk in str(text or "").replace("\r", "\n").splitlines():
        line = chunk.strip()
        if not line or line.endswith("complete...") or line.startswith("Fatal error occurred"):
            continue
        out.append(line)
    return out[:4]


def _archive_basename(name: str) -> str:
    """The bare filename, however the thing that wrote it spelled the path.

    Archive entries and the playlists inside them disagree about separators and
    about how much of the path to keep, and the only part they reliably agree on
    is the last component.
    """
    return name.replace("\\", "/").rsplit("/", 1)[-1].strip().lower()


def _looks_like_a_rom(data) -> bool:
    """Whether these bytes came off a cartridge rather than out of an editor.

    Only asked when two entries in one archive share the console's extension,
    which in practice means a Mega Drive ROM sitting next to a README. A NUL in
    the first few kilobytes settles it — a 68000 vector table is full of them
    and prose has none — and anything that isn't valid UTF-8 isn't prose either.
    Reading nothing at all is not evidence, so that answers no.
    """
    if not data:
        return False
    if b"\x00" in data:
        return True
    try:
        data.rstrip(b"\x80\x81\x82\x83\x84\x85\x86\x87\x88\x89\x8a\x8b\x8c\x8d\x8e\x8f").decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False

