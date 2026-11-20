import { logFocusDebug, multiplayerSetPads } from "../api";
import { logError } from "./errors";
import { multiplayerRoomMarker, subscribeMultiplayerRoom } from "./multiplayerRoomState";
import { onSteamPadListChanged, readSteamPads } from "./steamControllers";

const SETTLE_MS = 250;

let stopRoom: (() => void) | null = null;
let stopPads: (() => void) | null = null;
let timer = 0;
let sent = -1;

function follow() {
    const marker = multiplayerRoomMarker();
    const wanted = marker.role !== null && !marker.inGame;
    if (wanted === (stopPads !== null)) {
        return;
    }
    if (wanted) {
        sent = -1;
        stopPads = onSteamPadListChanged(soon);
        void readAndSend();
    }
    else {
        stopPads?.();
        stopPads = null;
        window.clearTimeout(timer);
    }
}

function soon() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void readAndSend(), SETTLE_MS);
}

async function readAndSend() {
    try {
        const pads = await readSteamPads();
        logFocusDebug("pads", "read", String(pads?.length ?? "none"));
        if (pads === null || stopPads === null || pads.length === sent) {
            return;
        }
        sent = pads.length;
        logFocusDebug("pads", "sent", String(sent));
        await multiplayerSetPads(sent);
    }
    catch (e) {
        logError("pads: reading the controllers", e);
    }
}

export function registerSeatPads() {
    stopRoom = subscribeMultiplayerRoom(follow);
    follow();
}

export function unregisterSeatPads() {
    stopRoom?.();
    stopRoom = null;
    stopPads?.();
    stopPads = null;
    window.clearTimeout(timer);
    sent = -1;
}
