import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import {
    getCheevoCheckLastSystemId,
    getSetConsoleList,
    prefetchGameIcons,
    saveCheevoCheckLastSystemId
} from "../../api";
import { useResilientGameIcon } from "../../hooks/useResilientGameIcon";
import { consolesWithoutRecent, RecentConsoleSection, resolveRecentConsole } from "./RecentConsoleSection";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { t, type LanguageCode } from "../../locales";
import type { CheevoCheckBrowseRow, CheevoCheckListKind } from "../../types";
import { logError } from "../../utils/errors";
import { modalBodyStyle, smallTextStyle, compactButtonStyle, FADE_IN_KEYFRAMES } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { searchKey } from "../../utils/searchText";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

export type CheevoCheckGamesModalProps = {
    language: LanguageCode;
    showIcons: boolean;
    kind: CheevoCheckListKind;
    rows: CheevoCheckBrowseRow[];
    onPick: (gameId: number) => void;
    onWebSearch: (title: string) => void;
    close: () => void;
};

type Step = "console" | "games";

type SystemGroup = {
    id: number;
    name: string;
    count: number;
};

const ALL_CONSOLES_ID = -1;

const INITIAL_ROWS = 40;
const ROW_STEP = 40;
const ROW_LOAD_AHEAD = 12;

function AllSystemsIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
        >
            <rect x="3" y="3" width="8" height="8" rx="1.5" />
            <rect x="13" y="3" width="8" height="8" rx="1.5" />
            <rect x="3" y="13" width="8" height="8" rx="1.5" />
            <rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>
    );
}

const VERIFY_HEADINGS: Record<string, string> = {
    verified: "Verified",
    raFull: "Recognised — Full Hash",
    raPartial: "Recognised — Partial Hash",
    mismatch: "Doesn't Match Its Name",
    unrecognised: "Not Recognised",
    unverifiable: "Can't Verify"
};

function headingKey(kind: CheevoCheckListKind): string {
    if (kind === "supported") {
        return "Supported Games";
    }
    if (kind === "noAchievements") {
        return "No Achievements";
    }
    if (kind === "unsupported") {
        return "Unsupported Files";
    }
    if (kind === "failed") {
        return "Couldn't Scan";
    }
    if (kind === "archiveMismatch") {
        return "Archive Name Mismatches";
    }
    return VERIFY_HEADINGS[kind] ?? "Verified";
}

export function CheevoCheckGamesModal(props: CheevoCheckGamesModalProps) {
    const { language, showIcons, kind, rows, onPick, onWebSearch, close } = props;

    const [step, setStep] = useState<Step>("console");
    const [selectedSystem, setSelectedSystem] = useState<SystemGroup | null>(null);

    const [query, setQuery] = useState("");

    const [recentSystemId, setRecentSystemId] = useState(0);

    const [catalogIconsById, setCatalogIconsById] = useState<Record<number, string>>({});

    useEffect(() => {
        if (!showIcons) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const result = await getSetConsoleList();
                if (cancelled) {
                    return;
                }
                const map: Record<number, string> = {};
                for (const item of result.consoles ?? []) {
                    if (item.iconUrl) {
                        map[item.id] = item.iconUrl;
                    }
                }
                setCatalogIconsById(map);
            } catch (e) {
                logError("getSetConsoleList (cheevo check browse)", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [showIcons]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const result = await getCheevoCheckLastSystemId();
                if (!cancelled) {
                    setRecentSystemId(result?.cheevoCheckLastSystemId ?? 0);
                }
            } catch (e) {
                logError("getCheevoCheckLastSystemId", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const focusedTopForStepRef = useRef<Step | null>(null);

    const systemGroups = useMemo(() => {
        const byId = new Map<number, SystemGroup>();
        for (const row of rows) {
            const id = row.systemId ?? 0;
            const existing = byId.get(id);
            if (existing) {
                existing.count += 1;
            } else {
                byId.set(id, {
                    id,
                    name: row.system || t(language, "Unknown console"),
                    count: 1
                });
            }
        }
        const sorted = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
        if (sorted.length === 0) {
            return sorted;
        }
        const allEntry: SystemGroup = {
            id: ALL_CONSOLES_ID,
            name: t(language, "All systems"),
            count: rows.length
        };
        return [allEntry, ...sorted];
    }, [rows, language]);

    const systemRows = useMemo(() => {
        if (!selectedSystem) {
            return [];
        }
        if (selectedSystem.id === ALL_CONSOLES_ID) {
            return rows;
        }
        return rows.filter((row) => (row.systemId ?? 0) === selectedSystem.id);
    }, [rows, selectedSystem]);

    useEffect(function focusTopOfListWhenReady() {
        if (focusedTopForStepRef.current === step) {
            return;
        }
        const root = bodyRef.current;
        if (!root) {
            return;
        }
        const prefix = step === "console" ? "searchconsole:" : "searchgame:";
        const firstRow = root.querySelector(
            `[data-focus-key^="${prefix}"] button, [data-focus-key^="${prefix}"] [tabindex]`
        ) as HTMLElement | null;
        if (!firstRow) {
            return;
        }
        focusedTopForStepRef.current = step;
        firstRow.focus();
    }, [step, systemGroups, systemRows]);

    function handlePickSystem(item: SystemGroup) {
        if (item.id !== ALL_CONSOLES_ID) {
            void saveCheevoCheckLastSystemId(item.id).catch((e) => {
                logError("saveCheevoCheckLastSystemId", e);
            });
        }
        setSelectedSystem(item);
        setStep("games");
        setQuery("");
    }

    function handleBackToSystems() {
        if (selectedSystem && selectedSystem.id !== ALL_CONSOLES_ID) {
            setRecentSystemId(selectedSystem.id);
        }
        focusedTopForStepRef.current = null;
        setStep("console");
        setSelectedSystem(null);
        setQuery("");
    }

    function handlePickRow(row: CheevoCheckBrowseRow) {
        if (row.gameId > 0) {
            onPick(row.gameId);
            return;
        }
        onWebSearch(row.searchTitle);
    }

    const titleKeys = useMemo(() => systemRows.map((row) => searchKey(row.title)), [systemRows]);

    const filteredRows = useMemo(() => {
        const trimmed = searchKey(query.trim());
        if (!trimmed) {
            return systemRows;
        }
        return systemRows.filter((_row, index) => titleKeys[index].includes(trimmed));
    }, [systemRows, titleKeys, query]);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, headingKey(kind))}
            </div>

            <div ref={bodyRef}>
                {step === "console" && (
                    <ConsoleStep
                        systems={systemGroups}
                        recentSystemId={recentSystemId}
                        consoleIcons={catalogIconsById}
                        language={language}
                        showIcons={showIcons}
                        onPick={handlePickSystem}
                    />
                )}

                {step === "games" && selectedSystem && (
                    <GameStep
                        systemName={selectedSystem.name}
                        rows={filteredRows}
                        query={query}
                        onQueryChange={setQuery}
                        consoleIcons={catalogIconsById}
                        language={language}
                        showIcons={showIcons}
                        onPickRow={handlePickRow}
                        onBack={handleBackToSystems}
                    />
                )}
            </div>

            <Focusable
                style={{
                    display: "flex",
                    justifyContent: "flex-start",
                    gap: "8px",
                    marginTop: "16px"
                }}
                flow-children="row"
            >
                <DialogButton onClick={close}>
                    {t(language, "Cancel")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

type ConsoleStepProps = {
    systems: SystemGroup[];
    recentSystemId: number;
    consoleIcons: Record<number, string>;
    language: LanguageCode;
    showIcons: boolean;
    onPick: (item: SystemGroup) => void;
};

function ConsoleStep(props: ConsoleStepProps) {
    const { systems, recentSystemId, consoleIcons, language, showIcons, onPick } = props;

    const systemPickRef = useRef(onPick);
    systemPickRef.current = onPick;

    const rowList = useMemo<ConsoleRowListProps>(() => ({
        language,
        showIcons,
        metrics: pickerRowMetrics(),
        onPick: (item) => {
            systemPickRef.current(item);
        }
    }), [language, showIcons]);

    if (systems.length === 0) {
        return (
            <div style={modalBodyStyle()}>{t(language, "No consoles available.")}</div>
        );
    }

    const allSystems = systems[0];
    const realSystems = systems.slice(1);
    const recentSystem = resolveRecentConsole(realSystems, recentSystemId);
    const listedSystems = consolesWithoutRecent(realSystems, recentSystem);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ ...modalBodyStyle(), fontWeight: 700 }}>
                {t(language, "Pick a system")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <ConsoleRow
                    key={`searchconsole:${allSystems.id}`}
                    item={allSystems}
                    iconUrl={null}
                    list={rowList}
                />
                {recentSystem && (
                    <RecentConsoleSection language={language}>
                        <ConsoleRow
                            key={`searchconsole:recent:${recentSystem.id}`}
                            item={recentSystem}
                            iconUrl={consoleIcons[recentSystem.id] ?? null}
                            list={rowList}
                        />
                    </RecentConsoleSection>
                )}
                {listedSystems.map((item) => (
                    <ConsoleRow
                        key={`searchconsole:${item.id}`}
                        item={item}
                        iconUrl={consoleIcons[item.id] ?? null}
                        list={rowList}
                    />
                ))}
            </div>
        </div>
    );
}

function pickerRowMetrics() {
    return {
        iconSize: modalSize(44),
        iconGap: modalSize(7),
        rowPaddingY: modalSize(2),
        contentGap: modalSize(3),
        titleFontSize: modalSize(15.5),
        titleLineHeight: 1.2,
        bodyFontSize: modalSize(11.5),
        bodyLineHeight: 1.31
    };
}

type PickerRowMetrics = ReturnType<typeof pickerRowMetrics>;

type ConsoleRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: PickerRowMetrics;
    onPick: (item: SystemGroup) => void;
};

type ConsoleRowProps = {
    item: SystemGroup;
    iconUrl: string | null;
    list: ConsoleRowListProps;
};

const ConsoleRow = React.memo(function ConsoleRow(props: ConsoleRowProps) {
    const { item, iconUrl, list } = props;
    const { language, showIcons, metrics } = list;

    const fallbackLetter = item.name.trim().charAt(0).toUpperCase() || "?";

    function handleClick() {
        list.onPick(item);
    }

    return (
        <FocusableItem
            focusKey={`searchconsole:${item.id}`}
            onClick={handleClick}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "center",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    minWidth: 0
                }}
            >
                {showIcons && (
                    <div
                        style={{
                            width: `${metrics.iconSize}px`,
                            height: `${metrics.iconSize}px`,
                            borderRadius: "7px",
                            overflow: "hidden",
                            flexShrink: 0,
                            background: "rgba(255,255,255,0.10)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: `${Math.max(16, metrics.iconSize * 0.42)}px`,
                            fontWeight: 800
                        }}
                    >
                        {item.id === ALL_CONSOLES_ID ? (
                            <AllSystemsIcon size={Math.round(metrics.iconSize * 0.55)} />
                        ) : iconUrl ? (
                            <img
                                src={iconUrl}
                                alt=""
                                decoding="async"
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                    display: "block"
                                }}
                            />
                        ) : (
                            fallbackLetter
                        )}
                    </div>
                )}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: `${Math.max(2, metrics.contentGap - 1)}px`,
                        textAlign: "left"
                    }}
                >
                    <div
                        style={{
                            fontSize: `${metrics.titleFontSize}px`,
                            lineHeight: metrics.titleLineHeight,
                            fontWeight: 800,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {item.name || t(language, "Unknown console")}
                    </div>
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.bodyFontSize}px`,
                            lineHeight: metrics.bodyLineHeight,
                            opacity: 1,
                            minWidth: 0
                        }}
                    >
                        {t(language, "{{count}} games", { count: item.count })}
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});

type GameStepProps = {
    systemName: string;
    rows: CheevoCheckBrowseRow[];
    query: string;
    onQueryChange: (next: string) => void;
    consoleIcons: Record<number, string>;
    language: LanguageCode;
    showIcons: boolean;
    onPickRow: (row: CheevoCheckBrowseRow) => void;
    onBack: () => void;
};

function GameStep(props: GameStepProps) {
    const {
        systemName,
        rows,
        query,
        onQueryChange,
        consoleIcons,
        language,
        showIcons,
        onPickRow,
        onBack
    } = props;

    const [mountedCount, setMountedCount] = useState(function getInitialMountedCount() {
        return Math.min(INITIAL_ROWS, rows.length);
    });

    useEffect(function resetMountedRowsOnListChange() {
        setMountedCount(Math.min(INITIAL_ROWS, rows.length));
    }, [query, rows.length]);

    const loadMoreRows = function loadMoreRows() {
        setMountedCount(function updateMountedCount(current) {
            if (current >= rows.length) {
                return current;
            }
            return Math.min(current + ROW_STEP, rows.length);
        });
    };

    const mountedRows = useMemo(() => {
        return rows.slice(0, mountedCount);
    }, [rows, mountedCount]);

    const warmedGameIdsRef = useRef<Set<number>>(new Set());

    const iconFetchInFlightRef = useRef(false);
    const desiredIconRowsRef = useRef<CheevoCheckBrowseRow[] | null>(null);

    const kickIconPrefetch = useCallback(async function kickIconPrefetch() {
        if (iconFetchInFlightRef.current) {
            return;
        }
        iconFetchInFlightRef.current = true;
        try {
            while (desiredIconRowsRef.current) {
                const target = desiredIconRowsRef.current;
                desiredIconRowsRef.current = null;
                const warmed = warmedGameIdsRef.current;
                const freshRows: Array<{ gameId: number; imageIcon: string | null }> = [];
                for (const row of target) {
                    if (!row.gameId || warmed.has(row.gameId)) {
                        continue;
                    }
                    warmed.add(row.gameId);
                    freshRows.push({ gameId: row.gameId, imageIcon: row.imageIcon || null });
                }
                if (freshRows.length === 0) {
                    continue;
                }
                await prefetchGameIcons(freshRows);
            }
        } finally {
            iconFetchInFlightRef.current = false;
        }
    }, []);

    useEffect(function prefetchMountedWindowIcons() {
        if (!showIcons || mountedRows.length === 0) {
            return;
        }
        desiredIconRowsRef.current = mountedRows;
        void kickIconPrefetch();
    }, [mountedRows, showIcons, kickIconPrefetch]);

    function handleRowFocus(index: number) {
        if (index < mountedCount - ROW_LOAD_AHEAD) {
            return;
        }
        loadMoreRows();
    }

    const rowPickRef = useRef(onPickRow);
    rowPickRef.current = onPickRow;
    const rowFocusRef = useRef(handleRowFocus);
    rowFocusRef.current = handleRowFocus;

    const resultRowList = useMemo<ResultRowListProps>(() => ({
        language,
        showIcons,
        metrics: pickerRowMetrics(),
        onPick: (row) => {
            rowPickRef.current(row);
        },
        onRowFocus: (index) => {
            rowFocusRef.current(index);
        }
    }), [language, showIcons]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <Focusable
                style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: "8px",
                    alignItems: "center"
                }}
                flow-children="row"
            >
                <div data-focus-key="searchgame:back-to-consoles">
                    <DialogButton
                        onClick={onBack}
                        style={compactButtonStyle}
                    >
                        {t(language, "← Consoles")}
                    </DialogButton>
                </div>
                <div style={{ fontWeight: 700, minWidth: 0, wordBreak: "break-word" }}>
                    {systemName}
                </div>
            </Focusable>

            <TextField
                value={query}
                onChange={(e: any) => onQueryChange(e?.target?.value ?? "")}
            />

            {rows.length === 0 && (
                <div style={modalBodyStyle()}>
                    {t(language, "Nothing here matches what you typed.")}
                </div>
            )}

            {rows.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {mountedRows.map((row, index) => (
                        <ResultRow
                            key={row.key}
                            row={row}
                            consoleIconUrl={consoleIcons[row.systemId] ?? null}
                            index={index}
                            list={resultRowList}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

type ResultRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: PickerRowMetrics;
    onPick: (row: CheevoCheckBrowseRow) => void;
    onRowFocus: (index: number) => void;
};

type ResultRowProps = {
    row: CheevoCheckBrowseRow;
    consoleIconUrl: string | null;
    index: number;
    list: ResultRowListProps;
};

const ResultRow = React.memo(function ResultRow(props: ResultRowProps) {
    const { row, consoleIconUrl, list } = props;
    const { language, showIcons, metrics } = list;

    const openable = row.gameId > 0;
    const searchable = !openable && row.searchTitle.length > 0;
    const { iconDataUri, cold } = useResilientGameIcon(
        openable ? row.gameId : null,
        row.imageIcon || null,
        "getGameIconCached (cheevo check browse row)"
    );

    const fallbackLetter = row.title.trim().charAt(0).toUpperCase() || "?";

    function handleClick() {
        if (!openable && !searchable) {
            return;
        }
        list.onPick(row);
    }

    function handleFocus() {
        list.onRowFocus(props.index);
    }

    return (
        <FocusableItem
            focusKey={`searchgame:${row.key}`}
            onClick={handleClick}
            onFocus={handleFocus}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "flex-start",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    minWidth: 0
                }}
            >
                {showIcons && (
                    <div
                        style={{
                            width: `${metrics.iconSize}px`,
                            height: `${metrics.iconSize}px`,
                            borderRadius: "7px",
                            overflow: "hidden",
                            flexShrink: 0,
                            background: "rgba(255,255,255,0.10)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: `${Math.max(16, metrics.iconSize * 0.42)}px`,
                            fontWeight: 800
                        }}
                    >
                        {iconDataUri ? (
                            <FadeImage
                                src={iconDataUri}
                                fadeOnLoad={cold}
                                decoding="async"
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block"
                                }}
                            />
                        ) : !openable && consoleIconUrl ? (
                            <img
                                src={consoleIconUrl}
                                alt=""
                                decoding="async"
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                    display: "block"
                                }}
                            />
                        ) : (
                            fallbackLetter
                        )}
                    </div>
                )}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: `${Math.max(2, metrics.contentGap - 1)}px`,
                        textAlign: "left"
                    }}
                >
                    <div
                        style={{
                            fontSize: `${metrics.titleFontSize}px`,
                            lineHeight: metrics.titleLineHeight,
                            fontWeight: 800,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {row.title}
                    </div>
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.bodyFontSize}px`,
                            lineHeight: metrics.bodyLineHeight,
                            opacity: 1,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {row.system}
                    </div>
                    {row.detail && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 1,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {row.detail}
                        </div>
                    )}
                    {row.note && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 1,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {row.note}
                        </div>
                    )}
                    {
}
                    {(row.extra ?? []).map((line, index) => (
                        <div
                            key={`${row.key}:extra:${index}`}
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 0.75,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {line}
                        </div>
                    ))}
                    {
}
                    {(openable || searchable) && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 0.6,
                                minWidth: 0
                            }}
                        >
                            {t(language, openable ? "Open game details" : "Search the web for this game")}
                        </div>
                    )}
                </div>
            </div>
        </FocusableItem>
    );
});
