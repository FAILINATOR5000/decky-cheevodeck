import hashlib
import os
import re
import shutil
import stat
import threading
import time
from pathlib import Path

import decky
import rtc_formats
import subprocess_util
from utils import (
    atomic_file,
    child_owner,
    ensure_dir,
    is_newer_schema,
    load_json_file,
    report_newer_schema,
    save_json_file,
    user_file_target,
)

CURRENT_SCHEMA_VERSION = 1
RECORD = "round_saves.json"
ROOT = "round-saves"
UNCLAIMED = "round-saves-unclaimed"
PROVE_PINGS = 3
WROTE_LOG_SECONDS = 60
EXIT_POLL_SECONDS = 5
RAM_MB = 64
MOUNT_SECONDS = 10
RAM_SOURCE = "cheevodeck-round-saves"

SAVE_RAM_CORES = {
    "gambatte": (4, 6),
    "mgba": (4, 5, 6),
    "mesen": (7,),
    "snes9x": (3,),
    "genesis_plus_gx": (1, 11, 15, 33),
    "picodrive": (1, 10, 11, 15),
    "mednafen_pce": (8, 76),
    "mednafen_wswan": (53,),
    "mednafen_vb": (28,),
    "neocd": (56,),
    "mednafen_pcfx": (49,),
    "virtualjaguar": (17,),
    "sameduck": (69,),
    "sameboy": (4, 6),
}

_SESSION = re.compile(r"^[0-9a-f]{16}$")
_SHA1 = re.compile(r"^[0-9a-f]{40}$")


class _Fallback(Exception):
    pass


class RoundSaves:
    def __init__(self, *, runtime_dir, debug_on):
        runtime = Path(runtime_dir)
        self._record = runtime / RECORD
        self._roots = runtime / ROOT
        self._unclaimed = runtime / UNCLAIMED
        self._debug_on = debug_on
        self._lock = threading.Lock()
        self._state = None
        self._live = ""
        self._pending = False
        self._running = None
        self._waiter = None
        self._title = ""
        self._unproven = 0
        self._warned = set()
        self._wrote_at = {}

    @property
    def pending(self) -> bool:
        return self._pending

    def set_running(self, running) -> None:
        self._running = running

    def takes(self, core: str, system_id: int) -> bool:
        return system_id in SAVE_RAM_CORES.get(core, ())

    def root(self, sid: str) -> Path:
        return self._roots / sid

    def _debug(self, message: str, *args) -> None:
        try:
            on = self._debug_on()
        except Exception:
            on = False
        if on:
            decky.logger.info("saves: " + message, *args)

    def _warn_once(self, key: str, message: str, *args) -> None:
        if key not in self._warned:
            self._warned.add(key)
            decky.logger.warning("saves: " + message, *args)

    def _is_running(self, sid: str) -> bool:
        running = self._running_now()
        return running is None or sid in running

    def _running_now(self):
        if self._running is None:
            return None
        try:
            return self._running()
        except Exception as e:
            decky.logger.warning("saves: couldn't list the running rounds (%s)", type(e).__name__)
            return None

    def begin(self, sid: str, game_id: int, title: str, pairs: list, probe=None, clock=None,
              keep_clock: bool = False, fill: int = 0) -> bool:
        with self._lock:
            if not self._clear_earlier_locked():
                decky.logger.info("saves: %s's round saves go straight to the save (an earlier round's emulator "
                                  "is still running)", title)
                return False
            root = self.root(sid)
            ram = self._mount_locked()
            try:
                files = self._seed(root, pairs, clock, keep_clock, fill)
                seen = probe is None or probe(root)
                if not seen and ram:
                    self._debug("RetroArch can't see the memory folder, trying the disk")
                    _remove_tree(root)
                    self._unmount_locked()
                    ram = False
                    files = self._seed(root, pairs, clock, keep_clock, fill)
                    seen = probe(root)
                if not seen:
                    raise _Fallback("RetroArch can't see the round folder")
                state = {"schemaVersion": CURRENT_SCHEMA_VERSION, "session": sid, "game": game_id,
                         "root": str(root), "tier": "memory" if ram else "disk", "files": files,
                         "proven": False, "stray": False, "at": int(time.time())}
                ensure_dir(self._record.parent)
                save_json_file(self._record, state, compact=True)
            except (OSError, _Fallback) as e:
                reason = str(e) if isinstance(e, _Fallback) else f"couldn't set up the round folder, {type(e).__name__}"
                _remove_tree(root)
                self._unmount_locked()
                decky.logger.info("saves: %s's round saves go straight to the save (%s)", title, reason)
                return False
            self._state = state
            self._live = sid
            self._pending = True
            self._title = title
            self._unproven = 0
            self._warned = set()
            self._wrote_at = {}
        decky.logger.info("saves: %s's round saves go through CheevoDeck (%s)", title, state["tier"])
        return True

    def _seed(self, root: Path, pairs: list, clock=None, keep_clock: bool = False, fill: int = 0) -> dict:
        _remove_tree(root)
        ensure_dir(root)
        os.chmod(root, 0o700)
        files = {}
        for index, (real, copy) in enumerate(pairs):
            ensure_dir(copy.parent)
            entry = {"real": str(real), "baseline": None, "lastWritten": None, "size": None, "seeded": None,
                     "blocked": False}
            data = _read(real)
            if index and clock and (data is None or rtc_formats.fits(clock[1], data)):
                entry["clock"] = list(clock)
                entry["lastRound"] = None
            elif index and keep_clock:
                entry["keep"] = True
            if data is not None:
                seed = data
                if entry.get("clock"):
                    seed = rtc_formats.convert(data, clock[1], clock[0], int(time.time()))
                    entry["lastRound"] = _sha1(seed)
                elif not index and len(data) < fill:
                    seed = data + b"\xff" * (fill - len(data))
                with atomic_file(copy) as out:
                    out.write(seed)
                entry["baseline"] = _sha1(data)
                entry["seeded"] = os.stat(copy).st_mtime_ns
            files[str(copy)] = entry
        return files

    def _clear_earlier_locked(self) -> bool:
        raw = self._state if self._state is not None else self._load()
        if raw is None:
            return True
        if self._is_running(raw["session"]):
            return False
        self._finish_locked(raw)
        return not self._record.exists()

    def abandon(self, sid: str) -> None:
        with self._lock:
            raw = self._state if self._state is not None else self._load()
            if raw is None or raw["session"] != sid:
                return
            _remove_tree(Path(raw["root"]))
            self._forget_locked()
            self._unmount_locked()

    def tick(self, sid: str) -> bool:
        with self._lock:
            state = self._state
            if state is None or state["session"] != sid:
                return False
            return self._tick_locked(state, final=False)

    def _tick_locked(self, state: dict, final: bool) -> bool:
        if state["stray"]:
            return False
        if not state["proven"] and not self._prove_locked(state, final):
            return False
        changed = False
        saved = False
        for index, (copy, entry) in enumerate(state["files"].items()):
            if entry["blocked"] or entry.get("keep"):
                continue
            data = _read(copy, follow=False)
            if not data:
                continue
            if entry["size"] is None:
                entry["size"] = len(data)
                self._save_locked(state)
            elif len(data) != entry["size"]:
                self._debug("%s is %s bytes, the round's is %s, skipped", Path(copy).name, len(data), entry["size"])
                continue
            digest = _sha1(data)
            clock = entry.get("clock")
            if clock:
                if digest == entry["lastRound"]:
                    continue
                round_digest = digest
                data = _as_real(entry, data)
                if data is None:
                    self._warn_once("clock:" + copy, "%s isn't in %s's clock format, CheevoDeck left %s alone",
                                    Path(copy).name, clock[0], entry["real"])
                    continue
                digest = _sha1(data)
            last = entry["lastWritten"] or entry["baseline"]
            if digest == last:
                if clock:
                    entry["lastRound"] = round_digest
                continue
            if index and not saved and not final:
                continue
            changed = True
            real = Path(entry["real"])
            if _sha1_of(real) != last:
                entry["blocked"] = True
                self._save_locked(state)
                self._warn_once("changed:" + copy, "%s changed outside the round, CheevoDeck stopped copying "
                                "the round's save over it (%s kept)", real.name, state["root"])
                continue
            try:
                _write_real(real, data)
            except OSError as e:
                self._warn_once("write:" + copy, "couldn't write %s (%s)", real.name, type(e).__name__)
                continue
            entry["lastWritten"] = digest
            if clock:
                entry["lastRound"] = round_digest
            saved = saved or index == 0
            self._save_locked(state)
            now = time.monotonic()
            if final or now - self._wrote_at.get(copy, -WROTE_LOG_SECONDS) >= WROTE_LOG_SECONDS:
                self._wrote_at[copy] = now
                decky.logger.info("saves: wrote %s's save (%s)", self._title or f"game {state['game']}", real.name)
            else:
                self._debug("wrote %s", real.name)
        return changed

    def _prove_locked(self, state: dict, final: bool) -> bool:
        copy, entry = next(iter(state["files"].items()))
        try:
            st = os.lstat(copy)
            written = stat.S_ISREG(st.st_mode) and st.st_size > 0 \
                and (entry["seeded"] is None or st.st_mtime_ns > entry["seeded"])
        except OSError:
            written = False
        if written:
            state["proven"] = True
            self._save_locked(state)
            self._debug("RetroArch saves into the round folder")
            return True
        if final:
            return False
        self._unproven += 1
        if self._unproven < PROVE_PINGS:
            return False
        stray = _unexpected_file(state["files"], Path(state["root"]))
        if stray:
            state["stray"] = True
            self._save_locked(state)
            self._warn_once("stray", "RetroArch is saving %s as %s, not where it was seeded, nothing of the round "
                            "is copied (%s kept)", self._title or f"game {state['game']}", stray, state["root"])
        elif self._unproven == PROVE_PINGS:
            self._debug("nothing written after %s pings, the game has no save memory", PROVE_PINGS)
        return False

    def end(self, sid: str) -> None:
        with self._lock:
            raw = self._state if self._state is not None else self._load()
            if raw is None or raw["session"] != sid:
                return
            if self._is_running(sid):
                self._tick_locked(raw, final=True)
                self._state = raw
                self._live = ""
                self._wait_for_exit_locked(sid)
                return
            self._finish_locked(raw)

    def flush(self, forget: bool = False) -> None:
        with self._lock:
            state = self._state
            if state is not None:
                self._tick_locked(state, final=True)
            if forget:
                self._forget_locked()
                if _mounted(self._roots):
                    for entry in list(self._roots.iterdir()):
                        _remove_tree(entry)
            if state is None or forget:
                self._unmount_locked()

    def adopt(self, sid: str) -> bool:
        with self._lock:
            raw = self._state if self._state is not None else self._load()
            if raw is None or raw["session"] != sid:
                return False
            self._state = raw
            self._live = sid
            self._pending = True
            self._unproven = 0
            return True

    def _finish_locked(self, raw: dict) -> None:
        self._tick_locked(raw, final=True)
        root = Path(raw["root"])
        if raw.get("tier") == "memory" and not root.is_dir():
            decky.logger.info("saves: game %s's round copies were in memory and went with the restart, its save "
                              "has everything up to the last copy", raw["game"])
        why = self._unfinished(raw, root)
        if why and root.is_dir():
            name = time.strftime("%Y%m%d-%H%M%S") + f"-{raw['game']}"
            target = self._unclaimed / name
            try:
                ensure_dir(self._unclaimed)
                shutil.move(root, target)
                decky.logger.warning("saves: kept game %s's round folder at %s (%s)", raw["game"], target, why)
            except OSError as e:
                decky.logger.warning("saves: couldn't keep game %s's round folder (%s), left at %s", raw["game"],
                                     type(e).__name__, root)
                self._state = None
                self._live = ""
                self._pending = False
                return
        else:
            _remove_tree(root)
        self._forget_locked()
        self._unmount_locked()

    def _unfinished(self, raw: dict, root: Path) -> str:
        if raw["stray"]:
            return "RetroArch saved somewhere else"
        files = raw["files"]
        if any(entry["blocked"] for entry in files.values()):
            return "the save changed outside the round"
        for copy, entry in files.items():
            data = _read(copy, follow=False)
            if not data or entry.get("keep") or (entry.get("clock") and _sha1(data) == entry["lastRound"]):
                continue
            data = _as_real(entry, data)
            if data is None or _sha1(data) != (entry["lastWritten"] or entry["baseline"]):
                return "not all of it was copied"
        stray = _unexpected_file(files, root)
        return f"an unexpected file, {stray}" if stray else ""

    def _forget_locked(self) -> None:
        self._state = None
        self._live = ""
        self._pending = False
        self._title = ""
        try:
            os.unlink(self._record)
        except FileNotFoundError:
            pass
        except OSError as e:
            decky.logger.warning("saves: couldn't remove the round record (%s)", type(e).__name__)

    def _wait_for_exit_locked(self, sid: str) -> None:
        self._pending = True
        if self._waiter is not None and self._waiter.is_alive():
            return
        self._waiter = threading.Thread(target=self._wait_for_exit, args=(sid,), name="round-saves-exit",
                                        daemon=True)
        self._waiter.start()

    def _wait_for_exit(self, sid: str) -> None:
        while True:
            time.sleep(EXIT_POLL_SECONDS)
            with self._lock:
                if self._live == sid:
                    return
                raw = self._state if self._state is not None else self._load()
                if raw is None or raw["session"] != sid:
                    return
                if self._is_running(sid):
                    continue
                self._finish_locked(raw)
                return

    def put_back_leftover(self) -> bool:
        with self._lock:
            raw = self._load()
            changed = False
            if raw is not None:
                self._pending = True
                if self._is_running(raw["session"]):
                    self._tick_locked(raw, final=True)
                    self._state = raw
                    self._wait_for_exit_locked(raw["session"])
                else:
                    self._finish_locked(raw)
                    changed = True
            changed = self._sweep_folders_locked() or changed
            self._unmount_locked()
            return changed

    def sweep(self, live: str) -> None:
        with self._lock:
            if self._waiter is not None and self._waiter.is_alive():
                return
            raw = self._state if self._state is not None else self._load()
            if raw is None:
                self._pending = False
            elif raw["session"] == live or raw["session"] == self._live:
                return
            elif self._is_running(raw["session"]):
                self._state = raw
                self._wait_for_exit_locked(raw["session"])
                return
            else:
                self._finish_locked(raw)
            self._sweep_folders_locked()
            self._unmount_locked()

    def _sweep_folders_locked(self) -> bool:
        if not self._roots.is_dir():
            return False
        raw = self._state if self._state is not None else self._load()
        named = raw["session"] if raw is not None else ""
        running = self._running_now()
        if running is None:
            return False
        removed = False
        for entry in self._roots.iterdir():
            if entry.name == named or entry.name in running:
                continue
            _remove_tree(entry)
            removed = True
        return removed

    def _mount_locked(self) -> bool:
        if _mounted(self._roots):
            return True
        owner = child_owner()
        if owner is None:
            return False
        try:
            ensure_dir(self._roots)
            if any(self._roots.iterdir()):
                self._debug("round-saves isn't empty, the round goes on disk")
                return False
            code, _out, err = subprocess_util.run_command(
                ["mount", "-t", "tmpfs", "-o",
                 f"size={RAM_MB}m,mode=0700,uid={owner[0]},gid={owner[1]},nosuid,nodev,noexec",
                 RAM_SOURCE, str(self._roots)], timeout=MOUNT_SECONDS)
        except Exception as e:
            self._debug("couldn't mount the memory folder (%s)", type(e).__name__)
            return False
        if code != 0:
            self._debug("couldn't mount the memory folder (%s)", err.strip()[:200] or f"exit {code}")
            return False
        return True

    def _unmount_locked(self) -> None:
        if not _mounted(self._roots):
            return
        try:
            if any(self._roots.iterdir()):
                return
            code, _out, _err = subprocess_util.run_command(["umount", str(self._roots)], timeout=MOUNT_SECONDS)
            if code != 0:
                code, _out, err = subprocess_util.run_command(["umount", "-l", str(self._roots)],
                                                              timeout=MOUNT_SECONDS)
                if code != 0:
                    decky.logger.warning("saves: couldn't unmount the memory folder (%s)", err.strip()[:200])
        except Exception as e:
            decky.logger.warning("saves: couldn't unmount the memory folder (%s)", type(e).__name__)

    def _load(self):
        raw = load_json_file(self._record, None)
        if raw is None:
            return None
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(self._record)
            return None
        if not _valid(raw, self._roots):
            decky.logger.warning("saves: the round record doesn't read, removing it")
            self._forget_locked()
            return None
        return raw

    def _save_locked(self, state: dict) -> None:
        try:
            save_json_file(self._record, state, compact=True)
        except OSError as e:
            self._warn_once("record", "couldn't keep the round record (%s)", type(e).__name__)


def _valid(raw, roots: Path) -> bool:
    if not isinstance(raw, dict) or not isinstance(raw.get("session"), str) or not _SESSION.match(raw["session"]):
        return False
    root = roots / raw["session"]
    if raw.get("root") != str(root) or type(raw.get("game")) is not int:
        return False
    if type(raw.get("proven")) is not bool or type(raw.get("stray")) is not bool:
        return False
    if raw.get("tier", "disk") not in ("memory", "disk"):
        return False
    files = raw.get("files")
    if not isinstance(files, dict) or not files:
        return False
    for copy, entry in files.items():
        if not isinstance(entry, dict) or not Path(copy).is_relative_to(root) or ".." in Path(copy).parts:
            return False
        if not isinstance(entry.get("real"), str) or not os.path.isabs(entry["real"]):
            return False
        for key in ("baseline", "lastWritten"):
            if entry.get(key) is not None and not (isinstance(entry[key], str) and _SHA1.match(entry[key])):
                return False
        for key in ("size", "seeded"):
            if entry.get(key) is not None and type(entry[key]) is not int:
                return False
        if type(entry.get("blocked")) is not bool or type(entry.get("keep", False)) is not bool:
            return False
        clock = entry.get("clock")
        if clock is not None:
            if not isinstance(clock, list) or len(clock) != 2 or set(clock) != set(rtc_formats.SIZES):
                return False
            last_round = entry.get("lastRound", "")
            if last_round is not None and not (isinstance(last_round, str) and _SHA1.match(last_round)):
                return False
    return True


def _as_real(entry: dict, data: bytes):
    clock = entry.get("clock")
    if not clock:
        return data
    if not rtc_formats.fits(clock[0], data):
        return None
    return rtc_formats.convert(data, clock[0], clock[1], int(time.time()))


def _unexpected_file(files: dict, root: Path) -> str:
    for folder, _dirs, names in os.walk(root):
        for name in names:
            if os.path.join(folder, name) not in files:
                return name
    return ""


def _sha1(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def _read(path, follow: bool = True):
    flags = os.O_RDONLY | os.O_CLOEXEC | (0 if follow else os.O_NOFOLLOW)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError:
        return None
    except OSError:
        if not follow:
            return None
        raise
    with os.fdopen(fd, "rb") as handle:
        return handle.read()


def _sha1_of(path: Path):
    try:
        data = _read(path)
    except OSError:
        return "unreadable"
    return None if data is None else _sha1(data)


def _write_real(path: Path, data: bytes) -> None:
    ensure_dir(path.parent)
    target = user_file_target(path, child_owner())
    try:
        keep = stat.S_IMODE(os.stat(target).st_mode)
    except FileNotFoundError:
        keep = None
    with atomic_file(target, trusted=target.parent, keep_mode=keep, tmp_name=f".{target.name}.cheevodeck-tmp") as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())
    fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _mounted(path: Path) -> bool:
    target = str(path)
    try:
        with open("/proc/self/mountinfo", encoding="utf-8", errors="replace") as handle:
            return any(line.split()[4].replace("\\040", " ") == target for line in handle)
    except (OSError, IndexError):
        return False


def _remove_tree(path: Path) -> None:
    try:
        if path.is_symlink() or not path.is_dir():
            path.unlink(missing_ok=True)
        else:
            shutil.rmtree(path)
    except OSError as e:
        decky.logger.warning("saves: couldn't remove %s (%s)", path.name, type(e).__name__)
