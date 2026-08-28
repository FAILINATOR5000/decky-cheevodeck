import type { AllGamesLetterRangeKey, AllGamesStatusFilter, ResumeState } from "../types";

export function getSavedAllGamesLetterRange(savedState: ResumeState): AllGamesLetterRangeKey {
    const value = savedState.allGamesLetterRange;
    if (
        value === "numbers"
        || value === "a-f"
        || value === "g-l"
        || value === "m-r"
        || value === "s-u"
        || value === "v-z"
    ) {
        return value;
    }
    return "a-f";
}

export function getSavedAllGamesStatusFilter(savedState: ResumeState): AllGamesStatusFilter {
    const value = savedState.allGamesStatusFilter;
    if (
        value === "mastered"
        || value === "completed"
        || value === "beaten-hardcore"
        || value === "beaten-softcore"
        || value === "unfinished"
    ) {
        return value;
    }
    return "all";
}
