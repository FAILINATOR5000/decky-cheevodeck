import { DialogButton, Focusable, ModalRoot, ScrollPanelGroup } from "@decky/ui";
import { useEffect, useRef, useState, type CSSProperties } from "react";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import {
    FaArrowUp,
    FaCompactDisc,
    FaFile,
    FaFileAlt,
    FaFileArchive,
    FaFolder,
    FaGamepad,
    FaImage,
    FaMusic,
    FaVideo
} from "react-icons/fa";

import { listDirectory } from "../../api";
import { NETWORK_WAIT_MS, useSlowWait } from "../../hooks/useSlowWait";
import { useWindowedList } from "../../hooks/useWindowedList";
import { t, type LanguageCode } from "../../locales";
import type { DirectoryEntry, DirectoryListing, DirectorySort } from "../../types";
import { logError } from "../../utils/errors";
import { playOkSound } from "../../utils/navSound";
import { BUTTON_BUMPER_LEFT, BUTTON_BUMPER_RIGHT } from "../../utils/gamepadButtons";
import { MODAL_ECHO_WINDOW_MS, showManagedModal } from "../../utils/modalRegistry";
import { FADE_IN_KEYFRAMES, smallTextStyle, warnAmber } from "../../utils/style";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const INITIAL_ROWS = 40;
const ROW_STEP = 60;
const PREFETCH_DISTANCE = 8;
const SENTINEL_ROOT_MARGIN = "300px";

const RING_ROOM_PX = 5;

const NAV_ENTER_PREFERRED_CHILD = 4;

const ENTRY_ROW_STYLE: CSSProperties = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    boxSizing: "border-box",
    padding: "5px 8px",
    marginBottom: "2px",
    borderRadius: "3px",
    background: "rgba(255, 255, 255, 0.08)"
};

const LISTING_BOX_STYLE: CSSProperties = {
    maxHeight: "44vh",
    margin: "4px 0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column"
};

const SORTS: DirectorySort[] = ["name_asc", "name_desc", "modified_desc", "modified_asc"];

const ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar", ".gz", ".bz2", ".xz", ".tar"]);
const DISC_EXTENSIONS = new Set([".chd", ".iso", ".cue", ".bin", ".gdi", ".cdi", ".img", ".mdf", ".nrg", ".ccd"]);
const ROM_EXTENSIONS = new Set([
    ".nes", ".sfc", ".smc", ".gb", ".gbc", ".gba", ".n64", ".z64", ".v64", ".nds", ".3ds",
    ".gcm", ".rvz", ".wbfs", ".md", ".gen", ".sms", ".gg", ".pce", ".ws", ".wsc", ".a26",
    ".lnx", ".ngp", ".ngc", ".32x", ".col", ".int", ".vec", ".vb", ".j64"
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".avif"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".ogg", ".flac", ".wav", ".m4a", ".opus"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".avi", ".webm", ".mov"]);
const TEXT_EXTENSIONS = new Set([".txt", ".nfo", ".log", ".xml", ".json", ".ini", ".cfg", ".dat", ".m3u"]);

export type PickedPath = {
    path: string;
    realpath: string;
};

export type PathPickerOptions = {
    language: LanguageCode;
    prompt: string;
    startPath: string;
    includeFiles?: boolean;
    includeFolders?: boolean;
    extensions?: string[] | null;
    showHidden?: boolean;
};

type FilePickerModalProps = PathPickerOptions & {
    onSubmit: (picked: PickedPath) => void;
    close: () => void;
};

function suffixOf(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

function iconFor(entry: DirectoryEntry) {
    if (entry.isDir) {
        return FaFolder;
    }

    const suffix = suffixOf(entry.name);
    if (DISC_EXTENSIONS.has(suffix)) {
        return FaCompactDisc;
    }
    if (ARCHIVE_EXTENSIONS.has(suffix)) {
        return FaFileArchive;
    }
    if (ROM_EXTENSIONS.has(suffix)) {
        return FaGamepad;
    }
    if (IMAGE_EXTENSIONS.has(suffix)) {
        return FaImage;
    }
    if (AUDIO_EXTENSIONS.has(suffix)) {
        return FaMusic;
    }
    if (VIDEO_EXTENSIONS.has(suffix)) {
        return FaVideo;
    }
    if (TEXT_EXTENSIONS.has(suffix)) {
        return FaFileAlt;
    }
    return FaFile;
}

function fileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function rowMeta(entry: DirectoryEntry, language: LanguageCode): string {
    const localeTag = language === "en" ? undefined : language;
    const when = entry.modified ? new Date(entry.modified * 1000).toLocaleDateString(localeTag) : "";

    if (entry.isDir) {
        return when;
    }
    return when ? `${fileSize(entry.size)} · ${when}` : fileSize(entry.size);
}

function joinPath(base: string, name: string): string {
    return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
}

function sortLabel(mode: DirectorySort, language: LanguageCode): string {
    if (mode === "name_desc") {
        return t(language, "Name (Z-A)");
    }
    if (mode === "modified_desc") {
        return t(language, "Newest");
    }
    if (mode === "modified_asc") {
        return t(language, "Oldest");
    }
    return t(language, "Name (A-Z)");
}

function errorLine(reason: string | undefined, language: LanguageCode): string {
    if (reason === "not_found") {
        return t(language, "That folder isn't there anymore.");
    }
    if (reason === "permission_denied") {
        return t(language, "You don't have permission to open that folder.");
    }
    return t(language, "Couldn't open that folder.");
}

function failedListing(path: string): DirectoryListing {
    return { ok: false, error: "unknown", path, realpath: path, parent: null, entries: [], total: 0 };
}

function FilePickerModal(props: FilePickerModalProps) {
    const { language, prompt, onSubmit, close } = props;
    const includeFiles = props.includeFiles ?? false;
    const includeFolders = props.includeFolders ?? true;

    const extensionsRef = useRef(props.extensions ?? null);

    const [path, setPath] = useState(props.startPath);
    const [sort, setSort] = useState<DirectorySort>("name_asc");
    const [showHidden, setShowHidden] = useState(props.showHidden ?? false);
    const [listing, setListing] = useState<DirectoryListing | null>(null);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [preferredName, setPreferredName] = useState<string | null>(null);
    const [topFocusToken, setTopFocusToken] = useState(1);
    const [bottomFocusToken, setBottomFocusToken] = useState(0);

    const [rows, setRows] = useState<{ path: string; entries: DirectoryEntry[]; land: boolean }>({
        path: "",
        entries: [],
        land: false
    });

    const requestRef = useRef(0);
    const cancelAtRef = useRef(0);

    const landOnListRef = useRef(false);

    useEffect(() => {
        const token = requestRef.current + 1;
        requestRef.current = token;
        setLoading(true);

        void listDirectory(path, includeFiles, includeFolders, extensionsRef.current, showHidden, sort, 1)
            .then((result) => {
                if (requestRef.current !== token) {
                    return;
                }
                const land = landOnListRef.current;
                landOnListRef.current = false;
                setListing(result ?? failedListing(path));
                setRows({
                    path,
                    entries: result?.ok && Array.isArray(result.entries) ? result.entries : [],
                    land
                });
                setPage(1);
            })
            .catch((e) => {
                if (requestRef.current !== token) {
                    return;
                }
                logError("listDirectory", e);
                setListing(failedListing(path));
                setRows({ path, entries: [], land: false });
            })
            .finally(() => {
                if (requestRef.current === token) {
                    setLoading(false);
                }
            });
    }, [path, includeFiles, includeFolders, showHidden, sort]);

    const { mountedItems, markerRef, onItemFocus } = useWindowedList({
        items: rows.entries,
        dynamicLoading: true,
        initialRows: INITIAL_ROWS,
        rowStep: ROW_STEP,
        prefetchDistance: PREFETCH_DISTANCE,
        sentinelRootMargin: SENTINEL_ROOT_MARGIN,
        resetKey: rows.path
    });

    const slowListing = useSlowWait(loading && rows.entries.length === 0, NETWORK_WAIT_MS);

    const fetched = rows.entries.length;
    const total = listing?.total ?? 0;
    const canSubmit = Boolean(listing?.ok);

    function fetchNextPage() {
        if (!listing?.ok || loading || fetched >= total) {
            return;
        }

        const token = requestRef.current;
        const next = page + 1;
        setLoading(true);

        void listDirectory(path, includeFiles, includeFolders, extensionsRef.current, showHidden, sort, next)
            .then((result) => {
                if (requestRef.current !== token || !result?.ok) {
                    return;
                }
                setRows((prior) => ({
                    path: prior.path,
                    entries: [...prior.entries, ...(Array.isArray(result.entries) ? result.entries : [])],
                    land: prior.land
                }));
                setPage(next);
            })
            .catch((e) => {
                logError("listDirectory page", e);
            })
            .finally(() => {
                if (requestRef.current === token) {
                    setLoading(false);
                }
            });
    }

    function openEntry(entry: DirectoryEntry) {
        if (!entry.isDir) {
            return;
        }
        playOkSound();
        landOnListRef.current = true;
        setPreferredName(null);
        setPath(joinPath(listing?.path || path, entry.name));
    }

    function goUp() {
        const parent = listing?.parent;
        if (parent) {
            setPreferredName(null);
            setPath(parent);
        }
    }

    function submit() {
        if (!listing?.ok) {
            return;
        }
        onSubmit({ path: listing.path, realpath: listing.realpath });
        close();
    }

    function handleCancel() {
        const now = Date.now();
        if (now - cancelAtRef.current < MODAL_ECHO_WINDOW_MS) {
            return;
        }
        cancelAtRef.current = now;
        close();
    }

    function handleModalButtons(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;

        if (button === BUTTON_BUMPER_LEFT) {
            setTopFocusToken((current) => current + 1);
            return;
        }

        if (button === BUTTON_BUMPER_RIGHT) {
            setBottomFocusToken((current) => current + 1);
        }
    }

    const modalLegend: Record<number, string> = {
        [BUTTON_BUMPER_LEFT]: t(language, "Page Up"),
        [BUTTON_BUMPER_RIGHT]: t(language, "Page Down")
    };

    const selectLabel = t(language, "Choose This Folder");
    const iconSize = 15;

    const listingScope = (
        <Focusable
            key={rows.path}
            autoFocus={rows.land || undefined}
            navEntryPreferPosition={NAV_ENTER_PREFERRED_CHILD}
            onButtonDown={handleModalButtons}
            actionDescriptionMap={modalLegend}
            style={{ display: "flex", flexDirection: "column", padding: `${RING_ROOM_PX}px` }}
        >
            {mountedItems.map((entry, index) => {
                const Glyph = iconFor(entry);
                return (
                    <Focusable
                        key={entry.name}
                        data-focus-key={`picker:entry:${entry.name}`}
                        focusable={entry.isDir}
                        onActivate={() => openEntry(entry)}
                        onGamepadFocus={() => {
                            onItemFocus(index);
                            setPreferredName(entry.name);
                        }}
                        preferredFocus={preferredName ? entry.name === preferredName : index === 0}
                        style={ENTRY_ROW_STYLE}
                    >
                        <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", opacity: entry.isDir ? 1 : 0.6 }}>
                            <Glyph size={iconSize} style={{ flexShrink: 0, opacity: 0.85 }} />
                            <span
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    textAlign: "left",
                                    fontSize: "14px",
                                    fontWeight: entry.isDir ? 700 : 500,
                                    wordBreak: "break-word"
                                }}
                            >
                                {entry.name}
                            </span>
                            <span style={{ ...smallTextStyle(), flexShrink: 0 }}>
                                {rowMeta(entry, language)}
                            </span>
                        </div>
                    </Focusable>
                );
            })}
            {mountedItems.length < rows.entries.length && (
                <div ref={markerRef} style={{ height: "1px" }} />
            )}
        </Focusable>
    );

    return (
        <ModalRoot
            onCancel={handleCancel}
            onEscKeypress={handleCancel}
            onButtonDown={handleModalButtons}
            actionDescriptionMap={modalLegend}
        >
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>

            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>
                {prompt}
            </div>

            <Focusable
                key={`picker:top:${topFocusToken}`}
                autoFocus={topFocusToken > 0 || undefined}
                onButtonDown={handleModalButtons}
                actionDescriptionMap={modalLegend}
                style={{ display: "flex", marginBottom: "8px" }}
            >
                <DialogButton onClick={submit} disabled={!canSubmit} style={{ width: "100%" }}>
                    {selectLabel}
                </DialogButton>
            </Focusable>

            <div style={{ ...smallTextStyle(), wordBreak: "break-all", marginBottom: "6px" }}>
                {listing?.realpath || path}
            </div>

            <Focusable
                flow-children="row"
                onButtonDown={handleModalButtons}
                actionDescriptionMap={modalLegend}
                style={{ display: "flex", gap: "6px", alignItems: "stretch", marginBottom: "6px" }}
            >
                <DialogButton
                    onClick={goUp}
                    disabled={!listing?.parent}
                    style={{ flex: 1, minWidth: 0 }}
                >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <FaArrowUp size={iconSize} />
                        {t(language, "Up")}
                    </span>
                </DialogButton>
                <DialogButton
                    onClick={() => setSort((current) => SORTS[(SORTS.indexOf(current) + 1) % SORTS.length])}
                    style={{ flex: 1, minWidth: 0 }}
                >
                    {sortLabel(sort, language)}
                </DialogButton>
                <DialogButton
                    onClick={() => setShowHidden((current) => !current)}
                    style={{ flex: 1, minWidth: 0 }}
                >
                    {`${t(language, "Hidden")} ${showHidden ? t(language, "On") : t(language, "Off")}`}
                </DialogButton>
            </Focusable>

            {listing && !listing.ok && (
                <div style={{ ...smallTextStyle(), color: warnAmber, opacity: 1, margin: "10px 0" }}>
                    {errorLine(listing.error, language)}
                </div>
            )}

            {rows.entries.length > 0 && (
                <div style={LISTING_BOX_STYLE}>
                    {ScrollPanelGroup ? (
                        <ScrollPanelGroup focusable={false} style={{ flex: 1, minHeight: 0 }}>
                            {listingScope}
                        </ScrollPanelGroup>
                    ) : (
                        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                            {listingScope}
                        </div>
                    )}
                </div>
            )}

            {slowListing && (
                <div style={smallTextStyle()}>{t(language, "Loading...")}</div>
            )}
            {!loading && listing?.ok && rows.entries.length === 0 && (
                <div style={smallTextStyle()}>{t(language, "This folder is empty")}</div>
            )}

            {fetched < total && (
                <Focusable
                    onButtonDown={handleModalButtons}
                    actionDescriptionMap={modalLegend}
                    style={{ display: "flex", marginTop: "6px" }}
                >
                    <DialogButton onClick={fetchNextPage} disabled={loading} style={{ width: "100%" }}>
                        {t(language, "Show More")}
                    </DialogButton>
                </Focusable>
            )}

            <Focusable
                key={`picker:bottom:${bottomFocusToken}`}
                autoFocus={bottomFocusToken > 0 || undefined}
                flow-children="row"
                onButtonDown={handleModalButtons}
                actionDescriptionMap={modalLegend}
                style={{ display: "flex", gap: "8px", marginTop: "12px" }}
            >
                <DialogButton onClick={submit} disabled={!canSubmit} style={{ flex: 1, minWidth: 0 }}>
                    {selectLabel}
                </DialogButton>
                <DialogButton onClick={handleCancel} style={{ flex: 1, minWidth: 0 }}>
                    {t(language, "Cancel")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function openPathPicker(options: PathPickerOptions): Promise<PickedPath> {
    return new Promise((resolve, reject) => {
        let picked: PickedPath | null = null;

        showManagedModal(
            (close) => (
                <FilePickerModal
                    {...options}
                    onSubmit={(result) => { picked = result; }}
                    close={close}
                />
            ),
            {
                onClose: () => {
                    if (picked) {
                        resolve(picked);
                        return;
                    }
                    reject(new Error("picker cancelled"));
                }
            }
        );
    });
}
