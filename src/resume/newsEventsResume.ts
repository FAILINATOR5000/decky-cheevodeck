import type { AotwSubView, NewSetsFilter, NewsEventsSubView, ResumeState } from "../types";

export function getSavedNewsEventsSubView(savedState: ResumeState): NewsEventsSubView {
    const value = savedState.newsEventsSubView;
    if (value === "aotw" || value === "newSets") {
        return value;
    }
    return "news";
}

export function getSavedAotwSubView(savedState: ResumeState): AotwSubView {
    const value = savedState.aotwSubView;
    if (value === "comments") {
        return value;
    }
    return "unlocks";
}

export function getSavedNewSetsFilter(savedState: ResumeState): NewSetsFilter {
    const value = savedState.newSetsFilter;
    if (value === "revision") {
        return value;
    }
    return "new";
}
