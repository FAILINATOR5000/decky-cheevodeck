import { useEffect, useSyncExternalStore } from "react";

import {
    emulatorsCoresOffer,
    emulatorsDeleteBackup,
    emulatorsForget,
    emulatorsIdentify,
    emulatorsInstallAppimage,
    emulatorsInstallCores,
    emulatorsInstallFlatpak,
    emulatorsInventory,
    emulatorsPoint,
    emulatorsRecordShortcut,
    emulatorsRestore,
    emulatorsShortcutChanges,
    emulatorsUninstall,
    emulatorsUpdateAppimage,
    emulatorsUpdateCores,
    emulatorsUpdateFlatpak,
    type EmulatorBackup,
    type EmulatorInventory,
    type EmulatorJobStart,
    type EmulatorKind
} from "../api";
import { askAddToSteam } from "../components/emulators/AddToSteamModal";
import { askBackups } from "../components/emulators/BackupsModal";
import { askEmulatorQuestion } from "../components/emulators/EmulatorQuestionModal";
import { askInstallCores } from "../components/emulators/InstallCoresModal";
import { openPathPicker, type PickedPath } from "../components/pickers/FilePickerModal";
import { t, type LanguageCode } from "../locales";
import { showToastAfter } from "../utils/delayedToast";
import { noteEmulatorJobStarted, useEmulatorJobs } from "../utils/emulatorJobs";
import { addEmulatorShortcut, steamCollections, type EmulatorInstall } from "../utils/emulatorShortcuts";
import { logError } from "../utils/errors";

type EmulatorsLoad = {
    inventory: EmulatorInventory | null;
    failed: boolean;
    loading: boolean;
    seen: number;
};

let loaded: EmulatorsLoad = { inventory: null, failed: false, loading: false, seen: 0 };
const listeners = new Set<() => void>();

function publish(next: Partial<EmulatorsLoad>) {
    loaded = { ...loaded, ...next };
    for (const listener of listeners) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

async function loadInventory(refresh: boolean, seen = loaded.seen) {
    if (loaded.loading) {
        return;
    }
    publish({ loading: true, seen });
    try {
        const result = await emulatorsInventory(refresh);
        publish(result?.ok ? { inventory: result, failed: false } : { failed: true });
    }
    catch (e) {
        logError("emulators: reading the inventory", e);
        publish({ failed: true });
    }
    finally {
        publish({ loading: false });
    }
}

async function pointTo(language: LanguageCode, kind: EmulatorKind, name: string) {
    let picked: PickedPath;
    try {
        picked = await openPathPicker({
            language,
            prompt: t(language, "Choose the {{emulator}} AppImage", { emulator: name }),
            startPath: loaded.inventory?.appsDir ?? "",
            includeFiles: true,
            selectFile: true,
            extensions: [".appimage"]
        });
    }
    catch {
        return;
    }
    try {
        const found = await emulatorsIdentify(picked.realpath);
        if (!found?.ok) {
            return;
        }
        if (found.kind && found.kind !== kind) {
            const other = loaded.inventory?.emulators.find((row) => row.kind === found.kind)?.name ?? found.kind;
            const yes = await askEmulatorQuestion({
                language,
                title: t(language, "Use This AppImage?"),
                text: t(language, "This looks like {{found}}, not {{emulator}}. Use it for {{emulator}} anyway?", {
                    found: other,
                    emulator: name
                }),
                confirm: t(language, "Use It"),
                cancel: t(language, "Cancel")
            });
            if (!yes) {
                return;
            }
        }
        const result = await emulatorsPoint(kind, picked.realpath);
        if (result?.inventory) {
            publish({ inventory: result.inventory });
        }
    }
    catch (e) {
        logError("emulators: pointing to an AppImage", e);
    }
}

async function clearPoint(kind: EmulatorKind, path: string) {
    try {
        const result = await emulatorsForget(kind, path);
        if (result?.inventory) {
            publish({ inventory: result.inventory });
        }
    }
    catch (e) {
        logError("emulators: clearing a custom install", e);
    }
}

function notice(language: LanguageCode, body: string) {
    showToastAfter({ title: t(language, "Manage Emulators"), body, duration: 2000 }, 0);
}

function started(language: LanguageCode, result: EmulatorJobStart | null | undefined, name = "") {
    if (result?.ok) {
        if (result.job) {
            noteEmulatorJobStarted();
        }
        if (!result.job) {
            notice(language, t(language, "Up to date"));
        }
        return;
    }
    if (result?.error === "running") {
        notice(language, name ? t(language, "Close {{name}} first.", { name }) : t(language, "Close RetroArch first."));
    }
    else if (result?.error === "no_network") {
        notice(language, t(language, "Couldn't reach the server."));
    }
    else if (result?.error === "busy") {
        notice(language, t(language, "Another install is running."));
    }
    else {
        notice(language, t(language, "Couldn't start that."));
    }
}

async function installCores(language: LanguageCode, cores: string[], target: string) {
    try {
        started(language, await emulatorsInstallCores(cores, target));
    }
    catch (e) {
        logError("emulators: installing cores", e);
    }
}

async function updateCores(language: LanguageCode, cores: string[], target: string) {
    try {
        started(language, await emulatorsUpdateCores(cores, target));
    }
    catch (e) {
        logError("emulators: updating cores", e);
    }
}

async function installMissingCores(language: LanguageCode, systems: number, target: string) {
    try {
        const offer = await emulatorsCoresOffer();
        if (!offer?.ok) {
            notice(language, t(language, "Couldn't reach the server."));
            return;
        }
        if (offer.recommended.length === 0) {
            notice(language, t(language, "Every system has a core already."));
            return;
        }
        const choice = await askInstallCores(language, { ...offer, systems });
        if (choice !== null) {
            await installCores(language, choice === "all" ? offer.all : offer.recommended, target);
        }
    }
    catch (e) {
        logError("emulators: offering cores", e);
    }
}

async function startEmulatorJob(language: LanguageCode, name: string, start: (force: boolean) => Promise<EmulatorJobStart>) {
    try {
        const result = await start(false);
        if (result?.ok === false && result.error === "newer_than_stable") {
            const replace = await askEmulatorQuestion({
                language,
                title: t(language, "Newer Than Stable"),
                text: t(language, "{{name}} {{installed}} is newer than the stable {{stable}}, probably a nightly or dev build you installed. CheevoDeck leaves it alone unless you choose to replace it.", {
                    name: result.name ?? name,
                    installed: result.installed ?? "",
                    stable: result.stable ?? ""
                }),
                confirm: t(language, "Replace with {{version}}", { version: result.stable ?? "" }),
                cancel: t(language, "Keep Mine")
            });
            if (replace) {
                started(language, await start(true), name);
            }
            return;
        }
        started(language, result, name);
    }
    catch (e) {
        logError("emulators: starting an emulator job", e);
    }
}

async function changeLines(language: LanguageCode, kind: EmulatorKind, name: string): Promise<string[]> {
    let changes: { system: string; current: string }[] = [];
    try {
        const result = await emulatorsShortcutChanges(kind);
        if (result?.ok && Array.isArray(result.changes)) {
            changes = result.changes;
        }
    }
    catch (e) {
        logError("emulators: reading what a shortcut changes", e);
    }
    if (kind === "retroarch") {
        return changes.length > 0
            ? [t(language, "Games without their own shortcut or a remembered Play With… pick will play in RetroArch.")]
            : [];
    }
    return changes.map((change) => change.current
        ? t(language, "{{system}} games without their own shortcut or a remembered Play With… pick will play in {{emulator}} instead of {{current}}.", {
            system: change.system,
            emulator: name,
            current: change.current
        })
        : t(language, "{{system}} games without their own shortcut or a remembered Play With… pick will play in {{emulator}}.", {
            system: change.system,
            emulator: name
        }));
}

async function addToSteam(language: LanguageCode, kind: EmulatorKind, name: string, install: EmulatorInstall, key: string) {
    const lines = await changeLines(language, kind, name);
    const choice = await askAddToSteam(language, {
        defaultName: t(language, "{{name}} (Emulator)", { name }),
        lines,
        collections: steamCollections()
    });
    if (choice === null) {
        return;
    }
    try {
        const appid = await addEmulatorShortcut(choice.name, install, choice.collection, choice.newCollection);
        if (appid <= 0) {
            notice(language, t(language, "Couldn't add it to Steam."));
            return;
        }
        await emulatorsRecordShortcut(key, appid);
        await loadInventory(false);
    }
    catch (e) {
        logError("emulators: adding a shortcut", e);
        notice(language, t(language, "Couldn't add it to Steam."));
    }
}

export type BackupsChoice = { title: string; path: string; backups: EmulatorBackup[] };

async function backups(language: LanguageCode, what: BackupsChoice, target: string) {
    const choice = await askBackups(language, what);
    if (choice === null) {
        return;
    }
    const version = choice.backup.version || t(language, "Unknown version");
    try {
        if (choice.action === "restore") {
            started(language, await emulatorsRestore(what.path, choice.backup.path, target), what.title);
            return;
        }
        const yes = await askEmulatorQuestion({
            language,
            title: t(language, "Delete Backup"),
            text: t(language, "Delete the {{version}} backup? This can't be undone.", { version }),
            path: choice.backup.path,
            confirm: t(language, "Delete"),
            cancel: t(language, "Cancel")
        });
        if (yes) {
            started(language, await emulatorsDeleteBackup(choice.backup.path, target));
        }
    }
    catch (e) {
        logError("emulators: restoring or deleting a backup", e);
    }
}

export type UninstallChoice = {
    kind: EmulatorKind;
    via: "flatpak" | "appimage" | "core";
    item: string;
    title: string;
    name: string;
    path: string;
    shortcut: boolean;
    backups: boolean;
};

async function uninstall(language: LanguageCode, what: UninstallChoice, target: string) {
    const lines = [what.via === "flatpak"
        ? t(language, "Its settings folder is kept.")
        : what.via === "core" ? t(language, "The core file is deleted.") : t(language, "The AppImage file is deleted.")];
    if (what.backups) {
        lines.push(t(language, "Its backups are deleted too."));
    }
    if (what.shortcut) {
        lines.push(t(language, "{{name}}'s shortcut in Steam will stop working.", { name: what.name }));
    }
    const yes = await askEmulatorQuestion({
        language,
        title: t(language, "Uninstall {{name}}?", { name: what.title }),
        text: lines.join("\n"),
        path: what.path || undefined,
        confirm: t(language, "Uninstall"),
        cancel: t(language, "Cancel")
    });
    if (!yes) {
        return;
    }
    try {
        started(language, await emulatorsUninstall(what.kind, what.via, what.item, target), what.name);
    }
    catch (e) {
        logError("emulators: uninstalling", e);
    }
}

export function useEmulatorsController(props: { isActive: boolean; language: LanguageCode }) {
    const state = useSyncExternalStore(subscribe, () => loaded);
    const jobs = useEmulatorJobs();
    const { isActive, language } = props;

    useEffect(() => {
        if (isActive && (loaded.inventory === null || loaded.seen !== jobs.finished)) {
            void loadInventory(false, jobs.finished);
        }
    }, [isActive, jobs.finished]);

    return {
        state,
        jobs,
        actions: {
            refresh: () => void loadInventory(true),
            pointTo: (kind: EmulatorKind, name: string) => void pointTo(language, kind, name),
            clearPoint: (kind: EmulatorKind, path: string) => void clearPoint(kind, path),
            installCores: (cores: string[], target: string) => void installCores(language, cores, target),
            updateCores: (cores: string[], target: string) => void updateCores(language, cores, target),
            installMissingCores: (systems: number, target: string) => void installMissingCores(language, systems, target),
            installFlatpak: (kind: EmulatorKind, name: string, target: string) =>
                void startEmulatorJob(language, name, () => emulatorsInstallFlatpak(kind, target)),
            updateFlatpak: (kind: EmulatorKind, name: string, target: string) =>
                void startEmulatorJob(language, name, (force) => emulatorsUpdateFlatpak(kind, force, target)),
            installAppImage: (kind: EmulatorKind, name: string, target: string) =>
                void startEmulatorJob(language, name, () => emulatorsInstallAppimage(kind, target)),
            updateAppImage: (path: string, name: string, target: string) =>
                void startEmulatorJob(language, name, (force) => emulatorsUpdateAppimage(path, force, target)),
            notice: (body: string) => notice(language, body),
            addToSteam: (kind: EmulatorKind, name: string, install: EmulatorInstall, key: string) =>
                void addToSteam(language, kind, name, install, key),
            uninstall: (what: UninstallChoice, target: string) => void uninstall(language, what, target),
            backups: (what: BackupsChoice, target: string) => void backups(language, what, target)
        }
    };
}
