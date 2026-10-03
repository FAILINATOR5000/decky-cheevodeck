import { useCallback, useEffect, useRef, useState } from "react";
import { ModalRoot } from "@decky/ui";
import {
    heightAboveKeyboard,
    keyboardIsBelow,
    releaseWebBrowserActionset,
    requestGamepadFocus,
    resolveBrowserComponents,
    subscribeVirtualKeyboard
} from "./browserViewHost";
import { BrowserChrome } from "./BrowserChrome";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { BrowserPanel } from "./BrowserPanel";
import { BrowserTabLimit } from "./BrowserTabLimit";
import { BrowserBookmarkLimit } from "./BrowserBookmarkLimit";
import { BrowserDownloadFolder } from "./BrowserDownloadFolder";
import { setDownloadHandler, setFullscreenHandler, setViewSize, stopLoading } from "./browserSession";
import { activeView, destroyAllViews, destroyDetached, detachAllViews, loadInView, setClosing, setViewEvents, silenceViews, type LiveView } from "./browserViews";
import { BrowserViewHost } from "./browserViewHost";
import { BROWSER_HOME_URL, useBrowserController } from "../../hooks/useBrowserController";
import { t, type LanguageCode } from "../../locales";
import { useFocusPaintWake } from "../../hooks/useFocusPaintWake";
import { forgetBrowserBackHistory, logFocusDebug } from "../../api";
import { steamDisplayScale } from "../../utils/closeTrace";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { openInSteamBrowser } from "../../utils/steamBrowser";

const MIN_STAGE_HEIGHT_PX = 120;

const CANCELLED_REQUEST_RETRY_MS = 400;

const STOP_SETTLE_MS = 300;

const KEYBOARD_SETTLE_MS = 700;

const KEYBOARD_SETTLE_STEP_MS = 60;

const BOUNDS_SETTLE_MS = 700;

const BOUNDS_SETTLE_STEP_MS = 60;

const VIEW_UNDERLAY = false;

const FIND_SELECT_DELAY_MS = 150;

const FIND_COUNT_SETTLE_MS = 120;

const PENDING_VIEW_MAX_MS = 4000;

const POINTER_PARK_X = 0.4;
const POINTER_PARK_Y = 0.5;

const BROWSER_MODAL_CSS = `
.cd-browser-dialog.DialogContent, .cd-browser-dialog {
    width: min(94vw, 1100px);
    padding: 0;
    border-color: #4a4f58;
}
.cd-browser-dialog.DialogContent.cd-browser-expanded, .cd-browser-dialog.cd-browser-expanded {
    width: 100vw;
}
*:has(> .cd-browser-dialog.cd-browser-expanded) {
    padding: 0 !important;
}
.cd-browser-dialog.cd-browser-fullscreen, *:has(> .cd-browser-dialog.cd-browser-fullscreen) {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-height: none !important;
}
.cd-browser-dialog.cd-browser-fullscreen {
    border: none !important;
}
.cd-browser-dialog.cd-browser-fullscreen .cd-browser-outer {
    height: 100vh;
}
.FullModalOverlay:has(.cd-browser-fullscreen) ~ .GamepadMode,
*:has(> .FullModalOverlay .cd-browser-fullscreen) + *:not(:has([class*="Layout_"])) {
    visibility: hidden !important;
}
.cd-browser-expanded .cd-browser-outer {
    height: calc(100vh - var(--basicui-header-height, 0px) - var(--gamepadui-current-footer-height, 0px) - 4px);
}
.cd-browser-dialog .DialogContent_InnerWidth {
    padding: 0;
    width: 100%;
    max-width: none;
}
.cd-browser-outer {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: min(80vh, calc(100vh - var(--basicui-header-height, 0px) - var(--gamepadui-current-footer-height, 0px) - 52px));
}
.cd-browser-stage {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 0 4px 4px;
}
.cd-browser-scroll {
    scrollbar-width: none;
}
.cd-browser-scroll::-webkit-scrollbar {
    display: none;
}
.cd-browser-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    min-width: 0;
    overflow: hidden;
    z-index: 1;
}
.cd-browser-container {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
}
.cd-browser-container > * {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
}
.cd-browser-view {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
}
`;

function BrowserModal({ language, close, startUrl }: { language: LanguageCode; close: () => void; startUrl: string }) {
    const outerRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const [view, setView] = useState<LiveView | null>(() => (startUrl ? null : activeView()));
    const host = view?.host ?? null;
    const shownRef = useRef<LiveView | null>(view);
    const pendingRef = useRef<LiveView | null>(null);
    const pendingTimerRef = useRef<number | null>(null);

    const showView = useCallback((next: LiveView) => {
        if (pendingTimerRef.current !== null) {
            window.clearTimeout(pendingTimerRef.current);
            pendingTimerRef.current = null;
        }
        const waiting = pendingRef.current;
        pendingRef.current = null;
        if (waiting && waiting !== next) {
            waiting.host.hide();
        }
        const shown = shownRef.current;
        if (shown && shown !== next && paintedRef.current) {
            next.host.showAt(shown.host.placedAt);
        }
        shownRef.current = next;
        setView(next);
    }, []);

    useEffect(() => () => {
        if (pendingTimerRef.current !== null) {
            window.clearTimeout(pendingTimerRef.current);
        }
    }, []);
    const ready = view !== null;
    const [stageHeight, setStageHeight] = useState(0);
    const [keyboardOpen, setKeyboardOpen] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);
    const [findCount, setFindCount] = useState<{ total: number; current: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const loadStartsRef = useRef(0);
    const findTextRef = useRef("");
    const findTimerRef = useRef<number | null>(null);

    useEffect(() => {
        mountedBrowsers += 1;
        return () => {
            mountedBrowsers -= 1;
        };
    }, []);

    const keyboardOpenRef = useRef(false);
    const keyboardReadingRef = useRef<number | null>(null);
    const claimViewNode = useCallback((force: boolean) => {
        if (keyboardOpenRef.current && !force) {
            logFocusDebug("browser-claim", "guarded", "keyboard up");
            return;
        }
        const container = stageRef.current?.querySelector<HTMLElement>(".cd-browser-container");
        if (!container) {
            logFocusDebug("browser-claim", force ? "forced" : "guarded", "no container");
            return;
        }
        const held = container.classList.contains("gpfocuswithin");
        logFocusDebug("browser-claim", force ? "forced" : "guarded", `held=${held}`);
        if (held && !force) {
            return;
        }
        requestGamepadFocus(container);
    }, []);

    const claimView = useCallback(() => claimViewNode(false), [claimViewNode]);

    const pointerCloseRef = useRef(false);
    const mountedRef = useRef(true);
    useEffect(() => () => {
        mountedRef.current = false;
    }, []);
    const closeFromPointer = (minimize: boolean) => {
        if (pointerCloseRef.current) {
            return;
        }
        pointerCloseRef.current = true;
        releaseWebBrowserActionset();
        const win = stageRef.current?.ownerDocument.defaultView ?? window;
        const scale = win.devicePixelRatio || 1;
        const x = Math.round(win.screenLeft + win.innerWidth * scale * POINTER_PARK_X);
        const y = Math.round(win.screenTop + win.innerHeight * scale * POINTER_PARK_Y);
        try {
            SteamClient.Input?.SetMousePosition?.(0, x, y);
            SteamClient.Browser?.HideCursorUntilMouseEvent?.();
        }
        catch (e) {
            logError("BrowserModal.closeFromPointer", e);
        }
        win.requestAnimationFrame(() => {
            logFocusDebug(
                "browser-close",
                "pointer parked and hidden",
                `${minimize ? "minimize" : "close"} at=${x},${y} window=${win.innerWidth}x${win.innerHeight}@${win.screenLeft},${win.screenTop} dpr=${scale} steamScale=${steamDisplayScale()} screen=${win.screen.width}x${win.screen.height}`
            );
            if (!mountedRef.current) {
                return;
            }
            minimizeRequested = minimize;
            close();
        });
    };

    const paintedRef = useRef(true);

    const loadUrl = useCallback((url: string) => {
        const shown = activeView();
        if (shown) {
            loadInView(shown, url);
        }
    }, []);

    const browser = useBrowserController(loadUrl, startUrl);

    const holdView = useCallback((next: LiveView) => {
        const waiting = pendingRef.current;
        if (waiting && waiting !== next && waiting !== shownRef.current) {
            waiting.host.hide();
        }
        pendingRef.current = next;
        next.host.showUnderneath(shownRef.current?.host.placedAt ?? null);
        if (pendingTimerRef.current !== null) {
            window.clearTimeout(pendingTimerRef.current);
        }
        pendingTimerRef.current = window.setTimeout(() => {
            if (pendingRef.current === next) {
                showView(next);
            }
        }, PENDING_VIEW_MAX_MS);
    }, [showView]);

    useEffect(() => {
        const current = activeView();
        if (!browser.loaded || shownRef.current || pendingRef.current || !current) {
            return;
        }
        if (startUrl && !browser.blockedUrl) {
            holdView(current);
        }
        else {
            showView(current);
        }
        setLoading(current.host.isLoading);
    }, [browser.blockedUrl, browser.loaded, holdView, showView, startUrl]);

    const handlersRef = useRef(browser);
    handlersRef.current = browser;

    useEffect(() => {
        const liveHost = () => activeView()?.host ?? null;
        setViewEvents({
            active: (next, showNow) => {
                if (showNow || (!shownRef.current && !startUrl)) {
                    showView(next);
                }
                else {
                    holdView(next);
                }
                setLoading(next.host.isLoading);
                findTextRef.current = "";
                setFindCount(null);
            },
            external: (url) => {
                handlersRef.current.openExternalLink(url);
                claimView();
            },
            heldFocus: () => handlersRef.current.blurPage(),
            title: (title) => handlersRef.current.noteTitle(title),
            bounds: (width, height) => {
                setViewSize(width, height, stageRef.current?.ownerDocument?.defaultView?.devicePixelRatio ?? 0);
            },
            history: (index, urls) => handlersRef.current.noteViewHistory(index, urls),
            background: (moved) => handlersRef.current.noteBackgroundPage(moved),
            find: (total, current) => {
                if (findTimerRef.current !== null) {
                    window.clearTimeout(findTimerRef.current);
                }
                findTimerRef.current = window.setTimeout(() => {
                    findTimerRef.current = null;
                    if (findTextRef.current) {
                        setFindCount({ total, current });
                    }
                }, FIND_COUNT_SETTLE_MS);
            },
            load: (loadHost, url, title, loading, finished) => {
                if (loading) {
                    loadHost.holdPageKeyboard();
                    handlersRef.current.noteLeaving();
                    return;
                }
                if (finished && pendingRef.current?.host === loadHost) {
                    showView(pendingRef.current);
                }
                const token = loadHost.pageKeyboardHold;
                void handlersRef.current.noteLoaded(url, title, finished).finally(() => {
                    if (finished) {
                        loadHost.releasePageKeyboard(token);
                    }
                });
                claimView();
            },
            loading: (value) => {
                if (value) {
                    loadStartsRef.current++;
                }
                setLoading(value);
            }
        });
        setFullscreenHandler((fullscreen) => {
            const stage = stageRef.current;
            const current = liveHost();
            current?.setPageFullscreen(fullscreen, stage?.ownerDocument?.defaultView ?? null);
            if (!fullscreen) {
                current?.syncBounds(stage?.querySelector<HTMLElement>(".cd-browser-view") ?? null);
            }
        });
        setDownloadHandler((request) => {
            liveHost()?.endCancelledRequest();
            window.setTimeout(() => liveHost()?.endCancelledRequest(), CANCELLED_REQUEST_RETRY_MS);
            handlersRef.current.noteDownload(request);
        });
        const current = startUrl ? null : activeView();
        if (current) {
            shownRef.current = current;
            setView(current);
            setLoading(current.host.isLoading);
        }
        return () => {
            setDownloadHandler(null);
            setFullscreenHandler(null);
            setViewEvents(null);
            const waiting = pendingRef.current;
            pendingRef.current = null;
            if (waiting && waiting !== shownRef.current) {
                waiting.host.hide();
            }
            if (minimizeRequested) {
                minimizeRequested = false;
                releaseWebBrowserActionset();
                return;
            }
            announceClosed();
            const shown = activeView();
            const detached = detachAllViews();
            silenceViews(detached);
            setClosing(handlersRef.current.rememberPlaces(detached, shown).finally(() => {
                destroyDetached(detached);
                return forgetBrowserBackHistory().catch((e) => logError("BrowserModal.forgetBrowserBackHistory", e));
            }));
        };
    }, [claimView, holdView, showView]);

    const syncViewBounds = useCallback(() => {
        const placeholder = stageRef.current?.querySelector<HTMLElement>(".cd-browser-view") ?? null;
        host?.syncBounds(placeholder);
    }, [host]);

    useEffect(() => {
        const stage = stageRef.current;
        const win = stage?.ownerDocument?.defaultView as any;
        if (!ready || !stage || !win?.ResizeObserver) {
            return;
        }
        syncViewBounds();
        const observer = new win.ResizeObserver(syncViewBounds);
        const placeholder = stage.querySelector<HTMLElement>(".cd-browser-view");
        if (placeholder) {
            observer.observe(placeholder);
        }
        if (outerRef.current) {
            observer.observe(outerRef.current);
        }
        return () => observer.disconnect();
    }, [ready, syncViewBounds]);

    useEffect(() => {
        if (!ready) {
            return;
        }
        let elapsed = 0;
        const timer = window.setInterval(() => {
            elapsed += BOUNDS_SETTLE_STEP_MS;
            syncViewBounds();
            if (elapsed >= BOUNDS_SETTLE_MS) {
                window.clearInterval(timer);
            }
        }, BOUNDS_SETTLE_STEP_MS);
        return () => window.clearInterval(timer);
    }, [keyboardOpen, stageHeight, browser.expanded, ready, syncViewBounds]);

    const resizeForKeyboard = useCallback((showing: boolean) => {
        keyboardOpenRef.current = showing;
        setKeyboardOpen(showing);
        if (!showing || !paintedRef.current || !keyboardIsBelow()) {
            keyboardReadingRef.current = null;
            setStageHeight(0);
            return;
        }
        const { measured, guess } = heightAboveKeyboard(stageRef.current);
        const settled = measured !== null && measured === keyboardReadingRef.current;
        keyboardReadingRef.current = measured;
        setStageHeight((current) => {
            if (settled) {
                return Math.max(measured, MIN_STAGE_HEIGHT_PX);
            }
            return current > 0 ? current : Math.max(guess, MIN_STAGE_HEIGHT_PX);
        });
    }, []);

    useEffect(() => subscribeVirtualKeyboard(resizeForKeyboard), [resizeForKeyboard]);

    useFocusPaintWake(outerRef);

    const stop = useCallback(() => {
        const starts = loadStartsRef.current;
        void stopLoading()
            .catch((e) => logError("BrowserModal.stop", e))
            .finally(() => {
                window.setTimeout(() => {
                    if (loadStartsRef.current === starts) {
                        activeView()?.host.endCancelledRequest();
                    }
                }, STOP_SETTLE_MS);
            });
    }, []);

    const openPanel = useCallback(() => {
        browser.refreshLists();
        setPanelOpen(true);
    }, [browser]);

    const closePanel = useCallback(() => {
        setPanelOpen(false);
    }, []);

    const find = useCallback((text: string, backwards: boolean) => {
        if (text === findTextRef.current) {
            activeView()?.host.find(text, true, backwards);
            return;
        }
        findTextRef.current = text;
        activeView()?.host.find(text, false, false);
        window.setTimeout(() => {
            if (findTextRef.current === text) {
                activeView()?.host.find(text, true, backwards);
            }
        }, FIND_SELECT_DELAY_MS);
    }, []);

    const stopFind = useCallback(() => {
        findTextRef.current = "";
        setFindCount(null);
        activeView()?.host.stopFind();
    }, []);

    useEffect(() => () => {
        if (findTimerRef.current !== null) {
            window.clearTimeout(findTimerRef.current);
        }
    }, []);

    const pickFromPanel = useCallback((url: string) => {
        closePanel();
        browser.openAddress(url);
    }, [browser, closePanel]);

    const pickFromHistory = useCallback((url: string) => {
        closePanel();
        browser.openTab(url);
    }, [browser, closePanel]);

    const blocked = browser.blockedUrl;
    const bookmarkLimit = browser.bookmarkLimit;
    const download = browser.pendingDownload;

    const viewPainted = blocked === "" && bookmarkLimit === 0 && download === null && !panelOpen;

    useEffect(() => {
        if (!keyboardOpen) {
            setStageHeight(0);
            return;
        }
        let elapsed = 0;
        resizeForKeyboard(true);
        const timer = window.setInterval(() => {
            elapsed += KEYBOARD_SETTLE_STEP_MS;
            resizeForKeyboard(true);
            if (elapsed >= KEYBOARD_SETTLE_MS) {
                window.clearInterval(timer);
            }
        }, KEYBOARD_SETTLE_STEP_MS);
        return () => window.clearInterval(timer);
    }, [keyboardOpen, viewPainted, resizeForKeyboard]);

    useEffect(() => {
        paintedRef.current = viewPainted;
    }, [viewPainted]);

    useEffect(() => {
        if (!keyboardOpen) {
            host?.noteKeyboardClosed();
        }
    }, [host, keyboardOpen]);

    const components = resolveBrowserComponents();
    const wrapper = host?.browser;
    const raw = host?.view;
    const dialogClass = browser.expanded
        ? "cd-browser-dialog cd-browser-expanded cd-browser-fullscreen"
        : "cd-browser-dialog cd-browser-expanded";

    return (
        <ModalRoot closeModal={close} className={dialogClass}>
            <style>{BROWSER_MODAL_CSS}</style>

            <SnapshotHotkey language={language} />

            <div className="cd-browser-outer" ref={outerRef}>
                <BrowserChrome
                    language={language}
                    tabs={browser.tabs}
                    activeTabId={browser.activeTab?.id ?? ""}
                    address={browser.address}
                    addressDirty={browser.addressDirty}
                    canGoBack={browser.canGoBack}
                    canGoForward={browser.canGoForward}
                    pageUrl={browser.activeTab?.url ?? ""}
                    onAddressChange={browser.setAddress}
                    onSubmit={browser.submitAddress}
                    onBack={browser.goBack}
                    onForward={browser.goForward}
                    onReload={browser.reload}
                    loading={loading}
                    onStop={stop}
                    onNewTab={browser.openNewTab}
                    onSelectTab={browser.selectTab}
                    onCloseTab={browser.closeTab}
                    onClose={() => closeFromPointer(false)}
                    onMinimize={() => closeFromPointer(true)}
                    expanded={browser.expanded}
                    onToggleExpanded={browser.toggleExpanded}
                    bookmarked={browser.currentIsBookmarked}
                    onToggleBookmark={browser.toggleBookmark}
                    onTogglePanel={panelOpen ? closePanel : openPanel}
                    keyboardOpen={keyboardOpen}
                    atTabLimit={browser.atTabLimit}
                    findCount={findCount}
                    onFind={find}
                    onStopFind={stopFind}
                />

                <div
                    className="cd-browser-stage"
                    ref={stageRef}
                    style={stageHeight > 0 ? { flex: `0 0 ${stageHeight}px`, height: `${stageHeight}px` } : undefined}
                >
                    {(blocked !== "" || bookmarkLimit > 0 || download !== null || panelOpen) && (
                        <div className="cd-browser-overlay">
                        {blocked === "" && bookmarkLimit > 0 && (
                            <BrowserBookmarkLimit
                                language={language}
                                url={browser.activeTab?.url ?? ""}
                                maxBookmarks={bookmarkLimit}
                                onDismiss={browser.clearBookmarkLimit}
                            />
                        )}
                        {blocked !== "" && (
                            <BrowserTabLimit
                                language={language}
                                url={blocked}
                                maxTabs={browser.maxTabs}
                                onEvict={() => browser.resolveTabLimit("evict")}
                                onCancel={() => browser.resolveTabLimit("cancel")}
                            />
                        )}
                        {blocked === "" && bookmarkLimit === 0 && download !== null && (
                            <BrowserDownloadFolder
                                language={language}
                                prompt={t(language, "Choose a folder to download the file to:")}
                                fileName={download.name}
                                confirmLabel={t(language, "Download Here")}
                                keyboardOpen={keyboardOpen}
                                onConfirm={browser.downloadTo}
                                onCancel={browser.cancelDownload}
                            />
                        )}
                        {blocked === "" && bookmarkLimit === 0 && download === null && panelOpen && (
                            <BrowserPanel
                                language={language}
                                tab={browser.panelTab}
                                bookmarks={browser.bookmarks}
                                history={browser.history}
                                categories={browser.categories}
                                defaultCategoryId={browser.defaultCategoryId}
                                collapsed={browser.collapsedCategoryIds}
                                maxCategories={browser.maxCategories}
                                onPick={pickFromPanel}
                                onPickHistory={pickFromHistory}
                                onSetTab={browser.setPanelTab}
                                onRemoveBookmark={browser.removeBookmark}
                                onRenameBookmark={browser.renameBookmark}
                                onAddCategory={browser.addCategory}
                                onRenameCategory={browser.renameCategory}
                                onRemoveCategory={browser.removeCategory}
                                onMakeDefaultCategory={browser.makeDefaultCategory}
                                onSetCategoryCollapsed={browser.setCategoryCollapsed}
                                keyboardOpen={keyboardOpen}
                                onRemoveHistoryEntry={browser.removeHistoryEntry}
                                onClearHistory={browser.wipeHistory}
                                onCloseAllTabs={() => {
                                    closePanel();
                                    browser.closeAllTabs();
                                }}
                                tabCount={browser.tabs.length}
                                pageZoom={browser.pageZoom}
                                onStepZoom={browser.stepZoom}
                                historyRetention={browser.historyRetention}
                                onCycleHistoryRetention={browser.cycleHistoryRetention}
                                searchEngine={browser.searchEngine}
                                onCycleSearchEngine={browser.cycleSearchEngine}
                                newTabPage={browser.newTabPage}
                                customNewTabUrl={browser.customNewTabUrl}
                                onCycleNewTabPage={browser.cycleNewTabPage}
                                onSetCustomNewTabUrl={browser.setCustomNewTabUrl}
                                customSearchUrl={browser.customSearchUrl}
                                onSetCustomSearchUrl={browser.setCustomSearchUrl}
                                openLinksInNewTab={browser.openLinksInNewTab}
                                onToggleOpenLinksInNewTab={browser.toggleOpenLinksInNewTab}
                                blockAds={browser.blockAds}
                                onToggleBlockAds={browser.toggleBlockAds}
                                fastForwardYouTubeAds={browser.fastForwardYouTubeAds}
                                onToggleFastForwardYouTubeAds={browser.toggleFastForwardYouTubeAds}
                                adExemptions={browser.adExemptions}
                                maxAdExemptions={browser.maxAdExemptions}
                                adExemptionsFull={browser.adExemptionsFull}
                                currentSite={browser.currentSite}
                                currentExemption={browser.currentExemption}
                                onToggleCurrentExemption={browser.toggleCurrentExemption}
                                onRemoveExemption={browser.removeAdExemption}
                                activeTabs={browser.activeTabs}
                                onCycleActiveTabs={browser.cycleActiveTabs}
                                pauseMediaOnTabSwitch={browser.pauseMediaOnTabSwitch}
                                onTogglePauseMediaOnTabSwitch={browser.togglePauseMediaOnTabSwitch}
                                downloadFolder={browser.downloadFolder}
                                onSetDownloadFolder={browser.setDownloadFolder}
                                rememberDownloadFolder={browser.rememberDownloadFolder}
                                onToggleRememberDownloadFolder={browser.toggleRememberDownloadFolder}
                                onClose={closePanel}
                            />
                        )}
                        </div>
                    )}
                    {view && components && wrapper && raw && (
                        <components.GamepadHost
                            key={view.key}
                            browser={wrapper}
                            visible={true}
                            autoFocus={true}
                            classNameContainer="cd-browser-container"
                        >
                            <components.ViewRenderer
                                browser={raw}
                                visible={viewPainted}
                                underlay={VIEW_UNDERLAY}
                                className="cd-browser-view"
                            />
                        </components.GamepadHost>
                    )}
                </div>
            </div>
        </ModalRoot>
    );
}

let closeOpenBrowser: (() => void) | null = null;

const closeListeners = new Set<() => void>();

export function onBrowserClosed(listener: () => void): void {
    closeListeners.add(listener);
}

function announceClosed(): void {
    for (const listener of [...closeListeners]) {
        try {
            listener();
        }
        catch (e) {
            logError("BrowserModal.announceClosed", e);
        }
    }
}

let minimizeRequested = false;

let mountedBrowsers = 0;

export function browserModalOpen(): boolean {
    return mountedBrowsers > 0;
}

export function closeBrowserForUnload(): void {
    const close = closeOpenBrowser;
    closeOpenBrowser = null;
    minimizeRequested = false;
    if (close) {
        try {
            close();
        }
        catch (e) {
            logError("closeBrowserForUnload", e);
        }
    }
    destroyAllViews();
    announceClosed();
    releaseWebBrowserActionset();
}

export function openBrowserModal(language: LanguageCode, startUrl = "") {
    if (!BrowserViewHost.isAvailable()) {
        openInSteamBrowser(startUrl || BROWSER_HOME_URL);
        return;
    }
    const modal = showManagedModal(
        (close) => <BrowserModal language={language} close={close} startUrl={startUrl} />,
        { onClose: () => { closeOpenBrowser = null; }, skipQamReturn: true }
    );
    closeOpenBrowser = modal.Close;
}
