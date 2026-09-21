import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";
import { saveDefaultNoteColor } from "../../api";
import { ErrorText } from "../ui/ErrorText";
import { NoteColorPicker } from "./NoteColorPicker";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type { GameNote, GameNoteReminderMode, NoteColor, OkResult } from "../../types";
import { TAG_MAX_LEN, parseNoteTag, prefixNoteTag, resolveNoteTag } from "../../utils/achievements";
import { TagPickerModal } from "../tags/TagPickerModal";
import { showManagedModal } from "../../utils/modalRegistry";
import { GAME_NOTE_TAG_SEEDS, cleanTagInput } from "../../utils/tags";
import { modalSize } from "../../utils/scale";
import { achievementGreen, errorRed, compactButtonStyle } from "../../utils/style";
import { REMINDER_PRESETS, matchingPreset, parseCustomMinutes, type ReminderUnit, type ReminderPreset } from "../../utils/reminders";
import { playOkSound } from "../../utils/navSound";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const GAME_NOTE_TITLE_MAX_LEN = 80;
const GAME_NOTE_BODY_MAX_LEN = 500;

const DELETE_ARMED_CSS = `
.cheevo-note-delete-armed.DialogContent, .cheevo-note-delete-armed {
    box-shadow: inset 0 0 0 2px ${errorRed};
}`;

const SUGGESTION_COUNT = 10;

function sanitizeCustomMinutesDraft(raw: string): string {
    let dotSeen = false;
    let out = "";
    for (const ch of raw) {
        if (ch >= "0" && ch <= "9") {
            out += ch;
            continue;
        }
        if (ch === "." && !dotSeen) {
            dotSeen = true;
            out += ch;
        }
    }
    return out;
}

type SaveGameNoteFn = (input: {
    title: string;
    body: string;
    tag: string | null;
    color: NoteColor;
    reminderMode: GameNoteReminderMode;
    reminderEveryMinutes: number | null;
    reminderEveryValue: number | null;
    reminderEveryUnit: "minutes" | "hours" | "days" | null;
    resetReminderTimer: boolean;
}) => Promise<OkResult>;

type DeleteGameNoteFn = () => Promise<OkResult>;

type ToggleCompletedFn = (completed: boolean) => Promise<OkResult>;

export type GameNoteEditModalProps = {
    existing: GameNote | null;
    allTags: string[];
    saveNote: SaveGameNoteFn;
    deleteNote: DeleteGameNoteFn | null;
    toggleCompleted: ToggleCompletedFn | null;
    close: () => void;
    language: LanguageCode;
    defaultNoteColor: NoteColor;
    setDefaultNoteColor: (color: NoteColor) => void;
};

export function GameNoteEditModal(props: GameNoteEditModalProps) {
    const {
        existing,
        allTags,
        saveNote,
        deleteNote,
        toggleCompleted,
        close,
        language,
        defaultNoteColor,
        setDefaultNoteColor
    } = props;

    const stored = parseNoteTag(existing?.body ?? "");

    const [titleText, setTitleText] = useState(existing?.title ?? "");
    const [bodyText, setBodyText] = useState(stored.body);
    const [tagText, setTagText] = useState(stored.tag ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [deleteArmed, setDeleteArmed] = useState(false);

    const initialColor: NoteColor =
        existing?.color ?? (defaultNoteColor ?? "default");
    const [selectedColor, setSelectedColor] = useState<NoteColor>(initialColor);

    const initialMode: GameNoteReminderMode = existing?.reminderMode ?? "off";

    const initialUnit: ReminderUnit = existing?.reminderEveryUnit ?? "minutes";
    const initialValue = existing?.reminderEveryValue ?? null;
    const initialCustomExpanded =
        initialValue !== null && matchingPreset(initialValue, initialUnit) === null;

    const [reminderMode, setReminderMode] = useState<GameNoteReminderMode>(initialMode);
    const [cadenceDraft, setCadenceDraft] = useState<string>(
        initialValue !== null ? String(initialValue) : ""
    );
    const [cadenceUnit, setCadenceUnit] = useState<ReminderUnit>(initialUnit);
    const [customExpanded, setCustomExpanded] = useState<boolean>(initialCustomExpanded);

    const [resetReminderTimer, setResetReminderTimer] = useState(false);

    const resolved = resolveNoteTag(tagText, bodyText, stored.body);
    const effectiveTag = resolved.tag;
    const composedBody = prefixNoteTag(resolved.body, effectiveTag);

    const bodyBudget = effectiveTag === null
        ? GAME_NOTE_BODY_MAX_LEN
        : GAME_NOTE_BODY_MAX_LEN - (effectiveTag.length + 2);

    const titleLength = titleText.length;
    const bodyLength = resolved.body.length;
    const titleOverLimit = titleLength > GAME_NOTE_TITLE_MAX_LEN;
    const bodyOverLimit = composedBody.length > GAME_NOTE_BODY_MAX_LEN;
    const bodyEmpty = composedBody.trim().length === 0;

    const cadenceMinutesIfValid = parseCustomMinutes(cadenceDraft, cadenceUnit);
    const cadenceInvalid =
        reminderMode !== "off"
        && cadenceMinutesIfValid === null;

    const showResetRow =
        existing !== null
        && existing.reminderMode !== "off"
        && reminderMode !== "off";

    const isCompleted = existing !== null && existing.completedAt !== null;
    const canDelete = existing !== null && deleteNote !== null;
    const canMarkCompleted = existing !== null && toggleCompleted !== null;
    const reminderControlsDisabled = saving || isCompleted;

    async function handleSave() {
        if (saving || bodyOverLimit || titleOverLimit || bodyEmpty || cadenceInvalid) {
            return;
        }
        setSaving(true);
        setError(null);

        let effectiveMinutes: number | null = null;
        let effectiveValue: number | null = null;
        let effectiveUnit: ReminderUnit | null = null;
        if (reminderMode !== "off") {
            const parsed = parseCustomMinutes(cadenceDraft, cadenceUnit);
            if (parsed === null) {
                setSaving(false);
                setError(t(language, "Enter a reminder time between 1 minute and 365 days."));
                return;
            }
            effectiveMinutes = parsed;
            effectiveValue = Number(cadenceDraft.trim());
            effectiveUnit = cadenceUnit;
        }

        const trimmedTitle = titleText.trim();
        const trimmedBody = prefixNoteTag(resolved.body.trim(), effectiveTag);

        const result = await saveNote({
            title: trimmedTitle,
            body: trimmedBody,
            tag: effectiveTag,
            color: selectedColor,
            reminderMode: reminderMode,
            reminderEveryMinutes: effectiveMinutes,
            reminderEveryValue: effectiveValue,
            reminderEveryUnit: effectiveUnit,
            resetReminderTimer
        });

        if (result.ok) {
            if (selectedColor !== defaultNoteColor) {
                setDefaultNoteColor(selectedColor);
                void saveDefaultNoteColor(selectedColor).catch(() => {
                });
            }
            close();
            return;
        }

        setSaving(false);
        setError(result.error ?? t(language, "Couldn't save your note."));
    }

    async function handleDelete() {
        if (saving || !deleteNote) {
            return;
        }
        setSaving(true);
        setError(null);
        const result = await deleteNote();
        if (result.ok) {
            close();
            return;
        }
        setSaving(false);
        setError(result.error ?? t(language, "Couldn't delete your note."));
    }

    async function handleToggleCompletedClick() {
        if (saving || !toggleCompleted) {
            return;
        }
        setSaving(true);
        setError(null);
        const result = await toggleCompleted(!isCompleted);
        if (result.ok) {
            close();
            return;
        }
        setSaving(false);
        setError(result.error ?? t(language, "Couldn't update your note."));
    }

    const deleteReady = canDelete && !saving;
    const markReady = canMarkCompleted && !saving;
    const deleteArmedNow = deleteArmed && !saving;

    function handleDeletePress() {
        playOkSound();
        if (!deleteArmedNow) {
            setDeleteArmed(true);
            return;
        }
        setDeleteArmed(false);
        void handleDelete();
    }

    function handleMarkPress() {
        playOkSound();
        setDeleteArmed(false);
        void handleToggleCompletedClick();
    }

    function handleCycleReminderMode() {
        if (saving) {
            return;
        }
        setReminderMode((current) => {
            if (current === "off") {
                return "once";
            }
            if (current === "once") {
                return "every";
            }
            return "off";
        });
    }

    function handlePickPreset(preset: ReminderPreset) {
        if (saving) {
            return;
        }
        setCadenceDraft(String(preset.value));
        setCadenceUnit(preset.unit);
        setCustomExpanded(false);
    }

    function handleToggleCustom() {
        if (saving) {
            return;
        }
        setCustomExpanded((current) => !current);
    }

    function handleToggleCadenceUnit() {
        if (saving) {
            return;
        }
        setCadenceUnit((current) => {
            if (current === "minutes") {
                return "hours";
            }
            if (current === "hours") {
                return "days";
            }
            return "minutes";
        });
    }

    function handleToggleResetTimer() {
        if (saving) {
            return;
        }
        setResetReminderTimer((current) => !current);
    }

    const titleCounterText = t(language, "{{count}} / {{max}} characters", {
        count: titleLength,
        max: GAME_NOTE_TITLE_MAX_LEN
    });
    const bodyCounterText = t(language, "{{count}} / {{max}} characters", {
        count: bodyLength,
        max: bodyBudget
    });

    const seenSuggestionKeys = new Set<string>();
    const suggestions: Array<{ key: string; label: string; tag: string }> = [];
    for (const tag of allTags) {
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
    for (const seed of GAME_NOTE_TAG_SEEDS) {
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
        if (saving) {
            return;
        }
        if (resolved.body === bodyText) {
            return;
        }
        setTagText(resolved.tag ?? "");
        setBodyText(resolved.body);
    }

    function applyTag(tag: string | null) {
        if (saving) {
            return;
        }
        setTagText(tag === null ? "" : cleanTagInput(tag, TAG_MAX_LEN));
        setBodyText(resolved.body);
    }

    function openTagPicker() {
        if (saving) {
            return;
        }
        showManagedModal((closePicker) => (
            <TagPickerModal
                tags={allTags}
                seeds={GAME_NOTE_TAG_SEEDS}
                selected={effectiveTag ?? ""}
                language={language}
                focusPrefix="gn"
                onSelect={applyTag}
                close={closePicker}
            />
        ));
    }

    const modalTitle = existing === null
        ? t(language, "New Note")
        : t(language, "Edit Note");

    return (
        <ModalRoot
            onCancel={close}
            onEscKeypress={close}
            className={deleteArmedNow ? "cheevo-note-delete-armed" : undefined}
        >
            <style>{DELETE_ARMED_CSS}</style>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={!saving && !bodyOverLimit && !titleOverLimit && !bodyEmpty && !cadenceInvalid}
                label={t(language, "Save")}
                onSave={handleSave}
                onSecondaryButton={deleteReady ? handleDeletePress : undefined}
                onSecondaryActionDescription={deleteReady
                    ? (deleteArmedNow
                        ? t(language, "gn_footer_delete_armed")
                        : t(language, "gn_footer_delete"))
                    : undefined}
                onOptionsButton={markReady ? handleMarkPress : undefined}
                onOptionsActionDescription={markReady
                    ? (isCompleted
                        ? t(language, "gn_footer_active")
                        : t(language, "gn_footer_completed"))
                    : undefined}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {modalTitle}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div
                                style={{
                                    fontSize: `${modalSize(13)}px`,
                                    fontWeight: 700,
                                    opacity: 0.7
                                }}
                            >
                                {t(language, "Title (optional):")}
                            </div>
                            <TextField
                                value={titleText}
                                onChange={(e: any) => setTitleText(e?.target?.value ?? "")}
                                disabled={saving}
                            />
                            <div
                                style={{
                                    fontSize: `${modalSize(13)}px`,
                                    lineHeight: 1,
                                    opacity: 0.7,
                                    color: titleOverLimit ? errorRed : undefined,
                                    textAlign: "right"
                                }}
                            >
                                {titleCounterText}
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
                                {t(language, "Note:")}
                            </div>
                            <div onBlurCapture={liftTypedTag}>
                                <TextField
                                    value={bodyText}
                                    onChange={(e: any) => setBodyText(e?.target?.value ?? "")}
                                    disabled={saving}
                                />
                            </div>
                            <div
                                style={{
                                    fontSize: `${modalSize(13)}px`,
                                    lineHeight: 1,
                                    opacity: 0.7,
                                    color: bodyOverLimit ? errorRed : undefined,
                                    textAlign: "right"
                                }}
                            >
                                {bodyCounterText}
                            </div>
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
                            disabled={saving}
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
                                <div key={entry.key} data-focus-key={`gn:tagsugg:${entry.key}`}>
                                    <DialogButton
                                        onClick={() => applyTag(entry.tag)}
                                        disabled={saving}
                                        style={compactButtonStyle}
                                    >
                                        {entry.label}
                                    </DialogButton>
                                </div>
                            ))}
                            {effectiveTag !== null && (
                                <div data-focus-key="gn:tagsugg:clear">
                                    <DialogButton
                                        onClick={() => applyTag(null)}
                                        disabled={saving}
                                        style={{ ...compactButtonStyle, opacity: 0.75 }}
                                    >
                                        {t(language, "Clear tag")}
                                    </DialogButton>
                                </div>
                            )}
                            <div data-focus-key="gn:tagsugg:more">
                                <DialogButton
                                    onClick={openTagPicker}
                                    disabled={saving}
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
                            {t(language, "Tip: organize your note by category by giving it a tag. Simply enter a tag you'd like to organize it by or select from the recent or recommendation tiles above.")}
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

                    <div
                        style={{
                            fontSize: `${modalSize(13)}px`,
                            fontWeight: 700,
                            opacity: 0.7,
                            marginBottom: "4px"
                        }}
                    >
                        {t(language, "Reminder:")}
                    </div>
                    <Focusable
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            gap: "8px",
                            alignItems: "center"
                        }}
                        flow-children="row"
                    >
                        <div data-focus-key="gn:reminder:mode">
                            <DialogButton
                                onClick={handleCycleReminderMode}
                                disabled={reminderControlsDisabled}
                                style={compactButtonStyle}
                            >
                                {reminderMode === "off"
                                    ? t(language, "Off")
                                    : reminderMode === "once"
                                        ? t(language, "Once")
                                        : t(language, "Every")}
                            </DialogButton>
                        </div>
                    </Focusable>

                    {isCompleted && (
                        <div
                            style={{
                                fontSize: `${modalSize(12)}px`,
                                opacity: 0.7,
                                fontStyle: "italic"
                            }}
                        >
                            {t(language, "Reminders are paused while completed.")}
                        </div>
                    )}

                    {reminderMode !== "off" && (
                        <>
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
                                {REMINDER_PRESETS.map((preset) => {
                                    const activePreset =
                                        customExpanded
                                            ? null
                                            : matchingPreset(
                                                cadenceDraft.trim() === ""
                                                    ? null
                                                    : Number(cadenceDraft.trim()),
                                                cadenceUnit
                                            );
                                    const isActive = activePreset === preset;
                                    return (
                                        <div
                                            key={preset.labelKey}
                                            data-focus-key={`gn:reminder:preset:${preset.labelKey}`}
                                            style={isActive ? { outline: `2px solid ${achievementGreen}`, borderRadius: "4px" } : undefined}
                                        >
                                            <DialogButton
                                                onClick={() => handlePickPreset(preset)}
                                                disabled={reminderControlsDisabled}
                                                style={compactButtonStyle}
                                            >
                                                {t(language, preset.labelKey)}
                                            </DialogButton>
                                        </div>
                                    );
                                })}
                                <div
                                    data-focus-key="gn:reminder:custom"
                                    style={customExpanded ? { outline: `2px solid ${achievementGreen}`, borderRadius: "4px" } : undefined}
                                >
                                    <DialogButton
                                        onClick={handleToggleCustom}
                                        disabled={reminderControlsDisabled}
                                        style={compactButtonStyle}
                                    >
                                        {t(language, "Custom")}
                                    </DialogButton>
                                </div>
                            </Focusable>

                            {customExpanded && (
                                <>
                                    <Focusable
                                        style={{
                                            display: "flex",
                                            flexDirection: "row",
                                            gap: "8px",
                                            alignItems: "center"
                                        }}
                                        flow-children="row"
                                    >
                                        <div
                                            data-focus-key="gn:reminder:custom:value"
                                            style={{ flex: 1, minWidth: 0 }}
                                        >
                                            <TextField
                                                value={cadenceDraft}
                                                onChange={(e: any) =>
                                                    setCadenceDraft(sanitizeCustomMinutesDraft(e?.target?.value ?? ""))
                                                }
                                                disabled={reminderControlsDisabled}
                                            />
                                        </div>
                                        <div data-focus-key="gn:reminder:custom:unit">
                                            <DialogButton
                                                onClick={handleToggleCadenceUnit}
                                                disabled={reminderControlsDisabled}
                                                style={compactButtonStyle}
                                            >
                                                {cadenceUnit === "minutes"
                                                    ? t(language, "min")
                                                    : cadenceUnit === "hours"
                                                        ? t(language, "hours")
                                                        : t(language, "days")}
                                            </DialogButton>
                                        </div>
                                    </Focusable>
                                    {cadenceInvalid && (
                                        <div
                                            style={{
                                                fontSize: `${modalSize(12)}px`,
                                                color: errorRed,
                                                opacity: 0.85
                                            }}
                                        >
                                            {t(language, "Enter a number between 1 minute and 365 days.")}
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {showResetRow && (
                        <Focusable
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                gap: "8px",
                                alignItems: "center"
                            }}
                            flow-children="row"
                        >
                            <div data-focus-key="gn:reminder:reset">
                                <DialogButton
                                    onClick={handleToggleResetTimer}
                                    disabled={reminderControlsDisabled}
                                    style={compactButtonStyle}
                                >
                                    {resetReminderTimer
                                        ? t(language, "Reset timer on save: Yes")
                                        : t(language, "Reset timer on save: No")}
                                </DialogButton>
                            </div>
                        </Focusable>
                    )}

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
                        flexWrap: "wrap",
                        gap: "8px",
                        marginTop: "16px"
                    }}
                    flow-children="grid"
                >
                    <DialogButton
                        onClick={handleSave}
                        disabled={saving || bodyOverLimit || titleOverLimit || bodyEmpty || cadenceInvalid}
                    >
                        {saving ? t(language, "Saving...") : t(language, "Save")}
                    </DialogButton>
                    {existing !== null && deleteNote !== null && (
                        <DialogButton onClick={handleDelete} disabled={saving}>
                            {t(language, "Delete")}
                        </DialogButton>
                    )}
                    {existing !== null && toggleCompleted !== null && (
                        <DialogButton onClick={handleToggleCompletedClick} disabled={saving}>
                            {isCompleted
                                ? t(language, "Mark as Active")
                                : t(language, "Mark as Completed")}
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
