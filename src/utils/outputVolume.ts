import { addEventListener, removeEventListener } from "@decky/api";
import { useEffect, useSyncExternalStore } from "react";

import { multiplayerOutputVolumeGet, multiplayerOutputVolumeSet } from "../api";
import { logError } from "./errors";

const OUTPUT_EVENT = "multiplayer_voice_canceller";
const POLL_MS = 1500;

let volume: number | null = null;
let wanted: number | null = null;
let sending = false;
let reading = false;
let readSeq = 0;
const listeners = new Set<() => void>();

function publish(next: number | null) {
    if (next === volume) {
        return;
    }
    volume = next;
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

function currentVolume(): number | null {
    return volume;
}

async function read() {
    if (reading) {
        return;
    }
    reading = true;
    const seq = ++readSeq;
    let answer: { ok: boolean; volume: number | null };
    try {
        answer = await multiplayerOutputVolumeGet();
    }
    catch (e) {
        logError("output volume: reading it", e);
        return;
    }
    finally {
        reading = false;
    }
    if (seq !== readSeq || sending || wanted !== null) {
        return;
    }
    if (answer.ok && typeof answer.volume === "number") {
        publish(Math.min(100, answer.volume));
    }
}

async function send() {
    sending = true;
    while (wanted !== null) {
        const level = wanted;
        wanted = null;
        try {
            await multiplayerOutputVolumeSet(level);
        }
        catch (e) {
            logError("output volume: setting it", e);
        }
    }
    readSeq += 1;
    sending = false;
}

export function changeOutputVolume(next: number) {
    const level = Math.min(100, Math.max(0, next));
    readSeq += 1;
    wanted = level;
    publish(level);
    if (!sending) {
        void send();
    }
}

export function useOutputVolume(): number | null {
    const value = useSyncExternalStore(subscribe, currentVolume);
    useEffect(() => {
        void read();
        const timer = window.setInterval(() => void read(), POLL_MS);
        const onOutput = (payload: { reason?: string }) => {
            if (payload?.reason === "output") {
                void read();
            }
        };
        addEventListener(OUTPUT_EVENT, onOutput);
        return () => {
            window.clearInterval(timer);
            removeEventListener(OUTPUT_EVENT, onOutput);
        };
    }, []);
    return value;
}
