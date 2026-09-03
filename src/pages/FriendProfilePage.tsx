import React, { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaHistory } from "react-icons/fa";
import {
    getCachedGameIconDataUri,
    getCachedGameImageDataUri,
    getGameIconCached,
    getGameImageCached,
    prefetchGameIcons,
    logSortDebug
} from "../api";
import type { LanguageCode } from "../locales";
import { AchievementList } from "../components/achievements/AchievementList";
import { AwardStatusBadge } from "../components/achievements/AwardStatusBadge";
import { CommentsList } from "../components/comments/CommentsList";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { ErrorText } from "../components/ui/ErrorText";
import { FadeImage } from "../components/ui/FadeImage";
import { BackButton } from "../components/ui/BackButton";
import { FocusClaim } from "../components/ui/FocusClaim";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { FocusableItem } from "../components/ui/FocusableItem";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ProfileMotto } from "../components/social/ProfileMotto";
import { ToggleRow } from "../components/ui/ToggleRow";
import { SetMosaicBanner, type SetMosaicEntry } from "../components/mastery/SetMosaicBanner";
import { SubTabIconButton, subTabIcon, type SubTabIconKind } from "../components/ui/SubTabIconButton";
import type {
    AchievementRow,
    AchievementSort,
    AchievementStyle,
    AotwComment,
    ButtonSpacing,
    FriendAchievementFilter,
    FriendGamePayload,
    FriendProfileSubView,
    FriendRecentGame,
    FriendRow,
    GameComment,
    UiSize,
    ViewKey
} from "../types";
import type { CommentsSort } from "../hooks/useGameCommentsController";
import type { RestoredCommentsWindow } from "../hooks/useCommentsWindow";

import {
    achievementSortLabel,
    mainAchievementFilterLabel,
    nextAchievementSort,
    nextFriendAchievementFilter,
    payloadAchievementSummaryLabel
} from "../utils/achievements";
import { UserAvatar } from "../components/ui/UserAvatar";
import { smallTextStyle, bodyTextStyle, regularButtonSpacingStyle, FADE_IN_KEYFRAMES } from "../utils/style";
import { headerSize } from "../utils/scale";
import { consoleInlineName } from "../utils/consoles";
import { localizeRuntimeText, t } from "../locales";
import { formatRatio, formatInteger, formatMemberSince } from "../utils/format";
import { loadCachedImage } from "../utils/loadCachedImage";


type FriendQuickActionId = "history" | "leaderboards" | "compare";

type FriendQuickAction = {
    id: FriendQuickActionId;
    Icon: ComponentType<{ size?: number }>;
    labelKey: string;
    focusKey: string;
};

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function ChevronRightIcon({ size = 16 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width={size}
            height={size}
            focusable="false"
        >
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
            />
        </svg>
    );
}

function BalanceScaleIcon({ size = 18 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 640 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M384 32H512c17.7 0 32 14.3 32 32s-14.3 32-32 32H398.4c-5.2 25.8-22.9 47.1-46.4 57.3V448H512c17.7 0 32 14.3 32 32s-14.3 32-32 32H320 128c-17.7 0-32-14.3-32-32s14.3-32 32-32H288V153.3c-23.5-10.3-41.2-31.6-46.4-57.3H128c-17.7 0-32-14.3-32-32s14.3-32 32-32H256c14.6-19.4 37.8-32 64-32s49.4 12.6 64 32zm55.6 288H584.4L512 195.8 439.6 320zM512 416c-62.9 0-115.2-34-126-78.9c-2.6-11 1-22.3 6.7-32.1l95.2-163.2c5-8.6 14.2-13.8 24.1-13.8s19.1 5.3 24.1 13.8l95.2 163.2c5.7 9.8 9.3 21.1 6.7 32.1C627.2 382 574.9 416 512 416zM126.8 195.8L54.4 320H199.3L126.8 195.8zM.9 337.1c-2.6-11 1-22.3 6.7-32.1l95.2-163.2c5-8.6 14.2-13.8 24.1-13.8s19.1 5.3 24.1 13.8l95.2 163.2c5.7 9.8 9.3 21.1 6.7 32.1C242 382 189.7 416 126.8 416S11.7 382 .9 337.1z"/>
        </svg>
    );
}

function LeaderboardIcon({ size = 18 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M3 10h5v11H3zM9.5 6h5v15h-5zM16 13h5v8h-5z" />
        </svg>
    );
}

const FRIEND_QUICK_ACTIONS: FriendQuickAction[] = [
    { id: "history", Icon: FaHistory, labelKey: "Unlocks", focusKey: "friendquick:tab:history" },
    { id: "leaderboards", Icon: LeaderboardIcon, labelKey: "Leaderboards", focusKey: "friendquick:tab:leaderboards" },
    { id: "compare", Icon: BalanceScaleIcon, labelKey: "Compare", focusKey: "friendquick:tab:compare" }
];


type FriendProfileActionId =
    | "awards"
    | "wanttoplay"
    | "external"
    | "ranking"
    | "trackedsets";

type FriendProfileAction = {
    id: FriendProfileActionId;
    Icon: ComponentType<{ size?: number }>;
    labelKey: string;
    focusKey: string;
    selfOnly: boolean;
};

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function AwardIcon({ size = 18 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 384 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M173.8 5.5c11-7.3 25.4-7.3 36.4 0L228 17.2c6 3.9 13 5.8 20.1 5.4l21.3-1.3c13.2-.8 25.6 6.4 31.5 18.2l9.6 19.1c3.2 6.4 8.4 11.5 14.7 14.7L344.5 83c11.8 5.9 19 18.3 18.2 31.5l-1.3 21.3c-.4 7.1 1.5 14.2 5.4 20.1l11.8 17.8c7.3 11 7.3 25.4 0 36.4L366.8 228c-3.9 6-5.8 13-5.4 20.1l1.3 21.3c.8 13.2-6.4 25.6-18.2 31.5l-19.1 9.6c-6.4 3.2-11.5 8.4-14.7 14.7L301 344.5c-5.9 11.8-18.3 19-31.5 18.2l-21.3-1.3c-7.1-.4-14.2 1.5-20.1 5.4l-17.8 11.8c-11 7.3-25.4 7.3-36.4 0L156 366.8c-6-3.9-13-5.8-20.1-5.4l-21.3 1.3c-13.2 .8-25.6-6.4-31.5-18.2l-9.6-19.1c-3.2-6.4-8.4-11.5-14.7-14.7L39.5 301c-11.8-5.9-19-18.3-18.2-31.5l1.3-21.3c.4-7.1-1.5-14.2-5.4-20.1L5.5 210.2c-7.3-11-7.3-25.4 0-36.4L17.2 156c3.9-6 5.8-13 5.4-20.1l-1.3-21.3c-.8-13.2 6.4-25.6 18.2-31.5l19.1-9.6C65 70.2 70.2 65 73.4 58.6L83 39.5c5.9-11.8 18.3-19 31.5-18.2l21.3 1.3c7.1 .4 14.2-1.5 20.1-5.4L173.8 5.5zM272 192a80 80 0 1 0 -160 0 80 80 0 1 0 160 0zM1.3 441.8L44.4 339.3c.2 .1 .3 .2 .4 .4l9.6 19.1c11.7 23.2 36 37.3 62 35.8l21.3-1.3c.2 0 .5 0 .7 .2l17.8 11.8c5.1 3.3 10.5 5.9 16.1 7.7l-37.6 89.3c-2.3 5.5-7.4 9.2-13.3 9.7s-11.6-2.2-14.8-7.2L74.4 455.5l-56.1 8.3c-5.7 .8-11.4-1.5-15-6s-4.3-10.7-2.1-16zm248 60.4L211.7 413c5.6-1.8 11-4.3 16.1-7.7l17.8-11.8c.2-.1 .4-.2 .7-.2l21.3 1.3c26 1.5 50.3-12.6 62-35.8l9.6-19.1c.1-.2 .2-.3 .4-.4l43.2 102.5c2.2 5.3 1.4 11.4-2.1 16s-9.3 6.9-15 6l-56.1-8.3-32.2 49.2c-3.2 5-8.9 7.7-14.8 7.2s-11-4.3-13.3-9.7z"/>
        </svg>
    );
}

function BookmarkIcon({ size = 18 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 384 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M0 48V487.7C0 501.1 10.9 512 24.3 512c5 0 9.9-1.5 14-4.4L192 400 345.7 507.6c4.1 2.9 9 4.4 14 4.4c13.4 0 24.3-10.9 24.3-24.3V48c0-26.5-21.5-48-48-48H48C21.5 0 0 21.5 0 48z"/>
        </svg>
    );
}

function ExternalLinkIcon({ size = 18 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M352 0c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9L370.7 96 201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L416 141.3l41.4 41.4c9.2 9.2 22.9 11.9 34.9 6.9s19.8-16.6 19.8-29.6l0-128c0-17.7-14.3-32-32-32L352 0zM80 32C35.8 32 0 67.8 0 112L0 432c0 44.2 35.8 80 80 80l320 0c44.2 0 80-35.8 80-80l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 112c0 8.8-7.2 16-16 16L80 448c-8.8 0-16-7.2-16-16l0-320c0-8.8 7.2-16 16-16l112 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 32z"/>
        </svg>
    );
}

function OrderedListIcon({ size = 18 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M24 56c0-13.3 10.7-24 24-24l32 0c13.3 0 24 10.7 24 24l0 120 16 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-80 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l16 0 0-96-8 0C34.7 80 24 69.3 24 56zM86.7 341.2c-6.5-7.4-18.3-6.9-24 1.2L51.5 357.9c-7.7 10.8-22.7 13.3-33.5 5.6s-13.3-22.7-5.6-33.5l11.1-15.6c23.7-33.2 72.3-35.6 99.2-4.9c21.3 24.4 20.8 60.9-1.1 84.7L86.8 432l33.2 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-88 0c-9.5 0-18.2-5.6-22-14.4s-2.1-18.9 4.3-25.9l72-78c5.3-5.8 5.4-14.6 .3-20.5zM224 64l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32zm0 160l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32zm0 160l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32z"/>
        </svg>
    );
}

function LayerGroupIcon({ size = 18 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M264.5 5.2c14.9-6.9 32.1-6.9 47 0l218.6 101c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 149.8C37.4 145.8 32 137.3 32 128s5.4-17.9 13.9-21.8L264.5 5.2zM476.9 209.6l53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 277.8C37.4 273.8 32 265.3 32 256s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0l152-70.2zm-152 198.2l152-70.2 53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 405.8C37.4 401.8 32 393.3 32 384s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0z"/>
        </svg>
    );
}

const FRIEND_PROFILE_ACTIONS: FriendProfileAction[] = [
    { id: "awards", Icon: AwardIcon, labelKey: "Awards", focusKey: "friendprofile:tab:awards", selfOnly: false },
    { id: "wanttoplay", Icon: BookmarkIcon, labelKey: "Want to Play", focusKey: "friendprofile:tab:wanttoplay", selfOnly: false },
    { id: "external", Icon: ExternalLinkIcon, labelKey: "External Profile", focusKey: "friendprofile:tab:external", selfOnly: false },
    { id: "ranking", Icon: OrderedListIcon, labelKey: "Ranking", focusKey: "friendprofile:tab:ranking", selfOnly: true },
    { id: "trackedsets", Icon: LayerGroupIcon, labelKey: "Mastery Goals", focusKey: "friendprofile:tab:trackedsets", selfOnly: true }
];


function pickGamesForMosaic(games: FriendRecentGame[]): SetMosaicEntry[] {
    if (games.length === 0) {
        return [];
    }
    const pool = games.slice();
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const swap = pool[i];
        pool[i] = pool[j];
        pool[j] = swap;
    }
    const tileCount = pool.length < 4 ? 1 : 4;
    return pool.slice(0, tileCount).map((game) => ({
        gameId: game.gameId,
        imageIcon: game.imageIcon ?? null
    }));
}


const FRIEND_PROFILE_SUB_TABS: { value: FriendProfileSubView; focusKey: string; icon: SubTabIconKind }[] = [
    { value: "game", focusKey: "friendprofile:subtab:game", icon: "trophy" },
    { value: "wall", focusKey: "friendprofile:subtab:wall", icon: "wall" }
];

type FriendProfilePageProps = {
    state: {
        view: ViewKey;
        language: LanguageCode;
        focusScopeResetToken: number;
        friendGamePayload: FriendGamePayload | null;
        selectedFriend: FriendRow | null;
        buttonSpacing: ButtonSpacing;
        recentGamesExpanded: boolean;
        friendGameError: string | null;
        friendGameLoading: boolean;
        friendAllGamesLoading: boolean;
        wantToPlayLoading: boolean;
        wantToPlayError: string | null;
        showIcons: boolean;
        achievementStyle: AchievementStyle;
        uiSize: UiSize;
        topPadding: number;
        blockPadding: number;
        dynamicLoading: boolean;
        dynamicInitialRows: number;
        dynamicRowStep: number;
        dynamicPrefetchDistance: number;
        dynamicSentinelRootMargin: number;
        listResetToken: number;
        friendAchievementFilter: FriendAchievementFilter;
        friendAchievementSort: AchievementSort;
        friendShowAllAchievements: boolean;
        showAllToggleFriend: boolean;
        showRetroPoints: boolean;
        backToMain: boolean;
        friendProfileSubView: FriendProfileSubView;
        wallComments: GameComment[];
        wallCommentsLoading: boolean;
        wallCommentsLoadingMore: boolean;
        wallCommentsHasMore: boolean;
        wallCommentsSort: CommentsSort;
        wallCommentsLoaded: boolean;
        wallRestricted: boolean;
        wallCommentsCardClaim?: {
            slotIndex: number;
            token: number;
            armed: boolean;
        };
        wallCommentsPostClaim?: {
            token: number;
            armed: boolean;
        };
        panelOverlayVisible: boolean;
        wallRestorePending: boolean;
        wallHoldCommentsBody: boolean;
        wallCommentsWindow: RestoredCommentsWindow | null;
        dynamicComments: boolean;
        dynamicCommentsSentinelRootMargin: number;
    };
    actions: {
        onBack: () => void | Promise<void>;
        onOpenExternalProfile: () => void | Promise<void>;
        onOpenBadges: () => void | Promise<void>;
        onOpenAllGames: () => void | Promise<void>;
        onOpenWantToPlay: () => void | Promise<void>;
        onOpenFollowedRanking: () => void | Promise<void>;
        onOpenTrackedSets: () => void | Promise<void>;
        onToggleRecentGames: () => void | Promise<void>;
        onPickRecentGame: (gameId: number) => void | Promise<void>;
        onOpenAchievement: (achievement: AchievementRow) => void | Promise<void>;
        onOpenLeaderboards: () => void | Promise<void>;
        onOpenUnlockHistory: () => void | Promise<void>;
        onOpenCompare: () => void | Promise<void>;
        onOpenGameOnRetroAchievements: () => void | Promise<void>;
        onFriendAchievementFilterChange: (nextValue: FriendAchievementFilter) => void | Promise<void>;
        onFriendAchievementSortChange: (nextValue: AchievementSort) => void | Promise<void>;
        onFriendShowAllAchievementsChange: (nextValue: boolean) => void | Promise<void>;
        onChangeSubView: (next: FriendProfileSubView) => void | Promise<void>;
        onChangeWallCommentsSort: (next: CommentsSort) => void | Promise<void>;
        onLoadMoreWallComments: () => void | Promise<void>;
        onSpendWallCommentsCardClaim: () => void;
        onSpendWallCommentsPostClaim: () => void;
        onWallCommentClick: (comment: AotwComment | GameComment) => void | Promise<void>;
        onPostComment: () => void | Promise<void>;
        onHome: () => void | Promise<void>;
    };
};

function FriendProfilePage(props: FriendProfilePageProps) {
    const { state, actions } = props;
    const {
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
        backToMain,
        friendProfileSubView: subView,
        wallComments,
        wallCommentsLoading,
        wallCommentsLoadingMore,
        wallCommentsHasMore,
        wallCommentsSort,
        wallCommentsLoaded,
        wallRestricted,
        wallCommentsCardClaim,
        wallCommentsPostClaim,
        panelOverlayVisible,
        wallRestorePending,
        wallHoldCommentsBody,
        wallCommentsWindow,
        dynamicComments,
        dynamicCommentsSentinelRootMargin,
    } = state;

    const selectedFriendPoints = Number(friendGamePayload?.points ?? selectedFriend?.points ?? 0);
    const selectedFriendTruePoints = Number(friendGamePayload?.totalTruePoints ?? selectedFriend?.totalTruePoints ?? 0);
    const selectedFriendSoftcorePoints = Number(friendGamePayload?.pointsSoftcore ?? selectedFriend?.pointsSoftcore ?? 0);

    const friendDisplayName = (friendGamePayload?.friendUsername || selectedFriend?.username || "").trim();

    const memberSinceLabel = formatMemberSince(friendGamePayload?.memberSince, language);
    const mottoText = String(friendGamePayload?.motto || "").trim();

    const wallIsEmpty = wallCommentsLoaded && !wallRestricted && !wallCommentsLoading && wallComments.length === 0;

    function handleFilterClick() {
        void actions.onFriendAchievementFilterChange(nextFriendAchievementFilter(friendAchievementFilter));
    }

    function handleSortClick() {
        const next = nextAchievementSort(friendAchievementSort);
        logSortDebug("press", "friend", `from=${friendAchievementSort} to=${next}`);
        void actions.onFriendAchievementSortChange(next);
    }

    function handleWallSortClick() {
        if (!wallCommentsLoaded) {
            return;
        }
        void actions.onChangeWallCommentsSort(wallCommentsSort === "newest" ? "oldest" : "newest");
    }

    function handleShowAllToggle(nextValue: boolean) {
        void actions.onFriendShowAllAchievementsChange(nextValue);
    }

    const [focusedQuickAction, setFocusedQuickAction] = useState<FriendQuickActionId | null>(null);
    const [hoveredQuickAction, setHoveredQuickAction] = useState<FriendQuickActionId | null>(null);

    function handleQuickActionClick(id: FriendQuickActionId) {
        if (id === "history") {
            void actions.onOpenUnlockHistory();
            return;
        }
        if (id === "leaderboards") {
            void actions.onOpenLeaderboards();
            return;
        }
        if (id === "compare") {
            void actions.onOpenCompare();
            return;
        }
    }

    function handleQuickActionFocus(id: FriendQuickActionId) {
        setFocusedQuickAction(id);
    }

    function handleQuickActionBlur(id: FriendQuickActionId) {
        setFocusedQuickAction((current) => {
            if (current !== id) {
                return current;
            }
            return null;
        });
    }

    function handleQuickActionHover(id: FriendQuickActionId) {
        if (friendGameLoading) {
            return;
        }

        setHoveredQuickAction(id);
    }

    function handleQuickActionUnhover(id: FriendQuickActionId) {
        setHoveredQuickAction((current) => current === id ? null : current);
    }

    useEffect(() => {
        if (view === "friendGame") {
            setFocusedQuickAction(null);
        }
    }, [view]);

    const [focusedProfileAction, setFocusedProfileAction] = useState<FriendProfileActionId | null>(null);
    const [hoveredProfileAction, setHoveredProfileAction] = useState<FriendProfileActionId | null>(null);

    function handleProfileActionClick(id: FriendProfileActionId) {
        if (id === "awards") {
            void actions.onOpenBadges();
            return;
        }
        if (id === "wanttoplay") {
            void actions.onOpenWantToPlay();
            return;
        }
        if (id === "external") {
            void actions.onOpenExternalProfile();
            return;
        }
        if (id === "ranking") {
            void actions.onOpenFollowedRanking();
            return;
        }
        if (id === "trackedsets") {
            void actions.onOpenTrackedSets();
            return;
        }
    }

    function handleProfileActionFocus(id: FriendProfileActionId) {
        setFocusedProfileAction(id);
    }

    function handleProfileActionBlur(id: FriendProfileActionId) {
        setFocusedProfileAction((current) => {
            if (current !== id) {
                return current;
            }
            return null;
        });
    }

    function handleProfileActionHover(id: FriendProfileActionId, disabled: boolean) {
        if (disabled) {
            return;
        }

        setHoveredProfileAction(id);
    }

    function handleProfileActionUnhover(id: FriendProfileActionId) {
        setHoveredProfileAction((current) => current === id ? null : current);
    }

    useEffect(() => {
        if (view === "friendGame") {
            setFocusedProfileAction(null);
        }
    }, [view]);

    const recentGames = friendGamePayload?.recentGames ?? [];
    const recentGamesKey = recentGames.map((game) => game.gameId).join(",");

    const gamesMosaicEntries = useMemo(() => {
        if (!showIcons) {
            return [];
        }
        return pickGamesForMosaic(recentGames);
    }, [showIcons, selectedFriend?.username, recentGamesKey]);

    const recentSelectedGameId = friendGamePayload?.selectedGameId ?? friendGamePayload?.payload?.gameId ?? null;
    const recentSelectedGameIcon =
        friendGamePayload?.payload?.imageIcon ??
        recentGames.find((game) => game.gameId === recentSelectedGameId)?.imageIcon ??
        null;
    const recentGameEntries = useMemo<SetMosaicEntry[]>(() => {
        if (!showIcons || recentSelectedGameId == null) {
            return [];
        }
        return [{ gameId: recentSelectedGameId, imageIcon: recentSelectedGameIcon }];
    }, [showIcons, recentSelectedGameId, recentSelectedGameIcon]);

    const recentRowEntries = useMemo<SetMosaicEntry[]>(() => {
        if (!showIcons) {
            return [];
        }
        return recentGames.map((game) => ({ gameId: game.gameId, imageIcon: game.imageIcon ?? null }));
    }, [showIcons, recentGamesKey]);

    useEffect(() => {
        if (view !== "friendGame") {
            return;
        }
        const entries = [...gamesMosaicEntries, ...recentGameEntries];
        if (recentGamesExpanded) {
            entries.push(...recentRowEntries);
        }
        if (entries.length === 0) {
            return;
        }
        void prefetchGameIcons(entries);
    }, [view, gamesMosaicEntries, recentGameEntries, recentRowEntries, recentGamesExpanded]);

    const friendGameId = friendGamePayload?.payload?.gameId ?? null;
    const friendImageIcon = friendGamePayload?.payload?.imageIcon ?? null;
    const friendImageIngame = friendGamePayload?.payload?.imageIngame ?? null;
    const [friendGameIconDataUri, setFriendGameIconDataUri] = useState<string | null>(null);
    const [friendGameIngameDataUri, setFriendGameIngameDataUri] = useState<string | null>(null);
    const friendGameIconColdRef = useRef(false);
    const friendGameIngameColdRef = useRef(false);

    useEffect(() => {
        setFriendGameIconDataUri(null);
        setFriendGameIngameDataUri(null);
    }, [selectedFriend?.username]);

    useEffect(() => {
        if (!showIcons || !friendGameId) {
            setFriendGameIconDataUri(null);
            return;
        }
        if (friendGameLoading) {
            return;
        }
        return loadCachedImage(
            () => getCachedGameIconDataUri(friendGameId),
            () => getGameIconCached(friendGameId, friendImageIcon),
            (dataUri, fromFetch) => {
                if (!fromFetch) {
                    friendGameIconColdRef.current = dataUri === null;
                }
                setFriendGameIconDataUri(dataUri);
            },
            null
        );
    }, [friendGameId, friendImageIcon, showIcons, friendGameLoading]);

    useEffect(() => {
        if (!showIcons || !friendGameId) {
            setFriendGameIngameDataUri(null);
            return;
        }
        if (friendGameLoading) {
            return;
        }
        return loadCachedImage(
            () => getCachedGameImageDataUri(friendGameId, "ingame"),
            () => getGameImageCached(friendGameId, "ingame", friendImageIngame),
            (dataUri, fromFetch) => {
                if (!fromFetch) {
                    friendGameIngameColdRef.current = dataUri === null;
                }
                setFriendGameIngameDataUri(dataUri);
            },
            null
        );
    }, [friendGameId, friendImageIngame, showIcons, friendGameLoading]);

    useEffect(() => {
        if (friendGameIconDataUri) {
            friendGameIconColdRef.current = false;
        }
        if (friendGameIngameDataUri) {
            friendGameIngameColdRef.current = false;
        }
    }, [friendGameIconDataUri, friendGameIngameDataUri]);

    if (view !== "friendGame") {
        return null;
    }

    const wallRestoreClaim = wallCommentsCardClaim ?? wallCommentsPostClaim;
    const restoreCurtainArmed = wallRestorePending;
    const restoreCurtainSettled = !wallHoldCommentsBody
        && (wallRestoreClaim?.token ?? 0) > 0
        && !wallRestoreClaim?.armed;

    const page = (
        <React.Fragment key={`friendgame:${friendGamePayload?.selectedGameId ?? "none"}:${focusScopeResetToken}`}>
            <style>{FADE_IN_KEYFRAMES}</style>
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Profile")}
                    buttonSpacing={buttonSpacing}
                    onHome={actions.onHome}
                />
                <BackButton
                    label={t(language, backToMain ? "← Back to Main" : "← Back to Social")}
                    focusKey="friendgame:back"
                    navAutoFocus={!wallRestorePending}
                    buttonSpacing={buttonSpacing}
                    onClick={actions.onBack}
                />
                {selectedFriend && (
                    <PanelSectionRow>
                        <div
                            style={{
                                width: "100%",
                                display: "flex",
                                gap: "10px",
                                alignItems: "flex-start",
                                justifyContent: "flex-start",
                                marginTop: "6px"
                            }}
                        >
                            <UserAvatar
                                username={selectedFriend.username}
                                size={56}
                                fontSize={21}
                                wrapperStyle={{
                                    borderRadius: "10px",
                                    background: "rgba(255,255,255,0.08)",
                                    border: "none"
                                }}
                                letterStyle={{ fontWeight: 700, fontSize: "21px" }}
                            />
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                                <div style={{ fontWeight: 700 }}>
                                    {friendDisplayName}
                                    {selectedFriend.isSelf ? t(language, " (You)") : ""}
                                </div>
                                {memberSinceLabel && (
                                    <div style={{ ...bodyTextStyle(), opacity: 0.55 }}>
                                        {t(language, "Member since {{date}}", { date: memberSinceLabel })}
                                    </div>
                                )}
                                <div style={bodyTextStyle()}>
                                    {friendGamePayload?.statusText ||
                                        friendGamePayload?.richPresence ||
                                        selectedFriend.statusText ||
                                        t(language, "No rich presence")}
                                </div>
                            </div>
                        </div>
                    </PanelSectionRow>
                )}
                {friendGameError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, friendGameError)}</ErrorText>
                    </PanelSectionRow>
                )}
                {selectedFriend && (
                    <PanelSectionRow>
                        <div
                            style={{
                                width: "100%",
                                display: "grid",
                                gridTemplateColumns: "1fr auto",
                                rowGap: "6px",
                                columnGap: "10px",
                                alignItems: "center",
                                marginTop: "10px"
                            }}
                        >
                            <div style={bodyTextStyle()}>{t(language, "Hardcore points")}</div>
                            <div style={{ ...bodyTextStyle(), fontWeight: 700 }}>
                                {formatInteger(selectedFriendPoints)}
                            </div>
                            <div style={bodyTextStyle()}>{t(language, "RetroPoints")}</div>
                            <div style={{ ...bodyTextStyle(), fontWeight: 700 }}>
                                {formatInteger(selectedFriendTruePoints)}
                            </div>
                            <div style={bodyTextStyle()}>{t(language, "RetroRatio")}</div>
                            <div style={{ ...bodyTextStyle(), fontWeight: 700 }}>
                                {formatRatio(selectedFriendTruePoints, selectedFriendPoints)}
                            </div>
                            <div style={bodyTextStyle()}>{t(language, "Softcore points")}</div>
                            <div style={{ ...bodyTextStyle(), fontWeight: 700 }}>
                                {formatInteger(selectedFriendSoftcorePoints)}
                            </div>
                        </div>
                    </PanelSectionRow>
                )}
                {
}
                {selectedFriend && mottoText && (
                    <PanelSectionRow>
                        <ProfileMotto text={mottoText} />
                    </PanelSectionRow>
                )}
                {selectedFriend && (
                    <PanelSectionRow>
                        <div
                            style={{
                                width: "100%",
                                marginTop: "4px"
                            }}
                        >
                            <Focusable
                                flow-children="row"
                                style={{
                                    display: "flex",
                                    gap: "12px",
                                    width: "100%",
                                    justifyContent: "flex-start"
                                }}
                            >
                                {FRIEND_PROFILE_ACTIONS.map((action) => {
                                    if (action.selfOnly && !selectedFriend?.isSelf) {
                                        return null;
                                    }

                                    const previewed = (hoveredProfileAction ?? focusedProfileAction) === action.id;
                                    const buttonDisabled =
                                        action.id === "external"
                                            ? false
                                            : friendGameLoading ||
                                              friendAllGamesLoading ||
                                              (action.id === "wanttoplay" && wantToPlayLoading);
                                    const labelText = t(language, action.labelKey);
                                    const Icon = action.Icon;

                                    return (
                                        <div
                                            key={action.focusKey}
                                            data-focus-key={action.focusKey}
                                            onMouseEnter={() => handleProfileActionHover(action.id, buttonDisabled)}
                                            onMouseLeave={() => handleProfileActionUnhover(action.id)}
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                width: "42px"
                                            }}
                                        >
                                            <DialogButton
                                                onClick={() => handleProfileActionClick(action.id)}
                                                onGamepadFocus={() => handleProfileActionFocus(action.id)}
                                                onGamepadBlur={() => handleProfileActionBlur(action.id)}
                                                disabled={buttonDisabled}
                                                style={{
                                                    minWidth: 0,
                                                    width: "42px",
                                                    height: "38px",
                                                    padding: "4px 2px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    opacity: previewed ? 1 : 0.72,
                                                    boxShadow: previewed
                                                        ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                                                        : undefined
                                                }}
                                            >
                                                <Icon size={18} />
                                            </DialogButton>
                                            <div
                                                style={{
                                                    ...smallTextStyle(),
                                                    fontWeight: 700,
                                                    textAlign: "center",
                                                    whiteSpace: "nowrap",
                                                    overflow: "visible",
                                                    marginTop: "1px",
                                                    minHeight: "1em",
                                                    opacity: previewed ? 0.95 : 0
                                                }}
                                            >
                                                {labelText}
                                            </div>
                                        </div>
                                    );
                                })}
                            </Focusable>
                        </div>
                    </PanelSectionRow>
                )}
                {
}
                {wantToPlayError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, wantToPlayError)}</ErrorText>
                    </PanelSectionRow>
                )}
                {
}
                {selectedFriend && (
                    <PanelSectionRow>
                        <FocusableItem
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="friendgame:games"
                            bottomSeparator="none"
                            onClick={actions.onOpenAllGames}
                            disabled={friendGameLoading || friendAllGamesLoading}
                        >
                            <SetMosaicBanner entries={gamesMosaicEntries} mosaicSize={44}>
                                <span style={{ fontWeight: 800 }}>{t(language, "Games")}</span>
                                <span style={bodyTextStyle()}>
                                    {t(language, "Browse completion progress")}
                                </span>
                            </SetMosaicBanner>
                        </FocusableItem>
                    </PanelSectionRow>
                )}
                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                        focusKey="friendgame:selected"
                        bottomSeparator="none"
                        onClick={actions.onToggleRecentGames}
                        disabled={friendGameLoading}
                    >
                        <SetMosaicBanner entries={recentGameEntries} mosaicSize={44}>
                            <span style={{ fontWeight: 800 }}>{t(language, "Recent Games")}</span>
                            <span style={bodyTextStyle()}>
                                {friendGamePayload?.selectedGameTitle || t(language, "Choose")}
                            </span>
                        </SetMosaicBanner>
                    </FocusableItem>
                </PanelSectionRow>
                {recentGamesExpanded &&
                    (friendGamePayload?.recentGames ?? [])
                        .filter((game) => game.gameId !== friendGamePayload?.selectedGameId)
                        .map((game) => {
                        function handlePickRecentGame() {
                            void actions.onPickRecentGame(game.gameId);
                        }

                        return (
                            <FocusableItem
                                key={`friendgame:pick:${game.gameId}`}
                                focusKey={`friendgame:pick:${game.gameId}`}
                                onClick={handlePickRecentGame}
                                disabled={friendGameLoading}
                            >
                                <SetMosaicBanner
                                    entries={showIcons ? [{ gameId: game.gameId, imageIcon: game.imageIcon ?? null }] : []}
                                    mosaicSize={44}
                                >
                                    <span
                                        style={{
                                            fontWeight: 500,
                                            lineHeight: 1.25,
                                            wordBreak: "break-word"
                                        }}
                                    >
                                        {game.title}
                                    </span>
                                    <span style={{ ...bodyTextStyle(), opacity: 0.9 }}>{consoleInlineName(game.consoleName || "")}</span>
                                </SetMosaicBanner>
                            </FocusableItem>
                        );
                    })}
                {friendGameLoading && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, "Loading achievement progress...")}
                        </div>
                    </PanelSectionRow>
                )}
                {
}
                <Focusable
                    flow-children="row"
                    style={{
                        width: "100%",
                        display: "flex",
                        gap: "6px",
                        margin: "6px 0 14px 0"
                    }}
                >
                    {FRIEND_PROFILE_SUB_TABS.map((tab) => (
                        <SubTabIconButton
                            key={tab.value}
                            icon={subTabIcon(tab.icon)}
                            active={subView === tab.value}
                            onClick={() => actions.onChangeSubView(tab.value)}
                            focusKey={tab.focusKey}
                        />
                    ))}
                </Focusable>
            </PanelSection>
            {subView === "game" && friendGamePayload?.payload && (
                <PanelSection
                    title={t(language, "Game Progress")}
                >
                    {(friendGameIconDataUri || friendGameIngameDataUri) && (
                        <PanelSectionRow>
                            <div
                                style={{
                                    width: "100%",
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "flex-start",
                                    gap: "8px",
                                    minWidth: 0
                                }}
                            >
                                {friendGameIconDataUri && (
                                    <FadeImage
                                        src={friendGameIconDataUri}
                                        fadeOnLoad={friendGameIconColdRef.current}
                                        style={{
                                            width: "64px",
                                            height: "64px",
                                            borderRadius: "8px",
                                            objectFit: "cover",
                                            display: "block",
                                            flexShrink: 0
                                        }}
                                    />
                                )}
                                {friendGameIconDataUri && friendGameIngameDataUri && (
                                    <div
                                        style={{
                                            width: "1px",
                                            alignSelf: "stretch",
                                            background: "rgba(255,255,255,0.18)",
                                            flexShrink: 0
                                        }}
                                    />
                                )}
                                {friendGameIngameDataUri && (
                                    <FadeImage
                                        src={friendGameIngameDataUri}
                                        fadeOnLoad={friendGameIngameColdRef.current}
                                        style={{
                                            height: "64px",
                                            width: "auto",
                                            borderRadius: "8px",
                                            objectFit: "contain",
                                            display: "block",
                                            flexShrink: 0
                                        }}
                                    />
                                )}
                                {
}
                                <div
                                    data-focus-key="friendgame:open-on-ra"
                                    style={{
                                        alignSelf: "stretch",
                                        display: "flex",
                                        flexShrink: 0
                                    }}
                                >
                                    <DialogButton
                                        onClick={actions.onOpenGameOnRetroAchievements}
                                        disabled={!friendGameId || friendGameLoading}
                                        style={{
                                            minWidth: 0,
                                            width: "16px",
                                            height: "100%",
                                            padding: "0",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center"
                                        }}
                                    >
                                        <ChevronRightIcon />
                                    </DialogButton>
                                </div>
                            </div>
                        </PanelSectionRow>
                    )}
                    <PanelSectionRow>
                        <div
                            style={{
                                width: "100%",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                                alignItems: "flex-start"
                            }}
                        >
                            <div
                                style={{
                                    fontSize: `${headerSize(18)}px`,
                                    pointerEvents: "all",
                                    fontWeight: 700,
                                    lineHeight: 1.2,
                                    textAlign: "left",
                                    wordBreak: "break-word",
                                    marginTop: "6px"
                                }}
                            >
                                {friendGamePayload.payload.title ??
                                    friendGamePayload.selectedGameTitle ??
                                    t(language, "No game found")}
                            </div>
                            <AwardStatusBadge
                                language={language}
                                kind={friendGamePayload.payload.highestAwardKind}
                                style={{ marginTop: "4px" }}
                            />
                            <div style={{ ...bodyTextStyle(), textAlign: "left" }}>
                                {friendGamePayload.payload.consoleName
                                    ? consoleInlineName(friendGamePayload.payload.consoleName)
                                    : ""}
                                {friendGamePayload.payload.consoleName && friendGamePayload.payload.userCompletion
                                    ? " • "
                                    : ""}
                                {friendGamePayload.payload.userCompletion
                                    ? t(language, "Completion: {{value}}", {
                                        value: friendGamePayload.payload.userCompletion
                                    })
                                    : ""}
                            </div>
                            <div style={{ ...bodyTextStyle(), textAlign: "left" }}>
                                {payloadAchievementSummaryLabel(friendGamePayload.payload, language)}
                            </div>
                            {friendGamePayload?.selectedGameId ? (
                                <div
                                    style={{
                                        width: "100%",
                                        marginTop: "4px",
                                        marginBottom: "0px"
                                    }}
                                >
                                    <Focusable
                                        flow-children="row"
                                        style={{
                                            display: "flex",
                                            gap: "12px",
                                            width: "100%",
                                            justifyContent: "flex-start"
                                        }}
                                    >
                                        {FRIEND_QUICK_ACTIONS.map((action) => {
                                            if (action.id === "compare" && selectedFriend?.isSelf) {
                                                return null;
                                            }

                                            const previewed = (hoveredQuickAction ?? focusedQuickAction) === action.id;
                                            const buttonDisabled = friendGameLoading;
                                            const labelText = t(language, action.labelKey);
                                            const Icon = action.Icon;

                                            return (
                                                <div
                                                    key={action.focusKey}
                                                    data-focus-key={action.focusKey}
                                                    onMouseEnter={() => handleQuickActionHover(action.id)}
                                                    onMouseLeave={() => handleQuickActionUnhover(action.id)}
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        alignItems: "center",
                                                        width: "42px"
                                                    }}
                                                >
                                                    <DialogButton
                                                        onClick={() => handleQuickActionClick(action.id)}
                                                        onGamepadFocus={() => handleQuickActionFocus(action.id)}
                                                        onGamepadBlur={() => handleQuickActionBlur(action.id)}
                                                        disabled={buttonDisabled}
                                                        style={{
                                                            minWidth: 0,
                                                            width: "42px",
                                                            height: "38px",
                                                            padding: "4px 2px",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            opacity: previewed ? 1 : 0.72,
                                                            boxShadow: previewed
                                                                ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                                                                : undefined
                                                        }}
                                                    >
                                                        <Icon size={18} />
                                                    </DialogButton>
                                                    <div
                                                        style={{
                                                            ...smallTextStyle(),
                                                            fontWeight: 700,
                                                            textAlign: "center",
                                                            whiteSpace: "nowrap",
                                                            overflow: "visible",
                                                            marginTop: "1px",
                                                            minHeight: "1em",
                                                            opacity: previewed ? 0.95 : 0
                                                        }}
                                                    >
                                                        {labelText}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </Focusable>
                                </div>
                            ) : null}
                        </div>
                    </PanelSectionRow>
                </PanelSection>
            )}
            {subView === "game" && (friendGamePayload?.payload ? (
                <>
                    <PanelSection title={t(language, "View Options")}>
                        <LabeledRow
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="friend:sort"
                            onClick={handleSortClick}
                            disabled={friendGameLoading}
                            label={t(language, "Sort")}
                            value={achievementSortLabel(friendAchievementSort, language)}
                            bottomSeparator="none"
                        />
                        <LabeledRow
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="friend:filter"
                            onClick={handleFilterClick}
                            disabled={friendGameLoading}
                            label={t(language, "Filter")}
                            value={mainAchievementFilterLabel(friendAchievementFilter, language)}
                            bottomSeparator="none"
                        />
                        {showAllToggleFriend && (
                            <PanelSectionRow>
                                <ToggleRow
                                    label={t(language, "Show All")}
                                    value={friendShowAllAchievements}
                                    onChange={handleShowAllToggle}
                                    disabled={friendGameLoading}
                                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                                    bottomSeparator="none"
                                />
                            </PanelSectionRow>
                        )}
                    </PanelSection>
                    <AchievementList
                        key={`friend:${selectedFriend?.username ?? "friend"}:${friendGamePayload?.selectedGameId ?? "none"}:${listResetToken}`}
                        payload={friendGamePayload.payload}
                        language={language}
                        showIcons={showIcons}
                        achievementStyle={achievementStyle}
                        uiSize={uiSize}
                        topPadding={topPadding}
                        blockPadding={blockPadding}
                        buttonSpacing={buttonSpacing}
                        showAll={showAllToggleFriend ? friendShowAllAchievements : true}
                        mode="friend"
                        filterScopeKey={`${selectedFriend?.username ?? "friend"}:${friendGamePayload?.selectedGameId ?? "none"}`}
                        resetToken={listResetToken}
                        friendFilter={friendAchievementFilter}
                        friendSort={friendAchievementSort}
                        showRetroPoints={showRetroPoints}
                        dynamicLoading={dynamicLoading}
                        dynamicInitialRows={dynamicInitialRows}
                        dynamicRowStep={dynamicRowStep}
                        dynamicPrefetchDistance={dynamicPrefetchDistance}
                        dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                        onAchievementClick={actions.onOpenAchievement}
                    />
                </>
            ) : (
                <PanelSection title={t(language, "Friend Progress")}>
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {friendGameLoading
                                ? t(language, "Loading friend game...")
                                : t(language, "No recent game progress available for this friend yet.")}
                        </div>
                    </PanelSectionRow>
                </PanelSection>
            ))}
            {subView === "wall" && (wallHoldCommentsBody && !wallCommentsLoaded ? (
                <PanelSection title={t(language, "User Wall")}>
                    <PanelSectionRow>
                        <InlineSpinner label={t(language, "Loading comments...")} />
                    </PanelSectionRow>
                </PanelSection>
            ) : wallIsEmpty ? (
                <PanelSection title={t(language, "User Wall")}>
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, "No comments for this user.")}
                        </div>
                    </PanelSectionRow>
                    <FocusClaim
                        token={wallCommentsPostClaim?.token ?? 0}
                        armed={wallCommentsPostClaim?.armed ?? false}
                        onSpent={actions.onSpendWallCommentsPostClaim}
                    >
                        <PanelSectionRow>
                            <FocusableItem
                                outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                                focusKey="friendwall:post"
                                onClick={actions.onPostComment}
                                disabled={friendGameLoading}
                            >
                                <div style={{ width: "100%", textAlign: "center", fontWeight: 800 }}>
                                    {t(language, "Post Comment")}
                                </div>
                            </FocusableItem>
                        </PanelSectionRow>
                    </FocusClaim>
                </PanelSection>
            ) : (
                <>
                    {!wallRestricted && (
                        <>
                            <PanelSection title={t(language, "User Wall")}>
                                <FocusClaim
                                    token={wallCommentsPostClaim?.token ?? 0}
                                    armed={wallCommentsPostClaim?.armed ?? false}
                                    onSpent={actions.onSpendWallCommentsPostClaim}
                                >
                                    <PanelSectionRow>
                                        <FocusableItem
                                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                                            focusKey="friendwall:post"
                                            onClick={actions.onPostComment}
                                            disabled={friendGameLoading}
                                        >
                                            <div style={{ width: "100%", textAlign: "center", fontWeight: 800 }}>
                                                {t(language, "Post Comment")}
                                            </div>
                                        </FocusableItem>
                                    </PanelSectionRow>
                                </FocusClaim>
                            </PanelSection>
                            <PanelSection title={t(language, "View Options")}>
                                <LabeledRow
                                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                                    focusKey="friendwall:sort"
                                    onClick={handleWallSortClick}
                                    label={t(language, "Sort")}
                                    value={wallCommentsSort === "newest"
                                        ? t(language, "Newest")
                                        : t(language, "Oldest")}
                                />
                            </PanelSection>
                        </>
                    )}
                    {
}
                    <PanelSection title={t(language, "Wall Comments")}>
                        {wallRestricted ? (
                            <PanelSectionRow>
                                <div style={bodyTextStyle()}>
                                    {t(language, "This user's profile is private.")}
                                </div>
                            </PanelSectionRow>
                        ) : (
                            <CommentsList
                                comments={wallComments}
                                language={language}
                                uiSize={uiSize}
                                showIcons={showIcons}
                                focusKeyPrefix="friendwall:comment"
                                surfaceKey="comments:wall"
                                onCommentClick={actions.onWallCommentClick}
                                dynamicLoading={dynamicComments}
                                dynamicSentinelRootMargin={dynamicCommentsSentinelRootMargin}
                                loading={wallCommentsLoading}
                                loadingMore={wallCommentsLoadingMore}
                                hasMore={wallCommentsHasMore}
                                error={null}
                                onLoadMore={actions.onLoadMoreWallComments}
                                emptyMessage={t(language, "No comments for this user.")}
                                claimedCard={wallCommentsCardClaim && {
                                    ...wallCommentsCardClaim,
                                    onSpent: actions.onSpendWallCommentsCardClaim
                                }}
                                restoredWindow={wallCommentsWindow}
                            />
                        )}
                    </PanelSection>
                </>
            ))}
        </React.Fragment>
    );

    return (
        <RestoreCurtain
            armed={restoreCurtainArmed}
            settled={restoreCurtainSettled}
            covered={panelOverlayVisible}
        >
            {page}
        </RestoreCurtain>
    );
}

export default FriendProfilePage;
