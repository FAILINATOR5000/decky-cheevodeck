import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";
import { markNextValidationSkipped, updateMemory } from "../../api";
import { armMemoriesFocusKey, armMemoriesFocusReturn } from "../../utils/memoriesFocusReturn";
import { ErrorText } from "../ui/ErrorText";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { NoteColorPicker } from "../notes/NoteColorPicker";
import { TagPickerModal } from "../tags/TagPickerModal";
import { showManagedModal } from "../../utils/modalRegistry";
import { logError } from "../../utils/errors";
import { modalSize } from "../../utils/scale";
import { compactButtonStyle } from "../../utils/style";
import { MEMORY_TAG_SEEDS, cleanTagInput } from "../../utils/tags";
import { TAG_MAX_LEN } from "../../utils/achievements";
import { t, type LanguageCode } from "../../locales";
import type { MemoryRecord, NoteColor } from "../../types";

const CAPTION_MAX_LEN = 300;

const SUGGESTION_COUNT = 10;

type MemoryEditorSaved = {
    caption: string;
    tag: string | null;
    color: NoteColor;
};

export type MemoryEditorModalProps = {
    memory: MemoryRecord;
    gameId: number;
    language: LanguageCode;
    allTags: string[];
    activeUlid: string;
    tagFilter: string;
    removalLandingId: string | null;
    onSaved?: (next: MemoryEditorSaved) => void;
    close: () => void;
};

export function MemoryEditorModal(props: MemoryEditorModalProps) {
    const { memory, gameId, language, allTags, activeUlid, tagFilter, removalLandingId, onSaved, close } = props;

    const [caption, setCaption] = useState(memory.caption);
    const [tag, setTag] = useState(memory.tag ?? "");
    const [color, setColor] = useState<NoteColor>(memory.color);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const seen = new Set<string>();
    const suggestions: Array<{ key: string; label: string; tag: string }> = [];
    for (const entry of allTags) {
        const trimmed = entry.trim();
        if (!trimmed) {
            continue;
        }
        const lower = trimmed.toLowerCase();
        if (seen.has(lower)) {
            continue;
        }
        seen.add(lower);
        suggestions.push({ key: `recent:${lower}`, label: trimmed, tag: trimmed });
        if (suggestions.length >= SUGGESTION_COUNT) {
            break;
        }
    }
    for (const seed of MEMORY_TAG_SEEDS) {
        if (suggestions.length >= SUGGESTION_COUNT) {
            break;
        }
        const lower = seed.tag.toLowerCase();
        if (seen.has(lower)) {
            continue;
        }
        seen.add(lower);
        suggestions.push({ key: `seed:${lower}`, label: t(language, seed.key), tag: seed.tag });
    }

    function openTagPicker() {
        if (saving) {
            return;
        }
        showManagedModal((closePicker) => (
            <TagPickerModal
                tags={allTags}
                seeds={MEMORY_TAG_SEEDS}
                selected={tag}
                language={language}
                focusPrefix="memories"
                onSelect={(picked) => setTag(cleanTagInput(picked, TAG_MAX_LEN))}
                close={closePicker}
            />
        ));
    }

    async function save() {
        if (saving) {
            return;
        }
        setSaving(true);
        setError(null);
        markNextValidationSkipped();
        try {
            const result = await updateMemory(gameId, memory.id, caption, tag, color);
            if (!result?.ok) {
                setSaving(false);
                setError(t(language, "Couldn't save this memory."));
                return;
            }
            reaimFocusReturn(tag.trim());
            onSaved?.({
                caption,
                tag: tag.trim() || null,
                color
            });
            close();
        } catch (e) {
            logError("memories: couldn't save a memory", e);
            setSaving(false);
            setError(t(language, "Couldn't save this memory."));
        }
    }

    function reaimFocusReturn(nextTag: string) {
        if (!tagFilter || nextTag === tagFilter) {
            return;
        }
        if (removalLandingId === null) {
            armMemoriesFocusKey("memories:filter");
            return;
        }
        armMemoriesFocusReturn(gameId, removalLandingId, activeUlid);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SaveOnStart canSave={!saving} label={t(language, "Save")} onSave={() => void save()}>
                <SnapshotHotkey language={language} />
                <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "12px" }}>
                    {t(language, "Edit Memory")}
                </div>

                <div style={{ marginBottom: "10px" }}>
                    <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.8, marginBottom: "4px" }}>
                        {t(language, "Caption")}
                    </div>
                    <TextField
                        value={caption}
                        disabled={saving}
                        onChange={(e: { target: { value: string } }) => setCaption(e.target.value.slice(0, CAPTION_MAX_LEN))}
                    />
                </div>

                <div style={{ marginBottom: "10px" }}>
                    <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.8, marginBottom: "4px" }}>
                        {t(language, "Tag")}
                    </div>
                    <TextField
                        value={tag}
                        disabled={saving}
                        onChange={(e: { target: { value: string } }) => setTag(cleanTagInput(e.target.value, TAG_MAX_LEN))}
                    />
                    <Focusable
                        flow-children="grid"
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            gap: "8px",
                            flexWrap: "wrap",
                            alignItems: "center",
                            marginTop: "12px"
                        }}
                    >
                        {suggestions.map((entry) => (
                            <div key={entry.key} data-focus-key={`memories:tagsugg:${entry.key}`}>
                                <DialogButton
                                    disabled={saving}
                                    onClick={() => setTag(entry.tag)}
                                    style={compactButtonStyle}
                                >
                                    {entry.label}
                                </DialogButton>
                            </div>
                        ))}
                        {tag ? (
                            <div data-focus-key="memories:tagsugg:clear">
                                <DialogButton
                                    disabled={saving}
                                    onClick={() => setTag("")}
                                    style={compactButtonStyle}
                                >
                                    {t(language, "Clear tag")}
                                </DialogButton>
                            </div>
                        ) : null}
                        <div data-focus-key="memories:tagsugg:more">
                            <DialogButton
                                disabled={saving}
                                onClick={openTagPicker}
                                style={{ ...compactButtonStyle, fontWeight: 800 }}
                            >
                                {"\u00bb"}
                            </DialogButton>
                        </div>
                    </Focusable>
                </div>

                <div style={{ marginBottom: "10px" }}>
                    <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.8, marginBottom: "4px" }}>
                        {t(language, "Color Tag")}
                    </div>
                    <NoteColorPicker selectedColor={color} disabled={saving} onChange={setColor} />
                </div>

                {error ? <ErrorText>{error}</ErrorText> : null}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
                    <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
                        <DialogButton disabled={saving} onClick={() => void save()}>
                            {t(language, "Save")}
                        </DialogButton>
                        <DialogButton disabled={saving} onClick={close}>
                            {t(language, "Cancel")}
                        </DialogButton>
                    </Focusable>
                </div>
            </SaveOnStart>
        </ModalRoot>
    );
}
