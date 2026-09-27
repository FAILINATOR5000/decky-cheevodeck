import { logFocusDebug } from "../../api";
import { AD_SKIP_BINDING, claimTarget, releaseTarget, setActiveTarget, socketOfTarget, targetForUrl } from "./browserScroll";
import { AD_BLOCK_HOSTS, AD_BLOCK_PATTERNS } from "./adBlockHosts";
import { AD_LIBRARY_STAND_IN } from "./adStandIns";
import { FULLSCREEN_BINDING, FULLSCREEN_WATCH } from "./fullscreenWatch";
import { OVERLAY_FIX } from "./overlayFix";

const COMMAND_TIMEOUT_MS = 4000;

const ATTACH_TRIES = 12;

const ATTACH_GAP_MS = 150;

export type DownloadRequest = {
    url: string;
    suggestedFilename: string;
};

const sessions = new Set<ViewSession>();
let activeSession: ViewSession | null = null;

let blockAds = true;
let downloadHandler: ((request: DownloadRequest) => void) | null = null;
let fullscreenHandler: ((fullscreen: boolean) => void) | null = null;

let zoomPercent = 100;
let viewSize: { width: number; height: number } | null = null;
let windowDpr = 1;

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

export class ViewSession {
    private socket: WebSocket | null = null;
    private attaching = false;
    private wantedUrl = "";
    private target = "";
    private generation = 0;
    private closed = false;
    private nextId = 1;
    private readonly waiting = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: number }>();
    private blockingSent: boolean | null = null;
    private standInId: string | null = null;
    private pageDpr = 0;
    private metricsSent: string | null = null;

    constructor() {
        sessions.add(this);
    }

    get targetId(): string {
        return this.target;
    }

    private send(method: string, params: Record<string, unknown> = {}): Promise<any> {
        const live = this.socket;
        if (!live || live.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error("session-closed"));
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.waiting.delete(id);
                reject(new Error(`session-timeout ${method}`));
            }, COMMAND_TIMEOUT_MS);
            this.waiting.set(id, { resolve, reject, timer });
            live.send(JSON.stringify({ id, method, params }));
        });
    }

    private onMessage(ev: MessageEvent) {
        let msg: any;
        try {
            msg = JSON.parse(String(ev.data));
        }
        catch {
            return;
        }
        if (typeof msg.id === "number") {
            const entry = this.waiting.get(msg.id);
            if (!entry) {
                return;
            }
            this.waiting.delete(msg.id);
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
            void this.pressSkip(String(msg.params?.payload ?? ""));
            return;
        }
        if (this !== activeSession) {
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

    private dropSocket() {
        this.socket = null;
        this.blockingSent = null;
        this.standInId = null;
        this.metricsSent = null;
        this.pageDpr = 0;
        for (const entry of this.waiting.values()) {
            window.clearTimeout(entry.timer);
            entry.reject(new Error("session-closed"));
        }
        this.waiting.clear();
    }

    async applyBlocking() {
        if (!this.socket) {
            return;
        }
        const wanted = blockAds;
        if (this.blockingSent === wanted) {
            return;
        }
        this.blockingSent = wanted;
        try {
            await this.send("Network.setBlockedURLs", { urls: wanted ? patterns() : [] });
            logFocusDebug("browser-session", "blocking", `${wanted ? patterns().length : 0} patterns`);
            await this.applyStandIns(wanted);
        }
        catch (e) {
            this.blockingSent = null;
            logFocusDebug("browser-session", "blocking failed", String((e as Error)?.message ?? e));
        }
    }

    private async applyStandIns(wanted: boolean) {
        if (wanted && this.standInId === null) {
            const result = await this.send("Page.addScriptToEvaluateOnNewDocument", { source: AD_LIBRARY_STAND_IN });
            this.standInId = String(result?.identifier ?? "") || null;
        }
        else if (!wanted && this.standInId !== null) {
            const identifier = this.standInId;
            this.standInId = null;
            await this.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
        }
    }

    async applyMetrics() {
        if (!this.socket || !viewSize || viewSize.width <= 0 || viewSize.height <= 0) {
            return;
        }
        if (this.pageDpr <= 0) {
            try {
                const result = await this.send("Runtime.evaluate", { expression: "devicePixelRatio", returnByValue: true });
                this.pageDpr = Number(result?.result?.value) || 0;
            }
            catch (e) {
                logFocusDebug("browser-session", "pixel ratio failed", String((e as Error)?.message ?? e));
            }
            if (this.pageDpr <= 0) {
                this.pageDpr = windowDpr;
            }
        }
        const z = zoomPercent / 100;
        const toPage = windowDpr / this.pageDpr;
        const metrics = zoomPercent >= 100 ? null : {
            width: Math.round(viewSize.width * toPage / z),
            height: Math.round(viewSize.height * toPage / z),
            deviceScaleFactor: 0,
            mobile: false,
            scale: z
        };
        const key = metrics ? `${metrics.width}x${metrics.height}@${metrics.scale}` : "clear";
        if (this.metricsSent === key) {
            return;
        }
        this.metricsSent = key;
        try {
            if (metrics) {
                await this.send("Emulation.setDeviceMetricsOverride", metrics);
            }
            else {
                await this.send("Emulation.clearDeviceMetricsOverride");
            }
            logFocusDebug("browser-session", "zoom", `${zoomPercent}% ${key} dpr=${windowDpr}/${this.pageDpr}`);
        }
        catch (e) {
            this.metricsSent = null;
            logFocusDebug("browser-session", "zoom failed", String((e as Error)?.message ?? e));
        }
    }

    private async attached() {
        try {
            await this.send("Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
        }
        catch (e) {
            logFocusDebug("browser-session", "network failed", String((e as Error)?.message ?? e));
        }
        try {
            await this.send("Page.enable");
            await this.send("Page.setDownloadBehavior", { behavior: "deny" });
        }
        catch (e) {
            logFocusDebug("browser-session", "downloads failed", String((e as Error)?.message ?? e));
        }
        try {
            await this.send("Runtime.addBinding", { name: FULLSCREEN_BINDING });
            await this.send("Runtime.addBinding", { name: AD_SKIP_BINDING });
            await this.send("Page.addScriptToEvaluateOnNewDocument", { source: FULLSCREEN_WATCH });
            await this.send("Runtime.evaluate", { expression: FULLSCREEN_WATCH });
        }
        catch (e) {
            logFocusDebug("browser-session", "fullscreen watch failed", String((e as Error)?.message ?? e));
        }
        try {
            await this.send("Page.addScriptToEvaluateOnNewDocument", { source: OVERLAY_FIX });
            await this.send("Runtime.evaluate", { expression: OVERLAY_FIX });
        }
        catch (e) {
            logFocusDebug("browser-session", "overlay fix failed", String((e as Error)?.message ?? e));
        }
        await this.applyBlocking();
        await this.applyMetrics();
    }

    ensure(url: string): void {
        if (this.socket || this.closed || (!url && !this.target)) {
            return;
        }
        this.wantedUrl = url;
        if (this.attaching) {
            return;
        }
        this.attaching = true;
        const started = this.generation;
        (async () => {
            let wsUrl: string | null = null;
            for (let attempt = 0; attempt < ATTACH_TRIES && !wsUrl && started === this.generation; attempt++) {
                if (attempt > 0) {
                    await new Promise((resolve) => window.setTimeout(resolve, ATTACH_GAP_MS));
                }
                if (this.target) {
                    wsUrl = await socketOfTarget(this.target);
                    continue;
                }
                const found = await targetForUrl(this.wantedUrl);
                if (found && started === this.generation && !this.target) {
                    this.target = found.id;
                    claimTarget(found.id);
                    if (this === activeSession) {
                        setActiveTarget(found.id);
                    }
                    wsUrl = found.socket;
                }
            }
            if (!wsUrl || started !== this.generation) {
                logFocusDebug("browser-session", "no target", this.wantedUrl.slice(0, 60));
                return;
            }
            const socketUrl = wsUrl;
            await new Promise<void>((resolve) => {
                let live: WebSocket;
                try {
                    live = new WebSocket(socketUrl);
                }
                catch {
                    resolve();
                    return;
                }
                live.onopen = () => {
                    if (started !== this.generation) {
                        live.close();
                        resolve();
                        return;
                    }
                    this.socket = live;
                    logFocusDebug("browser-session", "attached", this.wantedUrl.slice(0, 60));
                    void this.attached();
                    resolve();
                };
                live.onmessage = (ev) => this.onMessage(ev);
                live.onerror = () => resolve();
                live.onclose = () => {
                    if (this.socket === live) {
                        this.dropSocket();
                        logFocusDebug("browser-session", "detached", "");
                    }
                    resolve();
                };
            });
        })().finally(() => {
            this.attaching = false;
        });
    }

    refreshBindings(): void {
        if (!this.socket) {
            return;
        }
        for (const name of [FULLSCREEN_BINDING, AD_SKIP_BINDING]) {
            this.send("Runtime.addBinding", { name }).catch((e) => {
                logFocusDebug("browser-session", "binding failed", `${name} ${String((e as Error)?.message ?? e)}`);
            });
        }
    }

    private async pressSkip(payload: string) {
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
            await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
            await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
            await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
            logFocusDebug("browser-session", "skip pressed", `${Math.round(x)},${Math.round(y)} at ${zoomPercent}%`);
        }
        catch (e) {
            logFocusDebug("browser-session", "skip failed", String((e as Error)?.message ?? e));
        }
    }

    async requestHeaders(url: string): Promise<{ cookie: string; userAgent: string }> {
        let cookie = "";
        let userAgent = "";
        try {
            const result = await this.send("Network.getCookies", { urls: [url] });
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
            const result = await this.send("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true });
            userAgent = String(result?.result?.value ?? "");
        }
        catch (e) {
            logFocusDebug("browser-download", "user agent failed", String((e as Error)?.message ?? e));
        }
        return { cookie, userAgent };
    }

    async stopLoading(): Promise<void> {
        await this.send("Page.stopLoading");
    }

    close(): void {
        this.closed = true;
        this.generation++;
        sessions.delete(this);
        if (activeSession === this) {
            activeSession = null;
        }
        if (this.target) {
            releaseTarget(this.target);
            this.target = "";
        }
        const live = this.socket;
        this.dropSocket();
        if (live) {
            try {
                live.close();
            }
            catch {
                return;
            }
        }
    }
}

export function setActiveSession(session: ViewSession | null): void {
    activeSession = session;
    setActiveTarget(session?.targetId ?? "");
}

export function setAdBlock(enabled: boolean): void {
    blockAds = enabled;
    for (const session of sessions) {
        void session.applyBlocking();
    }
}

export function setZoomPercent(percent: number): void {
    zoomPercent = percent;
    for (const session of sessions) {
        void session.applyMetrics();
    }
}

export function setViewSize(width: number, height: number, dpr: number): void {
    viewSize = { width, height };
    if (dpr > 0) {
        windowDpr = dpr;
    }
    for (const session of sessions) {
        void session.applyMetrics();
    }
}

export function setDownloadHandler(handler: ((request: DownloadRequest) => void) | null): void {
    downloadHandler = handler;
}

export function setFullscreenHandler(handler: ((fullscreen: boolean) => void) | null): void {
    fullscreenHandler = handler;
}

export async function requestHeadersFor(url: string): Promise<{ cookie: string; userAgent: string }> {
    return activeSession ? activeSession.requestHeaders(url) : { cookie: "", userAgent: "" };
}

export async function stopLoading(): Promise<void> {
    if (!activeSession) {
        throw new Error("session-closed");
    }
    await activeSession.stopLoading();
}
