import { useMemo } from "react";
import type { AchievementRow, AchievementStyle, ButtonSpacing, Payload, UiSize } from "../types";
import type { LanguageCode } from "../locales";
import type { UnlockHistorySource } from "../pages/UnlockHistoryPage";

type UseUnlockHistoryControllerArgs = {
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    focusScopeResetToken: number;
    payload: Payload | null;
    unlockHistoryDays: number;
    showIcons: boolean;
    achievementStyle: AchievementStyle;
    uiSize: UiSize;
    topPadding: number;
    blockPadding: number;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    source: UnlockHistorySource;
    friendUsername: string | null;
    showRetroPoints: boolean;
    onBack: () => void | Promise<void>;
    onAchievementClick?: (achievement: AchievementRow) => void | Promise<void>;
};

export function useUnlockHistoryController({
    language,
    buttonSpacing,
    focusScopeResetToken,
    payload,
    unlockHistoryDays,
    showIcons,
    achievementStyle,
    uiSize,
    topPadding,
    blockPadding,
    dynamicLoading,
    dynamicInitialRows,
    dynamicRowStep,
    dynamicPrefetchDistance,
    dynamicSentinelRootMargin,
    source,
    friendUsername,
    showRetroPoints,
    onBack,
    onAchievementClick
}: UseUnlockHistoryControllerArgs) {
    const state = useMemo(() => ({
        language,
        buttonSpacing,
        focusScopeResetToken,
        payload,
        unlockHistoryDays,
        showIcons,
        achievementStyle,
        uiSize,
        topPadding,
        blockPadding,
        dynamicLoading,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        source,
        friendUsername,
        showRetroPoints
    }), [
        blockPadding,
        buttonSpacing,
        dynamicInitialRows,
        dynamicLoading,
        dynamicPrefetchDistance,
        dynamicRowStep,
        dynamicSentinelRootMargin,
        focusScopeResetToken,
        language,
        payload,
        unlockHistoryDays,
        showIcons,
        achievementStyle,
        topPadding,
        uiSize,
        source,
        friendUsername,
        showRetroPoints
    ]);

    const actions = useMemo(() => ({
        onBack,
        onAchievementClick
    }), [onBack, onAchievementClick]);

    return {
        state,
        actions
    };
}
