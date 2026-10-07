import { logFocusDebug } from "../../api";
import { AD_SKIP_BINDING, AD_SKIP_SELECTOR, AD_SLOT_EARLY, claimTarget, releaseTarget, setActiveTarget, socketOfTarget, targetForUrl, YOUTUBE_HOST } from "./browserScroll";
import { AD_BLOCK_HOSTS, AD_BLOCK_PATTERNS } from "./adBlockHosts";
import { isAdExempt, replaceAdExemptionHosts } from "./adExemptions";
import { AD_LIBRARY_STAND_IN } from "./adStandIns";
import { FULLSCREEN_BINDING, FULLSCREEN_WATCH } from "./fullscreenWatch";
import { OVERLAY_FIX } from "./overlayFix";

const COMMAND_TIMEOUT_MS = 4000;

const ATTACH_TRIES = 12;

const ATTACH_GAP_MS = 150;

const SKIP_GAP_MS = 1000;

const ISOLATED_WORLD = "cheevodeck";

const FIND_SKIP = `(() => {
    if (document.visibilityState !== "visible") {
        return null;
    }
    for (const button of document.querySelectorAll(${JSON.stringify(AD_SKIP_SELECTOR)})) {
        if (button.offsetParent === null) {
            continue;
        }
        const rect = button.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
    }
    return null;
})()`;

const IN_FULLSCREEN = "document.fullscreenElement !== null";

const GAMEPAD_AGENT = "Valve Steam Gamepad";

const DESKTOP_AGENT = "Valve Steam Client";

const gamepadHosts = new Set<string>();

const GAMEPAD_RELOAD_GAP_MS = 30000;

const GAMEPAD_PAGE = `(() => {
    const root = document.documentElement;
    return root ? { gamepad: root.classList.contains("GamepadMode"), navigating: root.classList.contains("gpnav_active") } : null;
})()`;

function hostOf(url: string): string {
    try {
        return new URL(url).hostname;
    }
    catch {
        return "";
    }
}

function isYouTube(url: string): boolean {
    try {
        return YOUTUBE_HOST.test(new URL(url).hostname);
    }
    catch {
        return false;
    }
}

export type DownloadRequest = {
    url: string;
    suggestedFilename: string;
    posted: boolean;
};

const POSTS_KEPT = 20;

const sessions = new Set<ViewSession>();
let activeSession: ViewSession | null = null;

let blockAds = true;
let fastForward = true;
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
    private mainFrameId = "";
    private committedUrl = "";
    private pendingUrl = "";
    private pendingRequestId = "";
    private blockQueue: Promise<void> = Promise.resolve();
    private steamAgent = "";
    private agentSent: string | null = null;
    private agentQueue: Promise<void> = Promise.resolve();
    private readonly reloadedAt = new Map<string, number>();
    private pendingPost = false;
    private committedPost = false;
    private committedFree = false;
    private pageDpr = 0;
    private metricsSent: string | null = null;
    private skipAt = 0;
    private skipping = false;
    private ready = false;
    private readyWaiters: Array<(ready: boolean) => void> = [];
    private posts: string[] = [];
    private fileChooserHandler: ((backendNodeId: number) => void) | null = null;

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

    command(method: string, params: Record<string, unknown> = {}): Promise<any> {
        return this.send(method, params);
    }

    get connected(): boolean {
        return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
    }

    async evaluate(expression: string): Promise<any> {
        const result = await this.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
            allowUnsafeEvalBlocklistBypass: true
        });
        if (result?.exceptionDetails) {
            throw new Error("cdp-eval-failed");
        }
        return result?.result?.value;
    }

    onFileChooser(handler: ((backendNodeId: number) => void) | null): void {
        this.fileChooserHandler = handler;
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
            void this.pressSkip();
            return;
        }
        if (msg.method === "Page.fileChooserOpened") {
            this.fileChooserHandler?.(Number(msg.params?.backendNodeId));
            return;
        }
        if (msg.method === "Network.requestWillBeSent") {
            if (msg.params?.type === "Document" && String(msg.params?.request?.method ?? "").toUpperCase() === "POST") {
                this.posts = [...this.posts.slice(1 - POSTS_KEPT), String(msg.params?.request?.url ?? "")];
            }
            if (msg.params?.type === "Document" && this.mainFrameId && msg.params?.frameId === this.mainFrameId) {
                this.pendingUrl = String(msg.params?.request?.url ?? "");
                this.pendingRequestId = String(msg.params?.requestId ?? "");
                this.pendingPost = String(msg.params?.request?.method ?? "").toUpperCase() === "POST";
                this.pageChanged();
            }
            return;
        }
        if (msg.method === "Page.frameNavigated") {
            const frame = msg.params?.frame;
            if (frame && !frame.parentId) {
                this.mainFrameId = String(frame.id ?? "") || this.mainFrameId;
                this.committedUrl = String(frame.url ?? "");
                const restored = msg.params?.type === "BackForwardCacheRestore";
                this.committedFree = restored || !!this.agentSent;
                this.committedPost = !restored && this.pendingPost;
                this.pendingPost = false;
                this.pendingUrl = "";
                this.pendingRequestId = "";
                this.pageChanged();
                if (restored) {
                    void this.checkGamepadPage();
                }
            }
            return;
        }
        if (msg.method === "Page.domContentEventFired" || msg.method === "Page.loadEventFired") {
            void this.checkGamepadPage();
            return;
        }
        if (msg.method === "Network.loadingFailed") {
            if (this.pendingRequestId && msg.params?.requestId === this.pendingRequestId) {
                this.dropPending();
            }
            return;
        }
        if (msg.method === "Page.frameStoppedLoading") {
            if (msg.params?.frameId === this.mainFrameId) {
                this.dropPending();
            }
            return;
        }
        if (msg.method === "Page.downloadWillBegin") {
            this.dropPending();
        }
        if (this !== activeSession) {
            return;
        }
        if (msg.method === "Runtime.bindingCalled" && msg.params?.name === FULLSCREEN_BINDING) {
            void this.reportFullscreen(msg.params?.payload === "1");
            return;
        }
        if (msg.method === "Page.downloadWillBegin") {
            const url = String(msg.params?.url ?? "");
            const suggestedFilename = String(msg.params?.suggestedFilename ?? "");
            const posted = this.posts.includes(url);
            logFocusDebug("browser-download", "caught", `${url.slice(0, 80)} name=${suggestedFilename} posted=${posted}`);
            if (url && downloadHandler) {
                downloadHandler({ url, suggestedFilename, posted });
            }
        }
    }

    private dropSocket() {
        this.socket = null;
        this.ready = false;
        this.blockingSent = null;
        this.standInId = null;
        this.mainFrameId = "";
        this.committedUrl = "";
        this.pendingUrl = "";
        this.pendingRequestId = "";
        this.blockQueue = Promise.resolve();
        this.agentSent = null;
        this.agentQueue = Promise.resolve();
        this.pendingPost = false;
        this.committedPost = false;
        this.committedFree = false;
        this.metricsSent = null;
        this.pageDpr = 0;
        for (const entry of this.waiting.values()) {
            window.clearTimeout(entry.timer);
            entry.reject(new Error("session-closed"));
        }
        this.waiting.clear();
    }

    private dropPending() {
        if (!this.pendingUrl) {
            return;
        }
        this.pendingUrl = "";
        this.pendingRequestId = "";
        this.pendingPost = false;
        this.pageChanged();
    }

    private pageChanged() {
        void this.applyBlocking();
        void this.applyUserAgent();
    }

    applyBlocking(): Promise<void> {
        this.blockQueue = this.blockQueue.then(() => this.syncBlocking());
        return this.blockQueue;
    }

    private async syncBlocking() {
        if (!this.socket) {
            return;
        }
        try {
            const wanted = blockAds && !isAdExempt(this.pendingUrl || this.committedUrl);
            if (this.blockingSent !== wanted) {
                await this.send("Network.setBlockedURLs", { urls: wanted ? patterns() : [] });
                this.blockingSent = wanted;
                logFocusDebug("browser-session", "blocking", `${wanted ? patterns().length : 0} patterns ${(this.pendingUrl || this.committedUrl).slice(0, 60)}`);
            }
            await this.applyStandIns(wanted);
        }
        catch (e) {
            this.blockingSent = null;
            logFocusDebug("browser-session", "blocking failed", String((e as Error)?.message ?? e));
        }
    }

    private applyUserAgent(): Promise<void> {
        this.agentQueue = this.agentQueue.then(() => this.syncUserAgent());
        return this.agentQueue;
    }

    private async syncUserAgent() {
        if (!this.socket || !this.steamAgent.includes(GAMEPAD_AGENT)) {
            return;
        }
        const url = this.pendingUrl || this.committedUrl;
        const wanted = gamepadHosts.has(hostOf(url)) ? this.steamAgent.replace(GAMEPAD_AGENT, DESKTOP_AGENT) : "";
        if (this.agentSent === wanted) {
            return;
        }
        try {
            await this.send("Network.setUserAgentOverride", { userAgent: wanted });
            this.agentSent = wanted;
            logFocusDebug("browser-session", "user agent", `${wanted ? "desktop" : "steam"} ${url.slice(0, 60)}`);
        }
        catch (e) {
            this.agentSent = null;
            logFocusDebug("browser-session", "user agent failed", String((e as Error)?.message ?? e));
        }
    }

    private async checkGamepadPage() {
        const url = this.committedUrl;
        const host = hostOf(url);
        const free = this.committedFree;
        const posted = this.committedPost;
        if (!host) {
            return;
        }
        if (!this.steamAgent) {
            await this.readSteamAgent();
        }
        if (!this.steamAgent.includes(GAMEPAD_AGENT)) {
            return;
        }
        let page: { gamepad?: unknown; navigating?: unknown } | null = null;
        try {
            page = (await this.evaluateIsolated(GAMEPAD_PAGE)) as { gamepad?: unknown; navigating?: unknown } | null;
        }
        catch (e) {
            logFocusDebug("browser-session", "gamepad check failed", String((e as Error)?.message ?? e));
            return;
        }
        if (page?.gamepad !== true || url !== this.committedUrl) {
            return;
        }
        const newHost = !gamepadHosts.has(host);
        if (newHost) {
            gamepadHosts.add(host);
            logFocusDebug("browser-session", "gamepad site", host);
        }
        if (free && !newHost && page.navigating !== true) {
            return;
        }
        await this.applyUserAgent();
        const last = this.reloadedAt.get(host) ?? 0;
        if (!this.agentSent || url !== this.committedUrl || this.pendingUrl || posted || Date.now() - last < GAMEPAD_RELOAD_GAP_MS) {
            return;
        }
        this.reloadedAt.set(host, Date.now());
        logFocusDebug("browser-session", "gamepad site reloaded", url.slice(0, 80));
        try {
            await this.send("Page.reload");
        }
        catch (e) {
            logFocusDebug("browser-session", "reload failed", String((e as Error)?.message ?? e));
        }
    }

    recheckGamepadPage(): void {
        if (this.ready) {
            void this.checkGamepadPage();
        }
    }

    private async applyStandIns(wanted: boolean) {
        if (wanted && this.standInId === null) {
            const result = await this.send("Page.addScriptToEvaluateOnNewDocument", { source: `${AD_SLOT_EARLY}\n${AD_LIBRARY_STAND_IN}` });
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
            height: 0,
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
        this.mainFrameId = this.target;
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
            const result = await this.send("Page.getFrameTree");
            const frame = result?.frameTree?.frame;
            if (frame) {
                this.mainFrameId = String(frame.id ?? "") || this.mainFrameId;
                this.committedUrl = String(frame.url ?? "");
            }
            if (this.mainFrameId !== this.target) {
                logFocusDebug("browser-session", "main frame", `${this.mainFrameId} is not the target ${this.target}`);
            }
        }
        catch (e) {
            logFocusDebug("browser-session", "frame tree failed", String((e as Error)?.message ?? e));
        }
        await this.readSteamAgent();
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
        await this.applyUserAgent();
        await this.applyMetrics();
        this.ready = true;
        for (const waiter of this.readyWaiters.splice(0)) {
            waiter(true);
        }
        void this.checkGamepadPage();
    }

    whenAttached(ms: number): Promise<boolean> {
        if (this.ready) {
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            const waiter = (ready: boolean) => {
                window.clearTimeout(timer);
                resolve(ready);
            };
            const timer = window.setTimeout(() => {
                this.readyWaiters = this.readyWaiters.filter((row) => row !== waiter);
                resolve(false);
            }, ms);
            this.readyWaiters.push(waiter);
        });
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

    private async readSteamAgent() {
        if (this.steamAgent) {
            return;
        }
        try {
            this.steamAgent = String((await this.evaluateIsolated("navigator.userAgent")) ?? "");
        }
        catch (e) {
            logFocusDebug("browser-session", "user agent read failed", String((e as Error)?.message ?? e));
        }
    }

    private async evaluateIsolated(expression: string): Promise<unknown> {
        const world = await this.send("Page.createIsolatedWorld", { frameId: this.mainFrameId, worldName: ISOLATED_WORLD });
        const contextId = world?.executionContextId;
        if (typeof contextId !== "number") {
            throw new Error("no isolated world");
        }
        const result = await this.send("Runtime.evaluate", { expression, contextId, returnByValue: true });
        if (result?.exceptionDetails) {
            throw new Error("isolated evaluate failed");
        }
        return result?.result?.value;
    }

    private async reportFullscreen(fullscreen: boolean) {
        if (fullscreen) {
            let real = false;
            try {
                real = (await this.evaluateIsolated(IN_FULLSCREEN)) === true;
            }
            catch (e) {
                logFocusDebug("browser-session", "fullscreen check failed", String((e as Error)?.message ?? e));
            }
            if (!real || this !== activeSession) {
                logFocusDebug("browser-session", "fullscreen refused", this.committedUrl.slice(0, 60));
                return;
            }
        }
        fullscreenHandler?.(fullscreen);
    }

    private async pressSkip() {
        if (!fastForward || !isYouTube(this.committedUrl) || this.skipping || Date.now() - this.skipAt < SKIP_GAP_MS) {
            return;
        }
        this.skipping = true;
        try {
            await this.findAndPressSkip();
        }
        finally {
            this.skipping = false;
            this.skipAt = Date.now();
        }
    }

    private async findAndPressSkip() {
        let point: { x?: unknown; y?: unknown } | null = null;
        try {
            point = (await this.evaluateIsolated(FIND_SKIP)) as { x?: unknown; y?: unknown } | null;
        }
        catch (e) {
            logFocusDebug("browser-session", "skip lookup failed", String((e as Error)?.message ?? e));
            return;
        }
        if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
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
        if (this.steamAgent) {
            return { cookie, userAgent: this.steamAgent };
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
    session?.recheckGamepadPage();
}

export function setAdBlock(enabled: boolean): void {
    blockAds = enabled;
    for (const session of sessions) {
        void session.applyBlocking();
    }
}

export function setFastForward(enabled: boolean): void {
    fastForward = enabled;
}

export function setAdExemptions(hosts: string[]): void {
    replaceAdExemptionHosts(hosts);
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
