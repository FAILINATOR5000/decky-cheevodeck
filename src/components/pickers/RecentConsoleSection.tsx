import type { ReactNode } from "react";
import { t, type LanguageCode } from "../../locales";
import { smallTextStyle } from "../../utils/style";

export function resolveRecentConsole<T extends { id: number }>(
    consoles: T[],
    recentId: number
): T | null {
    if (!recentId) {
        return null;
    }
    return consoles.find((item) => item.id === recentId) ?? null;
}

export function consolesWithoutRecent<T extends { id: number }>(
    consoles: T[],
    recent: T | null
): T[] {
    if (!recent) {
        return consoles;
    }
    return consoles.filter((item) => item.id !== recent.id);
}

export function RecentConsoleSection(props: { language: LanguageCode; children: ReactNode }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div
                style={{
                    ...smallTextStyle(),
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    opacity: 0.75
                }}
            >
                {t(props.language, "Recent")}
            </div>
            {props.children}
            {
}
            <div
                style={{
                    height: "3px",
                    borderRadius: "2px",
                    background: "rgba(255,255,255,0.28)",
                    marginTop: "6px",
                    marginBottom: "4px"
                }}
            />
        </div>
    );
}
