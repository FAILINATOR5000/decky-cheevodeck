import React from "react";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { AwardStamp } from "../achievements/AwardStamp";
import { useGameIcon } from "../../hooks/useGameIcon";
import { t, type LanguageCode } from "../../locales";
import type { EventCompletion, EventListRow, EventProgress } from "../../types";
import { formatUnlockDate } from "../../utils/achievements";
import { eventDatesLabel, eventKindLabel, eventPhaseLabel } from "../../utils/events";
import { BUTTON_BUMPER_LEFT, BUTTON_BUMPER_RIGHT, BUTTON_OPTIONS, BUTTON_SECONDARY } from "../../utils/gamepadButtons";
import { playOkSound, playToggleSound } from "../../utils/navSound";
import { achievementGreen, smallTextStyle, type AchievementUiMetrics } from "../../utils/style";

export type EventRowList = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    trackedBarColor: string;
    newestSiteGameId: number;
    focusKeyPrefix: string;
    onFocusIndex: (index: number) => void;
    onClick: (row: EventListRow, index: number) => void;
    onSecondary?: (row: EventListRow, index: number) => void;
    secondaryUntracks?: boolean;
    onOptions?: (row: EventListRow, index: number) => void;
    onReorderPick?: (row: EventListRow, index: number) => void;
    onReorderToward?: (row: EventListRow) => void;
    onTagMark?: (row: EventListRow) => void;
};

type EventRowProps = {
    row: EventListRow;
    index: number;
    list: EventRowList;
    marked: boolean;
    completion: EventCompletion;
    progress: EventProgress | null;
    noteText: string;
    noteColor?: string;
    isReorderTarget: boolean;
    isTagMarked?: boolean;
};

function completionLine(props: EventRowProps, language: LanguageCode): React.ReactNode {
    const { completion, row } = props;
    if (completion?.kind === "earned") {
        const date = formatUnlockDate(row.earnedAt, { includeYear: true, dateOnly: true }, language);
        return (
            <span style={{ color: achievementGreen }}>
                {t(language, "Earned")}
                {date ? <>{" "}<AwardStamp date={date} /></> : null}
            </span>
        );
    }
    if (completion?.kind === "marked") {
        return t(language, "Marked complete");
    }
    return null;
}

function progressLine(props: EventRowProps, language: LanguageCode): React.ReactNode {
    const { completion, progress, row } = props;
    if (completion !== null || !progress) {
        return null;
    }
    if (row.kind === "checklist") {
        if (!progress.points || !row.checklistTarget) {
            return null;
        }
        return t(language, "{{points}} / {{target}} points", { points: progress.points, target: row.checklistTarget });
    }
    if (progress.earned === 0) {
        return null;
    }
    return t(language, "{{earned}} / {{total}} earned", { earned: progress.earned, total: progress.total });
}

export const EventRow = React.memo(function EventRow(props: EventRowProps) {
    const { row, list, index } = props;
    const { metrics, language } = list;
    const { iconDataUri, cold } = useGameIcon(row.gameId, row.imageIcon || null, "event row");

    const subtitle = [eventPhaseLabel(row, list.newestSiteGameId, language), eventKindLabel(row, language)]
        .filter(Boolean)
        .join(" · ");
    const status = progressLine(props, language);
    const done = completionLine(props, language);
    const dates = eventDatesLabel(row, language);

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;
        if (button === BUTTON_SECONDARY && list.onSecondary) {
            playToggleSound(list.secondaryUntracks ? false : !props.marked);
            list.onSecondary(row, index);
            return;
        }
        if (button === BUTTON_OPTIONS && list.onOptions) {
            playOkSound();
            list.onOptions(row, index);
            return;
        }
        if (button === BUTTON_BUMPER_RIGHT && list.onReorderPick) {
            playOkSound();
            list.onReorderPick(row, index);
            return;
        }
        if (button === BUTTON_BUMPER_LEFT && list.onTagMark) {
            playToggleSound(!props.isTagMarked);
            list.onTagMark(row);
        }
    }

    function handleGamepadFocus() {
        list.onReorderToward?.(row);
        list.onFocusIndex(index);
    }

    return (
        <FocusableItem
            focusKey={`${list.focusKeyPrefix}${row.gameId}`}
            onFocus={() => list.onFocusIndex(index)}
            onGamepadFocus={handleGamepadFocus}
            onClick={() => list.onClick(row, index)}
            onButtonDown={handleButtonDown}
            outerStyle={{
                width: "100%",
                minWidth: 0,
                ...(props.isReorderTarget ? { outline: `2px solid ${achievementGreen}`, borderRadius: "6px" } : null),
                ...(props.isTagMarked ? { background: "rgba(14, 165, 233, 0.18)", borderRadius: "6px" } : null)
            }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    borderLeft: props.marked ? `3px solid ${list.trackedBarColor}` : undefined,
                    paddingLeft: props.marked ? "8px" : undefined,
                    boxSizing: "border-box"
                }}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                        alignItems: "flex-start",
                        padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                        minWidth: 0
                    }}
                >
                    {list.showIcons && (
                        <div
                            style={{
                                width: `${metrics.iconSize}px`,
                                height: `${metrics.iconSize}px`,
                                borderRadius: "7px",
                                overflow: "hidden",
                                flexShrink: 0,
                                background: "rgba(255,255,255,0.10)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: `${Math.max(16, metrics.iconSize * 0.42)}px`,
                                fontWeight: 800
                            }}
                        >
                            {iconDataUri ? (
                                <FadeImage
                                    src={iconDataUri}
                                    fadeOnLoad={cold}
                                    decoding="async"
                                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                />
                            ) : (
                                row.title.charAt(0).toUpperCase() || "?"
                            )}
                        </div>
                    )}
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: `${Math.max(2, metrics.contentGap - 1)}px`,
                            textAlign: "left"
                        }}
                    >
                        <div
                            style={{
                                fontSize: `${metrics.titleFontSize}px`,
                                lineHeight: metrics.titleLineHeight,
                                fontWeight: 800,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {row.title}
                        </div>
                        {subtitle ? (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.bodyFontSize}px`,
                                    lineHeight: metrics.bodyLineHeight,
                                    opacity: 1,
                                    minWidth: 0
                                }}
                            >
                                {subtitle}
                            </div>
                        ) : null}
                        {status ? (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.pointsFontSize}px`,
                                    lineHeight: metrics.pointsLineHeight,
                                    opacity: 1,
                                    fontWeight: 800,
                                    minWidth: 0
                                }}
                            >
                                {status}
                            </div>
                        ) : null}
                        {dates ? (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.pointsFontSize}px`,
                                    lineHeight: metrics.pointsLineHeight,
                                    minWidth: 0
                                }}
                            >
                                {dates}
                            </div>
                        ) : null}
                        {done ? (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.pointsFontSize}px`,
                                    lineHeight: metrics.pointsLineHeight,
                                    opacity: 1,
                                    fontWeight: 800,
                                    minWidth: 0
                                }}
                            >
                                {done}
                            </div>
                        ) : null}
                    </div>
                </div>
                {props.noteText ? (
                    <div
                        style={{
                            ...smallTextStyle(),
                            width: "100%",
                            marginTop: "2px",
                            marginBottom: "2px",
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
                ) : null}
            </div>
        </FocusableItem>
    );
});
