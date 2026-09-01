import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";
import { ErrorText } from "../ui/ErrorText";
import { ExternalLink } from "../ui/ExternalLink";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import { getErrorMessage, logError } from "../../utils/errors";
import { modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const RA_API_KEY_URL = "https://retroachievements.org/controlpanel.php";

type PersistSettingsResult =
    | { ok: true; showWelcome: boolean; username: string }
    | { ok: false; error: string };

export type CredentialsModalProps = {
    username: string;
    hasApiKey: boolean;
    language: LanguageCode;
    persistSettings: (nextUsername: string, nextApiKey: string) => Promise<PersistSettingsResult>;
    onShowWelcome: (userName: string) => void;
    close: () => void;
};

export function CredentialsModal(props: CredentialsModalProps) {
    const { username, hasApiKey, language, persistSettings, onShowWelcome, close } = props;

    const [modalUsername, setModalUsername] = useState(username);
    const [modalApiKey, setModalApiKey] = useState("");
    const [modalSaving, setModalSaving] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);

    const canSave =
        !modalSaving && Boolean(modalUsername.trim()) && (hasApiKey || Boolean(modalApiKey.trim()));

    async function handleSave() {
        if (!canSave) {
            return;
        }
        setModalSaving(true);
        setModalError(null);
        try {
            const result = await persistSettings(modalUsername, modalApiKey);
            if (result.ok) {
                if (result.showWelcome) {
                    onShowWelcome(result.username);
                }
                close();
                return;
            }
            setModalError(result.error);
        } catch (e: any) {
            logError("CredentialsModal handleSave", e);
            setModalError(getErrorMessage(e, t(language, "Invalid RetroAchievements username or Web API key. Please try again.")));
        } finally {
            setModalSaving(false);
        }
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={canSave}
                label={t(language, "Save")}
                onSave={handleSave}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "RetroAchievements Credentials")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <TextField
                        label={t(language, "Username")}
                        value={modalUsername}
                        onChange={(e: any) => setModalUsername(e?.target?.value ?? "")}
                        disabled={modalSaving}
                    />
                    <TextField
                        label={
                            hasApiKey
                                ? t(language, "Web API Key (leave blank to keep current)")
                                : t(language, "Web API Key")
                        }
                        value={modalApiKey}
                        onChange={(e: any) => setModalApiKey(e?.target?.value ?? "")}
                        disabled={modalSaving}
                    />
                    <div style={{ ...modalBodyStyle() }}>
                        <ExternalLink url={RA_API_KEY_URL} onBeforeNavigate={close}>
                            {t(language, "Find your Web API Key on RetroAchievements")}
                        </ExternalLink>
                    </div>
                    {modalError && (
                        <ErrorText>
                            {localizeRuntimeText(language, modalError)}
                        </ErrorText>
                    )}
                </div>
                <Focusable
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "8px",
                        marginTop: "16px"
                    }}
                    flow-children="row"
                >
                    <DialogButton onClick={handleSave} disabled={!canSave}>
                        {modalSaving ? t(language, "Saving...") : t(language, "Save")}
                    </DialogButton>
                    <DialogButton onClick={close} disabled={modalSaving}>
                        {t(language, "Cancel")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}
