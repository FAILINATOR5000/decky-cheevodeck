import time

import decky

from utils import frontend_error, to_int


class AotwService:
    """Fetches and caches the Achievement of the Week payload.

    The AOTW payload itself (achievement metadata, game, full unlocks
    list) gets a 30-minute TTL on disk. AOTW data moves slowly -- the
    achievement itself is the same all week and the top of the Unlocks
    list stabilises within hours -- so we can be patient about how
    often we ask.

    Comments are NOT fetched or cached here anymore. The Comments tab
    reads them live through the shared getAchievementComments IPC (the
    same one Achievement Overview uses), so a just-posted comment shows
    up on the next visit instead of waiting up to 30 minutes for this
    payload's TTL to roll over.

    What also does NOT get cached is the "did the signed-in user unlock
    this?" answer. We recompute that fresh on every call so a user
    who just earned the AOTW achievement sees the UI acknowledge it
    immediately, not half an hour later when the TTL happens to roll
    over. The fast path checks the cached Unlocks list; the fallback
    is one game-info call which authoritatively answers regardless
    of when the unlock happened.
    """

    _CACHE_TTL_SECONDS = 30 * 60
    _UNLOCKS_DISPLAY_LIMIT = 20

    def __init__(self, *, ra, cache_store, icon_service, debug_logging_provider=None):
        self._ra = ra
        self._cache_store = cache_store
        self._icon_service = icon_service
        self._debug_logging_provider = debug_logging_provider

    def _time_ra(self, label: str, fn, *args, **kwargs):
        debug_on = False
        if self._debug_logging_provider is not None:
            debug_on = bool(self._debug_logging_provider())
        if not debug_on:
            return fn(*args, **kwargs)
        start = time.monotonic()
        try:
            return fn(*args, **kwargs)
        finally:
            elapsed_ms = (time.monotonic() - start) * 1000.0
            decky.logger.info("aotw upstream: %s took %.0fms", label, elapsed_ms)

    def _normalize_unlock(self, raw):
        if not isinstance(raw, dict):
            return None
        return {
            "user": raw.get("User"),
            "ulid": raw.get("ULID"),
            "raPoints": to_int(raw.get("RAPoints"), 0),
            "raSoftcorePoints": to_int(raw.get("RASoftcorePoints"), 0),
            "hardcoreMode": bool(to_int(raw.get("HardcoreMode"), 0)),
            "dateAwarded": raw.get("DateAwarded"),
        }

    def _extract_game_image_icon(self, game_raw):
        candidates = ("ImageIcon", "imageIcon", "GameIcon", "Icon", "ImageIconURL")
        if isinstance(game_raw, dict):
            for key in candidates:
                value = game_raw.get(key)
                if value:
                    return value
            try:
                decky.logger.info(
                    "aotw_service: no image icon key in Game block, saw keys=%s",
                    sorted(game_raw.keys()),
                )
            except Exception:
                pass
        return None

    def _normalize_aotw_payload(self, raw) -> dict:
        achievement = raw.get("Achievement") or {}
        console = raw.get("Console") or {}
        game = raw.get("Game") or {}
        forum_topic = raw.get("ForumTopic") or {}

        unlocks_raw = raw.get("Unlocks") or []
        unlocks = []
        for entry in unlocks_raw[: self._UNLOCKS_DISPLAY_LIMIT]:
            normalised = self._normalize_unlock(entry)
            if normalised is not None:
                unlocks.append(normalised)

        return {
            "achievement": {
                "id": to_int(achievement.get("ID"), 0) or None,
                "title": achievement.get("Title"),
                "description": achievement.get("Description"),
                "points": to_int(achievement.get("Points"), 0),
                "trueRatio": to_int(achievement.get("TrueRatio"), 0),
                "type": achievement.get("Type"),
                "author": achievement.get("Author"),
                "badgeName": achievement.get("BadgeName"),
                "badgeUrl": achievement.get("BadgeURL"),
                "dateCreated": achievement.get("DateCreated"),
                "dateModified": achievement.get("DateModified"),
            },
            "console": {
                "id": to_int(console.get("ID"), 0) or None,
                "title": console.get("Title"),
            },
            "game": {
                "id": to_int(game.get("ID"), 0) or None,
                "title": game.get("Title"),
                "imageIcon": self._icon_service.game_icon_url(self._extract_game_image_icon(game)),
            },
            "forumTopicId": to_int(forum_topic.get("ID"), 0) or None,
            "startAt": raw.get("StartAt"),
            "totalPlayers": to_int(raw.get("TotalPlayers"), 0),
            "unlocksCount": to_int(raw.get("UnlocksCount"), 0),
            "unlocksHardcoreCount": to_int(raw.get("UnlocksHardcoreCount"), 0),
            "unlocks": unlocks,
        }

    def _attach_game_image_icon(self, payload: dict, user_ref: str, web_api_key: str) -> None:
        if not isinstance(payload, dict):
            return
        game = payload.get("game") or {}
        if game.get("imageIcon"):
            return
        game_id = game.get("id")
        if not game_id or not user_ref or not web_api_key:
            return
        try:
            info = self._time_ra(
                "get_game_info_and_user_progress",
                self._ra.get_game_info_and_user_progress,
                user_ref,
                game_id,
                web_api_key,
            )
        except Exception as e:
            decky.logger.warning("aotw_service: game-info fallback failed: %s", e)
            return
        if not isinstance(info, dict):
            return
        raw_icon = self._extract_game_image_icon(info)
        if raw_icon:
            game["imageIcon"] = self._icon_service.game_icon_url(raw_icon)

    def _user_in_unlocks_list(self, display_name: str, payload: dict) -> bool:
        if not display_name or not isinstance(payload, dict):
            return False
        target = display_name.strip().lower()
        if not target:
            return False
        for entry in payload.get("unlocks", []) or []:
            user = (entry.get("user") or "").strip().lower()
            if user == target:
                return True
        return False

    def _user_has_ever_unlocked(self, user_ref: str, web_api_key: str, game_id, aotw_achievement_id) -> bool:
        target_id = to_int(aotw_achievement_id, 0)
        target_game = to_int(game_id, 0)
        if not target_id or not target_game:
            return False
        try:
            game_info = self._time_ra(
                "get_game_info_and_user_progress",
                self._ra.get_game_info_and_user_progress,
                user_ref,
                target_game,
                web_api_key,
            )
        except Exception as e:
            decky.logger.warning("aotw_service: unlock fallback failed: %s", e)
            return False

        if not isinstance(game_info, dict):
            return False
        achievements = game_info.get("Achievements")
        if not isinstance(achievements, dict):
            return False
        entry = achievements.get(str(target_id)) or achievements.get(target_id)
        if not isinstance(entry, dict):
            return False
        if str(entry.get("DateEarned") or "").strip():
            return True
        if str(entry.get("DateEarnedHardcore") or "").strip():
            return True
        return False

    def _cache_is_fresh(self, cached_meta) -> bool:
        refreshed_at = cached_meta.get("refreshedAt") if isinstance(cached_meta, dict) else None
        try:
            refreshed_at = int(refreshed_at) if refreshed_at is not None else 0
        except (ValueError, TypeError, OverflowError):
            refreshed_at = 0
        if refreshed_at <= 0:
            return False
        return (int(time.time()) - refreshed_at) < self._CACHE_TTL_SECONDS

    def _cache_has_phase75_fields(self, cached_payload) -> bool:
        if not isinstance(cached_payload, dict):
            return False
        game = cached_payload.get("game") or {}
        return "imageIcon" in game

    def _unpack_cached(self, cached_wrapper):
        raw = cached_wrapper.get("payload") if isinstance(cached_wrapper, dict) else None
        if not isinstance(raw, dict):
            return None
        if "aotw" in raw or "comments" in raw:
            return raw.get("aotw") if isinstance(raw.get("aotw"), dict) else None
        return raw

    def get_achievement_of_the_week(self, user_ref: str, web_api_key: str, display_name: str) -> dict:
        """Return the current AOTW payload, hitting cache when fresh.

        The AOTW page header and unlocks list load from this one IPC.
        Comments are no longer part of this payload -- the Comments tab
        fetches them live through getAchievementComments so a freshly
        posted comment isn't hidden behind this payload's 30-minute TTL.
        The avatars on the unlocks list and the achievement badge itself
        are NOT resolved here; they come in lazily on the frontend via
        <UserAvatar> and the existing getAchievementIcons IPC after
        mount. Pre-resolving them inside this slot used to block the
        page paint for 10-20s on a cold cache because each per-username
        CDN fetch sits behind Cloudflare's ~500ms cold latency. Letting
        them lazy-load lets the page paint in ~1s and the images fill in
        over the next second or two -- and the disk cache makes the next
        visit instant either way.

        currentUserHasUnlocked: fast path checks the user's display
        name against the cached Unlocks list. If they're not there, we
        fall back to a single get_game_info_and_user_progress call
        (queried by user_ref, so it survives a rename) which
        authoritatively answers "has this user unlocked the AOTW
        achievement, ever?" regardless of how long ago. Runs on warm
        cache hits too -- the whole reason this isn't cached is that it
        has to reflect the user's state right now.

        Returns
        ``{"payload": {...}, "comments": [],
           "currentUserHasUnlocked": bool, "fromCache": bool}``
        on success, or a dict with an "error" key (and stale payload if
        we have one) on network failure. The "comments" field is kept in
        the shape for response compatibility but is always empty now.
        """
        service_start = time.monotonic()
        cached_wrapper = self._cache_store.load_aotw()
        cached_meta = cached_wrapper.get("meta", {}) if isinstance(cached_wrapper, dict) else {}
        cached_payload = self._unpack_cached(cached_wrapper)

        payload = None
        from_cache = False
        error = None

        if cached_payload is not None and self._cache_is_fresh(cached_meta) and self._cache_has_phase75_fields(cached_payload):
            payload = cached_payload
            from_cache = True
        else:
            try:
                raw = self._time_ra(
                    "get_achievement_of_the_week",
                    self._ra.get_achievement_of_the_week,
                    web_api_key,
                )
                payload = self._normalize_aotw_payload(raw)
                self._attach_game_image_icon(payload, user_ref, web_api_key)
                with self._cache_store.aotw_lock():
                    self._cache_store.save_aotw(
                        {"aotw": payload},
                        {"refreshedAt": int(time.time())},
                    )
            except Exception as e:
                decky.logger.warning("aotw_service: fetch failed: %s", e)
                payload = cached_payload
                from_cache = True
                error = frontend_error("Couldn't load the Achievement of the Week.", e)

        current_user_has_unlocked = False
        if payload and user_ref:
            if self._user_in_unlocks_list(display_name, payload):
                current_user_has_unlocked = True
            else:
                achievement = payload.get("achievement") or {}
                game = payload.get("game") or {}
                current_user_has_unlocked = self._user_has_ever_unlocked(
                    user_ref,
                    web_api_key,
                    game.get("id"),
                    achievement.get("id"),
                )

        result = {
            "payload": payload,
            "comments": [],
            "currentUserHasUnlocked": current_user_has_unlocked,
            "fromCache": from_cache,
        }
        if error is not None:
            result["error"] = error

        if self._debug_logging_provider is not None:
            debug_on = bool(self._debug_logging_provider())
            if debug_on:
                total_ms = (time.monotonic() - service_start) * 1000.0
                decky.logger.info(
                    "aotw total: service took %.0fms (from_cache=%s)",
                    total_ms,
                    from_cache,
                )

        return result
