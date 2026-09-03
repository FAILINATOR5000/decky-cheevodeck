import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { DEFAULT_LANGUAGE, ensureLanguageLoaded, setCurrentLanguage, type LanguageCode } from "../locales";
import type {
    AchievementSort,
    AchievementStyle,
    ActivityCardAction,
    ButtonSpacing,
    ControllerGlyphStyle,
    FriendAchievementFilter,
    GameNoteAButtonMode,
    MainAchievementAction,
    MainAchievementFilter,
    NoteColor,
    OptionsTab,
    PlayersNearYouTapMode,
    QuickMenuShortcut,
    SavedUser,
    ScalePreset,
    SettingsResponse,
    ShortcutAction,
    ShortcutButton,
    SocialEntryDefault,
    SavedCommentsPrefs,
    TrackedAchievementAction,
    TrackedSetAButtonMode,
    DolphinMapperMode,
    DolphinSystemFilter,
    CheevoCheckVerifySpeed,
    FileWatcherSpeed,
    TrackedAchievementSort,
    TrackedColor,
    TrackedSetFilter,
    TrackedSetSelectorSort,
    TrackedTab,
    ScaleStep,
    UiSize,
    SocialView,
    BadgesSortOrder
} from "../types";
import { logError } from "../utils/errors";
import { DEFAULT_SHORTCUT_BINDINGS } from "../utils/options";
import { setSnapshotHotkey } from "../utils/snapshotHotkey";
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
    clampGuideZoom,
    GUIDE_ZOOM_DEFAULT,
    GUIDE_MODAL_ZOOM_DEFAULT
} from "../utils/scale";
import { setCurrentColoredGlyphs } from "../utils/controllerGlyphs";
import {
    applyGameArtCacheCap,
    applyAvatarCacheCap,
    applyAchievementIconCacheGames,
    saveDoNotDisturb,
    saveNightMode,
    saveBatterySaver,
    saveMouseKeyboardMode
} from "../api";

type UseSettingsControllerArgs = {
    mountedRef: RefObject<boolean>;
    setError: Dispatch<SetStateAction<string | null>>;
};

export function useSettingsController({
    mountedRef,
    setError
}: UseSettingsControllerArgs) {
    const [username, setUsername] = useState("");
    const [activeUlid, setActiveUlid] = useState("");
    const [hasApiKey, setHasApiKey] = useState(false);
    const [users, setUsers] = useState<SavedUser[]>([]);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [showIcons, setShowIcons] = useState(true);
    const [deferModalCleanup, setDeferModalCleanup] = useState(true);
    const [legacyCommentsLoading, setLegacyCommentsLoading] = useState(false);
    const [showAllAchievements, setShowAllAchievements] = useState(true);
    const [unlockLookbackMinutes, setUnlockLookbackMinutes] = useState(1440);
    const [unlockHistoryDays, setUnlockHistoryDays] = useState(-1);
    const [rememberLastPage, setRememberLastPage] = useState(true);
    const [uiSize, setUiSize] = useState<UiSize>("normal");
    const [achievementTextScale, setAchievementTextScale] = useState<ScaleStep>("normal");
    const [commentsTextScale, setCommentsTextScale] = useState<ScaleStep>("normal");
    const [textScale, setTextScale] = useState<ScaleStep>("normal");
    const [titleScale, setTitleScale] = useState<ScaleStep>("normal");
    const [headerScale, setHeaderScale] = useState<ScaleStep>("normal");
    const [bannerScale, setBannerScale] = useState<ScaleStep>("normal");
    const [modalScale, setModalScale] = useState<ScaleStep>("normal");
    const [guideZoom, setGuideZoom] = useState<number>(GUIDE_ZOOM_DEFAULT);
    const [guideModalZoom, setGuideModalZoom] = useState<number>(GUIDE_MODAL_ZOOM_DEFAULT);
    const [pinLatestGuides, setPinLatestGuides] = useState(false);
    const [keepGuidesOffline, setKeepGuidesOffline] = useState(false);
    const [topPadding, setTopPadding] = useState(0);
    const [blockPadding, setBlockPadding] = useState(8);
    const [buttonSpacing, setButtonSpacing] = useState<ButtonSpacing>("verysmall");
    const [mouseKeyboardMode, setMouseKeyboardMode] = useState(false);
    const [controllerGlyphStyle, setControllerGlyphStyle] = useState<ControllerGlyphStyle>("auto");
    const [coloredGlyphs, setColoredGlyphs] = useState(true);
    const [showAButtonMode, setShowAButtonMode] = useState(true);
    const [showAButtonModeTracked, setShowAButtonModeTracked] = useState(true);
    const [gameNotesAButtonMode, setGameNotesAButtonMode] = useState<GameNoteAButtonMode>("editNote");
    const [showSocialHubButton, setShowSocialHubButton] = useState(true);
    const [showTrackedSetsButton, setShowTrackedSetsButton] = useState(true);
    const [putUpdaterOnDesktop, setPutUpdaterOnDesktop] = useState(true);
    const [showOptionsButton, setShowOptionsButton] = useState(false);
    const [quickMenuShortcuts, setQuickMenuShortcuts] = useState<QuickMenuShortcut[]>([]);
    const [shortcutBindings, setShortcutBindings] = useState<Record<ShortcutButton, ShortcutAction>>(DEFAULT_SHORTCUT_BINDINGS);

    useEffect(() => {
        setSnapshotHotkey(shortcutBindings);
    }, [shortcutBindings]);
    const [lastScalePreset, setLastScalePreset] = useState<ScalePreset>("portable");
    const [showAllToggleMain, setShowAllToggleMain] = useState(false);
    const [showAllToggleFriend, setShowAllToggleFriend] = useState(false);
    const [showTrackedNotesMain, setShowTrackedNotesMain] = useState(false);
    const [showRetroPoints, setShowRetroPoints] = useState(false);
    const [achievementStyle, setAchievementStyle] = useState<AchievementStyle>("left");
    const [trackedColor, setTrackedColor] = useState<TrackedColor>("default");
    const [mainAchievementFilter, setMainAchievementFilter] = useState<MainAchievementFilter>("all");
    const [mainAchievementSort, setMainAchievementSort] = useState<AchievementSort>("upNext");
    const [mainAchievementAction, setMainAchievementAction] = useState<MainAchievementAction>("track");
    const [trackedAchievementAction, setTrackedAchievementAction] = useState<TrackedAchievementAction>("untrack");
    const [dolphinMapperMode, setDolphinMapperMode] = useState<DolphinMapperMode>("map");
    const [dolphinSystemFilter, setDolphinSystemFilter] = useState<DolphinSystemFilter>("all");
    const [dolphinBluetoothPassthrough, setDolphinBluetoothPassthrough] = useState<boolean>(false);
    const [dolphinContinuousScanning, setDolphinContinuousScanning] = useState<boolean>(false);
    const [dolphinBalanceBoard, setDolphinBalanceBoard] = useState<boolean>(false);
    const [cheevoCheckCacheHashes, setCheevoCheckCacheHashes] = useState(true);
    const [cheevoCheckExtractToRam, setCheevoCheckExtractToRam] = useState(false);
    const [cheevoCheckVerifyHashes, setCheevoCheckVerifyHashes] = useState(false);
    const [cheevoCheckVerifySpeed, setCheevoCheckVerifySpeed] = useState<CheevoCheckVerifySpeed>("gentle");
    const [cheevoCheckScanCollapsed, setCheevoCheckScanCollapsed] = useState(false);
    const [cheevoCheckResultsCollapsed, setCheevoCheckResultsCollapsed] = useState(false);
    const [cheevoCheckVerifyCollapsed, setCheevoCheckVerifyCollapsed] = useState(false);
    const [cheevoCheckOptionsCollapsed, setCheevoCheckOptionsCollapsed] = useState(false);
    const [cheevoCheckSkipDiscVerify, setCheevoCheckSkipDiscVerify] = useState(false);
    const [cheevoCheckSkipCartVerify, setCheevoCheckSkipCartVerify] = useState(false);
    const [libraryBadge, setLibraryBadge] = useState(false);
    const [fileWatcherSpeed, setFileWatcherSpeed] = useState<FileWatcherSpeed>("gentle");
    const [fileWatcherRunDuringGames, setFileWatcherRunDuringGames] = useState(true);
    const [trackedSetAButtonMode, setTrackedSetAButtonMode] = useState<TrackedSetAButtonMode>("editNote");
    const [trackedAchievementSort, setTrackedAchievementSort] = useState<TrackedAchievementSort>("upNext");
    const [friendAchievementFilter, setFriendAchievementFilter] = useState<FriendAchievementFilter>("all");
    const [friendAchievementSort, setFriendAchievementSort] = useState<AchievementSort>("upNext");
    const [friendShowAllAchievements, setFriendShowAllAchievements] = useState(true);
    const [trackedSetsAutoCheck, setTrackedSetsAutoCheck] = useState(true);
    const [trackedSetsServiceEnabled, setTrackedSetsServiceEnabled] = useState(true);
    const [trackedSetsRefreshMinutes, setTrackedSetsRefreshMinutes] = useState(15);
    const [trackedSetsSelectorSort, setTrackedSetsSelectorSort] = useState<TrackedSetSelectorSort>("alphabetical");
    const [trackedSetsSelectorFilter, setTrackedSetsSelectorFilter] = useState<TrackedSetFilter>("all");
    const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
    const [, markLocaleTableLoaded] = useState(0);
    const [friendRefreshDelayMs, setFriendRefreshDelayMs] = useState(1000);
    const [activityCacheMinutes, setActivityCacheMinutes] = useState(5);
    const [trickleLookbackHours, setTrickleLookbackHours] = useState(3);
    const [activityFriendsPerTick, setActivityFriendsPerTick] = useState(3);
    const [socialGameTicker, setSocialGameTicker] = useState(true);
    const [socialHubTicker, setSocialHubTicker] = useState(true);
    const [socialActivityTrickleService, setSocialActivityTrickleService] = useState(true);
    const [trickleFavoritesOnly, setTrickleFavoritesOnly] = useState(false);
    const [friendAutoRefresh, setFriendAutoRefresh] = useState(true);
    const [showReminderTicker, setShowReminderTicker] = useState(false);
    const [showNotesDot, setShowNotesDot] = useState(false);
    const [showBellDot, setShowBellDot] = useState(true);
    const [doNotDisturb, setDoNotDisturb] = useState(false);
    const [doNotDisturbDisablesDot, setDoNotDisturbDisablesDot] = useState(true);
    const [doNotDisturbDisablesToast, setDoNotDisturbDisablesToast] = useState(true);
    const [nightMode, setNightMode] = useState(false);
    const [nightModeBrightness, setNightModeBrightness] = useState(0.75);
    const [batterySaver, setBatterySaver] = useState(false);
    const [batterySaverDisablesSocialActivity, setBatterySaverDisablesSocialActivity] = useState(true);
    const [batterySaverDisablesComments, setBatterySaverDisablesComments] = useState(true);
    const [batterySaverDisablesFriendAvatars, setBatterySaverDisablesFriendAvatars] = useState(true);
    const [batterySaverDisablesPlayersNearYou, setBatterySaverDisablesPlayersNearYou] = useState(true);
    const [batterySaverDisablesTrackedSets, setBatterySaverDisablesTrackedSets] = useState(true);
    const [batterySaverDisablesFileWatcher, setBatterySaverDisablesFileWatcher] = useState(true);
    const [notifyNoteReminderEnabled, setNotifyNoteReminderEnabled] = useState(true);
    const [notifyNoteReminderToast, setNotifyNoteReminderToast] = useState(true);
    const [notifyTrackedSetEnabled, setNotifyTrackedSetEnabled] = useState(true);
    const [notifyTrackedSetToast, setNotifyTrackedSetToast] = useState(true);
    const [notifyCommentTrackerEnabled, setNotifyCommentTrackerEnabled] = useState(true);
    const [notifyCommentTrackerToast, setNotifyCommentTrackerToast] = useState(true);
    const [notifyWallEnabled, setNotifyWallEnabled] = useState(true);
    const [notifyWallToast, setNotifyWallToast] = useState(true);
    const [notifySystemEnabled, setNotifySystemEnabled] = useState(true);
    const [notifySystemToast, setNotifySystemToast] = useState(true);
    const [notifyTrackedEnabled, setNotifyTrackedEnabled] = useState(false);
    const [notifyTrackedToast, setNotifyTrackedToast] = useState(false);
    const [notifySocialUnlockEnabled, setNotifySocialUnlockEnabled] = useState(false);
    const [notifySocialUnlockToast, setNotifySocialUnlockToast] = useState(false);
    const [notifyNearYouEnabled, setNotifyNearYouEnabled] = useState(false);
    const [notifyNearYouToast, setNotifyNearYouToast] = useState(false);
    const [legacyAchievementLinks, setLegacyAchievementLinks] = useState(false);
    const [legacyGameLinks, setLegacyGameLinks] = useState(false);
    const [showDeveloperOptions, setShowDeveloperOptions] = useState(false);
    const [autoPurgeService, setAutoPurgeService] = useState(true);
    const [debugLogging, setDebugLogging] = useState(false);
    const [injectEmulatorLogin, setInjectEmulatorLogin] = useState(false);
    const [notifyDebugEnabled, setNotifyDebugEnabled] = useState(false);
    const [notifyDebugToast, setNotifyDebugToast] = useState(false);
    const [ipcSlowThresholdMs, setIpcSlowThresholdMs] = useState(250);
    const [largeViewportBonusEnabled, setLargeViewportBonusEnabled] = useState(true);
    const [largeViewportBonus, setLargeViewportBonus] = useState(8);
    const [parallelRaCalls, setParallelRaCalls] = useState(4);
    const [parallelCdnFetches, setParallelCdnFetches] = useState(5);
    const [maxIconWorkers, setMaxIconWorkers] = useState(6);
    const [avatarWorkers, setAvatarWorkers] = useState(2);
    const [gameIconWorkers, setGameIconWorkers] = useState(6);
    const [gameArtCacheCap, setGameArtCacheCap] = useState(1024);
    const [avatarCacheCap, setAvatarCacheCap] = useState(1024);
    const [achievementIconCacheGames, setAchievementIconCacheGames] = useState(8);
    const [friendImageService, setFriendImageService] = useState(true);
    const [validateFriendsRoster, setValidateFriendsRoster] = useState(true);
    const [fisTickFrequencyMinutes, setFisTickFrequencyMinutes] = useState(5);
    const [commentsServiceTickMinutes, setCommentsServiceTickMinutes] = useState(5);
    const [commentsServiceFetchAmount, setCommentsServiceFetchAmount] = useState(20);
    const [commentsServiceWallCheck, setCommentsServiceWallCheck] = useState(true);
    const [fisRosterRefreshIntervalHours, setFisRosterRefreshIntervalHours] = useState(6);
    const [fisVerifyFavoriteAvatars, setFisVerifyFavoriteAvatars] = useState(true);
    const [fisVerifyAllAvatars, setFisVerifyAllAvatars] = useState(false);
    const [playersNearYouEnabled, setPlayersNearYouEnabled] = useState(true);
    const [playersNearYouLookbehind, setPlayersNearYouLookbehind] = useState(2);
    const [playersNearYouLookahead, setPlayersNearYouLookahead] = useState(6);
    const [playersNearYouMinTickMinutes, setPlayersNearYouMinTickMinutes] = useState(5);
    const [playersNearYouMaxTickMinutes, setPlayersNearYouMaxTickMinutes] = useState(15);
    const [gamesListCacheMinutes, setGamesListCacheMinutes] = useState(15);
    const [awardsListCacheMinutes, setAwardsListCacheMinutes] = useState(15);
    const [wantToPlayCacheMinutes, setWantToPlayCacheMinutes] = useState(20);
    const [playersNearYouTapMode, setPlayersNearYouTapMode] = useState<PlayersNearYouTapMode>("profile");
    const [playersNearYouCollapsed, setPlayersNearYouCollapsed] = useState(false);
    const [dolphinAdvancedCollapsed, setDolphinAdvancedCollapsed] = useState(true);
    const [bigListThreshold, setBigListThreshold] = useState(9999);
    const [alwaysStaggerMounting, setAlwaysStaggerMounting] = useState(false);
    const [returnStaggerFrames, setReturnStaggerFrames] = useState(0);
    const [dynamicLoading, setDynamicLoading] = useState(true);
    const [dynamicInitialRows, setDynamicInitialRows] = useState(30);
    const [dynamicRowStep, setDynamicRowStep] = useState(5);
    const [dynamicPrefetchDistance, setDynamicPrefetchDistance] = useState(12);
    const [dynamicSentinelRootMargin, setDynamicSentinelRootMargin] = useState(600);
    const [dynamicTrackedListLoading, setDynamicTrackedListLoading] = useState(true);
    const [dynamicTrackedListInitialRows, setDynamicTrackedListInitialRows] = useState(10);
    const [dynamicTrackedListRowStep, setDynamicTrackedListRowStep] = useState(10);
    const [dynamicTrackedListPrefetchDistance, setDynamicTrackedListPrefetchDistance] = useState(12);
    const [dynamicTrackedListSentinelRootMargin, setDynamicTrackedListSentinelRootMargin] = useState(600);
    const [dynamicTrackedSetsListLoading, setDynamicTrackedSetsListLoading] = useState(true);
    const [dynamicTrackedSetsListInitialRows, setDynamicTrackedSetsListInitialRows] = useState(10);
    const [dynamicTrackedSetsListRowStep, setDynamicTrackedSetsListRowStep] = useState(10);
    const [dynamicTrackedSetsListPrefetchDistance, setDynamicTrackedSetsListPrefetchDistance] = useState(12);
    const [dynamicTrackedSetsListSentinelRootMargin, setDynamicTrackedSetsListSentinelRootMargin] = useState(600);
    const [dynamicGameNotesLoading, setDynamicGameNotesLoading] = useState(true);
    const [dynamicGameNotesInitialRows, setDynamicGameNotesInitialRows] = useState(10);
    const [dynamicGameNotesRowStep, setDynamicGameNotesRowStep] = useState(10);
    const [dynamicGameNotesPrefetchDistance, setDynamicGameNotesPrefetchDistance] = useState(12);
    const [dynamicGameNotesSentinelRootMargin, setDynamicGameNotesSentinelRootMargin] = useState(600);
    const [dynamicComments, setDynamicComments] = useState(true);
    const [dynamicCommentsInitialRows, setDynamicCommentsInitialRows] = useState(10);
    const [dynamicCommentsRowStep, setDynamicCommentsRowStep] = useState(10);
    const [dynamicCommentsSentinelRootMargin, setDynamicCommentsSentinelRootMargin] = useState(600);
    const [dynamicFriendLoading, setDynamicFriendLoading] = useState(true);
    const [dynamicLeaderboardLoading, setDynamicLeaderboardLoading] = useState(true);
    const [dynamicLeaderboardResults, setDynamicLeaderboardResults] = useState(true);
    const [dynamicActivityFeed, setDynamicActivityFeed] = useState(true);
    const [dynamicCompare, setDynamicCompare] = useState(true);
    const [dynamicFriendPicker, setDynamicFriendPicker] = useState(true);
    const [dynamicAllGames, setDynamicAllGames] = useState(true);
    const [dynamicTrackedGames, setDynamicTrackedGames] = useState(true);
    const [dynamicBadges, setDynamicBadges] = useState(true);
    const [dynamicFollowedRanking, setDynamicFollowedRanking] = useState(true);
    const [favoriteFriends, setFavoriteFriends] = useState<string[]>([]);
    const [lastSocialView, setLastSocialView] = useState<SocialView>("friends");
    const [badgesSortOrder, setBadgesSortOrder] = useState<BadgesSortOrder>("oldest");
    const [socialEntryDefault, setSocialEntryDefault] = useState<SocialEntryDefault>("friends");
    const [savedCommentsPrefs, setSavedCommentsPrefs] = useState<SavedCommentsPrefs>({
        subTab: "subscribed",
        sort: "recent",
        filter: "all"
    });
    const [activityCardAction, setActivityCardAction] = useState<ActivityCardAction>("achievement");
    const [friendFeedCardAction, setFriendFeedCardAction] = useState<ActivityCardAction>("achievement");
    const [socialHubCardAction, setSocialHubCardAction] = useState<ActivityCardAction>("achievement");
    const [defaultNoteColor, setDefaultNoteColor] = useState<NoteColor>("default");
    const [lastOptionsTab, setLastOptionsTab] = useState<OptionsTab>("system");
    const [lastTrackedTab, setLastTrackedTab] = useState<TrackedTab>("thisGame");
    const [viewedIntro, setViewedIntro] = useState(false);

    const clearErrorBanner = useCallback(() => {
        setError(null);
    }, [setError]);

    const saveSettingWithRollback = useCallback(
        async <T,>(options: {
            nextValue: T;
            previousValue: T;
            applyValue: (value: T) => void;
            saveCall: (value: T) => Promise<any>;
            getSavedValue?: (result: any, nextValue: T) => T;
            onSaved?: (result: any, nextValue: T) => Promise<void> | void;
        }) => {
            const { nextValue, previousValue, applyValue, saveCall, getSavedValue, onSaved } = options;

            applyValue(nextValue);
            clearErrorBanner();

            try {
                const result = await saveCall(nextValue);
                if (!mountedRef.current) {
                    return;
                }

                applyValue(getSavedValue ? getSavedValue(result, nextValue) : nextValue);
                if (onSaved) {
                    await onSaved(result, nextValue);
                }
                return result;
            } catch (e: any) {
                logError("saveSettingWithRollback", e);
                if (!mountedRef.current) {
                    return;
                }
                applyValue(previousValue);
            }
        },
        [clearErrorBanner, mountedRef]
    );

    const applySettings = (source: SettingsResponse, options: { skipButtonToggles?: boolean }) => {
        setUsername(source.username);
        setActiveUlid(source.activeUlid);
        setHasApiKey(Boolean(source.hasApiKey));
        setUsers(source.users);
        setAutoRefresh(source.autoRefresh);
        setShowIcons(source.showIcons);
        setDeferModalCleanup(source.deferModalCleanup);
        setLegacyCommentsLoading(Boolean(source.legacyCommentsLoading));
        setShowAllAchievements(source.showAllAchievements);
        setUnlockLookbackMinutes(source.unlockLookbackMinutes);
        setUnlockHistoryDays(source.unlockHistoryDays);
        setRememberLastPage(source.rememberLastPage);
        setUiSize(source.uiSize);
        setAchievementTextScale(source.achievementTextScale);
        setCurrentAchievementTextScale(source.achievementTextScale);
        setCommentsTextScale(source.commentsTextScale);
        setCurrentCommentsTextScale(source.commentsTextScale);
        setTextScale(source.textScale);
        setTitleScale(source.titleScale);
        setHeaderScale(source.headerScale);
        setBannerScale(source.bannerScale);
        setModalScale(source.modalScale);
        setGuideZoom(clampGuideZoom(source.guideZoom));
        setGuideModalZoom(clampGuideZoom(source.guideModalZoom));
        setPinLatestGuides(source.pinLatestGuides);
        setKeepGuidesOffline(source.keepGuidesOffline);
        setCurrentTextScale(source.textScale);
        setCurrentTitleScale(source.titleScale);
        setCurrentHeaderScale(source.headerScale);
        setCurrentBannerScale(source.bannerScale);
        setCurrentModalScale(source.modalScale);
        setCurrentGuideZoom(source.guideZoom);
        setCurrentGuideModalZoom(source.guideModalZoom);
        setCurrentTextViewerZoom(source.textViewerZoom);
        setTopPadding(source.topPadding);
        setBlockPadding(source.blockPadding);
        setButtonSpacing(source.buttonSpacing);
        setMouseKeyboardMode(source.mouseKeyboardMode);
        setControllerGlyphStyle(source.controllerGlyphStyle);
        setColoredGlyphs(source.coloredGlyphs);
        setCurrentColoredGlyphs(source.coloredGlyphs);
        setShowAButtonMode(source.showAButtonMode);
        setShowAButtonModeTracked(source.showAButtonModeTracked);
        setGameNotesAButtonMode(source.gameNotesAButtonMode);
        if (!options.skipButtonToggles) {
            setShowSocialHubButton(source.showSocialHubButton);
            setShowTrackedSetsButton(source.showTrackedSetsButton);
            setPutUpdaterOnDesktop(source.putUpdaterOnDesktop);
            setShowOptionsButton(source.showOptionsButton);
            setQuickMenuShortcuts(source.quickMenuShortcuts);
            setShortcutBindings(source.shortcutBindings);
            setLastScalePreset(source.lastScalePreset);
            setShowAllToggleMain(source.showAllToggleMain);
            setShowAllToggleFriend(source.showAllToggleFriend);
            setShowTrackedNotesMain(source.showTrackedNotesMain);
        }
        setShowRetroPoints(source.showRetroPoints);
        setAchievementStyle(source.achievementStyle);
        setTrackedColor(source.trackedColor);
        setMainAchievementFilter(source.mainAchievementFilter);
        setMainAchievementSort(source.mainAchievementSort);
        setMainAchievementAction(source.mainAchievementAction);
        setTrackedAchievementAction(source.trackedAchievementAction);
        setDolphinMapperMode(source.dolphinMapperMode);
        setDolphinSystemFilter(source.dolphinSystemFilter);
        setDolphinBluetoothPassthrough(source.dolphinBluetoothPassthrough);
        setDolphinContinuousScanning(source.dolphinContinuousScanning);
        setDolphinBalanceBoard(source.dolphinBalanceBoard);
        setCheevoCheckCacheHashes(source.cheevoCheckCacheHashes);
        setCheevoCheckExtractToRam(source.cheevoCheckExtractToRam);
        setCheevoCheckVerifyHashes(source.cheevoCheckVerifyHashes);
        setCheevoCheckVerifySpeed(source.cheevoCheckVerifySpeed);
        setCheevoCheckScanCollapsed(source.cheevoCheckScanCollapsed);
        setCheevoCheckResultsCollapsed(source.cheevoCheckResultsCollapsed);
        setCheevoCheckVerifyCollapsed(source.cheevoCheckVerifyCollapsed);
        setCheevoCheckOptionsCollapsed(source.cheevoCheckOptionsCollapsed);
        setCheevoCheckSkipDiscVerify(source.cheevoCheckSkipDiscVerify);
        setCheevoCheckSkipCartVerify(source.cheevoCheckSkipCartVerify);
        setLibraryBadge(source.libraryBadge);
        setFileWatcherSpeed(source.fileWatcherSpeed);
        setFileWatcherRunDuringGames(source.fileWatcherRunDuringGames);
        setTrackedSetAButtonMode(source.trackedSetAButtonMode);
        setTrackedAchievementSort(source.trackedAchievementSort);
        setFriendAchievementFilter(source.friendAchievementFilter);
        setFriendAchievementSort(source.friendAchievementSort);
        setFriendShowAllAchievements(source.friendShowAllAchievements);
        setTrackedSetsAutoCheck(source.trackedSetsAutoCheck);
        setTrackedSetsServiceEnabled(source.trackedSetsServiceEnabled);
        setTrackedSetsRefreshMinutes(source.trackedSetsRefreshMinutes);
        setTrackedSetsSelectorSort(source.trackedSetsSelectorSort);
        setTrackedSetsSelectorFilter(source.trackedSetsSelectorFilter);
        const loadedLanguage = source.language;
        setLanguage(loadedLanguage);
        setCurrentLanguage(loadedLanguage);
        void ensureLanguageLoaded(loadedLanguage).then(() => {
            if (mountedRef.current) {
                markLocaleTableLoaded((revision) => revision + 1);
            }
        });
        setFriendRefreshDelayMs(source.friendRefreshDelayMs);
        setActivityCacheMinutes(source.activityCacheMinutes);
        setTrickleLookbackHours(source.trickleLookbackHours);
        setActivityFriendsPerTick(source.activityFriendsPerTick);
        setSocialGameTicker(source.socialGameTicker);
        setSocialHubTicker(source.socialHubTicker);
        setSocialActivityTrickleService(source.socialActivityTrickleService);
        setTrickleFavoritesOnly(source.trickleFavoritesOnly);
        setFriendAutoRefresh(source.friendAutoRefresh);
        setShowReminderTicker(source.showReminderTicker);
        setShowNotesDot(source.showNotesDot);
        setShowBellDot(source.showBellDot);
        setDoNotDisturb(source.doNotDisturb);
        setDoNotDisturbDisablesDot(source.doNotDisturbDisablesDot);
        setDoNotDisturbDisablesToast(source.doNotDisturbDisablesToast);
        setNightMode(source.nightMode);
        setNightModeBrightness(source.nightModeBrightness);
        setBatterySaver(source.batterySaver);
        setBatterySaverDisablesSocialActivity(source.batterySaverDisablesSocialActivity);
        setBatterySaverDisablesComments(source.batterySaverDisablesComments);
        setBatterySaverDisablesFriendAvatars(source.batterySaverDisablesFriendAvatars);
        setBatterySaverDisablesPlayersNearYou(source.batterySaverDisablesPlayersNearYou);
        setBatterySaverDisablesTrackedSets(source.batterySaverDisablesTrackedSets);
        setBatterySaverDisablesFileWatcher(source.batterySaverDisablesFileWatcher);
        setNotifyNoteReminderEnabled(source.notifyNoteReminderEnabled);
        setNotifyNoteReminderToast(source.notifyNoteReminderToast);
        setNotifyTrackedSetEnabled(source.notifyTrackedSetEnabled);
        setNotifyTrackedSetToast(source.notifyTrackedSetToast);
        setNotifyCommentTrackerEnabled(source.notifyCommentTrackerEnabled);
        setNotifyCommentTrackerToast(source.notifyCommentTrackerToast);
        setNotifyWallEnabled(source.notifyWallEnabled);
        setNotifyWallToast(source.notifyWallToast);
        setNotifySystemEnabled(source.notifySystemEnabled);
        setNotifySystemToast(source.notifySystemToast);
        setNotifyTrackedEnabled(source.notifyTrackedEnabled);
        setNotifyTrackedToast(source.notifyTrackedToast);
        setNotifySocialUnlockEnabled(source.notifySocialUnlockEnabled);
        setNotifySocialUnlockToast(source.notifySocialUnlockToast);
        setNotifyNearYouEnabled(source.notifyNearYouEnabled);
        setNotifyNearYouToast(source.notifyNearYouToast);
        setLegacyAchievementLinks(source.legacyAchievementLinks);
        setLegacyGameLinks(source.legacyGameLinks);
        setShowDeveloperOptions(source.showDeveloperOptions);
        setAutoPurgeService(source.autoPurgeService);
        setDebugLogging(source.debugLogging);
        setInjectEmulatorLogin(source.injectEmulatorLogin);
        setNotifyDebugEnabled(source.notifyDebugEnabled);
        setNotifyDebugToast(source.notifyDebugToast);
        setIpcSlowThresholdMs(source.ipcSlowThresholdMs);
        {
            const bonusEnabled = source.largeViewportBonusEnabled;
            const bonusLines = source.largeViewportBonus;
            setLargeViewportBonusEnabled(bonusEnabled);
            setLargeViewportBonus(bonusLines);
            setCurrentLargeViewportBonusEnabled(bonusEnabled);
            setCurrentLargeViewportBonus(bonusLines);
        }
        setParallelRaCalls(source.parallelRaCalls);
        setParallelCdnFetches(source.parallelCdnFetches);
        setMaxIconWorkers(source.maxIconWorkers);
        setAvatarWorkers(source.avatarWorkers);
        setGameIconWorkers(source.gameIconWorkers);
        const nextGameArtCacheCap = source.gameArtCacheCap;
        setGameArtCacheCap(nextGameArtCacheCap);
        applyGameArtCacheCap(nextGameArtCacheCap);
        const nextAvatarCacheCap = source.avatarCacheCap;
        setAvatarCacheCap(nextAvatarCacheCap);
        applyAvatarCacheCap(nextAvatarCacheCap);
        const nextAchievementIconCacheGames = source.achievementIconCacheGames;
        setAchievementIconCacheGames(nextAchievementIconCacheGames);
        applyAchievementIconCacheGames(nextAchievementIconCacheGames);
        setFriendImageService(source.friendImageService);
        setValidateFriendsRoster(source.validateFriendsRoster);
        setFisTickFrequencyMinutes(source.fisTickFrequencyMinutes);
        setCommentsServiceTickMinutes(source.commentsServiceTickMinutes);
        setCommentsServiceFetchAmount(source.commentsServiceFetchAmount);
        setCommentsServiceWallCheck(source.commentsServiceWallCheck);
        setFisRosterRefreshIntervalHours(source.fisRosterRefreshIntervalHours);
        setFisVerifyFavoriteAvatars(source.fisVerifyFavoriteAvatars);
        setFisVerifyAllAvatars(source.fisVerifyAllAvatars);
        setPlayersNearYouEnabled(source.playersNearYouEnabled);
        setPlayersNearYouLookbehind(source.playersNearYouLookbehind);
        setPlayersNearYouLookahead(source.playersNearYouLookahead);
        setPlayersNearYouMinTickMinutes(source.playersNearYouMinTickMinutes);
        setPlayersNearYouMaxTickMinutes(source.playersNearYouMaxTickMinutes);
        setGamesListCacheMinutes(source.gamesListCacheMinutes);
        setAwardsListCacheMinutes(source.awardsListCacheMinutes);
        setWantToPlayCacheMinutes(source.wantToPlayCacheMinutes);
        setPlayersNearYouTapMode(source.playersNearYouTapMode);
        setPlayersNearYouCollapsed(source.playersNearYouCollapsed);
        setDolphinAdvancedCollapsed(source.dolphinAdvancedCollapsed);
        setBigListThreshold(source.bigListThreshold);
        setAlwaysStaggerMounting(source.alwaysStaggerMounting);
        setReturnStaggerFrames(source.returnStaggerFrames);
        setDynamicLoading(source.dynamicLoading);
        setDynamicInitialRows(source.dynamicInitialRows);
        setDynamicRowStep(source.dynamicRowStep);
        setDynamicPrefetchDistance(source.dynamicPrefetchDistance);
        setDynamicSentinelRootMargin(source.dynamicSentinelRootMargin);
        setDynamicTrackedListLoading(source.dynamicTrackedListLoading);
        setDynamicTrackedListInitialRows(source.dynamicTrackedListInitialRows);
        setDynamicTrackedListRowStep(source.dynamicTrackedListRowStep);
        setDynamicTrackedListPrefetchDistance(source.dynamicTrackedListPrefetchDistance);
        setDynamicTrackedListSentinelRootMargin(source.dynamicTrackedListSentinelRootMargin);
        setDynamicTrackedSetsListLoading(source.dynamicTrackedSetsListLoading);
        setDynamicTrackedSetsListInitialRows(source.dynamicTrackedSetsListInitialRows);
        setDynamicTrackedSetsListRowStep(source.dynamicTrackedSetsListRowStep);
        setDynamicTrackedSetsListPrefetchDistance(source.dynamicTrackedSetsListPrefetchDistance);
        setDynamicTrackedSetsListSentinelRootMargin(source.dynamicTrackedSetsListSentinelRootMargin);
        setDynamicGameNotesLoading(source.dynamicGameNotesLoading);
        setDynamicGameNotesInitialRows(source.dynamicGameNotesInitialRows);
        setDynamicGameNotesRowStep(source.dynamicGameNotesRowStep);
        setDynamicGameNotesPrefetchDistance(source.dynamicGameNotesPrefetchDistance);
        setDynamicGameNotesSentinelRootMargin(source.dynamicGameNotesSentinelRootMargin);
        setDynamicComments(source.dynamicComments);
        setDynamicCommentsInitialRows(source.dynamicCommentsInitialRows);
        setDynamicCommentsRowStep(source.dynamicCommentsRowStep);
        setDynamicCommentsSentinelRootMargin(source.dynamicCommentsSentinelRootMargin);
        setDynamicFriendLoading(source.dynamicFriendLoading);
        setDynamicLeaderboardLoading(source.dynamicLeaderboardLoading);
        setDynamicLeaderboardResults(source.dynamicLeaderboardResults);
        setDynamicActivityFeed(source.dynamicActivityFeed);
        setDynamicCompare(source.dynamicCompare);
        setDynamicFriendPicker(source.dynamicFriendPicker);
        setDynamicAllGames(source.dynamicAllGames);
        setDynamicTrackedGames(source.dynamicTrackedGames);
        setDynamicBadges(source.dynamicBadges);
        setDynamicFollowedRanking(source.dynamicFollowedRanking);
        setFavoriteFriends(source.favoriteFriends);
        setLastSocialView(source.lastSocialView);
        setBadgesSortOrder(source.badgesSortOrder);
        setSocialEntryDefault(source.socialEntryDefault);
        setSavedCommentsPrefs(source.savedCommentsPrefs);
        setActivityCardAction(source.activityCardAction);
        setFriendFeedCardAction(source.friendFeedCardAction);
        setSocialHubCardAction(source.socialHubCardAction);
        setDefaultNoteColor(source.defaultNoteColor);
        setLastOptionsTab(source.lastOptionsTab);
        setLastTrackedTab(source.lastTrackedTab);
        setViewedIntro(Boolean(source.viewedIntro));
    };

    const toggleDoNotDisturb = (next: boolean) => {
        setDoNotDisturb(next);
        void saveDoNotDisturb(next).catch((e) => logError("save do not disturb", e));
    };

    const toggleBatterySaver = (next: boolean) => {
        setBatterySaver(next);
        void saveBatterySaver(next).catch((e) => logError("save battery saver", e));
    };

    const toggleMouseKeyboardMode = (next: boolean) => {
        setMouseKeyboardMode(next);
        void saveMouseKeyboardMode(next).catch((e) => logError("save mouse keyboard mode", e));
    };

    const nightModeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const toggleNightMode = useCallback((next: boolean) => {
        setNightMode(next);
        if (nightModeSaveTimer.current !== null) {
            clearTimeout(nightModeSaveTimer.current);
        }
        nightModeSaveTimer.current = setTimeout(() => {
            nightModeSaveTimer.current = null;
            void saveNightMode(next).catch((e) => logError("save night mode", e));
        }, 300);
    }, []);

    const controllerState = {
        username,
        activeUlid,
        hasApiKey,
        autoRefresh,
        showIcons,
        deferModalCleanup,
        legacyCommentsLoading,
        showAllAchievements,
        unlockLookbackMinutes,
        unlockHistoryDays,
        rememberLastPage,
        uiSize,
        achievementTextScale,
        commentsTextScale,
        textScale,
        titleScale,
        headerScale,
        bannerScale,
        modalScale,
        guideZoom,
        guideModalZoom,
        pinLatestGuides,
        keepGuidesOffline,
        topPadding,
        blockPadding,
        buttonSpacing,
        mouseKeyboardMode,
        controllerGlyphStyle,
        coloredGlyphs,
        showAButtonMode,
        showAButtonModeTracked,
        gameNotesAButtonMode,
        showSocialHubButton,
        showTrackedSetsButton,
        putUpdaterOnDesktop,
        showOptionsButton,
        quickMenuShortcuts,
        shortcutBindings,
        lastScalePreset,
        showAllToggleMain,
        showAllToggleFriend,
        showTrackedNotesMain,
        showRetroPoints,
        achievementStyle,
        trackedColor,
        mainAchievementFilter,
        mainAchievementSort,
        mainAchievementAction,
        trackedAchievementAction,
        dolphinMapperMode,
        dolphinSystemFilter,
        dolphinBluetoothPassthrough,
        dolphinContinuousScanning,
        dolphinBalanceBoard,
        cheevoCheckCacheHashes,
        cheevoCheckExtractToRam,
        cheevoCheckVerifyHashes,
        cheevoCheckVerifySpeed,
        cheevoCheckScanCollapsed,
        setCheevoCheckScanCollapsed,
        cheevoCheckResultsCollapsed,
        setCheevoCheckResultsCollapsed,
        cheevoCheckVerifyCollapsed,
        setCheevoCheckVerifyCollapsed,
        cheevoCheckOptionsCollapsed,
        setCheevoCheckOptionsCollapsed,
        cheevoCheckSkipDiscVerify,
        cheevoCheckSkipCartVerify,
        libraryBadge,
        fileWatcherSpeed,
        fileWatcherRunDuringGames,
        trackedSetAButtonMode,
        trackedAchievementSort,
        friendAchievementFilter,
        friendAchievementSort,
        friendShowAllAchievements,
        trackedSetsAutoCheck,
        trackedSetsServiceEnabled,
        trackedSetsRefreshMinutes,
        trackedSetsSelectorSort,
        trackedSetsSelectorFilter,
        language,
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
        doNotDisturb,
        doNotDisturbDisablesDot,
        doNotDisturbDisablesToast,
        nightMode,
        nightModeBrightness,
        batterySaver,
        batterySaverDisablesSocialActivity,
        batterySaverDisablesComments,
        batterySaverDisablesFriendAvatars,
        batterySaverDisablesPlayersNearYou,
        batterySaverDisablesTrackedSets,
        batterySaverDisablesFileWatcher,
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
        debugLogging,
        injectEmulatorLogin,
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
        playersNearYouTapMode,
        playersNearYouCollapsed,
        dolphinAdvancedCollapsed,
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
        favoriteFriends,
        users,
        lastSocialView,
        badgesSortOrder,
        socialEntryDefault,
        savedCommentsPrefs,
        activityCardAction,
        friendFeedCardAction,
        socialHubCardAction,
        defaultNoteColor,
        lastOptionsTab,
        lastTrackedTab,
        viewedIntro
    };

    const controllerActions = {
        setUsername,
        setHasApiKey,
        setUsers,
        setAutoRefresh,
        setShowIcons,
        setDeferModalCleanup,
        setLegacyCommentsLoading,
        setBatterySaverDisablesSocialActivity,
        setBatterySaverDisablesComments,
        setBatterySaverDisablesFriendAvatars,
        setBatterySaverDisablesPlayersNearYou,
        setBatterySaverDisablesTrackedSets,
        setBatterySaverDisablesFileWatcher,
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
        setGuideZoom,
        setGuideModalZoom,
        setPinLatestGuides,
        setKeepGuidesOffline,
        setTopPadding,
        setBlockPadding,
        setButtonSpacing,
        setMouseKeyboardMode,
        setControllerGlyphStyle,
        setColoredGlyphs,
        setShowAButtonMode,
        setShowAButtonModeTracked,
        setGameNotesAButtonMode,
        setShowSocialHubButton,
        setShowTrackedSetsButton,
        setPutUpdaterOnDesktop,
        setShowOptionsButton,
        setQuickMenuShortcuts,
        setShortcutBindings,
        setLastScalePreset,
        setShowAllToggleMain,
        setShowAllToggleFriend,
        setShowTrackedNotesMain,
        setShowRetroPoints,
        setAchievementStyle,
        setTrackedColor,
        setMainAchievementFilter,
        setMainAchievementSort,
        setMainAchievementAction,
        setTrackedAchievementAction,
        setDolphinMapperMode,
        setDolphinSystemFilter,
        setDolphinBluetoothPassthrough,
        setDolphinContinuousScanning,
        setDolphinBalanceBoard,
        setCheevoCheckCacheHashes,
        setCheevoCheckExtractToRam,
        setCheevoCheckVerifyHashes,
        setCheevoCheckVerifySpeed,
        setCheevoCheckSkipDiscVerify,
        setCheevoCheckSkipCartVerify,
        setLibraryBadge,
        setFileWatcherSpeed,
        setFileWatcherRunDuringGames,
        setTrackedSetAButtonMode,
        setTrackedAchievementSort,
        setFriendAchievementFilter,
        setFriendAchievementSort,
        setFriendShowAllAchievements,
        setTrackedSetsAutoCheck,
        setTrackedSetsServiceEnabled,
        setTrackedSetsRefreshMinutes,
        setTrackedSetsSelectorSort,
        setTrackedSetsSelectorFilter,
        setLanguage,
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
        toggleDoNotDisturb,
        toggleBatterySaver,
        toggleMouseKeyboardMode,
        toggleNightMode,
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
        setShowDeveloperOptions,
        setAutoPurgeService,
        setDebugLogging,
        setInjectEmulatorLogin,
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
        setPlayersNearYouCollapsed,
        setDolphinAdvancedCollapsed,
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
        setFavoriteFriends,
        setLastSocialView,
        setBadgesSortOrder,
        setSocialEntryDefault,
        setSavedCommentsPrefs,
        setActivityCardAction,
        setFriendFeedCardAction,
        setSocialHubCardAction,
        setDefaultNoteColor,
        setLastOptionsTab,
        setLastTrackedTab,
        setViewedIntro,
        applySettings,
        saveSettingWithRollback
    };

    return {
        state: controllerState,
        actions: controllerActions
    };
}

export type SettingsController = ReturnType<typeof useSettingsController>;
