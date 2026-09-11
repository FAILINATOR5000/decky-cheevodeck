import { logFocusDebug } from "../api";

type NoteFocusReturn = {
    gameId: number;
    noteId: string;
    ulid: string;
};

let pending: NoteFocusReturn | null = null;

export function armNoteFocusReturn(gameId: number, noteId: string, ulid: string): void {
    if (!noteId) {
        return;
    }
    logFocusDebug("note-return-arm", noteId, `game=${gameId}`);
    pending = { gameId, noteId, ulid };
}

export function clearNoteFocusReturn(): void {
    if (pending === null) {
        return;
    }
    logFocusDebug("note-return-clear", pending.noteId, "");
    pending = null;
}

export function takeNoteFocusReturn(): NoteFocusReturn | null {
    const held = pending;
    pending = null;
    if (held) {
        logFocusDebug("note-return-take", held.noteId, `game=${held.gameId}`);
    }
    return held;
}
