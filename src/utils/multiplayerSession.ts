import { addEventListener, removeEventListener, toaster } from "@decky/api";
import { Router } from "@decky/ui";

import {
    checkCurrentGame,
    multiplayerClearRestore,
    multiplayerLaunchEnded,
    multiplayerLaunchStarted,
    multiplayerPrepareLaunch,
    multiplayerRestoreRecord,
    multiplayerStart,
    multiplayerStartCancel,
    refreshCurrentGame
} from "../api";
import { getCurrentLanguage, t } from "../locales";
import type { MultiplayerRestoreRecord } from "../types";
import { currentGameMovedSince } from "./currentGameCheck";
import { logError } from "./errors";
import { START_SOUND_MS, playStart } from "./lobbySounds";
import { multiplayerChoices } from "./multiplayerChoices";
import { multiplayerRoomMarker, pressMultiplayerReady, subscribeMultiplayerRoom } from "./multiplayerRoomState";

const SESSION_EVENT = "multiplayer_session";
const OPTIONS_WAIT_MS = 5000;
const READ_WAIT_MS = 3000;
const LAUNCH_SOURCE = 100;
const FOLLOW_AFTER_MS = 16000;

export type MultiplayerSessionSnapshot = {
    appid: number;
    running: boolean;
    failure: string;
};

export type MultiplayerLaunchResult = {
    ok: boolean;
    error?: string;
    gate?: string;
    detail?: Record<string, string>;
};

let launched: MultiplayerRestoreRecord | null = null;
let snapshot: MultiplayerSessionSnapshot = { appid: 0, running: false, failure: "" };
let launching = false;
let fanfareEndsAt = 0;
let fanfareFor = "";
let startedFor = "";
let followTimer = 0;
let registered = false;
let stopRoomWatch: (() => void) | null = null;
const listeners = new Set<() => void>();
let lifetimeHandle: { unregister(): void } | null = null;

function publish(next: Partial<MultiplayerSessionSnapshot>) {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) {
        listener();
    }
}

export function subscribeMultiplayerSession(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function multiplayerSessionSnapshot(): MultiplayerSessionSnapshot {
    return snapshot;
}

export function forgetMultiplayerFailure() {
    if (snapshot.failure) {
        publish({ failure: "" });
    }
}

export function otherGameRunning(): boolean {
    const running = Number(Router.MainRunningApp?.appid ?? 0);
    return running > 0 && running !== snapshot.appid;
}

export function anyGameRunning(): boolean {
    return Number(Router.MainRunningApp?.appid ?? 0) > 0;
}

function readLaunchOptions(appid: number): Promise<string | null> {
    return new Promise((resolve) => {
        let done = false;
        let handle: { unregister(): void } | null = null;
        const finish = (value: string | null) => {
            if (done) {
                return;
            }
            done = true;
            window.clearTimeout(timer);
            handle?.unregister();
            resolve(value);
        };
        const timer = window.setTimeout(() => {
            finish(appDetailsStore.GetAppDetails(appid)?.strLaunchOptions ?? null);
        }, READ_WAIT_MS);
        handle = SteamClient.Apps.RegisterForAppDetails(appid, (details) => {
            if (details) {
                finish(details.strLaunchOptions ?? "");
            }
        });
        if (done) {
            handle.unregister();
        }
    });
}

function writeLaunchOptions(appid: number, options: string): Promise<boolean> {
    return new Promise((resolve) => {
        let done = false;
        let handle: { unregister(): void } | null = null;
        const finish = (ok: boolean) => {
            if (done) {
                return;
            }
            done = true;
            window.clearTimeout(timer);
            handle?.unregister();
            resolve(ok);
        };
        const timer = window.setTimeout(() => finish(false), OPTIONS_WAIT_MS);
        handle = SteamClient.Apps.RegisterForAppDetails(appid, (details) => {
            if (details?.strLaunchOptions === options) {
                finish(true);
            }
        });
        if (done) {
            handle.unregister();
            return;
        }
        SteamClient.Apps.SetShortcutLaunchOptions(appid, options);
    });
}

async function restore(record: MultiplayerRestoreRecord) {
    if (!(await writeLaunchOptions(record.appid, record.original))) {
        logError("multiplayer: Steam didn't confirm the restored launch options", record.appid);
        return;
    }
    try {
        await multiplayerClearRestore(record.session);
    }
    catch (e) {
        logError("multiplayerClearRestore", e);
    }
    if (launched?.session === record.session) {
        launched = null;
    }
}

export async function launchMultiplayer(appid: number, hardcore: boolean): Promise<MultiplayerLaunchResult> {
    if (launching) {
        return { ok: false, error: "busy" };
    }
    launching = true;
    try {
        return await launchOnce(appid, hardcore);
    }
    finally {
        launching = false;
    }
}

async function launchOnce(appid: number, hardcore: boolean): Promise<MultiplayerLaunchResult> {
    const original = await readLaunchOptions(appid);
    if (original === null) {
        return { ok: false, error: "launch_failed" };
    }
    const prepared = await multiplayerPrepareLaunch(original, hardcore);
    if (!prepared.ok || !prepared.options || !prepared.session) {
        return { ok: false, error: prepared.error ?? "launch_failed", gate: prepared.gate, detail: prepared.detail };
    }
    const record = { appid, original, session: prepared.session };
    if (!(await writeLaunchOptions(appid, prepared.options))) {
        await restore(record);
        return { ok: false, error: "launch_failed" };
    }
    const gameId = appStore.GetAppOverviewByAppID(appid)?.gameid;
    if (!gameId) {
        await restore(record);
        return { ok: false, error: "launch_failed" };
    }
    launched = record;
    publish({ appid, running: false, failure: "" });
    const started = await multiplayerLaunchStarted();
    if (!started.ok) {
        launched = null;
        publish({ appid: 0, running: false });
        await restore(record);
        return { ok: false, error: started.error ?? "launch_failed" };
    }
    SteamClient.Apps.RunGame(gameId, "", -1, LAUNCH_SOURCE);
    return { ok: true };
}

export async function startMultiplayerRound(): Promise<MultiplayerLaunchResult> {
    const started = await multiplayerStart();
    if (!started.ok || !started.appid) {
        return { ok: false, error: started.error ?? "launch_failed" };
    }
    playStart();
    await new Promise((resolve) => window.setTimeout(resolve, START_SOUND_MS));
    let result: MultiplayerLaunchResult;
    try {
        result = await launchMultiplayer(started.appid, multiplayerChoices().hardcore);
    }
    catch (e) {
        logError("multiplayer: the host's launch", e);
        result = { ok: false, error: "launch_failed" };
    }
    if (!result.ok) {
        publish({ failure: result.gate ?? result.error ?? "launch_failed" });
        multiplayerStartCancel(result.error ?? "launch_failed").catch((e) => logError("multiplayerStartCancel", e));
    }
    return result;
}

function toast(line: string) {
    const language = getCurrentLanguage();
    toaster.toast({ title: t(language, "EZ Multiplayer"), body: t(language, line) });
}

function playFanfare(key: string) {
    if (fanfareFor === key) {
        return;
    }
    fanfareFor = key;
    fanfareEndsAt = Date.now() + START_SOUND_MS;
    playStart();
}

async function autoStart(key: string, appid: number) {
    if (startedFor === key) {
        return;
    }
    startedFor = key;
    playFanfare(key);
    const wait = fanfareEndsAt - Date.now();
    if (wait > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, wait));
    }
    if (anyGameRunning()) {
        toast("Close your game first");
        await pressMultiplayerReady(false, "other_game");
        return;
    }
    const result = await launchMultiplayer(appid, multiplayerChoices().hardcore);
    if (!result.ok) {
        publish({ failure: result.gate ?? result.error ?? "launch_failed" });
        await pressMultiplayerReady(false, result.error === "gate" ? "launch_failed" : result.error ?? "launch_failed");
    }
}

function followCurrentGame() {
    window.clearTimeout(followTimer);
    const since = Date.now();
    followTimer = window.setTimeout(async () => {
        if (!registered || currentGameMovedSince(since)) {
            return;
        }
        try {
            const checked = await checkCurrentGame();
            if (checked?.changed) {
                await refreshCurrentGame(true);
            }
        }
        catch (e) {
            logError("multiplayer: following the launched game", e);
        }
    }, FOLLOW_AFTER_MS);
}

function onAppLifetime(event: SteamAppLifetimeEvent) {
    const record = launched;
    if (event?.bRunning && event.unAppID !== record?.appid) {
        const room = multiplayerRoomMarker();
        if (room.role === "guest" && room.ready) {
            void pressMultiplayerReady(false, "unreadied_other_game");
        }
    }
    if (!record || event?.unAppID !== record.appid) {
        return;
    }
    if (event.bRunning) {
        publish({ running: true });
        return;
    }
    publish({ appid: 0, running: false });
    multiplayerLaunchEnded().catch((e) => logError("multiplayerLaunchEnded", e));
    void restore(record);
}

function onSessionEvent(payload: {
    state?: string;
    error?: string;
    appid?: number;
    room?: string;
    round?: number;
    emulator?: string;
    mode?: string;
}) {
    if (payload?.state === "starting") {
        playFanfare(`${payload.room ?? ""}:${Number(payload.round) || 0}`);
        return;
    }
    if (payload?.state === "autostart") {
        if (payload.appid) {
            void autoStart(`${payload.room ?? ""}:${Number(payload.round) || 0}`, payload.appid);
        }
        return;
    }
    if (payload?.state === "playing") {
        if (!(payload.emulator === "dolphin" && payload.mode === "couch")) {
            followCurrentGame();
        }
        return;
    }
    if (payload?.state !== "failed") {
        return;
    }
    publish({ failure: payload.error ?? "launch_failed" });
    const record = launched;
    if (record) {
        void restore(record);
    }
}

async function restoreLeftover() {
    try {
        const { record } = await multiplayerRestoreRecord();
        if (!record) {
            return;
        }
        if (Number(Router.MainRunningApp?.appid ?? 0) === record.appid) {
            launched = record;
            publish({ appid: record.appid, running: true });
            return;
        }
        await restore(record);
    }
    catch (e) {
        logError("multiplayer: restoring leftover launch options", e);
    }
}

export function registerMultiplayerSession() {
    try {
        lifetimeHandle = SteamClient.GameSessions.RegisterForAppLifetimeNotifications(onAppLifetime);
    }
    catch (e) {
        logError("multiplayer: couldn't register for app lifetime notifications", e);
    }
    addEventListener(SESSION_EVENT, onSessionEvent);
    registered = true;
    stopRoomWatch = subscribeMultiplayerRoom(() => {
        const pending = multiplayerRoomMarker().autostart;
        if (pending) {
            void autoStart(`${pending.room}:${pending.round}`, pending.appid);
        }
    });
    void restoreLeftover();
}

export function unregisterMultiplayerSession() {
    registered = false;
    stopRoomWatch?.();
    stopRoomWatch = null;
    window.clearTimeout(followTimer);
    lifetimeHandle?.unregister();
    lifetimeHandle = null;
    removeEventListener(SESSION_EVENT, onSessionEvent);
}
