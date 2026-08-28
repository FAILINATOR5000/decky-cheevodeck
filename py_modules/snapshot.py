"""A composited screenshot of game mode, with the QAM in it.

Steam's own screenshot grabs the running game's backbuffer, so everything
gamescope draws on top of it is missing: the whole Steam UI, and the panel with
it. gamescope's screenshot is a capture of the composited output instead, which
is the layer the panel actually lives in.

CDP was tried first and does not work. Valve's CEF accepts Page.enable and then
never answers Page.captureScreenshot, on every target, with and without a clip.
Don't spend an evening on it again.
"""

import glob
import pwd
import time
from datetime import datetime
from pathlib import Path

import decky
import subprocess_util

from utils import chown_to_data_owner, ensure_dir

_SCREENSHOT_COMMAND = "screenshot"
_NOT_FOUND_MARKER = "command not found"

_SOCKET_GLOB = "/run/user/*/gamescope-*"

_WAIT_STEPS = 20
_WAIT_SECONDS = 0.25

_TIMEOUT_SECONDS = 15


def _find_socket():
    """The compositor's runtime dir and socket name, or (None, None).

    None means desktop mode, where there is no gamescope and nothing to
    capture. That is a message to the user rather than an error worth logging.
    """
    for path in sorted(glob.glob(_SOCKET_GLOB)):
        socket = Path(path)
        try:
            if socket.is_socket():
                return socket.parent, socket.name
        except OSError:
            continue
    return None, None


def _destination(runtime_dir: Path) -> Path:
    """~/Pictures/CheevoDeck for whoever is running the session.

    Not Path.home(): the backend runs as root, so that answers /root. The
    runtime dir is named after the uid of the session gamescope belongs to,
    which is the person whose Pictures folder the shot goes in.

    Pictures rather than the plugin's own data dir because it is where someone
    looks for pictures, desktop mode's file manager already shows it, and it
    survives a reinstall — which the data dirs deliberately do not.
    """
    owner = pwd.getpwuid(runtime_dir.stat().st_uid)
    return Path(owner.pw_dir) / "Pictures" / "CheevoDeck"


def _filename() -> str:
    """Sortable to the millisecond, and unique by construction.

    Seconds are not enough: someone mashing a button manages three or four
    presses a second, and a collision here costs a shot that has to be posed
    again. A -2/-3 counter would need to read the directory and pick a free
    suffix, which is a check-then-act with a window in it, for prettier names
    nobody ever types.
    """
    stamp = datetime.now()
    return f"cheevodeck-{stamp:%Y-%m-%d_%H-%M-%S}-{stamp.microsecond // 1000:03d}.png"


def _wait_for_file(path: Path) -> bool:
    for _ in range(_WAIT_STEPS):
        try:
            if path.stat().st_size > 0:
                return True
        except OSError:
            pass
        time.sleep(_WAIT_SECONDS)
    return False


def capture() -> dict:
    """Take one screenshot. Blocking, so the caller hops to a thread first."""
    runtime_dir, socket = _find_socket()
    if socket is None:
        return {"ok": False, "error": "no_socket", "path": ""}

    try:
        folder = _destination(runtime_dir)
        ensure_dir(folder)
    except (KeyError, OSError) as exc:
        decky.logger.error("couldn't prepare the snapshot folder (%s: %s)", type(exc).__name__, exc)
        return {"ok": False, "error": "write_failed", "path": ""}

    out = folder / _filename()
    env = subprocess_util.system_env()
    env["XDG_RUNTIME_DIR"] = str(runtime_dir)
    env["GAMESCOPE_WAYLAND_DISPLAY"] = socket

    code, stdout, stderr = subprocess_util.run_command(
        ["gamescopectl", _SCREENSHOT_COMMAND, str(out)],
        timeout=_TIMEOUT_SECONDS,
        env=env,
    )
    answer = f"{stdout}{stderr}"
    if code != 0 or _NOT_FOUND_MARKER in answer.lower():
        decky.logger.error("gamescopectl screenshot failed (rc=%s): %s", code, answer.strip())
        return {"ok": False, "error": "write_failed", "path": ""}

    if not _wait_for_file(out):
        decky.logger.error("gamescopectl returned but %s never appeared", out)
        return {"ok": False, "error": "write_failed", "path": ""}

    chown_to_data_owner(out)
    return {"ok": True, "error": "", "path": str(out)}
