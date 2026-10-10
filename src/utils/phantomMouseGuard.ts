import { quickAccessWindow } from "./quickAccess";

const FIND_RETRY_MS = 1000;
const FIND_MAX_TRIES = 30;

let registered = false;
let gameMode = true;
let findTries = 0;
let findTimer = 0;
let guarded: Array<{ win: Window; release: () => void }> = [];

function ignorePhantomMove(event: MouseEvent) {
    if (event.movementX === 0 && event.movementY === 0) {
        event.preventDefault();
    }
}

function guard(win: Window) {
    if (guarded.some((entry) => entry.win === win)) {
        return;
    }
    win.addEventListener("mousemove", ignorePhantomMove, true);
    guarded.push({ win, release: () => win.removeEventListener("mousemove", ignorePhantomMove, true) });
}

function releaseAll() {
    window.clearTimeout(findTimer);
    for (const entry of guarded) {
        entry.release();
    }
    guarded = [];
}

function tryGuard() {
    window.clearTimeout(findTimer);
    if (!registered || !gameMode) {
        return;
    }
    const bigPicture = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.BrowserWindow as Window | undefined;
    const qam = quickAccessWindow();
    if (bigPicture) {
        guard(bigPicture);
    }
    if (qam) {
        guard(qam);
    }
    if (bigPicture && qam) {
        return;
    }
    findTries += 1;
    if (findTries < FIND_MAX_TRIES) {
        findTimer = window.setTimeout(tryGuard, FIND_RETRY_MS);
    }
}

export function registerPhantomMouseGuard(): void {
    registered = true;
    findTries = 0;
    tryGuard();
}

export function unregisterPhantomMouseGuard(): void {
    registered = false;
    releaseAll();
}

export function setPhantomMouseGuardGameMode(on: boolean): void {
    if (on === gameMode) {
        return;
    }
    gameMode = on;
    if (!on) {
        releaseAll();
        return;
    }
    findTries = 0;
    tryGuard();
}
