import { logFocusDebug } from "../api";

let pending: string | null = null;

export function armSmbFocusReturn(focusKey: string): void {
    logFocusDebug("smb-return-arm", focusKey, "");
    pending = focusKey;
}

export function takeSmbFocusReturn(): string | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("smb-return-take", held, "");
    }
    return held;
}
