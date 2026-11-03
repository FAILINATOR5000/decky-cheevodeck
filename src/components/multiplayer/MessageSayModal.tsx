import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { multiplayerFriendSend } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { friendError } from "./AddFriendModal";
import { DialogLine, type DialogLineState } from "./DialogLine";

const MESSAGE_MAX = 500;

function MessageSayModal(props: { language: LanguageCode; ulid: string; name: string; close: () => void }) {
    const { language, close } = props;
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [line, setLine] = useState<DialogLineState>({ tone: "hint", text: "" });
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
        setLine({ tone: "busy", text: t(language, "Sending...") });
        try {
            const sent = await multiplayerFriendSend(props.ulid, text);
            if (!sent.ok) {
                setLine({ tone: "error", text: friendError(language, sent.error, props.name) });
                setBusy(false);
                return;
            }
        }
        catch (e) {
            logError("multiplayerFriendSend", e);
            setLine({ tone: "error", text: friendError(language, "unavailable") });
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
                            setLine({ tone: "hint", text: "" });
                        }}
                    />
                </div>
                <div style={{ ...modalBodyStyle(), marginTop: "4px", textAlign: "right" }}>
                    {`${text.length}/${MESSAGE_MAX}`}
                </div>
                <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                    <DialogLine {...line} beside />
                    <div data-focus-key="multiplayer:message:send">
                        <DialogButton onClick={() => void send()} disabled={!canSend} focusable={canSend || busy}>{t(language, "Send")}</DialogButton>
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
