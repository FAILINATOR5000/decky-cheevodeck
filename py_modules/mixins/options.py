import decky
import cheevo_check_systems as systems

from services.update_checker_service import installed_version

from mixins._context import PluginContext

HELP_DOCUMENTS = {
    "cheevoCheck": "cheevo-check.txt",
    "changelog": "changelog.txt",
    "welcome": "welcome.txt",
}


class OptionsMixin(PluginContext):

    async def save_language(self, language: str):
        value = self.settings_store.update_language(language)

        return {
            "ok": True,
            "language": value,
        }

    async def save_night_mode(self, night_mode: bool):
        value = self.settings_store.update_night_mode(night_mode)

        return {
            "ok": True,
            "nightMode": value,
        }

    async def save_night_mode_brightness(self, brightness: float):
        value = self.settings_store.update_night_mode_brightness(brightness)

        return {
            "ok": True,
            "nightModeBrightness": value,
        }

    async def save_battery_saver(self, battery_saver: bool):
        value = self.settings_store.update_battery_saver(battery_saver)
        decky.logger.info("battery saver turned %s", "ON" if value else "OFF")

        return {
            "ok": True,
            "batterySaver": value,
        }

    async def save_battery_saver_disables_social_activity(self, value: bool):
        value = self.settings_store.update_battery_saver_disables_social_activity(value)

        return {
            "ok": True,
            "batterySaverDisablesSocialActivity": value,
        }

    async def save_battery_saver_disables_comments(self, value: bool):
        value = self.settings_store.update_battery_saver_disables_comments(value)

        return {
            "ok": True,
            "batterySaverDisablesComments": value,
        }

    async def save_battery_saver_disables_friend_avatars(self, value: bool):
        value = self.settings_store.update_battery_saver_disables_friend_avatars(value)

        return {
            "ok": True,
            "batterySaverDisablesFriendAvatars": value,
        }

    async def save_battery_saver_disables_players_near_you(self, value: bool):
        value = self.settings_store.update_battery_saver_disables_players_near_you(value)

        return {
            "ok": True,
            "batterySaverDisablesPlayersNearYou": value,
        }

    async def save_battery_saver_disables_tracked_sets(self, value: bool):
        value = self.settings_store.update_battery_saver_disables_tracked_sets(value)

        return {
            "ok": True,
            "batterySaverDisablesTrackedSets": value,
        }

    async def save_battery_saver_disables_file_watcher(self, value: bool):
        value = self.settings_store.update_battery_saver_disables_file_watcher(value)

        return {
            "ok": True,
            "batterySaverDisablesFileWatcher": value,
        }

    async def save_legacy_achievement_links(self, legacy_achievement_links: bool):
        value = self.settings_store.update_legacy_achievement_links(legacy_achievement_links)

        return {
            "ok": True,
            "legacyAchievementLinks": value,
        }

    async def save_legacy_game_links(self, legacy_game_links: bool):
        value = self.settings_store.update_legacy_game_links(legacy_game_links)

        return {
            "ok": True,
            "legacyGameLinks": value,
        }

    async def save_show_developer_options(self, show_developer_options: bool):
        value = self.settings_store.update_show_developer_options(show_developer_options)

        return {
            "ok": True,
            "showDeveloperOptions": value,
        }

    async def save_auto_purge_service(self, auto_purge_service: bool):
        value = self.settings_store.update_auto_purge_service(auto_purge_service)

        return {
            "ok": True,
            "autoPurgeService": value,
        }

    async def save_debug_logging(self, debug_logging: bool):
        value = self.settings_store.update_debug_logging(debug_logging)

        self._debug_logging = bool(value)

        return {
            "ok": True,
            "debugLogging": value,
        }

    async def save_inject_emulator_login(self, inject_emulator_login: bool):
        value = self.settings_store.update_inject_emulator_login(inject_emulator_login)

        return {
            "ok": True,
            "injectEmulatorLogin": value,
        }

    async def save_ipc_slow_threshold_ms(self, ipc_slow_threshold_ms: int):
        value = self.settings_store.update_ipc_slow_threshold_ms(ipc_slow_threshold_ms)

        self._ipc_slow_threshold_ms = int(value)

        return {
            "ok": True,
            "ipcSlowThresholdMs": value,
        }

    async def save_large_viewport_bonus_enabled(self, large_viewport_bonus_enabled: bool):
        value = self.settings_store.update_large_viewport_bonus_enabled(large_viewport_bonus_enabled)

        return {
            "ok": True,
            "largeViewportBonusEnabled": value,
        }

    async def save_large_viewport_bonus(self, large_viewport_bonus: int):
        value = self.settings_store.update_large_viewport_bonus(large_viewport_bonus)

        return {
            "ok": True,
            "largeViewportBonus": value,
        }

    async def save_parallel_ra_calls(self, parallel_ra_calls: int):
        value = self.settings_store.update_parallel_ra_calls(parallel_ra_calls)

        return {
            "ok": True,
            "parallelRaCalls": value,
        }

    async def save_parallel_cdn_fetches(self, parallel_cdn_fetches: int):
        value = self.settings_store.update_parallel_cdn_fetches(parallel_cdn_fetches)

        return {
            "ok": True,
            "parallelCdnFetches": value,
        }

    async def save_max_icon_workers(self, max_icon_workers: int):
        value = self.settings_store.update_max_icon_workers(max_icon_workers)
        self.icon_service.set_achievement_icon_max_workers(value)

        return {
            "ok": True,
            "maxIconWorkers": value,
        }

    async def save_avatar_workers(self, avatar_workers: int):
        value = self.settings_store.update_avatar_workers(avatar_workers)
        self.icon_service.set_user_avatar_max_workers(value)

        return {
            "ok": True,
            "avatarWorkers": value,
        }

    async def save_game_icon_workers(self, game_icon_workers: int):
        value = self.settings_store.update_game_icon_workers(game_icon_workers)
        self.icon_service.set_game_icon_max_workers(value)

        return {
            "ok": True,
            "gameIconWorkers": value,
        }

    async def save_game_art_cache_cap(self, game_art_cache_cap: int):
        value = self.settings_store.update_game_art_cache_cap(game_art_cache_cap)

        return {
            "ok": True,
            "gameArtCacheCap": value,
        }

    async def save_avatar_cache_cap(self, avatar_cache_cap: int):
        value = self.settings_store.update_avatar_cache_cap(avatar_cache_cap)

        return {
            "ok": True,
            "avatarCacheCap": value,
        }

    async def save_achievement_icon_cache_games(self, achievement_icon_cache_games: int):
        value = self.settings_store.update_achievement_icon_cache_games(achievement_icon_cache_games)

        return {
            "ok": True,
            "achievementIconCacheGames": value,
        }

    async def save_games_list_cache_minutes(self, value: int):
        return {
            "ok": True,
            "gamesListCacheMinutes": self.settings_store.update_games_list_cache_minutes(value),
        }

    async def save_awards_list_cache_minutes(self, value: int):
        return {
            "ok": True,
            "awardsListCacheMinutes": self.settings_store.update_awards_list_cache_minutes(value),
        }

    async def save_want_to_play_cache_minutes(self, value: int):
        return {
            "ok": True,
            "wantToPlayCacheMinutes": self.settings_store.update_want_to_play_cache_minutes(value),
        }

    async def save_big_list_threshold(self, big_list_threshold: int):
        value = self.settings_store.update_big_list_threshold(big_list_threshold)

        return {
            "ok": True,
            "bigListThreshold": value,
        }

    async def save_always_stagger_mounting(self, always_stagger_mounting: bool):
        value = self.settings_store.update_always_stagger_mounting(always_stagger_mounting)

        return {
            "ok": True,
            "alwaysStaggerMounting": value,
        }

    async def save_return_stagger_frames(self, return_stagger_frames: int):
        value = self.settings_store.update_return_stagger_frames(return_stagger_frames)

        return {
            "ok": True,
            "returnStaggerFrames": value,
        }

    async def save_dynamic_loading(self, dynamic_loading: bool):
        value = self.settings_store.update_dynamic_loading(dynamic_loading)

        return {
            "ok": True,
            "dynamicLoading": value,
        }

    async def save_dynamic_initial_rows(self, dynamic_initial_rows: int):
        value = self.settings_store.update_dynamic_initial_rows(dynamic_initial_rows)

        return {
            "ok": True,
            "dynamicInitialRows": value,
        }

    async def save_dynamic_row_step(self, dynamic_row_step: int):
        value = self.settings_store.update_dynamic_row_step(dynamic_row_step)

        return {
            "ok": True,
            "dynamicRowStep": value,
        }

    async def save_dynamic_prefetch_distance(self, dynamic_prefetch_distance: int):
        value = self.settings_store.update_dynamic_prefetch_distance(dynamic_prefetch_distance)

        return {
            "ok": True,
            "dynamicPrefetchDistance": value,
        }

    async def save_dynamic_sentinel_root_margin(self, dynamic_sentinel_root_margin: int):
        value = self.settings_store.update_dynamic_sentinel_root_margin(dynamic_sentinel_root_margin)

        return {
            "ok": True,
            "dynamicSentinelRootMargin": value,
        }

    async def save_dynamic_tracked_list_loading(self, dynamic_tracked_list_loading: bool):
        value = self.settings_store.update_dynamic_tracked_list_loading(dynamic_tracked_list_loading)

        return {
            "ok": True,
            "dynamicTrackedListLoading": value,
        }

    async def save_dynamic_tracked_list_initial_rows(self, dynamic_tracked_list_initial_rows: int):
        value = self.settings_store.update_dynamic_tracked_list_initial_rows(dynamic_tracked_list_initial_rows)

        return {
            "ok": True,
            "dynamicTrackedListInitialRows": value,
        }

    async def save_dynamic_tracked_list_row_step(self, dynamic_tracked_list_row_step: int):
        value = self.settings_store.update_dynamic_tracked_list_row_step(dynamic_tracked_list_row_step)

        return {
            "ok": True,
            "dynamicTrackedListRowStep": value,
        }

    async def save_dynamic_tracked_list_prefetch_distance(self, dynamic_tracked_list_prefetch_distance: int):
        value = self.settings_store.update_dynamic_tracked_list_prefetch_distance(dynamic_tracked_list_prefetch_distance)

        return {
            "ok": True,
            "dynamicTrackedListPrefetchDistance": value,
        }

    async def save_dynamic_tracked_list_sentinel_root_margin(self, dynamic_tracked_list_sentinel_root_margin: int):
        value = self.settings_store.update_dynamic_tracked_list_sentinel_root_margin(dynamic_tracked_list_sentinel_root_margin)

        return {
            "ok": True,
            "dynamicTrackedListSentinelRootMargin": value,
        }

    async def save_dynamic_tracked_sets_list_loading(self, dynamic_tracked_sets_list_loading: bool):
        value = self.settings_store.update_dynamic_tracked_sets_list_loading(dynamic_tracked_sets_list_loading)

        return {
            "ok": True,
            "dynamicTrackedSetsListLoading": value,
        }

    async def save_dynamic_tracked_sets_list_initial_rows(self, dynamic_tracked_sets_list_initial_rows: int):
        value = self.settings_store.update_dynamic_tracked_sets_list_initial_rows(dynamic_tracked_sets_list_initial_rows)

        return {
            "ok": True,
            "dynamicTrackedSetsListInitialRows": value,
        }

    async def save_dynamic_tracked_sets_list_row_step(self, dynamic_tracked_sets_list_row_step: int):
        value = self.settings_store.update_dynamic_tracked_sets_list_row_step(dynamic_tracked_sets_list_row_step)

        return {
            "ok": True,
            "dynamicTrackedSetsListRowStep": value,
        }

    async def save_dynamic_tracked_sets_list_prefetch_distance(self, dynamic_tracked_sets_list_prefetch_distance: int):
        value = self.settings_store.update_dynamic_tracked_sets_list_prefetch_distance(dynamic_tracked_sets_list_prefetch_distance)

        return {
            "ok": True,
            "dynamicTrackedSetsListPrefetchDistance": value,
        }

    async def save_dynamic_tracked_sets_list_sentinel_root_margin(self, dynamic_tracked_sets_list_sentinel_root_margin: int):
        value = self.settings_store.update_dynamic_tracked_sets_list_sentinel_root_margin(dynamic_tracked_sets_list_sentinel_root_margin)

        return {
            "ok": True,
            "dynamicTrackedSetsListSentinelRootMargin": value,
        }

    async def save_dynamic_game_notes_loading(self, dynamic_game_notes_loading: bool):
        value = self.settings_store.update_dynamic_game_notes_loading(dynamic_game_notes_loading)

        return {
            "ok": True,
            "dynamicGameNotesLoading": value,
        }

    async def save_dynamic_game_notes_initial_rows(self, dynamic_game_notes_initial_rows: int):
        value = self.settings_store.update_dynamic_game_notes_initial_rows(dynamic_game_notes_initial_rows)

        return {
            "ok": True,
            "dynamicGameNotesInitialRows": value,
        }

    async def save_dynamic_game_notes_row_step(self, dynamic_game_notes_row_step: int):
        value = self.settings_store.update_dynamic_game_notes_row_step(dynamic_game_notes_row_step)

        return {
            "ok": True,
            "dynamicGameNotesRowStep": value,
        }

    async def save_dynamic_game_notes_prefetch_distance(self, dynamic_game_notes_prefetch_distance: int):
        value = self.settings_store.update_dynamic_game_notes_prefetch_distance(dynamic_game_notes_prefetch_distance)

        return {
            "ok": True,
            "dynamicGameNotesPrefetchDistance": value,
        }

    async def save_dynamic_game_notes_sentinel_root_margin(self, dynamic_game_notes_sentinel_root_margin: int):
        value = self.settings_store.update_dynamic_game_notes_sentinel_root_margin(dynamic_game_notes_sentinel_root_margin)

        return {
            "ok": True,
            "dynamicGameNotesSentinelRootMargin": value,
        }

    async def save_dynamic_comments(self, dynamic_comments: bool):
        value = self.settings_store.update_dynamic_comments(dynamic_comments)

        return {
            "ok": True,
            "dynamicComments": value,
        }

    async def save_dynamic_comments_initial_rows(self, dynamic_comments_initial_rows: int):
        value = self.settings_store.update_dynamic_comments_initial_rows(dynamic_comments_initial_rows)

        return {
            "ok": True,
            "dynamicCommentsInitialRows": value,
        }

    async def save_dynamic_comments_row_step(self, dynamic_comments_row_step: int):
        value = self.settings_store.update_dynamic_comments_row_step(dynamic_comments_row_step)

        return {
            "ok": True,
            "dynamicCommentsRowStep": value,
        }

    async def save_dynamic_comments_sentinel_root_margin(self, dynamic_comments_sentinel_root_margin: int):
        value = self.settings_store.update_dynamic_comments_sentinel_root_margin(dynamic_comments_sentinel_root_margin)

        return {
            "ok": True,
            "dynamicCommentsSentinelRootMargin": value,
        }

    async def save_dynamic_friend_loading(self, dynamic_friend_loading: bool):
        value = self.settings_store.update_dynamic_friend_loading(dynamic_friend_loading)

        return {
            "ok": True,
            "dynamicFriendLoading": value,
        }

    async def save_dynamic_leaderboard_loading(self, dynamic_leaderboard_loading: bool):
        value = self.settings_store.update_dynamic_leaderboard_loading(dynamic_leaderboard_loading)

        return {
            "ok": True,
            "dynamicLeaderboardLoading": value,
        }

    async def save_dynamic_leaderboard_results(self, dynamic_leaderboard_results: bool):
        value = self.settings_store.update_dynamic_leaderboard_results(dynamic_leaderboard_results)

        return {
            "ok": True,
            "dynamicLeaderboardResults": value,
        }

    async def save_dynamic_activity_feed(self, dynamic_activity_feed: bool):
        value = self.settings_store.update_dynamic_activity_feed(dynamic_activity_feed)

        return {
            "ok": True,
            "dynamicActivityFeed": value,
        }

    async def save_dynamic_compare(self, dynamic_compare: bool):
        value = self.settings_store.update_dynamic_compare(dynamic_compare)

        return {
            "ok": True,
            "dynamicCompare": value,
        }

    async def save_dynamic_friend_picker(self, dynamic_friend_picker: bool):
        value = self.settings_store.update_dynamic_friend_picker(dynamic_friend_picker)

        return {
            "ok": True,
            "dynamicFriendPicker": value,
        }

    async def save_dynamic_all_games(self, dynamic_all_games: bool):
        value = self.settings_store.update_dynamic_all_games(dynamic_all_games)

        return {
            "ok": True,
            "dynamicAllGames": value,
        }

    async def save_dynamic_tracked_games(self, dynamic_tracked_games: bool):
        value = self.settings_store.update_dynamic_tracked_games(dynamic_tracked_games)

        return {
            "ok": True,
            "dynamicTrackedGames": value,
        }

    async def save_dynamic_badges(self, dynamic_badges: bool):
        value = self.settings_store.update_dynamic_badges(dynamic_badges)

        return {
            "ok": True,
            "dynamicBadges": value,
        }

    async def save_dynamic_followed_ranking(self, dynamic_followed_ranking: bool):
        value = self.settings_store.update_dynamic_followed_ranking(dynamic_followed_ranking)

        return {
            "ok": True,
            "dynamicFollowedRanking": value,
        }

    async def save_auto_refresh(self, auto_refresh: bool):
        value = self.settings_store.update_auto_refresh(auto_refresh)

        return {
            "ok": True,
            "autoRefresh": value,
        }

    async def save_defer_modal_cleanup(self, defer_modal_cleanup: bool):
        value = self.settings_store.update_defer_modal_cleanup(defer_modal_cleanup)

        return {
            "ok": True,
            "deferModalCleanup": value,
        }

    async def save_legacy_comments_loading(self, legacy_comments_loading: bool):
        value = self.settings_store.update_legacy_comments_loading(legacy_comments_loading)

        return {
            "ok": True,
            "legacyCommentsLoading": value,
        }

    async def save_mouse_keyboard_mode(self, mouse_keyboard_mode: bool):
        value = self.settings_store.update_mouse_keyboard_mode(mouse_keyboard_mode)

        return {
            "ok": True,
            "mouseKeyboardMode": value,
        }

    async def save_colored_glyphs(self, colored_glyphs: bool):
        value = self.settings_store.update_colored_glyphs(colored_glyphs)

        return {
            "ok": True,
            "coloredGlyphs": value,
        }

    async def save_controller_glyph_style(self, controller_glyph_style: str):
        value = self.settings_store.update_controller_glyph_style(controller_glyph_style)

        return {
            "ok": True,
            "controllerGlyphStyle": value,
        }

    async def save_show_social_hub_button(self, show_social_hub_button: bool):
        value = self.settings_store.update_show_social_hub_button(show_social_hub_button)

        return {
            "ok": True,
            "showSocialHubButton": value,
        }

    async def save_show_tracked_sets_button(self, show_tracked_sets_button: bool):
        value = self.settings_store.update_show_tracked_sets_button(show_tracked_sets_button)

        return {
            "ok": True,
            "showTrackedSetsButton": value,
        }

    async def save_put_updater_on_desktop(self, put_updater_on_desktop: bool):
        value = self.settings_store.update_put_updater_on_desktop(put_updater_on_desktop)

        return {
            "ok": True,
            "putUpdaterOnDesktop": value,
        }

    async def save_show_options_button(self, show_options_button: bool):
        value = self.settings_store.update_show_options_button(show_options_button)

        return {
            "ok": True,
            "showOptionsButton": value,
        }

    async def save_quick_menu_shortcuts(self, quick_menu_shortcuts=None):
        value = self.settings_store.update_quick_menu_shortcuts(quick_menu_shortcuts or [])

        return {
            "ok": True,
            "quickMenuShortcuts": value,
        }

    async def save_last_scale_preset(self, last_scale_preset: str):
        value = self.settings_store.update_last_scale_preset(last_scale_preset)

        return {
            "ok": True,
            "lastScalePreset": value,
        }

    async def save_shortcut_binding(self, button: str, action: str):
        value = self.settings_store.update_shortcut_binding(button, action)

        return {
            "ok": True,
            "shortcutBindings": value,
        }

    async def save_remember_last_page(self, remember_last_page: bool):
        value = self.settings_store.update_remember_last_page(remember_last_page)

        return {
            "ok": True,
            "rememberLastPage": value,
        }

    async def save_last_social_view(self, last_social_view: str):
        value = self.settings_store.update_last_social_view(last_social_view)

        return {
            "ok": True,
            "lastSocialView": value,
        }

    async def save_badges_sort_order(self, badges_sort_order: str):
        value = self.settings_store.update_badges_sort_order(badges_sort_order)

        return {
            "ok": True,
            "badgesSortOrder": value,
        }

    async def save_last_console_id(self, last_console_id):
        value = self.settings_store.update_last_console_id(last_console_id)

        return {
            "ok": True,
            "lastConsoleId": value,
        }

    async def get_last_console_id(self):
        return {
            "ok": True,
            "lastConsoleId": self.settings_store.get_last_console_id(),
        }

    async def save_saved_comments_prefs(self, saved_comments_prefs=None):
        value = self.settings_store.update_saved_comments_prefs(saved_comments_prefs or {})

        return {
            "ok": True,
            "savedCommentsPrefs": value,
        }

    async def save_social_entry_default(self, social_entry_default: str):
        value = self.settings_store.update_social_entry_default(social_entry_default)

        return {
            "ok": True,
            "socialEntryDefault": value,
        }

    async def save_activity_card_action(self, activity_card_action: str):
        value = self.settings_store.update_activity_card_action(activity_card_action)

        return {
            "ok": True,
            "activityCardAction": value,
        }

    async def save_friend_feed_card_action(self, friend_feed_card_action: str):
        value = self.settings_store.update_friend_feed_card_action(friend_feed_card_action)

        return {
            "ok": True,
            "friendFeedCardAction": value,
        }

    async def save_social_hub_card_action(self, social_hub_card_action: str):
        value = self.settings_store.update_social_hub_card_action(social_hub_card_action)

        return {
            "ok": True,
            "socialHubCardAction": value,
        }

    async def save_last_options_tab(self, last_options_tab: str):
        value = self.settings_store.update_last_options_tab(last_options_tab)

        return {
            "ok": True,
            "lastOptionsTab": value,
        }

    async def save_last_tracked_tab(self, last_tracked_tab: str):
        value = self.settings_store.update_last_tracked_tab(last_tracked_tab)

        return {
            "ok": True,
            "lastTrackedTab": value,
        }

    async def save_ui_size(self, ui_size: str):
        value = self.settings_store.update_ui_size(ui_size)

        return {
            "ok": True,
            "uiSize": value,
        }

    async def save_achievement_text_scale(self, achievement_text_scale: str):
        value = self.settings_store.update_achievement_text_scale(achievement_text_scale)

        return {
            "ok": True,
            "achievementTextScale": value,
        }

    async def save_comments_text_scale(self, comments_text_scale: str):
        value = self.settings_store.update_comments_text_scale(comments_text_scale)

        return {
            "ok": True,
            "commentsTextScale": value,
        }

    async def save_text_scale(self, text_scale: str):
        value = self.settings_store.update_text_scale(text_scale)

        return {
            "ok": True,
            "textScale": value,
        }

    async def save_title_scale(self, title_scale: str):
        value = self.settings_store.update_title_scale(title_scale)

        return {
            "ok": True,
            "titleScale": value,
        }

    async def save_header_scale(self, header_scale: str):
        value = self.settings_store.update_header_scale(header_scale)

        return {
            "ok": True,
            "headerScale": value,
        }

    async def save_banner_scale(self, banner_scale: str):
        value = self.settings_store.update_banner_scale(banner_scale)

        return {
            "ok": True,
            "bannerScale": value,
        }

    async def save_modal_scale(self, modal_scale: str):
        value = self.settings_store.update_modal_scale(modal_scale)

        return {
            "ok": True,
            "modalScale": value,
        }

    async def save_guide_zoom(self, guide_zoom: int):
        value = self.settings_store.update_guide_zoom(guide_zoom)

        return {
            "ok": True,
            "guideZoom": value,
        }

    async def save_guide_modal_zoom(self, guide_modal_zoom: int):
        value = self.settings_store.update_guide_modal_zoom(guide_modal_zoom)

        return {
            "ok": True,
            "guideModalZoom": value,
        }

    async def save_text_viewer_zoom(self, text_viewer_zoom: int):
        value = self.settings_store.update_text_viewer_zoom(text_viewer_zoom)

        return {
            "ok": True,
            "textViewerZoom": value,
        }

    async def load_help_document(self, name: str):
        """One of the plain-text documents that ship with the plugin.

        Named from an allowlist rather than by path. The backend runs as root,
        so a name that reached the filesystem unchecked would be a way to read
        anything on the Deck and hand it to the panel — and the whole point of
        these is that there are only ever a few of them.
        """
        filename = HELP_DOCUMENTS.get(str(name or ""))
        if filename is None:
            decky.logger.warning("no help document called %r", name)
            return {"ok": False, "text": ""}

        try:
            text = (self.help_dir / filename).read_text(encoding="utf-8")
            text = text.replace("{{SYSTEMS}}", systems.describe_systems())
            text = text.replace("{{SKIPPED_FOLDERS}}", systems.describe_unsupported_folders())
            text = text.replace("{{RELATED}}", systems.describe_related_pairs())
            text = text.replace("{{VERIFICATION}}", systems.describe_verification())
            text = text.replace("{{VERSION}}", installed_version())
            return {"ok": True, "text": text}
        except OSError as exc:
            decky.logger.error("couldn't read help document %s (%s)", filename, exc)
            return {"ok": False, "text": ""}

    async def save_keep_guides_offline(self, keep_guides_offline: bool):
        was_frozen = self._guides_frozen()
        value = self.settings_store.update_keep_guides_offline(keep_guides_offline)
        self._restart_guide_clock_if_thawed(was_frozen)

        return {
            "ok": True,
            "keepGuidesOffline": value,
        }

    async def save_pin_latest_guides(self, pin_latest_guides: bool):
        value = self.settings_store.update_pin_latest_guides(pin_latest_guides)

        return {
            "ok": True,
            "pinLatestGuides": value,
        }

    async def save_display_scales(self, ui_size: str, achievement_text_scale: str, comments_text_scale: str, text_scale: str, title_scale: str, header_scale: str, banner_scale: str, modal_scale: str):
        scales = self.settings_store.update_display_scales(
            ui_size,
            achievement_text_scale,
            comments_text_scale,
            text_scale,
            title_scale,
            header_scale,
            banner_scale,
            modal_scale,
        )

        return {
            "ok": True,
            **scales,
        }

    async def save_main_ui_preset(self, show_social_hub: bool, show_mastery_goals: bool, show_options: bool, show_a_button_mode: bool):
        buttons = self.settings_store.update_main_ui_preset(
            show_social_hub,
            show_mastery_goals,
            show_options,
            show_a_button_mode,
        )

        return {
            "ok": True,
            **buttons,
        }

    async def save_block_padding(self, block_padding: int):
        value = self.settings_store.update_block_padding(block_padding)

        return {
            "ok": True,
            "blockPadding": value,
        }

    async def save_button_spacing(self, button_spacing: str):
        value = self.settings_store.update_button_spacing(button_spacing)

        return {
            "ok": True,
            "buttonSpacing": value,
        }
