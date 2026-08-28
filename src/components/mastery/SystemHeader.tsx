import { useEffect } from "react";
import { PanelSectionRow } from "@decky/ui";
import { logSysviewDebug } from "../../api";
import {
    consoleDisplayName,
    consoleFact,
    consoleMaker,
    consoleReleaseYear
} from "../../utils/consoles";
import { type LanguageCode } from "../../locales";
import type { TrackedSetViewMode } from "../../types";
import { type AchievementUiMetrics, smallTextStyle } from "../../utils/style";
import { gamesCountLabel } from "../../utils/achievements";

type SystemHeaderProps = {
    viewMode: TrackedSetViewMode;
    consoleName: string;
    count: number;
    iconUrl: string;
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
};

export function SystemHeader(props: SystemHeaderProps) {
    const { viewMode, consoleName, count, iconUrl, language, showIcons, metrics } = props;

    const name = consoleDisplayName(consoleName);
    const year = consoleReleaseYear(consoleName);
    const maker = consoleMaker(consoleName);
    const fact = consoleFact(consoleName);

    useEffect(() => {
        if (consoleName.trim() && year === null) {
            logSysviewDebug("unknown-console", consoleName, `view=${viewMode}`);
        }
    }, [consoleName, year, viewMode]);

    const iconSize = Math.round(metrics.iconSize * 0.72);
    const fallbackLetter = name.trim().charAt(0).toUpperCase() || "?";

    const icon = showIcons ? (
        <div
            style={{
                width: `${iconSize}px`,
                height: `${iconSize}px`,
                borderRadius: "6px",
                overflow: "hidden",
                flexShrink: 0,
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: `${Math.max(13, iconSize * 0.42)}px`,
                fontWeight: 800
            }}
        >
            {iconUrl ? (
                <img
                    src={iconUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                />
            ) : (
                fallbackLetter
            )}
        </div>
    ) : null;

    const countText = gamesCountLabel(language, count);

    if (viewMode === "system" || viewMode === "systemYear") {
        return (
            <PanelSectionRow>
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                        padding: "8px 0 2px 0",
                        minWidth: 0
                    }}
                >
                    {icon}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: "8px" }}>
                        <span
                            style={{
                                fontSize: `${metrics.titleFontSize}px`,
                                lineHeight: metrics.titleLineHeight,
                                fontWeight: 800,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {name}
                        </span>
                        <span style={{ ...smallTextStyle(), fontSize: `${metrics.bodyFontSize}px` }}>
                            {countText}
                        </span>
                    </div>
                </div>
            </PanelSectionRow>
        );
    }

    const metaParts: string[] = [];
    if (year !== null) {
        metaParts.push(String(year));
    }
    if (maker) {
        metaParts.push(maker);
    }
    metaParts.push(countText);
    const metaText = metaParts.join(" · ");

    return (
        <PanelSectionRow>
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    padding: "10px 0 2px 0",
                    minWidth: 0
                }}
            >
                {icon}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span
                        style={{
                            fontSize: `${metrics.titleFontSize}px`,
                            lineHeight: metrics.titleLineHeight,
                            fontWeight: 800,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {name}
                    </span>
                    <span style={{ ...smallTextStyle(), fontSize: `${metrics.bodyFontSize}px` }}>
                        {metaText}
                    </span>
                    {fact && (
                        <span
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                wordBreak: "break-word"
                            }}
                        >
                            {fact}
                        </span>
                    )}
                </div>
            </div>
        </PanelSectionRow>
    );
}
