import { logFocusDebug } from "../api";

type PickedFolder = { path: string; entryId: number | null };

let folder: PickedFolder | null = null;

export function rememberBundleFolder(path: string, entryId: number | null): void {
    logFocusDebug("memoriestransfer-folder", path, "remembered across the picker");
    folder = { path, entryId };
}

export function takeBundleFolder(): PickedFolder | null {
    const held = folder;
    folder = null;
    return held;
}

export function forgetBundleFolder(): void {
    folder = null;
}
