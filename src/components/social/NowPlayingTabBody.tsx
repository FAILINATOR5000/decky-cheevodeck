import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import {
    getNowPlayingActivity,
    prefetchUserAvatars
} from "../../api";
import { CompareAchievementRow, compareBorderFor, type CompareRowListProps } from "../achievements/CompareAchievementRow";
import { POINTS_LABEL_STYLES } from "../achievements/PointsLabel";
import { CompareHeader } from "../achievements/CompareHeader";
import { ErrorText } from "../ui/ErrorText";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusClaim } from "../ui/FocusClaim";
import { CommentActionStrip } from "../comments/CommentActionStrip";
import { CommentsList } from "../comments/CommentsList";
import { InlineSpinner } from "../ui/InlineSpinner";
import { LabeledRow } from "../ui/LabeledRow";
import { CollapseChevron } from "../ui/CollapseChevron";
import { NowPlayingActivityCard, type NowPlayingActivityListProps } from "./NowPlayingActivityStrip";
import { PlayersNearYouRow } from "./PlayersNearYouRow";
import { isFriendAvatarStale } from "../../utils/friends";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import { useThreadSubscription } from "../../hooks/useThreadSubscription";
import type { RestoredCommentsWindow } from "../../hooks/useCommentsWindow";
import type {
    AchievementRow,
    AchievementStyle,
    ActivityCardAction,
    AotwComment,
    FriendGamePayload,
    FriendRow,
    GameComment,
    NowPlayingCompareFilter,
    NowPlayingSubView,
    Payload,
    PlayersNearYouItem,
    PlayersNearYouMode,
    PlayersNearYouTapMode,
    ControllerGlyphStyle,
    SocialActivityEvent,
    UiSize
} from "../../types";
import { UserAvatar } from "../ui/UserAvatar";
import { earned } from "../../utils/achievements";
import { logError } from "../../utils/errors";
import { achievementUiMetrics, bodyTextStyle, smallTextStyle } from "../../utils/style";
import { textSize } from "../../utils/scale";
import {
    activityCardActionLabel,
    nextPlayersNearYouMode,
    nextPlayersNearYouTapMode,
    playersNearYouModeHelp,
    playersNearYouModeLabel,
    playersNearYouTapModeLabel
} from "../../utils/options";
import { ButtonHints } from "../ui/ButtonHints";
import { beginGuardedRun } from "../../utils/runGuard";

const COMMENTS_STRIP_TOP_MARGIN = "10px";

const ACTIVITY_MAX_ROWS = 500;

export type NowPlayingTabBodyProps = {
    language: LanguageCode;
    uiSize: UiSize;
    achievementStyle: AchievementStyle;
    activityEvents: SocialActivityEvent[];
    friendsByUsername: Map<string, FriendRow>;
    currentPayload: Payload | null;
    showIcons: boolean;
    blockPadding: number;
    dynamicActivityFeed: boolean;
    dynamicCompare: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    compareFriendUsername: string | null;
    compareFriendRow: FriendRow | null;
    compareFilter: NowPlayingCompareFilter;
    compareLoading: boolean;
    compareError: string | null;
    comparePayload: FriendGamePayload | null;
    subView: NowPlayingSubView;
    onOpenComparePicker: () => void;
    comparePickerEntryToken?: number;
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
    commentsLoaded: boolean;
    commentsNeedsSettings: boolean;
    commentsCardClaim?: {
        slotIndex: number;
        token: number;
        armed: boolean;
    };
    onSpendCommentsCardClaim: () => void;
    commentsPostClaim?: {
        token: number;
        armed: boolean;
    };
    onSpendCommentsPostClaim: () => void;
    holdCommentsBody: boolean;
    restorePending: boolean;
    commentsWindow: RestoredCommentsWindow | null;
    onChangeCommentsSort: (sort: "newest" | "oldest") => void;
    onLoadMoreComments: () => void | Promise<void>;
    onCommentClick: (comment: AotwComment | GameComment) => void | Promise<void>;
    onPostComment: () => void | Promise<void>;
    dynamicComments: boolean;
    dynamicCommentsSentinelRootMargin: number;
    showRetroPoints: boolean;
    playersNearYouItems: PlayersNearYouItem[];
    playersNearYouEnabled: boolean;
    playersNearYouCheckedGameId: number | null;
    playersNearYouTapMode: PlayersNearYouTapMode;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    onPlayersNearYouSecondary: (item: PlayersNearYouItem) => void | Promise<void>;
    onPlayersNearYouTertiary: (item: PlayersNearYouItem) => void | Promise<void>;
    onFriendFeedCardSecondary: (event: SocialActivityEvent) => void;
    onFriendFeedCardTertiary: (event: SocialActivityEvent) => void;
    onPlayersNearYouClick: (item: PlayersNearYouItem) => void | Promise<void>;
    onChangePlayersNearYouTapMode: (mode: PlayersNearYouTapMode) => void;
    playersNearYouCollapsed: boolean;
    onChangePlayersNearYouCollapsed: (collapsed: boolean) => void;
    playersNearYouMode: PlayersNearYouMode;
    onChangePlayersNearYouMode: (mode: PlayersNearYouMode) => void;
    friendFeedCardAction: ActivityCardAction;
    onCycleFriendFeedCardAction: () => void | Promise<void>;
};

const FILTER_OPTIONS: { value: NowPlayingCompareFilter; labelKey: string }[] = [
    { value: "all", labelKey: "All" },
    { value: "onlyYou", labelKey: "Gains" },
    { value: "onlyThem", labelKey: "Losses" },
    { value: "shared", labelKey: "Shared" }
];

function FilterChip(props: {
    label: string;
    active: boolean;
    onClick: () => void;
    focusKey: string;
    wrapperStyle?: CSSProperties;
}) {
    return (
        <div data-focus-key={props.focusKey} style={{ display: "flex", ...props.wrapperStyle }}>
            <DialogButton
                onClick={props.onClick}
                style={{
                    width: "100%",
                    minWidth: 0,
                    padding: "4px 14px",
                    fontSize: "13px",
                    fontWeight: props.active ? 800 : 600,
                    opacity: props.active ? 1 : 0.7,
                    outline: props.active ? "1px solid rgba(255,255,255,0.65)" : undefined,
                    textAlign: "center"
                }}
            >
                {props.label}
            </DialogButton>
        </div>
    );
}

export function NowPlayingTabBody(props: NowPlayingTabBodyProps) {
    const {
        language,
        uiSize,
        achievementStyle,
        activityEvents,
        friendsByUsername,
        currentPayload,
        showIcons,
        blockPadding,
        dynamicActivityFeed,
        dynamicCompare,
        compareFriendUsername,
        compareFriendRow,
        compareFilter,
        compareLoading,
        compareError,
        comparePayload,
        subView,
        onOpenComparePicker,
        comparePickerEntryToken = 0,
        onChangeCompareFilter,
        onAchievementClick,
        onActivityClick,
        onRetryCompareData,
        comments,
        commentsLoading,
        commentsLoadingMore,
        commentsError,
        commentsHasMore,
        commentsSort,
        commentsLoaded,
        commentsNeedsSettings,
        commentsCardClaim,
        onSpendCommentsCardClaim,
        commentsPostClaim,
        onSpendCommentsPostClaim,
        holdCommentsBody,
        commentsWindow,
        onChangeCommentsSort,
        onLoadMoreComments,
        onCommentClick,
        onPostComment,
        dynamicComments,
        dynamicCommentsSentinelRootMargin,
        showRetroPoints,
        playersNearYouItems,
        playersNearYouEnabled,
        playersNearYouCheckedGameId,
        playersNearYouTapMode,
        mouseKeyboardMode,
        controllerGlyphStyle,
        onPlayersNearYouSecondary,
        onPlayersNearYouTertiary,
        onFriendFeedCardSecondary,
        onFriendFeedCardTertiary,
        onPlayersNearYouClick,
        onChangePlayersNearYouTapMode,
        playersNearYouCollapsed,
        onChangePlayersNearYouCollapsed,
        playersNearYouMode,
        onChangePlayersNearYouMode,
        friendFeedCardAction,
        onCycleFriendFeedCardAction
    } = props;

    const dynamicInitialRows = Math.max(1, props.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, props.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(0, props.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, props.dynamicSentinelRootMargin ?? 600)}px 0px`;

    const currentGameId = currentPayload?.gameId ?? null;

    const { isSubscribed, subscribeError, onToggleSubscribe } = useThreadSubscription({
        language,
        kind: "game",
        id: currentGameId,
        buildEntry: () => {
            if (currentGameId == null || !currentPayload) {
                return null;
            }
            const gameTitle = currentPayload.title ?? "";
            return {
                kind: "game",
                id: currentGameId,
                gameId: currentGameId,
                title: gameTitle,
                gameTitle,
                console: currentPayload.consoleName ?? "",
                iconUrl: currentPayload.imageIcon ?? "",
                badgeName: "",
                seedComments: comments,
                seedSort: commentsSort,
                seedLoaded: commentsLoaded
            };
        }
    });
    const commentsEmpty = commentsLoaded && comments.length === 0 && !commentsLoading && !commentsError;

    function handleCommentsSortCycle() {
        if (!commentsLoaded) {
            return;
        }
        onChangeCommentsSort(commentsSort === "newest" ? "oldest" : "newest");
    }

    const friendUsernameForDisplay = (compareFriendRow?.username || compareFriendUsername || "").trim();


    const compareRows = useMemo(() => {
        if (!currentPayload) {
            return [];
        }
        const friendAchievementsById = new Map<number, AchievementRow>();
        const friendPayload = comparePayload?.payload ?? null;
        if (friendPayload) {
            for (const friendAchievement of friendPayload.achievements ?? []) {
                friendAchievementsById.set(friendAchievement.id, friendAchievement);
            }
        }
        const rows = (currentPayload.achievements ?? []).map((mine) => ({
            achievement: mine,
            friendAchievement: friendAchievementsById.get(mine.id) ?? null
        }));
        rows.sort((a, b) => {
            const aOrder = a.achievement.displayOrder;
            const bOrder = b.achievement.displayOrder;
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            return Number(a.achievement.id ?? 0) - Number(b.achievement.id ?? 0);
        });
        return rows;
    }, [currentPayload, comparePayload]);

    const filteredCompareRows = useMemo(() => {
        if (compareFilter === "all") {
            return compareRows;
        }
        if (compareFilter === "shared") {
            return compareRows.filter(({ achievement, friendAchievement }) => {
                return earned(achievement) && Boolean(friendAchievement && earned(friendAchievement));
            });
        }
        if (compareFilter === "onlyYou") {
            return compareRows.filter(({ achievement, friendAchievement }) => {
                return compareBorderFor(achievement, friendAchievement) === "green";
            });
        }
        return compareRows.filter(({ achievement, friendAchievement }) => {
            return compareBorderFor(achievement, friendAchievement) === "red";
        });
    }, [compareFilter, compareRows]);

    const friendHasGameData = Boolean(comparePayload?.payload);

    const comparePayloadIsForSelectedFriend =
        Boolean(comparePayload) &&
        Boolean(compareFriendUsername) &&
        comparePayload!.friendUsername.trim().toLowerCase() ===
            compareFriendUsername!.trim().toLowerCase();

    const [mountedCount, setMountedCount] = useState(() => {
        if (!dynamicCompare) {
            return filteredCompareRows.length;
        }
        return Math.min(dynamicInitialRows, filteredCompareRows.length);
    });
    const [loadMoreMarker, setLoadMoreMarker] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!dynamicCompare) {
            setMountedCount(filteredCompareRows.length);
            return;
        }
        setMountedCount(Math.min(dynamicInitialRows, filteredCompareRows.length));
    }, [
        dynamicCompare,
        currentGameId,
        compareFriendUsername,
        compareFilter,
        dynamicInitialRows,
        filteredCompareRows.length
    ]);

    const loadMoreCompareRows = useCallback(() => {
        if (!dynamicCompare) {
            return;
        }
        setMountedCount((current) => {
            if (current >= filteredCompareRows.length) {
                return current;
            }
            return Math.min(current + dynamicRowStep, filteredCompareRows.length);
        });
    }, [dynamicCompare, dynamicRowStep, filteredCompareRows.length]);

    useEffect(() => {
        if (!dynamicCompare) {
            return;
        }
        if (subView !== "compare") {
            return;
        }
        if (mountedCount >= filteredCompareRows.length) {
            return;
        }
        if (!loadMoreMarker) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadMoreCompareRows();
                }
            },
            { root: null, rootMargin: dynamicSentinelRootMargin, threshold: 0 }
        );
        observer.observe(loadMoreMarker);

        return () => {
            observer.disconnect();
        };
    }, [dynamicCompare, subView, mountedCount, filteredCompareRows.length, dynamicSentinelRootMargin, loadMoreCompareRows, loadMoreMarker]);

    const visibleCompareRows = useMemo(() => {
        if (!dynamicCompare) {
            return filteredCompareRows;
        }
        return filteredCompareRows.slice(0, mountedCount);
    }, [dynamicCompare, filteredCompareRows, mountedCount]);

    function handleCompareRowFocus(index: number) {
        if (!dynamicCompare) {
            return;
        }
        if (index < mountedCount - dynamicPrefetchDistance) {
            return;
        }
        loadMoreCompareRows();
    }

    const compareClickRef = useRef(onAchievementClick);
    compareClickRef.current = onAchievementClick;
    const compareFocusRef = useRef(handleCompareRowFocus);
    compareFocusRef.current = handleCompareRowFocus;

    const compareRowList = useMemo<CompareRowListProps>(() => ({
        language,
        showIcons,
        metrics: achievementUiMetrics(uiSize),
        blockPadding,
        achievementStyle,
        gameId: currentGameId,
        friendUsername: friendUsernameForDisplay,
        friendHasGameData,
        showRetroPoints,
        onAchievementClick: (achievement: AchievementRow) => {
            void compareClickRef.current?.(achievement);
        },
        onRowFocus: (index: number) => {
            compareFocusRef.current(index);
        }
    }), [
        language,
        showIcons,
        uiSize,
        blockPadding,
        achievementStyle,
        currentGameId,
        friendUsernameForDisplay,
        friendHasGameData,
        showRetroPoints
    ]);

    const [historyEvents, setHistoryEvents] = useState<SocialActivityEvent[]>([]);
    const [historyEventsForGameId, setHistoryEventsForGameId] = useState<number | null>(null);
    const [historyCheckedGameId, setHistoryCheckedGameId] = useState<number | null>(null);
    const historyFetchRunIdRef = useRef(0);

    useEffect(() => {
        if (currentGameId == null) {
            setHistoryEvents([]);
            setHistoryEventsForGameId(null);
            setHistoryCheckedGameId(null);
        }
    }, [currentGameId]);

    useEffect(() => {
        if (subView !== "activity" || currentGameId == null) {
            return;
        }
        if (historyEventsForGameId === currentGameId) {
            return;
        }

        const { isCurrentRun, cleanup } = beginGuardedRun(historyFetchRunIdRef);

        void (async () => {
            try {
                const result = await getNowPlayingActivity(currentGameId);
                if (!isCurrentRun()) {
                    return;
                }
                if (result?.ok) {
                    setHistoryEvents(result.events ?? []);
                    setHistoryEventsForGameId(currentGameId);
                }
                setHistoryCheckedGameId(currentGameId);
            } catch (e) {
                if (isCurrentRun()) {
                    logError("getNowPlayingActivity", e);
                    setHistoryCheckedGameId(currentGameId);
                }
            }
        })();

        return cleanup;
    }, [subView, currentGameId, historyEventsForGameId]);

    const activitySettled = historyCheckedGameId === currentGameId
        && (!playersNearYouEnabled || playersNearYouCheckedGameId === currentGameId);

    const playersNearYouShowRows = playersNearYouMode !== "off" && playersNearYouItems.length > 0;

    const activityEventsForGame = useMemo(() => {
        if (currentGameId == null) {
            return [];
        }
        if (historyEventsForGameId === currentGameId) {
            if (historyEvents.length > ACTIVITY_MAX_ROWS) {
                return historyEvents.slice(0, ACTIVITY_MAX_ROWS);
            }
            return historyEvents;
        }

        const filtered = activityEvents.filter((event) => event.gameId === currentGameId);
        if (filtered.length > ACTIVITY_MAX_ROWS) {
            return filtered.slice(0, ACTIVITY_MAX_ROWS);
        }
        return filtered;
    }, [activityEvents, currentGameId, historyEvents, historyEventsForGameId]);

    const [activityMountedCount, setActivityMountedCount] = useState(() => {
        if (!dynamicActivityFeed) {
            return activityEventsForGame.length;
        }
        return Math.min(dynamicInitialRows, activityEventsForGame.length);
    });
    const [activityLoadMoreMarker, setActivityLoadMoreMarker] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!dynamicActivityFeed) {
            setActivityMountedCount(activityEventsForGame.length);
            return;
        }
        setActivityMountedCount(Math.min(dynamicInitialRows, activityEventsForGame.length));
    }, [dynamicActivityFeed, dynamicInitialRows, currentGameId, activityEventsForGame.length]);

    const loadMoreActivityRows = useCallback(() => {
        if (!dynamicActivityFeed) {
            return;
        }
        setActivityMountedCount((current) => {
            if (current >= activityEventsForGame.length) {
                return current;
            }
            return Math.min(current + dynamicRowStep, activityEventsForGame.length);
        });
    }, [dynamicActivityFeed, dynamicRowStep, activityEventsForGame.length]);

    useEffect(() => {
        if (!dynamicActivityFeed) {
            return;
        }
        if (subView !== "activity") {
            return;
        }
        if (activityMountedCount >= activityEventsForGame.length) {
            return;
        }
        if (!activityLoadMoreMarker) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadMoreActivityRows();
                }
            },
            { root: null, rootMargin: dynamicSentinelRootMargin, threshold: 0 }
        );
        observer.observe(activityLoadMoreMarker);

        return () => {
            observer.disconnect();
        };
    }, [dynamicActivityFeed, dynamicSentinelRootMargin, subView, activityMountedCount, activityEventsForGame.length, loadMoreActivityRows, activityLoadMoreMarker]);

    const visibleActivityEvents = useMemo(() => {
        if (!dynamicActivityFeed) {
            return activityEventsForGame;
        }
        return activityEventsForGame.slice(0, activityMountedCount);
    }, [dynamicActivityFeed, activityEventsForGame, activityMountedCount]);

    function handleActivityRowFocus(index: number) {
        if (!dynamicActivityFeed) {
            return;
        }
        if (index < activityMountedCount - dynamicPrefetchDistance) {
            return;
        }
        loadMoreActivityRows();
    }

    const activityClickRef = useRef(onActivityClick);
    activityClickRef.current = onActivityClick;
    const activityFocusRef = useRef(handleActivityRowFocus);
    activityFocusRef.current = handleActivityRowFocus;

    const activitySecondaryRef = useRef(onFriendFeedCardSecondary);
    activitySecondaryRef.current = onFriendFeedCardSecondary;
    const activityTertiaryRef = useRef(onFriendFeedCardTertiary);
    activityTertiaryRef.current = onFriendFeedCardTertiary;

    const activityRowList = useMemo<NowPlayingActivityListProps>(() => ({
        language,
        showIcons,
        metrics: achievementUiMetrics(uiSize),
        onCardClick: (event: SocialActivityEvent) => {
            void activityClickRef.current?.(event);
        },
        onCardFocus: (index: number) => {
            activityFocusRef.current(index);
        },
        onCardSecondary: mouseKeyboardMode ? undefined : (event: SocialActivityEvent) => {
            void activitySecondaryRef.current?.(event);
        },
        onCardTertiary: mouseKeyboardMode ? undefined : (event: SocialActivityEvent) => {
            void activityTertiaryRef.current?.(event);
        }
    }), [language, showIcons, uiSize, mouseKeyboardMode]);

    useEffect(() => {
        if (subView !== "activity") {
            return;
        }
        if (visibleActivityEvents.length === 0) {
            return;
        }
        const usernames: string[] = [];
        const seen = new Set<string>();
        for (const event of visibleActivityEvents) {
            const raw = String(event.username || "").trim();
            if (!raw) {
                continue;
            }
            const key = raw.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            const friend = friendsByUsername.get(key);
            if (friend && friend.avatarDataUri && !isFriendAvatarStale(friend)) {
                continue;
            }
            usernames.push(raw);
        }
        if (usernames.length === 0) {
            return;
        }
        void (async () => {
            try {
                await prefetchUserAvatars(usernames);
            }
            catch (e) {
                logError("NowPlayingTabBody activity prefetchUserAvatars", e);
            }
        })();
    }, [subView, visibleActivityEvents, friendsByUsername]);

    useEffect(() => {
        if (subView !== "activity" || !playersNearYouEnabled) {
            return;
        }
        if (playersNearYouItems.length === 0) {
            return;
        }
        const usernames: string[] = [];
        const seen = new Set<string>();
        for (const item of playersNearYouItems) {
            const raw = String(item.user || "").trim();
            if (!raw) {
                continue;
            }
            const key = raw.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            const friend = friendsByUsername.get(key);
            if (friend && friend.avatarDataUri && !isFriendAvatarStale(friend)) {
                continue;
            }
            usernames.push(raw);
        }
        if (usernames.length === 0) {
            return;
        }
        void (async () => {
            try {
                await prefetchUserAvatars(usernames);
            }
            catch (e) {
                logError("NowPlayingTabBody players near you prefetchUserAvatars", e);
            }
        })();
    }, [subView, playersNearYouEnabled, playersNearYouItems, friendsByUsername]);

    return (
        <>
            {subView === "activity" ? (
                <>
                    {activitySettled && (
                    <>
                    {playersNearYouEnabled && (
                        <PanelSection title={t(language, "Players Near You")}>
                            <PanelSectionRow>
                                <div
                                    data-focus-key="nowplaying:pny:collapse"
                                    style={{ display: "flex", width: "100%", marginTop: "8px" }}
                                >
                                    <DialogButton
                                        onClick={() => onChangePlayersNearYouCollapsed(!playersNearYouCollapsed)}
                                        style={{
                                            minWidth: 0,
                                            minHeight: 0,
                                            width: "100%",
                                            height: "16px",
                                            padding: "0",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center"
                                        }}
                                    >
                                        <CollapseChevron collapsed={playersNearYouCollapsed} />
                                    </DialogButton>
                                </div>
                            </PanelSectionRow>
                            {!playersNearYouCollapsed && (
                                <>
                                    <LabeledRow
                                        label={t(language, "Playstyle")}
                                        value={playersNearYouModeLabel(playersNearYouMode, language)}
                                        onClick={() => onChangePlayersNearYouMode(nextPlayersNearYouMode(playersNearYouMode))}
                                        focusKey="nowplaying:pny:style"
                                        bottomSeparator="none"
                                    />
                                    <PanelSectionRow>
                                        <div
                                            style={{
                                                ...bodyTextStyle(),
                                                paddingBottom: playersNearYouShowRows ? `${textSize(6)}px` : undefined
                                            }}
                                        >
                                            {playersNearYouModeHelp(playersNearYouMode, language)}
                                        </div>
                                    </PanelSectionRow>
                                    {playersNearYouShowRows && (
                                        mouseKeyboardMode ? (
                                            <LabeledRow
                                                label={t(language, "Click")}
                                                value={playersNearYouTapModeLabel(playersNearYouTapMode, language)}
                                                onClick={() => onChangePlayersNearYouTapMode(nextPlayersNearYouTapMode(playersNearYouTapMode))}
                                                focusKey="nowplaying:pny:tapmode"
                                            />
                                        ) : (
                                            <PanelSectionRow>
                                                <ButtonHints
                                                    style={controllerGlyphStyle}
                                                    hints={[
                                                        { button: "a", label: t(language, "Achievement") },
                                                        { button: "x", label: t(language, "Game") },
                                                        { button: "y", label: t(language, "Profile") }
                                                    ]}
                                                />
                                            </PanelSectionRow>
                                        )
                                    )}
                                    {playersNearYouShowRows && playersNearYouItems.map((item) => (
                                        <PlayersNearYouRow
                                            key={item.id}
                                            item={item}
                                            uiSize={uiSize}
                                            showIcons={showIcons}
                                            language={language}
                                            focusKey={`nowplaying:pny:${item.id}`}
                                            onClick={onPlayersNearYouClick}
                                            onSecondary={mouseKeyboardMode ? undefined : onPlayersNearYouSecondary}
                                            onTertiary={mouseKeyboardMode ? undefined : onPlayersNearYouTertiary}
                                        />
                                    ))}
                                </>
                            )}
                        </PanelSection>
                    )}
                    <PanelSection title={t(language, "Friend Activity")}>
                        {activityEventsForGame.length > 0 && (
                            mouseKeyboardMode ? (
                                <LabeledRow
                                    label={t(language, "Click")}
                                    value={activityCardActionLabel(friendFeedCardAction, language)}
                                    onClick={onCycleFriendFeedCardAction}
                                    focusKey="nowplaying:friendfeed:action"
                                />
                            ) : (
                                <PanelSectionRow>
                                    <ButtonHints
                                        style={controllerGlyphStyle}
                                        hints={[
                                            { button: "a", label: t(language, "Achievement") },
                                            { button: "x", label: t(language, "Game") },
                                            { button: "y", label: t(language, "Profile") }
                                        ]}
                                    />
                                </PanelSectionRow>
                            )
                        )}
                        {activityEventsForGame.length === 0 ? (
                            <>
                                <PanelSectionRow>
                                    <div style={bodyTextStyle()}>
                                        {t(language, "No recent activity from friends in this game.")}
                                    </div>
                                </PanelSectionRow>
                                <PanelSectionRow>
                                    <div
                                        data-focus-key="nowplaying:friendfeed:anchor"
                                        style={{ display: "flex", width: "100%" }}
                                    >
                                        <DialogButton
                                            onClick={() => {}}
                                            style={{
                                                minWidth: 0,
                                                minHeight: 0,
                                                width: "100%",
                                                height: "2px",
                                                padding: "0"
                                            }}
                                        />
                                    </div>
                                </PanelSectionRow>
                            </>
                        ) : (
                            <>
                                {visibleActivityEvents.map((event, index) => (
                                    <NowPlayingActivityCard
                                        key={event.id}
                                        event={event}
                                        focusKey={`nowplaying:activity:${event.id}`}
                                        index={index}
                                        list={activityRowList}
                                    />
                                ))}
                                {dynamicActivityFeed && activityMountedCount < activityEventsForGame.length && (
                                    <div
                                        ref={setActivityLoadMoreMarker}
                                        style={{ width: "100%", height: "1px", opacity: 0 }}
                                    />
                                )}
                            </>
                        )}
                    </PanelSection>
                    </>
                    )}
                </>
            ) : subView === "comments" ? (
                <PanelSection title={t(language, "Comments")}>
                    {commentsNeedsSettings ? (
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                {t(language, "Please enter your RetroAchievements username and Web API key.")}
                            </div>
                        </PanelSectionRow>
                    ) : currentPayload?.gameId == null ? (
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>{t(language, "No current game loaded.")}</div>
                        </PanelSectionRow>
                    ) : holdCommentsBody && !commentsLoaded ? (
                        <PanelSectionRow>
                            <InlineSpinner label={t(language, "Loading comments...")} />
                        </PanelSectionRow>
                    ) : commentsEmpty ? (
                        <>
                            <PanelSectionRow>
                                <div style={bodyTextStyle()}>
                                    {t(language, "No comments yet for this game.")}
                                </div>
                            </PanelSectionRow>
                            {subscribeError ? (
                                <PanelSectionRow>
                                    <ErrorText>{localizeRuntimeText(language, subscribeError)}</ErrorText>
                                </PanelSectionRow>
                            ) : null}
                            <FocusClaim
                                token={commentsPostClaim?.token ?? 0}
                                armed={commentsPostClaim?.armed ?? false}
                                onSpent={onSpendCommentsPostClaim}
                            >
                                <CommentActionStrip
                                    language={language}
                                    isSubscribed={isSubscribed}
                                    onPost={onPostComment}
                                    onToggleSubscribe={onToggleSubscribe}
                                    postFocusKey="nowplaying:comments:post"
                                    subscribeFocusKey="nowplaying:comments:subscribe"
                                />
                            </FocusClaim>
                        </>
                    ) : (
                        <>
                            {subscribeError ? (
                                <PanelSectionRow>
                                    <ErrorText>{localizeRuntimeText(language, subscribeError)}</ErrorText>
                                </PanelSectionRow>
                            ) : null}
                            {
}
                            <FocusClaim
                                token={commentsPostClaim?.token ?? 0}
                                armed={commentsPostClaim?.armed ?? false}
                                onSpent={onSpendCommentsPostClaim}
                            >
                                <CommentActionStrip
                                    language={language}
                                    isSubscribed={isSubscribed}
                                    onPost={onPostComment}
                                    onToggleSubscribe={onToggleSubscribe}
                                    postFocusKey="nowplaying:comments:post"
                                    subscribeFocusKey="nowplaying:comments:subscribe"
                                    topMargin={COMMENTS_STRIP_TOP_MARGIN}
                                />
                            </FocusClaim>
                            <LabeledRow
                                focusKey="nowplaying:comments:sort"
                                onClick={handleCommentsSortCycle}
                                label={t(language, "Sort")}
                                value={commentsSort === "newest"
                                    ? t(language, "Newest")
                                    : t(language, "Oldest")}
                            />
                            <CommentsList
                                comments={comments}
                                language={language}
                                uiSize={uiSize}
                                showIcons={showIcons}
                                focusKeyPrefix="nowplaying:comment"
                                surfaceKey="comments:nowplaying"
                                onCommentClick={onCommentClick}
                                dynamicLoading={dynamicComments}
                                dynamicSentinelRootMargin={dynamicCommentsSentinelRootMargin}
                                loading={commentsLoading}
                                loadingMore={commentsLoadingMore}
                                hasMore={commentsHasMore}
                                error={commentsError}
                                onLoadMore={onLoadMoreComments}
                                emptyMessage={t(language, "No comments yet for this game.")}
                                claimedCard={commentsCardClaim && {
                                    ...commentsCardClaim,
                                    onSpent: onSpendCommentsCardClaim
                                }}
                                restoredWindow={commentsWindow}
                            />
                        </>
                    )}
                </PanelSection>
            ) : (
                <PanelSection title={t(language, "Compare Stats")}>
                    <Focusable
                        key={`compare-picker:${comparePickerEntryToken}`}
                        autoFocus={comparePickerEntryToken > 0 || undefined}
                    >
                        <PanelSectionRow>
                            <FocusableItem
                                focusKey="nowplaying:compare-picker"
                                onClick={onOpenComparePicker}
                            >
                                <div
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                        padding: "4px 0",
                                        minWidth: 0
                                    }}
                                >
                                    {compareFriendRow ? (
                                        <>
                                            <UserAvatar
                                                username={compareFriendRow.username}
                                                size={40}
                                                fontSize={16}
                                                wrapperStyle={{
                                                    borderRadius: "10px",
                                                    background: "rgba(255,255,255,0.08)",
                                                    border: "none"
                                                }}
                                                letterStyle={{ fontWeight: 800, fontSize: "16px" }}
                                            />
                                            <div
                                                style={{
                                                    flex: 1,
                                                    minWidth: 0,
                                                    fontWeight: 700,
                                                    wordBreak: "break-word"
                                                }}
                                            >
                                                {compareFriendRow.username}
                                            </div>
                                        </>
                                    ) : compareFriendUsername ? (
                                        <div
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                fontWeight: 700,
                                                wordBreak: "break-word"
                                            }}
                                        >
                                            {compareFriendUsername}
                                        </div>
                                    ) : (
                                        <div
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                fontWeight: 700,
                                                opacity: 0.85
                                            }}
                                        >
                                            {t(language, "Select a friend to compare")}
                                        </div>
                                    )}
                                    <div
                                        style={{
                                            ...smallTextStyle(),
                                            flexShrink: 0,
                                            opacity: 0.7,
                                            paddingRight: "4px"
                                        }}
                                    >
                                        ›
                                    </div>
                                </div>
                            </FocusableItem>
                        </PanelSectionRow>
                    </Focusable>
                    {compareFriendUsername && (
                        <>
                            {!compareLoading && (
                                <CompareHeader
                                    language={language}
                                    uiSize={uiSize}
                                    friend={compareFriendRow}
                                    friendUsername={friendUsernameForDisplay}
                                    currentPayload={currentPayload}
                                    comparePayload={comparePayload}
                                />
                            )}
                            {!compareLoading && (
                                <>
                                    <Focusable
                                        flow-children="row"
                                        style={{
                                            width: "100%",
                                            display: "flex",
                                            padding: "4px 0 0 0"
                                        }}
                                    >
                                        <FilterChip
                                            label={t(language, FILTER_OPTIONS[0].labelKey)}
                                            active={compareFilter === FILTER_OPTIONS[0].value}
                                            onClick={() => onChangeCompareFilter(FILTER_OPTIONS[0].value)}
                                            focusKey={`nowplaying:filter:${FILTER_OPTIONS[0].value}`}
                                            wrapperStyle={{ flexBasis: "100%" }}
                                        />
                                    </Focusable>
                                    <Focusable
                                        flow-children="row"
                                        style={{
                                            width: "100%",
                                            display: "flex",
                                            gap: "6px",
                                            padding: "6px 0 6px 0"
                                        }}
                                    >
                                        {FILTER_OPTIONS.slice(1).map((option) => (
                                            <FilterChip
                                                key={option.value}
                                                label={t(language, option.labelKey)}
                                                active={compareFilter === option.value}
                                                onClick={() => onChangeCompareFilter(option.value)}
                                                focusKey={`nowplaying:filter:${option.value}`}
                                                wrapperStyle={{ flex: "1 1 0", minWidth: 0 }}
                                            />
                                        ))}
                                    </Focusable>
                                </>
                            )}
                            {compareError && (
                                <PanelSectionRow>
                                    <ErrorText>{localizeRuntimeText(language, compareError)}</ErrorText>
                                </PanelSectionRow>
                            )}
                            {compareLoading ? (
                                <PanelSectionRow>
                                    <div
                                        style={{
                                            width: "100%",
                                            display: "flex",
                                            justifyContent: "center",
                                            padding: "14px 0"
                                        }}
                                    >
                                        <InlineSpinner
                                            label={t(language, "Loading comparison...")}
                                            size={18}
                                        />
                                    </div>
                                </PanelSectionRow>
                            ) : compareError && !comparePayloadIsForSelectedFriend ? (
                                <PanelSectionRow>
                                    <FocusableItem
                                        focusKey="nowplaying:retry"
                                        onClick={onRetryCompareData}
                                    >
                                        <div style={{ textAlign: "center", fontWeight: 700 }}>
                                            {t(language, "Retry")}
                                        </div>
                                    </FocusableItem>
                                </PanelSectionRow>
                            ) : !currentPayload ? (
                                <PanelSectionRow>
                                    <div style={bodyTextStyle()}>{t(language, "No current game loaded.")}</div>
                                </PanelSectionRow>
                            ) : filteredCompareRows.length === 0 ? (
                                <PanelSectionRow>
                                    <div style={bodyTextStyle()}>{t(language, "Nothing here yet.")}</div>
                                </PanelSectionRow>
                            ) : (
                                <>
                                    <style>{POINTS_LABEL_STYLES}</style>
                                    {visibleCompareRows.map(({ achievement, friendAchievement }, index) => (
                                        <CompareAchievementRow
                                            key={`compare:${achievement.id}`}
                                            yourAchievement={achievement}
                                            friendAchievement={friendAchievement}
                                            index={index}
                                            list={compareRowList}
                                        />
                                    ))}
                                    {dynamicCompare && mountedCount < filteredCompareRows.length && (
                                        <div
                                            ref={setLoadMoreMarker}
                                            style={{ width: "100%", height: "1px", opacity: 0 }}
                                        />
                                    )}
                                </>
                            )}
                        </>
                    )}
                </PanelSection>
            )}
        </>
    );
}
