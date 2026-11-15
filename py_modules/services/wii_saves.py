import hashlib
import os
import re
import shutil
import stat
import time
from pathlib import Path

import decky
from utils import atomic_file, child_owner, ensure_dir, open_dir, user_file_target

SESSION = "WiiSession"
SESSION_BACKUP = "WiiSession.backup"
SYSTEM_TYPE = "00000001"
BACKUPS_KEPT = 5
GONE_CHECKS = 6
GONE_CHECK_SECONDS = 0.5
TMP_SUFFIX = ".cheevodeck-tmp"
_HEX8 = re.compile(r"[0-9a-f]{8}")


class Refused(Exception):
    pass


def session_id(user_dir: Path):
    try:
        st = os.lstat(user_dir / SESSION)
    except OSError:
        return None
    return st.st_dev, st.st_ino


def put_back(user_dir: Path, *, since: float, backups: Path, install: str, before=None) -> str:
    session = user_dir / SESSION
    if session.is_symlink() or not session.is_dir():
        return "no session left, Dolphin put it back itself or there was nothing to"
    if before is not None and session_id(user_dir) == before:
        return "the session there predates the round"
    try:
        fst = os.lstat(session / "fst.bin")
    except OSError:
        decky.logger.warning("multiplayer: a WiiSession was left with no fst.bin, leaving it alone")
        return "refused"
    if fst.st_mtime < since:
        decky.logger.warning("multiplayer: the WiiSession left behind is older than this round, leaving it alone")
        return "refused"
    if not _dolphin_gone():
        decky.logger.warning("multiplayer: Dolphin is still running, leaving its WiiSession alone")
        return "refused"
    try:
        _no_links(session)
    except (OSError, Refused) as e:
        decky.logger.warning("multiplayer: the WiiSession isn't plain files (%s), leaving it alone", e)
        return "refused"

    copied = []
    refused = False
    for kind, title in _game_titles(session):
        try:
            count = _put_title_back(user_dir, session, kind, title, backups, f"wii-{install}-{kind}{title}-")
        except (OSError, Refused) as e:
            decky.logger.warning("multiplayer: couldn't put the Wii save for %s/%s back (%s: %s)", kind, title,
                                 type(e).__name__, e)
            refused = True
            continue
        if count:
            copied.append(title)
            decky.logger.info("multiplayer: Dolphin didn't put the Wii save back, CheevoDeck did (%s/%s, %s files, "
                              "backup kept)", kind, title, count)
    if refused:
        return "refused a title, session left in place"
    _retire(user_dir)
    return f"copied {', '.join(copied)}" if copied else "every game save already matched"


def _dolphin_gone() -> bool:
    for attempt in range(GONE_CHECKS):
        if attempt:
            time.sleep(GONE_CHECK_SECONDS)
        if not _dolphin_running():
            return True
    return False


def _dolphin_running() -> bool:
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat", "rb") as handle:
                head, _sep, tail = handle.read().rpartition(b")")
        except OSError:
            continue
        if head.partition(b"(")[2] == b"dolphin-emu" and tail.split()[:1] not in ([b"Z"], [b"X"]):
            return True
    return False


def _game_titles(session: Path) -> list:
    found = []
    root = session / "title"
    try:
        kinds = sorted(os.listdir(root))
    except OSError:
        return found
    for kind in kinds:
        if kind == SYSTEM_TYPE or not _HEX8.fullmatch(kind):
            continue
        try:
            titles = sorted(os.listdir(root / kind))
        except OSError:
            continue
        found += [(kind, title) for title in titles if _HEX8.fullmatch(title) and (root / kind / title / "data").is_dir()]
    return found


def _put_title_back(user_dir: Path, session: Path, kind: str, title: str, backups: Path, prefix: str) -> int:
    source = session / "title" / kind / title / "data"
    wanted = _contents(source)
    linked = user_dir / "Wii" / "title" / kind / title / "data"
    if not os.path.lexists(linked):
        ensure_dir(linked, trusted=user_dir / "Wii" / "title" / kind)
    real = user_file_target(linked, child_owner())
    if not real.is_dir():
        raise Refused("the real data folder isn't a folder")
    have = _contents(real)
    changed = sorted(relative for relative, digest in wanted.items() if have.get(relative) != digest)
    if not changed:
        return 0
    for relative in changed:
        _no_clash(real, relative)

    if have:
        _back_up(real, have, backups / f"{prefix}{time.strftime('%Y%m%d%H%M%S')}")
        _prune(backups, prefix)

    touched = {real}
    for relative in changed:
        target = real / relative
        if target.parent != real:
            ensure_dir(target.parent, trusted=real)
            touched.add(target.parent)
        data = _read(source / relative)
        keep = None
        try:
            st = os.lstat(target)
            if stat.S_ISREG(st.st_mode):
                keep = stat.S_IMODE(st.st_mode)
        except FileNotFoundError:
            pass
        with atomic_file(target, trusted=real, keep_mode=keep, tmp_name=f".{target.name}{TMP_SUFFIX}") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
    for folder in touched:
        _sync_dir(folder)
    for relative in sorted(set(have) - set(wanted)):
        target = real / relative
        fd = open_dir(target.parent, real)
        try:
            os.unlink(target.name, dir_fd=fd)
            os.fsync(fd)
        except FileNotFoundError:
            pass
        finally:
            os.close(fd)
    return len(changed)


def _no_clash(real: Path, relative: str) -> None:
    folder = real
    for part in Path(relative).parts[:-1]:
        folder = folder / part
        try:
            st = os.lstat(folder)
        except FileNotFoundError:
            return
        if not stat.S_ISDIR(st.st_mode):
            raise Refused(f"{part} isn't a folder in the real save")
    try:
        st = os.lstat(real / relative)
    except FileNotFoundError:
        return
    if not stat.S_ISREG(st.st_mode):
        raise Refused(f"{relative} isn't a plain file in the real save")


def _read(path: Path) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, "rb") as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise Refused(f"{path.name} isn't a plain file")
        return handle.read()


def _contents(folder: Path) -> dict:
    found = {}
    for top, dirs, files in os.walk(folder, onerror=_raise):
        for name in dirs:
            if os.path.islink(os.path.join(top, name)):
                raise Refused(f"{name} is a link")
        for name in files:
            path = os.path.join(top, name)
            st = os.lstat(path)
            if not stat.S_ISREG(st.st_mode):
                raise Refused(f"{name} isn't a plain file")
            digest = hashlib.sha1(_read(Path(path))).hexdigest()
            found[os.path.relpath(path, folder)] = digest
    return found


def _no_links(folder: Path) -> None:
    for top, dirs, files in os.walk(folder, onerror=_raise):
        for name in dirs + files:
            if os.path.islink(os.path.join(top, name)):
                raise Refused(f"{name} is a link")


def _back_up(real: Path, have: dict, folder: Path) -> None:
    ensure_dir(folder)
    for relative in sorted(have):
        target = folder / relative
        if target.parent != folder:
            ensure_dir(target.parent)
        data = _read(real / relative)
        with atomic_file(target, tmp_name=f".{target.name}{TMP_SUFFIX}") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())


def _prune(backups: Path, prefix: str) -> None:
    try:
        names = sorted(entry for entry in os.listdir(backups) if entry.startswith(prefix))
    except OSError:
        return
    for name in names[:-BACKUPS_KEPT]:
        path = backups / name
        if path.is_symlink() or not path.is_dir():
            continue
        try:
            shutil.rmtree(path)
        except OSError as e:
            decky.logger.warning("multiplayer: couldn't remove an old Wii save backup (%s)", type(e).__name__)


def _retire(user_dir: Path) -> None:
    old = user_dir / SESSION_BACKUP
    try:
        if os.path.lexists(old):
            if old.is_symlink() or not old.is_dir():
                return
            _no_links(old)
            shutil.rmtree(old)
        os.rename(user_dir / SESSION, old)
    except (OSError, Refused) as e:
        decky.logger.warning("multiplayer: couldn't retire the WiiSession (%s)", type(e).__name__)


def _raise(error: OSError) -> None:
    raise error


def _sync_dir(folder: Path) -> None:
    fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
