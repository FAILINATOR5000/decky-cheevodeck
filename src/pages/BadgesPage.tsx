import React, { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { BackButton } from "../components/ui/BackButton";
import { FocusableItem } from "../components/ui/FocusableItem";
import { FadeImage } from "../components/ui/FadeImage";
import { ErrorText } from "../components/ui/ErrorText";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { AwardStamp } from "../components/achievements/AwardStamp";
import { formatUnlockDate } from "../utils/achievements";
import type {
    BadgeFilter,
    BadgesSortOrder,
    ButtonSpacing,
    UiSize,
    UserAwardRow,
    UserAwardsPayload,
    ViewKey
} from "../types";

import { smallTextStyle, bodyTextStyle, achievementUiMetrics, type AchievementUiMetrics, FADE_IN_KEYFRAMES } from "../utils/style";
import { useWindowedList } from "../hooks/useWindowedList";
import { cancelTabGameIcons, getCachedAwardIconDataUri, getCachedGameIconDataUri, prefetchAwardIcons, prefetchTabGameIcons, subscribeToAwardIcon, subscribeToGameIcon } from "../api";
import {
    localizeRuntimeText,
    t,
    type LanguageCode
} from "../locales";

function awardTypeLabel(award: UserAwardRow, language: LanguageCode) {
    const type = String(award.awardType || "").trim();
    if (type === "Game Beaten") {
        if (award.awardDataExtra === 1) {
            return t(language, "Beaten Hardcore");
        }
        return t(language, "Beaten Softcore");
    }
    if (type === "Mastery/Completion") {
        if (award.awardDataExtra === 1) {
            return t(language, "Mastered");
        }
        return t(language, "Completed");
    }
    if (type === "Achievement Unlocks Yield") {
        return t(language, "Achievement Unlocks Yield");
    }
    if (type === "Achievement Points Yield") {
        return t(language, "Achievement Points Yield");
    }
    if (type === "Patreon Supporter") {
        return t(language, "Patreon Supporter");
    }
    if (type === "Certified Legend") {
        return t(language, "Certified Legend");
    }
    return type || t(language, "Site Award");
}

type BadgesPageProps = {
    view: ViewKey;
    username: string;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    uiSize: UiSize;
    awardsError: string | null;
    awardsLoading: boolean;
    awardsPayload: UserAwardsPayload | null;
    dynamicList?: boolean;
    dynamicInitialRows?: number;
    dynamicRowStep?: number;
    dynamicPrefetchDistance?: number;
    dynamicSentinelRootMargin?: number;
    initialFilter?: BadgeFilter | null;
    onFilterChange?: (filter: BadgeFilter) => void;
    sortOrder: BadgesSortOrder;
    onSortOrderChange: (order: BadgesSortOrder) => void;
    onBadgeClick?: (gameId: number) => void | Promise<void>;
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

function awardRowKey(award: UserAwardRow, index: number) {
    return `badges:item:${award.awardType}:${award.awardData}:${index}`;
}

function isEventAward(award: UserAwardRow) {
    const type = String(award.awardType || "").trim();
    return type === "Event" || type === "Site Event";
}

function hasGameIdAward(award: UserAwardRow) {
    const type = String(award.awardType || "").trim();
    return type === "Mastery/Completion" || type === "Game Beaten";
}

function awardHasGameIcon(award: UserAwardRow) {
    const type = String(award.awardType || "").trim();
    if (award.awardData <= 0) {
        return false;
    }
    return type === "Mastery/Completion"
        || type === "Game Beaten"
        || type === "Event";
}

function matchesFilter(award: UserAwardRow, filter: BadgeFilter) {
    if (filter === "all") {
        return true;
    }
    const type = String(award.awardType || "").trim();
    if (filter === "mastered") {
        return type === "Mastery/Completion";
    }
    if (filter === "beaten") {
        return type === "Game Beaten";
    }
    if (filter === "event") {
        return type === "Event";
    }
    return type !== "Mastery/Completion"
        && type !== "Game Beaten"
        && type !== "Event";
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
type FilterIconProps = { size?: number };

function AllIcon({ size = 18 }: FilterIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M264.5 5.2c14.9-6.9 32.1-6.9 47 0l218.6 101c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 149.8C37.4 145.8 32 137.3 32 128s5.4-17.9 13.9-21.8L264.5 5.2zM476.9 209.6l53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 277.8C37.4 273.8 32 265.3 32 256s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0l152-70.2zm-152 198.2l152-70.2 53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 405.8C37.4 401.8 32 393.3 32 384s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0z" />
        </svg>
    );
}

function MasteredIcon({ size = 18 }: FilterIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M400 0H176c-26.5 0-48.1 21.8-47.1 48.2c.2 5.3 .4 10.6 .7 15.8H24C10.7 64 0 74.7 0 88c0 92.6 33.5 157 78.5 200.7c44.3 43.1 98.3 64.8 138.1 75.8c23.4 6.5 39.4 26 39.4 45.6c0 20.9-17 37.9-37.9 37.9H192c-17.7 0-32 14.3-32 32s14.3 32 32 32H384c17.7 0 32-14.3 32-32s-14.3-32-32-32H359.9c-20.9 0-37.9-17-37.9-37.9c0-19.6 15.9-39.2 39.4-45.6c39.9-11 93.9-32.7 138.2-75.8C544.5 245 578 180.6 578 88c0-13.3-10.7-24-24-24H447.4c.3-5.2 .5-10.4 .7-15.8C449.1 21.8 427.5 0 401 0h-1zM48.9 112h84.4c9.1 90.1 29.2 150.3 51.9 190.6c-24.9-11-50.8-26.5-73.2-48.3c-32-31.1-58-76-63-142.3zM464.1 254.3c-22.4 21.8-48.3 37.3-73.2 48.3c22.7-40.3 42.8-100.5 51.9-190.6h84.4c-5 66.3-31 111.2-63 142.3z" />
        </svg>
    );
}

function BeatenIcon({ size = 18 }: FilterIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M4.1 38.2C1.4 34.2 0 29.4 0 24.6C0 11 11 0 24.6 0L133.9 0c11.2 0 21.7 5.9 27.4 15.5l68.5 114.1c-48.2 6.1-91.3 28.6-123.4 61.9L4.1 38.2zm503.7 0L405.6 191.5c-32.1-33.3-75.2-55.8-123.4-61.9L350.7 15.5C356.5 5.9 366.9 0 378.1 0L487.4 0C501 0 512 11 512 24.6c0 4.8-1.4 9.6-4.1 13.6zM80 336a176 176 0 1 1 352 0A176 176 0 1 1 80 336zm184.4-94.9c-3.4-7-13.3-7-16.8 0l-22.4 45.4c-1.4 2.8-4 4.7-7 5.1L168 298.9c-7.7 1.1-10.7 10.5-5.2 16l36.3 35.4c2.2 2.2 3.2 5.2 2.7 8.3l-8.6 49.9c-1.3 7.6 6.7 13.5 13.6 9.9l44.8-23.6c2.7-1.4 6-1.4 8.7 0l44.8 23.6c6.9 3.6 14.9-2.2 13.6-9.9l-8.6-49.9c-.5-3 .5-6.1 2.7-8.3l36.3-35.4c5.6-5.4 2.5-14.8-5.2-16l-50.1-7.3c-3-.4-5.7-2.4-7-5.1l-22.4-45.4z" />
        </svg>
    );
}

function EventIcon({ size = 18 }: FilterIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M128 0c17.7 0 32 14.3 32 32V64H288V32c0-17.7 14.3-32 32-32s32 14.3 32 32V64h48c26.5 0 48 21.5 48 48v48H0V112C0 85.5 21.5 64 48 64H96V32c0-17.7 14.3-32 32-32zM0 192H448V464c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V192zM238.1 244.5l-21.7 44.2-48.7 7.1c-8.6 1.3-12 11.9-5.8 18l35.3 34.4-8.3 48.6c-1.5 8.6 7.6 15.2 15.3 11.1L224 432.6l43.6 22.9c7.7 4.1 16.7-2.5 15.3-11.1l-8.3-48.6 35.3-34.4c6.2-6.1 2.8-16.7-5.8-18l-48.7-7.1-21.7-44.2c-3.9-7.8-15-7.8-18.8 0z" />
        </svg>
    );
}

function OtherIcon({ size = 18 }: FilterIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M8 256a56 56 0 1 1 112 0A56 56 0 1 1 8 256zm160 0a56 56 0 1 1 112 0 56 56 0 1 1 -112 0zm216-56a56 56 0 1 1 0 112 56 56 0 1 1 0-112z" />
        </svg>
    );
}

type FilterStripEntry = {
    focusKey: string;
    value: BadgeFilter;
    Icon: ComponentType<FilterIconProps>;
    labelKey: string;
};

const BADGE_FILTER_STRIP: FilterStripEntry[] = [
    { focusKey: "badges:filter:all", value: "all", Icon: AllIcon, labelKey: "All" },
    { focusKey: "badges:filter:mastered", value: "mastered", Icon: MasteredIcon, labelKey: "Mastery" },
    { focusKey: "badges:filter:beaten", value: "beaten", Icon: BeatenIcon, labelKey: "Beaten" },
    { focusKey: "badges:filter:event", value: "event", Icon: EventIcon, labelKey: "Event" },
    { focusKey: "badges:filter:other", value: "other", Icon: OtherIcon, labelKey: "Other Awards" }
];

function sortOrderLabel(order: BadgesSortOrder, language: LanguageCode): string {
    return t(language, order === "newest" ? "Newest" : "Oldest");
}

function BadgesPage(props: BadgesPageProps) {
    const dynamicList = props.dynamicList ?? true;
    const dynamicInitialRows = Math.max(1, props.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, props.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(1, props.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, props.dynamicSentinelRootMargin ?? 600)}px 0px`;

    const sortOrder = props.sortOrder;
    const awardRows = props.awardsPayload?.results ?? [];
    const username = props.awardsPayload?.username ?? props.username ?? "";
    const totalLoaded = awardRows.length;

    const [activeFilter, setActiveFilter] = useState<BadgeFilter>(props.initialFilter ?? "all");

    const userPickedFilterRef = useRef(false);
    useEffect(() => {
        if (props.view !== "badges") {
            userPickedFilterRef.current = false;
            return;
        }
        if (userPickedFilterRef.current) {
            return;
        }
        setActiveFilter(props.initialFilter ?? "all");
    }, [props.view, props.initialFilter]);

    const filteredRows = useMemo(() => {
        const rows = activeFilter === "all"
            ? awardRows
            : awardRows.filter((award) => matchesFilter(award, activeFilter));
        const sorted = rows === awardRows ? rows.slice() : rows;
        const newestFirst = sortOrder === "newest";
        sorted.sort((a, b) => {
            const left = String(a.awardedAt || "");
            const right = String(b.awardedAt || "");
            if (!left || !right) {
                return left ? -1 : right ? 1 : 0;
            }
            if (left === right) {
                return 0;
            }
            const ascending = left < right ? -1 : 1;
            return newestFirst ? -ascending : ascending;
        });
        return sorted;
    }, [awardRows, activeFilter, sortOrder]);

    const {
        mountedItems: visibleAwards,
        markerRef: loadMoreMarkerRef,
        onItemFocus: maybeLoadMoreFromFocus
    } = useWindowedList({
        items: filteredRows,
        dynamicLoading: dynamicList,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: dynamicSentinelRootMargin,
        resetKey: `${username}|${props.view}|${activeFilter}|${sortOrder}`
    });

    const badgeClickRef = useRef(props.onBadgeClick);
    badgeClickRef.current = props.onBadgeClick;
    const rowFocusRef = useRef(maybeLoadMoreFromFocus);
    rowFocusRef.current = maybeLoadMoreFromFocus;

    const badgeClickWired = Boolean(props.onBadgeClick);

    const rowList = useMemo<BadgesRowListProps>(() => ({
        language: props.language,
        showIcons: props.showIcons,
        metrics: achievementUiMetrics(props.uiSize),
        badgeClickWired,
        onFocusIndex: (index) => {
            rowFocusRef.current(index);
        },
        onBadgeClick: (gameId) => {
            void badgeClickRef.current?.(gameId);
        }
    }), [props.language, props.showIcons, props.uiSize, badgeClickWired]);

    const iconFetchInFlightRef = useRef(false);
    const desiredIconAwardsRef = useRef<UserAwardRow[] | null>(null);
    const activeIconTokenRef = useRef<string>("");

    const kickIconPrefetch = useCallback(async () => {
        if (iconFetchInFlightRef.current) {
            return;
        }
        iconFetchInFlightRef.current = true;
        try {
            while (desiredIconAwardsRef.current) {
                const target = desiredIconAwardsRef.current;
                desiredIconAwardsRef.current = null;
                await prefetchTabGameIcons(
                    target.map((award) => ({ gameId: award.awardData, imageIcon: award.imageIcon ?? null }))
                );
            }
        } finally {
            iconFetchInFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (props.view !== "badges" || !props.showIcons) {
            return;
        }

        const iconAwards = visibleAwards.filter(awardHasGameIcon);

        const otherAwards = visibleAwards.filter((award) => !awardHasGameIcon(award) && award.imageIcon);
        void prefetchAwardIcons(otherAwards.map((award) => award.imageIcon));

        const token = `${username}:${activeFilter}`;
        const filterChanged = token !== activeIconTokenRef.current;
        activeIconTokenRef.current = token;
        desiredIconAwardsRef.current = iconAwards;

        if (filterChanged && iconFetchInFlightRef.current) {
            void cancelTabGameIcons();
        }

        void kickIconPrefetch();
    }, [props.view, props.showIcons, username, activeFilter, visibleAwards, kickIconPrefetch]);

    useEffect(() => {
        return () => {
            if (activeIconTokenRef.current) {
                void cancelTabGameIcons();
            }
        };
    }, []);

    const [focusedFilterKey, setFocusedFilterKey] = useState<string | null>(null);
    const [hoveredFilterKey, setHoveredFilterKey] = useState<string | null>(null);

    function handleFilterClick(value: BadgeFilter) {
        if (value === activeFilter) {
            return;
        }
        userPickedFilterRef.current = true;
        setActiveFilter(value);
        props.onFilterChange?.(value);
    }

    function handleCycleSortOrder() {
        props.onSortOrderChange(sortOrder === "newest" ? "oldest" : "newest");
    }

    if (props.view !== "badges") {
        return null;
    }

    const previewFilterKey = hoveredFilterKey ?? focusedFilterKey;
    const previewFilterEntry = BADGE_FILTER_STRIP.find((entry) => entry.focusKey === previewFilterKey);
    const activeFilterEntry = BADGE_FILTER_STRIP.find((entry) => entry.value === activeFilter);
    const filterStripLabel = t(props.language, (previewFilterEntry ?? activeFilterEntry)?.labelKey ?? "All");

    return (
        <>
            <style>{FADE_IN_KEYFRAMES}</style>
            <PanelSection>
                <PageNavStrip
                    title={t(props.language, "Awards")}
                    buttonSpacing={props.buttonSpacing}
                    onHome={props.onHome}
                />
                <BackButton
                    label={t(props.language, "← Back to Friend Profile")}
                    focusKey="badges:back"
                    navAutoFocus
                    buttonSpacing={props.buttonSpacing}
                    onClick={props.onBack}
                />
                {props.awardsError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(props.language, props.awardsError)}</ErrorText>
                    </PanelSectionRow>
                )}
                {props.awardsLoading && totalLoaded === 0 && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(props.language, "Loading awards...")}
                        </div>
                    </PanelSectionRow>
                )}
            </PanelSection>
            <PanelSection
                title={
                    props.awardsPayload?.totalAwardsCount
                        ? t(props.language, "Awards ({{count}})", {
                            count: props.awardsPayload.totalAwardsCount
                        })
                        : t(props.language, "Awards")
                }
            >
                {awardRows.length === 0 ? (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {props.awardsLoading
                                ? t(props.language, "Loading awards...")
                                : t(props.language, "No awards earned yet.")}
                        </div>
                    </PanelSectionRow>
                ) : (
                    <>
                        <LabeledRow
                            focusKey="badges:sortorder"
                            label={t(props.language, "Sort")}
                            value={sortOrderLabel(sortOrder, props.language)}
                            onClick={handleCycleSortOrder}
                            bottomSeparator="none"
                        />
                        <PanelSectionRow>
                            <div
                                style={{
                                    width: "100%",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "4px 0 8px 0"
                                }}
                            >
                                <Focusable
                                    flow-children="row"
                                    style={{
                                        display: "flex",
                                        gap: "8px",
                                        width: "100%",
                                        justifyContent: "center"
                                    }}
                                >
                                    {BADGE_FILTER_STRIP.map((entry) => {
                                        const isSelected = entry.value === activeFilter;
                                        const isPreviewed = previewFilterKey === entry.focusKey;
                                        const Icon = entry.Icon;

                                        const buttonOpacity = isSelected || isPreviewed ? 1 : 0.7;

                                        return (
                                            <div
                                                key={entry.focusKey}
                                                data-focus-key={entry.focusKey}
                                                onMouseEnter={() => setHoveredFilterKey(entry.focusKey)}
                                                onMouseLeave={() => setHoveredFilterKey((current) => current === entry.focusKey ? null : current)}
                                                style={{
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: "center",
                                                    width: "38px"
                                                }}
                                            >
                                                <DialogButton
                                                    onClick={() => handleFilterClick(entry.value)}
                                                    onGamepadFocus={() => setFocusedFilterKey(entry.focusKey)}
                                                    onGamepadBlur={() => setFocusedFilterKey((current) => current === entry.focusKey ? null : current)}
                                                    style={{
                                                        minWidth: 0,
                                                        width: "38px",
                                                        height: "38px",
                                                        padding: "4px 2px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        opacity: buttonOpacity,
                                                        boxShadow: isSelected
                                                            ? "0 0 0 2px rgba(120, 200, 255, 0.85), 0 2px 8px rgba(0,0,0,0.35)"
                                                            : isPreviewed
                                                                ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                                                                : undefined
                                                    }}
                                                >
                                                    <Icon size={18} />
                                                </DialogButton>
                                            </div>
                                        );
                                    })}
                                </Focusable>
                                <div
                                    style={{
                                        ...smallTextStyle(),
                                        fontWeight: 700,
                                        textAlign: "center",
                                        whiteSpace: "nowrap",
                                        height: "16px",
                                        opacity: 0.92
                                    }}
                                >
                                    {filterStripLabel}
                                </div>
                            </div>
                        </PanelSectionRow>
                        {filteredRows.length === 0 ? (
                            <PanelSectionRow>
                                <div style={bodyTextStyle()}>
                                    {t(props.language, "No awards match this filter.")}
                                </div>
                            </PanelSectionRow>
                        ) : (
                            <>
                                {visibleAwards.map((award, index) => {
                                    return (
                                        <BadgesRow
                                            key={awardRowKey(award, index)}
                                            award={award}
                                            index={index}
                                            list={rowList}
                                        />
                                    );
                                })}

                                {dynamicList && visibleAwards.length < filteredRows.length && (
                                    <div ref={loadMoreMarkerRef} style={{ height: "1px" }} />
                                )}
                            </>
                        )}
                    </>
                )}
            </PanelSection>
        </>
    );
}

type BadgesRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    badgeClickWired: boolean;
    onFocusIndex: (index: number) => void;
    onBadgeClick: (gameId: number) => void;
};

type BadgesRowProps = {
    award: UserAwardRow;
    index: number;
    list: BadgesRowListProps;
};

const BadgesRow = React.memo(function BadgesRow(props: BadgesRowProps) {
    const { award, list } = props;
    const { language, showIcons, metrics } = list;

    const typeLabel = awardTypeLabel(award, language);
    const rawTitle = String(award.title || "").trim();
    const displayTitle = rawTitle || typeLabel;
    const fallbackLetter = displayTitle.charAt(0).toUpperCase() || "?";

    const awardDate = formatUnlockDate(award.awardedAt, { includeYear: true, dateOnly: true }, language);

    const usesGameIcon = awardHasGameIcon(award);
    const awardIconUrl = (!usesGameIcon && award.imageIcon) ? award.imageIcon : null;

    const [iconDataUri, setIconDataUri] = useState<string | null>(() => {
        if (usesGameIcon) {
            return getCachedGameIconDataUri(award.awardData);
        }
        if (awardIconUrl) {
            return getCachedAwardIconDataUri(awardIconUrl);
        }
        return null;
    });

    const hadIconAtMount = useRef(iconDataUri !== null);

    useEffect(() => {
        if (usesGameIcon) {
            const cached = getCachedGameIconDataUri(award.awardData);
            if (cached) {
                setIconDataUri(cached);
                return;
            }
            const unsubscribe = subscribeToGameIcon(award.awardData, (dataUri) => {
                if (dataUri) {
                    setIconDataUri(dataUri);
                }
            });
            return () => {
                unsubscribe();
            };
        }

        if (awardIconUrl) {
            const cached = getCachedAwardIconDataUri(awardIconUrl);
            if (cached) {
                setIconDataUri(cached);
                return;
            }
            const unsubscribe = subscribeToAwardIcon(awardIconUrl, (dataUri) => {
                if (dataUri) {
                    setIconDataUri(dataUri);
                }
            });
            return () => {
                unsubscribe();
            };
        }

        return;
    }, [usesGameIcon, award.awardData, awardIconUrl]);

    function handleFocus() {
        list.onFocusIndex(props.index);
    }

    const canDrillIn = hasGameIdAward(award) && list.badgeClickWired;
    function handleClick() {
        if (!canDrillIn) {
            return;
        }
        list.onBadgeClick(award.awardData);
    }

    return (
        <FocusableItem
            focusKey={awardRowKey(award, props.index)}
            onFocus={handleFocus}
            onClick={canDrillIn ? handleClick : undefined}
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
                    {award.consoleName && !isEventAward(award) ? (
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
                            {award.consoleName}
                        </div>
                    ) : null}
                    {rawTitle ? (
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
                            {typeLabel}
                        </div>
                    ) : null}
                    {awardDate ? (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.pointsFontSize}px`,
                                lineHeight: metrics.pointsLineHeight,
                                opacity: 1,
                                fontWeight: 800,
                                minWidth: 0,
                                wordBreak: "break-word",
                                paddingTop: `${Math.max(2, metrics.contentGap - 1)}px`
                            }}
                        >
                            <AwardStamp date={awardDate} />
                        </div>
                    ) : null}
                </div>
            </div>
        </FocusableItem>
    );
});

export default BadgesPage;
