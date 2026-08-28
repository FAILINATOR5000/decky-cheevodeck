import type { ResumeState, ViewKey } from "../types";
import { getAboutResumeFocusKey } from "./aboutResume";
import { getCheevoCheckResumeFocusKey } from "./cheevoCheckResume";
import { getDolphinMapperResumeFocusKey } from "./dolphinMapperResume";
import { getFileWatcherResumeFocusKey } from "./fileWatcherResume";
import { getSavedGameNotesGameId } from "./gameNotesResume";
import { getSavedGuidesSubView } from "./guidesResume";
import { getNowPlayingResumeFocusKey } from "./nowPlayingResume";
import { getOptionsResumeFocusKey } from "./optionsResume";
import { getSmbSharesResumeFocusKey } from "./smbSharesResume";
import { getUtilsResumeFocusKey } from "./utilsResume";
import type { RestoreContext } from "./restoreContext";
export function restoreStandaloneView(savedState: ResumeState, savedView: ViewKey, ctx: RestoreContext): boolean {
    if (savedView === "options") {
        ctx.setRecentGamesExpanded(false);
        ctx.setView("options");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getOptionsResumeFocusKey(savedView, savedState?.focusKey) ?? "options:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "utils") {
        ctx.setRecentGamesExpanded(false);
        ctx.setView("utils");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getUtilsResumeFocusKey(savedView, savedState?.focusKey) ?? "utils:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "dolphinMapper") {
        ctx.setRecentGamesExpanded(false);
        ctx.setView("dolphinMapper");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getDolphinMapperResumeFocusKey(savedView, savedState?.focusKey) ?? "dolphinMapper:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "smbShares") {
        ctx.setRecentGamesExpanded(false);
        ctx.setView("smbShares");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getSmbSharesResumeFocusKey(savedView) ?? "smbShares:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "cheevoCheck") {
        ctx.setRecentGamesExpanded(false);
        ctx.setView("cheevoCheck");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getCheevoCheckResumeFocusKey(savedView) ?? "cheevocheck:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "fileWatcher") {
        ctx.setRecentGamesExpanded(false);
        ctx.setView("fileWatcher");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getFileWatcherResumeFocusKey(savedView) ?? "fileWatcher:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "guides") {
        ctx.setRecentGamesExpanded(false);
        ctx.setView("guides");
        ctx.onRestoreGuides({
            subView: getSavedGuidesSubView(savedState),
            faqId: savedState?.guidesFaqId ?? null,
        });
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(savedState?.focusKey ?? "guides:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "about") {
        ctx.setRecentGamesExpanded(false);
        ctx.setView("about");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getAboutResumeFocusKey(savedView, savedState?.focusKey) ?? "about:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "gameNotes") {
        ctx.setRecentGamesExpanded(false);
        ctx.setGameNotesGameId(getSavedGameNotesGameId(savedState));
        ctx.setView("gameNotes");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(savedState?.focusKey || "gn:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "social") {
        ctx.setRecentGamesExpanded(false);
        ctx.setView("social");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey("social:back");
        ctx.markResumeApplied();
        return true;
    }

    if (savedView === "comparePicker") {
        ctx.setRecentGamesExpanded(false);
        ctx.setMainTab("compare");
        ctx.setNowPlayingSubView("compare");
        ctx.setView("comparePicker");
        ctx.setPendingPrimaryViewRestoreGameId(undefined);
        ctx.setPendingFocusKey(getNowPlayingResumeFocusKey(savedView) ?? "comparepicker:back");
        ctx.markResumeApplied();
        return true;
    }

    return false;
}
