import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";

function ProblemModal(props: { language: LanguageCode; title: string; text: string; close: () => void }) {
    const { language, close } = props;
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {props.title}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line" }}>
                {props.text}
            </div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }} flow-children="row">
                <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showMultiplayerProblem(language: LanguageCode, titleKey: string, text: string) {
    showManagedModal((close) => (
        <ProblemModal language={language} title={t(language, titleKey)} text={text} close={close} />
    ));
}
