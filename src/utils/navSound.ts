import { toaster } from "@decky/api";
import { findModuleExport } from "@decky/ui";

const SOUND_HIDE_MODAL = 12;
const SOUND_TOGGLE_ON = 16;
const SOUND_TOGGLE_OFF = 17;
const SOUND_DEFAULT_OK = 21;

const SOUND_SCREENSHOT = 28;

type NavSoundPlayer = { PlayNavSound: (sound: number) => void };

let cached: NavSoundPlayer | null | undefined;

function player(): NavSoundPlayer | null {
    if (cached !== undefined) {
        return cached;
    }
    try {
        cached = findModuleExport((e: any) => typeof e?.PlayNavSound === "function") ?? null;
    }
    catch {
        cached = null;
    }
    return cached ?? null;
}

export function playOkSound(): void {
    try {
        player()?.PlayNavSound(SOUND_DEFAULT_OK);
    }
    catch {
    }
}

const PRESS_TOAST_DELAY_MS = 500;

export function toastAfterPress(toast: Parameters<typeof toaster.toast>[0]): void {
    window.setTimeout(() => {
        toaster.toast(toast);
    }, PRESS_TOAST_DELAY_MS);
}

export function playBackSound(): void {
    try {
        player()?.PlayNavSound(SOUND_HIDE_MODAL);
    }
    catch {
    }
}

export function playCaptureSound(): void {
    try {
        player()?.PlayNavSound(SOUND_SCREENSHOT);
    }
    catch {
    }
}

export function playToggleSound(on: boolean): void {
    try {
        player()?.PlayNavSound(on ? SOUND_TOGGLE_ON : SOUND_TOGGLE_OFF);
    }
    catch {
    }
}
