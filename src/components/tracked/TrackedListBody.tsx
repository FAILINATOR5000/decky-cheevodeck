import { useMemo, type ReactNode } from "react";
import { PanelSection, PanelSectionRow } from "@decky/ui";
import { AchievementList } from "../achievements/AchievementList";
import { InlineSpinner } from "../ui/InlineSpinner";
import type { FocusClaimController } from "../../hooks/useFocusClaim";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import type {
    AchievementRow,
    AchievementStyle,
    Payload,
    ReorderDirection,
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
    onAchievementClick: (achievement: AchievementRow, trackedAchievements: AchievementRow[]) => void | Promise<void>;
    onAchievementTrackToggle?: (achievement: AchievementRow) => void;
    onAchievementNote?: (achievement: AchievementRow) => void;
    onAchievementReorderPick?: (achievement: AchievementRow) => void;
    onAchievementReorderNudge?: (direction: ReorderDirection) => void;
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
        onAchievementClick,
        onAchievementTrackToggle,
        onAchievementNote,
        onAchievementReorderPick,
        onAchievementReorderNudge,
        emptyMessage
    } = props;

    const groups = useMemo(
        () => groupTrackedAchievements(trackedAchievements, notesByAchievementId),
        [trackedAchievements, notesByAchievementId]
    );

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
                onAchievementReorderNudge={onAchievementReorderNudge}
            />
        );
    }

    const claimedSlot = rowClaim?.claim ?? null;
    const claimSpend = rowClaim?.spend;
    let flatStart = 0;
    const groupStarts = groups.map((group) => {
        const start = flatStart;
        flatStart += group.achievements.length;
        return start;
    });

    return (
        <>
            {groups.map((group, index) => {
                const sectionTitle = group.tagKey === null
                    ? t(language, "Tracked ({{count}})", { count: group.achievements.length })
                    : `${group.tag} (${group.achievements.length})`;
                const groupKey = group.tagKey === null ? "_untagged_" : group.tagKey;
                const listKey = `tracked:${payload.gameId ?? "none"}:${groupKey}:${listResetToken}:${focusScopeResetToken}`;
                const slotInGroup = claimedSlot ? claimedSlot.slotIndex - groupStarts[index] : -1;
                const claimedRow = claimedSlot && claimSpend && slotInGroup >= 0 && slotInGroup < group.achievements.length
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
                        resetToken={listResetToken}
                        dynamicLoading={dynamicLoading}
                        dynamicInitialRows={dynamicInitialRows}
                        dynamicRowStep={dynamicRowStep}
                        dynamicPrefetchDistance={dynamicPrefetchDistance}
                        dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                        showRetroPoints={showRetroPoints}
                        reorderTargetId={reorderTargetId}
                        reorderViaSwap={reorderViaSwap}
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
                        onAchievementReorderNudge={onAchievementReorderNudge}
                    />
                );
            })}
        </>
    );
}

export function flattenTrackedVisualOrder(
    trackedAchievements: AchievementRow[],
    notesByAchievementId: TrackedNotes
): AchievementRow[] {
    const groups = groupTrackedAchievements(trackedAchievements, notesByAchievementId);
    const ordered: AchievementRow[] = [];
    for (const group of groups) {
        for (const achievement of group.achievements) {
            ordered.push(achievement);
        }
    }
    return ordered;
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
