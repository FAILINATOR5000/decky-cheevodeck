import asyncio
import random
import threading
import time
import urllib.error
from datetime import datetime, timezone

import decky

from players_near_you_store import PLAYERS_NEAR_YOU_DEFAULT_MODE, normalise_mode
from services._tick_common import TickServiceBase
from notifications import (
    emit_notification,
    is_type_enabled,
    is_type_toast,
    push_debug_notification,
)
from utils import to_int


PNY_STARTUP_DELAY_MIN_SECONDS = 45.0
PNY_STARTUP_DELAY_MAX_SECONDS = 60.0

PNY_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60

PNY_SERVICE_UNAVAILABLE_BACKOFF_SECONDS = 30 * 60

PNY_RETRY_AFTER_CAP_SECONDS = 60 * 60

PNY_REQUEST_TIMEOUT_SECONDS = 5

PNY_BETWEEN_CALL_MIN_SECONDS = 1.2
PNY_BETWEEN_CALL_MAX_SECONDS = 1.5

PNY_UNLOCKS_PER_ACHIEVEMENT = 10

PNY_FEED_CAP = 12

PNY_NOTIFY_FRESHNESS_SECONDS = 60 * 60

PNY_DISABLED_RECHECK_SECONDS = 60

PNY_MIN_TICK_FALLBACK_MINUTES = 5
PNY_MAX_TICK_FALLBACK_MINUTES = 15

PNY_PASSED_SPAN = 10
PNY_PASSED_REL = 0.75
PNY_PASSED_FLOOR = 2


_clear_epoch_lock = threading.Lock()
_clear_epoch = 0


def _bump_clear_epoch():
    global _clear_epoch
    with _clear_epoch_lock:
        _clear_epoch += 1
        return _clear_epoch


def _current_clear_epoch():
    with _clear_epoch_lock:
        return _clear_epoch


def _clear_landed_since(captured):
    with _clear_epoch_lock:
        return captured != _clear_epoch


def _is_earned(achievement):
    return bool(achievement.get("dateEarned") or achievement.get("dateEarnedHardcore"))


def _passed_ids(ordered):
    """Ids of the rows the player has provably gone past.

    Unearned, and the region immediately after them has been cleared to at
    least the player's own overall completion rate. See the PNY_PASSED_*
    constants for why the test is shaped this way; it is the most-revised rule
    in the feature and every revision was forced by a real save.

    Type-agnostic on purpose. A non-missable you walked past seventy-five
    achievements ago is exactly as gone as a missable, and restricting this to
    missables cost forty-seven positions of accuracy on the one save that has a
    real unlock history behind it.
    """
    total = len(ordered)
    if not total:
        return frozenset()

    span = min(PNY_PASSED_SPAN, max(3, total // 4))
    bar = PNY_PASSED_REL * (sum(1 for row in ordered if _is_earned(row)) / total)

    passed = set()
    for index, row in enumerate(ordered):
        if _is_earned(row):
            continue
        region = ordered[index + 1:index + 1 + span]
        if not region:
            continue
        hits = sum(1 for other in region if _is_earned(other))
        if hits >= PNY_PASSED_FLOOR and (hits / len(region)) >= bar:
            row_id = to_int(row.get("id"), 0)
            if row_id:
                passed.add(row_id)
    return frozenset(passed)


def _last_unlock_index(ordered):
    """Position of the single most recent unlock, or None if there are none.

    Not a median of the last few: on a real save the recent unlocks were item
    series earnable anywhere in the game, and averaging them landed the anchor
    twenty positions past where the player actually was.

    Ties break toward the furthest position, which is what makes a first sync
    against an existing save — forty unlocks carrying one identical timestamp
    — come out at the end of the run rather than somewhere in the middle of it.
    """
    best = None
    for index, row in enumerate(ordered):
        stamp = row.get("dateEarnedHardcore") or row.get("dateEarned")
        if not stamp:
            continue
        candidate = (str(stamp), index)
        if best is None or candidate > best:
            best = candidate
    return None if best is None else best[1]


def _first_locked_index(ordered, skip, start=0):
    for index in range(start, len(ordered)):
        row = ordered[index]
        if _is_earned(row):
            continue
        if to_int(row.get("id"), 0) in skip:
            continue
        return index
    return None


class PlayersNearYouService(TickServiceBase):
    """Background thread that fills the Players Near You feed.

    Each tick reads the current game off the cached payload, works out the
    "up next" window of achievements around the first unearned one, and walks
    that window asking RA who recently unlocked each. The strangers (and
    incidentally friends) it finds get pooled, sorted newest-first, deduped by
    (ulid, achievement), and capped at twelve. A near-clone of
    SocialActivityTrickleService -- same daemon/generation/backoff skeleton --
    but the per-tick walk is its own shape: one RA slot for the whole window,
    sequential calls inside it, no friend roster involved.
    """

    def __init__(self, *, ra, cache_store, settings_store, players_near_you_store, plugin=None, notifications_store=None):
        super().__init__(
            settings_store=settings_store,
            plugin=plugin,
            thread_name="players-near-you",
            log_label="players near you",
            rate_limit_backoff_seconds=PNY_RATE_LIMIT_BACKOFF_SECONDS,
            retry_after_cap_seconds=PNY_RETRY_AFTER_CAP_SECONDS,
        )
        self._ra = ra
        self._cache_store = cache_store
        self._store = players_near_you_store

        self._notifications = notifications_store

        self._reschedule_event = threading.Event()

        self._tick_clear_epoch = 0

    def stop(self):
        self._stop_event.set()
        self._reschedule_event.set()
        self._log_stop_requested()

    def wake_for_reschedule(self):
        self._reschedule_event.set()

    def note_cache_cleared(self):
        _bump_clear_epoch()

    def _run_loop(self):
        startup_delay = random.uniform(
            PNY_STARTUP_DELAY_MIN_SECONDS,
            PNY_STARTUP_DELAY_MAX_SECONDS,
        )
        my_generation = self._generation
        self._log_loop_entered(my_generation)
        self._log_startup_delay(startup_delay)
        if self._stop_event.wait(startup_delay):
            return

        while not self._stop_event.is_set():
            if not self._generation_fence.is_live(my_generation):
                self._debug_log(
                    "players near you: gen=%d superseded, exiting tid=%d",
                    my_generation,
                    threading.get_ident(),
                )
                return

            try:
                self._run_one_tick()
            except Exception as exc:
                self._log_tick_crashed(exc)

            if self._wait_for_next_tick(self._next_tick_delay_seconds()):
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
        if not self._settings_store.get_players_near_you_enabled(cfg):
            return PNY_DISABLED_RECHECK_SECONDS
        low, high = self._tick_bounds_minutes(cfg)
        minutes = random.uniform(low, high)
        return max(60.0, minutes * 60.0)

    def _tick_bounds_minutes(self, cfg):
        try:
            low = int(self._settings_store.get_players_near_you_min_tick_minutes(cfg))
        except Exception:
            low = PNY_MIN_TICK_FALLBACK_MINUTES
        try:
            high = int(self._settings_store.get_players_near_you_max_tick_minutes(cfg))
        except Exception:
            high = PNY_MAX_TICK_FALLBACK_MINUTES
        if high < low:
            high = low
        return low, high

    def _run_one_tick(self):
        cfg = self._settings_store.load_config()
        self._debug_logging = self._settings_store.get_debug_logging(cfg)

        if not self._settings_store.get_players_near_you_enabled(cfg):
            return

        if self._settings_store.get_battery_saver(cfg) and \
                self._settings_store.get_battery_saver_disables_players_near_you(cfg):
            push_debug_notification(
                store=self._notifications,
                settings_store=self._settings_store,
                event_loop=self._event_loop,
                title="Players Near You",
                body="Tick skipped",
                toast_body="Tick skipped",
            )
            return

        push_debug_notification(
            store=self._notifications,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            title="Players Near You",
            body="Tick running",
            toast_body="Tick running",
        )

        if self._is_in_backoff() and self._backoff_until_ts is not None:
            remaining = max(0, self._backoff_until_ts - int(time.time()))
            self._debug_log(
                "players near you: skipping tick, in backoff for %ss more",
                remaining,
            )
            return

        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            return

        tick_ulid = str(cfg.get("activeUlid") or "").strip()

        self._tick_clear_epoch = _current_clear_epoch()

        cached_payload = (self._cache_store.load_payload() or {}).get("payload") or {}
        game_id = cached_payload.get("gameId")
        if game_id in (None, "", 0):
            self._debug_log("players near you: no current game, skipping tick")
            return

        game_title = str(cached_payload.get("title") or "").strip()
        game_image_icon = str(cached_payload.get("imageIcon") or "").strip()

        cache = self._normalise_cache(self._store.load_for_game(game_id))
        mode = normalise_mode(cache.get("mode"))

        if mode == "off":
            self._debug_log(
                "players near you: playstyle is off for game=%s, skipping tick",
                game_id,
            )
            return

        window = self._compute_window(cached_payload.get("achievements") or [], cfg, mode)
        if not window:
            self._debug_log(
                "players near you: no up-next window (no achievements), skipping tick game=%s",
                game_id,
            )
            return

        self._debug_log(
            "players near you: tick gen=%d game=%s windowSize=%d",
            self._generation,
            game_id,
            len(window),
        )

        with self._maybe_hold_trickle_lock():
            if self._plugin is not None:
                self._plugin.wait_for_ra_quiet(self._stop_event)
                if self._stop_event.is_set():
                    return
            walk = self._run_window_walk(web_api_key, window, game_id, game_title)

        if walk.get("rate_limited"):
            return

        if self._stop_event.is_set() or not self._generation_fence.is_live(self._generation):
            self._debug_log("players near you: stop/restart mid-walk, dropping tick tail")
            return

        per_achievement = walk.get("results") or []

        with self._maybe_hold_trickle_lock():
            if self._active_account_changed(tick_ulid):
                self._debug_log(
                    "players near you: account switched mid-tick, dropping merge/save"
                )
                return

            if _clear_landed_since(self._tick_clear_epoch):
                self._debug_log(
                    "players near you: cache cleared mid-tick, dropping merge/save"
                )
                return

            new_unlocks = self._merge_into_cache(cache, per_achievement, tick_ulid, username.lower())
            cache["items"] = self._rebuild_feed(cache)
            cache["lastRefreshAt"] = self._now_iso()
            latest_unlock = self._pick_notification_unlock(cache, new_unlocks)

            self._store.save_for_game(game_id, cache)

            if latest_unlock is not None:
                self._notify_near_you(latest_unlock, game_image_icon)

        self._debug_log(
            "players near you: tick done windowSize=%d newUnlocks=%d feed=%d",
            len(window),
            len(new_unlocks),
            len(cache.get("items", [])),
        )

        if new_unlocks:
            debug_body = "%d new unlock(s) across %d achievement(s)" % (
                len(new_unlocks),
                len(window),
            )
            debug_toast = "New unlocks (%d)" % len(new_unlocks)
        else:
            debug_body = "No new unlocks (walked %d achievement(s))" % len(window)
            debug_toast = "No new unlocks"
        push_debug_notification(
            store=self._notifications,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            title="Players Near You Service",
            body=debug_body,
            toast_body=debug_toast,
        )

    def _compute_window(self, achievements, cfg, mode=PLAYERS_NEAR_YOU_DEFAULT_MODE):
        """Pick the lookbehind + anchor + lookahead rows around wherever this
        game's Playstyle says the player is.

        Returns the windowed achievement dicts (already trimmed to the game's
        real bounds), or an empty list only when the game has no achievements
        at all. The cached payload sorts locked-before-earned rather than by
        displayOrder, so we re-sort here on (displayOrder, id) to find the true
        up-next position.

        The three modes differ only in where the anchor lands — the lookahead
        walk and the mastered tail are the same in all of them:

        classic   the first unearned row, which is the top of the user's Up
                  Next list. Nothing is skipped.
        enhanced  the first unearned row the player hasn't provably walked
                  past. Degrades to classic whenever nothing reads as passed,
                  which is most of a first playthrough.
        recent    the first unearned row at or after their last unlock.
        off       no window at all. The tick returns before it gets here, but
                  the answer is the same either way: a game sitting out has
                  nothing to canvass, and saying so beats quietly behaving
                  like classic for anyone who calls this directly.
        """
        if not achievements or mode == "off":
            return []

        ordered = sorted(
            achievements,
            key=lambda a: (to_int(a.get("displayOrder"), 0), to_int(a.get("id"), 0)),
        )

        skip = frozenset()
        anchor_index = None

        if mode == "recent":
            recent_index = _last_unlock_index(ordered)
            if recent_index is not None:
                anchor_index = _first_locked_index(ordered, skip, start=recent_index)
            if anchor_index is None:
                mode = "classic"

        if mode != "recent":
            if mode == "enhanced":
                skip = _passed_ids(ordered)
            anchor_index = _first_locked_index(ordered, skip)
            if anchor_index is None and skip:
                self._debug_log(
                    "players near you: every unearned row reads as passed, falling back to classic"
                )
                skip = frozenset()
                anchor_index = _first_locked_index(ordered, skip)

        try:
            lookbehind = int(self._settings_store.get_players_near_you_lookbehind(cfg))
        except Exception:
            lookbehind = 2
        try:
            lookahead = int(self._settings_store.get_players_near_you_lookahead(cfg))
        except Exception:
            lookahead = 6

        if anchor_index is None:
            self._debug_log("players near you: mastered, anchoring on the tail mode=%s", mode)
            return ordered[max(0, len(ordered) - (lookbehind + lookahead + 1)):]

        self._debug_log(
            "players near you: mode=%s anchor=%d/%d skipped=%d",
            mode,
            anchor_index + 1,
            len(ordered),
            len(skip),
        )

        behind = [row for row in ordered[max(0, anchor_index - lookbehind):anchor_index]
                  if to_int(row.get("id"), 0) not in skip]

        ahead = []
        index = anchor_index + 1
        while index < len(ordered) and len(ahead) < lookahead:
            candidate = ordered[index]
            if not _is_earned(candidate) and to_int(candidate.get("id"), 0) not in skip:
                ahead.append(candidate)
            index += 1

        return [*behind, ordered[anchor_index], *ahead]

    def _run_window_walk(self, web_api_key, window, game_id, game_title):
        plugin = self._plugin
        loop = getattr(plugin, "_asyncio_loop", None) if plugin is not None else None
        if plugin is None or loop is None:
            return self._walk_window_blocking(web_api_key, window, game_id, game_title)

        future = asyncio.run_coroutine_threadsafe(
            plugin.run_ra_call_for_trickle(
                self._walk_window_blocking,
                web_api_key,
                window,
                game_id,
                game_title,
            ),
            loop,
        )
        walk_timeout = len(window) * (PNY_REQUEST_TIMEOUT_SECONDS + PNY_BETWEEN_CALL_MAX_SECONDS) + 30
        return future.result(timeout=walk_timeout)

    def _walk_window_blocking(self, web_api_key, window, game_id, game_title):
        """Walk the windowed achievements one at a time on this thread.

        Holds the single RA slot the bridge took for the whole loop, spacing
        the calls by a random 1.2-1.5s so the (up to nine) requests don't land
        back to back. Returns {"results": [...], "rate_limited": bool}. A
        429/503 arms the backoff and stops the walk; a per-call error is logged
        and skipped so one bad achievement doesn't sink the rest.
        """
        results = []
        for index, achievement in enumerate(window):
            if self._stop_event.is_set():
                break
            if not self._generation_fence.is_live(self._generation):
                break

            if index > 0:
                delay = random.uniform(
                    PNY_BETWEEN_CALL_MIN_SECONDS,
                    PNY_BETWEEN_CALL_MAX_SECONDS,
                )
                if self._stop_event.wait(delay):
                    break

            achievement_id = achievement.get("id")
            if achievement_id in (None, "", 0):
                continue

            try:
                raw = self._ra.get_achievement_unlocks(
                    achievement_id,
                    web_api_key,
                    count=PNY_UNLOCKS_PER_ACHIEVEMENT,
                    timeout=PNY_REQUEST_TIMEOUT_SECONDS,
                )
            except urllib.error.HTTPError as exc:
                status = getattr(exc, "code", None)
                if status in (429, 503):
                    cooldown = self._cooldown_for_status(status, exc)
                    decky.logger.warning(
                        "players near you: HTTP %s on achievement %s; backing off for %ss",
                        status,
                        achievement_id,
                        cooldown,
                    )
                    self._enter_backoff(cooldown)
                    return {"results": results, "rate_limited": True}
                decky.logger.warning(
                    "players near you: HTTP error on achievement %s: %s (%s)",
                    achievement_id,
                    status if status is not None else "?",
                    exc,
                )
                continue
            except Exception as exc:
                decky.logger.warning(
                    "players near you: fetch failed on achievement %s: %s (%s)",
                    achievement_id,
                    type(exc).__name__,
                    exc,
                )
                continue

            unlocks = self._parse_unlocks(raw)
            self._debug_log(
                "players near you: achievement=%s returned=%d",
                achievement_id,
                len(unlocks),
            )
            results.append({
                "achievementId": to_int(achievement_id, 0),
                "achievementTitle": str(achievement.get("title") or "").strip(),
                "badgeName": str(achievement.get("badgeName") or "").strip(),
                "gameId": to_int(game_id, 0),
                "gameTitle": game_title,
                "unlocks": unlocks,
            })

        return {"results": results, "rate_limited": False}

    def _cooldown_for_status(self, status, exc):
        retry_after = self._parse_retry_after_seconds(exc)
        if retry_after is not None:
            return retry_after
        if status == 429:
            return PNY_RATE_LIMIT_BACKOFF_SECONDS
        return PNY_SERVICE_UNAVAILABLE_BACKOFF_SECONDS

    def _parse_unlocks(self, raw):
        if not isinstance(raw, dict):
            return []
        rows = raw.get("Unlocks") or raw.get("unlocks") or []
        if not isinstance(rows, list):
            return []

        parsed = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            user = str(row.get("User") or row.get("user") or "").strip()
            date_awarded = str(row.get("DateAwarded") or row.get("dateAwarded") or "").strip()
            if not user or not date_awarded:
                continue
            ulid = str(row.get("ULID") or row.get("ulid") or "").strip()
            hardcore_raw = row.get("HardcoreMode")
            if hardcore_raw is None:
                hardcore_raw = row.get("hardcoreMode")
            parsed.append({
                "user": user,
                "ulid": ulid,
                "dateAwarded": date_awarded,
                "hardcoreMode": bool(hardcore_raw),
            })
        return parsed

    def _merge_into_cache(self, cache, per_achievement, self_ulid, self_name):
        """Fold this tick's unlocks into the cached item list.

        Builds an item per (unlocker, achievement), keyed on the ulid so a
        rename can't split one person into two rows. Existing items keep their
        original discoveredAt -- it's "when we first saw it", and the relative
        time on the row reads off dateAwarded anyway. Returns the items that
        were genuinely new this tick (for the notification pass).

        The signed-in account is dropped here -- RA's recent-unlockers list
        includes you, but you're not a player "near" yourself. Filtering at this
        one spot keeps you out of both the feed (cache["items"]) and the
        notification pass (the returned new_items), since both come off this
        merge. self_ulid/self_name are the active account's identity, matched
        ulid-first with a name fallback for the rare ulid-less row.
        """
        items = cache.get("items")
        if not isinstance(items, list):
            items = []
        by_id = {}
        for item in items:
            if isinstance(item, dict) and item.get("id"):
                by_id[item["id"]] = item

        now_iso = self._now_iso()
        new_items = []
        for entry in per_achievement:
            achievement_id = entry.get("achievementId")
            for unlock in entry.get("unlocks") or []:
                if self._is_self_unlock(unlock, self_ulid, self_name):
                    continue
                ulid = str(unlock.get("ulid") or "").strip()
                identity = ulid if ulid else str(unlock.get("user") or "").strip().lower()
                if not identity:
                    continue
                item_id = "%s:%s" % (identity, achievement_id)
                if item_id in by_id:
                    continue
                item = {
                    "id": item_id,
                    "ulid": ulid,
                    "user": str(unlock.get("user") or "").strip(),
                    "achievementId": achievement_id,
                    "achievementTitle": entry.get("achievementTitle") or "",
                    "badgeName": entry.get("badgeName") or "",
                    "gameId": entry.get("gameId"),
                    "gameTitle": entry.get("gameTitle") or "",
                    "hardcoreMode": bool(unlock.get("hardcoreMode")),
                    "dateAwarded": unlock.get("dateAwarded") or "",
                    "discoveredAt": now_iso,
                }
                by_id[item_id] = item
                new_items.append(item)

        cache["items"] = list(by_id.values())
        return new_items

    def _is_self_unlock(self, unlock, self_ulid, self_name):
        row_ulid = str(unlock.get("ulid") or "").strip()
        if self_ulid and row_ulid:
            return row_ulid.lower() == self_ulid.lower()
        if not self_name:
            return False
        return str(unlock.get("user") or "").strip().lower() == self_name

    def _rebuild_feed(self, cache):
        items = cache.get("items")
        if not isinstance(items, list):
            return []
        items.sort(
            key=lambda item: self._parse_timestamp(item.get("dateAwarded")) or 0,
            reverse=True,
        )
        return items[:PNY_FEED_CAP]

    def _pick_notification_unlock(self, cache, new_unlocks):
        """Advance the watermarks and pick the one unlock worth pinging about.

        Returns the freshest genuinely-new unlock, or None when nothing
        qualifies. Only that one becomes a notification, the same one the
        toast fires on -- a tick that finds several still lands them all in the
        feed, but the notification list gets a single "latest near you" ping
        rather than one row per unlock. That keeps it in step with the social
        unlock notification (one freshest pick per pass) and stops a popular
        achievement from flooding the list in a burst.

        A game with no watermark yet -- a cold start, e.g. one you just
        switched into -- runs the same rules as a warm one: every unlock counts
        as new and goes through the freshness gate like any other tick. That
        keeps a game switch feeling responsive instead of burning a silent
        seed-only tick first. The freshness gate is what keeps a stale backlog
        from firing, not a blanket cold-start mute, so an old feed still stays
        quiet while a freshly switched active game surfaces its fresh unlock
        right away. The watermark still advances past everything seen (whether
        or not it notifies), so nothing re-fires the next tick.

        Watermarks are mutated in place on the passed-in cache dict -- they
        live in the same file as the feed, so the one end-of-tick save persists
        the advance alongside the items. Deliberately no appending or toasting
        here: the caller saves the cache first and notifies off the returned
        pick after, so the watermark is on disk before anyone hears about the
        unlock (the duplicate-after-restart fix).
        """
        watermarks = cache.get("watermarkByAchievement")
        if not isinstance(watermarks, dict):
            watermarks = {}
            cache["watermarkByAchievement"] = watermarks

        by_achievement = {}
        for item in new_unlocks:
            by_achievement.setdefault(item.get("achievementId"), []).append(item)

        candidates = []
        for achievement_id, unlocks in by_achievement.items():
            key = str(achievement_id)
            old_watermark = watermarks.get(key)
            old_ts = self._parse_timestamp(old_watermark) if old_watermark else None

            newest_iso = self._newest_date_awarded(unlocks)
            if newest_iso:
                watermarks[key] = self._max_iso(old_watermark, newest_iso)

            for unlock in unlocks:
                unlock_ts = self._parse_timestamp(unlock.get("dateAwarded"))
                if unlock_ts is None:
                    continue
                if old_ts is not None and unlock_ts <= old_ts:
                    continue
                candidates.append((unlock_ts, unlock))

        if not candidates:
            return None

        cutoff_ts = int(time.time()) - PNY_NOTIFY_FRESHNESS_SECONDS
        fresh = [pair for pair in candidates if pair[0] >= cutoff_ts]
        if not fresh:
            return None
        fresh.sort(key=lambda pair: pair[0], reverse=True)
        _, latest_unlock = fresh[0]
        return latest_unlock

    def _notify_near_you(self, latest_unlock, game_image_icon):
        notify_enabled = is_type_enabled("nearYou", self._settings_store)
        notify_toast = is_type_toast("nearYou", self._settings_store)

        if notify_enabled and self._notifications is not None:
            self._append_near_you_row(latest_unlock, game_image_icon)

        if notify_enabled or notify_toast:
            emit_notification(
                ntype="nearYou",
                title_key="{{name}} is near you:",
                template_vars={"name": str(latest_unlock.get("user") or "").strip()},
                toast_line=str(latest_unlock.get("achievementTitle") or "").strip(),
                settings_store=self._settings_store,
                event_loop=self._event_loop,
            )

    def _append_near_you_row(self, unlock, game_image_icon):
        game_id = unlock.get("gameId")
        user = str(unlock.get("user") or "").strip()
        ach_title = str(unlock.get("achievementTitle") or "").strip()
        self._notifications.append({
            "type": "nearYou",
            "kind": "actionable",
            "title": "Player Near You",
            "body": ach_title,
            "iconSource": "avatar",
            "iconGameId": None,
            "iconImageIcon": None,
            "target": {
                "view": "achievementOverview",
                "gameId": to_int(game_id, 0) or None,
                "achievementId": unlock.get("achievementId"),
            },
            "source": "notifications",
            "meta": {
                "username": user,
                "ulid": str(unlock.get("ulid") or "").strip(),
                "achievementTitle": ach_title,
                "gameTitle": unlock.get("gameTitle"),
                "badgeName": str(unlock.get("badgeName") or "").strip(),
                "gameImageIcon": str(game_image_icon or "").strip(),
            },
        })
        self._debug_log(
            "players near you: notification row added user=%s game=%s achievement=%s",
            user,
            game_id,
            ach_title,
        )

    def _normalise_cache(self, raw):
        cache = raw if isinstance(raw, dict) else {}
        if not isinstance(cache.get("items"), list):
            cache["items"] = []
        if not isinstance(cache.get("watermarkByAchievement"), dict):
            cache["watermarkByAchievement"] = {}
        return cache

    def _newest_date_awarded(self, unlocks):
        newest = None
        for unlock in unlocks:
            candidate = str(unlock.get("dateAwarded") or "").strip()
            if candidate:
                newest = self._max_iso(newest, candidate)
        return newest

    def _max_iso(self, current, candidate):
        if not current:
            return candidate
        if not candidate:
            return current
        current_ts = self._parse_timestamp(current) or 0
        candidate_ts = self._parse_timestamp(candidate) or 0
        return candidate if candidate_ts >= current_ts else current

    def _parse_timestamp(self, value):
        text = str(value or "").strip()
        if not text:
            return None

        candidates = [text]
        if text.endswith("Z"):
            candidates.append(text[:-1] + "+00:00")
        if " " in text and "T" not in text:
            candidates.append(text.replace(" ", "T"))
            candidates.append(text.replace(" ", "T") + "+00:00")

        for candidate in candidates:
            try:
                parsed = datetime.fromisoformat(candidate)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return int(parsed.timestamp())
            except (ValueError, TypeError):
                pass

        return None

    def _now_iso(self):
        return datetime.now(timezone.utc).isoformat()
