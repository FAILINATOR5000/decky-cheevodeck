import type { MultiplayerMode, MultiplayerWhere } from "../types";

type Choices = {
    tab: MultiplayerMode;
    gameId: number | null;
    hardcore: boolean;
    share: boolean;
    seats: number;
    status: string;
    where: MultiplayerWhere;
    core: string;
    coreFor: number | null;
};

const choices: Choices = {
    tab: "link",
    gameId: null,
    hardcore: false,
    share: false,
    seats: 4,
    status: "",
    where: "local",
    core: "",
    coreFor: null
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
