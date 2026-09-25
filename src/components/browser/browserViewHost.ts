import { findModuleExport } from "@decky/ui";
import { logFocusDebug } from "../../api";
import { logError } from "../../utils/errors";

const VIEW_NAME = "CheevoDeck Browser";

const CREATE_OPTIONS = { bPreventCloseFromJavascript: true };

const STEAM_EXTERNAL_PREFIX = "steam://openexternalforpid/";

const INPUT_LEVEL_UNKNOWN = 1;
const INPUT_LEVEL_NONE = 2;

const KEYBOARD_BOTTOM_TOLERANCE_PX = 12;

const KEYBOARD_HOLD_MAX_MS = 15000;

const KEYBOARD_RELEASE_GRACE_MS = 750;

const KEYBOARD_MIN_HEIGHT_PX = 80;

const KEYBOARD_MAX_HEIGHT_FRACTION = 0.75;

const KEYBOARD_MIN_WIDTH_FRACTION = 0.5;

const KEYBOARD_FALLBACK_FRACTION = 0.45;

export type BrowserComponents = {
    GamepadHost: any;
    ViewRenderer: any;
};

function srcOf(value: any): string {
    try {
        if (typeof value === "function") return Function.prototype.toString.call(value);
        if (value && typeof value === "object") {
            if (typeof value.type === "function") return Function.prototype.toString.call(value.type);
            if (typeof value.render === "function") return Function.prototype.toString.call(value.render);
        }
    }
    catch {
    }
    return "";
}

let components: BrowserComponents | null | undefined;

export function resolveBrowserComponents(): BrowserComponents | null {
    if (components !== undefined) {
        return components;
    }
    try {
        const host = findModuleExport((e: any) => srcOf(e).includes("SetWebBrowserActionset"));
        const renderer = findModuleExport((e: any) => {
            const source = srcOf(e);
            return source.includes("animateIn") && source.includes("underlay");
        });
        components = host && renderer ? { GamepadHost: host, ViewRenderer: renderer } : null;
    }
    catch (e) {
        logError("resolveBrowserComponents", e);
        components = null;
    }
    return components;
}

function resolveWindowInstance(): SteamWindowInstance | null {
    try {
        const gp = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance;
        if (gp && typeof gp.CreateBrowserView === "function") return gp;
    }
    catch {
    }
    try {
        const map = SteamUIStore?.m_WindowStore?.m_mapDesiredWindowInstances;
        if (map && typeof map.values === "function") {
            for (const inst of map.values()) {
                if (inst && typeof inst.CreateBrowserView === "function") return inst;
            }
        }
    }
    catch {
    }
    return null;
}

function externalUrlFromSteamUrl(value: string): string {
    if (typeof value !== "string" || !value.startsWith(STEAM_EXTERNAL_PREFIX)) {
        return "";
    }
    const rest = value.slice(STEAM_EXTERNAL_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
        return "";
    }
    const url = rest.slice(slash + 1);
    if (url.includes("://")) {
        return url;
    }
    try {
        return decodeURIComponent(url);
    }
    catch {
        return url;
    }
}

function findKeyboardElement(doc: Document, width: number, height: number): Element | null {
    const stack = doc.elementsFromPoint(Math.round(width / 2), height - 4);
    for (const el of stack) {
        const rect = el.getBoundingClientRect();
        if (rect.width < width * KEYBOARD_MIN_WIDTH_FRACTION) continue;
        if (rect.height < KEYBOARD_MIN_HEIGHT_PX) continue;
        if (rect.height > height * KEYBOARD_MAX_HEIGHT_FRACTION) continue;
        if (Math.abs(height - rect.bottom) > KEYBOARD_BOTTOM_TOLERANCE_PX) continue;
        return el;
    }
    return null;
}

export function heightAboveKeyboard(node: HTMLElement | null): number {
    if (!node) {
        return 0;
    }
    const doc = node.ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) {
        return 0;
    }
    try {
        const height = win.innerHeight;
        const keyboard = findKeyboardElement(doc, win.innerWidth, height);
        const top = keyboard
            ? keyboard.getBoundingClientRect().top
            : height * (1 - KEYBOARD_FALLBACK_FRACTION);
        const available = Math.max(0, Math.round(top - node.getBoundingClientRect().top));
        logFocusDebug(
            "browser-osk",
            keyboard ? "found" : "FELL BACK",
            `top=${Math.round(top)} available=${available}`
        );
        return available;
    }
    catch (e) {
        logError("heightAboveKeyboard", e);
        return 0;
    }
}

export function releaseWebBrowserActionset(): void {
    try {
        (SteamClient as any)?.Input?.SetWebBrowserActionset?.(false);
    }
    catch (e) {
        logError("releaseWebBrowserActionset", e);
    }
}

const EDITABLE_INPUT_TYPES = new Set([
    "date", "datetime-local", "datetime", "email", "month", "number",
    "password", "search", "tel", "text", "time", "url", "week"
]);

function isEditableNode(tag: unknown, type: unknown): boolean {
    if (tag === "TEXTAREA") {
        return true;
    }
    return tag === "INPUT" && EDITABLE_INPUT_TYPES.has(String(type));
}

function browsingDataClearer(): (() => unknown) | null {
    const clear = (SteamClient as any)?.Browser?.ClearAllBrowsingData;
    return typeof clear === "function" ? clear : null;
}

export function canClearBrowsingData(): boolean {
    try {
        return browsingDataClearer() !== null;
    }
    catch {
        return false;
    }
}

export function clearBrowsingData(): boolean {
    try {
        const clear = browsingDataClearer();
        if (!clear) {
            return false;
        }
        void Promise.resolve(clear.call((SteamClient as any).Browser)).catch((e) => logError("clearBrowsingData", e));
        return true;
    }
    catch (e) {
        logError("clearBrowsingData", e);
        return false;
    }
}

export function keyboardIsBelow(): boolean {
    try {
        const location = resolveWindowInstance()?.m_VirtualKeyboardManager?.KeyboardLocation;
        return typeof location === "string" && location.endsWith("-bottom");
    }
    catch {
        return false;
    }
}

export function subscribeVirtualKeyboard(onChange: (showing: boolean) => void): () => void {
    const inst = resolveWindowInstance();
    const showing = inst?.m_VirtualKeyboardManager?.IsShowingVirtualKeyboard;
    if (!showing || typeof showing.Subscribe !== "function") {
        return () => undefined;
    }
    let handle: any = null;
    try {
        handle = showing.Subscribe((value: any) => onChange(!!value));
    }
    catch (e) {
        logError("subscribeVirtualKeyboard", e);
        return () => undefined;
    }
    return () => {
        try {
            if (typeof handle === "function") {
                handle();
            }
            else if (typeof handle?.Unsubscribe === "function") {
                handle.Unsubscribe();
            }
        }
        catch (e) {
            logError("unsubscribeVirtualKeyboard", e);
        }
    };
}

const REQUEST_FOCUS_EVENT = "vgp_requestfocus";

export function requestGamepadFocus(node: HTMLElement | null): void {
    const win = node?.ownerDocument?.defaultView as any;
    if (!node || !win) {
        return;
    }
    try {
        node.dispatchEvent(new win.CustomEvent(REQUEST_FOCUS_EVENT, {
            bubbles: true,
            cancelable: true,
            detail: { button: 0 }
        }));
    }
    catch (e) {
        logError("requestGamepadFocus", e);
    }
}

export class BrowserViewHost {
    private wrapper: SteamBrowserWrapper | null = null;
    private rawView: SteamBrowserView | null = null;
    private torndown = false;
    private bounds: { x: number; y: number; width: number; height: number } | null = null;
    private fullscreen = false;
    private keyboardHeld = false;
    private keyboardHold = 0;
    private keyboardHoldTimer: number | null = null;
    private onHeldFocus: (() => void) | null = null;
    private pageFieldFocused = false;
    private pageKeyboardShown = false;

    static isAvailable(): boolean {
        try {
            if (typeof SteamClient === "undefined") return false;
            if (!resolveWindowInstance()) return false;
            return resolveBrowserComponents() !== null;
        }
        catch {
            return false;
        }
    }

    get browser(): SteamBrowserWrapper | null {
        return this.wrapper;
    }

    get view(): SteamBrowserView | null {
        return this.rawView;
    }

    create(): boolean {
        if (this.torndown) return false;
        if (this.wrapper) return true;
        const inst = resolveWindowInstance();
        if (!inst || typeof inst.CreateBrowserView !== "function") {
            return false;
        }
        try {
            const wrapper = inst.CreateBrowserView(VIEW_NAME, CREATE_OPTIONS) as SteamBrowserWrapper;
            const raw = wrapper?.GetBrowser?.();
            if (!wrapper || !raw) {
                return false;
            }
            this.wrapper = wrapper;
            this.rawView = raw;
            this.gatePageKeyboard();
            this.keepPointerThroughLoads();
            return true;
        }
        catch (e) {
            logError("BrowserViewHost.create", e);
            return false;
        }
    }

    loadUrl(url: string): void {
        if (!url) return;
        try {
            this.wrapper?.LoadURL(url);
        }
        catch (e) {
            logError("BrowserViewHost.loadUrl", e);
        }
    }

    endCancelledRequest(): void {
        const wrapper = this.wrapper;
        if (!wrapper || typeof wrapper.OnFinishedRequest !== "function" || !wrapper.m_bLoading) {
            return;
        }
        try {
            wrapper.OnFinishedRequest(String(wrapper.m_URL ?? ""), String(wrapper.m_strTitle ?? ""));
        }
        catch (e) {
            logError("BrowserViewHost.endCancelledRequest", e);
        }
    }

    setExternalUrlHandler(handler: (url: string) => void): void {
        const raw = this.rawView;
        if (!raw || typeof raw.SetSteamURLCallback !== "function") {
            return;
        }
        try {
            raw.SetSteamURLCallback((value: string) => {
                const url = externalUrlFromSteamUrl(String(value || ""));
                if (url) {
                    try {
                        handler(url);
                    }
                    catch (e) {
                        logError("BrowserViewHost.externalUrl", e);
                    }
                }
                return true;
            });
        }
        catch (e) {
            logError("BrowserViewHost.setExternalUrlHandler", e);
        }
    }

    setLoadHandler(handler: (url: string, title: string, loading: boolean, finished: boolean) => void): void {
        const raw = this.rawView;
        if (!raw || typeof raw.on !== "function") {
            return;
        }
        const safely = (url: any, title: any, loading: boolean, finished: boolean) => {
            try {
                handler(String(url || ""), String(title || ""), loading, finished);
            }
            catch (e) {
                logError("BrowserViewHost.load", e);
            }
        };
        try {
            raw.on("finished-request", (url: any, title: any) => safely(url, title, false, true));
            raw.on("start-loading", (url: any, isLoading: any) => safely(url, "", !!isLoading, false));
        }
        catch (e) {
            logError("BrowserViewHost.setLoadHandler", e);
        }
    }

    setNavigationHandler(handler: (url: string) => void): void {
        const callbacks = this.wrapper?.StartRequestCallbacks;
        if (!callbacks || typeof callbacks.Register !== "function") {
            return;
        }
        try {
            callbacks.Register((url: string) => {
                try {
                    handler(String(url || ""));
                }
                catch (e) {
                    logError("BrowserViewHost.navigation", e);
                }
            });
        }
        catch (e) {
            logError("BrowserViewHost.setNavigationHandler", e);
        }
    }

    setLoadingHandler(handler: (loading: boolean) => void): void {
        const wrapper = this.wrapper;
        const started = wrapper?.StartRequestCallbacks;
        const finished = wrapper?.FinishedRequestCallbacks;
        if (typeof started?.Register !== "function" || typeof finished?.Register !== "function") {
            return;
        }
        try {
            started.Register(() => handler(true));
            finished.Register(() => handler(false));
        }
        catch (e) {
            logError("BrowserViewHost.setLoadingHandler", e);
            return;
        }
        handler(!!wrapper?.m_bLoading);
    }

    find(text: string, next: boolean, backwards: boolean): void {
        const raw = this.rawView;
        if (!raw || typeof raw.FindInPage !== "function" || !text) {
            return;
        }
        try {
            raw.FindInPage(text, next, backwards);
        }
        catch (e) {
            logError("BrowserViewHost.find", e);
        }
    }

    stopFind(): void {
        const raw = this.rawView;
        if (!raw || typeof raw.StopFindInPage !== "function") {
            return;
        }
        try {
            raw.StopFindInPage();
        }
        catch (e) {
            logError("BrowserViewHost.stopFind", e);
        }
    }

    setFindHandler(handler: (total: number, current: number) => void): void {
        const raw = this.rawView;
        if (!raw || typeof raw.on !== "function") {
            return;
        }
        try {
            raw.on("find-in-page-results", (total: any, current: any) => {
                try {
                    handler(Number(total) || 0, Number(current) || 0);
                }
                catch (e) {
                    logError("BrowserViewHost.findResults", e);
                }
            });
        }
        catch (e) {
            logError("BrowserViewHost.setFindHandler", e);
        }
    }

    setHistoryHandler(handler: (index: number, urls: string[]) => void): void {
        const raw = this.rawView;
        if (!raw || typeof raw.on !== "function") {
            return;
        }
        try {
            raw.on("history-changed", (history: any) => {
                try {
                    const entries = Array.isArray(history?.entries) ? history.entries : [];
                    handler(Number(history?.index) || 0, entries.map((entry: any) => String(entry?.url || "")));
                }
                catch (e) {
                    logError("BrowserViewHost.history", e);
                }
            });
        }
        catch (e) {
            logError("BrowserViewHost.setHistoryHandler", e);
        }
    }

    setTitleHandler(handler: (title: string) => void): void {
        const raw = this.rawView;
        if (!raw || typeof raw.on !== "function") {
            return;
        }
        try {
            raw.on("set-title", (...args: any[]) => {
                const title = args.find((value) => typeof value === "string" && value);
                if (title) {
                    handler(title);
                }
            });
        }
        catch (e) {
            logError("BrowserViewHost.setTitleHandler", e);
        }
    }

    syncBounds(placeholder: HTMLElement | null): void {
        const raw = this.rawView;
        if (!raw || !placeholder || typeof raw.SetBounds !== "function" || this.fullscreen) {
            return;
        }
        const rect = placeholder.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }
        const last = this.bounds;
        if (last && last.x === rect.x && last.y === rect.y && last.width === rect.width && last.height === rect.height) {
            return;
        }
        this.bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        try {
            raw.SetBounds(rect.x, rect.y, rect.width, rect.height);
        }
        catch (e) {
            logError("BrowserViewHost.syncBounds", e);
        }
    }

    setPageFullscreen(fullscreen: boolean, win: Window | null): void {
        const raw = this.rawView;
        if (!raw || typeof raw.SetBounds !== "function") {
            return;
        }
        if (!fullscreen) {
            this.fullscreen = false;
            this.bounds = null;
            return;
        }
        const width = win?.visualViewport?.width ?? win?.innerWidth ?? 0;
        const height = win?.visualViewport?.height ?? win?.innerHeight ?? 0;
        if (width <= 0 || height <= 0) {
            return;
        }
        this.fullscreen = true;
        try {
            raw.SetBounds(0, 0, width, height);
        }
        catch (e) {
            logError("BrowserViewHost.setPageFullscreen", e);
        }
    }

    private keepPointerThroughLoads(): void {
        const bridge = this.wrapper?.m_gamepadBridge;
        const steam = bridge?.SetGameInputSupportLevel;
        if (typeof steam !== "function") {
            return;
        }
        bridge.SetGameInputSupportLevel = (level: number, source: string) => {
            if (level === INPUT_LEVEL_UNKNOWN && (source === "OnStartRequest" || source === "LoadURL")) {
                logFocusDebug("browser-pointer", "kept", source);
                return steam.call(bridge, INPUT_LEVEL_NONE, source);
            }
            return steam.call(bridge, level, source);
        };
    }

    private gatePageKeyboard(): void {
        const raw = this.rawView;
        const wrapper = this.wrapper;
        const steam = wrapper?.OnNodeHasFocus;
        if (!raw || typeof raw.on !== "function" || typeof raw.off !== "function" || typeof steam !== "function") {
            return;
        }
        const gate = (...args: any[]) => {
            const editable = isEditableNode(args[1], args[2]);
            this.pageFieldFocused = editable;
            if (editable) {
                if (this.keyboardHeld) {
                    logFocusDebug("browser-osk", "held", `node=${String(args[1] ?? "")}`);
                    return;
                }
                this.pageKeyboardShown = true;
                steam.apply(wrapper, args);
                return;
            }
            if (!this.pageKeyboardShown) {
                return;
            }
            this.pageKeyboardShown = false;
            steam.apply(wrapper, args);
        };
        try {
            raw.off("node-has-focus", steam);
        }
        catch (e) {
            logError("BrowserViewHost.gatePageKeyboard", e);
            return;
        }
        try {
            raw.on("node-has-focus", gate);
        }
        catch (e) {
            logError("BrowserViewHost.gatePageKeyboard", e);
            raw.on("node-has-focus", steam);
        }
    }

    holdPageKeyboard(): number {
        this.keyboardHeld = true;
        this.keyboardHold += 1;
        const token = this.keyboardHold;
        if (this.keyboardHoldTimer !== null) {
            window.clearTimeout(this.keyboardHoldTimer);
        }
        this.keyboardHoldTimer = window.setTimeout(() => this.releasePageKeyboard(token), KEYBOARD_HOLD_MAX_MS);
        return token;
    }

    get pageKeyboardHold(): number {
        return this.keyboardHold;
    }

    setHeldFocusHandler(handler: () => void): void {
        this.onHeldFocus = handler;
    }

    noteKeyboardClosed(): void {
        this.pageKeyboardShown = false;
    }

    releasePageKeyboard(token: number): void {
        if (token !== this.keyboardHold) {
            return;
        }
        if (this.keyboardHoldTimer !== null) {
            window.clearTimeout(this.keyboardHoldTimer);
        }
        this.keyboardHoldTimer = window.setTimeout(() => {
            this.keyboardHoldTimer = null;
            if (token === this.keyboardHold) {
                this.keyboardHeld = false;
                if (this.pageFieldFocused) {
                    this.onHeldFocus?.();
                }
            }
        }, KEYBOARD_RELEASE_GRACE_MS);
    }

    destroy(): void {
        if (this.keyboardHoldTimer !== null) {
            window.clearTimeout(this.keyboardHoldTimer);
            this.keyboardHoldTimer = null;
        }
        const wrapper = this.wrapper;
        this.wrapper = null;
        this.rawView = null;
        this.bounds = null;
        this.torndown = true;
        if (!wrapper) return;
        try {
            wrapper.Destroy?.();
        }
        catch (e) {
            logError("BrowserViewHost.destroy", e);
        }
    }
}
