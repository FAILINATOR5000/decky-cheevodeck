import { cacheAchievementIcons, debugLoggingEnabled, getAchievementIcons, getCachedAchievementIcons,
    logSortDebug
} from "../../api";
import { AchievementListRow, type AchievementRowListProps } from "./AchievementListRow";
import { BottomFocusAnchor } from "../ui/BottomFocusAnchor";
import { FocusClaim } from "../ui/FocusClaim";
import {
    t,
    type LanguageCode
} from "../../locales";
import type {
    AchievementListMode,
    AchievementRow,
    AchievementSort,
    AchievementStyle,
    ButtonSpacing,
    FriendAchievementFilter,
    MainAchievementFilter,
    Payload,
    ReorderDirection,
    TrackedColor,
    TrackedNotes,
    TrackedNotesColor,
    UiSize
} from "../../types";

import { achievementUiMetrics } from "../../utils/style"
import { communityCompletionLabel, earned, metricSortComparator, isMissable, noteBodyColor, parseNoteTag, trackedColorHex, unlockDateLabel, unlockedHardcore, unlockedSoftcore } from "../../utils/achievements";
import { bodyTextStyle, FADE_IN_KEYFRAMES } from "../../utils/style";
import { logError } from "../../utils/errors";
import { useWindowedList } from "../../hooks/useWindowedList";
import { UnlockStamp } from "./UnlockStamp";
import { POINTS_LABEL_STYLES } from "./PointsLabel";
import { PanelSection, PanelSectionRow } from "@decky/ui";
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export function AchievementList(props: {
    payload: Payload;
    language: LanguageCode;
    showIcons: boolean;
    uiSize: UiSize;
    topPadding: number;
    blockPadding: number;
    buttonSpacing?: ButtonSpacing;
    achievementStyle?: AchievementStyle;
    trackedColor?: TrackedColor;
    showAll?: boolean;
    mode?: AchievementListMode;
    filterScopeKey?: string;
    trackedIds?: number[];
    notesByAchievementId?: TrackedNotes;
    notesColorByAchievementId?: TrackedNotesColor;
    showTrackedNotesMain?: boolean;
    showRetroPoints?: boolean;
    mainFilter?: MainAchievementFilter;
    mainSort?: AchievementSort;
    friendFilter?: FriendAchievementFilter;
    friendSort?: AchievementSort;
    onAchievementClick?: (achievement: AchievementRow) => void | Promise<void>;
    reorderTargetId?: number | null;
    reorderViaSwap?: boolean;
    claimedRow?: {
        slotIndex: number;
        token: number;
        armed: boolean;
        onSpent: () => void;
    };
    titleOverride?: string;
    resetToken?: number;
    preRows?: React.ReactNode;
    onAchievementTrackToggle?: (achievement: AchievementRow) => void;
    onAchievementNote?: (achievement: AchievementRow) => void;
    onAchievementReorderPick?: (achievement: AchievementRow) => void;
    onAchievementReorderNudge?: (direction: ReorderDirection) => void;
    dynamicLoading?: boolean;
    dynamicInitialRows?: number;
    dynamicRowStep?: number;
    dynamicPrefetchDistance?: number;
    dynamicSentinelRootMargin?: number;
    emptyMessageOverride?: ReactNode;
    emptyFocusAnchorKey?: string;
    getAchievementExtraLabel?: (achievement: AchievementRow) => ReactNode;
}) {
    const ICON_STREAM_CHUNK = 10;

    const [iconMap, setIconMap] = useState<Record<string, string>>({});
    const coldBadgesRef = useRef(new Set<string>());
    const pumpedBadgesRef = useRef(new Set<string>());
    const displayOrderRef = useRef<AchievementRow[]>([]);
    const pumpRunsRef = useRef(0);
    const coldScopeRef = useRef<string | null>(null);
    const lastSortedIdsRef = useRef<{ sort: AchievementSort; ids: number[] } | null>(null);
    const lastGameIdRef = useRef<number | null>(null);
    const listRootRef = useRef<HTMLDivElement | null>(null);
    const MAIN_COLLAPSED_COUNT = 50;
    const currentMode = props.mode ?? "main";
    const metrics = useMemo(() => achievementUiMetrics(props.uiSize), [props.uiSize]);
    const blockPaddingStyle = `${props.blockPadding}px 0`;
    const useLeftStyle = (props.achievementStyle ?? "left") === "left";
    const trackedBarColor = trackedColorHex(props.trackedColor);
    const trackedIdSet = useMemo(() => new Set(props.trackedIds ?? []), [props.trackedIds]);
    const communityPlayerCount = props.payload?.numDistinctPlayersCasual ?? props.payload?.numDistinctPlayers ?? 0;
    const dynamicLoading = props.dynamicLoading ?? true;
    const dynamicInitialRows = Math.max(1, props.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, props.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(1, props.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, props.dynamicSentinelRootMargin ?? 600)}px 0px`;

    const effectiveMainFilter: MainAchievementFilter = props.mainFilter ?? "all";
    const effectiveFriendFilter: FriendAchievementFilter = props.friendFilter ?? "all";
    const effectiveMainSort: AchievementSort = props.mainSort ?? "upNext";
    const effectiveFriendSort: AchievementSort = props.friendSort ?? "upNext";
    const activeSort: AchievementSort = currentMode === "friend" ? effectiveFriendSort : effectiveMainSort;

    const coldScopeKey = [
        props.filterScopeKey,
        props.showAll,
        props.resetToken,
        currentMode,
        effectiveFriendFilter,
        effectiveMainFilter,
        activeSort
    ].join("|");
    if (coldScopeRef.current !== coldScopeKey) {
        coldScopeRef.current = coldScopeKey;
        coldBadgesRef.current.clear();
    }

    const baseAchievements = useMemo(() => {
        const achievements = props.payload?.achievements ?? [];

        if (currentMode === "tracked") {
            return achievements;
        }

        const sorted = [...achievements].sort((a, b) => (a.displayOrder - b.displayOrder) || (a.id - b.id));

        if (activeSort === "absolute") {
            return sorted;
        }

        const metricComparator = metricSortComparator(activeSort);
        if (metricComparator) {
            return sorted.sort(metricComparator);
        }

        const locked: AchievementRow[] = [];
        const earnedRows: AchievementRow[] = [];
        for (const a of sorted) {
            if (earned(a)) {
                earnedRows.push(a);
            }
            else {
                locked.push(a);
            }
        }
        return [...locked, ...earnedRows];
    }, [props.payload, activeSort, currentMode]);

    const filteredAchievements = useMemo(() => {
        if (currentMode === "friend") {
            if (effectiveFriendFilter === "locked") {
                return baseAchievements.filter((achievement) => !earned(achievement));
            }
            if (effectiveFriendFilter === "unlocked-hardcore") {
                return baseAchievements.filter((achievement) => unlockedHardcore(achievement));
            }
            if (effectiveFriendFilter === "unlocked-softcore") {
                return baseAchievements.filter((achievement) => unlockedSoftcore(achievement));
            }
            if (effectiveFriendFilter === "missable") {
                return baseAchievements.filter((achievement) => isMissable(achievement));
            }
            return baseAchievements;
        }
        if (currentMode === "main" || currentMode === "overview") {
            if (effectiveMainFilter === "locked") {
                return baseAchievements.filter((achievement) => !earned(achievement));
            }
            if (effectiveMainFilter === "unlocked-hardcore") {
                return baseAchievements.filter((achievement) => unlockedHardcore(achievement));
            }
            if (effectiveMainFilter === "unlocked-softcore") {
                return baseAchievements.filter((achievement) => unlockedSoftcore(achievement));
            }
            if (effectiveMainFilter === "missable") {
                return baseAchievements.filter((achievement) => isMissable(achievement));
            }
            return baseAchievements;
        }
        return baseAchievements;
    }, [baseAchievements, currentMode, effectiveFriendFilter, effectiveMainFilter]);

    displayOrderRef.current = filteredAchievements;

    useEffect(() => {
        const previous = lastSortedIdsRef.current;
        const ids = filteredAchievements.map((achievement) => achievement.id);
        lastSortedIdsRef.current = { sort: activeSort, ids };

        if (!debugLoggingEnabled() || ids.length === 0) {
            return;
        }
        const earnedRows = filteredAchievements.filter((a) => earned(a)).length;
        const filterName = currentMode === "friend" ? effectiveFriendFilter : effectiveMainFilter;
        const flipped = previous != null && previous.sort !== activeSort && previous.ids.length === ids.length;
        let firstDiff = -1;
        if (flipped && previous) {
            for (let i = 0; i < ids.length; i += 1) {
                if (previous.ids[i] !== ids[i]) {
                    firstDiff = i;
                    break;
                }
            }
        }
        logSortDebug("applied", currentMode,
            `sort=${activeSort} filter=${filterName} shown=${ids.length}`
            + ` locked=${ids.length - earnedRows} earned=${earnedRows}`
            + (flipped && previous
                ? ` from=${previous.sort} firstDiff=${firstDiff < 0 ? "none" : firstDiff}`
                    + ` sameBothWays=${firstDiff < 0 ? "yes" : "no"}`
                : " from=(not a sort flip)"));
    }, [activeSort, currentMode, filteredAchievements, effectiveFriendFilter, effectiveMainFilter]);

    useEffect(() => {
        const nextGameId = props.payload?.gameId ?? null;
        if (lastGameIdRef.current !== nextGameId) {
            lastGameIdRef.current = nextGameId;
            setIconMap({});
            coldBadgesRef.current.clear();
            pumpedBadgesRef.current.clear();
        }
    }, [props.payload?.gameId, currentMode]);

    useEffect(() => {
        const gameId = props.payload?.gameId ?? null;
        if (!props.showIcons || !gameId) {
            return;
        }
        const badgeNames = Array.from(
            new Set(
                [...displayOrderRef.current, ...(props.payload?.achievements ?? [])]
                    .map((achievement) => String(achievement.badgeName || "").trim())
                    .filter(Boolean)
            )
        ).filter((badgeName) => !pumpedBadgesRef.current.has(badgeName));
        if (badgeNames.length === 0) {
            return;
        }

        let cancelled = false;
        let rafId: number | null = null;

        pumpRunsRef.current += 1;
        const pumpRun = pumpRunsRef.current;
        const startedAt = Date.now();
        let pendingVisible: Set<string> | null = null;
        if (debugLoggingEnabled()) {
            const onScreenBadges = new Set(
                displayOrderRef.current
                    .slice(0, dynamicInitialRows)
                    .map((achievement) => String(achievement.badgeName || "").trim())
                    .filter(Boolean)
            );
            let lastVisibleAt = -1;
            for (let i = 0; i < badgeNames.length; i += 1) {
                if (onScreenBadges.has(badgeNames[i])) {
                    lastVisibleAt = i;
                }
            }
            pendingVisible = new Set(badgeNames.filter((badgeName) => onScreenBadges.has(badgeName)));
            logSortDebug("icons", currentMode,
                `sort=${activeSort} run=${pumpRun} queued=${badgeNames.length}`
                + ` alreadyDone=${pumpedBadgesRef.current.size} onScreen=${onScreenBadges.size}`
                + ` waiting=${pendingVisible.size}`
                + ` lastVisibleAt=${lastVisibleAt < 0 ? "none" : lastVisibleAt}`
                + ` frameEst=${lastVisibleAt < 0 ? "-" : Math.ceil((lastVisibleAt + 1) / ICON_STREAM_CHUNK)}`);
        }

        function pumpNextChunk(startIndex: number) {
            if (cancelled) {
                return;
            }
            const endIndex = Math.min(startIndex + ICON_STREAM_CHUNK, badgeNames.length);
            const chunkBadgeNames = badgeNames.slice(startIndex, endIndex);
            const chunkIcons = getCachedAchievementIcons(gameId, chunkBadgeNames);
            for (const badgeName of Object.keys(chunkIcons)) {
                pumpedBadgesRef.current.add(badgeName);
                const warm = new Image();
                warm.src = chunkIcons[badgeName];
                void warm.decode().catch(() => {});
            }
            if (Object.keys(chunkIcons).length > 0) {
                setIconMap((current) => {
                    let filled = false;
                    const next = { ...current };
                    for (const badgeName of Object.keys(chunkIcons)) {
                        if (!next[badgeName]) {
                            next[badgeName] = chunkIcons[badgeName];
                            filled = true;
                        }
                    }
                    return filled ? next : current;
                });
            }
            if (pendingVisible && pendingVisible.size > 0) {
                for (const badgeName of Object.keys(chunkIcons)) {
                    pendingVisible.delete(badgeName);
                }
                if (pendingVisible.size === 0) {
                    logSortDebug("icons-filled", currentMode,
                        `sort=${activeSort} run=${pumpRun}`
                        + ` frame=${Math.ceil(endIndex / ICON_STREAM_CHUNK)}`
                        + ` ms=${Date.now() - startedAt}`);
                }
            }
            if (endIndex < badgeNames.length) {
                rafId = window.requestAnimationFrame(() => pumpNextChunk(endIndex));
            }
        }

        rafId = window.requestAnimationFrame(() => pumpNextChunk(0));

        return () => {
            cancelled = true;
            if (rafId != null) {
                window.cancelAnimationFrame(rafId);
            }
        };
    }, [props.payload?.gameId, props.payload?.achievements, props.showIcons,
        activeSort, currentMode, effectiveMainFilter, effectiveFriendFilter]);

    const shouldLimitMainList = (currentMode === "main" || currentMode === "friend") && !props.showAll;

    const visibleAchievements = useMemo(() => {
        if (!shouldLimitMainList) {
            return filteredAchievements;
        }
        return filteredAchievements.slice(0, Math.min(MAIN_COLLAPSED_COUNT, filteredAchievements.length));
    }, [filteredAchievements, shouldLimitMainList]);

    const rowLabels = useMemo(() => {
        const labels = new Map<number, { communityLabel: string | null; extraLabel: ReactNode }>();
        const showsUnlockStamp = currentMode === "main" || currentMode === "friend" || currentMode === "overview";

        for (const achievement of visibleAchievements) {
            const unlockStamp = showsUnlockStamp && earned(achievement)
                ? unlockDateLabel(achievement, props.language)
                : "";

            labels.set(achievement.id, {
                communityLabel: communityCompletionLabel(achievement, communityPlayerCount, props.language),
                extraLabel: props.getAchievementExtraLabel?.(achievement)
                    ?? (unlockStamp ? <UnlockStamp date={unlockStamp} /> : null)
            });
        }

        return labels;
    }, [visibleAchievements, currentMode, props.language, communityPlayerCount, props.getAchievementExtraLabel]);

    const {
        mountedItems: mountedAchievements,
        markerRef: loadMoreMarkerRef,
        onItemFocus: handleAchievementFocus
    } = useWindowedList({
        items: visibleAchievements,
        dynamicLoading,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: dynamicSentinelRootMargin,
        resetKey: `${props.payload?.gameId}|${props.filterScopeKey}|${props.showAll}|${props.resetToken}|${currentMode}|${effectiveFriendFilter}|${effectiveMainFilter}|${activeSort}`
    });

    const mountedIcons = useMemo(() => {
        const missingBadgeNames: string[] = [];
        for (const achievement of mountedAchievements) {
            const badgeName = String(achievement.badgeName || "").trim();
            if (badgeName && !iconMap[badgeName]) {
                missingBadgeNames.push(badgeName);
            }
        }
        if (missingBadgeNames.length === 0) {
            return iconMap;
        }

        return { ...iconMap, ...getCachedAchievementIcons(props.payload?.gameId ?? null, missingBadgeNames) };
    }, [mountedAchievements, iconMap, props.payload?.gameId]);

    useEffect(function scrollReorderTargetIntoView() {
        if (currentMode !== "tracked") {
            return;
        }
        const targetId = props.reorderTargetId;
        if (targetId == null) {
            return;
        }
        if (props.reorderViaSwap) {
            return;
        }
        const searchRoot = listRootRef.current;
        if (!searchRoot) {
            return;
        }
        const row = searchRoot.querySelector(
            `[data-focus-key="achievement:${targetId}"]`
        ) as HTMLElement | null;
        if (!row) {
            return;
        }
        row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [currentMode, props.reorderTargetId, props.trackedIds, props.reorderViaSwap]);

    useEffect(() => {
        let cancelled = false;
        const gameId = props.payload?.gameId ?? null;
        const badgeNames = Array.from(
            new Set(
                mountedAchievements.map((achievement) => String(achievement.badgeName || "").trim()).filter(Boolean)
            )
        );

        if (!props.showIcons || !gameId || badgeNames.length === 0) {
            return () => {
                cancelled = true;
            };
        }

        const unfilledBadgeNames = badgeNames.filter((badgeName) => !iconMap[badgeName]);
        const alreadyCachedIcons = getCachedAchievementIcons(gameId, unfilledBadgeNames);
        const missingBadgeNames = unfilledBadgeNames.filter((badgeName) => !alreadyCachedIcons[badgeName]);
        if (missingBadgeNames.length === 0) {
            return () => {
                cancelled = true;
            };
        }

        const chunkSize = 24;

        void (async () => {
            try {
                for (let i = 0; i < missingBadgeNames.length; i += chunkSize) {
                    if (cancelled) {
                        return;
                    }
                    const chunk = missingBadgeNames.slice(i, i + chunkSize);
                    const result = await getAchievementIcons(gameId, chunk);
                    if (cancelled) {
                        return;
                    }
                    const icons = result?.icons ?? {};
                    if (Object.keys(icons).length > 0) {
                        cacheAchievementIcons(gameId, icons);
                        for (const badgeName of Object.keys(icons)) {
                            coldBadgesRef.current.add(badgeName);
                        }
                        setIconMap((current) => ({ ...current, ...icons }));
                    }
                }
            } catch (e) {
                logError("achievement icons", e);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [props.payload?.gameId, props.showIcons, mountedAchievements, iconMap]);

    const emptyMessage = props.emptyMessageOverride ??
        (currentMode === "tracked"
            ? t(props.language, "No tracked achievements for this game. Press A on an achievement you'd like to add to this list.")
            : currentMode === "friend" && effectiveFriendFilter === "locked"
                ? t(props.language, "No locked achievements remaining.")
                : currentMode === "friend" && effectiveFriendFilter === "unlocked-hardcore"
                    ? t(props.language, "No hardcore unlocks for this game yet.")
                    : currentMode === "friend" && effectiveFriendFilter === "unlocked-softcore"
                        ? t(props.language, "No softcore unlocks for this game yet.")
                        : currentMode === "friend" && effectiveFriendFilter === "missable"
                            ? t(props.language, "No missable achievements for this game.")
                            : (currentMode === "main" || currentMode === "overview") && effectiveMainFilter === "locked"
                                ? t(props.language, "No locked achievements remaining.")
                                : (currentMode === "main" || currentMode === "overview") && effectiveMainFilter === "unlocked-hardcore"
                                    ? t(props.language, "No hardcore unlocks for this game yet.")
                                    : (currentMode === "main" || currentMode === "overview") && effectiveMainFilter === "unlocked-softcore"
                                        ? t(props.language, "No softcore unlocks for this game yet.")
                                        : (currentMode === "main" || currentMode === "overview") && effectiveMainFilter === "missable"
                                            ? t(props.language, "No missable achievements for this game.")
                                            : t(props.language, "No achievements were returned for this game."));

    const resolvedTitle =
        props.titleOverride ??
        t(props.language, "Achievements ({{earned}}/{{total}})", {
            earned: props.payload.numAwardedToUser,
            total: props.payload.numAchievements
        });
    const panelTitle = resolvedTitle.trim() ? resolvedTitle : undefined;

    function rowNote(achievement: AchievementRow) {
        if (currentMode === "main") {
            if (!props.showTrackedNotesMain || !trackedIdSet.has(achievement.id)) {
                return null;
            }
        }
        else if (currentMode !== "tracked") {
            return null;
        }
        const noteText = props.notesByAchievementId?.[String(achievement.id)];
        if (!noteText) {
            return null;
        }
        const body = parseNoteTag(noteText).body.trim();
        if (!body) {
            return null;
        }
        const colorKey = props.notesColorByAchievementId?.[String(achievement.id)] ?? null;

        return { body, color: noteBodyColor(colorKey) };
    }

    const clickRef = useRef(props.onAchievementClick);
    clickRef.current = props.onAchievementClick;
    const focusRef = useRef(handleAchievementFocus);
    focusRef.current = handleAchievementFocus;

    const trackToggleRef = useRef(props.onAchievementTrackToggle);
    trackToggleRef.current = props.onAchievementTrackToggle;
    const noteRef = useRef(props.onAchievementNote);
    noteRef.current = props.onAchievementNote;
    const reorderPickRef = useRef(props.onAchievementReorderPick);
    reorderPickRef.current = props.onAchievementReorderPick;
    const reorderNudgeRef = useRef(props.onAchievementReorderNudge);
    reorderNudgeRef.current = props.onAchievementReorderNudge;

    const rowList = useMemo<AchievementRowListProps>(() => ({
        metrics,
        language: props.language,
        mode: currentMode,
        showIcons: props.showIcons,
        useLeftStyle,
        blockPaddingStyle,
        trackedBarColor,
        showRetroPoints: Boolean(props.showRetroPoints),
        onAchievementClick: (achievement: AchievementRow) => {
            void clickRef.current?.(achievement);
        },
        onAchievementFocus: (index: number) => {
            focusRef.current(index);
        },
        onAchievementTrackToggle: props.onAchievementTrackToggle
            ? (achievement: AchievementRow) => {
                trackToggleRef.current?.(achievement);
            }
            : undefined,
        onAchievementNote: props.onAchievementNote
            ? (achievement: AchievementRow) => {
                noteRef.current?.(achievement);
            }
            : undefined,
        onAchievementReorderPick: props.onAchievementReorderPick
            ? (achievement: AchievementRow) => {
                reorderPickRef.current?.(achievement);
            }
            : undefined,
        onAchievementReorderNudge: props.onAchievementReorderNudge
            ? (direction: ReorderDirection) => {
                reorderNudgeRef.current?.(direction);
            }
            : undefined
    }), [
        metrics,
        props.language,
        currentMode,
        props.showIcons,
        useLeftStyle,
        blockPaddingStyle,
        trackedBarColor,
        props.showRetroPoints,
        props.onAchievementTrackToggle,
        props.onAchievementNote,
        props.onAchievementReorderPick,
        props.onAchievementReorderNudge
    ]);

    return (
        <PanelSection title={panelTitle}>
            <div ref={listRootRef}>
                <style>{FADE_IN_KEYFRAMES}</style>
                <style>{POINTS_LABEL_STYLES}</style>
                {props.preRows}
                {currentMode === "friend" && !props.showAll && filteredAchievements.length > 50 && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(props.language, "Showing first 50 of {{count}} achievements.", {
                                count: filteredAchievements.length
                            })}
                        </div>
                    </PanelSectionRow>
                )}

                {props.topPadding > 0 && <div style={{ height: `${props.topPadding}px` }} />}

                {filteredAchievements.length === 0 ? (
                    <>
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>{emptyMessage}</div>
                        </PanelSectionRow>
                        {props.emptyFocusAnchorKey && (
                            <BottomFocusAnchor focusKey={props.emptyFocusAnchorKey} />
                        )}
                    </>
                ) : (
                    <>
                        {mountedAchievements.map((achievement, index) => {
                            const badgeName = String(achievement.badgeName || "").trim();
                            const labels = rowLabels.get(achievement.id);
                            const note = rowNote(achievement);
                            const rowKey = currentMode === "tracked" ? index : achievement.id;

                            const row = (
                                <AchievementListRow
                                    key={rowKey}
                                    achievement={achievement}
                                    index={index}
                                    list={rowList}
                                    iconSrc={badgeName ? mountedIcons[badgeName] || "" : ""}
                                    fadeOnLoad={coldBadgesRef.current.has(badgeName)}
                                    isTracked={trackedIdSet.has(achievement.id) && !earned(achievement)}
                                    isReorderTarget={
                                        currentMode === "tracked"
                                        && props.reorderTargetId != null
                                        && props.reorderTargetId === achievement.id
                                    }
                                    communityLabel={labels?.communityLabel ?? null}
                                    extraLabel={labels?.extraLabel ?? null}
                                    noteText={note?.body}
                                    noteColor={note?.color}
                                />
                            );

                            const claimedRow = props.claimedRow;
                            if (claimedRow && claimedRow.slotIndex === index) {
                                return (
                                    <FocusClaim
                                        key={rowKey}
                                        token={claimedRow.token}
                                        armed={claimedRow.armed}
                                        onSpent={claimedRow.onSpent}
                                    >
                                        {row}
                                    </FocusClaim>
                                );
                            }

                            return row;
                        })}
                        {dynamicLoading && mountedAchievements.length < visibleAchievements.length && (
                            <div ref={loadMoreMarkerRef} style={{ height: "1px" }} />
                        )}
                    </>
                )}
            </div>
        </PanelSection>
    );
}
