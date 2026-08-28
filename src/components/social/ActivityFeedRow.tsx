import React from "react";
import { FocusableItem } from "../ui/FocusableItem";
import { UserAvatar } from "../ui/UserAvatar";
import { t, type LanguageCode } from "../../locales";
import type { SocialActivityEvent } from "../../types";
import { formatUnlockDate } from "../../utils/achievements";
import { BUTTON_OPTIONS, BUTTON_SECONDARY } from "../../utils/gamepadButtons";
import { playOkSound } from "../../utils/navSound";
import { achievementGreen, skyBlue, smallTextStyle, type AchievementUiMetrics } from "../../utils/style";

function activityTemplateParts(
    language: LanguageCode,
    templateKey: string,
    parts: Record<string, React.ReactNode>
) {
    const tokens: Record<string, string> = {};

    for (const key of Object.keys(parts)) {
        tokens[key] = `__ACTIVITY_${key.toUpperCase()}__`;
    }

    const text = t(language, templateKey, tokens);
    const pattern = /(__ACTIVITY_[A-Z0-9_]+__)/g;

    return text.split(pattern).map((piece, index) => {
        const match = Object.entries(tokens).find(([, token]) => token === piece);
        if (!match) {
            return piece;
        }

        return <React.Fragment key={`${piece}:${index}`}>{parts[match[0]]}</React.Fragment>;
    });
}

function activityGameTitle(event: SocialActivityEvent, language: LanguageCode) {
    return event.gameTitle || t(language, "Unknown game");
}

function activityAchievementTitle(event: SocialActivityEvent, language: LanguageCode) {
    return event.achievementTitle || t(language, "an achievement");
}

function activityGameText(event: SocialActivityEvent, language: LanguageCode) {
    return (
        <span style={{ color: skyBlue, fontWeight: 800 }}>
            {activityGameTitle(event, language)}
        </span>
    );
}

function activityAchievementText(event: SocialActivityEvent, language: LanguageCode) {
    return (
        <span style={{ color: achievementGreen, fontWeight: 800 }}>
            “{activityAchievementTitle(event, language)}”
        </span>
    );
}

function activityBodyText(event: SocialActivityEvent, language: LanguageCode) {
    if (event.kind === "achievementUnlocked") {
        return activityTemplateParts(language, "Unlocked {{achievement}} in {{game}}", {
            achievement: activityAchievementText(event, language),
            game: activityGameText(event, language)
        });
    }
    if (event.kind === "gameBeaten") {
        return activityTemplateParts(language, "Beat {{game}}", {
            game: activityGameText(event, language)
        });
    }
    if (event.kind === "gameMastered") {
        return activityTemplateParts(language, "Mastered {{game}}", {
            game: activityGameText(event, language)
        });
    }
    if (event.softWording) {
        return activityTemplateParts(language, "Was last seen playing {{game}}", {
            game: activityGameText(event, language)
        });
    }

    return activityTemplateParts(language, "Recently played {{game}}", {
        game: activityGameText(event, language)
    });
}

function activitySubtitle(event: SocialActivityEvent, language: LanguageCode) {
    if (event.timestamp) {
        return formatUnlockDate(event.timestamp, {}, language);
    }
    if (event.discoveredAt) {
        return t(language, "Discovered recently");
    }

    return "";
}

export type ActivityRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    onActivityCardClick: (event: SocialActivityEvent) => void;
    onCardSecondary?: (event: SocialActivityEvent) => void;
    onCardTertiary?: (event: SocialActivityEvent) => void;
};

type ActivityFeedRowProps = {
    event: SocialActivityEvent;
    list: ActivityRowListProps;
};

export const ActivityFeedRow = React.memo(function ActivityFeedRow(props: ActivityFeedRowProps) {
    const { event, list } = props;
    const { language, showIcons, metrics } = list;
    const subtitle = activitySubtitle(event, language);

    function handleClick() {
        list.onActivityCardClick(event);
    }

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;

        if (button === BUTTON_SECONDARY && list.onCardSecondary) {
            playOkSound();
            list.onCardSecondary(event);
            return;
        }

        if (button === BUTTON_OPTIONS && list.onCardTertiary) {
            playOkSound();
            list.onCardTertiary(event);
        }
    }

    return (
        <FocusableItem
            focusKey={`activity:${event.id}`}
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
                            fontSize: `${metrics.titleFontSize}px`,
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
                        {activityBodyText(event, language)}
                    </div>
                    {subtitle && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.pointsFontSize}px`,
                                lineHeight: metrics.pointsLineHeight,
                                opacity: 1,
                                fontWeight: 800,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {subtitle}
                        </div>
                    )}
                </div>
            </div>
        </FocusableItem>
    );
});
