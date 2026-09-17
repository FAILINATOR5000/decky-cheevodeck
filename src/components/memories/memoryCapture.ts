import { adoptScreenshot } from "../../api";
import { logError } from "../../utils/errors";

let runningAppId = 0;

let lifetimeHandle: { unregister?: () => void } | null = null;
let screenshotHandle: { unregister?: () => void } | null = null;

const STEAM_CALL_TIMEOUT_MS = 4000;

type AppLifetimeEvent = {
    unAppID?: number;
    bRunning?: boolean;
};

type ScreenshotEvent = {
    strOperation?: string;
    details?: {
        hHandle?: number;
        strGameID?: string;
        nCreated?: number;
    };
};

function withTimeout<T>(work: Promise<T>): Promise<T | null> {
    return Promise.race([
        work,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), STEAM_CALL_TIMEOUT_MS))
    ]).catch(() => null);
}

function screenshots(): any {
    return (SteamClient as any)?.Screenshots;
}

async function localPath(gameId: string, handle: number): Promise<string> {
    const api = screenshots();
    if (typeof api?.GetLocalScreenshotPath !== "function") {
        return "";
    }
    const answer = await withTimeout<string>(api.GetLocalScreenshotPath(gameId, handle));
    return typeof answer === "string" ? answer : "";
}

async function deleteSteamCopy(gameId: string, handle: number, expectedPath: string) {
    const api = screenshots();
    if (typeof api?.DeleteLocalScreenshots !== "function") {
        return;
    }
    const stillThere = await localPath(gameId, handle);
    if (!stillThere || stillThere !== expectedPath) {
        return;
    }
    await withTimeout(api.DeleteLocalScreenshots([{ gameID: gameId, rgHandles: [handle] }]));
}

async function onScreenshot(event: ScreenshotEvent) {
    if (event?.strOperation !== "written") {
        return;
    }
    const details = event?.details;
    const gameId = String(details?.strGameID ?? "");
    const handle = details?.hHandle;
    if (!gameId || typeof handle !== "number") {
        return;
    }

    const path = await localPath(gameId, handle);
    if (!path) {
        return;
    }

    const capturedAt = details?.nCreated || Math.floor(Date.now() / 1000);
    const result = await adoptScreenshot(path, runningAppId, capturedAt, gameId);
    if (result?.ok && result.deleteSource) {
        await deleteSteamCopy(gameId, handle, path);
    }
}

function onAppLifetime(event: AppLifetimeEvent) {
    const appId = event?.unAppID;
    if (typeof appId !== "number") {
        return;
    }
    runningAppId = event?.bRunning ? appId : 0;
}

export function registerMemoryCapture() {
    const sessions = (SteamClient as any)?.GameSessions;
    if (!sessions) {
        return;
    }
    try {
        lifetimeHandle = sessions.RegisterForAppLifetimeNotifications?.(onAppLifetime) ?? null;
        screenshotHandle = sessions.RegisterForScreenshotNotification?.((event: ScreenshotEvent) => {
            void onScreenshot(event).catch((e) => {
                logError("memories: adopting a screenshot failed", e);
            });
        }) ?? null;
    }
    catch (e) {
        logError("memories: couldn't register for screenshot notifications", e);
    }
}

export function unregisterMemoryCapture() {
    for (const handle of [lifetimeHandle, screenshotHandle]) {
        try {
            handle?.unregister?.();
        }
        catch (e) {
            logError("memories: couldn't unregister a screenshot listener", e);
        }
    }
    lifetimeHandle = null;
    screenshotHandle = null;
    runningAppId = 0;
}
