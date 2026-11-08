import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { FocusTarget } from "../ui/FocusTarget";
import { SaveOnStart } from "../ui/SaveOnStart";

const CODE_DIGITS = 8;

function HotspotCodeModal(props: { language: LanguageCode; ssid: string; onJoin: (code: string) => void; close: () => void }) {
    const { language, ssid, onJoin, close } = props;
    const [code, setCode] = useState("");
    const canJoin = code.length === CODE_DIGITS;

    function join() {
        if (!canJoin) {
            return;
        }
        close();
        onJoin(code);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SaveOnStart canSave={canJoin} label={t(language, "Join")} onSave={join}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "4px" }}>
                    {t(language, "Hotspot password")}
                </div>
                <div style={{ fontSize: `${modalSize(16)}px`, opacity: 0.8, marginBottom: "12px" }}>{ssid}</div>
                <FocusTarget focusKey="hotspot:code:field">
                    <TextField
                        value={code}
                        onChange={(e: any) => setCode(String(e?.target?.value ?? "").replace(/\D/g, "").slice(0, CODE_DIGITS))}
                    />
                </FocusTarget>
                <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                    <FocusTarget focusKey="hotspot:code:join">
                        <DialogButton onClick={join} disabled={!canJoin}>
                            {t(language, "Join")}
                        </DialogButton>
                    </FocusTarget>
                    <FocusTarget focusKey="hotspot:code:cancel">
                        <DialogButton onClick={close}>
                            {t(language, "Cancel")}
                        </DialogButton>
                    </FocusTarget>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

export function openHotspotCode(language: LanguageCode, ssid: string, onJoin: (code: string) => void) {
    showManagedModal((close) => <HotspotCodeModal language={language} ssid={ssid} onJoin={onJoin} close={close} />);
}
