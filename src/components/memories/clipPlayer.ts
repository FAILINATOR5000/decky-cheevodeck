import { debugLoggingEnabled, logFocusDebug, readMemoryClipPart } from "../../api";
import { logError } from "../../utils/errors";

const CLIP_BASE = "https://steamloopback.host/gamerecordings/clips";

const AHEAD_SECONDS = 12;
const BEHIND_SECONDS = 10;

const DROP_AHEAD_SECONDS = 30;


const CURSOR_DRIFT_SECONDS = 4;

const PRIME_SECONDS = 1;


const PIECE_BYTES = 2 * 1024 * 1024;

const SCAN_PIECE_BYTES = 1024 * 1024;

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
const SCAN_CATCHUP_STEPS = 4;

const SCAN_SLOWDOWN_LIMIT = 2;

const BOUNDARY_NUDGE_SECONDS = 0.05;

const SCAN_WATCHDOG_MS = 15000;

const LAND_CLEAR_ROUNDS = 3;


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
    mediaTime: number;
    duration: number;
    paused: boolean;
    ended: boolean;
    unavailable: boolean;
    scanning: boolean;
};

export type ClipPlayback = {
    destroy: () => void;
    togglePause: () => void;
    beginSeek: (direction: 1 | -1) => void;
    endSeek: () => void;
    skip: (direction: 1 | -1) => void;
    seekTo: (mediaTime: number) => void;
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

function waitFor(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, Math.max(ms, 0));
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

function clipDebug(stage: string, key: string, build: () => string) {
    if (!debugLoggingEnabled()) {
        return;
    }
    logFocusDebug(stage, key, build());
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

    let scanning = false;
    let scanRun = 0;
    let scanAim = 0;
    let scanFrame: (() => void) | null = null;
    let frameWhy = "";
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let scanDirection: 1 | -1 = 1;
    let resumeAfterScan = false;
    let landRun = 0;
    let clearingForLanding = false;

    const inPoint = Math.max(source.startMs, 0) / 1000;
    const span = Math.max(source.durationMs, 0) / 1000;
    const outPoint = inPoint + span;

    function publish() {
        if (destroyed) {
            return;
        }
        const playable = Math.max(endTarget() - inPoint, 0);
        const elapsed = Math.max(Math.min(video.currentTime, endTarget()) - inPoint, 0);
        const ended = !scanning && isEnded();
        const running = playable > 0 && span > 0 ? Math.min(elapsed / playable, 1) * span : elapsed;
        const state: ClipPlaybackState = {
            position: ended ? span : running,
            mediaTime: video.currentTime,
            duration: span,
            paused: scanning ? !resumeAfterScan : video.paused,
            ended,
            unavailable,
            scanning
        };
        listeners.forEach((listener) => listener(state));
    }

    function unreachable(why: string) {
        if (destroyed || unavailable) {
            return;
        }
        unavailable = true;
        logError("memories: a clip's video is not reachable", why);
        clipDebug("clip-unreachable", source.clipId, () => why);
        publish();
    }

    function mediaFailed(): boolean {
        const failure = video.error;
        if (failure === null) {
            return false;
        }
        if (!unavailable) {
            exhausted = true;
            clipDebug("clip-dead", source.clipId,
                () => `code ${failure.code} at ${video.currentTime.toFixed(1)}s, holding ${coverage()}`);
            unreachable(failure.message || `playback stopped on media error ${failure.code}`);
            stopScan("error");
            pendingRefill = null;
        }
        return true;
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
            clipDebug("clip-part", name,
                () => `+${(offset / 1e6).toFixed(1)} ${(bytes.byteLength / 1e6).toFixed(1)}MB `
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

    function syncTimeFor(at: number): number {
        if (!index) {
            return at;
        }
        const wanted = Math.max(at, 0) * 1000;
        let chosen = wanted;
        for (const [time, , sync] of index.fragments) {
            if (!sync) {
                continue;
            }
            if (time > wanted) {
                break;
            }
            chosen = time;
        }
        return chosen / 1000;
    }

    function scanTarget(at: number): number {
        if (index) {
            return syncTimeFor(at) + BOUNDARY_NUDGE_SECONDS;
        }
        if (!plan) {
            return at;
        }
        const start = firstSegmentStart + (segmentFor(at) - plan.startNumber) * plan.segmentSeconds;
        return start + BOUNDARY_NUDGE_SECONDS;
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
        if (destroyed || era !== generation || mediaFailed()) {
            return true;
        }
        await appendOnce(buffers[0], piece.bytes);
        if (era !== generation) {
            return true;
        }
        nextOffset += piece.bytes.byteLength;
        clipDebug("clip-round", CLIP_NAME,
            () => `${(nextOffset / 1e6).toFixed(1)}MB in, buffered ${coverage()}`);
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

    function aimingInPlace(at: number): boolean {
        if (index || !plan) {
            return false;
        }
        return segmentFor(at) === nextSegment && offsets.some((sent) => sent > 0);
    }

    function resetParsers() {
        if (index || !mediaSource || mediaSource.readyState !== "open") {
            return;
        }
        for (const buffer of buffers) {
            try {
                buffer.abort();
            }
            catch {
            }
        }
    }

    function aimCursor(at: number) {
        if (index) {
            nextOffset = aimFor(at);
            return;
        }
        if (aimingInPlace(at)) {
            return;
        }
        startSegment(aimFor(at));
        resetParsers();
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
                ? fetchPart(fillTemplate(plan!.mediaTemplate, stream.id, number), offsets[index],
                    scanning ? SCAN_PIECE_BYTES : PIECE_BYTES)
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
            if (destroyed || era !== generation || mediaFailed()) {
                return true;
            }
            await appendOnce(buffers[index], piece.bytes);
            if (era !== generation) {
                return true;
            }
            offsets[index] += piece.bytes.byteLength;
            finished[index] = offsets[index] >= piece.size;
        }
        clipDebug("clip-round", `segment ${number}`,
            () => `${(offsets[0] / 1e6).toFixed(1)}MB in, buffered ${coverage()}`);
        return true;
    }

    function readAhead(): number {
        return scanning ? 0 : AHEAD_SECONDS;
    }

    function frameArrived(why: string) {
        const waiting = scanFrame;
        if (waiting === null) {
            return;
        }
        scanFrame = null;
        frameWhy = why;
        waiting();
    }

    function awaitFrame(): Promise<void> {
        return new Promise((resolve) => {
            scanFrame = resolve;
        });
    }

    async function pump(ahead: number = readAhead(), from?: number) {
        if (pumping || clearingForLanding || destroyed || (!plan && !index) || mediaFailed()) {
            return;
        }
        pumping = true;
        const era = generation;
        try {
            while (!destroyed && !exhausted && era === generation && pendingRefill === null) {
                if (mediaFailed()) {
                    break;
                }
                const at = from ?? video.currentTime;
                if (bufferedHolds(video, at) && bufferedEnd(video, at) - at >= ahead) {
                    break;
                }
                const edge = bufferedHolds(video, at) ? bufferedEnd(video, at) : at;
                const target = aimFor(edge);
                if (cursorTime() > edge + CURSOR_DRIFT_SECONDS && target !== aimedFrom) {
                    aimedFrom = target;
                    clipDebug("clip-aim", source.clipId,
                        () => `playhead ${at.toFixed(1)}s, reading at ${cursorTime().toFixed(1)}s, `
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
                clipDebug("clip-failed", source.clipId, () => String(error));
                mediaFailed();
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
            if (pendingRefill === null && (!video.seeking || exhausted)) {
                frameArrived("read");
            }
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
            clipDebug("clip-drop", source.clipId,
                () => `at ${at.toFixed(1)}s, holding ${coverage()}, reading from ${edge.toFixed(1)}s`);
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
        if (destroyed || buffers.length === 0 || (!plan && !index) || mediaFailed()) {
            return;
        }
        pendingRefill = null;
        if (!aimingInPlace(from)) {
            for (const buffer of buffers) {
                if (buffer.updating) {
                    try {
                        buffer.abort();
                    }
                    catch {
                    }
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
        if (!scanning) {
            publish();
        }
        return clamped;
    }

    function nextPictureAfter(at: number): number {
        if (index) {
            const wanted = at * 1000;
            for (const [time, , sync] of index.fragments) {
                if (sync && time > wanted + 1) {
                    return time / 1000;
                }
            }
            return endTarget();
        }
        if (!plan) {
            return endTarget();
        }
        const here = firstSegmentStart + (segmentFor(at) - plan.startNumber) * plan.segmentSeconds;
        return here + plan.segmentSeconds;
    }

    function pictureBefore(at: number): number {
        if (index) {
            return syncTimeFor(at);
        }
        if (!plan) {
            return at;
        }
        return firstSegmentStart + (segmentFor(at) - plan.startNumber) * plan.segmentSeconds;
    }

    function secondsToNextPicture(rate: number): number {
        const here = scanTarget(scanAim) - BOUNDARY_NUDGE_SECONDS;
        const edge = scanDirection > 0 ? nextPictureAfter(here) : here;
        return Math.abs(edge - scanAim) / rate;
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
        if (!scanning) {
            return;
        }
        scanning = false;
        frameArrived("stop");
        clipDebug("clip-scan", source.clipId,
            () => `stop on ${why} at ${video.currentTime.toFixed(1)}s, holding ${coverage()}`);
        let landing = -1;
        if (why !== "edge") {
            landing = scanDirection > 0 ? nextPictureAfter(video.currentTime)
                : Math.max(pictureBefore(video.currentTime), inPoint);
        }
        if (landing > 0 && landing < endTarget()) {
            generation += 1;
            clearingForLanding = true;
            void landOn(landing);
        }
        else if (!bufferedHolds(video, video.currentTime)) {
            requestFrom(video.currentTime);
        }
        if (resumeAfterScan && !isEnded()) {
            void video.play().catch(() => publish());
        }
        resumeAfterScan = false;
        publish();
    }

    async function landOn(at: number) {
        landRun += 1;
        const run = landRun;
        let round = 0;
        try {
            while (round < LAND_CLEAR_ROUNDS) {
                round += 1;
                for (const buffer of buffers) {
                    if (buffer.updating) {
                        try {
                            buffer.abort();
                        }
                        catch {
                        }
                    }
                    try {
                        buffer.remove(0, Infinity);
                    }
                    catch {
                    }
                }
                for (const buffer of buffers) {
                    await settled(buffer);
                }
                if (destroyed || run !== landRun) {
                    return;
                }
                if (video.buffered.length === 0) {
                    break;
                }
            }
        }
        finally {
            if (run === landRun) {
                clearingForLanding = false;
            }
        }
        if (destroyed || scanning) {
            return;
        }
        clipDebug("clip-land", source.clipId,
            () => `${at.toFixed(2)}s after ${round} clear${round === 1 ? "" : "s"}, `
            + `holding ${coverage()}`);
        video.currentTime = at;
        requestFrom(at);
        publish();
    }

    function armWatchdog() {
        if (watchdog !== null) {
            clearTimeout(watchdog);
        }
        watchdog = setTimeout(() => stopScan("watchdog"), SCAN_WATCHDOG_MS);
    }

    function sustainableRate(cost: number): number {
        if (cost <= 0) {
            return MAX_SCAN_RATE;
        }
        const here = scanTarget(scanAim) - BOUNDARY_NUDGE_SECONDS;
        const spacing = nextPictureAfter(here) - here;
        if (spacing <= 0) {
            return MAX_SCAN_RATE;
        }
        return Math.max(spacing / (cost / 1000), MIN_SCAN_RATE);
    }

    function startScan() {
        if (destroyed || scanning || !started || unavailable) {
            return;
        }
        resumeAfterScan = !video.paused;
        video.pause();
        scanning = true;
        scanRun += 1;
        scanAim = scanDirection > 0 ? nextPictureAfter(video.currentTime) : video.currentTime;
        armWatchdog();
        void runScan(scanRun);
        publish();
    }

    async function runScan(era: number) {
        const asked = scanRate();
        let rate = asked;
        let stepped = performance.now();
        let cost = 0;
        let shown: number | null = null;
        let waited = false;
        while (scanning && !destroyed && era === scanRun) {
            const now = performance.now();
            let elapsed = now - stepped;
            if (!waited && cost > 0) {
                elapsed = Math.min(elapsed, cost * SCAN_CATCHUP_STEPS);
            }
            stepped = now;
            waited = false;
            scanAim = Math.min(Math.max(scanAim + scanDirection * rate * (elapsed / 1000), inPoint),
                endTarget());
            if (scanDirection > 0 ? scanAim >= endTarget() : scanAim <= inPoint) {
                seekTo(scanAim);
                stopScan("edge");
                return;
            }
            const target = scanTarget(scanAim);
            if (target === shown) {
                waited = true;
                await waitFor(secondsToNextPicture(rate) * 1000);
                continue;
            }
            shown = target;
            const arrival = awaitFrame();
            seekTo(target);
            await arrival;
            if (!scanning || destroyed || era !== scanRun) {
                return;
            }
            publish();
            armWatchdog();
            const landed = frameWhy;
            const took = performance.now() - now;
            if (cost === 0) {
                cost = took;
            }
            else if (took <= cost * SCAN_CATCHUP_STEPS) {
                cost = cost * 0.7 + took * 0.3;
            }
            rate = Math.min(asked, Math.max(sustainableRate(cost), asked / SCAN_SLOWDOWN_LIMIT));
            clipDebug("clip-step", source.clipId,
                () => `${target.toFixed(2)}s via ${landed} ready=${video.readyState} `
                + `seeking=${video.seeking} at=${video.currentTime.toFixed(2)} `
                + `took=${Math.round(took)}ms rate=${rate.toFixed(1)} holding ${coverage()}`);
        }
    }

    function onTimeUpdate() {
        if (destroyed) {
            return;
        }
        if (!scanning && isEnded()) {
            video.pause();
        }
        void pump();
        publish();
    }

    function onStateChange() {
        publish();
    }

    function onSeeked() {
        if (!video.seeking) {
            frameArrived("seeked");
        }
        publish();
    }

    function onStarved() {
        if (destroyed) {
            return;
        }
        clipDebug("clip-starved", source.clipId,
            () => `at ${video.currentTime.toFixed(1)}s ready=${video.readyState} `
            + `holding ${coverage()} exhausted=${exhausted} pumping=${pumping} started=${started}`);
    }

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("waiting", onStarved);
    video.addEventListener("stalled", onStarved);
    video.addEventListener("play", onStateChange);
    video.addEventListener("pause", onStateChange);
    video.addEventListener("seeked", onSeeked);
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

            if (outPoint > 0) {
                try {
                    mediaSource.duration = outPoint;
                }
                catch {
                }
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
            if (debugLoggingEnabled()) {
                video.addEventListener("playing", () => {
                    clipDebug("clip-playing", source.clipId,
                        () => `${Math.round(performance.now() - opened)}ms after open`);
                }, { once: true });
            }
            clipDebug("clip-start", source.clipId,
                () => `primed=${Math.round(performance.now() - opened)}ms at=${startAt.toFixed(3)} `
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
                clipDebug("clip-setup-failed", source.clipId, () => String(error));
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
            video.removeEventListener("seeked", onSeeked);
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
            clipDebug("clip-seek", source.clipId,
                () => `${direction > 0 ? "forward" : "back"} scan `
                + `from ${video.currentTime.toFixed(1)}s scanning=${scanning}`);
            stopScan();
            scanDirection = direction;
            startScan();
        },

        skip(direction: 1 | -1) {
            if (destroyed) {
                return;
            }
            const moved = skipSeconds();
            clipDebug("clip-seek", source.clipId,
                () => `skip ${direction > 0 ? "forward" : "back"} ${moved.toFixed(1)}s `
                + `from ${video.currentTime.toFixed(1)}s scanning=${scanning}`);
            stopScan();
            seekTo(video.currentTime + direction * moved);
        },

        endSeek() {
            clipDebug("clip-seek", source.clipId,
                () => `release at ${video.currentTime.toFixed(1)}s scanning=${scanning}`);
            stopScan();
        },

        seekTo(mediaTime: number) {
            if (destroyed) {
                return;
            }
            clipDebug("clip-seek", source.clipId,
                () => `jump to ${mediaTime.toFixed(1)}s `
                + `from ${video.currentTime.toFixed(1)}s scanning=${scanning}`);
            stopScan();
            seekTo(mediaTime);
        },

        subscribe(listener: (state: ClipPlaybackState) => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
}
