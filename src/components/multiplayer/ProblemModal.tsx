import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";

function ProblemModal(props: { language: LanguageCode; title: string; text: string | string[]; close: () => void }) {
    const { language, close } = props;
    const items = typeof props.text === "string" ? null : props.text;
    const bulleted = items !== null && items.length > 1;
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {props.title}
            </div>
            {items === null ? (
                <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line" }}>
                    {props.text}
                </div>
            ) : items.map((item, index) => (
                <div key={index} data-focus-key={`problem:item:${index}`}>
                    <Focusable
                        onActivate={() => { }}
                        style={{ display: "flex", gap: "8px", fontSize: `${modalSize(16)}px`, lineHeight: 1.4, marginBottom: "10px" }}
                    >
                        {bulleted && <span>•</span>}
                        <span style={{ flex: 1, whiteSpace: "pre-line" }}>{item}</span>
                    </Focusable>
                </div>
            ))}
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }} flow-children="row">
                <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showMultiplayerProblem(language: LanguageCode, titleKey: string, text: string | string[]) {
    showManagedModal((close) => (
        <ProblemModal language={language} title={t(language, titleKey)} text={text} close={close} />
    ));
}
