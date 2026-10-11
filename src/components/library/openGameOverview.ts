import { Navigation, QuickAccessTab } from "@decky/ui";
import { clearResumeState, saveResumeState } from "../../api";
import { markPanelEntry } from "../../focusRecords";
import { logError } from "../../utils/errors";
import { focusOurPlugin } from "../../utils/quickAccess";

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
        markPanelEntry();
    } catch (e) {
        void clearResumeState();
        logError("libraryBadge: couldn't open the panel", e);
    }
}
