import type { ViewKey } from "../types";

export function getFileWatcherResumeFocusKey(savedView: ViewKey | null | undefined): string | null {
    if (savedView !== "fileWatcher") {
        return null;
    }
    return "fileWatcher:back";
}
