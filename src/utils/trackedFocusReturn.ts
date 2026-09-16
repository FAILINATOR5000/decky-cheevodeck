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

export function retargetTrackedFocusReturn(achievementId: number): void {
    if (pending === null || !achievementId) {
        return;
    }
    logFocusDebug("tracked-return-retarget", String(achievementId), `was ${pending.achievementId}`);
    pending = { ...pending, achievementId };
}

export function takeTrackedFocusReturn(): TrackedFocusReturn | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("tracked-return-take", String(held.achievementId), "");
    }
    return held;
}
