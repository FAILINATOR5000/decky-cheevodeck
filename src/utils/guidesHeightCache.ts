import type { GuidePage } from "./guidesBlocks";
import type { GuideSurface } from "./scale";

export type GuideHeightKey = {
    surface: GuideSurface;
    fingerprint: string;
    fontPx: number;
};

export type GuideHeights = {
    widthPx: number;
    heights: number[];
};

type Slot = GuideHeightKey & GuideHeights;

const slots = new Map<GuideSurface, Slot>();

export function fingerprintGuide(pages: GuidePage[]): string {
    let hash = 0x811c9dc5;
    let chars = 0;
    for (const page of pages) {
        const text = page.text;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        hash ^= 0x0a;
        hash = Math.imul(hash, 0x01000193);
        chars += text.length;
    }
    const lines = pages.length > 0 ? pages[pages.length - 1].endLine : 0;
    return `${(hash >>> 0).toString(36)}:${pages.length}:${lines}:${chars}`;
}

export function sameGuideWidth(a: number, b: number): boolean {
    return Math.abs(a - b) < 0.5;
}

function matches(slot: Slot, key: GuideHeightKey): boolean {
    return slot.fingerprint === key.fingerprint && slot.fontPx === key.fontPx;
}

export function readGuideHeights(key: GuideHeightKey): GuideHeights | null {
    const slot = slots.get(key.surface);
    if (!slot || !matches(slot, key)) {
        return null;
    }
    return slot;
}

export function noteGuideHeights(key: GuideHeightKey, widthPx: number, from: number, spans: number[]): void {
    if (spans.length === 0) {
        return;
    }
    const slot = slots.get(key.surface);
    if (!slot || !matches(slot, key) || !sameGuideWidth(slot.widthPx, widthPx)) {
        if (from === 0) {
            slots.set(key.surface, { ...key, widthPx, heights: spans.slice() });
        }
        return;
    }
    if (from > slot.heights.length) {
        return;
    }
    for (let i = 0; i < spans.length; i += 1) {
        slot.heights[from + i] = spans[i];
    }
}

export function dropGuideHeights(surface: GuideSurface): void {
    slots.delete(surface);
}
