import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { HeadingStop } from "../ui/HeadingStop";

export type ProblemItem = string | { text: string; onPress: () => void };

function ProblemModal(props: { language: LanguageCode; title: string; text: string | ProblemItem[]; close: () => void }) {
    const { language, close } = props;
    const text = typeof props.text === "string" ? props.text : null;
    const items = typeof props.text === "string" ? null : props.text;
    const bulleted = items !== null && items.length > 1;
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <HeadingStop focusKey="problem:title" autoFocus outerStyle={{ marginBottom: "12px" }}
                style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                {props.title}
            </HeadingStop>
            {items === null ? (
                <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line" }}>
                    {text}
                </div>
            ) : items.map((item, index) => (
                <div key={index} data-focus-key={`problem:item:${index}`}>
                    <Focusable
                        onActivate={() => {
                            if (typeof item !== "string") {
                                close();
                                item.onPress();
                            }
                        }}
                        style={{ display: "flex", gap: "8px", fontSize: `${modalSize(16)}px`, lineHeight: 1.4, marginBottom: "10px" }}
                    >
                        {bulleted && <span>•</span>}
                        <span style={{ flex: 1, whiteSpace: "pre-line" }}>{typeof item === "string" ? item : item.text}</span>
                    </Focusable>
                </div>
            ))}
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }} flow-children="row">
                <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showMultiplayerProblem(language: LanguageCode, titleKey: string, text: string | ProblemItem[]) {
    showManagedModal((close) => (
        <ProblemModal language={language} title={t(language, titleKey)} text={text} close={close} />
    ));
}
