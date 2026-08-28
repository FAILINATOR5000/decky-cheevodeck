import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface WindowedListOptions<T> {
    items: T[];
    dynamicLoading: boolean;
    initialRows: number;
    rowStep: number;
    prefetchDistance: number;
    sentinelRootMargin: string;
    resetKey: string;
}

export interface WindowedList<T> {
    mountedItems: T[];
    markerRef: MutableRefObject<HTMLDivElement | null>;
    onItemFocus: (index: number) => void;
}

export function useWindowedList<T>(options: WindowedListOptions<T>): WindowedList<T> {
    const { items, dynamicLoading, initialRows, rowStep, prefetchDistance, sentinelRootMargin, resetKey } = options;

    const markerRef = useRef<HTMLDivElement | null>(null);

    const [mountedCount, setMountedCount] = useState(function getInitialMountedCount() {
        if (!dynamicLoading) {
            return items.length;
        }

        return Math.min(initialRows, items.length);
    });

    useEffect(function resetMountedRows() {
        if (!dynamicLoading) {
            setMountedCount(items.length);
            return;
        }

        setMountedCount(Math.min(initialRows, items.length));
    }, [resetKey, initialRows, dynamicLoading]);

    useEffect(function clampMountedRows() {
        if (!dynamicLoading) {
            setMountedCount(items.length);
            return;
        }

        setMountedCount(function clampMountedCount(current) {
            if (items.length === 0) {
                return 0;
            }
            if (current === 0) {
                return Math.min(initialRows, items.length);
            }
            if (current > items.length) {
                return items.length;
            }
            return current;
        });
    }, [items.length, initialRows, dynamicLoading]);

    const growthPendingRef = useRef(false);

    const loadMore = useCallback(function loadMore() {
        if (!dynamicLoading) {
            return;
        }

        if (growthPendingRef.current) {
            return;
        }

        if (mountedCount >= items.length) {
            return;
        }

        growthPendingRef.current = true;
        setMountedCount(function updateMountedCount(current) {
            if (current >= items.length) {
                return current;
            }

            return Math.min(current + rowStep, items.length);
        });
    }, [mountedCount, items.length, dynamicLoading, rowStep]);

    useEffect(function clearGrowthPending() {
        growthPendingRef.current = false;
    }, [mountedCount]);

    useEffect(function watchLoadMoreMarker() {
        if (!dynamicLoading) {
            return;
        }

        if (mountedCount >= items.length) {
            return;
        }

        const marker = markerRef.current;
        if (!marker) {
            return;
        }

        const observer = new IntersectionObserver(
            function onIntersect(entries) {
                const firstEntry = entries[0];

                if (!firstEntry?.isIntersecting) {
                    return;
                }

                loadMore();
            },
            {
                root: null,
                rootMargin: sentinelRootMargin,
                threshold: 0
            }
        );

        observer.observe(marker);

        return function cleanup() {
            observer.disconnect();
        };
    }, [mountedCount, items.length, loadMore, dynamicLoading, sentinelRootMargin]);

    const mountedItems = useMemo(() => {
        if (!dynamicLoading) {
            return items;
        }

        return items.slice(0, mountedCount);
    }, [items, mountedCount, dynamicLoading]);

    function onItemFocus(index: number) {
        if (!dynamicLoading) {
            return;
        }

        if (index < mountedCount - prefetchDistance) {
            return;
        }

        loadMore();
    }

    return { mountedItems, markerRef, onItemFocus };
}
