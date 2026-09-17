import { findModuleExport } from "@decky/ui";

const OVERLAY_COMPOSITION = 2;

type CompositionHoldHook = (state: number, owner: string) => unknown;

const COMPOSITION_HOOK_MARKERS = [
    "AddMinimumCompositionStateRequest",
    "RemoveMinimumCompositionStateRequest",
    ".useEffect(",
    ".useRef("
];

let compositionHold: CompositionHoldHook | null | undefined;

function findCompositionHold(): CompositionHoldHook | null {
    if (compositionHold !== undefined) {
        return compositionHold;
    }
    try {
        compositionHold = findModuleExport((e: any) => {
            if (typeof e !== "function") {
                return false;
            }
            const source = String(e);
            return COMPOSITION_HOOK_MARKERS.every((marker) => source.includes(marker));
        }) ?? null;
    }
    catch {
        compositionHold = null;
    }
    return compositionHold ?? null;
}

export function hasCompositionHold(): boolean {
    return findCompositionHold() !== null;
}

// Holds Steam's composition request for as long as it stays mounted.
export function CompositionHold(props: { owner: string }) {
    findCompositionHold()?.(OVERLAY_COMPOSITION, props.owner);
    return null;
}
