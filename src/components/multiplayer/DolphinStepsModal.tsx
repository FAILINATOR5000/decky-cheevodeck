import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import { cancelQuickAccessReturn, showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";

function DolphinStepsModal(props: { language: LanguageCode; host: boolean; close: () => void }) {
    const { language, host, close } = props;
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Dolphin NetPlay")}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4 }}>
                {t(language, host
                    ? "In Dolphin, open Tools, then Start NetPlay, then Host. Pick the game and press Start once everyone has joined."
                    : "In Dolphin, open Tools, then Start NetPlay, then Connect. The host's address is filled in.")}
            </div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }} flow-children="row">
                <DialogButton onClick={close}>{t(language, "Open Dolphin")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showDolphinSteps(language: LanguageCode, host: boolean): Promise<void> {
    return new Promise((resolve) => {
        showManagedModal((close) => <DolphinStepsModal language={language} host={host} close={close} />, {
            onClose: () => {
                cancelQuickAccessReturn();
                resolve();
            }
        });
    });
}
