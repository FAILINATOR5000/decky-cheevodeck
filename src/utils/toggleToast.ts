import { toaster } from "@decky/api";

import { t, type LanguageCode } from "../locales";

export function showToggleToast(language: LanguageCode, labelKey: "Do Not Disturb" | "Standby", on: boolean) {
    toaster.toast({
        title: t(language, labelKey),
        body: t(language, on ? "On" : "Off"),
        duration: 2000
    });
}
