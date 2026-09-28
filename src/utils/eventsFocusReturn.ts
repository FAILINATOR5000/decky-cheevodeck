import { logFocusDebug } from "../api";
import type { EventsListView } from "../types";

export type EventsFocusReturn = {
    eventGameId: number | null;
    listView: EventsListView;
    focusKey: string;
    ulid: string;
};

let pending: EventsFocusReturn | null = null;

export function armEventsRowReturn(eventGameId: number, listView: EventsListView, focusKey: string, ulid: string): void {
    logFocusDebug("events-return-arm", focusKey, `list=${listView}`);
    pending = { eventGameId, listView, focusKey, ulid };
}

export function armEventsFocusKey(focusKey: string, listView: EventsListView): void {
    logFocusDebug("events-return-arm", focusKey, "control");
    pending = { eventGameId: null, listView, focusKey, ulid: "" };
}

export function clearEventsFocusReturn(): void {
    pending = null;
}

export function takeEventsFocusReturn(): EventsFocusReturn | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("events-return-take", held.focusKey, `list=${held.listView}`);
    }
    return held;
}
