import { Navigation } from "@decky/ui";

export function openInSteamBrowser(url: string) {
    const targetUrl = String(url || "").trim();

    if (!targetUrl) {
        return false;
    }

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
