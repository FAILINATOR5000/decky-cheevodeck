import { toaster } from "@decky/api";

import { saveMemoryMedia } from "../api";
import { openPathPicker } from "../components/pickers/FilePickerModal";
import { t, type LanguageCode } from "../locales";
import { logError } from "./errors";

const TOAST_DURATION_MS = 3000;

const PICKER_START_PATH = "/home/deck";

function failureLine(error: string | undefined): string {
    switch (error) {
        case "no_tools":
            return "This clip needs ffmpeg to convert, and it isn't installed.";
        case "remux_failed":
            return "Couldn't convert this clip to MP4.";
        case "bad_target":
            return "That folder isn't there any more.";
        case "no_source":
            return "The file behind this memory is missing.";
        default:
            return "Couldn't write the file.";
    }
}

export async function saveMemoryToFolder(
    gameId: number,
    memoryId: string,
    language: LanguageCode
): Promise<void> {
    let picked;
    try {
        picked = await openPathPicker({
            language,
            prompt: t(language, "Select a folder to save this media file to:"),
            startPath: PICKER_START_PATH,
            includeFiles: false,
            includeFolders: true
        });
    }
    catch {
        return;
    }

    let result;
    try {
        result = await saveMemoryMedia(gameId, memoryId, picked.realpath || picked.path);
    }
    catch (e) {
        logError("memories: couldn't save a memory's media", e);
        toaster.toast({
            title: t(language, "Save Failed"),
            body: t(language, failureLine(undefined)),
            duration: TOAST_DURATION_MS
        });
        return;
    }

    if (!result.ok) {
        toaster.toast({
            title: t(language, "Save Failed"),
            body: t(language, failureLine(result.error)),
            duration: TOAST_DURATION_MS
        });
        return;
    }

    toaster.toast({
        title: t(language, "Memory Saved"),
        body: result.name || "",
        duration: TOAST_DURATION_MS
    });
}
