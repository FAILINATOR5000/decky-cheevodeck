import { getGamepadNavigationTrees } from "@decky/ui";
import { logError } from "./errors";

let reportedMissingQuickAccess = false;

function quickAccessWindow(): Window | null {
    const tree = getGamepadNavigationTrees().find((t: any) => t?.id === "QuickAccess-NA");
    return tree?.m_Root?.m_element?.ownerDocument?.defaultView ?? null;
}

export function quickAccessIsHidden(): boolean {
    const win = quickAccessWindow();
    if (win === null) {
        if (!reportedMissingQuickAccess) {
            reportedMissingQuickAccess = true;
            logError("quickAccess: no Quick Access window, back buttons stand down", null);
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
