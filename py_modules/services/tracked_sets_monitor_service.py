import asyncio
import contextlib
import random
import threading
import time
import urllib.error

import decky

from services._tick_common import GenerationFence
from notifications import (
    emit_notification,
    is_type_enabled,
    is_type_toast,
    push_debug_notification,
)
from utils import WalkYieldedForClear, norm_game_id, to_int


WALK_DEBOUNCE_MIN_SECONDS = 1.5
WALK_DEBOUNCE_MAX_SECONDS = 2.0

TRACKED_SETS_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60

TRACKED_SETS_SERVICE_UNAVAILABLE_BACKOFF_SECONDS = 30 * 60

MOSAIC_ENTRY_COUNT = 4

WALK_RESULT_TIMEOUT_SECONDS = 120


_generation_fence = GenerationFence()


class TrackedSetsMonitorService:
    """Event-driven daemon that fires a one-time notification when a tracked set completes.

    The companion piece to current_game_service: every time an own-unlock is
    validated there, it hands this service a baton (request_check) naming the
    game that moved. The service collapses a burst of batons into one walk,
    checks locally whether any of those games even sit in a tracked set that
    isn't already 100%, and only then spends a single RA slot on the user-wide
    completion endpoint. If that walk tips a set from incomplete into complete,
    it posts the "set completed" row and/or pops the toast.

    One walk = one IPC, one slot. The paginated completion fetch runs inside a
    single run_ra_call_for_trickle slot (the one-slot rule), held under the
    shared trickle lock so it serializes against the roster / activity /
    comments daemons. A 429 or 503 arms a backoff and the walk bails.

    Dedupe is the cache itself. apply_completion_results_with_transitions only
    reports a set as "just completed" when it was incomplete in the old cache
    and complete in the new one, so once a flip is written the next walk reads
    done-before and stays silent. There's no "congratulated" flag to keep.

    The loop wakes two ways: a baton sets the wake event (an own-unlock burst),
    and the refresh interval lapsing wakes it on a timer (the periodic tick that
    catches a set finished on the website, where no Deck unlock ever fires). The
    baton path is game-scoped (walk only if a moved game sits in an unfinished
    set); the tick is set-wide (walk only if some set still reads incomplete).
    The master toggle gates both -- off, the service is inert.

    Threading: the loop runs on its own daemon thread. request_check is called
    from current_game_service's worker thread; it only touches the pending set
    (under _pending_lock) and pokes the wake event, so it's cheap and safe to
    call from anywhere. The walk itself never touches RA directly -- it bridges
    onto the plugin's asyncio loop via run_coroutine_threadsafe, the same way
    the other trickle daemons take a real slot from off-loop.
    """

    def __init__(self, *, tracked_sets_store, settings_store, notifications_store=None, plugin=None):
        self._tracked_sets_store = tracked_sets_store
        self._settings_store = settings_store

        self._notifications = notifications_store

        self._plugin = plugin

        self._thread = None
        self._stop_event = threading.Event()
        self._lifecycle_lock = threading.Lock()

        self._generation = -1

        self._debug_logging = False

        self._event_loop = None

        self._wake_event = threading.Event()

        self._pending_lock = threading.Lock()
        self._pending_game_ids: set[int] = set()

        self._backoff_until_ts = None

    def _debug_log(self, message, *args):
        if self._debug_logging:
            decky.logger.info(message, *args)

    @contextlib.contextmanager
    def _maybe_hold_trickle_lock(self):
        plugin = self._plugin
        lock = getattr(plugin, "_trickle_tick_lock", None) if plugin is not None else None
        if lock is None:
            yield
            return
        with lock:
            yield

    def _clear_is_pending(self):
        plugin = self._plugin
        return bool(plugin is not None and getattr(plugin, "_clear_waiting", 0) > 0)

    def _active_account_changed(self, tick_ulid):
        try:
            cfg = self._settings_store.load_config()
        except Exception:
            return False
        current = str(cfg.get("activeUlid") or "").strip()
        return current != str(tick_ulid or "").strip()

    def _any_medium_on(self):
        return (
            is_type_enabled("trackedSet", self._settings_store)
            or is_type_toast("trackedSet", self._settings_store)
        )

    def _service_enabled(self):
        try:
            cfg = self._settings_store.load_config()
        except Exception:
            return True
        return self._settings_store.get_tracked_sets_service_enabled(cfg)

    def _battery_saver_active(self):
        try:
            cfg = self._settings_store.load_config()
        except Exception:
            return False
        return self._settings_store.get_battery_saver(cfg) and \
            self._settings_store.get_battery_saver_disables_tracked_sets(cfg)

    def _refresh_interval_seconds(self):
        try:
            cfg = self._settings_store.load_config()
        except Exception:
            return 15 * 60
        return self._settings_store.get_tracked_sets_refresh_minutes(cfg) * 60

    def request_check(self, game_id):
        self._debug_baton_ping(
            "Baton received",
            "current_game_service handed over a baton for game %s." % game_id,
            "Baton received",
        )

        if not self._service_enabled():
            return
        if not self._any_medium_on():
            return
        normalised = norm_game_id(game_id)
        if normalised is None:
            return
        with self._pending_lock:
            self._pending_game_ids.add(normalised)
        self._wake_event.set()

    def set_event_loop(self, loop):
        self._event_loop = loop

    def start(self):
        with self._lifecycle_lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._stop_event.clear()
            self._generation = _generation_fence.claim()
            thread = threading.Thread(
                target=self._run_loop,
                name="tracked-sets-monitor",
                daemon=True,
            )
            self._thread = thread

        thread.start()
        decky.logger.info(
            "tracked sets monitor: thread started (generation %d)",
            self._generation,
        )

    def stop(self):
        self._stop_event.set()
        self._wake_event.set()
        decky.logger.info("tracked sets monitor: stop requested")

    def _run_loop(self):
        my_generation = self._generation
        self._debug_log(
            "tracked sets monitor: loop entered gen=%d tid=%d",
            my_generation,
            threading.get_ident(),
        )

        while not self._stop_event.is_set():
            if not _generation_fence.is_live(my_generation):
                self._debug_log(
                    "tracked sets monitor: gen=%d superseded, exiting tid=%d",
                    my_generation,
                    threading.get_ident(),
                )
                return

            woke_from_baton = self._wake_event.wait(timeout=self._refresh_interval_seconds())
            if self._stop_event.is_set():
                return
            self._wake_event.clear()

            if not self._service_enabled():
                continue

            if self._battery_saver_active():
                self._battery_saver_tick_ping(running=False)
                continue
            self._battery_saver_tick_ping(running=True)

            try:
                if woke_from_baton:
                    if self._stop_event.wait(random.uniform(WALK_DEBOUNCE_MIN_SECONDS, WALK_DEBOUNCE_MAX_SECONDS)):
                        return
                    self._run_one_walk()
                else:
                    self._run_periodic_walk()
            except Exception as exc:
                decky.logger.exception(
                    "tracked sets monitor: walk crashed: %s (%s)",
                    type(exc).__name__,
                    exc,
                )

    def _read_walk_credentials(self):
        try:
            cfg = self._settings_store.load_config()
            self._debug_logging = self._settings_store.get_debug_logging(cfg)
            username = str(cfg.get("username") or "").strip()
            web_api_key = str(cfg.get("webApiKey") or "").strip()
            tick_ulid = str(cfg.get("activeUlid") or "").strip()
        except Exception:
            username = ""
            web_api_key = ""
            tick_ulid = ""
        return username, web_api_key, tick_ulid

    def _run_one_walk(self):
        username, web_api_key, tick_ulid = self._read_walk_credentials()

        self._debug_log(
            "tracked sets monitor: walk gen=%d tid=%d",
            self._generation,
            threading.get_ident(),
        )

        if not username or not web_api_key:
            self._drain_pending()
            return

        if not self._any_medium_on():
            self._drain_pending()
            return

        if self._is_in_backoff():
            self._debug_log("tracked sets monitor: in backoff, leaving pending and skipping walk")
            return

        drained = self._drain_pending()
        if not drained:
            return

        if not self._any_drained_id_in_unfinished_set(drained):
            self._debug_log(
                "tracked sets monitor: no drained id in an unfinished set, skipping walk"
            )
            return

        self._debug_baton_ping(
            "Baton walk",
            "Baton cleared the in-set gate; taking a slot now for games %s."
            % sorted(drained),
            "Baton walking",
        )

        self._walk_and_apply(username, web_api_key, tick_ulid)

    def _run_periodic_walk(self):
        username, web_api_key, tick_ulid = self._read_walk_credentials()

        self._debug_log(
            "tracked sets monitor: periodic tick gen=%d tid=%d",
            self._generation,
            threading.get_ident(),
        )

        if not username or not web_api_key:
            return

        if self._is_in_backoff():
            self._debug_log("tracked sets monitor: in backoff, skipping periodic tick")
            return

        if not self._any_unfinished_set():
            self._debug_log("tracked sets monitor: no unfinished set, skipping periodic tick")
            return

        self._walk_and_apply(username, web_api_key, tick_ulid)

    def _walk_and_apply(self, username, web_api_key, tick_ulid):
        with self._maybe_hold_trickle_lock():
            if self._clear_is_pending():
                self._debug_log("tracked sets monitor: clear pending, yielding walk")
                return
            user_ref = tick_ulid or username
            results = self._walk_completion_through_slot(user_ref, web_api_key, username)
            if results is None:
                return

            if self._active_account_changed(tick_ulid):
                self._debug_log(
                    "tracked sets monitor: account switched mid-walk, dropping results"
                )
                return

            outcome = self._tracked_sets_store.apply_completion_results_with_transitions(results)
            completed = outcome.get("completedSets") or [] if isinstance(outcome, dict) else []
            for set_dict in completed:
                self._fire(set_dict)

    def _drain_pending(self):
        with self._pending_lock:
            drained = set(self._pending_game_ids)
            self._pending_game_ids.clear()
        return drained

    def _any_drained_id_in_unfinished_set(self, drained):
        try:
            data = self._tracked_sets_store.load_all()
        except Exception:
            return False
        for target in data.get("sets", []) or []:
            if self._tracked_sets_store._is_set_completed(target):
                continue
            for card in target.get("games", []) or []:
                if norm_game_id(card.get("gameId")) in drained:
                    return True
        return False

    def _any_unfinished_set(self):
        try:
            data = self._tracked_sets_store.load_all()
        except Exception:
            return False
        for target in data.get("sets", []) or []:
            if not self._tracked_sets_store._is_set_completed(target):
                return True
        return False

    def _walk_completion_through_slot(self, user_ref, web_api_key, username):
        plugin = self._plugin
        loop = self._event_loop
        if plugin is None or loop is None:
            self._debug_log("tracked sets monitor: no plugin/loop, skipping walk")
            return None

        try:
            future = asyncio.run_coroutine_threadsafe(
                plugin.run_ra_call_for_trickle(
                    plugin._completion_results,
                    user_ref,
                    web_api_key,
                    abort_check=self._clear_is_pending,
                ),
                loop,
            )
            return future.result(timeout=WALK_RESULT_TIMEOUT_SECONDS)
        except WalkYieldedForClear:
            self._debug_log("tracked sets monitor: walk yielded to a pending clear")
            return None
        except urllib.error.HTTPError as exc:
            self._handle_http_error(exc, username)
            return None
        except Exception as exc:
            decky.logger.warning(
                "tracked sets monitor: completion walk failed: %s (%s)",
                type(exc).__name__,
                exc,
            )
            return None

    def _fire(self, set_dict):
        set_id = set_dict.get("id")
        set_name = str(set_dict.get("name") or "").strip()
        awarded, possible = self._summed_counts(set_dict)

        if self._notifications is not None and is_type_enabled("trackedSet", self._settings_store):
            self._notifications.append({
                "type": "trackedSet",
                "kind": "actionable",
                "iconSource": "setMosaic",
                "title": "Mastery Goal Complete",
                "body": "",
                "source": "notifications",
                "target": {"setId": set_id},
                "meta": {
                    "setName": set_name,
                    "awarded": awarded,
                    "possible": possible,
                    "mosaicEntries": self._mosaic_entries(set_dict),
                },
            })

        emit_notification(
            ntype="trackedSet",
            title_key="Mastery Goal Complete",
            line_key="{{name}} Completed",
            template_vars={"name": set_name},
            settings_store=self._settings_store,
            event_loop=self._event_loop,
        )

    def fire_test_completion(self):
        try:
            data = self._tracked_sets_store.load_all()
        except Exception as exc:
            decky.logger.warning(
                "tracked sets monitor: test fire couldn't read sets: %s (%s)",
                type(exc).__name__,
                exc,
            )
            return {"ok": False, "reason": "load_failed"}

        sets = data.get("sets") or []
        if not sets:
            return {"ok": True, "fired": False, "reason": "no_sets"}

        first = sets[0]

        faux_games = []
        for card in first.get("games", []) or []:
            max_possible = to_int(card.get("maxPossible"), 0)
            faux_games.append({
                "gameId": card.get("gameId"),
                "imageIcon": card.get("imageIcon"),
                "maxPossible": max_possible,
                "numAwarded": max_possible,
            })
        faux_set = {
            "id": first.get("id"),
            "name": first.get("name"),
            "games": faux_games,
        }

        self._fire(faux_set)
        return {"ok": True, "fired": True, "setName": str(first.get("name") or "")}

    def _debug_baton_ping(self, title, body, toast_body):
        try:
            push_debug_notification(
                store=self._notifications,
                settings_store=self._settings_store,
                event_loop=self._event_loop,
                title=title,
                body=body,
                toast_body=toast_body,
            )
        except Exception as exc:
            decky.logger.warning(
                "tracked sets monitor: baton ping failed: %s (%s)",
                type(exc).__name__,
                exc,
            )

    def _battery_saver_tick_ping(self, running):
        line = "Tick running" if running else "Tick skipped"
        try:
            push_debug_notification(
                store=self._notifications,
                settings_store=self._settings_store,
                event_loop=self._event_loop,
                title="Mastery Goals",
                body=line,
                toast_body=line,
            )
        except Exception as exc:
            decky.logger.warning(
                "tracked sets monitor: battery saver tick ping failed: %s (%s)",
                type(exc).__name__,
                exc,
            )

    def _summed_counts(self, set_dict):
        awarded = 0
        possible = 0
        for card in set_dict.get("games", []) or []:
            num = card.get("numAwarded")
            if num is not None:
                awarded += to_int(num, 0)
            max_possible = card.get("maxPossible")
            if max_possible is not None and to_int(max_possible, 0) > 0:
                possible += to_int(max_possible, 0)
        return awarded, possible

    def _mosaic_entries(self, set_dict):
        entries = []
        for card in set_dict.get("games", []) or []:
            entries.append({
                "gameId": card.get("gameId"),
                "imageIcon": card.get("imageIcon") or None,
            })
            if len(entries) >= MOSAIC_ENTRY_COUNT:
                break
        return entries

    def _handle_http_error(self, exc, username):
        status = getattr(exc, "code", None)

        if status == 429:
            decky.logger.warning(
                "tracked sets monitor: HTTP 429 for %s; backing off for %ss",
                username,
                TRACKED_SETS_RATE_LIMIT_BACKOFF_SECONDS,
            )
            self._enter_backoff(TRACKED_SETS_RATE_LIMIT_BACKOFF_SECONDS)
            return

        if status == 503:
            decky.logger.warning(
                "tracked sets monitor: HTTP 503 for %s; RA looks unwell, backing off for %ss",
                username,
                TRACKED_SETS_SERVICE_UNAVAILABLE_BACKOFF_SECONDS,
            )
            self._enter_backoff(TRACKED_SETS_SERVICE_UNAVAILABLE_BACKOFF_SECONDS)
            return

        decky.logger.warning(
            "tracked sets monitor: HTTP error for %s: %s (%s)",
            username,
            status if status is not None else "?",
            exc,
        )

    def _is_in_backoff(self):
        if self._backoff_until_ts is None:
            return False
        if int(time.time()) >= self._backoff_until_ts:
            self._backoff_until_ts = None
            return False
        return True

    def _enter_backoff(self, seconds):
        new_until = int(time.time()) + max(1, int(seconds))
        if self._backoff_until_ts is not None and self._backoff_until_ts > new_until:
            return
        self._backoff_until_ts = new_until
