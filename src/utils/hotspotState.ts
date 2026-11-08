import { addEventListener, removeEventListener } from "@decky/api";
import { useSyncExternalStore } from "react";

import {
    hotspotJoin,
    hotspotLeave,
    hotspotSet,
    hotspotSetPrivate,
    hotspotStatus,
    saveHotspotDedicated,
    saveHotspotIntroOff,
    type HotspotStatus
} from "../api";
import { getCurrentLanguage } from "../locales";
import { logError } from "./errors";
import { multiplayerRoomMarker } from "./multiplayerRoomState";
import { showToggleNotice, showToggleToast } from "./toggleToast";

const HOTSPOT_EVENT = "cheevodeck_hotspot";

const OFF: HotspotStatus = {
    ok: true, seq: -1, state: "off", role: "", ssid: "", private: false, code: "", address: "", example: "", devices: [],
    host: "", paused: "", uplink: "", canStay: false, dfs: false, sharing: false, internet: false, startedAt: 0, endsAt: 0
};

const REASONS: Record<string, string> = {
    hosting: "Close the room first",
    seated: "Leave the room first",
    game_mode: "Only in Game Mode",
    wifi_off: "Turn on Wi-Fi first"
};

let status: HotspotStatus = OFF;
let busy = false;
let privateNext = false;
let introOff = false;
let dedicated = true;
let openIntro: ((onConfirm: (hide: boolean) => void) => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: HotspotStatus) {
    if (next.seq < status.seq) {
        return;
    }
    status = { ...OFF, ...next };
    for (const listener of listeners) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function onEvent(payload: HotspotStatus & { toast?: string }) {
    if (!payload || typeof payload !== "object") {
        return;
    }
    publish({ ...payload, seq: Number(payload.seq) || 0 });
    if (payload.toast) {
        showToggleNotice(getCurrentLanguage(), "Offline Hotspot", payload.toast);
    }
}

export function useHotspot(): HotspotStatus {
    return useSyncExternalStore(subscribe, () => status);
}

export function hotspotIsOn(value: HotspotStatus = status): boolean {
    return value.state === "host" || value.state === "guest" || value.state === "starting" || value.state === "joining";
}

export function useHotspotOn(): boolean {
    return useSyncExternalStore(subscribe, () => hotspotIsOn(status));
}

export function hotspotWithoutInternet(value: HotspotStatus = status): boolean {
    return (value.state === "host" || value.state === "guest") && !value.internet;
}

function setHotspotPrivateNext(value: boolean) {
    privateNext = value;
    for (const listener of listeners) {
        listener();
    }
}

export function useHotspotPrivateNext(): boolean {
    return useSyncExternalStore(subscribe, () => privateNext);
}

export async function switchPrivateHotspot(on: boolean) {
    const language = getCurrentLanguage();
    if (status.role !== "host" || (status.state !== "host" && status.state !== "starting")) {
        setHotspotPrivateNext(on);
        return;
    }
    const role = multiplayerRoomMarker().role;
    if (role !== null) {
        showToggleNotice(language, "Offline Hotspot", REASONS[role === "host" ? "hosting" : "seated"]);
        return;
    }
    setHotspotPrivateNext(on);
    try {
        const result = await hotspotSetPrivate(on);
        if (!result.ok) {
            setHotspotPrivateNext(!on);
            showToggleNotice(language, "Offline Hotspot", refusal(result));
        }
    }
    catch (e) {
        logError("offline hotspot: switching Private Hotspot", e);
        setHotspotPrivateNext(!on);
    }
}

export function setHotspotSettings(next: { hotspotIntroOff?: boolean; hotspotDedicated?: boolean }) {
    introOff = next.hotspotIntroOff ?? introOff;
    dedicated = next.hotspotDedicated ?? dedicated;
    for (const listener of listeners) {
        listener();
    }
}

export function useHotspotDedicated(): boolean {
    return useSyncExternalStore(subscribe, () => dedicated);
}

export async function switchDedicatedHotspot(on: boolean) {
    const role = multiplayerRoomMarker().role;
    if (role !== null) {
        showToggleNotice(getCurrentLanguage(), "Offline Hotspot", REASONS[role === "host" ? "hosting" : "seated"]);
        return;
    }
    dedicated = on;
    for (const listener of listeners) {
        listener();
    }
    try {
        await saveHotspotDedicated(on);
    }
    catch (e) {
        logError("offline hotspot: saving Dedicated Hotspot", e);
        dedicated = !on;
        for (const listener of listeners) {
            listener();
        }
    }
}

export function setHotspotIntroOpener(opener: typeof openIntro) {
    openIntro = opener;
}

function refusal(result: HotspotStatus): string {
    return REASONS[result.error ?? ""] ?? "Unavailable";
}

async function apply(on: boolean) {
    const language = getCurrentLanguage();
    busy = true;
    try {
        const result = await hotspotSet(on, privateNext);
        publish({ ...result, seq: Number(result.seq) || 0 });
        if (result.ok) {
            showToggleToast(language, "Offline Hotspot", hotspotIsOn(result));
        }
        else {
            showToggleNotice(language, "Offline Hotspot", refusal(result));
        }
    }
    catch (e) {
        logError("offline hotspot: switching", e);
        showToggleNotice(language, "Offline Hotspot", "Unavailable");
    }
    finally {
        busy = false;
    }
}

export async function toggleHotspot() {
    await switchHotspot(!hotspotIsOn());
}

export async function switchHotspot(on: boolean) {
    if (busy) {
        return;
    }
    if (!on || introOff || openIntro === null || multiplayerRoomMarker().role !== null) {
        await apply(on);
        return;
    }
    openIntro((hide) => {
        if (hide) {
            introOff = true;
            void saveHotspotIntroOff(true).catch((e) => logError("offline hotspot: saving the intro choice", e));
        }
        void apply(true);
    });
}

export async function joinHotspot(ssid: string, code: string) {
    const language = getCurrentLanguage();
    try {
        const result = await hotspotJoin(ssid, code);
        publish({ ...result, seq: Number(result.seq) || 0 });
        if (result.ok) {
            showToggleNotice(language, "Offline Hotspot", "Connected to {{network}}", 0, { network: ssid });
        }
        else {
            showToggleNotice(language, "Offline Hotspot", result.error === "code" ? "Couldn't join. Check the password." : refusal(result));
        }
    }
    catch (e) {
        logError("offline hotspot: joining", e);
        showToggleNotice(language, "Offline Hotspot", "Unavailable");
    }
}

export async function leaveHotspot() {
    const language = getCurrentLanguage();
    try {
        const result = await hotspotLeave();
        publish({ ...result, seq: Number(result.seq) || 0 });
        if (!result.ok) {
            showToggleNotice(language, "Offline Hotspot", refusal(result));
        }
    }
    catch (e) {
        logError("offline hotspot: leaving", e);
    }
}

export function registerHotspotState() {
    addEventListener(HOTSPOT_EVENT, onEvent);
    void (async () => {
        try {
            const first = await hotspotStatus();
            publish({ ...first, seq: Number(first.seq) || 0 });
        }
        catch (e) {
            logError("offline hotspot: reading the state at load", e);
        }
    })();
}

export function unregisterHotspotState() {
    removeEventListener(HOTSPOT_EVENT, onEvent);
    status = OFF;
}
