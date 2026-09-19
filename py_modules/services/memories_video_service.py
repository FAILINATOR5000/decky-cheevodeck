"""Moving the clip copies to a directory the user picked.

Copy, verify, flip the setting, then delete. Never a move: a failure at any
point leaves the old tree untouched and the setting unflipped, so the feature
still works and running it again is safe. That is worth more here than a rename
that is atomic on one filesystem and a copy on every other.

Runs on its own thread and reports progress through ``status``. The dialog in
the panel is a view of that, never the thing driving it: a modal unmounts the
panel and closing the quick access menu tears it down, so anything driven from
the frontend would stop halfway with files in two places.
"""

from pathlib import Path

import shutil
import threading

import decky

from utils import chown_to_data_owner, ensure_dir


SENTINEL_NAME = ".cheevodeck-videos"

ROOT_DIR_NAME = "CheevoDeck"

FREE_SPACE_MARGIN_BYTES = 256 * 1024 * 1024

ERROR_BUSY = "busy"
ERROR_BAD_TARGET = "bad_target"
ERROR_SAME_PLACE = "same_place"
ERROR_NO_SPACE = "no_space"
ERROR_ROOT_MISSING = "root_missing"
ERROR_NOT_WRITABLE = "not_writable"
ERROR_COPY_FAILED = "copy_failed"
ERROR_VERIFY_FAILED = "verify_failed"


def root_for(picked: str, home: Path) -> Path:
    """Where the copies live for a given setting value.

    An empty setting means ``~/Videos/CheevoDeck``. Anything else is the
    directory the user picked with the same folder name inside it, so a card
    gets one named directory rather than a scatter of account ids.
    """
    if picked:
        return Path(picked) / ROOT_DIR_NAME
    return home / "Videos" / ROOT_DIR_NAME


def write_sentinel(root: Path) -> None:
    """Mark a video root so an absent volume reads as absent, not as empty.

    Best effort. A root that cannot take the marker still works; what is lost
    is only the ability to say "this drive is not plugged in" instead of "these
    videos are gone".
    """
    try:
        ensure_dir(root)
        marker = root / SENTINEL_NAME
        marker.write_text("CheevoDeck memories videos\n", encoding="utf-8")
        chown_to_data_owner(marker)
    except OSError as e:
        decky.logger.warning("memories: couldn't mark the video root (%s)", type(e).__name__)


def root_available(root: Path, custom: bool) -> bool:
    """Whether the video root is reachable.

    The default root is internal storage and is always reachable, so it reports
    true even before anything has been written there. A root the user picked is
    only reachable when its marker reads back: an unmounted card usually leaves
    nothing at the path at all, and a card mounted somewhere unexpected leaves a
    directory that is not the one the videos are in.
    """
    if not custom:
        return True
    try:
        return (root / SENTINEL_NAME).is_file()
    except OSError:
        return False


def _tree_size(root: Path) -> tuple:
    files = []
    total = 0
    if not root.is_dir():
        return (files, total)
    for path in sorted(root.rglob("*")):
        if path.name == SENTINEL_NAME:
            continue
        try:
            if not path.is_file():
                continue
            size = path.stat().st_size
        except OSError:
            continue
        files.append((path, size))
        total += size
    return (files, total)


class MemoriesVideoService:
    """Relocates the clip copies, one whole tree at a time.

    One move runs at a time. ``start`` returns immediately with whether it was
    accepted; everything after that is read through ``status``, which is safe
    to call from anywhere.
    """

    def __init__(self, *, home: Path):
        self._home = home
        self._lock = threading.Lock()
        self._thread = None
        self._state = "idle"
        self._error = ""
        self._copied = 0
        self._files = 0
        self._bytes = 0
        self._total_bytes = 0
        self._target = ""

    def status(self) -> dict:
        with self._lock:
            return {
                "ok": True,
                "state": self._state,
                "error": self._error,
                "copied": self._copied,
                "files": self._files,
                "bytes": self._bytes,
                "totalBytes": self._total_bytes,
                "target": self._target,
            }

    def running(self) -> bool:
        with self._lock:
            return self._state in ("checking", "copying", "verifying", "finishing")

    def start(self, current_root: Path, current_is_custom: bool, picked: str, on_settled) -> dict:
        """Begin a move to ``picked``, or say why it cannot start.

        Refuses while the drive holding the current copies is not mounted.
        Nothing can be copied off a volume that is not there, and going ahead
        would report a move that had moved nothing while pointing the setting
        somewhere the videos are not.

        ``on_settled`` is called from the worker thread once every file is in
        place and checked, with the new root. It is what flips the setting and
        repoints the store, and the old tree is only removed after it returns.
        """
        if self.running():
            return {"ok": False, "error": ERROR_BUSY}

        if not root_available(current_root, current_is_custom):
            return {"ok": False, "error": ERROR_ROOT_MISSING}

        target_root = root_for(picked, self._home)
        if picked and not Path(picked).is_dir():
            return {"ok": False, "error": ERROR_BAD_TARGET}
        if target_root == current_root:
            return {"ok": False, "error": ERROR_SAME_PLACE}

        with self._lock:
            self._state = "checking"
            self._error = ""
            self._copied = 0
            self._files = 0
            self._bytes = 0
            self._total_bytes = 0
            self._target = str(target_root)
            self._thread = threading.Thread(
                target=self._run,
                args=(current_root, target_root, on_settled),
                name="memories-video-move",
                daemon=True,
            )
            self._thread.start()
        return {"ok": True}

    def _fail(self, code: str) -> None:
        with self._lock:
            self._state = "failed"
            self._error = code
        decky.logger.error("memories: moving the videos failed (%s)", code)

    def _run(self, source_root: Path, target_root: Path, on_settled) -> None:
        """The thread's entry point, and the only place a move can end badly.

        Every exit from _move leaves a state the panel can act on. Anything that
        escapes it would not: a thread that dies part way through leaves the
        state it was last in, the panel reads that as a move still running, and
        the rows it disables while one is in flight never come back.
        """
        try:
            self._move(source_root, target_root, on_settled)
        except Exception as e:
            decky.logger.exception(
                "memories: the video move thread stopped (%s: %s)", type(e).__name__, e
            )
            self._fail(ERROR_COPY_FAILED)

    def _move(self, source_root: Path, target_root: Path, on_settled) -> None:
        files, total = _tree_size(source_root)
        with self._lock:
            self._files = len(files)
            self._total_bytes = total

        try:
            ensure_dir(target_root)
        except OSError:
            self._fail(ERROR_NOT_WRITABLE)
            return

        try:
            free = shutil.disk_usage(target_root).free
        except OSError:
            self._fail(ERROR_BAD_TARGET)
            return
        if free < total + FREE_SPACE_MARGIN_BYTES:
            self._fail(ERROR_NO_SPACE)
            return

        with self._lock:
            self._state = "copying"

        written = []
        try:
            for source, size in files:
                relative = source.relative_to(source_root)
                destination = target_root / relative
                ensure_dir(destination.parent)
                shutil.copyfile(source, destination)
                chown_to_data_owner(destination)
                written.append((destination, size))
                with self._lock:
                    self._copied += 1
                    self._bytes += size
        except OSError as e:
            decky.logger.error("memories: the video copy stopped (%s)", type(e).__name__)
            self._unwind(written, target_root)
            self._fail(ERROR_COPY_FAILED)
            return

        with self._lock:
            self._state = "verifying"

        for destination, size in written:
            try:
                landed = destination.stat().st_size
            except OSError:
                landed = -1
            if landed != size:
                decky.logger.error("memories: %s came out wrong after the copy", destination.name)
                self._unwind(written, target_root)
                self._fail(ERROR_VERIFY_FAILED)
                return

        with self._lock:
            self._state = "finishing"

        write_sentinel(target_root)
        on_settled(target_root)

        try:
            shutil.rmtree(source_root)
        except OSError as e:
            decky.logger.warning(
                "memories: the videos moved but the old folder stayed (%s)", type(e).__name__
            )

        with self._lock:
            self._state = "done"
        decky.logger.info(
            "memories: moved %s clip files to %s", len(written), target_root
        )

    def _unwind(self, written: list, target_root: Path) -> None:
        """Take back a partial copy so a failed move leaves nothing behind."""
        for destination, _size in written:
            try:
                destination.unlink()
            except OSError:
                pass
        for path in sorted(target_root.rglob("*"), reverse=True):
            try:
                if path.is_dir():
                    path.rmdir()
            except OSError:
                pass
