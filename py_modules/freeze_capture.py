from datetime import datetime
from pathlib import Path

import os
import re
import shutil

import decky

from utils import ensure_dir, write_file_atomic

CAPTURE_DIR_NAME = "freeze-captures"
CAPTURES_KEPT = 10
CAPTURE_NAME_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-")

JS_LOG_TAIL_LINES = 400
VIEW_LOG_TAIL_LINES = 200
TAIL_READ_BYTES = 256 * 1024

WEBHELPER_COMM = "steamwebhelper"

PAGE_SIZE = os.sysconf("SC_PAGE_SIZE")
CLOCK_TICKS = os.sysconf("SC_CLK_TCK")


class ProcInfo:
    def __init__(self, *, pid: int, comm: str, state: str, ppid: int, cpu_ticks: int, start_ticks: int, rss_bytes: int):
        self.pid = pid
        self.comm = comm
        self.state = state
        self.ppid = ppid
        self.cpu_ticks = cpu_ticks
        self.start_ticks = start_ticks
        self.rss_bytes = rss_bytes


def read_proc(pid: int):
    base = Path("/proc") / str(pid)
    try:
        comm = (base / "comm").read_text().strip()
        stat = (base / "stat").read_text()
        statm = (base / "statm").read_text()
    except OSError:
        return None
    fields = stat[stat.rfind(")") + 2:].split()
    try:
        return ProcInfo(
            pid=pid,
            comm=comm,
            state=fields[0],
            ppid=int(fields[1]),
            cpu_ticks=int(fields[11]) + int(fields[12]),
            start_ticks=int(fields[19]),
            rss_bytes=int(statm.split()[1]) * PAGE_SIZE,
        )
    except (IndexError, ValueError):
        return None


def all_processes() -> list:
    found = []
    try:
        entries = os.listdir("/proc")
    except OSError:
        return found
    for entry in entries:
        if not entry.isdigit():
            continue
        info = read_proc(int(entry))
        if info is not None:
            found.append(info)
    return found


def webhelper_processes() -> list:
    found = []
    try:
        entries = os.listdir("/proc")
    except OSError:
        return found
    for entry in entries:
        if not entry.isdigit():
            continue
        try:
            comm = Path(f"/proc/{entry}/comm").read_text().strip()
        except OSError:
            continue
        if comm != WEBHELPER_COMM:
            continue
        info = read_proc(int(entry))
        if info is not None:
            found.append(info)
    return found


def webhelpers(processes: list) -> list:
    return [info for info in processes if info.comm == WEBHELPER_COMM]


def browser_process(processes: list):
    helpers = webhelpers(processes)
    helper_pids = {info.pid for info in helpers}
    parents = {info.ppid for info in helpers}
    for info in helpers:
        if info.ppid not in helper_pids and info.pid in parents:
            return info
    return None


def uptime_seconds() -> float:
    try:
        return float(Path("/proc/uptime").read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return 0.0


def age_seconds(info, uptime: float) -> float:
    return uptime - info.start_ticks / CLOCK_TICKS


def steam_log_dir(user_home: Path) -> Path:
    return user_home / ".local" / "share" / "Steam" / "logs"


def tail_lines(path: Path, count: int) -> str:
    try:
        with path.open("rb") as handle:
            size = handle.seek(0, os.SEEK_END)
            handle.seek(max(0, size - TAIL_READ_BYTES))
            data = handle.read()
    except OSError as exc:
        return f"(could not read {path}: {type(exc).__name__}: {exc})\n"
    lines = data.decode("utf-8", errors="replace").splitlines()
    return "\n".join(lines[-count:]) + "\n"


def process_table(processes: list, uptime: float) -> str:
    rows = ["pid ppid state rss_mb cpu_s age_s comm"]
    for info in sorted(processes, key=lambda item: item.rss_bytes, reverse=True):
        rows.append(
            "%d %d %s %d %.1f %.0f %s"
            % (
                info.pid,
                info.ppid,
                info.state,
                info.rss_bytes // (1024 * 1024),
                info.cpu_ticks / CLOCK_TICKS,
                age_seconds(info, uptime),
                info.comm,
            )
        )
    return "\n".join(rows) + "\n"


def capture_root() -> Path:
    return Path(decky.DECKY_PLUGIN_LOG_DIR) / CAPTURE_DIR_NAME


def write_capture(*, source: str, summary: str, user_home: Path, extra_files: dict | None = None) -> str:
    name = f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}-{source}"
    try:
        root = capture_root()
        folder = root / name
        logs = steam_log_dir(user_home)
        files = {
            "summary.txt": summary.rstrip("\n") + "\n",
            "processes.txt": process_table(all_processes(), uptime_seconds()),
            "webhelper_js.tail.txt": tail_lines(logs / "webhelper_js.txt", JS_LOG_TAIL_LINES),
            "webhelper.tail.txt": tail_lines(logs / "webhelper.txt", VIEW_LOG_TAIL_LINES),
        }
        files.update(extra_files or {})
        ensure_dir(folder, root)
        for file_name, text in files.items():
            write_file_atomic(folder / file_name, text, trusted=root)
        prune_captures(root)
    except Exception as exc:
        decky.logger.warning("freeze capture: writing %s failed (%s: %s)", name, type(exc).__name__, exc)
        return f"{name} (failed)"
    return name


def clear_captures() -> int:
    root = capture_root()
    try:
        entries = sorted(root.iterdir())
    except OSError:
        return 0
    removed = 0
    for entry in entries:
        if entry.is_dir() and CAPTURE_NAME_PATTERN.match(entry.name):
            shutil.rmtree(entry, ignore_errors=True)
            removed += 1
    return removed


def prune_captures(root: Path) -> None:
    try:
        names = sorted(entry.name for entry in root.iterdir() if entry.is_dir() and CAPTURE_NAME_PATTERN.match(entry.name))
    except OSError:
        return
    for name in names[:-CAPTURES_KEPT]:
        shutil.rmtree(root / name, ignore_errors=True)
