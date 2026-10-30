import { addEventListener, removeEventListener } from "@decky/api";
import { Router } from "@decky/ui";

import {
    multiplayerClearRestore,
    multiplayerLaunchEnded,
    multiplayerLaunchStarted,
    multiplayerPrepareLaunch,
    multiplayerRestoreRecord
} from "../api";
import type { MultiplayerRestoreRecord } from "../types";
import { logError } from "./errors";

const SESSION_EVENT = "multiplayer_session";
const OPTIONS_WAIT_MS = 5000;
const READ_WAIT_MS = 3000;
const LAUNCH_SOURCE = 100;

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
    await multiplayerLaunchStarted();
    SteamClient.Apps.RunGame(gameId, "", -1, LAUNCH_SOURCE);
    return { ok: true };
}

function onAppLifetime(event: SteamAppLifetimeEvent) {
    const record = launched;
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

function onSessionEvent(payload: { state?: string; error?: string }) {
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
    void restoreLeftover();
}

export function unregisterMultiplayerSession() {
    lifetimeHandle?.unregister();
    lifetimeHandle = null;
    removeEventListener(SESSION_EVENT, onSessionEvent);
}
