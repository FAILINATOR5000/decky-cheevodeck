import type { AOSource, AchievementOverviewSnapshot, ResumeState, ViewKey } from "../types";
import { getSavedBadgeFilter } from "./badgesResume";
import {
    findResumeFriendRow,
    getResumeFriendGameId,
    getSavedFriendEntrySource,
    getSavedFriendGameSelectionMode,
    getSavedFriendGameSource,
    getSavedFriendUsername
} from "./friendsResume";
import { getSavedGameOverviewSource } from "./gameOverviewResume";
import { getSavedUnlockHistorySource } from "./unlockHistoryResume";
import type { RestoreContext } from "./restoreContext";

const KNOWN_SOURCES: AOSource[] = [
    "main",
    "tracked",
    "gameOverview",
    "newsEvents",
    "socialActivity",
    "mainNowPlaying",
    "friend",
    "unlockHistory",
    "notification",
    "subscribedDiscussions",
    "external",
];

export function getSavedAoSource(savedState: ResumeState): AOSource {
    const value = savedState.aoSource;
    if (value && KNOWN_SOURCES.indexOf(value) !== -1) {
        return value;
    }
    return "main";
}

export function getSavedAoAchievementId(savedState: ResumeState): number | null {
    const raw = savedState.aoAchievementId;
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
    }
    return null;
}

export function getSavedAoGameId(savedState: ResumeState): number | null {
    const raw = savedState.aoGameId;
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
    }
    return null;
}

export function getSavedAoViewedUsername(savedState: ResumeState): string | null {
    const raw = savedState.aoViewedUsername;
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function getSavedAoViewedUserRef(savedState: ResumeState): string | null {
    const raw = savedState.aoViewedUserRef;
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function getSavedAoSnapshot(savedState: ResumeState): AchievementOverviewSnapshot | null {
    const raw = savedState.aoAchievementSnapshot;
    if (!raw || typeof raw !== "object") {
        return null;
    }
    if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) {
        return null;
    }
    return raw;
}

function getAchievementOverviewResumeFocusKey(view: ResumeState["view"]): string | null {
    if (view === "achievementOverview") {
        return "ao:back";
    }
    return null;
}

export async function restoreAchievementOverview(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): Promise<boolean> {
    if (savedView === "achievementOverview") {
        const savedAchievementId = getSavedAoAchievementId(savedState);
        const savedSnapshot = getSavedAoSnapshot(savedState);
        if (savedAchievementId == null || savedSnapshot == null) {
            ctx.setView("achievements");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.markResumeApplied();
            return true;
        }
        const aoSavedSource = getSavedAoSource(savedState);
        const aoFriendUsername = getSavedFriendUsername(savedState);
        const aoCachedFriend = aoFriendUsername ? findResumeFriendRow(savedState, ctx.friendsPayload) : null;
        const aoFromFriendUnlockHistory =
            aoSavedSource === "unlockHistory" && getSavedUnlockHistorySource(savedState) === "friendGame";
        if ((aoSavedSource === "friend" || aoFromFriendUnlockHistory) && aoCachedFriend) {
            const savedFriendGameSource = getSavedFriendGameSource(savedState);
            const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
            ctx.friendGameReturnGameIdRef.current = savedState.friendGameId ?? null;
            ctx.friendEntrySourceRef.current = getSavedFriendEntrySource(savedState);
            ctx.setFriendGameSource(savedFriendGameSource);
            ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
            ctx.setSelectedFriend(aoCachedFriend);
            ctx.setView("achievementOverview");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getAchievementOverviewResumeFocusKey(savedView) ?? "ao:back");
            ctx.markResumeApplied();
            await ctx.loadFriendGame(
                aoCachedFriend,
                savedState.friendGameId ?? null,
                true,
                "ao:back",
                true
            );
            return true;
        }
        const goParentSource = getSavedGameOverviewSource(savedState);
        const aoParentFriendUsername = getSavedFriendUsername(savedState);
        const aoParentCachedFriend = aoParentFriendUsername
            ? findResumeFriendRow(savedState, ctx.friendsPayload)
            : null;
        if (aoSavedSource === "gameOverview" && goParentSource === "friend" && aoParentCachedFriend) {
            const savedFriendGameSource = getSavedFriendGameSource(savedState);
            const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
            ctx.friendGameReturnGameIdRef.current = savedState.friendGameId ?? null;
            ctx.friendEntrySourceRef.current = getSavedFriendEntrySource(savedState);
            ctx.setFriendGameSource(savedFriendGameSource);
            ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
            ctx.setSelectedFriend(aoParentCachedFriend);
            ctx.setView("achievementOverview");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getAchievementOverviewResumeFocusKey(savedView) ?? "ao:back");
            ctx.markResumeApplied();
            await ctx.loadFriendGame(
                aoParentCachedFriend,
                savedState.friendGameId ?? null,
                true,
                "ao:back",
                true
            );
            return true;
        }
        if (aoSavedSource === "gameOverview" && goParentSource === "wantToPlay" && aoParentCachedFriend) {
            const savedFriendGameSource = getSavedFriendGameSource(savedState);
            const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
            ctx.friendGameReturnGameIdRef.current = savedState.friendGameId ?? null;
            ctx.setFriendGameSource(savedFriendGameSource);
            ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
            ctx.setSelectedFriend(aoParentCachedFriend);
            ctx.setView("achievementOverview");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getAchievementOverviewResumeFocusKey(savedView) ?? "ao:back");
            ctx.markResumeApplied();
            await ctx.loadFriendGame(
                aoParentCachedFriend,
                savedState.friendGameId ?? null,
                true,
                "ao:back",
                true
            );
            return true;
        }
        if (aoSavedSource === "gameOverview" && goParentSource === "badges" && aoParentCachedFriend) {
            const savedFriendGameSource = getSavedFriendGameSource(savedState);
            const savedFriendGameSelectionMode = getSavedFriendGameSelectionMode(savedState);
            ctx.friendGameReturnGameIdRef.current = savedState.friendGameId ?? null;
            ctx.setFriendGameSource(savedFriendGameSource);
            ctx.setFriendGameSelectionMode(savedFriendGameSelectionMode);
            ctx.setSelectedFriend(aoParentCachedFriend);
            ctx.setBadgeFilter(getSavedBadgeFilter(savedState));
            ctx.setView("achievementOverview");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getAchievementOverviewResumeFocusKey(savedView) ?? "ao:back");
            ctx.markResumeApplied();
            await ctx.loadFriendGame(
                aoParentCachedFriend,
                savedState.friendGameId ?? null,
                true,
                "ao:back",
                true
            );
            return true;
        }
        if (aoSavedSource === "gameOverview" && goParentSource === "trackedSet") {
            const selfUsername = getSavedFriendUsername(savedState);
            const cachedSelf = selfUsername ? findResumeFriendRow(savedState, ctx.friendsPayload) : null;
            ctx.friendGameReturnGameIdRef.current = getResumeFriendGameId(savedState);
            ctx.setFriendGameSource(getSavedFriendGameSource(savedState));
            ctx.setFriendGameSelectionMode(getSavedFriendGameSelectionMode(savedState));
            if (selfUsername && cachedSelf) {
                ctx.setSelectedFriend(cachedSelf);
            }
            ctx.setView("achievementOverview");
            ctx.setPendingPrimaryViewRestoreGameId(undefined);
            ctx.setPendingFocusKey(getAchievementOverviewResumeFocusKey(savedView) ?? "ao:back");
            ctx.markResumeApplied();
            return true;
        }
        ctx.setView("achievementOverview");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getAchievementOverviewResumeFocusKey(savedView) ?? "ao:back");
        ctx.markResumeApplied();
        return true;
    }

    return false;
}
