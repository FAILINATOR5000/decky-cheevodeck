import { PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { getLeaderboardIcons } from "../../api";
import { logError } from "../../utils/errors";
import { LeaderboardListRow, type LeaderboardRowListProps } from "./LeaderboardListRow";
import { useWindowedList } from "../../hooks/useWindowedList";
import type { GameLeaderboardsPayload, LeaderboardRow, UiSize } from "../../types";
import { achievementUiMetrics, bodyTextStyle } from "../../utils/style"
import {
    t,
    type LanguageCode
} from "../../locales";

const LEADERBOARD_ICON_CACHE_LIMIT = 32;
const leaderboardIconCache = new Map<number, Record<string, string>>();
const leaderboardIconCacheOrder: number[] = [];

function getCachedLeaderboardIcons(gameId: number): Record<string, string> {
    return leaderboardIconCache.get(gameId) || {};
}

function storeLeaderboardIcons(gameId: number, icons: Record<string, string>) {
    const existing = leaderboardIconCache.get(gameId) || {};
    leaderboardIconCache.set(gameId, { ...existing, ...icons });

    const existingIndex = leaderboardIconCacheOrder.indexOf(gameId);
    if (existingIndex >= 0) {
        leaderboardIconCacheOrder.splice(existingIndex, 1);
    }
    leaderboardIconCacheOrder.push(gameId);

    while (leaderboardIconCacheOrder.length > LEADERBOARD_ICON_CACHE_LIMIT) {
        const oldestGameId = leaderboardIconCacheOrder.shift();
        if (oldestGameId !== undefined) {
            leaderboardIconCache.delete(oldestGameId);
        }
    }
}

export function LeaderboardList(props: {
    payload: GameLeaderboardsPayload;
    language: LanguageCode;
    showIcons: boolean;
    uiSize: UiSize;
    topPadding: number;
    blockPadding: number;
    dynamicLeaderboardLoading?: boolean;
    dynamicInitialRows?: number;
    dynamicRowStep?: number;
    dynamicPrefetchDistance?: number;
    dynamicSentinelRootMargin?: number;
    onLeaderboardClick: (leaderboard: LeaderboardRow) => void | Promise<void>;
}) {
    const [iconMap, setIconMap] = useState<Record<string, string>>(() => {
        const gameId = props.payload?.gameId ?? null;
        if (gameId == null) {
            return {};
        }
        return { ...getCachedLeaderboardIcons(gameId) };
    });
    const coldIconIdsRef = useRef(new Set<string>());
    const dynamicLeaderboardLoading = props.dynamicLeaderboardLoading ?? true;
    const dynamicInitialRows = Math.max(1, props.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, props.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(1, props.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, props.dynamicSentinelRootMargin ?? 600)}px 0px`;
    const metrics = achievementUiMetrics(props.uiSize);
    const blockPaddingStyle = `${props.blockPadding}px 0`;
    const availableRows = useMemo(
        () => props.payload.results,
        [props.payload.results]
    );
    const availableRowsKey = useMemo(
        () => availableRows.map((leaderboard) => leaderboard.id).join("|"),
        [availableRows]
    );
    const {
        mountedItems: visibleRows,
        markerRef: loadMoreMarkerRef,
        onItemFocus: maybeLoadMoreFromFocus
    } = useWindowedList({
        items: availableRows,
        dynamicLoading: dynamicLeaderboardLoading,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: dynamicSentinelRootMargin,
        resetKey: availableRowsKey
    });

    const boardClickRef = useRef(props.onLeaderboardClick);
    boardClickRef.current = props.onLeaderboardClick;
    const boardFocusRef = useRef(maybeLoadMoreFromFocus);
    boardFocusRef.current = maybeLoadMoreFromFocus;

    const rowList = useMemo<LeaderboardRowListProps>(() => ({
        showIcons: props.showIcons,
        metrics,
        blockPaddingStyle,
        onLeaderboardClick: (leaderboard) => {
            void boardClickRef.current(leaderboard);
        },
        onRowFocus: (index) => {
            boardFocusRef.current(index);
        }
    }), [props.showIcons, metrics, blockPaddingStyle]);

    useEffect(() => {
        coldIconIdsRef.current.clear();
    }, [availableRowsKey]);

    useEffect(() => {
        let cancelled = false;
        const gameId = props.payload?.gameId ?? null;
        const missingRows = visibleRows.filter((row) => !iconMap[String(row.id)]);
        if (!props.showIcons || !gameId || missingRows.length === 0) {
            return () => {
                cancelled = true;
            };
        }
        const chunkSize = 6;
        void (async () => {
            try {
                for (let i = 0; i < missingRows.length; i += chunkSize) {
                    if (cancelled) {
                        return;
                    }
                    const chunk = missingRows.slice(i, i + chunkSize).map((row) => ({
                        id: row.id,
                        title: row.title,
                        format: row.format,
                        rankAsc: row.rankAsc
                    }));
                    const result = await getLeaderboardIcons(gameId, chunk);
                    if (cancelled) {
                        return;
                    }
                    const icons = result?.icons ?? {};
                    if (Object.keys(icons).length > 0) {
                        for (const id of Object.keys(icons)) {
                            coldIconIdsRef.current.add(id);
                        }
                        storeLeaderboardIcons(gameId, icons);
                        setIconMap((current) => ({ ...current, ...icons }));
                    }
                }
            } catch (e) {
                logError("leaderboard icons", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [props.payload?.gameId, props.showIcons, visibleRows, iconMap]);

    return (
        <PanelSection
            title={t(props.language, "Leaderboards ({{count}})", {
                count: props.payload.total || props.payload.results.length
            })}
        >
            {props.topPadding > 0 && <div style={{ height: `${props.topPadding}px` }} />}
            {visibleRows.length === 0 ? (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {t(props.language, "No leaderboards were returned for this game.")}
                    </div>
                </PanelSectionRow>
            ) : (
                <>
                    {visibleRows.map((leaderboard, index) => (
                        <LeaderboardListRow
                            key={leaderboard.id}
                            leaderboard={leaderboard}
                            index={index}
                            iconSrc={iconMap[String(leaderboard.id)] || ""}
                            fadeOnLoad={coldIconIdsRef.current.has(String(leaderboard.id))}
                            list={rowList}
                        />
                    ))}
                    {dynamicLeaderboardLoading && visibleRows.length < availableRows.length && (
                        <div
                            ref={loadMoreMarkerRef}
                            style={{ width: "100%", height: "1px", opacity: 0 }}
                        />
                    )}
                </>
            )}
        </PanelSection>
    );
}
