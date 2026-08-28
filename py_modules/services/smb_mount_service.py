from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import json
import os
import re
import socket
import tempfile
import threading
import time

import decky
import subprocess_util

from smb_shares_store import is_safe_slug


MOUNT_ROOT = Path("/run/media/cheevodeck")

CONFIG_DIR = Path("/etc/cheevodeck/smb")

UNIT_DIR = Path("/etc/systemd/system")

KEEP_LIST_PATH = Path("/etc/atomic-update.conf.d/cheevodeck-smb.conf")

KEEP_LIST_BODY = """## CheevoDeck SMB Shares. Valve's default keep list already preserves
## /etc/systemd/system/*.mount but not *.automount, and knows nothing about
## our credentials directory.
/etc/systemd/system/*.automount
/etc/cheevodeck/**
"""

SMB_PORT = 445

SMBCLIENT = Path("/usr/bin/smbclient")

SMBCLIENT_TIMEOUT_SECONDS = 15

VERIFY_TMP_DIR = Path("/run")

SMB_FS_TYPES = ("cifs", "smb3")

PROBE_TIMEOUT_SECONDS = 3.0

PROBE_CACHE_SECONDS = 20

UNIT_TIMEOUT_SECONDS = 20

SYSTEMCTL_TIMEOUT_SECONDS = 30

SYSTEMCTL_QUERY_TIMEOUT_SECONDS = 10

BUSY_CHECK_TIMEOUT_SECONDS = 5

STOP_BUDGET_SECONDS = 30

REARM_RETRY_SECONDS = 30
REARM_MAX_ATTEMPTS = 3

DEAD_MOUNT_GRACE_SECONDS = 60

UNREACHABLE_STOP_TIMEOUT_SECONDS = 5

AUTOMOUNT_IDLE_SECONDS = 600

MOUNT_UID = 1000
MOUNT_GID = 1000

_OUR_TIMEOUT_MARKER = subprocess_util.TIMEOUT_MARKER
_OUR_EXEC_MARKER = subprocess_util.EXEC_MARKER

_SHARE_LIST_RE = re.compile(r"^Disk\|([^|]*)", re.IGNORECASE)

_UNIT_WHAT_RE = re.compile(r"^What=//([^/]+)/(.+)$", re.MULTILINE)
_UNIT_WHERE_RE = re.compile(r"^Where=(.+)$", re.MULTILINE)
_UNIT_OPTIONS_RE = re.compile(r"^Options=(.+)$", re.MULTILINE)

_ERROR_SIGNATURES = (
    (_OUR_TIMEOUT_MARKER, "timed_out"),
    (_OUR_EXEC_MARKER, "system_error"),
    ("STATUS_LOGON_FAILURE", "bad_credentials"),
    ("STATUS_ACCOUNT_DISABLED", "bad_credentials"),
    ("STATUS_PASSWORD_EXPIRED", "bad_credentials"),
    ("STATUS_BAD_NETWORK_NAME", "share_not_found"),
    ("STATUS_ACCESS_DENIED", "access_denied"),
    ("Permission denied", "bad_credentials"),
    ("Protocol not supported", "dialect_unsupported"),
    ("No such device", "dialect_unsupported"),
    ("Connection timed out", "no_response"),
    ("Host is down", "no_response"),
    ("Network is unreachable", "not_reachable"),
    ("No route to host", "not_reachable"),
    ("could not connect to", "not_reachable"),
    ("Unable to find suitable address", "not_reachable"),
    ("No such file or directory", "share_not_found"),
    ("Operation not supported", "dialect_unsupported"),
    ("Invalid argument", "dialect_unsupported"),
    ("target is busy", "busy"),
    ("Device or resource busy", "busy"),
    ("does not exist", "units_missing"),
    ("not found.", "units_missing"),
)

_MOUNT_ERRNO_CODES = {
    1: "access_denied",
    2: "share_not_found",
    5: "no_response",
    13: "bad_credentials",
    22: "dialect_unsupported",
    95: "dialect_unsupported",
    101: "not_reachable",
    110: "no_response",
    111: "not_reachable",
    112: "no_response",
    113: "not_reachable",
    115: "not_reachable",
}

_MOUNT_ERRNO_RE = re.compile(r"mount error\((\d+)\)")


class SmbMountService:
    """Everything in the SMB Shares feature that touches the system.

    Slug-to-unit-name translation, unit rendering, the credentials and sidecar
    files, systemd invocation, the reachability probe, status reading, and
    teardown. It is not a daemon -- nothing here ticks; the page calls in and
    the methods run to completion on a worker thread.

    Keeping this out of the mixin is the point: the mixin is thin IPC glue, and
    this module is where the entire blast radius of the feature lives.

    Everything that talks to systemd goes through one lock. daemon-reload is
    global state, so two toggles racing each other would be reading and writing
    the same thing from two threads.
    """

    def __init__(self, *, debug_logging=None):
        self._lock = threading.RLock()
        self._unit_names = {}
        self._unit_glob_pattern = None
        self._probe_cache = {}
        self._rearm_attempts = {}
        self._rearm_counts = {}
        self._unreachable_since = {}
        self._probe_cache_lock = threading.Lock()
        self._last_error = {}
        self._debug_logging = debug_logging or (lambda: False)

    def _debug(self, message, *args):
        if self._debug_logging():
            decky.logger.info("smb: " + message, *args)

    def _run(self, argv, *, timeout):
        return subprocess_util.run_command(argv, timeout=timeout)

    def _systemctl(self, *args, timeout=SYSTEMCTL_QUERY_TIMEOUT_SECONDS):
        return self._run(["systemctl", *args], timeout=timeout)

    def _failure_text(self, unit: str, stderr: str) -> str:
        """What actually went wrong with a unit, which is not what systemctl said.

        This is the hole the whole error taxonomy was falling through. When a
        mount fails, `systemctl start` does not relay the mount helper's stderr.
        It prints its own line:

            Job for run-media-cheevodeck-x.mount failed.
            See "systemctl status ..." and "journalctl -xeu ..." for details.

        and the message that matters, `mount error(13): Permission denied`, goes
        to the journal instead. So every signature in the table was being
        matched against text that could never contain one, and every real
        failure came out as "generic". Captured on device: three consecutive
        wrong-password mounts, all of them reported to the user as "something
        went wrong".

        Scoped to the unit's current InvocationID rather than the last N lines,
        so a previous failure's text can't be read as this attempt's.
        """
        code, invocation, _ = self._systemctl("show", "--property=InvocationID", "--value", unit)
        invocation = invocation.strip()
        if code != 0 or not invocation:
            return stderr

        code, out, _ = self._run(
            ["journalctl", f"_SYSTEMD_INVOCATION_ID={invocation}", "--output=cat", "--no-pager"],
            timeout=SYSTEMCTL_QUERY_TIMEOUT_SECONDS,
        )
        if code != 0 or not out.strip():
            return stderr
        return f"{out}\n{stderr}"

    def _daemon_reload(self):
        code, _, err = self._systemctl("daemon-reload")
        if code != 0:
            decky.logger.warning("smb: daemon-reload failed (%s)", err.strip())
        return code == 0

    def mount_point(self, slug: str) -> Path:
        if not is_safe_slug(slug):
            raise ValueError(f"unsafe slug: {slug!r}")
        return MOUNT_ROOT / slug

    def unit_names(self, slug: str):
        """The .mount and .automount filenames for a slug.

        systemd rejects a unit whose filename doesn't match its Where=, and the
        escaping rules have enough corners that hand-building the name is a bug
        waiting to happen. So we ask systemd-escape and cache the answer, which
        is safe because a slug never changes.
        """
        cached = self._unit_names.get(slug)
        if cached is not None:
            return cached

        path = str(self.mount_point(slug))
        code, out, err = self._run(
            ["systemd-escape", "--path", "--suffix=mount", path],
            timeout=SYSTEMCTL_QUERY_TIMEOUT_SECONDS,
        )
        if code != 0 or not out.strip():
            raise RuntimeError(f"systemd-escape failed for {path}: {err.strip()}")
        mount_unit = out.strip()
        automount_unit = mount_unit[: -len(".mount")] + ".automount"
        names = (mount_unit, automount_unit)
        self._unit_names[slug] = names
        return names

    def unit_paths(self, slug: str):
        mount_unit, automount_unit = self.unit_names(slug)
        return UNIT_DIR / mount_unit, UNIT_DIR / automount_unit

    def _unit_glob(self) -> str:
        """The pattern that matches every unit we could have written.

        Escaped from MOUNT_ROOT rather than spelled out, so it can't drift away
        from the names unit_names actually produces. Cached for the same reason
        unit_names is: it's derived from a constant, and the page's status
        poller reaches this often enough that spawning systemd-escape for it
        every few seconds would be silly.
        """
        if self._unit_glob_pattern is not None:
            return self._unit_glob_pattern

        code, out, err = self._run(
            ["systemd-escape", "--path", str(MOUNT_ROOT)],
            timeout=SYSTEMCTL_QUERY_TIMEOUT_SECONDS,
        )
        if code != 0 or not out.strip():
            raise RuntimeError(f"systemd-escape failed for {MOUNT_ROOT}: {err.strip()}")
        self._unit_glob_pattern = f"{out.strip()}-*.mount"
        return self._unit_glob_pattern

    def credentials_path(self, slug: str) -> Path:
        if not is_safe_slug(slug):
            raise ValueError(f"unsafe slug: {slug!r}")
        return CONFIG_DIR / f"{slug}.cred"

    def sidecar_path(self, slug: str) -> Path:
        if not is_safe_slug(slug):
            raise ValueError(f"unsafe slug: {slug!r}")
        return CONFIG_DIR / f"{slug}.json"

    def _mount_options(self, share: dict) -> str:
        slug = share["slug"]
        options = []
        if share.get("username") or share.get("hasPassword"):
            options.append(f"credentials={self.credentials_path(slug)}")
        else:
            options.append("guest")

        options.append(f"uid={MOUNT_UID}")
        options.append(f"gid={MOUNT_GID}")
        options.append("file_mode=0664")
        options.append("dir_mode=0775")

        options.append("soft" if share.get("softMount", True) else "hard")
        options.append("noatime")

        vers = share.get("vers", "auto")
        if vers != "auto":
            options.append(f"vers={vers}")

        return ",".join(options)

    def render_mount_unit(self, share: dict) -> str:
        return (
            "[Unit]\n"
            f"Description=CheevoDeck SMB share: {share['name']}\n"
            "After=network-online.target\n"
            "Wants=network-online.target\n"
            "\n"
            "[Mount]\n"
            f"What=//{share['server']}/{share['share']}\n"
            f"Where={self.mount_point(share['slug'])}\n"
            "Type=cifs\n"
            f"Options={self._mount_options(share)}\n"
            f"TimeoutSec={UNIT_TIMEOUT_SECONDS}\n"
        )

    def render_automount_unit(self, share: dict) -> str:
        return (
            "[Unit]\n"
            f"Description=CheevoDeck SMB share (automount): {share['name']}\n"
            "\n"
            "[Automount]\n"
            f"Where={self.mount_point(share['slug'])}\n"
            f"TimeoutIdleSec={AUTOMOUNT_IDLE_SECONDS}\n"
            "\n"
            "[Install]\n"
            "WantedBy=multi-user.target\n"
        )

    def render_credentials(self, *, username: str, password: str, domain: str) -> str:
        lines = []
        if username:
            lines.append(f"username={username}")
        if password:
            lines.append(f"password={password}")
        if domain:
            lines.append(f"domain={domain}")
        return "".join(f"{line}\n" for line in lines)

    def _write_private(self, path: Path, body: str) -> None:
        """Write a root-only file.

        Deliberately not chown_to_data_owner: that helper exists because the
        frontend and other processes need to read plugin data, and nothing but
        root reads these. On a single-user SteamOS box the deck account is the
        real trust boundary, and RetroArch's flatpak holds host filesystem
        access, so anything readable by deck is readable by things the user
        runs. 0600 root:root is meaningfully better here.
        """
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        os.chmod(CONFIG_DIR, 0o700)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(body, encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(path)

    def write_credentials(self, share: dict, password: str) -> None:
        slug = share["slug"]
        username = share.get("username") or ""
        if not username and not password:
            self.remove_credentials(slug)
            return
        body = self.render_credentials(
            username=username,
            password=password,
            domain=share.get("domain") or "",
        )
        self._write_private(self.credentials_path(slug), body)

    def saved_password(self, slug: str) -> str:
        """Read a share's password back out of its own credentials file.

        An edit that leaves the password field blank still has to rewrite that
        file, because the username and the domain live in it too, and the file
        is the only place the password exists. So keeping it means reading it.
        Nothing may log the return value.
        """
        try:
            body = self.credentials_path(slug).read_text(encoding="utf-8")
        except OSError:
            return ""
        for line in body.splitlines():
            if line.startswith("password="):
                return line[len("password="):]
        return ""

    def remove_credentials(self, slug: str) -> None:
        try:
            self.credentials_path(slug).unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            decky.logger.warning("smb: couldn't remove credentials for %s (%s)", slug, exc)

    def write_sidecar(self, share: dict) -> None:
        """Mirror the record next to the credentials, minus the password.

        This is what makes the on-disk system state self-describing, and it is
        what makes smb_shares.json a cache rather than the source of truth. A
        factory reset empties the plugin's runtime dir; this survives it, and so
        does a reinstall.
        """
        payload = {
            key: share.get(key)
            for key in ("id", "slug", "name", "server", "share", "username", "domain", "vers", "softMount", "createdAt")
        }
        self._write_private(self.sidecar_path(share["slug"]), json.dumps(payload, indent=2) + "\n")

    def remove_sidecar(self, slug: str) -> None:
        try:
            self.sidecar_path(slug).unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            decky.logger.warning("smb: couldn't remove sidecar for %s (%s)", slug, exc)

    def write_keep_list(self) -> None:
        """Idempotent; rewriting is fine.

        The shipped example file next to ours carries a loud warning about
        whitelisting /etc, and it is warning about shadowing upstream files:
        whitelist a Valve-managed config and your local copy masks their future
        updates forever. /etc/cheevodeck/** is a private subdirectory with no
        upstream counterpart, so there is nothing to shadow. Different
        situation.
        """
        try:
            KEEP_LIST_PATH.parent.mkdir(parents=True, exist_ok=True)
            KEEP_LIST_PATH.write_text(KEEP_LIST_BODY, encoding="utf-8")
            os.chmod(KEEP_LIST_PATH, 0o644)
        except OSError as exc:
            decky.logger.warning("smb: couldn't write the update keep list (%s)", exc)

    def remove_keep_list(self) -> None:
        try:
            KEEP_LIST_PATH.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            decky.logger.warning("smb: couldn't remove the update keep list (%s)", exc)

    def ensure_mount_point(self, slug: str) -> None:
        """Make the mount point, and hand it to the user.

        systemd creates these itself (confirmed on device), so the mkdir is
        belt and braces. The chown is not: an unmounted mount point is a real
        empty directory, and systemd leaves it root-owned, so the path flips
        between root:root while the share is off and deck:deck while it is
        mounted -- because uid=/gid= only apply to the mount on top. Anything
        that walks the path with the share disabled sees a directory it can't
        write, and the ownership changing underneath is the kind of thing that
        confuses a scanner far more than an empty folder does. Owning it as
        deck throughout costs nothing and keeps the path consistent.
        """
        point = self.mount_point(slug)
        if self.is_mounted(slug):
            return
        try:
            point.mkdir(parents=True, exist_ok=True)
            os.chmod(MOUNT_ROOT, 0o755)
        except OSError as exc:
            decky.logger.warning("smb: couldn't create the mount point %s (%s)", point, exc)
            return
        self._own_empty_mount_point(point)

    def _own_empty_mount_point(self, point) -> None:
        """chmod and chown the mount point, and only ever the empty local one.

        The check above reads /proc/mounts, which is a check against a path, and
        a path can have something mounted on it a microsecond later. That window
        is tiny and the consequence is not: while a share is mounted this path
        is the share's root on the server, so a chown landing in that window
        would be a metadata write to somebody's NAS.

        So this works on a file descriptor instead. An open fd stays bound to
        the inode it opened -- mounting something over the path afterwards does
        not redirect it -- which means the fchown below can only ever reach the
        empty local directory, whatever happens in between.

        The device-number comparison covers the other half: if something was
        already mounted when we opened it, the fd is the mounted filesystem's
        root and its st_dev differs from the tmpfs parent's, so we leave it
        alone. Same filesystem as the parent means it really is our own empty
        directory.
        """
        try:
            fd = os.open(point, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except OSError as exc:
            self._debug("couldn't open the mount point %s (%s)", point, exc)
            return
        try:
            if os.fstat(fd).st_dev != os.stat(MOUNT_ROOT).st_dev:
                self._debug("%s has something mounted on it, leaving it alone", point)
                return
            os.fchmod(fd, 0o755)
            os.fchown(fd, MOUNT_UID, MOUNT_GID)
        except OSError as exc:
            self._debug("couldn't own the mount point %s (%s)", point, exc)
        finally:
            os.close(fd)

    def write_units(self, share: dict) -> None:
        mount_path, automount_path = self.unit_paths(share["slug"])
        mount_path.write_text(self.render_mount_unit(share), encoding="utf-8")
        os.chmod(mount_path, 0o644)
        automount_path.write_text(self.render_automount_unit(share), encoding="utf-8")
        os.chmod(automount_path, 0o644)

    def _mounted_paths(self) -> set:
        """Paths carrying a real SMB mount right now, straight from the kernel.

        Match on the filesystem type, not just the path. An armed .automount
        registers an autofs entry at its own mount point whether or not the
        share behind it is mounted, so matching the path alone would report
        every enabled share as permanently mounted -- the idle and unreachable
        states would never appear and the status line would be decorative.
        When the share really is mounted both entries sit at the same path, the
        autofs one and the cifs one, so looking for cifs is what tells them
        apart.

        Read fresh every time and never cached as truth: the user can umount
        from Konsole, and the honest answer is that the share is idle and the
        next access will remount it.
        """
        paths = set()
        try:
            raw = Path("/proc/mounts").read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            decky.logger.warning("smb: couldn't read /proc/mounts (%s)", exc)
            return paths

        for line in raw.splitlines():
            fields = line.split()
            if len(fields) < 3 or fields[2] not in SMB_FS_TYPES:
                continue
            paths.add(fields[1].replace("\\040", " ").replace("\\011", "\t"))
        return paths

    def _anything_mounted_at(self, point) -> bool:
        """Is there any mount at this path at all, whatever kind.

        is_mounted deliberately asks a narrower question -- is there a *cifs*
        mount here -- because an armed automount leaves an autofs stub at the
        same path and counting that would make every enabled share look
        permanently mounted. Removing the directory is the one job that needs
        the broader question: rmdir refuses while anything is mounted there,
        autofs stub included, which is how a deleted share kept its folder.
        """
        target = str(point)
        try:
            raw = Path("/proc/mounts").read_text(encoding="utf-8", errors="replace")
        except OSError:
            return False
        for line in raw.splitlines():
            fields = line.split()
            if len(fields) >= 2 and fields[1].replace("\\040", " ") == target:
                return True
        return False

    def is_mounted(self, slug: str, mounted_paths=None) -> bool:
        if mounted_paths is None:
            mounted_paths = self._mounted_paths()
        return str(self.mount_point(slug)) in mounted_paths

    def unit_state(self, slug: str) -> dict:
        """Everything systemd will tell us about a share's automount, in one call.

        This used to be `is-enabled`, which answers exactly one question: does
        the enable symlink exist. That is the toggle's question and it is not
        the status line's. Two real situations slip straight past it:

        an armed automount can be stopped without being disabled (someone runs
        systemctl stop by hand, or umounts the path while the share is idle,
        which unmounts the autofs stub that *is* what sits there when idle) and

        the unit file can vanish under us, which is what a SteamOS update that
        didn't honour our keep-list drop-in would look like.

        Both leave the symlink in place, so both used to read as a perfectly
        healthy idle share while nothing would ever mount. Asking for the three
        properties together costs one subprocess, the same as the one question
        did.
        """
        mount_unit, automount_unit = self.unit_names(slug)
        code, out, _ = self._systemctl(
            "show",
            "--property=Id",
            "--property=LoadState",
            "--property=ActiveState",
            "--property=UnitFileState",
            automount_unit,
            mount_unit,
        )
        blocks = {}
        current = {}
        for line in out.splitlines():
            if not line.strip():
                current = {}
                continue
            key, _, value = line.partition("=")
            current[key.strip()] = value.strip()
            if key.strip() == "Id":
                blocks[value.strip()] = current

        trigger = blocks.get(automount_unit, {})
        mount = blocks.get(mount_unit, {})

        return {
            "known": code == 0 and bool(trigger),
            "present": trigger.get("LoadState") != "not-found",
            "enabled": trigger.get("UnitFileState") == "enabled",
            "armed": trigger.get("ActiveState") in ("active", "activating"),
            "mount_failed": mount.get("ActiveState") == "failed",
        }

    def is_enabled(self, slug: str) -> bool:
        return self.unit_state(slug)["enabled"]

    def probe(self, server: str, *, use_cache=True) -> bool:
        """Can we open a TCP connection to the server's SMB port?

        This is what turns "NAS asleep, wrong IP, typo'd hostname" into an
        immediate specific message instead of a long opaque wait on the mount.
        Pure stdlib, no subprocess.
        """
        now = time.monotonic()
        if use_cache:
            with self._probe_cache_lock:
                cached = self._probe_cache.get(server)
            if cached is not None and now - cached[0] < PROBE_CACHE_SECONDS:
                return cached[1]

        try:
            with socket.create_connection((server, SMB_PORT), timeout=PROBE_TIMEOUT_SECONDS):
                reachable = True
        except (OSError, ValueError):
            reachable = False

        with self._probe_cache_lock:
            self._probe_cache[server] = (now, reachable)
        self._debug("probe %s -> %s", server, reachable)
        return reachable

    def verify_credentials(self, share: dict, password: str) -> dict:
        """Ask the server whether these credentials actually open this share.

        The probe only proves something is listening on 445, so "Test
        Connection" would happily pass a completely wrong username, and saving
        went on to build a share that could never mount. This asks the real
        question, through smbclient rather than a trial mount: no root mount
        cycle, no unit files, nothing to undo if it fails.

        Three verdicts, and the difference matters. "rejected" is the server
        telling us no, which is worth blocking a save over. "unknown" is
        anything we can't read as a definite answer, and it must never block:
        the local smbclient refuses SMB1 outright, so a legacy NAS that would
        mount perfectly well fails this check for reasons that have nothing to
        do with the credentials.
        """
        if not SMBCLIENT.exists():
            return {"verdict": "unknown"}

        target = f"//{share['server']}/{share['share']}"
        argv = [str(SMBCLIENT), target, "--command=quit"]
        authfile = None
        try:
            username = share.get("username") or ""
            if username or password:
                handle, authfile = tempfile.mkstemp(dir=str(VERIFY_TMP_DIR), prefix="cheevodeck-smb-")
                with os.fdopen(handle, "w", encoding="utf-8") as out:
                    out.write(self.render_credentials(
                        username=username,
                        password=password or "",
                        domain=share.get("domain") or "",
                    ))
                argv.append(f"--authentication-file={authfile}")
            else:
                argv.append("--no-pass")

            code, out, err = self._run(argv, timeout=SMBCLIENT_TIMEOUT_SECONDS)
        except OSError as exc:
            self._debug("credential check couldn't run (%s)", exc)
            return {"verdict": "unknown"}
        finally:
            if authfile:
                try:
                    os.unlink(authfile)
                except OSError:
                    pass

        if code == 0:
            return {"verdict": "ok"}

        text = f"{out}\n{err}"
        failure = self.classify_error(text)
        self._debug("credential check for %s -> %s", target, failure)
        if failure in ("bad_credentials", "access_denied", "share_not_found"):
            return {"verdict": "rejected", "error": failure}
        return {"verdict": "unknown"}

    def list_server_shares(self, share: dict, password: str) -> list:
        """The share names this server will admit to, for when ours is wrong.

        "No share with that name" is true and unhelpful: the user is now
        guessing at a name only the NAS knows, and the difference is usually a
        space, a capital or a word they misremembered. We are already
        authenticated at the point we need this, so asking costs one more call
        and turns the guess into a list.
        """
        if not SMBCLIENT.exists():
            return []

        argv = [str(SMBCLIENT), "-L", f"//{share['server']}", "--grepable"]
        authfile = None
        try:
            username = share.get("username") or ""
            if username or password:
                handle, authfile = tempfile.mkstemp(dir=str(VERIFY_TMP_DIR), prefix="cheevodeck-smb-")
                with os.fdopen(handle, "w", encoding="utf-8") as out:
                    out.write(self.render_credentials(
                        username=username,
                        password=password or "",
                        domain=share.get("domain") or "",
                    ))
                argv.append(f"--authentication-file={authfile}")
            else:
                argv.append("--no-pass")
            code, out, _ = self._run(argv, timeout=SMBCLIENT_TIMEOUT_SECONDS)
        except OSError:
            return []
        finally:
            if authfile:
                try:
                    os.unlink(authfile)
                except OSError:
                    pass

        if code != 0:
            return []

        names = []
        for line in out.splitlines():
            found = _SHARE_LIST_RE.match(line)
            if not found:
                continue
            name = found.group(1).strip()
            if name and not name.endswith("$") and name not in names:
                names.append(name)
        return names

    def note_mount_failure(self, slug: str, error: str) -> None:
        with self._lock:
            self._last_error[slug] = error

    def clear_mount_failure(self, slug: str) -> None:
        with self._lock:
            self._last_error.pop(slug, None)

    def last_mount_error(self, slug: str):
        with self._lock:
            return self._last_error.get(slug)

    def forget_probe(self, server: str) -> None:
        with self._probe_cache_lock:
            self._probe_cache.pop(server, None)

    def status_for(self, share: dict, *, mounted_paths=None, probe=True) -> dict:
        """What this share is actually doing right now, and why if it's unhappy.

        Returns the status and, when that status is "error", the code naming the
        failure. They come back together because every caller needs both and
        working them out twice would mean asking systemd twice.

        Order matters, and each step earns its place:

        Mounted wins outright, whatever else is true. A share the user switched
        off is off, not broken. A unit file that has gone missing is the next
        thing worth knowing, because everything below it would be reasoning
        about a unit that isn't there. Enabled but not armed comes next, since
        the symlink says yes and the trigger says no. Only then does a
        remembered mount failure beat "idle", because idle and broken look
        identical from outside (both enabled, both unmounted) and the failure is
        the only thing that tells them apart.
        """
        slug = share["slug"]
        if self.is_mounted(slug, mounted_paths):
            if probe and not self.probe(share["server"]):
                self._consider_detaching(slug, share["server"])
                return {"status": "unreachable", "error": None}
            self._unreachable_since.pop(slug, None)
            if self.last_mount_error(slug):
                self.clear_mount_failure(slug)
            return {"status": "mounted", "error": None}

        state = self.unit_state(slug)
        if not state["known"]:
            return {"status": "error", "error": "status_unreadable"}
        if not state["present"]:
            return {"status": "error", "error": "units_missing"}
        if not state["enabled"]:
            return {"status": "disabled", "error": None}
        if state["armed"]:
            self._rearm_counts.pop(slug, None)
        if not state["armed"] and self._try_rearm(slug, share.get("server", ""), probe=probe):
            state = self.unit_state(slug)
        if not state["armed"]:
            return {"status": "error", "error": "not_armed"}

        failure = self.last_mount_error(slug)
        if failure is None and state["mount_failed"]:
            failure = self.classify_error(self._failure_text(self.unit_names(slug)[0], ""))
            decky.logger.info("smb: %s was left failed by an earlier attempt (%s)", slug, failure)
            self.note_mount_failure(slug, failure)
        if failure:
            return {"status": "error", "error": failure}
        if probe and not self.probe(share["server"]):
            return {"status": "unreachable", "error": None}
        return {"status": "idle", "error": None}

    def _consider_detaching(self, slug: str, server: str) -> None:
        """Detach a mount whose server has been gone a while.

        The mount stays put through a blip on purpose: `soft` means an app
        reading through it gets an error rather than hanging, and cifs
        reconnects by itself the moment the server answers again, so pulling
        the rug on a two-second hiccup would cost a copy that was going to
        survive.

        Past the grace period that reasoning inverts. Nothing is coming back on
        its own, and what is left is the specific thing that wedges the box: a
        stuck cifs mount jams systemd's job queue, and everything that talks to
        it starts timing out, the network coming back up included.

        The trigger is deliberately left armed. Detaching is not switching the
        share off -- the user never asked for that -- it is putting it back to
        the state an idle share is in anyway, where the next access mounts it
        again. The row keeps saying unreachable either way, so nothing about
        this changes what they are looking at.
        """
        now = time.monotonic()
        since = self._unreachable_since.get(slug)
        if since is None:
            self._unreachable_since[slug] = now
            return
        if now - since < DEAD_MOUNT_GRACE_SECONDS:
            return
        if not self._lock.acquire(blocking=False):
            return
        try:
            point = self.mount_point(slug)
            decky.logger.info(
                "smb: %s has been unreachable for %ds, detaching it so it can't wedge the system",
                slug, int(now - since),
            )
            self._run(["umount", "-l", str(point)], timeout=UNREACHABLE_STOP_TIMEOUT_SECONDS)
            self._unreachable_since.pop(slug, None)
            self.forget_probe(server)
        except (OSError, RuntimeError, ValueError) as exc:
            decky.logger.warning("smb: couldn't detach %s (%s)", slug, exc)
        finally:
            self._lock.release()

    def _try_rearm(self, slug: str, server: str, *, probe=True) -> bool:
        """Start a trigger that stopped, if it's worth trying.

        Only ever called for a share the user has switched on, so re-arming is
        carrying out their stated intent rather than overriding a decision they
        made elsewhere. Three guards on top of that, each closing off a way this
        could become a loop rather than a fix:

        Not against a server that isn't answering. Arming a trigger for a NAS
        that has gone is how you get the loop: it arms, something touches the
        path, the mount blocks for the unit's whole timeout, fails, and the
        trigger stops again. Nothing has been gained and a mount attempt has
        been spent. When the server is unreachable the row already says so.

        Not more than a few times, so a share that will not arm stops being a
        background job and becomes a message the user can act on.

        And never while the lock is held, because a status read must not queue
        behind a mount that is busy failing. Skipping is free: the next refresh
        is seconds away.
        """
        if probe and server and not self.probe(server):
            return False
        if self._rearm_counts.get(slug, 0) >= REARM_MAX_ATTEMPTS:
            return False

        now = time.monotonic()
        if now - self._rearm_attempts.get(slug, 0.0) < REARM_RETRY_SECONDS:
            return False
        if not self._lock.acquire(blocking=False):
            return False
        try:
            self._rearm_attempts[slug] = now
            self._rearm_counts[slug] = self._rearm_counts.get(slug, 0) + 1
            _, automount_unit = self.unit_names(slug)
            code, _, err = self._systemctl("start", automount_unit)
            if code != 0:
                decky.logger.warning("smb: couldn't re-arm %s (%s)", slug, err.strip())
                return False
            decky.logger.info("smb: re-armed %s after its trigger had stopped", slug)
            return True
        except (OSError, RuntimeError, ValueError) as exc:
            decky.logger.warning("smb: couldn't re-arm %s (%s)", slug, exc)
            return False
        finally:
            self._lock.release()

    def statuses_for(self, shares, *, probe=True) -> dict:
        """Status for a whole list in one pass.

        /proc/mounts is read once rather than per share, and the probes -- the
        only slow part -- run concurrently, so a page with five mounts against a
        dead NAS takes one probe timeout rather than five.
        """
        mounted_paths = self._mounted_paths()
        usable = [s for s in shares if is_safe_slug(s.get("slug"))]

        if probe:
            servers = sorted({s["server"] for s in usable})
            if servers:
                with ThreadPoolExecutor(max_workers=min(8, len(servers))) as pool:
                    list(pool.map(self.probe, servers))

        statuses = {}
        for share in usable:
            try:
                statuses[share["id"]] = self.status_for(share, mounted_paths=mounted_paths, probe=probe)
            except (OSError, RuntimeError, ValueError) as exc:
                decky.logger.warning("smb: couldn't read status for %s (%s)", share.get("slug"), exc)
                statuses[share["id"]] = {"status": "error", "error": "status_unreadable"}
        return statuses

    def _discard_partial_create(self, share: dict) -> None:
        """Undo a create that fell over partway.

        Every step is best-effort and independent, because we have no idea how
        far the create got before it raised -- the whole point is to be safe to
        run against any prefix of it, including none of it. The keep-list
        drop-in deliberately stays: it is shared infrastructure, harmless on its
        own, and other shares may depend on it.
        """
        slug = share.get("slug")
        if not is_safe_slug(slug):
            return

        self.remove_credentials(slug)
        self.remove_sidecar(slug)
        try:
            for path in self.unit_paths(slug):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
        except (OSError, RuntimeError, ValueError):
            pass
        self._remove_mount_point(slug)

    def busy_process_names(self, slug: str):
        """Who is holding the mount, for the unmount-refused message.

        The difference between "in use" and "Dolphin is using this share" is the
        difference between a fixable message and a support ticket.
        """
        point = str(self.mount_point(slug))
        code, out, _ = self._run(["fuser", "-m", point], timeout=BUSY_CHECK_TIMEOUT_SECONDS)
        if code != 0 or not out.strip():
            return []

        names = []
        for token in out.split():
            pid = "".join(ch for ch in token if ch.isdigit())
            if not pid:
                continue
            try:
                name = Path(f"/proc/{pid}/comm").read_text(encoding="utf-8").strip()
            except OSError:
                continue
            if name and name not in names:
                names.append(name)
        return names

    def classify_error(self, stderr: str) -> str:
        """Map mount/kernel stderr onto one of the taxonomy codes.

        Two passes. The signature table is the captured-off-the-device half and
        wins; the errno table behind it catches the same failures when the words
        are ones we've never seen, which is the case every future kernel version
        gets to create. "generic" is what's left, and the point of the second
        pass is that a real mount failure should almost never reach it.

        The raw text is kept for the debug log rather than shown: it says "cifs"
        a lot, which is genuinely useful for searching and meaningless in a UI.
        """
        text = stderr or ""
        for signature, code in _ERROR_SIGNATURES:
            if signature in text:
                return code

        found = _MOUNT_ERRNO_RE.search(text)
        if found:
            code = _MOUNT_ERRNO_CODES.get(int(found.group(1)))
            if code:
                self._debug("classified mount error(%s) as %s", found.group(1), code)
                return code
            return f"mount_errno_{found.group(1)}"

        return "generic"

    def create(self, share: dict, password: str) -> dict:
        """Lay down every artifact for a new share, without enabling it.

        Note what is *not* here: the caller writes the store entry after this
        returns and then enables separately. A failed enable (NAS asleep, wrong
        password) must not throw away a record the user just typed six fields
        into, so enabling is a follow-up action whose failure is reported rather
        than rolled back. That is the opposite of the delete path, where the
        store entry goes last.
        """
        with self._lock:
            try:
                self.write_keep_list()
                self.write_credentials(share, password)
                self.write_sidecar(share)
                self.ensure_mount_point(share["slug"])
                self.write_units(share)
                self._daemon_reload()
            except (OSError, RuntimeError, ValueError) as exc:
                decky.logger.error("smb: couldn't create %s (%s)", share.get("slug"), exc)
                self._discard_partial_create(share)
                return {"ok": False, "error": "create_failed"}
        decky.logger.info("smb: created share %s", share["slug"])
        return {"ok": True}

    def update(self, share: dict, *, password=None, clear_password=False) -> dict:
        """Rewrite an existing share's units in place.

        Where= never changes -- the slug is immutable and so is the mount point
        -- so this is a rewrite rather than a move, and no external path
        pointing at this share can break. What can change is What= (server or
        share name) and Options= (dialect, soft/hard, guest vs credentials),
        which means stopping, rewriting and re-arming.

        A password of None means "leave the saved one alone", which is what a
        blank password field on the Edit modal sends.
        """
        slug = share["slug"]
        with self._lock:
            was_enabled = self._enabled_quietly(slug)
            stop = self._stop_units(slug, share_server=share.get("server", ""))
            if not stop["ok"]:
                return stop

            try:
                if clear_password:
                    secret = ""
                elif password is not None:
                    secret = password
                else:
                    secret = self.saved_password(slug)
                self.write_credentials(share, secret)

                self.write_sidecar(share)
                self.write_units(share)
                self._daemon_reload()
            except (OSError, RuntimeError, ValueError) as exc:
                decky.logger.error("smb: couldn't update %s (%s)", slug, exc)
                self.note_mount_failure(slug, "update_failed")
                return {"ok": False, "error": "update_failed"}

            self.forget_probe(share["server"])
            if was_enabled:
                armed = self._enable_and_arm(share)
                if not armed["ok"]:
                    decky.logger.warning("smb: %s rewritten but not re-armed (%s)", slug, armed.get("error"))

        decky.logger.info("smb: updated share %s", slug)
        return {"ok": True}

    def _enabled_quietly(self, slug: str) -> bool:
        try:
            return self.is_enabled(slug)
        except (OSError, RuntimeError, ValueError):
            return False

    def _arm(self, share: dict) -> dict:
        """Enable the automount and put its trigger in place.

        All local: a symlink, a daemon-reload and an autofs stub at the mount
        point. Nothing here touches the network, which is what makes it the
        right thing to do even for a share whose server is asleep.
        """
        slug = share["slug"]
        _, automount_unit = self.unit_names(slug)

        self.ensure_mount_point(slug)
        code, _, err = self._systemctl("enable", "--now", automount_unit, timeout=SYSTEMCTL_TIMEOUT_SECONDS)
        if code != 0:
            decky.logger.warning("smb: enable failed for %s (%s)", slug, err.strip())
            return {"ok": False, "error": self.classify_error(err)}
        return {"ok": True}

    def _enable_and_arm(self, share: dict) -> dict:
        """Arm the trigger, then touch the path so the mount actually fires.

        Arming on its own never touches the network, so the toggle would answer
        instantly and hide a wrong password until something else tripped over it
        hours later. Mounting here is what turns that into an immediate message.

        A mount that fails is remembered rather than reported as a failed call.
        The share is enabled, which is what the user asked for, and the status
        line under the toggle is where the reason belongs. An error bubbled up
        from here would say the same sentence twice, once in red under the row
        and once again beside it.
        """
        slug = share["slug"]
        armed = self._arm(share)
        if not armed["ok"]:
            self.note_mount_failure(slug, armed["error"])
            return armed

        mount_unit, _ = self.unit_names(slug)
        code, _, err = self._systemctl("start", mount_unit, timeout=SYSTEMCTL_TIMEOUT_SECONDS)
        if code != 0:
            detail = self._failure_text(mount_unit, err)
            self._debug("start %s failed: %s", mount_unit, detail.strip())
            self.note_mount_failure(slug, self.classify_error(detail))
            return {"ok": True}
        self.clear_mount_failure(slug)
        return {"ok": True}

    def set_enabled(self, share: dict, enabled: bool) -> dict:
        slug = share["slug"]
        with self._lock:
            if not enabled:
                result = self._stop_units(slug, share_server=share.get("server", ""))
                if not result["ok"]:
                    return result
                _, automount_unit = self.unit_names(slug)
                code, _, err = self._systemctl("disable", automount_unit, timeout=UNREACHABLE_STOP_TIMEOUT_SECONDS)
                if code != 0:
                    decky.logger.warning("smb: disable failed for %s (%s)", slug, err.strip())
                    return {"ok": False, "error": self.classify_error(err)}
                self.forget_probe(share["server"])
                self.clear_mount_failure(slug)
                return {"ok": True}

            self.forget_probe(share["server"])
            if not self.probe(share["server"], use_cache=False):
                armed = self._arm(share)
                if not armed["ok"]:
                    return armed
                self.clear_mount_failure(slug)
                return {"ok": True}
            return self._enable_and_arm(share)

    def _stop_units(self, slug: str, *, force=False, share_server="") -> dict:
        """Stop the automount first, then the mount.

        The order is the trap in this whole feature. Unmounting while the
        automount is still armed means the next access instantly remounts it and
        you end up fighting your own trigger.

        Every step tolerates "already gone" so a delete stays re-runnable after
        a partial failure, and so a user who removed a unit file by hand can't
        wedge the row permanently.
        """
        mount_unit, automount_unit = self.unit_names(slug)

        point = self.mount_point(slug)
        reachable = True
        if share_server and self._anything_mounted_at(point):
            reachable = self.probe(share_server, use_cache=False)

        if not reachable:
            decky.logger.info("smb: %s server is gone, detaching before touching systemd", slug)
            self._run(["umount", "-l", str(point)], timeout=UNREACHABLE_STOP_TIMEOUT_SECONDS)

        started = time.monotonic()
        ceiling = SYSTEMCTL_TIMEOUT_SECONDS if reachable else UNREACHABLE_STOP_TIMEOUT_SECONDS

        def remaining():
            left = STOP_BUDGET_SECONDS - (time.monotonic() - started)
            return max(1, min(ceiling, int(left)))

        code, _, err = self._systemctl("stop", automount_unit, timeout=remaining())
        if code != 0:
            self._debug("stop %s: %s", automount_unit, err.strip())

        if not reachable and not self._anything_mounted_at(point):
            return {"ok": True}

        decky.logger.info(
            "smb: stopping %s (mounted=%s, server reachable=%s)",
            slug, self.is_mounted(slug), reachable,
        )

        code, _, err = self._systemctl("stop", mount_unit, timeout=remaining())
        if code != 0 and self.is_mounted(slug):
            if share_server and not self.probe(share_server, use_cache=False):
                decky.logger.info("smb: %s went away mid-stop, detaching it", slug)
                self._run(["umount", "-l", str(self.mount_point(slug))], timeout=remaining())
                if not self.is_mounted(slug):
                    return {"ok": True}
                reachable = False
            reason = self.classify_error(self._failure_text(mount_unit, err))
            if reason == "generic":
                reason = "busy"
            if not force:
                names = self.busy_process_names(slug) if reachable else []
                decky.logger.warning("smb: couldn't unmount %s (%s)", slug, err.strip())
                return {"ok": False, "error": reason, "blockedBy": names}

            code, _, lazy_err = self._run(
                ["umount", "-l", str(self.mount_point(slug))],
                timeout=remaining(),
            )
            if code != 0 and self.is_mounted(slug):
                decky.logger.warning("smb: lazy unmount failed for %s (%s)", slug, lazy_err.strip())
                return {"ok": False, "error": "busy", "blockedBy": self.busy_process_names(slug)}

        return {"ok": True}

    def _remove_mount_point(self, slug: str) -> None:
        """Plain rmdir, never rm -rf.

        rmdir refusing a non-empty directory is a feature: it means either
        something is still mounted, or files leaked onto the underlying tmpfs.
        Neither is a reason to delete anything recursively. Since /run is tmpfs,
        a leftover directory costs nothing and is gone at the next reboot, so
        this stays best-effort and never blocks the delete.
        """
        point = self.mount_point(slug)
        if self.is_mounted(slug):
            decky.logger.warning("smb: not removing %s, still mounted", point)
            return
        if self._anything_mounted_at(point):
            self._debug("detaching a leftover mount at %s before removing it", point)
            self._run(["umount", "-l", str(point)], timeout=UNREACHABLE_STOP_TIMEOUT_SECONDS)
        try:
            point.rmdir()
        except FileNotFoundError:
            pass
        except OSError as exc:
            decky.logger.warning("smb: leaving %s in place (%s)", point, exc)

    def _remove_shared_artifacts(self) -> None:
        """Take the shared infrastructure with the last mount.

        The credentials directory, the keep-list drop-in and the mount root
        belong to every share at once, so deleting one share leaves them alone
        while anything still needs them. Once the last sidecar is gone they are
        dead weight, and nothing would ever come back for them: the page only
        lists shares, and by then there are none.
        """
        if any(entry.suffix == ".json" for entry in self._config_dir_entries()):
            return

        self.remove_keep_list()
        for leftover in self._config_dir_entries():
            try:
                leftover.unlink()
            except OSError as exc:
                decky.logger.warning("smb: couldn't remove %s (%s)", leftover, exc)
        for directory in (CONFIG_DIR, CONFIG_DIR.parent, MOUNT_ROOT):
            try:
                directory.rmdir()
            except OSError:
                pass

    def teardown(self, share: dict, *, force=False) -> dict:
        """Remove one share's system state, in the order that survives failure.

        Blocking through the unit files: if systemd state or a unit file can't
        be dealt with, we stop and the caller keeps the store entry, keeps the
        row on screen and shows the error. Dropping the record first and failing
        here would leave orphaned live units with no UI to manage them, which is
        the exact failure Remove All exists to dig out of.

        Best-effort from the credentials onward: those are cleanup, and a
        leftover file in /etc or a directory on tmpfs is not worth stranding the
        user over.
        """
        slug = share["slug"]
        with self._lock:
            stopped = self._stop_units(slug, force=force, share_server=share.get("server", ""))
            if not stopped["ok"]:
                return stopped

            _, automount_unit = self.unit_names(slug)
            self._systemctl("disable", automount_unit, timeout=UNREACHABLE_STOP_TIMEOUT_SECONDS)

            try:
                for path in self.unit_paths(slug):
                    try:
                        path.unlink()
                    except FileNotFoundError:
                        pass
            except OSError as exc:
                decky.logger.error("smb: couldn't remove unit files for %s (%s)", slug, exc)
                return {"ok": False, "error": "unit_removal_failed"}

            self._daemon_reload()

            for unit in self.unit_names(slug):
                self._systemctl("reset-failed", unit)

            self.remove_credentials(slug)
            self.remove_sidecar(slug)
            self._remove_mount_point(slug)
            self.forget_probe(share.get("server", ""))
            self.clear_mount_failure(slug)
            self._unit_names.pop(slug, None)
            self._remove_shared_artifacts()

        decky.logger.info("smb: removed share %s", slug)
        return {"ok": True}

    def _config_dir_entries(self):
        try:
            return sorted(CONFIG_DIR.iterdir())
        except OSError:
            return []

    def _adopt_unit(self, unit_path: Path):
        """Rebuild a record from a unit file that has no sidecar.

        This is the reinstall-after-manual-surgery case. The name falls back to
        the slug, because a unit file has nowhere to keep one.
        """
        try:
            body = unit_path.read_text(encoding="utf-8")
        except OSError:
            return None

        where = _UNIT_WHERE_RE.search(body)
        what = _UNIT_WHAT_RE.search(body)
        if not where or not what:
            return None

        point = Path(where.group(1).strip())
        if point.parent != MOUNT_ROOT:
            return None
        slug = point.name
        if not is_safe_slug(slug):
            return None

        options = _UNIT_OPTIONS_RE.search(body)
        option_list = options.group(1).split(",") if options else []
        vers = "auto"
        for option in option_list:
            if option.startswith("vers="):
                vers = option[len("vers="):].strip()

        return {
            "slug": slug,
            "name": slug,
            "server": what.group(1).strip(),
            "share": what.group(2).strip(),
            "username": "",
            "domain": "",
            "vers": vers,
            "softMount": "hard" not in option_list,
            "hasPassword": self.credentials_path(slug).exists(),
            "createdAt": int(time.time()),
        }

    def read_disk_state(self) -> list:
        """Rebuild the whole share list from what is actually on the system.

        The sidecars are the source of truth, with two reconciles on top: a
        sidecar whose unit files are gone is stale and gets cleaned, and a unit
        with no sidecar is adopted. One mechanism covers factory-reset orphans,
        a plugin reinstall, and someone deleting smb_shares.json by hand.

        Takes the lock despite being a read, because both of those reconciles
        write: create() lays the sidecar down before the units, so a rehydrate
        landing in that window would see a sidecar with no units, call it stale,
        and delete the credentials of the share being created right then. The
        page's poller makes that window reachable rather than theoretical.
        """
        records = []
        seen_slugs = set()

        with self._lock:
            for entry in self._config_dir_entries():
                if entry.suffix != ".json":
                    continue
                slug = entry.stem
                if not is_safe_slug(slug):
                    continue
                try:
                    raw = json.loads(entry.read_text(encoding="utf-8"))
                except (OSError, ValueError) as exc:
                    decky.logger.warning("smb: unreadable sidecar %s (%s)", entry, exc)
                    continue
                if not isinstance(raw, dict):
                    continue

                try:
                    mount_path, automount_path = self.unit_paths(slug)
                except (RuntimeError, ValueError):
                    continue
                if not mount_path.exists() and not automount_path.exists():
                    decky.logger.info("smb: sidecar for %s has no units left, cleaning it up", slug)
                    self.remove_sidecar(slug)
                    self.remove_credentials(slug)
                    continue

                raw["slug"] = slug
                raw["hasPassword"] = self.credentials_path(slug).exists()

                if not mount_path.exists() or not automount_path.exists():
                    if all(raw.get(key) for key in ("name", "server", "share")):
                        decky.logger.warning(
                            "smb: %s is missing a unit file, rebuilding both from its sidecar", slug
                        )
                        try:
                            self.write_units(raw)
                            self._daemon_reload()
                        except (OSError, RuntimeError, ValueError, KeyError) as exc:
                            decky.logger.error("smb: couldn't rebuild the units for %s (%s)", slug, exc)
                    else:
                        decky.logger.warning(
                            "smb: %s is missing a unit file and its sidecar is too thin to rebuild from", slug
                        )

                records.append(raw)
                seen_slugs.add(slug)

            try:
                orphan_candidates = sorted(UNIT_DIR.glob(self._unit_glob()))
            except (OSError, RuntimeError) as exc:
                decky.logger.warning("smb: couldn't scan for orphaned units (%s)", exc)
                orphan_candidates = []

            for unit_path in orphan_candidates:
                adopted = self._adopt_unit(unit_path)
                if adopted is None or adopted["slug"] in seen_slugs:
                    continue
                decky.logger.info("smb: adopting orphaned unit %s", unit_path.name)
                seen_slugs.add(adopted["slug"])
                records.append(adopted)
                try:
                    self.write_sidecar(adopted)
                except (OSError, RuntimeError, ValueError) as exc:
                    decky.logger.warning("smb: couldn't write a sidecar for %s (%s)", adopted["slug"], exc)

            return records
