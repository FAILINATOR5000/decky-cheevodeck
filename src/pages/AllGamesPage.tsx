import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { BackButton } from "../components/ui/BackButton";
import { FocusableItem } from "../components/ui/FocusableItem";
import { FadeImage } from "../components/ui/FadeImage";
import { LabeledRow } from "../components/ui/LabeledRow";
import { ErrorText } from "../components/ui/ErrorText";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { cancelTabGameIcons, getCachedGameIconDataUri, prefetchTabGameIcons, subscribeToGameIcon } from "../api";
import type {
    AllGamesLetterRangeKey,
    AllGamesStatusFilter,
    ButtonSpacing,
    FriendAllGameRow,
    FriendAllGamesPayload,
    FriendRow,
    UiSize,
    ViewKey
} from "../types";

import { formatInteger } from "../utils/format";
import { achievementUiMetrics, type AchievementUiMetrics, smallTextStyle, bodyTextStyle, FADE_IN_KEYFRAMES } from "../utils/style";
import { useWindowedList } from "../hooks/useWindowedList";
import {
    DEFAULT_LANGUAGE,
    localizeRuntimeText,
    t,
    type LanguageCode
} from "../locales";

type AllGamesLetterRange = {
    key: AllGamesLetterRangeKey;
    label: string;
    from: string | null;
    to: string | null;
};

const ALL_GAMES_LETTER_RANGES: AllGamesLetterRange[] = [
    { key: "numbers", label: "#", from: null, to: null },
    { key: "a-f", label: "A-F", from: "A", to: "F" },
    { key: "g-l", label: "G-L", from: "G", to: "L" },
    { key: "m-r", label: "M-R", from: "M", to: "R" },
    { key: "s-u", label: "S-U", from: "S", to: "U" },
    { key: "v-z", label: "V-Z", from: "V", to: "Z" }
];
const DEFAULT_ALL_GAMES_RANGE_KEY: AllGamesLetterRangeKey = "a-f";

export function highestAwardLabel(value?: string | null, language: LanguageCode = DEFAULT_LANGUAGE) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) {
        return t(language, "Unfinished");
    }
    if (text === "beaten-softcore") {
        return t(language, "Beaten Softcore");
    }
    if (text === "beaten-hardcore") {
        return t(language, "Beaten Hardcore");
    }
    if (text === "completed") {
        return t(language, "Completed");
    }
    if (text === "mastered") {
        return t(language, "Mastered");
    }
    return text
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

const ALL_GAMES_STATUS_CYCLE: AllGamesStatusFilter[] = [
    "all",
    "mastered",
    "completed",
    "beaten-hardcore",
    "beaten-softcore",
    "unfinished"
];

export function nextAllGamesStatusFilter(current: AllGamesStatusFilter): AllGamesStatusFilter {
    const at = ALL_GAMES_STATUS_CYCLE.indexOf(current);
    const next = (at + 1) % ALL_GAMES_STATUS_CYCLE.length;
    return ALL_GAMES_STATUS_CYCLE[next];
}

export function statusFilterLabel(filter: AllGamesStatusFilter, language: LanguageCode): string {
    if (filter === "all") {
        return t(language, "All");
    }
    if (filter === "unfinished") {
        return t(language, "Unfinished");
    }
    return highestAwardLabel(filter, language);
}

const AWARD_STATUS_KINDS = ["mastered", "completed", "beaten-hardcore", "beaten-softcore"];

export function gameMatchesStatusFilter(game: { highestAwardKind?: string | null }, filter: AllGamesStatusFilter): boolean {
    if (filter === "all") {
        return true;
    }
    const kind = String(game.highestAwardKind || "").trim().toLowerCase();
    if (filter === "unfinished") {
        return !AWARD_STATUS_KINDS.includes(kind);
    }
    return kind === filter;
}

type AllGamesPageProps = {
    view: ViewKey;
    language: LanguageCode;
    selectedFriend: FriendRow | null;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    uiSize: UiSize;
    friendAllGamesError: string | null;
    friendAllGamesLoading: boolean;
    friendAllGamesPayload: FriendAllGamesPayload | null;
    dynamicAllGames?: boolean;
    dynamicInitialRows?: number;
    dynamicRowStep?: number;
    dynamicPrefetchDistance?: number;
    dynamicSentinelRootMargin?: number;
    initialRangeKey?: AllGamesLetterRangeKey | null;
    initialStatusFilter?: AllGamesStatusFilter | null;
    onRangeChange?: (rangeKey: AllGamesLetterRangeKey) => void;
    onStatusFilterChange?: (filter: AllGamesStatusFilter) => void;
    onBack: () => void | Promise<void>;
    onGameClick: (gameId: number) => void | Promise<void>;
    onOpenGameSearch: () => void;
    onHome: () => void | Promise<void>;
};

function firstLetterForTitle(title: string) {
    const first = String(title || "").trim().charAt(0).toUpperCase();
    return first || "#";
}

function isGameInRange(game: FriendAllGameRow, range: AllGamesLetterRange) {
    const first = firstLetterForTitle(game.title);
    if (!range.from || !range.to) {
        return first < "A" || first > "Z";
    }

    return first >= range.from && first <= range.to;
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function SearchIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z" />
        </svg>
    );
}

function AllGamesPage(props: AllGamesPageProps) {
    const [activeRangeKey, setActiveRangeKey] = useState<AllGamesLetterRangeKey>(
        props.initialRangeKey ?? DEFAULT_ALL_GAMES_RANGE_KEY
    );
    const [activeStatusFilter, setActiveStatusFilter] = useState<AllGamesStatusFilter>(
        props.initialStatusFilter ?? "all"
    );

    const dynamicAllGames = props.dynamicAllGames ?? true;
    const dynamicInitialRows = Math.max(1, props.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, props.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(1, props.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, props.dynamicSentinelRootMargin ?? 600)}px 0px`;

    const allGamesRows = props.friendAllGamesPayload?.results ?? [];
    const friendUsername = props.friendAllGamesPayload?.friendUsername ?? "";

    const userPickedTabRef = useRef(false);
    useEffect(() => {
        if (props.view !== "friendAllGames") {
            userPickedTabRef.current = false;
            return;
        }
        if (userPickedTabRef.current) {
            return;
        }
        setActiveRangeKey(props.initialRangeKey ?? DEFAULT_ALL_GAMES_RANGE_KEY);
        setActiveStatusFilter(props.initialStatusFilter ?? "all");
    }, [props.view, props.initialRangeKey, props.initialStatusFilter]);

    const lastFriendRef = useRef<string | null>(null);
    useEffect(() => {
        if (!friendUsername) {
            return;
        }
        if (lastFriendRef.current === null) {
            lastFriendRef.current = friendUsername;
            return;
        }
        if (lastFriendRef.current === friendUsername) {
            return;
        }
        lastFriendRef.current = friendUsername;
        userPickedTabRef.current = false;
        setActiveRangeKey(DEFAULT_ALL_GAMES_RANGE_KEY);
        setActiveStatusFilter("all");
        props.onRangeChange?.(DEFAULT_ALL_GAMES_RANGE_KEY);
        props.onStatusFilterChange?.("all");
    }, [friendUsername]);

    const activeRange = useMemo(() => {
        return ALL_GAMES_LETTER_RANGES.find((range) => range.key === activeRangeKey) ?? ALL_GAMES_LETTER_RANGES[1];
    }, [activeRangeKey]);

    const filteredGames = useMemo(() => {
        return allGamesRows.filter(
            (game) => isGameInRange(game, activeRange) && gameMatchesStatusFilter(game, activeStatusFilter)
        );
    }, [activeRange, allGamesRows, activeStatusFilter]);

    const totalLoaded = allGamesRows.length;

    const {
        mountedItems: visibleGames,
        markerRef: loadMoreMarkerRef,
        onItemFocus: maybeLoadMoreFromFocus
    } = useWindowedList({
        items: filteredGames,
        dynamicLoading: dynamicAllGames,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: dynamicSentinelRootMargin,
        resetKey: `${activeRangeKey}|${activeStatusFilter}|${friendUsername}`
    });

    const gameClickRef = useRef(props.onGameClick);
    gameClickRef.current = props.onGameClick;
    const rowFocusRef = useRef(maybeLoadMoreFromFocus);
    rowFocusRef.current = maybeLoadMoreFromFocus;

    const rowList = useMemo<AllGamesRowListProps>(() => ({
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

    const iconFetchInFlightRef = useRef(false);
    const desiredIconGamesRef = useRef<FriendAllGameRow[] | null>(null);
    const activeIconTokenRef = useRef<string>("");

    const kickIconPrefetch = useCallback(async () => {
        if (iconFetchInFlightRef.current) {
            return;
        }
        iconFetchInFlightRef.current = true;
        try {
            while (desiredIconGamesRef.current) {
                const target = desiredIconGamesRef.current;
                desiredIconGamesRef.current = null;
                await prefetchTabGameIcons(
                    target.map((g) => ({ gameId: g.gameId, imageIcon: g.imageIcon ?? null }))
                );
            }
        } finally {
            iconFetchInFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (props.view !== "friendAllGames" || !props.showIcons) {
            return;
        }

        const token = `${friendUsername}:${activeRangeKey}:${activeStatusFilter}`;
        const tabChanged = token !== activeIconTokenRef.current;
        activeIconTokenRef.current = token;
        desiredIconGamesRef.current = visibleGames;

        if (tabChanged && iconFetchInFlightRef.current) {
            void cancelTabGameIcons();
        }

        void kickIconPrefetch();
    }, [props.view, props.showIcons, friendUsername, activeRangeKey, activeStatusFilter, visibleGames, kickIconPrefetch]);

    useEffect(() => {
        return () => {
            if (activeIconTokenRef.current) {
                void cancelTabGameIcons();
            }
        };
    }, []);

    function handleRangeClick(rangeKey: AllGamesLetterRangeKey) {
        userPickedTabRef.current = true;
        setActiveRangeKey(rangeKey);
        props.onRangeChange?.(rangeKey);
    }

    function handleCycleStatusFilter() {
        userPickedTabRef.current = true;
        setActiveStatusFilter((current) => {
            const next = nextAllGamesStatusFilter(current);
            props.onStatusFilterChange?.(next);
            return next;
        });
    }

    if (props.view !== "friendAllGames") {
        return null;
    }

    return (
        <>
            <style>{FADE_IN_KEYFRAMES}</style>
            <PanelSection>
                <PageNavStrip
                    title={t(props.language, "Games")}
                    buttonSpacing={props.buttonSpacing}
                    onHome={props.onHome}
                />
                <BackButton
                    label={t(props.language, "← Back to Friend Profile")}
                    focusKey="friendallgames:back"
                    navAutoFocus
                    buttonSpacing={props.buttonSpacing}
                    onClick={props.onBack}
                />
                {props.friendAllGamesError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(props.language, props.friendAllGamesError)}</ErrorText>
                    </PanelSectionRow>
                )}
                {props.friendAllGamesLoading && totalLoaded === 0 && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(props.language, "Loading all games...")}
                        </div>
                    </PanelSectionRow>
                )}
            </PanelSection>
            <PanelSection
                title={
                    props.friendAllGamesPayload?.total
                        ? t(props.language, "All Games ({{count}})", { count: props.friendAllGamesPayload.total })
                        : t(props.language, "All Games")
                }
            >
                <PanelSectionRow>
                    <FocusableItem
                        focusKey="friendallgames:search"
                        onClick={() => props.onOpenGameSearch()}
                        outerStyle={{ width: "100%", minWidth: 0 }}
                        bottomSeparator="none"
                    >
                        <div
                            style={{
                                width: "100%",
                                boxSizing: "border-box",
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                gap: "8px",
                                padding: "7px 10px",
                                borderRadius: "8px",
                                background: "rgba(255,255,255,0.08)",
                                border: "1px solid rgba(255,255,255,0.14)",
                                minWidth: 0
                            }}
                        >
                            <SearchIcon size={16} />
                            <span
                                style={{
                                    ...bodyTextStyle(),
                                    flex: 1,
                                    minWidth: 0,
                                    textAlign: "left",
                                    opacity: 0.75,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis"
                                }}
                            >
                                {t(props.language, "Search Game")}
                            </span>
                        </div>
                    </FocusableItem>
                </PanelSectionRow>
                <LabeledRow
                    focusKey="friendallgames:statusfilter"
                    label={t(props.language, "Filter")}
                    value={statusFilterLabel(activeStatusFilter, props.language)}
                    onClick={handleCycleStatusFilter}
                    bottomSeparator="none"
                />
                <PanelSectionRow>
                    <Focusable
                        flow-children="row"
                        style={{
                            display: "flex",
                            gap: "6px",
                            padding: "0 0 8px 0",
                            width: "100%",
                            justifyContent: "space-between"
                        }}
                    >
                        {ALL_GAMES_LETTER_RANGES.map((range) => {
                            const active = activeRangeKey === range.key;

                            return (
                                <DialogButton
                                    key={`friendallgames:range:${range.key}`}
                                    onClick={() => handleRangeClick(range.key)}
                                    style={{
                                        minWidth: 0,
                                        width: "36px",
                                        height: "30px",
                                        padding: "4px 2px",
                                        fontSize: "11px",
                                        fontWeight: active ? 800 : 600,
                                        opacity: active ? 1 : 0.72,
                                        outline: active ? "1px solid rgba(255,255,255,0.55)" : undefined
                                    }}
                                >
                                    {range.label}
                                </DialogButton>
                            );
                        })}
                    </Focusable>
                </PanelSectionRow>

                {allGamesRows.length === 0 ? (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {props.friendAllGamesLoading
                                ? t(props.language, "Loading games...")
                                : t(props.language, "No game progress found for this friend yet.")}
                        </div>
                    </PanelSectionRow>
                ) : visibleGames.length === 0 ? (
                    <>
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                {props.friendAllGamesLoading
                                    ? t(props.language, "Loading games...")
                                    : t(props.language, "No games found in this range.")}
                            </div>
                        </PanelSectionRow>
                    </>
                ) : (
                    <>
                        {visibleGames.map((game, index) => {
                            return (
                                <AllGamesRow
                                    key={`friendallgames:item:${game.gameId}`}
                                    game={game}
                                    index={index}
                                    list={rowList}
                                />
                            );
                        })}

                        {dynamicAllGames && visibleGames.length < filteredGames.length && (
                            <div ref={loadMoreMarkerRef} style={{ height: "1px" }} />
                        )}
                    </>
                )}
            </PanelSection>
        </>
    );
}

type AllGamesRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    onFocusIndex: (index: number) => void;
    onGameClick: (gameId: number) => void;
};

type AllGamesRowProps = {
    game: FriendAllGameRow;
    index: number;
    list: AllGamesRowListProps;
};

const AllGamesRow = React.memo(function AllGamesRow(props: AllGamesRowProps) {
    const { game, list } = props;
    const { language, showIcons, metrics } = list;

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

    const fallbackLetter = String(game.title || "").trim().charAt(0).toUpperCase() || "?";

    function handleFocus() {
        list.onFocusIndex(props.index);
    }

    function handleClick() {
        list.onGameClick(game.gameId);
    }

    return (
        <FocusableItem
            focusKey={`friendallgames:item:${game.gameId}`}
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
                        {game.title}
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
                            fontSize: `${metrics.bodyFontSize}px`,
                            lineHeight: metrics.bodyLineHeight,
                            opacity: 1,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {(game.maxPossible ?? 0) > 0
                            ? t(language, "Completion: {{earned}} / {{total}}", {
                                earned: formatInteger(game.numAwarded),
                                total: formatInteger(game.maxPossible)
                            })
                            : t(language, "No awards yet.")}
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
                        {t(language, "Status: {{status}}", {
                            status: highestAwardLabel(game.highestAwardKind, language)
                        })}
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});

export default AllGamesPage;
