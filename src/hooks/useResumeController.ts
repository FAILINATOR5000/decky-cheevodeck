import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import { clearResumeState, saveResumeState } from "../api";
import {
    getAchievementsResumeFocusKey,
    getSavedMainAchievementsTab,
    resolveRestoredPrimaryView
} from "../resume/achievementsResume";
import {
    getSavedFriendProfileBackSource,
    restoreFriendAllGames,
    restoreFriendCompare,
    restoreFriendGame,
    restoreWantToPlay
} from "../resume/friendsResume";
import {
    getSavedCompareFilter,
    getSavedCompareFriend
} from "../resume/nowPlayingResume";
import { getSavedAotwSubView, getSavedNewSetsFilter, getSavedNewsEventsSubView } from "../resume/newsEventsResume";
import { getSavedTrackedSetOpenId, getSavedTrackedSetsBackSource } from "../resume/trackedSetsResume";
import {
    restoreGameOverview,
    getSavedGameOverviewGameId,
    getSavedGameOverviewSource,
    getSavedGameOverviewSubView,
    getSavedGameOverviewViewedUsername,
    getSavedGameOverviewViewedUserRef
} from "../resume/gameOverviewResume";
import { restoreBadges } from "../resume/badgesResume";
import {
    restoreAchievementOverview,
    getSavedAoAchievementId,
    getSavedAoGameId,
    getSavedAoSnapshot,
    getSavedAoSource,
    getSavedAoViewedUsername,
    getSavedAoViewedUserRef
} from "../resume/achievementOverviewResume";
import { getSavedUnlockHistorySource, restoreUnlockHistory } from "../resume/unlockHistoryResume";
import type {
    AllGamesLetterRangeKey,
    AllGamesStatusFilter,
    AotwSubView,
    AOSource,
    AchievementOverviewSnapshot,
    BadgeFilter,
    FollowedRankingMetric,
    FriendGameSelectionMode,
    FriendGameSource,
    FriendProfileSubView,
    FriendRow,
    FriendsPayload,
    GuidesSubView,
    GameLeaderboardsPayload,
    GameOverviewSource,
    GameOverviewSubView,
    LeaderboardRow,
    NewsEventsSubView,
    NewSetsFilter,
    MainAchievementsTab,
    NowPlayingCompareFilter,
    NowPlayingSubView,
    Payload,
    ResumeState,
    ViewKey
} from "../types";
import { restoreLeaderboards } from "../resume/leaderboardsResume";
import { restoreSelfOnlyView } from "../resume/selfOnlyResume";
import { restoreStandaloneView } from "../resume/standaloneResume";
import { logError } from "../utils/errors";
import type { RestoreContext } from "../resume/restoreContext";

type UseResumeControllerArgs = {
    buildResumeState: () => ResumeState;
    mountedRef: RefObject<boolean>;
    viewRef: RefObject<ViewKey>;
    pendingResumeFocusKeyRef: RefObject<string | null>;
    rememberLastPage: boolean;
    view: ViewKey;
    settingsLoaded: boolean;
    settingsMode: boolean;
    loading: boolean;
    friendProfileOverlayText: string | null;
    payload: Payload | null;
    trackedIdsLoadedForGameId: number | null;
    setTrackedSelectedGameId: Dispatch<SetStateAction<number | null>>;
    friendsPayload: FriendsPayload | null;
    friendGameReturnGameIdRef: RefObject<number | null>;
    onRestoreGuides: (target: { subView: GuidesSubView; faqId: string | null }) => void;
    friendProfileBackSourceRef: RefObject<"social" | "main">;
    trackedSetsBackSourceRef: RefObject<"profile" | "main">;
    setSelectedFriend: Dispatch<SetStateAction<FriendRow | null>>;
    setFriendGameSource: Dispatch<SetStateAction<FriendGameSource>>;
    setFriendGameSelectionMode: Dispatch<SetStateAction<FriendGameSelectionMode>>;
    setFriendProfileSubView: Dispatch<SetStateAction<FriendProfileSubView>>;
    setRecentGamesExpanded: Dispatch<SetStateAction<boolean>>;
    loadFriendGame: (
        friend: FriendRow,
        gameId?: number | null,
        force?: boolean,
        focusTarget?: string,
        suppressViewChange?: boolean
    ) => void | Promise<void>;
    loadFriendAllGames: (friend: FriendRow, page: number, desiredCount?: number) => Promise<number>;
    loadUserAwards: (awardsUsername: string, ulid?: string) => Promise<void>;
    loadUserWantToPlay: (wantToPlayUsername: string, ulid?: string) => Promise<void>;
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
    setView: (next: ViewKey) => void;
    setPendingFocusKey: Dispatch<SetStateAction<string | null>>;
    selectCompareFriend: (username: string | null) => void;
    setCompareFilter: Dispatch<SetStateAction<NowPlayingCompareFilter>>;
    setNowPlayingSubView: Dispatch<SetStateAction<NowPlayingSubView>>;
    setMainTab: Dispatch<SetStateAction<MainAchievementsTab>>;
    setNewsEventsSubView: Dispatch<SetStateAction<NewsEventsSubView>>;
    setAotwSubView: Dispatch<SetStateAction<AotwSubView>>;
    setNewSetsFilter: Dispatch<SetStateAction<NewSetsFilter>>;
    setGameOverviewSubView: Dispatch<SetStateAction<GameOverviewSubView>>;
    setGameOverviewSource: Dispatch<SetStateAction<GameOverviewSource>>;
    setGameOverviewGameId: Dispatch<SetStateAction<number | null>>;
    setGameOverviewViewedUsername: Dispatch<SetStateAction<string | null>>;
    setGameOverviewViewedUserRef: Dispatch<SetStateAction<string | null>>;
    setGameNotesGameId: Dispatch<SetStateAction<number | null>>;
    setAoSource: Dispatch<SetStateAction<AOSource>>;
    setAoAchievementId: Dispatch<SetStateAction<number | null>>;
    setAoGameId: Dispatch<SetStateAction<number | null>>;
    setAoSnapshot: Dispatch<SetStateAction<AchievementOverviewSnapshot | null>>;
    setAoViewedUsername: Dispatch<SetStateAction<string | null>>;
    setAoViewedUserRef: Dispatch<SetStateAction<string | null>>;
    friendEntrySourceRef: RefObject<"profile" | "compareGame">;
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
    setBadgeFilter: Dispatch<SetStateAction<BadgeFilter>>;
    setAllGamesLetterRange: Dispatch<SetStateAction<AllGamesLetterRangeKey>>;
    setAllGamesStatusFilter: Dispatch<SetStateAction<AllGamesStatusFilter>>;
    setFollowedRankingMetric: Dispatch<SetStateAction<FollowedRankingMetric>>;
    setTrackedSetOpenId: Dispatch<SetStateAction<string | null>>;
};

export function useResumeController({
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
    onRestoreGuides,
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
}: UseResumeControllerArgs) {
    const [pendingPrimaryViewRestoreGameId, setPendingPrimaryViewRestoreGameId] = useState<number | null | undefined>(
        undefined
    );

    const pendingResumeStateRef = useRef<ResumeState | null>(null);
    const resumeAppliedRef = useRef(false);
    const rememberLastPageRef = useRef(false);

    useEffect(() => {
        rememberLastPageRef.current = rememberLastPage;
    }, [rememberLastPage]);


    const clearPendingResumeState = useCallback(() => {
        pendingResumeStateRef.current = null;
        resumeAppliedRef.current = true;
        pendingResumeFocusKeyRef.current = null;
    }, [pendingResumeFocusKeyRef]);

    const enableRememberLastPagePersistence = async () => {
        pendingResumeStateRef.current = buildResumeState();
        await saveResumeState(pendingResumeStateRef.current);
    };

    const disableRememberLastPagePersistence = async () => {
        clearPendingResumeState();
        await clearResumeState();
    };

    const initializeResumeFromBoot = useCallback(
        (nextResumeState: ResumeState | null, nextPayload: Payload | null, bootView: ViewKey) => {
            const shouldBootDirectlyToTracked =
                Boolean(nextPayload) && nextResumeState?.view === "tracked";
            const skipPrimaryViewRestore =
                shouldBootDirectlyToTracked ||
                bootView === "friendGame" ||
                bootView === "friendAllGames" ||
                bootView === "friendCompare" ||
                bootView === "options" ||
                bootView === "utils" ||
                bootView === "dolphinMapper" ||
                bootView === "smbShares" ||
                bootView === "cheevoCheck" ||
                bootView === "unlockHistory" ||
                bootView === "about" ||
                bootView === "social" ||
                bootView === "comparePicker" ||
                bootView === "leaderboards" ||
                bootView === "leaderboardDetail" ||
                bootView === "gameNotes" ||
                bootView === "badges" ||
                bootView === "gameOverview" ||
                bootView === "achievementOverview";
            pendingResumeStateRef.current = shouldBootDirectlyToTracked ? null : nextResumeState;
            resumeAppliedRef.current = shouldBootDirectlyToTracked;
            pendingResumeFocusKeyRef.current = getAchievementsResumeFocusKey(
                shouldBootDirectlyToTracked ? "tracked" : "achievements"
            );
            setPendingPrimaryViewRestoreGameId(skipPrimaryViewRestore ? undefined : (nextPayload?.gameId ?? null));

            if (shouldBootDirectlyToTracked) {
                const savedDrillInId = nextResumeState?.trackedSelectedGameId ?? null;
                if (savedDrillInId !== null) {
                    setTrackedSelectedGameId(savedDrillInId);
                }
            }

            if (bootView === "gameOverview" && nextResumeState) {
                setGameOverviewSubView(getSavedGameOverviewSubView(nextResumeState));
                setGameOverviewSource(getSavedGameOverviewSource(nextResumeState));
                setGameOverviewGameId(getSavedGameOverviewGameId(nextResumeState));
                setGameOverviewViewedUsername(getSavedGameOverviewViewedUsername(nextResumeState));
                setGameOverviewViewedUserRef(getSavedGameOverviewViewedUserRef(nextResumeState));
            }
            if (bootView === "achievementOverview" && nextResumeState) {
                setAoSource(getSavedAoSource(nextResumeState));
                setAoAchievementId(getSavedAoAchievementId(nextResumeState));
                setAoGameId(getSavedAoGameId(nextResumeState));
                setAoSnapshot(getSavedAoSnapshot(nextResumeState));
                setAoViewedUsername(getSavedAoViewedUsername(nextResumeState));
                setAoViewedUserRef(getSavedAoViewedUserRef(nextResumeState));
            }
        },
        [
            pendingResumeFocusKeyRef,
            setTrackedSelectedGameId,
            setGameOverviewSubView,
            setGameOverviewSource,
            setGameOverviewGameId,
            setGameOverviewViewedUsername,
            setGameOverviewViewedUserRef,
            setAoSource,
            setAoAchievementId,
            setAoGameId,
            setAoSnapshot,
            setAoViewedUsername,
            setAoViewedUserRef
        ]
    );

    function markResumeApplied() {
        pendingResumeStateRef.current = null;
        resumeAppliedRef.current = true;
    }

    function applyUnconditionalResumeState(savedState: ResumeState) {

        setMainTab(getSavedMainAchievementsTab(savedState));

        selectCompareFriend(getSavedCompareFriend(savedState) || null);
        setCompareFilter(getSavedCompareFilter(savedState));

        setNewsEventsSubView(getSavedNewsEventsSubView(savedState));

        setAotwSubView(getSavedAotwSubView(savedState));

        setNewSetsFilter(getSavedNewSetsFilter(savedState));

        setTrackedSetOpenId(getSavedTrackedSetOpenId(savedState));

        trackedSetsBackSourceRef.current = getSavedTrackedSetsBackSource(savedState);

        setGameOverviewSubView(getSavedGameOverviewSubView(savedState));
        setGameOverviewSource(getSavedGameOverviewSource(savedState));
        setGameOverviewGameId(getSavedGameOverviewGameId(savedState));
        setGameOverviewViewedUsername(getSavedGameOverviewViewedUsername(savedState));
        setGameOverviewViewedUserRef(getSavedGameOverviewViewedUserRef(savedState));

        setAoSource(getSavedAoSource(savedState));
        setAoAchievementId(getSavedAoAchievementId(savedState));
        setAoGameId(getSavedAoGameId(savedState));
        setAoSnapshot(getSavedAoSnapshot(savedState));
        setAoViewedUsername(getSavedAoViewedUsername(savedState));
        setAoViewedUserRef(getSavedAoViewedUserRef(savedState));

        setUnlockHistorySource(getSavedUnlockHistorySource(savedState));

        friendProfileBackSourceRef.current = getSavedFriendProfileBackSource(savedState);
    }

    function buildRestoreContext(): RestoreContext {
        return {
            markResumeApplied,
            setPendingPrimaryViewRestoreGameId,
            setView,
            setPendingFocusKey,
            pendingResumeFocusKeyRef,
            mountedRef,
            friendsPayload,
            friendGameReturnGameIdRef,
            setSelectedFriend,
            setFriendGameSource,
            setFriendGameSelectionMode,
            setFriendProfileSubView,
            setRecentGamesExpanded,
            friendEntrySourceRef,
            loadFriendGame,
            loadFriendAllGames,
            loadUserAwards,
            loadUserWantToPlay,
            setMainTab,
            setNowPlayingSubView,
            setBadgeFilter,
            setAllGamesLetterRange,
            setAllGamesStatusFilter,
            setFollowedRankingMetric,
            setGameNotesGameId,
            onRestoreGuides,
            setUnlockHistorySource,
            unlockHistoryReturnFriendRef,
            friendCompareReturnFriendRef,
            leaderboardsPayloadRef,
            leaderboardReturnFriendRef,
            goToLeaderboards,
            openLeaderboardDetail,
            setRestoringLeaderboardDetail
        };
    }

    async function restoreResumeState(savedState: ResumeState) {
        const savedView = savedState?.view;
        if (!rememberLastPage || !savedView) {
            markResumeApplied();
            return;
        }

        applyUnconditionalResumeState(savedState);

        const restoreCtx = buildRestoreContext();

        if (restoreStandaloneView(savedState, savedView, restoreCtx)) {
            return;
        }

        if (await restoreGameOverview(savedState, savedView, restoreCtx)) {
            return;
        }

        if (await restoreAchievementOverview(savedState, savedView, restoreCtx)) {
            return;
        }

        if (await restoreUnlockHistory(savedState, savedView, restoreCtx)) {
            return;
        }

        if (await restoreFriendCompare(savedState, savedView, restoreCtx)) {
            return;
        }

        if (await restoreLeaderboards(savedState, savedView, restoreCtx)) {
            return;
        }

        if (await restoreFriendGame(savedState, savedView, restoreCtx)) {
            return;
        }

        if (await restoreFriendAllGames(savedState, savedView, restoreCtx)) {
            return;
        }

        if (await restoreBadges(savedState, savedView, restoreCtx)) {
            return;
        }

        if (await restoreWantToPlay(savedState, savedView, restoreCtx)) {
            return;
        }

        if (restoreSelfOnlyView(savedState, savedView, restoreCtx)) {
            return;
        }

        pendingResumeFocusKeyRef.current = getAchievementsResumeFocusKey(savedView);

        markResumeApplied();
    }

    useEffect(() => {
        if (!settingsLoaded || settingsMode || loading || Boolean(friendProfileOverlayText)) {
            return;
        }
        if (resumeAppliedRef.current) {
            return;
        }

        const savedState = pendingResumeStateRef.current;
        if (!savedState || !rememberLastPage) {
            resumeAppliedRef.current = true;
            pendingResumeStateRef.current = null;
            if (
                viewRef.current === "friendGame"
                || viewRef.current === "friendAllGames"
                || viewRef.current === "friendCompare"
                || viewRef.current === "wantToPlay"
                || viewRef.current === "followedRanking"
            ) {
                setView("achievements");
            }
            return;
        }

        void restoreResumeState(savedState);
    }, [settingsLoaded, settingsMode, loading, friendProfileOverlayText, rememberLastPage, friendsPayload]);

    useEffect(() => {
        if (pendingPrimaryViewRestoreGameId === undefined) {
            return;
        }
        if (settingsMode || loading || Boolean(friendProfileOverlayText)) {
            return;
        }
        if (view !== "achievements" && view !== "tracked") {
            return;
        }

        const currentGameId = payload?.gameId ?? null;
        if (currentGameId !== pendingPrimaryViewRestoreGameId) {
            return;
        }
        if (trackedIdsLoadedForGameId !== currentGameId) {
            return;
        }

        if (rememberLastPage && view === "tracked") {
            setPendingPrimaryViewRestoreGameId(undefined);
            return;
        }

        let cancelled = false;

        void (async () => {
            try {
                if (!rememberLastPage) {
                    if (cancelled || !mountedRef.current) {
                        return;
                    }
                    setView("achievements");
                    setPendingFocusKey(pendingResumeFocusKeyRef.current || null);
                    pendingResumeFocusKeyRef.current = null;
                    return;
                }

                const currentView = viewRef.current;
                if (cancelled || !mountedRef.current) {
                    return;
                }

                const resolvedPrimaryView = resolveRestoredPrimaryView({
                    rememberLastPage,
                    requestedLastPrimaryView: currentView === "tracked" ? "tracked" : "achievements"
                });

                setView(resolvedPrimaryView.view);
                const resumeFocusKey = pendingResumeFocusKeyRef.current;
                setPendingFocusKey(resumeFocusKey || resolvedPrimaryView.focusKey);
                pendingResumeFocusKeyRef.current = null;
            } catch (e) {
                logError("resume restore (primary view)", e);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                setView("achievements");
                setPendingFocusKey(pendingResumeFocusKeyRef.current || null);
                pendingResumeFocusKeyRef.current = null;
            } finally {
                if (!cancelled && mountedRef.current) {
                    setPendingPrimaryViewRestoreGameId(undefined);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        pendingPrimaryViewRestoreGameId,
        payload?.gameId,
        trackedIdsLoadedForGameId,
        view,
        settingsMode,
        loading,
        friendProfileOverlayText,
        rememberLastPage
    ]);


    const controllerActions = {
        clearPendingResumeState,
        enableRememberLastPagePersistence,
        disableRememberLastPagePersistence,
        initializeResumeFromBoot,
        setPendingPrimaryViewRestoreGameId
    };

    const controllerRefs = {
        rememberLastPageRef
    };

    return {
        actions: controllerActions,
        refs: controllerRefs
    };
}
