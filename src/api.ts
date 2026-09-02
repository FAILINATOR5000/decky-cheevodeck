import { callable } from "@decky/api";
import type { LanguageCode } from "./locales";
import type { GuideListEntry } from "./utils/guidesFetch";
import { logError } from "./utils/errors";

import type {
    AchievementSort,
    AchievementStyle,
    ActivityCardAction,
    AllTrackedGamesResponse,
    ControllerGlyphStyle,
    BulkToggleTrackedAction,
    GameGuidesRecord,
    GuidesMapping,
    GuideUserData,
    GuideBookmark,
    BulkToggleTrackedResponse,
    ButtonSpacing,
    CachedFriendsResponse,
    CachedResponse,
    CacheClearGroup,
    CheckCurrentGameResponse,
    CheevoNotification,
    ArchivedNotification,
    ClearAllTrackedResponse,
    ClearTrackedResponse,
    FriendAchievementFilter,
    FriendAllGamesResponse,
    FriendGamePayload,
    FriendGameResponse,
    FriendRow,
    FriendRowRefreshResponse,
    FriendsRefreshResponse,
    FriendsPayload,
    GameNoteDeleteResponse,
    GameNoteSingleResponse,
    GameNoteSortMode,
    GameNoteSortResponse,
    GameNoteAButtonMode,
    GameNotesPayload,
    PendingGameNoteRemindersResponse,
    AckGameNoteRemindersResponse,
    ClearNoteFiredDotResponse,
    GamePayloadResponse,
    GamesListCacheResult,
    AwardsListCacheResult,
    WantToPlayCacheResult,
    LeaderboardEntriesResponse,
    LeaderboardUserEntryResponse,
    MainAchievementAction,
    MainAchievementFilter,
    PlayersNearYouMode,
    PlayersNearYouTapMode,
    PlayersNearYouResponse,
    NotificationsPayload,
    NoteColor,
    OptionsTab,
    RefreshResponse,
    RecentTagsResponse,
    ReorderDirection,
    ResumeState,
    ResumeStateResponse,
    SaveDefaultNoteColorResponse,
    SaveTrackedNoteResponse,
    SaveTrackedSortForGameResponse,
    InjectResult,
    SavedUser,
    SettingsResponse,
    SwitchUserResult,
    SocialEntryDefault,
    ToggleTrackedResponse,
    TotalTrackedCountResponse,
    TrackedAchievementAction,
    TrackedSetAButtonMode,
    DolphinMapperMode,
    DolphinSystemFilter,
    DolphinMappingInput,
    LoadDolphinMappingsResponse,
    DolphinMappingResponse,
    ReorderDolphinMappingsResponse,
    ApplyDolphinMappingResponse,
    SmbShare,
    SmbSharePayload,
    SmbShareStatus,
    CheevoCheckScanProgress,
    CheevoCheckState,
    FileWatcherBucket,
    FileWatcherExcludedRow,
    FileWatcherFinding,
    FileWatcherPass,
    FileWatcherRoot,
    FileWatcherSchedule,
    FileWatcherSpeed,
    FileWatcherState,
    FileWatcherWindow,
    DeckControllerStatus,
    SetDeckControllerResponse,
    TrackedAchievementsResponse,
    TrackedAchievementSort,
    TrackedColor,
    TrackedNotes,
    TrackedNotesColor,
    TrackedTab,
    ScaleStep,
    UiSize,
    UpdateStatusResponse,
    UserAwardsResponse,
    WantToPlayResponse,
    GameLeaderboardsResponse,
    UnlockHistoryResponse,
    SocialActivityResponse,
    NowPlayingActivityResponse,
    GameTickerResponse,
    SocialHubTickerResponse,
    NewsFeedResponse,
    AchievementOfTheWeekResponse,
    NewSetsAndRevisionsResponse,
    NewSetsFilter,
    GameCommentsResponse,
    LoadTrackedSetsResponse,
    TrackedSetResponse,
    CheckAllSetsResponse,
    AddTrackedSetGamePayload,
    AddTrackedSetGameResponse,
    ClearAllTrackedSetsResponse,
    TrackedSetConsoleListResponse,
    TrackedSetGameListResponse,
    TrackedSetGameSort,
    TrackedSetFilter,
    TrackedSetViewMode,
    TrackedSetSelectorSort,
    SaveTrackedSetsSelectorSortResponse,
    SaveTrackedSetsSelectorFilterResponse,
    SubscriptionKind,
    SubscriptionsResponse,
    AddSubscriptionPayload,
    AddSubscriptionResponse,
    RemoveSubscriptionResponse,
    SaveCommentPayload,
    SavedCommentsPrefs,
    SavedCommentKeysResponse,
    SavedCommentsResponse,
    SaveCommentResponse,
    UnsaveCommentResponse,
    ClearSavedCommentsResponse,
    OkResult,
    SocialView,
    BadgesSortOrder,
    QuickMenuShortcut,
    ScalePreset,
    ShortcutAction,
    ShortcutButton
} from "./types";

export const getSettings = callable<[], SettingsResponse>("get_settings");
export const saveSettings = callable<[string, string], OkResult & SettingsResponse>(
    "save_settings"
);
export const addUser = callable<[string, string], { ok: boolean; users: SavedUser[] }>("add_user");
export const switchUser = callable<[string], SwitchUserResult>("switch_user");
export const removeUser = callable<[string], { ok: boolean; users: SavedUser[] }>("remove_user");

export const generateConnectToken = callable<
    [string, string, boolean],
    { ok: boolean; users?: SavedUser[]; error?: string; message?: string }
>("generate_connect_token");

export const clearConnectLogin = callable<[string], { ok: boolean; users: SavedUser[] }>(
    "clear_connect_login"
);

export const saveInjectEmulatorLogin = callable<
    [boolean],
    { ok: boolean; injectEmulatorLogin: boolean }
>("save_inject_emulator_login");

export const reinjectActiveLogin = callable<
    [],
    { ok: boolean; outcome?: "injected" | "disabled" | "no-token"; error?: string; emulators?: string[]; inject?: InjectResult }
>("reinject_active_login");
export const saveAutoRefresh = callable<[boolean], { ok: boolean; autoRefresh: boolean }>("save_auto_refresh");
export const saveShowIcons = callable<[boolean], { ok: boolean; showIcons: boolean }>("save_show_icons");
export const saveDeferModalCleanup = callable<[boolean], { ok: boolean; deferModalCleanup: boolean }>(
    "save_defer_modal_cleanup"
);
export const saveLegacyCommentsLoading = callable<[boolean], { ok: boolean; legacyCommentsLoading: boolean }>(
    "save_legacy_comments_loading"
);
export const saveShowAllAchievements = callable<[boolean], { ok: boolean; showAllAchievements: boolean }>(
    "save_show_all_achievements"
);
export const saveUnlockLookbackMinutes = callable<[number], { ok: boolean; unlockLookbackMinutes: number }>(
    "save_unlock_lookback_minutes"
);
export const saveUnlockHistoryDays = callable<[number], { ok: boolean; unlockHistoryDays: number }>(
    "save_unlock_history_days"
);
export const saveRememberLastPage = callable<[boolean], { ok: boolean; rememberLastPage: boolean }>(
    "save_remember_last_page"
);
export const saveLastSocialView = callable<[SocialView], { ok: boolean; lastSocialView: SocialView }>(
    "save_last_social_view"
);
export const saveBadgesSortOrder = callable<[BadgesSortOrder], { ok: boolean; badgesSortOrder: BadgesSortOrder }>(
    "save_badges_sort_order"
);
export const saveLastConsoleId = callable<[number], { ok: boolean; lastConsoleId: number }>(
    "save_last_console_id"
);
export const getLastConsoleId = callable<[], { ok: boolean; lastConsoleId: number }>(
    "get_last_console_id"
);
export const saveSavedCommentsPrefs = callable<
    [Partial<SavedCommentsPrefs>],
    { ok: boolean; savedCommentsPrefs: SavedCommentsPrefs }
>("save_saved_comments_prefs");
export const saveSocialEntryDefault = callable<
    [SocialEntryDefault],
    { ok: boolean; socialEntryDefault: SocialEntryDefault }
>("save_social_entry_default");
export const saveGameNotesAButtonMode = callable<
    [GameNoteAButtonMode],
    { ok: boolean; gameNotesAButtonMode: GameNoteAButtonMode }
>("save_game_notes_a_button_mode");
export const saveActivityCardAction = callable<
    [ActivityCardAction],
    { ok: boolean; activityCardAction: ActivityCardAction }
>("save_activity_card_action");
export const saveFriendFeedCardAction = callable<
    [ActivityCardAction],
    { ok: boolean; friendFeedCardAction: ActivityCardAction }
>("save_friend_feed_card_action");
export const saveSocialHubCardAction = callable<
    [ActivityCardAction],
    { ok: boolean; socialHubCardAction: ActivityCardAction }
>("save_social_hub_card_action");
export const saveLastOptionsTab = callable<[OptionsTab], { ok: boolean; lastOptionsTab: OptionsTab }>(
    "save_last_options_tab"
);
export const saveLastTrackedTab = callable<[TrackedTab], { ok: boolean; lastTrackedTab: TrackedTab }>(
    "save_last_tracked_tab"
);
export const saveUiSize = callable<[UiSize], { ok: boolean; uiSize: UiSize }>("save_ui_size");
export const saveAchievementTextScale = callable<[ScaleStep], { ok: boolean; achievementTextScale: ScaleStep }>("save_achievement_text_scale");
export const touchSavedCommentOpened = callable<[string], { ok: boolean; id?: string; error?: string }>(
    "touch_saved_comment_opened"
);
export const saveCommentsTextScale = callable<[ScaleStep], { ok: boolean; commentsTextScale: ScaleStep }>("save_comments_text_scale");
export const saveTextScale = callable<[ScaleStep], { ok: boolean; textScale: ScaleStep }>("save_text_scale");
export const saveTitleScale = callable<[ScaleStep], { ok: boolean; titleScale: ScaleStep }>("save_title_scale");
export const saveHeaderScale = callable<[ScaleStep], { ok: boolean; headerScale: ScaleStep }>("save_header_scale");
export const saveBannerScale = callable<[ScaleStep], { ok: boolean; bannerScale: ScaleStep }>("save_banner_scale");
export const saveModalScale = callable<[ScaleStep], { ok: boolean; modalScale: ScaleStep }>("save_modal_scale");
export const saveGuideZoom = callable<[number], { ok: boolean; guideZoom: number }>("save_guide_zoom");
export const saveGuideModalZoom = callable<[number], { ok: boolean; guideModalZoom: number }>("save_guide_modal_zoom");
export const saveTextViewerZoom = callable<[number], { ok: boolean; textViewerZoom: number }>("save_text_viewer_zoom");
export const loadHelpDocument = callable<[string], { ok: boolean; text: string }>("load_help_document");
export const saveKeepGuidesOffline = callable<[boolean], { ok: boolean; keepGuidesOffline: boolean }>(
    "save_keep_guides_offline"
);
export const savePinLatestGuides = callable<[boolean], { ok: boolean; pinLatestGuides: boolean }>(
    "save_pin_latest_guides"
);
export const saveDisplayScales = callable<
    [ScaleStep, ScaleStep, ScaleStep, ScaleStep, ScaleStep, ScaleStep, ScaleStep, ScaleStep],
    { ok: boolean; uiSize: ScaleStep; achievementTextScale: ScaleStep; commentsTextScale: ScaleStep; textScale: ScaleStep; titleScale: ScaleStep; headerScale: ScaleStep; bannerScale: ScaleStep; modalScale: ScaleStep }
>("save_display_scales");
export const saveMainUiPreset = callable<
    [boolean, boolean, boolean, boolean],
    { ok: boolean; showSocialHubButton: boolean; showTrackedSetsButton: boolean; showOptionsButton: boolean; showAButtonMode: boolean }
>("save_main_ui_preset");
export const saveBlockPadding = callable<[number], { ok: boolean; blockPadding: number }>("save_block_padding");
export const saveButtonSpacing = callable<[ButtonSpacing], { ok: boolean; buttonSpacing: ButtonSpacing }>(
    "save_button_spacing"
);
export const saveMouseKeyboardMode = callable<[boolean], { ok: boolean; mouseKeyboardMode: boolean }>(
    "save_mouse_keyboard_mode"
);
export const saveControllerGlyphStyle = callable<
    [ControllerGlyphStyle],
    { ok: boolean; controllerGlyphStyle: ControllerGlyphStyle }
>("save_controller_glyph_style");
export const saveColoredGlyphs = callable<[boolean], { ok: boolean; coloredGlyphs: boolean }>(
    "save_colored_glyphs"
);
export const saveShowAButtonMode = callable<[boolean], { ok: boolean; showAButtonMode: boolean }>(
    "save_show_a_button_mode"
);
export const saveShowAButtonModeTracked = callable<[boolean], { ok: boolean; showAButtonModeTracked: boolean }>(
    "save_show_a_button_mode_tracked"
);
export const saveAchievementStyle = callable<
    [AchievementStyle],
    { ok: boolean; achievementStyle: AchievementStyle }
>("save_achievement_style");
export const saveTrackedColor = callable<
    [TrackedColor],
    { ok: boolean; trackedColor: TrackedColor }
>("save_tracked_color");
export const saveMainAchievementFilter = callable<
    [MainAchievementFilter],
    { ok: boolean; mainAchievementFilter: MainAchievementFilter }
>("save_main_achievement_filter");
export const saveMainAchievementSort = callable<
    [AchievementSort],
    { ok: boolean; mainAchievementSort: AchievementSort }
>("save_main_achievement_sort");
export const saveFriendAchievementFilter = callable<
    [FriendAchievementFilter],
    { ok: boolean; friendAchievementFilter: FriendAchievementFilter }
>("save_friend_achievement_filter");
export const saveFriendAchievementSort = callable<
    [AchievementSort],
    { ok: boolean; friendAchievementSort: AchievementSort }
>("save_friend_achievement_sort");
export const saveFriendShowAllAchievements = callable<
    [boolean],
    { ok: boolean; friendShowAllAchievements: boolean }
>("save_friend_show_all_achievements");
export const saveMainAchievementAction = callable<
    [MainAchievementAction],
    { ok: boolean; mainAchievementAction: MainAchievementAction }
>("save_main_achievement_action");
export const saveTrackedAchievementAction = callable<
    [TrackedAchievementAction],
    { ok: boolean; trackedAchievementAction: TrackedAchievementAction }
>("save_tracked_achievement_action");
export const saveTrackedSetAButtonMode = callable<
    [TrackedSetAButtonMode],
    { ok: boolean; trackedSetAButtonMode: TrackedSetAButtonMode }
>("save_tracked_set_a_button_mode");
export const saveDolphinMapperMode = callable<
    [DolphinMapperMode],
    { ok: boolean; dolphinMapperMode: DolphinMapperMode }
>("save_dolphin_mapper_mode");
export const saveDolphinSystemFilter = callable<
    [DolphinSystemFilter],
    { ok: boolean; dolphinSystemFilter: DolphinSystemFilter }
>("save_dolphin_system_filter");
export const saveDolphinBluetoothPassthrough = callable<
    [boolean],
    { ok: boolean; dolphinBluetoothPassthrough: boolean; error?: string }
>("set_dolphin_bluetooth_passthrough");
export const saveDolphinContinuousScanning = callable<
    [boolean],
    { ok: boolean; dolphinContinuousScanning: boolean; error?: string }
>("set_dolphin_continuous_scanning");
export const saveDolphinBalanceBoard = callable<
    [boolean],
    { ok: boolean; dolphinBalanceBoard: boolean; error?: string }
>("set_dolphin_balance_board");

export const loadDolphinMappings = callable<[], LoadDolphinMappingsResponse>("list_dolphin_mappings");
export const saveDolphinMapping = callable<[DolphinMappingInput], DolphinMappingResponse>("save_dolphin_mapping");
export const deleteDolphinMapping = callable<[string], OkResult>("delete_dolphin_mapping");
export const resetDolphinMappings = callable<[], OkResult>("reset_dolphin_mappings");
export const clearDolphinMappings = callable<[], OkResult>("clear_dolphin_mappings");
export const reorderDolphinMappings = callable<[string[]], ReorderDolphinMappingsResponse>("reorder_dolphin_mappings");
export const applyDolphinMapping = callable<[string], ApplyDolphinMappingResponse>("apply_dolphin_mapping");
export const listSmbShares = callable<[boolean, boolean], { shares: SmbShare[] }>("list_smb_shares");
export const addSmbShare = callable<
    [SmbSharePayload],
    { ok: boolean; share?: SmbShare; error?: string; field?: string; shares?: string[] }
>("add_smb_share");
export const updateSmbShare = callable<
    [string, SmbSharePayload],
    { ok: boolean; share?: SmbShare; error?: string; field?: string; shares?: string[] }
>("update_smb_share");
export const deleteSmbShare = callable<
    [string, boolean],
    { ok: boolean; error?: string; blockedBy?: string[] }
>("delete_smb_share");
export const setSmbShareEnabled = callable<
    [string, boolean],
    { ok: boolean; status?: SmbShareStatus; error?: string }
>("set_smb_share_enabled");
export const testSmbShare = callable<
    [SmbSharePayload, string | null],
    { ok: boolean; error?: string; field?: string; shares?: string[] }
>("test_smb_share");
export const linkSmbMountsToDesktop = callable<[], { ok: boolean; linked?: number; error?: string }>(
    "link_smb_mounts_to_desktop"
);

export const getCheevoCheckState = callable<[], CheevoCheckState>("get_cheevo_check_state");
export const cancelCheevoCheckScan = callable<[], { ok: boolean; running: boolean }>(
    "cancel_cheevo_check_scan"
);
export const getCheevoCheckScanStatus = callable<
    [],
    { running: boolean; error: string | null; progress: CheevoCheckScanProgress | null }
>("get_cheevo_check_scan_status");
export const startCheevoCheckScan = callable<
    [string, boolean],
    { ok: boolean; error?: string }
>("start_cheevo_check_scan");
export const saveCheevoCheckCacheHashes = callable<
    [boolean],
    { ok: boolean; cheevoCheckCacheHashes: boolean }
>("save_cheevo_check_cache_hashes");
export const saveCheevoCheckExtractToRam = callable<
    [boolean],
    { ok: boolean; cheevoCheckExtractToRam: boolean }
>("save_cheevo_check_extract_to_ram");
export const saveCheevoCheckVerifyHashes = callable<
    [boolean],
    { ok: boolean; cheevoCheckVerifyHashes: boolean }
>("save_cheevo_check_verify_hashes");
export const saveCheevoCheckSkipDiscVerify = callable<
    [boolean],
    { ok: boolean; cheevoCheckSkipDiscVerify: boolean }
>("save_cheevo_check_skip_disc_verify");
export const saveCheevoCheckSkipCartVerify = callable<
    [boolean],
    { ok: boolean; cheevoCheckSkipCartVerify: boolean }
>("save_cheevo_check_skip_cart_verify");
export const saveCheevoCheckVerifySpeed = callable<
    [string],
    { ok: boolean; cheevoCheckVerifySpeed: string }
>("save_cheevo_check_verify_speed");

export const saveCheevoCheckScanCollapsed = callable<
    [boolean],
    { ok: boolean; cheevoCheckScanCollapsed: boolean }
>("save_cheevo_check_scan_collapsed");

export const saveCheevoCheckResultsCollapsed = callable<
    [boolean],
    { ok: boolean; cheevoCheckResultsCollapsed: boolean }
>("save_cheevo_check_results_collapsed");

export const saveCheevoCheckVerifyCollapsed = callable<
    [boolean],
    { ok: boolean; cheevoCheckVerifyCollapsed: boolean }
>("save_cheevo_check_verify_collapsed");

export const saveCheevoCheckOptionsCollapsed = callable<
    [boolean],
    { ok: boolean; cheevoCheckOptionsCollapsed: boolean }
>("save_cheevo_check_options_collapsed");
export const updateCheevoCheckReferenceData = callable<
    [],
    { ok: boolean; updated: number; failed: number }
>("update_cheevo_check_reference_data");
export const saveCheevoCheckReport = callable<
    [string, string],
    { ok: boolean; error?: string; name?: string; path?: string }
>("save_cheevo_check_report");
export const clearCheevoCheckHashCache = callable<[], { ok: boolean; cleared: number }>(
    "clear_cheevo_check_hash_cache"
);
export const getCheevoCheckLastSystemId = callable<[], { ok: boolean; cheevoCheckLastSystemId: number }>(
    "get_cheevo_check_last_system_id"
);
export const saveCheevoCheckLastSystemId = callable<[number], { ok: boolean; cheevoCheckLastSystemId: number }>(
    "save_cheevo_check_last_system_id"
);

export const getFileWatcherState = callable<[], FileWatcherState>("get_file_watcher_state");
export const getFileWatcherPassStatus = callable<[], { pass: FileWatcherPass | null }>(
    "get_file_watcher_pass_status"
);
export const startFileWatcherPass = callable<[], { ok: boolean; error?: string }>(
    "start_file_watcher_pass"
);
export const cancelFileWatcherPass = callable<[], { ok: boolean; cancelled: boolean }>(
    "cancel_file_watcher_pass"
);
export const saveFileWatcherReport = callable<
    [string, string],
    { ok: boolean; error?: string; name?: string }
>("save_file_watcher_report");
export const addFileWatcherRoot = callable<
    [string],
    { ok: boolean; error?: string; label?: string; root?: FileWatcherRoot }
>("add_file_watcher_root");
export const removeFileWatcherRoot = callable<[number], { ok: boolean; error?: string }>(
    "remove_file_watcher_root"
);
export const updateFileWatcherRoot = callable<
    [number, string | null, string[] | null],
    { ok: boolean; error?: string; root?: FileWatcherRoot }
>("update_file_watcher_root");
export const forgetFileWatcherRootHashes = callable<
    [number],
    { ok: boolean; error?: string; removed?: number }
>("forget_file_watcher_root_hashes");
export const updateFileWatcherSchedule = callable<
    [boolean, number, number, number, number],
    { ok: boolean; schedule: FileWatcherSchedule; lastCompletedAt: number; nextDueAt: number }
>("update_file_watcher_schedule");
export const updateFileWatcherWindow = callable<
    [boolean, [number, number], [number, number]],
    { ok: boolean; window: FileWatcherWindow; lastCompletedAt: number; nextDueAt: number }
>("update_file_watcher_window");
export const saveBatterySaverDisablesFileWatcher = callable<
    [boolean],
    { ok: boolean; batterySaverDisablesFileWatcher: boolean }
>("save_battery_saver_disables_file_watcher");
export const saveFileWatcherSpeed = callable<
    [FileWatcherSpeed],
    { ok: boolean; fileWatcherSpeed: FileWatcherSpeed }
>("save_file_watcher_speed");
export const saveFileWatcherRunDuringGames = callable<
    [boolean],
    { ok: boolean; fileWatcherRunDuringGames: boolean }
>("save_file_watcher_run_during_games");
export const getFileWatcherFindingRoots = callable<
    [FileWatcherBucket],
    { ok: boolean; roots: Array<{ rootId: number; count: number }> }
>("get_file_watcher_finding_roots");
export const getFileWatcherFindings = callable<
    [FileWatcherBucket, number, number | null, number, string],
    { ok: boolean; rows: FileWatcherFinding[] }
>("get_file_watcher_findings");
export const getFileWatcherExcludedRoots = callable<
    [],
    { ok: boolean; roots: Array<{ rootId: number; count: number; dirs: number; files: number }> }
>("get_file_watcher_excluded_roots");
export const getFileWatcherExcluded = callable<
    [number, number | null, number, string],
    { ok: boolean; rows: FileWatcherExcludedRow[] }
>("get_file_watcher_excluded");
export const dismissFileWatcherFinding = callable<
    [number, string, "accept" | "forget"],
    { ok: boolean; error?: string }
>("dismiss_file_watcher_finding");
export const clearFileWatcherReport = callable<[], { ok: boolean; cleared: number }>(
    "clear_file_watcher_report"
);
export const clearFileWatcherMap = callable<[], { ok: boolean; error?: string; cleared: number }>(
    "clear_file_watcher_map"
);
export const clearFileWatcherEverything = callable<[], { ok: boolean; cleared: number }>(
    "clear_file_watcher_everything"
);
export const clearFileWatcherRunTimes = callable<
    [],
    { ok: boolean; error?: string; lastCompletedAt: number; nextDueAt: number }
>("clear_file_watcher_run_times");

export const getDeckControllerStatus = callable<[], DeckControllerStatus>("get_deck_controller_status");
export const setDeckControllerDisabled = callable<[boolean], SetDeckControllerResponse>("set_deck_controller_disabled");
export const saveLanguage = callable<[LanguageCode], { ok: boolean; language: LanguageCode }>("save_language");
export const saveFriendRefreshDelayMs = callable<[number], { ok: boolean; friendRefreshDelayMs: number }>(
    "save_friend_refresh_delay_ms"
);
export const saveActivityCacheMinutes = callable<[number], { ok: boolean; activityCacheMinutes: number }>(
    "save_activity_cache_minutes"
);
export const saveTrickleLookbackHours = callable<[number], { ok: boolean; trickleLookbackHours: number }>(
    "save_trickle_lookback_hours"
);
export const saveActivityFriendsPerTick = callable<[number], { ok: boolean; activityFriendsPerTick: number }>(
    "save_activity_friends_per_tick"
);
export const saveSocialGameTicker = callable<[boolean], { ok: boolean; socialGameTicker: boolean }>(
    "save_social_game_ticker"
);
export const saveSocialHubTicker = callable<[boolean], { ok: boolean; socialHubTicker: boolean }>(
    "save_social_hub_ticker"
);
export const saveSocialActivityTrickleService = callable<[boolean], { ok: boolean; socialActivityTrickleService: boolean }>(
    "save_social_activity_trickle_service"
);
export const saveTrickleFavoritesOnly = callable<[boolean], { ok: boolean; trickleFavoritesOnly: boolean }>(
    "save_trickle_favorites_only"
);
export const saveFriendAutoRefresh = callable<[boolean], { ok: boolean; friendAutoRefresh: boolean }>(
    "save_friend_auto_refresh"
);
export const saveShowReminderTicker = callable<[boolean], { ok: boolean; showReminderTicker: boolean }>(
    "save_show_reminder_ticker"
);
export const saveShowNotesDot = callable<[boolean], { ok: boolean; showNotesDot: boolean }>(
    "save_show_notes_dot"
);
export const saveShowBellDot = callable<[boolean], { ok: boolean; showBellDot: boolean }>(
    "save_show_bell_dot"
);
export const saveDoNotDisturb = callable<[boolean], { ok: boolean; doNotDisturb: boolean }>(
    "save_do_not_disturb"
);
export const saveDoNotDisturbDisablesDot = callable<[boolean], { ok: boolean; doNotDisturbDisablesDot: boolean }>(
    "save_do_not_disturb_disables_dot"
);
export const saveDoNotDisturbDisablesToast = callable<[boolean], { ok: boolean; doNotDisturbDisablesToast: boolean }>(
    "save_do_not_disturb_disables_toast"
);
export const saveNightMode = callable<[boolean], { ok: boolean; nightMode: boolean }>(
    "save_night_mode"
);
export const saveNightModeBrightness = callable<[number], { ok: boolean; nightModeBrightness: number }>(
    "save_night_mode_brightness"
);
export const saveBatterySaver = callable<[boolean], { ok: boolean; batterySaver: boolean }>(
    "save_battery_saver"
);
export const saveBatterySaverDisablesSocialActivity = callable<[boolean], { ok: boolean; batterySaverDisablesSocialActivity: boolean }>(
    "save_battery_saver_disables_social_activity"
);
export const saveBatterySaverDisablesComments = callable<[boolean], { ok: boolean; batterySaverDisablesComments: boolean }>(
    "save_battery_saver_disables_comments"
);
export const saveBatterySaverDisablesFriendAvatars = callable<[boolean], { ok: boolean; batterySaverDisablesFriendAvatars: boolean }>(
    "save_battery_saver_disables_friend_avatars"
);
export const saveBatterySaverDisablesPlayersNearYou = callable<[boolean], { ok: boolean; batterySaverDisablesPlayersNearYou: boolean }>(
    "save_battery_saver_disables_players_near_you"
);
export const saveBatterySaverDisablesTrackedSets = callable<[boolean], { ok: boolean; batterySaverDisablesTrackedSets: boolean }>(
    "save_battery_saver_disables_tracked_sets"
);
export const NOTIFICATION_EVENT = "cheevodeck_notification";
export const getNotifications = callable<[], NotificationsPayload>("get_notifications");
export const markNotificationsSeen = callable<[], { ok: boolean; lastSeenAt: number }>(
    "mark_notifications_seen"
);
export const clearAllNotifications = callable<[], { ok: boolean }>("clear_all_notifications");
export const getArchivedNotifications = callable<[], { archived: ArchivedNotification[] }>(
    "get_archived_notifications"
);
export const archiveNotification = callable<
    [notification: CheevoNotification],
    { ok: boolean; error?: string; archived?: ArchivedNotification }
>("archive_notification");
export const unarchiveNotification = callable<[notificationId: string], OkResult>(
    "unarchive_notification"
);
export const clearArchivedNotifications = callable<[], { ok: boolean }>("clear_archived_notifications");
export const fireTestDebugNotification = callable<[], { ok: boolean }>("fire_test_debug_notification");
export const fireTestUpdateNotification = callable<[], { ok: boolean; version?: string }>(
    "fire_test_update_notification"
);
export const fireTestCommentNotification = callable<[], { ok: boolean; chars?: number }>(
    "fire_test_comment_notification"
);
export const fireTestTrackedSetCompletion = callable<
    [],
    { ok: boolean; fired?: boolean; setName?: string; reason?: string }
>("fire_test_tracked_set_completion");
export const injectFakeSelfName = callable<[], { ok: boolean; username?: string }>(
    "inject_fake_self_name"
);
export const injectFakeFriendName = callable<
    [],
    { ok: boolean; renamed: boolean; username?: string | null }
>("inject_fake_friend_name");
export const saveNotifyNoteReminderEnabled = callable<[boolean], { ok: boolean; notifyNoteReminderEnabled: boolean }>(
    "save_notify_note_reminder_enabled"
);
export const saveNotifyNoteReminderToast = callable<[boolean], { ok: boolean; notifyNoteReminderToast: boolean }>(
    "save_notify_note_reminder_toast"
);
export const saveNotifyTrackedSetEnabled = callable<[boolean], { ok: boolean; notifyTrackedSetEnabled: boolean }>(
    "save_notify_tracked_set_enabled"
);
export const saveNotifyTrackedSetToast = callable<[boolean], { ok: boolean; notifyTrackedSetToast: boolean }>(
    "save_notify_tracked_set_toast"
);
export const saveNotifyCommentTrackerEnabled = callable<[boolean], { ok: boolean; notifyCommentTrackerEnabled: boolean }>(
    "save_notify_comment_tracker_enabled"
);
export const saveNotifyCommentTrackerToast = callable<[boolean], { ok: boolean; notifyCommentTrackerToast: boolean }>(
    "save_notify_comment_tracker_toast"
);
export const saveNotifyWallEnabled = callable<[boolean], { ok: boolean; notifyWallEnabled: boolean }>(
    "save_notify_wall_enabled"
);
export const saveNotifyWallToast = callable<[boolean], { ok: boolean; notifyWallToast: boolean }>(
    "save_notify_wall_toast"
);
export const saveNotifySystemEnabled = callable<[boolean], { ok: boolean; notifySystemEnabled: boolean }>(
    "save_notify_system_enabled"
);
export const saveNotifySystemToast = callable<[boolean], { ok: boolean; notifySystemToast: boolean }>(
    "save_notify_system_toast"
);
export const saveNotifyTrackedEnabled = callable<[boolean], { ok: boolean; notifyTrackedEnabled: boolean }>(
    "save_notify_tracked_enabled"
);
export const saveNotifyTrackedToast = callable<[boolean], { ok: boolean; notifyTrackedToast: boolean }>(
    "save_notify_tracked_toast"
);
export const saveNotifySocialUnlockEnabled = callable<[boolean], { ok: boolean; notifySocialUnlockEnabled: boolean }>(
    "save_notify_social_unlock_enabled"
);
export const saveNotifySocialUnlockToast = callable<[boolean], { ok: boolean; notifySocialUnlockToast: boolean }>(
    "save_notify_social_unlock_toast"
);
export const saveNotifyNearYouEnabled = callable<[boolean], { ok: boolean; notifyNearYouEnabled: boolean }>(
    "save_notify_near_you_enabled"
);
export const saveNotifyNearYouToast = callable<[boolean], { ok: boolean; notifyNearYouToast: boolean }>(
    "save_notify_near_you_toast"
);
export const saveNotifyDebugEnabled = callable<[boolean], { ok: boolean; notifyDebugEnabled: boolean }>(
    "save_notify_debug_enabled"
);
export const saveNotifyDebugToast = callable<[boolean], { ok: boolean; notifyDebugToast: boolean }>(
    "save_notify_debug_toast"
);
export const saveLegacyAchievementLinks = callable<[boolean], { ok: boolean; legacyAchievementLinks: boolean }>(
    "save_legacy_achievement_links"
);
export const saveLegacyGameLinks = callable<[boolean], { ok: boolean; legacyGameLinks: boolean }>(
    "save_legacy_game_links"
);
export const saveShowDeveloperOptions = callable<[boolean], { ok: boolean; showDeveloperOptions: boolean }>(
    "save_show_developer_options"
);
export const saveAutoPurgeService = callable<[boolean], { ok: boolean; autoPurgeService: boolean }>(
    "save_auto_purge_service"
);
export const saveDebugLogging = callable<[boolean], { ok: boolean; debugLogging: boolean }>(
    "save_debug_logging"
);
export const saveIpcSlowThresholdMs = callable<[number], { ok: boolean; ipcSlowThresholdMs: number }>(
    "save_ipc_slow_threshold_ms"
);
export const saveLargeViewportBonusEnabled = callable<[boolean], { ok: boolean; largeViewportBonusEnabled: boolean }>(
    "save_large_viewport_bonus_enabled"
);
export const saveLargeViewportBonus = callable<[number], { ok: boolean; largeViewportBonus: number }>(
    "save_large_viewport_bonus"
);
export const saveParallelRaCalls = callable<[number], { ok: boolean; parallelRaCalls: number }>(
    "save_parallel_ra_calls"
);
export const saveParallelCdnFetches = callable<[number], { ok: boolean; parallelCdnFetches: number }>(
    "save_parallel_cdn_fetches"
);
export const saveMaxIconWorkers = callable<[number], { ok: boolean; maxIconWorkers: number }>(
    "save_max_icon_workers"
);
export const saveAvatarWorkers = callable<[number], { ok: boolean; avatarWorkers: number }>(
    "save_avatar_workers"
);
export const saveGameIconWorkers = callable<[number], { ok: boolean; gameIconWorkers: number }>(
    "save_game_icon_workers"
);
export const saveGameArtCacheCap = callable<[number], { ok: boolean; gameArtCacheCap: number }>(
    "save_game_art_cache_cap"
);
export const saveAvatarCacheCap = callable<[number], { ok: boolean; avatarCacheCap: number }>(
    "save_avatar_cache_cap"
);
export const saveAchievementIconCacheGames = callable<[number], { ok: boolean; achievementIconCacheGames: number }>(
    "save_achievement_icon_cache_games"
);
export const saveFriendImageService = callable<[boolean], { ok: boolean; friendImageService: boolean }>(
    "save_friend_image_service"
);
export const saveValidateFriendsRoster = callable<[boolean], { ok: boolean; validateFriendsRoster: boolean }>(
    "save_validate_friends_roster"
);
export const saveFisTickFrequencyMinutes = callable<[number], { ok: boolean; fisTickFrequencyMinutes: number }>(
    "save_fis_tick_frequency_minutes"
);
export const saveCommentsServiceTickMinutes = callable<[number], { ok: boolean; commentsServiceTickMinutes: number }>(
    "save_comments_service_tick_minutes"
);
export const saveCommentsServiceFetchAmount = callable<[number], { ok: boolean; commentsServiceFetchAmount: number }>(
    "save_comments_service_fetch_amount"
);
export const saveCommentsServiceWallCheck = callable<[boolean], { ok: boolean; commentsServiceWallCheck: boolean }>(
    "save_comments_service_wall_check"
);
export const saveFisRosterRefreshIntervalHours = callable<
    [number],
    { ok: boolean; fisRosterRefreshIntervalHours: number }
>("save_fis_roster_refresh_interval_hours");
export const saveFisVerifyFavoriteAvatars = callable<
    [boolean],
    { ok: boolean; fisVerifyFavoriteAvatars: boolean }
>("save_fis_verify_favorite_avatars");
export const saveFisVerifyAllAvatars = callable<
    [boolean],
    { ok: boolean; fisVerifyAllAvatars: boolean }
>("save_fis_verify_all_avatars");
export const savePlayersNearYouEnabled = callable<[boolean], { ok: boolean; playersNearYouEnabled: boolean }>(
    "save_players_near_you_enabled"
);
export const savePlayersNearYouLookbehind = callable<[number], { ok: boolean; playersNearYouLookbehind: number }>(
    "save_players_near_you_lookbehind"
);
export const savePlayersNearYouLookahead = callable<[number], { ok: boolean; playersNearYouLookahead: number }>(
    "save_players_near_you_lookahead"
);
export const savePlayersNearYouMinTickMinutes = callable<[number], { ok: boolean; playersNearYouMinTickMinutes: number }>(
    "save_players_near_you_min_tick_minutes"
);
export const savePlayersNearYouMaxTickMinutes = callable<[number], { ok: boolean; playersNearYouMaxTickMinutes: number }>(
    "save_players_near_you_max_tick_minutes"
);
export const saveGamesListCacheMinutes = callable<[number], { ok: boolean; gamesListCacheMinutes: number }>(
    "save_games_list_cache_minutes"
);
export const saveWantToPlayCacheMinutes = callable<[number], { ok: boolean; wantToPlayCacheMinutes: number }>(
    "save_want_to_play_cache_minutes"
);
export const saveAwardsListCacheMinutes = callable<[number], { ok: boolean; awardsListCacheMinutes: number }>(
    "save_awards_list_cache_minutes"
);
export const savePlayersNearYouTapMode = callable<
    [PlayersNearYouTapMode],
    { ok: boolean; playersNearYouTapMode: PlayersNearYouTapMode }
>("save_players_near_you_tap_mode");
export const savePlayersNearYouCollapsed = callable<[boolean], { ok: boolean; playersNearYouCollapsed: boolean }>(
    "save_players_near_you_collapsed"
);
export const savePlayersNearYouMode = callable<
    [number | null | undefined, PlayersNearYouMode],
    { ok: boolean; mode: PlayersNearYouMode | null }
>("save_players_near_you_mode");
export const saveDolphinAdvancedCollapsed = callable<[boolean], { ok: boolean; dolphinAdvancedCollapsed: boolean }>(
    "save_dolphin_advanced_collapsed"
);
export const saveDolphinCollapsedTags = callable<[string[]], { ok: boolean; collapsedTags: string[] }>(
    "save_dolphin_collapsed_tags"
);
const logCommentsDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_comments_debug_event"
);
const logWantToPlayDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_wanttoplay_debug_event"
);
const logFocusDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_focus_debug_event"
);
const logNavDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_nav_debug_event"
);
const logSortDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_sort_debug_event"
);
const logInjectDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_inject_debug_event"
);
const logFriendFetchDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_friend_fetch_debug_event"
);
const logGuidesDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_guides_debug_event"
);
const logSysviewDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_sysview_debug_event"
);
const logCardCornerDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_cardcorner_debug_event"
);
const logNotificationsDebugEvent = callable<[string, string, string], { ok: boolean }>(
    "log_notifications_debug"
);
export const saveBigListThreshold = callable<[number], { ok: boolean; bigListThreshold: number }>(
    "save_big_list_threshold"
);
export const saveAlwaysStaggerMounting = callable<[boolean], { ok: boolean; alwaysStaggerMounting: boolean }>(
    "save_always_stagger_mounting"
);
export const saveReturnStaggerFrames = callable<[number], { ok: boolean; returnStaggerFrames: number }>(
    "save_return_stagger_frames"
);
export const saveDynamicLoading = callable<[boolean], { ok: boolean; dynamicLoading: boolean }>(
    "save_dynamic_loading"
);
export const saveDynamicInitialRows = callable<[number], { ok: boolean; dynamicInitialRows: number }>(
    "save_dynamic_initial_rows"
);
export const saveDynamicRowStep = callable<[number], { ok: boolean; dynamicRowStep: number }>(
    "save_dynamic_row_step"
);
export const saveDynamicPrefetchDistance = callable<[number], { ok: boolean; dynamicPrefetchDistance: number }>(
    "save_dynamic_prefetch_distance"
);
export const saveDynamicSentinelRootMargin = callable<[number], { ok: boolean; dynamicSentinelRootMargin: number }>(
    "save_dynamic_sentinel_root_margin"
);
export const saveDynamicTrackedListLoading = callable<[boolean], { ok: boolean; dynamicTrackedListLoading: boolean }>(
    "save_dynamic_tracked_list_loading"
);
export const saveDynamicTrackedListInitialRows = callable<[number], { ok: boolean; dynamicTrackedListInitialRows: number }>(
    "save_dynamic_tracked_list_initial_rows"
);
export const saveDynamicTrackedListRowStep = callable<[number], { ok: boolean; dynamicTrackedListRowStep: number }>(
    "save_dynamic_tracked_list_row_step"
);
export const saveDynamicTrackedListPrefetchDistance = callable<[number], { ok: boolean; dynamicTrackedListPrefetchDistance: number }>(
    "save_dynamic_tracked_list_prefetch_distance"
);
export const saveDynamicTrackedListSentinelRootMargin = callable<[number], { ok: boolean; dynamicTrackedListSentinelRootMargin: number }>(
    "save_dynamic_tracked_list_sentinel_root_margin"
);
export const saveDynamicTrackedSetsListLoading = callable<[boolean], { ok: boolean; dynamicTrackedSetsListLoading: boolean }>(
    "save_dynamic_tracked_sets_list_loading"
);
export const saveDynamicTrackedSetsListInitialRows = callable<[number], { ok: boolean; dynamicTrackedSetsListInitialRows: number }>(
    "save_dynamic_tracked_sets_list_initial_rows"
);
export const saveDynamicTrackedSetsListRowStep = callable<[number], { ok: boolean; dynamicTrackedSetsListRowStep: number }>(
    "save_dynamic_tracked_sets_list_row_step"
);
export const saveDynamicTrackedSetsListPrefetchDistance = callable<[number], { ok: boolean; dynamicTrackedSetsListPrefetchDistance: number }>(
    "save_dynamic_tracked_sets_list_prefetch_distance"
);
export const saveDynamicTrackedSetsListSentinelRootMargin = callable<[number], { ok: boolean; dynamicTrackedSetsListSentinelRootMargin: number }>(
    "save_dynamic_tracked_sets_list_sentinel_root_margin"
);
export const saveDynamicGameNotesLoading = callable<[boolean], { ok: boolean; dynamicGameNotesLoading: boolean }>(
    "save_dynamic_game_notes_loading"
);
export const saveDynamicGameNotesInitialRows = callable<[number], { ok: boolean; dynamicGameNotesInitialRows: number }>(
    "save_dynamic_game_notes_initial_rows"
);
export const saveDynamicGameNotesRowStep = callable<[number], { ok: boolean; dynamicGameNotesRowStep: number }>(
    "save_dynamic_game_notes_row_step"
);
export const saveDynamicGameNotesPrefetchDistance = callable<[number], { ok: boolean; dynamicGameNotesPrefetchDistance: number }>(
    "save_dynamic_game_notes_prefetch_distance"
);
export const saveDynamicGameNotesSentinelRootMargin = callable<[number], { ok: boolean; dynamicGameNotesSentinelRootMargin: number }>(
    "save_dynamic_game_notes_sentinel_root_margin"
);
export const saveDynamicComments = callable<[boolean], { ok: boolean; dynamicComments: boolean }>(
    "save_dynamic_comments"
);
export const saveDynamicCommentsInitialRows = callable<[number], { ok: boolean; dynamicCommentsInitialRows: number }>(
    "save_dynamic_comments_initial_rows"
);
export const saveDynamicCommentsRowStep = callable<[number], { ok: boolean; dynamicCommentsRowStep: number }>(
    "save_dynamic_comments_row_step"
);
export const saveDynamicCommentsSentinelRootMargin = callable<[number], { ok: boolean; dynamicCommentsSentinelRootMargin: number }>(
    "save_dynamic_comments_sentinel_root_margin"
);
export const saveDynamicFriendLoading = callable<[boolean], { ok: boolean; dynamicFriendLoading: boolean }>(
    "save_dynamic_friend_loading"
);
export const saveDynamicLeaderboardLoading = callable<[boolean], { ok: boolean; dynamicLeaderboardLoading: boolean }>(
    "save_dynamic_leaderboard_loading"
);
export const saveDynamicLeaderboardResults = callable<[boolean], { ok: boolean; dynamicLeaderboardResults: boolean }>(
    "save_dynamic_leaderboard_results"
);
export const saveDynamicActivityFeed = callable<[boolean], { ok: boolean; dynamicActivityFeed: boolean }>(
    "save_dynamic_activity_feed"
);
export const saveDynamicCompare = callable<[boolean], { ok: boolean; dynamicCompare: boolean }>(
    "save_dynamic_compare"
);
export const saveDynamicFriendPicker = callable<[boolean], { ok: boolean; dynamicFriendPicker: boolean }>(
    "save_dynamic_friend_picker"
);
export const saveDynamicAllGames = callable<[boolean], { ok: boolean; dynamicAllGames: boolean }>(
    "save_dynamic_all_games"
);
export const saveDynamicTrackedGames = callable<[boolean], { ok: boolean; dynamicTrackedGames: boolean }>(
    "save_dynamic_tracked_games"
);
export const saveDynamicBadges = callable<[boolean], { ok: boolean; dynamicBadges: boolean }>(
    "save_dynamic_badges"
);
export const saveDynamicFollowedRanking = callable<[boolean], { ok: boolean; dynamicFollowedRanking: boolean }>(
    "save_dynamic_followed_ranking"
);
export const resetOptionSettings = callable<[], OkResult & SettingsResponse>("reset_option_settings");
export const applySetupProfile = callable<[string, boolean], OkResult & SettingsResponse>("apply_setup_profile");
export const markIntroViewed = callable<[], { ok: boolean; viewedIntro: boolean }>("mark_intro_viewed");
export const setFriendFavorite = callable<[string, boolean], { ok: boolean; favoriteFriends: string[] }>(
    "set_friend_favorite"
);
export const clearApiKey = callable<[], { ok: boolean }>("clear_api_key");
export const clearCache = callable<[], { ok: boolean; cleared: string[] }>("clear_cache");
export const factoryReset = callable<[], { ok: boolean }>("factory_reset");
export const clearCacheGroup = callable<
    [CacheClearGroup],
    { ok: boolean; group?: CacheClearGroup; cleared: string[]; error?: string }
>("clear_cache_group");
export const clearResolvedAvatars = callable<
    [],
    { ok: boolean; verdicts: number; routes: number }
>("clear_resolved_avatars");
export const cleanupUserDirectories = callable<
    [],
    { ok: boolean; removed: number }
>("cleanup_user_directories");
export const getCachedPayload = callable<[], CachedResponse>("get_cached_payload");
export const getPluginVersion = callable<[], { version: string }>("get_plugin_version");
export const takeSnapshot = callable<[], { ok: boolean; error: string; path: string }>("take_snapshot");
export const getUpdateStatus = callable<[], UpdateStatusResponse>("get_update_status");
export const checkForUpdateNow = callable<[], UpdateStatusResponse>("check_for_update_now");
export const downloadUpdateZip = callable<
    [string],
    { ok: boolean; error?: string; name?: string; path?: string }
>("download_update_zip");
export const placeDesktopUpdater = callable<
    [],
    { ok: boolean; error?: string; name?: string; path?: string }
>("place_desktop_updater");
export const getCachedFriends = callable<[], CachedFriendsResponse>("get_cached_friends");
export const getSocialActivity = callable<[], SocialActivityResponse>("get_social_activity");
export const getPlayersNearYou = callable<[number | null | undefined], PlayersNearYouResponse>("get_players_near_you");
export const getNowPlayingActivity = callable<[number | null | undefined], NowPlayingActivityResponse>(
    "get_now_playing_activity"
);
export const getGameTickerEvent = callable<[], GameTickerResponse>("get_game_ticker_event");
export const clearGameTickerEvent = callable<[], OkResult>("clear_game_ticker_event");
export const getSocialHubTickerEvent = callable<[], SocialHubTickerResponse>("get_social_hub_ticker_event");
export const clearSocialHubTickerEvent = callable<[], OkResult>("clear_social_hub_ticker_event");
export const getNewsFeed = callable<[], NewsFeedResponse>("get_news_feed");
export const getAchievementOfTheWeek = callable<[], AchievementOfTheWeekResponse>("get_achievement_of_the_week");
export const getNewSetsAndRevisions = callable<[NewSetsFilter], NewSetsAndRevisionsResponse>(
    "get_new_sets_and_revisions"
);
export const getGameComments = callable<
    [number | null | undefined, "newest" | "oldest", number, number],
    GameCommentsResponse
>("get_game_comments");
export const getAchievementComments = callable<
    [number | null | undefined, "newest" | "oldest", number, number],
    GameCommentsResponse
>("get_achievement_comments");
export const getUserComments = callable<
    [string | null | undefined, "newest" | "oldest", number, number],
    GameCommentsResponse
>("get_user_comments");
export type GameHashRow = {
    md5: string;
    name: string;
    labels: string[];
    patchUrl: string | null;
};
export type GameHashesResponse = {
    results?: GameHashRow[];
    error?: string | null;
    needsSettings?: boolean;
};
export const downloadGamePatch = callable<
    [string, string],
    { ok: boolean; error?: string; name?: string; path?: string }
>("download_game_patch");
export const getGameHashes = callable<
    [number | null | undefined],
    GameHashesResponse
>("get_game_hashes");
export const refreshCurrentGame = callable<[boolean?], RefreshResponse>("refresh_current_game");
export const refreshFriends = callable<[boolean?], FriendsRefreshResponse>("refresh_friends");
export const manualRefreshFriends = callable<[], FriendsRefreshResponse>("manual_refresh_friends");
export const deepRefreshFriends = callable<[], FriendsRefreshResponse & { verdicts?: number }>(
    "deep_refresh_friends"
);
export const getFriendGameProgress = callable<[string, number | null | undefined, boolean?], FriendGameResponse>(
    "get_friend_game_progress"
);
export const getCachedFriendGame = callable<[string, number | null | undefined], FriendGamePayload | null>(
    "get_cached_friend_game"
);
export const refreshFriendRow = callable<[string], FriendRowRefreshResponse>("refresh_friend_row");
export const resolveFriendAvatar = callable<[string, string], { ok: boolean }>("resolve_friend_avatar");
export const checkCurrentGame = callable<[], CheckCurrentGameResponse>("check_current_game");
export const clearCurrentGame = callable<[], GamePayloadResponse>("clear_current_game");
export const getGamePayload = callable<[number | null | undefined, boolean?], GamePayloadResponse>("get_game_payload");
export const getUserGamePayload = callable<[string, number | null | undefined, boolean?], GamePayloadResponse>(
    "get_user_game_payload"
);
export const getRecentUnlockHistory = callable<[number | null | undefined], UnlockHistoryResponse>(
    "get_recent_unlock_history"
);
export const getAchievementIcons = callable<[number | null | undefined, string[]], { icons: Record<string, string> }>(
    "get_achievement_icons"
);

let ACHIEVEMENT_ICON_CACHE_GAME_LIMIT = 8;
const achievementIconMemoryCache = new Map<string, string>();
const achievementIconCacheGameOrder: number[] = [];

function achievementIconCacheKey(gameId: number, badgeName: string): string {
    return `${gameId}:${badgeName}`;
}

const achievementIconListeners = new Map<string, Set<(dataUri: string | null) => void>>();

export function subscribeToAchievementIcon(
    gameId: number | null | undefined,
    badgeName: string,
    onResolve: (dataUri: string | null) => void
): () => void {
    if (gameId == null || !badgeName) {
        return () => { };
    }
    const key = achievementIconCacheKey(gameId, badgeName);
    let set = achievementIconListeners.get(key);
    if (!set) {
        set = new Set();
        achievementIconListeners.set(key, set);
    }
    set.add(onResolve);
    return () => {
        const current = achievementIconListeners.get(key);
        if (!current) {
            return;
        }
        current.delete(onResolve);
        if (current.size === 0) {
            achievementIconListeners.delete(key);
        }
    };
}

function notifyAchievementIconListeners(key: string, dataUri: string | null) {
    const listeners = achievementIconListeners.get(key);
    if (!listeners) {
        return;
    }
    for (const fn of listeners) {
        try {
            fn(dataUri);
        }
        catch (e) {
            logError("achievementIcon listener", e);
        }
    }
}

function dropAchievementIconsForGame(gameId: number) {
    const prefix = `${gameId}:`;
    const keysToDelete: string[] = [];
    for (const key of achievementIconMemoryCache.keys()) {
        if (key.startsWith(prefix)) {
            keysToDelete.push(key);
        }
    }
    for (const key of keysToDelete) {
        achievementIconMemoryCache.delete(key);
    }
    const orderIndex = achievementIconCacheGameOrder.indexOf(gameId);
    if (orderIndex >= 0) {
        achievementIconCacheGameOrder.splice(orderIndex, 1);
    }
}

export function getCachedAchievementIcons(
    gameId: number | null | undefined,
    badgeNames: string[]
): Record<string, string> {
    if (gameId == null) {
        return {};
    }
    const result: Record<string, string> = {};
    for (const badgeName of badgeNames) {
        const cached = achievementIconMemoryCache.get(achievementIconCacheKey(gameId, badgeName));
        if (cached) {
            result[badgeName] = cached;
        }
    }
    return result;
}

export function cacheAchievementIcons(
    gameId: number | null | undefined,
    icons: Record<string, string>
) {
    if (gameId == null) {
        return;
    }
    let touchedGame = false;
    for (const badgeName of Object.keys(icons)) {
        const dataUri = icons[badgeName];
        if (dataUri) {
            const key = achievementIconCacheKey(gameId, badgeName);
            achievementIconMemoryCache.set(key, dataUri);
            notifyAchievementIconListeners(key, dataUri);
            touchedGame = true;
        }
    }
    if (!touchedGame) {
        return;
    }

    const existingOrderIndex = achievementIconCacheGameOrder.indexOf(gameId);
    if (existingOrderIndex >= 0) {
        achievementIconCacheGameOrder.splice(existingOrderIndex, 1);
    }
    achievementIconCacheGameOrder.push(gameId);

    while (achievementIconCacheGameOrder.length > ACHIEVEMENT_ICON_CACHE_GAME_LIMIT) {
        const oldestGameId = achievementIconCacheGameOrder[0];
        dropAchievementIconsForGame(oldestGameId);
    }
}

export function applyAchievementIconCacheGames(value: number) {
    if (!Number.isFinite(value) || value < 1) {
        return;
    }
    ACHIEVEMENT_ICON_CACHE_GAME_LIMIT = Math.floor(value);
    while (achievementIconCacheGameOrder.length > ACHIEVEMENT_ICON_CACHE_GAME_LIMIT) {
        const oldestGameId = achievementIconCacheGameOrder[0];
        dropAchievementIconsForGame(oldestGameId);
    }
}

export function clearAchievementIconMemoryCache() {
    achievementIconMemoryCache.clear();
    achievementIconCacheGameOrder.length = 0;
}

const getGameIcon = callable<
    [number | null | undefined, string | null | undefined],
    { dataUri: string | null }
>("get_game_icon");

let GAME_ICON_CACHE_LIMIT = 1024;
const gameIconMemoryCache = new Map<number, string>();
const gameIconCacheOrder: number[] = [];

export function getCachedGameIconDataUri(gameId: number | null | undefined): string | null {
    if (gameId == null) {
        return null;
    }
    return gameIconMemoryCache.get(gameId) ?? null;
}

function storeGameIcon(gameId: number, dataUri: string) {
    const existingIndex = gameIconCacheOrder.indexOf(gameId);
    if (existingIndex >= 0) {
        gameIconCacheOrder.splice(existingIndex, 1);
    }
    gameIconCacheOrder.push(gameId);
    gameIconMemoryCache.set(gameId, dataUri);

    while (gameIconCacheOrder.length > GAME_ICON_CACHE_LIMIT) {
        const oldestGameId = gameIconCacheOrder.shift();
        if (oldestGameId !== undefined) {
            gameIconMemoryCache.delete(oldestGameId);
        }
    }

    notifyGameIconListeners(gameId, dataUri);
}

const gameIconListeners = new Map<number, Set<(dataUri: string | null) => void>>();

export function subscribeToGameIcon(
    gameId: number,
    onResolve: (dataUri: string | null) => void
): () => void {
    let set = gameIconListeners.get(gameId);
    if (!set) {
        set = new Set();
        gameIconListeners.set(gameId, set);
    }
    set.add(onResolve);
    return () => {
        const current = gameIconListeners.get(gameId);
        if (!current) {
            return;
        }
        current.delete(onResolve);
        if (current.size === 0) {
            gameIconListeners.delete(gameId);
        }
    };
}

function notifyGameIconListeners(gameId: number, dataUri: string | null) {
    const listeners = gameIconListeners.get(gameId);
    if (!listeners) {
        return;
    }
    for (const fn of listeners) {
        try {
            fn(dataUri);
        }
        catch (e) {
            logError("gameIcon listener", e);
        }
    }
}

const gameIconInFlight = new Map<string, Promise<{ dataUri: string | null }>>();

export async function getGameIconCached(
    gameId: number | null | undefined,
    imageIcon: string | null | undefined
): Promise<{ dataUri: string | null }> {
    if (gameId == null) {
        return { dataUri: null };
    }
    const cached = gameIconMemoryCache.get(gameId);
    if (cached) {
        return { dataUri: cached };
    }

    const key = `${gameId}|${imageIcon ?? ""}`;
    const pending = gameIconInFlight.get(key);
    if (pending) {
        return pending;
    }

    const run = (async () => {
        const result = await getGameIcon(gameId, imageIcon);
        const dataUri = result?.dataUri ?? null;
        if (dataUri) {
            storeGameIcon(gameId, dataUri);
        }
        return { dataUri };
    })();
    gameIconInFlight.set(key, run);
    try {
        return await run;
    }
    finally {
        gameIconInFlight.delete(key);
    }
}

export function clearGameIconMemoryCache() {
    gameIconMemoryCache.clear();
    gameIconCacheOrder.length = 0;
}

function populateGameIconMemoryCache(
    icons: Record<string | number, string | null> | null | undefined
): void {
    if (!icons) {
        return;
    }
    for (const rawKey of Object.keys(icons)) {
        const gameId = Number(rawKey);
        if (!Number.isFinite(gameId) || gameId <= 0) {
            continue;
        }
        const dataUri = icons[rawKey];
        if (dataUri) {
            storeGameIcon(gameId, dataUri);
        }
    }
}

const getGameIcons = callable<
    [Array<{ gameId: number; imageIcon: string | null }>],
    { icons: Record<string, string | null> }
>("get_game_icons");

const getTabGameIcons = callable<
    [Array<{ gameId: number; imageIcon: string | null }>],
    { icons: Record<string, string | null> }
>("get_tab_game_icons");

let tabIconGeneration = 0;

const cancelTabGameIconsRaw = callable<[], { ok: boolean }>("cancel_tab_game_icons");

export function cancelTabGameIcons(): Promise<{ ok: boolean }> {
    tabIconGeneration += 1;
    return cancelTabGameIconsRaw();
}

const gameIconPendingBatch = new Set<number>();

export function isGameIconBatchPending(gameId: number): boolean {
    return gameIconPendingBatch.has(gameId);
}

export async function prefetchGameIcons(
    entries: ReadonlyArray<{ gameId: number | null | undefined; imageIcon: string | null | undefined }>
): Promise<void> {
    const needed: Array<{ gameId: number; imageIcon: string | null }> = [];
    const seen = new Set<number>();
    for (const raw of entries) {
        const gameId = raw?.gameId;
        if (gameId == null || !Number.isFinite(gameId) || gameId <= 0) {
            continue;
        }
        if (seen.has(gameId)) {
            continue;
        }
        seen.add(gameId);
        if (gameIconMemoryCache.has(gameId)) {
            continue;
        }
        needed.push({
            gameId,
            imageIcon: raw?.imageIcon ?? null,
        });
    }
    if (needed.length === 0) {
        return;
    }
    for (const entry of needed) {
        gameIconPendingBatch.add(entry.gameId);
    }
    try {
        const chunkSize = 24;
        for (let i = 0; i < needed.length; i += chunkSize) {
            const chunk = needed.slice(i, i + chunkSize);
            const result = await getGameIcons(chunk);
            populateGameIconMemoryCache(result?.icons);
        }
    }
    catch (e) {
        logError("prefetchGameIcons", e);
    }
    finally {
        for (const entry of needed) {
            gameIconPendingBatch.delete(entry.gameId);
        }
        for (const entry of needed) {
            if (gameIconMemoryCache.has(entry.gameId)) {
                continue;
            }
            notifyGameIconListeners(entry.gameId, null);
        }
    }
}

const AWARD_ICON_CACHE_LIMIT = 1024;
const awardIconMemoryCache = new Map<string, string>();
const awardIconCacheOrder: string[] = [];

export function getCachedAwardIconDataUri(url: string | null | undefined): string | null {
    if (!url) {
        return null;
    }
    return awardIconMemoryCache.get(url) ?? null;
}

function storeAwardIcon(url: string, dataUri: string) {
    const existingIndex = awardIconCacheOrder.indexOf(url);
    if (existingIndex >= 0) {
        awardIconCacheOrder.splice(existingIndex, 1);
    }
    awardIconCacheOrder.push(url);
    awardIconMemoryCache.set(url, dataUri);

    while (awardIconCacheOrder.length > AWARD_ICON_CACHE_LIMIT) {
        const oldestUrl = awardIconCacheOrder.shift();
        if (oldestUrl !== undefined) {
            awardIconMemoryCache.delete(oldestUrl);
        }
    }

    notifyAwardIconListeners(url, dataUri);
}

const awardIconListeners = new Map<string, Set<(dataUri: string | null) => void>>();

export function subscribeToAwardIcon(
    url: string,
    onResolve: (dataUri: string | null) => void
): () => void {
    let set = awardIconListeners.get(url);
    if (!set) {
        set = new Set();
        awardIconListeners.set(url, set);
    }
    set.add(onResolve);
    return () => {
        const current = awardIconListeners.get(url);
        if (!current) {
            return;
        }
        current.delete(onResolve);
        if (current.size === 0) {
            awardIconListeners.delete(url);
        }
    };
}

function notifyAwardIconListeners(url: string, dataUri: string | null) {
    const listeners = awardIconListeners.get(url);
    if (!listeners) {
        return;
    }
    for (const fn of listeners) {
        try {
            fn(dataUri);
        }
        catch (e) {
            logError("awardIcon listener", e);
        }
    }
}

export function clearAwardIconMemoryCache() {
    awardIconMemoryCache.clear();
    awardIconCacheOrder.length = 0;
}

function populateAwardIconMemoryCache(
    icons: Record<string, string | null> | null | undefined
): void {
    if (!icons) {
        return;
    }
    for (const url of Object.keys(icons)) {
        if (!url) {
            continue;
        }
        const dataUri = icons[url];
        if (dataUri) {
            storeAwardIcon(url, dataUri);
        }
    }
}

const getAwardIcons = callable<
    [Array<{ url: string }>],
    { icons: Record<string, string | null> }
>("get_award_icons");

const awardIconPendingBatch = new Set<string>();

export async function prefetchAwardIcons(
    urls: ReadonlyArray<string | null | undefined>
): Promise<void> {
    const needed: string[] = [];
    const seen = new Set<string>();
    for (const raw of urls) {
        const url = (raw ?? "").trim();
        if (!url || seen.has(url)) {
            continue;
        }
        seen.add(url);
        if (awardIconMemoryCache.has(url)) {
            continue;
        }
        needed.push(url);
    }
    if (needed.length === 0) {
        return;
    }
    for (const url of needed) {
        awardIconPendingBatch.add(url);
    }
    try {
        const chunkSize = 24;
        for (let i = 0; i < needed.length; i += chunkSize) {
            const chunk = needed.slice(i, i + chunkSize);
            const result = await getAwardIcons(chunk.map((url) => ({ url })));
            populateAwardIconMemoryCache(result?.icons);
        }
    }
    catch (e) {
        logError("prefetchAwardIcons", e);
    }
    finally {
        for (const url of needed) {
            awardIconPendingBatch.delete(url);
        }
        for (const url of needed) {
            if (awardIconMemoryCache.has(url)) {
                continue;
            }
            notifyAwardIconListeners(url, null);
        }
    }
}

export async function prefetchTabGameIcons(
    entries: ReadonlyArray<{ gameId: number | null | undefined; imageIcon: string | null | undefined }>
): Promise<void> {
    const needed: Array<{ gameId: number; imageIcon: string | null }> = [];
    const seen = new Set<number>();
    for (const raw of entries) {
        const gameId = raw?.gameId;
        if (gameId == null || !Number.isFinite(gameId) || gameId <= 0) {
            continue;
        }
        if (seen.has(gameId)) {
            continue;
        }
        seen.add(gameId);
        if (gameIconMemoryCache.has(gameId)) {
            continue;
        }
        needed.push({
            gameId,
            imageIcon: raw?.imageIcon ?? null,
        });
    }
    if (needed.length === 0) {
        return;
    }
    const gen = tabIconGeneration;
    try {
        const chunkSize = 24;
        for (let i = 0; i < needed.length; i += chunkSize) {
            if (tabIconGeneration !== gen) {
                return;
            }
            const chunk = needed.slice(i, i + chunkSize);
            const result = await getTabGameIcons(chunk);
            populateGameIconMemoryCache(result?.icons);
        }
    }
    catch (e) {
        logError("prefetchTabGameIcons", e);
    }
}

export type GameImageKind = "icon" | "ingame" | "title" | "boxart";

const getGameImage = callable<
    [number | null | undefined, GameImageKind, string | null | undefined],
    { dataUri: string | null }
>("get_game_image");

let GAME_IMAGE_CACHE_LIMIT = 1024;
const gameImageMemoryCache = new Map<string, string>();
const gameImageCacheOrder: string[] = [];

function gameImageCacheKey(gameId: number, kind: GameImageKind): string {
    return `${gameId}:${kind}`;
}

export function getCachedGameImageDataUri(
    gameId: number | null | undefined,
    kind: GameImageKind
): string | null {
    if (gameId == null) {
        return null;
    }
    return gameImageMemoryCache.get(gameImageCacheKey(gameId, kind)) ?? null;
}

function storeGameImage(key: string, dataUri: string) {
    const existingIndex = gameImageCacheOrder.indexOf(key);
    if (existingIndex >= 0) {
        gameImageCacheOrder.splice(existingIndex, 1);
    }
    gameImageCacheOrder.push(key);
    gameImageMemoryCache.set(key, dataUri);

    while (gameImageCacheOrder.length > GAME_IMAGE_CACHE_LIMIT) {
        const oldest = gameImageCacheOrder.shift();
        if (oldest !== undefined) {
            gameImageMemoryCache.delete(oldest);
        }
    }
}

export function applyGameArtCacheCap(value: number) {
    if (!Number.isFinite(value) || value < 1) {
        return;
    }
    const cap = Math.floor(value);
    GAME_ICON_CACHE_LIMIT = cap;
    GAME_IMAGE_CACHE_LIMIT = cap;

    while (gameIconCacheOrder.length > GAME_ICON_CACHE_LIMIT) {
        const oldestGameId = gameIconCacheOrder.shift();
        if (oldestGameId !== undefined) {
            gameIconMemoryCache.delete(oldestGameId);
        }
    }
    while (gameImageCacheOrder.length > GAME_IMAGE_CACHE_LIMIT) {
        const oldest = gameImageCacheOrder.shift();
        if (oldest !== undefined) {
            gameImageMemoryCache.delete(oldest);
        }
    }
}

export async function getGameImageCached(
    gameId: number | null | undefined,
    kind: GameImageKind,
    imageUrl: string | null | undefined
): Promise<{ dataUri: string | null }> {
    if (gameId == null) {
        return { dataUri: null };
    }
    const memoryKey = gameImageCacheKey(gameId, kind);
    const cached = gameImageMemoryCache.get(memoryKey);
    if (cached) {
        return { dataUri: cached };
    }
    const result = await getGameImage(gameId, kind, imageUrl);
    const dataUri = result?.dataUri ?? null;
    if (dataUri) {
        storeGameImage(memoryKey, dataUri);
    }
    return { dataUri };
}

export function clearGameImageMemoryCache() {
    gameImageMemoryCache.clear();
    gameImageCacheOrder.length = 0;
}

const getUserAvatarCached = callable<[string], { dataUri: string | null }>(
    "get_user_avatar_cached"
);

const getUserAvatarsCached = callable<
    [string[]],
    { avatars: Record<string, string | null> }
>("get_user_avatars_cached");

let USER_AVATAR_CACHE_LIMIT = 1024;
const userAvatarMemoryCache = new Map<string, string>();
const userAvatarCacheOrder: string[] = [];


function normaliseAvatarKey(username: string | null | undefined): string | null {
    const text = String(username || "").trim().toLowerCase();
    return text || null;
}

function cleanAvatarName(username: string | null | undefined): string | null {
    const text = String(username || "").trim();
    return text || null;
}

export function getCachedUserAvatarDataUri(username: string | null | undefined): string | null {
    const key = normaliseAvatarKey(username);
    if (!key) {
        return null;
    }
    return userAvatarMemoryCache.get(key) ?? null;
}

function storeUserAvatar(key: string, dataUri: string) {
    const existingIndex = userAvatarCacheOrder.indexOf(key);
    if (existingIndex >= 0) {
        userAvatarCacheOrder.splice(existingIndex, 1);
    }
    userAvatarCacheOrder.push(key);
    userAvatarMemoryCache.set(key, dataUri);

    while (userAvatarCacheOrder.length > USER_AVATAR_CACHE_LIMIT) {
        const oldest = userAvatarCacheOrder.shift();
        if (oldest !== undefined) {
            userAvatarMemoryCache.delete(oldest);
        }
    }

    notifyUserAvatarListeners(key, dataUri);
}

export function applyAvatarCacheCap(value: number) {
    if (!Number.isFinite(value) || value < 1) {
        return;
    }
    USER_AVATAR_CACHE_LIMIT = Math.floor(value);
    while (userAvatarCacheOrder.length > USER_AVATAR_CACHE_LIMIT) {
        const oldest = userAvatarCacheOrder.shift();
        if (oldest !== undefined) {
            userAvatarMemoryCache.delete(oldest);
        }
    }
}

const userAvatarListeners = new Map<string, Set<(dataUri: string | null) => void>>();

export function subscribeToUserAvatar(
    username: string,
    onResolve: (dataUri: string | null) => void
): () => void {
    const key = normaliseAvatarKey(username);
    if (!key) {
        return () => { };
    }
    let set = userAvatarListeners.get(key);
    if (!set) {
        set = new Set();
        userAvatarListeners.set(key, set);
    }
    set.add(onResolve);
    return () => {
        const current = userAvatarListeners.get(key);
        if (!current) {
            return;
        }
        current.delete(onResolve);
        if (current.size === 0) {
            userAvatarListeners.delete(key);
        }
    };
}

function notifyUserAvatarListeners(key: string, dataUri: string | null) {
    const listeners = userAvatarListeners.get(key);
    if (!listeners) {
        return;
    }
    for (const fn of listeners) {
        try {
            fn(dataUri);
        }
        catch (e) {
            logError("userAvatar listener", e);
        }
    }
}

const userAvatarPendingBatch = new Set<string>();

export function isUserAvatarBatchPending(username: string | null | undefined): boolean {
    const key = normaliseAvatarKey(username);
    if (!key) {
        return false;
    }
    return userAvatarPendingBatch.has(key);
}

const userAvatarInFlight = new Map<string, Promise<{ dataUri: string | null }>>();

async function fetchUserAvatarOnce(key: string, name: string): Promise<{ dataUri: string | null }> {
    const result = await getUserAvatarCached(name);
    const dataUri = result?.dataUri ?? null;
    if (dataUri) {
        storeUserAvatar(key, dataUri);
    }
    return { dataUri };
}

export async function resolveUserAvatar(
    username: string | null | undefined
): Promise<{ dataUri: string | null }> {
    const key = normaliseAvatarKey(username);
    const name = cleanAvatarName(username);
    if (!key || !name) {
        return { dataUri: null };
    }
    const cached = userAvatarMemoryCache.get(key);
    if (cached) {
        return { dataUri: cached };
    }
    const pending = userAvatarInFlight.get(key);
    if (pending) {
        return pending;
    }

    const request = fetchUserAvatarOnce(key, name);
    userAvatarInFlight.set(key, request);
    try {
        return await request;
    } finally {
        userAvatarInFlight.delete(key);
    }
}

export async function refreshHealedUserAvatar(
    username: string | null | undefined
): Promise<void> {
    const key = normaliseAvatarKey(username);
    const name = cleanAvatarName(username);
    if (!key || !name) {
        return;
    }
    try {
        const result = await getUserAvatarCached(name);
        const dataUri = result?.dataUri ?? null;
        if (dataUri) {
            storeUserAvatar(key, dataUri);
        }
    }
    catch (e) {
        logError("refreshHealedUserAvatar", e);
    }
}

export async function prefetchUserAvatars(
    usernames: ReadonlyArray<string | null | undefined>
): Promise<void> {
    const needed: string[] = [];
    const neededKeys: string[] = [];
    const seen = new Set<string>();
    for (const raw of usernames) {
        const key = normaliseAvatarKey(raw);
        const name = cleanAvatarName(raw);
        if (!key || !name || seen.has(key)) {
            continue;
        }
        seen.add(key);
        if (userAvatarMemoryCache.has(key)) {
            continue;
        }
        needed.push(name);
        neededKeys.push(key);
    }
    if (neededKeys.length === 0) {
        return;
    }
    for (const key of neededKeys) {
        userAvatarPendingBatch.add(key);
    }
    try {
        const chunkSize = 24;
        for (let i = 0; i < needed.length; i += chunkSize) {
            const chunk = needed.slice(i, i + chunkSize);
            const result = await getUserAvatarsCached(chunk);
            const avatars = result?.avatars;
            if (avatars) {
                for (const key of Object.keys(avatars)) {
                    const dataUri = avatars[key];
                    if (dataUri) {
                        storeUserAvatar(key, dataUri);
                    }
                }
            }
        }
    }
    catch (e) {
        logError("prefetchUserAvatars", e);
    }
    finally {
        for (const key of neededKeys) {
            userAvatarPendingBatch.delete(key);
        }
        for (const key of neededKeys) {
            if (userAvatarMemoryCache.has(key)) {
                continue;
            }
            notifyUserAvatarListeners(key, null);
        }
    }
}

export function clearUserAvatarMemoryCache() {
    userAvatarMemoryCache.clear();
    userAvatarCacheOrder.length = 0;
}

let accurateAvatarDebug = false;

export function setAccurateAvatarDebug(on: boolean) {
    accurateAvatarDebug = Boolean(on);
}

export function debugLoggingEnabled(): boolean {
    return accurateAvatarDebug;
}

export function logCommentsDebug(stage: string, id: string | number, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logCommentsDebugEvent(stage, String(id), extra || "").catch(() => { });
}

export function logWantToPlayDebug(stage: string, username: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logWantToPlayDebugEvent(stage, username, extra || "").catch(() => { });
}

export function logFocusDebug(stage: string, key: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logFocusDebugEvent(stage, key, extra || "").catch(() => { });
}

export function logNavDebug(stage: string, view: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logNavDebugEvent(stage, view, extra || "").catch(() => { });
}

export function logSortDebug(stage: string, who: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logSortDebugEvent(stage, who, extra || "").catch(() => { });
}

export function logInjectDebug(stage: string, who: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logInjectDebugEvent(stage, who, extra || "").catch(() => { });
}

export function logFriendFetchDebug(stage: string, friend: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logFriendFetchDebugEvent(stage, friend, extra || "").catch(() => { });
}

export function logGuidesDebug(stage: string, key: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logGuidesDebugEvent(stage, key, extra || "").catch(() => { });
}

export function logNotificationsDebug(stage: string, key: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logNotificationsDebugEvent(stage, key, extra || "").catch(() => { });
}

export function logSysviewDebug(stage: string, consoleName: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logSysviewDebugEvent(stage, consoleName, extra || "").catch(() => { });
}

export function logCardCornerDebug(stage: string, key: string, extra?: string) {
    if (!accurateAvatarDebug) {
        return;
    }
    void logCardCornerDebugEvent(stage, key, extra || "").catch(() => { });
}

export const getGameLeaderboards = callable<[number | null | undefined, boolean?], GameLeaderboardsResponse>(
    "get_game_leaderboards"
);
export const getLeaderboardEntries = callable<
    [number | null | undefined, number?, number?],
    LeaderboardEntriesResponse
>("get_leaderboard_entries");
export const getLeaderboardUserEntry = callable<
    [number | null | undefined, number | null | undefined],
    LeaderboardUserEntryResponse
>("get_leaderboard_user_entry");
export const getLeaderboardIcons = callable<
    [
        number | null | undefined,
        Array<{ id: number; title?: string | null; format?: string | null; rankAsc?: boolean | null }>
    ],
    { icons: Record<string, string> }
>("get_leaderboard_icons");
export const saveShowSocialHubButton = callable<[boolean], { ok: boolean; showSocialHubButton: boolean }>(
    "save_show_social_hub_button"
);
export const saveShowTrackedSetsButton = callable<[boolean], { ok: boolean; showTrackedSetsButton: boolean }>(
    "save_show_tracked_sets_button"
);
export const saveShowOptionsButton = callable<[boolean], { ok: boolean; showOptionsButton: boolean }>(
    "save_show_options_button"
);
export const saveQuickMenuShortcuts = callable<
    [QuickMenuShortcut[]],
    { ok: boolean; quickMenuShortcuts: QuickMenuShortcut[] }
>("save_quick_menu_shortcuts");
export const saveLastScalePreset = callable<[ScalePreset], { ok: boolean; lastScalePreset: ScalePreset }>(
    "save_last_scale_preset"
);
export const saveShortcutBinding = callable<
    [ShortcutButton, ShortcutAction],
    { ok: boolean; shortcutBindings: Record<ShortcutButton, ShortcutAction> }
>("save_shortcut_binding");
export const saveShowAllToggleMain = callable<[boolean], { ok: boolean; showAllToggleMain: boolean }>(
    "save_show_all_toggle_main"
);
export const saveShowAllToggleFriend = callable<[boolean], { ok: boolean; showAllToggleFriend: boolean }>(
    "save_show_all_toggle_friend"
);
export const saveShowTrackedNotesMain = callable<[boolean], { ok: boolean; showTrackedNotesMain: boolean }>(
    "save_show_tracked_notes_main"
);
export const saveShowRetroPoints = callable<[boolean], { ok: boolean; showRetroPoints: boolean }>(
    "save_show_retro_points"
);
export const getTrackedAchievements = callable<[number | null | undefined], TrackedAchievementsResponse>(
    "get_tracked_achievements"
);
export const toggleTrackedAchievement = callable<
    [number | null | undefined, number, string | null | undefined, string | null | undefined, string | null | undefined],
    ToggleTrackedResponse
>("toggle_tracked_achievement");
export const bulkToggleTracked = callable<
    [
        number | null | undefined,
        number[],
        BulkToggleTrackedAction,
        string | null | undefined,
        string | null | undefined,
        string | null | undefined,
    ],
    BulkToggleTrackedResponse
>("bulk_toggle_tracked");

export const saveTrackedNote = callable<
    [number | null | undefined, number, string, NoteColor | null | undefined],
    SaveTrackedNoteResponse
>("save_tracked_note");
export const saveDefaultNoteColor = callable<[NoteColor], SaveDefaultNoteColorResponse>(
    "save_default_note_color"
);
export const saveTrackedSortForGame = callable<
    [number | null | undefined, TrackedAchievementSort],
    SaveTrackedSortForGameResponse
>("save_tracked_sort_for_game");
export const clearTrackedAchievements = callable<[number | null | undefined], ClearTrackedResponse>(
    "clear_tracked_achievements"
);
export const clearAllTrackedAchievements = callable<[], ClearAllTrackedResponse>("clear_all_tracked_achievements");
export const getTotalTrackedCount = callable<[], TotalTrackedCountResponse>("get_total_tracked_count");
export const getAllTrackedGames = callable<[], AllTrackedGamesResponse>("get_all_tracked_games");
export const getRecentTagsForGame = callable<[number | null], RecentTagsResponse>("get_recent_tags_for_game");

export const loadGameNotes = callable<[number | null], GameNotesPayload>("load_game_notes");

export const createGameNote = callable<
    [
        number | null,
        string,
        string,
        string | null | undefined,
        NoteColor,
        "off" | "once" | "every",
        number | null | undefined,
        number | null | undefined,
        "minutes" | "hours" | "days" | null | undefined,
    ],
    GameNoteSingleResponse
>("create_game_note");

export const updateGameNote = callable<
    [
        number | null,
        string,
        string,
        string,
        string | null | undefined,
        NoteColor,
        "off" | "once" | "every",
        number | null | undefined,
        number | null | undefined,
        "minutes" | "hours" | "days" | null | undefined,
        boolean,
    ],
    GameNoteSingleResponse
>("update_game_note");

export const deleteGameNote = callable<[number | null, string], GameNoteDeleteResponse>("delete_game_note");

export const reorderGameNotes = callable<[number | null, string[]], OkResult>("reorder_game_notes");

export const setGameNotesSortMode = callable<[number | null, GameNoteSortMode], GameNoteSortResponse>(
    "set_game_notes_sort_mode"
);

export const getPendingGameNoteReminders = callable<
    [number | null],
    PendingGameNoteRemindersResponse
>("get_pending_game_note_reminders");

export const ackGameNoteReminders = callable<
    [number | null, string[]],
    AckGameNoteRemindersResponse
>("ack_game_note_reminders");

export const clearNoteFiredDot = callable<
    [number | null, string],
    ClearNoteFiredDotResponse
>("clear_note_fired_dot");

export const markGameNoteCompleted = callable<
    [number | null, string, boolean],
    GameNoteSingleResponse
>("mark_game_note_completed");

export const deleteAllNotes = callable<[], { ok: boolean; deletedNotes: number }>("delete_all_notes");

export const loadGameGuides = callable<[number | null], GameGuidesRecord>("load_game_guides");

export const saveGuideMapping = callable<
    [number | null, string, string, string],
    { ok: boolean; gamefaqs?: GuidesMapping; error?: string }
>("save_guide_mapping");

export const clearGuideMapping = callable<[number | null], { ok: boolean }>("clear_guide_mapping");

export const saveGuideTypeFilter = callable<
    [number | null, string],
    { ok: boolean; typeFilter?: string }
>("save_guide_type_filter");

export const upsertGuideMeta = callable<
    [number | null, string, string, string, string, string, string],
    { ok: boolean; guide?: GuideUserData; error?: string }
>("upsert_guide_meta");

export const saveGuidePosition = callable<
    [number | null, string, number, string, number, number, string],
    OkResult
>("save_guide_position");

export const addGuideBookmark = callable<
    [number | null, string, string, number, string, number],
    { ok: boolean; bookmark?: GuideBookmark; error?: string }
>("add_guide_bookmark");

export const removeGuideBookmark = callable<
    [number | null, string, string],
    { ok: boolean; deletedId?: string; error?: string }
>("remove_guide_bookmark");

export const renameGuideBookmark = callable<
    [number | null, string, string, string],
    { ok: boolean; bookmark?: GuideBookmark; error?: string }
>("rename_guide_bookmark");

export const getCachedGuidePage = callable<
    [number | null, string, string, boolean?],
    { ok: boolean; cached: boolean; stale?: boolean; html?: string }
>("get_cached_guide_page");

export const saveCachedGuidePage = callable<
    [number | null, string, string, string, string[]?],
    { ok: boolean; cached: boolean; shapeMoved?: boolean }
>("save_cached_guide_page");

export const beginGuideRevalidate = callable<
    [number | null, string, string],
    { ok: boolean; allowed: boolean; generation: number; why?: string }
>("begin_guide_revalidate");

export const finishGuideRevalidate = callable<
    [number | null, string, string, string, number, string[]?],
    { ok: boolean; written?: boolean; changed?: boolean; superseded?: boolean; error?: string }
>("finish_guide_revalidate");

export const getCachedGuideList = callable<
    [number | null, boolean?],
    { ok: boolean; cached: boolean; entries?: GuideListEntry[] }
>("get_cached_guide_list");

export const saveCachedGuideList = callable<
    [number | null, GuideListEntry[]],
    { ok: boolean; cached: boolean }
>("save_cached_guide_list");

export const pruneGuideCacheTo = callable<
    [number | null, string, string[]],
    { ok: boolean; removed: number }
>("prune_guide_cache_to");

export const getCachedGuidePages = callable<
    [number | null, string, string[]],
    { ok: boolean; pages: string[] }
>("get_cached_guide_pages");

export const getOfflineGuides = callable<
    [number | null],
    { ok: boolean; guides: { faqId: string; title: string; author: string; type: string }[] }
>("get_offline_guides");

export const probeGamefaqsReachable = callable<
    [number],
    { ok: boolean; reachable: boolean | null; why?: string }
>("probe_gamefaqs_reachable");

export const clearGuideCache = callable<[], { ok: boolean; removedFiles: number }>("clear_guide_cache");

export const clearAllGuideData = callable<[], { ok: boolean; removedGames: number }>("clear_all_guide_data");

const lastKnownTrackedCountByGame = new Map<number, number>();
const lastKnownTrackedIdsByGame = new Map<number, number[]>();
const lastKnownTrackedNotesByGame = new Map<number, TrackedNotes>();
const lastKnownTrackedNotesColorByGame = new Map<number, TrackedNotesColor>();

export function getCachedTrackedCount(gameId: number | null | undefined): number | null {
    if (gameId == null) {
        return null;
    }
    const cached = lastKnownTrackedCountByGame.get(gameId);
    return cached == null ? null : cached;
}

export function cacheTrackedCount(gameId: number | null | undefined, count: number) {
    if (gameId == null) {
        return;
    }
    lastKnownTrackedCountByGame.set(gameId, Math.max(0, count));
}

export function getCachedTrackedIds(gameId: number | null | undefined): number[] | null {
    if (gameId == null) {
        return null;
    }
    const cached = lastKnownTrackedIdsByGame.get(gameId);
    if (!cached) {
        return null;
    }
    return cached.slice();
}

export function cacheTrackedIds(gameId: number | null | undefined, achievementIds: number[]) {
    if (gameId == null) {
        return;
    }
    lastKnownTrackedIdsByGame.set(gameId, achievementIds.slice());
}

export function getCachedTrackedNotes(gameId: number | null | undefined): TrackedNotes | null {
    if (gameId == null) {
        return null;
    }
    const cached = lastKnownTrackedNotesByGame.get(gameId);
    if (!cached) {
        return null;
    }
    return { ...cached };
}

export function cacheTrackedNotes(gameId: number | null | undefined, notes: TrackedNotes) {
    if (gameId == null) {
        return;
    }
    lastKnownTrackedNotesByGame.set(gameId, { ...notes });
}

export function getCachedTrackedNotesColor(gameId: number | null | undefined): TrackedNotesColor | null {
    if (gameId == null) {
        return null;
    }
    const cached = lastKnownTrackedNotesColorByGame.get(gameId);
    if (!cached) {
        return null;
    }
    return { ...cached };
}

export function cacheTrackedNotesColor(gameId: number | null | undefined, notesColor: TrackedNotesColor) {
    if (gameId == null) {
        return;
    }
    lastKnownTrackedNotesColorByGame.set(gameId, { ...notesColor });
}

export function clearTrackedCountMemoryCache() {
    lastKnownTrackedCountByGame.clear();
    lastKnownTrackedIdsByGame.clear();
    lastKnownTrackedNotesByGame.clear();
    lastKnownTrackedNotesColorByGame.clear();
}

export async function moveTrackedAchievement(
    gameId: number | null,
    achievementId: number,
    direction: ReorderDirection,
    title: string | null,
    consoleName: string | null,
    imageIcon: string | null,
    groupIds?: number[] | null,
): Promise<BulkToggleTrackedResponse> {
    const current = getCachedTrackedIds(gameId) ?? [];
    const idx = current.indexOf(achievementId);
    if (idx < 0) {
        return {
            ok: false,
            achievementIds: current,
            notes: {},
            notesColor: {},
            sort: "manual",
            changed: 0
        };
    }

    const workingIds = groupIds && groupIds.length > 0 ? groupIds.slice() : current.slice();
    const workingIdx = workingIds.indexOf(achievementId);
    if (workingIdx < 0) {
        return {
            ok: false,
            achievementIds: current,
            notes: getCachedTrackedNotes(gameId) ?? {},
            notesColor: getCachedTrackedNotesColor(gameId) ?? {},
            sort: "manual",
            changed: 0
        };
    }

    const rearranged = workingIds.slice();
    rearranged.splice(workingIdx, 1);

    let insertAt: number;
    if (direction === "top") {
        insertAt = 0;
    }
    else if (direction === "bottom") {
        insertAt = rearranged.length;
    }
    else if (direction === "up") {
        insertAt = Math.max(0, workingIdx - 1);
    }
    else {
        insertAt = Math.min(rearranged.length, workingIdx + 1);
    }
    rearranged.splice(insertAt, 0, achievementId);

    if (insertAt === workingIdx) {
        return {
            ok: true,
            achievementIds: current,
            notes: getCachedTrackedNotes(gameId) ?? {},
            notesColor: getCachedTrackedNotesColor(gameId) ?? {},
            sort: "manual",
            changed: 0
        };
    }

    let next: number[];
    if (groupIds && groupIds.length > 0) {
        const groupMembership = new Set(groupIds);
        const rearrangedIter = rearranged[Symbol.iterator]();
        next = current.map((id) => {
            if (!groupMembership.has(id)) {
                return id;
            }
            const nextFromGroup = rearrangedIter.next();
            return nextFromGroup.done ? id : nextFromGroup.value;
        });
    }
    else {
        next = rearranged;
    }

    return bulkToggleTracked(gameId, next, "set", title, consoleName, imageIcon);
}

let nextValidationSkipped = false;

export function markNextValidationSkipped() {
    nextValidationSkipped = true;
}

export function consumeValidationSkip(): boolean {
    if (!nextValidationSkipped) {
        return false;
    }
    nextValidationSkipped = false;
    return true;
}

export const loadGamesListCache = callable<[string], GamesListCacheResult>("load_games_list_cache");
export const loadAwardsListCache = callable<[string], AwardsListCacheResult>("load_awards_list_cache");
export const loadWantToPlayCache = callable<[string], WantToPlayCacheResult>("load_want_to_play_cache");
export const loadFriendsCache = callable<[], { payload: FriendsPayload | null; meta?: unknown }>(
    "load_friends_cache"
);
export const patchFriendRow = callable<[FriendRow], { ok: boolean }>("patch_friend_row");
export const fetchFriendAllGamesFull = callable<[string, string], FriendAllGamesResponse>("fetch_friend_all_games_full");
export const getUserAwards = callable<[string, string], UserAwardsResponse>("get_user_awards");
export const getUserWantToPlay = callable<[string, number?, number?, string?], WantToPlayResponse>(
    "get_user_want_to_play"
);
export const getResumeState = callable<[], ResumeStateResponse>("get_resume_state");
export const saveResumeState = callable<[ResumeState | null | undefined], ResumeStateResponse>("save_resume_state");
export const clearResumeState = callable<[], { ok: boolean }>("clear_resume_state");

export const loadTrackedSets = callable<[], LoadTrackedSetsResponse>("load_tracked_sets");
export const createTrackedSet = callable<[string], TrackedSetResponse>("create_tracked_set");
export const renameTrackedSet = callable<[string, string], TrackedSetResponse>("rename_tracked_set");
export const deleteTrackedSet = callable<[string], OkResult>("delete_tracked_set");
export const setTrackedSetGameSort = callable<[string, TrackedSetGameSort], TrackedSetResponse>(
    "set_tracked_set_game_sort",
);
export const setTrackedSetGameFilter = callable<[string, TrackedSetFilter], TrackedSetResponse>(
    "set_tracked_set_game_filter",
);
export const setTrackedSetViewMode = callable<[string, TrackedSetViewMode], TrackedSetResponse>(
    "set_tracked_set_view_mode",
);
export const touchTrackedSetOpened = callable<[string], TrackedSetResponse>("touch_tracked_set_opened");
export const addGameToSet = callable<[string, AddTrackedSetGamePayload], AddTrackedSetGameResponse>("add_game_to_set");
export const removeGameFromSet = callable<[string, number], TrackedSetResponse>("remove_game_from_set");
export const updateSetGameNote = callable<[string, number, string, NoteColor], TrackedSetResponse>(
    "update_set_game_note",
);
export const reorderSetGames = callable<[string, (string | number)[], TrackedSetViewMode], TrackedSetResponse>("reorder_set_games");
export const clearAllTrackedSets = callable<[], ClearAllTrackedSetsResponse>("clear_all_tracked_sets");
export const getSetConsoleList = callable<[], TrackedSetConsoleListResponse>("get_set_console_list");
export const getSetGameList = callable<[number, boolean?], TrackedSetGameListResponse>("get_set_game_list");
export const checkSetCompletion = callable<[string], TrackedSetResponse>("check_set_completion");
export const checkAllSetsCompletion = callable<[], CheckAllSetsResponse>("check_all_sets_completion");
export const saveTrackedSetsAutoCheck = callable<[boolean], { ok: boolean; trackedSetsAutoCheck: boolean }>(
    "save_tracked_sets_auto_check",
);
export const saveTrackedSetsServiceEnabled = callable<[boolean], { ok: boolean; trackedSetsServiceEnabled: boolean }>(
    "save_tracked_sets_service_enabled",
);
export const saveTrackedSetsRefreshMinutes = callable<[number], { ok: boolean; trackedSetsRefreshMinutes: number }>(
    "save_tracked_sets_refresh_minutes",
);
export const saveTrackedSetsSelectorSort = callable<[TrackedSetSelectorSort], SaveTrackedSetsSelectorSortResponse>(
    "save_tracked_sets_selector_sort",
);
export const saveTrackedSetsSelectorFilter = callable<[TrackedSetFilter], SaveTrackedSetsSelectorFilterResponse>(
    "save_tracked_sets_selector_filter",
);

export const getSubscriptions = callable<[], SubscriptionsResponse>("get_subscriptions");
export const addSubscription = callable<[AddSubscriptionPayload], AddSubscriptionResponse>("add_subscription");
export const removeSubscription = callable<[SubscriptionKind, number], RemoveSubscriptionResponse>("remove_subscription");

export const getSavedCommentKeys = callable<[], SavedCommentKeysResponse>("get_saved_comment_keys");
export const getSavedComments = callable<[], SavedCommentsResponse>("get_saved_comments");
export const saveComment = callable<[SaveCommentPayload], SaveCommentResponse>("save_comment");
export const unsaveComment = callable<[commentId: string], UnsaveCommentResponse>("unsave_comment");
export const clearSavedComments = callable<[], ClearSavedCommentsResponse>("clear_saved_comments");
