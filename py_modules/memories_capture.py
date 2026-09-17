"""Turning one of Steam's screenshots into a memory: classify, name, copy.

Everything here is local and synchronous. The caller resolves the path and the
appid from Steam's screenshot event and hands them over; nothing in this module
touches the network, which is what keeps a bad connection from costing somebody
a picture.
"""

import os
import re
import shutil
import threading
from pathlib import Path

import cheevo_check_systems as systems
import decky
import steam_shortcuts

from utils import chown_to_data_owner


SHORTCUT_APPID_FLOOR = 1 << 31

_PNG_END = b"IEND\xaeB`\x82"
_JPEG_END = b"\xff\xd9"

_TAIL_BYTES = 32

COPY_AS_IS_SUFFIXES = {".jpg", ".jpeg", ".avif"}
TRANSCODE_SUFFIXES = {".png"}

_MAX_PROC_ROM_SCAN = 4096

_UNCOMPRESSED_PATH_PATTERN = re.compile(
    r'"InGameOverlayScreenshotSaveUncompressedPath"\s+"([^"]*)"'
)

_uncompressed_lock = threading.Lock()
_uncompressed_cache = {}

_ROM_SUFFIXES = (
    frozenset(systems.ROM_EXTENSIONS)
    | {systems.ZIP_EXTENSION}
    | frozenset(systems.EXTRACT_EXTENSIONS)
)


def is_non_steam_shortcut(app_id, home=None) -> bool:
    """Whether this appid belongs to a shortcut the user added.

    A native Steam game is never a RetroAchievements game, so this is the whole
    of the attribution check. Returns False for anything unreadable, which
    declines to file rather than filing wrongly.
    """
    try:
        wanted = int(app_id)
    except (TypeError, ValueError):
        return False
    if wanted <= 0:
        return False
    if wanted < SHORTCUT_APPID_FLOOR:
        return False
    try:
        return steam_shortcuts.find_shortcut(wanted, home) is not None
    except Exception:
        return False


def looks_complete(path: Path) -> bool:
    """Whether a picture file has its end-of-image marker.

    A non-zero size is not the same as a finished write, and a destination that
    fails this check must never let the source be deleted. Formats with no cheap
    marker pass on a non-zero size.
    """
    try:
        size = path.stat().st_size
    except OSError:
        return False
    if size <= 0:
        return False

    suffix = path.suffix.lower()
    if suffix not in (".png", ".jpg", ".jpeg"):
        return True

    try:
        with path.open("rb") as handle:
            handle.seek(max(0, size - _TAIL_BYTES))
            tail = handle.read(_TAIL_BYTES)
    except OSError:
        return False

    if suffix == ".png":
        return _PNG_END in tail
    return tail.endswith(_JPEG_END)


def rom_path_for_app(app_id, home=None):
    """The ROM a shortcut launches, from the shortcut's own command line.

    Covers the per-ROM shortcuts Steam ROM Manager and EmuDeck create, which is
    most installs. Returns None for a launcher entry like ES-DE, which picks its
    game later and carries no ROM.
    """
    try:
        candidates = steam_shortcuts.rom_candidates_for_app(app_id, home)
    except Exception:
        return None
    for candidate in candidates or []:
        try:
            if os.path.isfile(candidate):
                return candidate
        except OSError:
            continue
    return None


def running_rom_path():
    """The ROM of whatever emulator is running, read out of /proc.

    The fallback for a launcher shortcut, where the shortcut names no game. The
    match is generic rather than per emulator: any argument whose extension is a
    known ROM container and which exists on disk, which is what lets it see
    through a wrapper script, a sandbox and a re-exec.

    Returns None when nothing matches, or when more than one distinct ROM is
    running and there is no way to tell which one the picture is of.
    """
    found = set()
    proc = Path("/proc")
    try:
        entries = list(proc.iterdir())
    except OSError:
        return None

    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            raw = entry.joinpath("cmdline").read_bytes()
        except OSError:
            continue
        if len(raw) > _MAX_PROC_ROM_SCAN:
            raw = raw[:_MAX_PROC_ROM_SCAN]
        for token in raw.split(b"\x00"):
            if not token:
                continue
            argument = token.decode("utf-8", "ignore")
            if Path(argument).suffix.lower() not in _ROM_SUFFIXES:
                continue
            try:
                if os.path.isfile(argument):
                    found.add(argument)
            except OSError:
                continue

    if len(found) == 1:
        return found.pop()
    return None


def _localconfig_for(source: Path):
    """The localconfig.vdf belonging to whoever took this screenshot.

    Walked up from the screenshot's own path rather than guessed, because a
    device can hold several ``userdata/<steamid>`` directories and only one of
    them took this picture.
    """
    for parent in source.parents:
        if parent.parent.name == "userdata":
            return parent / "config" / "localconfig.vdf"
    return None


def uncompressed_dir(source: Path):
    """Where Steam writes its optional uncompressed copies, or None."""
    config = _localconfig_for(source)
    if config is None:
        return None
    try:
        stamp = config.stat()
    except OSError:
        return None

    key = str(config)
    signature = (stamp.st_mtime_ns, stamp.st_size)
    with _uncompressed_lock:
        cached = _uncompressed_cache.get(key)
        if cached is not None and cached[0] == signature:
            return cached[1]

    try:
        text = config.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    match = _UNCOMPRESSED_PATH_PATTERN.search(text)
    folder = Path(match.group(1)) if match and match.group(1).strip() else None

    with _uncompressed_lock:
        _uncompressed_cache[key] = (signature, folder)
    return folder


def uncompressed_twin(source: Path, game_id: str):
    """The PNG Steam wrote alongside this JPEG, or None.

    Steam names the pair from one stamp: the indexed JPEG is
    ``20260916141949_1.jpg`` and the uncompressed copy is
    ``682700_20260916141949_1.png``, where the prefix is the id on the
    screenshot event. So the twin is addressed directly and no directory is ever
    listed.
    """
    if source.suffix.lower() not in (".jpg", ".jpeg"):
        return None
    folder = uncompressed_dir(source)
    if folder is None:
        return None
    prefix = str(game_id or "").strip()
    if not prefix:
        return None
    twin = folder / f"{prefix}_{source.stem}.png"
    return twin if twin.is_file() else None


def resolve_title(app_id, payload_title, home=None) -> str:
    """The name to file a memory under.

    RetroAchievements' own answer first, because that is the game the plugin is
    tracking. Falling back to the ROM's filename covers an account with no RA
    history at all. A launcher shortcut's name is never used: "ES-DE
    (Program)" under a photograph looks deliberate and is worse than nothing.
    """
    title = str(payload_title or "").strip()
    if title:
        return title

    rom = rom_path_for_app(app_id, home) or running_rom_path()
    if rom:
        return Path(rom).stem
    return ""


def _stem_is_free(folder: Path, stem: str) -> bool:
    for suffix in (".png", ".jpg", ".jpeg", ".avif", ".webp"):
        if (folder / (stem + suffix)).exists():
            return False
    return True


def unique_destination(folder: Path, name: str) -> Path:
    """A path in ``folder`` that no picture of any format is already using."""
    stem = Path(name).stem
    suffix = Path(name).suffix
    if _stem_is_free(folder, stem):
        return folder / name
    for index in range(1, 1000):
        if _stem_is_free(folder, f"{stem}-{index}"):
            return folder / f"{stem}-{index}{suffix}"
    return folder / f"{stem}-{os.getpid()}{suffix}"


def copy_into(source: Path, folder: Path):
    """Copy a screenshot into its game folder and return the new path.

    Goes through a .tmp sibling renamed into place, so a full disk leaves no
    half-written picture for the metadata row to point at. Steam's own file is
    never moved: it stays exactly where Steam put it.
    """
    if not looks_complete(source):
        decky.logger.warning("memories: source %s is not a finished image, skipping", source.name)
        return None

    destination = unique_destination(folder, source.name)
    tmp = destination.with_suffix(destination.suffix + ".tmp")
    try:
        shutil.copyfile(source, tmp)
        chown_to_data_owner(tmp)
        tmp.replace(destination)
    except OSError as e:
        decky.logger.error("memories: couldn't copy %s (%s)", source.name, type(e).__name__)
        try:
            tmp.unlink()
        except OSError:
            pass
        return None

    chown_to_data_owner(destination)
    return destination
