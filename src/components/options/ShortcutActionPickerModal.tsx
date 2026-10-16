import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { Fragment, useState } from "react";
import { FocusableItem } from "../ui/FocusableItem";
import { InlineSpinner } from "../ui/InlineSpinner";
import { ButtonPrompt, GlyphGroup } from "../ui/ButtonPrompt";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import type { ShortcutAction, ShortcutButton } from "../../types";
import { showManagedModal } from "../../utils/modalRegistry";
import {
    shortcutActionGroups,
    shortcutButtonGlyphs,
    shortcutButtonLabel,
    worksOutsidePanel
} from "../../utils/options";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";

type ShortcutActionPickerModalProps = {
    language: LanguageCode;
    button: ShortcutButton;
    current: ShortcutAction;
    showDeveloperOptions: boolean;
    onSelect: (action: ShortcutAction) => void | Promise<void>;
    close: () => void;
};

function ShortcutActionPickerModal(props: ShortcutActionPickerModalProps) {
    const { language, button, current, showDeveloperOptions, onSelect, close } = props;

    const [busyAction, setBusyAction] = useState<ShortcutAction | null>(null);

    const groups = shortcutActionGroups(button, language, current, showDeveloperOptions);
    const titleSize = modalSize(20);
    const buttonLabel = shortcutButtonLabel(button, language);

    function handlePress(action: ShortcutAction) {
        if (busyAction !== null) {
            return;
        }
        if (action === current) {
            close();
            return;
        }
        setBusyAction(action);
        void (async () => {
            await onSelect(action);
            close();
        })();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${titleSize}px`, fontWeight: 700, marginBottom: "12px" }}>
                <ButtonPrompt
                    language={language}
                    textKey="Choose an action for {{button}}:"
                    fontSize={titleSize}
                    groups={[
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3em" }}>
                            <GlyphGroup buttons={shortcutButtonGlyphs(button)} fontSize={titleSize} />
                            {buttonLabel}
                        </span>
                    ]}
                />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {groups.map((group) => (
                    <Fragment key={group.labelKey ?? "none"}>
                        {group.labelKey && (
                            <div
                                style={{
                                    fontSize: `${modalSize(13)}px`,
                                    fontWeight: 700,
                                    opacity: 0.7,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                    marginTop: "10px"
                                }}
                            >
                                {t(language, group.labelKey)}
                            </div>
                        )}
                        {group.actions.map((action) => {
                            const active = action.id === current;
                            const busy = busyAction === action.id;
                            return (
                                <FocusableItem
                                    key={action.id}
                                    outerStyle={{
                                        width: "100%",
                                        minWidth: 0,
                                        opacity: busyAction !== null && !busy ? 0.5 : 1
                                    }}
                                    focusKey={`shortcut-picker:${action.id}`}
                                    onClick={() => handlePress(action.id)}
                                    disabled={busyAction !== null}
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
                                            {t(language, action.labelKey)
                                                + (worksOutsidePanel(button, action.id) ? "*" : "")}
                                        </span>
                                        {busy ? (
                                            <InlineSpinner size={modalSize(14)} />
                                        ) : (
                                            active && (
                                                <span style={{ ...modalBodyStyle(), opacity: 0.95, flexShrink: 0 }}>
                                                    {"✔"}
                                                </span>
                                            )
                                        )}
                                    </div>
                                </FocusableItem>
                            );
                        })}
                    </Fragment>
                ))}
            </div>
            {groups.some((group) => group.actions.some((action) => worksOutsidePanel(button, action.id))) && (
                <div style={{ ...modalBodyStyle(), opacity: 0.8, marginTop: "12px" }}>
                    {t(language, "*Supported for Global Buttons")}
                </div>
            )}
            <Focusable
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "8px",
                    marginTop: "16px"
                }}
                flow-children="row"
            >
                <DialogButton onClick={close} disabled={busyAction !== null}>
                    {t(language, "Close")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function openShortcutActionPicker(options: Omit<ShortcutActionPickerModalProps, "close">) {
    showManagedModal((close) => (
        <ShortcutActionPickerModal {...options} close={close} />
    ));
}
