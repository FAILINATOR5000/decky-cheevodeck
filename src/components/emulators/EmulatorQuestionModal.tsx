import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import type { LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { FocusTarget } from "../ui/FocusTarget";

type EmulatorQuestion = {
    language: LanguageCode;
    title: string;
    text: string;
    confirm: string;
    cancel: string;
    focusConfirm: boolean;
};

function EmulatorQuestionModal(props: EmulatorQuestion & { onAnswer: (yes: boolean) => void; close: () => void }) {
    const { title, text, confirm, cancel, focusConfirm, onAnswer, close } = props;

    function answer(yes: boolean) {
        onAnswer(yes);
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>{title}</div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line" }}>{text}</div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                <FocusTarget focusKey="emulators:question:yes">
                    <DialogButton autoFocus={focusConfirm} onClick={() => answer(true)}>{confirm}</DialogButton>
                </FocusTarget>
                <FocusTarget focusKey="emulators:question:no">
                    <DialogButton autoFocus={!focusConfirm} onClick={() => answer(false)}>{cancel}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function askEmulatorQuestion(question: EmulatorQuestion): Promise<boolean> {
    return new Promise((resolve) => {
        let said = false;
        showManagedModal(
            (close) => <EmulatorQuestionModal {...question} onAnswer={(yes) => { said = yes; }} close={close} />,
            { onClose: () => resolve(said) }
        );
    });
}
