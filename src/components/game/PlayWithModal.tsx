import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useMemo, useState } from "react";

import { multiplayerPlayChoices } from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { PlayChoices, PlayPick } from "../../types";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, modalBodyStyle, warnAmber } from "../../utils/style";
import { CoreInstallLine, useCoreInstalls } from "../emulators/CoreInstall";
import { FocusableItem } from "../ui/FocusableItem";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { ToggleRow } from "../ui/ToggleRow";

const ROWS_INITIAL = 30;
const ROWS_STEP = 30;
const NAV_ENTER_MAINTAIN_Y = 3;

type PlayWithProps = {
    language: LanguageCode;
    gameId: number;
    purpose: "launch" | "set";
    choices: PlayChoices;
    onPick: (pick: PlayPick | null, remember: boolean) => void | Promise<void>;
    onForget: () => Promise<void>;
    close: () => void;
};

type Row =
    | { kind: "heading"; key: string; label: string }
    | { kind: "choice"; key: string; label: string; pick: PlayPick | null; mark?: string; note?: string }
    | { kind: "missing"; key: string; label: string; core: string; mark?: string };

function samePick(a: PlayPick | Record<string, never> | null, b: PlayPick | null): boolean {
    if (a === null || !("appid" in a)) {
        return b === null;
    }
    return b !== null && a.appid === b.appid && a.core === b.core;
}

function rowsOf(language: LanguageCode, choices: PlayChoices): Row[] {
    const own = choices.shortcuts;
    const rows: Row[] = [];
    if (own.length === 1) {
        rows.push({ kind: "choice", key: "own", pick: null,
            label: t(language, "Your shortcut ({{emulator}})", { emulator: own[0].detail }) });
    }
    else if (own.length > 1) {
        rows.push({ kind: "heading", key: "heading:shortcuts", label: t(language, "Your shortcuts") });
        for (const row of own) {
            rows.push({
                kind: "choice",
                key: `own:${row.appid}`,
                label: `${row.name} (${row.detail})`,
                pick: row.default ? null : { appid: row.appid, kind: row.kind, core: "" },
                mark: row.default ? t(language, "Default") : undefined
            });
        }
    }
    else if (choices.recommended) {
        rows.push({ kind: "choice", key: "recommended", pick: null,
            label: t(language, "Recommended ({{emulator}})", { emulator: choices.recommended }) });
    }
    if (choices.cores.length > 0 || choices.missing.length > 0) {
        const recommended = choices.recommendedCore;
        const mark = (core: string) => (core === recommended ? t(language, "Recommended") : undefined);
        const installed: Row[] = choices.cores.map((row) => ({
            kind: "choice",
            key: `core:${row.core}`,
            label: row.label,
            pick: { appid: row.appid, kind: row.kind, core: row.core },
            mark: mark(row.core)
        }));
        const missing: Row[] = choices.missing.map((row) => ({
            kind: "missing", key: `core:${row.core}`, label: row.name, core: row.core, mark: mark(row.core)
        }));
        const first = (row: Row) => row.key === `core:${recommended}`;
        rows.push({ kind: "heading", key: "heading:retroarch", label: "RetroArch" });
        rows.push(...installed.filter(first), ...missing.filter(first),
            ...installed.filter((row) => !first(row)), ...missing.filter((row) => !first(row)));
    }
    if (choices.standalones.length > 0) {
        rows.push({ kind: "heading", key: "heading:standalone", label: t(language, "Standalone") });
        for (const row of choices.standalones) {
            rows.push({
                kind: "choice",
                key: `standalone:${row.appid}`,
                label: row.label,
                pick: { appid: row.appid, kind: row.kind, core: "" },
                note: row.noAchievements ? t(language, "No achievements") : undefined
            });
        }
    }
    return rows;
}

function PlayWithModal(props: PlayWithProps) {
    const { language, gameId, purpose, close } = props;
    const [choices, setChoices] = useState(props.choices);
    const [remember, setRemember] = useState(false);
    const current = purpose === "set" && choices.session !== null ? choices.session : choices.saved;
    const installs = useCoreInstalls(() => {
        multiplayerPlayChoices(gameId)
            .then((found) => {
                if (found.ok) {
                    setChoices(found);
                }
            })
            .catch((e) => logError("play: listing what can play this game after an install", e));
    });

    const rows = useMemo(() => rowsOf(language, choices), [language, choices]);
    const list = useSlidingWindow({
        items: rows,
        itemKey: (row) => row.key,
        focusKeyFor: (row) => `playwith:${row.key}`,
        windowId: "playwith:list",
        heightScope: ["playwith:list", language].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        fullSteps: true,
        prefetchDistance: 4,
        sentinelRootMarginPx: 600,
        resetKey: String(gameId)
    });

    function press(pick: PlayPick | null) {
        if (purpose === "set") {
            void Promise.resolve(props.onPick(pick, remember)).finally(close);
            return;
        }
        close();
        void props.onPick(pick, remember);
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
                        const chosen = row.kind === "choice" && samePick(current, row.pick);
                        return (
                            <FocusableItem
                                key={row.key}
                                outerStyle={{ width: "100%", minWidth: 0 }}
                                focusKey={`playwith:${row.key}`}
                                onClick={() => (row.kind === "choice" ? press(row.pick) : void installs.install(row.core))}
                                onGamepadFocus={() => list.onItemFocus(at)}
                                onGamepadDirection={list.guardTopRow(at)}
                                autoFocus={chosen}
                            >
                                <div style={{ width: "100%", display: "flex", flexDirection: "column", textAlign: "left" }}>
                                    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px" }}>
                                        <span style={{ fontSize: `${modalSize(15)}px`, fontWeight: chosen ? 700 : 500, minWidth: 0, flex: 1 }}>
                                            {row.label}
                                        </span>
                                        {row.kind === "choice" && row.note && <span style={{ ...modalBodyStyle(), flexShrink: 0 }}>{row.note}</span>}
                                        {row.mark && <span style={{ ...modalBodyStyle(), flexShrink: 0 }}>{row.mark}</span>}
                                        {chosen && <span style={{ color: achievementGreen, flexShrink: 0 }}>{"✔"}</span>}
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
            <div style={{ ...modalBodyStyle(), marginTop: "10px" }}>
                {t(language, "Saves don't carry over between emulators, and RetroArch may keep a separate save for each core, although most RetroArch cores work perfectly fine with the same save.")}
            </div>
            {choices.clockSwitchSafe && (
                <div style={{ ...modalBodyStyle(), marginTop: "6px" }}>
                    {t(language, "Switching between Gambatte and SameBoy is safe for this game: CheevoDeck converts its clock when it launches it. Launching it outside CheevoDeck doesn't.")}
                </div>
            )}
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }} flow-children="row">
                <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showPlayWith(options: Omit<PlayWithProps, "close">) {
    showManagedModal((close) => <PlayWithModal {...options} close={close} />);
}
