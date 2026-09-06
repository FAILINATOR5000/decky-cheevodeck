import { PanelSection, PanelSectionRow } from "@decky/ui";
import { ErrorText } from "../components/ui/ErrorText";
import { FocusableItem } from "../components/ui/FocusableItem";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { OptionToggle, OptionValueRow } from "../components/options/OptionRows";
import type { LanguageCode } from "../locales";
import type { ButtonSpacing } from "../types";
import { LANGUAGES, localizeRuntimeText, t } from "../locales";
import { openExternalUrl } from "../utils/navigation";
import { bodyTextStyle, regularButtonSpacingStyle, warnAmber } from "../utils/style";

const GETTING_STARTED_URL = "https://github.com/FAILINATOR5000/decky-cheevodeck#getting-started";

type SetupPageProps = {
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    hasApiKey: boolean;
    saving: boolean;
    error: string | null;
    onEditCredentials: () => void;
    onOpenLanguage: () => void | Promise<void>;
    onClearApiKey: () => void | Promise<void>;
    putUpdaterOnDesktop: boolean;
    onTogglePutUpdaterOnDesktop: (nextValue: boolean) => void | Promise<void>;
    libraryBadge: boolean;
    onToggleLibraryBadge: (nextValue: boolean) => void | Promise<void>;
};

function SetupPage(props: SetupPageProps) {
    const {
        language,
        buttonSpacing,
        hasApiKey,
        saving,
        error,
        onEditCredentials,
        onOpenLanguage,
        onClearApiKey,
        putUpdaterOnDesktop,
        onTogglePutUpdaterOnDesktop,
        libraryBadge,
        onToggleLibraryBadge
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
            <PanelSectionRow>
                <FocusableItem
                    focusKey="setup:getting-started"
                    onClick={() => { void openExternalUrl(GETTING_STARTED_URL); }}
                    disabled={saving}
                    bottomSeparator="none"
                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                >
                    {t(language, "Getting Started")}
                </FocusableItem>
            </PanelSectionRow>
            <OptionValueRow
                outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                focusKey="setup:language"
                onClick={onOpenLanguage}
                disabled={saving}
                label={t(language, "Language")}
                value={LANGUAGES[language]?.label ?? language}
                help={t(language, "help_language")}
            />
            <OptionToggle
                outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                label={t(language, "Add Updater to Desktop")}
                value={putUpdaterOnDesktop}
                onChange={onTogglePutUpdaterOnDesktop}
                disabled={saving}
                help={t(language, "Puts a launcher on your Desktop. Run it from Desktop Mode and it installs the newest version for you.")}
            />
            <OptionToggle
                outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                label={t(language, "Steam Library Badges")}
                value={libraryBadge}
                onChange={onToggleLibraryBadge}
                disabled={saving}
                help={t(language, "help_library_badge")}
            />
            {libraryBadge && (
                <PanelSectionRow>
                    <div
                        style={{
                            ...bodyTextStyle(),
                            color: warnAmber,
                            opacity: 1,
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px"
                        }}
                    >
                        <div>
                            {t(language, "Don't forget to run a Cheevo Check Scan to map your pages to your supported games here:")}
                        </div>
                        <div style={{ fontWeight: 700 }}>
                            {t(language, "Quick Menu → Cheevo Check → Scan")}
                        </div>
                    </div>
                </PanelSectionRow>
            )}
            {hasApiKey && (
                <PanelSectionRow>
                    <FocusableItem
                        focusKey="setup:clear"
                        onClick={onClearApiKey}
                        disabled={saving}
                        bottomSeparator="none"
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

            {
}
            <BottomFocusAnchor focusKey="setup:bottom:anchor" />
        </PanelSection>
    );
}

export default SetupPage;
