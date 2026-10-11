import { useSyncExternalStore } from "react";
import { logFocusDebug } from "./api";

const up = new Set<string>();
const listeners = new Set<() => void>();

export function setCover(owner: string, raised: boolean) {
    if (raised === up.has(owner)) {
        return;
    }
    if (raised) {
        up.add(owner);
    }
    else {
        up.delete(owner);
    }
    logFocusDebug("cover", raised ? "up" : "down", `${owner} covered=${up.size > 0}`);
    queueMicrotask(() => {
        for (const listener of listeners) {
            listener();
        }
    });
}

export function isCovered(): boolean {
    return up.size > 0;
}

export function subscribeCovers(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function snapshot(): boolean {
    return up.size > 0;
}

export function useCovered(): boolean {
    return useSyncExternalStore(subscribeCovers, snapshot);
}
