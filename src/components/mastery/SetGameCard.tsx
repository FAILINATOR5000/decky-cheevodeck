import React, { type ReactNode, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { useGameIcon } from "../../hooks/useGameIcon";
import { t, type LanguageCode } from "../../locales";
import type { TrackedSetAButtonMode, TrackedSetAward, TrackedSetGame } from "../../types";
import { noteBodyColor } from "../../utils/achievements";
import { BUTTON_BUMPER_RIGHT, BUTTON_OPTIONS, BUTTON_SECONDARY } from "../../utils/gamepadButtons";
import { playOkSound } from "../../utils/navSound";
import { achievementGreen, smallTextStyle, type AchievementUiMetrics } from "../../utils/style";

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function TrashIcon({ size = 16 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M170.5 51.6L151.5 80l145 0-19-28.4c-1.5-2.2-4-3.6-6.7-3.6l-93.7 0c-2.7 0-5.2 1.3-6.7 3.6zm147-26.6L354.2 80 368 80l48 0 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-8 0 0 304c0 44.2-35.8 80-80 80l-224 0c-44.2 0-80-35.8-80-80l0-304-8 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l8 0 48 0 13.8 0 36.7-55c10.4-15.6 27.9-25 46.7-25l93.7 0c18.7 0 36.2 9.4 46.7 25zM80 128l0 304c0 17.7 14.3 32 32 32l224 0c17.7 0 32-14.3 32-32l0-304L80 128zm80 64l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16z" />
        </svg>
    );
}

export type SetGameCardListProps = {
    aButtonMode: TrackedSetAButtonMode;
    reorderMode: boolean;
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    buttonOuterStyle: React.CSSProperties;
    focusKeyPrefix?: string;
    onPickOrSwap?: (gameId: number) => void;
    onEditNote?: (game: TrackedSetGame) => void;
    onOpenGameOverview: (gameId: number) => void;
    onTrashPress?: (gameId: number) => void;
    onTrashBlur?: (gameId: number) => void;
    onCardFocus: (slotIndex: number, gameId: number) => void;
    onCardSecondary?: (game: TrackedSetGame) => void;
    onCardNote?: (game: TrackedSetGame) => void;
    onCardReorderPick?: (gameId: number) => void;
};

type SetGameCardProps = {
    game: TrackedSetGame;
    done: boolean;
    slotIndex: number;
    isReorderTarget: boolean;
    trashArmed: boolean;
    claimToken: number;
    corner?: ReactNode;
    extraLine?: ReactNode;
    list: SetGameCardListProps;
};

export const SetGameCard = React.memo(function SetGameCard(props: SetGameCardProps) {
    const { game, done, slotIndex, isReorderTarget, trashArmed, claimToken, list } = props;
    const { aButtonMode, reorderMode, language, showIcons, metrics, buttonOuterStyle } = list;
    const focusKeyPrefix = list.focusKeyPrefix ?? "trackedsetgame";

    const { iconDataUri, cold } = useGameIcon(game.gameId, game.imageIcon ?? null, "getGameIconCached (tracked set card)");

    const fallbackLetter = game.title.trim().charAt(0).toUpperCase() || "?";
    const noteColor = noteBodyColor(game.color);

    function handleCardClick() {
        if (reorderMode) {
            list.onPickOrSwap?.(game.gameId);
            return;
        }
        if (aButtonMode === "info" || !list.onEditNote) {
            list.onOpenGameOverview(game.gameId);
            return;
        }
        list.onEditNote(game);
    }

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;

        if (button === BUTTON_SECONDARY && list.onCardSecondary) {
            list.onCardSecondary(game);
            return;
        }

        if (button === BUTTON_OPTIONS && list.onCardNote) {
            playOkSound();
            list.onCardNote(game);
            return;
        }

        if (button === BUTTON_BUMPER_RIGHT && list.onCardReorderPick) {
            playOkSound();
            list.onCardReorderPick(game.gameId);
            return;
        }

    }

    const progressText = game.numAwarded !== null && game.maxPossible !== null
        ? t(language, "{{awarded}} / {{total}}", { awarded: game.numAwarded, total: game.maxPossible })
        : null;

    function awardLabel(award: TrackedSetAward | null): string {
        if (award === "mastered") {
            return t(language, "Mastered");
        }
        if (award === "completed") {
            return t(language, "Completed");
        }
        if (award === "beaten-hardcore") {
            return t(language, "Beaten Hardcore");
        }
        if (award === "beaten-softcore") {
            return t(language, "Beaten Softcore");
        }
        return t(language, "Unfinished");
    }

    const progressLine = progressText !== null
        ? `${progressText} · ${awardLabel(game.highestAward)}`
        : null;

    function handleTrashPress() {
        list.onTrashPress?.(game.gameId);
    }

    const [trashFocused, setTrashFocused] = useState(false);

    function handleTrashFocus() {
        setTrashFocused(true);
    }

    function handleTrashBlur() {
        setTrashFocused(false);
        list.onTrashBlur?.(game.gameId);
    }

    const card = (
        <Focusable
            flow-children="row"
            style={{ position: "relative", display: "flex", alignItems: "stretch", width: "100%" }}
        >
            <FocusableItem
                outerStyle={{
                    ...buttonOuterStyle,
                    width: "100%",
                    minWidth: 0,
                    outline: isReorderTarget ? `2px solid ${achievementGreen}` : undefined,
                    borderRadius: isReorderTarget ? "6px" : undefined
                }}
                focusKey={`${focusKeyPrefix}:${game.gameId}`}
                onClick={handleCardClick}
                onGamepadFocus={() => list.onCardFocus(slotIndex, game.gameId)}
                onButtonDown={handleButtonDown}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                        alignItems: "flex-start",
                        minWidth: 0,
                        opacity: done ? 0.55 : 1
                    }}
                >
                    {showIcons && (
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
                                    style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        display: "block"
                                    }}
                                />
                            ) : (
                                fallbackLetter
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
                            textAlign: "left",
                            paddingRight: "24px"
                        }}
                    >
                        <div
                            style={{
                                fontSize: `${metrics.titleFontSize}px`,
                                lineHeight: metrics.titleLineHeight,
                                fontWeight: 700,
                                minWidth: 0,
                                wordBreak: "break-word",
                                textDecoration: done ? "line-through" : undefined
                            }}
                        >
                            {game.title}
                        </div>
                        {game.note.trim() && (
                            <div
                                style={{
                                    fontSize: `${metrics.bodyFontSize}px`,
                                    lineHeight: metrics.bodyLineHeight,
                                    minWidth: 0,
                                    wordBreak: "break-word",
                                    color: noteColor
                                }}
                            >
                                {game.note}
                            </div>
                        )}
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 1,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {game.consoleName || ""}
                        </div>
                        {progressLine && (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.pointsFontSize}px`,
                                    lineHeight: metrics.pointsLineHeight,
                                    opacity: 1,
                                    minWidth: 0
                                }}
                            >
                                {progressLine}
                            </div>
                        )}
                        {props.extraLine && (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.pointsFontSize}px`,
                                    lineHeight: metrics.pointsLineHeight,
                                    opacity: 1,
                                    minWidth: 0
                                }}
                            >
                                {props.extraLine}
                            </div>
                        )}
                    </div>
                </div>
            </FocusableItem>

            {list.onTrashPress ? (
                <div
                    data-focus-key={`${focusKeyPrefix}:trash:${game.gameId}`}
                    style={{
                        position: "absolute",
                        top: "17px",
                        right: "8px",
                        zIndex: 2,
                        width: "32px",
                        height: "32px",
                        display: "flex"
                    }}
                >
                    <DialogButton
                        onClick={handleTrashPress}
                        onGamepadFocus={handleTrashFocus}
                        onGamepadBlur={handleTrashBlur}
                        style={{
                            minWidth: 0,
                            width: "32px",
                            height: "32px",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: trashArmed
                                ? "rgba(255,255,255,0.98)"
                                : trashFocused
                                    ? "rgba(24,24,24,0.98)"
                                    : "rgba(255,255,255,0.92)",
                            background: trashArmed
                                ? "rgba(220,38,38,0.92)"
                                : trashFocused
                                    ? "rgba(255,255,255,0.96)"
                                    : "rgba(24,24,24,0.78)",
                            border: trashArmed
                                ? "1px solid rgba(255,255,255,0.9)"
                                : trashFocused
                                    ? "1px solid rgba(255,255,255,1)"
                                    : "1px solid rgba(255,255,255,0.36)",
                            boxShadow: trashFocused
                                ? "0 0 0 2px rgba(255,255,255,0.78), 0 2px 8px rgba(0,0,0,0.45)"
                                : trashArmed
                                    ? "0 0 0 2px rgba(220,38,38,0.65), 0 2px 8px rgba(0,0,0,0.45)"
                                    : "0 2px 6px rgba(0,0,0,0.35)",
                            transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease"
                        }}
                    >
                        <TrashIcon size={15} />
                    </DialogButton>
                </div>
            ) : props.corner ? (
                <div
                    style={{
                        position: "absolute",
                        top: "17px",
                        right: "8px",
                        zIndex: 2,
                        width: "32px",
                        height: "32px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none"
                    }}
                >
                    {props.corner}
                </div>
            ) : null}
        </Focusable>
    );

    if (claimToken <= 0) {
        return card;
    }

    return (
        <Focusable key={`claim:${claimToken}`} autoFocus>
            {card}
        </Focusable>
    );
});
