import { useEffect } from "react";

const OVERLAY_COMPOSITION = 2;

type CompositionStore = {
    AddMinimumCompositionStateRequest: (state: number, owner: string) => void;
    RemoveMinimumCompositionStateRequest: (state: number, owner: string) => void;
};

function compositionStore(): CompositionStore | null {
    const store = (window as any).SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.CompositionStateStore;
    if (typeof store?.AddMinimumCompositionStateRequest !== "function"
        || typeof store?.RemoveMinimumCompositionStateRequest !== "function") {
        return null;
    }
    return store;
}

export function hasCompositionHold(): boolean {
    return compositionStore() !== null;
}

// Holds Steam's composition request for as long as it stays mounted.
export function CompositionHold(props: { owner: string }) {
    useEffect(() => {
        const store = compositionStore();
        store?.AddMinimumCompositionStateRequest(OVERLAY_COMPOSITION, props.owner);
        return () => {
            store?.RemoveMinimumCompositionStateRequest(OVERLAY_COMPOSITION, props.owner);
        };
    }, [props.owner]);
    return null;
}
