import { DialogButton, Field, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState, type ReactNode } from "react";
import { ErrorText } from "../ui/ErrorText";
import { InfoText, helpDescription } from "../ui/InfoText";
import { FocusableItem } from "../ui/FocusableItem";
import { t, type LanguageCode } from "../../locales";
import type { SmbShare, SmbSharePayload, SmbVersion } from "../../types";
import { nextSmbVersion, smbErrorLabel, smbServerRejectionLabel, smbVersionLabel } from "../../utils/smb";
import { achievementGreen, compactButtonStyle, modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

type SaveResult = { ok: boolean; error?: string; field?: string; shares?: string[] };

export type SmbShareEditModalProps = {
    existing: SmbShare | null;
    language: LanguageCode;
    onCreate: (payload: SmbSharePayload) => Promise<SaveResult>;
    onUpdate: (id: string, payload: SmbSharePayload) => Promise<SaveResult>;
    onTest: (payload: SmbSharePayload, id: string | null) => Promise<SaveResult>;
    close: () => void;
};

function previewSlug(name: string): string {
    const folded = name.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    const collapsed = folded.replace(/[^a-z0-9_]+/g, "_");
    return collapsed.replace(/^_+|_+$/g, "").slice(0, 48).replace(/_+$/, "");
}

function FieldGroup(props: { help: string; children: ReactNode }) {
    return (
        <Field childrenLayout="below" bottomSeparator="standard" description={helpDescription(props.help, true)}>
            {props.children}
        </Field>
    );
}

export function SmbShareEditModal(props: SmbShareEditModalProps) {
    const { existing, language, onCreate, onUpdate, onTest, close } = props;
    const isEdit = existing !== null;

    const [name, setName] = useState(existing?.name ?? "");
    const [server, setServer] = useState(existing?.server ?? "");
    const [share, setShare] = useState(existing?.share ?? "");
    const [username, setUsername] = useState(existing?.username ?? "");
    const [password, setPassword] = useState("");
    const [clearPassword, setClearPassword] = useState(false);
    const [domain, setDomain] = useState(existing?.domain ?? "");
    const [vers, setVers] = useState<SmbVersion>(existing?.vers ?? "auto");
    const [softMount, setSoftMount] = useState(existing?.softMount ?? true);

    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<string | null>(null);
    const [testOk, setTestOk] = useState(false);

    const busy = saving || testing;
    const canSave = !busy && Boolean(name.trim()) && Boolean(server.trim()) && Boolean(share.trim());

    function buildPayload(): SmbSharePayload {
        const payload: SmbSharePayload = {
            server: server.trim(),
            share: share.trim(),
            username: username.trim(),
            domain: domain.trim(),
            vers,
            softMount
        };
        if (!isEdit) {
            payload.name = name.trim();
        }
        if (password) {
            payload.password = password;
        }
        if (clearPassword) {
            payload.clearPassword = true;
        }
        return payload;
    }

    function refusalText(result: SaveResult): string {
        const reason = smbServerRejectionLabel(result.error, language) ?? smbErrorLabel(result.error, language);
        if (!result.shares?.length) {
            return reason;
        }
        return `${reason} ${t(language, "The server has these shares: {{shares}}", { shares: result.shares.join(", ") })}`;
    }

    async function handleTest() {
        setTesting(true);
        setError(null);
        setTestResult(null);
        try {
            const result = await onTest(buildPayload(), existing?.id ?? null);
            setTestOk(Boolean(result.ok));
            setTestResult(result.ok ? t(language, "Connection Successful") : refusalText(result));
        }
        finally {
            setTesting(false);
        }
    }

    async function handleSave() {
        if (!canSave) {
            return;
        }
        setSaving(true);
        setError(null);
        setTestResult(null);
        setTestOk(false);
        try {
            const payload = buildPayload();
            const result = isEdit
                ? await onUpdate(existing.id, payload)
                : await onCreate(payload);

            if (result.ok) {
                close();
                return;
            }
            setError(refusalText(result));
        }
        finally {
            setSaving(false);
        }
    }

    const mountPath = isEdit
        ? existing.mountPath
        : `/run/media/cheevodeck/${previewSlug(name) || "…"}`;

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={canSave}
                label={t(language, "Save")}
                onSave={handleSave}
            >
                <div style={modalBodyStyle()}>
                    <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                        {isEdit ? t(language, "Edit Mount") : t(language, "Add Mount")}
                    </div>

                    {isEdit
                        ? (
                            <FieldGroup help={t(language, "help_smb_name_fixed")}>
                                <div style={{ ...modalBodyStyle(15), fontWeight: 600, opacity: 1 }}>{existing.name}</div>
                            </FieldGroup>
                        )
                        : (
                            <FieldGroup help={t(language, "help_smb_name")}>
                                <TextField
                                    label={t(language, "Mount Name")}
                                    value={name}
                                    disabled={busy}
                                    onChange={(e: any) => setName(e?.target?.value ?? "")}
                                />
                            </FieldGroup>
                        )}

                    <FieldGroup help={t(language, "help_smb_server")}>
                        <TextField
                            label={t(language, "Server")}
                            value={server}
                            disabled={busy}
                            onChange={(e: any) => setServer(e?.target?.value ?? "")}
                        />
                    </FieldGroup>
                    <FieldGroup help={t(language, "help_smb_share")}>
                        <TextField
                            label={t(language, "Share")}
                            value={share}
                            disabled={busy}
                            onChange={(e: any) => setShare(e?.target?.value ?? "")}
                        />
                    </FieldGroup>
                    <FieldGroup help={t(language, "help_smb_username")}>
                        <TextField
                            label={t(language, "Username")}
                            value={username}
                            disabled={busy}
                            onChange={(e: any) => setUsername(e?.target?.value ?? "")}
                        />
                    </FieldGroup>
                    <FieldGroup help={t(language, "help_smb_password")}>
                        <TextField
                            label={isEdit && existing.hasPassword && !clearPassword
                                ? t(language, "Password (saved — leave blank to keep)")
                                : t(language, "Password")}
                            value={password}
                            bIsPassword
                            disabled={busy}
                            onChange={(e: any) => {
                                setPassword(e?.target?.value ?? "");
                                setClearPassword(false);
                            }}
                        />
                    </FieldGroup>
                    {isEdit && existing.hasPassword && (
                        <FocusableItem
                            focusKey="smbform:clear-password"
                            bottomSeparator="standard"
                            disabled={busy}
                            onClick={() => {
                                setPassword("");
                                setClearPassword((current) => !current);
                            }}
                        >
                            {clearPassword
                                ? t(language, "Password will be removed")
                                : t(language, "Remove the saved password")}
                        </FocusableItem>
                    )}
                    <FieldGroup help={t(language, "help_smb_domain")}>
                        <TextField
                            label={t(language, "Domain")}
                            value={domain}
                            disabled={busy}
                            onChange={(e: any) => setDomain(e?.target?.value ?? "")}
                        />
                    </FieldGroup>

                    <FocusableItem
                        focusKey="smbform:vers"
                        bottomSeparator="standard"
                        disabled={busy}
                        onClick={() => setVers(nextSmbVersion(vers))}
                        help={t(language, "help_smb_version")}
                        modalHelp
                    >
                        {`${t(language, "SMB Version")}: ${smbVersionLabel(vers, language)}`}
                    </FocusableItem>

                    <FocusableItem
                        focusKey="smbform:reliability"
                        bottomSeparator="standard"
                        disabled={busy}
                        onClick={() => setSoftMount((current) => !current)}
                        help={t(language, "help_smb_reliability")}
                        modalHelp
                    >
                        {`${t(language, "Reliability")}: ${softMount ? t(language, "Soft Mount (Recommended)") : t(language, "Hard Mount")}`}
                    </FocusableItem>

                    <div style={{ marginTop: "8px" }}>
                        <InfoText modal>
                            {`${t(language, "Mount path")}: ${mountPath}`}
                        </InfoText>
                        {!isEdit && <InfoText modal>{t(language, "help_smb_path_preview")}</InfoText>}
                    </div>

                    {testResult && (
                        <div style={{ marginTop: "10px" }}>
                            {testOk
                                ? <div style={{ ...modalBodyStyle(), color: achievementGreen }}>{testResult}</div>
                                : <ErrorText modal>{testResult}</ErrorText>}
                        </div>
                    )}
                    {error && (
                        <div style={{ marginTop: "10px" }}>
                            <ErrorText modal>{error}</ErrorText>
                        </div>
                    )}

                    <Focusable
                        flow-children="row"
                        style={{ display: "flex", flexDirection: "row", gap: "8px", justifyContent: "flex-end", marginTop: "10px" }}
                    >
                        <div data-focus-key="smbform:cancel">
                            <DialogButton onClick={close} disabled={busy} style={compactButtonStyle}>
                                {t(language, "Cancel")}
                            </DialogButton>
                        </div>
                        <div data-focus-key="smbform:test">
                            <DialogButton onClick={handleTest} disabled={busy || !server.trim()} style={compactButtonStyle}>
                                {testing ? t(language, "Testing...") : t(language, "Test Connection")}
                            </DialogButton>
                        </div>
                        <div data-focus-key="smbform:save">
                            <DialogButton onClick={handleSave} disabled={!canSave} style={compactButtonStyle}>
                                {saving ? t(language, "Saving...") : t(language, "Save")}
                            </DialogButton>
                        </div>
                    </Focusable>
                </div>
            </SaveOnStart>
        </ModalRoot>
    );
}
