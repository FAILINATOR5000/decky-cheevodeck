import { DialogButton, Focusable, ModalRoot, ScrollPanelGroup } from "@decky/ui";

import type { EmulatorBackup } from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { smallTextStyle } from "../../utils/style";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";

const ROWS_INITIAL = 30;
const ROWS_STEP = 30;

type BackupsOffer = { title: string; path: string; backups: EmulatorBackup[] };

export type BackupChoice = { action: "restore" | "delete"; backup: EmulatorBackup };

function sizeText(bytes: number): string {
    return bytes >= 1000 ** 2 ? `${Math.round(bytes / 1000 ** 2)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function restoreKey(backup: EmulatorBackup): string {
    return `emulators:backups:restore:${backup.path}`;
}

function BackupsModal(props: { language: LanguageCode; offer: BackupsOffer; onChoose: (choice: BackupChoice) => void; close: () => void }) {
    const { language, offer, onChoose, close } = props;
    const list = useSlidingWindow({
        items: offer.backups,
        itemKey: (backup) => backup.path,
        focusKeyFor: restoreKey,
        windowId: "emulators:backups",
        heightScope: ["emulators:backups", language].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        fullSteps: true,
        prefetchDistance: 4,
        sentinelRootMarginPx: 600,
        resetKey: offer.path
    });

    function choose(choice: BackupChoice) {
        onChoose(choice);
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
                <HeadingStop focusKey="emulators:backups:title" autoFocus style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                    {t(language, "Backups of {{name}}", { name: offer.title })}
                </HeadingStop>
                <div style={{ ...smallTextStyle(), overflowWrap: "anywhere", wordBreak: "break-all" }}>{offer.path}</div>
                <div style={{ fontSize: `${modalSize(15)}px`, lineHeight: 1.4 }}>
                    {t(language, "An update keeps the version it replaced here. Restoring swaps it with the one installed now.")}
                </div>
                <div style={{ maxHeight: "45vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <ScrollPanelGroup focusable={false} style={{ flex: 1, minHeight: 0 }}>
                        <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "5px" }}>
                            <SlidingWindowRows list={list}>
                                {list.mountedItems.map((backup, index) => {
                                    const at = list.start + index;
                                    const version = backup.version || t(language, "Unknown version");
                                    return (
                                        <Focusable key={backup.path} flow-children="row" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                            <FocusTarget focusKey={restoreKey(backup)} style={{ flex: 1, minWidth: 0 }}>
                                                <DialogButton
                                                    onClick={() => choose({ action: "restore", backup })}
                                                    onGamepadFocus={() => list.onItemFocus(at)}
                                                    onGamepadDirection={list.guardTopRow(at)}
                                                    style={{ textAlign: "left", overflowWrap: "anywhere" }}
                                                >
                                                    {`${t(language, "Restore {{version}}", { version })} · ${sizeText(backup.size)}`}
                                                </DialogButton>
                                            </FocusTarget>
                                            <FocusTarget focusKey={`emulators:backups:delete:${backup.path}`}>
                                                <DialogButton
                                                    onClick={() => choose({ action: "delete", backup })}
                                                    onGamepadFocus={() => list.onItemFocus(at)}
                                                    style={{ minWidth: 0 }}
                                                >
                                                    {t(language, "Delete")}
                                                </DialogButton>
                                            </FocusTarget>
                                        </Focusable>
                                    );
                                })}
                            </SlidingWindowRows>
                        </Focusable>
                    </ScrollPanelGroup>
                </div>
                <Focusable flow-children="row" style={{ display: "flex", justifyContent: "flex-end" }}>
                    <FocusTarget focusKey="emulators:backups:close">
                        <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
                    </FocusTarget>
                </Focusable>
            </div>
        </ModalRoot>
    );
}

export function askBackups(language: LanguageCode, offer: BackupsOffer): Promise<BackupChoice | null> {
    return new Promise((resolve) => {
        let chosen: BackupChoice | null = null;
        showManagedModal(
            (close) => <BackupsModal language={language} offer={offer} onChoose={(choice) => { chosen = choice; }} close={close} />,
            { onClose: () => resolve(chosen) }
        );
    });
}
