import { addEventListener, removeEventListener, toaster } from "@decky/api";
import { Router } from "@decky/ui";

import {
    checkCurrentGame,
    multiplayerClearRestore,
    multiplayerLaunchEnded,
    multiplayerLaunchStarted,
    multiplayerPrepareLaunch,
    multiplayerPreparePlay,
    multiplayerRestoreRecord,
    multiplayerRunningApp,
    multiplayerStart,
    multiplayerStartCancel,
    refreshCurrentGame,
    streamPadSwap
} from "../api";
import { getCurrentLanguage, t } from "../locales";
import type { MultiplayerRestoreRecord } from "../types";
import { showNetplaySteps, type NetplaySteps } from "../components/multiplayer/NetplayStepsModal";
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
const PLAY_START_WAIT_MS = 60000;

export type MultiplayerSessionSnapshot = {
    appid: number;
    running: boolean;
    failure: string;
    failureSeq: number;
};

export type RunningSnapshot = {
    appid: number;
    playedGameId: number;
};

export type MultiplayerLaunchResult = {
    ok: boolean;
    error?: string;
    gate?: string;
    detail?: Record<string, string>;
    round?: number;
};

let launched: MultiplayerRestoreRecord | null = null;
const PAD_ORDER_MS = 2000;
let snapshot: MultiplayerSessionSnapshot = { appid: 0, running: false, failure: "", failureSeq: 0 };
let launching = false;
let fanfareEndsAt = 0;
let fanfareFor = "";
let startedFor = "";
let followTimer = 0;
let registered = false;
let stopRoomWatch: (() => void) | null = null;
const listeners = new Set<() => void>();
let lifetimeHandle: { unregister(): void } | null = null;
let played: MultiplayerRestoreRecord | null = null;
let playedRunning = false;
let playStartTimer = 0;
let running: RunningSnapshot = { appid: 0, playedGameId: 0 };
const runningListeners = new Set<() => void>();

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

function publishRunning(next: Partial<RunningSnapshot>) {
    if ((next.appid ?? running.appid) === running.appid && (next.playedGameId ?? running.playedGameId) === running.playedGameId) {
        return;
    }
    running = { ...running, ...next };
    for (const listener of runningListeners) {
        listener();
    }
}

export function subscribeRunningApp(listener: () => void): () => void {
    runningListeners.add(listener);
    return () => {
        runningListeners.delete(listener);
    };
}

export function runningAppSnapshot(): RunningSnapshot {
    return running;
}

function publishFailure(failure: string) {
    publish({ failure, failureSeq: snapshot.failureSeq + 1 });
}

export function otherGameRunning(): boolean {
    const running = Number(Router.MainRunningApp?.appid ?? 0);
    return running > 0 && running !== snapshot.appid;
}

export function anyGameRunning(): boolean {
    return Number(Router.MainRunningApp?.appid ?? 0) > 0 || playStarting();
}

function playStarting(): boolean {
    return played !== null && !playedRunning;
}

function roundStarting(): boolean {
    return launched !== null && snapshot.appid === launched.appid && !snapshot.running;
}

export function launchInFlight(): boolean {
    return launching || playStarting() || roundStarting();
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
        if (played?.session === record.session) {
            forgetPlayed();
        }
        if (launched?.session === record.session) {
            launched = null;
        }
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
    if (played?.session === record.session) {
        forgetPlayed();
    }
}

function forgetPlayed() {
    window.clearTimeout(playStartTimer);
    played = null;
    playedRunning = false;
    publishRunning({ playedGameId: 0 });
}

function screenSize(): string {
    const view = SteamUIStore.WindowStore?.GamepadUIMainWindowInstance?.m_BrowserWindow;
    if (!view?.screen) {
        return "";
    }
    const scale = view.devicePixelRatio || 1;
    return `${Math.round(view.screen.width * scale)}x${Math.round(view.screen.height * scale)}`;
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
    await restoreLeftover();
    const original = await readLaunchOptions(appid);
    if (original === null) {
        return { ok: false, error: "shortcut_unread" };
    }
    const prepared = await multiplayerPrepareLaunch(original, hardcore, screenSize());
    if (!prepared.ok || prepared.options === undefined || !prepared.session) {
        return { ok: false, error: prepared.error ?? "launch_failed", gate: prepared.gate, detail: prepared.detail };
    }
    const record = { appid, original, session: prepared.session };
    if (!(await writeLaunchOptions(appid, prepared.options))) {
        await restore(record);
        return { ok: false, error: "shortcut_unset" };
    }
    const gameId = appStore.GetAppOverviewByAppID(appid)?.gameid;
    if (!gameId) {
        await restore(record);
        return { ok: false, error: "shortcut_gone" };
    }
    launched = record;
    publish({ appid, running: false });
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

export async function playGame(gameId: number, appid: number, fallback: boolean): Promise<MultiplayerLaunchResult> {
    if (launching) {
        return { ok: false, error: "busy" };
    }
    launching = true;
    try {
        return fallback ? await playThroughEmulator(gameId, appid) : runShortcut(appid);
    }
    finally {
        launching = false;
    }
}

function runShortcut(appid: number): MultiplayerLaunchResult {
    const gameId = appStore.GetAppOverviewByAppID(appid)?.gameid;
    if (!gameId) {
        return { ok: false, error: "shortcut_gone" };
    }
    SteamClient.Apps.RunGame(gameId, "", -1, LAUNCH_SOURCE);
    return { ok: true };
}

async function playThroughEmulator(gameId: number, appid: number): Promise<MultiplayerLaunchResult> {
    await restoreLeftover();
    const original = await readLaunchOptions(appid);
    if (original === null) {
        return { ok: false, error: "shortcut_unread" };
    }
    const prepared = await multiplayerPreparePlay(gameId, original);
    if (!prepared.ok || !prepared.options || !prepared.session) {
        return { ok: false, error: prepared.error ?? "launch_failed", gate: prepared.gate, detail: prepared.detail };
    }
    const record = { appid, original, session: prepared.session, play: true };
    if (prepared.appid !== appid) {
        await multiplayerClearRestore(prepared.session).catch((e) => logError("multiplayerClearRestore", e));
        return { ok: false, error: "launch_failed" };
    }
    if (!(await writeLaunchOptions(appid, prepared.options))) {
        await restore(record);
        return { ok: false, error: "shortcut_unset" };
    }
    const steamGameId = appStore.GetAppOverviewByAppID(appid)?.gameid;
    if (!steamGameId) {
        await restore(record);
        return { ok: false, error: "shortcut_gone" };
    }
    played = record;
    playedRunning = false;
    publishRunning({ playedGameId: gameId });
    window.clearTimeout(playStartTimer);
    playStartTimer = window.setTimeout(() => {
        if (played === record && !playedRunning) {
            void restore(record);
        }
    }, PLAY_START_WAIT_MS);
    SteamClient.Apps.RunGame(steamGameId, "", -1, LAUNCH_SOURCE);
    return { ok: true };
}

export async function startMultiplayerRound(steps: NetplaySteps | "" = "", game = ""): Promise<MultiplayerLaunchResult> {
    if (steps) {
        await showNetplaySteps(getCurrentLanguage(), steps, true, game);
    }
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
        multiplayerStartCancel(result.error ?? "launch_failed").catch((e) => logError("multiplayerStartCancel", e));
    }
    return { ...result, round: started.round };
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

async function autoStart(key: string, appid: number, steps: string, game: string) {
    if (startedFor === key) {
        return;
    }
    startedFor = key;
    playFanfare(key);
    const wait = fanfareEndsAt - Date.now();
    if (wait > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, wait));
    }
    if (steps === "dolphin" || steps === "rmg") {
        await showNetplaySteps(getCurrentLanguage(), steps, false, game);
    }
    if (anyGameRunning()) {
        toast("Close your game first");
        await pressMultiplayerReady(false, "other_game");
        return;
    }
    const result = await launchMultiplayer(appid, multiplayerChoices().hardcore);
    if (!result.ok) {
        publishFailure(result.gate ?? result.error ?? "launch_failed");
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

function noteRunningApp(appid: number) {
    const name = appid ? appStore.GetAppOverviewByAppID(appid)?.display_name ?? "" : "";
    multiplayerRunningApp(name).catch((e) => logError("multiplayerRunningApp", e));
}

function onAppLifetime(event: SteamAppLifetimeEvent) {
    noteRunningApp(event?.bRunning ? event.unAppID : 0);
    if (event?.bRunning) {
        publishRunning({ appid: event.unAppID });
    }
    else if (event?.unAppID === running.appid) {
        publishRunning({ appid: 0 });
    }
    const mine = played;
    if (mine && event?.unAppID === mine.appid) {
        if (event.bRunning) {
            playedRunning = true;
        }
        else {
            void restore(mine);
        }
    }
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

let padOrderTimer = 0;

function keepHostFirst() {
    if (padOrderTimer) {
        return;
    }
    padOrderTimer = window.setTimeout(async function look() {
        let answer: { swap: [number, number] | null; done: boolean };
        try {
            answer = await streamPadSwap();
        }
        catch (e) {
            logError("stream play: reading the controller order", e);
            padOrderTimer = 0;
            return;
        }
        if (answer.done || launched === null) {
            padOrderTimer = 0;
            return;
        }
        if (Array.isArray(answer.swap)) {
            SteamClient.Input.SwapControllerOrder(answer.swap[0], answer.swap[1]);
        }
        padOrderTimer = window.setTimeout(look, PAD_ORDER_MS);
    }, PAD_ORDER_MS);
}

function onSessionEvent(payload: {
    state?: string;
    error?: string;
    appid?: number;
    room?: string;
    round?: number;
    steps?: string;
    game?: string;
    emulator?: string;
    mode?: string;
}) {
    if (payload?.state === "starting") {
        playFanfare(`${payload.room ?? ""}:${Number(payload.round) || 0}`);
        return;
    }
    if (payload?.state === "autostart") {
        if (payload.appid) {
            void autoStart(`${payload.room ?? ""}:${Number(payload.round) || 0}`, payload.appid, payload.steps ?? "", payload.game ?? "");
        }
        return;
    }
    if (payload?.state === "playing") {
        if (!((payload.emulator === "dolphin" || payload.emulator === "rmg") && payload.mode === "couch")) {
            followCurrentGame();
        }
        if (payload.mode === "stream") {
            keepHostFirst();
        }
        return;
    }
    if (payload?.state !== "failed") {
        return;
    }
    publishFailure(payload.error ?? "launch_failed");
    const record = launched;
    if (record) {
        void restore(record);
    }
}

async function restoreLeftover() {
    try {
        const { record } = await multiplayerRestoreRecord();
        if (!record || (playStarting() && record.session === played?.session)
            || (roundStarting() && record.session === launched?.session)) {
            return;
        }
        if (Number(Router.MainRunningApp?.appid ?? 0) === record.appid) {
            if (record.play) {
                played = record;
                playedRunning = true;
                publishRunning({ playedGameId: record.gameId ?? 0 });
                return;
            }
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
    noteRunningApp(Number(Router.MainRunningApp?.appid ?? 0));
    publishRunning({ appid: Number(Router.MainRunningApp?.appid ?? 0) });
    stopRoomWatch = subscribeMultiplayerRoom(() => {
        const pending = multiplayerRoomMarker().autostart;
        if (pending) {
            void autoStart(`${pending.room}:${pending.round}`, pending.appid, pending.steps ?? "", pending.game ?? "");
        }
    });
    void restoreLeftover();
}

export function unregisterMultiplayerSession() {
    registered = false;
    stopRoomWatch?.();
    stopRoomWatch = null;
    window.clearTimeout(followTimer);
    window.clearTimeout(playStartTimer);
    lifetimeHandle?.unregister();
    lifetimeHandle = null;
    removeEventListener(SESSION_EVENT, onSessionEvent);
}
