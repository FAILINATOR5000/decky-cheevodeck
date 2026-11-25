import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useState } from "react";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { changeUnreadyStartWarning } from "../../utils/multiplayerRoomState";
import { modalSize } from "../../utils/scale";
import { ToggleRow } from "../ui/ToggleRow";

function UnreadyStartModal(props: { language: LanguageCode; claim: () => boolean; onContinue: () => void; close: () => void }) {
    const { language, claim, onContinue, close } = props;
    const [hide, setHide] = useState(false);

    function next() {
        if (!claim()) {
            return;
        }
        if (hide) {
            void changeUnreadyStartWarning(false);
        }
        close();
        onContinue();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Not Everyone Is Ready")}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4 }}>
                {t(language, "Not all guests are readied up. Do you still want to continue?")}
            </div>
            <div style={{ marginTop: "12px" }}>
                <ToggleRow
                    label={t(language, "Don't show again")}
                    value={hide}
                    onChange={setHide}
                    bottomSeparator="none"
                    focusKey="multiplayer:unready:hide"
                />
            </div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                <div data-focus-key="multiplayer:unready:continue">
                    <DialogButton onClick={next} autoFocus>{t(language, "Continue")}</DialogButton>
                </div>
                <div data-focus-key="multiplayer:unready:cancel">
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </div>
            </Focusable>
        </ModalRoot>
    );
}

export function openUnreadyStart(language: LanguageCode, onContinue: () => void) {
    let continued = false;
    const claim = () => {
        if (continued) {
            return false;
        }
        continued = true;
        return true;
    };
    showManagedModal((close) => <UnreadyStartModal language={language} claim={claim} onContinue={onContinue} close={close} />,
        { returnToQam: () => !continued });
}
