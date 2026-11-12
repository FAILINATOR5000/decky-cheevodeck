import { addEventListener, removeEventListener, toaster } from "@decky/api";
import { Router } from "@decky/ui";
import { useSyncExternalStore } from "react";

import { multiplayerCloseRoom, multiplayerLeave, multiplayerRoomStatus, multiplayerSetReady, saveMpChatToastsInGame } from "../api";
import { getCurrentLanguage, t } from "../locales";
import type { MultiplayerLounge, MultiplayerRoomStatus, MultiplayerVote } from "../types";
import { logError } from "./errors";
import { fixWindowOpen } from "./fixPlan";
import { showToastAfter } from "./delayedToast";
import { playReady, playTick, playUnready } from "./lobbySounds";
import { PRESS_TOAST_DELAY_MS } from "./navSound";
import { quickAccessIsHidden } from "./quickAccess";
import { forgetMultiplayerRoomChoices, forgetMultiplayerRoomTab } from "./multiplayerChoices";

const ROOM_EVENT = "multiplayer_room";

type SeatFlag = { name: string; ready: boolean };
type ChatLine = { seq: number; name: string; text: string };
type RoomVoice = { room: string; game: number; where: string; access: string; cfg: string; seats: ({ vc: boolean; vs: number } | null)[] };

type VoteMarker = { id: number; kind: string; open: boolean; ended: string; game: string; voted: boolean };
type BoardMarker = { match: number; opener: number; openerName: string; end: string; winnerName: string };
type LoungeMarker = { ttt: BoardMarker; c4: BoardMarker; rev: BoardMarker };

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
    chatBacklog: number;
    autostart: { room: string; round: number; appid: number; steps: string; game: string } | null;
    voice: RoomVoice | null;
    roomVoice: boolean;
    gameId: number;
    imageIcon: string;
    size: number;
    taken: number;
    own: { gameId: number; title: string; imageIcon: string } | null;
    vote: VoteMarker | null;
    lounge: LoungeMarker | null;
};

type RoomEvent = Partial<MultiplayerRoomMarker> & { seq?: number };

const EMPTY: MultiplayerRoomMarker = {
    role: null, title: "", host: "", seated: 0, error: "", seat: 0, ready: false, seats: [], rev: 0, round: 0, state: "lobby",
    chat: null, chatBacklog: -1, autostart: null, voice: null, roomVoice: false, gameId: 0, imageIcon: "", size: 0, taken: 0, own: null,
    vote: null, lounge: null
};

let marker: MultiplayerRoomMarker = EMPTY;
let seq = -1;
let pressed: boolean | null = null;
let seatedAt = 0;

const CHAT_SETTLE_MS = 5000;
const listeners = new Set<() => void>();
let chatToastsInGame = false;
const chatToastListeners = new Set<() => void>();

function publishChatToasts(next: boolean) {
    if (next === chatToastsInGame) {
        return;
    }
    chatToastsInGame = next;
    for (const listener of chatToastListeners) {
        listener();
    }
}

export function setChatToastSettings(next: { mpChatToastsInGame?: boolean }) {
    publishChatToasts(next.mpChatToastsInGame ?? chatToastsInGame);
}

export function useChatToastsInGame(): boolean {
    return useSyncExternalStore((listener) => {
        chatToastListeners.add(listener);
        return () => {
            chatToastListeners.delete(listener);
        };
    }, () => chatToastsInGame);
}

export async function changeChatToastsInGame(next: boolean) {
    const was = chatToastsInGame;
    publishChatToasts(next);
    try {
        const saved = await saveMpChatToastsInGame(next);
        publishChatToasts(saved.mpChatToastsInGame);
    }
    catch (e) {
        logError("room chat: saving In-Game Chat Toasts", e);
        publishChatToasts(was);
    }
}

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
        announceGames(marker, next);
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
    const old = after.chatBacklog >= 0 ? line.seq <= after.chatBacklog : Date.now() - seatedAt < CHAT_SETTLE_MS;
    const playing = Number(Router.MainRunningApp?.appid ?? 0) > 0;
    if (line.name === own || old || (playing && !chatToastsInGame)) {
        return;
    }
    if (playing || quickAccessIsHidden()) {
        toaster.toast({ title: t(getCurrentLanguage(), "Room Chat"), body: `${line.name}: ${line.text}` });
    }
    else {
        playTick();
    }
}

const LOUNGE_NAMES: Record<keyof LoungeMarker, string> = { ttt: "Tic-tac-toe", c4: "Connect Four", rev: "Reversi" };

function toast(titleKey: string, lineKey: string, vars: Record<string, string>) {
    const language = getCurrentLanguage();
    showToastAfter({ title: t(language, titleKey), body: t(language, lineKey, vars) }, PRESS_TOAST_DELAY_MS);
}

function announceGames(before: MultiplayerRoomMarker, after: MultiplayerRoomMarker) {
    if (
        before.role === null || before.role !== after.role || Date.now() - seatedAt < CHAT_SETTLE_MS
        || Number(Router.MainRunningApp?.appid ?? 0) > 0 || fixWindowOpen()
    ) {
        return;
    }
    const vote = after.vote;
    const was = before.vote;
    if (vote) {
        const fresh = was?.id !== vote.id;
        if (vote.kind === "vote" && vote.open && fresh && after.role === "guest") {
            toast("Game Vote Started", "Place your vote now.", {});
        }
        if (vote.ended === "won" && vote.game && (fresh || was?.ended !== "won")) {
            if (vote.kind === "vote") {
                toast("Vote Results", "{{game}} wins.", { game: vote.game });
            }
            else {
                toast("Random Pick", "{{game}} was chosen.", { game: vote.game });
            }
        }
    }
    if (!after.lounge || !before.lounge) {
        return;
    }
    const ownSeat = after.role === "host" ? 0 : after.seat;
    const language = getCurrentLanguage();
    for (const name of ["ttt", "c4", "rev"] as const) {
        const board = after.lounge[name];
        const prior = before.lounge[name];
        const game = t(language, LOUNGE_NAMES[name]);
        if (board.match > prior.match && board.opener >= 0 && board.opener !== ownSeat) {
            toast("Lounge Play", "{{name}} started {{game}}.", { name: board.openerName, game });
        }
        if (board.end && (board.match !== prior.match || board.end !== prior.end)) {
            if (board.end === "win") {
                toast("Lounge Play", "{{name}} won {{game}}.", { name: board.winnerName, game });
            }
            else {
                toast("Lounge Play", "{{game}} ended in a draw.", { game });
            }
        }
    }
}

function readVoteMarker(raw: unknown): VoteMarker | null {
    const vote = raw as VoteMarker | null | undefined;
    if (!vote || typeof vote.id !== "number") {
        return null;
    }
    return { id: vote.id, kind: String(vote.kind), open: vote.open === true, ended: String(vote.ended ?? ""),
        game: typeof vote.game === "string" ? vote.game : "", voted: vote.voted === true };
}

function readBoardMarker(raw: unknown): BoardMarker | null {
    const board = raw as BoardMarker | null | undefined;
    if (!board || typeof board.match !== "number") {
        return null;
    }
    return { match: board.match, opener: Number(board.opener ?? -1), openerName: String(board.openerName ?? ""),
        end: String(board.end ?? ""), winnerName: String(board.winnerName ?? "") };
}

function readLoungeMarker(raw: unknown): LoungeMarker | null {
    const lounge = raw as { ttt?: unknown; c4?: unknown; rev?: unknown } | null | undefined;
    const ttt = readBoardMarker(lounge?.ttt);
    const c4 = readBoardMarker(lounge?.c4);
    const rev = readBoardMarker(lounge?.rev);
    return ttt && c4 && rev ? { ttt, c4, rev } : null;
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
        chatBacklog: typeof payload.chatBacklog === "number" ? payload.chatBacklog : -1,
        autostart: payload.autostart && typeof payload.autostart.appid === "number" ? payload.autostart : null,
        voice: readVoice(payload.voice),
        roomVoice: payload.roomVoice === true,
        gameId: Number(payload.gameId) || 0,
        imageIcon: typeof payload.imageIcon === "string" ? payload.imageIcon : "",
        size: Number(payload.size) || 0,
        taken: Number(payload.taken) || 0,
        own: payload.own && typeof payload.own.gameId === "number" ? payload.own : null,
        vote: readVoteMarker(payload.vote),
        lounge: readLoungeMarker(payload.lounge)
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

function voteMarkerOf(vote: MultiplayerVote | null | undefined): VoteMarker | null {
    if (!vote) {
        return null;
    }
    return { id: vote.id, kind: vote.kind, open: vote.open, ended: vote.ended,
        game: vote.ended === "won" ? vote.games[vote.winner]?.title ?? "" : "", voted: vote.mine >= 0 };
}

function loungeMarkerOf(lounge: MultiplayerLounge | null | undefined): LoungeMarker | null {
    if (!lounge) {
        return null;
    }
    const board = (game: MultiplayerLounge["ttt"]): BoardMarker => ({
        match: game.match,
        opener: game.players[0]?.seat ?? -1,
        openerName: game.players[0]?.name ?? "",
        end: game.end,
        winnerName: game.end === "win" ? game.players[game.winner]?.name ?? "" : ""
    });
    return { ttt: board(lounge.ttt), c4: board(lounge.c4), rev: board(lounge.rev) };
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
            voice: readVoice(status.voice),
            roomVoice: room.voice === true,
            vote: voteMarkerOf(room.vote),
            lounge: loungeMarkerOf(room.lounge)
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
            voice: readVoice(status.voice),
            roomVoice: status.room.voice === true,
            vote: voteMarkerOf(guest?.vote),
            lounge: loungeMarkerOf(guest?.lounge)
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
        forgetMultiplayerRoomTab();
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
