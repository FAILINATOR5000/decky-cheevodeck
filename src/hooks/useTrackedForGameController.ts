import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import {
    cacheTrackedCount,
    cacheTrackedIds,
    cacheTrackedNotes,
    cacheTrackedNotesColor,
    bulkToggleTracked,
    getCachedTrackedIds,
    getCachedTrackedNotes,
    getCachedTrackedNotesColor,
    getGamePayload,
    getTrackedAchievements,
    moveTrackedAchievement,
    saveTrackedNote,
    saveTrackedSortForGame,
    toggleTrackedAchievement
} from "../api";
import type {
    AchievementRow,
    AOSource,
    NoteColor,
    OkResult,
    Payload,
    ReorderDirection,
    TrackedAchievementAction,
    TrackedAchievementSort,
    TrackedNotes,
    TrackedNotesColor
} from "../types";
import { earned, metricSortComparator } from "../utils/achievements";
import { logError } from "../utils/errors";
import { openExternalUrl, raAchievementUrl } from "../utils/navigation";
import { groupIdsForTrackedTarget } from "../components/tracked/TrackedListBody";

type UseTrackedForGameControllerArgs = {
    selectedGameId: number | null;
    mountedRef: RefObject<boolean>;
    showAButtonModeTracked: boolean;
    mouseKeyboardMode: boolean;
    trackedAchievementAction: TrackedAchievementAction;
    trackedAchievementSort: TrackedAchievementSort;
    setError: Dispatch<SetStateAction<string | null>>;
    openNoteModal: (
        gameId: number | null,
        achievement: AchievementRow,
        currentNote: string,
        currentColor: NoteColor | null,
        saveNote: (achievementId: number, note: string, color: NoteColor) => Promise<OkResult>
    ) => void;
    saveTrackedAchievementActionWithRollback: (nextValue: TrackedAchievementAction) => Promise<void>;
    legacyAchievementLinks: boolean;
    goToAchievementOverviewRef: RefObject<
        ((achievement: AchievementRow, parentGameId: number | null, source: AOSource, viewedUsername: string | null, viewedUserRef: string | null) => void) | null
    >;
};

export function useTrackedForGameController({
    selectedGameId,
    mountedRef,
    showAButtonModeTracked,
    mouseKeyboardMode,
    trackedAchievementAction,
    trackedAchievementSort,
    setError,
    openNoteModal,
    saveTrackedAchievementActionWithRollback,
    legacyAchievementLinks,
    goToAchievementOverviewRef
}: UseTrackedForGameControllerArgs) {
    const [payload, setPayload] = useState<Payload | null>(null);
    const [payloadLoading, setPayloadLoading] = useState(false);
    const [payloadError, setPayloadError] = useState<string | null>(null);
    const [trackedIds, setTrackedIds] = useState<number[]>([]);
    const [trackedIdsLoadedForGameId, setTrackedIdsLoadedForGameId] = useState<number | null>(null);
    const [notesByAchievementId, setNotesByAchievementId] = useState<TrackedNotes>({});
    const [notesColorByAchievementId, setNotesColorByAchievementId] = useState<TrackedNotesColor>({});
    const [sort, setSort] = useState<TrackedAchievementSort>(trackedAchievementSort);
    const [reorderTargetId, setReorderTargetId] = useState<number | null>(null);
    const [reorderInFlight, setReorderInFlight] = useState(false);
    const [reorderViaSwap, setReorderViaSwap] = useState(false);

    useEffect(() => {
        if (selectedGameId === null) {
            setPayload(null);
            setPayloadLoading(false);
            setPayloadError(null);
            setTrackedIds([]);
            setTrackedIdsLoadedForGameId(null);
            setNotesByAchievementId({});
            setNotesColorByAchievementId({});
            setSort(trackedAchievementSort);
            return;
        }

        const seededTrackedIds = getCachedTrackedIds(selectedGameId);
        if (seededTrackedIds) {
            setTrackedIds(seededTrackedIds);
        }
        else {
            setTrackedIds([]);
        }
        const seededNotes = getCachedTrackedNotes(selectedGameId);
        setNotesByAchievementId(seededNotes ?? {});
        const seededNotesColor = getCachedTrackedNotesColor(selectedGameId);
        setNotesColorByAchievementId(seededNotesColor ?? {});
        setTrackedIdsLoadedForGameId(null);
        setPayload(null);
        setPayloadError(null);
        setPayloadLoading(true);

        let cancelled = false;

        void (async () => {
            try {
                const result = await getGamePayload(selectedGameId);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                if (result?.error) {
                    setPayloadError(result.error);
                    setPayload(null);
                    return;
                }
                setPayload(result?.payload ?? null);
                setPayloadError(null);
            } catch (e: any) {
                logError("getGamePayload (drill-in)", e);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                setPayloadError(
                    String(e?.message || e || "Couldn't load this game's achievements.")
                );
                setPayload(null);
            } finally {
                if (!cancelled && mountedRef.current) {
                    setPayloadLoading(false);
                }
            }
        })();

        void (async () => {
            try {
                const result = await getTrackedAchievements(selectedGameId);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                const achievementIds = result.achievementIds ?? [];
                const notes = result.notes ?? {};
                const notesColor = result.notesColor ?? {};
                cacheTrackedCount(selectedGameId, achievementIds.length);
                cacheTrackedIds(selectedGameId, achievementIds);
                cacheTrackedNotes(selectedGameId, notes);
                cacheTrackedNotesColor(selectedGameId, notesColor);
                setTrackedIds(achievementIds);
                setNotesByAchievementId(notes);
                setNotesColorByAchievementId(notesColor);
                setSort(result.sort ?? trackedAchievementSort);
                setTrackedIdsLoadedForGameId(selectedGameId);
            } catch (e) {
                logError("getTrackedAchievements (drill-in)", e);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                setTrackedIds([]);
                setNotesByAchievementId({});
                setNotesColorByAchievementId({});
                setTrackedIdsLoadedForGameId(selectedGameId);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mountedRef, selectedGameId]);

    const achievementMap = useMemo(() => {
        const map = new Map<number, AchievementRow>();
        for (const achievement of payload?.achievements ?? []) {
            map.set(achievement.id, achievement);
        }
        return map;
    }, [payload]);

    const earnedAchievementIds = useMemo(() => {
        const ids = new Set<number>();
        for (const achievement of payload?.achievements ?? []) {
            if (earned(achievement)) {
                ids.add(achievement.id);
            }
        }
        return ids;
    }, [payload]);

    useEffect(() => {
        if (selectedGameId === null) {
            return;
        }
        if (trackedIdsLoadedForGameId !== selectedGameId) {
            return;
        }
        if (!payload) {
            return;
        }
        if (trackedIds.length <= 0) {
            return;
        }

        const nextTrackedIds = trackedIds.filter((id) => !earnedAchievementIds.has(id));
        if (nextTrackedIds.length === trackedIds.length) {
            return;
        }

        cacheTrackedCount(selectedGameId, nextTrackedIds.length);
        cacheTrackedIds(selectedGameId, nextTrackedIds);
        setTrackedIds(nextTrackedIds);

        void bulkToggleTracked(
            selectedGameId,
            nextTrackedIds,
            "set",
            payload.title ?? null,
            payload.consoleName ?? null,
            payload.imageIcon ?? null,
        ).catch((e) => logError("bulkToggleTracked(validation, drill-in)", e));
    }, [earnedAchievementIds, payload, selectedGameId, trackedIds, trackedIdsLoadedForGameId]);

    useEffect(() => {
        if (trackedAchievementAction !== "reorder") {
            setReorderTargetId(null);
            setReorderInFlight(false);
            setReorderViaSwap(false);
        }
    }, [trackedAchievementAction]);

    useEffect(() => {
        if (sort !== "manual") {
            setReorderTargetId(null);
            setReorderViaSwap(false);
        }
    }, [sort]);

    useEffect(() => {
        if (reorderTargetId === null) {
            return;
        }
        if (!trackedIds.includes(reorderTargetId)) {
            setReorderTargetId(null);
            setReorderViaSwap(false);
        }
    }, [reorderTargetId, trackedIds]);

    const trackedAchievements = useMemo(() => {
        const trackedRows = trackedIds
            .map((id) => achievementMap.get(id))
            .filter((achievement): achievement is AchievementRow => Boolean(achievement))
            .filter((achievement) => !earned(achievement));

        if (sort === "manual") {
            return trackedRows;
        }

        const metricComparator = metricSortComparator(sort);
        if (metricComparator) {
            return [...trackedRows].sort(metricComparator);
        }

        const sorted = [...trackedRows].sort((a, b) => (a.displayOrder - b.displayOrder) || (a.id - b.id));
        return sorted;
    }, [trackedIds, achievementMap, sort]);

    const trackedReady =
        selectedGameId !== null
            && payload !== null
            && trackedIdsLoadedForGameId === selectedGameId;

    const onSaveTrackedNote = useCallback(
        async (achievementId: number, note: string, color: NoteColor): Promise<OkResult> => {
            if (selectedGameId === null) {
                return { ok: false, error: "No game selected." };
            }
            try {
                const result = await saveTrackedNote(selectedGameId, achievementId, note, color);
                if (!mountedRef.current) {
                    return { ok: true };
                }
                if (!result?.ok) {
                    return { ok: false, error: "Couldn't save your note." };
                }
                const nextNotes = result.notes ?? {};
                const nextNotesColor = result.notesColor ?? {};
                cacheTrackedNotes(selectedGameId, nextNotes);
                cacheTrackedNotesColor(selectedGameId, nextNotesColor);
                setNotesByAchievementId(nextNotes);
                setNotesColorByAchievementId(nextNotesColor);
                return { ok: true };
            } catch (e: any) {
                logError("onSaveTrackedNote (drill-in)", e);
                return {
                    ok: false,
                    error: String(e?.message || e || "Couldn't save your note.")
                };
            }
        },
        [mountedRef, selectedGameId]
    );

    const onSortChange = async (nextSort: TrackedAchievementSort) => {
        if (selectedGameId === null) {
            return;
        }
        const previousSort = sort;
        setSort(nextSort);
        try {
            const result = await saveTrackedSortForGame(selectedGameId, nextSort);
            if (!mountedRef.current) {
                return;
            }
            if (!result?.ok) {
                setSort(previousSort);
                return;
            }
            if (result.sort && result.sort !== nextSort) {
                setSort(result.sort);
            }
            const effectiveSort = result.sort ?? nextSort;
            if (effectiveSort !== "manual" && trackedAchievementAction === "reorder") {
                void saveTrackedAchievementActionWithRollback("editNote");
            }
        } catch (e: any) {
            logError("onSortChange (drill-in)", e);
            if (!mountedRef.current) {
                return;
            }
            setSort(previousSort);
        }
    };

    const onReorderSwap = useCallback(
        async (pressedId: number, allowSwap = true) => {
            if (selectedGameId === null || !payload) {
                return;
            }
            if (sort !== "manual") {
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

            const selectedGroup = groupIdsForTrackedTarget(
                trackedAchievements,
                notesByAchievementId,
                reorderTargetId
            );
            const sameGroup = selectedGroup !== null && selectedGroup.includes(pressedId);
            if (!allowSwap || !sameGroup) {
                setReorderViaSwap(false);
                setReorderTargetId(pressedId);
                return;
            }

            if (reorderInFlight) {
                return;
            }

            const current = trackedIds.slice();
            const fromIndex = current.indexOf(reorderTargetId);
            const toIndex = current.indexOf(pressedId);
            if (fromIndex < 0 || toIndex < 0) {
                return;
            }

            const swapped = current.slice();
            const held = swapped[fromIndex];
            swapped[fromIndex] = swapped[toIndex];
            swapped[toIndex] = held;

            const movedId = reorderTargetId;

            setReorderInFlight(true);
            setError(null);
            try {
                const result = await bulkToggleTracked(
                    selectedGameId,
                    swapped,
                    "set",
                    payload.title ?? null,
                    payload.consoleName ?? null,
                    payload.imageIcon ?? null
                );
                if (!mountedRef.current) {
                    return;
                }
                const achievementIds = result.achievementIds ?? [];
                const notes = result.notes ?? {};
                const notesColor = result.notesColor ?? {};
                cacheTrackedCount(selectedGameId, achievementIds.length);
                cacheTrackedIds(selectedGameId, achievementIds);
                cacheTrackedNotes(selectedGameId, notes);
                cacheTrackedNotesColor(selectedGameId, notesColor);
                setTrackedIds(achievementIds);
                setNotesByAchievementId(notes);
                setNotesColorByAchievementId(notesColor);
                if (result.sort) {
                    setSort(result.sort);
                }
                setReorderViaSwap(true);
                setReorderTargetId(movedId);
            } catch (e: any) {
                logError("onReorderSwap (drill-in)", e);
                if (!mountedRef.current) {
                    return;
                }
                setError(String(e?.message || e || "Couldn't reorder tracked achievements."));
            } finally {
                if (mountedRef.current) {
                    setReorderInFlight(false);
                }
            }
        },
        [
            mountedRef,
            notesByAchievementId,
            payload,
            reorderInFlight,
            reorderTargetId,
            selectedGameId,
            setError,
            sort,
            trackedAchievements,
            trackedIds
        ]
    );

    const clearReorderSelection = () => {
        setReorderTargetId(null);
        setReorderViaSwap(false);
    };

    const onViewInfo = useCallback(
        async (achievement: AchievementRow) => {
            if (selectedGameId === null) {
                return;
            }
            clearReorderSelection();
            setError(null);
            if (legacyAchievementLinks) {
                await openExternalUrl(raAchievementUrl(achievement.id));
                return;
            }
            goToAchievementOverviewRef.current?.(achievement, selectedGameId, "tracked", null, null);
        },
        [goToAchievementOverviewRef, legacyAchievementLinks, selectedGameId, setError]
    );

    const onEditNote = useCallback(
        (achievement: AchievementRow) => {
            if (selectedGameId === null) {
                return;
            }
            clearReorderSelection();
            setError(null);
            const currentNote = notesByAchievementId[String(achievement.id)] ?? "";
            const currentColor = notesColorByAchievementId[String(achievement.id)] ?? null;
            openNoteModal(selectedGameId, achievement, currentNote, currentColor, onSaveTrackedNote);
        },
        [
            notesByAchievementId,
            notesColorByAchievementId,
            onSaveTrackedNote,
            openNoteModal,
            selectedGameId,
            setError
        ]
    );

    const onUntrack = useCallback(
        async (achievement: AchievementRow) => {
            if (selectedGameId === null || !payload) {
                return;
            }
            clearReorderSelection();
            setError(null);
            try {
                const result = await toggleTrackedAchievement(
                    selectedGameId,
                    achievement.id,
                    payload.title ?? null,
                    payload.consoleName ?? null,
                    payload.imageIcon ?? null
                );
                if (!mountedRef.current) {
                    return;
                }
                const achievementIds = result.achievementIds ?? [];
                const notes = result.notes ?? {};
                const notesColor = result.notesColor ?? {};
                cacheTrackedCount(selectedGameId, achievementIds.length);
                cacheTrackedIds(selectedGameId, achievementIds);
                cacheTrackedNotes(selectedGameId, notes);
                cacheTrackedNotesColor(selectedGameId, notesColor);
                setTrackedIds(achievementIds);
                setNotesByAchievementId(notes);
                setNotesColorByAchievementId(notesColor);
                if (result.sort) {
                    setSort(result.sort);
                }
            } catch (e: any) {
                logError("onUntrack (drill-in)", e);
                if (!mountedRef.current) {
                    return;
                }
                setError(String(e?.message || e || "Couldn't update tracked achievements."));
            }
        },
        [mountedRef, payload, selectedGameId, setError]
    );

    const onAchievementClick = useCallback(
        async (achievement: AchievementRow, _currentTrackedAchievements: AchievementRow[]) => {
            const effectiveTrackedAction: TrackedAchievementAction = mouseKeyboardMode
                ? (showAButtonModeTracked ? trackedAchievementAction : "untrack")
                : "info";

            if (effectiveTrackedAction === "info") {
                await onViewInfo(achievement);
                return;
            }
            if (effectiveTrackedAction === "editNote") {
                onEditNote(achievement);
                return;
            }
            if (effectiveTrackedAction === "reorder") {
                setError(null);
                void onReorderSwap(achievement.id);
                return;
            }
            await onUntrack(achievement);
        },
        [
            mouseKeyboardMode,
            onEditNote,
            onReorderSwap,
            onUntrack,
            onViewInfo,
            setError,
            showAButtonModeTracked,
            trackedAchievementAction
        ]
    );

    const onReorderMove = useCallback(
        async (direction: ReorderDirection, groupIds?: number[] | null) => {
            if (selectedGameId === null) {
                return;
            }
            if (!payload) {
                return;
            }
            if (sort !== "manual") {
                return;
            }
            if (reorderTargetId === null) {
                return;
            }
            if (reorderInFlight) {
                return;
            }

            setReorderInFlight(true);
            setError(null);
            try {
                const result = await moveTrackedAchievement(
                    selectedGameId,
                    reorderTargetId,
                    direction,
                    payload.title ?? null,
                    payload.consoleName ?? null,
                    payload.imageIcon ?? null,
                    groupIds ?? null
                );
                if (!mountedRef.current) {
                    return;
                }
                const achievementIds = result.achievementIds ?? [];
                const notes = result.notes ?? {};
                const notesColor = result.notesColor ?? {};
                cacheTrackedCount(selectedGameId, achievementIds.length);
                cacheTrackedIds(selectedGameId, achievementIds);
                cacheTrackedNotes(selectedGameId, notes);
                cacheTrackedNotesColor(selectedGameId, notesColor);
                setTrackedIds(achievementIds);
                setNotesByAchievementId(notes);
                setNotesColorByAchievementId(notesColor);
                if (result.sort) {
                    setSort(result.sort);
                }
                setReorderViaSwap(false);
            } catch (e: any) {
                logError("onReorderMove (drill-in)", e);
                if (!mountedRef.current) {
                    return;
                }
                setError(String(e?.message || e || "Couldn't reorder tracked achievements."));
            } finally {
                if (mountedRef.current) {
                    setReorderInFlight(false);
                }
            }
        },
        [mountedRef, payload, reorderInFlight, reorderTargetId, selectedGameId, setError, sort]
    );

    return {
        state: {
            payload,
            payloadLoading,
            payloadError,
            trackedReady,
            trackedAchievements,
            trackedIds,
            notesByAchievementId,
            notesColorByAchievementId,
            sort,
            reorderTargetId,
            reorderViaSwap
        },
        actions: {
            onAchievementClick,
            onUntrack,
            onEditNote,
            onReorderSwap,
            onSaveTrackedNote,
            onSortChange,
            onReorderMove
        }
    };
}
