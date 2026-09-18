import { logError } from "../../utils/errors";

const CLIP_BASE = "https://steamloopback.host/gamerecordings/clips";

const AHEAD_SECONDS = 30;
const BEHIND_SECONDS = 10;

const SEEK_STEPS_PER_CLIP = 10;
const MIN_SEEK_STEP_SECONDS = 0.5;
const MAX_SEEK_STEP_SECONDS = 30;

const SCAN_SECONDS_PER_CLIP = 5;
const MIN_SCAN_RATE = 1;
const MAX_SCAN_RATE = 30;
const SCAN_TICK_MS = 100;

const SCAN_WATCHDOG_MS = 15000;

const SCAN_HOLD_DELAY_MS = 350;


export type ClipSource = {
    clipId: string;
    sessionId: string;
    startMs: number;
    durationMs: number;
};

export type ClipPlaybackState = {
    position: number;
    duration: number;
    paused: boolean;
    ended: boolean;
    unavailable: boolean;
    scanning: boolean;
    ready: boolean;
};

export type ClipPlayback = {
    destroy: () => void;
    togglePause: () => void;
    beginSeek: (direction: 1 | -1) => void;
    endSeek: () => void;
    subscribe: (listener: (state: ClipPlaybackState) => void) => () => void;
};

type StreamPlan = {
    id: string;
    type: string;
};

type ManifestPlan = {
    streams: StreamPlan[];
    segmentSeconds: number;
    startNumber: number;
    initTemplate: string;
    mediaTemplate: string;
};

const REPRESENTATION_PATTERN = /<Representation\b([^>]*)>/g;
const SEGMENT_TEMPLATE_PATTERN = /<SegmentTemplate\b([^>]*)>/;

function attribute(source: string, name: string): string {
    const match = new RegExp(`\\b${name}="([^"]*)"`).exec(source);
    return match ? match[1] : "";
}

function parseManifest(text: string): ManifestPlan | null {
    const template = SEGMENT_TEMPLATE_PATTERN.exec(text);
    if (!template) {
        return null;
    }
    const timescale = Number(attribute(template[1], "timescale")) || 1;
    const duration = Number(attribute(template[1], "duration")) || 0;
    if (duration <= 0) {
        return null;
    }

    const streams: StreamPlan[] = [];
    REPRESENTATION_PATTERN.lastIndex = 0;
    let found = REPRESENTATION_PATTERN.exec(text);
    while (found) {
        const id = attribute(found[1], "id");
        const mime = attribute(found[1], "mimeType");
        const codecs = attribute(found[1], "codecs");
        if (id && mime && codecs) {
            streams.push({ id, type: `${mime}; codecs="${codecs}"` });
        }
        found = REPRESENTATION_PATTERN.exec(text);
    }
    if (streams.length === 0) {
        return null;
    }

    return {
        streams,
        segmentSeconds: duration / timescale,
        startNumber: Number(attribute(template[1], "startNumber")) || 1,
        initTemplate: attribute(template[1], "initialization"),
        mediaTemplate: attribute(template[1], "media")
    };
}

function fillTemplate(template: string, streamId: string, number: number): string {
    return template
        .replace(/\$RepresentationID\$/g, streamId)
        .replace(/\$Number%0(\d+)d\$/g, (_whole, width: string) =>
            String(number).padStart(Number(width), "0"))
        .replace(/\$Number\$/g, String(number));
}

function appendOnce(buffer: SourceBuffer, bytes: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
        const done = () => {
            buffer.removeEventListener("updateend", done);
            buffer.removeEventListener("error", failed);
            resolve();
        };
        const failed = () => {
            buffer.removeEventListener("updateend", done);
            buffer.removeEventListener("error", failed);
            reject(new Error("append failed"));
        };
        buffer.addEventListener("updateend", done);
        buffer.addEventListener("error", failed);
        buffer.appendBuffer(bytes);
    });
}

function settled(buffer: SourceBuffer): Promise<void> {
    if (!buffer.updating) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        buffer.addEventListener("updateend", () => resolve(), { once: true });
    });
}

function bufferedEnd(video: HTMLVideoElement, at: number): number {
    const ranges = video.buffered;
    for (let index = 0; index < ranges.length; index += 1) {
        if (at >= ranges.start(index) - 0.25 && at <= ranges.end(index) + 0.25) {
            return ranges.end(index);
        }
    }
    return at;
}

function bufferedHolds(video: HTMLVideoElement, at: number): boolean {
    const ranges = video.buffered;
    for (let index = 0; index < ranges.length; index += 1) {
        if (at >= ranges.start(index) && at <= ranges.end(index)) {
            return true;
        }
    }
    return false;
}

export function playClip(video: HTMLVideoElement, source: ClipSource): ClipPlayback {
    const base = `${CLIP_BASE}/${source.clipId}/video/${source.sessionId}`;
    const aborter = new AbortController();
    const listeners = new Set<(state: ClipPlaybackState) => void>();

    let destroyed = false;
    let mediaSource: MediaSource | null = null;
    let objectUrl: string | null = null;
    let buffers: SourceBuffer[] = [];
    let plan: ManifestPlan | null = null;

    // Learned rather than computed. The manifest's period start is not the first
    // segment's own timestamp: they differ by a fraction of a second on a clip
    // cut from a background session, and every seek here is in media time.
    let firstSegmentStart = 0;
    let nextSegment = 0;
    let exhausted = false;
    let pumping = false;
    let unavailable = false;

    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let scanTimer: ReturnType<typeof setInterval> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let scanDirection: 1 | -1 = 1;
    let resumeAfterScan = false;

    const inPoint = Math.max(source.startMs, 0) / 1000;
    const span = Math.max(source.durationMs, 0) / 1000;
    const outPoint = inPoint + span;

    function publish() {
        if (destroyed) {
            return;
        }
        const scanning = scanTimer !== null;
        const playable = Math.max(endTarget() - inPoint, 0);
        const elapsed = Math.max(Math.min(video.currentTime, endTarget()) - inPoint, 0);
        const state: ClipPlaybackState = {
            position: playable > 0 && span > 0 ? Math.min(elapsed / playable, 1) * span : elapsed,
            duration: span,
            paused: scanning ? !resumeAfterScan : video.paused,
            ended: !scanning && isEnded(),
            unavailable,
            scanning,
            ready: video.readyState >= 2
        };
        listeners.forEach((listener) => listener(state));
    }

    function unreachable(why: string) {
        if (destroyed || unavailable) {
            return;
        }
        unavailable = true;
        logError("memories: a clip's video is not reachable", why);
        publish();
    }

    async function fetchPart(name: string): Promise<ArrayBuffer | null> {
        const answer = await fetch(`${base}/${name}`, { signal: aborter.signal });
        if (!answer.ok) {
            return null;
        }
        return answer.arrayBuffer();
    }

    function segmentFor(at: number): number {
        if (!plan) {
            return 0;
        }
        const offset = Math.max(at - firstSegmentStart, 0);
        return plan.startNumber + Math.floor(offset / plan.segmentSeconds);
    }

    async function appendSegment(number: number): Promise<boolean> {
        if (!plan || destroyed) {
            return false;
        }
        const parts = await Promise.all(plan.streams.map((stream) =>
            fetchPart(fillTemplate(plan!.mediaTemplate, stream.id, number))));
        if (destroyed || !parts[0]) {
            return false;
        }
        for (let index = 0; index < buffers.length; index += 1) {
            const bytes = parts[index];
            if (!bytes || destroyed) {
                continue;
            }
            await settled(buffers[index]);
            if (destroyed) {
                return false;
            }
            await appendOnce(buffers[index], bytes);
        }
        return true;
    }

    async function pump() {
        if (pumping || destroyed || !plan) {
            return;
        }
        pumping = true;
        try {
            while (!destroyed && !exhausted) {
                const at = video.currentTime;
                if (bufferedEnd(video, at) - at >= AHEAD_SECONDS) {
                    break;
                }
                if (!await appendSegment(nextSegment)) {
                    exhausted = true;
                    break;
                }
                nextSegment += 1;
            }
            if (exhausted) {
                closeStream();
            }
            evict();
        }
        catch (error) {
            if (!destroyed) {
                logError("memories: reading a clip segment failed", error);
            }
        }
        finally {
            pumping = false;
        }
    }

    function closeStream() {
        if (destroyed || !mediaSource || mediaSource.readyState !== "open") {
            return;
        }
        if (buffers.some((buffer) => buffer.updating)) {
            return;
        }
        try {
            mediaSource.endOfStream();
        }
        catch {
        }
    }

    function evict() {
        const cutoff = video.currentTime - BEHIND_SECONDS;
        if (destroyed || cutoff <= 0) {
            return;
        }
        for (const buffer of buffers) {
            if (buffer.updating) {
                continue;
            }
            const ranges = buffer.buffered;
            if (ranges.length === 0 || ranges.start(0) >= cutoff) {
                continue;
            }
            try {
                buffer.remove(0, cutoff);
            }
            catch {
            }
        }
    }

    function refill(from: number) {
        if (destroyed || !plan) {
            return;
        }
        for (const buffer of buffers) {
            if (buffer.updating) {
                try {
                    buffer.abort();
                }
                catch {
                }
            }
        }
        nextSegment = segmentFor(from);
        exhausted = false;
        void pump();
    }

    function endTarget(): number {
        if (exhausted && video.buffered.length > 0) {
            return Math.min(outPoint, video.buffered.end(video.buffered.length - 1));
        }
        return outPoint;
    }

    function isEnded(): boolean {
        return span > 0 && video.currentTime >= endTarget() - 0.05;
    }

    function seekTo(target: number) {
        const clamped = Math.min(Math.max(target, inPoint), endTarget());
        video.currentTime = clamped;
        if (!bufferedHolds(video, clamped)) {
            refill(clamped);
        }
        else {
            void pump();
        }
        publish();
        return clamped;
    }

    function stepSeconds(): number {
        return Math.min(Math.max(span / SEEK_STEPS_PER_CLIP, MIN_SEEK_STEP_SECONDS), MAX_SEEK_STEP_SECONDS);
    }

    function scanRate(): number {
        return Math.min(Math.max(span / SCAN_SECONDS_PER_CLIP, MIN_SCAN_RATE), MAX_SCAN_RATE);
    }

    function stopScan() {
        if (holdTimer !== null) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
        if (watchdog !== null) {
            clearTimeout(watchdog);
            watchdog = null;
        }
        if (scanTimer === null) {
            return;
        }
        clearInterval(scanTimer);
        scanTimer = null;
        if (resumeAfterScan && !isEnded()) {
            void video.play().catch(() => publish());
        }
        resumeAfterScan = false;
        publish();
    }

    function startScan() {
        if (destroyed || scanTimer !== null) {
            return;
        }
        resumeAfterScan = !video.paused;
        video.pause();
        const perTick = scanRate() * (SCAN_TICK_MS / 1000);
        scanTimer = setInterval(() => {
            const landed = seekTo(video.currentTime + scanDirection * perTick);
            if (landed <= inPoint || landed >= endTarget()) {
                stopScan();
            }
        }, SCAN_TICK_MS);
        watchdog = setTimeout(stopScan, SCAN_WATCHDOG_MS);
        publish();
    }

    function onTimeUpdate() {
        if (destroyed) {
            return;
        }
        if (scanTimer === null && isEnded()) {
            video.pause();
        }
        void pump();
        publish();
    }

    function onStateChange() {
        publish();
    }

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onStateChange);
    video.addEventListener("pause", onStateChange);
    video.addEventListener("seeked", onStateChange);
    video.addEventListener("loadedmetadata", onStateChange);
    video.addEventListener("ended", onStateChange);

    void (async () => {
        try {
            const answer = await fetch(`${base}/session.mpd`, { signal: aborter.signal });
            if (!answer.ok) {
                unreachable(`${base}/session.mpd`);
                return;
            }
            plan = parseManifest(await answer.text());
            if (destroyed) {
                return;
            }
            if (!plan) {
                unreachable("the manifest names no segments");
                return;
            }

            mediaSource = new MediaSource();
            objectUrl = URL.createObjectURL(mediaSource);
            video.src = objectUrl;
            await new Promise<void>((resolve) => {
                mediaSource!.addEventListener("sourceopen", () => resolve(), { once: true });
            });
            if (destroyed) {
                return;
            }

            buffers = plan.streams.map((stream) => mediaSource!.addSourceBuffer(stream.type));
            for (let index = 0; index < plan.streams.length; index += 1) {
                const init = await fetchPart(fillTemplate(plan.initTemplate, plan.streams[index].id, 0));
                if (!init || destroyed) {
                    continue;
                }
                await appendOnce(buffers[index], init);
            }

            nextSegment = plan.startNumber;
            if (!await appendSegment(nextSegment)) {
                if (!destroyed) {
                    unreachable("the first segment would not load");
                }
                return;
            }
            nextSegment += 1;
            firstSegmentStart = video.buffered.length > 0 ? video.buffered.start(0) : 0;

            video.currentTime = Math.max(inPoint, firstSegmentStart);
            await pump();
            if (destroyed) {
                return;
            }
            await video.play().catch((error) => {
                logError("memories: a clip would not start", error);
            });
            publish();
        }
        catch (error) {
            if (!destroyed) {
                logError("memories: setting up clip playback failed", error);
                unreachable("playback could not be set up");
            }
        }
    })();

    return {
        destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            stopScan();
            // Order matters. The decoder stops first, then the in-flight fetches
            // are canceled so none of them can resolve into a SourceBuffer that
            // is on its way out, and the element is reset last: dropping the
            // reference alone leaves its decode pipeline alive.
            try {
                video.pause();
            }
            catch {
            }
            aborter.abort();
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("play", onStateChange);
            video.removeEventListener("pause", onStateChange);
            video.removeEventListener("seeked", onStateChange);
            video.removeEventListener("loadedmetadata", onStateChange);
            video.removeEventListener("ended", onStateChange);
            for (const buffer of buffers) {
                try {
                    if (buffer.updating) {
                        buffer.abort();
                    }
                }
                catch {
                }
            }
            buffers = [];
            try {
                video.removeAttribute("src");
                video.load();
            }
            catch {
            }
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                objectUrl = null;
            }
            mediaSource = null;
            plan = null;
            listeners.clear();
        },

        togglePause() {
            if (destroyed) {
                return;
            }
            stopScan();
            if (video.paused) {
                if (isEnded()) {
                    seekTo(inPoint);
                }
                void video.play().catch(() => publish());
                return;
            }
            video.pause();
        },

        beginSeek(direction: 1 | -1) {
            if (destroyed) {
                return;
            }
            stopScan();
            scanDirection = direction;
            seekTo(video.currentTime + direction * stepSeconds());
            holdTimer = setTimeout(() => {
                holdTimer = null;
                startScan();
            }, SCAN_HOLD_DELAY_MS);
        },

        endSeek() {
            stopScan();
        },

        subscribe(listener: (state: ClipPlaybackState) => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
}
