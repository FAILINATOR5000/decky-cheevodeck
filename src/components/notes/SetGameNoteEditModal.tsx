import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";
import { saveDefaultNoteColor } from "../../api";
import { ErrorText } from "../ui/ErrorText";
import { NoteColorPicker } from "./NoteColorPicker";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type { NoteColor } from "../../types";
import { modalSize } from "../../utils/scale";
import { achievementGreen, errorRed } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const SET_GAME_NOTE_MAX_LEN = 500;

type SaveSetGameNoteFn = (
    note: string,
    color: NoteColor
) => Promise<boolean>;

export type SetGameNoteEditModalProps = {
    gameTitle: string;
    currentNote: string;
    currentColor: NoteColor | null;
    saveNote: SaveSetGameNoteFn;
    close: () => void;
    language: LanguageCode;
    defaultNoteColor: NoteColor;
    setDefaultNoteColor: (color: NoteColor) => void;
};

export function SetGameNoteEditModal(props: SetGameNoteEditModalProps) {
    const {
        gameTitle,
        currentNote,
        currentColor,
        saveNote,
        close,
        language,
        defaultNoteColor,
        setDefaultNoteColor
    } = props;

    const [noteText, setNoteText] = useState(currentNote);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const initialColor: NoteColor =
        currentColor ?? (currentNote ? "default" : (defaultNoteColor ?? "default"));
    const [selectedColor, setSelectedColor] = useState<NoteColor>(initialColor);

    const noteLength = noteText.length;
    const overLimit = noteLength > SET_GAME_NOTE_MAX_LEN;

    async function persist(note: string) {
        const ok = await saveNote(note, selectedColor);
        if (ok) {
            if (selectedColor !== defaultNoteColor) {
                setDefaultNoteColor(selectedColor);
                void saveDefaultNoteColor(selectedColor).catch(() => {
                });
            }
            close();
            return;
        }
        setSaving(false);
        setError(t(language, "Couldn't save your note."));
    }

    async function handleSave() {
        if (saving || overLimit) {
            return;
        }
        setSaving(true);
        setError(null);
        await persist(noteText.trim());
    }

    async function handleDelete() {
        if (saving) {
            return;
        }
        setSaving(true);
        setError(null);
        await persist("");
    }

    const counterText = t(language, "{{count}} / {{max}} characters", {
        count: noteLength,
        max: SET_GAME_NOTE_MAX_LEN
    });

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={!saving && !overLimit}
                label={t(language, "Save")}
                onSave={handleSave}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {(() => {
                        const TOKEN = "__SET_GAME_NOTE_TITLE__";
                        const rendered = t(language, "Note for {{title}}", { title: TOKEN });
                        const parts = rendered.split(TOKEN);
                        return parts.map((piece, index) => {
                            if (index === parts.length - 1) {
                                return <span key={index}>{piece}</span>;
                            }
                            return (
                                <span key={index}>
                                    {piece}
                                    <span style={{ color: achievementGreen, fontWeight: 800 }}>
                                        “{gameTitle}”
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
                        <TextField
                            value={noteText}
                            onChange={(e: any) => setNoteText(e?.target?.value ?? "")}
                            disabled={saving}
                        />
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
                        disabled={saving}
                        onChange={setSelectedColor}
                    />
                    {error && (
                        <ErrorText>
                            {localizeRuntimeText(language, error)}
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
                    <DialogButton onClick={handleSave} disabled={saving || overLimit}>
                        {saving ? t(language, "Saving...") : t(language, "Save")}
                    </DialogButton>
                    {currentNote.length > 0 && (
                        <DialogButton onClick={handleDelete} disabled={saving}>
                            {t(language, "Delete")}
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
