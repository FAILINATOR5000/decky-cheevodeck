import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
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
    clearAllTrackedAchievements,
    clearTrackedAchievements,
    clearTrackedCountMemoryCache,
    getCachedTrackedCount,
    getCachedTrackedIds,
    getCachedTrackedNotes,
    getCachedTrackedNotesColor,
    getTotalTrackedCount,
    getTrackedAchievements,
    saveLastTrackedTab,
    saveTrackedNote,
    saveTrackedCollapsedTags,
    saveTrackedSortForGame,
    toggleTrackedAchievement
} from "../api";
import type { AchievementRow, AOSource, NoteColor, OkResult, Payload, ReorderDirection, TrackedAchievementAction, TrackedAchievementSort, TrackedNotes, TrackedNotesColor, TrackedTab, ViewKey } from "../types";
import { earned, isMissable, metricSortComparator } from "../utils/achievements";
import type { LanguageCode } from "../locales";
import { logError } from "../utils/errors";
import { landOn, liveOrder, orderAfterGroupMove, stepTo } from "../utils/reorderOrder";

const ORDER_WRITE_SETTLE_MS = 250;
import { openExternalUrl, raAchievementUrl } from "../utils/navigation";
import {
    groupIdsForTrackedTarget,
    trackedRemovalLanding,
    TRACKED_UNTAGGED_COLLAPSE_KEY
} from "../components/tracked/TrackedListBody";
import { useFocusClaim } from "./useFocusClaim";

type TrackedWriteResult = {
    achievementIds: number[];
    notes: TrackedNotes;
    notesColor: TrackedNotesColor;
};

type UseTrackedControllerArgs = {
    payload: Payload | null;
    language: LanguageCode;
    mountedRef: RefObject<boolean>;
    showAButtonModeTracked: boolean;
    mouseKeyboardMode: boolean;
    trackedAchievementAction: TrackedAchievementAction;
    trackedAchievementSort: TrackedAchievementSort;
    setView: (next: ViewKey) => void;
    setRecentGamesExpanded: Dispatch<SetStateAction<boolean>>;
    setPendingFocusKey: Dispatch<SetStateAction<string | null>>;
    setError: Dispatch<SetStateAction<string | null>>;
    setLastTrackedTab: Dispatch<SetStateAction<TrackedTab>>;
    setTrackedSelectedGameId: Dispatch<SetStateAction<number | null>>;
    saveTrackedAchievementActionWithRollback: (nextValue: TrackedAchievementAction) => Promise<void>;
    openNoteModal: (
        gameId: number | null,
        achievement: AchievementRow,
        currentNote: string,
        currentColor: NoteColor | null,
        saveNote: (achievementId: number, note: string, color: NoteColor) => Promise<OkResult>
    ) => void;
    goToAchievements: (focusKey?: string) => void;
    legacyAchievementLinks: boolean;
    goToAchievementOverviewRef: RefObject<
        ((achievement: AchievementRow, parentGameId: number | null, source: AOSource, viewedUsername: string | null, viewedUserRef: string | null) => void) | null
    >;
};

export function useTrackedController({
    payload,
    language,
    mountedRef,
    showAButtonModeTracked,
    mouseKeyboardMode,
    trackedAchievementAction,
    trackedAchievementSort,
    setView,
    setRecentGamesExpanded,
    setPendingFocusKey,
    setError,
    setLastTrackedTab,
    setTrackedSelectedGameId,
    saveTrackedAchievementActionWithRollback,
    openNoteModal,
    goToAchievements,
    legacyAchievementLinks,
    goToAchievementOverviewRef
}: UseTrackedControllerArgs) {
    const [trackedValidating, setTrackedValidating] = useState(false);
    const [trackedIds, setTrackedIds] = useState<number[]>([]);
    const [trackedIdsLoadedForGameId, setTrackedIdsLoadedForGameId] = useState<number | null>(null);
    const [notesByAchievementId, setNotesByAchievementId] = useState<TrackedNotes>({});
    const [notesColorByAchievementId, setNotesColorByAchievementId] = useState<TrackedNotesColor>({});
    const [sort, setSort] = useState<TrackedAchievementSort>(trackedAchievementSort);
    const [lastKnownTrackedCount, setLastKnownTrackedCount] = useState<number | null>(null);
    const [totalTrackedCount, setTotalTrackedCount] = useState<number | null>(null);
    const [reorderTargetId, setReorderTargetId] = useState<number | null>(null);
    const [reorderInFlight, setReorderInFlight] = useState(false);

    const [collapsedTags, setCollapsedTags] = useState<string[]>([]);
    const collapsedTagSet = useMemo(() => new Set(collapsedTags), [collapsedTags]);

    const pendingOrderRef = useRef<{
        gameId: number;
        ids: number[];
        title: string | null;
        consoleName: string | null;
        imageIcon: string | null;
    } | null>(null);

    const orderWriteTimerRef = useRef(0);

    const payloadRef = useRef(payload);
    payloadRef.current = payload;
    const [reorderViaSwap, setReorderViaSwap] = useState(false);

    const [backClaimToken, setBackClaimToken] = useState(0);

    const rowClaim = useFocusClaim();

    const applyTrackedResult = (gameId: number, result: TrackedWriteResult) => {
        const achievementIds = result.achievementIds ?? [];
        const notes = result.notes ?? {};
        const notesColor = result.notesColor ?? {};
        cacheTrackedCount(gameId, achievementIds.length);
        cacheTrackedIds(gameId, achievementIds);
        cacheTrackedNotes(gameId, notes);
        cacheTrackedNotesColor(gameId, notesColor);
        setLastKnownTrackedCount(achievementIds.length);
        setTrackedIds(achievementIds);
        setNotesByAchievementId(notes);
        setNotesColorByAchievementId(notesColor);
    };

    useEffect(() => {
        const gameId = payload?.gameId ?? null;
        if (!gameId) {
            setTrackedIds([]);
            setTrackedIdsLoadedForGameId(null);
            setLastKnownTrackedCount(null);
            setNotesByAchievementId({});
            setNotesColorByAchievementId({});
            setCollapsedTags([]);
            return;
        }

        setLastKnownTrackedCount(getCachedTrackedCount(gameId));
        const seededTrackedIds = getCachedTrackedIds(gameId);
        if (seededTrackedIds) {
            setTrackedIds(seededTrackedIds);
        }
        else {
            setTrackedIds([]);
        }
        const seededNotes = getCachedTrackedNotes(gameId);
        setNotesByAchievementId(seededNotes ?? {});
        const seededNotesColor = getCachedTrackedNotesColor(gameId);
        setNotesColorByAchievementId(seededNotesColor ?? {});

        let cancelled = false;
        void (async () => {
            try {
                const result = await getTrackedAchievements(gameId);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                applyTrackedResult(gameId, result);
                setSort(result.sort ?? trackedAchievementSort);
                setCollapsedTags(result.collapsedTags ?? []);
                setTrackedIdsLoadedForGameId(gameId);
            } catch (e) {
                logError("getTrackedAchievements", e);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                setTrackedIds([]);
                setNotesByAchievementId({});
                setNotesColorByAchievementId({});
                setCollapsedTags([]);
                setTrackedIdsLoadedForGameId(gameId);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mountedRef, payload?.gameId]);



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
        const gameId = payload?.gameId ?? null;
        if (!gameId) {
            return;
        }

        if (trackedIdsLoadedForGameId !== gameId) {
            return;
        }

        if (trackedIds.length <= 0) {
            return;
        }

        const nextTrackedIds = trackedIds.filter((id) => !earnedAchievementIds.has(id));
        if (nextTrackedIds.length === trackedIds.length) {
            return;
        }

        cacheTrackedCount(gameId, nextTrackedIds.length);
        cacheTrackedIds(gameId, nextTrackedIds);
        setLastKnownTrackedCount(nextTrackedIds.length);
        setTrackedIds(nextTrackedIds);

        const keptIds = new Set(nextTrackedIds.map(String));
        const nextNotes: TrackedNotes = {};
        for (const [key, value] of Object.entries(notesByAchievementId)) {
            if (keptIds.has(key)) {
                nextNotes[key] = value;
            }
        }
        const nextNotesColor: TrackedNotesColor = {};
        for (const [key, value] of Object.entries(notesColorByAchievementId)) {
            if (keptIds.has(key)) {
                nextNotesColor[key] = value;
            }
        }
        cacheTrackedNotes(gameId, nextNotes);
        cacheTrackedNotesColor(gameId, nextNotesColor);
        setNotesByAchievementId(nextNotes);
        setNotesColorByAchievementId(nextNotesColor);

        void bulkToggleTracked(
            gameId,
            nextTrackedIds,
            "set",
            payload?.title ?? null,
            payload?.consoleName ?? null,
            payload?.imageIcon ?? null,
        ).catch((e) => logError("bulkToggleTracked(validation)", e));
    }, [earnedAchievementIds, notesByAchievementId, notesColorByAchievementId, payload, trackedIds, trackedIdsLoadedForGameId]);

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

    const goToTracked = useCallback(async () => {
        if (!payload?.gameId) {
            return;
        }
        setRecentGamesExpanded(false);
        setReorderTargetId(null);
        setReorderViaSwap(false);
        setLastTrackedTab("thisGame");
        setTrackedSelectedGameId(null);
        void saveLastTrackedTab("thisGame").catch(() => {
        });
        setView("tracked");
        setPendingFocusKey("tracked:back");
    }, [payload?.gameId, setLastTrackedTab, setPendingFocusKey, setRecentGamesExpanded, setTrackedSelectedGameId, setView]);

    const backFromTracked = async () => {
        clearReorderSelection();
        goToAchievements("quick:tab:tracked");
    };

    const restorePendingFocusNextTick = useCallback((key: string) => {
        if (mountedRef.current) {
            window.setTimeout(() => {
                if (!mountedRef.current) {
                    return;
                }
                setPendingFocusKey(key);
            }, 0);
        }
    }, [mountedRef, setPendingFocusKey]);

    const applyCollapsedTags = useCallback((update: (previous: string[]) => string[]) => {
        const gameId = payload?.gameId;
        if (!gameId) {
            return;
        }
        setCollapsedTags((previous) => {
            const next = update(previous);
            if (next === previous) {
                return previous;
            }
            void saveTrackedCollapsedTags(gameId, next).catch((e) => {
                logError("saveTrackedCollapsedTags", e);
            });
            return next;
        });
    }, [payload?.gameId]);

    const onToggleCollapsedTag = useCallback((key: string) => {
        applyCollapsedTags((previous) => (previous.includes(key)
            ? previous.filter((entry) => entry !== key)
            : [...previous, key]));
    }, [applyCollapsedTags]);

    const expandCollapsedTag = useCallback((key: string) => {
        applyCollapsedTags((previous) => (previous.includes(key)
            ? previous.filter((entry) => entry !== key)
            : previous));
    }, [applyCollapsedTags]);

    const claimBackButton = useCallback(() => {
        setBackClaimToken((token) => token + 1);
    }, []);

    const restoreFocusAfterTrackedRemoval = useCallback(
        (removedAchievementId: number, currentTrackedAchievements: AchievementRow[]) => {
            const landing = trackedRemovalLanding(
                currentTrackedAchievements,
                notesByAchievementId,
                language,
                collapsedTagSet,
                removedAchievementId
            );

            if (landing.claimBack) {
                setBackClaimToken((token) => token + 1);
                restorePendingFocusNextTick(landing.focusKey);
                return;
            }

            restorePendingFocusNextTick(landing.focusKey);

            if (landing.claimSlot !== null) {
                rowClaim.claimSlot(landing.claimSlot);
            }
        },
        [notesByAchievementId, collapsedTagSet, language, restorePendingFocusNextTick, rowClaim.claimSlot]
    );

    const onSaveTrackedNote = useCallback(
        async (achievementId: number, note: string, color: NoteColor): Promise<OkResult> => {
            if (!payload?.gameId) {
                return { ok: false, error: "No current game loaded." };
            }
            try {
                const result = await saveTrackedNote(payload.gameId, achievementId, note, color);
                if (!mountedRef.current) {
                    return { ok: true };
                }
                if (!result?.ok) {
                    return { ok: false, error: "Couldn't save your note." };
                }
                const nextNotes = result.notes ?? {};
                const nextNotesColor = result.notesColor ?? {};
                cacheTrackedNotes(payload.gameId, nextNotes);
                cacheTrackedNotesColor(payload.gameId, nextNotesColor);
                setNotesByAchievementId(nextNotes);
                setNotesColorByAchievementId(nextNotesColor);
                return { ok: true };
            } catch (e: any) {
                logError("onSaveTrackedNote", e);
                return {
                    ok: false,
                    error: String(e?.message || e || "Couldn't save your note.")
                };
            }
        },
        [mountedRef, payload?.gameId]
    );

    const onTrackedSortChange = async (nextSort: TrackedAchievementSort) => {
        if (!payload?.gameId) {
            return;
        }
        const previousSort = sort;
        setSort(nextSort);
        try {
            const result = await saveTrackedSortForGame(payload.gameId, nextSort);
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
            logError("onTrackedSortChange", e);
            if (!mountedRef.current) {
                return;
            }
            setSort(previousSort);
        }
    };

    const onReorderSwap = useCallback(
        async (pressedId: number, allowSwap = true) => {
            if (!payload?.gameId) {
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
                    payload.gameId,
                    swapped,
                    "set",
                    payload.title ?? null,
                    payload.consoleName ?? null,
                    payload.imageIcon ?? null
                );
                if (!mountedRef.current) {
                    return;
                }
                applyTrackedResult(payload.gameId, result);
                if (result.sort) {
                    setSort(result.sort);
                }
                setReorderViaSwap(true);
                setReorderTargetId(movedId);
            } catch (e: any) {
                logError("onReorderSwap", e);
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
            payload?.consoleName,
            payload?.gameId,
            payload?.imageIcon,
            payload?.title,
            reorderInFlight,
            reorderTargetId,
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

    const onTrackedViewInfo = useCallback(
        async (achievement: AchievementRow) => {
            if (!payload?.gameId) {
                return;
            }
            clearReorderSelection();
            setError(null);
            if (legacyAchievementLinks) {
                await openExternalUrl(raAchievementUrl(achievement.id));
                return;
            }
            goToAchievementOverviewRef.current?.(achievement, payload.gameId, "tracked", null, null);
        },
        [goToAchievementOverviewRef, legacyAchievementLinks, payload?.gameId, setError]
    );

    const onTrackedEditNote = useCallback(
        (achievement: AchievementRow) => {
            if (!payload?.gameId) {
                return;
            }
            clearReorderSelection();
            setError(null);
            const currentNote = notesByAchievementId[String(achievement.id)] ?? "";
            const currentColor = notesColorByAchievementId[String(achievement.id)] ?? null;
            openNoteModal(payload.gameId, achievement, currentNote, currentColor, onSaveTrackedNote);
        },
        [
            notesByAchievementId,
            notesColorByAchievementId,
            onSaveTrackedNote,
            openNoteModal,
            payload?.gameId,
            setError
        ]
    );

    const onTrackedUntrack = useCallback(
        async (achievement: AchievementRow, currentTrackedAchievements: AchievementRow[]) => {
            if (!payload?.gameId) {
                return;
            }
            clearReorderSelection();
            setError(null);
            try {
                const result = await toggleTrackedAchievement(
                    payload.gameId,
                    achievement.id,
                    payload.title ?? null,
                    payload.consoleName ?? null,
                    payload.imageIcon ?? null
                );
                if (!mountedRef.current) {
                    return;
                }
                applyTrackedResult(payload.gameId, result);
                if (result.sort) {
                    setSort(result.sort);
                }
                restoreFocusAfterTrackedRemoval(achievement.id, currentTrackedAchievements);
            } catch (e: any) {
                logError("onTrackedUntrack", e);
                if (!mountedRef.current) {
                    return;
                }
                setError(String(e?.message || e || "Couldn't update tracked achievements."));
            }
        },
        [
            mountedRef,
            payload?.consoleName,
            payload?.gameId,
            payload?.imageIcon,
            payload?.title,
            restoreFocusAfterTrackedRemoval,
            setError
        ]
    );

    const onTrackedViewAchievementClick = useCallback(
        async (achievement: AchievementRow, currentTrackedAchievements: AchievementRow[]) => {
            const effectiveTrackedAction: TrackedAchievementAction = mouseKeyboardMode
                ? (showAButtonModeTracked ? trackedAchievementAction : "untrack")
                : "info";

            if (effectiveTrackedAction === "info") {
                await onTrackedViewInfo(achievement);
                return;
            }
            if (effectiveTrackedAction === "editNote") {
                onTrackedEditNote(achievement);
                return;
            }
            if (effectiveTrackedAction === "reorder") {
                setError(null);
                void onReorderSwap(achievement.id);
                return;
            }
            await onTrackedUntrack(achievement, currentTrackedAchievements);
        },
        [
            mouseKeyboardMode,
            showAButtonModeTracked,
            onReorderSwap,
            onTrackedEditNote,
            onTrackedUntrack,
            onTrackedViewInfo,
            setError,
            trackedAchievementAction
        ]
    );

    const visibleOrder = () => liveOrder(pendingOrderRef.current?.ids ?? null, trackedIds);

    const flushOrderWrite = async () => {
        const pending = pendingOrderRef.current;
        if (pending === null) {
            return;
        }
        setReorderInFlight(true);
        try {
            const result = await bulkToggleTracked(
                pending.gameId,
                pending.ids,
                "set",
                pending.title,
                pending.consoleName,
                pending.imageIcon
            );
            if (pendingOrderRef.current === pending) {
                pendingOrderRef.current = null;
            }
            if (!mountedRef.current) {
                return;
            }
            applyTrackedResult(pending.gameId, result);
            if (result.sort) {
                setSort(result.sort);
            }
        } catch (e: any) {
            logError("onReorderMove", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Couldn't reorder tracked achievements."));
        } finally {
            if (mountedRef.current) {
                setReorderInFlight(false);
            }
        }
    };

    const applyOrder = (gameId: number, next: number[]) => {
        const payloadNow = payloadRef.current;
        pendingOrderRef.current = {
            gameId,
            ids: next,
            title: payloadNow?.title ?? null,
            consoleName: payloadNow?.consoleName ?? null,
            imageIcon: payloadNow?.imageIcon ?? null
        };
        setTrackedIds(next);
        cacheTrackedIds(gameId, next);
        if (orderWriteTimerRef.current !== 0) {
            window.clearTimeout(orderWriteTimerRef.current);
        }
        orderWriteTimerRef.current = window.setTimeout(() => {
            orderWriteTimerRef.current = 0;
            void flushOrderWrite();
        }, ORDER_WRITE_SETTLE_MS);
    };

    useEffect(function writeAnyUnsettledOrderOnTheWayOut() {
        return () => {
            if (orderWriteTimerRef.current === 0) {
                return;
            }
            window.clearTimeout(orderWriteTimerRef.current);
            orderWriteTimerRef.current = 0;
            const pending = pendingOrderRef.current;
            if (pending === null) {
                return;
            }
            void bulkToggleTracked(
                pending.gameId,
                pending.ids,
                "set",
                pending.title,
                pending.consoleName,
                pending.imageIcon
            ).catch((e) => logError("bulkToggleTracked (on the way out)", e));
        };
    }, []);

    const onReorderMove = (direction: ReorderDirection, groupIds?: number[] | null) => {
        if (!payload?.gameId) {
            return;
        }
        if (sort !== "manual") {
            return;
        }
        if (reorderTargetId === null) {
            return;
        }

        const next = orderAfterGroupMove(
            visibleOrder(),
            groupIds ?? null,
            reorderTargetId,
            stepTo(direction)
        );
        if (next === null) {
            return;
        }

        setError(null);
        setReorderViaSwap(false);
        applyOrder(payload.gameId, next);
    };

    const onReorderToward = (landedAchievementId: number, groupIds?: number[] | null) => {
        if (!payload?.gameId || sort !== "manual" || reorderTargetId === null) {
            return;
        }
        if (landedAchievementId === reorderTargetId) {
            return;
        }

        const next = orderAfterGroupMove(
            visibleOrder(),
            groupIds ?? null,
            reorderTargetId,
            landOn(landedAchievementId)
        );
        if (next === null) {
            return;
        }

        setError(null);
        setReorderViaSwap(true);
        applyOrder(payload.gameId, next);
    };

    const refreshTotalTrackedCount = useCallback(async () => {
        try {
            const result = await getTotalTrackedCount();
            if (!mountedRef.current) {
                return;
            }
            setTotalTrackedCount(result.totalTrackedCount);
        } catch (e) {
            logError("refreshTotalTrackedCount", e);
        }
    }, [mountedRef]);

    const onClearTracked = useCallback(async (focusKeyAfter?: string) => {
        const restoredFocusKey = focusKeyAfter ?? "options:clear-tracked";

        if (!payload?.gameId) {
            return;
        }

        setError(null);
        try {
            const result = await clearTrackedAchievements(payload.gameId);
            if (!mountedRef.current) {
                return;
            }
            cacheTrackedCount(payload.gameId, 0);
            cacheTrackedIds(payload.gameId, []);
            cacheTrackedNotes(payload.gameId, {});
            cacheTrackedNotesColor(payload.gameId, {});
            setLastKnownTrackedCount(0);
            setTrackedIds([]);
            setNotesByAchievementId({});
            setNotesColorByAchievementId({});
            setCollapsedTags([]);
            setTotalTrackedCount(result.totalTrackedCount);
        } catch (e: any) {
            logError("onClearTracked", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Couldn't clear tracked achievements."));
        } finally {
            restorePendingFocusNextTick(restoredFocusKey);
        }
    }, [mountedRef, payload?.gameId, setError, restorePendingFocusNextTick]);

    const onAddAllMissable = useCallback(async () => {
        const restoredFocusKey = "tracked:tab:addAllMissable";

        if (!payload?.gameId) {
            return;
        }

        const trackedSet = new Set(trackedIds);
        const missableIdsToAdd: number[] = [];
        for (const achievement of payload.achievements ?? []) {
            if (!isMissable(achievement)) {
                continue;
            }
            if (earned(achievement)) {
                continue;
            }
            if (trackedSet.has(achievement.id)) {
                continue;
            }
            missableIdsToAdd.push(achievement.id);
        }

        setError(null);

        if (missableIdsToAdd.length === 0) {
            restorePendingFocusNextTick(restoredFocusKey);
            return;
        }

        try {
            const result = await bulkToggleTracked(
                payload.gameId,
                missableIdsToAdd,
                "track",
                payload.title ?? null,
                payload.consoleName ?? null,
                payload.imageIcon ?? null,
            );
            if (!mountedRef.current) {
                return;
            }
            applyTrackedResult(payload.gameId, result);
            if (result.sort) {
                setSort(result.sort);
            }
            expandCollapsedTag(TRACKED_UNTAGGED_COLLAPSE_KEY);
            setTotalTrackedCount((current) => (current === null ? null : current + result.changed));
        } catch (e: any) {
            logError("onAddAllMissable", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Couldn't add missable achievements."));
        } finally {
            restorePendingFocusNextTick(restoredFocusKey);
        }
    }, [mountedRef, payload, trackedIds, setError, restorePendingFocusNextTick, expandCollapsedTag]);

    const onClearTrackedForGame = useCallback(
        async (targetGameId: number, focusKeyAfter?: string) => {
            const restoredFocusKey = focusKeyAfter ?? "tracked:clear:this-game";

            if (!targetGameId) {
                return;
            }

            setError(null);
            try {
                const result = await clearTrackedAchievements(targetGameId);
                if (!mountedRef.current) {
                    return;
                }
                cacheTrackedCount(targetGameId, 0);
                cacheTrackedIds(targetGameId, []);
                cacheTrackedNotes(targetGameId, {});
                cacheTrackedNotesColor(targetGameId, {});
                if (payload?.gameId === targetGameId) {
                    setLastKnownTrackedCount(0);
                    setTrackedIds([]);
                    setNotesByAchievementId({});
                    setNotesColorByAchievementId({});
                    setCollapsedTags([]);
                }
                setTotalTrackedCount(result.totalTrackedCount);
            } catch (e: any) {
                logError("onClearTrackedForGame", e);
                if (!mountedRef.current) {
                    return;
                }
                setError(String(e?.message || e || "Couldn't clear tracked achievements."));
            } finally {
                restorePendingFocusNextTick(restoredFocusKey);
            }
        },
        [mountedRef, payload?.gameId, setError, restorePendingFocusNextTick]
    );

    const onClearAllTracked = useCallback(async (focusKeyAfter?: string) => {
        const restoredFocusKey = focusKeyAfter ?? "options:clear-all-tracked";

        setError(null);
        try {
            const result = await clearAllTrackedAchievements();
            if (!mountedRef.current) {
                return;
            }
            clearTrackedCountMemoryCache();
            setLastKnownTrackedCount(0);
            setTrackedIds([]);
            setNotesByAchievementId({});
            setNotesColorByAchievementId({});
            setCollapsedTags([]);
            setTotalTrackedCount(result.totalTrackedCount);
        } catch (e: any) {
            logError("onClearAllTracked", e);
            if (!mountedRef.current) {
                return;
            }
            setError(String(e?.message || e || "Couldn't clear tracked achievements for all games."));
        } finally {
            restorePendingFocusNextTick(restoredFocusKey);
        }
    }, [mountedRef, setError, restorePendingFocusNextTick]);

    return {
        state: {
            trackedValidating,
            trackedIds,
            trackedIdsLoadedForGameId,
            trackedAchievements,
            notesByAchievementId,
            notesColorByAchievementId,
            lastKnownTrackedCount,
            totalTrackedCount,
            sort,
            collapsedTags,
            reorderTargetId,
            reorderViaSwap,
            backClaimToken,
            rowClaim
        },
        actions: {
            setTrackedValidating,
            setTrackedIds,
            setTrackedIdsLoadedForGameId,
            setLastKnownTrackedCount,
            setNotesByAchievementId,
            setNotesColorByAchievementId,
            goToTracked,
            backFromTracked,
            saveTrackedAchievementActionWithRollback,
            onTrackedViewAchievementClick,
            onTrackedUntrack,
            onTrackedEditNote,
            onReorderSwap,
            onToggleCollapsedTag,
            claimBackButton,
            onSaveTrackedNote,
            onTrackedSortChange,
            onClearTracked,
            onClearTrackedForGame,
            onClearAllTracked,
            onAddAllMissable,
            refreshTotalTrackedCount,
            onReorderMove,
            onReorderToward
        }
    };
}
