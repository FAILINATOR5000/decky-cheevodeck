import { addEventListener, removeEventListener, toaster } from "@decky/api";
import { Router } from "@decky/ui";
import { useSyncExternalStore } from "react";

import { multiplayerCloseRoom, multiplayerLeave, multiplayerRoomStatus, multiplayerSetReady } from "../api";
import { getCurrentLanguage, t } from "../locales";
import type { MultiplayerRoomStatus } from "../types";
import { logError } from "./errors";
import { playReady, playTick, playUnready } from "./lobbySounds";
import { quickAccessIsHidden } from "./quickAccess";
import { forgetMultiplayerRoomChoices } from "./multiplayerChoices";

const ROOM_EVENT = "multiplayer_room";

type SeatFlag = { name: string; ready: boolean };
type ChatLine = { seq: number; name: string; text: string };
type RoomVoice = { room: string; game: number; where: string; access: string; cfg: string; seats: ({ vc: boolean; vs: number } | null)[] };

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
    chat: ChatLine | null;
    autostart: { room: string; round: number; appid: number; steps: string; game: string } | null;
    voice: RoomVoice | null;
};

type RoomEvent = Partial<MultiplayerRoomMarker> & { seq?: number };

const EMPTY: MultiplayerRoomMarker = {
    role: null, title: "", host: "", seated: 0, error: "", seat: 0, ready: false, seats: [], rev: 0, round: 0, state: "lobby",
    chat: null, autostart: null, voice: null
};

let marker: MultiplayerRoomMarker = EMPTY;
let seq = -1;
let pressed: boolean | null = null;
let seatedAt = 0;

const CHAT_SETTLE_MS = 5000;
const listeners = new Set<() => void>();

function publish(next: MultiplayerRoomMarker, at: number, heard: boolean) {
    if (at < seq) {
        return;
    }
    seq = at;
    if (next.role !== marker.role) {
        seatedAt = Date.now();
    }
    if (heard) {
        chime(marker, next);
        chatter(marker, next);
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

function chatter(before: MultiplayerRoomMarker, after: MultiplayerRoomMarker) {
    const line = after.chat;
    if (!line || before.role === null || before.role !== after.role || (before.chat?.seq ?? 0) >= line.seq) {
        return;
    }
    const own = after.role === "host" ? after.host : after.seats[after.seat]?.name ?? "";
    if (line.name === own || Number(Router.MainRunningApp?.appid ?? 0) > 0 || Date.now() - seatedAt < CHAT_SETTLE_MS) {
        return;
    }
    playTick();
    if (quickAccessIsHidden()) {
        toaster.toast({ title: t(getCurrentLanguage(), "Room Chat"), body: `${line.name}: ${line.text}` });
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
        chat: payload.chat && typeof payload.chat.seq === "number" ? payload.chat : null,
        autostart: payload.autostart && typeof payload.autostart.appid === "number" ? payload.autostart : null,
        voice: readVoice(payload.voice)
    }, Number(payload.seq) || 0, true);
}

function readVoice(raw: unknown): RoomVoice | null {
    const voice = raw as RoomVoice | null | undefined;
    if (!voice || typeof voice.room !== "string" || !Array.isArray(voice.seats)) {
        return null;
    }
    return {
        room: voice.room,
        game: typeof voice.game === "number" ? voice.game : 0,
        where: voice.where === "online" ? "online" : "local",
        access: typeof voice.access === "string" ? voice.access : "public",
        cfg: typeof voice.cfg === "string" ? voice.cfg : "",
        seats: voice.seats.map((seat) => (seat && typeof seat.vs === "number" ? { vc: seat.vc === true, vs: seat.vs } : null))
    };
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
            state: room.state,
            chat: room.chat[room.chat.length - 1] ?? null,
            voice: readVoice(status.voice)
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
            chat: status.chat[status.chat.length - 1] ?? null,
            autostart: status.autostart,
            voice: readVoice(status.voice)
        };
    }
    return EMPTY;
}

export function multiplayerRoomMarker(): MultiplayerRoomMarker {
    return marker;
}

export async function pressMultiplayerReady(ready: boolean, reason = "", tone = true) {
    if (!reason && tone) {
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
