import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useState } from "react";

import { t, type LanguageCode } from "../../locales";
import type { PlayChoices, PlayPick } from "../../types";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, modalBodyStyle, warnAmber } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { ToggleRow } from "../ui/ToggleRow";

type PlayWithProps = {
    language: LanguageCode;
    purpose: "launch" | "set";
    choices: PlayChoices;
    onPick: (pick: PlayPick | null, remember: boolean) => void | Promise<void>;
    onForget: () => Promise<void>;
    close: () => void;
};

type Row = { key: string; label: string; pick: PlayPick | null; mark?: string; note?: string };

function samePick(a: PlayPick | Record<string, never> | null, b: PlayPick | null): boolean {
    if (a === null || !("appid" in a)) {
        return b === null;
    }
    return b !== null && a.appid === b.appid && a.core === b.core;
}

function PlayWithModal(props: PlayWithProps) {
    const { language, purpose, choices, close } = props;
    const [remember, setRemember] = useState(false);
    const current = purpose === "set" && choices.session !== null ? choices.session : choices.saved;
    const own = choices.shortcuts;

    const sections: { title: string; rows: Row[] }[] = [];
    if (own.length === 1) {
        sections.push({ title: "", rows: [{ key: "own", pick: null,
            label: t(language, "Your shortcut ({{emulator}})", { emulator: own[0].detail }) }] });
    }
    else if (own.length > 1) {
        sections.push({ title: t(language, "Your shortcuts"), rows: own.map((row) => ({
            key: `own:${row.appid}`,
            label: `${row.name} (${row.detail})`,
            pick: row.default ? null : { appid: row.appid, kind: row.kind, core: "" },
            mark: row.default ? t(language, "Default") : undefined
        })) });
    }
    else if (choices.recommended) {
        sections.push({ title: "", rows: [{ key: "recommended", pick: null,
            label: t(language, "Recommended ({{emulator}})", { emulator: choices.recommended }) }] });
    }
    if (choices.cores.length > 0) {
        sections.push({ title: "RetroArch", rows: choices.cores.map((row) => ({
            key: `core:${row.core}`,
            label: row.label,
            pick: { appid: row.appid, kind: row.kind, core: row.core }
        })) });
    }
    if (choices.standalones.length > 0) {
        sections.push({ title: t(language, "Standalone"), rows: choices.standalones.map((row) => ({
            key: `standalone:${row.appid}`,
            label: row.label,
            pick: { appid: row.appid, kind: row.kind, core: "" },
            note: row.noAchievements ? t(language, "No achievements") : undefined
        })) });
    }

    function press(row: Row) {
        if (purpose === "set") {
            void Promise.resolve(props.onPick(row.pick, remember)).finally(close);
            return;
        }
        close();
        void props.onPick(row.pick, remember);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "8px" }}>
                {t(language, "Play With…")}
            </div>
            <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <ToggleRow
                        label={t(language, "Remember for this game")}
                        value={remember}
                        onChange={setRemember}
                        bottomSeparator="none"
                        focusKey="playwith:remember"
                    />
                </div>
                {choices.saved !== null && (
                    <div data-focus-key="playwith:forget">
                        <DialogButton
                            style={{ minWidth: 0, padding: "4px 14px" }}
                            onClick={() => void props.onForget().finally(close)}
                        >
                            {t(language, "Forget")}
                        </DialogButton>
                    </div>
                )}
            </Focusable>
            {choices.savedMissing && (
                <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1, marginBottom: "6px" }}>
                    {t(language, "Your saved pick is missing, so the usual choice runs.")}
                </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {sections.map((section) => (
                    <div key={section.title || "first"} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {section.title && (
                            <div style={{ ...modalBodyStyle(), fontWeight: 700, marginTop: "6px" }}>{section.title}</div>
                        )}
                        {section.rows.map((row) => {
                            const chosen = samePick(current, row.pick);
                            return (
                                <FocusableItem
                                    key={row.key}
                                    outerStyle={{ width: "100%", minWidth: 0 }}
                                    focusKey={`playwith:${row.key}`}
                                    onClick={() => press(row)}
                                    autoFocus={chosen}
                                >
                                    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}>
                                        <span style={{ fontSize: `${modalSize(15)}px`, fontWeight: chosen ? 700 : 500, minWidth: 0, flex: 1 }}>
                                            {row.label}
                                        </span>
                                        {row.note && <span style={{ ...modalBodyStyle(), flexShrink: 0 }}>{row.note}</span>}
                                        {row.mark && <span style={{ ...modalBodyStyle(), flexShrink: 0 }}>{row.mark}</span>}
                                        {chosen && <span style={{ color: achievementGreen, flexShrink: 0 }}>{"✔"}</span>}
                                    </div>
                                </FocusableItem>
                            );
                        })}
                    </div>
                ))}
            </div>
            <div style={{ ...modalBodyStyle(), marginTop: "10px" }}>
                {t(language, "Saves don't carry over between emulators, and RetroArch may keep a separate save for each core.")}
            </div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }} flow-children="row">
                <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showPlayWith(options: Omit<PlayWithProps, "close">) {
    showManagedModal((close) => <PlayWithModal {...options} close={close} />);
}
