import { t, type LanguageCode } from "../locales";
import type { DataKind, DataTransferResult } from "../types";

type PartKind = "tracked" | "notes" | "guides" | "events";

const ADDED: Record<PartKind, string> = {
    tracked: "Added {{count}} tracked achievements.",
    notes: "Added {{count}} notes.",
    guides: "Added {{count}} bookmarks.",
    events: "Added {{count}} tracked events."
};

const UPDATED: Record<PartKind, string> = {
    tracked: "Updated {{count}} tracked achievements.",
    notes: "Updated {{count}} notes.",
    guides: "Updated {{count}} bookmarks.",
    events: "Updated {{count}} tracked events."
};

const REPLACED: Record<PartKind, string> = {
    tracked: "Replaced with {{count}} tracked achievements.",
    notes: "Replaced with {{count}} notes.",
    guides: "Replaced with {{count}} bookmarks.",
    events: "Replaced with {{count}} tracked events."
};

const ALL_PARTS: PartKind[] = ["tracked", "notes", "guides"];

function partLines(language: LanguageCode, kind: PartKind, replace: boolean, result: DataTransferResult) {
    const added = result.added ?? 0;
    const updated = result.updated ?? 0;
    const lines: string[] = [];
    if (replace) {
        lines.push(t(language, REPLACED[kind], { count: added }));
    }
    else {
        if (added > 0) {
            lines.push(t(language, ADDED[kind], { count: added }));
        }
        if (updated > 0) {
            lines.push(t(language, UPDATED[kind], { count: updated }));
        }
    }
    const changed = lines.length > 0;
    if (kind === "tracked" && (result.skippedUnlocked ?? 0) > 0) {
        lines.push(t(language, "{{count}} were already unlocked here.", { count: result.skippedUnlocked ?? 0 }));
    }
    return { lines, changed };
}

export function importResultLines(language: LanguageCode, kind: DataKind, replace: boolean, result: DataTransferResult): string[] {
    if (kind === "milestones") {
        return [];
    }
    const parts = kind === "all"
        ? ALL_PARTS.filter((part) => result.parts?.[part]).map((part) => partLines(language, part, replace, result.parts![part]!))
        : [partLines(language, kind, replace, result)];
    const lines = parts.flatMap((part) => part.lines);
    return parts.some((part) => part.changed) ? lines : [t(language, "Nothing new to add."), ...lines];
}
