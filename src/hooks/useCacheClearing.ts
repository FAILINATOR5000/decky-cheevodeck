import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import {
    clearAchievementIconMemoryCache,
    clearAwardIconMemoryCache,
    clearCache,
    clearCacheGroup,
    clearFileWatcherEverything,
    clearFileWatcherMap,
    clearFileWatcherReport,
    clearFileWatcherRunTimes,
    clearGameIconMemoryCache,
    clearGameImageMemoryCache,
    clearResolvedAvatars,
    clearResumeState,
    clearUserAvatarMemoryCache
} from "../api";
import { t, type LanguageCode } from "../locales";
import type { FriendGamePayload, FriendRow, FriendsPayload, Payload } from "../types";

type UseCacheClearingArgs = {
    language: LanguageCode;
    mountedRef: RefObject<boolean>;
    runClearWithSpinner: (
        focusKey: string,
        setSpinner: (busy: boolean) => void,
        errorLabel: string,
        fallbackMessage: string,
        work: () => Promise<void>
    ) => Promise<void>;
    wipeFrontendMirrors: () => void;
    setPayload: Dispatch<SetStateAction<Payload | null>>;
    refreshGameData: (force: boolean, preserveFocus: boolean, loadingMessage: string) => Promise<void>;
    setFriendsPayload: Dispatch<SetStateAction<FriendsPayload | null>>;
    setFriendsLoaded: Dispatch<SetStateAction<boolean>>;
    setSelectedFriend: Dispatch<SetStateAction<FriendRow | null>>;
    setFriendGamePayload: Dispatch<SetStateAction<FriendGamePayload | null>>;
    setRecentGamesExpanded: Dispatch<SetStateAction<boolean>>;
    friendRowRefreshRunIdRef: RefObject<number>;
    friendGameSessionRefreshKeysRef: RefObject<Set<string>>;
    friendsRefreshedThisSessionRef: RefObject<boolean>;
    setGameIconDataUri: Dispatch<SetStateAction<string | null>>;
    setGameIngameDataUri: Dispatch<SetStateAction<string | null>>;
    setImageRefreshKey: Dispatch<SetStateAction<number>>;
};

export function useCacheClearing({
    language,
    mountedRef,
    runClearWithSpinner,
    wipeFrontendMirrors,
    setPayload,
    refreshGameData,
    setFriendsPayload,
    setFriendsLoaded,
    setSelectedFriend,
    setFriendGamePayload,
    setRecentGamesExpanded,
    friendRowRefreshRunIdRef,
    friendGameSessionRefreshKeysRef,
    friendsRefreshedThisSessionRef,
    setGameIconDataUri,
    setGameIngameDataUri,
    setImageRefreshKey
}: UseCacheClearingArgs) {
    const [clearingGameDataCache, setClearingGameDataCache] = useState(false);
    const [clearingFriendsCache, setClearingFriendsCache] = useState(false);
    const [clearingImagesCache, setClearingImagesCache] = useState(false);
    const [clearingOtherIconsCache, setClearingOtherIconsCache] = useState(false);
    const [clearingSocialActivityCache, setClearingSocialActivityCache] = useState(false);
    const [clearingGameActivityCache, setClearingGameActivityCache] = useState(false);
    const [clearingPlayersNearYouCache, setClearingPlayersNearYouCache] = useState(false);
    const [clearingGamesListCache, setClearingGamesListCache] = useState(false);
    const [clearingAwardsListCache, setClearingAwardsListCache] = useState(false);
    const [clearingWantToPlayCache, setClearingWantToPlayCache] = useState(false);
    const [clearingGameOverviewCache, setClearingGameOverviewCache] = useState(false);
    const [clearingAllCache, setClearingAllCache] = useState(false);
    const [clearingResolvedAvatars, setClearingResolvedAvatars] = useState(false);
    const clearingAnyCache =
        clearingGameDataCache
        || clearingFriendsCache
        || clearingImagesCache
        || clearingOtherIconsCache
        || clearingSocialActivityCache
        || clearingGameActivityCache
        || clearingPlayersNearYouCache
        || clearingGamesListCache
        || clearingAwardsListCache
        || clearingWantToPlayCache
        || clearingGameOverviewCache
        || clearingAllCache
        || clearingResolvedAvatars;

    async function onClearGameData() {
        await runClearWithSpinner(
            "options:clear-game-data",
            setClearingGameDataCache,
            "onClearGameData",
            "Couldn't clear the game data cache.",
            async () => {
                await Promise.all([clearCacheGroup("gameData"), clearResumeState()]);
                if (!mountedRef.current) {
                    return;
                }

                friendRowRefreshRunIdRef.current += 1;
                setFriendGamePayload(null);
                friendGameSessionRefreshKeysRef.current = new Set();

                setPayload(null);
                await refreshGameData(true, false, t(language, "Refreshing Achievements..."));
            }
        );
    }

    async function onClearFriendsCache() {
        await runClearWithSpinner(
            "options:clear-friends",
            setClearingFriendsCache,
            "onClearFriendsCache",
            "Couldn't clear the friends cache.",
            async () => {
                await clearCacheGroup("friends");
                if (!mountedRef.current) {
                    return;
                }

                friendRowRefreshRunIdRef.current += 1;
                setFriendsPayload(null);
                setFriendsLoaded(true);
                setSelectedFriend(null);
                setRecentGamesExpanded(false);
                friendsRefreshedThisSessionRef.current = false;

                clearUserAvatarMemoryCache();

            }
        );
    }

    async function onClearImages() {
        await runClearWithSpinner(
            "options:clear-images",
            setClearingImagesCache,
            "onClearImages",
            "Couldn't clear the image cache.",
            async () => {
                await clearCacheGroup("images");
                if (!mountedRef.current) {
                    return;
                }

                clearAchievementIconMemoryCache();
                clearGameIconMemoryCache();
                clearGameImageMemoryCache();
                clearUserAvatarMemoryCache();
                setGameIconDataUri(null);
                setGameIngameDataUri(null);
                setImageRefreshKey((value) => value + 1);

            }
        );
    }

    async function onClearOtherIcons() {
        await runClearWithSpinner(
            "options:clear-other-icons",
            setClearingOtherIconsCache,
            "onClearOtherIcons",
            "Couldn't clear the other icons cache.",
            async () => {
                await clearCacheGroup("awardIcons");
                if (!mountedRef.current) {
                    return;
                }

                clearAwardIconMemoryCache();

            }
        );
    }

    async function onClearSocialActivity() {
        await runClearWithSpinner(
            "options:clear-social-activity",
            setClearingSocialActivityCache,
            "onClearSocialActivity",
            "Couldn't clear the activity feed.",
            async () => {
                await clearCacheGroup("socialActivity");
                if (!mountedRef.current) {
                    return;
                }

            }
        );
    }

    async function onClearGameActivity() {
        await runClearWithSpinner(
            "options:clear-game-activity",
            setClearingGameActivityCache,
            "onClearGameActivity",
            "Couldn't clear the per-game activity history.",
            async () => {
                await clearCacheGroup("gameActivity");
                if (!mountedRef.current) {
                    return;
                }

            }
        );
    }

    async function onClearPlayersNearYou() {
        await runClearWithSpinner(
            "options:clear-players-near-you",
            setClearingPlayersNearYouCache,
            "onClearPlayersNearYou",
            "Couldn't clear the Players Near You feed.",
            async () => {
                await clearCacheGroup("playersNearYou");
                if (!mountedRef.current) {
                    return;
                }

            }
        );
    }

    async function onClearGamesListCache() {
        await runClearWithSpinner(
            "options:clear-games-list-cache",
            setClearingGamesListCache,
            "onClearGamesListCache",
            "Couldn't clear the games list cache.",
            async () => {
                await clearCacheGroup("gamesList");
            }
        );
    }

    async function onClearAwardsListCache() {
        await runClearWithSpinner(
            "options:clear-awards-list-cache",
            setClearingAwardsListCache,
            "onClearAwardsListCache",
            "Couldn't clear the awards list cache.",
            async () => {
                await clearCacheGroup("awardsList");
            }
        );
    }

    async function onClearWantToPlayCache() {
        await runClearWithSpinner(
            "options:clear-want-to-play-cache",
            setClearingWantToPlayCache,
            "onClearWantToPlayCache",
            "Couldn't clear the want to play cache.",
            async () => {
                await clearCacheGroup("wantToPlayList");
            }
        );
    }

    async function onClearGameOverviewCache() {
        await runClearWithSpinner(
            "options:clear-game-overview-cache",
            setClearingGameOverviewCache,
            "onClearGameOverviewCache",
            "Couldn't clear the Game Overview cache.",
            async () => {
                await clearCacheGroup("friendGamePayloads");
            }
        );
    }

    async function onClearSetsCache() {
        await runClearWithSpinner(
            "options:clear-sets-cache",
            setClearingAllCache,
            "onClearSetsCache",
            "Couldn't clear the sets list cache.",
            async () => {
                await clearCacheGroup("setsList");
            }
        );
    }

    async function onClearCheevoCheckResults() {
        await runClearWithSpinner(
            "options:clear-cheevo-check-results",
            setClearingAllCache,
            "onClearCheevoCheckResults",
            "Couldn't clear the Cheevo Check scan results.",
            async () => {
                await clearCacheGroup("cheevoCheckResults");
            }
        );
    }

    async function onClearCheevoCheckHashes() {
        await runClearWithSpinner(
            "options:clear-cheevo-check-hashes",
            setClearingAllCache,
            "onClearCheevoCheckHashes",
            "Couldn't clear the Cheevo Check hash cache.",
            async () => {
                await clearCacheGroup("cheevoCheckHashes");
            }
        );
    }

    async function onClearCheevoCheckRaData() {
        await runClearWithSpinner(
            "options:clear-cheevo-check-ra-data",
            setClearingAllCache,
            "onClearCheevoCheckRaData",
            "Couldn't clear the Cheevo Check RetroAchievements data.",
            async () => {
                await clearCacheGroup("cheevoCheckRaData");
            }
        );
    }

    async function onClearFileWatcherReport() {
        await runClearWithSpinner(
            "options:clear-file-watcher-report",
            setClearingAllCache,
            "onClearFileWatcherReport",
            "Couldn't clear the File Watcher report.",
            async () => {
                await clearFileWatcherReport();
            }
        );
    }

    async function onClearFileWatcherMap() {
        await runClearWithSpinner(
            "options:clear-file-watcher-map",
            setClearingAllCache,
            "onClearFileWatcherMap",
            "Couldn't clear the File Watcher hashes.",
            async () => {
                await clearFileWatcherMap();
            }
        );
    }

    async function onClearFileWatcherEverything() {
        await runClearWithSpinner(
            "options:clear-file-watcher-everything",
            setClearingAllCache,
            "onClearFileWatcherEverything",
            "Couldn't remove the File Watcher data.",
            async () => {
                await clearFileWatcherEverything();
            }
        );
    }

    async function onClearFileWatcherRunTimes() {
        await runClearWithSpinner(
            "options:clear-file-watcher-run-times",
            setClearingAllCache,
            "onClearFileWatcherRunTimes",
            "Couldn't clear the File Watcher run times.",
            async () => {
                await clearFileWatcherRunTimes();
            }
        );
    }

    async function onDeleteLeaderboardsCache() {
        await runClearWithSpinner(
            "options:delete-leaderboards-cache",
            setClearingAllCache,
            "onDeleteLeaderboardsCache",
            "Couldn't clear the leaderboards cache.",
            async () => {
                await clearCacheGroup("leaderboards");
            }
        );
    }

    async function onClearResolvedAvatars() {
        await runClearWithSpinner(
            "options:clear-resolved-avatars",
            setClearingResolvedAvatars,
            "onClearResolvedAvatars",
            "Couldn't clear the resolved avatars.",
            async () => {
                await clearResolvedAvatars();
            }
        );
    }

    async function onClearAllCache() {
        await runClearWithSpinner(
            "options:clear-all-cache",
            setClearingAllCache,
            "onClearAllCache",
            "Couldn't clear the cache.",
            async () => {
                await Promise.all([clearCache(), clearResumeState()]);
                if (!mountedRef.current) {
                    return;
                }

                wipeFrontendMirrors();
                await refreshGameData(true, false, t(language, "Refreshing Achievements..."));
            }
        );
    }

    return {
        clearingGameDataCache,
        clearingFriendsCache,
        clearingImagesCache,
        clearingOtherIconsCache,
        clearingSocialActivityCache,
        clearingGameActivityCache,
        clearingPlayersNearYouCache,
        clearingGamesListCache,
        clearingAwardsListCache,
        clearingWantToPlayCache,
        clearingGameOverviewCache,
        clearingAllCache,
        clearingResolvedAvatars,
        clearingAnyCache,
        onClearGameData,
        onClearFriendsCache,
        onClearImages,
        onClearOtherIcons,
        onClearSocialActivity,
        onClearGameActivity,
        onClearPlayersNearYou,
        onClearGamesListCache,
        onClearAwardsListCache,
        onClearWantToPlayCache,
        onClearGameOverviewCache,
        onClearSetsCache,
        onClearCheevoCheckResults,
        onClearCheevoCheckHashes,
        onClearCheevoCheckRaData,
        onClearFileWatcherReport,
        onClearFileWatcherMap,
        onClearFileWatcherEverything,
        onClearFileWatcherRunTimes,
        onDeleteLeaderboardsCache,
        onClearResolvedAvatars,
        onClearAllCache
    };
}
