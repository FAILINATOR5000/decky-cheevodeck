import { logFocusDebug } from "../api";

let pending: string | null = null;

export function armOptionsFocusKey(focusKey: string): void {
    if (!focusKey) {
        return;
    }
    logFocusDebug("options-return-arm", focusKey, "control");
    pending = focusKey;
}

export function takeOptionsFocusReturn(): string | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("options-return-take", held, "control");
    }
    return held;
}
