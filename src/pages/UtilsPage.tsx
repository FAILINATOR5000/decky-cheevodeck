import { PanelSection, PanelSectionRow } from "@decky/ui";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { FocusableItem } from "../components/ui/FocusableItem";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, ViewKey } from "../types";
import { regularButtonSpacingStyle } from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

type UtilsPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
};

type UtilsPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onOpenDolphinMapper: () => void | Promise<void>;
    onOpenSmbShares: () => void | Promise<void>;
    onOpenCheevoCheck: () => void | Promise<void>;
    onOpenFileWatcher: () => void | Promise<void>;
};

type UtilsPageProps = {
    state: UtilsPageState;
    actions: UtilsPageActions;
};

function UtilsPage(props: UtilsPageProps) {
    const { state, actions } = props;

    if (state.view !== "utils") {
        return null;
    }

    return (
        <PanelSection key={`utils:view:${state.focusScopeResetToken}`}>
            <PageNavStrip
                title={t(state.language, "Utilities")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
            />

            <BackButton
                label={t(state.language, "Back")}
                focusKey="utils:back"
                navAutoFocus
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
                    bottomSeparator="none"
                    help={t(state.language, "help_utils_file_watcher")}
                >
                    {t(state.language, "File Watcher")}
                </FocusableItem>
            </PanelSectionRow>
            <BottomFocusAnchor focusKey="utils:bottom:anchor" />
        </PanelSection>
    );
}

export default UtilsPage;
