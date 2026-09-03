import asyncio

import decky
import steam_shortcuts

from mixins._context import PluginContext
from utils import is_network_error, to_int


PROGRESS_TIMEOUT_SECONDS = 5.0


class LibraryBadgeMixin(PluginContext):
    """IPC for the RA badge on Steam's own library page.

    Two calls with deliberately different costs. Identity is local: read the
    shortcut out of Steam's file, work out which ROM it launches, and look that
    up in the last Cheevo Check scan. Progress is one RA call.
    """

    async def save_library_badge(self, value: bool):
        return {
            "ok": True,
            "libraryBadge": self.settings_store.update_library_badge(value),
        }

    async def get_library_badge_identity(self, app_id):
        """Which RA game this non-Steam shortcut is, from disk alone.

        No _ra_slot(). Adding one looks like consistency with the rest of the
        plugin and is a regression: this reads local files only, and taking a
        slot would queue the badge behind whatever RA work is in flight — a
        running Cheevo Check scan's fetches included — for a question that never
        touches the network.
        """
        return await asyncio.to_thread(self._library_badge_identity_sync, app_id)

    def _library_badge_identity_sync(self, app_id):
        try:
            candidates = steam_shortcuts.rom_candidates_for_app(app_id, self.user_home)
        except Exception:
            candidates = []
        if not candidates:
            return {}
        found = self.cheevo_check_service.identify(candidates)
        if not found:
            return {}

        cfg = self.settings_store.load_config()
        found["activeUlid"] = str(cfg.get("activeUlid") or "").strip()
        return found

    async def get_library_badge_progress(self, game_id):
        """How far through that set the signed-in user is.

        No _ra_slot(), deliberately, against the usual rule — Jameson's call,
        2026-09-03. Adding one back looks like consistency and is what breaks it.

        Players Near You holds a slot for ~15s at a time, so a badge queued behind
        it misses any sane deadline and shows a bare count instead of a fraction,
        which reads as the feature being broken. wait_for_game_check=False would
        not have helped; the block is the semaphore, not the gate in front of it.

        The rate is what makes it safe: one call per page view, and a page view is
        somebody physically opening a game, so it cannot burst.
        """
        return await asyncio.to_thread(self._library_badge_progress_sync, game_id)

    def _library_badge_progress_sync(self, game_id):
        wanted = to_int(game_id, 0)
        if not wanted:
            return {}

        cfg = self.settings_store.ensure_display_settings(self.settings_store.load_config())
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        username = self._active_ra_user(cfg)
        if not web_api_key or not username:
            return {}

        try:
            game = self.ra.get_game_info_and_user_progress(
                username,
                wanted,
                web_api_key,
                timeout=PROGRESS_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            if is_network_error(exc):
                if getattr(self, "_debug_logging", False):
                    decky.logger.info(
                        "library badge: RA unreachable for game %s (%s)", wanted, exc
                    )
            else:
                decky.logger.error(
                    "library badge: progress for game %s failed (%s: %s)",
                    wanted, type(exc).__name__, exc,
                )
            return {}
        if not isinstance(game, dict):
            return {}

        return {
            "gameId": wanted,
            "earned": to_int(game.get("NumAwardedToUser", game.get("numAwardedToUser", 0)), 0),
            "total": to_int(game.get("NumAchievements", game.get("numAchievements", 0)), 0),
        }
