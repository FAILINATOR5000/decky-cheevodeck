import { addEventListener, removeEventListener, toaster } from "@decky/api";
import { useSyncExternalStore } from "react";

import {
    debugLoggingEnabled,
    multiplayerVoiceCanceller,
    multiplayerVoiceConfig,
    multiplayerVoiceDuck,
    multiplayerVoiceJoin,
    multiplayerVoiceLog,
    multiplayerVoiceSend,
    saveMpVoicePttToggle,
    saveMpVoicePushToTalk
} from "../api";
import { getCurrentLanguage, t } from "../locales";
import { logError } from "./errors";
import { multiplayerRoomMarker, subscribeMultiplayerRoom } from "./multiplayerRoomState";

const VOICE_EVENT = "multiplayer_voice";
const STEAM_INPUT = 0;
const DEBUG_EVENT = "multiplayer_voice_debug";
const CANCELLER_EVENT = "multiplayer_voice_canceller";
const CANCELLER_SOURCE = "Echo-Cancel Source";
const CANCELLER_SINK = "Echo-Cancel Sink";
const CANCELLER_LOOKS = 5;
const CANCELLER_LOOK_MS = 200;

const GATHER_MS = 4000;
const ANSWER_WAIT_MS = 15000;
const RETRY_MS = [2000, 5000, 10000, 30000];
const RENEW_RESTART_MS = 10000;
const STATS_MS = 30000;

const OPUS_PARAMS: Record<string, string> = { useinbandfec: "1", usedtx: "1", maxaveragebitrate: "24000", stereo: "0" };

const GATE_TICK_MS = 20;
const GATE_OPEN_WINDOWS = 5;
const GATE_OPEN_MS = 10;
const GATE_HOLD_MS = 600;
const GATE_CLOSE_MS = 150;
const MIC_BOOST = 2.82;
const SEND_CEILING_DB = -12;
const ONSET_DELAY_S = (GATE_OPEN_WINDOWS + 1) * GATE_TICK_MS / 1000;
const FAR_DB = -50;
const FAR_TAIL_MS = 300;
const FAR_MARGIN_DB = 12;
const SENSITIVITY_DB: Record<number, number> = { 1: -40, 2: -48, 3: -56 };
const DUCK_DB: Record<number, number> = { 1: -6, 2: -12, 3: -18, 4: -24 };

const SPEAKING_DB = -50;
const SPEAKING_HOLD_MS = 300;
const SPEAKING_TICK_MS = 125;

export type VoiceMine = "off" | "on" | "steam";

type VoiceSeat = {
    inVoice: boolean;
    speaking: boolean;
    mutedByMe: boolean;
    failed: boolean;
};

export type VoiceState = {
    on: boolean;
    available: boolean;
    mine: VoiceMine;
    speaking: boolean;
    seats: Record<number, VoiceSeat>;
    volume: number;
    micLevel: number | null;
};

export type MicPress = { ok: true } | { ok: false; reason: "steam" } | { ok: false; reason: "mic"; error: string };

type RoomVoice = { room: string; where: string; access: string; cfg: string; seats: ({ vc: boolean; vs: number } | null)[] };

type IceConfig = { servers: RTCIceServer[]; policy: RTCIceTransportPolicy; available: boolean };

type Peer = {
    index: number;
    stamp: number;
    pc: RTCPeerConnection | null;
    sender: RTCRtpSender | null;
    offerer: boolean;
    gen: number;
    remoteGen: number;
    remoteSession: string;
    state: "connecting" | "connected" | "failed";
    retries: number;
    timer: number | null;
    audio: HTMLAudioElement | null;
    source: MediaStreamAudioSourceNode | null;
    gain: GainNode | null;
    limiter: DynamicsCompressorNode | null;
    analyser: AnalyserNode | null;
    speaking: boolean;
    loudAt: number;
};

type Mic = {
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    boost: GainNode;
    analyser: AnalyserNode;
    delay: DelayNode;
    gain: GainNode;
    limiter: DynamicsCompressorNode;
    trim: GainNode;
    track: MediaStreamTrack;
    timer: number;
    open: boolean;
    loudRun: number;
    loudAt: number;
    farAt: number;
    speakAt: number;
    speaking: boolean;
    duck: boolean;
    echoPath: boolean;
};

type Canceller = { source: string; sink: string; duck: boolean };
type CancellerAnswer = { canceller: Canceller | null; echoPath: boolean };

let volume = 80;
let pushToTalk = false;
let pushToTalkBound = false;
let pttToggle = true;
let pttLatched = false;
let pttButton = "";
let muteButton = "";
let sensitivity = 2;
let ducking = false;
let duckStrength = 2;
let echoCancellation = true;
let cancelling = true;
let limiting = true;

let room: { id: string; where: string; access: string; seat: number; host: boolean } | null = null;
let config: IceConfig | null = null;
let configFor = "";
let configStamp = "";
const peers = new Map<number, Peer>();
const prefs = new Map<string, { muted: boolean }>();
let prefsRoom = "";
let names: string[] = [];
let ctx: AudioContext | null = null;
let output: { destination: MediaStreamAudioDestinationNode; element: HTMLAudioElement } | null = null;
let outputSink = "";
let mic: Mic | null = null;
let micOpening = false;
let cancellerQueue: Promise<unknown> = Promise.resolve();
let cancellerEpoch = 0;
let held: CancellerAnswer | null = null;
let wantMic = false;
let steamCall = false;
let steamAllowed = false;
let mutedForSteam = false;
let pttDown = 0;
let lastGen = 0;
let speakingTimer: number | null = null;
let statsTimer: number | null = null;
let stopSteamWatch: (() => void) | null = null;
let stopRoomWatch: (() => void) | null = null;
let settled = false;

const listeners = new Set<() => void>();

const OFF: VoiceState = { on: false, available: true, mine: "off", speaking: false, seats: {}, volume: 80, micLevel: null };
let snapshot: VoiceState = OFF;
let snapshotText = JSON.stringify(OFF);
let micDevice = -1;
let micLevel: number | null = null;
let stopMicWatch: (() => void) | null = null;

function logVoice(line: string) {
    void multiplayerVoiceLog(line, false).catch(() => { });
}

function logVoiceDebug(line: string) {
    if (debugLoggingEnabled()) {
        void multiplayerVoiceLog(line, true).catch(() => { });
    }
}

function toast(line: string) {
    const language = getCurrentLanguage();
    toaster.toast({ title: t(language, "EZ Multiplayer"), body: t(language, line) });
}

function publish() {
    const next = buildState();
    const text = JSON.stringify(next);
    if (text === snapshotText) {
        return;
    }
    snapshotText = text;
    snapshot = next;
    for (const listener of listeners) {
        listener();
    }
}

function buildState(): VoiceState {
    if (!room) {
        return { ...OFF, volume, micLevel };
    }
    const marker = multiplayerRoomMarker();
    const view = marker.voice;
    const seats: Record<number, VoiceSeat> = {};
    (view?.seats ?? []).forEach((seat, index) => {
        if (index === room?.seat || !names[index]) {
            return;
        }
        const peer = peers.get(index);
        const pref = prefs.get(names[index].toLowerCase());
        seats[index] = {
            inVoice: Boolean(seat?.vc),
            speaking: Boolean(peer?.speaking) && !pref?.muted,
            mutedByMe: Boolean(pref?.muted),
            failed: peer?.state === "failed"
        };
    });
    return {
        on: true,
        available: config?.available ?? true,
        mine: !wantMic || config?.available === false ? "off" : mutedForSteam ? "steam"
            : pttWorking() && !pttTalking() ? "off" : "on",
        speaking: Boolean(mic?.speaking),
        seats,
        volume,
        micLevel
    };
}

function subscribe(listener: () => void): () => void {
    if (listeners.size === 0 && stopMicWatch) {
        void readMicLevel();
    }
    listeners.add(listener);
    watchSpeaking();
    return () => {
        listeners.delete(listener);
        watchSpeaking();
    };
}

function voiceState(): VoiceState {
    return snapshot;
}

function subscribeNever(): () => void {
    return () => { };
}

export function useVoiceChat(active = true): VoiceState {
    return useSyncExternalStore(active ? subscribe : subscribeNever, voiceState);
}

export function setVoiceSettings(next: {
    mpVoicePushToTalk?: boolean;
    mpVoicePttToggle?: boolean;
    mpVoiceSensitivity?: number;
    shortcutBindings?: Record<string, string>;
}) {
    const was = pttWorking();
    pushToTalk = next.mpVoicePushToTalk ?? pushToTalk;
    if (next.mpVoicePttToggle !== undefined && next.mpVoicePttToggle !== pttToggle) {
        pttToggle = next.mpVoicePttToggle;
        pttLatched = false;
        pttDown = 0;
        publishPushToTalk();
    }
    if (next.shortcutBindings) {
        const bindings = Object.entries(next.shortcutBindings);
        pttButton = bindings.find(([, action]) => action === "pushToTalk")?.[0] ?? "";
        muteButton = bindings.find(([, action]) => action === "voiceMute")?.[0] ?? "";
        pushToTalkBound = pttButton !== "";
    }
    sensitivity = next.mpVoiceSensitivity ?? sensitivity;
    settled = true;
    pushToTalkMoved(was);
    setIncomingVolume(volume);
}

function pttWorking(): boolean {
    return pushToTalk && pushToTalkBound;
}

function pttTalking(): boolean {
    return pttToggle ? pttLatched : pttDown > 0;
}

function pushToTalkMoved(was: boolean) {
    const now = pttWorking();
    publishPushToTalk();
    if (now === was) {
        return;
    }
    pttDown = 0;
    pttLatched = false;
    if (!room) {
        return;
    }
    wantMic = now;
    mutedForSteam = now && steamCall;
    steamAllowed = false;
    applyMic();
    publish();
}

export function changePushToTalk(on: boolean) {
    const before = pushToTalk;
    const was = pttWorking();
    pushToTalk = on;
    pushToTalkMoved(was);
    saveMpVoicePushToTalk(on).then((result) => {
        if (!result.ok) {
            throw new Error("not saved");
        }
    }).catch((e) => {
        logError("voice: saving Push to Talk", e);
        if (pushToTalk === on) {
            const working = pttWorking();
            pushToTalk = before;
            pushToTalkMoved(working);
        }
    });
}

export function changePttToggle(on: boolean) {
    const before = pttToggle;
    pttToggle = on;
    pttLatched = false;
    pttDown = 0;
    publishPushToTalk();
    publish();
    saveMpVoicePttToggle(on).then((result) => {
        if (!result.ok) {
            throw new Error("not saved");
        }
    }).catch((e) => {
        logError("voice: saving PTT: Toggleable", e);
        if (pttToggle === on) {
            pttToggle = before;
            pttLatched = false;
            publishPushToTalk();
            publish();
        }
    });
}

type PushToTalkState = { on: boolean; working: boolean; toggle: boolean; pttButton: string; muteButton: string };

const pttListeners = new Set<() => void>();
let pttSnapshot: PushToTalkState = { on: false, working: false, toggle: true, pttButton: "", muteButton: "" };

function publishPushToTalk() {
    if (pttSnapshot.on === pushToTalk && pttSnapshot.working === pttWorking() && pttSnapshot.toggle === pttToggle
        && pttSnapshot.pttButton === pttButton && pttSnapshot.muteButton === muteButton) {
        return;
    }
    pttSnapshot = { on: pushToTalk, working: pttWorking(), toggle: pttToggle, pttButton, muteButton };
    for (const listener of pttListeners) {
        listener();
    }
}

function subscribePushToTalk(listener: () => void): () => void {
    pttListeners.add(listener);
    return () => {
        pttListeners.delete(listener);
    };
}

function pushToTalkState(): PushToTalkState {
    return pttSnapshot;
}

export function usePushToTalk(): PushToTalkState {
    return useSyncExternalStore(subscribePushToTalk, pushToTalkState);
}

export function setDucking(on: boolean, strength: number) {
    if (on === ducking && strength === duckStrength) {
        return;
    }
    const was = ducking;
    ducking = on;
    duckStrength = strength;
    if (mic?.open && mic.duck && (was || on)) {
        duckGame(on);
    }
}

export function setIncomingVolume(next: number) {
    if (next !== volume) {
        volume = next;
        for (const peer of peers.values()) {
            applyPeerVolume(peer);
        }
    }
    sync();
    publish();
}

export function changeMicLevel(percent: number) {
    if (micDevice < 0) {
        return;
    }
    micLevel = Math.min(100, Math.max(0, percent)) / 100;
    try {
        void SteamClient.System.Audio.SetDeviceVolume(micDevice, STEAM_INPUT, micLevel);
    }
    catch (e) {
        logError("voice: setting the mic level", e);
    }
    publish();
}

async function readMicLevel() {
    try {
        const devices = await SteamClient.System.Audio.GetDevices();
        micDevice = typeof devices?.activeInputDeviceId === "number" ? devices.activeInputDeviceId : -1;
        const device = (devices?.vecDevices ?? []).find((entry: { id?: number }) => entry.id === micDevice);
        micLevel = typeof device?.flInputVolume === "number" ? device.flInputVolume : null;
        publish();
    }
    catch (e) {
        logError("voice: reading the mic level", e);
    }
}

function watchMicLevel(): (() => void) | null {
    const audio = SteamClient?.System?.Audio;
    if (typeof audio?.GetDevices !== "function" || typeof audio?.RegisterForDeviceVolumeChanged !== "function") {
        return null;
    }
    void readMicLevel();
    try {
        const handle = audio.RegisterForDeviceVolumeChanged((device: number, channel: number, level: number) => {
            if (device === micDevice && channel === STEAM_INPUT && typeof level === "number") {
                micLevel = level;
                publish();
            }
        });
        return () => handle?.unregister?.();
    }
    catch (e) {
        logError("voice: watching the mic level", e);
        return null;
    }
}

function sync() {
    if (!settled || !stopRoomWatch) {
        return;
    }
    const marker = multiplayerRoomMarker();
    const view = marker.voice;
    const seated = marker.role !== null && view !== null && Boolean(view.seats[marker.seat]);
    if (!seated) {
        if (room) {
            const turnedOff = marker.role !== null && view === null && !room.host;
            leave();
            if (turnedOff) {
                toast("Voice chat turned off for this room");
            }
        }
        publish();
        return;
    }
    if (room && (room.id !== view.room || room.seat !== marker.seat)) {
        leave();
    }
    names = marker.seats.map((seat) => seat.name);
    if (!room) {
        enter(view, marker.seat, marker.role === "host");
    }
    else if (view.cfg !== configStamp) {
        configStamp = view.cfg;
        void readConfig(view.room);
    }
    reconcile(view);
    publish();
}

function enter(view: RoomVoice, seat: number, host: boolean) {
    room = { id: view.room, where: view.where, access: view.access, seat, host };
    if (prefsRoom !== view.room) {
        prefs.clear();
        prefsRoom = view.room;
    }
    wantMic = pttWorking();
    mutedForSteam = wantMic && steamCall;
    held = null;
    configStamp = view.cfg;
    logVoice(`joined voice in room ${view.room}, seat ${seat}, listening`);
    void multiplayerVoiceJoin(true).catch((e) => logError("voice: joining", e));
    void readConfig(view.room);
}

async function readConfig(roomId: string) {
    try {
        const answer = await multiplayerVoiceConfig();
        if (!room || room.id !== roomId || !answer.ok) {
            return;
        }
        const before = configFor === roomId ? config : null;
        config = {
            servers: Array.isArray(answer.servers) ? answer.servers : [],
            policy: answer.policy === "relay" ? "relay" : "all",
            available: answer.available !== false
        };
        configFor = roomId;
        if (before && JSON.stringify(before) !== JSON.stringify(config)) {
            reconfigure();
        }
        logVoiceDebug(`ice config: ${config.servers.length} server(s), policy ${config.policy}`
            + (config.available ? "" : ", unavailable"));
        const view = multiplayerRoomMarker().voice;
        if (view) {
            reconcile(view);
        }
        applyMic();
        publish();
    }
    catch (e) {
        logError("voice: reading the ICE config", e);
    }
}

function leave() {
    if (!room) {
        return;
    }
    logVoice(`left voice in room ${room.id}`);
    for (const index of [...peers.keys()]) {
        closePeer(index);
    }
    wantMic = false;
    mutedForSteam = false;
    steamAllowed = false;
    pttDown = 0;
    pttLatched = false;
    closeMic();
    if (outputSink) {
        outputSink = "";
        routeOutput();
    }
    releaseCanceller();
    room = null;
    config = null;
    configFor = "";
    configStamp = "";
    void multiplayerVoiceJoin(false).catch((e) => logError("voice: leaving", e));
    closeContextIfIdle();
}

function reconcile(view: RoomVoice) {
    if (!room) {
        return;
    }
    for (const [index, peer] of peers) {
        const seat = view.seats[index];
        if (!seat || !seat.vc || seat.vs !== peer.stamp) {
            closePeer(index);
        }
    }
    const mine = view.seats[room.seat];
    if (!mine?.vc || !config || configFor !== room.id || !config.available) {
        return;
    }
    view.seats.forEach((seat, index) => {
        if (room && seat?.vc && index > room.seat && !peers.has(index)) {
            void startOffer(index, seat.vs, 0);
        }
    });
}

function reconfigure() {
    const policy = config?.policy ?? "all";
    for (const peer of [...peers.values()]) {
        const moved = Boolean(peer.pc) && peer.pc?.getConfiguration().iceTransportPolicy !== policy;
        if (peer.state === "failed" || moved) {
            if (peer.offerer || (room && room.seat < peer.index)) {
                if (moved) {
                    logVoiceDebug(`seat ${peer.index}: starting over for ICE policy ${policy}`);
                }
                closePeer(peer.index);
                void startOffer(peer.index, peer.stamp, 0);
                continue;
            }
            if (peer.state === "failed") {
                continue;
            }
        }
        try {
            peer.pc?.setConfiguration({ iceServers: config?.servers ?? [], iceTransportPolicy: policy });
        }
        catch (e) {
            logError("voice: taking new ICE servers", e);
        }
        if (peer.offerer && peer.state === "connected") {
            clearPeerTimer(peer);
            peer.timer = window.setTimeout(() => {
                peer.timer = null;
                if (peers.get(peer.index) === peer && peer.pc) {
                    peer.gen = nextGen();
                    logVoiceDebug(`seat ${peer.index}: restarting ICE with new servers`);
                    void sendOffer(peer, true);
                }
            }, RENEW_RESTART_MS);
        }
    }
}

function nextGen(): number {
    lastGen = Math.max(lastGen + 1, Math.floor(Date.now() / 1000) % 2 ** 31);
    return lastGen;
}

function context(): AudioContext {
    if (!ctx || ctx.state === "closed") {
        ctx = new AudioContext();
        const destination = ctx.createMediaStreamDestination();
        const element = new Audio();
        element.srcObject = destination.stream;
        output = { destination, element };
        void element.play().catch((e) => logError("voice: playing the voices", e));
        routeOutput();
    }
    return ctx;
}

function routeOutput() {
    const element = output?.element;
    if (!element || (element as HTMLAudioElement & { sinkId?: string }).sinkId === outputSink) {
        return;
    }
    void element.setSinkId(outputSink).catch((e) => logError("voice: choosing where the voices play", e));
}

function closeOutput() {
    if (output) {
        output.element.pause();
        output.element.srcObject = null;
        output = null;
    }
}

function closeContextIfIdle() {
    if (performance.now() < blipUntil) {
        return;
    }
    if (ctx && peers.size === 0 && !mic) {
        closeOutput();
        void ctx.close().catch(() => { });
        ctx = null;
    }
}

const LIMIT_RATIO = 20;

function makeLimiter(audioContext: AudioContext, ceiling = -3): DynamicsCompressorNode {
    const limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = ceiling;
    limiter.knee.value = 0;
    limiter.ratio.value = LIMIT_RATIO;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    return limiter;
}

function makeupTrim(audioContext: AudioContext, ceiling: number): GainNode {
    const trim = audioContext.createGain();
    trim.gain.value = 10 ** ((0.6 * ceiling * (1 - 1 / LIMIT_RATIO)) / 20);
    return trim;
}

function makePeer(index: number, stamp: number, offerer: boolean, retries: number): Peer {
    const pc = new RTCPeerConnection({ iceServers: config?.servers ?? [], iceTransportPolicy: config?.policy ?? "all" });
    const peer: Peer = {
        index, stamp, pc, sender: null, offerer, gen: 0, remoteGen: 0, remoteSession: "", state: "connecting",
        retries, timer: null, audio: null, source: null, gain: null, limiter: null, analyser: null, speaking: false, loudAt: 0
    };
    pc.ontrack = (event) => {
        if (peers.get(index) === peer) {
            play(peer, event.streams[0] ?? new MediaStream([event.track]));
        }
    };
    pc.onconnectionstatechange = () => {
        if (peers.get(index) !== peer || peer.pc !== pc) {
            return;
        }
        logVoiceDebug(`seat ${index}: ${pc.connectionState}`);
        if (pc.connectionState === "connected") {
            peer.state = "connected";
            peer.retries = 0;
            clearPeerTimer(peer);
            void logPair(peer);
            publish();
        }
        else if (pc.connectionState === "failed") {
            failed(peer);
        }
    };
    peers.set(index, peer);
    watchSpeaking();
    return peer;
}

function clearPeerTimer(peer: Peer) {
    if (peer.timer !== null) {
        window.clearTimeout(peer.timer);
        peer.timer = null;
    }
}

function closePeer(index: number) {
    const peer = peers.get(index);
    if (!peer) {
        return;
    }
    peers.delete(index);
    clearPeerTimer(peer);
    stopPlaying(peer);
    peer.pc?.close();
    peer.pc = null;
    watchSpeaking();
    closeContextIfIdle();
}

function stopPlaying(peer: Peer) {
    peer.source?.disconnect();
    peer.gain?.disconnect();
    peer.limiter?.disconnect();
    peer.source = null;
    peer.gain = null;
    peer.limiter = null;
    peer.analyser = null;
    if (peer.audio) {
        peer.audio.pause();
        peer.audio.srcObject = null;
        peer.audio = null;
    }
}

function play(peer: Peer, stream: MediaStream) {
    stopPlaying(peer);
    const audio = new Audio();
    audio.srcObject = stream;
    audio.muted = true;
    peer.audio = audio;
    void audio.play().catch((e) => logError("voice: playing a remote stream", e));
    const audioContext = context();
    const source = audioContext.createMediaStreamSource(stream);
    const gain = audioContext.createGain();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const limiter = makeLimiter(audioContext);
    source.connect(gain);
    limiter.connect(output?.destination ?? audioContext.destination);
    peer.limiter = limiter;
    routeGain(gain, limiter, audioContext);
    peer.source = source;
    peer.gain = gain;
    peer.analyser = analyser;
    applyPeerVolume(peer);
}

function routeGain(gain: GainNode, limiter: DynamicsCompressorNode, audioContext: AudioContext) {
    gain.disconnect();
    gain.connect(limiting ? limiter : output?.destination ?? audioContext.destination);
}

function applyPeerVolume(peer: Peer) {
    if (!peer.gain) {
        return;
    }
    const pref = prefs.get((names[peer.index] ?? "").toLowerCase());
    peer.gain.gain.value = pref?.muted ? 0 : volume / 100;
}

function munge(sdp: string): string {
    const opus = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp);
    if (!opus) {
        return sdp;
    }
    const fmtp = new RegExp(`a=fmtp:${opus[1]} ([^\\r\\n]*)`);
    const found = fmtp.exec(sdp);
    if (!found) {
        return sdp.replace(opus[0], `${opus[0]}\r\na=fmtp:${opus[1]} ${Object.entries(OPUS_PARAMS).map(([k, v]) => `${k}=${v}`).join(";")}`);
    }
    const params = new Map(found[1].split(";").filter(Boolean).map((part) => {
        const [key, ...rest] = part.split("=");
        return [key.trim(), rest.join("=")] as [string, string];
    }));
    for (const [key, value] of Object.entries(OPUS_PARAMS)) {
        params.set(key, value);
    }
    return sdp.replace(found[0], `a=fmtp:${opus[1]} ${[...params].map(([k, v]) => `${k}=${v}`).join(";")}`);
}

function sdpSession(sdp: string): string {
    return /^o=\S+ (\S+) /m.exec(sdp)?.[1] ?? "";
}

function gathered(pc: RTCPeerConnection, again: boolean): Promise<void> {
    if (!again && pc.iceGatheringState === "complete") {
        return Promise.resolve();
    }
    let started = !again || pc.iceGatheringState === "gathering";
    return new Promise((resolve) => {
        const done = () => {
            window.clearTimeout(timer);
            pc.removeEventListener("icegatheringstatechange", check);
            resolve();
        };
        const check = () => {
            if (pc.iceGatheringState !== "complete") {
                started = true;
            }
            else if (started) {
                done();
            }
        };
        const timer = window.setTimeout(done, GATHER_MS);
        pc.addEventListener("icegatheringstatechange", check);
    });
}

async function startOffer(index: number, stamp: number, retries: number) {
    const peer = makePeer(index, stamp, true, retries);
    const pc = peer.pc as RTCPeerConnection;
    const transceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
    peer.sender = transceiver.sender;
    if (mic) {
        void peer.sender.replaceTrack(mic.track).catch((e) => logError("voice: sending the mic", e));
    }
    peer.gen = nextGen();
    await sendOffer(peer, false);
}

async function sendOffer(peer: Peer, restart: boolean) {
    const pc = peer.pc;
    if (!pc) {
        return;
    }
    const gen = peer.gen;
    try {
        const offer = await pc.createOffer(restart ? { iceRestart: true } : undefined);
        const again = pc.iceGatheringState === "complete";
        await pc.setLocalDescription({ type: "offer", sdp: munge(offer.sdp ?? "") });
        await gathered(pc, again);
        if (peers.get(peer.index) !== peer || peer.gen !== gen || peer.pc !== pc) {
            return;
        }
        const sdp = pc.localDescription?.sdp ?? "";
        logVoiceDebug(`offer to seat ${peer.index}, gen ${gen}, ${candidateKinds(sdp)}`);
        const sent = await multiplayerVoiceSend(peer.index, "offer", sdp, gen);
        if (peers.get(peer.index) !== peer) {
            return;
        }
        if (!sent.ok) {
            logVoiceDebug(`offer to seat ${peer.index} refused (${sent.error ?? "?"})`);
            failed(peer);
            return;
        }
        clearPeerTimer(peer);
        peer.timer = window.setTimeout(() => {
            peer.timer = null;
            if (peers.get(peer.index) === peer && peer.state !== "connected") {
                logVoiceDebug(`no answer from seat ${peer.index}`);
                failed(peer);
            }
        }, ANSWER_WAIT_MS);
    }
    catch (e) {
        logError("voice: making an offer", e);
        failed(peer);
    }
}

function candidateKinds(sdp: string): string {
    const kinds = new Set<string>();
    for (const match of sdp.matchAll(/a=candidate:\S+ \d+ \S+ \d+ \S+ \d+ typ (\w+)/g)) {
        kinds.add(match[1]);
    }
    return kinds.size ? `candidates ${[...kinds].join("/")}` : "no candidates";
}

async function takeOffer(from: number, stamp: number, sdp: string, gen: number) {
    if (!room || !config || configFor !== room.id || from === room.seat) {
        return;
    }
    let peer = peers.get(from);
    if (peer && peer.stamp !== stamp) {
        closePeer(from);
        peer = undefined;
    }
    const session = sdpSession(sdp);
    const renegotiating = Boolean(peer?.pc) && peer?.remoteSession === session && gen > (peer?.remoteGen ?? 0)
        && peer?.pc?.signalingState === "stable";
    if (!renegotiating) {
        if (peer?.offerer && peer.pc?.signalingState === "have-local-offer" && room.seat < from) {
            return;
        }
        if (peer && gen <= peer.remoteGen && peer.remoteSession === session) {
            return;
        }
        closePeer(from);
        peer = makePeer(from, stamp, false, 0);
    }
    const current = peer as Peer;
    const pc = current.pc as RTCPeerConnection;
    current.remoteGen = gen;
    current.remoteSession = session;
    try {
        await pc.setRemoteDescription({ type: "offer", sdp });
        const transceiver = pc.getTransceivers()[0];
        if (transceiver) {
            transceiver.direction = "sendrecv";
            current.sender = transceiver.sender;
            if (mic) {
                await transceiver.sender.replaceTrack(mic.track);
            }
        }
        const answer = await pc.createAnswer();
        const again = pc.iceGatheringState === "complete";
        await pc.setLocalDescription({ type: "answer", sdp: munge(answer.sdp ?? "") });
        await gathered(pc, again);
        if (peers.get(from) !== current || current.pc !== pc) {
            return;
        }
        const local = pc.localDescription?.sdp ?? "";
        logVoiceDebug(`answer to seat ${from}, gen ${gen}, ${candidateKinds(local)}`);
        const sent = await multiplayerVoiceSend(from, "answer", local, gen);
        if (!sent.ok) {
            logVoiceDebug(`answer to seat ${from} refused (${sent.error ?? "?"})`);
        }
    }
    catch (e) {
        logError("voice: answering an offer", e);
    }
}

async function takeAnswer(from: number, stamp: number, sdp: string, gen: number) {
    const peer = peers.get(from);
    const pc = peer?.pc;
    if (!peer || !pc || peer.stamp !== stamp || !peer.offerer || gen !== peer.gen || pc.signalingState !== "have-local-offer") {
        return;
    }
    try {
        await pc.setRemoteDescription({ type: "answer", sdp });
    }
    catch (e) {
        logError("voice: taking an answer", e);
        failed(peer);
    }
}

function failed(peer: Peer) {
    if (peers.get(peer.index) !== peer) {
        return;
    }
    clearPeerTimer(peer);
    if (!peer.offerer) {
        peer.state = "connecting";
        publish();
        return;
    }
    if (peer.retries >= RETRY_MS.length) {
        giveUp(peer);
        return;
    }
    const delay = RETRY_MS[peer.retries];
    const retries = peer.retries + 1;
    peer.state = "connecting";
    peer.timer = window.setTimeout(() => {
        if (peers.get(peer.index) === peer) {
            closePeer(peer.index);
            void startOffer(peer.index, peer.stamp, retries);
        }
    }, delay);
    publish();
}

function giveUp(peer: Peer) {
    logVoice(`voice couldn't connect to seat ${peer.index}`);
    stopPlaying(peer);
    peer.pc?.close();
    peer.pc = null;
    peer.state = "failed";
    void multiplayerVoiceSend(peer.index, "bye", "", nextGen()).catch(() => { });
    publish();
}

function takeBye(from: number, stamp: number) {
    const peer = peers.get(from);
    if (!peer || peer.stamp !== stamp) {
        return;
    }
    clearPeerTimer(peer);
    stopPlaying(peer);
    peer.pc?.close();
    peer.pc = null;
    peer.state = "failed";
    publish();
}

async function logPair(peer: Peer) {
    if (!debugLoggingEnabled() || !peer.pc) {
        return;
    }
    try {
        const stats = await peer.pc.getStats();
        let pair: RTCIceCandidatePairStats | null = null;
        stats.forEach((entry) => {
            if (entry.type === "candidate-pair" && entry.nominated && entry.state === "succeeded") {
                pair = entry as RTCIceCandidatePairStats;
            }
        });
        const chosen = pair as RTCIceCandidatePairStats | null;
        if (!chosen) {
            return;
        }
        const local = stats.get(chosen.localCandidateId) as { candidateType?: string } | undefined;
        const remote = stats.get(chosen.remoteCandidateId) as { candidateType?: string } | undefined;
        logVoiceDebug(`seat ${peer.index}: pair ${local?.candidateType ?? "?"} <-> ${remote?.candidateType ?? "?"}`);
    }
    catch (e) {
        logError("voice: reading the chosen pair", e);
    }
}

async function logStats() {
    for (const peer of peers.values()) {
        if (!peer.pc || peer.state !== "connected") {
            continue;
        }
        try {
            const stats = await peer.pc.getStats();
            let rtt = 0;
            let lost = 0;
            let jitter = 0;
            stats.forEach((entry) => {
                if (entry.type === "candidate-pair" && entry.nominated) {
                    rtt = Math.round((entry.currentRoundTripTime ?? 0) * 1000);
                }
                if (entry.type === "inbound-rtp" && entry.kind === "audio") {
                    lost = entry.packetsLost ?? 0;
                    const emitted = entry.jitterBufferEmittedCount ?? 0;
                    jitter = emitted ? Math.round((entry.jitterBufferDelay / emitted) * 1000) : 0;
                }
            });
            logVoiceDebug(`seat ${peer.index}: rtt ${rtt} ms, lost ${lost}, jitter buffer ${jitter} ms`);
        }
        catch (e) {
            logError("voice: reading call stats", e);
        }
    }
}

function onVoiceEvent(payload: { from?: number; vs?: number; kind?: string; sdp?: string; gen?: number }) {
    if (!payload || typeof payload.from !== "number" || typeof payload.gen !== "number" || !room) {
        return;
    }
    const stamp = Number(payload.vs) || 0;
    const sdp = typeof payload.sdp === "string" ? payload.sdp : "";
    logVoiceDebug(`${payload.kind ?? "?"} from seat ${payload.from}, gen ${payload.gen}`);
    if (payload.kind === "offer") {
        void takeOffer(payload.from, stamp, sdp, payload.gen);
    }
    else if (payload.kind === "answer") {
        void takeAnswer(payload.from, stamp, sdp, payload.gen);
    }
    else if (payload.kind === "bye") {
        takeBye(payload.from, stamp);
    }
}

function micShouldBeOpen(): boolean {
    return wantMic && room !== null && (!steamCall || steamAllowed) && (config?.available ?? false);
}

function applyMic() {
    if (micShouldBeOpen()) {
        if (!mic && !micOpening) {
            void openMic().then((error) => {
                if (error) {
                    toast("Couldn't open the microphone.");
                }
            });
        }
    }
    else if (mic) {
        closeMic();
    }
}

function askCanceller(on: boolean): Promise<{ ok: boolean; active?: boolean; duck?: boolean; kind?: string }> {
    const asked = cancellerQueue.then(() => multiplayerVoiceCanceller(on));
    cancellerQueue = asked.catch(() => { });
    return asked;
}

function releaseCanceller() {
    held = null;
    void askCanceller(false).catch(() => { });
}

async function useCanceller(): Promise<CancellerAnswer> {
    if (!echoCancellation || !cancelling) {
        return { canceller: null, echoPath: true };
    }
    let answer: { ok: boolean; active?: boolean; duck?: boolean; kind?: string };
    try {
        answer = await askCanceller(true);
    }
    catch (e) {
        logError("voice: asking for the echo canceller", e);
        return { canceller: null, echoPath: true };
    }
    const echoPath = answer?.kind !== "headset";
    if (!answer?.ok || !answer.active) {
        return { canceller: null, echoPath };
    }
    try {
        for (let look = 0; look < CANCELLER_LOOKS; look += 1) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const sources = devices.filter((device) => device.kind === "audioinput" && device.label === CANCELLER_SOURCE);
            const sinks = devices.filter((device) => device.kind === "audiooutput" && device.label === CANCELLER_SINK);
            if (sources.length === 1 && sinks.length === 1) {
                return {
                    canceller: { source: sources[0].deviceId, sink: sinks[0].deviceId, duck: answer.duck === true },
                    echoPath
                };
            }
            if (sources.length > 1 || sinks.length > 1) {
                break;
            }
            await new Promise((resolve) => window.setTimeout(resolve, CANCELLER_LOOK_MS));
        }
        logVoice("the echo canceller's devices didn't show up, Chromium cancels instead");
    }
    catch (e) {
        logError("voice: finding the echo canceller's devices", e);
    }
    releaseCanceller();
    return { canceller: null, echoPath };
}

async function openMic(): Promise<string> {
    micOpening = true;
    const epoch = cancellerEpoch;
    const openingFor = room?.id;
    let canceller: Canceller | null = null;
    try {
        const found = held ?? await useCanceller();
        if (epoch === cancellerEpoch && room?.id === openingFor && (found.canceller || !found.echoPath)) {
            held = found;
        }
        canceller = found.canceller;
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: canceller
                ? { deviceId: { exact: canceller.source }, echoCancellation: false, noiseSuppression: false,
                    autoGainControl: false, channelCount: 1 }
                : { echoCancellation, noiseSuppression: true, autoGainControl: false, channelCount: 1 }
        });
        if (!micShouldBeOpen() || mic) {
            for (const track of stream.getTracks()) {
                track.stop();
            }
            return "";
        }
        const audioContext = context();
        const source = audioContext.createMediaStreamSource(stream);
        const boost = audioContext.createGain();
        boost.gain.value = MIC_BOOST;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const delay = audioContext.createDelay(1);
        delay.delayTime.value = ONSET_DELAY_S;
        const gain = audioContext.createGain();
        gain.gain.value = 0;
        const limiter = makeLimiter(audioContext, SEND_CEILING_DB);
        const trim = makeupTrim(audioContext, SEND_CEILING_DB);
        const destination = audioContext.createMediaStreamDestination();
        source.connect(boost);
        boost.connect(analyser);
        boost.connect(delay).connect(gain).connect(limiter).connect(trim).connect(destination);
        const track = destination.stream.getAudioTracks()[0];
        const opened: Mic = { stream, source, boost, analyser, delay, gain, limiter, trim, track, timer: 0, open: false,
            loudRun: 0, loudAt: 0, farAt: 0, speakAt: 0, speaking: false, duck: canceller?.duck ?? false,
            echoPath: found.echoPath };
        opened.timer = window.setInterval(() => gateTick(opened), GATE_TICK_MS);
        stream.getAudioTracks()[0]?.addEventListener("ended", () => {
            if (mic === opened) {
                logVoice("the mic's device went away, opening it again");
                held = null;
                closeMic();
                applyMic();
            }
        });
        mic = opened;
        outputSink = canceller?.sink ?? "";
        routeOutput();
        for (const peer of peers.values()) {
            if (peer.sender) {
                void peer.sender.replaceTrack(track).catch((e) => logError("voice: sending the mic", e));
            }
        }
        logVoice(`mic open, ${canceller ? `echo canceller${canceller.duck && ducking ? " with the game ducked" : ""}`
            : echoCancellation ? "Chromium's echo cancellation" : "echo cancellation off"}`);
        publish();
        if (epoch !== cancellerEpoch) {
            logVoice("the sound output changed while the mic opened, opening it again");
            held = null;
            closeMic();
            applyMic();
        }
        return "";
    }
    catch (e) {
        logError("voice: opening the mic", e);
        if (canceller) {
            if (outputSink) {
                outputSink = "";
                routeOutput();
            }
            releaseCanceller();
        }
        wantMic = false;
        publish();
        return e instanceof Error ? e.name : String(e);
    }
    finally {
        micOpening = false;
    }
}

function closeMic() {
    if (!mic) {
        return;
    }
    const closing = mic;
    mic = null;
    window.clearInterval(closing.timer);
    if (closing.open && closing.duck && ducking) {
        duckGame(false);
    }
    for (const peer of peers.values()) {
        if (peer.sender) {
            void peer.sender.replaceTrack(null).catch(() => { });
        }
    }
    closing.source.disconnect();
    closing.boost.disconnect();
    closing.delay.disconnect();
    closing.gain.disconnect();
    closing.limiter.disconnect();
    closing.trim.disconnect();
    for (const track of closing.stream.getTracks()) {
        track.stop();
    }
    closing.track.stop();
    logVoice("mic closed");
    closeContextIfIdle();
    publish();
}

function level(analyser: AnalyserNode, buffer: Float32Array): number {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (const sample of buffer) {
        sum += sample * sample;
    }
    const rms = Math.sqrt(sum / buffer.length);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

function duckGame(on: boolean) {
    void multiplayerVoiceDuck(on, DUCK_DB[duckStrength] ?? DUCK_DB[2]).catch(() => { });
}

const gateBuffer = new Float32Array(512);

function gateTick(current: Mic) {
    if (mic !== current || !ctx) {
        return;
    }
    const db = level(current.analyser, gateBuffer);
    const now = performance.now();
    let open: boolean;
    if (pttWorking()) {
        open = pttTalking();
    }
    else {
        if (farLevel() > FAR_DB) {
            current.farAt = now;
        }
        const far = current.echoPath && current.farAt > 0 && now - current.farAt < FAR_TAIL_MS;
        if (db > (SENSITIVITY_DB[sensitivity] ?? SENSITIVITY_DB[2]) + (far ? FAR_MARGIN_DB : 0)) {
            current.loudRun += 1;
            if (current.open || current.loudRun >= GATE_OPEN_WINDOWS) {
                current.loudAt = now;
            }
        }
        else {
            current.loudRun = 0;
        }
        open = current.loudAt > 0 && now - current.loudAt < GATE_HOLD_MS;
    }
    if (open !== current.open) {
        current.open = open;
        if (current.duck && ducking) {
            duckGame(open);
        }
        const param = current.gain.gain;
        const at = ctx.currentTime;
        param.cancelScheduledValues(at);
        param.setValueAtTime(param.value, at);
        param.linearRampToValueAtTime(open ? 1 : 0, at + (open ? GATE_OPEN_MS : GATE_CLOSE_MS) / 1000);
    }
    if (open && db > SPEAKING_DB) {
        current.speakAt = now;
    }
    const speaking = open && now - current.speakAt < SPEAKING_HOLD_MS;
    if (speaking !== current.speaking) {
        current.speaking = speaking;
        if (listeners.size > 0) {
            publish();
        }
    }
}

const speakBuffer = new Float32Array(512);
const farBuffer = new Float32Array(512);

function farLevel(): number {
    if (volume === 0) {
        return -Infinity;
    }
    let loudest = -Infinity;
    for (const peer of peers.values()) {
        if (peer.analyser && !prefs.get((names[peer.index] ?? "").toLowerCase())?.muted) {
            loudest = Math.max(loudest, level(peer.analyser, farBuffer));
        }
    }
    return loudest;
}

function watchSpeaking() {
    const wanted = listeners.size > 0 && peers.size > 0;
    if (wanted && speakingTimer === null) {
        speakingTimer = window.setInterval(speakingTick, SPEAKING_TICK_MS);
    }
    else if (!wanted && speakingTimer !== null) {
        window.clearInterval(speakingTimer);
        speakingTimer = null;
    }
}

function speakingTick() {
    if (listeners.size === 0 || peers.size === 0) {
        watchSpeaking();
        return;
    }
    const now = performance.now();
    let changed = false;
    for (const peer of peers.values()) {
        if (!peer.analyser) {
            continue;
        }
        if (level(peer.analyser, speakBuffer) > SPEAKING_DB) {
            peer.loudAt = now;
        }
        const speaking = now - peer.loudAt < SPEAKING_HOLD_MS;
        if (speaking !== peer.speaking) {
            peer.speaking = speaking;
            changed = true;
        }
    }
    if (changed) {
        publish();
    }
}

export async function pressVoiceMute() {
    if (!room || config?.available === false || pttWorking()) {
        return;
    }
    if (wantMic) {
        blip(false);
        await toggleMic();
        return;
    }
    if (steamCall) {
        toast("Mic muted while you're in a Steam call");
        return;
    }
    blip(true);
    const result = await toggleMic();
    if (!result.ok) {
        toast(result.reason === "steam" ? "Mic muted while you're in a Steam call" : "Couldn't open the microphone.");
    }
}

const BLIP_GAIN = 0.12;
const BLIP_HOLD_MS = 300;
let blipUntil = 0;
const BLIP_NOTE_S = 0.07;
const BLIP_GAP_S = 0.09;

function blip(on: boolean) {
    const audio = ctx;
    const sink = output?.destination;
    if (!audio || !sink) {
        return;
    }
    blipUntil = performance.now() + BLIP_HOLD_MS;
    window.setTimeout(closeContextIfIdle, BLIP_HOLD_MS + 50);
    const start = audio.currentTime + 0.01;
    (on ? [660, 990] : [990, 660]).forEach((frequency, index) => {
        const at = start + index * BLIP_GAP_S;
        const tone = audio.createOscillator();
        tone.frequency.value = frequency;
        const envelope = audio.createGain();
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(BLIP_GAIN, at + 0.008);
        envelope.gain.linearRampToValueAtTime(0, at + BLIP_NOTE_S);
        tone.connect(envelope).connect(sink);
        tone.start(at);
        tone.stop(at + BLIP_NOTE_S + 0.01);
    });
}

export async function toggleMic(force = false): Promise<MicPress> {
    if (!room || config?.available === false || pttWorking()) {
        return { ok: true };
    }
    if (wantMic) {
        wantMic = false;
        mutedForSteam = false;
        steamAllowed = false;
        applyMic();
        publish();
        return { ok: true };
    }
    if (steamCall && !force) {
        return { ok: false, reason: "steam" };
    }
    steamAllowed = steamCall;
    wantMic = true;
    publish();
    if (!micShouldBeOpen() || mic || micOpening) {
        return { ok: true };
    }
    const error = await openMic();
    return error ? { ok: false, reason: "mic", error } : { ok: true };
}

export function setPeerMuted(index: number, muted: boolean) {
    const name = (names[index] ?? "").toLowerCase();
    if (!name) {
        return;
    }
    prefs.set(name, { muted });
    const peer = peers.get(index);
    if (peer) {
        applyPeerVolume(peer);
    }
    publish();
}

export function retryPeer(index: number) {
    const peer = peers.get(index);
    const seat = multiplayerRoomMarker().voice?.seats[index];
    if (!room || !seat?.vc || (peer && peer.state !== "failed")) {
        return;
    }
    closePeer(index);
    void startOffer(index, seat.vs, 0);
    publish();
}

export function holdPushToTalk(down: boolean) {
    if (down && room && pttWorking() && mutedForSteam) {
        return;
    }
    if (down && room && pttWorking() && !wantMic) {
        wantMic = true;
        applyMic();
    }
    if (pttToggle) {
        if (down && room && pttWorking()) {
            pttLatched = !pttLatched;
            blip(pttLatched);
            publish();
        }
        return;
    }
    pttDown = Math.max(0, pttDown + (down ? 1 : -1));
    publish();
}

function setSteamCall(active: boolean) {
    if (active === steamCall) {
        return;
    }
    steamCall = active;
    if (!room) {
        return;
    }
    if (active) {
        pttLatched = false;
    }
    if (active && wantMic && !steamAllowed) {
        mutedForSteam = true;
        logVoice("a Steam call started, mic muted");
        toast("Mic muted while you're in a Steam call");
    }
    else if (!active) {
        steamAllowed = false;
        if (mutedForSteam) {
            mutedForSteam = false;
            logVoice("the Steam call ended, mic back on");
            if (wantMic) {
                toast("Mic back on");
            }
        }
    }
    applyMic();
    publish();
}

function watchSteamCalls(): (() => void) | null {
    const friends = SteamClient?.Friends;
    if (typeof friends?.RegisterForVoiceChatStatus !== "function") {
        logVoice("Steam's voice chat status isn't available, so a Steam call won't mute the mic");
        return null;
    }
    try {
        const handle = friends.RegisterForVoiceChatStatus((status: { bVoiceChatActive?: boolean } | null) => {
            setSteamCall(status?.bVoiceChatActive === true);
        });
        return () => handle?.unregister?.();
    }
    catch (e) {
        logError("voice: watching Steam calls", e);
        return null;
    }
}

function onCancellerEvent(payload: { reason?: string }) {
    cancellerEpoch += 1;
    if (outputSink) {
        outputSink = "";
        routeOutput();
    }
    if (mic) {
        held = null;
    }
    else {
        releaseCanceller();
    }
    if (payload?.reason === "output" && mic) {
        logVoice("the sound output changed, opening the mic again");
        closeMic();
        applyMic();
    }
}

function onDebugEvent(payload: { name?: string; on?: boolean }) {
    if (payload?.name === "aec" || payload?.name === "canceller") {
        if (payload.name === "aec") {
            echoCancellation = payload.on !== false;
        }
        else {
            cancelling = payload.on !== false;
        }
        logVoice(`debug: ${payload.name === "aec" ? "echo cancellation" : "PipeWire's echo canceller"} `
            + (payload.on !== false ? "on" : "off"));
        if (mic) {
            closeMic();
            if (outputSink) {
                outputSink = "";
                routeOutput();
            }
            releaseCanceller();
            applyMic();
        }
    }
    else if (payload?.name === "limiter") {
        limiting = payload.on !== false;
        logVoice(`debug: limiter ${limiting ? "on" : "off"}`);
        for (const peer of peers.values()) {
            if (peer.gain && peer.limiter && ctx) {
                routeGain(peer.gain, peer.limiter, ctx);
            }
        }
    }
    else if (payload?.name === "steam") {
        setSteamCall(payload.on === true);
    }
}

export function registerVoiceChat() {
    addEventListener(VOICE_EVENT, onVoiceEvent);
    addEventListener(DEBUG_EVENT, onDebugEvent);
    addEventListener(CANCELLER_EVENT, onCancellerEvent);
    stopRoomWatch = subscribeMultiplayerRoom(sync);
    stopSteamWatch = watchSteamCalls();
    stopMicWatch = watchMicLevel();
    statsTimer = window.setInterval(() => {
        if (debugLoggingEnabled() && peers.size > 0) {
            void logStats();
        }
    }, STATS_MS);
    sync();
}

export function unregisterVoiceChat() {
    removeEventListener(VOICE_EVENT, onVoiceEvent);
    removeEventListener(DEBUG_EVENT, onDebugEvent);
    removeEventListener(CANCELLER_EVENT, onCancellerEvent);
    stopSteamWatch?.();
    stopMicWatch?.();
    stopMicWatch = null;
    stopSteamWatch = null;
    if (statsTimer !== null) {
        window.clearInterval(statsTimer);
        statsTimer = null;
    }
    if (speakingTimer !== null) {
        window.clearInterval(speakingTimer);
        speakingTimer = null;
    }
    leave();
    stopRoomWatch?.();
    stopRoomWatch = null;
    closeOutput();
    if (ctx) {
        void ctx.close().catch(() => { });
        ctx = null;
    }
    snapshot = OFF;
    snapshotText = JSON.stringify(OFF);
}
