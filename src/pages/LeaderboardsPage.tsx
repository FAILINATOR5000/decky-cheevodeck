import { PanelSection, PanelSectionRow } from "@decky/ui";
import { BackButton } from "../components/ui/BackButton";
import { ErrorText } from "../components/ui/ErrorText";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { LeaderboardList } from "../components/leaderboards/LeaderboardList";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import type { ButtonSpacing, GameLeaderboardsPayload, LeaderboardRow, UiSize, ViewKey } from "../types";
import { localizeRuntimeText, t } from "../locales";
import type { LanguageCode } from "../locales";

type LeaderboardsPageProps = {
    state: {
        view: ViewKey;
        restoringLeaderboardDetail: boolean;
        language: LanguageCode;
        buttonSpacing: ButtonSpacing;
        leaderboardsSourceView: "achievements" | "friendGame" | "gameOverview";
        leaderboardsLoading: boolean;
        saving: boolean;
        checkingGame: boolean;
        leaderboardsPayload: GameLeaderboardsPayload | null;
        leaderboardsError: string | null;
        showIcons: boolean;
        uiSize: UiSize;
        topPadding: number;
        blockPadding: number;
        dynamicLeaderboardLoading: boolean;
        dynamicInitialRows: number;
        dynamicRowStep: number;
        dynamicPrefetchDistance: number;
        dynamicSentinelRootMargin: number;
    };
    actions: {
        onBack: () => void | Promise<void>;
        onLeaderboardClick: (leaderboard: LeaderboardRow) => void | Promise<void>;
        onHome: () => void | Promise<void>;
    };
};

function LeaderboardsPage({ state, actions }: LeaderboardsPageProps) {
    if (state.view !== "leaderboards" || state.restoringLeaderboardDetail) {
        return null;
    }

    return (
        <>
            <PanelSection>
                <PageNavStrip
                    title={t(state.language, "Leaderboards")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                />
                <BackButton
                    label={
                        state.leaderboardsSourceView === "friendGame"
                            ? t(state.language, "← Back to Friend Profile")
                            : state.leaderboardsSourceView === "gameOverview"
                                ? t(state.language, "← Back to Game Overview")
                                : t(state.language, "← Back to Main")
                    }
                    focusKey="leaderboards:back"
                    navAutoFocus
                    buttonSpacing={state.buttonSpacing}
                    onClick={actions.onBack}
                />
                {state.leaderboardsError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(state.language, state.leaderboardsError)}</ErrorText>
                    </PanelSectionRow>
                )}
                {state.leaderboardsLoading && !state.leaderboardsPayload && (
                    <PanelSectionRow>
                        <InlineSpinner label={t(state.language, "Loading...")} />
                    </PanelSectionRow>
                )}
            </PanelSection>
            {state.leaderboardsPayload && (
                <LeaderboardList
                    payload={state.leaderboardsPayload}
                    language={state.language}
                    showIcons={state.showIcons}
                    uiSize={state.uiSize}
                    topPadding={state.topPadding}
                    blockPadding={state.blockPadding}
                    dynamicLeaderboardLoading={state.dynamicLeaderboardLoading}
                    dynamicInitialRows={state.dynamicInitialRows}
                    dynamicRowStep={state.dynamicRowStep}
                    dynamicPrefetchDistance={state.dynamicPrefetchDistance}
                    dynamicSentinelRootMargin={state.dynamicSentinelRootMargin}
                    onLeaderboardClick={actions.onLeaderboardClick}
                />
            )}
        </>
    );
}

export default LeaderboardsPage;
