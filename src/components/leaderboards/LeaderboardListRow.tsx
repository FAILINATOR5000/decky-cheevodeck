import React from "react";
import { FaTrophy } from "react-icons/fa";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import type { LeaderboardRow } from "../../types";
import { smallTextStyle, type AchievementUiMetrics } from "../../utils/style";

export type LeaderboardRowListProps = {
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    blockPaddingStyle: string;
    onLeaderboardClick: (leaderboard: LeaderboardRow) => void;
    onRowFocus: (index: number) => void;
};

type LeaderboardListRowProps = {
    leaderboard: LeaderboardRow;
    index: number;
    iconSrc: string;
    fadeOnLoad: boolean;
    list: LeaderboardRowListProps;
};

export const LeaderboardListRow = React.memo(function LeaderboardListRow(props: LeaderboardListRowProps) {
    const { leaderboard, iconSrc, fadeOnLoad, list } = props;
    const { showIcons, metrics, blockPaddingStyle } = list;

    function handleLeaderboardClick() {
        list.onLeaderboardClick(leaderboard);
    }

    function handleLeaderboardFocus() {
        list.onRowFocus(props.index);
    }

    const titleLine = (
        <div
            style={{
                fontWeight: 700,
                fontSize: `${metrics.titleFontSize}px`,
                lineHeight: metrics.titleLineHeight,
                wordBreak: "break-word"
            }}
        >
            {leaderboard.title}
        </div>
    );
    const descriptionLine = leaderboard.description ? (
        <div
            style={{
                ...smallTextStyle(),
                fontSize: `${metrics.bodyFontSize}px`,
                lineHeight: metrics.bodyLineHeight,
                wordBreak: "break-word"
            }}
        >
            {leaderboard.description}
        </div>
    ) : null;

    return (
        <FocusableItem
            focusKey={`leaderboards:item:${leaderboard.id}`}
            onClick={handleLeaderboardClick}
            onFocus={handleLeaderboardFocus}
        >
            {showIcons ? (
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        gap: `${metrics.iconGap}px`,
                        alignItems: "center",
                        padding: blockPaddingStyle
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
                            justifyContent: "center",
                            flexShrink: 0
                        }}
                    >
                        {iconSrc ? (
                            <FadeImage
                                src={iconSrc}
                                fadeOnLoad={fadeOnLoad}
                                decoding="async"
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block"
                                }}
                            />
                        ) : (
                            <FaTrophy />
                        )}
                    </div>
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: `${metrics.textGap}px`
                        }}
                    >
                        {titleLine}
                        {descriptionLine}
                    </div>
                </div>
            ) : (
                <div
                    style={{
                        width: "100%",
                        padding: blockPaddingStyle,
                        display: "flex",
                        flexDirection: "column",
                        gap: `${metrics.textGap}px`
                    }}
                >
                    {titleLine}
                    {descriptionLine}
                </div>
            )}
        </FocusableItem>
    );
});
