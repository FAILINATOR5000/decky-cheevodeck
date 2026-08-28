import { EN } from "./locales/en";

type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

type LocaleEntry = string | Partial<Record<PluralCategory, string>>;
export type LocaleTable = Record<string, LocaleEntry>;

function singularAtOne(n: number): PluralCategory {
    return n === 1 ? "one" : "other";
}

function singularAtZeroOrOne(n: number): PluralCategory {
    return n === 0 || n === 1 ? "one" : "other";
}

function russianCount(n: number): PluralCategory {
    if (!Number.isInteger(n)) {
        return "other";
    }
    const lastTwo = Math.abs(n) % 100;
    const last = lastTwo % 10;
    if (lastTwo >= 11 && lastTwo <= 14) {
        return "many";
    }
    if (last === 1) {
        return "one";
    }
    if (last >= 2 && last <= 4) {
        return "few";
    }
    return "many";
}

function polishCount(n: number): PluralCategory {
    if (!Number.isInteger(n)) {
        return "other";
    }
    if (n === 1) {
        return "one";
    }
    const lastTwo = Math.abs(n) % 100;
    const last = lastTwo % 10;
    if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
        return "few";
    }
    return "many";
}

function neverInflects(): PluralCategory {
    return "other";
}

const pluralRules: Record<string, (n: number) => PluralCategory> = {
    en: singularAtOne,
    es: singularAtOne,
    de: singularAtOne,
    fr: singularAtZeroOrOne,
    pt: singularAtZeroOrOne,
    ru: russianCount,
    ja: neverInflects,
    pl: polishCount,
};

type LanguageDef = {
    label: string;
    load?: () => Promise<{ default: LocaleTable }>;
};

export const LANGUAGES = {
    en: { label: "English" },
    es: { label: "Español", load: () => import("./locales/es") },
    de: { label: "Deutsch", load: () => import("./locales/de") },
    pt: { label: "Português", load: () => import("./locales/pt") },
    fr: { label: "Français", load: () => import("./locales/fr") },
    ru: { label: "Русский", load: () => import("./locales/ru") },
    ja: { label: "日本語", load: () => import("./locales/ja") },
    pl: { label: "Polski", load: () => import("./locales/pl") },
} satisfies Record<string, LanguageDef>;

export type LanguageCode = keyof typeof LANGUAGES;
export const DEFAULT_LANGUAGE: LanguageCode = "en";

const loadedTables: Partial<Record<string, LocaleTable>> = { en: EN };

const inFlight: Partial<Record<string, Promise<void>>> = {};

export function ensureLanguageLoaded(code: string): Promise<void> {
    if (code === "en" || loadedTables[code]) {
        return Promise.resolve();
    }
    const existing = inFlight[code];
    if (existing) {
        return existing;
    }
    const def = (LANGUAGES as Record<string, LanguageDef>)[code];
    if (!def || !def.load) {
        return Promise.resolve();
    }
    const loading = def.load()
        .then((mod) => {
            loadedTables[code] = mod.default;
        })
        .catch(() => {
        })
        .finally(() => {
            delete inFlight[code];
        });
    inFlight[code] = loading;
    return loading;
}

let currentLanguage: LanguageCode = DEFAULT_LANGUAGE;

export function setCurrentLanguage(code: LanguageCode): void {
    currentLanguage = code;
    ensureLanguageLoaded(code);
}

export function getCurrentLanguage(): LanguageCode {
    return currentLanguage;
}

function pickEntry(
    code: string,
    entry: LocaleEntry | undefined,
    vars?: Record<string, string | number>
): string | null {
    if (entry === undefined) {
        return null;
    }
    if (typeof entry === "string") {
        return entry;
    }
    const rule = pluralRules[code] ?? singularAtOne;
    const count = Number(vars?.count ?? 0);
    const bucket = rule(count);
    return entry[bucket] ?? entry.other ?? null;
}

function substitute(text: string, vars?: Record<string, string | number>): string {
    if (!vars) {
        return text;
    }
    let out = text;
    for (const [key, value] of Object.entries(vars)) {
        out = out.split(`{{${key}}}`).join(String(value));
    }
    return out;
}

function translateString(
    language: LanguageCode | string | null | undefined,
    text: string,
    vars?: Record<string, string | number>
): string {
    const code = typeof language === "string" ? language : DEFAULT_LANGUAGE;
    const table = loadedTables[code] ?? EN;

    let result = pickEntry(code, table[text], vars);
    if (result === null) {
        result = pickEntry("en", EN[text], vars);
    }
    if (result === null) {
        result = text;
    }

    return substitute(result, vars);
}

export function t(language: LanguageCode, text: string, vars?: Record<string, string | number>) {
    return translateString(language, text, vars);
}

export function localizeRuntimeText(language: LanguageCode, text?: string | null) {
    if (!text) {
        return text ?? null;
    }
    return translateString(language, text);
}
