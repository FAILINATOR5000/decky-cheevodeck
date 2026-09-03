"""
HTTP client for the RetroAchievements public API.

This started out as RetroAchievementsApiMixin, but the methods here don't
share any state with the rest of the plugin, they just need an SSL context.
A plain client class makes that dependency obvious and lets each feature
module call self.ra.get_user_profile(...) instead of reaching into an
inherited mixin.

Every method is synchronous and can raise urllib.error.URLError (or one of
its subclasses) when the network is down. Callers catch that and turn it
into a friendly message through friendly_network_error.
"""

import json
import ssl
import threading
import urllib.parse
import urllib.request
from typing import Any, Optional

from utils import to_int
from decky import DECKY_PLUGIN_NAME, DECKY_PLUGIN_VERSION


DEFAULT_FRIENDS_PAGE_SIZE = 500
DEFAULT_RECENT_GAMES_COUNT = 25


def build_user_agent() -> str:
    app_name = DECKY_PLUGIN_NAME.strip().lower().replace(" ", "-")
    return f"{app_name}/{DECKY_PLUGIN_VERSION}"


class RetroAchievementsClient:
    """Thin wrapper around the RetroAchievements REST API.

    Each method maps to a single upstream endpoint. The client does no
    caching and no retrying; that's the calling service's job.
    """

    _BASE_URL = "https://retroachievements.org/API"
    _USER_AGENT = build_user_agent()
    _TIMEOUT_SECONDS = 15

    _CONNECT_URL = "https://retroachievements.org/dorequest.php"

    def __init__(self, ssl_context: ssl.SSLContext):
        self._ssl_context = ssl_context
        self._profile_call_lock = threading.Lock()

    def _get_json(self, endpoint: str, params: dict, timeout: Optional[float] = None) -> Any:
        query = urllib.parse.urlencode(params)
        url = f"{self._BASE_URL}/{endpoint}?{query}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": self._USER_AGENT,
                "Accept": "application/json",
            },
        )
        effective_timeout = timeout if timeout is not None else self._TIMEOUT_SECONDS
        with urllib.request.urlopen(req, timeout=effective_timeout, context=self._ssl_context) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def get_image_bytes(self, url: str) -> tuple[bytes, str]:
        """Fetch arbitrary image bytes (badges, avatars, game art).

        Returns (raw_bytes, content_type). content_type comes back as
        "application/octet-stream" if the server didn't set one.
        """
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": self._USER_AGENT,
                "Accept": "image/*,*/*;q=0.8",
            },
        )
        with urllib.request.urlopen(req, timeout=self._TIMEOUT_SECONDS, context=self._ssl_context) as resp:
            return resp.read(), resp.headers.get_content_type()

    def get_rss_text(self, url: str) -> str:
        """Fetch an RSS feed as a decoded UTF-8 string.

        Separate from _get_json because the news feed is XML, not JSON, and
        separate from get_image_bytes because we want text out, not bytes.
        Same SSL context and User-Agent as the rest of our outgoing traffic,
        so RA sees one consistent caller.
        """
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": self._USER_AGENT,
                "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.5",
            },
        )
        with urllib.request.urlopen(req, timeout=self._TIMEOUT_SECONDS, context=self._ssl_context) as resp:
            return resp.read().decode("utf-8")

    def get_user_profile(self, username: str, web_api_key: str) -> Any:
        with self._profile_call_lock:
            return self._get_json(
                "API_GetUserProfile.php",
                {
                    "u": username,
                    "y": web_api_key,
                },
            )

    def get_users_i_follow(
        self,
        web_api_key: str,
        offset: int = 0,
        count: Optional[int] = None,
    ) -> Any:
        return self._get_json(
            "API_GetUsersIFollow.php",
            {
                "y": web_api_key,
                "o": to_int(offset, 0),
                "c": to_int(count, DEFAULT_FRIENDS_PAGE_SIZE),
            },
        )

    def get_recent_achievements(
        self,
        username: str,
        web_api_key: str,
        minutes: Optional[int] = None,
        timeout: Optional[float] = None,
    ) -> Any:
        params: dict[str, Any] = {
            "u": username,
            "y": web_api_key,
        }
        if minutes is not None:
            params["m"] = minutes
        return self._get_json("API_GetUserRecentAchievements.php", params, timeout=timeout)

    def get_user_recently_played_games(
        self,
        username: str,
        web_api_key: str,
        count: Optional[int] = None,
        offset: int = 0,
        timeout: Optional[float] = None,
    ) -> Any:
        return self._get_json(
            "API_GetUserRecentlyPlayedGames.php",
            {
                "u": username,
                "y": web_api_key,
                "c": to_int(count, DEFAULT_RECENT_GAMES_COUNT),
                "o": to_int(offset, 0),
            },
            timeout=timeout,
        )

    def get_user_completion_progress(
        self,
        username: str,
        web_api_key: str,
        count: int = 100,
        offset: int = 0,
    ) -> Any:
        return self._get_json(
            "API_GetUserCompletionProgress.php",
            {
                "u": username,
                "y": web_api_key,
                "c": to_int(count, 100),
                "o": to_int(offset, 0),
            },
        )

    def get_user_want_to_play_list(
        self,
        username: str,
        web_api_key: str,
        count: int = 100,
        offset: int = 0,
    ) -> Any:
        return self._get_json(
            "API_GetUserWantToPlayList.php",
            {
                "u": username,
                "y": web_api_key,
                "c": to_int(count, 100),
                "o": to_int(offset, 0),
            },
        )

    def get_game_info_and_user_progress(
        self,
        username: str,
        game_id: int,
        web_api_key: str,
        timeout: Optional[float] = None,
    ) -> Any:
        return self._get_json(
            "API_GetGameInfoAndUserProgress.php",
            {
                "u": username,
                "g": game_id,
                "y": web_api_key,
                "a": 1,
            },
            timeout=timeout,
        )

    def get_game(self, game_id, web_api_key: str) -> Any:
        return self._get_json(
            "API_GetGame.php",
            {
                "i": game_id,
                "y": web_api_key,
            },
        )

    def get_console_ids(self, web_api_key: str) -> Any:
        return self._get_json(
            "API_GetConsoleIDs.php",
            {
                "y": web_api_key,
            },
        )

    def get_game_list(self, console_id: int, web_api_key: str) -> Any:
        return self._get_json(
            "API_GetGameList.php",
            {
                "i": console_id,
                "y": web_api_key,
                "f": 1,
            },
        )

    def get_game_list_with_hashes(self, console_id: int, web_api_key: str) -> Any:
        return self._get_json(
            "API_GetGameList.php",
            {
                "i": console_id,
                "y": web_api_key,
                "h": 1,
            },
        )

    _LEADERBOARD_MAX_COUNT = 500

    def _clamp_count(self, count: Any, default: int) -> int:
        return min(self._LEADERBOARD_MAX_COUNT, max(1, to_int(count, default)))

    def get_game_leaderboards(
        self,
        game_id: int,
        web_api_key: str,
        count: int = 500,
        offset: int = 0,
    ) -> Any:
        return self._get_json(
            "API_GetGameLeaderboards.php",
            {
                "i": game_id,
                "y": web_api_key,
                "c": self._clamp_count(count, 500),
                "o": max(0, to_int(offset, 0)),
            },
        )

    def get_leaderboard_entries(
        self,
        leaderboard_id: int,
        web_api_key: str,
        count: int = 25,
        offset: int = 0,
    ) -> Any:
        return self._get_json(
            "API_GetLeaderboardEntries.php",
            {
                "i": leaderboard_id,
                "y": web_api_key,
                "c": self._clamp_count(count, 25),
                "o": max(0, to_int(offset, 0)),
            },
        )

    def get_user_game_leaderboards(
        self,
        user: str,
        game_id: int,
        web_api_key: str,
        count: int = 500,
        offset: int = 0,
    ) -> Any:
        return self._get_json(
            "API_GetUserGameLeaderboards.php",
            {
                "u": user,
                "i": game_id,
                "y": web_api_key,
                "c": self._clamp_count(count, 500),
                "o": max(0, to_int(offset, 0)),
            },
        )

    def get_user_awards(self, username: str, web_api_key: str) -> Any:
        return self._get_json(
            "API_GetUserAwards.php",
            {
                "u": username,
                "y": web_api_key,
            },
        )

    def get_achievement_of_the_week(self, web_api_key: str) -> Any:
        return self._get_json(
            "API_GetAchievementOfTheWeek.php",
            {
                "y": web_api_key,
            },
        )

    def get_completed_claims(self, web_api_key: str) -> Any:
        return self._get_json(
            "API_GetClaims.php",
            {
                "k": 1,
                "y": web_api_key,
            },
        )

    def get_comments(
        self,
        web_api_key: str,
        target_id,
        kind: str = "achievement",
        count: int = 20,
        offset: int = 0,
        sort: str = "-submitted",
    ) -> Any:
        kind_codes = {"game": 1, "achievement": 2, "user": 3}
        return self._get_json(
            "API_GetComments.php",
            {
                "t": kind_codes.get(kind, 2),
                "i": target_id,
                "y": web_api_key,
                "c": self._clamp_count(count, 20),
                "o": max(0, to_int(offset, 0)),
                "sort": sort,
            },
        )

    def get_achievement_unlocks(
        self,
        achievement_id,
        web_api_key: str,
        count: int = 10,
        offset: int = 0,
        timeout: Optional[float] = None,
    ) -> Any:
        return self._get_json(
            "API_GetAchievementUnlocks.php",
            {
                "a": achievement_id,
                "y": web_api_key,
                "c": self._clamp_count(count, 10),
                "o": max(0, to_int(offset, 0)),
            },
            timeout=timeout,
        )

    def get_game_hashes(self, game_id, web_api_key: str) -> Any:
        return self._get_json(
            "API_GetGameHashes.php",
            {
                "i": game_id,
                "y": web_api_key,
            },
        )

    def fetch_connect_token(self, username: str, password: str) -> str:
        """Mint a RetroAchievements Connect token from a username + password.

        Returns the raw token string on success. The password rides in the
        POST body, never the query string, so it can't leak into any URL that
        gets logged, and nothing here holds onto it past the call.

        Takes no RA semaphore slot of its own. This is one user-initiated RA
        call, so the caller in main.py wraps the whole task in a single
        _ra_slot() the same way add_user's validation does; taking a slot
        here too would double-count it.

        A rejected login comes back as HTTP 200 with
        {"Success": false, "Error": "..."}, and we raise RuntimeError carrying
        RA's own Error text so the modal can show the user exactly why. A real
        network failure surfaces as the urllib error it already is, which
        is_network_error then tells apart from a credential rejection at the
        callable boundary, the same split friendly_network_error relies on
        elsewhere.
        """
        body = urllib.parse.urlencode(
            {
                "u": username,
                "p": password,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self._CONNECT_URL}?r=login2",
            data=body,
            headers={
                "User-Agent": self._USER_AGENT,
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method="POST",
        )
        with urllib.request.urlopen(
            request,
            timeout=self._TIMEOUT_SECONDS,
            context=self._ssl_context,
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))

        if not isinstance(payload, dict) or not payload.get("Success"):
            message = ""
            if isinstance(payload, dict):
                message = str(payload.get("Error") or "").strip()
            raise RuntimeError(message or "RetroAchievements rejected the login.")

        token = str(payload.get("Token") or "").strip()
        if not token:
            raise RuntimeError("RetroAchievements returned no token.")
        return token
