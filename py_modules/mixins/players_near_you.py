from players_near_you_store import PLAYERS_NEAR_YOU_DEFAULT_MODE, normalise_mode
from utils import frontend_error, norm_game_id

from mixins._context import PluginContext


class PlayersNearYouMixin(PluginContext):

    async def save_players_near_you_enabled(self, value: bool):
        return {
            "ok": True,
            "playersNearYouEnabled": self.settings_store.update_players_near_you_enabled(value),
        }

    async def save_players_near_you_lookbehind(self, value: int):
        return {
            "ok": True,
            "playersNearYouLookbehind": self.settings_store.update_players_near_you_lookbehind(value),
        }

    async def save_players_near_you_lookahead(self, value: int):
        return {
            "ok": True,
            "playersNearYouLookahead": self.settings_store.update_players_near_you_lookahead(value),
        }

    async def save_players_near_you_mode(self, game_id, value: str):
        normalised_game_id = norm_game_id(game_id)
        if normalised_game_id is None:
            return {"ok": False, "mode": None}
        stored = self.players_near_you_store.set_mode_for_game(normalised_game_id, value)
        return {
            "ok": stored is not None,
            "mode": stored,
        }

    async def save_players_near_you_min_tick_minutes(self, value: int):
        value = self.settings_store.update_players_near_you_min_tick_minutes(value)
        self.players_near_you_service.wake_for_reschedule()
        return {
            "ok": True,
            "playersNearYouMinTickMinutes": value,
        }

    async def save_players_near_you_max_tick_minutes(self, value: int):
        value = self.settings_store.update_players_near_you_max_tick_minutes(value)
        self.players_near_you_service.wake_for_reschedule()
        return {
            "ok": True,
            "playersNearYouMaxTickMinutes": value,
        }

    async def save_players_near_you_tap_mode(self, value: str):
        return {
            "ok": True,
            "playersNearYouTapMode": self.settings_store.update_players_near_you_tap_mode(value),
        }

    async def save_players_near_you_collapsed(self, value: bool):
        return {
            "ok": True,
            "playersNearYouCollapsed": self.settings_store.update_players_near_you_collapsed(value),
        }

    async def get_players_near_you(self, game_id=None):
        normalised_game_id = norm_game_id(game_id)
        if normalised_game_id is None:
            return {"items": [], "lastRefreshAt": None, "mode": PLAYERS_NEAR_YOU_DEFAULT_MODE}
        try:
            cache = self.players_near_you_store.load_for_game(normalised_game_id)
        except Exception as e:
            return {
                "error": frontend_error("Couldn't load Players Near You right now.", e),
                "items": [],
                "lastRefreshAt": None,
                "mode": PLAYERS_NEAR_YOU_DEFAULT_MODE,
            }
        if not isinstance(cache, dict):
            cache = {}
        items = cache.get("items")
        if not isinstance(items, list):
            items = []
        return {
            "items": items,
            "lastRefreshAt": cache.get("lastRefreshAt"),
            "mode": normalise_mode(cache.get("mode")),
        }
