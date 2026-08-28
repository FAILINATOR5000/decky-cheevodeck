const CONSOLE_RELEASE_YEARS: Record<string, number> = {
    "NES/Famicom": 1983,
    "Famicom Disk System": 1986,
    "SNES/Super Famicom": 1990,
    "Nintendo 64": 1996,
    "GameCube": 2001,
    "Wii": 2006,
    "Game Boy": 1989,
    "Game Boy Color": 1998,
    "Game Boy Advance": 2001,
    "Nintendo DS": 2004,
    "Nintendo DSi": 2008,
    "Virtual Boy": 1995,
    "Pokemon Mini": 2001,
    "Game & Watch": 1980,

    "SG-1000": 1983,
    "Master System": 1985,
    "Game Gear": 1990,
    "Genesis/Mega Drive": 1988,
    "Sega CD": 1991,
    "32X": 1994,
    "Saturn": 1994,
    "Dreamcast": 1998,

    "PlayStation": 1994,
    "PlayStation 2": 2000,
    "PlayStation Portable": 2004,

    "PC Engine/TurboGrafx-16": 1987,
    "PC Engine CD/TurboGrafx-CD": 1988,
    "PC-8000/8800": 1981,
    "PC-FX": 1994,

    "Atari 2600": 1977,
    "Atari 7800": 1986,
    "Atari Lynx": 1989,
    "Atari Jaguar": 1993,
    "Atari Jaguar CD": 1995,
    "Atari ST": 1985,

    "Neo Geo CD": 1994,
    "Neo Geo Pocket": 1998,

    "3DO Interactive Multiplayer": 1993,
    "Amstrad CPC": 1984,
    "Apple II": 1977,
    "Arcade": 9999,
    "Arcadia 2001": 1982,
    "Arduboy": 2015,
    "ColecoVision": 1982,
    "Commodore 64": 1982,
    "Elektor TV Games Computer": 1979,
    "Fairchild Channel F": 1976,
    "Intellivision": 1979,
    "Interton VC 4000": 1978,
    "Magnavox Odyssey 2": 1978,
    "Mega Duck": 1993,
    "MSX": 1983,
    "Sharp X68000": 1987,
    "Uzebox": 2008,
    "Vectrex": 1982,
    "Watara Supervision": 1992,
    "WASM-4": 2021,
    "WonderSwan": 1999,
    "ZX Spectrum": 1982,
};

const CONSOLE_DISPLAY_NAMES: Record<string, string> = {
    "NES/Famicom": "NES",
    "SNES/Super Famicom": "SNES",
    "Genesis/Mega Drive": "Genesis",
    "PC Engine/TurboGrafx-16": "TurboGrafx-16",
    "PC Engine CD/TurboGrafx-CD": "TurboGrafx-CD",

    "3DO Interactive Multiplayer": "3DO",
    "Elektor TV Games Computer": "Elektor TVGC",
    "Fairchild Channel F": "Channel F",
    "Famicom Disk System": "Famicom Disk",
    "Magnavox Odyssey 2": "Odyssey 2",
    "PlayStation Portable": "PSP",
    "Watara Supervision": "Supervision",
};

const CONSOLE_INLINE_NAMES: Record<string, string> = {
    "PC Engine/TurboGrafx-16": "TurboGrafx-16",
    "PC Engine CD/TurboGrafx-CD": "TurboGrafx-CD",
};

export const GAMEFAQS_PLATFORM_SLUGS: Record<string, string> = {
    "NES/Famicom": "nes",
    "SNES/Super Famicom": "snes",
    "Nintendo 64": "n64",
    "GameCube": "gamecube",
    "Wii": "wii",
    "Game Boy": "gameboy",
    "Game Boy Color": "gbc",
    "Game Boy Advance": "gba",
    "Nintendo DS": "ds",
    "Virtual Boy": "virtualboy",

    "Master System": "sms",
    "Game Gear": "gamegear",
    "Genesis/Mega Drive": "genesis",
    "Sega CD": "segacd",
    "32X": "sega32x",
    "Saturn": "saturn",
    "Dreamcast": "dreamcast",

    "PlayStation": "ps",
    "PlayStation 2": "ps2",
    "PlayStation Portable": "psp",

    "PC Engine/TurboGrafx-16": "turbografx16",
    "PC Engine CD/TurboGrafx-CD": "turbografxcd",
    "PC-FX": "pcfx",

    "Atari 2600": "atari2600",
    "Atari 7800": "atari7800",
    "Atari Lynx": "lynx",
    "Atari Jaguar": "jaguar",

    "Neo Geo Pocket": "ngpc",

    "3DO Interactive Multiplayer": "3do",
    "ColecoVision": "colecovision",
    "Commodore 64": "c64",
    "Intellivision": "intellivision",
    "MSX": "msx",
    "WonderSwan": "wonderswan",
};

const CONSOLE_MAKERS: Record<string, string> = {
    "NES/Famicom": "Nintendo",
    "Famicom Disk System": "Nintendo",
    "SNES/Super Famicom": "Nintendo",
    "Nintendo 64": "Nintendo",
    "GameCube": "Nintendo",
    "Wii": "Nintendo",
    "Game Boy": "Nintendo",
    "Game Boy Color": "Nintendo",
    "Game Boy Advance": "Nintendo",
    "Nintendo DS": "Nintendo",
    "Nintendo DSi": "Nintendo",
    "Virtual Boy": "Nintendo",
    "Pokemon Mini": "Nintendo",
    "Game & Watch": "Nintendo",

    "SG-1000": "Sega",
    "Master System": "Sega",
    "Game Gear": "Sega",
    "Genesis/Mega Drive": "Sega",
    "Sega CD": "Sega",
    "32X": "Sega",
    "Saturn": "Sega",
    "Dreamcast": "Sega",

    "PlayStation": "Sony",
    "PlayStation 2": "Sony",
    "PlayStation Portable": "Sony",

    "PC Engine/TurboGrafx-16": "NEC",
    "PC Engine CD/TurboGrafx-CD": "NEC",
    "PC-8000/8800": "NEC",
    "PC-FX": "NEC",

    "Atari 2600": "Atari",
    "Atari 7800": "Atari",
    "Atari Lynx": "Atari",
    "Atari Jaguar": "Atari",
    "Atari Jaguar CD": "Atari",
    "Atari ST": "Atari",

    "Neo Geo CD": "SNK",
    "Neo Geo Pocket": "SNK",

    "3DO Interactive Multiplayer": "Panasonic",
    "Amstrad CPC": "Amstrad",
    "Apple II": "Apple",
    "Arcadia 2001": "Emerson",
    "Arduboy": "Arduboy",
    "ColecoVision": "Coleco",
    "Commodore 64": "Commodore",
    "Elektor TV Games Computer": "Elektor",
    "Fairchild Channel F": "Fairchild",
    "Intellivision": "Mattel",
    "Interton VC 4000": "Interton",
    "Magnavox Odyssey 2": "Magnavox",
    "Mega Duck": "Welback",
    "Sharp X68000": "Sharp",
    "Vectrex": "GCE",
    "Watara Supervision": "Watara",
    "WonderSwan": "Bandai",
    "ZX Spectrum": "Sinclair",
};

const CONSOLE_FACTS: Record<string, string> = {
    "NES/Famicom": "Nintendo's 8-bit console that revived gaming after the '83 crash.",
    "Famicom Disk System": "A disk add-on for Japan's Famicom, with rewritable games.",
    "SNES/Super Famicom": "Nintendo's 16-bit successor to the NES.",
    "Nintendo 64": "Nintendo's 64-bit console and an early leap into 3D.",
    "GameCube": "Nintendo's compact disc-based console of the early 2000s.",
    "Wii": "Nintendo's motion-controlled console that drew in everyone.",
    "Game Boy": "Nintendo's handheld that made portable gaming mainstream.",
    "Game Boy Color": "A color screen version of Nintendo's Game Boy.",
    "Game Boy Advance": "Nintendo's 32-bit handheld, the Game Boy's big upgrade.",
    "Nintendo DS": "Nintendo's dual-screen handheld with a touch display.",
    "Nintendo DSi": "A slimmer DS with cameras and a download store.",
    "Virtual Boy": "Nintendo's short-lived stab at stereoscopic 3D.",
    "Pokemon Mini": "Nintendo's tiny handheld built around Pokémon games.",
    "Game & Watch": "Nintendo's pocket LCD games, one machine per title.",

    "SG-1000": "Sega's first home console, launched alongside the Famicom.",
    "Master System": "Sega's 8-bit console and rival to the NES.",
    "Game Gear": "Sega's color handheld answer to the Game Boy.",
    "Genesis/Mega Drive": "Sega's 16-bit rival to the Super Nintendo.",
    "Sega CD": "A CD add-on that gave the Genesis CD audio and bigger games.",
    "32X": "A bolt-on that pushed the Genesis toward 32-bit power.",
    "Saturn": "Sega's 32-bit console, strong in 2D, tricky in 3D.",
    "Dreamcast": "Sega's final console, online-ready ahead of its time.",

    "PlayStation": "Sony's CD-based console that ushered in 3D gaming.",
    "PlayStation 2": "Sony's best-selling console, and a DVD player too.",
    "PlayStation Portable": "Sony's handheld with near-console-quality games.",

    "PC Engine/TurboGrafx-16": "NEC's compact console, a sensation in late-'80s Japan.",
    "PC Engine CD/TurboGrafx-CD": "A CD add-on that expanded the PC Engine's library.",
    "PC-8000/8800": "NEC's Japanese home computers with a deep game library.",
    "PC-FX": "NEC's 32-bit console, built around full-motion video.",

    "Atari 2600": "The cartridge console that defined 1970s home gaming.",
    "Atari 7800": "Atari's 8-bit console, back-compatible with the 2600.",
    "Atari Lynx": "Atari's color handheld, ahead of its time and power-hungry.",
    "Atari Jaguar": "Atari's 64-bit console and its last home machine.",
    "Atari Jaguar CD": "A CD add-on for the Jaguar, with barely a dozen games.",
    "Atari ST": "Atari's home computer, a favorite for music and games.",

    "Neo Geo CD": "A CD version of SNK's arcade-grade Neo Geo.",
    "Neo Geo Pocket": "SNK's handheld, strong on fighting games.",

    "3DO Interactive Multiplayer": "A licensed CD console standard from the early '90s.",
    "Amstrad CPC": "An all-in-one 1980s micro sold complete with its own monitor.",
    "Apple II": "One of the first mass-market personal computers.",
    "Arcade": "Coin-op arcade machines, the roots of video gaming.",
    "Arcadia 2001": "An early cartridge console sold worldwide under many names.",
    "Arduboy": "A credit-card-sized open handheld for tiny games.",
    "ColecoVision": "Coleco's 8-bit console known for its arcade ports.",
    "Commodore 64": "The best-selling home computer of the 1980s.",
    "Elektor TV Games Computer": "A 1970s console built from a magazine's own design.",
    "Fairchild Channel F": "The first console to use swappable cartridges.",
    "Intellivision": "Mattel's console, an early rival to the Atari 2600.",
    "Interton VC 4000": "A West German console from the first cartridge era.",
    "Magnavox Odyssey 2": "An early cartridge console with a built-in keyboard.",
    "Mega Duck": "A Hong Kong Game Boy rival sold in Europe and Brazil.",
    "MSX": "A 1980s home-computer standard, huge in Japan.",
    "Sharp X68000": "A powerful Japanese computer prized for arcade ports.",
    "Uzebox": "An open-source homebrew console built on a single chip.",
    "Vectrex": "A console with its own built-in vector-graphics screen.",
    "Watara Supervision": "A budget handheld with a bigger screen than the Game Boy.",
    "WASM-4": "A modern fantasy console for tiny WebAssembly games.",
    "WonderSwan": "Bandai's handheld, designed by the Game Boy's creator.",
    "ZX Spectrum": "Sinclair's affordable British home computer, a 1980s icon.",
};

function normalizeConsoleName(name: string): string {
    return String(name || "").trim().toLowerCase();
}

function buildLookup<T>(table: Record<string, T>): Map<string, T> {
    const lookup = new Map<string, T>();
    for (const key of Object.keys(table)) {
        lookup.set(normalizeConsoleName(key), table[key]);
    }
    return lookup;
}

const yearLookup = buildLookup(CONSOLE_RELEASE_YEARS);
const displayNameLookup = buildLookup(CONSOLE_DISPLAY_NAMES);
const inlineNameLookup = buildLookup(CONSOLE_INLINE_NAMES);
const makerLookup = buildLookup(CONSOLE_MAKERS);
const factLookup = buildLookup(CONSOLE_FACTS);

export function consoleDisplayName(consoleName: string): string {
    const raw = String(consoleName || "").trim();
    const override = displayNameLookup.get(normalizeConsoleName(raw));
    if (override) {
        return override;
    }
    return raw || "Other";
}

export function consoleInlineName(consoleName: string): string {
    const raw = String(consoleName || "").trim();
    return inlineNameLookup.get(normalizeConsoleName(raw)) ?? raw;
}

export function consoleReleaseYear(consoleName: string): number | null {
    const year = yearLookup.get(normalizeConsoleName(consoleName));
    return year === undefined ? null : year;
}

export function consoleMaker(consoleName: string): string {
    return makerLookup.get(normalizeConsoleName(consoleName)) ?? "";
}

export function consoleSearchName(consoleName: string): string {
    const raw = String(consoleName || "").trim();
    if (!raw) {
        return "";
    }
    const name = consoleDisplayName(raw);
    const maker = consoleMaker(raw);
    if (!maker || name.toLowerCase().includes(maker.toLowerCase())) {
        return name;
    }
    return `${maker} ${name}`;
}

export function consoleFact(consoleName: string): string {
    return factLookup.get(normalizeConsoleName(consoleName)) ?? "";
}

export function compareConsolesByName(a: string, b: string): number {
    return consoleDisplayName(a).localeCompare(consoleDisplayName(b));
}

export function compareConsolesByYear(a: string, b: string): number {
    const yearA = consoleReleaseYear(a);
    const yearB = consoleReleaseYear(b);
    if (yearA !== yearB) {
        if (yearA === null) {
            return 1;
        }
        if (yearB === null) {
            return -1;
        }
        return yearA - yearB;
    }
    return compareConsolesByName(a, b);
}
