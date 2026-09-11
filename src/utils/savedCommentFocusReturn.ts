import { logFocusDebug } from "../api";

let pending: string | null = null;

export function armSavedCommentFocusReturn(focusKey: string): void {
    logFocusDebug("savedcomment-return-arm", focusKey, "");
    pending = focusKey;
}

export function takeSavedCommentFocusReturn(): string | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("savedcomment-return-take", held, "");
    }
    return held;
}
