import { getCachedGuidePage, logGuidesDebug, saveCachedGuidePage } from "../api";
import type { GuideContent, GuidePageFetch } from "./guidesFetch";
import { GuidesBrowserSession } from "./guidesFetch";
import { armGuideRevalidate } from "./guidesRevalidate";
import { urlSections } from "./guidesToc";

export async function loadGuidePage(
    gameId: number,
    faqId: string,
    pageKey: string,
    session: GuidesBrowserSession | null,
    gameUrl: string | null,
    onNetwork?: () => void
): Promise<GuidePageFetch> {
    const cached = await getCachedGuidePage(gameId, faqId, pageKey, true);
    if (cached.cached && cached.html) {
        try {
            const hit = JSON.parse(cached.html) as GuideContent;
            if (cached.stale) {
                logGuidesDebug(
                    "page",
                    faqId,
                    gameUrl
                        ? `stale hit page=${pageKey}, serving it and rechecking on close`
                        : `stale hit page=${pageKey}, and no mapping to recheck it against`
                );
                if (gameUrl) {
                    armGuideRevalidate({ gameId, faqId, pageKey, gameUrl });
                }
            }
            else {
                logGuidesDebug("page", faqId, `cache hit page=${pageKey}`);
            }
            return { content: hit, failure: null };
        }
        catch {
            logGuidesDebug("page", faqId, `cache unreadable page=${pageKey}, scraping`);
        }
    }
    else {
        logGuidesDebug("page", faqId, `cache miss page=${pageKey}, scraping`);
    }

    if (!session || !gameUrl) {
        return { content: null, failure: null };
    }
    if (onNetwork) onNetwork();
    const fetched = await session.fetchGuideContent(gameUrl, faqId, pageKey === "0" ? undefined : pageKey);
    if (fetched.content) {
        void saveCachedGuidePage(
            gameId,
            faqId,
            JSON.stringify(fetched.content),
            pageKey,
            urlSections(fetched.content.toc).map((entry) => entry.slug)
        );
        return fetched;
    }
    logGuidesDebug(
        "page",
        faqId,
        `scrape failed page=${pageKey} (${fetched.failure ?? "no reason"}), nothing to fall back on`
    );
    return fetched;
}
