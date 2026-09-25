import { logFocusDebug } from "../../api";
import { socketForUrl } from "./browserScroll";
import { AD_BLOCK_HOSTS, AD_BLOCK_PATTERNS } from "./adBlockHosts";

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
let downloadHandler: ((request: DownloadRequest) => void) | null = null;

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
    }
    catch (e) {
        blockingSent = null;
        logFocusDebug("browser-session", "blocking failed", String((e as Error)?.message ?? e));
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
    await applyBlocking();
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

export function setDownloadHandler(handler: ((request: DownloadRequest) => void) | null): void {
    downloadHandler = handler;
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
