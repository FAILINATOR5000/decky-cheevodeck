"""Stateless helpers shared by the rest of the backend.

Module-level functions rather than methods, since none of them need an
instance: they only operate on their arguments, and this way other modules
import the specific helpers they use, which makes dependencies visible.
"""

import contextlib
import functools
import json
import os
import pwd
import re
import signal
import ssl
import stat
import threading
from pathlib import Path
from typing import Any, Optional

import decky

try:
    import certifi
except Exception:
    certifi = None


TAG_MAX_LEN = 32

TAG_PREFIX_PATTERN = re.compile(r"^\s*\[([^\]\n]{1,%d})\]\s*" % TAG_MAX_LEN)

NOTE_TEXT_MAX_LEN = 500
NOTE_STORED_MAX_LEN = NOTE_TEXT_MAX_LEN + TAG_MAX_LEN + 2

_UNSAFE_TEXT_CHARS = r"\x00-\x1f\x7f-\x9f\xad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff"

TAG_STRIP_PATTERN = re.compile(r"[\[\]%s]" % _UNSAFE_TEXT_CHARS)

_LEADING_RUN_PATTERN = re.compile(r"[\s%s]*" % _UNSAFE_TEXT_CHARS)

_RESERVED_TAG_KEYS = frozenset({"completed"})


def clean_bulk_tag(raw):
    tag = str(raw or "").strip()[:TAG_MAX_LEN].strip()
    if not tag or TAG_STRIP_PATTERN.search(tag) or tag.lower() in _RESERVED_TAG_KEYS:
        return None
    return tag


def clean_tag_prefix(text):
    text = text[_LEADING_RUN_PATTERN.match(text).end():]
    match = TAG_PREFIX_PATTERN.match(text)
    if match is None:
        return text
    inside = TAG_STRIP_PATTERN.sub("", match.group(1))
    return text[:match.start(1)] + inside + text[match.end(1):]


class WalkYieldedForClear(Exception):
    pass


class WalkBusy(Exception):
    pass


def load_json_file(path: Path, default: Any) -> Any:
    """Read a JSON file, returning ``default`` on any failure.

    A file that is there and will not read is worth a line, because the caller
    cannot tell that answer apart from a file that was never written: both come
    back as the default. Settings go through here, so the difference is every
    knob quietly back at its factory value.
    """
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        decky.logger.error(
            "%s is there but would not read (%s), falling back to defaults",
            path.name, type(e).__name__,
        )
        return default


class NewerSchemaFile(Exception):
    pass


def is_newer_schema(raw: Any, current: int, key: str = "schemaVersion") -> bool:
    return isinstance(raw, dict) and to_int(raw.get(key, 0), 0) > current


_newer_schema_listener = None
_newer_schema_reported: set = set()
_newer_schema_lock = threading.Lock()


def set_newer_schema_listener(listener) -> None:
    global _newer_schema_listener
    _newer_schema_listener = listener


def report_newer_schema(path: Path) -> None:
    listener = _newer_schema_listener
    with _newer_schema_lock:
        if str(path) in _newer_schema_reported:
            return
        if listener is not None:
            _newer_schema_reported.add(str(path))
    decky.logger.warning(
        "%s was saved by a newer CheevoDeck; showing it as empty and leaving it untouched",
        path,
    )
    if listener is None:
        return
    try:
        listener()
    except Exception as exc:
        decky.logger.warning("newer-schema toast failed (%s: %s)", type(exc).__name__, exc)


def refuse_newer_file(path: Path, current: int, key: str = "schemaVersion") -> None:
    if not path.exists():
        return
    if is_newer_schema(load_json_file(path, None), current, key):
        report_newer_schema(path)
        raise NewerSchemaFile(str(path))


def refuses_newer_schema(method):
    @functools.wraps(method)
    def wrapper(*args, **kwargs):
        try:
            return method(*args, **kwargs)
        except NewerSchemaFile:
            return {"ok": False, "error": "newer_schema"}
    return wrapper


_data_owner = None


def init_data_owner(*candidates) -> None:
    """Work out who should own the plugin's data files and cache it.

    The backend runs as root, because the Dolphin controller-disable flag needs
    it, so anything created here lands root-owned and a later unprivileged run
    can't touch its own data. Every file written is handed back to the user
    that owns the data directory.

    Tries each candidate path in order and takes the first that resolves to a
    non-root owner. A root-owned data root is the state this whole thing exists
    to undo, so it can never be the right answer to inherit and gets skipped in
    favour of the user home. Falls back to the "deck" account, then gives up
    and leaves the helpers as no-ops rather than guessing wrong.
    """
    global _data_owner
    for path in candidates:
        try:
            st = path.stat()
        except OSError:
            continue
        if st.st_uid != 0:
            _data_owner = (st.st_uid, st.st_gid)
            return
    try:
        pw = pwd.getpwnam("deck")
        _data_owner = (pw.pw_uid, pw.pw_gid)
        return
    except (KeyError, OSError):
        pass
    _data_owner = None


def child_owner():
    if _data_owner is None or os.geteuid() != 0:
        return None
    return _data_owner


_chown_warned = False


def chown_to_data_owner(path, dir_fd=None) -> None:
    """Hand a newly created file or directory back to the data-dir owner.

    A no-op unless the process is actually root and the target is known, so an
    unprivileged build stays a silent pass instead of raising on every write.
    Best-effort by design: an exFAT or vFAT SD card carries no Unix ownership
    and os.chown fails there harmlessly, which must never propagate up a write
    path.
    """
    global _chown_warned

    if _data_owner is None:
        return
    try:
        if os.geteuid() != 0:
            return
        if isinstance(path, int):
            os.fchown(path, _data_owner[0], _data_owner[1])
        else:
            os.chown(path, _data_owner[0], _data_owner[1], dir_fd=dir_fd, follow_symlinks=False)
    except OSError as exc:
        if not _chown_warned:
            _chown_warned = True
            decky.logger.warning(
                "chown back to the data owner failed (%s: %s) for %s; "
                "further failures this session stay quiet",
                type(exc).__name__,
                exc,
                path,
            )


_write_roots = ()


def set_write_roots(*roots) -> None:
    global _write_roots
    _write_roots = tuple(Path(root) for root in roots)


def add_write_root(root) -> None:
    global _write_roots
    root = Path(root)
    if root not in _write_roots:
        _write_roots = _write_roots + (root,)


def _root_for(path):
    best = None
    for root in _write_roots:
        if path.is_relative_to(root) and (best is None or len(root.parts) > len(best.parts)):
            best = root
    return best


_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC


def _levels_below(path, trusted):
    try:
        below = path.relative_to(trusted).parts
    except ValueError:
        raise PermissionError(f"{path} is not under {trusted}") from None
    if ".." in below:
        raise PermissionError(f"{path} climbs out of {trusted}")
    return below


def open_dir(path, trusted=None) -> int:
    path = Path(path)
    if trusted is None:
        trusted = _root_for(path)
    if trusted is None:
        return os.open(path, _DIR_FLAGS | os.O_NOFOLLOW)
    below = _levels_below(path, trusted)
    fd = os.open("/", _DIR_FLAGS)
    try:
        for part in Path(os.path.realpath(trusted)).parts[1:] + below:
            inner = os.open(part, _DIR_FLAGS | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = inner
    except BaseException:
        os.close(fd)
        raise
    return fd


def ensure_dir(path, trusted=None) -> None:
    """mkdir -p that also hands the created dirs back to the data-dir owner.

    A root-owned directory is worse than a root-owned file: nothing running as
    the user can create anything inside it, so the lockout is total. Every store
    that builds a data dir goes through here so new stores get this for free.

    Every level this call creates is handed back, not only the leaf. A caller
    reaching three levels down in one go would otherwise leave the two above it
    owned by root. Levels that were already there keep whoever owns them.
    """
    path = Path(path)
    if trusted is None:
        trusted = _root_for(path)
    if trusted is None or trusted == path:
        made = []
        probe = path
        while not probe.exists() and probe.parent != probe:
            made.append(probe)
            probe = probe.parent
        path.mkdir(parents=True, exist_ok=True)
        for level in made:
            chown_to_data_owner(level)
        return
    ensure_dir(trusted, trusted)
    fd = open_dir(trusted, trusted)
    try:
        for part in _levels_below(path, trusted):
            try:
                os.mkdir(part, 0o777, dir_fd=fd)
                created = True
            except FileExistsError:
                created = False
            inner = os.open(part, _DIR_FLAGS | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = inner
            if created:
                chown_to_data_owner(fd)
    finally:
        os.close(fd)


def _unlink_at(name, dir_fd) -> None:
    try:
        os.unlink(name, dir_fd=dir_fd)
    except FileNotFoundError:
        pass


@contextlib.contextmanager
def atomic_file(path, *, trusted=None, suffix=".tmp", owner=None, mode=0o666, keep_mode=None, tmp_name=None):
    path = Path(path)
    dir_fd = open_dir(path.parent, trusted)
    tmp = tmp_name or path.name + suffix
    try:
        _unlink_at(tmp, dir_fd)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode, dir_fd=dir_fd)
        try:
            if owner is None:
                chown_to_data_owner(fd)
            elif os.geteuid() == 0:
                try:
                    os.fchown(fd, owner[0], owner[1])
                except OSError:
                    pass
            if keep_mode is not None:
                os.fchmod(fd, keep_mode)
            with os.fdopen(fd, "wb") as out:
                yield out
            os.replace(tmp, path.name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        except BaseException:
            _unlink_at(tmp, dir_fd)
            raise
    finally:
        os.close(dir_fd)


def user_file_target(path, owner=None) -> Path:
    real = Path(os.path.realpath(path))
    if owner is None:
        return real
    try:
        st = os.lstat(real)
    except FileNotFoundError:
        st = os.lstat(real.parent)
    if st.st_uid != owner[0]:
        raise PermissionError(f"{real} does not belong to the user")
    return real


@contextlib.contextmanager
def exclusive_file(path, *, trusted=None, replace=False):
    path = Path(path)
    dir_fd = open_dir(path.parent, trusted)
    try:
        if replace:
            _unlink_at(path.name, dir_fd)
        fd = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o666, dir_fd=dir_fd)
        try:
            chown_to_data_owner(fd)
            with os.fdopen(fd, "wb") as out:
                yield out
        except BaseException:
            _unlink_at(path.name, dir_fd)
            raise
    finally:
        os.close(dir_fd)


def append_file(path, text, *, trusted=None) -> None:
    path = Path(path)
    flags = os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_CLOEXEC
    dir_fd = open_dir(path.parent, trusted)
    try:
        try:
            fd = os.open(path.name, flags | os.O_CREAT | os.O_EXCL, 0o666, dir_fd=dir_fd)
            chown_to_data_owner(fd)
        except FileExistsError:
            fd = os.open(path.name, flags, dir_fd=dir_fd)
        with os.fdopen(fd, "ab") as out:
            out.write(text.encode("utf-8"))
    finally:
        os.close(dir_fd)


def write_user_file(path, data, *, folder, mode=None) -> None:
    path = Path(path)
    if isinstance(data, str):
        data = data.encode("utf-8")
    trusted = folder
    if path.is_symlink():
        path = user_file_target(path, child_owner())
        trusted = path.parent
    keep = mode
    if keep is None:
        try:
            st = os.lstat(path)
            if stat.S_ISREG(st.st_mode):
                keep = stat.S_IMODE(st.st_mode)
        except FileNotFoundError:
            pass
    with atomic_file(path, trusted=trusted, keep_mode=keep, tmp_name="." + path.name + ".cheevodeck-tmp") as out:
        out.write(data)


def write_file_atomic(path, data, *, trusted=None) -> None:
    if isinstance(data, str):
        data = data.encode("utf-8")
    with atomic_file(path, trusted=trusted) as out:
        out.write(data)


def save_json_file(path: Path, payload: Any, *, compact: bool = False) -> None:
    """Write ``payload`` as JSON to ``path``.

    Pretty-printed by default, indent=2, since that is what settings.json
    wants: a person reads it while debugging. Callers handling files that get
    rewritten on every mutation can pass ``compact=True`` to skip the
    indentation, which on a large dict knocks about 60% off the serialize cost
    and a third off the on-disk size. The downside is a file that needs `jq` to
    read, which is fine for files nobody edits by hand.

    Writes go via a sibling ``.tmp`` file renamed into place at the end, so a
    power loss or a kill mid-write leaves the previous contents intact instead
    of a half-written file that ``json.loads`` chokes on. ``Path.replace`` is
    atomic on POSIX when source and target share a filesystem, which is always
    the case here since the tmp file lives next to its target.
    """
    if compact:
        serialized = json.dumps(payload, separators=(",", ":"))
    else:
        serialized = json.dumps(payload, indent=2)
    ensure_dir(path.parent)
    write_file_atomic(path, serialized)


def ssl_context() -> ssl.SSLContext:
    """Build an SSL context, preferring certifi's CA bundle when available."""
    if certifi is not None:
        try:
            return ssl.create_default_context(cafile=certifi.where())
        except OSError:
            pass
    return ssl.create_default_context()


def norm_game_id(value: Any) -> Optional[int]:
    """Coerce a possibly-stringy game id to ``int``, or ``None`` if invalid."""
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError, OverflowError):
        try:
            return int(str(value).strip())
        except (ValueError, TypeError, OverflowError):
            return None


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (ValueError, TypeError, OverflowError):
        return default


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (ValueError, TypeError, OverflowError):
        return default


def ra_user_ref(row: Any) -> str:
    """Pick the value to put in RA's user slot for a friend, or any user row.

    RA's user slot takes a ULID exactly like it takes a username, and the ULID
    rides through a rename while a saved name goes stale, so the query goes by
    ULID whenever the row carries one and only falls back to the name. This is
    the friend-side twin of ``_active_ra_user``, which does the same for the
    signed-in account. A non-dict row, or one with neither field, returns "" so
    callers can treat a missing ref like a missing name.
    """
    if not isinstance(row, dict):
        return ""
    ulid = str(row.get("ulid") or "").strip()
    return ulid or str(row.get("username", "")).strip()


def normalize_ra_comment(raw: Any) -> Optional[dict]:
    """Normalise a single comment row from RA's GetComments endpoint.

    RA mixes real user comments in with audit-log entries (badge edits, set
    promotions, type changes) authored by a system user literally named
    "Server". Those are dropped: the spelling is always exactly "Server",
    case-sensitive, so a plain equality check is enough. Anything else gets
    re-keyed from PascalCase to camelCase for the frontend. Non-dict inputs
    return None so callers can skip them.

    Lives in utils because both aotw_service and game_comments_service use it,
    which keeps the Server filter in one place.
    """
    if not isinstance(raw, dict):
        return None
    if raw.get("User") == "Server":
        return None
    return {
        "user": raw.get("User"),
        "ulid": raw.get("ULID"),
        "submitted": raw.get("Submitted"),
        "commentText": raw.get("CommentText"),
    }


def format_completion_percent(earned_count: Any, total_count: Any) -> str:
    """Format an earned/total pair as a percentage string like ``"42%"``."""
    total = to_int(total_count, 0)
    earned = to_int(earned_count, 0)
    if total <= 0:
        return "0%"
    pct = (earned / total) * 100.0
    if abs(pct - round(pct)) < 1e-9:
        return f"{int(round(pct))}%"
    return f"{pct:.2f}".rstrip("0").rstrip(".") + "%"


_NETWORK_ERROR_MARKERS = (
    "temporary failure in name resolution",
    "name resolution",
    "nodename nor servname provided",
    "failed to resolve",
    "timed out",
    "timeout",
    "connection reset",
    "connection refused",
    "network is unreachable",
    "remote end closed connection",
    "ssl",
    "urlopen error",
)


def is_network_error(exc: Exception) -> bool:
    text = str(exc or "").lower()
    return any(marker in text for marker in _NETWORK_ERROR_MARKERS)


def frontend_error(prefix: str, exc: Exception) -> str:
    """Return a user-facing message for a failed network call.

    The raw exception text is intentionally dropped from the return value.
    urllib and SSL traceback fragments read terribly in the UI and are often
    misleading. Callers pass a complete sentence as ``prefix`` and that is what
    the user sees.

    The exception itself is logged here, with its type and message, so there is
    a real diagnostic trail without logging having to be wired into every
    caller. This is the single chokepoint for an outbound call failing.
    """
    decky.logger.exception("%s — %s (%s)", prefix, type(exc).__name__, exc)
    return prefix


def kill_steamwebhelper() -> int:
    killed = 0
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            comm = Path(f"/proc/{entry}/comm").read_text().strip()
        except OSError:
            continue
        if comm != "steamwebhelper":
            continue
        try:
            os.kill(int(entry), signal.SIGKILL)
        except OSError:
            continue
        killed += 1
    return killed


STORMBREAKER_WATCHDOG_LOCK = "/tmp/stormbreaker-watchdog.lock"


def stormbreaker_plugin_runs_watchdog() -> bool:
    try:
        import fcntl
    except ImportError:
        return False
    try:
        fd = os.open(STORMBREAKER_WATCHDOG_LOCK, os.O_RDONLY)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return True
    else:
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    finally:
        os.close(fd)
