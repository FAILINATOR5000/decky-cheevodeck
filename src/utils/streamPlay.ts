import { addEventListener, removeEventListener } from "@decky/api";
import { useEffect, useSyncExternalStore } from "react";

import {
    saveMpStreamScreenWarningOff,
    saveMpStreamSlowConnection,
    streamFinishSetup,
    streamRemove,
    streamSetUp,
    streamSize,
    streamStatus,
    streamUpdate,
    type StreamStatus
} from "../api";
import { showMultiplayerProblem } from "../components/multiplayer/ProblemModal";
import { t, type LanguageCode } from "../locales";
import { logError } from "./errors";

const SETUP_EVENT = "stream_setup";
const SHORTCUT_NAME = "Moonlight (CheevoDeck)";
const SHORTCUT_EXE = "/usr/bin/flatpak";
const SHORTCUT_DIR = "/usr/bin";
const SHORTCUT_OPTIONS = "run --user com.moonlight_stream.Moonlight";
const OVERVIEW_TRIES = 20;
const OVERVIEW_WAIT_MS = 150;

type StreamStage = "" | "sunshine" | "moonlight" | "finishing" | "done" | "failed";

type StreamState = {
    status: StreamStatus | null;
    size: string;
    stage: StreamStage;
    job: string;
    lastJob: string;
    progress: number;
};

let state: StreamState = { status: null, size: "", stage: "", job: "", lastJob: "", progress: -1 };
const STAGES: StreamStage[] = ["sunshine", "moonlight", "finishing", "done", "failed"];
const STATUS_POLL_MS = 1500;
const JOB_LOST_MS = 15000;
let jobIdleSince = 0;
const listeners = new Set<() => void>();
let slowConnection = false;
let screenWarningOff = false;
const slowListeners = new Set<() => void>();

function publishSlow(next: boolean) {
    if (next === slowConnection) {
        return;
    }
    slowConnection = next;
    for (const listener of slowListeners) {
        listener();
    }
}

export function setStreamSettings(next: { mpStreamSlowConnection?: boolean; mpStreamScreenWarningOff?: boolean }) {
    publishSlow(next.mpStreamSlowConnection ?? slowConnection);
    screenWarningOff = next.mpStreamScreenWarningOff ?? screenWarningOff;
}

export function streamScreenWarningOff(): boolean {
    return screenWarningOff;
}

export async function hideStreamScreenWarning() {
    screenWarningOff = true;
    try {
        const saved = await saveMpStreamScreenWarningOff(true);
        screenWarningOff = saved.mpStreamScreenWarningOff;
    }
    catch (e) {
        logError("stream play: saving the screen warning", e);
    }
}

export function useSlowConnection(): boolean {
    return useSyncExternalStore((listener) => {
        slowListeners.add(listener);
        return () => {
            slowListeners.delete(listener);
        };
    }, () => slowConnection);
}

export async function changeSlowConnection(next: boolean) {
    const was = slowConnection;
    publishSlow(next);
    try {
        const saved = await saveMpStreamSlowConnection(next);
        publishSlow(saved.mpStreamSlowConnection);
    }
    catch (e) {
        logError("stream play: saving Slow Connection", e);
        publishSlow(was);
    }
}

function publish(next: Partial<StreamState>) {
    state = { ...state, ...next };
    for (const listener of listeners) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function current(): StreamState {
    return state;
}

function onSetupEvent(event: { stage?: string; job?: string; progress?: number }) {
    const stage = event?.stage;
    if (stage === "sunshine" || stage === "moonlight" || stage === "finishing" || stage === "done" || stage === "failed") {
        publish({ stage, progress: typeof event.progress === "number" ? event.progress : -1 });
    }
}

export function setupRunning(snapshot: StreamState, job = "setup"): boolean {
    return snapshot.status?.busy === job || snapshot.job === job;
}

let listening = 0;

async function refreshStreamStatus(): Promise<StreamStatus | null> {
    try {
        const status = await streamStatus();
        const stage = STAGES.find((known) => known === status.stage);
        const running = status.busy && stage ? { stage, progress: status.progress } : {};
        let lost = {};
        if (state.job && !status.busy) {
            jobIdleSince = jobIdleSince || Date.now();
            if (Date.now() - jobIdleSince > JOB_LOST_MS) {
                lost = { job: "" };
            }
        }
        else {
            jobIdleSince = 0;
        }
        publish({ status, ...running, ...lost });
        return status;
    }
    catch (e) {
        logError("stream play: reading the setup status", e);
        return null;
    }
}

export async function readStreamSize(): Promise<string> {
    try {
        const answer = await streamSize();
        if (answer.ok && typeof answer.size === "string" && answer.size) {
            publish({ size: answer.size });
            return answer.size;
        }
    }
    catch (e) {
        logError("stream play: reading the download size", e);
    }
    return "";
}

export function knownStreamSize(): string {
    return state.size;
}

export function useStreamSetup(active: boolean): StreamState {
    useEffect(() => {
        if (!active) {
            return;
        }
        listening += 1;
        if (listening === 1) {
            addEventListener(SETUP_EVENT, onSetupEvent);
            if (!state.job && (state.stage === "done" || state.stage === "failed")) {
                publish({ stage: "", lastJob: "" });
            }
            void refreshStreamStatus().then((status) => {
                if (status && !status.ready) {
                    void readStreamSize();
                }
            });
        }
        return () => {
            listening -= 1;
            if (listening === 0) {
                removeEventListener(SETUP_EVENT, onSetupEvent);
            }
        };
    }, [active]);
    const snapshot = useSyncExternalStore(subscribe, current);
    const running = Boolean(snapshot.job || snapshot.status?.busy);
    useEffect(() => {
        if (!active || !running) {
            return;
        }
        const timer = window.setInterval(() => void refreshStreamStatus(), STATUS_POLL_MS);
        return () => window.clearInterval(timer);
    }, [active, running]);
    return snapshot;
}

function shortcutExists(appid: number): boolean {
    try {
        return appid > 0 && appStore.GetAppOverviewByAppID(appid) !== null;
    }
    catch (e) {
        logError("stream play: looking up the Moonlight shortcut", e);
        return false;
    }
}

async function makeShortcut(): Promise<number> {
    const appid: number = await SteamClient.Apps.AddShortcut(SHORTCUT_NAME, SHORTCUT_EXE, SHORTCUT_DIR, SHORTCUT_OPTIONS);
    if (typeof appid !== "number" || appid <= 0) {
        return 0;
    }
    SteamClient.Apps.SetShortcutName(appid, SHORTCUT_NAME);
    SteamClient.Apps.SetShortcutLaunchOptions(appid, SHORTCUT_OPTIONS);
    for (let tries = 0; tries < OVERVIEW_TRIES && !shortcutExists(appid); tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, OVERVIEW_WAIT_MS));
    }
    try {
        collectionStore.SetAppsAsHidden([appid], true);
    }
    catch (e) {
        logError("stream play: hiding the Moonlight shortcut", e);
    }
    return appid;
}

export function removeMoonlightShortcut(appid: number) {
    if (!shortcutExists(appid)) {
        return;
    }
    try {
        SteamClient.Apps.RemoveShortcut(appid);
    }
    catch (e) {
        logError("stream play: removing the Moonlight shortcut", e);
    }
}

export async function setUpStreaming(): Promise<boolean> {
    if (state.job) {
        return false;
    }
    jobIdleSince = 0;
    publish({ stage: "sunshine", job: "setup", lastJob: "setup", progress: -1 });
    try {
        const result = await streamSetUp();
        if (!result.ok) {
            publish(result.error === "busy" ? { job: "" } : { stage: "failed", job: "" });
            return false;
        }
        let appid = result.appid;
        if (!shortcutExists(appid)) {
            appid = await makeShortcut();
        }
        const finished = appid > 0 ? await streamFinishSetup(appid) : null;
        publish({ stage: finished?.ok ? "done" : "failed", job: "", status: finished?.ok ? finished : state.status });
        return Boolean(finished?.ok);
    }
    catch (e) {
        logError("stream play: setting up", e);
        publish({ stage: "failed", job: "" });
        return false;
    }
}

export async function updateStreaming(): Promise<"ok" | "hosting" | "failed" | "busy"> {
    if (state.job) {
        return "busy";
    }
    publish({ job: "update", lastJob: "update" });
    try {
        const result = await streamUpdate();
        publish({ job: "", status: result.ok ? result : state.status });
        if (result.ok) {
            return "ok";
        }
        return result.error === "hosting" ? "hosting" : result.error === "busy" ? "busy" : "failed";
    }
    catch (e) {
        logError("stream play: updating", e);
        publish({ job: "", stage: "failed" });
        return "failed";
    }
}

const REMOVE_REFUSALS: Record<string, string> = {
    playing: "Wait for the round to end before removing the stream tools.",
    busy: "Streaming is still being set up or updated. Try again when it's done."
};

export async function pressRemoveStreaming(language: LanguageCode) {
    const line = REMOVE_REFUSALS[await removeStreaming()];
    if (line) {
        showMultiplayerProblem(language, "Remove Stream Tools", t(language, line));
    }
}

async function removeStreaming(): Promise<string> {
    if (state.job) {
        return "busy";
    }
    try {
        const result = await streamRemove();
        if (!result.ok) {
            return result.error ?? "failed";
        }
        if (result.appid) {
            removeMoonlightShortcut(result.appid);
        }
        publish({ stage: "", lastJob: "", size: "" });
        await refreshStreamStatus();
        return "";
    }
    catch (e) {
        logError("stream play: removing", e);
        return "failed";
    }
}
