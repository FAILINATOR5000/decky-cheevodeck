import { PanelSection, PanelSectionRow } from "@decky/ui";
import { LabeledRow } from "../ui/LabeledRow";
import { ReorderStrip } from "../ui/ReorderStrip";
import { TrackedButtonHints } from "./TrackedButtonHints";
import { TrackedEmptyMessage } from "./TrackedEmptyMessage";
import { groupIdsForTrackedTarget, largestTrackedGroupSize, TrackedListBody } from "./TrackedListBody";
import { ErrorText } from "../ui/ErrorText";
import { InfoText } from "../ui/InfoText";
import type { LanguageCode } from "../../locales";
import { localizeRuntimeText, t } from "../../locales";
import type {
    AchievementRow,
    AchievementStyle,
    ButtonSpacing,
    ControllerGlyphStyle,
    Payload,
    ReorderDirection,
    TrackedAchievementAction,
    TrackedAchievementSort,
    TrackedNotes,
    TrackedNotesColor,
    UiSize
} from "../../types";
import {
    nextTrackedAchievementAction,
    nextTrackedAchievementSort,
    trackedAchievementActionLabel,
    trackedAchievementSortLabel
} from "../../utils/achievements";
import { regularButtonSpacingStyle } from "../../utils/style";

type OtherGamesDrillInBodyProps = {
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    payload: Payload | null;
    payloadLoading: boolean;
    payloadError: string | null;
    trackedReady: boolean;
    trackedAchievements: AchievementRow[];
    trackedIds: number[];
    notesByAchievementId: TrackedNotes;
    notesColorByAchievementId: TrackedNotesColor;
    sort: TrackedAchievementSort;
    showIcons: boolean;
    achievementStyle: AchievementStyle;
    uiSize: UiSize;
    topPadding: number;
    blockPadding: number;
    listResetToken: number;
    focusScopeResetToken: number;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    trackedValidating: boolean;
    busy: boolean;
    showAButtonModeTracked: boolean;
    showRetroPoints: boolean;
    trackedAchievementAction: TrackedAchievementAction;
    reorderTargetId: number | null;
    reorderViaSwap?: boolean;
    onTrackedAchievementActionChange: (nextValue: TrackedAchievementAction) => void | Promise<void>;
    onSortChange: (nextSort: TrackedAchievementSort) => void | Promise<void>;
    onAchievementClick: (achievement: AchievementRow, trackedAchievements: AchievementRow[]) => void | Promise<void>;
    onUntrack: (achievement: AchievementRow) => void | Promise<void>;
    onEditNote: (achievement: AchievementRow) => void;
    onReorderPick: (achievementId: number, allowSwap: boolean) => void | Promise<void>;
    onReorderMove: (direction: ReorderDirection, groupIds?: number[] | null) => void | Promise<void>;
};

export function OtherGamesDrillInBody(props: OtherGamesDrillInBodyProps) {
    const {
        language,
        buttonSpacing,
        mouseKeyboardMode,
        controllerGlyphStyle,
        payload,
        payloadLoading,
        payloadError,
        trackedReady,
        trackedAchievements,
        trackedIds,
        notesByAchievementId,
        notesColorByAchievementId,
        sort,
        showIcons,
        achievementStyle,
        uiSize,
        topPadding,
        blockPadding,
        listResetToken,
        focusScopeResetToken,
        dynamicLoading,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        trackedValidating,
        busy,
        showAButtonModeTracked,
        showRetroPoints,
        trackedAchievementAction,
        reorderTargetId,
        reorderViaSwap,
        onTrackedAchievementActionChange,
        onSortChange,
        onAchievementClick,
        onUntrack,
        onEditNote,
        onReorderPick,
        onReorderMove
    } = props;

    const sectionTitle = t(language, "Tracked ({{count}})", { count: trackedAchievements.length });
    const gameTitle = payload?.title?.trim() || "";

    const reorderableSize = largestTrackedGroupSize(trackedAchievements, notesByAchievementId);
    const reorderAvailable = sort === "manual" && reorderableSize >= 2;
    const gamepadRowActions = !mouseKeyboardMode && payload !== null;

    function handleAButtonClick() {
        void onTrackedAchievementActionChange(
            nextTrackedAchievementAction(
                trackedAchievementAction,
                sort,
                reorderableSize
            )
        );
    }

    function handleSortClick() {
        void onSortChange(nextTrackedAchievementSort(sort));
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
        if (trackedValidating || busy) {
            return;
        }
        void onUntrack(achievement);
    }

    function handleRowEditNote(achievement: AchievementRow) {
        if (trackedValidating || busy) {
            return;
        }
        onEditNote(achievement);
    }

    function handleRowReorderPick(achievement: AchievementRow) {
        if (trackedValidating || busy) {
            return;
        }
        void onReorderPick(achievement.id, false);
    }

    function renderBody() {
        if (payloadError) {
            return (
                <PanelSection title={t(language, "Tracked")}>
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, payloadError)}</ErrorText>
                    </PanelSectionRow>
                </PanelSection>
            );
        }

        if (!payload || payloadLoading) {
            return null;
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
                    title={sectionTitle}
                    emptyMessage={
                        <TrackedEmptyMessage
                            language={language}
                            style={controllerGlyphStyle}
                            mouseKeyboardMode={mouseKeyboardMode}
                        />
                    }
                    dynamicLoading={dynamicLoading}
                    dynamicInitialRows={dynamicInitialRows}
                    dynamicRowStep={dynamicRowStep}
                    dynamicPrefetchDistance={dynamicPrefetchDistance}
                    dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                    trackedValidating={trackedValidating}
                    busy={busy}
                    showRetroPoints={showRetroPoints}
                    reorderTargetId={reorderTargetId}
                    reorderViaSwap={reorderViaSwap}
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
            {payload && (
                <PanelSection>
                    {mouseKeyboardMode && payload && showAButtonModeTracked && (
                        <LabeledRow
                            focusKey="tracked:drillin:action-mode"
                            label={t(language, "Click")}
                            value={trackedAchievementActionLabel(trackedAchievementAction, language)}
                            disabled={trackedValidating || busy}
                            onClick={handleAButtonClick}
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                        />
                    )}
                    <LabeledRow
                        focusKey="tracked:drillin:sort"
                        label={t(language, "Sort")}
                        value={
                            trackedReady && !trackedValidating
                                ? trackedAchievementSortLabel(sort, language)
                                : ""
                        }
                        disabled={trackedValidating || busy}
                        onClick={handleSortClick}
                        outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                        bottomSeparator={gamepadRowActions ? "none" : "standard"}
                    />
                    {gamepadRowActions && (
                        <TrackedButtonHints
                            language={language}
                            style={controllerGlyphStyle}
                            reorderAvailable={reorderAvailable}
                        />
                    )}
                </PanelSection>
            )}
            {
}
            {gameTitle && (
                <PanelSectionRow>
                    <div
                        style={{
                            fontWeight: 700,
                            textAlign: "center",
                            padding: "4px 0",
                            marginBottom: "8px"
                        }}
                    >
                        {gameTitle}
                    </div>
                </PanelSectionRow>
            )}
            {renderBody()}
        </>
    );
}
