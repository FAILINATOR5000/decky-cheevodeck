import asyncio
import random
import threading
import time
import urllib.error

import decky

from services._tick_common import TickServiceBase
from notifications import (
    emit_notification,
    is_type_enabled,
    push_debug_notification,
)
from utils import ra_user_ref


TRICKLE_STARTUP_DELAY_MIN_SECONDS = 15.0
TRICKLE_STARTUP_DELAY_MAX_SECONDS = 30.0

ACTIVITY_FRIENDS_PER_TICK_FALLBACK = 3

ACTIVITY_FRIEND_COOLDOWN_SECONDS = 2 * 60

ACTIVITY_BETWEEN_FRIEND_DELAY_MIN_SECONDS = 0.75
ACTIVITY_BETWEEN_FRIEND_DELAY_MAX_SECONDS = 2.0

ACTIVITY_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60

ACTIVITY_SERVICE_UNAVAILABLE_BACKOFF_SECONDS = 30 * 60

RETRY_AFTER_CAP_SECONDS = 60 * 60

TRICKLE_LOOKBACK_FALLBACK_MINUTES = 180

TRICKLE_REQUEST_TIMEOUT_SECONDS = 5

ACTIVITY_WEIGHT_REFERENCE_SECONDS = 60 * 60

ACTIVITY_DISABLED_RECHECK_SECONDS = 60

ACTIVITY_FAVORITE_WEIGHT_BONUS = 3.0

ACTIVITY_WEIGHT_FLOOR = 1.0

GAME_TICKER_FRESHNESS_SECONDS = 60 * 60


class SocialActivityTrickleService(TickServiceBase):
    """Background thread that quietly checks a few friends per tick.

    Replaces the old burst-on-page-open refresh path. Activity page reads
    the cache; this service keeps the cache warm. Runs as a daemon thread
    so plugin shutdown can't deadlock on it.
    """

    def __init__(self, *, social_activity_cache_service, game_activity_history_service, settings_store, plugin=None, notifications_store=None):
        super().__init__(
            settings_store=settings_store,
            plugin=plugin,
            thread_name="social-activity-trickle",
            log_label="social activity trickle",
            rate_limit_backoff_seconds=ACTIVITY_RATE_LIMIT_BACKOFF_SECONDS,
            retry_after_cap_seconds=RETRY_AFTER_CAP_SECONDS,
        )
        self._activity = social_activity_cache_service
        self._history = game_activity_history_service

        self._notifications = notifications_store

        self._reschedule_event = threading.Event()

    def stop(self):
        self._stop_event.set()
        self._reschedule_event.set()
        self._log_stop_requested()

    def wake_for_reschedule(self):
        self._reschedule_event.set()

    def _run_loop(self):
        startup_delay = random.uniform(
            TRICKLE_STARTUP_DELAY_MIN_SECONDS,
            TRICKLE_STARTUP_DELAY_MAX_SECONDS,
        )
        my_generation = self._generation
        self._log_loop_entered(my_generation)
        self._log_startup_delay(startup_delay)
        if self._stop_event.wait(startup_delay):
            return

        while not self._stop_event.is_set():
            if not self._generation_fence.is_live(my_generation):
                self._debug_log(
                    "social activity trickle: gen=%d superseded, exiting tid=%d",
                    my_generation,
                    threading.get_ident(),
                )
                return

            try:
                self._run_one_tick()
            except Exception as exc:
                self._log_tick_crashed(exc)

            sleep_seconds = self._next_tick_delay_seconds()
            if self._wait_for_next_tick(sleep_seconds):
                return

    def _wait_for_next_tick(self, seconds):
        deadline = time.monotonic() + seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            woke = self._reschedule_event.wait(remaining)
            if self._stop_event.is_set():
                return True
            if not woke:
                return False
            self._reschedule_event.clear()
            deadline = time.monotonic() + self._next_tick_delay_seconds()

    def _next_tick_delay_seconds(self):
        cfg = self._settings_store.load_config()
        if not self._settings_store.get_social_activity_trickle_service(cfg):
            return ACTIVITY_DISABLED_RECHECK_SECONDS
        minutes = self._settings_store.get_activity_cache_minutes(cfg)
        return max(60, int(minutes) * 60)

    def _lookback_minutes(self, cfg):
        try:
            hours = self._settings_store.get_trickle_lookback_hours(cfg)
        except Exception:
            return TRICKLE_LOOKBACK_FALLBACK_MINUTES
        return max(1, int(hours)) * 60

    def _friends_per_tick(self, cfg):
        try:
            return int(self._settings_store.get_activity_friends_per_tick(cfg))
        except Exception:
            return ACTIVITY_FRIENDS_PER_TICK_FALLBACK

    def _run_one_tick(self):
        cfg = self._settings_store.load_config()
        self._debug_logging = self._settings_store.get_debug_logging(cfg)

        self._debug_log(
            "social activity trickle: tick gen=%d tid=%d",
            self._generation,
            threading.get_ident(),
        )

        if not self._settings_store.get_social_activity_trickle_service(cfg):
            return

        if self._settings_store.get_battery_saver(cfg) and \
                self._settings_store.get_battery_saver_disables_social_activity(cfg):
            push_debug_notification(
                store=self._notifications,
                settings_store=self._settings_store,
                event_loop=self._event_loop,
                title="Social Activity",
                body="Tick skipped",
                toast_body="Tick skipped",
            )
            return

        push_debug_notification(
            store=self._notifications,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            title="Social Activity",
            body="Tick running",
            toast_body="Tick running",
        )

        if self._is_in_backoff() and self._backoff_until_ts is not None:
            remaining = max(0, self._backoff_until_ts - int(time.time()))
            self._debug_log(
                "social activity trickle: skipping tick, in backoff for %ss more",
                remaining,
            )
            return

        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            return

        tick_ulid = str(cfg.get("activeUlid") or "").strip()

        cache = self._activity._normalise_cache(self._activity._cache_store.load_social_activity())
        friends = self._activity._normalise_friends()
        if not friends:
            self._debug_log("social activity trickle: no friends in roster, skipping tick")
            return

        favorite_keys = self._activity._normalise_favorite_keys()
        if self._settings_store.get_trickle_favorites_only(cfg):
            friends = [
                friend for friend in friends
                if str(friend.get("ulid") or "").strip().lower() in favorite_keys
            ]
            if not friends:
                self._debug_log("social activity trickle: favorites only and none starred, skipping tick")
                return

        friends_per_tick = self._friends_per_tick(cfg)
        candidates = self._pick_candidates(friends, favorite_keys, cache, friends_per_tick)
        if not candidates:
            self._debug_log("social activity trickle: no due friends, skipping tick")
            return

        candidate_names = [str(friend.get("username") or "").strip() for friend in candidates]
        self._debug_log(
            "social activity trickle: tick selected=%s",
            candidate_names,
        )

        lookback_minutes = self._lookback_minutes(cfg)
        existing_event_ids = self._activity._snapshot_event_ids(cache)
        new_event_count = 0
        checked_count = 0
        friends_with_new_activity = []

        with self._maybe_hold_trickle_lock():
            for index, friend in enumerate(candidates):
                if self._stop_event.is_set():
                    return
                if not self._generation_fence.is_live(self._generation):
                    return

                if index > 0:
                    delay = random.uniform(
                        ACTIVITY_BETWEEN_FRIEND_DELAY_MIN_SECONDS,
                        ACTIVITY_BETWEEN_FRIEND_DELAY_MAX_SECONDS,
                    )
                    if self._stop_event.wait(delay):
                        return

                outcome = self._check_one_friend(
                    web_api_key,
                    friend,
                    favorite_keys,
                    cache,
                    existing_event_ids,
                    lookback_minutes,
                    tick_ulid,
                )
                checked_count += 1
                if outcome == "rate_limited":
                    return
                if outcome == "ok_new":
                    new_event_count += 1
                    name = str(friend.get("username") or "").strip()
                    if name:
                        friends_with_new_activity.append(name)

        with self._maybe_hold_trickle_lock():
            if self._active_account_changed(tick_ulid):
                self._debug_log(
                    "social activity trickle: account switched mid-tick, dropping arm/emit/save"
                )
                return

            cache["events"] = self._activity._purge_events(cache.get("events", []))
            cache["lastRefreshAt"] = self._activity._now_iso()

            notify_enabled = is_type_enabled("social", self._settings_store)
            notify_toast = self._settings_store.get_notify_social_unlock_toast(cfg)
            game_display = self._settings_store.get_social_game_ticker(cfg)
            hub_display = self._settings_store.get_social_hub_ticker(cfg)

            game_pick = None
            if game_display or notify_enabled or notify_toast:
                game_pick = self._maybe_set_game_ticker(username, tick_ulid, cache, existing_event_ids)

            hub_pick = None
            if hub_display or notify_enabled or notify_toast:
                hub_pick = self._maybe_set_social_hub_ticker(username, tick_ulid, cache)

            with self._activity._cache_store.social_activity_lock():
                latest_disk = self._activity._cache_store.load_social_activity()
                picked_up_clear = False
                if isinstance(latest_disk, dict):
                    if (
                        game_pick is None
                        and cache.get("pendingGameTickerEvent") is not None
                        and latest_disk.get("pendingGameTickerEvent") is None
                    ) or (
                        hub_pick is None
                        and cache.get("pendingSocialHubTickerEvent") is not None
                        and latest_disk.get("pendingSocialHubTickerEvent") is None
                    ):
                        picked_up_clear = True
                    cache["lastShownGameTickerTimestampByGame"] = latest_disk.get("lastShownGameTickerTimestampByGame") or {}
                    if game_pick is None:
                        cache["pendingGameTickerEvent"] = latest_disk.get("pendingGameTickerEvent")
                    cache["lastShownSocialHubTimestamp"] = latest_disk.get("lastShownSocialHubTimestamp")
                    if hub_pick is None:
                        cache["pendingSocialHubTickerEvent"] = latest_disk.get("pendingSocialHubTickerEvent")

                self._activity._cache_store.save_social_activity(cache)

            if picked_up_clear:
                self._debug_log(
                    "social activity trickle: end-of-tick save merged frontend clear from disk"
                )

            if (notify_enabled or notify_toast) and (game_pick is not None or hub_pick is not None):
                self._emit_social_unlock_notifications(cfg, game_pick, hub_pick, notify_enabled)
        self._debug_log(
            "social activity trickle: tick done checked=%s newEvents=%s",
            checked_count,
            new_event_count,
        )

        if friends_with_new_activity:
            debug_body = "New activity from %s (checked %d)" % (
                ", ".join(friends_with_new_activity),
                checked_count,
            )
            debug_toast = "New activity (%d)" % new_event_count
        else:
            debug_body = "No new activity (checked %d %s)" % (
                checked_count,
                "friend" if checked_count == 1 else "friends",
            )
            debug_toast = "No new activity"
        push_debug_notification(
            store=self._notifications,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            title="Friends Trickle Service",
            body=debug_body,
            toast_body=debug_toast,
        )

    def _check_one_friend(self, web_api_key, friend, favorite_keys, cache, existing_event_ids, lookback_minutes, tick_ulid):
        """Make one RA call and merge any new unlocks into the cache.

        Returns one of:
            "ok_new"        — call succeeded and added at least one event
            "ok_empty"      — call succeeded but nothing new
            "error"         — call failed (network, timeout, malformed)
            "rate_limited"  — RA returned 429 or 503; caller should abort
                              the tick. The name is historical; we use it
                              for both rate-limit (429) and service-down
                              (503) because callers don't care which.
        """
        username = str(friend.get("username") or "").strip()
        friend_ref = ra_user_ref(friend)
        friend_ulid = str(friend.get("ulid") or "").strip().lower()
        is_favorite = bool(friend_ulid) and friend_ulid in favorite_keys

        friend_state = cache.setdefault("friendState", {})
        state = dict(friend_state.get(friend_ref) or {})
        state["lastRefreshAt"] = self._activity._now_iso()

        if self._plugin is not None:
            self._plugin.wait_for_ra_quiet(self._stop_event)
            if self._stop_event.is_set():
                friend_state[friend_ref] = state
                return "error"

        try:
            recent_achievements = self._activity._normalise_recent_achievements(
                self._call_ra_recent_achievements(
                    friend_ref,
                    web_api_key,
                    lookback_minutes,
                )
            )
        except urllib.error.HTTPError as exc:
            status = getattr(exc, "code", None)

            backoff_reason = None
            cooldown = 0
            if status == 429:
                backoff_reason = "429"
                retry_after = self._parse_retry_after_seconds(exc)
                cooldown = retry_after if retry_after is not None else ACTIVITY_RATE_LIMIT_BACKOFF_SECONDS
                if retry_after is not None:
                    decky.logger.warning(
                        "social activity trickle: HTTP 429 for %s; honoring Retry-After=%ss",
                        username,
                        retry_after,
                    )
                else:
                    decky.logger.warning(
                        "social activity trickle: HTTP 429 for %s; backing off for %ss",
                        username,
                        cooldown,
                    )
            elif status == 503:
                backoff_reason = "503"
                retry_after = self._parse_retry_after_seconds(exc)
                cooldown = retry_after if retry_after is not None else ACTIVITY_SERVICE_UNAVAILABLE_BACKOFF_SECONDS
                decky.logger.warning(
                    "social activity trickle: HTTP 503 for %s; RA looks unwell, backing off for %ss",
                    username,
                    cooldown,
                )

            if backoff_reason is not None:
                self._enter_backoff(cooldown)
                friend_state[friend_ref] = state
                if self._active_account_changed(tick_ulid):
                    self._debug_log(
                        "social activity trickle: account switched mid-tick, skipping %s save for %s",
                        backoff_reason,
                        username,
                    )
                    return "rate_limited"

                with self._activity._cache_store.social_activity_lock():
                    latest_disk = self._activity._cache_store.load_social_activity()
                    picked_up_clear = False
                    if isinstance(latest_disk, dict):
                        if (
                            cache.get("pendingGameTickerEvent") is not None
                            and latest_disk.get("pendingGameTickerEvent") is None
                        ) or (
                            cache.get("pendingSocialHubTickerEvent") is not None
                            and latest_disk.get("pendingSocialHubTickerEvent") is None
                        ):
                            picked_up_clear = True
                        cache["lastShownGameTickerTimestampByGame"] = latest_disk.get("lastShownGameTickerTimestampByGame") or {}
                        cache["pendingGameTickerEvent"] = latest_disk.get("pendingGameTickerEvent")
                        cache["lastShownSocialHubTimestamp"] = latest_disk.get("lastShownSocialHubTimestamp")
                        cache["pendingSocialHubTickerEvent"] = latest_disk.get("pendingSocialHubTickerEvent")
                    self._activity._cache_store.save_social_activity(cache)
                if picked_up_clear:
                    self._debug_log(
                        "social activity trickle: %s save merged frontend clear from disk for %s",
                        backoff_reason,
                        username,
                    )
                return "rate_limited"

            decky.logger.warning(
                "social activity trickle: HTTP error for %s: %s (%s)",
                username,
                status if status is not None else "?",
                exc,
            )
            friend_state[friend_ref] = state
            return "error"
        except Exception as exc:
            decky.logger.warning(
                "social activity trickle: fetch failed for %s: %s (%s)",
                username,
                type(exc).__name__,
                exc,
            )
            friend_state[friend_ref] = state
            return "error"

        added = 0
        for achievement in recent_achievements:
            achievement_id = achievement.get("achievementId")
            if not achievement_id:
                continue
            candidate_event_id = f"{friend_ref}:achievementUnlocked:{achievement_id}"
            if candidate_event_id in existing_event_ids:
                continue
            event = self._activity._build_achievement_event(username, achievement, is_favorite, friend_ref, friend.get("ulid"))
            cache.setdefault("events", []).append(event)
            existing_event_ids.add(candidate_event_id)
            added += 1

            if is_favorite:
                try:
                    self._history.record_event(event)
                except Exception as exc:
                    decky.logger.warning(
                        "social activity trickle: history record failed for %s: %s (%s)",
                        username,
                        type(exc).__name__,
                        exc,
                    )

        state.pop("lastKnownAchievementIds", None)
        state.pop("lastKnownAchievementRefreshAt", None)
        state.pop("lastKnownLatestGameId", None)
        state.pop("lastKnownLatestGameTitle", None)
        state.pop("lastKnownLatestGameSeenAt", None)

        friend_state[friend_ref] = state

        newest_ts = recent_achievements[0].get("timestamp") if recent_achievements else None
        self._debug_log(
            "social activity trickle: friend=%s favorite=%s returned=%s added=%s newest=%s",
            username,
            is_favorite,
            len(recent_achievements),
            added,
            newest_ts,
        )

        return "ok_new" if added > 0 else "ok_empty"

    def _call_ra_recent_achievements(self, user_ref, web_api_key, lookback_minutes):
        plugin = self._plugin
        loop = getattr(plugin, "_asyncio_loop", None) if plugin is not None else None
        if plugin is None or loop is None:
            return self._activity._ra.get_recent_achievements(
                user_ref,
                web_api_key,
                minutes=lookback_minutes,
                timeout=TRICKLE_REQUEST_TIMEOUT_SECONDS,
            )

        future = asyncio.run_coroutine_threadsafe(
            plugin.run_ra_call_for_trickle(
                self._activity._ra.get_recent_achievements,
                user_ref,
                web_api_key,
                minutes=lookback_minutes,
                timeout=TRICKLE_REQUEST_TIMEOUT_SECONDS,
            ),
            loop,
        )
        return future.result(timeout=TRICKLE_REQUEST_TIMEOUT_SECONDS + 30)

    def _pick_candidates(self, friends, favorite_keys, cache, friends_per_tick):
        """Pick up to ``friends_per_tick`` friends for this tick.

        For per-tick = 3 (default): slot 1 is a due starred friend (oldest
        first), the rest are weighted random.

        For per-tick = 4 or 5: the first 2 slots try to be due starred
        friends (oldest first, so favorites rotate), the rest are weighted
        random. Starred friends still get a bonus weight on the random
        slots, so even with 5/tick a single favorite can't keep skipping
        their cooldown.

        Either way, if there aren't enough starred friends due to fill
        the reserved slots, the remainder falls through to the weighted
        random pool — we never return less than we could.
        """
        friend_state = cache.get("friendState") or {}
        now_ts = int(time.time())

        due_friends = []
        for friend in friends:
            username = str(friend.get("username") or "").strip()
            if not username:
                continue
            if not self._is_friend_due(friend_state, ra_user_ref(friend), now_ts):
                continue
            due_friends.append(friend)

        if not due_friends:
            return []

        selected = []
        selected_keys = set()

        starred_slots = 2 if friends_per_tick >= 4 else 1

        starred_due = [
            friend for friend in due_friends
            if str(friend.get("ulid") or "").strip().lower() in favorite_keys
        ]
        starred_due.sort(
            key=lambda friend: self._seconds_since_last_check(friend_state, friend, now_ts),
            reverse=True,
        )

        for friend in starred_due[:starred_slots]:
            selected.append(friend)
            selected_keys.add(str(friend.get("username") or "").strip().lower())

        while len(selected) < friends_per_tick:
            pool = [
                friend for friend in due_friends
                if str(friend.get("username") or "").strip().lower() not in selected_keys
            ]
            if not pool:
                break

            weights = [
                self._weight_for_friend(friend, friend_state, favorite_keys, now_ts)
                for friend in pool
            ]
            pick = random.choices(pool, weights=weights, k=1)[0]
            selected.append(pick)
            selected_keys.add(str(pick.get("username") or "").strip().lower())

        return selected

    def _is_friend_due(self, friend_state, user_ref, now_ts):
        elapsed = self._seconds_since_last_check_by_ref(friend_state, user_ref, now_ts)
        return elapsed >= ACTIVITY_FRIEND_COOLDOWN_SECONDS

    def _seconds_since_last_check(self, friend_state, friend, now_ts):
        return self._seconds_since_last_check_by_ref(friend_state, ra_user_ref(friend), now_ts)

    def _seconds_since_last_check_by_ref(self, friend_state, user_ref, now_ts):
        if not user_ref:
            return 0
        state = friend_state.get(user_ref) or {}
        last_ts = self._activity._parse_timestamp(state.get("lastRefreshAt"))
        if last_ts is None:
            return ACTIVITY_WEIGHT_REFERENCE_SECONDS
        return max(0, now_ts - last_ts)

    def _weight_for_friend(self, friend, friend_state, favorite_keys, now_ts):
        elapsed = self._seconds_since_last_check(friend_state, friend, now_ts)
        weight = max(ACTIVITY_WEIGHT_FLOOR, min(elapsed, ACTIVITY_WEIGHT_REFERENCE_SECONDS))

        favorite_ulid = str(friend.get("ulid") or "").strip().lower()
        if favorite_ulid in favorite_keys:
            weight *= ACTIVITY_FAVORITE_WEIGHT_BONUS

        return float(weight)

    def _maybe_set_game_ticker(self, own_username, own_ulid, cache, existing_event_ids):
        """Look at every event in the cache that matches the user's
        current game; if any are newer than the last one we showed and
        within the freshness window, stash the freshest as the pending
        nudge. Older pending nudges get overwritten — newer always wins.

        We resolve the user's current game from the cached payload rather
        than making another RA call. That's the same data the main page
        is already showing, so a match here means the line will line up
        with what the user sees on the page.

        The watermark (lastShownGameTickerTimestampByGame, read for the
        current game) is the unlock timestamp of the last nudge we showed
        for THIS game. We only consider events strictly newer than that,
        so once a user has seen achievement A in this game, the next nudge
        has to be for something that happened after A. That keeps the line
        from feeling like it's bouncing around in time, and stops a stale
        event in the cache from re-arming the same nudge after a clear or a
        reload of the game (Issue 9).

        ``existing_event_ids`` is unused now — kept on the signature so
        the call site doesn't have to special-case the no-watermark
        cold-start path.
        """
        del existing_event_ids

        cached_payload = (self._activity._cache_store.load_payload() or {}).get("payload") or {}
        current_game_id = cached_payload.get("gameId")
        if current_game_id in (None, "", 0):
            self._debug_log(
                "social activity trickle: game ticker skipped, no cached current game"
            )
            return None

        own_key = str(own_username or "").strip().lower()
        own_ulid = str(own_ulid or "").strip().lower()
        cutoff_ts = int(time.time()) - GAME_TICKER_FRESHNESS_SECONDS

        fresh_disk_cache = self._activity._cache_store.load_social_activity()
        watermark_source = fresh_disk_cache if isinstance(fresh_disk_cache, dict) else {}
        game_watermarks = watermark_source.get("lastShownGameTickerTimestampByGame")
        if not isinstance(game_watermarks, dict):
            game_watermarks = {}
        watermark_ts = self._activity._parse_timestamp(game_watermarks.get(str(current_game_id)))

        best_event = None
        best_ts = -1

        scanned = 0
        wrong_game = 0
        too_old = 0
        own_user = 0
        already_shown = 0

        for event in cache.get("events") or []:
            if not isinstance(event, dict):
                continue
            if event.get("kind") != "achievementUnlocked":
                continue

            scanned += 1

            if event.get("gameId") != current_game_id:
                wrong_game += 1
                continue

            event_ulid = str(event.get("ulid") or "").strip().lower()
            event_username = str(event.get("username") or "").strip().lower()
            if own_ulid and event_ulid:
                is_own = event_ulid == own_ulid
            else:
                is_own = event_username == own_key
            if not event_username or is_own:
                own_user += 1
                continue

            event_ts = self._activity._parse_timestamp(event.get("timestamp"))
            if event_ts is None or event_ts < cutoff_ts:
                too_old += 1
                continue

            if watermark_ts is not None and event_ts <= watermark_ts:
                already_shown += 1
                continue

            if event_ts > best_ts:
                best_ts = event_ts
                best_event = event

        if best_event is None:
            self._debug_log(
                "social activity trickle: game ticker not armed currentGame=%s scanned=%s wrongGame=%s tooOld=%s ownUser=%s alreadyShown=%s",
                current_game_id,
                scanned,
                wrong_game,
                too_old,
                own_user,
                already_shown,
            )
            return None

        existing_pending = cache.get("pendingGameTickerEvent")
        if isinstance(existing_pending, dict) and existing_pending.get("achievementId") == best_event.get("achievementId"):
            existing_ulid = str(existing_pending.get("ulid") or "").strip().lower()
            candidate_ulid = str(best_event.get("ulid") or "").strip().lower()
            if existing_ulid and candidate_ulid:
                same_unlocker = existing_ulid == candidate_ulid
            else:
                same_unlocker = existing_pending.get("username") == best_event.get("username")
            if same_unlocker:
                return None

        cache["pendingGameTickerEvent"] = {
            "username": str(best_event.get("username") or "").strip(),
            "ulid": str(best_event.get("ulid") or "").strip(),
            "achievementTitle": str(best_event.get("achievementTitle") or "").strip(),
            "achievementId": best_event.get("achievementId"),
            "achievementIcon": best_event.get("achievementIcon"),
            "gameId": best_event.get("gameId"),
            "gameImageIcon": str(cached_payload.get("imageIcon") or "").strip(),
            "gameTitle": best_event.get("gameTitle"),
            "occurredAt": best_event.get("timestamp"),
            "discoveredAt": self._activity._now_iso(),
        }
        self._debug_log(
            "social activity trickle: game ticker armed user=%s game=%s achievement=%s",
            best_event.get("username"),
            best_event.get("gameId"),
            best_event.get("achievementTitle"),
        )
        return cache["pendingGameTickerEvent"]

    def _maybe_set_social_hub_ticker(self, own_username, own_ulid, cache):
        """Sibling of _maybe_set_game_ticker, but for unlocks in any
        OTHER game than the one the user is currently playing.

        We deliberately skip events whose gameId matches the user's
        current game — those are the game ticker's job, and we don't
        want the same unlock to surface in two different lines on the
        same page open. The current game is read from the cached
        payload, same source the game ticker uses.

        The watermark (lastShownSocialHubTimestamp) is independent
        from the game ticker's; they each only consider events strictly
        newer than their own last-shown timestamp.
        """
        cached_payload = (self._activity._cache_store.load_payload() or {}).get("payload") or {}
        current_game_id = cached_payload.get("gameId")

        own_key = str(own_username or "").strip().lower()
        own_ulid = str(own_ulid or "").strip().lower()
        cutoff_ts = int(time.time()) - GAME_TICKER_FRESHNESS_SECONDS

        fresh_disk_cache = self._activity._cache_store.load_social_activity()
        watermark_source = fresh_disk_cache if isinstance(fresh_disk_cache, dict) else {}
        watermark_ts = self._activity._parse_timestamp(watermark_source.get("lastShownSocialHubTimestamp"))

        best_event = None
        best_ts = -1

        scanned = 0
        current_game = 0
        too_old = 0
        own_user = 0
        already_shown = 0

        for event in cache.get("events") or []:
            if not isinstance(event, dict):
                continue
            if event.get("kind") != "achievementUnlocked":
                continue

            scanned += 1

            if current_game_id not in (None, "", 0) and event.get("gameId") == current_game_id:
                current_game += 1
                continue

            event_ulid = str(event.get("ulid") or "").strip().lower()
            event_username = str(event.get("username") or "").strip().lower()
            if own_ulid and event_ulid:
                is_own = event_ulid == own_ulid
            else:
                is_own = event_username == own_key
            if not event_username or is_own:
                own_user += 1
                continue

            event_ts = self._activity._parse_timestamp(event.get("timestamp"))
            if event_ts is None or event_ts < cutoff_ts:
                too_old += 1
                continue

            if watermark_ts is not None and event_ts <= watermark_ts:
                already_shown += 1
                continue

            if event_ts > best_ts:
                best_ts = event_ts
                best_event = event

        if best_event is None:
            self._debug_log(
                "social activity trickle: social hub ticker not armed currentGame=%s scanned=%s currentGame=%s tooOld=%s ownUser=%s alreadyShown=%s",
                current_game_id,
                scanned,
                current_game,
                too_old,
                own_user,
                already_shown,
            )
            return None

        existing_pending = cache.get("pendingSocialHubTickerEvent")
        if isinstance(existing_pending, dict) and existing_pending.get("achievementId") == best_event.get("achievementId"):
            existing_ulid = str(existing_pending.get("ulid") or "").strip().lower()
            candidate_ulid = str(best_event.get("ulid") or "").strip().lower()
            if existing_ulid and candidate_ulid:
                same_unlocker = existing_ulid == candidate_ulid
            else:
                same_unlocker = existing_pending.get("username") == best_event.get("username")
            if same_unlocker:
                return None

        cache["pendingSocialHubTickerEvent"] = {
            "username": str(best_event.get("username") or "").strip(),
            "ulid": str(best_event.get("ulid") or "").strip(),
            "achievementTitle": str(best_event.get("achievementTitle") or "").strip(),
            "achievementId": best_event.get("achievementId"),
            "achievementIcon": best_event.get("achievementIcon"),
            "achievementDescription": best_event.get("achievementDescription") or "",
            "points": best_event.get("points") or 0,
            "trueRatio": best_event.get("trueRatio") or 0,
            "hardcore": bool(best_event.get("hardcore")),
            "gameId": best_event.get("gameId"),
            "gameTitle": best_event.get("gameTitle"),
            "gameImageIcon": str(best_event.get("gameImageIcon") or "").strip(),
            "occurredAt": best_event.get("timestamp"),
            "discoveredAt": self._activity._now_iso(),
        }
        self._debug_log(
            "social activity trickle: social hub ticker armed user=%s game=%s achievement=%s",
            best_event.get("username"),
            best_event.get("gameId"),
            best_event.get("achievementTitle"),
        )
        return cache["pendingSocialHubTickerEvent"]

    def _emit_social_unlock_notifications(self, cfg, game_pick, hub_pick, notify_enabled):
        """Turn this tick's ticker picks into notifications.

        A stored row per pick when the social notification is enabled, and
        a single toast -- favouring the current-game pick if both passes
        armed, since that's the unlock tied to what the user's actually
        looking at. emit_notification self-gates the toast popup on the
        social toast toggle and still emits the event that refreshes an
        open modal / the unread dot, so we always call it and let it
        decide. Everything's built from the pick dicts the passes already
        produced, so there's no extra RA call here.
        """
        if notify_enabled and self._notifications is not None:
            for pick in (game_pick, hub_pick):
                if pick is not None:
                    self._append_social_unlock_row(pick)

        toast_pick = game_pick if game_pick is not None else hub_pick
        if toast_pick is not None:
            friend = str(toast_pick.get("username") or "").strip()
            emit_notification(
                ntype="social",
                title_key="{{name}} Unlocked:",
                template_vars={"name": friend},
                toast_line=str(toast_pick.get("achievementTitle") or "").strip(),
                settings_store=self._settings_store,
                event_loop=self._event_loop,
            )

    def _append_social_unlock_row(self, pick):
        game_id = pick.get("gameId")
        friend = str(pick.get("username") or "").strip()
        ach_title = str(pick.get("achievementTitle") or "").strip()
        self._notifications.append({
            "type": "social",
            "kind": "actionable",
            "title": "Unlocked Achievement",
            "body": ach_title,
            "iconSource": "avatar",
            "iconGameId": None,
            "iconImageIcon": None,
            "target": {
                "view": "achievementOverview",
                "gameId": int(game_id) if game_id else None,
                "achievementId": pick.get("achievementId"),
            },
            "source": "notifications",
            "meta": {
                "username": friend,
                "ulid": str(pick.get("ulid") or "").strip(),
                "achievementTitle": ach_title,
                "gameTitle": pick.get("gameTitle"),
                "badgeName": str(pick.get("achievementIcon") or "").strip(),
                "gameImageIcon": str(pick.get("gameImageIcon") or "").strip(),
            },
        })
        self._debug_log(
            "social activity trickle: social notification row added user=%s game=%s achievement=%s",
            friend,
            game_id,
            ach_title,
        )
