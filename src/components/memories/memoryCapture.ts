import { findModuleExport, Router } from "@decky/ui";

import { adoptClip, adoptScreenshot } from "../../api";
import { logError } from "../../utils/errors";

let runningAppId = 0;

let lifetimeHandle: { unregister?: () => void } | null = null;
let screenshotHandle: { unregister?: () => void } | null = null;
let clipHandle: { unregister?: () => void } | null = null;

const STEAM_CALL_TIMEOUT_MS = 4000;

type AppLifetimeEvent = {
    unAppID?: number;
    bRunning?: boolean;
};

type ClipSummary = {
    clip_id?: string;
    game_id?: string;
    duration_ms?: string;
    date_recorded?: number;
    file_size?: string;
    temporary?: boolean;
};

type ClipMessage = {
    Body?: () => { toObject?: () => { summary?: ClipSummary } };
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
    const result = await adoptScreenshot(path, currentAppId(), capturedAt, gameId);
    if (result?.ok && result.deleteSource) {
        await deleteSteamCopy(gameId, handle, path);
    }
}

function gameRecording(): any {
    try {
        return findModuleExport((e: any) =>
            e && typeof e === "object" && typeof e.RegisterForNotifyClipCreated === "function");
    }
    catch (e) {
        logError("memories: couldn't find Steam's recording module", e);
        return null;
    }
}

async function deleteSteamClip(clipId: string) {
    const api = gameRecording();
    if (typeof api?.DeleteClip !== "function") {
        logError("memories: Steam's recording module has no DeleteClip", null);
        return;
    }
    await withTimeout(api.DeleteClip({ clip_id: clipId }));
}

function summaryOf(message: ClipMessage): ClipSummary | null {
    const decoded = message?.Body?.()?.toObject?.();
    const summary = decoded?.summary;
    return summary && typeof summary === "object" ? summary : null;
}

async function onClipCreated(message: ClipMessage) {
    const summary = summaryOf(message);
    if (!summary) {
        return;
    }
    // Saving a clip out of a background recording notifies twice: once for a
    // provisional record while Steam is still writing it, and again when it is
    // done. The first carries no date_clipped and a duration of 2^64-1.
    if (summary.temporary !== false) {
        return;
    }

    const clipId = String(summary.clip_id ?? "");
    const gameId = String(summary.game_id ?? "");
    const durationMs = Number(summary.duration_ms ?? 0);
    if (!clipId || !gameId || !Number.isFinite(durationMs) || durationMs <= 0) {
        return;
    }

    // date_recorded is the clip's first frame. date_clipped is when the save
    // finished, which is the same moment for a clip cut as it happens and a
    // quarter of an hour later for one cut out of an old recording.
    const recordedAt = Number(summary.date_recorded ?? 0);
    const result = await adoptClip(
        clipId,
        gameId,
        recordedAt,
        durationMs,
        Number(summary.file_size ?? 0) || 0
    );
    if (result?.ok && result.deleteClip) {
        await deleteSteamClip(clipId);
    }
}

function currentAppId(): number {
    if (runningAppId) {
        return runningAppId;
    }
    const running = Number(Router.MainRunningApp?.appid ?? 0);
    return Number.isFinite(running) && running > 0 ? running : 0;
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

    const recording = gameRecording();
    if (!recording) {
        return;
    }
    try {
        clipHandle = recording.RegisterForNotifyClipCreated((message: ClipMessage) => {
            void onClipCreated(message).catch((e) => {
                logError("memories: adopting a clip failed", e);
            });
        }) ?? null;
    }
    catch (e) {
        logError("memories: couldn't register for clip notifications", e);
    }
}

export function unregisterMemoryCapture() {
    for (const handle of [lifetimeHandle, screenshotHandle, clipHandle]) {
        try {
            handle?.unregister?.();
        }
        catch (e) {
            logError("memories: couldn't unregister a screenshot listener", e);
        }
    }
    lifetimeHandle = null;
    screenshotHandle = null;
    clipHandle = null;
    runningAppId = 0;
}
