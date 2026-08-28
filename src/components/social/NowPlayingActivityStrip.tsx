import { PanelSectionRow } from "@decky/ui";
import React from "react";
import type { SocialActivityEvent } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { FocusableItem } from "../ui/FocusableItem";
import { playOkSound } from "../../utils/navSound";
import { UserAvatar } from "../ui/UserAvatar";
import { formatUnlockDate } from "../../utils/achievements";
import { type AchievementUiMetrics, smallTextStyle, achievementGreen, skyBlue } from "../../utils/style";

const BUTTON_SECONDARY = 3;
const BUTTON_OPTIONS = 4;

function templateParts(
    language: LanguageCode,
    templateKey: string,
    parts: Record<string, React.ReactNode>
) {
    const tokens: Record<string, string> = {};
    for (const key of Object.keys(parts)) {
        tokens[key] = `__NPACTIVITY_${key.toUpperCase()}__`;
    }

    const text = t(language, templateKey, tokens);
    const pattern = /(__NPACTIVITY_[A-Z0-9_]+__)/g;

    return text.split(pattern).map((piece, index) => {
        const match = Object.entries(tokens).find(([, token]) => token === piece);
        if (!match) {
            return piece;
        }
        return <React.Fragment key={`${piece}:${index}`}>{parts[match[0]]}</React.Fragment>;
    });
}

function gameTitleNode(language: LanguageCode, event: SocialActivityEvent) {
    const title = String(event.gameTitle || "").trim() || t(language, "Unknown game");
    return (
        <span style={{ color: skyBlue, fontWeight: 800 }}>
            {title}
        </span>
    );
}

function achievementTitleNode(language: LanguageCode, event: SocialActivityEvent) {
    const title = String(event.achievementTitle || "").trim() || t(language, "an achievement");
    return (
        <span style={{ color: achievementGreen, fontWeight: 800 }}>
            “{title}”
        </span>
    );
}

function bodyTextFor(language: LanguageCode, event: SocialActivityEvent) {
    if (event.kind === "achievementUnlocked") {
        return templateParts(language, "Unlocked {{achievement}} in {{game}}", {
            achievement: achievementTitleNode(language, event),
            game: gameTitleNode(language, event)
        });
    }
    if (event.kind === "gameBeaten") {
        return templateParts(language, "Beat {{game}}", {
            game: gameTitleNode(language, event)
        });
    }
    if (event.kind === "gameMastered") {
        return templateParts(language, "Mastered {{game}}", {
            game: gameTitleNode(language, event)
        });
    }
    return templateParts(language, "Recently played {{game}}", {
        game: gameTitleNode(language, event)
    });
}

function timestampTextFor(language: LanguageCode, event: SocialActivityEvent) {
    if (event.timestamp) {
        return formatUnlockDate(event.timestamp, {}, language);
    }
    return "";
}

export type NowPlayingActivityListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    onCardClick: (event: SocialActivityEvent) => void;
    onCardFocus: (index: number) => void;
    onCardSecondary?: (event: SocialActivityEvent) => void;
    onCardTertiary?: (event: SocialActivityEvent) => void;
};

type NowPlayingActivityCardProps = {
    event: SocialActivityEvent;
    focusKey: string;
    index: number;
    list: NowPlayingActivityListProps;
};

export const NowPlayingActivityCard = React.memo(function NowPlayingActivityCard(props: NowPlayingActivityCardProps) {
    const { event, list } = props;
    const { language, showIcons, metrics } = list;
    const subtitle = timestampTextFor(language, event);

    function handleClick() {
        list.onCardClick(event);
    }

    function handleFocus() {
        list.onCardFocus(props.index);
    }

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;
        if (button === BUTTON_SECONDARY) {
            playOkSound();
            list.onCardSecondary?.(event);
        }
        else if (button === BUTTON_OPTIONS) {
            playOkSound();
            list.onCardTertiary?.(event);
        }
    }

    return (
        <PanelSectionRow>
            <FocusableItem
                focusKey={props.focusKey}
                onClick={handleClick}
                onFocus={handleFocus}
                onButtonDown={handleButtonDown}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                        alignItems: "flex-start",
                        padding: "2px 0",
                        minWidth: 0
                    }}
                >
                    {showIcons && (
                        <UserAvatar
                            username={event.username}
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
                                fontSize: `${metrics.titleFontSize - 1}px`,
                                lineHeight: metrics.titleLineHeight,
                                fontWeight: 800,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {event.username || t(language, "Someone")}
                        </div>
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
                            {bodyTextFor(language, event)}
                        </div>
                        {subtitle && (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.pointsFontSize}px`,
                                    lineHeight: metrics.pointsLineHeight,
                                    opacity: 1,
                                    fontWeight: 700
                                }}
                            >
                                {subtitle}
                            </div>
                        )}
                    </div>
                </div>
            </FocusableItem>
        </PanelSectionRow>
    );
});
