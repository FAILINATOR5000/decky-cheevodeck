import { beginGuideRevalidate, finishGuideRevalidate, logGuidesDebug } from "../api";
import { logError } from "./errors";
import { GuidesBrowserSession } from "./guidesFetch";
import { urlSections } from "./guidesToc";

export interface ArmedRevalidate {
    gameId: number;
    faqId: string;
    pageKey: string;
    gameUrl: string;
}

let armed: ArmedRevalidate | null = null;
let running = false;

export function armGuideRevalidate(req: ArmedRevalidate): void {
    armed = req;
}

export function fireArmedGuideRevalidate(): void {
    if (!armed || running) {
        return;
    }
    const req = armed;
    armed = null;
    running = true;
    void revalidate(req).catch((e) => logError("guides revalidate", e)).finally(() => {
        running = false;
    });
}

async function revalidate(req: ArmedRevalidate): Promise<void> {
    const gate = await beginGuideRevalidate(req.gameId, req.faqId, req.pageKey);
    if (!gate.allowed) {
        logGuidesDebug("revalidate", req.faqId, `page=${req.pageKey} declined, ${gate.why || "no reason given"}`);
        return;
    }
    if (!GuidesBrowserSession.isAvailable()) {
        return;
    }

    const session = new GuidesBrowserSession();
    try {
        const section = req.pageKey === "0" ? undefined : req.pageKey;
        const fetched = await session.fetchGuideContent(req.gameUrl, req.faqId, section);
        if (!fetched.content) {
            await finishGuideRevalidate(req.gameId, req.faqId, "", req.pageKey, gate.generation, []);
            logGuidesDebug(
                "revalidate",
                req.faqId,
                `page=${req.pageKey} came back empty (${fetched.failure ?? "no reason"}), backing off`
            );
            return;
        }
        const next = JSON.stringify(fetched.content);
        const res = await finishGuideRevalidate(
            req.gameId,
            req.faqId,
            next,
            req.pageKey,
            gate.generation,
            urlSections(fetched.content.toc).map((entry) => entry.slug)
        );
        logGuidesDebug(
            "revalidate",
            req.faqId,
            `page=${req.pageKey} ${res.changed ? "RESTRUCTURED" : "same shape"}, ` +
            `${res.superseded ? "dropped" : res.written ? "written" : "not written"}`
        );
    }
    finally {
        await session.destroy();
    }
}
