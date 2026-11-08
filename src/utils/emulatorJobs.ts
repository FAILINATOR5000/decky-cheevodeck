import { addEventListener, removeEventListener } from "@decky/api";
import { useSyncExternalStore } from "react";

import { emulatorsStatus, type EmulatorJobState } from "../api";
import { logError } from "./errors";

const JOB_EVENT = "emulator_job";
const STATUS_POLL_MS = 1500;

type EmulatorJobs = {
    state: EmulatorJobState | null;
    busy: boolean;
    finished: number;
};

let jobs: EmulatorJobs = { state: null, busy: false, finished: 0 };
let endedJob = "";
let poll = 0;
const listeners = new Set<() => void>();

function publish(state: EmulatorJobState | null, busy: boolean) {
    let finished = jobs.finished;
    if (state && (state.stage === "done" || state.stage === "failed") && state.job !== endedJob) {
        endedJob = state.job;
        finished += 1;
    }
    jobs = { state, busy, finished };
    for (const listener of listeners) {
        listener();
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
            publish(status.state ?? jobs.state, Boolean(status.busy));
        }
    }
    catch (e) {
        logError("emulators: reading the job status", e);
    }
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
