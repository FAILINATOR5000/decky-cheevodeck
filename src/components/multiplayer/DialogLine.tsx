import { useLayoutEffect, useRef, useState } from "react";

import type { LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { achievementGreen, errorRed, modalBodyStyle } from "../../utils/style";
import { showMultiplayerProblem } from "./ProblemModal";

type DialogLineTone = "hint" | "busy" | "ok" | "error";

export type DialogLineState = { tone: DialogLineTone; text: string };

export function useDialogLine(language: LanguageCode, idle: DialogLineState) {
    const [line, setLine] = useState<DialogLineState>(idle);
    function fail(titleKey: string, text: string) {
        setLine(idle);
        showMultiplayerProblem(language, titleKey, text);
    }
    return { line, setLine, fail };
}

export function DialogLine(props: DialogLineState & { beside?: boolean }) {
    const { tone, text, beside } = props;
    const colored = tone === "ok" || tone === "error";
    const lineRef = useRef<HTMLDivElement | null>(null);
    const tallest = useRef(0);

    useLayoutEffect(() => {
        const line = lineRef.current;
        if (line && line.offsetHeight > tallest.current) {
            tallest.current = line.offsetHeight;
            line.style.minHeight = `${tallest.current}px`;
        }
    });

    return (
        <div
            ref={lineRef}
            style={{
                ...modalBodyStyle(),
                minHeight: `${2 * 1.35 * modalSize(12)}px`,
                marginTop: beside ? 0 : "8px",
                ...(beside ? { flex: 1, minWidth: 0, alignSelf: "center" } : {}),
                color: tone === "ok" ? achievementGreen : tone === "error" ? errorRed : undefined,
                opacity: colored ? 1 : 0.85,
                overflowWrap: "anywhere"
            }}
        >
            {text}
        </div>
    );
}
