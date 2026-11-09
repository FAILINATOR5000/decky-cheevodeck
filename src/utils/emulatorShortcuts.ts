import { logError } from "./errors";

const OVERVIEW_TRIES = 20;
const OVERVIEW_WAIT_MS = 150;

export type SteamCollection = { id: string; name: string };

export type EmulatorInstall =
    | { via: "flatpak"; id: string; scope: string }
    | { via: "appimage"; path: string };

function shortcutExists(appid: number): boolean {
    try {
        return appid > 0 && appStore.GetAppOverviewByAppID(appid) !== null;
    }
    catch (e) {
        logError("emulators: looking up a shortcut", e);
        return false;
    }
}

export function steamCollections(): SteamCollection[] {
    try {
        const collections: { id: string; displayName?: string; bIsDynamic?: boolean; bAllowsDragAndDrop?: boolean }[] =
            collectionStore.userCollections ?? [];
        return collections
            .filter((collection) => !collection.bIsDynamic && collection.bAllowsDragAndDrop)
            .map((collection) => ({ id: String(collection.id), name: String(collection.displayName || collection.id) }));
    }
    catch (e) {
        logError("emulators: listing Steam collections", e);
        return [];
    }
}

export async function addEmulatorShortcut(name: string, install: EmulatorInstall, collectionId: string, newCollection = ""): Promise<number> {
    let exe = "/usr/bin/flatpak";
    let startDir = "/usr/bin";
    let options = "";
    if (install.via === "flatpak") {
        options = `run --${install.scope === "system" ? "system" : "user"} ${install.id}`;
    }
    else {
        exe = `"${install.path}"`;
        startDir = `"${install.path.slice(0, install.path.lastIndexOf("/")) || "/"}"`;
    }
    const appid: number = await SteamClient.Apps.AddShortcut(name, exe, startDir, options);
    if (typeof appid !== "number" || appid <= 0) {
        return 0;
    }
    SteamClient.Apps.SetShortcutName(appid, name);
    if (options) {
        SteamClient.Apps.SetShortcutLaunchOptions(appid, options);
    }
    for (let tries = 0; tries < OVERVIEW_TRIES && !shortcutExists(appid); tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, OVERVIEW_WAIT_MS));
    }
    if (newCollection) {
        await fileIntoNewCollection(appid, newCollection);
    }
    else if (collectionId) {
        try {
            const collection = collectionStore.GetCollection(collectionId)?.AsDragDropCollection();
            const overview = appStore.GetAppOverviewByAppID(appid);
            if (collection && overview) {
                collection.AddApps([overview]);
            }
        }
        catch (e) {
            logError("emulators: filing a shortcut into a collection", e);
        }
    }
    return appid;
}

async function fileIntoNewCollection(appid: number, name: string) {
    try {
        const overview = appStore.GetAppOverviewByAppID(appid);
        if (!overview) {
            return;
        }
        const existing = collectionStore.GetUserCollectionsByName(name)[0];
        if (existing) {
            existing.AsDragDropCollection()?.AddApps([overview]);
            return;
        }
        if (collectionStore.BIsSystemCollectionName(name)) {
            return;
        }
        await collectionStore.SaveCollection(collectionStore.NewUnsavedCollection(name, undefined, [overview]));
    }
    catch (e) {
        logError("emulators: filing a shortcut into a new collection", e);
    }
}

export function removeEmulatorShortcut(appid: number) {
    if (!shortcutExists(appid)) {
        return;
    }
    try {
        SteamClient.Apps.RemoveShortcut(appid);
    }
    catch (e) {
        logError("emulators: removing a shortcut", e);
    }
}
