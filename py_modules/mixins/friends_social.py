import asyncio

import decky

from utils import frontend_error, norm_game_id, to_int

from mixins._context import PluginContext


class FriendsSocialMixin(PluginContext):

    async def save_friend_refresh_delay_ms(self, friend_refresh_delay_ms: int):
        value = self.settings_store.update_friend_refresh_delay_ms(friend_refresh_delay_ms)

        return {
            "ok": True,
            "friendRefreshDelayMs": value,
        }

    async def save_activity_cache_minutes(self, activity_cache_minutes: int):
        value = self.settings_store.update_activity_cache_minutes(activity_cache_minutes)
        self.social_activity_trickle_service.wake_for_reschedule()

        return {
            "ok": True,
            "activityCacheMinutes": value,
        }

    async def save_trickle_lookback_hours(self, trickle_lookback_hours: int):
        value = self.settings_store.update_trickle_lookback_hours(trickle_lookback_hours)

        return {
            "ok": True,
            "trickleLookbackHours": value,
        }

    async def save_activity_friends_per_tick(self, activity_friends_per_tick: int):
        value = self.settings_store.update_activity_friends_per_tick(activity_friends_per_tick)

        return {
            "ok": True,
            "activityFriendsPerTick": value,
        }

    async def save_social_game_ticker(self, social_game_ticker: bool):
        value = self.settings_store.update_social_game_ticker(social_game_ticker)

        return {
            "ok": True,
            "socialGameTicker": value,
        }

    async def save_social_hub_ticker(self, social_hub_ticker: bool):
        value = self.settings_store.update_social_hub_ticker(social_hub_ticker)

        return {
            "ok": True,
            "socialHubTicker": value,
        }

    async def save_social_activity_trickle_service(self, social_activity_trickle_service: bool):
        value = self.settings_store.update_social_activity_trickle_service(social_activity_trickle_service)

        return {
            "ok": True,
            "socialActivityTrickleService": value,
        }

    async def save_trickle_favorites_only(self, trickle_favorites_only: bool):
        value = self.settings_store.update_trickle_favorites_only(trickle_favorites_only)

        return {
            "ok": True,
            "trickleFavoritesOnly": value,
        }

    async def save_friend_auto_refresh(self, friend_auto_refresh: bool):
        value = self.settings_store.update_friend_auto_refresh(friend_auto_refresh)

        return {
            "ok": True,
            "friendAutoRefresh": value,
        }

    async def save_friend_image_service(self, friend_image_service: bool):
        value = self.settings_store.update_friend_image_service(friend_image_service)

        return {
            "ok": True,
            "friendImageService": value,
        }

    async def save_validate_friends_roster(self, validate_friends_roster: bool):
        value = self.settings_store.update_validate_friends_roster(validate_friends_roster)

        self._validate_friends_roster = bool(value)

        return {
            "ok": True,
            "validateFriendsRoster": value,
        }

    async def save_fis_tick_frequency_minutes(self, fis_tick_frequency_minutes: int):
        value = self.settings_store.update_fis_tick_frequency_minutes(fis_tick_frequency_minutes)

        return {
            "ok": True,
            "fisTickFrequencyMinutes": value,
        }

    async def save_fis_roster_refresh_interval_hours(self, fis_roster_refresh_interval_hours: int):
        value = self.settings_store.update_fis_roster_refresh_interval_hours(fis_roster_refresh_interval_hours)

        return {
            "ok": True,
            "fisRosterRefreshIntervalHours": value,
        }

    async def save_fis_verify_favorite_avatars(self, fis_verify_favorite_avatars: bool):
        value = self.settings_store.update_fis_verify_favorite_avatars(fis_verify_favorite_avatars)

        return {
            "ok": True,
            "fisVerifyFavoriteAvatars": value,
        }

    async def save_fis_verify_all_avatars(self, fis_verify_all_avatars: bool):
        value = self.settings_store.update_fis_verify_all_avatars(fis_verify_all_avatars)

        return {
            "ok": True,
            "fisVerifyAllAvatars": value,
        }

    async def save_show_all_toggle_friend(self, show_all_toggle_friend: bool):
        value = self.settings_store.update_show_all_toggle_friend(show_all_toggle_friend)

        return {
            "ok": True,
            "showAllToggleFriend": value,
        }

    async def save_friend_achievement_filter(self, friend_achievement_filter: str):
        value = self.settings_store.update_friend_achievement_filter(friend_achievement_filter)

        return {
            "ok": True,
            "friendAchievementFilter": value,
        }

    async def save_friend_achievement_sort(self, friend_achievement_sort: str):
        value = self.settings_store.update_friend_achievement_sort(friend_achievement_sort)

        return {
            "ok": True,
            "friendAchievementSort": value,
        }

    async def save_friend_show_all_achievements(self, friend_show_all_achievements: bool):
        value = self.settings_store.update_friend_show_all_achievements(friend_show_all_achievements)

        return {
            "ok": True,
            "friendShowAllAchievements": value,
        }

    async def set_friend_favorite(self, ulid: str, favorite: bool):
        favorite_friends = self.settings_store.set_friend_favorite(ulid, favorite)

        return {
            "ok": True,
            "favoriteFriends": favorite_friends,
        }

    async def get_social_activity(self):
        cfg = self.settings_store.load_config()
        username = str(cfg.get("username", "")).strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        if not username or not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "events": [],
                "refreshed": False,
                "refreshedFriends": 0,
                "cacheAgeSeconds": None,
            }

        try:
            return self.social_activity_cache_service.get_social_activity(web_api_key, cfg)
        except Exception as e:
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't load social activity right now.", e),
                "events": [],
                "refreshed": False,
                "refreshedFriends": 0,
                "cacheAgeSeconds": None,
            }

    async def get_game_ticker_event(self):
        """Return the pending current-game ticker event, or None.

        Used by the main achievements page to surface a one-line "X just
        unlocked Y" nudge under the achievement summary. consume_* both
        returns the event and advances the shown-watermark in one locked
        step, so the same nudge isn't surfaced again even if the frontend's
        follow-up clear is dropped. The frontend still calls
        clear_game_ticker_event after rendering, as slot cleanup.
        """
        try:
            event = self.social_activity_cache_service.consume_pending_game_ticker_event()
            return {"ok": True, "event": event}
        except Exception as e:
            return {
                "ok": False,
                "error": frontend_error("Couldn't read game ticker.", e),
                "event": None,
            }

    async def clear_game_ticker_event(self):
        try:
            self.social_activity_cache_service.clear_pending_game_ticker_event()
            return {"ok": True}
        except Exception as e:
            return {
                "ok": False,
                "error": frontend_error("Couldn't clear game ticker.", e),
            }

    async def get_social_hub_ticker_event(self):
        """Return the pending Social Hub ticker event, or None.

        Sibling of get_game_ticker_event — used by the line below the
        Social Hub button on the main page. consume_* marks it shown on
        read; the frontend's clear_social_hub_ticker_event after rendering
        is slot cleanup.
        """
        try:
            event = self.social_activity_cache_service.consume_pending_social_hub_ticker_event()
            return {"ok": True, "event": event}
        except Exception as e:
            return {
                "ok": False,
                "error": frontend_error("Couldn't read social hub ticker.", e),
                "event": None,
            }

    async def clear_social_hub_ticker_event(self):
        try:
            self.social_activity_cache_service.clear_pending_social_hub_ticker_event()
            return {"ok": True}
        except Exception as e:
            return {
                "ok": False,
                "error": frontend_error("Couldn't clear social hub ticker.", e),
            }

    async def get_now_playing_activity(self, game_id=None):
        """Per-game activity feed for the Now Playing tab's Activity sub-tab.

        Returns the merged list of:
          * events captured continuously into the per-game cache (starred
            friends, plus anyone caught by an earlier on-demand snapshot)
          * fresh events from the global feed for this game (catches
            non-starred friends whose events haven't been snapshotted yet)

        The act of calling this endpoint also snapshots the current global
        feed for ``game_id`` into the per-game cache, so the next call
        sees those events even if they've since aged out of the global
        feed.
        """
        normalised_game_id = norm_game_id(game_id)
        if normalised_game_id is None:
            return {"ok": True, "events": []}

        try:
            cache = self.cache_store.load_social_activity()
            global_events = cache.get("events") if isinstance(cache, dict) else []
            if not isinstance(global_events, list):
                global_events = []

            self.game_activity_history_service.snapshot_for_game(normalised_game_id, global_events)

            events = self.game_activity_history_service.get_events_for_game(normalised_game_id)
            return {"ok": True, "events": events}
        except Exception as e:
            return {
                "ok": False,
                "error": frontend_error("Couldn't load activity history for this game.", e),
                "events": [],
            }

    async def get_cached_friends(self):
        async with self._ra_slot():
            return await asyncio.to_thread(self.friends_service.get_cached_friends)

    async def refresh_friends(self, force: bool = False):
        async with self._friend_fetch_lock:
            async with self._ra_slot():
                return await asyncio.to_thread(self._refresh_friends_sync, bool(force))

    def _refresh_friends_sync(self, force):
        cfg = self.settings_store.load_config()
        username = str(cfg.get("username", "")).strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        if not username or not web_api_key:
            cached = self.cache_store.load_friends()
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": cached.get("payload"),
                "changed": False,
            }
        return self.friends_service.refresh_friends(username, web_api_key, force=force)

    async def manual_refresh_friends(self):
        async with self._friend_fetch_lock:
            async with self._ra_slot():
                result = await asyncio.to_thread(self._manual_refresh_friends_sync)
        try:
            self.friends_roster_service.wake_now()
        except Exception:
            pass
        return result

    def _manual_refresh_friends_sync(self):
        cfg = self.settings_store.load_config()
        username = str(cfg.get("username", "")).strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        if not username or not web_api_key:
            cached = self.cache_store.load_friends()
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": cached.get("payload"),
                "changed": False,
            }
        return self.friends_service.manual_refresh_friends(username, web_api_key)

    async def deep_refresh_friends(self):
        counts = await asyncio.to_thread(
            self._run_clear_under_trickle_lock,
            self.resolved_avatar_store.clear_verdicts,
        )
        async with self._friend_fetch_lock:
            async with self._ra_slot():
                result = await asyncio.to_thread(self._manual_refresh_friends_sync)
        try:
            self.friends_roster_service.wake_now()
        except Exception:
            pass
        return {
            "ok": True,
            "verdicts": counts.get("verdicts", 0),
            **result,
        }

    async def resolve_friend_avatar(self, ulid: str, username: str):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = str(username or "").strip()
        ulid = str(ulid or "").strip()
        if not username or not web_api_key:
            return {"ok": False}

        active_ulid = str(cfg.get("activeUlid", "")).strip()
        if ulid and active_ulid and ulid == active_ulid:
            ran = await asyncio.to_thread(
                self.friends_roster_service.resolve_self_avatar_now, username, web_api_key
            )
        else:
            ran = await asyncio.to_thread(
                self.friends_roster_service.resolve_avatar_now, ulid, username, web_api_key
            )
        return {"ok": bool(ran)}

    async def refresh_friend_row(self, friend_username: str):
        async with self._friend_fetch_lock:
            async with self._ra_slot():
                return await asyncio.to_thread(self._refresh_friend_row_sync, friend_username)

    def _refresh_friend_row_sync(self, friend_username):
        cfg = self.settings_store.load_config()
        username = str(cfg.get("username", "")).strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        friend_username = str(friend_username or "").strip()
        if not username or not web_api_key or not friend_username:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "row": self.cache_store.get_cached_friend_row(friend_username),
            }
        return self.friends_service.refresh_friend_row(username, web_api_key, friend_username)

    async def get_friend_game_progress(self, user: str, game_id=None, force: bool = False):
        async with self._friend_fetch_lock:
            async with self._ra_slot():
                return await asyncio.to_thread(self._get_friend_game_progress_sync, user, game_id, bool(force))

    def _get_friend_game_progress_sync(self, user, game_id, force):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        user = str(user or "").strip()
        if not user or not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": None,
                "changed": False,
            }
        return self.friends_service.get_friend_game_progress(web_api_key, user, game_id=game_id, force=force)

    async def get_user_game_payload(self, user: str, game_id=None, force: bool = False):
        async with self._ra_slot():
            return await asyncio.to_thread(self._get_user_game_payload_sync, user, game_id, bool(force))

    def _get_user_game_payload_sync(self, user, game_id, force):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        user = str(user or "").strip()
        if not user or not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": None,
            }
        return self.friends_service.get_user_game_payload(web_api_key, user, game_id=game_id, force=force)

    async def get_cached_friend_game(self, user: str, game_id=None):
        user = str(user or "").strip()
        if not user:
            return None
        return await asyncio.to_thread(
            self.friends_service.get_cached_friend_game, user, game_id
        )

    async def load_games_list_cache(self, ulid: str):
        ulid = str(ulid or "").strip()
        if not ulid:
            return {"hit": False}
        minutes = self.settings_store.get_games_list_cache_minutes(self.settings_store.load_config())
        return await asyncio.to_thread(
            self.games_list_cache_store.load, ulid, max(1, int(minutes)) * 60
        )

    async def load_awards_list_cache(self, ulid: str):
        ulid = str(ulid or "").strip()
        if not ulid:
            return {"hit": False}
        minutes = self.settings_store.get_awards_list_cache_minutes(self.settings_store.load_config())
        return await asyncio.to_thread(
            self.awards_list_cache_store.load, ulid, max(1, int(minutes)) * 60
        )

    async def load_want_to_play_cache(self, ulid: str):
        ulid = str(ulid or "").strip()
        if not ulid:
            return {"hit": False}
        minutes = self.settings_store.get_want_to_play_cache_minutes(self.settings_store.load_config())
        return await asyncio.to_thread(
            self.want_to_play_cache_store.load, ulid, max(1, int(minutes)) * 60
        )

    async def load_friends_cache(self):
        return await asyncio.to_thread(self.cache_store.load_friends)

    async def patch_friend_row(self, row):
        if not isinstance(row, dict):
            return {"ok": False}
        return await asyncio.to_thread(self.friends_service.patch_friend_row_into_cache, row)

    async def fetch_friend_all_games_full(self, user: str, ulid: str = ""):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        user = str(user or "").strip()
        ulid = str(ulid or "").strip()
        if not user or not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": None,
                "changed": False,
            }
        gen0 = self.games_list_cache_store.current_generation()
        async with self._ra_slot():
            result = await asyncio.to_thread(
                self.friends_service.get_friend_all_games_full, web_api_key, user, ulid
            )
        if ulid and result.get("payload") and not result.get("error"):
            try:
                await asyncio.to_thread(
                    self.games_list_cache_store.save, ulid, result["payload"], gen0
                )
            except Exception as e:
                decky.logger.warning(
                    "fetch_friend_all_games_full: cache save failed: %s",
                    type(e).__name__,
                )
        return result

    async def get_user_want_to_play(self, user: str, offset: int = 0, count: int = 500, ulid: str = ""):
        ulid = str(ulid or "").strip()
        gen0 = self.want_to_play_cache_store.current_generation()
        async with self._ra_slot():
            result = await asyncio.to_thread(
                self._get_user_want_to_play_sync,
                user,
                to_int(offset, 0),
                to_int(count, 500),
            )
        if ulid and not offset and result.get("payload") and not result.get("error"):
            try:
                await asyncio.to_thread(
                    self.want_to_play_cache_store.save, ulid, result["payload"], gen0
                )
            except Exception as e:
                decky.logger.warning(
                    "get_user_want_to_play: cache save failed: %s",
                    type(e).__name__,
                )
        return result

    def _get_user_want_to_play_sync(self, user, offset, count):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        user = str(user or "").strip()
        if not user or not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": None,
                "changed": False,
            }
        return self.friends_service.get_user_want_to_play(web_api_key, user, offset=offset, count=count)

    async def get_user_awards(self, user: str, ulid: str = ""):
        ulid = str(ulid or "").strip()
        gen0 = self.awards_list_cache_store.current_generation()
        async with self._ra_slot():
            result = await asyncio.to_thread(self._get_user_awards_sync, user, ulid)
        if ulid and result.get("payload") and not result.get("error"):
            try:
                await asyncio.to_thread(
                    self.awards_list_cache_store.save, ulid, result["payload"], gen0
                )
            except Exception as e:
                decky.logger.warning(
                    "get_user_awards: cache save failed: %s",
                    type(e).__name__,
                )
        return result

    def _get_user_awards_sync(self, user, ulid):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        user = str(user or "").strip()
        ulid = str(ulid or "").strip()
        if not user or not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "payload": None,
                "changed": False,
            }
        return self.friends_service.get_user_awards(web_api_key, user, ulid)
