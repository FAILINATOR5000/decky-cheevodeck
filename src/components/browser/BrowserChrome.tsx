import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DialogButton, Focusable, TextField } from "@decky/ui";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaArrowLeft, FaArrowRight, FaBars, FaChevronDown, FaChevronLeft, FaChevronRight, FaChevronUp, FaPlus, FaRegStar, FaSearch, FaStar, FaSyncAlt, FaTimes, FaWindowMaximize, FaWindowRestore } from "react-icons/fa";
import { t, type LanguageCode } from "../../locales";
import { useBrowserPress } from "../../hooks/useBrowserPress";
import { modalSize } from "../../utils/scale";
import type { BrowserTab } from "../../types";

const ICON_BUTTON_PX = 38;

const TAB_MAX_WIDTH_PX = 170;

const TAB_MIN_WIDTH_PX = 96;

const TAB_HEIGHT_PX = 30;

const CONTROL_HEIGHT_PX = 38;

function stepButtonStyle(dimmed: boolean): Record<string, string> {
    return {
        minWidth: `${modalSize(44)}px`,
        width: "auto",
        height: `${modalSize(TAB_HEIGHT_PX)}px`,
        padding: `0 ${modalSize(5)}px`,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: `${modalSize(3)}px`,
        fontSize: `${modalSize(11)}px`,
        opacity: dimmed ? "0.35" : "1"
    };
}

function iconButtonStyle(dimmed = false, active = false): Record<string, string> {
    return {
        ...(active ? { background: "#1a9fff", color: "#ffffff" } : {}),
        minWidth: "0",
        width: `${modalSize(ICON_BUTTON_PX)}px`,
        height: `${modalSize(CONTROL_HEIGHT_PX)}px`,
        padding: "0",
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: dimmed ? "0.35" : "1"
    };
}

function tabLabel(tab: BrowserTab): string {
    if (tab.title) return tab.title;
    if (!tab.url) return "";
    try {
        return new URL(tab.url).hostname.replace(/^www\./, "");
    }
    catch {
        return tab.url;
    }
}

type BrowserChromeProps = {
    language: LanguageCode;
    tabs: BrowserTab[];
    activeTabId: string;
    address: string;
    addressDirty: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    pageUrl: string;
    onAddressChange: (value: string) => void;
    onSubmit: () => void;
    onBack: () => void;
    onForward: () => void;
    onReload: () => void;
    onNewTab: () => void;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onClose: () => void;
    expanded: boolean;
    onToggleExpanded: () => void;
    bookmarked: boolean;
    onToggleBookmark: () => void;
    onOpenPanel: () => void;
    keyboardOpen: boolean;
    atTabLimit: boolean;
    findCount: { total: number; current: number } | null;
    onFind: (text: string, backwards: boolean) => void;
    onStopFind: () => void;
};

export function BrowserChrome(props: BrowserChromeProps) {
    const {
        language, tabs, activeTabId, address, addressDirty,
        canGoBack, canGoForward, pageUrl, onAddressChange, onSubmit, onBack, onForward,
        onReload, onNewTab, onSelectTab, onCloseTab, onClose, expanded, onToggleExpanded,
        bookmarked, onToggleBookmark, onOpenPanel, keyboardOpen, atTabLimit,
        findCount, onFind, onStopFind
    } = props;

    const [editing, setEditing] = useState(false);
    const [finding, setFinding] = useState(false);
    const [findEditing, setFindEditing] = useState(false);
    const [query, setQuery] = useState("");
    const searchedRef = useRef("");
    const enterChannelRef = useRef<"" | "key" | "valve">("");
    const typing = editing || findEditing;

    const openFindField = () => {
        enterChannelRef.current = "";
        setFindEditing(true);
    };

    const submitFind = (channel: "key" | "valve") => {
        const last = enterChannelRef.current;
        if (last && last !== channel) {
            enterChannelRef.current = "";
            return;
        }
        enterChannelRef.current = channel;
        runFind(false);
    };
    const stripRef = useRef<HTMLDivElement | null>(null);
    const [offStrip, setOffStrip] = useState({ before: 0, after: 0 });

    const measureStrip = useCallback(() => {
        const strip = stripRef.current;
        if (!strip) {
            setOffStrip({ before: 0, after: 0 });
            return;
        }
        const left = strip.scrollLeft;
        const right = left + strip.clientWidth;
        let before = 0;
        let after = 0;
        for (const child of Array.from(strip.children) as HTMLElement[]) {
            if (child.offsetLeft < left - 1) {
                before += 1;
            }
            else if (child.offsetLeft + child.offsetWidth > right + 1) {
                after += 1;
            }
        }
        setOffStrip((current) => (current.before === before && current.after === after ? current : { before, after }));
    }, []);

    useLayoutEffect(measureStrip, [measureStrip, tabs]);

    useLayoutEffect(() => {
        const strip = stripRef.current;
        const index = tabs.findIndex((tab) => tab.id === activeTabId);
        const node = index < 0 ? null : (strip?.children[index] as HTMLElement | undefined);
        if (!strip || !node) {
            return;
        }
        const left = strip.scrollLeft;
        const width = strip.clientWidth;
        if (node.offsetLeft < left) {
            strip.scrollLeft = node.offsetLeft;
        }
        else if (node.offsetLeft + node.offsetWidth > left + width) {
            strip.scrollLeft = node.offsetLeft + node.offsetWidth - width;
        }
        measureStrip();
    }, [activeTabId, measureStrip, tabs]);

    useEffect(() => {
        const strip = stripRef.current;
        const win = strip?.ownerDocument?.defaultView as any;
        if (!strip || !win?.ResizeObserver) {
            return;
        }
        const observer = new win.ResizeObserver(measureStrip);
        observer.observe(strip);
        return () => observer.disconnect();
    }, [measureStrip, tabs.length]);

    const scrollStrip = (direction: number) => {
        const strip = stripRef.current;
        if (!strip) {
            return;
        }
        const left = strip.scrollLeft;
        const width = strip.clientWidth;
        const children = Array.from(strip.children) as HTMLElement[];
        if (direction > 0) {
            const next = children.find((child) => child.offsetLeft + child.offsetWidth > left + width + 1);
            if (next) {
                strip.scrollLeft = next.offsetLeft + next.offsetWidth - width;
            }
            return;
        }
        const previous = [...children].reverse().find((child) => child.offsetLeft < left - 1);
        if (previous) {
            strip.scrollLeft = previous.offsetLeft;
        }
    };

    useEffect(() => {
        setEditing(false);
        setFindEditing(false);
    }, [pageUrl]);

    const runFind = (backwards: boolean) => {
        const text = query.trim();
        if (!text) {
            return;
        }
        searchedRef.current = text;
        onFind(text, backwards);
    };

    const keyboardWasOpenRef = useRef(false);
    useEffect(() => {
        if (keyboardWasOpenRef.current && !keyboardOpen && typing) {
            setEditing(false);
            if (findEditing) {
                setFindEditing(false);
                if (query.trim() !== searchedRef.current) {
                    runFind(false);
                }
            }
        }
        keyboardWasOpenRef.current = keyboardOpen;
    }, [keyboardOpen, typing]);

    const iconPx = modalSize(15);
    const gap = `${modalSize(4)}px`;

    const press = useBrowserPress();

    const act = (key: string, action: () => void) => press(key, () => {
        setEditing(false);
        setFindEditing(false);
        action();
    });

    const toggleFind = press("find", () => {
        setEditing(false);
        setFindEditing(false);
        if (finding) {
            setFinding(false);
            searchedRef.current = "";
            onStopFind();
            return;
        }
        setFinding(true);
        openFindField();
    });

    const commit = press("commit", () => {
        setEditing(false);
        onSubmit();
    });

    const fieldRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const win = fieldRef.current?.ownerDocument?.defaultView;
        if (!typing || !win) {
            return;
        }
        const frame = win.requestAnimationFrame(() => {
            fieldRef.current?.querySelector<HTMLElement>("input")?.click();
        });
        return () => win.cancelAnimationFrame(frame);
    }, [typing]);

    return (
        <Focusable
            focusable={false}
            childFocusDisabled={!typing}
            style={{ display: "flex", flexDirection: "column", flex: "0 0 auto" }}
        >
            <div style={{ display: "flex", alignItems: "center", gap, padding: gap }}>
                <DialogButton
                    focusable={false}
                    {...act("back", () => { if (canGoBack && !finding) onBack(); })}
                    style={iconButtonStyle(!canGoBack || finding)}
                >
                    <FaArrowLeft size={iconPx} />
                </DialogButton>
                <DialogButton
                    focusable={false}
                    {...act("forward", () => { if (canGoForward && !finding) onForward(); })}
                    style={iconButtonStyle(!canGoForward || finding)}
                >
                    <FaArrowRight size={iconPx} />
                </DialogButton>

                <div style={{ flex: "1 1 auto", minWidth: "0" }} ref={fieldRef}>
                    {finding ? (findEditing ? (
                        <TextField
                            autoFocus
                            value={query}
                            placeholder={t(language, "Find in page")}
                            onFocus={(e: { target?: { select?: () => void } }) => e?.target?.select?.()}
                            onChange={(e: { target: { value: string } }) => setQuery(e.target.value)}
                            onEnterKeyPress={() => submitFind("valve")}
                            onKeyDown={(e: { key?: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
                                if (e?.key === "Enter") {
                                    e.preventDefault?.();
                                    e.stopPropagation?.();
                                    submitFind("key");
                                }
                            }}
                        />
                    ) : (
                        <DialogButton
                            focusable={false}
                            {...press("find:edit", openFindField)}
                            style={{
                                width: "100%",
                                minWidth: "0",
                                height: `${modalSize(CONTROL_HEIGHT_PX)}px`,
                                display: "flex",
                                alignItems: "center",
                                gap: `${modalSize(8)}px`,
                                padding: `0 ${modalSize(10)}px`,
                                fontSize: `${modalSize(13)}px`,
                                textAlign: "left"
                            }}
                        >
                            <span
                                style={{
                                    flex: "1 1 auto",
                                    minWidth: "0",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    opacity: query ? "1" : "0.6"
                                }}
                            >
                                {query || t(language, "Find in page")}
                            </span>
                            {findCount && (
                                <span style={{ flex: "0 0 auto", opacity: findCount.total ? "0.8" : "0.45" }}>
                                    {`${findCount.current}/${findCount.total}`}
                                </span>
                            )}
                        </DialogButton>
                    )) : editing ? (
                        <TextField
                            autoFocus
                            value={address}
                            placeholder={t(language, "Search or enter address")}
                            onFocus={(e: { target?: { select?: () => void } }) => e?.target?.select?.()}
                            onChange={(e: { target: { value: string } }) => onAddressChange(e.target.value)}
                            onKeyDown={(e: { key?: string }) => {
                                if (e?.key === "Enter") {
                                    commit.onClick();
                                }
                            }}
                        />
                    ) : (
                        <DialogButton
                            focusable={false}
                            {...press("address", () => setEditing(true))}
                            style={{
                                width: "100%",
                                minWidth: "0",
                                height: `${modalSize(CONTROL_HEIGHT_PX)}px`,
                                display: "flex",
                                alignItems: "center",
                                padding: `0 ${modalSize(10)}px`,
                                fontSize: `${modalSize(13)}px`,
                                textAlign: "left",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                opacity: address ? "1" : "0.6"
                            }}
                        >
                            {address || t(language, "Search or enter address")}
                        </DialogButton>
                    )}
                </div>

                <DialogButton focusable={false} {...toggleFind} style={iconButtonStyle(false, finding)}>
                    <FaSearch size={iconPx} />
                </DialogButton>

                {finding && (
                    <>
                        <DialogButton
                            focusable={false}
                            {...act("find:previous", () => runFind(true))}
                            style={iconButtonStyle(!findCount?.total)}
                        >
                            <FaChevronUp size={iconPx} />
                        </DialogButton>
                        <DialogButton
                            focusable={false}
                            {...act("find:next", () => runFind(false))}
                            style={iconButtonStyle(!findCount?.total)}
                        >
                            <FaChevronDown size={iconPx} />
                        </DialogButton>
                    </>
                )}

                {!finding && (
                    <>
                        <DialogButton
                            focusable={false}
                            {...(editing || addressDirty ? commit : act("reload", onReload))}
                            style={iconButtonStyle()}
                        >
                            {editing || addressDirty ? <FaArrowRight size={iconPx} /> : <FaSyncAlt size={iconPx} />}
                        </DialogButton>

                        <DialogButton
                            focusable={false}
                            {...act("bookmark", onToggleBookmark)}
                            style={iconButtonStyle(!pageUrl)}
                        >
                            {bookmarked ? <FaStar size={iconPx} /> : <FaRegStar size={iconPx} />}
                        </DialogButton>
                        <DialogButton focusable={false} {...act("panel", onOpenPanel)} style={iconButtonStyle()}>
                            <FaBars size={iconPx} />
                        </DialogButton>
                        <DialogButton
                            focusable={false}
                            {...act("newtab", () => { if (!atTabLimit) onNewTab(); })}
                            style={iconButtonStyle(atTabLimit)}
                        >
                            <FaPlus size={iconPx} />
                        </DialogButton>
                        <DialogButton focusable={false} {...act("expand", onToggleExpanded)} style={iconButtonStyle()}>
                            {expanded ? <FaWindowRestore size={iconPx} /> : <FaWindowMaximize size={iconPx} />}
                        </DialogButton>
                        <DialogButton focusable={false} {...act("close", onClose)} style={iconButtonStyle()}>
                            <FaTimes size={iconPx} />
                        </DialogButton>
                    </>
                )}
            </div>

            {atTabLimit && (
                <div style={{ padding: `0 ${gap} ${gap}`, fontSize: `${modalSize(11)}px`, opacity: 0.7 }}>
                    {t(language, "Every tab is in use. Close one to open another.")}
                </div>
            )}

            {tabs.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap, padding: `0 ${gap} ${gap}` }}>
                    <DialogButton
                        focusable={false}
                        {...act("strip:before", () => { if (offStrip.before > 0) scrollStrip(-1); })}
                        style={stepButtonStyle(offStrip.before === 0)}
                    >
                        <FaChevronLeft size={modalSize(10)} />
                        {offStrip.before > 0 && <span>{offStrip.before}</span>}
                    </DialogButton>

                    <div
                        ref={stripRef}
                        onScroll={measureStrip}
                        style={{
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            gap,
                            flex: "1 1 auto",
                            minWidth: "0",
                            overflowX: "auto",
                            scrollBehavior: "smooth"
                        }}
                    >
                        {tabs.map((tab) => (
                            <DialogButton
                                key={tab.id}
                                focusable={false}
                                {...act("tab:select", () => onSelectTab(tab.id))}
                                style={{
                                    minWidth: `${modalSize(TAB_MIN_WIDTH_PX)}px`,
                                    maxWidth: `${modalSize(TAB_MAX_WIDTH_PX)}px`,
                                    flex: "0 0 auto",
                                    height: `${modalSize(TAB_HEIGHT_PX)}px`,
                                    padding: `0 ${modalSize(4)}px 0 ${modalSize(8)}px`,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: `${modalSize(4)}px`,
                                    fontSize: `${modalSize(12)}px`,
                                    opacity: tab.id === activeTabId ? "1" : "0.6"
                                }}
                            >
                                <span
                                    style={{
                                        flex: "1 1 auto",
                                        minWidth: "0",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        textAlign: "left"
                                    }}
                                >
                                    {tabLabel(tab) || t(language, "New Tab")}
                                </span>
                                <span
                                    role="button"
                                    onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation();
                                        press("tab:close", () => onCloseTab(tab.id)).onClick(e);
                                    }}
                                    style={{
                                        flex: "0 0 auto",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        width: `${modalSize(18)}px`,
                                        height: `${modalSize(18)}px`,
                                        borderRadius: "50%",
                                        opacity: 0.7
                                    }}
                                >
                                    <FaTimes size={modalSize(9)} />
                                </span>
                            </DialogButton>
                        ))}
                    </div>

                    <DialogButton
                        focusable={false}
                        {...act("strip:after", () => { if (offStrip.after > 0) scrollStrip(1); })}
                        style={stepButtonStyle(offStrip.after === 0)}
                    >
                        {offStrip.after > 0 && <span>{offStrip.after}</span>}
                        <FaChevronRight size={modalSize(10)} />
                    </DialogButton>
                </div>
            )}
        </Focusable>
    );
}
