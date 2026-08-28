import type { CSSProperties } from "react";
import type { LanguageCode } from "../../locales";
import { highestAwardLabel } from "../../pages/AllGamesPage";
import { bannerSize } from "../../utils/scale";

const AWARD_ACCENTS: Record<string, string> = {
    mastered: "251, 191, 36",
    completed: "52, 211, 153",
    "beaten-hardcore": "251, 146, 60",
    "beaten-softcore": "56, 189, 248"
};

export function AwardStatusBadge(props: {
    language: LanguageCode;
    kind: string | null | undefined;
    style?: CSSProperties;
}) {
    const kind = String(props.kind || "").trim().toLowerCase();
    const accent = AWARD_ACCENTS[kind];
    if (!accent) {
        return null;
    }

    const fontSize = bannerSize(11);

    return (
        <div style={{ display: "flex", ...props.style }}>
            <div
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    fontSize: `${fontSize}px`,
                    lineHeight: 1,
                    fontWeight: 800,
                    padding: "2px 6px",
                    borderRadius: "8px",
                    background: `rgba(${accent}, 0.18)`,
                    border: `1px solid rgba(${accent}, 0.45)`,
                    color: `rgb(${accent})`
                }}
            >
                {highestAwardLabel(kind, props.language)}
            </div>
        </div>
    );
}
