import type { BadgeFilter, ResumeState, ViewKey } from "../types";
import { userRefFor } from "../utils/friends";
import {
    findResumeFriendRow,
    getSavedFriendGameSelectionMode,
    getSavedFriendGameSource,
    getSavedFriendUsername
} from "./friendsResume";
import type { RestoreContext } from "./restoreContext";

export function getSavedBadgeFilter(savedState: ResumeState): BadgeFilter {
    const value = savedState.badgeFilter;
    if (value === "mastered" || value === "beaten" || value === "event" || value === "other") {
        return value;
    }
    return "all";
}

export async function restoreBadges(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): Promise<boolean> {
    if (savedView === "badges") {
        const friendUsername = getSavedFriendUsername(savedState);
        const cachedFriend = friendUsername ? findResumeFriendRow(savedState, ctx.friendsPayload) : null;
        if (!friendUsername || !cachedFriend) {
            ctx.markResumeApplied();
            ctx.setView("achievements");
            return true;
        }

        const savedFriendGameSource = getSavedFriendGameSource(savedState);
        const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
        ctx.friendGameReturnGameIdRef.current = savedState.friendGameId ?? null;
        ctx.setFriendGameSource(savedFriendGameSource);
        ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
        ctx.setSelectedFriend(cachedFriend);
        ctx.setBadgeFilter(getSavedBadgeFilter(savedState));
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.markResumeApplied();
        await ctx.loadFriendGame(
            cachedFriend,
            savedState.friendGameId ?? null,
            true,
            "friendprofile:tab:awards",
            true
        );
        await ctx.loadUserAwards(userRefFor(cachedFriend), cachedFriend.ulid ?? "");
        return true;
    }

    return false;
}
