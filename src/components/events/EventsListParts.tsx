import { useEffect, useState, type MutableRefObject } from "react";
import { PanelSectionRow } from "@decky/ui";
import { ButtonHints } from "../ui/ButtonHints";
import { ErrorText } from "../ui/ErrorText";
import { InlineSpinner } from "../ui/InlineSpinner";
import { LabeledRow } from "../ui/LabeledRow";
import { useEvents } from "./EventsContext";
import type { LandingWindows } from "../../focusRecords";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type { EventListRow } from "../../types";
import { smallTextStyle } from "../../utils/style";

export const EVENTS_FILTER_FOCUS_KEY = "events:filter";
export const EVENTS_LIST_TOGGLE_FOCUS_KEY = "events:header:list";
export type EventsListProps = {
    language: LanguageCode;
    filterValue: string;
    onOpenFilter: () => void;
    onOpenEvent: (row: EventListRow) => void;
    onRequestFocus: (focusKey: string) => void;
    landingWindowsRef: MutableRefObject<LandingWindows | null>;
};

export function EventsListHead(props: {
    language: LanguageCode;
    filterValue: string;
    onOpenFilter: () => void;
    clickRow: { value: string; onCycle: () => void } | null;
    hints: { button: "a" | "x" | "y" | "r1" | "l1"; label: string }[];
}) {
    const { settings } = useEvents();
    return (
        <>
            <LabeledRow
                focusKey={EVENTS_FILTER_FOCUS_KEY}
                bottomSeparator="none"
                label={t(props.language, "Filter")}
                value={props.filterValue}
                onClick={props.onOpenFilter}
            />
            {settings.mouseKeyboardMode ? (
                props.clickRow && (
                    <LabeledRow
                        focusKey="events:click"
                        bottomSeparator="none"
                        label={t(props.language, "Click")}
                        value={props.clickRow.value}
                        onClick={props.clickRow.onCycle}
                    />
                )
            ) : (
                <PanelSectionRow>
                    <ButtonHints style={settings.controllerGlyphStyle} hints={props.hints} />
                </PanelSectionRow>
            )}
        </>
    );
}

const SPINNER_DELAY_MS = 500;

export function EventsListStatus(props: { language: LanguageCode; empty: boolean; emptyText: string }) {
    const { state } = useEvents();
    const { language } = props;
    const waiting = state.events === null;
    const [spinnerDue, setSpinnerDue] = useState(false);
    useEffect(() => {
        if (!waiting) {
            setSpinnerDue(false);
            return;
        }
        const timer = window.setTimeout(() => setSpinnerDue(true), SPINNER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [waiting]);
    if (state.events === null) {
        if (state.error) {
            return (
                <PanelSectionRow>
                    <ErrorText>{localizeRuntimeText(language, state.error)}</ErrorText>
                </PanelSectionRow>
            );
        }
        if (state.needsSettings) {
            return (
                <PanelSectionRow>
                    <ErrorText>{t(language, "Please enter your RetroAchievements username and Web API key.")}</ErrorText>
                </PanelSectionRow>
            );
        }
        if (!spinnerDue) {
            return null;
        }
        return (
            <PanelSectionRow>
                <InlineSpinner label={t(language, "Loading...")} />
            </PanelSectionRow>
        );
    }
    return (
        <>
            {state.error && (
                <PanelSectionRow>
                    <ErrorText>{localizeRuntimeText(language, state.error)}</ErrorText>
                </PanelSectionRow>
            )}
            {props.empty && (
                <PanelSectionRow>
                    <div style={{ ...smallTextStyle(), width: "100%", textAlign: "center", padding: "8px 0" }}>
                        {props.emptyText}
                    </div>
                </PanelSectionRow>
            )}
        </>
    );
}
