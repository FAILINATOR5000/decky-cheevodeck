import {
    applyAchievementIconCacheGames,
    applyAvatarCacheCap,
    applyGameArtCacheCap,
    getSettings,
    logStartupEvent,
    setAccurateAvatarDebug
} from "../api";
import { applyLibraryBadge } from "../components/library/libraryBadgePatch";
import { setClipMuted } from "../components/memories/clipMute";
import { setCurrentLanguage } from "../locales";
import type { SettingsResponse } from "../types";
import { setCurrentColoredGlyphs, setCurrentControllerGlyphStyle } from "./controllerGlyphs";
import { logError } from "./errors";
import { setModalAutoCleanup, setQamReturnDelay } from "./modalRegistry";
import { setWebBrowserForLinks } from "./navigation";
import {
    setCurrentAchievementTextScale,
    setCurrentBannerScale,
    setCurrentCommentsTextScale,
    setCurrentGeneralHeaderStyle,
    setCurrentGuideModalZoom,
    setCurrentGuideZoom,
    setCurrentHeaderScale,
    setCurrentLargeViewportBonus,
    setCurrentLargeViewportBonusEnabled,
    setCurrentModalScale,
    setCurrentTextScale,
    setCurrentTextViewerZoom,
    setCurrentTitleScale,
    setDeviceIsSteamMachine
} from "./scale";
import { setSnapshotHotkey } from "./snapshotHotkey";
import { setStormbreakerEnabled, setStormbreakerGameMode } from "./stormbreaker";

const STARTUP_TRIES = 3;

const STARTUP_RETRY_MS = 1000;

const STARTUP_WAIT_MS = 2000;

let applyCount = 0;

let startupRead: Promise<void> = Promise.resolve();

let startupSettled = true;

export function applyFrontendSettings(settings: SettingsResponse): void {
    applyCount += 1;
    setCurrentLanguage(settings.language);
    if (settings.isSteamMachine !== undefined) {
        setDeviceIsSteamMachine(settings.isSteamMachine);
    }
    setClipMuted(settings.memoriesMuted);
    setWebBrowserForLinks(settings.linksOpenInWebBrowser);
    setSnapshotHotkey(settings.shortcutBindings);
    setCurrentTextScale(settings.textScale);
    setCurrentTitleScale(settings.titleScale);
    setCurrentHeaderScale(settings.headerScale);
    setCurrentBannerScale(settings.bannerScale);
    setCurrentModalScale(settings.modalScale);
    setCurrentAchievementTextScale(settings.achievementTextScale);
    setCurrentCommentsTextScale(settings.commentsTextScale);
    setCurrentGuideZoom(settings.guideZoom);
    setCurrentGuideModalZoom(settings.guideModalZoom);
    setCurrentTextViewerZoom(settings.textViewerZoom);
    setCurrentGeneralHeaderStyle(settings.generalHeaderStyle);
    setCurrentLargeViewportBonusEnabled(settings.largeViewportBonusEnabled);
    setCurrentLargeViewportBonus(settings.largeViewportBonus);
    setCurrentControllerGlyphStyle(settings.controllerGlyphStyle);
    setCurrentColoredGlyphs(settings.coloredGlyphs);
    setQamReturnDelay(settings.qamReturnDelayMs);
    setModalAutoCleanup(settings.deferModalCleanup);
    setAccurateAvatarDebug(settings.debugLogging);
    applyGameArtCacheCap(settings.gameArtCacheCap);
    applyAvatarCacheCap(settings.avatarCacheCap);
    applyAchievementIconCacheGames(settings.achievementIconCacheGames);
    try {
        if (settings.gameMode !== undefined) {
            setStormbreakerGameMode(settings.gameMode);
        }
        setStormbreakerEnabled(settings.stormbreaker);
    }
    catch (e) {
        logError("settings: couldn't start Stormbreaker", e);
    }
    try {
        applyLibraryBadge(settings.libraryBadge);
    }
    catch (e) {
        logError("settings: couldn't set up the library badge", e);
    }
}

async function readAtStartup(isDisposed: () => boolean): Promise<void> {
    const countAtStart = applyCount;
    let settings: SettingsResponse | null = null;
    for (let attempt = 1; attempt <= STARTUP_TRIES && settings === null; attempt += 1) {
        try {
            settings = await getSettings();
        }
        catch (e) {
            logError("settings: couldn't read settings at startup", e);
            void logStartupEvent("settings read failed", `try ${attempt} of ${STARTUP_TRIES}: ${String(e)}`)
                .catch(() => { });
            if (attempt < STARTUP_TRIES) {
                await new Promise((resolve) => window.setTimeout(resolve, STARTUP_RETRY_MS * attempt));
            }
        }
        if (isDisposed()) {
            return;
        }
    }
    if (applyCount !== countAtStart) {
        return;
    }
    if (settings !== null) {
        applyFrontendSettings(settings);
        return;
    }
    void logStartupEvent("running on defaults", "until the panel loads settings").catch(() => { });
    try {
        setStormbreakerEnabled(true);
    }
    catch (e) {
        logError("settings: couldn't start Stormbreaker", e);
    }
}

export function readSettingsAtStartup(isDisposed: () => boolean): void {
    startupSettled = false;
    startupRead = readAtStartup(isDisposed)
        .catch((e) => {
            logError("settings: couldn't apply settings at startup", e);
        })
        .finally(() => {
            startupSettled = true;
        });
}

export function startupSettingsSettled(): Promise<void> {
    if (startupSettled) {
        return startupRead;
    }
    return Promise.race([
        startupRead,
        new Promise<void>((resolve) => window.setTimeout(resolve, STARTUP_WAIT_MS))
    ]);
}
