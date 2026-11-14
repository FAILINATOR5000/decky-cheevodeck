export const CHK_SIDE = 8;

export type ChkMove = { from: number; to: number; captured: number };

export type ChkPath = { board: string; landings: number[]; captured: number[]; crowned: boolean; fork: boolean };

function value(board: string, cell: number): number {
    return board[cell] === "." ? -1 : Number(board[cell]);
}

function steps(piece: number): number[][] {
    const rows = piece >= 2 ? [-1, 1] : piece === 0 ? [-1] : [1];
    return rows.flatMap((dRow) => [[dRow, -1], [dRow, 1]]);
}

function chkContinue(board: string, cell: number): { to: number; captured: number }[] {
    const piece = value(board, cell);
    const row = Math.floor(cell / CHK_SIDE);
    const column = cell % CHK_SIDE;
    const jumps: { to: number; captured: number }[] = [];
    for (const [dRow, dColumn] of steps(piece)) {
        const landRow = row + 2 * dRow;
        const landColumn = column + 2 * dColumn;
        if (landRow < 0 || landRow >= CHK_SIDE || landColumn < 0 || landColumn >= CHK_SIDE) {
            continue;
        }
        const over = (row + dRow) * CHK_SIDE + column + dColumn;
        const landing = landRow * CHK_SIDE + landColumn;
        const jumped = value(board, over);
        if (jumped >= 0 && jumped % 2 !== piece % 2 && board[landing] === ".") {
            jumps.push({ to: landing, captured: over });
        }
    }
    return jumps;
}

export function chkMoves(board: string, slot: number, chain: number): ChkMove[] {
    if (chain >= 0) {
        return chkContinue(board, chain).map((jump) => ({ from: chain, ...jump }));
    }
    const jumps: ChkMove[] = [];
    const plain: ChkMove[] = [];
    for (let cell = 0; cell < board.length; cell++) {
        const piece = value(board, cell);
        if (piece < 0 || piece % 2 !== slot) {
            continue;
        }
        for (const jump of chkContinue(board, cell)) {
            jumps.push({ from: cell, ...jump });
        }
        const row = Math.floor(cell / CHK_SIDE);
        const column = cell % CHK_SIDE;
        for (const [dRow, dColumn] of steps(piece)) {
            const r = row + dRow;
            const c = column + dColumn;
            if (r >= 0 && r < CHK_SIDE && c >= 0 && c < CHK_SIDE && board[r * CHK_SIDE + c] === ".") {
                plain.push({ from: cell, to: r * CHK_SIDE + c, captured: -1 });
            }
        }
    }
    return jumps.length > 0 ? jumps : plain;
}

export function chkPath(start: string, from: number, to: number): ChkPath {
    const board = Array.from(start);
    let piece = value(start, from);
    const landings: number[] = [];
    const captured: number[] = [];
    let crowned = false;
    let fork = false;
    let cell = from;
    let next = to;
    for (;;) {
        board[cell] = ".";
        const jumped = Math.abs(Math.floor(next / CHK_SIDE) - Math.floor(cell / CHK_SIDE)) === 2;
        if (jumped) {
            board[(cell + next) / 2] = ".";
            captured.push((cell + next) / 2);
        }
        landings.push(next);
        if (piece < 2 && Math.floor(next / CHK_SIDE) === (piece === 0 ? 0 : CHK_SIDE - 1)) {
            piece += 2;
            crowned = true;
        }
        board[next] = String(piece);
        if (crowned || !jumped) {
            break;
        }
        const onward = chkContinue(board.join(""), next);
        if (onward.length !== 1) {
            fork = onward.length > 1;
            break;
        }
        cell = next;
        next = onward[0].to;
    }
    return { board: board.join(""), landings, captured, crowned, fork };
}
