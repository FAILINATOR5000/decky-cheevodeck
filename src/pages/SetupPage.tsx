import { PanelSection, PanelSectionRow } from "@decky/ui";
import { ErrorText } from "../components/ui/ErrorText";
import { FocusableItem } from "../components/ui/FocusableItem";
import type { LanguageCode } from "../locales";
import type { ButtonSpacing } from "../types";
import { localizeRuntimeText, t } from "../locales";
import { regularButtonSpacingStyle } from "../utils/style";

type SetupPageProps = {
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    hasApiKey: boolean;
    saving: boolean;
    error: string | null;
    onEditCredentials: () => void;
    onClearApiKey: () => void | Promise<void>;
};

function SetupPage(props: SetupPageProps) {
    const {
        language,
        buttonSpacing,
        hasApiKey,
        saving,
        error,
        onEditCredentials,
        onClearApiKey
    } = props;

    return (
        <PanelSection title={t(language, "CheevoDeck Setup")}>
            <PanelSectionRow>
                <FocusableItem
                    focusKey="setup:edit"
                    onClick={onEditCredentials}
                    disabled={saving}
                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                >
                    {hasApiKey ? t(language, "Edit Credentials") : t(language, "Enter Credentials")}
                </FocusableItem>
            </PanelSectionRow>
            {hasApiKey && (
                <PanelSectionRow>
                    <FocusableItem
                        focusKey="setup:clear"
                        onClick={onClearApiKey}
                        disabled={saving}
                        outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                    >
                        {t(language, "Clear Saved API Key")}
                    </FocusableItem>
                </PanelSectionRow>
            )}
            {error && (
                <PanelSectionRow>
                    <ErrorText>
                        {localizeRuntimeText(language, error)}
                    </ErrorText>
                </PanelSectionRow>
            )}
        </PanelSection>
    );
}

export default SetupPage;
