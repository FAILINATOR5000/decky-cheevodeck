import { logFocusDebug } from "../api";

let folder: string | null = null;

export function rememberBundleFolder(path: string): void {
    logFocusDebug("memoriestransfer-folder", path, "remembered across the picker");
    folder = path;
}

export function takeBundleFolder(): string | null {
    const held = folder;
    folder = null;
    return held;
}

export function forgetBundleFolder(): void {
    folder = null;
}
