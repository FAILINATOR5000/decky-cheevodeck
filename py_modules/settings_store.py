from pathlib import Path

import re
import threading
import time

from utils import ensure_dir, load_json_file, norm_game_id, save_json_file, to_float, to_int

BIG_LIST_THRESHOLD_DISABLED = 9999
RETURN_STAGGER_FRAME_OPTIONS = {0, 1, 2, 3, 4, 5, 6, 7, 8}
DYNAMIC_INITIAL_ROW_OPTIONS = set(range(10, 85, 5))
DYNAMIC_ROW_STEP_OPTIONS = {1, 3, 5, 10, 15, 20, 25, 30}
DYNAMIC_PREFETCH_DISTANCE_OPTIONS = set(range(4, 32, 2))
DYNAMIC_SENTINEL_MARGIN_OPTIONS = set(range(200, 1450, 50))
UNLOCK_HISTORY_DAY_OPTIONS = {-1, 7, 14, 30, 60, 90}
ACTIVITY_CACHE_MINUTE_OPTIONS = {1, 2, 3, 4, 5, 10, 15, 20, 30, 60}
TRICKLE_LOOKBACK_HOUR_OPTIONS = {1, 2, 3, 4, 5, 6, 7, 8}
ACTIVITY_FRIENDS_PER_TICK_OPTIONS = {3, 4, 5}
IPC_SLOW_THRESHOLD_MS_OPTIONS = {50, 100, 150, 200, 250, 300, 350, 400, 450, 500}
PARALLEL_RA_CALLS_OPTIONS = {1, 2, 3, 4, 5, 6, 7, 8}
LARGE_VIEWPORT_BONUS_OPTIONS = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14}
PARALLEL_CDN_FETCHES_OPTIONS = {1, 2, 3, 4, 5, 6, 7, 8}
MAX_ICON_WORKERS_OPTIONS = {1, 2, 3, 4, 5, 6, 7, 8}

AVATAR_WORKERS_OPTIONS = {1, 2, 3, 4, 5, 6, 7, 8}

GAME_ICON_WORKERS_OPTIONS = {1, 2, 3, 4, 5, 6, 7, 8}

GUIDE_ZOOM_MIN = 30
GUIDE_ZOOM_MAX = 200
GUIDE_ZOOM_STEP = 5
GUIDE_ZOOM_DEFAULT = 100

GUIDE_MODAL_ZOOM_DEFAULT = 105

TEXT_VIEWER_ZOOM_DEFAULT = 130

NIGHT_MODE_BRIGHTNESS_OPTIONS = {0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85}

GAME_ART_CACHE_CAP_OPTIONS = {512, 1024, 2048, 4096}
AVATAR_CACHE_CAP_OPTIONS = {512, 1024, 2048, 4096}
ACHIEVEMENT_ICON_CACHE_GAMES_OPTIONS = {8, 16, 24, 32, 64}

FIS_TICK_FREQUENCY_MINUTES_OPTIONS = {1, 2, 3, 4, 5, 10, 15, 30, 60}

FIS_ROSTER_REFRESH_NEVER = -1
FIS_ROSTER_REFRESH_INTERVAL_HOURS_OPTIONS = {
    1,
    3,
    6,
    12,
    24,
    48,
    FIS_ROSTER_REFRESH_NEVER,
}

COMMENTS_SERVICE_TICK_MINUTES_OPTIONS = {1, 2, 3, 4, 5, 10, 15, 30, 60, 120, 180}
COMMENTS_SERVICE_FETCH_AMOUNT_OPTIONS = {5, 10, 15, 20, 25, 30}

TRACKED_SETS_REFRESH_MINUTES_OPTIONS = {1, 5, 10, 15, 30, 60, 120}

PLAYERS_NEAR_YOU_LOOKBEHIND_OPTIONS = {0, 1, 2, 3, 4, 5}
PLAYERS_NEAR_YOU_LOOKAHEAD_OPTIONS = {2, 4, 6, 8, 10, 12}

PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS = {1, 2, 3, 5, 10, 15, 30, 60}
GAMES_LIST_CACHE_MINUTE_VALUES = {1, 5, 10, 15, 20, 30, 60, 120, 180, 720, 1440, 10080}

TRACKED_NOTE_MAX_LEN = 300

_NOTE_COLOR_OPTIONS = (
    "default", "green", "amber", "orange", "red", "pink", "purple",
    "blue", "sky", "cyan", "teal", "lime", "gray", "indigo",
    "rose", "fuchsia", "violet", "emerald", "yellow", "brown",
    "slate", "crimson", "mint", "coral", "gold", "steel",
)

_TAG_PREFIX_PATTERN = re.compile(r"^\s*\[([^\]\n]{1,24})\]\s*")

_TAG_VOCAB_LIMIT = 20

_MAX_RESUME_NAV_DEPTH = 12

_ALLOWED_RESUME_VIEWS = {
    "achievements",
    "tracked",
    "social",
    "comparePicker",
    "friendGame",
    "friendAllGames",
    "friendCompare",
    "leaderboards",
    "leaderboardDetail",
    "options",
    "unlockHistory",
    "about",
    "gameNotes",
    "badges",
    "gameOverview",
    "achievementOverview",
    "wantToPlay",
    "followedRanking",
    "trackedSets",
    "trackedSetOpen",
    "utils",
    "dolphinMapper",
    "smbShares",
    "cheevoCheck",
    "fileWatcher",
    "guides",
}

_ALLOWED_NOW_PLAYING_COMPARE_FILTERS = {"all", "onlyYou", "onlyThem", "shared"}
_ALLOWED_MAIN_ACHIEVEMENTS_TABS = {"achievements", "activity", "comments", "compare"}
_ALLOWED_LEADERBOARDS_SOURCE_VIEWS = {"achievements", "friendGame", "gameOverview"}
_ALLOWED_UNLOCK_HISTORY_SOURCES = {"main", "friendGame"}
_ALLOWED_BADGE_FILTERS = {"all", "mastered", "beaten", "event", "other"}
_ALLOWED_ALL_GAMES_RANGES = {"numbers", "a-f", "g-l", "m-r", "s-u", "v-z"}
_ALLOWED_ALL_GAMES_STATUS_FILTERS = {
    "all",
    "mastered",
    "completed",
    "beaten-hardcore",
    "beaten-softcore",
    "unfinished",
}

_ALLOWED_FOLLOWED_RANKING_METRICS = {"hardcorePoints", "softcorePoints", "retroPoints", "retroRatio"}

_ALLOWED_ACHIEVEMENT_SORTS = {"upNext", "absolute", "mostPoints", "fewestPoints", "rarest", "mostCommon"}

_ALLOWED_TRACKED_SORTS = {"upNext", "manual", "mostPoints", "fewestPoints", "rarest", "mostCommon"}

_ALLOWED_NEWS_EVENTS_SUB_VIEWS = {"news", "aotw", "newSets"}
_ALLOWED_NEW_SETS_FILTERS = {"new", "revision"}
_ALLOWED_AOTW_SUB_VIEWS = {"unlocks", "comments"}

_ALLOWED_GAME_OVERVIEW_SUB_VIEWS = {"achievements", "comments", "hashes"}
_ALLOWED_FRIEND_PROFILE_SUB_VIEWS = {"game", "wall"}

_ALLOWED_GUIDES_SUB_VIEWS = {"list", "reader", "search"}

_ALLOWED_GAME_OVERVIEW_SOURCES = {"main", "newsEvents", "socialActivity", "mainNowPlaying", "friend", "badges", "wantToPlay", "trackedSet", "subscribedDiscussions", "search", "cheevoCheck"}

_ALLOWED_AO_SOURCES = {
    "main",
    "tracked",
    "gameOverview",
    "newsEvents",
    "socialActivity",
    "mainNowPlaying",
    "friend",
    "unlockHistory",
    "notification",
    "subscribedDiscussions",
    "external",
}

_ALLOWED_FRIEND_ENTRY_SOURCES = {"profile", "compareGame"}

BIG_LIST_THRESHOLD_OPTIONS = {
    50,
    75,
    100,
    125,
    150,
    175,
    200,
    225,
    250,
    275,
    300,
    BIG_LIST_THRESHOLD_DISABLED,
}

_ALLOWED_QUICK_MENU_SHORTCUTS = (
    "dolphinMapper",
    "cheevoCheck",
    "smbShares",
    "fileWatcher",
    "socialActivity",
    "visitRa",
    "uiDefault",
    "uiCompact",
)

QUICK_MENU_SHORTCUT_LIMIT = 4


_ALLOWED_SHORTCUT_BUTTONS = ("menu", "view", "l3", "r3", "l4", "l5", "r4", "r5")

_ALLOWED_SHORTCUT_ACTIONS = (
    "none",
    "notifications",
    "pageUp",
    "home",
    "currentGuide",
    "search",
    "profile",
    "socialhub",
    "news",
    "aotw",
    "newsets",
    "subscribeddiscussions",
    "savedcomments",
    "trackedsets",
    "utilities",
    "useraccounts",
    "options",
    "about",
    "refresh",
    "dolphinMapper",
    "cheevoCheck",
    "smbShares",
    "fileWatcher",
    "socialActivity",
    "visitRa",
    "snapshot",
    "nightMode",
    "doNotDisturb",
    "mouseKeyboardMode",
    "cycleUiScale",
)


_ALLOWED_SCALE_PRESETS = ("portable", "bigScreen", "bigText")


def _default_shortcut_bindings() -> dict:
    return {
        "menu": "notifications",
        "view": "pageUp",
        "l3": "none",
        "r3": "none",
        "l4": "none",
        "l5": "none",
        "r4": "none",
        "r5": "none",
    }


def _default_quick_menu_shortcuts() -> list:
    return ["dolphinMapper", "cheevoCheck", "socialActivity", "visitRa"]


def _default_saved_comments_prefs() -> dict:
    return {"subTab": "subscribed", "sort": "opened", "filter": "all"}


def _snake(key: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()


class _Marker:
    """A named singleton, so a repr in a traceback says which one it is."""

    def __init__(self, name: str):
        self._name = name

    def __repr__(self) -> str:
        return self._name


READ_BOOL = _Marker("READ_BOOL")

PIN_DEFAULT = _Marker("PIN_DEFAULT")

IF_ABSENT = _Marker("IF_ABSENT")

_MISSING = _Marker("_MISSING")


class Knob:
    """One setting, declared once.

    settings.json used to be described in four hand-maintained lists that all
    had to agree: the load_config defaults, the reset baseline, the response
    payload and the display normaliser. Nothing checked that they did, and they
    didn't — nine live knobs were missing from the baseline, so Reset Settings
    quietly skipped them for the project's whole life. All four now derive from
    this one tuple, so a new knob is one row instead of four edits in four
    places 3,000 lines apart.

    Fields, all of them read by one of the four derivations:

    ``default``
        The factory value. ``factory`` instead for the three defaults that are
        mutable (a list or dict shared out of a module-level tuple is the
        classic Python footgun), and ``from_attr`` for the three the constructor
        injects, which a module-level tuple can't see.
    ``reset``
        Whether Reset Settings stamps it. True is the default and the burden is
        on justifying an exemption: five rows opt out, and all five are either a
        credential or a has-this-happened-yet flag rather than a preference.
        This is the rule that used to live in _write_baseline_settings' hand-
        written list, which is how nine knobs went missing from it.
    ``ship``
        Whether it rides along in settings_response to the frontend. Three rows
        opt out.
    ``normalize``
        Whether ensure_display_settings runs it on the way in and out. Opt-in on
        purpose, and deliberately not symmetric with the rest: _update_config
        calls the normaliser twice per write, so 50 knobs that ride through
        untouched today have to keep riding through. Either True (run the row's
        reader), PIN_DEFAULT, IF_ABSENT, or the name of a different method for
        the one knob whose two reads genuinely differ.
    ``read``
        How the value gets read, by both settings_response and the normaliser.
        None means the convention, ``get_`` plus the snake_case key. A string
        names a different method, and READ_BOOL means there is no helper to
        call.

    Not here on purpose: no kind or type field, since no derivation reads one;
    no allowlist, since the 17 _ALLOWED_* tuples already work and are audited
    clean; and no generated setters or getters. The 180 update_* and 182 get_*
    methods stay hand-written. That's the layer with the real exceptions, and
    the layer 181 mixin call sites depend on.
    """

    __slots__ = ("default", "factory", "from_attr", "key", "normalize", "read", "reset", "ship")

    def __init__(
        self,
        key: str,
        *,
        default=_MISSING,
        factory=None,
        from_attr: str | None = None,
        reset: bool = True,
        ship: bool = True,
        normalize=False,
        read=None,
    ):
        if default is _MISSING and factory is None and from_attr is None:
            raise ValueError(f"knob {key!r} declares no default")

        self.key = key
        self.default = default
        self.factory = factory
        self.from_attr = from_attr
        self.reset = reset
        self.ship = ship
        self.normalize = normalize
        self.read = read


_KNOBS = (
    Knob("username", default="", reset=False, read="_read_username"),
    Knob("webApiKey", default="", reset=False, ship=False),
    Knob("users", factory=list, reset=False, normalize="normalize_user_records", read="list_users"),
    Knob("autoRefresh", default=True, normalize=True, read=READ_BOOL),
    Knob("showIcons", default=True, normalize=True, read=READ_BOOL),
    Knob("deferModalCleanup", default=True, normalize=True, read=READ_BOOL),
    Knob("legacyCommentsLoading", default=False, normalize=True, read=READ_BOOL),
    Knob("showAllAchievements", default=True, normalize=True, read=READ_BOOL),
    Knob("unlockLookbackMinutes", from_attr="_recent_unlock_lookback_minutes", normalize=True),
    Knob("unlockHistoryDays", from_attr="_recent_unlock_history_days", normalize=True),
    Knob("rememberLastPage", default=True, normalize=True, read=READ_BOOL),
    Knob("uiSize", default="normal", normalize=True),
    Knob("achievementTextScale", default="normal", normalize=True),
    Knob("commentsTextScale", default="normal", normalize=True),
    Knob("textScale", default="normal", normalize=True),
    Knob("titleScale", default="normal", normalize=True),
    Knob("headerScale", default="normal", normalize=True),
    Knob("bannerScale", default="normal", normalize=True),
    Knob("modalScale", default="normal", normalize=True),
    Knob("guideZoom", default=GUIDE_ZOOM_DEFAULT),
    Knob("guideModalZoom", default=GUIDE_MODAL_ZOOM_DEFAULT),
    Knob("textViewerZoom", default=TEXT_VIEWER_ZOOM_DEFAULT),
    Knob("pinLatestGuides", default=False, normalize=True),
    Knob("keepGuidesOffline", default=False, normalize=True),
    Knob("topPadding", default=0, normalize=PIN_DEFAULT),
    Knob("blockPadding", default=8, normalize=True),
    Knob("buttonSpacing", default="verysmall", normalize=True),
    Knob("mouseKeyboardMode", default=False, normalize=True, read=READ_BOOL),
    Knob("controllerGlyphStyle", default="auto", normalize=True),
    Knob("coloredGlyphs", default=True, normalize=True, read=READ_BOOL),
    Knob("showAButtonMode", default=True, normalize=True),
    Knob("showAButtonModeTracked", default=True, normalize=True),
    Knob("gameNotesAButtonMode", default="editNote", normalize=True),
    Knob("showSocialHubButton", default=True, normalize=True),
    Knob("showTrackedSetsButton", default=True, normalize=True),
    Knob("putUpdaterOnDesktop", default=True, normalize=True),
    Knob("showOptionsButton", default=False, normalize=True),
    Knob("quickMenuShortcuts", factory=_default_quick_menu_shortcuts, normalize=True),
    Knob("shortcutBindings", factory=_default_shortcut_bindings, normalize=True),
    Knob("lastScalePreset", default="portable", normalize=True),
    Knob("showAllToggleMain", default=False, normalize=True),
    Knob("showAllToggleFriend", default=False, normalize=True),
    Knob("showTrackedNotesMain", default=False, normalize=True),
    Knob("showRetroPoints", default=False, normalize=True),
    Knob("achievementStyle", default="left", normalize=True),
    Knob("trackedColor", default="default", normalize=True),
    Knob("mainAchievementFilter", default="all", normalize=True),
    Knob("mainAchievementSort", default="upNext", normalize=True),
    Knob("mainAchievementAction", default="track", normalize=True),
    Knob("trackedAchievementAction", default="editNote", normalize=True),
    Knob("dolphinMapperMode", default="map", normalize=True),
    Knob("dolphinSystemFilter", default="all", normalize=True),
    Knob("dolphinBluetoothPassthrough", default=False, normalize=True),
    Knob("dolphinContinuousScanning", default=False, normalize=True),
    Knob("dolphinBalanceBoard", default=False, normalize=True),
    Knob("cheevoCheckCacheHashes", default=True, normalize=True, read=READ_BOOL),
    Knob("cheevoCheckExtractToRam", default=False, normalize=True, read=READ_BOOL),
    Knob("cheevoCheckVerifyHashes", default=False, normalize=True, read=READ_BOOL),
    Knob("cheevoCheckVerifySpeed", default="full", normalize=True),
    Knob("cheevoCheckScanCollapsed", default=False, normalize=True, read=READ_BOOL),
    Knob("cheevoCheckResultsCollapsed", default=False, normalize=True, read=READ_BOOL),
    Knob("cheevoCheckVerifyCollapsed", default=False, normalize=True, read=READ_BOOL),
    Knob("cheevoCheckOptionsCollapsed", default=False, normalize=True, read=READ_BOOL),
    Knob("cheevoCheckSkipDiscVerify", default=False, normalize=True, read=READ_BOOL),
    Knob("cheevoCheckSkipCartVerify", default=False, normalize=True, read=READ_BOOL),
    Knob("libraryBadge", default=False, normalize=True, read=READ_BOOL),
    Knob("fileWatcherSpeed", default="gentle", normalize=True),
    Knob("fileWatcherRunDuringGames", default=True, normalize=True, read=READ_BOOL),
    Knob("trackedSetAButtonMode", default="editNote", normalize=True),
    Knob("trackedAchievementSort", default="upNext", normalize=True),
    Knob("friendAchievementFilter", default="all", normalize=True),
    Knob("friendAchievementSort", default="upNext", normalize=True),
    Knob("friendShowAllAchievements", default=True, normalize=True),
    Knob("language", from_attr="_default_language", reset=False, normalize=True),
    Knob("friendRefreshDelayMs", default=1000, normalize=True),
    Knob("activityCacheMinutes", default=5, normalize=True),
    Knob("trickleLookbackHours", default=3, normalize=True),
    Knob("activityFriendsPerTick", default=3, normalize=True),
    Knob("socialGameTicker", default=True, normalize=True),
    Knob("socialHubTicker", default=True, normalize=True),
    Knob("socialActivityTrickleService", default=True),
    Knob("trickleFavoritesOnly", default=False),
    Knob("friendAutoRefresh", default=True, normalize=True),
    Knob("showReminderTicker", default=False, normalize=True),
    Knob("showNotesDot", default=False, normalize=True),
    Knob("showBellDot", default=True, normalize=True),
    Knob("doNotDisturb", default=False, normalize=True),
    Knob("doNotDisturbDisablesDot", default=True, normalize=True),
    Knob("doNotDisturbDisablesToast", default=True, normalize=True),
    Knob("nightMode", default=False, normalize=True),
    Knob("nightModeBrightness", default=0.75, normalize=True),
    Knob("batterySaver", default=False, normalize=True),
    Knob("batterySaverDisablesSocialActivity", default=True, normalize=True),
    Knob("batterySaverDisablesComments", default=True, normalize=True),
    Knob("batterySaverDisablesFriendAvatars", default=True, normalize=True),
    Knob("batterySaverDisablesPlayersNearYou", default=True, normalize=True),
    Knob("batterySaverDisablesTrackedSets", default=True, normalize=True),
    Knob("batterySaverDisablesFileWatcher", default=True, normalize=True),
    Knob("notifyNoteReminderEnabled", default=True),
    Knob("notifyNoteReminderToast", default=True),
    Knob("notifyTrackedSetEnabled", default=True),
    Knob("notifyTrackedSetToast", default=True),
    Knob("notifyCommentTrackerEnabled", default=True),
    Knob("notifyCommentTrackerToast", default=True),
    Knob("notifyWallEnabled", default=True),
    Knob("notifyWallToast", default=True),
    Knob("notifySystemEnabled", default=True),
    Knob("notifySystemToast", default=True),
    Knob("notifyTrackedEnabled", default=False),
    Knob("notifyTrackedToast", default=False),
    Knob("notifySocialUnlockEnabled", default=False),
    Knob("notifySocialUnlockToast", default=False),
    Knob("notifyNearYouEnabled", default=False),
    Knob("notifyNearYouToast", default=False),
    Knob("notifyDebugEnabled", default=False),
    Knob("notifyDebugToast", default=False),
    Knob("legacyAchievementLinks", default=False, normalize=True),
    Knob("legacyGameLinks", default=False, normalize=True),
    Knob("autoPurgeService", default=True, normalize=True),
    Knob("debugLogging", default=False, normalize=True),
    Knob("injectEmulatorLogin", default=False, normalize=True),
    Knob("showDeveloperOptions", default=False),
    Knob("ipcSlowThresholdMs", default=250, normalize=True),
    Knob("largeViewportBonusEnabled", default=True, normalize=True),
    Knob("largeViewportBonus", default=8, normalize=True),
    Knob("parallelRaCalls", default=4, normalize=True),
    Knob("parallelCdnFetches", default=5, normalize=True),
    Knob("maxIconWorkers", default=6, normalize=True),
    Knob("avatarWorkers", default=4, normalize=True),
    Knob("gameIconWorkers", default=6, normalize=True),
    Knob("gameArtCacheCap", default=1024, normalize=True),
    Knob("avatarCacheCap", default=1024, normalize=True),
    Knob("achievementIconCacheGames", default=8, normalize=True),
    Knob("friendImageService", default=True),
    Knob("validateFriendsRoster", default=True),
    Knob("fisTickFrequencyMinutes", default=5),
    Knob("fisRosterRefreshIntervalHours", default=6),
    Knob("fisVerifyFavoriteAvatars", default=True),
    Knob("fisVerifyAllAvatars", default=False),
    Knob("commentsServiceTickMinutes", default=5),
    Knob("commentsServiceFetchAmount", default=20),
    Knob("commentsServiceWallCheck", default=True),
    Knob("playersNearYouEnabled", default=True),
    Knob("playersNearYouLookbehind", default=2),
    Knob("playersNearYouLookahead", default=6),
    Knob("playersNearYouMinTickMinutes", default=5),
    Knob("playersNearYouMaxTickMinutes", default=15),
    Knob("playersNearYouTapMode", default="profile"),
    Knob("playersNearYouCollapsed", default=False),
    Knob("dolphinAdvancedCollapsed", default=True),
    Knob("dolphinMappingsSeeded", default=False, reset=False, ship=False),
    Knob("gamesListCacheMinutes", default=20),
    Knob("awardsListCacheMinutes", default=15),
    Knob("wantToPlayCacheMinutes", default=20),
    Knob("bigListThreshold", default=BIG_LIST_THRESHOLD_DISABLED, normalize=True),
    Knob("alwaysStaggerMounting", default=False, normalize=True),
    Knob("returnStaggerFrames", default=0, normalize=True),
    Knob("dynamicLoading", default=True, normalize=True),
    Knob("dynamicInitialRows", default=30, normalize=True),
    Knob("dynamicRowStep", default=30, normalize=True),
    Knob("dynamicPrefetchDistance", default=12, normalize=True),
    Knob("dynamicSentinelRootMargin", default=600, normalize=True),
    Knob("dynamicTrackedListLoading", default=True, normalize=True),
    Knob("dynamicTrackedListInitialRows", default=10, normalize=True),
    Knob("dynamicTrackedListRowStep", default=10, normalize=True),
    Knob("dynamicTrackedListPrefetchDistance", default=12, normalize=True),
    Knob("dynamicTrackedListSentinelRootMargin", default=600, normalize=True),
    Knob("dynamicTrackedSetsListLoading", default=True, normalize=True),
    Knob("dynamicTrackedSetsListInitialRows", default=10, normalize=True),
    Knob("dynamicTrackedSetsListRowStep", default=10, normalize=True),
    Knob("dynamicTrackedSetsListPrefetchDistance", default=12, normalize=True),
    Knob("dynamicTrackedSetsListSentinelRootMargin", default=600, normalize=True),
    Knob("dynamicGameNotesLoading", default=True, normalize=True),
    Knob("dynamicGameNotesInitialRows", default=10, normalize=True),
    Knob("dynamicGameNotesRowStep", default=10, normalize=True),
    Knob("dynamicGameNotesPrefetchDistance", default=12, normalize=True),
    Knob("dynamicGameNotesSentinelRootMargin", default=600, normalize=True),
    Knob("dynamicComments", default=True, normalize=True),
    Knob("dynamicCommentsInitialRows", default=10, normalize=True),
    Knob("dynamicCommentsRowStep", default=10, normalize=True),
    Knob("dynamicCommentsSentinelRootMargin", default=600, normalize=True),
    Knob("trackedSetsAutoCheck", default=True),
    Knob("trackedSetsSelectorSort", default="alphabetical"),
    Knob("trackedSetsSelectorFilter", default="all"),
    Knob("trackedSetsServiceEnabled", default=True),
    Knob("trackedSetsRefreshMinutes", default=15),
    Knob("dynamicFriendLoading", default=True, normalize=True),
    Knob("dynamicLeaderboardLoading", default=True, normalize=True),
    Knob("dynamicLeaderboardResults", default=True, normalize=True),
    Knob("dynamicActivityFeed", default=True, normalize=True),
    Knob("dynamicCompare", default=True, normalize=True),
    Knob("dynamicFriendPicker", default=True, normalize=True),
    Knob("dynamicAllGames", default=True, normalize=True),
    Knob("dynamicTrackedGames", default=True, normalize=True),
    Knob("dynamicBadges", default=True, normalize=True),
    Knob("dynamicFollowedRanking", default=True, normalize=True),
    Knob("lastSocialView", default="friends", normalize=True),
    Knob("badgesSortOrder", default="oldest", normalize=True),
    Knob("lastConsoleId", default=0),
    Knob("cheevoCheckLastSystemId", default=0),
    Knob("socialEntryDefault", default="friends", normalize=True),
    Knob("savedCommentsPrefs", factory=_default_saved_comments_prefs, normalize=True),
    Knob("activityCardAction", default="achievement", normalize=True),
    Knob("friendFeedCardAction", default="achievement", normalize=True),
    Knob("socialHubCardAction", default="achievement", normalize=True),
    Knob("defaultNoteColor", default="default", normalize=True),
    Knob("lastOptionsTab", default="system", normalize=True),
    Knob("lastTrackedTab", default="thisGame", normalize=True),
    Knob("resumeState", default=None, ship=False, normalize=IF_ABSENT),
    Knob("viewedIntro", default=False, reset=False, normalize=True),
    Knob("lastChangelogVersion", default="", reset=False, ship=False),
)

_SETUP_PROFILE_KEYS = (
    "socialGameTicker",
    "socialHubTicker",
    "playersNearYouEnabled",
    "notifyWallEnabled",
    "notifyWallToast",
    "commentsServiceWallCheck",
    "socialActivityTrickleService",
    "trackedSetsServiceEnabled",
    "notifySocialUnlockEnabled",
    "notifySocialUnlockToast",
    "notifyNearYouEnabled",
    "notifyNearYouToast",
    "activityFriendsPerTick",
    "activityCacheMinutes",
)

class SettingsStore:
    """Owns config file I/O and all the getter/normaliser helpers.

    The async save_* RPC methods stay on SettingsMixin; their bodies
    become thin delegations into this store.

    Threading: every public method that mutates settings.json holds
    ``_config_lock`` for the load-modify-save sequence. It's an RLock
    rather than a plain Lock so a mutator that re-enters its own load
    path mid-update can't self-deadlock -- belt and suspenders, kept in
    step with the tracked-file locking below and NotesStore's notes
    locking so all three JSON stores follow the same rule. Pure read
    paths that call ``load_config`` once and don't write are not locked;
    an atomic rename means the worst they see is the old or new file in
    its entirety, never a half-written file.

    Favorited friends are the one bit of account state that no longer
    rides the config: they live in their own per-user ``favorites.json``
    (re-pointed on a switch like the other per-user files) under
    ``_favorites_lock``, a leaf lock that's never held together with
    ``_config_lock`` and so adds no new ordering edge.

    Lock-ordering rule across the three locks in this class plus
    NotesStore: ``_config_lock`` -> ``_tracked_master_lock`` ->
    ``_tracked_game_locks[...]`` -> NotesStore's locks. No current code
    path mixes them, but writing the rule down so we don't paint a
    corner if something ever does.
    """

    def __init__(
        self,
        *,
        config_file: Path,
        tracked_dir: Path,
        favorites_file: Path,
        default_language: str,
        recent_unlock_lookback_minutes: int,
        recent_unlock_history_days: int,
    ):
        self._config_file = config_file
        self._tracked_dir = tracked_dir
        self._favorites_file = favorites_file
        self._default_language = default_language
        self._recent_unlock_lookback_minutes = recent_unlock_lookback_minutes
        self._recent_unlock_history_days = recent_unlock_history_days

        self._config_lock = threading.RLock()

        self._tracked_master_lock = threading.Lock()
        self._tracked_game_locks: dict[str, threading.Lock] = {}

        self._favorites_lock = threading.Lock()
        ensure_dir(self._favorites_file.parent)

    def set_tracked_dir(self, tracked_dir: Path) -> None:
        with self._tracked_master_lock:
            self._tracked_dir = tracked_dir

    def set_favorites_file(self, favorites_file: Path) -> None:
        with self._favorites_lock:
            self._favorites_file = favorites_file
            ensure_dir(self._favorites_file.parent)

    def _knob_default(self, knob: Knob):
        if knob.factory is not None:
            return knob.factory()

        if knob.from_attr is not None:
            return getattr(self, knob.from_attr)

        return knob.default

    def _read_knob(self, cfg: dict, knob: Knob, reader=None):
        if reader is None:
            reader = knob.read

        if reader is READ_BOOL:
            return bool(cfg.get(knob.key, self._knob_default(knob)))

        return getattr(self, reader or "get_" + _snake(knob.key))(cfg)

    def _read_username(self, cfg: dict) -> str:
        return str(cfg.get("username", "")).strip()

    def load_config(self) -> dict:
        return load_json_file(
            self._config_file,
            {knob.key: self._knob_default(knob) for knob in _KNOBS},
        )

    def save_config(self, cfg: dict):
        save_json_file(self._config_file, cfg)

    def _path_for_game_key(self, key: str) -> Path:
        if not key or not key.isdigit():
            raise ValueError(f"invalid tracked game key: {key!r}")
        return self._tracked_dir / f"{key}.json"

    def _lock_for_game(self, key: str) -> threading.Lock:
        with self._tracked_master_lock:
            lock = self._tracked_game_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._tracked_game_locks[key] = lock
            return lock

    def _load_tracked_for_game_key(self, key: str) -> dict:
        path = self._path_for_game_key(key)
        raw = load_json_file(path, {})
        return raw if isinstance(raw, dict) else {}

    def _save_tracked_for_game_key(self, key: str, entry: dict) -> None:
        path = self._path_for_game_key(key)
        ensure_dir(self._tracked_dir)
        save_json_file(path, entry or {}, compact=True)

    def _delete_tracked_for_game_key(self, key: str) -> None:
        path = self._path_for_game_key(key)
        try:
            path.unlink()
        except FileNotFoundError:
            pass

    def _iter_all_tracked_keys(self):
        if not self._tracked_dir.exists():
            return
        for path in self._tracked_dir.iterdir():
            if path.suffix != ".json":
                continue
            stem = path.stem
            if not stem.isdigit():
                continue
            yield stem

    def _update_config(self, key: str, value) -> dict:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg[key] = value
            cfg = self.ensure_display_settings(cfg)
            self.save_config(cfg)

            return cfg

    def settings_response(self, cfg: dict) -> dict:
        cfg = self.ensure_display_settings(cfg)

        response = {knob.key: self._read_knob(cfg, knob) for knob in _KNOBS if knob.ship}

        response["activeUlid"] = str(cfg.get("activeUlid") or "").strip()
        response["hasApiKey"] = bool(str(cfg.get("webApiKey", "")).strip())
        response["favoriteFriends"] = self.get_favorite_friends()

        return response

    def update_credentials(self, username: str, web_api_key: str) -> dict:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            next_username = str(username or "").strip()
            next_key = str(web_api_key or "").strip()

            if next_key:
                cfg["webApiKey"] = next_key
            elif "webApiKey" not in cfg:
                cfg["webApiKey"] = ""

            cfg["username"] = next_username

            cfg = self.ensure_display_settings(cfg)
            self._sync_active_credentials_to_record(cfg)
            self.save_config(cfg)

            return cfg

    def _build_user_record(self, username, web_api_key, last_signed_in_at, ulid="", connect_token="", hardcore=False):
        return {
            "username": str(username or "").strip(),
            "webApiKey": str(web_api_key or ""),
            "lastSignedInAt": to_int(last_signed_in_at, 0),
            "ulid": str(ulid or "").strip(),
            "connectToken": str(connect_token or ""),
            "hardcore": bool(hardcore),
        }

    def _find_user_index(self, records, username):
        target = str(username or "").strip().lower()
        if not target:
            return -1
        for index, record in enumerate(records):
            if str(record.get("username") or "").strip().lower() == target:
                return index
        return -1

    def _find_user_index_by_ulid(self, records, ulid):
        target = str(ulid or "").strip()
        if not target:
            return -1
        for index, record in enumerate(records):
            if str(record.get("ulid") or "").strip() == target:
                return index
        return -1

    def _record_index_for(self, records, username, ulid):
        ulid_index = self._find_user_index_by_ulid(records, ulid)
        if ulid_index >= 0:
            return ulid_index
        name_index = self._find_user_index(records, username)
        if name_index >= 0 and not str(records[name_index].get("ulid") or "").strip():
            return name_index
        return -1

    def _active_record_index(self, cfg):
        records = cfg.get("users") or []
        index = self._find_user_index_by_ulid(records, cfg.get("activeUlid"))
        if index < 0:
            index = self._find_user_index(records, cfg.get("username"))
        return index

    def normalize_user_records(self, cfg: dict) -> list[dict]:
        if "users" not in cfg:
            active_name = str(cfg.get("username") or "").strip()
            if active_name:
                cfg["users"] = [self._build_user_record(
                    active_name,
                    cfg.get("webApiKey"),
                    int(time.time()),
                )]
            else:
                cfg["users"] = []
            return cfg["users"]

        raw_records = cfg.get("users")
        if not isinstance(raw_records, list):
            cfg["users"] = []
            return cfg["users"]

        cleaned = []
        seen = set()
        for raw in raw_records:
            if not isinstance(raw, dict):
                continue
            record = self._build_user_record(
                raw.get("username"),
                raw.get("webApiKey"),
                raw.get("lastSignedInAt"),
                raw.get("ulid"),
                raw.get("connectToken"),
                raw.get("hardcore"),
            )
            if not record["username"]:
                continue
            key = record["username"].lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(record)

        cfg["users"] = cleaned
        return cleaned

    def _sync_active_credentials_to_record(self, cfg: dict) -> None:
        index = self._active_record_index(cfg)
        if index >= 0:
            cfg["users"][index]["username"] = str(cfg.get("username") or "").strip()
            cfg["users"][index]["webApiKey"] = str(cfg.get("webApiKey") or "")

    def get_user_key(self, username: str, cfg: dict | None = None) -> str | None:
        source = self.load_config() if cfg is None else cfg
        records = self.normalize_user_records(source)
        index = self._find_user_index(records, username)
        if index < 0:
            return None
        return str(records[index].get("webApiKey") or "")

    def get_user_ulid(self, username: str, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        records = self.normalize_user_records(source)
        index = self._find_user_index(records, username)
        if index < 0:
            return ""
        return str(records[index].get("ulid") or "").strip()

    def get_user_connect_login(self, username: str, cfg: dict | None = None) -> tuple[str, bool]:
        source = self.load_config() if cfg is None else cfg
        records = self.normalize_user_records(source)
        index = self._find_user_index(records, username)
        if index < 0:
            return "", False
        record = records[index]
        return str(record.get("connectToken") or ""), bool(record.get("hardcore"))

    def list_users(self, cfg: dict | None = None) -> list[dict]:
        source = self.load_config() if cfg is None else cfg
        records = self.normalize_user_records(source)
        reduced = []
        for record in records:
            reduced.append({
                "username": record["username"],
                "hasApiKey": bool(record["webApiKey"]),
                "hasConnectToken": bool(record["connectToken"]),
                "hardcore": bool(record["hardcore"]),
                "lastSignedInAt": record["lastSignedInAt"],
            })
        reduced.sort(key=lambda entry: (-entry["lastSignedInAt"], entry["username"].lower()))
        return reduced

    def add_user(self, username: str, web_api_key: str, ulid: str = "") -> list[dict]:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            records = cfg["users"]
            next_username = str(username or "").strip()
            next_key = str(web_api_key or "")
            next_ulid = str(ulid or "").strip()
            now = int(time.time())

            index = self._record_index_for(records, next_username, next_ulid)
            if index >= 0:
                existing = records[index]
                records[index] = self._build_user_record(
                    next_username,
                    next_key,
                    now,
                    next_ulid or existing.get("ulid"),
                    existing.get("connectToken"),
                    existing.get("hardcore"),
                )
            else:
                records.append(self._build_user_record(next_username, next_key, now, next_ulid))

            self.save_config(cfg)
            return self.list_users(cfg)

    def activate_user(self, username: str, ulid: str = "") -> dict:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            records = cfg["users"]
            next_ulid = str(ulid or "").strip()

            index = self._find_user_index_by_ulid(records, next_ulid)
            if index < 0:
                index = self._find_user_index(records, username)
            if index < 0:
                raise ValueError("user not found in saved accounts")

            record = records[index]
            cfg["username"] = str(record.get("username") or "").strip()
            cfg["webApiKey"] = str(record.get("webApiKey") or "")
            record["lastSignedInAt"] = int(time.time())

            resolved_ulid = next_ulid or str(record.get("ulid") or "").strip()
            cfg["activeUlid"] = resolved_ulid
            record["ulid"] = resolved_ulid

            cfg = self.ensure_display_settings(cfg)
            self.save_config(cfg)
            return cfg

    def remove_user(self, username: str) -> list[dict]:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            records = cfg["users"]
            index = self._find_user_index(records, username)
            if index >= 0:
                del records[index]
                self.save_config(cfg)
            return self.list_users(cfg)

    def set_connect_login(self, username: str, token: str, hardcore: bool) -> list[dict]:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            records = cfg["users"]
            index = self._find_user_index(records, username)
            if index < 0:
                raise ValueError("user not found in saved accounts")
            records[index]["connectToken"] = str(token or "")
            records[index]["hardcore"] = bool(hardcore)
            self.save_config(cfg)
            return self.list_users(cfg)

    def clear_connect_login(self, username: str) -> list[dict]:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            records = cfg["users"]
            index = self._find_user_index(records, username)
            if index >= 0:
                records[index]["connectToken"] = ""
                self.save_config(cfg)
            return self.list_users(cfg)

    def heal_active_username(self, canonical: str) -> dict:
        next_name = str(canonical or "").strip()
        if not next_name:
            return self.ensure_display_settings(self.load_config())

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            current = str(cfg.get("username") or "").strip()
            if current == next_name:
                return cfg

            index = self._active_record_index(cfg)
            cfg["username"] = next_name
            if index >= 0:
                cfg["users"][index]["username"] = next_name

            cfg = self.ensure_display_settings(cfg)
            self.save_config(cfg)
            return cfg

    def update_show_bell_dot(self, value: bool) -> bool:
        cfg = self._update_config("showBellDot", bool(value))

        return self.get_show_bell_dot(cfg)

    def update_do_not_disturb(self, value: bool) -> bool:
        cfg = self._update_config("doNotDisturb", bool(value))

        return self.get_do_not_disturb(cfg)

    def update_do_not_disturb_disables_dot(self, value: bool) -> bool:
        cfg = self._update_config("doNotDisturbDisablesDot", bool(value))

        return self.get_do_not_disturb_disables_dot(cfg)

    def update_do_not_disturb_disables_toast(self, value: bool) -> bool:
        cfg = self._update_config("doNotDisturbDisablesToast", bool(value))

        return self.get_do_not_disturb_disables_toast(cfg)

    def update_notify_note_reminder_enabled(self, value: bool) -> bool:
        cfg = self._update_config("notifyNoteReminderEnabled", bool(value))

        return self.get_notify_note_reminder_enabled(cfg)

    def update_notify_note_reminder_toast(self, value: bool) -> bool:
        cfg = self._update_config("notifyNoteReminderToast", bool(value))

        return self.get_notify_note_reminder_toast(cfg)

    def update_notify_tracked_set_enabled(self, value: bool) -> bool:
        cfg = self._update_config("notifyTrackedSetEnabled", bool(value))

        return self.get_notify_tracked_set_enabled(cfg)

    def update_notify_tracked_set_toast(self, value: bool) -> bool:
        cfg = self._update_config("notifyTrackedSetToast", bool(value))

        return self.get_notify_tracked_set_toast(cfg)

    def update_notify_comment_tracker_enabled(self, value: bool) -> bool:
        cfg = self._update_config("notifyCommentTrackerEnabled", bool(value))

        return self.get_notify_comment_tracker_enabled(cfg)

    def update_notify_comment_tracker_toast(self, value: bool) -> bool:
        cfg = self._update_config("notifyCommentTrackerToast", bool(value))

        return self.get_notify_comment_tracker_toast(cfg)

    def update_notify_wall_enabled(self, value: bool) -> bool:
        cfg = self._update_config("notifyWallEnabled", bool(value))

        return self.get_notify_wall_enabled(cfg)

    def update_notify_wall_toast(self, value: bool) -> bool:
        cfg = self._update_config("notifyWallToast", bool(value))

        return self.get_notify_wall_toast(cfg)

    def update_notify_system_enabled(self, value: bool) -> bool:
        cfg = self._update_config("notifySystemEnabled", bool(value))

        return self.get_notify_system_enabled(cfg)

    def update_notify_system_toast(self, value: bool) -> bool:
        cfg = self._update_config("notifySystemToast", bool(value))

        return self.get_notify_system_toast(cfg)

    def update_notify_tracked_enabled(self, value: bool) -> bool:
        cfg = self._update_config("notifyTrackedEnabled", bool(value))

        return self.get_notify_tracked_enabled(cfg)

    def update_notify_tracked_toast(self, value: bool) -> bool:
        cfg = self._update_config("notifyTrackedToast", bool(value))

        return self.get_notify_tracked_toast(cfg)

    def update_notify_social_unlock_enabled(self, value: bool) -> bool:
        cfg = self._update_config("notifySocialUnlockEnabled", bool(value))

        return self.get_notify_social_unlock_enabled(cfg)

    def update_notify_social_unlock_toast(self, value: bool) -> bool:
        cfg = self._update_config("notifySocialUnlockToast", bool(value))

        return self.get_notify_social_unlock_toast(cfg)

    def update_notify_near_you_enabled(self, value: bool) -> bool:
        cfg = self._update_config("notifyNearYouEnabled", bool(value))

        return self.get_notify_near_you_enabled(cfg)

    def update_notify_near_you_toast(self, value: bool) -> bool:
        cfg = self._update_config("notifyNearYouToast", bool(value))

        return self.get_notify_near_you_toast(cfg)

    def update_notify_debug_enabled(self, value: bool) -> bool:
        cfg = self._update_config("notifyDebugEnabled", bool(value))

        return self.get_notify_debug_enabled(cfg)

    def update_notify_debug_toast(self, value: bool) -> bool:
        cfg = self._update_config("notifyDebugToast", bool(value))

        return self.get_notify_debug_toast(cfg)

    def update_show_reminder_ticker(self, value: bool) -> bool:
        cfg = self._update_config("showReminderTicker", bool(value))

        return self.get_show_reminder_ticker(cfg)

    def update_show_notes_dot(self, value: bool) -> bool:
        cfg = self._update_config("showNotesDot", bool(value))

        return self.get_show_notes_dot(cfg)

    def update_game_notes_a_button_mode(self, value: str) -> str:
        next_value = str(value or "").strip()
        if next_value not in self._GAME_NOTES_A_BUTTON_MODE_OPTIONS:
            next_value = "editNote"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["gameNotesAButtonMode"] = next_value
            self.save_config(cfg)
            return next_value

    def update_show_all_toggle_main(self, value: bool) -> bool:
        cfg = self._update_config("showAllToggleMain", bool(value))

        return self.get_show_all_toggle_main(cfg)

    def update_show_retro_points(self, value: bool) -> bool:
        cfg = self._update_config("showRetroPoints", bool(value))

        return self.get_show_retro_points(cfg)

    def update_achievement_style(self, value: str) -> str:
        value = str(value or "left").strip().lower()
        cfg = self._update_config("achievementStyle", value)

        return self.get_achievement_style(cfg)

    def update_main_achievement_filter(self, value: str) -> str:
        value = str(value or "all").strip().lower()
        cfg = self._update_config("mainAchievementFilter", value)

        return self.get_main_achievement_filter(cfg)

    def update_main_achievement_sort(self, value: str) -> str:
        value = str(value or "upNext").strip()
        cfg = self._update_config("mainAchievementSort", value)

        return self.get_main_achievement_sort(cfg)

    def update_unlock_lookback_minutes(self, value: int) -> int:
        cfg = self._update_config(
            "unlockLookbackMinutes",
            to_int(value, self._recent_unlock_lookback_minutes),
        )

        return self.get_unlock_lookback_minutes(cfg)

    def update_unlock_history_days(self, value: int) -> int:
        cfg = self._update_config(
            "unlockHistoryDays",
            to_int(value, self._recent_unlock_history_days),
        )

        return self.get_unlock_history_days(cfg)

    def update_show_all_achievements(self, value: bool) -> bool:
        cfg = self._update_config("showAllAchievements", bool(value))

        return bool(cfg.get("showAllAchievements", True))

    def update_show_a_button_mode(self, value: bool) -> bool:
        cfg = self._update_config("showAButtonMode", bool(value))

        return self.get_show_a_button_mode(cfg)

    def update_main_achievement_action(self, value: str) -> str:
        value = str(value or "track").strip().lower()
        cfg = self._update_config("mainAchievementAction", value)

        return self.get_main_achievement_action(cfg)

    def update_show_tracked_notes_main(self, value: bool) -> bool:
        cfg = self._update_config("showTrackedNotesMain", bool(value))

        return self.get_show_tracked_notes_main(cfg)

    def update_tracked_color(self, value: str) -> str:
        value = str(value or "default").strip().lower()
        cfg = self._update_config("trackedColor", value)

        return self.get_tracked_color(cfg)

    def update_show_a_button_mode_tracked(self, value: bool) -> bool:
        cfg = self._update_config("showAButtonModeTracked", bool(value))

        return self.get_show_a_button_mode_tracked(cfg)

    def update_tracked_achievement_action(self, value: str) -> str:
        value = str(value or "editNote").strip()
        cfg = self._update_config("trackedAchievementAction", value)

        return self.get_tracked_achievement_action(cfg)

    def update_dolphin_mapper_mode(self, value: str) -> str:
        value = str(value or "map").strip()
        cfg = self._update_config("dolphinMapperMode", value)

        return self.get_dolphin_mapper_mode(cfg)

    def update_file_watcher_speed(self, value: str) -> str:
        value = str(value or "gentle").strip()
        cfg = self._update_config("fileWatcherSpeed", value)

        return self.get_file_watcher_speed(cfg)

    def update_dolphin_system_filter(self, value: str) -> str:
        value = str(value or "all").strip()
        cfg = self._update_config("dolphinSystemFilter", value)

        return self.get_dolphin_system_filter(cfg)

    def update_dolphin_bluetooth_passthrough(self, value) -> bool:
        flag = bool(value)
        cfg = self._update_config("dolphinBluetoothPassthrough", flag)

        return self.get_dolphin_bluetooth_passthrough(cfg)

    def update_dolphin_continuous_scanning(self, value) -> bool:
        flag = bool(value)
        cfg = self._update_config("dolphinContinuousScanning", flag)

        return self.get_dolphin_continuous_scanning(cfg)

    def update_dolphin_balance_board(self, value) -> bool:
        flag = bool(value)
        cfg = self._update_config("dolphinBalanceBoard", flag)

        return self.get_dolphin_balance_board(cfg)

    def update_cheevo_check_cache_hashes(self, value: bool) -> bool:
        cfg = self._update_config("cheevoCheckCacheHashes", bool(value))

        return self.get_cheevo_check_cache_hashes(cfg)

    def update_cheevo_check_extract_to_ram(self, value: bool) -> bool:
        cfg = self._update_config("cheevoCheckExtractToRam", bool(value))

        return self.get_cheevo_check_extract_to_ram(cfg)

    def update_cheevo_check_verify_hashes(self, value: bool) -> bool:
        cfg = self._update_config("cheevoCheckVerifyHashes", bool(value))

        return self.get_cheevo_check_verify_hashes(cfg)

    def update_cheevo_check_skip_disc_verify(self, value: bool) -> bool:
        cfg = self._update_config("cheevoCheckSkipDiscVerify", bool(value))

        return self.get_cheevo_check_skip_disc_verify(cfg)

    def update_cheevo_check_skip_cart_verify(self, value: bool) -> bool:
        cfg = self._update_config("cheevoCheckSkipCartVerify", bool(value))

        return self.get_cheevo_check_skip_cart_verify(cfg)

    def update_library_badge(self, value: bool) -> bool:
        cfg = self._update_config("libraryBadge", bool(value))

        return self.get_library_badge(cfg)

    def update_cheevo_check_scan_collapsed(self, value: bool) -> bool:
        cfg = self._update_config("cheevoCheckScanCollapsed", bool(value))

        return self.get_cheevo_check_scan_collapsed(cfg)

    def update_cheevo_check_results_collapsed(self, value: bool) -> bool:
        cfg = self._update_config("cheevoCheckResultsCollapsed", bool(value))

        return self.get_cheevo_check_results_collapsed(cfg)

    def update_cheevo_check_verify_collapsed(self, value: bool) -> bool:
        cfg = self._update_config("cheevoCheckVerifyCollapsed", bool(value))

        return self.get_cheevo_check_verify_collapsed(cfg)

    def update_cheevo_check_options_collapsed(self, value: bool) -> bool:
        cfg = self._update_config("cheevoCheckOptionsCollapsed", bool(value))

        return self.get_cheevo_check_options_collapsed(cfg)

    def update_cheevo_check_verify_speed(self, value: str) -> str:
        value = str(value or "gentle").strip()
        cfg = self._update_config("cheevoCheckVerifySpeed", value)

        return self.get_cheevo_check_verify_speed(cfg)

    def update_tracked_sets_auto_check(self, value: bool) -> bool:
        cfg = self._update_config("trackedSetsAutoCheck", bool(value))

        return self.get_tracked_sets_auto_check(cfg)

    def update_tracked_sets_service_enabled(self, value: bool) -> bool:
        cfg = self._update_config("trackedSetsServiceEnabled", bool(value))

        return self.get_tracked_sets_service_enabled(cfg)

    def update_tracked_sets_refresh_minutes(self, value: int) -> int:
        cfg = self._update_config("trackedSetsRefreshMinutes", to_int(value, 15))

        return self.get_tracked_sets_refresh_minutes(cfg)

    def update_tracked_sets_selector_sort(self, value: str) -> str:
        value = str(value or "alphabetical").strip()
        cfg = self._update_config("trackedSetsSelectorSort", value)

        return self.get_tracked_sets_selector_sort(cfg)

    def update_tracked_sets_selector_filter(self, value: str) -> str:
        value = str(value or "all").strip()
        cfg = self._update_config("trackedSetsSelectorFilter", value)

        return self.get_tracked_sets_selector_filter(cfg)

    def update_tracked_set_a_button_mode(self, value: str) -> str:
        value = str(value or "editNote").strip()
        cfg = self._update_config("trackedSetAButtonMode", value)

        return self.get_tracked_set_a_button_mode(cfg)

    def update_comments_service_tick_minutes(self, value: int) -> int:
        cfg = self._update_config("commentsServiceTickMinutes", to_int(value, 5))

        return self.get_comments_service_tick_minutes(cfg)

    def update_comments_service_fetch_amount(self, value: int) -> int:
        cfg = self._update_config("commentsServiceFetchAmount", to_int(value, 20))

        return self.get_comments_service_fetch_amount(cfg)

    def update_comments_service_wall_check(self, value: bool) -> bool:
        cfg = self._update_config("commentsServiceWallCheck", bool(value))

        return self.get_comments_service_wall_check(cfg)

    def update_friend_refresh_delay_ms(self, value: int) -> int:
        cfg = self._update_config("friendRefreshDelayMs", to_int(value, 1000))

        return self.get_friend_refresh_delay_ms(cfg)

    def update_activity_cache_minutes(self, value: int) -> int:
        cfg = self._update_config("activityCacheMinutes", to_int(value, 5))

        return self.get_activity_cache_minutes(cfg)

    def update_trickle_lookback_hours(self, value: int) -> int:
        cfg = self._update_config("trickleLookbackHours", to_int(value, 3))

        return self.get_trickle_lookback_hours(cfg)

    def update_activity_friends_per_tick(self, value: int) -> int:
        cfg = self._update_config("activityFriendsPerTick", to_int(value, 3))

        return self.get_activity_friends_per_tick(cfg)

    def update_social_game_ticker(self, value: bool) -> bool:
        cfg = self._update_config("socialGameTicker", bool(value))

        return self.get_social_game_ticker(cfg)

    def update_social_hub_ticker(self, value: bool) -> bool:
        cfg = self._update_config("socialHubTicker", bool(value))

        return self.get_social_hub_ticker(cfg)

    def update_social_activity_trickle_service(self, value: bool) -> bool:
        cfg = self._update_config("socialActivityTrickleService", bool(value))

        return self.get_social_activity_trickle_service(cfg)

    def update_trickle_favorites_only(self, value: bool) -> bool:
        cfg = self._update_config("trickleFavoritesOnly", bool(value))

        return self.get_trickle_favorites_only(cfg)

    def update_friend_auto_refresh(self, value: bool) -> bool:
        cfg = self._update_config("friendAutoRefresh", bool(value))

        return self.get_friend_auto_refresh(cfg)

    def update_friend_image_service(self, value: bool) -> bool:
        cfg = self._update_config("friendImageService", bool(value))

        return self.get_friend_image_service(cfg)

    def update_validate_friends_roster(self, value: bool) -> bool:
        cfg = self._update_config("validateFriendsRoster", bool(value))

        return self.get_validate_friends_roster(cfg)

    def update_fis_tick_frequency_minutes(self, value: int) -> int:
        cfg = self._update_config("fisTickFrequencyMinutes", to_int(value, 5))

        return self.get_fis_tick_frequency_minutes(cfg)

    def update_fis_roster_refresh_interval_hours(self, value: int) -> int:
        cfg = self._update_config("fisRosterRefreshIntervalHours", to_int(value, 6))

        return self.get_fis_roster_refresh_interval_hours(cfg)

    def update_fis_verify_favorite_avatars(self, value: bool) -> bool:
        cfg = self._update_config("fisVerifyFavoriteAvatars", bool(value))

        return self.get_fis_verify_favorite_avatars(cfg)

    def update_fis_verify_all_avatars(self, value: bool) -> bool:
        cfg = self._update_config("fisVerifyAllAvatars", bool(value))

        return self.get_fis_verify_all_avatars(cfg)

    def update_show_all_toggle_friend(self, value: bool) -> bool:
        cfg = self._update_config("showAllToggleFriend", bool(value))

        return self.get_show_all_toggle_friend(cfg)

    def update_friend_achievement_filter(self, value: str) -> str:
        value = str(value or "all").strip().lower()
        cfg = self._update_config("friendAchievementFilter", value)

        return self.get_friend_achievement_filter(cfg)

    def update_friend_achievement_sort(self, value: str) -> str:
        value = str(value or "upNext").strip()
        cfg = self._update_config("friendAchievementSort", value)

        return self.get_friend_achievement_sort(cfg)

    def update_friend_show_all_achievements(self, value: bool) -> bool:
        cfg = self._update_config("friendShowAllAchievements", bool(value))

        return self.get_friend_show_all_achievements(cfg)

    def update_players_near_you_enabled(self, value: bool) -> bool:
        cfg = self._update_config("playersNearYouEnabled", bool(value))

        return self.get_players_near_you_enabled(cfg)

    def update_players_near_you_lookbehind(self, value: int) -> int:
        cfg = self._update_config("playersNearYouLookbehind", to_int(value, 2))

        return self.get_players_near_you_lookbehind(cfg)

    def update_players_near_you_lookahead(self, value: int) -> int:
        cfg = self._update_config("playersNearYouLookahead", to_int(value, 6))

        return self.get_players_near_you_lookahead(cfg)

    def update_players_near_you_min_tick_minutes(self, value: int) -> int:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["playersNearYouMinTickMinutes"] = to_int(value, 5)
            next_min = self.get_players_near_you_min_tick_minutes(cfg)
            if next_min > self.get_players_near_you_max_tick_minutes(cfg):
                cfg["playersNearYouMaxTickMinutes"] = next_min
            self.save_config(cfg)

            return self.get_players_near_you_min_tick_minutes(cfg)

    def update_players_near_you_max_tick_minutes(self, value: int) -> int:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["playersNearYouMaxTickMinutes"] = to_int(value, 15)
            next_max = self.get_players_near_you_max_tick_minutes(cfg)
            if next_max < self.get_players_near_you_min_tick_minutes(cfg):
                cfg["playersNearYouMinTickMinutes"] = next_max
            self.save_config(cfg)

            return self.get_players_near_you_max_tick_minutes(cfg)

    def update_players_near_you_tap_mode(self, value: str) -> str:
        value = str(value or "profile").strip().lower()
        cfg = self._update_config("playersNearYouTapMode", value)

        return self.get_players_near_you_tap_mode(cfg)

    def update_players_near_you_collapsed(self, value: bool) -> bool:
        cfg = self._update_config("playersNearYouCollapsed", bool(value))

        return self.get_players_near_you_collapsed(cfg)

    def update_dolphin_advanced_collapsed(self, value: bool) -> bool:
        cfg = self._update_config("dolphinAdvancedCollapsed", bool(value))

        return self.get_dolphin_advanced_collapsed(cfg)

    def mark_dolphin_mappings_seeded(self) -> None:
        self._update_config("dolphinMappingsSeeded", True)

    def update_language(self, language: str) -> str:
        value = str(language or self._default_language).strip().lower()
        cfg = self._update_config("language", value)

        return self.get_language(cfg)

    def update_night_mode(self, value: bool) -> bool:
        cfg = self._update_config("nightMode", bool(value))

        return self.get_night_mode(cfg)

    def update_night_mode_brightness(self, value: float) -> float:
        cfg = self._update_config("nightModeBrightness", to_float(value, 0.75))

        return self.get_night_mode_brightness(cfg)

    def update_battery_saver(self, value: bool) -> bool:
        cfg = self._update_config("batterySaver", bool(value))

        return self.get_battery_saver(cfg)

    def update_battery_saver_disables_social_activity(self, value: bool) -> bool:
        cfg = self._update_config("batterySaverDisablesSocialActivity", bool(value))

        return self.get_battery_saver_disables_social_activity(cfg)

    def update_battery_saver_disables_comments(self, value: bool) -> bool:
        cfg = self._update_config("batterySaverDisablesComments", bool(value))

        return self.get_battery_saver_disables_comments(cfg)

    def update_battery_saver_disables_friend_avatars(self, value: bool) -> bool:
        cfg = self._update_config("batterySaverDisablesFriendAvatars", bool(value))

        return self.get_battery_saver_disables_friend_avatars(cfg)

    def update_battery_saver_disables_players_near_you(self, value: bool) -> bool:
        cfg = self._update_config("batterySaverDisablesPlayersNearYou", bool(value))

        return self.get_battery_saver_disables_players_near_you(cfg)

    def update_battery_saver_disables_tracked_sets(self, value: bool) -> bool:
        cfg = self._update_config("batterySaverDisablesTrackedSets", bool(value))

        return self.get_battery_saver_disables_tracked_sets(cfg)

    def update_battery_saver_disables_file_watcher(self, value: bool) -> bool:
        cfg = self._update_config("batterySaverDisablesFileWatcher", bool(value))

        return self.get_battery_saver_disables_file_watcher(cfg)

    def update_file_watcher_run_during_games(self, value: bool) -> bool:
        cfg = self._update_config("fileWatcherRunDuringGames", bool(value))

        return self.get_file_watcher_run_during_games(cfg)

    def update_show_developer_options(self, value: bool) -> bool:
        cfg = self._update_config("showDeveloperOptions", bool(value))

        return self.get_show_developer_options(cfg)

    def update_auto_purge_service(self, value: bool) -> bool:
        cfg = self._update_config("autoPurgeService", bool(value))

        return self.get_auto_purge_service(cfg)

    def update_debug_logging(self, value: bool) -> bool:
        cfg = self._update_config("debugLogging", bool(value))

        return self.get_debug_logging(cfg)

    def update_inject_emulator_login(self, value: bool) -> bool:
        cfg = self._update_config("injectEmulatorLogin", bool(value))

        return self.get_inject_emulator_login(cfg)

    def update_ipc_slow_threshold_ms(self, value: int) -> int:
        cfg = self._update_config("ipcSlowThresholdMs", to_int(value, 250))

        return self.get_ipc_slow_threshold_ms(cfg)

    def update_legacy_achievement_links(self, value: bool) -> bool:
        cfg = self._update_config("legacyAchievementLinks", bool(value))

        return self.get_legacy_achievement_links(cfg)

    def update_legacy_game_links(self, value: bool) -> bool:
        cfg = self._update_config("legacyGameLinks", bool(value))

        return self.get_legacy_game_links(cfg)

    def update_large_viewport_bonus_enabled(self, value: bool) -> bool:
        cfg = self._update_config("largeViewportBonusEnabled", bool(value))

        return self.get_large_viewport_bonus_enabled(cfg)

    def update_large_viewport_bonus(self, value: int) -> int:
        cfg = self._update_config("largeViewportBonus", to_int(value, 8))

        return self.get_large_viewport_bonus(cfg)

    def update_parallel_ra_calls(self, value: int) -> int:
        cfg = self._update_config("parallelRaCalls", to_int(value, 4))

        return self.get_parallel_ra_calls(cfg)

    def update_parallel_cdn_fetches(self, value: int) -> int:
        cfg = self._update_config("parallelCdnFetches", to_int(value, 5))

        return self.get_parallel_cdn_fetches(cfg)

    def update_max_icon_workers(self, value: int) -> int:
        cfg = self._update_config("maxIconWorkers", to_int(value, 6))

        return self.get_max_icon_workers(cfg)

    def update_avatar_workers(self, value: int) -> int:
        cfg = self._update_config("avatarWorkers", to_int(value, 4))

        return self.get_avatar_workers(cfg)

    def update_game_icon_workers(self, value: int) -> int:
        cfg = self._update_config("gameIconWorkers", to_int(value, 6))

        return self.get_game_icon_workers(cfg)

    def update_game_art_cache_cap(self, value: int) -> int:
        cfg = self._update_config("gameArtCacheCap", to_int(value, 1024))

        return self.get_game_art_cache_cap(cfg)

    def update_avatar_cache_cap(self, value: int) -> int:
        cfg = self._update_config("avatarCacheCap", to_int(value, 1024))

        return self.get_avatar_cache_cap(cfg)

    def update_achievement_icon_cache_games(self, value: int) -> int:
        cfg = self._update_config("achievementIconCacheGames", to_int(value, 8))

        return self.get_achievement_icon_cache_games(cfg)

    def update_games_list_cache_minutes(self, value: int) -> int:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["gamesListCacheMinutes"] = to_int(value, 20)
            self.save_config(cfg)

            return self.get_games_list_cache_minutes(cfg)

    def update_awards_list_cache_minutes(self, value: int) -> int:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["awardsListCacheMinutes"] = to_int(value, 15)
            self.save_config(cfg)

            return self.get_awards_list_cache_minutes(cfg)

    def update_want_to_play_cache_minutes(self, value: int) -> int:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["wantToPlayCacheMinutes"] = to_int(value, 20)
            self.save_config(cfg)

            return self.get_want_to_play_cache_minutes(cfg)

    def update_big_list_threshold(self, value: int) -> int:
        cfg = self._update_config("bigListThreshold", to_int(value, BIG_LIST_THRESHOLD_DISABLED))

        return self.get_big_list_threshold(cfg)

    def update_always_stagger_mounting(self, value: bool) -> bool:
        cfg = self._update_config("alwaysStaggerMounting", bool(value))

        return self.get_always_stagger_mounting(cfg)

    def update_return_stagger_frames(self, value: int) -> int:
        cfg = self._update_config("returnStaggerFrames", to_int(value, 0))

        return self.get_return_stagger_frames(cfg)

    def update_dynamic_loading(self, value: bool) -> bool:
        cfg = self._update_config("dynamicLoading", bool(value))

        return self.get_dynamic_loading(cfg)

    def update_dynamic_initial_rows(self, value: int) -> int:
        cfg = self._update_config("dynamicInitialRows", to_int(value, 30))

        return self.get_dynamic_initial_rows(cfg)

    def update_dynamic_row_step(self, value: int) -> int:
        cfg = self._update_config("dynamicRowStep", to_int(value, 30))

        return self.get_dynamic_row_step(cfg)

    def update_dynamic_prefetch_distance(self, value: int) -> int:
        cfg = self._update_config("dynamicPrefetchDistance", to_int(value, 12))

        return self.get_dynamic_prefetch_distance(cfg)

    def update_dynamic_sentinel_root_margin(self, value: int) -> int:
        cfg = self._update_config("dynamicSentinelRootMargin", to_int(value, 600))

        return self.get_dynamic_sentinel_root_margin(cfg)

    def update_dynamic_tracked_list_loading(self, value: bool) -> bool:
        cfg = self._update_config("dynamicTrackedListLoading", bool(value))

        return self.get_dynamic_tracked_list_loading(cfg)

    def update_dynamic_tracked_list_initial_rows(self, value: int) -> int:
        cfg = self._update_config("dynamicTrackedListInitialRows", to_int(value, 10))

        return self.get_dynamic_tracked_list_initial_rows(cfg)

    def update_dynamic_tracked_list_row_step(self, value: int) -> int:
        cfg = self._update_config("dynamicTrackedListRowStep", to_int(value, 10))

        return self.get_dynamic_tracked_list_row_step(cfg)

    def update_dynamic_tracked_list_prefetch_distance(self, value: int) -> int:
        cfg = self._update_config("dynamicTrackedListPrefetchDistance", to_int(value, 12))

        return self.get_dynamic_tracked_list_prefetch_distance(cfg)

    def update_dynamic_tracked_list_sentinel_root_margin(self, value: int) -> int:
        cfg = self._update_config("dynamicTrackedListSentinelRootMargin", to_int(value, 600))

        return self.get_dynamic_tracked_list_sentinel_root_margin(cfg)

    def update_dynamic_tracked_sets_list_loading(self, value: bool) -> bool:
        cfg = self._update_config("dynamicTrackedSetsListLoading", bool(value))

        return self.get_dynamic_tracked_sets_list_loading(cfg)

    def update_dynamic_tracked_sets_list_initial_rows(self, value: int) -> int:
        cfg = self._update_config("dynamicTrackedSetsListInitialRows", to_int(value, 10))

        return self.get_dynamic_tracked_sets_list_initial_rows(cfg)

    def update_dynamic_tracked_sets_list_row_step(self, value: int) -> int:
        cfg = self._update_config("dynamicTrackedSetsListRowStep", to_int(value, 10))

        return self.get_dynamic_tracked_sets_list_row_step(cfg)

    def update_dynamic_tracked_sets_list_prefetch_distance(self, value: int) -> int:
        cfg = self._update_config("dynamicTrackedSetsListPrefetchDistance", to_int(value, 12))

        return self.get_dynamic_tracked_sets_list_prefetch_distance(cfg)

    def update_dynamic_tracked_sets_list_sentinel_root_margin(self, value: int) -> int:
        cfg = self._update_config("dynamicTrackedSetsListSentinelRootMargin", to_int(value, 600))

        return self.get_dynamic_tracked_sets_list_sentinel_root_margin(cfg)

    def update_dynamic_game_notes_loading(self, value: bool) -> bool:
        cfg = self._update_config("dynamicGameNotesLoading", bool(value))

        return self.get_dynamic_game_notes_loading(cfg)

    def update_dynamic_game_notes_initial_rows(self, value: int) -> int:
        cfg = self._update_config("dynamicGameNotesInitialRows", to_int(value, 10))

        return self.get_dynamic_game_notes_initial_rows(cfg)

    def update_dynamic_game_notes_row_step(self, value: int) -> int:
        cfg = self._update_config("dynamicGameNotesRowStep", to_int(value, 10))

        return self.get_dynamic_game_notes_row_step(cfg)

    def update_dynamic_game_notes_prefetch_distance(self, value: int) -> int:
        cfg = self._update_config("dynamicGameNotesPrefetchDistance", to_int(value, 12))

        return self.get_dynamic_game_notes_prefetch_distance(cfg)

    def update_dynamic_game_notes_sentinel_root_margin(self, value: int) -> int:
        cfg = self._update_config("dynamicGameNotesSentinelRootMargin", to_int(value, 600))

        return self.get_dynamic_game_notes_sentinel_root_margin(cfg)

    def update_dynamic_comments(self, value: bool) -> bool:
        cfg = self._update_config("dynamicComments", bool(value))

        return self.get_dynamic_comments(cfg)

    def update_dynamic_comments_initial_rows(self, value: int) -> int:
        cfg = self._update_config("dynamicCommentsInitialRows", to_int(value, 10))

        return self.get_dynamic_comments_initial_rows(cfg)

    def update_dynamic_comments_row_step(self, value: int) -> int:
        cfg = self._update_config("dynamicCommentsRowStep", to_int(value, 10))

        return self.get_dynamic_comments_row_step(cfg)

    def update_dynamic_comments_sentinel_root_margin(self, value: int) -> int:
        cfg = self._update_config("dynamicCommentsSentinelRootMargin", to_int(value, 600))

        return self.get_dynamic_comments_sentinel_root_margin(cfg)

    def update_dynamic_friend_loading(self, value: bool) -> bool:
        cfg = self._update_config("dynamicFriendLoading", bool(value))

        return self.get_dynamic_friend_loading(cfg)

    def update_dynamic_leaderboard_loading(self, value: bool) -> bool:
        cfg = self._update_config("dynamicLeaderboardLoading", bool(value))

        return self.get_dynamic_leaderboard_loading(cfg)

    def update_dynamic_leaderboard_results(self, value: bool) -> bool:
        cfg = self._update_config("dynamicLeaderboardResults", bool(value))

        return self.get_dynamic_leaderboard_results(cfg)

    def update_dynamic_activity_feed(self, value: bool) -> bool:
        cfg = self._update_config("dynamicActivityFeed", bool(value))

        return self.get_dynamic_activity_feed(cfg)

    def update_dynamic_compare(self, value: bool) -> bool:
        cfg = self._update_config("dynamicCompare", bool(value))

        return self.get_dynamic_compare(cfg)

    def update_dynamic_friend_picker(self, value: bool) -> bool:
        cfg = self._update_config("dynamicFriendPicker", bool(value))

        return self.get_dynamic_friend_picker(cfg)

    def update_dynamic_all_games(self, value: bool) -> bool:
        cfg = self._update_config("dynamicAllGames", bool(value))

        return self.get_dynamic_all_games(cfg)

    def update_dynamic_tracked_games(self, value: bool) -> bool:
        cfg = self._update_config("dynamicTrackedGames", bool(value))

        return self.get_dynamic_tracked_games(cfg)

    def update_dynamic_badges(self, value: bool) -> bool:
        cfg = self._update_config("dynamicBadges", bool(value))

        return self.get_dynamic_badges(cfg)

    def update_dynamic_followed_ranking(self, value: bool) -> bool:
        cfg = self._update_config("dynamicFollowedRanking", bool(value))

        return self.get_dynamic_followed_ranking(cfg)

    def update_ui_size(self, value: str) -> str:
        value = str(value or "normal").strip().lower()
        cfg = self._update_config("uiSize", value)

        return self.get_ui_size(cfg)

    def update_achievement_text_scale(self, value: str) -> str:
        value = str(value or "normal").strip().lower()
        cfg = self._update_config("achievementTextScale", value)

        return self.get_achievement_text_scale(cfg)

    def update_comments_text_scale(self, value: str) -> str:
        value = str(value or "normal").strip().lower()
        cfg = self._update_config("commentsTextScale", value)

        return self.get_comments_text_scale(cfg)

    def update_text_scale(self, value: str) -> str:
        value = str(value or "normal").strip().lower()
        cfg = self._update_config("textScale", value)

        return self.get_text_scale(cfg)

    def update_title_scale(self, value: str) -> str:
        value = str(value or "normal").strip().lower()
        cfg = self._update_config("titleScale", value)

        return self.get_title_scale(cfg)

    def update_header_scale(self, value: str) -> str:
        value = str(value or "normal").strip().lower()
        cfg = self._update_config("headerScale", value)

        return self.get_header_scale(cfg)

    def update_banner_scale(self, value: str) -> str:
        value = str(value or "normal").strip().lower()
        cfg = self._update_config("bannerScale", value)

        return self.get_banner_scale(cfg)

    def update_modal_scale(self, value: str) -> str:
        value = str(value or "normal").strip().lower()
        cfg = self._update_config("modalScale", value)

        return self.get_modal_scale(cfg)

    def update_guide_zoom(self, value) -> int:
        cfg = self._update_config("guideZoom", to_int(value, GUIDE_ZOOM_DEFAULT))

        return self.get_guide_zoom(cfg)

    def update_guide_modal_zoom(self, value) -> int:
        cfg = self._update_config("guideModalZoom", to_int(value, GUIDE_MODAL_ZOOM_DEFAULT))

        return self.get_guide_modal_zoom(cfg)

    def update_text_viewer_zoom(self, value) -> int:
        cfg = self._update_config("textViewerZoom", to_int(value, TEXT_VIEWER_ZOOM_DEFAULT))

        return self.get_text_viewer_zoom(cfg)

    def update_keep_guides_offline(self, value) -> bool:
        cfg = self._update_config("keepGuidesOffline", bool(value))

        return self.get_keep_guides_offline(cfg)

    def update_pin_latest_guides(self, value: bool) -> bool:
        cfg = self._update_config("pinLatestGuides", bool(value))

        return self.get_pin_latest_guides(cfg)

    def update_display_scales(self, ui_size, achievement_text_scale, comments_text_scale, text_scale, title_scale, header_scale, banner_scale, modal_scale) -> dict:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["uiSize"] = str(ui_size or "normal").strip().lower()
            cfg["achievementTextScale"] = str(achievement_text_scale or "normal").strip().lower()
            cfg["commentsTextScale"] = str(comments_text_scale or "normal").strip().lower()
            cfg["textScale"] = str(text_scale or "normal").strip().lower()
            cfg["titleScale"] = str(title_scale or "normal").strip().lower()
            cfg["headerScale"] = str(header_scale or "normal").strip().lower()
            cfg["bannerScale"] = str(banner_scale or "normal").strip().lower()
            cfg["modalScale"] = str(modal_scale or "normal").strip().lower()
            cfg = self.ensure_display_settings(cfg)
            self.save_config(cfg)

        return {
            "uiSize": self.get_ui_size(cfg),
            "achievementTextScale": self.get_achievement_text_scale(cfg),
            "commentsTextScale": self.get_comments_text_scale(cfg),
            "textScale": self.get_text_scale(cfg),
            "titleScale": self.get_title_scale(cfg),
            "headerScale": self.get_header_scale(cfg),
            "bannerScale": self.get_banner_scale(cfg),
            "modalScale": self.get_modal_scale(cfg),
        }

    def update_main_ui_preset(self, show_social_hub, show_mastery_goals, show_options, show_a_button_mode) -> dict:
        with self._config_lock:
            cfg = self.load_config()
            cfg["showSocialHubButton"] = bool(show_social_hub)
            cfg["showTrackedSetsButton"] = bool(show_mastery_goals)
            cfg["showOptionsButton"] = bool(show_options)
            cfg["showAButtonMode"] = bool(show_a_button_mode)
            self.save_config(cfg)

        return {
            "showSocialHubButton": self.get_show_social_hub_button(cfg),
            "showTrackedSetsButton": self.get_show_tracked_sets_button(cfg),
            "putUpdaterOnDesktop": self.get_put_updater_on_desktop(cfg),
            "showOptionsButton": self.get_show_options_button(cfg),
            "showAButtonMode": self.get_show_a_button_mode(cfg),
        }

    def update_block_padding(self, value: int) -> int:
        cfg = self._update_config("blockPadding", to_int(value, 8))

        return self.get_block_padding(cfg)

    def update_button_spacing(self, value: str) -> str:
        value = str(value or "small").strip().lower()
        cfg = self._update_config("buttonSpacing", value)

        return self.get_button_spacing(cfg)

    def update_auto_refresh(self, value: bool) -> bool:
        cfg = self._update_config("autoRefresh", bool(value))

        return bool(cfg.get("autoRefresh", True))

    def update_defer_modal_cleanup(self, value: bool) -> bool:
        cfg = self._update_config("deferModalCleanup", bool(value))

        return bool(cfg.get("deferModalCleanup", True))

    def update_legacy_comments_loading(self, value: bool) -> bool:
        cfg = self._update_config("legacyCommentsLoading", bool(value))

        return bool(cfg.get("legacyCommentsLoading", False))

    def update_mouse_keyboard_mode(self, value: bool) -> bool:
        cfg = self._update_config("mouseKeyboardMode", bool(value))

        return bool(cfg.get("mouseKeyboardMode", False))

    def update_colored_glyphs(self, value: bool) -> bool:
        cfg = self._update_config("coloredGlyphs", bool(value))

        return bool(cfg.get("coloredGlyphs", True))

    def update_controller_glyph_style(self, value: str) -> str:
        value = str(value or "auto").strip().lower()
        cfg = self._update_config("controllerGlyphStyle", value)

        return self.get_controller_glyph_style(cfg)

    def update_show_social_hub_button(self, value: bool) -> bool:
        cfg = self._update_config("showSocialHubButton", bool(value))

        return self.get_show_social_hub_button(cfg)

    def update_show_tracked_sets_button(self, value: bool) -> bool:
        cfg = self._update_config("showTrackedSetsButton", bool(value))

        return self.get_show_tracked_sets_button(cfg)

    def update_put_updater_on_desktop(self, value: bool) -> bool:
        cfg = self._update_config("putUpdaterOnDesktop", bool(value))

        return self.get_put_updater_on_desktop(cfg)

    def update_show_options_button(self, value: bool) -> bool:
        cfg = self._update_config("showOptionsButton", bool(value))

        return self.get_show_options_button(cfg)

    def update_remember_last_page(self, value: bool) -> bool:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["rememberLastPage"] = bool(value)

            if not bool(value):
                cfg["resumeState"] = None

            cfg = self.ensure_display_settings(cfg)
            self.save_config(cfg)

            return bool(cfg.get("rememberLastPage", True))

    def update_show_icons(self, value: bool) -> bool:
        cfg = self._update_config("showIcons", bool(value))

        return bool(cfg.get("showIcons", True))

    def _write_baseline_settings(self, cfg: dict) -> dict:
        for knob in _KNOBS:
            if knob.reset:
                cfg[knob.key] = self._knob_default(knob)

        return cfg

    def reset_option_settings(self) -> dict:
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg = self._write_baseline_settings(cfg)
            cfg = self.ensure_display_settings(cfg)
            self.save_config(cfg)

            return cfg

    def apply_setup_profile(self, profile: str, preserve_other_settings: bool = False) -> dict:
        key = str(profile or "").strip().lower()
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())

            if preserve_other_settings:
                defaults = self._write_baseline_settings(dict(cfg))
                for setting_key in _SETUP_PROFILE_KEYS:
                    cfg[setting_key] = defaults[setting_key]
            else:
                carried_resume = cfg.get("resumeState")
                cfg = self._write_baseline_settings(cfg)

            if key == "basic":
                cfg["socialGameTicker"] = False
                cfg["socialHubTicker"] = False
                cfg["playersNearYouEnabled"] = False
                cfg["notifyWallEnabled"] = False
                cfg["notifyWallToast"] = False
                cfg["commentsServiceWallCheck"] = False
                cfg["socialActivityTrickleService"] = False
                cfg["trackedSetsServiceEnabled"] = False
            elif key == "social":
                cfg["notifySocialUnlockEnabled"] = True
                cfg["notifySocialUnlockToast"] = True
                cfg["notifyNearYouEnabled"] = True
                cfg["notifyNearYouToast"] = True
                cfg["activityFriendsPerTick"] = 4
                cfg["activityCacheMinutes"] = 3

            cfg["viewedIntro"] = True

            if not preserve_other_settings:
                cfg["resumeState"] = carried_resume

            cfg = self.ensure_display_settings(cfg)
            self.save_config(cfg)

            return cfg

    def clear_api_key(self):
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["webApiKey"] = ""
            self.save_config(cfg)

    def run_under_config_lock(self, fn):
        with self._config_lock:
            return fn()

    def load_update_check_state(self, cfg: dict | None = None) -> dict:
        if cfg is None:
            try:
                cfg = self.load_config()
            except Exception:
                cfg = {}
        if not isinstance(cfg, dict):
            cfg = {}

        raw = cfg.get("updateRelease")
        release = None
        if isinstance(raw, dict):
            tag = str(raw.get("tag") or "").strip()
            if tag:
                release = {
                    "tag": tag,
                    "htmlUrl": str(raw.get("htmlUrl") or "").strip(),
                    "publishedAt": str(raw.get("publishedAt") or "").strip(),
                }

        return {
            "release": release,
            "lastCheckedAt": to_int(cfg.get("updateLastCheckedAt", 0), 0),
            "lastNotifiedTag": str(cfg.get("updateLastNotifiedTag") or "").strip(),
        }

    def save_update_release(self, release: dict, checked_at: int) -> None:
        with self._config_lock:
            cfg = self.load_config()
            cfg["updateRelease"] = {
                "tag": str(release.get("tag") or "").strip(),
                "htmlUrl": str(release.get("htmlUrl") or "").strip(),
                "publishedAt": str(release.get("publishedAt") or "").strip(),
            }
            cfg["updateLastCheckedAt"] = to_int(checked_at, 0)
            self.save_config(cfg)

    def save_update_notified_tag(self, tag: str) -> None:
        with self._config_lock:
            cfg = self.load_config()
            cfg["updateLastNotifiedTag"] = str(tag or "").strip()
            self.save_config(cfg)

    def save_changelog_version(self, version: str) -> None:
        with self._config_lock:
            cfg = self.load_config()
            cfg["lastChangelogVersion"] = str(version or "").strip()
            self.save_config(cfg)

    def get_changelog_version(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        return str(source.get("lastChangelogVersion") or "").strip()

    def _read_favorites_unlocked(self) -> list[str]:
        raw = load_json_file(self._favorites_file, {})
        raw_favorites = raw.get("favoriteUlids", []) if isinstance(raw, dict) else []
        if not isinstance(raw_favorites, list):
            return []

        favorites = []
        seen = set()
        for value in raw_favorites:
            ulid = str(value or "").strip()
            if not ulid:
                continue

            if ulid in seen:
                continue

            seen.add(ulid)
            favorites.append(ulid)

        return favorites

    def get_favorite_friends(self) -> list[str]:
        with self._favorites_lock:
            return self._read_favorites_unlocked()

    _SOCIAL_VIEW_OPTIONS = ("friends", "favorites", "activity", "subscribedDiscussions", "newsEvents")

    def get_last_social_view(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("lastSocialView", "friends") or "friends").strip()
        if value not in self._SOCIAL_VIEW_OPTIONS:
            return "friends"
        return value

    def update_last_social_view(self, value: str) -> str:
        next_view = str(value or "").strip()
        if next_view not in self._SOCIAL_VIEW_OPTIONS:
            next_view = "friends"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["lastSocialView"] = next_view
            self.save_config(cfg)
            return next_view

    _BADGES_SORT_OPTIONS = ("oldest", "newest")

    def get_badges_sort_order(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("badgesSortOrder", "oldest") or "oldest").strip()
        if value not in self._BADGES_SORT_OPTIONS:
            return "oldest"
        return value

    def update_badges_sort_order(self, value: str) -> str:
        next_order = str(value or "").strip()
        if next_order not in self._BADGES_SORT_OPTIONS:
            next_order = "oldest"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["badgesSortOrder"] = next_order
            self.save_config(cfg)
            return next_order

    def get_last_console_id(self, cfg: dict | None = None) -> int:
        source = self.load_config() if cfg is None else cfg
        try:
            value = int(source.get("lastConsoleId", 0) or 0)
        except (TypeError, ValueError):
            return 0
        return value if value > 0 else 0

    def update_last_console_id(self, value) -> int:
        try:
            next_id = int(value or 0)
        except (TypeError, ValueError):
            next_id = 0
        if next_id < 0:
            next_id = 0

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["lastConsoleId"] = next_id
            self.save_config(cfg)
            return next_id

    def get_cheevo_check_last_system_id(self, cfg: dict | None = None) -> int:
        source = self.load_config() if cfg is None else cfg
        try:
            value = int(source.get("cheevoCheckLastSystemId", 0) or 0)
        except (TypeError, ValueError):
            return 0
        return value if value > 0 else 0

    def update_cheevo_check_last_system_id(self, value) -> int:
        try:
            next_id = int(value or 0)
        except (TypeError, ValueError):
            next_id = 0
        if next_id < 0:
            next_id = 0

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["cheevoCheckLastSystemId"] = next_id
            self.save_config(cfg)
            return next_id

    _SOCIAL_ENTRY_DEFAULT_OPTIONS = ("friends", "favorites", "activity", "subscribedDiscussions", "newsEvents", "lastUsed")

    def get_social_entry_default(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("socialEntryDefault", "friends") or "friends").strip()
        if value not in self._SOCIAL_ENTRY_DEFAULT_OPTIONS:
            return "friends"
        return value

    def update_social_entry_default(self, value: str) -> str:
        next_value = str(value or "").strip()
        if next_value not in self._SOCIAL_ENTRY_DEFAULT_OPTIONS:
            next_value = "friends"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["socialEntryDefault"] = next_value
            self.save_config(cfg)
            return next_value

    _SAVED_COMMENTS_SUBTAB_OPTIONS = ("subscribed", "savedComments")
    _SAVED_COMMENTS_SORT_OPTIONS = ("recent", "oldest", "opened")

    def _normalize_saved_comments_prefs(self, raw) -> dict:
        defaults = _default_saved_comments_prefs()
        if not isinstance(raw, dict):
            return defaults
        sub_tab = str(raw.get("subTab", defaults["subTab"]) or defaults["subTab"]).strip()
        if sub_tab not in self._SAVED_COMMENTS_SUBTAB_OPTIONS:
            sub_tab = defaults["subTab"]
        sort = str(raw.get("sort", defaults["sort"]) or defaults["sort"]).strip()
        if sort not in self._SAVED_COMMENTS_SORT_OPTIONS:
            sort = defaults["sort"]
        filter_value = str(raw.get("filter", defaults["filter"]) or defaults["filter"]).strip()
        if filter_value not in ("all", "achievement", "wall") and not filter_value.isdigit():
            filter_value = defaults["filter"]
        return {"subTab": sub_tab, "sort": sort, "filter": filter_value}

    def get_saved_comments_prefs(self, cfg: dict | None = None) -> dict:
        source = self.load_config() if cfg is None else cfg
        return self._normalize_saved_comments_prefs(source.get("savedCommentsPrefs"))

    def update_saved_comments_prefs(self, prefs) -> dict:
        incoming = prefs if isinstance(prefs, dict) else {}
        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            merged = self._normalize_saved_comments_prefs(cfg.get("savedCommentsPrefs"))
            for key in ("subTab", "sort", "filter"):
                if key in incoming:
                    merged[key] = incoming[key]
            normalized = self._normalize_saved_comments_prefs(merged)
            cfg["savedCommentsPrefs"] = normalized
            self.save_config(cfg)
            return normalized

    _ACTIVITY_CARD_ACTION_OPTIONS = ("profile", "achievement", "game")

    def get_activity_card_action(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("activityCardAction", "achievement") or "achievement").strip()
        if value not in self._ACTIVITY_CARD_ACTION_OPTIONS:
            return "achievement"
        return value

    def update_activity_card_action(self, value: str) -> str:
        next_value = str(value or "").strip()
        if next_value not in self._ACTIVITY_CARD_ACTION_OPTIONS:
            next_value = "achievement"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["activityCardAction"] = next_value
            self.save_config(cfg)
            return next_value

    def get_friend_feed_card_action(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("friendFeedCardAction", "achievement") or "achievement").strip()
        if value not in self._ACTIVITY_CARD_ACTION_OPTIONS:
            return "achievement"
        return value

    def update_friend_feed_card_action(self, value: str) -> str:
        next_value = str(value or "").strip()
        if next_value not in self._ACTIVITY_CARD_ACTION_OPTIONS:
            next_value = "achievement"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["friendFeedCardAction"] = next_value
            self.save_config(cfg)
            return next_value

    def get_social_hub_card_action(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("socialHubCardAction", "achievement") or "achievement").strip()
        if value not in self._ACTIVITY_CARD_ACTION_OPTIONS:
            return "achievement"
        return value

    def update_social_hub_card_action(self, value: str) -> str:
        next_value = str(value or "").strip()
        if next_value not in self._ACTIVITY_CARD_ACTION_OPTIONS:
            next_value = "achievement"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["socialHubCardAction"] = next_value
            self.save_config(cfg)
            return next_value

    def get_default_note_color(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("defaultNoteColor", "default") or "default").strip().lower()
        if value not in _NOTE_COLOR_OPTIONS:
            return "default"
        return value

    def update_default_note_color(self, value: str) -> str:
        next_value = str(value or "").strip().lower()
        if next_value not in _NOTE_COLOR_OPTIONS:
            next_value = "default"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["defaultNoteColor"] = next_value
            self.save_config(cfg)
            return next_value

    _OPTIONS_TAB_OPTIONS = ("system", "gui", "social", "cache", "advanced")

    def get_last_options_tab(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("lastOptionsTab", "system") or "system").strip()
        if value not in self._OPTIONS_TAB_OPTIONS:
            return "system"
        return value

    def update_last_options_tab(self, value: str) -> str:
        next_tab = str(value or "").strip()
        if next_tab not in self._OPTIONS_TAB_OPTIONS:
            next_tab = "system"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["lastOptionsTab"] = next_tab
            self.save_config(cfg)
            return next_tab

    _TRACKED_TAB_OPTIONS = ("thisGame", "otherGames", "clear")

    def get_last_tracked_tab(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("lastTrackedTab", "thisGame") or "thisGame").strip()
        if value not in self._TRACKED_TAB_OPTIONS:
            return "thisGame"
        return value

    def update_last_tracked_tab(self, value: str) -> str:
        next_tab = str(value or "").strip()
        if next_tab not in self._TRACKED_TAB_OPTIONS:
            next_tab = "thisGame"

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            cfg["lastTrackedTab"] = next_tab
            self.save_config(cfg)
            return next_tab

    def get_viewed_intro(self, cfg: dict) -> bool:
        return bool(cfg.get("viewedIntro", False))

    def update_viewed_intro(self, value: bool) -> bool:
        cfg = self._update_config("viewedIntro", bool(value))

        return self.get_viewed_intro(cfg)

    def set_friend_favorite(self, ulid: str, favorite: bool) -> list[str]:
        target_ulid = str(ulid or "").strip()
        with self._favorites_lock:
            favorites = self._read_favorites_unlocked()
            if not target_ulid:
                return favorites

            updated = []
            found = False
            for saved_ulid in favorites:
                if saved_ulid == target_ulid:
                    found = True
                    if favorite:
                        updated.append(saved_ulid)
                    continue

                updated.append(saved_ulid)

            if favorite and not found:
                updated.append(target_ulid)

            save_json_file(self._favorites_file, {"favoriteUlids": updated}, compact=True)
            return updated

    def _normalize_nav_stack(self, raw):
        if not isinstance(raw, list) or not raw:
            return None
        if len(raw) > _MAX_RESUME_NAV_DEPTH:
            return None
        trail = []
        for entry in raw:
            view = str(entry or "").strip()
            if view not in _ALLOWED_RESUME_VIEWS:
                return None
            trail.append(view)
        return trail

    def _normalize_ao_snapshot(self, raw):
        if not isinstance(raw, dict):
            return None
        ach_id = raw.get("id")
        try:
            ach_id_int = int(ach_id) if ach_id is not None else None
        except (ValueError, TypeError, OverflowError):
            return None
        if ach_id_int is None:
            return None
        return {
            "id": ach_id_int,
            "title": str(raw.get("title") or ""),
            "description": str(raw.get("description") or ""),
            "points": to_int(raw.get("points"), 0),
            "badgeName": str(raw.get("badgeName") or ""),
            "imageIcon": str(raw.get("imageIcon") or "") or None,
            "isLocked": bool(raw.get("isLocked", True)),
            "dateEarned": str(raw.get("dateEarned") or "") or None,
        }

    def load_resume_state(self):
        cfg = self.load_config()
        raw = cfg.get("resumeState")
        if not isinstance(raw, dict):
            return None

        view = str(raw.get("view") or "").strip()
        if view not in _ALLOWED_RESUME_VIEWS:
            return None

        compare_filter = str(raw.get("nowPlayingCompareFilter") or "").strip()
        if compare_filter not in _ALLOWED_NOW_PLAYING_COMPARE_FILTERS:
            compare_filter = None

        main_achievements_tab = str(raw.get("mainAchievementsTab") or "").strip()
        if main_achievements_tab not in _ALLOWED_MAIN_ACHIEVEMENTS_TABS:
            main_achievements_tab = None

        news_events_sub_view = str(raw.get("newsEventsSubView") or "").strip()
        if news_events_sub_view not in _ALLOWED_NEWS_EVENTS_SUB_VIEWS:
            news_events_sub_view = None

        new_sets_filter = str(raw.get("newSetsFilter") or "").strip()
        if new_sets_filter not in _ALLOWED_NEW_SETS_FILTERS:
            new_sets_filter = None

        aotw_sub_view = str(raw.get("aotwSubView") or "").strip()
        if aotw_sub_view not in _ALLOWED_AOTW_SUB_VIEWS:
            aotw_sub_view = None

        unlock_history_source = str(raw.get("unlockHistorySource") or "").strip()
        if unlock_history_source not in _ALLOWED_UNLOCK_HISTORY_SOURCES:
            unlock_history_source = "main"

        all_games_letter_range = str(raw.get("allGamesLetterRange") or "").strip()
        if all_games_letter_range not in _ALLOWED_ALL_GAMES_RANGES:
            all_games_letter_range = "a-f"

        all_games_status_filter = str(raw.get("allGamesStatusFilter") or "").strip()
        if all_games_status_filter not in _ALLOWED_ALL_GAMES_STATUS_FILTERS:
            all_games_status_filter = "all"

        badge_filter = str(raw.get("badgeFilter") or "").strip()
        if badge_filter not in _ALLOWED_BADGE_FILTERS:
            badge_filter = "all"

        followed_ranking_metric = str(raw.get("followedRankingMetric") or "").strip()
        if followed_ranking_metric not in _ALLOWED_FOLLOWED_RANKING_METRICS:
            followed_ranking_metric = None

        game_overview_sub_view = str(raw.get("gameOverviewSubView") or "").strip()
        if game_overview_sub_view not in _ALLOWED_GAME_OVERVIEW_SUB_VIEWS:
            game_overview_sub_view = None

        friend_profile_sub_view = str(raw.get("friendProfileSubView") or "").strip()
        if friend_profile_sub_view not in _ALLOWED_FRIEND_PROFILE_SUB_VIEWS:
            friend_profile_sub_view = None

        guides_sub_view = str(raw.get("guidesSubView") or "").strip()
        if guides_sub_view not in _ALLOWED_GUIDES_SUB_VIEWS:
            guides_sub_view = None

        game_overview_source = str(raw.get("gameOverviewSource") or "").strip()
        if game_overview_source not in _ALLOWED_GAME_OVERVIEW_SOURCES:
            game_overview_source = None

        leaderboards_source_view = str(raw.get("leaderboardsSourceView") or "").strip()
        if leaderboards_source_view not in _ALLOWED_LEADERBOARDS_SOURCE_VIEWS:
            leaderboards_source_view = "achievements"

        ao_source = str(raw.get("aoSource") or "").strip()
        if ao_source not in _ALLOWED_AO_SOURCES:
            ao_source = None

        friend_entry_source = str(raw.get("friendEntrySource") or "").strip()
        if friend_entry_source not in _ALLOWED_FRIEND_ENTRY_SOURCES:
            friend_entry_source = None

        raw_ao_achievement_id = raw.get("aoAchievementId")
        try:
            ao_achievement_id = int(raw_ao_achievement_id) if raw_ao_achievement_id is not None else None
        except (ValueError, TypeError, OverflowError):
            ao_achievement_id = None

        ao_snapshot = self._normalize_ao_snapshot(raw.get("aoAchievementSnapshot"))
        nav_stack = self._normalize_nav_stack(raw.get("navStack"))

        focus_key = raw.get("focusKey")
        return {
            "view": view,
            "navStack": nav_stack,
            "focusKey": str(focus_key).strip() if focus_key else None,
            "primaryGameId": norm_game_id(raw.get("primaryGameId")),
            "selectedFriendUsername": str(raw.get("selectedFriendUsername") or "").strip() or None,
            "selectedFriendUlid": str(raw.get("selectedFriendUlid") or "").strip() or None,
            "friendGameId": norm_game_id(raw.get("friendGameId")),
            "friendAllGamesCount": max(0, to_int(raw.get("friendAllGamesCount"), 0)) or None,
            "friendGameSource": "allGames" if str(raw.get("friendGameSource") or "").strip() == "allGames" else "recentGames",
            "friendGameSelectionMode": "explicit" if str(raw.get("friendGameSelectionMode") or "").strip() == "explicit" else "auto",
            "friendProfileSubView": friend_profile_sub_view,
            "guidesSubView": guides_sub_view,
            "guidesFaqId": str(raw.get("guidesFaqId") or "").strip() or None,
            "leaderboardsSourceView": leaderboards_source_view,
            "selectedLeaderboardId": norm_game_id(raw.get("selectedLeaderboardId")),
            "nowPlayingCompareFriend": str(raw.get("nowPlayingCompareFriend") or "").strip() or None,
            "nowPlayingCompareFilter": compare_filter,
            "mainAchievementsTab": main_achievements_tab,
            "newsEventsSubView": news_events_sub_view,
            "newSetsFilter": new_sets_filter,
            "aotwSubView": aotw_sub_view,
            "gameOverviewSubView": game_overview_sub_view,
            "gameOverviewSource": game_overview_source,
            "gameOverviewGameId": norm_game_id(raw.get("gameOverviewGameId")),
            "gameOverviewViewedUsername": str(raw.get("gameOverviewViewedUsername") or "").strip() or None,
            "gameOverviewViewedUserRef": str(raw.get("gameOverviewViewedUserRef") or "").strip() or None,
            "gameNotesGameId": norm_game_id(raw.get("gameNotesGameId")),
            "aoSource": ao_source,
            "aoAchievementId": ao_achievement_id,
            "aoGameId": norm_game_id(raw.get("aoGameId")),
            "aoAchievementSnapshot": ao_snapshot,
            "aoViewedUsername": str(raw.get("aoViewedUsername") or "").strip() or None,
            "aoViewedUserRef": str(raw.get("aoViewedUserRef") or "").strip() or None,
            "friendEntrySource": friend_entry_source,
            "trackedSelectedGameId": norm_game_id(raw.get("trackedSelectedGameId")),
            "unlockHistorySource": unlock_history_source,
            "friendProfileBackSource": "main" if str(raw.get("friendProfileBackSource") or "").strip() == "main" else "social",
            "badgeFilter": badge_filter,
            "allGamesLetterRange": all_games_letter_range,
            "allGamesStatusFilter": all_games_status_filter,
            "trackedSetOpenId": str(raw.get("trackedSetOpenId") or "").strip() or None,
            "trackedSetsBackSource": "main" if str(raw.get("trackedSetsBackSource") or "").strip() == "main" else "profile",
            "followedRankingMetric": followed_ranking_metric,
            "savedAt": to_int(raw.get("savedAt"), 0) or None,
        }

    def save_resume_state(self, resume_state):
        with self._config_lock:
            cfg = self.load_config()
            if not isinstance(resume_state, dict):
                cfg["resumeState"] = None
                self.save_config(cfg)
                return None

            view = str(resume_state.get("view") or "").strip()
            if view not in _ALLOWED_RESUME_VIEWS:
                cfg["resumeState"] = None
                self.save_config(cfg)
                return None

            compare_filter = str(resume_state.get("nowPlayingCompareFilter") or "").strip()
            if compare_filter not in _ALLOWED_NOW_PLAYING_COMPARE_FILTERS:
                compare_filter = None

            main_achievements_tab = str(resume_state.get("mainAchievementsTab") or "").strip()
            if main_achievements_tab not in _ALLOWED_MAIN_ACHIEVEMENTS_TABS:
                main_achievements_tab = None

            news_events_sub_view = str(resume_state.get("newsEventsSubView") or "").strip()
            if news_events_sub_view not in _ALLOWED_NEWS_EVENTS_SUB_VIEWS:
                news_events_sub_view = None

            new_sets_filter = str(resume_state.get("newSetsFilter") or "").strip()
            if new_sets_filter not in _ALLOWED_NEW_SETS_FILTERS:
                new_sets_filter = None

            aotw_sub_view = str(resume_state.get("aotwSubView") or "").strip()
            if aotw_sub_view not in _ALLOWED_AOTW_SUB_VIEWS:
                aotw_sub_view = None

            unlock_history_source = str(resume_state.get("unlockHistorySource") or "").strip()
            if unlock_history_source not in _ALLOWED_UNLOCK_HISTORY_SOURCES:
                unlock_history_source = "main"

            all_games_letter_range = str(resume_state.get("allGamesLetterRange") or "").strip()
            if all_games_letter_range not in _ALLOWED_ALL_GAMES_RANGES:
                all_games_letter_range = "a-f"

            all_games_status_filter = str(resume_state.get("allGamesStatusFilter") or "").strip()
            if all_games_status_filter not in _ALLOWED_ALL_GAMES_STATUS_FILTERS:
                all_games_status_filter = "all"

            badge_filter = str(resume_state.get("badgeFilter") or "").strip()
            if badge_filter not in _ALLOWED_BADGE_FILTERS:
                badge_filter = "all"

            followed_ranking_metric = str(resume_state.get("followedRankingMetric") or "").strip()
            if followed_ranking_metric not in _ALLOWED_FOLLOWED_RANKING_METRICS:
                followed_ranking_metric = None

            game_overview_sub_view = str(resume_state.get("gameOverviewSubView") or "").strip()
            if game_overview_sub_view not in _ALLOWED_GAME_OVERVIEW_SUB_VIEWS:
                game_overview_sub_view = None

            friend_profile_sub_view = str(resume_state.get("friendProfileSubView") or "").strip()
            if friend_profile_sub_view not in _ALLOWED_FRIEND_PROFILE_SUB_VIEWS:
                friend_profile_sub_view = None

            guides_sub_view = str(resume_state.get("guidesSubView") or "").strip()
            if guides_sub_view not in _ALLOWED_GUIDES_SUB_VIEWS:
                guides_sub_view = None

            game_overview_source = str(resume_state.get("gameOverviewSource") or "").strip()
            if game_overview_source not in _ALLOWED_GAME_OVERVIEW_SOURCES:
                game_overview_source = None

            leaderboards_source_view = str(resume_state.get("leaderboardsSourceView") or "").strip()
            if leaderboards_source_view not in _ALLOWED_LEADERBOARDS_SOURCE_VIEWS:
                leaderboards_source_view = "achievements"

            ao_source = str(resume_state.get("aoSource") or "").strip()
            if ao_source not in _ALLOWED_AO_SOURCES:
                ao_source = None

            friend_entry_source = str(resume_state.get("friendEntrySource") or "").strip()
            if friend_entry_source not in _ALLOWED_FRIEND_ENTRY_SOURCES:
                friend_entry_source = None

            raw_ao_achievement_id = resume_state.get("aoAchievementId")
            try:
                ao_achievement_id = int(raw_ao_achievement_id) if raw_ao_achievement_id is not None else None
            except (ValueError, TypeError, OverflowError):
                ao_achievement_id = None

            ao_snapshot = self._normalize_ao_snapshot(resume_state.get("aoAchievementSnapshot"))
            nav_stack = self._normalize_nav_stack(resume_state.get("navStack"))

            payload = {
                "view": view,
                "navStack": nav_stack,
                "focusKey": str(resume_state.get("focusKey") or "").strip() or None,
                "primaryGameId": norm_game_id(resume_state.get("primaryGameId")),
                "selectedFriendUsername": str(resume_state.get("selectedFriendUsername") or "").strip() or None,
                "selectedFriendUlid": str(resume_state.get("selectedFriendUlid") or "").strip() or None,
                "friendGameId": norm_game_id(resume_state.get("friendGameId")),
                "friendAllGamesCount": max(0, to_int(resume_state.get("friendAllGamesCount"), 0)) or None,
                "friendGameSource": "allGames" if str(resume_state.get("friendGameSource") or "").strip() == "allGames" else "recentGames",
                "friendGameSelectionMode": "explicit" if str(resume_state.get("friendGameSelectionMode") or "").strip() == "explicit" else "auto",
                "friendProfileSubView": friend_profile_sub_view,
                "guidesSubView": guides_sub_view,
                "guidesFaqId": str(resume_state.get("guidesFaqId") or "").strip() or None,
                "leaderboardsSourceView": leaderboards_source_view,
                "selectedLeaderboardId": norm_game_id(resume_state.get("selectedLeaderboardId")),
                "nowPlayingCompareFriend": str(resume_state.get("nowPlayingCompareFriend") or "").strip() or None,
                "nowPlayingCompareFilter": compare_filter,
                "mainAchievementsTab": main_achievements_tab,
                "newsEventsSubView": news_events_sub_view,
                "newSetsFilter": new_sets_filter,
                "aotwSubView": aotw_sub_view,
                "gameOverviewSubView": game_overview_sub_view,
                "gameOverviewSource": game_overview_source,
                "gameOverviewGameId": norm_game_id(resume_state.get("gameOverviewGameId")),
                "gameOverviewViewedUsername": str(resume_state.get("gameOverviewViewedUsername") or "").strip() or None,
                "gameOverviewViewedUserRef": str(resume_state.get("gameOverviewViewedUserRef") or "").strip() or None,
                "gameNotesGameId": norm_game_id(resume_state.get("gameNotesGameId")),
                "aoSource": ao_source,
                "aoAchievementId": ao_achievement_id,
                "aoGameId": norm_game_id(resume_state.get("aoGameId")),
                "aoAchievementSnapshot": ao_snapshot,
                "aoViewedUsername": str(resume_state.get("aoViewedUsername") or "").strip() or None,
                "aoViewedUserRef": str(resume_state.get("aoViewedUserRef") or "").strip() or None,
                "friendEntrySource": friend_entry_source,
                "trackedSelectedGameId": norm_game_id(resume_state.get("trackedSelectedGameId")),
                "unlockHistorySource": unlock_history_source,
                "friendProfileBackSource": "main" if str(resume_state.get("friendProfileBackSource") or "").strip() == "main" else "social",
                "badgeFilter": badge_filter,
                "allGamesLetterRange": all_games_letter_range,
                "allGamesStatusFilter": all_games_status_filter,
                "trackedSetOpenId": str(resume_state.get("trackedSetOpenId") or "").strip() or None,
                "trackedSetsBackSource": "main" if str(resume_state.get("trackedSetsBackSource") or "").strip() == "main" else "profile",
                "followedRankingMetric": followed_ranking_metric,
                "savedAt": to_int(resume_state.get("savedAt"), int(time.time() * 1000)),
            }
            cfg["resumeState"] = payload
            self.save_config(cfg)
            return payload

    def clear_resume_state(self) -> None:
        self.save_resume_state(None)

    def bulk_toggle_tracked(self, game_id, achievement_ids, action,
                            title=None, console_name=None, image_icon=None) -> dict:
        """Add, remove, or replace multiple tracked ids for a game in one go.

        ``action`` is one of:

        - ``"track"``   add every id in ``achievement_ids`` that isn't
                        already tracked. Existing tracked ids stay where
                        they are; new ids land at the end of the manual
                        order in the order they were passed.
        - ``"untrack"`` remove every id in ``achievement_ids`` that is
                        currently tracked. Ids not present in the
                        tracked list are no-ops.
        - ``"set"``     replace the entire tracked list with
                        ``achievement_ids``, in the given order.
                        ``_save_tracked_for_game_locked`` will de-dupe.

        The point of this method is to do one load, one mutation across
        every id, and one save. The single-toggle path is a thin wrapper
        on top of this -- it figures out from current state whether it
        wants to track or untrack the single id and then routes here.

        Returns the same shape as _save_tracked_for_game_locked's return, plus
        a ``changed`` count showing how many ids actually moved.
        """
        game_id_int = norm_game_id(game_id)
        key = self._game_key(game_id_int)
        if not key:
            return {
                "ok": False,
                "achievementIds": [],
                "notes": {},
                "notesColor": {},
                "sort": self.get_tracked_achievement_sort(self.load_config()),
                "changed": 0,
            }

        incoming = []
        for value in achievement_ids or []:
            try:
                incoming.append(int(value))
            except (ValueError, TypeError, OverflowError):
                continue

        with self._lock_for_game(key):
            entry = self._load_tracked_for_game_key(key)
            current = []
            seen_current = set()
            for value in entry.get("achievementIds", []) or []:
                try:
                    ach_id = int(value)
                except (ValueError, TypeError, OverflowError):
                    continue
                if ach_id in seen_current:
                    continue
                seen_current.add(ach_id)
                current.append(ach_id)

            if action == "track":
                already = set(current)
                additions = [a for a in incoming if a not in already]
                seen_add = set()
                ordered_additions = []
                for a in additions:
                    if a in seen_add:
                        continue
                    seen_add.add(a)
                    ordered_additions.append(a)
                next_ids = current + ordered_additions
                changed = len(ordered_additions)
            elif action == "untrack":
                drop = set(incoming)
                next_ids = [a for a in current if a not in drop]
                changed = len(current) - len(next_ids)
            elif action == "set":
                next_ids = list(incoming)
                changed = 0 if next_ids == current else max(
                    len(set(next_ids).symmetric_difference(set(current))), 1
                )
            else:
                return {
                    "ok": False,
                    "achievementIds": current,
                    "notes": self._sanitize_notes_dict(entry.get("notes", {})),
                    "notesColor": self._sanitize_notes_color_dict(entry.get("notesColor", {})),
                    "sort": self.get_tracked_achievement_sort(self.load_config()),
                    "changed": 0,
                }

            if action in ("untrack", "set"):
                existing_notes = entry.get("notes", {}) or {}
                existing_notes_color = entry.get("notesColor", {}) or {}
                existing_notes_last_edited_at = entry.get("notesLastEditedAt", {}) or {}
                kept_keys = {str(a) for a in next_ids}
                next_notes = {
                    note_key: value for note_key, value in existing_notes.items()
                    if note_key in kept_keys
                }
                next_notes_color = {
                    note_key: value for note_key, value in existing_notes_color.items()
                    if note_key in kept_keys
                }
                next_notes_last_edited_at = {
                    note_key: value for note_key, value in existing_notes_last_edited_at.items()
                    if note_key in kept_keys
                }
                saved = self._save_tracked_for_game_locked(
                    key,
                    next_ids,
                    notes=next_notes,
                    notes_color=next_notes_color,
                    notes_last_edited_at=next_notes_last_edited_at,
                    title=title,
                    console_name=console_name,
                    image_icon=image_icon,
                )
            else:
                saved = self._save_tracked_for_game_locked(
                    key,
                    next_ids,
                    title=title,
                    console_name=console_name,
                    image_icon=image_icon,
                )

        return {
            "ok": bool(saved.get("ok", False)),
            "achievementIds": list(saved.get("achievementIds", [])),
            "notes": dict(saved.get("notes", {}) or {}),
            "notesColor": dict(saved.get("notesColor", {}) or {}),
            "sort": str(saved.get("sort", self.get_tracked_achievement_sort(self.load_config()))),
            "changed": changed,
        }

    def toggle_tracked_achievement(self, game_id, achievement_id, title=None, console_name=None, image_icon=None) -> dict:
        try:
            if achievement_id is None:
                raise ValueError("missing achievement id")
            norm_achievement_id = int(achievement_id)
        except Exception:
            return {
                "ok": False,
                "tracked": False,
                "achievementIds": [],
                "notes": {},
                "notesColor": {},
            }

        game_id_int = norm_game_id(game_id)
        current = self.load_tracked_for_game(game_id_int)
        currently_tracked = norm_achievement_id in (current.get("achievementIds") or [])
        action = "untrack" if currently_tracked else "track"

        saved = self.bulk_toggle_tracked(
            game_id_int,
            [norm_achievement_id],
            action,
            title=title,
            console_name=console_name,
            image_icon=image_icon,
        )

        return {
            "ok": bool(saved.get("ok", False)),
            "tracked": not currently_tracked,
            "achievementIds": saved.get("achievementIds", []),
            "notes": saved.get("notes", {}),
            "notesColor": saved.get("notesColor", {}),
            "sort": saved.get("sort", self.get_tracked_achievement_sort(self.load_config())),
        }

    def save_tracked_note(self, game_id, achievement_id, note, color=None) -> dict:
        try:
            if achievement_id is None:
                raise ValueError("missing achievement id")
            norm_achievement_id = int(achievement_id)
        except Exception:
            return {
                "ok": False,
                "notes": {},
                "notesColor": {},
            }

        key = self._game_key(game_id)
        if not key:
            return {
                "ok": False,
                "notes": {},
                "notesColor": {},
            }

        with self._lock_for_game(key):
            entry = self._load_tracked_for_game_key(key)
            existing_notes = dict(entry.get("notes", {}) or {})
            existing_notes_color = dict(entry.get("notesColor", {}) or {})
            existing_notes_last_edited_at = dict(entry.get("notesLastEditedAt", {}) or {})

            note_text = "" if note is None else str(note).strip()
            tag_vocab = None
            if note_text:
                existing_notes[str(norm_achievement_id)] = note_text[:TRACKED_NOTE_MAX_LEN]
                existing_notes_last_edited_at[str(norm_achievement_id)] = int(time.time() * 1000)
                used_tag = self._parse_tag_prefix(note_text)
                if used_tag:
                    tag_vocab = self._tag_vocab_with(entry.get("tagVocabulary", []) or [], used_tag)
            else:
                existing_notes.pop(str(norm_achievement_id), None)
                existing_notes_last_edited_at.pop(str(norm_achievement_id), None)

            if color is not None:
                normalized_color = str(color or "").strip().lower()
                if not note_text:
                    existing_notes_color.pop(str(norm_achievement_id), None)
                elif normalized_color and normalized_color != "default" and normalized_color in _NOTE_COLOR_OPTIONS:
                    existing_notes_color[str(norm_achievement_id)] = normalized_color
                else:
                    existing_notes_color.pop(str(norm_achievement_id), None)

            saved = self._save_tracked_for_game_locked(
                key,
                entry.get("achievementIds", []),
                notes=existing_notes,
                notes_color=existing_notes_color,
                notes_last_edited_at=existing_notes_last_edited_at,
                tag_vocabulary=tag_vocab,
            )
        return {
            "ok": bool(saved.get("ok", False)),
            "notes": saved.get("notes", {}),
            "notesColor": saved.get("notesColor", {}),
        }

    def save_tracked_sort_for_game(self, game_id, sort: str) -> dict:
        game_id_int = norm_game_id(game_id)
        key = self._game_key(game_id_int)
        if not key:
            return {
                "ok": False,
                "gameId": game_id_int,
                "sort": self.get_tracked_achievement_sort(self.load_config()),
                "achievementIds": [],
                "notes": {},
                "notesColor": {},
            }
        with self._lock_for_game(key):
            entry = self._load_tracked_for_game_key(key)
            saved = self._save_tracked_for_game_locked(
                key,
                entry.get("achievementIds", []),
                sort=sort,
            )
        return {
            "ok": bool(saved.get("ok", False)),
            "gameId": game_id_int,
            "sort": str(saved.get("sort", self.get_tracked_achievement_sort(self.load_config()))),
            "achievementIds": list(saved.get("achievementIds", [])),
            "notes": dict(saved.get("notes", {}) or {}),
            "notesColor": dict(saved.get("notesColor", {}) or {}),
        }

    def _game_key(self, game_id):
        game_id_int = norm_game_id(game_id)
        return str(game_id_int) if game_id_int is not None else None

    def load_tracked_for_game(self, game_id) -> dict:
        cfg = self.load_config()
        key = self._game_key(game_id)
        global_sort = self.get_tracked_achievement_sort(cfg)
        if not key:
            return {
                "viewOpen": False, "achievementIds": [], "notes": {}, "notesColor": {},
                "notesLastEditedAt": {},
                "lastPrimaryView": "achievements",
                "title": None, "consoleName": None, "imageIcon": None,
                "sort": global_sort,
                "tagVocabulary": [],
            }
        entry = self._load_tracked_for_game_key(key)
        achievement_ids = []
        for value in entry.get("achievementIds", []):
            try:
                achievement_ids.append(int(value))
            except (ValueError, TypeError, OverflowError):
                pass
        notes = self._sanitize_notes_dict(entry.get("notes", {}))
        notes_color = self._sanitize_notes_color_dict(entry.get("notesColor", {}))
        notes_last_edited_at = self._sanitize_notes_last_edited_at_dict(entry.get("notesLastEditedAt", {}))
        last_primary_view = str(entry.get("lastPrimaryView", "achievements") or "achievements").strip().lower()
        if last_primary_view not in ("achievements", "tracked"):
            last_primary_view = "achievements"
        raw_sort = str(entry.get("sort", global_sort) or global_sort).strip()
        sort_value = raw_sort if raw_sort in _ALLOWED_TRACKED_SORTS else global_sort
        if "tagVocabulary" in entry:
            tag_vocabulary = self._sanitize_tag_vocab(entry.get("tagVocabulary"))
        else:
            tag_vocabulary = self._seed_tag_vocab_from_notes(notes, notes_last_edited_at)
        return {
            "viewOpen": bool(entry.get("viewOpen", False)),
            "achievementIds": achievement_ids,
            "notes": notes,
            "notesColor": notes_color,
            "notesLastEditedAt": notes_last_edited_at,
            "lastPrimaryView": last_primary_view,
            "title": self._coerce_optional_str(entry.get("title")),
            "consoleName": self._coerce_optional_str(entry.get("consoleName")),
            "imageIcon": self._coerce_optional_str(entry.get("imageIcon")),
            "sort": sort_value,
            "tagVocabulary": tag_vocabulary,
        }

    def _sanitize_notes_dict(self, raw) -> dict:
        if not isinstance(raw, dict):
            return {}
        cleaned = {}
        for key, value in raw.items():
            try:
                ach_id = int(key)
            except (ValueError, TypeError, OverflowError):
                continue
            if not isinstance(value, str):
                continue
            trimmed = value.strip()
            if not trimmed:
                continue
            cleaned[str(ach_id)] = trimmed[:TRACKED_NOTE_MAX_LEN]
        return cleaned

    def _sanitize_notes_color_dict(self, raw) -> dict:
        if not isinstance(raw, dict):
            return {}
        cleaned = {}
        for key, value in raw.items():
            try:
                ach_id = int(key)
            except (ValueError, TypeError, OverflowError):
                continue
            if not isinstance(value, str):
                continue
            trimmed = value.strip().lower()
            if not trimmed or trimmed == "default":
                continue
            if trimmed not in _NOTE_COLOR_OPTIONS:
                continue
            cleaned[str(ach_id)] = trimmed
        return cleaned

    def _sanitize_notes_last_edited_at_dict(self, raw) -> dict:
        if not isinstance(raw, dict):
            return {}
        cleaned = {}
        for key, value in raw.items():
            try:
                ach_id = int(key)
            except (ValueError, TypeError, OverflowError):
                continue
            ts = to_int(value, 0)
            if ts <= 0:
                continue
            cleaned[str(ach_id)] = ts
        return cleaned

    def _parse_tag_prefix(self, note):
        if not isinstance(note, str):
            return None
        match = _TAG_PREFIX_PATTERN.match(note)
        if not match:
            return None
        raw = match.group(1).strip()
        return raw or None

    def _sanitize_tag_vocab(self, raw) -> list:
        if not isinstance(raw, list):
            return []
        cleaned = []
        seen = set()
        for value in raw:
            if not isinstance(value, str):
                continue
            trimmed = value.strip()[:24]
            if not trimmed:
                continue
            lower = trimmed.lower()
            if lower in seen:
                continue
            seen.add(lower)
            cleaned.append(trimmed)
            if len(cleaned) >= _TAG_VOCAB_LIMIT:
                break
        return cleaned

    def _tag_vocab_with(self, vocab, tag) -> list:
        if tag is None:
            return self._sanitize_tag_vocab(vocab)
        clean_tag = str(tag).strip()[:24]
        if not clean_tag:
            return self._sanitize_tag_vocab(vocab)
        lower = clean_tag.lower()
        kept = [t for t in vocab if isinstance(t, str) and t.strip().lower() != lower]
        return self._sanitize_tag_vocab([clean_tag] + kept)

    def _seed_tag_vocab_from_notes(self, notes, notes_last_edited_at) -> list:
        seed_pairs = []
        for ach_id, body in (notes or {}).items():
            tag = self._parse_tag_prefix(body)
            if not tag:
                continue
            ts = to_int((notes_last_edited_at or {}).get(ach_id), 0)
            seed_pairs.append((ts, tag))
        seed_pairs.sort(key=lambda pair: pair[0], reverse=True)
        return self._sanitize_tag_vocab([tag for _, tag in seed_pairs])

    def _coerce_optional_str(self, raw):
        if raw is None:
            return None
        if not isinstance(raw, str):
            return None
        trimmed = raw.strip()
        if not trimmed:
            return None
        return trimmed

    def _save_tracked_for_game_locked(self, key, achievement_ids, view_open=None, notes=None,
                                      title=None, console_name=None, image_icon=None, sort=None, notes_color=None,
                                      notes_last_edited_at=None, tag_vocabulary=None) -> dict:
        cfg = self.load_config()
        existing = self._load_tracked_for_game_key(key)

        deduped = []
        seen = set()
        for value in achievement_ids or []:
            try:
                ach_id = int(value)
            except (ValueError, TypeError, OverflowError):
                continue
            if ach_id in seen:
                continue
            seen.add(ach_id)
            deduped.append(ach_id)

        next_view_open = bool(existing.get("viewOpen", False) if view_open is None else view_open)

        if notes is None:
            next_notes = self._sanitize_notes_dict(existing.get("notes", {}))
        else:
            next_notes = self._sanitize_notes_dict(notes)

        if notes_color is None:
            next_notes_color = self._sanitize_notes_color_dict(existing.get("notesColor", {}))
        else:
            next_notes_color = self._sanitize_notes_color_dict(notes_color)

        if notes_last_edited_at is None:
            next_notes_last_edited_at = self._sanitize_notes_last_edited_at_dict(
                existing.get("notesLastEditedAt", {})
            )
        else:
            next_notes_last_edited_at = self._sanitize_notes_last_edited_at_dict(notes_last_edited_at)

        next_title = self._coerce_optional_str(
            existing.get("title") if title is None else title
        )
        next_console_name = self._coerce_optional_str(
            existing.get("consoleName") if console_name is None else console_name
        )
        next_image_icon = self._coerce_optional_str(
            existing.get("imageIcon") if image_icon is None else image_icon
        )

        global_sort = self.get_tracked_achievement_sort(cfg)
        if sort is not None:
            raw_sort = str(sort or global_sort).strip()
            next_sort = raw_sort if raw_sort in _ALLOWED_TRACKED_SORTS else global_sort
        elif "sort" in existing:
            raw_sort = str(existing.get("sort") or global_sort).strip()
            next_sort = raw_sort if raw_sort in _ALLOWED_TRACKED_SORTS else global_sort
        else:
            next_sort = global_sort

        if tag_vocabulary is not None:
            next_tag_vocabulary = self._sanitize_tag_vocab(tag_vocabulary)
        elif "tagVocabulary" in existing:
            next_tag_vocabulary = self._sanitize_tag_vocab(existing.get("tagVocabulary"))
        else:
            next_tag_vocabulary = self._seed_tag_vocab_from_notes(
                next_notes, next_notes_last_edited_at
            )

        entry = {
            "viewOpen": next_view_open,
            "achievementIds": deduped,
            "notes": next_notes,
            "notesColor": next_notes_color,
            "notesLastEditedAt": next_notes_last_edited_at,
            "title": next_title,
            "consoleName": next_console_name,
            "imageIcon": next_image_icon,
            "sort": next_sort,
            "tagVocabulary": next_tag_vocabulary,
        }
        self._save_tracked_for_game_key(key, entry)
        return {
            "ok": True,
            "viewOpen": next_view_open,
            "achievementIds": deduped,
            "notes": next_notes,
            "notesColor": next_notes_color,
            "notesLastEditedAt": next_notes_last_edited_at,
            "sort": next_sort,
        }

    def clear_tracked_for_game(self, game_id) -> dict:
        key = self._game_key(game_id)
        if not key:
            return {"ok": False, "cleared": 0}
        with self._lock_for_game(key):
            existing = self._load_tracked_for_game_key(key)
            cleared = len(existing.get("achievementIds", []) or [])
            existing["achievementIds"] = []
            existing["notes"] = {}
            existing["notesColor"] = {}
            existing["notesLastEditedAt"] = {}
            existing["viewOpen"] = False
            self._save_tracked_for_game_key(key, existing)
        return {"ok": True, "cleared": cleared}

    def clear_all_tracked(self) -> dict:
        with self._tracked_master_lock:
            cleared = 0
            for stem in list(self._iter_all_tracked_keys()):
                entry = self._load_tracked_for_game_key(stem)
                if isinstance(entry, dict):
                    cleared += len(entry.get("achievementIds", []) or [])
                self._delete_tracked_for_game_key(stem)
            self._tracked_game_locks.clear()
        return {"ok": True, "cleared": cleared}

    def get_total_tracked_count(self) -> int:
        with self._tracked_master_lock:
            total = 0
            for stem in self._iter_all_tracked_keys():
                entry = self._load_tracked_for_game_key(stem)
                if isinstance(entry, dict):
                    total += len(entry.get("achievementIds", []) or [])
        return total

    def get_recent_tags_for_game(self, game_id) -> list:
        tracked = self.load_tracked_for_game(game_id)
        vocab = tracked.get("tagVocabulary", []) or []
        return vocab[:6]

    def get_all_tracked_games(self) -> list:
        games = []
        with self._tracked_master_lock:
            for stem in self._iter_all_tracked_keys():
                entry = self._load_tracked_for_game_key(stem)
                if not isinstance(entry, dict):
                    continue
                game_id = norm_game_id(stem)
                if game_id is None:
                    continue
                count = len(entry.get("achievementIds", []) or [])
                if count <= 0:
                    continue
                games.append({
                    "gameId": game_id,
                    "count": count,
                    "title": self._coerce_optional_str(entry.get("title")),
                    "consoleName": self._coerce_optional_str(entry.get("consoleName")),
                    "imageIcon": self._coerce_optional_str(entry.get("imageIcon")),
                })
        return games

    def cleanup_tracked_against_payload(self, payload) -> dict:
        if not payload:
            return {"removedIds": [], "remainingIds": [], "viewOpen": False}

        key = self._game_key(payload.get("gameId"))
        if not key:
            return {"removedIds": [], "remainingIds": [], "viewOpen": False}

        with self._lock_for_game(key):
            entry = self._load_tracked_for_game_key(key)
            tracked_ids = []
            for value in entry.get("achievementIds", []) or []:
                try:
                    tracked_ids.append(int(value))
                except (ValueError, TypeError, OverflowError):
                    continue
            if not tracked_ids:
                return {
                    "removedIds": [],
                    "remainingIds": [],
                    "viewOpen": bool(entry.get("viewOpen", False)),
                }

            unlocked_ids = set()
            for achievement in payload.get("achievements", []):
                if achievement.get("dateEarned") or achievement.get("dateEarnedHardcore"):
                    try:
                        unlocked_ids.add(int(achievement.get("id")))
                    except (ValueError, TypeError, OverflowError):
                        pass

            remaining = [ach_id for ach_id in tracked_ids if ach_id not in unlocked_ids]
            removed = [ach_id for ach_id in tracked_ids if ach_id in unlocked_ids]
            view_open = bool(entry.get("viewOpen", False))
            if removed:
                view_open = view_open and bool(remaining)
                existing_notes = entry.get("notes", {}) or {}
                existing_notes_color = entry.get("notesColor", {}) or {}
                existing_notes_last_edited_at = entry.get("notesLastEditedAt", {}) or {}
                kept_keys = {str(a) for a in remaining}
                next_notes = {
                    note_key: value for note_key, value in existing_notes.items()
                    if note_key in kept_keys
                }
                next_notes_color = {
                    note_key: value for note_key, value in existing_notes_color.items()
                    if note_key in kept_keys
                }
                next_notes_last_edited_at = {
                    note_key: value for note_key, value in existing_notes_last_edited_at.items()
                    if note_key in kept_keys
                }
                self._save_tracked_for_game_locked(
                    key, remaining, view_open=view_open,
                    notes=next_notes, notes_color=next_notes_color,
                    notes_last_edited_at=next_notes_last_edited_at,
                )
        return {"removedIds": removed, "remainingIds": remaining, "viewOpen": view_open}

    def get_unlock_lookback_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("unlockLookbackMinutes", self._recent_unlock_lookback_minutes), self._recent_unlock_lookback_minutes)
        allowed = {60, 120, 360, 720, 1440}
        return value if value in allowed else self._recent_unlock_lookback_minutes

    def get_unlock_history_days(self, cfg: dict) -> int:
        value = to_int(cfg.get("unlockHistoryDays", self._recent_unlock_history_days), self._recent_unlock_history_days)
        return value if value in UNLOCK_HISTORY_DAY_OPTIONS else self._recent_unlock_history_days

    def get_ui_size(self, cfg: dict) -> str:
        value = str(cfg.get("uiSize", "normal") or "normal").strip().lower()
        legacy_map = {
            "small": "normal",
            "medium": "normal",
        }
        value = legacy_map.get(value, value)
        return value if value in {"normal", "large", "xlarge", "xxlarge", "xxxlarge"} else "normal"

    def get_achievement_text_scale(self, cfg: dict) -> str:
        value = str(cfg.get("achievementTextScale", "normal") or "normal").strip().lower()
        return value if value in {"normal", "large", "xlarge", "xxlarge", "xxxlarge"} else "normal"

    def get_comments_text_scale(self, cfg: dict) -> str:
        value = str(cfg.get("commentsTextScale", "normal") or "normal").strip().lower()
        return value if value in {"normal", "large", "xlarge", "xxlarge", "xxxlarge"} else "normal"

    def get_text_scale(self, cfg: dict) -> str:
        value = str(cfg.get("textScale", "normal") or "normal").strip().lower()
        return value if value in {"normal", "large", "xlarge", "xxlarge", "xxxlarge"} else "normal"

    def get_title_scale(self, cfg: dict) -> str:
        value = str(cfg.get("titleScale", "normal") or "normal").strip().lower()
        return value if value in {"normal", "large", "xlarge", "xxlarge", "xxxlarge"} else "normal"

    def get_header_scale(self, cfg: dict) -> str:
        value = str(cfg.get("headerScale", "normal") or "normal").strip().lower()
        return value if value in {"normal", "large", "xlarge", "xxlarge", "xxxlarge"} else "normal"

    def get_banner_scale(self, cfg: dict) -> str:
        value = str(cfg.get("bannerScale", "normal") or "normal").strip().lower()
        return value if value in {"normal", "large", "xlarge", "xxlarge", "xxxlarge"} else "normal"

    def get_modal_scale(self, cfg: dict) -> str:
        value = str(cfg.get("modalScale", "normal") or "normal").strip().lower()
        return value if value in {"normal", "large", "xlarge", "xxlarge", "xxxlarge"} else "normal"

    def _clean_guide_zoom(self, raw) -> int:
        value = to_int(raw, GUIDE_ZOOM_DEFAULT)
        value = int(round(value / GUIDE_ZOOM_STEP) * GUIDE_ZOOM_STEP)
        return max(GUIDE_ZOOM_MIN, min(GUIDE_ZOOM_MAX, value))

    def get_guide_zoom(self, cfg: dict) -> int:
        return self._clean_guide_zoom(cfg.get("guideZoom", GUIDE_ZOOM_DEFAULT))

    def get_guide_modal_zoom(self, cfg: dict) -> int:
        return self._clean_guide_zoom(cfg.get("guideModalZoom", GUIDE_MODAL_ZOOM_DEFAULT))

    def get_text_viewer_zoom(self, cfg: dict) -> int:
        return self._clean_guide_zoom(cfg.get("textViewerZoom", TEXT_VIEWER_ZOOM_DEFAULT))

    def get_keep_guides_offline(self, cfg: dict) -> bool:
        return bool(cfg.get("keepGuidesOffline", False))

    def get_pin_latest_guides(self, cfg: dict) -> bool:
        return bool(cfg.get("pinLatestGuides", False))

    def get_top_padding(self, cfg: dict) -> int:
        return 0

    def get_block_padding(self, cfg: dict) -> int:
        value = to_int(cfg.get("blockPadding", 8), 8)
        return value if value in {2, 4, 6, 8, 10, 12} else 8

    def get_button_spacing(self, cfg: dict) -> str:
        value = str(cfg.get("buttonSpacing", "verysmall") or "verysmall").strip().lower()
        legacy_map = {
            "default": "xlarge",
            "compact": "large",
            "tight": "medium",
        }
        value = legacy_map.get(value, value)
        return value if value in {"verysmall", "small", "medium", "large", "xlarge"} else "verysmall"

    def get_show_a_button_mode(self, cfg: dict) -> bool:
        return bool(cfg.get("showAButtonMode", True))

    def get_show_a_button_mode_tracked(self, cfg: dict) -> bool:
        return bool(cfg.get("showAButtonModeTracked", True))

    _GAME_NOTES_A_BUTTON_MODE_OPTIONS = ("editNote", "moveNote")

    def get_game_notes_a_button_mode(self, cfg: dict) -> str:
        value = str(cfg.get("gameNotesAButtonMode", "editNote") or "editNote").strip()
        if value not in self._GAME_NOTES_A_BUTTON_MODE_OPTIONS:
            return "editNote"
        return value

    def get_show_social_hub_button(self, cfg: dict) -> bool:
        return bool(cfg.get("showSocialHubButton", True))

    def get_show_tracked_sets_button(self, cfg: dict) -> bool:
        return bool(cfg.get("showTrackedSetsButton", True))

    def get_put_updater_on_desktop(self, cfg: dict) -> bool:
        return bool(cfg.get("putUpdaterOnDesktop", True))

    def get_show_options_button(self, cfg: dict) -> bool:
        return bool(cfg.get("showOptionsButton", False))

    def get_quick_menu_shortcuts(self, cfg: dict) -> list:
        raw = cfg.get("quickMenuShortcuts")
        if not isinstance(raw, list):
            return _default_quick_menu_shortcuts()

        stored = {str(entry or "").strip() for entry in raw}
        picked = [key for key in _ALLOWED_QUICK_MENU_SHORTCUTS if key in stored]

        return picked[:QUICK_MENU_SHORTCUT_LIMIT]

    def update_quick_menu_shortcuts(self, values) -> list:
        if not isinstance(values, list):
            values = []

        cfg = self._update_config("quickMenuShortcuts", values)

        return self.get_quick_menu_shortcuts(cfg)

    def _normalize_shortcut_bindings(self, raw) -> dict:
        source = raw if isinstance(raw, dict) else {}
        bindings = _default_shortcut_bindings()
        for button in _ALLOWED_SHORTCUT_BUTTONS:
            if button not in source:
                continue

            action = str(source.get(button) or "").strip()
            bindings[button] = action if action in _ALLOWED_SHORTCUT_ACTIONS else "none"

        return bindings

    def get_last_scale_preset(self, cfg: dict | None = None) -> str:
        source = self.load_config() if cfg is None else cfg
        value = str(source.get("lastScalePreset", "portable") or "portable").strip()
        if value not in _ALLOWED_SCALE_PRESETS:
            return "portable"

        return value

    def update_last_scale_preset(self, value: str) -> str:
        cfg = self._update_config("lastScalePreset", str(value or "portable").strip())

        return self.get_last_scale_preset(cfg)

    def get_shortcut_bindings(self, cfg: dict | None = None) -> dict:
        source = self.load_config() if cfg is None else cfg

        return self._normalize_shortcut_bindings(source.get("shortcutBindings"))

    def update_shortcut_binding(self, button: str, action: str) -> dict:
        key = str(button or "").strip()
        value = str(action or "").strip()
        if key not in _ALLOWED_SHORTCUT_BUTTONS or value not in _ALLOWED_SHORTCUT_ACTIONS:
            return self.get_shortcut_bindings()

        with self._config_lock:
            cfg = self.ensure_display_settings(self.load_config())
            bindings = self._normalize_shortcut_bindings(cfg.get("shortcutBindings"))
            bindings[key] = value
            cfg["shortcutBindings"] = bindings
            self.save_config(cfg)

            return bindings

    def get_show_all_toggle_main(self, cfg: dict) -> bool:
        return bool(cfg.get("showAllToggleMain", False))

    def get_show_all_toggle_friend(self, cfg: dict) -> bool:
        return bool(cfg.get("showAllToggleFriend", False))

    def get_show_tracked_notes_main(self, cfg: dict) -> bool:
        return bool(cfg.get("showTrackedNotesMain", False))

    def get_show_retro_points(self, cfg: dict) -> bool:
        return bool(cfg.get("showRetroPoints", False))

    def get_achievement_style(self, cfg: dict) -> str:
        value = str(cfg.get("achievementStyle", "left") or "left").strip().lower()
        return value if value in {"centered", "left"} else "left"

    def get_controller_glyph_style(self, cfg: dict) -> str:
        value = str(cfg.get("controllerGlyphStyle", "auto") or "auto").strip().lower()
        return value if value in {"auto", "universal", "deck", "steamcontroller", "xbox", "playstation", "nintendo"} else "auto"

    def get_tracked_color(self, cfg: dict) -> str:
        value = str(cfg.get("trackedColor", "default") or "default").strip().lower()
        allowed = {
            "default", "red", "orange", "amber", "green",
            "teal", "cyan", "purple", "pink", "white",
        }
        return value if value in allowed else "default"

    def get_main_achievement_filter(self, cfg: dict) -> str:
        value = str(cfg.get("mainAchievementFilter", "all") or "all").strip().lower()
        return value if value in {"all", "locked", "unlocked-hardcore", "unlocked-softcore", "missable"} else "all"

    def get_main_achievement_sort(self, cfg: dict) -> str:
        value = str(cfg.get("mainAchievementSort", "upNext") or "upNext").strip()
        return value if value in _ALLOWED_ACHIEVEMENT_SORTS else "upNext"

    def get_tracked_achievement_sort(self, cfg: dict) -> str:
        value = str(cfg.get("trackedAchievementSort", "upNext") or "upNext").strip()
        return value if value in _ALLOWED_TRACKED_SORTS else "upNext"

    def get_friend_achievement_filter(self, cfg: dict) -> str:
        value = str(cfg.get("friendAchievementFilter", "all") or "all").strip().lower()
        return value if value in {"all", "locked", "unlocked-hardcore", "unlocked-softcore", "missable"} else "all"

    def get_friend_achievement_sort(self, cfg: dict) -> str:
        value = str(cfg.get("friendAchievementSort", "upNext") or "upNext").strip()
        return value if value in _ALLOWED_ACHIEVEMENT_SORTS else "upNext"

    def get_friend_show_all_achievements(self, cfg: dict) -> bool:
        return bool(cfg.get("friendShowAllAchievements", True))

    def get_main_achievement_action(self, cfg: dict) -> str:
        value = str(cfg.get("mainAchievementAction", "track") or "track").strip().lower()
        return value if value in {"track", "info"} else "track"

    def get_tracked_achievement_action(self, cfg: dict) -> str:
        value = str(cfg.get("trackedAchievementAction", "editNote") or "editNote").strip()
        return value if value in {"untrack", "info", "editNote", "reorder"} else "editNote"

    def get_dolphin_mapper_mode(self, cfg: dict) -> str:
        value = str(cfg.get("dolphinMapperMode", "map") or "map").strip()
        return value if value in {"map", "edit", "delete", "reorder"} else "map"

    def get_file_watcher_speed(self, cfg: dict) -> str:
        value = str(cfg.get("fileWatcherSpeed", "gentle") or "gentle").strip()
        return value if value in {"full", "balanced", "gentle"} else "gentle"

    def get_dolphin_system_filter(self, cfg: dict) -> str:
        value = str(cfg.get("dolphinSystemFilter", "all") or "all").strip()
        return value if value in {"all", "wii", "gamecube"} else "all"

    def get_cheevo_check_cache_hashes(self, cfg: dict) -> bool:
        return bool(cfg.get("cheevoCheckCacheHashes", True))

    def get_cheevo_check_extract_to_ram(self, cfg: dict) -> bool:
        return bool(cfg.get("cheevoCheckExtractToRam", False))

    def get_cheevo_check_verify_hashes(self, cfg: dict) -> bool:
        return bool(cfg.get("cheevoCheckVerifyHashes", False))

    def get_cheevo_check_scan_collapsed(self, cfg: dict) -> bool:
        return bool(cfg.get("cheevoCheckScanCollapsed", False))

    def get_cheevo_check_results_collapsed(self, cfg: dict) -> bool:
        return bool(cfg.get("cheevoCheckResultsCollapsed", False))

    def get_cheevo_check_verify_collapsed(self, cfg: dict) -> bool:
        return bool(cfg.get("cheevoCheckVerifyCollapsed", False))

    def get_cheevo_check_options_collapsed(self, cfg: dict) -> bool:
        return bool(cfg.get("cheevoCheckOptionsCollapsed", False))

    def get_cheevo_check_skip_disc_verify(self, cfg: dict) -> bool:
        return bool(cfg.get("cheevoCheckSkipDiscVerify", False))

    def get_cheevo_check_skip_cart_verify(self, cfg: dict) -> bool:
        return bool(cfg.get("cheevoCheckSkipCartVerify", False))

    def get_library_badge(self, cfg: dict) -> bool:
        return bool(cfg.get("libraryBadge", False))

    def get_cheevo_check_verify_speed(self, cfg: dict) -> str:
        value = str(cfg.get("cheevoCheckVerifySpeed", "full") or "full").strip()
        return value if value in {"full", "balanced", "gentle"} else "full"

    def get_dolphin_bluetooth_passthrough(self, cfg: dict) -> bool:
        return bool(cfg.get("dolphinBluetoothPassthrough", False))

    def get_dolphin_continuous_scanning(self, cfg: dict) -> bool:
        return bool(cfg.get("dolphinContinuousScanning", False))

    def get_dolphin_balance_board(self, cfg: dict) -> bool:
        return bool(cfg.get("dolphinBalanceBoard", False))

    def get_tracked_set_a_button_mode(self, cfg: dict) -> str:
        value = str(cfg.get("trackedSetAButtonMode", "editNote") or "editNote").strip()
        return value if value in {"info", "editNote", "reorder"} else "editNote"

    def get_language(self, cfg: dict) -> str:
        return str(cfg.get("language", self._default_language) or self._default_language).strip().lower()

    def get_friend_refresh_delay_ms(self, cfg: dict) -> int:
        value = to_int(cfg.get("friendRefreshDelayMs", 1000), 1000)
        return value if value in {500, 750, 1000, 1500, 2000, 3000, 4000, 5000} else 1000

    def get_activity_cache_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("activityCacheMinutes", 5), 5)
        return value if value in ACTIVITY_CACHE_MINUTE_OPTIONS else 5

    def get_trickle_lookback_hours(self, cfg: dict) -> int:
        value = to_int(cfg.get("trickleLookbackHours", 3), 3)
        return value if value in TRICKLE_LOOKBACK_HOUR_OPTIONS else 3

    def get_activity_friends_per_tick(self, cfg: dict) -> int:
        value = to_int(cfg.get("activityFriendsPerTick", 3), 3)
        return value if value in ACTIVITY_FRIENDS_PER_TICK_OPTIONS else 3

    def get_social_game_ticker(self, cfg: dict) -> bool:
        return bool(cfg.get("socialGameTicker", True))

    def get_social_hub_ticker(self, cfg: dict) -> bool:
        return bool(cfg.get("socialHubTicker", True))

    def get_social_activity_trickle_service(self, cfg: dict) -> bool:
        return bool(cfg.get("socialActivityTrickleService", True))

    def get_trickle_favorites_only(self, cfg: dict) -> bool:
        return bool(cfg.get("trickleFavoritesOnly", False))

    def get_friend_auto_refresh(self, cfg: dict) -> bool:
        return bool(cfg.get("friendAutoRefresh", True))

    def get_show_reminder_ticker(self, cfg: dict) -> bool:
        return bool(cfg.get("showReminderTicker", False))

    def get_show_notes_dot(self, cfg: dict) -> bool:
        return bool(cfg.get("showNotesDot", False))

    def get_show_bell_dot(self, cfg: dict) -> bool:
        return bool(cfg.get("showBellDot", True))

    def get_do_not_disturb(self, cfg: dict) -> bool:
        return bool(cfg.get("doNotDisturb", False))

    def get_do_not_disturb_disables_dot(self, cfg: dict) -> bool:
        return bool(cfg.get("doNotDisturbDisablesDot", True))

    def get_do_not_disturb_disables_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("doNotDisturbDisablesToast", True))

    def get_night_mode(self, cfg: dict) -> bool:
        return bool(cfg.get("nightMode", False))

    def get_night_mode_brightness(self, cfg: dict) -> float:
        value = to_float(cfg.get("nightModeBrightness", 0.75), 0.75)
        return value if value in NIGHT_MODE_BRIGHTNESS_OPTIONS else 0.75

    def get_battery_saver(self, cfg: dict) -> bool:
        return bool(cfg.get("batterySaver", False))

    def get_battery_saver_disables_social_activity(self, cfg: dict) -> bool:
        return bool(cfg.get("batterySaverDisablesSocialActivity", True))

    def get_battery_saver_disables_comments(self, cfg: dict) -> bool:
        return bool(cfg.get("batterySaverDisablesComments", True))

    def get_battery_saver_disables_friend_avatars(self, cfg: dict) -> bool:
        return bool(cfg.get("batterySaverDisablesFriendAvatars", True))

    def get_battery_saver_disables_players_near_you(self, cfg: dict) -> bool:
        return bool(cfg.get("batterySaverDisablesPlayersNearYou", True))

    def get_battery_saver_disables_tracked_sets(self, cfg: dict) -> bool:
        return bool(cfg.get("batterySaverDisablesTrackedSets", True))

    def get_battery_saver_disables_file_watcher(self, cfg: dict) -> bool:
        return bool(cfg.get("batterySaverDisablesFileWatcher", True))

    def get_file_watcher_run_during_games(self, cfg: dict) -> bool:
        return bool(cfg.get("fileWatcherRunDuringGames", True))

    def get_notify_note_reminder_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyNoteReminderEnabled", True))

    def get_notify_note_reminder_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyNoteReminderToast", True))

    def get_notify_tracked_set_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyTrackedSetEnabled", True))

    def get_notify_tracked_set_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyTrackedSetToast", True))

    def get_notify_comment_tracker_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyCommentTrackerEnabled", True))

    def get_notify_comment_tracker_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyCommentTrackerToast", True))

    def get_notify_wall_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyWallEnabled", True))

    def get_notify_wall_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyWallToast", True))

    def get_notify_system_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("notifySystemEnabled", True))

    def get_notify_system_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("notifySystemToast", True))

    def get_notify_tracked_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyTrackedEnabled", False))

    def get_notify_tracked_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyTrackedToast", False))

    def get_notify_social_unlock_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("notifySocialUnlockEnabled", False))

    def get_notify_social_unlock_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("notifySocialUnlockToast", False))

    def get_notify_near_you_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyNearYouEnabled", False))

    def get_notify_near_you_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyNearYouToast", False))

    def get_notify_debug_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyDebugEnabled", False))

    def get_notify_debug_toast(self, cfg: dict) -> bool:
        return bool(cfg.get("notifyDebugToast", False))

    def get_legacy_achievement_links(self, cfg: dict) -> bool:
        return bool(cfg.get("legacyAchievementLinks", False))

    def get_legacy_game_links(self, cfg: dict) -> bool:
        return bool(cfg.get("legacyGameLinks", False))

    def get_show_developer_options(self, cfg: dict) -> bool:
        return bool(cfg.get("showDeveloperOptions", False))

    def get_auto_purge_service(self, cfg: dict) -> bool:
        return bool(cfg.get("autoPurgeService", True))

    def get_debug_logging(self, cfg: dict) -> bool:
        return bool(cfg.get("debugLogging", False))

    def get_inject_emulator_login(self, cfg: dict) -> bool:
        return bool(cfg.get("injectEmulatorLogin", False))

    def get_ipc_slow_threshold_ms(self, cfg: dict) -> int:
        value = to_int(cfg.get("ipcSlowThresholdMs", 250), 250)
        return value if value in IPC_SLOW_THRESHOLD_MS_OPTIONS else 250

    def get_large_viewport_bonus_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("largeViewportBonusEnabled", True))

    def get_large_viewport_bonus(self, cfg: dict) -> int:
        value = to_int(cfg.get("largeViewportBonus", 8), 8)
        return value if value in LARGE_VIEWPORT_BONUS_OPTIONS else 8

    def get_parallel_ra_calls(self, cfg: dict) -> int:
        value = to_int(cfg.get("parallelRaCalls", 4), 4)
        return value if value in PARALLEL_RA_CALLS_OPTIONS else 4

    def get_parallel_cdn_fetches(self, cfg: dict) -> int:
        value = to_int(cfg.get("parallelCdnFetches", 5), 5)
        return value if value in PARALLEL_CDN_FETCHES_OPTIONS else 5

    def get_max_icon_workers(self, cfg: dict) -> int:
        value = to_int(cfg.get("maxIconWorkers", 6), 6)
        return value if value in MAX_ICON_WORKERS_OPTIONS else 6

    def get_avatar_workers(self, cfg: dict) -> int:
        value = to_int(cfg.get("avatarWorkers", 4), 4)
        return value if value in AVATAR_WORKERS_OPTIONS else 4

    def get_game_icon_workers(self, cfg: dict) -> int:
        value = to_int(cfg.get("gameIconWorkers", 6), 6)
        return value if value in GAME_ICON_WORKERS_OPTIONS else 6

    def get_game_art_cache_cap(self, cfg: dict) -> int:
        value = to_int(cfg.get("gameArtCacheCap", 1024), 1024)
        return value if value in GAME_ART_CACHE_CAP_OPTIONS else 1024

    def get_avatar_cache_cap(self, cfg: dict) -> int:
        value = to_int(cfg.get("avatarCacheCap", 1024), 1024)
        return value if value in AVATAR_CACHE_CAP_OPTIONS else 1024

    def get_achievement_icon_cache_games(self, cfg: dict) -> int:
        value = to_int(cfg.get("achievementIconCacheGames", 8), 8)
        return value if value in ACHIEVEMENT_ICON_CACHE_GAMES_OPTIONS else 8

    def get_friend_image_service(self, cfg: dict) -> bool:
        return bool(cfg.get("friendImageService", True))

    def get_validate_friends_roster(self, cfg: dict) -> bool:
        return bool(cfg.get("validateFriendsRoster", True))

    def get_fis_tick_frequency_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("fisTickFrequencyMinutes", 5), 5)
        return value if value in FIS_TICK_FREQUENCY_MINUTES_OPTIONS else 5

    def get_comments_service_tick_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("commentsServiceTickMinutes", 5), 5)
        return value if value in COMMENTS_SERVICE_TICK_MINUTES_OPTIONS else 5

    def get_comments_service_fetch_amount(self, cfg: dict) -> int:
        value = to_int(cfg.get("commentsServiceFetchAmount", 20), 20)
        return value if value in COMMENTS_SERVICE_FETCH_AMOUNT_OPTIONS else 20

    def get_comments_service_wall_check(self, cfg: dict) -> bool:
        return bool(cfg.get("commentsServiceWallCheck", True))

    def get_fis_roster_refresh_interval_hours(self, cfg: dict) -> int:
        value = to_int(cfg.get("fisRosterRefreshIntervalHours", 6), 6)
        return value if value in FIS_ROSTER_REFRESH_INTERVAL_HOURS_OPTIONS else 6

    def get_fis_verify_favorite_avatars(self, cfg: dict) -> bool:
        return bool(cfg.get("fisVerifyFavoriteAvatars", True))

    def get_fis_verify_all_avatars(self, cfg: dict) -> bool:
        return bool(cfg.get("fisVerifyAllAvatars", False))

    def get_players_near_you_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("playersNearYouEnabled", True))

    def get_players_near_you_lookbehind(self, cfg: dict) -> int:
        value = to_int(cfg.get("playersNearYouLookbehind", 2), 2)
        return value if value in PLAYERS_NEAR_YOU_LOOKBEHIND_OPTIONS else 2

    def get_players_near_you_lookahead(self, cfg: dict) -> int:
        value = to_int(cfg.get("playersNearYouLookahead", 6), 6)
        return value if value in PLAYERS_NEAR_YOU_LOOKAHEAD_OPTIONS else 6

    def get_players_near_you_min_tick_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("playersNearYouMinTickMinutes", 5), 5)
        return value if value in PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS else 5

    def get_players_near_you_max_tick_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("playersNearYouMaxTickMinutes", 15), 15)
        return value if value in PLAYERS_NEAR_YOU_TICK_MINUTES_OPTIONS else 15

    def get_games_list_cache_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("gamesListCacheMinutes", 20), 20)
        return value if value in GAMES_LIST_CACHE_MINUTE_VALUES else 20

    def get_awards_list_cache_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("awardsListCacheMinutes", 15), 15)
        return value if value in GAMES_LIST_CACHE_MINUTE_VALUES else 15

    def get_want_to_play_cache_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("wantToPlayCacheMinutes", 20), 20)
        return value if value in GAMES_LIST_CACHE_MINUTE_VALUES else 20

    def get_players_near_you_tap_mode(self, cfg: dict) -> str:
        value = str(cfg.get("playersNearYouTapMode", "profile") or "profile").strip().lower()
        return value if value in {"profile", "achievement", "game"} else "profile"

    def get_players_near_you_collapsed(self, cfg: dict) -> bool:
        return bool(cfg.get("playersNearYouCollapsed", False))

    def get_dolphin_advanced_collapsed(self, cfg: dict) -> bool:
        return bool(cfg.get("dolphinAdvancedCollapsed", True))

    def get_dolphin_mappings_seeded(self, cfg: dict) -> bool:
        return bool(cfg.get("dolphinMappingsSeeded", False))

    def get_big_list_threshold(self, cfg: dict) -> int:
        value = to_int(cfg.get("bigListThreshold", BIG_LIST_THRESHOLD_DISABLED), BIG_LIST_THRESHOLD_DISABLED)
        if value in BIG_LIST_THRESHOLD_OPTIONS:
            return value
        return BIG_LIST_THRESHOLD_DISABLED

    def get_always_stagger_mounting(self, cfg: dict) -> bool:
        return bool(cfg.get("alwaysStaggerMounting", False))

    def get_return_stagger_frames(self, cfg: dict) -> int:
        value = to_int(cfg.get("returnStaggerFrames", 0), 0)
        if value in RETURN_STAGGER_FRAME_OPTIONS:
            return value
        return 0

    def get_dynamic_loading(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicLoading", True))

    def get_dynamic_initial_rows(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicInitialRows", 30), 30)
        if value in DYNAMIC_INITIAL_ROW_OPTIONS:
            return value
        return 30

    def get_dynamic_row_step(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicRowStep", 30), 30)
        if value in DYNAMIC_ROW_STEP_OPTIONS:
            return value
        return 30

    def get_dynamic_prefetch_distance(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicPrefetchDistance", 12), 12)
        if value in DYNAMIC_PREFETCH_DISTANCE_OPTIONS:
            return value
        return 12

    def get_dynamic_sentinel_root_margin(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicSentinelRootMargin", 600), 600)
        if value in DYNAMIC_SENTINEL_MARGIN_OPTIONS:
            return value
        return 600

    def get_dynamic_tracked_list_loading(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicTrackedListLoading", True))

    def get_dynamic_tracked_list_initial_rows(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicTrackedListInitialRows", 10), 10)
        if value in DYNAMIC_INITIAL_ROW_OPTIONS:
            return value
        return 10

    def get_dynamic_tracked_list_row_step(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicTrackedListRowStep", 10), 10)
        if value in DYNAMIC_ROW_STEP_OPTIONS:
            return value
        return 10

    def get_dynamic_tracked_list_prefetch_distance(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicTrackedListPrefetchDistance", 12), 12)
        if value in DYNAMIC_PREFETCH_DISTANCE_OPTIONS:
            return value
        return 12

    def get_dynamic_tracked_list_sentinel_root_margin(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicTrackedListSentinelRootMargin", 600), 600)
        if value in DYNAMIC_SENTINEL_MARGIN_OPTIONS:
            return value
        return 600

    def get_dynamic_tracked_sets_list_loading(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicTrackedSetsListLoading", True))

    def get_dynamic_tracked_sets_list_initial_rows(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicTrackedSetsListInitialRows", 10), 10)
        if value in DYNAMIC_INITIAL_ROW_OPTIONS:
            return value
        return 10

    def get_dynamic_tracked_sets_list_row_step(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicTrackedSetsListRowStep", 10), 10)
        if value in DYNAMIC_ROW_STEP_OPTIONS:
            return value
        return 10

    def get_dynamic_tracked_sets_list_prefetch_distance(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicTrackedSetsListPrefetchDistance", 12), 12)
        if value in DYNAMIC_PREFETCH_DISTANCE_OPTIONS:
            return value
        return 12

    def get_dynamic_tracked_sets_list_sentinel_root_margin(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicTrackedSetsListSentinelRootMargin", 600), 600)
        if value in DYNAMIC_SENTINEL_MARGIN_OPTIONS:
            return value
        return 600

    def get_dynamic_game_notes_loading(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicGameNotesLoading", True))

    def get_dynamic_game_notes_initial_rows(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicGameNotesInitialRows", 10), 10)
        if value in DYNAMIC_INITIAL_ROW_OPTIONS:
            return value
        return 10

    def get_dynamic_game_notes_row_step(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicGameNotesRowStep", 10), 10)
        if value in DYNAMIC_ROW_STEP_OPTIONS:
            return value
        return 10

    def get_dynamic_game_notes_prefetch_distance(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicGameNotesPrefetchDistance", 12), 12)
        if value in DYNAMIC_PREFETCH_DISTANCE_OPTIONS:
            return value
        return 12

    def get_dynamic_game_notes_sentinel_root_margin(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicGameNotesSentinelRootMargin", 600), 600)
        if value in DYNAMIC_SENTINEL_MARGIN_OPTIONS:
            return value
        return 600

    def get_dynamic_comments(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicComments", True))

    def get_tracked_sets_auto_check(self, cfg: dict) -> bool:
        return bool(cfg.get("trackedSetsAutoCheck", True))

    def get_tracked_sets_service_enabled(self, cfg: dict) -> bool:
        return bool(cfg.get("trackedSetsServiceEnabled", True))

    def get_tracked_sets_refresh_minutes(self, cfg: dict) -> int:
        value = to_int(cfg.get("trackedSetsRefreshMinutes", 15), 15)
        return value if value in TRACKED_SETS_REFRESH_MINUTES_OPTIONS else 15

    def get_tracked_sets_selector_sort(self, cfg: dict) -> str:
        value = str(cfg.get("trackedSetsSelectorSort", "alphabetical") or "alphabetical").strip()
        allowed = {
            "alphabetical",
            "recent",
            "oldest",
            "completionDesc",
            "completionAsc",
            "gameCountDesc",
            "gameCountAsc",
        }
        return value if value in allowed else "alphabetical"

    def get_tracked_sets_selector_filter(self, cfg: dict) -> str:
        value = str(cfg.get("trackedSetsSelectorFilter", "all") or "all").strip()
        return value if value in {"all", "completed", "incomplete"} else "all"

    def get_dynamic_comments_initial_rows(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicCommentsInitialRows", 10), 10)
        if value in DYNAMIC_INITIAL_ROW_OPTIONS:
            return value
        return 10

    def get_dynamic_comments_row_step(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicCommentsRowStep", 10), 10)
        if value in DYNAMIC_ROW_STEP_OPTIONS:
            return value
        return 10

    def get_dynamic_comments_sentinel_root_margin(self, cfg: dict) -> int:
        value = to_int(cfg.get("dynamicCommentsSentinelRootMargin", 600), 600)
        if value in DYNAMIC_SENTINEL_MARGIN_OPTIONS:
            return value
        return 600

    def get_dynamic_friend_loading(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicFriendLoading", True))

    def get_dynamic_leaderboard_loading(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicLeaderboardLoading", True))

    def get_dynamic_leaderboard_results(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicLeaderboardResults", True))

    def get_dynamic_activity_feed(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicActivityFeed", True))

    def get_dynamic_compare(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicCompare", True))

    def get_dynamic_friend_picker(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicFriendPicker", True))

    def get_dynamic_all_games(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicAllGames", True))

    def get_dynamic_tracked_games(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicTrackedGames", True))

    def get_dynamic_badges(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicBadges", True))

    def get_dynamic_followed_ranking(self, cfg: dict) -> bool:
        return bool(cfg.get("dynamicFollowedRanking", True))

    def ensure_display_settings(self, cfg: dict) -> dict:
        for knob in _KNOBS:
            rule = knob.normalize
            if rule is False:
                continue

            if rule is PIN_DEFAULT:
                cfg[knob.key] = self._knob_default(knob)
            elif rule is IF_ABSENT:
                if knob.key not in cfg:
                    cfg[knob.key] = self._knob_default(knob)
            elif rule is True:
                cfg[knob.key] = self._read_knob(cfg, knob)
            else:
                cfg[knob.key] = self._read_knob(cfg, knob, rule)

        return cfg
