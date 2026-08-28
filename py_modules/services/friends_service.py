import re
import time
import urllib.error

import decky

from utils import frontend_error, norm_game_id, to_int


_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


MAX_FOLLOW_PAGES = 50


class FriendsService:
    """Fetches, normalises, and caches friends list and friend-game data."""

    def __init__(
        self,
        *,
        ra,
        cache_store,
        current_game_service,
        icon_service,
        friends_page_size: int,
        friends_roster_refresh_max_age_seconds: int,
        friends_row_refresh_recent_count: int,
        friend_game_cache_max_age_seconds: int,
        recent_games_count: int,
        debug_logging_provider=None,
        validate_friends_roster_provider=None,
        self_ulid_provider=None,
    ):
        self._ra = ra
        self._cache_store = cache_store
        self._current_game_service = current_game_service
        self._icon_service = icon_service
        self._friends_page_size = friends_page_size
        self._friends_roster_refresh_max_age_seconds = friends_roster_refresh_max_age_seconds
        self._friends_row_refresh_recent_count = friends_row_refresh_recent_count
        self._friend_game_cache_max_age_seconds = friend_game_cache_max_age_seconds
        self._recent_games_count = recent_games_count
        self._debug_logging_provider = debug_logging_provider
        self._validate_friends_roster_provider = validate_friends_roster_provider
        self._self_ulid_provider = self_ulid_provider

    def _self_ulid(self) -> str:
        if self._self_ulid_provider is None:
            return ""
        try:
            return str(self._self_ulid_provider() or "").strip()
        except Exception:
            return ""

    def _debug_logging_on(self) -> bool:
        if self._debug_logging_provider is None:
            return False
        return bool(self._debug_logging_provider())

    def _validate_friends_roster(self) -> bool:
        if self._validate_friends_roster_provider is None:
            return True
        try:
            return bool(self._validate_friends_roster_provider())
        except Exception:
            return True

    def _normalize_recent_games(self, recent_games):
        normalized = []
        seen = set()
        for item in recent_games or []:
            game_id = norm_game_id(item.get("GameID", item.get("gameId")) or item.get("ID") or item.get("id"))
            if not game_id or game_id in seen:
                continue
            seen.add(game_id)
            normalized.append({
                "gameId": game_id,
                "title": item.get("Title", item.get("title")) or f"Game {game_id}",
                "consoleName": item.get("ConsoleName", item.get("consoleName")),
                "imageIcon": self._icon_service.game_icon_url(item.get("ImageIcon", item.get("imageIcon"))),
                "lastPlayed": item.get("LastPlayed", item.get("lastPlayed")) or item.get("Date", item.get("date")),
            })
        return normalized

    def _resolve_follow_flag(self, username, follow_item, existing_row, source):
        flag = follow_item.get("IsFollowingMe", follow_item.get("isFollowingMe"))
        inherited = flag is None
        if inherited:
            flag = existing_row.get("isFollowingMe") if existing_row else None
        if self._debug_logging_on():
            decky.logger.info(
                "follow-flag: %s via=%s raw=%r inherited=%s -> %s",
                username or "?", source, follow_item.get("IsFollowingMe", follow_item.get("isFollowingMe")),
                inherited, bool(flag),
            )
        return bool(flag)

    def _normalize_friend_row(self, follow_item, profile, existing_row=None, recent_games=None, is_self=False):
        existing_row = existing_row or {}
        username = str(
            follow_item.get("User")
            or follow_item.get("user")
            or profile.get("User")
            or profile.get("user")
            or ""
        ).strip()

        rich_presence = profile.get("RichPresenceMsg", profile.get("richPresenceMsg"))
        rich_presence = str(rich_presence or "").strip()
        normalized_recent_games = self._normalize_recent_games(recent_games)
        last_game_id = norm_game_id(profile.get("LastGameID", profile.get("lastGameId")))
        last_game_title = None
        for item in normalized_recent_games:
            if item.get("gameId") == last_game_id:
                last_game_title = item.get("title")
                break
        if not last_game_title and last_game_id is not None:
            existing_last_game_id = norm_game_id(existing_row.get("lastGameId"))
            if existing_last_game_id == last_game_id:
                last_game_title = existing_row.get("lastGameTitle")

        follow_flag = self._resolve_follow_flag(username, follow_item, existing_row, "profile")

        return {
            "username": username,
            "ulid": follow_item.get("ULID", follow_item.get("ulid")) or profile.get("ULID", profile.get("ulid")),
            "richPresence": rich_presence or None,
            "lastGameId": last_game_id,
            "lastGameTitle": last_game_title,
            "points": to_int(follow_item.get("Points", follow_item.get("points", profile.get("TotalPoints", profile.get("totalPoints", 0)))), 0),
            "pointsSoftcore": to_int(follow_item.get("PointsSoftcore", follow_item.get("pointsSoftcore", profile.get("TotalSoftcorePoints", profile.get("totalSoftcorePoints", 0)))), 0),
            "totalTruePoints": to_int(profile.get("TotalTruePoints", profile.get("totalTruePoints", 0)), 0),
            "isFollowingMe": bool(follow_flag),
            "isSelf": bool(is_self),
            "statusText": rich_presence or ("Your profile" if is_self else "No rich presence"),
            "recentGames": normalized_recent_games,
        }

    def _build_placeholder_friend_row(self, follow_item, existing_row=None, is_self=False):
        existing_row = existing_row or {}
        username = str(
            follow_item.get("User")
            or follow_item.get("user")
            or existing_row.get("username")
            or ""
        ).strip()
        if not username:
            return None
        follow_flag = self._resolve_follow_flag(username, follow_item, existing_row, "roster")
        existing_recent_games = existing_row.get("recentGames") if isinstance(existing_row.get("recentGames"), list) else []
        return {
            "username": username,
            "ulid": follow_item.get("ULID", follow_item.get("ulid")) or existing_row.get("ulid"),
            "richPresence": existing_row.get("richPresence"),
            "lastGameId": norm_game_id(existing_row.get("lastGameId")),
            "lastGameTitle": existing_row.get("lastGameTitle"),
            "points": to_int(existing_row.get("points"), to_int(follow_item.get("Points", follow_item.get("points", 0)), 0)),
            "pointsSoftcore": to_int(existing_row.get("pointsSoftcore"), to_int(follow_item.get("PointsSoftcore", follow_item.get("pointsSoftcore", 0)), 0)),
            "totalTruePoints": to_int(existing_row.get("totalTruePoints"), 0),
            "isFollowingMe": bool(follow_flag),
            "isSelf": bool(is_self),
            "statusText": existing_row.get("statusText") or ("Your profile" if is_self else ""),
            "recentGames": existing_recent_games,
        }

    def _normalize_friend_all_games_row(self, item):
        return {
            "gameId": norm_game_id(item.get("GameID", item.get("gameId"))),
            "title": item.get("Title", item.get("title")) or "Unknown Game",
            "consoleId": to_int(item.get("ConsoleID", item.get("consoleId", 0)), 0),
            "consoleName": item.get("ConsoleName", item.get("consoleName")),
            "imageIcon": self._icon_service.game_icon_url(item.get("ImageIcon", item.get("imageIcon"))),
            "maxPossible": to_int(item.get("MaxPossible", item.get("maxPossible", 0)), 0),
            "numAwarded": to_int(item.get("NumAwarded", item.get("numAwarded", 0)), 0),
            "numAwardedHardcore": to_int(item.get("NumAwardedHardcore", item.get("numAwardedHardcore", 0)), 0),
            "highestAwardKind": item.get("HighestAwardKind", item.get("highestAwardKind")),
            "highestAwardDate": item.get("HighestAwardDate", item.get("highestAwardDate")),
        }

    def build_friend_all_games_payload(self, user, raw_rows, total=None):
        merged = []
        seen = set()
        for item in raw_rows:
            row = self._normalize_friend_all_games_row(item)
            gid = row.get("gameId")
            if gid is None:
                merged.append(row)
                continue
            if gid in seen:
                continue
            seen.add(gid)
            merged.append(row)
        merged.sort(key=lambda r: (r.get("title") or "").lower())
        return {
            "friendUsername": user,
            "offset": 0,
            "count": len(merged),
            "total": total if total is not None else len(merged),
            "results": merged,
            "refreshedAt": int(time.time()),
        }

    def _normalize_user_want_to_play(self, username, raw_wtp, raw_progress, offset=0, count=500):
        progress_by_game = {}
        if isinstance(raw_progress, dict):
            progress_rows = raw_progress.get("Results", raw_progress.get("results", [])) or []
            for row in progress_rows:
                gid = norm_game_id(row.get("GameID", row.get("gameId")))
                if gid is None:
                    continue
                progress_by_game[gid] = (
                    to_int(row.get("NumAwarded", row.get("numAwarded", 0)), 0),
                    to_int(row.get("MaxPossible", row.get("maxPossible", 0)), 0),
                )

        wtp = raw_wtp if isinstance(raw_wtp, dict) else {}
        raw_results = wtp.get("Results", wtp.get("results", [])) or []
        normalized = []
        for item in raw_results:
            game_id = norm_game_id(item.get("ID", item.get("id")))
            achievements_published = to_int(item.get("AchievementsPublished", item.get("achievementsPublished", 0)), 0)
            joined = progress_by_game.get(game_id)
            if joined is not None:
                num_awarded, max_possible = joined
                if achievements_published > max_possible:
                    max_possible = achievements_published
            else:
                num_awarded = 0
                max_possible = achievements_published
            normalized.append({
                "gameId": game_id,
                "title": item.get("Title", item.get("title")) or "Unknown Game",
                "consoleName": item.get("ConsoleName", item.get("consoleName")),
                "imageIcon": self._icon_service.game_icon_url(item.get("ImageIcon", item.get("imageIcon"))),
                "pointsTotal": to_int(item.get("PointsTotal", item.get("pointsTotal", 0)), 0),
                "achievementsPublished": achievements_published,
                "numAwarded": num_awarded,
                "maxPossible": max_possible,
            })
        return {
            "username": username,
            "offset": to_int(offset, 0),
            "count": to_int(count, len(normalized)),
            "total": to_int(wtp.get("Total", wtp.get("total", len(normalized))), len(normalized)),
            "results": normalized,
            "refreshedAt": int(time.time()),
        }

    def _normalize_user_awards(self, username, raw_response):
        raw_response = raw_response or {}
        raw_results = raw_response.get("VisibleUserAwards", raw_response.get("visibleUserAwards", [])) or []
        normalized = []
        for item in raw_results:
            award_type = item.get("AwardType", item.get("awardType"))
            award_data = to_int(item.get("AwardData", item.get("awardData")), 0)
            image_icon = self._icon_service.game_icon_url(item.get("ImageIcon", item.get("imageIcon")))
            if not image_icon:
                image_icon = self._icon_service.site_award_badge_url(award_type, award_data)
            normalized.append({
                "awardType": award_type,
                "awardData": award_data,
                "awardDataExtra": to_int(item.get("AwardDataExtra", item.get("awardDataExtra")), 0),
                "title": item.get("Title", item.get("title")) or "",
                "consoleName": item.get("ConsoleName", item.get("consoleName")),
                "imageIcon": image_icon,
                "awardedAt": item.get("AwardedAt", item.get("awardedAt")),
                "displayOrder": to_int(item.get("DisplayOrder", item.get("displayOrder")), 0),
            })

        def count_of(*keys):
            for key in keys:
                if key in raw_response:
                    return to_int(raw_response.get(key), 0)
            return 0

        return {
            "username": username,
            "results": normalized,
            "totalAwardsCount": count_of("TotalAwardsCount", "totalAwardsCount"),
            "hiddenAwardsCount": count_of("HiddenAwardsCount", "hiddenAwardsCount"),
            "masteryAwardsCount": count_of("MasteryAwardsCount", "masteryAwardsCount"),
            "completionAwardsCount": count_of("CompletionAwardsCount", "completionAwardsCount"),
            "beatenHardcoreAwardsCount": count_of("BeatenHardcoreAwardsCount", "beatenHardcoreAwardsCount"),
            "beatenSoftcoreAwardsCount": count_of("BeatenSoftcoreAwardsCount", "beatenSoftcoreAwardsCount"),
            "eventAwardsCount": count_of("EventAwardsCount", "eventAwardsCount"),
            "siteAwardsCount": count_of("SiteAwardsCount", "siteAwardsCount"),
            "refreshedAt": int(time.time()),
        }

    def _build_friends_payload(self, rows, refreshed_at=None):
        refreshed_at = to_int(refreshed_at if refreshed_at is not None else int(time.time()), int(time.time()))
        return {
            "friends": list(rows or []),
            "count": len(rows or []),
            "refreshedAt": refreshed_at,
        }

    def _build_friend_game_payload(self, friend_username, selected_game_id, recent_games, payload, rich_presence=None, status_text=None, profile_points=None, ulid=None, member_since=None, motto=None):
        selected_game_title = None
        for item in recent_games:
            if item.get("gameId") == selected_game_id:
                selected_game_title = item.get("title")
                break
        if not selected_game_title and payload:
            selected_game_title = payload.get("title")
        rich_presence = str(rich_presence or "").strip() or None
        status_text = str(status_text or "").strip() or (rich_presence or "No rich presence")
        profile_points = profile_points or {}
        return {
            "friendUsername": friend_username,
            "ulid": ulid,
            "selectedGameId": selected_game_id,
            "selectedGameTitle": selected_game_title,
            "recentGames": recent_games,
            "richPresence": rich_presence,
            "statusText": status_text,
            "points": profile_points.get("points"),
            "pointsSoftcore": profile_points.get("pointsSoftcore"),
            "totalTruePoints": profile_points.get("totalTruePoints"),
            "memberSince": member_since or None,
            "motto": motto or None,
            "payload": payload,
            "refreshedAt": int(time.time()),
        }

    def _friend_cache_key(self, friend_username):
        return str(friend_username or "").strip().lower()

    def _friend_game_key(self, ulid, username):
        ulid = str(ulid or "").strip().lower()
        if ulid:
            return "ulid:" + ulid
        return "name:" + self._friend_cache_key(username)

    def _resolve_friend_game_entry(self, ref):
        ref = str(ref or "").strip().lower()
        if not ref:
            return None
        entry = self._cache_store.load_friend_game("ulid:" + ref)
        if entry:
            return entry
        entry = self._cache_store.load_friend_game("name:" + ref)
        return entry if entry else None

    def _friend_game_payload_key(self, ref, game_id):
        ref = str(ref or "").strip()
        ulid = ref if _ULID_RE.match(ref.upper()) else ""
        return self._friend_game_key(ulid, ref) + ":" + str(game_id)

    def _resolve_friend_game_payload(self, ref, game_id):
        ref = str(ref or "").strip().lower()
        if not ref or not game_id:
            return None
        entry = self._cache_store.load_friend_game_payload(
            self._friend_game_payload_key(ref, game_id)
        )
        if not entry:
            return None

        if norm_game_id(entry.get("gameId")) != game_id:
            return None
        return entry

    def _save_friend_game_payload(self, ref, game_id, payload):
        entry = {
            "gameId": game_id,
            "payload": payload,
            "refreshedAt": int(time.time()),
        }
        key = self._friend_game_payload_key(ref, game_id)
        try:
            with self._cache_store.friend_game_payload_lock(key):
                self._cache_store.save_friend_game_payload(key, entry)
        except Exception as e:
            decky.logger.warning("gopayload: cache write failed for %s: %s", key, type(e).__name__)

    def _fetch_recent_games_preview(self, username, web_api_key):
        try:
            return self._ra.get_user_recently_played_games(
                username,
                web_api_key,
                count=self._friends_row_refresh_recent_count,
            )
        except Exception as exc:
            decky.logger.warning("recent-games preview failed for %s: %s (%s)", username, type(exc).__name__, exc)
            return []

    def _fetch_all_follow_rows(self, web_api_key):
        results = []
        offset = 0
        finished = False
        for _ in range(MAX_FOLLOW_PAGES):
            page = self._ra.get_users_i_follow(web_api_key, offset=offset, count=self._friends_page_size)
            page_results = page.get("Results", page.get("results", [])) or []
            results.extend(page_results)
            total = to_int(page.get("Total", page.get("total", len(results))), len(results))
            count = to_int(page.get("Count", page.get("count", len(page_results))), len(page_results))
            if not page_results or count <= 0:
                finished = True
                break
            offset += count
            if offset >= total:
                finished = True
                break

        if not finished:
            decky.logger.warning(
                "follow pagination hit page cap (%d); truncating at %d rows",
                MAX_FOLLOW_PAGES,
                len(results),
            )
        return results

    def _build_friend_row_from_network(self, follow_item, web_api_key, existing_row=None, is_self=False, query_ref=None):
        existing_row = existing_row or {}
        target_username = str(
            follow_item.get("User") or follow_item.get("user") or existing_row.get("username") or ""
        ).strip()
        if not target_username:
            return None
        query_seed = str(query_ref or "").strip() or target_username
        profile = self._ra.get_user_profile(query_seed, web_api_key)
        recent_games_raw = self._fetch_recent_games_preview(query_seed, web_api_key)
        row = self._normalize_friend_row(follow_item, profile, existing_row, recent_games=recent_games_raw, is_self=is_self)
        if row.get("lastGameId") and not row.get("lastGameTitle"):
            try:
                game = self._ra.get_game(row["lastGameId"], web_api_key)
                title = str(game.get("Title", game.get("GameTitle")) or "").strip()
                if title:
                    row["lastGameTitle"] = title
            except Exception as exc:
                decky.logger.warning("last-game title lookup failed for %s: %s (%s)", target_username, type(exc).__name__, exc)
        return row if row.get("username") else None

    def get_cached_friends(self) -> dict:
        cached = self._cache_store.load_friends()
        payload = cached.get("payload")
        return {"payload": payload, "hasCache": bool(payload)}

    def refresh_friends(self, username: str, web_api_key: str, force: bool = False) -> dict:
        cached_wrapper = self._cache_store.load_friends()
        cached_payload = cached_wrapper.get("payload")
        cached_meta = cached_wrapper.get("meta", {})
        last_roster_checked_at = to_int(cached_meta.get("rosterCheckedAt"), to_int(cached_meta.get("refreshStartedAt"), 0))
        now = int(time.time())

        cached_friend_rows = (cached_payload or {}).get("friends") or []
        roster_frozen = not self._validate_friends_roster() and bool(cached_friend_rows)

        if roster_frozen or (
            not force
            and cached_payload
            and last_roster_checked_at > 0
            and (now - last_roster_checked_at) < self._friends_roster_refresh_max_age_seconds
        ):
            try:
                cached_friends = list((cached_payload or {}).get("friends", []) or [])
                existing_self_row = None
                for row in cached_friends:
                    if row.get("isSelf"):
                        existing_self_row = row
                        break

                self_ref = self._self_ulid() or str((existing_self_row or {}).get("ulid") or "").strip() or username
                refreshed_self_row = self._build_friend_row_from_network(
                    {"User": username},
                    web_api_key,
                    existing_row=existing_self_row or {},
                    is_self=True,
                    query_ref=self_ref,
                )

                with self._cache_store.friends_lock():
                    disk_wrapper = self._cache_store.load_friends()
                    disk_payload = disk_wrapper.get("payload") or {}
                    disk_friends = list(disk_payload.get("friends") or [])
                    disk_meta = disk_wrapper.get("meta") or {}

                    next_rows = []
                    replaced = False
                    for row in disk_friends:
                        if row.get("isSelf"):
                            if not replaced:
                                next_rows.append(refreshed_self_row)
                                replaced = True
                            continue
                        next_rows.append(row)
                    if not replaced and refreshed_self_row and refreshed_self_row.get("username"):
                        next_rows.insert(0, refreshed_self_row)

                    payload = dict(disk_payload)
                    payload["friends"] = next_rows
                    payload["count"] = len(next_rows)
                    payload["refreshedAt"] = now

                    changed = payload != disk_payload
                    self._cache_store.save_friends(
                        payload,
                        {
                            "refreshStartedAt": disk_meta.get("refreshStartedAt", now),
                            "refreshFinishedAt": int(time.time()),
                            "rosterCheckedAt": to_int(
                                disk_meta.get("rosterCheckedAt"),
                                last_roster_checked_at,
                            ),
                        },
                    )
                return {"needsSettings": False, "payload": payload, "changed": changed}
            except Exception as exc:
                decky.logger.exception("fast-path friends refresh failed: %s (%s)", type(exc).__name__, exc)
                return {"needsSettings": False, "payload": cached_payload, "changed": False}

        return self._rebuild_roster_from_follow_list(username, web_api_key, cached_payload, now)

    def manual_refresh_friends(self, username: str, web_api_key: str) -> dict:
        cached_wrapper = self._cache_store.load_friends()
        cached_payload = cached_wrapper.get("payload")
        now = int(time.time())
        return self._rebuild_roster_from_follow_list(username, web_api_key, cached_payload, now)

    def _rebuild_roster_from_follow_list(self, username: str, web_api_key: str, cached_payload, now: int) -> dict:
        try:
            follow_rows = self._fetch_all_follow_rows(web_api_key)

            existing_rows_snapshot = {
                str(row.get("username") or "").strip().lower(): row
                for row in (cached_payload or {}).get("friends", [])
                if str(row.get("username") or "").strip()
            }
            existing_self_row = existing_rows_snapshot.get(username.lower()) or {}
            self_ref = self._self_ulid() or str(existing_self_row.get("ulid") or "").strip() or username
            try:
                self_row = self._build_friend_row_from_network(
                    {"User": username},
                    web_api_key,
                    existing_row=existing_self_row,
                    is_self=True,
                    query_ref=self_ref,
                )
            except Exception as exc:
                decky.logger.warning("self-row network build failed, using placeholder: %s (%s)", type(exc).__name__, exc)
                self_row = self._build_placeholder_friend_row({"User": username}, existing_self_row, is_self=True)

            with self._cache_store.friends_lock():
                disk_wrapper = self._cache_store.load_friends()
                disk_payload = disk_wrapper.get("payload") or {}
                latest_rows_by_key = {
                    str(row.get("username") or "").strip().lower(): row
                    for row in (disk_payload.get("friends") or [])
                    if str(row.get("username") or "").strip()
                }

                next_rows = []
                seen_usernames = set()
                if self_row and self_row.get("username"):
                    next_rows.append(self_row)
                    seen_usernames.add(str(self_row.get("username") or "").strip().lower())

                for follow_row in follow_rows:
                    target_username = str(follow_row.get("User") or follow_row.get("user") or "").strip()
                    if not target_username:
                        continue
                    row_key = target_username.lower()
                    if row_key in seen_usernames:
                        continue
                    existing_row = latest_rows_by_key.get(row_key) or existing_rows_snapshot.get(row_key) or {}
                    row = self._build_placeholder_friend_row(follow_row, existing_row, is_self=False)
                    if not row or not row.get("username"):
                        continue
                    next_rows.append(row)
                    seen_usernames.add(row_key)

                payload = self._build_friends_payload(next_rows, refreshed_at=now)
                self._cache_store.save_friends(
                    payload,
                    {
                        "refreshStartedAt": now,
                        "refreshFinishedAt": int(time.time()),
                        "rosterCheckedAt": now,
                    },
                )
            return {"needsSettings": False, "payload": payload, "changed": payload != cached_payload}
        except Exception as e:
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't reach RetroAchievements while refreshing your friends list.", e),
                "payload": cached_payload,
                "changed": False,
            }

    def refresh_friend_row(self, username: str, web_api_key: str, friend_username: str) -> dict:
        cached_wrapper = self._cache_store.load_friends()
        cached_payload = cached_wrapper.get("payload") or {}
        existing_rows = list(cached_payload.get("friends") or [])
        existing_by_key = {
            str(row.get("username") or "").strip().lower(): row
            for row in existing_rows
            if str(row.get("username") or "").strip()
        }

        target_key = friend_username.lower()
        existing_row = existing_by_key.get(target_key) or {}

        self_ulid = self._self_ulid()
        row_ulid = str(existing_row.get("ulid") or "").strip()
        is_self = (self_ulid and row_ulid == self_ulid) or (
            not row_ulid and target_key == username.lower()
        )
        query_ref = (self_ulid if is_self else "") or row_ulid or friend_username

        try:
            row = self._build_friend_row_from_network(
                {"User": friend_username},
                web_api_key,
                existing_row=existing_row,
                is_self=is_self,
                query_ref=query_ref,
            )
            if not row:
                return {"needsSettings": False, "row": existing_row or None, "payload": cached_payload or None}

            with self._cache_store.friends_lock():
                disk_wrapper = self._cache_store.load_friends()
                disk_payload = disk_wrapper.get("payload") or {}
                disk_friends = list(disk_payload.get("friends") or [])
                disk_meta = disk_wrapper.get("meta") or {}

                row_ulid = str(row.get("ulid") or "").strip().lower()
                target_index = -1
                if row_ulid:
                    for index, current in enumerate(disk_friends):
                        if str(current.get("ulid") or "").strip().lower() == row_ulid:
                            target_index = index
                            break
                if target_index < 0:
                    for index, current in enumerate(disk_friends):
                        if str(current.get("username") or "").strip().lower() == target_key:
                            target_index = index
                            break

                next_rows = list(disk_friends)
                if target_index >= 0:
                    next_rows[target_index] = row
                else:
                    return {"needsSettings": False, "row": None, "payload": disk_payload or None}

                payload = self._build_friends_payload(next_rows, refreshed_at=int(time.time()))
                updated_meta = dict(disk_meta or {})
                updated_meta["refreshStartedAt"] = int(time.time())
                updated_meta["refreshFinishedAt"] = int(time.time())
                self._cache_store.save_friends(payload, updated_meta)
            return {"needsSettings": False, "row": row, "payload": payload}
        except Exception as e:
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't reach RetroAchievements while refreshing this friend.", e),
                "row": existing_row or None,
                "payload": cached_payload or None,
            }

    def patch_friend_row_into_cache(self, row) -> dict:
        if not isinstance(row, dict):
            return {"ok": False}

        row_ulid = str(row.get("ulid") or "").strip().lower()
        row_name = str(row.get("username") or "").strip().lower()
        if not row_ulid and not row_name:
            return {"ok": False}

        with self._cache_store.friends_lock():
            wrapper = self._cache_store.load_friends()
            payload = wrapper.get("payload") or {}
            rows = list(payload.get("friends") or [])

            target_index = -1
            if row_ulid:
                for index, current in enumerate(rows):
                    if str(current.get("ulid") or "").strip().lower() == row_ulid:
                        target_index = index
                        break
            if target_index < 0 and row_name:
                for index, current in enumerate(rows):
                    if str(current.get("username") or "").strip().lower() == row_name:
                        target_index = index
                        break

            if target_index >= 0:
                merged = dict(rows[target_index])
                merged.update(row)
                rows[target_index] = merged
            else:
                return {"ok": False, "reason": "notFollowed"}

            next_payload = dict(payload)
            next_payload["friends"] = rows
            next_payload["count"] = len(rows)
            self._cache_store.save_friends(next_payload, wrapper.get("meta") or {})

        return {"ok": True}

    def get_user_game_payload(self, web_api_key: str, user: str, game_id=None, force: bool = False) -> dict:
        selected_game_id = norm_game_id(game_id)
        if not selected_game_id:
            return {"payload": None, "error": "Missing game id."}

        if not force:
            pair_entry = self._resolve_friend_game_payload(user, selected_game_id) or {}
            pair_payload = pair_entry.get("payload")
            pair_refreshed_at = to_int(pair_entry.get("refreshedAt"), 0)
            pair_age = int(time.time()) - pair_refreshed_at if pair_refreshed_at else None
            if pair_payload and pair_age is not None and pair_age < self._friend_game_cache_max_age_seconds:
                if self._debug_logging_on():
                    decky.logger.info("gopayload: hit store=pair ref=%s game=%s age=%ss", user, selected_game_id, pair_age)
                return {"payload": pair_payload}

            friend_cache = self._resolve_friend_game_entry(user) or {}
            cached_selected_id = norm_game_id(friend_cache.get("selectedGameId"))
            cached_refreshed_at = to_int(friend_cache.get("refreshedAt"), 0)
            cached_payload = friend_cache.get("payload")
            age = int(time.time()) - cached_refreshed_at if cached_refreshed_at else None
            if cached_payload and cached_selected_id == selected_game_id and age is not None and age < self._friend_game_cache_max_age_seconds:
                if self._debug_logging_on():
                    decky.logger.info("gopayload: hit store=wrapper ref=%s game=%s age=%ss", user, selected_game_id, age)
                return {"payload": cached_payload}
            if self._debug_logging_on():
                if not friend_cache:
                    why = "nokey"
                elif not cached_payload:
                    why = "nopayload"
                elif cached_selected_id != selected_game_id:
                    why = f"wronggame cached={cached_selected_id}"
                else:
                    why = f"stale age={age}s"
                decky.logger.info("gopayload: miss ref=%s game=%s why=%s pair=%s", user, selected_game_id, why, "stale" if pair_entry else "nokey")

        try:
            game = self._ra.get_game_info_and_user_progress(user, selected_game_id, web_api_key)
            payload = self._current_game_service.normalize_game_payload(game, fallback_game_id=selected_game_id)
        except Exception as e:
            return {
                "payload": None,
                "error": frontend_error("Couldn't load this game's achievements.", e),
            }

        self._save_friend_game_payload(user, selected_game_id, payload)
        return {"payload": payload}

    def get_friend_game_progress(self, web_api_key: str, user: str, game_id=None, force: bool = False) -> dict:
        selected_game_id = norm_game_id(game_id)
        friend_cache = self._resolve_friend_game_entry(user) or {}
        now = int(time.time())

        cached_selected_id = norm_game_id(friend_cache.get("selectedGameId"))
        cached_refreshed_at = to_int(friend_cache.get("refreshedAt"), 0)
        if not force and friend_cache and cached_selected_id == selected_game_id and (now - cached_refreshed_at) < self._friend_game_cache_max_age_seconds:
            return {"needsSettings": False, "payload": friend_cache, "changed": False}

        try:
            profile = self._ra.get_user_profile(user, web_api_key)
            display_name = str(profile.get("User") or profile.get("user") or user).strip()
            profile_ulid = profile.get("ULID", profile.get("ulid"))
            rich_presence = str(profile.get("RichPresenceMsg", profile.get("richPresenceMsg")) or "").strip()
            status_text = rich_presence or "No rich presence"

            profile_points = {
                "points": to_int(profile.get("TotalPoints", profile.get("totalPoints", 0)), 0),
                "pointsSoftcore": to_int(profile.get("TotalSoftcorePoints", profile.get("totalSoftcorePoints", 0)), 0),
                "totalTruePoints": to_int(profile.get("TotalTruePoints", profile.get("totalTruePoints", 0)), 0),
            }

            member_since = str(profile.get("MemberSince", profile.get("memberSince", "")) or "").strip()
            motto = str(profile.get("Motto", profile.get("motto", "")) or "").strip()

            if selected_game_id is None:
                selected_game_id = norm_game_id(profile.get("LastGameID", profile.get("lastGameId")))

            recent_games_raw = self._ra.get_user_recently_played_games(user, web_api_key, count=self._recent_games_count)
            recent_games = self._normalize_recent_games(recent_games_raw)

            if not selected_game_id and recent_games:
                selected_game_id = norm_game_id(recent_games[0].get("gameId"))

            payload = None
            if selected_game_id:
                game = self._ra.get_game_info_and_user_progress(user, selected_game_id, web_api_key)
                payload = self._current_game_service.normalize_game_payload(game, fallback_game_id=selected_game_id)

            response_payload = self._build_friend_game_payload(
                display_name,
                selected_game_id,
                recent_games,
                payload,
                rich_presence=rich_presence,
                status_text=status_text,
                profile_points=profile_points,
                ulid=profile_ulid,
                member_since=member_since,
                motto=motto,
            )

            write_key = self._friend_game_key(profile_ulid, display_name)

            with self._cache_store.friend_game_lock(write_key):
                self._cache_store.save_friend_game(write_key, response_payload)
            return {"needsSettings": False, "payload": response_payload, "changed": True}
        except Exception as e:
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't reach RetroAchievements while loading this friend's progress.", e),
                "payload": friend_cache or None,
                "changed": False,
            }

    def get_cached_friend_game(self, user, game_id=None):
        ref = str(user or "").strip()
        if not ref:
            return None
        target_game_id = norm_game_id(game_id)
        entry = self._resolve_friend_game_entry(ref)

        if isinstance(entry, dict) and (
            target_game_id is None or norm_game_id(entry.get("selectedGameId")) == target_game_id
        ):
            return entry

        pair_entry = self._resolve_friend_game_payload(ref, target_game_id)
        if not pair_entry:
            return None

        is_ulid = bool(_ULID_RE.match(ref.upper()))
        return {
            "friendUsername": "" if is_ulid else ref,
            "ulid": ref if is_ulid else None,
            "selectedGameId": target_game_id,
            "recentGames": [],
            "payload": pair_entry.get("payload"),
            "refreshedAt": pair_entry.get("refreshedAt"),
        }

    def _parse_retry_after(self, value):
        try:
            return float(int(str(value).strip()))
        except (TypeError, ValueError):
            return None

    def _fetch_completion_page_with_backoff(self, user, web_api_key, count, offset):
        delays = (1.0, 2.0, 4.0)
        attempt = 0
        while True:
            try:
                return self._ra.get_user_completion_progress(user, web_api_key, count=count, offset=offset)
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt >= len(delays):
                    raise
                wait = self._parse_retry_after(e.headers.get("Retry-After") if e.headers else None)
                if wait is None:
                    wait = delays[attempt]
                time.sleep(min(wait, 10.0))
                attempt += 1

    def get_friend_all_games_full(self, web_api_key: str, user: str, ulid: str = "", page_size: int = 500) -> dict:
        query = str(ulid or "").strip() or user
        try:
            raw_rows = []
            offset = 0
            total = None
            while True:
                raw = self._fetch_completion_page_with_backoff(query, web_api_key, page_size, offset)
                page_rows = raw.get("Results", raw.get("results", [])) or []
                raw_rows.extend(page_rows)
                if total is None:
                    total = to_int(raw.get("Total", raw.get("total", len(page_rows))), len(page_rows))
                got = len(page_rows)
                offset += got
                if got <= 0 or (total is not None and offset >= total):
                    break
            payload = self.build_friend_all_games_payload(user, raw_rows, total=total)
            return {"needsSettings": False, "payload": payload, "error": None, "changed": True}
        except Exception as e:
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't load this friend's full game list.", e),
                "payload": None,
                "changed": False,
            }

    def get_user_want_to_play(self, web_api_key: str, user: str, offset: int = 0, count: int = 500) -> dict:
        try:
            debug = self._debug_logging_on()
            started = time.perf_counter() if debug else 0.0
            wtp_started = started
            try:
                raw_wtp = self._ra.get_user_want_to_play_list(user, web_api_key, count=count, offset=offset)
            except urllib.error.HTTPError as e:
                if e.code not in (401, 403, 404):
                    raise
                if debug:
                    decky.logger.info(
                        "wtp: list not visible user=%s code=%s -> empty",
                        user,
                        e.code,
                    )
                empty_payload = self._normalize_user_want_to_play(
                    user, {}, None, offset=offset, count=count
                )
                return {"needsSettings": False, "payload": empty_payload, "changed": True}
            if debug:
                decky.logger.info(
                    "wtp: list call done user=%s ms=%d shape=%s",
                    user,
                    int((time.perf_counter() - wtp_started) * 1000),
                    type(raw_wtp).__name__,
                )
            progress_started = time.perf_counter() if debug else 0.0
            try:
                raw_progress = self._ra.get_user_completion_progress(user, web_api_key, count=500, offset=0)
                if debug:
                    decky.logger.info(
                        "wtp: progress call done user=%s ms=%d",
                        user,
                        int((time.perf_counter() - progress_started) * 1000),
                    )
            except Exception as e:
                raw_progress = None
                if debug:
                    decky.logger.info(
                        "wtp: progress call failed user=%s ms=%d err=%s",
                        user,
                        int((time.perf_counter() - progress_started) * 1000),
                        type(e).__name__,
                    )
            payload = self._normalize_user_want_to_play(
                user, raw_wtp, raw_progress, offset=offset, count=count
            )
            if debug:
                decky.logger.info(
                    "wtp: returning payload user=%s results=%d total=%s total_ms=%d",
                    user,
                    len(payload.get("results", [])),
                    payload.get("total"),
                    int((time.perf_counter() - started) * 1000),
                )
            return {"needsSettings": False, "payload": payload, "changed": True}
        except Exception as e:
            if self._debug_logging_on():
                decky.logger.info(
                    "wtp: returning error user=%s err=%s code=%s",
                    user,
                    type(e).__name__,
                    getattr(e, "code", None),
                )
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't load this user's want-to-play list.", e),
                "payload": None,
                "changed": False,
            }

    def get_user_awards(self, web_api_key: str, user: str, ulid: str = "") -> dict:
        query = str(ulid or "").strip() or user
        try:
            raw = self._ra.get_user_awards(query, web_api_key)
            payload = self._normalize_user_awards(user, raw)
            return {"needsSettings": False, "payload": payload, "changed": True}
        except Exception as e:
            return {
                "needsSettings": False,
                "error": frontend_error("Couldn't load this user's badge collection.", e),
                "payload": None,
                "changed": False,
            }
