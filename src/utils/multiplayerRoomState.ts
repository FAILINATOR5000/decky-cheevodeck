import { addEventListener, removeEventListener } from "@decky/api";
import { useSyncExternalStore } from "react";

import { multiplayerCloseRoom, multiplayerLeave, multiplayerRoomStatus } from "../api";
import type { MultiplayerRoomStatus } from "../types";
import { logError } from "./errors";
import { forgetMultiplayerRoomChoices } from "./multiplayerChoices";

const ROOM_EVENT = "multiplayer_room";

export type MultiplayerRoomMarker = {
    role: "host" | "guest" | null;
    title: string;
    host: string;
    seated: number;
    error: string;
};

type RoomEvent = Partial<MultiplayerRoomMarker> & { seq?: number };

const EMPTY: MultiplayerRoomMarker = { role: null, title: "", host: "", seated: 0, error: "" };

let marker: MultiplayerRoomMarker = EMPTY;
let seq = -1;
const listeners = new Set<() => void>();

function publish(next: MultiplayerRoomMarker, at: number) {
    if (at < seq) {
        return;
    }
    seq = at;
    marker = next;
    for (const listener of listeners) {
        listener();
    }
}

function onRoomEvent(payload: RoomEvent) {
    if (!payload) {
        return;
    }
    const role = payload.role === "host" || payload.role === "guest" ? payload.role : null;
    publish({
        role,
        title: payload.title ?? "",
        host: payload.host ?? "",
        seated: Number(payload.seated) || 0,
        error: payload.error ?? ""
    }, Number(payload.seq) || 0);
}

function fromStatus(status: MultiplayerRoomStatus): MultiplayerRoomMarker {
    if (status.role === "host") {
        return { role: "host", title: status.room.title, host: "", seated: status.room.seats.filter((seat, index) => index > 0 && seat).length, error: "" };
    }
    if (status.role === "guest") {
        return { role: "guest", title: status.room.title, host: status.room.user, seated: 0, error: status.error };
    }
    return EMPTY;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useMultiplayerRoomRole(): MultiplayerRoomMarker["role"] {
    return useSyncExternalStore(subscribe, () => marker.role);
}

export function useMultiplayerRoomMarker(): MultiplayerRoomMarker {
    return useSyncExternalStore(subscribe, () => marker);
}

export async function endMultiplayerRoom() {
    try {
        if (marker.role === "host") {
            await multiplayerCloseRoom();
            forgetMultiplayerRoomChoices();
        }
        else if (marker.role === "guest") {
            await multiplayerLeave();
        }
    }
    catch (e) {
        logError("multiplayer: ending the room from the notifications", e);
    }
}

export function registerMultiplayerRoomState() {
    addEventListener(ROOM_EVENT, onRoomEvent);
    void (async () => {
        try {
            const status = await multiplayerRoomStatus();
            publish(fromStatus(status), Number(status.seq) || 0);
        }
        catch (e) {
            logError("multiplayer: reading the room at load", e);
        }
    })();
}

export function unregisterMultiplayerRoomState() {
    removeEventListener(ROOM_EVENT, onRoomEvent);
    marker = EMPTY;
    seq = -1;
}
