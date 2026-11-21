import { toaster } from "@decky/api";
import { steamModule } from "./steam/lookup";

const SOUND_HIDE_MODAL = 12;
const SOUND_TOGGLE_ON = 16;
const SOUND_TOGGLE_OFF = 17;
const SOUND_DEFAULT_OK = 21;
const SOUND_BASIC_NAV = 24;

const SOUND_SCREENSHOT = 28;

type NavSoundPlayer = { PlayNavSound: (sound: number) => void };

function player(): NavSoundPlayer | null {
    return steamModule<NavSoundPlayer>("nav sounds", (e) => typeof e?.PlayNavSound === "function");
}

export function playOkSound(): void {
    try {
        player()?.PlayNavSound(SOUND_DEFAULT_OK);
    }
    catch {
    }
}

export function playMoveSound(): void {
    try {
        player()?.PlayNavSound(SOUND_BASIC_NAV);
    }
    catch {
    }
}

export const PRESS_TOAST_DELAY_MS = 500;

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
