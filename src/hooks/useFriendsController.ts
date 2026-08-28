import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import {
    fetchFriendAllGamesFull,
    getFriendGameProgress,
    getUserAwards,
    getUserWantToPlay,
    loadFriendsCache,
    loadGamesListCache,
    loadAwardsListCache,
    loadWantToPlayCache,
    logFriendFetchDebug,
    logWantToPlayDebug,
    patchFriendRow,
    refreshFriendRow,
    refreshFriends,
    refreshHealedUserAvatar,
    resolveFriendAvatar
} from "../api";

import type {
    FriendAllGameRow,
    FriendAllGamesPayload,
    FriendGamePayload,
    FriendGameSelectionMode,
    FriendGameSource,
    FriendRow,
    FriendsPayload,
    SocialView,
    UserAwardsPayload,
    ViewKey,
    WantToPlayPayload
} from "../types";

import type { NavIntent } from "../nav";
import { logError } from "../utils/errors";
import { findFriendRowIndex, sortFriendRowsForDisplay, userRefFor } from "../utils/friends";
import {
    t,
    type LanguageCode
} from "../locales";
import { useLatestRef } from "./useLatestRef";


type UseFriendsControllerArgs = {
    username: string;
    hasApiKey: boolean;
    language: LanguageCode;
    friendRefreshDelayMs: number;
    friendAutoRefresh: boolean;
    view: ViewKey;
    socialView: SocialView;
    settingsLoaded: boolean;
    settingsMode: boolean;
    mountedRef: RefObject<boolean>;
    navIntentRef: RefObject<NavIntent | null>;
    viewRef: RefObject<ViewKey>;
    pendingResumeFocusKeyRef: RefObject<string | null>;
    rootRef: RefObject<HTMLDivElement | null>;
    setSettingsMode: Dispatch<SetStateAction<boolean>>;
    setView: (next: ViewKey) => void;
    setPendingFocusKey: Dispatch<SetStateAction<string | null>>;
};

type FriendRowRefreshItem = {
    key: string;
    username: string;
    runId: number;
};

const FRIEND_ROW_REFRESH_QUEUE_MAX = 4;

function sortFriendAllGamesAlphabetically(results: FriendAllGameRow[]) {
    return [...results].sort((a, b) =>
        String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" })
    );
}

async function loadWarmProfilePayload<T>(
    ulid: string,
    readCache: (ulid: string) => Promise<{ hit: boolean; payload?: T }>,
    errorTag: string
): Promise<T | null> {
    try {
        const cached = await readCache(ulid);
        if (cached?.hit && cached.payload) {
            return cached.payload;
        }
    } catch (e) {
        logError(errorTag, e);
    }
    return null;
}

export function useFriendsController({
    username,
    hasApiKey,
    language,
    friendRefreshDelayMs,
    friendAutoRefresh,
    view,
    socialView,
    settingsLoaded,
    settingsMode,
    mountedRef,
    navIntentRef,
    viewRef,
    pendingResumeFocusKeyRef,
    rootRef,
    setSettingsMode,
    setView,
    setPendingFocusKey
}: UseFriendsControllerArgs) {
    const [friendsPayload, setFriendsPayload] = useState<FriendsPayload | null>(null);
    const [friendsLoaded, setFriendsLoaded] = useState(false);
    const [friendsRefreshing, setFriendsRefreshing] = useState(false);
    const [friendsError, setFriendsError] = useState<string | null>(null);
    const [liveRefreshingFriendUsernames, setLiveRefreshingFriendUsernames] = useState<Set<string>>(() => new Set());
    const [selectedFriend, setSelectedFriend] = useState<FriendRow | null>(null);

    const [friendGamePayload, setFriendGamePayload] = useState<FriendGamePayload | null>(null);
    const [friendGameLoading, setFriendGameLoading] = useState(false);
    const [friendProfileOverlayText, setFriendProfileOverlayText] = useState<string | null>(null);
    const [friendGameError, setFriendGameError] = useState<string | null>(null);

    const [friendAllGamesPayload, setFriendAllGamesPayload] = useState<FriendAllGamesPayload | null>(null);
    const [friendAllGamesLoading, setFriendAllGamesLoading] = useState(false);
    const [friendAllGamesError, setFriendAllGamesError] = useState<string | null>(null);
    const [userAwardsPayload, setUserAwardsPayload] = useState<UserAwardsPayload | null>(null);
    const [userAwardsLoading, setUserAwardsLoading] = useState(false);
    const [userAwardsError, setUserAwardsError] = useState<string | null>(null);
    const [wantToPlayPayload, setWantToPlayPayload] = useState<WantToPlayPayload | null>(null);
    const [wantToPlayLoading, setWantToPlayLoading] = useState(false);
    const [wantToPlayError, setWantToPlayError] = useState<string | null>(null);
    const [recentGamesExpanded, setRecentGamesExpanded] = useState(false);
    const [friendGameSource, setFriendGameSource] = useState<FriendGameSource>("recentGames");
    const [friendGameSelectionMode, setFriendGameSelectionMode] = useState<FriendGameSelectionMode>("auto");

    const friendsRefreshBusyRef = useRef(false);
    const friendGameBusyRef = useRef(false);
    const friendAllGamesBusyRef = useRef(false);
    const userAwardsBusyRef = useRef(false);
    const wantToPlayBusyRef = useRef(false);
    const friendsRefreshedThisSessionRef = useRef(false);
    const friendGameSessionRefreshKeysRef = useRef<Set<string>>(new Set());
    const friendRowRefreshRunIdRef = useRef(0);
    const friendPauseRefreshTimerRef = useRef<number | null>(null);
    const pendingPauseRefreshUsernameRef = useRef<string | null>(null);
    const friendRowRefreshQueueRef = useRef<FriendRowRefreshItem[]>([]);
    const friendRowRefreshProcessingRef = useRef(false);
    const inFlightFriendRowKeyRef = useRef<string | null>(null);
    const friendRowsRefreshedThisEntryRef = useRef<Set<string>>(new Set());
    const lastDetectedFriendSelectionKeyRef = useRef<string | null>(null);
    const hoveredFriendSelectionKeyRef = useRef<string | null>(null);
    const friendFocusDetectionSuppressedUntilRef = useRef<number>(0);

    const selectedFriendRef = useLatestRef(selectedFriend);
    const friendsPayloadRef = useLatestRef(friendsPayload);
    const friendGamePayloadRef = useLatestRef(friendGamePayload);
    const friendAllGamesPayloadRef = useLatestRef(friendAllGamesPayload);
    const friendGameSourceRef = useLatestRef(friendGameSource);
    const friendGameSelectionModeRef = useLatestRef(friendGameSelectionMode);

    const applyFriendRowUpdate = useCallback((updatedRow?: FriendRow | null, nextPayload?: FriendsPayload | null) => {
        if (!updatedRow && !nextPayload) {
            return;
        }

        if (nextPayload) {
            setFriendsPayload(nextPayload);
            if (updatedRow && selectedFriendRef.current?.username === updatedRow.username) {
                setSelectedFriend(updatedRow);
            }
            else if (selectedFriendRef.current) {
                const refreshedSelectedFriend =
                    nextPayload.friends.find(
                        (row: FriendRow) => row.username === selectedFriendRef.current?.username
                    ) || null;
                if (refreshedSelectedFriend) {
                    setSelectedFriend(refreshedSelectedFriend);
                }
            }
            return;
        }

        if (!updatedRow) {
            return;
        }

        setFriendsPayload((current: FriendsPayload | null) => {
            if (!current) {
                return current;
            }
            const targetIndex = findFriendRowIndex(current.friends, { username: updatedRow.username, ulid: updatedRow.ulid });
            const nextFriends = current.friends.slice();
            if (targetIndex >= 0) {
                nextFriends[targetIndex] = { ...nextFriends[targetIndex], ...updatedRow };
            }
            else {
                nextFriends.push(updatedRow);
            }
            return {
                ...current,
                friends: nextFriends,
                count: nextFriends.length,
                refreshedAt: Math.floor(Date.now() / 1000)
            };
        });

        if (selectedFriendRef.current?.username === updatedRow.username) {
            setSelectedFriend(updatedRow);
        }
    }, []);

    const cancelPendingFriendPauseRefresh = useCallback(() => {
        if (friendPauseRefreshTimerRef.current !== null) {
            window.clearTimeout(friendPauseRefreshTimerRef.current);
            friendPauseRefreshTimerRef.current = null;
        }
        pendingPauseRefreshUsernameRef.current = null;
    }, []);

    const noteFriendRowHover = (friend: FriendRow) => {
        const key = String(friend?.username || "").trim().toLowerCase();
        hoveredFriendSelectionKeyRef.current = key || null;
    };

    const clearFriendRowHover = (friend: FriendRow) => {
        const key = String(friend?.username || "").trim().toLowerCase();
        if (hoveredFriendSelectionKeyRef.current === key) {
            hoveredFriendSelectionKeyRef.current = null;
        }
    };

    const resolveAvatarInFlightRef = useRef(false);

    const resolveFriendAvatarNow = useCallback(async (friend: FriendRow) => {
        const username = String(friend?.username || "").trim();
        if (!username || resolveAvatarInFlightRef.current) {
            return;
        }
        resolveAvatarInFlightRef.current = true;
        try {
            await resolveFriendAvatar(String(friend?.ulid || "").trim(), username);
            await refreshHealedUserAvatar(username);
        }
        catch (e) {
            logError("resolveFriendAvatarNow", e);
        }
        finally {
            resolveAvatarInFlightRef.current = false;
        }
    }, []);

    const markFriendRowRefreshing = useCallback((displayUsername: string) => {
        setLiveRefreshingFriendUsernames((current) => {
            if (current.has(displayUsername)) {
                return current;
            }
            const next = new Set(current);
            next.add(displayUsername);
            return next;
        });
    }, []);

    const clearFriendRowRefreshing = useCallback((displayUsername: string) => {
        setLiveRefreshingFriendUsernames((current) => {
            if (!current.has(displayUsername)) {
                return current;
            }
            const next = new Set(current);
            next.delete(displayUsername);
            return next;
        });
    }, []);

    const processFriendRowRefreshQueue = useCallback(async () => {
        if (friendRowRefreshProcessingRef.current) {
            return;
        }
        if (friendsRefreshBusyRef.current) {
            return;
        }

        friendRowRefreshProcessingRef.current = true;
        try {
            while (friendRowRefreshQueueRef.current.length > 0) {
                if (!mountedRef.current || viewRef.current !== "social") {
                    break;
                }

                const item = friendRowRefreshQueueRef.current.shift();
                if (!item) {
                    break;
                }
                if (item.runId !== friendRowRefreshRunIdRef.current) {
                    clearFriendRowRefreshing(item.username);
                    continue;
                }
                if (friendRowsRefreshedThisEntryRef.current.has(item.key)) {
                    clearFriendRowRefreshing(item.username);
                    continue;
                }

                inFlightFriendRowKeyRef.current = item.key;
                try {
                    const result = await refreshFriendRow(item.username);
                    if (!mountedRef.current || viewRef.current !== "social") {
                        break;
                    }
                    if (item.runId !== friendRowRefreshRunIdRef.current) {
                        continue;
                    }
                    if (result.needsSettings) {
                        setSettingsMode(true);
                        if (result.error) {
                            setFriendsError(result.error);
                        }
                        friendRowRefreshQueueRef.current = [];
                        setLiveRefreshingFriendUsernames((current) => (current.size === 0 ? current : new Set()));
                        break;
                    }
                    if (result.error) {
                        setFriendsError(result.error);
                    }
                    applyFriendRowUpdate(result.row ?? null);
                    friendRowsRefreshedThisEntryRef.current.add(item.key);
                } catch (e: any) {
                    logError("processFriendRowRefreshQueue", e);
                    if (mountedRef.current) {
                        setFriendsError(String(e?.message || e || "Couldn't reach RetroAchievements while refreshing this friend."));
                    }
                } finally {
                    inFlightFriendRowKeyRef.current = null;
                    clearFriendRowRefreshing(item.username);
                }
            }
        } finally {
            friendRowRefreshProcessingRef.current = false;
        }
    }, [applyFriendRowUpdate, clearFriendRowRefreshing, mountedRef, setSettingsMode, viewRef]);

    const enqueueFriendRowRefresh = useCallback((displayUsername: string, key: string) => {
        const queue = friendRowRefreshQueueRef.current;
        if (inFlightFriendRowKeyRef.current === key) {
            return;
        }
        if (queue.some((item) => item.key === key)) {
            return;
        }

        queue.push({
            key,
            username: displayUsername,
            runId: friendRowRefreshRunIdRef.current
        });
        markFriendRowRefreshing(displayUsername);

        const maxWaiting = FRIEND_ROW_REFRESH_QUEUE_MAX - (inFlightFriendRowKeyRef.current ? 1 : 0);
        while (queue.length > maxWaiting) {
            const dropped = queue.shift();
            if (dropped) {
                clearFriendRowRefreshing(dropped.username);
            }
        }

        void processFriendRowRefreshQueue();
    }, [clearFriendRowRefreshing, markFriendRowRefreshing, processFriendRowRefreshQueue]);

    const refreshFriendsQuietly = async (force = false) => {
        if (friendsRefreshBusyRef.current) {
            return false;
        }
        if (!username.trim() || !hasApiKey) {
            return false;
        }

        friendsRefreshBusyRef.current = true;
        setFriendsRefreshing(true);
        setFriendsError(null);

        try {
            const refreshRunId = friendRowRefreshRunIdRef.current;
            const result = await refreshFriends(force);
            if (!mountedRef.current) {
                return false;
            }
            if (result.needsSettings) {
                setSettingsMode(true);
                if (result.error) {
                    setFriendsError(result.error);
                }
                return false;
            }

            if (result.payload) {
                const profileDetouredMidFetch = refreshRunId !== friendRowRefreshRunIdRef.current;
                const viewedFriend = profileDetouredMidFetch ? selectedFriendRef.current : null;
                if (viewedFriend) {
                    const viewedKey = viewedFriend.username.trim().toLowerCase();
                    const mergedFriends = result.payload.friends.map((row: FriendRow) => {
                        if (row.username.trim().toLowerCase() !== viewedKey) {
                            return row;
                        }
                        return {
                            ...row,
                            statusText: viewedFriend.statusText || row.statusText,
                            richPresence: viewedFriend.richPresence || row.richPresence,
                            lastGameTitle: viewedFriend.lastGameTitle ?? row.lastGameTitle,
                            lastGameId: viewedFriend.lastGameId ?? row.lastGameId
                        };
                    });
                    setFriendsPayload({ ...result.payload, friends: mergedFriends });
                } else {
                    setFriendsPayload(result.payload);
                }
                setFriendsLoaded(true);
                if (username.trim()) {
                    const selfKey = username.trim().toLowerCase();
                    friendRowsRefreshedThisEntryRef.current.add(selfKey);
                }
                if (selectedFriendRef.current && refreshRunId === friendRowRefreshRunIdRef.current) {
                    const updatedFriend =
                        result.payload.friends.find(
                            (row: FriendRow) => row.username === selectedFriendRef.current?.username
                        ) || null;
                    if (updatedFriend) {
                        setSelectedFriend(updatedFriend);
                    }
                }
            }
            if (result.error) {
                setFriendsError(result.error);
            }
            return Boolean(result.changed);
        } catch (e: any) {
            logError("refreshFriendsQuietly", e);
            if (mountedRef.current) {
                setFriendsError(String(e?.message || e || "Couldn't reach RetroAchievements while refreshing your friends list."));
            }
            return false;
        } finally {
            friendsRefreshBusyRef.current = false;
            if (mountedRef.current) {
                setFriendsRefreshing(false);
            }
            void processFriendRowRefreshQueue();
        }
    };

    const loadFriendsFromCache = useCallback(async () => {
        try {
            const result = await loadFriendsCache();
            if (!mountedRef.current) {
                return;
            }
            if (result?.payload) {
                setFriendsPayload(result.payload);
                setFriendsLoaded(true);
            } else {
                setFriendsLoaded(true);
            }
        } catch (e: any) {
            logError("loadFriendsFromCache", e);
        }
    }, [mountedRef]);

    const scheduleFriendPauseRefresh = useCallback(
        (friend: FriendRow) => {
            if (!username.trim() || !hasApiKey || viewRef.current !== "social") {
                return;
            }

            if (!friendAutoRefresh) {
                return;
            }

            const targetUsername = String(friend?.username || "").trim();
            if (!targetUsername) {
                return;
            }
            const targetKey = targetUsername.toLowerCase();
            lastDetectedFriendSelectionKeyRef.current = targetKey;

            if (friendRowsRefreshedThisEntryRef.current.has(targetKey)) {
                cancelPendingFriendPauseRefresh();
                return;
            }

            if (pendingPauseRefreshUsernameRef.current === targetKey) {
                return;
            }

            cancelPendingFriendPauseRefresh();
            pendingPauseRefreshUsernameRef.current = targetKey;
            friendPauseRefreshTimerRef.current = window.setTimeout(() => {
                friendPauseRefreshTimerRef.current = null;
                if (pendingPauseRefreshUsernameRef.current === targetKey) {
                    pendingPauseRefreshUsernameRef.current = null;
                }
                if (!mountedRef.current || viewRef.current !== "social") {
                    return;
                }
                if (friendRowsRefreshedThisEntryRef.current.has(targetKey)) {
                    return;
                }
                enqueueFriendRowRefresh(targetUsername, targetKey);
            }, friendRefreshDelayMs);
        },
        [
            cancelPendingFriendPauseRefresh,
            enqueueFriendRowRefresh,
            friendRefreshDelayMs,
            friendAutoRefresh,
            hasApiKey,
            mountedRef,
            username,
            viewRef
        ]
    );

    const handleDetectedFriendSelectionKey = useCallback(
        (detectedKey?: string | null) => {
            if (viewRef.current !== "social") {
                return;
            }
            const normalizedKey = String(detectedKey || "")
                .trim()
                .toLowerCase();
            if (!normalizedKey || normalizedKey === lastDetectedFriendSelectionKeyRef.current) {
                return;
            }

            if (Date.now() < friendFocusDetectionSuppressedUntilRef.current) {
                lastDetectedFriendSelectionKeyRef.current = normalizedKey;
                return;
            }

            lastDetectedFriendSelectionKeyRef.current = normalizedKey;
            const matchedFriend = (friendsPayload?.friends ?? []).find(
                (row: FriendRow) =>
                    String(row.username || "")
                        .trim()
                        .toLowerCase() === normalizedKey
            );
            if (matchedFriend) {
                scheduleFriendPauseRefresh(matchedFriend);
            }
        },
        [friendsPayload, scheduleFriendPauseRefresh, viewRef]
    );

    const friendsRows = useMemo(() => sortFriendRowsForDisplay(friendsPayload?.friends ?? []), [friendsPayload]);

    const extractFriendSelectionKey = useCallback((focusKey?: string | null) => {
        const normalized = String(focusKey || "").trim();
        return normalized.startsWith("friend:") ? normalized.slice(7).toLowerCase() : null;
    }, []);

    const detectSelectedFriendSelectionKey = useCallback(() => {
        const searchRoot = rootRef.current;
        if (!searchRoot) {
            return null;
        }

        if (hoveredFriendSelectionKeyRef.current) {
            return hoveredFriendSelectionKeyRef.current;
        }

        const selectors = [
            '[data-focus-key^="friend:"] button[tabindex="0"]',
            '[data-focus-key^="friend:"] [tabindex="0"]',
            '[data-focus-key^="friend:"] button[aria-selected="true"]',
            '[data-focus-key^="friend:"][aria-selected="true"]',
            '[data-focus-key^="friend:"] button[aria-current="true"]',
            '[data-focus-key^="friend:"][aria-current="true"]',
            '[data-focus-key^="friend:"] button[class*="gpfocus"]',
            '[data-focus-key^="friend:"][class*="gpfocus"]',
            '[data-focus-key^="friend:"] button[class*="GPFocus"]',
            '[data-focus-key^="friend:"][class*="GPFocus"]'
        ];

        for (const selector of selectors) {
            const match = searchRoot.querySelector(selector) as HTMLElement | null;
            const focusContainer = match?.closest?.('[data-focus-key^="friend:"]') as HTMLElement | null;
            const selectionKey = extractFriendSelectionKey(focusContainer?.getAttribute("data-focus-key"));
            if (selectionKey) {
                return selectionKey;
            }
        }

        const active = document.activeElement as HTMLElement | null;
        if (active && searchRoot.contains(active)) {
            const focusContainer = active.closest?.('[data-focus-key^="friend:"]') as HTMLElement | null;
            const selectionKey = extractFriendSelectionKey(focusContainer?.getAttribute("data-focus-key"));
            if (selectionKey) {
                return selectionKey;
            }
        }

        return null;
    }, [extractFriendSelectionKey, rootRef]);

    useEffect(() => {
        if (view !== "friendGame") {
            setRecentGamesExpanded(false);
        }
    }, [view]);

    useEffect(() => {
        if (view !== "social" || !friendsLoaded || friendsRows.length === 0) {
            return;
        }
        if (socialView !== "friends" && socialView !== "favorites") {
            return;
        }

        const intervalId = window.setInterval(() => {
            if (document.visibilityState !== "visible") {
                return;
            }
            handleDetectedFriendSelectionKey(detectSelectedFriendSelectionKey());
        }, 150);

        return () => {
            window.clearInterval(intervalId);
            hoveredFriendSelectionKeyRef.current = null;
        };
    }, [view, socialView, friendsLoaded, friendsRows, detectSelectedFriendSelectionKey, handleDetectedFriendSelectionKey]);

    const loadFriendGame = useCallback(
        async (
            friend: FriendRow,
            gameId?: number | null,
            force = false,
            focusTarget: string = "friendgame:back",
            suppressViewChange = false,
            navIntent: NavIntent | null = null
        ) => {
            if (friendGameBusyRef.current || !friend?.username) {
                return;
            }
            const latestFriend =
                (friendsPayload?.friends ?? []).find((row: FriendRow) => row.username === friend.username) || friend;
            const effectiveGameId = gameId ?? null;
            const normalizedUsername = latestFriend.username.toLowerCase();
            const requestedSessionKey = `${normalizedUsername}:${effectiveGameId ?? "none"}`;
            const loadedSelectedGameId = friendGamePayloadRef.current?.selectedGameId ?? null;
            const loadedSessionKey = `${normalizedUsername}:${loadedSelectedGameId ?? "none"}`;
            const sameLoadedProfile =
                viewRef.current === "friendGame" &&
                selectedFriendRef.current?.username?.toLowerCase() === normalizedUsername &&
                friendGamePayloadRef.current != null &&
                loadedSessionKey === requestedSessionKey;

            if (!force && sameLoadedProfile) {
                setSelectedFriend(latestFriend);
                if (!suppressViewChange) {
                    if (navIntent) {
                        navIntentRef.current = navIntent;
                    }
                    setView("friendGame");
                    setPendingFocusKey(focusTarget || "friendgame:back");
                }
                return;
            }

            const shouldForce =
                force || gameId == null || !friendGameSessionRefreshKeysRef.current.has(requestedSessionKey);
            friendGameBusyRef.current = true;
            setFriendProfileOverlayText(t(language, "Loading User Info..."));
            setFriendGameLoading(true);
            setFriendGameError(null);
            setWantToPlayError(null);
            setRecentGamesExpanded(false);
            setFriendGamePayload(null);
            setSelectedFriend(latestFriend);

            try {
                let forceReason = "cached";
                if (force) {
                    forceReason = "caller";
                } else if (gameId == null) {
                    forceReason = "nogame";
                } else if (!friendGameSessionRefreshKeysRef.current.has(requestedSessionKey)) {
                    forceReason = "session";
                }
                logFriendFetchDebug(
                    "profile",
                    userRefFor(latestFriend),
                    `game=${effectiveGameId ?? "(none)"} force=${shouldForce} why=${forceReason}`
                );
                const result = await getFriendGameProgress(userRefFor(latestFriend), effectiveGameId, shouldForce);
                if (!mountedRef.current) {
                    return;
                }
                if (result.needsSettings) {
                    setSettingsMode(true);
                    if (result.error) {
                        setFriendGameError(result.error);
                    }
                }
                else {
                    let normalizedPayload = result.payload ?? null;

                    if (normalizedPayload && shouldForce && effectiveGameId == null) {
                        const freshestRecentGame = normalizedPayload.recentGames?.[0] ?? null;
                        const freshestPayloadGameId = normalizedPayload.payload?.gameId ?? null;
                        const freshestSelectedGameId =
                            freshestPayloadGameId ??
                            normalizedPayload.selectedGameId ??
                            freshestRecentGame?.gameId ??
                            null;
                        const freshestSelectedGameTitle =
                            normalizedPayload.payload?.title ??
                            normalizedPayload.recentGames?.find((game) => game.gameId === freshestSelectedGameId)
                                ?.title ??
                            freshestRecentGame?.title ??
                            normalizedPayload.selectedGameTitle ??
                            null;

                        normalizedPayload = {
                            ...normalizedPayload,
                            selectedGameId: freshestSelectedGameId,
                            selectedGameTitle: freshestSelectedGameTitle
                        };
                    }

                    setFriendGamePayload(normalizedPayload);

                    if (normalizedPayload) {
                        const freshestRecentGame = normalizedPayload?.recentGames?.[0] ?? null;
                        const currentSelected = selectedFriendRef.current;
                        const baseRow =
                            currentSelected && currentSelected.username === latestFriend.username
                                ? currentSelected
                                : latestFriend;
                        const payloadKnowsCurrentGame = effectiveGameId == null;
                        const nextLastGameTitle = payloadKnowsCurrentGame
                            ? normalizedPayload?.payload?.title ??
                              normalizedPayload?.selectedGameTitle ??
                              freshestRecentGame?.title ??
                              baseRow.lastGameTitle
                            : baseRow.lastGameTitle;
                        const nextLastGameId = payloadKnowsCurrentGame
                            ? normalizedPayload?.payload?.gameId ??
                              normalizedPayload?.selectedGameId ??
                              freshestRecentGame?.gameId ??
                              baseRow.lastGameId
                            : baseRow.lastGameId;
                        const freshenedRow: FriendRow = {
                            ...baseRow,
                            ulid: baseRow.ulid || normalizedPayload?.ulid || null,
                            statusText:
                                normalizedPayload?.statusText ||
                                normalizedPayload?.richPresence ||
                                baseRow.statusText,
                            richPresence: normalizedPayload?.richPresence || baseRow.richPresence,
                            lastGameTitle: nextLastGameTitle,
                            lastGameId: nextLastGameId,
                            points: normalizedPayload?.points ?? baseRow.points,
                            pointsSoftcore: normalizedPayload?.pointsSoftcore ?? baseRow.pointsSoftcore,
                            totalTruePoints: normalizedPayload?.totalTruePoints ?? baseRow.totalTruePoints
                        };

                        setSelectedFriend(freshenedRow);
                        const onRoster =
                            findFriendRowIndex(friendsPayloadRef.current?.friends ?? [], {
                                username: freshenedRow.username,
                                ulid: freshenedRow.ulid
                            }) >= 0;
                        if (onRoster) {
                            applyFriendRowUpdate(freshenedRow);
                            void patchFriendRow(freshenedRow).catch((e: any) => logError("patchFriendRow", e));
                        }
                    }

                    if (normalizedPayload?.selectedGameId !== undefined) {
                        const loadedGameId = normalizedPayload?.selectedGameId ?? effectiveGameId;
                        friendGameSessionRefreshKeysRef.current.add(
                            `${latestFriend.username.toLowerCase()}:${loadedGameId ?? "none"}`
                        );
                    }
                    else {
                        friendGameSessionRefreshKeysRef.current.add(requestedSessionKey);
                    }
                    if (result.error) {
                        setFriendGameError(result.error);
                    }
                    if (!suppressViewChange) {
                        if (navIntent) {
                            navIntentRef.current = navIntent;
                        }
                        setView("friendGame");
                        const nextFocusKey = pendingResumeFocusKeyRef.current || focusTarget;
                        if (nextFocusKey) {
                            setPendingFocusKey(nextFocusKey);
                        }
                        pendingResumeFocusKeyRef.current = null;
                    }
                }
            } catch (e: any) {
                logError("loadFriendGame", e);
                if (mountedRef.current) {
                    setFriendGameError(String(e?.message || e || "Couldn't reach RetroAchievements while loading this friend's progress."));
                }
            } finally {
                friendGameBusyRef.current = false;
                if (mountedRef.current) {
                    setFriendGameLoading(false);
                    setFriendProfileOverlayText(null);
                }
            }
        },
        [
            applyFriendRowUpdate,
            friendsPayload,
            language,
            mountedRef,
            navIntentRef,
            pendingResumeFocusKeyRef,
            setPendingFocusKey,
            setSettingsMode,
            setView,
            viewRef
        ]
    );

    const applyFriendAllGamesPayload = useCallback(
        (payload: FriendAllGamesPayload) => {
            setFriendAllGamesPayload({
                ...payload,
                results: sortFriendAllGamesAlphabetically(payload.results)
            });
            setView("friendAllGames");
            const nextFocusKey = pendingResumeFocusKeyRef.current || "friendallgames:back";
            setPendingFocusKey(nextFocusKey);
            pendingResumeFocusKeyRef.current = null;
        },
        [pendingResumeFocusKeyRef, setPendingFocusKey, setView]
    );

    const loadFriendAllGames = async (friend: FriendRow, _offset = 0, _count = 500): Promise<number> => {
        if (!friend?.username) {
            return 0;
        }
        if (friendAllGamesBusyRef.current) {
            return 0;
        }
        friendAllGamesBusyRef.current = true;
        setFriendAllGamesError(null);
        setSelectedFriend(friend);

        const ref = userRefFor(friend);
        const ulid = friend.ulid ?? null;

        try {
            if (ulid) {
                const cached = await loadWarmProfilePayload(ulid, loadGamesListCache, "loadGamesListCache");
                if (cached && mountedRef.current) {
                    applyFriendAllGamesPayload(cached);
                    return cached.results.length;
                }
            }

            setFriendProfileOverlayText(t(language, "Loading All Games..."));
            setFriendAllGamesLoading(true);
            const result = await fetchFriendAllGamesFull(ref, ulid ?? "");
            if (!mountedRef.current) {
                return 0;
            }
            if (result.needsSettings) {
                setSettingsMode(true);
                if (result.error) {
                    setFriendAllGamesError(result.error);
                }
                return 0;
            }
            if (result.payload) {
                applyFriendAllGamesPayload(result.payload);
                if (result.error) {
                    setFriendAllGamesError(result.error);
                }
                return result.payload.results.length;
            }
            if (result.error) {
                setFriendAllGamesError(result.error);
            }
            return 0;
        } catch (e: any) {
            logError("loadFriendAllGames", e);
            if (mountedRef.current) {
                setFriendAllGamesError(String(e?.message || e || "Couldn't load this friend's full game list."));
            }
            return 0;
        } finally {
            friendAllGamesBusyRef.current = false;
            if (mountedRef.current) {
                setFriendAllGamesLoading(false);
                setFriendProfileOverlayText(null);
            }
        }
    };

    const loadUserAwards = useCallback(
        async (awardsUsername: string, ulid: string = "", suppressViewChange = false): Promise<void> => {
            const targetUsername = String(awardsUsername || "").trim();
            if (!targetUsername) {
                return;
            }
            if (userAwardsBusyRef.current) {
                return;
            }
            const awardsUlid = String(ulid || "").trim();

            userAwardsBusyRef.current = true;
            setUserAwardsError(null);

            try {
                if (awardsUlid) {
                    const cached = await loadWarmProfilePayload(awardsUlid, loadAwardsListCache, "loadAwardsListCache");
                    if (cached && mountedRef.current) {
                        setUserAwardsPayload(cached);
                        if (!suppressViewChange) {
                            setView("badges");
                            setPendingFocusKey("badges:back");
                        }
                        return;
                    }
                }

                setFriendProfileOverlayText(t(language, "Loading awards..."));
                setUserAwardsLoading(true);
                const result = await getUserAwards(targetUsername, awardsUlid);
                if (!mountedRef.current) {
                    return;
                }
                if (result.needsSettings) {
                    setSettingsMode(true);
                    if (result.error) {
                        setUserAwardsError(result.error);
                    }
                    return;
                }
                if (result.payload) {
                    setUserAwardsPayload(result.payload);
                    if (!suppressViewChange) {
                        setView("badges");
                        setPendingFocusKey("badges:back");
                    }
                    if (result.error) {
                        setUserAwardsError(result.error);
                    }
                    return;
                }
                if (result.error) {
                    setUserAwardsError(result.error);
                }
            } catch (e: any) {
                logError("loadUserAwards", e);
                if (mountedRef.current) {
                    setUserAwardsError(String(e?.message || e || "Couldn't load this user's badge collection."));
                }
            } finally {
                userAwardsBusyRef.current = false;
                if (mountedRef.current) {
                    setUserAwardsLoading(false);
                    setFriendProfileOverlayText(null);
                }
            }
        },
        [language, mountedRef, setPendingFocusKey, setSettingsMode, setView]
    );

    const loadUserWantToPlay = useCallback(
        async (wantToPlayUsername: string, ulid: string = ""): Promise<void> => {
            const targetUsername = String(wantToPlayUsername || "").trim();
            if (!targetUsername) {
                return;
            }
            if (wantToPlayBusyRef.current) {
                logWantToPlayDebug("skip-busy", targetUsername);
                return;
            }
            const wantToPlayUlid = String(ulid || "").trim();

            wantToPlayBusyRef.current = true;
            logWantToPlayDebug("open", targetUsername);
            const startedAt = Date.now();

            try {
                if (wantToPlayUlid) {
                    const cached = await loadWarmProfilePayload(
                        wantToPlayUlid,
                        loadWantToPlayCache,
                        "loadWantToPlayCache"
                    );
                    if (cached && mountedRef.current) {
                        logWantToPlayDebug(
                            "cache-hit",
                            targetUsername,
                            `results=${cached.results.length} ms=${Date.now() - startedAt}`
                        );
                        setWantToPlayPayload(cached);
                        setWantToPlayError(null);
                        setView("wantToPlay");
                        const warmFocusKey = pendingResumeFocusKeyRef.current || "wanttoplay:back";
                        setPendingFocusKey(warmFocusKey);
                        pendingResumeFocusKeyRef.current = null;
                        return;
                    }
                }

                setFriendProfileOverlayText(t(language, "Loading want-to-play list..."));
                setWantToPlayLoading(true);
                setWantToPlayError(null);
                const result = await getUserWantToPlay(targetUsername, 0, 500, wantToPlayUlid);
                if (!mountedRef.current) {
                    logWantToPlayDebug("unmounted", targetUsername, `ms=${Date.now() - startedAt}`);
                    return;
                }
                if (result.needsSettings) {
                    logWantToPlayDebug("needs-settings", targetUsername, `ms=${Date.now() - startedAt}`);
                    setSettingsMode(true);
                    if (result.error) {
                        setWantToPlayError(result.error);
                    }
                    return;
                }
                if (result.payload) {
                    logWantToPlayDebug(
                        "payload",
                        targetUsername,
                        `results=${result.payload.results.length} total=${result.payload.total} ms=${Date.now() - startedAt}`
                    );
                    setWantToPlayPayload(result.payload);
                    setView("wantToPlay");
                    const nextFocusKey = pendingResumeFocusKeyRef.current || "wanttoplay:back";
                    setPendingFocusKey(nextFocusKey);
                    pendingResumeFocusKeyRef.current = null;
                    if (result.error) {
                        setWantToPlayError(result.error);
                    }
                    return;
                }
                if (result.error) {
                    logWantToPlayDebug("error", targetUsername, `ms=${Date.now() - startedAt}`);
                    setWantToPlayError(result.error);
                    return;
                }
                logWantToPlayDebug("empty-result", targetUsername, `ms=${Date.now() - startedAt}`);
            } catch (e: any) {
                logError("loadUserWantToPlay", e);
                if (mountedRef.current) {
                    setWantToPlayError(String(e?.message || e || "Couldn't load this user's want-to-play list."));
                }
            } finally {
                wantToPlayBusyRef.current = false;
                if (mountedRef.current) {
                    setWantToPlayLoading(false);
                    setFriendProfileOverlayText(null);
                }
            }
        },
        [language, mountedRef, pendingResumeFocusKeyRef, setPendingFocusKey, setSettingsMode, setView]
    );

    const goToFriends = useCallback(() => {
        cancelPendingFriendPauseRefresh();
        friendRowRefreshQueueRef.current = [];
        setLiveRefreshingFriendUsernames(new Set());
        setView("social");
        setPendingFocusKey("social:back");
        friendRowsRefreshedThisEntryRef.current = new Set();
        lastDetectedFriendSelectionKeyRef.current = null;
    }, [cancelPendingFriendPauseRefresh, setPendingFocusKey, setView]);

    const resetFriendEntryRefreshTracking = () => {
        friendRowsRefreshedThisEntryRef.current = new Set();
        lastDetectedFriendSelectionKeyRef.current = null;
        friendRowRefreshQueueRef.current = [];
        setLiveRefreshingFriendUsernames(new Set());
    };

    const suppressFriendFocusDetectionForTabSwitch = useCallback(() => {
        friendFocusDetectionSuppressedUntilRef.current = Date.now() + 500;
    }, []);

    useEffect(() => {
        if (!settingsLoaded || settingsMode || view !== "social" || !username.trim() || !hasApiKey) {
            return;
        }
        if (friendsRefreshedThisSessionRef.current) {
            return;
        }
        friendsRefreshedThisSessionRef.current = true;
        resetFriendEntryRefreshTracking();
        cancelPendingFriendPauseRefresh();
        if (friendAutoRefresh) {
            void refreshFriendsQuietly(false);
        } else {
            void loadFriendsFromCache();
        }
    }, [view, settingsLoaded, settingsMode, username, hasApiKey, friendAutoRefresh, loadFriendsFromCache, cancelPendingFriendPauseRefresh]);

    useEffect(() => {
        if (view === "social") {
            return;
        }
        cancelPendingFriendPauseRefresh();
        resetFriendEntryRefreshTracking();
        friendRowRefreshRunIdRef.current += 1;
        friendsRefreshBusyRef.current = false;
        if (friendsRefreshing) {
            setFriendsRefreshing(false);
        }
    }, [view, friendsRefreshing, cancelPendingFriendPauseRefresh]);

    useEffect(() => {
        if (view === "friendGame" || view === "friendAllGames") {
            return;
        }
        friendGameSessionRefreshKeysRef.current = new Set();
    }, [view]);

    useEffect(() => {
        function onVisibilityChange() {
            if (document.visibilityState === "visible") {
                return;
            }
            friendRowRefreshQueueRef.current = [];
            setLiveRefreshingFriendUsernames((current) => (current.size === 0 ? current : new Set()));
        }
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, []);

    return {
        state: {
            friendsPayload,
            friendsLoaded,
            friendsRefreshing,
            friendsError,
            liveRefreshingFriendUsernames,
            selectedFriend,
            friendGamePayload,
            friendGameLoading,
            friendProfileOverlayText,
            friendGameError,
            friendAllGamesPayload,
            friendAllGamesLoading,
            friendAllGamesError,
            userAwardsPayload,
            userAwardsLoading,
            userAwardsError,
            wantToPlayPayload,
            wantToPlayLoading,
            wantToPlayError,
            recentGamesExpanded,
            friendGameSource,
            friendGameSelectionMode,
            friendsRows
        },
        actions: {
            setFriendsPayload,
            setFriendsLoaded,
            setFriendsError,
            setFriendsRefreshing,
            setSelectedFriend,
            setFriendGamePayload,
            setFriendGameError,
            setRecentGamesExpanded,
            setFriendGameSource,
            setFriendGameSelectionMode,
            scheduleFriendPauseRefresh,
            cancelPendingFriendPauseRefresh,
            noteFriendRowHover,
            clearFriendRowHover,
            resolveFriendAvatarNow,
            loadFriendGame,
            loadFriendAllGames,
            loadUserAwards,
            loadUserWantToPlay,
            goToFriends,
            resetFriendEntryRefreshTracking,
            suppressFriendFocusDetectionForTabSwitch
        },
        refs: {
            selectedFriendRef,
            friendGamePayloadRef,
            friendAllGamesPayloadRef,
            friendGameSourceRef,
            friendGameSelectionModeRef,
            friendsRefreshedThisSessionRef,
            friendGameSessionRefreshKeysRef,
            friendRowRefreshRunIdRef,
            friendsRefreshBusyRef,
            friendGameBusyRef,
            friendAllGamesBusyRef,
            userAwardsBusyRef,
            wantToPlayBusyRef
        }
    };
}
