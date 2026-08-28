import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
    cacheTrackedCount,
    cacheTrackedIds,
    cacheTrackedNotes,
    cacheTrackedNotesColor,
    saveMainAchievementAction,
    saveMainAchievementFilter,
    saveMainAchievementSort,
    saveShowAllAchievements,
    toggleTrackedAchievement
} from "../api";
import type { AchievementRow, AchievementSort, AOSource, MainAchievementAction, MainAchievementFilter, Payload, TrackedNotes, TrackedNotesColor } from "../types";
import { earned, isMissable, unlockedHardcore, unlockedSoftcore } from "../utils/achievements"
import { logError } from "../utils/errors";
import { raAchievementUrl } from "../utils/navigation";

type SaveSettingWithRollback = <T>(options: {
    nextValue: T;
    previousValue: T;
    applyValue: (value: T) => void;
    saveCall: (value: T) => Promise<any>;
    getSavedValue?: (result: any, nextValue: T) => T;
    onSaved?: (result: any, nextValue: T) => Promise<void> | void;
}) => Promise<void>;

type UseAchievementsControllerArgs = {
    payload: Payload | null;
    showAButtonMode: boolean;
    showAllAchievements: boolean;
    mainAchievementFilter: MainAchievementFilter;
    mainAchievementSort: AchievementSort;
    mainAchievementAction: MainAchievementAction;
    mouseKeyboardMode: boolean;
    mountedRef: RefObject<boolean>;
    saveSettingWithRollback: SaveSettingWithRollback;
    setShowAllAchievements: Dispatch<SetStateAction<boolean>>;
    setMainAchievementFilter: Dispatch<SetStateAction<MainAchievementFilter>>;
    setMainAchievementSort: Dispatch<SetStateAction<AchievementSort>>;
    setMainAchievementAction: Dispatch<SetStateAction<MainAchievementAction>>;
    setTrackedIds: Dispatch<SetStateAction<number[]>>;
    setLastKnownTrackedCount: Dispatch<SetStateAction<number | null>>;
    setNotesByAchievementId: Dispatch<SetStateAction<TrackedNotes>>;
    setNotesColorByAchievementId: Dispatch<SetStateAction<TrackedNotesColor>>;
    setError: Dispatch<SetStateAction<string | null>>;
    openExternalUrl: (url: string) => Promise<boolean>;
    legacyAchievementLinks: boolean;
    goToAchievementOverviewRef: RefObject<
        ((achievement: AchievementRow, parentGameId: number | null, source: AOSource, viewedUsername: string | null, viewedUserRef: string | null) => void) | null
    >;
    goToFriends: () => void | Promise<void>;
    goToLeaderboards: () => void | Promise<void>;
    goToOptions: () => void | Promise<void>;
    goToTracked: () => void | Promise<void>;
};

export function useAchievementsController({
    payload,
    showAButtonMode,
    showAllAchievements,
    mainAchievementFilter,
    mainAchievementSort,
    mainAchievementAction,
    mouseKeyboardMode,
    mountedRef,
    saveSettingWithRollback,
    setShowAllAchievements,
    setMainAchievementFilter,
    setMainAchievementSort,
    setMainAchievementAction,
    setTrackedIds,
    setLastKnownTrackedCount,
    setNotesByAchievementId,
    setNotesColorByAchievementId,
    setError,
    openExternalUrl,
    legacyAchievementLinks,
    goToAchievementOverviewRef,
    goToFriends,
    goToLeaderboards,
    goToOptions,
    goToTracked
}: UseAchievementsControllerArgs) {
    const effectiveMainAchievementAction: MainAchievementAction = mouseKeyboardMode
        ? (showAButtonMode ? mainAchievementAction : "track")
        : "info";

    const mainFilteredAchievementCount = useMemo(() => {
        if (!payload) {
            return 0;
        }

        if (mainAchievementFilter === "locked") {
            return payload.achievements.filter((achievement) => !earned(achievement)).length;
        }
        if (mainAchievementFilter === "unlocked-hardcore") {
            return payload.achievements.filter((achievement) => unlockedHardcore(achievement)).length;
        }
        if (mainAchievementFilter === "unlocked-softcore") {
            return payload.achievements.filter((achievement) => unlockedSoftcore(achievement)).length;
        }
        if (mainAchievementFilter === "missable") {
            return payload.achievements.filter((achievement) => isMissable(achievement)).length;
        }
        return payload.achievements.length;
    }, [mainAchievementFilter, payload]);

    const onShowAllChange = async (nextValue: boolean) => {
        await saveSettingWithRollback<boolean>({
            nextValue,
            previousValue: showAllAchievements,
            applyValue: setShowAllAchievements,
            saveCall: saveShowAllAchievements,
            getSavedValue: (result, fallbackValue) => Boolean(result.showAllAchievements ?? fallbackValue),
        });
    };

    const onMainAchievementFilterChange = async (nextValue: MainAchievementFilter) => {
        await saveSettingWithRollback<MainAchievementFilter>({
            nextValue,
            previousValue: mainAchievementFilter,
            applyValue: setMainAchievementFilter,
            saveCall: saveMainAchievementFilter,
            getSavedValue: (result, fallbackValue) => result.mainAchievementFilter ?? fallbackValue,
        });
    };

    const onMainAchievementSortChange = async (nextValue: AchievementSort) => {
        await saveSettingWithRollback<AchievementSort>({
            nextValue,
            previousValue: mainAchievementSort,
            applyValue: setMainAchievementSort,
            saveCall: saveMainAchievementSort,
            getSavedValue: (result, fallbackValue) => result.mainAchievementSort ?? fallbackValue,
        });
    };

    const onMainAchievementActionChange = async (nextValue: MainAchievementAction) => {
        await saveSettingWithRollback<MainAchievementAction>({
            nextValue,
            previousValue: mainAchievementAction,
            applyValue: setMainAchievementAction,
            saveCall: saveMainAchievementAction,
            getSavedValue: (result, fallbackValue) => result.mainAchievementAction ?? fallbackValue,
        });
    };

    const onAchievementTrackToggle = useCallback(
        async (achievement: AchievementRow) => {
            if (!payload?.gameId) {
                return;
            }
            if (earned(achievement)) {
                return;
            }

            setError(null);

            try {
                const result = await toggleTrackedAchievement(
                    payload.gameId,
                    achievement.id,
                    payload.title ?? null,
                    payload.consoleName ?? null,
                    payload.imageIcon ?? null
                );
                if (!mountedRef.current) {
                    return;
                }

                const achievementIds = result.achievementIds ?? [];
                const notes = result.notes ?? {};
                const notesColor = result.notesColor ?? {};
                cacheTrackedCount(payload.gameId, achievementIds.length);
                cacheTrackedIds(payload.gameId, achievementIds);
                cacheTrackedNotes(payload.gameId, notes);
                cacheTrackedNotesColor(payload.gameId, notesColor);
                setLastKnownTrackedCount(achievementIds.length);
                setTrackedIds(achievementIds);
                setNotesByAchievementId(notes);
                setNotesColorByAchievementId(notesColor);
            } catch (e: any) {
                logError("onAchievementTrackToggle", e);
                if (!mountedRef.current) {
                    return;
                }
                setError(String(e?.message || e || "Couldn't update tracked achievements."));
            }
        },
        [
            mountedRef,
            payload,
            setError,
            setLastKnownTrackedCount,
            setNotesByAchievementId,
            setNotesColorByAchievementId,
            setTrackedIds
        ]
    );

    const onAchievementClick = useCallback(
        async (achievement: AchievementRow) => {
            if (!payload?.gameId) {
                return;
            }
            if (effectiveMainAchievementAction !== "info" && earned(achievement)) {
                return;
            }

            setError(null);

            try {
                if (effectiveMainAchievementAction === "info") {
                    if (legacyAchievementLinks) {
                        await openExternalUrl(raAchievementUrl(achievement.id));
                        return;
                    }
                    goToAchievementOverviewRef.current?.(achievement, payload.gameId, "main", null, null);
                    return;
                }

                await onAchievementTrackToggle(achievement);
            } catch (e: any) {
                logError("onAchievementClick", e);
                if (!mountedRef.current) {
                    return;
                }
                setError(String(e?.message || e || "Couldn't update tracked achievements."));
            }
        },
        [
            effectiveMainAchievementAction,
            goToAchievementOverviewRef,
            legacyAchievementLinks,
            mountedRef,
            onAchievementTrackToggle,
            openExternalUrl,
            payload,
            setError
        ]
    );

    const controllerState = {
        showAllAchievements,
        mainAchievementFilter,
        mainAchievementSort,
        mainAchievementAction,
        mainFilteredAchievementCount,
        effectiveMainAchievementAction
    };

    const controllerActions = {
        goToFriends,
        goToLeaderboards,
        goToOptions,
        goToTracked,
        onShowAllChange,
        onMainAchievementFilterChange,
        onMainAchievementSortChange,
        onMainAchievementActionChange,
        onAchievementClick,
        onAchievementTrackToggle
    };

    return {
        state: controllerState,
        actions: controllerActions
    };
}
