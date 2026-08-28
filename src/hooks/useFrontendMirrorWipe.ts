import type { Dispatch, RefObject, SetStateAction } from "react";

import {
    clearAchievementIconMemoryCache,
    clearGameIconMemoryCache,
    clearGameImageMemoryCache,
    clearTrackedCountMemoryCache,
    clearUserAvatarMemoryCache
} from "../api";
import type { FriendGamePayload, FriendRow, FriendsPayload, Payload } from "../types";

type UseFrontendMirrorWipeArgs = {
    setPayload: Dispatch<SetStateAction<Payload | null>>;
    setGameIconDataUri: Dispatch<SetStateAction<string | null>>;
    setGameIngameDataUri: Dispatch<SetStateAction<string | null>>;
    setImageRefreshKey: Dispatch<SetStateAction<number>>;
    setFriendsPayload: Dispatch<SetStateAction<FriendsPayload | null>>;
    setFriendsLoaded: Dispatch<SetStateAction<boolean>>;
    setSelectedFriend: Dispatch<SetStateAction<FriendRow | null>>;
    setFriendGamePayload: Dispatch<SetStateAction<FriendGamePayload | null>>;
    setRecentGamesExpanded: Dispatch<SetStateAction<boolean>>;
    friendRowRefreshRunIdRef: RefObject<number>;
    friendGameSessionRefreshKeysRef: RefObject<Set<string>>;
    friendsRefreshedThisSessionRef: RefObject<boolean>;
};

export function useFrontendMirrorWipe({
    setPayload,
    setGameIconDataUri,
    setGameIngameDataUri,
    setImageRefreshKey,
    setFriendsPayload,
    setFriendsLoaded,
    setSelectedFriend,
    setFriendGamePayload,
    setRecentGamesExpanded,
    friendRowRefreshRunIdRef,
    friendGameSessionRefreshKeysRef,
    friendsRefreshedThisSessionRef
}: UseFrontendMirrorWipeArgs) {
    function wipeFrontendMirrors() {
        clearAchievementIconMemoryCache();
        clearGameIconMemoryCache();
        clearGameImageMemoryCache();
        clearUserAvatarMemoryCache();
        clearTrackedCountMemoryCache();
        setGameIconDataUri(null);
        setGameIngameDataUri(null);
        setImageRefreshKey((value) => value + 1);

        friendRowRefreshRunIdRef.current += 1;
        setPayload(null);
        setFriendsPayload(null);
        setFriendsLoaded(true);
        setSelectedFriend(null);
        setFriendGamePayload(null);
        setRecentGamesExpanded(false);
        friendsRefreshedThisSessionRef.current = false;
        friendGameSessionRefreshKeysRef.current = new Set();
    }

    return wipeFrontendMirrors;
}
