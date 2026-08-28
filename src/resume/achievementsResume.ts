import type { ViewKey } from "../types";
import type { MainAchievementsTab, ResumeState } from "../types";

export function getSavedMainAchievementsTab(savedState: ResumeState): MainAchievementsTab {
    const value = savedState.mainAchievementsTab;
    if (value === "activity" || value === "comments" || value === "compare") {
        return value;
    }
    return "achievements";
}

export function getAchievementsResumeFocusKey(savedView: ViewKey | null | undefined): string | null {
    return savedView === "tracked" ? "tracked:back" : null;
}

export function resolveRestoredPrimaryView({
    rememberLastPage,
    requestedLastPrimaryView
}: {
    rememberLastPage: boolean;
    requestedLastPrimaryView?: "achievements" | "tracked" | null;
}): {
    view: "achievements" | "tracked";
    focusKey: string | null;
} {
    if (!rememberLastPage) {
        return { view: "achievements", focusKey: null };
    }

    const nextView = requestedLastPrimaryView === "tracked" ? "tracked" : "achievements";

    return {
        view: nextView,
        focusKey: nextView === "tracked" ? "tracked:back" : null
    };
}
