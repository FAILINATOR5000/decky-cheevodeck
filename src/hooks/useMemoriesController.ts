import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    deleteMemory,
    loadMemories,
    loadMemoryGames,
    loadMemoryThumbs,
    loadMemoryViewPrefs,
    saveMemoryViewPrefs
} from "../api";
import { logError } from "../utils/errors";
import { requestJumpToTop } from "../utils/jumpToTop";
import {
    ALL_GAMES_ID,
    MISC_GAME_ID,
    REVEAL_DEADLINE_MS,
    REVEAL_PER_FRAME,
    THUMB_CHUNK_SIZE,
    memoryMatchesColor,
    memoryMatchesMedia,
    memoryMatchesTag,
    pageCount,
    sortMemories
} from "../utils/memories";
import { orderedTagsByRecency } from "../utils/tags";
import type {
    MemoryDateOrder,
    MemoryGameRow,
    MemoryRecord,
    MemoryTagRow,
    MemoryTagSort
} from "../types";

export type UseMemoriesControllerOptions = {
    isActive: boolean;
    payloadGameId: number | null;
    perPage: number;
    payloadGameTitle: string;
    payloadConsoleName: string;
    payloadImageIcon: string;
    activeUlid: string;
};

export function useMemoriesController(options: UseMemoriesControllerOptions) {
    const { isActive, payloadGameId, payloadGameTitle, payloadConsoleName, payloadImageIcon, perPage, activeUlid } = options;

    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(false);
    const [games, setGames] = useState<MemoryGameRow[]>([]);
    const [memories, setMemories] = useState<MemoryRecord[]>([]);

    const [gameId, setGameId] = useState<number | null>(null);
    const [tagFilter, setTagFilter] = useState("");
    const [colorFilter, setColorFilter] = useState("");
    const [mediaFilter, setMediaFilter] = useState("");
    const [gridColumns, setGridColumns] = useState(2);
    const [dateOrder, setDateOrder] = useState<MemoryDateOrder>("desc");
    const [tagSort, setTagSort] = useState<MemoryTagSort>("recent");
    const [pageIndex, setPageIndex] = useState(0);

    const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
    const [coldPaths, setColdPaths] = useState<Set<string>>(new Set());

    const [focusedMemoryId, setFocusedMemoryId] = useState<string | null>(null);
    const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
    const [loadedForGameId, setLoadedForGameId] = useState<number | null>(null);
    const [indexLoaded, setIndexLoaded] = useState(false);

    const memoriesRef = useRef<MemoryRecord[]>([]);
    memoriesRef.current = memories;

    const thumbsRef = useRef<Record<string, string | null>>({});

    const seededForRef = useRef<number | null>(null);
    const persistedPageRef = useRef(0);
    const prefsLoadedForRef = useRef<string | null>(null);
    const indexLoadedForRef = useRef<string | null>(null);
    const accountRef = useRef(activeUlid);
    const loadRunIdRef = useRef(0);
    const thumbRunIdRef = useRef(0);

    useEffect(() => {
        accountRef.current = activeUlid;
        seededForRef.current = null;
        thumbsRef.current = {};
        setReady(false);
        setGames([]);
        setIndexLoaded(false);
        setMemories([]);
        setLoadedForGameId(null);
        setThumbs({});
        setColdPaths(new Set());
        setFocusedMemoryId(null);
        setArmedDeleteId(null);
        setPageIndex(0);
    }, [activeUlid]);

    useEffect(() => {
        if (!isActive || prefsLoadedForRef.current === activeUlid) {
            return;
        }
        prefsLoadedForRef.current = activeUlid;
        void (async () => {
            try {
                const prefs = await loadMemoryViewPrefs();
                if (accountRef.current !== activeUlid) {
                    return;
                }
                setGridColumns(prefs.gridColumns);
                setDateOrder(prefs.dateOrder);
                setTagSort(prefs.tagSort);
                setTagFilter(prefs.lastTagFilter);
                setColorFilter(prefs.lastColorFilter);
                setMediaFilter(prefs.lastMediaFilter);
                setGameId(prefs.lastGameId);
                setPageIndex(prefs.lastPageIndex);
                persistedPageRef.current = prefs.lastPageIndex;
                seededForRef.current = prefs.seededForGameId;
            } catch (error) {
                logError("memories: couldn't read the view preferences", error);
            }
            if (accountRef.current === activeUlid) {
                setReady(true);
            }
        })();
    }, [isActive, activeUlid]);

    const refreshIndexes = useCallback(async () => {
        const forAccount = accountRef.current;
        try {
            const gameList = await loadMemoryGames();
            if (accountRef.current !== forAccount) {
                return [];
            }
            setGames(gameList.games || []);
            return gameList.games || [];
        } catch (error) {
            logError("memories: couldn't read the game index", error);
            return [];
        }
    }, []);

    useEffect(() => {
        if (indexLoadedForRef.current === activeUlid) {
            return;
        }
        indexLoadedForRef.current = activeUlid;
        void (async () => {
            await refreshIndexes();
            if (accountRef.current === activeUlid) {
                setIndexLoaded(true);
            }
        })();
    }, [refreshIndexes, activeUlid]);

    useEffect(() => {
        if (!isActive || !ready) {
            return;
        }
        if (payloadGameId === null) {
            return;
        }
        if (payloadGameId === seededForRef.current) {
            return;
        }
        seededForRef.current = payloadGameId;
        setPageIndex(0);
        setGameId(payloadGameId);
        setTagFilter("");
        setColorFilter("");
        setMediaFilter("");
        void saveMemoryViewPrefs(
            null,
            null,
            payloadGameId,
            payloadGameId,
            "",
            "",
            "",
            null,
            0
        ).catch((error) => logError("memories: couldn't save the seed", error));
    }, [isActive, ready, payloadGameId]);

    const listedGames = useMemo(() => {
        const extra: MemoryGameRow[] = [];
        if (payloadGameId !== null && !games.some((row) => row.gameId === payloadGameId)) {
            extra.push({
                gameId: payloadGameId,
                gameTitle: payloadGameTitle,
                consoleName: payloadConsoleName,
                imageIcon: payloadImageIcon,
                count: 0
            });
        }
        if (extra.length === 0) {
            return games;
        }
        const next = [...games, ...extra];
        next.sort((left, right) => {
            if ((left.gameId === MISC_GAME_ID) !== (right.gameId === MISC_GAME_ID)) {
                return left.gameId === MISC_GAME_ID ? 1 : -1;
            }
            return left.gameTitle.toLowerCase().localeCompare(right.gameTitle.toLowerCase());
        });
        return next;
    }, [games, payloadGameId, payloadGameTitle, payloadConsoleName, payloadImageIcon]);

    const effectiveGameId = useMemo(() => {
        if (!ready) {
            return null;
        }
        if (gameId === ALL_GAMES_ID) {
            return ALL_GAMES_ID;
        }
        if (gameId !== null && listedGames.some((row) => row.gameId === gameId)) {
            return gameId;
        }
        return listedGames.length > 0 ? listedGames[0].gameId : null;
    }, [ready, gameId, listedGames]);

    const loadForGame = useCallback(async (target: number | null) => {
        const forAccount = accountRef.current;
        const runId = loadRunIdRef.current + 1;
        loadRunIdRef.current = runId;
        if (target === null) {
            setMemories([]);
            setLoadedForGameId(null);
            return;
        }
        setLoading(true);
        try {
            const result = await loadMemories(target);
            if (loadRunIdRef.current !== runId || accountRef.current !== forAccount) {
                return;
            }
            setMemories(result.memories || []);
            setLoadedForGameId(target);
        } catch (error) {
            if (loadRunIdRef.current === runId) {
                setMemories([]);
                setLoadedForGameId(target);
                logError("memories: couldn't read the memories for a game", error);
            }
        }
        if (loadRunIdRef.current === runId) {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isActive || !ready) {
            return;
        }
        void loadForGame(effectiveGameId);
    }, [isActive, ready, effectiveGameId, loadForGame]);

    const visible = useMemo(
        () => sortMemories(
            memories.filter((memory) => (
                memoryMatchesTag(memory, tagFilter)
                && memoryMatchesColor(memory, colorFilter)
                && memoryMatchesMedia(memory, mediaFilter)
            )),
            dateOrder
        ),
        [memories, tagFilter, colorFilter, mediaFilter, dateOrder]
    );

    const totalPages = pageCount(visible.length, perPage);
    const safePageIndex = Math.min(pageIndex, totalPages - 1);

    const pageMemories = useMemo(
        () => visible.slice(safePageIndex * perPage, safePageIndex * perPage + perPage),
        [visible, safePageIndex, perPage]
    );

    useEffect(() => {
        if (!isActive || pageMemories.length === 0) {
            return;
        }
        const runId = thumbRunIdRef.current + 1;
        thumbRunIdRef.current = runId;
        const forAccount = accountRef.current;
        const wanted = pageMemories.map((memory) => ({ gameId: memory.gameId, path: memory.path }));

        const keep = new Set(wanted.map((item) => item.path));
        const pruned: Record<string, string | null> = {};
        for (const path of Object.keys(thumbsRef.current)) {
            if (keep.has(path)) {
                pruned[path] = thumbsRef.current[path];
            }
        }
        thumbsRef.current = pruned;
        setThumbs(pruned);
        setColdPaths(new Set());

        const missing = wanted.filter((item) => !pruned[item.path]);
        if (missing.length === 0) {
            return;
        }

        const queue: Array<{ path: string; dataUri: string | null }> = [];
        let draining = false;
        let frame = 0;
        let cancelled = false;

        function commit(taken: Array<{ path: string; dataUri: string | null }>) {
            const fresh = new Set<string>();
            const next = { ...thumbsRef.current };
            for (const item of taken) {
                if (item.dataUri && thumbsRef.current[item.path] !== item.dataUri) {
                    fresh.add(item.path);
                }
                next[item.path] = item.dataUri;
            }
            thumbsRef.current = next;
            setThumbs(next);
            if (fresh.size > 0) {
                setColdPaths((current) => new Set([...current, ...fresh]));
            }
        }

        let watchdog = 0;

        function stopWatchdog() {
            if (watchdog) {
                window.clearTimeout(watchdog);
                watchdog = 0;
            }
        }

        function flush() {
            const taken = queue.splice(0, queue.length);
            if (taken.length > 0) {
                commit(taken);
            }
        }

        function step() {
            if (cancelled) {
                return;
            }
            const taken = queue.splice(0, REVEAL_PER_FRAME);
            if (taken.length > 0) {
                commit(taken);
            }
            if (queue.length > 0) {
                frame = requestAnimationFrame(step);
                return;
            }
            draining = false;
            stopWatchdog();
        }

        function drain() {
            if (cancelled || draining || queue.length === 0) {
                return;
            }
            draining = true;
            watchdog = window.setTimeout(() => {
                if (cancelled) {
                    return;
                }
                cancelAnimationFrame(frame);
                draining = false;
                watchdog = 0;
                flush();
            }, REVEAL_DEADLINE_MS);
            frame = requestAnimationFrame(step);
        }

        void (async () => {
            for (let start = 0; start < missing.length; start += THUMB_CHUNK_SIZE) {
                const chunk = missing.slice(start, start + THUMB_CHUNK_SIZE);
                try {
                    const result = await loadMemoryThumbs(chunk);
                    if (cancelled || thumbRunIdRef.current !== runId || accountRef.current !== forAccount) {
                        return;
                    }
                    for (const item of chunk) {
                        queue.push({ path: item.path, dataUri: result.thumbs?.[item.path] ?? null });
                    }
                    drain();
                } catch (error) {
                    if (thumbRunIdRef.current !== runId) {
                        return;
                    }
                    logError("memories: couldn't read a chunk of thumbnails", error);
                }
            }
        })();

        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
            stopWatchdog();
            queue.length = 0;
        };
    }, [isActive, pageMemories]);


    useEffect(() => {
        if (isActive) {
            return;
        }
        thumbsRef.current = {};
        setThumbs({});
        setColdPaths(new Set());
        setArmedDeleteId(null);
        setFocusedMemoryId(null);
    }, [isActive]);

    const persist = useCallback((
        columns: number | null,
        order: MemoryDateOrder | null,
        lastGameId: number | null,
        lastTag: string | null,
        lastColor: string | null,
        lastMedia: string | null,
        sort: MemoryTagSort | null,
        page: number | null
    ) => {
        void saveMemoryViewPrefs(columns, order, lastGameId, null, lastTag, lastColor, lastMedia, sort, page)
            .catch((error) => logError("memories: couldn't save the view preferences", error));
    }, []);

    const wasActiveRef = useRef(false);
    useEffect(function forgetPageOnLeave() {
        if (isActive) {
            wasActiveRef.current = true;
            return;
        }
        if (!wasActiveRef.current) {
            return;
        }
        wasActiveRef.current = false;
        setPageIndex(0);
        persistedPageRef.current = 0;
        persist(null, null, null, null, null, null, null, 0);
    }, [isActive, persist]);

    useEffect(function rememberPage() {
        if (!isActive || !ready) {
            return;
        }
        if (persistedPageRef.current === pageIndex) {
            return;
        }
        persistedPageRef.current = pageIndex;
        persist(null, null, null, null, null, null, null, pageIndex);
    }, [isActive, ready, pageIndex, persist]);

    const selectGame = useCallback((next: number | null) => {
        setGameId(next);
        setPageIndex(0);
        setArmedDeleteId(null);
        persist(null, null, next, null, null, null, null, null);
    }, [persist]);

    const selectTag = useCallback((next: string) => {
        setTagFilter(next);
        setPageIndex(0);
        setArmedDeleteId(null);
        persist(null, null, null, next, null, null, null, null);
    }, [persist]);

    const selectColor = useCallback((next: string) => {
        setColorFilter(next);
        setPageIndex(0);
        setArmedDeleteId(null);
        persist(null, null, null, null, next, null, null, null);
    }, [persist]);

    const selectMedia = useCallback((next: string) => {
        setMediaFilter(next);
        setPageIndex(0);
        setArmedDeleteId(null);
        persist(null, null, null, null, null, next, null, null);
    }, [persist]);

    const selectColumns = useCallback((next: number) => {
        setGridColumns(next);
        setPageIndex(0);
        persist(next, null, null, null, null, null, null, null);
    }, [persist]);

    const toggleDateOrder = useCallback(() => {
        const next: MemoryDateOrder = dateOrder === "desc" ? "asc" : "desc";
        setDateOrder(next);
        setPageIndex(0);
        persist(null, next, null, null, null, null, null, null);
    }, [dateOrder, persist]);

    const selectTagSort = useCallback((next: MemoryTagSort) => {
        setTagSort(next);
        persist(null, null, null, null, null, null, next, null);
    }, [persist]);

    const firstIdOnPage = useCallback((index: number) => (
        visible[index * perPage]?.id ?? null
    ), [visible, perPage]);

    const lastIdOnPage = useCallback((index: number) => {
        const page = visible.slice(index * perPage, index * perPage + perPage);
        return page.length > 0 ? page[page.length - 1].id : null;
    }, [visible, perPage]);

    const turnPage = useCallback((delta: number) => {
        setArmedDeleteId(null);
        setPageIndex((current) => {
            const from = Math.min(current, totalPages - 1);
            const next = from + delta;
            if (next < 0 || next >= totalPages) {
                return from;
            }
            return next;
        });
    }, [totalPages]);

    const armDelete = useCallback((memoryId: string) => {
        setArmedDeleteId((current) => (current === memoryId ? current : memoryId));
    }, []);

    const blurMemory = useCallback((memoryId: string) => {
        setFocusedMemoryId((current) => (current === memoryId ? null : current));
        setArmedDeleteId((current) => (current === memoryId ? null : current));
    }, []);

    const removeMemory = useCallback(async (memoryId: string) => {
        const target = memoriesRef.current.find((memory) => memory.id === memoryId);
        if (!target) {
            return;
        }
        setArmedDeleteId(null);
        setFocusedMemoryId(null);
        if (memoriesRef.current.filter((memory) => memory.id !== memoryId).length === 0) {
            requestJumpToTop();
        }
        setMemories((current) => current.filter((memory) => memory.id !== memoryId));
        try {
            await deleteMemory(target.gameId, memoryId);
        } catch (error) {
            logError("memories: couldn't delete a memory", error);
        }
        await refreshIndexes();
        await loadForGame(effectiveGameId);
    }, [effectiveGameId, refreshIndexes, loadForGame]);

    const refresh = useCallback(async () => {
        await refreshIndexes();
        await loadForGame(effectiveGameId);
    }, [refreshIndexes, loadForGame, effectiveGameId]);

    const sortedTags = useMemo(() => {
        const counts = new Map<string, number>();
        const lastUsed = new Map<string, number>();
        for (const memory of memories) {
            const tag = memory.tag;
            if (!tag) {
                continue;
            }
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
            lastUsed.set(tag, Math.max(lastUsed.get(tag) ?? 0, memory.capturedAt));
        }
        const rows: MemoryTagRow[] = [...counts].map(([tag, count]) => ({
            tag,
            count,
            lastUsed: lastUsed.get(tag) ?? 0
        }));
        if (tagSort === "alpha") {
            rows.sort((left, right) => left.tag.localeCompare(right.tag));
        } else {
            rows.sort((left, right) => right.lastUsed - left.lastUsed);
        }
        return rows;
    }, [tagSort, memories]);

    const allTags = useMemo(
        () => orderedTagsByRecency(
            memories.map((memory) => ({ tag: memory.tag, at: memory.updatedAt }))
        ),
        [memories]
    );

    return {
        state: {
            ready,
            loading,
            games: listedGames,
            indexedGameCount: games.length,
            tags: sortedTags,
            allTags,
            memories,
            visibleCount: visible.length,
            pageMemories,
            gameId: effectiveGameId,
            loadedGameId: payloadGameId,
            tagFilter,
            colorFilter,
            mediaFilter,
            gridColumns,
            dateOrder,
            tagSort,
            pageIndex: safePageIndex,
            perPage,
            totalPages,
            loadedForGameId,
            indexLoaded,
            thumbs,
            coldPaths,
            focusedMemoryId,
            armedDeleteId
        },
        actions: {
            selectGame,
            selectTag,
            selectColor,
            selectMedia,
            selectColumns,
            selectTagSort,
            toggleDateOrder,
            turnPage,
            armDelete,
            blurMemory,
            removeMemory,
            refresh,
            firstIdOnPage,
            lastIdOnPage,
            setFocusedMemoryId
        }
    };
}

export type MemoriesControllerState = ReturnType<typeof useMemoriesController>["state"];
export type MemoriesControllerActions = ReturnType<typeof useMemoriesController>["actions"];
