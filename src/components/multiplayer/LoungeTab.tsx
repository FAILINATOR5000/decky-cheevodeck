import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { multiplayerLounge } from "../../api";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerLounge, MultiplayerLoungeBoard, MultiplayerLoungeGame } from "../../types";
import { playDrop, playMark, playTick } from "../../utils/lobbySounds";
import { logError } from "../../utils/errors";
import { roomGameWhy } from "../../utils/multiplayerProblems";
import { forgetNavAxisMemory, type NavAxisRef } from "../../utils/navAxisMemory";
import { achievementGreen, bodyTextStyle } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { SubTabButton } from "../ui/SubTabButton";
import { PicAvatar } from "./PicAvatar";
import { showMultiplayerProblem } from "./ProblemModal";

const NAV_ENTER_MAINTAIN_Y = 3;
const C4_COLUMNS = 7;
const SLOT_COLORS = ["#ef4444", "#facc15", "#3b82f6", "#22c55e"];

const GAMES: { game: MultiplayerLoungeGame; labelKey: string }[] = [
    { game: "ttt", labelKey: "Tic-tac-toe" },
    { game: "c4", labelKey: "Connect Four" }
];

function cellKey(game: MultiplayerLoungeGame, index: number): string {
    const columns = game === "ttt" ? 3 : C4_COLUMNS;
    return `lounge:${game}:${Math.floor(index / columns)}:${index % columns}`;
}

function activeSlot(board: MultiplayerLoungeBoard, seat: number): number {
    return board.players.findIndex((player) => player.seat === seat && !player.gone);
}

type PiecePlayer = { name: string; pic: string; gone: boolean };

function Piece(props: { player: PiecePlayer | undefined; slot: number; size: number; ring: boolean; avatars: Record<string, string> }) {
    const { player } = props;
    if (!player) {
        return null;
    }
    return (
        <div
            style={{
                borderRadius: "8px",
                padding: "2px",
                background: props.ring ? SLOT_COLORS[props.slot] : undefined,
                opacity: player.gone ? 0.6 : 1
            }}
        >
            <PicAvatar uri={player.pic ? props.avatars[player.pic] : undefined} name={player.name} size={props.size} />
        </div>
    );
}

type Pending = { game: MultiplayerLoungeGame; index: number; slot: number; board: string; match: number };

function landing(board: string, column: number): number {
    for (let index = board.length - C4_COLUMNS + column; index >= 0; index -= C4_COLUMNS) {
        if (board[index] === ".") {
            return index;
        }
    }
    return -1;
}

export function LoungeTab(props: {
    language: LanguageCode;
    lounge: MultiplayerLounge;
    ownSeat: number;
    game: MultiplayerLoungeGame;
    avatars: Record<string, string>;
    self: { name: string; pic: string };
    buttonStyle: React.CSSProperties;
    exitKey: string;
    onGame: (game: MultiplayerLoungeGame) => void;
}) {
    const { language, lounge, ownSeat, game } = props;
    const board = lounge[game];
    const navRef = useRef(null) as NavAxisRef;
    const pressing = useRef(false);
    const [pending, setPending] = useState<Pending | null>(null);
    useEffect(() => {
        setPending(null);
    }, [game, board.board, board.match]);
    const gameKey = game === "ttt" ? "Tic-tac-toe" : "Connect Four";
    const mine = activeSlot(board, ownSeat);
    const started = game === "ttt" ? board.players.length === 2 : Boolean(board.started);
    const turnName = board.players[board.turn]?.name ?? "";

    function explain(code: string, vars?: Record<string, string>) {
        showMultiplayerProblem(language, gameKey, roomGameWhy(language, code, vars));
    }

    async function send(act: "move" | "start" | "clear", cell: number, titleKey: string): Promise<boolean> {
        if (pressing.current) {
            return false;
        }
        pressing.current = true;
        try {
            const result = await multiplayerLounge(game, act, cell);
            if (!result.ok) {
                showMultiplayerProblem(language, titleKey, roomGameWhy(language, result.error ?? "unavailable", { name: turnName }));
            }
            return result.ok;
        }
        catch (e) {
            logError("multiplayer: a Lounge press", e);
            return false;
        }
        finally {
            pressing.current = false;
        }
    }

    function place(cell: number, index: number, slot: number) {
        if (pressing.current) {
            return;
        }
        const placed = { game, index, slot, board: board.board, match: board.match };
        setPending(placed);
        if (game === "ttt") {
            playMark();
        }
        else {
            playDrop();
        }
        void send("move", cell, gameKey).then((ok) => {
            if (!ok) {
                setPending((current) => (current === placed ? null : current));
            }
        });
    }

    function pressCell(index: number) {
        if (board.end) {
            explain("match_over");
            return;
        }
        if (game === "ttt") {
            if (board.players.length === 1 && mine === 0) {
                explain("ttt_waiting");
                return;
            }
            if (board.players.length === 2 && mine < 0) {
                explain("ttt_two_players");
                return;
            }
            if (board.players.length === 2 && mine !== board.turn) {
                explain("not_your_turn", { name: turnName });
                return;
            }
            if (board.board[index] !== ".") {
                explain("square_taken");
                return;
            }
            place(index, index, mine >= 0 ? mine : board.players.length);
            return;
        }
        const column = index % C4_COLUMNS;
        if (!board.started) {
            const opener = board.players.find((player) => !player.gone);
            if (mine >= 0 && opener?.seat === ownSeat) {
                explain(board.players.filter((player) => !player.gone).length < 2 ? "c4_need_two" : "c4_start_ready");
                return;
            }
            if (mine >= 0) {
                explain("c4_waiting", { name: opener?.name ?? "" });
                return;
            }
            explain(board.players.length >= 4 ? "c4_full" : "c4_join");
            return;
        }
        if (mine < 0) {
            explain("c4_full");
            return;
        }
        if (mine !== board.turn) {
            explain("not_your_turn", { name: turnName });
            return;
        }
        if (board.board[column] !== ".") {
            explain("column_full");
            return;
        }
        place(column, landing(board.board, column), mine);
    }

    function toBoard() {
        navRef.current?.TakeFocus?.(true);
    }

    function pressJoin() {
        if (board.players.length >= 4) {
            showMultiplayerProblem(language, "Join Match", roomGameWhy(language, "c4_full"));
            return;
        }
        if (board.players.some((player) => !player.gone)) {
            toBoard();
        }
        playTick();
        void send("move", 0, "Join Match");
    }

    function pressStart() {
        if (board.players.filter((player) => !player.gone).length < 2) {
            showMultiplayerProblem(language, "Start Match", roomGameWhy(language, "c4_need_two"));
            return;
        }
        toBoard();
        void send("start", 0, "Start Match");
    }

    let status: string;
    if (board.end === "win") {
        status = t(language, "{{name}} won.", { name: board.players[board.winner]?.name ?? "" });
    }
    else if (board.end === "draw") {
        status = t(language, "It's a draw.");
    }
    else if (board.players.length === 0) {
        status = t(language, game === "ttt" ? "Press A on a square to start a match." : "Press “Join Match” to open a match.");
    }
    else if (!started) {
        status = game === "ttt"
            ? t(language, "Waiting for a second player.")
            : t(language, "Joined: {{names}}", { names: board.players.map((player) => player.name).join(", ") });
    }
    else {
        status = t(language, "It's {{name}}'s turn.", { name: turnName });
    }

    const opener = board.players.find((player) => !player.gone);
    const showStart = game === "c4" && !board.started && !board.end && opener?.seat === ownSeat;
    const showJoin = game === "c4" && !board.started && !board.end && mine < 0;
    const action = showJoin ? "join" : showStart ? "start" : null;
    const statusStyle: React.CSSProperties = board.end === "win"
        ? { textAlign: "center", color: achievementGreen, fontWeight: 700 }
        : { textAlign: "center" };
    const switcher = GAMES.map((entry) => `multiplayer:lounge:${entry.game}`);
    const columns = game === "ttt" ? 3 : C4_COLUMNS;
    const pieceSize = game === "ttt" ? 44 : 24;

    return (
        <>
            <Focusable flow-children="row" style={{ width: "100%", display: "flex", gap: "6px", margin: "6px 0 8px 0" }}>
                {GAMES.map((entry) => (
                    <SubTabButton
                        key={entry.game}
                        label={t(language, entry.labelKey)}
                        active={entry.game === game}
                        onClick={() => props.onGame(entry.game)}
                        focusKey={`multiplayer:lounge:${entry.game}`}
                        focusFallback={["multiplayer:roomtab:lounge", props.exitKey]}
                    />
                ))}
            </Focusable>
            <Focusable key={`multiplayer:lounge:board:${game}`} flow-children="column">
                <PanelSectionRow>
                    <Focusable
                        navRef={navRef}
                        resetNavOnEntry
                        flow-children="grid"
                        navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}
                        style={{
                            display: "grid",
                            gridTemplateColumns: `repeat(${columns}, 1fr)`,
                            gap: game === "ttt" ? "8px" : "4px",
                            width: "100%"
                        }}
                    >
                        {Array.from(board.board).map((mark, index) => {
                            const early = mark === "." && pending !== null && pending.game === game && pending.index === index
                                && pending.board === board.board && pending.match === board.match;
                            const slot = early ? pending.slot : mark === "." ? -1 : Number(mark);
                            const player = board.players[slot] ?? (early ? { ...props.self, gone: false } : undefined);
                            const lined = board.line.includes(index);
                            return (
                                <FocusTarget
                                    key={index}
                                    focusKey={cellKey(game, index)}
                                    focusFallback={[`multiplayer:lounge:${game}`, ...switcher]}
                                    style={{ display: "flex", minWidth: 0 }}
                                >
                                    <DialogButton
                                        onClick={() => pressCell(index)}
                                        onOKButton={() => {
                                            pressCell(index);
                                            return true;
                                        }}
                                        onGamepadFocus={() => forgetNavAxisMemory(navRef)}
                                        style={{
                                            minWidth: 0,
                                            width: "100%",
                                            aspectRatio: "1",
                                            padding: 0,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            borderRadius: game === "ttt" ? "6px" : "50%",
                                            boxShadow: lined ? `0 0 0 2px ${achievementGreen}` : undefined
                                        }}
                                    >
                                        {slot >= 0 && (
                                            <Piece player={player} slot={slot} size={pieceSize} ring={game === "c4"} avatars={props.avatars} />
                                        )}
                                    </DialogButton>
                                </FocusTarget>
                            );
                        })}
                    </Focusable>
                </PanelSectionRow>
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), minHeight: "1.4em", opacity: 1, overflowWrap: "anywhere", width: "100%", ...statusStyle }}>
                        {status}
                    </div>
                </PanelSectionRow>
                {action && (
                    <PanelSectionRow>
                        <FocusableItem
                            bottomSeparator="none"
                            outerStyle={props.buttonStyle}
                            focusKey="multiplayer:lounge:action"
                            focusFallback={[cellKey(game, 38), `multiplayer:lounge:clear:${game}`, `multiplayer:lounge:${game}`]}
                            onClick={action === "join" ? pressJoin : pressStart}
                        >
                            {t(language, action === "join" ? "Join Match" : "Start Match")}
                        </FocusableItem>
                    </PanelSectionRow>
                )}
                <PanelSectionRow>
                    <FocusableItem
                        bottomSeparator="none"
                        outerStyle={props.buttonStyle}
                        focusKey={`multiplayer:lounge:clear:${game}`}
                        focusFallback={[`multiplayer:lounge:${game}`, props.exitKey]}
                        onClick={() => void send("clear", 0, "Clear")}
                    >
                        {t(language, "Clear")}
                    </FocusableItem>
                </PanelSectionRow>
            </Focusable>
        </>
    );
}
