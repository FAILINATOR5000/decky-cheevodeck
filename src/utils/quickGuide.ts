import { useEffect, useState } from "react";

export type QuickGuideState = {
    visible: boolean;
    onPress: () => void;
};

let current: QuickGuideState = { visible: false, onPress: () => {} };

const listeners = new Set<() => void>();

export function setQuickGuide(next: QuickGuideState) {
    current = next;
    for (const listener of listeners) {
        listener();
    }
}

export function currentQuickGuideVisible(): boolean {
    return current.visible;
}

export function useQuickGuide(): QuickGuideState {
    const [state, setState] = useState<QuickGuideState>(current);

    useEffect(() => {
        const sync = () => setState(current);
        listeners.add(sync);
        sync();
        return () => {
            listeners.delete(sync);
        };
    }, []);

    return state;
}
