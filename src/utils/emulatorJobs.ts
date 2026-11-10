import { addEventListener, removeEventListener } from "@decky/api";
import { useSyncExternalStore } from "react";

import { emulatorsStatus, type EmulatorJobState } from "../api";
import { t, type LanguageCode } from "../locales";
import { logError } from "./errors";

const JOB_EVENT = "emulator_job";
const STATUS_POLL_MS = 1500;

type EmulatorJobs = {
    state: EmulatorJobState | null;
    busy: boolean;
    finished: number;
    active: EmulatorJobState[];
};

let jobs: EmulatorJobs = { state: null, busy: false, finished: 0, active: [] };
const active = new Map<string, EmulatorJobState>();
let endedJob = "";
let poll = 0;
const listeners = new Set<() => void>();
const watchers = new Set<(state: EmulatorJobState) => void>();

const ERROR_LINES: Record<string, string> = {
    no_space: "Not enough free space.",
    no_network: "Couldn't reach the server. Check your internet connection and try again.",
    unsafe: "A file wasn't the way CheevoDeck expected, so it stopped.",
    busy: "Another install is running."
};

export function jobErrorText(language: LanguageCode, error: string, name: string, cores: boolean): string {
    if (error === "running") {
        return cores || !name ? t(language, "Close RetroArch first.") : t(language, "Close {{name}} first.", { name });
    }
    return ERROR_LINES[error] ? t(language, ERROR_LINES[error]) : "";
}

function publish(state: EmulatorJobState | null, busy: boolean, live?: string[]) {
    let finished = jobs.finished;
    const ended = state !== null && (state.stage === "done" || state.stage === "failed");
    if (ended && state.job !== endedJob) {
        endedJob = state.job;
        finished += 1;
    }
    if (state !== null) {
        if (ended) {
            active.delete(state.job);
        }
        else {
            active.set(state.job, state);
        }
    }
    for (const job of [...active.keys()]) {
        if (!busy || (live !== undefined && !live.includes(job))) {
            active.delete(job);
        }
    }
    jobs = { state, busy, finished, active: [...active.values()] };
    for (const listener of listeners) {
        listener();
    }
    if (state) {
        for (const watcher of [...watchers]) {
            watcher(state);
        }
    }
    if (busy && poll === 0) {
        poll = window.setInterval(() => void refreshEmulatorJobs(), STATUS_POLL_MS);
    }
    else if (!busy && poll !== 0) {
        window.clearInterval(poll);
        poll = 0;
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function onJobEvent(payload: EmulatorJobState) {
    if (!payload || typeof payload !== "object" || typeof payload.job !== "string") {
        return;
    }
    const ended = payload.stage === "done" || payload.stage === "failed";
    publish(payload, !ended || jobs.busy);
    if (ended) {
        void refreshEmulatorJobs();
    }
}

async function refreshEmulatorJobs() {
    try {
        const status = await emulatorsStatus();
        if (status?.ok) {
            const live = typeof status.running === "string" ? [status.running, ...(status.queued ?? [])] : undefined;
            publish(status.state ?? jobs.state, Boolean(status.busy), live);
        }
    }
    catch (e) {
        logError("emulators: reading the job status", e);
    }
}

export function watchEmulatorJob(job: string, onProgress: (state: EmulatorJobState) => void): Promise<EmulatorJobState> {
    return new Promise((resolve) => {
        const watcher = (state: EmulatorJobState) => {
            if (state.job !== job) {
                return;
            }
            onProgress(state);
            if (state.stage === "done" || state.stage === "failed") {
                watchers.delete(watcher);
                resolve(state);
            }
        };
        watchers.add(watcher);
        noteEmulatorJobStarted();
        if (jobs.state) {
            watcher(jobs.state);
        }
    });
}

export function noteEmulatorJobStarted() {
    publish(jobs.state, true);
}

export function useEmulatorJobs(): EmulatorJobs {
    return useSyncExternalStore(subscribe, () => jobs);
}

export function registerEmulatorJobs() {
    addEventListener(JOB_EVENT, onJobEvent);
    void refreshEmulatorJobs();
}

export function unregisterEmulatorJobs() {
    removeEventListener(JOB_EVENT, onJobEvent);
    if (poll !== 0) {
        window.clearInterval(poll);
        poll = 0;
    }
}
