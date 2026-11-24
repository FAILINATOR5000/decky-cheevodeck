import { definePlugin, addEventListener, removeEventListener } from "@decky/api";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaTrophy } from "react-icons/fa";
import AchievementsRoot from "./pages/AchievementsRoot";
import { ErrorBoundary } from "./components/panel/ErrorBoundary";
import { logStartupEvent, refreshHealedUserAvatar } from "./api";
import { t, ensureLanguageLoaded, getCurrentLanguage } from "./locales";
import { readSettingsAtStartup, startupSettingsSettled } from "./utils/frontendSettings";
import { warmConsoleCatalog } from "./utils/consoleCatalog";
import { stopCardCollage, warmCardCollage } from "./utils/playTogetherCollage";
import { watchMilestoneKinds } from "./utils/milestoneEvents";
import { logError } from "./utils/errors";
import { logSteamUiKind } from "./utils/steam/build";
import { showToastAfter } from "./utils/delayedToast";
import { PRESS_TOAST_DELAY_MS } from "./utils/navSound";
import { quickAccessMenuClasses } from "@decky/ui";
import { disableLibraryBadge } from "./components/library/libraryBadgePatch";
import { registerScreenDarken, unregisterScreenDarken } from "./components/darken/screenDarken";
import { registerMemoryCapture, unregisterMemoryCapture } from "./components/memories/memoryCapture";
import { registerMemoryFullscreen, unregisterMemoryFullscreen } from "./components/memories/memoryFullscreen";
import { registerMultiplayerSession, unregisterMultiplayerSession } from "./utils/multiplayerSession";
import { registerMoonlightSweep, unregisterMoonlightSweep } from "./utils/streamPlay";
import { registerMultiplayerRoomState, unregisterMultiplayerRoomState } from "./utils/multiplayerRoomState";
import { registerSeatPads, unregisterSeatPads } from "./utils/seatPads";
import { registerHotspotState, unregisterHotspotState } from "./utils/hotspotState";
import { registerHotspotIntro } from "./components/hotspot/HotspotIntroModal";
import { registerEmulatorJobs, unregisterEmulatorJobs } from "./utils/emulatorJobs";
import { finishPendingFixes, multiplayerPageOnScreen } from "./utils/fixPlan";
import { registerVoiceChat, unregisterVoiceChat } from "./utils/voiceChat";
import { registerGameVolume, unregisterGameVolume } from "./utils/gameVolume";
import { closeBrowserForUnload } from "./components/browser/BrowserModal";
import { releaseWebBrowserActionset } from "./components/browser/browserViewHost";
import { registerBrowserDownloads, unregisterBrowserDownloads } from "./components/browser/browserDownloads";
import { registerGlobalBackButtons, unregisterGlobalBackButtons } from "./components/backButtons/globalBackButtons";
import { uninstallStormbreaker } from "./utils/stormbreaker";
import { registerPhantomMouseGuard, unregisterPhantomMouseGuard } from "./utils/phantomMouseGuard";

const NOTIFICATION_EVENT = "cheevodeck_notification";

const AVATAR_HEALED_EVENT = "cheevodeck_avatar_healed";

export default definePlugin(() => {
    logSteamUiKind();
    releaseWebBrowserActionset();

    let disposed = false;

    const onNotificationToast = (payload: {
        type?: string;
        titleKey?: string;
        lineKey?: string;
        vars?: Record<string, string | number>;
        title?: string;
        body?: string;
        toast?: boolean;
        afterPress?: boolean;
        page?: string;
    }) => {
        if (!payload?.toast) {
            return;
        }
        if (payload.page === "multiplayer" && multiplayerPageOnScreen()) {
            return;
        }
        void startupSettingsSettled().then(async () => {
            const language = getCurrentLanguage();
            await ensureLanguageLoaded(language);
            if (disposed) {
                return;
            }
            const title = payload.titleKey
                ? t(language, payload.titleKey, payload.vars)
                : (payload.title || "CheevoDeck");
            const body = payload.lineKey
                ? t(language, payload.lineKey, payload.vars)
                : (payload.body || "");
            showToastAfter({ title, body }, payload.afterPress ? PRESS_TOAST_DELAY_MS : 0);
        }).catch((e) => {
            logError("index: couldn't raise a notification toast", e);
        });
    };
    addEventListener(NOTIFICATION_EVENT, onNotificationToast);

    readSettingsAtStartup(() => disposed);

    let stopMilestoneKinds: (() => void) | null = null;
    void startupSettingsSettled().then(() => {
        if (!disposed) {
            warmConsoleCatalog();
            stopMilestoneKinds = watchMilestoneKinds();
            void warmCardCollage();
        }
    });

    const onAvatarHealed = (payload: { username?: string }) => {
        const username = payload?.username;
        if (!username) {
            return;
        }
        void refreshHealedUserAvatar(username);
    };
    addEventListener(AVATAR_HEALED_EVENT, onAvatarHealed);

    const start = (name: string, register: () => void) => {
        try {
            register();
        }
        catch (e) {
            logError(`index: ${name} didn't start`, e);
            void logStartupEvent(`${name} didn't start`, String(e)).catch(() => { });
        }
    };
    start("browser downloads", registerBrowserDownloads);
    start("global back buttons", registerGlobalBackButtons);
    start("phantom mouse guard", registerPhantomMouseGuard);

    start("screen darken", registerScreenDarken);
    start("memory capture", registerMemoryCapture);
    start("multiplayer session", registerMultiplayerSession);
    start("moonlight sweep", registerMoonlightSweep);
    start("room state", registerMultiplayerRoomState);
    start("seat pads", registerSeatPads);
    start("hotspot state", registerHotspotState);
    start("hotspot intro", registerHotspotIntro);
    start("emulator jobs", registerEmulatorJobs);
    void finishPendingFixes();
    start("voice chat", registerVoiceChat);
    start("game volume", registerGameVolume);
    start("memory fullscreen", registerMemoryFullscreen);

    return {
        name: "CheevoDeck",
        title: <div className={quickAccessMenuClasses.Title}>CheevoDeck</div>,
        content: (
            <ErrorBoundary where="panel">
                <AchievementsRoot />
            </ErrorBoundary>
        ),
        icon: <FaTrophy />,
        onDismount() {
            disposed = true;
            unregisterGameVolume();
            removeEventListener(NOTIFICATION_EVENT, onNotificationToast);
            removeEventListener(AVATAR_HEALED_EVENT, onAvatarHealed);
            stopMilestoneKinds?.();
            unregisterBrowserDownloads();
            unregisterGlobalBackButtons();
            unregisterPhantomMouseGuard();
            uninstallStormbreaker();
            disableLibraryBadge();
            unregisterScreenDarken();
            unregisterMemoryCapture();
            unregisterMultiplayerSession();
            unregisterMoonlightSweep();
            unregisterVoiceChat();
            unregisterSeatPads();
            unregisterMultiplayerRoomState();
            unregisterHotspotState();
            unregisterEmulatorJobs();
            unregisterMemoryFullscreen();
            closeBrowserForUnload();
            stopCardCollage();
        }
    };
});
