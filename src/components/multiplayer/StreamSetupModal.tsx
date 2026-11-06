import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useState } from "react";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { readStreamSize, setUpStreaming } from "../../utils/streamPlay";

function StreamSetupModal(props: { language: LanguageCode; size: string; close: () => void }) {
    const { language, close } = props;
    const [size, setSize] = useState(props.size);

    useEffect(() => {
        if (props.size === "?") {
            void readStreamSize().then((known) => {
                if (known) {
                    setSize(known);
                }
            });
        }
    }, []);

    function setUp() {
        close();
        void setUpStreaming();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Set Up Streaming")}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4 }}>
                {size && size !== "?"
                    ? t(language, "Stream Play uses two free programs: Sunshine shares your game when you host, and Moonlight shows a host's game when you join. CheevoDeck will download and set them up for you (about {{size}}). You only need to do this once.", { size })
                    : t(language, "Stream Play uses two free programs: Sunshine shares your game when you host, and Moonlight shows a host's game when you join. CheevoDeck will download and set them up for you. You only need to do this once.")}
            </div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                <div data-focus-key="multiplayer:stream:setup">
                    <DialogButton onClick={setUp}>{t(language, "Set Up")}</DialogButton>
                </div>
                <div data-focus-key="multiplayer:stream:cancel">
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </div>
            </Focusable>
        </ModalRoot>
    );
}

export function openStreamSetup(language: LanguageCode, size: string) {
    showManagedModal((close) => <StreamSetupModal language={language} size={size} close={close} />);
}
