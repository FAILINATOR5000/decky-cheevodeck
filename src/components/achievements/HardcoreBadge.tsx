import type { CSSProperties } from "react";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";

export function HardcoreBadge(props: {
    language: LanguageCode;
    fontSize: number;
    short?: boolean;
    style?: CSSProperties;
}) {
    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                fontSize: `${props.fontSize}px`,
                lineHeight: 1,
                fontWeight: 800,
                padding: "2px 6px",
                borderRadius: "8px",
                background: "rgba(244, 63, 94, 0.18)",
                border: "1px solid rgba(244, 63, 94, 0.45)",
                color: "#f43f5e",
                ...props.style
            }}
        >
            {t(props.language, props.short ? "HC" : "Hardcore")}
        </div>
    );
}
