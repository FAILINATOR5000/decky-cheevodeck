import { logStormbreakerEvent } from "../api";
import { logError } from "./errors";
import { quickAccessWindow } from "./quickAccess";

type QamView = {
    SetFocus: (on: boolean) => void;
    SetVisible: (on: boolean) => void;
};

type ViewHolder = {
    GetBrowserView: () => QamView | undefined;
    GetViewWindow: () => Window | undefined;
};

type Side = "bpm" | "qam";

type StandaloneClaim = {
    owner?: string;
    stormbreaker?: boolean;
    automaticRecovery?: boolean;
};

type Breaking = {
    view: QamView;
    hiddenAt: number;
    events: number;
};

const STORM_EVENTS = 30;
const STORM_WINDOW_MS = 150;
const QUIET_MS = 100;
const GIVE_UP_MS = 3000;
const REARM_AFTER_STOP_MS = 250;
const REARM_MS = 3000;
const CHECK_MS = 25;
const FIND_RETRY_MS = 2000;
const FIND_MAX_TRIES = 30;
const FIBER_MAX_DEPTH = 400;
const HOOKS_MAX = 60;
const QUICK_ACCESS_MENU = 2;

let enabled = false;
let gameMode = true;
let detach: Array<() => void> = [];
let recent: Array<{ at: number; side: Side }> = [];
let lastEvent = 0;
let breaking: Breaking | null = null;
let rearmAt = 0;
let checkTimer = 0;
let findTimer = 0;
let findTries = 0;

function report(stage: string, extra: string): void {
    console.log(`[cheevodeck] stormbreaker ${stage} ${extra}`);
    void logStormbreakerEvent(stage, extra).catch(() => { });
}

function mainWindowInstance(): any {
    return SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance;
}

function quickAccessIsOpen(): boolean {
    return mainWindowInstance()?.MenuStore?.m_eOpenSideMenu === QUICK_ACCESS_MENU;
}

function findQamView(): QamView | null {
    const target = quickAccessWindow()?.document.getElementById("browserview_target")?.firstElementChild;
    if (!target) {
        return null;
    }
    const fiberKey = Object.keys(target).find((key) => key.startsWith("__reactFiber"));
    let fiber = fiberKey ? (target as unknown as Record<string, any>)[fiberKey] : null;
    for (let depth = 0; fiber && depth < FIBER_MAX_DEPTH; depth++, fiber = fiber.return) {
        let hook = fiber.memoizedState;
        for (let i = 0; hook && i < HOOKS_MAX; i++, hook = hook.next) {
            const holder = hook.memoizedState as ViewHolder | null;
            if (holder && typeof holder.GetBrowserView === "function" && typeof holder.GetViewWindow === "function") {
                const found = holder.GetBrowserView();
                if (found && typeof found.SetFocus === "function" && typeof found.SetVisible === "function") {
                    return found;
                }
            }
        }
    }
    return null;
}

function checkBreak(now: number): void {
    if (!breaking) {
        return;
    }
    const quiet = now - lastEvent >= QUIET_MS && now - breaking.hiddenAt >= QUIET_MS;
    if (quiet || now - breaking.hiddenAt >= GIVE_UP_MS) {
        finishBreak(quiet);
    }
}

function finishBreak(stopped: boolean): void {
    if (!breaking) {
        return;
    }
    const { view, hiddenAt, events } = breaking;
    breaking = null;
    window.clearInterval(checkTimer);
    const now = performance.now();
    rearmAt = now + (stopped ? REARM_AFTER_STOP_MS : REARM_MS);
    const restore = quickAccessIsOpen();
    if (restore) {
        try {
            view.SetVisible(true);
            view.SetFocus(true);
        }
        catch (e) {
            logError("stormbreaker: showing the QAM's view again", e);
        }
    }
    const lastChange = Math.max(0, Math.round(lastEvent - hiddenAt));
    report(
        stopped ? "stopped" : "still going",
        `${events} focus changes after hiding, the last ${lastChange}ms in; ${restore ? "view shown again" : "menu closed, view left hidden"}`
    );
}

function startBreak(now: number): void {
    const count = recent.length;
    const span = Math.round(now - recent[0].at);
    recent = [];
    rearmAt = now + REARM_MS;
    if (standaloneClaim()?.stormbreaker) {
        report("storm", `${count} focus changes in ${span}ms, left to the Stormbreaker plugin`);
        return;
    }
    if (!quickAccessIsOpen()) {
        report("storm", `${count} focus changes in ${span}ms with the menu closed, left alone`);
        return;
    }
    let view: QamView | null = null;
    try {
        view = findQamView();
        view?.SetVisible(false);
    }
    catch (e) {
        logError("stormbreaker: hiding the QAM's view", e);
        return;
    }
    if (!view) {
        report("storm", `${count} focus changes in ${span}ms, the QAM's view was not found`);
        return;
    }
    breaking = { view, hiddenAt: now, events: 0 };
    checkTimer = window.setInterval(() => checkBreak(performance.now()), CHECK_MS);
    report("storm", `${count} focus changes in ${span}ms, view hidden`);
}

function onFocusChange(side: Side): void {
    const now = performance.now();
    lastEvent = now;
    if (breaking) {
        breaking.events += 1;
        checkBreak(now);
        return;
    }
    if (now < rearmAt) {
        return;
    }
    recent.push({ at: now, side });
    while (recent.length > 0 && now - recent[0].at > STORM_WINDOW_MS) {
        recent.shift();
    }
    if (recent.length < STORM_EVENTS) {
        return;
    }
    if (recent.some((e) => e.side === "bpm") && recent.some((e) => e.side === "qam")) {
        startBreak(now);
    }
}

function listen(win: Window, side: Side): void {
    const handler = () => onFocusChange(side);
    win.addEventListener("focus", handler);
    win.addEventListener("blur", handler);
    detach.push(() => {
        win.removeEventListener("focus", handler);
        win.removeEventListener("blur", handler);
    });
}

function tryAttach(): void {
    window.clearTimeout(findTimer);
    if (!enabled || detach.length > 0) {
        return;
    }
    if (!gameMode) {
        report("off", "not in Game Mode");
        return;
    }
    const bigPicture = mainWindowInstance()?.BrowserWindow as Window | undefined;
    const qam = quickAccessWindow();
    if (bigPicture && qam && bigPicture !== qam) {
        listen(bigPicture, "bpm");
        listen(qam, "qam");
        report("ready", "watching Big Picture and the QAM");
        return;
    }
    findTries += 1;
    if (findTries < FIND_MAX_TRIES) {
        findTimer = window.setTimeout(tryAttach, FIND_RETRY_MS);
        return;
    }
    report("unavailable", `bigPicture=${Boolean(bigPicture)} qam=${Boolean(qam)}`);
}

function detachAll(): void {
    window.clearTimeout(findTimer);
    finishBreak(false);
    for (const undo of detach) {
        undo();
    }
    detach = [];
    recent = [];
}

export function standaloneClaim(): StandaloneClaim | null {
    const claim = (window as unknown as { __stormbreakerClaim?: StandaloneClaim }).__stormbreakerClaim;
    return claim?.owner === "stormbreaker" ? claim : null;
}

export function setStormbreakerGameMode(on: boolean): void {
    gameMode = on;
    if (!on) {
        detachAll();
    }
}

export function setStormbreakerEnabled(on: boolean): void {
    if (on === enabled) {
        return;
    }
    enabled = on;
    if (on) {
        findTries = 0;
        tryAttach();
        return;
    }
    detachAll();
}

export function uninstallStormbreaker(): void {
    enabled = false;
    detachAll();
}
