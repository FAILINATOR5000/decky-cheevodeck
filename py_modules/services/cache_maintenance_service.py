import time

import decky

from guides_store import CACHE_SWEEP_AGE_SECONDS as GUIDE_CACHE_SWEEP_AGE_SECONDS
from utils import norm_game_id


class CacheMaintenanceService:
    """One-shot pruning of the on-disk caches that grow without bound.

    Runs once when the plugin loads (kicked off from Plugin._main). The
    actual session is left untouched: caches grow naturally as the user
    plays and get trimmed on the next restart. Sweeping on every write
    would add work to the hot path and force hysteresis math to avoid
    thrashing at the cap; sweeping on load runs once when nothing's
    time-critical and the panel is already spinning up.

    Disk caps are 2x the matching in-memory caps for the same data type
    -- memory holds the hot working set, disk acts as a warm reservoir
    so things that fall out of the in-memory LRU can still be served
    from disk on the next encounter without an RA call.
    """

    def __init__(
        self,
        *,
        cache_store,
        game_icons_dir,
        user_avatars_dir,
        award_icons_dir,
        friend_games_dir,
        friend_game_payloads_dir,
        games_list_cache_dir,
        awards_lists_dir,
        want_to_play_dir,
        runtime_dir,
        games_list_cache_store,
        awards_list_cache_store,
        want_to_play_cache_store,
        game_bundle_disk_limit: int,
        user_avatar_disk_limit: int,
        award_icon_disk_limit: int,
        friend_game_cache_limit: int,
        friend_game_payload_cache_limit: int,
        games_list_cache_disk_limit: int,
        awards_list_cache_disk_limit: int,
        want_to_play_cache_disk_limit: int,
        settings_store,
    ):
        self._cache_store = cache_store
        self._settings_store = settings_store
        self._game_icons_dir = game_icons_dir
        self._user_avatars_dir = user_avatars_dir
        self._award_icons_dir = award_icons_dir
        self._friend_games_dir = friend_games_dir
        self._friend_game_payloads_dir = friend_game_payloads_dir
        self._games_list_cache_dir = games_list_cache_dir
        self._awards_lists_dir = awards_lists_dir
        self._want_to_play_dir = want_to_play_dir
        self._runtime_dir = runtime_dir
        self._games_list_cache_store = games_list_cache_store
        self._awards_list_cache_store = awards_list_cache_store
        self._want_to_play_cache_store = want_to_play_cache_store
        self._game_bundle_disk_limit = game_bundle_disk_limit
        self._user_avatar_disk_limit = user_avatar_disk_limit
        self._award_icon_disk_limit = award_icon_disk_limit
        self._friend_game_cache_limit = friend_game_cache_limit
        self._friend_game_payload_cache_limit = friend_game_payload_cache_limit
        self._games_list_cache_disk_limit = games_list_cache_disk_limit
        self._awards_list_cache_disk_limit = awards_list_cache_disk_limit
        self._want_to_play_cache_disk_limit = want_to_play_cache_disk_limit

    def run_startup_sweep(self) -> dict:
        """Walk every disk cache that has a cap and trim back to it.

        Each stage is independently wrapped: a maintenance failure must
        never stop the plugin from starting, and one stage failing must
        not skip the others. Returns a small dict of counts the caller
        can log if it wants.
        """
        pruned_game_bundles = 0
        pruned_user_avatars = 0
        pruned_award_icons = 0
        pruned_friend_games = 0
        pruned_friend_game_payloads = 0
        pruned_games_lists = 0
        pruned_awards_lists = 0
        pruned_want_to_play = 0
        pruned_guide_cache = 0

        try:
            pruned_game_bundles = self._prune_game_bundles()
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: game bundles sweep failed: %s",
                type(e).__name__,
            )

        try:
            pruned_user_avatars = self._prune_user_avatars()
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: user avatars sweep failed: %s",
                type(e).__name__,
            )

        try:
            pruned_award_icons = self._prune_award_icons()
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: award icons sweep failed: %s",
                type(e).__name__,
            )

        try:
            pruned_friend_games = self._prune_friend_games()
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: friend games sweep failed: %s",
                type(e).__name__,
            )

        try:
            pruned_friend_game_payloads = self._prune_ulid_list_dir(
                self._friend_game_payloads_dir,
                self._friend_game_payload_cache_limit,
                self._cache_store.snapshot_active_friend_game_payload_keys(),
                "friend game payloads",
            )
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: friend game payloads sweep failed: %s",
                type(e).__name__,
            )

        try:
            pruned_games_lists = self._prune_ulid_list_dir(
                self._games_list_cache_dir,
                self._games_list_cache_disk_limit,
                self._games_list_cache_store.snapshot_active_keys(),
                "games lists",
            )
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: games lists sweep failed: %s",
                type(e).__name__,
            )

        try:
            pruned_awards_lists = self._prune_ulid_list_dir(
                self._awards_lists_dir,
                self._awards_list_cache_disk_limit,
                self._awards_list_cache_store.snapshot_active_keys(),
                "awards lists",
            )
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: awards lists sweep failed: %s",
                type(e).__name__,
            )

        try:
            pruned_want_to_play = self._prune_ulid_list_dir(
                self._want_to_play_dir,
                self._want_to_play_cache_disk_limit,
                self._want_to_play_cache_store.snapshot_active_keys(),
                "want to play lists",
            )
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: want to play lists sweep failed: %s",
                type(e).__name__,
            )

        try:
            pruned_guide_cache = self._prune_expired_guide_cache()
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: guide cache sweep failed: %s",
                type(e).__name__,
            )

        return {
            "prunedGameBundles": pruned_game_bundles,
            "prunedUserAvatars": pruned_user_avatars,
            "prunedAwardIcons": pruned_award_icons,
            "prunedFriendGames": pruned_friend_games,
            "prunedFriendGamePayloads": pruned_friend_game_payloads,
            "prunedGamesLists": pruned_games_lists,
            "prunedAwardsLists": pruned_awards_lists,
            "prunedWantToPlayLists": pruned_want_to_play,
            "prunedGuideCache": pruned_guide_cache,
        }

    def _stat_sorted_newest_first(self, files) -> list:
        dated = []
        for path in files:
            try:
                dated.append((path, path.stat().st_mtime))
            except FileNotFoundError:
                continue
        dated.sort(key=lambda pair: pair[1], reverse=True)
        return [path for path, _ in dated]

    def _prune_game_bundles(self) -> int:
        if not self._game_icons_dir.exists():
            return 0

        files = [
            entry for entry in self._game_icons_dir.iterdir()
            if entry.is_file() and entry.suffix == ".json"
        ]
        if len(files) <= self._game_bundle_disk_limit:
            return 0

        active_ids = self._cache_store.snapshot_active_game_bundle_ids()

        ordered = self._stat_sorted_newest_first(files)
        candidates = ordered[self._game_bundle_disk_limit:]

        pruned = 0
        skipped_active = 0
        for path in candidates:
            game_id_int = norm_game_id(path.stem)
            if game_id_int is not None and game_id_int in active_ids:
                skipped_active += 1
                continue
            try:
                path.unlink()
                pruned += 1
            except FileNotFoundError:
                pass

        if pruned > 0:
            decky.logger.info(
                "cache_maintenance: pruned %d game bundles (kept %d, skipped %d active)",
                pruned,
                self._game_bundle_disk_limit,
                skipped_active,
            )

        return pruned

    def _prune_user_avatars(self) -> int:
        if not self._user_avatars_dir.exists():
            return 0

        files = [
            entry for entry in self._user_avatars_dir.iterdir()
            if entry.is_file() and entry.suffix == ".json"
        ]
        if len(files) <= self._user_avatar_disk_limit:
            return 0

        active_keys = self._cache_store.snapshot_active_user_avatar_keys()

        ordered = self._stat_sorted_newest_first(files)
        candidates = ordered[self._user_avatar_disk_limit:]

        pruned = 0
        skipped_active = 0
        for path in candidates:
            if path.stem in active_keys:
                skipped_active += 1
                continue
            try:
                path.unlink()
                pruned += 1
            except FileNotFoundError:
                pass

        if pruned > 0:
            decky.logger.info(
                "cache_maintenance: pruned %d user avatars (kept %d, skipped %d active)",
                pruned,
                self._user_avatar_disk_limit,
                skipped_active,
            )

        return pruned

    def _prune_award_icons(self) -> int:
        if not self._award_icons_dir.exists():
            return 0

        files = [
            entry for entry in self._award_icons_dir.iterdir()
            if entry.is_file() and entry.suffix == ".json"
        ]
        if len(files) <= self._award_icon_disk_limit:
            return 0

        active_keys = self._cache_store.snapshot_active_award_icon_keys()

        ordered = self._stat_sorted_newest_first(files)
        candidates = ordered[self._award_icon_disk_limit:]

        pruned = 0
        skipped_active = 0
        for path in candidates:
            if path.stem in active_keys:
                skipped_active += 1
                continue
            try:
                path.unlink()
                pruned += 1
            except FileNotFoundError:
                pass

        if pruned > 0:
            decky.logger.info(
                "cache_maintenance: pruned %d award icons (kept %d, skipped %d active)",
                pruned,
                self._award_icon_disk_limit,
                skipped_active,
            )

        return pruned

    def _prune_friend_games(self) -> int:
        if not self._friend_games_dir.exists():
            return 0

        files = [
            entry for entry in self._friend_games_dir.iterdir()
            if entry.is_file() and entry.suffix == ".json"
        ]
        if len(files) <= self._friend_game_cache_limit:
            return 0

        active_keys = self._cache_store.snapshot_active_friend_game_keys()

        ordered = self._stat_sorted_newest_first(files)
        candidates = ordered[self._friend_game_cache_limit:]

        pruned = 0
        skipped_active = 0
        for path in candidates:
            if path.stem in active_keys:
                skipped_active += 1
                continue
            try:
                path.unlink()
                pruned += 1
            except FileNotFoundError:
                pass

        if pruned > 0:
            decky.logger.info(
                "cache_maintenance: pruned %d friend games (kept %d, skipped %d active)",
                pruned,
                self._friend_game_cache_limit,
                skipped_active,
            )

        return pruned

    def _prune_expired_guide_cache(self) -> int:
        if not self._runtime_dir.exists():
            return 0

        if self._settings_store.get_keep_guides_offline(self._settings_store.load_config()):
            return 0

        cutoff = time.time() - GUIDE_CACHE_SWEEP_AGE_SECONDS
        pruned = 0
        for path in self._runtime_dir.glob("*/guides/cache/*"):
            try:
                if not path.is_file() or path.stat().st_mtime >= cutoff:
                    continue
                path.unlink()
                pruned += 1
            except FileNotFoundError:
                pass
            except OSError:
                pass

        if pruned > 0:
            decky.logger.info(
                "cache_maintenance: pruned %d expired guide cache files",
                pruned,
            )

        return pruned

    def _prune_ulid_list_dir(self, store_dir, limit: int, active_keys, label: str) -> int:
        if not store_dir.exists():
            return 0

        files = [
            entry for entry in store_dir.iterdir()
            if entry.is_file() and entry.suffix == ".json"
        ]
        if len(files) <= limit:
            return 0

        ordered = self._stat_sorted_newest_first(files)
        candidates = ordered[limit:]

        pruned = 0
        skipped_active = 0
        for path in candidates:
            if path.stem in active_keys:
                skipped_active += 1
                continue
            try:
                path.unlink()
                pruned += 1
            except FileNotFoundError:
                pass

        if pruned > 0:
            decky.logger.info(
                "cache_maintenance: pruned %d %s (kept %d, skipped %d active)",
                pruned,
                label,
                limit,
                skipped_active,
            )

        return pruned
