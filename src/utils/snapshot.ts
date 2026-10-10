import { toaster } from "@decky/api";

import { takeSnapshot } from "../api";
import { t, type LanguageCode } from "../locales";
import { logError } from "./errors";

const TOAST_DURATION_MS = 2000;

export async function captureSnapshot(language: LanguageCode) {
    let shot;
    try {
        shot = await takeSnapshot();
    }
    catch (e) {
        logError("takeSnapshot", e);
        toaster.toast({
            title: t(language, "Screenshot Failed"),
            body: t(language, "Couldn't save"),
            duration: TOAST_DURATION_MS
        });
        return;
    }
    if (!shot.ok) {
        toaster.toast({
            title: t(language, "Screenshot Failed"),
            body: t(language, shot.error === "no_socket" ? "Game Mode only" : "Couldn't save"),
            duration: TOAST_DURATION_MS
        });
        return;
    }
    toaster.toast({
        title: t(language, "Screenshot Saved"),
        body: t(language, "Pictures/CheevoDeck"),
        duration: TOAST_DURATION_MS
    });
}
