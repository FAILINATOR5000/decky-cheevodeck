import type { GuidesSubView, ResumeState } from "../types";

export function getSavedGuidesSubView(savedState: ResumeState): GuidesSubView {
    if (savedState.guidesSubView === "reader") {
        return "reader";
    }
    if (savedState.guidesSubView === "search") {
        return "search";
    }
    return "list";
}
