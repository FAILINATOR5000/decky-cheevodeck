import { logFocusDebug } from "../api";

type MemoriesFocusReturn = {
    gameId: number | null;
    memoryId: string | null;
    focusKey: string | null;
    ulid: string;
};

let pending: MemoriesFocusReturn | null = null;

export function armMemoriesFocusReturn(gameId: number, memoryId: string, ulid: string): void {
    if (!memoryId) {
        return;
    }
    logFocusDebug("memory-return-arm", memoryId, `game=${gameId}`);
    pending = { gameId, memoryId, focusKey: null, ulid };
}

export function armMemoriesFocusKey(focusKey: string): void {
    if (!focusKey) {
        return;
    }
    logFocusDebug("memory-return-arm", focusKey, "control");
    pending = { gameId: null, memoryId: null, focusKey, ulid: "" };
}

export function takeMemoriesFocusReturn(): MemoriesFocusReturn | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("memory-return-take", held.memoryId ?? held.focusKey ?? "", `game=${held.gameId}`);
    }
    return held;
}
