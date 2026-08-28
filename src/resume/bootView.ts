import { ALL_VIEW_KEYS } from "../routes";
import type { Payload, ResumeState, ViewKey } from "../types";

export function getSavedNavStack(resumeState: ResumeState | null): ViewKey[] | null {
    const saved = resumeState?.navStack;
    if (!Array.isArray(saved) || saved.length === 0) {
        return null;
    }
    const trail: ViewKey[] = [];
    for (const entry of saved) {
        const view = String(entry || "").trim() as ViewKey;
        if (!ALL_VIEW_KEYS.includes(view)) {
            return null;
        }
        trail.push(view);
    }
    return trail;
}

export function computeBootView(resumeState: ResumeState | null, payload: Payload | null): ViewKey {
    const shouldBootDirectlyToTracked = Boolean(payload) && resumeState?.view === "tracked";
    const shouldBootDirectlyToFriendGame = resumeState?.view === "friendGame";
    const shouldBootDirectlyToFriendAllGames = resumeState?.view === "friendAllGames";
    const shouldBootDirectlyToWantToPlay = resumeState?.view === "wantToPlay";
    const shouldBootDirectlyToFollowedRanking = resumeState?.view === "followedRanking";
    const shouldBootDirectlyToFriendCompare = resumeState?.view === "friendCompare";
    const shouldBootDirectlyToOptions = resumeState?.view === "options";
    const shouldBootDirectlyToUnlockHistory = resumeState?.view === "unlockHistory";
    const shouldBootDirectlyToAbout = resumeState?.view === "about";
    const shouldBootDirectlyToFriends = resumeState?.view === "social";
    const shouldBootDirectlyToComparePicker = resumeState?.view === "comparePicker";
    const shouldBootDirectlyToLeaderboards = resumeState?.view === "leaderboards";
    const shouldBootDirectlyToLeaderboardDetail = resumeState?.view === "leaderboardDetail";
    const shouldBootDirectlyToGameNotes = resumeState?.view === "gameNotes";
    const shouldBootDirectlyToBadges = resumeState?.view === "badges";
    const shouldBootDirectlyToGameOverview = resumeState?.view === "gameOverview";
    const shouldBootDirectlyToAchievementOverview = resumeState?.view === "achievementOverview";
    const shouldBootDirectlyToTrackedSets = resumeState?.view === "trackedSets";
    const shouldBootDirectlyToTrackedSetOpen = resumeState?.view === "trackedSetOpen";
    const shouldBootDirectlyToUtils = resumeState?.view === "utils";
    const shouldBootDirectlyToDolphinMapper = resumeState?.view === "dolphinMapper";
    const shouldBootDirectlyToSmbShares = resumeState?.view === "smbShares";
    const shouldBootDirectlyToCheevoCheck = resumeState?.view === "cheevoCheck";
    const shouldBootDirectlyToFileWatcher = resumeState?.view === "fileWatcher";
    const shouldBootDirectlyToGuides = resumeState?.view === "guides";
    return shouldBootDirectlyToFriendGame ? "friendGame" :
            shouldBootDirectlyToFriendAllGames ? "friendAllGames" :
                shouldBootDirectlyToWantToPlay ? "wantToPlay" :
                shouldBootDirectlyToFollowedRanking ? "followedRanking" :
                shouldBootDirectlyToFriendCompare ? "friendCompare" :
                    shouldBootDirectlyToOptions ? "options" :
                        shouldBootDirectlyToUnlockHistory ? "unlockHistory" :
                            shouldBootDirectlyToAbout ? "about" :
                                shouldBootDirectlyToComparePicker ? "comparePicker" :
                                    shouldBootDirectlyToFriends ? "social" :
                                        shouldBootDirectlyToLeaderboardDetail ? "leaderboardDetail" :
                                            shouldBootDirectlyToLeaderboards ? "leaderboards" :
                                                shouldBootDirectlyToGameNotes ? "gameNotes" :
                                                    shouldBootDirectlyToBadges ? "badges" :
                                                        shouldBootDirectlyToGameOverview ? "gameOverview" :
                                                            shouldBootDirectlyToAchievementOverview ? "achievementOverview" :
                                                                shouldBootDirectlyToTrackedSetOpen ? "trackedSetOpen" :
                                                                shouldBootDirectlyToTrackedSets ? "trackedSets" :
                                                                shouldBootDirectlyToDolphinMapper ? "dolphinMapper" :
                                                                shouldBootDirectlyToSmbShares ? "smbShares" :
                                                                shouldBootDirectlyToCheevoCheck ? "cheevoCheck" :
                                                                shouldBootDirectlyToFileWatcher ? "fileWatcher" :
                                                                shouldBootDirectlyToUtils ? "utils" :
                                                                shouldBootDirectlyToGuides ? "guides" :
                                                                shouldBootDirectlyToTracked ? "tracked" :
                                                                    "achievements";
}
