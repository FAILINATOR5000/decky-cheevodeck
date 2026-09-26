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

let landing: string | null = null;
let landingListener: ((focusKey: string) => void) | null = null;

export function armOptionsLanding(focusKey: string): void {
    logFocusDebug("options-landing-arm", focusKey, landingListener ? "live" : "mount");
    if (landingListener) {
        landingListener(focusKey);
        return;
    }
    landing = focusKey;
}

export function listenForOptionsLanding(listener: (focusKey: string) => void): () => void {
    landingListener = listener;
    return () => {
        if (landingListener === listener) {
            landingListener = null;
        }
    };
}

export function takeOptionsLanding(): string | null {
    const held = landing;
    landing = null;
    return held;
}
