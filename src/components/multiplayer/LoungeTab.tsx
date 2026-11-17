import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { multiplayerLounge } from "../../api";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerLounge, MultiplayerLoungeBoard, MultiplayerLoungeGame } from "../../types";
import { CHK_SIDE, chkMoves, chkPath } from "../../utils/checkersRules";
import { playDrop, playDropOther, playFlip, playFlipOther, playMark, playMarkOther, playSlide, playSlideOther, playTick } from "../../utils/lobbySounds";
import { logError } from "../../utils/errors";
import { roomGameWhy } from "../../utils/multiplayerProblems";
import { forgetNavAxisMemory, type NavAxisRef } from "../../utils/navAxisMemory";
import { achievementGreen, bodyTextStyle } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { SubTabButton } from "../ui/SubTabButton";
import { PicAvatar } from "./PicAvatar";
import { showMultiplayerProblem } from "./ProblemModal";

const NAV_ENTER_MAINTAIN_X = 2;
const NAV_ENTER_MAINTAIN_Y = 3;
const C4_COLUMNS = 7;
const REV_SIDE = 8;
const SLOT_COLORS = ["#ef4444", "#facc15", "#3b82f6", "#22c55e"];

const NAMES: Record<MultiplayerLoungeGame, string> = { ttt: "Tic-tac-toe", c4: "Connect Four", rev: "Reversi", chk: "Checkers" };
const COLUMNS: Record<MultiplayerLoungeGame, number> = { ttt: 3, c4: C4_COLUMNS, rev: REV_SIDE, chk: CHK_SIDE };
const ROWS: MultiplayerLoungeGame[][] = [["ttt", "c4"], ["rev", "chk"]];
const SWITCHER = ROWS.flat().map((game) => `multiplayer:lounge:${game}`);
const REV_DIRECTIONS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

const CHK_STYLES = `
.da-chk-dark:not(.gpfocus) { background: #111111 !important; }
.da-chk-light:not(.gpfocus) { background: #9b1c1c !important; }
.da-chk-picked:not(.gpfocus) { background: #2a2a2a !important; box-shadow: inset 0 0 0 2px #fff !important; }
.da-chk-picked.gpfocus { box-shadow: inset 0 0 0 2px #fff, inset 0 0 0 4px #111111 !important; }
.da-chk-path { box-shadow: inset 0 0 0 2px ${achievementGreen} !important; }
.da-chk-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255, 255, 255, 0.45); }
.gpfocus .da-chk-dot { background: rgba(0, 0, 0, 0.45); }
`;

function cellKey(game: MultiplayerLoungeGame, index: number): string {
    const columns = COLUMNS[game];
    return `lounge:${game}:${Math.floor(index / columns)}:${index % columns}`;
}

function revFlips(board: string, slot: number, cell: number): number[] {
    if (board[cell] !== ".") {
        return [];
    }
    const mine = String(slot);
    const theirs = String(1 - slot);
    const row = Math.floor(cell / REV_SIDE);
    const column = cell % REV_SIDE;
    const flips: number[] = [];
    for (const [dRow, dColumn] of REV_DIRECTIONS) {
        const run: number[] = [];
        let r = row + dRow;
        let c = column + dColumn;
        while (r >= 0 && r < REV_SIDE && c >= 0 && c < REV_SIDE && board[r * REV_SIDE + c] === theirs) {
            run.push(r * REV_SIDE + c);
            r += dRow;
            c += dColumn;
        }
        if (run.length > 0 && r >= 0 && r < REV_SIDE && c >= 0 && c < REV_SIDE && board[r * REV_SIDE + c] === mine) {
            flips.push(...run);
        }
    }
    return flips;
}

function discCount(board: string, slot: number): number {
    return Array.from(board).filter((mark) => mark !== "." && Number(mark) % 2 === slot).length;
}

function activeSlot(board: MultiplayerLoungeBoard, seat: number): number {
    return board.players.findIndex((player) => player.seat === seat && !player.gone);
}

type PiecePlayer = { name: string; pic: string; gone: boolean };

function Crown() {
    return (
        <svg viewBox="0 0 12 10" width={12} height={10} style={{ position: "absolute", top: 0, right: 0, pointerEvents: "none" }}>
            <path d="M1 3 L3.5 5.5 L6 1 L8.5 5.5 L11 3 L10 8 L2 8 Z" fill="#facc15" stroke="#7a5a00" strokeWidth={0.8} />
            <rect x={2} y={8} width={8} height={1.6} fill="#facc15" stroke="#7a5a00" strokeWidth={0.6} />
        </svg>
    );
}

function Piece(props: {
    player: PiecePlayer | undefined;
    slot: number;
    size: number;
    ring: boolean;
    king?: boolean;
    avatars: Record<string, string>;
}) {
    const { player } = props;
    if (!player) {
        return props.ring
            ? (
                <div style={{ position: "relative", width: props.size + 4, height: props.size + 4, borderRadius: "8px", background: SLOT_COLORS[props.slot] }}>
                    {props.king && <Crown />}
                </div>
            )
            : null;
    }
    return (
        <div
            style={{
                position: "relative",
                borderRadius: "8px",
                padding: "2px",
                background: props.ring ? SLOT_COLORS[props.slot] : undefined,
                opacity: player.gone ? 0.6 : 1
            }}
        >
            <PicAvatar uri={player.pic ? props.avatars[player.pic] : undefined} name={player.name} size={props.size} />
            {props.king && <Crown />}
        </div>
    );
}

type Pending = {
    game: MultiplayerLoungeGame;
    index: number;
    slot: number;
    board: string;
    match: number;
    from?: number;
    captured?: number[];
    king?: boolean;
};

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
    const board = lounge[game]!;
    const navRef = useRef(null) as NavAxisRef;
    const pressing = useRef(false);
    const [pending, setPending] = useState<Pending | null>(null);
    const [selected, setSelected] = useState<number | null>(null);
    useEffect(() => {
        setPending(null);
        setSelected(null);
    }, [game, board.board, board.match]);
    const gameKey = NAMES[game];
    const mine = activeSlot(board, ownSeat);
    const seen = useRef({ game, match: board.match, board: board.board });
    useEffect(() => {
        const before = seen.current;
        seen.current = { game, match: board.match, board: board.board };
        if (before.game !== game || (before.match !== board.match && /[^.]/.test(before.board))) {
            return;
        }
        for (let index = 0; index < board.board.length; index++) {
            const mark = board.board[index];
            const owner = game === "chk" ? Number(mark) % 2 : Number(mark);
            if (before.board[index] === "." && mark !== "." && owner !== mine) {
                if (game === "ttt") {
                    playMarkOther();
                }
                else if (game === "c4") {
                    playDropOther();
                }
                else if (game === "chk") {
                    const taken = Array.from(before.board).filter((was, cell) => was !== "." && Number(was) % 2 !== owner
                        && board.board[cell] === ".").length;
                    playSlideOther(taken);
                }
                else {
                    const flipped = Array.from(board.board).filter((after, cell) => after !== "." && before.board[cell] !== "."
                        && after !== before.board[cell]).length;
                    playFlipOther(flipped);
                }
                return;
            }
        }
    }, [game, board.board, board.match]);
    const started = game === "ttt" ? board.players.length === 2 : Boolean(board.started);
    const onAction = useRef(false);
    const [slotFor, setSlotFor] = useState({ game, started });
    useLayoutEffect(() => {
        if (slotFor.game === game && started && !slotFor.started && onAction.current) {
            toBoard();
        }
        setSlotFor({ game, started });
    }, [game, started]);
    const slotStarted = slotFor.game === game ? slotFor.started : started;
    const turnName = board.players[board.turn]?.name ?? "";
    const pairGame = game === "rev" || game === "chk";
    const myTurn = started && !board.end && mine >= 0 && mine === board.turn;
    const chain = board.chain ?? -1;
    const chkLegal = game === "chk" && myTurn ? chkMoves(board.board, mine, chain) : [];
    const picked = game !== "chk" || !myTurn || pending !== null ? null : chain >= 0 ? chain : selected;
    const flipped = game === "chk" && mine === 1;
    const squareAt = (position: number) => (flipped ? board.board.length - 1 - position : position);
    const chainRef = useRef(null) as NavAxisRef;
    const cursorAt = useRef(-1);
    useEffect(() => {
        if (game === "chk" && myTurn && chain >= 0 && cursorAt.current >= 0 && squareAt(cursorAt.current) !== chain) {
            chainRef.current?.TakeFocus?.(true);
        }
    }, [game, myTurn, chain]);

    function explain(code: string, vars?: Record<string, string>) {
        showMultiplayerProblem(language, gameKey, roomGameWhy(language, code, vars));
    }

    async function send(act: "move" | "start" | "clear" | "join", cell: number, titleKey: string, to = 0): Promise<boolean> {
        if (pressing.current) {
            return false;
        }
        pressing.current = true;
        try {
            const result = await multiplayerLounge(game, act, cell, to);
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

    function pendingAt(index: number, slot: number): Pending {
        return { game, index, slot, board: board.board, match: board.match };
    }

    function place(cell: number, placed: Pending, sound: () => void, to = 0) {
        if (pressing.current) {
            return;
        }
        setPending(placed);
        sound();
        void send("move", cell, gameKey, to).then((ok) => {
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
            place(index, pendingAt(index, mine >= 0 ? mine : board.players.length), playMark);
            return;
        }
        if (pairGame) {
            if (!board.started) {
                explain(mine >= 0 ? "c4_need_two" : "c4_join");
                return;
            }
            if (mine < 0) {
                explain("ttt_two_players");
                return;
            }
            if (mine !== board.turn) {
                explain("not_your_turn", { name: turnName });
                return;
            }
            if (game === "chk") {
                pressSquare(index);
                return;
            }
            if (board.board[index] !== ".") {
                explain("square_taken");
                return;
            }
            const flips = revFlips(board.board, mine, index);
            if (flips.length === 0) {
                explain("rev_illegal");
                return;
            }
            place(index, pendingAt(index, mine), () => playFlip(flips.length));
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
        place(column, pendingAt(landing(board.board, column), mine), playDrop);
    }

    function pressSquare(index: number) {
        if (pending !== null) {
            return;
        }
        const move = chkLegal.find((entry) => entry.from === picked && entry.to === index);
        if (move) {
            const path = chkPath(board.board, move.from, move.to);
            const placed = {
                ...pendingAt(path.landings[path.landings.length - 1], mine),
                from: move.from,
                captured: path.captured,
                king: Number(board.board[move.from]) >= 2 || path.crowned
            };
            setSelected(null);
            place(move.from, placed, () => playSlide(path.captured.length), move.to);
            return;
        }
        if (index === picked) {
            if (chain < 0) {
                setSelected(null);
                playTick();
            }
            return;
        }
        const mark = board.board[index];
        if (mark === "." || Number(mark) % 2 !== mine) {
            if (picked === null) {
                explain("chk_pick");
            }
            return;
        }
        if (chain >= 0) {
            return;
        }
        if (chkLegal.some((entry) => entry.from === index)) {
            setSelected(index);
            playTick();
            return;
        }
        if (picked === null) {
            explain(chkLegal.some((entry) => entry.captured >= 0) ? "chk_must_jump" : "chk_no_move");
        }
    }

    function toBoard() {
        navRef.current?.TakeFocus?.(true);
    }

    function pressJoin() {
        if (pairGame) {
            if (mine >= 0) {
                showMultiplayerProblem(language, "Join Match", roomGameWhy(language, "c4_need_two"));
                return;
            }
            if (board.players.length >= 2) {
                showMultiplayerProblem(language, "Join Match", roomGameWhy(language, "ttt_two_players"));
                return;
            }
            if (board.players.length === 1) {
                toBoard();
            }
            playTick();
            void send("join", 0, "Join Match");
            return;
        }
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
        status = game === "c4"
            ? t(language, "Joined: {{names}}", { names: board.players.map((player) => player.name).join(", ") })
            : t(language, "Waiting for a second player.");
    }
    else if (game === "rev" && board.passed !== undefined && board.passed >= 0) {
        status = t(language, "{{name}} has no move and passes.", { name: board.players[board.passed]?.name ?? "" });
    }
    else {
        status = t(language, "It's {{name}}'s turn.", { name: turnName });
    }
    const score = pairGame && board.players.length === 2
        ? board.players.map((player, slot) => `${player.name} ${discCount(board.board, slot)}`).join(" · ")
        : "";
    const legal = game === "rev" && board.started && !board.end && mine >= 0 && mine === board.turn && pending === null
        ? new Set(Array.from(board.board, (_, cell) => cell).filter((cell) => revFlips(board.board, mine, cell).length > 0))
        : null;

    const opener = board.players.find((player) => !player.gone);
    const showStart = game === "c4" && !board.started && !board.end && opener?.seat === ownSeat;
    const showJoin = game === "c4" ? !board.started && !board.end && mine < 0 : pairGame && !slotStarted && !board.end;
    const action = showJoin ? "join" : showStart ? "start" : null;
    useEffect(() => {
        if (!action) {
            onAction.current = false;
        }
    }, [action]);
    const statusStyle: React.CSSProperties = board.end === "win"
        ? { textAlign: "center", color: achievementGreen, fontWeight: 700 }
        : { textAlign: "center" };
    const columns = COLUMNS[game];
    const pieceSize = game === "ttt" ? 44 : game === "c4" || game === "chk" ? 24 : 22;
    const targets = picked === null ? null : new Set(chkLegal.filter((entry) => entry.from === picked).map((entry) => entry.to));
    const early = pending !== null && pending.game === game && pending.board === board.board && pending.match === board.match
        ? pending
        : null;

    return (
        <>
            {game === "chk" && <style>{CHK_STYLES}</style>}
            {ROWS.map((row) => row.filter((entry) => lounge[entry])).filter((row) => row.length > 0).map((row, rowIndex) => (
                <Focusable
                    key={rowIndex}
                    flow-children="row"
                    resetNavOnEntry
                    navEntryPreferPosition={NAV_ENTER_MAINTAIN_X}
                    style={{ width: "100%", display: "flex", gap: "6px", margin: rowIndex === 0 ? "6px 0 6px 0" : "0 0 8px 0" }}
                >
                    {row.map((entry) => (
                        <SubTabButton
                            key={entry}
                            label={t(language, NAMES[entry])}
                            active={entry === game}
                            onClick={() => props.onGame(entry)}
                            focusKey={`multiplayer:lounge:${entry}`}
                            focusFallback={["multiplayer:roomtab:lounge", props.exitKey]}
                        />
                    ))}
                </Focusable>
            ))}
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
                            gap: game === "ttt" ? "8px" : game === "c4" ? "4px" : game === "rev" ? "3px" : "0px",
                            width: "100%"
                        }}
                    >
                        {Array.from(board.board, (_, position) => {
                            const index = squareAt(position);
                            const mark = board.board[index];
                            const arriving = early !== null && mark === "." && early.index === index ? early : null;
                            const lifted = early !== null && (early.from === index || early.captured?.includes(index) === true);
                            const value = lifted ? -1 : arriving ? arriving.slot + (arriving.king ? 2 : 0) : mark === "." ? -1 : Number(mark);
                            const slot = value < 0 ? -1 : game === "chk" ? value % 2 : value;
                            const player = board.players[slot] ?? (arriving ? { ...props.self, gone: false } : undefined);
                            const lined = board.line.includes(index);
                            const square = game !== "chk" ? undefined : [
                                (Math.floor(index / CHK_SIDE) + index % CHK_SIDE) % 2 === 1 ? "da-chk-dark" : "da-chk-light",
                                index === picked ? "da-chk-picked" : "",
                                lined ? "da-chk-path" : ""
                            ].filter(Boolean).join(" ");
                            return (
                                <FocusTarget
                                    key={position}
                                    focusKey={cellKey(game, index)}
                                    focusFallback={[`multiplayer:lounge:${game}`, ...SWITCHER]}
                                    style={{ display: "flex", minWidth: 0 }}
                                >
                                    <DialogButton
                                        navRef={game === "chk" && index === chain ? chainRef : undefined}
                                        className={square}
                                        onClick={() => pressCell(index)}
                                        onOKButton={() => {
                                            pressCell(index);
                                            return true;
                                        }}
                                        onGamepadFocus={() => {
                                            cursorAt.current = position;
                                            forgetNavAxisMemory(navRef);
                                        }}
                                        onGamepadBlur={() => {
                                            if (cursorAt.current === position) {
                                                cursorAt.current = -1;
                                            }
                                        }}
                                        style={{
                                            minWidth: 0,
                                            width: "100%",
                                            aspectRatio: "1",
                                            padding: 0,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            borderRadius: game === "c4" ? "50%" : game === "ttt" ? "6px" : game === "rev" ? "4px" : 0,
                                            boxShadow: lined && game !== "chk" ? `0 0 0 2px ${achievementGreen}` : undefined
                                        }}
                                    >
                                        {slot >= 0 && (
                                            <Piece
                                                player={player}
                                                slot={slot}
                                                size={pieceSize}
                                                ring={game !== "ttt"}
                                                king={game === "chk" && value >= 2}
                                                avatars={props.avatars}
                                            />
                                        )}
                                        {slot < 0 && legal?.has(index) && (
                                            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "rgba(255,255,255,0.45)" }} />
                                        )}
                                        {slot < 0 && targets?.has(index) && <div className="da-chk-dot" />}
                                    </DialogButton>
                                </FocusTarget>
                            );
                        })}
                    </Focusable>
                </PanelSectionRow>
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), minHeight: "1.4em", opacity: 1, overflowWrap: "anywhere", width: "100%", ...statusStyle }}>
                        {status}
                        {pairGame && <div style={{ minHeight: "1.4em" }}>{score}</div>}
                    </div>
                </PanelSectionRow>
                {action && (
                    <PanelSectionRow>
                        <FocusableItem
                            bottomSeparator="none"
                            outerStyle={props.buttonStyle}
                            focusKey="multiplayer:lounge:action"
                            focusFallback={[cellKey(game, board.board.length - Math.ceil(columns / 2)), `multiplayer:lounge:clear:${game}`,
                                `multiplayer:lounge:${game}`]}
                            onGamepadFocus={() => {
                                onAction.current = true;
                            }}
                            onGamepadBlur={() => {
                                onAction.current = false;
                            }}
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
