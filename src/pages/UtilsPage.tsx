import { PanelSectionRow } from "@decky/ui";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { openBrowserModal } from "../components/browser/BrowserModal";
import { openCalculatorModal } from "../components/calculator/CalculatorModal";
import { FocusableItem } from "../components/ui/FocusableItem";
import { FocusClaim } from "../components/ui/FocusClaim";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { logFocusDebug } from "../api";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, ViewKey } from "../types";
import { armUtilsFocusKey } from "../utils/utilsFocusReturn";
import { regularButtonSpacingStyle } from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

type UtilsPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    restoreFocusKey: string | null;
    restorePending: boolean;
    panelOverlayVisible: boolean;
};

type UtilsPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onOpenDolphinMapper: () => void | Promise<void>;
    onOpenSmbShares: () => void | Promise<void>;
    onOpenCheevoCheck: () => void | Promise<void>;
    onOpenFileWatcher: () => void | Promise<void>;
    onOpenMemories: () => void | Promise<void>;
    onOpenMemoriesTransfer: () => void | Promise<void>;
    onRequestFocus: (focusKey: string) => void;
};

type UtilsPageProps = {
    state: UtilsPageState;
    actions: UtilsPageActions;
};

function UtilsPage(props: UtilsPageProps) {
    const { state, actions } = props;

    const { restoreFocusKey, restorePending } = state;
    const restoreClaim = useFocusClaim();
    const restoreFiredRef = useRef(false);
    const claimedKeyRef = useRef<string | null>(null);
    const [restoreAbandoned, setRestoreAbandoned] = useState(false);

    useEffect(function landRestoredCursor() {
        if (state.view !== "utils" || !restorePending || restoreFiredRef.current) {
            return;
        }
        restoreFiredRef.current = true;
        if (restoreFocusKey === null) {
            setRestoreAbandoned(true);
            logFocusDebug("utils-restore", "(none)", "nothing armed");
            actions.onRequestFocus("utils:back");
            return;
        }
        logFocusDebug("utils-restore", restoreFocusKey, "claiming");
        claimedKeyRef.current = restoreFocusKey;
        restoreClaim.claimSlot(0);
        actions.onRequestFocus(restoreFocusKey);
    }, [state.view, restorePending, restoreFocusKey, restoreClaim.claimSlot, actions.onRequestFocus]);

    const restoreSettled = restoreAbandoned
        || (restoreClaim.claim?.token ?? 0) > 0 && !restoreClaim.claim?.armed;

    function claimTarget(control: ReactElement<{ focusKey?: string }>): ReactNode {
        const claim = restoreClaim.claim;
        if (!claim || control.props.focusKey !== claimedKeyRef.current) {
            return control;
        }
        return (
            <FocusClaim token={claim.token} armed={claim.armed} onSpent={restoreClaim.spend}>
                {control}
            </FocusClaim>
        );
    }

    if (state.view !== "utils") {
        return null;
    }

    const page = (
        <PanelSection key={`utils:view:${state.focusScopeResetToken}`}>
            <PageNavStrip
                title={t(state.language, "Utilities")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
            />

            <BackButton
                label={t(state.language, "Back")}
                focusKey="utils:back"
                navAutoFocus={!restorePending}
                buttonSpacing={state.buttonSpacing}
                onClick={actions.onBack}
                scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
            />

            <PanelSectionRow>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey="utils:dolphin-mapper"
                    onClick={actions.onOpenDolphinMapper}
                    help={t(state.language, "help_utils_dolphin_mapper")}
                >
                    {t(state.language, "Dolphin Mapper")}
                </FocusableItem>
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey="utils:smb-shares"
                    onClick={actions.onOpenSmbShares}
                    help={t(state.language, "help_utils_smb_shares")}
                >
                    {t(state.language, "SMB Shares")}
                </FocusableItem>
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey="utils:cheevo-check"
                    onClick={actions.onOpenCheevoCheck}
                    help={t(state.language, "help_utils_cheevo_check")}
                >
                    {t(state.language, "Cheevo Check")}
                </FocusableItem>
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey="utils:file-watcher"
                    onClick={actions.onOpenFileWatcher}
                    help={t(state.language, "help_utils_file_watcher")}
                >
                    {t(state.language, "File Watcher")}
                </FocusableItem>
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey="utils:memories"
                    onClick={actions.onOpenMemories}
                    help={t(state.language, "help_utils_memories")}
                >
                    {t(state.language, "Memories")}
                </FocusableItem>
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey="utils:memories-transfer"
                    onClick={actions.onOpenMemoriesTransfer}
                    help={t(state.language, "help_utils_memories_transfer")}
                >
                    {t(state.language, "Transfer Memories")}
                </FocusableItem>
            </PanelSectionRow>
            <PanelSectionRow>
                {claimTarget(
                    <FocusableItem
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey="utils:calculator"
                        onClick={() => {
                            armUtilsFocusKey("utils:calculator");
                            openCalculatorModal(state.language);
                        }}
                        help={t(state.language, "help_utils_calculator")}
                    >
                        {t(state.language, "Calculator")}
                    </FocusableItem>
                )}
            </PanelSectionRow>
            <PanelSectionRow>
                {claimTarget(
                    <FocusableItem
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey="utils:browser"
                        onClick={() => {
                            armUtilsFocusKey("utils:browser");
                            openBrowserModal(state.language);
                        }}
                        bottomSeparator="none"
                        help={t(state.language, "help_utils_browser")}
                    >
                        {t(state.language, "Web Browser")}
                    </FocusableItem>
                )}
            </PanelSectionRow>
            <BottomFocusAnchor focusKey="utils:bottom:anchor" />
        </PanelSection>
    );

    return (
        <RestoreCurtain
            armed={state.restorePending}
            settled={restoreSettled}
            covered={state.panelOverlayVisible}
        >
            {page}
        </RestoreCurtain>
    );
}

export default UtilsPage;
