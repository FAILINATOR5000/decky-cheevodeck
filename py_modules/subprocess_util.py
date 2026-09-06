"""Running a system binary from inside Decky's Python, without it exploding.

Always an argv list, never ``shell=True``, always a timeout, always keep
stderr. Nothing here may run on the asyncio loop; the caller hops to a thread
first.
"""

import os
import subprocess
import time

import decky


TIMEOUT_MARKER = "cheevodeck: timed out"
EXEC_MARKER = "cheevodeck: couldn't run the command"
CANCELLED_MARKER = "cheevodeck: cancelled"

CANCEL_POLL_SECONDS = 0.25


def system_env():
    """The environment a system binary needs, not the one this process inherited.

    Decky's Python is a PyInstaller bundle, and PyInstaller puts its own
    unpacked libraries on LD_LIBRARY_PATH so the frozen interpreter finds them.
    A child process inherits that, which means every system binary tries to
    load PyInstaller's bundled copies first, and they are older than what the
    system tools link against:

        systemd-escape: /tmp/_MEIhZfQs2/libcrypto.so.3: version
        `OPENSSL_3.4.0' not found (required by libsystemd-shared-257.7)

    PyInstaller stashes the real value in LD_LIBRARY_PATH_ORIG precisely so
    children can be handed it back. When there was no original the variable is
    dropped rather than emptied, since an empty LD_LIBRARY_PATH means "look in
    the current directory" to the loader.

    Nothing catches this off-device: the same code under system Python works
    fine, which is why it survives every test until it runs under Decky for
    real.
    """
    env = dict(os.environ)
    for key in ("LD_LIBRARY_PATH", "LD_PRELOAD"):
        original = env.pop(f"{key}_ORIG", None)
        if original:
            env[key] = original
        else:
            env.pop(key, None)
    return env


def run_command(argv, *, timeout, env=None, user=None, group=None, cancel=None):
    """Run ``argv`` and return ``(returncode, stdout, stderr)``.

    ``env`` replaces the environment outright rather than adding to it. Left
        None it
    is ``system_env()``, which is what a plain system binary wants. Cheevo
        Check's
    flatpak call passes its own minimal dict instead, which keeps PyInstaller's
    LD_LIBRARY_PATH out by construction rather than by scrubbing.

    ``user`` and ``group`` drop the child to another account. The backend runs
        as
    root, and two things follow: root can't see a ``--user`` flatpak, and
        anything
    root writes into the user's config becomes root-owned and breaks the app
        that owns
    it. Running as ``deck`` fixes both at once.

    ``cancel`` is a ``threading.Event`` that kills the child when it is set.
        Left
    None, which is every caller but Cheevo Check's archive extraction, this
        runs
    exactly the code it always did. That matters: the SMB service's error
        taxonomy
    matches on the markers above, and none of it should have to care that a
        second
    caller wanted to interrupt things.
    """
    if cancel is not None:
        return _run_interruptible(
            argv,
            timeout=timeout,
            env=system_env() if env is None else env,
            user=user,
            group=group,
            cancel=cancel,
        )

    try:
        completed = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=system_env() if env is None else env,
            user=user,
            group=group,
        )
    except subprocess.TimeoutExpired:
        return 124, "", f"{TIMEOUT_MARKER} after {timeout}s: {' '.join(argv)}"
    except OSError as exc:
        decky.logger.error("couldn't run %s (%s)", argv[0], exc)
        return 127, "", f"{EXEC_MARKER}: {exc}"
    return completed.returncode, completed.stdout or "", completed.stderr or ""


def _run_interruptible(argv, *, timeout, env, user, group, cancel):
    """run_command, but watching a cancel event while the child works.

    subprocess.run() blocks until the child exits and hands back no handle, so
    a cooperative cancel can't reach inside one. That is a problem when the
    child is 7z unpacking four gigabytes, because that is precisely when
    someone presses Stop. This polls instead.

    SIGKILL rather than a polite SIGTERM first: the only thing the child could
    tidy up is a half-written extraction, and the caller deletes that directory
    in a finally regardless. Asking nicely would just make stopping slower.
    """
    try:
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            user=user,
            group=group,
        )
    except OSError as exc:
        decky.logger.error("couldn't run %s (%s)", argv[0], exc)
        return 127, "", f"{EXEC_MARKER}: {exc}"

    deadline = time.monotonic() + timeout
    while True:
        try:
            out, err = proc.communicate(timeout=CANCEL_POLL_SECONDS)
        except subprocess.TimeoutExpired:
            if cancel.is_set():
                proc.kill()
                out, _ = proc.communicate()
                return 130, out or "", f"{CANCELLED_MARKER}: {' '.join(argv)}"
            if time.monotonic() >= deadline:
                proc.kill()
                out, _ = proc.communicate()
                return 124, out or "", f"{TIMEOUT_MARKER} after {timeout}s: {' '.join(argv)}"
            continue
        return proc.returncode, out or "", err or ""
