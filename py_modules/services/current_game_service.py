import time

from utils import format_completion_percent, frontend_error, norm_game_id, to_int
from notifications import emit_notification, is_type_enabled


class CurrentGameService:
    """Fetches, normalises, and caches the user's current game payload."""

    def __init__(self, *, ra, cache_store, settings_store, icon_service, notifications_store=None):
        self._ra = ra
        self._cache_store = cache_store
        self._settings_store = settings_store
        self._icon_service = icon_service

        self._notifications = notifications_store

        self._event_loop = None

        self._tracked_sets_monitor = None

    def set_tracked_sets_monitor(self, monitor):
        self._tracked_sets_monitor = monitor

    def _nudge_tracked_sets_monitor(self, game_id):
        monitor = self._tracked_sets_monitor
        if monitor is None:
            return
        monitor.request_check(game_id)

    def set_event_loop(self, loop):
        self._event_loop = loop

    def _emit_tracked_unlock_notifications(self, payload, removed_ids):
        if not self._notifications or not removed_ids:
            return

        titles_by_id = {}
        for achievement in payload.get("achievements", []) or []:
            try:
                aid = int(achievement.get("id"))
            except (TypeError, ValueError):
                continue
            titles_by_id[aid] = str(achievement.get("title") or "").strip()

        game_id = norm_game_id(payload.get("gameId"))
        game_title = str(payload.get("title") or "").strip()

        unlocked = []
        for raw in removed_ids:
            try:
                aid = int(raw)
            except (TypeError, ValueError):
                continue
            unlocked.append((aid, titles_by_id.get(aid, "")))

        if not unlocked:
            return

        if is_type_enabled("tracked", self._settings_store):
            game_icon = str(payload.get("imageIcon") or "").strip() or None
            for aid, ach_title in unlocked:
                self._notifications.append({
                    "type": "tracked",
                    "kind": "actionable",
                    "title": "Unlocked Tracked Achievement",
                    "body": ach_title,
                    "iconSource": "game",
                    "iconGameId": int(game_id) if game_id else None,
                    "iconImageIcon": game_icon,
                    "target": {
                        "view": "achievementOverview",
                        "gameId": int(game_id) if game_id else None,
                        "achievementId": aid,
                    },
                    "source": "notifications",
                    "meta": {
                        "achievementTitle": ach_title,
                        "gameTitle": game_title,
                    },
                })

        if len(unlocked) == 1:
            line_kwargs = {"toast_line": unlocked[0][1]}
        else:
            line_kwargs = {"line_key": "Multiple Achievements"}
        emit_notification(
            ntype="tracked",
            title_key="Unlocked Tracked:",
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            **line_kwargs,
        )

    def _normalize_measured_progress(self, raw):
        progress_candidates = [
            raw.get("MeasuredProgress"),
            raw.get("measuredProgress"),
            raw.get("Progress"),
            raw.get("progress"),
        ]
        measured_progress = None
        for candidate in progress_candidates:
            text = str(candidate or "").strip()
            if text:
                measured_progress = text
                break

        measured_percent = raw.get("MeasuredPercent")
        if measured_percent is None:
            measured_percent = raw.get("measuredPercent")
        try:
            measured_percent = float(measured_percent) if measured_percent is not None else None
        except (ValueError, TypeError, OverflowError):
            measured_percent = None

        measured_flag = raw.get("Measured")
        if measured_flag is None:
            measured_flag = raw.get("measured")

        measured = bool(measured_flag) or bool(measured_progress)
        return measured, measured_progress, measured_percent

    def _normalize_achievement(self, achievement_id, raw):
        display_order = raw.get("DisplayOrder")
        if display_order is None:
            display_order = raw.get("displayOrder")
        if display_order is None:
            try:
                display_order = int(achievement_id)
            except (ValueError, TypeError, OverflowError):
                display_order = 0

        points = raw.get("Points")
        if points is None:
            points = raw.get("points")
        try:
            points = int(points) if points is not None else 0
        except (ValueError, TypeError, OverflowError):
            points = 0

        true_ratio = raw.get("TrueRatio")
        if true_ratio is None:
            true_ratio = raw.get("trueRatio")
        try:
            true_ratio = float(true_ratio) if true_ratio is not None else 0.0
        except (ValueError, TypeError, OverflowError):
            true_ratio = 0.0

        ach_id = raw.get("ID", raw.get("id", achievement_id))
        try:
            ach_id = int(ach_id)
        except (ValueError, TypeError, OverflowError):
            pass

        measured, measured_progress, measured_percent = self._normalize_measured_progress(raw)

        return {
            "id": ach_id,
            "title": raw.get("Title", raw.get("title", "")),
            "description": raw.get("Description", raw.get("description", "")),
            "points": points,
            "trueRatio": true_ratio,
            "badgeName": raw.get("BadgeName", raw.get("badgeName", "")),
            "badgeUrl": self._icon_service.achievement_badge_url(raw.get("BadgeName", raw.get("badgeName", ""))),
            "displayOrder": to_int(display_order, 0),
            "type": raw.get("type") or raw.get("Type"),
            "dateEarned": raw.get("DateEarned", raw.get("dateEarned")),
            "dateEarnedHardcore": raw.get("DateEarnedHardcore", raw.get("dateEarnedHardcore")),
            "measured": measured,
            "measuredProgress": measured_progress,
            "measuredPercent": measured_percent,
            "numAwarded": to_int(raw.get("NumAwarded", raw.get("numAwarded", 0)), 0),
            "numAwardedHardcore": to_int(raw.get("NumAwardedHardcore", raw.get("numAwardedHardcore", 0)), 0),
        }

    def _sort_achievements(self, achievements):
        locked = []
        earned = []
        for achievement in achievements:
            if achievement.get("dateEarned") or achievement.get("dateEarnedHardcore"):
                earned.append(achievement)
            else:
                locked.append(achievement)
        achievements[:] = [*locked, *earned]
        return achievements

    def _highest_award_from_counts(self, num_awarded, num_awarded_hardcore, num_achievements):
        if num_achievements <= 0:
            return None
        if num_awarded_hardcore >= num_achievements:
            return "mastered"
        if num_awarded >= num_achievements:
            return "completed"
        return None

    def normalize_game_payload(self, game, fallback_game_id=None) -> dict:
        """Normalise a raw API game response into the plugin's payload shape.

        Public so FriendsService can reuse it for friend-game payloads.
        """
        raw_achievements = game.get("Achievements") or game.get("achievements") or {}
        achievements = [
            self._normalize_achievement(achievement_id, raw)
            for achievement_id, raw in raw_achievements.items()
        ]
        if achievements and all(row["displayOrder"] == 0 for row in achievements):
            for row in achievements:
                row["displayOrder"] = to_int(row.get("id"), 0)
        self._sort_achievements(achievements)

        num_achievements = to_int(
            game.get("NumAchievements", game.get("numAchievements", len(achievements))),
            len(achievements),
        )
        num_awarded = to_int(game.get("NumAwardedToUser", game.get("numAwardedToUser", 0)), 0)
        num_awarded_hardcore = to_int(
            game.get("NumAwardedToUserHardcore", game.get("numAwardedToUserHardcore", 0)),
            0,
        )

        user_completion = game.get("UserCompletion", game.get("userCompletion"))
        if not user_completion:
            user_completion = format_completion_percent(num_awarded, num_achievements)

        user_completion_hardcore = game.get("UserCompletionHardcore", game.get("userCompletionHardcore"))
        if not user_completion_hardcore:
            user_completion_hardcore = format_completion_percent(num_awarded_hardcore, num_achievements)

        return {
            "gameId": norm_game_id(game.get("ID", game.get("id", fallback_game_id))),
            "title": game.get("Title", game.get("title")),
            "consoleName": game.get("ConsoleName", game.get("consoleName")),
            "developer": game.get("Developer", game.get("developer")),
            "publisher": game.get("Publisher", game.get("publisher")),
            "genre": game.get("Genre", game.get("genre")),
            "released": game.get("Released", game.get("released")),
            "releasedAtGranularity": game.get("ReleasedAtGranularity", game.get("releasedAtGranularity")),
            "imageIcon": self._icon_service.game_icon_url(game.get("ImageIcon", game.get("imageIcon"))),
            "imageIngame": self._icon_service.game_icon_url(game.get("ImageIngame", game.get("imageIngame"))),
            "imageBoxArt": self._icon_service.game_icon_url(game.get("ImageBoxArt", game.get("imageBoxArt"))),
            "status": None,
            "numAchievements": num_achievements,
            "numAwardedToUser": num_awarded,
            "numAwardedToUserHardcore": num_awarded_hardcore,
            "highestAwardKind": self._highest_award_from_counts(num_awarded, num_awarded_hardcore, num_achievements),
            "userCompletion": user_completion,
            "userCompletionHardcore": user_completion_hardcore,
            "numDistinctPlayers": to_int(game.get("NumDistinctPlayers", game.get("numDistinctPlayers", 0)), 0),
            "numDistinctPlayersCasual": to_int(game.get("NumDistinctPlayersCasual", game.get("numDistinctPlayersCasual", 0)), 0),
            "numDistinctPlayersHardcore": to_int(game.get("NumDistinctPlayersHardcore", game.get("numDistinctPlayersHardcore", 0)), 0),
            "achievements": achievements,
        }

    def _recent_item_hardcore(self, item) -> bool:
        value = item.get("HardcoreMode", item.get("hardcoreMode"))
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes"}
        return bool(value)

    def _marker_from_item(self, item):
        if not item:
            return None
        achievement_id = item.get("AchievementID", item.get("achievementId"))
        date_value = item.get("Date", item.get("date")) or ""
        hardcore_flag = "1" if self._recent_item_hardcore(item) else "0"
        return f"{achievement_id}|{date_value}|{hardcore_flag}"

    def _recent_items_for_game(self, recent_achievements, game_id):
        game_id = norm_game_id(game_id)
        if game_id is None:
            return []
        items = []
        for item in recent_achievements or []:
            item_game_id = norm_game_id(item.get("GameID", item.get("gameId")))
            if item_game_id == game_id:
                items.append(item)
        return items

    def _find_latest_unlock_for_game(self, recent_achievements, game_id):
        best_item = None
        best_key = None
        for item in self._recent_items_for_game(recent_achievements, game_id):
            achievement_id = str(item.get("AchievementID", item.get("achievementId")) or "")
            date_value = str(item.get("Date", item.get("date")) or "")
            hardcore_flag = "1" if self._recent_item_hardcore(item) else "0"
            sort_key = (date_value, achievement_id, hardcore_flag)
            if best_key is None or sort_key > best_key:
                best_item = item
                best_key = sort_key
        return best_item

    def _patch_recent_unlocks_into_payload(self, payload, recent_items):
        if not payload or not recent_items:
            return payload

        recent_by_id = {}
        for item in recent_items:
            ach_id = item.get("AchievementID", item.get("achievementId"))
            if ach_id is None:
                continue
            recent_by_id[str(ach_id)] = item

        if not recent_by_id:
            return payload

        changed = False
        new_achievements = []

        for ach in payload.get("achievements", []):
            new_ach = dict(ach)
            item = recent_by_id.get(str(new_ach.get("id")))
            if item is not None:
                unlock_date = item.get("Date", item.get("date"))
                hardcore = self._recent_item_hardcore(item)
                if hardcore:
                    if not new_ach.get("dateEarnedHardcore"):
                        new_ach["dateEarnedHardcore"] = unlock_date
                        changed = True
                    if not new_ach.get("dateEarned"):
                        new_ach["dateEarned"] = unlock_date
                        changed = True
                else:
                    if not new_ach.get("dateEarned"):
                        new_ach["dateEarned"] = unlock_date
                        changed = True
            new_achievements.append(new_ach)

        if not changed:
            return payload

        self._sort_achievements(new_achievements)
        num_awarded = sum(1 for ach in new_achievements if ach.get("dateEarned") or ach.get("dateEarnedHardcore"))
        num_awarded_hardcore = sum(1 for ach in new_achievements if ach.get("dateEarnedHardcore"))
        total_achievements = to_int(payload.get("numAchievements"), len(new_achievements))

        new_payload = dict(payload)
        new_payload["achievements"] = new_achievements
        new_payload["numAwardedToUser"] = num_awarded
        new_payload["numAwardedToUserHardcore"] = num_awarded_hardcore
        new_payload["highestAwardKind"] = self._highest_award_from_counts(num_awarded, num_awarded_hardcore, total_achievements)
        new_payload["userCompletion"] = format_completion_percent(num_awarded, total_achievements)
        new_payload["userCompletionHardcore"] = format_completion_percent(num_awarded_hardcore, total_achievements)
        return new_payload

    def _empty_game_payload(self):
        return {
            "gameId": None,
            "title": None,
            "consoleName": None,
            "status": "No current or last-played game was returned.",
            "numAchievements": 0,
            "numAwardedToUser": 0,
            "numAwardedToUserHardcore": 0,
            "highestAwardKind": None,
            "userCompletion": None,
            "userCompletionHardcore": None,
            "achievements": [],
        }

    def _build_meta(self, game_id, recent_unlock_marker):
        return {
            "gameId": norm_game_id(game_id),
            "recentUnlockMarker": recent_unlock_marker,
            "refreshFinishedAt": int(time.time()),
        }

    def get_recent_unlock_history(self, username: str, web_api_key: str, game_id, minutes: int = 10080) -> dict:
        game_id = norm_game_id(game_id)
        if game_id is None:
            return {
                "gameId": None,
                "minutes": minutes,
                "count": 0,
                "results": [],
                "refreshedAt": int(time.time()),
            }

        recent = self._ra.get_recent_achievements(username, web_api_key, minutes)
        recent_same_game = self._recent_items_for_game(recent, game_id)

        rows_by_id = {}
        for item in recent_same_game:
            achievement_id = to_int(item.get("AchievementID", item.get("achievementId")), 0)
            if achievement_id <= 0:
                continue

            unlock_date = str(item.get("Date", item.get("date")) or "").strip()
            hardcore = self._recent_item_hardcore(item)
            row = {
                "achievementId": achievement_id,
                "dateEarned": unlock_date,
                "hardcore": hardcore,
            }

            current = rows_by_id.get(achievement_id)
            if current is None:
                rows_by_id[achievement_id] = row
                continue

            current_date = str(current.get("dateEarned") or "")
            if unlock_date > current_date:
                rows_by_id[achievement_id] = row
            elif unlock_date == current_date and hardcore and not bool(current.get("hardcore")):
                rows_by_id[achievement_id] = row

        rows = list(rows_by_id.values())
        rows.sort(
            key=lambda row: (
                str(row.get("dateEarned") or ""),
                int(row.get("achievementId") or 0),
            ),
            reverse=True,
        )

        return {
            "gameId": game_id,
            "minutes": minutes,
            "count": len(rows),
            "results": rows,
            "refreshedAt": int(time.time()),
        }

    def check_current_game(self, username: str, web_api_key: str, unlock_lookback_minutes: int, auto_refresh: bool) -> dict:
        cached_wrapper = self._cache_store.load_payload()
        cached = cached_wrapper.get("payload")
        cached_meta = cached_wrapper.get("meta", {})
        cached_game_id = norm_game_id(cached_meta.get("gameId"))

        try:
            profile = self._ra.get_user_profile(username, web_api_key)
            current_game_id = norm_game_id(profile.get("LastGameID", profile.get("lastGameId")))

            same_game = bool(cached) and (current_game_id == cached_game_id)
            changed = not same_game
            payload = cached

            if same_game and self._cache_store.is_payload_stale_for_full_refresh(cached_meta):
                return {
                    "needsSettings": False,
                    "payload": payload,
                    "sameGame": False,
                    "changed": True,
                    "currentGameId": current_game_id,
                    "cachedGameId": cached_game_id,
                }

            if same_game and auto_refresh:
                recent = self._ra.get_recent_achievements(username, web_api_key, unlock_lookback_minutes)
                recent_same_game = self._recent_items_for_game(recent, current_game_id)
                latest_recent_same_game = self._find_latest_unlock_for_game(recent_same_game, current_game_id)
                current_recent_marker = self._marker_from_item(latest_recent_same_game)
                cached_recent_marker = cached_meta.get("recentUnlockMarker")
                changed = current_recent_marker != cached_recent_marker

                if changed:
                    with self._cache_store.payload_lock():
                        fresh_wrapper = self._cache_store.load_payload()
                        fresh_cached = fresh_wrapper.get("payload")
                        payload = self._patch_recent_unlocks_into_payload(fresh_cached, recent_same_game)
                        cleanup = self._settings_store.cleanup_tracked_against_payload(payload)
                        self._cache_store.save_payload(payload, self._build_meta(current_game_id, current_recent_marker))
                    self._emit_tracked_unlock_notifications(payload, cleanup.get("removedIds"))
                    self._nudge_tracked_sets_monitor(current_game_id)

            return {
                "needsSettings": False,
                "payload": payload,
                "sameGame": same_game,
                "changed": changed,
                "currentGameId": current_game_id,
                "cachedGameId": cached_game_id,
            }
        except Exception as e:
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't check your current game right now.", e),
                "payload": cached,
                "sameGame": False,
                "changed": False,
                "currentGameId": None,
                "cachedGameId": cached_game_id,
            }

    def refresh_current_game(self, username: str, web_api_key: str, unlock_lookback_minutes: int, force: bool = False) -> dict:
        cached_wrapper = self._cache_store.load_payload()
        cached = cached_wrapper.get("payload")
        cached_meta = cached_wrapper.get("meta", {})

        try:
            profile = self._ra.get_user_profile(username, web_api_key)
            current_game_id = norm_game_id(profile.get("LastGameID", profile.get("lastGameId")))
            cached_game_id = norm_game_id(cached_meta.get("gameId"))

            if not force and cached and current_game_id is not None and current_game_id == cached_game_id:
                recent = self._ra.get_recent_achievements(username, web_api_key, unlock_lookback_minutes)
                recent_same_game = self._recent_items_for_game(recent, current_game_id)
                latest_recent_same_game = self._find_latest_unlock_for_game(recent_same_game, current_game_id)
                current_recent_marker = self._marker_from_item(latest_recent_same_game)
                cached_recent_marker = cached_meta.get("recentUnlockMarker")

                if current_recent_marker == cached_recent_marker:
                    return {"payload": cached, "changed": False}

                with self._cache_store.payload_lock():
                    fresh_wrapper = self._cache_store.load_payload()
                    fresh_cached = fresh_wrapper.get("payload")
                    patched_payload = self._patch_recent_unlocks_into_payload(fresh_cached, recent_same_game)
                    cleanup = self._settings_store.cleanup_tracked_against_payload(patched_payload)
                    self._cache_store.save_payload(patched_payload, self._build_meta(current_game_id, current_recent_marker))
                self._emit_tracked_unlock_notifications(patched_payload, cleanup.get("removedIds"))
                self._nudge_tracked_sets_monitor(current_game_id)
                return {"payload": patched_payload, "changed": True}

            if cached_game_id is not None and cached_game_id != current_game_id:
                self._cache_store.clear_pending_game_ticker_event()

            if not current_game_id:
                payload = self._empty_game_payload()
                with self._cache_store.payload_lock():
                    self._cache_store.save_payload(payload, self._build_meta(None, None))
                return {"payload": payload, "changed": True}

            game = self._ra.get_game_info_and_user_progress(username, current_game_id, web_api_key)
            payload = self.normalize_game_payload(game, fallback_game_id=current_game_id)

            recent = self._ra.get_recent_achievements(username, web_api_key, unlock_lookback_minutes)
            latest_recent_same_game = self._find_latest_unlock_for_game(recent, current_game_id)
            current_recent_marker = self._marker_from_item(latest_recent_same_game)

            payload = self._patch_recent_unlocks_into_payload(payload, self._recent_items_for_game(recent, current_game_id))
            with self._cache_store.payload_lock():
                cleanup = self._settings_store.cleanup_tracked_against_payload(payload)
                self._cache_store.save_payload(payload, self._build_meta(payload["gameId"], current_recent_marker))
            self._emit_tracked_unlock_notifications(payload, cleanup.get("removedIds"))
            self._nudge_tracked_sets_monitor(current_game_id)

            return {"payload": payload, "changed": True}
        except Exception as e:
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't refresh your achievements right now.", e),
                "payload": cached,
                "changed": False,
            }

    def clear_current_game(self) -> dict:
        payload = self._empty_game_payload()
        with self._cache_store.payload_lock():
            self._cache_store.save_payload(payload, self._build_meta(None, None))
        return {"payload": payload}
