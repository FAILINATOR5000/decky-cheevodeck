export type FoundLink = {
    url: string;
    label: string;
};

const TLDS = [
    "com", "net", "org", "io", "gg", "co", "tv", "me", "dev", "app", "info", "biz",
    "uk", "ca", "de", "fr", "jp", "us", "au", "nl", "se", "es", "it", "br", "ru", "pl", "pt", "eu",
    "online", "site", "xyz", "wiki", "fandom", "moe", "sh", "ai"
];

const LINK_RE = new RegExp(
    "(?:https?://|www\\.)[^\\s<>\"]+"
    + "|(?<![@\\w./-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:" + TLDS.join("|") + ")(?:/[^\\s<>\"]*)?(?![\\w-])",
    "gi"
);

const SEPARATORS = "-–—:|>»";

const MAX_LABEL_CHARS = 60;

export const MAX_LINKS = 12;

function trimTrailingPunctuation(raw: string): string {
    let url = raw;
    while (url.length > 0) {
        const last = url.charAt(url.length - 1);
        if (".,;:!?".indexOf(last) >= 0) {
            url = url.slice(0, -1);
            continue;
        }
        if (last === ")" && countChar(url, "(") < countChar(url, ")")) {
            url = url.slice(0, -1);
            continue;
        }
        if (last === "]" && countChar(url, "[") < countChar(url, "]")) {
            url = url.slice(0, -1);
            continue;
        }
        break;
    }
    return url;
}

function countChar(text: string, ch: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text.charAt(i) === ch) {
            count += 1;
        }
    }
    return count;
}

function labelFor(text: string, start: number, previousEnd: number): string {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    let prefix = text.slice(Math.max(lineStart, previousEnd), start).trim();
    let introduced = false;
    while (prefix.length > 0 && SEPARATORS.indexOf(prefix.charAt(prefix.length - 1)) >= 0) {
        prefix = prefix.slice(0, -1).trim();
        introduced = true;
    }
    if (!introduced || !prefix || prefix.length > MAX_LABEL_CHARS) {
        return "";
    }
    return prefix;
}

export function findLinks(text: string | null | undefined): FoundLink[] {
    const source = String(text || "");
    if (!source) {
        return [];
    }

    const found: FoundLink[] = [];
    const seen = new Set<string>();
    let previousEnd = 0;

    LINK_RE.lastIndex = 0;
    let match = LINK_RE.exec(source);
    while (match !== null) {
        const raw = trimTrailingPunctuation(match[0]);
        if (raw.length > 4) {
            const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
            const key = url.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                found.push({ url, label: labelFor(source, match.index, previousEnd) });
            }
        }
        previousEnd = match.index + match[0].length;
        match = LINK_RE.exec(source);
    }

    return found;
}
