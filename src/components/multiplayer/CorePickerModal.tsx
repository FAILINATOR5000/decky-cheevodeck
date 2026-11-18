import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useMemo, useState } from "react";
import { multiplayerCouchChoices } from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { CoreInstallLine, useCoreInstalls } from "../emulators/CoreInstall";
import { FocusableItem } from "../ui/FocusableItem";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import type { CouchChoices, PlayPick } from "../../types";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, modalBodyStyle } from "../../utils/style";

const ROWS_INITIAL = 30;
const ROWS_STEP = 30;
const NAV_ENTER_MAINTAIN_Y = 3;

type CorePickerModalProps = {
    language: LanguageCode;
    gameId: number;
    choices: CouchChoices;
    onPick: (pick: PlayPick | null) => Promise<void>;
    close: () => void;
};

type Row =
    | { kind: "heading"; key: string; label: string }
    | { kind: "choice"; key: string; label: string; pick: PlayPick | null; marks: string[] }
    | { kind: "missing"; key: string; label: string; core: string; marks: string[] };

function rowsOf(language: LanguageCode, choices: CouchChoices): Row[] {
    const rows: Row[] = [];
    const overrides = choices.overrides;
    if (choices.shortcuts.length > 0) {
        rows.push({ kind: "heading", key: "heading:shortcuts", label: t(language, "Your shortcuts") });
        for (const row of choices.shortcuts) {
            const isDefault = row.default && !overrides;
            rows.push({
                kind: "choice",
                key: `own:${row.appid}`,
                label: `${row.name} (${row.detail})`,
                pick: isDefault ? null : { appid: row.appid, kind: row.kind, core: "" },
                marks: isDefault ? [t(language, "Default")] : []
            });
        }
    }
    else if (choices.defaultCore && !(overrides && choices.cores.some((row) => row.core === choices.recommendedCore))) {
        rows.push({ kind: "choice", key: "default", pick: null, marks: [],
            label: t(language, "Default ({{core}})", { core: choices.defaultCore }) });
    }
    for (const row of choices.emulators) {
        rows.push({ kind: "choice", key: `emulator:${row.appid}`, label: row.label, marks: [],
            pick: { appid: row.appid, kind: row.kind, core: "" } });
    }
    if (choices.cores.length > 0 || choices.missing.length > 0) {
        const recommended = choices.recommendedCore;
        const marks = (core: string) => (core !== recommended ? []
            : overrides ? [t(language, "Recommended"), t(language, "Default")] : [t(language, "Recommended")]);
        const installed: Row[] = choices.cores.map((row) => ({
            kind: "choice",
            key: `core:${row.core}`,
            label: row.name,
            pick: overrides && row.core === recommended ? null : { appid: 0, kind: "retroarch", core: row.core },
            marks: marks(row.core)
        }));
        const missing: Row[] = choices.missing.map((row) => ({
            kind: "missing", key: `core:${row.core}`, label: row.name, core: row.core, marks: marks(row.core)
        }));
        const first = (row: Row) => row.key === `core:${recommended}`;
        rows.push({ kind: "heading", key: "heading:retroarch", label: "RetroArch" });
        rows.push(...installed.filter(first), ...missing.filter(first),
            ...installed.filter((row) => !first(row)), ...missing.filter((row) => !first(row)));
    }
    return rows;
}

function CorePickerModal(props: CorePickerModalProps) {
    const { language, gameId, onPick, close } = props;
    const [choices, setChoices] = useState(props.choices);
    const saved = choices.saved;
    const installs = useCoreInstalls(() => {
        multiplayerCouchChoices(gameId)
            .then((found) => {
                if (found.ok) {
                    setChoices(found);
                }
            })
            .catch((e) => logError("multiplayer: listing the Couch choices after an install", e));
    });

    const rows = useMemo(() => rowsOf(language, choices), [language, choices]);
    const list = useSlidingWindow({
        items: rows,
        itemKey: (row) => row.key,
        focusKeyFor: (row) => `multiplayer-core-picker:${row.key}`,
        windowId: "multiplayer-core-picker:list",
        heightScope: ["multiplayer-core-picker:list", language].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        fullSteps: true,
        prefetchDistance: 4,
        sentinelRootMarginPx: 600,
        resetKey: String(gameId)
    });

    function chosen(pick: PlayPick | null): boolean {
        if (saved === null || pick === null) {
            return saved === pick;
        }
        return saved.appid === pick.appid && saved.core === pick.core;
    }

    function press(pick: PlayPick | null) {
        if (chosen(pick)) {
            close();
            return;
        }
        void onPick(pick).finally(close);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Choose a Core")}
            </div>
            <Focusable
                flow-children="column"
                resetNavOnEntry
                navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            >
                <SlidingWindowRows list={list}>
                    {list.mountedItems.map((row, index) => {
                        const at = list.start + index;
                        if (row.kind === "heading") {
                            return (
                                <div key={row.key} style={{ ...modalBodyStyle(), fontWeight: 700, marginTop: "6px" }}>
                                    {row.label}
                                </div>
                            );
                        }
                        const active = row.kind === "choice" && chosen(row.pick);
                        return (
                            <FocusableItem
                                key={row.key}
                                outerStyle={{ width: "100%", minWidth: 0 }}
                                focusKey={`multiplayer-core-picker:${row.key}`}
                                onClick={() => (row.kind === "choice" ? press(row.pick) : void installs.install(row.core))}
                                onGamepadFocus={() => list.onItemFocus(at)}
                                onGamepadDirection={list.guardTopRow(at)}
                                autoFocus={active}
                            >
                                <div style={{ width: "100%", display: "flex", flexDirection: "column", textAlign: "left" }}>
                                    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px" }}>
                                        <span style={{ fontSize: `${modalSize(15)}px`, fontWeight: active ? 700 : 500, minWidth: 0, flex: 1 }}>
                                            {row.label}
                                        </span>
                                        {row.marks.map((mark) => (
                                            <span key={mark} style={{ ...modalBodyStyle(), flexShrink: 0 }}>{mark}</span>
                                        ))}
                                        {active && <span style={{ color: achievementGreen, flexShrink: 0 }}>{"✔"}</span>}
                                    </div>
                                    {row.kind === "missing" && (
                                        <CoreInstallLine language={language} state={installs.states[row.core]} fontSize={modalSize(12)} />
                                    )}
                                </div>
                            </FocusableItem>
                        );
                    })}
                </SlidingWindowRows>
            </Focusable>
            {choices.clockSwitchSafe && (
                <div style={{ ...modalBodyStyle(), marginTop: "10px" }}>
                    {t(language, "Switching between Gambatte and SameBoy is safe for this game: CheevoDeck converts its clock when it launches it. Launching it outside CheevoDeck doesn't.")}
                </div>
            )}
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
