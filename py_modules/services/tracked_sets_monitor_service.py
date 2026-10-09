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
    push_debug_notification,
)
from utils import WalkBusy, WalkYieldedForClear, norm_game_id, to_int


WALK_DEBOUNCE_MIN_SECONDS = 1.5
WALK_DEBOUNCE_MAX_SECONDS = 2.0

TRACKED_SETS_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60

TRACKED_SETS_SERVICE_UNAVAILABLE_BACKOFF_SECONDS = 30 * 60

MOSAIC_ENTRY_COUNT = 4

WALK_RESULT_TIMEOUT_SECONDS = 120


_generation_fence = GenerationFence()


class TrackedSetsMonitorService:
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
        self._pending = {}

        self._last_applied_as_of = 0

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

    def _switch_lock(self):
        plugin = self._plugin
        lock = getattr(plugin, "_account_switch_lock", None) if plugin is not None else None
        return lock if lock is not None else contextlib.nullcontext()

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

    def request_check(self, game_id, ulid, data_at, *, counts=None, candidates=None):
        self._debug_baton_ping(
            "Baton received",
            "current_game_service handed over a baton for game %s." % game_id,
            "Baton received",
        )

        if not self._service_enabled():
            return
        normalized = norm_game_id(game_id)
        if normalized is None or (counts is None and not candidates):
            return
        ulid = str(ulid or "").strip()
        data_at = to_int(data_at, 0)

        with self._pending_lock:
            entry = self._pending.get(normalized)
            if entry is None or entry["ulid"] != ulid:
                entry = {"ulid": ulid, "full": None, "unlock": None}
                self._pending[normalized] = entry

            if counts is not None:
                if entry["full"] is None or data_at > entry["full"][0]:
                    entry["full"] = (data_at, counts)
                if entry["unlock"] is not None and entry["unlock"][0] <= entry["full"][0]:
                    entry["unlock"] = None
            elif entry["full"] is None or data_at > entry["full"][0]:
                merged = dict(entry["unlock"][1]) if entry["unlock"] is not None else {}
                for achievement_id, unlocked_at in candidates:
                    key = str(achievement_id)
                    if key not in merged or unlocked_at < merged[key]:
                        merged[key] = unlocked_at
                newest = max(data_at, entry["unlock"][0]) if entry["unlock"] is not None else data_at
                entry["unlock"] = (newest, merged)
        self._wake_event.set()

    def announce_completed(self, sets):
        if not sets or not self._service_enabled():
            return
        for set_dict in sets:
            try:
                self._fire(set_dict, after_press=True)
            except Exception as exc:
                decky.logger.warning(
                    "tracked sets monitor: completion notification failed: %s (%s)",
                    type(exc).__name__,
                    exc,
                )

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

        next_tick_at = time.monotonic() + self._refresh_interval_seconds()

        while not self._stop_event.is_set():
            if not _generation_fence.is_live(my_generation):
                self._debug_log(
                    "tracked sets monitor: gen=%d superseded, exiting tid=%d",
                    my_generation,
                    threading.get_ident(),
                )
                return

            woke_from_baton = self._wake_event.wait(timeout=max(0.0, next_tick_at - time.monotonic()))
            if self._stop_event.is_set():
                return
            self._wake_event.clear()
            tick_due = time.monotonic() >= next_tick_at
            if tick_due:
                next_tick_at = time.monotonic() + self._refresh_interval_seconds()

            if not self._service_enabled():
                continue

            try:
                if woke_from_baton:
                    if self._stop_event.wait(random.uniform(WALK_DEBOUNCE_MIN_SECONDS, WALK_DEBOUNCE_MAX_SECONDS)):
                        return
                    if not _generation_fence.is_live(my_generation):
                        return
                    self._apply_pending_batons()
                if tick_due:
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

    def _apply_pending_batons(self):
        username, web_api_key, tick_ulid = self._read_walk_credentials()

        drained = self._drain_pending()
        if not drained:
            return

        cards = 0
        for game_id, entry in drained.items():
            try:
                cards += self._apply_drained_entry(game_id, entry, username, web_api_key, tick_ulid)
            except Exception as exc:
                decky.logger.warning(
                    "tracked sets monitor: baton apply failed for game %s: %s (%s)",
                    game_id,
                    type(exc).__name__,
                    exc,
                )

        self._debug_log(
            "tracked sets monitor: baton applied games=%s cards=%d",
            sorted(drained),
            cards,
        )
        self._debug_baton_ping(
            "Baton applied",
            "Applied batons for games %s; %d cards moved." % (sorted(drained), cards),
            "Baton applied",
        )

    def _apply_drained_entry(self, game_id, entry, username, web_api_key, tick_ulid):
        ulid = entry["ulid"]
        cards = 0
        if entry["full"] is not None:
            data_at, counts = entry["full"]
            cards += self._apply_baton(game_id, ulid, data_at, counts=counts).get("cards", 0)
        if entry["unlock"] is not None:
            data_at, earliest = entry["unlock"]
            outcome = self._apply_baton(game_id, ulid, data_at, candidates=list(earliest.items()))
            if outcome.get("needsConfirm"):
                confirmed = self._confirm_fetch(game_id, ulid, username, web_api_key, tick_ulid)
                if confirmed is not None:
                    outcome = self._apply_baton(game_id, ulid, confirmed[0], counts=confirmed[1])
            cards += outcome.get("cards", 0)
        return cards

    def _apply_baton(self, game_id, ulid, data_at, *, counts=None, candidates=None):
        with self._switch_lock():
            if self._active_account_changed(ulid):
                self._debug_log("tracked sets monitor: baton for another account, dropping game=%s", game_id)
                return {}
            outcome = self._tracked_sets_store.apply_game_counts(
                game_id,
                data_at=data_at,
                counts=counts,
                candidates=candidates,
            )
            for set_dict in outcome.get("completedSets") or []:
                self._fire(set_dict)
        return outcome

    def _confirm_fetch(self, game_id, ulid, username, web_api_key, tick_ulid):
        if not username or not web_api_key or self._is_in_backoff():
            return None
        if tick_ulid != str(ulid or "").strip():
            return None
        plugin = self._plugin
        loop = self._event_loop
        if plugin is None or loop is None:
            return None

        data_at = int(time.time())
        try:
            future = asyncio.run_coroutine_threadsafe(
                plugin.run_ra_call_for_trickle(
                    plugin.ra.get_game_info_and_user_progress,
                    tick_ulid or username,
                    game_id,
                    web_api_key,
                ),
                loop,
            )
            game = future.result(timeout=WALK_RESULT_TIMEOUT_SECONDS)
            payload = plugin.current_game_service.normalize_game_payload(game, fallback_game_id=game_id)
        except urllib.error.HTTPError as exc:
            self._handle_http_error(exc, username)
            return None
        except Exception as exc:
            decky.logger.warning(
                "tracked sets monitor: completion confirm fetch failed: %s (%s)",
                type(exc).__name__,
                exc,
            )
            return None

        counts = plugin.current_game_service.full_counts_from_payload(payload, game_id)
        self._debug_log(
            "tracked sets monitor: confirm fetch game=%s counts=%s",
            game_id,
            counts,
        )
        if counts is None:
            return None
        return data_at, counts

    def _drain_pending(self):
        with self._pending_lock:
            drained = self._pending
            self._pending = {}
        return drained

    def _run_periodic_walk(self):
        username, web_api_key, tick_ulid = self._read_walk_credentials()

        self._debug_log(
            "tracked sets monitor: periodic tick gen=%d tid=%d",
            self._generation,
            threading.get_ident(),
        )

        if not username or not web_api_key:
            return

        if not self._any_unfinished_set():
            self._debug_log("tracked sets monitor: no unfinished set, skipping periodic tick")
            return

        fetched = self._tick_results_from_cache(tick_ulid)
        from_cache = fetched is not None
        if fetched is None:
            if self._battery_saver_active():
                self._battery_saver_tick_ping(running=False)
                return
            self._battery_saver_tick_ping(running=True)

            if self._is_in_backoff():
                self._debug_log("tracked sets monitor: in backoff, skipping periodic tick")
                return

        with self._maybe_hold_trickle_lock():
            if self._clear_is_pending():
                self._debug_log("tracked sets monitor: clear pending, yielding walk")
                return

            if fetched is None:
                fetched = self._walk_completion_through_slot(tick_ulid or username, web_api_key, username)
                if fetched is None:
                    return
            results, as_of, complete = fetched

            if self._active_account_changed(tick_ulid):
                self._debug_log(
                    "tracked sets monitor: account switched mid-walk, dropping results"
                )
                return

            outcome = self._tracked_sets_store.apply_completion(results, as_of=as_of, complete=complete)
            self._last_applied_as_of = max(self._last_applied_as_of, as_of)
            if from_cache:
                self._debug_log(
                    "tracked sets monitor: tick applied from games-list cache, age=%ds",
                    int(time.time()) - as_of,
                )
            for set_dict in outcome.get("completedSets") or []:
                self._fire(set_dict)

    def _tick_results_from_cache(self, tick_ulid):
        plugin = self._plugin
        if plugin is None or not tick_ulid:
            return None
        cached = plugin.games_list_cache_store.load(tick_ulid, self._refresh_interval_seconds())
        if not cached.get("hit") or not plugin._usable_games_payload(cached["payload"]):
            return None
        payload = cached["payload"]
        as_of = to_int(payload.get("refreshedAt"), 0)
        if as_of <= self._last_applied_as_of:
            return None
        return plugin._results_from_payload(payload), as_of, True

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
                    wait_for_walk=False,
                ),
                loop,
            )
            return future.result(timeout=WALK_RESULT_TIMEOUT_SECONDS)
        except WalkYieldedForClear:
            self._debug_log("tracked sets monitor: walk yielded to a pending clear")
            return None
        except WalkBusy:
            self._debug_log("tracked sets monitor: a walk is already running, skipping this one")
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

    def _fire(self, set_dict, after_press=False):
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
            after_press=after_press,
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
