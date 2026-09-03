import { routerHook } from "@decky/api";
import { findModuleExport } from "@decky/ui";
import { useEffect, useState } from "react";

const GLOBAL_COMPONENT = "CheevoDeckScreenDarken";

const OVERLAY_COMPOSITION = 2;

const BLACKOUT_Z_INDEX = 65001;

// Memory only, deliberately. This is not a settings knob and must not become one.
let darkened = false;

const listeners = new Set<(on: boolean) => void>();

type CompositionHold = (state: number, owner: string) => unknown;

const COMPOSITION_HOOK_MARKERS = [
    "AddMinimumCompositionStateRequest",
    "RemoveMinimumCompositionStateRequest",
    ".useEffect(",
    ".useRef("
];

let compositionHold: CompositionHold | null | undefined;

function findCompositionHold(): CompositionHold | null {
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

function setDarkened(on: boolean) {
    if (darkened === on) {
        return;
    }
    darkened = on;
    listeners.forEach((listener) => listener(on));
}

function useDarkened(): boolean {
    const [on, setOn] = useState(darkened);

    useEffect(() => {
        listeners.add(setOn);
        setOn(darkened);
        return () => {
            listeners.delete(setOn);
        };
    }, []);

    return on;
}

function CompositionHold() {
    findCompositionHold()?.(OVERLAY_COMPOSITION, GLOBAL_COMPONENT);
    return null;
}

function ScreenDarken() {
    const on = useDarkened();

    if (!on) {
        return null;
    }

    return (
        <>
            {findCompositionHold() && <CompositionHold />}
            <div
                style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    width: "100vw",
                    height: "100vh",
                    background: "#000000",
                    zIndex: BLACKOUT_Z_INDEX
                }}
            />
        </>
    );
}

export function registerScreenDarken() {
    routerHook.addGlobalComponent(GLOBAL_COMPONENT, ScreenDarken);
}

export function unregisterScreenDarken() {
    setDarkened(false);
    routerHook.removeGlobalComponent(GLOBAL_COMPONENT);
}

export function useScreenDarken(): [boolean, (on: boolean) => void] {
    return [useDarkened(), setDarkened];
}
