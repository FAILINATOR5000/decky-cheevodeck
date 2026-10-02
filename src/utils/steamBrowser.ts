import { Navigation } from "@decky/ui";
import { cancelQuickAccessReturn } from "./modalRegistry";

export function openInSteamBrowser(url: string) {
    const targetUrl = String(url || "").trim();

    if (!targetUrl) {
        return false;
    }

    cancelQuickAccessReturn();
    try {
        Navigation.CloseSideMenus();
    } catch { }

    try {
        Navigation.NavigateToExternalWeb(targetUrl);
        return true;
    } catch {
        return false;
    }
}
