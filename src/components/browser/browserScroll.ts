import { fetchNoCors } from "@decky/api";
import { logError } from "../../utils/errors";

const CDP_TAB_LIST = "http://localhost:8080/json";

const EVALUATE_TIMEOUT_MS = 4000;

const RESTORE_ATTEMPTS = 8;

const RESTORE_GAP_MS = 220;

const KEEP_PLACE_SETTLE_MS = 250;

type CdpTarget = {
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

let viewSocket = "";

export let lastCaptureMiss = "";

function sameAddress(reported: string, url: string): boolean {
    return reported === url || reported === encodeURI(url) || reported.replace(/\/$/, "") === url.replace(/\/$/, "");
}

export async function socketForUrl(url: string): Promise<string | null> {
    if (!url) {
        return null;
    }
    try {
        const response = await fetchNoCors(CDP_TAB_LIST);
        const targets: CdpTarget[] = JSON.parse(await response.text());
        if (!Array.isArray(targets)) {
            return null;
        }
        const match = targets.find(
            (t) =>
                t.type === "page" &&
                typeof t.url === "string" &&
                !!t.webSocketDebuggerUrl &&
                sameAddress(t.url, url)
        );
        if (match?.webSocketDebuggerUrl) {
            viewSocket = match.webSocketDebuggerUrl;
        }
        return match?.webSocketDebuggerUrl ?? null;
    }
    catch {
        return null;
    }
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

export async function captureScroll(url: string): Promise<ScrollPlace | null> {
    lastCaptureMiss = "";
    if (!url) {
        lastCaptureMiss = "no url";
        return null;
    }
    if (viewSocket) {
        const place = await readPlace(viewSocket, url);
        if (place) {
            return place;
        }
    }
    const viaView = lastCaptureMiss;
    const wsUrl = await socketForUrl(url);
    if (!wsUrl) {
        lastCaptureMiss = `${viaView || "no view socket"}; no target for url`;
        return null;
    }
    return readPlace(wsUrl, url);
}

async function readPlace(wsUrl: string, url: string): Promise<ScrollPlace | null> {
    const script = `(() => {
        ${PLACE_OF}
        const place = placeHere();
        return { offset: place.offset, anchor: place.anchor, href: location.href };
    })()`;
    try {
        const value = await evaluate(wsUrl, script);
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

function restoreScript(place: ScrollPlace, early: boolean, settle: boolean): string {
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
        const early = ${early};
        if (early && document.readyState === "complete") {
            return { state: "loading", by: "" };
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
    state: "absent" | "loading" | "held";
    by: string;
};

export async function restoreScrollEarly(url: string, place: ScrollPlace): Promise<RestoreOutcome> {
    const wsUrl = await socketForUrl(url);
    if (!wsUrl) {
        return { state: "absent", by: "" };
    }
    try {
        const value = await evaluate(wsUrl, restoreScript(place, true, false));
        return { state: value?.state === "held" ? "held" : "loading", by: String(value?.by ?? "") };
    }
    catch {
        return { state: "loading", by: "" };
    }
}

export async function restoreScroll(url: string, place: ScrollPlace): Promise<string | null> {
    if (place.offset < 0) {
        return "pixel";
    }
    const wsUrl = await socketForUrl(url);
    if (!wsUrl) {
        return null;
    }
    for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt++) {
        const script = restoreScript(place, false, attempt === RESTORE_ATTEMPTS - 1);
        try {
            const first = await evaluate(wsUrl, script);
            if (first?.state === "held") {
                await new Promise((resolve) => setTimeout(resolve, RESTORE_GAP_MS));
                const second = await evaluate(wsUrl, script);
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

export async function blurPageField(url: string): Promise<boolean> {
    const wsUrl = await socketForUrl(url);
    if (!wsUrl) {
        return false;
    }
    const script = `(() => {
        const node = document.activeElement;
        if (node && node !== document.body && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable)) {
            node.blur();
        }
        return true;
    })()`;
    try {
        await evaluate(wsUrl, script);
        return true;
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
    "iframe[src*=\"googlesyndication.com\"]"
].join(", ") + " { display: none !important; }";

const AD_SLOT_STYLE_ID = "__cheevodeckAdHide";

const YOUTUBE_STYLE_ID = "__cheevodeckYouTube";

const YOUTUBE_CSS = "ytd-watch-flexy[theater] #full-bleed-container { min-height: 0 !important; }";

const AD_SPEED = 16;

export const AD_SKIP_BINDING = "__cheevodeckSkip";

const AD_SKIP = `
    const player = () => document.getElementById("movie_player") || document.querySelector(".html5-video-player");
    const videoOf = (node) => node ? node.querySelector("video") : null;
    const skipSelector = ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button[id^='skip-button']";
    let saved = null;
    let userRate = 0;
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
            const rect = button.getBoundingClientRect();
            try {
                window.${AD_SKIP_BINDING}(JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }));
            }
            catch (e) {
                button.click();
            }
            return;
        }
    };
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
                saved = { muted: isMuted(node, video), volume: 0 };
            }
            if (!isMuted(node, video)) {
                mute(node, video, saved);
            }
            if (video.playbackRate !== ${AD_SPEED}) {
                video.playbackRate = ${AD_SPEED};
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
        if (!was.muted) {
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

export async function preparePage(url: string, percent: number, blockAds: boolean, fastForward: boolean): Promise<boolean> {
    const wsUrl = await socketForUrl(url);
    if (!wsUrl) {
        return false;
    }
    const script = `(() => {
        document.documentElement.style.zoom = ${JSON.stringify(cssZoom(percent))};
        let adStyle = document.getElementById(${JSON.stringify(AD_SLOT_STYLE_ID)});
        if (${blockAds} && !adStyle) {
            adStyle = document.createElement("style");
            adStyle.id = ${JSON.stringify(AD_SLOT_STYLE_ID)};
            adStyle.textContent = ${JSON.stringify(AD_SLOT_CSS)};
            (document.head || document.documentElement).appendChild(adStyle);
        }
        else if (!${blockAds} && adStyle) {
            adStyle.remove();
        }
        window.__cheevodeckFastForward = ${fastForward};
        if (/(^|\\.)youtube\\.com$/.test(location.hostname)) {
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
        await evaluate(wsUrl, script);
        return true;
    }
    catch {
        return false;
    }
}

export async function applyPageZoom(url: string, percent: number): Promise<boolean> {
    const wsUrl = await socketForUrl(url);
    if (!wsUrl) {
        return false;
    }
    const script = `(() => { document.documentElement.style.zoom = ${JSON.stringify(cssZoom(percent))}; return true; })()`;
    try {
        await evaluate(wsUrl, script);
        return true;
    }
    catch {
        return false;
    }
}
