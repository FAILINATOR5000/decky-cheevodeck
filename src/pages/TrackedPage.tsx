import { Fragment, useEffect, useState, type ComponentType } from "react";
import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { getCachedTrackedCount } from "../api";
import { BackButton } from "../components/ui/BackButton";
import { ConfirmRow } from "../components/ui/ConfirmRow";
import { ErrorText } from "../components/ui/ErrorText";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { InfoText } from "../components/ui/InfoText";
import { LabeledRow } from "../components/ui/LabeledRow";
import { OtherGamesDrillInBody } from "../components/tracked/OtherGamesDrillInBody";
import { OtherGamesPicker } from "../components/tracked/OtherGamesPicker";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ReorderStrip } from "../components/ui/ReorderStrip";
import { TrackedButtonHints } from "../components/tracked/TrackedButtonHints";
import { TrackedEmptyMessage } from "../components/tracked/TrackedEmptyMessage";
import { groupIdsForTrackedTarget, largestTrackedGroupSize, TrackedListBody } from "../components/tracked/TrackedListBody";
import type { FocusClaimController } from "../hooks/useFocusClaim";
import type { LanguageCode } from "../locales";
import type {
    AchievementRow,
    AchievementStyle,
    ButtonSpacing,
    ControllerGlyphStyle,
    Payload,
    ReorderDirection,
    TrackedAchievementAction,
    TrackedAchievementSort,
    TrackedDrillInState,
    TrackedNotes,
    TrackedNotesColor,
    TrackedTab,
    UiSize,
    ViewKey
} from "../types";
import { localizeRuntimeText, t } from "../locales";
import {
    nextTrackedAchievementAction,
    nextTrackedAchievementSort,
    trackedAchievementActionLabel,
    trackedAchievementSortLabel
} from "../utils/achievements";
import { playOkSound } from "../utils/navSound";
import { regularButtonSpacingStyle, smallTextStyle, bodyTextStyle } from "../utils/style";

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
type TabIconProps = { size?: number };

function CrosshairIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M256 0c17.7 0 32 14.3 32 32V66.7C368.4 80.1 431.9 143.6 445.3 224H480c17.7 0 32 14.3 32 32s-14.3 32-32 32H445.3C431.9 368.4 368.4 431.9 288 445.3V480c0 17.7-14.3 32-32 32s-32-14.3-32-32V445.3C143.6 431.9 80.1 368.4 66.7 288H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H66.7C80.1 143.6 143.6 80.1 224 66.7V32c0-17.7 14.3-32 32-32zM128 256a128 128 0 1 0 256 0 128 128 0 1 0 -256 0zm128-80a80 80 0 1 1 0 160 80 80 0 1 1 0-160z" />
        </svg>
    );
}

function GridIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M0 96C0 78.3 14.3 64 32 64H224c17.7 0 32 14.3 32 32V288c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32V96zM0 416c0-17.7 14.3-32 32-32H224c17.7 0 32 14.3 32 32v64c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32V416zM320 96c0-17.7 14.3-32 32-32H480c17.7 0 32 14.3 32 32v64c0 17.7-14.3 32-32 32H352c-17.7 0-32-14.3-32-32V96zM320 288c0-17.7 14.3-32 32-32H480c17.7 0 32 14.3 32 32V480c0 17.7-14.3 32-32 32H352c-17.7 0-32-14.3-32-32V288z" />
        </svg>
    );
}

function TrashIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0H284.2c12.1 0 23.2 6.8 28.6 17.7L320 32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 96 0 81.7 0 64S14.3 32 32 32h96l7.2-14.3zM32 128H416V448c0 35.3-28.7 64-64 64H96c-35.3 0-64-28.7-64-64V128zm96 64c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16V432c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function MissableIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM232 152c0-13.3 10.7-24 24-24s24 10.7 24 24V264c0 13.3-10.7 24-24 24s-24-10.7-24-24V152zm56 184a32 32 0 1 1 -64 0 32 32 0 1 1 64 0z" />
        </svg>
    );
}

type TrackedTabDef = {
    id: TrackedTab;
    Icon: ComponentType<TabIconProps>;
    labelKey: string;
    focusKey: string;
    dividerAfter?: boolean;
};

const TRACKED_TABS: TrackedTabDef[] = [
    { id: "thisGame", Icon: CrosshairIcon, labelKey: "tab_this_game", focusKey: "tracked:tab:thisGame" },
    { id: "otherGames", Icon: GridIcon, labelKey: "tab_other_games", focusKey: "tracked:tab:otherGames", dividerAfter: true },
    { id: "addAllMissable", Icon: MissableIcon, labelKey: "tab_add_all_missable", focusKey: "tracked:tab:addAllMissable" },
    { id: "clear", Icon: TrashIcon, labelKey: "tab_clear", focusKey: "tracked:tab:clear" }
];

type TrackedPageProps = {
    view: ViewKey;
    language: LanguageCode;
    focusScopeResetToken: number;
    buttonSpacing: ButtonSpacing;
    payload: Payload | null;
    trackedIdsLoadedForGameId: number | null;
    trackedValidating: boolean;
    trackedAchievements: AchievementRow[];
    notesByAchievementId: TrackedNotes;
    notesColorByAchievementId: TrackedNotesColor;
    error: string | null;
    showAButtonModeTracked: boolean;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    trackedAchievementAction: TrackedAchievementAction;
    trackedAchievementSort: TrackedAchievementSort;
    showIcons: boolean;
    showRetroPoints: boolean;
    achievementStyle: AchievementStyle;
    uiSize: UiSize;
    topPadding: number;
    blockPadding: number;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    dynamicTrackedListLoading: boolean;
    dynamicTrackedListInitialRows: number;
    dynamicTrackedListRowStep: number;
    dynamicTrackedListPrefetchDistance: number;
    dynamicTrackedListSentinelRootMargin: number;
    dynamicTrackedGames: boolean;
    trackedIds: number[];
    listResetToken: number;
    checkingGame: boolean;
    activeTrackedTab: TrackedTab;
    trackedSelectedGameId: number | null;
    drillIn: TrackedDrillInState;
    currentGameTrackedCount: number;
    backFromTracked: () => void | Promise<void>;
    onSelectTrackedTab: (nextTab: TrackedTab) => void;
    onSelectTrackedGame: (nextGameId: number | null) => void;
    onTrackedAchievementActionChange: (nextValue: TrackedAchievementAction) => void | Promise<void>;
    onTrackedAchievementSortChange: (nextValue: TrackedAchievementSort) => void | Promise<void>;
    onAchievementClick: (achievement: AchievementRow, trackedAchievements: AchievementRow[]) => void | Promise<void>;
    onTrackedUntrack: (achievement: AchievementRow, trackedAchievements: AchievementRow[]) => void | Promise<void>;
    onTrackedEditNote: (achievement: AchievementRow) => void;
    onTrackedReorderPick: (achievementId: number, allowSwap: boolean) => void | Promise<void>;
    onClearTrackedForGame: (targetGameId: number, focusKeyAfter?: string) => void | Promise<void>;
    onRefreshTotalTrackedCount: () => void | Promise<void>;
    onAddAllMissable: () => void | Promise<void>;
    reorderTargetId: number | null;
    reorderViaSwap?: boolean;
    onReorderMove: (direction: ReorderDirection, groupIds?: number[] | null) => void | Promise<void>;
    backClaimToken: number;
    rowClaim: FocusClaimController;
    onHome: () => void | Promise<void>;
};

function TrackedPage(props: TrackedPageProps) {
    const {
        view,
        language,
        focusScopeResetToken,
        buttonSpacing,
        payload,
        trackedIdsLoadedForGameId,
        trackedValidating,
        trackedAchievements,
        notesByAchievementId,
        notesColorByAchievementId,
        error,
        showAButtonModeTracked,
        mouseKeyboardMode,
        controllerGlyphStyle,
        showRetroPoints,
        trackedAchievementAction,
        trackedAchievementSort,
        showIcons,
        achievementStyle,
        uiSize,
        topPadding,
        blockPadding,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        dynamicTrackedListLoading,
        dynamicTrackedListInitialRows,
        dynamicTrackedListRowStep,
        dynamicTrackedListPrefetchDistance,
        dynamicTrackedListSentinelRootMargin,
        dynamicTrackedGames,
        trackedIds,
        listResetToken,
        checkingGame,
        activeTrackedTab,
        trackedSelectedGameId,
        drillIn,
        currentGameTrackedCount,
        backFromTracked,
        onSelectTrackedTab,
        onSelectTrackedGame,
        onTrackedAchievementActionChange,
        onTrackedAchievementSortChange,
        onAchievementClick,
        onTrackedUntrack,
        onTrackedEditNote,
        onTrackedReorderPick,
        onClearTrackedForGame,
        onRefreshTotalTrackedCount,
        onAddAllMissable,
        reorderTargetId,
        reorderViaSwap,
        onReorderMove,
        backClaimToken,
        rowClaim,
        onHome,
    } = props;

    useEffect(() => {
        if (trackedAchievementAction !== "reorder") {
            return;
        }

        let reorderFitsActiveContext = false;
        if (activeTrackedTab === "thisGame") {
            const ready = payload?.gameId != null && trackedIdsLoadedForGameId === payload.gameId;
            if (!ready) {
                return;
            }
            reorderFitsActiveContext = trackedAchievementSort === "manual" && trackedIds.length >= 2;
        }
        else if (activeTrackedTab === "otherGames") {
            if (trackedSelectedGameId === null) {
                reorderFitsActiveContext = false;
            }
            else if (!drillIn.trackedReady) {
                return;
            }
            else {
                reorderFitsActiveContext = drillIn.sort === "manual" && drillIn.trackedIds.length >= 2;
            }
        }
        else {
            reorderFitsActiveContext = false;
        }

        if (!reorderFitsActiveContext) {
            void onTrackedAchievementActionChange("editNote");
        }
    }, [
        trackedAchievementAction,
        activeTrackedTab,
        trackedSelectedGameId,
        payload?.gameId,
        trackedIdsLoadedForGameId,
        trackedAchievementSort,
        trackedIds.length,
        drillIn.trackedReady,
        drillIn.sort,
        drillIn.trackedIds.length,
        onTrackedAchievementActionChange
    ]);

    const [focusedTab, setFocusedTab] = useState<TrackedTab | null>(null);
    const [hoveredTab, setHoveredTab] = useState<TrackedTab | null>(null);

    const [lastViewedGame, setLastViewedGame] = useState<{ gameId: number; title: string } | null>(() => {
        if (payload?.gameId) {
            return { gameId: payload.gameId, title: payload.title?.trim() || "" };
        }
        return null;
    });

    useEffect(() => {
        if (activeTrackedTab === "thisGame" && payload?.gameId) {
            setLastViewedGame({
                gameId: payload.gameId,
                title: payload.title?.trim() || ""
            });
            return;
        }

        if (activeTrackedTab === "otherGames" && trackedSelectedGameId !== null) {
            const drillTitle = drillIn.payload?.title?.trim() || "";
            setLastViewedGame((current) => {
                if (current?.gameId === trackedSelectedGameId && current.title && !drillTitle) {
                    return current;
                }
                return { gameId: trackedSelectedGameId, title: drillTitle };
            });
        }
    }, [activeTrackedTab, payload?.gameId, payload?.title, trackedSelectedGameId, drillIn.payload?.title]);

    if (view !== "tracked") {
        return null;
    }

    function handleTabFocus(id: TrackedTab) {
        setFocusedTab(id);
    }

    function handleTabBlur(id: TrackedTab) {
        setFocusedTab((current) => {
            if (current !== id) {
                return current;
            }

            return null;
        });
    }

    const addAllMissableDisabled = activeTrackedTab === "otherGames" || !payload;

    function handleTabClick(id: TrackedTab) {
        if (id === "addAllMissable") {
            if (addAllMissableDisabled) {
                return;
            }
            void onAddAllMissable();
            return;
        }

        if (id === "otherGames" && id === activeTrackedTab && trackedSelectedGameId !== null) {
            onSelectTrackedGame(null);
            return;
        }

        if (id === activeTrackedTab) {
            return;
        }

        onSelectTrackedTab(id);
    }

    function handleTabHover(id: TrackedTab) {
        if (id === "addAllMissable" && addAllMissableDisabled) {
            return;
        }

        setHoveredTab(id);
    }

    function handleTabUnhover(id: TrackedTab) {
        setHoveredTab((current) => {
            if (current !== id) {
                return current;
            }

            return null;
        });
    }

    const previewTab = hoveredTab ?? focusedTab;
    const previewedOrActive = previewTab ?? activeTrackedTab;
    const previewedTab = TRACKED_TABS.find((entry) => entry.id === previewedOrActive);
    const previewLabel = previewedTab ? t(language, previewedTab.labelKey) : "";

    const trackedReady = payload ? trackedIdsLoadedForGameId === (payload.gameId ?? null) : false;
    const showLoading = activeTrackedTab === "thisGame" && payload !== null && (!trackedReady || trackedValidating);

    const reorderableSize = largestTrackedGroupSize(trackedAchievements, notesByAchievementId);
    const reorderAvailable = trackedAchievementSort === "manual" && reorderableSize >= 2;
    const gamepadRowActions = !mouseKeyboardMode && activeTrackedTab === "thisGame" && payload !== null;

    function handleAButtonClick() {
        void onTrackedAchievementActionChange(
            nextTrackedAchievementAction(
                trackedAchievementAction,
                trackedAchievementSort,
                reorderableSize
            )
        );
    }

    function handleSortClick() {
        void onTrackedAchievementSortChange(nextTrackedAchievementSort(trackedAchievementSort));
    }

    function handleStripMove(direction: ReorderDirection) {
        const groupIds = groupIdsForTrackedTarget(
            trackedAchievements,
            notesByAchievementId,
            reorderTargetId
        );
        void onReorderMove(direction, groupIds);
    }

    function handleRowUntrack(achievement: AchievementRow) {
        if (trackedValidating || checkingGame) {
            return;
        }
        void onTrackedUntrack(achievement, trackedAchievements);
    }

    function handleRowEditNote(achievement: AchievementRow) {
        if (trackedValidating || checkingGame) {
            return;
        }
        onTrackedEditNote(achievement);
    }

    function handleRowReorderPick(achievement: AchievementRow) {
        if (trackedValidating || checkingGame) {
            return;
        }
        void onTrackedReorderPick(achievement.id, false);
    }

    function renderThisGameBody() {
        if (!payload) {
            return (
                <PanelSection title={t(language, "Tracked")}>
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, "No current game. Open a game to track achievements here.")}
                        </div>
                    </PanelSectionRow>
                </PanelSection>
            );
        }

        return (
            <>
                {mouseKeyboardMode && trackedAchievementAction === "reorder" && trackedReady && (
                    <div style={{ marginTop: "8px", marginBottom: "16px" }}>
                        <ReorderStrip
                            targetId={reorderTargetId}
                            onMove={handleStripMove}
                        />
                        <PanelSection>
                            <PanelSectionRow>
                                <div style={{ marginTop: "8px" }}>
                                    <InfoText>{t(language, "reorder_help_tracked")}</InfoText>
                                </div>
                            </PanelSectionRow>
                        </PanelSection>
                    </div>
                )}
                <TrackedListBody
                    language={language}
                    payload={payload}
                    trackedReady={trackedReady}
                    trackedAchievements={trackedAchievements}
                    trackedIds={trackedIds}
                    notesByAchievementId={notesByAchievementId}
                    notesColorByAchievementId={notesColorByAchievementId}
                    showIcons={showIcons}
                    achievementStyle={achievementStyle}
                    uiSize={uiSize}
                    topPadding={topPadding}
                    blockPadding={blockPadding}
                    listResetToken={listResetToken}
                    focusScopeResetToken={focusScopeResetToken}
                    title={t(language, "Tracked ({{count}})", { count: trackedAchievements.length })}
                    emptyMessage={
                        <TrackedEmptyMessage
                            language={language}
                            style={controllerGlyphStyle}
                            mouseKeyboardMode={mouseKeyboardMode}
                        />
                    }
                    dynamicLoading={dynamicTrackedListLoading}
                    dynamicInitialRows={dynamicTrackedListInitialRows}
                    dynamicRowStep={dynamicTrackedListRowStep}
                    dynamicPrefetchDistance={dynamicTrackedListPrefetchDistance}
                    dynamicSentinelRootMargin={dynamicTrackedListSentinelRootMargin}
                    trackedValidating={trackedValidating}
                    busy={checkingGame}
                    showRetroPoints={showRetroPoints}
                    reorderTargetId={reorderTargetId}
                    reorderViaSwap={reorderViaSwap}
                    rowClaim={rowClaim}
                    onAchievementClick={onAchievementClick}
                    onAchievementTrackToggle={gamepadRowActions ? handleRowUntrack : undefined}
                    onAchievementNote={gamepadRowActions ? handleRowEditNote : undefined}
                    onAchievementReorderPick={gamepadRowActions && reorderAvailable ? handleRowReorderPick : undefined}
                    onAchievementReorderNudge={gamepadRowActions && reorderAvailable ? handleStripMove : undefined}
                />
            </>
        );
    }

    return (
        <>
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Tracked")}
                    buttonSpacing={buttonSpacing}
                    onHome={onHome}
                />
                <BackButton
                    key={`back:${backClaimToken}`}
                    label={t(language, "← Back to Main")}
                    focusKey="tracked:back"
                    buttonSpacing={buttonSpacing}
                    onClick={backFromTracked}
                    navAutoFocus
                />

                <PanelSectionRow>
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "6px",
                            padding: "14px 0 0 0"
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
                            {TRACKED_TABS.map((tab) => {
                                const isActionTab = tab.id === "addAllMissable";
                                const isActive = !isActionTab && activeTrackedTab === tab.id;
                                const isPreviewed = previewTab === tab.id;
                                const isDisabled = isActionTab && addAllMissableDisabled;
                                const Icon = tab.Icon;

                                const divider = tab.dividerAfter ? (
                                    <div
                                        key={`${tab.focusKey}:divider`}
                                        style={{
                                            width: "1px",
                                            height: "26px",
                                            background: "rgba(255, 255, 255, 0.22)",
                                            alignSelf: "center",
                                            margin: "0 2px"
                                        }}
                                    />
                                ) : null;

                                const buttonOpacity = isDisabled
                                    ? 0.35
                                    : isActive || isPreviewed
                                        ? 1
                                        : 0.7;

                                return (
                                    <Fragment key={tab.focusKey}>
                                        <div
                                            data-focus-key={tab.focusKey}
                                            onMouseEnter={() => handleTabHover(tab.id)}
                                            onMouseLeave={() => handleTabUnhover(tab.id)}
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                width: "44px"
                                            }}
                                        >
                                            <DialogButton
                                                onClick={() => handleTabClick(tab.id)}
                                                onGamepadFocus={() => handleTabFocus(tab.id)}
                                                onGamepadBlur={() => handleTabBlur(tab.id)}
                                                disabled={isDisabled}
                                                style={{
                                                    minWidth: 0,
                                                    width: "44px",
                                                    height: "38px",
                                                    padding: "4px 2px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    opacity: buttonOpacity,
                                                    boxShadow: isActive
                                                        ? "0 0 0 2px rgba(120, 200, 255, 0.85), 0 2px 8px rgba(0,0,0,0.35)"
                                                        : isPreviewed
                                                            ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                                                            : undefined
                                                }}
                                            >
                                                <Icon size={18} />
                                            </DialogButton>
                                        </div>
                                        {divider}
                                    </Fragment>
                                );
                            })}
                        </Focusable>
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontWeight: 700,
                                textAlign: "center",
                                whiteSpace: "nowrap",
                                minHeight: "1em",
                                opacity: 0.92
                            }}
                        >
                            {previewLabel}
                        </div>
                    </div>
                </PanelSectionRow>

                {mouseKeyboardMode && activeTrackedTab === "thisGame" && payload && showAButtonModeTracked && (
                    <LabeledRow
                        focusKey="tracked:action-mode"
                        label={t(language, "Click")}
                        value={trackedAchievementActionLabel(trackedAchievementAction, language)}
                        disabled={trackedValidating || checkingGame}
                        onClick={handleAButtonClick}
                        outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                    />
                )}
                {
}
                {activeTrackedTab === "thisGame" && payload && (
                    <LabeledRow
                        focusKey="tracked:sort"
                        label={t(language, "Sort")}
                        value={showLoading ? "" : trackedAchievementSortLabel(trackedAchievementSort, language)}
                        disabled={trackedValidating || checkingGame}
                        onClick={handleSortClick}
                        outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                        bottomSeparator={gamepadRowActions ? "none" : "standard"}
                    />
                )}
                {gamepadRowActions && (
                    <TrackedButtonHints
                        language={language}
                        style={controllerGlyphStyle}
                        reorderAvailable={reorderAvailable}
                    />
                )}
                {showLoading && (
                    <PanelSectionRow>
                        <InlineSpinner label={t(language, "Validating tracked achievements...")} />
                    </PanelSectionRow>
                )}
                {error && activeTrackedTab !== "otherGames" && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, error)}</ErrorText>
                    </PanelSectionRow>
                )}
            </PanelSection>

            <div key={`tracked:body:${activeTrackedTab}:${focusScopeResetToken}`}>
                {activeTrackedTab === "thisGame" && renderThisGameBody()}
                {activeTrackedTab === "otherGames" && (
                    <Focusable
                        key={`tracked:otherbody:${trackedSelectedGameId ?? "picker"}`}
                        onCancelButton={trackedSelectedGameId !== null
                            ? () => {
                                playOkSound();
                                onSelectTrackedGame(null);
                            }
                            : undefined}
                    >
                        <OtherGamesTabBody
                            language={language}
                            buttonSpacing={buttonSpacing}
                            mouseKeyboardMode={mouseKeyboardMode}
                            controllerGlyphStyle={controllerGlyphStyle}
                            showIcons={showIcons}
                            achievementStyle={achievementStyle}
                            uiSize={uiSize}
                            topPadding={topPadding}
                            blockPadding={blockPadding}
                            currentGameId={payload?.gameId ?? null}
                            selectedGameId={trackedSelectedGameId}
                            drillIn={drillIn}
                            dynamicTrackedGames={dynamicTrackedGames}
                            dynamicInitialRows={dynamicInitialRows}
                            dynamicRowStep={dynamicRowStep}
                            dynamicPrefetchDistance={dynamicPrefetchDistance}
                            dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                            dynamicTrackedListLoading={dynamicTrackedListLoading}
                            dynamicTrackedListInitialRows={dynamicTrackedListInitialRows}
                            dynamicTrackedListRowStep={dynamicTrackedListRowStep}
                            dynamicTrackedListPrefetchDistance={dynamicTrackedListPrefetchDistance}
                            dynamicTrackedListSentinelRootMargin={dynamicTrackedListSentinelRootMargin}
                            listResetToken={listResetToken}
                            focusScopeResetToken={focusScopeResetToken}
                            showAButtonModeTracked={showAButtonModeTracked}
                            showRetroPoints={showRetroPoints}
                            trackedAchievementAction={trackedAchievementAction}
                            onTrackedAchievementActionChange={onTrackedAchievementActionChange}
                            onSelectGame={onSelectTrackedGame}
                        />
                    </Focusable>
                )}
                {activeTrackedTab === "clear" && (
                    <ClearTabBody
                        language={language}
                        lastViewedGame={lastViewedGame}
                        currentGameTrackedCount={currentGameTrackedCount}
                        currentGameId={payload?.gameId ?? null}
                        onClearTrackedForGame={onClearTrackedForGame}
                        onRefreshTotalTrackedCount={onRefreshTotalTrackedCount}
                    />
                )}
            </div>
        </>
    );
}

type ClearTabBodyProps = {
    language: LanguageCode;
    lastViewedGame: { gameId: number; title: string } | null;
    currentGameTrackedCount: number;
    currentGameId: number | null;
    onClearTrackedForGame: (targetGameId: number, focusKeyAfter?: string) => void | Promise<void>;
    onRefreshTotalTrackedCount: () => void | Promise<void>;
};

function ClearTabBody(props: ClearTabBodyProps) {
    const {
        language,
        lastViewedGame,
        currentGameTrackedCount,
        currentGameId,
        onClearTrackedForGame,
        onRefreshTotalTrackedCount
    } = props;

    useEffect(() => {
        void onRefreshTotalTrackedCount();
    }, [onRefreshTotalTrackedCount]);

    if (!lastViewedGame) {
        return (
            <PanelSection title={t(language, "Clear")}>
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {t(language, "Open a tracked game first to clear its tracked achievements.")}
                    </div>
                </PanelSectionRow>
            </PanelSection>
        );
    }

    const targetCount = lastViewedGame.gameId === currentGameId
        ? currentGameTrackedCount
        : getCachedTrackedCount(lastViewedGame.gameId);
    const disabled = targetCount === 0;

    const subheaderTitle = lastViewedGame.title || t(language, "Game {{gameId}}", { gameId: lastViewedGame.gameId });

    return (
        <PanelSection title={t(language, "Clear")}>
            <PanelSectionRow>
                <div
                    style={{
                        fontWeight: 700,
                        textAlign: "center",
                        color: "#ff7a7a",
                        padding: "2px 0 4px 0"
                    }}
                >
                    {subheaderTitle}
                </div>
            </PanelSectionRow>
            <PanelSectionRow>
                <ConfirmRow
                    focusKey="tracked:clear:this-game"
                    idleLabel={t(language, "Clear All")}
                    armedLabel={t(language, "Press again to confirm")}
                    disabled={disabled}
                    onConfirm={() => onClearTrackedForGame(lastViewedGame.gameId, "tracked:clear:this-game")}
                />
            </PanelSectionRow>
        </PanelSection>
    );
}

type OtherGamesTabBodyProps = {
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    showIcons: boolean;
    achievementStyle: AchievementStyle;
    uiSize: UiSize;
    topPadding: number;
    blockPadding: number;
    currentGameId: number | null;
    selectedGameId: number | null;
    drillIn: TrackedDrillInState;
    dynamicTrackedGames: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    dynamicTrackedListLoading: boolean;
    dynamicTrackedListInitialRows: number;
    dynamicTrackedListRowStep: number;
    dynamicTrackedListPrefetchDistance: number;
    dynamicTrackedListSentinelRootMargin: number;
    listResetToken: number;
    focusScopeResetToken: number;
    showAButtonModeTracked: boolean;
    showRetroPoints: boolean;
    trackedAchievementAction: TrackedAchievementAction;
    onTrackedAchievementActionChange: (nextValue: TrackedAchievementAction) => void | Promise<void>;
    onSelectGame: (gameId: number | null) => void;
};

function OtherGamesTabBody(props: OtherGamesTabBodyProps) {
    const {
        language,
        buttonSpacing,
        mouseKeyboardMode,
        controllerGlyphStyle,
        showIcons,
        achievementStyle,
        uiSize,
        topPadding,
        blockPadding,
        currentGameId,
        selectedGameId,
        drillIn,
        dynamicTrackedGames,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        dynamicTrackedListLoading,
        dynamicTrackedListInitialRows,
        dynamicTrackedListRowStep,
        dynamicTrackedListPrefetchDistance,
        dynamicTrackedListSentinelRootMargin,
        listResetToken,
        focusScopeResetToken,
        showAButtonModeTracked,
        showRetroPoints,
        trackedAchievementAction,
        onTrackedAchievementActionChange,
        onSelectGame
    } = props;

    function handleSelectGame(gameId: number) {
        onSelectGame(gameId);
    }

    if (selectedGameId === null) {
        return (
            <OtherGamesPicker
                language={language}
                showIcons={showIcons}
                uiSize={uiSize}
                currentGameId={currentGameId}
                dynamicTrackedGames={dynamicTrackedGames}
                dynamicInitialRows={dynamicInitialRows}
                dynamicRowStep={dynamicRowStep}
                dynamicPrefetchDistance={dynamicPrefetchDistance}
                dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                onSelectGame={handleSelectGame}
            />
        );
    }

    return (
        <OtherGamesDrillInBody
            language={language}
            buttonSpacing={buttonSpacing}
            mouseKeyboardMode={mouseKeyboardMode}
            controllerGlyphStyle={controllerGlyphStyle}
            payload={drillIn.payload}
            payloadLoading={drillIn.payloadLoading}
            payloadError={drillIn.payloadError}
            trackedReady={drillIn.trackedReady}
            trackedAchievements={drillIn.trackedAchievements}
            trackedIds={drillIn.trackedIds}
            notesByAchievementId={drillIn.notesByAchievementId}
            notesColorByAchievementId={drillIn.notesColorByAchievementId}
            sort={drillIn.sort}
            showIcons={showIcons}
            achievementStyle={achievementStyle}
            uiSize={uiSize}
            topPadding={topPadding}
            blockPadding={blockPadding}
            listResetToken={listResetToken}
            focusScopeResetToken={focusScopeResetToken}
            dynamicLoading={dynamicTrackedListLoading}
            dynamicInitialRows={dynamicTrackedListInitialRows}
            dynamicRowStep={dynamicTrackedListRowStep}
            dynamicPrefetchDistance={dynamicTrackedListPrefetchDistance}
            dynamicSentinelRootMargin={dynamicTrackedListSentinelRootMargin}
            trackedValidating={false}
            busy={false}
            showAButtonModeTracked={showAButtonModeTracked}
            showRetroPoints={showRetroPoints}
            trackedAchievementAction={trackedAchievementAction}
            reorderTargetId={drillIn.reorderTargetId}
            reorderViaSwap={drillIn.reorderViaSwap}
            onTrackedAchievementActionChange={onTrackedAchievementActionChange}
            onSortChange={drillIn.onSortChange}
            onAchievementClick={drillIn.onAchievementClick}
            onUntrack={drillIn.onUntrack}
            onEditNote={drillIn.onEditNote}
            onReorderPick={drillIn.onReorderPick}
            onReorderMove={drillIn.onReorderMove}
        />
    );
}

export default TrackedPage;
