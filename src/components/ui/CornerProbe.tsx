import { useEffect, useRef } from "react";

import { debugLoggingEnabled, logCardCornerDebug } from "../../api";
import { chromeFrom, cornerPartsFor } from "../../utils/cardChrome";
import { getCurrentModalScale, getCurrentTextScale } from "../../utils/scale";

type CornerProbeProps = {
    surface: string;
};

type CornerReading = {
    chromeTop: number;
    chromeRight: number;
    cssTop: string;
    cssRight: string;
    gapTop: number;
    gapRight: number;
    button: number;
    cardHeight: number;
};

const MAX_ATTEMPTS = 6;

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function focusKeyFamily(key: string): string {
    const cut = key.indexOf(":");
    return cut === -1 ? key : key.slice(0, cut + 1);
}

function readCorner(keyed: Element): CornerReading | null {
    const parts = cornerPartsFor(keyed);
    if (!parts) {
        return null;
    }
    const chrome = chromeFrom(parts);
    const style = getComputedStyle(parts.box);
    const cardBox = parts.card.getBoundingClientRect();
    const buttonBox = parts.button.getBoundingClientRect();
    return {
        chromeTop: chrome.top,
        chromeRight: chrome.right,
        cssTop: style.top,
        cssRight: style.right,
        gapTop: round(buttonBox.top - cardBox.top),
        gapRight: round(cardBox.right - buttonBox.right),
        button: round(buttonBox.width),
        cardHeight: round(cardBox.height)
    };
}

export function CornerProbe(props: CornerProbeProps) {
    const markerRef = useRef<HTMLDivElement | null>(null);
    const doneRef = useRef(false);
    const attemptsRef = useRef(0);

    useEffect(() => {
        if (!debugLoggingEnabled() || doneRef.current) {
            return;
        }
        const marker = markerRef.current;
        if (!marker) {
            return;
        }
        attemptsRef.current += 1;
        if (attemptsRef.current >= MAX_ATTEMPTS) {
            doneRef.current = true;
        }
        const frame = requestAnimationFrame(() => {
            const doc = marker.ownerDocument;
            const seen = new Set<string>();

            logCardCornerDebug("viewport", props.surface, [
                `dpr=${window.devicePixelRatio}`,
                `css=${doc.defaultView?.innerWidth}x${doc.defaultView?.innerHeight}`,
                `modalScale=${getCurrentModalScale()}`,
                `textScale=${getCurrentTextScale()}`
            ].join(" "));

            for (const keyed of Array.from(doc.querySelectorAll("[data-focus-key]"))) {
                const key = keyed.getAttribute("data-focus-key") || "";
                const family = focusKeyFamily(key);
                if (seen.has(family)) {
                    continue;
                }
                const reading = readCorner(keyed);
                if (!reading) {
                    continue;
                }
                seen.add(family);
                logCardCornerDebug(props.surface, family, [
                    `chromeT=${reading.chromeTop}`,
                    `chromeR=${reading.chromeRight}`,
                    `cssT=${reading.cssTop}`,
                    `cssR=${reading.cssRight}`,
                    `gapT=${reading.gapTop}`,
                    `gapR=${reading.gapRight}`,
                    `btn=${reading.button}`,
                    `card=${reading.cardHeight}`
                ].join(" "));
            }

            if (seen.size > 0) {
                doneRef.current = true;
            }
        });
        return () => {
            cancelAnimationFrame(frame);
        };
    });

    return <div ref={markerRef} style={{ display: "none" }} />;
}
