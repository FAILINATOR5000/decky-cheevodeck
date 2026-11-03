const listeners = new Set<(shown: boolean) => void>();

export function announceShowOnlineChanged(shown: boolean): void {
    for (const listener of listeners) {
        listener(shown);
    }
}

export function subscribeShowOnlineChanged(listener: (shown: boolean) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
