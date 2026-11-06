import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useState } from "react";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { hideStreamScreenWarning } from "../../utils/streamPlay";
import { ToggleRow } from "../ui/ToggleRow";

function StreamScreenWarningModal(props: { language: LanguageCode; onNext: () => void; close: () => void }) {
    const { language, onNext, close } = props;
    const [hide, setHide] = useState(false);

    function next() {
        if (hide) {
            void hideStreamScreenWarning();
        }
        close();
        onNext();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Your Screen Is Shared")}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4 }}>
                {t(language, "Guests see your whole screen while the game runs, including the Quick Access Menu, notifications and anything you type. Don't enter passwords or anything private while you're hosting.")}
            </div>
            <div style={{ marginTop: "12px" }}>
                <ToggleRow
                    label={t(language, "Don't show again")}
                    value={hide}
                    onChange={setHide}
                    bottomSeparator="none"
                    focusKey="multiplayer:stream:screenwarning:hide"
                />
            </div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                <div data-focus-key="multiplayer:stream:screenwarning:next">
                    <DialogButton onClick={next}>{t(language, "Next")}</DialogButton>
                </div>
                <div data-focus-key="multiplayer:stream:screenwarning:cancel">
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </div>
            </Focusable>
        </ModalRoot>
    );
}

export function openStreamScreenWarning(language: LanguageCode, onNext: () => void) {
    showManagedModal((close) => <StreamScreenWarningModal language={language} onNext={onNext} close={close} />);
}
