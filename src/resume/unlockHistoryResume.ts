import type { ResumeState, ViewKey } from "../types";
import { findResumeFriendRow, getSavedFriendGameSelectionMode, getSavedFriendGameSource, getSavedFriendUsername } from "./friendsResume";
import type { RestoreContext } from "./restoreContext";

export function getSavedUnlockHistorySource(savedState: ResumeState): "main" | "friendGame" {
    return savedState.unlockHistorySource === "friendGame" ? "friendGame" : "main";
}

function getUnlockHistoryResumeFocusKey(
    savedView: ViewKey | null | undefined,
    savedFocusKey?: string | null
): string | null {
    if (savedView !== "unlockHistory") {
        return null;
    }
    const focusKey = String(savedFocusKey || "").trim();
    return focusKey || "unlockhistory:back";
}

export async function restoreUnlockHistory(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): Promise<boolean> {
    if (savedView === "unlockHistory") {
        ctx.setRecentGamesExpanded(false);
        const savedSource = getSavedUnlockHistorySource(savedState);

        if (savedSource !== "friendGame") {
            ctx.setUnlockHistorySource("main");
            ctx.setView("unlockHistory");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getUnlockHistoryResumeFocusKey(savedView, savedState?.focusKey) ?? "unlockhistory:back");
            ctx.markResumeApplied();
            return true;
        }

        const friendUsername = getSavedFriendUsername(savedState);
        const cachedFriend = friendUsername ? findResumeFriendRow(savedState, ctx.friendsPayload) : null;
        if (!friendUsername || !cachedFriend) {
            ctx.setUnlockHistorySource("main");
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
        ctx.unlockHistoryReturnFriendRef.current = {
            username: friendUsername,
            gameId: savedState.friendGameId ?? null,
            source: savedFriendGameSource
        };
        ctx.setUnlockHistorySource("friendGame");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setView("unlockHistory");
        ctx.setPendingFocusKey(getUnlockHistoryResumeFocusKey(savedView, savedState?.focusKey) ?? "unlockhistory:back");
        ctx.markResumeApplied();
        await ctx.loadFriendGame(
            cachedFriend,
            savedState.friendGameId ?? null,
            true,
            "unlockhistory:back",
            true
        );
        return true;
    }

    return false;
}
