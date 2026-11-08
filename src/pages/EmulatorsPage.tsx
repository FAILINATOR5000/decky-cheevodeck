import { Focusable, PanelSectionRow } from "@decky/ui";
import { useMemo, useRef, useState } from "react";

import type { EmulatorAppImage, EmulatorEntry, EmulatorInventory, RetroArchCore, RetroArchSystem } from "../api";
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
import { SectionHeaderRow } from "../components/ui/SectionHeaderRow";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { pendingLandingKey, subLandingAhead, usePageLanding } from "../focusRecords";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, ControllerGlyphStyle, ViewKey } from "../types";
import { BUTTON_BUMPER_RIGHT } from "../utils/gamepadButtons";
import { textSize } from "../utils/scale";
import { achievementGreen, bodyTextStyle, regularButtonSpacingStyle } from "../utils/style";

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
    | { type: "appimage"; emulator: EmulatorEntry; image: EmulatorAppImage };

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
    }
}

function isFolded(key: string, byDefault: boolean): boolean {
    return folded.get(key) ?? byDefault;
}

function buildRows(inventory: EmulatorInventory | null): Row[] {
    if (inventory === null) {
        return [];
    }
    const rows: Row[] = [{ type: "ra" }];
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
            rows.push({ type: "flatpak", emulator });
            for (const image of emulator.appimages) {
                rows.push({ type: "appimage", emulator, image });
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

function EmulatorsPage(props: EmulatorsPageProps) {
    const { state, actions } = props;
    const { language } = state;
    const visible = state.view === "emulators";
    const emulators = useEmulators();
    const { inventory, failed, loading } = emulators.state;
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
    }

    function handleButton(evt: { detail?: { button?: number } }) {
        const row = focusedRef.current;
        if (row === null || evt?.detail?.button !== BUTTON_BUMPER_RIGHT) {
            return;
        }
        if (row.type === "emulator" || row.type === "flatpak" || row.type === "appimage") {
            emulators.actions.pointTo(row.emulator.kind, row.emulator.name);
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
        if (row.type === "flatpak" || row.type === "appimage") {
            return [emulatorKey(row.emulator), REFRESH_KEY];
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
        }
        else if (row.type === "core") {
            left = row.core.name;
            right = row.core.installed ? `✔ ${t(language, "Installed")}` : t(language, "Not installed");
            rightColor = row.core.installed ? achievementGreen : undefined;
        }
        else if (row.type === "flatpak") {
            left = flatpakLabel(language, row.emulator);
        }
        else {
            left = appImageLabel(language, row.image);
            help = row.image.path;
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
                        disabled={loading}
                        onClick={emulators.actions.refresh}
                        onGamepadFocus={() => { focusedRef.current = null; }}
                    >
                        {t(language, "Refresh")}
                    </FocusableItem>
                </PanelSectionRow>

                <PanelSectionRow>
                    <ButtonHints
                        style={state.controllerGlyphStyle}
                        hints={[
                            { button: "a", label: t(language, "Details") },
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
