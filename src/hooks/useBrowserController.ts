import { useCallback, useEffect, useRef, useState } from "react";
import {
    addBrowserAdExemption,
    addBrowserBookmark,
    addBrowserBookmarkCategory,
    addBrowserHistoryEntry,
    addBrowserTab,
    clearBrowserHistory,
    getBrowserAdExemptions,
    getBrowserBookmarks,
    getBrowserHistory,
    removeBrowserAdExemption,
    removeBrowserBookmark,
    removeBrowserBookmarkCategory,
    renameBrowserBookmark,
    removeBrowserHistoryEntry,
    renameBrowserBookmarkCategory,
    setBrowserCategoryCollapsed,
    setDefaultBrowserBookmarkCategory,
    closeAllBrowserTabs,
    closeBrowserTab,
    getBrowserTabs,
    navigateBrowserTab,
    setActiveBrowserTab,
    replaceBrowserTabEntry,
    setBrowserTabHistoryIndex,
    setBrowserPanelTab,
    setBrowserTabScroll,
    setBrowserTabTitle
} from "../api";
import { applyPageZoom, blurPageField, captureScroll, isPlayingSound, lastCaptureMiss, PAGE_KEPT_PLACE, pausePlayingMedia, preparePage, restoreScroll, restoreScrollEarly, restoreToken, ScrollPlace } from "../components/browser/browserScroll";
import {
    activateView,
    activeView,
    assignView,
    closingDone,
    createView,
    DEFAULT_ACTIVE_TABS,
    destroyFreeViews,
    destroyView,
    freeViewsNotIn,
    liveViewFor,
    liveViews,
    refreshHiddenPages,
    setHiddenPageSettings,
    setViewLimit,
    takeFreeView,
    viewLimit,
    type LiveView
} from "../components/browser/browserViews";
import {
    loadBrowserSettings,
    logFocusDebug,
    resetBrowserSettings,
    saveBrowserCustomNewTabUrl,
    saveBrowserCustomSearchUrl,
    saveBrowserExpanded,
    saveBrowserHistoryRetention,
    saveBrowserNewTabPage,
    saveBrowserBlockAds,
    saveBrowserDownloadFolder,
    saveBrowserRememberDownloadFolder,
    saveBrowserFastForwardYouTubeAds,
    saveBrowserFastForwardPrerollAds,
    saveBrowserActiveTabs,
    saveBrowserMaxDownloads,
    saveBrowserPauseMediaOnTabSwitch,
    saveBrowserOpenLinksInNewTab,
    saveBrowserPageZoom,
    saveBrowserSearchEngine,
    startBrowserDownload
} from "../api";
import { requestHeadersFor, setAdBlock, setAdExemptions, setFastForward, setZoomPercent, type DownloadRequest } from "../components/browser/browserSession";
import { exemptEntryFor, siteOf } from "../components/browser/adExemptions";
import { downloadFailure, toastDownload } from "../components/browser/browserDownloads";
import {
    DEFAULT_BROWSER_MAX_DOWNLOADS,
    defaultBrowserPageZoom,
    nextBrowserActiveTabs,
    nextBrowserHistoryRetention,
    nextBrowserMaxDownloads,
    nextBrowserNewTabPage,
    nextBrowserSearchEngine,
    stepBrowserPageZoom
} from "../utils/options";
import { logError } from "../utils/errors";
import type {
    BrowserAdExemptionsResponse,
    BrowserBookmark,
    BrowserBookmarkCategory,
    BrowserBookmarksResponse,
    BrowserHistoryEntry,
    BrowserHistoryRetention,
    BrowserNewTabPage,
    BrowserPanelTab,
    BrowserSearchEngine,
    BrowserSettingsResponse,
    BrowserTab
} from "../types";

export const BROWSER_HOME_URL = "https://retroachievements.org/";

export const DEFAULT_BOOKMARK_CATEGORY_ID = "cat_default";

const DEFAULT_MAX_TABS = 100;

const DEFAULT_MAX_AD_EXEMPTIONS = 500;

const SEARCH_URLS: Record<string, string> = {
    google: "https://www.google.com/search?q=%s",
    brave: "https://search.brave.com/search?q=%s",
    duckduckgo: "https://duckduckgo.com/?q=%s",
    youtube: "https://www.youtube.com/results?search_query=%s",
    retroachievements: "https://retroachievements.org/search?query=%s"
};

const NEW_TAB_URLS: Record<string, string> = {
    google: "https://www.google.com/",
    brave: "https://search.brave.com/",
    duckduckgo: "https://duckduckgo.com/",
    retroachievements: BROWSER_HOME_URL
};

const BARE_HOST = /^[^\s/?#]+\.[a-z]{2,}(?:[:/?#]|$)/i;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

const CHALLENGE_PARAM = /[?&]__cf_chl/i;

const RESTORE_DEADLINE_MS = 6000;

const EARLY_RESTORE_STEP_MS = 120;

const RESIZE_RESTORE_DELAY_MS = 250;

const VIEW_HISTORY_WAIT_MS = 400;

const CLOSE_CAPTURE_MS = 1000;


function within<T>(work: Promise<T>, ms: number | undefined, fallback: T): Promise<T> {
    if (ms === undefined) {
        return work;
    }
    return Promise.race([work, new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), ms))]);
}

function isChallengeUrl(url: string): boolean {
    return CHALLENGE_PARAM.test(url);
}

function withoutChallenge(url: string): string {
    return url.split(/[?&]__cf_chl/i)[0];
}

function searchTemplateFor(engine: BrowserSearchEngine, custom: string): string {
    if (engine === "custom" && custom) {
        return custom;
    }
    return SEARCH_URLS[engine] ?? SEARCH_URLS.google;
}

function newTabUrlFor(page: BrowserNewTabPage, custom: string): string {
    if (page === "custom" && custom) {
        return custom;
    }
    return NEW_TAB_URLS[page] ?? NEW_TAB_URLS.google;
}

function searchUrl(template: string, words: string): string {
    return template.split("%s").join(encodeURIComponent(words));
}

function addressToUrl(text: string, searchTemplate: string): string {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return "";
    }
    if (SCHEME.test(trimmed)) {
        return trimmed;
    }
    if (BARE_HOST.test(trimmed)) {
        return `https://${trimmed}`;
    }
    return searchUrl(searchTemplate, trimmed);
}

function fileNameOf(url: string): string {
    try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    }
    catch {
        return "";
    }
}

type PendingDownload = {
    url: string;
    name: string;
    referer: string;
    origin: string;
};

function typedToUrl(text: string): string {
    const trimmed = String(text || "").trim();
    if (!trimmed || SCHEME.test(trimmed)) {
        return trimmed;
    }
    return `https://${trimmed}`;
}

export type BrowserController = {
    tabs: BrowserTab[];
    activeTab: BrowserTab | null;
    address: string;
    addressDirty: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    loaded: boolean;
    setAddress: (value: string) => void;
    submitAddress: () => void;
    openAddress: (url: string) => void;
    openTab: (url: string) => void;
    closeTab: (tabId: string) => void;
    selectTab: (tabId: string) => void;
    goBack: () => void;
    goForward: () => void;
    reload: () => void;
    noteLoaded: (url: string, title: string, finished: boolean) => Promise<unknown>;
    noteTitle: (title: string) => void;
    noteViewHistory: (index: number, urls: string[]) => void;
    blurPage: () => void;
    bookmarks: BrowserBookmark[];
    categories: BrowserBookmarkCategory[];
    defaultCategoryId: string;
    collapsedCategoryIds: string[];
    maxCategories: number;
    history: BrowserHistoryEntry[];
    currentIsBookmarked: boolean;
    toggleBookmark: () => void;
    removeBookmark: (bookmarkId: string) => void;
    renameBookmark: (bookmarkId: string, title: string) => void;
    addCategory: (name: string) => void;
    renameCategory: (categoryId: string, name: string) => void;
    removeCategory: (categoryId: string) => void;
    makeDefaultCategory: (categoryId: string) => void;
    setCategoryCollapsed: (categoryId: string, collapsed: boolean) => void;
    bookmarkLimit: number;
    clearBookmarkLimit: () => void;
    removeHistoryEntry: (entryId: string) => void;
    wipeHistory: (days: number) => void;
    refreshLists: () => void;
    atTabLimit: boolean;
    maxTabs: number;
    blockedUrl: string;
    resolveTabLimit: (choice: "evict" | "cancel") => void;
    closeAllTabs: () => void;
    rememberPlaces: (views: LiveView[], shown: LiveView | null) => Promise<void>;
    noteBackgroundPage: (view: LiveView) => void;
    noteLeaving: () => void;
    pageZoom: number;
    stepZoom: (direction: number) => void;
    historyRetention: BrowserHistoryRetention;
    cycleHistoryRetention: () => void;
    searchEngine: BrowserSearchEngine;
    cycleSearchEngine: () => void;
    newTabPage: BrowserNewTabPage;
    customNewTabUrl: string;
    cycleNewTabPage: () => void;
    setCustomNewTabUrl: (text: string) => void;
    customSearchUrl: string;
    setCustomSearchUrl: (text: string) => void;
    openLinksInNewTab: boolean;
    toggleOpenLinksInNewTab: () => void;
    blockAds: boolean;
    toggleBlockAds: () => void;
    fastForwardYouTubeAds: boolean;
    toggleFastForwardYouTubeAds: () => void;
    fastForwardPrerollAds: boolean;
    toggleFastForwardPrerollAds: () => void;
    resetOptions: () => void;
    adExemptions: string[];
    maxAdExemptions: number;
    adExemptionsFull: boolean;
    currentSite: string;
    currentExemption: string;
    toggleCurrentExemption: () => void;
    removeAdExemption: (host: string) => void;
    activeTabs: number;
    cycleActiveTabs: () => void;
    pauseMediaOnTabSwitch: boolean;
    togglePauseMediaOnTabSwitch: () => void;
    maxDownloads: number;
    cycleMaxDownloads: () => void;
    downloadFolder: string;
    setDownloadFolder: (path: string) => void;
    rememberDownloadFolder: boolean;
    toggleRememberDownloadFolder: () => void;
    pendingDownload: PendingDownload | null;
    noteDownload: (request: DownloadRequest) => void;
    downloadTo: (folder: string, fileName: string) => void;
    cancelDownload: () => void;
    expanded: boolean;
    toggleExpanded: () => void;
    openNewTab: () => void;
    openExternalLink: (url: string) => void;
    panelTab: BrowserPanelTab;
    setPanelTab: (panelTab: BrowserPanelTab) => void;
};

let lastShown: { tabs: BrowserTab[]; activeTabId: string; expanded: boolean } = { tabs: [], activeTabId: "", expanded: true };

export function useBrowserController(onLoadUrl: (url: string) => void, startUrl = ""): BrowserController {
    const [resumed] = useState(() => activeView() !== null);
    const [tabs, setTabs] = useState<BrowserTab[]>(() => (resumed ? lastShown.tabs : []));
    const [activeTabId, setActiveTabId] = useState(() => (resumed ? lastShown.activeTabId : ""));
    const [address, setAddress] = useState("");
    const [loaded, setLoaded] = useState(false);
    const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>([]);
    const [categories, setCategories] = useState<BrowserBookmarkCategory[]>([]);
    const [defaultCategoryId, setDefaultCategoryId] = useState("");
    const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<string[]>([]);
    const [maxCategories, setMaxCategories] = useState(0);
    const [bookmarkLimit, setBookmarkLimit] = useState(0);
    const [history, setHistory] = useState<BrowserHistoryEntry[]>([]);
    const [blockedUrl, setBlockedUrl] = useState("");
    const [pageZoom, setPageZoom] = useState(defaultBrowserPageZoom);
    const [historyRetention, setHistoryRetention] = useState<BrowserHistoryRetention>("forever");
    const [searchEngine, setSearchEngine] = useState<BrowserSearchEngine>("google");
    const [newTabPage, setNewTabPage] = useState<BrowserNewTabPage>("google");
    const [customNewTabUrl, setCustomNewTabUrlState] = useState("");
    const [customSearchUrl, setCustomSearchUrlState] = useState("");
    const [openLinksInNewTab, setOpenLinksInNewTab] = useState(true);
    const [blockAds, setBlockAds] = useState(true);
    const [fastForwardYouTubeAds, setFastForwardYouTubeAds] = useState(true);
    const [fastForwardPrerollAds, setFastForwardPrerollAds] = useState(false);
    const [adExemptions, setAdExemptionList] = useState<string[]>([]);
    const [maxAdExemptions, setMaxAdExemptions] = useState(DEFAULT_MAX_AD_EXEMPTIONS);
    const [adExemptionsFull, setAdExemptionsFull] = useState(false);
    const [activeTabs, setActiveTabs] = useState(DEFAULT_ACTIVE_TABS);
    const [pauseMediaOnTabSwitch, setPauseMediaOnTabSwitch] = useState(false);
    const [maxDownloads, setMaxDownloads] = useState(DEFAULT_BROWSER_MAX_DOWNLOADS);
    const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(null);
    const [downloadFolder, setDownloadFolderState] = useState("");
    const [rememberDownloadFolder, setRememberDownloadFolder] = useState(false);
    const [expanded, setExpanded] = useState(() => (resumed ? lastShown.expanded : true));
    const [panelTab, setPanelTabState] = useState<BrowserPanelTab>("bookmarks");
    const [maxTabs, setMaxTabs] = useState(DEFAULT_MAX_TABS);

    const drivenUrlRef = useRef("");
    const drivingRef = useRef(false);
    const requestedUrlRef = useRef("");
    const liveTitleRef = useRef("");
    const leftTitleRef = useRef("");
    const historyUrlRef = useRef("");
    const liveUrlRef = useRef("");
    const activeTabIdRef = useRef("");
    activeTabIdRef.current = activeTabId;
    const tabsRef = useRef<BrowserTab[]>([]);
    tabsRef.current = tabs;

    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

    const apply = useCallback((state: { tabs: BrowserTab[]; activeTabId: string; maxTabs?: number }) => {
        tabsRef.current = state.tabs;
        activeTabIdRef.current = state.activeTabId;
        freeViewsNotIn(state.tabs.map((tab) => tab.id));
        setTabs(state.tabs);
        lastShown = { ...lastShown, tabs: state.tabs, activeTabId: state.activeTabId };
        setActiveTabId(state.activeTabId);
        if (typeof state.maxTabs === "number" && state.maxTabs > 0) {
            setMaxTabs(state.maxTabs);
        }
        return state;
    }, []);

    const zoomRef = useRef(pageZoom);
    zoomRef.current = pageZoom;
    const blockAdsRef = useRef(blockAds);
    blockAdsRef.current = blockAds;
    const fastForwardRef = useRef(fastForwardYouTubeAds);
    fastForwardRef.current = fastForwardYouTubeAds;
    const prerollRef = useRef(fastForwardPrerollAds);
    prerollRef.current = fastForwardPrerollAds;

    const settle = useCallback((url: string): Promise<unknown> => {
        if (!url) return Promise.resolve();
        return preparePage(url, zoomRef.current, blockAdsRef.current, fastForwardRef.current, prerollRef.current, undefined, activeView()?.session);
    }, []);

    const pendingRestoreRef = useRef<{ url: string; place: ScrollPlace; token: string } | null>(null);
    const restoreTimerRef = useRef<number | null>(null);

    const endRestore = useCallback(() => {
        if (restoreTimerRef.current !== null) {
            window.clearTimeout(restoreTimerRef.current);
            restoreTimerRef.current = null;
        }
        pendingRestoreRef.current = null;
    }, []);

    const queueRestore = useCallback((url: string, place: ScrollPlace) => {
        if (!url || place.offset < 0) {
            return;
        }
        if (restoreTimerRef.current !== null) {
            window.clearTimeout(restoreTimerRef.current);
        }
        const pending = { url, place, token: restoreToken() };
        const session = activeView()?.session ?? null;
        pendingRestoreRef.current = pending;
        restoreTimerRef.current = window.setTimeout(endRestore, RESTORE_DEADLINE_MS);
        (async () => {
            while (pendingRestoreRef.current === pending) {
                const outcome = await restoreScrollEarly(url, place, pending.token, session);
                if (pendingRestoreRef.current !== pending) {
                    return;
                }
                if (outcome.state === "user") {
                    logFocusDebug("browser-show", "early restore", "the reader scrolled");
                    endRestore();
                    return;
                }
                if (outcome.state === "held") {
                    logFocusDebug("browser-show", "early restore", `offset=${place.offset} by=${outcome.by}`);
                    if (!place.anchor) {
                        endRestore();
                    }
                    return;
                }
                await new Promise((resolve) => window.setTimeout(resolve, EARLY_RESTORE_STEP_MS));
            }
        })();
    }, [endRestore]);

    useEffect(() => endRestore, [endRestore]);


    const stepZoom = useCallback((direction: number) => {
        const nextValue = stepBrowserPageZoom(zoomRef.current, direction);
        if (nextValue === zoomRef.current) return;
        setPageZoom(nextValue);
        setZoomPercent(nextValue);
        const url = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)?.url ?? "";
        if (url) {
            void applyPageZoom(url, nextValue, activeView()?.session);
        }
        void saveBrowserPageZoom(nextValue).catch((e) => logError("useBrowserController.stepZoom", e));
    }, []);

    const retentionRef = useRef<BrowserHistoryRetention>("forever");
    retentionRef.current = historyRetention;

    const searchEngineRef = useRef(searchEngine);
    searchEngineRef.current = searchEngine;
    const newTabPageRef = useRef(newTabPage);
    newTabPageRef.current = newTabPage;
    const openLinksRef = useRef(openLinksInNewTab);
    openLinksRef.current = openLinksInNewTab;
    const expandedRef = useRef(expanded);
    expandedRef.current = expanded;
    const searchTemplateRef = useRef("");
    searchTemplateRef.current = searchTemplateFor(searchEngine, customSearchUrl);
    const newTabUrlRef = useRef("");
    newTabUrlRef.current = newTabUrlFor(newTabPage, customNewTabUrl);

    const disposedRef = useRef(false);
    useEffect(() => () => {
        disposedRef.current = true;
    }, []);

    const tabQueueRef = useRef<Promise<void>>(Promise.resolve());
    const queueTabAction = useCallback((label: string, action: () => Promise<void>) => {
        tabQueueRef.current = tabQueueRef.current.then(async () => {
            if (disposedRef.current) {
                return;
            }
            try {
                await action();
            }
            catch (e) {
                logError(`useBrowserController.${label}`, e);
            }
        });
    }, []);

    const applySettings = useCallback((saved: BrowserSettingsResponse | null | undefined) => {
        if (!saved) {
            return;
        }
        if (typeof saved.pageZoom === "number") {
            setPageZoom(saved.pageZoom);
            zoomRef.current = saved.pageZoom;
            setZoomPercent(saved.pageZoom);
        }
        if (saved.historyRetention) {
            setHistoryRetention(saved.historyRetention);
        }
        if (saved.searchEngine) {
            setSearchEngine(saved.searchEngine);
        }
        if (saved.newTabPage) {
            setNewTabPage(saved.newTabPage);
        }
        setCustomNewTabUrlState(saved.customNewTabUrl ?? "");
        setCustomSearchUrlState(saved.customSearchUrl ?? "");
        setOpenLinksInNewTab(saved.openLinksInNewTab !== false);
        setBlockAds(saved.blockAds !== false);
        blockAdsRef.current = saved.blockAds !== false;
        setAdBlock(saved.blockAds !== false);
        setFastForwardYouTubeAds(saved.fastForwardYouTubeAds !== false);
        fastForwardRef.current = saved.fastForwardYouTubeAds !== false;
        setFastForward(saved.fastForwardYouTubeAds !== false);
        setFastForwardPrerollAds(saved.fastForwardPrerollAds === true);
        prerollRef.current = saved.fastForwardPrerollAds === true;
        setDownloadFolderState(saved.downloadFolder ?? "");
        setRememberDownloadFolder(saved.rememberDownloadFolder === true);
        setExpanded(saved.expanded !== false);
        lastShown = { ...lastShown, expanded: saved.expanded !== false };
        const tabsLive = typeof saved.activeTabs === "number" ? saved.activeTabs : DEFAULT_ACTIVE_TABS;
        activeTabsRef.current = tabsLive;
        setActiveTabs(tabsLive);
        setViewLimit(tabsLive);
        queueTabAction("trimViews", () => trimViewsRef.current());
        pauseOnSwitchRef.current = saved.pauseMediaOnTabSwitch === true;
        setPauseMediaOnTabSwitch(saved.pauseMediaOnTabSwitch === true);
        const downloadsLive = typeof saved.maxDownloads === "number" ? saved.maxDownloads : DEFAULT_BROWSER_MAX_DOWNLOADS;
        maxDownloadsRef.current = downloadsLive;
        setMaxDownloads(downloadsLive);
    }, [queueTabAction]);

    const saveSetting = useCallback((label: string, save: () => Promise<BrowserSettingsResponse>) => {
        (async () => {
            try {
                applySettings(await save());
            }
            catch (e) {
                logError(`useBrowserController.${label}`, e);
            }
        })();
    }, [applySettings]);

    const cycleSearchEngine = useCallback(() => {
        const nextValue = nextBrowserSearchEngine(searchEngineRef.current);
        setSearchEngine(nextValue);
        saveSetting("cycleSearchEngine", () => saveBrowserSearchEngine(nextValue));
    }, [saveSetting]);


    const cycleNewTabPage = useCallback(() => {
        const nextValue = nextBrowserNewTabPage(newTabPageRef.current);
        setNewTabPage(nextValue);
        saveSetting("cycleNewTabPage", () => saveBrowserNewTabPage(nextValue));
    }, [saveSetting]);

    const setCustomNewTabUrl = useCallback((text: string) => {
        const url = typedToUrl(text);
        saveSetting("setCustomNewTabUrl", () => saveBrowserCustomNewTabUrl(url));
    }, [saveSetting]);

    const setCustomSearchUrl = useCallback((text: string) => {
        const url = typedToUrl(text);
        saveSetting("setCustomSearchUrl", () => saveBrowserCustomSearchUrl(url));
    }, [saveSetting]);

    const toggleExpanded = useCallback(() => {
        const nextValue = !expandedRef.current;
        const live = liveUrlRef.current;
        (async () => {
            try {
                const place = live ? await captureScroll(live, undefined, activeView()?.session) : null;
                setExpanded(nextValue);
                lastShown = { ...lastShown, expanded: nextValue };
                saveSetting("toggleExpanded", () => saveBrowserExpanded(nextValue));
                if (place && place.offset > 0) {
                    await new Promise((resolve) => window.setTimeout(resolve, RESIZE_RESTORE_DELAY_MS));
                    const by = await restoreScroll(live, place, undefined, activeView()?.session);
                    logFocusDebug("browser-expand", nextValue ? "expanded" : "shrunk", `restore=${by ?? "failed"}`);
                }
            }
            catch (e) {
                logError("useBrowserController.toggleExpanded", e);
            }
        })();
    }, [saveSetting]);

    const toggleOpenLinksInNewTab = useCallback(() => {
        const nextValue = !openLinksRef.current;
        setOpenLinksInNewTab(nextValue);
        saveSetting("toggleOpenLinksInNewTab", () => saveBrowserOpenLinksInNewTab(nextValue));
    }, [saveSetting]);

    const toggleBlockAds = useCallback(() => {
        const nextValue = !blockAdsRef.current;
        blockAdsRef.current = nextValue;
        setBlockAds(nextValue);
        setAdBlock(nextValue);
        void settle(liveUrlRef.current);
        saveSetting("toggleBlockAds", () => saveBrowserBlockAds(nextValue));
    }, [saveSetting, settle]);

    const activeTabsRef = useRef(DEFAULT_ACTIVE_TABS);
    const pauseOnSwitchRef = useRef(false);
    const trimViewsRef = useRef<() => Promise<void>>(async () => undefined);

    const cycleActiveTabs = useCallback(() => {
        const nextValue = nextBrowserActiveTabs(activeTabsRef.current);
        activeTabsRef.current = nextValue;
        setActiveTabs(nextValue);
        setViewLimit(nextValue);
        queueTabAction("trimViews", () => trimViewsRef.current());
        saveSetting("cycleActiveTabs", () => saveBrowserActiveTabs(nextValue));
    }, [queueTabAction, saveSetting]);

    const maxDownloadsRef = useRef(DEFAULT_BROWSER_MAX_DOWNLOADS);

    const cycleMaxDownloads = useCallback(() => {
        const nextValue = nextBrowserMaxDownloads(maxDownloadsRef.current);
        maxDownloadsRef.current = nextValue;
        setMaxDownloads(nextValue);
        saveSetting("cycleMaxDownloads", () => saveBrowserMaxDownloads(nextValue));
    }, [saveSetting]);

    const togglePauseMediaOnTabSwitch = useCallback(() => {
        const nextValue = !pauseOnSwitchRef.current;
        pauseOnSwitchRef.current = nextValue;
        setPauseMediaOnTabSwitch(nextValue);
        saveSetting("togglePauseMediaOnTabSwitch", () => saveBrowserPauseMediaOnTabSwitch(nextValue));
    }, [saveSetting]);

    useEffect(() => {
        setHiddenPageSettings(pageZoom, blockAds, fastForwardYouTubeAds, fastForwardPrerollAds);
        refreshHiddenPages();
    }, [pageZoom, blockAds, fastForwardYouTubeAds, fastForwardPrerollAds]);

    const toggleFastForwardYouTubeAds = useCallback(() => {
        const nextValue = !fastForwardRef.current;
        fastForwardRef.current = nextValue;
        setFastForwardYouTubeAds(nextValue);
        setFastForward(nextValue);
        void settle(liveUrlRef.current);
        saveSetting("toggleFastForwardYouTubeAds", () => saveBrowserFastForwardYouTubeAds(nextValue));
    }, [saveSetting, settle]);

    const toggleFastForwardPrerollAds = useCallback(() => {
        const nextValue = !prerollRef.current;
        prerollRef.current = nextValue;
        setFastForwardPrerollAds(nextValue);
        void settle(liveUrlRef.current);
        saveSetting("toggleFastForwardPrerollAds", () => saveBrowserFastForwardPrerollAds(nextValue));
    }, [saveSetting, settle]);

    const resetOptions = useCallback(() => {
        (async () => {
            try {
                applySettings(await resetBrowserSettings());
                void settle(liveUrlRef.current);
            }
            catch (e) {
                logError("useBrowserController.resetOptions", e);
            }
        })();
    }, [applySettings, settle]);

    const applyExemptions = useCallback((state: BrowserAdExemptionsResponse) => {
        const hosts = Array.isArray(state.hosts) ? state.hosts : [];
        setAdExemptions(hosts);
        setAdExemptionList(hosts);
        if (typeof state.maxHosts === "number" && state.maxHosts > 0) {
            setMaxAdExemptions(state.maxHosts);
        }
        setAdExemptionsFull(state.reason === "exemptionLimit");
        void settle(liveUrlRef.current);
        refreshHiddenPages();
    }, [settle]);

    const setDownloadFolder = useCallback((path: string) => {
        setDownloadFolderState(path);
        saveSetting("setDownloadFolder", () => saveBrowserDownloadFolder(path));
    }, [saveSetting]);

    const rememberFolderRef = useRef(rememberDownloadFolder);
    rememberFolderRef.current = rememberDownloadFolder;

    const toggleRememberDownloadFolder = useCallback(() => {
        const nextValue = !rememberFolderRef.current;
        setRememberDownloadFolder(nextValue);
        saveSetting("toggleRememberDownloadFolder", () => saveBrowserRememberDownloadFolder(nextValue));
    }, [saveSetting]);

    const pendingDownloadRef = useRef<PendingDownload | null>(null);
    const noteDownload = useCallback((request: DownloadRequest) => {
        if (pendingDownloadRef.current) {
            return;
        }
        if (request.url.startsWith("blob:") || request.posted) {
            toastDownload("Download Failed", downloadFailure("unsupported"));
            return;
        }
        const held = {
            url: request.url,
            name: request.suggestedFilename || fileNameOf(request.url) || "download",
            referer: liveUrlRef.current,
            origin: request.origin
        };
        pendingDownloadRef.current = held;
        setPendingDownload(held);
    }, []);

    const cancelDownload = useCallback(() => {
        pendingDownloadRef.current = null;
        setPendingDownload(null);
    }, []);

    const downloadTo = useCallback((folder: string, fileName: string) => {
        const held = pendingDownloadRef.current;
        pendingDownloadRef.current = null;
        setPendingDownload(null);
        if (!held) {
            return;
        }
        (async () => {
            try {
                const { cookie, userAgent } = await requestHeadersFor(held.url);
                const chosen = fileName && fileName !== held.name ? fileName : "";
                const started = await startBrowserDownload(held.url, folder, held.name, cookie, userAgent, held.referer, chosen, held.origin);
                logFocusDebug("browser-download", started?.ok ? "started" : "refused", String(started?.error ?? started?.id ?? ""));
                const title = !started?.ok ? "Download Failed" : started.queued ? "Queued" : "Downloading";
                toastDownload(title, chosen || held.name, started?.ok ? "" : String(started?.error ?? ""));
            }
            catch (e) {
                logError("useBrowserController.downloadTo", e);
                toastDownload("Download Failed", held.name);
            }
        })();
    }, []);

    const cycleHistoryRetention = useCallback(() => {
        const nextValue = nextBrowserHistoryRetention(retentionRef.current);
        setHistoryRetention(nextValue);
        (async () => {
            try {
                const saved = await saveBrowserHistoryRetention(nextValue);
                setHistoryRetention(saved.historyRetention);
                setHistory((await getBrowserHistory()).entries);
            }
            catch (e) {
                logError("useBrowserController.cycleHistoryRetention", e);
            }
        })();
    }, []);

    const setPanelTab = useCallback((wanted: BrowserPanelTab) => {
        setPanelTabState(wanted);
        (async () => {
            try {
                await setBrowserPanelTab(wanted);
            }
            catch (e) {
                logError("useBrowserController.setPanelTab", e);
            }
        })();
    }, []);

    const drive = useCallback((url: string) => {
        if (!url) return;
        drivingRef.current = true;
        requestedUrlRef.current = url;
        drivenUrlRef.current = url;
        setAddress(url);
        onLoadUrl(url);
    }, [onLoadUrl]);

    const showTab = useCallback((tab: { url: string; scroll: number; anchor: string }) => {
        const live = liveUrlRef.current;
        const samePage = live !== "" && withoutChallenge(live) === withoutChallenge(tab.url);
        logFocusDebug("browser-show", tab.url.slice(0, 60), `scroll=${tab.scroll} samePage=${samePage}`);
        if (!samePage) {
            drive(tab.url);
            if (tab.scroll > 0 || tab.anchor === PAGE_KEPT_PLACE) {
                queueRestore(tab.url, { offset: tab.scroll, anchor: tab.anchor });
            }
            return;
        }
        drivenUrlRef.current = tab.url;
        setAddress(tab.url);
        void restoreScroll(live, { offset: Math.max(0, tab.scroll), anchor: tab.anchor }, undefined, activeView()?.session)
            .then((by) => logFocusDebug("browser-show", "same-page restore", by ?? "failed"))
            .catch((e) => logError("useBrowserController.showTab", e));
    }, [drive, queueRestore]);

    const followActiveView = useCallback(() => {
        const host = activeView()?.host;
        const url = host?.currentUrl ?? "";
        endRestore();
        drivingRef.current = false;
        requestedUrlRef.current = "";
        drivenUrlRef.current = url;
        liveUrlRef.current = url;
        liveTitleRef.current = host?.currentTitle ?? "";
        leftTitleRef.current = "";
        viewHistoryRef.current = null;
        viewIndexRef.current = -1;
        viewChangeRef.current = null;
        pendingPushRef.current = null;
        return url;
    }, [endRestore]);

    const syncTabToView = useCallback(async (view: LiveView) => {
        const tab = tabsRef.current.find((row) => row.id === view.tabId);
        const url = view.host.currentUrl;
        if (!tab || !url || isChallengeUrl(url) || withoutChallenge(url) === withoutChallenge(tab.url)) {
            return;
        }
        apply(await navigateBrowserTab(tab.id, url, view.host.currentTitle));
    }, [apply]);

    const noteBackgroundPage = useCallback((view: LiveView) => {
        const tab = tabsRef.current.find((row) => row.id === view.tabId);
        const title = view.host.currentTitle;
        if (!tab) {
            return;
        }
        (async () => {
            try {
                const url = view.host.currentUrl;
                if (url && !isChallengeUrl(url) && withoutChallenge(url) !== withoutChallenge(tab.url)) {
                    apply(await navigateBrowserTab(tab.id, url, title));
                    return;
                }
                if (title && title !== tab.title) {
                    apply(await setBrowserTabTitle(tab.id, title));
                }
            }
            catch (e) {
                logError("useBrowserController.noteBackgroundPage", e);
            }
        })();
    }, [apply]);

    const retireView = useCallback(async (view: LiveView, deadlineMs?: number) => {
        const tab = tabsRef.current.find((row) => row.id === view.tabId);
        const url = view.host.currentUrl || tab?.url || "";
        if (!tab || !url || !view.session.targetId) {
            return;
        }
        try {
            const place = await within(captureScroll(url, view.session.targetId, view.session), deadlineMs, null);
            if (place !== null) {
                await setBrowserTabScroll(tab.id, place.offset, place.anchor);
            }
            await syncTabToView(view);
        }
        catch (e) {
            logError("useBrowserController.retireView", e);
        }
    }, [syncTabToView]);

    const pickVictim = useCallback(async (keepActive: boolean, mayGrow: boolean) => {
        const current = activeView();
        const candidates = liveViews()
            .filter((view) => !keepActive || view !== current)
            .sort((a, b) => a.usedAt - b.usedAt);
        if (viewLimit() > 1) {
            for (const view of candidates) {
                if (!(await isPlayingSound(view.session.targetId, view.session))) {
                    return view;
                }
            }
            if (mayGrow) {
                return null;
            }
        }
        return candidates[0] ?? null;
    }, []);

    const trimViews = useCallback(async () => {
        for (;;) {
            const excess = liveViews().length - viewLimit();
            if (excess <= 0) {
                return;
            }
            const victim = await pickVictim(true, excess === 1);
            if (!victim) {
                return;
            }
            await retireView(victim);
            destroyView(victim);
        }
    }, [pickVictim, retireView]);
    trimViewsRef.current = trimViews;

    const bringUpView = useCallback(async (tabId: string): Promise<"live" | "fresh" | null> => {
        const live = liveViewFor(tabId);
        if (live) {
            activateView(live, true);
            destroyFreeViews();
            return "live";
        }
        let view = takeFreeView();
        if (!view && liveViews().length >= viewLimit()) {
            view = await pickVictim(false, liveViews().length < viewLimit() + 1);
            if (view) {
                await retireView(view);
            }
            if (disposedRef.current) {
                return null;
            }
        }
        if (view) {
            assignView(view, tabId);
        }
        else {
            view = createView(tabId);
        }
        if (!view) {
            return null;
        }
        const wanted = tabsRef.current.find((tab) => tab.id === tabId)?.url ?? "";
        const showing = view.host.currentUrl;
        activateView(view, !!showing && withoutChallenge(showing) === withoutChallenge(wanted));
        destroyFreeViews();
        return "fresh";
    }, [pickVictim, retireView]);

    const leaveActiveView = useCallback(async () => {
        const session = activeView()?.session;
        if (pauseOnSwitchRef.current && session?.targetId) {
            await pausePlayingMedia(session.targetId, session);
        }
    }, []);

    const showTabInView = useCallback(async (tab: BrowserTab) => {
        const mode = await bringUpView(tab.id);
        if (disposedRef.current) {
            return;
        }
        followActiveView();
        if (mode === "live") {
            const view = activeView();
            if (view) {
                await syncTabToView(view);
            }
            setAddress(liveUrlRef.current || tab.url);
            return;
        }
        showTab(tab);
    }, [bringUpView, followActiveView, showTab, syncTabToView]);

    useEffect(() => {
        let cancelled = false;
        tabQueueRef.current = tabQueueRef.current.then(async () => {
            try {
                await closingDone();
                const settingsLoad = loadBrowserSettings()
                    .then((saved) => {
                        if (!cancelled) {
                            applySettings(saved);
                        }
                        return saved;
                    })
                    .catch((e) => {
                        logError("useBrowserController.settings", e);
                        return null;
                    });
                const exemptionsLoad = getBrowserAdExemptions().catch((e) => {
                    logError("useBrowserController.adExemptions", e);
                    return null;
                });
                const [loadedTabs, exemptions] = await Promise.all([getBrowserTabs(true), exemptionsLoad]);
                if (exemptions) {
                    applyExemptions(exemptions);
                }
                let state = loadedTabs;
                setPanelTabState(state.panelTab);
                let blocked = "";
                if (startUrl) {
                    const added = await addBrowserTab(startUrl, "", false);
                    if (added.ok) {
                        state = added;
                    }
                    else {
                        blocked = startUrl;
                    }
                }
                else if (!state.tabs.length) {
                    const saved = await settingsLoad;
                    const home = saved ? newTabUrlFor(saved.newTabPage, saved.customNewTabUrl) : BROWSER_HOME_URL;
                    state = await addBrowserTab(home, "", false);
                }
                if (cancelled) return;
                apply(state);
                const current = state.tabs.find((tab) => tab.id === state.activeTabId);
                const mode = current ? await bringUpView(current.id) : null;
                if (cancelled) return;
                followActiveView();
                if (mode === "live" && current) {
                    const view = activeView();
                    if (view) {
                        await syncTabToView(view);
                    }
                    setAddress(liveUrlRef.current || current.url);
                    setLoaded(true);
                    setBlockedUrl(blocked);
                    return;
                }
                drive(current?.url || startUrl || BROWSER_HOME_URL);
                setLoaded(true);
                setBlockedUrl(blocked);
                if (current?.url && (current.scroll > 0 || current.anchor === PAGE_KEPT_PLACE)) {
                    queueRestore(current.url, { offset: current.scroll, anchor: current.anchor });
                }
            }
            catch (e) {
                logError("useBrowserController.load", e);
                if (!cancelled) {
                    drive(startUrl || BROWSER_HOME_URL);
                    setLoaded(true);
                }
            }
        });
        return () => {
            cancelled = true;
        };
    }, [apply, applyExemptions, applySettings, bringUpView, drive, followActiveView, queueRestore, startUrl, syncTabToView]);

    const openTab = useCallback((url: string) => {
        const target = url || BROWSER_HOME_URL;
        if (isChallengeUrl(target)) {
            drive(target);
            return;
        }
        queueTabAction("openTab", async () => {
            const state = await addBrowserTab(target, "", false);
            if (disposedRef.current) {
                return;
            }
            if (!state.ok) {
                setBlockedUrl(target);
                return;
            }
            await leaveActiveView();
            if (disposedRef.current) {
                return;
            }
            apply(state);
            await bringUpView(state.activeTabId);
            if (disposedRef.current) {
                return;
            }
            followActiveView();
            drive(target);
        });
    }, [apply, bringUpView, drive, followActiveView, leaveActiveView, queueTabAction]);

    const resolveTabLimit = useCallback((choice: "evict" | "cancel") => {
        const target = blockedUrl;
        setBlockedUrl("");
        if (choice !== "evict" || !target) {
            return;
        }
        queueTabAction("resolveTabLimit", async () => {
            const state = await addBrowserTab(target, "", true);
            if (disposedRef.current || !state.ok) {
                return;
            }
            await leaveActiveView();
            if (disposedRef.current) {
                return;
            }
            apply(state);
            await bringUpView(state.activeTabId);
            if (disposedRef.current) {
                return;
            }
            followActiveView();
            drive(target);
        });
    }, [apply, blockedUrl, bringUpView, drive, followActiveView, leaveActiveView, queueTabAction]);

    const closeTab = useCallback((tabId: string) => {
        queueTabAction("closeTab", async () => {
            const wasActive = tabId === activeTabIdRef.current;
            const closed = await closeBrowserTab(tabId);
            if (disposedRef.current) {
                return;
            }
            const state = apply(closed);
            if (!wasActive) {
                destroyFreeViews();
                return;
            }
            const current = state.tabs.find((tab) => tab.id === state.activeTabId);
            if (current) {
                await showTabInView(current);
            }
        });
    }, [apply, queueTabAction, showTabInView]);

    const rememberPlace = useCallback(async (deadlineMs?: number, session = activeView()?.session) => {
        const tab = tabsRef.current.find((row) => row.id === activeTabIdRef.current);
        if (!tab?.url) {
            return;
        }
        try {
            const place = await within(captureScroll(liveUrlRef.current || tab.url, undefined, session), deadlineMs, null);
            if (place === null) {
                return;
            }
            await setBrowserTabScroll(tab.id, place.offset, place.anchor);
        }
        catch (e) {
            logError("useBrowserController.rememberPlace", e);
        }
    }, []);

    const rememberPlaces = useCallback(async (views: LiveView[], shown: LiveView | null) => {
        await Promise.all([
            rememberPlace(CLOSE_CAPTURE_MS, shown?.session),
            ...views.filter((view) => view !== shown && view.tabId).map((view) => retireView(view, CLOSE_CAPTURE_MS))
        ]);
    }, [rememberPlace, retireView]);

    const closeAllTabs = useCallback(() => {
        queueTabAction("closeAllTabs", async () => {
            await closeAllBrowserTabs();
            const home = newTabUrlRef.current;
            const added = await addBrowserTab(home, "", false);
            if (disposedRef.current) {
                return;
            }
            const state = apply(added);
            const current = state.tabs.find((tab) => tab.id === state.activeTabId);
            if (current) {
                await bringUpView(current.id);
                if (disposedRef.current) {
                    return;
                }
                followActiveView();
            }
            drive(current?.url || home);
        });
    }, [apply, bringUpView, drive, followActiveView, queueTabAction]);

    const selectTab = useCallback((tabId: string) => {
        if (tabId === activeTabIdRef.current) return;
        queueTabAction("selectTab", async () => {
            if (tabId === activeTabIdRef.current) {
                return;
            }
            const outgoing = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
            if (outgoing?.url) {
                const place = await captureScroll(liveUrlRef.current || outgoing.url, undefined, activeView()?.session);
                logFocusDebug("browser-capture", outgoing.id, `offset=${place?.offset} anchored=${!!place?.anchor}`);
                if (place !== null) {
                    await setBrowserTabScroll(outgoing.id, place.offset, place.anchor);
                }
            }
            if (disposedRef.current) {
                return;
            }
            await leaveActiveView();
            const switched = await setActiveBrowserTab(tabId);
            if (disposedRef.current) {
                return;
            }
            const state = apply(switched);
            const current = state.tabs.find((tab) => tab.id === state.activeTabId);
            if (!current) {
                return;
            }
            await showTabInView(current);
        });
    }, [apply, leaveActiveView, queueTabAction, showTabInView]);

    const step = useCallback((delta: number) => {
        const tab = tabs.find((row) => row.id === activeTabIdRef.current);
        if (!tab) return;
        const target = tab.historyIndex + delta;
        if (target < 0 || target >= tab.history.length) return;
        (async () => {
            try {
                await rememberPlace();
                const state = apply(await setBrowserTabHistoryIndex(tab.id, target));
                const current = state.tabs.find((row) => row.id === tab.id);
                if (current) {
                    showTab(current);
                }
            }
            catch (e) {
                logError("useBrowserController.step", e);
            }
        })();
    }, [apply, rememberPlace, showTab, tabs]);

    const goBack = useCallback(() => step(-1), [step]);
    const goForward = useCallback(() => step(1), [step]);

    const reload = useCallback(() => {
        const tab = tabs.find((row) => row.id === activeTabIdRef.current);
        const url = tab?.url || BROWSER_HOME_URL;
        (async () => {
            try {
                const place = await captureScroll(liveUrlRef.current || url, undefined, activeView()?.session);
                logFocusDebug("browser-reload", url.slice(0, 60), `offset=${place?.offset} anchored=${!!place?.anchor}`);
                drive(url);
                if (place !== null && place.offset > 0) {
                    queueRestore(url, place);
                    if (tab) {
                        apply(await setBrowserTabScroll(tab.id, place.offset, place.anchor));
                    }
                }
            }
            catch (e) {
                logError("useBrowserController.reload", e);
            }
        })();
    }, [apply, drive, queueRestore, tabs]);

    const submitAddress = useCallback(() => {
        const url = addressToUrl(address, searchTemplateRef.current);
        if (!url) return;
        const tabId = activeTabIdRef.current;
        if (!tabId) {
            openTab(url);
            return;
        }
        (async () => {
            try {
                await rememberPlace();
                apply(await navigateBrowserTab(tabId, url, ""));
                drive(url);
                await addBrowserHistoryEntry(url, "");
                historyUrlRef.current = url;
            }
            catch (e) {
                logError("useBrowserController.submitAddress", e);
            }
        })();
    }, [address, apply, drive, openTab, rememberPlace]);

    const openAddress = useCallback((url: string) => {
        if (!url) return;
        const tabId = activeTabIdRef.current;
        if (!tabId) {
            openTab(url);
            return;
        }
        (async () => {
            try {
                await rememberPlace();
                apply(await navigateBrowserTab(tabId, url, ""));
                drive(url);
                await addBrowserHistoryEntry(url, "");
                historyUrlRef.current = url;
            }
            catch (e) {
                logError("useBrowserController.openAddress", e);
            }
        })();
    }, [apply, drive, openTab, rememberPlace]);

    const blurPage = useCallback(() => {
        void blurPageField(liveUrlRef.current, activeView()?.session);
    }, []);

    const openNewTab = useCallback(() => openTab(newTabUrlRef.current), [openTab]);

    const openExternalLink = useCallback((url: string) => {
        if (openLinksRef.current || isChallengeUrl(url)) {
            openTab(url);
            return;
        }
        openAddress(url);
    }, [openAddress, openTab]);

    const noteLeaving = useCallback(() => {
        const live = liveUrlRef.current;
        if (drivingRef.current) {
            return;
        }
        requestedUrlRef.current = "";
        viewChangeRef.current = null;
        if (!live) {
            return;
        }
        const tab = tabsRef.current.find((row) => row.id === activeTabIdRef.current);
        const entry = tab ? tab.history[tab.historyIndex] : "";
        if (!tab || !entry || withoutChallenge(entry) !== withoutChallenge(live)) {
            return;
        }
        (async () => {
            try {
                const place = await captureScroll(live, undefined, activeView()?.session);
                logFocusDebug("browser-capture", "leaving", place ? `offset=${place.offset} anchored=${!!place.anchor}` : `missed, page keeps it: ${lastCaptureMiss}`);
                await setBrowserTabScroll(tab.id, place?.offset ?? 0, place?.anchor ?? PAGE_KEPT_PLACE, entry);
            }
            catch (e) {
                logError("useBrowserController.noteLeaving", e);
            }
        })();
    }, []);

    const viewChangeRef = useRef<{ url: string; replaced: boolean } | null>(null);
    const viewWaitersRef = useRef<Array<(change: { url: string; replaced: boolean }) => boolean>>([]);
    const pendingPushRef = useRef<{ url: string; title: string } | null>(null);

    const viewChangeFor = (url: string) => new Promise<boolean>((resolve) => {
        const last = viewChangeRef.current;
        if (last && last.url === url) {
            resolve(last.replaced);
            return;
        }
        let settled = false;
        const waiter = (change: { url: string; replaced: boolean }) => {
            if (settled || change.url !== url) {
                return false;
            }
            settled = true;
            resolve(change.replaced);
            return true;
        };
        viewWaitersRef.current.push(waiter);
        window.setTimeout(() => {
            viewWaitersRef.current = viewWaitersRef.current.filter((row) => row !== waiter);
            if (!settled) {
                settled = true;
                resolve(false);
            }
        }, VIEW_HISTORY_WAIT_MS);
    });

    const noteLoaded = useCallback((url: string, title: string, finished: boolean): Promise<unknown> => {
        const requested = requestedUrlRef.current;
        if (requested && url
            && withoutChallenge(url) === withoutChallenge(liveUrlRef.current)
            && withoutChallenge(url) !== withoutChallenge(requested)) {
            logFocusDebug("browser-stale", url.slice(0, 60), `wanted ${requested.slice(0, 60)}`);
            return Promise.resolve();
        }
        drivingRef.current = false;
        if (finished) {
            requestedUrlRef.current = "";
        }
        const tabId = activeTabIdRef.current;
        if (!tabId || !url || isChallengeUrl(url)) {
            return Promise.resolve();
        }
        const tab = tabsRef.current.find((row) => row.id === tabId);
        const isNew = withoutChallenge(tab?.url ?? "") !== withoutChallenge(url);
        const redirected = isNew && !!requested && !!tab?.url;
        if (redirected && !finished) {
            requestedUrlRef.current = url;
        }
        if (withoutChallenge(liveUrlRef.current) !== withoutChallenge(url)) {
            leftTitleRef.current = liveTitleRef.current;
            liveTitleRef.current = "";
        }
        const fresh = title && title !== leftTitleRef.current ? title : "";
        if (fresh) {
            liveTitleRef.current = fresh;
        }
        drivenUrlRef.current = url;
        liveUrlRef.current = url;
        setAddress(url);
        const settled = settle(url);
        const pending = pendingRestoreRef.current;
        if (finished && pending && withoutChallenge(pending.url) === withoutChallenge(url)) {
            pendingRestoreRef.current = null;
            void restoreScroll(url, pending.place, pending.token, activeView()?.session)
                .then((by) => logFocusDebug("browser-show", "load-finished restore", by ?? "failed"))
                .finally(endRestore);
        }
        (async () => {
            try {
                if (redirected && tab) {
                    logFocusDebug("browser-redirect", tab.url.slice(0, 60), url.slice(0, 60));
                    apply(await replaceBrowserTabEntry(tabId, tab.url, url));
                    if (historyUrlRef.current === tab.url) {
                        historyUrlRef.current = url;
                    }
                    if (fresh) {
                        apply(await setBrowserTabTitle(tabId, fresh));
                    }
                }
                else if (isNew) {
                    const pending = pendingPushRef.current;
                    if (pending && pending.url === url) {
                        pending.title = fresh || pending.title;
                        return;
                    }
                    const held = { url, title: fresh };
                    pendingPushRef.current = held;
                    try {
                        const replaced = await viewChangeFor(url);
                        if (replaced) {
                            if (held.title) {
                                apply(await setBrowserTabTitle(tabId, held.title));
                            }
                            return;
                        }
                        apply(await navigateBrowserTab(tabId, url, held.title));
                        await addBrowserHistoryEntry(url, held.title);
                        historyUrlRef.current = url;
                    }
                    finally {
                        if (pendingPushRef.current === held) {
                            pendingPushRef.current = null;
                        }
                    }
                }
                else if (fresh && fresh !== tab?.title) {
                    apply(await setBrowserTabTitle(tabId, fresh));
                    if (historyUrlRef.current === url) {
                        await addBrowserHistoryEntry(url, fresh);
                    }
                }
            }
            catch (e) {
                logError("useBrowserController.noteLoaded", e);
            }
        })();
        return settled;
    }, [apply, endRestore, settle]);

    const viewHistoryRef = useRef<string[] | null>(null);
    const viewIndexRef = useRef(-1);
    const noteViewHistory = useCallback((index: number, urls: string[]) => {
        const previous = viewHistoryRef.current;
        const previousIndex = viewIndexRef.current;
        viewHistoryRef.current = urls;
        viewIndexRef.current = index;
        const oldUrl = previous?.[index] ?? "";
        const newUrl = urls[index] ?? "";
        const replaced = !!previous
            && previousIndex === index
            && previous.length === urls.length
            && !!oldUrl && !!newUrl && oldUrl !== newUrl
            && !isChallengeUrl(oldUrl) && !isChallengeUrl(newUrl)
            && (index === 0 || previous[index - 1] === urls[index - 1]);
        if (newUrl) {
            const change = { url: newUrl, replaced };
            viewChangeRef.current = change;
            viewWaitersRef.current = viewWaitersRef.current.filter((waiter) => !waiter(change));
        }
        if (!replaced) {
            return;
        }
        const tabId = activeTabIdRef.current;
        if (!tabId) {
            return;
        }
        logFocusDebug("browser-replace", oldUrl.slice(0, 60), newUrl.slice(0, 60));
        if (liveUrlRef.current === oldUrl) {
            liveUrlRef.current = newUrl;
            if (drivenUrlRef.current === oldUrl) {
                drivenUrlRef.current = newUrl;
            }
        }
        (async () => {
            try {
                apply(await replaceBrowserTabEntry(tabId, oldUrl, newUrl));
            }
            catch (e) {
                logError("useBrowserController.noteViewHistory", e);
            }
        })();
    }, [apply]);

    const noteTitle = useCallback((title: string) => {
        const tabId = activeTabIdRef.current;
        const live = liveUrlRef.current;
        if (!tabId || !title || drivingRef.current) {
            return;
        }
        if (!liveTitleRef.current && title === leftTitleRef.current) {
            return;
        }
        const tab = tabsRef.current.find((row) => row.id === tabId);
        if (!tab || withoutChallenge(tab.url) !== withoutChallenge(live)) {
            return;
        }
        liveTitleRef.current = title;
        if (title === tab.title) {
            return;
        }
        (async () => {
            try {
                apply(await setBrowserTabTitle(tabId, title));
                if (historyUrlRef.current === live) {
                    await addBrowserHistoryEntry(live, title);
                }
            }
            catch (e) {
                logError("useBrowserController.noteTitle", e);
            }
        })();
    }, [apply]);

    const applyMarks = useCallback((state: BrowserBookmarksResponse) => {
        setBookmarks(state.bookmarks);
        setCategories(state.categories);
        setDefaultCategoryId(state.defaultCategoryId);
        setCollapsedCategoryIds(state.collapsedCategoryIds);
        setMaxCategories(state.maxCategories);
        return state;
    }, []);

    const refreshLists = useCallback(() => {
        (async () => {
            try {
                const [marks, visits] = await Promise.all([getBrowserBookmarks(), getBrowserHistory()]);
                applyMarks(marks);
                setHistory(visits.entries);
            }
            catch (e) {
                logError("useBrowserController.refreshLists", e);
            }
        })();
    }, [applyMarks]);

    useEffect(() => {
        refreshLists();
    }, [refreshLists]);

    const currentUrl = activeTab?.url ?? "";
    const currentMark = bookmarks.find((row) => row.url === currentUrl) ?? null;

    const toggleBookmark = useCallback(() => {
        if (!currentUrl) return;
        (async () => {
            try {
                const state = currentMark
                    ? await removeBrowserBookmark(currentMark.id)
                    : await addBrowserBookmark(currentUrl, activeTab?.title ?? "");
                applyMarks(state);
                if (state.reason === "bookmarkLimit") {
                    setBookmarkLimit(state.maxBookmarks);
                }
            }
            catch (e) {
                logError("useBrowserController.toggleBookmark", e);
            }
        })();
    }, [activeTab, applyMarks, currentMark, currentUrl]);

    const clearBookmarkLimit = useCallback(() => setBookmarkLimit(0), []);

    const currentSite = siteOf(currentUrl);
    const currentExemption = exemptEntryFor(currentUrl);

    const toggleCurrentExemption = useCallback(() => {
        const entry = exemptEntryFor(currentUrl);
        const site = siteOf(currentUrl);
        if (!entry && !site) return;
        (async () => {
            try {
                applyExemptions(entry ? await removeBrowserAdExemption(entry) : await addBrowserAdExemption(site));
            }
            catch (e) {
                logError("useBrowserController.toggleCurrentExemption", e);
            }
        })();
    }, [applyExemptions, currentUrl]);

    const removeAdExemption = useCallback((host: string) => {
        (async () => {
            try {
                applyExemptions(await removeBrowserAdExemption(host));
            }
            catch (e) {
                logError("useBrowserController.removeAdExemption", e);
            }
        })();
    }, [applyExemptions]);

    const removeBookmark = useCallback((bookmarkId: string) => {
        (async () => {
            try {
                applyMarks(await removeBrowserBookmark(bookmarkId));
            }
            catch (e) {
                logError("useBrowserController.removeBookmark", e);
            }
        })();
    }, [applyMarks]);

    const renameBookmark = useCallback((bookmarkId: string, title: string) => {
        if (!title.trim()) return;
        (async () => {
            try {
                applyMarks(await renameBrowserBookmark(bookmarkId, title.trim()));
            }
            catch (e) {
                logError("useBrowserController.renameBookmark", e);
            }
        })();
    }, [applyMarks]);

    const addCategory = useCallback((name: string) => {
        if (!name.trim()) return;
        (async () => {
            try {
                applyMarks(await addBrowserBookmarkCategory(name.trim()));
            }
            catch (e) {
                logError("useBrowserController.addCategory", e);
            }
        })();
    }, [applyMarks]);

    const renameCategory = useCallback((categoryId: string, name: string) => {
        if (!name.trim()) return;
        (async () => {
            try {
                applyMarks(await renameBrowserBookmarkCategory(categoryId, name.trim()));
            }
            catch (e) {
                logError("useBrowserController.renameCategory", e);
            }
        })();
    }, [applyMarks]);

    const removeCategory = useCallback((categoryId: string) => {
        (async () => {
            try {
                applyMarks(await removeBrowserBookmarkCategory(categoryId));
            }
            catch (e) {
                logError("useBrowserController.removeCategory", e);
            }
        })();
    }, [applyMarks]);

    const setCategoryCollapsed = useCallback((categoryId: string, collapsed: boolean) => {
        setCollapsedCategoryIds((current) => (
            collapsed
                ? (current.includes(categoryId) ? current : [...current, categoryId])
                : current.filter((id) => id !== categoryId)
        ));
        (async () => {
            try {
                applyMarks(await setBrowserCategoryCollapsed(categoryId, collapsed));
            }
            catch (e) {
                logError("useBrowserController.setCategoryCollapsed", e);
            }
        })();
    }, [applyMarks]);

    const makeDefaultCategory = useCallback((categoryId: string) => {
        (async () => {
            try {
                applyMarks(await setDefaultBrowserBookmarkCategory(categoryId));
            }
            catch (e) {
                logError("useBrowserController.makeDefaultCategory", e);
            }
        })();
    }, [applyMarks]);

    const removeHistoryEntry = useCallback((entryId: string) => {
        (async () => {
            try {
                setHistory((await removeBrowserHistoryEntry(entryId)).entries);
            }
            catch (e) {
                logError("useBrowserController.removeHistoryEntry", e);
            }
        })();
    }, []);

    const wipeHistory = useCallback((days: number) => {
        (async () => {
            try {
                const cleared = await clearBrowserHistory(days);
                setHistory(cleared.entries);
                if (cleared.tabs?.ok) {
                    apply(cleared.tabs);
                }
            }
            catch (e) {
                logError("useBrowserController.wipeHistory", e);
            }
        })();
    }, [apply]);

    return {
        tabs,
        activeTab,
        bookmarks,
        categories,
        defaultCategoryId,
        collapsedCategoryIds,
        maxCategories,
        history,
        currentIsBookmarked: !!currentMark,
        toggleBookmark,
        removeBookmark,
        renameBookmark,
        addCategory,
        renameCategory,
        removeCategory,
        makeDefaultCategory,
        setCategoryCollapsed,
        bookmarkLimit,
        clearBookmarkLimit,
        removeHistoryEntry,
        wipeHistory,
        refreshLists,
        atTabLimit: tabs.length >= maxTabs,
        maxTabs,
        blockedUrl,
        resolveTabLimit,
        closeAllTabs,
        rememberPlaces,
        noteBackgroundPage,
        noteLeaving,
        pageZoom,
        stepZoom,
        historyRetention,
        cycleHistoryRetention,
        searchEngine,
        cycleSearchEngine,
        newTabPage,
        customNewTabUrl,
        cycleNewTabPage,
        setCustomNewTabUrl,
        customSearchUrl,
        setCustomSearchUrl,
        openLinksInNewTab,
        toggleOpenLinksInNewTab,
        blockAds,
        toggleBlockAds,
        fastForwardYouTubeAds,
        toggleFastForwardYouTubeAds,
        fastForwardPrerollAds,
        toggleFastForwardPrerollAds,
        resetOptions,
        adExemptions,
        maxAdExemptions,
        adExemptionsFull,
        currentSite,
        currentExemption,
        toggleCurrentExemption,
        removeAdExemption,
        activeTabs,
        cycleActiveTabs,
        pauseMediaOnTabSwitch,
        togglePauseMediaOnTabSwitch,
        maxDownloads,
        cycleMaxDownloads,
        downloadFolder,
        setDownloadFolder,
        rememberDownloadFolder,
        toggleRememberDownloadFolder,
        pendingDownload,
        noteDownload,
        downloadTo,
        cancelDownload,
        expanded,
        toggleExpanded,
        openNewTab,
        openExternalLink,
        panelTab,
        setPanelTab,
        address,
        addressDirty: address.trim() !== "" && address !== (activeTab?.url ?? ""),
        canGoBack: !!activeTab && activeTab.historyIndex > 0,
        canGoForward: !!activeTab && activeTab.historyIndex < activeTab.history.length - 1,
        loaded,
        setAddress,
        submitAddress,
        openAddress,
        openTab,
        closeTab,
        selectTab,
        goBack,
        goForward,
        reload,
        noteLoaded,
        noteTitle,
        noteViewHistory,
        blurPage
    };
}
