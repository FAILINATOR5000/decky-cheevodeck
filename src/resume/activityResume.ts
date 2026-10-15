import type { ActivitySubject, ResumeState, ViewKey } from "../types";
import type { RestoreContext } from "./restoreContext";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function getSavedActivitySubject(savedState: ResumeState): Omit<ActivitySubject, "own"> | null {
    const ulid = String(savedState.activitySubjectUlid ?? "").trim();
    if (!ULID.test(ulid)) {
        return null;
    }
    return { ulid, username: String(savedState.activitySubjectName ?? "").trim() };
}

export function getSavedActivityMonth(savedState: ResumeState): string | null {
    const month = String(savedState.activityMonth ?? "").trim();
    return MONTH.test(month) ? month : null;
}

export function getSavedActivityDay(savedState: ResumeState): string | null {
    const day = String(savedState.activityDay ?? "").trim();
    const month = getSavedActivityMonth(savedState);
    return DAY.test(day) && month !== null && day.startsWith(month) ? day : null;
}

export function restoreActivity(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): boolean {
    if (savedView !== "activity") {
        return false;
    }
    if (getSavedActivitySubject(savedState) === null) {
        ctx.setView("achievements", "root");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.markResumeApplied();
        return true;
    }
    ctx.setRecentGamesExpanded(false);
    ctx.setView("activity");
    ctx.setPendingPrimaryViewRestoreGameId(undefined);
    ctx.setPendingFocusKey("activity:back");
    ctx.markResumeApplied();
    return true;
}
