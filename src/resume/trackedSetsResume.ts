import type { ResumeState } from "../types";

export function getSavedTrackedSetOpenId(savedState: ResumeState): string | null {
    const value = savedState.trackedSetOpenId;
    if (typeof value === "string" && value) {
        return value;
    }
    return null;
}

export function getSavedTrackedSetsBackSource(savedState: ResumeState): "profile" | "main" {
    return savedState.trackedSetsBackSource === "main" ? "main" : "profile";
}
