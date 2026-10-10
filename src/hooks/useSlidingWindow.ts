import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { logFocusDebug } from "../api";
import { currentJumpToTopToken, subscribeJumpToTop } from "../utils/jumpToTop";

const WINDOW_MAX_ROWS = 55;
const EVICT_LEAD = 20;
const OPEN_LEAD = 20;
const OPEN_TRAIL = 20;
const MAX_PREFETCH = 8;

const REST_MS = 200;
const REBASE_VERIFY_MS = 500;
const SPACER_FRAMES_BEFORE_REOPEN = 3;
const FOCUS_SCROLL_GRACE_MS = 600;

const DIR_UP = 9;

type HeightCache = { heights: Map<string, number>; total: number };

const heightCaches = new Map<string, HeightCache>();
const lastWidthByWindow = new Map<string, number>();

function cacheFor(scope: string): HeightCache {
    let cache = heightCaches.get(scope);
    if (!cache) {
        cache = { heights: new Map(), total: 0 };
        heightCaches.set(scope, cache);
    }
    return cache;
}

function writeHeight(cache: HeightCache, key: string, px: number) {
    const previous = cache.heights.get(key);
    if (previous === px) {
        return;
    }
    cache.total += px - (previous ?? 0);
    cache.heights.set(key, px);
}

function meanHeight(cache: HeightCache): number | null {
    return cache.heights.size > 0 ? cache.total / cache.heights.size : null;
}

function sumHeights<T>(items: T[], from: number, to: number, itemKey: (item: T) => string, cache: HeightCache, estimate: number) {
    let px = 0;
    let unknown = 0;
    for (let i = from; i < to; i += 1) {
        const height = cache.heights.get(itemKey(items[i]));
        if (height === undefined) {
            px += estimate;
            unknown += 1;
        }
        else {
            px += height;
        }
    }
    return { px, unknown };
}

function findScroller(element: HTMLElement): HTMLElement | null {
    const view = element.ownerDocument.defaultView;
    if (!view) {
        return null;
    }
    for (let node = element.parentElement; node; node = node.parentElement) {
        const overflowY = view.getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
            return node;
        }
    }
    return null;
}

type PanelWindow = Window & typeof globalThis;

export interface SlidingWindowOptions<T> {
    items: T[];
    itemKey: (item: T) => string;
    focusKeyFor: (item: T) => string;
    windowId: string;
    heightScope: string;
    dynamicLoading: boolean;
    initialRows: number;
    rowStep: number;
    prefetchDistance: number;
    sentinelRootMarginPx: number;
    resetKey: string;
    debugLabel?: string;
}

type DirectionHandler = (evt: { detail?: { button?: number } }) => boolean | void;

export interface SlidingWindow<T> {
    mountedItems: T[];
    start: number;
    topSpacerPx: number;
    bottomSpacerPx: number;
    holderRef: MutableRefObject<HTMLDivElement | null>;
    upMarkerRef: MutableRefObject<HTMLDivElement | null>;
    downMarkerRef: MutableRefObject<HTMLDivElement | null>;
    onItemFocus: (absoluteIndex: number) => void;
    guardTopRow: (absoluteIndex: number) => DirectionHandler | undefined;
    openAt: (focusKey: string) => void;
}

type WindowState<T> = {
    items: T[];
    resetKey: string;
    jumpToken: number;
    scope: string;
    start: number;
    end: number;
    reach: number;
    residual: number;
    estimate: number;
    estimateProvisional: boolean;
    epoch: number;
    pendingOpen: string | null;
    openTarget: string | null;
    rebase: number;
    upBlocked: boolean;
};

type Geometry = {
    holderTop: number;
    firstRowTop: number;
    downTop: number;
    rowTops: number[];
    start: number;
    end: number;
    bottomSpacerPx: number;
};

type Anchor = { key: string; top: number };
type RowRecord = { top: number; index: number };

export function useSlidingWindow<T>(options: SlidingWindowOptions<T>): SlidingWindow<T> {
    const {
        items,
        itemKey,
        focusKeyFor,
        windowId,
        heightScope,
        dynamicLoading,
        initialRows,
        rowStep,
        prefetchDistance,
        sentinelRootMarginPx,
        resetKey,
        debugLabel
    } = options;

    const holderRef = useRef<HTMLDivElement | null>(null);
    const upMarkerRef = useRef<HTMLDivElement | null>(null);
    const downMarkerRef = useRef<HTMLDivElement | null>(null);

    const [width, setWidth] = useState(() => lastWidthByWindow.get(windowId) ?? 0);
    const scope = `${heightScope}|${width}`;

    const count = items.length;
    const prefetch = Math.max(1, Math.min(prefetchDistance, MAX_PREFETCH));
    const openRows = dynamicLoading ? Math.max(1, Math.min(initialRows, WINDOW_MAX_ROWS)) : WINDOW_MAX_ROWS;

    const [, setJumpSignal] = useState(0);
    useEffect(function watchForJumpToTop() {
        return subscribeJumpToTop(setJumpSignal);
    }, []);

    const focusKeyRef = useRef<string | null>(null);
    const lastFocusAtRef = useRef(0);

    const [state, setState] = useState<WindowState<T>>(() => {
        const mean = meanHeight(cacheFor(scope));
        const end = Math.min(count, openRows);
        return {
            items,
            resetKey,
            jumpToken: currentJumpToTopToken(),
            scope,
            start: 0,
            end,
            reach: end,
            residual: 0,
            estimate: mean ?? 0,
            estimateProvisional: mean === null,
            epoch: 0,
            pendingOpen: null,
            openTarget: null,
            rebase: 0,
            upBlocked: false
        };
    });

    function collapsed(from: WindowState<T>, n: number): WindowState<T> {
        const end = Math.min(n, openRows);
        return { ...from, start: 0, end, reach: end, residual: 0, epoch: from.epoch + 1, upBlocked: false, openTarget: null };
    }

    function rekeyed(from: WindowState<T>, nextItems: T[]): WindowState<T> {
        const n = nextItems.length;
        if (n === 0) {
            return { ...from, items: nextItems, start: 0, end: 0, reach: 0 };
        }
        const oldItems = from.items;
        const newIndex = new Map<string, number>();
        for (let i = 0; i < n; i += 1) {
            newIndex.set(itemKey(nextItems[i]), i);
        }
        let anchorOld = Math.min(from.start, Math.max(0, oldItems.length - 1));
        const focusKey = focusKeyRef.current;
        for (let i = from.start; focusKey !== null && i < from.end && i < oldItems.length; i += 1) {
            if (itemKey(oldItems[i]) === focusKey) {
                anchorOld = i;
                break;
            }
        }
        const shift = survivorShift(oldItems, anchorOld, newIndex);
        const length = Math.max(1, from.end - from.start);
        let start = from.start === 0 ? 0 : Math.max(0, Math.min(from.start + shift, n - 1));
        const end = Math.min(n, start + length);
        if (end - start < length) {
            start = Math.max(0, end - length);
        }
        const reach = Math.min(n, Math.max(end, from.reach + shift));
        return { ...from, items: nextItems, start, end, reach };
    }

    function survivorShift(oldItems: T[], anchorOld: number, newIndex: Map<string, number>) {
        for (let d = 0; anchorOld - d >= 0 || anchorOld + d < oldItems.length; d += 1) {
            for (const i of [anchorOld + d, anchorOld - d]) {
                if (i < 0 || i >= oldItems.length) {
                    continue;
                }
                const found = newIndex.get(itemKey(oldItems[i]));
                if (found !== undefined) {
                    return found - i;
                }
            }
        }
        return 0;
    }

    function openedAround(from: WindowState<T>, focusKey: string): WindowState<T> | null {
        const index = items.findIndex((item) => focusKeyFor(item) === focusKey);
        if (index < 0) {
            return null;
        }
        const mean = meanHeight(cacheFor(scope));
        const base: WindowState<T> = {
            ...from,
            pendingOpen: null,
            openTarget: itemKey(items[index]),
            residual: 0,
            epoch: from.epoch + 1,
            upBlocked: false,
            estimate: mean ?? from.estimate,
            estimateProvisional: mean === null
        };
        if (index < WINDOW_MAX_ROWS - OPEN_TRAIL) {
            const end = Math.min(count, Math.max(openRows, index + OPEN_TRAIL));
            return { ...base, start: 0, end, reach: end };
        }
        const start = Math.max(0, index - OPEN_LEAD);
        const end = Math.min(count, index + OPEN_TRAIL);
        return { ...base, start, end, reach: end };
    }

    let next = state;
    const jumpToken = currentJumpToTopToken();
    if (next.resetKey !== resetKey) {
        next = { ...collapsed(next, count), resetKey, items };
    }
    if (next.jumpToken !== jumpToken) {
        next = next.start > 0 || next.reach > next.end
            ? { ...collapsed(next, count), jumpToken }
            : { ...next, jumpToken };
    }
    if (next.items !== items) {
        next = rekeyed(next, items);
    }
    if (next.scope !== scope) {
        const fresh = meanHeight(cacheFor(scope));
        const carried = meanHeight(cacheFor(next.scope));
        next = {
            ...next,
            scope,
            estimate: fresh ?? carried ?? next.estimate,
            estimateProvisional: fresh === null && carried === null
        };
    }
    if (next.pendingOpen !== null) {
        next = openedAround(next, next.pendingOpen) ?? next;
    }
    if (next !== state) {
        setState(next);
    }

    const cache = cacheFor(scope);
    const above = sumHeights(items, 0, next.start, itemKey, cache, next.estimate);
    const below = sumHeights(items, next.end, Math.min(next.reach, count), itemKey, cache, next.estimate);
    const topSpacerPx = Math.max(0, above.px + next.residual);
    const bottomSpacerPx = below.px;
    const unknownAbove = above.unknown;

    const mountedItems = useMemo(
        () => items.slice(next.start, next.end),
        [items, next.start, next.end]
    );

    const indexByKey = useMemo(() => {
        const map = new Map<string, number>();
        items.forEach((item, i) => map.set(itemKey(item), i));
        return map;
    }, [items]);

    const live = { state: next, count, indexByKey, topSpacerPx, aboveSumPx: above.px, unknownAbove, scope, prefetch, rowStep, openRows };
    const liveRef = useRef(live);
    liveRef.current = live;

    const geometryRef = useRef<Geometry | null>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const viewportRef = useRef<{ lo: number; hi: number } | null>(null);
    const screenRowsRef = useRef(8);

    function clampedStep() {
        const current = liveRef.current;
        return Math.max(1, Math.min(
            current.rowStep,
            EVICT_LEAD - current.prefetch - 1,
            WINDOW_MAX_ROWS - 2 * EVICT_LEAD - screenRowsRef.current
        ));
    }

    function keepSpan(current: WindowState<T>): { lo: number; hi: number } {
        const lookup = liveRef.current.indexByKey;
        if (current.openTarget !== null) {
            const target = lookup.get(current.openTarget);
            if (target !== undefined) {
                return { lo: target, hi: target };
            }
        }
        const focusIndex = focusKeyRef.current !== null ? lookup.get(focusKeyRef.current) : undefined;
        const view = viewportRef.current;
        if (focusIndex === undefined) {
            return view ?? { lo: current.start, hi: Math.max(current.start, current.end - 1) };
        }
        if (!view) {
            return { lo: focusIndex, hi: focusIndex };
        }
        if (focusIndex >= view.lo - EVICT_LEAD && focusIndex <= view.hi + EVICT_LEAD) {
            return { lo: Math.min(view.lo, focusIndex), hi: Math.max(view.hi, focusIndex) };
        }
        return view;
    }

    const growthPendingRef = useRef(false);
    useEffect(function clearGrowthPending() {
        growthPendingRef.current = false;
    }, [next.start, next.end]);

    function growDown() {
        const current = liveRef.current.state;
        if (growthPendingRef.current || current.end >= current.items.length) {
            return;
        }
        growthPendingRef.current = true;
        setState(function extendEnd(from) {
            const n = from.items.length;
            const keep = keepSpan(from);
            let end = Math.min(n, from.end + clampedStep());
            let start = from.start;
            if (end - start > WINDOW_MAX_ROWS) {
                start = Math.max(start, Math.min(end - WINDOW_MAX_ROWS, keep.lo - EVICT_LEAD));
            }
            if (end - start > WINDOW_MAX_ROWS) {
                end = start + WINDOW_MAX_ROWS;
            }
            if (end <= from.end) {
                growthPendingRef.current = false;
                return from;
            }
            return { ...from, start, end, reach: Math.max(from.reach, end) };
        });
    }

    function growUp() {
        const current = liveRef.current.state;
        if (growthPendingRef.current || current.start <= 0 || current.upBlocked) {
            return;
        }
        growthPendingRef.current = true;
        setState(function extendStart(from) {
            const keep = keepSpan(from);
            let start = Math.max(0, from.start - clampedStep());
            let end = from.end;
            if (end - start > WINDOW_MAX_ROWS) {
                end = Math.min(end, Math.max(start + WINDOW_MAX_ROWS, keep.hi + 1 + EVICT_LEAD));
            }
            if (end - start > WINDOW_MAX_ROWS) {
                start = end - WINDOW_MAX_ROWS;
            }
            if (start >= from.start) {
                growthPendingRef.current = false;
                return from;
            }
            const needed = sumHeights(from.items, 0, start, itemKey, cacheFor(from.scope), from.estimate).px + from.residual;
            if (needed < 0) {
                growthPendingRef.current = false;
                return { ...from, upBlocked: true };
            }
            return { ...from, start, end };
        });
    }

    function onItemFocus(absoluteIndex: number) {
        const current = liveRef.current.state;
        const item = current.items[absoluteIndex];
        if (item === undefined) {
            return;
        }
        focusKeyRef.current = itemKey(item);
        lastFocusAtRef.current = Date.now();
        if (current.openTarget !== null) {
            setState(function landed(from) {
                return from.openTarget === null ? from : { ...from, openTarget: null };
            });
        }
        if (absoluteIndex >= current.end - liveRef.current.prefetch) {
            growDown();
        }
        if (current.start > 0 && absoluteIndex <= current.start + liveRef.current.prefetch) {
            growUp();
        }
    }

    const restTimerRef = useRef<number | null>(null);
    function needsRebase() {
        const current = liveRef.current;
        if (current.state.upBlocked) {
            return true;
        }
        if (current.state.start === 0) {
            return Math.abs(current.state.residual) > 0.5;
        }
        if (current.unknownAbove === 0) {
            return false;
        }
        const mean = meanHeight(cacheFor(current.scope));
        return mean !== null && Math.abs(mean - current.state.estimate) > 0.5;
    }
    function armRestCheck(fromScroll = false) {
        const scroller = scrollerRef.current;
        const view = scroller?.ownerDocument.defaultView;
        if (!scroller || !view) {
            return;
        }
        if (restTimerRef.current !== null) {
            if (!fromScroll) {
                return;
            }
            view.clearTimeout(restTimerRef.current);
        }
        restTimerRef.current = view.setTimeout(function atRest() {
            restTimerRef.current = null;
            if (!needsRebase()) {
                return;
            }
            setState(function askForRebase(from) {
                return { ...from, rebase: from.rebase + 1 };
            });
        }, REST_MS);
    }

    const guardRef = useRef<DirectionHandler>(() => false);
    guardRef.current = function guardUp(evt) {
        if (evt?.detail?.button !== DIR_UP) {
            return false;
        }
        const current = liveRef.current;
        if (current.state.start > 0) {
            growUp();
            armRestCheck();
            return;
        }
        if (current.topSpacerPx > 0.5) {
            armRestCheck();
            return;
        }
        return false;
    };
    const stableGuardRef = useRef<DirectionHandler>((evt) => guardRef.current(evt));

    function guardTopRow(absoluteIndex: number) {
        if (absoluteIndex !== next.start) {
            return undefined;
        }
        return next.start > 0 || topSpacerPx > 0.5 ? stableGuardRef.current : undefined;
    }

    function openAt(focusKey: string) {
        setState(function requestOpen(from) {
            return { ...from, pendingOpen: focusKey };
        });
    }

    const anchorsRef = useRef<{ epoch: number; start: number; rows: Map<string, RowRecord> } | null>(null);
    const rebaseSeenRef = useRef(next.rebase);
    const pendingShiftRef = useRef<{ delta: number; from: number } | null>(null);
    const rebaseAppliedRef = useRef<number | null>(null);

    useLayoutEffect(function measureAndAnchor() {
        const holder = holderRef.current;
        const up = upMarkerRef.current;
        const down = downMarkerRef.current;
        if (!holder || !up || !down) {
            return;
        }
        if (!scrollerRef.current || !scrollerRef.current.isConnected) {
            scrollerRef.current = findScroller(holder);
        }
        const scroller = scrollerRef.current;
        if (!scroller) {
            return;
        }

        const measuredWidth = Math.round(holder.clientWidth);
        if (measuredWidth > 0 && measuredWidth !== width) {
            lastWidthByWindow.set(windowId, measuredWidth);
            setWidth(measuredWidth);
        }

        const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
        const rows: Element[] = [];
        for (let node = up.nextElementSibling; node && node !== down; node = node.nextElementSibling) {
            rows.push(node);
        }
        const rowTops = rows.map((row) => row.getBoundingClientRect().top - origin);
        const downTop = down.getBoundingClientRect().top - origin;
        const measured = rows.length === mountedItems.length;

        const measuredCache = cacheFor(`${heightScope}|${measuredWidth}`);
        if (measured) {
            for (let i = 0; i < rows.length; i += 1) {
                const bottom = i + 1 < rows.length ? rowTops[i + 1] : downTop;
                writeHeight(measuredCache, itemKey(mountedItems[i]), bottom - rowTops[i]);
            }
        }
        const mean = meanHeight(measuredCache);
        if (mean) {
            screenRowsRef.current = Math.ceil(scroller.clientHeight / mean);
        }

        geometryRef.current = {
            holderTop: holder.getBoundingClientRect().top - origin,
            firstRowTop: rows.length ? rowTops[0] : downTop,
            downTop,
            rowTops,
            start: next.start,
            end: next.end,
            bottomSpacerPx
        };

        const pending = pendingShiftRef.current;
        if (pending !== null) {
            pendingShiftRef.current = null;
            const shift = pending.delta;
            const expected = pending.from + shift;
            scroller.scrollTop = expected;
            const anchors = anchorsRef.current;
            if (anchors) {
                for (const record of anchors.rows.values()) {
                    record.top += shift;
                }
            }
            verifyScrollHeld(scroller, expected, shift);
            rebaseAppliedRef.current = shift;
        }

        let correction: Partial<WindowState<T>> | null = null;
        let anchorOffset = 0;
        let recordAnchors = measured && rows.length > 0;

        if (rebaseSeenRef.current !== next.rebase) {
            rebaseSeenRef.current = next.rebase;
            const estimate = meanHeight(cacheFor(scope)) ?? next.estimate;
            const target = next.start === 0
                ? 0
                : Math.max(0, sumHeights(items, 0, next.start, itemKey, cacheFor(scope), estimate).px);
            const delta = target - topSpacerPx;
            if (Math.abs(delta) > 0.5) {
                pendingShiftRef.current = { delta, from: scroller.scrollTop };
            }
            correction = { residual: 0, estimate, estimateProvisional: false, upBlocked: false };
        }
        else if (next.estimateProvisional && mean !== null) {
            correction = { estimate: mean, estimateProvisional: false };
            recordAnchors = false;
        }
        else {
            const anchors = anchorsRef.current;
            if (anchors && anchors.epoch === next.epoch && (next.start > 0 || anchors.start > 0) && measured) {
                const topByKey = new Map<string, number>();
                for (let i = 0; i < rows.length; i += 1) {
                    topByKey.set(itemKey(mountedItems[i]), rowTops[i]);
                }
                let first: Anchor | null = null;
                let firstDelta = 0;
                for (const [key, record] of anchors.rows) {
                    const now = indexByKey.get(key);
                    if (topByKey.has(key) && now !== undefined) {
                        first = { key, top: record.top };
                        firstDelta = now - record.index;
                        break;
                    }
                }
                const focusKey = focusKeyRef.current;
                const focusRecord = focusKey === null ? undefined : anchors.rows.get(focusKey);
                const focusNow = focusKey === null ? undefined : indexByKey.get(focusKey);
                const focusStays = focusRecord !== undefined && focusNow !== undefined && topByKey.has(focusKey!)
                    && focusNow - focusRecord.index === firstDelta;
                const anchor = focusStays ? { key: focusKey!, top: focusRecord!.top } : first;
                const moved = anchor ? topByKey.get(anchor.key)! - anchor.top : 0;
                if (Math.abs(moved) > 0.5) {
                    const wanted = next.residual - moved;
                    const residual = Math.max(wanted, -above.px);
                    anchorOffset = above.px + residual - topSpacerPx;
                    correction = residual === wanted ? { residual } : { residual, upBlocked: true };
                }
            }
        }

        if (recordAnchors) {
            const recorded = new Map<string, RowRecord>();
            for (let i = 0; i < rows.length; i += 1) {
                recorded.set(itemKey(mountedItems[i]), { top: rowTops[i] + anchorOffset, index: next.start + i });
            }
            anchorsRef.current = { epoch: next.epoch, start: next.start, rows: recorded };
        }
        else {
            anchorsRef.current = null;
        }

        if (correction) {
            const change = correction;
            setState(function applyCorrection(from) {
                return { ...from, ...change };
            });
        }

        if (needsRebase()) {
            armRestCheck();
        }
    });

    function verifyScrollHeld(scroller: HTMLElement, expected: number, shift: number) {
        const view = scroller.ownerDocument.defaultView;
        if (!view || Math.abs(shift) < 1) {
            return;
        }
        const until = Date.now() + REBASE_VERIFY_MS;
        const check = () => {
            if (Math.abs(scroller.scrollTop - (expected - shift)) < 1) {
                scroller.scrollTop = expected;
            }
            else if (Math.abs(scroller.scrollTop - expected) >= 1) {
                return;
            }
            if (Date.now() < until) {
                view.requestAnimationFrame(check);
            }
        };
        view.requestAnimationFrame(check);
    }

    const hasRows = count > 0;

    useEffect(function watchWidth() {
        const holder = holderRef.current;
        const view = holder?.ownerDocument.defaultView as PanelWindow | null | undefined;
        if (!holder || !view) {
            return;
        }
        const observer = new view.ResizeObserver(() => {
            const measured = Math.round(holder.clientWidth);
            if (measured > 0) {
                lastWidthByWindow.set(windowId, measured);
                setWidth(measured);
            }
        });
        observer.observe(holder);
        return () => {
            observer.disconnect();
        };
    }, [windowId, hasRows]);

    useEffect(function watchViewport() {
        const scroller = scrollerRef.current;
        const view = scroller?.ownerDocument.defaultView;
        if (!scroller || !view) {
            return;
        }
        let frame: number | null = null;
        let framesInSpacer = 0;
        const onFrame = () => {
            frame = null;
            const geometry = geometryRef.current;
            if (!geometry) {
                return;
            }
            const top = scroller.scrollTop;
            const bottom = top + scroller.clientHeight;
            viewportRef.current = visibleRange(geometry, top, bottom);
            const topSeen = geometry.start > 0
                ? overlap(top, bottom, geometry.holderTop, geometry.firstRowTop)
                : null;
            const bottomSeen = geometry.bottomSpacerPx > 0
                ? overlap(top, bottom, geometry.downTop, geometry.downTop + geometry.bottomSpacerPx)
                : null;
            const seen = topSeen ?? bottomSeen;
            if (!seen) {
                framesInSpacer = 0;
                return;
            }
            frame = view.requestAnimationFrame(onFrame);
            framesInSpacer += 1;
            const current = liveRef.current.state;
            if (framesInSpacer < SPACER_FRAMES_BEFORE_REOPEN || current.openTarget !== null) {
                return;
            }
            if (Date.now() - lastFocusAtRef.current < FOCUS_SCROLL_GRACE_MS) {
                return;
            }
            const focusIndex = focusKeyRef.current !== null ? liveRef.current.indexByKey.get(focusKeyRef.current) : undefined;
            const visible = viewportRef.current;
            if (focusIndex !== undefined && visible && focusIndex >= visible.lo && focusIndex <= visible.hi) {
                return;
            }
            framesInSpacer = 0;
            const centre = indexAtOffset(geometry, (seen.from + seen.to) / 2);
            if (centre !== null) {
                reopenAround(centre);
            }
        };
        const onScroll = () => {
            armRestCheck(true);
            if (frame === null) {
                frame = view.requestAnimationFrame(onFrame);
            }
        };
        const onFocusMove = (evt: Event) => {
            lastFocusAtRef.current = Date.now();
            const holder = holderRef.current;
            const target = evt.target as Node | null;
            const current = liveRef.current;
            if (!holder || !target || current.state.start === 0 || current.state.openTarget !== null) {
                return;
            }
            const holderFollows = (target.compareDocumentPosition(holder) & 4) !== 0;
            if (holder.contains(target) || !holderFollows) {
                return;
            }
            setState(function collapseUnderHeader(from) {
                if (from.start === 0 || from.openTarget !== null) {
                    return from;
                }
                const end = Math.min(from.items.length, liveRef.current.openRows);
                return { ...from, start: 0, end, reach: end, residual: 0, epoch: from.epoch + 1, upBlocked: false };
            });
        };
        scroller.addEventListener("scroll", onScroll, { passive: true });
        scroller.addEventListener("vgp_onfocus", onFocusMove);
        return () => {
            scroller.removeEventListener("scroll", onScroll);
            scroller.removeEventListener("vgp_onfocus", onFocusMove);
            if (frame !== null) {
                view.cancelAnimationFrame(frame);
            }
            if (restTimerRef.current !== null) {
                view.clearTimeout(restTimerRef.current);
                restTimerRef.current = null;
            }
        };
    }, [hasRows]);

    function overlap(top: number, bottom: number, from: number, to: number) {
        const lo = Math.max(top, from);
        const hi = Math.min(bottom, to);
        return hi - lo > 1 ? { from: lo, to: hi } : null;
    }

    function visibleRange(geometry: Geometry, top: number, bottom: number) {
        const tops = geometry.rowTops;
        let lo = -1;
        let hi = -1;
        for (let i = 0; i < tops.length; i += 1) {
            const rowBottom = i + 1 < tops.length ? tops[i + 1] : geometry.downTop;
            if (rowBottom > top && tops[i] < bottom) {
                if (lo < 0) {
                    lo = i;
                }
                hi = i;
            }
        }
        return lo < 0 ? null : { lo: geometry.start + lo, hi: geometry.start + hi };
    }

    function indexAtOffset(geometry: Geometry, offset: number): number | null {
        const current = liveRef.current;
        const scopeCache = cacheFor(current.scope);
        const { items: listItems, estimate, reach } = current.state;
        if (offset < geometry.firstRowTop) {
            let position = geometry.holderTop + Math.max(0, current.topSpacerPx - current.aboveSumPx);
            for (let i = 0; i < geometry.start; i += 1) {
                position += scopeCache.heights.get(itemKey(listItems[i])) ?? estimate;
                if (position > offset) {
                    return i;
                }
            }
            return Math.max(0, geometry.start - 1);
        }
        let position = geometry.downTop;
        const last = Math.min(reach, listItems.length);
        for (let i = geometry.end; i < last; i += 1) {
            position += scopeCache.heights.get(itemKey(listItems[i])) ?? estimate;
            if (position > offset) {
                return i;
            }
        }
        return last > 0 ? last - 1 : null;
    }

    function reopenAround(index: number) {
        setState(function reopen(from) {
            const n = from.items.length;
            const start = Math.max(0, index - OPEN_LEAD);
            const end = Math.min(n, Math.max(start + 1, index + OPEN_TRAIL));
            return { ...from, start, end, reach: Math.max(from.reach, end), epoch: from.epoch + 1, upBlocked: false };
        });
    }

    const marginPx = Math.max(0, sentinelRootMarginPx);
    useEffect(function watchMarkers() {
        const scroller = scrollerRef.current;
        const view = scroller?.ownerDocument.defaultView as PanelWindow | null | undefined;
        if (!scroller || !view) {
            return;
        }
        const mean = meanHeight(cacheFor(scope));
        const leadRows = Math.min(EVICT_LEAD, OPEN_LEAD) - prefetch;
        const margin = mean ? Math.min(marginPx, Math.floor(leadRows * mean)) : marginPx;
        const observers: IntersectionObserver[] = [];
        const up = upMarkerRef.current;
        if (up && next.start > 0) {
            const observer = new view.IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting) {
                    growUp();
                }
            }, { root: scroller, rootMargin: `${margin}px 0px`, threshold: 0 });
            observer.observe(up);
            observers.push(observer);
        }
        const down = downMarkerRef.current;
        if (down && next.end < count) {
            const observer = new view.IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting) {
                    growDown();
                }
            }, { root: scroller, rootMargin: `${margin}px 0px`, threshold: 0 });
            observer.observe(down);
            observers.push(observer);
        }
        return () => {
            for (const observer of observers) {
                observer.disconnect();
            }
        };
    }, [next.start, next.end, count, marginPx, prefetch, hasRows]);

    const reportedResidualRef = useRef(next.residual);
    const roundedTop = Math.round(topSpacerPx);
    const roundedBottom = Math.round(bottomSpacerPx);
    const roundedResidual = Math.round(next.residual);
    useEffect(function reportWindow() {
        if (!debugLabel) {
            return;
        }
        const residualDelta = roundedResidual - reportedResidualRef.current;
        reportedResidualRef.current = roundedResidual;
        const rebase = rebaseAppliedRef.current;
        rebaseAppliedRef.current = null;
        logFocusDebug(
            "window",
            debugLabel,
            `${next.start} ${next.end} top=${roundedTop}px bottom=${roundedBottom}px`
            + ` residual=${roundedResidual} residualDelta=${residualDelta}px unknownAbove=${unknownAbove}`
            + ` mounted=${next.end - next.start} items=${count}`
            + (rebase !== null ? ` rebase=${Math.round(rebase)}` : "")
            + (next.upBlocked ? " upBlocked" : "")
        );
    }, [debugLabel, next.start, next.end, roundedTop, roundedBottom, roundedResidual, unknownAbove, count, next.upBlocked]);

    return {
        mountedItems,
        start: next.start,
        topSpacerPx,
        bottomSpacerPx,
        holderRef,
        upMarkerRef,
        downMarkerRef,
        onItemFocus,
        guardTopRow,
        openAt
    };
}
