import type { GameOverviewSource, GameOverviewSubView, ResumeState, ViewKey } from "../types";
import { userRefFor } from "../utils/friends";
import { getSavedBadgeFilter } from "./badgesResume";
import {
    findResumeFriendRow,
    getResumeFriendGameId,
    getSavedFriendGameSelectionMode,
    getSavedFriendGameSource,
    getSavedFriendUsername
} from "./friendsResume";
import type { RestoreContext } from "./restoreContext";

export function getSavedGameOverviewSubView(savedState: ResumeState): GameOverviewSubView {
    const value = savedState.gameOverviewSubView;
    if (value === "comments") {
        return "comments";
    }
    if (value === "hashes") {
        return "hashes";
    }
    return "achievements";
}

export function getSavedGameOverviewSource(savedState: ResumeState): GameOverviewSource {
    const value = savedState.gameOverviewSource;
    if (
        value === "newsEvents" ||
        value === "socialActivity" ||
        value === "mainNowPlaying" ||
        value === "friend" ||
        value === "badges" ||
        value === "wantToPlay" ||
        value === "trackedSet" ||
        value === "subscribedDiscussions" ||
        value === "search" ||
        value === "cheevoCheck"
    ) {
        return value;
    }
    return "main";
}

export function getSavedGameOverviewGameId(savedState: ResumeState): number | null {
    const raw = savedState.gameOverviewGameId;
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
    }
    return null;
}

export function getSavedGameOverviewViewedUsername(savedState: ResumeState): string | null {
    const raw = savedState.gameOverviewViewedUsername;
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function getSavedGameOverviewViewedUserRef(savedState: ResumeState): string | null {
    const raw = savedState.gameOverviewViewedUserRef;
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function getGameOverviewResumeFocusKey(view: ResumeState["view"]): string | null {
    if (view === "gameOverview") {
        return "gameoverview:back";
    }
    return null;
}

export async function restoreGameOverview(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): Promise<boolean> {
    if (savedView === "gameOverview") {
        const savedGameId = getSavedGameOverviewGameId(savedState);
        if (savedGameId == null) {
            ctx.setView("achievements");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.markResumeApplied();
            return true;
        }
        const goSavedSource = getSavedGameOverviewSource(savedState);
        const goFriendUsername = getSavedFriendUsername(savedState);
        const goCachedFriend = goFriendUsername ? findResumeFriendRow(savedState, ctx.friendsPayload) : null;
        if (goSavedSource === "friend" && goCachedFriend) {
            const savedFriendGameSource = getSavedFriendGameSource(savedState);
            const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
            ctx.friendGameReturnGameIdRef.current = savedState.friendGameId ?? null;
            ctx.setFriendGameSource(savedFriendGameSource);
            ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
            ctx.setSelectedFriend(goCachedFriend);
            ctx.setView("gameOverview");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getGameOverviewResumeFocusKey(savedView) ?? "gameoverview:back");
            ctx.markResumeApplied();
            await ctx.loadFriendGame(
                goCachedFriend,
                savedState.friendGameId ?? null,
                true,
                "gameoverview:back",
                true
            );
            return true;
        }
        if (goSavedSource === "badges" && goCachedFriend) {
            const savedFriendGameSource = getSavedFriendGameSource(savedState);
            const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
            ctx.friendGameReturnGameIdRef.current = savedState.friendGameId ?? null;
            ctx.setFriendGameSource(savedFriendGameSource);
            ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
            ctx.setSelectedFriend(goCachedFriend);
            ctx.setBadgeFilter(getSavedBadgeFilter(savedState));
            ctx.setView("gameOverview");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getGameOverviewResumeFocusKey(savedView) ?? "gameoverview:back");
            ctx.markResumeApplied();
            await ctx.loadFriendGame(
                goCachedFriend,
                savedState.friendGameId ?? null,
                true,
                "gameoverview:back",
                true
            );
            await ctx.loadUserAwards(userRefFor(goCachedFriend), goCachedFriend.ulid ?? "", true);
            return true;
        }
        if (goSavedSource === "wantToPlay" && goCachedFriend) {
            const savedFriendGameSource = getSavedFriendGameSource(savedState);
            const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
            ctx.friendGameReturnGameIdRef.current = savedState.friendGameId ?? null;
            ctx.setFriendGameSource(savedFriendGameSource);
            ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
            ctx.setSelectedFriend(goCachedFriend);
            ctx.setView("gameOverview");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getGameOverviewResumeFocusKey(savedView) ?? "gameoverview:back");
            ctx.markResumeApplied();
            await ctx.loadFriendGame(
                goCachedFriend,
                savedState.friendGameId ?? null,
                true,
                "gameoverview:back",
                true
            );
            return true;
        }
        if (goSavedSource === "trackedSet") {
            const selfUsername = getSavedFriendUsername(savedState);
            const cachedSelf = selfUsername ? findResumeFriendRow(savedState, ctx.friendsPayload) : null;
            ctx.friendGameReturnGameIdRef.current = getResumeFriendGameId(savedState);
            ctx.setFriendGameSource(getSavedFriendGameSource(savedState));
            ctx.setFriendGameSelectionMode(getSavedFriendGameSelectionMode(savedState));
            if (selfUsername && cachedSelf) {
                ctx.setSelectedFriend(cachedSelf);
            }
            ctx.setView("gameOverview");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getGameOverviewResumeFocusKey(savedView) ?? "gameoverview:back");
            ctx.markResumeApplied();
            return true;
        }
        ctx.setView("gameOverview");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getGameOverviewResumeFocusKey(savedView) ?? "gameoverview:back");
        ctx.markResumeApplied();
        return true;
    }

    return false;
}
