import React from "react";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { gameNoteReminderLabel } from "../../utils/reminders";
import { t, type LanguageCode } from "../../locales";
import type { GameNote, ReorderDirection } from "../../types";
import {
    BUTTON_BUMPER_RIGHT,
    BUTTON_DIR_DOWN,
    BUTTON_DIR_UP,
    BUTTON_OPTIONS
} from "../../utils/gamepadButtons";
import { playOkSound } from "../../utils/navSound";
import { noteBodyColor, parseNoteTag } from "../../utils/achievements";
import { type AchievementUiMetrics, achievementGreen, warnAmber } from "../../utils/style";

const FIRING_DOT_KEYFRAMES = `
@keyframes da-firing-dot-pulse {
    0%, 100% {
        background: #b9740a;
        box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
    }
    50% {
        background: #fbbf24;
        box-shadow: 0 0 6px 2px rgba(245, 158, 11, 0.55);
    }
}
@media (prefers-reduced-motion: reduce) {
    .da-firing-dot {
        animation: none !important;
        background: #f59e0b !important;
    }
}
`;

export type NoteCardListProps = {
    language: LanguageCode;
    metrics: AchievementUiMetrics;
    gameIconDataUri: string | null;
    gameIconCold: boolean;
    showIcons: boolean;
    onClick: (note: GameNote) => void;
    onCardFocused: (noteId: string) => void;
    onNewNote?: () => void;
    onReorderPick?: (note: GameNote) => void;
    onReorderNudge?: (direction: ReorderDirection) => void;
};

export type NoteCardProps = {
    note: GameNote;
    focusKey: string;
    isReorderTarget: boolean;
    firing: boolean;
    list: NoteCardListProps;
};

export const NoteCard = React.memo(function NoteCard(props: NoteCardProps) {
    const { note, focusKey, isReorderTarget, firing, list } = props;
    const { language, metrics, gameIconDataUri, gameIconCold, showIcons } = list;

    function handleClick() {
        list.onClick(note);
    }

    function handleCardFocused() {
        list.onCardFocused(note.id);
    }

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;

        if (button === BUTTON_OPTIONS && list.onNewNote) {
            playOkSound();
            list.onNewNote();
            return;
        }

        if (button === BUTTON_BUMPER_RIGHT && list.onReorderPick) {
            playOkSound();
            list.onReorderPick(note);
            return;
        }

        if (isReorderTarget && list.onReorderNudge) {
            if (button === BUTTON_DIR_UP) {
                list.onReorderNudge("up");
            }
            else if (button === BUTTON_DIR_DOWN) {
                list.onReorderNudge("down");
            }
        }
    }

    const bodyColor = noteBodyColor(note.color);
    const parsed = parseNoteTag(note.body);
    const displayBody = parsed.body;

    const reminderIsOn = note.reminderMode !== "off";
    const reminderLabel = reminderIsOn
        ? gameNoteReminderLabel(language, note.reminderMode, note.reminderEveryMinutes)
        : null;

    const isCompleted = note.completedAt !== null;
    const completedTextStyle = isCompleted
        ? { textDecoration: "line-through" as const, opacity: 0.55 }
        : undefined;

    const outerStyle = isReorderTarget
        ? { outline: `2px solid ${achievementGreen}`, borderRadius: "6px" }
        : undefined;

    const firingDot = firing ? (
        <span
            className="da-firing-dot"
            style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: warnAmber,
                flexShrink: 0,
                marginLeft: "8px",
                animation: "da-firing-dot-pulse 1.8s ease-in-out infinite"
            }}
        >
            <style>{FIRING_DOT_KEYFRAMES}</style>
        </span>
    ) : null;

    const titleHasContent = Boolean(note.title);

    const showDotOnBody = firing && !titleHasContent && Boolean(displayBody);

    const bodyTextNode = displayBody ? (
        <div
            style={{
                fontSize: `${metrics.bodyFontSize}px`,
                lineHeight: metrics.bodyLineHeight,
                opacity: 0.85,
                color: bodyColor,
                whiteSpace: "normal",
                wordBreak: "break-word",
                flex: showDotOnBody ? 1 : undefined,
                minWidth: showDotOnBody ? 0 : undefined,
                ...completedTextStyle
            }}
        >
            {displayBody}
        </div>
    ) : null;

    const contentLines = (
        <>
            {titleHasContent && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px"
                    }}
                >
                    <div
                        style={{
                            fontWeight: 700,
                            fontSize: `${metrics.titleFontSize}px`,
                            lineHeight: metrics.titleLineHeight,
                            wordBreak: "break-word",
                            flex: 1,
                            minWidth: 0,
                            ...completedTextStyle
                        }}
                    >
                        {note.title}
                    </div>
                    {firingDot}
                </div>
            )}
            {showDotOnBody ? (
                <div
                    style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "4px"
                    }}
                >
                    {bodyTextNode}
                    {firingDot}
                </div>
            ) : (
                bodyTextNode
            )}
            {reminderLabel && (
                <div
                    style={{
                        fontSize: `${Math.max(10, metrics.bodyFontSize - 1)}px`,
                        lineHeight: metrics.bodyLineHeight,
                        opacity: 0.65,
                        fontStyle: "italic",
                        ...completedTextStyle
                    }}
                >
                    {t(language, "Reminder: {{label}}", { label: reminderLabel })}
                </div>
            )}
        </>
    );

    return (
        <FocusableItem
            focusKey={focusKey}
            onClick={handleClick}
            onFocus={handleCardFocused}
            onGamepadFocus={handleCardFocused}
            onMouseEnter={handleCardFocused}
            onButtonDown={handleButtonDown}
            outerStyle={outerStyle}
        >
            {showIcons ? (
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
                            height: `${metrics.iconSize}px`,
                            flexShrink: 0,
                            borderRadius: "6px",
                            overflow: "hidden",
                            background: "rgba(255, 255, 255, 0.08)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                        }}
                    >
                        {gameIconDataUri ? (
                            <FadeImage
                                src={gameIconDataUri}
                                fadeOnLoad={gameIconCold}
                                decoding="async"
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block"
                                }}
                            />
                        ) : (
                            <span style={{ opacity: 0.55 }}>...</span>
                        )}
                    </div>
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: `${metrics.textGap}px`,
                            textAlign: "left"
                        }}
                    >
                        {contentLines}
                    </div>
                </div>
            ) : (
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: `${metrics.textGap}px`
                    }}
                >
                    {contentLines}
                </div>
            )}
        </FocusableItem>
    );
});
