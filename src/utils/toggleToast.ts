import { t, type LanguageCode } from "../locales";
import { showToastAfter } from "./delayedToast";

type ToggleLabel = "Do Not Disturb" | "Standby" | "Darken Screen" | "Offline Hotspot";

export function showToggleToast(language: LanguageCode, labelKey: ToggleLabel, on: boolean, delayMs = 0) {
    showToggleNotice(language, labelKey, on ? "On" : "Off", delayMs);
}

export function showToggleNotice(language: LanguageCode, labelKey: ToggleLabel, bodyKey: string, delayMs = 0,
    vars?: Record<string, string | number>) {
    showToastAfter({
        title: t(language, labelKey),
        body: t(language, bodyKey, vars),
        duration: 2000
    }, delayMs);
}
