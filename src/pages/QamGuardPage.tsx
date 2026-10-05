import { useCallback, useRef, useState } from "react";
import { Focusable, PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { ConfirmRow } from "../components/ui/ConfirmRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { SubTabButton } from "../components/ui/SubTabButton";
import { OptionButton, OptionToggle } from "../components/options/OptionRows";
import { InfoText } from "../components/ui/InfoText";
import { IncidentCard } from "../components/stormbreaker/IncidentCard";
import { ProtectionStatus, protectionLevel } from "../components/stormbreaker/ProtectionStatus";
import { useStormbreakerLogController } from "../hooks/useStormbreakerLogController";
import { useWindowedList } from "../hooks/useWindowedList";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, FreezeIncident, ViewKey } from "../types";
import { regularButtonSpacingStyle } from "../utils/style";
import { standaloneClaim } from "../utils/stormbreaker";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

type QamGuardTab = "status" | "logs";

const TABS: { value: QamGuardTab; labelKey: string; focusKey: string }[] = [
    { value: "status", labelKey: "Status", focusKey: "qamGuard:tab:status" },
    { value: "logs", labelKey: "Logs", focusKey: "qamGuard:tab:logs" }
];

let openTab: QamGuardTab = "status";

export function openStormbreakerOnStatus(): void {
    openTab = "status";
}

type QamGuardPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    loading: boolean;
    saving: boolean;
    automaticRecovery: boolean;
    recoveryButtonCombo: boolean;
    recoveryLogs: boolean;
    stormbreaker: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
};

type QamGuardPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onToggleAutomaticRecovery: (nextValue: boolean) => void | Promise<void>;
    onToggleRecoveryButtonCombo: (nextValue: boolean) => void | Promise<void>;
    onToggleRecoveryLogs: (nextValue: boolean) => void | Promise<void>;
    onToggleStormbreaker: (nextValue: boolean) => void | Promise<void>;
    onClearRecoveryLogs: () => void | Promise<void>;
};

type QamGuardPageProps = {
    state: QamGuardPageState;
    actions: QamGuardPageActions;
};

function QamGuardPage(props: QamGuardPageProps) {
    if (props.state.view !== "qamGuard") {
        return null;
    }
    return <QamGuardView state={props.state} actions={props.actions} />;
}

function QamGuardView(props: QamGuardPageProps) {
    const { state, actions } = props;
    const { language } = state;
    const [tab, setTab] = useState<QamGuardTab>(openTab);
    const log = useStormbreakerLogController({ isActive: state.view === "qamGuard" });
    const { totals, entries, standingDown, loaded } = log.state;

    function changeTab(next: QamGuardTab) {
        openTab = next;
        setTab(next);
    }

    const disabled = state.loading || state.saving;
    const buttonOuterStyle = regularButtonSpacingStyle(state.buttonSpacing);
    const claim = standaloneClaim();

    const statusBody = (
        <>
            <ProtectionStatus
                language={language}
                level={protectionLevel({
                    stormbreaker: state.stormbreaker,
                    automaticRecovery: state.automaticRecovery,
                    standingDown,
                    claimStormbreaker: claim?.stormbreaker === true,
                    claimAutomaticRecovery: claim?.automaticRecovery === true
                })}
                totals={totals}
                standingDown={standingDown}
                loaded={loaded}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(language, "Stormbreaker")}
                value={state.stormbreaker}
                onChange={actions.onToggleStormbreaker}
                disabled={disabled}
                help={t(language, "help_stormbreaker")}
            />
            {claim?.stormbreaker && (
                <PanelSectionRow>
                    <InfoText>{t(language, "Handled by the Stormbreaker plugin")}</InfoText>
                </PanelSectionRow>
            )}
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(language, "Automatic Recovery")}
                value={state.automaticRecovery}
                onChange={actions.onToggleAutomaticRecovery}
                disabled={disabled}
                help={t(language, "help_automatic_recovery")}
            />
            {claim?.automaticRecovery && (
                <PanelSectionRow>
                    <InfoText>{t(language, "Handled by the Stormbreaker plugin")}</InfoText>
                </PanelSectionRow>
            )}
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(language, "Recovery Button Combo")}
                value={state.recoveryButtonCombo}
                onChange={actions.onToggleRecoveryButtonCombo}
                disabled={disabled}
                help={t(language, "help_recovery_button_combo")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(language, "Save Recovery Logs")}
                value={state.recoveryLogs}
                onChange={actions.onToggleRecoveryLogs}
                disabled={disabled}
                help={t(language, "help_recovery_logs")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="qamGuard:clear-recovery-logs"
                onClick={actions.onClearRecoveryLogs}
                disabled={disabled}
                label={t(language, "Clear Recovery Logs")}
                help={t(language, "help_clear_recovery_logs")}
            />
        </>
    );

    return (
        <PanelSection key="qamGuard:view">
            <PageNavStrip
                title={t(language, "Stormbreaker")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
            />

            <BackButton
                label={t(language, "Back")}
                focusKey="qamGuard:back"
                navAutoFocus
                buttonSpacing={state.buttonSpacing}
                onClick={actions.onBack}
                scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
            />

            <Focusable
                flow-children="row"
                style={{ width: "100%", display: "flex", gap: "6px", margin: "6px 0 4px 0" }}
            >
                {TABS.map((entry) => (
                    <SubTabButton
                        key={entry.value}
                        label={t(language, entry.labelKey)}
                        active={tab === entry.value}
                        onClick={() => changeTab(entry.value)}
                        focusKey={entry.focusKey}
                    />
                ))}
            </Focusable>

            <Focusable key={`qamGuard:tab:${tab}`}>
                {tab === "status" ? statusBody : (
                    <IncidentLog
                        state={state}
                        entries={entries}
                        loaded={loaded}
                        onClearLog={log.actions.onClearLog}
                    />
                )}
            </Focusable>
        </PanelSection>
    );
}

function IncidentLog(props: {
    state: QamGuardPageState;
    entries: FreezeIncident[];
    loaded: boolean;
    onClearLog: () => void | Promise<void>;
}) {
    const { state, entries } = props;
    const { language } = state;
    const { mountedItems, markerRef, onItemFocus } = useWindowedList({
        items: entries,
        dynamicLoading: true,
        initialRows: state.dynamicInitialRows,
        rowStep: state.dynamicRowStep,
        prefetchDistance: state.dynamicPrefetchDistance,
        sentinelRootMargin: `${state.dynamicSentinelRootMargin}px 0px`,
        resetKey: "qamGuard:log"
    });
    const itemFocusRef = useRef(onItemFocus);
    itemFocusRef.current = onItemFocus;
    const onCardFocus = useCallback((index: number) => itemFocusRef.current(index), []);

    return (
        <>
            {props.loaded && entries.length === 0 && (
                <PanelSectionRow>
                    <InfoText>{t(language, "No incidents yet.")}</InfoText>
                </PanelSectionRow>
            )}
            {mountedItems.map((incident, index) => (
                <IncidentCard
                    key={incident.id}
                    incident={incident}
                    language={language}
                    index={index}
                    onCardFocus={onCardFocus}
                />
            ))}
            {mountedItems.length < entries.length && (
                <div ref={markerRef} style={{ height: "1px" }} />
            )}
            <ConfirmRow
                focusKey="qamGuard:clear-log"
                idleLabel={t(language, "Clear Log")}
                armedLabel={t(language, "Press again to clear")}
                disabled={entries.length === 0}
                onConfirm={props.onClearLog}
                buttonSpacing={state.buttonSpacing}
                help={t(language, "help_clear_incident_log")}
            />
        </>
    );
}

export default QamGuardPage;
