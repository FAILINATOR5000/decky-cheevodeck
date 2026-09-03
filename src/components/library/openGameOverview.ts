import { Navigation, QuickAccessTab } from "@decky/ui";
import { clearResumeState, saveResumeState } from "../../api";
import { logError } from "../../utils/errors";

function focusOurPlugin() {
    const loader = (window as any)?.DeckyPluginLoader;
    const setActivePlugin = loader?.deckyState?.setActivePlugin;
    if (typeof setActivePlugin !== "function") {
        return;
    }
    setActivePlugin.call(loader.deckyState, "CheevoDeck");
}

export async function openGameOverviewForGame(gameId: number) {
    try {
        await saveResumeState({
            view: "gameOverview",
            gameOverviewGameId: gameId,
            gameOverviewSource: "main"
        });
    } catch (e) {
        logError("libraryBadge: couldn't seed the panel", e);
        return;
    }

    try {
        focusOurPlugin();
        Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
    } catch (e) {
        void clearResumeState();
        logError("libraryBadge: couldn't open the panel", e);
    }
}
