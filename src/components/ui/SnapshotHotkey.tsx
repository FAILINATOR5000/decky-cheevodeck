import { useEffect, useRef } from "react";

import type { LanguageCode } from "../../locales";
import { captureSnapshot } from "../../utils/snapshot";
import { isSnapshotPress } from "../../utils/snapshotHotkey";

const claimed = new WeakSet<Event>();

export function SnapshotHotkey(props: { language: LanguageCode }) {
    const { language } = props;
    const markerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const doc = markerRef.current?.ownerDocument;
        if (!doc) {
            return;
        }
        const onButtonDown = (evt: Event) => {
            const code = (evt as CustomEvent<{ button?: number }>).detail?.button;
            if (code === undefined || !isSnapshotPress(code)) {
                return;
            }
            if (claimed.has(evt)) {
                return;
            }
            claimed.add(evt);
            void captureSnapshot(language);
        };
        doc.addEventListener("vgp_onbuttondown", onButtonDown, true);
        return () => {
            doc.removeEventListener("vgp_onbuttondown", onButtonDown, true);
        };
    }, [language]);

    return <div ref={markerRef} style={{ display: "none" }} />;
}
