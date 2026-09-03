import type React from "react";
import type { ButtonSpacing, UiSize } from "../types";
import { modalSize, textSize } from "./scale";

export const achievementGreen = "#22c55e";
export const errorRed = "#ff5f5f";
export const warnAmber = "#f59e0b";
export const skyBlue = "#0ea5e9";
export const confirmAmber = "#ffb070";
export const faultViolet = "#a78bfa";
export const helpTextBlue = "#9fd3ff";

export function smallTextStyle(): React.CSSProperties {
    return {
        fontSize: "12px",
        lineHeight: 1.35,
        opacity: 0.85
    };
}

export function bodyTextStyle(base = 12): React.CSSProperties {
    return {
        fontSize: `${textSize(base)}px`,
        lineHeight: 1.35,
        opacity: 0.85
    };
}

export function modalBodyStyle(base = 12): React.CSSProperties {
    return {
        fontSize: `${modalSize(base)}px`,
        lineHeight: 1.35,
        opacity: 0.85
    };
}

function gapForButtonSpacing(value: ButtonSpacing): number {
    if (value === "verysmall") {
        return 0;
    }
    if (value === "small") {
        return 2;
    }
    if (value === "medium") {
        return 6;
    }
    if (value === "large") {
        return 10;
    }
    return 14;
}

export function regularButtonSpacingStyle(value: ButtonSpacing): React.CSSProperties {
    return { marginBottom: `${gapForButtonSpacing(value)}px` };
}

export const compactButtonStyle: React.CSSProperties = { minWidth: 0, padding: "4px 12px" };

export const NOTES_DOT_KEYFRAMES = `
@keyframes da-notes-dot-pulse {
    0%, 100% { background: #b9740a; }
    50% { background: #fbbf24; }
}
@media (prefers-reduced-motion: reduce) {
    .da-notes-dot {
        animation: none !important;
        background: #f59e0b !important;
    }
}
`;

export const FADE_IN_KEYFRAMES = `
@keyframes da-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
    .da-fade-image, .da-faded {
        animation: none !important;
        opacity: 1 !important;
    }
}
`;

export type AchievementUiMetrics = ReturnType<typeof achievementUiMetrics>;

export function achievementUiMetrics(uiSize: UiSize) {
    if (uiSize === "normal") {
        return {
            rowGap: 7,
            rowPaddingY: 2,
            iconSize: 44,
            iconGap: 7,
            pointsFontSize: 11,
            pointsLineHeight: 1.12,
            titleFontSize: 15.5,
            titleLineHeight: 1.2,
            bodyFontSize: 11.5,
            bodyLineHeight: 1.31,
            captionFontSize: 12,
            contentGap: 3,
            textGap: 3,
            compactGap: 4,
            compactPointsFontSize: 11.5,
            compactPointsLineHeight: 1.12
        };
    }
    if (uiSize === "large") {
        return {
            rowGap: 8,
            rowPaddingY: 2,
            iconSize: 48,
            iconGap: 8,
            pointsFontSize: 12,
            pointsLineHeight: 1.15,
            titleFontSize: 16,
            titleLineHeight: 1.22,
            bodyFontSize: 12,
            bodyLineHeight: 1.35,
            captionFontSize: 12.5,
            contentGap: 3,
            textGap: 4,
            compactGap: 4,
            compactPointsFontSize: 12,
            compactPointsLineHeight: 1.15
        };
    }
    if (uiSize === "xlarge") {
        return {
            rowGap: 10,
            rowPaddingY: 3,
            iconSize: 56,
            iconGap: 10,
            pointsFontSize: 13,
            pointsLineHeight: 1.18,
            titleFontSize: 18,
            titleLineHeight: 1.24,
            bodyFontSize: 13.5,
            bodyLineHeight: 1.38,
            captionFontSize: 14,
            contentGap: 4,
            textGap: 5,
            compactGap: 5,
            compactPointsFontSize: 13,
            compactPointsLineHeight: 1.18
        };
    }
    if (uiSize === "xxlarge") {
        return {
            rowGap: 12,
            rowPaddingY: 3,
            iconSize: 64,
            iconGap: 12,
            pointsFontSize: 14.5,
            pointsLineHeight: 1.2,
            titleFontSize: 20,
            titleLineHeight: 1.26,
            bodyFontSize: 15,
            bodyLineHeight: 1.4,
            captionFontSize: 15.5,
            contentGap: 5,
            textGap: 6,
            compactGap: 6,
            compactPointsFontSize: 14.5,
            compactPointsLineHeight: 1.2
        };
    }
    return {
        rowGap: 14,
        rowPaddingY: 4,
        iconSize: 72,
        iconGap: 14,
        pointsFontSize: 16,
        pointsLineHeight: 1.22,
        titleFontSize: 22,
        titleLineHeight: 1.28,
        bodyFontSize: 16.5,
        bodyLineHeight: 1.42,
        captionFontSize: 17,
        contentGap: 6,
        textGap: 7,
        compactGap: 7,
        compactPointsFontSize: 16,
        compactPointsLineHeight: 1.22
    };
}

export function rankGutterWidth(uiSize: UiSize, widestRank: number): number {
    const titleFontSize = achievementUiMetrics(uiSize).titleFontSize;
    const safeRank = Math.max(1, Math.floor(widestRank));
    const charCount = String(safeRank).length + 1;
    return Math.max(24, Math.round(titleFontSize * 0.6 * charCount));
}

