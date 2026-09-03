import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { Fragment, useState, type ComponentType } from "react";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ErrorText } from "../components/ui/ErrorText";
import { InfoText } from "../components/ui/InfoText";
import {
    OptionButton,
    OptionConfirm,
    OptionToggle,
    OptionTripleConfirm,
    OptionValueRow
} from "../components/options/OptionRows";
import { SectionTitle } from "../components/ui/SectionTitle";
import { ButtonGlyph } from "../components/ui/ButtonGlyph";
import { ButtonHints } from "../components/ui/ButtonHints";
import { logFocusDebug } from "../api";
import {
    LANGUAGES,
    t,
    type LanguageCode
} from "../locales";
import type { AchievementStyle, ActivityCardAction, ButtonSpacing, ControllerGlyphStyle, OptionsTab, Payload, QuickMenuShortcut, SavedUser, ScalePreset, ScaleStep, ShortcutAction, ShortcutButton, SocialEntryDefault, TrackedColor, UiSize } from "../types";
import {
    achievementStyleLabel,
    controllerGlyphStyleLabel,
    activityCacheMinutesLabel,
    activityCardActionLabel,
    activityFriendsPerTickLabel,
    bigListThresholdLabel,
    blockPaddingLabel,
    buttonSpacingLabel,
    friendRefreshDelayLabel,
    ipcSlowThresholdMsLabel,
    largeViewportBonusLabel,
    parallelRaCallsLabel,
    parallelCdnFetchesLabel,
    maxIconWorkersLabel,
    avatarWorkersLabel,
    gameIconWorkersLabel,
    nightModeBrightnessLabel,
    gameArtCacheCapLabel,
    avatarCacheCapLabel,
    achievementIconCacheGamesLabel,
    fisTickFrequencyMinutesLabel,
    commentsCheckFrequencyLabel,
    trackedSetRefreshFrequencyLabel,
    playersNearYouLookbehindLabel,
    playersNearYouLookaheadLabel,
    playersNearYouMinTickMinutesLabel,
    playersNearYouMaxTickMinutesLabel,
    gamesListCacheMinutesLabel,
    awardsListCacheMinutesLabel,
    wantToPlayCacheMinutesLabel,
    commentsServiceFetchAmountLabel,
    fisRosterRefreshIntervalHoursLabel,
    returnStaggerFramesLabel,
    socialEntryDefaultLabel,
    trickleLookbackHoursLabel,
    scaleStepLabel,
    type MainUiPreset,
    QUICK_MENU_SHORTCUTS,
    SHORTCUT_BUTTONS,
    shortcutActionLabel,
    shortcutButtonLabel,
    unlockHistoryDaysLabel,
    unlockLookbackLabel
} from "../utils/options";
import { trackedColorHex, trackedColorLabelKey } from "../utils/achievements";
import { resolveGlyphStyle } from "../utils/controllerGlyphs";
import { BUTTON_BUMPER_LEFT, BUTTON_BUMPER_RIGHT } from "../utils/gamepadButtons";
import { playOkSound } from "../utils/navSound";
import { regularButtonSpacingStyle, smallTextStyle } from "../utils/style";

type TabIconProps = { size?: number };

type OptionsTabDef = {
    id: OptionsTab;
    Icon: ComponentType<TabIconProps>;
    labelKey: string;
    focusKey: string;
};

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function GearIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M495.9 166.6c3.2 8.7.5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6.3-24.5-6.8-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6 4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2 5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8 8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z" />
        </svg>
    );
}

function PaletteIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M512 256c0 .9 0 1.8 0 2.7c-.4 36.5-33.6 61.3-70.1 61.3H344c-26.5 0-48 21.5-48 48c0 3.4 .4 6.7 1 9.9c2.1 10.2 6.5 20 10.8 29.9c6.1 13.8 12.1 27.5 12.1 42c0 31.8-21.6 60.7-53.4 62c-3.5 .1-7 .2-10.6 .2C114.6 512 0 397.4 0 256S114.6 0 256 0S512 114.6 512 256zM128 288a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm0-96a32 32 0 1 0 0-64 32 32 0 1 0 0 64zm128-96a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm96 96a32 32 0 1 0 0-64 32 32 0 1 0 0 64z" />
        </svg>
    );
}

function UsersIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 640 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M144 0a80 80 0 1 1 0 160A80 80 0 1 1 144 0zM512 0a80 80 0 1 1 0 160A80 80 0 1 1 512 0zM0 298.7C0 239.8 47.8 192 106.7 192h42.7c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96c-.2 0-.4 0-.7 0H21.3C9.6 320 0 310.4 0 298.7zM405.3 320c-.2 0-.4 0-.7 0c26.6-23.5 43.3-57.8 43.3-96c0-7.6-.7-15-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7h42.7C592.2 192 640 239.8 640 298.7c0 11.8-9.6 21.3-21.3 21.3H405.3zM224 224a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zM128 485.3C128 411.7 187.7 352 261.3 352H378.7C452.3 352 512 411.7 512 485.3c0 14.7-11.9 26.7-26.7 26.7H154.7c-14.7 0-26.7-11.9-26.7-26.7z" />
        </svg>
    );
}

function DatabaseIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M448 80v48c0 44.2-100.3 80-224 80S0 172.2 0 128V80C0 35.8 100.3 0 224 0S448 35.8 448 80zM393.2 214.7c20.8-7.4 39.9-16.9 54.8-28.6V288c0 44.2-100.3 80-224 80S0 332.2 0 288V186.1c14.9 11.8 34 21.2 54.8 28.6C99.7 230.7 159.5 240 224 240s124.3-9.3 169.2-25.3zM0 346.1c14.9 11.8 34 21.2 54.8 28.6C99.7 390.7 159.5 400 224 400s124.3-9.3 169.2-25.3c20.8-7.4 39.9-16.9 54.8-28.6V432c0 44.2-100.3 80-224 80S0 476.2 0 432V346.1z" />
        </svg>
    );
}

function SlidersIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M0 416c0 17.7 14.3 32 32 32l54.7 0c12.3 28.3 40.5 48 73.3 48s61-19.7 73.3-48L480 448c17.7 0 32-14.3 32-32s-14.3-32-32-32l-246.7 0c-12.3-28.3-40.5-48-73.3-48s-61 19.7-73.3 48L32 384c-17.7 0-32 14.3-32 32zm128 0a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zM320 256a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm32-80c-32.8 0-61 19.7-73.3 48L32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l246.7 0c12.3 28.3 40.5 48 73.3 48s61-19.7 73.3-48l54.7 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-54.7 0c-12.3-28.3-40.5-48-73.3-48zM192 128a32 32 0 1 1 0-64 32 32 0 1 1 0 64zm-32-80c-32.8 0-61 19.7-73.3 48L32 96C14.3 96 0 110.3 0 128s14.3 32 32 32l54.7 0c12.3 28.3 40.5 48 73.3 48s61-19.7 73.3-48L480 160c17.7 0 32-14.3 32-32s-14.3-32-32-32L233.3 96C221 67.7 192.8 48 160 48z" />
        </svg>
    );
}

const OPTIONS_TABS: OptionsTabDef[] = [
    { id: "system", Icon: GearIcon, labelKey: "tab_system", focusKey: "options:tab:system" },
    { id: "gui", Icon: PaletteIcon, labelKey: "tab_gui", focusKey: "options:tab:gui" },
    { id: "social", Icon: UsersIcon, labelKey: "tab_social", focusKey: "options:tab:social" },
    { id: "cache", Icon: DatabaseIcon, labelKey: "tab_cache", focusKey: "options:tab:cache" },
    { id: "advanced", Icon: SlidersIcon, labelKey: "tab_advanced", focusKey: "options:tab:advanced" }
];

type OptionsPageState = {
    focusScopeResetToken: number;
    activeOptionsTab: OptionsTab;
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
    trackedSetsRefreshMinutes: number;
    debugLogging: boolean;
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
    buttonSpacingValue: ButtonSpacing;
    uiSize: UiSize;
    achievementTextScale: ScaleStep;
    commentsTextScale: ScaleStep;
    textScale: ScaleStep;
    titleScale: ScaleStep;
    headerScale: ScaleStep;
    bannerScale: ScaleStep;
    modalScale: ScaleStep;
    showIcons: boolean;
    autoRefresh: boolean;
    rememberLastPage: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    coloredGlyphs: boolean;
    mouseKeyboardMode: boolean;
    shortcutBindings: Record<ShortcutButton, ShortcutAction>;
    showAButtonMode: boolean;
    showAButtonModeTracked: boolean;
    showSocialHubButton: boolean;
    showTrackedSetsButton: boolean;
    showOptionsButton: boolean;
    quickMenuShortcuts: QuickMenuShortcut[];
    quickMenuShortcutRefused: QuickMenuShortcut | null;
    showAllToggleMain: boolean;
    showAllToggleFriend: boolean;
    showTrackedNotesMain: boolean;
    showRetroPoints: boolean;
    achievementStyle: AchievementStyle;
    trackedColor: TrackedColor;
    socialEntryDefault: SocialEntryDefault;
    activityCardAction: ActivityCardAction;
    error: string | null;
};

type OptionsPageActions = {
    onBack: () => void | Promise<void>;
    onGoToAbout: () => void | Promise<void>;
    onRefreshNow: () => void | Promise<void>;
    onEditCredentials: () => void | Promise<void>;
    onOpenSetupProfiles: () => void | Promise<void>;
    onAddUser: () => void | Promise<void>;
    onSwitchUser: () => void | Promise<void>;
    onResetSettings: () => void | Promise<void>;
    onSelectOptionsTab: (tab: OptionsTab) => void;
    onClearGameData: () => void | Promise<void>;
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
    onToggleBatterySaverDisablesFileWatcher: (next: boolean) => void | Promise<void>;
    onClearFileWatcherReport: () => void | Promise<void>;
    onClearFileWatcherMap: () => void | Promise<void>;
    onClearFileWatcherEverything: () => void | Promise<void>;
    onClearFileWatcherRunTimes: () => void | Promise<void>;
    onClearCheevoCheckResults: () => void | Promise<void>;
    onClearCheevoCheckHashes: () => void | Promise<void>;
    onClearCheevoCheckRaData: () => void | Promise<void>;
    onUpdateCheevoCheckReferenceData: () => void | Promise<void>;
    onDeleteLeaderboardsCache: () => void | Promise<void>;
    onClearResolvedAvatars: () => void | Promise<void>;
    onClearTracked: () => void | Promise<void>;
    onClearAllTracked: () => void | Promise<void>;
    onClearAllTrackedSets: () => void | Promise<void>;
    onClearDolphinMappings: () => void | Promise<void>;
    onResetDolphinMappings: () => void | Promise<void>;
    onCleanupDirectory: () => void | Promise<void>;
    onFactoryReset: () => void | Promise<void>;
    onDeleteAllNotes: () => void | Promise<void>;
    onToggleKeepGuidesOffline: (value: boolean) => void | Promise<void>;
    onClearGuideCache: () => void | Promise<void>;
    onDeleteAllGuideData: () => void | Promise<void>;
    onDeleteAllNotifications: () => void | Promise<void>;
    onClearArchivedNotifications: () => void | Promise<void>;
    onClearSavedComments: () => void | Promise<void>;
    onCycleUnlockLookback: () => void | Promise<void>;
    onCycleUnlockHistoryDays: () => void | Promise<void>;
    onCycleFriendRefreshDelay: () => void | Promise<void>;
    onCycleActivityCacheMinutes: () => void | Promise<void>;
    onCycleTrickleLookbackHours: () => void | Promise<void>;
    onCycleActivityFriendsPerTick: () => void | Promise<void>;
    onToggleSocialGameTicker: (nextValue: boolean) => void | Promise<void>;
    onToggleSocialHubTicker: (nextValue: boolean) => void | Promise<void>;
    onToggleSocialActivityTrickleService: (nextValue: boolean) => void | Promise<void>;
    onToggleTrickleFavoritesOnly: (nextValue: boolean) => void | Promise<void>;
    onToggleFriendAutoRefresh: (nextValue: boolean) => void | Promise<void>;
    onToggleShowReminderTicker: (nextValue: boolean) => void | Promise<void>;
    onToggleShowNotesDot: (nextValue: boolean) => void | Promise<void>;
    onToggleShowBellDot: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyNoteReminderEnabled: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyNoteReminderToast: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyTrackedSetEnabled: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyTrackedSetToast: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyCommentTrackerEnabled: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyCommentTrackerToast: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyWallEnabled: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyWallToast: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifySystemEnabled: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifySystemToast: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyTrackedEnabled: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyTrackedToast: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifySocialUnlockEnabled: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifySocialUnlockToast: (nextValue: boolean) => void | Promise<void>;
    onTogglePlayersNearYouEnabled: (nextValue: boolean) => void | Promise<void>;
    onCyclePlayersNearYouLookbehind: () => void | Promise<void>;
    onCyclePlayersNearYouLookahead: () => void | Promise<void>;
    onCyclePlayersNearYouMinTickMinutes: () => void | Promise<void>;
    onCyclePlayersNearYouMaxTickMinutes: () => void | Promise<void>;
    onCycleGamesListCacheMinutes: () => void | Promise<void>;
    onCycleAwardsListCacheMinutes: () => void | Promise<void>;
    onCycleWantToPlayCacheMinutes: () => void | Promise<void>;
    onToggleNotifyNearYouEnabled: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyNearYouToast: (nextValue: boolean) => void | Promise<void>;
    onToggleLegacyAchievementLinks: (nextValue: boolean) => void | Promise<void>;
    onToggleLegacyGameLinks: (nextValue: boolean) => void | Promise<void>;
    onToggleShowDeveloperOptions: (nextValue: boolean) => void | Promise<void>;
    onToggleAutoPurgeService: (nextValue: boolean) => void | Promise<void>;
    onToggleTrackedSetsAutoCheck: (nextValue: boolean) => void | Promise<void>;
    onToggleTrackedSetsServiceEnabled: (nextValue: boolean) => void | Promise<void>;
    onCycleTrackedSetsRefreshMinutes: () => void | Promise<void>;
    onToggleDebugLogging: (nextValue: boolean) => void | Promise<void>;
    onToggleDeferModalCleanup: (nextValue: boolean) => void | Promise<void>;
    onToggleLibraryBadge: (nextValue: boolean) => void | Promise<void>;
    onToggleLegacyCommentsLoading: (nextValue: boolean) => void | Promise<void>;
    onToggleBatterySaverDisablesSocialActivity: (nextValue: boolean) => void | Promise<void>;
    onToggleBatterySaverDisablesComments: (nextValue: boolean) => void | Promise<void>;
    onToggleBatterySaverDisablesFriendAvatars: (nextValue: boolean) => void | Promise<void>;
    onToggleBatterySaverDisablesPlayersNearYou: (nextValue: boolean) => void | Promise<void>;
    onToggleBatterySaverDisablesTrackedSets: (nextValue: boolean) => void | Promise<void>;
    onToggleDoNotDisturbDisablesDot: (nextValue: boolean) => void | Promise<void>;
    onToggleDoNotDisturbDisablesToast: (nextValue: boolean) => void | Promise<void>;
    onCycleNightModeBrightness: () => void | Promise<void>;
    onToggleNotifyDebugEnabled: (nextValue: boolean) => void | Promise<void>;
    onToggleNotifyDebugToast: (nextValue: boolean) => void | Promise<void>;
    onFireTestNotification: () => void | Promise<void>;
    onFireTestCommentNotification: () => void | Promise<void>;
    onFireTestUpdateNotification: () => void | Promise<void>;
    onFireTestTrackedSet: () => void | Promise<void>;
    onInjectFakeSelfName: () => void | Promise<void>;
    onInjectFakeFriendName: () => void | Promise<void>;
    onSimulateNoGame: () => void | Promise<void>;
    onPreviewBootCat: () => void | Promise<void>;
    onCycleIpcSlowThresholdMs: () => void | Promise<void>;
    onToggleLargeViewportBonusEnabled: (nextValue: boolean) => void | Promise<void>;
    onCycleLargeViewportBonus: () => void | Promise<void>;
    onCycleParallelRaCalls: () => void | Promise<void>;
    onCycleParallelCdnFetches: () => void | Promise<void>;
    onCycleMaxIconWorkers: () => void | Promise<void>;
    onCycleAvatarWorkers: () => void | Promise<void>;
    onCycleGameIconWorkers: () => void | Promise<void>;
    onCycleGameArtCacheCap: () => void | Promise<void>;
    onCycleAvatarCacheCap: () => void | Promise<void>;
    onCycleAchievementIconCacheGames: () => void | Promise<void>;
    onToggleFriendImageService: (nextValue: boolean) => void | Promise<void>;
    onToggleCommentsServiceWallCheck: (nextValue: boolean) => void | Promise<void>;
    onToggleValidateFriendsRoster: (nextValue: boolean) => void | Promise<void>;
    onCycleFisTickFrequencyMinutes: () => void | Promise<void>;
    onCycleCommentsServiceTickMinutes: () => void | Promise<void>;
    onCycleCommentsServiceFetchAmount: () => void | Promise<void>;
    onCycleFisRosterRefreshIntervalHours: () => void | Promise<void>;
    onToggleFisVerifyFavoriteAvatars: (nextValue: boolean) => void | Promise<void>;
    onToggleFisVerifyAllAvatars: (nextValue: boolean) => void | Promise<void>;
    onCycleBigListThreshold: () => void | Promise<void>;
    onCycleReturnStaggerFrames: () => void | Promise<void>;
    onToggleDynamicLoading: (nextValue: boolean) => void | Promise<void>;
    onCycleDynamicInitialRows: () => void | Promise<void>;
    onCycleDynamicRowStep: () => void | Promise<void>;
    onCycleDynamicPrefetchDistance: () => void | Promise<void>;
    onCycleDynamicSentinelRootMargin: () => void | Promise<void>;
    onToggleDynamicTrackedListLoading: (nextValue: boolean) => void | Promise<void>;
    onCycleDynamicTrackedListInitialRows: () => void | Promise<void>;
    onCycleDynamicTrackedListRowStep: () => void | Promise<void>;
    onCycleDynamicTrackedListPrefetchDistance: () => void | Promise<void>;
    onCycleDynamicTrackedListSentinelRootMargin: () => void | Promise<void>;
    onToggleDynamicTrackedSetsListLoading: (nextValue: boolean) => void | Promise<void>;
    onCycleDynamicTrackedSetsListInitialRows: () => void | Promise<void>;
    onCycleDynamicTrackedSetsListRowStep: () => void | Promise<void>;
    onCycleDynamicTrackedSetsListPrefetchDistance: () => void | Promise<void>;
    onCycleDynamicTrackedSetsListSentinelRootMargin: () => void | Promise<void>;
    onToggleDynamicGameNotesLoading: (nextValue: boolean) => void | Promise<void>;
    onCycleDynamicGameNotesInitialRows: () => void | Promise<void>;
    onCycleDynamicGameNotesRowStep: () => void | Promise<void>;
    onCycleDynamicGameNotesPrefetchDistance: () => void | Promise<void>;
    onCycleDynamicGameNotesSentinelRootMargin: () => void | Promise<void>;
    onToggleDynamicComments: (nextValue: boolean) => void | Promise<void>;
    onCycleDynamicCommentsInitialRows: () => void | Promise<void>;
    onCycleDynamicCommentsRowStep: () => void | Promise<void>;
    onCycleDynamicCommentsSentinelRootMargin: () => void | Promise<void>;
    onToggleDynamicFriendLoading: (nextValue: boolean) => void | Promise<void>;
    onToggleDynamicLeaderboardLoading: (nextValue: boolean) => void | Promise<void>;
    onToggleDynamicLeaderboardResults: (nextValue: boolean) => void | Promise<void>;
    onToggleDynamicActivityFeed: (nextValue: boolean) => void | Promise<void>;
    onToggleDynamicCompare: (nextValue: boolean) => void | Promise<void>;
    onToggleDynamicFriendPicker: (nextValue: boolean) => void | Promise<void>;
    onToggleDynamicAllGames: (nextValue: boolean) => void | Promise<void>;
    onToggleDynamicTrackedGames: (nextValue: boolean) => void | Promise<void>;
    onToggleDynamicBadges: (nextValue: boolean) => void | Promise<void>;
    onToggleDynamicFollowedRanking: (nextValue: boolean) => void | Promise<void>;
    onCycleBlockPadding: () => void | Promise<void>;
    onCycleButtonSpacing: () => void | Promise<void>;
    onCycleAchievementStyle: () => void | Promise<void>;
    onCycleTrackedColor: () => void | Promise<void>;
    onCycleSocialEntryDefault: () => void | Promise<void>;
    onCycleActivityCardAction: () => void | Promise<void>;
    onCycleUiSize: () => void | Promise<void>;
    onCycleAchievementTextScale: () => void | Promise<void>;
    onCycleCommentsTextScale: () => void | Promise<void>;
    onCycleTextScale: () => void | Promise<void>;
    onCycleTitleScale: () => void | Promise<void>;
    onCycleHeaderScale: () => void | Promise<void>;
    onCycleBannerScale: () => void | Promise<void>;
    onCycleModalScale: () => void | Promise<void>;
    onApplyScalePreset: (preset: ScalePreset) => void | Promise<void>;
    onApplyMainUiPreset: (preset: MainUiPreset) => void | Promise<void>;
    onToggleQuickMenuShortcut: (id: QuickMenuShortcut, nextValue: boolean) => void | Promise<void>;
    onCycleShortcutBinding: (button: ShortcutButton) => void | Promise<void>;
    onCycleShortcutBindingBack: (button: ShortcutButton) => void | Promise<void>;
    onToggleShowIcons: (nextValue: boolean) => void | Promise<void>;
    onToggleAutoRefresh: (nextValue: boolean) => void | Promise<void>;
    onToggleRememberLastPage: (nextValue: boolean) => void | Promise<void>;
    onCycleControllerGlyphStyle: () => void | Promise<void>;
    onToggleColoredGlyphs: (value: boolean) => void | Promise<void>;
    onToggleShowAButtonMode: (nextValue: boolean) => void | Promise<void>;
    onToggleShowAButtonModeTracked: (nextValue: boolean) => void | Promise<void>;
    onToggleShowSocialHubButton: (nextValue: boolean) => void | Promise<void>;
    onToggleShowTrackedSetsButton: (nextValue: boolean) => void | Promise<void>;
    onToggleShowOptionsButton: (nextValue: boolean) => void | Promise<void>;
    onToggleShowAllToggleMain: (nextValue: boolean) => void | Promise<void>;
    onToggleShowAllToggleFriend: (nextValue: boolean) => void | Promise<void>;
    onToggleShowTrackedNotesMain: (nextValue: boolean) => void | Promise<void>;
    onToggleShowRetroPoints: (nextValue: boolean) => void | Promise<void>;
    onToggleAlwaysStaggerMounting: (nextValue: boolean) => void | Promise<void>;
    onOpenLanguage: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type OptionsPageProps = {
    state: OptionsPageState;
    actions: OptionsPageActions;
};

function OptionsPage(props: OptionsPageProps) {
    const { state, actions } = props;
    const disabled = state.loading || state.saving || state.clearingAllCache;
    const clearCacheDisabled = disabled || state.clearingCache;
    const buttonOuterStyle = regularButtonSpacingStyle(state.buttonSpacing);

    const [focusedTab, setFocusedTab] = useState<OptionsTab | null>(null);
    const [hoveredTab, setHoveredTab] = useState<OptionsTab | null>(null);

    function handleTabFocus(id: OptionsTab) {
        setFocusedTab(id);
    }

    function handleTabBlur(id: OptionsTab) {
        setFocusedTab((current) => {
            if (current !== id) {
                return current;
            }

            return null;
        });
    }

    function handleTabHover(id: OptionsTab) {
        if (disabled) {
            return;
        }

        setHoveredTab(id);
    }

    function handleTabUnhover(id: OptionsTab) {
        setHoveredTab((current) => {
            if (current !== id) {
                return current;
            }

            return null;
        });
    }

    function handleTabClick(id: OptionsTab) {
        if (id === state.activeOptionsTab) {
            return;
        }

        actions.onSelectOptionsTab(id);
    }

    const previewTab = hoveredTab ?? focusedTab;
    const previewedOrActive = previewTab ?? state.activeOptionsTab;
    const previewedTab = OPTIONS_TABS.find((entry) => entry.id === previewedOrActive);
    const previewLabel = previewedTab ? t(state.language, previewedTab.labelKey) : "";

    return (
        <>
        <PanelSection>
            <PageNavStrip
                title={t(state.language, "Options")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
            />
            <BackButton
                label={t(state.language, "← Back to Main")}
                focusKey="options:back"
                navAutoFocus
                buttonSpacing={state.buttonSpacing}
                onClick={actions.onBack}
                disabled={state.loading || state.saving}
            />

            <PanelSectionRow>
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        padding: "14px 0 0 0"
                    }}
                >
                    <Focusable
                        flow-children="row"
                        style={{
                            display: "flex",
                            gap: "8px",
                            width: "100%",
                            justifyContent: "center"
                        }}
                    >
                        {OPTIONS_TABS.map((tab) => {
                            const isActive = state.activeOptionsTab === tab.id;
                            const isPreviewed = previewTab === tab.id;
                            const Icon = tab.Icon;

                            return (
                                <div
                                    key={tab.focusKey}
                                    data-focus-key={tab.focusKey}
                                    onMouseEnter={() => handleTabHover(tab.id)}
                                    onMouseLeave={() => handleTabUnhover(tab.id)}
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        width: "44px"
                                    }}
                                >
                                    <DialogButton
                                        onClick={() => handleTabClick(tab.id)}
                                        onGamepadFocus={() => handleTabFocus(tab.id)}
                                        onGamepadBlur={() => handleTabBlur(tab.id)}
                                        disabled={disabled}
                                        style={{
                                            minWidth: 0,
                                            width: "44px",
                                            height: "38px",
                                            padding: "4px 2px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            opacity: isActive || isPreviewed ? 1 : 0.7,
                                            boxShadow: isActive
                                                ? "0 0 0 2px rgba(120, 200, 255, 0.85), 0 2px 8px rgba(0,0,0,0.35)"
                                                : isPreviewed
                                                    ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                                                    : undefined
                                        }}
                                    >
                                        <Icon size={18} />
                                    </DialogButton>
                                </div>
                            );
                        })}
                    </Focusable>
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontWeight: 700,
                            textAlign: "center",
                            whiteSpace: "nowrap",
                            minHeight: "1em",
                            opacity: 0.92
                        }}
                    >
                        {previewLabel}
                    </div>
                </div>
            </PanelSectionRow>

            <div key={`options:tab:${state.activeOptionsTab}:${state.focusScopeResetToken}`}>
                {state.activeOptionsTab === "system" && (
                    <SystemTab state={state} actions={actions} buttonOuterStyle={buttonOuterStyle} disabled={disabled} />
                )}
                {state.activeOptionsTab === "gui" && (
                    <GuiTab state={state} actions={actions} buttonOuterStyle={buttonOuterStyle} disabled={disabled} />
                )}
                {state.activeOptionsTab === "social" && (
                    <SocialTab state={state} actions={actions} buttonOuterStyle={buttonOuterStyle} disabled={disabled} />
                )}
                {state.activeOptionsTab === "cache" && (
                    <CacheTab
                        state={state}
                        actions={actions}
                        buttonOuterStyle={buttonOuterStyle}
                        disabled={disabled}
                        clearCacheDisabled={clearCacheDisabled}
                    />
                )}
                {state.activeOptionsTab === "advanced" && (
                    <AdvancedTab state={state} actions={actions} buttonOuterStyle={buttonOuterStyle} disabled={disabled} />
                )}
                {
}
                <BottomFocusAnchor
                    focusKey="options:bottom:anchor"
                    onClick={() => {
                        if (state.showDeveloperOptions && state.activeOptionsTab === "advanced") {
                            void actions.onPreviewBootCat();
                        }
                    }}
                />
            </div>
        </PanelSection>
        </>
    );
}

type TabContentProps = {
    state: OptionsPageState;
    actions: OptionsPageActions;
    buttonOuterStyle: ReturnType<typeof regularButtonSpacingStyle>;
    disabled: boolean;
};

function SystemTab(props: TabContentProps) {
    const { state, actions, buttonOuterStyle, disabled } = props;
    const glyphStyle = resolveGlyphStyle(state.controllerGlyphStyle);

    return (
        <>
            <SectionTitle label={t(state.language, "Account")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:about"
                onClick={actions.onGoToAbout}
                disabled={disabled}
                label={t(state.language, "About")}
                help={t(state.language, "help_about")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:language"
                onClick={actions.onOpenLanguage}
                disabled={disabled}
                label={t(state.language, "Language")}
                value={LANGUAGES[state.language]?.label ?? state.language}
                help={t(state.language, "help_language")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:add-user"
                onClick={actions.onAddUser}
                disabled={disabled || state.checkingGame}
                label={t(state.language, "Add User")}
                help={t(state.language, "help_add_user")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:switch-user"
                onClick={actions.onSwitchUser}
                disabled={disabled || state.checkingGame || state.users.length === 0}
                label={t(state.language, "User Accounts")}
                help={t(state.language, "help_switch_user")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:edit"
                onClick={actions.onEditCredentials}
                disabled={disabled || state.checkingGame}
                label={t(state.language, "Edit Credentials")}
                help={t(state.language, "help_edit_credentials")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:setup-profiles"
                onClick={actions.onOpenSetupProfiles}
                disabled={disabled || state.checkingGame}
                label={t(state.language, "Settings Profile Chooser")}
                help={t(state.language, "help_setup_profiles")}
                separator
            />
            <SectionTitle label={t(state.language, "General")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:refresh"
                onClick={actions.onRefreshNow}
                disabled={disabled || state.checkingGame}
                label={state.loading ? t(state.language, "Refreshing...") : t(state.language, "Refresh Now")}
                help={t(state.language, "help_refresh_now")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Auto-Purge Service")}
                value={state.autoPurgeService}
                onChange={actions.onToggleAutoPurgeService}
                disabled={disabled}
                help={t(state.language, "help_auto_purge_service")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Steam Library Badge")}
                value={state.libraryBadge}
                onChange={actions.onToggleLibraryBadge}
                disabled={disabled}
                help={t(state.language, "help_library_badge")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:reset-settings"
                onClick={actions.onResetSettings}
                disabled={disabled}
                label={t(state.language, "Reset Settings")}
                help={t(state.language, "help_reset_settings")}
                separator
            />
            <SectionTitle label={t(state.language, "Mastery Goals")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Mastery Goals Service")}
                value={state.trackedSetsServiceEnabled}
                onChange={actions.onToggleTrackedSetsServiceEnabled}
                disabled={disabled}
                help={t(state.language, "help_tracked_sets_service")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Auto-Check Mastery Goals")}
                value={state.trackedSetsAutoCheck}
                onChange={actions.onToggleTrackedSetsAutoCheck}
                disabled={disabled}
                help={t(state.language, "help_tracked_sets_auto_check")}
                separator
            />
            <SectionTitle label={t(state.language, "Do Not Disturb Disabled Features")} />
            <PanelSectionRow>
                <InfoText>{t(state.language, "help_do_not_disturb_disabled_features")}</InfoText>
            </PanelSectionRow>
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Notification Dot")}
                value={state.doNotDisturbDisablesDot}
                onChange={actions.onToggleDoNotDisturbDisablesDot}
                disabled={disabled}
                help={t(state.language, "help_do_not_disturb_dot")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Notification Toasts")}
                value={state.doNotDisturbDisablesToast}
                onChange={actions.onToggleDoNotDisturbDisablesToast}
                disabled={disabled}
                help={t(state.language, "help_do_not_disturb_toast")}
                separator
            />
            <SectionTitle label={t(state.language, "Night Mode")} />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:night-mode-intensity"
                onClick={actions.onCycleNightModeBrightness}
                disabled={disabled}
                label={t(state.language, "Night Mode Intensity")}
                value={nightModeBrightnessLabel(state.nightModeBrightness)}
                help={t(state.language, "help_night_mode_intensity")}
                separator
            />
            <SectionTitle label={t(state.language, "Battery Saver Disabled Services")} />
            <PanelSectionRow>
                <InfoText>{t(state.language, "help_battery_saver_disabled_services")}</InfoText>
            </PanelSectionRow>
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Social Activity")}
                value={state.batterySaverDisablesSocialActivity}
                onChange={actions.onToggleBatterySaverDisablesSocialActivity}
                disabled={disabled}
                help={t(state.language, "help_battery_saver_social_activity")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Comments")}
                value={state.batterySaverDisablesComments}
                onChange={actions.onToggleBatterySaverDisablesComments}
                disabled={disabled}
                help={t(state.language, "help_battery_saver_comments")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Friend Avatars")}
                value={state.batterySaverDisablesFriendAvatars}
                onChange={actions.onToggleBatterySaverDisablesFriendAvatars}
                disabled={disabled}
                help={t(state.language, "help_battery_saver_friend_avatars")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Players Near You")}
                value={state.batterySaverDisablesPlayersNearYou}
                onChange={actions.onToggleBatterySaverDisablesPlayersNearYou}
                disabled={disabled}
                help={t(state.language, "help_battery_saver_players_near_you")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Mastery Goals")}
                value={state.batterySaverDisablesTrackedSets}
                onChange={actions.onToggleBatterySaverDisablesTrackedSets}
                disabled={disabled}
                help={t(state.language, "help_battery_saver_tracked_sets")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "File Watcher")}
                value={state.batterySaverDisablesFileWatcher}
                onChange={actions.onToggleBatterySaverDisablesFileWatcher}
                disabled={disabled}
                help={t(state.language, "help_battery_saver_file_watcher")}
                separator
            />
            <SectionTitle label={t(state.language, "Mapped Shortcuts")} />
            <PanelSectionRow>
                <InfoText>{t(state.language, "help_mapped_shortcuts")}</InfoText>
            </PanelSectionRow>
            {!state.mouseKeyboardMode && (
                <PanelSectionRow>
                    <ButtonHints
                        style={state.controllerGlyphStyle}
                        hints={[
                            { button: "l1", label: t(state.language, "Previous") },
                            { button: "r1", label: t(state.language, "Next") }
                        ]}
                    />
                </PanelSectionRow>
            )}
            {SHORTCUT_BUTTONS.map((entry, index) => (
                <OptionValueRow
                    key={entry.id}
                    outerStyle={buttonOuterStyle}
                    focusKey={`options:shortcut:${entry.id}`}
                    onClick={() => actions.onCycleShortcutBinding(entry.id)}
                    onButtonDown={(evt) => {
                        if (evt?.detail?.button === BUTTON_BUMPER_LEFT) {
                            playOkSound();
                            void actions.onCycleShortcutBindingBack(entry.id);
                            return;
                        }
                        if (evt?.detail?.button === BUTTON_BUMPER_RIGHT) {
                            playOkSound();
                            void actions.onCycleShortcutBinding(entry.id);
                        }
                    }}
                    disabled={disabled}
                    label={
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <ButtonGlyph button={entry.id} style={glyphStyle} size="1.2em" />
                            {shortcutButtonLabel(entry.id, state.language)}
                        </span>
                    }
                    value={shortcutActionLabel(state.shortcutBindings[entry.id], state.language)}
                    help={t(state.language, entry.helpKey)}
                    separator={index === SHORTCUT_BUTTONS.length - 1}
                />
            ))}
            <SectionTitle label={t(state.language, "Developer Options")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Developer Options")}
                value={state.showDeveloperOptions}
                onChange={actions.onToggleShowDeveloperOptions}
                disabled={disabled}
                help={t(state.language, "help_show_developer_options")}
            />
        </>
    );
}

function GuiTab(props: TabContentProps) {
    const { state, actions, buttonOuterStyle, disabled } = props;

    return (
        <>
            <SectionTitle label={t(state.language, "Display Scaling Presets")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:preset-portable"
                onClick={() => actions.onApplyScalePreset("portable")}
                disabled={disabled}
                label={t(state.language, "Portable")}
                help={t(state.language, "help_preset_portable")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:preset-big-screen"
                onClick={() => actions.onApplyScalePreset("bigScreen")}
                disabled={disabled}
                label={t(state.language, "Big Screen")}
                help={t(state.language, "help_preset_big_screen")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:preset-big-text"
                onClick={() => actions.onApplyScalePreset("bigText")}
                disabled={disabled}
                label={t(state.language, "Big Text")}
                help={t(state.language, "help_preset_big_text")}
                separator
            />
            <SectionTitle label={t(state.language, "Main UI Presets")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:main-ui-default"
                onClick={() => actions.onApplyMainUiPreset("default")}
                disabled={disabled}
                label={t(state.language, "Default View")}
                help={t(state.language, "help_preset_default_view")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:main-ui-compact"
                onClick={() => actions.onApplyMainUiPreset("compact")}
                disabled={disabled}
                label={t(state.language, "Compact View")}
                help={t(state.language, "help_preset_compact_view")}
                separator
            />
            <SectionTitle label={t(state.language, "Customize Quick Menu")} />
            <PanelSectionRow>
                <InfoText>{t(state.language, "help_quick_menu_shortcuts")}</InfoText>
            </PanelSectionRow>
            {QUICK_MENU_SHORTCUTS.map((entry, index) => (
                <Fragment key={entry.id}>
                    <OptionToggle
                        outerStyle={buttonOuterStyle}
                        label={t(state.language, entry.labelKey)}
                        value={state.quickMenuShortcuts.includes(entry.id)}
                        controlled
                        onChange={(nextValue) => actions.onToggleQuickMenuShortcut(entry.id, nextValue)}
                        disabled={disabled}
                        help={t(state.language, entry.helpKey)}
                        separator={index === QUICK_MENU_SHORTCUTS.length - 1}
                    />
                    {state.quickMenuShortcutRefused === entry.id && (
                        <PanelSectionRow>
                            <ErrorText>{t(state.language, "You can only choose up to four customizable links.")}</ErrorText>
                        </PanelSectionRow>
                    )}
                </Fragment>
            ))}
            <SectionTitle label={t(state.language, "Layout")} />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:block-padding"
                onClick={actions.onCycleBlockPadding}
                disabled={disabled}
                label={t(state.language, "Block Padding")}
                value={`${blockPaddingLabel(state.blockPadding, state.language)} (${state.blockPadding}px)`}
                help={t(state.language, "help_block_padding")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:ui-size"
                onClick={actions.onCycleUiSize}
                disabled={disabled}
                label={t(state.language, "Card Scale")}
                value={scaleStepLabel(state.uiSize, state.language)}
                help={t(state.language, "help_view_size")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:achievement-text-scale"
                onClick={actions.onCycleAchievementTextScale}
                disabled={disabled}
                label={t(state.language, "Achievement Text Scale")}
                value={scaleStepLabel(state.achievementTextScale, state.language)}
                help={t(state.language, "help_achievement_text_scale")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:comments-text-scale"
                onClick={actions.onCycleCommentsTextScale}
                disabled={disabled}
                label={t(state.language, "Comments Text Scale")}
                value={scaleStepLabel(state.commentsTextScale, state.language)}
                help={t(state.language, "help_comments_text_scale")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:text-scale"
                onClick={actions.onCycleTextScale}
                disabled={disabled}
                label={t(state.language, "Text Scale")}
                value={scaleStepLabel(state.textScale, state.language)}
                help={t(state.language, "help_text_scale")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:title-scale"
                onClick={actions.onCycleTitleScale}
                disabled={disabled}
                label={t(state.language, "Title Scale")}
                value={scaleStepLabel(state.titleScale, state.language)}
                help={t(state.language, "help_title_scale")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:header-scale"
                onClick={actions.onCycleHeaderScale}
                disabled={disabled}
                label={t(state.language, "Header Scale")}
                value={scaleStepLabel(state.headerScale, state.language)}
                help={t(state.language, "help_header_scale")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:banner-scale"
                onClick={actions.onCycleBannerScale}
                disabled={disabled}
                label={t(state.language, "Banner Scale")}
                value={scaleStepLabel(state.bannerScale, state.language)}
                help={t(state.language, "help_banner_scale")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:modal-scale"
                onClick={actions.onCycleModalScale}
                disabled={disabled}
                label={t(state.language, "Modal Scale")}
                value={scaleStepLabel(state.modalScale, state.language)}
                help={t(state.language, "help_modal_scale")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:controller-glyph-style"
                onClick={actions.onCycleControllerGlyphStyle}
                disabled={disabled}
                label={t(state.language, "Button Glyphs")}
                value={controllerGlyphStyleLabel(state.controllerGlyphStyle, state.language)}
                help={t(state.language, "help_controller_glyph_style")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Colored Glyphs")}
                value={state.coloredGlyphs}
                onChange={actions.onToggleColoredGlyphs}
                disabled={disabled}
                help={t(state.language, "help_colored_glyphs")}
                separator
            />
            <SectionTitle label={t(state.language, "Appearance")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show RetroPoints")}
                value={state.showRetroPoints}
                onChange={actions.onToggleShowRetroPoints}
                disabled={disabled}
                help={t(state.language, "help_show_retro_points")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:achievement-style"
                onClick={actions.onCycleAchievementStyle}
                disabled={disabled}
                label={t(state.language, "Achievement Style")}
                value={achievementStyleLabel(state.achievementStyle, state.language)}
                help={t(state.language, "help_achievement_style")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:tracked-color"
                onClick={actions.onCycleTrackedColor}
                disabled={disabled}
                label={t(state.language, "Tracked Color")}
                value={t(state.language, trackedColorLabelKey(state.trackedColor))}
                accentColor={trackedColorHex(state.trackedColor)}
                help={t(state.language, "help_tracked_color")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:unlock-history"
                onClick={actions.onCycleUnlockHistoryDays}
                disabled={disabled}
                label={t(state.language, "Unlock History")}
                value={unlockHistoryDaysLabel(state.unlockHistoryDays, state.language)}
                help={t(state.language, "help_unlock_history")}
                separator
            />
            <SectionTitle label={t(state.language, "Main Menu / Profile")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Social Hub Button")}
                value={state.showSocialHubButton}
                onChange={actions.onToggleShowSocialHubButton}
                disabled={disabled}
                help={t(state.language, "help_show_social_hub_button")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Mastery Goals Button")}
                value={state.showTrackedSetsButton}
                onChange={actions.onToggleShowTrackedSetsButton}
                disabled={disabled}
                help={t(state.language, "help_show_mastery_goals_button")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Options Button")}
                value={state.showOptionsButton}
                onChange={actions.onToggleShowOptionsButton}
                disabled={disabled}
                help={t(state.language, "help_show_options_button")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Main Show All Toggle")}
                value={state.showAllToggleMain}
                onChange={actions.onToggleShowAllToggleMain}
                disabled={disabled}
                help={t(state.language, "help_show_all_toggle_main")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Friend Show All Toggle")}
                value={state.showAllToggleFriend}
                onChange={actions.onToggleShowAllToggleFriend}
                disabled={disabled}
                help={t(state.language, "help_show_all_toggle_friend")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Tracked Notes - Main")}
                value={state.showTrackedNotesMain}
                onChange={actions.onToggleShowTrackedNotesMain}
                disabled={disabled}
                help={t(state.language, "help_show_tracked_notes_main")}
                separator
            />
            <SectionTitle label={t(state.language, "Notifications")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Dot on Notifications Bell")}
                value={state.showBellDot}
                onChange={actions.onToggleShowBellDot}
                disabled={disabled}
                help={t(state.language, "help_show_bell_dot")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Note Reminder Notifications")}
                value={state.notifyNoteReminderEnabled}
                onChange={actions.onToggleNotifyNoteReminderEnabled}
                disabled={disabled}
                help={t(state.language, "help_note_reminder_notifications")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Note Reminder Toasts")}
                value={state.notifyNoteReminderToast}
                onChange={actions.onToggleNotifyNoteReminderToast}
                disabled={disabled}
                help={t(state.language, "help_note_reminder_toasts")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Reminder Ticker")}
                value={state.showReminderTicker}
                onChange={actions.onToggleShowReminderTicker}
                disabled={disabled}
                help={t(state.language, "help_show_reminder_ticker")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Dot on Notes")}
                value={state.showNotesDot}
                onChange={actions.onToggleShowNotesDot}
                disabled={disabled}
                help={t(state.language, "help_show_notes_dot")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Mastery Goal Notifications")}
                value={state.notifyTrackedSetEnabled}
                onChange={actions.onToggleNotifyTrackedSetEnabled}
                disabled={disabled}
                help={t(state.language, "help_tracked_set_notifications")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Mastery Goal Toasts")}
                value={state.notifyTrackedSetToast}
                onChange={actions.onToggleNotifyTrackedSetToast}
                disabled={disabled}
                help={t(state.language, "help_tracked_set_toasts")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Comment Tracker Notifications")}
                value={state.notifyCommentTrackerEnabled}
                onChange={actions.onToggleNotifyCommentTrackerEnabled}
                disabled={disabled}
                help={t(state.language, "help_comment_tracker_notifications")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Comment Tracker Toasts")}
                value={state.notifyCommentTrackerToast}
                onChange={actions.onToggleNotifyCommentTrackerToast}
                disabled={disabled}
                help={t(state.language, "help_comment_tracker_toasts")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Wall Notifications")}
                value={state.notifyWallEnabled}
                onChange={actions.onToggleNotifyWallEnabled}
                disabled={disabled}
                help={t(state.language, "help_wall_notifications")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Wall Toasts")}
                value={state.notifyWallToast}
                onChange={actions.onToggleNotifyWallToast}
                disabled={disabled}
                help={t(state.language, "help_wall_toasts")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "System Notifications")}
                value={state.notifySystemEnabled}
                onChange={actions.onToggleNotifySystemEnabled}
                disabled={disabled}
                help={t(state.language, "help_system_notifications")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "System Toasts")}
                value={state.notifySystemToast}
                onChange={actions.onToggleNotifySystemToast}
                disabled={disabled}
                help={t(state.language, "help_system_toasts")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Tracked Achievement Notifications")}
                value={state.notifyTrackedEnabled}
                onChange={actions.onToggleNotifyTrackedEnabled}
                disabled={disabled}
                help={t(state.language, "help_tracked_achievement_notifications")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Tracked Achievement Toasts")}
                value={state.notifyTrackedToast}
                onChange={actions.onToggleNotifyTrackedToast}
                disabled={disabled}
                help={t(state.language, "help_tracked_achievement_toasts")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Social Activity Notifications")}
                value={state.notifySocialUnlockEnabled}
                onChange={actions.onToggleNotifySocialUnlockEnabled}
                disabled={disabled}
                help={t(state.language, "help_social_activity_notifications")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Social Activity Toasts")}
                value={state.notifySocialUnlockToast}
                onChange={actions.onToggleNotifySocialUnlockToast}
                disabled={disabled}
                help={t(state.language, "help_social_activity_toasts")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Social Game Ticker")}
                value={state.socialGameTicker}
                onChange={actions.onToggleSocialGameTicker}
                disabled={disabled}
                help={t(state.language, "help_social_game_ticker")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Social Hub Ticker")}
                value={state.socialHubTicker}
                onChange={actions.onToggleSocialHubTicker}
                disabled={disabled}
                help={t(state.language, "help_social_hub_ticker")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Players Near You Notifications")}
                value={state.notifyNearYouEnabled}
                onChange={actions.onToggleNotifyNearYouEnabled}
                disabled={disabled}
                help={t(state.language, "help_players_near_you_notifications")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Players Near You Toasts")}
                value={state.notifyNearYouToast}
                onChange={actions.onToggleNotifyNearYouToast}
                disabled={disabled}
                help={t(state.language, "help_players_near_you_toasts")}
            />
        </>
    );
}

function SocialTab(props: TabContentProps) {
    const { state, actions, buttonOuterStyle, disabled } = props;

    return (
        <>
            <SectionTitle label={t(state.language, "Behavior")} />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:activity-card-action"
                onClick={actions.onCycleActivityCardAction}
                disabled={disabled}
                label={t(state.language, "Ticker Click Mode")}
                value={activityCardActionLabel(state.activityCardAction, state.language)}
                help={t(state.language, "help_activity_card_action")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:social-entry-default"
                onClick={actions.onCycleSocialEntryDefault}
                disabled={disabled}
                label={t(state.language, "Default Social Hub Tab")}
                value={socialEntryDefaultLabel(state.socialEntryDefault, state.language)}
                help={t(state.language, "help_social_entry_default")}
                separator
            />
            <SectionTitle label={t(state.language, "Friends")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Auto-refresh friend info")}
                value={state.friendAutoRefresh}
                onChange={actions.onToggleFriendAutoRefresh}
                disabled={disabled}
                help={t(state.language, "help_friend_auto_refresh")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:friend-refresh-delay"
                onClick={actions.onCycleFriendRefreshDelay}
                disabled={disabled || !state.friendAutoRefresh}
                label={t(state.language, "Friend Refresh Time")}
                value={friendRefreshDelayLabel(state.friendRefreshDelayMs)}
                help={t(state.language, "help_friend_refresh_time")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:manual-refresh-friends"
                onClick={actions.onManualRefreshFriends}
                onGamepadFocus={() => logFocusDebug("gate", "options:manual-refresh-friends", "ButtonItem onGamepadFocus fired")}
                disabled={disabled || state.refreshingFriends}
                label={state.refreshingFriends
                        ? t(state.language, "Refreshing Friends...")
                        : t(state.language, "Refresh Friends Now")}
                help={t(state.language, "help_refresh_friends_now")}
            />
            <OptionConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:deep-roster-refresh"
                idleLabel={
                    state.deepRefreshingFriends
                        ? t(state.language, "Deep Refreshing...")
                        : t(state.language, "Deep Roster Refresh")
                }
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onDeepRosterRefresh}
                disabled={disabled || state.deepRefreshingFriends}
                help={t(state.language, "help_deep_roster_refresh")}
                separator
            />
            <SectionTitle label={t(state.language, "Friend Roster Service")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Roster Sync")}
                value={state.friendImageService}
                onChange={actions.onToggleFriendImageService}
                disabled={disabled}
                help={t(state.language, "help_friend_image_service")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:fis-tick-frequency"
                onClick={actions.onCycleFisTickFrequencyMinutes}
                disabled={disabled}
                label={t(state.language, "Roster - Tick Frequency")}
                value={fisTickFrequencyMinutesLabel(state.fisTickFrequencyMinutes, state.language)}
                help={t(state.language, "help_fis_tick_frequency")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:fis-roster-refresh"
                onClick={actions.onCycleFisRosterRefreshIntervalHours}
                disabled={disabled}
                label={t(state.language, "Roster - Refresh")}
                value={fisRosterRefreshIntervalHoursLabel(state.fisRosterRefreshIntervalHours, state.language)}
                help={t(state.language, "help_fis_roster_refresh")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Roster - Verify Favorites")}
                value={state.fisVerifyFavoriteAvatars}
                onChange={actions.onToggleFisVerifyFavoriteAvatars}
                disabled={disabled || state.fisVerifyAllAvatars}
                help={t(state.language, "help_roster_verify_favorites")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Roster - Verify All")}
                value={state.fisVerifyAllAvatars}
                onChange={actions.onToggleFisVerifyAllAvatars}
                disabled={disabled}
                help={t(state.language, "help_roster_verify_all")}
                separator
            />
            <SectionTitle label={t(state.language, "Activity Feed")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Social Activity Trickle Service")}
                value={state.socialActivityTrickleService}
                onChange={actions.onToggleSocialActivityTrickleService}
                disabled={disabled}
                help={t(state.language, "help_social_activity_trickle_service")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Limit Service to Favorites")}
                value={state.trickleFavoritesOnly}
                onChange={actions.onToggleTrickleFavoritesOnly}
                disabled={disabled}
                help={t(state.language, "help_limit_service_to_favorites")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:activity-cache-time"
                onClick={actions.onCycleActivityCacheMinutes}
                disabled={disabled}
                label={t(state.language, "Activity Check Frequency")}
                value={activityCacheMinutesLabel(state.activityCacheMinutes, state.language)}
                help={t(state.language, "help_activity_check_frequency")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:trickle-lookback"
                onClick={actions.onCycleTrickleLookbackHours}
                disabled={disabled}
                label={t(state.language, "Trickle Lookback")}
                value={trickleLookbackHoursLabel(state.trickleLookbackHours, state.language)}
                help={t(state.language, "help_trickle_lookback")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:activity-per-tick"
                onClick={actions.onCycleActivityFriendsPerTick}
                disabled={disabled}
                label={t(state.language, "Activity Per Tick")}
                value={activityFriendsPerTickLabel(state.activityFriendsPerTick)}
                help={t(state.language, "help_activity_per_tick")}
                separator
            />
            <SectionTitle label={t(state.language, "Comments")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Comments Service Wall Check")}
                value={state.commentsServiceWallCheck}
                onChange={actions.onToggleCommentsServiceWallCheck}
                disabled={disabled}
                help={t(state.language, "help_comments_service_wall_check")}
                separator
            />
            <SectionTitle label={t(state.language, "Players Near You")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Players Near You Feed")}
                value={state.playersNearYouEnabled}
                onChange={actions.onTogglePlayersNearYouEnabled}
                disabled={disabled}
                help={t(state.language, "help_players_near_you")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:players-near-you-lookbehind"
                onClick={actions.onCyclePlayersNearYouLookbehind}
                disabled={disabled}
                label={t(state.language, "Players Near You - Lookbehind")}
                value={playersNearYouLookbehindLabel(state.playersNearYouLookbehind)}
                help={t(state.language, "help_players_near_you_lookbehind")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:players-near-you-lookahead"
                onClick={actions.onCyclePlayersNearYouLookahead}
                disabled={disabled}
                label={t(state.language, "Players Near You - Lookahead")}
                value={playersNearYouLookaheadLabel(state.playersNearYouLookahead)}
                help={t(state.language, "help_players_near_you_lookahead")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:players-near-you-min-tick"
                onClick={actions.onCyclePlayersNearYouMinTickMinutes}
                disabled={disabled}
                label={t(state.language, "Players Near You - Min Tick")}
                value={playersNearYouMinTickMinutesLabel(state.playersNearYouMinTickMinutes, state.language)}
                help={t(state.language, "help_players_near_you_min_tick")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:players-near-you-max-tick"
                onClick={actions.onCyclePlayersNearYouMaxTickMinutes}
                disabled={disabled}
                label={t(state.language, "Players Near You - Max Tick")}
                value={playersNearYouMaxTickMinutesLabel(state.playersNearYouMaxTickMinutes, state.language)}
                help={t(state.language, "help_players_near_you_max_tick")}
            />
        </>
    );
}

type CacheTabProps = TabContentProps & {
    clearCacheDisabled: boolean;
};

function CacheTab(props: CacheTabProps) {
    const { state, actions, buttonOuterStyle, disabled, clearCacheDisabled } = props;

    return (
        <>
            <SectionTitle label={t(state.language, "Cache Sizes")} />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:game-art-cache"
                onClick={actions.onCycleGameArtCacheCap}
                disabled={disabled}
                label={t(state.language, "Game art cache")}
                value={gameArtCacheCapLabel(state.gameArtCacheCap)}
                help={t(state.language, "help_game_art_cache")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:avatar-cache"
                onClick={actions.onCycleAvatarCacheCap}
                disabled={disabled}
                label={t(state.language, "Avatar cache")}
                value={avatarCacheCapLabel(state.avatarCacheCap)}
                help={t(state.language, "help_avatar_cache")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:achievement-icon-cache"
                onClick={actions.onCycleAchievementIconCacheGames}
                disabled={disabled}
                label={t(state.language, "Achievement icon cache")}
                value={achievementIconCacheGamesLabel(state.achievementIconCacheGames)}
                help={t(state.language, "help_achievement_icon_cache")}
                separator
            />
            <SectionTitle label={t(state.language, "Clear Caches")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-game-data"
                onClick={actions.onClearGameData}
                disabled={clearCacheDisabled}
                label={state.clearingGameDataCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Game Data")}
                help={t(state.language, "help_clear_game_data")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-friends"
                onClick={actions.onClearFriendsCache}
                disabled={clearCacheDisabled}
                label={state.clearingFriendsCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Friends")}
                help={t(state.language, "help_clear_friends")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-images"
                onClick={actions.onClearImages}
                disabled={clearCacheDisabled}
                label={state.clearingImagesCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Images")}
                help={t(state.language, "help_clear_images")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-other-icons"
                onClick={actions.onClearOtherIcons}
                disabled={clearCacheDisabled}
                label={state.clearingOtherIconsCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Other Icons")}
                help={t(state.language, "help_clear_other_icons")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-social-activity"
                onClick={actions.onClearSocialActivity}
                disabled={clearCacheDisabled}
                label={state.clearingSocialActivityCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Activity Feed")}
                help={t(state.language, "help_clear_social_activity")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-game-activity"
                onClick={actions.onClearGameActivity}
                disabled={clearCacheDisabled}
                label={state.clearingGameActivityCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Game Activity")}
                help={t(state.language, "help_clear_game_activity")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-players-near-you"
                onClick={actions.onClearPlayersNearYou}
                disabled={clearCacheDisabled}
                label={state.clearingPlayersNearYouCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Players Near You")}
                help={t(state.language, "help_clear_players_near_you")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-games-list-cache"
                onClick={actions.onClearGamesListCache}
                disabled={clearCacheDisabled}
                label={state.clearingGamesListCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Games List Cache")}
                help={t(state.language, "help_clear_games_list_cache")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-awards-list-cache"
                onClick={actions.onClearAwardsListCache}
                disabled={clearCacheDisabled}
                label={state.clearingAwardsListCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Awards List Cache")}
                help={t(state.language, "help_clear_awards_list_cache")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-want-to-play-cache"
                onClick={actions.onClearWantToPlayCache}
                disabled={clearCacheDisabled}
                label={state.clearingWantToPlayCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Want to Play Cache")}
                help={t(state.language, "help_clear_want_to_play_cache")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-game-overview-cache"
                onClick={actions.onClearGameOverviewCache}
                disabled={clearCacheDisabled}
                label={state.clearingGameOverviewCache
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Game Overview Cache")}
                help={t(state.language, "help_clear_game_overview_cache")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:delete-leaderboards-cache"
                onClick={actions.onDeleteLeaderboardsCache}
                disabled={clearCacheDisabled}
                label={t(state.language, "Delete Leaderboards Cache")}
                help={t(state.language, "help_delete_leaderboards_cache")}
            />
            <OptionConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:delete-all-notifications"
                idleLabel={t(state.language, "Delete Notifications")}
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onDeleteAllNotifications}
                disabled={disabled}
                help={t(state.language, "help_delete_all_notifications")}
                separator
            />
            <OptionConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:clear-archived-posts"
                idleLabel={t(state.language, "Delete Archived Notifications")}
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onClearArchivedNotifications}
                disabled={disabled}
                help={t(state.language, "help_clear_archived_posts")}
                separator
            />
            <OptionConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:clear-saved-comments"
                idleLabel={t(state.language, "Clear Saved Comments")}
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onClearSavedComments}
                disabled={disabled}
                help={t(state.language, "help_clear_saved_comments")}
                separator
            />
            <SectionTitle label={t(state.language, "Tracked & Notes")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-tracked"
                onClick={actions.onClearTracked}
                disabled={disabled || !state.payload?.gameId}
                label={t(state.language, "Clear Tracked")}
                help={t(state.language, "help_clear_tracked")}
            />
            <OptionConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:clear-all-tracked"
                idleLabel={t(state.language, "Clear All Tracked")}
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onClearAllTracked}
                disabled={disabled}
                help={t(state.language, "help_clear_all_tracked")}
            />
            <OptionConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:delete-all-notes"
                idleLabel={t(state.language, "Delete All Notes")}
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onDeleteAllNotes}
                disabled={disabled}
                help={t(state.language, "help_delete_all_notes")}
                separator
            />
            <SectionTitle label={t(state.language, "Guides Data")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Offline Guides")}
                value={state.keepGuidesOffline}
                onChange={actions.onToggleKeepGuidesOffline}
                disabled={disabled}
                help={t(state.language, "help_truly_offline_guides")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-guide-cache"
                onClick={actions.onClearGuideCache}
                disabled={clearCacheDisabled}
                label={t(state.language, "Clear Guide Cache")}
                help={t(state.language, "help_clear_guide_cache")}
            />
            <OptionConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:delete-all-guide-data"
                idleLabel={t(state.language, "Delete All Guide Data")}
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onDeleteAllGuideData}
                disabled={disabled}
                help={t(state.language, "help_delete_all_guide_data")}
                separator
            />
            <SectionTitle label={t(state.language, "Mastery Goals Data")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-sets-cache"
                onClick={actions.onClearSetsCache}
                disabled={clearCacheDisabled}
                label={t(state.language, "Clear Game List Cache")}
                help={t(state.language, "help_clear_sets_cache")}
            />
            <OptionConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:delete-all-tracked-sets"
                idleLabel={t(state.language, "Delete All Mastery Goals")}
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onClearAllTrackedSets}
                disabled={disabled}
                help={t(state.language, "help_delete_all_tracked_sets")}
                separator
            />
            <SectionTitle label={t(state.language, "Cheevo Check Data")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-cheevo-check-results"
                onClick={actions.onClearCheevoCheckResults}
                disabled={clearCacheDisabled}
                label={t(state.language, "Clear Last Scan Results")}
                help={t(state.language, "help_clear_cheevo_check_results")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-cheevo-check-hashes"
                onClick={actions.onClearCheevoCheckHashes}
                disabled={clearCacheDisabled}
                label={t(state.language, "Clear Local Hash Cache")}
                help={t(state.language, "help_clear_cheevo_check_hashes")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-cheevo-check-ra-data"
                onClick={actions.onClearCheevoCheckRaData}
                disabled={clearCacheDisabled}
                label={t(state.language, "Clear Saved RetroAchievements Data")}
                help={t(state.language, "help_clear_cheevo_check_ra_data")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:update-cheevo-check-reference-data"
                onClick={actions.onUpdateCheevoCheckReferenceData}
                label={t(state.language, "Update Dump Lists")}
                help={t(state.language, "help_update_cheevo_check_reference_data")}
                separator
            />
            <SectionTitle label={t(state.language, "File Watcher Data")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-file-watcher-run-times"
                onClick={actions.onClearFileWatcherRunTimes}
                disabled={clearCacheDisabled}
                label={t(state.language, "Clear Last Run Times")}
                help={t(state.language, "help_clear_file_watcher_run_times")}
            />
            <OptionConfirm
                focusKey="options:clear-file-watcher-report"
                idleLabel={t(state.language, "Clear Last Report")}
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onClearFileWatcherReport}
                disabled={clearCacheDisabled}
                buttonSpacing={state.buttonSpacing}
                help={t(state.language, "help_clear_file_watcher_report")}
            />
            <OptionConfirm
                focusKey="options:clear-file-watcher-map"
                idleLabel={t(state.language, "Forget All Recorded Hashes")}
                armedLabel={t(state.language, "Press again — this erases your corruption history")}
                onConfirm={actions.onClearFileWatcherMap}
                disabled={clearCacheDisabled}
                buttonSpacing={state.buttonSpacing}
                help={t(state.language, "help_clear_file_watcher_map")}
            />
            <OptionConfirm
                focusKey="options:clear-file-watcher-everything"
                idleLabel={t(state.language, "Remove File Watcher Data")}
                armedLabel={t(state.language, "Press again to remove everything")}
                onConfirm={actions.onClearFileWatcherEverything}
                disabled={clearCacheDisabled}
                buttonSpacing={state.buttonSpacing}
                help={t(state.language, "help_clear_file_watcher_everything")}
                separator
            />
            <SectionTitle label={t(state.language, "Dolphin Mapper Data")} />
            <OptionConfirm
                focusKey="options:clear-dolphin-mappings"
                idleLabel={t(state.language, "Clear Mappings")}
                armedLabel={t(state.language, "Press again to clear every mapping")}
                onConfirm={actions.onClearDolphinMappings}
                disabled={disabled}
                buttonSpacing={state.buttonSpacing}
                help={t(state.language, "help_clear_dolphin_mappings")}
            />
            <OptionConfirm
                focusKey="options:reset-dolphin-mappings"
                idleLabel={t(state.language, "Reset Mappings")}
                armedLabel={t(state.language, "Press again — this deletes your own mappings")}
                onConfirm={actions.onResetDolphinMappings}
                disabled={disabled}
                buttonSpacing={state.buttonSpacing}
                help={t(state.language, "help_reset_dolphin_mappings")}
                separator
            />
            <SectionTitle label={t(state.language, "Maintenance")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-all-cache"
                onClick={actions.onClearAllCache}
                disabled={clearCacheDisabled}
                label={state.clearingAllCache
                        ? t(state.language, "Clearing Cache...")
                        : t(state.language, "Clear All Cache")}
                help={t(state.language, "help_clear_all_cache")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:clear-resolved-avatars"
                onClick={actions.onClearResolvedAvatars}
                disabled={clearCacheDisabled}
                label={state.clearingResolvedAvatars
                        ? t(state.language, "Clearing...")
                        : t(state.language, "Clear Resolved Avatars")}
                help={t(state.language, "help_clear_resolved_avatars")}
            />
            <OptionConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:cleanup-directory"
                idleLabel={t(state.language, "Cleanup Directory")}
                armedLabel={t(state.language, "Press again to confirm")}
                onConfirm={actions.onCleanupDirectory}
                disabled={disabled}
                help={t(state.language, "help_cleanup_directory")}
            />
            <SectionTitle label={t(state.language, "Reset")} />
            <OptionTripleConfirm
                buttonSpacing={state.buttonSpacing}
                focusKey="options:factory-reset"
                idleLabel={t(state.language, "Factory Reset")}
                armedLabel2={t(state.language, "Press again -- this wipes everything")}
                armedLabel3={t(state.language, "Last chance: press to erase all accounts")}
                busy={state.factoryResetting}
                busyLabel={t(state.language, "Resetting...")}
                onConfirm={actions.onFactoryReset}
                disabled={disabled}
                help={t(state.language, "help_factory_reset")}
            />
        </>
    );
}

function AdvancedTab(props: TabContentProps) {
    const { state, actions, buttonOuterStyle, disabled } = props;

    return (
        <>
            <SectionTitle label={t(state.language, "Rendering & Performance")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Modal Auto-Cleanup")}
                value={state.deferModalCleanup}
                onChange={actions.onToggleDeferModalCleanup}
                disabled={disabled}
                help={t(state.language, "help_defer_modal_cleanup")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Notification Body - Large Viewport Bonus")}
                value={state.largeViewportBonusEnabled}
                onChange={actions.onToggleLargeViewportBonusEnabled}
                disabled={disabled}
                help={t(state.language, "help_large_viewport_bonus_enabled")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:large-viewport-bonus"
                onClick={actions.onCycleLargeViewportBonus}
                disabled={disabled}
                label={t(state.language, "Large Viewport Bonus")}
                value={largeViewportBonusLabel(state.largeViewportBonus)}
                help={t(state.language, "help_large_viewport_bonus")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:parallel-ra-calls"
                onClick={actions.onCycleParallelRaCalls}
                disabled={disabled}
                label={t(state.language, "Parallel RA Calls")}
                value={parallelRaCallsLabel(state.parallelRaCalls)}
                help={t(state.language, "help_parallel_ra_calls")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:parallel-cdn-fetches"
                onClick={actions.onCycleParallelCdnFetches}
                disabled={disabled}
                label={t(state.language, "Parallel CDN Fetches")}
                value={parallelCdnFetchesLabel(state.parallelCdnFetches)}
                help={t(state.language, "help_parallel_cdn_fetches")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:max-icon-workers"
                onClick={actions.onCycleMaxIconWorkers}
                disabled={disabled}
                label={t(state.language, "RA Achievement Workers")}
                value={maxIconWorkersLabel(state.maxIconWorkers)}
                help={t(state.language, "help_max_icon_workers")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:avatar-workers"
                onClick={actions.onCycleAvatarWorkers}
                disabled={disabled}
                label={t(state.language, "Avatar Workers")}
                value={avatarWorkersLabel(state.avatarWorkers)}
                help={t(state.language, "help_avatar_workers")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:game-icon-workers"
                onClick={actions.onCycleGameIconWorkers}
                disabled={disabled}
                label={t(state.language, "Game Icon Workers")}
                value={gameIconWorkersLabel(state.gameIconWorkers)}
                help={t(state.language, "help_game_icon_workers")}
                separator
            />
            <SectionTitle label={t(state.language, "Background Services")} />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:comments-check-frequency"
                onClick={actions.onCycleCommentsServiceTickMinutes}
                disabled={disabled}
                label={t(state.language, "Comments Check Frequency")}
                value={commentsCheckFrequencyLabel(state.commentsServiceTickMinutes, state.language)}
                help={t(state.language, "help_comments_check_frequency")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:comments-service-fetch-amount"
                onClick={actions.onCycleCommentsServiceFetchAmount}
                disabled={disabled}
                label={t(state.language, "Comments Service Fetch Amount")}
                value={commentsServiceFetchAmountLabel(state.commentsServiceFetchAmount)}
                help={t(state.language, "help_comments_service_fetch_amount")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:tracked-set-refresh-frequency"
                onClick={actions.onCycleTrackedSetsRefreshMinutes}
                disabled={disabled}
                label={t(state.language, "Mastery Goal Refresh Frequency")}
                value={trackedSetRefreshFrequencyLabel(state.trackedSetsRefreshMinutes, state.language)}
                help={t(state.language, "help_tracked_set_refresh_frequency")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:games-list-cache-minutes"
                onClick={actions.onCycleGamesListCacheMinutes}
                disabled={disabled}
                label={t(state.language, "Games List Cache Time")}
                value={gamesListCacheMinutesLabel(state.gamesListCacheMinutes, state.language)}
                help={t(state.language, "help_games_list_cache_minutes")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:awards-list-cache-minutes"
                onClick={actions.onCycleAwardsListCacheMinutes}
                disabled={disabled}
                label={t(state.language, "Awards Cache Time")}
                value={awardsListCacheMinutesLabel(state.awardsListCacheMinutes, state.language)}
                help={t(state.language, "help_awards_list_cache_minutes")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:want-to-play-cache-minutes"
                onClick={actions.onCycleWantToPlayCacheMinutes}
                disabled={disabled}
                label={t(state.language, "Want to Play Cache Time")}
                value={wantToPlayCacheMinutesLabel(state.wantToPlayCacheMinutes, state.language)}
                help={t(state.language, "help_want_to_play_cache_minutes")}
                separator={state.showDeveloperOptions}
            />
            {state.showDeveloperOptions && (
                <>
            <SectionTitle label={t(state.language, "Behavior & Legacy")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Remember Last Page")}
                value={state.rememberLastPage}
                onChange={actions.onToggleRememberLastPage}
                disabled={disabled}
                help={t(state.language, "help_remember_last_page")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Auto-Refresh")}
                value={state.autoRefresh}
                onChange={actions.onToggleAutoRefresh}
                disabled={disabled}
                help={t(state.language, "help_auto_refresh")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:unlock-lookback"
                onClick={actions.onCycleUnlockLookback}
                disabled={disabled}
                label={t(state.language, "Unlock Lookback")}
                value={unlockLookbackLabel(state.unlockLookbackMinutes, state.language)}
                help={t(state.language, "help_unlock_lookback")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Legacy Achievement Links")}
                value={state.legacyAchievementLinks}
                onChange={actions.onToggleLegacyAchievementLinks}
                disabled={disabled}
                help={t(state.language, "help_legacy_achievement_links")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Legacy Game Links")}
                value={state.legacyGameLinks}
                onChange={actions.onToggleLegacyGameLinks}
                disabled={disabled}
                help={t(state.language, "help_legacy_game_links")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Legacy Comments Loading")}
                value={state.legacyCommentsLoading}
                onChange={actions.onToggleLegacyCommentsLoading}
                disabled={disabled}
                help={t(state.language, "help_legacy_comments_loading")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Icons")}
                value={state.showIcons}
                onChange={actions.onToggleShowIcons}
                disabled={disabled}
                help={t(state.language, "help_show_icons")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Click Row - Main")}
                value={state.showAButtonMode}
                onChange={actions.onToggleShowAButtonMode}
                disabled={disabled}
                help={t(state.language, "help_show_a_button_mode")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Show Click Row - Tracked")}
                value={state.showAButtonModeTracked}
                onChange={actions.onToggleShowAButtonModeTracked}
                disabled={disabled}
                help={t(state.language, "help_show_a_button_mode_tracked")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:button-spacing"
                onClick={actions.onCycleButtonSpacing}
                disabled={disabled}
                label={t(state.language, "Button Spacing")}
                value={buttonSpacingLabel(state.buttonSpacingValue, state.language)}
                help={t(state.language, "help_button_spacing")}
                separator
            />
                </>
            )}
            {state.showDeveloperOptions && (
                <>
            <SectionTitle label={t(state.language, "Dynamic Loading")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Achievement Loading")}
                value={state.dynamicLoading}
                onChange={actions.onToggleDynamicLoading}
                disabled={disabled}
                help={t(state.language, "help_dynamic_loading")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Friend Loading")}
                value={state.dynamicFriendLoading}
                onChange={actions.onToggleDynamicFriendLoading}
                disabled={disabled}
                help={t(state.language, "help_dynamic_friend_loading")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Friend Picker")}
                value={state.dynamicFriendPicker}
                onChange={actions.onToggleDynamicFriendPicker}
                disabled={disabled}
                help={t(state.language, "help_dynamic_friend_picker")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Leaderboard Loading")}
                value={state.dynamicLeaderboardLoading}
                onChange={actions.onToggleDynamicLeaderboardLoading}
                disabled={disabled}
                help={t(state.language, "help_dynamic_leaderboard_loading")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Leaderboard Results")}
                value={state.dynamicLeaderboardResults}
                onChange={actions.onToggleDynamicLeaderboardResults}
                disabled={disabled}
                help={t(state.language, "help_dynamic_leaderboard_results")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Compare")}
                value={state.dynamicCompare}
                onChange={actions.onToggleDynamicCompare}
                disabled={disabled}
                help={t(state.language, "help_dynamic_compare")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Activity Feed")}
                value={state.dynamicActivityFeed}
                onChange={actions.onToggleDynamicActivityFeed}
                disabled={disabled}
                help={t(state.language, "help_dynamic_activity_feed")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic All Games")}
                value={state.dynamicAllGames}
                onChange={actions.onToggleDynamicAllGames}
                disabled={disabled}
                help={t(state.language, "help_dynamic_all_games")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Followed Ranking")}
                value={state.dynamicFollowedRanking}
                onChange={actions.onToggleDynamicFollowedRanking}
                disabled={disabled}
                help={t(state.language, "help_dynamic_followed_ranking")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Other Games List")}
                value={state.dynamicTrackedGames}
                onChange={actions.onToggleDynamicTrackedGames}
                disabled={disabled}
                help={t(state.language, "help_dynamic_tracked_games")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Badges")}
                value={state.dynamicBadges}
                onChange={actions.onToggleDynamicBadges}
                disabled={disabled}
                help={t(state.language, "help_dynamic_badges")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Always Stagger Mounting")}
                value={state.alwaysStaggerMounting}
                onChange={actions.onToggleAlwaysStaggerMounting}
                disabled={disabled}
                help={t(state.language, "help_always_stagger_mounting")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:big-list-threshold"
                onClick={actions.onCycleBigListThreshold}
                disabled={disabled}
                label={t(state.language, "Big List Threshold")}
                value={bigListThresholdLabel(state.bigListThreshold, state.language)}
                help={t(state.language, "help_big_list_threshold")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:return-stagger-frames"
                onClick={actions.onCycleReturnStaggerFrames}
                disabled={disabled}
                label={t(state.language, "Return Stagger Frames")}
                value={returnStaggerFramesLabel(state.returnStaggerFrames, state.language)}
                help={t(state.language, "help_return_stagger_frames")}
                separator
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-initial-rows"
                onClick={actions.onCycleDynamicInitialRows}
                disabled={disabled}
                label={t(state.language, "General List Rows Loaded First")}
                value={`${state.dynamicInitialRows}`}
                help={t(state.language, "help_dynamic_initial_rows")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-row-step"
                onClick={actions.onCycleDynamicRowStep}
                disabled={disabled}
                label={t(state.language, "General List Rows Added Each Time")}
                value={`${state.dynamicRowStep}`}
                help={t(state.language, "help_dynamic_row_step")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-prefetch-distance"
                onClick={actions.onCycleDynamicPrefetchDistance}
                disabled={disabled}
                label={t(state.language, "General List Load-Ahead Rows")}
                value={`${state.dynamicPrefetchDistance}`}
                help={t(state.language, "help_dynamic_prefetch_distance")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-sentinel-root-margin"
                onClick={actions.onCycleDynamicSentinelRootMargin}
                disabled={disabled}
                label={t(state.language, "General List Scroll Load-Ahead Distance")}
                value={`${state.dynamicSentinelRootMargin}px`}
                help={t(state.language, "help_dynamic_sentinel_root_margin")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Tracked List Loading")}
                value={state.dynamicTrackedListLoading}
                onChange={actions.onToggleDynamicTrackedListLoading}
                disabled={disabled}
                help={t(state.language, "help_dynamic_tracked_list_loading")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-tracked-list-initial-rows"
                onClick={actions.onCycleDynamicTrackedListInitialRows}
                disabled={disabled}
                label={t(state.language, "Tracked List Rows Loaded First")}
                value={`${state.dynamicTrackedListInitialRows}`}
                help={t(state.language, "help_dynamic_tracked_list_initial_rows")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-tracked-list-row-step"
                onClick={actions.onCycleDynamicTrackedListRowStep}
                disabled={disabled}
                label={t(state.language, "Tracked List Rows Added Each Time")}
                value={`${state.dynamicTrackedListRowStep}`}
                help={t(state.language, "help_dynamic_tracked_list_row_step")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-tracked-list-prefetch-distance"
                onClick={actions.onCycleDynamicTrackedListPrefetchDistance}
                disabled={disabled}
                label={t(state.language, "Tracked List Load-Ahead Rows")}
                value={`${state.dynamicTrackedListPrefetchDistance}`}
                help={t(state.language, "help_dynamic_tracked_list_prefetch_distance")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-tracked-list-sentinel-root-margin"
                onClick={actions.onCycleDynamicTrackedListSentinelRootMargin}
                disabled={disabled}
                label={t(state.language, "Tracked List Scroll Load-Ahead Distance")}
                value={`${state.dynamicTrackedListSentinelRootMargin}px`}
                help={t(state.language, "help_dynamic_tracked_list_sentinel_root_margin")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Mastery Goals List Loading")}
                value={state.dynamicTrackedSetsListLoading}
                onChange={actions.onToggleDynamicTrackedSetsListLoading}
                disabled={disabled}
                help={t(state.language, "help_dynamic_tracked_sets_list_loading")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-tracked-sets-list-initial-rows"
                onClick={actions.onCycleDynamicTrackedSetsListInitialRows}
                disabled={disabled}
                label={t(state.language, "Mastery Goals List Rows Loaded First")}
                value={`${state.dynamicTrackedSetsListInitialRows}`}
                help={t(state.language, "help_dynamic_tracked_sets_list_initial_rows")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-tracked-sets-list-row-step"
                onClick={actions.onCycleDynamicTrackedSetsListRowStep}
                disabled={disabled}
                label={t(state.language, "Mastery Goals List Rows Added Each Time")}
                value={`${state.dynamicTrackedSetsListRowStep}`}
                help={t(state.language, "help_dynamic_tracked_sets_list_row_step")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-tracked-sets-list-prefetch-distance"
                onClick={actions.onCycleDynamicTrackedSetsListPrefetchDistance}
                disabled={disabled}
                label={t(state.language, "Mastery Goals List Load-Ahead Rows")}
                value={`${state.dynamicTrackedSetsListPrefetchDistance}`}
                help={t(state.language, "help_dynamic_tracked_sets_list_prefetch_distance")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-tracked-sets-list-sentinel-root-margin"
                onClick={actions.onCycleDynamicTrackedSetsListSentinelRootMargin}
                disabled={disabled}
                label={t(state.language, "Mastery Goals List Scroll Load-Ahead Distance")}
                value={`${state.dynamicTrackedSetsListSentinelRootMargin}px`}
                help={t(state.language, "help_dynamic_tracked_sets_list_sentinel_root_margin")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Game Notes Loading")}
                value={state.dynamicGameNotesLoading}
                onChange={actions.onToggleDynamicGameNotesLoading}
                disabled={disabled}
                help={t(state.language, "help_dynamic_game_notes_loading")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-game-notes-initial-rows"
                onClick={actions.onCycleDynamicGameNotesInitialRows}
                disabled={disabled}
                label={t(state.language, "Game Notes Rows Loaded First")}
                value={`${state.dynamicGameNotesInitialRows}`}
                help={t(state.language, "help_dynamic_game_notes_initial_rows")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-game-notes-row-step"
                onClick={actions.onCycleDynamicGameNotesRowStep}
                disabled={disabled}
                label={t(state.language, "Game Notes Rows Added Each Time")}
                value={`${state.dynamicGameNotesRowStep}`}
                help={t(state.language, "help_dynamic_game_notes_row_step")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-game-notes-prefetch-distance"
                onClick={actions.onCycleDynamicGameNotesPrefetchDistance}
                disabled={disabled}
                label={t(state.language, "Game Notes Load-Ahead Rows")}
                value={`${state.dynamicGameNotesPrefetchDistance}`}
                help={t(state.language, "help_dynamic_game_notes_prefetch_distance")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-game-notes-sentinel-root-margin"
                onClick={actions.onCycleDynamicGameNotesSentinelRootMargin}
                disabled={disabled}
                label={t(state.language, "Game Notes Scroll Load-Ahead Distance")}
                value={`${state.dynamicGameNotesSentinelRootMargin}px`}
                help={t(state.language, "help_dynamic_game_notes_sentinel_root_margin")}
                separator
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Dynamic Comments")}
                value={state.dynamicComments}
                onChange={actions.onToggleDynamicComments}
                disabled={disabled}
                help={t(state.language, "help_dynamic_comments")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-comments-initial-rows"
                onClick={actions.onCycleDynamicCommentsInitialRows}
                disabled={disabled}
                label={t(state.language, "Comments Rows Loaded First")}
                value={`${state.dynamicCommentsInitialRows}`}
                help={t(state.language, "help_dynamic_comments_initial_rows")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-comments-row-step"
                onClick={actions.onCycleDynamicCommentsRowStep}
                disabled={disabled}
                label={t(state.language, "Comments Rows Added Each Time")}
                value={`${state.dynamicCommentsRowStep}`}
                help={t(state.language, "help_dynamic_comments_row_step")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:dynamic-comments-sentinel-root-margin"
                onClick={actions.onCycleDynamicCommentsSentinelRootMargin}
                disabled={disabled}
                label={t(state.language, "Comments Scroll Load-Ahead Distance")}
                value={`${state.dynamicCommentsSentinelRootMargin}px`}
                help={t(state.language, "help_dynamic_comments_sentinel_root_margin")}
            />
                </>
            )}
            {state.showDeveloperOptions && (
                <>
            <SectionTitle label={t(state.language, "Diagnostics")} />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Debug Logging")}
                value={state.debugLogging}
                onChange={actions.onToggleDebugLogging}
                disabled={disabled}
                help={t(state.language, "help_debug_logging")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Debug Notifications")}
                value={state.notifyDebugEnabled}
                onChange={actions.onToggleNotifyDebugEnabled}
                disabled={disabled}
                help={t(state.language, "help_debug_notifications")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Debug Toasts")}
                value={state.notifyDebugToast}
                onChange={actions.onToggleNotifyDebugToast}
                disabled={disabled}
                help={t(state.language, "help_debug_toasts")}
            />
            <OptionValueRow
                outerStyle={buttonOuterStyle}
                focusKey="options:ipc-slow-threshold-ms"
                onClick={actions.onCycleIpcSlowThresholdMs}
                disabled={disabled}
                label={t(state.language, "Slow Call Threshold")}
                value={ipcSlowThresholdMsLabel(state.ipcSlowThresholdMs)}
                help={t(state.language, "help_slow_call_threshold")}
                separator
            />
                </>
            )}
            {state.showDeveloperOptions && (
                <>
            <SectionTitle label={t(state.language, "Test Hooks")} />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:fire-test-notification"
                onClick={actions.onFireTestNotification}
                disabled={disabled}
                label={t(state.language, "Fire Test Notification")}
                help={t(state.language, "help_fire_test_notification")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:fire-test-comment-notification"
                onClick={actions.onFireTestCommentNotification}
                disabled={disabled}
                label={t(state.language, "Fire Test Comment Notification")}
                help={t(state.language, "help_fire_test_comment_notification")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:fire-test-update-notification"
                onClick={actions.onFireTestUpdateNotification}
                disabled={disabled}
                label={t(state.language, "Fire Test Update Notification")}
                help={t(state.language, "help_fire_test_update_notification")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:fire-test-tracked-set"
                onClick={actions.onFireTestTrackedSet}
                disabled={disabled}
                label={t(state.language, "Fire Test Mastery Goal Completion")}
                help={t(state.language, "help_fire_test_tracked_set")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Validate Friends Roster")}
                value={state.validateFriendsRoster}
                onChange={actions.onToggleValidateFriendsRoster}
                disabled={disabled}
                help={t(state.language, "help_validate_friends_roster")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:inject-fake-self-name"
                onClick={actions.onInjectFakeSelfName}
                disabled={disabled}
                label={t(state.language, "Inject Fake Name (Me)")}
                help={t(state.language, "help_inject_fake_self_name")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:inject-fake-friend-name"
                onClick={actions.onInjectFakeFriendName}
                disabled={disabled}
                label={t(state.language, "Inject Fake Friend Name")}
                help={t(state.language, "help_inject_fake_friend_name")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="options:simulate-no-game"
                onClick={actions.onSimulateNoGame}
                disabled={disabled}
                label={t(state.language, "Wipe Loaded Game")}
                help={t(state.language, "help_simulate_no_game")}
            />
                </>
            )}
        </>
    );
}

export default OptionsPage;
