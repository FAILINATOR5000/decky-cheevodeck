import { logFocusDebug } from "../../api";
import { AD_SKIP_BINDING, socketForUrl } from "./browserScroll";
import { AD_BLOCK_HOSTS, AD_BLOCK_PATTERNS } from "./adBlockHosts";
import { AD_LIBRARY_STAND_IN } from "./adStandIns";
import { FULLSCREEN_BINDING, FULLSCREEN_WATCH } from "./fullscreenWatch";

const COMMAND_TIMEOUT_MS = 4000;

const ATTACH_TRIES = 12;

const ATTACH_GAP_MS = 150;

export type DownloadRequest = {
    url: string;
    suggestedFilename: string;
};

let socket: WebSocket | null = null;
let attaching = false;
let wantedUrl = "";
let generation = 0;
let nextId = 1;
const waiting = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: number }>();

let blockAds = true;
let blockingSent: boolean | null = null;
let standInId: string | null = null;
let downloadHandler: ((request: DownloadRequest) => void) | null = null;
let fullscreenHandler: ((fullscreen: boolean) => void) | null = null;

let zoomPercent = 100;
let viewSize: { width: number; height: number } | null = null;
let windowDpr = 1;
let pageDpr = 0;
let metricsSent: string | null = null;

let blockPatterns: string[] | null = null;

function patterns(): string[] {
    if (blockPatterns === null) {
        blockPatterns = [];
        for (const host of AD_BLOCK_HOSTS) {
            blockPatterns.push(`*://${host}/*`, `*://*.${host}/*`);
        }
        blockPatterns.push(...AD_BLOCK_PATTERNS);
    }
    return blockPatterns;
}

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const live = socket;
    if (!live || live.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("session-closed"));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
            waiting.delete(id);
            reject(new Error(`session-timeout ${method}`));
        }, COMMAND_TIMEOUT_MS);
        waiting.set(id, { resolve, reject, timer });
        live.send(JSON.stringify({ id, method, params }));
    });
}

function onMessage(ev: MessageEvent) {
    let msg: any;
    try {
        msg = JSON.parse(String(ev.data));
    }
    catch {
        return;
    }
    if (typeof msg.id === "number") {
        const entry = waiting.get(msg.id);
        if (!entry) {
            return;
        }
        waiting.delete(msg.id);
        window.clearTimeout(entry.timer);
        if (msg.error) {
            entry.reject(new Error(String(msg.error.message ?? "cdp-error")));
        }
        else {
            entry.resolve(msg.result ?? {});
        }
        return;
    }
    if (msg.method === "Runtime.bindingCalled" && msg.params?.name === AD_SKIP_BINDING) {
        pressSkip(String(msg.params?.payload ?? ""));
        return;
    }
    if (msg.method === "Runtime.bindingCalled" && msg.params?.name === FULLSCREEN_BINDING) {
        fullscreenHandler?.(msg.params?.payload === "1");
        return;
    }
    if (msg.method === "Page.downloadWillBegin") {
        const url = String(msg.params?.url ?? "");
        const suggestedFilename = String(msg.params?.suggestedFilename ?? "");
        logFocusDebug("browser-download", "caught", `${url.slice(0, 80)} name=${suggestedFilename}`);
        if (url && downloadHandler) {
            downloadHandler({ url, suggestedFilename });
        }
    }
}

function dropSocket() {
    socket = null;
    blockingSent = null;
    standInId = null;
    metricsSent = null;
    pageDpr = 0;
    for (const entry of waiting.values()) {
        window.clearTimeout(entry.timer);
        entry.reject(new Error("session-closed"));
    }
    waiting.clear();
}

async function applyBlocking() {
    const wanted = blockAds;
    if (blockingSent === wanted) {
        return;
    }
    blockingSent = wanted;
    try {
        await send("Network.setBlockedURLs", { urls: wanted ? patterns() : [] });
        logFocusDebug("browser-session", "blocking", `${wanted ? patterns().length : 0} patterns`);
        await applyStandIns(wanted);
    }
    catch (e) {
        blockingSent = null;
        logFocusDebug("browser-session", "blocking failed", String((e as Error)?.message ?? e));
    }
}

async function applyStandIns(wanted: boolean) {
    if (wanted && standInId === null) {
        const result = await send("Page.addScriptToEvaluateOnNewDocument", { source: AD_LIBRARY_STAND_IN });
        standInId = String(result?.identifier ?? "") || null;
    }
    else if (!wanted && standInId !== null) {
        const identifier = standInId;
        standInId = null;
        await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
}

async function applyMetrics() {
    if (!socket || !viewSize || viewSize.width <= 0 || viewSize.height <= 0) {
        return;
    }
    if (pageDpr <= 0) {
        try {
            const result = await send("Runtime.evaluate", { expression: "devicePixelRatio", returnByValue: true });
            pageDpr = Number(result?.result?.value) || 0;
        }
        catch (e) {
            logFocusDebug("browser-session", "pixel ratio failed", String((e as Error)?.message ?? e));
        }
        if (pageDpr <= 0) {
            pageDpr = windowDpr;
        }
    }
    const z = zoomPercent / 100;
    const toPage = windowDpr / pageDpr;
    const metrics = zoomPercent >= 100 ? null : {
        width: Math.round(viewSize.width * toPage / z),
        height: Math.round(viewSize.height * toPage / z),
        deviceScaleFactor: 0,
        mobile: false,
        scale: z
    };
    const key = metrics ? `${metrics.width}x${metrics.height}@${metrics.scale}` : "clear";
    if (metricsSent === key) {
        return;
    }
    metricsSent = key;
    try {
        if (metrics) {
            await send("Emulation.setDeviceMetricsOverride", metrics);
        }
        else {
            await send("Emulation.clearDeviceMetricsOverride");
        }
        logFocusDebug("browser-session", "zoom", `${zoomPercent}% ${key} dpr=${windowDpr}/${pageDpr}`);
    }
    catch (e) {
        metricsSent = null;
        logFocusDebug("browser-session", "zoom failed", String((e as Error)?.message ?? e));
    }
}

async function attached() {
    try {
        await send("Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
    }
    catch (e) {
        logFocusDebug("browser-session", "network failed", String((e as Error)?.message ?? e));
    }
    try {
        await send("Page.enable");
        await send("Page.setDownloadBehavior", { behavior: "deny" });
    }
    catch (e) {
        logFocusDebug("browser-session", "downloads failed", String((e as Error)?.message ?? e));
    }
    try {
        await send("Runtime.addBinding", { name: FULLSCREEN_BINDING });
        await send("Runtime.addBinding", { name: AD_SKIP_BINDING });
        await send("Page.addScriptToEvaluateOnNewDocument", { source: FULLSCREEN_WATCH });
        await send("Runtime.evaluate", { expression: FULLSCREEN_WATCH });
    }
    catch (e) {
        logFocusDebug("browser-session", "fullscreen watch failed", String((e as Error)?.message ?? e));
    }
    await applyBlocking();
    await applyMetrics();
}

export function ensureSession(url: string): void {
    if (socket || !url) {
        return;
    }
    wantedUrl = url;
    if (attaching) {
        return;
    }
    attaching = true;
    const started = generation;
    (async () => {
        let wsUrl: string | null = null;
        for (let attempt = 0; attempt < ATTACH_TRIES && !wsUrl && started === generation; attempt++) {
            if (attempt > 0) {
                await new Promise((resolve) => window.setTimeout(resolve, ATTACH_GAP_MS));
            }
            wsUrl = await socketForUrl(wantedUrl);
        }
        if (!wsUrl || started !== generation) {
            logFocusDebug("browser-session", "no target", wantedUrl.slice(0, 60));
            return;
        }
        await new Promise<void>((resolve) => {
            let live: WebSocket;
            try {
                live = new WebSocket(wsUrl);
            }
            catch {
                resolve();
                return;
            }
            live.onopen = () => {
                if (started !== generation) {
                    live.close();
                    resolve();
                    return;
                }
                socket = live;
                logFocusDebug("browser-session", "attached", wantedUrl.slice(0, 60));
                void attached();
                resolve();
            };
            live.onmessage = onMessage;
            live.onerror = () => resolve();
            live.onclose = () => {
                if (socket === live) {
                    dropSocket();
                    logFocusDebug("browser-session", "detached", "");
                }
                resolve();
            };
        });
    })().finally(() => {
        attaching = false;
    });
}

export function setAdBlock(enabled: boolean): void {
    blockAds = enabled;
    if (socket) {
        void applyBlocking();
    }
}

export function setZoomPercent(percent: number): void {
    zoomPercent = percent;
    void applyMetrics();
}

export function setViewSize(width: number, height: number, dpr: number): void {
    viewSize = { width, height };
    if (dpr > 0) {
        windowDpr = dpr;
    }
    void applyMetrics();
}

export function setDownloadHandler(handler: ((request: DownloadRequest) => void) | null): void {
    downloadHandler = handler;
}

export function setFullscreenHandler(handler: ((fullscreen: boolean) => void) | null): void {
    fullscreenHandler = handler;
}

export function refreshPageBindings(): void {
    if (!socket) {
        return;
    }
    for (const name of [FULLSCREEN_BINDING, AD_SKIP_BINDING]) {
        send("Runtime.addBinding", { name }).catch((e) => {
            logFocusDebug("browser-session", "binding failed", `${name} ${String((e as Error)?.message ?? e)}`);
        });
    }
}

async function pressSkip(payload: string) {
    let point: { x?: unknown; y?: unknown };
    try {
        point = JSON.parse(payload);
    }
    catch {
        return;
    }
    if (typeof point.x !== "number" || typeof point.y !== "number") {
        return;
    }
    const scale = zoomPercent < 100 ? zoomPercent / 100 : 1;
    const x = point.x * scale;
    const y = point.y * scale;
    try {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        logFocusDebug("browser-session", "skip pressed", `${Math.round(x)},${Math.round(y)} at ${zoomPercent}%`);
    }
    catch (e) {
        logFocusDebug("browser-session", "skip failed", String((e as Error)?.message ?? e));
    }
}

export async function requestHeadersFor(url: string): Promise<{ cookie: string; userAgent: string }> {
    let cookie = "";
    let userAgent = "";
    try {
        const result = await send("Network.getCookies", { urls: [url] });
        const cookies: Array<{ name?: string; value?: string }> = Array.isArray(result?.cookies) ? result.cookies : [];
        cookie = cookies
            .filter((row) => typeof row.name === "string" && typeof row.value === "string")
            .map((row) => `${row.name}=${row.value}`)
            .join("; ");
    }
    catch (e) {
        logFocusDebug("browser-download", "cookies failed", String((e as Error)?.message ?? e));
    }
    try {
        const result = await send("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true });
        userAgent = String(result?.result?.value ?? "");
    }
    catch (e) {
        logFocusDebug("browser-download", "user agent failed", String((e as Error)?.message ?? e));
    }
    return { cookie, userAgent };
}

export async function stopLoading(): Promise<void> {
    await send("Page.stopLoading");
}

export function closeSession(): void {
    generation++;
    const live = socket;
    dropSocket();
    downloadHandler = null;
    if (live) {
        try {
            live.close();
        }
        catch {
            return;
        }
    }
}
