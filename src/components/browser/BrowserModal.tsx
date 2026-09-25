import { useCallback, useEffect, useRef, useState } from "react";
import { ModalRoot } from "@decky/ui";
import {
    BrowserViewHost,
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
import { closeSession, ensureSession, refreshFullscreenBinding, setDownloadHandler, setFullscreenHandler, stopLoading } from "./browserSession";
import { BROWSER_HOME_URL, useBrowserController } from "../../hooks/useBrowserController";
import { t, type LanguageCode } from "../../locales";
import { useFocusPaintWake } from "../../hooks/useFocusPaintWake";
import { logFocusDebug } from "../../api";
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
    const hostRef = useRef<BrowserViewHost | null>(null);
    const outerRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const [ready, setReady] = useState(false);
    const [stageHeight, setStageHeight] = useState(0);
    const [keyboardOpen, setKeyboardOpen] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);
    const [findCount, setFindCount] = useState<{ total: number; current: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const loadStartsRef = useRef(0);
    const findTextRef = useRef("");
    const findTimerRef = useRef<number | null>(null);

    if (hostRef.current === null) {
        hostRef.current = new BrowserViewHost();
    }
    const host = hostRef.current;

    const keyboardOpenRef = useRef(false);
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

    const paintedRef = useRef(true);

    const loadUrl = useCallback((url: string) => {
        host.loadUrl(url);
    }, [host]);

    const browser = useBrowserController(loadUrl, startUrl);

    const handlersRef = useRef(browser);
    handlersRef.current = browser;

    useEffect(() => {
        if (!host.create()) {
            close();
            openInSteamBrowser(BROWSER_HOME_URL);
            return;
        }
        host.setExternalUrlHandler((url) => {
            handlersRef.current.openExternalLink(url);
            claimView();
        });
        host.setHeldFocusHandler(() => handlersRef.current.blurPage());
        host.setTitleHandler((title) => handlersRef.current.noteTitle(title));
        setFullscreenHandler((fullscreen) => {
            const stage = stageRef.current;
            host.setPageFullscreen(fullscreen, stage?.ownerDocument?.defaultView ?? null);
            if (!fullscreen) {
                host.syncBounds(stage?.querySelector<HTMLElement>(".cd-browser-view") ?? null);
            }
        });
        setDownloadHandler((request) => {
            host.endCancelledRequest();
            window.setTimeout(() => host.endCancelledRequest(), CANCELLED_REQUEST_RETRY_MS);
            handlersRef.current.noteDownload(request);
        });
        host.setHistoryHandler((index, urls) => handlersRef.current.noteViewHistory(index, urls));
        host.setFindHandler((total, current) => {
            if (findTimerRef.current !== null) {
                window.clearTimeout(findTimerRef.current);
            }
            findTimerRef.current = window.setTimeout(() => {
                findTimerRef.current = null;
                if (findTextRef.current) {
                    setFindCount({ total, current });
                }
            }, FIND_COUNT_SETTLE_MS);
        });
        host.setLoadHandler((url, title, loading, finished) => {
            ensureSession(url);
            if (loading) {
                host.holdPageKeyboard();
                handlersRef.current.noteLeaving();
                return;
            }
            refreshFullscreenBinding();
            const token = host.pageKeyboardHold;
            void handlersRef.current.noteLoaded(url, title, finished).finally(() => {
                if (finished) {
                    host.releasePageKeyboard(token);
                }
            });
            claimView();
        });
        host.setLoadingHandler((value) => {
            if (value) {
                loadStartsRef.current++;
            }
            setLoading(value);
        });
        setReady(true);
        return () => {
            setDownloadHandler(null);
            setFullscreenHandler(null);
            closeSession();
            void handlersRef.current.rememberPlace().finally(() => host.destroy());
        };
    }, [host, close, claimView]);

    const syncViewBounds = useCallback(() => {
        const placeholder = stageRef.current?.querySelector<HTMLElement>(".cd-browser-view") ?? null;
        host.syncBounds(placeholder);
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
            setStageHeight(0);
            return;
        }
        setStageHeight(Math.max(heightAboveKeyboard(stageRef.current), MIN_STAGE_HEIGHT_PX));
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
                        host.endCancelledRequest();
                    }
                }, STOP_SETTLE_MS);
            });
    }, [host]);

    const openPanel = useCallback(() => {
        browser.refreshLists();
        setPanelOpen(true);
    }, [browser]);

    const closePanel = useCallback(() => {
        setPanelOpen(false);
    }, []);

    const find = useCallback((text: string, backwards: boolean) => {
        if (text === findTextRef.current) {
            host.find(text, true, backwards);
            return;
        }
        findTextRef.current = text;
        host.find(text, false, false);
        window.setTimeout(() => {
            if (findTextRef.current === text) {
                host.find(text, true, backwards);
            }
        }, FIND_SELECT_DELAY_MS);
    }, [host]);

    const stopFind = useCallback(() => {
        findTextRef.current = "";
        setFindCount(null);
        host.stopFind();
    }, [host]);

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
            host.noteKeyboardClosed();
        }
    }, [host, keyboardOpen]);

    const components = resolveBrowserComponents();
    const wrapper = host.browser;
    const raw = host.view;

    return (
        <ModalRoot closeModal={close} className={browser.expanded ? "cd-browser-dialog cd-browser-expanded" : "cd-browser-dialog"}>
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
                    onClose={close}
                    expanded={browser.expanded}
                    onToggleExpanded={browser.toggleExpanded}
                    bookmarked={browser.currentIsBookmarked}
                    onToggleBookmark={browser.toggleBookmark}
                    onOpenPanel={openPanel}
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
                                downloadFolder={browser.downloadFolder}
                                onSetDownloadFolder={browser.setDownloadFolder}
                                rememberDownloadFolder={browser.rememberDownloadFolder}
                                onToggleRememberDownloadFolder={browser.toggleRememberDownloadFolder}
                                onClose={closePanel}
                            />
                        )}
                        </div>
                    )}
                    {ready && components && wrapper && raw && (
                        <components.GamepadHost
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

export function closeBrowserForUnload(): void {
    const close = closeOpenBrowser;
    closeOpenBrowser = null;
    if (!close) {
        return;
    }
    try {
        close();
    }
    catch (e) {
        logError("closeBrowserForUnload", e);
    }
    closeSession();
    releaseWebBrowserActionset();
}

export function openBrowserModal(language: LanguageCode, startUrl = "") {
    if (!BrowserViewHost.isAvailable()) {
        openInSteamBrowser(startUrl || BROWSER_HOME_URL);
        return;
    }
    const modal = showManagedModal(
        (close) => <BrowserModal language={language} close={close} startUrl={startUrl} />,
        { onClose: () => { closeOpenBrowser = null; } }
    );
    closeOpenBrowser = modal.Close;
}
