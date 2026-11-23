from concurrent.futures import ThreadPoolExecutor

import asyncio
import os
import re

import decky
import subprocess_util

from mixins._context import PluginContext
from utils import to_int


DIRECTORY_PAGE_SIZE = 1000

_SORT_MODES = ("name_asc", "name_desc", "modified_desc", "modified_asc")

MEDIA_ROOT = "/run/media"

_SHARE_FS_TYPES = {"autofs", "cifs", "smb3", "nfs", "nfs4"}

_KIND_ORDER = {"sd": 0, "drive": 1, "share": 2}

AUTOMOUNT_QUERY_TIMEOUT_SECONDS = 5


class FileBrowserMixin(PluginContext):
    """Directory listings for the in-plugin path picker.

    The picker does no filesystem work of its own, so filtering, sorting and
    paging all happen here: a folder with a few thousand entries would
    otherwise cross IPC whole and be sorted in JavaScript on a handheld.

    Nothing here writes, and nothing here reaches RetroAchievements, so there
    is no slot to take and no file to hand back to the data owner.
    """

    async def list_directory(
        self,
        path,
        include_files: bool = True,
        include_folders: bool = True,
        extensions=None,
        show_hidden: bool = False,
        sort: str = "name_asc",
        page: int = 1,
        page_size: int = DIRECTORY_PAGE_SIZE,
    ):
        """One page of a directory, already filtered and sorted.

        Returns ok, the path as asked for, its realpath, the directory above
        it along the route asked for (None at the filesystem root), the page of
        entries, and the total count before paging, which is what tells the
        caller whether another page exists. Each entry carries name, realpath,
        isDir, isHidden, size and modified.

        A directory that cannot be opened comes back as ok False with a
        machine-readable error: not_found, permission_denied or unknown. The
        caller owns the sentence the user reads.
        """
        return await asyncio.to_thread(
            self._list_directory_sync,
            path,
            include_files,
            include_folders,
            extensions,
            show_hidden,
            sort,
            page,
            page_size,
        )

    def _list_directory_sync(
        self,
        path,
        include_files,
        include_folders,
        extensions,
        show_hidden,
        sort,
        page,
        page_size,
    ) -> dict:
        asked = str(path or "").strip() or str(self.user_home)
        walked = os.path.normpath(asked)

        try:
            resolved = os.path.realpath(asked)
        except OSError as exc:
            decky.logger.error("picker: couldn't resolve %s (%s: %s)", asked, type(exc).__name__, exc)
            return self._listing_error("unknown", walked, walked)

        wanted = self._wanted_extensions(extensions)
        rows = []

        try:
            with os.scandir(resolved) as listing:
                for item in listing:
                    row = self._directory_row(item, resolved, include_files, include_folders, show_hidden, wanted)
                    if row is not None:
                        rows.append(row)
        except FileNotFoundError:
            return self._listing_error("not_found", walked, resolved)
        except NotADirectoryError:
            return self._listing_error("not_found", walked, resolved)
        except PermissionError:
            return self._listing_error("permission_denied", walked, resolved)
        except OSError as exc:
            decky.logger.error("picker: couldn't open %s (%s: %s)", resolved, type(exc).__name__, exc)
            return self._listing_error("unknown", walked, resolved)

        self._sort_rows(rows, sort)

        size = max(1, to_int(page_size, DIRECTORY_PAGE_SIZE))
        index = max(1, to_int(page, 1))
        start = (index - 1) * size

        return {
            "ok": True,
            "path": walked,
            "realpath": resolved,
            "parent": self._parent_of(walked),
            "entries": rows[start:start + size],
            "total": len(rows),
        }

    def _directory_row(self, item, parent_realpath, include_files, include_folders, show_hidden, wanted):
        """One scandir entry as the picker wants it, or None if it is filtered out.

        A stat that raises leaves size and modified at zero rather than
        failing the whole listing: one unreadable file on a share must not
        blank the folder it sits in.
        """
        name = item.name
        hidden = name.startswith(".")
        if hidden and not show_hidden:
            return None

        try:
            is_dir = item.is_dir()
        except OSError:
            is_dir = False

        if is_dir and not include_folders:
            return None
        if not is_dir:
            if not include_files:
                return None
            if wanted and os.path.splitext(name)[1].lower() not in wanted:
                return None

        try:
            info = item.stat()
            size = 0 if is_dir else int(info.st_size)
            modified = int(info.st_mtime)
        except OSError:
            size = 0
            modified = 0

        child = os.path.join(parent_realpath, name)
        try:
            linked = item.is_symlink()
        except OSError:
            linked = False

        return {
            "name": name,
            "realpath": os.path.realpath(child) if linked else child,
            "isDir": is_dir,
            "isHidden": hidden,
            "size": size,
            "modified": modified,
        }

    def _wanted_extensions(self, extensions) -> set:
        """The extension filter as a set of lowercase suffixes with their dot."""
        if not extensions:
            return set()

        wanted = set()
        for raw in extensions:
            text = str(raw or "").strip().lower()
            if not text:
                continue
            wanted.add(text if text.startswith(".") else "." + text)
        return wanted

    def _sort_rows(self, rows, sort) -> None:
        """Order the page, folders first.

        The folders-first pass runs second and relies on the sort being
        stable, so the chosen order survives inside each group.
        """
        mode = sort if sort in _SORT_MODES else "name_asc"
        descending = mode.endswith("_desc")

        if mode.startswith("modified"):
            rows.sort(key=lambda row: row["modified"], reverse=descending)
        else:
            rows.sort(key=lambda row: row["name"].lower(), reverse=descending)

        rows.sort(key=lambda row: not row["isDir"])

    def _parent_of(self, walked):
        """The directory above, along the path as it was walked.

        Cut from the navigated path rather than the resolved one, so going up
        out of a symlinked folder returns to the directory the user entered it
        from and not to wherever the link happened to point. None once there is
        nothing above, which is the filesystem root.
        """
        parent = os.path.dirname(walked)
        return None if parent == walked else parent

    def _listing_error(self, reason, walked, resolved) -> dict:
        return {
            "ok": False,
            "error": reason,
            "path": walked,
            "realpath": resolved,
            "parent": self._parent_of(walked),
            "entries": [],
            "total": 0,
        }

    async def list_mounts(self):
        return await asyncio.to_thread(self._list_mounts_sync)

    def _list_mounts_sync(self) -> dict:
        try:
            with open("/proc/mounts", encoding="utf-8", errors="replace") as table:
                lines = table.read().splitlines()
        except OSError as exc:
            decky.logger.warning("picker: couldn't read /proc/mounts (%s)", exc)
            return {"mounts": []}

        found = {}
        for line in lines:
            fields = line.split()
            if len(fields) < 3:
                continue
            point = _unescape_mount_field(fields[1])
            if not point.startswith(MEDIA_ROOT + "/"):
                continue
            seen = found.setdefault(point, {"device": fields[0], "types": set()})
            seen["types"].add(fields[2])
            if fields[2] != "autofs":
                seen["device"] = fields[0]

        shares = {}
        for share in self.smb_shares_store.list_shares():
            shares[str(self.smb_mount_service.mount_point(share["slug"]))] = share

        mounts = []
        servers = {}
        for point, seen in found.items():
            share = shares.get(point)
            device = seen["device"]
            if share is not None or seen["types"] & _SHARE_FS_TYPES:
                kind = "share"
            elif device.startswith("/dev/mmcblk"):
                kind = "sd"
            else:
                kind = "drive"

            server = None
            if share is not None:
                server = share["server"]
            elif kind == "share":
                server = _smb_host(device) or self._automount_host(point)
            if server:
                servers[point] = server

            mounted = seen["types"] != {"autofs"}
            mounts.append({
                "name": share["name"] if share is not None else os.path.basename(point),
                "path": point,
                "kind": kind,
                "ready": kind != "share" or mounted or bool(server),
            })

        if servers:
            with ThreadPoolExecutor(max_workers=len(servers)) as pool:
                probes = {
                    point: pool.submit(self.smb_mount_service.probe, server)
                    for point, server in servers.items()
                }
            for row in mounts:
                if row["path"] in probes:
                    row["ready"] = probes[row["path"]].result()

        mounts.sort(key=lambda row: (_KIND_ORDER[row["kind"]], row["name"].lower()))
        return {"mounts": mounts}

    def _automount_host(self, point):
        code, out, _ = subprocess_util.run_command(
            ["systemctl", "show", "--property=What", "--value", "--", point],
            timeout=AUTOMOUNT_QUERY_TIMEOUT_SECONDS,
        )
        return _smb_host(out.strip()) if code == 0 else None


def _smb_host(what):
    if what.startswith("//"):
        return what[2:].split("/", 1)[0] or None
    return None


def _unescape_mount_field(value):
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match.group(1), 8)), value)
