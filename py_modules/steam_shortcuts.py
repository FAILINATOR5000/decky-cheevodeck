"""Reading Steam's non-Steam shortcuts, and working out which ROM one launches.

Steam ROM Manager writes one shortcut per ROM into ``shortcuts.vdf``, a small
binary map keyed by index. This turns an appid back into the file on disk that
the shortcut actually runs, which is what lets the library badge join a Steam
game page to a Cheevo Check scan.

The format is four type bytes and nothing else: 0x00 opens a nested map, 0x01
is a NUL-terminated string, 0x02 is a little-endian uint32, 0x08 closes a map.
Keys are NUL-terminated and their casing is inconsistent, with ``appid`` and
``exe`` lowercase beside ``LaunchOptions`` and ``StartDir`` capitalised in one
file written by one tool, so every lookup here folds case.

The command line is the awkward half, because SRM produces two arrangements and
either one on its own looks like the whole story:

* the emulator in ``exe`` and the ROM in ``LaunchOptions``, which is what its
  shipped presets emit, and
* everything folded into ``exe`` as one quoted command, which is what its writer
  actually produced on the machine this was measured against.

So both fields get walked and neither is assumed. A third arrangement passes
the ROM's bare filename with its directory as a separate argument, which is how
MAME is invoked; that one cannot produce a path at all and falls back to the
name.

Never write to this file. It is Steam's, SRM owns its contents, Steam rewrites
it on exit, and the backend runs as root.

Stdlib only and no decky import, the same as the other readers here, so it
stays drivable from a terminal against a real device.
"""

import collections
import logging
import os
import shlex
import threading
import time

from pathlib import Path, PurePosixPath

import cheevo_check_systems as systems


_MAP, _STRING, _UINT32, _END = 0x00, 0x01, 0x02, 0x08

_SHORTCUTS_GLOBS = (
    ".local/share/Steam/userdata/*/config/shortcuts.vdf",
    ".steam/steam/userdata/*/config/shortcuts.vdf",
    ".steam/root/userdata/*/config/shortcuts.vdf",
)

_SCANNED_EXTENSIONS = (
    frozenset(systems.ROM_EXTENSIONS)
    | {systems.ZIP_EXTENSION}
    | frozenset(systems.EXTRACT_EXTENSIONS)
)

_PLAYLIST_EXTENSIONS = frozenset((".m3u", ".m3u8", ".pls"))

_MAX_PLAYLIST_BYTES = 64 * 1024


def _read_cstring(data: bytes, offset: int):
    end = data.find(b"\x00", offset)
    if end < 0:
        raise ValueError("unterminated string")
    return data[offset:end].decode("utf-8", "replace"), end + 1


def _read_map(data: bytes, offset: int):
    out = {}
    while offset < len(data):
        kind = data[offset]
        offset += 1
        if kind == _END:
            return out, offset
        key, offset = _read_cstring(data, offset)
        if kind == _MAP:
            value, offset = _read_map(data, offset)
        elif kind == _STRING:
            value, offset = _read_cstring(data, offset)
        elif kind == _UINT32:
            value = int.from_bytes(data[offset:offset + 4], "little")
            offset += 4
        else:
            raise ValueError(f"unknown vdf type 0x{kind:02x}")
        out[key] = value
    raise ValueError("map has no end marker")


def parse_shortcuts(data: bytes) -> dict:
    """The entries out of a shortcuts.vdf, keyed by their index string.

    The file opens with the root map's type byte and the key "shortcuts", and
    ends with one spare byte closing that root. That trailing byte is tolerated
    rather than checked, since nothing after the entries is worth reading.
    """
    if not data:
        return {}
    _, offset = _read_cstring(data, 1)
    entries, _ = _read_map(data, offset)
    return entries


def iter_shortcuts_files(home=None):
    """Every shortcuts.vdf on the machine, deduplicated.

    The three locations are usually the same directory reached three ways,
    since ~/.steam/steam and ~/.steam/root are normally symlinks into the
    first, so resolving before deduplicating is what stops the same file being
    read three times.
    """
    base = Path(home) if home else Path.home()
    seen = set()
    for pattern in _SHORTCUTS_GLOBS:
        for path in sorted(base.glob(pattern)):
            try:
                resolved = path.resolve()
            except OSError:
                continue
            if resolved in seen:
                continue
            seen.add(resolved)
            yield resolved


def _field(shortcut: dict, name: str):
    wanted = name.lower()
    for key, value in shortcut.items():
        if key.lower() == wanted and isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _app_id(shortcut: dict):
    for key, value in shortcut.items():
        if key.lower() == "appid" and isinstance(value, int):
            return value
    return None


def find_shortcut(app_id, home=None):
    """The shortcut entry for this appid, or None.

    Steam stores the id as a signed 32-bit value while the frontend hands it over
    unsigned, so both readings are compared. A device with two Steam accounts can
    hold two shortcuts under one id; the first found wins, which is the same
    arbitrary answer as asking any other way.
    """
    index = _index_for(home)
    if index.snapshot is None:
        index.rebuild_soon()
        return _scan_for_app(app_id, home)
    row = _row_for_app(app_id, home)
    return row["entry"] if row is not None else None


def _scan_for_app(app_id, home):
    try:
        wanted = int(app_id)
    except (TypeError, ValueError):
        return None
    signed = wanted - (1 << 32) if wanted >= (1 << 31) else wanted
    for path in iter_shortcuts_files(home):
        stamp = _file_stamp(path)
        if stamp is None:
            continue
        try:
            entries = _read_entries(path, stamp)
        except _Unreadable:
            continue
        for shortcut in entries.values():
            if not isinstance(shortcut, dict):
                continue
            found = _app_id(shortcut)
            if found is not None and found in (wanted, signed):
                return shortcut
    return None


def _tokens(field: str):
    try:
        return shlex.split(field, posix=True)
    except ValueError:
        return field.split()


def _walk(field: str):
    """The ROM-ish and directory-ish tokens out of one command line.

    The extension check has to be a hard filter rather than a "looks like a
    path" heuristic, because one of the arrangements hands over flatpak app
    ids. org.libretro.RetroArch and org.DolphinEmu.dolphin-emu both carry dots
    and both pass any reasonable path test. Only the extension rejects them.
    """
    roms = []
    dirs = []
    for token in _tokens(field):
        if not token or token.startswith("-") or token == "%command%":
            continue
        if len(token) > 1 and token[0] == token[-1] == "'":
            token = token[1:-1]
        suffix = PurePosixPath(token).suffix.lower()
        if suffix in _SCANNED_EXTENSIONS or suffix in _PLAYLIST_EXTENSIONS:
            roms.append(token)
        elif "/" in token:
            dirs.append(token)
    return roms, dirs


def resolve_rom_path(exe, launch_options=None, start_dir=None):
    """Where the ROM this shortcut launches lives, as best as the command says.

    Returns an absolute path where the command gave one, a directory-joined
    path where a sibling argument supplied the directory, and a bare filename
    where neither did. The caller matches that last one on name alone.

    The last qualifying token wins. Command lines put the content argument at
    the end, and it is the only ordering that survives an emulator whose own
    path happens to carry a listed extension.
    """
    for field in (launch_options, exe):
        if not field:
            continue
        roms, dirs = _walk(field)
        if not roms:
            continue
        rom = roms[-1]
        if rom.startswith("~"):
            rom = os.path.expanduser(rom)
        if os.path.isabs(rom):
            return rom
        if os.path.dirname(rom):
            return os.path.join(start_dir, rom) if start_dir else rom
        for candidate in reversed(dirs):
            if os.path.isdir(candidate):
                return os.path.join(candidate, rom)
        return rom
    return None


def expand_playlist(path):
    """The discs a .m3u names, resolved against the playlist's own directory.

    Every entry in every real playlist measured is a bare filename, so the
    playlist's directory is what they are relative to. StartDir would build
    paths that cannot exist.

    All of them come back rather than the first, because a playlist is not
    guaranteed to hold what its name implies: one real file lists a single disc
    whose name says nothing about being disc one, and a partial rip may only
    have had disc two scanned.
    """
    folder = os.path.dirname(path)
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read(_MAX_PLAYLIST_BYTES)
    except OSError:
        return []

    out = []
    for line in text.splitlines():
        entry = line.strip()
        if not entry or entry.startswith("#"):
            continue
        if not os.path.isabs(entry):
            entry = os.path.join(folder, entry)
        out.append(entry)
    return out


def _real(path):
    try:
        return os.path.realpath(path)
    except (OSError, ValueError):
        return path


def rom_candidates(exe, launch_options=None, start_dir=None):
    """Every path this shortcut could mean, best first, ready to look up.

    Absolute paths come back resolved, because roughly half a real EmuDeck tree
    is symlinks out to other drives and the scan follows them, so the recorded
    path is a real one and the lookup has to match on real paths too. A bare
    filename is passed through untouched for the caller's name tier.
    """
    return _match(exe, launch_options, start_dir)[0]


def _match(exe, launch_options=None, start_dir=None):
    resolved = resolve_rom_path(exe, launch_options, start_dir)
    if not resolved:
        return [], False, None

    if PurePosixPath(resolved).suffix.lower() in _PLAYLIST_EXTENSIONS:
        playlist = _real(resolved)
        stamp = _file_stamp(playlist)
        return [_real(entry) for entry in expand_playlist(playlist)], True, (playlist, stamp)

    if os.path.isabs(resolved):
        return [_real(resolved)], True, None
    return [resolved], True, None


def rom_candidates_for_app(app_id, home=None):
    """The same, starting from a Steam appid."""
    row = _row_for_app(app_id, home)
    return list(row["roms"]) if row is not None else []


def _passes_path(exe, launch_options) -> bool:
    tokens = _tokens(exe)[1:] if exe else []
    if tokens and not exe.startswith(('"', "'")) and os.path.isfile(exe):
        tokens = []
    options = _tokens(launch_options) if launch_options else []
    if "%command%" in options:
        options = options[options.index("%command%") + 1:]
    flag_value = False
    for token in tokens + options:
        if token.startswith("-"):
            flag_value = "=" not in token
            continue
        if "/" in token and not flag_value and not token.lower().endswith((".sh", ".appimage")):
            return True
        flag_value = False
    return False


_MAX_FILE_BYTES = 64 * 1024 * 1024
_RETRY_SECONDS = (1.0, 5.0)
_MISSING_GRACE_SECONDS = 1.0

_log = logging.getLogger("steam_shortcuts")
_debug_on = None


def configure(logger, debug=None):
    global _log, _debug_on
    _log = logger
    _debug_on = debug


def _debug(message, *args):
    try:
        on = _debug_on is not None and _debug_on()
    except Exception:
        on = False
    if on:
        _log.info("shortcuts: " + message, *args)


_DRIVE_TYPES = frozenset((b"ext2", b"ext3", b"ext4", b"btrfs", b"xfs", b"f2fs", b"vfat", b"exfat", b"ntfs", b"ntfs3",
                          b"fuseblk"))
_SKIPPED_MOUNTS = (b"/efi", b"/esp", b"/boot")


def mounts():
    try:
        with open("/proc/self/mountinfo", "rb") as handle:
            text = handle.read()
    except OSError:
        return b""
    drives = []
    for line in text.splitlines():
        head, _, tail = line.partition(b" - ")
        fields, kind = head.split(b" "), tail.split(b" ")
        if len(fields) < 5 or len(kind) < 2 or kind[0] not in _DRIVE_TYPES:
            continue
        point = fields[4]
        if any(point == skipped or point.startswith(skipped + b"/") for skipped in _SKIPPED_MOUNTS):
            continue
        drives.append(b" ".join((fields[0], point, kind[0], kind[1])))
    return b"\n".join(sorted(drives))


def _file_stamp(path):
    try:
        st = os.stat(path)
    except (OSError, ValueError):
        return None
    return (st.st_mtime_ns, st.st_size, st.st_ino)


class _Unreadable(Exception):
    pass


def _read_entries(path, stamp):
    if stamp[1] > _MAX_FILE_BYTES:
        raise _Unreadable(f"{stamp[1]} bytes, too large to read")
    try:
        with open(path, "rb") as handle:
            data = handle.read(_MAX_FILE_BYTES + 1)
    except OSError as e:
        raise _Unreadable(type(e).__name__) from e
    if len(data) != stamp[1] or _file_stamp(path) != stamp:
        raise _Unreadable("changed while it was read")
    if not data:
        raise _Unreadable("empty")
    try:
        return parse_shortcuts(data)
    except Exception as e:
        raise _Unreadable(type(e).__name__) from e


def _match_row(exe, options, start_dir):
    roms, named, playlist = _match(exe, options, start_dir)
    emulator = bool(exe) and not named and not _passes_path(exe, options or "")
    return roms, emulator, playlist


def _make_row(entry, key, match):
    app_id = _app_id(entry)
    return {
        "appid": app_id & 0xFFFFFFFF,
        "raw": app_id,
        "name": _field(entry, "AppName") or "",
        "exe": key[0] or "",
        "launchOptions": key[1] or "",
        "roms": match[0],
        "emulator": match[1],
        "key": key,
        "entry": entry,
    }


_OWN = object()


def _public(row, options=_OWN):
    return {"appid": row["appid"], "name": row["name"], "exe": row["exe"],
            "launchOptions": row["launchOptions"] if options is _OWN else options}


class _Snapshot:
    def __init__(self, generation, stamps, rows, behind, mounted=b""):
        self.generation = generation
        self.stamps = stamps
        self.rows = rows
        self.behind = behind
        self.mounts = mounted
        self.by_appid = {}
        for row in rows:
            self.by_appid.setdefault(row["raw"], row)
        by_rom = {}
        for row in rows:
            for candidate in row["roms"]:
                if not os.path.isabs(candidate):
                    continue
                listed = by_rom.setdefault(candidate, [])
                if all(item["appid"] != row["appid"] for item in listed):
                    listed.append(_public(row))
        self.by_rom = by_rom
        self._views = {None: [_public(row) for row in rows if row["emulator"]]}

    def emulators(self, held):
        view = self._views.get(held)
        if view is not None:
            return view
        found = []
        for row in self.rows:
            if row["appid"] != held[0]:
                if row["emulator"]:
                    found.append(_public(row))
                continue
            exe, options = row["exe"], held[1]
            if not exe or rom_candidates(exe, options or None) or resolve_rom_path(exe, options or None) is not None \
                    or _passes_path(exe, options):
                continue
            found.append(_public(row, options))
        if len(self._views) > 8:
            self._views = {None: self._views[None]}
        self._views[held] = found
        return found


class _FileState:
    def __init__(self):
        self.rows = []
        self.good = None
        self.bad = None
        self.failures = 0
        self.missing_since = None
        self.recheck = False

    def copy(self):
        state = _FileState()
        state.__dict__.update(self.__dict__)
        return state


def _projection(rows):
    return [(row["appid"], row["name"], row["exe"], row["launchOptions"], row["roms"], row["emulator"]) for row in rows]


class _Index:
    def __init__(self, home):
        self.home = home
        self.lock = threading.Lock()
        self._flags = threading.Lock()
        self.snapshot = None
        self._files = {}
        self._memo = {}
        self._running = False
        self._again = False
        self._force = False
        self._timer = None
        self._timer_due = 0.0
        self._stopped = False
        self.builds = 0
        self.matched = 0
        self.threads = collections.deque(maxlen=32)
        self.last_verify = None
        self.mounts = None

    def _stamps(self):
        return tuple((str(path), _file_stamp(path)) for path in iter_shortcuts_files(self.home))

    def _stale(self, snap, fresh=False):
        return snap is None or self._stamps() != snap.stamps or (fresh and mounts() != self.mounts)

    def stale(self):
        return self._stale(self.snapshot)

    def current(self, fresh=False):
        snap = self.snapshot
        if snap is not None and not self._stale(snap, fresh):
            return snap
        if snap is not None and not fresh:
            self.rebuild_soon()
            return snap
        with self.lock:
            if self._stale(self.snapshot, fresh):
                self._build()
            return self.snapshot

    def rebuild_soon(self, force=False):
        with self._flags:
            self._force = self._force or force
            if self._running:
                self._again = True
                return
            self._running = True
        threading.Thread(target=self._builder, name="shortcut-index", daemon=True).start()

    def _builder(self):
        while True:
            with self._flags:
                force, self._force = self._force, False
                self._again = False
            try:
                with self.lock:
                    if force or self._stale(self.snapshot):
                        self._build()
            except Exception as e:
                _log.warning("shortcuts: the index rebuild failed (%s)", type(e).__name__)
            with self._flags:
                if not self._again:
                    self._running = False
                    return

    def _retry_in(self, seconds):
        due = time.monotonic() + seconds
        with self._flags:
            if self._stopped:
                return
            if self._timer is not None:
                if self._timer_due <= due:
                    return
                self._timer.cancel()
            self._timer = threading.Timer(seconds, self._retry)
            self._timer.daemon = True
            self._timer_due = due
            self._timer.start()

    def _retry(self):
        with self._flags:
            self._timer = None
        self.rebuild_soon(force=True)

    def stop(self):
        with self._flags:
            self._stopped = True
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

    def _rows(self, entries, memo, verify, live, stale):
        rows = []
        for entry in entries.values():
            if not isinstance(entry, dict) or _app_id(entry) is None:
                continue
            key = (_field(entry, "exe"), _field(entry, "LaunchOptions"), _field(entry, "StartDir"))
            match = memo.get(key)
            playlist = match[2] if match is not None else None
            if playlist is not None and _file_stamp(playlist[0]) != playlist[1]:
                match = None
            if match is None:
                self.matched += 1
                match = _match_row(*key)
                memo[key] = match
                if verify:
                    remembered = self._memo.get(key)
                    before = [old for old in (live.get(key), remembered and remembered[:2]) if old]
                    if any(old != match[:2] for old in before):
                        stale.append(_field(entry, "AppName") or str(_app_id(entry)))
            rows.append(_make_row(entry, key, match))
        return rows

    def _build(self, verify=False):
        self.threads.append(threading.get_ident())
        self.builds += 1
        now = time.monotonic()
        mounted = mounts()
        if self.mounts is not None and mounted != self.mounts:
            _log.info("shortcuts: the mounted drives changed, matching every shortcut again")
            self._memo = {}
            for state in self._files.values():
                state.good = None
                state.bad = None
                state.failures = 0
        found = [str(path) for path in iter_shortcuts_files(self.home)]
        order = found + [path for path in self._files if path not in found]
        live = {}
        if verify and self.snapshot is not None:
            for row in self.snapshot.rows:
                live.setdefault(row["key"], (row["roms"], row["emulator"]))
        memo = {} if verify else self._memo
        stale = []
        stamps, files, retry, behind = [], {}, None, False
        for path in order:
            state = self._files[path].copy() if path in self._files else _FileState()
            stamp = _file_stamp(path) if path in found else None
            if path in found:
                stamps.append((path, stamp))
            if stamp is None:
                if not state.rows:
                    continue
                if state.missing_since is None:
                    state.missing_since = now
                    _debug("%s is missing, keeping its %d shortcuts for now", path, len(state.rows))
                left = _MISSING_GRACE_SECONDS - (now - state.missing_since)
                if left > 0:
                    files[path] = state
                    behind = True
                    retry = left if retry is None else min(retry, left)
                    continue
                _log.info("shortcuts: %s is gone, dropping its %d shortcuts", path, len(state.rows))
                continue
            state.missing_since = None
            if stamp == state.good and not verify and not state.recheck:
                files[path] = state
                continue
            if stamp == state.bad and state.failures > len(_RETRY_SECONDS) and not verify:
                files[path] = state
                behind = True
                continue
            try:
                rows = self._rows(_read_entries(path, stamp), memo, verify, live, stale)
            except Exception as e:
                reason = e if isinstance(e, _Unreadable) else type(e).__name__
                if stamp != state.good and stamp != state.bad:
                    state.failures = 0
                state.failures += 1
                if stamp == state.good:
                    state.recheck = state.failures <= len(_RETRY_SECONDS)
                else:
                    state.bad = stamp
                files[path] = state
                behind = True
                if state.failures == 1 and state.rows:
                    _log.warning("shortcuts: couldn't read %s (%s), keeping the %d shortcuts from its last good read",
                                 path, reason, len(state.rows))
                elif state.failures == 1:
                    _log.warning("shortcuts: couldn't read %s (%s)", path, reason)
                elif state.failures == len(_RETRY_SECONDS) + 1:
                    _debug("%s still doesn't read (%s), keeping its last good read", path, reason)
                else:
                    _debug("%s still doesn't read (%s), try %d", path, reason, state.failures)
                if state.failures <= len(_RETRY_SECONDS):
                    wait = _RETRY_SECONDS[state.failures - 1]
                    retry = wait if retry is None else min(retry, wait)
                continue
            if state.failures:
                _log.info("shortcuts: %s reads again", path)
            state.failures = 0
            state.bad = None
            state.recheck = False
            state.good = stamp
            state.rows = rows
            files[path] = state

        rows = [row for state in files.values() for row in state.rows]
        old = self.snapshot
        if old is None:
            generation = 1
        elif _projection(old.rows) == _projection(rows):
            generation = old.generation
        else:
            generation = old.generation + 1
        snapshot = _Snapshot(generation, tuple(stamps), rows, behind, mounted)
        self._memo = {row["key"]: memo[row["key"]] for state in files.values() for row in state.rows
                      if row["key"] in memo}
        self._files = files
        self.mounts = mounted
        self.snapshot = snapshot
        if retry is not None:
            self._retry_in(retry)
        return stale

    def verify(self):
        started = time.monotonic()
        with self.lock:
            before = self.snapshot
            stale = self._build(verify=True)
            after = self.snapshot
        changed = before is not None and _projection(before.rows) != _projection(after.rows)
        self.last_verify = {"at": int(time.time()), "stale": len(stale), "examples": stale[:5],
                            "changed": changed, "ms": round((time.monotonic() - started) * 1000)}
        return self.last_verify

    def forget(self, real_paths):
        wanted = set(real_paths)
        with self.lock:
            self._memo = {key: match for key, match in self._memo.items() if not wanted & set(match[0])}
            for state in self._files.values():
                state.good = None
            self._build()
            return self.snapshot

    def describe(self):
        snap = self.snapshot
        return {
            "generation": snap.generation if snap is not None else 0,
            "shortcuts": len(snap.rows) if snap is not None else 0,
            "romPaths": len(snap.by_rom) if snap is not None else 0,
            "emulators": len(snap.emulators(None)) if snap is not None else 0,
            "behind": bool(snap.behind) if snap is not None else False,
            "memo": len(self._memo),
            "files": [{"path": path, "shortcuts": len(state.rows), "failures": state.failures,
                       "missing": state.missing_since is not None} for path, state in self._files.items()],
            "builds": self.builds,
            "matched": self.matched,
            "lastVerify": self.last_verify,
        }


_indexes = {}
_indexes_lock = threading.Lock()
_EMPTY = _Snapshot(0, (), [], True)


def _index_for(home):
    base = Path(home) if home else Path.home()
    key = str(base)
    index = _indexes.get(key)
    if index is None:
        with _indexes_lock:
            index = _indexes.setdefault(key, _Index(base))
    return index


def current(home=None, fresh=False):
    index = _index_for(home)
    try:
        return index.current(fresh)
    except Exception as e:
        _log.warning("shortcuts: couldn't read the shortcut files (%s)", type(e).__name__)
        return index.snapshot or _EMPTY


def rebuild_soon(home=None):
    _index_for(home).rebuild_soon(force=True)


def verify(home=None):
    try:
        return _index_for(home).verify()
    except Exception as e:
        _log.warning("shortcuts: the index check failed (%s)", type(e).__name__)
        return None


def forget_matches(real_paths, home=None):
    index = _index_for(home)
    try:
        return index.forget(real_paths)
    except Exception as e:
        _log.warning("shortcuts: couldn't match those shortcuts again (%s)", type(e).__name__)
        return index.snapshot or _EMPTY


def stamps(home=None):
    return _index_for(home)._stamps()


def describe(home=None):
    return _index_for(home).describe()


def stop():
    for index in list(_indexes.values()):
        index.stop()


def _row_for_app(app_id, home):
    try:
        wanted = int(app_id)
    except (TypeError, ValueError):
        return None
    signed = wanted - (1 << 32) if wanted >= (1 << 31) else wanted
    by_appid = current(home).by_appid
    found = by_appid.get(wanted) or by_appid.get(signed)
    if found is None and _index_for(home).stale():
        by_appid = current(home, fresh=True).by_appid
        found = by_appid.get(wanted) or by_appid.get(signed)
    return found


def shortcuts_by_rom(home=None):
    return current(home).by_rom


def emulator_shortcuts(home=None, held=None):
    return current(home).emulators(held)
