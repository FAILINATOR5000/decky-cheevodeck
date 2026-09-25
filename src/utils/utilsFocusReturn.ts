import { logFocusDebug } from "../api";

let pending: string | null = null;

export function armUtilsFocusKey(focusKey: string): void {
    if (!focusKey) {
        return;
    }
    logFocusDebug("utils-return-arm", focusKey, "control");
    pending = focusKey;
}

export function takeUtilsFocusReturn(): string | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("utils-return-take", held, "control");
    }
    return held;
}
