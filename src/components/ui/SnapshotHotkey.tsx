import { useEffect, useRef } from "react";

import type { LanguageCode } from "../../locales";
import type { ShortcutButton } from "../../types";
import { SHORTCUT_BUTTON_BY_CODE } from "../../utils/gamepadButtons";
import { captureSnapshot } from "../../utils/snapshot";
import { isSnapshotPress } from "../../utils/snapshotHotkey";

const claimed = new WeakSet<Event>();

export function SnapshotHotkey(props: { language: LanguageCode; reservedButtons?: ShortcutButton[] }) {
    const { language, reservedButtons } = props;
    const markerRef = useRef<HTMLDivElement | null>(null);
    const reservedKey = (reservedButtons ?? []).join(",");

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
            const pressed = SHORTCUT_BUTTON_BY_CODE[code];
            if (pressed && reservedKey.split(",").includes(pressed)) {
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
    }, [language, reservedKey]);

    return <div ref={markerRef} style={{ display: "none" }} />;
}
