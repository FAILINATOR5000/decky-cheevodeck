import { routerHook } from "@decky/api";
import { useEffect, useState } from "react";

import { CompositionHold, hasCompositionHold, holdComposition } from "../ui/compositionHold";
import { playToggleSound } from "../../utils/navSound";

const GLOBAL_COMPONENT = "CheevoDeckScreenDarken";

const BLACKOUT_Z_INDEX = 65001;

// Memory only, deliberately. This is not a settings knob and must not become one.
let darkened = false;

const listeners = new Set<(on: boolean) => void>();

function setDarkened(on: boolean) {
    if (darkened === on) {
        return;
    }
    darkened = on;
    listeners.forEach((listener) => listener(on));
    syncStandIn();
}

let deckyMounted = 0;

let standIn: (() => void) | null = null;

function syncStandIn() {
    const wanted = darkened && deckyMounted === 0;
    if (wanted && !standIn) {
        standIn = mountStandIn();
    }
    else if (!wanted && standIn) {
        standIn();
        standIn = null;
    }
}

function mountStandIn(): (() => void) | null {
    const doc = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.BrowserWindow?.document;
    if (!doc?.body) {
        return null;
    }
    const blackout = doc.createElement("div");
    blackout.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #000000; z-index: ${BLACKOUT_Z_INDEX}`;
    doc.body.appendChild(blackout);
    const release = holdComposition(`${GLOBAL_COMPONENT}StandIn`);
    return () => {
        release();
        blackout.remove();
    };
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

function ScreenDarken() {
    const on = useDarkened();

    useEffect(() => {
        deckyMounted += 1;
        syncStandIn();
        return () => {
            deckyMounted -= 1;
            syncStandIn();
        };
    }, []);

    if (!on) {
        return null;
    }

    return (
        <>
            {hasCompositionHold() && <CompositionHold owner={GLOBAL_COMPONENT} />}
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

export function toggleScreenDarken(): boolean {
    setDarkened(!darkened);
    playToggleSound(darkened);
    return darkened;
}

export function useScreenDarken(): [boolean, (on: boolean) => void] {
    return [useDarkened(), setDarkened];
}
