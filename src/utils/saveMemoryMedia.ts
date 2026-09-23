import { toaster } from "@decky/api";

import { saveMemoryBookmarkClip, saveMemoryMedia } from "../api";
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
        case "trim_failed":
            return "Couldn't cut this part of the clip out.";
        case "too_short":
            return "There isn't enough clip between this bookmark and the next one.";
        case "bad_target":
            return "That folder isn't there any more.";
        case "no_source":
            return "The file behind this memory is missing.";
        default:
            return "Couldn't write the file.";
    }
}

async function pickFolder(language: LanguageCode): Promise<string | null> {
    try {
        const picked = await openPathPicker({
            language,
            prompt: t(language, "Select a folder to save this media file to:"),
            startPath: PICKER_START_PATH,
            includeFiles: false,
            includeFolders: true
        });
        return picked.realpath || picked.path;
    }
    catch {
        return null;
    }
}

function saveFailed(language: LanguageCode, error: string | undefined): void {
    toaster.toast({
        title: t(language, "Save Failed"),
        body: t(language, failureLine(error)),
        duration: TOAST_DURATION_MS
    });
}

export async function saveMemoryToFolder(
    gameId: number,
    memoryId: string,
    language: LanguageCode
): Promise<void> {
    const folder = await pickFolder(language);
    if (folder === null) {
        return;
    }

    let result;
    try {
        result = await saveMemoryMedia(gameId, memoryId, folder);
    }
    catch (e) {
        logError("memories: couldn't save a memory's media", e);
        saveFailed(language, undefined);
        return;
    }

    if (!result.ok) {
        saveFailed(language, result.error);
        return;
    }

    toaster.toast({
        title: t(language, "Memory Saved"),
        body: result.name || "",
        duration: TOAST_DURATION_MS
    });
}

export async function saveBookmarkSnippetToFolder(
    gameId: number,
    memoryId: string,
    bookmarkId: string,
    language: LanguageCode
): Promise<void> {
    const folder = await pickFolder(language);
    if (folder === null) {
        return;
    }

    let result;
    try {
        result = await saveMemoryBookmarkClip(gameId, memoryId, bookmarkId, folder);
    }
    catch (e) {
        logError("memories: couldn't save a snippet of a clip", e);
        saveFailed(language, undefined);
        return;
    }

    if (!result.ok) {
        saveFailed(language, result.error);
        return;
    }

    toaster.toast({
        title: t(language, "Snippet Saved"),
        body: result.name || "",
        duration: TOAST_DURATION_MS
    });
}
