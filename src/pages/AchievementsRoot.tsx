import { Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { addEventListener, removeEventListener } from "@decky/api";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    cleanupUserDirectories,
    clearResumeState,
    clearCurrentGame,
    clearAllNotifications,
    clearArchivedNotifications,
    clearSavedComments,
    deleteAllNotes,
    clearGuideCache,
    clearAllGuideData,
    getAchievementComments,
    getCachedFriendGame,
    getCachedFriends,
    getCachedPayload,
    getCachedGameIconDataUri,
    getCachedGameImageDataUri,
    getGameIconCached,
    getGameImageCached,
    getPlayersNearYou,
    getResumeState,
    getSettings,
    getSocialActivity,
    getUserComments,
    loadGameGuides,
    markNextValidationSkipped,
    manualRefreshFriends,
    deepRefreshFriends,
    NOTIFICATION_EVENT,
    clearDolphinMappings,
    resetDolphinMappings,
    saveLastOptionsTab,
    saveLastSocialView,
    saveBadgesSortOrder,
    saveSavedCommentsPrefs,
    saveLastTrackedTab,
    saveTrackedAchievementAction,
    saveTrackedSetAButtonMode,
    saveDolphinMapperMode,
    saveDolphinBluetoothPassthrough,
    saveDolphinContinuousScanning,
    saveDolphinBalanceBoard,
    updateCheevoCheckReferenceData,
    saveFriendAchievementFilter,
    saveFriendAchievementSort,
    saveFriendShowAllAchievements,
    savePlayersNearYouTapMode,
    savePlayersNearYouCollapsed,
    savePlayersNearYouMode,
    saveDolphinAdvancedCollapsed,
    saveDolphinSystemFilter,
    saveKeepGuidesOffline,
    savePinLatestGuides,
    setAccurateAvatarDebug,
    logCommentsDebug,
    logFocusDebug,
    logNavDebug,
    setFriendFavorite
} from "../api";
import MainAchievementsPage from "./MainAchievementsPage";
import TrackedPage from "./TrackedPage";
import OptionsPage from "./OptionsPage";
import AboutPage from "./AboutPage";
import UnlockHistoryPage, { type UnlockHistorySource } from "./UnlockHistoryPage";
import SocialHubPage from "./SocialHubPage";
import AllGamesPage from "./AllGamesPage";
import BadgesPage from "./BadgesPage";
import WantToPlayPage from "./WantToPlayPage";
import FollowedRankingPage from "./FollowedRankingPage";
import TrackedSetsPage from "./TrackedSetsPage";
import ComparePickerPage from "./ComparePickerPage";
import FriendProfilePage from "./FriendProfilePage";
import FriendCompareGamePage from "./FriendCompareGamePage";
import LeaderboardDetailPage from "./LeaderboardDetailPage";
import LeaderboardsPage from "./LeaderboardsPage";
import { GameNotesPage } from "./GameNotesPage";
import { GuidesPage } from "./GuidesPage";
import { GuidesReaderModal } from "../components/guides/GuidesReaderModal";
import GameOverviewPage from "./GameOverviewPage";
import AchievementOverviewPage from "./AchievementOverviewPage";
import SetupPage from "./SetupPage";
import UtilsPage from "./UtilsPage";
import DolphinMapperPage from "./DolphinMapperPage";
import SmbSharesPage from "./SmbSharesPage";
import CheevoCheckPage from "./CheevoCheckPage";
import FileWatcherPage from "./FileWatcherPage";
import { CheevoCheckGamesModal } from "../components/pickers/CheevoCheckGamesModal";
import { CommentViewModal, type CommentSaveControl } from "../components/comments/CommentViewModal";
import { GameNoteEditModal } from "../components/notes/GameNoteEditModal";
import { GameSearchModal } from "../components/pickers/GameSearchModal";
import { FriendGamesSearchModal } from "../components/pickers/FriendGamesSearchModal";
import { BootFocusAnchor } from "../components/ui/BootFocusAnchor";
import { TextViewerModal } from "../components/ui/TextViewerModal";
import { CornerProbe } from "../components/ui/CornerProbe";
import { LoadingOverlay } from "../components/ui/LoadingOverlay";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { BOOT_CAT_IMAGE, BOOT_CAT_LINES } from "../components/ui/bootCat";
import { NoteEditModal, type SaveTrackedNoteFn } from "../components/notes/NoteEditModal";
import { NotificationsModal } from "../components/notifications/NotificationsModal";
import { NotificationsProvider } from "../components/notifications/NotificationsContext";
import { NotificationsMultipathModal, type MultipathOption } from "../components/notifications/NotificationsMultipathModal";
import { useAboutController } from "../hooks/useAboutController";
import { useAccountActions } from "../hooks/useAccountActions";
import { useAchievementsController } from "../hooks/useAchievementsController";
import { useFocusController } from "../hooks/useFocusController";
import { useFriendsController } from "../hooks/useFriendsController";
import { useFrontendMirrorWipe } from "../hooks/useFrontendMirrorWipe";
import { useCacheClearing } from "../hooks/useCacheClearing";
import { useGameDataController } from "../hooks/useGameDataController";
import { useGuidesController, type GuidesResumeTarget } from "../hooks/useGuidesController";
import { useGameNotesController } from "../hooks/useGameNotesController";
import { useGameOverviewController } from "../hooks/useGameOverviewController";
import { useGameCommentsController } from "../hooks/useGameCommentsController";
import { useAchievementOverviewController } from "../hooks/useAchievementOverviewController";
import { useLeaderboardsController } from "../hooks/useLeaderboardsController";
import { useNowPlayingController } from "../hooks/useNowPlayingController";
import type { NowPlayingTabBodyProps } from "../components/social/NowPlayingTabBody";
import { useNewsEventsController } from "../hooks/useNewsEventsController";
import { useNotificationsController } from "../hooks/useNotificationsController";
import { useSavedCommentsController } from "../hooks/useSavedCommentsController";
import {
    achievementCommentSource,
    buildSaveCommentPayload,
    gameCommentSource,
    matchKeyForComment,
    nextSavedSort,
    wallCommentSource,
    type SavedCommentSourceInput
} from "../utils/savedComments";
import { SavedCommentsFilterModal } from "../components/comments/SavedCommentsFilterModal";
import { useTrackedSetsController } from "../hooks/useTrackedSetsController";
import { useOptionsController } from "../hooks/useOptionsController";
import { useResumeController } from "../hooks/useResumeController";
import { useResumeSnapshot } from "../hooks/useResumeSnapshot";
import { useSettingsController } from "../hooks/useSettingsController";
import { useSocialIntents } from "../hooks/useSocialIntents";
import { useUnlockHistoryController } from "../hooks/useUnlockHistoryController";
import { useTrackedController } from "../hooks/useTrackedController";
import { useTrackedForGameController } from "../hooks/useTrackedForGameController";
import { useLatestRef } from "../hooks/useLatestRef";
import { getSavedMainAchievementsTab } from "../resume/achievementsResume";
import { getSavedGuidesSubView } from "../resume/guidesResume";
import { computeBootView, getSavedNavStack } from "../resume/bootView";
import { PanelProviders } from "../components/panel/PanelProviders";
import { describeStack, initialNav, previousView, rehydrateNav, settleNav, type NavIntent } from "../nav";
import { ROUTES, type RouteBackActions } from "../routes";
import type {
    AchievementRow,
    AchievementSort,
    AchievementOverviewSnapshot,
    ActivityCardAction,
    AllGamesLetterRangeKey,
    AllGamesStatusFilter,
    AOSource,
    AotwComment,
    BadgeFilter,
    CheevoCheckBrowseRow,
    CheevoCheckListKind,
    FollowedRankingMetric,
    FriendAchievementFilter,
    FriendGameSource,
    FriendProfileSubView,
    GuidesSubView,
    GameGuidesRecord,
    FriendRow,
    GameComment,
    GameNote,
    SavedComment,
    SavedCommentsFilter,
    SavedCommentsPrefs,
    GameOverviewSource,
    GameOverviewSubView,
    FriendGamePayload,
    MainAchievementsTab,
    NoteColor,
    NowPlayingProps,
    OptionsTab,
    Payload,
    PlayersNearYouItem,
    PlayersNearYouMode,
    PlayersNearYouTapMode,
    QuickMenuShortcut,
    ResumeState,
    SocialActivityEvent,
    TrackedAchievementAction,
    DolphinMapperMode,
    DolphinSystemFilter,
    TrackedSetAButtonMode,
    TrackedTab,
    ViewKey,
    ShortcutAction,
    SocialView
} from "../types";

import { achievementUiMetrics, FADE_IN_KEYFRAMES } from "../utils/style";
import { logError } from "../utils/errors";
import { SHORTCUT_BUTTON_BY_CODE } from "../utils/gamepadButtons";
import { requestJumpToTop } from "../utils/jumpToTop";
import { captureSnapshot } from "../utils/snapshot";
import { playOkSound } from "../utils/navSound";
import { guardFooterPrompts } from "../utils/footerPrompts";
import {
    consumeModalCloseArm,
    drainOpenModals,
    modalEchoPending,
    setModalAutoCleanup,
    showManagedModal,
    MODAL_ECHO_WINDOW_MS,
    MODAL_REAP_DELAY_MS
} from "../utils/modalRegistry";
import {
    clearAotwCarry,
    clearCommentsSnapshot,
    hasCommentsPostReturnFor,
    hasCommentsRestoreForSurface,
    hasCommentsSnapshotFor,
    putAotwCarry,
    putCommentsPostReturn,
    putCommentsSnapshot,
    setCommentsSnapshotUser
} from "../utils/commentsSnapshot";
import { measureCommentWindow } from "../utils/commentGeometry";
import { currentQuickGuideVisible, setQuickGuide } from "../utils/quickGuide";
import { guideBelongsToMapping } from "../utils/guidesResolve";
import { openExternalUrl, raAchievementUrl, raAchievementCommentsUrl, raGameUrl, raGameCommentsUrl, raHomeUrl, raLookupSearchUrl, raUserUrl, raUserCommentsUrl } from "../utils/navigation";
import { userRefFor } from "../utils/friends";
import { loadCachedImage } from "../utils/loadCachedImage";
import { beginGuardedRun } from "../utils/runGuard";
import type { NotificationNav } from "../notifications/registry";
import { t } from "../locales";



let pendingNoteReminderGameId: number | null = null;

let pendingNotificationAchievement: { gameId: number; achievementId: number; viewedUsername: string | null; viewedUserRef: string | null } | null = null;

// Module helpers
function notificationAoSnapshot(achievementId: number): AchievementOverviewSnapshot {
    return {
        id: achievementId,
        title: "",
        description: "",
        points: 0,
        badgeName: "",
        imageIcon: null,
        isLocked: true,
        dateEarned: null,
        dateEarnedHardcore: null
    };
}

let pendingTrackedSetOpenId: string | null = null;

let pendingNotificationGame: { gameId: number; viewedUsername: string | null; viewedUserRef: string | null } | null = null;

let pendingNotificationProfile: { username: string; ulid: string | null } | null = null;

let pendingNotificationAbout = false;

let pendingNotificationCheevoCheck = false;
let pendingNotificationFileWatcher = false;

let pendingSearchGameId: number | null = null;

let pendingSearchBackSource: GameOverviewSource = "search";

let pendingFriendGameSearch: { username: string; ulid: string | null; gameId: number } | null = null;

let pendingCheevoCheckGameId: number | null = null;

function consumePendingRouteOverrides(resumeState: ResumeState | null): ResumeState | null {
    let nextResumeState = resumeState;
    const tappedNotesGameId = pendingNoteReminderGameId;
    pendingNoteReminderGameId = null;
    if (tappedNotesGameId != null) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "gameNotes",
            gameNotesGameId: tappedNotesGameId,
            focusKey: "gn:back"
        };
    }
    const tappedNotification = pendingNotificationAchievement;
    pendingNotificationAchievement = null;
    if (tappedNotification != null) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "achievementOverview",
            aoSource: "notification",
            gameOverviewSource: "main",
            aoGameId: tappedNotification.gameId,
            aoAchievementId: tappedNotification.achievementId,
            aoAchievementSnapshot: notificationAoSnapshot(tappedNotification.achievementId),
            aoViewedUsername: tappedNotification.viewedUsername ?? null,
            aoViewedUserRef: tappedNotification.viewedUserRef ?? null,
            focusKey: "ao:back"
        };
    }
    const tappedTrackedSetId = pendingTrackedSetOpenId;
    pendingTrackedSetOpenId = null;
    if (tappedTrackedSetId != null) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "trackedSetOpen",
            trackedSetOpenId: tappedTrackedSetId,
            trackedSetsBackSource: "main",
            focusKey: "trackedsetopen:back"
        };
    }
    const tappedNotificationGame = pendingNotificationGame;
    pendingNotificationGame = null;
    if (tappedNotificationGame != null) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "gameOverview",
            gameOverviewSource: "main",
            gameOverviewGameId: tappedNotificationGame.gameId,
            gameOverviewViewedUsername: tappedNotificationGame.viewedUsername ?? null,
            gameOverviewViewedUserRef: tappedNotificationGame.viewedUserRef ?? null,
            gameOverviewSubView: "achievements",
            focusKey: "gameoverview:back"
        };
    }
    const tappedNotificationAbout = pendingNotificationAbout;
    pendingNotificationAbout = false;
    if (tappedNotificationAbout) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "about",
            focusKey: "about:back"
        };
    }
    const tappedNotificationCheevoCheck = pendingNotificationCheevoCheck;
    pendingNotificationCheevoCheck = false;
    if (tappedNotificationCheevoCheck) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "cheevoCheck",
            focusKey: "cheevocheck:back"
        };
    }
    const tappedNotificationFileWatcher = pendingNotificationFileWatcher;
    pendingNotificationFileWatcher = false;
    if (tappedNotificationFileWatcher) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "fileWatcher",
            focusKey: "fileWatcher:back"
        };
    }
    const tappedSearchGameId = pendingSearchGameId;
    pendingSearchGameId = null;
    if (tappedSearchGameId != null) {
        const searchBackSource = pendingSearchBackSource;
        pendingSearchBackSource = "search";
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "gameOverview",
            gameOverviewSource: searchBackSource,
            gameOverviewGameId: tappedSearchGameId,
            gameOverviewViewedUsername: null,
            gameOverviewViewedUserRef: null,
            gameOverviewSubView: "achievements",
            focusKey: "gameoverview:back"
        };
    }
    const tappedFriendGameSearch = pendingFriendGameSearch;
    pendingFriendGameSearch = null;
    if (tappedFriendGameSearch != null) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "friendGame",
            selectedFriendUsername: tappedFriendGameSearch.username,
            selectedFriendUlid: tappedFriendGameSearch.ulid,
            friendGameSelectionMode: "explicit",
            friendGameId: tappedFriendGameSearch.gameId,
            friendGameSource: "allGames",
            friendProfileSubView: "game",
            focusKey: "friendgame:back"
        };
    }
    const tappedCheevoCheckGameId = pendingCheevoCheckGameId;
    pendingCheevoCheckGameId = null;
    if (tappedCheevoCheckGameId != null) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "gameOverview",
            gameOverviewSource: "cheevoCheck",
            gameOverviewGameId: tappedCheevoCheckGameId,
            gameOverviewViewedUsername: null,
            gameOverviewViewedUserRef: null,
            gameOverviewSubView: "achievements",
            focusKey: "gameoverview:back"
        };
    }
    const tappedNotificationProfile = pendingNotificationProfile;
    pendingNotificationProfile = null;
    if (tappedNotificationProfile != null) {
        nextResumeState = {
            ...(nextResumeState ?? ({} as ResumeState)),
            view: "friendGame",
            selectedFriendUsername: tappedNotificationProfile.username,
            selectedFriendUlid: tappedNotificationProfile.ulid ?? null,
            friendProfileBackSource: "main",
            friendGameSelectionMode: "auto",
            friendGameId: null,
            friendGameSource: "recentGames",
            friendProfileSubView: "game",
            focusKey: "friendgame:back"
        };
    }

    return nextResumeState;
}

function AchievementsRoot() {
    // Routing state
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [showBootSpinner, setShowBootSpinner] = useState(false);
    const [bootCatLine, setBootCatLine] = useState(BOOT_CAT_LINES[0]);
    const [bootCatPreview, setBootCatPreview] = useState(false);
    const [settingsMode, setSettingsMode] = useState(false);
    const [view, setViewState] = useState<ViewKey>("achievements");
    const [nav, setNav] = useState(() => initialNav("achievements"));
    const navIntentRef = useRef<NavIntent | null>(null);
    const setView = useCallback((next: ViewKey) => {
        const intent = navIntentRef.current ?? "push";
        navIntentRef.current = null;
        setNav((state) => settleNav(state, { view: next }, intent));
        setViewState(next);
    }, []);
    const restoreNav = useCallback((saved: ViewKey[] | null, landed: ViewKey) => {
        const verdict = saved && saved.length > 0
            ? (saved[saved.length - 1] === landed ? "hit" : "miss")
            : "none";
        logNavDebug(`restore-${verdict}`, landed, `saved=${saved ? saved.join(" > ") : "(null)"}`);
        setNav(rehydrateNav(saved, landed));
        setViewState(landed);
    }, []);
    useEffect(() => {
        const { stack, step } = nav;
        const revisit = step.intent === "push"
            && stack.slice(0, -1).some((route) => route.view === step.view);
        const stage = step.agreed
            ? (revisit ? "push-REVISIT" : step.intent)
            : `${step.intent}-DISAGREED`;
        logNavDebug(stage, step.view, `depth=${stack.length} ${describeStack(stack)}`);
    }, [nav]);
    const [socialView, setSocialView] = useState<SocialView>("friends");
    const [achievementsResumeToken, setAchievementsResumeToken] = useState(0);
    const [notesRefreshToken, setNotesRefreshToken] = useState(0);
    const [socialEntryToken, setSocialEntryToken] = useState(0);
    const [socialEntryViewOverride, setSocialEntryViewOverride] = useState<SocialView | null>(null);
    const [unlockHistorySource, setUnlockHistorySource] = useState<UnlockHistorySource>("main");
    const [quickMenuShortcutRefused, setQuickMenuShortcutRefused] = useState<QuickMenuShortcut | null>(null);
    const [badgeFilter, setBadgeFilter] = useState<BadgeFilter>("all");
    const [allGamesLetterRange, setAllGamesLetterRange] = useState<AllGamesLetterRangeKey>("a-f");
    const [allGamesStatusFilter, setAllGamesStatusFilter] = useState<AllGamesStatusFilter>("all");
    const [followedRankingMetric, setFollowedRankingMetric] = useState<FollowedRankingMetric>("hardcorePoints");
    const [gameOverviewSubView, setGameOverviewSubView] = useState<GameOverviewSubView>("achievements");
    const [friendProfileSubView, setFriendProfileSubView] = useState<FriendProfileSubView>("game");
    const [guidesResumeTarget, setGuidesResumeTarget] = useState<GuidesResumeTarget | null>(null);
    const guidesSubViewRef = useRef<GuidesSubView>("list");
    const guidesOpenFaqIdRef = useRef<string | null>(null);
    const [mainTab, setMainTab] = useState<MainAchievementsTab>("achievements");
    const [gameOverviewSource, setGameOverviewSource] = useState<GameOverviewSource>("main");
    const [gameOverviewGameId, setGameOverviewGameId] = useState<number | null>(null);
    const [gameNotesGameId, setGameNotesGameId] = useState<number | null>(null);
    const [gameOverviewViewedUsername, setGameOverviewViewedUsername] = useState<string | null>(null);
    const [gameOverviewViewedUserRef, setGameOverviewViewedUserRef] = useState<string | null>(null);
    const [aoSource, setAoSource] = useState<AOSource>("main");
    const [aoAchievementId, setAoAchievementId] = useState<number | null>(null);
    const [aoGameId, setAoGameId] = useState<number | null>(null);
    const [aoViewedUsername, setAoViewedUsername] = useState<string | null>(null);
    const [aoViewedUserRef, setAoViewedUserRef] = useState<string | null>(null);
    const [aoSnapshot, setAoSnapshot] = useState<AchievementOverviewSnapshot | null>(null);
    const [goResumeProvisional, setGoResumeProvisional] = useState<FriendGamePayload | null>(null);
    const [aoResumeProvisional, setAoResumeProvisional] = useState<FriendGamePayload | null>(null);
    const unlockHistoryReturnFriendRef = useRef<{
        username: string | null;
        gameId: number | null;
        source: FriendGameSource;
    }>({
        username: null,
        gameId: null,
        source: "recentGames"
    });
    const friendCompareReturnFriendRef = useRef<{
        username: string | null;
        gameId: number | null;
        source: FriendGameSource;
    }>({
        username: null,
        gameId: null,
        source: "recentGames"
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [checkingGame, setCheckingGame] = useState(false);
    const [refreshingFriends, setRefreshingFriends] = useState(false);
    const [deepRefreshingFriends, setDeepRefreshingFriends] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setError(null);
    }, [view]);
    const [payload, setPayload] = useState<Payload | null>(null);
    const [gameIconDataUri, setGameIconDataUri] = useState<string | null>(null);
    const [notesGameIconDataUri, setNotesGameIconDataUri] = useState<string | null>(null);
    const [gameIngameDataUri, setGameIngameDataUri] = useState<string | null>(null);
    const gameIconColdRef = useRef(false);
    const notesGameIconColdRef = useRef(false);
    const gameIngameColdRef = useRef(false);
    const [imageRefreshKey, setImageRefreshKey] = useState(0);
    const mountedRef = useRef(true);
    const favoriteSaveRunIdRef = useRef(0);

    useEffect(() => guardFooterPrompts(), []);

    // Settings
    const settingsController = useSettingsController({ mountedRef, setError });
    const { state: settingsState, actions: settingsActions } = settingsController;
    const {
        username,
        activeUlid,
        hasApiKey,
        users,
        autoRefresh,
        showIcons,
        deferModalCleanup,
        legacyCommentsLoading,
        showAllAchievements,
        unlockHistoryDays,
        rememberLastPage,
        uiSize,
        topPadding,
        blockPadding,
        buttonSpacing,
        mouseKeyboardMode,
        controllerGlyphStyle,
        showAButtonMode,
        showAButtonModeTracked,
        gameNotesAButtonMode,
        showSocialHubButton,
        showTrackedSetsButton,
        showOptionsButton,
        quickMenuShortcuts,
        shortcutBindings,
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
        trackedSetAButtonMode,
        trackedAchievementSort,
        friendAchievementFilter,
        friendAchievementSort,
        friendShowAllAchievements,
        trackedSetsAutoCheck,
        trackedSetsSelectorSort,
        trackedSetsSelectorFilter,
        language,
        friendRefreshDelayMs,
        socialGameTicker,
        socialHubTicker,
        friendAutoRefresh,
        showReminderTicker,
        showNotesDot,
        showBellDot,
        doNotDisturb,
        doNotDisturbDisablesDot,
        nightMode,
        nightModeBrightness,
        batterySaver,
        legacyAchievementLinks,
        legacyGameLinks,
        pinLatestGuides,
        keepGuidesOffline,
        injectEmulatorLogin,
        playersNearYouEnabled,
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
        lastSocialView,
        badgesSortOrder,
        socialEntryDefault,
        activityCardAction,
        friendFeedCardAction,
        socialHubCardAction,
        defaultNoteColor,
        lastOptionsTab,
        lastTrackedTab,
        viewedIntro
    } = settingsState;
    const {
        setHasApiKey,
        setUsers,
        setInjectEmulatorLogin,
        setShowAllAchievements,
        setMainAchievementFilter,
        setMainAchievementSort,
        setMainAchievementAction,
        setTrackedAchievementAction,
        setDolphinMapperMode,
        setDolphinBluetoothPassthrough,
        setDolphinContinuousScanning,
        setDolphinBalanceBoard,
        setTrackedSetAButtonMode,
        setFriendAchievementFilter,
        setFriendAchievementSort,
        setFriendShowAllAchievements,
        setTrackedSetsSelectorSort,
        setTrackedSetsSelectorFilter,
        toggleDoNotDisturb,
        toggleBatterySaver,
        toggleMouseKeyboardMode,
        toggleNightMode,
        setPinLatestGuides,
        setKeepGuidesOffline,
        setPlayersNearYouTapMode,
        setPlayersNearYouCollapsed,
        setDolphinAdvancedCollapsed,
        setDolphinSystemFilter,
        setFavoriteFriends,
        setLastSocialView,
        setBadgesSortOrder,
        setDefaultNoteColor,
        setLastOptionsTab,
        setLastTrackedTab,
        setViewedIntro,
        applySettings,
        saveSettingWithRollback
    } = settingsActions;

    const [loadingText, setLoadingText] = useState(t(language, "Refreshing Achievements..."));

    const [trackedSelectedGameId, setTrackedSelectedGameId] = useState<number | null>(null);

    const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
    // Long-lived refs
    const rootRef = useRef<HTMLDivElement | null>(null);
    const pendingResumeFocusKeyRef = useRef<string | null>(null);
    const viewRef = useLatestRef(view);
    const payloadRef = useRef<Payload | null>(null);
    const friendGameReturnGameIdRef = useRef<number | null>(null);
    const friendEntrySourceRef = useRef<"profile" | "compareGame">("profile");
    const friendProfileBackSourceRef = useRef<"social" | "main">("social");
    const trackedSetsBackSourceRef = useRef<"profile" | "main">("profile");
    const goToAchievementOverviewRef = useRef<typeof goToAchievementOverview | null>(null);
    const metrics = achievementUiMetrics(uiSize);

    // Friends
    const friendsController = useFriendsController({
        username,
        hasApiKey,
        language,
        friendRefreshDelayMs,
        friendAutoRefresh,
        view,
        socialView,
        settingsLoaded,
        settingsMode,
        mountedRef,
        navIntentRef,
        viewRef,
        pendingResumeFocusKeyRef,
        rootRef,
        setSettingsMode,
        setView,
        setPendingFocusKey
    });

    const {
        state: {
            friendsPayload,
            friendsLoaded,
            friendsRefreshing,
            friendsError,
            liveRefreshingFriendUsernames,
            selectedFriend,
            friendGamePayload,
            friendGameLoading,
            friendProfileOverlayText,
            friendGameError,
            friendAllGamesPayload,
            friendAllGamesLoading,
            friendAllGamesError,
            userAwardsPayload,
            userAwardsLoading,
            userAwardsError,
            wantToPlayPayload,
            wantToPlayLoading,
            wantToPlayError,
            recentGamesExpanded,
            friendGameSource,
            friendGameSelectionMode,
            friendsRows
        },
        actions: {
            setFriendsPayload,
            setFriendsLoaded,
            setFriendsError,
            setFriendsRefreshing,
            setSelectedFriend,
            setFriendGamePayload,
            setFriendGameError,
            setRecentGamesExpanded,
            setFriendGameSource,
            setFriendGameSelectionMode,
            scheduleFriendPauseRefresh,
            cancelPendingFriendPauseRefresh,
            noteFriendRowHover,
            clearFriendRowHover,
            resolveFriendAvatarNow,
            loadFriendGame,
            loadFriendAllGames,
            loadUserAwards,
            loadUserWantToPlay,
            goToFriends: goToFriendsBase,
            resetFriendEntryRefreshTracking,
            suppressFriendFocusDetectionForTabSwitch
        },
        refs: {
            selectedFriendRef,
            friendGamePayloadRef,
            friendAllGamesPayloadRef,
            friendGameSourceRef,
            friendGameSelectionModeRef,
            friendsRefreshedThisSessionRef,
            friendGameSessionRefreshKeysRef,
            friendRowRefreshRunIdRef,
            friendsRefreshBusyRef
        }
    } = friendsController;

    const friendProfileViewActiveRef = useRef(false);
    const skipFriendTabResetRef = useRef(false);

    const resumeViewFlipRef = useRef(false);
    useEffect(() => {
        const active = view === "friendGame";
        const wasActive = friendProfileViewActiveRef.current;
        friendProfileViewActiveRef.current = active;
        if (active && !wasActive) {
            if (skipFriendTabResetRef.current) {
                skipFriendTabResetRef.current = false;
            } else {
                setFriendProfileSubView("game");
            }
        }
    }, [view]);


    // Saved comments
    const savedCommentsPrefs = settingsController.state.savedCommentsPrefs;
    const communitySubTab = savedCommentsPrefs.subTab;
    const savedCommentsSort = savedCommentsPrefs.sort;
    const savedCommentsListActive = view === "social" && communitySubTab === "savedComments";
    const savedCommentsController = useSavedCommentsController({
        activeUlid,
        listActive: savedCommentsListActive
    });
    const rawSavedFilter = savedCommentsPrefs.filter;
    const parsedSavedFilter: SavedCommentsFilter =
        rawSavedFilter === "all" || rawSavedFilter === "achievement" || rawSavedFilter === "wall"
            ? rawSavedFilter
            : Number(rawSavedFilter);
    const savedCommentsFilter: SavedCommentsFilter =
        typeof parsedSavedFilter === "number"
            ? (savedCommentsController.savedGames.some((game) => game.gameId === parsedSavedFilter) ? parsedSavedFilter : "all")
            : parsedSavedFilter;
    const updateSavedCommentsPrefs = (partial: Partial<SavedCommentsPrefs>) => {
        settingsController.actions.setSavedCommentsPrefs({ ...savedCommentsPrefs, ...partial });
        void saveSavedCommentsPrefs(partial);
    };

    const wallThreadId = selectedFriend
        ? userRefFor(selectedFriend)
        : (friendGamePayload?.friendUsername ?? null);
    const wallOnScreen = view === "friendGame" && friendProfileSubView === "wall";

    // Wall comments
    const wallCommentsController = useGameCommentsController({
        isActive: wallOnScreen && !friendGameLoading,
        id: wallThreadId,
        ipc: getUserComments,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        surfaceKey: "comments:wall",
        legacyLoading: legacyCommentsLoading,
        loadErrorMessage: "Couldn't load this wall's comments.",
        loadMoreErrorMessage: "Couldn't load more comments."
    });
    const {
        state: {
            comments: wallComments,
            commentsLoading: wallCommentsLoading,
            commentsLoadingMore: wallCommentsLoadingMore,
            commentsHasMore: wallCommentsHasMore,
            commentsSort: wallCommentsSort,
            commentsLoaded: wallCommentsLoaded,
            commentsRestricted: wallRestricted
        },
        actions: {
            setCommentsSort: setWallCommentsSort,
            loadMoreComments: loadMoreWallComments
        }
    } = wallCommentsController;

    const wallRestoreArmedRef = useRef(false);
    const wallSnapshotArmedRef = useRef(false);
    const profileWasOpenRef = useRef(false);
    if (wallThreadId != null && hasCommentsSnapshotFor("comments:wall", wallThreadId)) {
        wallRestoreArmedRef.current = true;
        wallSnapshotArmedRef.current = true;
    }
    if (wallThreadId != null && hasCommentsPostReturnFor("comments:wall", wallThreadId)) {
        wallRestoreArmedRef.current = true;
    }
    if (hasCommentsRestoreForSurface("comments:wall")) {
        wallRestoreArmedRef.current = true;
    }
    if (profileWasOpenRef.current && view !== "friendGame") {
        wallRestoreArmedRef.current = false;
        wallSnapshotArmedRef.current = false;
    }
    profileWasOpenRef.current = view === "friendGame";
    const wallRestorePending = wallRestoreArmedRef.current;

    const wallRestoreLandedRef = useRef(false);
    if (wallCommentsLoaded) {
        wallRestoreLandedRef.current = true;
    }
    if (!wallOnScreen) {
        wallRestoreLandedRef.current = false;
    }
    const wallHoldCommentsBody = wallSnapshotArmedRef.current && !wallRestoreLandedRef.current;

    const nowPlayingCommentsOpen = view === "achievements" && mainTab === "comments";

    // Now Playing
    const nowPlayingRestoreArmedRef = useRef(false);
    const nowPlayingSnapshotArmedRef = useRef(false);
    const nowPlayingWasOpenRef = useRef(false);
    if (payload?.gameId != null && hasCommentsSnapshotFor("comments:nowplaying", payload.gameId)) {
        nowPlayingRestoreArmedRef.current = true;
        nowPlayingSnapshotArmedRef.current = true;
    }
    if (payload?.gameId != null && hasCommentsPostReturnFor("comments:nowplaying", payload.gameId)) {
        nowPlayingRestoreArmedRef.current = true;
    }
    if (nowPlayingWasOpenRef.current && !nowPlayingCommentsOpen) {
        nowPlayingRestoreArmedRef.current = false;
        nowPlayingSnapshotArmedRef.current = false;
    }
    nowPlayingWasOpenRef.current = nowPlayingCommentsOpen;

    const nowPlayingController = useNowPlayingController({
        currentGameId: payload?.gameId ?? null,
        friendsRows,
        isActive: view === "achievements" && mainTab !== "achievements",
        commentsActive: nowPlayingCommentsOpen,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        legacyCommentsLoading
    });

    const nowPlayingRestoreLandedRef = useRef(false);
    if (nowPlayingController.state.commentsLoaded) {
        nowPlayingRestoreLandedRef.current = true;
    }
    if (!nowPlayingCommentsOpen) {
        nowPlayingRestoreLandedRef.current = false;
    }
    const nowPlayingHoldCommentsBody = nowPlayingSnapshotArmedRef.current && !nowPlayingRestoreLandedRef.current;

    const nowPlayingCommentsClaimedRef = useRef(false);
    if ((nowPlayingController.state.commentsCardClaim?.token ?? 0) > 0
        || (nowPlayingController.state.commentsPostClaim?.token ?? 0) > 0) {
        nowPlayingCommentsClaimedRef.current = true;
    }
    if (payload?.gameId != null
        && (hasCommentsSnapshotFor("comments:nowplaying", payload.gameId)
            || hasCommentsPostReturnFor("comments:nowplaying", payload.gameId))) {
        nowPlayingCommentsClaimedRef.current = true;
    }

    const {
        state: {
            compareFriendUsername,
            compareFriendRow,
            compareFilter,
            compareLoading,
            compareError,
            comparePayload,
            subView: nowPlayingSubView,
            comments: nowPlayingComments,
            commentsLoading: nowPlayingCommentsLoading,
            commentsLoadingMore: nowPlayingCommentsLoadingMore,
            commentsError: nowPlayingCommentsError,
            commentsHasMore: nowPlayingCommentsHasMore,
            commentsSort: nowPlayingCommentsSort,
            commentsNeedsSettings: nowPlayingCommentsNeedsSettings,
            commentsLoaded: nowPlayingCommentsLoaded
        },
        actions: {
            selectFriend: selectCompareFriend,
            setCompareFilter,
            setSubView: setNowPlayingSubView,
            refreshCompareData,
            setCommentsSort: setNowPlayingCommentsSort,
            loadMoreComments: loadMoreNowPlayingComments
        },
        refs: {
            compareFriendUsernameRef,
            compareFilterRef
        }
    } = nowPlayingController;

    useEffect(() => {
        if (view !== "achievements") {
            return;
        }
        if (mainTab !== "achievements") {
            setNowPlayingSubView(mainTab);
        }
    }, [view, mainTab, setNowPlayingSubView]);

    const [nowPlayingActivityFeed, setNowPlayingActivityFeed] = useState<SocialActivityEvent[]>([]);
    const nowPlayingActivityRunIdRef = useRef(0);
    useEffect(() => {
        if (view !== "achievements" || mainTab !== "activity") {
            return;
        }
        const { isCurrentRun, cleanup } = beginGuardedRun(nowPlayingActivityRunIdRef);
        void (async () => {
            try {
                const result = await getSocialActivity();
                if (!isCurrentRun()) {
                    return;
                }
                if (!result.needsSettings) {
                    setNowPlayingActivityFeed(result.events || []);
                }
            }
            catch (e) {
                logError("AchievementsRoot getSocialActivity", e);
            }
        })();
        return cleanup;
    }, [view, mainTab]);

    // Players Near You
    const [playersNearYouFeed, setPlayersNearYouFeed] = useState<PlayersNearYouItem[]>([]);
    const [playersNearYouMode, setPlayersNearYouMode] = useState<PlayersNearYouMode>("enhanced");
    const [playersNearYouCheckedGameId, setPlayersNearYouCheckedGameId] = useState<number | null>(null);
    const playersNearYouRunIdRef = useRef(0);
    const playersNearYouGameId = payload?.gameId ?? null;
    useEffect(() => {
        if (view !== "achievements" || mainTab !== "activity" || !playersNearYouEnabled) {
            return;
        }
        const { isCurrentRun, cleanup } = beginGuardedRun(playersNearYouRunIdRef);
        void (async () => {
            try {
                const result = await getPlayersNearYou(playersNearYouGameId);
                if (!isCurrentRun()) {
                    return;
                }
                setPlayersNearYouFeed(result.items || []);
                setPlayersNearYouMode(result.mode || "enhanced");
                setPlayersNearYouCheckedGameId(playersNearYouGameId);
            }
            catch (e) {
                logError("AchievementsRoot getPlayersNearYou", e);
                if (isCurrentRun()) {
                    setPlayersNearYouFeed([]);
                    setPlayersNearYouMode("enhanced");
                    setPlayersNearYouCheckedGameId(playersNearYouGameId);
                }
            }
        })();
        return cleanup;
    }, [view, mainTab, playersNearYouEnabled, playersNearYouGameId]);

    // News and AotW
    const newsEventsController = useNewsEventsController({
        isActive: view === "social" && socialView === "newsEvents"
    });
    const { state: newsEventsState, actions: newsEventsActions } = newsEventsController;
    const {
        state: {
            subView: newsEventsSubView,
            aotwResponse,
            aotwSubView,
            newSetsFilter
        },
        actions: {
            setSubView: setNewsEventsSubView,
            setAotwSubView,
            setNewSetsFilter
        },
        refs: {
            subViewRef: newsEventsSubViewRef,
            aotwSubViewRef,
            newSetsFilterRef
        }
    } = newsEventsController;

    const aotwThreadId = aotwResponse?.payload?.achievement?.id ?? null;
    const aotwCommentsOpen = view === "social"
        && socialView === "newsEvents"
        && newsEventsSubView === "aotw"
        && aotwSubView === "comments";

    const aotwCommentsController = useGameCommentsController({
        isActive: aotwCommentsOpen,
        id: aotwThreadId,
        ipc: getAchievementComments,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        surfaceKey: "comments:aotw",
        legacyLoading: legacyCommentsLoading,
        loadErrorMessage: "Couldn't load this achievement's comments.",
        loadMoreErrorMessage: "Couldn't load more comments."
    });
    const {
        state: {
            comments: aotwComments,
            commentsLoading: aotwCommentsLoading,
            commentsLoadingMore: aotwCommentsLoadingMore,
            commentsError: aotwCommentsError,
            commentsHasMore: aotwCommentsHasMore,
            commentsSort: aotwCommentsSort,
            commentsLoaded: aotwCommentsLoaded
        },
        actions: {
            setCommentsSort: setAotwCommentsSort,
            loadMoreComments: loadMoreAotwComments
        }
    } = aotwCommentsController;

    const aotwRestoreArmedRef = useRef(false);
    const aotwSnapshotArmedRef = useRef(false);
    const aotwWasOpenRef = useRef(false);
    if (aotwThreadId != null && hasCommentsSnapshotFor("comments:aotw", aotwThreadId)) {
        aotwRestoreArmedRef.current = true;
        aotwSnapshotArmedRef.current = true;
    }
    if (aotwThreadId != null && hasCommentsPostReturnFor("comments:aotw", aotwThreadId)) {
        aotwRestoreArmedRef.current = true;
    }
    if (aotwWasOpenRef.current && view !== "social") {
        aotwRestoreArmedRef.current = false;
        aotwSnapshotArmedRef.current = false;
    }
    aotwWasOpenRef.current = view === "social";
    const aotwRestorePending = aotwRestoreArmedRef.current;

    const aotwRestoreLandedRef = useRef(false);
    if (aotwCommentsLoaded) {
        aotwRestoreLandedRef.current = true;
    }
    if (view !== "social") {
        aotwRestoreLandedRef.current = false;
    }
    const aotwHoldCommentsBody = aotwSnapshotArmedRef.current && !aotwRestoreLandedRef.current;

    // Tracked sets
    const trackedSetsController = useTrackedSetsController({
        isActive: view === "trackedSets" || view === "trackedSetOpen",
        autoCheckEnabled: trackedSetsAutoCheck
    });
    const { state: trackedSetsState, actions: trackedSetsActions } = trackedSetsController;
    const {
        state: {
            openSetId: trackedSetOpenId
        },
        actions: {
            setOpenSetId: setTrackedSetOpenId,
            closeSet: closeTrackedSet,
            removeSet: removeTrackedSetAction,
            armFullCheck: armTrackedSetsFullCheck,
            clearAll: clearAllTrackedSetsAction
        },
        refs: {
            openSetIdRef: trackedSetOpenIdRef
        }
    } = trackedSetsController;

    function friendPayloadMatches(
        wrapper: FriendGamePayload | null,
        targetGameId: number | null,
        targetViewedUserRef: string | null
    ): Payload | null {
        const inner = wrapper?.payload ?? null;
        if (inner == null || targetGameId == null || inner.gameId !== targetGameId) {
            return null;
        }
        const seedRef = (wrapper?.ulid || wrapper?.friendUsername || "").trim().toLowerCase();
        const wantRef = (targetViewedUserRef || "").trim().toLowerCase();
        if (!seedRef || seedRef !== wantRef) {
            return null;
        }
        return inner;
    }

    function friendSeedPayloadFor(targetGameId: number | null, targetViewedUserRef: string | null): Payload | null {
        return friendPayloadMatches(friendGamePayload, targetGameId, targetViewedUserRef);
    }

    function viewingBannerUsernameFor(viewedUsername: string | null, viewedUserRef: string | null): string | null {
        const name = String(viewedUsername || "").trim();
        if (!name) {
            return null;
        }
        return isOwnUser(viewedUserRef, name) ? null : name;
    }

    let goSeedPayload: Payload | null = null;
    let goSeedFromDisk = false;
    if (gameOverviewViewedUsername == null) {
        if (gameOverviewGameId != null && payload?.gameId === gameOverviewGameId) {
            goSeedPayload = payload;
        }
        else {
            goSeedPayload = friendPayloadMatches(goResumeProvisional, gameOverviewGameId, activeUlid);
            goSeedFromDisk = goSeedPayload != null;
        }
    }
    else {
        goSeedPayload = friendSeedPayloadFor(gameOverviewGameId, gameOverviewViewedUserRef);
        if (goSeedPayload == null) {
            goSeedPayload = friendPayloadMatches(goResumeProvisional, gameOverviewGameId, gameOverviewViewedUserRef);
            goSeedFromDisk = goSeedPayload != null;
        }
    }

    // Game overview
    const gameOverviewRestoreArmedRef = useRef(false);
    const gameOverviewSnapshotArmedRef = useRef(false);
    const gameOverviewWasOpenRef = useRef(false);
    if (gameOverviewGameId != null && hasCommentsSnapshotFor("comments:overview", gameOverviewGameId)) {
        gameOverviewRestoreArmedRef.current = true;
        gameOverviewSnapshotArmedRef.current = true;
    }
    if (gameOverviewGameId != null && hasCommentsPostReturnFor("comments:overview", gameOverviewGameId)) {
        gameOverviewRestoreArmedRef.current = true;
    }
    if (gameOverviewWasOpenRef.current && view !== "gameOverview") {
        gameOverviewRestoreArmedRef.current = false;
        gameOverviewSnapshotArmedRef.current = false;
    }
    gameOverviewWasOpenRef.current = view === "gameOverview";
    const gameOverviewRestorePending = gameOverviewRestoreArmedRef.current;

    const gameOverviewController = useGameOverviewController({
        isActive: view === "gameOverview",
        subView: gameOverviewSubView,
        gameId: gameOverviewGameId,
        viewedUsername: gameOverviewViewedUsername,
        viewedUserRef: gameOverviewViewedUserRef,
        seedPayload: goSeedPayload,
        seedIsProvisional: goSeedFromDisk,
        language,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        legacyCommentsLoading
    });

    const gameOverviewRestoreLandedRef = useRef(false);
    if (gameOverviewController.state.commentsLoaded) {
        gameOverviewRestoreLandedRef.current = true;
    }
    if (view !== "gameOverview") {
        gameOverviewRestoreLandedRef.current = false;
    }
    const gameOverviewHoldCommentsBody = gameOverviewSnapshotArmedRef.current && !gameOverviewRestoreLandedRef.current;

    const { state: goState, actions: goActions } = gameOverviewController;

    let aoSeedPayload: Payload | null = null;
    let aoSeedFromDisk = false;
    if (aoViewedUsername == null) {
        if (aoGameId != null) {
            if (payload?.gameId === aoGameId) {
                aoSeedPayload = payload;
            }
            else if (goState.loadedPayload?.gameId === aoGameId) {
                aoSeedPayload = goState.loadedPayload;
            }
            else {
                aoSeedPayload = friendPayloadMatches(aoResumeProvisional, aoGameId, activeUlid);
                aoSeedFromDisk = aoSeedPayload != null;
            }
        }
    }
    else {
        aoSeedPayload = friendSeedPayloadFor(aoGameId, aoViewedUserRef);
        if (aoSeedPayload == null) {
            aoSeedPayload = friendPayloadMatches(aoResumeProvisional, aoGameId, aoViewedUserRef);
            aoSeedFromDisk = aoSeedPayload != null;
        }
    }

    // Achievement overview
    const aoRestoreArmedRef = useRef(false);
    const aoSnapshotArmedRef = useRef(false);
    const aoWasOpenRef = useRef(false);
    if (aoAchievementId != null && hasCommentsSnapshotFor("comments:ao", aoAchievementId)) {
        aoRestoreArmedRef.current = true;
        aoSnapshotArmedRef.current = true;
    }
    if (aoAchievementId != null && hasCommentsPostReturnFor("comments:ao", aoAchievementId)) {
        aoRestoreArmedRef.current = true;
    }
    if (aoWasOpenRef.current && view !== "achievementOverview") {
        aoRestoreArmedRef.current = false;
        aoSnapshotArmedRef.current = false;
    }
    aoWasOpenRef.current = view === "achievementOverview";
    const aoRestorePending = aoRestoreArmedRef.current;

    const aoController = useAchievementOverviewController({
        isActive: view === "achievementOverview",
        achievementId: aoAchievementId,
        gameId: aoGameId,
        viewedUsername: aoViewedUsername,
        viewedUserRef: aoViewedUserRef,
        seedPayload: aoSeedPayload,
        seedIsProvisional: aoSeedFromDisk,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        legacyCommentsLoading
    });

    const aoRestoreLandedRef = useRef(false);
    if (aoController.state.commentsLoaded) {
        aoRestoreLandedRef.current = true;
    }
    if (view !== "achievementOverview") {
        aoRestoreLandedRef.current = false;
    }
    const aoHoldCommentsBody = aoSnapshotArmedRef.current && !aoRestoreLandedRef.current;

    const { state: aoState, actions: aoActions } = aoController;

    useEffect(() => {
        if (
            goResumeProvisional != null
            && friendSeedPayloadFor(gameOverviewGameId, gameOverviewViewedUserRef) != null
        ) {
            setGoResumeProvisional(null);
        }
    }, [friendGamePayload, gameOverviewGameId, gameOverviewViewedUserRef, goResumeProvisional]);
    useEffect(() => {
        if (
            aoResumeProvisional != null
            && friendSeedPayloadFor(aoGameId, aoViewedUserRef) != null
        ) {
            setAoResumeProvisional(null);
        }
    }, [friendGamePayload, aoGameId, aoViewedUserRef, aoResumeProvisional]);

    // Optimistic saves
    const friendsByUsername = useMemo(() => {
        const friends = new Map<string, FriendRow>();
        for (const friend of friendsRows) {
            const key = friend.username.trim().toLowerCase();
            if (key) {
                friends.set(key, friend);
            }
        }
        return friends;
    }, [friendsRows]);

    function isOwnUser(viewedUlid?: string | null, viewedName?: string | null): boolean {
        const ownUlid = activeUlid.trim();
        const theirUlid = String(viewedUlid || "").trim();
        if (ownUlid.length > 0 && theirUlid.length > 0) {
            return theirUlid.toLowerCase() === ownUlid.toLowerCase();
        }
        const ownName = username.trim();
        const theirName = String(viewedName || "").trim();
        return theirName.length > 0
            && ownName.length > 0
            && theirName.toLowerCase() === ownName.toLowerCase();
    }

    function resolveViewedUser(viewedName?: string | null, viewedUlid?: string | null): {
        isOwn: boolean;
        viewedUsername: string | null;
        viewedUserRef: string | null;
    } {
        const name = String(viewedName || "").trim();
        const isOwn = isOwnUser(viewedUlid, name);
        const viewedUsername = isOwn || !name ? null : name;
        const viewedUserRef =
            viewedUsername == null
                ? null
                : (viewedUlid
                    || friendsByUsername.get(viewedUsername.toLowerCase())?.ulid
                    || viewedUsername);
        return { isOwn, viewedUsername, viewedUserRef };
    }

    const saveTrackedAchievementActionWithRollback = useCallback(
        (nextValue: TrackedAchievementAction) =>
            saveSettingWithRollback<TrackedAchievementAction>({
                nextValue,
                previousValue: trackedAchievementAction,
                applyValue: setTrackedAchievementAction,
                saveCall: saveTrackedAchievementAction,
                getSavedValue: (result, fallbackValue) => result.trackedAchievementAction ?? fallbackValue,
            }),
        [saveSettingWithRollback, trackedAchievementAction]
    );

    const saveDolphinMapperModeWithRollback = (nextValue: DolphinMapperMode) =>
        saveSettingWithRollback<DolphinMapperMode>({
            nextValue,
            previousValue: dolphinMapperMode,
            applyValue: setDolphinMapperMode,
            saveCall: saveDolphinMapperMode,
            getSavedValue: (result, fallbackValue) => result.dolphinMapperMode ?? fallbackValue,
        });

    const saveDolphinBluetoothPassthroughWithRollback = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dolphinBluetoothPassthrough,
            applyValue: setDolphinBluetoothPassthrough,
            saveCall: saveDolphinBluetoothPassthrough,
            getSavedValue: (result, fallbackValue) => result.dolphinBluetoothPassthrough ?? fallbackValue,
        });

    const saveDolphinContinuousScanningWithRollback = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dolphinContinuousScanning,
            applyValue: setDolphinContinuousScanning,
            saveCall: saveDolphinContinuousScanning,
            getSavedValue: (result, fallbackValue) => result.dolphinContinuousScanning ?? fallbackValue,
        });

    const saveDolphinBalanceBoardWithRollback = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: dolphinBalanceBoard,
            applyValue: setDolphinBalanceBoard,
            saveCall: saveDolphinBalanceBoard,
            getSavedValue: (result, fallbackValue) => result.dolphinBalanceBoard ?? fallbackValue,
        });

    const saveTrackedSetAButtonModeWithRollback = (nextValue: TrackedSetAButtonMode) =>
        saveSettingWithRollback<TrackedSetAButtonMode>({
            nextValue,
            previousValue: trackedSetAButtonMode,
            applyValue: setTrackedSetAButtonMode,
            saveCall: saveTrackedSetAButtonMode,
            getSavedValue: (result, fallbackValue) => result.trackedSetAButtonMode ?? fallbackValue,
        });

    const onToggleKeepGuidesOffline = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: keepGuidesOffline,
            applyValue: setKeepGuidesOffline,
            saveCall: saveKeepGuidesOffline,
            getSavedValue: (result, fallbackValue) => Boolean(result.keepGuidesOffline ?? fallbackValue),
        });

    const onTogglePinLatestGuides = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: pinLatestGuides,
            applyValue: setPinLatestGuides,
            saveCall: savePinLatestGuides,
            getSavedValue: (result, fallbackValue) => Boolean(result.pinLatestGuides ?? fallbackValue),
        });

    const pressingQuickGuideRef = useRef(false);
    const mouseKeyboardModeRef = useRef(mouseKeyboardMode);
    mouseKeyboardModeRef.current = mouseKeyboardMode;

    const pressQuickGuide = useCallback(async (navIntent?: NavIntent) => {
        const gid = payload?.gameId ?? null;
        if (gid == null) {
            return;
        }
        if (pressingQuickGuideRef.current) {
            return;
        }
        pressingQuickGuideRef.current = true;

        function fallBackToGuidesPage() {
            if (navIntent) {
                navIntentRef.current = navIntent;
            }
            goToGuides();
        }

        try {
            let record: GameGuidesRecord;
            try {
                record = await loadGameGuides(gid);
            }
            catch (error) {
                logError("pressQuickGuide", error);
                if (mountedRef.current) {
                    fallBackToGuidesPage();
                }
                return;
            }

            if (!mountedRef.current) {
                return;
            }

            const gameUrl = record.gamefaqs?.gameUrl ?? null;

            let bestFaqId: string | null = null;
            let bestOpened = 0;
            for (const [faqId, guide] of Object.entries(record.guides)) {
                if (!guideBelongsToMapping(guide, gameUrl)) {
                    continue;
                }
                if (guide.lastOpenedAt > bestOpened) {
                    bestFaqId = faqId;
                    bestOpened = guide.lastOpenedAt;
                }
            }

            if (bestFaqId === null || !gameUrl) {
                fallBackToGuidesPage();
                return;
            }

            const guide = record.guides[bestFaqId];
            showManagedModal((close) => (
                <GuidesReaderModal
                    language={language}
                    title={guide.title || payload?.title || t(language, "Guide")}
                    gameId={gid}
                    imageIcon={payload?.imageIcon ?? null}
                    showIcons={showIcons}
                    faqId={bestFaqId}
                    gameUrl={gameUrl}
                    initialContent={null}
                    initialSection={guide.lastAnchor || null}
                    mouseKeyboardMode={mouseKeyboardModeRef.current}
                    close={close}
                />
            ));
        }
        finally {
            pressingQuickGuideRef.current = false;
        }
    }, [payload, language, showIcons]);

    useEffect(() => {
        setQuickGuide({
            visible: settingsLoaded
                ? (pinLatestGuides && (payload?.gameId ?? null) !== null && view !== "guides")
                : currentQuickGuideVisible(),
            onPress: () => { void pressQuickGuide(); }
        });
    }, [settingsLoaded, pinLatestGuides, payload?.gameId, view, pressQuickGuide]);

    // Row and modal handlers
    const onFriendAchievementFilterChange = (nextValue: FriendAchievementFilter) =>
        saveSettingWithRollback<FriendAchievementFilter>({
            nextValue,
            previousValue: friendAchievementFilter,
            applyValue: setFriendAchievementFilter,
            saveCall: saveFriendAchievementFilter,
            getSavedValue: (result, fallbackValue) => result.friendAchievementFilter ?? fallbackValue,
        });

    const onFriendAchievementSortChange = (nextValue: AchievementSort) =>
        saveSettingWithRollback<AchievementSort>({
            nextValue,
            previousValue: friendAchievementSort,
            applyValue: setFriendAchievementSort,
            saveCall: saveFriendAchievementSort,
            getSavedValue: (result, fallbackValue) => result.friendAchievementSort ?? fallbackValue,
        });

    const onFriendShowAllAchievementsChange = (nextValue: boolean) =>
        saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: friendShowAllAchievements,
            applyValue: setFriendShowAllAchievements,
            saveCall: saveFriendShowAllAchievements,
            getSavedValue: (result, fallbackValue) => Boolean(result.friendShowAllAchievements ?? fallbackValue),
        });

    const toggleFriendFavorite = async (friendUlid: string, favorite: boolean) => {
        const runId = favoriteSaveRunIdRef.current + 1;
        favoriteSaveRunIdRef.current = runId;

        const previousFavorites = favoriteFriends;
        const targetUlid = String(friendUlid || "").trim();
        if (!targetUlid) {
            return;
        }

        const optimisticFavorites = favorite
            ? [...previousFavorites.filter((saved) => saved !== targetUlid), targetUlid]
            : previousFavorites.filter((saved) => saved !== targetUlid);

        setFavoriteFriends(optimisticFavorites);
        setError(null);

        try {
            const result = await setFriendFavorite(targetUlid, favorite);
            if (!mountedRef.current || favoriteSaveRunIdRef.current !== runId) {
                return;
            }

            setFavoriteFriends(result.favoriteFriends ?? optimisticFavorites);
        } catch (e: any) {
            logError("toggleFriendFavorite", e);
            if (!mountedRef.current || favoriteSaveRunIdRef.current !== runId) {
                return;
            }

            setFavoriteFriends(previousFavorites);
            setError(String(e?.message || e || "Failed to save favorite friend."));
        }
    };

    const openNoteModal = useCallback(
        (
            gameId: number | null,
            achievement: AchievementRow,
            currentNote: string,
            currentColor: NoteColor | null,
            saveNote: SaveTrackedNoteFn
        ) => {
            markNextValidationSkipped();
            showManagedModal((close) => (
                <NoteEditModal
                    gameId={gameId}
                    achievement={achievement}
                    currentNote={currentNote}
                    currentColor={currentColor}
                    saveNote={saveNote}
                    close={close}
                    language={language}
                    defaultNoteColor={defaultNoteColor}
                    setDefaultNoteColor={setDefaultNoteColor}
                />
            ));
        },
        [language, defaultNoteColor, setDefaultNoteColor]
    );

    const trackedController = useTrackedController({
        payload,
        mountedRef,
        showAButtonModeTracked,
        mouseKeyboardMode,
        trackedAchievementAction,
        trackedAchievementSort,
        setView,
        setRecentGamesExpanded,
        setPendingFocusKey,
        setError,
        setLastTrackedTab,
        setTrackedSelectedGameId,
        saveTrackedAchievementActionWithRollback,
        openNoteModal,
        goToAchievements,
        legacyAchievementLinks,
        goToAchievementOverviewRef
    });

    const openCheevoCheckBrowseModal = (kind: CheevoCheckListKind, rows: CheevoCheckBrowseRow[]) => {
        markNextValidationSkipped();
        showManagedModal((close) => (
            <CheevoCheckGamesModal
                language={language}
                showIcons={showIcons}
                kind={kind}
                rows={rows}
                onPick={(gameId) => {
                    pendingCheevoCheckGameId = gameId;
                    close();
                    goToGameOverview(gameId, "cheevoCheck", null, null);
                }}
                onWebSearch={(title) => {
                    close();
                    void openExternalUrl(raLookupSearchUrl(title));
                }}
                close={close}
            />
        ));
    };

    const {
        state: { trackedValidating, trackedIds, trackedIdsLoadedForGameId, trackedAchievements, notesByAchievementId, notesColorByAchievementId, sort: perGameTrackedSort, reorderTargetId, reorderViaSwap, backClaimToken: trackedBackClaimToken, rowClaim: trackedRowClaim },
        actions: {
            setTrackedValidating,
            setTrackedIds,
            setLastKnownTrackedCount,
            setNotesByAchievementId,
            setNotesColorByAchievementId,
            goToTracked,
            backFromTracked,
            onTrackedViewAchievementClick,
            onTrackedUntrack,
            onTrackedEditNote,
            onReorderSwap: onTrackedReorderPick,
            onTrackedSortChange,
            onClearTracked,
            onClearTrackedForGame,
            onClearAllTracked,
            onAddAllMissable,
            refreshTotalTrackedCount,
            onReorderMove
        }
    } = trackedController;

    // Tracked and leaderboards
    const trackedForGameController = useTrackedForGameController({
        selectedGameId: trackedSelectedGameId,
        mountedRef,
        showAButtonModeTracked,
        mouseKeyboardMode,
        trackedAchievementAction,
        trackedAchievementSort,
        setError,
        openNoteModal,
        saveTrackedAchievementActionWithRollback,
        legacyAchievementLinks,
        goToAchievementOverviewRef
    });

    const { state: drillInState, actions: drillInActions } = trackedForGameController;

    const leaderboardsController = useLeaderboardsController({
        navIntentRef,
        mountedRef,
        payloadRef,
        selectedFriend,
        selectedFriendRef,
        friendGamePayloadRef,
        friendGameSourceRef,
        friendGameReturnGameIdRef,
        setFriendGameSource,
        setRecentGamesExpanded,
        setSettingsMode,
        setView,
        setPendingFocusKey,
        loadFriendGame,
        goToFriends,
        goToAchievements,
        returnToGameOverview: () => {
            setView("gameOverview");
            setPendingFocusKey("gameoverview:leaderboards");
        },
        onBeforeEnterLeaderboards: () => {
            friendGameSessionRefreshKeysRef.current = new Set();
        }
    });

    const {
        state: {
            leaderboardsPayload,
            leaderboardsLoading,
            leaderboardsError,
            selectedLeaderboard,
            leaderboardsSourceView,
            leaderboardEntriesPayload,
            leaderboardEntriesLoading,
            leaderboardEntriesError,
            leaderboardUserEntryPayload,
            leaderboardUserEntryLoading,
            leaderboardUserEntryError,
            leaderboardAudience,
            restoringLeaderboardDetail
        },
        actions: {
            setRestoringLeaderboardDetail,
            goToLeaderboards,
            openLeaderboardDetail,
            backToLeaderboardsSource,
            backToLeaderboardsList,
            setLeaderboardAudience,
            onOpenLeaderboardUserProfile
        },
        refs: {
            leaderboardsPayloadRef,
            leaderboardReturnFriendRef,
            leaderboardsSourceViewRef,
            selectedLeaderboardRef
        }
    } = leaderboardsController;

    // Focus and resume
    const defaultPersistedFocusKeyForView = useCallback((currentView: ViewKey): string => {
        return ROUTES[currentView].focusKey;
    }, []);

    const {
        state: {
            listResetToken,
            focusScopeResetToken,
            achievementsInitialAutoFocusDone,
            mainEntryToken,
            mainEntryFromView
        }
    } = useFocusController({
        view,
        viewRef,
        loading,
        friendProfileOverlayText,
        mountedRef,
        rootRef,
        pendingFocusKey,
        setPendingFocusKey,
        resumeViewFlipRef
    });

    const {
        buildResumeState,
        unlockHistorySourceRef,
        gameOverviewSourceRef,
        gameOverviewGameIdRef,
        gameOverviewViewedUsernameRef,
        gameOverviewViewedUserRefRef,
        aoSourceRef,
        aoAchievementIdRef,
        aoGameIdRef
    } = useResumeSnapshot({
        settingsLoaded,
        settingsMode,
        rememberLastPage,
        view,
        payload,
        selectedFriend,
        friendGamePayload,
        friendAllGamesPayload,
        friendGameSource,
        friendGameSelectionMode,
        compareFriendUsername,
        compareFilter,
        newsEventsSubView,
        aotwSubView,
        newSetsFilter,
        trackedSetOpenId,
        navStack: nav.stack,
        unlockHistorySource,
        badgeFilter,
        allGamesLetterRange,
        allGamesStatusFilter,
        followedRankingMetric,
        gameOverviewSubView,
        friendProfileSubView,
        mainTab,
        gameOverviewSource,
        gameOverviewGameId,
        gameNotesGameId,
        gameOverviewViewedUsername,
        gameOverviewViewedUserRef,
        aoSource,
        aoAchievementId,
        aoGameId,
        aoViewedUsername,
        aoViewedUserRef,
        aoSnapshot,
        trackedSelectedGameId,
        viewRef,
        payloadRef,
        defaultPersistedFocusKeyForView,
        selectedFriendRef,
        friendGamePayloadRef,
        friendGameReturnGameIdRef,
        friendAllGamesPayloadRef,
        friendGameSourceRef,
        friendGameSelectionModeRef,
        friendProfileBackSourceRef,
        guidesSubViewRef,
        guidesOpenFaqIdRef,
        leaderboardsSourceViewRef,
        selectedLeaderboardRef,
        compareFriendUsernameRef,
        compareFilterRef,
        newsEventsSubViewRef,
        aotwSubViewRef,
        newSetsFilterRef,
        friendEntrySourceRef,
        trackedSetOpenIdRef,
        trackedSetsBackSourceRef
    });

    const resumeController = useResumeController({
        buildResumeState,
        mountedRef,
        viewRef,
        pendingResumeFocusKeyRef,
        rememberLastPage,
        view,
        settingsLoaded,
        settingsMode,
        loading,
        friendProfileOverlayText,
        payload,
        trackedIdsLoadedForGameId,
        setTrackedSelectedGameId,
        friendsPayload,
        friendGameReturnGameIdRef,
        onRestoreGuides: setGuidesResumeTarget,
        friendProfileBackSourceRef,
        trackedSetsBackSourceRef,
        setSelectedFriend,
        setFriendGameSource,
        setFriendGameSelectionMode,
        setFriendProfileSubView,
        setRecentGamesExpanded,
        loadFriendGame,
        loadFriendAllGames,
        loadUserAwards,
        loadUserWantToPlay,
        leaderboardsPayloadRef,
        leaderboardReturnFriendRef,
        goToLeaderboards,
        openLeaderboardDetail,
        setRestoringLeaderboardDetail,
        setView,
        setPendingFocusKey,
        selectCompareFriend,
        setCompareFilter,
        setNowPlayingSubView,
        setMainTab,
        setNewsEventsSubView,
        setAotwSubView,
        setNewSetsFilter,
        setGameOverviewSubView,
        setGameOverviewSource,
        setGameOverviewGameId,
        setGameOverviewViewedUsername,
        setGameOverviewViewedUserRef,
        setGameNotesGameId,
        setAoSource,
        setAoAchievementId,
        setAoGameId,
        setAoSnapshot,
        setAoViewedUsername,
        setAoViewedUserRef,
        friendEntrySourceRef,
        setUnlockHistorySource,
        unlockHistoryReturnFriendRef,
        friendCompareReturnFriendRef,
        setBadgeFilter,
        setAllGamesLetterRange,
        setAllGamesStatusFilter,
        setFollowedRankingMetric,
        setTrackedSetOpenId
    });
    const {
        actions: {
            clearPendingResumeState,
            enableRememberLastPagePersistence,
            disableRememberLastPagePersistence,
            initializeResumeFromBoot,
            setPendingPrimaryViewRestoreGameId
        },
        refs: { rememberLastPageRef }
    } = resumeController;

    const achievementsController = useAchievementsController({
        payload,
        showAButtonMode,
        showAllAchievements,
        mainAchievementFilter,
        mainAchievementSort,
        mainAchievementAction,
        mouseKeyboardMode,
        mountedRef,
        saveSettingWithRollback,
        setShowAllAchievements,
        setMainAchievementFilter,
        setMainAchievementSort,
        setMainAchievementAction,
        setTrackedIds,
        setLastKnownTrackedCount,
        setNotesByAchievementId,
        setNotesColorByAchievementId,
        setError,
        openExternalUrl,
        legacyAchievementLinks,
        goToAchievementOverviewRef,
        goToFriends,
        goToLeaderboards,
        goToOptions,
        goToTracked
    });

    const { state: achievementsState, actions: achievementsActions } = achievementsController;

    const onSelectOptionsTab = (nextTab: OptionsTab) => {
        setLastOptionsTab(nextTab);
        void saveLastOptionsTab(nextTab).catch(() => {
        });
    };

    const onSelectTrackedTab = (nextTab: TrackedTab) => {
        setTrackedSelectedGameId(null);
        setLastTrackedTab(nextTab);
        void saveLastTrackedTab(nextTab).catch(() => {
        });
    };

    // Cache and account
    const onSelectTrackedGame = useCallback((nextGameId: number | null) => {
        setTrackedSelectedGameId(nextGameId);
        setPendingFocusKey("tracked:tab:otherGames");
    }, [setPendingFocusKey]);

    const wipeFrontendMirrors = useFrontendMirrorWipe({
        setPayload,
        setGameIconDataUri,
        setGameIngameDataUri,
        setImageRefreshKey,
        setFriendsPayload,
        setFriendsLoaded,
        setSelectedFriend,
        setFriendGamePayload,
        setRecentGamesExpanded,
        friendRowRefreshRunIdRef,
        friendGameSessionRefreshKeysRef,
        friendsRefreshedThisSessionRef
    });

    const {
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
        clearingAnyCache,
        onClearGameData,
        onClearFriendsCache,
        onClearImages,
        onClearOtherIcons,
        onClearSocialActivity,
        onClearGameActivity,
        onClearPlayersNearYou,
        onClearGamesListCache,
        onClearAwardsListCache,
        onClearWantToPlayCache,
        onClearGameOverviewCache,
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
        onClearAllCache
    } = useCacheClearing({
        language,
        mountedRef,
        runClearWithSpinner,
        wipeFrontendMirrors,
        setPayload,
        refreshGameData: (force, preserveFocus, loadingMessage) =>
            refreshGameData(force, preserveFocus, loadingMessage),
        setFriendsPayload,
        setFriendsLoaded,
        setSelectedFriend,
        setFriendGamePayload,
        setRecentGamesExpanded,
        friendRowRefreshRunIdRef,
        friendGameSessionRefreshKeysRef,
        friendsRefreshedThisSessionRef,
        setGameIconDataUri,
        setGameIngameDataUri,
        setImageRefreshKey
    });

    const {
        factoryResetting,
        addingUser,
        switchingUser,
        openCredentialsModal,
        openSetupProfilesModal,
        openAddUserModal,
        openSwitchUserModal,
        openLanguageModal,
        onClearApiKey,
        onFactoryReset
    } = useAccountActions({
        language,
        mountedRef,
        runClearWithSpinner,
        wipeFrontendMirrors,
        refreshGameData: (force, preserveFocus, loadingMessage, creds) =>
            refreshGameData(force, preserveFocus, loadingMessage, creds),
        onApplySetupProfile: (profile, preserveOtherSettings) =>
            optionsActions.onApplySetupProfile(profile, preserveOtherSettings),
        onApplyScalePreset: (preset) => optionsActions.onApplyScalePreset(preset),
        onApplyMainUiPreset: (preset) => optionsActions.onApplyMainUiPreset(preset),
        onSelectLanguage: (code) => optionsActions.onSelectLanguage(code),
        username,
        hasApiKey,
        users,
        injectEmulatorLogin,
        viewedIntro,
        applySettings,
        setUsers,
        setInjectEmulatorLogin,
        setHasApiKey,
        setViewedIntro,
        setView,
        setPendingFocusKey,
        setSettingsMode,
        setSaving,
        setError,
        clearPendingResumeState,
        setFriendsError,
        setFriendGameError
    });

    const {
        goToOwnProfile,
        handleActivityCardClick,
        handlePlayersNearYouClick,
        handleOpenUserProfile,
        openNotificationProfile,
        handleOpenSubscription
    } = useSocialIntents({
        username,
        activeUlid,
        activityCardAction,
        friendFeedCardAction,
        socialHubCardAction,
        playersNearYouTapMode,
        legacyAchievementLinks,
        legacyGameLinks,
        friendsRows,
        loadFriendGame,
        cancelPendingFriendPauseRefresh,
        resetFriendEntryRefreshTracking,
        setFriendGameSource,
        setFriendGameSelectionMode,
        mountedRef,
        friendGameReturnGameIdRef,
        navIntentRef,
        friendProfileBackSourceRef,
        setError,
        resolveViewedUser,
        goToAchievementOverview: (achievement, parentGameId, source, viewedUsername, viewedUserRef) =>
            goToAchievementOverview(achievement, parentGameId, source, viewedUsername, viewedUserRef),
        goToGameOverview: (targetGameId, source, viewedUsername, viewedUserRef, subView) =>
            goToGameOverview(targetGameId, source, viewedUsername, viewedUserRef, subView),
        stashPendingNotificationProfile: (target) => {
            pendingNotificationProfile = target;
        }
    });

    const clearingCache = clearingAnyCache || switchingUser;

    const optionsController = useOptionsController({
        ...settingsState,
        ...settingsActions,
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
        addingUser,
        switchingUser,
        payload,
        quickMenuShortcutRefused,
        error,
        focusScopeResetToken,
        activeOptionsTab: lastOptionsTab,
        onSelectOptionsTab,
        setActiveOptionsTab: setLastOptionsTab,
        mountedRef,
        setQuickMenuShortcutRefused,
        setPendingPrimaryViewRestoreGameId,
        setError,
        clearPendingResumeState,
        enableRememberLastPagePersistence,
        disableRememberLastPagePersistence,
        onBack: goToAchievements,
        onGoToAbout: goToAbout,
        onRefreshNow: () => refreshGameData(true, false, t(language, "Refreshing Achievements...")),
        onAfterSelfRename: async () => {
            const fresh = await getSettings();
            if (!mountedRef.current) {
                return;
            }
            applySettings(fresh, { skipButtonToggles: true });
        },
        onEditCredentials: openCredentialsModal,
        onOpenSetupProfiles: openSetupProfilesModal,
        onAddUser: openAddUserModal,
        onSwitchUser: openSwitchUserModal,
        onOpenLanguage: openLanguageModal,
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
        onToggleKeepGuidesOffline,
        onClearGuideCache,
        onDeleteAllGuideData,
        onDeleteAllNotifications,
        onClearArchivedNotifications,
        onClearSavedComments
    });

    const { state: optionsState, actions: optionsActions } = optionsController;

    // Unlock history and guides
    const isFriendUnlockHistory = unlockHistorySource === "friendGame";
    const unlockHistoryPayload = isFriendUnlockHistory
        ? friendGamePayload?.payload ?? null
        : payload;
    const unlockHistoryFriendUsername = isFriendUnlockHistory
        ? selectedFriend?.username ?? friendGamePayload?.friendUsername ?? null
        : null;
    const unlockHistoryDaysForPage = isFriendUnlockHistory ? -1 : unlockHistoryDays;

    function backFromUnlockHistory() {
        navIntentRef.current = "back";
        if (unlockHistorySource === "friendGame") {
            void backFromFriendUnlockHistory();
            return;
        }
        goToAchievements("quick:tab:history");
    }

    function backFromGuides() {
        navIntentRef.current = "back";
        if (guidesActions.handleBack()) {
            setPendingFocusKey("guides:back");
            return;
        }
        goToAchievements("quick:tab:guides");
    }

    const unlockHistoryController = useUnlockHistoryController({
        language,
        buttonSpacing,
        focusScopeResetToken,
        payload: unlockHistoryPayload,
        unlockHistoryDays: unlockHistoryDaysForPage,
        showIcons,
        achievementStyle,
        uiSize,
        topPadding,
        blockPadding,
        dynamicLoading,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        source: unlockHistorySource,
        friendUsername: unlockHistoryFriendUsername,
        showRetroPoints,
        onBack: backFromUnlockHistory,
        onAchievementClick: async (achievement) => {
            const friendSource =
                unlockHistorySourceRef.current === "friendGame" &&
                !selectedFriendRef.current?.isSelf;
            const viewedUsername = friendSource ? (selectedFriendRef.current?.username ?? null) : null;
            const viewedUserRef = friendSource && selectedFriendRef.current ? userRefFor(selectedFriendRef.current) : null;
            const gameId = unlockHistoryPayload?.gameId ?? null;
            if (legacyAchievementLinks) {
                await openExternalUrl(raAchievementUrl(achievement.id));
                return;
            }
            goToAchievementOverviewRef.current?.(achievement, gameId, "unlockHistory", viewedUsername, viewedUserRef);
        }
    });

    const guidesController = useGuidesController({
        isActive: view === "guides",
        gameId: payload?.gameId ?? null,
        title: payload?.title ?? null,
        consoleName: payload?.consoleName ?? null,
        language,
        resumeTarget: guidesResumeTarget,
        onResumeConsumed: () => setGuidesResumeTarget(null),
        onRequestFocus: setPendingFocusKey,
    });
    const { state: guidesState, actions: guidesActions } = guidesController;
    guidesSubViewRef.current = guidesState.subView;
    guidesOpenFaqIdRef.current = guidesState.openFaqId;

    const aboutController = useAboutController({
        language,
        buttonSpacing,
        focusScopeResetToken,
        onBack: () => {
            navIntentRef.current = "back";
            if (previousView(nav.stack) === "options") {
                goToOptions("options:about");
            } else {
                goToAchievements();
            }
        }
    });

    const gameNotesController = useGameNotesController({
        payload,
        gameNotesGameId,
        mountedRef,
        setError,
        aButtonMode: gameNotesAButtonMode,
        refreshToken: achievementsResumeToken + notesRefreshToken
    });

    const { state: unlockHistoryState, actions: unlockHistoryActions } = unlockHistoryController;
    const { state: aboutState, actions: aboutActions } = aboutController;
    const { state: gameNotesState, actions: gameNotesActions } = gameNotesController;

    const notif = useNotificationsController(doNotDisturb, doNotDisturbDisablesDot, showBellDot);

    // Focus claims
    useEffect(() => {
        const onNotification = (payload: { type?: string }) => {
            if (payload?.type !== "noteReminder") {
                return;
            }
            setNotesRefreshToken((t) => t + 1);
        };
        addEventListener(NOTIFICATION_EVENT, onNotification);
        return () => {
            removeEventListener(NOTIFICATION_EVENT, onNotification);
        };
    }, []);

    useEffect(() => {
        setModalAutoCleanup(deferModalCleanup);
    }, [deferModalCleanup]);

    useEffect(() => {
        setCommentsSnapshotUser(activeUlid);
    }, [activeUlid]);

    useEffect(() => {
        const cardClaim = gameOverviewController.state.commentsCardClaim;
        if (cardClaim?.armed) {
            setPendingFocusKey(`gameoverview:comment:${cardClaim.slotIndex}`);
            return;
        }
        if (gameOverviewController.state.commentsPostClaim?.armed) {
            setPendingFocusKey("gameoverview:comments:post");
        }
    }, [
        gameOverviewController.state.commentsCardClaim,
        gameOverviewController.state.commentsPostClaim
    ]);

    useEffect(() => {
        const cardClaim = aoController.state.commentsCardClaim;
        if (cardClaim?.armed) {
            setPendingFocusKey(`ao:comment:${cardClaim.slotIndex}`);
            return;
        }
        if (aoController.state.commentsPostClaim?.armed) {
            setPendingFocusKey("ao:comments:post");
        }
    }, [
        aoController.state.commentsCardClaim,
        aoController.state.commentsPostClaim
    ]);

    useEffect(() => {
        const cardClaim = nowPlayingController.state.commentsCardClaim;
        if (cardClaim?.armed) {
            setPendingFocusKey(`nowplaying:comment:${cardClaim.slotIndex}`);
            return;
        }
        if (nowPlayingController.state.commentsPostClaim?.armed) {
            setPendingFocusKey("nowplaying:comments:post");
        }
    }, [
        nowPlayingController.state.commentsCardClaim,
        nowPlayingController.state.commentsPostClaim
    ]);

    useEffect(() => {
        const cardClaim = wallCommentsController.state.commentsCardClaim;
        if (cardClaim?.armed) {
            setPendingFocusKey(`friendwall:comment:${cardClaim.slotIndex}`);
            return;
        }
        if (wallCommentsController.state.commentsPostClaim?.armed) {
            if (wallRestricted) {
                return;
            }
            setPendingFocusKey("friendwall:post");
        }
    }, [
        wallCommentsController.state.commentsCardClaim,
        wallCommentsController.state.commentsPostClaim
    ]);

    useEffect(() => {
        const cardClaim = aotwCommentsController.state.commentsCardClaim;
        if (cardClaim?.armed) {
            setPendingFocusKey(`aotw:comment:${cardClaim.slotIndex}`);
            return;
        }
        if (aotwCommentsController.state.commentsPostClaim?.armed) {
            setPendingFocusKey("aotw:comments:post");
        }
    }, [
        aotwCommentsController.state.commentsCardClaim,
        aotwCommentsController.state.commentsPostClaim
    ]);

    const [modalEchoArmed, setModalEchoArmed] = useState(() => consumeModalCloseArm());
    useEffect(() => {
        if (!modalEchoArmed) {
            return;
        }
        const timer = window.setTimeout(() => {
            setModalEchoArmed(false);
        }, MODAL_ECHO_WINDOW_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [modalEchoArmed]);

    useEffect(() => {
        const root = rootRef.current;
        const win = root?.ownerDocument.defaultView;
        if (!root || !win) {
            return;
        }
        const wake = () => {
            root.dispatchEvent(new win.FocusEvent("focusin", { bubbles: true }));
        };
        wake();
        const timer = window.setTimeout(() => {
            if (root.ownerDocument.querySelectorAll('[class*="gpfocus"]').length > 0) {
                return;
            }
            wake();
        }, 200);
        return () => {
            window.clearTimeout(timer);
        };
    }, []);

    const [mainStripClaim, setMainStripClaim] = useState<{ token: number; armed: boolean } | null>(null);
    const mainStripClaimedRef = useRef(false);
    const spendMainStripClaim = useCallback(() => {
        setMainStripClaim((current) => (current?.armed ? { ...current, armed: false } : current));
    }, []);
    useLayoutEffect(() => {
        if (mainStripClaimedRef.current) {
            return;
        }
        if (!settingsLoaded || settingsMode || bootCatPreview) {
            return;
        }
        if (loading || saving) {
            return;
        }
        mainStripClaimedRef.current = true;
        if (view !== "achievements" || nowPlayingCommentsClaimedRef.current) {
            logFocusDebug(
                "strip-claim",
                "action:quickmenu",
                `stood down view=${view} tab=${mainTab} comments=${nowPlayingCommentsClaimedRef.current}`
            );
            return;
        }
        logFocusDebug("strip-claim", "action:quickmenu", `claiming tab=${mainTab}`);
        setMainStripClaim({ token: 1, armed: true });
    }, [settingsLoaded, loading, saving]);

    useEffect(() => {
        if (!mainStripClaim?.armed) {
            return;
        }
        setPendingFocusKey("action:quickmenu");
    }, [mainStripClaim]);

    const cardClaimToken = gameOverviewController.state.commentsCardClaim?.token ?? 0;
    const cardClaimSlot = gameOverviewController.state.commentsCardClaim?.slotIndex ?? -1;

    // Comment and note openers
    useEffect(() => {
        if (cardClaimToken <= 0) {
            return;
        }
        const doc = rootRef.current?.ownerDocument;
        if (!doc) {
            return;
        }
        const countRings = () => doc.querySelectorAll('[class*="gpfocus"]').length;
        const before = countRings();
        let settled = -1;
        const settleTimer = window.setTimeout(() => {
            settled = countRings();
        }, 200);
        const lateTimer = window.setTimeout(() => {
            const active = doc.activeElement as HTMLElement | null;
            const landed = active?.closest?.("[data-focus-key]")?.getAttribute("data-focus-key");
            const wanted = `gameoverview:comment:${cardClaimSlot}`;
            const target = rootRef.current?.querySelector(`[data-focus-key="${wanted}"]`) as HTMLElement | null;
            const box = target?.getBoundingClientRect();
            const where = box
                ? `${Math.round(box.top)}..${Math.round(box.bottom)}/${doc.documentElement.clientHeight}`
                : "(gone)";
            const ringOnTarget = Boolean(
                target && (target.matches('[class*="gpfocus"]') || target.querySelector('[class*="gpfocus"]'))
            );
            logFocusDebug(
                "restore-paint",
                landed ?? "(none)",
                `rings ${before}->${settled}->${countRings()} onTarget=${ringOnTarget} box=${where} wanted=${wanted}`
            );
        }, 600);
        return () => {
            window.clearTimeout(settleTimer);
            window.clearTimeout(lateTimer);
        };
    }, [cardClaimToken, cardClaimSlot]);

    useEffect(() => {
        const orphans = drainOpenModals();
        if (orphans.length === 0) {
            return;
        }
        const timer = window.setTimeout(() => {
            for (const entry of orphans) {
                entry.close();
                if (entry.needsMarkSeen) {
                    void notif.markSeen();
                }
            }
        }, MODAL_REAP_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, []);

    function openCommentModal(
        comment: AotwComment | GameComment,
        externalUrl: string | null,
        source?: SavedCommentSourceInput
    ) {
        const onOpenExternal = externalUrl
            ? async () => {
                const dropped = clearCommentsSnapshot();
                if (dropped) {
                    putCommentsPostReturn(dropped.surfaceKey, dropped.threadId, dropped.ulid);
                }
                const opened = await openExternalUrl(externalUrl);
                if (!opened) {
                    handleOpenUserProfile(comment.user, comment.ulid);
                }
            }
            : undefined;

        let saveControl: CommentSaveControl | undefined;
        if (source) {
            const matchKey = matchKeyForComment(comment, source);
            if (matchKey) {
                const payload = buildSaveCommentPayload(comment, source);
                saveControl = {
                    saved: savedCommentsController.isSavedByMatchKey(matchKey),
                    onSave: () => savedCommentsController.saveComment(payload),
                    onUnsave: (id?: string) => {
                        const target = id ?? savedCommentsController.savedIdForMatchKey(matchKey);
                        return target ? savedCommentsController.unsaveComment(target) : Promise.resolve(false);
                    }
                };
            }
        }

        showManagedModal((close) => (
            <CommentViewModal
                comment={comment}
                language={language}
                close={close}
                onOpenExternal={onOpenExternal}
                saveControl={saveControl}
                controllerGlyphStyle={controllerGlyphStyle}
                mouseKeyboardMode={mouseKeyboardMode}
            />
        ));
    }

    const handleOpenSavedComment = (record: SavedComment) => {
        const source: SavedCommentSourceInput = {
            kind: record.source.kind,
            gameId: record.source.gameId,
            gameTitle: record.source.gameTitle,
            gameImageIcon: record.source.gameImageIcon,
            achievementId: record.source.achievementId,
            achievementTitle: record.source.achievementTitle,
            achievementImageIcon: record.source.achievementImageIcon,
            achievementBadgeName: record.source.achievementBadgeName,
            wallUser: record.source.wallUser
        };
        let url: string | null = null;
        if (record.source.kind === "game" && record.source.gameId != null) {
            url = raGameCommentsUrl(record.source.gameId);
        }
        else if (record.source.kind === "achievement" && record.source.achievementId != null) {
            url = raAchievementCommentsUrl(record.source.achievementId);
        }
        else if (record.source.kind === "userWall" && record.source.wallUser) {
            url = raUserCommentsUrl(record.source.wallUser);
        }
        savedCommentsController.markOpened(record.id);
        openCommentModal(record, url, source);
    };

    const openSavedFilterPicker = () => {
        showManagedModal((close) => (
            <SavedCommentsFilterModal
                games={savedCommentsController.savedGames}
                selected={savedCommentsFilter}
                language={language}
                showIcons={showIcons}
                onSelect={(filter) => updateSavedCommentsPrefs({
                    filter: typeof filter === "number" ? String(filter) : filter
                })}
                close={close}
            />
        ));
    };

    const openGameNoteModal = (existing: GameNote | null) => {
        markNextValidationSkipped();

        const saveNote = (input: {
            title: string;
            body: string;
            tag: string | null;
            color: NoteColor;
            reminderMode: "off" | "once" | "every";
            reminderEveryMinutes: number | null;
            reminderEveryValue: number | null;
            reminderEveryUnit: "minutes" | "hours" | "days" | null;
            resetReminderTimer: boolean;
        }) => gameNotesActions.onSaveGameNote(existing?.id ?? null, input);

        const deleteNote = existing === null
            ? null
            : () => gameNotesActions.onDeleteGameNote(existing.id);

        const toggleCompleted = existing === null
            ? null
            : (completed: boolean) => gameNotesActions.onToggleCompleted(existing.id, completed);

        showManagedModal((close) => (
            <GameNoteEditModal
                existing={existing}
                tagVocabulary={gameNotesState.tagVocabulary}
                saveNote={saveNote}
                deleteNote={deleteNote}
                toggleCompleted={toggleCompleted}
                close={close}
                language={language}
                defaultNoteColor={defaultNoteColor}
                setDefaultNoteColor={setDefaultNoteColor}
            />
        ));
    };

    // Game data
    const { refreshGameData } = useGameDataController({
        mountedRef,
        payloadRef,
        setPayload,
        setLoadingText,
        username,
        hasApiKey,
        autoRefresh,
        language,
        setLoading,
        setError,
        setCheckingGame,
        setSettingsMode,
        setSettingsLoaded,
        setPendingPrimaryViewRestoreGameId,
        setTrackedValidating,
        loading,
        payload,
        viewRef,
        rememberLastPageRef,
        loadSettingsAndCache,
        buildResumeState
    });

    useEffect(() => {
        function onVisibilityChange() {
            if (document.visibilityState !== "visible") {
                return;
            }
            if (viewRef.current !== "achievements") {
                return;
            }
            setAchievementsResumeToken((current) => current + 1);
        }

        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, []);

    async function loadSettingsAndCache() {
        setError(null);
        setFriendsError(null);
        const [settings, cached, cachedFriends, savedResume] = await Promise.all([
            getSettings(),
            getCachedPayload(),
            getCachedFriends(),
            getResumeState()
        ]);
        if (!mountedRef.current) {
            return null;
        }

        const nextUsername = settings.username;
        const nextHasApiKey = Boolean(settings.hasApiKey);
        const nextAutoRefresh = settings.autoRefresh;
        const nextShowIcons = settings.showIcons;
        const nextShowAllAchievements = settings.showAllAchievements;
        const nextUnlockLookbackMinutes = settings.unlockLookbackMinutes;
        const nextRememberLastPage = settings.rememberLastPage;
        const nextUiSize = settings.uiSize;
        const nextTopPadding = settings.topPadding;
        const nextBlockPadding = settings.blockPadding;
        const nextButtonSpacing = settings.buttonSpacing;
        const nextShowAButtonMode = settings.showAButtonMode;
        const nextMainAchievementAction = settings.mainAchievementAction;
        const nextTrackedAchievementAction = settings.trackedAchievementAction;
        const nextTrackedSetAButtonMode = settings.trackedSetAButtonMode;
        const nextFriendRefreshDelayMs = settings.friendRefreshDelayMs;
        setAccurateAvatarDebug(settings.debugLogging);
        const nextPayload = cached?.payload ?? null;
        const nextFriendsPayload = cachedFriends?.payload ?? null;
        let nextResumeState = nextRememberLastPage ? (savedResume?.resumeState ?? null) : null;
        nextResumeState = consumePendingRouteOverrides(nextResumeState);
        const bootView = computeBootView(nextResumeState, nextPayload);

        const ownRef = String(settings.activeUlid || "").trim();
        function resumeOverviewRef(viewedUsername: string | null | undefined, viewedUserRef: string | null | undefined) {
            return viewedUsername ? (viewedUserRef || viewedUsername) : ownRef;
        }
        let nextGoResumeProvisional: FriendGamePayload | null = null;
        let nextAoResumeProvisional: FriendGamePayload | null = null;
        if (bootView === "gameOverview") {
            const goRef = resumeOverviewRef(nextResumeState?.gameOverviewViewedUsername, nextResumeState?.gameOverviewViewedUserRef);
            if (goRef) {
                nextGoResumeProvisional = await getCachedFriendGame(goRef, nextResumeState?.gameOverviewGameId ?? null);
                if (!mountedRef.current) {
                    return null;
                }
            }
        }
        else if (bootView === "achievementOverview") {
            const aoRef = resumeOverviewRef(nextResumeState?.aoViewedUsername, nextResumeState?.aoViewedUserRef);
            if (aoRef) {
                nextAoResumeProvisional = await getCachedFriendGame(aoRef, nextResumeState?.aoGameId ?? null);
                if (!mountedRef.current) {
                    return null;
                }
            }
        }

        applySettings(settings, {});
        if (bootView === "friendGame") {
            skipFriendTabResetRef.current = true;
        }
        if (bootView !== "achievements") {
            resumeViewFlipRef.current = true;
        }
        restoreNav(getSavedNavStack(nextResumeState), bootView);
        if (
            bootView === "trackedSetOpen"
            || ((bootView === "gameOverview" || bootView === "achievementOverview")
                && nextResumeState?.gameOverviewSource === "trackedSet")
        ) {
            setTrackedSetOpenId(nextResumeState?.trackedSetOpenId ?? null);
        }
        if (bootView === "gameNotes") {
            setGameNotesGameId(nextResumeState?.gameNotesGameId ?? null);
        }
        if (bootView === "achievements" && nextRememberLastPage && nextResumeState) {
            setMainTab(getSavedMainAchievementsTab(nextResumeState));
        }
        if (bootView === "guides" && nextResumeState) {
            guidesActions.enterFromResume(
                getSavedGuidesSubView(nextResumeState),
                nextResumeState.guidesFaqId ?? null
            );
        }
        setPayload(nextPayload);
        initializeResumeFromBoot(nextResumeState, nextPayload, bootView);
        setGoResumeProvisional(nextGoResumeProvisional);
        setAoResumeProvisional(nextAoResumeProvisional);
        setFriendsPayload(nextFriendsPayload);
        setFriendsLoaded(true);
        setSettingsMode(!nextUsername.trim() || !nextHasApiKey);
        setSettingsLoaded(true);

        return {
            username: nextUsername,
            hasApiKey: nextHasApiKey,
            autoRefresh: nextAutoRefresh,
            showIcons: nextShowIcons,
            showAllAchievements: nextShowAllAchievements,
            unlockLookbackMinutes: nextUnlockLookbackMinutes,
            rememberLastPage: nextRememberLastPage,
            uiSize: nextUiSize,
            topPadding: nextTopPadding,
            blockPadding: nextBlockPadding,
            buttonSpacing: nextButtonSpacing,
            showAButtonMode: nextShowAButtonMode,
            mainAchievementAction: nextMainAchievementAction,
            trackedAchievementAction: nextTrackedAchievementAction,
            trackedSetAButtonMode: nextTrackedSetAButtonMode,
            payload: nextPayload,
            friendRefreshDelayMs: nextFriendRefreshDelayMs,
            resumeState: nextRememberLastPage ? (savedResume?.resumeState ?? null) : null
        };
    }

    async function runClearWithSpinner(
        focusKey: string,
        setSpinner: (busy: boolean) => void,
        errorLabel: string,
        fallbackMessage: string,
        work: () => Promise<void>
    ) {
        setSpinner(true);
        setError(null);
        setFriendsError(null);
        setFriendGameError(null);

        try {
            await work();
        } catch (e: any) {
            logError(errorLabel, e);
            if (mountedRef.current) {
                setError(String(e?.message || e || fallbackMessage));
            }
        } finally {
            if (mountedRef.current) {
                setSpinner(false);
                window.setTimeout(() => {
                    if (!mountedRef.current) {
                        return;
                    }
                    setPendingFocusKey(focusKey);
                }, 0);
            }
        }
    }

    async function runDestructiveAction(
        focusKey: string,
        errorLabel: string,
        fallbackMessage: string,
        work: () => Promise<void>
    ) {
        setError(null);
        try {
            await work();
        } catch (e: any) {
            logError(errorLabel, e);
            if (mountedRef.current) {
                setError(String(e?.message || e || fallbackMessage));
            }
        } finally {
            if (mountedRef.current) {
                window.setTimeout(() => {
                    if (!mountedRef.current) {
                        return;
                    }
                    setPendingFocusKey(focusKey);
                }, 0);
            }
        }
    }

    async function onSimulateNoGame() {
        setError(null);
        try {
            const result = await clearCurrentGame();
            if (!mountedRef.current) {
                return;
            }
            await clearResumeState();
            if (!mountedRef.current) {
                return;
            }
            setPayload(result.payload ?? null);
        } catch (e: any) {
            logError("onSimulateNoGame", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Couldn't wipe the loaded game."));
        }
    }

    // Navigation
    function onPreviewBootCat() {
        setBootCatLine(BOOT_CAT_LINES[Math.floor(Math.random() * BOOT_CAT_LINES.length)]);
        setBootCatPreview(true);
        setTimeout(() => {
            if (mountedRef.current) {
                setBootCatPreview(false);
            }
        }, 4000);
    }

    async function onManualRefreshFriends() {
        await runClearWithSpinner(
            "options:manual-refresh-friends",
            setRefreshingFriends,
            "onManualRefreshFriends",
            "Couldn't refresh your friends list.",
            async () => {
                const result = await manualRefreshFriends();
                if (mountedRef.current && result?.error) {
                    setError(result.error);
                }
            }
        );
    }

    async function onDeepRosterRefresh() {
        await runClearWithSpinner(
            "options:deep-roster-refresh",
            setDeepRefreshingFriends,
            "onDeepRosterRefresh",
            "Couldn't start the deep roster refresh.",
            async () => {
                const result = await deepRefreshFriends();
                if (!mountedRef.current) {
                    return;
                }
                if (result?.error) {
                    setError(result.error);
                    return;
                }
            }
        );
    }

    async function onClearAllTrackedSets() {
        await runDestructiveAction(
            "options:delete-all-tracked-sets",
            "onClearAllTrackedSets",
            "Couldn't delete tracked sets.",
            async () => {
                await clearAllTrackedSetsAction();
            }
        );
    }

    async function onClearDolphinMappings() {
        await runDestructiveAction(
            "options:clear-dolphin-mappings",
            "onClearDolphinMappings",
            "Couldn't clear the mappings.",
            async () => {
                await clearDolphinMappings();
            }
        );
    }

    async function onResetDolphinMappings() {
        await runDestructiveAction(
            "options:reset-dolphin-mappings",
            "onResetDolphinMappings",
            "Couldn't reset the mappings.",
            async () => {
                await resetDolphinMappings();
            }
        );
    }

    async function onCleanupDirectory() {
        await runDestructiveAction(
            "options:cleanup-directory",
            "onCleanupDirectory",
            "Couldn't clean up the directory.",
            async () => {
                await cleanupUserDirectories();
            }
        );
    }

    async function onUpdateCheevoCheckReferenceData() {
        await runDestructiveAction(
            "options:update-cheevo-check-reference-data",
            "onUpdateCheevoCheckReferenceData",
            "Couldn't update the dump lists.",
            async () => {
                await updateCheevoCheckReferenceData();
            }
        );
    }

    async function onClearGuideCache() {
        await runDestructiveAction(
            "options:clear-guide-cache",
            "onClearGuideCache",
            "Couldn't clear guide cache.",
            async () => {
                await clearGuideCache();
            }
        );
    }

    async function onDeleteAllGuideData() {
        await runDestructiveAction(
            "options:delete-all-guide-data",
            "onDeleteAllGuideData",
            "Couldn't delete guide data.",
            async () => {
                await clearAllGuideData();
            }
        );
    }

    async function onDeleteAllNotes() {
        await runDestructiveAction(
            "options:delete-all-notes",
            "onDeleteAllNotes",
            "Couldn't delete notes.",
            async () => {
                await deleteAllNotes();
            }
        );
    }

    async function onDeleteAllNotifications() {
        await runDestructiveAction(
            "options:delete-all-notifications",
            "onDeleteAllNotifications",
            "Couldn't delete notifications.",
            async () => {
                await clearAllNotifications();
            }
        );
    }

    async function onClearArchivedNotifications() {
        await runDestructiveAction(
            "options:clear-archived-posts",
            "onClearArchivedNotifications",
            "Couldn't clear archived posts.",
            async () => {
                await clearArchivedNotifications();
            }
        );
    }

    async function onClearSavedComments() {
        await runDestructiveAction(
            "options:clear-saved-comments",
            "onClearSavedComments",
            "Couldn't clear saved comments.",
            async () => {
                await clearSavedComments();
                savedCommentsController.resetAfterClear();
            }
        );
    }

    function goToAchievements(focusKey = "action:friends") {
        navIntentRef.current = "root";
        friendRowRefreshRunIdRef.current += 1;
        friendGameSessionRefreshKeysRef.current = new Set();

        if (viewRef.current !== "achievements") {
            setAchievementsResumeToken((current) => current + 1);
        }

        setView("achievements");
        setPendingFocusKey(focusKey);
    }

    function goToFriends() {
        friendGameReturnGameIdRef.current = null;
        friendGameSessionRefreshKeysRef.current = new Set();
        friendsRefreshedThisSessionRef.current = false;
        resetFriendEntryRefreshTracking();
        friendsRefreshBusyRef.current = false;
        setFriendsRefreshing(false);
        if (socialEntryDefault === "lastUsed") {
            setSocialEntryViewOverride(null);
        } else {
            setSocialEntryViewOverride(socialEntryDefault);
        }
        setSocialEntryToken((current) => current + 1);
        goToFriendsBase();
    }

    function goToComparePicker() {
        setView("comparePicker");
        setPendingFocusKey("comparepicker:back");
    }

    function backFromComparePicker() {
        navIntentRef.current = "back";
        setMainTab("compare");
        setView("achievements");
        setPendingFocusKey("main:tab:compare");
    }

    function goToOptions(focusKey?: string) {
        friendGameSessionRefreshKeysRef.current = new Set();
        setLastOptionsTab("system");
        void saveLastOptionsTab("system").catch(() => {
        });
        setQuickMenuShortcutRefused(null);
        setView("options");
        setPendingFocusKey(focusKey ?? "options:back");
    }

    function goToUnlockHistory() {
        friendGameSessionRefreshKeysRef.current = new Set();
        setUnlockHistorySource("main");
        setView("unlockHistory");
        setPendingFocusKey("unlockhistory:back");
    }

    function goToGuides() {
        setGuidesResumeTarget(null);
        guidesActions.goToList();
        setView("guides");
        setPendingFocusKey("guides:back");
    }

    function friendUsernameFromRefs(): string | null | undefined {
        return (
            selectedFriendRef.current?.username
            || friendGamePayloadRef.current?.friendUsername
            || selectedFriend?.username
        );
    }

    function goToFriendUnlockHistory() {
        unlockHistoryReturnFriendRef.current = {
            username: friendUsernameFromRefs() || null,
            gameId:
                friendGamePayloadRef.current?.selectedGameId ??
                friendGamePayloadRef.current?.payload?.gameId ??
                friendGameReturnGameIdRef.current ??
                null,
            source: friendGameSourceRef.current
        };
        setUnlockHistorySource("friendGame");
        setView("unlockHistory");
        setPendingFocusKey("unlockhistory:back");
    }

    function goToFriendCompare() {
        friendCompareReturnFriendRef.current = {
            username: friendUsernameFromRefs() || null,
            gameId:
                friendGamePayloadRef.current?.selectedGameId ??
                friendGamePayloadRef.current?.payload?.gameId ??
                friendGameReturnGameIdRef.current ??
                null,
            source: friendGameSourceRef.current
        };
        setView("friendCompare");
        setPendingFocusKey("friendcompare:back");
    }

    async function routeBackToFriendContext(
        friendUsername: string,
        focusKey: string,
        fallbackFocusKey = "action:friends",
        returnTo?: { gameId: number | null; source: FriendGameSource }
    ) {
        const payloadUsername = String(friendGamePayloadRef.current?.friendUsername || "").trim();
        const payloadStillLoaded =
            friendGamePayloadRef.current != null &&
            payloadUsername.toLowerCase() === friendUsername.toLowerCase();
        if (friendUsername && payloadStillLoaded) {
            if (returnTo) {
                setFriendGameSource(returnTo.source);
            }
            setView("friendGame");
            setPendingFocusKey(focusKey);
            return;
        }

        if (friendUsername) {
            const friendGameId =
                returnTo?.gameId ??
                friendGamePayloadRef.current?.selectedGameId ??
                friendGameReturnGameIdRef.current ??
                friendGamePayloadRef.current?.payload?.gameId ??
                null;
            if (returnTo) {
                setFriendGameSource(returnTo.source);
            }
            await loadFriendGame(
                { username: friendUsername } as FriendRow,
                friendGameId,
                true,
                focusKey,
                false,
                "back"
            );
            return;
        }

        goToAchievements(fallbackFocusKey);
    }

    async function backFromFriendUnlockHistory() {
        navIntentRef.current = "back";
        const friendUsername = String(unlockHistoryReturnFriendRef.current.username || friendUsernameFromRefs() || "").trim();
        const returnSource = unlockHistoryReturnFriendRef.current.source || friendGameSourceRef.current;
        setUnlockHistorySource("main");
        await routeBackToFriendContext(
            friendUsername,
            "friendquick:tab:history",
            "quick:tab:history",
            { gameId: unlockHistoryReturnFriendRef.current.gameId, source: returnSource }
        );
    }

    async function backFromFriendCompare() {
        navIntentRef.current = "back";
        const friendUsername = String(friendCompareReturnFriendRef.current.username || friendUsernameFromRefs() || "").trim();
        const returnSource = friendCompareReturnFriendRef.current.source || friendGameSourceRef.current;
        await routeBackToFriendContext(
            friendUsername,
            "friendquick:tab:compare",
            "action:friends",
            { gameId: friendCompareReturnFriendRef.current.gameId, source: returnSource }
        );
    }

    async function backFromBadges() {
        navIntentRef.current = "back";
        const friendUsername = String(friendUsernameFromRefs() || "").trim();
        await routeBackToFriendContext(friendUsername, "friendprofile:tab:awards");
    }

    async function backFromWantToPlay() {
        navIntentRef.current = "back";
        const friendUsername = String(friendUsernameFromRefs() || "").trim();
        await routeBackToFriendContext(friendUsername, "friendprofile:tab:wanttoplay");
    }

    function backFromAllGames() {
        navIntentRef.current = "back";
        if (!selectedFriend) {
            return;
        }
        setFriendGameSource("allGames");
        const returnGameId =
            friendGamePayloadRef.current?.selectedGameId ?? friendGameReturnGameIdRef.current ?? null;
        setFriendGameSelectionMode(returnGameId != null ? "explicit" : "auto");
        return loadFriendGame(selectedFriend, returnGameId, true, "friendgame:games");
    }

    function backFromFriendProfile() {
        navIntentRef.current = "back";
        const trailSays = previousView(nav.stack);
        const trailWouldSay = trailSays === "achievements" ? "main" : "social";
        logNavDebug(
            trailWouldSay === friendProfileBackSourceRef.current ? "backsource-agree" : "backsource-DISAGREE",
            "friendGame",
            `ref=${friendProfileBackSourceRef.current} trail=${trailSays ?? "(none)"} would=${trailWouldSay} depth=${nav.stack.length} ${describeStack(nav.stack)}`
        );
        if (friendProfileBackSourceRef.current === "main") {
            friendProfileBackSourceRef.current = "social";
            goToAchievements("action:profilestrip");
            return;
        }
        routeBackToSocialTab(null, "social:back");
    }

    function goToFollowedRanking() {
        setView("followedRanking");
        setPendingFocusKey("followedranking:back");
    }

    function goToTrackedSets() {
        setTrackedSetOpenId(null);
        armTrackedSetsFullCheck();
        setView("trackedSets");
        setPendingFocusKey("trackedsets:back");
    }

    async function removeTrackedSetAndRoute(setId: string): Promise<boolean> {
        const wasOpenSet = view === "trackedSetOpen" && trackedSetOpenId === setId;
        const removed = await removeTrackedSetAction(setId);
        if (removed && wasOpenSet) {
            closeTrackedSet();
            setView("trackedSets");
            setPendingFocusKey("trackedsets:back");
        }
        return removed;
    }

    function closeTrackedSetToSelector() {
        navIntentRef.current = "back";
        closeTrackedSet();
        setView("trackedSets");
        setPendingFocusKey("trackedsets:back");
    }

    async function backFromTrackedSets() {
        navIntentRef.current = "back";
        if (trackedSetsBackSourceRef.current === "main") {
            trackedSetsBackSourceRef.current = "profile";
            goToAchievements("action:quickmenu");
            return;
        }

        const friendUsername = String(friendUsernameFromRefs() || username || "").trim();
        await routeBackToFriendContext(friendUsername, "friendprofile:tab:trackedsets");
    }

    async function backFromFollowedRanking() {
        navIntentRef.current = "back";
        const friendUsername = String(friendUsernameFromRefs() || "").trim();
        await routeBackToFriendContext(friendUsername, "friendprofile:tab:ranking");
    }

    function goToAbout() {
        friendGameSessionRefreshKeysRef.current = new Set();
        setView("about");
        setPendingFocusKey("about:back");
    }

    function goToUtils() {
        friendGameSessionRefreshKeysRef.current = new Set();
        setView("utils");
        setPendingFocusKey("utils:back");
    }

    function backFromUtils() {
        navIntentRef.current = "back";
        goToAchievements();
    }

    function goToDolphinMapper() {
        friendGameSessionRefreshKeysRef.current = new Set();
        setView("dolphinMapper");
        setPendingFocusKey("dolphinMapper:back");
    }

    function goToSmbShares() {
        friendGameSessionRefreshKeysRef.current = new Set();
        setView("smbShares");
        setPendingFocusKey("smbShares:back");
    }

    function goToCheevoCheck() {
        friendGameSessionRefreshKeysRef.current = new Set();
        setView("cheevoCheck");
        setPendingFocusKey("cheevocheck:back");
    }

    function goToFileWatcher() {
        friendGameSessionRefreshKeysRef.current = new Set();
        setView("fileWatcher");
        setPendingFocusKey("fileWatcher:back");
    }

    function backFromUtilityTool() {
        navIntentRef.current = "back";
        if (previousView(nav.stack) === "utils") {
            goToUtils();
            return;
        }

        goToAchievements("action:quickmenu");
    }

    function goToGameNotes(focusKeyAfter?: string) {
        friendGameSessionRefreshKeysRef.current = new Set();
        setGameNotesGameId(null);
        gameNotesActions.clearReorderSelection();
        setView("gameNotes");
        setPendingFocusKey(focusKeyAfter ?? "gn:back");
    }

    function backFromGameNotes() {
        navIntentRef.current = "back";
        gameNotesActions.clearReorderSelection();
        goToAchievements();
    }

    // Deep links
    const goToGameOverview = useCallback(
        (targetGameId: number, source: GameOverviewSource, viewedUsername: string | null, viewedUserRef: string | null, subView: GameOverviewSubView = "achievements") => {
            setGameOverviewGameId(targetGameId);
            setGameOverviewSource(source);
            setGameOverviewViewedUsername(viewedUsername);
            setGameOverviewViewedUserRef(viewedUserRef);
            setGameOverviewSubView(subView);
            setView("gameOverview");
            setPendingFocusKey("gameoverview:back");
        },
        []
    );

    function openGameSearch(backSource: GameOverviewSource = "search", navIntent?: NavIntent) {
        markNextValidationSkipped();
        showManagedModal((close) => (
            <GameSearchModal
                language={language}
                showIcons={showIcons}
                onPick={(game) => {
                    pendingSearchGameId = game.gameId;
                    pendingSearchBackSource = backSource;
                    close();
                    if (navIntent) {
                        navIntentRef.current = navIntent;
                    }
                    goToGameOverview(game.gameId, backSource, null, null);
                }}
                close={close}
            />
        ));
    }

    function openFriendGamesSearch() {
        const friend = selectedFriendRef.current || selectedFriend;
        if (!friend) {
            return;
        }
        const rows = friendAllGamesPayloadRef.current?.results ?? [];
        showManagedModal((close) => (
            <FriendGamesSearchModal
                language={language}
                showIcons={showIcons}
                games={rows}
                onPick={(gameId) => {
                    pendingFriendGameSearch = {
                        username: friend.username,
                        ulid: friend.ulid ?? null,
                        gameId
                    };
                    friendGameReturnGameIdRef.current = gameId;
                    setFriendGameSource("allGames");
                    setFriendGameSelectionMode("explicit");
                    close();
                    void loadFriendGame(friend, gameId, false, "friendgame:games");
                }}
                close={close}
            />
        ));
    }
    const notificationNav: NotificationNav = {
        openGameNotes: (gameId, _noteId) => {
            pendingNoteReminderGameId = gameId;
            setGameNotesGameId(gameId);
            setView("gameNotes");
            setPendingFocusKey("gn:back");
        },
        openGameOverview: (gameId, viewedUsername, viewedUserRef) => {
            const viewedName = viewedUsername ?? null;
            const viewedRef = viewedUserRef ?? null;
            pendingNotificationGame = { gameId, viewedUsername: viewedName, viewedUserRef: viewedRef };
            goToGameOverview(gameId, "main", viewedName, viewedRef);
        },
        openAchievementOverview: (gameId, achievementId, viewedUsername, viewedUserRef) => {
            const friend = viewedUsername ?? null;
            const friendRef = viewedUserRef ?? null;
            pendingNotificationAchievement = { gameId, achievementId, viewedUsername: friend, viewedUserRef: friendRef };
            setAoAchievementId(achievementId);
            setAoGameId(gameId);
            setAoSource("notification");
            setAoViewedUsername(friend);
            setAoViewedUserRef(friendRef);
            setAoSnapshot(notificationAoSnapshot(achievementId));
            setView("achievementOverview");
            setPendingFocusKey("ao:back");
        },
        openTrackedSet: (setId) => {
            pendingTrackedSetOpenId = setId;
            trackedSetsBackSourceRef.current = "main";
            setTrackedSetOpenId(setId);
            setView("trackedSetOpen");
            setPendingFocusKey("trackedsetopen:back");
        },
        openCheevoCheck: () => {
            pendingNotificationCheevoCheck = true;
            navIntentRef.current = "hub";
            goToCheevoCheck();
        },
        openFileWatcher: () => {
            pendingNotificationFileWatcher = true;
            navIntentRef.current = "hub";
            goToFileWatcher();
        },
        openMessage: (body: string) => {
            showManagedModal((close) => (
                <TextViewerModal
                    language={language}
                    mouseKeyboardMode={mouseKeyboardMode}
                    title={t(language, "Message from FAILINATOR5000")}
                    text={body}
                    close={close}
                />
            ));
        },
        openChangelog: (body: string) => {
            showManagedModal((close) => (
                <TextViewerModal
                    language={language}
                    mouseKeyboardMode={mouseKeyboardMode}
                    title={t(language, "What's New in CheevoDeck")}
                    text={body}
                    close={close}
                />
            ));
        },
        openAbout: () => {
            pendingNotificationAbout = true;
            navIntentRef.current = "hub";
            goToAbout();
        },
        openExternalUrl: (url) => {
            void openExternalUrl(url);
        },
        openMultipath: (ctx) => {
            const options: MultipathOption[] = [];
            if (ctx.kind === "bucketA") {
                if (ctx.achievementId != null) {
                    const achievementId = ctx.achievementId;
                    options.push({
                        label: t(language, "View Achievement Info"),
                        icon: { kind: "badge", gameId: ctx.gameId, badgeName: ctx.badgeName ?? "" },
                        onSelect: () => notificationNav.openAchievementOverview?.(
                            ctx.gameId,
                            achievementId,
                            ctx.username,
                            ctx.ulid
                        )
                    });
                }
                options.push({
                    label: t(language, "View Game Info"),
                    icon: { kind: "game", gameId: ctx.gameId, imageIcon: ctx.gameImageIcon ?? null },
                    onSelect: () => notificationNav.openGameOverview?.(
                        ctx.gameId,
                        ctx.username,
                        ctx.ulid
                    )
                });
                options.push({
                    label: t(language, "View User Profile"),
                    icon: { kind: "avatar", username: ctx.username },
                    onSelect: () => {
                        void openNotificationProfile(ctx.username, ctx.ulid ?? null);
                    }
                });
            }
            else {
                options.push({
                    label: t(language, "View/Post"),
                    icon: { kind: "avatar", username: ctx.username },
                    onSelect: () => {
                        if (ctx.comment) {
                            openCommentModal(ctx.comment, ctx.externalUrl, ctx.commentSource);
                        }
                        else if (ctx.externalUrl) {
                            void openExternalUrl(ctx.externalUrl);
                        }
                    }
                });
                options.push({
                    label: t(language, "View User Profile"),
                    icon: { kind: "avatar", username: ctx.username },
                    onSelect: () => {
                        void openNotificationProfile(ctx.username, ctx.ulid ?? null);
                    }
                });
            }

            showManagedModal((close) => (
                <NotificationsMultipathModal
                    options={options}
                    showIcons={showIcons}
                    language={language}
                    close={close}
                />
            ));
        }
    };

    function openNotificationsModal() {
        showManagedModal(
            (close) => (
                <NotificationsModal
                    initialNotifications={notif.notifications}
                    seenAtSnapshot={notif.lastSeenAt}
                    language={language}
                    showIcons={showIcons}
                    nav={notificationNav}
                    close={close}
                />
            ),
            { needsMarkSeen: true, onClose: () => { void notif.markSeen(); } }
        );
    }

    function routeBackToSocialTab(entryOverride: SocialView | null, focusKey: string) {
        setSocialEntryViewOverride(entryOverride);
        setSocialEntryToken((current) => current + 1);
        setView("social");
        setPendingFocusKey(focusKey);
    }

    function goToSocialNews() {
        setNewsEventsSubView("news");
        routeBackToSocialTab("newsEvents", "social:back");
    }
    function goToSocialAotw() {
        setNewsEventsSubView("aotw");
        routeBackToSocialTab("newsEvents", "social:back");
    }
    function goToSocialNewSets() {
        setNewsEventsSubView("newSets");
        routeBackToSocialTab("newsEvents", "social:back");
    }
    function goToSocialSubscribed() {
        updateSavedCommentsPrefs({ subTab: "subscribed" });
        routeBackToSocialTab("subscribedDiscussions", "social:back");
    }
    function goToSocialSavedComments() {
        updateSavedCommentsPrefs({ subTab: "savedComments" });
        routeBackToSocialTab("subscribedDiscussions", "social:back");
    }
    function goToSocialActivity() {
        routeBackToSocialTab("activity", "social:back");
    }

    function backFromGameOverview() {
        navIntentRef.current = "back";
        const source = gameOverviewSourceRef.current ?? "main";
        if (source === "main" || source === "search") {
            goToAchievements();
            return;
        }
        if (source === "trackedSet") {
            logFocusDebug("go-back-trackedset", "trackedsetopen:back");
            setView("trackedSetOpen");
            setPendingFocusKey("trackedsetopen:back");
            return;
        }
        if (source === "cheevoCheck") {
            setView("cheevoCheck");
            setPendingFocusKey("cheevocheck:back");
            return;
        }
        if (source === "badges") {
            const friendRow = selectedFriendRef.current || selectedFriend || null;
            const friendRef =
                (friendRow ? userRefFor(friendRow) : "") ||
                String(friendGamePayloadRef.current?.friendUsername || "").trim();
            const needsReload = friendRef && (!userAwardsPayload || userAwardsError);
            if (needsReload) {
                void loadUserAwards(friendRef, friendRow?.ulid ?? "");
                return;
            }
            setView("badges");
            setPendingFocusKey("badges:back");
            return;
        }
        if (source === "wantToPlay") {
            const friendRow = selectedFriendRef.current || selectedFriend || null;
            const friendRef =
                (friendRow ? userRefFor(friendRow) : "") ||
                String(friendGamePayloadRef.current?.friendUsername || "").trim();
            const needsReload = friendRef && (!wantToPlayPayload || wantToPlayError);
            if (needsReload) {
                pendingResumeFocusKeyRef.current = "wanttoplay:back";
                void loadUserWantToPlay(friendRef, friendRow?.ulid ?? "");
                return;
            }
            setView("wantToPlay");
            setPendingFocusKey("wanttoplay:back");
            return;
        }
        if (source === "mainNowPlaying") {
            setView("achievements");
            setPendingFocusKey("main:tab:activity");
            return;
        }
        if (source === "socialActivity") {
            routeBackToSocialTab(null, "social:back");
            return;
        }
        if (source === "subscribedDiscussions") {
            routeBackToSocialTab("subscribedDiscussions", "social:tab:subscribeddiscussions");
            return;
        }
        if (source === "friend") {
            if (friendEntrySourceRef.current === "compareGame") {
                setView("friendCompare");
                setPendingFocusKey("friendcompare:back");
                return;
            }
            setView("friendGame");
            setPendingFocusKey("friendgame:back");
            return;
        }
        if (source === "newsEvents") {
            routeBackToSocialTab("newsEvents", "social:tab:newsEvents");
            return;
        }
        goToAchievements();
    }

    const goToAchievementOverview = useCallback(
        (achievement: AchievementRow, parentGameId: number | null, source: AOSource, viewedUsername: string | null, viewedUserRef: string | null) => {
            const snapshot: AchievementOverviewSnapshot = {
                id: achievement.id,
                title: achievement.title,
                description: achievement.description,
                points: achievement.points,
                badgeName: String(achievement.badgeName || "").trim(),
                imageIcon: achievement.badgeUrl ?? null,
                isLocked: !achievement.dateEarned,
                dateEarned: achievement.dateEarned ?? null,
                dateEarnedHardcore: achievement.dateEarnedHardcore ?? null
            };
            setAoAchievementId(achievement.id);
            setAoGameId(parentGameId);
            setAoSource(source);
            setAoViewedUsername(viewedUsername);
            setAoViewedUserRef(viewedUserRef);
            setAoSnapshot(snapshot);
            setView("achievementOverview");
            setPendingFocusKey("ao:back");
        },
        []
    );

    // Game artwork
    useEffect(() => {
        goToAchievementOverviewRef.current = goToAchievementOverview;
    }, [goToAchievementOverview]);

    function backFromAchievementOverview() {
        navIntentRef.current = "back";
        const source = aoSourceRef.current ?? "main";
        if (source === "gameOverview") {
            setView("gameOverview");
            setPendingFocusKey("gameoverview:back");
            return;
        }
        if (source === "tracked") {
            setView("tracked");
            setPendingFocusKey("tracked:tab:thisGame");
            return;
        }
        if (source === "unlockHistory") {
            setView("unlockHistory");
            setPendingFocusKey("unlockhistory:back");
            return;
        }
        if (source === "mainNowPlaying") {
            setView("achievements");
            setPendingFocusKey("main:tab:activity");
            return;
        }
        if (source === "socialActivity") {
            routeBackToSocialTab(null, "social:back");
            return;
        }
        if (source === "newsEvents") {
            routeBackToSocialTab("newsEvents", "social:tab:newsEvents");
            return;
        }
        if (source === "subscribedDiscussions") {
            routeBackToSocialTab("subscribedDiscussions", "social:tab:subscribeddiscussions");
            return;
        }
        if (source === "friend") {
            if (friendEntrySourceRef.current === "compareGame") {
                setView("friendCompare");
                setPendingFocusKey("friendcompare:back");
                return;
            }
            setView("friendGame");
            setPendingFocusKey("friendgame:back");
            return;
        }
        goToAchievements();
    }

    const gameIconGameId = payload?.gameId ?? null;
    const gameIconImageIcon = payload?.imageIcon ?? null;

    useEffect(() => {
        if (!showIcons || !gameIconGameId) {
            setGameIconDataUri(null);
            return;
        }
        return loadCachedImage(
            () => getCachedGameIconDataUri(gameIconGameId),
            () => getGameIconCached(gameIconGameId, gameIconImageIcon),
            (dataUri, fromFetch) => {
                if (!fromFetch) {
                    gameIconColdRef.current = dataUri === null;
                }
                setGameIconDataUri(dataUri);
            },
            "getGameIconCached"
        );
    }, [gameIconGameId, gameIconImageIcon, showIcons, imageRefreshKey]);

    useEffect(() => {
        if (!showIcons || gameNotesGameId == null) {
            setNotesGameIconDataUri(null);
            return;
        }
        return loadCachedImage(
            () => getCachedGameIconDataUri(gameNotesGameId),
            () => getGameIconCached(gameNotesGameId, null),
            (dataUri, fromFetch) => {
                if (!fromFetch) {
                    notesGameIconColdRef.current = dataUri === null;
                }
                setNotesGameIconDataUri(dataUri);
            },
            "getGameIconCached (notes route)"
        );
    }, [gameNotesGameId, showIcons, imageRefreshKey]);

    const gameIngameImageUrl = payload?.imageIngame ?? null;

    useEffect(() => {
        if (!showIcons || !gameIconGameId) {
            setGameIngameDataUri(null);
            return;
        }
        return loadCachedImage(
            () => getCachedGameImageDataUri(gameIconGameId, "ingame"),
            () => getGameImageCached(gameIconGameId, "ingame", gameIngameImageUrl),
            (dataUri, fromFetch) => {
                if (!fromFetch) {
                    gameIngameColdRef.current = dataUri === null;
                }
                setGameIngameDataUri(dataUri);
            },
            "getGameImageCached (ingame)"
        );
    }, [gameIconGameId, gameIngameImageUrl, showIcons, imageRefreshKey]);

    useEffect(() => {
        if (gameIconDataUri) {
            gameIconColdRef.current = false;
        }
        if (notesGameIconDataUri) {
            notesGameIconColdRef.current = false;
        }
        if (gameIngameDataUri) {
            gameIngameColdRef.current = false;
        }
    }, [gameIconDataUri, notesGameIconDataUri, gameIngameDataUri]);

    useEffect(() => {
        if (settingsLoaded) {
            setShowBootSpinner(false);
            return;
        }
        const timer = setTimeout(() => {
            setBootCatLine(BOOT_CAT_LINES[Math.floor(Math.random() * BOOT_CAT_LINES.length)]);
            setShowBootSpinner(true);
        }, 1500);
        return () => {
            clearTimeout(timer);
        };
    }, [settingsLoaded]);

    // Derived state
    const panelOverlayVisible = loading || clearingAllCache || Boolean(friendProfileOverlayText);

    let loadingOrSetup: ReactNode = null;
    const bootCatPanel = (
        <PanelSection key={`achievements:menu:${focusScopeResetToken}`}>
            <PanelSectionRow>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "10px",
                        paddingTop: "4px"
                    }}
                >
                    <img
                        src={BOOT_CAT_IMAGE}
                        alt="Meemee"
                        style={{
                            width: "auto",
                            height: "190px",
                            maxWidth: "100%",
                            borderRadius: "10px",
                            display: "block"
                        }}
                    />
                    <InlineSpinner label={t(language, bootCatLine)} bold />
                </div>
            </PanelSectionRow>
        </PanelSection>
    );
    if (bootCatPreview) {
        loadingOrSetup = bootCatPanel;
    }
    else if (!settingsLoaded) {
        loadingOrSetup = showBootSpinner ? bootCatPanel : (
            <PanelSection key={`achievements:menu:${focusScopeResetToken}`} />
        );
    }
    else if (settingsMode) {
        loadingOrSetup = (
            <SetupPage
                language={language}
                buttonSpacing={buttonSpacing}
                hasApiKey={hasApiKey}
                saving={saving}
                error={error}
                onEditCredentials={openCredentialsModal}
                onClearApiKey={onClearApiKey}
            />
        );
    }

    const nowPlayingSlice: NowPlayingProps = {
        currentPayload: payload,
        showIcons,
        blockPadding,
        compareFriendUsername,
        compareFriendRow,
        compareFilter,
        compareLoading,
        compareError,
        comparePayload,
        subView: nowPlayingSubView,
        onOpenComparePicker: goToComparePicker,
        onChangeCompareFilter: setCompareFilter,
        onAchievementClick: async (achievement: AchievementRow) => {
            setError(null);
            if (legacyAchievementLinks) {
                await openExternalUrl(raAchievementUrl(achievement.id));
                return;
            }
            goToAchievementOverview(
                achievement,
                payload?.gameId ?? null,
                "mainNowPlaying",
                null,
                null
            );
        },
        onActivityClick: (event: SocialActivityEvent) =>
            handleActivityCardClick(event, "mainNowPlaying", mouseKeyboardMode ? undefined : "achievement"),
        onRetryCompareData: () => {
            void refreshCompareData();
        },
        comments: nowPlayingComments,
        commentsLoading: nowPlayingCommentsLoading,
        commentsLoadingMore: nowPlayingCommentsLoadingMore,
        commentsError: nowPlayingCommentsError,
        commentsHasMore: nowPlayingCommentsHasMore,
        commentsSort: nowPlayingCommentsSort,
        commentsNeedsSettings: nowPlayingCommentsNeedsSettings,
        commentsLoaded: nowPlayingCommentsLoaded,
        onChangeCommentsSort: setNowPlayingCommentsSort,
        onLoadMoreComments: loadMoreNowPlayingComments,
        onCommentClick: (comment) => {
            const gid = payload?.gameId ?? null;
            const url = gid != null
                ? raGameCommentsUrl(gid)
                : null;
            const captured = gid == null
                ? null
                : nowPlayingController.actions.captureComments(comment);
            if (gid != null && captured) {
                const geometry = measureCommentWindow(
                    rootRef.current,
                    "nowplaying:comment",
                    captured.focusIndex
                );
                putCommentsSnapshot({
                    surfaceKey: "comments:nowplaying",
                    threadId: gid,
                    ulid: activeUlid,
                    ...captured,
                    windowStart: geometry?.windowStart ?? 0,
                    spacerPx: geometry?.spacerPx ?? 0
                });
            }
            else {
                logCommentsDebug(
                    "press-nocapture",
                    gid ?? "null",
                    `surface=comments:nowplaying gid=${gid ?? "null"}`
                );
                clearCommentsSnapshot();
            }
            openCommentModal(comment, url, gameCommentSource(gid, payload?.title, payload?.imageIcon));
        },
        onPostComment: async () => {
            const gid = payload?.gameId ?? null;
            if (gid == null) {
                return;
            }
            setError(null);
            clearCommentsSnapshot();
            putCommentsPostReturn("comments:nowplaying", gid, activeUlid);
            await openExternalUrl(raGameCommentsUrl(gid));
        },
        showRetroPoints
    };

    const handlePlayersNearYouTapModeChange = (next: PlayersNearYouTapMode) => {
        setPlayersNearYouTapMode(next);
        void savePlayersNearYouTapMode(next);
    };

    const handlePlayersNearYouCollapsedChange = (next: boolean) => {
        setPlayersNearYouCollapsed(next);
        void savePlayersNearYouCollapsed(next);
    };

    const handlePlayersNearYouModeChange = (next: PlayersNearYouMode) => {
        setPlayersNearYouMode(next);
        void savePlayersNearYouMode(playersNearYouGameId, next);
    };

    const handleDolphinAdvancedCollapsedChange = (next: boolean) => {
        setDolphinAdvancedCollapsed(next);
        void saveDolphinAdvancedCollapsed(next);
    };

    const handleDolphinSystemFilterChange = (next: DolphinSystemFilter) => {
        setDolphinSystemFilter(next);
        void saveDolphinSystemFilter(next);
    };

    const nowPlayingBodyProps: NowPlayingTabBodyProps = {
        language,
        uiSize,
        achievementStyle,
        activityEvents: nowPlayingActivityFeed,
        friendsByUsername,
        dynamicActivityFeed,
        dynamicCompare,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin: Math.max(0, dynamicSentinelRootMargin ?? 600),
        dynamicComments,
        dynamicCommentsSentinelRootMargin,
        playersNearYouItems: playersNearYouFeed,
        playersNearYouCheckedGameId,
        playersNearYouEnabled,
        playersNearYouTapMode,
        onPlayersNearYouClick: (item: PlayersNearYouItem) =>
            handlePlayersNearYouClick(item, mouseKeyboardMode ? undefined : "achievement"),
        onChangePlayersNearYouTapMode: handlePlayersNearYouTapModeChange,
        playersNearYouCollapsed,
        onChangePlayersNearYouCollapsed: handlePlayersNearYouCollapsedChange,
        playersNearYouMode,
        onChangePlayersNearYouMode: handlePlayersNearYouModeChange,
        friendFeedCardAction,
        onCycleFriendFeedCardAction: optionsActions.onCycleFriendFeedCardAction,
        mouseKeyboardMode,
        controllerGlyphStyle,
        onPlayersNearYouSecondary: (item: PlayersNearYouItem) => handlePlayersNearYouClick(item, "game"),
        onPlayersNearYouTertiary: (item: PlayersNearYouItem) => handlePlayersNearYouClick(item, "profile"),
        onFriendFeedCardSecondary: (event: SocialActivityEvent) => {
            void handleActivityCardClick(event, "mainNowPlaying", "game");
        },
        onFriendFeedCardTertiary: (event: SocialActivityEvent) => {
            void handleActivityCardClick(event, "mainNowPlaying", "profile");
        },
        ...nowPlayingSlice,
        commentsCardClaim: nowPlayingController.state.commentsCardClaim ?? undefined,
        onSpendCommentsCardClaim: nowPlayingController.actions.spendCommentsCardClaim,
        commentsPostClaim: nowPlayingController.state.commentsPostClaim ?? undefined,
        onSpendCommentsPostClaim: nowPlayingController.actions.spendCommentsPostClaim,
        holdCommentsBody: nowPlayingHoldCommentsBody,
        restorePending: nowPlayingRestoreArmedRef.current,
        commentsWindow: nowPlayingController.state.commentsWindow
    };

    function cancelHandlerForView(current: ViewKey): (() => void) | undefined {
        const back = backHandlerForView(current);
        if (!back) {
            return modalEchoArmed ? () => { } : undefined;
        }
        return () => {
            if (modalEchoPending()) {
                return;
            }
            back();
        };
    }

    function backHandlerForView(current: ViewKey): (() => void) | undefined {
        const back = ROUTES[current].back;
        if (!back) {
            return undefined;
        }
        const nav: RouteBackActions = {
            goToAchievements,
            backFromTracked,
            backFromFriendProfile,
            backFromAllGames,
            backFromFriendCompare,
            backToLeaderboardsSource,
            backToLeaderboardsList,
            backFromUnlockHistory,
            backFromBadges,
            backFromAbout: aboutActions.onBack,
            backFromOptions: optionsActions.onBack,
            backFromComparePicker,
            backFromGameNotes,
            backFromGameOverview,
            backFromAchievementOverview,
            backFromWantToPlay,
            backFromFollowedRanking,
            backFromTrackedSets,
            closeTrackedSetToSelector,
            backFromUtils,
            backFromUtilityTool
        };
        return () => {
            playOkSound();
            void back(nav);
        };
    }

    function jumpToTopOfPage() {
        if (view === "guides" && guidesSubViewRef.current !== "list") {
            return;
        }
        playOkSound();
        if (view === "achievements") {
            setMainStripClaim((current) => ({
                token: (current?.token ?? 0) + 1,
                armed: true
            }));
            requestJumpToTop();
            return;
        }
        setPendingFocusKey(defaultPersistedFocusKeyForView(view));
        requestJumpToTop();
    }

    function runShortcutAction(action: ShortcutAction) {
        if (action === "pageUp") {
            jumpToTopOfPage();
            return;
        }
        if (action === "home") {
            if (view === "achievements") {
                jumpToTopOfPage();
                return;
            }
            playOkSound();
            goToAchievements();
            return;
        }
        if (action === "snapshot") {
            void captureSnapshot(language);
            return;
        }

        playOkSound();

        if (action === "refresh") {
            void refreshGameData(true, false, t(language, "Refreshing Achievements..."));
            return;
        }
        if (action === "nightMode") {
            toggleNightMode(!nightMode);
            return;
        }
        if (action === "doNotDisturb") {
            toggleDoNotDisturb(!doNotDisturb);
            return;
        }
        if (action === "mouseKeyboardMode") {
            toggleMouseKeyboardMode(!mouseKeyboardMode);
            return;
        }
        if (action === "cycleUiScale") {
            void optionsActions.onCycleScalePreset();
            return;
        }
        if (action === "currentGuide") {
            void pressQuickGuide("hub");
            return;
        }
        if (action === "search") {
            openGameSearch("search", "hub");
            return;
        }
        if (action === "visitRa") {
            void openExternalUrl(raHomeUrl());
            return;
        }

        navIntentRef.current = "hub";
        if (action === "notifications") {
            openNotificationsModal();
            return;
        }
        if (action === "profile") {
            goToOwnProfile();
            return;
        }
        if (action === "socialhub") {
            goToFriends();
            return;
        }
        if (action === "news") {
            goToSocialNews();
            return;
        }
        if (action === "aotw") {
            goToSocialAotw();
            return;
        }
        if (action === "newsets") {
            goToSocialNewSets();
            return;
        }
        if (action === "subscribeddiscussions") {
            goToSocialSubscribed();
            return;
        }
        if (action === "savedcomments") {
            goToSocialSavedComments();
            return;
        }
        if (action === "trackedsets") {
            trackedSetsBackSourceRef.current = "main";
            goToTrackedSets();
            return;
        }
        if (action === "utilities") {
            goToUtils();
            return;
        }
        if (action === "useraccounts") {
            openSwitchUserModal();
            return;
        }
        if (action === "options") {
            goToOptions();
            return;
        }
        if (action === "about") {
            goToAbout();
            return;
        }
        if (action === "dolphinMapper") {
            void goToDolphinMapper();
            return;
        }
        if (action === "cheevoCheck") {
            void goToCheevoCheck();
            return;
        }
        if (action === "smbShares") {
            void goToSmbShares();
            return;
        }
        if (action === "fileWatcher") {
            void goToFileWatcher();
            return;
        }
        if (action === "socialActivity") {
            goToSocialActivity();
            return;
        }
    }

    // Render
    return (
        <NotificationsProvider
            value={{
                hasUnread: notif.hasUnread,
                doNotDisturb,
                openNotifications: openNotificationsModal
            }}
        >
            <PanelProviders view={view} language={language} settings={settingsController}>
                <div
                    ref={rootRef}
                    data-cheevodeck-root="true"
                >
                    <style>{FADE_IN_KEYFRAMES}</style>
                    <BootFocusAnchor active={bootCatPreview || !settingsLoaded} />
                    <CornerProbe key={`corner:${view}`} surface={`panel:${view}`} />
                    <LoadingOverlay
                        loading={loading || clearingAllCache}
                        overlayText={friendProfileOverlayText}
                        loadingText={!loading && clearingAllCache
                            ? t(language, "Clearing Cache...")
                            : loadingText}
                    />

                    {
}
                    <div
                        data-cheevodeck-dim="true"
                        style={{
                            filter: nightMode
                                ? `brightness(${nightModeBrightness}) saturate(0.95)`
                                : "brightness(1) saturate(1)",
                            transition: "filter 220ms ease"
                        }}
                    >
                    {loadingOrSetup ?? (
                        <Focusable
                            key={view}
                            onButtonDown={(evt: { detail?: { button?: number }; stopPropagation?: () => void }) => {
                                const code = evt?.detail?.button;
                                if (code === undefined) {
                                    return;
                                }
                                const button = SHORTCUT_BUTTON_BY_CODE[code];
                                if (!button) {
                                    return;
                                }
                                const action = shortcutBindings[button];
                                if (!action || action === "none") {
                                    return;
                                }
                                evt.stopPropagation?.();
                                runShortcutAction(action);
                            }}
                            onCancelButton={cancelHandlerForView(view)}
                        >
                            <MainAchievementsPage
                                state={{
                                    ...achievementsState,
                                    view,
                                    language,
                                    buttonSpacing,
                                    metrics,
                                    pendingFocusKey,
                                    achievementsInitialAutoFocusDone,
                                    mainEntryToken,
                                    mainStripClaim: mainStripClaim ?? undefined,
                                    mainEntryFromView,
                                    friendsPayload,
                                    saving,
                                    loading,
                                    payload,
                                    trackedIds,
                                    notesByAchievementId,
                                    notesColorByAchievementId,
                                    error,
                                    focusScopeResetToken,
                                    achievementsResumeToken,
                                    showAllAchievements,
                                    showAllToggleMain,
                                    showTrackedNotesMain,
                                    showRetroPoints,
                                    showAButtonMode,
                                    controllerGlyphStyle,
                                    showSocialHubButton,
                                    showTrackedSetsButton,
                                    showOptionsButton,
                                    quickMenuShortcuts,
                                    achievementStyle,
                                    trackedColor,
                                    mainAchievementFilter,
                                    mainAchievementSort,
                                    mainAchievementAction,
                                    socialGameTicker,
                                    socialHubTicker,
                                    showReminderTicker,
                                    ownUsername: username,
                                    showIcons,
                                    gameIconDataUri: gameIconDataUri ?? getCachedGameIconDataUri(gameIconGameId),
                                    gameIngameDataUri: gameIngameDataUri ?? getCachedGameImageDataUri(gameIconGameId, "ingame"),
                                    gameIconCold: gameIconColdRef.current,
                                    gameIngameCold: gameIngameColdRef.current,
                                    uiSize,
                                    topPadding,
                                    blockPadding,
                                    bigListThreshold,
                                    alwaysStaggerMounting,
                                    returnStaggerFrames,
                                    dynamicLoading,
                                    dynamicInitialRows,
                                    dynamicRowStep,
                                    dynamicPrefetchDistance,
                                    dynamicSentinelRootMargin,
                                    listResetToken,
                                    showNotesDot,
                                    notesPendingReminderBadge: gameNotesState.pendingReminderBadge,
                                    doNotDisturb,
                                    notificationsHasUnread: notif.hasUnread,
                                    mainTab,
                                    nightMode,
                                    batterySaver,
                                    mouseKeyboardMode,
                                    nowPlayingBody: nowPlayingBodyProps
                                }}
                                actions={{
                                    ...achievementsActions,
                                    goToFriends,
                                    onOpenProfile: goToOwnProfile,
                                    goToLeaderboards,
                                    goToOptions,
                                    goToAbout,
                                    goToUnlockHistory,
                                    goToTracked,
                                    goToTrackedSets: () => {
                                        trackedSetsBackSourceRef.current = "main";
                                        goToTrackedSets();
                                    },
                                    openUserAccounts: () => {
                                        openSwitchUserModal();
                                    },
                                    openUtils: goToUtils,
                                    goToSocialNews,
                                    goToSocialAotw,
                                    goToSocialNewSets,
                                    goToSocialSubscribed,
                                    goToSocialSavedComments,
                                    goToSocialActivity,
                                    openDolphinMapper: goToDolphinMapper,
                                    openCheevoCheck: goToCheevoCheck,
                                    openSmbShares: goToSmbShares,
                                    openFileWatcher: goToFileWatcher,
                                    openRaSite: () => { void openExternalUrl(raHomeUrl()); },
                                    onApplyMainUiPreset: optionsActions.onApplyMainUiPreset,
                                    goToGameNotes,
                                    goToGuides,
                                    onOpenNotifications: openNotificationsModal,
                                    onManualRefresh: () => refreshGameData(true, false, t(language, "Refreshing Achievements...")),
                                    onSocialActivityClick: (event: SocialActivityEvent, action?: ActivityCardAction) =>
                                        handleActivityCardClick(event, "main", action),
                                    onChangeMainTab: setMainTab,
                                    onToggleNightMode: toggleNightMode,
                                    onToggleDoNotDisturb: toggleDoNotDisturb,
                                    onToggleBatterySaver: toggleBatterySaver,
                                    onToggleMouseKeyboardMode: toggleMouseKeyboardMode,
                                    onOpenGameSearch: openGameSearch,
                                    onSpendMainStripClaim: spendMainStripClaim,
                                    onViewGameOverview: () => {
                                        const gid = payload?.gameId;
                                        if (gid != null) {
                                            goToGameOverview(gid, "main", null, null);
                                        }
                                    }
                                }}
                            />

                            <TrackedPage
                                view={view}
                                language={language}
                                focusScopeResetToken={focusScopeResetToken}
                                buttonSpacing={buttonSpacing}
                                payload={payload}
                                trackedIdsLoadedForGameId={trackedIdsLoadedForGameId}
                                trackedValidating={trackedValidating}
                                trackedAchievements={trackedAchievements}
                                notesByAchievementId={notesByAchievementId}
                                notesColorByAchievementId={notesColorByAchievementId}
                                error={error}
                                showAButtonModeTracked={showAButtonModeTracked}
                                mouseKeyboardMode={mouseKeyboardMode}
                                controllerGlyphStyle={controllerGlyphStyle}
                                showRetroPoints={showRetroPoints}
                                trackedAchievementAction={trackedAchievementAction}
                                trackedAchievementSort={perGameTrackedSort}
                                showIcons={showIcons}
                                achievementStyle={achievementStyle}
                                uiSize={uiSize}
                                topPadding={topPadding}
                                blockPadding={blockPadding}
                                dynamicInitialRows={dynamicInitialRows}
                                dynamicRowStep={dynamicRowStep}
                                dynamicPrefetchDistance={dynamicPrefetchDistance}
                                dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                                dynamicTrackedListLoading={dynamicTrackedListLoading}
                                dynamicTrackedListInitialRows={dynamicTrackedListInitialRows}
                                dynamicTrackedListRowStep={dynamicTrackedListRowStep}
                                dynamicTrackedListPrefetchDistance={dynamicTrackedListPrefetchDistance}
                                dynamicTrackedListSentinelRootMargin={dynamicTrackedListSentinelRootMargin}
                                dynamicTrackedGames={dynamicTrackedGames}
                                trackedIds={trackedIds}
                                listResetToken={listResetToken}
                                checkingGame={checkingGame}
                                activeTrackedTab={lastTrackedTab}
                                trackedSelectedGameId={trackedSelectedGameId}
                                drillIn={{
                                    ...drillInState,
                                    ...drillInActions,
                                    onReorderPick: drillInActions.onReorderSwap
                                }}
                                currentGameTrackedCount={trackedIds.length}
                                backFromTracked={backFromTracked}
                                onHome={goToAchievements}
                                onSelectTrackedTab={onSelectTrackedTab}
                                onSelectTrackedGame={onSelectTrackedGame}
                                onTrackedAchievementActionChange={saveTrackedAchievementActionWithRollback}
                                onTrackedAchievementSortChange={onTrackedSortChange}
                                onAchievementClick={onTrackedViewAchievementClick}
                                onTrackedUntrack={onTrackedUntrack}
                                onTrackedEditNote={onTrackedEditNote}
                                onTrackedReorderPick={onTrackedReorderPick}
                                onClearTrackedForGame={onClearTrackedForGame}
                                onRefreshTotalTrackedCount={refreshTotalTrackedCount}
                                onAddAllMissable={onAddAllMissable}
                                reorderTargetId={reorderTargetId}
                                reorderViaSwap={reorderViaSwap}
                                onReorderMove={onReorderMove}
                                backClaimToken={trackedBackClaimToken}
                                rowClaim={trackedRowClaim}
                            />

                            {view === "options" && <OptionsPage state={{ ...optionsState, mouseKeyboardMode }} actions={{ ...optionsActions, onHome: goToAchievements }} />}

                            <UnlockHistoryPage
                                state={{
                                    ...unlockHistoryState,
                                    view,
                                }}
                                actions={{
                                    ...unlockHistoryActions,
                                    onHome: goToAchievements,
                                }}
                            />

                            <GuidesPage
                                state={{
                                    view,
                                    focusScopeResetToken,
                                    language,
                                    buttonSpacing,
                                    showIcons,
                                    gameId: payload?.gameId ?? null,
                                    title: payload?.title ?? null,
                                    imageIcon: payload?.imageIcon ?? null,
                                    consoleName: payload?.consoleName ?? null,
                                    mouseKeyboardMode,
                                    controllerGlyphStyle,
                                    dynamicLoading,
                                    dynamicInitialRows,
                                    dynamicRowStep,
                                    dynamicPrefetchDistance,
                                    dynamicSentinelRootMargin,
                                    pinLatestGuides,
                                    keepGuidesOffline,
                                    guides: guidesState
                                }}
                                actions={{
                                    onBack: backFromGuides,
                                    onHome: goToAchievements,
                                    onTogglePinLatestGuides,
                                    onToggleKeepGuidesOffline,
                                    guides: guidesActions
                                }}
                            />

                            <AboutPage
                                state={{
                                    ...aboutState,
                                    view,
                                    backTarget: previousView(nav.stack) === "options" ? "options" : "main"
                                }}
                                actions={{
                                    ...aboutActions,
                                    onHome: goToAchievements,
                                }}
                            />

                            <UtilsPage
                                state={{
                                    view,
                                    focusScopeResetToken,
                                    language,
                                    buttonSpacing
                                }}
                                actions={{
                                    onBack: backFromUtils,
                                    onHome: goToAchievements,
                                    onOpenDolphinMapper: goToDolphinMapper,
                                    onOpenSmbShares: goToSmbShares,
                                    onOpenCheevoCheck: goToCheevoCheck,
                                    onOpenFileWatcher: goToFileWatcher
                                }}
                            />

                            <DolphinMapperPage
                                view={view}
                                language={language}
                                focusScopeResetToken={focusScopeResetToken}
                                buttonSpacing={buttonSpacing}
                                mouseKeyboardMode={mouseKeyboardMode}
                                controllerGlyphStyle={controllerGlyphStyle}
                                dolphinMapperMode={dolphinMapperMode}
                                onModeChange={saveDolphinMapperModeWithRollback}
                                dolphinBluetoothPassthrough={dolphinBluetoothPassthrough}
                                onBluetoothPassthroughChange={saveDolphinBluetoothPassthroughWithRollback}
                                dolphinContinuousScanning={dolphinContinuousScanning}
                                onContinuousScanningChange={saveDolphinContinuousScanningWithRollback}
                                dolphinBalanceBoard={dolphinBalanceBoard}
                                onBalanceBoardChange={saveDolphinBalanceBoardWithRollback}
                                advancedCollapsed={dolphinAdvancedCollapsed}
                                onAdvancedCollapsedChange={handleDolphinAdvancedCollapsedChange}
                                dolphinSystemFilter={dolphinSystemFilter}
                                onSystemFilterChange={handleDolphinSystemFilterChange}
                                onBack={backFromUtilityTool}
                                onHome={goToAchievements}
                            />

                            <SmbSharesPage
                                state={{
                                    view,
                                    focusScopeResetToken,
                                    language,
                                    buttonSpacing
                                }}
                                actions={{
                                    onBack: backFromUtilityTool,
                                    onHome: goToAchievements
                                }}
                            />

                            <CheevoCheckPage
                                state={{
                                    view,
                                    focusScopeResetToken,
                                    language,
                                    buttonSpacing,
                                    batterySaver,
                                    mouseKeyboardMode
                                }}
                                actions={{
                                    onBack: backFromUtilityTool,
                                    onHome: goToAchievements,
                                    onToggleBatterySaver: toggleBatterySaver,
                                    onBrowse: openCheevoCheckBrowseModal
                                }}
                            />

                            <FileWatcherPage
                                state={{
                                    view,
                                    focusScopeResetToken,
                                    language,
                                    buttonSpacing,
                                    dynamicAllGames,
                                    dynamicInitialRows,
                                    dynamicRowStep,
                                    dynamicPrefetchDistance,
                                    dynamicSentinelRootMargin
                                }}
                                actions={{
                                    onBack: backFromUtilityTool,
                                    onHome: goToAchievements
                                }}
                            />

                            <GameNotesPage
                                state={{
                                    view,
                                    language,
                                    buttonSpacing,
                                    uiSize,
                                    focusScopeResetToken,
                                    payload,
                                    gameNotesGameId,
                                    notes: gameNotesState.notes,
                                    sortMode: gameNotesState.sortMode,
                                    aButtonMode: gameNotesAButtonMode,
                                    reorderTargetId: gameNotesState.reorderTargetId,
                                    reorderViaSwap: gameNotesState.reorderViaSwap,
                                    validating: gameNotesState.validating,
                                    loadedForGameId: gameNotesState.loadedForGameId,
                                    dynamicLoading: dynamicGameNotesLoading,
                                    dynamicInitialRows: dynamicGameNotesInitialRows,
                                    dynamicRowStep: dynamicGameNotesRowStep,
                                    dynamicSentinelRootMargin: dynamicGameNotesSentinelRootMargin,
                                    gameIconDataUri: gameNotesGameId != null
                                        ? (notesGameIconDataUri ?? getCachedGameIconDataUri(gameNotesGameId))
                                        : (gameIconDataUri ?? getCachedGameIconDataUri(gameIconGameId)),
                                    gameIconCold: gameNotesGameId != null
                                        ? notesGameIconColdRef.current
                                        : gameIconColdRef.current,
                                    showIcons,
                                    mouseKeyboardMode,
                                    controllerGlyphStyle
                                }}
                                actions={{
                                    onBack: backFromGameNotes,
                                    onHome: goToAchievements,
                                    onAddNote: () => {
                                        gameNotesActions.clearReorderSelection();
                                        openGameNoteModal(null);
                                    },
                                    onEditNote: (note) => {
                                        gameNotesActions.clearReorderSelection();
                                        openGameNoteModal(note);
                                    },
                                    onSortModeChange: async (next) => {
                                        if (next !== "manual" && gameNotesAButtonMode === "moveNote") {
                                            void optionsActions.onSaveGameNotesAButtonMode("editNote");
                                        }
                                        return gameNotesActions.onSortModeChange(next);
                                    },
                                    onAButtonModeChange: (next) =>
                                        optionsActions.onSaveGameNotesAButtonMode(next),
                                    onReorderSwap: (pressedId, sectionIds, allowSwap) =>
                                        gameNotesActions.onReorderSwap(pressedId, sectionIds, allowSwap),
                                    onReorderMove: (direction, sectionIds) =>
                                        gameNotesActions.onReorderMove(direction, sectionIds ?? null),
                                    onCardFocused: gameNotesActions.onCardFocused
                                }}
                            />

                            <SocialHubPage
                                view={view}
                                language={language}
                                panelOverlayVisible={panelOverlayVisible}
                                focusScopeResetToken={focusScopeResetToken}
                                socialEntryToken={socialEntryToken}
                                socialEntryView={socialEntryViewOverride ?? lastSocialView}
                                savedComments={{
                                    subTab: communitySubTab,
                                    onChangeSubTab: (tab) => updateSavedCommentsPrefs({ subTab: tab }),
                                    comments: savedCommentsController.savedComments,
                                    loaded: savedCommentsController.savedCommentsLoaded,
                                    error: savedCommentsController.savedCommentsError,
                                    onOpen: handleOpenSavedComment,
                                    onTrash: async (record) => {
                                        await savedCommentsController.unsaveComment(record.id);
                                    },
                                    sort: savedCommentsSort,
                                    filter: savedCommentsFilter,
                                    games: savedCommentsController.savedGames,
                                    onCycleSort: () => updateSavedCommentsPrefs({ sort: nextSavedSort(savedCommentsSort) }),
                                    onOpenFilterPicker: openSavedFilterPicker
                                }}
                                friendsPayload={friendsPayload}
                                friendsError={friendsError}
                                friendsLoaded={friendsLoaded}
                                friendAutoRefresh={friendAutoRefresh}
                                friendsRows={friendsRows}
                                buttonSpacing={buttonSpacing}
                                uiSize={uiSize}
                                showIcons={showIcons}
                                liveRefreshingFriendUsernames={liveRefreshingFriendUsernames}
                                dynamicFriendLoading={dynamicFriendLoading}
                                dynamicActivityFeed={dynamicActivityFeed}
                                dynamicInitialRows={dynamicInitialRows}
                                dynamicRowStep={dynamicRowStep}
                                dynamicPrefetchDistance={dynamicPrefetchDistance}
                                dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                                dynamicComments={dynamicComments}
                                dynamicCommentsInitialRows={dynamicCommentsInitialRows}
                                dynamicCommentsRowStep={dynamicCommentsRowStep}
                                dynamicCommentsSentinelRootMargin={dynamicCommentsSentinelRootMargin}
                                favoriteFriends={favoriteFriends}
                                newsEvents={{
                                    ...newsEventsState,
                                    onChangeSubView: newsEventsActions.setSubView,
                                    onOpenNewsLink: async (url: string) => {
                                        setError(null);
                                        await openExternalUrl(url);
                                    },
                                    onChangeAotwSubView: newsEventsActions.setAotwSubView,
                                    onOpenUserProfile: (username: string, ulid?: string | null) =>
                                        handleOpenUserProfile(username, ulid),
                                    onOpenAotwComment: (comment, achievementId) => {
                                        const url = achievementId != null
                                            ? raAchievementCommentsUrl(achievementId)
                                            : null;
                                        const captured = achievementId == null
                                            ? null
                                            : aotwCommentsController.actions.captureComments(comment);
                                        if (achievementId != null && captured) {
                                            const geometry = measureCommentWindow(
                                                rootRef.current,
                                                "aotw:comment",
                                                captured.focusIndex
                                            );
                                            putCommentsSnapshot({
                                                surfaceKey: "comments:aotw",
                                                threadId: achievementId,
                                                ulid: activeUlid,
                                                ...captured,
                                                windowStart: geometry?.windowStart ?? 0,
                                                spacerPx: geometry?.spacerPx ?? 0
                                            });
                                            putAotwCarry(aotwResponse, activeUlid);
                                        }
                                        else {
                                            logCommentsDebug(
                                                "press-nocapture",
                                                achievementId ?? "null",
                                                `surface=comments:aotw aid=${achievementId ?? "null"}`
                                            );
                                            clearCommentsSnapshot();
                                            clearAotwCarry();
                                        }
                                        openCommentModal(comment, url);
                                    },
                                    aotwComments,
                                    aotwCommentsLoading,
                                    aotwCommentsLoadingMore,
                                    aotwCommentsError,
                                    aotwCommentsHasMore,
                                    aotwCommentsSort,
                                    aotwCommentsLoaded,
                                    aotwCommentsCardClaim: aotwCommentsController.state.commentsCardClaim ?? undefined,
                                    onSpendAotwCommentsCardClaim: aotwCommentsController.actions.spendCommentsCardClaim,
                                    aotwCommentsPostClaim: aotwCommentsController.state.commentsPostClaim ?? undefined,
                                    onSpendAotwCommentsPostClaim: aotwCommentsController.actions.spendCommentsPostClaim,
                                    aotwRestorePending,
                                    aotwHoldCommentsBody,
                                    aotwCommentsWindow: aotwCommentsController.state.commentsWindow,
                                    onChangeAotwCommentsSort: setAotwCommentsSort,
                                    onLoadMoreAotwComments: loadMoreAotwComments,
                                    onPostAotwComment: async () => {
                                        const aid = aotwResponse?.payload?.achievement?.id ?? null;
                                        if (aid == null) {
                                            return;
                                        }
                                        setError(null);
                                        clearCommentsSnapshot();
                                        putCommentsPostReturn("comments:aotw", aid, activeUlid);
                                        putAotwCarry(aotwResponse, activeUlid);
                                        await openExternalUrl(raAchievementCommentsUrl(aid));
                                    },
                                    onOpenGameOverview: async (gameId: number) => {
                                        if (legacyGameLinks) {
                                            await openExternalUrl(raGameUrl(gameId));
                                            return;
                                        }
                                        goToGameOverview(gameId, "newsEvents", null, null);
                                    },
                                    onChangeNewSetsFilter: newsEventsActions.changeNewSetsFilter,
                                    onOpenNewSetGame: async (gameId: number) => {
                                        if (legacyGameLinks) {
                                            await openExternalUrl(raGameUrl(gameId));
                                            return;
                                        }
                                        goToGameOverview(gameId, "newsEvents", null, null);
                                    }
                                }}
                                onBack={goToAchievements}
                                onHome={goToAchievements}
                                onFriendFocus={scheduleFriendPauseRefresh}
                                onFriendHover={noteFriendRowHover}
                                onFriendUnhover={clearFriendRowHover}
                                onFriendClick={(friend) => {
                                    cancelPendingFriendPauseRefresh();
                                    clearFriendRowHover(friend);
                                    friendGameReturnGameIdRef.current = null;
                                    setFriendGameSource("recentGames");
                                    setFriendGameSelectionMode("auto");
                                    friendProfileBackSourceRef.current = "social";
                                    return loadFriendGame(friend, undefined, false, "friendgame:back");
                                }}
                                onActivityCardClick={(event) => handleActivityCardClick(
                                    event,
                                    "socialActivity",
                                    mouseKeyboardMode ? undefined : "achievement"
                                )}
                                onActivityCardSecondary={(event: SocialActivityEvent) => {
                                    void handleActivityCardClick(event, "socialActivity", "game");
                                }}
                                onActivityCardTertiary={(event: SocialActivityEvent) => {
                                    void handleActivityCardClick(event, "socialActivity", "profile");
                                }}
                                socialHubCardAction={socialHubCardAction}
                                onCycleSocialHubCardAction={optionsActions.onCycleSocialHubCardAction}
                                mouseKeyboardMode={mouseKeyboardMode}
                                controllerGlyphStyle={controllerGlyphStyle}
                                onOpenSubscription={(subscription) => handleOpenSubscription(subscription)}
                                onFriendFavoriteToggle={(friend, favorite) => {
                                    if (friend.isSelf) {
                                        return;
                                    }

                                    return toggleFriendFavorite(friend.ulid ?? "", favorite);
                                }}
                                onFriendResolveAvatar={resolveFriendAvatarNow}
                                onSocialViewChange={(nextView) => {
                                    setSocialView(nextView);
                                    setLastSocialView(nextView);
                                    void saveLastSocialView(nextView).catch(() => {
                                    });
                                }}
                                onSocialTabClick={suppressFriendFocusDetectionForTabSwitch}
                            />

                            <ComparePickerPage
                                state={{
                                    view,
                                    focusScopeResetToken,
                                    language,
                                    buttonSpacing,
                                    friendsRows,
                                    favoriteFriends,
                                    friendsLoaded,
                                    friendsRefreshing,
                                    friendsError,
                                    selectedFriendUsername: compareFriendUsername,
                                    dynamicFriendPicker,
                                    dynamicInitialRows,
                                    dynamicRowStep,
                                    dynamicPrefetchDistance,
                                    dynamicSentinelRootMargin,
                                }}
                                actions={{
                                    onBack: backFromComparePicker,
                                    onHome: goToAchievements,
                                    onPickFriend: (friend) => {
                                        selectCompareFriend(friend.username);
                                        backFromComparePicker();
                                    }
                                }}
                            />

                            <LeaderboardsPage
                                state={{
                                    view,
                                    restoringLeaderboardDetail,
                                    language,
                                    buttonSpacing,
                                    leaderboardsSourceView,
                                    leaderboardsLoading,
                                    saving,
                                    checkingGame,
                                    leaderboardsPayload,
                                    leaderboardsError,
                                    showIcons,
                                    uiSize,
                                    topPadding,
                                    blockPadding,
                                    dynamicLeaderboardLoading,
                                    dynamicInitialRows,
                                    dynamicRowStep,
                                    dynamicPrefetchDistance,
                                    dynamicSentinelRootMargin,
                                }}
                                actions={{
                                    onBack: async () => {
                                        await backToLeaderboardsSource();
                                    },
                                    onHome: goToAchievements,
                                    onLeaderboardClick: openLeaderboardDetail
                                }}
                            />

                            <LeaderboardDetailPage
                                state={{
                                    view,
                                    language,
                                    selectedLeaderboard,
                                    buttonSpacing,
                                    leaderboardEntriesPayload,
                                    leaderboardEntriesLoading,
                                    leaderboardEntriesError,
                                    leaderboardUserEntryPayload,
                                    leaderboardUserEntryLoading,
                                    leaderboardUserEntryError,
                                    leaderboardAudience,
                                    dynamicLeaderboardResults,
                                    dynamicInitialRows,
                                    dynamicRowStep,
                                    dynamicPrefetchDistance,
                                    dynamicSentinelRootMargin,
                                    showIcons,
                                    uiSize,
                                    friendsByUsername,
                                    selfUsername: username,
                                }}
                                actions={{
                                    onBack: backToLeaderboardsList,
                                    onHome: goToAchievements,
                                    onAudienceChange: setLeaderboardAudience,
                                    onOpenUserProfile: onOpenLeaderboardUserProfile
                                }}
                            />

                            <AllGamesPage
                                view={view}
                                language={language}
                                selectedFriend={selectedFriend}
                                buttonSpacing={buttonSpacing}
                                showIcons={showIcons}
                                uiSize={uiSize}
                                friendAllGamesError={friendAllGamesError}
                                friendAllGamesLoading={friendAllGamesLoading}
                                friendAllGamesPayload={friendAllGamesPayload}
                                dynamicAllGames={dynamicAllGames}
                                dynamicInitialRows={dynamicInitialRows}
                                dynamicRowStep={dynamicRowStep}
                                dynamicPrefetchDistance={dynamicPrefetchDistance}
                                dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                                initialRangeKey={allGamesLetterRange}
                                initialStatusFilter={allGamesStatusFilter}
                                onRangeChange={setAllGamesLetterRange}
                                onStatusFilterChange={setAllGamesStatusFilter}
                                onBack={backFromAllGames}
                                onHome={goToAchievements}
                                onGameClick={(gameId) => {
                                    if (!selectedFriend) {
                                        return;
                                    }
                                    friendGameReturnGameIdRef.current = gameId;
                                    setFriendGameSource("allGames");
                                    setFriendGameSelectionMode("explicit");
                                    return loadFriendGame(selectedFriend, gameId, false, "friendgame:games", false, "back");
                                }}
                                onOpenGameSearch={openFriendGamesSearch}
                            />

                            <WantToPlayPage
                                view={view}
                                language={language}
                                selectedFriend={selectedFriend}
                                buttonSpacing={buttonSpacing}
                                showIcons={showIcons}
                                uiSize={uiSize}
                                wantToPlayError={wantToPlayError}
                                wantToPlayLoading={wantToPlayLoading}
                                wantToPlayPayload={wantToPlayPayload}
                                dynamicAllGames={dynamicAllGames}
                                dynamicInitialRows={dynamicInitialRows}
                                dynamicRowStep={dynamicRowStep}
                                dynamicPrefetchDistance={dynamicPrefetchDistance}
                                dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                                onBack={backFromWantToPlay}
                                onHome={goToAchievements}
                                onGameClick={(gameId) => {
                                    goToGameOverview(gameId, "wantToPlay", null, null);
                                }}
                            />

                            <FollowedRankingPage
                                view={view}
                                language={language}
                                buttonSpacing={buttonSpacing}
                                showIcons={showIcons}
                                uiSize={uiSize}
                                friendsPayload={friendsPayload}
                                metric={followedRankingMetric}
                                setMetric={setFollowedRankingMetric}
                                dynamicFollowedRanking={dynamicFollowedRanking}
                                dynamicInitialRows={dynamicInitialRows}
                                dynamicRowStep={dynamicRowStep}
                                dynamicPrefetchDistance={dynamicPrefetchDistance}
                                dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                                onBack={backFromFollowedRanking}
                                onHome={goToAchievements}
                            />

                            <TrackedSetsPage
                                {...trackedSetsState}
                                view={view}
                                language={language}
                                buttonSpacing={buttonSpacing}
                                showIcons={showIcons}
                                uiSize={uiSize}
                                dynamicTrackedSetsListLoading={dynamicTrackedSetsListLoading}
                                dynamicTrackedSetsListInitialRows={dynamicTrackedSetsListInitialRows}
                                dynamicTrackedSetsListRowStep={dynamicTrackedSetsListRowStep}
                                dynamicTrackedSetsListPrefetchDistance={dynamicTrackedSetsListPrefetchDistance}
                                dynamicTrackedSetsListSentinelRootMargin={dynamicTrackedSetsListSentinelRootMargin}
                                selectorSort={trackedSetsSelectorSort}
                                setSelectorSort={setTrackedSetsSelectorSort}
                                selectorFilter={trackedSetsSelectorFilter}
                                setSelectorFilter={setTrackedSetsSelectorFilter}
                                aButtonMode={trackedSetAButtonMode}
                                onChangeAButtonMode={saveTrackedSetAButtonModeWithRollback}
                                mouseKeyboardMode={mouseKeyboardMode}
                                controllerGlyphStyle={controllerGlyphStyle}
                                onRequestFocus={setPendingFocusKey}
                                onOpenSet={(setId) => {
                                    void trackedSetsActions.openSet(setId);
                                    setView("trackedSetOpen");
                                    setPendingFocusKey("trackedsetopen:back");
                                }}
                                onCloseSet={closeTrackedSetToSelector}
                                onChangeGameFilter={trackedSetsActions.changeGameFilter}
                                onCreateSet={trackedSetsActions.createSet}
                                onRenameSet={trackedSetsActions.renameSet}
                                onRemoveSet={removeTrackedSetAndRoute}
                                onAddGame={trackedSetsActions.addGame}
                                onRemoveGame={trackedSetsActions.removeGame}
                                onSaveGameNote={trackedSetsActions.saveGameNote}
                                onReorderGames={trackedSetsActions.reorderGames}
                                onChangeGameSort={trackedSetsActions.changeGameSort}
                                onChangeViewMode={trackedSetsActions.changeViewMode}
                                onRunCheck={trackedSetsActions.runCompletionCheck}
                                onOpenGameOverview={(gameId) => goToGameOverview(gameId, "trackedSet", null, null)}
                                onBack={backFromTrackedSets}
                                onHome={goToAchievements}
                                backToMain={trackedSetsBackSourceRef.current === "main"}
                            />

                            <BadgesPage
                                view={view}
                                username={selectedFriend?.username ?? ""}
                                language={language}
                                buttonSpacing={buttonSpacing}
                                showIcons={showIcons}
                                uiSize={uiSize}
                                awardsError={userAwardsError}
                                awardsLoading={userAwardsLoading}
                                awardsPayload={userAwardsPayload}
                                dynamicList={dynamicBadges}
                                dynamicInitialRows={dynamicInitialRows}
                                dynamicRowStep={dynamicRowStep}
                                dynamicPrefetchDistance={dynamicPrefetchDistance}
                                dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                                initialFilter={badgeFilter}
                                onFilterChange={(filter) => {
                                    setBadgeFilter(filter);
                                }}
                                sortOrder={badgesSortOrder}
                                onSortOrderChange={(order) => {
                                    setBadgesSortOrder(order);
                                    void saveBadgesSortOrder(order).catch(() => {
                                    });
                                }}
                                onBadgeClick={async (gameId) => {
                                    const viewedSelf = Boolean(selectedFriend?.isSelf);
                                    const friendUsername = viewedSelf ? null : (selectedFriend?.username ?? null);
                                    if (legacyGameLinks) {
                                        await openExternalUrl(raGameUrl(gameId));
                                        return;
                                    }
                                    goToGameOverview(gameId, "badges", friendUsername, viewedSelf ? null : (selectedFriend ? userRefFor(selectedFriend) : null));
                                }}
                                onBack={backFromBadges}
                                onHome={goToAchievements}
                            />

                            <FriendProfilePage
                                state={{
                                    view,
                                    language,
                                    focusScopeResetToken,
                                    friendGamePayload,
                                    selectedFriend,
                                    buttonSpacing,
                                    recentGamesExpanded,
                                    friendGameError,
                                    friendGameLoading,
                                    friendAllGamesLoading,
                                    wantToPlayLoading,
                                    wantToPlayError,
                                    showIcons,
                                    achievementStyle,
                                    uiSize,
                                    topPadding,
                                    blockPadding,
                                    dynamicLoading,
                                    dynamicInitialRows,
                                    dynamicRowStep,
                                    dynamicPrefetchDistance,
                                    dynamicSentinelRootMargin,
                                    listResetToken,
                                    friendAchievementFilter,
                                    friendAchievementSort,
                                    friendShowAllAchievements,
                                    showAllToggleFriend,
                                    showRetroPoints,
                                    backToMain: friendProfileBackSourceRef.current === "main",
                                    friendProfileSubView,
                                    wallComments,
                                    wallCommentsLoading,
                                    wallCommentsLoadingMore,
                                    wallCommentsHasMore,
                                    wallCommentsSort,
                                    wallCommentsLoaded,
                                    wallRestricted,
                                    wallCommentsCardClaim: wallCommentsController.state.commentsCardClaim ?? undefined,
                                    wallCommentsPostClaim: wallCommentsController.state.commentsPostClaim ?? undefined,
                                    panelOverlayVisible,
                                    wallRestorePending,
                                    wallHoldCommentsBody,
                                    wallCommentsWindow: wallCommentsController.state.commentsWindow,
                                    dynamicComments,
                                    dynamicCommentsSentinelRootMargin,
                                }}
                                actions={{
                                    onFriendAchievementFilterChange,
                                    onFriendAchievementSortChange,
                                    onFriendShowAllAchievementsChange,
                                    onBack: backFromFriendProfile,
                                    onHome: goToAchievements,
                                    onOpenLeaderboards: () => goToLeaderboards(friendGamePayload?.selectedGameId ?? null, "friendGame"),
                                    onOpenUnlockHistory: () => goToFriendUnlockHistory(),
                                    onOpenCompare: () => goToFriendCompare(),
                                    onOpenExternalProfile: async () => {
                                        if (!selectedFriend) {
                                            return;
                                        }
                                        const profileName = (friendGamePayload?.friendUsername || selectedFriend.username || "").trim();
                                        const profileUrl = raUserUrl(profileName);
                                        await openExternalUrl(profileUrl);
                                    },
                                    onOpenAllGames: () => {
                                        if (!selectedFriend) {
                                            return;
                                        }
                                        friendGameReturnGameIdRef.current =
                                            friendGamePayloadRef.current?.selectedGameId ?? friendGameReturnGameIdRef.current ?? null;
                                        setAllGamesLetterRange("a-f");
                                        void loadFriendAllGames(selectedFriend, 0, 500);
                                    },
                                    onOpenBadges: () => {
                                        if (!selectedFriend) {
                                            return;
                                        }
                                        setBadgeFilter("all");
                                        void loadUserAwards(userRefFor(selectedFriend), selectedFriend.ulid ?? "");
                                    },
                                    onOpenWantToPlay: () => {
                                        if (!selectedFriend) {
                                            return;
                                        }
                                        void loadUserWantToPlay(userRefFor(selectedFriend), selectedFriend.ulid ?? "");
                                    },
                                    onOpenFollowedRanking: () => {
                                        if (!selectedFriend?.isSelf) {
                                            return;
                                        }
                                        goToFollowedRanking();
                                    },
                                    onOpenTrackedSets: () => {
                                        if (!selectedFriend?.isSelf) {
                                            return;
                                        }
                                        trackedSetsBackSourceRef.current = "profile";
                                        goToTrackedSets();
                                    },
                                    onToggleRecentGames: () => {
                                        setFriendGameSource("recentGames");
                                        setRecentGamesExpanded((value) => !value);
                                    },
                                    onPickRecentGame: (gameId) => {
                                        if (!selectedFriend) {
                                            return;
                                        }
                                        friendGameReturnGameIdRef.current = gameId;
                                        setFriendGameSource("recentGames");
                                        setFriendGameSelectionMode("explicit");
                                        return loadFriendGame(selectedFriend, gameId, false, "friendgame:back");
                                    },
                                    onOpenAchievement: async (achievement) => {
                                        setFriendGameError(null);
                                        if (legacyAchievementLinks) {
                                            await openExternalUrl(raAchievementUrl(achievement.id));
                                            return;
                                        }
                                        friendEntrySourceRef.current = "profile";
                                        const parentGameId = friendGamePayload?.payload?.gameId ?? null;
                                        const viewedSelf = Boolean(selectedFriend?.isSelf);
                                        goToAchievementOverview(
                                            achievement,
                                            parentGameId,
                                            "friend",
                                            viewedSelf ? null : (selectedFriend?.username ?? friendGamePayload?.friendUsername ?? null),
                                            viewedSelf ? null : (selectedFriend ? userRefFor(selectedFriend) : (friendGamePayload?.friendUsername ?? null))
                                        );
                                    },
                                    onOpenGameOnRetroAchievements: async () => {
                                        const gameId = friendGamePayload?.payload?.gameId ?? null;
                                        if (!gameId) {
                                            return;
                                        }
                                        setFriendGameError(null);
                                        if (legacyGameLinks) {
                                            await openExternalUrl(raGameUrl(gameId));
                                            return;
                                        }
                                        friendEntrySourceRef.current = "profile";
                                        const viewedSelf = Boolean(selectedFriend?.isSelf);
                                        goToGameOverview(
                                            gameId,
                                            "friend",
                                            viewedSelf ? null : (selectedFriend?.username ?? friendGamePayload?.friendUsername ?? null),
                                            viewedSelf ? null : (selectedFriend ? userRefFor(selectedFriend) : (friendGamePayload?.friendUsername ?? null))
                                        );
                                    },
                                    onChangeSubView: setFriendProfileSubView,
                                    onChangeWallCommentsSort: setWallCommentsSort,
                                    onLoadMoreWallComments: loadMoreWallComments,
                                    onSpendWallCommentsCardClaim: wallCommentsController.actions.spendCommentsCardClaim,
                                    onSpendWallCommentsPostClaim: wallCommentsController.actions.spendCommentsPostClaim,
                                    onWallCommentClick: (comment) => {
                                        const wallUser =
                                            friendGamePayload?.friendUsername ??
                                            selectedFriend?.username ??
                                            null;
                                        const url = wallUser
                                            ? raUserCommentsUrl(wallUser)
                                            : null;
                                        const captured = wallThreadId == null
                                            ? null
                                            : wallCommentsController.actions.captureComments(comment);
                                        if (wallThreadId != null && captured) {
                                            const geometry = measureCommentWindow(
                                                rootRef.current,
                                                "friendwall:comment",
                                                captured.focusIndex
                                            );
                                            putCommentsSnapshot({
                                                surfaceKey: "comments:wall",
                                                threadId: wallThreadId,
                                                ulid: activeUlid,
                                                ...captured,
                                                windowStart: geometry?.windowStart ?? 0,
                                                spacerPx: geometry?.spacerPx ?? 0
                                            });
                                        }
                                        else {
                                            logCommentsDebug(
                                                "press-nocapture",
                                                wallThreadId ?? "null",
                                                `surface=comments:wall ref=${wallThreadId ?? "null"}`
                                            );
                                            clearCommentsSnapshot();
                                        }
                                        openCommentModal(comment, url, wallCommentSource(wallUser));
                                    },
                                    onPostComment: async () => {
                                        const wallUser =
                                            friendGamePayload?.friendUsername ??
                                            selectedFriend?.username ??
                                            null;
                                        if (!wallUser) {
                                            return;
                                        }
                                        setFriendGameError(null);
                                        clearCommentsSnapshot();
                                        if (wallThreadId != null) {
                                            putCommentsPostReturn("comments:wall", wallThreadId, activeUlid);
                                        }
                                        await openExternalUrl(raUserCommentsUrl(wallUser));
                                    }
                                }}
                            />

                            <FriendCompareGamePage
                                state={{
                                    view,
                                    focusScopeResetToken,
                                    language,
                                    buttonSpacing,
                                    selectedFriend,
                                    friendGamePayload,
                                    friendGameLoading,
                                    showIcons,
                                    achievementStyle,
                                    uiSize,
                                    blockPadding,
                                    dynamicCompare,
                                    dynamicInitialRows,
                                    dynamicRowStep,
                                    dynamicPrefetchDistance,
                                    dynamicSentinelRootMargin,
                                    showRetroPoints,
                                }}
                                actions={{
                                    onBack: backFromFriendCompare,
                                    onHome: goToAchievements,
                                    onAchievementClick: async (achievement) => {
                                        setFriendGameError(null);
                                        if (legacyAchievementLinks) {
                                            await openExternalUrl(raAchievementUrl(achievement.id));
                                            return;
                                        }
                                        friendEntrySourceRef.current = "compareGame";
                                        const parentGameId = friendGamePayload?.payload?.gameId ?? null;
                                        goToAchievementOverview(
                                            achievement,
                                            parentGameId,
                                            "friend",
                                            selectedFriend?.username ?? friendGamePayload?.friendUsername ?? null,
                                            selectedFriend ? userRefFor(selectedFriend) : (friendGamePayload?.friendUsername ?? null)
                                        );
                                    }
                                }}
                            />

                            {view === "gameOverview" && (
                                <GameOverviewPage
                                    {...goState}
                                    view={view}
                                    language={language}
                                    uiSize={uiSize}
                                    blockPadding={blockPadding}
                                    buttonSpacing={buttonSpacing}
                                    showIcons={showIcons}
                                    showRetroPoints={showRetroPoints}
                                    achievementStyle={achievementStyle}
                                    viewedUsername={viewingBannerUsernameFor(gameOverviewViewedUsername, gameOverviewViewedUserRef)}
                                    gameId={gameOverviewGameId}
                                    subView={gameOverviewSubView}
                                    onChangeSubView={setGameOverviewSubView}
                                    onBack={backFromGameOverview}
                                    onHome={goToAchievements}
                                    commentsCardClaim={goState.commentsCardClaim ?? undefined}
                                    onSpendCommentsCardClaim={goActions.spendCommentsCardClaim}
                                    commentsPostClaim={goState.commentsPostClaim ?? undefined}
                                    onSpendCommentsPostClaim={goActions.spendCommentsPostClaim}
                                    restorePending={gameOverviewRestorePending}
                                    holdCommentsBody={gameOverviewHoldCommentsBody}
                                    panelOverlayVisible={panelOverlayVisible}
                                    onChangeCommentsSort={goActions.setCommentsSort}
                                    onLoadMoreComments={goActions.loadMoreComments}
                                    onDownloadHashPatch={goActions.downloadHashPatch}
                                    onCommentClick={(comment) => {
                                        const gid = gameOverviewGameIdRef.current ?? gameOverviewGameId;
                                        const url = gid != null
                                            ? raGameCommentsUrl(gid)
                                            : null;
                                        const captured = gid == null
                                            ? null
                                            : goActions.captureComments(comment);
                                        if (gid != null && captured) {
                                            const geometry = measureCommentWindow(
                                                rootRef.current,
                                                "gameoverview:comment",
                                                captured.focusIndex
                                            );
                                            putCommentsSnapshot({
                                                surfaceKey: "comments:overview",
                                                threadId: gid,
                                                ulid: activeUlid,
                                                ...captured,
                                                windowStart: geometry?.windowStart ?? 0,
                                                spacerPx: geometry?.spacerPx ?? 0
                                            });
                                        }
                                        else {
                                            logCommentsDebug(
                                                "press-nocapture",
                                                gid ?? "null",
                                                `surface=comments:overview gid=${gid ?? "null"}`
                                            );
                                            clearCommentsSnapshot();
                                        }
                                        openCommentModal(comment, url, gameCommentSource(gid, goState.loadedPayload?.title, goState.loadedPayload?.imageIcon));
                                    }}
                                    onPostComment={async () => {
                                        const gid = gameOverviewGameIdRef.current ?? gameOverviewGameId;
                                        if (gid == null) {
                                            return;
                                        }
                                        setError(null);
                                        clearCommentsSnapshot();
                                        putCommentsPostReturn("comments:overview", gid, activeUlid);
                                        await openExternalUrl(raGameCommentsUrl(gid));
                                    }}
                                    onAchievementClick={async (achievement) => {
                                        const gid = gameOverviewGameIdRef.current ?? gameOverviewGameId;
                                        if (legacyAchievementLinks) {
                                            await openExternalUrl(raAchievementUrl(achievement.id));
                                            return;
                                        }
                                        goToAchievementOverview(achievement, gid, "gameOverview", gameOverviewViewedUsernameRef.current, gameOverviewViewedUserRefRef.current);
                                    }}
                                    onGameClick={async () => {
                                        const gid = gameOverviewGameIdRef.current ?? gameOverviewGameId;
                                        if (gid == null) {
                                            return;
                                        }
                                        await openExternalUrl(raGameUrl(gid));
                                    }}
                                    onOpenGameSearch={() => openGameSearch(gameOverviewSourceRef.current ?? "main")}
                                    onOpenLeaderboards={() => goToLeaderboards(gameOverviewGameIdRef.current ?? gameOverviewGameId, "gameOverview")}
                                    dynamicComments={dynamicComments}
                                    dynamicCommentsSentinelRootMargin={dynamicCommentsSentinelRootMargin}
                                />
                            )}

                            {view === "achievementOverview" && (
                                <AchievementOverviewPage
                                    {...aoState}
                                    view={view}
                                    language={language}
                                    uiSize={uiSize}
                                    blockPadding={blockPadding}
                                    buttonSpacing={buttonSpacing}
                                    showIcons={showIcons}
                                    showRetroPoints={showRetroPoints}
                                    achievementStyle={achievementStyle}
                                    viewedUsername={viewingBannerUsernameFor(aoViewedUsername, aoViewedUserRef)}
                                    achievementId={aoAchievementId}
                                    achievementSnapshot={aoSnapshot}
                                    gameId={aoGameId}
                                    onBack={backFromAchievementOverview}
                                    onHome={goToAchievements}
                                    commentsCardClaim={aoState.commentsCardClaim ?? undefined}
                                    onSpendCommentsCardClaim={aoActions.spendCommentsCardClaim}
                                    commentsPostClaim={aoState.commentsPostClaim ?? undefined}
                                    onSpendCommentsPostClaim={aoActions.spendCommentsPostClaim}
                                    restorePending={aoRestorePending}
                                    holdCommentsBody={aoHoldCommentsBody}
                                    panelOverlayVisible={panelOverlayVisible}
                                    commentsWindow={aoState.commentsWindow}
                                    onChangeCommentsSort={aoActions.setCommentsSort}
                                    onLoadMoreComments={aoActions.loadMoreComments}
                                    onCommentClick={(comment) => {
                                        const aid = aoAchievementIdRef.current ?? aoAchievementId;
                                        const url = aid != null
                                            ? raAchievementCommentsUrl(aid)
                                            : null;
                                        const captured = aid == null
                                            ? null
                                            : aoActions.captureComments(comment);
                                        if (aid != null && captured) {
                                            const geometry = measureCommentWindow(
                                                rootRef.current,
                                                "ao:comment",
                                                captured.focusIndex
                                            );
                                            putCommentsSnapshot({
                                                surfaceKey: "comments:ao",
                                                threadId: aid,
                                                ulid: activeUlid,
                                                ...captured,
                                                windowStart: geometry?.windowStart ?? 0,
                                                spacerPx: geometry?.spacerPx ?? 0
                                            });
                                        }
                                        else {
                                            logCommentsDebug(
                                                "press-nocapture",
                                                aid ?? "null",
                                                `surface=comments:ao aid=${aid ?? "null"}`
                                            );
                                            clearCommentsSnapshot();
                                        }
                                        openCommentModal(comment, url, achievementCommentSource(
                                            aid,
                                            aoSnapshot?.title,
                                            aoSnapshot?.imageIcon,
                                            aoSnapshot?.badgeName,
                                            aoGameIdRef.current ?? aoGameId,
                                            aoState.loadedPayload?.title,
                                            aoState.loadedPayload?.imageIcon
                                        ));
                                    }}
                                    onPostComment={async () => {
                                        const aid = aoAchievementIdRef.current ?? aoAchievementId;
                                        if (aid == null) {
                                            return;
                                        }
                                        setError(null);
                                        clearCommentsSnapshot();
                                        putCommentsPostReturn("comments:ao", aid, activeUlid);
                                        await openExternalUrl(raAchievementCommentsUrl(aid));
                                    }}
                                    onAchievementClick={async () => {
                                        const aid = aoAchievementIdRef.current ?? aoAchievementId;
                                        if (aid == null) {
                                            return;
                                        }
                                        await openExternalUrl(raAchievementUrl(aid));
                                    }}
                                    dynamicComments={dynamicComments}
                                    dynamicCommentsSentinelRootMargin={dynamicCommentsSentinelRootMargin}
                                />
                            )}
                        </Focusable>
                    )}
                    </div>
                </div>
            </PanelProviders>
        </NotificationsProvider>
    );
}

export default AchievementsRoot;
