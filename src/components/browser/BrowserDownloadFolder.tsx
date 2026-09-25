import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, TextField } from "@decky/ui";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaArrowUp, FaCheck, FaFolder, FaPen, FaTimes } from "react-icons/fa";
import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { getBrowserDownloadFolder, listDirectory } from "../../api";
import { logError } from "../../utils/errors";
import { useBrowserPress } from "../../hooks/useBrowserPress";
import { useWindowedList } from "../../hooks/useWindowedList";
import { BrowserScrollArea } from "./BrowserScrollArea";
import type { DirectoryEntry } from "../../types";

const ROW_HEIGHT_PX = 44;

const ROW_GAP_PX = 4;

const ACTION_PX = 38;

const RAIL_PX = 44;

const INITIAL_ROWS = 20;

const ROW_STEP = 20;

const SENTINEL_ROOT_MARGIN = "400px";

const cellStyle: Record<string, string> = { flex: "0 0 auto", minWidth: "0" };

type BrowserDownloadFolderProps = {
    language: LanguageCode;
    prompt: string;
    fileName?: string;
    confirmLabel: string;
    startPath?: string;
    keyboardOpen: boolean;
    onConfirm: (folder: string, fileName: string) => void;
    onCancel: () => void;
};

type Listing = {
    path: string;
    parent: string | null;
    entries: DirectoryEntry[];
    total: number;
    page: number;
};

export function BrowserDownloadFolder(props: BrowserDownloadFolderProps) {
    const { language, prompt, fileName, confirmLabel, startPath, keyboardOpen, onConfirm, onCancel } = props;

    const act = useBrowserPress();

    const [path, setPath] = useState("");
    const [listing, setListing] = useState<Listing | null>(null);
    const loadingRef = useRef(false);
    const pathRef = useRef("");
    pathRef.current = path;
    const headerRef = useRef<HTMLDivElement | null>(null);

    const [name, setName] = useState(fileName ?? "");
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");

    const commitName = () => {
        const typed = draft.trim();
        setEditing(false);
        if (typed) {
            setName(typed);
        }
    };

    const keyboardWasOpenRef = useRef(false);
    useEffect(() => {
        if (keyboardWasOpenRef.current && !keyboardOpen && editing) {
            commitName();
        }
        keyboardWasOpenRef.current = keyboardOpen;
    }, [keyboardOpen, editing]);

    const fieldRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const win = fieldRef.current?.ownerDocument?.defaultView;
        if (!editing || !win) {
            return;
        }
        const frame = win.requestAnimationFrame(() => {
            fieldRef.current?.querySelector<HTMLElement>("input")?.click();
        });
        return () => win.cancelAnimationFrame(frame);
    }, [editing]);

    useEffect(() => {
        if (startPath) {
            setPath(startPath);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const start = await getBrowserDownloadFolder();
                if (!cancelled) {
                    setPath(start?.path || "/");
                }
            }
            catch (e) {
                logError("BrowserDownloadFolder.start", e);
                if (!cancelled) {
                    setPath("/");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const loadPage = async (folder: string, page: number) => {
        loadingRef.current = true;
        try {
            const result = await listDirectory(folder, false, true, null, false, "name_asc", page);
            if (pathRef.current !== folder) {
                return;
            }
            const entries = Array.isArray(result?.entries) ? result.entries : [];
            setListing((current) => ({
                path: folder,
                parent: result?.ok ? result.parent : (current?.parent ?? null),
                entries: page > 1 && current?.path === folder ? [...current.entries, ...entries] : entries,
                total: typeof result?.total === "number" ? result.total : entries.length,
                page
            }));
        }
        catch (e) {
            logError("BrowserDownloadFolder.list", e);
        }
        finally {
            loadingRef.current = false;
        }
    };

    useEffect(() => {
        if (!path) {
            return;
        }
        setListing(null);
        const scroller = headerRef.current?.parentElement?.querySelector<HTMLElement>(".cd-browser-scroll");
        if (scroller) {
            scroller.scrollTop = 0;
        }
        void loadPage(path, 1);
    }, [path]);

    const entries = listing?.entries ?? [];
    const total = listing?.total ?? 0;

    const window_ = useWindowedList({
        items: entries,
        dynamicLoading: true,
        initialRows: INITIAL_ROWS,
        rowStep: ROW_STEP,
        prefetchDistance: 0,
        sentinelRootMargin: SENTINEL_ROOT_MARGIN,
        resetKey: path
    });

    const mountedCount = window_.mountedItems.length;

    useEffect(() => {
        if (!listing || loadingRef.current || entries.length >= total) {
            return;
        }
        if (mountedCount >= entries.length - ROW_STEP) {
            void loadPage(listing.path, listing.page + 1);
        }
    }, [listing, mountedCount, entries.length, total]);

    const unmountedPx = Math.max(0, total - mountedCount) * modalSize(ROW_HEIGHT_PX + 3);

    const controlHeight = `${modalSize(ACTION_PX)}px`;

    const squareStyle: Record<string, string> = {
        minWidth: "0",
        width: controlHeight,
        height: controlHeight,
        padding: "0",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    };

    const wideStyle: Record<string, string> = {
        minWidth: "0",
        height: controlHeight,
        padding: `0 ${modalSize(10)}px`,
        fontSize: `${modalSize(13)}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    };

    const parent = listing?.parent ?? null;
    const gap = `${modalSize(6)}px`;

    const header = (
        <div ref={headerRef} style={{ display: "flex", flexDirection: "column", gap, flex: "0 0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap, flex: "0 0 auto" }}>
                <div style={{ flex: "1 1 auto", minWidth: "0", display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: `${modalSize(15)}px`, opacity: 0.8 }}>
                        {prompt}
                    </span>
                </div>
                <div style={cellStyle}>
                    <DialogButton
                        {...act("download:here", () => {
                            const typed = editing ? draft.trim() : "";
                            setEditing(false);
                            if (path) {
                                onConfirm(path, typed || name);
                            }
                        })}
                        style={{ ...wideStyle, opacity: path ? "1" : "0.35" }}
                    >
                        <span>{confirmLabel}</span>
                    </DialogButton>
                </div>
                <div style={cellStyle}>
                    <DialogButton {...act("download:cancel", onCancel)} style={wideStyle}>
                        <span>{t(language, "Cancel")}</span>
                    </DialogButton>
                </div>
            </div>
            {fileName !== undefined && (editing ? (
                <div style={{ display: "flex", alignItems: "stretch", gap, height: controlHeight, flex: "0 0 auto" }}>
                    <div style={{ flex: "1 1 auto", minWidth: "0" }} ref={fieldRef}>
                        <TextField
                            autoFocus
                            value={draft}
                            placeholder={t(language, "File name")}
                            onFocus={(e: { target?: { select?: () => void } }) => e?.target?.select?.()}
                            onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
                            onEnterKeyPress={commitName}
                            onKeyDown={(e: { key?: string }) => {
                                if (e?.key === "Enter" || e?.key === "NumpadEnter") {
                                    commitName();
                                }
                            }}
                        />
                    </div>
                    <div style={cellStyle}>
                        <DialogButton {...act("name:commit", commitName)} style={squareStyle}>
                            <FaCheck size={modalSize(12)} />
                        </DialogButton>
                    </div>
                    <div style={cellStyle}>
                        <DialogButton {...act("name:abandon", () => setEditing(false))} style={squareStyle}>
                            <FaTimes size={modalSize(12)} />
                        </DialogButton>
                    </div>
                </div>
            ) : (
                <div style={{ display: "flex", height: controlHeight, flex: "0 0 auto" }}>
                    <DialogButton
                        {...act("name:edit", () => {
                            setDraft(name);
                            setEditing(true);
                        })}
                        style={{
                            minWidth: "0",
                            width: "100%",
                            height: "100%",
                            boxSizing: "border-box",
                            padding: `0 ${modalSize(10)}px`,
                            display: "flex",
                            alignItems: "center",
                            gap: `${modalSize(8)}px`,
                            fontSize: `${modalSize(13)}px`,
                            overflow: "hidden"
                        }}
                    >
                        <FaPen size={modalSize(11)} />
                        <span style={{ flex: "1 1 auto", minWidth: "0", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {name}
                        </span>
                    </DialogButton>
                </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap, height: controlHeight, flex: "0 0 auto" }}>
                <div style={cellStyle}>
                    <DialogButton
                        {...act("download:up", () => {
                            if (parent) {
                                setPath(parent);
                            }
                        })}
                        style={{ ...squareStyle, opacity: parent ? "1" : "0.35" }}
                    >
                        <FaArrowUp size={modalSize(12)} />
                    </DialogButton>
                </div>
                <span
                    style={{
                        flex: "1 1 auto",
                        minWidth: "0",
                        fontSize: `${modalSize(13)}px`,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                >
                    {path}
                </span>
            </div>
        </div>
    );

    return (
        <Focusable
            focusable={false}
            childFocusDisabled={!editing}
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
            <BrowserScrollArea railPx={RAIL_PX} gapPx={ROW_GAP_PX} rowGap={`${modalSize(3)}px`} unmountedPx={unmountedPx} header={header}>
                {window_.mountedItems.map((entry) => (
                    <div key={entry.name} style={{ display: "flex", flex: "0 0 auto", height: `${modalSize(ROW_HEIGHT_PX)}px` }}>
                        <DialogButton
                            {...act("download:enter", () => setPath(`${path.replace(/\/+$/, "")}/${entry.name}`))}
                            style={{
                                minWidth: "0",
                                width: "100%",
                                height: "100%",
                                boxSizing: "border-box",
                                padding: `0 ${modalSize(10)}px`,
                                display: "flex",
                                alignItems: "center",
                                gap: `${modalSize(8)}px`,
                                fontSize: `${modalSize(13)}px`,
                                overflow: "hidden"
                            }}
                        >
                            <FaFolder size={modalSize(13)} />
                            <span style={{ flex: "1 1 auto", minWidth: "0", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {entry.name}
                            </span>
                        </DialogButton>
                    </div>
                ))}

                {mountedCount < entries.length && (
                    <div ref={window_.markerRef} style={{ flex: "0 0 auto", height: "1px" }} />
                )}
            </BrowserScrollArea>
        </Focusable>
    );
}
