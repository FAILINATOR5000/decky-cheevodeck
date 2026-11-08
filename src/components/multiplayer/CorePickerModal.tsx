import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { FocusableItem } from "../ui/FocusableItem";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import type { CouchChoices, PlayPick } from "../../types";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, modalBodyStyle } from "../../utils/style";

type CorePickerModalProps = {
    language: LanguageCode;
    choices: CouchChoices;
    onPick: (pick: PlayPick | null) => Promise<void>;
    close: () => void;
};

type Row = { key: string; label: string; pick: PlayPick | null; mark?: string };

function CorePickerModal(props: CorePickerModalProps) {
    const { language, choices, onPick, close } = props;
    const saved = choices.saved;

    const sections: { title: string; rows: Row[] }[] = [];
    if (choices.shortcuts.length > 0) {
        sections.push({ title: t(language, "Your shortcuts"), rows: choices.shortcuts.map((row) => ({
            key: `own:${row.appid}`,
            label: `${row.name} (${row.detail})`,
            pick: row.default ? null : { appid: row.appid, kind: row.kind, core: "" },
            mark: row.default ? t(language, "Default") : undefined
        })) });
    }
    else if (choices.defaultCore) {
        sections.push({ title: "", rows: [{ key: "default", pick: null,
            label: t(language, "Default ({{core}})", { core: choices.defaultCore }) }] });
    }
    if (choices.emulators.length > 0) {
        sections.push({ title: "", rows: choices.emulators.map((row) => ({
            key: `emulator:${row.appid}`,
            label: row.label,
            pick: { appid: row.appid, kind: row.kind, core: "" }
        })) });
    }
    if (choices.cores.length > 0) {
        sections.push({ title: "RetroArch", rows: choices.cores.map((row) => ({
            key: `core:${row.core}`,
            label: row.name,
            pick: { appid: 0, kind: "retroarch", core: row.core }
        })) });
    }

    function chosen(pick: PlayPick | null): boolean {
        if (saved === null || pick === null) {
            return saved === pick;
        }
        return saved.appid === pick.appid && saved.core === pick.core;
    }

    function press(row: Row) {
        if (chosen(row.pick)) {
            close();
            return;
        }
        void onPick(row.pick).finally(close);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Choose a Core")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {sections.map((section, index) => (
                    <div key={index} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {section.title && (
                            <div style={{ ...modalBodyStyle(), fontWeight: 700, marginTop: "6px" }}>{section.title}</div>
                        )}
                        {section.rows.map((row) => {
                            const active = chosen(row.pick);
                            return (
                                <FocusableItem
                                    key={row.key}
                                    outerStyle={{ width: "100%", minWidth: 0 }}
                                    focusKey={`multiplayer-core-picker:${row.key}`}
                                    onClick={() => press(row)}
                                    autoFocus={active}
                                >
                                    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}>
                                        <span style={{ fontSize: `${modalSize(15)}px`, fontWeight: active ? 700 : 500, minWidth: 0, flex: 1 }}>
                                            {row.label}
                                        </span>
                                        {row.mark && <span style={{ ...modalBodyStyle(), flexShrink: 0 }}>{row.mark}</span>}
                                        {active && <span style={{ color: achievementGreen, flexShrink: 0 }}>{"✔"}</span>}
                                    </div>
                                </FocusableItem>
                            );
                        })}
                    </div>
                ))}
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
