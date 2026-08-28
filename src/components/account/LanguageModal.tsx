import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useState } from "react";
import { FocusableItem } from "../ui/FocusableItem";
import { InlineSpinner } from "../ui/InlineSpinner";
import { modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { LANGUAGES, t, type LanguageCode } from "../../locales";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

export type LanguageModalProps = {
    language: LanguageCode;
    onSelectLanguage: (code: LanguageCode) => void | Promise<void>;
    close: () => void;
};

export function LanguageModal(props: LanguageModalProps) {
    const { language, onSelectLanguage, close } = props;

    const [busyCode, setBusyCode] = useState<LanguageCode | null>(null);

    const entries = Object.entries(LANGUAGES) as [LanguageCode, { label: string }][];

    function handlePress(code: LanguageCode) {
        if (busyCode !== null) {
            return;
        }
        if (code === language) {
            close();
            return;
        }
        setBusyCode(code);
        void (async () => {
            await onSelectLanguage(code);
            close();
        })();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Language")}
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    maxHeight: "60vh",
                    overflowY: "auto"
                }}
            >
                {entries.map(([code, def]) => {
                    const active = code === language;
                    const busy = busyCode === code;
                    return (
                        <FocusableItem
                            key={code}
                            outerStyle={{
                                width: "100%",
                                minWidth: 0,
                                opacity: busyCode !== null && !busy ? 0.5 : 1
                            }}
                            focusKey={`language:row:${code}`}
                            onClick={() => handlePress(code)}
                            disabled={busyCode !== null}
                            autoFocus={active}
                        >
                            <div
                                style={{
                                    width: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: "12px",
                                    textAlign: "left"
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: `${modalSize(15)}px`,
                                        fontWeight: active ? 700 : 500,
                                        minWidth: 0,
                                        wordBreak: "break-word"
                                    }}
                                >
                                    {def.label}
                                </span>
                                {busy ? (
                                    <InlineSpinner size={modalSize(14)} />
                                ) : (
                                    active && (
                                        <span style={{ ...modalBodyStyle(), opacity: 0.95, flexShrink: 0 }}>
                                            &#10003;
                                        </span>
                                    )
                                )}
                            </div>
                        </FocusableItem>
                    );
                })}
            </div>
            <Focusable
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "8px",
                    marginTop: "16px"
                }}
                flow-children="row"
            >
                <DialogButton onClick={close} disabled={busyCode !== null}>
                    {t(language, "Close")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}
