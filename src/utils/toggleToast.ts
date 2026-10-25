import { t, type LanguageCode } from "../locales";
import { showToastAfter } from "./delayedToast";

export function showToggleToast(language: LanguageCode, labelKey: "Do Not Disturb" | "Standby" | "Darken Screen", on: boolean, delayMs = 0) {
    showToastAfter({
        title: t(language, labelKey),
        body: t(language, on ? "On" : "Off"),
        duration: 2000
    }, delayMs);
}
