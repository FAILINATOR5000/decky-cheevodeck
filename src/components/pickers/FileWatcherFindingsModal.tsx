import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import React, { useEffect, useMemo, useRef, useState } from "react";

import {
    getFileWatcherExcluded,
    getFileWatcherExcludedRoots,
    getFileWatcherFindingRoots,
    getFileWatcherFindings
} from "../../api";
import { FocusableItem } from "../ui/FocusableItem";
import { t, type LanguageCode } from "../../locales";
import type {
    FileWatcherBucket,
    FileWatcherExcludedRow,
    FileWatcherListRow,
    FileWatcherRoot,
    FileWatcherSkippedRoot
} from "../../types";
import { logError } from "../../utils/errors";
import {
    bucketAction,
    bucketConfirm,
    bucketLabel,
    bucketPrompt,
    skipReasonLabel,
    verifiedAgoLabel
} from "../../utils/fileWatcher";
import { compactButtonStyle, modalBodyStyle, smallTextStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { searchKey } from "../../utils/searchText";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const INITIAL_ROWS = 40;
const ROW_STEP = 40;
const ROW_LOAD_AHEAD = 12;

const FETCH_PAGE_ROWS = 1000;

const MAX_LOADED_ROWS = 20000;

const ALL_ROOTS_ID = -1;

type Step = "roots" | "rows";

type RootGroup = {
    rootId: number;
    label: string;
    count: number;
    dirs: number;
    files: number;
};

type RootCount = { rootId: number; count: number; dirs: number; files: number };

function rootsFetcher(bucket: FileWatcherBucket): () => Promise<RootCount[]> {
    if (bucket === "excluded") {
        return async () => (await getFileWatcherExcludedRoots())?.roots ?? [];
    }
    return async () => ((await getFileWatcherFindingRoots(bucket))?.roots ?? [])
        .map((row) => ({ rootId: row.rootId, count: row.count, dirs: 0, files: row.count }));
}

function pageFetcher(bucket: FileWatcherBucket) {
    if (bucket === "excluded") {
        return (limit: number, rootId: number | null, afterRootId: number, afterRelPath: string) =>
            getFileWatcherExcluded(limit, rootId, afterRootId, afterRelPath);
    }
    return (limit: number, rootId: number | null, afterRootId: number, afterRelPath: string) =>
        getFileWatcherFindings(bucket, limit, rootId, afterRootId, afterRelPath);
}

export type FileWatcherFindingsModalProps = {
    language: LanguageCode;
    bucket: FileWatcherBucket;
    roots: FileWatcherRoot[];
    skipped: FileWatcherSkippedRoot[];
    onDismiss: (rootId: number, relPath: string, action: "accept" | "forget") => void | Promise<void>;
    close: () => void;
};

export function FileWatcherFindingsModal(props: FileWatcherFindingsModalProps) {
    const { language, bucket, roots, close } = props;

    const [step, setStep] = useState<Step>("roots");
    const [rootGroups, setRootGroups] = useState<RootGroup[] | null>(null);
    const [selectedRoot, setSelectedRoot] = useState<RootGroup | null>(null);
    const [rows, setRows] = useState<FileWatcherListRow[]>([]);
    const [loadingRows, setLoadingRows] = useState(false);
    const [truncated, setTruncated] = useState(false);
    const [query, setQuery] = useState("");
    const [armedKey, setArmedKey] = useState<string | null>(null);
    const [mountedCount, setMountedCount] = useState(INITIAL_ROWS);

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const focusedTopForStepRef = useRef<Step | null>(null);

    const labelsById = useMemo(() => {
        const map = new Map<number, string>();
        for (const root of roots) {
            map.set(root.id, root.label);
        }
        return map;
    }, [roots]);

    const pathsById = useMemo(() => {
        const map = new Map<number, string>();
        for (const root of roots) {
            map.set(root.id, root.path);
        }
        return map;
    }, [roots]);

    useEffect(() => {
        if (bucket === "skipped") {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const result = await rootsFetcher(bucket)();
                if (cancelled) {
                    return;
                }
                const groups = result.map((row) => ({
                    rootId: row.rootId,
                    label: labelsById.get(row.rootId) ?? String(row.rootId),
                    count: row.count,
                    dirs: row.dirs,
                    files: row.files
                }));
                groups.sort((a, b) => a.label.localeCompare(b.label, language, { sensitivity: "base" }));
                setRootGroups(groups);
                if (groups.length <= 1) {
                    setSelectedRoot(groups[0] ?? null);
                    setStep("rows");
                }
            }
            catch (e) {
                logError("fileWatcherFindingRoots", e);
                setRootGroups([]);
                setStep("rows");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [bucket, labelsById, language]);

    useEffect(() => {
        if (step !== "rows" || bucket === "skipped") {
            return;
        }
        let cancelled = false;
        setRows([]);
        setTruncated(false);
        setLoadingRows(true);
        void (async () => {
            const collected: FileWatcherListRow[] = [];
            const fetchPage = pageFetcher(bucket);
            const rootId = selectedRoot && selectedRoot.rootId !== ALL_ROOTS_ID ? selectedRoot.rootId : null;
            try {
                let afterRootId = 0;
                let afterRelPath = "";
                while (!cancelled && collected.length < MAX_LOADED_ROWS) {
                    const page = await fetchPage(
                        FETCH_PAGE_ROWS,
                        rootId,
                        afterRootId,
                        afterRelPath
                    );
                    const batch = page?.rows ?? [];
                    collected.push(...batch);
                    if (cancelled) {
                        return;
                    }
                    setRows([...collected]);
                    if (batch.length < FETCH_PAGE_ROWS) {
                        return;
                    }
                    const last = batch[batch.length - 1];
                    afterRootId = last.rootId;
                    afterRelPath = last.relPath;
                }
                if (!cancelled) {
                    setTruncated(true);
                }
            }
            catch (e) {
                logError("fileWatcherFindingsPage", e);
            }
            finally {
                if (!cancelled) {
                    setLoadingRows(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [step, bucket, selectedRoot]);

    useEffect(() => {
        if (focusedTopForStepRef.current === step) {
            return;
        }
        const root = bodyRef.current;
        if (!root) {
            return;
        }
        const prefix = step === "roots" ? "filewatcher:findroot:" : "filewatcher:finding:";
        const first = root.querySelector(
            `[data-focus-key^="${prefix}"] button, [data-focus-key^="${prefix}"] [tabindex]`
        ) as HTMLElement | null;
        if (!first) {
            return;
        }
        focusedTopForStepRef.current = step;
        first.focus();
    }, [step, rootGroups, rows.length]);

    const rowKeys = useMemo(() => rows.map((row) => searchKey(row.relPath)), [rows]);

    const filteredRows = useMemo(() => {
        const trimmed = searchKey(query.trim());
        if (!trimmed) {
            return rows;
        }
        return rows.filter((_row, index) => rowKeys[index].includes(trimmed));
    }, [rows, rowKeys, query]);

    useEffect(() => {
        setMountedCount(INITIAL_ROWS);
    }, [query]);

    const action = bucketAction(bucket);

    async function handleRowPress(row: FileWatcherListRow) {
        if (!action) {
            return;
        }
        const key = `${row.rootId}:${row.relPath}`;
        if (armedKey !== key) {
            setArmedKey(key);
            return;
        }
        setArmedKey(null);
        setRows((current) => current.filter((item) => `${item.rootId}:${item.relPath}` !== key));
        await props.onDismiss(row.rootId, row.relPath, action);
    }

    function handlePickRoot(group: RootGroup) {
        focusedTopForStepRef.current = null;
        setSelectedRoot(group);
        setStep("rows");
        setQuery("");
    }

    function maybeLoadMoreFromFocus(index: number) {
        if (index < mountedCount - ROW_LOAD_AHEAD) {
            return;
        }
        setMountedCount((current) => Math.min(current + ROW_STEP, filteredRows.length));
    }

    function handleBackToRoots() {
        focusedTopForStepRef.current = null;
        setSelectedRoot(null);
        setStep("roots");
        setQuery("");
        setArmedKey(null);
    }

    const rowPressRef = useRef(handleRowPress);
    rowPressRef.current = handleRowPress;
    const rowFocusRef = useRef(maybeLoadMoreFromFocus);
    rowFocusRef.current = maybeLoadMoreFromFocus;

    const findingRowList = useMemo<FindingRowListProps>(() => ({
        bucket,
        language,
        onPress: (row) => {
            void rowPressRef.current(row);
        },
        onRowFocus: (index) => {
            rowFocusRef.current(index);
        }
    }), [bucket, language]);

    const showRootStep = step === "roots" && (rootGroups?.length ?? 0) > 1;

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {bucketLabel(bucket, language)}
            </div>

            {bucket === "excluded" && (
                <div style={{ ...modalBodyStyle(), marginBottom: "10px" }}>
                    {t(language, "help_file_watcher_excluded")}
                </div>
            )}

            <div ref={bodyRef}>
                {bucket === "skipped" && (
                    <SkippedList
                        language={language}
                        skipped={props.skipped}
                        labelsById={labelsById}
                        pathsById={pathsById}
                    />
                )}

                {bucket !== "skipped" && showRootStep && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ ...modalBodyStyle(), fontWeight: 700 }}>
                            {t(language, "Pick a directory")}
                        </div>
                        <RootRow
                            group={{
                                rootId: ALL_ROOTS_ID,
                                label: t(language, "All files"),
                                count: (rootGroups ?? []).reduce((total, group) => total + group.count, 0),
                                dirs: (rootGroups ?? []).reduce((total, group) => total + group.dirs, 0),
                                files: (rootGroups ?? []).reduce((total, group) => total + group.files, 0)
                            }}
                            language={language}
                            showFolders={bucket === "excluded"}
                            onPick={handlePickRoot}
                        />
                        {(rootGroups ?? []).map((group) => (
                            <RootRow
                                key={group.rootId}
                                group={group}
                                language={language}
                                showFolders={bucket === "excluded"}
                                onPick={handlePickRoot}
                            />
                        ))}
                    </div>
                )}

                {bucket !== "skipped" && step === "rows" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {(rootGroups?.length ?? 0) > 1 && (
                            <Focusable
                                style={{ display: "flex", gap: "8px", alignItems: "center" }}
                                flow-children="row"
                            >
                                <div data-focus-key="filewatcher:finding:back-to-roots">
                                    <DialogButton onClick={handleBackToRoots} style={compactButtonStyle}>
                                        {t(language, "← Directories")}
                                    </DialogButton>
                                </div>
                                <div style={{ fontWeight: 700, minWidth: 0, wordBreak: "break-word" }}>
                                    {selectedRoot?.label ?? t(language, "All files")}
                                </div>
                            </Focusable>
                        )}

                        <TextField
                            value={query}
                            onChange={(e: any) => setQuery(e?.target?.value ?? "")}
                        />

                        {loadingRows && (
                            <div style={modalBodyStyle()}>
                                {t(language, "Loaded {{count}} so far...", { count: rows.length })}
                            </div>
                        )}
                        {truncated && (
                            <div style={modalBodyStyle()}>
                                {t(language, "Showing the first {{count}} files. Narrow the search to find a particular one.", {
                                    count: MAX_LOADED_ROWS
                                })}
                            </div>
                        )}

                        {
}
                        {!loadingRows && filteredRows.length === 0 && (
                            <div style={modalBodyStyle()}>
                                {t(language, query.trim()
                                    ? "Nothing here matches what you typed."
                                    : "There's nothing in here.")}
                            </div>
                        )}

                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            {filteredRows.slice(0, mountedCount).map((row, index) => (
                                <FindingRow
                                    key={`${row.rootId}:${row.relPath}`}
                                    row={row}
                                    rootPath={pathsById.get(row.rootId) ?? ""}
                                    armed={armedKey === `${row.rootId}:${row.relPath}`}
                                    index={index}
                                    list={findingRowList}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <Focusable
                style={{ display: "flex", justifyContent: "flex-start", gap: "8px", marginTop: "16px" }}
                flow-children="row"
            >
                <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

type RootRowProps = {
    group: RootGroup;
    language: LanguageCode;
    showFolders: boolean;
    onPick: (group: RootGroup) => void;
};

function RootRow(props: RootRowProps) {
    const { group, language } = props;
    const subLabel = props.showFolders
        ? `${t(language, "{{count}} files", { count: group.files })} · ${t(language, "{{count}} folders", { count: group.dirs })}`
        : t(language, "{{count}} files", { count: group.count });
    return (
        <FocusableItem
            focusKey={`filewatcher:findroot:${group.rootId}`}
            onClick={() => props.onPick(group)}
            outerStyle={{ width: "100%", minWidth: 0 }}
            bottomSeparator="none"
        >
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "2px", textAlign: "left" }}>
                <div style={{ fontWeight: 800, minWidth: 0, wordBreak: "break-word" }}>{group.label}</div>
                <div style={{ ...smallTextStyle(), opacity: 1 }}>
                    {subLabel}
                </div>
            </div>
        </FocusableItem>
    );
}

type FindingRowListProps = {
    bucket: FileWatcherBucket;
    language: LanguageCode;
    onPress: (row: FileWatcherListRow) => void;
    onRowFocus: (index: number) => void;
};

type FindingRowProps = {
    row: FileWatcherListRow;
    rootPath: string;
    armed: boolean;
    index: number;
    list: FindingRowListProps;
};

const FindingRow = React.memo(function FindingRow(props: FindingRowProps) {
    const { row, rootPath, armed, list } = props;
    const { bucket, language } = list;
    const name = row.relPath.split("/").pop() || row.relPath;
    const fullPath = rootPath ? `${rootPath}/${row.relPath}` : row.relPath;
    const prompt = "rule" in row
        ? excludedRowNote(row, language)
        : (armed ? bucketConfirm(bucket, language) : bucketPrompt(bucket, language));

    function handlePress() {
        list.onPress(row);
    }

    function handleFocus() {
        list.onRowFocus(props.index);
    }

    return (
        <FocusableItem
            focusKey={`filewatcher:finding:${row.rootId}:${row.relPath}`}
            onClick={handlePress}
            onFocus={handleFocus}
            outerStyle={{ width: "100%", minWidth: 0 }}
            bottomSeparator="none"
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    textAlign: "left",
                    minWidth: 0
                }}
            >
                <div style={{ fontWeight: 800, minWidth: 0, wordBreak: "break-word" }}>{name}</div>
                <div style={{ ...smallTextStyle(), minWidth: 0, wordBreak: "break-all" }}>{fullPath}</div>
                {prompt && (
                    <div style={{ ...smallTextStyle(), opacity: 1, fontWeight: armed ? 700 : 400 }}>
                        {prompt}
                    </div>
                )}
            </div>
        </FocusableItem>
    );
});

function excludedRowNote(row: FileWatcherExcludedRow, language: LanguageCode): string {
    const by = t(language, "Ignored by {{rule}}", { rule: row.rule });
    if (!row.isDir) {
        return by;
    }
    return `${by} — ${t(language, "folder, contents not scanned")}`;
}

type SkippedListProps = {
    language: LanguageCode;
    skipped: FileWatcherSkippedRoot[];
    labelsById: Map<number, string>;
    pathsById: Map<number, string>;
};

function SkippedList(props: SkippedListProps) {
    const { language, skipped, labelsById, pathsById } = props;

    if (skipped.length === 0) {
        return <div style={modalBodyStyle()}>{t(language, "Every directory was reachable.")}</div>;
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {skipped.map((row) => (
                <FocusableItem
                    key={row.rootId}
                    focusKey={`filewatcher:skipped:${row.rootId}`}
                    outerStyle={{ width: "100%", minWidth: 0 }}
                    bottomSeparator="none"
                >
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: "2px",
                            textAlign: "left",
                            minWidth: 0
                        }}
                    >
                        <div style={{ fontWeight: 800, minWidth: 0, wordBreak: "break-word" }}>
                            {labelsById.get(row.rootId) ?? String(row.rootId)}
                        </div>
                        <div style={{ ...smallTextStyle(), minWidth: 0, wordBreak: "break-all" }}>
                            {pathsById.get(row.rootId) ?? ""}
                        </div>
                        <div style={{ ...smallTextStyle(), opacity: 1 }}>
                            {`${skipReasonLabel(row.reason, language)} · ${t(language, "{{count}} files", { count: row.fileCount })} · ${verifiedAgoLabel(row.lastOkAt, language)}`}
                        </div>
                    </div>
                </FocusableItem>
            ))}
        </div>
    );
}
