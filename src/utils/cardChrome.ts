export type CardChrome = {
    top: number;
    right: number;
};

export const ASSUMED_MODAL_CHROME: CardChrome = { top: 12, right: 12 };

export type CornerParts = {
    anchor: HTMLElement;
    card: HTMLElement;
    box: HTMLElement;
    button: HTMLElement;
};

export function cornerPartsFor(keyed: Element): CornerParts | null {
    const anchor = keyed.parentElement;
    if (!anchor) {
        return null;
    }
    const card = keyed.querySelector("button");
    if (!card) {
        return null;
    }
    for (const sibling of Array.from(anchor.children)) {
        if (sibling === keyed || sibling.contains(keyed)) {
            continue;
        }
        if (getComputedStyle(sibling).position !== "absolute") {
            continue;
        }
        const button = sibling.querySelector("button");
        if (!button) {
            continue;
        }
        return {
            anchor: anchor as HTMLElement,
            card: card as HTMLElement,
            box: sibling as HTMLElement,
            button: button as HTMLElement
        };
    }
    return null;
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

export function chromeFrom(parts: CornerParts): CardChrome {
    const anchorBox = parts.anchor.getBoundingClientRect();
    const cardBox = parts.card.getBoundingClientRect();
    return {
        top: round(cardBox.top - anchorBox.top),
        right: round(anchorBox.right - cardBox.right)
    };
}

export function findCardChrome(doc: Document, focusKeyPrefix: string): CardChrome | null {
    for (const keyed of Array.from(doc.querySelectorAll(`[data-focus-key^="${focusKeyPrefix}"]`))) {
        const parts = cornerPartsFor(keyed);
        if (parts) {
            return chromeFrom(parts);
        }
    }
    return null;
}
