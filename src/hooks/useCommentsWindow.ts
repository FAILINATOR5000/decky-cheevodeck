import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { CommentSurfaceKey, GameComment } from "../types";
import { logCommentsDebug } from "../api";
import { currentJumpToTopToken, subscribeJumpToTop } from "../utils/jumpToTop";

const WINDOW_INITIAL_ROWS = 12;
const WINDOW_ROW_STEP = 8;
const WINDOW_PREFETCH_DISTANCE = 3;

const PAGE_PREFETCH_DISTANCE = 3;

const UP_MARKER_ROOT_MARGIN = "0px";

export type RestoredCommentsWindow = {
    start: number;
    spacerPx: number;
};

export interface CommentsWindowOptions {
    comments: GameComment[];
    dynamicLoading: boolean;
    sentinelRootMargin: number;
    surfaceKey: CommentSurfaceKey;
    focusKeyPrefix: string;
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    onLoadMore: () => void | Promise<void>;
    restoredWindow: RestoredCommentsWindow | null;
    claimedSlotIndex: number | null;
}

export interface CommentsWindow {
    mountedComments: GameComment[];
    windowStart: number;
    spacerPx: number;
    spacerRef: MutableRefObject<HTMLDivElement | null>;
    setUpMarker: (element: HTMLDivElement | null) => void;
    setDownMarker: (element: HTMLDivElement | null) => void;
    setPageMarker: (element: HTMLDivElement | null) => void;
    showUpMarker: boolean;
    showDownMarker: boolean;
    showPageMarker: boolean;
    onCardFocus: (index: number) => void;
}

function useMarkerObserver(
    element: HTMLDivElement | null,
    active: boolean,
    rootMargin: string,
    onHit: () => void
): void {
    const hitRef = useRef(onHit);
    hitRef.current = onHit;

    useEffect(() => {
        if (!active || !element) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    hitRef.current();
                }
            },
            { root: null, rootMargin, threshold: 0 }
        );
        observer.observe(element);
        return () => {
            observer.disconnect();
        };
    }, [element, active, rootMargin]);
}

export function useCommentsWindow(options: CommentsWindowOptions): CommentsWindow {
    const {
        comments,
        dynamicLoading,
        sentinelRootMargin,
        surfaceKey,
        focusKeyPrefix,
        loading,
        loadingMore,
        hasMore,
        onLoadMore,
        restoredWindow,
        claimedSlotIndex
    } = options;

    const [range, setRange] = useState({ start: 0, end: WINDOW_INITIAL_ROWS });
    const [spacerPx, setSpacerPx] = useState(0);
    const spacerRef = useRef<HTMLDivElement | null>(null);

    const [upMarkerEl, setUpMarker] = useState<HTMLDivElement | null>(null);
    const [downMarkerEl, setDownMarker] = useState<HTMLDivElement | null>(null);
    const [pageMarkerEl, setPageMarker] = useState<HTMLDivElement | null>(null);

    const countRef = useRef(comments.length);
    countRef.current = comments.length;
    const onLoadMoreRef = useRef(onLoadMore);
    onLoadMoreRef.current = onLoadMore;

    const rangeRef = useRef(range);
    rangeRef.current = range;
    const growthPendingRef = useRef(false);
    useEffect(function clearGrowthPending() {
        growthPendingRef.current = false;
    }, [range]);

    const growDown = useCallback(function growDown() {
        if (growthPendingRef.current || rangeRef.current.end >= countRef.current) {
            return;
        }
        growthPendingRef.current = true;
        setRange(function extendEnd(current) {
            return { start: current.start, end: Math.min(countRef.current, current.end + WINDOW_ROW_STEP) };
        });
    }, []);

    const growUp = useCallback(function growUp() {
        if (growthPendingRef.current || rangeRef.current.start <= 0) {
            return;
        }
        growthPendingRef.current = true;
        setRange(function extendStart(current) {
            return { start: Math.max(0, current.start - WINDOW_ROW_STEP), end: current.end };
        });
    }, []);

    const [jumpToken, setJumpToken] = useState(currentJumpToTopToken);
    const jumpTokenAtMountRef = useRef(jumpToken);
    useEffect(function watchForJumpToTop() {
        return subscribeJumpToTop(setJumpToken);
    }, []);
    useEffect(function collapseOnJumpToTop() {
        if (jumpToken === jumpTokenAtMountRef.current) {
            return;
        }
        if (rangeRef.current.start <= 0) {
            return;
        }
        logCommentsDebug("window-collapse", surfaceKey, `start=${rangeRef.current.start} to 0 on jump`);
        setRange({ start: 0, end: WINDOW_INITIAL_ROWS });
        setSpacerPx(0);
    }, [jumpToken, surfaceKey]);

    useEffect(function collapseOnEmptyThread() {
        if (comments.length > 0) {
            return;
        }
        setRange({ start: 0, end: WINDOW_INITIAL_ROWS });
        setSpacerPx(0);
    }, [comments.length]);

    useEffect(function openRestoredWindow() {
        if (!restoredWindow) {
            return;
        }
        logCommentsDebug(
            "window-restore",
            surfaceKey,
            `start=${restoredWindow.start} spacer=${restoredWindow.spacerPx}px`
        );
        setRange({ start: restoredWindow.start, end: restoredWindow.start + WINDOW_INITIAL_ROWS });
        setSpacerPx(restoredWindow.spacerPx);
    }, [restoredWindow, surfaceKey]);

    useEffect(function keepTheClaimMounted() {
        if (claimedSlotIndex == null) {
            return;
        }
        setRange(function includeClaim(current) {
            if (claimedSlotIndex >= current.start && claimedSlotIndex < current.end) {
                return current;
            }
            if (claimedSlotIndex < current.start) {
                return { start: Math.max(0, claimedSlotIndex - WINDOW_PREFETCH_DISTANCE), end: current.end };
            }
            return { start: current.start, end: claimedSlotIndex + 1 + WINDOW_PREFETCH_DISTANCE };
        });
    }, [claimedSlotIndex]);

    useEffect(function clampToThread() {
        if (comments.length === 0) {
            return;
        }
        setRange(function clamp(current) {
            const end = Math.min(current.end, comments.length);
            const start = Math.min(current.start, Math.max(0, end - 1));
            if (start === current.start && end === current.end) {
                return current;
            }
            return { start, end };
        });
    }, [comments.length]);

    const previousStartRef = useRef(range.start);
    useLayoutEffect(function anchorAfterGrowingUp() {
        const previousStart = previousStartRef.current;
        previousStartRef.current = range.start;
        if (range.start >= previousStart) {
            return;
        }
        const container = spacerRef.current?.parentElement;
        if (!container) {
            return;
        }
        const nowFirst = container.querySelector(`[data-focus-key="${focusKeyPrefix}:${range.start}"]`);
        const wasFirst = container.querySelector(`[data-focus-key="${focusKeyPrefix}:${previousStart}"]`);
        if (!nowFirst || !wasFirst) {
            return;
        }
        const grewBy = wasFirst.getBoundingClientRect().top - nowFirst.getBoundingClientRect().top;
        if (grewBy <= 0) {
            return;
        }
        setSpacerPx(function shrink(current) {
            return Math.max(0, Math.round(current - grewBy));
        });
    }, [range.start, focusKeyPrefix]);

    const windowStart = dynamicLoading ? range.start : 0;
    const windowEnd = dynamicLoading ? Math.min(range.end, comments.length) : comments.length;
    const mountedComments = comments.slice(windowStart, windowEnd);

    const windowFull = windowEnd >= comments.length;
    const showUpMarker = dynamicLoading && windowStart > 0;
    const showDownMarker = dynamicLoading && !windowFull;
    const showPageMarker = dynamicLoading && hasMore && !loading && windowFull;

    const focusStateRef = useRef({ windowStart, windowEnd, dynamicLoading, hasMore, loading, loadingMore, count: comments.length });
    focusStateRef.current = { windowStart, windowEnd, dynamicLoading, hasMore, loading, loadingMore, count: comments.length };

    const onCardFocus = useCallback(function onCardFocus(index: number) {
        const state = focusStateRef.current;
        if (!state.dynamicLoading) {
            return;
        }
        if (state.windowStart > 0 && index <= state.windowStart + WINDOW_PREFETCH_DISTANCE) {
            growUp();
        }
        if (index >= state.windowEnd - WINDOW_PREFETCH_DISTANCE) {
            growDown();
        }
        if (!state.hasMore) {
            return;
        }
        if (state.loading || state.loadingMore) {
            return;
        }
        if (index < state.count - PAGE_PREFETCH_DISTANCE) {
            return;
        }
        void onLoadMoreRef.current();
    }, [growUp, growDown]);

    useMarkerObserver(upMarkerEl, showUpMarker, UP_MARKER_ROOT_MARGIN, growUp);
    useMarkerObserver(downMarkerEl, showDownMarker, `${Math.max(0, sentinelRootMargin)}px 0px`, growDown);

    useMarkerObserver(pageMarkerEl, showPageMarker, `${Math.max(0, sentinelRootMargin)}px 0px`, function askForAnotherPage() {
        logCommentsDebug("sentinel-fire", surfaceKey, `window ${windowStart}-${windowEnd} of ${countRef.current}`);
        void onLoadMoreRef.current();
    });

    return {
        mountedComments,
        windowStart,
        spacerPx: dynamicLoading ? spacerPx : 0,
        spacerRef,
        setUpMarker,
        setDownMarker,
        setPageMarker,
        showUpMarker,
        showDownMarker,
        showPageMarker,
        onCardFocus
    };
}
