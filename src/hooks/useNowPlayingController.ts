import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFriendGameProgress, getGameComments, logFriendFetchDebug } from "../api";
import type {
    FriendGamePayload,
    FriendRow,
    NowPlayingCompareFilter,
    NowPlayingSubView
} from "../types";
import { useGameCommentsController } from "./useGameCommentsController";

const COMPARE_CACHE_TTL_MS = 5 * 60 * 1000;

type CompareKey = string;

type CompareCacheEntry = {
    payload: FriendGamePayload;
    fetchedAt: number;
};

type UseNowPlayingControllerArgs = {
    currentGameId: number | null;
    friendsRows: FriendRow[];
    isActive: boolean;
    commentsActive: boolean;
    dynamicComments: boolean;
    dynamicCommentsInitialRows: number;
    dynamicCommentsRowStep: number;
    legacyCommentsLoading: boolean;
};

function buildCompareKey(friendUsername: string, gameId: number) {
    return `${friendUsername.trim().toLowerCase()}:${gameId}`;
}

export function useNowPlayingController(args: UseNowPlayingControllerArgs) {
    const {
        currentGameId,
        friendsRows,
        isActive,
        commentsActive,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        legacyCommentsLoading
    } = args;

    const [compareFriendUsername, setCompareFriendUsername] = useState<string | null>(null);
    const [compareFilter, setCompareFilter] = useState<NowPlayingCompareFilter>("all");
    const [subView, setSubView] = useState<NowPlayingSubView>("compare");
    const [compareLoading, setCompareLoading] = useState(false);
    const [compareError, setCompareError] = useState<string | null>(null);
    const [comparePayload, setComparePayload] = useState<FriendGamePayload | null>(null);

    const cacheRef = useRef<Map<CompareKey, CompareCacheEntry>>(new Map());
    const fetchRunIdRef = useRef(0);
    const lastFetchKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!compareFriendUsername) {
            return;
        }
        if (friendsRows.length === 0) {
            return;
        }
        const lookupKey = compareFriendUsername.trim().toLowerCase();
        const stillFollowed = friendsRows.some((row) => {
            return !row.isSelf && row.username.trim().toLowerCase() === lookupKey;
        });
        if (!stillFollowed) {
            setCompareFriendUsername(null);
            setComparePayload(null);
            setCompareError(null);
            setCompareLoading(false);
        }
    }, [compareFriendUsername, friendsRows]);

    const compareFriendRow = useMemo(() => {
        if (!compareFriendUsername) {
            return null;
        }
        const lookupKey = compareFriendUsername.trim().toLowerCase();
        for (const row of friendsRows) {
            if (!row.isSelf && row.username.trim().toLowerCase() === lookupKey) {
                return row;
            }
        }
        return null;
    }, [compareFriendUsername, friendsRows]);

    const loadCompareData = useCallback(
        async (options: { forceRefresh?: boolean } = {}) => {
            const username = compareFriendUsername;
            const gameId = currentGameId;

            if (!username || gameId == null) {
                setComparePayload(null);
                setCompareError(null);
                setCompareLoading(false);
                return;
            }

            const key = buildCompareKey(username, gameId);
            const cached = cacheRef.current.get(key);
            const now = Date.now();
            const force = Boolean(options.forceRefresh);

            if (!force && cached && now - cached.fetchedAt < COMPARE_CACHE_TTL_MS) {
                setComparePayload(cached.payload);
                setCompareError(null);
                setCompareLoading(false);
                return;
            }

            const runId = fetchRunIdRef.current + 1;
            fetchRunIdRef.current = runId;
            lastFetchKeyRef.current = key;

            setCompareLoading(true);
            setCompareError(null);

            try {
                logFriendFetchDebug("compare", username, `game=${gameId} force=${force}`);
                const result = await getFriendGameProgress(username, gameId, force);
                if (fetchRunIdRef.current !== runId) {
                    return;
                }
                if (result.needsSettings) {
                    setCompareError(result.error || "Please enter your RetroAchievements username and Web API key.");
                    setCompareLoading(false);
                    return;
                }
                if (result.error && !result.payload) {
                    setCompareError(result.error);
                    setCompareLoading(false);
                    return;
                }
                if (result.payload) {
                    cacheRef.current.set(key, {
                        payload: result.payload,
                        fetchedAt: Date.now()
                    });
                    setComparePayload(result.payload);
                }
                if (result.error) {
                    setCompareError(result.error);
                }
                setCompareLoading(false);
            } catch (error: any) {
                if (fetchRunIdRef.current !== runId) {
                    return;
                }
                setCompareError(String(error?.message || error || "Couldn't load comparison data."));
                setCompareLoading(false);
            }
        },
        [compareFriendUsername, currentGameId]
    );

    useEffect(() => {
        if (!isActive) {
            return;
        }
        if (subView !== "compare") {
            return;
        }
        if (!compareFriendUsername || currentGameId == null) {
            setComparePayload(null);
            setCompareError(null);
            setCompareLoading(false);
            return;
        }
        const key = buildCompareKey(compareFriendUsername, currentGameId);
        if (lastFetchKeyRef.current === key && comparePayload) {
            return;
        }
        void loadCompareData();
    }, [isActive, subView, compareFriendUsername, currentGameId, comparePayload, loadCompareData]);

    const selectFriend = (username: string | null) => {
        const trimmed = (username || "").trim();
        if (!trimmed) {
            setCompareFriendUsername(null);
            setComparePayload(null);
            setCompareError(null);
            setCompareLoading(false);
            return;
        }
        if (trimmed.toLowerCase() !== (compareFriendUsername || "").trim().toLowerCase()) {
            setCompareError(null);
            setCompareLoading(true);
        }
        setCompareFriendUsername(trimmed);
    };

    const refreshCompareData = () => {
        return loadCompareData({ forceRefresh: true });
    };

    const commentsController = useGameCommentsController({
        isActive: commentsActive,
        id: currentGameId,
        ipc: getGameComments,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        surfaceKey: "comments:nowplaying",
        legacyLoading: legacyCommentsLoading,
        loadErrorMessage: "Couldn't load this game's comments.",
        loadMoreErrorMessage: "Couldn't load more comments."
    });
    const {
        state: {
            comments,
            commentsLoading,
            commentsLoadingMore,
            commentsError,
            commentsHasMore,
            commentsSort,
            commentsLoaded,
            commentsCardClaim,
            commentsPostClaim,
            commentsWindow,
            commentsNeedsSettings
        },
        actions: {
            setCommentsSort,
            loadMoreComments,
            captureComments,
            spendCommentsCardClaim,
            spendCommentsPostClaim
        }
    } = commentsController;

    const compareFriendUsernameRef = useRef<string | null>(compareFriendUsername);
    const compareFilterRef = useRef<NowPlayingCompareFilter>(compareFilter);
    const subViewRef = useRef<NowPlayingSubView>(subView);

    useEffect(() => {
        compareFriendUsernameRef.current = compareFriendUsername;
    }, [compareFriendUsername]);

    useEffect(() => {
        compareFilterRef.current = compareFilter;
    }, [compareFilter]);

    useEffect(() => {
        subViewRef.current = subView;
    }, [subView]);

    return {
        state: {
            compareFriendUsername,
            compareFriendRow,
            compareFilter,
            compareLoading,
            compareError,
            comparePayload,
            subView,
            comments,
            commentsLoading,
            commentsLoadingMore,
            commentsError,
            commentsHasMore,
            commentsSort,
            commentsLoaded,
            commentsCardClaim,
            commentsPostClaim,
            commentsWindow,
            commentsNeedsSettings
        },
        actions: {
            selectFriend,
            setCompareFilter,
            setSubView,
            refreshCompareData,
            setCommentsSort,
            loadMoreComments,
            captureComments,
            spendCommentsCardClaim,
            spendCommentsPostClaim
        },
        refs: {
            compareFriendUsernameRef,
            compareFilterRef,
            subViewRef
        }
    };
}
