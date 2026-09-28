import { createContext, useContext, type ReactNode } from "react";
import { saveEventsClickAction, saveTrackedEventsClickAction } from "../../api";
import { useEventsController } from "../../hooks/useEventsController";
import type { SettingsController } from "../../hooks/useSettingsController";
import type { EventsClickAction, TrackedEventsClickAction } from "../../types";

type Events = ReturnType<typeof useEventsController> & {
    settings: ReturnType<typeof eventsSettings>;
};

const EventsContext = createContext<Events | null>(null);

function eventsSettings(controller: SettingsController) {
    const { state, actions } = controller;
    return {
        activeUlid: state.activeUlid,
        mouseKeyboardMode: state.mouseKeyboardMode,
        controllerGlyphStyle: state.controllerGlyphStyle,
        showIcons: state.showIcons,
        uiSize: state.uiSize,
        buttonSpacing: state.buttonSpacing,
        trackedColor: state.trackedColor,
        defaultNoteColor: state.defaultNoteColor,
        setDefaultNoteColor: actions.setDefaultNoteColor,
        dynamicLoading: state.dynamicLoading,
        dynamicInitialRows: state.dynamicInitialRows,
        dynamicRowStep: state.dynamicRowStep,
        dynamicPrefetchDistance: state.dynamicPrefetchDistance,
        dynamicSentinelRootMargin: state.dynamicSentinelRootMargin,
        blockPadding: state.blockPadding,
        achievementStyle: state.achievementStyle,
        showRetroPoints: state.showRetroPoints,
        dynamicComments: state.dynamicComments,
        dynamicCommentsInitialRows: state.dynamicCommentsInitialRows,
        dynamicCommentsRowStep: state.dynamicCommentsRowStep,
        dynamicCommentsSentinelRootMargin: state.dynamicCommentsSentinelRootMargin,
        legacyCommentsLoading: state.legacyCommentsLoading,
        showClickRow: state.showAButtonModeEvents,
        clickAction: state.eventsClickAction,
        trackedClickAction: state.trackedEventsClickAction,

        saveClickAction: (nextValue: EventsClickAction) =>
            actions.saveSettingWithRollback<EventsClickAction>({
                nextValue,
                previousValue: state.eventsClickAction,
                applyValue: actions.setEventsClickAction,
                saveCall: saveEventsClickAction,
                getSavedValue: (result, fallbackValue) => result.eventsClickAction ?? fallbackValue
            }),

        saveTrackedClickAction: (nextValue: TrackedEventsClickAction) =>
            actions.saveSettingWithRollback<TrackedEventsClickAction>({
                nextValue,
                previousValue: state.trackedEventsClickAction,
                applyValue: actions.setTrackedEventsClickAction,
                saveCall: saveTrackedEventsClickAction,
                getSavedValue: (result, fallbackValue) => result.trackedEventsClickAction ?? fallbackValue
            })
    };
}

export function EventsProvider(props: {
    isActive: boolean;
    settings: SettingsController;
    children: ReactNode;
}) {
    const controller = useEventsController({
        isActive: props.isActive,
        activeUlid: props.settings.state.activeUlid
    });
    const value = { ...controller, settings: eventsSettings(props.settings) };
    return <EventsContext.Provider value={value}>{props.children}</EventsContext.Provider>;
}

export function useEvents(): Events {
    return useContext(EventsContext)!;
}
