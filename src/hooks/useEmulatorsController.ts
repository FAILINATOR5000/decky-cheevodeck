import { useEffect, useSyncExternalStore } from "react";

import {
    emulatorsForget,
    emulatorsIdentify,
    emulatorsInventory,
    emulatorsPoint,
    type EmulatorInventory,
    type EmulatorKind
} from "../api";
import { askEmulatorQuestion } from "../components/emulators/EmulatorQuestionModal";
import { openPathPicker, type PickedPath } from "../components/pickers/FilePickerModal";
import { t, type LanguageCode } from "../locales";
import { logError } from "../utils/errors";

type EmulatorsLoad = {
    inventory: EmulatorInventory | null;
    failed: boolean;
    loading: boolean;
};

let loaded: EmulatorsLoad = { inventory: null, failed: false, loading: false };
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

async function loadInventory(refresh: boolean) {
    if (loaded.loading) {
        return;
    }
    publish({ loading: true });
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

export function useEmulatorsController(props: { isActive: boolean; language: LanguageCode }) {
    const state = useSyncExternalStore(subscribe, () => loaded);
    const { isActive, language } = props;

    useEffect(() => {
        if (isActive && loaded.inventory === null) {
            void loadInventory(false);
        }
    }, [isActive]);

    return {
        state,
        actions: {
            refresh: () => void loadInventory(true),
            pointTo: (kind: EmulatorKind, name: string) => void pointTo(language, kind, name)
        }
    };
}
