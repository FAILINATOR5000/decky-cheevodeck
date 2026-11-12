export const START_SOUND_MS = 2100;

const CLOSE_AFTER_MS = 10000;
const WET_GAIN = 0.3;

const E5 = 659.25;
const A5 = 880;
const D6 = 1174.66;
const E6 = 1318.51;
const G_SHARP6 = 1661.22;
const B6 = 1975.53;
const E7 = 2637.02;

type Voice = { frequency: number; at: number; peak: number; decay: number; sweep: number };

let context: AudioContext | null = null;
let closeTimer = 0;
const reverbs = new Map<number, AudioBuffer>();

function uiSoundsOn(): boolean {
    const store = (window as unknown as { settingsStore?: { clientSettings?: { enable_ui_sounds?: boolean } } }).settingsStore;
    return store?.clientSettings?.enable_ui_sounds ?? true;
}

function reverb(ctx: AudioContext, seconds: number): AudioBuffer {
    const made = reverbs.get(seconds);
    if (made && made.sampleRate === ctx.sampleRate) {
        return made;
    }
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
        }
    }
    reverbs.set(seconds, buffer);
    return buffer;
}

function closeLater(lastsMs: number) {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
        const closing = context;
        context = null;
        void closing?.close().catch(() => undefined);
    }, lastsMs + CLOSE_AFTER_MS);
}

async function play(voices: Voice[], reverbSeconds: number, lastsMs: number) {
    if (!uiSoundsOn()) {
        return;
    }
    try {
        context ??= new AudioContext();
        const ctx = context;
        closeLater(lastsMs);
        if (ctx.state !== "running") {
            await ctx.resume();
        }
        const out = ctx.createGain();
        out.connect(ctx.destination);
        const verb = ctx.createConvolver();
        verb.buffer = reverb(ctx, reverbSeconds);
        const wet = ctx.createGain();
        wet.gain.value = WET_GAIN;
        verb.connect(wet).connect(out);
        const start = ctx.currentTime + 0.05;
        for (const voice of voices) {
            bell(ctx, out, verb, { ...voice, at: start + voice.at });
        }
        window.setTimeout(() => out.disconnect(), lastsMs + 500);
    }
    catch {
    }
}

function bell(ctx: AudioContext, out: AudioNode, verb: AudioNode, voice: Voice) {
    const { frequency, at, peak, decay, sweep } = voice;
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const depth = ctx.createGain();
    const amp = ctx.createGain();
    carrier.frequency.value = frequency;
    modulator.frequency.value = frequency * 3.5;
    depth.gain.setValueAtTime(frequency * 0.9, at);
    depth.gain.exponentialRampToValueAtTime(1, at + sweep);
    modulator.connect(depth).connect(carrier.frequency);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(peak, at + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    carrier.connect(amp);
    amp.connect(out);
    amp.connect(verb);
    carrier.start(at);
    modulator.start(at);
    carrier.stop(at + decay + 0.1);
    modulator.stop(at + decay + 0.1);
}

export function playReady() {
    void play([
        { frequency: E6, at: 0, peak: 0.3, decay: 1.1, sweep: 0.9 },
        { frequency: B6, at: 0.14, peak: 0.26, decay: 1.1, sweep: 0.9 }
    ], 1.4, 1800);
}

export function playUnready() {
    void play([
        { frequency: B6, at: 0, peak: 0.28, decay: 1.1, sweep: 0.88 },
        { frequency: E6, at: 0.14, peak: 0.26, decay: 1.1, sweep: 0.88 }
    ], 1.6, 1800);
}

export function playTick() {
    void play([{ frequency: B6, at: 0, peak: 0.12, decay: 0.4, sweep: 0.32 }], 1.4, 900);
}

export function playMark() {
    void play([{ frequency: A5, at: 0, peak: 0.24, decay: 0.2, sweep: 0.1 }], 0.6, 500);
}

export function playDrop() {
    void play([
        { frequency: D6, at: 0, peak: 0.16, decay: 0.14, sweep: 0.08 },
        { frequency: A5, at: 0.06, peak: 0.18, decay: 0.16, sweep: 0.08 },
        { frequency: E5, at: 0.13, peak: 0.22, decay: 0.12, sweep: 0.05 }
    ], 0.6, 600);
}

export function playMarkOther() {
    void play([{ frequency: E5, at: 0, peak: 0.24, decay: 0.2, sweep: 0.1 }], 0.6, 500);
}

export function playDropOther() {
    void play([
        { frequency: E5, at: 0, peak: 0.2, decay: 0.12, sweep: 0.05 },
        { frequency: A5, at: 0.06, peak: 0.18, decay: 0.16, sweep: 0.08 },
        { frequency: D6, at: 0.13, peak: 0.16, decay: 0.14, sweep: 0.08 }
    ], 0.6, 600);
}

export function playStart() {
    void play([
        { frequency: E6, at: 0, peak: 0.24, decay: 0.9, sweep: 0.72 },
        { frequency: G_SHARP6, at: 0.11, peak: 0.24, decay: 0.9, sweep: 0.72 },
        { frequency: B6, at: 0.22, peak: 0.24, decay: 0.9, sweep: 0.72 },
        { frequency: E7, at: 0.33, peak: 0.28, decay: 1.8, sweep: 1.44 }
    ], 1.6, START_SOUND_MS + 400);
}
