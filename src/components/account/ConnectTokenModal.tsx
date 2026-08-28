import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";
import { ErrorText } from "../ui/ErrorText";
import { ToggleRow } from "../ui/ToggleRow";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import { getErrorMessage, logError } from "../../utils/errors";
import { modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

export type ConnectTokenModalProps = {
    language: LanguageCode;
    username: string;
    initialHardcore: boolean;
    hasToken: boolean;
    onGenerate: (password: string, hardcore: boolean) => Promise<void>;
    onClear: () => Promise<void>;
    close: () => void;
};

export function ConnectTokenModal(props: ConnectTokenModalProps) {
    const { language, username, initialHardcore, hasToken, onGenerate, onClear, close } = props;

    const [password, setPassword] = useState("");
    const [hardcore, setHardcore] = useState(initialHardcore);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tokenSaved, setTokenSaved] = useState(hasToken);

    const canGenerate = !saving && Boolean(password.trim());

    async function handleGenerate() {
        if (!canGenerate) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onGenerate(password, hardcore);
        } catch (e: any) {
            logError("ConnectTokenModal handleGenerate", e);
            setError(getErrorMessage(e, t(language, "Could not reach RetroAchievements. Please try again.")));
            setSaving(false);
        }
    }

    async function handleClear() {
        if (saving) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onClear();
            setTokenSaved(false);
            setSaving(false);
        } catch (e: any) {
            logError("ConnectTokenModal handleClear", e);
            setError(getErrorMessage(e, t(language, "Could not reach RetroAchievements. Please try again.")));
            setSaving(false);
        }
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={canGenerate}
                label={t(language, "Generate Token")}
                onSave={handleGenerate}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Emulator Login Sync")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div
                        style={{
                            fontSize: `${modalSize(15)}px`,
                            fontWeight: 700,
                            wordBreak: "break-word"
                        }}
                    >
                        {username}
                    </div>
                    <TextField
                        label={t(language, "RetroAchievements Password")}
                        value={password}
                        onChange={(e: any) => setPassword(e?.target?.value ?? "")}
                        disabled={saving}
                    />
                    <ToggleRow
                        label={t(language, "Hardcore Mode")}
                        value={hardcore}
                        onChange={setHardcore}
                        disabled={saving}
                        bottomSeparator="none"
                    />
                    <div style={{ ...modalBodyStyle() }}>
                        {t(language, "Your RetroAchievements password is used once to create the token and is never saved.")}
                    </div>
                    {error && (
                        <ErrorText>
                            {localizeRuntimeText(language, error)}
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
                    <DialogButton onClick={close} disabled={saving}>
                        {t(language, "Cancel")}
                    </DialogButton>
                    {tokenSaved && (
                        <DialogButton onClick={handleClear} disabled={saving}>
                            {t(language, "Remove Saved Login")}
                        </DialogButton>
                    )}
                    <DialogButton onClick={handleGenerate} disabled={!canGenerate}>
                        {saving ? t(language, "Generating...") : t(language, "Generate Token")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}
