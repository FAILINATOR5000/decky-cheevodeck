import { Focusable, PanelSectionRow } from "@decky/ui";
import { useMemo, useRef, useState } from "react";

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
import { OptionToggle } from "../components/options/OptionRows";
import { showMultiplayerProblem } from "../components/multiplayer/ProblemModal";
import type { BackupsChoice, UninstallChoice } from "../hooks/useEmulatorsController";
import { skipWhileHidden } from "../components/panel/skipWhileHidden";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { ButtonHints } from "../components/ui/ButtonHints";
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
const KEEP_KEY = "emulators:keep-backups";
const UPDATE_ALL_KEY = "emulators:update-all";
const RA_KEY = "emulators:row:retroarch:flatpak";
const SYSTEMS_KEY = "emulators:ra:systems";
const STATUS_WIDTH = "35%";
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
    newer: boolean;
    version: string;
    shortcut: boolean;
    install: EmulatorInstall | null;
    image: EmulatorAppImage | null;
    leftovers: EmulatorEntry["leftovers"];
};

type Row =
    | InstallRow
    | { type: "systems"; updates: number; collapsed: boolean }
    | { type: "system"; system: RetroArchSystem; collapsed: boolean }
    | { type: "core"; system: RetroArchSystem; core: RetroArchCore };

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
        newer: ra.flatpak.newerThanStable,
        version: ra.flatpak.version,
        shortcut: ra.flatpak.steam !== null,
        install: ra.flatpak.installed ? { via: "flatpak", id: ra.flatpak.id, scope: ra.flatpak.scope } : null,
        image: null,
        leftovers: []
    }];
    if (ra.configFound) {
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
            newer: flatpak.newerThanStable,
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
                newer: image.newerThanStable,
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
                newer: false,
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
    const { inventory, failed, loading, refreshing } = emulators.state;
    const jobs = emulators.jobs;
    const job = jobs.state;
    const [finishedAtEntry] = useState(jobs.finished);
    const working = jobs.busy && job !== null && job.stage !== "done" && job.stage !== "failed";
    const [foldings, setFoldings] = useState(0);
    const focusedKey = useRef<string | null>(null);

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

    function settling(key: string): boolean {
        return job !== null && job.stage === "done" && job.target === key && jobs.finished !== finishedAtEntry
            && (loading || emulators.state.seen !== jobs.finished);
    }

    function busy(key: string): boolean {
        return activeJob(key) !== null || settling(key);
    }

    function actionFor(row: Row): (() => void) | null {
        const key = rowKey(row);
        if (busy(key)) {
            return null;
        }
        if (row.type === "system") {
            return () => toggle(key);
        }
        if (row.type === "systems") {
            return () => toggle(key);
        }
        if (row.type === "core") {
            if (!row.core.installed) {
                return () => emulators.actions.installCores([row.core.core], key);
            }
            if (row.core.update) {
                return () => emulators.actions.updateCores([row.core.core], key);
            }
            return null;
        }
        if (!row.installed) {
            if (row.image !== null) {
                return null;
            }
            return row.via === "flatpak"
                ? () => emulators.actions.installFlatpak(row.kind, row.name, key)
                : () => emulators.actions.installAppImage(row.kind, row.name, key);
        }
        if (!row.update) {
            return null;
        }
        const image = row.image;
        return image === null
            ? () => emulators.actions.updateFlatpak(row.kind, row.name, key)
            : () => emulators.actions.updateAppImage(image.path, row.name, key);
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

    function whyNot(row: Row | undefined, button: "a" | "x" | "l1" | "r1" | "r2"): string {
        if (row === undefined || row.type === "system" || row.type === "systems") {
            return button === "r1"
                ? t(language, "Only AppImage rows can point to a custom install.")
                : t(language, "Pick an emulator or a core first.");
        }
        const name = row.type === "core" ? row.core.name : row.title;
        if (busy(rowKey(row))) {
            return t(language, "{{name}} is busy right now. Wait for it to finish.", { name });
        }
        if (button === "r1") {
            return t(language, "Only AppImage rows can point to a custom install.");
        }
        if (button === "r2" && row.type === "core") {
            return t(language, "Cores run inside RetroArch, so they don't get their own shortcut.");
        }
        if (button === "r2" && row.type === "install" && row.shortcut) {
            return t(language, "You already have a shortcut for this.");
        }
        if (button === "l1" && row.type === "install" && row.via === "flatpak") {
            return t(language, "Flatpaks don't keep backups. Only AppImages and cores do.");
        }
        if (row.type === "install" && row.image?.missing) {
            return t(language, "This AppImage isn't where it was pointed to anymore. Press R1 to clear it.");
        }
        if (row.type === "core" ? !row.core.installed : !row.installed) {
            return t(language, "{{name}} isn't installed.", { name });
        }
        if (button === "l1") {
            return t(language, "No backups yet. Updating keeps a copy of the old version here.");
        }
        if (row.type === "core" ? row.core.checkFailed : row.checkFailed) {
            return t(language, "Couldn't check {{name}} for updates. Press Refresh to try again.", { name });
        }
        if (row.type === "install" && row.newer) {
            return t(language, "{{name}} is newer than the stable release, so there's nothing to update.", { name });
        }
        return t(language, "{{name}} is up to date.", { name });
    }

    function explain(title: string, text: string) {
        showMultiplayerProblem(language, title, text);
    }

    function pendingUpdates() {
        const stale = rows.filter((row): row is InstallRow => row.type === "install" && row.installed && row.update
            && !row.newer && !row.image?.missing && !busy(row.key));
        const cores = inventory !== null && inventory.retroarch.configFound && !busy(RA_KEY) ? staleCores() : [];
        return { stale, cores };
    }

    function updateEverything() {
        if (inventory === null) {
            return;
        }
        const { stale, cores } = pendingUpdates();
        if (stale.length === 0 && cores.length === 0) {
            explain("Update All", t(language, "Everything is up to date."));
            return;
        }
        for (const row of stale) {
            const image = row.image;
            if (image === null) {
                emulators.actions.updateFlatpak(row.kind, row.name, row.key);
            }
            else {
                emulators.actions.updateAppImage(image.path, row.name, row.key);
            }
        }
        if (cores.length > 0) {
            emulators.actions.updateCores(cores, RA_KEY);
        }
    }

    function updateAllCores() {
        if (inventory === null) {
            return;
        }
        if (!inventory.retroarch.configFound) {
            explain("Update All Cores", t(language, "RetroArch isn't set up yet, so there are no cores to update."));
            return;
        }
        if (busy(RA_KEY)) {
            explain("Update All Cores", t(language, "{{name}} is busy right now. Wait for it to finish.", { name: inventory.retroarch.name }));
            return;
        }
        const stale = staleCores();
        if (stale.length === 0) {
            explain("Update All Cores", t(language, "Every core is up to date."));
            return;
        }
        emulators.actions.updateCores(stale, RA_KEY);
    }

    function handleButton(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;
        if (inventory === null) {
            return;
        }
        if (button === BUTTON_OPTIONS) {
            updateAllCores();
            return;
        }
        const row = rows.find((other) => rowKey(other) === focusedKey.current);
        if (button === BUTTON_SECONDARY) {
            const what = row === undefined ? null : uninstallFor(row);
            if (what !== null && row !== undefined) {
                emulators.actions.uninstall(what, rowKey(row));
            }
            else {
                explain("Uninstall", whyNot(row, "x"));
            }
            return;
        }
        if (button === BUTTON_BUMPER_LEFT) {
            const what = row === undefined ? null : backupsFor(row);
            if (what !== null && row !== undefined) {
                emulators.actions.backups(what, rowKey(row));
            }
            else {
                explain("Backup/Restore", whyNot(row, "l1"));
            }
            return;
        }
        if (button === BUTTON_TRIGGER_RIGHT) {
            const shortcut = row === undefined ? null : shortcutFor(row);
            if (shortcut !== null && row?.type === "install") {
                emulators.actions.addToSteam(row.kind, row.name, shortcut.install, shortcut.storeKey);
            }
            else {
                explain("Non-Steam Shortcut", whyNot(row, "r2"));
            }
            return;
        }
        if (button === BUTTON_BUMPER_RIGHT) {
            if (row?.type !== "install" || row.via !== "appimage" || busy(row.key)) {
                explain("Point to AppImage", whyNot(row, "r1"));
            }
            else if (row.image?.howFound === "pointed") {
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
        if (row.type === "systems") {
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
        const progress = activeJob(key)?.progress ?? (settling(key) ? 100 : null);
        const rowRefreshing = refreshing && row.type === "install";
        return (
            <PanelSectionRow key={key}>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey={key}
                    focusFallback={fallbacks(row, at)}
                    onClick={() => (action !== null ? action() : explain("Install/Update", whyNot(row, "a")))}
                    onGamepadFocus={() => {
                        focusedKey.current = key;
                        rowWindow.onItemFocus(at);
                    }}
                    onGamepadBlur={() => {
                        if (focusedKey.current === key) {
                            focusedKey.current = null;
                        }
                    }}
                    onGamepadDirection={rowWindow.guardTopRow(at)}
                >
                    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <div style={{ flex: "1 1 0", minWidth: 0, textAlign: "left" }}>
                            <div style={{ overflowWrap: "anywhere" }}>{title}</div>
                            {detail && (
                                <div style={{ ...smallTextStyle(), overflowWrap: "anywhere", wordBreak: path ? "break-all" : undefined }}>
                                    {detail}
                                </div>
                            )}
                        </div>
                        <span style={{ ...bodyTextStyle(), flex: `0 0 ${STATUS_WIDTH}`, textAlign: "right", color: status?.color }}>
                            {progress === null && !rowRefreshing && status !== null ? status.text : ""}
                        </span>
                    </div>
                    {(progress !== null || rowRefreshing) && (
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

    const pending = pendingUpdates();
    const updateCount = pending.stale.length + pending.cores.length;

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
                        disabled={refreshing || jobs.busy}
                        onClick={emulators.actions.refresh}
                        onGamepadFocus={() => { focusedKey.current = null; }}
                    >
                        {t(language, "Refresh")}
                    </FocusableItem>
                </PanelSectionRow>

                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey={UPDATE_ALL_KEY}
                        focusFallback={[REFRESH_KEY]}
                        disabled={inventory === null || refreshing}
                        onClick={updateEverything}
                        onGamepadFocus={() => { focusedKey.current = null; }}
                    >
                        {t(language, "Update All ({{count}})", { count: updateCount })}
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
                    <ButtonHints
                        style={state.controllerGlyphStyle}
                        hints={[
                            { button: "a", label: t(language, "Install/Update") },
                            { button: "x", label: t(language, "Uninstall") },
                            { button: "y", label: t(language, "Update All Cores") },
                            { button: "l1", label: t(language, "Backup/Restore") },
                            { button: "r1", label: t(language, "Point to AppImage") },
                            { button: "r2", label: t(language, "Non-Steam Shortcut") }
                        ]}
                    />
                </PanelSectionRow>

                <OptionToggle
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey={KEEP_KEY}
                    label={t(language, "Keep Backups")}
                    help={t(language, "When updating, keep a backup of the previous version, allowing you to restore it if needed.")}
                    value={emulators.state.keepBackups}
                    onChange={emulators.actions.setKeepBackups}
                />

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

                {inventory !== null && <BottomFocusAnchor focusKey="emulators:bottom:anchor" />}
            </PanelSection>
        </Focusable>
    );
}

export default skipWhileHidden(EmulatorsPage, (props) => props.state.view === "emulators");
