import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelSection, PanelSectionRow } from "@decky/ui";
import { getAllTrackedGames, getCachedGameIconDataUri, prefetchTabGameIcons, subscribeToGameIcon } from "../../api";
import { ErrorText } from "../ui/ErrorText";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { useWindowedList } from "../../hooks/useWindowedList";
import type { LanguageCode } from "../../locales";
import { localizeRuntimeText, t } from "../../locales";
import type { TrackedGameSummary, UiSize } from "../../types";
import { logError } from "../../utils/errors";
import { achievementUiMetrics, type AchievementUiMetrics, smallTextStyle, bodyTextStyle, FADE_IN_KEYFRAMES } from "../../utils/style";

type OtherGamesPickerProps = {
    language: LanguageCode;
    showIcons: boolean;
    uiSize: UiSize;
    currentGameId: number | null;
    dynamicTrackedGames: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    onSelectGame?: (gameId: number) => void;
};

export function OtherGamesPicker(props: OtherGamesPickerProps) {
    const {
        language,
        showIcons,
        uiSize,
        currentGameId,
        dynamicTrackedGames,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        onSelectGame
    } = props;

    const [games, setGames] = useState<TrackedGameSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const result = await getAllTrackedGames();
                if (cancelled) {
                    return;
                }
                setGames(result.games ?? []);
                setError(null);
            } catch (e) {
                logError("getAllTrackedGames", e);
                if (cancelled) {
                    return;
                }
                setError("Couldn't load tracked games.");
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const sortedGames = useMemo(() => {
        const titled: TrackedGameSummary[] = [];
        const untitled: TrackedGameSummary[] = [];

        for (const game of games) {
            if (currentGameId != null && game.gameId === currentGameId) {
                continue;
            }
            if (game.title && game.title.trim()) {
                titled.push(game);
            }
            else {
                untitled.push(game);
            }
        }

        titled.sort((a, b) => {
            const aTitle = (a.title ?? "").toLowerCase();
            const bTitle = (b.title ?? "").toLowerCase();
            if (aTitle < bTitle) {
                return -1;
            }
            if (aTitle > bTitle) {
                return 1;
            }
            return 0;
        });

        untitled.sort((a, b) => a.gameId - b.gameId);

        return [...titled, ...untitled];
    }, [games, currentGameId]);

    const initialRows = Math.max(1, dynamicInitialRows);
    const rowStep = Math.max(1, dynamicRowStep);
    const prefetchDistance = Math.max(1, dynamicPrefetchDistance);

    const sentinelRootMargin = `${Math.max(0, dynamicSentinelRootMargin)}px 0px`;

    const {
        mountedItems: visibleGames,
        markerRef: loadMoreMarkerRef,
        onItemFocus: maybeLoadMoreFromFocus
    } = useWindowedList({
        items: sortedGames,
        dynamicLoading: dynamicTrackedGames,
        initialRows: initialRows,
        rowStep: rowStep,
        prefetchDistance: prefetchDistance,
        sentinelRootMargin: sentinelRootMargin,
        resetKey: "otherGames"
    });

    const selectGameRef = useRef(onSelectGame);
    selectGameRef.current = onSelectGame;
    const selectable = Boolean(onSelectGame);
    const rowFocusRef = useRef(maybeLoadMoreFromFocus);
    rowFocusRef.current = maybeLoadMoreFromFocus;

    const rowList = useMemo<OtherGameRowListProps>(() => ({
        language,
        showIcons,
        metrics: achievementUiMetrics(uiSize),
        selectable,
        onFocusIndex: (index) => {
            rowFocusRef.current(index);
        },
        onSelectGame: (gameId) => {
            selectGameRef.current?.(gameId);
        }
    }), [language, showIcons, uiSize, selectable]);

    const iconWarmInFlightRef = useRef(false);
    const desiredIconGamesRef = useRef<TrackedGameSummary[] | null>(null);

    const kickIconWarm = useCallback(async () => {
        if (iconWarmInFlightRef.current) {
            return;
        }
        iconWarmInFlightRef.current = true;
        try {
            while (desiredIconGamesRef.current) {
                const target = desiredIconGamesRef.current;
                desiredIconGamesRef.current = null;
                await prefetchTabGameIcons(
                    target.map((g) => ({ gameId: g.gameId, imageIcon: g.imageIcon ?? null }))
                );
            }
        } finally {
            iconWarmInFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (!showIcons || visibleGames.length === 0) {
            return;
        }
        desiredIconGamesRef.current = visibleGames;
        void kickIconWarm();
    }, [showIcons, visibleGames, kickIconWarm]);

    if (loading && games.length === 0) {
        return (
            <PanelSection title={t(language, "Other Games")}>
                <PanelSectionRow>
                    <div style={smallTextStyle()}>{t(language, "Loading tracked games...")}</div>
                </PanelSectionRow>
            </PanelSection>
        );
    }

    if (error) {
        return (
            <PanelSection title={t(language, "Other Games")}>
                <PanelSectionRow>
                    <ErrorText>{localizeRuntimeText(language, error)}</ErrorText>
                </PanelSectionRow>
            </PanelSection>
        );
    }

    if (sortedGames.length === 0) {
        return (
            <PanelSection title={t(language, "Other Games")}>
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {t(language, "No other games with tracked achievements yet.")}
                    </div>
                </PanelSectionRow>
            </PanelSection>
        );
    }

    return (
        <PanelSection title={t(language, "Other Games")}>
            <style>{FADE_IN_KEYFRAMES}</style>
            {visibleGames.map((game, index) => (
                <OtherGameRow
                    key={`trackedgames:item:${game.gameId}`}
                    game={game}
                    index={index}
                    list={rowList}
                />
            ))}
            {dynamicTrackedGames && visibleGames.length < sortedGames.length && (
                <div ref={loadMoreMarkerRef} style={{ height: "1px" }} />
            )}
        </PanelSection>
    );
}

type OtherGameRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    selectable: boolean;
    onFocusIndex: (index: number) => void;
    onSelectGame: (gameId: number) => void;
};

type OtherGameRowProps = {
    game: TrackedGameSummary;
    index: number;
    list: OtherGameRowListProps;
};

const OtherGameRow = React.memo(function OtherGameRow(props: OtherGameRowProps) {
    const { game, list } = props;
    const { language, showIcons, metrics } = list;

    const displayTitle = game.title?.trim()
        ? game.title
        : t(language, "Game {{gameId}}", { gameId: game.gameId });

    const [iconDataUri, setIconDataUri] = useState<string | null>(() => {
        return getCachedGameIconDataUri(game.gameId);
    });

    const hadIconAtMount = useRef(iconDataUri !== null);

    useEffect(() => {
        if (game.gameId == null) {
            return;
        }

        const cached = getCachedGameIconDataUri(game.gameId);
        if (cached) {
            setIconDataUri(cached);
            return;
        }

        const unsubscribe = subscribeToGameIcon(game.gameId, (dataUri) => {
            if (dataUri) {
                setIconDataUri(dataUri);
            }
        });

        return () => {
            unsubscribe();
        };
    }, [game.gameId]);

    const fallbackLetter = displayTitle.trim().charAt(0).toUpperCase() || "?";

    function handleFocus() {
        list.onFocusIndex(props.index);
    }

    function handleClick() {
        list.onSelectGame(game.gameId);
    }

    return (
        <FocusableItem
            focusKey={`trackedgames:item:${game.gameId}`}
            onFocus={handleFocus}
            onClick={list.selectable ? handleClick : undefined}
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
                                fadeOnLoad={!hadIconAtMount.current}
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
                        {displayTitle}
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
                        {game.consoleName || ""}
                    </div>
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
                        {t(language, "Tracked: {{count}}", { count: game.count })}
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});
