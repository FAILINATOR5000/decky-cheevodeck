"""Writing one memory's media out to a folder the user picked."""

import re
import shutil
from datetime import datetime
from pathlib import Path

from utils import chown_to_data_owner, ensure_dir


# The destination is whatever folder the user browsed to, and on a Deck that is
_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

_WHITESPACE = re.compile(r"\s+")

# ext4 allows 255 bytes per name component, not 255 characters. A Japanese
NAME_BYTE_LIMIT = 255

_FALLBACK_STEM = "Memory"


def safe_stem(raw) -> str:
    """One filename component with everything a FAT or SMB volume rejects removed.

    Also drops the trailing dots and spaces Windows silently strips, which is
    how two names that looked different collide on arrival. Returns a fallback
    rather than an empty string, because a name of only illegal characters
    would otherwise produce a file called ``.mp4``.
    """
    text = _ILLEGAL.sub("", str(raw or ""))
    text = _WHITESPACE.sub(" ", text).strip()
    text = text.rstrip(". ")
    return text or _FALLBACK_STEM


def truncate_to_bytes(text: str, limit: int) -> str:
    """Cut a string to fit a byte budget without splitting a UTF-8 character."""
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text
    return encoded[:max(limit, 0)].decode("utf-8", "ignore").rstrip(". ")


def export_name(game_title, captured_at, suffix: str) -> str:
    """The filename one memory is saved out under.

    ``<title> <YYYY-MM-DD HH-MM><suffix>``, with the title trimmed to whatever
    the byte limit leaves once the stamp and the extension are reserved. The
    console name is left out on purpose: it is length spent on something the
    person saving the file already knows.
    """
    stamp = datetime.fromtimestamp(max(int(captured_at or 0), 0)).strftime("%Y-%m-%d %H-%M")
    tail = f" {stamp}{suffix}"
    budget = NAME_BYTE_LIMIT - len(tail.encode("utf-8"))
    stem = truncate_to_bytes(safe_stem(game_title), budget) or _FALLBACK_STEM
    return f"{stem}{tail}"


def place(source: Path, destination: Path) -> dict:
    """Copy one finished file to its destination and hand it to the user.

    Returns ``{"ok", "bytes"}``. The chown matters because the backend runs as
    root and the destination is outside the plugin's tree: without it the file
    lands root-owned in somebody's folder and they cannot upload, rename or
    delete it.
    """
    try:
        ensure_dir(destination.parent)
        shutil.copyfile(source, destination)
        chown_to_data_owner(destination)
        return {"ok": True, "bytes": destination.stat().st_size}
    except OSError:
        try:
            destination.unlink()
        except OSError:
            pass
        return {"ok": False, "bytes": 0}
