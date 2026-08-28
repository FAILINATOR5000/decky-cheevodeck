"""
The File Watcher daemon: one thread that wakes every minute, decides whether a
pass is owed, and runs it inline when it is.

Deliberately not a TickServiceBase subclass. That base exists for the RA
daemons and carries a rate-limit backoff, a Retry-After parser and the shared
trickle lock, none of which apply here — this service never talks to
RetroAchievements and never takes an _ra_slot(). Its parking behaviour is its
own too: it doesn't sleep between ticks so much as return to the loop, which is
what makes pausing a six-hour pass free. Cheevo Check declines the base class
for related reasons and says so in its docstring; same here.

One thread rather than two. The tick loop runs the pass in its own body, so
pausing is literally returning to the loop and cancelling is a flag checked in
the hash loop. That collapses an entire category of thread-coordination bugs at
the cost of a tick that occasionally takes six hours to come back around.

**The tick must never touch disk.** With nothing configured it is an integer
test against None; with a schedule set and not due it is an integer compare.
1,440 wakes a day, none of them a syscall beyond the timer. That is a hard
requirement rather than an optimisation: people run this on SD cards and slow
external drives, where a background service that reads a file every minute
forever is a real cost. Disk is touched in exactly three places — plugin load,
a UI edit that writes through, and a running pass.
"""

from collections import deque
from datetime import datetime, timedelta
from pathlib import Path

import hashlib
import os
import stat
import threading
import time

import decky

from file_watcher_store import (
    BUCKET_ADDED,
    BUCKET_CORRUPTED,
    BUCKET_MISSING,
    BUCKET_REPLACED,
    BUCKET_UNREADABLE,
    BUCKET_VERIFIED,
    excluding_rule,
)
from notifications import emit_notification


TICK_SECONDS = 60

STARTUP_GRACE_SECONDS = 60

BOOT_WINDOW_SECONDS = 300

HASH_CHUNK_BYTES = 1024 * 1024

PROGRESS_REPORT_BYTES = 8 * 1024 * 1024

SPEED_SLEEP_FACTORS = {"full": 0.0, "balanced": 1.0, "gentle": 3.0}

CHECKPOINT_FILES = 256
CHECKPOINT_SECONDS = 5.0

QUEUE_CHUNK_ROWS = 512

ENUMERATE_BATCH_ROWS = 2000

GATE_CACHE_SECONDS = 2.0

RATE_WINDOW_SECONDS = 30.0

DEAD_MOUNT_FAILURES = 12

WAITING_WINDOW = "window"
WAITING_GAME = "game"
WAITING_BATTERY_SAVER = "batterySaver"
WAITING_STARTUP = "startup"

SKIP_UNREACHABLE = "unreachable"
SKIP_EMPTY = "empty"

PASS_ORIGIN_MANUAL = "manual"
PASS_ORIGIN_SCHEDULE = "schedule"

_OUTCOME_DONE = "done"
_OUTCOME_PAUSED = "paused"
_OUTCOME_CANCELLED = "cancelled"


def steam_game_running() -> bool:
    """Whether Steam has a game up right now.

    Every Steam launch on Linux goes through the reaper wrapper with a
    SteamLaunch argument, which is the one signal available to a backend that
    isn't inside the Steam session — and this one has to work in Desktop Mode,
    where there is no QAM to ask. Reading comm first keeps this to one small
    read per process for all but the handful that match.

    It does not see an emulator launched straight from the desktop, which is
    accepted: Gentle-by-default is what covers that case, and it's another
    reason not to default the speed knob to Full.
    """
    try:
        entries = os.listdir("/proc")
    except OSError:
        return False
    for entry in entries:
        if not entry.isdigit():
            continue
        try:
            with open("/proc/%s/comm" % entry, "rb") as handle:
                if handle.read(32).strip() != b"reaper":
                    continue
            with open("/proc/%s/cmdline" % entry, "rb") as handle:
                if b"SteamLaunch" in handle.read(4096):
                    return True
        except OSError:
            continue
    return False


def booted_recently() -> bool:
    """Whether this plugin load looks like a machine boot rather than a reload.

    /proc/uptime's first field runs off boottime, so a Deck that spent the night
    suspended reads as having been up all night — which is right, because that
    is a device somebody is already using rather than one still finding its feet.

    Unreadable means no: the cost of guessing wrong that way is a resumed manual
    pass starting a couple of minutes early, against holding every resume behind
    the grace on a box whose /proc doesn't look like Linux's.
    """
    try:
        with open("/proc/uptime", "r") as handle:
            return float(handle.read().split()[0]) < BOOT_WINDOW_SECONDS
    except (OSError, ValueError, IndexError):
        return False


def slot_timestamp(*, anchor_at: int, weekday: int, hour: int, minute: int,
                   every_weeks: int, index: int) -> float:
    """The epoch time of slot ``index``, counting from the anchor.

    Slot 0 is the first moment at or after the anchor that lands on ``weekday``
    at ``hour:minute``; slot k is that plus k * every_weeks weeks.

    The arithmetic runs on naive local datetimes with timedelta(weeks=...) on
    purpose. Adding N * 7 * 86400 seconds drifts by an hour across a DST
    boundary, so an 03:00 scan would start at 02:00 for half the year; a
    timedelta on a naive local datetime preserves the wall-clock hour, and
    .timestamp() puts it back on the epoch with the right offset for that date.
    """
    anchor = datetime.fromtimestamp(anchor_at)
    base = anchor.replace(hour=hour, minute=minute, second=0, microsecond=0)
    base += timedelta(days=(weekday - base.weekday()) % 7)
    if base < anchor:
        base += timedelta(weeks=1)
    return (base + timedelta(weeks=every_weeks * index)).timestamp()


def next_due_after(now: float, schedule: dict, last_scheduled_at: int) -> int:
    """The smallest slot strictly after ``now`` that the guards allow.

    Two rules ride along, and both exist to stop a catch-up run turning into
    two runs:

    Missed slots coalesce, because this only ever returns the *next* one — a
    device off for three weeks runs once on the next boot rather than four
    times.

    And a slot inside half a period of where the last *scheduled* pass began is
    skipped. A catch-up pass starting Saturday evening on a weekly schedule
    would otherwise be followed by the real Sunday 01:00 slot hours later. A
    manual Verify Now deliberately doesn't arm this: the schedule has to stay
    predictable.

    ``last_scheduled_at`` is when that pass *started*, never when it finished —
    see _finish. Measured from the finish, a pass slower than half a period
    pushed the guard past the next slot and halved the cadence, so a weekly scan
    that took four days quietly became fortnightly.
    """
    if not schedule.get("enabled"):
        return 0

    every_weeks = int(schedule.get("everyWeeks") or 4)
    period = every_weeks * 7 * 86400
    anchor_at = int(schedule.get("anchorAt") or 0) or int(now)
    guard = last_scheduled_at + period // 2 if last_scheduled_at else 0

    def at(index):
        return slot_timestamp(
            anchor_at=anchor_at,
            weekday=int(schedule.get("weekday") or 0),
            hour=int(schedule.get("hour") or 0),
            minute=int(schedule.get("minute") or 0),
            every_weeks=every_weeks,
            index=index,
        )

    base = at(0)
    target = max(now, guard)
    index = max(0, int((target - base) // period) - 1)
    for _ in range(8):
        moment = at(index)
        if moment > now and moment >= guard:
            return int(moment)
        index += 1
    return int(at(index))


def inside_blackout(window: dict, now: float) -> bool:
    """Whether the clock is inside the don't-run-now window.

    Midnight crossing is the normal case rather than an edge case: the
    archivalist configuration is "only run overnight", which is expressed as a
    blackout of 08:00 to 23:00 and wraps the other way round the clock.
    """
    if not window.get("enabled"):
        return False
    start = window.get("blockFrom") or [0, 0]
    end = window.get("blockTo") or [0, 0]
    low = int(start[0]) * 60 + int(start[1])
    high = int(end[0]) * 60 + int(end[1])
    if low == high:
        return False
    local = datetime.fromtimestamp(now)
    minutes = local.hour * 60 + local.minute
    if low < high:
        return low <= minutes < high
    return minutes >= low or minutes < high


class FileWatcherService:
    def __init__(self, *, store, settings_store, notifications_store=None, debug_logging=None):
        self._store = store
        self._settings_store = settings_store
        self._notifications = notifications_store
        self._debug_logging = debug_logging or (lambda: False)

        self._event_loop = None
        self._thread = None
        self._lock = threading.Lock()

        self._wake = threading.Event()
        self._stopping = False
        self._cancel = threading.Event()
        self._start_requested = False

        self._next_due_at = 0
        self._schedule = {}
        self._window = {}
        self._last_completed_at = 0
        self._last_scheduled_at = 0

        self._pass = None

        self._due_unstarted = False

        self._rate = 0.0
        self._rate_samples = deque()
        self._rate_bytes = 0
        self._rate_span = 0.0

        self._ready_at = 0
        self._cold_boot = False

        self._prepared = False

        self._config_cache = None
        self._config_read_at = 0.0
        self._game_running = False
        self._game_probed_at = 0.0

        self._park_reason = None
        self._gate_checked_at = 0.0

    def set_event_loop(self, loop) -> None:
        self._event_loop = loop

    def _debug(self, message, *args):
        if self._debug_logging():
            decky.logger.info("filewatcher: " + message, *args)

    def prepare(self) -> None:
        """Load the state the tick holds in memory, and adopt an orphaned pass.

        The adoption matters more than it looks. A pass started in Desktop Mode
        is still running when the user lands in Gaming Mode with a freshly
        mounted React tree that has never heard of it, and a plugin reload
        mid-pass leaves the queue on disk with nothing driving it. Both come
        back here.
        """
        config = self._store.load()
        self._schedule = config["schedule"]
        self._window = config["window"]
        self._last_completed_at = config["lastCompletedAt"]
        self._last_scheduled_at = config["lastScheduledAt"]

        if not self._schedule.get("enabled"):
            self._next_due_at = 0
            if config["nextDueAt"]:
                self._store.set_clocks(next_due_at=0)
        elif config["nextDueAt"]:
            self._next_due_at = config["nextDueAt"]
        else:
            self._next_due_at = next_due_after(time.time(), self._schedule, self._last_scheduled_at)
            self._store.set_clocks(next_due_at=self._next_due_at)

        orphan = self._store.load_pass_state()
        if orphan is None:
            self._clear_pass()
        else:
            with self._lock:
                self._pass = {
                    "active": False,
                    "waitingFor": None,
                    "origin": orphan["origin"],
                    "phase": orphan["phase"],
                    "doneFiles": orphan["doneFiles"],
                    "totalFiles": orphan["totalFiles"],
                    "doneBytes": orphan["doneBytes"],
                    "totalBytes": orphan["totalBytes"],
                    "currentRoot": "",
                }
            decky.logger.info(
                "filewatcher: picked up an unfinished pass (%s, %d/%d files)",
                orphan["phase"], orphan["doneFiles"], orphan["totalFiles"],
            )

        if not self._ready_at:
            self._ready_at = time.time() + STARTUP_GRACE_SECONDS
            self._cold_boot = booted_recently()

        self._prepared = True

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stopping = False
            self._wake.clear()
            thread = threading.Thread(target=self._run_loop, name="file-watcher", daemon=True)
            self._thread = thread
        thread.start()
        decky.logger.info("filewatcher: thread started")

    def stop(self) -> None:
        """Bring the thread down at unload, without losing a pass in flight.

        Deliberately not a cancel. A pass that gets cancelled drops its queue
        and its pending findings; a pass that gets stopped parks exactly where
        it is, with the queue still on disk, so the next plugin load picks it
        back up at the file it was on rather than re-walking a collection.
        """
        self._stopping = True
        self._wake.set()
        decky.logger.info("filewatcher: stop requested")

    def status(self) -> dict:
        with self._lock:
            if self._pass is None:
                return {"pass": None}
            snapshot = dict(self._pass)
            snapshot["etaSeconds"] = self._remaining_seconds()
        return {"pass": snapshot}

    def _remaining_seconds(self):
        """Seconds of hashing left, or None when there is no honest answer.

        Suppressed rather than frozen whenever a pass isn't actually reading:
        "about four hours left" is a lie if fifteen of them are spent parked for
        the blackout window, and a number that stops moving reads as a hung
        scan. The walk has no denominator yet, and a rate of zero means no
        checkpoint has landed since the pass began.

        Called with the lock already held, since the pass it measures is read
        under it and threading.Lock doesn't nest.
        """
        if self._pass is None:
            return None
        if not self._pass["active"] or self._pass["phase"] != "hash":
            return None
        if self._rate <= 0:
            return None
        if self._pass["doneBytes"] * 100 < self._pass["totalBytes"]:
            return None
        remaining = max(0, self._pass["totalBytes"] - self._pass["doneBytes"])
        return int(remaining / self._rate)

    def clocks(self) -> dict:
        return {"lastCompletedAt": self._last_completed_at, "nextDueAt": self._next_due_at}

    def pass_in_flight(self) -> bool:
        with self._lock:
            return self._pass is not None

    def pass_owns_data(self) -> bool:
        """Whether a pass has hold of the roots list and the database yet.

        A different question to pass_in_flight, and the difference is a lockout.
        A scheduled pass that has come due behind a gate has a record so the page
        can say so and nothing else — no queue, no pass row, no walk reading the
        roots. Refusing edits for that one would mean an evening of playing
        something locks the directory list, to protect against a race with a pass
        that hasn't started.
        """
        with self._lock:
            return self._pass is not None and not self._due_unstarted

    def note_gates_changed(self) -> None:
        """A gate knob changed; re-decide now rather than at the next tick.

        A parked pass isn't inside the read loop, so nothing there notices — it
        would sit there for up to a minute waiting on the tick, which reads as
        the switch not working. Waking clears that; dropping the caches is what
        stops the tick answering out of a reading taken before the change.

        Written from the IPC thread where the tick usually owns these, which is
        safe because every one of them is a single assignment and the worst a
        race costs is one extra settings read.
        """
        self._config_cache = None
        self._config_read_at = 0.0
        self._park_reason = None
        self._gate_checked_at = 0.0
        self._wake.set()

    def note_schedule_changed(self, config: dict) -> None:
        """Write-through from a UI edit, so the tick never reads back.

        Recomputing the due time here rather than at the next tick is what keeps
        the page's "Next run" honest the moment the picker closes.

        A pass that is already owed stays owed. Recomputing unconditionally
        would mean opening the schedule picker and pressing Save quietly ate a
        run the device had been waiting to do — and the blackout window is a
        gate rather than a schedule, so saving one has no business moving the
        clock at all. Only a disabled schedule overrides that, since there is
        then nothing to be owed.
        """
        self._schedule = config["schedule"]
        self._window = config["window"]
        self._last_completed_at = config["lastCompletedAt"]
        self._last_scheduled_at = config["lastScheduledAt"]

        now = time.time()
        owed = config["nextDueAt"] and config["nextDueAt"] <= now
        if self._schedule.get("enabled") and owed:
            self._next_due_at = config["nextDueAt"]
        else:
            self._next_due_at = next_due_after(now, self._schedule, self._last_scheduled_at)
        self._store.set_clocks(next_due_at=self._next_due_at)

        with self._lock:
            superseded = self._due_unstarted and (
                not self._next_due_at or self._next_due_at > now
            )
        if superseded:
            self._clear_pass()

    def request_start(self) -> dict:
        if not self._prepared:
            return {"ok": False, "error": "unavailable"}
        if not self._store.load()["roots"]:
            return {"ok": False, "error": "no_roots"}
        with self._lock:
            if self._pass is not None:
                return {"ok": False, "error": "already_running"}
            self._cancel.clear()
            self._start_requested = True
            self._pass = {
                "active": True,
                "waitingFor": None,
                "origin": PASS_ORIGIN_MANUAL,
                "phase": "enumerate",
                "doneFiles": 0,
                "totalFiles": 0,
                "doneBytes": 0,
                "totalBytes": 0,
                "currentRoot": "",
            }
        self._wake.set()
        decky.logger.info("filewatcher: manual pass requested")
        return {"ok": True}

    def request_cancel(self) -> dict:
        """Ask a pass to stop, running or parked.

        A paused pass is still a pass and must never be uncancellable, which is
        why this doesn't care whether anything is actually hashing right now.
        """
        with self._lock:
            existed = self._pass is not None
            self._start_requested = False
        if existed:
            self._cancel.set()
            self._wake.set()
        decky.logger.info("filewatcher: cancel requested (pass=%s)", existed)
        return {"ok": True, "cancelled": existed}

    def quiesce(self, timeout_seconds: float = 5.0) -> bool:
        """Cancel and wait for the pass to actually let go of the database.

        request_cancel returns the moment the flag is set, which is the right
        shape for a button press and the wrong one for a caller that is about to
        delete the files underneath it. The hash loop tests the flag every
        megabyte, so this normally returns in milliseconds; the timeout is there
        so a wedged pass can't hang a factory reset.
        """
        self.request_cancel()
        deadline = time.monotonic() + timeout_seconds
        while self.pass_in_flight() and time.monotonic() < deadline:
            time.sleep(0.05)
        settled = not self.pass_in_flight()
        if not settled:
            decky.logger.warning(
                "filewatcher: pass still running %.1fs after a cancel", timeout_seconds
            )
        return settled

    def _run_loop(self) -> None:
        while not self._stopping:
            try:
                self._tick()
            except Exception as exc:
                decky.logger.exception(
                    "filewatcher: tick crashed: %s (%s)", type(exc).__name__, exc
                )
                self._clear_pass()
            self._wake.wait(self._tick_delay())
            self._wake.clear()

    def _tick_delay(self) -> float:
        """A flat tick, except never sleep through the end of the grace.

        The grace is a whole number of ticks, so the tick that should notice it
        expiring lands on the same instant it expires and it is a coin flip
        which happens first. Lose, and a pass resumed after a restart sat
        parked for a whole extra tick — measured at three minutes against a
        two-minute grace before this. Waking on the boundary costs one early
        wake per plugin load, into an idle path that is two integer tests
        against values already in memory.
        """
        remaining = self._ready_at - time.time()
        if 0 < remaining < TICK_SECONDS:
            return remaining
        return TICK_SECONDS

    def _tick(self) -> None:
        with self._lock:
            has_pass = self._pass is not None
            wants_start = self._start_requested
        if not has_pass and not wants_start and not self._next_due_at:
            return

        now = time.time()
        if not has_pass and not wants_start and now < self._next_due_at:
            return

        if self._cancel.is_set():
            self._abandon()
            return
        if self._stopping:
            return

        if not has_pass and not wants_start:
            self._arm_due_pass()

        blocked = self._blocked_by(now)
        if blocked is None and now < self._ready_at and not self._skips_grace():
            blocked = WAITING_STARTUP
        if blocked is not None:
            self._park(blocked)
            return

        with self._lock:
            starting = self._start_requested
            self._start_requested = False
            due = self._due_unstarted
            self._due_unstarted = False
        if starting:
            self._store.begin_pass(PASS_ORIGIN_MANUAL)
            self._set_pass_field(origin=PASS_ORIGIN_MANUAL, phase="enumerate")
        elif due:
            if not self._store.load()["roots"]:
                self._nothing_to_scan()
                return
            self._store.begin_pass(PASS_ORIGIN_SCHEDULE)
            decky.logger.info("filewatcher: scheduled pass starting")

        self._park_reason = None
        self._gate_checked_at = 0.0
        self._set_pass_field(active=True, waitingFor=None)
        self._run_pass()

    def _blocked_by(self, now: float):
        """Which gate, if any, is holding a due pass back.

        Being due is not permission to start. A blocked pass stays due and
        begins the moment the gate clears, which is the anacron model applied to
        gates as well as to the schedule.

        The window is the one gate a press gets past. It says when the schedule
        may let itself in, and the archivalist setup the feature is built around
        blacks out the whole waking day — so applying it to Verify Now meant
        somebody who set "overnight only" could never check a file during the
        day, and the button they pressed parked on the spot. Battery Saver and
        the game gate still apply to everything: those two are about what else
        the device is doing, not about when a scan is welcome.
        """
        if inside_blackout(self._window, now) and not self._manual_pass():
            return WAITING_WINDOW
        try:
            cfg = self._cached_config(now)
            if (self._settings_store.get_battery_saver(cfg)
                    and self._settings_store.get_battery_saver_disables_file_watcher(cfg)):
                return WAITING_BATTERY_SAVER
        except Exception as exc:
            self._debug("couldn't read settings for the gate check (%s)", exc)
        try:
            gate_on = not self._settings_store.get_file_watcher_run_during_games(
                self._cached_config(now)
            )
        except Exception:
            gate_on = True
        if gate_on and self._cached_game_running(now):
            return WAITING_GAME
        return None

    def _cached_config(self, now: float) -> dict:
        if self._config_cache is None or now - self._config_read_at >= GATE_CACHE_SECONDS:
            self._config_cache = self._settings_store.load_config()
            self._config_read_at = now
        return self._config_cache

    def _cached_game_running(self, now: float) -> bool:
        if now - self._game_probed_at >= GATE_CACHE_SECONDS:
            self._game_running = steam_game_running()
            self._game_probed_at = now
        return self._game_running

    def _gate_wants_park(self, now: float) -> bool:
        """Whether a gate has closed since the last look, checked mid-file.

        The checkpoint is the natural place for this and it isn't enough on its
        own: checkpoints only fire between files, so launching a game — or
        turning Run during games off — while a 20 GB disc image is being read
        did nothing at all until that image finished. Minutes of a switch that
        looks broken.

        Rate-limited to the same two seconds _blocked_by's own caches use, so
        this costs one settings read and one /proc walk per two seconds of
        hashing, which is what a checkpoint on a fast drive was already doing.
        """
        if now - self._gate_checked_at < GATE_CACHE_SECONDS:
            return self._park_reason is not None
        self._gate_checked_at = now
        self._park_reason = self._blocked_by(now)
        return self._park_reason is not None

    def _interrupted(self):
        """Whether something wants the pass to stop, and which kind of stop.

        The two are not the same and getting them confused loses work. A user
        cancel drops the queue and the pending findings; an unload parks the
        pass exactly where it is so the next plugin load resumes at the file it
        was on rather than re-walking a collection.
        """
        if self._cancel.is_set():
            return _OUTCOME_CANCELLED
        if self._stopping:
            return _OUTCOME_PAUSED
        return None

    def _manual_pass(self) -> bool:
        """Whether the user asked for this one, either just now or earlier.

        One that has already started still counts, and so does one picked back
        up off disk after a reload — it is the same scan the user asked for,
        interrupted. What it buys is the blackout window: that is a preference
        about when the *schedule* may run, and a press is not the schedule.
        """
        with self._lock:
            if self._start_requested:
                return True
            return self._pass is not None and self._pass["origin"] == PASS_ORIGIN_MANUAL

    def _skips_grace(self) -> bool:
        """Whether this pass gets to ignore the grace period after a load.

        A press always does. The grace exists because the user just turned the
        device on and wants to play, which is not true of someone standing on
        the page having pressed Verify Now thirty seconds ago.

        A manual pass adopted off disk is the awkward one, and the answer turns
        on what kind of load it was. A plugin reload mid-scan must not hand the
        pass back to the grace that same reload just armed — that is a Deploy in
        the middle of a six-hour run on a device that has been up for hours. A
        cold boot is the opposite case wearing the same clothes: Steam is still
        coming up, and picking a scan straight back up is exactly what the grace
        is for.
        """
        with self._lock:
            if self._start_requested:
                return True
            resumed = self._pass is not None and self._pass["origin"] == PASS_ORIGIN_MANUAL
        return resumed and not self._cold_boot

    def _arm_due_pass(self) -> None:
        """Give a scheduled pass its record the moment it comes due.

        Before the gate check rather than after it, which is the whole point.
        _park has nothing to write a reason into while the pass is still a due
        time and an intention, so a slot that came up behind a running game used
        to wait in complete silence — the panel read idle and the next-run line
        sat in the past, with nothing anywhere admitting a scan was owed. A game
        gets played for hours; that is a long time to look broken.

        Memory only. The row goes on disk when it actually starts, so a reload
        while it waits leaves an owed due time to re-derive rather than an orphan
        of a pass that never ran.
        """
        with self._lock:
            if self._pass is not None:
                return
            self._due_unstarted = True
            self._pass = {
                "active": True,
                "waitingFor": None,
                "origin": PASS_ORIGIN_SCHEDULE,
                "phase": "enumerate",
                "doneFiles": 0,
                "totalFiles": 0,
                "doneBytes": 0,
                "totalBytes": 0,
                "currentRoot": "",
            }

    def _nothing_to_scan(self) -> None:
        """A slot came due with no directories left to watch.

        The roots list can be emptied while the schedule stays on — someone
        reorganising a library, or a trashcan press that was meant to be the
        first of two. The pass that followed ran to completion over nothing and
        claimed it: "Last verified" moved to today, the catch-up guard armed, and
        the toast said everything checked out. Nothing had been checked.

        Consuming the slot is still right, or the tick finds it due again a
        minute later and says so forever. Neither clock moves, no report is
        written, and the toast says what actually happened.
        """
        self._clear_pass()
        self._next_due_at = next_due_after(time.time(), self._schedule, self._last_scheduled_at)
        self._store.set_clocks(next_due_at=self._next_due_at)
        decky.logger.info("filewatcher: a slot came due with no directories to check")
        emit_notification(
            ntype="system",
            title_key="File Watcher",
            line_key="Nothing to scan",
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            force_toast=True,
        )

    def _park(self, reason) -> None:
        with self._lock:
            if self._pass is None:
                return
            self._pass["active"] = False
            self._pass["waitingFor"] = reason

    def _clear_pass(self) -> None:
        with self._lock:
            self._pass = None
            self._rate = 0.0
            self._rate_samples.clear()
            self._rate_bytes = 0
            self._rate_span = 0.0
            self._due_unstarted = False

    def _set_pass_field(self, **fields) -> None:
        with self._lock:
            if self._pass is not None:
                self._pass.update(fields)

    def _run_pass(self) -> None:
        started = time.monotonic()
        config = self._store.load()
        roots = config["roots"]

        state = self._store.load_pass_state()
        if state is None:
            decky.logger.warning("filewatcher: no pass on disk to run, dropping the stale one")
            self._clear_pass()
            return

        if state["phase"] == "enumerate":
            outcome = self._enumerate(roots)
            if outcome == _OUTCOME_DONE:
                totals = self._store.finish_enumerate()
                self._set_pass_field(
                    phase="hash",
                    totalFiles=totals["totalFiles"],
                    totalBytes=totals["totalBytes"],
                )
        else:
            outcome = _OUTCOME_DONE

        if outcome == _OUTCOME_DONE:
            outcome = self._hash_everything(roots, state["startedAt"])

        if outcome == _OUTCOME_CANCELLED:
            self._abandon()
            decky.logger.info("filewatcher: pass cancelled after %.1fs", time.monotonic() - started)
            return
        if outcome == _OUTCOME_PAUSED:
            self._debug("pass parked after %.1fs", time.monotonic() - started)
            return

        self._finish(roots, started, state["origin"], state["startedAt"])

    def _enumerate(self, roots) -> str:
        """Phase one: walk every root, stat only, and write the work list.

        This is not the rejected quick-pass/deep-pass split wearing a disguise.
        It produces no verdict and no report — it only builds a list. Two things
        fall out of it for free: a resume becomes exact (hash the rows still
        marked not-done rather than re-walking), and the progress bar has a real
        denominator from the first second instead of a total that grows as it
        goes.
        """
        mapped = self._store.root_stats()

        for root in roots:
            outcome = self._interrupted()
            if outcome is not None:
                return outcome

            path = root["path"]
            try:
                resolved = os.path.realpath(path)
            except OSError:
                resolved = path
            if not os.path.isdir(resolved):
                self._skip_root(root, SKIP_UNREACHABLE)
                continue

            self._set_pass_field(currentRoot=root["label"])
            counted = self._walk_root(root, resolved)
            if counted is None:
                self._skip_root(root, SKIP_UNREACHABLE)
                continue

            known = (mapped.get(str(root["id"])) or {}).get("files") or 0
            if counted == 0 and known > 0:
                self._skip_root(root, SKIP_EMPTY)
                continue

            self._store.promote_excluded(root["id"])
            self._debug("%s: %d files queued", root["label"], counted)

        return self._interrupted() or _OUTCOME_DONE

    def _walk_root(self, root, resolved: str):
        """Queue every file under one root, or None if the root died mid-walk."""
        root_id = root["id"]
        patterns = root["excludes"]
        self._store.clear_excluded_pending(root_id)
        batch = []
        ignored = []
        ignored_dirs = 0
        ignored_files = 0
        total = 0
        visited = set()
        broke = []

        for dirpath, dirnames, filenames in os.walk(
            resolved, followlinks=True, onerror=broke.append
        ):
            if self._interrupted() is not None:
                return total

            try:
                info = os.stat(dirpath)
            except OSError:
                dirnames[:] = []
                continue
            key = (info.st_dev, info.st_ino)
            if key in visited:
                dirnames[:] = []
                continue
            visited.add(key)

            rel_dir = _relative(resolved, dirpath)
            kept = []
            for name in dirnames:
                rel_sub = _join_rel(rel_dir, name)
                rule = excluding_rule(rel_sub, patterns)
                if rule is None:
                    kept.append(name)
                    continue
                ignored.append((root_id, rel_sub, 1, rule))
                ignored_dirs += 1
            dirnames[:] = kept

            for name in filenames:
                rel_path = _join_rel(rel_dir, name)
                rule = excluding_rule(rel_path, patterns)
                if rule is not None:
                    ignored.append((root_id, rel_path, 0, rule))
                    ignored_files += 1
                    continue
                try:
                    info = os.stat(os.path.join(dirpath, name))
                except OSError:
                    continue
                if not stat.S_ISREG(info.st_mode):
                    continue
                batch.append((root_id, rel_path, info.st_size))
                total += 1
                if len(batch) >= ENUMERATE_BATCH_ROWS:
                    self._store.write_queue(batch)
                    batch = []

            if len(ignored) >= ENUMERATE_BATCH_ROWS:
                self._store.write_excluded(ignored)
                ignored = []

        if batch:
            self._store.write_queue(batch)
        if ignored:
            self._store.write_excluded(ignored)

        if broke and not os.path.isdir(resolved):
            return None

        if ignored_dirs or ignored_files:
            self._debug(
                "%s: ignored %d files and %d folders",
                root["label"], ignored_files, ignored_dirs,
            )
        return total

    def _skip_root(self, root, reason: str) -> None:
        stats = self._store.root_stats().get(str(root["id"])) or {}
        self._store.record_skipped_root(
            root["id"], reason, stats.get("files", 0), stats.get("lastVerified", 0)
        )
        totals = self._store.drop_root_from_queue(root["id"])
        self._set_pass_field(
            totalFiles=totals["totalFiles"], totalBytes=totals["totalBytes"]
        )
        decky.logger.warning(
            "filewatcher: skipping %s (%s), %d mapped files keep their old stamps",
            root["label"], reason, stats.get("files", 0),
        )

    def _hash_everything(self, roots, stamp: int) -> str:
        by_id = {root["id"]: root for root in roots}
        skipped = {row["rootId"] for row in self._store.pending_skipped_rows()}
        maps = {}

        while True:
            outcome = self._interrupted()
            if outcome is not None:
                return outcome

            chunk = self._store.queue_chunk(QUEUE_CHUNK_ROWS)
            if not chunk:
                return _OUTCOME_DONE

            outcome = self._hash_chunk(chunk, by_id, skipped, maps, stamp)
            if outcome != _OUTCOME_DONE:
                return outcome

    def _hash_chunk(self, chunk, by_id, skipped, maps, stamp: int) -> str:
        mapped_rows = []
        finding_rows = []
        done_keys = []
        done_bytes = 0
        last_commit = time.monotonic()
        failures = {}
        current_root = None
        speed = self._read_speed()
        now = int(time.time())

        def flush():
            self._store.checkpoint(
                mapped=mapped_rows,
                findings=finding_rows,
                done_keys=done_keys,
                done_bytes=done_bytes,
            )
            self._bump_progress(done_bytes, time.monotonic() - last_commit)
            mapped_rows.clear()
            finding_rows.clear()
            done_keys.clear()

        for row in chunk:
            root = by_id.get(row["rootId"])
            if root is None or row["rootId"] in skipped:
                done_keys.append((row["rootId"], row["relPath"]))
                continue

            outcome = self._interrupted()
            if outcome is not None:
                flush()
                return outcome

            elapsed = time.monotonic() - last_commit
            if len(done_keys) >= CHECKPOINT_FILES or elapsed >= CHECKPOINT_SECONDS:
                flush()
                done_bytes = 0
                last_commit = time.monotonic()
                speed = self._read_speed()
                blocked = self._blocked_by(time.time())
                if blocked is not None:
                    self._park(blocked)
                    return _OUTCOME_PAUSED

            root_id = row["rootId"]
            if root_id not in maps:
                maps[root_id] = self._store.map_for_root(root_id)
            known = maps[root_id].get(row["relPath"])

            full = os.path.join(root["path"], row["relPath"])
            if current_root != root["label"]:
                current_root = root["label"]
                self._set_pass_field(currentRoot=current_root)

            try:
                digest, before, after = self._hash_file(full, speed)
            except OSError as exc:
                verdict = self._handle_read_failure(root, row, known, exc, failures, skipped)
                if verdict is None:
                    mapped_rows[:] = [item for item in mapped_rows if item[0] != root_id]
                    finding_rows[:] = [item for item in finding_rows if item[0] != root_id]
                    dropped = sum(1 for item in done_keys if item[0] == root_id)
                    done_keys[:] = [item for item in done_keys if item[0] != root_id]
                    self._add_files(-dropped)
                    continue
                finding_rows.append(verdict)
                done_keys.append((row["rootId"], row["relPath"]))
                self._add_files(1)
                continue
            except _Interrupted:
                flush()
                outcome = self._interrupted()
                if outcome is not None:
                    return outcome
                self._park(self._park_reason)
                return _OUTCOME_PAUSED

            size = after.st_size
            mtime_ns = after.st_mtime_ns
            settled = before.st_size == size and before.st_mtime_ns == mtime_ns
            if known is None:
                finding_rows.append((
                    root_id, row["relPath"], BUCKET_ADDED,
                    None, digest, None, size, None, mtime_ns,
                ))
                mapped_rows.append((root_id, row["relPath"], size, mtime_ns, digest, now, stamp))
            elif known[2] == digest:
                mapped_rows.append((root_id, row["relPath"], size, mtime_ns, digest, now, stamp))
            else:
                untouched = known[0] == size and known[1] == mtime_ns and settled
                finding_rows.append((
                    root_id, row["relPath"],
                    BUCKET_CORRUPTED if untouched else BUCKET_REPLACED,
                    known[2], digest, known[0], size, known[1], mtime_ns,
                ))

            done_keys.append((root_id, row["relPath"]))
            done_bytes += size
            self._add_files(1)

        flush()
        return _OUTCOME_DONE

    def _handle_read_failure(self, root, row, known, exc, failures, skipped):
        """Decide whether a failed read is a dying file or a dead mount.

        Getting this backwards is the worst outcome the feature has. Wi-Fi
        drops, or a suspend leaves a stale SMB mount behind, every read after
        that errors, and a naive implementation writes twenty thousand "hard
        media failure" rows because the access point rebooted — in the one
        bucket with no dismissal action and the loudest meaning.

        So an I/O error re-probes the root before it is allowed to become a
        finding, and a run of failures inside one root is treated as a dead
        mount even when the re-probe somehow answers.

        Past that, a path that simply isn't there is Missing rather than
        Unreadable — see below for why the order matters.
        """
        root_id = root["id"]
        count = failures.get(root_id, 0) + 1
        failures[root_id] = count

        reachable = os.path.isdir(root["path"])
        emptied = False
        if reachable:
            try:
                with os.scandir(root["path"]) as entries:
                    first = next(iter(entries), None)
            except OSError:
                reachable = False
            else:
                emptied = first is None

        if not reachable or emptied or count >= DEAD_MOUNT_FAILURES:
            skipped.add(root_id)
            self._skip_root(root, SKIP_EMPTY if emptied else SKIP_UNREACHABLE)
            return None

        if isinstance(exc, (FileNotFoundError, NotADirectoryError)):
            self._debug("%s: %s went away mid-pass", root["label"], row["relPath"])
            return (
                root_id, row["relPath"], BUCKET_MISSING,
                known[2] if known else None, None,
                known[0] if known else None, None,
                known[1] if known else None, None,
            )

        self._debug("%s: couldn't read %s (%s)", root["label"], row["relPath"], exc)
        return (
            root_id, row["relPath"], BUCKET_UNREADABLE,
            known[2] if known else None, None,
            known[0] if known else None, None,
            known[1] if known else None, None,
        )

    def _hash_file(self, path: str, speed: float):
        """Hash a file, stat'ing it on both sides of the read.

        The second stat is what keeps a file somebody was saving out of
        Corrupted. Corrupted means the contents changed and *nothing wrote to
        it*, and that verdict rests entirely on the size and mtime being
        untouched — so a stat taken before a write and a hash taken after
        produces exactly that signature for a perfectly ordinary save. Rare on a
        ROM, routine on anything sitting beside one, and Corrupted is the one
        verdict this feature cannot afford to be casual about.

        fstat on the open handle rather than stat on the path, which also means
        the file we measured is provably the file we read.

        Bytes are reported from inside the loop, not credited to the file when
        it finishes. Checkpoints only fire between files, so a single 20 GB disc
        image used to freeze the bar, the file count and the ETA for its whole
        read — several minutes of a page that looks hung, and an estimate stuck
        on whatever it said before the big file started.
        """
        digest = hashlib.sha256()
        unreported = 0
        with open(path, "rb") as handle:
            before = os.fstat(handle.fileno())
            while True:
                started = time.monotonic()
                block = handle.read(HASH_CHUNK_BYTES)
                if not block:
                    break
                digest.update(block)
                unreported += len(block)
                if unreported >= PROGRESS_REPORT_BYTES:
                    self._add_bytes(unreported)
                    unreported = 0
                    if self._gate_wants_park(time.time()):
                        raise _Interrupted()
                if self._cancel.is_set() or self._stopping:
                    raise _Interrupted()
                if speed:
                    time.sleep((time.monotonic() - started) * speed)
            after = os.fstat(handle.fileno())
        self._add_bytes(unreported)
        return digest.hexdigest(), before, after

    def _read_speed(self) -> float:
        try:
            setting = self._settings_store.get_file_watcher_speed(self._cached_config(time.time()))
        except Exception:
            setting = "gentle"
        return SPEED_SLEEP_FACTORS.get(setting, SPEED_SLEEP_FACTORS["gentle"])

    def _add_bytes(self, size: int) -> None:
        """Credit bytes the hash loop has actually read, mid-file.

        The one thing the page reads that moves continuously. Called every
        8 MB rather than every 1 MB chunk so a fast NVMe isn't taking the lock
        fifteen hundred times a second to move a bar four pixels.
        """
        if size <= 0:
            return
        with self._lock:
            if self._pass is not None:
                self._pass["doneBytes"] += size

    def _add_files(self, count: int) -> None:
        """Credit files as they finish, not as they commit.

        Both numbers used to move only at a checkpoint, which is every 256
        files or five seconds — so a shelf of PS1 discs jumped the count in
        steps of a couple of hundred, and a shelf of Wii images left it a whole
        file behind whatever the path underneath it said. Neither reads as a
        count of what is happening.
        """
        with self._lock:
            if self._pass is not None:
                self._pass["doneFiles"] += count

    def _bump_progress(self, size: int, seconds: float) -> None:
        with self._lock:
            if size <= 0 or seconds <= 0:
                return
            sample = size / seconds
            self._rate_samples.append((size, seconds))
            self._rate_bytes += size
            self._rate_span += seconds
            while len(self._rate_samples) > 1 and self._rate_span > RATE_WINDOW_SECONDS:
                old_size, old_seconds = self._rate_samples.popleft()
                self._rate_bytes -= old_size
                self._rate_span -= old_seconds
            self._rate = self._rate_bytes / self._rate_span
            self._debug(
                "checkpoint: %.1f MB in %.1fs (%.0f MB/s sample, %.0f MB/s smoothed), %s left",
                size / 1048576.0, seconds, sample / 1048576.0, self._rate / 1048576.0,
                self._remaining_seconds(),
            )

    def _finish(self, roots, started: float, origin: str, began_at: int) -> None:
        skipped = {row["rootId"] for row in self._store.pending_skipped_rows()}
        completed = [root["id"] for root in roots if root["id"] not in skipped]
        missing = self._store.sweep_missing(completed)

        counts = self._store.complete_pass()
        now = int(time.time())
        if completed:
            self._last_completed_at = now
            if origin == PASS_ORIGIN_SCHEDULE:
                self._last_scheduled_at = began_at
        self._next_due_at = next_due_after(now, self._schedule, self._last_scheduled_at)
        self._store.set_clocks(
            last_completed_at=self._last_completed_at,
            last_scheduled_at=self._last_scheduled_at,
            next_due_at=self._next_due_at,
        )
        self._clear_pass()

        decky.logger.info(
            "filewatcher: pass finished in %.1fs (corrupted=%d unreadable=%d replaced=%d "
            "missing=%d added=%d verified=%d skipped=%d)",
            time.monotonic() - started,
            counts.get(BUCKET_CORRUPTED, 0), counts.get(BUCKET_UNREADABLE, 0),
            counts.get(BUCKET_REPLACED, 0), missing,
            counts.get(BUCKET_ADDED, 0), counts.get(BUCKET_VERIFIED, 0),
            counts.get("skipped", 0),
        )
        self._notify(counts)

    def _abandon(self) -> None:
        """Drop the pass in flight, keeping the previous report whole.

        The clocks move apart here, and that's the point. lastCompletedAt never
        moves, so the page keeps showing the older, honest verification date — a
        cancel must never buy false confidence.

        nextDueAt only moves for a scheduled pass, which falls back to the next
        slot on the schedule and shows that date the moment the page reloads.
        The slot really was consumed and retrying it two minutes later would be
        nagging. A manual pass has no slot to consume, and advancing anyway ate
        whatever the schedule still owed: boot on a Tuesday morning with the
        03:00 run outstanding, press Verify Now, think better of it, and Tuesday
        quietly became next Tuesday.
        """
        with self._lock:
            origin = self._pass["origin"] if self._pass is not None else ""
        self._store.abandon_pass()
        if origin == PASS_ORIGIN_SCHEDULE:
            self._next_due_at = next_due_after(
                time.time(), self._schedule, self._last_scheduled_at
            )
            self._store.set_clocks(next_due_at=self._next_due_at)
        self._cancel.clear()
        self._clear_pass()

    def _notify(self, counts: dict) -> None:
        """Row and toast, both of them, whatever the System toggles say.

        Every other producer checks is_type_enabled first. This one doesn't,
        because "your files are rotting" is the highest-value thing this plugin
        can ever tell you and it must not be suppressible by a generic chatter
        toggle. A clean pass toasts too: predictability beats cleverness, and
        "everything is fine" is the reassurance the feature exists to provide.

        Nobody sees the toast when a scheduled pass runs in Desktop Mode, since
        there is no QAM there. That's exactly why the row is not optional — it
        is waiting on the way back into Gaming Mode.
        """
        title = "File Watcher"
        row_body = "File Watcher completed with the following results:"
        toast_body = _toast_verdict(counts)

        meta = {
            "corrupted": counts.get(BUCKET_CORRUPTED, 0),
            "unreadable": counts.get(BUCKET_UNREADABLE, 0),
            "replaced": counts.get(BUCKET_REPLACED, 0),
            "missing": counts.get(BUCKET_MISSING, 0),
            "added": counts.get(BUCKET_ADDED, 0),
            "verified": counts.get(BUCKET_VERIFIED, 0),
            "skipped": counts.get("skipped", 0),
        }

        if self._notifications is not None:
            self._notifications.append({
                "type": "system",
                "kind": "actionable",
                "iconSource": "none",
                "title": title,
                "body": row_body,
                "source": "notifications",
                "target": {"view": "fileWatcher"},
                "meta": meta,
            })

        emit_notification(
            ntype="system",
            title_key=title,
            line_key=toast_body,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            force_toast=True,
        )


def _toast_verdict(counts: dict) -> str:
    """Which of the four things a finished pass has to say.

    It used to be two, and the middle was missing: a pass that found twelve
    files gone and four hundred replaced toasted "Everything checks out",
    because only Corrupted and Unreadable counted as bad. Those two still get
    the loud line — they are the ones that mean the hardware is dying — but
    everything else that moved deserves a look, and saying so is not the same
    as crying media failure.

    The first-run rung matters most. Nothing was verified because there was
    nothing to verify against, and "Everything checks out" there claims a
    confidence the pass did not earn — which is the one rule this whole feature
    is built around.
    """
    if counts.get(BUCKET_CORRUPTED, 0) or counts.get(BUCKET_UNREADABLE, 0):
        return "Problems found"
    changed = (
        counts.get(BUCKET_REPLACED, 0)
        + counts.get(BUCKET_MISSING, 0)
        + counts.get("skipped", 0)
    )
    if changed:
        return "Changes to review"
    if not counts.get(BUCKET_VERIFIED, 0) and counts.get(BUCKET_ADDED, 0):
        return "Files recorded"
    return "Everything checks out"


class _Interrupted(Exception):
    pass


def _relative(root: str, path: str) -> str:
    rel = os.path.relpath(path, root)
    return "" if rel == "." else rel


def _join_rel(rel_dir: str, name: str) -> str:
    return f"{rel_dir}/{name}" if rel_dir else name


def default_start_dir(user_home: Path, roots, remembered: str = "") -> str:
    """Where the folder picker should open.

    Wherever the user was last, first — stored rather than derived, so it
    survives an add that got refused for overlapping and a root that has since
    been removed. Then the last-added root's parent, since someone adding
    /roms/ps2 right after /roms/wii should not have to walk the tree again.

    Then the same EmuDeck-then-home ladder Cheevo Check's picker falls back to.
    Every rung is checked for still existing: an SD card that has been ejected,
    or a machine that never had EmuDeck on it, has to land somewhere real, and
    the home directory is the one path that is always there.
    """
    if remembered and os.path.isdir(remembered):
        return remembered
    if roots:
        parent = os.path.dirname(roots[-1]["path"])
        if parent and os.path.isdir(parent):
            return parent
    emudeck = user_home / "Emulation" / "roms"
    return str(emudeck if emudeck.is_dir() else user_home)
