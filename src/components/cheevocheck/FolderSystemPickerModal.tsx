import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useMemo } from "react";

import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { CheevoCheckSystem } from "../../types";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, modalBodyStyle } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const ROWS_INITIAL = 30;
const ROWS_STEP = 30;
const NAV_ENTER_MAINTAIN_Y = 3;

export type FolderSystemPick = { kind: "auto" } | { kind: "skip" } | { kind: "system"; consoleId: number };

type Item =
    | { kind: "auto"; key: string }
    | { kind: "skip"; key: string }
    | { kind: "likely"; key: string }
    | { kind: "system"; key: string; system: CheevoCheckSystem; first: boolean };

type FolderSystemPickerProps = {
    language: LanguageCode;
    title: string;
    automatic: string;
    likely: number[];
    systems: CheevoCheckSystem[];
    current: FolderSystemPick;
    onPick: (pick: FolderSystemPick) => void;
    close: () => void;
};

function pickKey(pick: FolderSystemPick): string {
    if (pick.kind === "system") {
        return `cheevocheck:folders:pick:${pick.consoleId}`;
    }
    return `cheevocheck:folders:pick:${pick.kind}`;
}

function FolderSystemPickerModal(props: FolderSystemPickerProps) {
    const { language, title, automatic, likely, systems, current, onPick, close } = props;

    const items = useMemo(() => {
        const built: Item[] = [
            { kind: "auto", key: "cheevocheck:folders:pick:auto" },
            { kind: "skip", key: "cheevocheck:folders:pick:skip" }
        ];
        const first = systems.filter((system) => likely.includes(system.consoleId));
        if (first.length > 0) {
            built.push({ kind: "likely", key: "cheevocheck:folders:pick:likely" });
            for (const system of first) {
                built.push({ kind: "system", key: `cheevocheck:folders:pick:${system.consoleId}`, system, first: false });
            }
        }
        let rest = 0;
        for (const system of systems) {
            if (!likely.includes(system.consoleId)) {
                built.push({ kind: "system", key: `cheevocheck:folders:pick:${system.consoleId}`, system, first: first.length > 0 && rest === 0 });
                rest += 1;
            }
        }
        return built;
    }, [likely, systems]);

    const chosenKey = pickKey(current);
    const list = useSlidingWindow({
        items,
        itemKey: (item) => item.key,
        focusKeyFor: (item) => item.key,
        windowId: "cheevocheck:folders:picker",
        heightScope: ["cheevocheck:folders:picker", language].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        fullSteps: true,
        prefetchDistance: 4,
        sentinelRootMarginPx: 600,
        resetKey: title,
        openFirst: chosenKey
    });

    function pick(next: FolderSystemPick) {
        onPick(next);
        close();
    }

    function row(item: Item, at: number, label: string, detail: string | null, next: FolderSystemPick, separated: boolean) {
        const picked = item.key === chosenKey;
        return (
            <FocusableItem
                key={item.key}
                focusKey={item.key}
                focusFallback={["cheevocheck:folders:pick:auto"]}
                autoFocus={picked}
                outerStyle={{
                    width: "100%",
                    minWidth: 0,
                    ...(separated ? { borderTop: "1px solid rgba(255, 255, 255, 0.15)", paddingTop: "6px" } : {}),
                    ...(picked ? { outline: `2px solid ${achievementGreen}`, outlineOffset: "-2px", borderRadius: "6px" } : {})
                }}
                onClick={() => pick(next)}
                onGamepadFocus={() => list.onItemFocus(at)}
                onGamepadDirection={list.guardTopRow(at)}
                bottomSeparator="none"
            >
                <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: picked ? 700 : 500 }}>{label}</div>
                        {detail && <div style={{ ...modalBodyStyle(), opacity: 0.7 }}>{detail}</div>}
                    </div>
                    {picked && <span style={{ color: achievementGreen, flexShrink: 0 }}>{"✔"}</span>}
                </div>
            </FocusableItem>
        );
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, overflowWrap: "anywhere" }}>
                    {t(language, "Which system is this folder for?")}
                </div>
                <div style={{ ...modalBodyStyle(14), overflowWrap: "anywhere", opacity: 0.8 }}>
                    {title}
                </div>
                <Focusable
                    flow-children="column"
                    resetNavOnEntry
                    navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}
                    style={{ display: "flex", flexDirection: "column", gap: "6px" }}
                >
                    <SlidingWindowRows list={list}>
                        {list.mountedItems.map((item, index) => {
                            const at = list.start + index;
                            if (item.kind === "auto") {
                                return row(item, at, t(language, "Automatic"), automatic, { kind: "auto" }, false);
                            }
                            if (item.kind === "skip") {
                                return row(item, at, t(language, "Skip This Folder"), null, { kind: "skip" }, false);
                            }
                            if (item.kind === "likely") {
                                return (
                                    <HeadingStop
                                        key={item.key}
                                        focusKey={item.key}
                                        onGamepadFocus={() => list.onItemFocus(at)}
                                        onGamepadDirection={list.guardTopRow(at)}
                                        outerStyle={{ marginTop: "6px" }}
                                        style={{ fontWeight: 700, opacity: 0.8 }}
                                    >
                                        {t(language, "Likely")}
                                    </HeadingStop>
                                );
                            }
                            return row(item, at, item.system.name, null, { kind: "system", consoleId: item.system.consoleId }, item.first);
                        })}
                    </SlidingWindowRows>
                </Focusable>
                <Focusable flow-children="row" style={{ display: "flex" }}>
                    <FocusTarget focusKey="cheevocheck:folders:pick:close" style={{ display: "flex", flex: 1, minWidth: 0 }}>
                        <DialogButton onClick={close} style={{ width: "100%" }}>{t(language, "Cancel")}</DialogButton>
                    </FocusTarget>
                </Focusable>
            </div>
        </ModalRoot>
    );
}

export function showFolderSystemPicker(options: Omit<FolderSystemPickerProps, "close">) {
    showManagedModal((close) => <FolderSystemPickerModal {...options} close={close} />);
}
