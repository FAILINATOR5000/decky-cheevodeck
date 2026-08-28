import { PanelSection, PanelSectionRow } from "@decky/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getRecentUnlockHistory } from "../api";
import { AchievementList } from "../components/achievements/AchievementList";
import { BackButton } from "../components/ui/BackButton";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ErrorText } from "../components/ui/ErrorText";
import { InfoText } from "../components/ui/InfoText";
import { localizeRuntimeText, t, type LanguageCode } from "../locales";
import type {
    AchievementRow,
    AchievementStyle,
    ButtonSpacing,
    Payload,
    UiSize,
    UnlockHistoryPayload,
    ViewKey
} from "../types";
import { unlockDateLabel } from "../utils/achievements";
import { UnlockStamp } from "../components/achievements/UnlockStamp";
import { bodyTextStyle } from "../utils/style";

export type UnlockHistorySource = "main" | "friendGame";

type UnlockHistoryPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
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
    showRetroPoints: boolean;
};

type UnlockHistoryPageActions = {
    onBack: () => void | Promise<void>;
    onAchievementClick?: (achievement: AchievementRow) => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type UnlockHistoryPageProps = {
    state: UnlockHistoryPageState;
    actions: UnlockHistoryPageActions;
};

function buildHistoryAchievements(payload: Payload | null, history: UnlockHistoryPayload | null): AchievementRow[] {
    if (!payload || !history) {
        return [];
    }

    const achievementsById = new Map<number, AchievementRow>();
    for (const achievement of payload.achievements ?? []) {
        achievementsById.set(achievement.id, achievement);
    }

    const rows: AchievementRow[] = [];
    for (const historyRow of history.results ?? []) {
        const achievement = achievementsById.get(historyRow.achievementId);
        if (!achievement) {
            continue;
        }

        rows.push({
            ...achievement,
            dateEarned: historyRow.dateEarned ?? achievement.dateEarned ?? null,
            dateEarnedHardcore: historyRow.hardcore
                ? historyRow.dateEarned ?? achievement.dateEarnedHardcore ?? achievement.dateEarned ?? null
                : null
        });
    }

    return rows;
}

function unlockDateValue(a: AchievementRow): number {
    const raw = a.dateEarnedHardcore ?? a.dateEarned ?? null;
    if (!raw) {
        return 0;
    }
    const trimmed = String(raw).trim();
    if (!trimmed) {
        return 0;
    }
    const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    const withZone = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
    const ms = new Date(withZone).getTime();
    return Number.isNaN(ms) ? 0 : ms;
}

function buildFriendHistoryAchievements(payload: Payload | null): AchievementRow[] {
    if (!payload) {
        return [];
    }
    const unlocked = (payload.achievements ?? []).filter((a) => Boolean(a.dateEarned || a.dateEarnedHardcore));
    unlocked.sort((a, b) => unlockDateValue(b) - unlockDateValue(a));
    return unlocked;
}

function UnlockHistoryPage(props: UnlockHistoryPageProps) {
    const { state, actions } = props;
    const [history, setHistory] = useState<UnlockHistoryPayload | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const gameId = state.payload?.gameId ?? null;
    const isFriendSource = state.source === "friendGame";

    useEffect(() => {
        if (state.view !== "unlockHistory") {
            return;
        }
        if (isFriendSource) {
            setHistory(null);
            setLoading(false);
            setError(null);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        void (async () => {
            try {
                const result = await getRecentUnlockHistory(gameId);
                if (cancelled) {
                    return;
                }

                if (result?.error) {
                    setError(result.error);
                }
                setHistory(result?.payload ?? null);
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : String(e));
                    setHistory(null);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [state.view, gameId, state.unlockHistoryDays, state.focusScopeResetToken, isFriendSource]);

    const historyAchievements = useMemo(() => {
        if (isFriendSource) {
            return buildFriendHistoryAchievements(state.payload);
        }
        return buildHistoryAchievements(state.payload, history);
    }, [isFriendSource, state.payload, history]);

    const historyPayload = useMemo<Payload | null>(() => {
        if (!state.payload) {
            return null;
        }

        return {
            ...state.payload,
            numAchievements: historyAchievements.length,
            numAwardedToUser: historyAchievements.length,
            numAwardedToUserHardcore: historyAchievements.filter(
                (achievement: AchievementRow) => achievement.dateEarnedHardcore
            ).length,
            achievements: historyAchievements
        };
    }, [state.payload, historyAchievements]);

    const renderUnlockStamp = useCallback((achievement: AchievementRow) => {
        const stamp = unlockDateLabel(achievement, state.language);
        return stamp ? <UnlockStamp date={stamp} /> : null;
    }, [state.language]);

    if (state.view !== "unlockHistory") {
        return null;
    }

    const backLabel = isFriendSource
        ? t(state.language, "← Back to Friend Profile")
        : t(state.language, "← Back to Main");

    const backButton = (
        <BackButton
            label={backLabel}
            focusKey="unlockhistory:back"
            navAutoFocus
            buttonSpacing={state.buttonSpacing}
            onClick={actions.onBack}
        />
    );

    if (!historyPayload) {
        return (
            <PanelSection key={`unlockhistory:view:${state.focusScopeResetToken}`}>
                <PageNavStrip
                    title={t(state.language, "Unlock History")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                />
                {backButton}
                <PanelSectionRow>
                    <InfoText>{t(state.language, "No current game loaded.")}</InfoText>
                </PanelSectionRow>
            </PanelSection>
        );
    }

    const showAllTimeLine = isFriendSource || state.unlockHistoryDays === -1;
    const emptyMessage = loading
        ? t(state.language, "Loading recent unlocks...")
        : showAllTimeLine
            ? t(state.language, "No achievements unlocked for this game yet.")
            : t(state.language, "No achievements unlocked in the last {{days}} days.", { days: state.unlockHistoryDays });

    return (
        <>
            <PanelSection key={`unlockhistory:view:${state.focusScopeResetToken}`}>
                <PageNavStrip
                    title={t(state.language, "Unlock History")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                />
                {backButton}
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {showAllTimeLine
                            ? t(state.language, "Showing all unlocks for this game.")
                            : t(state.language, "Showing unlocks from the last {{days}} days.", { days: state.unlockHistoryDays })}
                    </div>
                </PanelSectionRow>
                {loading && historyAchievements.length > 0 && (
                    <PanelSectionRow>
                        <InfoText>{t(state.language, "Loading recent unlocks...")}</InfoText>
                    </PanelSectionRow>
                )}
                {error && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(state.language, error)}</ErrorText>
                    </PanelSectionRow>
                )}
            </PanelSection>
            <AchievementList
                payload={historyPayload}
                language={state.language}
                titleOverride={t(state.language, "Achievements")}
                showIcons={state.showIcons}
                achievementStyle={state.achievementStyle}
                uiSize={state.uiSize}
                topPadding={state.topPadding}
                blockPadding={state.blockPadding}
                buttonSpacing={state.buttonSpacing}
                showAll={true}
                mode="tracked"
                filterScopeKey={`unlockhistory:${state.source}:${gameId ?? "none"}:${history?.refreshedAt ?? 0}`}
                resetToken={state.focusScopeResetToken}
                showRetroPoints={state.showRetroPoints}
                emptyMessageOverride={emptyMessage}
                getAchievementExtraLabel={renderUnlockStamp}
                onAchievementClick={actions.onAchievementClick}
                dynamicLoading={state.dynamicLoading}
                dynamicInitialRows={state.dynamicInitialRows}
                dynamicRowStep={state.dynamicRowStep}
                dynamicPrefetchDistance={state.dynamicPrefetchDistance}
                dynamicSentinelRootMargin={state.dynamicSentinelRootMargin}
            />
        </>
    );
}

export default UnlockHistoryPage;
