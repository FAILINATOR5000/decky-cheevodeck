import type { ControllerGlyphStyle } from "../types";
import { logError } from "./errors";

export type GlyphButton =
    | "a" | "b" | "x" | "y" | "l1" | "r1" | "l2" | "r2" | "dpad"
    | "menu" | "view" | "l3" | "r3" | "l4" | "l5" | "r4" | "r5";

const GLYPH_BASE = "/steaminputglyphs";

const FILES: Record<Exclude<ControllerGlyphStyle, "auto">, Record<GlyphButton, string>> = {
    deck: {
        a: "shared_button_a", b: "shared_button_b", x: "shared_button_x", y: "shared_button_y",
        l1: "sd_l1", r1: "sd_r1", l2: "sd_l2", r2: "sd_r2", dpad: "shared_dpad",
        menu: "sd_button_menu", view: "sd_button_view", l3: "shared_l3", r3: "shared_r3",
        l4: "sd_l4", l5: "sd_l5", r4: "sd_r4", r5: "sd_r5"
    },
    steamcontroller: {
        a: "shared_button_a", b: "shared_button_b", x: "shared_button_x", y: "shared_button_y",
        l1: "sc_l1", r1: "sc_r1", l2: "sc_l2", r2: "sc_r2", dpad: "shared_dpad",
        menu: "sd_button_menu", view: "sd_button_view", l3: "shared_l3", r3: "shared_r3",
        l4: "sc_l4", l5: "sc_l5", r4: "sc_r4", r5: "sc_r5"
    },
    xbox: {
        a: "shared_button_a", b: "shared_button_b", x: "shared_button_x", y: "shared_button_y",
        l1: "xbox_lb", r1: "xbox_rb", l2: "xbox_lt", r2: "xbox_rt", dpad: "shared_dpad",
        menu: "xbox_button_start", view: "xbox_button_select", l3: "shared_l3", r3: "shared_r3",
        l4: "sd_l4", l5: "sd_l5", r4: "sd_r4", r5: "sd_r5"
    },
    nintendo: {
        a: "shared_button_a", b: "shared_button_b", x: "shared_button_x", y: "shared_button_y",
        l1: "switchpro_l", r1: "switchpro_r", l2: "switchpro_l2", r2: "switchpro_r2", dpad: "switchpro_dpad",
        menu: "switchpro_button_plus", view: "switchpro_button_minus",
        l3: "switchpro_lstick_click", r3: "switchpro_rstick_click",
        l4: "sd_l4", l5: "sd_l5", r4: "sd_r4", r5: "sd_r5"
    },
    playstation: {
        a: "ps_button_x", b: "ps_button_circle", x: "ps_button_square", y: "ps_button_triangle",
        l1: "ps5_l1", r1: "ps5_r1", l2: "ps5_l2", r2: "ps5_r2", dpad: "ps_dpad",
        menu: "ps5_button_options", view: "ps5_button_create", l3: "shared_l3", r3: "shared_r3",
        l4: "sd_l4", l5: "sd_l5", r4: "sd_r4", r5: "sd_r5"
    },
    universal: {
        a: "shared_buttons_s", b: "shared_buttons_e", x: "shared_buttons_w", y: "shared_buttons_n",
        l1: "sd_l1", r1: "sd_r1", l2: "sd_l2", r2: "sd_r2", dpad: "shared_dpad",
        menu: "sd_button_menu", view: "sd_button_view", l3: "shared_l3", r3: "shared_r3",
        l4: "sd_l4", l5: "sd_l5", r4: "sd_r4", r5: "sd_r5"
    }
};

const COLOR_FILES: Partial<Record<Exclude<ControllerGlyphStyle, "auto">, Partial<Record<GlyphButton, string>>>> = {
    xbox: { a: "shared_color_button_a", b: "shared_color_button_b", x: "shared_color_button_x", y: "shared_color_button_y" },
    playstation: { a: "ps_color_button_x", b: "ps_color_button_circle", x: "ps_color_button_square", y: "ps_color_button_triangle" }
};

let currentColoredGlyphs = true;

export function setCurrentColoredGlyphs(value: boolean): void {
    currentColoredGlyphs = value;
}

const SONY_VENDOR_ID = 0x054c;

const VALVE_VENDOR_ID = 0x28de;
const STEAM_CONTROLLER_PRODUCT_ID = 0x1302;

const NINTENDO_VENDOR_ID = 0x057e;

type SteamControllerRecord = {
    nControllerIndex?: number;
    unVendorID?: number;
    unProductID?: number;
    bNintendoLayout?: boolean;
    bUseReversedLayout?: boolean;
    bUseUniversalFaceButtonGlyphs?: boolean;
};

function activeController(): SteamControllerRecord | null {
    const store = (window as any)?.ControllerStore;
    const controllers: SteamControllerRecord[] = store?.GetControllers?.() ?? [];
    if (!controllers.length) {
        return null;
    }

    const preferred = controllers.find((c) => c.nControllerIndex === store?.MostRecentlyActiveControllerIndex);

    return preferred ?? controllers[controllers.length - 1];
}

function liveSwapFaces(): boolean | null {
    try {
        const active = activeController();
        if (!active) {
            return null;
        }

        return Boolean(active.bNintendoLayout) !== Boolean(active.bUseReversedLayout);
    }
    catch {
        return null;
    }
}

function detectStyle(): ResolvedGlyphStyle {
    const active = activeController();
    if (!active) {
        return { family: "universal", swapFaces: false };
    }

    const swapFaces = Boolean(active?.bNintendoLayout) !== Boolean(active?.bUseReversedLayout);

    if (active?.bUseUniversalFaceButtonGlyphs) {
        return { family: "universal", swapFaces: false };
    }
    if (active?.unVendorID === SONY_VENDOR_ID) {
        return { family: "playstation", swapFaces };
    }
    if (active?.unVendorID === VALVE_VENDOR_ID) {
        if (active?.unProductID === STEAM_CONTROLLER_PRODUCT_ID) {
            return { family: "steamcontroller", swapFaces };
        }

        return { family: "deck", swapFaces };
    }
    if (active?.unVendorID === NINTENDO_VENDOR_ID) {
        return { family: "nintendo", swapFaces };
    }

    return { family: "xbox", swapFaces };
}

export type ResolvedGlyphStyle = {
    family: Exclude<ControllerGlyphStyle, "auto">;
    swapFaces: boolean;
};

export function resolveGlyphStyle(style: ControllerGlyphStyle): ResolvedGlyphStyle {
    if (style !== "auto") {
        return { family: style, swapFaces: liveSwapFaces() ?? style === "nintendo" };
    }
    try {
        return detectStyle();
    }
    catch {
        return { family: "universal", swapFaces: false };
    }
}

export type GlyphAsset = {
    url: string;
    colored: boolean;
};

const SWAPPED: Partial<Record<GlyphButton, GlyphButton>> = { a: "b", b: "a", x: "y", y: "x" };

const glyphDataUris = new Map<string, string>();
const glyphFetches = new Set<string>();

function cachedGlyphUrl(url: string): string {
    return glyphDataUris.get(url) ?? url;
}

async function cacheGlyph(url: string): Promise<void> {
    if (glyphDataUris.has(url) || glyphFetches.has(url)) {
        return;
    }
    glyphFetches.add(url);
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return;
        }
        const svg = await response.text();
        if (!svg.includes("<svg")) {
            return;
        }
        glyphDataUris.set(url, `data:image/svg+xml,${encodeURIComponent(svg)}`);
    }
    catch {
    }
    finally {
        glyphFetches.delete(url);
    }
}

let glyphCacheWarmed = false;

export function warmGlyphCache(): void {
    if (glyphCacheWarmed) {
        return;
    }
    glyphCacheWarmed = true;
    for (const family of Object.values(FILES)) {
        for (const file of Object.values(family)) {
            void cacheGlyph(`${GLYPH_BASE}/${file}.svg`);
        }
    }
    for (const family of Object.values(COLOR_FILES)) {
        for (const file of Object.values(family ?? {})) {
            if (file) {
                void cacheGlyph(`${GLYPH_BASE}/${file}.svg`);
            }
        }
    }
}

export function glyphAsset(button: GlyphButton, style: ResolvedGlyphStyle): GlyphAsset {
    const drawn = style.swapFaces ? SWAPPED[button] ?? button : button;
    const color = currentColoredGlyphs ? COLOR_FILES[style.family]?.[drawn] : undefined;
    if (color) {
        return { url: cachedGlyphUrl(`${GLYPH_BASE}/${color}.svg`), colored: true };
    }

    return { url: cachedGlyphUrl(`${GLYPH_BASE}/${FILES[style.family][drawn]}.svg`), colored: false };
}

let glyphPathProbed = false;

export function probeGlyphPath(url: string): void {
    if (glyphPathProbed || url.startsWith("data:")) {
        return;
    }
    glyphPathProbed = true;
    try {
        const probe = new Image();
        probe.onerror = () => {
            logError(
                "glyph path",
                new Error(`Steam's controller glyphs did not resolve at ${url}. Button hints will render as blocks.`)
            );
        };
        probe.src = url;
    }
    catch (e) {
        logError("glyph path probe", e);
    }
}

