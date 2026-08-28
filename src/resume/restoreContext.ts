import type { Dispatch, RefObject, SetStateAction } from "react";
import type {
    AllGamesLetterRangeKey,
    AllGamesStatusFilter,
    BadgeFilter,
    FollowedRankingMetric,
    FriendGameSelectionMode,
    FriendGameSource,
    FriendProfileSubView,
    FriendRow,
    FriendsPayload,
    GuidesSubView,
    GameLeaderboardsPayload,
    LeaderboardRow,
    MainAchievementsTab,
    NowPlayingSubView,
    ViewKey
} from "../types";

export type RestoreContext = {
    markResumeApplied: () => void;
    setPendingPrimaryViewRestoreGameId: Dispatch<SetStateAction<number | null | undefined>>;

    setView: (next: ViewKey) => void;
    setPendingFocusKey: Dispatch<SetStateAction<string | null>>;
    pendingResumeFocusKeyRef: RefObject<string | null>;
    mountedRef: RefObject<boolean>;

    friendsPayload: FriendsPayload | null;
    friendGameReturnGameIdRef: RefObject<number | null>;
    setSelectedFriend: Dispatch<SetStateAction<FriendRow | null>>;
    setFriendGameSource: Dispatch<SetStateAction<FriendGameSource>>;
    setFriendGameSelectionMode: Dispatch<SetStateAction<FriendGameSelectionMode>>;
    setFriendProfileSubView: Dispatch<SetStateAction<FriendProfileSubView>>;
    setRecentGamesExpanded: Dispatch<SetStateAction<boolean>>;
    friendEntrySourceRef: RefObject<"profile" | "compareGame">;
    loadFriendGame: (
        friend: FriendRow,
        gameId?: number | null,
        force?: boolean,
        focusTarget?: string,
        suppressViewChange?: boolean
    ) => void | Promise<void>;
    loadFriendAllGames: (friend: FriendRow, page: number, desiredCount?: number) => Promise<number>;
    loadUserAwards: (awardsUsername: string, ulid?: string, suppressViewChange?: boolean) => Promise<void>;
    loadUserWantToPlay: (wantToPlayUsername: string, ulid?: string) => Promise<void>;

    setMainTab: Dispatch<SetStateAction<MainAchievementsTab>>;
    setNowPlayingSubView: Dispatch<SetStateAction<NowPlayingSubView>>;
    setBadgeFilter: Dispatch<SetStateAction<BadgeFilter>>;
    setAllGamesLetterRange: Dispatch<SetStateAction<AllGamesLetterRangeKey>>;
    setAllGamesStatusFilter: Dispatch<SetStateAction<AllGamesStatusFilter>>;
    setFollowedRankingMetric: Dispatch<SetStateAction<FollowedRankingMetric>>;
    setGameNotesGameId: Dispatch<SetStateAction<number | null>>;
    onRestoreGuides: (target: { subView: GuidesSubView; faqId: string | null }) => void;

    setUnlockHistorySource: Dispatch<SetStateAction<"main" | "friendGame">>;
    unlockHistoryReturnFriendRef: RefObject<{
        username: string | null;
        gameId: number | null;
        source: FriendGameSource;
    }>;
    friendCompareReturnFriendRef: RefObject<{
        username: string | null;
        gameId: number | null;
        source: FriendGameSource;
    }>;

    leaderboardsPayloadRef: RefObject<GameLeaderboardsPayload | null>;
    leaderboardReturnFriendRef: RefObject<{
        username: string | null;
        gameId: number | null;
        source: FriendGameSource;
    }>;
    goToLeaderboards: (
        gameIdOverride?: number | null,
        sourceView?: "achievements" | "friendGame" | "gameOverview",
        preserveCurrentView?: boolean
    ) => void | Promise<void>;
    openLeaderboardDetail: (row: LeaderboardRow) => void | Promise<void>;
    setRestoringLeaderboardDetail: Dispatch<SetStateAction<boolean>>;
};
