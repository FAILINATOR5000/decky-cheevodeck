import time
from datetime import datetime, timezone


from utils import norm_game_id, to_int


MAX_ACTIVITY_EVENTS = 500


class SocialActivityCacheService:
    """Cache-first social activity feed.

    The trickle service (``SocialActivityTrickleService``) is what actually
    keeps the cache warm in the background. This class owns the cache shape,
    the helpers the trickle reuses, and the cache-only read used by the
    Activity page. It does no network work of its own anymore — opening
    the page never triggers a refresh.
    """

    def __init__(self, *, ra, cache_store, settings_store):
        self._ra = ra
        self._cache_store = cache_store
        self._settings_store = settings_store

    def _now(self):
        return int(time.time())

    def _now_iso(self):
        return datetime.fromtimestamp(self._now(), tz=timezone.utc).isoformat().replace("+00:00", "Z")

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

    def _event_sort_timestamp(self, event):
        timestamp = self._parse_timestamp(event.get("timestamp"))
        if timestamp is not None:
            return timestamp
        return self._parse_timestamp(event.get("discoveredAt")) or 0

    def _empty_cache(self):
        return {
            "lastRefreshAt": None,
            "events": [],
            "friendState": {},
            "pendingGameTickerEvent": None,
            "lastShownGameTickerTimestampByGame": {},
            "pendingSocialHubTickerEvent": None,
            "lastShownSocialHubTimestamp": None,
        }

    def _normalise_cache(self, cache):
        if not isinstance(cache, dict):
            cache = {}

        normalised = self._empty_cache()
        normalised.update({
            "lastRefreshAt": cache.get("lastRefreshAt"),
            "events": cache.get("events") if isinstance(cache.get("events"), list) else [],
            "friendState": cache.get("friendState") if isinstance(cache.get("friendState"), dict) else {},
            "pendingGameTickerEvent": cache.get("pendingGameTickerEvent")
                if isinstance(cache.get("pendingGameTickerEvent"), dict) else None,
            "lastShownGameTickerTimestampByGame": cache.get("lastShownGameTickerTimestampByGame")
                if isinstance(cache.get("lastShownGameTickerTimestampByGame"), dict) else {},
            "pendingSocialHubTickerEvent": cache.get("pendingSocialHubTickerEvent")
                if isinstance(cache.get("pendingSocialHubTickerEvent"), dict) else None,
            "lastShownSocialHubTimestamp": cache.get("lastShownSocialHubTimestamp"),
        })
        normalised["events"] = self._purge_events(normalised["events"])
        return normalised

    def _purge_events(self, events):
        kept = []
        seen_ids = set()

        for event in events or []:
            if not isinstance(event, dict):
                continue
            event_id = str(event.get("id") or "").strip()
            if not event_id or event_id in seen_ids:
                continue
            seen_ids.add(event_id)
            kept.append(event)

        kept.sort(key=self._event_sort_timestamp, reverse=True)
        return kept[:MAX_ACTIVITY_EVENTS]

    def _cache_age_seconds(self, cache):
        refreshed_at = self._parse_timestamp(cache.get("lastRefreshAt"))
        if refreshed_at is None:
            return None
        return max(0, self._now() - refreshed_at)

    def _normalise_friends(self):
        cached = self._cache_store.load_friends()
        payload = cached.get("payload") or {}
        rows = []
        seen = set()

        for row in payload.get("friends", []) or []:
            username = str(row.get("username") or "").strip()
            ulid = str(row.get("ulid") or "").strip()
            key = ulid.lower() if ulid else username.lower()
            if not username or key in seen or row.get("isSelf"):
                continue
            seen.add(key)
            rows.append(row)

        return rows

    def _normalise_favorite_keys(self):
        return set(
            str(favorite_ulid or "").strip().lower()
            for favorite_ulid in self._settings_store.get_favorite_friends()
            if str(favorite_ulid or "").strip()
        )

    def _normalise_recent_achievements(self, raw):
        if isinstance(raw, dict):
            raw = raw.get("Results", raw.get("results", []))
        rows = []
        for item in raw or []:
            if not isinstance(item, dict):
                continue
            achievement_id = to_int(item.get("AchievementID", item.get("achievementId")), 0)
            if not achievement_id:
                continue
            game_id = norm_game_id(item.get("GameID", item.get("gameId")))
            hardcore_raw = item.get("HardcoreMode", item.get("hardcoreMode"))
            hardcore = bool(hardcore_raw) if hardcore_raw is not None else False
            rows.append({
                "achievementId": achievement_id,
                "achievementTitle": item.get("Title", item.get("title")) or item.get("AchievementTitle", item.get("achievementTitle")) or f"Achievement {achievement_id}",
                "achievementDescription": item.get("Description", item.get("description")) or "",
                "points": to_int(item.get("Points", item.get("points")), 0),
                "trueRatio": to_int(item.get("TrueRatio", item.get("trueRatio")), 0),
                "hardcore": hardcore,
                "badgeName": item.get("BadgeName", item.get("badgeName")) or item.get("BadgeURL", item.get("badgeUrl")),
                "gameId": game_id,
                "gameTitle": item.get("GameTitle", item.get("gameTitle")) or item.get("Game", item.get("game")),
                "gameImageIcon": item.get("GameIcon", item.get("gameIcon")) or "",
                "timestamp": item.get("Date", item.get("date")) or item.get("DateAwarded", item.get("dateAwarded")),
            })
        rows.sort(key=lambda item: self._parse_timestamp(item.get("timestamp")) or 0, reverse=True)
        return rows

    def _clean_badge_name(self, badge_name):
        text = str(badge_name or "").strip()
        if not text:
            return None
        if "/Badge/" in text:
            text = text.rsplit("/Badge/", 1)[-1]
        if text.lower().endswith(".png"):
            text = text[:-4]
        return text or None

    def _snapshot_event_ids(self, cache):
        ids = set()
        for event in cache.get("events", []) or []:
            event_id = str(event.get("id") or "").strip()
            if event_id:
                ids.add(event_id)
        return ids

    def _build_achievement_event(self, username, achievement, is_favorite, user_ref, ulid):
        achievement_id = achievement.get("achievementId")
        game_id = achievement.get("gameId")
        badge_name = self._clean_badge_name(achievement.get("badgeName"))
        event_ulid = str(ulid or "").strip()
        return {
            "id": f"{user_ref}:achievementUnlocked:{achievement_id}",
            "username": username,
            "ulid": event_ulid,
            "kind": "achievementUnlocked",
            "gameId": game_id,
            "gameTitle": achievement.get("gameTitle"),
            "gameImageIcon": achievement.get("gameImageIcon") or "",
            "achievementId": achievement_id,
            "achievementTitle": achievement.get("achievementTitle"),
            "achievementDescription": achievement.get("achievementDescription") or "",
            "achievementIcon": badge_name,
            "points": achievement.get("points") or 0,
            "trueRatio": achievement.get("trueRatio") or 0,
            "hardcore": bool(achievement.get("hardcore")),
            "timestamp": achievement.get("timestamp"),
            "discoveredAt": self._now_iso(),
            "isFavorite": bool(is_favorite),
        }

    def _advance_game_ticker_watermark(self, cache, pending):
        """Mark the game in `pending` as shown, in two places (Issue 9).

        Per-game watermark: lastShownGameTickerTimestampByGame is keyed by
        gameId, so advancing it only suppresses re-showing the nudge for
        THAT game -- a different game keeps its own memory and a return
        visit to this one stays quiet. Strictly-newer guard so an
        out-of-order or clock-skewed clear can't walk a game's watermark
        backwards.

        Hub coupling (Option A): a current-game unlock only ever advances
        the game watermark, never the hub's. Without this step, the moment
        the user switches away from the game that same unlock becomes an
        "other game" event and the hub pass re-surfaces it as a second
        nudge. Dragging the global hub watermark forward to the shown point
        (never backwards) closes that re-fire. This moves only the hub's
        already-shown marker; it does not touch either activity feed.

        Caller holds the social_activity lock and has already normalised
        `cache`, so the map is guaranteed to be a dict here. Mutates
        `cache` in place; the caller does the save.
        """
        game_id = pending.get("gameId")
        occurred_at = pending.get("occurredAt")
        occurred_ts = self._parse_timestamp(occurred_at)
        if game_id in (None, "", 0) or occurred_ts is None:
            return

        by_game = cache["lastShownGameTickerTimestampByGame"]
        game_key = str(game_id)
        prior_ts = self._parse_timestamp(by_game.get(game_key))
        if prior_ts is None or occurred_ts > prior_ts:
            by_game[game_key] = occurred_at

        hub_ts = self._parse_timestamp(cache.get("lastShownSocialHubTimestamp"))
        if hub_ts is None or occurred_ts > hub_ts:
            cache["lastShownSocialHubTimestamp"] = occurred_at

    def consume_pending_game_ticker_event(self):
        """Return the pending game-ticker event for display and mark it shown.

        "Mark shown" means advancing this game's entry in
        lastShownGameTickerTimestampByGame to the event's occurredAt right
        here, at the moment we hand it to the
        frontend -- not waiting on the frontend's clear call. The clear is
        fire-and-forget and can be dropped under cold-boot IPC contention;
        when it is, the slot stays populated and the same nudge re-shows on
        the next visit (the frontend remounts on every navigation, so it has
        no in-memory record that it already showed the line). Advancing the
        watermark at hand-off is the durable shown-point: the next read sees
        the slot is at-or-behind the watermark and suppresses it, and the
        trickle's arming pass won't re-arm it either, both for free, whether
        or not the clear ever lands. The clear stays as belt-and-suspenders
        cleanup (it nulls the slot).

        Suppresses any pending event already at or behind the watermark
        (already shown). Fails open: if either timestamp won't parse we hand
        the event over rather than risk swallowing a real nudge on a parse
        miss. Holds the social_activity lock for the read-modify-save so a
        trickle tick can't interleave between our read and our watermark
        write; the trickle always re-reads the watermark from disk before its
        own save, so it won't roll our advance back.
        """
        with self._cache_store.social_activity_lock():
            cache = self._normalise_cache(self._cache_store.load_social_activity())
            pending = cache.get("pendingGameTickerEvent")
            if not isinstance(pending, dict):
                return None

            occurred_ts = self._parse_timestamp(pending.get("occurredAt"))
            watermark_ts = self._parse_timestamp(
                cache["lastShownGameTickerTimestampByGame"].get(str(pending.get("gameId")))
            )

            if occurred_ts is not None and watermark_ts is not None and occurred_ts <= watermark_ts:
                return None

            if occurred_ts is not None and (watermark_ts is None or occurred_ts > watermark_ts):
                self._advance_game_ticker_watermark(cache, pending)
                self._cache_store.save_social_activity(cache)

            return pending

    def clear_pending_game_ticker_event(self):
        """Clear the pending nudge and advance the "last shown" watermark.

        The watermark is per-game now (Issue 9): we record the cleared
        event's unlock time under its own gameId. The trickle's arming pass
        reads that per-game and only re-considers events strictly newer for
        the same game, so a user who already saw achievement A in game X
        doesn't see it again on a return visit to X just because it's still
        in the events cache. The advance also drags the global Social Hub
        watermark up to match (see _advance_game_ticker_watermark) so the
        same unlock can't re-fire on the hub line after a game switch.

        Holds the social_activity lock for the whole load-modify-save so
        a trickle tick can't interleave a save in the middle and lose
        either our cleared slot or the trickle's freshly-armed nudge.
        """
        with self._cache_store.social_activity_lock():
            cache = self._normalise_cache(self._cache_store.load_social_activity())
            pending = cache.get("pendingGameTickerEvent")
            if pending is None:
                return

            self._advance_game_ticker_watermark(cache, pending)

            cache["pendingGameTickerEvent"] = None
            self._cache_store.save_social_activity(cache)

    def consume_pending_social_hub_ticker_event(self):
        """Return the pending Social Hub ticker event for display, mark it shown.

        Sibling of consume_pending_game_ticker_event -- see that method for
        why we advance the watermark at hand-off instead of leaning on the
        frontend's fire-and-forget clear. The Social Hub watermark is
        independent from the game ticker's; they don't talk to each other.
        """
        with self._cache_store.social_activity_lock():
            cache = self._normalise_cache(self._cache_store.load_social_activity())
            pending = cache.get("pendingSocialHubTickerEvent")
            if not isinstance(pending, dict):
                return None

            occurred_ts = self._parse_timestamp(pending.get("occurredAt"))
            watermark_ts = self._parse_timestamp(cache.get("lastShownSocialHubTimestamp"))

            if occurred_ts is not None and watermark_ts is not None and occurred_ts <= watermark_ts:
                return None

            if occurred_ts is not None and (watermark_ts is None or occurred_ts > watermark_ts):
                cache["lastShownSocialHubTimestamp"] = pending.get("occurredAt")
                self._cache_store.save_social_activity(cache)

            return pending

    def clear_pending_social_hub_ticker_event(self):
        """Clear the pending Social Hub nudge and advance its watermark.

        Same shape as clear_pending_game_ticker_event — see that method
        for the reasoning behind the "strictly newer" watermark guard.
        The Social Hub watermark is independent from the game ticker
        watermark; they don't talk to each other.
        """
        with self._cache_store.social_activity_lock():
            cache = self._normalise_cache(self._cache_store.load_social_activity())
            pending = cache.get("pendingSocialHubTickerEvent")
            if pending is None:
                return

            cleared_ts = self._parse_timestamp(pending.get("occurredAt"))
            watermark_ts = self._parse_timestamp(cache.get("lastShownSocialHubTimestamp"))
            if cleared_ts is not None and (watermark_ts is None or cleared_ts > watermark_ts):
                cache["lastShownSocialHubTimestamp"] = pending.get("occurredAt")

            cache["pendingSocialHubTickerEvent"] = None
            self._cache_store.save_social_activity(cache)

    def get_social_activity(self, web_api_key: str, cfg: dict) -> dict:
        """Return the current cache snapshot. Never hits the network.

        The Activity page reads from the cache; the backend trickle service
        is responsible for keeping it warm.
        """
        del web_api_key

        cache = self._normalise_cache(self._cache_store.load_social_activity())
        cache["events"] = self._purge_events(cache.get("events", []))

        threshold_minutes = self._settings_store.get_activity_cache_minutes(cfg)
        cache_age = self._cache_age_seconds(cache)

        return {
            "ok": True,
            "events": cache.get("events", []),
            "refreshed": False,
            "refreshSkipped": True,
            "skipReason": "cacheReadOnly",
            "refreshedFriends": 0,
            "checkedFriends": 0,
            "newEvents": 0,
            "cacheAgeSeconds": cache_age,
            "cacheThresholdMinutes": threshold_minutes,
            "candidateNames": [],
        }
