import { addEventListener, removeEventListener } from "@decky/api";
import { useSyncExternalStore } from "react";

import {
    multiplayerGameStreams,
    multiplayerGameVolumePutBack,
    multiplayerGameVolumeRecord,
    multiplayerGameVolumeRecords,
    multiplayerRoomVolumesGet,
    multiplayerRoomVolumesSet
} from "../api";
import { logError } from "./errors";
import { multiplayerRoomMarker, subscribeMultiplayerRoom } from "./multiplayerRoomState";
import { setDucking, setIncomingVolume } from "./voiceChat";

type Stream = { id: number; app: string };
type Lowered = { original: number; set: number };

export type GameVolumeState = { level: number; playing: boolean; output: string; duck: boolean; duckStrength: number };

const DEFAULT_GAME = 60;
const OUTPUT_EVENT = "multiplayer_voice_canceller";
const DEFAULT_INCOMING = 100;
const DEFAULT_DUCK_STRENGTH = 2;
const ECHO = 0.02;
const SAVE_MS = 500;
const SETTLE_MS = 1500;
const RETRY_MS = 2000;
const RETRIES = 15;
const LOAD_TRIES = 5;

let level = 100;
let incoming = DEFAULT_INCOMING;
let duck = false;
let duckStrength = DEFAULT_DUCK_STRENGTH;
let duckMoved = false;
let shownOutput = "";
let key = "";
let game = 0;
let output = "";
let loadSeq = 0;
let active = false;
let loading = false;
let incomingMoved = false;
let released = false;
let loaded = false;
let records: Record<string, Lowered> = {};
const ours = new Map<string, Set<number>>();
const seen = new Map<number, { app: string; since: number }>();
const tried = new Set<string>();
const putBack = new Map<string, Lowered>();
let playing = false;
let queue: Promise<void> = Promise.resolve();
let putBackQueue: Promise<void> = Promise.resolve();
let retryTimer: number | null = null;
let retries = 0;
let saveTimer: number | null = null;
let registered = false;
const unregisters: (() => void)[] = [];

const listeners = new Set<() => void>();
let snapshot: GameVolumeState = { level, playing, output: shownOutput, duck, duckStrength };

function publish() {
    if (snapshot.level === level && snapshot.playing === playing && snapshot.output === shownOutput
        && snapshot.duck === duck && snapshot.duckStrength === duckStrength) {
        return;
    }
    snapshot = { level, playing, output: shownOutput, duck, duckStrength };
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

function gameVolumeState(): GameVolumeState {
    return snapshot;
}

function subscribeNever(): () => void {
    return () => { };
}

export function useGameVolume(active = true): GameVolumeState {
    return useSyncExternalStore(active ? subscribe : subscribeNever, gameVolumeState);
}

function steamAudio() {
    return SteamClient?.System?.Audio;
}

function near(a: number, b: number) {
    return Math.abs(a - b) <= ECHO;
}

function isOurs(app: string, volume: number) {
    const record = records[app];
    if (record && (near(volume, record.set) || near(volume, record.original))) {
        return true;
    }
    for (const set of ours.get(app) ?? []) {
        if (near(volume, set)) {
            return true;
        }
    }
    return false;
}

function setStream(id: number, app: string, volume: number) {
    if (!registered) {
        return;
    }
    let levels = ours.get(app);
    if (!levels) {
        levels = new Set();
        ours.set(app, levels);
    }
    levels.add(volume);
    void Promise.resolve(steamAudio()?.SetAppVolume(id, volume)).catch((e) => logError("game volume: setting a stream", e));
}

async function keep(app: string, lowered: Lowered | null): Promise<boolean> {
    let answer: { ok: boolean; original?: number };
    try {
        answer = await multiplayerGameVolumeRecord(app, lowered?.original ?? null, lowered?.set ?? null);
    }
    catch (e) {
        logError("game volume: keeping the record", e);
        return false;
    }
    if (!answer.ok) {
        return false;
    }
    if (lowered === null) {
        delete records[app];
    }
    else {
        records[app] = { original: typeof answer.original === "number" ? answer.original : lowered.original, set: lowered.set };
    }
    return true;
}

function reconcile() {
    retries = 0;
    queue = queue.then(pass).catch((e) => logError("game volume: a pass", e));
}

function retrySoon() {
    if (retryTimer !== null || retries >= RETRIES || !registered) {
        return;
    }
    retryTimer = window.setTimeout(() => {
        retryTimer = null;
        retries += 1;
        queue = queue.then(pass).catch((e) => logError("game volume: a pass", e));
    }, RETRY_MS);
}

function queuePutBack(app: string) {
    putBackQueue = putBackQueue.then(async () => {
        const lowered = records[app];
        if (!lowered) {
            return;
        }
        const done = await multiplayerGameVolumePutBack(app, [...(ours.get(app) ?? [])]);
        if (done.ok && records[app] === lowered) {
            delete records[app];
            putBack.set(app, lowered);
        }
    }).catch((e) => logError("game volume: putting a closed game back", e));
}

async function pass() {
    if (!registered || !loaded) {
        return;
    }
    let answer: { ok: boolean; streams?: Stream[] } = { ok: false };
    try {
        answer = await multiplayerGameStreams();
    }
    catch (e) {
        logError("game volume: reading the streams", e);
    }
    const listed = await steamAudio()?.GetApps();
    const volumes = new Map<number, number>(
        (listed?.rgApps ?? []).map((app: { id: number; flVolume: number }) => [app.id, app.flVolume])
    );
    const now = Date.now();
    let streams: Stream[];
    if (answer.ok) {
        streams = answer.streams ?? [];
        for (const id of [...seen.keys()]) {
            if (!streams.some((stream) => stream.id === id)) {
                seen.delete(id);
            }
        }
        for (const stream of streams) {
            if (!seen.has(stream.id)) {
                seen.set(stream.id, { app: stream.app, since: now });
            }
        }
    }
    else {
        streams = [...seen].map(([id, stream]) => ({ id, app: stream.app }));
    }
    const live = streams.filter((stream) => volumes.has(stream.id));
    playing = live.length > 0;
    if (active && loading) {
        publish();
        return;
    }
    const lower = active && !released && level < 100;
    const target = level / 100;
    let again = !answer.ok;
    for (const app of new Set([...live.map((stream) => stream.app), ...Object.keys(records)])) {
        if (!registered) {
            return;
        }
        const mine = live.filter((stream) => stream.app === app);
        if (mine.length === 0) {
            if (answer.ok && records[app] && !tried.has(app)) {
                tried.add(app);
                queuePutBack(app);
            }
            continue;
        }
        tried.delete(app);
        if (mine.some((stream) => now - (seen.get(stream.id)?.since ?? now) < SETTLE_MS)) {
            again = true;
            continue;
        }
        const before = putBack.get(app);
        putBack.delete(app);
        const record = records[app];
        if (lower) {
            if (!record || record.set !== target) {
                const first = volumes.get(mine[0].id) ?? 1;
                const original = record?.original ?? (before && near(first, before.set) ? before.original : first);
                if (!(await keep(app, { original, set: target }))) {
                    again = true;
                    continue;
                }
            }
            for (const stream of mine) {
                if (Math.abs((volumes.get(stream.id) ?? 1) - target) > ECHO / 2) {
                    setStream(stream.id, app, target);
                }
            }
        }
        else if (record) {
            let pending = false;
            for (const stream of mine) {
                const current = volumes.get(stream.id) ?? 1;
                if (!near(current, record.original) && isOurs(app, current)) {
                    setStream(stream.id, app, record.original);
                    pending = true;
                }
            }
            if (pending || !(await keep(app, null))) {
                again = true;
            }
        }
        else if (before) {
            for (const stream of mine) {
                const current = volumes.get(stream.id) ?? 1;
                if (near(current, before.set) && !near(current, before.original)) {
                    setStream(stream.id, app, before.original);
                }
            }
        }
    }
    if (again) {
        retrySoon();
    }
    publish();
}

function save() {
    saveTimer = null;
    if (game > 0 && output) {
        void multiplayerRoomVolumesSet(game, level, incoming, output, duck, duckStrength)
            .catch((e) => logError("game volume: saving the room volumes", e));
    }
}

function saveSoon() {
    if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(save, SAVE_MS);
}

function saveNow() {
    if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        save();
    }
}

export function changeGameVolume(next: number) {
    level = Math.min(100, Math.max(0, next));
    released = false;
    loading = false;
    publish();
    reconcile();
    saveSoon();
}

export function changeIncomingVolume(next: number) {
    incoming = Math.min(100, Math.max(0, next));
    incomingMoved = true;
    setIncomingVolume(incoming);
    saveSoon();
}

export function changeDuck(on: boolean) {
    if (!output) {
        return;
    }
    duck = on;
    duckMoved = true;
    setDucking(duck, duckStrength);
    publish();
    saveSoon();
}

export function changeDuckStrength(next: number) {
    if (!output) {
        return;
    }
    duckStrength = Math.min(4, Math.max(1, next));
    duckMoved = true;
    setDucking(duck, duckStrength);
    publish();
    saveSoon();
}

async function loadLevels(forKey: string, forGame: number) {
    const seq = ++loadSeq;
    let answer: { ok: boolean; game?: number; incoming?: number; duck?: boolean; duckStrength?: number; output?: string }
        = { ok: false };
    try {
        answer = await multiplayerRoomVolumesGet(forGame);
    }
    catch (e) {
        logError("game volume: reading the room volumes", e);
    }
    if (forKey !== key || seq !== loadSeq) {
        return;
    }
    output = answer.ok && typeof answer.output === "string" ? answer.output : "";
    if (output) {
        shownOutput = output;
    }
    if (!duckMoved && answer.ok) {
        duck = answer.duck === true;
        duckStrength = typeof answer.duckStrength === "number" ? answer.duckStrength : DEFAULT_DUCK_STRENGTH;
        setDucking(duck, duckStrength);
    }
    if (loading) {
        level = answer.ok && typeof answer.game === "number" ? answer.game : DEFAULT_GAME;
        released = false;
        loading = false;
    }
    if (!incomingMoved) {
        incoming = answer.ok && typeof answer.incoming === "number" ? answer.incoming : DEFAULT_INCOMING;
        setIncomingVolume(incoming);
    }
    publish();
    reconcile();
}

export function reloadRoomVolumes() {
    if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (key) {
        loading = true;
        incomingMoved = false;
        duckMoved = false;
        void loadLevels(key, game);
    }
}

function onOutputChanged(payload: { reason?: string }) {
    if (payload?.reason !== "output" || !key) {
        return;
    }
    saveNow();
    output = "";
    loading = true;
    incomingMoved = false;
    duckMoved = false;
    void loadLevels(key, game);
}

function onRoom() {
    const marker = multiplayerRoomMarker();
    const view = marker.role !== null ? marker.voice : null;
    const nextKey = view ? `${view.room}:${view.game}` : "";
    if (nextKey !== key) {
        saveNow();
        key = nextKey;
        game = view?.game ?? 0;
        released = false;
        level = 100;
        loading = Boolean(view);
        incomingMoved = false;
        duckMoved = false;
        setDucking(false, duckStrength);
        if (view) {
            void loadLevels(nextKey, game);
        }
    }
    if (Boolean(view) !== active) {
        active = Boolean(view);
        reconcile();
    }
    publish();
}

function onVolumeChanged(id: number, volume: number) {
    const stream = seen.get(id);
    if (!stream) {
        return;
    }
    if (records[stream.app] && !isOurs(stream.app, volume)) {
        released = true;
        level = Math.min(100, Math.round(volume * 20) * 5);
        const app = stream.app;
        queue = queue.then(async () => {
            await keep(app, null);
        }).catch((e) => logError("game volume: letting go", e));
        publish();
    }
    reconcile();
}

function onAppAdded(app: { id?: unknown; flVolume?: unknown } | undefined) {
    if (typeof app?.id === "number" && typeof app.flVolume === "number" && seen.has(app.id)) {
        onVolumeChanged(app.id, app.flVolume);
    }
    else {
        reconcile();
    }
}

function readRecords(raw: unknown): Record<string, Lowered> {
    const kept: Record<string, Lowered> = {};
    if (!raw || typeof raw !== "object") {
        return kept;
    }
    for (const [app, row] of Object.entries(raw as Record<string, Lowered>)) {
        if (row && typeof row.original === "number" && typeof row.set === "number") {
            kept[app] = { original: row.original, set: row.set };
        }
    }
    return kept;
}

function loadRecords(attempt: number) {
    multiplayerGameVolumeRecords().then((answer) => {
        if (!answer.ok) {
            throw new Error("records unreadable");
        }
        records = readRecords(answer.records);
        loaded = true;
        onRoom();
        reconcile();
    }).catch((e) => {
        if (registered && attempt < LOAD_TRIES) {
            window.setTimeout(() => loadRecords(attempt + 1), RETRY_MS);
        }
        else {
            logError("game volume: reading the record", e);
        }
    });
}

export function registerGameVolume() {
    const audio = steamAudio();
    if (typeof audio?.GetApps !== "function" || typeof audio?.SetAppVolume !== "function") {
        return;
    }
    registered = true;
    try {
        for (const handle of [
            audio.RegisterForAppAdded?.(onAppAdded),
            audio.RegisterForAppRemoved?.(() => reconcile()),
            audio.RegisterForAppVolumeChanged?.(onVolumeChanged)
        ]) {
            if (handle?.unregister) {
                unregisters.push(() => handle.unregister());
            }
        }
    }
    catch (e) {
        logError("game volume: watching Steam's audio apps", e);
    }
    unregisters.push(subscribeMultiplayerRoom(onRoom));
    addEventListener(OUTPUT_EVENT, onOutputChanged);
    unregisters.push(() => removeEventListener(OUTPUT_EVENT, onOutputChanged));
    loadRecords(1);
}

export function unregisterGameVolume() {
    registered = false;
    active = false;
    saveNow();
    if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
    }
    for (const stop of unregisters.splice(0)) {
        stop();
    }
    const streams = new Map(seen);
    const audio = steamAudio();
    void Promise.resolve(audio?.GetApps()).then((listed) => {
        for (const app of listed?.rgApps ?? []) {
            const stream = streams.get(app.id);
            const record = stream ? records[stream.app] : undefined;
            if (stream && record && !near(app.flVolume, record.original) && isOurs(stream.app, app.flVolume)) {
                void Promise.resolve(audio?.SetAppVolume(app.id, record.original)).catch(() => { });
            }
        }
    }).catch(() => { });
}
