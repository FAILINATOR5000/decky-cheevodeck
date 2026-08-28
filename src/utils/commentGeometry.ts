const RESTORE_LEAD = 6;

const MIN_SPACER_ROWS = 12;

export type CommentWindowGeometry = {
    windowStart: number;
    spacerPx: number;
};

export function measureCommentWindow(
    root: HTMLElement | null,
    focusKeyPrefix: string,
    focusIndex: number
): CommentWindowGeometry | null {
    if (!root || focusIndex < 0) {
        return null;
    }

    const mounted = new Map<number, Element>();
    for (const card of Array.from(root.querySelectorAll(`[data-focus-key^="${focusKeyPrefix}:"]`))) {
        const key = card.getAttribute("data-focus-key") || "";
        const suffix = key.slice(focusKeyPrefix.length + 1);
        if (!/^\d+$/.test(suffix)) {
            continue;
        }
        mounted.set(Number(suffix), card);
    }
    if (mounted.size === 0) {
        return null;
    }

    const firstMounted = Math.min(...mounted.keys());
    const windowStart = Math.max(firstMounted, focusIndex - RESTORE_LEAD);
    if (windowStart < MIN_SPACER_ROWS) {
        return { windowStart: 0, spacerPx: 0 };
    }
    const target = mounted.get(windowStart);
    const firstCard = mounted.get(firstMounted);
    const container = target?.parentElement;
    if (!target || !firstCard || !container) {
        return null;
    }

    const held = container.querySelector("[data-comment-spacer]");
    const heldPx = held ? held.getBoundingClientRect().height : 0;
    const abovePx = target.getBoundingClientRect().top - firstCard.getBoundingClientRect().top;
    return { windowStart, spacerPx: Math.max(0, Math.round(heldPx + abovePx)) };
}
