import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { multiplayerFriendSend } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { errorRed, modalBodyStyle } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { friendError } from "./AddFriendModal";

const MESSAGE_MAX = 500;

function MessageSayModal(props: { language: LanguageCode; ulid: string; name: string; close: () => void }) {
    const { language, close } = props;
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState("");
    const fieldRef = useRef<HTMLDivElement | null>(null);
    const canSend = text.trim().length > 0 && !busy;

    useEffect(() => {
        fieldRef.current?.querySelector("input")?.focus();
    }, []);

    async function send() {
        if (!canSend) {
            return;
        }
        setBusy(true);
        setFailure("");
        try {
            const sent = await multiplayerFriendSend(props.ulid, text);
            if (!sent.ok) {
                setFailure(sent.error ?? "unavailable");
                setBusy(false);
                return;
            }
        }
        catch (e) {
            logError("multiplayerFriendSend", e);
            setFailure("unavailable");
            setBusy(false);
            return;
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart canSave={canSend} label={t(language, "Send")} onSave={() => void send()}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px", overflowWrap: "anywhere" }}>
                    {t(language, "Message {{name}}", { name: props.name })}
                </div>
                <div ref={fieldRef} data-focus-key="multiplayer:message:text">
                    <TextField
                        value={text}
                        disabled={busy}
                        onChange={(e: any) => {
                            setText(String(e?.target?.value ?? "").slice(0, MESSAGE_MAX));
                            setFailure("");
                        }}
                    />
                </div>
                <div style={{ ...modalBodyStyle(), marginTop: "4px", textAlign: "right" }}>
                    {`${text.length}/${MESSAGE_MAX}`}
                </div>
                {failure && (
                    <div style={{ ...modalBodyStyle(), color: errorRed, opacity: 1, marginTop: "8px" }}>
                        {friendError(language, failure)}
                    </div>
                )}
                <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                    <div data-focus-key="multiplayer:message:send">
                        <DialogButton onClick={() => void send()} disabled={!canSend}>{t(language, "Send")}</DialogButton>
                    </div>
                    <div data-focus-key="multiplayer:message:cancel">
                        <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                    </div>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

export function openMessageSay(language: LanguageCode, ulid: string, name: string) {
    showManagedModal((close) => <MessageSayModal language={language} ulid={ulid} name={name} close={close} />);
}
