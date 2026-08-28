import contextlib
import threading
import time

import decky


class GenerationFence:
    def __init__(self):
        self._lock = threading.Lock()
        self._current = 0

    def claim(self):
        with self._lock:
            self._current += 1
            return self._current

    def is_live(self, mine):
        with self._lock:
            return mine == self._current


class TickServiceBase:
    """Shared skeleton for the background tick daemons.

    The trickle, friends-roster, comments, and players-near-you services are
    all the same daemon at the lifecycle level: one daemon thread guarded by a
    generation fence, a stop event, a shared-attr lock, a rate-limit backoff
    window, and the same debug-log gate. That common slice lives here so the
    services themselves only carry the part that actually differs -- their
    domain deps, their tick cadence, and how they park between ticks.

    A subclass calls super().__init__() with its own thread name, log label,
    and backoff tuning, then sets its domain deps below the super call. What
    stays per-service on purpose: stop(), the run loop, the between-ticks wait,
    the wake mechanism, and the tick body. Those are the three genuinely
    different cadences a maintainer opens the file to read.
    """

    def __init__(self, *, settings_store, plugin, thread_name, log_label,
                 rate_limit_backoff_seconds, retry_after_cap_seconds=None):
        self._settings_store = settings_store
        self._plugin = plugin

        self._thread_name = thread_name
        self._log_label = log_label

        self._rate_limit_backoff_seconds = rate_limit_backoff_seconds
        self._retry_after_cap_seconds = retry_after_cap_seconds

        self._event_loop = None

        self._thread = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

        self._generation = -1
        self._generation_fence = GenerationFence()

        self._backoff_until_ts = None

        self._debug_logging = False

    def _debug_log(self, message, *args):
        if self._debug_logging:
            decky.logger.info(message, *args)

    def _log_stop_requested(self):
        decky.logger.info("%s: stop requested", self._log_label)

    def _log_loop_entered(self, generation):
        self._debug_log(
            "%s: loop entered gen=%d tid=%d",
            self._log_label,
            generation,
            threading.get_ident(),
        )

    def _log_startup_delay(self, seconds):
        decky.logger.info("%s: starting; first tick in %.1fs", self._log_label, seconds)

    def _log_tick_crashed(self, exc):
        decky.logger.exception(
            "%s: tick crashed: %s (%s)",
            self._log_label,
            type(exc).__name__,
            exc,
        )

    def set_event_loop(self, loop):
        self._event_loop = loop

    def start(self):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._stop_event.clear()
            self._generation = self._generation_fence.claim()
            thread = threading.Thread(
                target=self._run_loop,
                name=self._thread_name,
                daemon=True,
            )
            self._thread = thread

        thread.start()
        decky.logger.info(
            "%s: thread started (generation %d)",
            self._log_label,
            self._generation,
        )

    @contextlib.contextmanager
    def _maybe_hold_trickle_lock(self):
        plugin = self._plugin
        lock = getattr(plugin, "_trickle_tick_lock", None) if plugin is not None else None
        if lock is None:
            yield
            return
        with lock:
            yield

    def _active_account_changed(self, tick_ulid):
        try:
            cfg = self._settings_store.load_config()
        except Exception:
            return False
        current = str(cfg.get("activeUlid") or "").strip()
        return current != str(tick_ulid or "").strip()

    def _is_in_backoff(self):
        if self._backoff_until_ts is None:
            return False
        if int(time.time()) >= self._backoff_until_ts:
            self._backoff_until_ts = None
            return False
        return True

    def _enter_backoff(self, seconds=None):
        if seconds is None:
            seconds = self._rate_limit_backoff_seconds
        new_until = int(time.time()) + max(1, int(seconds))
        if self._backoff_until_ts is not None and self._backoff_until_ts > new_until:
            return
        self._backoff_until_ts = new_until

    def _parse_retry_after_seconds(self, exc):
        headers = getattr(exc, "headers", None)
        if headers is None:
            return None
        raw = headers.get("Retry-After") if hasattr(headers, "get") else None
        if not raw:
            return None
        try:
            seconds = int(str(raw).strip())
        except (TypeError, ValueError):
            return None
        if seconds <= 0:
            return None
        return min(seconds, self._retry_after_cap_seconds)
