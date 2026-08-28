const FOLD_MAP: Record<string, string> = {
    "ø": "o", "Ø": "O",
    "đ": "d", "Đ": "D",
    "ð": "d", "Ð": "D",
    "þ": "th", "Þ": "Th",
    "ł": "l", "Ł": "L",
    "æ": "ae", "Æ": "AE",
    "œ": "oe", "Œ": "OE",
    "ß": "ss", "ẞ": "SS",
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": "\"", "”": "\"", "„": "\"",
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
};

const FOLDABLE = new RegExp("[" + Object.keys(FOLD_MAP).join("") + "]", "g");

export function foldText(text: string | null | undefined): string {
    const decomposed = String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return decomposed.replace(FOLDABLE, (ch) => FOLD_MAP[ch] ?? ch);
}

export function searchKey(text: string | null | undefined): string {
    return foldText(text).toLowerCase();
}
