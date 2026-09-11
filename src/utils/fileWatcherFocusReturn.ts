import { logFocusDebug } from "../api";

let pending: string | null = null;

export function armFileWatcherFocusReturn(focusKey: string): void {
    logFocusDebug("filewatcher-return-arm", focusKey, "");
    pending = focusKey;
}

export function takeFileWatcherFocusReturn(): string | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("filewatcher-return-take", held, "");
    }
    return held;
}
