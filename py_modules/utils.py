"""
Stateless helpers shared by the rest of the backend.

These were previously methods on a ``HelpersMixin`` class, but none of them
actually needed ``self`` — they only operated on their arguments. Module-level
functions are the right shape and let other modules import the specific
helpers they use, which makes dependencies visible.
"""

import json
import os
import pwd
import ssl
from pathlib import Path
from typing import Any, Optional

import decky

try:
    import certifi
except Exception:
    certifi = None


class WalkYieldedForClear(Exception):
    pass


def load_json_file(path: Path, default: Any) -> Any:
    """Read a JSON file, returning ``default`` on any failure."""
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


_data_owner = None


def init_data_owner(*candidates) -> None:
    """Work out who should own the plugin's data files and cache it.

    The backend runs as root (the Dolphin controller-disable flag needs it), so
    anything we create lands root-owned, and a later unprivileged run — flag
    dropped, Decky tightens up, a user downgrades — then can't touch its own
    data. So we hand every file we write back to the user that owns the data dir.

    Tries each candidate path in order and takes the first that resolves to a
    non-root owner. A root-owned data root is the poisoned state this whole thing
    exists to undo, so it can never be the right answer to inherit — we skip past
    it to the user home. Falls back to the "deck" account, then gives up and
    leaves the helpers as no-ops rather than guessing wrong.
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


_chown_warned = False


def chown_to_data_owner(path) -> None:
    """Hand a file or dir we just created back to the data-dir owner.

    No-op unless we're actually root and we know the target, so an unprivileged
    build stays a silent pass instead of raising on every write. Best-effort by
    design: an exFAT/vFAT SD card carries no Unix ownership and os.chown fails
    there harmlessly, which must never propagate up a write path.
    """
    global _chown_warned

    if _data_owner is None:
        return
    try:
        if os.geteuid() != 0:
            return
        os.chown(path, _data_owner[0], _data_owner[1])
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


def lchown_to_data_owner(path) -> None:
    """The symlink version, and the reason it has to exist.

    chown_to_data_owner goes through os.chown, which follows the link — aimed at
    a symlink it would walk to the far end and take ownership of the mount point
    the link is pointing at, which is somebody else's business entirely. lchown
    stops at the link. Same best-effort shrug as its sibling: the link already
    works whoever owns it, since deleting one depends on the directory's
    permissions rather than the link's.
    """
    if _data_owner is None:
        return
    try:
        if os.geteuid() != 0:
            return
        os.lchown(path, _data_owner[0], _data_owner[1])
    except OSError:
        pass


def ensure_dir(path) -> None:
    """mkdir -p that also hands the created dir back to the data-dir owner.

    A root-owned directory is worse than a root-owned file: nothing running as
    the user can create anything inside it, so the lockout is total. Every store
    that builds a data dir goes through here so new stores get this for free.
    """
    path.mkdir(parents=True, exist_ok=True)
    chown_to_data_owner(path)


def save_json_file(path: Path, payload: Any, *, compact: bool = False) -> None:
    """Write ``payload`` as JSON to ``path``.

    Defaults to pretty-printed (indent=2) since that's what settings.json
    expects -- it's read by humans during debugging. Callers handling
    files that get rewritten on every mutation (tracked.json, mostly)
    can pass ``compact=True`` to skip the indentation. On a large dict
    that knocks ~60% off the serialize cost, and saves a third of the
    on-disk size too. The downside is the file isn't eyeball-friendly
    without piping it through ``jq``, which is fine for files we don't
    edit by hand.

    Writes go via a sibling ``.tmp`` file that gets renamed into place at
    the end, so a power loss or kill mid-write leaves the previous
    contents intact instead of a half-written file that ``json.loads``
    fails on. ``Path.replace`` is atomic on POSIX when the source and
    target live on the same filesystem, which is always the case here
    since the tmp file lives next to its target.
    """
    if compact:
        serialized = json.dumps(payload, separators=(",", ":"))
    else:
        serialized = json.dumps(payload, indent=2)
    ensure_dir(path.parent)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(serialized, encoding="utf-8")
    chown_to_data_owner(tmp)
    tmp.replace(path)


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
    """Coerce ``value`` to ``int``, falling back to ``default`` on failure."""
    try:
        return int(value)
    except (ValueError, TypeError, OverflowError):
        return default


def to_float(value: Any, default: float = 0.0) -> float:
    """Coerce ``value`` to ``float``, falling back to ``default`` on failure."""
    try:
        return float(value)
    except (ValueError, TypeError, OverflowError):
        return default


def ra_user_ref(row: Any) -> str:
    """Pick the value to put in RA's user slot for a friend (or any user row).

    RA's user slot takes a ULID exactly like it takes a username, and the
    ULID rides through a rename while a saved name goes stale -- so we query
    by ULID whenever the row carries one and only fall back to the name. This
    is the friend-side twin of the plugin's ``_active_ra_user``, which does
    the same for our own account. A non-dict row (or one with neither field)
    returns "" so callers can treat a missing ref like a missing name.
    """
    if not isinstance(row, dict):
        return ""
    ulid = str(row.get("ulid") or "").strip()
    return ulid or str(row.get("username", "")).strip()


def normalize_ra_comment(raw: Any) -> Optional[dict]:
    """Normalise a single comment row from RA's GetComments endpoint.

    RA mixes real user comments in with audit-log entries (badge edits,
    set promotions, type changes) authored by a system user literally
    named "Server". We drop those -- the spelling is always exactly
    "Server", case-sensitive, so a plain equality check is enough.
    Anything else gets re-keyed from PascalCase to camelCase for the
    frontend. Non-dict inputs return None so callers can skip them.

    Lives in utils because both aotw_service and game_comments_service
    use it -- keeping it here means the Server-filter rule has one home.
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
    """Return ``True`` when ``exc`` looks like a transient network failure."""
    text = str(exc or "").lower()
    return any(marker in text for marker in _NETWORK_ERROR_MARKERS)


def frontend_error(prefix: str, exc: Exception) -> str:
    """Return a user-facing message for a failed network call.

    The raw exception text is intentionally dropped from the return value —
    urllib/SSL traceback fragments read terribly in the UI, and they're often
    misleading too. Callers pass a complete sentence as ``prefix`` and that's
    what the user sees.

    The exception itself is logged here (with its type and message) so we
    have a real diagnostic trail without having to wire logging into every
    caller. This is the single chokepoint for "an outbound call failed".
    """
    decky.logger.exception("%s — %s (%s)", prefix, type(exc).__name__, exc)
    return prefix
