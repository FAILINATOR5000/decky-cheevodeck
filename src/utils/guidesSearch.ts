import { foldText } from "./searchText";

export const SEARCH_MIN_TERM = 2;

export const SEARCH_MATCH_LIMIT = 500;

export type GuideMatch = {
    line: number;
    into: number;
    anchor: number;
    occurrence: number;
};

export type TextHit = { start: number; end: number };

function foldWithMap(text: string): { folded: string; source: number[] } {
    let folded = "";
    const source: number[] = [];
    let at = 0;
    for (const ch of text) {
        const piece = ch.charCodeAt(0) < 0x80 ? ch.toLowerCase() : foldText(ch).toLowerCase();
        for (let i = 0; i < piece.length; i += 1) {
            source.push(at);
        }
        folded += piece;
        at += ch.length;
    }
    source.push(text.length);
    return { folded, source };
}

export function findFolded(text: string, term: string): TextHit[] {
    const needle = foldText(term).toLowerCase();
    if (needle.length === 0 || text.length === 0) {
        return [];
    }
    const { folded, source } = foldWithMap(text);
    const hits: TextHit[] = [];
    let at = folded.indexOf(needle);
    while (at >= 0) {
        hits.push({ start: source[at], end: source[at + needle.length] });
        at = folded.indexOf(needle, at + needle.length);
    }
    return hits;
}

function countNewlines(text: string, from: number, to: number): number {
    let lines = 0;
    let at = text.indexOf("\n", from);
    while (at >= 0 && at < to) {
        lines += 1;
        at = text.indexOf("\n", at + 1);
    }
    return lines;
}

export function scanGuideHtml(html: string, term: string): GuideMatch[] {
    if (term.trim().length < SEARCH_MIN_TERM || html.length === 0) {
        return [];
    }
    let blocks: Element[] = [];
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        blocks = Array.from(doc.querySelectorAll("[data-guide-line]"));
    }
    catch {
        return [];
    }

    const matches: GuideMatch[] = [];
    for (const block of blocks) {
        const text = block.textContent ?? "";
        const hits = findFolded(text, term);
        if (hits.length === 0) {
            continue;
        }
        const anchor = Number(block.getAttribute("data-guide-line"));
        const span = Number(block.getAttribute("data-guide-lines"));
        if (!Number.isFinite(anchor) || !Number.isFinite(span)) {
            continue;
        }
        let walked = 0;
        let line = anchor;
        hits.forEach((hit, occurrence) => {
            if (matches.length >= SEARCH_MATCH_LIMIT) {
                return;
            }
            if (span > 1) {
                line += countNewlines(text, walked, hit.start);
                walked = hit.start;
                matches.push({ line, into: 0, anchor, occurrence });
                return;
            }
            matches.push({
                line: anchor,
                into: text.length > 0 ? hit.start / text.length : 0,
                anchor,
                occurrence,
            });
        });
        if (matches.length >= SEARCH_MATCH_LIMIT) {
            return matches;
        }
    }
    return matches;
}
