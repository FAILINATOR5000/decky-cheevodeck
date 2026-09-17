"""ffmpeg work for memories: grid thumbnails, and the PNG transcode.

No tick and no service, because nothing here runs on its own. Adoption calls it
once per capture and the page calls it for whatever is missing a thumbnail.
"""

import base64
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import decky
import subprocess_util

from utils import chown_to_data_owner


FFMPEG = "/usr/bin/ffmpeg"

THUMB_WIDTH = 640

THUMB_QUALITY = 70

LOSSLESS_COMPRESSION_LEVEL = 4

_THUMB_TIMEOUT_SECONDS = 60
_TRANSCODE_TIMEOUT_SECONDS = 180

MAX_WORKERS = 4

_probe_lock = threading.Lock()
_probe_result = None

_executor_lock = threading.Lock()
_executor = None


def ffmpeg_available() -> bool:
    """Whether ffmpeg is on this machine, answered once per boot.

    Absent is a real state rather than an error: the page still lists memories
    and the viewer still opens the full picture. Only the grid degrades to a
    placeholder tile.
    """
    global _probe_result
    with _probe_lock:
        if _probe_result is None:
            _probe_result = Path(FFMPEG).is_file()
            if not _probe_result:
                decky.logger.warning("memories: %s is missing, thumbnails are off", FFMPEG)
        return _probe_result


def _executor_for_thumbs() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="memthumb")
        return _executor


def _run(argv, timeout) -> bool:
    code, stdout, stderr = subprocess_util.run_command(argv, timeout=timeout)
    if code != 0:
        decky.logger.warning("memories: ffmpeg failed (rc=%s): %s", code, f"{stdout}{stderr}".strip()[:300])
        return False
    return True


def make_thumbnail(source: Path, destination: Path) -> bool:
    """Write a 640px WebP tile for one picture. True when it lands."""
    if not ffmpeg_available():
        return False
    ok = _run([
        FFMPEG, "-y", "-v", "error",
        "-i", str(source),
        "-vf", f"scale={THUMB_WIDTH}:-1:flags=lanczos",
        "-c:v", "libwebp",
        "-q:v", str(THUMB_QUALITY),
        str(destination),
    ], _THUMB_TIMEOUT_SECONDS)
    if ok:
        chown_to_data_owner(destination)
    return ok


def transcode_lossless(source: Path, destination: Path) -> bool:
    """Re-encode a PNG as lossless WebP, half the size and the same pixels.

    Only ever called on a PNG. Doing it to a JPEG makes the file bigger and
    takes over a second to do it, because lossless encoding of a lossy source
    spends its bits perfectly preserving that source's own artifacts.
    """
    if not ffmpeg_available():
        return False
    ok = _run([
        FFMPEG, "-y", "-v", "error",
        "-i", str(source),
        "-c:v", "libwebp",
        "-lossless", "1",
        "-compression_level", str(LOSSLESS_COMPRESSION_LEVEL),
        str(destination),
    ], _TRANSCODE_TIMEOUT_SECONDS)
    if ok:
        chown_to_data_owner(destination)
    return ok


def fill_missing(jobs) -> dict:
    """Generate any thumbnail that is absent, four at a time.

    ``jobs`` is an iterable of ``(key, source, destination)`` triples. Returns
    the destinations that exist afterwards, keyed by ``key``, so a caller can
    tell a fresh one from a failure without asking the filesystem again.
    """
    made = {}
    pending = []
    for key, source, destination in jobs:
        if destination.exists():
            made[key] = destination
        else:
            pending.append((key, source, destination))

    if not pending:
        return made

    executor = _executor_for_thumbs()
    futures = {
        executor.submit(make_thumbnail, source, destination): (key, source, destination)
        for key, source, destination in pending
    }
    for future in futures:
        key, source, destination = futures[future]
        try:
            if future.result():
                made[key] = destination
        except Exception as e:
            decky.logger.warning("memories: thumbnail for %s failed (%s)", source.name, type(e).__name__)
    return made


def read_as_data_uri(path: Path, mime: str = ""):
    """One picture as a data URI, or None.

    The bytes are not held anywhere: they are read, encoded and handed over.
    """
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if not mime:
        mime = _MIME_BY_SUFFIX.get(path.suffix.lower(), "image/png")
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


_MIME_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
}
