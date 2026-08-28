import { findModuleExport } from "@decky/ui";

const SOUND_TOGGLE_ON = 16;
const SOUND_TOGGLE_OFF = 17;
const SOUND_DEFAULT_OK = 21;

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

export function playToggleSound(on: boolean): void {
    try {
        player()?.PlayNavSound(on ? SOUND_TOGGLE_ON : SOUND_TOGGLE_OFF);
    }
    catch {
    }
}
