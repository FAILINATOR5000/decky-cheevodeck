import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import {
    cancelCheevoCheckPreview,
    getCheevoCheckPreviewProgress,
    getCheevoCheckSystems,
    previewCheevoCheckFolders,
    saveCheevoCheckFolderSystems
} from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type {
    CheevoCheckFolderAnswer,
    CheevoCheckFolderChoice,
    CheevoCheckFolderRow,
    CheevoCheckPreviewProgress,
    CheevoCheckSystem
} from "../../types";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle, warnAmber } from "../../utils/style";
import { openPathPicker } from "../pickers/FilePickerModal";
import { ButtonPrompt } from "../ui/ButtonPrompt";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { ProgressBar } from "../ui/ProgressBar";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { showFolderSystemPicker, type FolderSystemPick } from "./FolderSystemPickerModal";

const PROGRESS_POLL_MS = 1000;
const ROWS_INITIAL = 30;
const ROWS_STEP = 30;
const NAV_ENTER_MAINTAIN_Y = 3;
const HOME = "/home/deck";

const unsaved = new Map<string, Record<string, FolderSystemPick>>();
let lastFolder: string | null = null;
let systemsCache: CheevoCheckSystem[] | null = null;

export function folderPickedThisSession(): string | null {
    return lastFolder;
}

function shortPath(path: string): string {
    return path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}

function answerFor(row: CheevoCheckFolderRow, pick: FolderSystemPick | undefined, systems: CheevoCheckSystem[], dataConsoles: number[] | null): CheevoCheckFolderAnswer {
    if (!pick) {
        return row;
    }
    if (pick.kind === "auto") {
        return row.auto ?? row;
    }
    if (pick.kind === "skip") {
        return { source: "skip", consoleId: 0, name: "", noData: false };
    }
    return {
        source: "override",
        consoleId: pick.consoleId,
        name: systems.find((system) => system.consoleId === pick.consoleId)?.name ?? "",
        noData: dataConsoles !== null && !dataConsoles.includes(pick.consoleId)
    };
}

function currentPick(row: CheevoCheckFolderRow, pick: FolderSystemPick | undefined): FolderSystemPick {
    if (pick) {
        return pick;
    }
    if (row.source === "override") {
        return { kind: "system", consoleId: row.consoleId };
    }
    return row.source === "skip" ? { kind: "skip" } : { kind: "auto" };
}

function draftChanges(rows: CheevoCheckFolderRow[], picks: Record<string, FolderSystemPick>): Record<string, CheevoCheckFolderChoice> {
    const changes: Record<string, CheevoCheckFolderChoice> = {};
    for (const row of rows) {
        const pick = picks[row.path];
        if (pick?.kind === "system") {
            changes[row.path] = { consoleId: pick.consoleId };
        }
        else if (pick?.kind === "skip") {
            changes[row.path] = { skip: true };
        }
        else if (pick?.kind === "auto") {
            changes[row.path] = row.auto?.source === "guess" ? { consoleId: row.auto.consoleId } : null;
        }
        else if (row.source === "guess") {
            changes[row.path] = { consoleId: row.consoleId };
        }
    }
    return changes;
}

function answerText(language: LanguageCode, answer: CheevoCheckFolderAnswer): string {
    switch (answer.source) {
        case "unsure":
            return t(language, "Not Sure");
        case "unsupported":
            return t(language, "Not on RetroAchievements");
        case "skip":
            return t(language, "cheevo_check_folder_skipped");
        default:
            return answer.name;
    }
}

function sourceText(language: LanguageCode, answer: CheevoCheckFolderAnswer, row: CheevoCheckFolderRow): string {
    if (answer.noData) {
        return t(language, "Needs an online scan first");
    }
    switch (answer.source) {
        case "folder":
        case "unsupported":
            return t(language, "From the folder name");
        case "override":
        case "skip":
            return t(language, "Set by you");
        case "guess":
            return t(language, "Guessed from the folder name");
        case "types":
            return t(language, "From file types ({{types}})", { types: row.extensions.join(" ") });
        case "unsure": {
            const names = row.guess.map((system) => system.name);
            if (names.length === 0) {
                return row.extensions.join(" ");
            }
            if (names.length > 3) {
                return t(language, "Could be {{systems}} +{{more}}", { systems: names.slice(0, 3).join(", "), more: names.length - 3 });
            }
            return t(language, "Could be {{systems}}", { systems: names.join(", ") });
        }
    }
}

type FolderSystemsProps = {
    language: LanguageCode;
    root: string;
    offline: boolean;
    forward: "start" | "next";
    onConfirm: (root: string) => void;
    close: () => void;
};

function FolderSystemsModal(props: FolderSystemsProps) {
    const { language, offline, forward, onConfirm, close } = props;

    const [root, setRoot] = useState(props.root);
    const [rows, setRows] = useState<CheevoCheckFolderRow[] | null>(null);
    const [missing, setMissing] = useState(false);
    const [dataConsoles, setDataConsoles] = useState<number[] | null>(null);
    const [progress, setProgress] = useState<CheevoCheckPreviewProgress | null>(null);
    const [picks, setPicks] = useState<Record<string, FolderSystemPick>>(() => unsaved.get(props.root) ?? {});
    const [systems, setSystems] = useState<CheevoCheckSystem[]>(systemsCache ?? []);
    const [waiting, setWaiting] = useState(false);
    const savedRef = useRef(false);
    const draftRef = useRef({ root, picks });
    draftRef.current = { root, picks };
    lastFolder = root;

    useEffect(() => {
        if (systemsCache) {
            return;
        }
        void getCheevoCheckSystems()
            .then((result) => {
                systemsCache = result?.systems ?? [];
                setSystems(systemsCache);
            })
            .catch((e) => logError("read the Cheevo Check systems list", e));
    }, []);

    useEffect(() => () => {
        if (!savedRef.current) {
            unsaved.set(draftRef.current.root, draftRef.current.picks);
        }
    }, []);

    useEffect(() => {
        let live = true;
        let finished = false;
        setRows(null);
        setMissing(false);
        setProgress(null);
        const timer = window.setInterval(() => {
            void getCheevoCheckPreviewProgress()
                .then((result) => {
                    if (live && result?.progress) {
                        setProgress(result.progress);
                    }
                })
                .catch((e) => logError("read the Cheevo Check prescan progress", e));
        }, PROGRESS_POLL_MS);
        previewCheevoCheckFolders(root, offline)
            .then((result) => {
                if (!live || result?.cancelled) {
                    return;
                }
                setMissing(result?.ok === false && result.error === "bad_root");
                setRows(result?.rows ?? []);
                setDataConsoles(result?.dataConsoles ?? null);
            })
            .catch((e) => {
                logError("run the Cheevo Check prescan", e);
                if (live) {
                    setRows([]);
                }
            })
            .finally(() => {
                finished = true;
                window.clearInterval(timer);
            });
        return () => {
            live = false;
            window.clearInterval(timer);
            if (!finished) {
                void cancelCheevoCheckPreview().catch((e) => logError("cancel the Cheevo Check prescan", e));
            }
        };
    }, [root, offline]);

    useEffect(() => {
        if (waiting && rows) {
            if (missing) {
                setWaiting(false);
                return;
            }
            void confirm(rows);
        }
    }, [waiting, rows, missing]);

    const list = useSlidingWindow({
        items: rows ?? NO_ROWS,
        itemKey: (row) => row.path,
        focusKeyFor: rowKey,
        windowId: "cheevocheck:folders:rows",
        heightScope: ["cheevocheck:folders:rows", language].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        fullSteps: true,
        prefetchDistance: 4,
        sentinelRootMarginPx: 600,
        resetKey: root
    });

    async function confirm(ready: CheevoCheckFolderRow[]) {
        savedRef.current = true;
        try {
            const saved = await saveCheevoCheckFolderSystems(root, draftChanges(ready, picks));
            if (!saved?.ok) {
                logError("save the Cheevo Check folder systems", new Error("refused"));
            }
        }
        catch (e) {
            logError("save the Cheevo Check folder systems", e);
        }
        unsaved.delete(root);
        onConfirm(root);
        close();
    }

    function pressForward() {
        if (rows) {
            void confirm(rows);
            return;
        }
        setWaiting(true);
    }

    function changeFolder() {
        openPathPicker({
            language,
            prompt: t(language, "Choose your ROMs collection folder"),
            startPath: root,
            includeFiles: false,
            includeFolders: true
        })
            .then((picked) => {
                const next = picked.realpath || picked.path;
                if (!next || next === root) {
                    return;
                }
                unsaved.set(root, picks);
                setPicks(unsaved.get(next) ?? {});
                setRoot(next);
            })
            .catch(() => { });
    }

    function openPicker(row: CheevoCheckFolderRow) {
        const pick = picks[row.path];
        const automatic = row.auto ?? row;
        showFolderSystemPicker({
            language,
            title: row.label || shortPath(root),
            automatic: answerText(language, automatic),
            likely: row.guess.map((system) => system.consoleId),
            systems,
            current: currentPick(row, pick),
            onPick: (next) => setPicks((was) => {
                const draft = { ...was };
                const saved = currentPick(row, undefined);
                if (next.kind === saved.kind && (next.kind !== "system" || (saved.kind === "system" && next.consoleId === saved.consoleId))) {
                    delete draft[row.path];
                }
                else {
                    draft[row.path] = next;
                }
                return draft;
            })
        });
    }

    function buttons(where: "top" | "bottom") {
        const suffix = where === "top" ? "" : ":bottom";
        return (
            <Focusable flow-children="row" style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <FocusTarget focusKey={`cheevocheck:folders:start${suffix}`} style={{ display: "flex", flex: 1, minWidth: 0 }}>
                    <DialogButton onClick={pressForward} disabled={waiting || missing} style={{ width: "100%" }}>
                        {t(language, forward === "next" ? "Next" : "Start Scan")}
                    </DialogButton>
                </FocusTarget>
                <FocusTarget focusKey={`cheevocheck:folders:cancel${suffix}`} style={{ display: "flex", flex: 1, minWidth: 0 }}>
                    <DialogButton onClick={close} style={{ width: "100%" }}>
                        {t(language, "Cancel")}
                    </DialogButton>
                </FocusTarget>
            </Focusable>
        );
    }

    const loading = rows === null;
    const fraction = progress && progress.total > 0 ? progress.done / progress.total : 0;

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                    {t(language, "Check Your Systems")}
                </div>
                <div style={{ ...modalBodyStyle(14), lineHeight: 1.4 }}>
                    {t(language, "cheevo_check_folders_heading")}
                    {" "}
                    <span style={{ color: warnAmber }}>
                        {t(language, "cheevo_check_folders_correct")}
                        {" "}
                        {t(language, "If this is the wrong folder for your library, select it to pick another.")}
                    </span>
                </div>
                <FocusableItem
                    focusKey="cheevocheck:folders:folder"
                    focusFallback={["cheevocheck:folders:start"]}
                    autoFocus
                    outerStyle={{ width: "100%", minWidth: 0 }}
                    onClick={changeFolder}
                    bottomSeparator="none"
                >
                    <div style={{ textAlign: "left", overflowWrap: "anywhere" }}>
                        {t(language, "Folder: {{folder}}", { folder: shortPath(root) })}
                    </div>
                </FocusableItem>
                {buttons("top")}
                {rows && rows.length > 0 && (
                    <div style={{ ...modalBodyStyle(14), lineHeight: 1.4, color: warnAmber, opacity: 1 }}>
                        {t(language, "Please verify your folders are associated with the correct system below before hitting \"{{button}}\".", {
                            button: t(language, forward === "next" ? "Next" : "Start Scan")
                        })}
                    </div>
                )}
                {loading && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px 0" }}>
                        <ProgressBar fraction={fraction} />
                        <div style={modalBodyStyle()}>
                            {t(language, "{{count}} files in {{folders}} folders so far", {
                                count: progress?.files ?? 0,
                                folders: progress?.folders ?? 0
                            })}
                        </div>
                    </div>
                )}
                {rows && rows.length === 0 && (
                    <div style={{ ...modalBodyStyle(14), padding: "8px 0", color: missing ? warnAmber : undefined }}>
                        {t(language, missing
                            ? "That folder isn't there any more. Pick another with the Folder row."
                            : "No game files were found in this folder.")}
                    </div>
                )}
                <Focusable
                    key={root}
                    flow-children="column"
                    resetNavOnEntry
                    navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}
                    style={{ display: rows && rows.length > 0 ? "flex" : "none", flexDirection: "column", gap: "4px" }}
                >
                    <SlidingWindowRows list={list}>
                        {list.mountedItems.map((row, index) => {
                            const at = list.start + index;
                            const all = rows ?? NO_ROWS;
                            const answer = answerFor(row, picks[row.path], systems, dataConsoles);
                            const attention = answer.source === "unsure" || answer.source === "unsupported";
                            return (
                                <FocusableItem
                                    key={row.path}
                                    focusKey={rowKey(row)}
                                    focusFallback={[
                                        ...(all[at + 1] ? [rowKey(all[at + 1])] : []),
                                        ...(all[at - 1] ? [rowKey(all[at - 1])] : []),
                                        "cheevocheck:folders:start"
                                    ]}
                                    outerStyle={{ width: "100%", minWidth: 0 }}
                                    onClick={() => openPicker(row)}
                                    onGamepadFocus={() => list.onItemFocus(at)}
                                    onGamepadDirection={list.guardTopRow(at)}
                                    bottomSeparator="none"
                                >
                                    <div style={{ width: "100%", textAlign: "left", minWidth: 0 }}>
                                        <div style={{ overflowWrap: "anywhere" }}>
                                            {`${row.label || t(language, "This folder")}  →  `}
                                            <span style={{ fontWeight: 700, color: attention ? warnAmber : undefined }}>
                                                {answerText(language, answer)}
                                            </span>
                                        </div>
                                        <div style={{ ...modalBodyStyle(), opacity: answer.noData ? 1 : 0.7, color: answer.noData ? warnAmber : undefined }}>
                                            {`${sourceText(language, answer, row)} · ${t(language, "{{count}} files", { count: row.files })}`}
                                        </div>
                                        <div style={{ ...modalBodyStyle(), lineHeight: 1, marginTop: "6px", opacity: 0.7 }}>
                                            <ButtonPrompt language={language} textKey="{{button}} Change System" button="a" fontSize={modalSize(12)} inline />
                                        </div>
                                    </div>
                                </FocusableItem>
                            );
                        })}
                    </SlidingWindowRows>
                </Focusable>
                {rows && rows.length > 0 && buttons("bottom")}
            </div>
        </ModalRoot>
    );
}

const NO_ROWS: CheevoCheckFolderRow[] = [];

function rowKey(row: CheevoCheckFolderRow): string {
    return `cheevocheck:folders:row:${row.path}`;
}

export function confirmFolderSystems(options: { language: LanguageCode; root: string; offline: boolean; forward: "start" | "next" }): Promise<{ root: string } | null> {
    return new Promise((resolve) => {
        let chosen: { root: string } | null = null;
        showManagedModal(
            (close) => <FolderSystemsModal {...options} onConfirm={(root) => { chosen = { root }; }} close={close} />,
            { onClose: () => resolve(chosen) }
        );
    });
}
