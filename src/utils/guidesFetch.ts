import { fetchNoCors } from "@decky/api";
import { debugLoggingEnabled, logGuidesDebug, probeGamefaqsReachable } from "../api";
import { t, type LanguageCode } from "../locales";

const GAMEFAQS_BASE = "https://gamefaqs.gamespot.com";
const CDP_TAB_LIST = "http://localhost:8080/json";

const PARK_MARKER = "cheevodeck-parked";

const liveSessions = new Set<GuidesBrowserSession>();
let sessionCounter = 0;

const POLL_INTERVAL_MS = 300;
const LOAD_DEADLINE_MS = 30000;

const ADOPT_AFTER_NO_TAB_POLLS = 8;

const NUDGE_AFTER_MS = 8000;
const NUDGE_MAX = 2;

const RECREATE_AFTER_NO_TAB_POLLS = 10;
const RECREATE_MAX = 1;

const CDP_FAIL_LIMIT = 2;

const PROBE_AFTER_EMPTY_POLLS = 2;

const CF_REATTACH_HOLD_MS = 5000;

const CF_RENAV_AFTER_MS = 12000;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function gameFaqsReachable(): Promise<boolean | null> {
    const probe = probeGamefaqsReachable(4)
        .then((res) => {
            const verdict = res.reachable === true ? true : res.reachable === false ? false : null;
            logGuidesDebug("probe", "gamefaqs", String(verdict) + " " + (res.why || ""));
            return verdict;
        })
        .catch((e) => {
            logGuidesDebug("probe", "gamefaqs", "ipc-fail " + String(e));
            return null;
        });
    return Promise.race([probe, delay(6000).then(() => null)]);
}

export type GuideFetchFailure = "challenge" | "offline" | "no-view" | "stalled" | "empty" | "timeout";

export type GuideReaderError = GuideFetchFailure | "unknown";

export function guideFailureText(language: LanguageCode, failure: GuideReaderError | null): string {
    switch (failure) {
        case "challenge":
            return t(language, "GameFAQs is running a security check. Try again in a moment.");
        case "offline":
            return t(language, "GameFAQs didn't respond. Check your connection and try again.");
        case "no-view":
            return t(language, "Couldn't open the page viewer. Try again.");
        case "stalled":
            return t(language, "GameFAQs never finished loading the page. Try again.");
        case "empty":
            return t(language, "There's no readable guide text on this page.");
        case "timeout":
            return t(language, "GameFAQs took too long to answer. Try again.");
        default:
            return t(language, "Couldn't load this guide.");
    }
}

export interface GuideSearchResult {
    productName: string;
    gameName: string;
    url: string;
    platformSlug: string;
    platforms: string;
    hasGuides: boolean;
    gameId: string;
    dateReleased: string;
}

export interface GuideListEntry {
    faqId: string;
    title: string;
    author: string;
    url: string;
    type: string;
    flair: string[];
    offlineOnly?: boolean;
}

export interface GuideTocEntry {
    label: string;
    slug: string;
    href: string;
}

export interface GuideContent {
    html: string;
    kind: "formatted" | "plaintext";
    toc: GuideTocEntry[];
}

export interface GuidePageFetch {
    content: GuideContent | null;
    failure: GuideFetchFailure | null;
}

interface CdpTab {
    type?: string;
    url?: string;
    title?: string;
    webSocketDebuggerUrl?: string;
    id?: string;
}

function guideListUrl(gameUrl: string): string {
    return GAMEFAQS_BASE + gameUrl + "/faqs";
}

function guidePageUrl(gameUrl: string, faqId: string, sectionSlug?: string): string {
    const base = GAMEFAQS_BASE + gameUrl + "/faqs/" + faqId;
    return sectionSlug ? base + "/" + sectionSlug : base;
}

function searchUrl(term: string): string {
    return GAMEFAQS_BASE + "/ajax/home_game_search?term=" + encodeURIComponent(term).replace(/'/g, "%27");
}

export function absoluteGameFaqsUrl(pathOrUrl: string): string {
    if (!pathOrUrl) return pathOrUrl;
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    if (pathOrUrl.charAt(0) === "/") return GAMEFAQS_BASE + pathOrUrl;
    return GAMEFAQS_BASE + "/" + pathOrUrl;
}

function cdpEvaluate(wsUrl: string, expression: string, timeoutMs = 9000): Promise<any> {
    return new Promise((resolve, reject) => {
        let socket: WebSocket;
        try {
            socket = new WebSocket(wsUrl);
        }
        catch (e) {
            reject(e);
            return;
        }
        let settled = false;
        const finish = (ok: boolean, payload: any) => {
            if (settled) return;
            settled = true;
            try {
                socket.close();
            }
            catch {  }
            if (ok) {
                resolve(payload);
            }
            else {
                reject(payload);
            }
        };
        const timer = setTimeout(() => finish(false, new Error("cdp-timeout")), timeoutMs);
        socket.onopen = () => {
            socket.send(JSON.stringify({
                id: 1,
                method: "Runtime.evaluate",
                params: {
                    expression: expression,
                    returnByValue: true,
                    awaitPromise: true,
                    allowUnsafeEvalBlocklistBypass: true,
                },
            }));
        };
        socket.onmessage = (ev: MessageEvent) => {
            let msg: any;
            try {
                msg = JSON.parse(String(ev.data));
            }
            catch {
                return;
            }
            if (msg.id !== 1) return;
            clearTimeout(timer);
            if (msg.error) {
                finish(false, new Error(JSON.stringify(msg.error)));
                return;
            }
            const result = msg.result;
            if (result && result.exceptionDetails) {
                const desc = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
                finish(false, new Error(desc || "cdp-eval-exception"));
                return;
            }
            finish(true, result && result.result ? result.result.value : undefined);
        };
        socket.onerror = () => {
            clearTimeout(timer);
            finish(false, new Error("cdp-ws-error"));
        };
    });
}

function logSnippet(value: any): string {
    try {
        const s = typeof value === "string" ? value : JSON.stringify(value);
        return s.length > 180 ? s.slice(0, 180) + "…" : s;
    }
    catch {
        return "(unstringifiable)";
    }
}

export class GuidesBrowserSession {
    private view: SteamBrowserView | null = null;
    private destroyed = false;
    private onChallenge: ((active: boolean) => void) | null;
    private readonly tag = "-s" + (++sessionCounter) + "-";
    private readonly parkUrl = `data:text/html,<body data-${PARK_MARKER}${this.tag}></body>`;

    constructor(opts?: { onChallenge?: (active: boolean) => void }) {
        this.onChallenge = opts?.onChallenge ?? null;
        liveSessions.add(this);
        logGuidesDebug("session", "register", `${this.tag} live=${liveSessions.size}`);
    }
    private loadGeneration = 0;
    private previousUrl = "";

    static isAvailable(): boolean {
        try {
            if (typeof SteamClient === "undefined") return false;
            const inst = resolveWindowInstance();
            return !!inst && typeof inst.CreateBrowserView === "function";
        }
        catch {
            return false;
        }
    }

    private ensureView(): SteamBrowserView | null {
        if (this.destroyed) return null;
        if (this.view) return this.view;
        const inst = resolveWindowInstance();
        if (!inst || typeof inst.CreateBrowserView !== "function") {
            logGuidesDebug("create", "no-window-instance");
            return null;
        }
        try {
            const bv = inst.CreateBrowserView("CheevoDeck Guides");
            this.view = bv;
            logGuidesDebug("create", "ok");
            return bv;
        }
        catch (e) {
            logGuidesDebug("create", "throw", String(e));
            return null;
        }
    }

    private async loadAndScrape(
        url: string,
        scrapeJs: string,
        label: string
    ): Promise<{ value: any; failure: GuideFetchFailure | null }> {
        let view = this.ensureView();
        if (!view) return { value: null, failure: "no-view" };

        const generation = ++this.loadGeneration;
        const superseded = () => this.destroyed || this.loadGeneration !== generation;
        const avoidUrl = this.previousUrl;
        this.previousUrl = url;

        logGuidesDebug("loadurl", label, url);
        try {
            view.LoadURL(url);
        }
        catch (e) {
            logGuidesDebug("loadurl", label, "throw " + String(e));
            return { value: null, failure: "no-view" };
        }

        const startedAt = Date.now();
        const elapsed = () => Date.now() - startedAt;
        const encoded = encodeURI(url);
        const canonical = encoded.replace(/'/g, "%27");
        let ready: any = null;
        let terminal = false;
        let noTabPolls = 0;
        let noTabMisses = 0;
        let cdpFails = 0;
        let emptyPolls = 0;
        let probeStarted = false;
        let reachable: boolean | null = null;
        let sawHost = false;
        let recreates = 0;
        let failure: GuideFetchFailure | null = null;
        let cfEverSeen = false;
        let polls = 0;
        let nudges = 0;
        let lastNudgeAt = 0;
        let cfHoldUntilMs = 0;
        let cfSeenAt = -1;
        let adopted = false;
        let cfAnnounced = false;
        const announceCf = (active: boolean) => {
            if (!this.onChallenge || active === cfAnnounced) return;
            cfAnnounced = active;
            try {
                this.onChallenge(active);
            }
            catch {  }
        };
        const escalate = async (why: string): Promise<boolean> => {
            if (recreates >= RECREATE_MAX) {
                logGuidesDebug("poll", label, why + " after recreate, giving up at " + elapsed() + "ms");
                failure = "no-view";
                return false;
            }
            recreates++;
            noTabMisses = 0;
            noTabPolls = 0;
            cdpFails = 0;
            emptyPolls = 0;
            adopted = false;
            logGuidesDebug("poll", label, "recreate-view " + recreates + " at " + elapsed() + "ms (" + why + ")");
            const fresh = await this.recycleView();
            if (!fresh) {
                failure = "no-view";
                return false;
            }
            view = fresh;
            try {
                view.LoadURL(url);
            }
            catch (e) {
                logGuidesDebug("loadurl", label, "recreate throw " + String(e));
                failure = "no-view";
                return false;
            }
            return true;
        };
        const startProbe = () => {
            if (probeStarted) return;
            probeStarted = true;
            void gameFaqsReachable().then((ok) => {
                reachable = ok;
                logGuidesDebug("poll", label, "reachable=" + String(ok));
            });
        };
        while (elapsed() < LOAD_DEADLINE_MS) {
            await delay(POLL_INTERVAL_MS);
            if (superseded()) {
                logGuidesDebug("poll", label, "superseded " + elapsed() + "ms");
                announceCf(false);
                return { value: null, failure: null };
            }
            polls++;
            if (reachable === false && !sawHost) {
                logGuidesDebug("poll", label, "offline at " + elapsed() + "ms");
                failure = "offline";
                break;
            }

            let wsUrl: string | null = null;
            let matchedTitle = "";
            try {
                const res = await fetchNoCors(CDP_TAB_LIST);
                const tabs: CdpTab[] = JSON.parse(await res.text());
                let tab = tabs.find(
                    (t) =>
                        t.type === "page" &&
                        typeof t.url === "string" &&
                        (t.url === url || t.url === encoded || t.url === canonical ||
                            t.url.startsWith(url) || t.url.startsWith(canonical))
                );
                if (!tab && (adopted || ++noTabPolls > ADOPT_AFTER_NO_TAB_POLLS)) {
                    tab = tabs.find(
                        (t) =>
                            t.type === "page" &&
                            typeof t.url === "string" &&
                            t.url.startsWith(GAMEFAQS_BASE) &&
                            !(avoidUrl && t.url.startsWith(avoidUrl))
                    );
                    if (tab && !adopted) {
                        adopted = true;
                        logGuidesDebug("poll", label, "adopted-redirect " + (tab.url || ""));
                    }
                }
                wsUrl = tab && tab.webSocketDebuggerUrl ? tab.webSocketDebuggerUrl : null;
                matchedTitle = tab && typeof tab.title === "string" ? tab.title : "";
            }
            catch (e) {
                logGuidesDebug("poll", label, "list-fail " + String(e));
                continue;
            }
            if (!wsUrl) {
                if (polls % 5 === 1) logGuidesDebug("poll", label, "no-tab " + elapsed() + "ms");
                noTabMisses++;
                if (noTabMisses > RECREATE_AFTER_NO_TAB_POLLS) {
                    const carryOn = await escalate("no-tab");
                    if (superseded()) {
                        logGuidesDebug("poll", label, "superseded " + elapsed() + "ms");
                        announceCf(false);
                        return { value: null, failure: null };
                    }
                    if (!carryOn) break;
                }
                continue;
            }
            noTabPolls = 0;
            noTabMisses = 0;
            if (superseded()) {
                logGuidesDebug("poll", label, "superseded " + elapsed() + "ms");
                announceCf(false);
                return { value: null, failure: null };
            }

            if (/just a moment|attention required/i.test(matchedTitle)) {
                announceCf(true);
                cfEverSeen = true;
                if (cfSeenAt < 0) cfSeenAt = elapsed();
                if (elapsed() - cfSeenAt > CF_RENAV_AFTER_MS && nudges < NUDGE_MAX) {
                    nudges++;
                    lastNudgeAt = elapsed();
                    cfSeenAt = -1;
                    logGuidesDebug("poll", label, "cf-renav " + nudges + " at " + elapsed() + "ms");
                    announceCf(false);
                    try {
                        view.LoadURL(url);
                    }
                    catch {  }
                    continue;
                }
                if (polls % 5 === 1) logGuidesDebug("poll", label, "cf-wait(title) " + elapsed() + "ms");
                continue;
            }
            if (elapsed() < cfHoldUntilMs) {
                if (polls % 5 === 1) logGuidesDebug("poll", label, "cf-hold " + elapsed() + "ms");
                continue;
            }

            let value: any;
            try {
                const left = LOAD_DEADLINE_MS - elapsed();
                value = await cdpEvaluate(wsUrl, scrapeJs, Math.max(3000, Math.min(9000, left)));
                cdpFails = 0;
            }
            catch (e) {
                logGuidesDebug("execute", label, "cdp-fail " + String(e));
                cdpFails++;
                startProbe();
                if (cdpFails >= CDP_FAIL_LIMIT) {
                    const carryOn = await escalate("cdp-dead");
                    if (superseded()) {
                        logGuidesDebug("poll", label, "superseded " + elapsed() + "ms");
                        announceCf(false);
                        return { value: null, failure: null };
                    }
                    if (!carryOn) break;
                }
                continue;
            }
            if (value && value.diag && value.diag.cf) {
                cfHoldUntilMs = elapsed() + CF_REATTACH_HOLD_MS;
                cfEverSeen = true;
                if (cfSeenAt < 0) cfSeenAt = elapsed();
                announceCf(true);
            }
            if (superseded()) {
                logGuidesDebug("poll", label, "superseded " + elapsed() + "ms");
                announceCf(false);
                return { value: null, failure: null };
            }

            if (value && value.ready) {
                logGuidesDebug("execute", label, "ready " + elapsed() + "ms " + logSnippet(value));
                ready = value;
                break;
            }
            if (value && value.terminal) {
                logGuidesDebug("execute", label, "terminal " + elapsed() + "ms " + String(value.why || ""));
                terminal = true;
                failure = value.why === "nav-error" ? "offline" : "empty";
                break;
            }
            const host = value && value.diag ? String(value.diag.host || "") : null;
            if (host !== null && host.indexOf("gamefaqs") === -1) {
                emptyPolls++;
                if (emptyPolls >= PROBE_AFTER_EMPTY_POLLS) {
                    startProbe();
                }
            }
            else {
                if (host !== null) sawHost = true;
                emptyPolls = 0;
            }
            if (host !== null && host.indexOf("gamefaqs") === -1 && nudges < NUDGE_MAX && elapsed() - lastNudgeAt > NUDGE_AFTER_MS) {
                nudges++;
                lastNudgeAt = elapsed();
                logGuidesDebug("poll", label, "renudge " + nudges + " at " + elapsed() + "ms");
                try {
                    view.LoadURL(url);
                }
                catch {  }
                continue;
            }
            if (polls % 5 === 1) logGuidesDebug("poll", label, "not-ready " + logSnippet(value));
        }

        announceCf(false);
        if (!ready && !terminal && failure === null) {
            logGuidesDebug("timeout", label, "gave up after " + elapsed() + "ms (" + polls + " polls)");
            if (reachable === false) {
                failure = "offline";
            }
            else if (cfEverSeen) {
                failure = "challenge";
            }
            else if (nudges > 0) {
                failure = "stalled";
            }
            else {
                failure = "timeout";
            }
        }
        if (!superseded()) {
            this.previousUrl = "";
            if (failure !== null && failure !== "empty") {
                await this.discardView();
            }
            else if (this.view) {
                try {
                    this.view.LoadURL(this.parkUrl);
                }
                catch {  }
            }
        }
        return { value: ready, failure: ready ? null : failure };
    }

    private async discardView(): Promise<void> {
        const view = this.view;
        this.view = null;
        if (!view) return;
        try {
            view.LoadURL(this.parkUrl);
            await delay(400);
        }
        catch (e) {
            logGuidesDebug("recycle", "unload", "throw " + String(e));
        }
        try {
            SteamClient?.BrowserView?.Destroy?.(view);
        }
        catch (e) {
            logGuidesDebug("recycle", "destroy", "throw " + String(e));
        }
        await this.sweep(true);
    }

    private async recycleView(): Promise<SteamBrowserView | null> {
        await this.discardView();
        if (this.destroyed) return null;
        return this.ensureView();
    }

    async searchGames(term: string): Promise<GuideSearchResult[] | null> {
        const { value } = await this.loadAndScrape(searchUrl(term), SEARCH_SCRAPER, "search:" + term);
        if (!value || typeof value.text !== "string") return null;
        return parseSearchJson(value.text);
    }

    async fetchGuideList(gameUrl: string): Promise<GuideListEntry[] | null> {
        const { value } = await this.loadAndScrape(guideListUrl(gameUrl), GUIDE_LIST_SCRAPER, "list:" + gameUrl);
        if (!value || !Array.isArray(value.entries)) return null;
        return value.entries as GuideListEntry[];
    }

    async fetchGuideContent(gameUrl: string, faqId: string, sectionSlug?: string): Promise<GuidePageFetch> {
        const { value, failure } = await this.loadAndScrape(
            guidePageUrl(gameUrl, faqId, sectionSlug),
            GUIDE_CONTENT_SCRAPER,
            "content:" + faqId + (sectionSlug ? "/" + sectionSlug : "")
        );
        if (!value || typeof value.html !== "string") {
            return { content: null, failure: failure ?? (value ? "empty" : null) };
        }
        return {
            content: {
                html: value.html,
                kind: value.kind === "formatted" ? "formatted" : "plaintext",
                toc: Array.isArray(value.toc) ? (value.toc as GuideTocEntry[]) : [],
            },
            failure: null,
        };
    }

    async destroy(): Promise<void> {
        if (this.destroyed) return;
        this.destroyed = true;
        liveSessions.delete(this);
        logGuidesDebug("session", "release", `${this.tag} live=${liveSessions.size}`);
        this.loadGeneration++;
        const view = this.view;
        this.view = null;
        if (view) {
            try {
                view.LoadURL(this.parkUrl);
                await delay(400);
            }
            catch (e) {
                logGuidesDebug("teardown", "unload", "throw " + String(e));
            }
            try {
                SteamClient?.BrowserView?.Destroy?.(view);
                logGuidesDebug("teardown", "destroyed");
            }
            catch (e) {
                logGuidesDebug("teardown", "destroy", "throw " + String(e));
            }
        }
        await this.sweep(view !== null);
    }

    private async sweep(hadView: boolean): Promise<void> {
        const wide = liveSessions.size === 0;
        if (!wide && !hadView) return;
        try {
            const res = await fetchNoCors(CDP_TAB_LIST);
            const tabs: CdpTab[] = JSON.parse(await res.text());
            const ownPark = PARK_MARKER + this.tag;
            let swept = 0;
            for (const t of tabs) {
                if (t.type !== "page" || typeof t.url !== "string" || !t.id) continue;
                const mine = t.url.startsWith("data:") && t.url.indexOf(ownPark) !== -1;
                const orphan = wide &&
                    (t.url.startsWith(GAMEFAQS_BASE) ||
                        (t.url.startsWith("data:") && t.url.indexOf(PARK_MARKER) !== -1));
                if (!mine && !orphan) continue;
                await fetchNoCors("http://localhost:8080/json/close/" + t.id).catch(() => undefined);
                swept++;
            }
            if (swept > 0) logGuidesDebug("teardown", "swept", `${swept} wide=${wide}`);
        }
        catch {  }
    }
}

function resolveWindowInstance(): SteamWindowInstance | null {
    try {
        const gp = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance;
        if (gp && typeof gp.CreateBrowserView === "function") return gp;
    }
    catch {  }
    try {
        const map = SteamUIStore?.m_WindowStore?.m_mapDesiredWindowInstances;
        if (map && typeof map.values === "function") {
            for (const inst of map.values()) {
                if (inst && typeof inst.CreateBrowserView === "function") return inst;
            }
        }
    }
    catch {  }
    return null;
}

function parseSearchJson(text: string): GuideSearchResult[] {
    let rows: any;
    try {
        rows = JSON.parse(text);
    }
    catch {
        logGuidesDebug("parse", "search", "not-json");
        return [];
    }
    if (!Array.isArray(rows)) return [];
    const GAME_URL = /^\/[a-z0-9_-]+\/\d+-/i;
    const out: GuideSearchResult[] = [];
    const dropped: string[] = [];
    for (const r of rows) {
        const url = String(r?.url || "").trim();
        if (!url) {
            dropped.push(String(r?.game_name || r?.product_name || "?"));
            continue;
        }
        if (!GAME_URL.test(url)) {
            dropped.push(url);
            continue;
        }
        out.push({
            productName: String(r?.product_name || r?.game_name || "").trim(),
            gameName: String(r?.game_name || r?.product_name || "").trim(),
            url,
            platformSlug: String(r?.platform_url || url.split("/")[1] || "")
                .trim()
                .toLowerCase(),
            platforms: String(r?.plats || "").trim(),
            hasGuides: String(r?.has_guides || "") === "1",
            gameId: String(r?.game_id || "").trim(),
            dateReleased: String(r?.date_released || "").trim(),
        });
    }
    if (debugLoggingEnabled()) {
        if (rows.length > 0) {
            logGuidesDebug("parse", "search", "keys=" + Object.keys(rows[0] || {}).join(","));
        }
        if (dropped.length > 0) {
            logGuidesDebug("parse", "search", `kept=${out.length} dropped=${dropped.join(" | ")}`);
        }
    }
    return out;
}

const CF_CHALLENGE_CHECK = `const cfChallenge =
        document.querySelector("#challenge-form, #cf-wrapper, #challenge-running, #challenge-stage") !== null ||
        /just a moment|attention required/i.test(document.title || "");
    // Definitive verdicts (terminal / genuinely-empty) additionally require
    // actually standing on a GameFAQs document -- never the parked blank
    // page or anything else a navigation race could hand us.
    const onGameFaqs = (location.hostname || "").indexOf("gamefaqs") !== -1;
    const settled = document.readyState !== "loading" && !cfChallenge && onGameFaqs;
    // A failed navigation parks the tab on Chromium's own error document
    // (documentURI chrome-error://...) while the tab list keeps reporting the
    // url we asked for. That document never becomes the page -- terminal.
    if ((document.documentURI || "").indexOf("chrome-error://") === 0) {
        return { ready: false, terminal: true, why: "nav-error" };
    }
    // Rode along on every not-ready answer: which gate is actually holding
    // (still parsing? challenge? never left the initial blank document?).
    // This is the observability the Pokemon Yellow stall didn't have.
    const diag = {
        state: document.readyState,
        host: location.hostname || "",
        cf: cfChallenge,
        len: ((document.body && document.body.innerText) || "").length,
    };`;

const SEARCH_SCRAPER = `(() => {
    const el = document.body || document.documentElement;
    const text = el ? (el.innerText || "") : "";
    if (text.trim().charAt(0) === "[") return { ready: true, text: text };
    ${CF_CHALLENGE_CHECK}
    if (settled && text.trim() !== "") {
        return { ready: false, terminal: true, why: "non-json-page" };
    }
    return { ready: false, text: "", diag: diag };
})()`;

const GUIDE_LIST_SCRAPER = `(() => {
    ${CF_CHALLENGE_CHECK}
    const links = Array.from(document.querySelectorAll('a[href*="/faqs/"]'));
    if (!links.length) {
        // Guide rows are server-rendered, so once the DOM is parsed and this
        // is not an interstitial, zero guide links IS the answer: report a
        // real empty list now rather than polling out the clock. This is what
        // used to make a guideless game look like a ~77s network failure.
        if (settled) {
            return { ready: true, entries: [] };
        }
        return { ready: false, entries: [], diag: diag };
    }

    // Same hole the content scraper had: finding SOME guide rows is not
    // finding ALL of them. A poll landing while the page is still streaming
    // returned however many had parsed by then, and that short list was cached
    // and shown as if it were the whole thing — a game quietly missing half
    // its guides, with nothing to say so. The headings that give each row its
    // type are read the same way, so a partial parse mislabels as well as
    // truncates.
    if (!settled) {
        return { ready: false, entries: [], diag: diag };
    }

    const headings = Array.from(document.querySelectorAll("h2, h3, h4")).map((h) => ({
        el: h,
        text: (h.textContent || "").replace(/\\s+/g, " ").trim(),
    }));
    const typeFor = (a) => {
        let best = "";
        for (const h of headings) {
            const pos = h.el.compareDocumentPosition(a);
            if (pos & Node.DOCUMENT_POSITION_FOLLOWING) best = h.text;
        }
        return best;
    };

    const entries = [];
    const seen = {};
    for (const a of links) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\\/faqs\\/(\\d+)(?:$|[\\/?#])/);
        if (!m) continue;
        if (seen[href]) continue;
        seen[href] = true;
        // The title is the bold guide link's own text. Author + flair live in
        // sibling nodes in the same row, so read them off the row container:
        // author is the /community/ profile link, flair the .flair chips.
        const title = (a.textContent || "").replace(/\\s+/g, " ").trim();
        if (!title) continue;
        const row = a.closest("div, li, tr") || a.parentElement;
        let author = "";
        let flair = [];
        if (row) {
            const authorLink = row.querySelector('a[href*="/community/"]');
            if (authorLink) author = (authorLink.textContent || "").replace(/\\s+/g, " ").trim();
            flair = Array.from(row.querySelectorAll(".flair"))
                .map((f) => (f.textContent || "").replace(/\\s+/g, " ").trim())
                .filter(Boolean);
        }
        entries.push({
            faqId: m[1],
            title: title,
            author: author,
            url: href,
            type: typeFor(a),
            flair: flair,
        });
    }
    return { ready: true, entries: entries };
})()`;

const GUIDE_CONTENT_SCRAPER = `(() => {
    ${CF_CHALLENGE_CHECK}
    const wrap = document.querySelector("#faqwrap") || document.querySelector("#faqtext");
    if (!wrap) {
        // Parsed, not a challenge, and no guide body: a page this scraper
        // doesn't speak (image/map guides have no #faqwrap). Fail fast so the
        // reader shows its error instead of a full-deadline spinner.
        if (settled) {
            return { ready: false, terminal: true, why: "no-faqwrap" };
        }
        return { ready: false, diag: diag };
    }

    // A guide body that EXISTS is not a guide body that is FINISHED, and until
    // now this was the only thing being asked. #faqwrap appears as soon as the
    // parser reaches the opening tag, so a poll landing mid-stream serialized a
    // half-parsed DOM — and serializing one auto-closes whatever is still
    // open, which is why the result looked like a whole document. Measured on
    // device: the same guide cached on two accounts, byte-identical for
    // 339,101 characters and then one copy simply stopping with
    // </pre></div></div>. Six percent of a 340KB guide, gone, with no error and
    // nothing in the log.
    //
    // readyState leaves "loading" when the HTML is parsed, NOT when images and
    // subresources finish, so this costs nothing on a page that has arrived.
    // The list scraper below had the same hole for the same reason: settled was
    // computed inside the not-found branch, where the success path could not
    // reach it.
    if (!settled) {
        return { ready: false, diag: diag };
    }

    const ftoc = document.querySelector(".ftoc");
    const kind = ftoc ? "formatted" : "plaintext";

    const toc = [];
    if (ftoc) {
        Array.from(ftoc.querySelectorAll("a[href]")).forEach((a) => {
            const href = a.getAttribute("href") || "";
            let slug = href;
            if (href.charAt(0) !== "#") {
                const parts = href.split(/[?#]/)[0].split("/").filter(Boolean);
                slug = parts.length ? parts[parts.length - 1] : href;
            }
            toc.push({ label: (a.textContent || "").replace(/\\s+/g, " ").trim(), slug: slug, href: href });
        });
    }

    // Clone so we strip defensively without touching the live page. Drop
    // scripts/styles, our-own-TOC's .ftoc block, and any on* handlers.
    const clone = wrap.cloneNode(true);
    Array.from(clone.querySelectorAll("script, style, .ftoc")).forEach((n) => n.remove());
    Array.from(clone.querySelectorAll("*")).forEach((el) => {
        Array.from(el.attributes).forEach((attr) => {
            if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        });
    });

    return { ready: true, html: clone.outerHTML, kind: kind, toc: toc };
})()`;
