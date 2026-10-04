from pathlib import Path

import os
import select
import socket
import struct
import threading

import decky

STEAM_COMM = b"steam"
GAME_MODE_FLAGS = ("-gamepadui", "-steamos3")
UPDATER_FLAG = "-child-update-ui"
GAMESCOPE_COMM = b"gamescope-wl"
DESKTOP_COMMS = frozenset({b"plasmashell", b"kwin_wayland", b"kwin_x11"})


def session_processes() -> tuple:
    steams = []
    others = set()
    try:
        entries = os.listdir("/proc")
    except OSError:
        return steams, others
    for entry in entries:
        if not entry.isdigit():
            continue
        try:
            comm = Path(f"/proc/{entry}/comm").read_bytes().strip()
        except OSError:
            continue
        if comm == GAMESCOPE_COMM or comm in DESKTOP_COMMS:
            others.add(comm)
            continue
        if comm != STEAM_COMM:
            continue
        try:
            raw = Path(f"/proc/{entry}/cmdline").read_bytes()
        except OSError:
            continue
        if not raw:
            continue
        argv = [arg.decode("utf-8", "replace") for arg in raw.split(b"\0") if arg]
        steams.append((int(entry), argv))
    return steams, others


def read_game_mode(steams: list, others: set, *, steam_is_running: bool) -> tuple:
    if any(flag in argv for _pid, argv in steams for flag in GAME_MODE_FLAGS):
        return True, "flags"
    if not steams:
        return (True, "assumed") if steam_is_running else (False, "none")
    if GAMESCOPE_COMM in others and not others & DESKTOP_COMMS:
        return True, "gamescope"
    return False, "none"


NETLINK_CONNECTOR = 11
CN_IDX_PROC = 1
CN_VAL_PROC = 1
PROC_CN_MCAST_LISTEN = 1
PROC_CN_MCAST_IGNORE = 2
PROC_EVENT_EXEC = 0x00000002
NLMSG_DONE = 3
NLMSG_HEADER = struct.Struct("=IHHII")
CN_MSG_HEADER = struct.Struct("=IIIIHH")
EVENT_HEADER = struct.Struct("=IIQ")
EXEC_EVENT = struct.Struct("=II")
EVENT_OFFSET = NLMSG_HEADER.size + CN_MSG_HEADER.size


def _exec_filter_supported() -> bool:
    try:
        major, minor = (int(part) for part in os.uname().release.split(".")[:2])
    except ValueError:
        return False
    return (major, minor) >= (6, 6)


def _proc_events_control(sock: socket.socket, op: int, *, exec_only: bool = False) -> None:
    payload = struct.pack("=II", op, PROC_EVENT_EXEC) if exec_only else struct.pack("=I", op)
    cn_msg = CN_MSG_HEADER.pack(CN_IDX_PROC, CN_VAL_PROC, 0, 0, len(payload), 0)
    header = NLMSG_HEADER.pack(NLMSG_HEADER.size + len(cn_msg) + len(payload), NLMSG_DONE, 0, 0, 0)
    sock.send(header + cn_msg + payload)


def open_proc_events() -> socket.socket:
    sock = socket.socket(socket.AF_NETLINK, socket.SOCK_DGRAM, NETLINK_CONNECTOR)
    try:
        sock.bind((0, CN_IDX_PROC))
        _proc_events_control(sock, PROC_CN_MCAST_LISTEN, exec_only=_exec_filter_supported())
        sock.setblocking(False)
    except OSError:
        sock.close()
        raise
    return sock


def close_proc_events(sock: socket.socket) -> None:
    try:
        _proc_events_control(sock, PROC_CN_MCAST_IGNORE)
    except OSError:
        pass
    sock.close()


def exec_pids(data: bytes) -> list:
    pids = []
    offset = 0
    while offset + EVENT_OFFSET + EVENT_HEADER.size <= len(data):
        length = NLMSG_HEADER.unpack_from(data, offset)[0]
        if length < EVENT_OFFSET + EVENT_HEADER.size:
            break
        what = EVENT_HEADER.unpack_from(data, offset + EVENT_OFFSET)[0]
        exec_at = offset + EVENT_OFFSET + EVENT_HEADER.size
        if what == PROC_EVENT_EXEC and exec_at + EXEC_EVENT.size <= min(offset + length, len(data)):
            pids.append(EXEC_EVENT.unpack_from(data, exec_at)[1])
        offset += (length + 3) & ~3
    return pids


def steam_started(sock: socket.socket) -> bool:
    started = False
    while True:
        try:
            data = sock.recv(65536)
        except BlockingIOError:
            return started
        except OSError:
            return True
        for pid in exec_pids(data):
            try:
                comm = Path(f"/proc/{pid}/comm").read_bytes().strip()
            except OSError:
                continue
            if comm == STEAM_COMM:
                started = True


def _drain(fd: int) -> None:
    try:
        while os.read(fd, 64):
            pass
    except BlockingIOError:
        pass


class SessionModeService:

    def __init__(self, *, on_change):
        self._on_change = on_change
        self._lock = threading.Lock()
        self._game_mode = False
        self._pidfd = None
        self._started = False
        self._warned = set()
        self._stop_w = None
        self._wake_w = None

    def is_game_mode(self) -> bool:
        return self._game_mode

    def refresh(self, *, from_frontend: bool = False) -> bool:
        with self._lock:
            if self._pidfd is not None or self._stop_w is None:
                return self._game_mode
            changed = self._scan_locked(steam_is_running=from_frontend)
        if changed:
            self._changed()
        return self._game_mode

    def start(self) -> None:
        with self._lock:
            if self._started:
                return
            self._started = True
            stop_r, stop_w = os.pipe()
            wake_r, wake_w = os.pipe()
            for fd in (stop_r, stop_w, wake_r, wake_w):
                os.set_blocking(fd, False)
            self._stop_w = stop_w
            self._wake_w = wake_w
            self._scan_locked()
            game_mode = self._game_mode
        threading.Thread(
            target=self._run,
            args=(stop_r, wake_r),
            name="session-mode",
            daemon=True,
        ).start()
        decky.logger.info("session: %s", self._describe(game_mode))

    def stop(self) -> None:
        with self._lock:
            stop_w = self._stop_w
            wake_w = self._wake_w
            if stop_w is None:
                return
            self._stop_w = None
            self._wake_w = None
            try:
                os.write(stop_w, b"x")
            except OSError:
                pass
            os.close(stop_w)
            os.close(wake_w)

    def _scan_locked(self, *, steam_is_running: bool = False) -> bool:
        processes, others = session_processes()
        game_mode, how = read_game_mode(processes, others, steam_is_running=steam_is_running)
        if how == "gamescope" and "gamescope" not in self._warned:
            self._warned.add("gamescope")
            flags = sorted({arg for _pid, argv in processes for arg in argv[1:] if arg.startswith("-")})
            decky.logger.warning("session: Steam runs without %s, but gamescope runs with no desktop; reading it as Game Mode (Steam's flags: %s)", " or ".join(GAME_MODE_FLAGS), " ".join(flags))
        if how == "assumed" and "assumed" not in self._warned:
            self._warned.add("assumed")
            decky.logger.warning("session: the frontend read settings but no '%s' process was found; assuming Game Mode", STEAM_COMM.decode())
        watch = [pid for pid, argv in processes if UPDATER_FLAG not in argv]
        if not watch:
            watch = [pid for pid, _argv in processes]
        if watch:
            try:
                self._pidfd = os.pidfd_open(min(watch))
            except OSError:
                self._pidfd = None
            else:
                self._wake_thread()
        changed = game_mode != self._game_mode
        self._game_mode = game_mode
        return changed

    def _wake_thread(self) -> None:
        if self._wake_w is None:
            return
        try:
            os.write(self._wake_w, b"x")
        except OSError:
            pass

    def _changed(self) -> None:
        decky.logger.info("session: %s", self._describe(self._game_mode))
        try:
            self._on_change()
        except Exception as exc:
            decky.logger.warning("session: applying the mode change failed (%s: %s)", type(exc).__name__, exc)

    def _describe(self, game_mode: bool) -> str:
        return "Game Mode" if game_mode else "not Game Mode (Desktop Mode, or Steam not running)"

    def _run(self, stop_r: int, wake_r: int) -> None:
        events = None
        events_failed = False
        try:
            while True:
                with self._lock:
                    pidfd = self._pidfd
                if pidfd is None and events is None and not events_failed:
                    try:
                        events = open_proc_events()
                    except OSError as exc:
                        events_failed = True
                        decky.logger.warning("session: no process notices from the kernel (%s: %s)", type(exc).__name__, exc)
                    else:
                        self._rescan_unwatched()
                        continue
                elif pidfd is not None and events is not None:
                    close_proc_events(events)
                    events = None
                watched = [stop_r, wake_r]
                if pidfd is not None:
                    watched.append(pidfd)
                if events is not None:
                    watched.append(events)
                ready, _, _ = select.select(watched, [], [])
                if stop_r in ready:
                    break
                if wake_r in ready:
                    _drain(wake_r)
                if events is not None and events in ready and steam_started(events):
                    self._rescan_unwatched()
                if pidfd is None or pidfd not in ready:
                    continue
                with self._lock:
                    os.close(pidfd)
                    self._pidfd = None
                if events_failed:
                    self._rescan_unwatched()
        except Exception as exc:
            decky.logger.warning("session: thread failed (%s: %s)", type(exc).__name__, exc)
        finally:
            if events is not None:
                close_proc_events(events)
            with self._lock:
                if self._pidfd is not None:
                    os.close(self._pidfd)
                    self._pidfd = None
            os.close(stop_r)
            os.close(wake_r)

    def _rescan_unwatched(self) -> None:
        with self._lock:
            if self._pidfd is not None:
                return
            changed = self._scan_locked()
        if changed:
            self._changed()
