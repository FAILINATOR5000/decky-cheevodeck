import { BrowserViewHost } from "./browserViewHost";
import { setActiveSession, ViewSession } from "./browserSession";
import { preparePage } from "./browserScroll";
import { logFocusDebug } from "../../api";

export type LiveView = {
    key: number;
    slot: number;
    tabId: string;
    host: BrowserViewHost;
    session: ViewSession;
    usedAt: number;
};

export type ViewEvents = {
    active: (view: LiveView, showNow: boolean) => void;
    load: (host: BrowserViewHost, url: string, title: string, loading: boolean, finished: boolean) => void;
    loading: (loading: boolean) => void;
    external: (url: string) => void;
    heldFocus: () => void;
    title: (title: string) => void;
    history: (index: number, urls: string[]) => void;
    find: (total: number, current: number) => void;
    bounds: (width: number, height: number) => void;
    background: (view: LiveView) => void;
};

export const DEFAULT_ACTIVE_TABS = 3;

let views: LiveView[] = [];
let active: LiveView | null = null;
let events: ViewEvents | null = null;
let limit = DEFAULT_ACTIVE_TABS;
let nextKey = 1;
let usedClock = 0;
let pageSettings = { zoom: 100, blockAds: true, fastForward: true };

function bind(view: LiveView) {
    const { host, session } = view;
    const mine = () => view === active && events !== null;
    host.setLoadHandler((url, title, loading, finished) => {
        session.ensure(url);
        if (!loading) {
            session.refreshBindings();
        }
        if (mine()) {
            events?.load(host, url, title, loading, finished);
        }
        else if (finished && url && session.targetId) {
            void preparePage(url, pageSettings.zoom, pageSettings.blockAds, pageSettings.fastForward, session.targetId);
        }
    });
    host.setLoadingHandler((loading) => {
        if (mine()) {
            events?.loading(loading);
        }
    });
    host.setExternalUrlHandler((url) => {
        if (mine()) {
            events?.external(url);
        }
    });
    host.setHeldFocusHandler(() => {
        if (mine()) {
            events?.heldFocus();
        }
    });
    host.setTitleHandler((title) => {
        if (mine()) {
            events?.title(title);
        }
        else if (view.tabId) {
            events?.background(view);
        }
    });
    host.setHistoryHandler((index, urls) => {
        if (mine()) {
            events?.history(index, urls);
        }
        else if (view.tabId) {
            events?.background(view);
        }
    });
    host.setFindHandler((total, current) => {
        if (mine()) {
            events?.find(total, current);
        }
    });
    host.setBoundsHandler((width, height) => {
        if (mine()) {
            events?.bounds(width, height);
        }
    });
}

export function setViewEvents(next: ViewEvents | null): void {
    events = next;
}

export function activeView(): LiveView | null {
    return active;
}

export function liveViews(): LiveView[] {
    return views.filter((view) => view.tabId !== "");
}

export function liveViewFor(tabId: string): LiveView | null {
    return views.find((view) => view.tabId === tabId) ?? null;
}

export function viewLimit(): number {
    return limit;
}

export function setViewLimit(value: number): void {
    limit = Math.max(1, Math.round(value) || DEFAULT_ACTIVE_TABS);
}

export function setHiddenPageSettings(zoom: number, blockAds: boolean, fastForward: boolean): void {
    pageSettings = { zoom, blockAds, fastForward };
}

export function refreshHiddenPages(): void {
    for (const view of liveViews()) {
        const url = view.host.currentUrl;
        if (view !== active && url && view.session.targetId) {
            void preparePage(url, pageSettings.zoom, pageSettings.blockAds, pageSettings.fastForward, view.session.targetId);
        }
    }
}

export function createView(tabId: string): LiveView | null {
    const taken = new Set(views.map((view) => view.slot));
    let slot = 0;
    while (taken.has(slot)) {
        slot++;
    }
    const host = new BrowserViewHost();
    if (!host.create(slot)) {
        return null;
    }
    const view: LiveView = { key: nextKey++, slot, tabId, host, session: new ViewSession(), usedAt: 0 };
    bind(view);
    views.push(view);
    logFocusDebug("browser-views", "created", `slot=${slot} live=${views.length}`);
    return view;
}

export function activateView(view: LiveView, showNow: boolean): void {
    view.usedAt = ++usedClock;
    const changed = view !== active;
    active = view;
    setActiveSession(view.session);
    if (changed) {
        events?.active(view, showNow);
    }
}

export function assignView(view: LiveView, tabId: string): void {
    view.tabId = tabId;
}

export function freeViewsNotIn(tabIds: string[]): void {
    const keep = new Set(tabIds);
    for (const view of views) {
        if (view.tabId && !keep.has(view.tabId)) {
            view.tabId = "";
        }
    }
}

export function takeFreeView(): LiveView | null {
    return views.find((view) => view.tabId === "") ?? null;
}

export function destroyView(view: LiveView): void {
    views = views.filter((row) => row !== view);
    if (active === view) {
        active = null;
        setActiveSession(null);
    }
    view.session.close();
    view.host.destroy();
    logFocusDebug("browser-views", "destroyed", `slot=${view.slot} live=${views.length}`);
}

export function destroyFreeViews(): void {
    for (const view of views.filter((row) => row.tabId === "")) {
        destroyView(view);
    }
}

const detachedViews = new Set<LiveView>();

export function detachAllViews(): LiveView[] {
    const detached = views;
    views = [];
    active = null;
    for (const view of detached) {
        detachedViews.add(view);
    }
    return detached;
}

const PAUSE_MEDIA = `(document.querySelectorAll("video, audio").forEach((media) => media.pause()), true)`;

export function silenceViews(detached: LiveView[]): void {
    for (const view of detached) {
        view.session.command("Runtime.evaluate", { expression: PAUSE_MEDIA, returnByValue: true }).catch(() => undefined);
    }
}

export function destroyDetached(detached: LiveView[]): void {
    let count = 0;
    for (const view of detached) {
        if (!detachedViews.delete(view)) {
            continue;
        }
        view.session.close();
        view.host.destroy();
        count++;
    }
    logFocusDebug("browser-views", "destroyed", `closed=${count}`);
}

export function destroyAllViews(): void {
    for (const view of [...views]) {
        destroyView(view);
    }
    destroyDetached([...detachedViews]);
}
