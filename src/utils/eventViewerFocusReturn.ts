import { logFocusDebug } from "../api";

type EventViewerReturn = {
    eventGameId: number;
    ulid: string;
    achievementId: number | null;
    buttonKey: string | null;
};

let pending: EventViewerReturn | null = null;

export function armEventViewerRowReturn(eventGameId: number, achievementId: number, ulid: string): void {
    logFocusDebug("eventviewer-return-arm", String(achievementId), `event=${eventGameId}`);
    pending = { eventGameId, ulid, achievementId, buttonKey: null };
}

export function armEventViewerButtonReturn(eventGameId: number, buttonKey: string, ulid: string): void {
    logFocusDebug("eventviewer-return-arm", buttonKey, `event=${eventGameId}`);
    pending = { eventGameId, ulid, achievementId: null, buttonKey };
}

export function clearEventViewerRowReturn(): void {
    pending = null;
}

export function takeEventViewerReturn(eventGameId: number, ulid: string): EventViewerReturn | null {
    const held = pending;
    pending = null;
    if (held === null || held.eventGameId !== eventGameId || held.ulid !== ulid) {
        return null;
    }
    logFocusDebug("eventviewer-return-take", held.buttonKey ?? String(held.achievementId), `event=${eventGameId}`);
    return held;
}
