let movedAt = 0;

export function noteCurrentGameMoved() {
    movedAt = Date.now();
}

export function currentGameMovedSince(at: number): boolean {
    return movedAt >= at;
}
