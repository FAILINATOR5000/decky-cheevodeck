import { useMemo, type ReactNode } from "react";
import { PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../ui/PanelSection";
import { AchievementList, type AchievementListSection } from "../achievements/AchievementList";
import { CollapsibleTitle } from "../ui/CollapsibleTitle";
import { InlineSpinner } from "../ui/InlineSpinner";
import type { FocusClaimController } from "../../hooks/useFocusClaim";
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
    tagMarkedIds?: ReadonlySet<number>;
    reorderViaSwap?: boolean;
    rowClaim?: FocusClaimController;
    openAtKey?: string;
    onOpenAtHeld?: () => void;
    collapsedKeys: ReadonlySet<string>;
    onToggleCollapsed: (key: string) => void;
    collapseDisabled?: boolean;
    headerStyle: HeaderStyle;
    onAchievementClick: (achievement: AchievementRow, trackedAchievements: AchievementRow[]) => void | Promise<void>;
    onAchievementTrackToggle?: (achievement: AchievementRow) => void;
    onAchievementNote?: (achievement: AchievementRow) => void;
    onAchievementReorderPick?: (achievement: AchievementRow) => void;
    onAchievementTagMark?: (achievement: AchievementRow) => void;
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
        tagMarkedIds,
        reorderViaSwap,
        rowClaim,
        openAtKey,
        onOpenAtHeld,
        collapsedKeys,
        onToggleCollapsed,
        collapseDisabled,
        headerStyle,
        onAchievementClick,
        onAchievementTrackToggle,
        onAchievementNote,
        onAchievementReorderPick,
        onAchievementTagMark,
        onAchievementReorderToward,
        emptyMessage
    } = props;

    const groups = useMemo(
        () => visualTrackedGroups(trackedAchievements, notesByAchievementId, language),
        [trackedAchievements, notesByAchievementId, language]
    );

    const sections = useMemo<AchievementListSection[]>(() => groups.map((group) => {
        const collapseKey = collapseKeyForGroup(group);
        return {
            key: collapseKey,
            focusKey: `tracked:group:${collapseKey}`,
            achievements: group.achievements,
            collapsed: collapsedKeys.has(collapseKey)
        };
    }), [groups, collapsedKeys]);

    const listPayload = useMemo(() => {
        const achievements = groups.flatMap((group) => group.achievements);
        return {
            ...payload,
            achievements,
            numAchievements: achievements.length,
            numAwardedToUser: 0,
            numAwardedToUserHardcore: 0
        };
    }, [payload, groups]);

    if (!trackedReady) {
        return (
            <PanelSection title={t(language, "Tracked")}>
                <PanelSectionRow>
                    <InlineSpinner label={t(language, "Validating tracked achievements...")} />
                </PanelSectionRow>
            </PanelSection>
        );
    }

    const claimedSlot = rowClaim?.claim ?? null;
    const claimSpend = rowClaim?.spend;
    const claimedEntry = claimedSlot ? entryIndexForRowSlot(sections, claimedSlot.slotIndex) : -1;
    const claimedRow = claimedSlot && claimSpend && claimedEntry >= 0
        ? {
            slotIndex: claimedEntry,
            token: claimedSlot.token,
            armed: claimedSlot.armed,
            onSpent: claimSpend
        }
        : undefined;

    return (
        <AchievementList
            key={`tracked:${payload.gameId ?? "none"}`}
            language={language}
            payload={listPayload}
            showIcons={showIcons}
            achievementStyle={achievementStyle}
            uiSize={uiSize}
            topPadding={topPadding}
            blockPadding={blockPadding}
            showAll={true}
            mode="tracked"
            windowId="tracked:rows"
            trackedIds={trackedIds}
            notesByAchievementId={notesByAchievementId}
            notesColorByAchievementId={notesColorByAchievementId}
            titleOverride={groups.length === 0 ? title : ""}
            sections={sections}
            renderSectionHeader={(section, row) => {
                const group = groups.find((candidate) => collapseKeyForGroup(candidate) === section.key);
                const label = !group || group.tagKey === null
                    ? t(language, "Tracked ({{count}})", { count: section.achievements.length })
                    : `${group.tag} (${section.achievements.length})`;
                return (
                    <CollapsibleTitle
                        label={label}
                        collapsed={section.collapsed}
                        focusKey={section.focusKey}
                        disabled={collapseDisabled}
                        preserveCase={headerStyle === "typed"}
                        onToggle={() => onToggleCollapsed(section.key)}
                        onGamepadFocus={row.onGamepadFocus}
                        onGamepadDirection={row.onGamepadDirection}
                    />
                );
            }}
            dynamicLoading={dynamicLoading}
            dynamicInitialRows={dynamicInitialRows}
            dynamicRowStep={dynamicRowStep}
            dynamicPrefetchDistance={dynamicPrefetchDistance}
            dynamicSentinelRootMargin={dynamicSentinelRootMargin}
            showRetroPoints={showRetroPoints}
            emptyMessageOverride={emptyMessage}
            emptyFocusAnchorKey="tracked:empty-anchor"
            reorderTargetId={reorderTargetId}
            tagMarkedIds={tagMarkedIds}
            reorderViaSwap={reorderViaSwap}
            openAtKey={openAtKey}
            onOpenAtHeld={onOpenAtHeld}
            claimedRow={claimedRow}
            onAchievementClick={async (achievement) => {
                if (trackedValidating || busy) {
                    return;
                }
                await onAchievementClick(achievement, trackedAchievements);
            }}
            onAchievementTrackToggle={onAchievementTrackToggle}
            onAchievementNote={onAchievementNote}
            onAchievementReorderPick={onAchievementReorderPick}
            onAchievementTagMark={onAchievementTagMark}
            onAchievementReorderToward={onAchievementReorderToward}
        />
    );
}

function entryIndexForRowSlot(sections: AchievementListSection[], rowSlot: number): number {
    let entry = 0;
    let rows = 0;
    for (const section of sections) {
        entry += 1;
        if (section.collapsed) {
            continue;
        }
        const size = section.achievements.length;
        if (rowSlot < rows + size) {
            return entry + (rowSlot - rows);
        }
        entry += size;
        rows += size;
    }
    return -1;
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
    landingId: number | null;
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
        return { landingId: null, focusKey: "tracked:back", claimSlot: null, claimBack: true };
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
        landingId: remaining[landingIndex].id,
        focusKey: `achievement:${remaining[landingIndex].id}`,
        claimSlot: removedSlot !== null && removedSlot.indexInGroup === removedSlot.groupSize - 1
            ? landingIndex
            : null,
        claimBack: false
    };
}

export function trackedRetagLanding(
    trackedAchievements: AchievementRow[],
    notesByAchievementId: TrackedNotes,
    language: LanguageCode,
    collapsedKeys: ReadonlySet<string>,
    achievementId: number,
    nextNote: string
): number | null {
    const previousNote = notesByAchievementId[String(achievementId)] ?? "";
    if (parseNoteTag(previousNote).tagKey === parseNoteTag(nextNote).tagKey) {
        return null;
    }
    return trackedRemovalLanding(
        trackedAchievements,
        notesByAchievementId,
        language,
        collapsedKeys,
        achievementId
    ).landingId;
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
