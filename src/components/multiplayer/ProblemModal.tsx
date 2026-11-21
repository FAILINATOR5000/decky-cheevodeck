import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import type { ReactNode } from "react";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { HeadingStop } from "../ui/HeadingStop";

export type ProblemItem = string | { text: string; onPress: () => void } | { node: ReactNode };

function isNode(item: ProblemItem): item is { node: ReactNode } {
    return typeof item !== "string" && "node" in item;
}

type ProblemAction = { label: string; onPress: () => void };

function ProblemModal(props: {
    language: LanguageCode;
    title: string;
    text: string | ProblemItem[];
    titleFirst: boolean;
    action?: ProblemAction;
    close: () => void;
}) {
    const { language, action, close } = props;
    const text = typeof props.text === "string" ? props.text : null;
    const items = typeof props.text === "string" ? null : props.text;
    const bulleted = items !== null && items.length > 1;
    const closeFirst = items === null && !props.titleFirst;
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <HeadingStop focusKey="problem:title" autoFocus={!closeFirst} outerStyle={{ marginBottom: "12px" }}
                style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                {props.title}
            </HeadingStop>
            {items === null && props.titleFirst ? (
                <HeadingStop focusKey="problem:body" style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line" }}>
                    {text}
                </HeadingStop>
            ) : items === null ? (
                <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line" }}>
                    {text}
                </div>
            ) : items.map((item, index) => isNode(item) ? (
                <div key={index}>{item.node}</div>
            ) : (
                <div key={index} data-focus-key={`problem:item:${index}`}>
                    <Focusable
                        onActivate={() => {
                            if (typeof item !== "string") {
                                close();
                                item.onPress();
                            }
                        }}
                        style={{ display: "flex", gap: "8px", fontSize: `${modalSize(16)}px`, lineHeight: 1.4, marginBottom: "1.4em" }}
                    >
                        {bulleted && <span>•</span>}
                        <span style={{ flex: 1, whiteSpace: "pre-line" }}>{typeof item === "string" ? item : item.text}</span>
                    </Focusable>
                </div>
            ))}
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                {action && (
                    <DialogButton
                        onClick={() => {
                            close();
                            action.onPress();
                        }}
                        autoFocus={closeFirst}
                    >
                        {action.label}
                    </DialogButton>
                )}
                <DialogButton onClick={close} autoFocus={closeFirst && !action}>{t(language, "Close")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showMultiplayerProblem(language: LanguageCode, titleKey: string, text: string | ProblemItem[], titleFirst = false,
    action?: ProblemAction) {
    showManagedModal((close) => (
        <ProblemModal language={language} title={t(language, titleKey)} text={text} titleFirst={titleFirst} action={action} close={close} />
    ));
}
