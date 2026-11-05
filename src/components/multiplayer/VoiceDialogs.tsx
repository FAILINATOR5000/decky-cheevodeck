import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { toggleMic, type MicPress } from "../../utils/voiceChat";
import { showMultiplayerProblem } from "./ProblemModal";

function SteamCallModal(props: { language: LanguageCode; close: () => void }) {
    const { language, close } = props;

    function unmute() {
        close();
        void toggleMic(true).then((result) => report(language, result));
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "You're in a Steam Voice Chat")}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4 }}>
                {t(language, "The other players will hear you, and your Steam call may hear the room through your speakers. A headset helps.")}
            </div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                <div data-focus-key="multiplayer:voice:unmute">
                    <DialogButton onClick={unmute}>{t(language, "Unmute Anyway")}</DialogButton>
                </div>
                <div data-focus-key="multiplayer:voice:cancel">
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </div>
            </Focusable>
        </ModalRoot>
    );
}

function report(language: LanguageCode, result: MicPress) {
    if (!result.ok && result.reason === "mic") {
        showMultiplayerProblem(language, "Voice Chat", `${t(language, "Couldn't open the microphone.")}\n${result.error}`);
    }
}

export function pressOwnMic(language: LanguageCode) {
    void toggleMic().then((result) => {
        if (!result.ok && result.reason === "steam") {
            showManagedModal((close) => <SteamCallModal language={language} close={close} />);
            return;
        }
        report(language, result);
    });
}
