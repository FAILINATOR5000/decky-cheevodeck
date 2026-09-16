import { useMemo, type ReactNode } from "react";
import { PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../ui/PanelSection";
import { AchievementList } from "../achievements/AchievementList";
import { CollapsibleTitle } from "../ui/CollapsibleTitle";
import { InlineSpinner } from "../ui/InlineSpinner";
import type { FocusClaimController } from "../../hooks/useFocusClaim";
import { useWindowedList } from "../../hooks/useWindowedList";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import type {
    AchievementRow,
    HeaderStyle,
    AchievementStyle,
    Payload,
    TrackedNotes,
    TrackedNotesColor,
    UiSize
} from "../../types";
import { parseNoteTag } from "../../utils/achievements";

type TrackedListBodyProps = {
    language: LanguageCode;
    payload: Payload;
    trackedReady: boolean;
    trackedAchievements: AchievementRow[];
    trackedIds: number[];
    notesByAchievementId: TrackedNotes;
    notesColorByAchievementId: TrackedNotesColor;
    showIcons: boolean;
    achievementStyle: AchievementStyle;
    uiSize: UiSize;
    topPadding: number;
    blockPadding: number;
    listResetToken: number;
    focusScopeResetToken: number;
    title: string;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    trackedValidating: boolean;
    busy: boolean;
    showRetroPoints: boolean;
    reorderTargetId?: number | null;
    reorderViaSwap?: boolean;
    rowClaim?: FocusClaimController;
    restoreSeedAchievementId?: number | null;
    collapsedKeys: ReadonlySet<string>;
    onToggleCollapsed: (key: string) => void;
    collapseDisabled?: boolean;
    headerStyle: HeaderStyle;
    onAchievementClick: (achievement: AchievementRow, trackedAchievements: AchievementRow[]) => void | Promise<void>;
    onAchievementTrackToggle?: (achievement: AchievementRow) => void;
    onAchievementNote?: (achievement: AchievementRow) => void;
    onAchievementReorderPick?: (achievement: AchievementRow) => void;
    onAchievementReorderToward?: (landedAchievementId: number) => void;
    emptyMessage: ReactNode;
};

type TrackedGroup = {
    tag: string | null;
    tagKey: string | null;
    achievementIds: number[];
    achievements: AchievementRow[];
};

function groupTrackedAchievements(
    achievements: AchievementRow[],
    notesByAchievementId: TrackedNotes
): TrackedGroup[] {
    const byKey = new Map<string, TrackedGroup>();
    const untagged: TrackedGroup = {
        tag: null,
        tagKey: null,
        achievementIds: [],
        achievements: []
    };

    for (const achievement of achievements) {
        const note = notesByAchievementId[String(achievement.id)] ?? "";
        const parsed = parseNoteTag(note);
        if (parsed.tagKey === null) {
            untagged.achievementIds.push(achievement.id);
            untagged.achievements.push(achievement);
            continue;
        }
        let group = byKey.get(parsed.tagKey);
        if (!group) {
            group = {
                tag: parsed.tag,
                tagKey: parsed.tagKey,
                achievementIds: [],
                achievements: []
            };
            byKey.set(parsed.tagKey, group);
        }
        group.achievementIds.push(achievement.id);
        group.achievements.push(achievement);
    }

    const ordered: TrackedGroup[] = Array.from(byKey.values());
    if (untagged.achievementIds.length > 0) {
        ordered.push(untagged);
    }
    return ordered;
}

export const TRACKED_UNTAGGED_COLLAPSE_KEY = "__UNTAGGED__";

function collapseKeyForGroup(group: TrackedGroup): string {
    return group.tagKey ?? TRACKED_UNTAGGED_COLLAPSE_KEY;
}

function visualTrackedGroups(
    achievements: AchievementRow[],
    notesByAchievementId: TrackedNotes,
    language: LanguageCode
): TrackedGroup[] {
    const groups = groupTrackedAchievements(achievements, notesByAchievementId);
    const tagged = groups.filter((group) => group.tagKey !== null);
    const untagged = groups.filter((group) => group.tagKey === null);
    tagged.sort((a, b) => (a.tag ?? "").localeCompare(b.tag ?? "", language, { numeric: true }));
    return [...tagged, ...untagged];
}

export function TrackedListBody(props: TrackedListBodyProps) {
    const {
        language,
        payload,
        trackedReady,
        trackedAchievements,
        trackedIds,
        notesByAchievementId,
        notesColorByAchievementId,
        showIcons,
        achievementStyle,
        uiSize,
        topPadding,
        blockPadding,
        listResetToken,
        focusScopeResetToken,
        title,
        dynamicLoading,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        trackedValidating,
        busy,
        showRetroPoints,
        reorderTargetId,
        reorderViaSwap,
        rowClaim,
        restoreSeedAchievementId,
        collapsedKeys,
        onToggleCollapsed,
        collapseDisabled,
        headerStyle,
        onAchievementClick,
        onAchievementTrackToggle,
        onAchievementNote,
        onAchievementReorderPick,
        onAchievementReorderToward,
        emptyMessage
    } = props;

    const groups = useMemo(
        () => visualTrackedGroups(trackedAchievements, notesByAchievementId, language),
        [trackedAchievements, notesByAchievementId, language]
    );

    const flatRows = useMemo(() => {
        const rows: AchievementRow[] = [];
        for (const group of groups) {
            if (collapsedKeys.has(collapseKeyForGroup(group))) {
                continue;
            }
            for (const achievement of group.achievements) {
                rows.push(achievement);
            }
        }
        return rows;
    }, [groups, collapsedKeys]);

    const seedIndex = restoreSeedAchievementId == null
        ? -1
        : flatRows.findIndex((row) => row.id === restoreSeedAchievementId);

    const {
        mountedItems: mountedRows,
        markerRef: loadMoreMarkerRef,
        onItemFocus
    } = useWindowedList({
        items: flatRows,
        dynamicLoading,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: `${Math.max(0, dynamicSentinelRootMargin)}px 0px`,
        resetKey: `tracked:${payload.gameId ?? "none"}:${listResetToken}:${focusScopeResetToken}`,
        seedRows: seedIndex < 0 ? 0 : seedIndex + 1,
        debugLabel: "tracked:flat"
    });
    const mountedCount = mountedRows.length;

    if (!trackedReady) {
        return (
            <PanelSection title={t(language, "Tracked")}>
                <PanelSectionRow>
                    <InlineSpinner label={t(language, "Validating tracked achievements...")} />
                </PanelSectionRow>
            </PanelSection>
        );
    }

    if (groups.length === 0) {
        return (
            <AchievementList
                key={`tracked:${payload.gameId ?? "none"}:empty:${listResetToken}:${focusScopeResetToken}`}
                language={language}
                payload={{
                    ...payload,
                    achievements: [],
                    numAchievements: 0,
                    numAwardedToUser: 0,
                    numAwardedToUserHardcore: 0
                }}
                showIcons={showIcons}
                achievementStyle={achievementStyle}
                uiSize={uiSize}
                topPadding={topPadding}
                blockPadding={blockPadding}
                showAll={true}
                mode="tracked"
                trackedIds={trackedIds}
                notesByAchievementId={notesByAchievementId}
                notesColorByAchievementId={notesColorByAchievementId}
                titleOverride={title}
                resetToken={listResetToken}
                dynamicLoading={dynamicLoading}
                dynamicInitialRows={dynamicInitialRows}
                dynamicRowStep={dynamicRowStep}
                dynamicPrefetchDistance={dynamicPrefetchDistance}
                dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                showRetroPoints={showRetroPoints}
                emptyMessageOverride={emptyMessage}
                emptyFocusAnchorKey="tracked:empty-anchor"
                reorderTargetId={reorderTargetId}
                reorderViaSwap={reorderViaSwap}
                onAchievementClick={async (achievement) => {
                    if (trackedValidating || busy) {
                        return;
                    }
                    await onAchievementClick(achievement, trackedAchievements);
                }}
                onAchievementTrackToggle={onAchievementTrackToggle}
                onAchievementNote={onAchievementNote}
                onAchievementReorderPick={onAchievementReorderPick}
                onAchievementReorderToward={onAchievementReorderToward}
            />
        );
    }

    const claimedSlot = rowClaim?.claim ?? null;
    const claimSpend = rowClaim?.spend;
    let flatStart = 0;
    const groupSlices = groups.map((group) => {
        const collapsed = collapsedKeys.has(collapseKeyForGroup(group));
        const start = flatStart;
        if (!collapsed) {
            flatStart += group.achievements.length;
        }
        const reach = collapsed
            ? 0
            : Math.max(0, Math.min(group.achievements.length, mountedCount - start));
        return { start, collapsed, reach };
    });

    return (
        <>
            {groups.map((group, index) => {
                const sectionTitle = group.tagKey === null
                    ? t(language, "Tracked ({{count}})", { count: group.achievements.length })
                    : `${group.tag} (${group.achievements.length})`;
                const groupKey = group.tagKey === null ? "_untagged_" : group.tagKey;
                const listKey = `tracked:${payload.gameId ?? "none"}:${groupKey}:${listResetToken}:${focusScopeResetToken}`;
                const collapseKey = collapseKeyForGroup(group);
                const slice = groupSlices[index];
                const collapsed = slice.collapsed;
                const slotInGroup = claimedSlot ? claimedSlot.slotIndex - slice.start : -1;
                const claimedRow = claimedSlot && claimSpend && slotInGroup >= 0 && slotInGroup < slice.reach
                    ? {
                        slotIndex: slotInGroup,
                        token: claimedSlot.token,
                        armed: claimedSlot.armed,
                        onSpent: claimSpend
                    }
                    : undefined;
                return (
                    <AchievementList
                        key={listKey}
                        language={language}
                        payload={{
                            ...payload,
                            achievements: group.achievements,
                            numAchievements: group.achievements.length,
                            numAwardedToUser: 0,
                            numAwardedToUserHardcore: 0
                        }}
                        showIcons={showIcons}
                        achievementStyle={achievementStyle}
                        uiSize={uiSize}
                        topPadding={index === 0 ? topPadding : 0}
                        blockPadding={blockPadding}
                        showAll={true}
                        mode="tracked"
                        trackedIds={trackedIds}
                        notesByAchievementId={notesByAchievementId}
                        notesColorByAchievementId={notesColorByAchievementId}
                        titleOverride={sectionTitle}
                        titleNode={
                            <CollapsibleTitle
                                label={sectionTitle}
                                collapsed={collapsed}
                                focusKey={`tracked:group:${collapseKey}`}
                                disabled={collapseDisabled}
                                preserveCase={headerStyle === "typed"}
                                onToggle={() => onToggleCollapsed(collapseKey)}
                            />
                        }
                        collapsed={collapsed}
                        resetToken={listResetToken}
                        dynamicLoading={false}
                        dynamicInitialRows={dynamicInitialRows}
                        dynamicRowStep={dynamicRowStep}
                        dynamicPrefetchDistance={dynamicPrefetchDistance}
                        dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                        showRetroPoints={showRetroPoints}
                        reorderTargetId={reorderTargetId}
                        reorderViaSwap={reorderViaSwap}
                        claimedRow={claimedRow}
                        mountedRowCount={slice.reach}
                        onRowFocus={(rowIndex) => onItemFocus(slice.start + rowIndex)}
                        onAchievementClick={async (achievement) => {
                            if (trackedValidating || busy) {
                                return;
                            }
                            await onAchievementClick(achievement, trackedAchievements);
                        }}
                        onAchievementTrackToggle={onAchievementTrackToggle}
                        onAchievementNote={onAchievementNote}
                        onAchievementReorderPick={onAchievementReorderPick}
                        onAchievementReorderToward={onAchievementReorderToward}
                    />
                );
            })}
            {dynamicLoading && mountedCount < flatRows.length && (
                <div ref={loadMoreMarkerRef} style={{ height: "1px" }} />
            )}
        </>
    );
}

export function flattenTrackedVisualOrder(
    trackedAchievements: AchievementRow[],
    notesByAchievementId: TrackedNotes,
    language: LanguageCode,
    collapsedKeys: ReadonlySet<string>
): AchievementRow[] {
    const groups = visualTrackedGroups(trackedAchievements, notesByAchievementId, language);
    const ordered: AchievementRow[] = [];
    for (const group of groups) {
        if (collapsedKeys.has(collapseKeyForGroup(group))) {
            continue;
        }
        for (const achievement of group.achievements) {
            ordered.push(achievement);
        }
    }
    return ordered;
}

export function trackedCollapseKeyForAchievement(
    trackedAchievements: AchievementRow[],
    notesByAchievementId: TrackedNotes,
    achievementId: number
): string | null {
    const groups = groupTrackedAchievements(trackedAchievements, notesByAchievementId);
    const match = groups.find((group) => group.achievementIds.includes(achievementId));
    return match ? collapseKeyForGroup(match) : null;
}

export type TrackedRemovalLanding = {
    focusKey: string;
    claimSlot: number | null;
    claimBack: boolean;
};

export function trackedRemovalLanding(
    trackedAchievements: AchievementRow[],
    notesByAchievementId: TrackedNotes,
    language: LanguageCode,
    collapsedKeys: ReadonlySet<string>,
    removedAchievementId: number
): TrackedRemovalLanding {
    const visualOrder = flattenTrackedVisualOrder(
        trackedAchievements,
        notesByAchievementId,
        language,
        collapsedKeys
    );
    const removedIndex = visualOrder.findIndex((row) => row.id === removedAchievementId);
    const remaining = visualOrder.filter((row) => row.id !== removedAchievementId);

    if (remaining.length <= 0) {
        return { focusKey: "tracked:back", claimSlot: null, claimBack: true };
    }

    const safeIndex = removedIndex >= 0 ? Math.min(removedIndex, remaining.length - 1) : 0;
    const removedSlot = trackedRowGroupSlot(
        trackedAchievements,
        notesByAchievementId,
        removedAchievementId
    );
    const removedGroupKey = trackedCollapseKeyForAchievement(
        trackedAchievements,
        notesByAchievementId,
        removedAchievementId
    );

    const wouldLeaveTheGroup = safeIndex > 0
        && removedSlot !== null
        && removedSlot.groupSize > 1
        && remaining[safeIndex] !== undefined
        && trackedCollapseKeyForAchievement(
            trackedAchievements,
            notesByAchievementId,
            remaining[safeIndex].id
        ) !== removedGroupKey;
    const landingIndex = wouldLeaveTheGroup ? safeIndex - 1 : safeIndex;

    return {
        focusKey: `achievement:${remaining[landingIndex].id}`,
        claimSlot: removedSlot !== null && removedSlot.indexInGroup === removedSlot.groupSize - 1
            ? landingIndex
            : null,
        claimBack: false
    };
}

export function trackedRowGroupSlot(
    trackedAchievements: AchievementRow[],
    notesByAchievementId: TrackedNotes,
    achievementId: number
): { indexInGroup: number; groupSize: number } | null {
    const groups = groupTrackedAchievements(trackedAchievements, notesByAchievementId);
    for (const group of groups) {
        const indexInGroup = group.achievementIds.indexOf(achievementId);
        if (indexInGroup >= 0) {
            return { indexInGroup, groupSize: group.achievementIds.length };
        }
    }
    return null;
}

export function largestTrackedGroupSize(
    trackedAchievements: AchievementRow[],
    notesByAchievementId: TrackedNotes
): number {
    const groups = groupTrackedAchievements(trackedAchievements, notesByAchievementId);
    let largest = 0;
    for (const group of groups) {
        if (group.achievements.length > largest) {
            largest = group.achievements.length;
        }
    }
    return largest;
}

export function groupIdsForTrackedTarget(
    trackedAchievements: AchievementRow[],
    notesByAchievementId: TrackedNotes,
    targetId: number | null
): number[] | null {
    if (targetId === null) {
        return null;
    }
    const groups = groupTrackedAchievements(trackedAchievements, notesByAchievementId);
    const match = groups.find((group) => group.achievementIds.includes(targetId));
    return match ? match.achievementIds : null;
}
