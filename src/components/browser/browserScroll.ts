import { fetchNoCors } from "@decky/api";
import { logError } from "../../utils/errors";
import { isAdExempt } from "./adExemptions";

const CDP_TAB_LIST = "http://localhost:8080/json";

const EVALUATE_TIMEOUT_MS = 4000;

const TARGET_LIST_TIMEOUT_MS = 3000;

const RESTORE_ATTEMPTS = 8;

const RESTORE_GAP_MS = 220;

const KEEP_PLACE_SETTLE_MS = 250;

type CdpTarget = {
    id?: string;
    type?: string;
    url?: string;
    webSocketDebuggerUrl?: string;
};

function evaluate(wsUrl: string, expression: string): Promise<any> {
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
            clearTimeout(timer);
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
        const timer = setTimeout(() => finish(false, new Error("cdp-timeout")), EVALUATE_TIMEOUT_MS);
        socket.onopen = () => {
            socket.send(JSON.stringify({
                id: 1,
                method: "Runtime.evaluate",
                params: {
                    expression,
                    returnByValue: true,
                    awaitPromise: true,
                    allowUnsafeEvalBlocklistBypass: true
                }
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
            if (msg.error || msg.result?.exceptionDetails) {
                finish(false, new Error("cdp-eval-failed"));
                return;
            }
            finish(true, msg.result?.result?.value);
        };
        socket.onerror = () => finish(false, new Error("cdp-socket-error"));
        socket.onclose = () => finish(false, new Error("cdp-closed"));
    });
}

export type PageSession = {
    readonly connected: boolean;
    evaluate(expression: string): Promise<any>;
};

type PageRunner = (expression: string) => Promise<any>;

const SAME_ADDRESS = `
    const sameAddress = (reported, url) => reported === url || reported === encodeURI(url) || reported.replace(/\\/$/, "") === url.replace(/\\/$/, "");
`;

let viewSocket = "";

export let lastCaptureMiss = "";

function sameAddress(reported: string, url: string): boolean {
    return reported === url || reported === encodeURI(url) || reported.replace(/\/$/, "") === url.replace(/\/$/, "");
}

let activeTarget = "";
const claimedTargets = new Set<string>();

export function setActiveTarget(id: string): void {
    if (id !== activeTarget) {
        activeTarget = id;
        viewSocket = "";
    }
}

export function claimTarget(id: string): void {
    claimedTargets.add(id);
}

export function releaseTarget(id: string): void {
    claimedTargets.delete(id);
    if (activeTarget === id) {
        activeTarget = "";
        viewSocket = "";
    }
}

function listTargets(): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("cdp-list-timeout")), TARGET_LIST_TIMEOUT_MS);
        (async () => JSON.parse(await (await fetchNoCors(CDP_TAB_LIST)).text()))().then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (e) => {
                clearTimeout(timer);
                reject(e);
            }
        );
    });
}

async function pageTargets(): Promise<CdpTarget[]> {
    const targets = (await listTargets()) as CdpTarget[];
    return Array.isArray(targets)
        ? targets.filter((t) => t.type === "page" && typeof t.url === "string" && !!t.webSocketDebuggerUrl)
        : [];
}

export async function targetForUrl(url: string): Promise<{ id: string; socket: string } | null> {
    if (!url) {
        return null;
    }
    try {
        const match = (await pageTargets()).find(
            (t) => !!t.id && !claimedTargets.has(t.id) && sameAddress(String(t.url), url)
        );
        return match?.id && match.webSocketDebuggerUrl ? { id: match.id, socket: match.webSocketDebuggerUrl } : null;
    }
    catch {
        return null;
    }
}

export async function socketOfTarget(id: string): Promise<string | null> {
    if (!id) {
        return null;
    }
    try {
        return (await pageTargets()).find((t) => t.id === id)?.webSocketDebuggerUrl ?? null;
    }
    catch {
        return null;
    }
}

async function socketForUrl(url: string, targetId = activeTarget): Promise<string | null> {
    if (!url) {
        return null;
    }
    try {
        const targets = (await listTargets()) as CdpTarget[];
        if (!Array.isArray(targets)) {
            return null;
        }
        const match = targets.find(
            (t) =>
                t.type === "page" &&
                typeof t.url === "string" &&
                !!t.webSocketDebuggerUrl &&
                sameAddress(t.url, url) &&
                (targetId ? t.id === targetId : !claimedTargets.has(t.id ?? ""))
        );
        if (match?.webSocketDebuggerUrl && targetId === activeTarget) {
            viewSocket = match.webSocketDebuggerUrl;
        }
        return match?.webSocketDebuggerUrl ?? null;
    }
    catch {
        return null;
    }
}

async function runnerFor(session: PageSession | null | undefined, url: string, targetId?: string): Promise<PageRunner | null> {
    if (session?.connected) {
        return (expression) => session.evaluate(expression);
    }
    const wsUrl = await socketForUrl(url, targetId);
    return wsUrl ? (expression) => evaluate(wsUrl, expression) : null;
}

export type ScrollPlace = {
    offset: number;
    anchor: string;
};

export const PAGE_KEPT_PLACE = "page";

const KEPT_PLACE_KEY = "__cheevodeckPlace:";

const TEXT_OF = `
    const textOf = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim();
    const signatureOf = (el) => {
        let best = "";
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        for (let seen = 0; node && seen < 200; seen++) {
            const owner = node.parentElement ? node.parentElement.tagName : "";
            if (owner !== "STYLE" && owner !== "SCRIPT" && owner !== "NOSCRIPT") {
                const text = (node.nodeValue || "").replace(/\\s+/g, " ").trim();
                if (text.length > best.length) {
                    best = text;
                }
            }
            node = walker.nextNode();
        }
        return best.slice(0, 80);
    };
`;

const PLACE_OF = `
    ${TEXT_OF}
    const placeHere = () => {
        const offset = Math.round(window.scrollY);
        const noise = /(^|[\\s_-])(ad|ads|advert|advertisement|sponsor|sponsored|banner|promo)([\\s_-]|$)/i;
        const skipped = (node) => {
            for (let el = node; el && el !== document.body; el = el.parentElement) {
                const position = getComputedStyle(el).position;
                if (position === "fixed" || position === "sticky" || el.tagName === "IFRAME") {
                    return true;
                }
                const name = typeof el.className === "string" ? el.className : "";
                if (noise.test(el.id || "") || noise.test(name)) {
                    return true;
                }
            }
            return false;
        };
        const pathTo = (el) => {
            const steps = [];
            for (let node = el; node && node !== document.body; node = node.parentElement) {
                if (node.id && document.querySelectorAll("#" + CSS.escape(node.id)).length === 1) {
                    steps.unshift("#" + CSS.escape(node.id));
                    return steps.join(" > ");
                }
                let index = 1;
                for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
                    if (sib.tagName === node.tagName) {
                        index++;
                    }
                }
                steps.unshift(node.tagName.toLowerCase() + ":nth-of-type(" + index + ")");
            }
            steps.unshift("body");
            return steps.join(" > ");
        };
        let anchor = "";
        let partial = "";
        if (offset > 0) {
            const x = Math.round(window.innerWidth / 2);
            for (let y = 8; y < window.innerHeight * 0.75 && !anchor; y += 24) {
                const hit = document.elementFromPoint(x, y);
                if (!hit || skipped(hit)) {
                    continue;
                }
                let el = null;
                for (let node = hit; node && node !== document.body; node = node.parentElement) {
                    if (node.getBoundingClientRect().height > window.innerHeight * 3) {
                        break;
                    }
                    const parent = node.parentElement;
                    let same = 0;
                    for (const sib of parent ? parent.children : []) {
                        if (sib.tagName === node.tagName) {
                            same++;
                        }
                    }
                    if (same >= 3 && signatureOf(node).length >= 12) {
                        el = node;
                        break;
                    }
                }
                if (!el) {
                    el = hit;
                    while (el && el !== document.body && textOf(el).length < 20) {
                        el = el.parentElement;
                    }
                    if (!el || el === document.body || el.getBoundingClientRect().height > window.innerHeight) {
                        continue;
                    }
                }
                const text = signatureOf(el);
                if (text.length < 8) {
                    continue;
                }
                const top = Math.round(el.getBoundingClientRect().top);
                const found = JSON.stringify({ path: pathTo(el), tag: el.tagName.toLowerCase(), text, top });
                if (top >= -8) {
                    anchor = found;
                }
                else if (!partial) {
                    partial = found;
                }
            }
        }
        return { offset, anchor: anchor || partial };
    };
`;

export async function captureScroll(url: string, targetId = activeTarget, session?: PageSession | null): Promise<ScrollPlace | null> {
    lastCaptureMiss = "";
    if (!url) {
        lastCaptureMiss = "no url";
        return null;
    }
    if (session?.connected) {
        return readPlace((expression) => session.evaluate(expression), url);
    }
    if (viewSocket && targetId === activeTarget) {
        const socket = viewSocket;
        const place = await readPlace((expression) => evaluate(socket, expression), url);
        if (place) {
            return place;
        }
    }
    const viaView = lastCaptureMiss;
    const wsUrl = await socketForUrl(url, targetId);
    if (!wsUrl) {
        lastCaptureMiss = `${viaView || "no view socket"}; no target for url`;
        return null;
    }
    return readPlace((expression) => evaluate(wsUrl, expression), url);
}

async function readPlace(run: PageRunner, url: string): Promise<ScrollPlace | null> {
    const script = `(() => {
        ${PLACE_OF}
        const place = placeHere();
        return { offset: place.offset, anchor: place.anchor, href: location.href };
    })()`;
    try {
        const value = await run(script);
        if (!value || typeof value.offset !== "number" || value.offset < 0) {
            lastCaptureMiss = "bad value";
            return null;
        }
        if (typeof value.href !== "string" || !sameAddress(value.href, url)) {
            lastCaptureMiss = `page at ${String(value.href).slice(0, 80)} not ${url.slice(0, 80)}`;
            return null;
        }
        return { offset: value.offset, anchor: typeof value.anchor === "string" ? value.anchor : "" };
    }
    catch (e) {
        lastCaptureMiss = `eval failed: ${String((e as Error)?.message ?? e)}`;
        return null;
    }
}

const INPUT_WATCH = `
    if (!window.__cheevodeckInput) {
        window.__cheevodeckInput = { count: 0 };
        const bump = () => {
            window.__cheevodeckInput.count++;
        };
        for (const type of ["wheel", "touchstart", "keydown", "mousedown"]) {
            addEventListener(type, bump, { capture: true, passive: true });
        }
    }
`;

let restoreCount = 0;

export function restoreToken(): string {
    restoreCount += 1;
    return `restore-${restoreCount}`;
}

function restoreScript(place: ScrollPlace, early: boolean, settle: boolean, token: string, url: string): string {
    const askPage = place.anchor === PAGE_KEPT_PLACE;
    let saved: unknown = null;
    try {
        saved = place.anchor && !askPage ? JSON.parse(place.anchor) : null;
    }
    catch {
        saved = null;
    }
    return `(() => {
        ${TEXT_OF}
        ${SAME_ADDRESS}
        const early = ${early};
        if (early && document.readyState === "complete") {
            return { state: "loading", by: "" };
        }
        if (!sameAddress(location.href, ${JSON.stringify(url)})) {
            return { state: "absent", by: "" };
        }
        ${INPUT_WATCH}
        const token = ${JSON.stringify(token)};
        const mark = window.__cheevodeckRestore;
        if (!mark || mark.token !== token) {
            window.__cheevodeckRestore = { token, count: window.__cheevodeckInput.count };
        }
        else if (mark.count !== window.__cheevodeckInput.count) {
            return { state: "user", by: "" };
        }
        let offset = ${Math.max(0, Math.round(place.offset))};
        let saved = ${JSON.stringify(saved)};
        if (${askPage}) {
            try {
                const kept = JSON.parse(sessionStorage.getItem(${JSON.stringify(KEPT_PLACE_KEY)} + location.href) || "null");
                if (kept && typeof kept.offset === "number") {
                    offset = Math.max(0, Math.round(kept.offset));
                    saved = kept.anchor ? JSON.parse(kept.anchor) : null;
                }
            }
            catch {
                saved = null;
            }
        }
        const matches = (el) => !!el && signatureOf(el) === saved.text;
        const find = () => {
            if (!saved || typeof saved.path !== "string" || typeof saved.text !== "string" || !saved.text) {
                return null;
            }
            let el = null;
            try {
                el = document.querySelector(saved.path);
            }
            catch {
                el = null;
            }
            if (matches(el)) {
                return el;
            }
            const candidates = document.getElementsByTagName(saved.tag || "div");
            const expected = offset + saved.top;
            let best = null;
            let bestDistance = Infinity;
            for (let i = 0; i < candidates.length && i < 1000; i++) {
                const node = candidates[i];
                if (node.childElementCount > 50 || !matches(node)) {
                    continue;
                }
                const distance = Math.abs(node.getBoundingClientRect().top + window.scrollY - expected);
                if (distance < bestDistance) {
                    best = node;
                    bestDistance = distance;
                }
            }
            return best;
        };
        const el = find();
        if (el) {
            const shift = el.getBoundingClientRect().top - saved.top;
            if (Math.abs(shift) > 2) {
                window.scrollTo(0, window.scrollY + shift);
            }
            const held = Math.abs(el.getBoundingClientRect().top - saved.top) <= 2;
            return { state: held ? "held" : "loading", by: "anchor" };
        }
        window.scrollTo(0, offset);
        const held = Math.abs(Math.round(window.scrollY) - offset) <= 2 && (${settle} || !saved);
        return { state: held ? "held" : "loading", by: "pixel" };
    })()`;
}

type RestoreOutcome = {
    state: "absent" | "loading" | "held" | "user";
    by: string;
};

export async function restoreScrollEarly(url: string, place: ScrollPlace, token: string, session?: PageSession | null): Promise<RestoreOutcome> {
    const run = await runnerFor(session, url);
    if (!run) {
        return { state: "absent", by: "" };
    }
    try {
        const value = await run(restoreScript(place, true, false, token, url));
        const state = value?.state === "held" || value?.state === "user" || value?.state === "absent" ? value.state : "loading";
        return { state, by: String(value?.by ?? "") };
    }
    catch {
        return { state: "loading", by: "" };
    }
}

export async function restoreScroll(url: string, place: ScrollPlace, token = restoreToken(), session?: PageSession | null): Promise<string | null> {
    if (place.offset < 0) {
        return "pixel";
    }
    const run = await runnerFor(session, url);
    if (!run) {
        return null;
    }
    for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt++) {
        const script = restoreScript(place, false, attempt === RESTORE_ATTEMPTS - 1, token, url);
        try {
            const first = await run(script);
            if (first?.state === "user" || first?.state === "absent") {
                return first.state === "user" ? "user" : null;
            }
            if (first?.state === "held") {
                await new Promise((resolve) => setTimeout(resolve, RESTORE_GAP_MS));
                const second = await run(script);
                if (second?.state === "user") {
                    return "user";
                }
                if (second?.state === "held") {
                    return String(second.by || "pixel");
                }
                continue;
            }
        }
        catch (e) {
            if (attempt === 0) {
                logError("restoreScroll", e);
            }
            return null;
        }
        await new Promise((resolve) => setTimeout(resolve, RESTORE_GAP_MS));
    }
    return null;
}

export async function blurPageField(url: string, session?: PageSession | null): Promise<boolean> {
    const run = await runnerFor(session, url);
    if (!run) {
        return false;
    }
    const script = `(() => {
        ${SAME_ADDRESS}
        if (!sameAddress(location.href, ${JSON.stringify(url)})) {
            return false;
        }
        const node = document.activeElement;
        if (node && node !== document.body && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable)) {
            node.blur();
        }
        return true;
    })()`;
    try {
        return (await run(script)) === true;
    }
    catch {
        return false;
    }
}

const AD_SLOT_CSS = [
    ".js-mapped-ad",
    ".gpt-ad",
    ".tbgads-slot-wrap",
    ".tbgads-header-slot-wrap",
    ".tbgads-anchor-slot-wrap",
    ".container-top-ads",
    ".top-ads-container",
    ".bottom-ads-container",
    ".fandom-ad-sticky-container",
    "fandom-ad",
    ".fandom-ad-wrapper",
    ".fandom-ad-placeholder",
    "#rail-boxad-wrapper",
    "div[itemprop=\"video\"]:has(> .featured-video-player-container:empty)",
    "[id^=\"mw-ad-slot\"]",
    ".adholder-instream",
    ".adunit-wrapper",
    "tr.table-ad",
    ".pogocnt",
    "[id^=\"bobble_\"]",
    "[data-gamera-placement-container]",
    ".jsad",
    "[data-ad-unit-id]",
    "[id^=\"ad_is_\"]",
    ".ad-header-container",
    ".ad-footer-container",
    "#mpu:has(> [id^=\"ad-\"])",
    ".leaderboard-ad",
    ".section-ad",
    ".wikigg-showcase__unit",
    ".advert_container",
    "#pogo-adhesion",
    "div[data-dfp-id]",
    ".adsninja-ad-zone:not([class*=\"an-zone-content-Instream\"]):not([class*=\"an-zone-content-outstream\"])",
    "#bottomAdContainer",
    ".feed-section__ad",
    "[data-ad-type]",
    "[id^=\"div-gpt-ad\"]",
    "ins.adsbygoogle",
    "iframe[id^=\"google_ads_iframe\"]",
    "iframe[src*=\"doubleclick.net\"]",
    "iframe[src*=\"googlesyndication.com\"]",
    "ytd-ad-slot-renderer",
    "ytd-watch-flexy #player-ads"
].join(", ") + " { display: none !important; }";

const AD_SLOT_STYLE_ID = "__cheevodeckAdHide";

const AD_SHEET_KEY = "__cheevodeckAdSheet";

export const AD_SLOT_EARLY = `(() => {
    if (window !== window.top || window.${AD_SHEET_KEY}) {
        return;
    }
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(${JSON.stringify(AD_SLOT_CSS)});
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    window.${AD_SHEET_KEY} = sheet;
})();`;

const YOUTUBE_STYLE_ID = "__cheevodeckYouTube";

const YOUTUBE_CSS = "ytd-watch-flexy[theater] #full-bleed-container { min-height: 0 !important; }";

const VALVE_SCROLLBAR_STYLE_ID = "__cheevodeckScrollbar";

const VALVE_SCROLLBAR_CSS = "html.GamepadMode ::-webkit-scrollbar { display: block !important; }";

const AD_SPEED = 16;

export const AD_SKIP_BINDING = "__cheevodeckSkip";

export const AD_SKIP_SELECTOR = ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button[id^='skip-button']";

export const YOUTUBE_HOST = /(^|\.)youtube\.com$/;

const AD_SKIP = `
    const player = () => document.getElementById("movie_player") || document.querySelector(".html5-video-player");
    const videoOf = (node) => node ? node.querySelector("video") : null;
    const skipSelector = ${JSON.stringify(AD_SKIP_SELECTOR)};
    let saved = null;
    let userRate = 0;
    let startedFor = "";
    let skipTimer = 0;
    let lastPress = 0;
    const pressSkip = () => {
        if (Date.now() - lastPress < 1000) {
            return;
        }
        for (const button of document.querySelectorAll(skipSelector)) {
            if (button.offsetParent === null) {
                continue;
            }
            lastPress = Date.now();
            try {
                window.${AD_SKIP_BINDING}("");
            }
            catch (e) {
                button.click();
            }
            return;
        }
    };
    const contentKey = () => location.pathname + "?" + (new URLSearchParams(location.search).get("v") || "");
    const isMuted = (node, video) => typeof node.isMuted === "function" ? node.isMuted() : video.volume === 0;
    const mute = (node, video, state) => {
        if (typeof node.mute === "function") {
            node.mute();
        }
        else {
            state.volume = video.volume;
            video.volume = 0;
        }
    };
    const unmute = (node, video, state) => {
        if (typeof node.unMute === "function") {
            node.unMute();
        }
        else {
            video.volume = state.volume || 1;
        }
    };
    const check = () => {
        const node = player();
        const video = videoOf(node);
        if (!node || !video) {
            return;
        }
        const showing = node.classList.contains("ad-showing");
        if (showing && window.__cheevodeckFastForward) {
            if (!saved) {
                saved = { ours: false, volume: 0 };
            }
            const speed = window.__cheevodeckFastForwardPreroll || startedFor === contentKey() ? ${AD_SPEED} : 1;
            if (speed === ${AD_SPEED} && !isMuted(node, video)) {
                mute(node, video, saved);
                saved.ours = true;
            }
            if (video.playbackRate !== speed) {
                video.playbackRate = speed;
            }
            pressSkip();
            if (!skipTimer) {
                skipTimer = setInterval(pressSkip, 500);
            }
            return;
        }
        if (skipTimer) {
            clearInterval(skipTimer);
            skipTimer = 0;
        }
        if (!saved) {
            return;
        }
        const was = saved;
        saved = null;
        if (video.playbackRate === ${AD_SPEED} || (userRate && video.playbackRate !== userRate)) {
            video.playbackRate = userRate || 1;
        }
        if (was.ours) {
            unmute(node, video, was);
        }
    };
    new MutationObserver((changes) => {
        for (const change of changes) {
            if (change.target.classList && change.target.classList.contains("html5-video-player")) {
                check();
                return;
            }
        }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"] });
    document.addEventListener("ratechange", (event) => {
        const node = player();
        if (!node || event.target !== videoOf(node)) {
            return;
        }
        if (saved) {
            check();
        }
        else if (!node.classList.contains("ad-showing") && event.target.playbackRate !== ${AD_SPEED}) {
            userRate = event.target.playbackRate;
        }
    }, true);
    document.addEventListener("timeupdate", (event) => {
        const node = player();
        if (node && event.target === videoOf(node) && !node.classList.contains("ad-showing") && !event.target.paused && event.target.currentTime > 1) {
            startedFor = contentKey();
        }
    }, true);
    document.addEventListener("volumechange", (event) => {
        const node = player();
        if (saved && node && event.target === videoOf(node)) {
            check();
        }
    }, true);
    window.__cheevodeckAdCheck = check;
    check();
`;

function cssZoom(percent: number): string {
    return percent > 100 ? String(percent / 100) : "";
}

export async function preparePage(url: string, percent: number, blockAds: boolean, fastForward: boolean, fastForwardPreroll: boolean, targetId = activeTarget, session?: PageSession | null): Promise<boolean> {
    const run = await runnerFor(session, url, targetId);
    if (!run) {
        return false;
    }
    const hideAdSlots = blockAds && !isAdExempt(url);
    const script = `(() => {
        ${SAME_ADDRESS}
        if (!sameAddress(location.href, ${JSON.stringify(url)})) {
            return false;
        }
        document.documentElement.style.zoom = ${JSON.stringify(cssZoom(percent))};
        let adStyle = document.getElementById(${JSON.stringify(AD_SLOT_STYLE_ID)});
        const adSheet = document.adoptedStyleSheets.includes(window.${AD_SHEET_KEY}) ? window.${AD_SHEET_KEY} : null;
        if (${hideAdSlots} && !adStyle && !adSheet) {
            adStyle = document.createElement("style");
            adStyle.id = ${JSON.stringify(AD_SLOT_STYLE_ID)};
            adStyle.textContent = ${JSON.stringify(AD_SLOT_CSS)};
            (document.head || document.documentElement).appendChild(adStyle);
        }
        else if (!${hideAdSlots}) {
            if (adStyle) {
                adStyle.remove();
            }
            if (adSheet) {
                document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== adSheet);
            }
        }
        if (!document.getElementById(${JSON.stringify(VALVE_SCROLLBAR_STYLE_ID)})) {
            const scrollbarStyle = document.createElement("style");
            scrollbarStyle.id = ${JSON.stringify(VALVE_SCROLLBAR_STYLE_ID)};
            scrollbarStyle.textContent = ${JSON.stringify(VALVE_SCROLLBAR_CSS)};
            (document.head || document.documentElement).appendChild(scrollbarStyle);
        }
        window.__cheevodeckFastForward = ${fastForward};
        window.__cheevodeckFastForwardPreroll = ${fastForwardPreroll};
        if (${YOUTUBE_HOST}.test(location.hostname)) {
            if (!document.getElementById(${JSON.stringify(YOUTUBE_STYLE_ID)})) {
                const youTubeStyle = document.createElement("style");
                youTubeStyle.id = ${JSON.stringify(YOUTUBE_STYLE_ID)};
                youTubeStyle.textContent = ${JSON.stringify(YOUTUBE_CSS)};
                (document.head || document.documentElement).appendChild(youTubeStyle);
                dispatchEvent(new Event("resize"));
            }
            if (window.__cheevodeckAdCheck) {
                window.__cheevodeckAdCheck();
            }
            else {
                ${AD_SKIP}
            }
        }
        if (window.__cheevodeckPlaceKeeper) {
            return true;
        }
        window.__cheevodeckPlaceKeeper = true;
        ${PLACE_OF}
        const keep = () => {
            try {
                const place = placeHere();
                sessionStorage.setItem(${JSON.stringify(KEPT_PLACE_KEY)} + location.href, JSON.stringify(place));
            }
            catch {
                return;
            }
        };
        let timer = 0;
        addEventListener("scroll", () => {
            clearTimeout(timer);
            timer = setTimeout(keep, ${KEEP_PLACE_SETTLE_MS});
        }, { passive: true });
        addEventListener("pagehide", keep);
        return true;
    })()`;
    try {
        return (await run(script)) === true;
    }
    catch {
        return false;
    }
}

export async function applyPageZoom(url: string, percent: number, session?: PageSession | null): Promise<boolean> {
    const run = await runnerFor(session, url);
    if (!run) {
        return false;
    }
    const script = `(() => {
        ${SAME_ADDRESS}
        if (!sameAddress(location.href, ${JSON.stringify(url)})) {
            return false;
        }
        document.documentElement.style.zoom = ${JSON.stringify(cssZoom(percent))};
        return true;
    })()`;
    try {
        return (await run(script)) === true;
    }
    catch {
        return false;
    }
}

const PLAYING_MEDIA = `[...document.querySelectorAll("video, audio")].filter((media) => !media.paused)`;

async function runOnTarget(targetId: string, session: PageSession | null | undefined, expression: string): Promise<any> {
    if (session?.connected) {
        return session.evaluate(expression);
    }
    const wsUrl = await socketOfTarget(targetId);
    return wsUrl ? evaluate(wsUrl, expression) : null;
}

export async function isPlayingSound(targetId: string, session?: PageSession | null): Promise<boolean> {
    try {
        return (await runOnTarget(targetId, session, `${PLAYING_MEDIA}.some((media) => !media.muted && media.volume > 0)`)) === true;
    }
    catch {
        return false;
    }
}

export async function pausePlayingMedia(targetId: string, session?: PageSession | null): Promise<void> {
    try {
        await runOnTarget(targetId, session, `(${PLAYING_MEDIA}.forEach((media) => media.pause()), true)`);
    }
    catch {
        return;
    }
}
