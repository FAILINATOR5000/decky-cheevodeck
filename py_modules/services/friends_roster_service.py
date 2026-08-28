import asyncio
import base64
import hashlib
import random
import threading
import time
import urllib.error

import decky

from services._tick_common import TickServiceBase
from notifications import push_debug_notification
from settings_store import FIS_ROSTER_REFRESH_NEVER
from resolved_avatar_store import VERDICT_TTL_SECONDS
from utils import to_int


FIS_STARTUP_DELAY_MIN_SECONDS = 15.0
FIS_STARTUP_DELAY_MAX_SECONDS = 30.0

FIS_TICK_FREQUENCY_MINUTES_FALLBACK = 5

FIS_ROSTER_REFRESH_INTERVAL_HOURS_FALLBACK = 6

FIS_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60

FIS_SERVICE_UNAVAILABLE_BACKOFF_SECONDS = 30 * 60

FIS_RETRY_AFTER_CAP_SECONDS = 60 * 60

FIS_DISABLED_RECHECK_SECONDS = 60


HEAL_PROFILE_DELAY_MIN_SECONDS = 1.0
HEAL_PROFILE_DELAY_MAX_SECONDS = 1.4

HEAL_MAX_PROFILE_CALLS_PER_PASS = 25

ON_DEMAND_RESOLVE_COOLDOWN_SECONDS = 60

AVATAR_HEALED_EVENT = "cheevodeck_avatar_healed"

RA_MEDIA_BASE_URL = "https://media.retroachievements.org"

DEFAULT_AVATAR_SIZE_BYTES = 7916

SEED_DEFAULT_AVATAR_SHA256S = (
    "be32d8c717fa224c215f28c86c3498f1c1d26e53b0c2fcee5490f19c468572b5",
)

HEAL_PROBE_SENTINEL_NAMES = ("zzznoavatarprobeaa", "qqprobeavatarnobody")


def _cooldown_now():
    return time.clock_gettime(time.CLOCK_BOOTTIME)


def _bytes_to_data_uri(raw, content_type):
    if not raw:
        return None
    ct = str(content_type or "").strip()
    if not ct or ct == "application/octet-stream":
        ct = "image/png"
    encoded = base64.b64encode(raw).decode("ascii")
    return "data:" + ct + ";base64," + encoded


class FriendsRosterService(TickServiceBase):
    """Background thread that keeps the friends roster validated on a slow loop.

    Companion to SocialActivityTrickleService. That one keeps the
    activity feed warm by sampling friends for new unlocks; this one
    periodically re-fetches the follow list so adds and removes the
    user made on the RA website show up without them opening Friends
    and forcing a manual refresh. Runs as a daemon thread so plugin
    shutdown can't deadlock on it.

    Renamed from FriendsImageService -- avatars used to live on the
    friend row and that service warmed them. That's gone: every surface
    now resolves avatars on demand through the case-correct convention
    CDN, so keeping the roster current is the background job here. The
    healer below still leaves the reservoir warmer than it found it, but
    only as a by-product: it downloads a picture to fingerprint it and
    keeps what it already has rather than making the render path fetch
    the identical file again.

    The persisted config id stays friendImageService (and the FIS_*
    constants keep that token) so existing settings files keep working;
    the Options label is "Roster Sync".
    """

    def __init__(self, *, friends_service, cache_store, settings_store, resolved_avatar_store, ra, icon_service, plugin=None, notifications_store=None):
        super().__init__(
            settings_store=settings_store,
            plugin=plugin,
            thread_name="friends-roster-sync",
            log_label="friends roster service",
            rate_limit_backoff_seconds=FIS_RATE_LIMIT_BACKOFF_SECONDS,
            retry_after_cap_seconds=FIS_RETRY_AFTER_CAP_SECONDS,
        )
        self._friends_service = friends_service
        self._cache_store = cache_store
        self._resolved_avatars = resolved_avatar_store
        self._ra = ra
        self._icon_service = icon_service

        self._notifications = notifications_store

        self._wake_event = threading.Event()

        self._on_demand_resolves = {}
        self._on_demand_lock = threading.Lock()

        self._probed_default_hash = None

    def stop(self):
        self._stop_event.set()
        self._log_stop_requested()

    def wake_now(self):
        self._wake_event.set()

    def resolve_avatar_now(self, ulid, name, web_api_key):
        """Resolve one friend's avatar now. True if we ran, False if we declined.

        Lock order is why this lives on the service rather than in the IPC.
        Every tick takes the trickle lock and *then* asks for an RA slot; an
        IPC that took a slot first and reached for the lock afterwards would
        acquire them in the opposite order, and with Parallel RA Calls set to
        1 that isn't a stall, it's a hang: our press holds the only slot
        waiting on the lock while the tick holds the lock waiting for a slot.
        So we take the lock here and let the usual bridge take the slot
        underneath us.

        Going through that bridge also means the shared background pacing
        floor applies, which is a gift rather than a cost: it puts a hard gap
        between two presses without a line of code.

        No account-switch fence. The verdict is keyed by ULID, so it stays
        true for that friend whichever account is signed in, and the one
        reservoir entry a switch could strand gets replaced by the new
        account's own resolve. The window is a single call wide.
        """
        ulid = str(ulid or "").strip()
        name = str(name or "").strip()
        web_api_key = str(web_api_key or "").strip()
        if not name or not web_api_key:
            return False
        if self._is_in_backoff():
            return False
        if not self._claim_on_demand_slot(ulid or name.lower()):
            return False

        try:
            with self._maybe_hold_trickle_lock():
                self._resolve_one_friend_through_slot(ulid, name, web_api_key, True, force=True)
        except urllib.error.HTTPError as exc:
            self._handle_http_error(exc, name)
            return False
        except Exception as exc:
            decky.logger.warning(
                "friends roster service: on-demand resolve failed for %s: %s (%s)",
                name,
                type(exc).__name__,
                exc,
            )
            return False
        return True

    def resolve_self_avatar_now(self, name, web_api_key):
        """The same, for the signed-in user's own row."""
        name = str(name or "").strip()
        web_api_key = str(web_api_key or "").strip()
        if not name or not web_api_key:
            return False
        if self._is_in_backoff():
            return False
        if not self._claim_on_demand_slot("self:" + name.lower()):
            return False

        try:
            with self._maybe_hold_trickle_lock():
                self._resolve_self_through_slot(name, web_api_key, force=True)
        except urllib.error.HTTPError as exc:
            self._handle_http_error(exc, name)
            return False
        except Exception as exc:
            decky.logger.warning(
                "friends roster service: on-demand self resolve failed for %s: %s (%s)",
                name,
                type(exc).__name__,
                exc,
            )
            return False
        return True

    def _claim_on_demand_slot(self, key):
        now = _cooldown_now()
        cutoff = now - ON_DEMAND_RESOLVE_COOLDOWN_SECONDS
        with self._on_demand_lock:
            last = self._on_demand_resolves.get(key)
            if last is not None and last > cutoff:
                self._debug_log(
                    "friends roster service: on-demand resolve for %s is still cooling down",
                    key,
                )
                return False
            self._on_demand_resolves = {
                other: stamp
                for other, stamp in self._on_demand_resolves.items()
                if stamp > cutoff
            }
            self._on_demand_resolves[key] = now
            return True

    def _run_loop(self):
        startup_delay = random.uniform(
            FIS_STARTUP_DELAY_MIN_SECONDS,
            FIS_STARTUP_DELAY_MAX_SECONDS,
        )
        my_generation = self._generation
        self._log_loop_entered(my_generation)
        self._log_startup_delay(startup_delay)
        if self._stop_event.wait(startup_delay):
            return

        while not self._stop_event.is_set():
            if not self._generation_fence.is_live(my_generation):
                self._debug_log(
                    "friends roster service: gen=%d superseded, exiting tid=%d",
                    my_generation,
                    threading.get_ident(),
                )
                return

            self._wake_event.clear()

            try:
                self._run_one_tick()
            except Exception as exc:
                self._log_tick_crashed(exc)

            sleep_seconds = self._next_tick_delay_seconds()
            if self._sleep_until_wake_or_stop(sleep_seconds):
                return

    def _sleep_until_wake_or_stop(self, seconds):
        remaining = max(0.0, float(seconds))
        while remaining > 0.0:
            step = min(1.0, remaining)
            if self._stop_event.wait(step):
                return True
            if self._wake_event.is_set():
                self._debug_log("friends roster service: woken early by wake_now()")
                return False
            remaining -= step
        return False

    def _next_tick_delay_seconds(self):
        cfg = self._settings_store.load_config()
        if not self._settings_store.get_friend_image_service(cfg):
            return FIS_DISABLED_RECHECK_SECONDS
        return max(60, self._tick_frequency_minutes(cfg) * 60)

    def _tick_frequency_minutes(self, cfg):
        try:
            return int(self._settings_store.get_fis_tick_frequency_minutes(cfg))
        except Exception:
            return FIS_TICK_FREQUENCY_MINUTES_FALLBACK

    def _roster_refresh_interval_hours(self, cfg):
        try:
            return int(self._settings_store.get_fis_roster_refresh_interval_hours(cfg))
        except Exception:
            return FIS_ROSTER_REFRESH_INTERVAL_HOURS_FALLBACK

    def _run_one_tick(self):
        cfg = self._settings_store.load_config()
        self._debug_logging = self._settings_store.get_debug_logging(cfg)

        self._debug_log(
            "friends roster service: tick gen=%d tid=%d",
            self._generation,
            threading.get_ident(),
        )

        if not self._settings_store.get_friend_image_service(cfg):
            return

        if self._settings_store.get_battery_saver(cfg) and \
                self._settings_store.get_battery_saver_disables_friend_avatars(cfg):
            push_debug_notification(
                store=self._notifications,
                settings_store=self._settings_store,
                event_loop=self._event_loop,
                title="Friend Avatars",
                body="Tick skipped",
                toast_body="Tick skipped",
            )
            return

        push_debug_notification(
            store=self._notifications,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            title="Friend Avatars",
            body="Tick running",
            toast_body="Tick running",
        )

        if self._is_in_backoff() and self._backoff_until_ts is not None:
            remaining = max(0, self._backoff_until_ts - int(time.time()))
            self._debug_log(
                "friends roster service: skipping tick, in backoff for %ss more",
                remaining,
            )
            return

        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            return

        cached = self._cache_store.load_friends()
        meta = cached.get("meta") if isinstance(cached, dict) else {}
        if not isinstance(meta, dict):
            meta = {}

        roster_refresh_hours = self._roster_refresh_interval_hours(cfg)
        if roster_refresh_hours == FIS_ROSTER_REFRESH_NEVER:
            self._debug_log(
                "friends roster service: roster refresh set to never; skipping refresh and heal",
            )
            return

        self._maybe_refresh_roster(meta, username, web_api_key, roster_refresh_hours)

        verify_favorites = self._settings_store.get_fis_verify_favorite_avatars(cfg)
        verify_all = self._settings_store.get_fis_verify_all_avatars(cfg)

        try:
            self._run_heal_phase(username, web_api_key, verify_favorites, verify_all)
        except Exception as exc:
            decky.logger.warning(
                "friends roster service: heal phase crashed: %s (%s)",
                type(exc).__name__,
                exc,
            )

    def _maybe_refresh_roster(self, meta, username, web_api_key, roster_refresh_hours):
        last_check_ts = to_int(meta.get("rosterCheckedAt"), 0)
        now_ts = int(time.time())
        age_hours = (now_ts - last_check_ts) / 3600.0 if last_check_ts > 0 else None
        roster_due = last_check_ts <= 0 or (age_hours is not None and age_hours >= roster_refresh_hours)
        if not roster_due:
            self._debug_log(
                "friends roster service: roster still fresh (ageHours=%s thresholdHours=%s)",
                "n/a" if age_hours is None else round(age_hours, 1),
                roster_refresh_hours,
            )
            return

        self._debug_log(
            "friends roster service: roster refresh tick (ageHours=%s thresholdHours=%s)",
            "n/a" if age_hours is None else round(age_hours, 1),
            roster_refresh_hours,
        )
        with self._maybe_hold_trickle_lock():
            self._do_roster_refresh(username, web_api_key)

    def _do_roster_refresh(self, username, web_api_key):
        plugin = self._plugin
        loop = getattr(plugin, "_asyncio_loop", None) if plugin is not None else None
        if plugin is None or loop is None:
            try:
                self._friends_service.refresh_friends(username, web_api_key, False)
            except Exception as exc:
                decky.logger.warning(
                    "friends roster service: roster refresh (direct) failed: %s (%s)",
                    type(exc).__name__,
                    exc,
                )
            return

        try:
            future = asyncio.run_coroutine_threadsafe(
                plugin.run_ra_call_for_trickle(
                    self._friends_service.refresh_friends,
                    username,
                    web_api_key,
                    False,
                ),
                loop,
            )
            future.result(timeout=120)
        except urllib.error.HTTPError as exc:
            self._handle_http_error(exc, username)
        except Exception as exc:
            decky.logger.warning(
                "friends roster service: roster refresh failed: %s (%s)",
                type(exc).__name__,
                exc,
            )

    def _run_heal_phase(self, username, web_api_key, verify_favorites, verify_all):
        cached = self._cache_store.load_friends()
        payload = cached.get("payload") if isinstance(cached, dict) else None
        friends = payload.get("friends") if isinstance(payload, dict) else None
        if not isinstance(friends, list):
            friends = []

        live_friends = []
        for row in friends:
            if not isinstance(row, dict):
                continue
            row_ulid = str(row.get("ulid") or "").strip()
            row_name = str(row.get("username") or "").strip()
            if not row_ulid and not row_name:
                continue
            live_friends.append((row_ulid, row_name))

        has_real_friends = len(live_friends) > 0

        own_name = str(username or "").strip()
        if own_name:
            live_friends.append(("", own_name))

        if has_real_friends:
            try:
                dropped_verdicts, dropped_routes = self._resolved_avatars.prune(live_friends)
                if dropped_verdicts or dropped_routes:
                    self._debug_log(
                        "friends roster service: pruned %d verdict(s) and %d route(s) for unfollowed friends",
                        dropped_verdicts,
                        dropped_routes,
                    )
            except Exception as exc:
                decky.logger.warning(
                    "friends roster service: verdict prune failed: %s (%s)",
                    type(exc).__name__,
                    exc,
                )

        favorite_ulids = set()
        if verify_all or verify_favorites:
            try:
                favorite_ulids = set(self._settings_store.get_favorite_friends())
            except Exception as exc:
                self._debug_log(
                    "friends roster service: favorites read failed, treating as none: %s",
                    type(exc).__name__,
                )

        now = int(time.time())
        pending = []
        for row in friends:
            if not isinstance(row, dict):
                continue
            ulid = str(row.get("ulid") or "").strip()
            name = str(row.get("username") or "").strip()
            if not ulid or not name:
                continue
            accurate = verify_all or (verify_favorites and ulid in favorite_ulids)
            verdict = self._resolved_avatars.get(ulid)
            if verdict and (now - verdict["checkedAt"]) < VERDICT_TTL_SECONDS:
                if not accurate or verdict["mode"] == "accurate":
                    continue
            pending.append((ulid, name, accurate))

        accurate_first = [entry for entry in pending if entry[2]]
        fast_only = [entry for entry in pending if not entry[2]]
        pending = accurate_first + fast_only

        self_due = self._self_heal_due(own_name, now)

        if not pending and not self_due:
            return

        self._debug_log(
            "friends roster service: heal pass, %d friend(s) to resolve (self due=%s)",
            len(pending),
            self_due,
        )

        self._refresh_default_avatar_hash()

        if self_due:
            if self._stop_event.is_set() or not self._generation_fence.is_live(self._generation):
                return
            if self._is_in_backoff():
                return
            if self._active_account_changed(username):
                return

            made_profile_call = False
            try:
                with self._maybe_hold_trickle_lock():
                    made_profile_call = self._resolve_self_through_slot(own_name, web_api_key)
            except urllib.error.HTTPError as exc:
                outcome = self._handle_http_error(exc, own_name)
                if outcome == "rate_limited":
                    return
            except Exception as exc:
                decky.logger.warning(
                    "friends roster service: self heal failed for %s: %s (%s)",
                    own_name,
                    type(exc).__name__,
                    exc,
                )

            if made_profile_call:
                time.sleep(random.uniform(HEAL_PROFILE_DELAY_MIN_SECONDS, HEAL_PROFILE_DELAY_MAX_SECONDS))

        profile_calls = 0

        for index, (ulid, name, accurate) in enumerate(pending):
            if self._stop_event.is_set() or not self._generation_fence.is_live(self._generation):
                return
            if self._is_in_backoff():
                return
            if self._active_account_changed(username):
                self._debug_log(
                    "friends roster service: account changed mid-heal, aborting pass",
                )
                return

            made_profile_call = False
            try:
                with self._maybe_hold_trickle_lock():
                    made_profile_call = self._resolve_one_friend_through_slot(ulid, name, web_api_key, accurate)
            except urllib.error.HTTPError as exc:
                outcome = self._handle_http_error(exc, name)
                if outcome == "rate_limited":
                    return
            except Exception as exc:
                decky.logger.warning(
                    "friends roster service: heal failed for %s: %s (%s)",
                    name,
                    type(exc).__name__,
                    exc,
                )

            if not made_profile_call:
                continue

            profile_calls += 1
            if profile_calls >= HEAL_MAX_PROFILE_CALLS_PER_PASS:
                remaining = len(pending) - (index + 1)
                if remaining > 0:
                    self._debug_log(
                        "friends roster service: heal pass spent its %d profile call(s); %d friend(s) carry to the next tick",
                        profile_calls,
                        remaining,
                    )
                return

            time.sleep(random.uniform(HEAL_PROFILE_DELAY_MIN_SECONDS, HEAL_PROFILE_DELAY_MAX_SECONDS))

    def _resolve_one_friend_through_slot(self, ulid, name, web_api_key, accurate, *, force=False):
        plugin = self._plugin
        loop = getattr(plugin, "_asyncio_loop", None) if plugin is not None else None
        if plugin is None or loop is None:
            return self._resolve_one_friend(ulid, name, web_api_key, accurate, force=force)

        future = asyncio.run_coroutine_threadsafe(
            plugin.run_ra_call_for_trickle(
                self._resolve_one_friend, ulid, name, web_api_key, accurate, force=force
            ),
            loop,
        )
        return future.result(timeout=60)

    def _resolve_one_friend(self, ulid, name, web_api_key, accurate, *, force=False):
        """Resolve one friend's avatar; returns True if a profile call was made.

        Runs on a worker thread inside the RA slot. FAIL-SAFE: a verdict
        is written ONLY on a clean resolve. Any error, timeout,
        unexpected shape, missing UserPic, or failed image fetch leaves
        no verdict, so the friend is simply retried on the next pass.
        The avatarless answer in particular is recorded only after a
        clean profile read AND a clean joystick fingerprint of the
        picture that profile points at.

        Two paths. The fast one trusts a real picture found at the friend's
        own convention file and stops there, no profile call. The accurate
        one doesn't: RA's UserPic is the filename at UPLOAD time and doesn't
        move on a rename, so a friend who renamed into a name some earlier
        account had already uploaded a picture under gets that stranger's
        picture served at their convention path. Real bytes, wrong person,
        and only the profile knows. That call is expensive, which is why
        accurate is opt-in per friend rather than always on.

        force is the user pressing Y on a friend row. It always arrives with
        accurate, and it changes three things: the convention bytes come from
        the CDN rather than the reservoir, the write overwrites rather than
        yielding, and the profile is looked up by ULID with an identity check
        before anything is written. See _resolve_avatar_now for why the
        identity check has to exist.
        """
        convention_url = self._icon_service.user_avatar_url(name)
        if not convention_url:
            return False

        mode = "accurate" if accurate else "fast"

        raw, content_type, from_cdn = self._convention_bytes(name, convention_url, force=force)
        convention_is_default = self._is_default_avatar(raw)

        if not convention_is_default and not accurate:
            self._resolved_avatars.set(ulid, "", int(time.time()), username=name, mode=mode)
            self._keep_convention_bytes(name, convention_url, raw, content_type, from_cdn, force=force)
            return False

        profile = self._ra.get_user_profile(ulid if (force and ulid) else name, web_api_key)
        if force and not self._profile_is_this_friend(profile, ulid, name):
            return True
        user_pic = str((profile or {}).get("UserPic") or "").strip()
        if not user_pic:
            return True

        pic_url = self._absolute_media_url(user_pic)
        if not pic_url:
            return True

        pic_raw, pic_content_type = self._pic_bytes(pic_url, convention_url, raw, content_type)
        if convention_is_default and self._is_default_avatar(pic_raw):
            self._resolved_avatars.set(ulid, "", int(time.time()), username=name, mode=mode)
            self._keep_convention_bytes(name, convention_url, raw, content_type, from_cdn, force=force)
            return True

        if self._is_own_convention_path(user_pic, name):
            self._resolved_avatars.set(ulid, "", int(time.time()), username=name, mode=mode)
            self._keep_convention_bytes(name, convention_url, raw, content_type, from_cdn, force=force)
            return True

        data_uri = _bytes_to_data_uri(pic_raw, pic_content_type)
        if not data_uri:
            return True
        self._icon_service.put_profile_avatar(name, data_uri, pic_url)
        self._resolved_avatars.set(ulid, user_pic, int(time.time()), username=name, mode=mode)
        self._debug_log(
            "friends roster service: healed renamed friend %s -> %s",
            name,
            user_pic,
        )
        self._emit_avatar_healed(name)
        return True

    def _profile_is_this_friend(self, profile, ulid, name):
        """Is this profile the friend our roster row says it is?

        Only the forced path asks. Two ways it can be no, and both have to
        stop the resolve before a single byte is written:

        Wrong account. We asked by ULID so this should not happen, but a
        profile whose ULID doesn't match ours is somebody else and writing
        their UserPic as our friend's route would put a stranger's picture
        on the row for a week.

        Right account, different name. The friend renamed on RA and our
        roster row hasn't caught up. Resolving anyway files a route under
        their old name while the verdict goes under their ULID, and those
        two come apart the moment the roster refresh heals the name: prune
        drops the orphaned route, the ULID verdict survives, and the heal
        pass then skips them for the whole TTL with their avatar falling
        back to a convention URL that may be nobody's. Writing nothing
        leaves them pending, which is the fail-safe the rest of this
        resolver already takes. Names are friends_service's job.
        """
        if not isinstance(profile, dict):
            return False

        profile_ulid = str(profile.get("ULID", profile.get("ulid")) or "").strip()
        if profile_ulid and str(ulid or "").strip() and profile_ulid != str(ulid).strip():
            self._debug_log(
                "friends roster service: forced resolve for %s answered for a different account, writing nothing",
                name,
            )
            return False

        profile_name = str(profile.get("User", profile.get("user")) or "").strip()
        if profile_name and profile_name.lower() != str(name or "").strip().lower():
            self._debug_log(
                "friends roster service: forced resolve found %s renamed to %s; leaving the roster refresh to catch up",
                name,
                profile_name,
            )
            return False

        return True

    def _emit_avatar_healed(self, name):
        plugin = self._plugin
        loop = getattr(plugin, "_asyncio_loop", None) if plugin is not None else None
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(
                decky.emit(AVATAR_HEALED_EVENT, {"username": name}),
                loop,
            )
        except Exception as exc:
            self._debug_log(
                "friends roster service: avatar-healed emit failed: %s",
                type(exc).__name__,
            )

    def _self_heal_due(self, name, now):
        name_key = str(name or "").strip().lower()
        if not name_key:
            return False
        try:
            watermark = self._resolved_avatars.get_self()
        except Exception:
            return True
        if str(watermark.get("name") or "") != name_key:
            return True
        checked_at = to_int(watermark.get("checkedAt"), 0)
        return (now - checked_at) >= VERDICT_TTL_SECONDS

    def _active_account_changed(self, pass_username):
        try:
            cfg = self._settings_store.load_config()
            current = str(cfg.get("username") or "").strip().lower()
        except Exception:
            return False
        return current != str(pass_username or "").strip().lower()

    def _resolve_self_through_slot(self, name, web_api_key, *, force=False):
        plugin = self._plugin
        loop = getattr(plugin, "_asyncio_loop", None) if plugin is not None else None
        if plugin is None or loop is None:
            return self._resolve_self(name, web_api_key, force=force)

        future = asyncio.run_coroutine_threadsafe(
            plugin.run_ra_call_for_trickle(self._resolve_self, name, web_api_key, force=force),
            loop,
        )
        return future.result(timeout=60)

    def _resolve_self(self, name, web_api_key, *, force=False):
        """Resolve the signed-in user's own avatar; returns True if a profile
        call was made.

        The self twin of _resolve_one_friend. Same convention-then-profile
        classification and the same fail-safe stance: the watermark is
        written ONLY on a clean resolve, so any error / unexpected shape /
        failed fetch leaves it unwritten and the next pass simply retries.
        The only differences from the friend path are that the answer lands
        in the self watermark (set_self) instead of a ULID verdict, and the
        route it writes on a rename is what makes the main-page profile
        avatar resolve to the real picture for a user who renamed in the
        past.

        Self is always on the accurate path -- there's no toggle. It's one
        profile call a week (the watermark gate above is unchanged), it's the
        first picture the user sees after signing in, and it's the one avatar
        they'd immediately notice was somebody else's.

        force is Y on your own row, and it needs no identity check: this
        account's name comes off the live config every time, so there's no
        stale roster row to be wrong about. It skips the reservoir and
        overwrites, same as the friend path, which is what makes a picture
        you changed on RA a minute ago show up now instead of within 48h.
        """
        convention_url = self._icon_service.user_avatar_url(name)
        if not convention_url:
            return False

        raw, content_type, from_cdn = self._convention_bytes(name, convention_url, force=force)
        convention_is_default = self._is_default_avatar(raw)

        profile = self._ra.get_user_profile(name, web_api_key)
        user_pic = str((profile or {}).get("UserPic") or "").strip()
        if not user_pic:
            return True

        pic_url = self._absolute_media_url(user_pic)
        if not pic_url:
            return True

        pic_raw, pic_content_type = self._pic_bytes(pic_url, convention_url, raw, content_type)
        if convention_is_default and self._is_default_avatar(pic_raw):
            self._resolved_avatars.set_self(name, "", int(time.time()))
            self._keep_convention_bytes(name, convention_url, raw, content_type, from_cdn, force=force)
            return True

        if self._is_own_convention_path(user_pic, name):
            self._resolved_avatars.set_self(name, "", int(time.time()))
            self._keep_convention_bytes(name, convention_url, raw, content_type, from_cdn, force=force)
            return True

        data_uri = _bytes_to_data_uri(pic_raw, pic_content_type)
        if not data_uri:
            return True
        self._icon_service.put_profile_avatar(name, data_uri, pic_url)
        self._resolved_avatars.set_self(name, user_pic, int(time.time()))
        self._debug_log(
            "friends roster service: healed own avatar %s -> %s",
            name,
            user_pic,
        )
        self._emit_avatar_healed(name)
        return True

    def _refresh_default_avatar_hash(self):
        try:
            confirmed = self._confirm_default_avatar_hash()
        except Exception as exc:
            self._debug_log(
                "friends roster service: default-avatar probe error: %s",
                type(exc).__name__,
            )
            return
        if confirmed and confirmed != self._probed_default_hash:
            self._probed_default_hash = confirmed
            self._resolved_avatars.set_probe_hash(confirmed)
            self._debug_log("friends roster service: default-avatar fingerprint confirmed")

    def _confirm_default_avatar_hash(self):
        digests = []
        for sentinel in HEAL_PROBE_SENTINEL_NAMES:
            url = self._icon_service.user_avatar_url(sentinel)
            if not url:
                return None
            probe_raw, _content_type = self._ra.get_image_bytes(url)
            if not probe_raw or len(probe_raw) != DEFAULT_AVATAR_SIZE_BYTES:
                return None
            digests.append(hashlib.sha256(probe_raw).hexdigest())
        if len(digests) != len(HEAL_PROBE_SENTINEL_NAMES):
            return None
        if any(d != digests[0] for d in digests):
            return None
        return digests[0]

    def _default_avatar_hashes(self):
        hashes = set(SEED_DEFAULT_AVATAR_SHA256S)
        persisted = self._resolved_avatars.get_probe_hash()
        if persisted:
            hashes.add(persisted)
        if self._probed_default_hash:
            hashes.add(self._probed_default_hash)
        return hashes

    def _is_default_avatar(self, raw):
        if not raw or len(raw) != DEFAULT_AVATAR_SIZE_BYTES:
            return False
        return hashlib.sha256(raw).hexdigest() in self._default_avatar_hashes()

    def _convention_bytes(self, name, convention_url, *, force=False):
        """Step 1's bytes, from the reservoir when it already has them.

        force=True skips the reservoir and goes to the CDN. That's the
        on-demand button: the reservoir entry is up to 48h old, so
        reusing it would fingerprint the picture the friend had
        yesterday and miss the one they just uploaded. Deleting the
        entry first would do the same job, but it can't be done safely.
        An absent entry is a cache miss, and a miss is the one path that
        follows the routing index, so a visible-row avatar warm landing
        in that window refills it from the stale route and the write
        below then yields to it.

        Returns (raw, content_type, from_cdn). The reservoir is checked
        first because the render path fetches this same file for this same
        user, and a warm entry filed under this exact URL is that file's
        contents by definition. A routed entry (a renamed friend's real
        picture, living somewhere else entirely) is filed under a different
        URL and doesn't match, so it falls through to the fetch, which is
        the only answer that would have been right for them anyway.

        content_type comes back as None on a reservoir hit; nothing needs
        it there, because a hit means the bytes are already cached and
        there's nothing left to write. from_cdn is what the callers gate
        their write-back on.
        """
        if not force:
            cached = self._icon_service.cached_avatar_bytes(name, convention_url)
            if cached:
                return cached, None, False
        raw, content_type = self._ra.get_image_bytes(convention_url)
        return raw, content_type, True

    def _pic_bytes(self, pic_url, convention_url, raw, content_type):
        if pic_url == convention_url:
            return raw, content_type
        return self._ra.get_image_bytes(pic_url)

    def _keep_convention_bytes(self, name, convention_url, raw, content_type, from_cdn, *, force=False):
        if not from_cdn or not raw:
            return
        try:
            data_uri = _bytes_to_data_uri(raw, content_type)
            if data_uri:
                self._icon_service.put_convention_avatar(name, data_uri, convention_url, force=force)
        except Exception as exc:
            self._debug_log(
                "friends roster service: avatar cache write failed for %s: %s",
                name,
                type(exc).__name__,
            )

    def _is_own_convention_path(self, user_pic, name):
        path = str(user_pic or "").strip().lower()
        if not path:
            return False
        expected = "/userpic/" + str(name or "").strip().lower() + ".png"
        return path.endswith(expected)

    def _absolute_media_url(self, user_pic):
        path = str(user_pic or "").strip()
        if not path:
            return None
        if path.startswith("http://") or path.startswith("https://"):
            return path
        if not path.startswith("/"):
            path = "/" + path
        return RA_MEDIA_BASE_URL + path

    def _handle_http_error(self, exc, friend_username):
        status = getattr(exc, "code", None)

        if status == 429:
            retry_after = self._parse_retry_after_seconds(exc)
            cooldown = retry_after if retry_after is not None else FIS_RATE_LIMIT_BACKOFF_SECONDS
            if retry_after is not None:
                decky.logger.warning(
                    "friends roster service: HTTP 429 for %s; honoring Retry-After=%ss",
                    friend_username,
                    retry_after,
                )
            else:
                decky.logger.warning(
                    "friends roster service: HTTP 429 for %s; backing off for %ss",
                    friend_username,
                    cooldown,
                )
            self._enter_backoff(cooldown)
            return "rate_limited"

        if status == 503:
            retry_after = self._parse_retry_after_seconds(exc)
            cooldown = retry_after if retry_after is not None else FIS_SERVICE_UNAVAILABLE_BACKOFF_SECONDS
            decky.logger.warning(
                "friends roster service: HTTP 503 for %s; RA looks unwell, backing off for %ss",
                friend_username,
                cooldown,
            )
            self._enter_backoff(cooldown)
            return "rate_limited"

        decky.logger.warning(
            "friends roster service: HTTP error for %s: %s (%s)",
            friend_username,
            status if status is not None else "?",
            exc,
        )
        return "error"
