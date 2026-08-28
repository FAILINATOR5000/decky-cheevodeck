import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { HardcoreBadge } from "./HardcoreBadge";
import { PointsLabel } from "./PointsLabel";
import { t, type LanguageCode } from "../../locales";
import type { AchievementListMode, AchievementRow, AchievementStyle, ReorderDirection } from "../../types";
import { earned, isMissable } from "../../utils/achievements";
import {
    BUTTON_BUMPER_RIGHT,
    BUTTON_DIR_DOWN,
    BUTTON_DIR_UP,
    BUTTON_OPTIONS,
    BUTTON_SECONDARY
} from "../../utils/gamepadButtons";
import { playOkSound, playToggleSound } from "../../utils/navSound";
import { achievementBodySize } from "../../utils/scale";
import { smallTextStyle, achievementGreen, errorRed, type AchievementUiMetrics } from "../../utils/style";
import React, { type ReactNode } from "react";


function statusGlyph(a: AchievementRow, style: AchievementStyle) {
    if (earned(a)) {
        return "✓";
    }
    return style === "left" ? "" : "○";
}

export type AchievementRowListProps = {
    metrics: AchievementUiMetrics;
    language: LanguageCode;
    mode: AchievementListMode;
    showIcons: boolean;
    useLeftStyle: boolean;
    blockPaddingStyle: string;
    trackedBarColor: string;
    showRetroPoints: boolean;
    onAchievementClick: (achievement: AchievementRow) => void;
    onAchievementFocus: (index: number) => void;
    onAchievementTrackToggle?: (achievement: AchievementRow) => void;
    onAchievementNote?: (achievement: AchievementRow) => void;
    onAchievementReorderPick?: (achievement: AchievementRow) => void;
    onAchievementReorderNudge?: (direction: ReorderDirection) => void;
};

export const AchievementListRow = React.memo(function AchievementListRow(props: {
    achievement: AchievementRow;
    index: number;
    list: AchievementRowListProps;
    iconSrc: string;
    fadeOnLoad: boolean;
    isTracked: boolean;
    isReorderTarget: boolean;
    communityLabel: string | null;
    extraLabel: ReactNode;
    noteText?: string;
    noteColor?: string;
}) {
    const { achievement, list } = props;
    const { metrics, language, mode, useLeftStyle, blockPaddingStyle, trackedBarColor, showRetroPoints } = list;

    const reorderOuterStyle = props.isReorderTarget
        ? { outline: `2px solid ${achievementGreen}`, borderRadius: "6px" }
        : undefined;

    function handleClick() {
        list.onAchievementClick(achievement);
    }

    function handleFocus() {
        list.onAchievementFocus(props.index);
    }

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;

        if (button === BUTTON_SECONDARY && list.onAchievementTrackToggle) {
            if (!earned(props.achievement)) {
                playToggleSound(!props.isTracked);
            }
            list.onAchievementTrackToggle(props.achievement);
            return;
        }

        if (button === BUTTON_OPTIONS && list.onAchievementNote) {
            playOkSound();
            list.onAchievementNote(props.achievement);
            return;
        }

        if (button === BUTTON_BUMPER_RIGHT && list.onAchievementReorderPick) {
            playOkSound();
            list.onAchievementReorderPick(props.achievement);
            return;
        }

        if (props.isReorderTarget && list.onAchievementReorderNudge) {
            if (button === BUTTON_DIR_UP) {
                list.onAchievementReorderNudge("up");
            }
            else if (button === BUTTON_DIR_DOWN) {
                list.onAchievementReorderNudge("down");
            }
        }
    }

    function renderNoteLine() {
        if (!props.noteText) {
            return null;
        }
        return (
            <div
                style={{
                    ...smallTextStyle(),
                    width: "100%",
                    marginTop: "4px",
                    fontSize: `${metrics.bodyFontSize}px`,
                    lineHeight: metrics.bodyLineHeight,
                    fontStyle: "italic",
                    color: props.noteColor,
                    minWidth: 0,
                    wordBreak: "break-word",
                    textAlign: "left"
                }}
            >
                {props.noteText}
            </div>
        );
    }

    function renderBadge() {
        return (
            <div
                style={{
                    width: `${metrics.iconSize}px`,
                    height: `${metrics.iconSize}px`,
                    borderRadius: "6px",
                    overflow: "hidden",
                    background: "rgba(255, 255, 255, 0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                }}
            >
                {props.iconSrc ? (
                    <FadeImage
                        src={props.iconSrc}
                        fadeOnLoad={props.fadeOnLoad}
                        decoding="async"
                        style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block"
                        }}
                    />
                ) : (
                    <span style={{ ...smallTextStyle(), opacity: 0.55 }}>
                        ...
                    </span>
                )}
            </div>
        );
    }

    function renderPointsBlock() {
        return (
            <div
                style={{
                    ...smallTextStyle(),
                    width: "100%",
                    textAlign: "center",
                    lineHeight: metrics.pointsLineHeight,
                    fontSize: `${metrics.pointsFontSize}px`,
                    opacity: 0.9
                }}
            >
                <div>
                    <PointsLabel
                        achievement={achievement}
                        showRetroPoints={showRetroPoints}
                        language={language}
                    />
                </div>
                {achievement.dateEarnedHardcore && (
                    <HardcoreBadge
                        language={language}
                        fontSize={metrics.pointsFontSize}
                        short
                        style={{ marginTop: "2px" }}
                    />
                )}
            </div>
        );
    }

    return (
        <FocusableItem
            focusKey={`achievement:${achievement.id}`}
            outerStyle={reorderOuterStyle}
            onClick={handleClick}
            onFocus={handleFocus}
            onButtonDown={handleButtonDown}
        >
            {list.showIcons ? (
                useLeftStyle ? (
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: `${metrics.rowGap}px`,
                        padding: blockPaddingStyle,
                        textAlign: "left",
                        borderLeft:
                            mode === "main" && props.isTracked
                                ? `3px solid ${trackedBarColor}`
                                : undefined,
                        paddingLeft:
                            mode === "main" && props.isTracked
                                ? "8px"
                                : undefined
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            gap: `${metrics.iconGap}px`,
                            alignItems: "flex-start"
                        }}
                    >
                        <div
                            style={{
                                width: `${metrics.iconSize}px`,
                                flexShrink: 0,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: `${metrics.textGap}px`
                            }}
                        >
                            {renderBadge()}
                            {renderPointsBlock()}
                        </div>
                        <div
                            style={{
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                textAlign: "left",
                                gap: `${metrics.contentGap}px`
                            }}
                        >
                            <div
                                style={{
                                    width: "100%",
                                    fontWeight: 700,
                                    fontSize: `${metrics.titleFontSize}px`,
                                    lineHeight: metrics.titleLineHeight,
                                    minWidth: 0,
                                    wordBreak: "break-word",
                                    textAlign: "left"
                                }}
                            >
                                {statusGlyph(achievement, "left")} {achievement.title}
                            </div>
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    width: "100%",
                                    fontSize: `${achievementBodySize(metrics.bodyFontSize)}px`,
                                    lineHeight: metrics.bodyLineHeight,
                                    opacity: 0.82,
                                    minWidth: 0,
                                    wordBreak: "break-word",
                                    textAlign: "left"
                                }}
                            >
                                {achievement.description}
                                {isMissable(achievement) && (
                                    <>
                                        {" "}
                                        <span style={{ color: errorRed }}>
                                            {t(language, "(missable)")}
                                        </span>
                                    </>
                                )}
                            </div>
                            {renderNoteLine()}
                            {(props.extraLabel || props.communityLabel) && (
                                <div
                                    style={{
                                        width: "100%",
                                        marginTop: "6px",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "flex-start",
                                        textAlign: "left",
                                        gap: `${metrics.contentGap}px`
                                    }}
                                >
                                    {props.extraLabel && (
                                        <div
                                            style={{
                                                ...smallTextStyle(),
                                                fontSize: `${metrics.captionFontSize}px`,
                                                width: "100%",
                                                opacity: 0.92,
                                                fontWeight: 700,
                                                textAlign: "left"
                                            }}
                                        >
                                            {props.extraLabel}
                                        </div>
                                    )}
                                    {props.communityLabel && (
                                        <div
                                            style={{
                                                ...smallTextStyle(),
                                                fontSize: `${metrics.captionFontSize}px`,
                                                width: "100%",
                                                opacity: 0.92,
                                                fontWeight: 700,
                                                textAlign: "left"
                                            }}
                                        >
                                            {props.communityLabel}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                ) : (
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: `${metrics.rowGap}px`,
                        padding: blockPaddingStyle
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            gap: `${metrics.iconGap}px`,
                            alignItems: "flex-start"
                        }}
                    >
                        <div
                            style={{
                                width: `${metrics.iconSize}px`,
                                flexShrink: 0,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: `${metrics.textGap}px`
                            }}
                        >
                            {renderBadge()}
                            {renderPointsBlock()}
                        </div>
                        <div
                            style={{
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                gap: `${metrics.contentGap}px`
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 700,
                                    fontSize: `${metrics.titleFontSize}px`,
                                    lineHeight: metrics.titleLineHeight,
                                    minWidth: 0,
                                    wordBreak: "break-word"
                                }}
                            >
                                {statusGlyph(achievement, "centered")} {achievement.title}
                            </div>
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${achievementBodySize(metrics.bodyFontSize)}px`,
                                    lineHeight: metrics.bodyLineHeight,
                                    opacity: 0.82,
                                    minWidth: 0,
                                    wordBreak: "break-word"
                                }}
                            >
                                {achievement.description}
                            </div>
                            {renderNoteLine()}
                            {props.extraLabel && (
                                <div
                                    style={{
                                        ...smallTextStyle(),
                                        fontSize: `${metrics.captionFontSize}px`,
                                        opacity: 0.92,
                                        fontWeight: 700
                                    }}
                                >
                                    {props.extraLabel}
                                </div>
                            )}
                            {props.communityLabel && (
                                <div
                                    style={{
                                        ...smallTextStyle(),
                                        fontSize: `${metrics.captionFontSize}px`,
                                        opacity: 0.92,
                                        fontWeight: 700
                                    }}
                                >
                                    {props.communityLabel}
                                </div>
                            )}
                            {mode !== "tracked" && props.isTracked && (
                                <div
                                    style={{
                                        ...smallTextStyle(),
                                        fontSize: `${metrics.captionFontSize}px`,
                                        opacity: 0.92,
                                        fontWeight: 700
                                    }}
                                >
                                    {t(language, "TRACKED")}
                                </div>
                            )}
                            {isMissable(achievement) && (
                                <div
                                    style={{
                                        ...smallTextStyle(),
                                        fontSize: `${metrics.captionFontSize}px`,
                                        color: errorRed,
                                        fontWeight: 700
                                    }}
                                >
                                    {t(language, "MISSABLE")}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                )
            ) : (
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: useLeftStyle ? "flex-start" : undefined,
                        gap: `${metrics.compactGap}px`,
                        padding: blockPaddingStyle,
                        textAlign: useLeftStyle ? "left" : undefined,
                        borderLeft:
                            useLeftStyle && mode === "main" && props.isTracked
                                ? `3px solid ${trackedBarColor}`
                                : undefined,
                        paddingLeft:
                            useLeftStyle && mode === "main" && props.isTracked
                                ? "8px"
                                : undefined
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: `${metrics.iconGap}px`
                        }}
                    >
                        <div
                            style={{
                                flex: 1,
                                minWidth: 0,
                                fontWeight: 700,
                                fontSize: `${metrics.titleFontSize}px`,
                                lineHeight: metrics.titleLineHeight,
                                wordBreak: "break-word",
                                textAlign: useLeftStyle ? "left" : undefined
                            }}
                        >
                            {statusGlyph(achievement, useLeftStyle ? "left" : "centered")} {achievement.title}
                        </div>
                        <div
                            style={{
                                ...smallTextStyle(),
                                flexShrink: 0,
                                whiteSpace: "nowrap",
                                fontSize: `${metrics.compactPointsFontSize}px`,
                                lineHeight: metrics.compactPointsLineHeight,
                                opacity: 0.9,
                                textAlign: "right"
                            }}
                        >
                            <PointsLabel
                                achievement={achievement}
                                showRetroPoints={showRetroPoints}
                                language={language}
                            />
                            {achievement.dateEarnedHardcore
                                ? ` • ${t(language, "HC")}`
                                : ""}
                        </div>
                    </div>
                    <div
                        style={{
                            ...smallTextStyle(),
                            width: "100%",
                            fontSize: `${achievementBodySize(metrics.bodyFontSize)}px`,
                            lineHeight: metrics.bodyLineHeight,
                            opacity: 0.82,
                            minWidth: 0,
                            wordBreak: "break-word",
                            textAlign: useLeftStyle ? "left" : undefined
                        }}
                    >
                        {achievement.description}
                        {useLeftStyle && isMissable(achievement) && (
                            <>
                                {" "}
                                <span style={{ color: errorRed }}>
                                    {t(language, "(missable)")}
                                </span>
                            </>
                        )}
                    </div>
                    {renderNoteLine()}
                    {useLeftStyle ? (
                        (props.extraLabel || props.communityLabel) && (
                            <div
                                style={{
                                    width: "100%",
                                    marginTop: "6px",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-start",
                                    textAlign: "left",
                                    gap: `${metrics.compactGap}px`
                                }}
                            >
                                {props.extraLabel && (
                                    <div
                                        style={{
                                            ...smallTextStyle(),
                                            fontSize: `${metrics.captionFontSize}px`,
                                            width: "100%",
                                            opacity: 0.92,
                                            fontWeight: 700,
                                            textAlign: "left"
                                        }}
                                    >
                                        {props.extraLabel}
                                    </div>
                                )}
                                {props.communityLabel && (
                                    <div
                                        style={{
                                            ...smallTextStyle(),
                                            fontSize: `${metrics.captionFontSize}px`,
                                            width: "100%",
                                            opacity: 0.92,
                                            fontWeight: 700,
                                            textAlign: "left"
                                        }}
                                    >
                                        {props.communityLabel}
                                    </div>
                                )}
                            </div>
                        )
                    ) : (
                        <>
                            {props.extraLabel && (
                                <div style={{ ...smallTextStyle(), fontSize: `${metrics.captionFontSize}px`, opacity: 0.92, fontWeight: 700 }}>
                                    {props.extraLabel}
                                </div>
                            )}
                            {props.communityLabel && (
                                <div style={{ ...smallTextStyle(), fontSize: `${metrics.captionFontSize}px`, opacity: 0.92, fontWeight: 700 }}>
                                    {props.communityLabel}
                                </div>
                            )}
                            {mode !== "tracked" && props.isTracked && (
                                <div style={{ ...smallTextStyle(), fontSize: `${metrics.captionFontSize}px`, opacity: 0.92, fontWeight: 700 }}>
                                    {t(language, "TRACKED")}
                                </div>
                            )}
                            {isMissable(achievement) && (
                                <div style={{ ...smallTextStyle(), fontSize: `${metrics.captionFontSize}px`, color: errorRed, fontWeight: 700 }}>
                                    {t(language, "MISSABLE")}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </FocusableItem>
    );
});
