import { toaster } from "@decky/api";
import { DialogButton, Focusable, ModalRoot, ScrollPanelGroup } from "@decky/ui";
import { useEffect, useMemo, useState } from "react";

import { saveBackupsClear, saveBackupsInfo, saveBackupsRestore, saveBackupsSetConsole, saveBackupsSetGame } from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { SaveBackupReason, SaveBackupsInfo } from "../../types";
import { logError } from "../../utils/errors";
import { formatDateTime } from "../../utils/fileWatcher";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { confirmAmber, modalBodyStyle, warnAmber } from "../../utils/style";
import { ConfirmRow } from "../ui/ConfirmRow";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { ToggleRow } from "../ui/ToggleRow";

const INTERVALS = [0, 15, 30, 60];
const ROWS_INITIAL = 30;
const ROWS_STEP = 30;

const REASON_LABELS: Record<SaveBackupReason, string> = {
    launch: "Before launch",
    couch: "Before Couch Play",
    link: "Before Link Play",
    stream: "Before Stream Play",
    end: "After session",
    mid: "Mid-session",
    "wii-copy-back": "Before Wii copy-back",
    restore: "Before restore"
};

const RESTORE_ERRORS: Record<string, string> = {
    running: "Close the game first, then restore.",
    missing_folder: "This backup's save folder isn't there any more, so it can't be restored."
};

type Row =
    | { kind: "group"; key: string; label: string }
    | { kind: "backup"; key: string; id: string; at: number; reason: SaveBackupReason };

const NO_ROWS: Row[] = [];

function rowsOf(info: SaveBackupsInfo | null): Row[] {
    const groups = info?.groups ?? [];
    if (groups.length === 0) {
        return NO_ROWS;
    }
    const rows: Row[] = [];
    for (const group of groups) {
        if (groups.length > 1) {
            rows.push({ kind: "group", key: `savebackups:group:${group.group}`, label: group.label });
        }
        for (const backup of group.backups) {
            rows.push({ kind: "backup", key: `savebackups:backup:${backup.id}`, id: backup.id, at: backup.at, reason: backup.reason });
        }
    }
    return rows;
}

type SaveBackupsProps = {
    language: LanguageCode;
    gameId: number;
    title: string;
    close: () => void;
};

function SaveBackupsModal(props: SaveBackupsProps) {
    const { language, gameId, title, close } = props;
    const [info, setInfo] = useState<SaveBackupsInfo | null>(null);
    const [armed, setArmed] = useState("");
    const [restoring, setRestoring] = useState(false);

    function load() {
        saveBackupsInfo(gameId)
            .then((next) => {
                if (next.ok) {
                    setInfo(next);
                }
            })
            .catch((e) => logError("save backups: couldn't list this game's backups", e));
    }

    useEffect(load, [gameId]);

    const rows = useMemo(() => rowsOf(info), [info]);
    const list = useSlidingWindow({
        items: rows,
        itemKey: (row) => row.key,
        focusKeyFor: (row) => row.key,
        windowId: "savebackups:list",
        heightScope: ["savebackups:list", language].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        fullSteps: true,
        prefetchDistance: 4,
        sentinelRootMarginPx: 600,
        resetKey: String(gameId)
    });

    const consoleOff = info?.consoleOff === true;
    const gameOff = info?.off === true;
    const interval = info?.interval ?? 60;
    const running = info?.running === true;
    const hasBackups = rows.length > 0;

    function toggleConsole(next: boolean) {
        if (!info?.systemId) {
            return;
        }
        saveBackupsSetConsole(info.systemId, next)
            .then((saved) => {
                if (saved.ok) {
                    setInfo({ ...info, consoleOff: saved.consoleOff });
                }
            })
            .catch((e) => logError("save backups: couldn't save the console switch", e));
    }

    function saveGame(nextInterval: number | null, nextOff: boolean | null) {
        if (!info) {
            return;
        }
        saveBackupsSetGame(gameId, nextInterval, nextOff)
            .then((saved) => {
                if (saved.ok) {
                    setInfo({ ...info, interval: saved.interval ?? interval, off: saved.off ?? gameOff });
                }
            })
            .catch((e) => logError("save backups: couldn't save the game's backup settings", e));
    }

    function cycleInterval() {
        saveGame(INTERVALS[(INTERVALS.indexOf(interval) + 1) % INTERVALS.length], null);
    }

    function pressBackup(id: string) {
        if (restoring) {
            return;
        }
        if (armed !== id) {
            setArmed(id);
            return;
        }
        setArmed("");
        setRestoring(true);
        saveBackupsRestore(gameId, id)
            .then((result) => {
                const body = result.ok
                    ? t(language, "Save restored")
                    : t(language, RESTORE_ERRORS[result.error ?? ""] ?? "Couldn't restore this backup.");
                toaster.toast({ title: t(language, "Backups"), body });
            })
            .catch((e) => logError("save backups: the restore threw", e))
            .finally(() => {
                setRestoring(false);
                load();
            });
    }

    function clearBackups() {
        saveBackupsClear(gameId)
            .catch((e) => logError("save backups: couldn't clear this game's backups", e))
            .finally(load);
    }

    const intervalLabel = interval === 0 ? t(language, "Off") : t(language, "{{count}} min", { count: interval });

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
                <HeadingStop focusKey="savebackups:title" autoFocus style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                    {t(language, "Backups")}
                </HeadingStop>
                <div style={{ ...modalBodyStyle(), overflowWrap: "anywhere" }}>{title}</div>
                {info?.systemId ? (
                    <ToggleRow
                        label={t(language, "Don't Back Up This Console")}
                        value={consoleOff}
                        onChange={toggleConsole}
                        controlled
                        bottomSeparator="none"
                        focusKey="savebackups:toggle:consoleOff"
                        help={t(language, "Stops backups for every {{console}} game. Backups already taken stay and can still be restored.",
                            { console: info.system || "" })}
                        modalHelp
                    />
                ) : null}
                <ToggleRow
                    label={t(language, "Don't Back Up This Game")}
                    value={gameOff}
                    onChange={(next) => saveGame(null, next)}
                    disabled={!info || consoleOff}
                    controlled
                    bottomSeparator="none"
                    focusKey="savebackups:toggle:off"
                    help={consoleOff
                        ? t(language, "Turned off by Don't Back Up This Console.")
                        : t(language, "No backups before, during or after this game's sessions. Backups already taken stay and can still be restored.")}
                    modalHelp
                />
                <FocusableItem
                    focusKey="savebackups:interval"
                    onClick={cycleInterval}
                    disabled={!info || gameOff || consoleOff}
                    bottomSeparator="none"
                    help={t(language, "How often a copy is taken while the game runs, only when its save changed. Backups before and after every session are taken either way.")}
                    modalHelp
                >
                    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 700 }}>{t(language, "Mid-Session Backups")}</span>
                        <span style={{ flexShrink: 0 }}>{intervalLabel}</span>
                    </div>
                </FocusableItem>
                {running && (
                    <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1 }}>
                        {t(language, "Close the game to restore a backup.")}
                    </div>
                )}
                {info && !hasBackups && (
                    <div style={modalBodyStyle()}>{t(language, "No backups yet")}</div>
                )}
                <div style={{ maxHeight: "45vh", overflow: "hidden", display: hasBackups ? "flex" : "none", flexDirection: "column" }}>
                    <ScrollPanelGroup focusable={false} style={{ flex: 1, minHeight: 0 }}>
                        <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "5px" }}>
                            <SlidingWindowRows list={list}>
                                {list.mountedItems.map((row, index) => {
                                    const at = list.start + index;
                                    if (row.kind === "group") {
                                        return (
                                            <HeadingStop key={row.key} focusKey={row.key} style={{ ...modalBodyStyle(), fontWeight: 700, opacity: 1 }}>
                                                {row.label}
                                            </HeadingStop>
                                        );
                                    }
                                    const isArmed = armed === row.id;
                                    return (
                                        <FocusableItem
                                            key={row.key}
                                            focusKey={row.key}
                                            outerStyle={{ width: "100%", minWidth: 0 }}
                                            disabled={running}
                                            onClick={() => pressBackup(row.id)}
                                            onGamepadFocus={() => list.onItemFocus(at)}
                                            onGamepadBlur={() => setArmed((was) => (was === row.id ? "" : was))}
                                            onGamepadDirection={list.guardTopRow(at)}
                                            bottomSeparator="none"
                                        >
                                            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}>
                                                {isArmed ? (
                                                    <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: confirmAmber }}>
                                                        {t(language, "Press again to restore")}
                                                    </span>
                                                ) : (
                                                    <>
                                                        <span style={{ flex: 1, minWidth: 0, fontSize: `${modalSize(15)}px` }}>
                                                            {formatDateTime(row.at, language)}
                                                        </span>
                                                        <span style={{ ...modalBodyStyle(), flexShrink: 0 }}>
                                                            {t(language, REASON_LABELS[row.reason])}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </FocusableItem>
                                    );
                                })}
                            </SlidingWindowRows>
                        </Focusable>
                    </ScrollPanelGroup>
                </div>
                <ConfirmRow
                    focusKey="savebackups:clear"
                    idleLabel={t(language, "Clear Backups")}
                    armedLabel={t(language, "Press again to confirm")}
                    onConfirm={clearBackups}
                    disabled={!hasBackups}
                    bottomSeparator="none"
                    help={t(language, "Deletes every backup of this game's save. The save itself is left alone. Can't be undone.")}
                />
                <Focusable flow-children="row" style={{ display: "flex", justifyContent: "flex-end" }}>
                    <FocusTarget focusKey="savebackups:close">
                        <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
                    </FocusTarget>
                </Focusable>
            </div>
        </ModalRoot>
    );
}

export function showSaveBackups(options: Omit<SaveBackupsProps, "close">) {
    showManagedModal((close) => <SaveBackupsModal {...options} close={close} />);
}
