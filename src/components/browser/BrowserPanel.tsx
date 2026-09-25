import { useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, TextField } from "@decky/ui";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import {
    FaCheck,
    FaCheckCircle,
    FaChevronDown,
    FaChevronRight,
    FaFolder,
    FaFolderPlus,
    FaMinus,
    FaPen,
    FaPlus,
    FaRegCircle,
    FaTimes,
    FaTrash
} from "react-icons/fa";
import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { browserHistoryRetentionLabel, browserOptionLabels, browserSiteLabel } from "../../utils/options";
import { canClearBrowsingData, clearBrowsingData } from "./browserViewHost";
import { useBrowserPress } from "../../hooks/useBrowserPress";
import { BrowserScrollArea } from "./BrowserScrollArea";
import { BrowserDownloadFolder } from "./BrowserDownloadFolder";
import { useWindowedList } from "../../hooks/useWindowedList";
import { DEFAULT_BOOKMARK_CATEGORY_ID } from "../../hooks/useBrowserController";
import type {
    BrowserBookmark,
    BrowserBookmarkCategory,
    BrowserHistoryEntry,
    BrowserHistoryRetention,
    BrowserNewTabPage,
    BrowserPanelTab,
    BrowserSearchEngine
} from "../../types";

const ROW_HEIGHT_PX = 44;

const INITIAL_ROWS = 20;

const ROW_STEP = 20;

const SENTINEL_ROOT_MARGIN = "400px";

const cellStyle: Record<string, string> = { flex: "0 0 auto", minWidth: "0" };

function squareStyle(size: number): Record<string, string> {
    return {
        minWidth: "0",
        width: `${modalSize(size)}px`,
        padding: "0",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    };
}

const wideActionStyle: Record<string, string> = {
    minWidth: "0",
    padding: `0 ${modalSize(10)}px`,
    fontSize: `${modalSize(13)}px`
};

const settingRowStyle: Record<string, string> = {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: `${modalSize(6)}px`,
    flex: "0 0 auto",
    fontSize: `${modalSize(15)}px`
};

const noteStyle: Record<string, string> = {
    flex: "0 0 auto",
    fontSize: `${modalSize(13)}px`,
    opacity: "0.6",
    padding: `0 ${modalSize(2)}px`
};

const settingCardStyle: Record<string, string> = {
    display: "flex",
    flexDirection: "column",
    gap: `${modalSize(6)}px`,
    flex: "0 0 auto",
    padding: `${modalSize(8)}px`,
    borderRadius: `${modalSize(4)}px`,
    background: "rgba(255, 255, 255, 0.05)"
};

const CATEGORY_HEIGHT_PX = 36;

const CLEAR_RANGE_DAYS = [1, 7, 30, 90, 0];

function clearRangeLabel(days: number, language: LanguageCode): string {
    switch (days) {
        case 1:
            return t(language, "Last 24 Hours");
        case 7:
            return t(language, "Last 7 Days");
        case 30:
            return t(language, "Last 30 Days");
        case 90:
            return t(language, "Last 90 Days");
        default:
            return t(language, "All Time");
    }
}

function dayKey(when: Date): string {
    return `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
}

function dayLabel(when: Date, now: Date, language: LanguageCode): string {
    const key = dayKey(when);
    if (key === dayKey(now)) {
        return t(language, "Today");
    }
    if (key === dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
        return t(language, "Yesterday");
    }
    return when.toLocaleDateString(language === "en" ? undefined : language, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: when.getFullYear() === now.getFullYear() ? undefined : "numeric"
    });
}

const ACTION_PX = 38;

const ROW_GAP_PX = 4;

const RAIL_PX = 44;

const categoryButtonStyle: Record<string, string> = {
    minWidth: "0",
    width: "100%",
    height: "100%",
    padding: `0 ${modalSize(8)}px`,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: `${modalSize(6)}px`,
    fontSize: `${modalSize(13)}px`,
    overflow: "hidden"
};

function categoryIconStyle(dimmed = false): Record<string, string> {
    return {
        ...squareStyle(ACTION_PX),
        height: "100%",
        opacity: dimmed ? "0.25" : "1"
    };
}

function ghostSlot(key: string) {
    return (
        <div key={key} style={cellStyle}>
            <DialogButton
                focusable={false}
                style={{ ...squareStyle(ACTION_PX), height: "100%", visibility: "hidden" }}
            />
        </div>
    );
}

function actionRowStyle(height: number, grow = false): Record<string, string> {
    return {
        display: "flex",
        alignItems: "stretch",
        gap: `${modalSize(ROW_GAP_PX)}px`,
        flex: "0 0 auto",
        ...(grow
            ? { minHeight: `${modalSize(height)}px` }
            : { height: `${modalSize(height)}px` }),
        boxSizing: "border-box"
    };
}

function displayUrl(url: string): string {
    return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    }
    catch {
        return url;
    }
}

type EditKind = "add" | "rename" | "delete" | "mark" | "clear" | "home" | "search" | "wipe";

type BrowserPanelProps = {
    language: LanguageCode;
    tab: BrowserPanelTab;
    bookmarks: BrowserBookmark[];
    categories: BrowserBookmarkCategory[];
    defaultCategoryId: string;
    collapsed: string[];
    maxCategories: number;
    history: BrowserHistoryEntry[];
    onPick: (url: string) => void;
    onPickHistory: (url: string) => void;
    onSetTab: (tab: BrowserPanelTab) => void;
    onRemoveBookmark: (bookmarkId: string) => void;
    onRenameBookmark: (bookmarkId: string, title: string) => void;
    onAddCategory: (name: string) => void;
    onRenameCategory: (categoryId: string, name: string) => void;
    onRemoveCategory: (categoryId: string) => void;
    onMakeDefaultCategory: (categoryId: string) => void;
    onSetCategoryCollapsed: (categoryId: string, collapsed: boolean) => void;
    keyboardOpen: boolean;
    onRemoveHistoryEntry: (entryId: string) => void;
    onClearHistory: (days: number) => void;
    onCloseAllTabs: () => void;
    tabCount: number;
    pageZoom: number;
    onStepZoom: (direction: number) => void;
    historyRetention: BrowserHistoryRetention;
    onCycleHistoryRetention: () => void;
    searchEngine: BrowserSearchEngine;
    onCycleSearchEngine: () => void;
    newTabPage: BrowserNewTabPage;
    customNewTabUrl: string;
    onCycleNewTabPage: () => void;
    onSetCustomNewTabUrl: (text: string) => void;
    customSearchUrl: string;
    onSetCustomSearchUrl: (text: string) => void;
    openLinksInNewTab: boolean;
    onToggleOpenLinksInNewTab: () => void;
    blockAds: boolean;
    onToggleBlockAds: () => void;
    fastForwardYouTubeAds: boolean;
    onToggleFastForwardYouTubeAds: () => void;
    downloadFolder: string;
    onSetDownloadFolder: (path: string) => void;
    rememberDownloadFolder: boolean;
    onToggleRememberDownloadFolder: () => void;
    onClose: () => void;
};

export function BrowserPanel(props: BrowserPanelProps) {
    const {
        language, tab, bookmarks, categories, defaultCategoryId, collapsed, maxCategories, history, onPick, onPickHistory, onSetTab,
        onRemoveBookmark, onRenameBookmark, onAddCategory, onRenameCategory, onRemoveCategory, onMakeDefaultCategory, onSetCategoryCollapsed,
        onRemoveHistoryEntry, onClearHistory, onCloseAllTabs, tabCount, keyboardOpen,
        pageZoom, onStepZoom, historyRetention, onCycleHistoryRetention, onClose,
        searchEngine, onCycleSearchEngine, customSearchUrl, onSetCustomSearchUrl,
        newTabPage, customNewTabUrl, onCycleNewTabPage, onSetCustomNewTabUrl,
        openLinksInNewTab, onToggleOpenLinksInNewTab,
        blockAds, onToggleBlockAds, fastForwardYouTubeAds, onToggleFastForwardYouTubeAds,
        downloadFolder, onSetDownloadFolder, rememberDownloadFolder, onToggleRememberDownloadFolder
    } = props;

    const act = useBrowserPress();

    const [editing, setEditing] = useState<{ kind: EditKind; id: string } | null>(null);
    const [draft, setDraft] = useState("");

    const typing = editing?.kind === "add" || editing?.kind === "rename" || editing?.kind === "mark"
        || editing?.kind === "home" || editing?.kind === "search";

    const closeEditor = () => {
        setEditing(null);
        setDraft("");
    };

    const openEditor = (kind: EditKind, id: string, text: string) => {
        setEditing({ kind, id });
        setDraft(text);
    };

    const [choosingFolder, setChoosingFolder] = useState(false);

    useEffect(() => {
        setEditing(null);
        setDraft("");
        setChoosingFolder(false);
    }, [tab]);

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
    }, [typing, editing?.id]);


    const gap = `${modalSize(6)}px`;

    const grouped = useMemo(() => {
        const byCategory = new Map<string, BrowserBookmark[]>();
        for (const category of categories) {
            byCategory.set(category.id, []);
        }
        for (const row of bookmarks) {
            byCategory.get(row.categoryId)?.push(row);
        }
        return categories.map((category) => ({ category, rows: byCategory.get(category.id) ?? [] }));
    }, [bookmarks, categories]);

    const flatMarks = useMemo(() => {
        const out: BrowserBookmark[] = [];
        for (const group of grouped) {
            if (collapsed.includes(group.category.id)) {
                continue;
            }
            out.push(...group.rows);
        }
        return out;
    }, [collapsed, grouped]);

    const days = useMemo(() => {
        const now = new Date();
        const byDay = new Map<string, { key: string; label: string; rows: BrowserHistoryEntry[] }>();
        for (const entry of history) {
            const when = new Date(entry.visitedAt * 1000);
            const key = dayKey(when);
            let day = byDay.get(key);
            if (!day) {
                day = { key, label: dayLabel(when, now, language), rows: [] };
                byDay.set(key, day);
            }
            day.rows.push(entry);
        }
        return [...byDay.values()];
    }, [history, language]);

    const [shutDays, setShutDays] = useState<string[]>([]);

    const flatVisits = useMemo(() => {
        const out: BrowserHistoryEntry[] = [];
        for (const day of days) {
            if (!shutDays.includes(day.key)) {
                out.push(...day.rows);
            }
        }
        return out;
    }, [days, shutDays]);

    let rows: { id: string; url: string; title: string }[] = [];
    if (tab === "bookmarks") {
        rows = flatMarks;
    }
    else if (tab === "history") {
        rows = flatVisits;
    }

    const controlHeight = `${modalSize(ACTION_PX)}px`;

    const controlTextStyle: Record<string, string> = {
        height: controlHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    };

    const optionStyle = { ...wideActionStyle, ...controlTextStyle };

    const optionLabels = [...browserOptionLabels(language), t(language, "On"), t(language, "Off"), t(language, "Close All Tabs")];
    const sizedLabel = (current: string) => (
        <span style={{ display: "grid", justifyItems: "center" }}>
            {optionLabels.map((label) => (
                <span key={label} style={{ gridArea: "1 / 1", visibility: label === current ? "visible" : "hidden" }}>
                    {label}
                </span>
            ))}
        </span>
    );

    const pillStyle = (selected: boolean): Record<string, string> => ({
        minWidth: "0",
        ...controlTextStyle,
        padding: `0 ${modalSize(12)}px`,
        fontSize: `${modalSize(13)}px`,
        opacity: selected ? "1" : "0.55"
    });

    const window_ = useWindowedList({
        items: rows,
        dynamicLoading: true,
        initialRows: INITIAL_ROWS,
        rowStep: ROW_STEP,
        prefetchDistance: 0,
        sentinelRootMargin: SENTINEL_ROOT_MARGIN,
        resetKey: tab
    });

    const mountedCount = window_.mountedItems.length;
    const unmountedPx = (rows.length - mountedCount) * modalSize(ROW_HEIGHT_PX + 3);

    let flatStart = 0;
    const categorySlices = grouped.map((group) => {
        const isCollapsed = collapsed.includes(group.category.id);
        const start = flatStart;
        if (!isCollapsed) {
            flatStart += group.rows.length;
        }
        const reach = isCollapsed ? 0 : Math.max(0, Math.min(group.rows.length, mountedCount - start));
        return { collapsed: isCollapsed, reach };
    });

    let visitStart = 0;
    const daySlices = days.map((day) => {
        const isShut = shutDays.includes(day.key);
        const start = visitStart;
        if (!isShut) {
            visitStart += day.rows.length;
        }
        const reach = isShut ? 0 : Math.max(0, Math.min(day.rows.length, mountedCount - start));
        return { collapsed: isShut, reach };
    });

    const toggleDay = (key: string) => {
        setShutDays((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
    };

    const [clearRange, setClearRange] = useState(0);
    const clearDays = CLEAR_RANGE_DAYS[clearRange];
    const clearCutoff = Math.floor(Date.now() / 1000) - clearDays * 86400;
    let clearCount = 0;
    if (editing?.kind === "clear") {
        clearCount = clearDays === 0
            ? history.length
            : history.filter((entry) => entry.visitedAt >= clearCutoff).length;
    }

    const atCategoryLimit = maxCategories > 0 && categories.length >= maxCategories;

    const toggleCollapsed = (categoryId: string) => {
        onSetCategoryCollapsed(categoryId, !collapsed.includes(categoryId));
    };

    const commitDraft = () => {
        const name = draft.trim();
        const open = editing;
        closeEditor();
        if (!open || !name) {
            return;
        }
        if (open.kind === "add") {
            onAddCategory(name);
            return;
        }
        if (open.kind === "mark") {
            onRenameBookmark(open.id, name);
            return;
        }
        if (open.kind === "home") {
            onSetCustomNewTabUrl(name);
            return;
        }
        if (open.kind === "search") {
            onSetCustomSearchUrl(name);
            return;
        }
        const category = categories.find((row) => row.id === open.id);
        if (category && category.name !== name) {
            onRenameCategory(open.id, name);
        }
    };

    const commitName = act("cat:commit", commitDraft);

    const keyboardWasOpenRef = useRef(false);
    useEffect(() => {
        if (keyboardWasOpenRef.current && !keyboardOpen && typing) {
            commitDraft();
        }
        keyboardWasOpenRef.current = keyboardOpen;
    }, [keyboardOpen, typing]);

    const nameField = (placeholder: string, height: number) => (
        <div style={actionRowStyle(height)}>
            <div style={{ flex: "1 1 auto", minWidth: "0" }} ref={fieldRef}>
                <TextField
                    autoFocus
                    value={draft}
                    placeholder={placeholder}
                    onFocus={(e: { target?: { select?: () => void } }) => e?.target?.select?.()}
                    onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
                    onEnterKeyPress={commitDraft}
                    onKeyDown={(e: { key?: string }) => {
                        if (e?.key === "Enter" || e?.key === "NumpadEnter") {
                            commitDraft();
                        }
                    }}
                />
            </div>
            {ghostSlot("field")}
            <div style={cellStyle}>
                <DialogButton {...commitName} style={categoryIconStyle()}>
                    <FaCheck size={modalSize(12)} />
                </DialogButton>
            </div>
            <div style={cellStyle}>
                <DialogButton {...act("cat:abandon", closeEditor)} style={categoryIconStyle()}>
                    <FaTimes size={modalSize(12)} />
                </DialogButton>
            </div>
        </div>
    );

    const [wiped, setWiped] = useState(false);
    const canWipe = canClearBrowsingData();

    const customUrlRow = (kind: "home" | "search", url: string, placeholder: string) => {
        if (editing?.kind === kind) {
            return nameField(placeholder, ROW_HEIGHT_PX);
        }
        return (
            <div style={actionRowStyle(ROW_HEIGHT_PX)}>
                <div style={{ flex: "1 1 auto", minWidth: "0" }}>
                    <DialogButton {...act(`${kind}:edit`, () => openEditor(kind, "", url))} style={categoryButtonStyle}>
                        <FaPen size={modalSize(11)} />
                        <span
                            style={{
                                flex: "1 1 auto",
                                minWidth: "0",
                                textAlign: "left",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                opacity: url ? "1" : "0.6"
                            }}
                        >
                            {url ? displayUrl(url) : t(language, "Enter an address")}
                        </span>
                    </DialogButton>
                </div>
            </div>
        );
    };

    const linkRow = (row: { id: string; url: string; title: string }) => {
        if (tab === "bookmarks" && editing?.kind === "mark" && editing.id === row.id) {
            return <div key={row.id}>{nameField(t(language, "Bookmark name"), ROW_HEIGHT_PX)}</div>;
        }
        return (
        <div key={row.id} style={actionRowStyle(ROW_HEIGHT_PX)}>
            <div style={{ flex: "1 1 auto", minWidth: "0" }}>
                <DialogButton
                    {...act("row:pick", () => (tab === "bookmarks" ? onPick(row.url) : onPickHistory(row.url)))}
                    style={{
                        minWidth: "0",
                        width: "100%",
                        height: "100%",
                        boxSizing: "border-box",
                        padding: `0 ${modalSize(10)}px`,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        justifyContent: "center",
                        overflow: "hidden"
                    }}
                >
                    <div
                        style={{
                            fontSize: `${modalSize(13)}px`,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            width: "100%",
                            textAlign: "left"
                        }}
                    >
                        {row.title || hostOf(row.url)}
                    </div>
                    <div
                        style={{
                            fontSize: `${modalSize(11)}px`,
                            opacity: 0.6,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            width: "100%",
                            textAlign: "left"
                        }}
                    >
                        {displayUrl(row.url)}
                    </div>
                </DialogButton>
            </div>
            {tab === "bookmarks" && ghostSlot("row1")}
            {tab === "bookmarks" && (
                <div style={cellStyle}>
                    <DialogButton
                        {...act("row:rename", () => openEditor("mark", row.id, row.title))}
                        style={{ ...squareStyle(ACTION_PX), height: "100%" }}
                    >
                        <FaPen size={modalSize(11)} />
                    </DialogButton>
                </div>
            )}
            <div style={cellStyle}>
                <DialogButton
                    {...act("row:remove", () => (tab === "bookmarks" ? onRemoveBookmark(row.id) : onRemoveHistoryEntry(row.id)))}
                    style={{ ...squareStyle(ACTION_PX), height: "100%" }}
                >
                    <FaTrash size={modalSize(12)} />
                </DialogButton>
            </div>
        </div>
        );
    };

    const header = (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap,
                flex: "0 0 auto"
            }}
        >
            <div style={cellStyle}>
                <DialogButton {...act("tab:bookmarks", () => onSetTab("bookmarks"))} style={pillStyle(tab === "bookmarks")}>
                    {t(language, "Bookmarks")}
                </DialogButton>
            </div>
            <div style={cellStyle}>
                <DialogButton {...act("tab:history", () => onSetTab("history"))} style={pillStyle(tab === "history")}>
                    {t(language, "History")}
                </DialogButton>
            </div>
            <div style={cellStyle}>
                <DialogButton {...act("tab:options", () => onSetTab("options"))} style={pillStyle(tab === "options")}>
                    {t(language, "Options")}
                </DialogButton>
            </div>
            <div
                style={{
                    flex: "0 0 auto",
                    width: "1px",
                    height: `${modalSize(22)}px`,
                    background: "rgba(255, 255, 255, 0.25)"
                }}
            />
            <div style={cellStyle}>
                <DialogButton {...act("close", onClose)} style={{ ...squareStyle(ACTION_PX), height: controlHeight }}>
                    <FaTimes size={modalSize(14)} />
                </DialogButton>
            </div>

            <div style={{ flex: "1 1 auto" }} />

            {tab === "history" && history.length > 0 && (
                <div style={cellStyle}>
                    <DialogButton
                        {...act("clearhistory", () => {
                            setClearRange(0);
                            openEditor("clear", "", "");
                        })}
                        style={{ ...wideActionStyle, ...controlTextStyle }}
                    >
                        {t(language, "Clear History")}
                    </DialogButton>
                </div>
            )}
        </div>
    );

    if (choosingFolder) {
        return (
            <BrowserDownloadFolder
                language={language}
                prompt={t(language, "Choose the folder downloads start in:")}
                confirmLabel={t(language, "Choose This Folder")}
                keyboardOpen={keyboardOpen}
                startPath={downloadFolder}
                onConfirm={(path) => {
                    setChoosingFolder(false);
                    onSetDownloadFolder(path);
                }}
                onCancel={() => setChoosingFolder(false)}
            />
        );
    }

    return (
        <Focusable
            focusable={false}
            childFocusDisabled={!typing}
            style={{
                display: "flex",
                flexDirection: "column",
                flex: "1 1 auto",
                minHeight: "0",
                width: "100%",
                boxSizing: "border-box",
                padding: `${modalSize(ROW_GAP_PX)}px`,
                gap
            }}
        >
            {tab === "options" && (
                <BrowserScrollArea railPx={RAIL_PX} gapPx={ROW_GAP_PX} rowGap={gap} unmountedPx={0} header={header}>
                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <div style={{ flex: "1 1 auto" }} />
                            <div style={cellStyle}>
                                <DialogButton
                                    {...act("closealltabs", () => {
                                        if (tabCount > 1) {
                                            onCloseAllTabs();
                                        }
                                    })}
                                    style={{ ...optionStyle, opacity: tabCount > 1 ? "1" : "0.35" }}
                                >
                                    {sizedLabel(t(language, "Close All Tabs"))}
                                </DialogButton>
                            </div>
                        </div>
                    </div>

                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <span style={{ opacity: 0.8, minWidth: "0" }}>{t(language, "Page Zoom")}</span>
                            <div style={{ flex: "1 1 auto" }} />
                            <div style={cellStyle}>
                                <DialogButton {...act("zoom:out", () => onStepZoom(-1))} style={{ ...squareStyle(ACTION_PX), height: controlHeight }}>
                                    <FaMinus size={modalSize(11)} />
                                </DialogButton>
                            </div>
                            <span style={{ minWidth: `${modalSize(44)}px`, textAlign: "center" }}>{`${pageZoom}%`}</span>
                            <div style={cellStyle}>
                                <DialogButton {...act("zoom:in", () => onStepZoom(1))} style={{ ...squareStyle(ACTION_PX), height: controlHeight }}>
                                    <FaPlus size={modalSize(11)} />
                                </DialogButton>
                            </div>
                        </div>
                    </div>

                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <span style={{ opacity: 0.8, minWidth: "0" }}>{t(language, "Search Engine")}</span>
                            <div style={{ flex: "1 1 auto" }} />
                            <div style={cellStyle}>
                                <DialogButton {...act("search:cycle", onCycleSearchEngine)} style={optionStyle}>
                                    {sizedLabel(browserSiteLabel(searchEngine, language))}
                                </DialogButton>
                            </div>
                        </div>
                        {searchEngine === "custom" && customUrlRow("search", customSearchUrl, "https://gamefaqs.gamespot.com/search?game=%s")}
                        {searchEngine === "custom" && <div style={noteStyle}>{t(language, "help_browser_custom_search")}</div>}
                    </div>

                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <span style={{ opacity: 0.8, minWidth: "0" }}>{t(language, "New Tab Page")}</span>
                            <div style={{ flex: "1 1 auto" }} />
                            <div style={cellStyle}>
                                <DialogButton {...act("home:cycle", onCycleNewTabPage)} style={optionStyle}>
                                    {sizedLabel(browserSiteLabel(newTabPage, language))}
                                </DialogButton>
                            </div>
                        </div>
                        {newTabPage === "custom" && customUrlRow("home", customNewTabUrl, "https://www.example.com/")}
                    </div>

                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <span style={{ opacity: 0.8, minWidth: "0" }}>{t(language, "Open Links in a New Tab")}</span>
                            <div style={{ flex: "1 1 auto" }} />
                            <div style={cellStyle}>
                                <DialogButton {...act("links:toggle", onToggleOpenLinksInNewTab)} style={optionStyle}>
                                    {sizedLabel(t(language, openLinksInNewTab ? "On" : "Off"))}
                                </DialogButton>
                            </div>
                        </div>
                        <div style={noteStyle}>{t(language, "help_browser_open_links")}</div>
                    </div>

                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <span style={{ opacity: 0.8, minWidth: "0" }}>{t(language, "Block Ads")}</span>
                            <div style={{ flex: "1 1 auto" }} />
                            <div style={cellStyle}>
                                <DialogButton {...act("ads:toggle", onToggleBlockAds)} style={optionStyle}>
                                    {sizedLabel(t(language, blockAds ? "On" : "Off"))}
                                </DialogButton>
                            </div>
                        </div>
                        <div style={noteStyle}>{t(language, "help_browser_block_ads")}</div>
                    </div>

                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <span style={{ opacity: 0.8, minWidth: "0" }}>{t(language, "Fast-forward YouTube Ads")}</span>
                            <div style={{ flex: "1 1 auto" }} />
                            <div style={cellStyle}>
                                <DialogButton {...act("ytads:toggle", onToggleFastForwardYouTubeAds)} style={optionStyle}>
                                    {sizedLabel(t(language, fastForwardYouTubeAds ? "On" : "Off"))}
                                </DialogButton>
                            </div>
                        </div>
                        <div style={noteStyle}>{t(language, "help_browser_fast_forward_youtube_ads")}</div>
                    </div>

                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <span style={{ opacity: 0.8, minWidth: "0" }}>{t(language, "Keep Browsing History")}</span>
                            <div style={{ flex: "1 1 auto" }} />
                            <div style={cellStyle}>
                                <DialogButton {...act("retention", onCycleHistoryRetention)} style={optionStyle}>
                                    {sizedLabel(browserHistoryRetentionLabel(historyRetention, language))}
                                </DialogButton>
                            </div>
                        </div>
                        <div style={noteStyle}>{t(language, "help_browser_history_retention")}</div>
                    </div>

                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <span style={{ opacity: 0.8, minWidth: "0" }}>{t(language, "Download Folder")}</span>
                        </div>
                        <div style={actionRowStyle(ROW_HEIGHT_PX)}>
                            <div style={{ flex: "1 1 auto", minWidth: "0" }}>
                                <DialogButton {...act("folder:choose", () => setChoosingFolder(true))} style={categoryButtonStyle}>
                                    <FaFolder size={modalSize(12)} />
                                    <span
                                        style={{
                                            flex: "1 1 auto",
                                            minWidth: "0",
                                            textAlign: "left",
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis"
                                        }}
                                    >
                                        {downloadFolder}
                                    </span>
                                </DialogButton>
                            </div>
                        </div>
                        <div style={noteStyle}>{t(language, "help_browser_download_folder")}</div>
                    </div>

                    <div style={settingCardStyle}>
                        <div style={settingRowStyle}>
                            <span style={{ opacity: 0.8, minWidth: "0" }}>{t(language, "Remember Last Folder")}</span>
                            <div style={{ flex: "1 1 auto" }} />
                            <div style={cellStyle}>
                                <DialogButton {...act("folder:remember", onToggleRememberDownloadFolder)} style={optionStyle}>
                                    {sizedLabel(t(language, rememberDownloadFolder ? "On" : "Off"))}
                                </DialogButton>
                            </div>
                        </div>
                        <div style={noteStyle}>{t(language, "help_browser_remember_download_folder")}</div>
                    </div>

                    {canWipe && (
                        <div style={settingCardStyle}>
                            {editing?.kind !== "wipe" && (
                                <div style={settingRowStyle}>
                                    <span style={{ opacity: 0.8, minWidth: "0" }}>
                                        {wiped ? t(language, "Browsing data cleared.") : ""}
                                    </span>
                                    <div style={{ flex: "1 1 auto" }} />
                                    <div style={cellStyle}>
                                        <DialogButton {...act("wipe:open", () => openEditor("wipe", "", ""))} style={optionStyle}>
                                            {t(language, "Clear Browsing Data")}
                                        </DialogButton>
                                    </div>
                                </div>
                            )}
                            {editing?.kind === "wipe" && (
                                <div style={actionRowStyle(CATEGORY_HEIGHT_PX, true)}>
                                    <div
                                        style={{
                                            flex: "1 1 auto",
                                            minWidth: "0",
                                            display: "flex",
                                            alignItems: "center",
                                            fontSize: `${modalSize(12)}px`,
                                            padding: `${modalSize(4)}px 0`,
                                            overflowWrap: "anywhere"
                                        }}
                                    >
                                        {t(language, "Clear all of Steam's browsing data? This signs you out of every website in Steam.")}
                                    </div>
                                    <div style={cellStyle}>
                                        <DialogButton
                                            {...act("wipe:confirm", () => {
                                                closeEditor();
                                                setWiped(clearBrowsingData());
                                            })}
                                            style={wideActionStyle}
                                        >
                                            {t(language, "Clear")}
                                        </DialogButton>
                                    </div>
                                    <div style={cellStyle}>
                                        <DialogButton {...act("wipe:keep", closeEditor)} style={wideActionStyle}>
                                            {t(language, "Cancel")}
                                        </DialogButton>
                                    </div>
                                </div>
                            )}
                            <div style={noteStyle}>{t(language, "help_browser_clear_data")}</div>
                        </div>
                    )}
                </BrowserScrollArea>
            )}

            {tab === "bookmarks" && (
            <BrowserScrollArea railPx={RAIL_PX} gapPx={ROW_GAP_PX} rowGap={`${modalSize(3)}px`} unmountedPx={unmountedPx} header={header}>
                {editing?.kind === "add" ? nameField(t(language, "Category name"), CATEGORY_HEIGHT_PX) : (
                    <div style={actionRowStyle(CATEGORY_HEIGHT_PX)}>
                        <div style={{ flex: "1 1 auto", minWidth: "0" }}>
                            <DialogButton
                                {...act("cat:new", () => {
                                    if (!atCategoryLimit) {
                                        openEditor("add", "", "");
                                    }
                                })}
                                style={{ ...categoryButtonStyle, opacity: atCategoryLimit ? "0.35" : "1" }}
                            >
                                <FaFolderPlus size={modalSize(12)} />
                                {t(language, "New Category")}
                            </DialogButton>
                        </div>
                        {ghostSlot("new1")}
                        {ghostSlot("new2")}
                        {ghostSlot("new3")}
                    </div>
                )}

                {grouped.map((group, index) => {
                    const category = group.category;
                    const slice = categorySlices[index];
                    const reserved = category.id === DEFAULT_BOOKMARK_CATEGORY_ID;
                    const name = reserved ? t(language, "Default") : category.name;
                    const renaming = editing?.kind === "rename" && editing.id === category.id;
                    const confirming = editing?.kind === "delete" && editing.id === category.id;
                    return (
                        <div key={category.id} style={{ display: "flex", flexDirection: "column", flex: "0 0 auto", gap: `${modalSize(3)}px` }}>
                            {confirming && (
                                <div style={actionRowStyle(CATEGORY_HEIGHT_PX, true)}>
                                    <div
                                        style={{
                                            flex: "1 1 auto",
                                            minWidth: "0",
                                            display: "flex",
                                            alignItems: "center",
                                            fontSize: `${modalSize(12)}px`,
                                            padding: `${modalSize(4)}px 0`,
                                            overflowWrap: "anywhere"
                                        }}
                                    >
                                        {group.rows.length === 0
                                            ? t(language, "Delete {{name}}?", { name })
                                            : t(language, "Delete {{name}} and the {{count}} bookmarks in it?", { name, count: group.rows.length })}
                                    </div>
                                    <div style={cellStyle}>
                                        <DialogButton
                                            {...act("cat:confirm", () => {
                                                closeEditor();
                                                onRemoveCategory(category.id);
                                            })}
                                            style={wideActionStyle}
                                        >
                                            {t(language, "Delete")}
                                        </DialogButton>
                                    </div>
                                    <div style={cellStyle}>
                                        <DialogButton {...act("cat:keep", closeEditor)} style={wideActionStyle}>
                                            {t(language, "Cancel")}
                                        </DialogButton>
                                    </div>
                                </div>
                            )}

                            {renaming && nameField(t(language, "Category name"), CATEGORY_HEIGHT_PX)}

                            {!confirming && !renaming && (
                                <div style={actionRowStyle(CATEGORY_HEIGHT_PX)}>
                                    <div style={{ flex: "1 1 auto", minWidth: "0" }}>
                                        <DialogButton {...act("cat:toggle", () => toggleCollapsed(category.id))} style={categoryButtonStyle}>
                                            {slice.collapsed
                                                ? <FaChevronRight size={modalSize(10)} />
                                                : <FaChevronDown size={modalSize(10)} />}
                                            <span style={{ flex: "1 1 auto", minWidth: "0", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {name}
                                            </span>
                                            <span style={{ flex: "0 0 auto", opacity: 0.6 }}>{group.rows.length}</span>
                                        </DialogButton>
                                    </div>
                                    <div style={cellStyle}>
                                        <DialogButton {...act("cat:default", () => onMakeDefaultCategory(category.id))} style={categoryIconStyle()}>
                                            {category.id === defaultCategoryId
                                                ? <FaCheckCircle size={modalSize(13)} />
                                                : <FaRegCircle size={modalSize(13)} />}
                                        </DialogButton>
                                    </div>
                                    <div style={cellStyle}>
                                        <DialogButton
                                            {...act("cat:rename", () => {
                                                if (!reserved) {
                                                    openEditor("rename", category.id, category.name);
                                                }
                                            })}
                                            style={categoryIconStyle(reserved)}
                                        >
                                            <FaPen size={modalSize(11)} />
                                        </DialogButton>
                                    </div>
                                    <div style={cellStyle}>
                                        <DialogButton
                                            {...act("cat:remove", () => {
                                                if (!reserved) {
                                                    openEditor("delete", category.id, "");
                                                }
                                            })}
                                            style={categoryIconStyle(reserved)}
                                        >
                                            <FaTrash size={modalSize(11)} />
                                        </DialogButton>
                                    </div>
                                </div>
                            )}

                            <div style={{ display: "flex", flexDirection: "column", gap: `${modalSize(3)}px`, paddingLeft: `${modalSize(10)}px` }}>
                                {group.rows.slice(0, slice.reach).map(linkRow)}
                            </div>
                        </div>
                    );
                })}

                {bookmarks.length === 0 && (
                    <div style={{ padding: gap, fontSize: `${modalSize(13)}px`, opacity: 0.7 }}>
                        {t(language, "No bookmarks yet. Use the star to add a site to your bookmarks.")}
                    </div>
                )}

                {mountedCount < rows.length && (
                    <div ref={window_.markerRef} style={{ flex: "0 0 auto", height: "1px" }} />
                )}
            </BrowserScrollArea>
            )}

            {tab === "history" && (
            <BrowserScrollArea railPx={RAIL_PX} gapPx={ROW_GAP_PX} rowGap={`${modalSize(3)}px`} unmountedPx={unmountedPx} header={header}>
                {editing?.kind === "clear" && (
                    <div style={actionRowStyle(CATEGORY_HEIGHT_PX, true)}>
                        <div
                            style={{
                                flex: "1 1 auto",
                                minWidth: "0",
                                display: "flex",
                                alignItems: "center",
                                fontSize: `${modalSize(12)}px`,
                                padding: `${modalSize(4)}px 0`,
                                overflowWrap: "anywhere"
                            }}
                        >
                            {clearCount === 0
                                ? t(language, "Nothing to clear in this range.")
                                : t(language, "Clear {{count}} visits?", { count: clearCount })}
                        </div>
                        <div style={cellStyle}>
                            <DialogButton
                                {...act("clear:range", () => setClearRange((clearRange + 1) % CLEAR_RANGE_DAYS.length))}
                                style={wideActionStyle}
                            >
                                {clearRangeLabel(clearDays, language)}
                            </DialogButton>
                        </div>
                        <div style={cellStyle}>
                            <DialogButton
                                {...act("clear:confirm", () => {
                                    closeEditor();
                                    if (clearCount > 0) {
                                        onClearHistory(clearDays);
                                    }
                                })}
                                style={{ ...wideActionStyle, opacity: clearCount === 0 ? "0.35" : "1" }}
                            >
                                {t(language, "Clear")}
                            </DialogButton>
                        </div>
                        <div style={cellStyle}>
                            <DialogButton {...act("clear:keep", closeEditor)} style={wideActionStyle}>
                                {t(language, "Cancel")}
                            </DialogButton>
                        </div>
                    </div>
                )}

                {history.length === 0 && (
                    <div style={{ padding: gap, fontSize: `${modalSize(13)}px`, opacity: 0.7 }}>
                        {t(language, "Nothing in history yet.")}
                    </div>
                )}

                {days.map((day, index) => {
                    const slice = daySlices[index];
                    return (
                        <div key={day.key} style={{ display: "flex", flexDirection: "column", flex: "0 0 auto", gap: `${modalSize(3)}px` }}>
                            <div style={actionRowStyle(CATEGORY_HEIGHT_PX)}>
                                <div style={{ flex: "1 1 auto", minWidth: "0" }}>
                                    <DialogButton {...act("day:toggle", () => toggleDay(day.key))} style={categoryButtonStyle}>
                                        {slice.collapsed
                                            ? <FaChevronRight size={modalSize(10)} />
                                            : <FaChevronDown size={modalSize(10)} />}
                                        <span style={{ flex: "1 1 auto", minWidth: "0", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {day.label}
                                        </span>
                                        <span style={{ flex: "0 0 auto", opacity: 0.6 }}>{day.rows.length}</span>
                                    </DialogButton>
                                </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: `${modalSize(3)}px`, paddingLeft: `${modalSize(10)}px` }}>
                                {day.rows.slice(0, slice.reach).map(linkRow)}
                            </div>
                        </div>
                    );
                })}

                {mountedCount < rows.length && (
                    <div ref={window_.markerRef} style={{ flex: "0 0 auto", height: "1px" }} />
                )}
            </BrowserScrollArea>
            )}

        </Focusable>
    );
}
