import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useState } from "react";
import { getRecentTagsForGame, saveDefaultNoteColor } from "../../api";
import { ErrorText } from "../ui/ErrorText";
import { NoteColorPicker } from "./NoteColorPicker";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type { AchievementRow, NoteColor, OkResult } from "../../types";
import { parseNoteTag, prefixNoteTag, resolveNoteTag, TAG_MAX_LEN, TRACKED_NOTE_MAX_LEN } from "../../utils/achievements";
import { TagPickerModal } from "../tags/TagPickerModal";
import { showManagedModal } from "../../utils/modalRegistry";
import { TRACKED_TAG_SEEDS, cleanTagInput } from "../../utils/tags";
import { logError } from "../../utils/errors";
import { modalSize } from "../../utils/scale";
import { achievementGreen, errorRed, compactButtonStyle } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";


const SUGGESTION_COUNT = 10;

export type SaveTrackedNoteFn = (
    achievementId: number,
    note: string,
    color: NoteColor
) => Promise<OkResult>;

export type NoteEditModalProps = {
    gameId: number | null;
    achievement: AchievementRow;
    currentNote: string;
    currentColor: NoteColor | null;
    saveNote: SaveTrackedNoteFn;
    close: () => void;
    language: LanguageCode;
    defaultNoteColor: NoteColor;
    setDefaultNoteColor: (color: NoteColor) => void;
};

export function NoteEditModal(props: NoteEditModalProps) {
    const {
        gameId,
        achievement,
        currentNote,
        currentColor,
        saveNote,
        close,
        language,
        defaultNoteColor,
        setDefaultNoteColor
    } = props;

    const stored = parseNoteTag(currentNote);

    const [noteText, setNoteText] = useState(stored.body);
    const [tagText, setTagText] = useState(stored.tag ?? "");
    const [savingNote, setSavingNote] = useState(false);
    const [noteError, setNoteError] = useState<string | null>(null);
    const [recentTags, setRecentTags] = useState<string[]>([]);
    useEffect(() => {
        if (gameId === null) {
            return;
        }
        let cancelled = false;
        getRecentTagsForGame(gameId)
            .then((result) => {
                if (cancelled) {
                    return;
                }
                setRecentTags(result?.recentTags ?? []);
            })
            .catch((e) => {
                logError("getRecentTagsForGame", e);
            });
        return () => {
            cancelled = true;
        };
    }, [gameId]);
    const initialColor: NoteColor =
        currentColor ?? (currentNote ? "default" : (defaultNoteColor ?? "default"));
    const [selectedColor, setSelectedColor] = useState<NoteColor>(initialColor);

    const resolved = resolveNoteTag(tagText, noteText, stored.body);
    const effectiveTag = resolved.tag;
    const composedNote = prefixNoteTag(resolved.body, effectiveTag);

    const noteBudget = effectiveTag === null
        ? TRACKED_NOTE_MAX_LEN
        : TRACKED_NOTE_MAX_LEN - (effectiveTag.length + 2);

    const trimmedLength = resolved.body.length;
    const overLimit = composedNote.length > TRACKED_NOTE_MAX_LEN;

    async function handleSave() {
        if (savingNote || overLimit) {
            return;
        }
        setSavingNote(true);
        setNoteError(null);
        const result = await saveNote(
            achievement.id,
            prefixNoteTag(resolved.body.trim(), effectiveTag),
            selectedColor
        );
        if (result.ok) {
            if (selectedColor !== defaultNoteColor) {
                setDefaultNoteColor(selectedColor);
                void saveDefaultNoteColor(selectedColor).catch((e) => {
                    logError("saveDefaultNoteColor", e);
                });
            }
            close();
            return;
        }
        setSavingNote(false);
        setNoteError(result.error ?? t(language, "Couldn't save your note."));
    }

    async function handleDelete() {
        if (savingNote) {
            return;
        }
        setSavingNote(true);
        setNoteError(null);
        const result = await saveNote(achievement.id, "", selectedColor);
        if (result.ok) {
            close();
            return;
        }
        setSavingNote(false);
        setNoteError(result.error ?? t(language, "Couldn't save your note."));
    }

    const counterText = t(language, "{{count}} / {{max}} characters", {
        count: trimmedLength,
        max: noteBudget
    });

    const seenSuggestionKeys = new Set<string>();
    const suggestions: Array<{ key: string; label: string; tag: string }> = [];
    for (const tag of recentTags) {
        const trimmed = tag.trim();
        if (!trimmed) {
            continue;
        }
        const lower = trimmed.toLowerCase();
        if (seenSuggestionKeys.has(lower)) {
            continue;
        }
        seenSuggestionKeys.add(lower);
        suggestions.push({ key: `recent:${lower}`, label: trimmed, tag: trimmed });
        if (suggestions.length >= SUGGESTION_COUNT) {
            break;
        }
    }
    for (const seed of TRACKED_TAG_SEEDS) {
        if (suggestions.length >= SUGGESTION_COUNT) {
            break;
        }
        const lower = seed.tag.toLowerCase();
        if (seenSuggestionKeys.has(lower)) {
            continue;
        }
        seenSuggestionKeys.add(lower);
        suggestions.push({ key: `seed:${lower}`, label: t(language, seed.key), tag: seed.tag });
    }

    function liftTypedTag() {
        if (savingNote) {
            return;
        }
        if (resolved.body === noteText) {
            return;
        }
        setTagText(resolved.tag ?? "");
        setNoteText(resolved.body);
    }

    function applyTag(tag: string | null) {
        if (savingNote) {
            return;
        }
        setTagText(tag === null ? "" : cleanTagInput(tag, TAG_MAX_LEN));
        setNoteText(resolved.body);
    }

    function openTagPicker() {
        if (savingNote) {
            return;
        }
        showManagedModal((closePicker) => (
            <TagPickerModal
                tags={recentTags}
                seeds={TRACKED_TAG_SEEDS}
                selected={effectiveTag ?? ""}
                language={language}
                focusPrefix="tracked"
                onSelect={applyTag}
                close={closePicker}
            />
        ));
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={!savingNote && !overLimit}
                label={t(language, "Save")}
                onSave={handleSave}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {(() => {
                        const TOKEN = "__NOTE_MODAL_TITLE__";
                        const rendered = t(language, "Edit note for {{title}}", { title: TOKEN });
                        const parts = rendered.split(TOKEN);
                        return parts.map((piece, index) => {
                            if (index === parts.length - 1) {
                                return <span key={index}>{piece}</span>;
                            }
                            return (
                                <span key={index}>
                                    {piece}
                                    <span style={{ color: achievementGreen, fontWeight: 800 }}>
                                        “{achievement.title}”
                                    </span>
                                </span>
                            );
                        });
                    })()}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div
                            style={{
                                fontSize: `${modalSize(13)}px`,
                                fontWeight: 700,
                                opacity: 0.7
                            }}
                        >
                            {t(language, "Note:")}
                        </div>
                        <div onBlurCapture={liftTypedTag}>
                            <TextField
                                value={noteText}
                                onChange={(e: any) => setNoteText(e?.target?.value ?? "")}
                                disabled={savingNote}
                            />
                        </div>
                        <div
                            style={{
                                fontSize: `${modalSize(13)}px`,
                                opacity: 0.7,
                                color: overLimit ? errorRed : undefined,
                                textAlign: "right"
                            }}
                        >
                            {counterText}
                        </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div
                            style={{
                                fontSize: `${modalSize(13)}px`,
                                fontWeight: 700,
                                opacity: 0.7
                            }}
                        >
                            {t(language, "Tag:")}
                        </div>
                        <TextField
                            value={tagText}
                            onChange={(e: any) => setTagText(cleanTagInput(e?.target?.value ?? "", TAG_MAX_LEN))}
                            disabled={savingNote}
                        />
                        <Focusable
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                gap: "8px",
                                flexWrap: "wrap",
                                alignItems: "center"
                            }}
                            flow-children="grid"
                        >
                            {suggestions.map((entry) => (
                                <div key={entry.key} data-focus-key={`tagsugg:${entry.key}`}>
                                    <DialogButton
                                        onClick={() => applyTag(entry.tag)}
                                        disabled={savingNote}
                                        style={compactButtonStyle}
                                    >
                                        {entry.label}
                                    </DialogButton>
                                </div>
                            ))}
                            {effectiveTag !== null && (
                                <div data-focus-key="tagsugg:clear">
                                    <DialogButton
                                        onClick={() => applyTag(null)}
                                        disabled={savingNote}
                                        style={{ ...compactButtonStyle, opacity: 0.75 }}
                                    >
                                        {t(language, "Clear tag")}
                                    </DialogButton>
                                </div>
                            )}
                            <div data-focus-key="tagsugg:more">
                                <DialogButton
                                    onClick={openTagPicker}
                                    disabled={savingNote}
                                    style={{ ...compactButtonStyle, fontWeight: 800 }}
                                >
                                    {"\u00bb"}
                                </DialogButton>
                            </div>
                        </Focusable>
                        <div
                            style={{
                                fontSize: `${modalSize(13)}px`,
                                opacity: 0.7
                            }}
                        >
                            {t(language, "Tip: start your note with [Category] to group it on the Tracked page — tap a suggestion above, or type your own. The note text itself is optional; a tag on its own works too.")}
                        </div>
                    </div>
                    <div
                        style={{
                            fontSize: `${modalSize(13)}px`,
                            fontWeight: 700,
                            opacity: 0.7,
                            marginBottom: "4px"
                        }}
                    >
                        {t(language, "Note Color:")}
                    </div>
                    <NoteColorPicker
                        selectedColor={selectedColor}
                        disabled={savingNote}
                        onChange={setSelectedColor}
                    />
                    {noteError && (
                        <ErrorText>
                            {localizeRuntimeText(language, noteError)}
                        </ErrorText>
                    )}
                </div>
                <Focusable
                    style={{
                        display: "flex",
                        justifyContent: "flex-start",
                        gap: "8px",
                        marginTop: "16px"
                    }}
                    flow-children="row"
                >
                    <DialogButton onClick={handleSave} disabled={savingNote || overLimit}>
                        {savingNote ? t(language, "Saving...") : t(language, "Save")}
                    </DialogButton>
                    {currentNote.length > 0 && (
                        <DialogButton onClick={handleDelete} disabled={savingNote}>
                            {t(language, "Delete")}
                        </DialogButton>
                    )}
                    <DialogButton onClick={close} disabled={savingNote}>
                        {t(language, "Cancel")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}
