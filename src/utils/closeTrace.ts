import { debugLoggingEnabled, logFocusDebug } from "../api";

const TRACE_AFTER_REOPEN_MS = 4000;
const MAX_EVENTS = 300;
const FLUSH_MS = 250;
const SAMPLE_MS = 100;

type Trace = {
    id: number;
    t0: number;
    lines: string[];
    flushed: number;
    dropped: number;
    lastSample: string;
    stop: () => void;
};

let current: Trace | null = null;
let nextId = 1;

type SteamSettingsStore = { settings?: { flCurrentDisplayScaleFactor?: number } };

export function steamDisplayScale(): number | null {
    const store = (window as unknown as { settingsStore?: SteamSettingsStore }).settingsStore;
    return store?.settings?.flCurrentDisplayScaleFactor ?? null;
}

function steamWindows(): Window[] {
    const list = SteamUIStore?.WindowStore?.SteamUIWindows;
    const found: Window[] = [];
    if (!Array.isArray(list)) {
        return found;
    }
    for (const entry of list) {
        try {
            const win = entry?.BrowserWindow as Window | undefined;
            if (win && !found.includes(win)) {
                found.push(win);
            }
        }
        catch {
        }
    }
    return found;
}

function nameOf(win: Window): string {
    try {
        return win.name || "?";
    }
    catch {
        return "?";
    }
}

function hasFocus(win: Window): boolean {
    try {
        return win.document.hasFocus();
    }
    catch {
        return false;
    }
}

function sideMenus(): string {
    const menus = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.MenuStore;
    return `open=${menus?.m_eOpenSideMenu ?? "?"} last=${menus?.m_eLastRequestedSideMenu ?? "?"}`;
}

function geometry(win: Window): string {
    try {
        return `${nameOf(win)} ${win.screenLeft},${win.screenTop} ${win.innerWidth}x${win.innerHeight} dpr=${win.devicePixelRatio} focus=${hasFocus(win)} vis=${win.document.visibilityState}`;
    }
    catch {
        return `${nameOf(win)} unreadable`;
    }
}

function record(trace: Trace, text: string): void {
    if (trace.lines.length >= MAX_EVENTS) {
        trace.dropped += 1;
        return;
    }
    const line = `+${Math.round(performance.now() - trace.t0)} ${text}`;
    trace.lines.push(line);
    console.log(`[cheevodeck-trace #${trace.id}]`, line);
}

function flush(trace: Trace): void {
    if (trace.flushed >= trace.lines.length) {
        return;
    }
    const batch = trace.lines.slice(trace.flushed);
    trace.flushed = trace.lines.length;
    logFocusDebug("close-trace", `#${trace.id}`, batch.join(" | "));
}

export function traceModalClose(reopenInMs: number | null): void {
    if (!debugLoggingEnabled()) {
        return;
    }
    current?.stop();

    const windows = steamWindows();
    const trace: Trace = {
        id: nextId++,
        t0: performance.now(),
        lines: [],
        flushed: 0,
        dropped: 0,
        lastSample: "",
        stop: () => { }
    };

    const screenSize = windows[0] ? `${windows[0].screen.width}x${windows[0].screen.height}` : "?";
    record(trace, `start ${new Date().toISOString()} reopenIn=${reopenInMs ?? "never"} screen=${screenSize} steamScale=${steamDisplayScale()} ${sideMenus()}`);
    for (const win of windows) {
        record(trace, `window ${geometry(win)}`);
    }

    const detach: Array<() => void> = [];
    for (const win of windows) {
        const name = nameOf(win);
        const onFocus = () => record(trace, `${name} focus`);
        const onBlur = () => record(trace, `${name} blur`);
        const onVisibility = () => record(trace, `${name} ${win.document.visibilityState}`);
        try {
            win.addEventListener("focus", onFocus);
            win.addEventListener("blur", onBlur);
            win.document.addEventListener("visibilitychange", onVisibility);
            detach.push(() => {
                win.removeEventListener("focus", onFocus);
                win.removeEventListener("blur", onBlur);
                win.document.removeEventListener("visibilitychange", onVisibility);
            });
        }
        catch {
        }
    }

    const sampler = window.setInterval(() => {
        const focused = windows.filter(hasFocus).map(nameOf).join(",") || "none";
        const sample = `${sideMenus()} focused=${focused}`;
        if (sample !== trace.lastSample) {
            trace.lastSample = sample;
            record(trace, `state ${sample}`);
        }
    }, SAMPLE_MS);
    const flusher = window.setInterval(() => flush(trace), FLUSH_MS);
    const ender = window.setTimeout(() => trace.stop(), (reopenInMs ?? 0) + TRACE_AFTER_REOPEN_MS);

    trace.stop = () => {
        window.clearInterval(sampler);
        window.clearInterval(flusher);
        window.clearTimeout(ender);
        for (const undo of detach) {
            undo();
        }
        const end = `+${Math.round(performance.now() - trace.t0)} end events=${trace.lines.length} dropped=${trace.dropped}`;
        trace.lines.push(end);
        console.log(`[cheevodeck-trace #${trace.id}]`, end);
        flush(trace);
        if (current === trace) {
            current = null;
        }
    };
    current = trace;
}

export function markCloseTrace(label: string): void {
    if (current) {
        record(current, `mark ${label}`);
    }
}
