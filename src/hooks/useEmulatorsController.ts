import { useEffect, useSyncExternalStore } from "react";

import {
    emulatorsCoresOffer,
    emulatorsForget,
    emulatorsForgetShortcut,
    emulatorsIdentify,
    emulatorsInstallAppimage,
    emulatorsInstallCores,
    emulatorsInstallFlatpak,
    emulatorsInventory,
    emulatorsPoint,
    emulatorsRecordShortcut,
    emulatorsShortcutChanges,
    emulatorsUpdateAppimage,
    emulatorsUpdateCores,
    emulatorsUpdateFlatpak,
    type EmulatorInventory,
    type EmulatorJobStart,
    type EmulatorKind,
    type EmulatorSteam
} from "../api";
import { askAddToSteam } from "../components/emulators/AddToSteamModal";
import { askEmulatorQuestion } from "../components/emulators/EmulatorQuestionModal";
import { askInstallCores } from "../components/emulators/InstallCoresModal";
import { openPathPicker, type PickedPath } from "../components/pickers/FilePickerModal";
import { t, type LanguageCode } from "../locales";
import { showToastAfter } from "../utils/delayedToast";
import { noteEmulatorJobStarted, useEmulatorJobs } from "../utils/emulatorJobs";
import { addEmulatorShortcut, removeEmulatorShortcut, steamCollections, type EmulatorInstall } from "../utils/emulatorShortcuts";
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
                cancel: t(language, "Cancel"),
                focusConfirm: false
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

export async function forgetEmulatorPath(kind: EmulatorKind, path: string) {
    try {
        const result = await emulatorsForget(kind, path);
        if (result?.inventory) {
            publish({ inventory: result.inventory });
        }
    }
    catch (e) {
        logError("emulators: forgetting an AppImage", e);
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
        if (result.kept) {
            notice(language, t(language, "Kept {{count}} cores that are newer", { count: result.kept }));
        }
        else if (!result.job) {
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

async function updateCore(language: LanguageCode, core: string, target: string) {
    try {
        const result = await emulatorsUpdateCores([core], false, false, target);
        if (result?.ok === false && result.error === "newer_than_stable") {
            const replace = await askEmulatorQuestion({
                language,
                title: t(language, "Newer Than Stable"),
                text: t(language, "{{name}} on this device isn't the one from RetroArch {{stable}}'s stable cores, probably a nightly or dev build you installed. CheevoDeck leaves it alone unless you choose to replace it.", {
                    name: result.name ?? core,
                    stable: result.stable ?? ""
                }),
                confirm: t(language, "Replace with Stable"),
                cancel: t(language, "Keep Mine"),
                focusConfirm: false
            });
            if (replace) {
                started(language, await emulatorsUpdateCores([core], true, false, target));
            }
            return;
        }
        started(language, result);
    }
    catch (e) {
        logError("emulators: updating a core", e);
    }
}

async function updateEveryCore(language: LanguageCode, cores: string[], target: string) {
    try {
        started(language, await emulatorsUpdateCores(cores, false, true, target));
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
                cancel: t(language, "Keep Mine"),
                focusConfirm: false
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
        const appid = await addEmulatorShortcut(choice.name, install, choice.collection);
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

async function removeFromSteam(language: LanguageCode, name: string, steam: EmulatorSteam) {
    const remove = await askEmulatorQuestion({
        language,
        title: t(language, "Remove from Steam"),
        text: t(language, "Remove the {{name}} shortcut CheevoDeck added to Steam?", { name }),
        confirm: t(language, "Remove"),
        cancel: t(language, "Cancel"),
        focusConfirm: false
    });
    if (!remove) {
        return;
    }
    try {
        removeEmulatorShortcut(steam.appid);
        await emulatorsForgetShortcut(steam.key);
        await loadInventory(false);
    }
    catch (e) {
        logError("emulators: removing a shortcut", e);
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
            installCores: (cores: string[], target: string) => void installCores(language, cores, target),
            updateCore: (core: string, target: string) => void updateCore(language, core, target),
            updateEveryCore: (cores: string[], target: string) => void updateEveryCore(language, cores, target),
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
            removeFromSteam: (name: string, steam: EmulatorSteam) => void removeFromSteam(language, name, steam)
        }
    };
}
