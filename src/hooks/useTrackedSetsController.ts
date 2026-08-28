import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    addGameToSet,
    checkAllSetsCompletion,
    checkSetCompletion,
    clearAllTrackedSets,
    createTrackedSet,
    deleteTrackedSet,
    loadTrackedSets,
    removeGameFromSet,
    renameTrackedSet,
    reorderSetGames,
    setTrackedSetGameSort,
    setTrackedSetGameFilter,
    setTrackedSetViewMode,
    touchTrackedSetOpened,
    updateSetGameNote
} from "../api";
import type {
    AddTrackedSetGamePayload,
    NoteColor,
    TrackedSet,
    TrackedSetFilter,
    TrackedSetGameSort,
    TrackedSetViewMode
} from "../types";
import { logError } from "../utils/errors";

type UseTrackedSetsControllerArgs = {
    isActive: boolean;
    autoCheckEnabled: boolean;
};

export function useTrackedSetsController(args: UseTrackedSetsControllerArgs) {
    const { isActive, autoCheckEnabled } = args;

    const [sets, setSets] = useState<TrackedSet[]>([]);
    const [setsLoading, setSetsLoading] = useState(false);
    const [setsError, setSetsError] = useState<string | null>(null);
    const [setsLoaded, setSetsLoaded] = useState(false);

    const [openSetId, setOpenSetId] = useState<string | null>(null);

    const [checkLoading, setCheckLoading] = useState(false);
    const [checkError, setCheckError] = useState<string | null>(null);

    const loadRunIdRef = useRef(0);
    const checkRunIdRef = useRef(0);
    const allCheckRunIdRef = useRef(0);

    const [fullCheckArmed, setFullCheckArmed] = useState(false);

    const armFullCheck = () => {
        setFullCheckArmed(true);
    };

    const spliceSet = (updated: TrackedSet) => {
        setSets((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    };

    const loadSets = useCallback(async () => {
        const runId = loadRunIdRef.current + 1;
        loadRunIdRef.current = runId;
        setSetsLoading(true);
        setSetsError(null);

        try {
            const result = await loadTrackedSets();
            if (loadRunIdRef.current !== runId) {
                return;
            }
            setSets(result.sets || []);
            setSetsLoaded(true);
            setSetsLoading(false);
        } catch (error: any) {
            if (loadRunIdRef.current !== runId) {
                return;
            }
            setSetsError(String(error?.message || error || "Couldn't load your sets."));
            setSetsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        if (setsLoaded) {
            return;
        }
        void loadSets();
    }, [isActive, setsLoaded, loadSets]);

    const runCompletionCheck = async (setId: string) => {
        if (!setId) {
            return;
        }
        const runId = checkRunIdRef.current + 1;
        checkRunIdRef.current = runId;
        setCheckLoading(true);
        setCheckError(null);

        try {
            const result = await checkSetCompletion(setId);
            if (checkRunIdRef.current !== runId) {
                return;
            }
            if (result.ok && result.set) {
                spliceSet(result.set);
            } else if (result.error) {
                setCheckError(result.error);
            }
            setCheckLoading(false);
        } catch (error: any) {
            if (checkRunIdRef.current !== runId) {
                return;
            }
            setCheckError(String(error?.message || error || "Couldn't check this set."));
            setCheckLoading(false);
        }
    };

    const runAllCompletionCheck = useCallback(async () => {
        const runId = allCheckRunIdRef.current + 1;
        allCheckRunIdRef.current = runId;
        setCheckLoading(true);
        setCheckError(null);

        try {
            const result = await checkAllSetsCompletion();
            if (allCheckRunIdRef.current !== runId) {
                return;
            }
            if (result.ok && result.sets) {
                setSets(result.sets);
            } else if (result.error) {
                setCheckError(result.error);
            }
            setCheckLoading(false);
        } catch (error: any) {
            if (allCheckRunIdRef.current !== runId) {
                return;
            }
            setCheckError(String(error?.message || error || "Couldn't refresh your sets."));
            setCheckLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isActive || !autoCheckEnabled || !fullCheckArmed) {
            return;
        }
        setFullCheckArmed(false);
        void runAllCompletionCheck();
    }, [isActive, autoCheckEnabled, fullCheckArmed, runAllCompletionCheck]);

    const createSet = async (name: string) => {
        try {
            const result = await createTrackedSet(name);
            if (result.ok && result.set) {
                const created = result.set;
                setSets((prev) => [...prev, created]);
                setOpenSetId(created.id);
                return created;
            }
            return null;
        } catch (e) {
            logError("createSet", e);
            return null;
        }
    };

    const renameSet = async (setId: string, name: string) => {
        try {
            const result = await renameTrackedSet(setId, name);
            if (result.ok && result.set) {
                spliceSet(result.set);
                return true;
            }
            return false;
        } catch (e) {
            logError("renameSet", e);
            return false;
        }
    };

    const removeSet = async (setId: string) => {
        try {
            const result = await deleteTrackedSet(setId);
            if (result.ok) {
                setSets((prev) => prev.filter((item) => item.id !== setId));
                setOpenSetId((current) => (current === setId ? null : current));
                return true;
            }
            return false;
        } catch (e) {
            logError("removeSet", e);
            return false;
        }
    };

    const addGame = async (setId: string, game: AddTrackedSetGamePayload) => {
        try {
            const result = await addGameToSet(setId, game);
            if (result.ok && result.set) {
                spliceSet(result.set);
                if (autoCheckEnabled && !result.alreadyPresent) {
                    void runCompletionCheck(setId);
                }
            }
            return result;
        } catch (e) {
            logError("addGame", e);
            return { ok: false as const };
        }
    };

    const removeGame = async (setId: string, gameId: number) => {
        try {
            const result = await removeGameFromSet(setId, gameId);
            if (result.ok && result.set) {
                spliceSet(result.set);
                return true;
            }
            return false;
        } catch (e) {
            logError("removeGame", e);
            return false;
        }
    };

    const saveGameNote = async (setId: string, gameId: number, note: string, color: NoteColor) => {
        try {
            const result = await updateSetGameNote(setId, gameId, note, color);
            if (result.ok && result.set) {
                spliceSet(result.set);
                return true;
            }
            return false;
        } catch (e) {
            logError("saveGameNote", e);
            return false;
        }
    };

    const reorderGames = async (setId: string, orderedIds: (string | number)[], order: TrackedSetViewMode) => {
        try {
            const result = await reorderSetGames(setId, orderedIds, order);
            if (result.ok && result.set) {
                spliceSet(result.set);
                return true;
            }
            return false;
        } catch (e) {
            logError("reorderGames", e);
            return false;
        }
    };

    const changeGameSort = async (setId: string, sort: TrackedSetGameSort) => {
        setSets((prev) => prev.map((item) => (item.id === setId ? { ...item, gameSort: sort } : item)));
        try {
            const result = await setTrackedSetGameSort(setId, sort);
            if (result.ok && result.set) {
                spliceSet(result.set);
                return true;
            }
            return false;
        } catch (e) {
            logError("changeGameSort", e);
            return false;
        }
    };

    const changeGameFilter = async (setId: string, gameFilter: TrackedSetFilter) => {
        setSets((prev) => prev.map((item) => (item.id === setId ? { ...item, gameFilter } : item)));
        try {
            const result = await setTrackedSetGameFilter(setId, gameFilter);
            if (result.ok && result.set) {
                spliceSet(result.set);
                return true;
            }
            return false;
        } catch (e) {
            logError("changeGameFilter", e);
            return false;
        }
    };

    const changeViewMode = async (setId: string, viewMode: TrackedSetViewMode) => {
        setSets((prev) => prev.map((item) => (item.id === setId ? { ...item, viewMode } : item)));
        try {
            const result = await setTrackedSetViewMode(setId, viewMode);
            if (result.ok && result.set) {
                spliceSet(result.set);
                return true;
            }
            return false;
        } catch (e) {
            logError("changeViewMode", e);
            return false;
        }
    };

    const openSet = useCallback(async (setId: string) => {
        setOpenSetId(setId);
        const now = Math.floor(Date.now() / 1000);
        setSets((prev) =>
            prev.map((item) => (item.id === setId ? { ...item, lastOpenedAt: now } : item))
        );
        void touchTrackedSetOpened(setId).catch((e) => logError("touchTrackedSetOpened", e));
    }, []);

    const closeSet = () => {
        setOpenSetId(null);
    };

    const clearAll = async () => {
        try {
            const result = await clearAllTrackedSets();
            if (result.ok) {
                setSets([]);
                setOpenSetId(null);
                return result;
            }
            return null;
        } catch (e) {
            logError("clearAll", e);
            return null;
        }
    };

    const openSet_ = useMemo(
        () => (openSetId ? sets.find((item) => item.id === openSetId) || null : null),
        [openSetId, sets]
    );

    const openSetIdRef = useRef<string | null>(openSetId);

    useEffect(() => {
        openSetIdRef.current = openSetId;
    }, [openSetId]);

    return {
        state: {
            sets,
            setsLoading,
            setsError,
            openSetId,
            openSet: openSet_,
            checkLoading,
            checkError
        },
        actions: {
            setOpenSetId,
            openSet,
            closeSet,
            createSet,
            renameSet,
            removeSet,
            addGame,
            removeGame,
            saveGameNote,
            reorderGames,
            changeGameSort,
            changeGameFilter,
            changeViewMode,
            runCompletionCheck,
            armFullCheck,
            clearAll
        },
        refs: {
            openSetIdRef
        }
    };
}
