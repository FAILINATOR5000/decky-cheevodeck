import { logFocusDebug, readMemoryClipPart } from "../../api";
import { logError } from "../../utils/errors";

const CLIP_BASE = "https://steamloopback.host/gamerecordings/clips";

const AHEAD_SECONDS = 12;
const BEHIND_SECONDS = 10;

const DROP_AHEAD_SECONDS = 30;

const CURSOR_DRIFT_SECONDS = 4;

const PRIME_SECONDS = 1;

const PIECE_BYTES = 2 * 1024 * 1024;

const SKIP_LADDER: [number, number][] = [
    [10, 2],
    [30, 5],
    [60, 10],
    [120, 15]
];
const LONG_SKIP_SECONDS = 30;

const SCAN_SECONDS_PER_CLIP = 5;
const MIN_SCAN_RATE = 1;
const MAX_SCAN_RATE = 30;
const SCAN_TICK_MS = 100;

const SCAN_WATCHDOG_MS = 15000;


const CLIP_NAME = "clip.mp4";
const CLIP_INDEX_NAME = "clip.json";

export type ClipSource = {
    clipId: string;
    sessionId: string;
    startMs: number;
    durationMs: number;
    gameId: number;
    memoryId: string;
    owned: boolean;
    remuxed: boolean;
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
    skip: (direction: 1 | -1) => void;
    subscribe: (listener: (state: ClipPlaybackState) => void) => () => void;
};

type StreamPlan = {
    id: string;
    type: string;
};

type Piece = {
    bytes: ArrayBuffer;
    size: number;
};

type ClipIndex = {
    mime: string;
    init: number;
    mediaEnd: number;
    size: number;
    fragments: [number, number, boolean][];
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

function parseIndex(text: string): ClipIndex | null {
    let raw: Partial<ClipIndex>;
    try {
        raw = JSON.parse(text) as Partial<ClipIndex>;
    }
    catch {
        return null;
    }
    if (typeof raw.mime !== "string" || raw.mime === "") {
        return null;
    }
    if (typeof raw.init !== "number" || typeof raw.mediaEnd !== "number") {
        return null;
    }
    if (!Array.isArray(raw.fragments) || raw.fragments.length === 0) {
        return null;
    }
    return {
        mime: raw.mime,
        init: raw.init,
        mediaEnd: raw.mediaEnd,
        size: typeof raw.size === "number" ? raw.size : raw.mediaEnd,
        fragments: raw.fragments
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

function decodeBase64(raw: string): ArrayBuffer {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
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
    let index: ClipIndex | null = null;
    let nextOffset = 0;

    // Learned rather than computed. The manifest's period start is not the first
    // segment's own timestamp: they differ by a fraction of a second on a clip
    // cut from a background session, and every seek here is in media time.
    let firstSegmentStart = 0;
    let nextSegment = 0;
    let offsets: number[] = [];
    let finished: boolean[] = [];
    let generation = 0;
    let exhausted = false;
    let mediaEnd: number | null = null;
    let pumping = false;
    let pendingRefill: number | null = null;
    let aimedFrom: number | null = null;
    let started = false;
    let unavailable = false;
    let driveMissing = false;

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
        const ended = !scanning && isEnded();
        const running = playable > 0 && span > 0 ? Math.min(elapsed / playable, 1) * span : elapsed;
        const state: ClipPlaybackState = {
            position: ended ? span : running,
            duration: span,
            paused: scanning ? !resumeAfterScan : video.paused,
            ended,
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
        logFocusDebug("clip-unreachable", source.clipId, why);
        publish();
    }

    async function fetchPart(name: string, offset = 0, limit = 0): Promise<Piece | null> {
        if (source.owned) {
            const asked = performance.now();
            const answer = await readMemoryClipPart(source.gameId, source.memoryId, name, offset, limit);
            const arrived = performance.now();
            if (!answer.ok || answer.data === undefined) {
                if (answer.rootAvailable === false) {
                    driveMissing = true;
                }
                return null;
            }
            const bytes = decodeBase64(answer.data);
            logFocusDebug("clip-part", name,
                `+${(offset / 1e6).toFixed(1)} ${(bytes.byteLength / 1e6).toFixed(1)}MB `
                + `ipc=${Math.round(arrived - asked)}ms decode=${Math.round(performance.now() - arrived)}ms`);
            return { bytes, size: answer.size ?? bytes.byteLength };
        }
        const answer = await fetch(`${base}/${name}`, { signal: aborter.signal });
        if (!answer.ok) {
            return null;
        }
        const bytes = await answer.arrayBuffer();
        return { bytes, size: bytes.byteLength };
    }

    function segmentFor(at: number): number {
        if (!plan) {
            return 0;
        }
        const offset = Math.max(at - firstSegmentStart, 0);
        return plan.startNumber + Math.floor(offset / plan.segmentSeconds);
    }

    function pieceEndFor(from: number): number {
        if (!index) {
            return from;
        }
        const limit = from + PIECE_BYTES;
        let next = index.mediaEnd;
        let best = 0;
        for (const [, offset] of index.fragments) {
            if (offset <= from) {
                continue;
            }
            if (offset <= limit) {
                best = offset;
                continue;
            }
            next = offset;
            break;
        }
        return best > 0 ? best : Math.min(next, index.mediaEnd);
    }

    function syncOffsetFor(at: number): number {
        if (!index) {
            return 0;
        }
        const wanted = Math.max(at, 0) * 1000;
        let chosen = index.init;
        for (const [time, offset, sync] of index.fragments) {
            if (!sync) {
                continue;
            }
            if (time > wanted) {
                break;
            }
            chosen = offset;
        }
        return chosen;
    }

    async function appendFragments(era: number): Promise<boolean> {
        if (!index || destroyed || buffers.length === 0 || nextOffset >= index.mediaEnd) {
            return false;
        }
        const end = pieceEndFor(nextOffset);
        const piece = await fetchPart(CLIP_NAME, nextOffset, end - nextOffset);
        if (destroyed) {
            return false;
        }
        if (era !== generation) {
            return true;
        }
        if (!piece || piece.bytes.byteLength === 0) {
            return false;
        }
        await settled(buffers[0]);
        if (destroyed || era !== generation) {
            return true;
        }
        await appendOnce(buffers[0], piece.bytes);
        if (era !== generation) {
            return true;
        }
        nextOffset += piece.bytes.byteLength;
        logFocusDebug("clip-round", CLIP_NAME,
            `${(nextOffset / 1e6).toFixed(1)}MB in, buffered ${coverage()}`);
        return true;
    }

    function coverage(): string {
        const ranges = video.buffered;
        if (ranges.length === 0) {
            return "nothing";
        }
        const stretches = [];
        for (let slot = 0; slot < ranges.length; slot += 1) {
            stretches.push(`${ranges.start(slot).toFixed(2)}-${ranges.end(slot).toFixed(2)}`);
        }
        return `${ranges.length}x ${stretches.join(" ")}`;
    }

    function cursorTime(): number {
        if (index) {
            for (const [time, offset] of index.fragments) {
                if (offset >= nextOffset) {
                    return time / 1000;
                }
            }
            return Infinity;
        }
        if (!plan) {
            return 0;
        }
        return firstSegmentStart + (nextSegment - plan.startNumber) * plan.segmentSeconds;
    }

    function aimFor(at: number): number {
        return index ? syncOffsetFor(at) : segmentFor(at);
    }

    function aimCursor(at: number) {
        if (index) {
            nextOffset = aimFor(at);
        }
        else {
            startSegment(aimFor(at));
        }
    }

    function startSegment(number: number) {
        nextSegment = number;
        offsets = plan ? plan.streams.map(() => 0) : [];
        finished = plan ? plan.streams.map(() => false) : [];
    }

    function segmentDone(): boolean {
        return finished.every(Boolean);
    }

    async function appendRound(number: number, era: number): Promise<boolean> {
        if (!plan || destroyed) {
            return false;
        }
        const asking = plan.streams.map((_stream, index) => !finished[index]);
        const pieces = await Promise.all(plan.streams.map((stream, index) =>
            asking[index]
                ? fetchPart(fillTemplate(plan!.mediaTemplate, stream.id, number), offsets[index], PIECE_BYTES)
                : Promise.resolve(null)));
        if (destroyed) {
            return false;
        }
        if (era !== generation) {
            return true;
        }
        if (asking[0] && !pieces[0]) {
            return false;
        }
        for (let index = 0; index < buffers.length; index += 1) {
            const piece = pieces[index];
            if (!asking[index]) {
                continue;
            }
            if (!piece || piece.bytes.byteLength === 0) {
                finished[index] = true;
                continue;
            }
            await settled(buffers[index]);
            if (destroyed || era !== generation) {
                return true;
            }
            await appendOnce(buffers[index], piece.bytes);
            if (era !== generation) {
                return true;
            }
            offsets[index] += piece.bytes.byteLength;
            finished[index] = offsets[index] >= piece.size;
        }
        logFocusDebug("clip-round", `segment ${number}`,
            `${(offsets[0] / 1e6).toFixed(1)}MB in, buffered ${coverage()}`);
        return true;
    }

    async function pump(ahead: number = AHEAD_SECONDS, from?: number) {
        if (pumping || destroyed || (!plan && !index)) {
            return;
        }
        pumping = true;
        const era = generation;
        try {
            while (!destroyed && !exhausted && era === generation && pendingRefill === null) {
                const at = from ?? video.currentTime;
                if (bufferedHolds(video, at) && bufferedEnd(video, at) - at >= ahead) {
                    break;
                }
                const edge = bufferedHolds(video, at) ? bufferedEnd(video, at) : at;
                const target = aimFor(edge);
                if (cursorTime() > edge + CURSOR_DRIFT_SECONDS && target !== aimedFrom) {
                    aimedFrom = target;
                    logFocusDebug("clip-aim", source.clipId,
                        `playhead ${at.toFixed(1)}s, reading at ${cursorTime().toFixed(1)}s, `
                        + `back to ${edge.toFixed(1)}s, holding ${coverage()}`);
                    aimCursor(edge);
                }
                const more = index
                    ? await appendFragments(era)
                    : await appendRound(nextSegment, era);
                if (era !== generation) {
                    break;
                }
                if (!more) {
                    exhausted = true;
                    if (video.buffered.length > 0) {
                        mediaEnd = Math.max(mediaEnd ?? 0, video.buffered.end(video.buffered.length - 1));
                    }
                    break;
                }
                if (!index && segmentDone()) {
                    startSegment(nextSegment + 1);
                }
            }
        }
        catch (error) {
            if (!destroyed) {
                logError("memories: reading a clip segment failed", error);
                logFocusDebug("clip-failed", source.clipId, String(error));
            }
        }
        finally {
            try {
                await evict(era);
                if (exhausted) {
                    closeStream();
                }
            }
            catch {
            }
            pumping = false;
        }
        if (destroyed) {
            return;
        }
        if (pendingRefill !== null) {
            const waiting = pendingRefill;
            pendingRefill = null;
            refill(waiting);
            return;
        }
        if (era !== generation) {
            void pump();
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

    async function evict(era: number) {
        if (destroyed || buffers.length === 0) {
            return;
        }
        const at = video.currentTime;
        let dropped = false;
        let ahead = false;
        for (const buffer of buffers) {
            if (await dropRange(buffer, 0, at - BEHIND_SECONDS)) {
                dropped = true;
            }
            if (await dropRange(buffer, at + DROP_AHEAD_SECONDS, Infinity)) {
                dropped = true;
                ahead = true;
            }
        }
        if (dropped && !destroyed && !bufferedHolds(video, video.currentTime)) {
            refill(video.currentTime);
            return;
        }
        if (ahead && era === generation) {
            const edge = bufferedEnd(video, video.currentTime);
            logFocusDebug("clip-drop", source.clipId,
                `at ${at.toFixed(1)}s, holding ${coverage()}, reading from ${edge.toFixed(1)}s`);
            exhausted = false;
            aimCursor(edge);
        }
    }

    async function dropRange(buffer: SourceBuffer, from: number, to: number): Promise<boolean> {
        if (destroyed || to <= from) {
            return false;
        }
        await settled(buffer);
        const ranges = buffer.buffered;
        if (destroyed || ranges.length === 0) {
            return false;
        }
        const start = Math.max(from, ranges.start(0));
        const end = Math.min(to, ranges.end(ranges.length - 1));
        if (end <= start) {
            return false;
        }
        try {
            buffer.remove(start, end);
        }
        catch {
            return false;
        }
        await settled(buffer);
        return true;
    }

    function refill(from: number) {
        if (destroyed || buffers.length === 0 || (!plan && !index)) {
            return;
        }
        pendingRefill = null;
        for (const buffer of buffers) {
            if (buffer.updating) {
                try {
                    buffer.abort();
                }
                catch {
                }
            }
        }
        generation += 1;
        aimCursor(from);
        aimedFrom = null;
        exhausted = false;
        mediaEnd = null;
        void pump();
    }

    function requestFrom(at: number) {
        if (!started) {
            return;
        }
        if (pumping) {
            pendingRefill = at;
        }
        else {
            refill(at);
        }
    }

    function endTarget(): number {
        return mediaEnd === null ? outPoint : Math.min(outPoint, mediaEnd);
    }

    function isEnded(): boolean {
        return span > 0 && video.currentTime >= endTarget() - 0.05;
    }

    function seekTo(target: number) {
        const clamped = Math.min(Math.max(target, inPoint), endTarget());
        video.currentTime = clamped;
        if (bufferedHolds(video, clamped)) {
            pendingRefill = null;
            void pump();
        }
        else {
            requestFrom(clamped);
        }
        publish();
        return clamped;
    }

    function skipSeconds(): number {
        for (const [upTo, seconds] of SKIP_LADDER) {
            if (span <= upTo) {
                return seconds;
            }
        }
        return LONG_SKIP_SECONDS;
    }

    function scanRate(): number {
        return Math.min(Math.max(span / SCAN_SECONDS_PER_CLIP, MIN_SCAN_RATE), MAX_SCAN_RATE);
    }

    function stopScan(why = "release") {
        if (watchdog !== null) {
            clearTimeout(watchdog);
            watchdog = null;
        }
        if (scanTimer === null) {
            return;
        }
        clearInterval(scanTimer);
        scanTimer = null;
        logFocusDebug("clip-scan", source.clipId,
            `stop on ${why} at ${video.currentTime.toFixed(1)}s, holding ${coverage()}`);
        if (!bufferedHolds(video, video.currentTime)) {
            requestFrom(video.currentTime);
        }
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
        const rate = scanRate();
        let stepped = performance.now();
        scanTimer = setInterval(() => {
            const now = performance.now();
            const elapsed = Math.min(now - stepped, SCAN_TICK_MS * 4);
            const moved = rate * (elapsed / 1000);
            stepped = now;
            const landed = seekTo(video.currentTime + scanDirection * moved);
            if (landed <= inPoint || landed >= endTarget()) {
                stopScan("edge");
            }
        }, SCAN_TICK_MS);
        watchdog = setTimeout(() => stopScan("watchdog"), SCAN_WATCHDOG_MS);
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

    function onStarved() {
        if (destroyed) {
            return;
        }
        logFocusDebug("clip-starved", source.clipId,
            `at ${video.currentTime.toFixed(1)}s ready=${video.readyState} `
            + `holding ${coverage()} exhausted=${exhausted} pumping=${pumping} started=${started}`);
    }

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("waiting", onStarved);
    video.addEventListener("stalled", onStarved);
    video.addEventListener("play", onStateChange);
    video.addEventListener("pause", onStateChange);
    video.addEventListener("seeked", onStateChange);
    video.addEventListener("loadedmetadata", onStateChange);
    video.addEventListener("ended", onStateChange);

    const opened = performance.now();
    void (async () => {
        try {
            if (source.remuxed) {
                const written = await fetchPart(CLIP_INDEX_NAME);
                if (written === null) {
                    unreachable(driveMissing
                        ? "the drive holding it is not connected"
                        : "the clip's index is not there");
                    return;
                }
                index = parseIndex(new TextDecoder().decode(written.bytes));
                if (destroyed) {
                    return;
                }
                if (!index) {
                    unreachable("the clip's index does not describe a clip");
                    return;
                }
            }
            else {
                const manifest = await fetchPart("session.mpd");
                if (manifest === null) {
                    unreachable(driveMissing ? "the drive holding it is not connected" : `${base}/session.mpd`);
                    return;
                }
                plan = parseManifest(new TextDecoder().decode(manifest.bytes));
                if (destroyed) {
                    return;
                }
                if (!plan) {
                    unreachable("the manifest names no segments");
                    return;
                }
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

            if (index) {
                buffers = [mediaSource.addSourceBuffer(index.mime)];
                const header = await fetchPart(CLIP_NAME, 0, index.init);
                if (!header || destroyed) {
                    if (!destroyed) {
                        unreachable("the clip's header would not load");
                    }
                    return;
                }
                await appendOnce(buffers[0], header.bytes);
                nextOffset = syncOffsetFor(inPoint);
                if (!await appendFragments(generation)) {
                    if (!destroyed) {
                        unreachable("the first fragment would not load");
                    }
                    return;
                }
            }
            else if (plan) {
                buffers = plan.streams.map((stream) => mediaSource!.addSourceBuffer(stream.type));
                for (let slot = 0; slot < plan.streams.length; slot += 1) {
                    const init = await fetchPart(fillTemplate(plan.initTemplate, plan.streams[slot].id, 0));
                    if (!init || destroyed) {
                        continue;
                    }
                    await appendOnce(buffers[slot], init.bytes);
                }

                startSegment(plan.startNumber);
                if (!await appendRound(nextSegment, generation)) {
                    if (!destroyed) {
                        unreachable("the first segment would not load");
                    }
                    return;
                }
                if (segmentDone()) {
                    startSegment(nextSegment + 1);
                }
            }
            firstSegmentStart = video.buffered.length > 0 ? video.buffered.start(0) : 0;

            const startAt = Math.max(inPoint, firstSegmentStart);
            video.currentTime = startAt;
            await pump(PRIME_SECONDS, startAt);
            if (destroyed) {
                return;
            }
            started = true;
            video.addEventListener("playing", () => {
                logFocusDebug("clip-playing", source.clipId,
                    `${Math.round(performance.now() - opened)}ms after open`);
            }, { once: true });
            logFocusDebug("clip-start", source.clipId,
                `primed=${Math.round(performance.now() - opened)}ms at=${startAt.toFixed(3)} `
                + `buffered=${(bufferedEnd(video, startAt) - startAt).toFixed(2)}s`);
            await video.play().catch((error) => {
                logError("memories: a clip would not start", error);
            });
            publish();
            void pump();
        }
        catch (error) {
            if (!destroyed) {
                logError("memories: setting up clip playback failed", error);
                logFocusDebug("clip-setup-failed", source.clipId, String(error));
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
            video.removeEventListener("waiting", onStarved);
            video.removeEventListener("stalled", onStarved);
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
            index = null;
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
            logFocusDebug("clip-seek", source.clipId,
                `${direction > 0 ? "forward" : "back"} scan `
                + `from ${video.currentTime.toFixed(1)}s scanning=${scanTimer !== null}`);
            stopScan();
            scanDirection = direction;
            startScan();
        },

        skip(direction: 1 | -1) {
            if (destroyed) {
                return;
            }
            const moved = skipSeconds();
            logFocusDebug("clip-seek", source.clipId,
                `skip ${direction > 0 ? "forward" : "back"} ${moved.toFixed(1)}s `
                + `from ${video.currentTime.toFixed(1)}s scanning=${scanTimer !== null}`);
            stopScan();
            seekTo(video.currentTime + direction * moved);
        },

        endSeek() {
            logFocusDebug("clip-seek", source.clipId,
                `release at ${video.currentTime.toFixed(1)}s scanning=${scanTimer !== null}`);
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
