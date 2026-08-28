import React from "react";
import type { PlayersNearYouItem, UiSize } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { FocusableItem } from "../ui/FocusableItem";
import { playOkSound } from "../../utils/navSound";
import { UserAvatar } from "../ui/UserAvatar";
import { formatRelativeTime } from "../../utils/format";
import { achievementUiMetrics, smallTextStyle, achievementGreen } from "../../utils/style";

const BUTTON_SECONDARY = 3;
const BUTTON_OPTIONS = 4;


function sentenceParts(
    language: LanguageCode,
    parts: Record<string, React.ReactNode>
) {
    const tokens: Record<string, string> = {};
    for (const key of Object.keys(parts)) {
        tokens[key] = `__PNYROW_${key.toUpperCase()}__`;
    }

    const text = t(language, "{{user}} unlocked {{achievement}}", tokens);
    const pattern = /(__PNYROW_[A-Z0-9_]+__)/g;

    return text.split(pattern).map((piece, index) => {
        const match = Object.entries(tokens).find(([, token]) => token === piece);
        if (!match) {
            return piece;
        }
        return <React.Fragment key={`${piece}:${index}`}>{parts[match[0]]}</React.Fragment>;
    });
}

export type PlayersNearYouRowProps = {
    item: PlayersNearYouItem;
    language: LanguageCode;
    uiSize: UiSize;
    showIcons: boolean;
    focusKey: string;
    onClick: (item: PlayersNearYouItem) => void | Promise<void>;
    onSecondary?: (item: PlayersNearYouItem) => void | Promise<void>;
    onTertiary?: (item: PlayersNearYouItem) => void | Promise<void>;
};

export function PlayersNearYouRow(props: PlayersNearYouRowProps) {
    const { item, language, uiSize, showIcons, focusKey, onClick, onSecondary, onTertiary } = props;
    const metrics = achievementUiMetrics(uiSize);

    const username = String(item.user || "").trim() || t(language, "Someone");
    const achievementTitle = String(item.achievementTitle || "").trim() || t(language, "an achievement");
    const timeText = formatRelativeTime(item.dateAwarded, language);

    const userNode = (
        <span style={{ fontWeight: 800, wordBreak: "break-word" }}>
            {username}
        </span>
    );
    const achievementNode = (
        <span style={{ color: achievementGreen, fontWeight: 800, wordBreak: "break-word" }}>
            “{achievementTitle}”
        </span>
    );

    function handleClick() {
        void onClick(item);
    }

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;
        if (button === BUTTON_SECONDARY) {
            playOkSound();
            onSecondary?.(item);
        }
        else if (button === BUTTON_OPTIONS) {
            playOkSound();
            onTertiary?.(item);
        }
    }


    return (
        <FocusableItem
            focusKey={focusKey}
            onClick={handleClick}
            onButtonDown={handleButtonDown}
            outerStyle={{ width: "100%", minWidth: 0 }}
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
                {showIcons && (
                    <UserAvatar
                        username={item.user}
                        size={metrics.iconSize}
                        fontSize={Math.max(16, metrics.iconSize * 0.42)}
                    />
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
                            fontSize: `${metrics.titleFontSize - 1.5}px`,
                            lineHeight: metrics.titleLineHeight,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {sentenceParts(language, { user: userNode, achievement: achievementNode })}
                    </div>
                    {timeText && (
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
                            {timeText}
                        </div>
                    )}
                </div>
            </div>
        </FocusableItem>
    );
}
