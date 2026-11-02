import type { MultiplayerMode, MultiplayerTab, MultiplayerWhere } from "../types";

type Choices = {
    tab: MultiplayerMode;
    gameId: number | null;
    hardcore: boolean;
    share: boolean;
    watch: boolean;
    seats: number;
    status: string;
    where: MultiplayerWhere;
    core: string;
    coreFor: number | null;
    page: MultiplayerTab;
    conversation: string | null;
    invite: { id: string; at: number } | null;
};

const INVITE_FRESH_MS = 30000;

const choices: Choices = {
    tab: "link",
    gameId: null,
    hardcore: false,
    share: false,
    watch: false,
    seats: 4,
    status: "",
    where: "local",
    core: "",
    coreFor: null,
    page: "play",
    conversation: null,
    invite: null
};

export function multiplayerChoices(): Readonly<Choices> {
    return choices;
}

export function rememberMultiplayerTab(tab: MultiplayerMode) {
    choices.tab = tab;
}

export function rememberMultiplayerGame(gameId: number | null) {
    choices.gameId = gameId;
}

export function rememberMultiplayerHardcore(value: boolean) {
    choices.hardcore = value;
}

export function rememberMultiplayerShare(value: boolean) {
    choices.share = value;
}

export function rememberMultiplayerWatch(value: boolean) {
    choices.watch = value;
}

export function rememberMultiplayerCore(gameId: number | null, core: string) {
    choices.core = core;
    choices.coreFor = gameId;
}

export function multiplayerCoreFor(gameId: number | null): string {
    return choices.coreFor === gameId ? choices.core : "";
}

export function rememberMultiplayerHostPicks(seats: number, status: string, where: MultiplayerWhere) {
    choices.seats = seats;
    choices.status = status;
    choices.where = where;
}

export function forgetMultiplayerRoomChoices() {
    choices.hardcore = false;
}

export function rememberMultiplayerPage(page: MultiplayerTab, conversation: string | null = null) {
    choices.page = page;
    choices.conversation = page === "friends" ? conversation : null;
}

export function rememberMultiplayerInvite(invite: string | null) {
    choices.invite = invite ? { id: invite, at: Date.now() } : null;
}

export function takeMultiplayerInvite(): string | null {
    const invite = choices.invite;
    choices.invite = null;
    return invite && Date.now() - invite.at < INVITE_FRESH_MS ? invite.id : null;
}
