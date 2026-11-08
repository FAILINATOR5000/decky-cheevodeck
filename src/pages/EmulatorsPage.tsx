import { Focusable, PanelSectionRow } from "@decky/ui";
import { useMemo, useRef, useState } from "react";

import type {
    EmulatorAppImage,
    EmulatorEntry,
    EmulatorInventory,
    EmulatorJobState,
    EmulatorKind,
    EmulatorSteam,
    RetroArchCore,
    RetroArchSystem
} from "../api";
import { openEmulatorDetails } from "../components/emulators/EmulatorDetailsModal";
import { useEmulators } from "../components/emulators/EmulatorsContext";
import { skipWhileHidden } from "../components/panel/skipWhileHidden";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { ButtonHints } from "../components/ui/ButtonHints";
import { CollapsibleTitle } from "../components/ui/CollapsibleTitle";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { PanelSection } from "../components/ui/PanelSection";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SectionHeaderRow } from "../components/ui/SectionHeaderRow";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { pendingLandingKey, subLandingAhead, usePageLanding } from "../focusRecords";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, ControllerGlyphStyle, ViewKey } from "../types";
import type { EmulatorInstall } from "../utils/emulatorShortcuts";
import { BUTTON_BUMPER_RIGHT, BUTTON_OPTIONS, BUTTON_SECONDARY } from "../utils/gamepadButtons";
import { textSize } from "../utils/scale";
import { achievementGreen, bodyTextStyle, regularButtonSpacingStyle, warnAmber } from "../utils/style";

const BACK_KEY = "emulators:back";
const REFRESH_KEY = "emulators:refresh";
const RA_KEY = "emulators:ra";
const ROWS_INITIAL = 24;
const ROWS_STEP = 24;
const SENTINEL_ROOT_MARGIN_PX = 600;
const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

type EmulatorsPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    controllerGlyphStyle: ControllerGlyphStyle;
};

type EmulatorsPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type EmulatorsPageProps = {
    state: EmulatorsPageState;
    actions: EmulatorsPageActions;
};

type Row =
    | { type: "ra" }
    | { type: "system"; system: RetroArchSystem; collapsed: boolean }
    | { type: "core"; system: RetroArchSystem; core: RetroArchCore }
    | { type: "emulator"; emulator: EmulatorEntry; collapsed: boolean }
    | { type: "flatpak"; emulator: EmulatorEntry }
    | { type: "appimage"; emulator: EmulatorEntry; image: EmulatorAppImage }
    | { type: "offer"; emulator: EmulatorEntry }
    | {
        type: "steam";
        focusKey: string;
        anchor: string;
        title: string;
        kind: EmulatorKind;
        name: string;
        install: EmulatorInstall;
        steam: EmulatorSteam | null;
        storeKey: string;
        file: string;
    };

const folded = new Map<string, boolean>();

function systemKey(system: RetroArchSystem): string {
    return `emulators:ra:sys:${system.id}`;
}

function coreKey(system: RetroArchSystem, core: RetroArchCore): string {
    return `emulators:ra:core:${system.id}:${core.core}`;
}

function emulatorKey(emulator: EmulatorEntry): string {
    return `emulators:emu:${emulator.kind}`;
}

function rowKey(row: Row): string {
    switch (row.type) {
        case "ra":
            return RA_KEY;
        case "system":
            return systemKey(row.system);
        case "core":
            return coreKey(row.system, row.core);
        case "emulator":
            return emulatorKey(row.emulator);
        case "flatpak":
            return `${emulatorKey(row.emulator)}:flatpak`;
        case "appimage":
            return `${emulatorKey(row.emulator)}:appimage:${row.image.key}`;
        case "offer":
            return `${emulatorKey(row.emulator)}:appimage:new`;
        case "steam":
            return row.focusKey;
    }
}

function isFolded(key: string, byDefault: boolean): boolean {
    return folded.get(key) ?? byDefault;
}

function steamRow(owner: string, anchor: string, title: string, kind: EmulatorKind, name: string, install: EmulatorInstall,
    steam: EmulatorSteam | null, storeKey: string, file: string): Row[] {
    if (steam !== null && !steam.ours) {
        return [];
    }
    const which = install.via === "flatpak" ? "flatpak" : storeKey.split(":")[1];
    const focusKey = `${owner}:${steam === null ? "addsteam" : "removesteam"}${owner === RA_KEY ? "" : `:${which}`}`;
    return [{ type: "steam", focusKey, anchor, title, kind, name, install, steam, storeKey, file }];
}

function buildRows(inventory: EmulatorInventory | null): Row[] {
    if (inventory === null) {
        return [];
    }
    const rows: Row[] = [{ type: "ra" }];
    const ra = inventory.retroarch;
    if (ra.flatpak.installed) {
        rows.push(...steamRow(RA_KEY, RA_KEY, RA_KEY, "retroarch", ra.name,
            { via: "flatpak", id: ra.flatpak.id, scope: ra.flatpak.scope }, ra.flatpak.steam, "retroarch:flatpak", ""));
    }
    for (const system of inventory.retroarch.systems) {
        const collapsed = isFolded(systemKey(system), !system.hasGames);
        rows.push({ type: "system", system, collapsed });
        if (!collapsed) {
            for (const core of system.cores) {
                rows.push({ type: "core", system, core });
            }
        }
    }
    for (const emulator of inventory.emulators) {
        const collapsed = isFolded(emulatorKey(emulator), false);
        rows.push({ type: "emulator", emulator, collapsed });
        if (!collapsed) {
            const title = emulatorKey(emulator);
            rows.push({ type: "flatpak", emulator });
            if (emulator.flatpak.installed) {
                rows.push(...steamRow(title, `${title}:flatpak`, title, emulator.kind, emulator.name,
                    { via: "flatpak", id: emulator.flatpak.id, scope: emulator.flatpak.scope }, emulator.flatpak.steam,
                    `${emulator.kind}:flatpak`, ""));
            }
            for (const image of emulator.appimages) {
                rows.push({ type: "appimage", emulator, image });
                if (!image.missing) {
                    rows.push(...steamRow(title, `${title}:appimage:${image.key}`, title, emulator.kind, emulator.name,
                        { via: "appimage", path: image.path }, image.steam, `${emulator.kind}:${image.key}`, image.fileName));
                }
            }
            if (!emulator.appimages.some((image) => !image.missing)) {
                rows.push({ type: "offer", emulator });
            }
        }
    }
    return rows;
}

function flatpakLabel(language: LanguageCode, emulator: EmulatorEntry): string {
    const flatpak = emulator.flatpak;
    if (!flatpak.installed) {
        return t(language, "Flatpak · Not installed");
    }
    return flatpak.scope === "system"
        ? t(language, "Flatpak · {{version}} · system", { version: flatpak.version || "?" })
        : t(language, "Flatpak · {{version}} · user", { version: flatpak.version || "?" });
}

function appImageLabel(language: LanguageCode, image: EmulatorAppImage): string {
    if (image.missing) {
        return t(language, "AppImage · {{file}} · Missing", { file: image.fileName });
    }
    return image.version
        ? t(language, "AppImage · {{version}} · {{file}}", { version: image.version, file: image.fileName })
        : t(language, "AppImage · {{file}}", { file: image.fileName });
}

function emulatorTitle(language: LanguageCode, emulator: EmulatorEntry): string {
    if (!emulator.found) {
        return t(language, "{{emulator}} · Not found", { emulator: emulator.name });
    }
    return emulator.achievements ? emulator.name : t(language, "{{emulator}} · No achievements", { emulator: emulator.name });
}

const ERROR_LINES: Record<string, string> = {
    no_space: "Not enough free space.",
    no_network: "Couldn't reach the download server.",
    unsafe: "A file wasn't the way CheevoDeck expected, so it stopped."
};

function errorLine(language: LanguageCode, state: EmulatorJobState): string {
    if (state.error === "running") {
        return state.kind.endsWith("_cores")
            ? t(language, "Close RetroArch first.")
            : t(language, "Close {{name}} first.", { name: state.names[0] ?? "" });
    }
    return ERROR_LINES[state.error] ? t(language, ERROR_LINES[state.error]) : "";
}

function jobLine(language: LanguageCode, state: EmulatorJobState): string {
    const count = state.names.length;
    const name = state.names[0] ?? "";
    const installing = state.kind === "install_cores" || state.kind === "install_emulator";
    if (state.stage === "failed") {
        if (installing) {
            return count === 1
                ? t(language, "Couldn't install {{name}}. Nothing was changed.", { name })
                : t(language, "Couldn't install {{count}} cores. Nothing was changed.", { count });
        }
        return count === 1
            ? t(language, "Couldn't update {{name}}. Nothing was changed.", { name })
            : t(language, "Couldn't update {{count}} cores. Nothing was changed.", { count });
    }
    let line: string;
    if (state.stage === "download" && !state.kind.endsWith("_cores")) {
        line = t(language, "Downloading {{name}}...", { name });
    }
    else if (state.stage === "download") {
        line = t(language, "Downloading RetroArch's stable cores...");
    }
    else if (state.stage === "extract") {
        line = t(language, "Unpacking cores...");
    }
    else if (installing) {
        line = count === 1 ? t(language, "Installing {{name}}...", { name }) : t(language, "Installing {{count}} cores...", { count });
    }
    else {
        line = count === 1 ? t(language, "Updating {{name}}...", { name }) : t(language, "Updating {{count}} cores...", { count });
    }
    return state.progress >= 0 ? `${line} ${state.progress}%` : line;
}

function EmulatorsPage(props: EmulatorsPageProps) {
    const { state, actions } = props;
    const { language } = state;
    const visible = state.view === "emulators";
    const emulators = useEmulators();
    const { inventory, failed, loading } = emulators.state;
    const jobs = emulators.jobs;
    const job = jobs.state;
    const working = jobs.busy && job !== null && job.stage !== "done" && job.stage !== "failed";
    const [foldings, setFoldings] = useState(0);
    const focusedRef = useRef<Row | null>(null);

    const rows = useMemo(() => buildRows(inventory), [inventory, foldings]);

    const rowWindow = useSlidingWindow({
        items: rows,
        itemKey: rowKey,
        focusKeyFor: rowKey,
        windowId: "emulators:rows",
        heightScope: ["emulators:rows", language, textSize(12)].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        prefetchDistance: 0,
        sentinelRootMarginPx: SENTINEL_ROOT_MARGIN_PX,
        resetKey: "emulators",
        openFirst: pendingLandingKey("emulators") ?? undefined
    });

    function toggle(key: string, byDefault: boolean) {
        folded.set(key, !isFolded(key, byDefault));
        setFoldings((count) => count + 1);
    }

    usePageLanding({
        view: "emulators",
        active: visible,
        defaultKey: BACK_KEY,
        ready: inventory !== null || failed,
        holds: (key) => rows.some((row) => rowKey(row) === key),
        open: (key) => rowWindow.openAt(key),
        reveal: (key) => {
            if (inventory === null) {
                return false;
            }
            for (const system of inventory.retroarch.systems) {
                if (key.startsWith(`emulators:ra:core:${system.id}:`) && isFolded(systemKey(system), !system.hasGames)) {
                    toggle(systemKey(system), !system.hasGames);
                    return true;
                }
            }
            for (const emulator of inventory.emulators) {
                if (key.startsWith(`${emulatorKey(emulator)}:`) && isFolded(emulatorKey(emulator), false)) {
                    toggle(emulatorKey(emulator), false);
                    return true;
                }
            }
            return false;
        }
    });

    if (!visible) {
        return null;
    }

    function details(row: Row) {
        if (inventory === null) {
            return;
        }
        if (row.type === "ra") {
            const ra = inventory.retroarch;
            openEmulatorDetails(language, { type: "retroarch", name: ra.name, flatpak: ra.flatpak, coresDir: ra.coresDir, found: ra.found });
        }
        else if (row.type === "core") {
            const systems = inventory.retroarch.systems
                .filter((system) => system.cores.some((core) => core.core === row.core.core))
                .map((system) => system.name);
            openEmulatorDetails(language, { type: "core", core: row.core, coresDir: inventory.retroarch.coresDir, systems });
        }
        else if (row.type === "flatpak") {
            openEmulatorDetails(language, { type: "flatpak", emulator: row.emulator });
        }
        else if (row.type === "appimage") {
            openEmulatorDetails(language, { type: "appimage", emulator: row.emulator, image: row.image });
        }
        else if (row.type === "offer") {
            openEmulatorDetails(language, { type: "offer", emulator: row.emulator, appsDir: inventory.appsDir });
        }
        else if (row.type === "steam" && row.steam === null) {
            emulators.actions.addToSteam(row.kind, row.name, row.install, row.storeKey);
        }
        else if (row.type === "steam" && row.steam !== null) {
            emulators.actions.removeFromSteam(row.name, row.steam);
        }
    }

    function handleButton(evt: { detail?: { button?: number } }) {
        const row = focusedRef.current;
        const button = evt?.detail?.button;
        if (row === null || inventory === null) {
            return;
        }
        if (button === BUTTON_BUMPER_RIGHT) {
            if (row.type === "emulator" || row.type === "flatpak" || row.type === "appimage" || row.type === "offer") {
                emulators.actions.pointTo(row.emulator.kind, row.emulator.name);
            }
            return;
        }
        if (button !== BUTTON_SECONDARY && button !== BUTTON_OPTIONS) {
            return;
        }
        const key = rowKey(row);
        if (row.type === "ra" && !inventory.retroarch.found) {
            if (button === BUTTON_SECONDARY) {
                emulators.actions.installFlatpak("retroarch", inventory.retroarch.name, key);
            }
            return;
        }
        if (row.type === "flatpak") {
            const { emulator } = row;
            if (button === BUTTON_SECONDARY && !emulator.flatpak.installed) {
                emulators.actions.installFlatpak(emulator.kind, emulator.name, key);
            }
            else if (button === BUTTON_OPTIONS && emulator.flatpak.installed) {
                if (emulator.flatpak.update || emulator.flatpak.newerThanStable) {
                    emulators.actions.updateFlatpak(emulator.kind, emulator.name, key);
                }
                else {
                    emulators.actions.notice(t(language, "Up to date"));
                }
            }
            return;
        }
        if (row.type === "offer") {
            if (button === BUTTON_SECONDARY) {
                emulators.actions.installAppImage(row.emulator.kind, row.emulator.name, key);
            }
            return;
        }
        if (row.type === "appimage") {
            if (button === BUTTON_OPTIONS && !row.image.missing) {
                if (row.image.update || row.image.newerThanStable) {
                    emulators.actions.updateAppImage(row.image.path, row.emulator.name, key);
                }
                else {
                    emulators.actions.notice(t(language, "Up to date"));
                }
            }
            return;
        }
        if (row.type === "ra" && inventory.retroarch.configFound) {
            const systems = inventory.retroarch.systems;
            if (button === BUTTON_SECONDARY) {
                const missing = systems.filter((system) => system.hasGames && !system.cores.some((core) => core.installed)).length;
                emulators.actions.installMissingCores(missing, key);
                return;
            }
            const stale = [...new Set(systems.flatMap((system) => system.cores)
                .filter((core) => core.update || core.newerThanStable)
                .map((core) => core.core))];
            if (stale.length === 0) {
                emulators.actions.notice(t(language, "Up to date"));
                return;
            }
            emulators.actions.updateEveryCore(stale, key);
            return;
        }
        if (row.type === "core") {
            if (button === BUTTON_SECONDARY) {
                if (!row.core.installed) {
                    emulators.actions.installCores([row.core.core], key);
                }
                return;
            }
            if (!row.core.installed) {
                return;
            }
            if (row.core.update || row.core.newerThanStable) {
                emulators.actions.updateCore(row.core.core, key);
                return;
            }
            emulators.actions.notice(t(language, "Up to date"));
        }
    }

    function fallbacks(row: Row, at: number): string[] {
        if (row.type === "core") {
            const siblings = [rows[at + 1], rows[at - 1]]
                .filter((other): other is Extract<Row, { type: "core" }> => other?.type === "core" && other.system.id === row.system.id)
                .map(rowKey);
            return [...siblings, systemKey(row.system), RA_KEY, REFRESH_KEY];
        }
        if (row.type === "system" || row.type === "emulator") {
            const titles = rows.filter((other) => other.type === row.type).map(rowKey);
            const own = titles.indexOf(rowKey(row));
            const near = [titles[own + 1], titles[own - 1]].filter((key): key is string => key !== undefined);
            return [...near, ...(row.type === "system" ? [RA_KEY] : []), REFRESH_KEY];
        }
        if (row.type === "flatpak" || row.type === "appimage" || row.type === "offer") {
            return [emulatorKey(row.emulator), REFRESH_KEY];
        }
        if (row.type === "steam") {
            return row.anchor === row.title ? [row.title, REFRESH_KEY] : [row.anchor, row.title, REFRESH_KEY];
        }
        return [REFRESH_KEY];
    }

    function renderRow(row: Row, at: number) {
        const key = rowKey(row);
        const focus = () => {
            focusedRef.current = row;
            rowWindow.onItemFocus(at);
        };
        if (row.type === "system" || row.type === "emulator") {
            const label = row.type === "system"
                ? t(language, "{{system}} · {{installed}} of {{total}} cores installed", {
                    system: row.system.name,
                    installed: row.system.cores.filter((core) => core.installed).length,
                    total: row.system.cores.length
                })
                : emulatorTitle(language, row.emulator);
            const byDefault = row.type === "system" ? !row.system.hasGames : false;
            return (
                <SectionHeaderRow key={key} first={at === 0}>
                    <CollapsibleTitle
                        label={label}
                        collapsed={row.collapsed}
                        focusKey={key}
                        focusFallback={fallbacks(row, at)}
                        preserveCase
                        onToggle={() => toggle(key, byDefault)}
                        onGamepadFocus={focus}
                        onGamepadDirection={rowWindow.guardTopRow(at)}
                    />
                </SectionHeaderRow>
            );
        }
        let left = "";
        let right = "";
        let rightColor: string | undefined;
        let help: string | undefined;
        if (row.type === "ra") {
            const ra = inventory!.retroarch;
            left = ra.name;
            right = ra.flatpak.installed ? ra.flatpak.version : ra.found ? "" : t(language, "Not found");
            if (ra.updates > 0) {
                right = `${right} · ${t(language, "{{count}} updates", { count: ra.updates })}`;
                rightColor = warnAmber;
            }
        }
        else if (row.type === "core") {
            left = row.core.name;
            if (row.core.update) {
                right = t(language, "Update available");
                rightColor = warnAmber;
            }
            else {
                right = row.core.installed ? `✔ ${t(language, "Installed")}` : t(language, "Not installed");
                rightColor = row.core.installed ? achievementGreen : undefined;
            }
        }
        else if (row.type === "flatpak") {
            left = flatpakLabel(language, row.emulator);
            if (row.emulator.flatpak.update) {
                right = t(language, "Update available");
                rightColor = warnAmber;
            }
        }
        else if (row.type === "offer") {
            left = t(language, "AppImage · Not installed");
        }
        else if (row.type === "steam") {
            if (row.steam === null) {
                left = row.file ? t(language, "Add {{file}} to Steam", { file: row.file }) : t(language, "Add Flatpak to Steam");
            }
            else {
                left = row.file ? t(language, "Remove {{file}} from Steam", { file: row.file }) : t(language, "Remove Flatpak from Steam");
            }
        }
        else {
            left = appImageLabel(language, row.image);
            help = row.image.path;
            if (row.image.update) {
                right = t(language, "Update available");
                rightColor = warnAmber;
            }
        }
        return (
            <PanelSectionRow key={key}>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey={key}
                    focusFallback={fallbacks(row, at)}
                    help={help}
                    onClick={() => details(row)}
                    onGamepadFocus={focus}
                    onGamepadDirection={rowWindow.guardTopRow(at)}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{left}</span>
                        {right && <span style={{ ...bodyTextStyle(), flexShrink: 0, color: rightColor }}>{right}</span>}
                    </div>
                    {working && job.target === key && (
                        <div style={{ marginTop: "6px" }}>
                            <ProgressBar fraction={job.progress >= 0 ? job.progress / 100 : null} />
                        </div>
                    )}
                </FocusableItem>
            </PanelSectionRow>
        );
    }

    return (
        <Focusable flow-children="column" onButtonDown={handleButton}>
            <PanelSection>
                <PageNavStrip title={t(language, "Manage Emulators")} buttonSpacing={state.buttonSpacing} onHome={actions.onHome} />

                <BackButton
                    label={t(language, "Back")}
                    focusKey={BACK_KEY}
                    navAutoFocus
                    standDown={subLandingAhead("emulators", 0)}
                    buttonSpacing={state.buttonSpacing}
                    onClick={actions.onBack}
                    scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
                />

                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey={REFRESH_KEY}
                        disabled={loading || jobs.busy}
                        onClick={emulators.actions.refresh}
                        onGamepadFocus={() => { focusedRef.current = null; }}
                    >
                        {t(language, "Refresh")}
                    </FocusableItem>
                </PanelSectionRow>

                {job !== null && (working || job.stage === "failed") && (
                    <PanelSectionRow>
                        <div style={{ ...bodyTextStyle(), color: job.stage === "failed" ? warnAmber : undefined }}>
                            <div>{jobLine(language, job)}</div>
                            {job.stage === "failed" && errorLine(language, job) && <div>{errorLine(language, job)}</div>}
                            {job.left.length > 0 && <div>{t(language, "Couldn't put these back: {{files}}", { files: job.left.join(", ") })}</div>}
                        </div>
                    </PanelSectionRow>
                )}

                <PanelSectionRow>
                    <ButtonHints
                        style={state.controllerGlyphStyle}
                        hints={[
                            { button: "a", label: t(language, "Details") },
                            { button: "x", label: t(language, "Install") },
                            { button: "y", label: t(language, "Update") },
                            { button: "r1", label: t(language, "Point to AppImage") }
                        ]}
                    />
                </PanelSectionRow>

                {inventory === null && (
                    <PanelSectionRow>
                        {failed
                            ? <div style={bodyTextStyle()}>{t(language, "Couldn't read the emulators.")}</div>
                            : <InlineSpinner label={t(language, "Looking for emulators...")} />}
                    </PanelSectionRow>
                )}

                <Focusable flow-children="column" resetNavOnEntry>
                    <SlidingWindowRows list={rowWindow}>
                        {rowWindow.mountedItems.map((row, index) => renderRow(row, rowWindow.start + index))}
                    </SlidingWindowRows>
                </Focusable>

                <BottomFocusAnchor focusKey="emulators:bottom:anchor" />
            </PanelSection>
        </Focusable>
    );
}

export default skipWhileHidden(EmulatorsPage, (props) => props.state.view === "emulators");
