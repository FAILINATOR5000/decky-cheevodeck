import { logFocusDebug } from "../api";

type TrackedFocusReturn = {
    achievementId: number;
    ulid: string;
};

let pending: TrackedFocusReturn | null = null;

export function armTrackedFocusReturn(achievementId: number, ulid: string): void {
    if (!achievementId) {
        return;
    }
    logFocusDebug("tracked-return-arm", String(achievementId), "");
    pending = { achievementId, ulid };
}

export function takeTrackedFocusReturn(): TrackedFocusReturn | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("tracked-return-take", String(held.achievementId), "");
    }
    return held;
}
