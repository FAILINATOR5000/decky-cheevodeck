import type { FollowedRankingMetric, FriendGameSelectionMode, FriendGameSource, FriendProfileSubView, FriendRow, FriendsPayload, ResumeState, ViewKey } from "../types";
import { userRefFor } from "../utils/friends";
import { getSavedAllGamesLetterRange, getSavedAllGamesStatusFilter } from "./allGamesResume";
import type { RestoreContext } from "./restoreContext";

function getFriendCompareResumeFocusKey(
    savedView: ViewKey | null | undefined,
    savedFocusKey?: string | null
): string | null {
    if (savedView !== "friendCompare") {
        return null;
    }
    const focusKey = String(savedFocusKey || "").trim();
    return focusKey || "friendcompare:back";
}

export function getSavedFriendGameSource(savedState: ResumeState): FriendGameSource {
    return savedState.friendGameSource === "allGames" ? "allGames" : "recentGames";
}

function getSavedFriendProfileSubView(savedState: ResumeState): FriendProfileSubView {
    return savedState.friendProfileSubView === "wall" ? "wall" : "game";
}

export function getSavedFriendGameSelectionMode(savedState: ResumeState): FriendGameSelectionMode {
    return savedState.friendGameSelectionMode === "explicit" ? "explicit" : "auto";
}

export function getSavedFriendEntrySource(savedState: ResumeState): "profile" | "compareGame" {
    return savedState.friendEntrySource === "compareGame" ? "compareGame" : "profile";
}


export function getSavedFriendProfileBackSource(savedState: ResumeState): "social" | "main" {
    return savedState.friendProfileBackSource === "main" ? "main" : "social";
}

export function getSavedFriendUsername(savedState: ResumeState): string {
    return String(savedState.selectedFriendUsername || "").trim();
}

function getSavedFriendUlid(savedState: ResumeState): string {
    return String(savedState.selectedFriendUlid || "").trim();
}

export function findResumeFriendRow(savedState: ResumeState, friendsPayload: FriendsPayload | null): FriendRow | null {
    const friendUsername = getSavedFriendUsername(savedState);
    if (!friendUsername) {
        return null;
    }
    const friendUlid = getSavedFriendUlid(savedState);
    const roster = friendsPayload?.friends ?? [];

    if (friendUlid) {
        const byUlid = roster.find((row: FriendRow) => row.ulid === friendUlid);
        if (byUlid) {
            return byUlid;
        }
    }
    const byName = roster.find((row: FriendRow) => row.username === friendUsername);
    if (byName) {
        return byName;
    }

    return { username: friendUsername, ulid: friendUlid || null } as FriendRow;
}

export function getResumeFriendGameId(savedState: ResumeState): number | null {
    return getSavedFriendGameSelectionMode(savedState) === "explicit" ? (savedState.friendGameId ?? null) : null;
}

export function getFriendResumeFocusKey(view: ResumeState["view"]): string | null {
    if (view === "friendGame") {
        return "friendgame:back";
    }
    if (view === "friendAllGames") {
        return "friendallgames:back";
    }
    if (view === "wantToPlay") {
        return "wanttoplay:back";
    }
    if (view === "followedRanking") {
        return "followedranking:back";
    }
    if (view === "social") {
        return "social:back";
    }
    return null;
}

export function getSavedFollowedRankingMetric(savedState: ResumeState): FollowedRankingMetric {
    const metric = savedState.followedRankingMetric;
    if (metric === "softcorePoints" || metric === "retroPoints" || metric === "retroRatio") {
        return metric;
    }
    return "hardcorePoints";
}

export async function restoreFriendAllGames(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): Promise<boolean> {
    if (savedView === "friendAllGames") {
        const friendUsername = getSavedFriendUsername(savedState);
        if (!friendUsername) {
            ctx.markResumeApplied();
            ctx.setView("achievements");
            return true;
        }
        const cachedFriend = findResumeFriendRow(savedState, ctx.friendsPayload);
        if (!cachedFriend) {
            ctx.markResumeApplied();
            ctx.setView("achievements");
            return true;
        }
        const desiredCount = 500;
        const savedFriendGameSource = getSavedFriendGameSource(savedState);
        const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
        ctx.friendGameReturnGameIdRef.current = getResumeFriendGameId(savedState);
        ctx.setFriendGameSource(savedFriendGameSource);
        ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
        ctx.setRecentGamesExpanded(false);
        ctx.setAllGamesLetterRange(getSavedAllGamesLetterRange(savedState));
        ctx.setAllGamesStatusFilter(getSavedAllGamesStatusFilter(savedState));
        ctx.pendingResumeFocusKeyRef.current = getFriendResumeFocusKey(savedView);
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.markResumeApplied();
        await ctx.loadFriendAllGames(cachedFriend, 0, desiredCount);
        return true;
    }

    return false;
}

export async function restoreFriendCompare(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): Promise<boolean> {
    if (savedView === "friendCompare") {
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
        ctx.friendCompareReturnFriendRef.current = {
            username: friendUsername,
            gameId: savedState.friendGameId ?? null,
            source: savedFriendGameSource
        };
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setView("friendCompare");
        ctx.setPendingFocusKey(getFriendCompareResumeFocusKey(savedView, savedState?.focusKey) ?? "friendcompare:back");
        ctx.markResumeApplied();
        await ctx.loadFriendGame(
            cachedFriend,
            savedState.friendGameId ?? null,
            true,
            "friendcompare:back",
            true
        );
        return true;
    }

    return false;
}

export async function restoreWantToPlay(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): Promise<boolean> {
    if (savedView === "wantToPlay") {
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
        ctx.pendingResumeFocusKeyRef.current = getFriendResumeFocusKey(savedView);
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.markResumeApplied();
        await ctx.loadFriendGame(
            cachedFriend,
            savedState.friendGameId ?? null,
            true,
            "friendprofile:tab:wanttoplay",
            true
        );
        await ctx.loadUserWantToPlay(userRefFor(cachedFriend), cachedFriend.ulid ?? "");
        return true;
    }

    return false;
}

export async function restoreFriendGame(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): Promise<boolean> {
    if (savedView === "friendGame") {
        const friendUsername = getSavedFriendUsername(savedState);
        if (!friendUsername) {
            ctx.markResumeApplied();
            ctx.setView("achievements");
            return true;
        }
        const cachedFriend = findResumeFriendRow(savedState, ctx.friendsPayload);
        if (!cachedFriend) {
            ctx.markResumeApplied();
            ctx.setView("achievements");
            return true;
        }
        const savedFriendGameSource = getSavedFriendGameSource(savedState);
        const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
        const resumeGameId = getResumeFriendGameId(savedState);
        ctx.friendGameReturnGameIdRef.current = resumeGameId;
        ctx.setFriendGameSource(savedFriendGameSource);
        ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
        ctx.setFriendProfileSubView(getSavedFriendProfileSubView(savedState));
        ctx.pendingResumeFocusKeyRef.current = getFriendResumeFocusKey(savedView);
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.markResumeApplied();
        await ctx.loadFriendGame(
            cachedFriend,
            resumeGameId,
            true,
            ctx.pendingResumeFocusKeyRef.current || "friendgame:back"
        );
        return true;
    }

    return false;
}
