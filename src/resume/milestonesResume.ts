import type { MilestonesTab, ResumeState } from "../types";

export function getSavedMilestonesTab(savedState: ResumeState): MilestonesTab {
    return savedState.milestonesTab === "quests" ? "quests" : "milestones";
}
