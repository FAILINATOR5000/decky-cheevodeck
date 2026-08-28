import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";
import { ErrorText } from "../ui/ErrorText";
import { ExternalLink } from "../ui/ExternalLink";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import { getErrorMessage, logError } from "../../utils/errors";
import { modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import type { SwitchUserOutcome } from "./SwitchUserModal";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const RA_API_KEY_URL = "https://retroachievements.org/controlpanel.php";

export type AddUserModalProps = {
    language: LanguageCode;
    addUser: (username: string, apiKey: string) => Promise<void>;
    switchUser: (username: string) => Promise<SwitchUserOutcome>;
    close: () => void;
    onBeforeNavigate?: () => void;
};

export function AddUserModal(props: AddUserModalProps) {
    const { language, addUser, switchUser, close, onBeforeNavigate } = props;

    const [modalUsername, setModalUsername] = useState("");
    const [modalApiKey, setModalApiKey] = useState("");
    const [modalSaving, setModalSaving] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);

    const canSave =
        !modalSaving && Boolean(modalUsername.trim()) && Boolean(modalApiKey.trim());

    async function handleSave() {
        if (!canSave) {
            return;
        }
        setModalSaving(true);
        setModalError(null);

        try {
            await addUser(modalUsername, modalApiKey);
        } catch (e: any) {
            logError("AddUserModal handleSave", e);
            setModalError(getErrorMessage(e, t(language, "Invalid RetroAchievements username or Web API key. Please try again.")));
            setModalSaving(false);
            return;
        }

        try {
            const outcome = await switchUser(modalUsername.trim());
            if (outcome === "switched") {
                close();
                return;
            }
            setModalError(t(language, "Added the account, but couldn't switch to it. Open Switch User to finish."));
            setModalSaving(false);
        } catch (e: any) {
            logError("AddUserModal handleSave switch", e);
            setModalError(t(language, "Added the account, but couldn't switch to it. Open Switch User to finish."));
            setModalSaving(false);
        }
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={canSave}
                label={t(language, "Add User")}
                onSave={handleSave}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Add User")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <TextField
                        label={t(language, "Username")}
                        value={modalUsername}
                        onChange={(e: any) => setModalUsername(e?.target?.value ?? "")}
                        disabled={modalSaving}
                    />
                    <TextField
                        label={t(language, "Web API Key")}
                        value={modalApiKey}
                        onChange={(e: any) => setModalApiKey(e?.target?.value ?? "")}
                        disabled={modalSaving}
                    />
                    <div style={{ ...modalBodyStyle() }}>
                        <ExternalLink url={RA_API_KEY_URL} onBeforeNavigate={onBeforeNavigate ?? close}>
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
                    <DialogButton onClick={close} disabled={modalSaving}>
                        {t(language, "Cancel")}
                    </DialogButton>
                    <DialogButton onClick={handleSave} disabled={!canSave}>
                        {modalSaving ? t(language, "Saving...") : t(language, "Add User")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}
