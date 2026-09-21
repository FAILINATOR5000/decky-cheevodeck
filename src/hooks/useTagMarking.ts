import { useCallback, useEffect, useMemo, useState } from "react";
import {
    bulkTagTracked,
    cacheTrackedNotes,
    cacheTrackedNotesColor,
    getRecentTagsForGame
} from "../api";
import { logFocusDebug } from "../api";
import { logError } from "../utils/errors";
import type { AchievementRow, TrackedNotes, TrackedNotesColor } from "../types";

type UseTagMarkingArgs = {
    selectedGameId: number | null;
    trackedIds: number[];
    notesByAchievementId: TrackedNotes;
    isActive: boolean;
    mountedRef: { current: boolean };
    setNotesByAchievementId: (notes: TrackedNotes) => void;
    setNotesColorByAchievementId: (notesColor: TrackedNotesColor) => void;
    setCollapsedTags: (tags: string[]) => void;
};

export function useTagMarking({
    selectedGameId,
    trackedIds,
    notesByAchievementId,
    isActive,
    mountedRef,
    setNotesByAchievementId,
    setNotesColorByAchievementId,
    setCollapsedTags
}: UseTagMarkingArgs) {
    const [tagMarkedIds, setTagMarkedIds] = useState<ReadonlySet<number>>(() => new Set<number>());
    const [lastTag, setLastTag] = useState<string | null>(null);
    const [applyingTag, setApplyingTag] = useState(false);

    useEffect(() => {
        if (!isActive || selectedGameId === null) {
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const result = await getRecentTagsForGame(selectedGameId);
                if (cancelled || !mountedRef.current) {
                    return;
                }
                const tags = result?.recentTags ?? [];
                const vocabulary = result?.tagVocabulary ?? [];
                const next = tags.length > 0
                    ? tags[0]
                    : vocabulary.length > 0 ? vocabulary[0] : null;
                logFocusDebug(
                    "tag-mark",
                    `game:${selectedGameId}`,
                    `lastTag=${next ?? "(none)"} vocab=${vocabulary.length} recent=${tags.length}`
                );
                setLastTag(next);
            } catch (e) {
                logError("getRecentTagsForGame (tag marking)", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isActive, selectedGameId, mountedRef, notesByAchievementId]);

    useEffect(() => {
        if (isActive) {
            return;
        }
        setTagMarkedIds((current) => (current.size > 0 ? new Set<number>() : current));
    }, [isActive]);

    useEffect(() => {
        setTagMarkedIds((current) => (current.size > 0 ? new Set<number>() : current));
    }, [selectedGameId]);

    useEffect(() => {
        setTagMarkedIds((current) => {
            if (current.size === 0) {
                return current;
            }
            const live = new Set(trackedIds);
            const next = new Set<number>();
            for (const id of current) {
                if (live.has(id)) {
                    next.add(id);
                }
            }
            return next.size === current.size ? current : next;
        });
    }, [trackedIds]);

    const onToggleTagMark = useCallback((achievement: AchievementRow) => {
        setTagMarkedIds((current) => {
            const next = new Set(current);
            if (next.has(achievement.id)) {
                next.delete(achievement.id);
            } else {
                next.add(achievement.id);
            }
            return next;
        });
    }, []);

    const clearTagMarks = useCallback(() => {
        setTagMarkedIds((current) => (current.size > 0 ? new Set<number>() : current));
    }, []);

    const onApplyMarkedTag = useCallback(async () => {
        if (selectedGameId === null || applyingTag) {
            return;
        }
        const ids = Array.from(tagMarkedIds);
        const tag = (lastTag ?? "").trim();
        if (ids.length === 0 || !tag) {
            return;
        }

        setApplyingTag(true);
        try {
            const result = await bulkTagTracked(selectedGameId, ids, tag);
            if (!mountedRef.current) {
                return;
            }
            if (!result?.ok) {
                return;
            }
            const nextNotes = result.notes ?? {};
            const nextNotesColor = result.notesColor ?? {};
            cacheTrackedNotes(selectedGameId, nextNotes);
            cacheTrackedNotesColor(selectedGameId, nextNotesColor);
            setNotesByAchievementId(nextNotes);
            setNotesColorByAchievementId(nextNotesColor);
            if (Array.isArray(result.collapsedTags)) {
                setCollapsedTags(result.collapsedTags);
            }
            setTagMarkedIds(new Set<number>());
        } catch (e) {
            logError("bulkTagTracked", e);
        } finally {
            if (mountedRef.current) {
                setApplyingTag(false);
            }
        }
    }, [
        selectedGameId,
        applyingTag,
        tagMarkedIds,
        lastTag,
        mountedRef,
        setNotesByAchievementId,
        setNotesColorByAchievementId,
        setCollapsedTags
    ]);

    const tagMarkCount = tagMarkedIds.size;
    const canApplyTag = useMemo(
        () => tagMarkCount > 0 && Boolean((lastTag ?? "").trim()) && !applyingTag,
        [tagMarkCount, lastTag, applyingTag]
    );

    return {
        tagMarkedIds,
        tagMarkCount,
        lastTag,
        applyingTag,
        canApplyTag,
        onToggleTagMark,
        clearTagMarks,
        onApplyMarkedTag
    };
}
