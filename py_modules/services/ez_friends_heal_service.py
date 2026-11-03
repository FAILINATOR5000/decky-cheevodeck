import asyncio
import random
import threading
import time
import urllib.error

import decky
from multiplayer_friends_store import clean_name
from multiplayer_protocol import clean_pic, is_ulid
from services._tick_common import TickServiceBase

STARTUP_DELAY_MIN_SECONDS = 60.0
STARTUP_DELAY_MAX_SECONDS = 120.0
TICK_SECONDS = 240
TICK_JITTER_SECONDS = 60
HEAL_EVERY_SECONDS = 7 * 86400
TRY_GAP_SECONDS = 86400
RATE_LIMIT_BACKOFF_SECONDS = 15 * 60
RETRY_AFTER_CAP_SECONDS = 60 * 60
SERVICE_UNAVAILABLE_BACKOFF_SECONDS = 15 * 60
CALL_TIMEOUT_SECONDS = 60


class EzFriendsHealService(TickServiceBase):
    def __init__(self, *, plugin, settings_store, store, ra, ra_friends, resolved_avatars, game_mode):
        super().__init__(
            settings_store=settings_store,
            plugin=plugin,
            thread_name="ez-friends-heal",
            log_label="ez friends heal",
            rate_limit_backoff_seconds=RATE_LIMIT_BACKOFF_SECONDS,
            retry_after_cap_seconds=RETRY_AFTER_CAP_SECONDS,
        )
        self._store = store
        self._ra = ra
        self._ra_friends = ra_friends
        self._resolved_avatars = resolved_avatars
        self._game_mode = game_mode
        self._wake = threading.Event()
        self._due_now = set()

    def stop(self):
        self._stop_event.set()
        self._wake.set()
        self._log_stop_requested()

    def sync(self):
        self._wake.set()

    def friend_added(self):
        self._wake.set()

    def presence_differs(self, ulid: str):
        with self._lock:
            self._due_now.add(ulid)
        self._wake.set()

    def _run_loop(self):
        my_generation = self._generation
        self._log_loop_entered(my_generation)
        startup_delay = random.uniform(STARTUP_DELAY_MIN_SECONDS, STARTUP_DELAY_MAX_SECONDS)
        self._log_startup_delay(startup_delay)
        if self._stop_event.wait(startup_delay):
            return
        while not self._stop_event.is_set():
            if not self._generation_fence.is_live(my_generation):
                return
            try:
                self._run_one_tick()
            except Exception as exc:
                self._log_tick_crashed(exc)
            self._wake.clear()
            self._wake.wait(TICK_SECONDS + random.uniform(0, TICK_JITTER_SECONDS))

    def _settled_follows(self) -> set:
        payload = self._ra_friends.get_cached_friends().get("payload") or {}
        rows = payload.get("friends") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return set()
        follows = {row.get("ulid") for row in rows if isinstance(row, dict) and is_ulid(row.get("ulid"))}
        return {ulid for ulid in follows if self._resolved_avatars.get(ulid) is not None}

    def _pick(self, data: dict, now: int):
        follows = self._settled_follows()
        with self._lock:
            self._due_now &= {friend["ulid"] for friend in data["friends"]}
            pulled = set(self._due_now)
        due = []
        for friend in data["friends"]:
            ulid = friend["ulid"]
            if ulid in follows:
                self._debug_log("ez friends heal: %s skipped (follow)", friend["name"])
                continue
            if ulid not in pulled and now - friend["healedAt"] < HEAL_EVERY_SECONDS:
                continue
            if now - friend["healTriedAt"] < TRY_GAP_SECONDS:
                self._debug_log("ez friends heal: %s skipped (cooldown)", friend["name"])
                continue
            due.append(friend)
        if not due:
            return None
        due.sort(key=lambda friend: (friend["ulid"] not in pulled, friend["healedAt"]))
        return due[0]

    def _run_one_tick(self):
        cfg = self._settings_store.load_config()
        self._debug_logging = bool(self._settings_store.get_debug_logging(cfg))
        tick_ulid = str(cfg.get("activeUlid") or "").strip()
        name = str(cfg.get("username") or "").strip()
        key = str(cfg.get("webApiKey") or "").strip()
        if not self._game_mode() or not cfg.get("mpFriendsEnabled", True) or not name or not key \
                or not tick_ulid or self._settings_store.get_battery_saver(cfg):
            return
        if self._is_in_backoff():
            self._debug_log("ez friends heal: skipped (backoff)")
            return
        data = self._store.load()
        if data is None or self._store.ulid != tick_ulid:
            return
        now = int(time.time())
        friend = self._pick(data, now)
        if friend is None:
            return
        ulid = friend["ulid"]
        self._debug_log("ez friends heal: %s due", friend["name"])
        plugin = self._plugin
        loop = self._event_loop
        if plugin is None or loop is None or loop.is_closed():
            return
        plugin.wait_for_ra_quiet(self._stop_event)
        if self._stop_event.is_set() or self._active_account_changed(tick_ulid):
            return

        def tried(stored):
            row = next((row for row in stored["friends"] if row["ulid"] == ulid), None)
            if row is None:
                return False
            row["healTriedAt"] = now
            return True
        _data, stamped = self._store.mutate(tried, ulid=tick_ulid)
        if not stamped:
            return
        with self._lock:
            self._due_now.discard(ulid)

        try:
            with self._maybe_hold_trickle_lock():
                future = asyncio.run_coroutine_threadsafe(
                    plugin.run_ra_call_for_trickle(self._ra.get_user_profile, ulid, key), loop)
                profile = future.result(timeout=CALL_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as exc:
            if getattr(exc, "code", None) == 404:
                self._checked(ulid, tick_ulid)
            self._handle_http_error(exc, friend["name"])
            return
        except Exception as exc:
            decky.logger.warning("ez friends heal: lookup failed for %s (%s)", friend["name"], type(exc).__name__)
            return
        self._debug_log("ez friends heal: %s looked up", friend["name"])
        if not isinstance(profile, dict) or str(profile.get("ULID") or "") != ulid:
            self._checked(ulid, tick_ulid)
            return
        healed_name = clean_name(profile.get("User"))
        pic = clean_pic(profile.get("UserPic"))
        if not healed_name or self._active_account_changed(tick_ulid) or ulid in self._settled_follows():
            return

        def keep(stored):
            row = next((row for row in stored["friends"] if row["ulid"] == ulid), None)
            if row is None:
                return False
            row["name"] = healed_name
            if pic:
                row["userPic"] = pic
            row["healedAt"] = int(time.time())
            return True
        self._store.mutate(keep, ulid=tick_ulid)
        self._debug_log("ez friends heal: %s healed as %s", friend["name"], healed_name)

    def _checked(self, ulid: str, tick_ulid: str):
        def keep(stored):
            row = next((row for row in stored["friends"] if row["ulid"] == ulid), None)
            if row is None:
                return False
            row["healedAt"] = int(time.time())
            return True
        if not self._active_account_changed(tick_ulid):
            self._store.mutate(keep, ulid=tick_ulid)

    def _handle_http_error(self, exc, friend_name):
        status = getattr(exc, "code", None)
        if status in (429, 503):
            retry_after = self._parse_retry_after_seconds(exc)
            default = RATE_LIMIT_BACKOFF_SECONDS if status == 429 else SERVICE_UNAVAILABLE_BACKOFF_SECONDS
            cooldown = retry_after if retry_after is not None else default
            decky.logger.warning("ez friends heal: HTTP %s for %s; backing off for %ss", status, friend_name, cooldown)
            self._enter_backoff(cooldown)
            return
        decky.logger.warning("ez friends heal: HTTP error for %s: %s", friend_name, status if status is not None else "?")
