import { useEffect, useRef, useState } from "react";
import { PanelSectionRow } from "@decky/ui";
import { ButtonHints } from "../ui/ButtonHints";
import { ErrorText } from "../ui/ErrorText";
import { InlineSpinner } from "../ui/InlineSpinner";
import { LabeledRow } from "../ui/LabeledRow";
import { ClaimedRow } from "./ClaimedRow";
import { useEvents } from "./EventsContext";
import { useFocusClaim } from "../../hooks/useFocusClaim";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type { EventListRow, EventsListView } from "../../types";
import type { EventsFocusReturn } from "../../utils/eventsFocusReturn";
import { smallTextStyle } from "../../utils/style";

const EVENTS_RESTORE_SEED_CEILING = 300;

const FILTER_CLAIM_SLOT = -2;

export const EVENTS_FILTER_FOCUS_KEY = "events:filter";
export const EVENTS_LIST_TOGGLE_FOCUS_KEY = "events:header:list";
export type EventsListProps = {
    language: LanguageCode;
    restore: EventsFocusReturn | null;
    filterValue: string;
    onOpenFilter: () => void;
    onOpenEvent: (row: EventListRow, focusKey: string) => void;
    onRestoreSettled: (abandoned?: boolean) => void;
    onRequestFocus: (focusKey: string) => void;
};

export function EventsListHead(props: {
    language: LanguageCode;
    filterValue: string;
    onOpenFilter: () => void;
    filterClaim: ReturnType<typeof useFocusClaim>;
    clickRow: { value: string; onCycle: () => void } | null;
    hints: { button: "a" | "x" | "y" | "r1" | "l1"; label: string }[];
}) {
    const { settings } = useEvents();
    return (
        <>
            <ClaimedRow claim={props.filterClaim} slotIndex={FILTER_CLAIM_SLOT}>
                <LabeledRow
                    focusKey={EVENTS_FILTER_FOCUS_KEY}
                    bottomSeparator="none"
                    label={t(props.language, "Filter")}
                    value={props.filterValue}
                    onClick={props.onOpenFilter}
                />
            </ClaimedRow>
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

export function useEventsRestore(options: {
    restore: EventsFocusReturn | null;
    listView: EventsListView;
    ready: boolean;
    ids: number[] | null;
    rowStep: number;
    rowKeyPrefix: string;
    rowClaim: ReturnType<typeof useFocusClaim>;
    filterClaim: ReturnType<typeof useFocusClaim>;
    onSettled: (abandoned?: boolean) => void;
    onRequestFocus: (focusKey: string) => void;
}): number | undefined {
    const { state } = useEvents();
    const { restore, listView, ready, ids, rowStep, rowKeyPrefix, rowClaim, filterClaim, onSettled, onRequestFocus } = options;
    const firedRef = useRef(false);
    const settledRef = useRef(false);
    const [seed, setSeed] = useState<number | undefined>(undefined);
    const ownClaim = restore?.eventGameId === null ? filterClaim : rowClaim;

    function settle(abandoned?: boolean) {
        if (!settledRef.current) {
            settledRef.current = true;
            onSettled(abandoned);
        }
    }

    useEffect(function landRestoredCursor() {
        if (restore === null || firedRef.current || !ready || ids === null) {
            return;
        }
        firedRef.current = true;
        if (restore.listView !== listView) {
            onRequestFocus(EVENTS_LIST_TOGGLE_FOCUS_KEY);
            settle();
            return;
        }
        if (restore.eventGameId === null) {
            filterClaim.claimSlot(FILTER_CLAIM_SLOT);
            onRequestFocus(restore.focusKey);
            return;
        }
        const index = restore.ulid === state.owner ? ids.indexOf(restore.eventGameId) : -1;
        if (index < 0 || index >= EVENTS_RESTORE_SEED_CEILING) {
            onRequestFocus("social:back");
            settle(true);
            return;
        }
        setSeed(index + 1 + rowStep);
        rowClaim.claimSlot(index);
        onRequestFocus(`${rowKeyPrefix}${restore.eventGameId}`);
    }, [restore, ready, ids]);

    const spent = firedRef.current && (ownClaim.claim?.token ?? 0) > 0 && !ownClaim.claim?.armed;
    useEffect(() => {
        if (spent) {
            settle();
            setSeed(undefined);
        }
    }, [spent]);

    return seed;
}
