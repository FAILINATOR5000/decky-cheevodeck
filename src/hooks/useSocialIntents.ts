import { type Dispatch, type RefObject, type SetStateAction } from "react";

import type { NavIntent } from "../nav";
import { logError } from "../utils/errors";
import { clearCommentsRestoreForSurface } from "../utils/commentsSnapshot";
import { findFriendRow } from "../utils/friends";
import { openExternalUrl, raAchievementUrl, raGameUrl } from "../utils/navigation";
import type {
    AchievementRow,
    ActivityCardAction,
    AOSource,
    FriendGameSelectionMode,
    FriendGameSource,
    FriendRow,
    GameOverviewSource,
    GameOverviewSubView,
    PlayersNearYouItem,
    PlayersNearYouTapMode,
    SocialActivityEvent,
    Subscription
} from "../types";

type UseSocialIntentsArgs = {
    username: string;
    activeUlid: string;
    activityCardAction: ActivityCardAction;
    friendFeedCardAction: ActivityCardAction;
    socialHubCardAction: ActivityCardAction;
    playersNearYouTapMode: PlayersNearYouTapMode;
    legacyAchievementLinks: boolean;
    legacyGameLinks: boolean;
    friendsRows: FriendRow[];
    loadFriendGame: (
        friend: FriendRow,
        gameId?: number | null,
        force?: boolean,
        focusTarget?: string,
        suppressViewChange?: boolean
    ) => Promise<void>;
    cancelPendingFriendPauseRefresh: () => void;
    resetFriendEntryRefreshTracking: () => void;
    setFriendGameSource: Dispatch<SetStateAction<FriendGameSource>>;
    setFriendGameSelectionMode: Dispatch<SetStateAction<FriendGameSelectionMode>>;
    mountedRef: RefObject<boolean>;
    friendGameReturnGameIdRef: RefObject<number | null>;
    navIntentRef: RefObject<NavIntent | null>;
    friendProfileBackSourceRef: RefObject<"social" | "main">;
    setError: Dispatch<SetStateAction<string | null>>;
    resolveViewedUser: (viewedName?: string | null, viewedUlid?: string | null) => {
        isOwn: boolean;
        viewedUsername: string | null;
        viewedUserRef: string | null;
    };
    goToAchievementOverview: (
        achievement: AchievementRow,
        parentGameId: number | null,
        source: AOSource,
        viewedUsername: string | null,
        viewedUserRef: string | null
    ) => void;
    goToGameOverview: (
        targetGameId: number,
        source: GameOverviewSource,
        viewedUsername: string | null,
        viewedUserRef: string | null,
        subView?: GameOverviewSubView
    ) => void;
    stashPendingNotificationProfile: (target: { username: string; ulid: string | null }) => void;
};

export function useSocialIntents({
    username,
    activeUlid,
    activityCardAction,
    friendFeedCardAction,
    socialHubCardAction,
    playersNearYouTapMode,
    legacyAchievementLinks,
    legacyGameLinks,
    friendsRows,
    loadFriendGame,
    cancelPendingFriendPauseRefresh,
    resetFriendEntryRefreshTracking,
    setFriendGameSource,
    setFriendGameSelectionMode,
    mountedRef,
    friendGameReturnGameIdRef,
    navIntentRef,
    friendProfileBackSourceRef,
    setError,
    resolveViewedUser,
    goToAchievementOverview,
    goToGameOverview,
    stashPendingNotificationProfile
}: UseSocialIntentsArgs) {
    function beginProfileOpen(backSource: "main" | "social") {
        clearCommentsRestoreForSurface("comments:wall");
        cancelPendingFriendPauseRefresh();
        resetFriendEntryRefreshTracking();
        friendGameReturnGameIdRef.current = null;
        setFriendGameSource("recentGames");
        setFriendGameSelectionMode("auto");
        friendProfileBackSourceRef.current = backSource;
    }

    function goToOwnProfile() {
        const ownUsername = username.trim();
        if (!ownUsername) {
            return;
        }

        const lookup = ownUsername.toLowerCase();
        const existing =
            friendsRows.find((row) => row.isSelf) ||
            friendsRows.find(
                (row) => String(row.username || "").trim().toLowerCase() === lookup
            );
        const selfRow: FriendRow = existing
            ? { ...existing, isSelf: true }
            : { username: ownUsername, ulid: activeUlid || null, isSelf: true };

        beginProfileOpen("main");
        void loadFriendGame(selfRow, undefined, false, "friendgame:back");
    }

    async function handleActivityCardClick(
        event: SocialActivityEvent,
        source: "main" | "socialActivity" | "mainNowPlaying" = "socialActivity",
        actionOverride?: ActivityCardAction
    ) {
        const effectiveAction = actionOverride
            ?? (source === "mainNowPlaying"
                ? friendFeedCardAction
                : source === "main"
                    ? activityCardAction
                    : socialHubCardAction);

        if (effectiveAction === "profile") {
            const friend = findFriendRow(friendsRows, { username: event.username });
            if (!friend) {
                return;
            }

            beginProfileOpen(source !== "socialActivity" ? "main" : "social");
            await loadFriendGame(friend, undefined, false, "friendgame:back");
            return;
        }

        setError(null);

        const { viewedUsername, viewedUserRef } = resolveViewedUser(event.username, event.ulid);

        if (effectiveAction === "achievement" && event.kind === "achievementUnlocked" && event.achievementId) {
            if (legacyAchievementLinks) {
                const url = raAchievementUrl(event.achievementId);
                await openExternalUrl(url);
                return;
            }
            const fallbackRow: AchievementRow = {
                id: event.achievementId,
                title: event.achievementTitle ?? "",
                description: event.achievementDescription ?? "",
                points: event.points ?? 0,
                trueRatio: event.trueRatio ?? 0,
                badgeName: String(event.achievementIcon || "").trim(),
                displayOrder: 0,
                badgeUrl: null,
                dateEarned: event.timestamp ?? null,
                dateEarnedHardcore: event.hardcore ? (event.timestamp ?? null) : null,
                measured: false,
                numAwarded: 0,
                numAwardedHardcore: 0
            };
            goToAchievementOverview(fallbackRow, event.gameId ?? null, source, viewedUsername, viewedUserRef);
            return;
        }

        if (event.gameId) {
            if (legacyGameLinks) {
                const url = raGameUrl(event.gameId);
                await openExternalUrl(url);
                return;
            }
            goToGameOverview(event.gameId, source, viewedUsername, viewedUserRef);
            return;
        }
    }

    async function handlePlayersNearYouClick(
        item: PlayersNearYouItem,
        modeOverride?: PlayersNearYouTapMode
    ) {
        const tapMode = modeOverride ?? playersNearYouTapMode;
        if (tapMode === "profile") {
            const itemName = String(item.user || "").trim();
            if (!itemName) {
                return;
            }
            const existing = findFriendRow(friendsRows, { username: itemName, ulid: item.ulid });
            const row: FriendRow = existing || { username: itemName, ulid: item.ulid ?? null };

            beginProfileOpen("main");
            void loadFriendGame(row, undefined, false, "friendgame:back");
            return;
        }

        setError(null);
        const { viewedUsername, viewedUserRef } = resolveViewedUser(item.user, item.ulid);

        if (tapMode === "game") {
            if (!item.gameId) {
                return;
            }
            if (legacyGameLinks) {
                const url = raGameUrl(item.gameId);
                await openExternalUrl(url);
                return;
            }
            goToGameOverview(item.gameId, "mainNowPlaying", viewedUsername, viewedUserRef);
            return;
        }

        if (legacyAchievementLinks) {
            const url = raAchievementUrl(item.achievementId);
            await openExternalUrl(url);
            return;
        }

        const fallbackRow: AchievementRow = {
            id: item.achievementId,
            title: item.achievementTitle ?? "",
            description: "",
            points: 0,
            trueRatio: 0,
            badgeName: item.badgeName ?? "",
            displayOrder: 0,
            badgeUrl: null,
            dateEarned: null,
            dateEarnedHardcore: null,
            measured: false,
            numAwarded: 0,
            numAwardedHardcore: 0
        };

        goToAchievementOverview(fallbackRow, item.gameId ?? null, "mainNowPlaying", viewedUsername, viewedUserRef);
    }

    async function handleOpenUserProfile(username: string, ulid?: string | null) {
        const trimmed = String(username || "").trim();
        if (!trimmed) {
            return;
        }

        setError(null);

        const existingFriend = findFriendRow(friendsRows, { username: trimmed });
        const friend: FriendRow = existingFriend ?? {
            username: trimmed,
            ulid: ulid ?? null
        };

        beginProfileOpen("social");
        try {
            await loadFriendGame(friend, undefined, false, "friendgame:back");
        }
        catch (e) {
            logError("handleOpenUserProfile", e);
            if (mountedRef.current) {
                setError("Couldn't open the user profile.");
            }
        }
    }

    async function openNotificationProfile(username: string, ulid: string | null) {
        const trimmed = String(username || "").trim();
        if (!trimmed) {
            return;
        }

        setError(null);

        const existingFriend = findFriendRow(friendsRows, { username: trimmed });
        const friend: FriendRow = existingFriend ?? {
            username: trimmed,
            ulid: ulid ?? null
        };

        beginProfileOpen("main");
        navIntentRef.current = "hub";
        stashPendingNotificationProfile({ username: trimmed, ulid: ulid ?? null });
        try {
            await loadFriendGame(friend, undefined, false, "friendgame:back");
        }
        catch (e) {
            logError("openNotificationProfile", e);
            if (mountedRef.current) {
                setError("Couldn't open the user profile.");
            }
        }
    }

    function handleOpenSubscription(subscription: Subscription) {
        if (subscription.kind === "game") {
            goToGameOverview(subscription.gameId, "subscribedDiscussions", null, null, "comments");
            return;
        }
        const thinRow: AchievementRow = {
            id: subscription.id,
            title: subscription.title,
            description: "",
            points: 0,
            trueRatio: 0,
            badgeName: subscription.badgeName,
            displayOrder: 0,
            badgeUrl: subscription.iconUrl,
            dateEarned: null,
            dateEarnedHardcore: null,
            measured: false,
            numAwarded: 0,
            numAwardedHardcore: 0
        };
        goToAchievementOverview(thinRow, subscription.gameId, "subscribedDiscussions", null, null);
    }

    return {
        goToOwnProfile,
        handleActivityCardClick,
        handlePlayersNearYouClick,
        handleOpenUserProfile,
        openNotificationProfile,
        handleOpenSubscription
    };
}
