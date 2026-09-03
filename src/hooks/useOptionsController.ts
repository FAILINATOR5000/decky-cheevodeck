import { type Dispatch, type RefObject, type SetStateAction } from "react";
import {
    resetOptionSettings,
    applySetupProfile,
    saveActivityCacheMinutes,
    saveTrickleLookbackHours,
    saveActivityFriendsPerTick,
    saveSocialGameTicker,
    saveSocialHubTicker,
    saveSocialActivityTrickleService,
    saveTrickleFavoritesOnly,
    saveFriendAutoRefresh,
    saveShowReminderTicker,
    saveShowNotesDot,
    saveShowBellDot,
    saveNotifyNoteReminderEnabled,
    saveNotifyNoteReminderToast,
    saveNotifyTrackedSetEnabled,
    saveNotifyTrackedSetToast,
    saveNotifyCommentTrackerEnabled,
    saveNotifyCommentTrackerToast,
    saveNotifyWallEnabled,
    saveNotifyWallToast,
    saveNotifySystemEnabled,
    saveNotifySystemToast,
    saveNotifyTrackedEnabled,
    saveNotifyTrackedToast,
    saveNotifySocialUnlockEnabled,
    saveNotifySocialUnlockToast,
    saveNotifyNearYouEnabled,
    saveNotifyNearYouToast,
    saveNotifyDebugEnabled,
    saveNotifyDebugToast,
    fireTestDebugNotification,
    fireTestCommentNotification,
    fireTestUpdateNotification,
    fireTestTrackedSetCompletion,
    injectFakeSelfName,
    injectFakeFriendName,
    saveLegacyAchievementLinks,
    saveLegacyGameLinks,
    saveShowDeveloperOptions,
    saveAutoPurgeService,
    saveTrackedSetsAutoCheck,
    saveTrackedSetsServiceEnabled,
    saveDebugLogging,
    saveAlwaysStaggerMounting,
    saveAutoRefresh,
    saveBigListThreshold,
    saveBlockPadding,
    saveButtonSpacing,
    saveDynamicActivityFeed,
    saveDynamicAllGames,
    saveDynamicTrackedGames,
    saveDynamicBadges,
    saveDynamicFollowedRanking,
    saveDynamicCompare,
    saveDynamicFriendLoading,
    saveDynamicFriendPicker,
    saveDynamicInitialRows,
    saveDynamicLeaderboardLoading,
    saveDynamicLeaderboardResults,
    saveDynamicLoading,
    saveDynamicPrefetchDistance,
    saveDynamicRowStep,
    saveDynamicSentinelRootMargin,
    saveDynamicTrackedListLoading,
    saveDynamicTrackedListInitialRows,
    saveDynamicTrackedListRowStep,
    saveDynamicTrackedListPrefetchDistance,
    saveDynamicTrackedListSentinelRootMargin,
    saveDynamicTrackedSetsListLoading,
    saveDynamicTrackedSetsListInitialRows,
    saveDynamicTrackedSetsListRowStep,
    saveDynamicTrackedSetsListPrefetchDistance,
    saveDynamicTrackedSetsListSentinelRootMargin,
    saveDynamicGameNotesLoading,
    saveDynamicGameNotesInitialRows,
    saveDynamicGameNotesRowStep,
    saveDynamicGameNotesPrefetchDistance,
    saveDynamicGameNotesSentinelRootMargin,
    saveDynamicComments,
    saveDynamicCommentsInitialRows,
    saveDynamicCommentsRowStep,
    saveDynamicCommentsSentinelRootMargin,
    saveControllerGlyphStyle,
    saveColoredGlyphs,
    saveShowAButtonMode,
    saveShowAButtonModeTracked,
    saveFriendRefreshDelayMs,
    saveLanguage,
    saveRememberLastPage,
    saveReturnStaggerFrames,
    saveIpcSlowThresholdMs,
    saveLargeViewportBonusEnabled,
    saveLargeViewportBonus,
    saveParallelRaCalls,
    saveParallelCdnFetches,
    saveMaxIconWorkers,
    saveAvatarWorkers,
    saveGameIconWorkers,
    saveGameArtCacheCap,
    saveAvatarCacheCap,
    saveAchievementIconCacheGames,
    applyGameArtCacheCap,
    applyAvatarCacheCap,
    applyAchievementIconCacheGames,
    saveFriendImageService,
    saveValidateFriendsRoster,
    saveFisTickFrequencyMinutes,
    saveCommentsServiceTickMinutes,
    saveTrackedSetsRefreshMinutes,
    saveCommentsServiceFetchAmount,
    saveCommentsServiceWallCheck,
    saveFisRosterRefreshIntervalHours,
    saveFisVerifyFavoriteAvatars,
    saveFisVerifyAllAvatars,
    savePlayersNearYouEnabled,
    savePlayersNearYouLookbehind,
    savePlayersNearYouLookahead,
    savePlayersNearYouMinTickMinutes,
    savePlayersNearYouMaxTickMinutes,
    saveGamesListCacheMinutes,
    saveAwardsListCacheMinutes,
    saveWantToPlayCacheMinutes,
    setAccurateAvatarDebug,
    saveAchievementStyle,
    saveTrackedColor,
    saveShowIcons,
    saveDeferModalCleanup,
    saveLibraryBadge,
    saveLegacyCommentsLoading,
    saveBatterySaverDisablesSocialActivity,
    saveBatterySaverDisablesComments,
    saveBatterySaverDisablesFriendAvatars,
    saveBatterySaverDisablesPlayersNearYou,
    saveBatterySaverDisablesTrackedSets,
    saveBatterySaverDisablesFileWatcher,
    saveDoNotDisturbDisablesDot,
    saveDoNotDisturbDisablesToast,
    saveNightModeBrightness,
    saveShowSocialHubButton,
    saveShowTrackedSetsButton,
    savePutUpdaterOnDesktop,
    saveShowOptionsButton,
    saveQuickMenuShortcuts,
    saveLastScalePreset,
    saveShortcutBinding,
    saveShowAllToggleMain,
    saveShowAllToggleFriend,
    saveShowTrackedNotesMain,
    saveShowRetroPoints,
    saveSocialEntryDefault,
    saveGameNotesAButtonMode,
    saveActivityCardAction,
    saveFriendFeedCardAction,
    saveSocialHubCardAction,
    saveUiSize,
    saveAchievementTextScale,
    saveCommentsTextScale,
    saveTextScale,
    saveTitleScale,
    saveHeaderScale,
    saveBannerScale,
    saveModalScale,
    saveDisplayScales,
    saveMainUiPreset,
    saveUnlockHistoryDays,
    saveUnlockLookbackMinutes
} from "../api";
import { applyLibraryBadge } from "../components/library/libraryBadgePatch";
import { DEFAULT_LANGUAGE, ensureLanguageLoaded, setCurrentLanguage, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    AchievementStyle,
    ActivityCardAction,
    ControllerGlyphStyle,
    GameNoteAButtonMode,
    MainAchievementAction,
    MainAchievementFilter,
    OptionsTab,
    Payload,
    PlayersNearYouTapMode,
    QuickMenuShortcut,
    ScalePreset,
    ShortcutAction,
    ShortcutButton,
    SavedUser,
    SocialEntryDefault,
    TrackedAchievementAction,
    DolphinMapperMode,
    FileWatcherSpeed,
    TrackedSetAButtonMode,
    TrackedColor,
    ScaleStep,
    UiSize
} from "../types";

import { logError } from "../utils/errors";
import {
    nextActivityCacheMinutes,
    nextAchievementStyle,
    nextControllerGlyphStyle,
    nextTrickleLookbackHours,
    nextActivityFriendsPerTick,
    nextBigListThreshold,
    nextBlockPadding,
    nextButtonSpacing,
    nextDynamicInitialRows,
    nextDynamicPrefetchDistance,
    nextDynamicRowStep,
    nextDynamicSentinelRootMargin,
    nextDynamicTrackedListInitialRows,
    nextDynamicTrackedListRowStep,
    nextDynamicTrackedListPrefetchDistance,
    nextDynamicTrackedListSentinelRootMargin,
    nextDynamicTrackedSetsListInitialRows,
    nextDynamicTrackedSetsListRowStep,
    nextDynamicTrackedSetsListPrefetchDistance,
    nextDynamicTrackedSetsListSentinelRootMargin,
    nextDynamicGameNotesInitialRows,
    nextDynamicGameNotesRowStep,
    nextDynamicGameNotesPrefetchDistance,
    nextDynamicGameNotesSentinelRootMargin,
    nextDynamicCommentsInitialRows,
    nextDynamicCommentsRowStep,
    nextDynamicCommentsSentinelRootMargin,
    nextFriendRefreshDelayMs,
    nextReturnStaggerFrames,
    nextIpcSlowThresholdMs,
    nextLargeViewportBonus,
    nextParallelRaCalls,
    nextParallelCdnFetches,
    nextMaxIconWorkers,
    nextAvatarWorkers,
    nextGameIconWorkers,
    nextNightModeBrightness,
    nextGameArtCacheCap,
    nextAvatarCacheCap,
    nextAchievementIconCacheGames,
    nextFisTickFrequencyMinutes,
    nextCommentsCheckFrequencyMinutes,
    nextTrackedSetRefreshMinutes,
    nextCommentsServiceFetchAmount,
    nextFisRosterRefreshIntervalHours,
    nextPlayersNearYouLookbehind,
    nextPlayersNearYouLookahead,
    nextPlayersNearYouMinTickMinutes,
    nextPlayersNearYouMaxTickMinutes,
    nextGamesListCacheMinutes,
    nextAwardsListCacheMinutes,
    nextWantToPlayCacheMinutes,
    nextSocialEntryDefault,
    nextActivityCardAction,
    nextScaleStep,
    SCALE_PRESETS,
    nextScalePreset,
    type DisplayScales,
    MAIN_UI_PRESETS,
    type MainUiButtons,
    type MainUiPreset,
    QUICK_MENU_SHORTCUTS,
    QUICK_MENU_SHORTCUT_LIMIT,
    DEFAULT_SHORTCUT_BINDINGS,
    nextShortcutAction,
    previousShortcutAction,
    nextUnlockHistoryDays,
    nextUnlockLookbackMinutes
} from "../utils/options";
import { nextTrackedColor } from "../utils/achievements";
import {
    setCurrentTextScale,
    setCurrentTitleScale,
    setCurrentHeaderScale,
    setCurrentBannerScale,
    setCurrentModalScale,
    setCurrentLargeViewportBonusEnabled,
    setCurrentLargeViewportBonus,
    setCurrentGuideZoom,
    setCurrentGuideModalZoom,
    setCurrentTextViewerZoom,
    setCurrentAchievementTextScale,
    setCurrentCommentsTextScale,
    GUIDE_ZOOM_DEFAULT,
    GUIDE_MODAL_ZOOM_DEFAULT,
    TEXT_VIEWER_ZOOM_DEFAULT
} from "../utils/scale";
import { setCurrentColoredGlyphs } from "../utils/controllerGlyphs";

type SaveSettingWithRollback = <T>(options: {
    nextValue: T;
    previousValue: T;
    applyValue: (value: T) => void;
    saveCall: (value: T) => Promise<any>;
    getSavedValue?: (result: any, nextValue: T) => T;
    onSaved?: (result: any, nextValue: T) => Promise<void> | void;
}) => Promise<void>;

type UseOptionsControllerArgs = {
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    loading: boolean;
    saving: boolean;
    checkingGame: boolean;
    clearingCache: boolean;
    clearingGameDataCache: boolean;
    clearingFriendsCache: boolean;
    clearingImagesCache: boolean;
    clearingOtherIconsCache: boolean;
    clearingSocialActivityCache: boolean;
    clearingGameActivityCache: boolean;
    clearingPlayersNearYouCache: boolean;
    clearingGamesListCache: boolean;
    clearingAwardsListCache: boolean;
    clearingWantToPlayCache: boolean;
    clearingGameOverviewCache: boolean;
    clearingAllCache: boolean;
    clearingResolvedAvatars: boolean;
    factoryResetting: boolean;
    refreshingFriends: boolean;
    deepRefreshingFriends: boolean;
    users: SavedUser[];
    addingUser: boolean;
    switchingUser: boolean;
    payload: Payload | null;
    unlockLookbackMinutes: number;
    unlockHistoryDays: number;
    friendRefreshDelayMs: number;
    activityCacheMinutes: number;
    trickleLookbackHours: number;
    activityFriendsPerTick: number;
    socialGameTicker: boolean;
    socialHubTicker: boolean;
    socialActivityTrickleService: boolean;
    trickleFavoritesOnly: boolean;
    friendAutoRefresh: boolean;
    showReminderTicker: boolean;
    showNotesDot: boolean;
    showBellDot: boolean;
    notifyNoteReminderEnabled: boolean;
    notifyNoteReminderToast: boolean;
    notifyTrackedSetEnabled: boolean;
    notifyTrackedSetToast: boolean;
    notifyCommentTrackerEnabled: boolean;
    notifyCommentTrackerToast: boolean;
    notifyWallEnabled: boolean;
    notifyWallToast: boolean;
    notifySystemEnabled: boolean;
    notifySystemToast: boolean;
    notifyTrackedEnabled: boolean;
    notifyTrackedToast: boolean;
    notifySocialUnlockEnabled: boolean;
    notifySocialUnlockToast: boolean;
    notifyNearYouEnabled: boolean;
    notifyNearYouToast: boolean;
    legacyAchievementLinks: boolean;
    legacyGameLinks: boolean;
    showDeveloperOptions: boolean;
    autoPurgeService: boolean;
    keepGuidesOffline: boolean;
    trackedSetsAutoCheck: boolean;
    trackedSetsServiceEnabled: boolean;
    debugLogging: boolean;
    notifyDebugEnabled: boolean;
    notifyDebugToast: boolean;
    ipcSlowThresholdMs: number;
    largeViewportBonusEnabled: boolean;
    largeViewportBonus: number;
    parallelRaCalls: number;
    parallelCdnFetches: number;
    maxIconWorkers: number;
    avatarWorkers: number;
    gameIconWorkers: number;
    gameArtCacheCap: number;
    avatarCacheCap: number;
    achievementIconCacheGames: number;
    friendImageService: boolean;
    validateFriendsRoster: boolean;
    fisTickFrequencyMinutes: number;
    commentsServiceTickMinutes: number;
    trackedSetsRefreshMinutes: number;
    commentsServiceFetchAmount: number;
    commentsServiceWallCheck: boolean;
    fisRosterRefreshIntervalHours: number;
    fisVerifyFavoriteAvatars: boolean;
    fisVerifyAllAvatars: boolean;
    playersNearYouEnabled: boolean;
    playersNearYouLookbehind: number;
    playersNearYouLookahead: number;
    playersNearYouMinTickMinutes: number;
    playersNearYouMaxTickMinutes: number;
    gamesListCacheMinutes: number;
    awardsListCacheMinutes: number;
    wantToPlayCacheMinutes: number;
    bigListThreshold: number;
    alwaysStaggerMounting: boolean;
    returnStaggerFrames: number;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    dynamicTrackedListLoading: boolean;
    dynamicTrackedListInitialRows: number;
    dynamicTrackedListRowStep: number;
    dynamicTrackedListPrefetchDistance: number;
    dynamicTrackedListSentinelRootMargin: number;
    dynamicTrackedSetsListLoading: boolean;
    dynamicTrackedSetsListInitialRows: number;
    dynamicTrackedSetsListRowStep: number;
    dynamicTrackedSetsListPrefetchDistance: number;
    dynamicTrackedSetsListSentinelRootMargin: number;
    dynamicGameNotesLoading: boolean;
    dynamicGameNotesInitialRows: number;
    dynamicGameNotesRowStep: number;
    dynamicGameNotesPrefetchDistance: number;
    dynamicGameNotesSentinelRootMargin: number;
    dynamicComments: boolean;
    dynamicCommentsInitialRows: number;
    dynamicCommentsRowStep: number;
    dynamicCommentsSentinelRootMargin: number;
    dynamicFriendLoading: boolean;
    dynamicLeaderboardLoading: boolean;
    dynamicLeaderboardResults: boolean;
    dynamicActivityFeed: boolean;
    dynamicCompare: boolean;
    dynamicFriendPicker: boolean;
    dynamicAllGames: boolean;
    dynamicTrackedGames: boolean;
    dynamicBadges: boolean;
    dynamicFollowedRanking: boolean;
    blockPadding: number;
    uiSize: UiSize;
    achievementTextScale: ScaleStep;
    commentsTextScale: ScaleStep;
    textScale: ScaleStep;
    titleScale: ScaleStep;
    headerScale: ScaleStep;
    bannerScale: ScaleStep;
    modalScale: ScaleStep;
    showIcons: boolean;
    deferModalCleanup: boolean;
    libraryBadge: boolean;
    legacyCommentsLoading: boolean;
    batterySaverDisablesSocialActivity: boolean;
    batterySaverDisablesComments: boolean;
    batterySaverDisablesFriendAvatars: boolean;
    batterySaverDisablesPlayersNearYou: boolean;
    batterySaverDisablesTrackedSets: boolean;
    batterySaverDisablesFileWatcher: boolean;
    doNotDisturbDisablesDot: boolean;
    doNotDisturbDisablesToast: boolean;
    nightModeBrightness: number;
    autoRefresh: boolean;
    rememberLastPage: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    coloredGlyphs: boolean;
    showAButtonMode: boolean;
    showAButtonModeTracked: boolean;
    showSocialHubButton: boolean;
    showTrackedSetsButton: boolean;
    putUpdaterOnDesktop: boolean;
    showOptionsButton: boolean;
    quickMenuShortcuts: QuickMenuShortcut[];
    quickMenuShortcutRefused: QuickMenuShortcut | null;
    shortcutBindings: Record<ShortcutButton, ShortcutAction>;
    lastScalePreset: ScalePreset;
    showAllToggleMain: boolean;
    showAllToggleFriend: boolean;
    showTrackedNotesMain: boolean;
    showRetroPoints: boolean;
    achievementStyle: AchievementStyle;
    trackedColor: TrackedColor;
    socialEntryDefault: SocialEntryDefault;
    activityCardAction: ActivityCardAction;
    friendFeedCardAction: ActivityCardAction;
    socialHubCardAction: ActivityCardAction;
    gameNotesAButtonMode: GameNoteAButtonMode;
    error: string | null;
    focusScopeResetToken: number;
    activeOptionsTab: OptionsTab;
    onSelectOptionsTab: (tab: OptionsTab) => void;
    setActiveOptionsTab: Dispatch<SetStateAction<OptionsTab>>;
    mountedRef: RefObject<boolean>;
    saveSettingWithRollback: SaveSettingWithRollback;
    setLanguage: Dispatch<SetStateAction<LanguageCode>>;
    setAutoRefresh: Dispatch<SetStateAction<boolean>>;
    setShowIcons: Dispatch<SetStateAction<boolean>>;
    setDeferModalCleanup: Dispatch<SetStateAction<boolean>>;
    setLibraryBadge: Dispatch<SetStateAction<boolean>>;
    setLegacyCommentsLoading: Dispatch<SetStateAction<boolean>>;
    setBatterySaverDisablesSocialActivity: Dispatch<SetStateAction<boolean>>;
    setBatterySaverDisablesComments: Dispatch<SetStateAction<boolean>>;
    setBatterySaverDisablesFriendAvatars: Dispatch<SetStateAction<boolean>>;
    setBatterySaverDisablesPlayersNearYou: Dispatch<SetStateAction<boolean>>;
    setBatterySaverDisablesTrackedSets: Dispatch<SetStateAction<boolean>>;
    setBatterySaverDisablesFileWatcher: Dispatch<SetStateAction<boolean>>;
    setFileWatcherSpeed: Dispatch<SetStateAction<FileWatcherSpeed>>;
    setFileWatcherRunDuringGames: Dispatch<SetStateAction<boolean>>;
    setDoNotDisturbDisablesDot: Dispatch<SetStateAction<boolean>>;
    setDoNotDisturbDisablesToast: Dispatch<SetStateAction<boolean>>;
    setNightModeBrightness: Dispatch<SetStateAction<number>>;
    setShowAllAchievements: Dispatch<SetStateAction<boolean>>;
    setUnlockLookbackMinutes: Dispatch<SetStateAction<number>>;
    setUnlockHistoryDays: Dispatch<SetStateAction<number>>;
    setRememberLastPage: Dispatch<SetStateAction<boolean>>;
    setUiSize: Dispatch<SetStateAction<UiSize>>;
    setAchievementTextScale: Dispatch<SetStateAction<ScaleStep>>;
    setCommentsTextScale: Dispatch<SetStateAction<ScaleStep>>;
    setTextScale: Dispatch<SetStateAction<ScaleStep>>;
    setTitleScale: Dispatch<SetStateAction<ScaleStep>>;
    setHeaderScale: Dispatch<SetStateAction<ScaleStep>>;
    setBannerScale: Dispatch<SetStateAction<ScaleStep>>;
    setModalScale: Dispatch<SetStateAction<ScaleStep>>;
    setBlockPadding: Dispatch<SetStateAction<number>>;
    setButtonSpacing: Dispatch<SetStateAction<ButtonSpacing>>;
    setMouseKeyboardMode: Dispatch<SetStateAction<boolean>>;
    setControllerGlyphStyle: Dispatch<SetStateAction<ControllerGlyphStyle>>;
    setColoredGlyphs: Dispatch<SetStateAction<boolean>>;
    setShowAButtonMode: Dispatch<SetStateAction<boolean>>;
    setShowAButtonModeTracked: Dispatch<SetStateAction<boolean>>;
    setShowSocialHubButton: Dispatch<SetStateAction<boolean>>;
    setShowTrackedSetsButton: Dispatch<SetStateAction<boolean>>;
    setPutUpdaterOnDesktop: Dispatch<SetStateAction<boolean>>;
    setShowOptionsButton: Dispatch<SetStateAction<boolean>>;
    setQuickMenuShortcuts: Dispatch<SetStateAction<QuickMenuShortcut[]>>;
    setQuickMenuShortcutRefused: Dispatch<SetStateAction<QuickMenuShortcut | null>>;
    setShortcutBindings: Dispatch<SetStateAction<Record<ShortcutButton, ShortcutAction>>>;
    setLastScalePreset: Dispatch<SetStateAction<ScalePreset>>;
    setShowAllToggleMain: Dispatch<SetStateAction<boolean>>;
    setShowAllToggleFriend: Dispatch<SetStateAction<boolean>>;
    setShowTrackedNotesMain: Dispatch<SetStateAction<boolean>>;
    setShowRetroPoints: Dispatch<SetStateAction<boolean>>;
    setAchievementStyle: Dispatch<SetStateAction<AchievementStyle>>;
    setTrackedColor: Dispatch<SetStateAction<TrackedColor>>;
    setSocialEntryDefault: Dispatch<SetStateAction<SocialEntryDefault>>;
    setActivityCardAction: Dispatch<SetStateAction<ActivityCardAction>>;
    setFriendFeedCardAction: Dispatch<SetStateAction<ActivityCardAction>>;
    setSocialHubCardAction: Dispatch<SetStateAction<ActivityCardAction>>;
    setGameNotesAButtonMode: Dispatch<SetStateAction<GameNoteAButtonMode>>;
    setMainAchievementFilter: Dispatch<SetStateAction<MainAchievementFilter>>;
    setMainAchievementAction: Dispatch<SetStateAction<MainAchievementAction>>;
    setTrackedAchievementAction: Dispatch<SetStateAction<TrackedAchievementAction>>;
    setDolphinMapperMode: Dispatch<SetStateAction<DolphinMapperMode>>;
    setDolphinBluetoothPassthrough: Dispatch<SetStateAction<boolean>>;
    setDolphinContinuousScanning: Dispatch<SetStateAction<boolean>>;
    setDolphinBalanceBoard: Dispatch<SetStateAction<boolean>>;
    setTrackedSetAButtonMode: Dispatch<SetStateAction<TrackedSetAButtonMode>>;
    setFriendRefreshDelayMs: Dispatch<SetStateAction<number>>;
    setActivityCacheMinutes: Dispatch<SetStateAction<number>>;
    setTrickleLookbackHours: Dispatch<SetStateAction<number>>;
    setActivityFriendsPerTick: Dispatch<SetStateAction<number>>;
    setSocialGameTicker: Dispatch<SetStateAction<boolean>>;
    setSocialHubTicker: Dispatch<SetStateAction<boolean>>;
    setSocialActivityTrickleService: Dispatch<SetStateAction<boolean>>;
    setTrickleFavoritesOnly: Dispatch<SetStateAction<boolean>>;
    setFriendAutoRefresh: Dispatch<SetStateAction<boolean>>;
    setShowReminderTicker: Dispatch<SetStateAction<boolean>>;
    setShowNotesDot: Dispatch<SetStateAction<boolean>>;
    setShowBellDot: Dispatch<SetStateAction<boolean>>;
    setNotifyNoteReminderEnabled: Dispatch<SetStateAction<boolean>>;
    setNotifyNoteReminderToast: Dispatch<SetStateAction<boolean>>;
    setNotifyTrackedSetEnabled: Dispatch<SetStateAction<boolean>>;
    setNotifyTrackedSetToast: Dispatch<SetStateAction<boolean>>;
    setNotifyCommentTrackerEnabled: Dispatch<SetStateAction<boolean>>;
    setNotifyCommentTrackerToast: Dispatch<SetStateAction<boolean>>;
    setNotifyWallEnabled: Dispatch<SetStateAction<boolean>>;
    setNotifyWallToast: Dispatch<SetStateAction<boolean>>;
    setNotifySystemEnabled: Dispatch<SetStateAction<boolean>>;
    setNotifySystemToast: Dispatch<SetStateAction<boolean>>;
    setNotifyTrackedEnabled: Dispatch<SetStateAction<boolean>>;
    setNotifyTrackedToast: Dispatch<SetStateAction<boolean>>;
    setNotifySocialUnlockEnabled: Dispatch<SetStateAction<boolean>>;
    setNotifySocialUnlockToast: Dispatch<SetStateAction<boolean>>;
    setNotifyNearYouEnabled: Dispatch<SetStateAction<boolean>>;
    setNotifyNearYouToast: Dispatch<SetStateAction<boolean>>;
    setLegacyAchievementLinks: Dispatch<SetStateAction<boolean>>;
    setLegacyGameLinks: Dispatch<SetStateAction<boolean>>;
    setPinLatestGuides: Dispatch<SetStateAction<boolean>>;
    setKeepGuidesOffline: Dispatch<SetStateAction<boolean>>;
    setShowDeveloperOptions: Dispatch<SetStateAction<boolean>>;
    setAutoPurgeService: Dispatch<SetStateAction<boolean>>;
    setTrackedSetsAutoCheck: Dispatch<SetStateAction<boolean>>;
    setTrackedSetsServiceEnabled: Dispatch<SetStateAction<boolean>>;
    setDebugLogging: Dispatch<SetStateAction<boolean>>;
    setNotifyDebugEnabled: Dispatch<SetStateAction<boolean>>;
    setNotifyDebugToast: Dispatch<SetStateAction<boolean>>;
    setIpcSlowThresholdMs: Dispatch<SetStateAction<number>>;
    setLargeViewportBonusEnabled: Dispatch<SetStateAction<boolean>>;
    setLargeViewportBonus: Dispatch<SetStateAction<number>>;
    setParallelRaCalls: Dispatch<SetStateAction<number>>;
    setParallelCdnFetches: Dispatch<SetStateAction<number>>;
    setMaxIconWorkers: Dispatch<SetStateAction<number>>;
    setAvatarWorkers: Dispatch<SetStateAction<number>>;
    setGameIconWorkers: Dispatch<SetStateAction<number>>;
    setGameArtCacheCap: Dispatch<SetStateAction<number>>;
    setAvatarCacheCap: Dispatch<SetStateAction<number>>;
    setAchievementIconCacheGames: Dispatch<SetStateAction<number>>;
    setFriendImageService: Dispatch<SetStateAction<boolean>>;
    setValidateFriendsRoster: Dispatch<SetStateAction<boolean>>;
    setFisTickFrequencyMinutes: Dispatch<SetStateAction<number>>;
    setCommentsServiceTickMinutes: Dispatch<SetStateAction<number>>;
    setTrackedSetsRefreshMinutes: Dispatch<SetStateAction<number>>;
    setCommentsServiceFetchAmount: Dispatch<SetStateAction<number>>;
    setCommentsServiceWallCheck: Dispatch<SetStateAction<boolean>>;
    setFisRosterRefreshIntervalHours: Dispatch<SetStateAction<number>>;
    setFisVerifyFavoriteAvatars: Dispatch<SetStateAction<boolean>>;
    setFisVerifyAllAvatars: Dispatch<SetStateAction<boolean>>;
    setPlayersNearYouEnabled: Dispatch<SetStateAction<boolean>>;
    setPlayersNearYouLookbehind: Dispatch<SetStateAction<number>>;
    setPlayersNearYouLookahead: Dispatch<SetStateAction<number>>;
    setPlayersNearYouMinTickMinutes: Dispatch<SetStateAction<number>>;
    setPlayersNearYouMaxTickMinutes: Dispatch<SetStateAction<number>>;
    setGamesListCacheMinutes: Dispatch<SetStateAction<number>>;
    setAwardsListCacheMinutes: Dispatch<SetStateAction<number>>;
    setWantToPlayCacheMinutes: Dispatch<SetStateAction<number>>;
    setPlayersNearYouTapMode: Dispatch<SetStateAction<PlayersNearYouTapMode>>;
    setBigListThreshold: Dispatch<SetStateAction<number>>;
    setAlwaysStaggerMounting: Dispatch<SetStateAction<boolean>>;
    setReturnStaggerFrames: Dispatch<SetStateAction<number>>;
    setDynamicLoading: Dispatch<SetStateAction<boolean>>;
    setDynamicInitialRows: Dispatch<SetStateAction<number>>;
    setDynamicRowStep: Dispatch<SetStateAction<number>>;
    setDynamicPrefetchDistance: Dispatch<SetStateAction<number>>;
    setDynamicSentinelRootMargin: Dispatch<SetStateAction<number>>;
    setDynamicTrackedListLoading: Dispatch<SetStateAction<boolean>>;
    setDynamicTrackedListInitialRows: Dispatch<SetStateAction<number>>;
    setDynamicTrackedListRowStep: Dispatch<SetStateAction<number>>;
    setDynamicTrackedListPrefetchDistance: Dispatch<SetStateAction<number>>;
    setDynamicTrackedListSentinelRootMargin: Dispatch<SetStateAction<number>>;
    setDynamicTrackedSetsListLoading: Dispatch<SetStateAction<boolean>>;
    setDynamicTrackedSetsListInitialRows: Dispatch<SetStateAction<number>>;
    setDynamicTrackedSetsListRowStep: Dispatch<SetStateAction<number>>;
    setDynamicTrackedSetsListPrefetchDistance: Dispatch<SetStateAction<number>>;
    setDynamicTrackedSetsListSentinelRootMargin: Dispatch<SetStateAction<number>>;
    setDynamicGameNotesLoading: Dispatch<SetStateAction<boolean>>;
    setDynamicGameNotesInitialRows: Dispatch<SetStateAction<number>>;
    setDynamicGameNotesRowStep: Dispatch<SetStateAction<number>>;
    setDynamicGameNotesPrefetchDistance: Dispatch<SetStateAction<number>>;
    setDynamicGameNotesSentinelRootMargin: Dispatch<SetStateAction<number>>;
    setDynamicComments: Dispatch<SetStateAction<boolean>>;
    setDynamicCommentsInitialRows: Dispatch<SetStateAction<number>>;
    setDynamicCommentsRowStep: Dispatch<SetStateAction<number>>;
    setDynamicCommentsSentinelRootMargin: Dispatch<SetStateAction<number>>;
    setDynamicFriendLoading: Dispatch<SetStateAction<boolean>>;
    setDynamicLeaderboardLoading: Dispatch<SetStateAction<boolean>>;
    setDynamicLeaderboardResults: Dispatch<SetStateAction<boolean>>;
    setDynamicActivityFeed: Dispatch<SetStateAction<boolean>>;
    setDynamicCompare: Dispatch<SetStateAction<boolean>>;
    setDynamicFriendPicker: Dispatch<SetStateAction<boolean>>;
    setDynamicAllGames: Dispatch<SetStateAction<boolean>>;
    setDynamicTrackedGames: Dispatch<SetStateAction<boolean>>;
    setDynamicBadges: Dispatch<SetStateAction<boolean>>;
    setDynamicFollowedRanking: Dispatch<SetStateAction<boolean>>;
    setPendingPrimaryViewRestoreGameId: Dispatch<SetStateAction<number | null | undefined>>;
    setError: Dispatch<SetStateAction<string | null>>;
    clearPendingResumeState: () => void;
    enableRememberLastPagePersistence: () => Promise<void>;
    disableRememberLastPagePersistence: () => Promise<void>;
    onBack: () => void | Promise<void>;
    onGoToAbout: () => void | Promise<void>;
    onRefreshNow: () => void | Promise<void>;
    onAfterSelfRename: () => void | Promise<void>;
    onEditCredentials: () => void | Promise<void>;
    onOpenSetupProfiles: () => void | Promise<void>;
    onAddUser: () => void | Promise<void>;
    onSwitchUser: () => void | Promise<void>;
    onOpenLanguage: () => void | Promise<void>;
    onClearGameData: () => void | Promise<void>;
    onSimulateNoGame: () => void | Promise<void>;
    onPreviewBootCat: () => void | Promise<void>;
    onClearFriendsCache: () => void | Promise<void>;
    onManualRefreshFriends: () => void | Promise<void>;
    onDeepRosterRefresh: () => void | Promise<void>;
    onClearImages: () => void | Promise<void>;
    onClearOtherIcons: () => void | Promise<void>;
    onClearSocialActivity: () => void | Promise<void>;
    onClearGameActivity: () => void | Promise<void>;
    onClearPlayersNearYou: () => void | Promise<void>;
    onClearGamesListCache: () => void | Promise<void>;
    onClearAwardsListCache: () => void | Promise<void>;
    onClearWantToPlayCache: () => void | Promise<void>;
    onClearGameOverviewCache: () => void | Promise<void>;
    onClearAllCache: () => void | Promise<void>;
    onClearSetsCache: () => void | Promise<void>;
    onClearCheevoCheckResults: () => void | Promise<void>;
    onClearCheevoCheckHashes: () => void | Promise<void>;
    onClearCheevoCheckRaData: () => void | Promise<void>;
    onClearFileWatcherReport: () => void | Promise<void>;
    onClearFileWatcherMap: () => void | Promise<void>;
    onClearFileWatcherEverything: () => void | Promise<void>;
    onClearFileWatcherRunTimes: () => void | Promise<void>;
    onDeleteLeaderboardsCache: () => void | Promise<void>;
    onClearResolvedAvatars: () => void | Promise<void>;
    onClearTracked: () => void | Promise<void>;
    onClearAllTracked: () => void | Promise<void>;
    onClearAllTrackedSets: () => void | Promise<void>;
    onClearDolphinMappings: () => void | Promise<void>;
    onResetDolphinMappings: () => void | Promise<void>;
    onCleanupDirectory: () => void | Promise<void>;
    onUpdateCheevoCheckReferenceData: () => void | Promise<void>;
    onFactoryReset: () => void | Promise<void>;
    onDeleteAllNotes: () => void | Promise<void>;
    onClearGuideCache: () => void | Promise<void>;
    onToggleKeepGuidesOffline: (value: boolean) => void | Promise<void>;
    onDeleteAllGuideData: () => void | Promise<void>;
    onDeleteAllNotifications: () => void | Promise<void>;
    onClearArchivedNotifications: () => void | Promise<void>;
    onClearSavedComments: () => void | Promise<void>;
};

export function useOptionsController({
    language,
    buttonSpacing,
    loading,
    saving,
    checkingGame,
    clearingCache,
    clearingGameDataCache,
    clearingFriendsCache,
    clearingImagesCache,
    clearingOtherIconsCache,
    clearingSocialActivityCache,
    clearingGameActivityCache,
    clearingPlayersNearYouCache,
    clearingGamesListCache,
    clearingAwardsListCache,
    clearingWantToPlayCache,
    clearingGameOverviewCache,
    clearingAllCache,
    clearingResolvedAvatars,
    factoryResetting,
    refreshingFriends,
    deepRefreshingFriends,
    users,
    addingUser,
    switchingUser,
    payload,
    unlockLookbackMinutes,
    unlockHistoryDays,
    friendRefreshDelayMs,
    activityCacheMinutes,
    trickleLookbackHours,
    activityFriendsPerTick,
    socialGameTicker,
    socialHubTicker,
    socialActivityTrickleService,
    trickleFavoritesOnly,
    friendAutoRefresh,
    showReminderTicker,
    showNotesDot,
    showBellDot,
    notifyNoteReminderEnabled,
    notifyNoteReminderToast,
    notifyTrackedSetEnabled,
    notifyTrackedSetToast,
    notifyCommentTrackerEnabled,
    notifyCommentTrackerToast,
    notifyWallEnabled,
    notifyWallToast,
    notifySystemEnabled,
    notifySystemToast,
    notifyTrackedEnabled,
    notifyTrackedToast,
    notifySocialUnlockEnabled,
    notifySocialUnlockToast,
    notifyNearYouEnabled,
    notifyNearYouToast,
    legacyAchievementLinks,
    legacyGameLinks,
    showDeveloperOptions,
    autoPurgeService,
    keepGuidesOffline,
    trackedSetsAutoCheck,
    trackedSetsServiceEnabled,
    debugLogging,
    notifyDebugEnabled,
    notifyDebugToast,
    ipcSlowThresholdMs,
    largeViewportBonusEnabled,
    largeViewportBonus,
    parallelRaCalls,
    parallelCdnFetches,
    maxIconWorkers,
    avatarWorkers,
    gameIconWorkers,
    gameArtCacheCap,
    avatarCacheCap,
    achievementIconCacheGames,
    friendImageService,
    validateFriendsRoster,
    fisTickFrequencyMinutes,
    commentsServiceTickMinutes,
    trackedSetsRefreshMinutes,
    commentsServiceFetchAmount,
    commentsServiceWallCheck,
    fisRosterRefreshIntervalHours,
    fisVerifyFavoriteAvatars,
    fisVerifyAllAvatars,
    playersNearYouEnabled,
    playersNearYouLookbehind,
    playersNearYouLookahead,
    playersNearYouMinTickMinutes,
    playersNearYouMaxTickMinutes,
    gamesListCacheMinutes,
    awardsListCacheMinutes,
    wantToPlayCacheMinutes,
    bigListThreshold,
    alwaysStaggerMounting,
    returnStaggerFrames,
    dynamicLoading,
    dynamicInitialRows,
    dynamicRowStep,
    dynamicPrefetchDistance,
    dynamicSentinelRootMargin,
    dynamicTrackedListLoading,
    dynamicTrackedListInitialRows,
    dynamicTrackedListRowStep,
    dynamicTrackedListPrefetchDistance,
    dynamicTrackedListSentinelRootMargin,
    dynamicTrackedSetsListLoading,
    dynamicTrackedSetsListInitialRows,
    dynamicTrackedSetsListRowStep,
    dynamicTrackedSetsListPrefetchDistance,
    dynamicTrackedSetsListSentinelRootMargin,
    dynamicGameNotesLoading,
    dynamicGameNotesInitialRows,
    dynamicGameNotesRowStep,
    dynamicGameNotesPrefetchDistance,
    dynamicGameNotesSentinelRootMargin,
    dynamicComments,
    dynamicCommentsInitialRows,
    dynamicCommentsRowStep,
    dynamicCommentsSentinelRootMargin,
    dynamicFriendLoading,
    dynamicLeaderboardLoading,
    dynamicLeaderboardResults,
    dynamicActivityFeed,
    dynamicCompare,
    dynamicFriendPicker,
    dynamicAllGames,
    dynamicTrackedGames,
    dynamicBadges,
    dynamicFollowedRanking,
    blockPadding,
    uiSize,
    achievementTextScale,
    commentsTextScale,
    textScale,
    titleScale,
    headerScale,
    bannerScale,
    modalScale,
    showIcons,
    deferModalCleanup,
    libraryBadge,
    legacyCommentsLoading,
    batterySaverDisablesSocialActivity,
    batterySaverDisablesComments,
    batterySaverDisablesFriendAvatars,
    batterySaverDisablesPlayersNearYou,
    batterySaverDisablesTrackedSets,
    batterySaverDisablesFileWatcher,
    doNotDisturbDisablesDot,
    doNotDisturbDisablesToast,
    nightModeBrightness,
    autoRefresh,
    rememberLastPage,
    controllerGlyphStyle,
    coloredGlyphs,
    showAButtonMode,
    showAButtonModeTracked,
    showSocialHubButton,
    showTrackedSetsButton,
    putUpdaterOnDesktop,
    showOptionsButton,
    quickMenuShortcuts,
    quickMenuShortcutRefused,
    shortcutBindings,
    lastScalePreset,
    showAllToggleMain,
    showAllToggleFriend,
    showTrackedNotesMain,
    showRetroPoints,
    achievementStyle,
    trackedColor,
    socialEntryDefault,
    activityCardAction,
    friendFeedCardAction,
    socialHubCardAction,
    gameNotesAButtonMode,
    error,
    focusScopeResetToken,
    activeOptionsTab,
    onSelectOptionsTab,
    setActiveOptionsTab,
    mountedRef,
    saveSettingWithRollback,
    setLanguage,
    setAutoRefresh,
    setShowIcons,
    setDeferModalCleanup,
    setLibraryBadge,
    setLegacyCommentsLoading,
    setBatterySaverDisablesSocialActivity,
    setBatterySaverDisablesComments,
    setBatterySaverDisablesFriendAvatars,
    setBatterySaverDisablesPlayersNearYou,
    setBatterySaverDisablesTrackedSets,
    setBatterySaverDisablesFileWatcher,
    setFileWatcherSpeed,
    setFileWatcherRunDuringGames,
    setDoNotDisturbDisablesDot,
    setDoNotDisturbDisablesToast,
    setNightModeBrightness,
    setShowAllAchievements,
    setUnlockLookbackMinutes,
    setUnlockHistoryDays,
    setRememberLastPage,
    setUiSize,
    setAchievementTextScale,
    setCommentsTextScale,
    setTextScale,
    setTitleScale,
    setHeaderScale,
    setBannerScale,
    setModalScale,
    setBlockPadding,
    setButtonSpacing,
    setMouseKeyboardMode,
    setControllerGlyphStyle,
    setColoredGlyphs,
    setShowAButtonMode,
    setShowAButtonModeTracked,
    setShowSocialHubButton,
    setShowTrackedSetsButton,
    setPutUpdaterOnDesktop,
    setShowOptionsButton,
    setQuickMenuShortcuts,
    setQuickMenuShortcutRefused,
    setShortcutBindings,
    setLastScalePreset,
    setShowAllToggleMain,
    setShowAllToggleFriend,
    setShowTrackedNotesMain,
    setShowRetroPoints,
    setAchievementStyle,
    setTrackedColor,
    setSocialEntryDefault,
    setActivityCardAction,
    setFriendFeedCardAction,
    setSocialHubCardAction,
    setGameNotesAButtonMode,
    setMainAchievementFilter,
    setMainAchievementAction,
    setTrackedAchievementAction,
    setDolphinMapperMode,
    setDolphinBluetoothPassthrough,
    setDolphinContinuousScanning,
    setDolphinBalanceBoard,
    setTrackedSetAButtonMode,
    setFriendRefreshDelayMs,
    setActivityCacheMinutes,
    setTrickleLookbackHours,
    setActivityFriendsPerTick,
    setSocialGameTicker,
    setSocialHubTicker,
    setSocialActivityTrickleService,
    setTrickleFavoritesOnly,
    setFriendAutoRefresh,
    setShowReminderTicker,
    setShowNotesDot,
    setShowBellDot,
    setNotifyNoteReminderEnabled,
    setNotifyNoteReminderToast,
    setNotifyTrackedSetEnabled,
    setNotifyTrackedSetToast,
    setNotifyCommentTrackerEnabled,
    setNotifyCommentTrackerToast,
    setNotifyWallEnabled,
    setNotifyWallToast,
    setNotifySystemEnabled,
    setNotifySystemToast,
    setNotifyTrackedEnabled,
    setNotifyTrackedToast,
    setNotifySocialUnlockEnabled,
    setNotifySocialUnlockToast,
    setNotifyNearYouEnabled,
    setNotifyNearYouToast,
    setLegacyAchievementLinks,
    setLegacyGameLinks,
    setPinLatestGuides,
    setKeepGuidesOffline,
    setShowDeveloperOptions,
    setAutoPurgeService,
    setTrackedSetsAutoCheck,
    setTrackedSetsServiceEnabled,
    setDebugLogging,
    setNotifyDebugEnabled,
    setNotifyDebugToast,
    setIpcSlowThresholdMs,
    setLargeViewportBonusEnabled,
    setLargeViewportBonus,
    setParallelRaCalls,
    setParallelCdnFetches,
    setMaxIconWorkers,
    setAvatarWorkers,
    setGameIconWorkers,
    setGameArtCacheCap,
    setAvatarCacheCap,
    setAchievementIconCacheGames,
    setFriendImageService,
    setValidateFriendsRoster,
    setFisTickFrequencyMinutes,
    setCommentsServiceTickMinutes,
    setTrackedSetsRefreshMinutes,
    setCommentsServiceFetchAmount,
    setCommentsServiceWallCheck,
    setFisRosterRefreshIntervalHours,
    setFisVerifyFavoriteAvatars,
    setFisVerifyAllAvatars,
    setPlayersNearYouEnabled,
    setPlayersNearYouLookbehind,
    setPlayersNearYouLookahead,
    setPlayersNearYouMinTickMinutes,
    setPlayersNearYouMaxTickMinutes,
    setGamesListCacheMinutes,
    setAwardsListCacheMinutes,
    setWantToPlayCacheMinutes,
    setPlayersNearYouTapMode,
    setBigListThreshold,
    setAlwaysStaggerMounting,
    setReturnStaggerFrames,
    setDynamicLoading,
    setDynamicInitialRows,
    setDynamicRowStep,
    setDynamicPrefetchDistance,
    setDynamicSentinelRootMargin,
    setDynamicTrackedListLoading,
    setDynamicTrackedListInitialRows,
    setDynamicTrackedListRowStep,
    setDynamicTrackedListPrefetchDistance,
    setDynamicTrackedListSentinelRootMargin,
    setDynamicTrackedSetsListLoading,
    setDynamicTrackedSetsListInitialRows,
    setDynamicTrackedSetsListRowStep,
    setDynamicTrackedSetsListPrefetchDistance,
    setDynamicTrackedSetsListSentinelRootMargin,
    setDynamicGameNotesLoading,
    setDynamicGameNotesInitialRows,
    setDynamicGameNotesRowStep,
    setDynamicGameNotesPrefetchDistance,
    setDynamicGameNotesSentinelRootMargin,
    setDynamicComments,
    setDynamicCommentsInitialRows,
    setDynamicCommentsRowStep,
    setDynamicCommentsSentinelRootMargin,
    setDynamicFriendLoading,
    setDynamicLeaderboardLoading,
    setDynamicLeaderboardResults,
    setDynamicActivityFeed,
    setDynamicCompare,
    setDynamicFriendPicker,
    setDynamicAllGames,
    setDynamicTrackedGames,
    setDynamicBadges,
    setDynamicFollowedRanking,
    setPendingPrimaryViewRestoreGameId,
    setError,
    clearPendingResumeState,
    enableRememberLastPagePersistence,
    disableRememberLastPagePersistence,
    onBack,
    onGoToAbout,
    onRefreshNow,
    onAfterSelfRename,
    onEditCredentials,
    onOpenSetupProfiles,
    onAddUser,
    onSwitchUser,
    onOpenLanguage,
    onClearGameData,
    onSimulateNoGame,
    onPreviewBootCat,
    onClearFriendsCache,
    onManualRefreshFriends,
    onDeepRosterRefresh,
    onClearImages,
    onClearOtherIcons,
    onClearSocialActivity,
    onClearGameActivity,
    onClearPlayersNearYou,
    onClearGamesListCache,
    onClearAwardsListCache,
    onClearWantToPlayCache,
    onClearGameOverviewCache,
    onClearAllCache,
    onClearSetsCache,
    onClearCheevoCheckResults,
    onClearCheevoCheckHashes,
    onClearCheevoCheckRaData,
    onClearFileWatcherReport,
    onClearFileWatcherMap,
    onClearFileWatcherEverything,
    onClearFileWatcherRunTimes,
    onDeleteLeaderboardsCache,
    onClearResolvedAvatars,
    onClearTracked,
    onClearAllTracked,
    onClearAllTrackedSets,
    onClearDolphinMappings,
    onResetDolphinMappings,
    onCleanupDirectory,
    onUpdateCheevoCheckReferenceData,
    onFactoryReset,
    onDeleteAllNotes,
    onClearGuideCache,
    onToggleKeepGuidesOffline,
    onDeleteAllGuideData,
    onDeleteAllNotifications,
    onClearArchivedNotifications,
    onClearSavedComments
}: UseOptionsControllerArgs) {

    const applyResetResult = (result: any) => {
        setAutoRefresh(Boolean(result.autoRefresh));
        setShowIcons(Boolean(result.showIcons));
        setDeferModalCleanup(Boolean(result.deferModalCleanup ?? true));
        setLegacyCommentsLoading(Boolean(result.legacyCommentsLoading));
        setBatterySaverDisablesSocialActivity(Boolean(result.batterySaverDisablesSocialActivity ?? true));
        setBatterySaverDisablesComments(Boolean(result.batterySaverDisablesComments ?? true));
        setBatterySaverDisablesFriendAvatars(Boolean(result.batterySaverDisablesFriendAvatars ?? true));
        setBatterySaverDisablesPlayersNearYou(Boolean(result.batterySaverDisablesPlayersNearYou ?? true));
        setBatterySaverDisablesTrackedSets(Boolean(result.batterySaverDisablesTrackedSets ?? true));
        setBatterySaverDisablesFileWatcher(Boolean(result.batterySaverDisablesFileWatcher ?? true));
        setFileWatcherSpeed(result.fileWatcherSpeed ?? "gentle");
        setFileWatcherRunDuringGames(Boolean(result.fileWatcherRunDuringGames ?? true));
        setDoNotDisturbDisablesDot(Boolean(result.doNotDisturbDisablesDot ?? true));
        setDoNotDisturbDisablesToast(Boolean(result.doNotDisturbDisablesToast ?? true));
        setNightModeBrightness(result.nightModeBrightness ?? 0.75);
        setShowAllAchievements(Boolean(result.showAllAchievements));
        setUnlockLookbackMinutes(result.unlockLookbackMinutes ?? 1440);
        setUnlockHistoryDays(result.unlockHistoryDays ?? -1);
        setRememberLastPage(Boolean(result.rememberLastPage));
        setUiSize(result.uiSize ?? "normal");
        setAchievementTextScale(result.achievementTextScale ?? "normal");
        setCurrentAchievementTextScale(result.achievementTextScale ?? "normal");
        setCommentsTextScale(result.commentsTextScale ?? "normal");
        setCurrentCommentsTextScale(result.commentsTextScale ?? "normal");
        setTextScale(result.textScale ?? "normal");
        setTitleScale(result.titleScale ?? "normal");
        setHeaderScale(result.headerScale ?? "normal");
        setBannerScale(result.bannerScale ?? "normal");
        setModalScale(result.modalScale ?? "normal");
        setCurrentTextScale(result.textScale ?? "normal");
        setCurrentTitleScale(result.titleScale ?? "normal");
        setCurrentHeaderScale(result.headerScale ?? "normal");
        setCurrentBannerScale(result.bannerScale ?? "normal");
        setCurrentModalScale(result.modalScale ?? "normal");
        setCurrentGuideZoom(result.guideZoom ?? GUIDE_ZOOM_DEFAULT);
        setCurrentGuideModalZoom(result.guideModalZoom ?? GUIDE_MODAL_ZOOM_DEFAULT);
        setCurrentTextViewerZoom(result.textViewerZoom ?? TEXT_VIEWER_ZOOM_DEFAULT);
        setBlockPadding(result.blockPadding ?? 8);
        setButtonSpacing(result.buttonSpacing ?? "verysmall");
        setMouseKeyboardMode(Boolean(result.mouseKeyboardMode ?? false));
        setControllerGlyphStyle(result.controllerGlyphStyle ?? "auto");
        setColoredGlyphs(Boolean(result.coloredGlyphs ?? true));
        setCurrentColoredGlyphs(Boolean(result.coloredGlyphs ?? true));
        setShowAButtonMode(Boolean(result.showAButtonMode ?? true));
        setShowAButtonModeTracked(Boolean(result.showAButtonModeTracked ?? true));
        setShowSocialHubButton(Boolean(result.showSocialHubButton ?? true));
        setShowTrackedSetsButton(Boolean(result.showTrackedSetsButton ?? true));
        setPutUpdaterOnDesktop(Boolean(result.putUpdaterOnDesktop ?? true));
        setShowOptionsButton(Boolean(result.showOptionsButton ?? false));
        setQuickMenuShortcuts(result.quickMenuShortcuts ?? []);
        setShortcutBindings(result.shortcutBindings ?? DEFAULT_SHORTCUT_BINDINGS);
        setLastScalePreset(result.lastScalePreset ?? "portable");
        setShowAllToggleMain(Boolean(result.showAllToggleMain ?? false));
        setShowAllToggleFriend(Boolean(result.showAllToggleFriend ?? false));
        setShowTrackedNotesMain(Boolean(result.showTrackedNotesMain ?? false));
        setShowRetroPoints(Boolean(result.showRetroPoints ?? false));
        setAchievementStyle(result.achievementStyle ?? "left");
        setTrackedColor(result.trackedColor ?? "default");
        setSocialEntryDefault(result.socialEntryDefault ?? "friends");
        setActivityCardAction(result.activityCardAction ?? "achievement");
        setFriendFeedCardAction(result.friendFeedCardAction ?? "achievement");
        setSocialHubCardAction(result.socialHubCardAction ?? "achievement");
        setGameNotesAButtonMode(result.gameNotesAButtonMode ?? "editNote");
        setMainAchievementFilter(result.mainAchievementFilter ?? "all");
        setMainAchievementAction(result.mainAchievementAction ?? "track");
        setTrackedAchievementAction(result.trackedAchievementAction ?? "editNote");
        setDolphinMapperMode(result.dolphinMapperMode ?? "map");
        setDolphinBluetoothPassthrough(result.dolphinBluetoothPassthrough ?? false);
        setDolphinContinuousScanning(result.dolphinContinuousScanning ?? false);
        setDolphinBalanceBoard(result.dolphinBalanceBoard ?? false);
        setTrackedSetAButtonMode(result.trackedSetAButtonMode ?? "editNote");
        setLanguage(result.language ?? DEFAULT_LANGUAGE);
        setFriendRefreshDelayMs(result.friendRefreshDelayMs ?? 1000);
        setActivityCacheMinutes(result.activityCacheMinutes ?? 5);
        setTrickleLookbackHours(result.trickleLookbackHours ?? 3);
        setActivityFriendsPerTick(result.activityFriendsPerTick ?? 3);
        setSocialGameTicker(Boolean(result.socialGameTicker ?? true));
        setSocialHubTicker(Boolean(result.socialHubTicker ?? true));
        setSocialActivityTrickleService(Boolean(result.socialActivityTrickleService ?? true));
        setTrickleFavoritesOnly(Boolean(result.trickleFavoritesOnly ?? false));
        setFriendAutoRefresh(Boolean(result.friendAutoRefresh ?? true));
        setShowReminderTicker(Boolean(result.showReminderTicker ?? false));
        setShowNotesDot(Boolean(result.showNotesDot ?? false));
        setShowBellDot(Boolean(result.showBellDot ?? true));
        setNotifyNoteReminderEnabled(Boolean(result.notifyNoteReminderEnabled ?? true));
        setNotifyNoteReminderToast(Boolean(result.notifyNoteReminderToast ?? true));
        setNotifyTrackedSetEnabled(Boolean(result.notifyTrackedSetEnabled ?? true));
        setNotifyTrackedSetToast(Boolean(result.notifyTrackedSetToast ?? true));
        setNotifyCommentTrackerEnabled(Boolean(result.notifyCommentTrackerEnabled ?? true));
        setNotifyCommentTrackerToast(Boolean(result.notifyCommentTrackerToast ?? true));
        setNotifyWallEnabled(Boolean(result.notifyWallEnabled ?? true));
        setNotifyWallToast(Boolean(result.notifyWallToast ?? true));
        setNotifySystemEnabled(Boolean(result.notifySystemEnabled ?? true));
        setNotifySystemToast(Boolean(result.notifySystemToast ?? true));
        setNotifyTrackedEnabled(Boolean(result.notifyTrackedEnabled ?? false));
        setNotifyTrackedToast(Boolean(result.notifyTrackedToast ?? false));
        setNotifySocialUnlockEnabled(Boolean(result.notifySocialUnlockEnabled ?? false));
        setNotifySocialUnlockToast(Boolean(result.notifySocialUnlockToast ?? false));
        setNotifyNearYouEnabled(Boolean(result.notifyNearYouEnabled ?? false));
        setNotifyNearYouToast(Boolean(result.notifyNearYouToast ?? false));
        setLegacyAchievementLinks(Boolean(result.legacyAchievementLinks ?? false));
        setLegacyGameLinks(Boolean(result.legacyGameLinks ?? false));
        setPinLatestGuides(Boolean(result.pinLatestGuides ?? false));
        setKeepGuidesOffline(Boolean(result.keepGuidesOffline ?? false));
        setShowDeveloperOptions(Boolean(result.showDeveloperOptions ?? false));
        setAutoPurgeService(Boolean(result.autoPurgeService ?? true));
        setTrackedSetsAutoCheck(Boolean(result.trackedSetsAutoCheck ?? true));
        setTrackedSetsServiceEnabled(Boolean(result.trackedSetsServiceEnabled ?? true));
        setDebugLogging(Boolean(result.debugLogging ?? false));
        setNotifyDebugEnabled(Boolean(result.notifyDebugEnabled ?? false));
        setNotifyDebugToast(Boolean(result.notifyDebugToast ?? false));
        setIpcSlowThresholdMs(result.ipcSlowThresholdMs ?? 250);
        {
            const bonusEnabled = Boolean(result.largeViewportBonusEnabled ?? true);
            const bonusLines = result.largeViewportBonus ?? 8;
            setLargeViewportBonusEnabled(bonusEnabled);
            setLargeViewportBonus(bonusLines);
            setCurrentLargeViewportBonusEnabled(bonusEnabled);
            setCurrentLargeViewportBonus(bonusLines);
        }
        setParallelRaCalls(result.parallelRaCalls ?? 4);
        setParallelCdnFetches(result.parallelCdnFetches ?? 5);
        setMaxIconWorkers(result.maxIconWorkers ?? 6);
        setAvatarWorkers(result.avatarWorkers ?? 4);
        setGameIconWorkers(result.gameIconWorkers ?? 6);
        const nextGameArtCacheCap = result.gameArtCacheCap ?? 1024;
        setGameArtCacheCap(nextGameArtCacheCap);
        applyGameArtCacheCap(nextGameArtCacheCap);
        const nextAvatarCacheCap = result.avatarCacheCap ?? 1024;
        setAvatarCacheCap(nextAvatarCacheCap);
        applyAvatarCacheCap(nextAvatarCacheCap);
        const nextAchievementIconCacheGames = result.achievementIconCacheGames ?? 8;
        setAchievementIconCacheGames(nextAchievementIconCacheGames);
        applyAchievementIconCacheGames(nextAchievementIconCacheGames);
        setFriendImageService(Boolean(result.friendImageService ?? true));
        setValidateFriendsRoster(Boolean(result.validateFriendsRoster ?? true));
        setFisTickFrequencyMinutes(result.fisTickFrequencyMinutes ?? 5);
        setCommentsServiceTickMinutes(result.commentsServiceTickMinutes ?? 5);
        setTrackedSetsRefreshMinutes(result.trackedSetsRefreshMinutes ?? 15);
        setCommentsServiceFetchAmount(result.commentsServiceFetchAmount ?? 20);
        setCommentsServiceWallCheck(Boolean(result.commentsServiceWallCheck ?? true));
        setFisRosterRefreshIntervalHours(result.fisRosterRefreshIntervalHours ?? 6);
        setFisVerifyFavoriteAvatars(Boolean(result.fisVerifyFavoriteAvatars ?? true));
        setFisVerifyAllAvatars(Boolean(result.fisVerifyAllAvatars ?? false));
        setPlayersNearYouEnabled(Boolean(result.playersNearYouEnabled ?? true));
        setPlayersNearYouLookbehind(result.playersNearYouLookbehind ?? 2);
        setPlayersNearYouLookahead(result.playersNearYouLookahead ?? 6);
        setPlayersNearYouMinTickMinutes(result.playersNearYouMinTickMinutes ?? 5);
        setPlayersNearYouMaxTickMinutes(result.playersNearYouMaxTickMinutes ?? 15);
        setGamesListCacheMinutes(result.gamesListCacheMinutes ?? 15);
        setAwardsListCacheMinutes(result.awardsListCacheMinutes ?? 15);
        setWantToPlayCacheMinutes(result.wantToPlayCacheMinutes ?? 20);
        setPlayersNearYouTapMode(result.playersNearYouTapMode ?? "profile");
        setAccurateAvatarDebug(Boolean(result.debugLogging ?? false));
        setBigListThreshold(result.bigListThreshold ?? 9999);
        setAlwaysStaggerMounting(Boolean(result.alwaysStaggerMounting ?? false));
        setReturnStaggerFrames(result.returnStaggerFrames ?? 0);
        setDynamicLoading(Boolean(result.dynamicLoading ?? true));
        setDynamicInitialRows(result.dynamicInitialRows ?? 30);
        setDynamicRowStep(result.dynamicRowStep ?? 5);
        setDynamicPrefetchDistance(result.dynamicPrefetchDistance ?? 12);
        setDynamicSentinelRootMargin(result.dynamicSentinelRootMargin ?? 600);
        setDynamicTrackedListLoading(Boolean(result.dynamicTrackedListLoading ?? true));
        setDynamicTrackedListInitialRows(result.dynamicTrackedListInitialRows ?? 10);
        setDynamicTrackedListRowStep(result.dynamicTrackedListRowStep ?? 10);
        setDynamicTrackedListPrefetchDistance(result.dynamicTrackedListPrefetchDistance ?? 12);
        setDynamicTrackedListSentinelRootMargin(result.dynamicTrackedListSentinelRootMargin ?? 600);
        setDynamicTrackedSetsListLoading(Boolean(result.dynamicTrackedSetsListLoading ?? true));
        setDynamicTrackedSetsListInitialRows(result.dynamicTrackedSetsListInitialRows ?? 10);
        setDynamicTrackedSetsListRowStep(result.dynamicTrackedSetsListRowStep ?? 10);
        setDynamicTrackedSetsListPrefetchDistance(result.dynamicTrackedSetsListPrefetchDistance ?? 12);
        setDynamicTrackedSetsListSentinelRootMargin(result.dynamicTrackedSetsListSentinelRootMargin ?? 600);
        setDynamicGameNotesLoading(Boolean(result.dynamicGameNotesLoading ?? true));
        setDynamicGameNotesInitialRows(result.dynamicGameNotesInitialRows ?? 10);
        setDynamicGameNotesRowStep(result.dynamicGameNotesRowStep ?? 10);
        setDynamicGameNotesPrefetchDistance(result.dynamicGameNotesPrefetchDistance ?? 12);
        setDynamicGameNotesSentinelRootMargin(result.dynamicGameNotesSentinelRootMargin ?? 600);
        setDynamicComments(Boolean(result.dynamicComments ?? true));
        setDynamicCommentsInitialRows(result.dynamicCommentsInitialRows ?? 10);
        setDynamicCommentsRowStep(result.dynamicCommentsRowStep ?? 10);
        setDynamicCommentsSentinelRootMargin(result.dynamicCommentsSentinelRootMargin ?? 600);
        setDynamicFriendLoading(Boolean(result.dynamicFriendLoading ?? true));
        setDynamicLeaderboardLoading(Boolean(result.dynamicLeaderboardLoading ?? true));
        setDynamicLeaderboardResults(Boolean(result.dynamicLeaderboardResults ?? true));
        setDynamicActivityFeed(Boolean(result.dynamicActivityFeed ?? true));
        setDynamicCompare(Boolean(result.dynamicCompare ?? true));
        setDynamicFriendPicker(Boolean(result.dynamicFriendPicker ?? true));
        setDynamicAllGames(Boolean(result.dynamicAllGames ?? true));
        setDynamicTrackedGames(Boolean(result.dynamicTrackedGames ?? true));
        setDynamicBadges(Boolean(result.dynamicBadges ?? true));
        setDynamicFollowedRanking(Boolean(result.dynamicFollowedRanking ?? true));
        setActiveOptionsTab(result.lastOptionsTab ?? "system");
    };

    const onResetSettings = async () => {
        setError(null);
        try {
            const result = await resetOptionSettings();
            if (!mountedRef.current) {
                return;
            }
            applyResetResult(result);
            if (!Boolean(result.rememberLastPage)) {
                clearPendingResumeState();
            }
        } catch (e: any) {
            logError("onResetSettings", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Failed to reset settings."));
        }
    };

    const onApplySetupProfile = async (profile: string, preserveOtherSettings: boolean) => {
        setError(null);
        try {
            const result = await applySetupProfile(profile, preserveOtherSettings);
            if (!mountedRef.current) {
                return;
            }
            applyResetResult(result);
            if (!Boolean(result.rememberLastPage)) {
                clearPendingResumeState();
            }
        } catch (e: any) {
            logError("onApplySetupProfile", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Failed to apply settings profile."));
        }
    };

    const onToggleShowBellDot = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showBellDot,
            applyValue: setShowBellDot,
            saveCall: saveShowBellDot,
            getSavedValue: (result, fallbackValue) => Boolean(result.showBellDot ?? fallbackValue),
        });

    const onToggleDoNotDisturbDisablesDot = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: doNotDisturbDisablesDot,
            applyValue: setDoNotDisturbDisablesDot,
            saveCall: saveDoNotDisturbDisablesDot,
            getSavedValue: (result, fallbackValue) => Boolean(result.doNotDisturbDisablesDot ?? fallbackValue),
        });

    const onToggleDoNotDisturbDisablesToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: doNotDisturbDisablesToast,
            applyValue: setDoNotDisturbDisablesToast,
            saveCall: saveDoNotDisturbDisablesToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.doNotDisturbDisablesToast ?? fallbackValue),
        });

    const onToggleNotifyNoteReminderEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyNoteReminderEnabled,
            applyValue: setNotifyNoteReminderEnabled,
            saveCall: saveNotifyNoteReminderEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyNoteReminderEnabled ?? fallbackValue),
        });

    const onToggleNotifyNoteReminderToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyNoteReminderToast,
            applyValue: setNotifyNoteReminderToast,
            saveCall: saveNotifyNoteReminderToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyNoteReminderToast ?? fallbackValue),
        });

    const onToggleNotifyTrackedSetEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyTrackedSetEnabled,
            applyValue: setNotifyTrackedSetEnabled,
            saveCall: saveNotifyTrackedSetEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyTrackedSetEnabled ?? fallbackValue),
        });

    const onToggleNotifyTrackedSetToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyTrackedSetToast,
            applyValue: setNotifyTrackedSetToast,
            saveCall: saveNotifyTrackedSetToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyTrackedSetToast ?? fallbackValue),
        });

    const onToggleNotifyCommentTrackerEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyCommentTrackerEnabled,
            applyValue: setNotifyCommentTrackerEnabled,
            saveCall: saveNotifyCommentTrackerEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyCommentTrackerEnabled ?? fallbackValue),
        });

    const onToggleNotifyCommentTrackerToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyCommentTrackerToast,
            applyValue: setNotifyCommentTrackerToast,
            saveCall: saveNotifyCommentTrackerToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyCommentTrackerToast ?? fallbackValue),
        });

    const onToggleNotifyWallEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyWallEnabled,
            applyValue: setNotifyWallEnabled,
            saveCall: saveNotifyWallEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyWallEnabled ?? fallbackValue),
        });

    const onToggleNotifyWallToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyWallToast,
            applyValue: setNotifyWallToast,
            saveCall: saveNotifyWallToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyWallToast ?? fallbackValue),
        });

    const onToggleNotifySystemEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifySystemEnabled,
            applyValue: setNotifySystemEnabled,
            saveCall: saveNotifySystemEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifySystemEnabled ?? fallbackValue),
        });

    const onToggleNotifySystemToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifySystemToast,
            applyValue: setNotifySystemToast,
            saveCall: saveNotifySystemToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifySystemToast ?? fallbackValue),
        });

    const onToggleNotifyTrackedEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyTrackedEnabled,
            applyValue: setNotifyTrackedEnabled,
            saveCall: saveNotifyTrackedEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyTrackedEnabled ?? fallbackValue),
        });

    const onToggleNotifyTrackedToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyTrackedToast,
            applyValue: setNotifyTrackedToast,
            saveCall: saveNotifyTrackedToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyTrackedToast ?? fallbackValue),
        });

    const onToggleNotifySocialUnlockEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifySocialUnlockEnabled,
            applyValue: setNotifySocialUnlockEnabled,
            saveCall: saveNotifySocialUnlockEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifySocialUnlockEnabled ?? fallbackValue),
        });

    const onToggleNotifySocialUnlockToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifySocialUnlockToast,
            applyValue: setNotifySocialUnlockToast,
            saveCall: saveNotifySocialUnlockToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifySocialUnlockToast ?? fallbackValue),
        });

    const onToggleNotifyNearYouEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyNearYouEnabled,
            applyValue: setNotifyNearYouEnabled,
            saveCall: saveNotifyNearYouEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyNearYouEnabled ?? fallbackValue),
        });

    const onToggleNotifyNearYouToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyNearYouToast,
            applyValue: setNotifyNearYouToast,
            saveCall: saveNotifyNearYouToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyNearYouToast ?? fallbackValue),
        });

    const onToggleNotifyDebugEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyDebugEnabled,
            applyValue: setNotifyDebugEnabled,
            saveCall: saveNotifyDebugEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyDebugEnabled ?? fallbackValue),
        });

    const onToggleNotifyDebugToast = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: notifyDebugToast,
            applyValue: setNotifyDebugToast,
            saveCall: saveNotifyDebugToast,
            getSavedValue: (result, fallbackValue) => Boolean(result.notifyDebugToast ?? fallbackValue),
        });

    const onToggleShowReminderTicker = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showReminderTicker,
            applyValue: setShowReminderTicker,
            saveCall: saveShowReminderTicker,
            getSavedValue: (result, fallbackValue) => Boolean(result.showReminderTicker ?? fallbackValue),
        });

    const onToggleShowNotesDot = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showNotesDot,
            applyValue: setShowNotesDot,
            saveCall: saveShowNotesDot,
            getSavedValue: (result, fallbackValue) => Boolean(result.showNotesDot ?? fallbackValue),
        });

    const onSaveGameNotesAButtonMode = (nextValue: GameNoteAButtonMode) => {
        const previousValue = gameNotesAButtonMode;
        if (nextValue === previousValue) {
            return Promise.resolve();
        }
        return saveSettingWithRollback<GameNoteAButtonMode>({
            nextValue,
            previousValue,
            applyValue: setGameNotesAButtonMode,
            saveCall: saveGameNotesAButtonMode,
            getSavedValue: (result, fallbackValue) => result.gameNotesAButtonMode ?? fallbackValue,
        });
    };

    const onToggleShowAllToggleMain = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showAllToggleMain,
            applyValue: setShowAllToggleMain,
            saveCall: saveShowAllToggleMain,
            getSavedValue: (result, fallbackValue) => Boolean(result.showAllToggleMain ?? fallbackValue),
        });

    const onToggleShowRetroPoints = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showRetroPoints,
            applyValue: setShowRetroPoints,
            saveCall: saveShowRetroPoints,
            getSavedValue: (result, fallbackValue) => Boolean(result.showRetroPoints ?? fallbackValue),
        });

    const onCycleAchievementStyle = () => {
        const previousValue = achievementStyle;
        const nextValue = nextAchievementStyle(achievementStyle);
        return saveSettingWithRollback<AchievementStyle>({
            nextValue,
            previousValue,
            applyValue: setAchievementStyle,
            saveCall: saveAchievementStyle,
            getSavedValue: (result, fallbackValue) => result.achievementStyle ?? fallbackValue,
        });
    };

    const onCycleUnlockLookback = () => {
        const previousValue = unlockLookbackMinutes;
        const nextValue = nextUnlockLookbackMinutes(unlockLookbackMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setUnlockLookbackMinutes,
            saveCall: saveUnlockLookbackMinutes,
            getSavedValue: (result, fallbackValue) => result.unlockLookbackMinutes ?? fallbackValue,
        });
    };

    const onCycleUnlockHistoryDays = () => {
        const previousValue = unlockHistoryDays;
        const nextValue = nextUnlockHistoryDays(unlockHistoryDays);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setUnlockHistoryDays,
            saveCall: saveUnlockHistoryDays,
            getSavedValue: (result, fallbackValue) => result.unlockHistoryDays ?? fallbackValue,
        });
    };

    const onCycleControllerGlyphStyle = () => {
        const previousValue = controllerGlyphStyle;
        const nextValue = nextControllerGlyphStyle(controllerGlyphStyle);
        return saveSettingWithRollback<ControllerGlyphStyle>({
            nextValue,
            previousValue,
            applyValue: setControllerGlyphStyle,
            saveCall: saveControllerGlyphStyle,
            getSavedValue: (result, fallbackValue) => result.controllerGlyphStyle ?? fallbackValue,
        });
    };

    const onToggleColoredGlyphs = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: coloredGlyphs,
            applyValue: (value) => {
                setColoredGlyphs(value);
                setCurrentColoredGlyphs(value);
            },
            saveCall: saveColoredGlyphs,
            getSavedValue: (result, fallbackValue) => Boolean(result.coloredGlyphs ?? fallbackValue),
        });

    const onToggleShowAButtonMode = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showAButtonMode,
            applyValue: setShowAButtonMode,
            saveCall: saveShowAButtonMode,
            getSavedValue: (result, fallbackValue) => Boolean(result.showAButtonMode ?? fallbackValue),
        });

    const onToggleShowTrackedNotesMain = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showTrackedNotesMain,
            applyValue: setShowTrackedNotesMain,
            saveCall: saveShowTrackedNotesMain,
            getSavedValue: (result, fallbackValue) => Boolean(result.showTrackedNotesMain ?? fallbackValue),
        });

    const onCycleTrackedColor = () => {
        const previousValue = trackedColor;
        const nextValue = nextTrackedColor(trackedColor);
        return saveSettingWithRollback<TrackedColor>({
            nextValue,
            previousValue,
            applyValue: setTrackedColor,
            saveCall: saveTrackedColor,
            getSavedValue: (result, fallbackValue) => result.trackedColor ?? fallbackValue,
        });
    };

    const onToggleShowAButtonModeTracked = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showAButtonModeTracked,
            applyValue: setShowAButtonModeTracked,
            saveCall: saveShowAButtonModeTracked,
            getSavedValue: (result, fallbackValue) => Boolean(result.showAButtonModeTracked ?? fallbackValue),
        });

    const onToggleTrackedSetsAutoCheck = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: trackedSetsAutoCheck,
            applyValue: setTrackedSetsAutoCheck,
            saveCall: saveTrackedSetsAutoCheck,
            getSavedValue: (result, fallbackValue) => Boolean(result.trackedSetsAutoCheck ?? fallbackValue),
        });

    const onToggleTrackedSetsServiceEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: trackedSetsServiceEnabled,
            applyValue: setTrackedSetsServiceEnabled,
            saveCall: saveTrackedSetsServiceEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.trackedSetsServiceEnabled ?? fallbackValue),
        });

    const onCycleTrackedSetsRefreshMinutes = () => {
        const previousValue = trackedSetsRefreshMinutes;
        const nextValue = nextTrackedSetRefreshMinutes(trackedSetsRefreshMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setTrackedSetsRefreshMinutes,
            saveCall: saveTrackedSetsRefreshMinutes,
            getSavedValue: (result, fallbackValue) => result.trackedSetsRefreshMinutes ?? fallbackValue,
        });
    };

    const onCycleCommentsServiceTickMinutes = () => {
        const previousValue = commentsServiceTickMinutes;
        const nextValue = nextCommentsCheckFrequencyMinutes(commentsServiceTickMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setCommentsServiceTickMinutes,
            saveCall: saveCommentsServiceTickMinutes,
            getSavedValue: (result, fallbackValue) => result.commentsServiceTickMinutes ?? fallbackValue,
        });
    };

    const onCycleCommentsServiceFetchAmount = () => {
        const previousValue = commentsServiceFetchAmount;
        const nextValue = nextCommentsServiceFetchAmount(commentsServiceFetchAmount);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setCommentsServiceFetchAmount,
            saveCall: saveCommentsServiceFetchAmount,
            getSavedValue: (result, fallbackValue) => result.commentsServiceFetchAmount ?? fallbackValue,
        });
    };

    const onToggleCommentsServiceWallCheck = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: commentsServiceWallCheck,
            applyValue: setCommentsServiceWallCheck,
            saveCall: saveCommentsServiceWallCheck,
            getSavedValue: (result, fallbackValue) => Boolean(result.commentsServiceWallCheck ?? fallbackValue),
        });

    const onCycleFriendRefreshDelay = () => {
        const previousValue = friendRefreshDelayMs;
        const nextValue = nextFriendRefreshDelayMs(friendRefreshDelayMs);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setFriendRefreshDelayMs,
            saveCall: saveFriendRefreshDelayMs,
            getSavedValue: (result, fallbackValue) => result.friendRefreshDelayMs ?? fallbackValue,
        });
    };

    const onCycleActivityCacheMinutes = () => {
        const previousValue = activityCacheMinutes;
        const nextValue = nextActivityCacheMinutes(activityCacheMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setActivityCacheMinutes,
            saveCall: saveActivityCacheMinutes,
            getSavedValue: (result, fallbackValue) => result.activityCacheMinutes ?? fallbackValue,
        });
    };

    const onCycleTrickleLookbackHours = () => {
        const previousValue = trickleLookbackHours;
        const nextValue = nextTrickleLookbackHours(trickleLookbackHours);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setTrickleLookbackHours,
            saveCall: saveTrickleLookbackHours,
            getSavedValue: (result, fallbackValue) => result.trickleLookbackHours ?? fallbackValue,
        });
    };

    const onCycleActivityFriendsPerTick = () => {
        const previousValue = activityFriendsPerTick;
        const nextValue = nextActivityFriendsPerTick(activityFriendsPerTick);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setActivityFriendsPerTick,
            saveCall: saveActivityFriendsPerTick,
            getSavedValue: (result, fallbackValue) => result.activityFriendsPerTick ?? fallbackValue,
        });
    };

    const onToggleSocialGameTicker = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: socialGameTicker,
            applyValue: setSocialGameTicker,
            saveCall: saveSocialGameTicker,
            getSavedValue: (result, fallbackValue) => Boolean(result.socialGameTicker ?? fallbackValue),
        });

    const onToggleSocialHubTicker = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: socialHubTicker,
            applyValue: setSocialHubTicker,
            saveCall: saveSocialHubTicker,
            getSavedValue: (result, fallbackValue) => Boolean(result.socialHubTicker ?? fallbackValue),
        });

    const onToggleSocialActivityTrickleService = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: socialActivityTrickleService,
            applyValue: setSocialActivityTrickleService,
            saveCall: saveSocialActivityTrickleService,
            getSavedValue: (result, fallbackValue) => Boolean(result.socialActivityTrickleService ?? fallbackValue),
        });

    const onToggleTrickleFavoritesOnly = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: trickleFavoritesOnly,
            applyValue: setTrickleFavoritesOnly,
            saveCall: saveTrickleFavoritesOnly,
            getSavedValue: (result, fallbackValue) => Boolean(result.trickleFavoritesOnly ?? fallbackValue),
        });

    const onToggleFriendAutoRefresh = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: friendAutoRefresh,
            applyValue: setFriendAutoRefresh,
            saveCall: saveFriendAutoRefresh,
            getSavedValue: (result, fallbackValue) => Boolean(result.friendAutoRefresh ?? fallbackValue),
        });

    const onToggleFriendImageService = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: friendImageService,
            applyValue: setFriendImageService,
            saveCall: saveFriendImageService,
            getSavedValue: (result, fallbackValue) => Boolean(result.friendImageService ?? fallbackValue),
        });

    const onToggleValidateFriendsRoster = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: validateFriendsRoster,
            applyValue: setValidateFriendsRoster,
            saveCall: saveValidateFriendsRoster,
            getSavedValue: (result, fallbackValue) => Boolean(result.validateFriendsRoster ?? fallbackValue),
        });

    const onCycleFisTickFrequencyMinutes = () => {
        const previousValue = fisTickFrequencyMinutes;
        const nextValue = nextFisTickFrequencyMinutes(fisTickFrequencyMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setFisTickFrequencyMinutes,
            saveCall: saveFisTickFrequencyMinutes,
            getSavedValue: (result, fallbackValue) => result.fisTickFrequencyMinutes ?? fallbackValue,
        });
    };

    const onCycleFisRosterRefreshIntervalHours = () => {
        const previousValue = fisRosterRefreshIntervalHours;
        const nextValue = nextFisRosterRefreshIntervalHours(fisRosterRefreshIntervalHours);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setFisRosterRefreshIntervalHours,
            saveCall: saveFisRosterRefreshIntervalHours,
            getSavedValue: (result, fallbackValue) => result.fisRosterRefreshIntervalHours ?? fallbackValue,
        });
    };

    const onToggleFisVerifyFavoriteAvatars = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: fisVerifyFavoriteAvatars,
            applyValue: setFisVerifyFavoriteAvatars,
            saveCall: saveFisVerifyFavoriteAvatars,
            getSavedValue: (result, fallbackValue) => Boolean(result.fisVerifyFavoriteAvatars ?? fallbackValue),
        });

    const onToggleFisVerifyAllAvatars = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: fisVerifyAllAvatars,
            applyValue: setFisVerifyAllAvatars,
            saveCall: saveFisVerifyAllAvatars,
            getSavedValue: (result, fallbackValue) => Boolean(result.fisVerifyAllAvatars ?? fallbackValue),
        });

    const onToggleShowAllToggleFriend = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showAllToggleFriend,
            applyValue: setShowAllToggleFriend,
            saveCall: saveShowAllToggleFriend,
            getSavedValue: (result, fallbackValue) => Boolean(result.showAllToggleFriend ?? fallbackValue),
        });

    const onTogglePlayersNearYouEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: playersNearYouEnabled,
            applyValue: setPlayersNearYouEnabled,
            saveCall: savePlayersNearYouEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.playersNearYouEnabled ?? fallbackValue),
        });

    const onCyclePlayersNearYouLookbehind = () => {
        const previousValue = playersNearYouLookbehind;
        const nextValue = nextPlayersNearYouLookbehind(playersNearYouLookbehind);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setPlayersNearYouLookbehind,
            saveCall: savePlayersNearYouLookbehind,
            getSavedValue: (result, fallbackValue) => result.playersNearYouLookbehind ?? fallbackValue,
        });
    };

    const onCyclePlayersNearYouLookahead = () => {
        const previousValue = playersNearYouLookahead;
        const nextValue = nextPlayersNearYouLookahead(playersNearYouLookahead);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setPlayersNearYouLookahead,
            saveCall: savePlayersNearYouLookahead,
            getSavedValue: (result, fallbackValue) => result.playersNearYouLookahead ?? fallbackValue,
        });
    };

    const onCyclePlayersNearYouMinTickMinutes = () => {
        const previousValue = playersNearYouMinTickMinutes;
        const nextValue = nextPlayersNearYouMinTickMinutes(playersNearYouMinTickMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setPlayersNearYouMinTickMinutes,
            saveCall: savePlayersNearYouMinTickMinutes,
            getSavedValue: (result, fallbackValue) => result.playersNearYouMinTickMinutes ?? fallbackValue,
        });
    };

    const onCyclePlayersNearYouMaxTickMinutes = () => {
        const previousValue = playersNearYouMaxTickMinutes;
        const nextValue = nextPlayersNearYouMaxTickMinutes(playersNearYouMaxTickMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setPlayersNearYouMaxTickMinutes,
            saveCall: savePlayersNearYouMaxTickMinutes,
            getSavedValue: (result, fallbackValue) => result.playersNearYouMaxTickMinutes ?? fallbackValue,
        });
    };

    const onSelectLanguage = async (code: LanguageCode) => {
        if (code === language) {
            return;
        }
        const previousValue = language;
        await ensureLanguageLoaded(code);
        return saveSettingWithRollback<LanguageCode>({
            nextValue: code,
            previousValue,
            applyValue: (value) => {
                setLanguage(value);
                setCurrentLanguage(value);
            },
            saveCall: saveLanguage,
            getSavedValue: (result, fallbackValue) => result.language ?? fallbackValue,
        });
    };

    const onCycleNightModeBrightness = () => {
        const previousValue = nightModeBrightness;
        const nextValue = nextNightModeBrightness(nightModeBrightness);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setNightModeBrightness,
            saveCall: saveNightModeBrightness,
            getSavedValue: (result, fallbackValue) => result.nightModeBrightness ?? fallbackValue,
        });
    };

    const onToggleBatterySaverDisablesSocialActivity = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: batterySaverDisablesSocialActivity,
            applyValue: setBatterySaverDisablesSocialActivity,
            saveCall: saveBatterySaverDisablesSocialActivity,
            getSavedValue: (result, fallbackValue) => Boolean(result.batterySaverDisablesSocialActivity ?? fallbackValue),
        });

    const onToggleBatterySaverDisablesComments = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: batterySaverDisablesComments,
            applyValue: setBatterySaverDisablesComments,
            saveCall: saveBatterySaverDisablesComments,
            getSavedValue: (result, fallbackValue) => Boolean(result.batterySaverDisablesComments ?? fallbackValue),
        });

    const onToggleBatterySaverDisablesFriendAvatars = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: batterySaverDisablesFriendAvatars,
            applyValue: setBatterySaverDisablesFriendAvatars,
            saveCall: saveBatterySaverDisablesFriendAvatars,
            getSavedValue: (result, fallbackValue) => Boolean(result.batterySaverDisablesFriendAvatars ?? fallbackValue),
        });

    const onToggleBatterySaverDisablesPlayersNearYou = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: batterySaverDisablesPlayersNearYou,
            applyValue: setBatterySaverDisablesPlayersNearYou,
            saveCall: saveBatterySaverDisablesPlayersNearYou,
            getSavedValue: (result, fallbackValue) => Boolean(result.batterySaverDisablesPlayersNearYou ?? fallbackValue),
        });

    const onToggleBatterySaverDisablesTrackedSets = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: batterySaverDisablesTrackedSets,
            applyValue: setBatterySaverDisablesTrackedSets,
            saveCall: saveBatterySaverDisablesTrackedSets,
            getSavedValue: (result, fallbackValue) => Boolean(result.batterySaverDisablesTrackedSets ?? fallbackValue),
        });

    const onToggleBatterySaverDisablesFileWatcher = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: batterySaverDisablesFileWatcher,
            applyValue: setBatterySaverDisablesFileWatcher,
            saveCall: saveBatterySaverDisablesFileWatcher,
            getSavedValue: (result, fallbackValue) => Boolean(result.batterySaverDisablesFileWatcher ?? fallbackValue),
        });

    const onToggleShowDeveloperOptions = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showDeveloperOptions,
            applyValue: setShowDeveloperOptions,
            saveCall: saveShowDeveloperOptions,
            getSavedValue: (result, fallbackValue) => Boolean(result.showDeveloperOptions ?? fallbackValue),
        });

    const onToggleAutoPurgeService = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: autoPurgeService,
            applyValue: setAutoPurgeService,
            saveCall: saveAutoPurgeService,
            getSavedValue: (result, fallbackValue) => Boolean(result.autoPurgeService ?? fallbackValue),
        });

    const onToggleDebugLogging = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: debugLogging,
            applyValue: setDebugLogging,
            saveCall: saveDebugLogging,
            getSavedValue: (result, fallbackValue) => Boolean(result.debugLogging ?? fallbackValue),
            onSaved: (result, savedNext) => {
                setAccurateAvatarDebug(Boolean(result?.debugLogging ?? savedNext));
            }
        });

    const onCycleIpcSlowThresholdMs = () => {
        const previousValue = ipcSlowThresholdMs;
        const nextValue = nextIpcSlowThresholdMs(ipcSlowThresholdMs);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setIpcSlowThresholdMs,
            saveCall: saveIpcSlowThresholdMs,
            getSavedValue: (result, fallbackValue) => result.ipcSlowThresholdMs ?? fallbackValue,
        });
    };

    const onToggleLegacyAchievementLinks = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: legacyAchievementLinks,
            applyValue: setLegacyAchievementLinks,
            saveCall: saveLegacyAchievementLinks,
            getSavedValue: (result, fallbackValue) => Boolean(result.legacyAchievementLinks ?? fallbackValue),
        });

    const onToggleLegacyGameLinks = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: legacyGameLinks,
            applyValue: setLegacyGameLinks,
            saveCall: saveLegacyGameLinks,
            getSavedValue: (result, fallbackValue) => Boolean(result.legacyGameLinks ?? fallbackValue),
        });

    const onFireTestNotification = async () => {
        setError(null);
        try {
            await fireTestDebugNotification();
            if (!mountedRef.current) {
                return;
            }
        } catch (e: any) {
            logError("onFireTestNotification", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Failed to fire a test notification."));
        }
    };

    const onFireTestCommentNotification = async () => {
        setError(null);
        try {
            await fireTestCommentNotification();
            if (!mountedRef.current) {
                return;
            }
        } catch (e: any) {
            logError("onFireTestCommentNotification", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Failed to fire a test comment notification."));
        }
    };

    const onFireTestUpdateNotification = async () => {
        setError(null);
        try {
            await fireTestUpdateNotification();
            if (!mountedRef.current) {
                return;
            }
        } catch (e: any) {
            logError("onFireTestUpdateNotification", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Failed to fire a test update notification."));
        }
    };

    const onFireTestTrackedSet = async () => {
        setError(null);
        try {
            await fireTestTrackedSetCompletion();
        } catch (e: any) {
            logError("onFireTestTrackedSet", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Failed to fire a test completion."));
        }
    };

    const onInjectFakeSelfName = async () => {
        setError(null);
        try {
            await injectFakeSelfName();
            if (!mountedRef.current) {
                return;
            }
            await onAfterSelfRename();
        } catch (e: any) {
            logError("onInjectFakeSelfName", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Failed to rename your account."));
        }
    };

    const onInjectFakeFriendName = async () => {
        setError(null);
        try {
            await injectFakeFriendName();
        } catch (e: any) {
            logError("onInjectFakeFriendName", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Failed to rename a friend."));
        }
    };

    const onToggleLargeViewportBonusEnabled = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: largeViewportBonusEnabled,
            applyValue: (value) => {
                setLargeViewportBonusEnabled(value);
                setCurrentLargeViewportBonusEnabled(value);
            },
            saveCall: saveLargeViewportBonusEnabled,
            getSavedValue: (result, fallbackValue) => Boolean(result.largeViewportBonusEnabled ?? fallbackValue),
        });

    const onCycleLargeViewportBonus = () => {
        const previousValue = largeViewportBonus;
        const nextValue = nextLargeViewportBonus(largeViewportBonus);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: (value) => {
                setLargeViewportBonus(value);
                setCurrentLargeViewportBonus(value);
            },
            saveCall: saveLargeViewportBonus,
            getSavedValue: (result, fallbackValue) => result.largeViewportBonus ?? fallbackValue,
        });
    };

    const onCycleParallelRaCalls = () => {
        const previousValue = parallelRaCalls;
        const nextValue = nextParallelRaCalls(parallelRaCalls);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setParallelRaCalls,
            saveCall: saveParallelRaCalls,
            getSavedValue: (result, fallbackValue) => result.parallelRaCalls ?? fallbackValue,
        });
    };

    const onCycleParallelCdnFetches = () => {
        const previousValue = parallelCdnFetches;
        const nextValue = nextParallelCdnFetches(parallelCdnFetches);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setParallelCdnFetches,
            saveCall: saveParallelCdnFetches,
            getSavedValue: (result, fallbackValue) => result.parallelCdnFetches ?? fallbackValue,
        });
    };

    const onCycleMaxIconWorkers = () => {
        const previousValue = maxIconWorkers;
        const nextValue = nextMaxIconWorkers(maxIconWorkers);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setMaxIconWorkers,
            saveCall: saveMaxIconWorkers,
            getSavedValue: (result, fallbackValue) => result.maxIconWorkers ?? fallbackValue,
        });
    };

    const onCycleAvatarWorkers = () => {
        const previousValue = avatarWorkers;
        const nextValue = nextAvatarWorkers(avatarWorkers);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setAvatarWorkers,
            saveCall: saveAvatarWorkers,
            getSavedValue: (result, fallbackValue) => result.avatarWorkers ?? fallbackValue,
        });
    };

    const onCycleGameIconWorkers = () => {
        const previousValue = gameIconWorkers;
        const nextValue = nextGameIconWorkers(gameIconWorkers);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setGameIconWorkers,
            saveCall: saveGameIconWorkers,
            getSavedValue: (result, fallbackValue) => result.gameIconWorkers ?? fallbackValue,
        });
    };

    const onCycleGameArtCacheCap = () => {
        const previousValue = gameArtCacheCap;
        const nextValue = nextGameArtCacheCap(gameArtCacheCap);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setGameArtCacheCap,
            saveCall: saveGameArtCacheCap,
            getSavedValue: (result, fallbackValue) => result.gameArtCacheCap ?? fallbackValue,
            onSaved: (result, fallbackValue) => applyGameArtCacheCap(result.gameArtCacheCap ?? fallbackValue),
        });
    };

    const onCycleAvatarCacheCap = () => {
        const previousValue = avatarCacheCap;
        const nextValue = nextAvatarCacheCap(avatarCacheCap);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setAvatarCacheCap,
            saveCall: saveAvatarCacheCap,
            getSavedValue: (result, fallbackValue) => result.avatarCacheCap ?? fallbackValue,
            onSaved: (result, fallbackValue) => applyAvatarCacheCap(result.avatarCacheCap ?? fallbackValue),
        });
    };

    const onCycleAchievementIconCacheGames = () => {
        const previousValue = achievementIconCacheGames;
        const nextValue = nextAchievementIconCacheGames(achievementIconCacheGames);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setAchievementIconCacheGames,
            saveCall: saveAchievementIconCacheGames,
            getSavedValue: (result, fallbackValue) => result.achievementIconCacheGames ?? fallbackValue,
            onSaved: (result, fallbackValue) => applyAchievementIconCacheGames(result.achievementIconCacheGames ?? fallbackValue),
        });
    };

    const onCycleGamesListCacheMinutes = () => {
        const previousValue = gamesListCacheMinutes;
        const nextValue = nextGamesListCacheMinutes(gamesListCacheMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setGamesListCacheMinutes,
            saveCall: saveGamesListCacheMinutes,
            getSavedValue: (result, fallbackValue) => result.gamesListCacheMinutes ?? fallbackValue,
        });
    };

    const onCycleAwardsListCacheMinutes = () => {
        const previousValue = awardsListCacheMinutes;
        const nextValue = nextAwardsListCacheMinutes(awardsListCacheMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setAwardsListCacheMinutes,
            saveCall: saveAwardsListCacheMinutes,
            getSavedValue: (result, fallbackValue) => result.awardsListCacheMinutes ?? fallbackValue,
        });
    };

    const onCycleWantToPlayCacheMinutes = () => {
        const previousValue = wantToPlayCacheMinutes;
        const nextValue = nextWantToPlayCacheMinutes(wantToPlayCacheMinutes);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setWantToPlayCacheMinutes,
            saveCall: saveWantToPlayCacheMinutes,
            getSavedValue: (result, fallbackValue) => result.wantToPlayCacheMinutes ?? fallbackValue,
        });
    };

    const onCycleBigListThreshold = () => {
        const previousValue = bigListThreshold;
        const nextValue = nextBigListThreshold(bigListThreshold);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setBigListThreshold,
            saveCall: saveBigListThreshold,
            getSavedValue: (result, fallbackValue) => result.bigListThreshold ?? fallbackValue,
        });
    };

    const onToggleAlwaysStaggerMounting = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: alwaysStaggerMounting,
            applyValue: setAlwaysStaggerMounting,
            saveCall: saveAlwaysStaggerMounting,
            getSavedValue: (result, fallbackValue) => Boolean(result.alwaysStaggerMounting ?? fallbackValue),
        });

    const onCycleReturnStaggerFrames = () => {
        const previousValue = returnStaggerFrames;
        const nextValue = nextReturnStaggerFrames(returnStaggerFrames);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setReturnStaggerFrames,
            saveCall: saveReturnStaggerFrames,
            getSavedValue: (result, fallbackValue) => result.returnStaggerFrames ?? fallbackValue,
        });
    };

    const onToggleDynamicLoading = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicLoading,
            applyValue: setDynamicLoading,
            saveCall: saveDynamicLoading,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicLoading ?? fallbackValue),
        });

    const onCycleDynamicInitialRows = () => {
        const previousValue = dynamicInitialRows;
        const nextValue = nextDynamicInitialRows(dynamicInitialRows);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicInitialRows,
            saveCall: saveDynamicInitialRows,
            getSavedValue: (result, fallbackValue) => result.dynamicInitialRows ?? fallbackValue,
        });
    };

    const onCycleDynamicRowStep = () => {
        const previousValue = dynamicRowStep;
        const nextValue = nextDynamicRowStep(dynamicRowStep);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicRowStep,
            saveCall: saveDynamicRowStep,
            getSavedValue: (result, fallbackValue) => result.dynamicRowStep ?? fallbackValue,
        });
    };

    const onCycleDynamicPrefetchDistance = () => {
        const previousValue = dynamicPrefetchDistance;
        const nextValue = nextDynamicPrefetchDistance(dynamicPrefetchDistance);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicPrefetchDistance,
            saveCall: saveDynamicPrefetchDistance,
            getSavedValue: (result, fallbackValue) => result.dynamicPrefetchDistance ?? fallbackValue,
        });
    };

    const onCycleDynamicSentinelRootMargin = () => {
        const previousValue = dynamicSentinelRootMargin;
        const nextValue = nextDynamicSentinelRootMargin(dynamicSentinelRootMargin);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicSentinelRootMargin,
            saveCall: saveDynamicSentinelRootMargin,
            getSavedValue: (result, fallbackValue) => result.dynamicSentinelRootMargin ?? fallbackValue,
        });
    };

    const onToggleDynamicTrackedListLoading = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicTrackedListLoading,
            applyValue: setDynamicTrackedListLoading,
            saveCall: saveDynamicTrackedListLoading,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicTrackedListLoading ?? fallbackValue),
        });

    const onCycleDynamicTrackedListInitialRows = () => {
        const previousValue = dynamicTrackedListInitialRows;
        const nextValue = nextDynamicTrackedListInitialRows(dynamicTrackedListInitialRows);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicTrackedListInitialRows,
            saveCall: saveDynamicTrackedListInitialRows,
            getSavedValue: (result, fallbackValue) => result.dynamicTrackedListInitialRows ?? fallbackValue,
        });
    };

    const onCycleDynamicTrackedListRowStep = () => {
        const previousValue = dynamicTrackedListRowStep;
        const nextValue = nextDynamicTrackedListRowStep(dynamicTrackedListRowStep);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicTrackedListRowStep,
            saveCall: saveDynamicTrackedListRowStep,
            getSavedValue: (result, fallbackValue) => result.dynamicTrackedListRowStep ?? fallbackValue,
        });
    };

    const onCycleDynamicTrackedListPrefetchDistance = () => {
        const previousValue = dynamicTrackedListPrefetchDistance;
        const nextValue = nextDynamicTrackedListPrefetchDistance(dynamicTrackedListPrefetchDistance);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicTrackedListPrefetchDistance,
            saveCall: saveDynamicTrackedListPrefetchDistance,
            getSavedValue: (result, fallbackValue) => result.dynamicTrackedListPrefetchDistance ?? fallbackValue,
        });
    };

    const onCycleDynamicTrackedListSentinelRootMargin = () => {
        const previousValue = dynamicTrackedListSentinelRootMargin;
        const nextValue = nextDynamicTrackedListSentinelRootMargin(dynamicTrackedListSentinelRootMargin);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicTrackedListSentinelRootMargin,
            saveCall: saveDynamicTrackedListSentinelRootMargin,
            getSavedValue: (result, fallbackValue) => result.dynamicTrackedListSentinelRootMargin ?? fallbackValue,
        });
    };

    const onToggleDynamicTrackedSetsListLoading = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicTrackedSetsListLoading,
            applyValue: setDynamicTrackedSetsListLoading,
            saveCall: saveDynamicTrackedSetsListLoading,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicTrackedSetsListLoading ?? fallbackValue),
        });

    const onCycleDynamicTrackedSetsListInitialRows = () => {
        const previousValue = dynamicTrackedSetsListInitialRows;
        const nextValue = nextDynamicTrackedSetsListInitialRows(dynamicTrackedSetsListInitialRows);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicTrackedSetsListInitialRows,
            saveCall: saveDynamicTrackedSetsListInitialRows,
            getSavedValue: (result, fallbackValue) => result.dynamicTrackedSetsListInitialRows ?? fallbackValue,
        });
    };

    const onCycleDynamicTrackedSetsListRowStep = () => {
        const previousValue = dynamicTrackedSetsListRowStep;
        const nextValue = nextDynamicTrackedSetsListRowStep(dynamicTrackedSetsListRowStep);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicTrackedSetsListRowStep,
            saveCall: saveDynamicTrackedSetsListRowStep,
            getSavedValue: (result, fallbackValue) => result.dynamicTrackedSetsListRowStep ?? fallbackValue,
        });
    };

    const onCycleDynamicTrackedSetsListPrefetchDistance = () => {
        const previousValue = dynamicTrackedSetsListPrefetchDistance;
        const nextValue = nextDynamicTrackedSetsListPrefetchDistance(dynamicTrackedSetsListPrefetchDistance);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicTrackedSetsListPrefetchDistance,
            saveCall: saveDynamicTrackedSetsListPrefetchDistance,
            getSavedValue: (result, fallbackValue) => result.dynamicTrackedSetsListPrefetchDistance ?? fallbackValue,
        });
    };

    const onCycleDynamicTrackedSetsListSentinelRootMargin = () => {
        const previousValue = dynamicTrackedSetsListSentinelRootMargin;
        const nextValue = nextDynamicTrackedSetsListSentinelRootMargin(dynamicTrackedSetsListSentinelRootMargin);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicTrackedSetsListSentinelRootMargin,
            saveCall: saveDynamicTrackedSetsListSentinelRootMargin,
            getSavedValue: (result, fallbackValue) => result.dynamicTrackedSetsListSentinelRootMargin ?? fallbackValue,
        });
    };

    const onToggleDynamicGameNotesLoading = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicGameNotesLoading,
            applyValue: setDynamicGameNotesLoading,
            saveCall: saveDynamicGameNotesLoading,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicGameNotesLoading ?? fallbackValue),
        });

    const onCycleDynamicGameNotesInitialRows = () => {
        const previousValue = dynamicGameNotesInitialRows;
        const nextValue = nextDynamicGameNotesInitialRows(dynamicGameNotesInitialRows);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicGameNotesInitialRows,
            saveCall: saveDynamicGameNotesInitialRows,
            getSavedValue: (result, fallbackValue) => result.dynamicGameNotesInitialRows ?? fallbackValue,
        });
    };

    const onCycleDynamicGameNotesRowStep = () => {
        const previousValue = dynamicGameNotesRowStep;
        const nextValue = nextDynamicGameNotesRowStep(dynamicGameNotesRowStep);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicGameNotesRowStep,
            saveCall: saveDynamicGameNotesRowStep,
            getSavedValue: (result, fallbackValue) => result.dynamicGameNotesRowStep ?? fallbackValue,
        });
    };

    const onCycleDynamicGameNotesPrefetchDistance = () => {
        const previousValue = dynamicGameNotesPrefetchDistance;
        const nextValue = nextDynamicGameNotesPrefetchDistance(dynamicGameNotesPrefetchDistance);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicGameNotesPrefetchDistance,
            saveCall: saveDynamicGameNotesPrefetchDistance,
            getSavedValue: (result, fallbackValue) => result.dynamicGameNotesPrefetchDistance ?? fallbackValue,
        });
    };

    const onCycleDynamicGameNotesSentinelRootMargin = () => {
        const previousValue = dynamicGameNotesSentinelRootMargin;
        const nextValue = nextDynamicGameNotesSentinelRootMargin(dynamicGameNotesSentinelRootMargin);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicGameNotesSentinelRootMargin,
            saveCall: saveDynamicGameNotesSentinelRootMargin,
            getSavedValue: (result, fallbackValue) => result.dynamicGameNotesSentinelRootMargin ?? fallbackValue,
        });
    };

    const onToggleDynamicComments = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicComments,
            applyValue: setDynamicComments,
            saveCall: saveDynamicComments,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicComments ?? fallbackValue),
        });

    const onCycleDynamicCommentsInitialRows = () => {
        const previousValue = dynamicCommentsInitialRows;
        const nextValue = nextDynamicCommentsInitialRows(dynamicCommentsInitialRows);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicCommentsInitialRows,
            saveCall: saveDynamicCommentsInitialRows,
            getSavedValue: (result, fallbackValue) => result.dynamicCommentsInitialRows ?? fallbackValue,
        });
    };

    const onCycleDynamicCommentsRowStep = () => {
        const previousValue = dynamicCommentsRowStep;
        const nextValue = nextDynamicCommentsRowStep(dynamicCommentsRowStep);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicCommentsRowStep,
            saveCall: saveDynamicCommentsRowStep,
            getSavedValue: (result, fallbackValue) => result.dynamicCommentsRowStep ?? fallbackValue,
        });
    };

    const onCycleDynamicCommentsSentinelRootMargin = () => {
        const previousValue = dynamicCommentsSentinelRootMargin;
        const nextValue = nextDynamicCommentsSentinelRootMargin(dynamicCommentsSentinelRootMargin);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setDynamicCommentsSentinelRootMargin,
            saveCall: saveDynamicCommentsSentinelRootMargin,
            getSavedValue: (result, fallbackValue) => result.dynamicCommentsSentinelRootMargin ?? fallbackValue,
        });
    };

    const onToggleDynamicFriendLoading = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicFriendLoading,
            applyValue: setDynamicFriendLoading,
            saveCall: saveDynamicFriendLoading,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicFriendLoading ?? fallbackValue),
        });

    const onToggleDynamicLeaderboardLoading = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicLeaderboardLoading,
            applyValue: setDynamicLeaderboardLoading,
            saveCall: saveDynamicLeaderboardLoading,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicLeaderboardLoading ?? fallbackValue),
        });

    const onToggleDynamicLeaderboardResults = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicLeaderboardResults,
            applyValue: setDynamicLeaderboardResults,
            saveCall: saveDynamicLeaderboardResults,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicLeaderboardResults ?? fallbackValue),
        });

    const onToggleDynamicActivityFeed = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicActivityFeed,
            applyValue: setDynamicActivityFeed,
            saveCall: saveDynamicActivityFeed,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicActivityFeed ?? fallbackValue),
        });

    const onToggleDynamicCompare = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicCompare,
            applyValue: setDynamicCompare,
            saveCall: saveDynamicCompare,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicCompare ?? fallbackValue),
        });

    const onToggleDynamicFriendPicker = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicFriendPicker,
            applyValue: setDynamicFriendPicker,
            saveCall: saveDynamicFriendPicker,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicFriendPicker ?? fallbackValue),
        });

    const onToggleDynamicAllGames = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicAllGames,
            applyValue: setDynamicAllGames,
            saveCall: saveDynamicAllGames,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicAllGames ?? fallbackValue),
        });

    const onToggleDynamicTrackedGames = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicTrackedGames,
            applyValue: setDynamicTrackedGames,
            saveCall: saveDynamicTrackedGames,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicTrackedGames ?? fallbackValue),
        });

    const onToggleDynamicBadges = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicBadges,
            applyValue: setDynamicBadges,
            saveCall: saveDynamicBadges,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicBadges ?? fallbackValue),
        });

    const onToggleDynamicFollowedRanking = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dynamicFollowedRanking,
            applyValue: setDynamicFollowedRanking,
            saveCall: saveDynamicFollowedRanking,
            getSavedValue: (result, fallbackValue) => Boolean(result.dynamicFollowedRanking ?? fallbackValue),
        });

    const onCycleUiSize = () => {
        const previousValue = uiSize;
        const nextValue = nextScaleStep(uiSize);
        return saveSettingWithRollback<UiSize>({
            nextValue,
            previousValue,
            applyValue: setUiSize,
            saveCall: saveUiSize,
            getSavedValue: (result, fallbackValue) => result.uiSize ?? fallbackValue,
        });
    };

    const onCycleAchievementTextScale = () => {
        const previousValue = achievementTextScale;
        const nextValue = nextScaleStep(achievementTextScale);
        return saveSettingWithRollback<ScaleStep>({
            nextValue,
            previousValue,
            applyValue: (value) => {
                setAchievementTextScale(value);
                setCurrentAchievementTextScale(value);
            },
            saveCall: saveAchievementTextScale,
            getSavedValue: (result, fallbackValue) => result.achievementTextScale ?? fallbackValue,
        });
    };

    const onCycleCommentsTextScale = () => {
        const previousValue = commentsTextScale;
        const nextValue = nextScaleStep(commentsTextScale);
        return saveSettingWithRollback<ScaleStep>({
            nextValue,
            previousValue,
            applyValue: (value) => {
                setCommentsTextScale(value);
                setCurrentCommentsTextScale(value);
            },
            saveCall: saveCommentsTextScale,
            getSavedValue: (result, fallbackValue) => result.commentsTextScale ?? fallbackValue,
        });
    };

    const onCycleTextScale = () => {
        const previousValue = textScale;
        const nextValue = nextScaleStep(textScale);
        return saveSettingWithRollback<ScaleStep>({
            nextValue,
            previousValue,
            applyValue: (value) => {
                setTextScale(value);
                setCurrentTextScale(value);
            },
            saveCall: saveTextScale,
            getSavedValue: (result, fallbackValue) => result.textScale ?? fallbackValue,
        });
    };

    const onCycleTitleScale = () => {
        const previousValue = titleScale;
        const nextValue = nextScaleStep(titleScale);
        return saveSettingWithRollback<ScaleStep>({
            nextValue,
            previousValue,
            applyValue: (value) => {
                setTitleScale(value);
                setCurrentTitleScale(value);
            },
            saveCall: saveTitleScale,
            getSavedValue: (result, fallbackValue) => result.titleScale ?? fallbackValue,
        });
    };

    const onCycleHeaderScale = () => {
        const previousValue = headerScale;
        const nextValue = nextScaleStep(headerScale);
        return saveSettingWithRollback<ScaleStep>({
            nextValue,
            previousValue,
            applyValue: (value) => {
                setHeaderScale(value);
                setCurrentHeaderScale(value);
            },
            saveCall: saveHeaderScale,
            getSavedValue: (result, fallbackValue) => result.headerScale ?? fallbackValue,
        });
    };

    const onCycleBannerScale = () => {
        const previousValue = bannerScale;
        const nextValue = nextScaleStep(bannerScale);
        return saveSettingWithRollback<ScaleStep>({
            nextValue,
            previousValue,
            applyValue: (value) => {
                setBannerScale(value);
                setCurrentBannerScale(value);
            },
            saveCall: saveBannerScale,
            getSavedValue: (result, fallbackValue) => result.bannerScale ?? fallbackValue,
        });
    };

    const onCycleModalScale = () => {
        const previousValue = modalScale;
        const nextValue = nextScaleStep(modalScale);
        return saveSettingWithRollback<ScaleStep>({
            nextValue,
            previousValue,
            applyValue: (value) => {
                setModalScale(value);
                setCurrentModalScale(value);
            },
            saveCall: saveModalScale,
            getSavedValue: (result, fallbackValue) => result.modalScale ?? fallbackValue,
        });
    };

    const onApplyScalePreset = async (preset: ScalePreset) => {
        setLastScalePreset(preset);
        void saveLastScalePreset(preset).catch((e: any) => logError("saveLastScalePreset", e));
        const target = SCALE_PRESETS[preset];
        const previous: DisplayScales = {
            uiSize,
            achievementTextScale,
            commentsTextScale,
            textScale,
            titleScale,
            headerScale,
            bannerScale,
            modalScale
        };
        const applyScales = (scales: DisplayScales) => {
            setUiSize(scales.uiSize);
            setAchievementTextScale(scales.achievementTextScale);
            setCommentsTextScale(scales.commentsTextScale);
            setTextScale(scales.textScale);
            setTitleScale(scales.titleScale);
            setHeaderScale(scales.headerScale);
            setBannerScale(scales.bannerScale);
            setModalScale(scales.modalScale);
            setCurrentAchievementTextScale(scales.achievementTextScale);
            setCurrentCommentsTextScale(scales.commentsTextScale);
            setCurrentTextScale(scales.textScale);
            setCurrentTitleScale(scales.titleScale);
            setCurrentHeaderScale(scales.headerScale);
            setCurrentBannerScale(scales.bannerScale);
            setCurrentModalScale(scales.modalScale);
        };

        setError(null);
        applyScales(target);
        try {
            const result = await saveDisplayScales(
                target.uiSize,
                target.achievementTextScale,
                target.commentsTextScale,
                target.textScale,
                target.titleScale,
                target.headerScale,
                target.bannerScale,
                target.modalScale
            );
            if (!mountedRef.current) {
                return;
            }
            applyScales({
                uiSize: result.uiSize,
                achievementTextScale: result.achievementTextScale,
                commentsTextScale: result.commentsTextScale,
                textScale: result.textScale,
                titleScale: result.titleScale,
                headerScale: result.headerScale,
                bannerScale: result.bannerScale,
                modalScale: result.modalScale
            });
        } catch (e: any) {
            logError("onApplyScalePreset", e);
            if (!mountedRef.current) {
                return;
            }
            applyScales(previous);
        }
    };

    const onCycleScalePreset = () => onApplyScalePreset(nextScalePreset(lastScalePreset));

    const onApplyMainUiPreset = async (preset: MainUiPreset) => {
        const target = MAIN_UI_PRESETS[preset];
        const previous: MainUiButtons = {
            showSocialHubButton,
            showTrackedSetsButton
        };
        const applyButtons = (buttons: MainUiButtons) => {
            setShowSocialHubButton(buttons.showSocialHubButton);
            setShowTrackedSetsButton(buttons.showTrackedSetsButton);
        };

        setError(null);
        applyButtons(target);
        try {
            const result = await saveMainUiPreset(
                target.showSocialHubButton,
                target.showTrackedSetsButton,
                showOptionsButton,
                showAButtonMode
            );
            if (!mountedRef.current) {
                return;
            }
            applyButtons({
                showSocialHubButton: result.showSocialHubButton,
                showTrackedSetsButton: result.showTrackedSetsButton
            });
        } catch (e: any) {
            logError("onApplyMainUiPreset", e);
            if (!mountedRef.current) {
                return;
            }
            applyButtons(previous);
        }
    };

    const onCycleBlockPadding = () => {
        const previousValue = blockPadding;
        const nextValue = nextBlockPadding(blockPadding);
        return saveSettingWithRollback<number>({
            nextValue,
            previousValue,
            applyValue: setBlockPadding,
            saveCall: saveBlockPadding,
            getSavedValue: (result, fallbackValue) => result.blockPadding ?? fallbackValue,
        });
    };

    const onCycleButtonSpacing = () => {
        const previousValue = buttonSpacing;
        const nextValue = nextButtonSpacing(buttonSpacing);
        return saveSettingWithRollback<ButtonSpacing>({
            nextValue,
            previousValue,
            applyValue: setButtonSpacing,
            saveCall: saveButtonSpacing,
            getSavedValue: (result, fallbackValue) => result.buttonSpacing ?? fallbackValue,
        });
    };

    const onToggleAutoRefresh = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: autoRefresh,
            applyValue: setAutoRefresh,
            saveCall: saveAutoRefresh,
            getSavedValue: (result, fallbackValue) => Boolean(result.autoRefresh ?? fallbackValue),
        });

    const onToggleLibraryBadge = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: libraryBadge,
            applyValue: (value: boolean) => {
                setLibraryBadge(value);
                applyLibraryBadge(value);
            },
            saveCall: saveLibraryBadge,
            getSavedValue: (result, fallbackValue) => Boolean(result.libraryBadge ?? fallbackValue),
        });

    const onToggleDeferModalCleanup = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: deferModalCleanup,
            applyValue: setDeferModalCleanup,
            saveCall: saveDeferModalCleanup,
            getSavedValue: (result, fallbackValue) => Boolean(result.deferModalCleanup ?? fallbackValue),
        });

    const onToggleLegacyCommentsLoading = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: legacyCommentsLoading,
            applyValue: setLegacyCommentsLoading,
            saveCall: saveLegacyCommentsLoading,
            getSavedValue: (result, fallbackValue) => Boolean(result.legacyCommentsLoading ?? fallbackValue),
        });

    const onToggleShowSocialHubButton = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showSocialHubButton,
            applyValue: setShowSocialHubButton,
            saveCall: saveShowSocialHubButton,
            getSavedValue: (result, fallbackValue) => Boolean(result.showSocialHubButton ?? fallbackValue),
        });

    const onToggleShowTrackedSetsButton = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showTrackedSetsButton,
            applyValue: setShowTrackedSetsButton,
            saveCall: saveShowTrackedSetsButton,
            getSavedValue: (result, fallbackValue) => Boolean(result.showTrackedSetsButton ?? fallbackValue),
        });

    const onTogglePutUpdaterOnDesktop = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: putUpdaterOnDesktop,
            applyValue: setPutUpdaterOnDesktop,
            saveCall: savePutUpdaterOnDesktop,
            getSavedValue: (result, fallbackValue) => Boolean(result.putUpdaterOnDesktop ?? fallbackValue),
        });

    const onToggleShowOptionsButton = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showOptionsButton,
            applyValue: setShowOptionsButton,
            saveCall: saveShowOptionsButton,
            getSavedValue: (result, fallbackValue) => Boolean(result.showOptionsButton ?? fallbackValue),
        });

    const onToggleQuickMenuShortcut = (id: QuickMenuShortcut, nextValue: boolean) => {
        if (nextValue && quickMenuShortcuts.length >= QUICK_MENU_SHORTCUT_LIMIT) {
            setQuickMenuShortcutRefused(id);
            return;
        }

        setQuickMenuShortcutRefused(null);
        const nextList = QUICK_MENU_SHORTCUTS
            .filter((entry) => entry.id === id ? nextValue : quickMenuShortcuts.includes(entry.id))
            .map((entry) => entry.id);

        return saveSettingWithRollback<QuickMenuShortcut[]>({
            nextValue: nextList,
            previousValue: quickMenuShortcuts,
            applyValue: setQuickMenuShortcuts,
            saveCall: saveQuickMenuShortcuts,
            getSavedValue: (result, fallbackValue) => result.quickMenuShortcuts ?? fallbackValue,
        });
    };

    const applyShortcutBinding = (button: ShortcutButton, action: ShortcutAction) =>
        saveSettingWithRollback<Record<ShortcutButton, ShortcutAction>>({
            nextValue: { ...shortcutBindings, [button]: action },
            previousValue: shortcutBindings,
            applyValue: setShortcutBindings,
            saveCall: (value) => saveShortcutBinding(button, value[button]),
        });

    const onCycleShortcutBinding = (button: ShortcutButton) =>
        applyShortcutBinding(button, nextShortcutAction(shortcutBindings[button]));

    const onCycleShortcutBindingBack = (button: ShortcutButton) =>
        applyShortcutBinding(button, previousShortcutAction(shortcutBindings[button]));

    const onToggleRememberLastPage = async (nextValue: boolean) => {
        setRememberLastPage(nextValue);
        setError(null);
        try {
            const result = await saveRememberLastPage(nextValue);
            if (!mountedRef.current) {
                return;
            }
            const savedValue = Boolean(result.rememberLastPage);
            setRememberLastPage(savedValue);
            if (savedValue) {
                await enableRememberLastPagePersistence();
                if (payload?.gameId) {
                    setPendingPrimaryViewRestoreGameId(payload.gameId);
                }
            }
            else {
                await disableRememberLastPagePersistence();
            }
        } catch (e: any) {
            logError("onToggleRememberLastPage", e);
            if (!mountedRef.current) {
                return;
            }
            setRememberLastPage(!nextValue);
        }
    };

    const onToggleShowIcons = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showIcons,
            applyValue: setShowIcons,
            saveCall: saveShowIcons,
            getSavedValue: (result, fallbackValue) => Boolean(result.showIcons ?? fallbackValue),
        });

    const onCycleSocialEntryDefault = () => {
        const previousValue = socialEntryDefault;
        const nextValue = nextSocialEntryDefault(socialEntryDefault);
        return saveSettingWithRollback<SocialEntryDefault>({
            nextValue,
            previousValue,
            applyValue: setSocialEntryDefault,
            saveCall: saveSocialEntryDefault,
            getSavedValue: (result, fallbackValue) => result.socialEntryDefault ?? fallbackValue,
        });
    };

    const onCycleActivityCardAction = () => {
        const previousValue = activityCardAction;
        const nextValue = nextActivityCardAction(activityCardAction);
        return saveSettingWithRollback<ActivityCardAction>({
            nextValue,
            previousValue,
            applyValue: setActivityCardAction,
            saveCall: saveActivityCardAction,
            getSavedValue: (result, fallbackValue) => result.activityCardAction ?? fallbackValue,
        });
    };

    const onCycleFriendFeedCardAction = () => {
        const previousValue = friendFeedCardAction;
        const nextValue = nextActivityCardAction(friendFeedCardAction);
        return saveSettingWithRollback<ActivityCardAction>({
            nextValue,
            previousValue,
            applyValue: setFriendFeedCardAction,
            saveCall: saveFriendFeedCardAction,
            getSavedValue: (result, fallbackValue) => result.friendFeedCardAction ?? fallbackValue,
        });
    };

    const onCycleSocialHubCardAction = () => {
        const previousValue = socialHubCardAction;
        const nextValue = nextActivityCardAction(socialHubCardAction);
        return saveSettingWithRollback<ActivityCardAction>({
            nextValue,
            previousValue,
            applyValue: setSocialHubCardAction,
            saveCall: saveSocialHubCardAction,
            getSavedValue: (result, fallbackValue) => result.socialHubCardAction ?? fallbackValue,
        });
    };

    const optionsState = {
        focusScopeResetToken,
        activeOptionsTab,
        language,
        buttonSpacing,
        loading,
        saving,
        checkingGame,
        clearingCache,
        clearingGameDataCache,
        clearingFriendsCache,
        clearingImagesCache,
        clearingOtherIconsCache,
        clearingSocialActivityCache,
        clearingGameActivityCache,
        clearingPlayersNearYouCache,
        clearingGamesListCache,
        clearingAwardsListCache,
        clearingWantToPlayCache,
        clearingGameOverviewCache,
        clearingAllCache,
        clearingResolvedAvatars,
        factoryResetting,
        refreshingFriends,
        deepRefreshingFriends,
        users,
        addingUser,
        switchingUser,
        payload,
        unlockLookbackMinutes,
        unlockHistoryDays,
        friendRefreshDelayMs,
        activityCacheMinutes,
        trickleLookbackHours,
        activityFriendsPerTick,
        socialGameTicker,
        socialHubTicker,
        socialActivityTrickleService,
        trickleFavoritesOnly,
        friendAutoRefresh,
        showReminderTicker,
        showNotesDot,
        showBellDot,
        notifyNoteReminderEnabled,
        notifyNoteReminderToast,
        notifyTrackedSetEnabled,
        notifyTrackedSetToast,
        notifyCommentTrackerEnabled,
        notifyCommentTrackerToast,
        notifyWallEnabled,
        notifyWallToast,
        notifySystemEnabled,
        notifySystemToast,
        notifyTrackedEnabled,
        notifyTrackedToast,
        notifySocialUnlockEnabled,
        notifySocialUnlockToast,
        notifyNearYouEnabled,
        notifyNearYouToast,
        legacyAchievementLinks,
        legacyGameLinks,
        showDeveloperOptions,
        autoPurgeService,
        keepGuidesOffline,
        trackedSetsAutoCheck,
        trackedSetsServiceEnabled,
        debugLogging,
        notifyDebugEnabled,
        notifyDebugToast,
        ipcSlowThresholdMs,
        largeViewportBonusEnabled,
        largeViewportBonus,
        parallelRaCalls,
        parallelCdnFetches,
        maxIconWorkers,
        avatarWorkers,
        gameIconWorkers,
        gameArtCacheCap,
        avatarCacheCap,
        achievementIconCacheGames,
        friendImageService,
        validateFriendsRoster,
        fisTickFrequencyMinutes,
        commentsServiceTickMinutes,
        trackedSetsRefreshMinutes,
        commentsServiceFetchAmount,
        commentsServiceWallCheck,
        fisRosterRefreshIntervalHours,
        fisVerifyFavoriteAvatars,
        fisVerifyAllAvatars,
        playersNearYouEnabled,
        playersNearYouLookbehind,
        playersNearYouLookahead,
        playersNearYouMinTickMinutes,
        playersNearYouMaxTickMinutes,
        gamesListCacheMinutes,
        awardsListCacheMinutes,
        wantToPlayCacheMinutes,
        bigListThreshold,
        alwaysStaggerMounting,
        returnStaggerFrames,
        dynamicLoading,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        dynamicTrackedListLoading,
        dynamicTrackedListInitialRows,
        dynamicTrackedListRowStep,
        dynamicTrackedListPrefetchDistance,
        dynamicTrackedListSentinelRootMargin,
        dynamicTrackedSetsListLoading,
        dynamicTrackedSetsListInitialRows,
        dynamicTrackedSetsListRowStep,
        dynamicTrackedSetsListPrefetchDistance,
        dynamicTrackedSetsListSentinelRootMargin,
        dynamicGameNotesLoading,
        dynamicGameNotesInitialRows,
        dynamicGameNotesRowStep,
        dynamicGameNotesPrefetchDistance,
        dynamicGameNotesSentinelRootMargin,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        dynamicCommentsSentinelRootMargin,
        dynamicFriendLoading,
        dynamicLeaderboardLoading,
        dynamicLeaderboardResults,
        dynamicActivityFeed,
        dynamicCompare,
        dynamicFriendPicker,
        dynamicAllGames,
        dynamicTrackedGames,
        dynamicBadges,
        dynamicFollowedRanking,
        blockPadding,
        buttonSpacingValue: buttonSpacing,
        uiSize,
        achievementTextScale,
        commentsTextScale,
        textScale,
        titleScale,
        headerScale,
        bannerScale,
        modalScale,
        showIcons,
        deferModalCleanup,
        libraryBadge,
        legacyCommentsLoading,
        batterySaverDisablesSocialActivity,
        batterySaverDisablesComments,
        batterySaverDisablesFriendAvatars,
        batterySaverDisablesPlayersNearYou,
        batterySaverDisablesTrackedSets,
        batterySaverDisablesFileWatcher,
        doNotDisturbDisablesDot,
        doNotDisturbDisablesToast,
        nightModeBrightness,
        autoRefresh,
        rememberLastPage,
        controllerGlyphStyle,
        coloredGlyphs,
        showAButtonMode,
        showAButtonModeTracked,
        showSocialHubButton,
        showTrackedSetsButton,
        showOptionsButton,
        quickMenuShortcuts,
        quickMenuShortcutRefused,
        shortcutBindings,
        putUpdaterOnDesktop,
        showAllToggleMain,
        showAllToggleFriend,
        showTrackedNotesMain,
        showRetroPoints,
        achievementStyle,
        trackedColor,
        socialEntryDefault,
        activityCardAction,
        friendFeedCardAction,
        socialHubCardAction,
        gameNotesAButtonMode,
        error
    };

    const optionsActions = {
        onBack,
        onGoToAbout,
        onRefreshNow,
        onEditCredentials,
        onOpenSetupProfiles,
        onAddUser,
        onSwitchUser,
        onOpenLanguage,
        onSelectLanguage,
        onResetSettings,
        onApplySetupProfile,
        onSelectOptionsTab,
        onClearGameData,
        onSimulateNoGame,
        onPreviewBootCat,
        onClearFriendsCache,
        onManualRefreshFriends,
        onDeepRosterRefresh,
        onClearImages,
        onClearOtherIcons,
        onClearSocialActivity,
        onClearGameActivity,
        onClearPlayersNearYou,
        onClearGamesListCache,
        onClearAwardsListCache,
        onClearWantToPlayCache,
        onClearGameOverviewCache,
        onClearAllCache,
        onClearSetsCache,
        onClearCheevoCheckResults,
        onClearCheevoCheckHashes,
        onClearCheevoCheckRaData,
        onClearFileWatcherReport,
        onClearFileWatcherMap,
        onClearFileWatcherEverything,
        onClearFileWatcherRunTimes,
        onDeleteLeaderboardsCache,
        onClearResolvedAvatars,
        onClearTracked,
        onClearAllTracked,
        onClearAllTrackedSets,
        onClearDolphinMappings,
        onResetDolphinMappings,
        onCleanupDirectory,
        onUpdateCheevoCheckReferenceData,
        onFactoryReset,
        onDeleteAllNotes,
        onClearGuideCache,
        onToggleKeepGuidesOffline,
        onDeleteAllGuideData,
        onDeleteAllNotifications,
        onClearArchivedNotifications,
        onClearSavedComments,
        onCycleUnlockLookback,
        onCycleUnlockHistoryDays,
        onCycleFriendRefreshDelay,
        onCycleActivityCacheMinutes,
        onCycleTrickleLookbackHours,
        onCycleActivityFriendsPerTick,
        onToggleSocialGameTicker,
        onToggleSocialHubTicker,
        onToggleSocialActivityTrickleService,
        onToggleTrickleFavoritesOnly,
        onToggleFriendAutoRefresh,
        onToggleShowReminderTicker,
        onToggleShowNotesDot,
        onToggleShowBellDot,
        onToggleNotifyNoteReminderEnabled,
        onToggleNotifyNoteReminderToast,
        onToggleNotifyTrackedSetEnabled,
        onToggleNotifyTrackedSetToast,
        onToggleNotifyCommentTrackerEnabled,
        onToggleNotifyCommentTrackerToast,
        onToggleNotifyWallEnabled,
        onToggleNotifyWallToast,
        onToggleNotifySystemEnabled,
        onToggleNotifySystemToast,
        onToggleNotifyTrackedEnabled,
        onToggleNotifyTrackedToast,
        onToggleNotifySocialUnlockEnabled,
        onToggleNotifySocialUnlockToast,
        onTogglePlayersNearYouEnabled,
        onCyclePlayersNearYouLookbehind,
        onCyclePlayersNearYouLookahead,
        onCyclePlayersNearYouMinTickMinutes,
        onCyclePlayersNearYouMaxTickMinutes,
        onCycleGamesListCacheMinutes,
        onCycleAwardsListCacheMinutes,
        onCycleWantToPlayCacheMinutes,
        onToggleNotifyNearYouEnabled,
        onToggleNotifyNearYouToast,
        onToggleLegacyAchievementLinks,
        onToggleLegacyGameLinks,
        onToggleShowDeveloperOptions,
        onToggleAutoPurgeService,
        onToggleTrackedSetsAutoCheck,
        onToggleTrackedSetsServiceEnabled,
        onToggleDebugLogging,
        onToggleNotifyDebugEnabled,
        onToggleNotifyDebugToast,
        onFireTestNotification,
        onFireTestCommentNotification,
        onFireTestUpdateNotification,
        onFireTestTrackedSet,
        onInjectFakeSelfName,
        onInjectFakeFriendName,
        onCycleIpcSlowThresholdMs,
        onToggleLargeViewportBonusEnabled,
        onCycleLargeViewportBonus,
        onCycleParallelRaCalls,
        onCycleParallelCdnFetches,
        onCycleMaxIconWorkers,
        onCycleAvatarWorkers,
        onCycleGameIconWorkers,
        onCycleGameArtCacheCap,
        onCycleAvatarCacheCap,
        onCycleAchievementIconCacheGames,
        onToggleFriendImageService,
        onToggleValidateFriendsRoster,
        onCycleFisTickFrequencyMinutes,
        onCycleCommentsServiceTickMinutes,
        onCycleTrackedSetsRefreshMinutes,
        onCycleCommentsServiceFetchAmount,
        onToggleCommentsServiceWallCheck,
        onCycleFisRosterRefreshIntervalHours,
        onToggleFisVerifyFavoriteAvatars,
        onToggleFisVerifyAllAvatars,
        onCycleBigListThreshold,
        onCycleReturnStaggerFrames,
        onToggleDynamicLoading,
        onCycleDynamicInitialRows,
        onCycleDynamicRowStep,
        onCycleDynamicPrefetchDistance,
        onCycleDynamicSentinelRootMargin,
        onToggleDynamicTrackedListLoading,
        onCycleDynamicTrackedListInitialRows,
        onCycleDynamicTrackedListRowStep,
        onCycleDynamicTrackedListPrefetchDistance,
        onCycleDynamicTrackedListSentinelRootMargin,
        onToggleDynamicTrackedSetsListLoading,
        onCycleDynamicTrackedSetsListInitialRows,
        onCycleDynamicTrackedSetsListRowStep,
        onCycleDynamicTrackedSetsListPrefetchDistance,
        onCycleDynamicTrackedSetsListSentinelRootMargin,
        onToggleDynamicGameNotesLoading,
        onCycleDynamicGameNotesInitialRows,
        onCycleDynamicGameNotesRowStep,
        onCycleDynamicGameNotesPrefetchDistance,
        onCycleDynamicGameNotesSentinelRootMargin,
        onToggleDynamicComments,
        onCycleDynamicCommentsInitialRows,
        onCycleDynamicCommentsRowStep,
        onCycleDynamicCommentsSentinelRootMargin,
        onToggleDynamicFriendLoading,
        onToggleDynamicLeaderboardLoading,
        onToggleDynamicLeaderboardResults,
        onToggleDynamicActivityFeed,
        onToggleDynamicCompare,
        onToggleDynamicFriendPicker,
        onToggleDynamicAllGames,
        onToggleDynamicTrackedGames,
        onToggleDynamicBadges,
        onToggleDynamicFollowedRanking,
        onCycleBlockPadding,
        onCycleButtonSpacing,
        onCycleAchievementStyle,
        onCycleTrackedColor,
        onCycleSocialEntryDefault,
        onCycleActivityCardAction,
        onCycleFriendFeedCardAction,
        onCycleSocialHubCardAction,
        onSaveGameNotesAButtonMode,
        onCycleUiSize,
        onCycleAchievementTextScale,
        onCycleCommentsTextScale,
        onCycleTextScale,
        onCycleTitleScale,
        onCycleHeaderScale,
        onCycleBannerScale,
        onCycleModalScale,
        onApplyScalePreset,
        onCycleScalePreset,
        onApplyMainUiPreset,
        onToggleQuickMenuShortcut,
        onCycleShortcutBinding,
        onCycleShortcutBindingBack,
        onToggleShowIcons,
        onToggleDeferModalCleanup,
        onToggleLibraryBadge,
        onToggleLegacyCommentsLoading,
        onToggleBatterySaverDisablesSocialActivity,
        onToggleBatterySaverDisablesComments,
        onToggleBatterySaverDisablesFriendAvatars,
        onToggleBatterySaverDisablesPlayersNearYou,
        onToggleBatterySaverDisablesTrackedSets,
        onToggleBatterySaverDisablesFileWatcher,
        onToggleDoNotDisturbDisablesDot,
        onToggleDoNotDisturbDisablesToast,
        onCycleNightModeBrightness,
        onToggleAutoRefresh,
        onToggleRememberLastPage,
        onCycleControllerGlyphStyle,
        onToggleColoredGlyphs,
        onToggleShowAButtonMode,
        onToggleShowAButtonModeTracked,
        onToggleShowSocialHubButton,
        onToggleShowTrackedSetsButton,
        onTogglePutUpdaterOnDesktop,
        onToggleShowOptionsButton,
        onToggleShowAllToggleMain,
        onToggleShowAllToggleFriend,
        onToggleShowTrackedNotesMain,
        onToggleShowRetroPoints,
        onToggleAlwaysStaggerMounting
    };

    return { state: optionsState, actions: optionsActions };
}
