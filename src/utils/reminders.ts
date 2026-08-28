import { t, type LanguageCode } from "../locales";
import type { GameNoteReminderMode } from "../types";

export type ReminderUnit = "minutes" | "hours" | "days";
export type ReminderPreset = {
    value: number;
    unit: ReminderUnit;
    labelKey: string;
};
export const REMINDER_PRESETS: ReadonlyArray<ReminderPreset> = [
    { value: 15, unit: "minutes", labelKey: "reminder_preset_15m" },
    { value: 30, unit: "minutes", labelKey: "reminder_preset_30m" },
    { value: 1, unit: "hours", labelKey: "reminder_preset_1h" },
    { value: 2, unit: "hours", labelKey: "reminder_preset_2h" },
    { value: 4, unit: "hours", labelKey: "reminder_preset_4h" }
];

const REMINDER_MIN_MINUTES = 1;
const REMINDER_MAX_MINUTES = 60 * 24 * 365;

export function matchingPreset(
    value: number | null,
    unit: ReminderUnit
): ReminderPreset | null {
    if (value === null) {
        return null;
    }
    for (const preset of REMINDER_PRESETS) {
        if (preset.value === value && preset.unit === unit) {
            return preset;
        }
    }
    return null;
}

function presetToMinutes(preset: ReminderPreset): number {
    if (preset.unit === "hours") {
        return preset.value * 60;
    }
    if (preset.unit === "days") {
        return preset.value * 60 * 24;
    }
    return preset.value;
}

export function parseCustomMinutes(
    draft: string,
    unit: "minutes" | "hours" | "days"
): number | null {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    let asMinutes: number;
    if (unit === "hours") {
        asMinutes = parsed * 60;
    }
    else if (unit === "days") {
        asMinutes = parsed * 60 * 24;
    }
    else {
        asMinutes = parsed;
    }
    const minutes = Math.floor(asMinutes);
    if (minutes < REMINDER_MIN_MINUTES || minutes > REMINDER_MAX_MINUTES) {
        return null;
    }
    return minutes;
}

function reminderLabelPrefix(
    language: LanguageCode,
    mode: GameNoteReminderMode,
    unit: ReminderUnit
): string {
    if (mode === "once") {
        return t(language, "reminder_prefix_once");
    }
    if (language === "fr" && unit === "days") {
        return "tous les";
    }
    return t(language, "reminder_prefix_every");
}

function composeReminderLabel(
    language: LanguageCode,
    mode: GameNoteReminderMode,
    unit: ReminderUnit,
    label: string
): string {
    if (language === "ja") {
        const suffix = t(language, mode === "once" ? "reminder_prefix_once" : "reminder_prefix_every");
        return `${label}${suffix}`;
    }
    return `${reminderLabelPrefix(language, mode, unit)} ${label}`;
}

export function gameNoteReminderLabel(
    language: LanguageCode,
    mode: GameNoteReminderMode,
    minutes: number | null
): string {
    if (mode === "off" || minutes === null) {
        return t(language, "Off");
    }

    const preset = REMINDER_PRESETS.find(
        (p) => presetToMinutes(p) === minutes
    );
    if (preset) {
        return composeReminderLabel(language, mode, preset.unit, t(language, preset.labelKey));
    }

    const minutesPerDay = 60 * 24;
    if (minutes >= minutesPerDay && minutes % minutesPerDay === 0) {
        const days = Math.floor(minutes / minutesPerDay);
        return composeReminderLabel(language, mode, "days", t(language, "{{count}} d", { count: days }));
    }
    if (minutes >= 60 && minutes % 60 === 0) {
        const hours = Math.floor(minutes / 60);
        return composeReminderLabel(language, mode, "hours", t(language, "{{count}} h", { count: hours }));
    }
    return composeReminderLabel(language, mode, "minutes", t(language, "{{count}} min", { count: minutes }));
}
