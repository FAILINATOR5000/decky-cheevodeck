from utils import norm_game_id

from mixins._context import PluginContext


class TrackedAchievementsMixin(PluginContext):

    async def save_show_tracked_notes_main(self, show_tracked_notes_main: bool):
        value = self.settings_store.update_show_tracked_notes_main(show_tracked_notes_main)

        return {
            "ok": True,
            "showTrackedNotesMain": value,
        }

    async def save_tracked_color(self, tracked_color: str):
        value = self.settings_store.update_tracked_color(tracked_color)

        return {
            "ok": True,
            "trackedColor": value,
        }

    async def save_show_a_button_mode_tracked(self, show_a_button_mode_tracked: bool):
        value = self.settings_store.update_show_a_button_mode_tracked(show_a_button_mode_tracked)

        return {
            "ok": True,
            "showAButtonModeTracked": value,
        }

    async def save_tracked_achievement_action(self, tracked_achievement_action: str):
        value = self.settings_store.update_tracked_achievement_action(tracked_achievement_action)

        return {
            "ok": True,
            "trackedAchievementAction": value,
        }

    async def get_tracked_achievements(self, game_id=None):
        game_id_int = norm_game_id(game_id)
        tracked = self.settings_store.load_tracked_for_game(game_id_int)
        return {
            "gameId": game_id_int,
            "viewOpen": bool(tracked.get("viewOpen", False)),
            "achievementIds": list(tracked.get("achievementIds", [])),
            "notes": dict(tracked.get("notes", {}) or {}),
            "notesColor": dict(tracked.get("notesColor", {}) or {}),
            "sort": str(tracked.get("sort", "upNext")),
        }

    async def toggle_tracked_achievement(self, game_id=None, achievement_id=None,
                                         title=None, console_name=None, image_icon=None):
        return self.settings_store.toggle_tracked_achievement(
            game_id, achievement_id,
            title=title,
            console_name=console_name,
            image_icon=image_icon,
        )

    async def bulk_toggle_tracked(self, game_id=None, achievement_ids=None, action="track",
                                  title=None, console_name=None, image_icon=None):
        return self.settings_store.bulk_toggle_tracked(
            game_id,
            achievement_ids or [],
            action,
            title=title,
            console_name=console_name,
            image_icon=image_icon,
        )

    async def save_tracked_note(self, game_id=None, achievement_id=None, note: str = "", color: str | None = None):
        return self.settings_store.save_tracked_note(game_id, achievement_id, note, color=color)

    async def save_tracked_sort_for_game(self, game_id=None, sort: str = "upNext"):
        return self.settings_store.save_tracked_sort_for_game(game_id, sort)

    async def clear_tracked_achievements(self, game_id=None):
        game_id_int = norm_game_id(game_id)
        cleared = self.settings_store.clear_tracked_for_game(game_id_int)
        total = self.settings_store.get_total_tracked_count()
        return {
            "ok": bool(cleared.get("ok", False)),
            "gameId": game_id_int,
            "cleared": int(cleared.get("cleared", 0)),
            "totalTrackedCount": total,
        }

    async def clear_all_tracked_achievements(self):
        cleared = self.settings_store.clear_all_tracked()
        return {
            "ok": bool(cleared.get("ok", False)),
            "cleared": int(cleared.get("cleared", 0)),
            "totalTrackedCount": 0,
        }

    async def get_total_tracked_count(self):
        total = self.settings_store.get_total_tracked_count()
        return {
            "ok": True,
            "totalTrackedCount": total,
        }

    async def get_all_tracked_games(self):
        games = self.settings_store.get_all_tracked_games()
        return {
            "ok": True,
            "games": games,
        }

    async def get_recent_tags_for_game(self, game_id=None):
        tags = self.settings_store.get_recent_tags_for_game(game_id)
        return {
            "ok": True,
            "recentTags": tags,
        }
