import { useLayoutEffect, useRef, useState } from "react";

import { ASSUMED_MODAL_CHROME, findCardChrome, type CardChrome } from "../utils/cardChrome";

const UNMEASURED = Symbol("unmeasured");

export function useCardChrome(focusKeyPrefix: string, remeasureToken: unknown) {
    const markerRef = useRef<HTMLDivElement | null>(null);
    const [chrome, setChrome] = useState<CardChrome>(ASSUMED_MODAL_CHROME);
    const measuredForRef = useRef<unknown>(UNMEASURED);

    useLayoutEffect(() => {
        if (measuredForRef.current === remeasureToken) {
            return;
        }
        const doc = markerRef.current?.ownerDocument;
        if (!doc) {
            return;
        }
        const measured = findCardChrome(doc, focusKeyPrefix);
        if (!measured) {
            return;
        }
        measuredForRef.current = remeasureToken;
        setChrome((current) => (
            current.top === measured.top && current.right === measured.right ? current : measured
        ));
    });

    return { chrome, markerRef };
}
