import { logFocusDebug } from "../api";

let pending: string | null = null;

export function armDolphinFocusReturn(focusKey: string): void {
    logFocusDebug("dolphin-return-arm", focusKey, "");
    pending = focusKey;
}

export function takeDolphinFocusReturn(): string | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("dolphin-return-take", held, "");
    }
    return held;
}
