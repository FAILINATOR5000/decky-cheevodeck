import type { MultiplayerMode } from "../types";

type Choices = {
    tab: MultiplayerMode;
    gameId: number | null;
    hardcore: boolean;
    private: boolean;
    core: string;
    coreFor: number | null;
};

const choices: Choices = {
    tab: "link",
    gameId: null,
    hardcore: false,
    private: false,
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

export function rememberMultiplayerPrivate(value: boolean) {
    choices.private = value;
}

export function rememberMultiplayerCore(gameId: number | null, core: string) {
    choices.core = core;
    choices.coreFor = gameId;
}

export function multiplayerCoreFor(gameId: number | null): string {
    return choices.coreFor === gameId ? choices.core : "";
}

export function forgetMultiplayerRoomChoices() {
    choices.hardcore = false;
    choices.private = false;
}
