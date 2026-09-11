import { logFocusDebug } from "../api";

export type TrackedSetFocusReturn = {
    view: "trackedSets" | "trackedSetOpen";
    setId: string;
    focusKey: string;
    gameId: number | null;
};

let pending: TrackedSetFocusReturn | null = null;

export function armTrackedSetFocusReturn(target: TrackedSetFocusReturn): void {
    if (!target.focusKey) {
        return;
    }
    logFocusDebug("trackedset-return-arm", target.focusKey, `view=${target.view} set=${target.setId || "(none)"}`);
    pending = target;
}

export function takeTrackedSetFocusReturn(): TrackedSetFocusReturn | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("trackedset-return-take", held.focusKey, `view=${held.view} set=${held.setId || "(none)"}`);
    }
    return held;
}
