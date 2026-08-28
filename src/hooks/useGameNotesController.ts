import {
    useCallback,
    useEffect,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import {
    createGameNote,
    deleteGameNote,
    loadGameNotes,
    reorderGameNotes,
    setGameNotesSortMode,
    updateGameNote,
    clearNoteFiredDot,
    markGameNoteCompleted
} from "../api";
import type {
    GameNote,
    GameNoteAButtonMode,
    GameNoteReminderMode,
    GameNoteReminderUnit,
    GameNoteSortMode,
    NoteColor,
    OkResult,
    Payload,
    ReorderDirection
} from "../types";
import { logError } from "../utils/errors";

type UseGameNotesControllerArgs = {
    payload: Payload | null;
    gameNotesGameId?: number | null;
    mountedRef: RefObject<boolean>;
    setError: Dispatch<SetStateAction<string | null>>;
    aButtonMode: GameNoteAButtonMode;
    refreshToken?: number;
};

function replaceNoteInList(notes: GameNote[], updated: GameNote): GameNote[] {
    let found = false;
    const next = notes.map((note) => {
        if (note.id === updated.id) {
            found = true;
            return updated;
        }
        return note;
    });
    if (!found) {
        next.push(updated);
    }
    return next;
}

export function useGameNotesController({
    payload,
    gameNotesGameId,
    mountedRef,
    setError,
    aButtonMode,
    refreshToken
}: UseGameNotesControllerArgs) {
    const targetGameId = gameNotesGameId ?? payload?.gameId ?? null;
    const [notes, setNotes] = useState<GameNote[]>([]);
    const [tagVocabulary, setTagVocabulary] = useState<string[]>([]);
    const [sortMode, setSortMode] = useState<GameNoteSortMode>("newest");
    const [loadedForGameId, setLoadedForGameId] = useState<number | null>(null);
    const [validating, setValidating] = useState(false);
    const [reorderInFlight, setReorderInFlight] = useState(false);
    const [reorderTargetId, setReorderTargetId] = useState<string | null>(null);
    const [reorderViaSwap, setReorderViaSwap] = useState(false);

    useEffect(() => {
        const gameId = targetGameId;
        if (!gameId) {
            setNotes([]);
            setTagVocabulary([]);
            setSortMode("newest");
            setLoadedForGameId(null);
            setReorderTargetId(null);
            return;
        }

        let cancelled = false;
        setValidating(true);
        void (async () => {
            try {
                const response = await loadGameNotes(gameId);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                setNotes(response.notes ?? []);
                setTagVocabulary(response.tagVocabulary ?? []);
                setSortMode(response.sortMode ?? "newest");
                setLoadedForGameId(gameId);
            } catch (e: any) {
                logError("loadGameNotes", e);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                setError(String(e?.message || e || "Couldn't load notes."));
            } finally {
                if (!cancelled && mountedRef.current) {
                    setValidating(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [targetGameId, mountedRef, setError, refreshToken]);

    useEffect(() => {
        if (aButtonMode !== "moveNote") {
            setReorderTargetId(null);
            setReorderViaSwap(false);
        }
    }, [aButtonMode]);

    useEffect(() => {
        if (reorderTargetId === null) {
            return;
        }
        const stillPresent = notes.some((n) => n.id === reorderTargetId);
        if (!stillPresent) {
            setReorderTargetId(null);
            setReorderViaSwap(false);
        }
    }, [reorderTargetId, notes]);

    const onCreateNote = async (input: {
        title: string;
        body: string;
        tag: string | null;
        color: NoteColor;
        reminderMode: GameNoteReminderMode;
        reminderEveryMinutes: number | null;
        reminderEveryValue: number | null;
        reminderEveryUnit: GameNoteReminderUnit | null;
    }) => {
        const gameId = targetGameId;
        if (!gameId) {
            return { ok: false as const, error: "No current game loaded." };
        }

        setError(null);

        let result;
        try {
            result = await createGameNote(
                gameId,
                input.title,
                input.body,
                input.tag,
                input.color,
                input.reminderMode,
                input.reminderEveryMinutes,
                input.reminderEveryValue,
                input.reminderEveryUnit
            );
        } catch (e: any) {
            logError("createGameNote (IPC)", e);
            if (!mountedRef.current) {
                return { ok: true as const };
            }
            const message = String(e?.message || e || "Couldn't save note.");
            setError(message);
            return { ok: false as const, error: message };
        }

        if (!mountedRef.current) {
            return { ok: true as const };
        }

        if (!result || !result.ok || !result.note) {
            const backendError = result?.error
                || (result?.ok ? "Backend returned no note." : "Backend rejected the save.");
            setError(`Couldn't save note: ${backendError}`);
            return { ok: false as const, error: backendError };
        }

        const created = result.note;
        try {
            setNotes((current) => [created, ...current]);
            if (input.tag && !tagVocabulary.includes(input.tag)) {
                const newTag = input.tag;
                setTagVocabulary((current) => [...(current || []), newTag]);
            }
        } catch (e) {
            logError("createGameNote (post-write sync)", e);
        }

        void (async () => {
            try {
                const reloaded = await loadGameNotes(gameId);
                if (!mountedRef.current) {
                    return;
                }
                setNotes(reloaded.notes ?? []);
                setTagVocabulary(reloaded.tagVocabulary ?? []);
            } catch (e) {
                logError("createGameNote (post-create reload)", e);
            }
        })();

        return { ok: true as const, note: created };
    };

    const onUpdateNote = async (
        noteId: string,
        input: {
            title: string;
            body: string;
            tag: string | null;
            color: NoteColor;
            reminderMode: GameNoteReminderMode;
            reminderEveryMinutes: number | null;
            reminderEveryValue: number | null;
            reminderEveryUnit: GameNoteReminderUnit | null;
            resetReminderTimer: boolean;
        }
    ) => {
        const gameId = targetGameId;
        if (!gameId) {
            return { ok: false as const, error: "No current game loaded." };
        }

        setError(null);

        let result;
        try {
            result = await updateGameNote(
                gameId,
                noteId,
                input.title,
                input.body,
                input.tag,
                input.color,
                input.reminderMode,
                input.reminderEveryMinutes,
                input.reminderEveryValue,
                input.reminderEveryUnit,
                input.resetReminderTimer
            );
        } catch (e: any) {
            logError("updateGameNote (IPC)", e);
            if (!mountedRef.current) {
                return { ok: true as const };
            }
            const message = String(e?.message || e || "Couldn't save note.");
            setError(message);
            return { ok: false as const, error: message };
        }

        if (!mountedRef.current) {
            return { ok: true as const };
        }

        if (!result || !result.ok) {
            const backendError = result?.error || "Backend rejected the save.";
            setError(`Couldn't save note: ${backendError}`);
            return { ok: false as const, error: backendError };
        }

        if (result.note) {
            const saved = result.note;
            try {
                setNotes((current) => replaceNoteInList(current, saved));
                if (input.tag && !tagVocabulary.includes(input.tag)) {
                    const newTag = input.tag;
                    setTagVocabulary((current) => [...(current || []), newTag]);
                }
            } catch (e) {
                logError("updateGameNote (post-write sync)", e);
            }
            return { ok: true as const, note: saved };
        }

        setNotes((current) => current.filter((n) => n.id !== noteId));
        return { ok: true as const, deleted: true };
    };

    const onDeleteNote = async (noteId: string) => {
        const gameId = targetGameId;
        if (!gameId) {
            return { ok: false as const, error: "No current game loaded." };
        }

        setError(null);

        let result;
        try {
            result = await deleteGameNote(gameId, noteId);
        } catch (e: any) {
            logError("deleteGameNote (IPC)", e);
            if (!mountedRef.current) {
                return { ok: true as const };
            }
            const message = String(e?.message || e || "Couldn't delete note.");
            setError(message);
            return { ok: false as const, error: message };
        }

        if (!mountedRef.current) {
            return { ok: true as const };
        }

        if (!result || !result.ok) {
            const backendError = result?.error || "Backend rejected the delete.";
            setError(`Couldn't delete note: ${backendError}`);
            return { ok: false as const, error: backendError };
        }

        setNotes((current) => current.filter((n) => n.id !== noteId));
        return { ok: true as const };
    };

    const onReorderNotes = useCallback(
        async (orderedIds: string[]) => {
            const gameId = targetGameId;
            if (!gameId) {
                return { ok: false as const };
            }
            if (reorderInFlight) {
                return { ok: false as const };
            }

            setNotes((current) => {
                const byId = new Map(current.map((n) => [n.id, n]));
                const next: GameNote[] = [];
                const seen = new Set<string>();
                for (const id of orderedIds) {
                    const note = byId.get(id);
                    if (note && !seen.has(id)) {
                        seen.add(id);
                        next.push({ ...note, manualOrder: next.length });
                    }
                }
                for (const note of current) {
                    if (!seen.has(note.id)) {
                        next.push({ ...note, manualOrder: next.length });
                    }
                }
                return next;
            });

            setReorderInFlight(true);
            try {
                const result = await reorderGameNotes(gameId, orderedIds);
                if (!mountedRef.current) {
                    return { ok: false as const };
                }
                if (!result.ok) {
                    setError(result.error ? `Couldn't reorder notes: ${result.error}` : "Couldn't reorder notes.");
                    try {
                        const reloaded = await loadGameNotes(gameId);
                        if (mountedRef.current) {
                            setNotes(reloaded.notes ?? []);
                        }
                    } catch (reloadErr) {
                        logError("reorderGameNotes-reload", reloadErr);
                    }
                    return { ok: false as const };
                }
                return { ok: true as const };
            } catch (e: any) {
                logError("reorderGameNotes", e);
                if (!mountedRef.current) {
                    return { ok: false as const };
                }
                setError(String(e?.message || e || "Couldn't reorder notes."));
                return { ok: false as const };
            } finally {
                if (mountedRef.current) {
                    setReorderInFlight(false);
                }
            }
        },
        [targetGameId, reorderInFlight, mountedRef, setError]
    );

    const onReorderMove = useCallback(
        async (direction: ReorderDirection, sectionIds?: string[] | null) => {
            const gameId = targetGameId;
            if (!gameId) {
                return { ok: false as const };
            }
            if (sortMode !== "manual") {
                return { ok: false as const };
            }
            if (reorderTargetId === null) {
                return { ok: false as const };
            }
            if (reorderInFlight) {
                return { ok: false as const };
            }

            setReorderViaSwap(false);

            const flat = notes.map((n) => n.id);
            const targetId = reorderTargetId;
            if (!flat.includes(targetId)) {
                return { ok: false as const };
            }

            const neighbours = sectionIds && sectionIds.length > 0
                ? sectionIds.filter((id) => flat.includes(id))
                : flat.slice();

            const indexInSection = neighbours.indexOf(targetId);
            if (indexInSection < 0) {
                return { ok: false as const };
            }

            let nextIndex = indexInSection;
            if (direction === "top") {
                nextIndex = 0;
            }
            else if (direction === "bottom") {
                nextIndex = neighbours.length - 1;
            }
            else if (direction === "up") {
                nextIndex = Math.max(0, indexInSection - 1);
            }
            else if (direction === "down") {
                nextIndex = Math.min(neighbours.length - 1, indexInSection + 1);
            }

            const nextNeighbours = neighbours.slice();
            nextNeighbours.splice(indexInSection, 1);
            nextNeighbours.splice(nextIndex, 0, targetId);

            const neighbourSet = new Set(neighbours);
            const newFlat: string[] = [];
            let cursor = 0;
            for (const id of flat) {
                if (neighbourSet.has(id)) {
                    newFlat.push(nextNeighbours[cursor]);
                    cursor++;
                    continue;
                }
                newFlat.push(id);
            }

            return onReorderNotes(newFlat);
        },
        [notes, onReorderNotes, targetGameId, reorderInFlight, reorderTargetId, sortMode]
    );

    const onReorderSwap = useCallback(
        async (pressedId: string, sectionIds: string[] | null, allowSwap = true) => {
            if (sortMode !== "manual") {
                return;
            }
            if (reorderTargetId === null) {
                setReorderViaSwap(false);
                setReorderTargetId(pressedId);
                return;
            }
            if (pressedId === reorderTargetId) {
                setReorderViaSwap(false);
                setReorderTargetId(null);
                return;
            }

            const sameSection = sectionIds !== null && sectionIds.includes(pressedId);
            if (!allowSwap || !sameSection) {
                setReorderViaSwap(false);
                setReorderTargetId(pressedId);
                return;
            }

            if (reorderInFlight) {
                return;
            }

            const flat = notes.map((n) => n.id);
            const fromIndex = flat.indexOf(reorderTargetId);
            const toIndex = flat.indexOf(pressedId);
            if (fromIndex < 0 || toIndex < 0) {
                return;
            }

            const swapped = flat.slice();
            const held = swapped[fromIndex];
            swapped[fromIndex] = swapped[toIndex];
            swapped[toIndex] = held;

            setReorderViaSwap(true);
            await onReorderNotes(swapped);
        },
        [notes, onReorderNotes, reorderInFlight, reorderTargetId, sortMode]
    );

    const clearReorderSelection = () => {
        setReorderTargetId(null);
        setReorderViaSwap(false);
    };

    const onSortModeChange = async (mode: GameNoteSortMode) => {
        const gameId = targetGameId;
        if (!gameId) {
            return { ok: false as const };
        }

        setSortMode(mode);
        if (mode !== "manual") {
            setReorderTargetId(null);
            setReorderViaSwap(false);
        }
        setError(null);
        try {
            const result = await setGameNotesSortMode(gameId, mode);
            if (!mountedRef.current) {
                return { ok: false as const };
            }
            if (!result.ok) {
                setError(result.error ? `Couldn't set sort: ${result.error}` : "Couldn't set sort.");
                return { ok: false as const };
            }
            return { ok: true as const };
        } catch (e: any) {
            logError("setGameNotesSortMode", e);
            if (!mountedRef.current) {
                return { ok: false as const };
            }
            setError(String(e?.message || e || "Couldn't set sort."));
            return { ok: false as const };
        }
    };

    const onCardFocused = useCallback(
        async (noteId: string) => {
            const gameId = targetGameId;
            if (!gameId || !noteId) {
                return;
            }
            const target = notes.find((n) => n.id === noteId);
            if (!target || !target.showFiredDot) {
                return;
            }
            setNotes((current) => current.map((n) => {
                if (n.id !== noteId) {
                    return n;
                }
                return { ...n, showFiredDot: false };
            }));
            try {
                await clearNoteFiredDot(gameId, noteId);
            } catch (e: any) {
                logError("clearNoteFiredDot", e);
            }
        },
        [targetGameId, notes]
    );

    const onToggleCompleted = async (noteId: string, completed: boolean): Promise<OkResult> => {
        const gameId = targetGameId;
        if (!gameId || !noteId) {
            return { ok: false, error: "No current game loaded." };
        }

        setError(null);

        const stampedAt = Math.floor(Date.now() / 1000);
        setNotes((current) => current.map((n) => {
            if (n.id !== noteId) {
                return n;
            }
            if (completed) {
                return { ...n, completedAt: stampedAt, showFiredDot: false };
            }
            return { ...n, completedAt: null };
        }));

        let result;
        try {
            result = await markGameNoteCompleted(gameId, noteId, completed);
        } catch (e: any) {
            logError("markGameNoteCompleted", e);
            if (!mountedRef.current) {
                return { ok: true };
            }
            const message = String(e?.message || e || "Couldn't update note.");
            setError(message);
            return { ok: false, error: message };
        }

        if (!mountedRef.current) {
            return { ok: true };
        }
        if (!result || !result.ok || !result.note) {
            const backendError = result?.error || "Backend rejected the change.";
            setError(`Couldn't update note: ${backendError}`);
            return { ok: false, error: backendError };
        }

        const saved = result.note;
        setNotes((current) => replaceNoteInList(current, saved));
        return { ok: true };
    };

    const onSaveGameNote = async (
        existingId: string | null,
        input: {
            title: string;
            body: string;
            tag: string | null;
            color: NoteColor;
            reminderMode: GameNoteReminderMode;
            reminderEveryMinutes: number | null;
            reminderEveryValue: number | null;
            reminderEveryUnit: GameNoteReminderUnit | null;
            resetReminderTimer: boolean;
        }
    ): Promise<OkResult> => {
        if (existingId === null) {
            const result = await onCreateNote({
                title: input.title,
                body: input.body,
                tag: input.tag,
                color: input.color,
                reminderMode: input.reminderMode,
                reminderEveryMinutes: input.reminderEveryMinutes,
                reminderEveryValue: input.reminderEveryValue,
                reminderEveryUnit: input.reminderEveryUnit
            });
            return { ok: result.ok, error: (result as any).error };
        }
        const result = await onUpdateNote(existingId, input);
        return { ok: result.ok, error: (result as any).error };
    };

    const onDeleteGameNote = async (noteId: string): Promise<OkResult> => {
        const result = await onDeleteNote(noteId);
        return { ok: result.ok, error: (result as any).error };
    };

    const pendingReminderBadge = notes.some((n) => n.showFiredDot);

    return {
        state: {
            notes,
            tagVocabulary,
            sortMode,
            loadedForGameId,
            validating,
            reorderInFlight,
            reorderTargetId,
            reorderViaSwap,
            pendingReminderBadge
        },
        actions: {
            onSaveGameNote,
            onDeleteGameNote,
            onReorderMove,
            onReorderSwap,
            onSortModeChange,
            onCardFocused,
            onToggleCompleted,
            clearReorderSelection
        }
    };
}
