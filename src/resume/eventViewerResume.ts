import type { EventViewerSource, EventViewerTab, EventViewerTarget, ResumeState, ViewKey } from "../types";
import type { RestoreContext } from "./restoreContext";

export function getSavedEventViewerTarget(savedState: ResumeState): EventViewerTarget | null {
    const raw = String(savedState.eventViewerTarget ?? "").trim();
    if (raw === "aotw") {
        return "aotw";
    }
    const gameId = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(gameId) && gameId > 0 ? gameId : null;
}

export function getSavedEventViewerTab(savedState: ResumeState): EventViewerTab {
    return savedState.eventViewerTab === "comments" ? "comments" : "achievements";
}

export function getSavedEventViewerSource(savedState: ResumeState): EventViewerSource {
    const source = savedState.eventViewerSource;
    return source === "main" || source === "subscribedDiscussions" ? source : "events";
}

export function restoreEventViewer(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): boolean {
    if (savedView !== "eventViewer") {
        return false;
    }
    if (getSavedEventViewerTarget(savedState) === null) {
        ctx.setView("achievements", "root");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.markResumeApplied();
        return true;
    }
    ctx.setRecentGamesExpanded(false);
    ctx.setView("eventViewer");
    ctx.setPendingPrimaryViewRestoreGameId(undefined);
    ctx.setPendingFocusKey("eventviewer:back");
    ctx.markResumeApplied();
    return true;
}
