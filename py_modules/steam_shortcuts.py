"""Reading Steam's non-Steam shortcuts, and working out which ROM one launches.

Steam ROM Manager writes one shortcut per ROM into ``shortcuts.vdf``, a small
binary map keyed by index. This turns an appid back into the file on disk that
the shortcut actually runs, which is what lets the library badge join a Steam
game page to a Cheevo Check scan.

The format is four type bytes and nothing else: 0x00 opens a nested map, 0x01 is
a NUL-terminated string, 0x02 is a little-endian uint32, 0x08 closes a map. Keys
are NUL-terminated and their casing is inconsistent — the real file has ``appid``
and ``exe`` lowercase beside ``LaunchOptions`` and ``StartDir`` capitalised, in
one file written by one tool — so every lookup here folds case.

The command line is the awkward half, because SRM produces two arrangements and
either one on its own looks like the whole story:

* the emulator in ``exe`` and the ROM in ``LaunchOptions``, which is what its 333
  shipped presets emit, and
* everything folded into ``exe`` as one quoted command, which is what its writer
  actually produced for all 246 shortcuts on the machine this was measured on.

So both fields get walked and neither is assumed. A third arrangement passes the
ROM's bare filename with its directory as a separate argument, which is how MAME
is invoked; that one cannot produce a path at all and falls back to the name.

Never write to this file. It is Steam's, SRM owns its contents, Steam rewrites it
on exit, and the backend runs as root.

Stdlib only and no decky import, same as the other readers here, so it stays
drivable from a terminal against a real device.
"""

import os
import shlex

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
    ends with one spare byte closing that root — tolerated rather than checked,
    since nothing after the entries is worth reading.
    """
    if not data:
        return {}
    _, offset = _read_cstring(data, 1)
    entries, _ = _read_map(data, offset)
    return entries


def iter_shortcuts_files(home=None):
    """Every shortcuts.vdf on the machine, deduplicated.

    The three locations are usually the same directory reached three ways —
    ~/.steam/steam and ~/.steam/root are normally symlinks into the first — so
    resolving before deduplicating is what stops the same file being read three
    times.
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
    try:
        wanted = int(app_id)
    except (TypeError, ValueError):
        return None
    signed = wanted - (1 << 32) if wanted >= (1 << 31) else wanted

    for path in iter_shortcuts_files(home):
        try:
            entries = parse_shortcuts(path.read_bytes())
        except (OSError, ValueError):
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

    The extension check has to be a hard filter rather than a "looks like a path"
    heuristic, because shape A hands over flatpak app ids — org.libretro.RetroArch
    and org.DolphinEmu.dolphin-emu both carry dots and both pass any reasonable
    path test. Only the extension rejects them.
    """
    roms = []
    dirs = []
    for token in _tokens(field):
        if not token or token.startswith("-") or token == "%command%":
            continue
        suffix = PurePosixPath(token).suffix.lower()
        if suffix in _SCANNED_EXTENSIONS or suffix in _PLAYLIST_EXTENSIONS:
            roms.append(token)
        elif "/" in token:
            dirs.append(token)
    return roms, dirs


def resolve_rom_path(exe, launch_options=None, start_dir=None):
    """Where the ROM this shortcut launches lives, as best as the command says.

    Returns an absolute path where the command gave one, a directory-joined path
    where a sibling argument supplied the directory, and a bare filename where
    neither did — the caller matches that last one on name alone.

    The last qualifying token wins. Command lines put the content argument at the
    end, and it is the only ordering that survives an emulator whose own path
    happens to carry a listed extension.
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
    playlist's directory is what they are relative to — StartDir would build
    paths that cannot exist.

    All of them come back rather than the first, because a playlist is not
    guaranteed to hold what its name implies: one real file lists a single disc
    whose name says nothing about being disc one, and a partial rip may only have
    had disc two scanned.
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
    except OSError:
        return path


def rom_candidates(exe, launch_options=None, start_dir=None):
    """Every path this shortcut could mean, best first, ready to look up.

    Absolute paths come back resolved, because roughly half a real EmuDeck tree
    is symlinks out to other drives and the scan follows them — so the recorded
    path is a real one and the lookup has to match on real paths too. A bare
    filename is passed through untouched for the caller's name tier.
    """
    resolved = resolve_rom_path(exe, launch_options, start_dir)
    if not resolved:
        return []

    if PurePosixPath(resolved).suffix.lower() in _PLAYLIST_EXTENSIONS:
        return [_real(entry) for entry in expand_playlist(_real(resolved))]

    if os.path.isabs(resolved):
        return [_real(resolved)]
    return [resolved]


def rom_candidates_for_app(app_id, home=None):
    """The same, starting from a Steam appid."""
    shortcut = find_shortcut(app_id, home)
    if not shortcut:
        return []
    return rom_candidates(
        _field(shortcut, "exe"),
        _field(shortcut, "LaunchOptions"),
        _field(shortcut, "StartDir"),
    )
