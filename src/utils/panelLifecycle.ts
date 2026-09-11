import { debugLoggingEnabled, logFocusDebug } from "../api";

const ENTRY_SAMPLE_MS = 1500;

let mountIndex = 0;
let lastMountAt = 0;
let lastUnmountAt = 0;

function sinceOrUnknown(then: number, now: number): string {
    return then > 0 ? `${Math.round(now - then)}ms` : "?";
}

export function notePanelMount(): void {
    const now = performance.now();
    mountIndex += 1;
    const closedFor = sinceOrUnknown(lastUnmountAt, now);
    const sincePrevious = sinceOrUnknown(lastMountAt, now);
    lastMountAt = now;
    logFocusDebug("panel-life", `mount#${mountIndex}`, `closed=${closedFor} cycle=${sincePrevious}`);
}

export function notePanelUnmount(): void {
    const now = performance.now();
    const openFor = sinceOrUnknown(lastMountAt, now);
    lastUnmountAt = now;
    logFocusDebug("panel-life", `unmount#${mountIndex}`, `open=${openFor}`);
}

export function samplePanelEntryFrames(): () => void {
    if (!debugLoggingEnabled()) {
        return function noSampling() { };
    }

    const startedAt = performance.now();
    let previousAt = startedAt;
    let worstGap = 0;
    let worstAt = 0;
    let frames = 0;
    let handle = 0;
    let cancelled = false;

    function step() {
        if (cancelled) {
            return;
        }

        const now = performance.now();
        const gap = now - previousAt;
        previousAt = now;
        frames += 1;
        if (gap > worstGap) {
            worstGap = gap;
            worstAt = now - startedAt;
        }

        if (now - startedAt >= ENTRY_SAMPLE_MS) {
            logFocusDebug(
                "panel-life",
                `entry#${mountIndex}`,
                `frames=${frames} worst=${Math.round(worstGap)}ms at=${Math.round(worstAt)}ms`
                    + ` window=${ENTRY_SAMPLE_MS}ms`
            );
            return;
        }

        handle = window.requestAnimationFrame(step);
    }

    handle = window.requestAnimationFrame(step);

    return function stopSampling() {
        cancelled = true;
        window.cancelAnimationFrame(handle);
    };
}
