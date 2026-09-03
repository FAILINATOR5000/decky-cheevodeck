import { definePlugin, addEventListener, removeEventListener, toaster } from "@decky/api";
import { FaTrophy } from "react-icons/fa";
import AchievementsRoot from "./pages/AchievementsRoot";
import { getSettings, refreshHealedUserAvatar } from "./api";
import { t, getCurrentLanguage, setCurrentLanguage } from "./locales";
import { setDeviceIsSteamMachine } from "./utils/scale";
import { logError } from "./utils/errors";
import { quickAccessMenuClasses } from "@decky/ui";
import { disableLibraryBadge, enableLibraryBadge } from "./components/library/libraryBadgePatch";

const NOTIFICATION_EVENT = "cheevodeck_notification";

const AVATAR_HEALED_EVENT = "cheevodeck_avatar_healed";

export default definePlugin(() => {
    const onNotificationToast = (payload: {
        type?: string;
        titleKey?: string;
        lineKey?: string;
        vars?: Record<string, string | number>;
        title?: string;
        body?: string;
        toast?: boolean;
    }) => {
        if (!payload?.toast) {
            return;
        }
        const language = getCurrentLanguage();
        const title = payload.titleKey
            ? t(language, payload.titleKey, payload.vars)
            : (payload.title || "CheevoDeck");
        const body = payload.lineKey
            ? t(language, payload.lineKey, payload.vars)
            : (payload.body || "");
        toaster.toast({ title, body });
    };
    addEventListener(NOTIFICATION_EVENT, onNotificationToast);

    void getSettings()
        .then((settings) => {
            if (settings?.language) {
                setCurrentLanguage(settings.language);
            }
            setDeviceIsSteamMachine(settings?.isSteamMachine ?? false);
            if (settings?.libraryBadge) {
                enableLibraryBadge();
            }
        })
        .catch((e) => {
            logError("index: couldn't read settings at startup", e);
        });

    const onAvatarHealed = (payload: { username?: string }) => {
        const username = payload?.username;
        if (!username) {
            return;
        }
        void refreshHealedUserAvatar(username);
    };
    addEventListener(AVATAR_HEALED_EVENT, onAvatarHealed);

    return {
        name: "CheevoDeck",
        title: <div className={quickAccessMenuClasses.Title}>CheevoDeck</div>,
        content: <AchievementsRoot />,
        icon: <FaTrophy />,
        onDismount() {
            removeEventListener(NOTIFICATION_EVENT, onNotificationToast);
            removeEventListener(AVATAR_HEALED_EVENT, onAvatarHealed);
            disableLibraryBadge();
        }
    };
});
