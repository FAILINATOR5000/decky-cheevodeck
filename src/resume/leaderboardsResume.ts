import type { ResumeState, ViewKey } from "../types";
import {
    findResumeFriendRow,
    getSavedFriendGameSelectionMode,
    getSavedFriendGameSource,
    getSavedFriendUsername
} from "./friendsResume";
import { getSavedGameOverviewSource } from "./gameOverviewResume";
import type { RestoreContext } from "./restoreContext";

function getSavedLeaderboardsSourceView(savedState: ResumeState): "achievements" | "friendGame" | "gameOverview" {
    if (savedState.leaderboardsSourceView === "friendGame") {
        return "friendGame";
    }
    if (savedState.leaderboardsSourceView === "gameOverview") {
        return "gameOverview";
    }
    return "achievements";
}

export async function restoreLeaderboards(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): Promise<boolean> {
    if (savedView === "leaderboards" || savedView === "leaderboardDetail") {
        ctx.markResumeApplied();
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        const savedSourceView = getSavedLeaderboardsSourceView(savedState);
        const savedFriendGameSource = getSavedFriendGameSource(savedState);
        const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
        ctx.friendGameReturnGameIdRef.current = savedState.friendGameId ?? null;
        const leaderboardGameId =
            savedSourceView === "friendGame"
                ? (savedState.friendGameId ?? null)
                : savedSourceView === "gameOverview"
                    ? (savedState.gameOverviewGameId ?? null)
                    : (savedState.primaryGameId ?? null);
        const shouldRestoreDetail = savedView === "leaderboardDetail";

        if (savedSourceView === "friendGame") {
            const friendUsername = getSavedFriendUsername(savedState);
            if (friendUsername) {
                const cachedFriend = findResumeFriendRow(savedState, ctx.friendsPayload);
                if (!cachedFriend) {
                    return true;
                }
                ctx.setSelectedFriend(cachedFriend);
                ctx.setFriendGameSource(savedFriendGameSource);
                ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
                ctx.leaderboardReturnFriendRef.current = {
                    username: friendUsername,
                    gameId: savedState.friendGameId ?? null,
                    source: savedFriendGameSource
                };
            }
        }

        const goSavedSource = getSavedGameOverviewSource(savedState);
        const leaderboardsFriend =
            savedSourceView === "gameOverview" && goSavedSource === "friend"
                ? findResumeFriendRow(savedState, ctx.friendsPayload)
                : null;
        if (leaderboardsFriend) {
            ctx.setSelectedFriend(leaderboardsFriend);
            ctx.setFriendGameSource(savedFriendGameSource);
            ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
        }

        if (shouldRestoreDetail) {
            ctx.setView("leaderboardDetail");
            ctx.setRestoringLeaderboardDetail(true);
        }
        try {
            if (leaderboardsFriend) {
                await ctx.loadFriendGame(
                    leaderboardsFriend,
                    savedState.friendGameId ?? null,
                    true,
                    "gameoverview:back",
                    true
                );
            }
            await ctx.goToLeaderboards(leaderboardGameId, savedSourceView, shouldRestoreDetail);
            if (shouldRestoreDetail) {
                const savedLeaderboardId = Number(savedState.selectedLeaderboardId ?? 0);
                if (savedLeaderboardId > 0) {
                    const restoredLeaderboard = (ctx.leaderboardsPayloadRef.current?.results ?? []).find(
                        (row) => row.id === savedLeaderboardId
                    );
                    if (restoredLeaderboard) {
                        await ctx.openLeaderboardDetail(restoredLeaderboard);
                    }
                }
            }
        } finally {
            if (shouldRestoreDetail && ctx.mountedRef.current) {
                ctx.setRestoringLeaderboardDetail(false);
            }
        }
        return true;
    }

    return false;
}
