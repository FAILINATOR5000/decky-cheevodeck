import { addEventListener, removeEventListener } from "@decky/api";
import { Navigation, QuickAccessTab } from "@decky/ui";
import { getCachedPayload, getSettings, loadGameGuides, logFocusDebug, prefetchGameIcons } from "../../api";
import { ensureLanguageLoaded, getCurrentLanguage, t } from "../../locales";
import type { LanguageCode } from "../../locales";
import type { GameGuidesRecord } from "../../types";
import { logError } from "../../utils/errors";
import { lastOpenedGuide } from "../../utils/guidesResolve";
import { cheevoModalOpen, showManagedModal } from "../../utils/modalRegistry";
import { requestGuidesOnOpen, takeGuidesOnOpen } from "../../utils/pendingPanelEntry";
import { focusOurPlugin, quickAccessIsHidden } from "../../utils/quickAccess";
import { openBrowserModal } from "../browser/BrowserModal";
import { openCalculatorModal } from "../calculator/CalculatorModal";
import { GuidesReaderModal } from "../guides/GuidesReaderModal";

const BACK_BUTTON_EVENT = "cheevodeck_back_button";

type SummonAction = "browser" | "calculator" | "currentGuide";

const SUMMON_ACTIONS: readonly string[] = ["browser", "calculator", "currentGuide"];

let summoning = false;

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

function openPanelOnGuides() {
    requestGuidesOnOpen();
    try {
        focusOurPlugin();
        Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
    } catch (e) {
        takeGuidesOnOpen();
        logError("backButtons: couldn't open the panel on Guides", e);
    }
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
            openPanelOnGuides();
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

async function onBackButton(payload: { action?: string }) {
    const action = payload?.action;
    if (typeof action !== "string" || !SUMMON_ACTIONS.includes(action)) {
        return;
    }
    if (!mayOpen(action)) {
        return;
    }

    const language = getCurrentLanguage();
    await ensureLanguageLoaded(language);
    if (!mayOpen(action)) {
        return;
    }

    switch (action as SummonAction) {
        case "browser":
            openBrowserModal(language);
            break;
        case "calculator":
            openCalculatorModal(language);
            break;
        case "currentGuide":
            void summonCurrentGuide(language);
            break;
    }
}

export function registerGlobalBackButtons(): void {
    addEventListener(BACK_BUTTON_EVENT, onBackButton);
}

export function unregisterGlobalBackButtons(): void {
    removeEventListener(BACK_BUTTON_EVENT, onBackButton);
}
