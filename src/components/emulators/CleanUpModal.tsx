import { DialogButton, Focusable, ModalRoot, ScrollPanelGroup } from "@decky/ui";
import { useMemo, useState } from "react";

import type { EmulatorCleanItem } from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, smallTextStyle } from "../../utils/style";
import { FocusTarget } from "../ui/FocusTarget";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";

const ROWS_INITIAL = 30;
const ROWS_STEP = 30;

const GROUPS: { group: EmulatorCleanItem["group"]; label: string }[] = [
    { group: "emulators", label: "Emulator backups" },
    { group: "cores", label: "Core backups" },
    { group: "leftovers", label: "Leftovers" },
    { group: "others", label: "Other old copies" }
];

type CleanRow = { heading: string } | EmulatorCleanItem;

export function sizeText(bytes: number): string {
    return bytes >= 1000 ** 2 ? `${Math.round(bytes / 1000 ** 2)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function rowKey(row: CleanRow): string {
    return "heading" in row ? `emulators:clean:group:${row.heading}` : `emulators:clean:file:${row.path}`;
}

function CleanUpModal(props: { language: LanguageCode; items: EmulatorCleanItem[]; onDelete: (paths: string[]) => void; close: () => void }) {
    const { language, items, onDelete, close } = props;
    const [ticked, setTicked] = useState(() => new Set(items.filter((item) => item.ours).map((item) => item.path)));
    const rows = useMemo(() => {
        const out: CleanRow[] = [];
        for (const { group, label } of GROUPS) {
            const members = items.filter((item) => item.group === group);
            if (members.length > 0) {
                out.push({ heading: label }, ...members);
            }
        }
        return out;
    }, [items]);
    const list = useSlidingWindow({
        items: rows,
        itemKey: rowKey,
        focusKeyFor: rowKey,
        windowId: "emulators:clean",
        heightScope: ["emulators:clean", language].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        fullSteps: true,
        prefetchDistance: 4,
        sentinelRootMarginPx: 600,
        resetKey: "clean"
    });
    const chosen = items.filter((item) => ticked.has(item.path));
    const bytes = chosen.reduce((sum, item) => sum + item.size, 0);

    function flip(path: string) {
        setTicked((current) => {
            const next = new Set(current);
            if (next.has(path)) {
                next.delete(path);
            }
            else {
                next.add(path);
            }
            return next;
        });
    }

    function remove() {
        onDelete(chosen.map((item) => item.path));
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>{t(language, "Clean Up")}</div>
                <div style={{ maxHeight: "50vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <ScrollPanelGroup focusable={false} style={{ flex: 1, minHeight: 0 }}>
                        <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", padding: "5px" }}>
                            <SlidingWindowRows list={list}>
                                {list.mountedItems.map((row, index) => {
                                    const at = list.start + index;
                                    if ("heading" in row) {
                                        return (
                                            <div key={rowKey(row)} style={{ ...smallTextStyle(), margin: "8px 0 4px" }}>
                                                {t(language, row.heading)}
                                            </div>
                                        );
                                    }
                                    const on = ticked.has(row.path);
                                    return (
                                        <FocusTarget key={rowKey(row)} focusKey={rowKey(row)}>
                                            <DialogButton
                                                onClick={() => flip(row.path)}
                                                onGamepadFocus={() => list.onItemFocus(at)}
                                                onGamepadDirection={list.guardTopRow(at)}
                                                style={{
                                                    marginBottom: "4px",
                                                    textAlign: "left",
                                                    outline: on ? `2px solid ${achievementGreen}` : undefined,
                                                    borderRadius: "4px"
                                                }}
                                            >
                                                {`${on ? "✔ " : ""}${row.fileName} · ${sizeText(row.size)}`}
                                            </DialogButton>
                                        </FocusTarget>
                                    );
                                })}
                            </SlidingWindowRows>
                        </Focusable>
                    </ScrollPanelGroup>
                </div>
                <Focusable flow-children="row" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <FocusTarget focusKey="emulators:clean:delete">
                        <DialogButton autoFocus disabled={chosen.length === 0} onClick={remove}>
                            {t(language, "Delete {{count}} files ({{size}})", { count: chosen.length, size: sizeText(bytes) })}
                        </DialogButton>
                    </FocusTarget>
                    <FocusTarget focusKey="emulators:clean:cancel">
                        <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                    </FocusTarget>
                </Focusable>
            </div>
        </ModalRoot>
    );
}

export function askCleanUp(language: LanguageCode, items: EmulatorCleanItem[]): Promise<string[] | null> {
    return new Promise((resolve) => {
        let paths: string[] | null = null;
        showManagedModal(
            (close) => <CleanUpModal language={language} items={items} onDelete={(chosen) => { paths = chosen; }} close={close} />,
            { onClose: () => resolve(paths) }
        );
    });
}
