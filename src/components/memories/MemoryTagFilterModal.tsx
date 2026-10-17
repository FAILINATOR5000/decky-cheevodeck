import React, { useMemo, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { LabeledRow } from "../ui/LabeledRow";
import { NoteColorPicker } from "../notes/NoteColorPicker";
import { MEDIA_FILTER_CHOICES } from "../../utils/memories";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { compactButtonStyle } from "../../utils/style";
import type { MemoryTagRow, MemoryTagSort, NoteColor } from "../../types";

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
    selectedMedia: string;
    sort: MemoryTagSort;
    language: LanguageCode;
    onSelect: (tag: string) => void;
    onSelectColor: (color: string) => void;
    onSelectMedia: (media: string) => void;
    onChangeSort: (sort: MemoryTagSort) => void;
    onClearFilters: () => void;
    close: () => void;
};


function TagChip(props: {
    label: string;
    count: number | null;
    focusKey: string;
    selected: boolean;
    onSelect: () => void;
}) {
    const { label, count, focusKey, selected, onSelect } = props;
    return (
        <div data-focus-key={focusKey}>
            <DialogButton
                onClick={onSelect}
                style={{
                    ...compactButtonStyle,
                    fontSize: `${modalSize(14)}px`,
                    fontWeight: selected ? 800 : 500,
                    outline: selected ? "1px solid rgba(255,255,255,0.65)" : undefined
                }}
            >
                {count === null ? label : `${label} (${count})`}
            </DialogButton>
        </div>
    );
}

export function MemoryTagFilterModal(props: MemoryTagFilterModalProps) {
    const { tags, language, onSelect, onSelectColor, onSelectMedia, onChangeSort, onClearFilters, close } = props;

    const [tag, setTag] = useState(props.selected);

    const [color, setColor] = useState(props.selectedColor);

    const [media, setMedia] = useState(props.selectedMedia);

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


    function toggleSort() {
        const next: MemoryTagSort = sort === "recent" ? "alpha" : "recent";
        setSort(next);
        onChangeSort(next);
    }

    function pick(next: string) {
        setTag(next);
        onSelect(next);
    }

    function pickColor(next: string) {
        const settled = next === "default" ? "" : next;
        setColor(settled);
        onSelectColor(settled);
    }

    function pickMedia(next: string) {
        setMedia(next);
        onSelectMedia(next);
    }

    function resetFilter() {
        setTag("");
        setColor("");
        setMedia("");
        onClearFilters();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SaveOnStart canSave label={t(language, "Close")} onSave={close}>
                <SnapshotHotkey language={language} />
                <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "4px" }}>
                    {t(language, "Filter")}
                </div>
                <LabeledRow
                    focusKey="memories:tagsort"
                    label={t(language, "Tag Order")}
                    value={sort === "recent"
                        ? t(language, "Recently Used")
                        : t(language, "Alphabetical")}
                    onClick={toggleSort}
                    autoFocus
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
                        selected={tag === ""}
                        onSelect={() => pick("")}
                    />
                    {rows.map((row) => (
                        <TagChip
                            key={row.tag}
                            label={row.tag}
                            count={row.count}
                            focusKey={`memories:tag:${row.tag}`}
                            selected={tag === row.tag}
                            onSelect={() => pick(row.tag)}
                        />
                    ))}
                </Focusable>
                <div style={SECTION_HEADING_STYLE}>
                    {t(language, "Color Filter")}
                </div>
                <NoteColorPicker
                    selectedColor={color === "" ? "default" : (color as NoteColor)}
                    disabled={false}
                    onChange={(next) => pickColor(next)}
                />
                <div style={SECTION_HEADING_STYLE}>
                    {t(language, "Media Type")}
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
                    {MEDIA_FILTER_CHOICES.map((choice) => (
                        <TagChip
                            key={choice.key}
                            label={t(language, choice.key)}
                            count={null}
                            focusKey={`memories:media:${choice.value || "all"}`}
                            selected={media === choice.value}
                            onSelect={() => pickMedia(choice.value)}
                        />
                    ))}
                </Focusable>
                <Focusable style={{ display: "flex", marginTop: "16px" }}>
                    <DialogButton onClick={resetFilter} style={{ width: "100%" }}>
                        {t(language, "Reset Filter")}
                    </DialogButton>
                </Focusable>
                <Focusable style={{ display: "flex", marginTop: "8px" }}>
                    <DialogButton onClick={close} style={{ width: "100%" }}>
                        {t(language, "Close")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}
