import asyncio
import random
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

import decky

from services._tick_common import TickServiceBase
from notifications import (
    emit_notification,
    is_type_enabled,
    is_type_toast,
    push_debug_notification,
)


COMMENTS_DEFAULT_TICK_MINUTES = 5

TICK_WAIT_SLICE_SECONDS = 60

COMMENTS_STARTUP_DELAY_MIN_SECONDS = 8.0
COMMENTS_STARTUP_DELAY_MAX_SECONDS = 12.0

COMMENTS_BETWEEN_SECTION_DELAY_MIN_SECONDS = 1.0
COMMENTS_BETWEEN_SECTION_DELAY_MAX_SECONDS = 4.0

COMMENTS_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60

COMMENTS_FETCH_RESULT_TIMEOUT_SECONDS = 60

COMMENTS_DEFAULT_FETCH_AMOUNT = 20

BASELINE_AGE_GRACE_SECONDS = 5 * 60

def _canonical_ts(submitted):
    text = str(submitted or "").strip().replace("T", " ")
    if not text:
        return ""

    offset_minutes = 0
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1].strip()
    else:
        split_at = max(text.rfind("+"), text.rfind("-", 11))
        if split_at > 0:
            sign = -1 if text[split_at] == "-" else 1
            raw_offset = text[split_at + 1:].strip().replace(":", "")
            if raw_offset.isdigit() and len(raw_offset) in (2, 4):
                offset_hours = int(raw_offset[:2])
                offset_mins = int(raw_offset[2:]) if len(raw_offset) == 4 else 0
                offset_minutes = sign * (offset_hours * 60 + offset_mins)
                text = text[:split_at].strip()

    parts = text.split(" ", 1)
    date_bits = parts[0].split("-")
    time_bits = parts[1].split(":") if len(parts) > 1 else []

    if len(date_bits) != 3 or len(time_bits) != 3:
        return text

    second_text = time_bits[2]
    fraction_text = ""
    if "." in second_text:
        second_text, fraction_text = second_text.split(".", 1)

    try:
        stamp = datetime(
            int(date_bits[0]), int(date_bits[1]), int(date_bits[2]),
            int(time_bits[0]), int(time_bits[1]), int(second_text),
        )
    except (ValueError, OverflowError):
        return text

    if offset_minutes:
        stamp = stamp - timedelta(minutes=offset_minutes)

    fraction_digits = "".join(ch for ch in fraction_text if ch.isdigit())[:6]
    return "%s.%s" % (stamp.strftime("%Y-%m-%d %H:%M:%S"), fraction_digits.ljust(6, "0"))


def _fingerprint(comment):
    user = str(comment.get("user") or "")
    text = str(comment.get("commentText") or "")
    return "%s\x1f%s" % (user, text)


def _seed_from_window(comments):
    window_newest = max(_canonical_ts(comment.get("submitted")) for comment in comments)
    fingerprints = [
        _fingerprint(comment)
        for comment in comments
        if _canonical_ts(comment.get("submitted")) == window_newest
    ]
    return {"ts": window_newest, "fingerprints": fingerprints}


def _is_own_comment(comment, own_user_lower, own_ulid_lower):
    comment_ulid = str(comment.get("ulid") or "").strip().lower()
    if own_ulid_lower and comment_ulid:
        return comment_ulid == own_ulid_lower
    return str(comment.get("user") or "").strip().lower() == own_user_lower


def _has_no_user_comments(result):
    if result.get("total") == 0:
        return True
    return result.get("rowsSeen", 0) > 0


class CommentsService(TickServiceBase):
    """Background thread that polls followed comment threads and the user's wall.

    Lazy producer for the commentTracker and wall notification types. The
    Subscribed Discussions tab reads subscriptions off disk; this service is
    what turns a new comment on one of those threads (or on the user's own
    wall) into a notification. Runs as a daemon thread so plugin shutdown can't
    deadlock on it.

    Reads its like next door: built and started/stopped alongside the activity
    trickle and friends-image service, holds the same shared trickle lock for
    its whole walk, paces with the same politeness peek, and routes every RA
    call through the plugin's slot bridge so the work serializes against user
    IPCs through the shared slot counter.
    """

    def __init__(self, *, game_comments_service, subscriptions_store, comment_baselines_store, settings_store, plugin=None, notifications_store=None):
        super().__init__(
            settings_store=settings_store,
            plugin=plugin,
            thread_name="comments-service",
            log_label="comments service",
            rate_limit_backoff_seconds=COMMENTS_RATE_LIMIT_BACKOFF_SECONDS,
        )
        self._comments = game_comments_service
        self._subscriptions = subscriptions_store
        self._baselines = comment_baselines_store

        self._notifications = notifications_store

        self._battery_saver_paused = False

        self._subscriptions_degraded = False

    def stop(self):
        self._stop_event.set()
        self._log_stop_requested()

    def _run_loop(self):
        startup_delay = random.uniform(
            COMMENTS_STARTUP_DELAY_MIN_SECONDS,
            COMMENTS_STARTUP_DELAY_MAX_SECONDS,
        )
        my_generation = self._generation
        self._log_startup_delay(startup_delay)
        if self._stop_event.wait(startup_delay):
            return

        while not self._stop_event.is_set():
            if not self._generation_fence.is_live(my_generation):
                self._debug_log(
                    "comments service: gen=%d superseded, exiting tid=%d",
                    my_generation,
                    threading.get_ident(),
                )
                return

            try:
                self._run_one_tick()
            except Exception as exc:
                self._log_tick_crashed(exc)

            if self._interruptible_tick_wait():
                return

    def _tick_wait_seconds(self):
        try:
            cfg = self._settings_store.load_config()
            minutes = self._settings_store.get_comments_service_tick_minutes(cfg)
        except Exception:
            minutes = COMMENTS_DEFAULT_TICK_MINUTES
        return max(1, minutes) * 60

    def _interruptible_tick_wait(self):
        elapsed = 0.0
        while True:
            target = self._tick_wait_seconds()
            if elapsed >= target:
                return False
            chunk = min(TICK_WAIT_SLICE_SECONDS, target - elapsed)
            if self._stop_event.wait(chunk):
                return True
            elapsed += chunk

    def _comments_fetch_amount(self, cfg):
        try:
            return int(self._settings_store.get_comments_service_fetch_amount(cfg))
        except Exception:
            return COMMENTS_DEFAULT_FETCH_AMOUNT

    def _fetch_section(self, fn, *args):
        plugin = self._plugin
        loop = getattr(plugin, "_asyncio_loop", None) if plugin is not None else None
        if plugin is None or loop is None:
            try:
                return fn(*args)
            except Exception as exc:
                decky.logger.warning(
                    "comments service: direct fetch failed: %s (%s)",
                    type(exc).__name__,
                    exc,
                )
                return None
        try:
            future = asyncio.run_coroutine_threadsafe(
                plugin.run_ra_call_for_trickle(fn, *args),
                loop,
            )
            return future.result(timeout=COMMENTS_FETCH_RESULT_TIMEOUT_SECONDS)
        except Exception as exc:
            decky.logger.warning(
                "comments service: bridged fetch failed: %s (%s)",
                type(exc).__name__,
                exc,
            )
            return None

    def _run_one_tick(self):
        cfg = self._settings_store.load_config()
        self._debug_logging = self._settings_store.get_debug_logging(cfg)

        self._debug_log(
            "comments service: tick gen=%d tid=%d",
            self._generation,
            threading.get_ident(),
        )

        if self._settings_store.get_battery_saver(cfg) and \
                self._settings_store.get_battery_saver_disables_comments(cfg):
            if not self._battery_saver_paused:
                self._battery_saver_paused = True
                decky.logger.info(
                    "comments service: PAUSED by Battery Saver — no comment or wall "
                    "checks will run until it is turned off"
                )
            self._debug_log("comments service: battery saver on, skipping tick")
            push_debug_notification(
                store=self._notifications,
                settings_store=self._settings_store,
                event_loop=self._event_loop,
                title="Comments",
                body="Tick skipped",
                toast_body="Tick skipped",
            )
            return

        if self._battery_saver_paused:
            self._battery_saver_paused = False
            decky.logger.info(
                "comments service: RESUMED after a Battery Saver pause — this tick "
                "catches up everything posted while it was off"
            )

        push_debug_notification(
            store=self._notifications,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            title="Comments",
            body="Tick running",
            toast_body="Tick running",
        )

        if self._is_in_backoff() and self._backoff_until_ts is not None:
            remaining = max(0, self._backoff_until_ts - int(time.time()))
            self._debug_log(
                "comments service: skipping tick, in backoff for %ss more",
                remaining,
            )
            return

        comments_enabled = is_type_enabled("commentTracker", self._settings_store)
        comments_toast = is_type_toast("commentTracker", self._settings_store)
        wall_enabled = is_type_enabled("wall", self._settings_store)
        wall_toast = is_type_toast("wall", self._settings_store)
        comments_active = comments_enabled or comments_toast
        wall_active = (wall_enabled or wall_toast) and \
                self._settings_store.get_comments_service_wall_check(cfg)
        if not comments_active and not wall_active:
            self._debug_log("comments service: both streams fully off, no-op tick")
            return

        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(cfg.get("username", "")).strip()
        if not web_api_key or not username:
            self._debug_log("comments service: credentials not set, skipping tick")
            return

        fetch_amount = self._comments_fetch_amount(cfg)
        own_user_lower = username.lower()

        tick_ulid = str(cfg.get("activeUlid") or "").strip()

        wall_ref = tick_ulid or own_user_lower

        latest_comments = []
        latest_wall = None

        rate_limited = False
        with self._maybe_hold_trickle_lock():
            if comments_active:
                latest_comments, rate_limited = self._run_subscribed_pass(
                    username, web_api_key, own_user_lower, tick_ulid, fetch_amount, comments_enabled,
                )
            if not rate_limited and wall_active:
                latest_wall, rate_limited = self._run_wall_pass(
                    username, web_api_key, own_user_lower, tick_ulid, wall_ref, fetch_amount, wall_enabled,
                )

        if rate_limited:
            self._debug_log(
                "comments service: rate limited partway through, announcing the %d section(s) "
                "already collected and leaving the rest for the next tick",
                len(latest_comments) + (1 if latest_wall is not None else 0),
            )

        if self._active_account_changed(tick_ulid):
            self._debug_log("comments service: account switched mid-tick, skipping toasts")
            return

        for entry in latest_comments:
            emit_notification(
                ntype="commentTracker",
                title_key="New Post",
                line_key="New post for {{name}}",
                template_vars={"name": entry["threadTitle"]},
                settings_store=self._settings_store,
                event_loop=self._event_loop,
            )
        if latest_wall is not None:
            emit_notification(
                ntype="wall",
                title_key="New Wall Post",
                line_key="{{name}} posted on your wall",
                template_vars={"name": latest_wall["user"]},
                settings_store=self._settings_store,
                event_loop=self._event_loop,
            )
        self._debug_log("comments service: tick done")

    def _run_subscribed_pass(self, username, web_api_key, own_user_lower, own_ulid, fetch_amount, cards_enabled):
        subscription_payload = self._subscriptions.list_all()
        subscriptions = subscription_payload.get("subscriptions", [])
        live_keys = {sub.get("key") for sub in subscriptions if sub.get("key")}
        if subscription_payload.get("degraded"):
            if not self._subscriptions_degraded:
                self._subscriptions_degraded = True
                decky.logger.warning(
                    "comments service: subscriptions file unreadable, skipping the orphan "
                    "prune so live baselines aren't mistaken for orphans"
                )
            self._debug_log("comments service: subscriptions still unreadable, prune skipped")
        elif not self._stores_agree_on_account():
            decky.logger.warning(
                "comments service: subscriptions and baselines are pointed at different "
                "accounts (%s vs %s), skipping the orphan prune — reload the plugin",
                self._subscriptions.base_dir(),
                self._baselines.base_dir(),
            )
        else:
            if self._subscriptions_degraded:
                self._subscriptions_degraded = False
                decky.logger.info("comments service: subscriptions file readable again, pruning resumed")
            self._prune_orphan_baselines(live_keys)
        if not subscriptions:
            self._debug_log("comments service: no followed threads, subscribed pass empty")
            return [], False

        section_toasts = []
        for index, subscription in enumerate(subscriptions):
            if self._stop_event.is_set():
                return section_toasts, False
            if not self._generation_fence.is_live(self._generation):
                return section_toasts, False

            if index > 0:
                delay = random.uniform(
                    COMMENTS_BETWEEN_SECTION_DELAY_MIN_SECONDS,
                    COMMENTS_BETWEEN_SECTION_DELAY_MAX_SECONDS,
                )
                if self._stop_event.wait(delay):
                    return section_toasts, False

            kind = subscription.get("kind")
            target_id = subscription.get("id")
            if kind == "achievement":
                fetch = self._comments.get_achievement_comments
            else:
                fetch = self._comments.get_game_comments

            if self._plugin is not None:
                self._plugin.wait_for_ra_quiet(self._stop_event)
                if self._stop_event.is_set():
                    return section_toasts, False

            result = self._fetch_section(
                fetch, username, web_api_key, target_id, "-submitted", 0, fetch_amount,
            )
            if result is None:
                self._debug_log(
                    "comments service: fetch dispatch failed for %s, skipping",
                    subscription.get("key"),
                )
                continue
            if result.get("rate_limited"):
                self._enter_backoff()
                self._debug_log(
                    "comments service: rate limited on %s, backing off",
                    subscription.get("key"),
                )
                return section_toasts, True
            if result.get("error"):
                self._debug_log(
                    "comments service: section %s errored, isolating: %s",
                    subscription.get("key"),
                    result.get("error"),
                )
                continue

            section_key_value = subscription.get("key") or "%s:%s" % (kind, target_id)

            comments = result.get("comments") or []
            if not comments:
                if _has_no_user_comments(result):
                    if self._baselines.set_if_absent(section_key_value, "", []):
                        self._debug_log(
                            "comments service: %s has no user comments (total=%s, rows seen %s), "
                            "laid a zero baseline so its first comment reads as new",
                            section_key_value,
                            result.get("total"),
                            result.get("rowsSeen"),
                        )
                else:
                    self._debug_log(
                        "comments service: %s returned no comments and no readable rows "
                        "(total=%s), not writing a baseline this tick rather than guessing "
                        "the thread is empty",
                        section_key_value,
                        result.get("total"),
                    )
                continue

            baseline = self._baselines.get(section_key_value)
            was_unseen = baseline is None
            new_comments, raw_new_count, next_baseline = self._detect(
                comments, baseline, own_user_lower, own_ulid, fetch_amount, section_key_value,
            )
            self._log_section_decision(
                section_key_value, comments, baseline, new_comments,
                raw_new_count, next_baseline, fetch_amount,
            )

            self._emit_subscribed_cards(subscription, new_comments, raw_new_count, fetch_amount, cards_enabled)
            if was_unseen:
                self._baselines.set_if_absent(section_key_value, next_baseline["ts"], next_baseline["fingerprints"])
            else:
                self._baselines.set(section_key_value, next_baseline["ts"], next_baseline["fingerprints"])

            section_toast = self._section_latest_comment(new_comments, subscription)
            if section_toast is not None:
                section_toasts.append(section_toast)

        return section_toasts, False

    def _section_latest_comment(self, new_comments, subscription):
        if not new_comments:
            return None
        return {"threadTitle": subscription.get("title") or ""}

    def _emit_subscribed_cards(self, subscription, new_comments, raw_new_count, fetch_amount, cards_enabled):
        if self._notifications is None or not new_comments or not cards_enabled:
            return

        kind = subscription.get("kind")
        is_game = kind != "achievement"
        game_id = subscription.get("gameId")
        thread_title = subscription.get("title") or ""
        comments_url = self._comments_url(subscription)

        icon_source = "game" if is_game else "achievement"
        icon_image = subscription.get("iconUrl") if is_game else None
        achievement_id = None if is_game else subscription.get("id")
        badge_name = subscription.get("badgeName") or ""

        if raw_new_count >= fetch_amount:
            self._notifications.append({
                "type": "commentTracker",
                "kind": "actionable",
                "title": "Multiple Comments - %s" % thread_title,
                "body": "%d new comments" % len(new_comments),
                "iconSource": icon_source,
                "iconGameId": game_id,
                "iconImageIcon": icon_image,
                "target": {"view": "external", "gameId": game_id, "url": comments_url},
                "source": "notifications",
                "meta": {
                    "threadTitle": thread_title,
                    "kind": kind,
                    "achievementId": achievement_id,
                    "badgeName": badge_name,
                    "url": comments_url,
                    "bulk": True,
                    "count": len(new_comments),
                },
            })
            return

        for comment in reversed(new_comments):
            poster = str(comment.get("user") or "").strip()
            body = str(comment.get("commentText") or "")
            self._notifications.append({
                "type": "commentTracker",
                "kind": "actionable",
                "title": "%s posted in %s" % (poster, thread_title),
                "body": body,
                "iconSource": "avatar",
                "iconGameId": None,
                "iconImageIcon": None,
                "target": {"view": "external", "gameId": game_id, "url": comments_url},
                "source": "notifications",
                "meta": {
                    "username": poster,
                    "commentText": body,
                    "submitted": comment.get("submitted"),
                    "ulid": comment.get("ulid"),
                    "threadTitle": thread_title,
                    "kind": kind,
                    "achievementId": achievement_id,
                    "badgeName": badge_name,
                    "url": comments_url,
                    "gameTitle": subscription.get("gameTitle") or "",
                    "iconUrl": subscription.get("iconUrl") or "",
                },
            })

    def _comments_url(self, subscription):
        if subscription.get("kind") == "achievement":
            return "https://retroachievements.org/achievement/%s/comments" % subscription.get("id")
        return "https://retroachievements.org/game/%s/comments" % subscription.get("gameId")

    def _run_wall_pass(self, username, web_api_key, own_user_lower, own_ulid, wall_ref, fetch_amount, cards_enabled):
        if self._plugin is not None:
            self._plugin.wait_for_ra_quiet(self._stop_event)
            if self._stop_event.is_set():
                return None, False

        wall_target = own_ulid or username

        result = self._fetch_section(
            self._comments.get_user_comments,
            username, web_api_key, wall_target, "-submitted", 0, fetch_amount,
        )
        if result is None:
            self._debug_log("comments service: wall fetch dispatch failed, skipping")
            return None, False
        if result.get("rate_limited"):
            self._enter_backoff()
            self._debug_log("comments service: rate limited on wall, backing off")
            return None, True
        if result.get("restricted"):
            self._debug_log("comments service: wall restricted, nothing to do")
            return None, False
        if result.get("error"):
            self._debug_log("comments service: wall errored, skipping: %s", result.get("error"))
            return None, False

        wall_key = "wall:%s" % wall_ref

        comments = result.get("comments") or []
        if not comments:
            if _has_no_user_comments(result):
                if self._baselines.set_if_absent(wall_key, "", []):
                    self._debug_log(
                        "comments service: wall has no user comments (total=%s, rows seen %s), "
                        "laid a zero baseline so its first post reads as new",
                        result.get("total"),
                        result.get("rowsSeen"),
                    )
            else:
                self._debug_log(
                    "comments service: wall returned no comments and no readable rows "
                    "(total=%s), not writing a baseline this tick rather than guessing the "
                    "wall is empty",
                    result.get("total"),
                )
            return None, False

        baseline = self._baselines.get(wall_key)
        new_comments, raw_new_count, next_baseline = self._detect(
            comments, baseline, own_user_lower, own_ulid, fetch_amount, wall_key,
        )
        self._log_section_decision(
            wall_key, comments, baseline, new_comments,
            raw_new_count, next_baseline, fetch_amount,
        )

        self._emit_wall_cards(username, new_comments, raw_new_count, fetch_amount, cards_enabled)
        self._baselines.set(wall_key, next_baseline["ts"], next_baseline["fingerprints"])

        if not new_comments:
            return None, False
        freshest = new_comments[0]
        return {
            "ts": _canonical_ts(freshest.get("submitted")),
            "user": str(freshest.get("user") or "").strip(),
        }, False

    def _emit_wall_cards(self, username, new_comments, raw_new_count, fetch_amount, cards_enabled):
        if self._notifications is None or not new_comments or not cards_enabled:
            return

        wall_url = "https://retroachievements.org/user/%s/comments" % urllib.parse.quote(username, safe="")

        if raw_new_count >= fetch_amount:
            self._notifications.append({
                "type": "wall",
                "kind": "actionable",
                "title": "Multiple Posts",
                "body": "%d new wall posts" % len(new_comments),
                "iconSource": "none",
                "iconGameId": None,
                "iconImageIcon": None,
                "target": {"view": "external", "url": wall_url},
                "source": "notifications",
                "meta": {
                    "url": wall_url,
                    "bulk": True,
                    "count": len(new_comments),
                },
            })
            return

        for comment in reversed(new_comments):
            poster = str(comment.get("user") or "").strip()
            body = str(comment.get("commentText") or "")
            self._notifications.append({
                "type": "wall",
                "kind": "actionable",
                "title": "%s Commented on your wall." % poster,
                "body": body,
                "iconSource": "avatar",
                "iconGameId": None,
                "iconImageIcon": None,
                "target": {"view": "external", "url": wall_url},
                "source": "notifications",
                "meta": {
                    "username": poster,
                    "commentText": body,
                    "submitted": comment.get("submitted"),
                    "ulid": comment.get("ulid"),
                    "url": wall_url,
                    "wallUser": username,
                },
            })

    def _stores_agree_on_account(self):
        try:
            return self._subscriptions.base_dir() == self._baselines.base_dir()
        except Exception as exc:
            self._debug_log("comments service: store-agreement check unavailable (%s)" % exc)
            return True

    def _log_section_decision(self, section_key_value, comments, baseline, new_comments,
                              raw_new_count, next_baseline, fetch_amount):
        if not self._debug_logging:
            return

        base_ts = "<none>" if baseline is None else (str(baseline.get("ts") or "") or "<zero>")
        window_newest = max(_canonical_ts(comment.get("submitted")) for comment in comments)
        window_oldest = min(_canonical_ts(comment.get("submitted")) for comment in comments)
        saturated = raw_new_count >= fetch_amount
        decky.logger.info(
            "comments service: %s baseline=%s window=%d [%s .. %s] new=%d (own-filtered %d) "
            "saturated=%s -> baseline now %s",
            section_key_value,
            base_ts,
            len(comments),
            window_oldest,
            window_newest,
            raw_new_count,
            len(new_comments),
            saturated,
            str(next_baseline.get("ts") or "") or "<zero>",
        )

    def _prune_orphan_baselines(self, live_keys):
        try:
            stored = self._baselines.keys()
        except Exception as exc:
            self._debug_log("comments service: baseline prune skipped (%s)" % exc)
            return
        for key in stored:
            if key.startswith("wall:"):
                continue
            if key in live_keys:
                continue
            self._baselines.remove(key)
            decky.logger.warning(
                "comments service: pruned orphan baseline %s (no longer in the follow list)",
                key,
            )

    def seed_baseline_if_unseen(self, section_key, comments, *, trusted=True, sort=""):
        if not trusted:
            decky.logger.info(
                "comments service: declined to seed %s, window untrustworthy "
                "(%d comments, sort=%s)",
                section_key,
                len(comments or []),
                sort or "unknown",
            )
            return

        if comments:
            seed = _seed_from_window(comments)
        else:
            seed = {"ts": "", "fingerprints": []}
        wrote = self._baselines.set_if_absent(section_key, seed["ts"], seed["fingerprints"])

        self._debug_log(
            "comments service: seeded baseline for %s from a %d-comment window (sort=%s) -> ts=%s%s",
            section_key,
            len(comments or []),
            sort or "newest",
            seed["ts"] or "<zero>",
            "" if wrote else " (skipped, a watermark was already there)",
        )

    def _detect(self, comments, baseline, own_user_lower, own_ulid, fetch_amount, section_key_value=""):
        if baseline is None:
            return [], 0, _seed_from_window(comments)

        window_newest = max(_canonical_ts(comment.get("submitted")) for comment in comments)
        base_ts = str(baseline.get("ts") or "")
        base_fingerprints = set(baseline.get("fingerprints") or [])

        new_comments = []
        for comment in comments:
            ts = _canonical_ts(comment.get("submitted"))
            if ts > base_ts:
                new_comments.append(comment)
            elif ts == base_ts and _fingerprint(comment) not in base_fingerprints:
                new_comments.append(comment)

        raw_new_count = len(new_comments)

        own_ulid_lower = str(own_ulid or "").strip().lower()
        new_comments = [
            comment
            for comment in new_comments
            if not _is_own_comment(comment, own_user_lower, own_ulid_lower)
        ]

        next_baseline = self._advance_baseline(comments, window_newest, base_ts, base_fingerprints)

        if not base_ts and self._window_predates(comments, baseline):
            decky.logger.warning(
                "comments service: %s window predates its own zero baseline "
                "(%d of %d looked new, cap %d), re-baselined quietly to %s",
                section_key_value or "<section>",
                raw_new_count,
                len(comments),
                fetch_amount,
                next_baseline.get("ts") or "<zero>",
            )
            return [], raw_new_count, next_baseline

        return new_comments, raw_new_count, next_baseline

    def _window_predates(self, comments, baseline):
        created_at = int(baseline.get("createdAt") or 0)
        if created_at <= 0:
            return True
        cutoff = datetime.fromtimestamp(created_at, timezone.utc) - timedelta(
            seconds=BASELINE_AGE_GRACE_SECONDS
        )
        laid_at = _canonical_ts(cutoff.strftime("%Y-%m-%dT%H:%M:%S.%fZ"))
        return any(_canonical_ts(comment.get("submitted")) < laid_at for comment in comments)

    def _advance_baseline(self, comments, window_newest, base_ts, base_fingerprints):
        if window_newest > base_ts:
            fingerprints = [
                _fingerprint(comment)
                for comment in comments
                if _canonical_ts(comment.get("submitted")) == window_newest
            ]
            return {"ts": window_newest, "fingerprints": fingerprints}

        if window_newest == base_ts:
            merged = set(base_fingerprints)
            for comment in comments:
                if _canonical_ts(comment.get("submitted")) == base_ts:
                    merged.add(_fingerprint(comment))
            return {"ts": base_ts, "fingerprints": list(merged)}

        return {"ts": base_ts, "fingerprints": list(base_fingerprints)}
