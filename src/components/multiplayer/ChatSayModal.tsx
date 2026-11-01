import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";

import { multiplayerSay } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const CHAT_MAX = 120;

function ChatSayModal(props: { language: LanguageCode; close: () => void }) {
    const { language, close } = props;
    const [text, setText] = useState("");
    const canSend = text.trim().length > 0;

    function send() {
        if (!canSend) {
            return;
        }
        multiplayerSay(text).catch((e) => logError("multiplayerSay", e));
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart canSave={canSend} label={t(language, "Send")} onSave={send}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Say Something")}
                </div>
                <TextField
                    value={text}
                    onChange={(e: any) => setText(String(e?.target?.value ?? "").slice(0, CHAT_MAX))}
                />
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <DialogButton onClick={send} disabled={!canSend}>
                        {t(language, "Send")}
                    </DialogButton>
                    <DialogButton onClick={close}>
                        {t(language, "Cancel")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

export function openChatSay(language: LanguageCode) {
    showManagedModal((close) => <ChatSayModal language={language} close={close} />);
}
