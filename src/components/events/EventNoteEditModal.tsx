import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";
import { saveDefaultNoteColor } from "../../api";
import { NoteColorPicker } from "../notes/NoteColorPicker";
import { TagPickerModal } from "../tags/TagPickerModal";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import type { NoteColor } from "../../types";
import { NOTE_TEXT_MAX_LEN, TAG_MAX_LEN, isReservedTag, parseNoteTag, prefixNoteTag, resolveNoteTag, revealLeadingTag } from "../../utils/achievements";
import { showManagedModal } from "../../utils/modalRegistry";
import { playOkSound } from "../../utils/navSound";
import { cleanTagInput, cleanTextInput } from "../../utils/tags";
import { modalSize } from "../../utils/scale";
import { achievementGreen, compactButtonStyle, errorRed } from "../../utils/style";

const SUGGESTION_COUNT = 10;
const TITLE_TOKEN = "__EVENT_NOTE_TITLE__";

const LABEL_STYLE = {
    fontSize: `${modalSize(13)}px`,
    fontWeight: 700,
    opacity: 0.7
} as const;

export type EventNoteEditModalProps = {
    eventTitle: string;
    note: string;
    color: NoteColor | "";
    allTags: string[];
    completed: boolean | null;
    saveNote: (note: string, color: NoteColor) => Promise<void>;
    setCompleted: (completed: boolean) => Promise<void>;
    close: () => void;
    language: LanguageCode;
    defaultNoteColor: NoteColor;
    setDefaultNoteColor: (color: NoteColor) => void;
};

export function EventNoteEditModal(props: EventNoteEditModalProps) {
    const { language, allTags, close, defaultNoteColor } = props;

    const stored = parseNoteTag(props.note);
    const [bodyText, setBodyText] = useState(stored.body);
    const [tagText, setTagText] = useState(cleanTagInput(stored.tag ?? "", TAG_MAX_LEN));
    const [selectedColor, setSelectedColor] = useState<NoteColor>(props.color || defaultNoteColor || "default");
    const [saving, setSaving] = useState(false);

    const resolved = resolveNoteTag(tagText, bodyText, stored.body);
    const effectiveTag = resolved.tag;
    const composed = prefixNoteTag(resolved.body.trim(), effectiveTag);
    const overLimit = resolved.body.length > NOTE_TEXT_MAX_LEN;

    async function handleSave() {
        if (saving || overLimit) {
            return;
        }
        setSaving(true);
        await props.saveNote(composed, selectedColor);
        if (composed && selectedColor !== defaultNoteColor) {
            props.setDefaultNoteColor(selectedColor);
            void saveDefaultNoteColor(selectedColor).catch(() => {
            });
        }
        close();
    }

    async function handleMark() {
        if (saving || props.completed === null) {
            return;
        }
        playOkSound();
        setSaving(true);
        await props.setCompleted(!props.completed);
        close();
    }

    const suggestions: string[] = [];
    const seen = new Set<string>();
    for (const tag of allTags) {
        const lower = tag.trim().toLowerCase();
        if (!lower || seen.has(lower)) {
            continue;
        }
        seen.add(lower);
        suggestions.push(tag.trim());
        if (suggestions.length >= SUGGESTION_COUNT) {
            break;
        }
    }

    function liftTypedTag() {
        if (saving || resolved.body === bodyText) {
            return;
        }
        setTagText(resolved.lifted ?? tagText);
        setBodyText(resolved.body);
    }

    function applyTag(tag: string | null) {
        if (saving) {
            return;
        }
        if (tag === null) {
            const next = revealLeadingTag(resolved.body);
            setTagText(next.tag);
            setBodyText(next.body);
            return;
        }
        setTagText(cleanTagInput(tag, TAG_MAX_LEN));
        setBodyText(resolved.body);
    }

    function revealTagOnLeave() {
        if (saving || effectiveTag !== null) {
            return;
        }
        const next = revealLeadingTag(resolved.body);
        if (next.tag) {
            setTagText(next.tag);
            setBodyText(next.body);
        }
    }

    function openTagPicker() {
        if (saving) {
            return;
        }
        showManagedModal((closePicker) => (
            <TagPickerModal
                tags={allTags}
                seeds={[]}
                selected={effectiveTag ?? ""}
                language={language}
                focusPrefix="events"
                onSelect={applyTag}
                close={closePicker}
            />
        ));
    }

    const markReady = props.completed !== null && !saving;

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={!saving && !overLimit}
                label={t(language, "Save")}
                onSave={handleSave}
                onOptionsButton={markReady ? handleMark : undefined}
                onOptionsActionDescription={markReady
                    ? (props.completed ? t(language, "Mark Incomplete") : t(language, "Mark Complete"))
                    : undefined}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Edit note/tag for {{title}}", { title: TITLE_TOKEN }).split(TITLE_TOKEN).map((piece, index, parts) => (
                        <span key={index}>
                            {piece}
                            {index < parts.length - 1 && (
                                <span style={{ color: achievementGreen, fontWeight: 800 }}>“{props.eventTitle}”</span>
                            )}
                        </span>
                    ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={LABEL_STYLE}>{t(language, "Note:")}</div>
                        <div onBlurCapture={liftTypedTag}>
                            <TextField
                                value={bodyText}
                                onChange={(e: any) => setBodyText(cleanTextInput(e?.target?.value ?? ""))}
                                disabled={saving}
                            />
                        </div>
                        <div
                            style={{
                                fontSize: `${modalSize(13)}px`,
                                lineHeight: 1,
                                opacity: 0.7,
                                color: overLimit ? errorRed : undefined,
                                textAlign: "right"
                            }}
                        >
                            {t(language, "{{count}} / {{max}} characters", { count: resolved.body.length, max: NOTE_TEXT_MAX_LEN })}
                        </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={LABEL_STYLE}>{t(language, "Tag:")}</div>
                        <div onBlurCapture={revealTagOnLeave}>
                            <TextField
                                value={tagText}
                                onChange={(e: any) => setTagText(cleanTagInput(e?.target?.value ?? "", TAG_MAX_LEN))}
                                disabled={saving}
                            />
                        </div>
                        {isReservedTag(tagText) && (
                            <div style={{ fontSize: `${modalSize(13)}px`, color: errorRed }}>
                                {t(language, "tag_reserved_hint_events")}
                            </div>
                        )}
                        <Focusable
                            style={{ display: "flex", flexDirection: "row", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
                            flow-children="grid"
                        >
                            {suggestions.map((tag) => (
                                <div key={tag.toLowerCase()} data-focus-key={`events:tagsugg:${tag.toLowerCase()}`}>
                                    <DialogButton onClick={() => applyTag(tag)} disabled={saving} style={compactButtonStyle}>
                                        {tag}
                                    </DialogButton>
                                </div>
                            ))}
                            {effectiveTag !== null && (
                                <div data-focus-key="events:tagsugg:clear">
                                    <DialogButton
                                        onClick={() => applyTag(null)}
                                        disabled={saving}
                                        style={{ ...compactButtonStyle, opacity: 0.75 }}
                                    >
                                        {t(language, "Clear tag")}
                                    </DialogButton>
                                </div>
                            )}
                            <div data-focus-key="events:tagsugg:more">
                                <DialogButton
                                    onClick={openTagPicker}
                                    disabled={saving}
                                    style={{ ...compactButtonStyle, fontWeight: 800 }}
                                >
                                    {"»"}
                                </DialogButton>
                            </div>
                        </Focusable>
                        <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.7 }}>
                            {t(language, "Tip: a tag files the event under its own heading in your tracked events.")}
                        </div>
                    </div>
                    <div style={{ ...LABEL_STYLE, marginBottom: "4px" }}>{t(language, "Note Color:")}</div>
                    <NoteColorPicker selectedColor={selectedColor} disabled={saving} onChange={setSelectedColor} />
                </div>
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-start", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}
                    flow-children="grid"
                >
                    <DialogButton onClick={handleSave} disabled={saving || overLimit}>
                        {saving ? t(language, "Saving...") : t(language, "Save")}
                    </DialogButton>
                    {props.completed !== null && (
                        <DialogButton onClick={handleMark} disabled={saving}>
                            {props.completed ? t(language, "Mark Incomplete") : t(language, "Mark Complete")}
                        </DialogButton>
                    )}
                    <DialogButton onClick={close} disabled={saving}>
                        {t(language, "Cancel")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}
