import type {
    GameOverviewIdentity,
    MultiplayerAccess,
    MultiplayerLoungeGame,
    MultiplayerMode,
    MultiplayerRoomFilter,
    MultiplayerRoomTab,
    MultiplayerSource,
    MultiplayerTab,
    MultiplayerWhere
} from "../types";

type Choices = {
    tab: MultiplayerMode;
    gameId: number | null;
    hardcore: boolean;
    share: boolean;
    watch: boolean;
    voice: boolean;
    seats: number;
    status: string;
    where: MultiplayerWhere;
    access: MultiplayerAccess;
    filter: MultiplayerRoomFilter;
    page: MultiplayerTab;
    roomTab: { room: string; tab: MultiplayerRoomTab };
    loungeGame: MultiplayerLoungeGame;
    invite: { id: string; at: number } | null;
    message: { friend: string; id: string; at: number } | null;
    source: MultiplayerSource;
    overview: GameOverviewIdentity | null;
};

const INVITE_FRESH_MS = 30000;

export const NO_ROOM_FILTER: MultiplayerRoomFilter = { game: "", mode: "", kind: "", access: "", where: "", seats: "" };

const choices: Choices = {
    tab: "link",
    gameId: null,
    hardcore: false,
    share: false,
    watch: false,
    voice: false,
    seats: 4,
    status: "",
    where: "local",
    access: "public",
    filter: NO_ROOM_FILTER,
    page: "play",
    roomTab: { room: "", tab: "room" },
    loungeGame: "ttt",
    invite: null,
    message: null,
    source: "achievements",
    overview: null
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

export function rememberMultiplayerVoice(value: boolean) {
    choices.voice = value;
}

export function rememberMultiplayerHostPicks(seats: number, status: string, where: MultiplayerWhere,
    access: MultiplayerAccess) {
    choices.seats = seats;
    choices.status = status;
    choices.where = where;
    choices.access = access;
}

export function rememberMultiplayerRoomFilter(filter: MultiplayerRoomFilter) {
    choices.filter = filter;
}

export function forgetMultiplayerRoomChoices() {
    choices.hardcore = false;
}

export function rememberMultiplayerSource(source: MultiplayerSource) {
    choices.source = source;
}

export function rememberMultiplayerOverview(overview: GameOverviewIdentity | null) {
    choices.overview = overview;
}

export function rememberMultiplayerPage(page: MultiplayerTab) {
    choices.page = page;
}

export function rememberMultiplayerRoomTab(room: string, tab: MultiplayerRoomTab) {
    choices.roomTab = { room, tab };
}

export function rememberMultiplayerLoungeGame(game: MultiplayerLoungeGame) {
    choices.loungeGame = game;
}

export function rememberMultiplayerInvite(invite: string | null) {
    choices.invite = invite ? { id: invite, at: Date.now() } : null;
}

export function takeMultiplayerInvite(): string | null {
    const invite = choices.invite;
    choices.invite = null;
    return invite && Date.now() - invite.at < INVITE_FRESH_MS ? invite.id : null;
}

export function rememberMultiplayerMessage(message: { friend: string; id: string } | null) {
    choices.message = message ? { ...message, at: Date.now() } : null;
}

export function takeMultiplayerMessage(): { friend: string; id: string } | null {
    const message = choices.message;
    choices.message = null;
    return message && Date.now() - message.at < INVITE_FRESH_MS ? { friend: message.friend, id: message.id } : null;
}
