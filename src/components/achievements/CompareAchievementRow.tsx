import React, { useEffect, useRef, useState } from "react";
import {
    cacheAchievementIcons,
    getAchievementIcons,
    getCachedAchievementIcons
} from "../../api";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { PointsLabel } from "./PointsLabel";
import { t, type LanguageCode } from "../../locales";
import type { AchievementRow, AchievementStyle } from "../../types";
import {
    achievementUnlockDate,
    earned,
    formatUnlockDate,
    isMissable
} from "../../utils/achievements";
import { type AchievementUiMetrics, smallTextStyle, errorRed } from "../../utils/style";

export type CompareAchievementBorder = "green" | "red" | "neutral";

export type CompareRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    blockPadding: number;
    achievementStyle?: AchievementStyle;
    gameId: number | null;
    friendUsername: string;
    friendHasGameData: boolean;
    showRetroPoints?: boolean;
    onAchievementClick: (achievement: AchievementRow) => void;
    onRowFocus: (index: number) => void;
};

type CompareAchievementRowProps = {
    yourAchievement: AchievementRow;
    friendAchievement: AchievementRow | null;
    index: number;
    list: CompareRowListProps;
};

export function compareBorderFor(
    yourAchievement: AchievementRow,
    friendAchievement: AchievementRow | null
): CompareAchievementBorder {
    const youHaveIt = earned(yourAchievement);
    const theyHaveIt = friendAchievement ? earned(friendAchievement) : false;
    if (youHaveIt && !theyHaveIt) {
        return "green";
    }
    if (!youHaveIt && theyHaveIt) {
        return "red";
    }
    return "neutral";
}

function borderColorFor(border: CompareAchievementBorder) {
    if (border === "green") {
        return "#48bb78";
    }
    if (border === "red") {
        return "#f56565";
    }
    return "rgba(255,255,255,0.18)";
}

function unlockLine(
    achievement: AchievementRow | null,
    name: string,
    fallbackNotPlayed: string,
    fallbackNotUnlocked: string,
    language: LanguageCode
) {
    if (!achievement) {
        return fallbackNotPlayed;
    }
    if (!earned(achievement)) {
        return fallbackNotUnlocked;
    }
    const isHardcore = Boolean(achievement.dateEarnedHardcore);
    const date = formatUnlockDate(achievementUnlockDate(achievement), { includeYear: true, numericDate: true }, language);
    if (isHardcore) {
        return t(language, "Unlocked by {{name}} on {{date}} (HC)", { name, date });
    }
    return t(language, "Unlocked by {{name}} on {{date}}", { name, date });
}

export const CompareAchievementRow = React.memo(function CompareAchievementRow(props: CompareAchievementRowProps) {
    const { yourAchievement, friendAchievement, list } = props;
    const {
        language,
        showIcons,
        metrics,
        blockPadding,
        achievementStyle,
        gameId,
        friendUsername,
        friendHasGameData,
        showRetroPoints
    } = list;

    const blockPaddingStyle = `${blockPadding}px 0`;
    const border = compareBorderFor(yourAchievement, friendAchievement);
    const useLeftStyle = (achievementStyle ?? "left") === "left";

    const badgeName = String(yourAchievement.badgeName || "").trim();
    const initialIcon = badgeName && gameId != null
        ? (getCachedAchievementIcons(gameId, [badgeName])[badgeName] || "")
        : "";
    const [iconSrc, setIconSrc] = useState<string>(initialIcon);
    const wasWarmAtMount = useRef(initialIcon !== "");

    useEffect(() => {
        if (!showIcons || !badgeName || gameId == null || iconSrc) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const result = await getAchievementIcons(gameId, [badgeName]);
                if (cancelled) {
                    return;
                }
                const dataUri = result?.icons?.[badgeName] || "";
                if (dataUri) {
                    cacheAchievementIcons(gameId, { [badgeName]: dataUri });
                    setIconSrc(dataUri);
                }
            } catch {
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [badgeName, gameId, iconSrc, showIcons]);

    function handleClick() {
        list.onAchievementClick(yourAchievement);
    }
    function handleRowFocus() {
        list.onRowFocus(props.index);
    }

    const yourLine = unlockLine(
        yourAchievement,
        t(language, "you"),
        t(language, "You haven't unlocked this yet"),
        t(language, "You haven't unlocked this yet"),
        language
    );
    const friendLine = friendHasGameData
        ? unlockLine(
              friendAchievement,
              friendUsername,
              t(language, "{{name}} hasn't played this game", { name: friendUsername }),
              t(language, "{{name}} hasn't unlocked this yet", { name: friendUsername }),
              language
          )
        : t(language, "{{name}} hasn't played this game", { name: friendUsername });

    return (
        <FocusableItem
            focusKey={`compare:achievement:${yourAchievement.id}`}
            onClick={handleClick}
            onFocus={handleRowFocus}
            onGamepadFocus={handleRowFocus}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: `${metrics.rowGap}px`,
                    padding: blockPaddingStyle,
                    borderLeft: `3px solid ${borderColorFor(border)}`,
                    paddingLeft: "8px"
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
                    {showIcons && (
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
                                {iconSrc ? (
                                    <FadeImage
                                        src={iconSrc}
                                        fadeOnLoad={!wasWarmAtMount.current}
                                        decoding="async"
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                            display: "block"
                                        }}
                                    />
                                ) : (
                                    <span style={{ ...smallTextStyle(), opacity: 0.55 }}>...</span>
                                )}
                            </div>
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
                                <PointsLabel
                                    achievement={yourAchievement}
                                    showRetroPoints={Boolean(showRetroPoints)}
                                    language={language}
                                />
                            </div>
                        </div>
                    )}
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: useLeftStyle ? "flex-start" : undefined,
                            textAlign: useLeftStyle ? "left" : undefined,
                            gap: `${metrics.contentGap}px`
                        }}
                    >
                        <div
                            style={{
                                width: useLeftStyle ? "100%" : undefined,
                                fontWeight: 700,
                                fontSize: `${metrics.titleFontSize}px`,
                                lineHeight: metrics.titleLineHeight,
                                minWidth: 0,
                                wordBreak: "break-word",
                                textAlign: useLeftStyle ? "left" : undefined
                            }}
                        >
                            {yourAchievement.title}
                        </div>
                        <div
                            style={{
                                ...smallTextStyle(),
                                width: useLeftStyle ? "100%" : undefined,
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 0.82,
                                minWidth: 0,
                                wordBreak: "break-word",
                                textAlign: useLeftStyle ? "left" : undefined
                            }}
                        >
                            {yourAchievement.description}
                            {useLeftStyle && isMissable(yourAchievement) && (
                                <>
                                    {" "}
                                    <span style={{ color: errorRed }}>
                                        {t(language, "(missable)")}
                                    </span>
                                </>
                            )}
                        </div>
                        {!showIcons && (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.captionFontSize}px`,
                                    width: useLeftStyle ? "100%" : undefined,
                                    opacity: 0.9,
                                    fontWeight: 700,
                                    textAlign: useLeftStyle ? "left" : undefined,
                                    marginTop: useLeftStyle ? "6px" : undefined
                                }}
                            >
                                <PointsLabel
                                    achievement={yourAchievement}
                                    showRetroPoints={Boolean(showRetroPoints)}
                                    language={language}
                                />
                            </div>
                        )}
                        {isMissable(yourAchievement) && !useLeftStyle && (
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
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.captionFontSize}px`,
                                width: useLeftStyle ? "100%" : undefined,
                                fontWeight: 700,
                                opacity: earned(yourAchievement) ? 0.95 : 0.7,
                                textAlign: useLeftStyle ? "left" : undefined,
                                marginTop: useLeftStyle && showIcons ? "6px" : undefined
                            }}
                        >
                            {yourLine}
                        </div>
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.captionFontSize}px`,
                                width: useLeftStyle ? "100%" : undefined,
                                fontWeight: 700,
                                opacity: friendAchievement && earned(friendAchievement) ? 0.95 : 0.7,
                                textAlign: useLeftStyle ? "left" : undefined
                            }}
                        >
                            {friendLine}
                        </div>
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});
