import type { GuideTocEntry } from "./guidesFetch";

export function urlSections(toc: GuideTocEntry[] | undefined): GuideTocEntry[] {
    if (!Array.isArray(toc)) return [];
    const seen = new Set<string>();
    const sections: GuideTocEntry[] = [];
    for (const entry of toc) {
        if (!entry || !entry.slug || entry.slug.charAt(0) === "#") continue;
        const document = entry.slug.split("#")[0];
        if (!document || seen.has(document)) continue;
        seen.add(document);
        sections.push(entry);
    }
    return sections;
}
