import { logFocusDebug } from "../api";

let pending: string | null = null;

export function armMemoriesTransferFocusReturn(focusKey: string): void {
    logFocusDebug("memoriestransfer-return-arm", focusKey, "");
    pending = focusKey;
}

export function clearMemoriesTransferFocusReturn(): void {
    if (pending === null) {
        return;
    }
    logFocusDebug("memoriestransfer-return-clear", pending, "");
    pending = null;
}

export function takeMemoriesTransferFocusReturn(): string | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("memoriestransfer-return-take", held, "");
    }
    return held;
}
