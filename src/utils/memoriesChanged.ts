const listeners = new Set<() => void>();

export function announceMemoriesChanged(): void {
    for (const listener of listeners) {
        listener();
    }
}

export function subscribeMemoriesChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
