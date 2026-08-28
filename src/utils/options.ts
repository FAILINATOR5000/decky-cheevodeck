import { DEFAULT_LANGUAGE, type LanguageCode, t } from "../locales";
import type { AchievementStyle, ActivityCardAction, ButtonSpacing, ControllerGlyphStyle, PlayersNearYouMode, PlayersNearYouTapMode, QuickMenuShortcut, ScalePreset, ScaleStep, ShortcutAction, ShortcutButton, SocialEntryDefault } from "../types";


const UNLOCK_LOOKBACK_OPTIONS = [60, 120, 360, 720, 1440];
const UNLOCK_HISTORY_DAY_OPTIONS = [7, 14, 30, 60, 90, -1] as const;
const FRIEND_REFRESH_DELAY_OPTIONS = [500, 750, 1000, 1500, 2000, 3000, 4000, 5000] as const;
const ACTIVITY_CACHE_MINUTE_OPTIONS = [1, 2, 3, 4, 5, 10, 15, 20, 30, 60] as const;
const TRICKLE_LOOKBACK_HOUR_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const ACTIVITY_FRIENDS_PER_TICK_OPTIONS = [3, 4, 5] as const;
const SCALE_STEPS: ScaleStep[] = ["normal", "large", "xlarge", "xxlarge", "xxxlarge"];
const BUTTON_SPACING_OPTIONS: ButtonSpacing[] = ["verysmall", "small", "medium", "large", "xlarge"];
const ACHIEVEMENT_STYLE_OPTIONS: AchievementStyle[] = ["left", "centered"];
const CONTROLLER_GLYPH_STYLE_OPTIONS: ControllerGlyphStyle[] = ["auto", "universal", "deck", "steamcontroller", "xbox", "playstation", "nintendo"];
const SOCIAL_ENTRY_DEFAULT_OPTIONS: SocialEntryDefault[] = [
    "friends",
    "favorites",
    "activity",
    "subscribedDiscussions",
    "newsEvents",
    "lastUsed"
];
const ACTIVITY_CARD_ACTION_OPTIONS: ActivityCardAction[] = ["profile", "achievement", "game"];
const BLOCK_PADDING_OPTIONS = [2, 4, 6, 8, 10, 12] as const;
const BIG_LIST_THRESHOLD_DISABLED = 9999;
const BIG_LIST_THRESHOLD_OPTIONS = [50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, BIG_LIST_THRESHOLD_DISABLED] as const;
const RETURN_STAGGER_FRAME_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
const IPC_SLOW_THRESHOLD_MS_OPTIONS = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500] as const;
const PARALLEL_RA_CALLS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const LARGE_VIEWPORT_BONUS_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
const PARALLEL_CDN_FETCHES_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const MAX_ICON_WORKERS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const AVATAR_WORKERS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const GAME_ICON_WORKERS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const NIGHT_MODE_BRIGHTNESS_OPTIONS = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85] as const;
const GAME_ART_CACHE_CAP_OPTIONS = [512, 1024, 2048, 4096] as const;
const AVATAR_CACHE_CAP_OPTIONS = [512, 1024, 2048, 4096] as const;
const ACHIEVEMENT_ICON_CACHE_GAMES_OPTIONS = [8, 16, 24, 32, 64] as const;
const FIS_TICK_FREQUENCY_MINUTES_OPTIONS = [1, 2, 3, 4, 5, 10, 15, 30, 60] as const;
const COMMENTS_CHECK_FREQUENCY_MINUTES_OPTIONS = [1, 2, 3, 4, 5, 10, 15, 30, 60, 120, 180] as const;
const COMMENTS_SERVICE_FETCH_AMOUNT_OPTIONS = [5, 10, 15, 20, 25, 30] as const;
const TRACKED_SETS_REFRESH_MINUTES_OPTIONS = [1, 5, 10, 15, 30, 60, 120] as const;
const PLAYERS_NEAR_YOU_LOOKBEHIND_OPTIONS = [0, 1, 2, 3, 4, 5] as const;
const PLAYERS_NEAR_YOU_LOOKAHEAD_OPTIONS = [2, 4, 6, 8, 10, 12] as const;
const PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS = [1, 2, 3, 5, 10, 15, 30, 60] as const;
const GAMES_LIST_CACHE_MINUTE_OPTIONS = [1, 5, 10, 15, 20, 30, 60, 120, 180, 720, 1440, 10080] as const;
const PLAYERS_NEAR_YOU_TAP_MODE_OPTIONS: PlayersNearYouTapMode[] = ["profile", "achievement", "game"];
const PLAYERS_NEAR_YOU_MODE_OPTIONS: PlayersNearYouMode[] = ["enhanced", "classic", "recent", "off"];
const FIS_ROSTER_REFRESH_NEVER = -1;
const FIS_ROSTER_REFRESH_INTERVAL_HOURS_OPTIONS = [1, 3, 6, 12, 24, 48, FIS_ROSTER_REFRESH_NEVER] as const;
const DYNAMIC_INITIAL_ROW_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80] as const;
const DYNAMIC_ROW_STEP_OPTIONS = [1, 3, 5, 10, 15, 20, 25, 30] as const;
const DYNAMIC_PREFETCH_DISTANCE_OPTIONS = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30] as const;
const DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS = [
    200, 250, 300, 350, 400, 450, 500, 550, 600, 650,
    700, 750, 800, 850, 900, 950, 1000, 1050, 1100,
    1150, 1200, 1250, 1300, 1350, 1400
] as const;

export function unlockLookbackLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    const hours = Math.max(1, Math.round(minutes / 60));

    return hours === 1 ? t(language, "{{hours}} hour", { hours }) : t(language, "{{hours}} hours", { hours });
}

export function nextUnlockLookbackMinutes(current: number) {
    const normalized = UNLOCK_LOOKBACK_OPTIONS.includes(current) ? current : 120;
    const currentIndex = UNLOCK_LOOKBACK_OPTIONS.indexOf(normalized);

    return UNLOCK_LOOKBACK_OPTIONS[(currentIndex + 1) % UNLOCK_LOOKBACK_OPTIONS.length];
}

export function unlockHistoryDaysLabel(days: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (days === -1) {
        return t(language, "All time");
    }
    return days === 1 ? t(language, "{{days}} day", { days }) : t(language, "{{days}} days", { days });
}

export function nextUnlockHistoryDays(current: number) {
    const normalized = UNLOCK_HISTORY_DAY_OPTIONS.includes(current as any) ? current : -1;
    const currentIndex = UNLOCK_HISTORY_DAY_OPTIONS.indexOf(normalized as any);

    return UNLOCK_HISTORY_DAY_OPTIONS[(currentIndex + 1) % UNLOCK_HISTORY_DAY_OPTIONS.length];
}

export function friendRefreshDelayLabel(delayMs: number) {
    return `${delayMs} ms`;
}

export function activityCacheMinutesLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    return minutes === 1 ? t(language, "{{minutes}} minute", { minutes }) : t(language, "{{minutes}} minutes", { minutes });
}

export function nextActivityCacheMinutes(current: number) {
    const normalized = ACTIVITY_CACHE_MINUTE_OPTIONS.includes(current as any) ? current : 5;
    const currentIndex = ACTIVITY_CACHE_MINUTE_OPTIONS.indexOf(normalized as any);

    return ACTIVITY_CACHE_MINUTE_OPTIONS[(currentIndex + 1) % ACTIVITY_CACHE_MINUTE_OPTIONS.length];
}

export function trickleLookbackHoursLabel(hours: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    return hours === 1 ? t(language, "{{hours}} hour", { hours }) : t(language, "{{hours}} hours", { hours });
}

export function nextTrickleLookbackHours(current: number) {
    const normalized = TRICKLE_LOOKBACK_HOUR_OPTIONS.includes(current as any) ? current : 3;
    const currentIndex = TRICKLE_LOOKBACK_HOUR_OPTIONS.indexOf(normalized as any);

    return TRICKLE_LOOKBACK_HOUR_OPTIONS[(currentIndex + 1) % TRICKLE_LOOKBACK_HOUR_OPTIONS.length];
}

export function activityFriendsPerTickLabel(value: number) {
    return `${value}`;
}

export function nextActivityFriendsPerTick(current: number) {
    const normalized = ACTIVITY_FRIENDS_PER_TICK_OPTIONS.includes(current as any) ? current : 3;
    const currentIndex = ACTIVITY_FRIENDS_PER_TICK_OPTIONS.indexOf(normalized as any);

    return ACTIVITY_FRIENDS_PER_TICK_OPTIONS[(currentIndex + 1) % ACTIVITY_FRIENDS_PER_TICK_OPTIONS.length];
}

export function nextFriendRefreshDelayMs(current: number) {
    const normalized = FRIEND_REFRESH_DELAY_OPTIONS.includes(current as any) ? current : 1000;
    const currentIndex = FRIEND_REFRESH_DELAY_OPTIONS.indexOf(normalized as any);

    return FRIEND_REFRESH_DELAY_OPTIONS[(currentIndex + 1) % FRIEND_REFRESH_DELAY_OPTIONS.length];
}

export function bigListThresholdLabel(value: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === BIG_LIST_THRESHOLD_DISABLED) {
        return t(language, "Disabled");
    }

    return `${value}`;
}

export function nextBigListThreshold(current: number) {
    const normalized = BIG_LIST_THRESHOLD_OPTIONS.includes(current as any) ? current : BIG_LIST_THRESHOLD_DISABLED;
    const currentIndex = BIG_LIST_THRESHOLD_OPTIONS.indexOf(normalized as any);

    return BIG_LIST_THRESHOLD_OPTIONS[(currentIndex + 1) % BIG_LIST_THRESHOLD_OPTIONS.length];
}

export function scaleStepLabel(value: ScaleStep, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "large") {
        return t(language, "Large");
    }
    if (value === "xlarge") {
        return t(language, "X-Large");
    }
    if (value === "xxlarge") {
        return t(language, "XX-Large");
    }
    if (value === "xxxlarge") {
        return t(language, "XXX-Large");
    }
    return t(language, "Normal");
}

export function nextScaleStep(current: ScaleStep) {
    const currentIndex = SCALE_STEPS.indexOf(current);

    return SCALE_STEPS[(currentIndex + 1) % SCALE_STEPS.length];
}

export interface DisplayScales {
    uiSize: ScaleStep;
    achievementTextScale: ScaleStep;
    commentsTextScale: ScaleStep;
    textScale: ScaleStep;
    titleScale: ScaleStep;
    headerScale: ScaleStep;
    bannerScale: ScaleStep;
    modalScale: ScaleStep;
}

const SCALE_PRESET_ORDER: ScalePreset[] = ["portable", "bigScreen", "bigText"];

export function nextScalePreset(last: ScalePreset): ScalePreset {
    const lastIndex = SCALE_PRESET_ORDER.indexOf(last);

    return SCALE_PRESET_ORDER[(lastIndex + 1) % SCALE_PRESET_ORDER.length];
}

export const SCALE_PRESETS: Record<ScalePreset, DisplayScales> = {
    portable: {
        uiSize: "normal",
        achievementTextScale: "normal",
        commentsTextScale: "normal",
        textScale: "normal",
        titleScale: "normal",
        headerScale: "normal",
        bannerScale: "normal",
        modalScale: "normal"
    },
    bigScreen: {
        uiSize: "large",
        achievementTextScale: "large",
        commentsTextScale: "large",
        textScale: "large",
        titleScale: "large",
        headerScale: "normal",
        bannerScale: "large",
        modalScale: "xlarge"
    },
    bigText: {
        uiSize: "xlarge",
        achievementTextScale: "xlarge",
        commentsTextScale: "xlarge",
        textScale: "xlarge",
        titleScale: "xlarge",
        headerScale: "normal",
        bannerScale: "xlarge",
        modalScale: "xxlarge"
    }
};

export interface MainUiButtons {
    showSocialHubButton: boolean;
    showTrackedSetsButton: boolean;
}

export type MainUiPreset = "default" | "compact";

export const MAIN_UI_PRESETS: Record<MainUiPreset, MainUiButtons> = {
    default: {
        showSocialHubButton: true,
        showTrackedSetsButton: true
    },
    compact: {
        showSocialHubButton: false,
        showTrackedSetsButton: false
    }
};

export const QUICK_MENU_SHORTCUTS: { id: QuickMenuShortcut; labelKey: string; helpKey: string }[] = [
    { id: "dolphinMapper", labelKey: "Dolphin Mapper", helpKey: "help_quick_shortcut_dolphin_mapper" },
    { id: "cheevoCheck", labelKey: "Cheevo Check", helpKey: "help_quick_shortcut_cheevo_check" },
    { id: "smbShares", labelKey: "SMB Shares", helpKey: "help_quick_shortcut_smb_shares" },
    { id: "fileWatcher", labelKey: "File Watcher", helpKey: "help_quick_shortcut_file_watcher" },
    { id: "socialActivity", labelKey: "Social Activity Feed", helpKey: "help_quick_shortcut_social_activity" },
    { id: "uiDefault", labelKey: "UI: Default View", helpKey: "help_quick_shortcut_ui_default" },
    { id: "uiCompact", labelKey: "UI: Compact View", helpKey: "help_quick_shortcut_ui_compact" }
];

export const QUICK_MENU_SHORTCUT_LIMIT = 4;

export const SHORTCUT_BUTTONS: { id: ShortcutButton; helpKey: string }[] = [
    { id: "menu", helpKey: "help_shortcut_menu" },
    { id: "view", helpKey: "help_shortcut_view" },
    { id: "l3", helpKey: "help_shortcut_l3" },
    { id: "r3", helpKey: "help_shortcut_r3" },
    { id: "l4", helpKey: "help_shortcut_l4" },
    { id: "l5", helpKey: "help_shortcut_l5" },
    { id: "r4", helpKey: "help_shortcut_r4" },
    { id: "r5", helpKey: "help_shortcut_r5" }
];

const SHORTCUT_ACTIONS: { id: ShortcutAction; labelKey: string }[] = [
    { id: "none", labelKey: "Not Set" },
    { id: "notifications", labelKey: "Notifications" },
    { id: "pageUp", labelKey: "Page Up" },
    { id: "home", labelKey: "Home" },
    { id: "currentGuide", labelKey: "View Current Guide" },
    { id: "search", labelKey: "Search Game" },
    { id: "profile", labelKey: "View Profile" },
    { id: "socialhub", labelKey: "Social Hub" },
    { id: "news", labelKey: "News" },
    { id: "aotw", labelKey: "Achievement of the Week" },
    { id: "newsets", labelKey: "New Sets & Revisions" },
    { id: "subscribeddiscussions", labelKey: "Subscribed Discussions" },
    { id: "savedcomments", labelKey: "Saved Comments" },
    { id: "trackedsets", labelKey: "Mastery Goals" },
    { id: "utilities", labelKey: "Utilities" },
    { id: "useraccounts", labelKey: "User Accounts" },
    { id: "options", labelKey: "Options" },
    { id: "about", labelKey: "About" },
    { id: "refresh", labelKey: "Refresh" },
    { id: "dolphinMapper", labelKey: "Dolphin Mapper" },
    { id: "cheevoCheck", labelKey: "Cheevo Check" },
    { id: "smbShares", labelKey: "SMB Shares" },
    { id: "fileWatcher", labelKey: "File Watcher" },
    { id: "socialActivity", labelKey: "Social Activity Feed" },
    { id: "snapshot", labelKey: "Snapshot" },
    { id: "nightMode", labelKey: "Night Mode" },
    { id: "doNotDisturb", labelKey: "Do Not Disturb" },
    { id: "mouseKeyboardMode", labelKey: "Mouse & Keyboard Mode" },
    { id: "cycleUiScale", labelKey: "Cycle UI Scale" }
];

export const DEFAULT_SHORTCUT_BINDINGS: Record<ShortcutButton, ShortcutAction> = {
    menu: "notifications",
    view: "pageUp",
    l3: "none",
    r3: "none",
    l4: "none",
    l5: "none",
    r4: "none",
    r5: "none"
};

export function shortcutButtonLabel(value: ShortcutButton, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "menu") {
        return t(language, "shortcut_button_menu");
    }
    if (value === "view") {
        return t(language, "shortcut_button_view");
    }

    return value.toUpperCase();
}

export function shortcutActionLabel(value: ShortcutAction, language: LanguageCode = DEFAULT_LANGUAGE) {
    const entry = SHORTCUT_ACTIONS.find((action) => action.id === value);

    return t(language, entry ? entry.labelKey : "Not Set");
}

export function nextShortcutAction(current: ShortcutAction) {
    const currentIndex = SHORTCUT_ACTIONS.findIndex((action) => action.id === current);

    return SHORTCUT_ACTIONS[(currentIndex + 1) % SHORTCUT_ACTIONS.length].id;
}

export function previousShortcutAction(current: ShortcutAction) {
    const currentIndex = SHORTCUT_ACTIONS.findIndex((action) => action.id === current);
    const previousIndex = (currentIndex <= 0 ? SHORTCUT_ACTIONS.length : currentIndex) - 1;

    return SHORTCUT_ACTIONS[previousIndex].id;
}

export function blockPaddingLabel(value: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value <= 2) {
        return t(language, "Very Small");
    }
    if (value <= 4) {
        return t(language, "Small");
    }
    if (value <= 6) {
        return t(language, "Medium");
    }
    if (value <= 8) {
        return t(language, "Large");
    }
    if (value <= 10) {
        return t(language, "X-Large");
    }
    return t(language, "XX-Large");
}

export function nextBlockPadding(current: number) {
    const normalized = BLOCK_PADDING_OPTIONS.includes(current as any) ? current : 4;
    const currentIndex = BLOCK_PADDING_OPTIONS.indexOf(normalized as any);

    return BLOCK_PADDING_OPTIONS[(currentIndex + 1) % BLOCK_PADDING_OPTIONS.length];
}

export function buttonSpacingLabel(value: ButtonSpacing, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "verysmall") {
        return t(language, "Very Small");
    }
    if (value === "small") {
        return t(language, "Small");
    }
    if (value === "large") {
        return t(language, "Large");
    }
    if (value === "xlarge") {
        return t(language, "X-Large");
    }
    return t(language, "Medium");
}

export function nextButtonSpacing(current: ButtonSpacing) {
    const currentIndex = BUTTON_SPACING_OPTIONS.indexOf(current);

    return BUTTON_SPACING_OPTIONS[(currentIndex + 1) % BUTTON_SPACING_OPTIONS.length];
}

export function achievementStyleLabel(value: AchievementStyle, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "centered") {
        return t(language, "Classic");
    }
    return t(language, "Balanced");
}

export function nextAchievementStyle(current: AchievementStyle) {
    const currentIndex = ACHIEVEMENT_STYLE_OPTIONS.indexOf(current);

    return ACHIEVEMENT_STYLE_OPTIONS[(currentIndex + 1) % ACHIEVEMENT_STYLE_OPTIONS.length];
}

export function controllerGlyphStyleLabel(value: ControllerGlyphStyle, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "universal") {
        return t(language, "Universal");
    }
    if (value === "deck") {
        return "Steam Deck";
    }
    if (value === "steamcontroller") {
        return "Steam Controller";
    }
    if (value === "xbox") {
        return "Xbox";
    }
    if (value === "playstation") {
        return "PlayStation";
    }
    if (value === "nintendo") {
        return "Nintendo";
    }
    return t(language, "Auto");
}

export function nextControllerGlyphStyle(current: ControllerGlyphStyle) {
    const currentIndex = CONTROLLER_GLYPH_STYLE_OPTIONS.indexOf(current);

    return CONTROLLER_GLYPH_STYLE_OPTIONS[(currentIndex + 1) % CONTROLLER_GLYPH_STYLE_OPTIONS.length];
}

export function socialEntryDefaultLabel(value: SocialEntryDefault, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "favorites") {
        return t(language, "Favorites");
    }
    if (value === "activity") {
        return t(language, "Activity");
    }
    if (value === "subscribedDiscussions") {
        return t(language, "Community");
    }
    if (value === "newsEvents") {
        return t(language, "News & Events");
    }
    if (value === "lastUsed") {
        return t(language, "Last Used");
    }
    return t(language, "Friends");
}

export function nextSocialEntryDefault(current: SocialEntryDefault) {
    const currentIndex = SOCIAL_ENTRY_DEFAULT_OPTIONS.indexOf(current);

    return SOCIAL_ENTRY_DEFAULT_OPTIONS[(currentIndex + 1) % SOCIAL_ENTRY_DEFAULT_OPTIONS.length];
}

export function activityCardActionLabel(value: ActivityCardAction, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "achievement") {
        return t(language, "Achievement");
    }
    if (value === "game") {
        return t(language, "Game");
    }
    return t(language, "Profile");
}

export function nextActivityCardAction(current: ActivityCardAction) {
    const currentIndex = ACTIVITY_CARD_ACTION_OPTIONS.indexOf(current);

    return ACTIVITY_CARD_ACTION_OPTIONS[(currentIndex + 1) % ACTIVITY_CARD_ACTION_OPTIONS.length];
}

export function returnStaggerFramesLabel(value: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === 0) {
        return t(language, "Disabled");
    }

    return `${value}`;
}

export function nextReturnStaggerFrames(current: number) {
    const normalized = RETURN_STAGGER_FRAME_OPTIONS.includes(current as any) ? current : 0;
    const currentIndex = RETURN_STAGGER_FRAME_OPTIONS.indexOf(normalized as any);

    return RETURN_STAGGER_FRAME_OPTIONS[(currentIndex + 1) % RETURN_STAGGER_FRAME_OPTIONS.length];
}

export function ipcSlowThresholdMsLabel(value: number) {
    return `${value} ms`;
}

export function nextIpcSlowThresholdMs(current: number) {
    const normalized = IPC_SLOW_THRESHOLD_MS_OPTIONS.includes(current as any) ? current : 250;
    const currentIndex = IPC_SLOW_THRESHOLD_MS_OPTIONS.indexOf(normalized as any);

    return IPC_SLOW_THRESHOLD_MS_OPTIONS[(currentIndex + 1) % IPC_SLOW_THRESHOLD_MS_OPTIONS.length];
}

export function largeViewportBonusLabel(value: number) {
    return `${value}`;
}

export function nextLargeViewportBonus(current: number) {
    const normalized = LARGE_VIEWPORT_BONUS_OPTIONS.includes(current as any) ? current : 8;
    const currentIndex = LARGE_VIEWPORT_BONUS_OPTIONS.indexOf(normalized as any);

    return LARGE_VIEWPORT_BONUS_OPTIONS[(currentIndex + 1) % LARGE_VIEWPORT_BONUS_OPTIONS.length];
}

export function parallelRaCallsLabel(value: number) {
    return `${value}`;
}

export function nextParallelRaCalls(current: number) {
    const normalized = PARALLEL_RA_CALLS_OPTIONS.includes(current as any) ? current : 4;
    const currentIndex = PARALLEL_RA_CALLS_OPTIONS.indexOf(normalized as any);

    return PARALLEL_RA_CALLS_OPTIONS[(currentIndex + 1) % PARALLEL_RA_CALLS_OPTIONS.length];
}

export function parallelCdnFetchesLabel(value: number) {
    return `${value}`;
}

export function nextParallelCdnFetches(current: number) {
    const normalized = PARALLEL_CDN_FETCHES_OPTIONS.includes(current as any) ? current : 5;
    const currentIndex = PARALLEL_CDN_FETCHES_OPTIONS.indexOf(normalized as any);

    return PARALLEL_CDN_FETCHES_OPTIONS[(currentIndex + 1) % PARALLEL_CDN_FETCHES_OPTIONS.length];
}

export function maxIconWorkersLabel(value: number) {
    return `${value}`;
}

export function nextMaxIconWorkers(current: number) {
    const normalized = MAX_ICON_WORKERS_OPTIONS.includes(current as any) ? current : 6;
    const currentIndex = MAX_ICON_WORKERS_OPTIONS.indexOf(normalized as any);

    return MAX_ICON_WORKERS_OPTIONS[(currentIndex + 1) % MAX_ICON_WORKERS_OPTIONS.length];
}

export function avatarWorkersLabel(value: number) {
    return `${value}`;
}

export function nextAvatarWorkers(current: number) {
    const normalized = AVATAR_WORKERS_OPTIONS.includes(current as any) ? current : 4;
    const currentIndex = AVATAR_WORKERS_OPTIONS.indexOf(normalized as any);

    return AVATAR_WORKERS_OPTIONS[(currentIndex + 1) % AVATAR_WORKERS_OPTIONS.length];
}

export function gameIconWorkersLabel(value: number) {
    return `${value}`;
}

export function nextGameIconWorkers(current: number) {
    const normalized = GAME_ICON_WORKERS_OPTIONS.includes(current as any) ? current : 6;
    const currentIndex = GAME_ICON_WORKERS_OPTIONS.indexOf(normalized as any);

    return GAME_ICON_WORKERS_OPTIONS[(currentIndex + 1) % GAME_ICON_WORKERS_OPTIONS.length];
}

export function nightModeBrightnessLabel(value: number) {
    return value.toFixed(2);
}

export function nextNightModeBrightness(current: number) {
    const normalized = NIGHT_MODE_BRIGHTNESS_OPTIONS.includes(current as any) ? current : 0.75;
    const currentIndex = NIGHT_MODE_BRIGHTNESS_OPTIONS.indexOf(normalized as any);

    return NIGHT_MODE_BRIGHTNESS_OPTIONS[(currentIndex + 1) % NIGHT_MODE_BRIGHTNESS_OPTIONS.length];
}

export function gameArtCacheCapLabel(value: number) {
    return `${value}`;
}

export function nextGameArtCacheCap(current: number) {
    const normalized = GAME_ART_CACHE_CAP_OPTIONS.includes(current as any) ? current : 1024;
    const currentIndex = GAME_ART_CACHE_CAP_OPTIONS.indexOf(normalized as any);

    return GAME_ART_CACHE_CAP_OPTIONS[(currentIndex + 1) % GAME_ART_CACHE_CAP_OPTIONS.length];
}

export function avatarCacheCapLabel(value: number) {
    return `${value}`;
}

export function nextAvatarCacheCap(current: number) {
    const normalized = AVATAR_CACHE_CAP_OPTIONS.includes(current as any) ? current : 1024;
    const currentIndex = AVATAR_CACHE_CAP_OPTIONS.indexOf(normalized as any);

    return AVATAR_CACHE_CAP_OPTIONS[(currentIndex + 1) % AVATAR_CACHE_CAP_OPTIONS.length];
}

export function achievementIconCacheGamesLabel(value: number) {
    return `${value}`;
}

export function nextAchievementIconCacheGames(current: number) {
    const normalized = ACHIEVEMENT_ICON_CACHE_GAMES_OPTIONS.includes(current as any) ? current : 8;
    const currentIndex = ACHIEVEMENT_ICON_CACHE_GAMES_OPTIONS.indexOf(normalized as any);

    return ACHIEVEMENT_ICON_CACHE_GAMES_OPTIONS[(currentIndex + 1) % ACHIEVEMENT_ICON_CACHE_GAMES_OPTIONS.length];
}

export function fisTickFrequencyMinutesLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    return minutes === 1 ? t(language, "{{minutes}} minute", { minutes }) : t(language, "{{minutes}} minutes", { minutes });
}

export function nextFisTickFrequencyMinutes(current: number) {
    const normalized = FIS_TICK_FREQUENCY_MINUTES_OPTIONS.includes(current as any) ? current : 5;
    const currentIndex = FIS_TICK_FREQUENCY_MINUTES_OPTIONS.indexOf(normalized as any);

    return FIS_TICK_FREQUENCY_MINUTES_OPTIONS[(currentIndex + 1) % FIS_TICK_FREQUENCY_MINUTES_OPTIONS.length];
}

export function commentsCheckFrequencyLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    return minutes === 1 ? t(language, "{{minutes}} minute", { minutes }) : t(language, "{{minutes}} minutes", { minutes });
}

export function nextCommentsCheckFrequencyMinutes(current: number) {
    const normalized = COMMENTS_CHECK_FREQUENCY_MINUTES_OPTIONS.includes(current as any) ? current : 5;
    const currentIndex = COMMENTS_CHECK_FREQUENCY_MINUTES_OPTIONS.indexOf(normalized as any);

    return COMMENTS_CHECK_FREQUENCY_MINUTES_OPTIONS[(currentIndex + 1) % COMMENTS_CHECK_FREQUENCY_MINUTES_OPTIONS.length];
}

export function trackedSetRefreshFrequencyLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    return minutes === 1 ? t(language, "{{minutes}} minute", { minutes }) : t(language, "{{minutes}} minutes", { minutes });
}

export function nextTrackedSetRefreshMinutes(current: number) {
    const normalized = TRACKED_SETS_REFRESH_MINUTES_OPTIONS.includes(current as any) ? current : 15;
    const currentIndex = TRACKED_SETS_REFRESH_MINUTES_OPTIONS.indexOf(normalized as any);

    return TRACKED_SETS_REFRESH_MINUTES_OPTIONS[(currentIndex + 1) % TRACKED_SETS_REFRESH_MINUTES_OPTIONS.length];
}

export function playersNearYouLookbehindLabel(value: number) {
    return `${value}`;
}

export function nextPlayersNearYouLookbehind(current: number) {
    const normalized = PLAYERS_NEAR_YOU_LOOKBEHIND_OPTIONS.includes(current as any) ? current : 2;
    const currentIndex = PLAYERS_NEAR_YOU_LOOKBEHIND_OPTIONS.indexOf(normalized as any);

    return PLAYERS_NEAR_YOU_LOOKBEHIND_OPTIONS[(currentIndex + 1) % PLAYERS_NEAR_YOU_LOOKBEHIND_OPTIONS.length];
}

export function playersNearYouLookaheadLabel(value: number) {
    return `${value}`;
}

export function nextPlayersNearYouLookahead(current: number) {
    const normalized = PLAYERS_NEAR_YOU_LOOKAHEAD_OPTIONS.includes(current as any) ? current : 6;
    const currentIndex = PLAYERS_NEAR_YOU_LOOKAHEAD_OPTIONS.indexOf(normalized as any);

    return PLAYERS_NEAR_YOU_LOOKAHEAD_OPTIONS[(currentIndex + 1) % PLAYERS_NEAR_YOU_LOOKAHEAD_OPTIONS.length];
}

export function playersNearYouMinTickMinutesLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    return minutes === 1 ? t(language, "{{minutes}} minute", { minutes }) : t(language, "{{minutes}} minutes", { minutes });
}

export function nextPlayersNearYouMinTickMinutes(current: number) {
    const normalized = PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS.includes(current as any) ? current : 5;
    const currentIndex = PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS.indexOf(normalized as any);

    return PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS[(currentIndex + 1) % PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS.length];
}

export function playersNearYouMaxTickMinutesLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    return minutes === 1 ? t(language, "{{minutes}} minute", { minutes }) : t(language, "{{minutes}} minutes", { minutes });
}

export function nextPlayersNearYouMaxTickMinutes(current: number) {
    const normalized = PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS.includes(current as any) ? current : 15;
    const currentIndex = PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS.indexOf(normalized as any);

    return PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS[(currentIndex + 1) % PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS.length];
}

export function gamesListCacheMinutesLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (minutes >= 10080) {
        return t(language, "1 week");
    }
    if (minutes % 1440 === 0) {
        const days = minutes / 1440;
        return days === 1 ? t(language, "{{days}} day", { days }) : t(language, "{{days}} days", { days });
    }
    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return hours === 1 ? t(language, "{{hours}} hour", { hours }) : t(language, "{{hours}} hours", { hours });
    }

    return minutes === 1 ? t(language, "{{minutes}} minute", { minutes }) : t(language, "{{minutes}} minutes", { minutes });
}

export function nextGamesListCacheMinutes(current: number) {
    const normalized = GAMES_LIST_CACHE_MINUTE_OPTIONS.includes(current as any) ? current : 15;
    const currentIndex = GAMES_LIST_CACHE_MINUTE_OPTIONS.indexOf(normalized as any);

    return GAMES_LIST_CACHE_MINUTE_OPTIONS[(currentIndex + 1) % GAMES_LIST_CACHE_MINUTE_OPTIONS.length];
}

export function awardsListCacheMinutesLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    return gamesListCacheMinutesLabel(minutes, language);
}

export function nextAwardsListCacheMinutes(current: number) {
    return nextGamesListCacheMinutes(current);
}

export function wantToPlayCacheMinutesLabel(minutes: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    return gamesListCacheMinutesLabel(minutes, language);
}

export function nextWantToPlayCacheMinutes(current: number) {
    return nextGamesListCacheMinutes(current);
}

export function playersNearYouTapModeLabel(value: PlayersNearYouTapMode, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "achievement") {
        return t(language, "Achievement");
    }
    if (value === "game") {
        return t(language, "Game");
    }
    return t(language, "Profile");
}

export function nextPlayersNearYouTapMode(current: PlayersNearYouTapMode) {
    const currentIndex = PLAYERS_NEAR_YOU_TAP_MODE_OPTIONS.indexOf(current);

    return PLAYERS_NEAR_YOU_TAP_MODE_OPTIONS[(currentIndex + 1) % PLAYERS_NEAR_YOU_TAP_MODE_OPTIONS.length];
}

export function playersNearYouModeLabel(value: PlayersNearYouMode, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "classic") {
        return t(language, "pny_style_classic");
    }
    if (value === "recent") {
        return t(language, "pny_style_recent");
    }
    if (value === "off") {
        return t(language, "pny_style_off");
    }
    return t(language, "pny_style_enhanced");
}

export function playersNearYouModeHelp(value: PlayersNearYouMode, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "classic") {
        return t(language, "help_pny_style_classic");
    }
    if (value === "recent") {
        return t(language, "help_pny_style_recent");
    }
    if (value === "off") {
        return t(language, "help_pny_style_off");
    }
    return t(language, "help_pny_style_enhanced");
}

export function nextPlayersNearYouMode(current: PlayersNearYouMode) {
    const currentIndex = PLAYERS_NEAR_YOU_MODE_OPTIONS.indexOf(current);

    return PLAYERS_NEAR_YOU_MODE_OPTIONS[(currentIndex + 1) % PLAYERS_NEAR_YOU_MODE_OPTIONS.length];
}

export function commentsServiceFetchAmountLabel(value: number) {
    return `${value}`;
}

export function nextCommentsServiceFetchAmount(current: number) {
    const normalized = COMMENTS_SERVICE_FETCH_AMOUNT_OPTIONS.includes(current as any) ? current : 20;
    const currentIndex = COMMENTS_SERVICE_FETCH_AMOUNT_OPTIONS.indexOf(normalized as any);

    return COMMENTS_SERVICE_FETCH_AMOUNT_OPTIONS[(currentIndex + 1) % COMMENTS_SERVICE_FETCH_AMOUNT_OPTIONS.length];
}

export function fisRosterRefreshIntervalHoursLabel(hours: number, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (hours === FIS_ROSTER_REFRESH_NEVER) {
        return t(language, "Never");
    }
    if (hours === 1) {
        return t(language, "{{hours}} hour", { hours });
    }
    return t(language, "{{hours}} hours", { hours });
}

export function nextFisRosterRefreshIntervalHours(current: number) {
    const normalized = FIS_ROSTER_REFRESH_INTERVAL_HOURS_OPTIONS.includes(current as any) ? current : 6;
    const currentIndex = FIS_ROSTER_REFRESH_INTERVAL_HOURS_OPTIONS.indexOf(normalized as any);

    return FIS_ROSTER_REFRESH_INTERVAL_HOURS_OPTIONS[(currentIndex + 1) % FIS_ROSTER_REFRESH_INTERVAL_HOURS_OPTIONS.length];
}


export function nextDynamicInitialRows(current: number) {
    const normalized = DYNAMIC_INITIAL_ROW_OPTIONS.includes(current as any) ? current : 30;
    const currentIndex = DYNAMIC_INITIAL_ROW_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_INITIAL_ROW_OPTIONS[(currentIndex + 1) % DYNAMIC_INITIAL_ROW_OPTIONS.length];
}

export function nextDynamicRowStep(current: number) {
    const normalized = DYNAMIC_ROW_STEP_OPTIONS.includes(current as any) ? current : 30;
    const currentIndex = DYNAMIC_ROW_STEP_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_ROW_STEP_OPTIONS[(currentIndex + 1) % DYNAMIC_ROW_STEP_OPTIONS.length];
}

export function nextDynamicPrefetchDistance(current: number) {
    const normalized = DYNAMIC_PREFETCH_DISTANCE_OPTIONS.includes(current as any) ? current : 12;
    const currentIndex = DYNAMIC_PREFETCH_DISTANCE_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_PREFETCH_DISTANCE_OPTIONS[(currentIndex + 1) % DYNAMIC_PREFETCH_DISTANCE_OPTIONS.length];
}

export function nextDynamicSentinelRootMargin(current: number) {
    const normalized = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.includes(current as any) ? current : 600;
    const currentIndex = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS[(currentIndex + 1) % DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.length];
}

export function nextDynamicTrackedListInitialRows(current: number) {
    const normalized = DYNAMIC_INITIAL_ROW_OPTIONS.includes(current as any) ? current : 10;
    const currentIndex = DYNAMIC_INITIAL_ROW_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_INITIAL_ROW_OPTIONS[(currentIndex + 1) % DYNAMIC_INITIAL_ROW_OPTIONS.length];
}

export function nextDynamicTrackedListRowStep(current: number) {
    const normalized = DYNAMIC_ROW_STEP_OPTIONS.includes(current as any) ? current : 10;
    const currentIndex = DYNAMIC_ROW_STEP_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_ROW_STEP_OPTIONS[(currentIndex + 1) % DYNAMIC_ROW_STEP_OPTIONS.length];
}

export function nextDynamicTrackedListPrefetchDistance(current: number) {
    const normalized = DYNAMIC_PREFETCH_DISTANCE_OPTIONS.includes(current as any) ? current : 12;
    const currentIndex = DYNAMIC_PREFETCH_DISTANCE_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_PREFETCH_DISTANCE_OPTIONS[(currentIndex + 1) % DYNAMIC_PREFETCH_DISTANCE_OPTIONS.length];
}

export function nextDynamicTrackedListSentinelRootMargin(current: number) {
    const normalized = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.includes(current as any) ? current : 600;
    const currentIndex = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS[(currentIndex + 1) % DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.length];
}

export function nextDynamicTrackedSetsListInitialRows(current: number) {
    const normalized = DYNAMIC_INITIAL_ROW_OPTIONS.includes(current as any) ? current : 10;
    const currentIndex = DYNAMIC_INITIAL_ROW_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_INITIAL_ROW_OPTIONS[(currentIndex + 1) % DYNAMIC_INITIAL_ROW_OPTIONS.length];
}

export function nextDynamicTrackedSetsListRowStep(current: number) {
    const normalized = DYNAMIC_ROW_STEP_OPTIONS.includes(current as any) ? current : 10;
    const currentIndex = DYNAMIC_ROW_STEP_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_ROW_STEP_OPTIONS[(currentIndex + 1) % DYNAMIC_ROW_STEP_OPTIONS.length];
}

export function nextDynamicTrackedSetsListPrefetchDistance(current: number) {
    const normalized = DYNAMIC_PREFETCH_DISTANCE_OPTIONS.includes(current as any) ? current : 12;
    const currentIndex = DYNAMIC_PREFETCH_DISTANCE_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_PREFETCH_DISTANCE_OPTIONS[(currentIndex + 1) % DYNAMIC_PREFETCH_DISTANCE_OPTIONS.length];
}

export function nextDynamicTrackedSetsListSentinelRootMargin(current: number) {
    const normalized = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.includes(current as any) ? current : 600;
    const currentIndex = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS[(currentIndex + 1) % DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.length];
}

export function nextDynamicGameNotesInitialRows(current: number) {
    const normalized = DYNAMIC_INITIAL_ROW_OPTIONS.includes(current as any) ? current : 10;
    const currentIndex = DYNAMIC_INITIAL_ROW_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_INITIAL_ROW_OPTIONS[(currentIndex + 1) % DYNAMIC_INITIAL_ROW_OPTIONS.length];
}

export function nextDynamicGameNotesRowStep(current: number) {
    const normalized = DYNAMIC_ROW_STEP_OPTIONS.includes(current as any) ? current : 10;
    const currentIndex = DYNAMIC_ROW_STEP_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_ROW_STEP_OPTIONS[(currentIndex + 1) % DYNAMIC_ROW_STEP_OPTIONS.length];
}

export function nextDynamicGameNotesPrefetchDistance(current: number) {
    const normalized = DYNAMIC_PREFETCH_DISTANCE_OPTIONS.includes(current as any) ? current : 12;
    const currentIndex = DYNAMIC_PREFETCH_DISTANCE_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_PREFETCH_DISTANCE_OPTIONS[(currentIndex + 1) % DYNAMIC_PREFETCH_DISTANCE_OPTIONS.length];
}

export function nextDynamicGameNotesSentinelRootMargin(current: number) {
    const normalized = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.includes(current as any) ? current : 600;
    const currentIndex = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS[(currentIndex + 1) % DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.length];
}

export function nextDynamicCommentsInitialRows(current: number) {
    const normalized = DYNAMIC_INITIAL_ROW_OPTIONS.includes(current as any) ? current : 10;
    const currentIndex = DYNAMIC_INITIAL_ROW_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_INITIAL_ROW_OPTIONS[(currentIndex + 1) % DYNAMIC_INITIAL_ROW_OPTIONS.length];
}

export function nextDynamicCommentsRowStep(current: number) {
    const normalized = DYNAMIC_ROW_STEP_OPTIONS.includes(current as any) ? current : 10;
    const currentIndex = DYNAMIC_ROW_STEP_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_ROW_STEP_OPTIONS[(currentIndex + 1) % DYNAMIC_ROW_STEP_OPTIONS.length];
}

export function nextDynamicCommentsSentinelRootMargin(current: number) {
    const normalized = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.includes(current as any) ? current : 600;
    const currentIndex = DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.indexOf(normalized as any);

    return DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS[(currentIndex + 1) % DYNAMIC_SENTINEL_ROOT_MARGIN_OPTIONS.length];
}

