import { addEventListener, removeEventListener } from "@decky/api";
import {
    getCachedPayload,
    getNotifications,
    getSettings,
    loadGameGuides,
    logFocusDebug,
    markNotificationsSeen,
    prefetchGameIcons,
    saveBatterySaver,
    saveDoNotDisturb,
    saveSavedCommentsPrefs
} from "../../api";
import { ensureLanguageLoaded, getCurrentLanguage, t } from "../../locales";
import type { LanguageCode } from "../../locales";
import type { GameGuidesRecord, ShortcutAction } from "../../types";
import { GLOBAL_SHORTCUT_ACTIONS } from "../../utils/options";
import { logError } from "../../utils/errors";
import { lastOpenedGuide } from "../../utils/guidesResolve";
import { cheevoModalCount, cheevoModalOpen, showManagedModal } from "../../utils/modalRegistry";
import type { PanelEntry } from "../../utils/pendingPanelEntry";
import { captureSnapshot } from "../../utils/snapshot";
import { startupSettingsSettled } from "../../utils/frontendSettings";
import { showToggleToast } from "../../utils/toggleToast";
import { openPanelOn, quickAccessIsHidden } from "../../utils/quickAccess";
import { browserModalOpen, minimizeBrowserModal, openBrowserModal } from "../browser/BrowserModal";
import { openCalculatorModal } from "../calculator/CalculatorModal";
import { GuidesReaderModal } from "../guides/GuidesReaderModal";
import { openLastMemory } from "../memories/openLastMemory";
import { NotificationsModal } from "../notifications/NotificationsModal";
import { buildStandaloneNotificationNav } from "../notifications/standaloneNotificationNav";

const BACK_BUTTON_EVENT = "cheevodeck_back_button";

type PageAction =
    | "dolphinMapper"
    | "stormbreaker"
    | "socialActivity"
    | "socialhub"
    | "news"
    | "aotw"
    | "events"
    | "newsets"
    | "subscribeddiscussions"
    | "savedcomments"
    | "trackedsets"
    | "profile";

type SummonAction =
    | "browser"
    | "calculator"
    | "currentGuide"
    | "memories"
    | "lastMemory"
    | "snapshot"
    | "doNotDisturb"
    | "batterySaver"
    | "notifications"
    | PageAction;

let summoning = false;

let registered = false;

function mayOpen(action: string): boolean {
    if (!quickAccessIsHidden()) {
        logFocusDebug("backButtons:drop", action, "qam visible");
        return false;
    }
    if (cheevoModalOpen()) {
        logFocusDebug("backButtons:drop", action, "modal open");
        return false;
    }
    return true;
}

async function summonCurrentGuide(language: LanguageCode) {
    if (summoning) {
        return;
    }
    summoning = true;
    try {
        const { payload } = await getCachedPayload();
        const gameId = payload?.gameId ?? null;
        if (gameId == null) {
            logFocusDebug("backButtons:drop", "currentGuide", "no cached game");
            return;
        }

        let record: GameGuidesRecord;
        try {
            record = await loadGameGuides(gameId);
        } catch (e) {
            logError("backButtons: couldn't read guides for the current game", e);
            return;
        }
        const settings = await getSettings();

        if (!mayOpen("currentGuide")) {
            return;
        }

        const last = lastOpenedGuide(record);
        if (last === null) {
            openPanelOn({ kind: "guides" });
            return;
        }

        const { faqId, guide, gameUrl } = last;
        const showIcons = settings?.showIcons ?? true;
        if (showIcons) {
            void prefetchGameIcons([{ gameId, imageIcon: payload?.imageIcon ?? null }]);
        }
        showManagedModal((close) => (
            <GuidesReaderModal
                language={language}
                title={guide.title || payload?.title || t(language, "Guide")}
                gameId={gameId}
                imageIcon={payload?.imageIcon ?? null}
                showIcons={showIcons}
                faqId={faqId}
                gameUrl={gameUrl}
                initialContent={null}
                initialSection={guide.lastAnchor || null}
                mouseKeyboardMode={settings?.mouseKeyboardMode ?? false}
                close={close}
            />
        ));
    } catch (e) {
        logError("backButtons: couldn't summon the current guide", e);
    } finally {
        summoning = false;
    }
}

async function toggleSetting(action: "doNotDisturb" | "batterySaver", language: LanguageCode) {
    if (summoning) {
        return;
    }
    summoning = true;
    try {
        const settings = await getSettings();
        if (!mayOpen(action)) {
            return;
        }
        if (action === "doNotDisturb") {
            const result = await saveDoNotDisturb(!settings.doNotDisturb);
            showToggleToast(language, "Do Not Disturb", result.doNotDisturb);
        } else {
            const result = await saveBatterySaver(!settings.batterySaver);
            showToggleToast(language, "Standby", result.batterySaver);
        }
    } catch (e) {
        logError(`backButtons: couldn't toggle ${action}`, e);
    } finally {
        summoning = false;
    }
}

async function summonNotifications(language: LanguageCode) {
    if (summoning) {
        return;
    }
    summoning = true;
    try {
        const [payload, settings] = await Promise.all([getNotifications(), getSettings()]);
        if (!mayOpen("notifications")) {
            return;
        }
        const nav = buildStandaloneNotificationNav(language, settings);
        showManagedModal(
            (close) => (
                <NotificationsModal
                    initialNotifications={payload?.notifications ?? []}
                    seenAtSnapshot={payload?.lastSeenAt ?? 0}
                    language={language}
                    showIcons={settings.showIcons}
                    nav={nav}
                    close={close}
                />
            ),
            { needsMarkSeen: true, onClose: () => { void markNotificationsSeen(); } }
        );
    } catch (e) {
        logError("backButtons: couldn't open notifications", e);
    } finally {
        summoning = false;
    }
}

async function pageEntry(action: PageAction): Promise<PanelEntry | null> {
    switch (action) {
        case "dolphinMapper":
            return { kind: "dolphinMapper" };
        case "stormbreaker":
            return { kind: "stormbreaker" };
        case "trackedsets":
            return { kind: "trackedSets" };
        case "socialActivity":
            return { kind: "socialTab", tab: "activity" };
        case "news":
            return { kind: "socialTab", tab: "newsEvents", newsSub: "news" };
        case "aotw":
            return { kind: "aotw" };
        case "events":
            return { kind: "socialTab", tab: "newsEvents", newsSub: "events" };
        case "newsets":
            return { kind: "socialTab", tab: "newsEvents", newsSub: "newSets" };
        case "subscribeddiscussions":
        case "savedcomments": {
            await saveSavedCommentsPrefs({ subTab: action === "savedcomments" ? "savedComments" : "subscribed" });
            return { kind: "socialTab", tab: "subscribedDiscussions" };
        }
        case "socialhub": {
            const settings = await getSettings();
            return {
                kind: "socialTab",
                tab: settings.socialEntryDefault === "lastUsed" ? null : settings.socialEntryDefault
            };
        }
        case "profile": {
            const settings = await getSettings();
            const username = String(settings.username || "").trim();
            if (!username) {
                return null;
            }
            return { kind: "profile", username, ulid: settings.activeUlid || null };
        }
    }
}

async function landOn(action: PageAction) {
    if (summoning) {
        return;
    }
    summoning = true;
    try {
        const entry = await pageEntry(action);
        if (entry === null || !mayOpen(action)) {
            return;
        }
        openPanelOn(entry);
    } catch (e) {
        logError(`backButtons: couldn't open the panel for ${action}`, e);
    } finally {
        summoning = false;
    }
}

async function onBackButton(payload: { action?: string | null; browserSnapshot?: boolean }) {
    if (payload?.browserSnapshot && browserModalOpen()) {
        const language = getCurrentLanguage();
        await ensureLanguageLoaded(language);
        void captureSnapshot(language);
        return;
    }
    const action = payload?.action;
    if (typeof action !== "string" || !GLOBAL_SHORTCUT_ACTIONS.includes(action as ShortcutAction)) {
        return;
    }
    if (action === "browser" && browserModalOpen() && quickAccessIsHidden() && cheevoModalCount() === 1) {
        logFocusDebug("backButtons", action, minimizeBrowserModal() ? "minimized" : "nothing to minimize");
        return;
    }
    if (!mayOpen(action)) {
        return;
    }

    await startupSettingsSettled();
    const language = getCurrentLanguage();
    await ensureLanguageLoaded(language);
    if (!registered || !mayOpen(action)) {
        return;
    }

    const summon = action as SummonAction;
    switch (summon) {
        case "browser":
            openBrowserModal(language);
            break;
        case "calculator":
            openCalculatorModal(language);
            break;
        case "currentGuide":
            void summonCurrentGuide(language);
            break;
        case "memories":
            openPanelOn({ kind: "memories" });
            break;
        case "lastMemory":
            void openLastMemory(language, () => quickAccessIsHidden() && !cheevoModalOpen());
            break;
        case "snapshot":
            void captureSnapshot(language);
            break;
        case "doNotDisturb":
        case "batterySaver":
            void toggleSetting(summon, language);
            break;
        case "notifications":
            void summonNotifications(language);
            break;
        default:
            void landOn(summon);
            break;
    }
}

export function registerGlobalBackButtons(): void {
    registered = true;
    addEventListener(BACK_BUTTON_EVENT, onBackButton);
}

export function unregisterGlobalBackButtons(): void {
    registered = false;
    removeEventListener(BACK_BUTTON_EVENT, onBackButton);
}
