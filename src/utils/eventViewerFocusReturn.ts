import { logFocusDebug } from "../api";

type EventViewerRowReturn = {
    eventGameId: number;
    achievementId: number;
    ulid: string;
};

let pending: EventViewerRowReturn | null = null;

export function armEventViewerRowReturn(eventGameId: number, achievementId: number, ulid: string): void {
    logFocusDebug("eventviewer-return-arm", String(achievementId), `event=${eventGameId}`);
    pending = { eventGameId, achievementId, ulid };
}

export function clearEventViewerRowReturn(): void {
    pending = null;
}

export function takeEventViewerRowReturn(eventGameId: number, ulid: string): number | null {
    const held = pending;
    pending = null;
    if (held === null || held.eventGameId !== eventGameId || held.ulid !== ulid) {
        return null;
    }
    logFocusDebug("eventviewer-return-take", String(held.achievementId), `event=${eventGameId}`);
    return held.achievementId;
}
