import { useEffect, useState } from "react";

let muted = false;

const listeners = new Set<(value: boolean) => void>();

export function setClipMuted(value: boolean): void {
    if (muted === value) {
        return;
    }
    muted = value;
    listeners.forEach((listener) => listener(value));
}

export function getClipMuted(): boolean {
    return muted;
}

export function useClipMuted(): boolean {
    const [value, setValue] = useState(muted);

    useEffect(() => {
        listeners.add(setValue);
        setValue(muted);
        return () => {
            listeners.delete(setValue);
        };
    }, []);

    return value;
}
