import { logFocusDebug } from "../api";

let pending: string | null = null;

export function armCheevoCheckFocusReturn(focusKey: string): void {
    logFocusDebug("cheevocheck-return-arm", focusKey, "");
    pending = focusKey;
}

export function clearCheevoCheckFocusReturn(): void {
    if (pending === null) {
        return;
    }
    logFocusDebug("cheevocheck-return-clear", pending, "");
    pending = null;
}

export function takeCheevoCheckFocusReturn(): string | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("cheevocheck-return-take", held, "");
    }
    return held;
}
