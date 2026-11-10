import { Focusable, PanelSectionRow } from "@decky/ui";
import { useMemo, useState } from "react";

import type {
    EmulatorAppImage,
    EmulatorEntry,
    EmulatorInventory,
    EmulatorJobState,
    EmulatorKind,
    RetroArchCore,
    RetroArchSystem
} from "../api";
import { useEmulators } from "../components/emulators/EmulatorsContext";
import type { BackupsChoice, UninstallChoice } from "../hooks/useEmulatorsController";
import { skipWhileHidden } from "../components/panel/skipWhileHidden";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { ButtonHints, type ButtonHint } from "../components/ui/ButtonHints";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { PanelSection } from "../components/ui/PanelSection";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { pendingLandingKey, subLandingAhead, usePageLanding } from "../focusRecords";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, ControllerGlyphStyle, ViewKey } from "../types";
import { jobErrorText } from "../utils/emulatorJobs";
import type { EmulatorInstall } from "../utils/emulatorShortcuts";
import { BUTTON_BUMPER_LEFT, BUTTON_BUMPER_RIGHT, BUTTON_OPTIONS, BUTTON_SECONDARY, BUTTON_TRIGGER_RIGHT } from "../utils/gamepadButtons";
import { textSize } from "../utils/scale";
import {
    achievementGreen,
    bodyTextStyle,
    errorRed,
    masteredGold,
    regularButtonSpacingStyle,
    smallTextStyle,
    steamPlayGreyText,
    warnAmber
} from "../utils/style";

const BACK_KEY = "emulators:back";
const REFRESH_KEY = "emulators:refresh";
const RA_KEY = "emulators:row:retroarch:flatpak";
const CORES_KEY = "emulators:ra:install-cores";
const SYSTEMS_KEY = "emulators:ra:systems";
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

type InstallRow = {
    type: "install";
    key: string;
    kind: EmulatorKind;
    name: string;
    title: string;
    via: "flatpak" | "appimage";
    installed: boolean;
    update: boolean;
    checkFailed: boolean;
    version: string;
    shortcut: boolean;
    install: EmulatorInstall | null;
    image: EmulatorAppImage | null;
    leftovers: EmulatorEntry["leftovers"];
};

type Row =
    | InstallRow
    | { type: "cores"; count: number }
    | { type: "systems"; updates: number; collapsed: boolean }
    | { type: "system"; system: RetroArchSystem; collapsed: boolean }
    | { type: "core"; system: RetroArchSystem; core: RetroArchCore };

type RowAction = { label: string; run: () => void };

const folded = new Map<string, boolean>();

function systemKey(system: RetroArchSystem): string {
    return `emulators:system:${system.id}`;
}

function coreKey(system: RetroArchSystem, core: RetroArchCore): string {
    return `emulators:core:${system.id}:${core.core}`;
}

function rowKey(row: Row): string {
    switch (row.type) {
        case "install":
            return row.key;
        case "cores":
            return CORES_KEY;
        case "systems":
            return SYSTEMS_KEY;
        case "system":
            return systemKey(row.system);
        case "core":
            return coreKey(row.system, row.core);
    }
}

function isFolded(key: string): boolean {
    return folded.get(key) ?? true;
}

function buildRows(language: LanguageCode, inventory: EmulatorInventory | null): Row[] {
    if (inventory === null) {
        return [];
    }
    const ra = inventory.retroarch;
    const rows: Row[] = [{
        type: "install",
        key: RA_KEY,
        kind: "retroarch",
        name: ra.name,
        title: t(language, "{{emulator}} (Flatpak)", { emulator: ra.name }),
        via: "flatpak",
        installed: ra.flatpak.installed,
        update: ra.flatpak.update,
        checkFailed: ra.flatpak.checkFailed,
        version: ra.flatpak.version,
        shortcut: ra.flatpak.steam !== null,
        install: ra.flatpak.installed ? { via: "flatpak", id: ra.flatpak.id, scope: ra.flatpak.scope } : null,
        image: null,
        leftovers: []
    }];
    if (ra.configFound) {
        const missing = ra.systems.filter((system) => system.hasGames && !system.cores.some((core) => core.installed)).length;
        if (missing > 0) {
            rows.push({ type: "cores", count: missing });
        }
        const updates = new Set(ra.systems.flatMap((system) => system.cores).filter((core) => core.update).map((core) => core.core));
        const hidden = isFolded(SYSTEMS_KEY);
        rows.push({ type: "systems", updates: updates.size, collapsed: hidden });
        for (const system of hidden ? [] : ra.systems) {
            const collapsed = isFolded(systemKey(system));
            rows.push({ type: "system", system, collapsed });
            if (!collapsed) {
                for (const core of system.cores) {
                    rows.push({ type: "core", system, core });
                }
            }
        }
    }
    for (const emulator of inventory.emulators) {
        const { kind, name, flatpak } = emulator;
        rows.push({
            type: "install",
            key: `emulators:row:${kind}:flatpak`,
            kind,
            name,
            title: t(language, "{{emulator}} (Flatpak)", { emulator: name }),
            via: "flatpak",
            installed: flatpak.installed,
            update: flatpak.update,
            checkFailed: flatpak.checkFailed,
            version: flatpak.version,
            shortcut: flatpak.steam !== null,
            install: flatpak.installed ? { via: "flatpak", id: flatpak.id, scope: flatpak.scope } : null,
            image: null,
            leftovers: []
        });
        const images = emulator.appimages.filter((image) => !image.missing);
        emulator.appimages.forEach((image, at) => {
            rows.push({
                type: "install",
                key: at === 0 ? `emulators:row:${kind}:appimage` : `emulators:row:${kind}:appimage:${image.key}`,
                kind,
                name,
                title: at === 0
                    ? t(language, "{{emulator}} (AppImage)", { emulator: name })
                    : t(language, "{{emulator}} (AppImage {{number}})", { emulator: name, number: at + 1 }),
                via: "appimage",
                installed: !image.missing,
                update: image.update,
                checkFailed: image.checkFailed,
                version: image.version,
                shortcut: image.steam !== null,
                install: image.missing ? null : { via: "appimage", path: image.path },
                image,
                leftovers: []
            });
        });
        if (images.length === 0) {
            rows.push({
                type: "install",
                key: `emulators:row:${kind}:appimage`,
                kind,
                name,
                title: t(language, "{{emulator}} (AppImage)", { emulator: name }),
                via: "appimage",
                installed: false,
                update: false,
                checkFailed: false,
                version: "",
                shortcut: false,
                install: null,
                image: null,
                leftovers: emulator.leftovers ?? []
            });
        }
    }
    return rows;
}

function statusOf(language: LanguageCode, installed: boolean, update: boolean, checkFailed: boolean, gone = false) {
    if (!installed) {
        return { text: gone ? t(language, "Not Found") : t(language, "Not Installed"), color: errorRed };
    }
    if (checkFailed) {
        return { text: t(language, "Couldn't check for updates"), color: steamPlayGreyText };
    }
    if (update) {
        return { text: t(language, "Update Found"), color: masteredGold };
    }
    return { text: t(language, "Installed"), color: achievementGreen };
}

function systemStatus(language: LanguageCode, system: RetroArchSystem) {
    const updates = system.cores.filter((core) => core.update).length;
    if (updates > 0) {
        return { text: t(language, "{{count}} updates", { count: updates }), color: masteredGold };
    }
    if (system.cores.some((core) => core.installed)) {
        return { text: t(language, "Installed"), color: achievementGreen };
    }
    return null;
}

function errorLine(language: LanguageCode, state: EmulatorJobState): string {
    return jobErrorText(language, state.error, state.names[0] ?? "", state.kind.endsWith("_cores") || state.target.startsWith("emulators:core:"));
}

function failedLine(language: LanguageCode, state: EmulatorJobState): string {
    const count = state.names.length;
    const name = state.names[0] ?? "";
    if (state.kind === "restore_backup") {
        return t(language, "Couldn't restore {{name}}. Nothing was changed.", { name });
    }
    if (state.kind === "delete_backup") {
        return t(language, "Couldn't delete the backup.");
    }
    if (state.kind === "uninstall") {
        return t(language, "Couldn't uninstall {{name}}.", { name });
    }
    if (state.kind === "install_cores" || state.kind === "install_emulator") {
        return count === 1
            ? t(language, "Couldn't install {{name}}. Nothing was changed.", { name })
            : t(language, "Couldn't install {{count}} cores. Nothing was changed.", { count });
    }
    return count === 1
        ? t(language, "Couldn't update {{name}}. Nothing was changed.", { name })
        : t(language, "Couldn't update {{count}} cores. Nothing was changed.", { count });
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
    const [focusedKey, setFocusedKey] = useState<string | null>(null);

    const rows = useMemo(() => buildRows(language, inventory), [language, inventory, foldings]);

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

    function toggle(key: string) {
        folded.set(key, !isFolded(key));
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
            let opened = false;
            if ((key.startsWith("emulators:core:") || key.startsWith("emulators:system:")) && isFolded(SYSTEMS_KEY)) {
                folded.set(SYSTEMS_KEY, false);
                opened = true;
            }
            for (const system of inventory.retroarch.systems) {
                if (key.startsWith(`emulators:core:${system.id}:`) && isFolded(systemKey(system))) {
                    folded.set(systemKey(system), false);
                    opened = true;
                }
            }
            if (opened) {
                setFoldings((count) => count + 1);
            }
            return opened;
        }
    });

    if (!visible) {
        return null;
    }

    function activeJob(key: string) {
        return jobs.active.find((state) => state.target === key) ?? null;
    }

    function busy(key: string): boolean {
        return activeJob(key) !== null;
    }

    function actionFor(row: Row): RowAction | null {
        const key = rowKey(row);
        if (busy(key)) {
            return null;
        }
        if (row.type === "cores") {
            return { label: t(language, "Install"), run: () => emulators.actions.installMissingCores(row.count, key) };
        }
        if (row.type === "system") {
            return { label: row.collapsed ? t(language, "Show Cores") : t(language, "Hide Cores"), run: () => toggle(key) };
        }
        if (row.type === "systems") {
            return { label: row.collapsed ? t(language, "Show Systems") : t(language, "Hide Systems"), run: () => toggle(key) };
        }
        if (row.type === "core") {
            if (!row.core.installed) {
                return { label: t(language, "Install"), run: () => emulators.actions.installCores([row.core.core], key) };
            }
            if (row.core.update) {
                return { label: t(language, "Update"), run: () => emulators.actions.updateCores([row.core.core], key) };
            }
            return null;
        }
        if (!row.installed) {
            if (row.image !== null) {
                return null;
            }
            return row.via === "flatpak"
                ? { label: t(language, "Install"), run: () => emulators.actions.installFlatpak(row.kind, row.name, key) }
                : { label: t(language, "Install"), run: () => emulators.actions.installAppImage(row.kind, row.name, key) };
        }
        if (!row.update) {
            return null;
        }
        const image = row.image;
        return image === null
            ? { label: t(language, "Update"), run: () => emulators.actions.updateFlatpak(row.kind, row.name, key) }
            : { label: t(language, "Update"), run: () => emulators.actions.updateAppImage(image.path, row.name, key) };
    }

    function uninstallFor(row: Row): UninstallChoice | null {
        if (busy(rowKey(row))) {
            return null;
        }
        if (row.type === "core" && row.core.installed) {
            return {
                kind: "retroarch",
                via: "core",
                item: row.core.core,
                title: row.core.name,
                name: row.core.name,
                path: "",
                shortcut: false,
                backups: row.core.backups.length > 0
            };
        }
        if (row.type !== "install" || !row.installed) {
            return null;
        }
        return {
            kind: row.kind,
            via: row.via,
            item: row.image?.path ?? "",
            title: row.title,
            name: row.name,
            path: row.image?.path ?? "",
            shortcut: row.shortcut,
            backups: row.image !== null && row.image.backups.length > 0
        };
    }

    function backupsFor(row: Row): BackupsChoice | null {
        if (busy(rowKey(row))) {
            return null;
        }
        if (row.type === "core" && row.core.installed && row.core.backups.length > 0) {
            return { title: row.core.name, path: row.core.path, backups: row.core.backups, core: true };
        }
        if (row.type !== "install") {
            return null;
        }
        if (row.image !== null && row.image.backups.length > 0) {
            return { title: row.title, path: row.image.path, backups: row.image.backups, core: false };
        }
        const spare = row.leftovers[0];
        return spare ? { title: row.title, path: spare.target, backups: spare.backups, core: false } : null;
    }

    function shortcutFor(row: Row): { install: EmulatorInstall; storeKey: string } | null {
        if (row.type !== "install" || row.install === null || row.shortcut || busy(row.key)) {
            return null;
        }
        return { install: row.install, storeKey: `${row.kind}:${row.image === null ? "flatpak" : row.image.key}` };
    }

    function staleCores(): string[] {
        if (inventory === null || !inventory.retroarch.configFound) {
            return [];
        }
        return [...new Set(inventory.retroarch.systems.flatMap((system) => system.cores)
            .filter((core) => core.installed && core.update)
            .map((core) => core.core))];
    }

    function hintsFor(row: Row | undefined): ButtonHint[] {
        if (row === undefined) {
            return [];
        }
        const hints: ButtonHint[] = [];
        const action = actionFor(row);
        if (action !== null) {
            hints.push({ button: "a", label: action.label });
        }
        if (uninstallFor(row) !== null) {
            hints.push({ button: "x", label: t(language, "Uninstall") });
        }
        if (backupsFor(row) !== null) {
            hints.push({ button: "l1", label: t(language, "Backup/Restore") });
        }
        if (row.type === "install" && row.key === RA_KEY && staleCores().length > 0 && !busy(RA_KEY)) {
            hints.push({ button: "y", label: t(language, "Update All Cores") });
        }
        if (row.type === "install" && row.via === "appimage" && !busy(row.key)) {
            hints.push({
                button: "r1",
                label: row.image?.howFound === "pointed" ? t(language, "Clear Custom Install") : t(language, "Point to Custom Install")
            });
        }
        if (shortcutFor(row) !== null) {
            hints.push({ button: "r2", label: t(language, "Non-Steam Shortcut") });
        }
        return hints;
    }

    function handleButton(evt: { detail?: { button?: number } }) {
        const row = rows.find((other) => rowKey(other) === focusedKey);
        const button = evt?.detail?.button;
        if (row === undefined || inventory === null) {
            return;
        }
        if (button === BUTTON_SECONDARY) {
            const what = uninstallFor(row);
            if (what !== null) {
                emulators.actions.uninstall(what, rowKey(row));
            }
            return;
        }
        if (button === BUTTON_BUMPER_LEFT) {
            const what = backupsFor(row);
            if (what !== null) {
                emulators.actions.backups(what, rowKey(row));
            }
            return;
        }
        if (button === BUTTON_TRIGGER_RIGHT) {
            const shortcut = shortcutFor(row);
            if (shortcut !== null && row.type === "install") {
                emulators.actions.addToSteam(row.kind, row.name, shortcut.install, shortcut.storeKey);
            }
            return;
        }
        if (button === BUTTON_OPTIONS && row.type === "install" && row.key === RA_KEY && !busy(RA_KEY)) {
            const stale = staleCores();
            if (stale.length > 0) {
                emulators.actions.updateCores(stale, RA_KEY);
            }
            return;
        }
        if (button === BUTTON_BUMPER_RIGHT && row.type === "install" && row.via === "appimage" && !busy(row.key)) {
            if (row.image?.howFound === "pointed") {
                emulators.actions.clearPoint(row.kind, row.image.path);
            }
            else {
                emulators.actions.pointTo(row.kind, row.name);
            }
        }
    }

    function fallbacks(row: Row, at: number): string[] {
        const near = [rows[at + 1], rows[at - 1]].filter((other): other is Row => other !== undefined).map(rowKey);
        if (row.type === "core") {
            return [...near, systemKey(row.system), RA_KEY, REFRESH_KEY];
        }
        if (row.type === "install" && row.via === "appimage" && row.key !== `emulators:row:${row.kind}:appimage`) {
            return [`emulators:row:${row.kind}:appimage`, ...near, REFRESH_KEY];
        }
        return [...near, REFRESH_KEY];
    }

    function renderRow(row: Row, at: number) {
        const key = rowKey(row);
        const action = actionFor(row);
        let title = "";
        let detail = "";
        let path = false;
        let status: { text: string; color: string } | null = null;
        if (row.type === "cores") {
            title = t(language, "Install Cores for {{count}} Systems", { count: row.count });
        }
        else if (row.type === "systems") {
            title = `${row.collapsed ? "▸" : "▾"} ${t(language, "Cores by System")}`;
            status = row.updates > 0
                ? { text: t(language, "{{count}} updates", { count: row.updates }), color: masteredGold }
                : null;
        }
        else if (row.type === "system") {
            title = `${row.collapsed ? "▸" : "▾"} ${t(language, "{{system}} · {{installed}} of {{count}} cores installed", {
                system: row.system.name,
                installed: row.system.cores.filter((core) => core.installed).length,
                count: row.system.cores.length
            })}`;
            status = systemStatus(language, row.system);
        }
        else if (row.type === "core") {
            title = row.core.name;
            status = statusOf(language, row.core.installed, row.core.update, row.core.checkFailed);
        }
        else {
            title = row.title;
            if (row.image?.howFound === "pointed") {
                detail = row.image.path;
                path = true;
            }
            else if (row.installed && row.version) {
                detail = row.version;
            }
            status = statusOf(language, row.installed, row.update, row.checkFailed, row.image?.missing);
        }
        const progress = activeJob(key)?.progress ?? null;
        const refreshing = loading && row.type === "install";
        return (
            <PanelSectionRow key={key}>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey={key}
                    focusFallback={fallbacks(row, at)}
                    onClick={() => action?.run()}
                    onGamepadFocus={() => {
                        setFocusedKey(key);
                        rowWindow.onItemFocus(at);
                    }}
                    onGamepadBlur={() => setFocusedKey((current) => (current === key ? null : current))}
                    onGamepadDirection={rowWindow.guardTopRow(at)}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                            <div style={{ overflowWrap: "anywhere" }}>{title}</div>
                            {detail && (
                                <div style={{ ...smallTextStyle(), overflowWrap: "anywhere", wordBreak: path ? "break-all" : undefined }}>
                                    {detail}
                                </div>
                            )}
                        </div>
                        {progress === null && !refreshing && status !== null && (
                            <span style={{ ...bodyTextStyle(), flex: "0 1 auto", maxWidth: "50%", textAlign: "right", color: status.color }}>
                                {status.text}
                            </span>
                        )}
                    </div>
                    {row.type === "install" && row.key === RA_KEY && inventory !== null && inventory.retroarch.configFound && row.installed
                        && !busy(RA_KEY) && (
                        <div style={{ marginTop: "6px" }}>
                            <ButtonHints
                                style={state.controllerGlyphStyle}
                                dense
                                hints={[{
                                    button: "y",
                                    label: staleCores().length > 0
                                        ? `${t(language, "Update All Cores")} · ${t(language, "{{count}} updates", { count: staleCores().length })}`
                                        : `${t(language, "Update All Cores")} · ${t(language, "Up to date")}`
                                }]}
                            />
                        </div>
                    )}
                    {(progress !== null || refreshing) && (
                        <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <ProgressBar fraction={progress !== null && progress >= 0 ? progress / 100 : null} />
                            </div>
                            {progress !== null && progress >= 0 && <span style={bodyTextStyle()}>{`${progress}%`}</span>}
                        </div>
                    )}
                </FocusableItem>
            </PanelSectionRow>
        );
    }

    const focusedRow = rows.find((row) => rowKey(row) === focusedKey);

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
                        onGamepadFocus={() => setFocusedKey(null)}
                    >
                        {t(language, "Refresh")}
                    </FocusableItem>
                </PanelSectionRow>

                {job !== null && !working && job.stage === "failed" && (
                    <PanelSectionRow>
                        <div style={{ ...bodyTextStyle(), color: warnAmber }}>
                            <div>{failedLine(language, job)}</div>
                            {errorLine(language, job) && <div>{errorLine(language, job)}</div>}
                            {job.left.length > 0 && (
                                <div style={{ overflowWrap: "anywhere", wordBreak: "break-all" }}>
                                    {t(language, "Couldn't put these back: {{files}}", { files: job.left.join(", ") })}
                                </div>
                            )}
                        </div>
                    </PanelSectionRow>
                )}

                <PanelSectionRow>
                    <div style={{ minHeight: `${Math.round(textSize(11) * 1.35 * 2 + 10)}px` }}>
                        <ButtonHints style={state.controllerGlyphStyle} dense hints={hintsFor(focusedRow)} />
                    </div>
                </PanelSectionRow>

                {inventory === null && (
                    <PanelSectionRow>
                        {failed
                            ? <div style={bodyTextStyle()}>{t(language, "Couldn't read the emulators.")}</div>
                            : <InlineSpinner label={t(language, "Looking for emulators...")} />}
                    </PanelSectionRow>
                )}

                <SlidingWindowRows list={rowWindow}>
                    {rowWindow.mountedItems.map((row, index) => renderRow(row, rowWindow.start + index))}
                </SlidingWindowRows>

                <BottomFocusAnchor focusKey="emulators:bottom:anchor" />
            </PanelSection>
        </Focusable>
    );
}

export default skipWhileHidden(EmulatorsPage, (props) => props.state.view === "emulators");
