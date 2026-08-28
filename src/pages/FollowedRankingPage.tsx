import React, { useEffect, useMemo, useRef } from "react";
import { PanelSection, PanelSectionRow } from "@decky/ui";
import { prefetchUserAvatars } from "../api";
import { BackButton } from "../components/ui/BackButton";
import { FocusableItem } from "../components/ui/FocusableItem";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { UserAvatar } from "../components/ui/UserAvatar";
import { isFriendAvatarStale } from "../utils/friends";
import type {
    ButtonSpacing,
    FollowedRankingMetric,
    FriendRow,
    FriendsPayload,
    UiSize,
    ViewKey
} from "../types";

import { logError } from "../utils/errors";
import { formatInteger, formatRatio } from "../utils/format";
import { achievementUiMetrics, type AchievementUiMetrics, rankGutterWidth, regularButtonSpacingStyle, smallTextStyle, bodyTextStyle } from "../utils/style";
import { useWindowedList } from "../hooks/useWindowedList";
import { t, type LanguageCode } from "../locales";


const SELF_ROW_KEYFRAMES = `
@keyframes da-followed-ranking-self-glow {
    0%, 100% {
        border-left-color: rgba(245, 200, 50, 0.55);
        box-shadow: 0 0 0 0 rgba(245, 200, 50, 0);
    }
    50% {
        border-left-color: rgba(255, 215, 100, 1);
        box-shadow: 0 0 8px 1px rgba(245, 200, 50, 0.45);
    }
}
@media (prefers-reduced-motion: reduce) {
    .da-followed-ranking-self {
        animation: none !important;
        border-left-color: rgba(255, 215, 100, 1) !important;
    }
}
`;


const METRIC_ORDER: FollowedRankingMetric[] = [
    "hardcorePoints",
    "softcorePoints"
];


function nextRankingMetric(current: FollowedRankingMetric): FollowedRankingMetric {
    const index = METRIC_ORDER.indexOf(current);
    if (index < 0) {
        return "hardcorePoints";
    }
    return METRIC_ORDER[(index + 1) % METRIC_ORDER.length];
}


function rankingMetricLabel(metric: FollowedRankingMetric, language: LanguageCode): string {
    if (metric === "softcorePoints") {
        return t(language, "Softcore Points");
    }
    if (metric === "retroPoints") {
        return t(language, "RetroPoints");
    }
    if (metric === "retroRatio") {
        return t(language, "RetroRatio");
    }
    return t(language, "Hardcore Points");
}


function metricValueFor(row: FriendRow, metric: FollowedRankingMetric): number {
    if (metric === "softcorePoints") {
        return Number(row.pointsSoftcore ?? 0);
    }
    if (metric === "retroPoints") {
        return Number(row.totalTruePoints ?? 0);
    }
    if (metric === "retroRatio") {
        const hardcore = Number(row.points ?? 0);
        const retro = Number(row.totalTruePoints ?? 0);
        if (hardcore <= 0) {
            return 0;
        }
        return retro / hardcore;
    }
    return Number(row.points ?? 0);
}


function formatMetricValue(value: number, metric: FollowedRankingMetric): string {
    if (metric === "retroRatio") {
        return formatRatio(value, 1);
    }
    return formatInteger(value);
}


type FollowedRankingPageProps = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    uiSize: UiSize;
    friendsPayload: FriendsPayload | null;
    metric: FollowedRankingMetric;
    setMetric: (next: FollowedRankingMetric) => void;
    dynamicFollowedRanking?: boolean;
    dynamicInitialRows?: number;
    dynamicRowStep?: number;
    dynamicPrefetchDistance?: number;
    dynamicSentinelRootMargin?: number;
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};


function FollowedRankingPage(props: FollowedRankingPageProps) {
    const dynamicFollowedRanking = props.dynamicFollowedRanking ?? true;
    const dynamicInitialRows = Math.max(1, props.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, props.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(1, props.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, props.dynamicSentinelRootMargin ?? 600)}px 0px`;

    const allFriends = props.friendsPayload?.friends ?? [];

    const sortedRows = useMemo(() => {
        const copy = allFriends.slice();
        copy.sort((a, b) => {
            const left = metricValueFor(a, props.metric);
            const right = metricValueFor(b, props.metric);
            if (left !== right) {
                return right - left;
            }
            const nameLeft = String(a.username || "").toLowerCase();
            const nameRight = String(b.username || "").toLowerCase();
            return nameLeft.localeCompare(nameRight, undefined, { sensitivity: "base" });
        });
        return copy;
    }, [allFriends, props.metric]);

    const {
        mountedItems: mountedRows,
        markerRef: loadMoreMarkerRef,
        onItemFocus: maybeLoadMoreFromFocus
    } = useWindowedList({
        items: sortedRows,
        dynamicLoading: dynamicFollowedRanking,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: dynamicSentinelRootMargin,
        resetKey: props.metric
    });

    const rankWidth = rankGutterWidth(props.uiSize, sortedRows.length);

    const rowFocusRef = useRef(maybeLoadMoreFromFocus);
    rowFocusRef.current = maybeLoadMoreFromFocus;

    const rowList = useMemo<FollowedRankingRowListProps>(() => ({
        metric: props.metric,
        language: props.language,
        showIcons: props.showIcons,
        metrics: achievementUiMetrics(props.uiSize),
        rankWidth,
        onFocusIndex: (index) => {
            rowFocusRef.current(index);
        }
    }), [props.metric, props.language, props.showIcons, props.uiSize, rankWidth]);

    useEffect(() => {
        if (props.view !== "followedRanking") {
            return;
        }
        if (mountedRows.length === 0) {
            return;
        }
        const usernames = mountedRows
            .filter((row) => !row.avatarDataUri || isFriendAvatarStale(row))
            .map((row) => row.username);
        if (usernames.length === 0) {
            return;
        }
        void (async () => {
            try {
                await prefetchUserAvatars(usernames);
            }
            catch (e) {
                logError("FollowedRankingPage prefetchUserAvatars", e);
            }
        })();
    }, [props.view, mountedRows]);

    function handleSortClick() {
        props.setMetric(nextRankingMetric(props.metric));
    }

    if (props.view !== "followedRanking") {
        return null;
    }

    const total = sortedRows.length;
    const titleSection = t(props.language, "Followed Ranking");

    return (
        <>
            <style>{SELF_ROW_KEYFRAMES}</style>

            <PanelSection>
                <PageNavStrip
                    title={titleSection}
                    buttonSpacing={props.buttonSpacing}
                    onHome={props.onHome}
                />
                <BackButton
                    label={t(props.language, "← Back to Profile")}
                    focusKey="followedranking:back"
                    navAutoFocus
                    buttonSpacing={props.buttonSpacing}
                    onClick={props.onBack}
                />

                <LabeledRow
                    outerStyle={regularButtonSpacingStyle(props.buttonSpacing)}
                    focusKey="followedranking:sort"
                    onClick={handleSortClick}
                    label={t(props.language, "Ranking")}
                    value={rankingMetricLabel(props.metric, props.language)}
                />
            </PanelSection>

            <PanelSection
                title={
                    total > 0
                        ? t(props.language, "Ranked Friends ({{count}})", { count: total })
                        : t(props.language, "Ranked Friends")
                }
            >
                {sortedRows.length === 0 ? (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(props.language, "No friends to rank yet.")}
                        </div>
                    </PanelSectionRow>
                ) : (
                    <>
                        {mountedRows.map((row, index) => (
                            <FollowedRankingRowView
                                key={`followedranking:item:${row.username}`}
                                row={row}
                                rank={index + 1}
                                index={index}
                                list={rowList}
                            />
                        ))}

                        {dynamicFollowedRanking && mountedRows.length < sortedRows.length && (
                            <div ref={loadMoreMarkerRef} style={{ height: "1px" }} />
                        )}
                    </>
                )}
            </PanelSection>
        </>
    );
}


type FollowedRankingRowListProps = {
    metric: FollowedRankingMetric;
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    rankWidth: number;
    onFocusIndex: (index: number) => void;
};

type FollowedRankingRowViewProps = {
    row: FriendRow;
    rank: number;
    index: number;
    list: FollowedRankingRowListProps;
};


const FollowedRankingRowView = React.memo(function FollowedRankingRowView(props: FollowedRankingRowViewProps) {
    const { row, rank, list } = props;
    const { metric, language, showIcons, metrics, rankWidth } = list;
    const isSelf = Boolean(row.isSelf);
    const metricValue = metricValueFor(row, metric);
    const metricLabel = rankingMetricLabel(metric, language);
    const metricNumber = formatMetricValue(metricValue, metric);

    function handleFocus() {
        list.onFocusIndex(props.index);
    }

    return (
        <FocusableItem
            focusKey={`followedranking:item:${row.username}`}
            onFocus={handleFocus}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                className={isSelf ? "da-followed-ranking-self" : undefined}
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "center",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    paddingLeft: isSelf ? "8px" : undefined,
                    borderLeft: isSelf ? "3px solid rgba(255, 215, 100, 1)" : undefined,
                    animation: isSelf ? "da-followed-ranking-self-glow 2.4s ease-in-out infinite" : undefined,
                    minWidth: 0
                }}
            >
                <div
                    style={{
                        width: `${rankWidth}px`,
                        flexShrink: 0,
                        textAlign: "right",
                        fontWeight: 800,
                        fontSize: `${metrics.titleFontSize}px`,
                        lineHeight: metrics.titleLineHeight,
                        opacity: 0.92
                    }}
                >
                    #{rank}
                </div>
                {showIcons && (
                    <UserAvatar
                        username={row.username}
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
                        {row.username}
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
                        {`${metricLabel}: ${metricNumber}`}
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});

export default FollowedRankingPage;
