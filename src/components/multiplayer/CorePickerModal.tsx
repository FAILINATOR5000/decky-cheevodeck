import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { FocusableItem } from "../ui/FocusableItem";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerCoreChoice } from "../../types";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";

type CorePickerModalProps = {
    language: LanguageCode;
    choices: MultiplayerCoreChoice[];
    current: string;
    onPick: (core: string) => void;
    close: () => void;
};

function CorePickerModal(props: CorePickerModalProps) {
    const { language, choices, current, onPick, close } = props;

    function press(core: string) {
        if (core !== current) {
            onPick(core);
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Choose a Core")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {choices.map((choice) => {
                    const active = choice.core === current;
                    return (
                        <FocusableItem
                            key={choice.core}
                            outerStyle={{ width: "100%", minWidth: 0 }}
                            focusKey={`multiplayer-core-picker:${choice.core}`}
                            onClick={() => press(choice.core)}
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
                                <span style={{ fontSize: `${modalSize(15)}px`, fontWeight: active ? 700 : 500, minWidth: 0 }}>
                                    {choice.name}
                                </span>
                                {active && (
                                    <span style={{ ...modalBodyStyle(), opacity: 0.95, flexShrink: 0 }}>
                                        {"✔"}
                                    </span>
                                )}
                            </div>
                        </FocusableItem>
                    );
                })}
            </div>
            <Focusable
                style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                flow-children="row"
            >
                <DialogButton onClick={close}>
                    {t(language, "Close")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function openCorePicker(options: Omit<CorePickerModalProps, "close">) {
    showManagedModal((close) => (
        <CorePickerModal {...options} close={close} />
    ));
}
