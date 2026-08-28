import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import { getGameLeaderboards, getLeaderboardEntries, getLeaderboardUserEntry } from "../api";
import type { NavIntent } from "../nav";
import type {
    FriendGamePayload,
    FriendGameSource,
    FriendRow,
    GameLeaderboardsPayload,
    LeaderboardAudience,
    LeaderboardEntriesPayload,
    LeaderboardRow,
    LeaderboardUserEntryPayload,
    Payload,
    ViewKey
} from "../types";
import { logError } from "../utils/errors";
import { openExternalUrl, raUserUrl } from "../utils/navigation";

const MAX_LEADERBOARD_RESULTS = 500;

type UseLeaderboardsControllerArgs = {
    mountedRef: RefObject<boolean>;
    payloadRef: RefObject<Payload | null>;
    selectedFriend: FriendRow | null;
    selectedFriendRef: RefObject<FriendRow | null>;
    friendGamePayloadRef: RefObject<FriendGamePayload | null>;
    friendGameSourceRef: RefObject<FriendGameSource>;
    friendGameReturnGameIdRef: RefObject<number | null>;
    setFriendGameSource: Dispatch<SetStateAction<FriendGameSource>>;
    setRecentGamesExpanded: Dispatch<SetStateAction<boolean>>;
    setSettingsMode: Dispatch<SetStateAction<boolean>>;
    setView: (next: ViewKey) => void;
    navIntentRef: RefObject<NavIntent | null>;
    setPendingFocusKey: Dispatch<SetStateAction<string | null>>;
    loadFriendGame: (
        friend: FriendRow,
        gameId?: number | null,
        force?: boolean,
        focusTarget?: string
    ) => void | Promise<void>;
    goToFriends: () => void;
    goToAchievements: (focusTarget?: string) => void;
    returnToGameOverview: () => void;
    onBeforeEnterLeaderboards?: () => void;
};

export function useLeaderboardsController({
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
    navIntentRef,
    setPendingFocusKey,
    loadFriendGame,
    goToFriends,
    goToAchievements,
    returnToGameOverview,
    onBeforeEnterLeaderboards
}: UseLeaderboardsControllerArgs) {
    const [leaderboardsPayload, setLeaderboardsPayload] = useState<GameLeaderboardsPayload | null>(null);
    const [leaderboardsLoading, setLeaderboardsLoading] = useState(false);
    const [leaderboardsError, setLeaderboardsError] = useState<string | null>(null);
    const [selectedLeaderboard, setSelectedLeaderboard] = useState<LeaderboardRow | null>(null);
    const [leaderboardsSourceView, setLeaderboardsSourceView] = useState<"achievements" | "friendGame" | "gameOverview">("achievements");
    const [leaderboardEntriesPayload, setLeaderboardEntriesPayload] = useState<LeaderboardEntriesPayload | null>(null);
    const [leaderboardEntriesLoading, setLeaderboardEntriesLoading] = useState(false);
    const [leaderboardEntriesError, setLeaderboardEntriesError] = useState<string | null>(null);
    const [leaderboardUserEntryPayload, setLeaderboardUserEntryPayload] = useState<LeaderboardUserEntryPayload | null>(
        null
    );
    const [leaderboardUserEntryLoading, setLeaderboardUserEntryLoading] = useState(false);
    const [leaderboardUserEntryError, setLeaderboardUserEntryError] = useState<string | null>(null);
    const [leaderboardAudience, setLeaderboardAudience] = useState<LeaderboardAudience>("all");
    const [restoringLeaderboardDetail, setRestoringLeaderboardDetail] = useState(false);

    const leaderboardsPayloadRef = useRef<GameLeaderboardsPayload | null>(null);
    const leaderboardReturnFriendRef = useRef<{
        username: string | null;
        gameId: number | null;
        source: FriendGameSource;
    }>({
        username: null,
        gameId: null,
        source: "recentGames"
    });
    const leaderboardsSourceViewRef = useRef<"achievements" | "friendGame" | "gameOverview">("achievements");
    const selectedLeaderboardRef = useRef<LeaderboardRow | null>(null);

    useEffect(() => {
        leaderboardsPayloadRef.current = leaderboardsPayload;
    }, [leaderboardsPayload]);

    useEffect(() => {
        leaderboardsSourceViewRef.current = leaderboardsSourceView;
    }, [leaderboardsSourceView]);

    useEffect(() => {
        selectedLeaderboardRef.current = selectedLeaderboard;
    }, [selectedLeaderboard]);

    const goToLeaderboards = useCallback(
        async (
            gameIdOverride?: number | null,
            sourceView: "achievements" | "friendGame" | "gameOverview" = "achievements",
            preserveCurrentView = false
        ) => {
            onBeforeEnterLeaderboards?.();
            setRecentGamesExpanded(false);
            setSelectedLeaderboard(null);
            setLeaderboardEntriesPayload(null);
            setLeaderboardEntriesError(null);
            setLeaderboardUserEntryPayload(null);
            setLeaderboardUserEntryError(null);

            if (sourceView === "friendGame") {
                leaderboardReturnFriendRef.current = {
                    username:
                        selectedFriendRef.current?.username ||
                        selectedFriend?.username ||
                        friendGamePayloadRef.current?.friendUsername ||
                        null,
                    gameId:
                        gameIdOverride ??
                        friendGamePayloadRef.current?.selectedGameId ??
                        friendGamePayloadRef.current?.payload?.gameId ??
                        null,
                    source: friendGameSourceRef.current
                };
            }
            else {
                leaderboardReturnFriendRef.current = { username: null, gameId: null, source: "recentGames" };
            }

            if (!preserveCurrentView) {
                setView("leaderboards");
                setPendingFocusKey("leaderboards:back");
            }

            const gameId = gameIdOverride ?? payloadRef.current?.gameId ?? null;
            setLeaderboardsSourceView(sourceView);
            if (gameId !== (leaderboardsPayloadRef.current?.gameId ?? null)) {
                leaderboardsPayloadRef.current = null;
                setLeaderboardsPayload(null);
            }
            if (!gameId) {
                return;
            }

            setLeaderboardsLoading(true);
            setLeaderboardsError(null);
            try {
                const result = await getGameLeaderboards(gameId, false);
                if (!mountedRef.current) {
                    return;
                }
                if (result?.needsSettings) {
                    setSettingsMode(true);
                    return;
                }
                leaderboardsPayloadRef.current = result?.payload ?? null;
                setLeaderboardsPayload(result?.payload ?? null);
                if (result?.error) {
                    setLeaderboardsError(result.error);
                }
            } catch (e: any) {
                logError("openLeaderboards", e);
                if (!mountedRef.current) {
                    return;
                }
                setLeaderboardsError(String(e?.message || e || "Couldn't load leaderboards for this game."));
            } finally {
                if (mountedRef.current) {
                    setLeaderboardsLoading(false);
                }
            }
        },
        [
            friendGamePayloadRef,
            friendGameSourceRef,
            mountedRef,
            onBeforeEnterLeaderboards,
            payloadRef,
            selectedFriend,
            selectedFriendRef,
            setPendingFocusKey,
            setRecentGamesExpanded,
            setSettingsMode,
            setView
        ]
    );

    const openLeaderboardDetail = useCallback(
        async (leaderboard: LeaderboardRow) => {
            if (!leaderboard?.id) {
                return;
            }
            selectedLeaderboardRef.current = leaderboard;
            setSelectedLeaderboard(leaderboard);
            setView("leaderboardDetail");
            setPendingFocusKey("leaderboarddetail:back");
            setLeaderboardEntriesPayload(null);
            setLeaderboardEntriesError(null);
            setLeaderboardUserEntryPayload(null);
            setLeaderboardUserEntryError(null);
            setLeaderboardAudience("all");
            setLeaderboardEntriesLoading(true);
            setLeaderboardUserEntryLoading(true);
            try {
                const gameIdForUserEntry =
                    leaderboardsPayloadRef.current?.gameId ??
                    payloadRef.current?.gameId ??
                    friendGamePayloadRef.current?.selectedGameId ??
                    friendGamePayloadRef.current?.payload?.gameId ??
                    null;
                const [entriesResult, userEntryResult] = await Promise.all([
                    getLeaderboardEntries(leaderboard.id, MAX_LEADERBOARD_RESULTS, 0),
                    getLeaderboardUserEntry(leaderboard.id, gameIdForUserEntry)
                ]);
                if (!mountedRef.current) {
                    return;
                }
                if (entriesResult?.needsSettings || userEntryResult?.needsSettings) {
                    setSettingsMode(true);
                    return;
                }
                setLeaderboardEntriesPayload(entriesResult?.payload ?? null);
                setLeaderboardUserEntryPayload(userEntryResult?.payload ?? null);
                if (entriesResult?.error) {
                    setLeaderboardEntriesError(entriesResult.error);
                }
                if (userEntryResult?.error) {
                    setLeaderboardUserEntryError(userEntryResult.error);
                }
            } catch (e: any) {
                logError("openLeaderboardDetail", e);
                if (!mountedRef.current) {
                    return;
                }
                const message = String(e?.message || e || "Couldn't load the leaderboard's top scores.");
                setLeaderboardEntriesError(message);
            } finally {
                if (mountedRef.current) {
                    setLeaderboardEntriesLoading(false);
                    setLeaderboardUserEntryLoading(false);
                }
            }
        },
        [
            friendGamePayloadRef,
            mountedRef,
            payloadRef,
            setPendingFocusKey,
            setSettingsMode,
            setView
        ]
    );

    const backToLeaderboardsSource = useCallback(async () => {
        navIntentRef.current = "back";
        if (leaderboardsSourceViewRef.current === "gameOverview") {
            returnToGameOverview();
            return;
        }

        if (leaderboardsSourceViewRef.current === "friendGame") {
            const friendUsername = String(
                leaderboardReturnFriendRef.current.username ||
                selectedFriendRef.current?.username ||
                friendGamePayloadRef.current?.friendUsername ||
                selectedFriend?.username ||
                ""
            ).trim();
            const returnSource = leaderboardReturnFriendRef.current.source || friendGameSourceRef.current;
            const returnFocusKey =
                returnSource === "allGames" ? "friendgame:games" : "friendgame:selected";

            const payloadUsername = String(friendGamePayloadRef.current?.friendUsername || "").trim();
            const payloadStillLoaded =
                friendGamePayloadRef.current != null &&
                payloadUsername.toLowerCase() === friendUsername.toLowerCase();
            if (friendUsername && payloadStillLoaded) {
                setFriendGameSource(returnSource);
                setView("friendGame");
                setPendingFocusKey(returnFocusKey);
                return;
            }

            if (friendUsername) {
                const friendGameId =
                    leaderboardReturnFriendRef.current.gameId ??
                    friendGamePayloadRef.current?.selectedGameId ??
                    friendGameReturnGameIdRef.current ??
                    friendGamePayloadRef.current?.payload?.gameId ??
                    null;
                setFriendGameSource(returnSource);
                await loadFriendGame(
                    { username: friendUsername } as FriendRow,
                    friendGameId,
                    true,
                    returnFocusKey
                );
            }
            else {
                goToFriends();
            }
            return;
        }

        goToAchievements("quick:tab:leaderboards");
    }, [
        friendGamePayloadRef,
        friendGameReturnGameIdRef,
        friendGameSourceRef,
        goToAchievements,
        goToFriends,
        loadFriendGame,
        returnToGameOverview,
        selectedFriend,
        selectedFriendRef,
        setFriendGameSource,
        setPendingFocusKey,
        setView
    ]);

    const backToLeaderboardsList = useCallback(() => {
        navIntentRef.current = "back";
        setView("leaderboards");
        setPendingFocusKey(`leaderboards:item:${selectedLeaderboardRef.current?.id ?? ""}`);
    }, [navIntentRef, setPendingFocusKey, setView]);

    const onOpenLeaderboardUserProfile = async (username: string) => {
        if (!username) {
            return;
        }
        setLeaderboardEntriesError(null);
        await openExternalUrl(raUserUrl(username));
    };

    return {
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
    };
}
