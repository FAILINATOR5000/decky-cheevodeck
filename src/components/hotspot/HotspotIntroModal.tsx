import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useState } from "react";

import { getCurrentLanguage, t, type LanguageCode } from "../../locales";
import { setHotspotIntroOpener } from "../../utils/hotspotState";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { FocusTarget } from "../ui/FocusTarget";
import { ToggleRow } from "../ui/ToggleRow";

function HotspotIntroModal(props: { language: LanguageCode; onConfirm: (hide: boolean) => void; close: () => void }) {
    const { language, onConfirm, close } = props;
    const [hide, setHide] = useState(false);

    function turnOn() {
        close();
        onConfirm(hide);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Offline Hotspot")}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4 }}>
                {t(language, "help_hotspot_intro")}
            </div>
            <div style={{ marginTop: "12px" }}>
                <ToggleRow
                    label={t(language, "Don't show again")}
                    value={hide}
                    onChange={setHide}
                    bottomSeparator="none"
                    focusKey="hotspot:intro:hide"
                />
            </div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                <FocusTarget focusKey="hotspot:intro:on">
                    <DialogButton onClick={turnOn}>{t(language, "Turn On")}</DialogButton>
                </FocusTarget>
                <FocusTarget focusKey="hotspot:intro:cancel">
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function registerHotspotIntro() {
    setHotspotIntroOpener((onConfirm) => {
        const language = getCurrentLanguage();
        showManagedModal((close) => <HotspotIntroModal language={language} onConfirm={onConfirm} close={close} />);
    });
}
