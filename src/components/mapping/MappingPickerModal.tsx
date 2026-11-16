import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useMemo, useState } from "react";

import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { DolphinMapping } from "../../types";
import { groupMappingsByTag } from "../../utils/dolphin";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, modalBodyStyle } from "../../utils/style";
import { CollapseChevron } from "../ui/CollapseChevron";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { MappingCardBody } from "./MappingCardBody";

const ROWS_INITIAL = 30;
const ROWS_STEP = 30;
const NAV_ENTER_MAINTAIN_Y = 3;

type Row =
    | { kind: "group"; key: string; group: string; label: string }
    | { kind: "mapping"; key: string; group: string; mapping: DolphinMapping };

type MappingPickerProps = {
    language: LanguageCode;
    title: string;
    mappings: DolphinMapping[];
    chosen: string;
    onPick: (mappingId: string) => void;
    close: () => void;
};

function MappingPickerModal(props: MappingPickerProps) {
    const { language, title, mappings, chosen, onPick, close } = props;
    const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

    const groups = useMemo(() => groupMappingsByTag(mappings, language), [mappings, language]);
    const rows = useMemo(() => {
        const built: Row[] = [];
        for (const group of groups) {
            built.push({ kind: "group", key: `mappingpicker:group:${group.key}`, group: group.key, label: group.header });
            if (open.has(group.key)) {
                for (const mapping of group.mappings) {
                    built.push({ kind: "mapping", key: `mappingpicker:mapping:${mapping.id}`, group: group.key, mapping });
                }
            }
        }
        return built;
    }, [groups, open]);

    const list = useSlidingWindow({
        items: rows,
        itemKey: (row) => row.key,
        focusKeyFor: (row) => row.key,
        windowId: "mappingpicker:list",
        heightScope: ["mappingpicker:list", language].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        fullSteps: true,
        prefetchDistance: 4,
        sentinelRootMarginPx: 600,
        resetKey: title
    });

    function toggle(group: string) {
        setOpen((was) => {
            const next = new Set(was);
            if (!next.delete(group)) {
                next.add(group);
            }
            return next;
        });
    }

    function pick(mappingId: string) {
        if (mappingId !== chosen) {
            onPick(mappingId);
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
                <HeadingStop focusKey="mappingpicker:title" autoFocus style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                    {title}
                </HeadingStop>
                <FocusableItem
                    focusKey="mappingpicker:none"
                    outerStyle={{ width: "100%", minWidth: 0 }}
                    onClick={() => pick("")}
                    bottomSeparator="none"
                >
                    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}>
                        <span style={{ flex: 1, minWidth: 0, fontWeight: chosen ? 500 : 700 }}>{t(language, "None")}</span>
                        {!chosen && <span style={{ color: achievementGreen, flexShrink: 0 }}>{"✔"}</span>}
                    </div>
                </FocusableItem>
                {mappings.length === 0 && (
                    <div style={modalBodyStyle()}>
                        {t(language, "No mappings for this console yet. Make one in the Dolphin Mapper.")}
                    </div>
                )}
                <Focusable
                    flow-children="column"
                    resetNavOnEntry
                    navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}
                    style={{ display: rows.length > 0 ? "flex" : "none", flexDirection: "column", gap: "6px" }}
                >
                    <SlidingWindowRows list={list}>
                        {list.mountedItems.map((row, index) => {
                            const at = list.start + index;
                            if (row.kind === "group") {
                                const folded = !open.has(row.group);
                                return (
                                    <FocusableItem
                                        key={row.key}
                                        focusKey={row.key}
                                        outerStyle={{ width: "100%", minWidth: 0 }}
                                        onClick={() => toggle(row.group)}
                                        onGamepadFocus={() => list.onItemFocus(at)}
                                        onGamepadDirection={list.guardTopRow(at)}
                                        bottomSeparator="none"
                                    >
                                        <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}>
                                            <span style={{ flex: 1, minWidth: 0, fontWeight: 700 }}>{row.label}</span>
                                            <span style={{ display: "inline-flex", flexShrink: 0 }}><CollapseChevron collapsed={folded} /></span>
                                        </div>
                                    </FocusableItem>
                                );
                            }
                            const picked = row.mapping.id === chosen;
                            return (
                                <FocusableItem
                                    key={row.key}
                                    focusKey={row.key}
                                    focusFallback={[`mappingpicker:group:${row.group}`, "mappingpicker:none"]}
                                    outerStyle={{ width: "100%", minWidth: 0, ...(picked ? { outline: `2px solid ${achievementGreen}`, borderRadius: "6px" } : {}) }}
                                    onClick={() => pick(row.mapping.id)}
                                    onGamepadFocus={() => list.onItemFocus(at)}
                                    onGamepadDirection={list.guardTopRow(at)}
                                    bottomSeparator="none"
                                >
                                    <MappingCardBody mapping={row.mapping} language={language} modal />
                                </FocusableItem>
                            );
                        })}
                    </SlidingWindowRows>
                </Focusable>
                <Focusable flow-children="row" style={{ display: "flex" }}>
                    <FocusTarget focusKey="mappingpicker:close" style={{ display: "flex", flex: 1, minWidth: 0 }}>
                        <DialogButton onClick={close} style={{ width: "100%" }}>{t(language, "Close")}</DialogButton>
                    </FocusTarget>
                </Focusable>
            </div>
        </ModalRoot>
    );
}

export function showMappingPicker(options: Omit<MappingPickerProps, "close">) {
    showManagedModal((close) => <MappingPickerModal {...options} close={close} />);
}
