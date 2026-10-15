import { addEventListener, removeEventListener } from "@decky/api";
import { getMilestonesState, recordMilestoneEventCall } from "../api";
import type { MilestonesState, MilestonesStateResponse } from "../types";
import { logError } from "./errors";

export type MilestoneEventKind =
    | "profile_from_avatar"
    | "quick_menu_open"
    | "notifications_open"
    | "search_game_info"
    | "game_info_chevron"
    | "main_tab"
    | "achievement_info"
    | "track"
    | "options_open"
    | "page_help"
    | "back_b"
    | "home"
    | "shortcut_pageUp"
    | "shortcut_notifications"
    | "shortcut_search"
    | "menu_combo"
    | "profile_open"
    | "friend_favorite"
    | "compare"
    | "ranking_open"
    | "pny_mode"
    | "feed_game"
    | "subscribe"
    | "comment_saved"
    | "post"
    | "news_open"
    | "event_tracked"
    | "set_feed"
    | "leaderboard_open"
    | "timeline"
    | "memory_edited"
    | "memory_shared"
    | "guide_open"
    | "guide_search"
    | "guide_large"
    | "browser_open"
    | "night_on"
    | "unlock_history"
    | "awards_open"
    | "activity_open"
    | "global_browser"
    | "global_memories"
    | "global_last_memory"
    | "global_last_guide"
    | "bootcat_preview"
    | "check_updates"
    | "bootcat_line_1"
    | "bootcat_line_2"
    | "bootcat_line_3";

export const BOOT_CAT_LINE_KINDS: MilestoneEventKind[] = ["bootcat_line_1", "bootcat_line_2", "bootcat_line_3"];

export const MILESTONES_EVENT = "cheevodeck_milestones";

let needed: Set<string> | null = null;
let reading = false;
let readAgain = false;

let last: MilestonesState | null = null;

export function noteMilestonesState(state: MilestonesStateResponse) {
    needed = state.ok ? new Set(state.neededKinds) : new Set();
    last = state.ok ? state : null;
}

export function lastMilestonesState(): MilestonesState | null {
    return last;
}

export function noteMilestonesSeen() {
    if (last) {
        last = { ...last, newIds: [] };
    }
}

function readNeeded() {
    if (reading) {
        readAgain = true;
        return;
    }
    reading = true;
    getMilestonesState()
        .then(noteMilestonesState)
        .catch((e) => logError("milestones: reading the kinds still counted", e))
        .finally(() => {
            reading = false;
            if (readAgain) {
                readAgain = false;
                readNeeded();
            }
        });
}

export function watchMilestoneKinds(): () => void {
    addEventListener(MILESTONES_EVENT, readNeeded);
    readNeeded();
    return () => removeEventListener(MILESTONES_EVENT, readNeeded);
}

export function recordMilestoneEvent(kind: MilestoneEventKind, detail?: string) {
    if (needed !== null && !needed.has(kind)) {
        return;
    }
    recordMilestoneEventCall(kind, detail ?? null).catch((e) => logError("milestones: counting " + kind, e));
}
