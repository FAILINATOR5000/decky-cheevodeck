import { definePlugin, addEventListener, removeEventListener } from "@decky/api";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaTrophy } from "react-icons/fa";
import AchievementsRoot from "./pages/AchievementsRoot";
import { refreshHealedUserAvatar } from "./api";
import { t, ensureLanguageLoaded, getCurrentLanguage } from "./locales";
import { readSettingsAtStartup, startupSettingsSettled } from "./utils/frontendSettings";
import { warmConsoleCatalog } from "./utils/consoleCatalog";
import { logError } from "./utils/errors";
import { showToastAfter } from "./utils/delayedToast";
import { PRESS_TOAST_DELAY_MS } from "./utils/navSound";
import { quickAccessMenuClasses } from "@decky/ui";
import { disableLibraryBadge } from "./components/library/libraryBadgePatch";
import { registerScreenDarken, unregisterScreenDarken } from "./components/darken/screenDarken";
import { registerMemoryCapture, unregisterMemoryCapture } from "./components/memories/memoryCapture";
import { registerMemoryFullscreen, unregisterMemoryFullscreen } from "./components/memories/memoryFullscreen";
import { closeBrowserForUnload } from "./components/browser/BrowserModal";
import { releaseWebBrowserActionset } from "./components/browser/browserViewHost";
import { registerBrowserDownloads, unregisterBrowserDownloads } from "./components/browser/browserDownloads";
import { registerGlobalBackButtons, unregisterGlobalBackButtons } from "./components/backButtons/globalBackButtons";
import { uninstallStormbreaker } from "./utils/stormbreaker";
import { registerPhantomMouseGuard, unregisterPhantomMouseGuard } from "./utils/phantomMouseGuard";

const NOTIFICATION_EVENT = "cheevodeck_notification";

const AVATAR_HEALED_EVENT = "cheevodeck_avatar_healed";

export default definePlugin(() => {
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
    }) => {
        if (!payload?.toast) {
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

    void startupSettingsSettled().then(() => {
        if (!disposed) {
            warmConsoleCatalog();
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
    registerBrowserDownloads();
    registerGlobalBackButtons();
    registerPhantomMouseGuard();

    registerScreenDarken();
    registerMemoryCapture();
    registerMemoryFullscreen();

    return {
        name: "CheevoDeck",
        title: <div className={quickAccessMenuClasses.Title}>CheevoDeck</div>,
        content: <AchievementsRoot />,
        icon: <FaTrophy />,
        onDismount() {
            disposed = true;
            removeEventListener(NOTIFICATION_EVENT, onNotificationToast);
            removeEventListener(AVATAR_HEALED_EVENT, onAvatarHealed);
            unregisterBrowserDownloads();
            unregisterGlobalBackButtons();
            unregisterPhantomMouseGuard();
            uninstallStormbreaker();
            disableLibraryBadge();
            unregisterScreenDarken();
            unregisterMemoryCapture();
            unregisterMemoryFullscreen();
            closeBrowserForUnload();
        }
    };
});
