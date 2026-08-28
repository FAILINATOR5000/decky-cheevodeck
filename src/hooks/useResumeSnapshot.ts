import { useCallback, useEffect, type RefObject } from "react";
import { saveResumeState } from "../api";
import { useLatestRef } from "./useLatestRef";
import type { NavStack } from "../nav";
import type { UnlockHistorySource } from "../pages/UnlockHistoryPage";
import type {
    AchievementOverviewSnapshot,
    AllGamesLetterRangeKey,
    AllGamesStatusFilter,
    AOSource,
    AotwSubView,
    BadgeFilter,
    FollowedRankingMetric,
    FriendGamePayload,
    FriendGameSelectionMode,
    FriendGameSource,
    FriendProfileSubView,
    FriendRow,
    GameOverviewSource,
    GameOverviewSubView,
    GuidesSubView,
    LeaderboardRow,
    MainAchievementsTab,
    NewSetsFilter,
    NewsEventsSubView,
    NowPlayingCompareFilter,
    Payload,
    ResumeState,
    ViewKey
} from "../types";

type ResumeSnapshotArgs = {
    navStack: NavStack;
    unlockHistorySource: UnlockHistorySource;
    badgeFilter: BadgeFilter;
    allGamesLetterRange: AllGamesLetterRangeKey;
    allGamesStatusFilter: AllGamesStatusFilter;
    followedRankingMetric: FollowedRankingMetric;
    gameOverviewSubView: GameOverviewSubView;
    friendProfileSubView: FriendProfileSubView;
    mainTab: MainAchievementsTab;
    gameOverviewSource: GameOverviewSource;
    gameOverviewGameId: number | null;
    gameNotesGameId: number | null;
    gameOverviewViewedUsername: string | null;
    gameOverviewViewedUserRef: string | null;
    aoSource: AOSource;
    aoAchievementId: number | null;
    aoGameId: number | null;
    aoViewedUsername: string | null;
    aoViewedUserRef: string | null;
    aoSnapshot: AchievementOverviewSnapshot | null;
    trackedSelectedGameId: number | null;

    rememberLastPage: boolean;
    view: ViewKey;
    settingsLoaded: boolean;
    settingsMode: boolean;
    payload: Payload | null;
    selectedFriend: FriendRow | null;
    friendGamePayload: FriendGamePayload | null;
    friendGameSource: FriendGameSource;
    friendGameSelectionMode: FriendGameSelectionMode;
    friendAllGamesPayload: { results?: unknown[] } | null;
    compareFriendUsername: string | null;
    compareFilter: NowPlayingCompareFilter;
    newsEventsSubView: NewsEventsSubView;
    aotwSubView: AotwSubView;
    newSetsFilter: NewSetsFilter;
    trackedSetOpenId: string | null;

    viewRef: RefObject<ViewKey>;
    payloadRef: RefObject<Payload | null>;
    friendGameReturnGameIdRef: RefObject<number | null>;
    selectedFriendRef: RefObject<FriendRow | null>;
    friendGamePayloadRef: RefObject<FriendGamePayload | null>;
    friendAllGamesPayloadRef: RefObject<{ results?: unknown[] } | null>;
    friendGameSourceRef: RefObject<FriendGameSource>;
    friendGameSelectionModeRef: RefObject<FriendGameSelectionMode>;
    guidesSubViewRef: RefObject<GuidesSubView>;
    guidesOpenFaqIdRef: RefObject<string | null>;
    friendProfileBackSourceRef: RefObject<"social" | "main">;
    trackedSetsBackSourceRef: RefObject<"profile" | "main">;
    leaderboardsSourceViewRef: RefObject<"achievements" | "friendGame" | "gameOverview">;
    selectedLeaderboardRef: RefObject<LeaderboardRow | null>;
    defaultPersistedFocusKeyForView: (currentView: ViewKey) => string;
    compareFriendUsernameRef: RefObject<string | null>;
    compareFilterRef: RefObject<NowPlayingCompareFilter>;
    newsEventsSubViewRef: RefObject<NewsEventsSubView>;
    aotwSubViewRef: RefObject<AotwSubView>;
    newSetsFilterRef: RefObject<NewSetsFilter>;
    friendEntrySourceRef: RefObject<"profile" | "compareGame">;
    trackedSetOpenIdRef: RefObject<string | null>;
};

export function useResumeSnapshot(args: ResumeSnapshotArgs) {
    const {
        navStack,
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
        viewRef,
        payloadRef,
        defaultPersistedFocusKeyForView,
        selectedFriendRef,
        friendGamePayloadRef,
        friendGameReturnGameIdRef,
        friendAllGamesPayloadRef,
        friendGameSourceRef,
        friendGameSelectionModeRef,
            guidesSubViewRef,
        guidesOpenFaqIdRef,
        friendProfileBackSourceRef,
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
    } = args;

    const navStackRef = useLatestRef(navStack);
    const unlockHistorySourceRef = useLatestRef(unlockHistorySource);
    const badgeFilterRef = useLatestRef(badgeFilter);
    const allGamesLetterRangeRef = useLatestRef(allGamesLetterRange);
    const allGamesStatusFilterRef = useLatestRef(allGamesStatusFilter);
    const followedRankingMetricRef = useLatestRef(followedRankingMetric);
    const gameOverviewSubViewRef = useLatestRef(gameOverviewSubView);
    const friendProfileSubViewRef = useLatestRef(friendProfileSubView);
    const mainTabRef = useLatestRef(mainTab);
    const gameOverviewSourceRef = useLatestRef(gameOverviewSource);
    const gameOverviewGameIdRef = useLatestRef(gameOverviewGameId);
    const gameNotesGameIdRef = useLatestRef(gameNotesGameId);
    const gameOverviewViewedUsernameRef = useLatestRef(gameOverviewViewedUsername);
    const gameOverviewViewedUserRefRef = useLatestRef(gameOverviewViewedUserRef);
    const aoSourceRef = useLatestRef(aoSource);
    const aoAchievementIdRef = useLatestRef(aoAchievementId);
    const aoGameIdRef = useLatestRef(aoGameId);
    const aoViewedUsernameRef = useLatestRef(aoViewedUsername);
    const aoViewedUserRefRef = useLatestRef(aoViewedUserRef);
    const aoSnapshotRef = useLatestRef(aoSnapshot);
    const trackedSelectedGameIdRef = useLatestRef(trackedSelectedGameId);


    const buildResumeState = useCallback((): ResumeState => {
        const currentView = viewRef.current;
        const onGameOverviewStack =
            currentView === "gameOverview" || currentView === "achievementOverview";
        const onLeaderboardsFromGameOverview =
            (currentView === "leaderboards" || currentView === "leaderboardDetail")
            && leaderboardsSourceViewRef.current === "gameOverview";
        const keepGameOverviewIdentity = onGameOverviewStack || onLeaderboardsFromGameOverview;
        return {
            view: currentView,
            navStack: navStackRef.current.map((route) => route.view),
            focusKey: defaultPersistedFocusKeyForView(currentView),
            primaryGameId: payloadRef.current?.gameId ?? null,
            selectedFriendUsername: selectedFriendRef.current?.username ?? null,
            selectedFriendUlid: selectedFriendRef.current?.ulid ?? null,
            friendGameId: friendGamePayloadRef.current?.selectedGameId ?? friendGameReturnGameIdRef.current ?? null,
            friendAllGamesCount: currentView === "friendAllGames" ? null : (friendAllGamesPayloadRef.current?.results?.length ?? null),
            friendGameSource: friendGameSourceRef.current,
            friendGameSelectionMode: friendGameSelectionModeRef.current,
            friendProfileSubView: friendProfileSubViewRef.current ?? null,
            guidesSubView: currentView === "guides" ? (guidesSubViewRef.current ?? null) : null,
            guidesFaqId: currentView === "guides" ? (guidesOpenFaqIdRef.current ?? null) : null,
            friendProfileBackSource: friendProfileBackSourceRef.current ?? null,
            leaderboardsSourceView: leaderboardsSourceViewRef.current,
            selectedLeaderboardId: selectedLeaderboardRef.current?.id ?? null,
            nowPlayingCompareFriend: compareFriendUsernameRef.current ?? null,
            nowPlayingCompareFilter: compareFilterRef.current ?? null,
            mainAchievementsTab: mainTabRef.current ?? null,
            newsEventsSubView: newsEventsSubViewRef.current ?? null,
            aotwSubView: aotwSubViewRef.current ?? null,
            newSetsFilter: newSetsFilterRef.current ?? null,
            gameOverviewSubView: gameOverviewSubViewRef.current ?? null,
            gameOverviewSource: gameOverviewSourceRef.current ?? null,
            gameOverviewGameId:
                keepGameOverviewIdentity
                    ? (gameOverviewGameIdRef.current ?? null)
                    : null,
            gameOverviewViewedUsername:
                keepGameOverviewIdentity
                    ? (gameOverviewViewedUsernameRef.current ?? null)
                    : null,
            gameOverviewViewedUserRef:
                keepGameOverviewIdentity
                    ? (gameOverviewViewedUserRefRef.current ?? null)
                    : null,
            gameNotesGameId:
                currentView === "gameNotes"
                    ? (gameNotesGameIdRef.current ?? null)
                    : null,
            aoSource: currentView === "achievementOverview" ? (aoSourceRef.current ?? null) : null,
            aoAchievementId: currentView === "achievementOverview" ? (aoAchievementIdRef.current ?? null) : null,
            aoGameId: currentView === "achievementOverview" ? (aoGameIdRef.current ?? null) : null,
            aoAchievementSnapshot: currentView === "achievementOverview" ? (aoSnapshotRef.current ?? null) : null,
            aoViewedUsername:
                currentView === "achievementOverview"
                    ? (aoViewedUsernameRef.current ?? null)
                    : null,
            aoViewedUserRef:
                currentView === "achievementOverview"
                    ? (aoViewedUserRefRef.current ?? null)
                    : null,
            friendEntrySource:
                currentView === "achievementOverview" && aoSourceRef.current === "friend"
                    ? (friendEntrySourceRef.current ?? "profile")
                    : null,
            trackedSelectedGameId: currentView === "tracked" ? (trackedSelectedGameIdRef.current ?? null) : null,
            unlockHistorySource:
                currentView === "unlockHistory"
                    || (currentView === "achievementOverview" && aoSourceRef.current === "unlockHistory")
                    ? (unlockHistorySourceRef.current ?? "main")
                    : "main",
            badgeFilter:
                currentView === "badges"
                    || ((currentView === "gameOverview" || currentView === "achievementOverview")
                        && gameOverviewSourceRef.current === "badges")
                    ? (badgeFilterRef.current ?? "all")
                    : "all",
            allGamesLetterRange:
                currentView === "friendAllGames" ? (allGamesLetterRangeRef.current ?? "a-f") : "a-f",
            allGamesStatusFilter:
                currentView === "friendAllGames" ? (allGamesStatusFilterRef.current ?? "all") : "all",
            followedRankingMetric:
                currentView === "followedRanking"
                    ? (followedRankingMetricRef.current ?? "hardcorePoints")
                    : null,
            trackedSetOpenId:
                currentView === "trackedSetOpen"
                    || ((currentView === "gameOverview" || currentView === "achievementOverview")
                        && gameOverviewSourceRef.current === "trackedSet")
                    ? (trackedSetOpenIdRef.current ?? null)
                    : null,
            trackedSetsBackSource: trackedSetsBackSourceRef.current ?? null,
            savedAt: Date.now()
        };
    }, [allGamesLetterRangeRef, allGamesStatusFilterRef, aoSourceRef, badgeFilterRef, compareFilterRef, compareFriendUsernameRef, defaultPersistedFocusKeyForView, followedRankingMetricRef, trackedSelectedGameIdRef, trackedSetOpenIdRef, trackedSetsBackSourceRef, unlockHistorySourceRef]);

    useEffect(() => {
        if (!settingsLoaded || settingsMode || !rememberLastPage) {
            return;
        }
        void saveResumeState(buildResumeState());
    }, [
        settingsLoaded,
        settingsMode,
        rememberLastPage,
        view,
        payload?.gameId,
        selectedFriend?.username,
        friendGamePayload?.selectedGameId,
        friendAllGamesPayload?.results?.length,
        friendGameSource,
        friendGameSelectionMode,
        friendProfileSubView,
        compareFriendUsername,
        compareFilter,
        mainTab,
        newsEventsSubView,
        aotwSubView,
        newSetsFilter,
        gameOverviewSubView,
        gameOverviewSource,
        gameOverviewGameId,
        gameOverviewViewedUsername,
        gameOverviewViewedUserRef,
        gameNotesGameId,
        aoSource,
        aoAchievementId,
        aoGameId,
        aoSnapshot,
        aoViewedUsername,
        aoViewedUserRef,
        trackedSelectedGameId,
        badgeFilter,
        allGamesLetterRange,
        allGamesStatusFilter,
        followedRankingMetric,
        trackedSetOpenId
    ]);

    return {
        buildResumeState,
        unlockHistorySourceRef,
        gameOverviewSourceRef,
        gameOverviewGameIdRef,
        gameOverviewViewedUsernameRef,
        gameOverviewViewedUserRefRef,
        aoSourceRef,
        aoAchievementIdRef,
        aoGameIdRef
    };
}
