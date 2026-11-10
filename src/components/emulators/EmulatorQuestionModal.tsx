import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import type { LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";

type EmulatorQuestion = {
    language: LanguageCode;
    title: string;
    text: string;
    path?: string;
    confirm: string;
    cancel: string;
};

function EmulatorQuestionModal(props: EmulatorQuestion & { onAnswer: (yes: boolean) => void; close: () => void }) {
    const { title, text, path, confirm, cancel, onAnswer, close } = props;

    function answer(yes: boolean) {
        onAnswer(yes);
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <HeadingStop focusKey="emulators:question:title" autoFocus outerStyle={{ marginBottom: "12px" }}
                style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                {title}
            </HeadingStop>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line" }}>{text}</div>
            {path && (
                <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginTop: "8px", opacity: 0.8, overflowWrap: "anywhere", wordBreak: "break-all" }}>
                    {path}
                </div>
            )}
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                <FocusTarget focusKey="emulators:question:yes">
                    <DialogButton onClick={() => answer(true)}>{confirm}</DialogButton>
                </FocusTarget>
                <FocusTarget focusKey="emulators:question:no">
                    <DialogButton onClick={() => answer(false)}>{cancel}</DialogButton>
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
