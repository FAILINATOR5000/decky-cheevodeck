const SCROLL_RANGE_MIN_PX = 4;
const ANCHOR_EDGE_SLACK_PX = 1;

export type LineAnchor = {
    node: HTMLElement;
    line: number;
    span: number;
    top: number;
    height: number;
};

function lineTopWithin(block: HTMLElement, lineInBlock: number, origin: number): number | null {
    const node = block.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
        return null;
    }
    const text = node.nodeValue ?? "";
    let start = 0;
    for (let i = 0; i < lineInBlock; i += 1) {
        const nextBreak = text.indexOf("\n", start);
        if (nextBreak < 0) {
            return null;
        }
        start = nextBreak + 1;
    }
    if (start >= text.length) {
        return null;
    }
    const range = (block.ownerDocument ?? document).createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 1);
    const rects = range.getClientRects();
    if (rects.length === 0) {
        return null;
    }
    return rects[0].top - origin;
}

function lineAtOffsetWithin(anchor: LineAnchor, offset: number, origin: number): number | null {
    let low = 0;
    let high = anchor.span - 1;
    let best: number | null = null;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const top = lineTopWithin(anchor.node, mid, origin);
        if (top === null) {
            return null;
        }
        if (top <= offset + 1) {
            best = mid;
            low = mid + 1;
        }
        else {
            high = mid - 1;
        }
    }
    return best;
}

function measureAnchor(node: HTMLElement, origin: number): LineAnchor | null {
    const line = Number(node.getAttribute("data-guide-line"));
    const span = Number(node.getAttribute("data-guide-lines"));
    if (!Number.isFinite(line) || !Number.isFinite(span) || span <= 0) {
        return null;
    }
    return {
        node,
        line,
        span,
        top: node.getBoundingClientRect().top - origin,
        height: node.offsetHeight,
    };
}

export function readLineAnchors(host: HTMLElement, scroller: HTMLElement): LineAnchor[] {
    const nodes = Array.from(host.querySelectorAll("[data-guide-line]")) as HTMLElement[];
    if (nodes.length === 0) {
        return [];
    }
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const anchors: LineAnchor[] = [];
    for (const node of nodes) {
        const anchor = measureAnchor(node, origin);
        if (anchor) {
            anchors.push(anchor);
        }
    }
    return anchors;
}

export function refreshLineAnchors(
    host: HTMLElement,
    scroller: HTMLElement,
    cached: LineAnchor[]
): LineAnchor[] {
    if (cached.length === 0) {
        return readLineAnchors(host, scroller);
    }
    const known = new Map<HTMLElement, LineAnchor>();
    for (const anchor of cached) {
        known.set(anchor.node, anchor);
    }
    const nodes = Array.from(host.querySelectorAll("[data-guide-line]")) as HTMLElement[];
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const anchors: LineAnchor[] = [];
    for (const node of nodes) {
        const hit = known.get(node);
        if (hit) {
            anchors.push(hit);
            continue;
        }
        const anchor = measureAnchor(node, origin);
        if (anchor) {
            anchors.push(anchor);
        }
    }
    return anchors;
}

export function lineToOffset(anchors: LineAnchor[], line: number, origin: number, blockInto = 0): number {
    if (anchors.length === 0) {
        return 0;
    }
    let found = anchors[0];
    for (const anchor of anchors) {
        if (anchor.line <= line) {
            found = anchor;
        }
    }
    if (found.span <= 1 && blockInto > 0) {
        return found.top + Math.min(1, blockInto) * found.height;
    }
    const exact = lineTopWithin(found.node, line - found.line, origin);
    if (exact !== null) {
        return Math.max(found.top, Math.min(found.top + found.height, exact));
    }
    const into = Math.min(1, Math.max(0, (line - found.line) / found.span));
    return found.top + into * found.height;
}

export function offsetToLine(anchors: LineAnchor[], offset: number, origin: number): { line: number; into: number } {
    if (anchors.length === 0) {
        return { line: 0, into: 0 };
    }
    let found = anchors[0];
    for (const anchor of anchors) {
        if (anchor.top <= offset + ANCHOR_EDGE_SLACK_PX) {
            found = anchor;
        }
    }
    if (found.span > 1) {
        const exact = lineAtOffsetWithin(found, offset, origin);
        if (exact !== null) {
            const line = found.line + exact;
            const top = lineTopWithin(found.node, exact, origin);
            if (top !== null && top < offset - ANCHOR_EDGE_SLACK_PX) {
                const end = anchors[anchors.length - 1];
                return { line: Math.min(line + 1, end.line + Math.max(0, end.span - 1)), into: 0 };
            }
            return { line, into: 0 };
        }
    }
    if (found.height <= 0) {
        return { line: found.line, into: 0 };
    }
    const into = Math.min(1, Math.max(0, (offset - found.top) / found.height));
    if (found.span <= 1) {
        return { line: found.line, into };
    }
    const line = found.line + Math.round(into * found.span);
    const last = anchors[anchors.length - 1];
    return { line: Math.min(line, last.line + Math.max(0, last.span - 1)), into: 0 };
}

export function findScroller(start: HTMLElement | null, boundary: HTMLElement | null): HTMLElement | null {
    let loose: HTMLElement | null = null;
    let node: HTMLElement | null = start;
    const doc = start?.ownerDocument ?? document;
    const view = doc.defaultView ?? window;
    while (node && node !== doc.body) {
        if (node.scrollHeight - node.clientHeight > SCROLL_RANGE_MIN_PX) {
            const overflowY = view.getComputedStyle(node).overflowY;
            if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
                return node;
            }
            if (!loose) {
                loose = node;
            }
        }
        if (boundary && node === boundary) {
            break;
        }
        node = node.parentElement;
    }
    return loose;
}
