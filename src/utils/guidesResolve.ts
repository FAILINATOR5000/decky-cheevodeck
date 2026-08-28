import { GAMEFAQS_PLATFORM_SLUGS } from "./consoles";
import type { GuideSearchResult } from "./guidesFetch";
import { foldText } from "./searchText";

const _TRAILING_PARENS = /\s*\([^)]*\)\s*$/;
const _TILDE_MARKERS = /~[^~]*~/g;
const _BRACKET_MARKERS = /\s*\[[^\]]*\]\s*/g;

export function normalizeRaTitle(title: string | null | undefined): string {
    let text = String(title || "");
    text = text.replace(_TILDE_MARKERS, " ");
    text = text.replace(_BRACKET_MARKERS, " ");
    let previous = "";
    while (previous !== text) {
        previous = text;
        text = text.replace(_TRAILING_PARENS, "");
    }
    return text.replace(/\s+/g, " ").trim();
}

export function guideBelongsToMapping(
    guide: { gameUrl?: string },
    mappedUrl: string | null | undefined
): boolean {
    const stamped = guide.gameUrl || "";
    if (!stamped) {
        return true;
    }
    return stamped === (mappedUrl || "");
}

function platformSlugForConsole(consoleName: string | null | undefined): string | null {
    if (!consoleName) return null;
    return GAMEFAQS_PLATFORM_SLUGS[consoleName] ?? null;
}

function titleKey(text: string): string {
    return foldText(normalizeRaTitle(text))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

export interface ResolutionOutcome {
    match: GuideSearchResult | null;
    candidates: GuideSearchResult[];
    ambiguous: boolean;
    guidelessOnly: boolean;
}

export function resolveCandidates(
    results: GuideSearchResult[],
    consoleName: string | null | undefined,
    rawTitle: string | null | undefined
): ResolutionOutcome {
    const slug = platformSlugForConsole(consoleName);
    const wantKey = titleKey(String(rawTitle || ""));

    const guideBearing = results.filter((r) => r.hasGuides);

    let pool = guideBearing;
    if (slug) {
        const onPlatform = guideBearing.filter((r) => r.platformSlug === slug);
        if (onPlatform.length > 0) {
            pool = onPlatform;
        }
    }

    const scored = pool
        .map((r) => ({ r, score: scoreCandidate(r, wantKey) }))
        .sort((a, b) => b.score - a.score);
    const candidates = scored.map((s) => s.r);

    if (candidates.length === 0) {
        const bestGuideless = results.reduce((best, r) => Math.max(best, scoreCandidate(r, wantKey)), 0);
        return { match: null, candidates: [], ambiguous: false, guidelessOnly: bestGuideless >= 40 };
    }

    const best = scored[0];
    const runnerUp = scored[1];
    const exactAndAlone = best.score >= EXACT_TITLE_SCORE && (!runnerUp || runnerUp.score < EXACT_TITLE_SCORE);
    const onlyOne = candidates.length === 1;

    if (onlyOne || exactAndAlone) {
        return { match: best.r, candidates, ambiguous: false, guidelessOnly: false };
    }
    return { match: null, candidates, ambiguous: true, guidelessOnly: false };
}

const EXACT_TITLE_SCORE = 100;

function scoreCandidate(result: GuideSearchResult, wantKey: string): number {
    if (!wantKey) return 0;
    const names = [result.productName, result.gameName, ...result.gameName.split("/")];
    let best = 0;
    for (const name of names) {
        const haveKey = titleKey(name);
        if (!haveKey) continue;
        best = Math.max(best, scoreTitlePair(haveKey, wantKey));
        if (best >= EXACT_TITLE_SCORE) break;
    }
    return best;
}

function scoreTitlePair(haveKey: string, wantKey: string): number {
    if (haveKey === wantKey) return EXACT_TITLE_SCORE;
    if (haveKey.startsWith(wantKey) || wantKey.startsWith(haveKey)) return 60;
    if (haveKey.includes(wantKey) || wantKey.includes(haveKey)) return 40;
    const wantWords = new Set(wantKey.split(" "));
    const shared = haveKey.split(" ").filter((w) => wantWords.has(w)).length;
    return shared;
}
