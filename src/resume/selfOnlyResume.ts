import type { ResumeState, ViewKey } from "../types";
import {
    findResumeFriendRow,
    getFriendResumeFocusKey,
    getResumeFriendGameId,
    getSavedFollowedRankingMetric,
    getSavedFriendGameSelectionMode,
    getSavedFriendGameSource,
    getSavedFriendUsername
} from "./friendsResume";
import type { RestoreContext } from "./restoreContext";
export function restoreSelfOnlyView(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): boolean {
    if (savedView === "followedRanking") {
        const friendUsername = getSavedFriendUsername(savedState);
        const cachedFriend = friendUsername ? findResumeFriendRow(savedState, ctx.friendsPayload) : null;
        if (!friendUsername || !cachedFriend) {
            ctx.markResumeApplied();
            ctx.setView("achievements");
            return true;
        }

        ctx.setSelectedFriend(cachedFriend);
        ctx.setFollowedRankingMetric(getSavedFollowedRankingMetric(savedState));
        ctx.friendGameReturnGameIdRef.current = getResumeFriendGameId(savedState);
        ctx.setFriendGameSource(getSavedFriendGameSource(savedState));
        ctx.setFriendGameSelectionMode(getSavedFriendGameSelectionMode(savedState));
        ctx.pendingResumeFocusKeyRef.current = getFriendResumeFocusKey(savedView);
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.markResumeApplied();
        ctx.setView("followedRanking");
        return true;
    }

    if (savedView === "trackedSets" || savedView === "trackedSetOpen") {
        const selfUsername = getSavedFriendUsername(savedState);
        const cachedSelf = selfUsername ? findResumeFriendRow(savedState, ctx.friendsPayload) : null;
        const trackedSetsFocusKey = savedView === "trackedSetOpen" ? "trackedsetopen:back" : "trackedsets:back";
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.markResumeApplied();
        ctx.setView(savedView);
        ctx.setPendingFocusKey(trackedSetsFocusKey);
        ctx.friendGameReturnGameIdRef.current = getResumeFriendGameId(savedState);
        ctx.setFriendGameSource(getSavedFriendGameSource(savedState));
        ctx.setFriendGameSelectionMode(getSavedFriendGameSelectionMode(savedState));
        if (selfUsername && cachedSelf) {
            ctx.setSelectedFriend(cachedSelf);
        }
        return true;
    }

    return false;
}
