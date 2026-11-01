import { addEventListener, removeEventListener } from "@decky/api";
import { Router } from "@decky/ui";
import { useSyncExternalStore } from "react";

import { multiplayerCloseRoom, multiplayerLeave, multiplayerRoomStatus, multiplayerSetReady } from "../api";
import type { MultiplayerRoomStatus } from "../types";
import { logError } from "./errors";
import { playReady, playUnready } from "./lobbySounds";
import { forgetMultiplayerRoomChoices } from "./multiplayerChoices";

const ROOM_EVENT = "multiplayer_room";

type SeatFlag = { name: string; ready: boolean };

export type MultiplayerRoomMarker = {
    role: "host" | "guest" | null;
    title: string;
    host: string;
    seated: number;
    error: string;
    seat: number;
    ready: boolean;
    seats: SeatFlag[];
    rev: number;
    round: number;
    state: string;
    autostart: { room: string; round: number; appid: number } | null;
};

type RoomEvent = Partial<MultiplayerRoomMarker> & { seq?: number };

const EMPTY: MultiplayerRoomMarker = {
    role: null, title: "", host: "", seated: 0, error: "", seat: 0, ready: false, seats: [], rev: 0, round: 0, state: "lobby",
    autostart: null
};

let marker: MultiplayerRoomMarker = EMPTY;
let seq = -1;
let pressed: boolean | null = null;
const listeners = new Set<() => void>();

function publish(next: MultiplayerRoomMarker, at: number, heard: boolean) {
    if (at < seq) {
        return;
    }
    seq = at;
    if (heard) {
        chime(marker, next);
    }
    marker = next;
    for (const listener of listeners) {
        listener();
    }
}

function chime(before: MultiplayerRoomMarker, after: MultiplayerRoomMarker) {
    if (
        before.role === null || before.role !== after.role
        || before.rev !== after.rev || before.round !== after.round
        || before.state !== "lobby" || after.state !== "lobby"
        || Number(Router.MainRunningApp?.appid ?? 0) > 0
    ) {
        return;
    }
    let up = false;
    let down = false;
    after.seats.forEach((seat, index) => {
        const was = before.seats[index];
        if (index === 0 || !was || was.name !== seat.name || was.ready === seat.ready) {
            return;
        }
        if (after.role === "guest" && index === after.seat && pressed === seat.ready) {
            pressed = null;
            return;
        }
        if (seat.ready) {
            up = true;
        }
        else {
            down = true;
        }
    });
    if (up) {
        playReady();
    }
    else if (down) {
        playUnready();
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
        error: payload.error ?? "",
        seat: Number(payload.seat) || 0,
        ready: payload.ready === true,
        seats: Array.isArray(payload.seats) ? payload.seats : [],
        rev: Number(payload.rev) || 0,
        round: Number(payload.round) || 0,
        state: payload.state ?? "lobby",
        autostart: payload.autostart && typeof payload.autostart.appid === "number" ? payload.autostart : null
    }, Number(payload.seq) || 0, true);
}

function fromStatus(status: MultiplayerRoomStatus): MultiplayerRoomMarker {
    if (status.role === "host") {
        const room = status.room;
        return {
            ...EMPTY,
            role: "host",
            title: room.title,
            seated: room.seats.filter((seat, index) => index > 0 && seat).length,
            seats: room.seats.map((seat) => ({ name: seat?.name ?? "", ready: seat?.ready ?? false })),
            rev: room.rev,
            round: room.round,
            state: room.state
        };
    }
    if (status.role === "guest") {
        const guest = status.status;
        return {
            ...EMPTY,
            role: "guest",
            title: status.room.title,
            host: status.room.user,
            error: status.error,
            seat: status.seat,
            ready: status.ready,
            seats: (guest?.members ?? []).map((name, index) => ({ name, ready: guest?.seats[index]?.ready ?? false })),
            rev: guest?.rev ?? 0,
            round: guest?.round ?? 0,
            state: guest?.state ?? "lobby",
            autostart: status.autostart
        };
    }
    return EMPTY;
}

export function multiplayerRoomMarker(): MultiplayerRoomMarker {
    return marker;
}

export async function pressMultiplayerReady(ready: boolean, reason = "") {
    if (!reason) {
        pressed = ready;
        if (ready) {
            playReady();
        }
        else {
            playUnready();
        }
    }
    try {
        return await multiplayerSetReady(ready, reason);
    }
    catch (e) {
        logError("multiplayerSetReady", e);
        return { ok: false, error: "unavailable" };
    }
}

export function subscribeMultiplayerRoom(listener: () => void): () => void {
    return subscribe(listener);
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
            publish(fromStatus(status), Number(status.seq) || 0, false);
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
