import type { NowPlayingCompareFilter, ResumeState } from "../types";

export function getSavedCompareFriend(savedState: ResumeState): string {
    return String(savedState.nowPlayingCompareFriend || "").trim();
}

export function getSavedCompareFilter(savedState: ResumeState): NowPlayingCompareFilter {
    const value = savedState.nowPlayingCompareFilter;
    if (value === "onlyYou" || value === "onlyThem" || value === "shared") {
        return value;
    }
    return "all";
}

export function getNowPlayingResumeFocusKey(view: ResumeState["view"]): string | null {
    if (view === "comparePicker") {
        return "comparepicker:back";
    }
    return null;
}
