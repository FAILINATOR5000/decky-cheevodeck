import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { saveLobbyServer } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const ADDRESS_MAX = 260;

type LobbyServerModalProps = {
    language: LanguageCode;
    current: string;
    close: () => void;
};

function LobbyServerModal(props: LobbyServerModalProps) {
    const { language, current, close } = props;
    const [address, setAddress] = useState(current);
    const [saving, setSaving] = useState(false);
    const fieldRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        fieldRef.current?.querySelector("input")?.focus();
    }, []);

    async function save(useDefault: boolean) {
        if (saving) {
            return;
        }
        setSaving(true);
        try {
            await saveLobbyServer(address.trim(), useDefault);
        }
        catch (e) {
            logError("saveLobbyServer", e);
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart canSave={!saving} label={t(language, "Save")} onSave={() => void save(false)}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Lobby Server")}
                </div>
                <div ref={fieldRef} data-focus-key="options:lobbyserver:address">
                    <TextField
                        label={t(language, "Server address")}
                        value={address}
                        disabled={saving}
                        onChange={(e: any) => setAddress(String(e?.target?.value ?? "").slice(0, ADDRESS_MAX))}
                    />
                </div>
                <div style={{ ...modalBodyStyle(), marginTop: "8px" }}>
                    {t(language, "help_lobby_server")}
                </div>
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <div data-focus-key="options:lobbyserver:save">
                        <DialogButton onClick={() => void save(false)} disabled={saving}>
                            {t(language, "Save")}
                        </DialogButton>
                    </div>
                    <div data-focus-key="options:lobbyserver:default">
                        <DialogButton onClick={() => void save(true)} disabled={saving}>
                            {t(language, "Use Default")}
                        </DialogButton>
                    </div>
                    <div data-focus-key="options:lobbyserver:cancel">
                        <DialogButton onClick={close}>
                            {t(language, "Cancel")}
                        </DialogButton>
                    </div>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

export function openLobbyServer(language: LanguageCode, current: string) {
    showManagedModal((close) => <LobbyServerModal language={language} current={current} close={close} />);
}
