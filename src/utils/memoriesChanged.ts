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

const captureListeners = new Set<() => void>();

export function announceMemoriesCaptureOn(): void {
    for (const listener of captureListeners) {
        listener();
    }
}

export function subscribeMemoriesCaptureOn(listener: () => void): () => void {
    captureListeners.add(listener);
    return () => {
        captureListeners.delete(listener);
    };
}
