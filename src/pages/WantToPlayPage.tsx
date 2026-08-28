import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanelSection, PanelSectionRow } from "@decky/ui";
import { BackButton } from "../components/ui/BackButton";
import { FocusableItem } from "../components/ui/FocusableItem";
import { ErrorText } from "../components/ui/ErrorText";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { FadeImage } from "../components/ui/FadeImage";
import { getCachedGameIconDataUri, getGameIconCached } from "../api";
import type {
    ButtonSpacing,
    FriendRow,
    UiSize,
    ViewKey,
    WantToPlayPayload,
    WantToPlayRow
} from "../types";

import { logError } from "../utils/errors";
import { formatInteger } from "../utils/format";
import { achievementUiMetrics, type AchievementUiMetrics, smallTextStyle, bodyTextStyle } from "../utils/style";
import { useWindowedList } from "../hooks/useWindowedList";
import { localizeRuntimeText, t, type LanguageCode } from "../locales";


type WantToPlayPageProps = {
    view: ViewKey;
    language: LanguageCode;
    selectedFriend: FriendRow | null;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    uiSize: UiSize;
    wantToPlayError: string | null;
    wantToPlayLoading: boolean;
    wantToPlayPayload: WantToPlayPayload | null;
    dynamicAllGames?: boolean;
    dynamicInitialRows?: number;
    dynamicRowStep?: number;
    dynamicPrefetchDistance?: number;
    dynamicSentinelRootMargin?: number;
    onBack: () => void | Promise<void>;
    onGameClick: (gameId: number) => void | Promise<void>;
    onHome: () => void | Promise<void>;
};


function WantToPlayPage(props: WantToPlayPageProps) {
    const dynamicAllGames = props.dynamicAllGames ?? true;
    const dynamicInitialRows = Math.max(1, props.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, props.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(1, props.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, props.dynamicSentinelRootMargin ?? 600)}px 0px`;

    const rows = props.wantToPlayPayload?.results ?? [];
    const username = props.wantToPlayPayload?.username ?? "";
    const totalLoaded = rows.length;

    const visibleRows = useMemo(() => {
        if (!dynamicAllGames) {
            return rows;
        }
        return rows;
    }, [dynamicAllGames, rows]);

    const {
        mountedItems: mountedRows,
        markerRef: loadMoreMarkerRef,
        onItemFocus: maybeLoadMoreFromFocus
    } = useWindowedList({
        items: visibleRows,
        dynamicLoading: dynamicAllGames,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: dynamicSentinelRootMargin,
        resetKey: username
    });

    const gameClickRef = useRef(props.onGameClick);
    gameClickRef.current = props.onGameClick;
    const rowFocusRef = useRef(maybeLoadMoreFromFocus);
    rowFocusRef.current = maybeLoadMoreFromFocus;

    const rowList = useMemo<WantToPlayRowListProps>(() => ({
        language: props.language,
        showIcons: props.showIcons,
        metrics: achievementUiMetrics(props.uiSize),
        onFocusIndex: (index) => {
            rowFocusRef.current(index);
        },
        onGameClick: (gameId) => {
            void gameClickRef.current(gameId);
        }
    }), [props.language, props.showIcons, props.uiSize]);

    if (props.view !== "wantToPlay") {
        return null;
    }

    const total = props.wantToPlayPayload?.total ?? 0;
    const titleSection = props.selectedFriend
        ? props.selectedFriend.username
        : t(props.language, "Want to Play");

    return (
        <>
            <PanelSection>
                <PageNavStrip
                    title={titleSection}
                    buttonSpacing={props.buttonSpacing}
                    onHome={props.onHome}
                />
                <BackButton
                    label={t(props.language, "← Back to Friend Profile")}
                    focusKey="wanttoplay:back"
                    navAutoFocus
                    buttonSpacing={props.buttonSpacing}
                    onClick={props.onBack}
                />
                {props.wantToPlayError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(props.language, props.wantToPlayError)}</ErrorText>
                    </PanelSectionRow>
                )}
                {props.wantToPlayLoading && totalLoaded === 0 && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(props.language, "Loading want-to-play list...")}
                        </div>
                    </PanelSectionRow>
                )}
            </PanelSection>
            <PanelSection
                title={
                    total > 0
                        ? t(props.language, "Want to Play ({{count}})", { count: total })
                        : t(props.language, "Want to Play")
                }
            >
                {rows.length === 0 ? (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {props.wantToPlayLoading
                                ? t(props.language, "Loading want-to-play list...")
                                : t(props.language, "No want-to-play games to show. RA only shares this list with you and people you mutually follow.")}
                        </div>
                    </PanelSectionRow>
                ) : (
                    <>
                        {mountedRows.map((row, index) => (
                            <WantToPlayRowView
                                key={`wanttoplay:item:${row.gameId}`}
                                row={row}
                                index={index}
                                list={rowList}
                            />
                        ))}

                        {dynamicAllGames && mountedRows.length < visibleRows.length && (
                            <div ref={loadMoreMarkerRef} style={{ height: "1px" }} />
                        )}
                    </>
                )}
            </PanelSection>
        </>
    );
}


type WantToPlayRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    onFocusIndex: (index: number) => void;
    onGameClick: (gameId: number) => void;
};

type WantToPlayRowViewProps = {
    row: WantToPlayRow;
    index: number;
    list: WantToPlayRowListProps;
};

const WantToPlayRowView = React.memo(function WantToPlayRowView(props: WantToPlayRowViewProps) {
    const { row, list } = props;
    const { language, showIcons, metrics } = list;

    const [iconDataUri, setIconDataUri] = useState<string | null>(() => {
        return getCachedGameIconDataUri(row.gameId);
    });
    const wasWarmAtMount = useRef(iconDataUri !== null);

    useEffect(() => {
        if (iconDataUri) {
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const result = await getGameIconCached(row.gameId, row.imageIcon);
                if (cancelled) {
                    return;
                }
                if (result?.dataUri) {
                    setIconDataUri(result.dataUri);
                }
            } catch (e) {
                logError("getGameIconCached (want to play row)", e);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [row.gameId, row.imageIcon, iconDataUri]);

    const fallbackLetter = String(row.title || "").trim().charAt(0).toUpperCase() || "?";

    function handleFocus() {
        list.onFocusIndex(props.index);
    }

    function handleClick() {
        list.onGameClick(row.gameId);
    }

    const totalAchievements = row.maxPossible ?? row.achievementsPublished ?? 0;
    const earnedAchievements = row.numAwarded ?? 0;

    return (
        <FocusableItem
            focusKey={`wanttoplay:item:${row.gameId}`}
            onFocus={handleFocus}
            onClick={handleClick}
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
                        {row.title}
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
                        {row.consoleName || ""}
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
                        {totalAchievements > 0
                            ? t(language, "Unlocked: {{earned}} / {{total}}", {
                                earned: formatInteger(earnedAchievements),
                                total: formatInteger(totalAchievements)
                            })
                            : t(language, "No achievements published yet.")}
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
                        {t(language, "Total points: {{points}}", {
                            points: formatInteger(row.pointsTotal ?? 0)
                        })}
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});

export default WantToPlayPage;
