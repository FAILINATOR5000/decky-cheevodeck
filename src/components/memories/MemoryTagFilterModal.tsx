import React, { useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { LabeledRow } from "../ui/LabeledRow";
import { NoteColorPicker } from "../notes/NoteColorPicker";
import { useWindowedList } from "../../hooks/useWindowedList";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { compactButtonStyle } from "../../utils/style";
import type { MemoryTagRow, MemoryTagSort, NoteColor } from "../../types";

const TAGS_INITIAL_ROWS = 30;
const TAGS_ROW_STEP = 50;
const TAGS_SENTINEL_ROOT_MARGIN = "300px";

const SECTION_HEADING_STYLE: React.CSSProperties = {
    fontSize: `${modalSize(15)}px`,
    fontWeight: 700,
    marginTop: "16px",
    marginBottom: "6px"
};

export type MemoryTagFilterModalProps = {
    tags: MemoryTagRow[];
    selected: string;
    selectedColor: string;
    sort: MemoryTagSort;
    language: LanguageCode;
    onSelect: (tag: string) => void;
    onSelectColor: (color: string) => void;
    onChangeSort: (sort: MemoryTagSort) => void;
    close: () => void;
};

function TagChip(props: {
    label: string;
    count: number | null;
    focusKey: string;
    selected: boolean;
    preferred: boolean;
    onSelect: () => void;
    onFocus?: () => void;
}) {
    const { label, count, focusKey, selected, preferred, onSelect, onFocus } = props;
    return (
        <div data-focus-key={focusKey}>
            <DialogButton
                onClick={onSelect}
                onGamepadFocus={onFocus}
                autoFocus={preferred || undefined}
                style={{
                    ...compactButtonStyle,
                    fontSize: `${modalSize(14)}px`,
                    fontWeight: selected ? 800 : 500,
                    outline: selected ? "2px solid rgba(120, 200, 255, 0.85)" : undefined
                }}
            >
                {count === null ? label : `${label} (${count})`}
            </DialogButton>
        </div>
    );
}

export function MemoryTagFilterModal(props: MemoryTagFilterModalProps) {
    const { tags, selected, language, onSelect, onSelectColor, onChangeSort, close } = props;

    const [color, setColor] = useState(props.selectedColor);

    const [sort, setSort] = useState<MemoryTagSort>(props.sort);

    const rows = useMemo(() => {
        const next = [...tags];
        if (sort === "alpha") {
            next.sort((left, right) => left.tag.localeCompare(right.tag));
        } else {
            next.sort((left, right) => right.lastUsed - left.lastUsed);
        }
        return next;
    }, [tags, sort]);

    const { mountedItems: visibleTags, markerRef, onItemFocus } = useWindowedList({
        items: rows,
        dynamicLoading: true,
        initialRows: TAGS_INITIAL_ROWS,
        rowStep: TAGS_ROW_STEP,
        prefetchDistance: 8,
        sentinelRootMargin: TAGS_SENTINEL_ROOT_MARGIN,
        resetKey: "memoriestag"
    });

    const focusRef = useRef(onItemFocus);
    focusRef.current = onItemFocus;

    const preferredTag = visibleTags.some((row) => row.tag === selected) ? selected : "";

    function toggleSort() {
        const next: MemoryTagSort = sort === "recent" ? "alpha" : "recent";
        setSort(next);
        onChangeSort(next);
    }

    function pick(tag: string) {
        onSelect(tag);
        close();
    }

    function pickColor(next: string) {
        const settled = next === "default" ? "" : next;
        setColor(settled);
        onSelectColor(settled);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "4px" }}>
                {t(language, "Filter")}
            </div>
            <LabeledRow
                focusKey="memories:tagsort"
                label={t(language, "Sort")}
                value={sort === "recent"
                    ? t(language, "Recently Used")
                    : t(language, "Alphabetical")}
                onClick={toggleSort}
                bottomSeparator="none"
            />
            <div style={SECTION_HEADING_STYLE}>
                {t(language, "Tag Filter")}
            </div>
            <Focusable
                flow-children="grid"
                style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: "8px",
                    flexWrap: "wrap",
                    alignItems: "center"
                }}
            >
                <TagChip
                    label={t(language, "All")}
                    count={null}
                    focusKey="memories:tag:all"
                    selected={selected === ""}
                    preferred={preferredTag === ""}
                    onSelect={() => pick("")}
                />
                {visibleTags.map((row, index) => (
                    <TagChip
                        key={row.tag}
                        label={row.tag}
                        count={row.count}
                        focusKey={`memories:tag:${row.tag}`}
                        selected={selected === row.tag}
                        preferred={preferredTag === row.tag}
                        onSelect={() => pick(row.tag)}
                        onFocus={() => focusRef.current(index)}
                    />
                ))}
                {visibleTags.length < rows.length && (
                    <div ref={markerRef} style={{ width: "1px", height: "1px" }} />
                )}
            </Focusable>
            <div style={SECTION_HEADING_STYLE}>
                {t(language, "Color Filter")}
            </div>
            <NoteColorPicker
                selectedColor={color === "" ? "default" : (color as NoteColor)}
                disabled={false}
                onChange={(next) => pickColor(next)}
            />
            <Focusable style={{ display: "flex", marginTop: "16px" }}>
                <DialogButton onClick={close} style={{ width: "100%" }}>
                    {t(language, "Close")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}
