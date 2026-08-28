let token = 0;

const listeners = new Set<(next: number) => void>();

export function requestJumpToTop(): void {
    token += 1;
    for (const listener of listeners) {
        listener(token);
    }
}

export function subscribeJumpToTop(listener: (next: number) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function currentJumpToTopToken(): number {
    return token;
}
