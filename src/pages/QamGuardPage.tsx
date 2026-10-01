import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { OptionButton, OptionToggle } from "../components/options/OptionRows";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, ViewKey } from "../types";
import { regularButtonSpacingStyle } from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

type QamGuardPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    loading: boolean;
    saving: boolean;
    automaticRecovery: boolean;
    recoveryButtonCombo: boolean;
    recoveryLogs: boolean;
    stormbreaker: boolean;
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
    const { state, actions } = props;

    if (state.view !== "qamGuard") {
        return null;
    }

    const disabled = state.loading || state.saving;
    const buttonOuterStyle = regularButtonSpacingStyle(state.buttonSpacing);

    return (
        <PanelSection key={`qamGuard:view:${state.focusScopeResetToken}`}>
            <PageNavStrip
                title={t(state.language, "Stormbreaker")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
            />

            <BackButton
                label={t(state.language, "Back")}
                focusKey="qamGuard:back"
                navAutoFocus
                buttonSpacing={state.buttonSpacing}
                onClick={actions.onBack}
                scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
            />

            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Stormbreaker")}
                value={state.stormbreaker}
                onChange={actions.onToggleStormbreaker}
                disabled={disabled}
                help={t(state.language, "help_stormbreaker")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Automatic Recovery")}
                value={state.automaticRecovery}
                onChange={actions.onToggleAutomaticRecovery}
                disabled={disabled}
                help={t(state.language, "help_automatic_recovery")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Recovery Button Combo")}
                value={state.recoveryButtonCombo}
                onChange={actions.onToggleRecoveryButtonCombo}
                disabled={disabled}
                help={t(state.language, "help_recovery_button_combo")}
            />
            <OptionToggle
                outerStyle={buttonOuterStyle}
                label={t(state.language, "Save Recovery Logs")}
                value={state.recoveryLogs}
                onChange={actions.onToggleRecoveryLogs}
                disabled={disabled}
                help={t(state.language, "help_recovery_logs")}
            />
            <OptionButton
                outerStyle={buttonOuterStyle}
                focusKey="qamGuard:clear-recovery-logs"
                onClick={actions.onClearRecoveryLogs}
                disabled={disabled}
                label={t(state.language, "Clear Recovery Logs")}
                help={t(state.language, "help_clear_recovery_logs")}
            />
        </PanelSection>
    );
}

export default QamGuardPage;
