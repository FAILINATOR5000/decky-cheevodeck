import type { LanguageCode } from "../locales";
import type { GameNote, GameNoteSortMode } from "../types";
import { parseNoteTag } from "./achievements";

export type NoteSection = {
    tag: string | null;
    tagKey: string | null;
    orderedNotes: GameNote[];
    isCompleted?: boolean;
};

const NOTES_UNTAGGED_COLLAPSE_KEY = "__UNTAGGED__";
const NOTES_COMPLETED_COLLAPSE_KEY = "__COMPLETED__";

export function noteSectionCollapseKey(section: NoteSection): string {
    if (section.isCompleted) {
        return NOTES_COMPLETED_COLLAPSE_KEY;
    }
    return section.tagKey ?? NOTES_UNTAGGED_COLLAPSE_KEY;
}

export function buildNoteSections(
    notes: GameNote[],
    sortMode: GameNoteSortMode,
    language: LanguageCode
): NoteSection[] {
    const byKey = new Map<string, NoteSection>();
    const untagged: NoteSection = {
        tag: null,
        tagKey: null,
        orderedNotes: []
    };
    const completed: NoteSection = {
        tag: null,
        tagKey: null,
        orderedNotes: [],
        isCompleted: true
    };

    for (const note of notes) {
        if (note.completedAt !== null) {
            completed.orderedNotes.push(note);
            continue;
        }
        const parsed = parseNoteTag(note.body);
        if (parsed.tagKey === null) {
            untagged.orderedNotes.push(note);
            continue;
        }
        let section = byKey.get(parsed.tagKey);
        if (!section) {
            section = {
                tag: parsed.tag,
                tagKey: parsed.tagKey,
                orderedNotes: []
            };
            byKey.set(parsed.tagKey, section);
        }
        section.orderedNotes.push(note);
    }

    function sortWithin(list: GameNote[]) {
        if (sortMode === "manual") {
            list.sort((a, b) => a.manualOrder - b.manualOrder);
            return;
        }
        if (sortMode === "oldest") {
            list.sort((a, b) => a.createdAt - b.createdAt);
            return;
        }
        list.sort((a, b) => b.createdAt - a.createdAt);
    }

    sortWithin(untagged.orderedNotes);
    for (const section of byKey.values()) {
        sortWithin(section.orderedNotes);
    }
    completed.orderedNotes.sort((a, b) => {
        const aAt = a.completedAt ?? 0;
        const bAt = b.completedAt ?? 0;
        return bAt - aAt;
    });

    const taggedSections = Array.from(byKey.values()).filter(
        (s) => s.orderedNotes.length > 0
    );
    taggedSections.sort((a, b) =>
        (a.tag ?? "").localeCompare(b.tag ?? "", language, { numeric: true })
    );

    const ordered: NoteSection[] = taggedSections;
    if (untagged.orderedNotes.length > 0) {
        ordered.push(untagged);
    }
    if (completed.orderedNotes.length > 0) {
        ordered.push(completed);
    }
    return ordered;
}

export function noteRemovalLanding(
    notes: GameNote[],
    sortMode: GameNoteSortMode,
    language: LanguageCode,
    collapsedKeys: ReadonlySet<string>,
    removedNoteId: string
): string | null {
    const sections = buildNoteSections(notes, sortMode, language);

    let removedFrom: { collapseKey: string; size: number } | null = null;
    for (const section of sections) {
        if (section.orderedNotes.some((note) => note.id === removedNoteId)) {
            removedFrom = {
                collapseKey: noteSectionCollapseKey(section),
                size: section.orderedNotes.length
            };
            break;
        }
    }

    const completedIsCandidate = removedFrom !== null
        && removedFrom.collapseKey === NOTES_COMPLETED_COLLAPSE_KEY;

    const visible: { id: string; collapseKey: string }[] = [];
    for (const section of sections) {
        const collapseKey = noteSectionCollapseKey(section);
        if (collapsedKeys.has(collapseKey)) {
            continue;
        }
        if (!completedIsCandidate && collapseKey === NOTES_COMPLETED_COLLAPSE_KEY) {
            continue;
        }
        for (const note of section.orderedNotes) {
            visible.push({ id: note.id, collapseKey });
        }
    }

    const removedIndex = visible.findIndex((row) => row.id === removedNoteId);
    const remaining = visible.filter((row) => row.id !== removedNoteId);
    if (remaining.length === 0) {
        return null;
    }

    const safeIndex = removedIndex >= 0 ? Math.min(removedIndex, remaining.length - 1) : 0;
    const wouldLeaveTheSection = safeIndex > 0
        && removedFrom !== null
        && removedFrom.size > 1
        && remaining[safeIndex] !== undefined
        && remaining[safeIndex].collapseKey !== removedFrom.collapseKey;
    const landingIndex = wouldLeaveTheSection ? safeIndex - 1 : safeIndex;

    return remaining[landingIndex].id;
}
