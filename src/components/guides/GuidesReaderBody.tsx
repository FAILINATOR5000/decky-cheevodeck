import { DialogButton, Focusable, ScrollPanelGroup } from "@decky/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { t, type LanguageCode } from "../../locales";
import type { GuideKind } from "../../types";
import type { GuideContent } from "../../utils/guidesFetch";
import type { GuidePage } from "../../utils/guidesBlocks";
import { CHUNK_BLOCK_CLASS, findChunkForLine } from "../../utils/guidesChunk";
import { sanitizeGuideHtml } from "../../utils/guidesRender";
import {
    findScroller,
    lineToOffset,
    offsetToLine,
    readLineAnchors,
    refreshLineAnchors,
    type LineAnchor,
} from "../../utils/guidesAnchors";
import { guideBodySize, type GuideSurface } from "../../utils/scale";
import {
    dropGuideHeights,
    fingerprintGuide,
    noteGuideHeights,
    readGuideHeights,
    sameGuideWidth,
    type GuideHeightKey,
} from "../../utils/guidesHeightCache";
import { findFolded } from "../../utils/guidesSearch";
import { BUTTON_TRIGGER_LEFT, BUTTON_TRIGGER_RIGHT } from "../../utils/gamepadButtons";
import { debugLoggingEnabled, logGuidesDebug } from "../../api";

type GuidesReaderBodyProps = {
    content: GuideContent | null;
    language: LanguageCode;
    surface: GuideSurface;
    zoom: number;
    fullHeight: boolean;
    maxHeightCss?: string;
    onEscape?: () => void;
    restoreLine?: number | null;
    onLineChange?: (line: number, into: number) => void;
    restoreInto?: number;
    restoreFraction?: number;
    onScrollFraction?: (fraction: number) => void;
    restoreToken?: number;
    autoFocus?: boolean;
    onAutoFocused?: () => void;
    onActivate?: () => void;
    onBookmark?: (line: number, fraction: number) => void;
    onZoom?: (delta: number) => void;
    onPageTurn?: (delta: number) => void;
    onSearchStep?: (delta: number) => void;
    activateLabel?: ReactNode;
    escapeLabel?: ReactNode;
    searchTerm?: string;
    searchAnchor?: number | null;
    searchOccurrence?: number;
    searchJumpToken?: number;
    pages?: GuidePage[];
    showProgress?: boolean;
    exitable?: boolean;
};

type MountedWindow = {
    from: number;
    to: number;
    spacer: number;
};

export const BUMPER_LEFT = 5;
export const BUMPER_RIGHT = 6;

const INVERT_FILTER = "invert(1) hue-rotate(180deg)";

export function legendGlyph(mark: string) {
    return <span style={{ fontSize: "1.6em", lineHeight: 1 }}>{mark}</span>;
}

const HIGHLIGHT_MATCH = "cheevo-guide-search";
const HIGHLIGHT_CURRENT = "cheevo-guide-search-current";

const PROGRESS_TRACK_PX = 3;
const PROGRESS_MARK_PX = 18;

const SEARCH_MATCH_MARGIN_PX = 10;

function searchHighlightCss(inverted: boolean): string {
    const match = inverted ? "#d4c68a" : "#4a3c00";
    const matchText = inverted ? "#461c00" : "#ffd54f";
    const current = inverted ? "#803400" : "#ffb300";
    const currentText = inverted ? "#efefef" : "#101010";
    return `::highlight(${HIGHLIGHT_MATCH}) { background-color: ${match}; color: ${matchText}; }
            ::highlight(${HIGHLIGHT_CURRENT}) { background-color: ${current}; color: ${currentText}; }`;
}

const RESTORE_MAX_FRAMES = 40;
const RESTORE_SETTLE_FRAMES = 40;
const RESTORE_STABLE_FRAMES = 2;
const RESTORE_TOLERANCE_PX = 2;

const WINDOW_SCREENS = 3;

const WINDOW_TRIM_SCREENS = 8;

const DRAG_SLACK_PX = 2;

const DRAG_BLOCK_MS = 400;

const PAGES_PER_PASS = 24;

const PARSE_CACHE_MARGIN = 4;

const SEED_PAGES = 2;

const CLIMB_BUDGET_MS = 500;

export function GuidesReaderBody(props: GuidesReaderBodyProps) {
    const { content, language, fullHeight, onEscape } = props;
    const kind: GuideKind = content?.kind ?? "plaintext";
    const isFormatted = kind === "formatted";
    const bodyFont = guideBodySize(isFormatted ? 12 : 10, props.surface);
    const bodyClassRef = useRef("cheevo-guide-body-" + Math.random().toString(36).slice(2, 8));
    const bodyClass = bodyClassRef.current;

    const hostRef = useRef<HTMLDivElement | null>(null);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const restoreLineRef = useRef(props.restoreLine ?? null);
    restoreLineRef.current = props.restoreLine ?? null;
    const restoreFractionRef = useRef(props.restoreFraction ?? 0);
    restoreFractionRef.current = props.restoreFraction ?? 0;
    const restoreIntoRef = useRef(props.restoreInto ?? 0);
    restoreIntoRef.current = props.restoreInto ?? 0;
    const reportLineRef = useRef(props.onLineChange);
    reportLineRef.current = props.onLineChange;
    const reportRef = useRef(props.onScrollFraction);
    reportRef.current = props.onScrollFraction;
    const autoFocusRef = useRef(props.autoFocus ?? false);
    const onAutoFocusedRef = useRef(props.onAutoFocused);
    onAutoFocusedRef.current = props.onAutoFocused;
    const [bodyFocused, setBodyFocused] = useState(false);
    const bodyFocusedRef = useRef(false);
    const [released, setReleased] = useState(false);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const currentLineRef = useRef<number | null>(null);
    const currentIntoRef = useRef(0);
    const currentFractionRef = useRef<number | null>(null);
    const anchorsRef = useRef<LineAnchor[]>([]);
    const anchorsAtRef = useRef(-1);
    const [revealed, setRevealed] = useState(true);
    const [revealedFor, setRevealedFor] = useState<GuideContent | null>(null);
    const [revealedToken, setRevealedToken] = useState<number>(props.restoreToken ?? 0);
    const freshMarkup = revealedFor !== content;
    if (freshMarkup || revealedToken !== (props.restoreToken ?? 0)) {
        setRevealedFor(content);
        setRevealedToken(props.restoreToken ?? 0);
        setRevealed(freshMarkup ? !((props.restoreLine ?? 0) > 0) : true);
    }

    const windowedPages = props.pages && props.pages.length > 1 ? props.pages : null;
    const restorePage = (): number => {
        if (!windowedPages) {
            return 0;
        }
        const line = restoreLineRef.current ?? 0;
        return line > 0 ? findChunkForLine(windowedPages, line) : 0;
    };
    const seedWindow = (): MountedWindow => {
        if (!windowedPages) {
            return { from: 0, to: 0, spacer: 0 };
        }
        return { from: 0, to: Math.min(restorePage() + 1, SEED_PAGES), spacer: 0 };
    };
    const [measuring, setMeasuring] = useState<{ from: number; count: number } | null>(null);
    const measureRef = useRef<HTMLDivElement | null>(null);
    const measurePendingRef = useRef(false);
    const measureBelow = (below: number, want: number): boolean => {
        if (measurePendingRef.current || below <= 0 || want <= 0) {
            return false;
        }
        const count = Math.min(want, below);
        measurePendingRef.current = true;
        setMeasuring({ from: below - count, count });
        return true;
    };
    const [win, setWin] = useState<MountedWindow>(seedWindow);
    const winRef = useRef(win);
    winRef.current = win;
    const pageHeightsRef = useRef(new Map<number, number>());
    const settledRef = useRef(false);
    const grewAtRef = useRef({ height: -1, top: -1, at: 0 });
    const alignedForRef = useRef(-1);
    const trimmable = kind !== "formatted";
    const spacerFor = (from: number): number | null => {
        let px = 0;
        for (let i = 0; i < from; i += 1) {
            const height = pageHeightsRef.current.get(i);
            if (height === undefined) {
                return null;
            }
            px += height;
        }
        return px;
    };

    const fingerprintRef = useRef("");
    const heightKey = (): GuideHeightKey => ({
        surface: props.surface,
        fingerprint: fingerprintRef.current,
        fontPx: bodyFont,
    });

    const parsedPagesRef = useRef(new Map<number, ReactNode>());
    const parsedForRef = useRef<GuidePage[] | null>(null);
    if (parsedForRef.current !== (props.pages ?? null)) {
        parsedForRef.current = props.pages ?? null;
        parsedPagesRef.current = new Map();
        pageHeightsRef.current = new Map();
        fingerprintRef.current = trimmable && windowedPages ? fingerprintGuide(windowedPages) : "";
    }

    const pageText = (index: number): string => {
        const source = windowedPages?.[index];
        if (!source) {
            return "";
        }
        return source.text + (index < (windowedPages?.length ?? 0) - 1 ? "\n" : "");
    };

    const parsePage = (index: number): ReactNode => {
        const cached = parsedPagesRef.current.get(index);
        if (cached !== undefined) {
            return cached;
        }
        const source = windowedPages?.[index];
        let page: ReactNode;
        if (source && source.html === undefined) {
            page = (
                <div
                    key={index}
                    className={CHUNK_BLOCK_CLASS}
                    data-guide-page={index}
                    data-guide-line={source.startLine}
                    data-guide-lines={source.endLine - source.startLine}
                >
                    {pageText(index)}
                </div>
            );
        }
        else {
            const clean = sanitizeGuideHtml(source?.html ?? "");
            page = <div key={index} data-guide-page={index} dangerouslySetInnerHTML={{ __html: clean }} />;
        }
        parsedPagesRef.current.set(index, page);
        return page;
    };

    const pageSpan = (host: HTMLElement, index: number): number | null => {
        const here = host.querySelector(`[data-guide-page="${index}"]`);
        const next = host.querySelector(`[data-guide-page="${index + 1}"]`);
        if (!here || !next) {
            return null;
        }
        const span = next.getBoundingClientRect().top - here.getBoundingClientRect().top;
        return span > 0 ? span : null;
    };

    const pagesToCover = (deficit: number, mountedPx: number, mountedCount: number): number => {
        if (deficit <= 0) {
            return 0;
        }
        const each = mountedCount > 0 ? mountedPx / mountedCount : 0;
        if (each <= 0) {
            return 1;
        }
        return Math.max(1, Math.min(PAGES_PER_PASS, Math.ceil(deficit / each)));
    };

    const growRef = useRef<(scroller: HTMLElement) => boolean>(() => false);
    growRef.current = (scroller: HTMLElement) => {
        const host = hostRef.current;
        if (!windowedPages || !host) {
            return false;
        }
        const box = scroller.clientHeight;
        if (box <= 0) {
            return false;
        }
        const { from, to, spacer } = winRef.current;
        const below = scroller.scrollHeight - scroller.scrollTop - box;
        const above = scroller.scrollTop - spacer;
        const mountedPx = scroller.scrollHeight - spacer;
        const mountedCount = to - from;

        if (below < box * WINDOW_SCREENS && to < windowedPages.length) {
            const mark = grewAtRef.current;
            const grewBy = scroller.scrollHeight - mark.height;
            const movedBy = scroller.scrollTop - mark.top;
            const fresh = performance.now() - mark.at <= DRAG_BLOCK_MS;
            if (fresh && mark.height >= 0 && grewBy > 0 && Math.abs(movedBy - grewBy) <= DRAG_SLACK_PX) {
                if (debugLoggingEnabled()) {
                    logGuidesDebug(
                        "window",
                        props.surface,
                        `growth refused: dragged grew=${Math.round(grewBy)} moved=${Math.round(movedBy)} `
                        + `pages=${from}..${to}/${windowedPages.length}`
                    );
                }
                return false;
            }
            grewAtRef.current = {
                height: scroller.scrollHeight,
                top: scroller.scrollTop,
                at: performance.now(),
            };
            const want = pagesToCover(box * WINDOW_SCREENS - below, mountedPx, mountedCount);
            setWin({ from, to: Math.min(windowedPages.length, to + want), spacer });
            return true;
        }
        if (trimmable && above < box * WINDOW_SCREENS && from > 0) {
            const want = pagesToCover(box * WINDOW_SCREENS - above, mountedPx, mountedCount);
            let next = from;
            let px = spacer;
            while (next > 0 && from - next < want) {
                const height = pageHeightsRef.current.get(next - 1);
                if (height === undefined) {
                    break;
                }
                px -= height;
                next -= 1;
            }
            if (next !== from) {
                setWin({ from: next, to, spacer: Math.max(0, px) });
                return true;
            }
            if (measureBelow(from, want)) {
                return true;
            }
        }
        const jumpPending = props.searchAnchor !== null
            && props.searchAnchor !== undefined
            && alignedForRef.current !== (props.searchJumpToken ?? 0);
        if (trimmable && settledRef.current && !jumpPending) {
            if (above > box * WINDOW_TRIM_SCREENS && to - from > 1) {
                const spans: number[] = [];
                let dropped = 0;
                let next = from;
                while (next < to - 1 && above - dropped > box * WINDOW_TRIM_SCREENS) {
                    const span = pageSpan(host, next);
                    if (span === null || above - dropped - span <= box * WINDOW_SCREENS) {
                        break;
                    }
                    spans.push(span);
                    dropped += span;
                    next += 1;
                }
                if (next !== from) {
                    spans.forEach((span, at) => pageHeightsRef.current.set(from + at, span));
                    noteGuideHeights(heightKey(), host.getBoundingClientRect().width, from, spans);
                    setWin({ from: next, to, spacer: spacer + dropped });
                    return true;
                }
            }
            if (below > box * WINDOW_TRIM_SCREENS && to - from > 1) {
                let dropped = 0;
                let next = to;
                while (next > from + 1 && below - dropped > box * WINDOW_TRIM_SCREENS) {
                    const last = host.querySelector(`[data-guide-page="${next - 1}"]`);
                    const span = last ? last.getBoundingClientRect().height : 0;
                    if (span <= 0 || below - dropped - span <= box * WINDOW_SCREENS) {
                        break;
                    }
                    dropped += span;
                    next -= 1;
                }
                if (next !== to) {
                    setWin({ from, to: next, spacer });
                    return true;
                }
            }
        }
        if (to < windowedPages.length && !parsedPagesRef.current.has(to)) {
            parsePage(to);
        }
        return false;
    };

    const reachFor = (now: MountedWindow, page: number): MountedWindow | null => {
        if (!windowedPages) {
            return null;
        }
        if (page >= now.to) {
            if (now.to >= windowedPages.length) {
                return null;
            }
            return {
                from: now.from,
                to: Math.min(windowedPages.length, Math.max(now.to + 1, page + 1)),
                spacer: now.spacer,
            };
        }
        if (page < now.from) {
            const px = spacerFor(page);
            if (px === null) {
                let gap = -1;
                for (let i = 0; i < page; i += 1) {
                    if (pageHeightsRef.current.get(i) === undefined) {
                        gap = i;
                        break;
                    }
                }
                if (gap >= 0) {
                    measureBelow(Math.min(page, gap + PAGES_PER_PASS), PAGES_PER_PASS);
                }
                return null;
            }
            const reseed = now.from - page > PAGES_PER_PASS;
            return { from: page, to: reseed ? page + 1 : now.to, spacer: px };
        }
        return null;
    };

    const mountThrough = (page: number): boolean => {
        const next = reachFor(winRef.current, page);
        if (!next) {
            return false;
        }
        setWin(next);
        return true;
    };

    const verifyRef = useRef<{ page: number; widthPx: number } | null>(null);

    const seedFromCache = (): MountedWindow | null => {
        if (!trimmable || !windowedPages) {
            return null;
        }
        const target = restorePage();
        if (target < 2) {
            return null;
        }
        const remembered = readGuideHeights(heightKey());
        const covered = remembered ? remembered.heights.length : 0;
        const from = Math.min(target - 1, covered - 1);
        logGuidesDebug(
            "heights",
            props.surface,
            `page=${target} covered=${covered}`
            + (from >= 1 ? ` seeding from ${from}` : " not enough to seed, climbing")
        );
        if (!remembered || from < 1) {
            return null;
        }
        let spacer = 0;
        for (let i = 0; i < covered; i += 1) {
            pageHeightsRef.current.set(i, remembered.heights[i]);
            if (i < from) {
                spacer += remembered.heights[i];
            }
        }
        verifyRef.current = { page: from, widthPx: remembered.widthPx };
        return { from, to: Math.min(windowedPages.length, target + 1), spacer };
    };

    const seededForRef = useRef<GuideContent | null>(null);
    useLayoutEffect(() => {
        if (!windowedPages) {
            return;
        }
        const fresh = seededForRef.current !== content;
        seededForRef.current = content;
        settledRef.current = false;
        grewAtRef.current = { height: -1, top: -1, at: 0 };
        if (fresh) {
            pageHeightsRef.current = new Map();
            verifyRef.current = null;
            setWin(seedFromCache() ?? seedWindow());
            return;
        }
        const target = restorePage();
        const reached = reachFor(winRef.current, target);
        if (reached) {
            setWin(reached);
        }
    }, [content, props.restoreToken]);

    useLayoutEffect(() => {
        const host = hostRef.current;
        const pending = verifyRef.current;
        if (!pending || !host || !windowedPages || win.from !== pending.page) {
            return;
        }
        verifyRef.current = null;
        const want = pageHeightsRef.current.get(pending.page);
        const got = pageSpan(host, pending.page);
        const width = host.getBoundingClientRect().width;
        if (want === undefined || got === null
            || !sameGuideWidth(width, pending.widthPx)
            || Math.abs(got - want) > 0.5) {
            logGuidesDebug(
                "heights",
                props.surface,
                `page=${pending.page} rejected, `
                + `want=${want === undefined ? "none" : Math.round(want)} `
                + `got=${got === null ? "none" : Math.round(got)} `
                + `width=${Math.round(width)} vs ${Math.round(pending.widthPx)}`
            );
            dropGuideHeights(props.surface);
            pageHeightsRef.current = new Map();
            setWin(seedWindow());
        }
    }, [win]);

    useLayoutEffect(() => {
        const node = measureRef.current;
        const host = hostRef.current;
        if (!measuring || !node || !host) {
            return;
        }
        const spans: number[] = [];
        for (let i = 0; i < node.children.length; i += 1) {
            spans.push(node.children[i].getBoundingClientRect().height);
        }
        spans.forEach((span, at) => {
            pageHeightsRef.current.set(measuring.from + at, span > 0 ? span : 0);
        });
        if (spans.length > 0 && spans.every((span) => span > 0)) {
            noteGuideHeights(heightKey(), host.getBoundingClientRect().width, measuring.from, spans);
        }
        measurePendingRef.current = false;
        setMeasuring(null);
        const scroller = scrollerRef.current;
        if (scroller) {
            growRef.current(scroller);
        }
    }, [measuring]);

    useLayoutEffect(() => {
        const host = hostRef.current;
        const scroller = scrollerRef.current;
        if (!windowedPages || !host || !scroller) {
            return;
        }
        anchorsRef.current = refreshLineAnchors(host, scroller, anchorsRef.current);
        anchorsAtRef.current = scroller.scrollHeight;
        for (const index of Array.from(parsedPagesRef.current.keys())) {
            if (index < win.from - PARSE_CACHE_MARGIN || index >= win.to + PARSE_CACHE_MARGIN) {
                parsedPagesRef.current.delete(index);
            }
        }
        if (debugLoggingEnabled()) {
            logGuidesDebug(
                "window",
                props.surface,
                `pages=${win.from}..${win.to}/${windowedPages.length} `
                + `spacer=${Math.round(win.spacer)} `
                + `nodes=${host.getElementsByTagName("*").length} `
                + `height=${Math.round(scroller.scrollHeight)} box=${scroller.clientHeight} `
                + `scrollTop=${Math.round(scroller.scrollTop)} parsed=${parsedPagesRef.current.size}`
            );
        }
        growRef.current(scroller);
    }, [win]);

    useEffect(() => {
        if (!content) {
            return;
        }
        let frame = 0;
        let reportFrame = 0;
        let attempts = 0;
        let scroller: HTMLElement | null = null;
        let onScroll: (() => void) | null = null;

        let settledAt: number | null = null;

        const resolvePosition = (
            measured: { line: number; into: number },
            scrollTop: number
        ): { line: number; into: number } => {
            const asked = restoreLineRef.current;
            if (settledAt === null || asked === null || asked <= 0) {
                return measured;
            }
            if (Math.abs(scrollTop - settledAt) > RESTORE_TOLERANCE_PX) {
                settledAt = null;
                return measured;
            }
            if (Math.abs(measured.line - asked) > 1) {
                return measured;
            }
            return { line: asked, into: restoreIntoRef.current };
        };

        const report = () => {
            const host = hostRef.current;
            if (!scroller || !host) {
                return;
            }
            const range = scroller.scrollHeight - scroller.clientHeight;
            if (range <= 0) {
                return;
            }
            const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
            const stale = anchorsAtRef.current !== scroller.scrollHeight;
            const anchors = anchorsRef.current.length > 0 && !stale
                ? anchorsRef.current
                : readLineAnchors(host, scroller);
            anchorsRef.current = anchors;
            anchorsAtRef.current = scroller.scrollHeight;
            const overSpacer = winRef.current.from > 0
                && scroller.scrollTop < winRef.current.spacer;
            if (anchors.length > 0 && !overSpacer) {
                const at = resolvePosition(
                    offsetToLine(anchors, scroller.scrollTop, origin),
                    scroller.scrollTop
                );
                currentLineRef.current = at.line;
                currentIntoRef.current = at.into;
                reportLineRef.current?.(at.line, at.into);
                const foot = offsetToLine(anchors, scroller.scrollTop + scroller.clientHeight, origin);
                viewLinesRef.current = Math.max(0, foot.line - at.line);
            }
            const fraction = Math.min(1, Math.max(0, scroller.scrollTop / range));
            currentFractionRef.current = fraction;
            reportRef.current?.(fraction);
            growRef.current(scroller);
            paintProgress(scroller, currentLineRef.current);
        };

        let settleMeasuredAt = -1;
        let settleMeasured: LineAnchor[] = [];
        const settleAnchors = (host: HTMLElement, scroller: HTMLElement): LineAnchor[] => {
            if (settleMeasuredAt === scroller.scrollHeight && settleMeasured.length > 0) {
                return settleMeasured;
            }
            settleMeasured = readLineAnchors(host, scroller);
            settleMeasuredAt = scroller.scrollHeight;
            return settleMeasured;
        };

        const applyRestore = (): boolean => {
            const host = hostRef.current;
            if (!scroller || !host) {
                return true;
            }
            const line = restoreLineRef.current;
            if (line === null || line <= 0) {
                const range = scroller.scrollHeight - scroller.clientHeight;
                scroller.scrollTop = restoreFractionRef.current > 0
                    ? restoreFractionRef.current * range
                    : 0;
                return true;
            }
            const targetPage = restorePage();
            if (windowedPages && winRef.current.from > targetPage) {
                if (mountThrough(targetPage)) {
                    grewFrame = true;
                    return false;
                }
                if (measurePendingRef.current) {
                    grewFrame = true;
                    return false;
                }
            }
            if (windowedPages && winRef.current.to <= targetPage) {
                if (climbStartedAt === 0) {
                    climbStartedAt = performance.now();
                }
                const paced = !trimmable
                    && performance.now() - climbStartedAt <= CLIMB_BUDGET_MS;
                if (mountThrough(paced ? winRef.current.to : targetPage)) {
                    grewFrame = true;
                    return false;
                }
            }
            const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
            const anchors = settleAnchors(host, scroller);
            if (anchors.length === 0) {
                return true;
            }
            const target = lineToOffset(anchors, line, origin, restoreIntoRef.current);
            scroller.scrollTop = target;
            if (Math.abs(scroller.scrollTop - target) <= RESTORE_TOLERANCE_PX) {
                return true;
            }
            if (windowedPages && winRef.current.to < windowedPages.length) {
                grewFrame = growRef.current(scroller);
                return false;
            }
            const maxScroll = scroller.scrollHeight - scroller.clientHeight;
            return target >= maxScroll - RESTORE_TOLERANCE_PX;
        };

        const finish = () => {
            const host = hostRef.current;
            if (!scroller || !host) {
                return;
            }
            if (autoFocusRef.current) {
                autoFocusRef.current = false;
                const focusable = host.closest("[tabindex]") as HTMLElement | null;
                focusable?.focus({ preventScroll: true });
                onAutoFocusedRef.current?.();
                requestAnimationFrame(() => {
                    frameRef.current?.scrollIntoView({ block: "nearest" });
                });
                requestAnimationFrame(() => {
                    if (scrollerRef.current === scroller) {
                        applyRestore();
                    }
                });
            }
            else if (bodyFocusedRef.current) {
                requestAnimationFrame(() => {
                    frameRef.current?.scrollIntoView({ block: "nearest" });
                });
            }
            setRevealed(true);
            scrollerRef.current = scroller;
            settledRef.current = true;
            anchorsRef.current = readLineAnchors(host, scroller);
            anchorsAtRef.current = scroller.scrollHeight;
            let landedOn = -1;
            if (anchorsRef.current.length > 0) {
                settledAt = scroller.scrollTop;
                const settledOrigin = scroller.getBoundingClientRect().top - scroller.scrollTop;
                const where = resolvePosition(
                    offsetToLine(anchorsRef.current, scroller.scrollTop, settledOrigin),
                    scroller.scrollTop
                );
                currentLineRef.current = where.line;
                currentIntoRef.current = where.into;
                landedOn = where.line;
                reportLineRef.current?.(where.line, where.into);
                const foot = offsetToLine(
                    anchorsRef.current,
                    scroller.scrollTop + scroller.clientHeight,
                    settledOrigin
                );
                viewLinesRef.current = Math.max(0, foot.line - where.line);
            }
            const settledRange = scroller.scrollHeight - scroller.clientHeight;
            currentFractionRef.current = settledRange > 0
                ? Math.min(1, Math.max(0, scroller.scrollTop / settledRange))
                : 0;
            growRef.current(scroller);
            paintProgress(scroller, currentLineRef.current);
            onScroll = () => {
                if (reportFrame) {
                    return;
                }
                reportFrame = requestAnimationFrame(() => {
                    reportFrame = 0;
                    report();
                });
            };
            scroller.addEventListener("scroll", onScroll, { passive: true });
            if (debugLoggingEnabled()) {
                logGuidesDebug(
                    "restore",
                    props.surface,
                    `asked=${restoreLineRef.current ?? -1} landed=${landedOn} `
                    + `frames=${settleAttempts} pages=${winRef.current.from}..${winRef.current.to}/${windowedPages?.length ?? 0} `
                    + `anchors=${anchorsRef.current.length} `
                    + `scroller=${scroller === frameRef.current ? "frame" : "inner"} `
                    + `scrollTop=${Math.round(scroller.scrollTop)} range=${Math.round(scroller.scrollHeight - scroller.clientHeight)}`
                );
            }
        };

        const settle = () => {
            if (!scroller) {
                finish();
                return;
            }
            held = !grewFrame
                && applied !== null
                && Math.abs(scroller.scrollTop - applied) <= RESTORE_TOLERANCE_PX
                ? held + 1
                : 0;
            grewFrame = false;
            const reachable = applyRestore();
            applied = scroller.scrollTop;
            settleAttempts += 1;
            const done = reachable && held >= RESTORE_STABLE_FRAMES;
            if (!done && settleAttempts < settleBudget) {
                frame = requestAnimationFrame(settle);
                return;
            }
            finish();
        };

        const settleBudget = RESTORE_SETTLE_FRAMES + (windowedPages ? windowedPages.length : 0);
        let settleAttempts = 0;
        let applied: number | null = null;
        let held = 0;
        let grewFrame = false;
        let climbStartedAt = 0;
        const attach = () => {
            const host = hostRef.current;
            scroller = findScroller(host, frameRef.current);
            if (!scroller || !host) {
                attempts += 1;
                if (attempts < RESTORE_MAX_FRAMES) {
                    frame = requestAnimationFrame(attach);
                    return;
                }
                setRevealed(true);
                return;
            }
            settle();
        };

        frame = requestAnimationFrame(attach);
        return () => {
            cancelAnimationFrame(frame);
            if (reportFrame) {
                cancelAnimationFrame(reportFrame);
            }
            anchorsRef.current = [];
            anchorsAtRef.current = -1;
            scrollerRef.current = null;
            if (scroller && onScroll) {
                scroller.removeEventListener("scroll", onScroll);
            }
        };
    }, [content, props.restoreToken]);

    const reanchorToLine = () => {
        const host = hostRef.current;
        const scroller = scrollerRef.current;
        if (!host || !scroller) {
            return;
        }
        const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
        const anchors = readLineAnchors(host, scroller);
        anchorsRef.current = anchors;
        anchorsAtRef.current = scroller.scrollHeight;
        const line = currentLineRef.current;
        if (anchors.length > 0 && line !== null) {
            scroller.scrollTop = lineToOffset(anchors, line, origin, currentIntoRef.current);
            return;
        }
        const fraction = currentFractionRef.current;
        if (fraction !== null) {
            scroller.scrollTop = fraction * (scroller.scrollHeight - scroller.clientHeight);
        }
    };

    const [zoomPass, setZoomPass] = useState(0);
    const zoomSeenRef = useRef(false);
    useLayoutEffect(() => {
        if (!zoomSeenRef.current) {
            zoomSeenRef.current = true;
            return;
        }
        pageHeightsRef.current = new Map();
        setZoomPass((pass) => pass + 1);
    }, [props.zoom]);

    useEffect(() => {
        const host = hostRef.current;
        const view = host?.ownerDocument?.defaultView;
        if (!host || !view || !windowedPages) {
            return;
        }
        let last = host.getBoundingClientRect().width;
        const observer = new view.ResizeObserver(() => {
            const now = host.getBoundingClientRect().width;
            if (Math.abs(now - last) < 0.5) {
                return;
            }
            last = now;
            pageHeightsRef.current = new Map();
            setZoomPass((pass) => pass + 1);
        });
        observer.observe(host);
        return () => observer.disconnect();
    }, [windowedPages]);

    useLayoutEffect(() => {
        if (zoomPass === 0) {
            return;
        }
        reanchorToLine();
        const scroller = scrollerRef.current;
        if (scroller) {
            growRef.current(scroller);
        }
    }, [zoomPass]);

    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!windowedPages || !scroller) {
            return;
        }
        const frame = requestAnimationFrame(() => growRef.current(scroller));
        return () => cancelAnimationFrame(frame);
    }, [props.zoom]);


    const progressRef = useRef<HTMLDivElement | null>(null);
    const viewLinesRef = useRef(0);
    const paintProgress = (scroller: HTMLElement, line: number | null) => {
        const mark = progressRef.current;
        if (!mark) {
            return;
        }
        let at = 0;
        if (windowedPages && windowedPages.length > 0 && line !== null) {
            const end = windowedPages[windowedPages.length - 1].endLine;
            const reach = end - 1 - viewLinesRef.current;
            at = reach > 0 ? line / reach : (end > 1 ? line / (end - 1) : 0);
        }
        else {
            const range = scroller.scrollHeight - scroller.clientHeight;
            at = range > 0 ? scroller.scrollTop / range : 0;
        }
        const pct = Math.min(1, Math.max(0, at)) * 100;
        mark.style.top = `${pct}%`;
        mark.style.transform = `translateY(-${pct}%)`;
    };

    useEffect(() => {
        const host = hostRef.current;
        const doc = host?.ownerDocument;
        const view = doc?.defaultView;
        if (!host || !doc || !view) {
            return;
        }
        const registry = view.CSS.highlights;
        const drop = () => {
            registry.delete(HIGHLIGHT_MATCH);
            registry.delete(HIGHLIGHT_CURRENT);
        };
        const term = props.searchTerm ?? "";
        if (term.length === 0) {
            drop();
            return;
        }
        if (!revealed) {
            return;
        }
        const all: Range[] = [];
        const current: Range[] = [];
        for (const block of Array.from(host.querySelectorAll("[data-guide-line]"))) {
            const text = block.textContent ?? "";
            const hits = findFolded(text, term);
            if (hits.length === 0) {
                continue;
            }
            const spans: Array<{ node: Node; from: number; to: number }> = [];
            const walker = doc.createTreeWalker(block, view.NodeFilter.SHOW_TEXT);
            let at = 0;
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const length = node.nodeValue?.length ?? 0;
                spans.push({ node, from: at, to: at + length });
                at += length;
            }
            const onCurrent = Number(block.getAttribute("data-guide-line")) === props.searchAnchor;
            hits.forEach((hit, occurrence) => {
                const opens = spans.find((span) => hit.start >= span.from && hit.start < span.to);
                const closes = spans.find((span) => hit.end > span.from && hit.end <= span.to);
                if (!opens || !closes) {
                    return;
                }
                const range = doc.createRange();
                range.setStart(opens.node, hit.start - opens.from);
                range.setEnd(closes.node, hit.end - closes.from);
                all.push(range);
                if (onCurrent && occurrence === props.searchOccurrence) {
                    current.push(range);
                }
            });
        }
        registry.set(HIGHLIGHT_MATCH, new view.Highlight(...all));
        registry.set(HIGHLIGHT_CURRENT, new view.Highlight(...current));

        const scroller = scrollerRef.current;
        const token = props.searchJumpToken ?? 0;
        const anchor = props.searchAnchor ?? null;
        if (scroller && anchor !== null && alignedForRef.current !== token) {
            if (windowedPages) {
                const box = scroller.clientHeight;
                const now = winRef.current;
                if (box > 0 && now.to < windowedPages.length) {
                    const ahead = pagesToCover(
                        box * WINDOW_SCREENS,
                        scroller.scrollHeight - now.spacer,
                        now.to - now.from
                    );
                    const need = Math.min(
                        windowedPages.length - 1,
                        findChunkForLine(windowedPages, anchor) + ahead
                    );
                    if (now.to <= need && mountThrough(need)) {
                        return drop;
                    }
                }
            }
            const block = host.querySelector(`[data-guide-line="${anchor}"]`);
            const exact = current[0]?.getClientRects()[0] ?? null;
            const rect = exact ?? block?.getBoundingClientRect() ?? null;
            if (debugLoggingEnabled()) {
                const boxTop = scroller.getBoundingClientRect().top;
                logGuidesDebug(
                    "search",
                    props.surface,
                    `anchor=${anchor} occ=${props.searchOccurrence ?? -1} token=${token} `
                    + `range=${exact ? "exact" : (block ? "BLOCK-FALLBACK" : "none")} `
                    + `ranges=${current.length}/${all.length} `
                    + `into=${rect ? Math.round(rect.top - boxTop) : -1} box=${scroller.clientHeight} `
                    + `pages=${winRef.current.from}..${winRef.current.to}/${windowedPages?.length ?? 0} `
                    + `scrollTop=${Math.round(scroller.scrollTop)} `
                    + `below=${Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)}`
                );
            }
            if (rect) {
                alignedForRef.current = token;
                scroller.scrollTop += rect.top
                    - scroller.getBoundingClientRect().top
                    - SEARCH_MATCH_MARGIN_PX;
                grewAtRef.current = { height: -1, top: -1, at: 0 };
                if (debugLoggingEnabled()) {
                    const after = current[0]?.getClientRects()[0] ?? null;
                    logGuidesDebug(
                        "search",
                        props.surface,
                        `landed scrollTop=${Math.round(scroller.scrollTop)} `
                        + `hitAt=${after ? Math.round(after.top - scroller.getBoundingClientRect().top) : -1} `
                        + `box=${scroller.clientHeight}`
                    );
                }
            }
            else if (windowedPages) {
                mountThrough(findChunkForLine(windowedPages, anchor));
            }
        }
        return drop;
    }, [
        props.searchTerm,
        props.searchAnchor,
        props.searchOccurrence,
        props.searchJumpToken,
        content,
        win,
        revealed,
    ]);

    const boxHeight = props.maxHeightCss ?? (fullHeight ? "62vh" : "64vh");
    const scrollStyle = {
        flex: 1,
        minHeight: fullHeight ? 0 : boxHeight,
        maxHeight: boxHeight,
        width: "100%",
    };

    function handleEscape() {
        onEscape?.();
    }

    const parsed = useMemo(
        () => {
            if (!content) {
                return null;
            }
            if (!windowedPages) {
                return <div dangerouslySetInnerHTML={{ __html: sanitizeGuideHtml(content.html) }} />;
            }
            const out: ReactNode[] = [];
            if (win.spacer > 0) {
                out.push(<div key="above" style={{ height: `${win.spacer}px` }} />);
            }
            const end = Math.min(windowedPages.length, win.to);
            for (let i = win.from; i < end; i += 1) {
                out.push(parsePage(i));
            }
            return out;
        },
        [content?.html, windowedPages, win]
    );

    const inner = content ? (
        <div
            ref={hostRef}
            className={bodyClass}
            style={{
                padding: "8px 10px",
                maxWidth: "100%",
                minWidth: 0,
                overflowWrap: "anywhere",
                fontSize: `${bodyFont}px`,
                lineHeight: 1.5,
                opacity: revealed ? 1 : 0,
                ...(isFormatted
                    ? { filter: INVERT_FILTER, background: "#ffffff", color: "#000000" }
                    : {}),
            }}
        >
            <style>
                {`${isFormatted ? `.${bodyClass} img { filter: ${INVERT_FILTER}; max-width: 100%; }` : ""}
                  .${bodyClass} pre, .${bodyClass} .${CHUNK_BLOCK_CLASS} { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font-family: monospace; margin: 0; max-width: 100%; }
                  .${bodyClass} table { max-width: 100%; }
                  ${props.searchTerm === undefined ? "" : searchHighlightCss(isFormatted)}`}
            </style>
            {parsed}
            {measuring && windowedPages ? (
                <div style={{ position: "relative", height: 0, overflow: "hidden" }} aria-hidden={true}>
                    <div ref={measureRef} style={{ position: "absolute", top: 0, left: 0, width: "100%" }}>
                        {Array.from({ length: measuring.count }, (_unused, at) => (
                            <div key={measuring.from + at} className={CHUNK_BLOCK_CLASS}>
                                {pageText(measuring.from + at)}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    ) : (
        <div style={{ padding: "8px 10px" }} />
    );

    const frame = {
        border: released
            ? "1px solid rgba(255,255,255,0.45)"
            : bodyFocused ? "1px solid #4a9eff" : "1px solid rgba(255,255,255,0.10)",
        borderRadius: "6px",
        boxShadow: bodyFocused && !released ? "0 0 0 2px rgba(74,158,255,0.55)" : "none",
        overflow: "hidden",
        position: "relative" as const,
        overflowAnchor: "none" as const,
        display: "flex",
        flexDirection: "column" as const,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        margin: props.surface === "panel" ? "10px 0" : "0",
        ...(fullHeight ? {} : { scrollMarginTop: "24px", scrollMarginBottom: "24px" }),
    };

    if (ScrollPanelGroup) {
        return (
            <div ref={frameRef} style={frame}>
                <ScrollPanelGroup focusable={false} style={scrollStyle}>
                    <Focusable
                        focusable={!released}
                        onActivate={props.onActivate ?? (() => { })}
                        noFocusRing={true}
                        onCancelButton={handleEscape}
                        onOKActionDescription={props.activateLabel ?? undefined}
                        onCancelActionDescription={props.escapeLabel
                            ?? (props.onEscape ? undefined : "")}
                        onSecondaryActionDescription={props.exitable ? t(language, "Exit Text") : undefined}

                        onSecondaryButton={props.exitable ? () => setReleased(true) : undefined}
                        onOptionsActionDescription={props.onBookmark ? t(language, "Bookmark") : undefined}
                        actionDescriptionMap={(props.onZoom || props.onPageTurn || props.onSearchStep)
                            ? {
                                ...(props.onSearchStep
                                    ? { [BUMPER_LEFT]: legendGlyph("‹"), [BUMPER_RIGHT]: legendGlyph("›") }
                                    : props.onPageTurn
                                        ? { [BUMPER_LEFT]: legendGlyph("«"), [BUMPER_RIGHT]: legendGlyph("»") }
                                        : {}),
                                ...(props.onZoom ? { [BUTTON_TRIGGER_LEFT]: legendGlyph("−"), [BUTTON_TRIGGER_RIGHT]: legendGlyph("+") } : {}),
                            }
                            : undefined}
                        onOptionsButton={props.onBookmark
                            ? () => props.onBookmark?.(
                                currentLineRef.current ?? props.restoreLine ?? 0,
                                currentIntoRef.current
                            )
                            : undefined}
                        onButtonDown={(props.onZoom || props.onPageTurn || props.onSearchStep)
                            ? (evt: { detail?: { button?: number } }) => {
                                const button = evt?.detail?.button;
                                const shoulder = props.onSearchStep ?? props.onPageTurn;
                                if (button === BUMPER_LEFT) {
                                    shoulder?.(-1);
                                }
                                else if (button === BUMPER_RIGHT) {
                                    shoulder?.(1);
                                }
                                else if (button === BUTTON_TRIGGER_LEFT) {
                                    props.onZoom?.(-1);
                                }
                                else if (button === BUTTON_TRIGGER_RIGHT) {
                                    props.onZoom?.(1);
                                }
                            }
                            : undefined}
                        fnScrollIntoViewHandler={() => true}
                        onGamepadFocus={() => {
                            bodyFocusedRef.current = true;
                            setBodyFocused(true);
                            requestAnimationFrame(() => {
                                frameRef.current?.scrollIntoView({ block: "nearest" });
                            });
                        }}
                        onGamepadBlur={() => {
                            bodyFocusedRef.current = false;
                            setBodyFocused(false);
                        }}
                    >
                        {inner}
                    </Focusable>
                </ScrollPanelGroup>
                {props.showProgress && (
                    <div
                        style={{
                            position: "absolute",
                            top: "6px",
                            bottom: "6px",
                            right: "3px",
                            width: `${PROGRESS_TRACK_PX}px`,
                            borderRadius: `${PROGRESS_TRACK_PX}px`,
                            background: "rgba(255, 255, 255, 0.10)",
                            pointerEvents: "none",
                            opacity: revealed ? 1 : 0,
                        }}
                    >
                        <div
                            ref={progressRef}
                            style={{
                                position: "absolute",
                                left: 0,
                                width: `${PROGRESS_TRACK_PX}px`,
                                height: `${PROGRESS_MARK_PX}px`,
                                borderRadius: `${PROGRESS_TRACK_PX}px`,
                                background: "rgba(255, 255, 255, 0.55)",
                            }}
                        />
                    </div>
                )}
                {released && (
                    <Focusable
                        autoFocus
                        onGamepadBlur={() => setReleased(false)}
                        style={{ display: "flex", padding: "1px 4px 2px" }}
                    >
                        <DialogButton
                            onClick={() => setReleased(false)}
                            style={{ minWidth: 0, width: "100%", height: "4px", padding: 0, opacity: 0.25 }}
                        />
                    </Focusable>
                )}
            </div>
        );
    }
    return (
        <div ref={frameRef} style={{ ...frame, ...scrollStyle, overflowY: "auto" }}>
            {inner}
        </div>
    );
}
