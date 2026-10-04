import { getGamepadNavigationTrees, Navigation, QuickAccessTab } from "@decky/ui";
import { logError } from "./errors";
import { requestPanelEntry, takePanelEntry, type PanelEntry } from "./pendingPanelEntry";

let reportedMissingQuickAccess = false;

export function quickAccessWindow(): Window | null {
    const tree = getGamepadNavigationTrees()?.find((t: any) => t?.id === "QuickAccess-NA");
    return tree?.m_Root?.m_element?.ownerDocument?.defaultView ?? null;
}

export function quickAccessIsHidden(): boolean {
    const win = quickAccessWindow();
    if (win === null) {
        if (!reportedMissingQuickAccess) {
            reportedMissingQuickAccess = true;
            logError("quickAccess: no Quick Access window, so back buttons stand down and pollers never pause", null);
        }
        return false;
    }
    return win.document.hidden;
}

export function focusOurPlugin() {
    const loader = (window as any)?.DeckyPluginLoader;
    const setActivePlugin = loader?.deckyState?.setActivePlugin;
    if (typeof setActivePlugin !== "function") {
        return;
    }
    setActivePlugin.call(loader.deckyState, "CheevoDeck");
}

export function openPanelOn(entry: PanelEntry) {
    requestPanelEntry(entry);
    try {
        focusOurPlugin();
        Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
    } catch (e) {
        takePanelEntry();
        logError(`quickAccess: couldn't open the panel on ${entry.kind}`, e);
    }
}
