import type { LanguageCode } from "./locales";

type RaPayloadResponse<T> = {
    needsSettings?: boolean;
    error?: string;
    payload?: T | null;
    changed: boolean;
};

export type OkResult = {
    ok: boolean;
    error?: string;
};

export type ScaleStep = "normal" | "large" | "xlarge" | "xxlarge" | "xxxlarge";
export type UiSize = ScaleStep;
export type ButtonSpacing = "verysmall" | "small" | "medium" | "large" | "xlarge";

export type MainAchievementAction = "track" | "info";
export type TrackedAchievementAction = "untrack" | "info" | "editNote" | "reorder";

export type DolphinSystem = "gamecube" | "wii";
export type DolphinSystemFilter = "all" | "wii" | "gamecube";
export type WiiStyle = "wiimote_sideways" | "wiimote_nunchuk" | "classic";
export type ControllerType = "steamdeck" | "rogally" | "steamcontroller" | "xbox" | "xboxone" | "xbox360" | "dualsense" | "ps4" | "switchpro" | "realwiimote";
export type FaceLayout = "standard" | "literal" | "swap_ab" | "swap_xy";
export type RumbleMotor = "both" | "left" | "right";

export type SidewaysDirections = "both" | "dpad" | "stick";

export type DolphinMapperMode = "map" | "edit" | "delete" | "reorder";

export type MappingPlayer = {
    controllerType: ControllerType;
    wireless: boolean;
    invertCamX?: boolean;
    invertCamY?: boolean;
    faceLayout?: FaceLayout;
    triggerSwap?: boolean;
    rumbleStrength?: number;
    rumbleMotor?: RumbleMotor;
    leftStickDeadzone?: number;
    rightStickDeadzone?: number;
    sidewaysDirections?: SidewaysDirections;
    irDeadzone?: number;
    irTotalYaw?: number;
    irTotalPitch?: number;
    irVerticalOffset?: number;
    irRelativeInput?: boolean;
    irAutoHide?: boolean;
};

export type DolphinMapping = {
    id: string;
    name: string;
    body: string;
    system: DolphinSystem;
    wiiStyle?: WiiStyle;
    players: MappingPlayer[];
    createdAt: number;
    updatedAt: number;
};

export type SmbVersion = "auto" | "3.1.1" | "3.0" | "2.1" | "2.0" | "1.0";

export type SmbShareStatus = "mounted" | "idle" | "disabled" | "unreachable" | "error";

export type SmbShare = {
    id: string;
    slug: string;
    name: string;
    server: string;
    share: string;
    username: string;
    hasPassword: boolean;
    domain: string;
    vers: SmbVersion;
    softMount: boolean;
    createdAt: number;
    mountPath: string;
    status: SmbShareStatus;
    statusError?: string | null;
};

export type SmbSharePayload = {
    name?: string;
    server: string;
    share: string;
    username?: string;
    password?: string;
    clearPassword?: boolean;
    domain?: string;
    vers?: SmbVersion;
    softMount?: boolean;
};

type CheevoCheckFailReason = "unreadable" | "ambiguous" | "no_space" | "archive";

export type CheevoCheckRow = {
    system: string;
    systemId: number;
    file: string;
    path: string;
    gameId?: number;
    title?: string;
    imageIcon?: string;
    reason?: CheevoCheckFailReason;
    raHash?: string;
    innerName?: string;
};

export type CheevoCheckGame = {
    system: string;
    systemId: number;
    gameId: number;
    title: string;
    achievements: number;
    imageIcon?: string;
    files?: CheevoCheckRow[];
};

export type CheevoCheckListKind =
    | "supported"
    | "noAchievements"
    | "unsupported"
    | "failed"
    | "archiveMismatch"
    | CheevoCheckVerifyBucket;

export type CheevoCheckVerifyBucket =
    | "verified"
    | "raFull"
    | "raPartial"
    | "mismatch"
    | "unrecognised"
    | "unverifiable";

type CheevoCheckVerifyReason =
    | "read_failed"
    | "chd_extract_failed"
    | "chd_no_match"
    | "trimmed"
    | "no_reference"
    | "no_single_rom"
    | "no_space"
    | "no_tool"
    | "signature"
    | "discs_off"
    | "carts_off"
    | "rebuilt";

export type CheevoCheckVerifySpeed = "full" | "balanced" | "gentle";

export type CheevoCheckVerifyRow = {
    system: string;
    systemId: number;
    file: string;
    path: string;
    size: number;
    bucket: CheevoCheckVerifyBucket;
    crc?: string;
    datCrc?: string;
    matchedName?: string;
    trackOnly?: boolean;
    reason?: CheevoCheckVerifyReason;
    trimmed?: boolean;
    headerDiff?: boolean;
    raRecognised?: boolean;
    problems?: string[];
    selfCheck?: "passed" | "failed";
    selfCheckCount?: number;
};

export type CheevoCheckVerifyResults = {
    verifiedAt: number;
    scanned: number;
    verified: CheevoCheckVerifyRow[];
    raFull: CheevoCheckVerifyRow[];
    raPartial: CheevoCheckVerifyRow[];
    mismatch: CheevoCheckVerifyRow[];
    unrecognised: CheevoCheckVerifyRow[];
    unverifiable: CheevoCheckVerifyRow[];
};

export type CheevoCheckBrowseRow = {
    key: string;
    system: string;
    systemId: number;
    title: string;
    detail: string;
    note: string;
    gameId: number;
    imageIcon: string;
    searchTitle: string;
    extra?: string[];
};

export type CheevoCheckResults = {
    root: string;
    offline: boolean;
    completedAt: number;
    dataBuiltAt: number;
    missingConsoles: string[];
    scanned: number;
    supported: number;
    supportedGames: CheevoCheckGame[];
    skippedDolphin: number;
    unsupported: CheevoCheckRow[];
    noAchievements: CheevoCheckRow[];
    failed: CheevoCheckRow[];
};

export type CheevoCheckScanProgress = {
    phase: "walk" | "fetch" | "hash" | "verify";
    done: number;
    total: number;
};

export type CheevoCheckState = {
    running: boolean;
    error: string | null;
    progress: CheevoCheckScanProgress | null;
    results: CheevoCheckResults | null;
    verifyResults: CheevoCheckVerifyResults | null;
    dataAvailable: boolean;
    dataBuiltAt: number;
    hasLocalHashCache: boolean;
    startDir: string;
};

export type FileWatcherSpeed = "full" | "balanced" | "gentle";

export type FileWatcherRoot = {
    id: number;
    path: string;
    label: string;
    excludes: string[];
    addedAt: number;
};

export type FileWatcherSchedule = {
    enabled: boolean;
    everyWeeks: number;
    weekday: number;
    hour: number;
    minute: number;
    anchorAt: number;
};

export type FileWatcherWindow = {
    enabled: boolean;
    blockFrom: [number, number];
    blockTo: [number, number];
};

export type FileWatcherFindingBucket =
    | "corrupted"
    | "unreadable"
    | "replaced"
    | "missing"
    | "added"
    | "verified"
    | "skipped";

export type FileWatcherBucket = FileWatcherFindingBucket | "excluded";

export type FileWatcherFinding = {
    rootId: number;
    relPath: string;
    bucket: FileWatcherBucket;
    oldSha: string | null;
    newSha: string | null;
    oldSize: number | null;
    newSize: number | null;
    oldMtimeNs: number | null;
    newMtimeNs: number | null;
};

export type FileWatcherExcludedRow = {
    rootId: number;
    relPath: string;
    isDir: boolean;
    rule: string;
};

export type FileWatcherListRow = FileWatcherFinding | FileWatcherExcludedRow;

export type FileWatcherSkippedRoot = {
    rootId: number;
    reason: string;
    fileCount: number;
    lastOkAt: number;
};

type FileWatcherWaitReason = "window" | "game" | "batterySaver" | "startup";

export type FileWatcherPass = {
    active: boolean;
    waitingFor: FileWatcherWaitReason | null;
    origin: "manual" | "schedule";
    phase: "enumerate" | "hash";
    doneFiles: number;
    totalFiles: number;
    doneBytes: number;
    totalBytes: number;
    currentRoot: string;
    etaSeconds: number | null;
};

type FileWatcherRootStats = Record<string, { files: number; lastVerified: number }>;

export type FileWatcherState = {
    roots: FileWatcherRoot[];
    schedule: FileWatcherSchedule;
    window: FileWatcherWindow;
    lastCompletedAt: number;
    nextDueAt: number;
    counts: Record<FileWatcherFindingBucket, number>;
    hasReport: boolean;
    skipped: FileWatcherSkippedRoot[];
    rootStats: FileWatcherRootStats;
    excludedTotal: number;
    startDir: string;
    pass: FileWatcherPass | null;
};

export type DolphinMappingInput = {
    id?: string;
    name: string;
    body: string;
    system: DolphinSystem;
    wiiStyle?: WiiStyle;
    players: MappingPlayer[];
};

export type LoadDolphinMappingsResponse = {
    schemaVersion: number;
    mappings: DolphinMapping[];
    collapsedTags: string[];
};
export type DolphinMappingResponse = {
    ok: boolean;
    error?: string;
    mapping?: DolphinMapping;
};
export type ReorderDolphinMappingsResponse = {
    ok: boolean;
    error?: string;
    mappings?: DolphinMapping[];
};
export type ApplyDolphinMappingResponse = {
    ok: boolean;
    error?: string;
    file?: string;
    targets?: { name: string; dir: string; file: string }[];
};

export type DeckControllerStatus = {
    present: boolean;
    disabled: boolean;
};
export type SetDeckControllerResponse = {
    ok: boolean;
    error?: string;
    detail?: string;
    status: DeckControllerStatus;
};

export type PlayersNearYouTapMode = "profile" | "achievement" | "game";

export type PlayersNearYouMode = "classic" | "enhanced" | "recent" | "off";

export type TrackedSetAButtonMode = "info" | "editNote" | "reorder";

export type ReorderDirection = "up" | "down" | "top" | "bottom";
export type MainAchievementFilter = "all" | "locked" | "unlocked-hardcore" | "unlocked-softcore" | "missable";
export type AchievementSort =
    | "upNext"
    | "absolute"
    | "mostPoints"
    | "fewestPoints"
    | "rarest"
    | "mostCommon";

export type TrackedAchievementSort =
    | "upNext"
    | "manual"
    | "mostPoints"
    | "fewestPoints"
    | "rarest"
    | "mostCommon";

export type FollowedRankingMetric = "hardcorePoints" | "softcorePoints" | "retroPoints" | "retroRatio";

export type ViewKey =
    | "achievements"
    | "tracked"
    | "social"
    | "friendGame"
    | "friendAllGames"
    | "friendCompare"
    | "leaderboards"
    | "leaderboardDetail"
    | "unlockHistory"
    | "badges"
    | "about"
    | "options"
    | "comparePicker"
    | "gameNotes"
    | "gameOverview"
    | "achievementOverview"
    | "wantToPlay"
    | "followedRanking"
    | "trackedSets"
    | "trackedSetOpen"
    | "utils"
    | "dolphinMapper"
    | "smbShares"
    | "cheevoCheck"
    | "fileWatcher"
    | "guides";
export type GuidesSubView = "list" | "reader" | "search";
export type GuideKind = "formatted" | "plaintext";

export type GuidesMapping = {
    platformSlug: string;
    gameUrl: string;
    productName: string;
};

export type GuideBookmark = {
    id: string;
    name: string;
    page: number;
    anchor: string;
    scroll: number;
    createdAt: number;
};

export type GuideUserData = {
    title: string;
    author: string;
    type: string;
    version: string;
    gameUrl: string;
    lastOpenedAt: number;
    lastPage: number;
    lastAnchor: string;
    lastScroll: number;
    pageCount: number;
    kind: GuideKind;
    updatedAt: number;
    bookmarks: GuideBookmark[];
};

export type GameGuidesRecord = {
    gameId: number;
    schemaVersion: number;
    gamefaqs: GuidesMapping | null;
    guides: Record<string, GuideUserData>;
    typeFilter: string;
};

export type AchievementListMode = "main" | "friend" | "tracked" | "overview";
export type FriendAchievementFilter = "all" | "locked" | "unlocked-hardcore" | "unlocked-softcore" | "missable";
export type FriendGameSource = "recentGames" | "allGames";
export type FriendGameSelectionMode = "auto" | "explicit";
export type NowPlayingCompareFilter = "all" | "onlyYou" | "onlyThem" | "shared";
export type NowPlayingSubView = "activity" | "comments" | "compare";

export type NowPlayingProps = {
    currentPayload: Payload | null;
    showIcons: boolean;
    blockPadding: number;
    compareFriendUsername: string | null;
    compareFriendRow: FriendRow | null;
    compareFilter: NowPlayingCompareFilter;
    compareLoading: boolean;
    compareError: string | null;
    comparePayload: FriendGamePayload | null;
    subView: NowPlayingSubView;
    onOpenComparePicker: () => void;
    onChangeCompareFilter: (filter: NowPlayingCompareFilter) => void;
    onAchievementClick?: (achievement: AchievementRow) => void | Promise<void>;
    onActivityClick?: (event: SocialActivityEvent) => void | Promise<void>;
    onRetryCompareData: () => void;
    comments: GameComment[];
    commentsLoading: boolean;
    commentsLoadingMore: boolean;
    commentsError: string | null;
    commentsHasMore: boolean;
    commentsSort: "newest" | "oldest";
    commentsNeedsSettings: boolean;
    commentsLoaded: boolean;
    onChangeCommentsSort: (sort: "newest" | "oldest") => void;
    onLoadMoreComments: () => void | Promise<void>;
    onCommentClick: (comment: AotwComment | GameComment) => void | Promise<void>;
    onPostComment: () => void | Promise<void>;
    showRetroPoints: boolean;
};

export type NewsEventsSubView = "news" | "aotw" | "newSets";
export type NewSetsFilter = "new" | "revision";
export type AotwSubView = "unlocks" | "comments";
export type GameOverviewSubView = "achievements" | "comments" | "hashes";
export type FriendProfileSubView = "game" | "wall";
export type MainAchievementsTab = "achievements" | "activity" | "comments" | "compare";
export type GameOverviewSource = "newsEvents" | "main" | "socialActivity" | "mainNowPlaying" | "friend" | "badges" | "wantToPlay" | "trackedSet" | "subscribedDiscussions" | "search" | "cheevoCheck";

export type AOSource =
    | "main"
    | "tracked"
    | "gameOverview"
    | "newsEvents"
    | "socialActivity"
    | "mainNowPlaying"
    | "friend"
    | "unlockHistory"
    | "notification"
    | "subscribedDiscussions"
    | "external";

export type AchievementOverviewSnapshot = {
    id: number;
    title: string;
    description: string;
    points: number;
    badgeName: string;
    imageIcon: string | null;
    isLocked: boolean;
    dateEarned: string | null;
    dateEarnedHardcore?: string | null;
};
export type AchievementStyle = "centered" | "left";

export type ControllerGlyphStyle = "auto" | "deck" | "steamcontroller" | "xbox" | "playstation" | "nintendo" | "universal";

export type BadgeFilter = "all" | "mastered" | "beaten" | "event" | "other";

export type AllGamesLetterRangeKey = "numbers" | "a-f" | "g-l" | "m-r" | "s-u" | "v-z";

export type AllGamesStatusFilter =
    | "all"
    | "mastered"
    | "completed"
    | "beaten-hardcore"
    | "beaten-softcore"
    | "unfinished";

export type TrackedSetFilter = "all" | "completed" | "incomplete";

export type LeaderboardAudience = "all" | "friends";

export type TrackedColor =
    | "default"
    | "red"
    | "orange"
    | "amber"
    | "green"
    | "teal"
    | "cyan"
    | "purple"
    | "pink"
    | "white";

export type SocialView = "friends" | "favorites" | "activity" | "subscribedDiscussions" | "newsEvents";

export type BadgesSortOrder = "oldest" | "newest";

export type SocialEntryDefault = SocialView | "lastUsed";

export type ActivityCardAction = "profile" | "achievement" | "game";

export type OptionsTab = "system" | "gui" | "social" | "cache" | "advanced";

export type ScalePreset = "portable" | "bigScreen" | "bigText";

export type QuickMenuShortcut =
    | "dolphinMapper"
    | "cheevoCheck"
    | "smbShares"
    | "fileWatcher"
    | "socialActivity"
    | "visitRa"
    | "uiDefault"
    | "uiCompact";

export type ShortcutButton = "menu" | "view" | "l3" | "r3" | "l4" | "l5" | "r4" | "r5";

export type ShortcutAction =
    | "none"
    | "notifications"
    | "pageUp"
    | "home"
    | "currentGuide"
    | "search"
    | "profile"
    | "socialhub"
    | "news"
    | "aotw"
    | "newsets"
    | "subscribeddiscussions"
    | "savedcomments"
    | "trackedsets"
    | "utilities"
    | "useraccounts"
    | "options"
    | "about"
    | "refresh"
    | "dolphinMapper"
    | "cheevoCheck"
    | "smbShares"
    | "fileWatcher"
    | "socialActivity"
    | "visitRa"
    | "snapshot"
    | "nightMode"
    | "doNotDisturb"
    | "mouseKeyboardMode"
    | "cycleUiScale";

export type TrackedTab = "thisGame" | "otherGames" | "addAllMissable" | "clear";

export type CacheClearGroup = "gameData" | "friendGamePayloads" | "friends" | "images" | "awardIcons" | "socialActivity" | "gameActivity" | "playersNearYou" | "gamesList" | "awardsList" | "wantToPlayList" | "setsList" | "leaderboards" | "cheevoCheckResults" | "cheevoCheckHashes" | "cheevoCheckRaData";

export type NotificationType =
    | "noteReminder"
    | "trackedSet"
    | "commentTracker"
    | "wall"
    | "system"
    | "tracked"
    | "social"
    | "nearYou"
    | "debug";

export type NotificationKind = "info" | "actionable";

export type NotificationIconSource = "game" | "achievement" | "avatar" | "setMosaic" | "system" | "none";

type NotificationSource = "notifications";

type NotificationNavTarget = {
    view: "gameNotes" | "trackedSetOpen" | "gameOverview" | "achievementOverview" | "cheevoCheck" | "fileWatcher" | "changelog" | "message" | "external";
    gameId?: number | null;
    achievementId?: number | null;
    noteId?: string | null;
    setId?: string | null;
    url?: string | null;
};

export type CheevoNotification = {
    id: string;
    type: NotificationType;
    kind: NotificationKind;
    createdAt: number;
    title: string;
    body: string;
    iconSource: NotificationIconSource;
    iconGameId: number | null;
    iconImageIcon: string | null;
    target: NotificationNavTarget | null;
    source: NotificationSource | null;
    meta: Record<string, unknown> | null;
};

export type NotificationsPayload = {
    notifications: CheevoNotification[];
    lastSeenAt: number;
};

export type ArchivedNotification = CheevoNotification & {
    archivedAt: number;
};

export type ArchiveBucket =
    | "all"
    | "unlocks"
    | "commentPosts"
    | "system"
    | "reminders"
    | "masteryGoals";

export type ArchiveSort =
    | "archivedDesc"
    | "archivedAsc"
    | "createdDesc"
    | "createdAsc";

export type UpdateStatusResponse = {
    ok: boolean;
    installedVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    patchNotesUrl: string;
    installUrl: string;
    publishedAt: string;
    lastCheckedAt: number;
    error: string | null;
};

export type SavedUser = {
    username: string;
    hasApiKey: boolean;
    lastSignedInAt: number;
    hasConnectToken: boolean;
    hardcore: boolean;
};

export type SettingsResponse = {
    username: string;
    activeUlid: string;
    hasApiKey: boolean;
    autoRefresh: boolean;
    showIcons: boolean;
    deferModalCleanup: boolean;
    legacyCommentsLoading: boolean;
    showAllAchievements: boolean;
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
    doNotDisturb: boolean;
    doNotDisturbDisablesDot: boolean;
    doNotDisturbDisablesToast: boolean;
    nightMode: boolean;
    nightModeBrightness: number;
    batterySaver: boolean;
    batterySaverDisablesSocialActivity: boolean;
    batterySaverDisablesComments: boolean;
    batterySaverDisablesFriendAvatars: boolean;
    batterySaverDisablesPlayersNearYou: boolean;
    batterySaverDisablesTrackedSets: boolean;
    batterySaverDisablesFileWatcher: boolean;
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
    notifyDebugEnabled: boolean;
    notifyDebugToast: boolean;
    legacyAchievementLinks: boolean;
    legacyGameLinks: boolean;
    autoPurgeService: boolean;
    debugLogging: boolean;
    injectEmulatorLogin: boolean;
    showDeveloperOptions: boolean;
    ipcSlowThresholdMs: number;
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
    playersNearYouTapMode: PlayersNearYouTapMode;
    playersNearYouCollapsed: boolean;
    dolphinAdvancedCollapsed: boolean;
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
    favoriteFriends: string[];
    lastSocialView: SocialView;
    badgesSortOrder: BadgesSortOrder;
    lastConsoleId: number;
    socialEntryDefault: SocialEntryDefault;
    savedCommentsPrefs: SavedCommentsPrefs;
    activityCardAction: ActivityCardAction;
    friendFeedCardAction: ActivityCardAction;
    socialHubCardAction: ActivityCardAction;
    defaultNoteColor: NoteColor;
    lastOptionsTab: OptionsTab;
    lastTrackedTab: TrackedTab;
    rememberLastPage: boolean;
    uiSize: ScaleStep;
    achievementTextScale: ScaleStep;
    commentsTextScale: ScaleStep;
    textScale: ScaleStep;
    titleScale: ScaleStep;
    headerScale: ScaleStep;
    bannerScale: ScaleStep;
    modalScale: ScaleStep;
    isSteamMachine?: boolean;
    largeViewportBonusEnabled: boolean;
    largeViewportBonus: number;
    guideZoom: number;
    guideModalZoom: number;
    textViewerZoom: number;
    pinLatestGuides: boolean;
    keepGuidesOffline: boolean;
    topPadding: number;
    blockPadding: number;
    buttonSpacing: ButtonSpacing;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    coloredGlyphs: boolean;
    showAButtonMode: boolean;
    showAButtonModeTracked: boolean;
    gameNotesAButtonMode: GameNoteAButtonMode;
    showSocialHubButton: boolean;
    showTrackedSetsButton: boolean;
    putUpdaterOnDesktop: boolean;
    showOptionsButton: boolean;
    quickMenuShortcuts: QuickMenuShortcut[];
    shortcutBindings: Record<ShortcutButton, ShortcutAction>;
    lastScalePreset: ScalePreset;
    showAllToggleMain: boolean;
    showAllToggleFriend: boolean;
    showTrackedNotesMain: boolean;
    showRetroPoints: boolean;
    achievementStyle: AchievementStyle;
    trackedColor: TrackedColor;
    mainAchievementFilter: MainAchievementFilter;
    mainAchievementSort: AchievementSort;
    mainAchievementAction: MainAchievementAction;
    trackedAchievementAction: TrackedAchievementAction;
    dolphinMapperMode: DolphinMapperMode;
    dolphinSystemFilter: DolphinSystemFilter;
    dolphinBluetoothPassthrough: boolean;
    dolphinContinuousScanning: boolean;
    dolphinBalanceBoard: boolean;
    cheevoCheckCacheHashes: boolean;
    cheevoCheckExtractToRam: boolean;
    cheevoCheckVerifyHashes: boolean;
    cheevoCheckVerifySpeed: CheevoCheckVerifySpeed;
    cheevoCheckScanCollapsed: boolean;
    cheevoCheckResultsCollapsed: boolean;
    cheevoCheckVerifyCollapsed: boolean;
    cheevoCheckOptionsCollapsed: boolean;
    cheevoCheckSkipDiscVerify: boolean;
    cheevoCheckSkipCartVerify: boolean;
    libraryBadge: boolean;
    fileWatcherSpeed: FileWatcherSpeed;
    fileWatcherRunDuringGames: boolean;
    trackedSetAButtonMode: TrackedSetAButtonMode;
    trackedAchievementSort: TrackedAchievementSort;
    friendAchievementFilter: FriendAchievementFilter;
    friendAchievementSort: AchievementSort;
    friendShowAllAchievements: boolean;
    trackedSetsAutoCheck: boolean;
    trackedSetsServiceEnabled: boolean;
    trackedSetsRefreshMinutes: number;
    trackedSetsSelectorSort: TrackedSetSelectorSort;
    trackedSetsSelectorFilter: TrackedSetFilter;
    language: LanguageCode;
    viewedIntro: boolean;
    users: SavedUser[];
};

export type InjectResult = {
    ok: boolean;
    results: {
        emulator: "RetroArch" | "Dolphin" | "PCSX2";
        outcome: "written" | "skipped-not-found" | "error";
        detail?: string;
    }[];
};

export type SwitchUserResult =
    | {
          ok: false;
          error?: string;
          emulators?: string[];
      }
    | ({
          ok: true;
          credentialsRejected?: boolean;
          inject?: InjectResult | null;
      } & SettingsResponse);

export type AchievementRow = {
    badgeUrl?: string | null;
    id: number;
    title: string;
    description: string;
    points: number;
    trueRatio: number;
    badgeName: string;
    displayOrder: number;
    type?: string | null;
    dateEarned?: string | null;
    dateEarnedHardcore?: string | null;
    measured: boolean;
    measuredProgress?: string | null;
    measuredPercent?: number | null;
    numAwarded: number;
    numAwardedHardcore: number;
};

export type Payload = {
    gameId: number | null;
    title: string | null;
    consoleName: string | null;
    developer?: string | null;
    publisher?: string | null;
    genre?: string | null;
    released?: string | null;
    releasedAtGranularity?: string | null;
    imageIcon?: string | null;
    imageIngame?: string | null;
    imageBoxArt?: string | null;
    status?: string | null;
    numAchievements: number;
    numAwardedToUser: number;
    numAwardedToUserHardcore?: number;
    highestAwardKind?: string | null;
    userCompletion?: string | null;
    userCompletionHardcore?: string | null;
    numDistinctPlayers?: number | null;
    numDistinctPlayersCasual?: number | null;
    numDistinctPlayersHardcore?: number | null;
    achievements: AchievementRow[];
};

export type FriendRecentGame = {
    gameId: number;
    title: string;
    consoleName?: string | null;
    imageIcon?: string | null;
    lastPlayed?: string | null;
};

export type FriendRow = {
    username: string;
    ulid?: string | null;
    avatarUrl?: string | null;
    avatarDataUri?: string | null;
    avatarCachedAt?: number | null;
    richPresence?: string | null;
    lastGameId?: number | null;
    lastGameTitle?: string | null;
    points?: number;
    pointsSoftcore?: number;
    totalTruePoints?: number;
    isFollowingMe?: boolean;
    isSelf?: boolean;
    statusText?: string | null;
    recentGames?: FriendRecentGame[];
};

export type FriendAllGameRow = {
    gameId: number;
    title: string;
    consoleId?: number | null;
    consoleName?: string | null;
    imageIcon?: string | null;
    maxPossible?: number;
    numAwarded?: number;
    numAwardedHardcore?: number;
    highestAwardKind?: string | null;
    highestAwardDate?: string | null;
};

export type FriendAllGamesPayload = {
    friendUsername: string;
    offset: number;
    count: number;
    total: number;
    results: FriendAllGameRow[];
    refreshedAt?: number | null;
};

export type WantToPlayRow = {
    gameId: number;
    title: string;
    consoleName?: string | null;
    imageIcon?: string | null;
    pointsTotal?: number;
    achievementsPublished?: number;
    numAwarded?: number;
    maxPossible?: number;
};

export type WantToPlayPayload = {
    username: string;
    offset: number;
    count: number;
    total: number;
    results: WantToPlayRow[];
    refreshedAt?: number | null;
};

type AwardType =
    | "Mastery/Completion"
    | "Game Beaten"
    | "Achievement Unlocks Yield"
    | "Achievement Points Yield"
    | "Patreon Supporter"
    | "Certified Legend";

export type UserAwardRow = {
    awardType: AwardType | string;
    awardData: number;
    awardDataExtra: number;
    title: string;
    consoleName?: string | null;
    imageIcon?: string | null;
    awardedAt?: string | null;
    displayOrder: number;
};

export type UserAwardsPayload = {
    username: string;
    results: UserAwardRow[];
    totalAwardsCount: number;
    hiddenAwardsCount: number;
    masteryAwardsCount: number;
    completionAwardsCount: number;
    beatenHardcoreAwardsCount: number;
    beatenSoftcoreAwardsCount: number;
    eventAwardsCount: number;
    siteAwardsCount: number;
    refreshedAt?: number | null;
};

export type UserAwardsResponse = RaPayloadResponse<UserAwardsPayload>;

export type FriendsPayload = {
    friends: FriendRow[];
    count: number;
    refreshedAt?: number | null;
};

export type FriendGamePayload = {
    friendUsername: string;
    ulid?: string | null;
    selectedGameId: number | null;
    selectedGameTitle?: string | null;
    recentGames: FriendRecentGame[];
    richPresence?: string | null;
    statusText?: string | null;
    points?: number | null;
    pointsSoftcore?: number | null;
    totalTruePoints?: number | null;
    memberSince?: string | null;
    motto?: string | null;
    payload: Payload | null;
    refreshedAt?: number | null;
};

type UnlockHistoryRow = {
    achievementId: number;
    dateEarned?: string | null;
    hardcore?: boolean;
};

export type UnlockHistoryPayload = {
    gameId: number | null;
    minutes: number;
    count: number;
    refreshedAt?: number | null;
    results: UnlockHistoryRow[];
};

export type UnlockHistoryResponse = RaPayloadResponse<UnlockHistoryPayload>;


type SocialActivityKind = "achievementUnlocked" | "gameBeaten" | "gameMastered";

export type SocialActivityEvent = {
    id: string;
    username: string;
    ulid?: string | null;
    kind: SocialActivityKind;
    softWording?: boolean;
    gameId?: number | null;
    gameTitle?: string | null;
    achievementId?: number | null;
    achievementTitle?: string | null;
    achievementDescription?: string | null;
    achievementIcon?: string | null;
    points?: number | null;
    trueRatio?: number | null;
    hardcore?: boolean;
    timestamp?: string | null;
    discoveredAt: string;
    isFavorite: boolean;
};

export type SocialActivityResponse = {
    ok?: boolean;
    needsSettings?: boolean;
    error?: string;
    events: SocialActivityEvent[];
    refreshed: boolean;
    refreshSkipped?: boolean;
    skipReason?: string | null;
    refreshedFriends: number;
    checkedFriends?: number;
    newEvents?: number;
    cacheAgeSeconds?: number | null;
    cacheThresholdMinutes?: number;
    candidateNames?: string[];
};

export type PlayersNearYouItem = {
    id: string;
    ulid?: string | null;
    user: string;
    achievementId: number;
    achievementTitle: string;
    badgeName?: string | null;
    gameId?: number | null;
    gameTitle?: string | null;
    hardcoreMode?: boolean;
    dateAwarded?: string | null;
    discoveredAt?: string | null;
};

export type PlayersNearYouResponse = {
    error?: string;
    items: PlayersNearYouItem[];
    lastRefreshAt?: string | null;
    mode?: PlayersNearYouMode;
};

export type NowPlayingActivityResponse = {
    ok: boolean;
    error?: string;
    events: SocialActivityEvent[];
};

export type GameTickerEvent = {
    username: string;
    achievementTitle: string;
    achievementId?: number | null;
    gameId?: number | null;
    occurredAt?: string | null;
    discoveredAt?: string | null;
};

export type GameTickerResponse = {
    ok: boolean;
    error?: string;
    event: GameTickerEvent | null;
};

export type SocialHubTickerEvent = {
    username: string;
    achievementTitle: string;
    achievementId?: number | null;
    achievementIcon?: string | null;
    achievementDescription?: string | null;
    points?: number | null;
    trueRatio?: number | null;
    hardcore?: boolean;
    gameId?: number | null;
    gameTitle?: string | null;
    occurredAt?: string | null;
    discoveredAt?: string | null;
};

export type SocialHubTickerResponse = {
    ok: boolean;
    error?: string;
    event: SocialHubTickerEvent | null;
};

export type CachedResponse = { payload: Payload | null };
export type CachedFriendsResponse = { payload: FriendsPayload | null; hasCache?: boolean };

export type RefreshResponse =
    | {
          needsSettings: true;
          error?: string;
          payload?: Payload | null;
          changed?: boolean;
      }
    | {
          needsSettings?: false;
          payload: Payload;
          error?: string;
          changed: boolean;
      };

export type FriendsRefreshResponse = RaPayloadResponse<FriendsPayload>;

export type FriendGameResponse = RaPayloadResponse<FriendGamePayload>;

export type FriendAllGamesResponse = RaPayloadResponse<FriendAllGamesPayload>;

export type GamesListCacheResult = {
    hit: boolean;
    payload?: FriendAllGamesPayload;
};

export type AwardsListCacheResult = {
    hit: boolean;
    payload?: UserAwardsPayload;
};

export type WantToPlayCacheResult = {
    hit: boolean;
    payload?: WantToPlayPayload;
};

export type WantToPlayResponse = RaPayloadResponse<WantToPlayPayload>;

export type FriendRowRefreshResponse = {
    needsSettings?: boolean;
    error?: string;
    row?: FriendRow | null;
    payload?: FriendsPayload | null;
};

type LeaderboardUserEntry = {
    user?: string | null;
    ulid?: string | null;
    score?: number | string | null;
    formattedScore?: string | null;
    rank?: number | null;
    dateUpdated?: string | null;
};

export type LeaderboardRow = {
    id: number;
    rankAsc: boolean;
    title: string;
    description: string;
    format?: string | null;
    state?: string | null;
    userEntry?: LeaderboardUserEntry | null;
};

export type GameLeaderboardsPayload = {
    gameId: number | null;
    count: number;
    total: number;
    refreshedAt?: number | null;
    results: LeaderboardRow[];
};

export type LeaderboardEntryRow = {
    rank: number;
    user: string;
    ulid?: string | null;
    score?: number | string | null;
    formattedScore?: string | null;
    dateSubmitted?: string | null;
};

export type LeaderboardEntriesPayload = {
    leaderboardId: number | null;
    count: number;
    total: number;
    refreshedAt?: number | null;
    results: LeaderboardEntryRow[];
};

export type GameLeaderboardsResponse = RaPayloadResponse<GameLeaderboardsPayload>;

export type LeaderboardEntriesResponse = RaPayloadResponse<LeaderboardEntriesPayload>;

export type LeaderboardUserEntryPayload = {
    leaderboardId: number | null;
    userEntry?: LeaderboardUserEntry | null;
    refreshedAt?: number | null;
};

export type LeaderboardUserEntryResponse = RaPayloadResponse<LeaderboardUserEntryPayload>;

export type TrackedNotes = Record<string, string>;

export type NoteColor =
    | "default"
    | "green"
    | "amber"
    | "orange"
    | "red"
    | "pink"
    | "purple"
    | "blue"
    | "sky"
    | "cyan"
    | "teal"
    | "lime"
    | "gray"
    | "indigo"
    | "rose"
    | "fuchsia"
    | "violet"
    | "emerald"
    | "yellow"
    | "brown"
    | "slate"
    | "crimson"
    | "mint"
    | "coral"
    | "gold"
    | "steel";

export type TrackedNotesColor = Record<string, NoteColor>;

export type TrackedSetGameSort = "manual" | "recent" | "oldest";

export type TrackedSetViewMode = "all" | "system" | "systemYear" | "retroHistory" | "retroHistoryAlpha";

export type TrackedSetSelectorSort = "alphabetical" | "recent" | "oldest" | "completionDesc" | "completionAsc" | "gameCountDesc" | "gameCountAsc";

export type TrackedSetAward = "mastered" | "completed" | "beaten-hardcore" | "beaten-softcore";

export type TrackedSetGame = {
    gameId: number;
    title: string;
    imageIcon: string;
    consoleName: string;
    note: string;
    color: NoteColor;
    manualOrder: number;
    systemOrder: number;
    systemYearOrder: number;
    retroOrder: number;
    retroAlphaOrder: number;
    numAwarded: number | null;
    maxPossible: number | null;
    highestAward: TrackedSetAward | null;
    lastCheckedAt: number | null;
};

export type TrackedSet = {
    id: string;
    name: string;
    color: NoteColor;
    manualOrder: number;
    gameSort: TrackedSetGameSort;
    gameFilter: TrackedSetFilter;
    viewMode: TrackedSetViewMode;
    lastOpenedAt: number | null;
    games: TrackedSetGame[];
};

export type AddTrackedSetGamePayload = {
    gameId: number;
    title: string;
    imageIcon: string;
    consoleName: string;
    maxPossible: number;
};

export type TrackedSetConsole = {
    id: number;
    name: string;
    iconUrl: string;
    active: boolean;
};

export type TrackedSetPickerGame = {
    gameId: number;
    title: string;
    imageIcon: string;
    consoleName: string;
    maxPossible: number;
};

export type LoadTrackedSetsResponse = {
    schemaVersion: number;
    sets: TrackedSet[];
};

export type TrackedSetResponse = {
    ok: boolean;
    set?: TrackedSet;
    error?: string;
};

export type CheckAllSetsResponse = {
    ok: boolean;
    sets?: TrackedSet[];
    needsSettings?: boolean;
    error?: string;
};

export type AddTrackedSetGameResponse = {
    ok: boolean;
    set?: TrackedSet;
    alreadyPresent?: boolean;
    error?: string;
};


export type ClearAllTrackedSetsResponse = {
    ok: boolean;
    deletedSets: number;
    deletedGames: number;
};

export type TrackedSetConsoleListResponse = {
    ok: boolean;
    consoles: TrackedSetConsole[];
    cached: boolean;
};

export type TrackedSetGameListResponse = {
    ok: boolean;
    games: TrackedSetPickerGame[];
    cached: boolean;
};

export type SaveTrackedSetsSelectorSortResponse = {
    ok: boolean;
    trackedSetsSelectorSort: TrackedSetSelectorSort;
};

export type SaveTrackedSetsSelectorFilterResponse = {
    ok: boolean;
    trackedSetsSelectorFilter: TrackedSetFilter;
};


export type SubscriptionKind = "game" | "achievement";

export type Subscription = {
    key: string;
    kind: SubscriptionKind;
    id: number;
    gameId: number;
    title: string;
    gameTitle: string;
    console: string;
    iconUrl: string;
    badgeName: string;
    addedAt: number;
};

export type SubscriptionsResponse = {
    schemaVersion: number;
    subscriptions: Subscription[];
};

export type AddSubscriptionPayload = {
    kind: SubscriptionKind;
    id: number;
    gameId: number;
    title: string;
    gameTitle: string;
    console: string;
    iconUrl: string;
    badgeName: string;
    seedComments?: GameComment[];
    seedSort?: "newest" | "oldest";
    seedLoaded?: boolean;
};

export type AddSubscriptionResponse = {
    ok: boolean;
    subscription?: Subscription;
    alreadySubscribed?: boolean;
    error?: string;
};

export type RemoveSubscriptionResponse = {
    ok: boolean;
    key?: string;
    error?: string;
};


export type SavedCommentSourceKind = "game" | "achievement" | "userWall";

export type SavedCommentSource = {
    kind: SavedCommentSourceKind;
    sourceId: string;
    gameId: number | null;
    gameTitle: string;
    gameImageIcon: string;
    achievementId: number | null;
    achievementTitle: string;
    achievementImageIcon: string;
    achievementBadgeName: string;
    wallUser: string;
};

export type SavedComment = {
    id: string;
    user: string;
    ulid: string;
    submitted: string;
    commentText: string;
    source: SavedCommentSource;
    savedAt: number;
    openedAt: number;
};

export type SaveCommentPayload = {
    user: string;
    ulid: string;
    submitted: string;
    commentText: string;
    source: Omit<SavedCommentSource, "sourceId">;
};

type SavedCommentKey = {
    id: string;
    matchKey: string;
};

export type SavedCommentKeysResponse = {
    keys: SavedCommentKey[];
};

export type SavedCommentsResponse = {
    schemaVersion: number;
    comments: SavedComment[];
};

export type SaveCommentResponse = {
    ok: boolean;
    record?: SavedComment;
    alreadySaved?: boolean;
    error?: string;
};

export type UnsaveCommentResponse = {
    ok: boolean;
    id?: string;
    error?: string;
};

export type ClearSavedCommentsResponse = {
    ok: boolean;
};

export type CommentSurfaceKey =
    | "comments:ao"
    | "comments:overview"
    | "comments:nowplaying"
    | "comments:wall"
    | "comments:aotw";

export type CommunitySubTab = "subscribed" | "savedComments";
export type SavedCommentsSort = "recent" | "oldest" | "opened";
export type SavedCommentsFilter = "all" | "achievement" | "wall" | number;

export type SavedCommentGame = {
    gameId: number;
    title: string;
    imageIcon: string;
    count: number;
};

export type SavedCommentsPrefs = {
    subTab: CommunitySubTab;
    sort: SavedCommentsSort;
    filter: string;
};


export type TrackedAchievementsResponse = {
    gameId: number | null;
    viewOpen: boolean;
    achievementIds: number[];
    notes: TrackedNotes;
    notesColor: TrackedNotesColor;
    sort: TrackedAchievementSort;
};

export type ToggleTrackedResponse = {
    ok: boolean;
    tracked: boolean;
    achievementIds: number[];
    notes: TrackedNotes;
    notesColor: TrackedNotesColor;
    sort: TrackedAchievementSort;
};

export type BulkToggleTrackedAction = "track" | "untrack" | "set";

export type BulkToggleTrackedResponse = {
    ok: boolean;
    achievementIds: number[];
    notes: TrackedNotes;
    notesColor: TrackedNotesColor;
    sort: TrackedAchievementSort;
    changed: number;
};

export type SaveTrackedNoteResponse = {
    ok: boolean;
    notes: TrackedNotes;
    notesColor: TrackedNotesColor;
};

export type SaveDefaultNoteColorResponse = {
    ok: boolean;
    defaultNoteColor: NoteColor;
};

export type SaveTrackedSortForGameResponse = {
    ok: boolean;
    gameId: number | null;
    sort: TrackedAchievementSort;
    achievementIds: number[];
    notes: TrackedNotes;
    notesColor: TrackedNotesColor;
};

export type ClearTrackedResponse = {
    ok: boolean;
    gameId: number | null;
    cleared: number;
    totalTrackedCount: number;
};

export type RecentTagsResponse = {
    ok: boolean;
    recentTags: string[];
};

export type GameNoteSortMode = "newest" | "oldest" | "manual";

export type GameNoteReminderMode = "off" | "once" | "every";

export type GameNoteReminderUnit = "minutes" | "hours" | "days";

export type GameNoteAButtonMode = "editNote" | "moveNote";

export type GameNote = {
    id: string;
    title: string;
    body: string;
    tag: string | null;
    color: NoteColor;
    createdAt: number;
    updatedAt: number;
    manualOrder: number;
    reminderMode: GameNoteReminderMode;
    reminderEveryMinutes: number | null;
    reminderEveryValue: number | null;
    reminderEveryUnit: GameNoteReminderUnit | null;
    reminderLastFiredAt: number | null;
    completedAt: number | null;
    showFiredDot: boolean;
};

export type GameNotesPayload = {
    gameId: number;
    schemaVersion: number;
    sortMode: GameNoteSortMode;
    tagVocabulary: string[];
    notes: GameNote[];
    pendingReminderBadge: boolean;
};

export type GameNoteSingleResponse = {
    ok: boolean;
    note?: GameNote;
    error?: string;
};

export type GameNoteDeleteResponse = {
    ok: boolean;
    deletedId?: string;
    error?: string;
};


export type GameNoteSortResponse = {
    ok: boolean;
    sortMode?: GameNoteSortMode;
    error?: string;
};

export type GameNoteReminderFiring = {
    noteId: string;
    gameId: number;
    title: string;
    body: string;
    color: NoteColor;
    firedAt: number;
};

export type PendingGameNoteRemindersResponse = {
    ok: boolean;
    reminders: GameNoteReminderFiring[];
    error?: string;
};

export type AckGameNoteRemindersResponse = {
    ok: boolean;
    removed?: number;
    error?: string;
};

export type ClearNoteFiredDotResponse = {
    ok: boolean;
    note?: GameNote;
    error?: string;
};

export type ClearAllTrackedResponse = {
    ok: boolean;
    cleared: number;
    totalTrackedCount: number;
};

export type TotalTrackedCountResponse = {
    ok: boolean;
    totalTrackedCount: number;
};

export type TrackedGameSummary = {
    gameId: number;
    count: number;
    title: string | null;
    consoleName: string | null;
    imageIcon: string | null;
};

export type AllTrackedGamesResponse = {
    ok: boolean;
    games: TrackedGameSummary[];
};

export type CheckCurrentGameResponse = {
    needsSettings?: boolean;
    error?: string;
    payload?: Payload | null;
    sameGame: boolean;
    changed: boolean;
    currentGameId?: number | null;
    cachedGameId?: number | null;
};

export type GamePayloadResponse = {
    needsSettings?: boolean;
    error?: string;
    payload?: Payload | null;
};

export type TrackedDrillInState = {
    payload: Payload | null;
    payloadLoading: boolean;
    payloadError: string | null;
    trackedReady: boolean;
    trackedAchievements: AchievementRow[];
    trackedIds: number[];
    notesByAchievementId: TrackedNotes;
    notesColorByAchievementId: TrackedNotesColor;
    sort: TrackedAchievementSort;
    reorderTargetId: number | null;
    reorderViaSwap?: boolean;
    onAchievementClick: (
        achievement: AchievementRow,
        trackedAchievements: AchievementRow[]
    ) => void | Promise<void>;
    onUntrack: (achievement: AchievementRow) => void | Promise<void>;
    onEditNote: (achievement: AchievementRow) => void;
    onReorderPick: (achievementId: number, allowSwap: boolean) => void | Promise<void>;
    onSortChange: (nextSort: TrackedAchievementSort) => void | Promise<void>;
    onReorderMove: (direction: ReorderDirection, groupIds?: number[] | null) => void | Promise<void>;
};

export type NewsEntry = {
    id: number | null;
    title: string;
    link: string;
    summary: string;
    publishedAt: string | null;
};

export type AotwUnlock = {
    user: string;
    ulid: string;
    raPoints: number;
    raSoftcorePoints: number;
    hardcoreMode: boolean;
    dateAwarded: string;
};

export type AotwComment = {
    user: string;
    ulid: string;
    submitted: string;
    commentText: string;
};

export type AchievementOfTheWeekPayload = {
    achievement: {
        id: number | null;
        title: string;
        description: string;
        points: number;
        trueRatio: number;
        type: string | null;
        author: string;
        badgeName: string;
        badgeUrl: string;
        dateCreated: string;
        dateModified: string;
    };
    console: { id: number | null; title: string };
    game: {
        id: number | null;
        title: string;
        imageIcon: string | null;
    };
    forumTopicId: number | null;
    startAt: string;
    totalPlayers: number;
    unlocksCount: number;
    unlocksHardcoreCount: number;
    unlocks: AotwUnlock[];
};

export type NewSetEntry = {
    id: number | null;
    user: string;
    userUlid: string;
    userIsJrDev: boolean;
    gameId: number | null;
    gameTitle: string;
    subsetName: string | null;
    gameIcon: string;
    consoleId: number | null;
    consoleName: string;
    setType: number;
    doneTime: string;
    doneTimeUnix: number;
};

export type NewsFeedResponse = {
    payload: NewsEntry[];
    fromCache: boolean;
    error?: string;
};

export type AchievementOfTheWeekResponse = {
    payload: AchievementOfTheWeekPayload | null;
    comments: AotwComment[];
    currentUserHasUnlocked: boolean;
    fromCache: boolean;
    needsSettings?: boolean;
    error?: string;
};

export type NewSetsAndRevisionsResponse = {
    payload: NewSetEntry[];
    fromCache: boolean;
    filter: NewSetsFilter;
    needsSettings?: boolean;
    error?: string;
};

export type GameComment = {
    user: string;
    ulid: string;
    submitted: string;
    commentText: string;
};

export type GameCommentsResponse = {
    comments: GameComment[];
    total: number | null;
    nextOffset?: number | null;
    hasMore?: boolean | null;
    needsSettings?: boolean;
    error?: string;
    restricted?: boolean;
};

export type ResumeState = {
    view: ViewKey;
    navStack?: ViewKey[] | null;
    friendProfileBackSource?: "social" | "main" | null;
    focusKey?: string | null;
    primaryGameId?: number | null;
    selectedFriendUsername?: string | null;
    selectedFriendUlid?: string | null;
    friendGameId?: number | null;
    friendAllGamesCount?: number | null;
    friendGameSource?: FriendGameSource | null;
    friendGameSelectionMode?: FriendGameSelectionMode | null;
    friendProfileSubView?: FriendProfileSubView | null;
    guidesSubView?: GuidesSubView | null;
    guidesFaqId?: string | null;
    leaderboardsSourceView?: "achievements" | "friendGame" | "gameOverview" | null;
    selectedLeaderboardId?: number | null;
    nowPlayingCompareFriend?: string | null;
    nowPlayingCompareFilter?: NowPlayingCompareFilter | null;
    mainAchievementsTab?: MainAchievementsTab | null;
    newsEventsSubView?: NewsEventsSubView | null;
    newSetsFilter?: NewSetsFilter | null;
    aotwSubView?: AotwSubView | null;
    gameOverviewGameId?: number | null;
    gameOverviewSubView?: GameOverviewSubView | null;
    gameOverviewSource?: GameOverviewSource | null;
    gameOverviewViewedUsername?: string | null;
    gameOverviewViewedUserRef?: string | null;
    gameNotesGameId?: number | null;
    aoSource?: AOSource | null;
    aoAchievementId?: number | null;
    aoGameId?: number | null;
    aoAchievementSnapshot?: AchievementOverviewSnapshot | null;
    aoViewedUsername?: string | null;
    aoViewedUserRef?: string | null;
    friendEntrySource?: "profile" | "compareGame" | null;
    trackedSelectedGameId?: number | null;
    unlockHistorySource?: "main" | "friendGame" | null;
    badgeFilter?: BadgeFilter | null;
    allGamesLetterRange?: AllGamesLetterRangeKey | null;
    allGamesStatusFilter?: AllGamesStatusFilter | null;
    followedRankingMetric?: FollowedRankingMetric | null;
    trackedSetOpenId?: string | null;
    trackedSetsBackSource?: "profile" | "main" | null;
    savedAt?: number | null;
};

export type ResumeStateResponse = {
    ok: boolean;
    resumeState: ResumeState | null;
};
