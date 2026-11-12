import random

VOTE_GAMES_MIN = 2
VOTE_GAMES_MAX = 4
PICK_SECONDS = 4.0

TTT_CELLS = 9
C4_COLUMNS = 7
C4_ROWS = 6
C4_PLAYERS = 4
REV_SIDE = 8
REV_CELLS = REV_SIDE * REV_SIDE
REV_START = {27: 1, 28: 0, 35: 0, 36: 1}
REV_DIRECTIONS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))

COUNT_MAX = 40

TTT_LINES = ((0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6))

VOTE_NONE = "vote_none"
VOTE_OVER = "vote_over"
VOTE_IN_GAME = "vote_in_game"
VOTE_VOTED = "vote_voted"
TTT_TWO = "ttt_two_players"
TTT_WAITING = "ttt_waiting"
C4_FULL = "c4_full"
C4_WAITING = "c4_waiting"
C4_START_READY = "c4_start_ready"
C4_NEED_TWO = "c4_need_two"
NOT_YOUR_TURN = "not_your_turn"
SQUARE_TAKEN = "square_taken"
COLUMN_FULL = "column_full"
MATCH_OVER = "match_over"
REV_ILLEGAL = "rev_illegal"
C4_JOIN = "c4_join"


def voter_key(seat: dict) -> str:
    return seat.get("ulid") or "n:" + seat["name"].lower()


def new_vote(number: int, kind: str, games: list) -> dict:
    return {"id": number, "kind": kind, "open": kind == "vote", "games": games, "ballots": {}, "winner": -1,
            "ended": ""}


def tally(vote: dict) -> list:
    counts = [0] * len(vote["games"])
    for pick in vote["ballots"].values():
        counts[pick] += 1
    return counts


def everyone_voted(vote: dict, voters: list) -> bool:
    return bool(voters) and all(key in vote["ballots"] for key in voters)


def winner(vote: dict, rng=random) -> int:
    counts = tally(vote)
    best = max(counts)
    return rng.choice([index for index, count in enumerate(counts) if count == best])


def vote_view(vote, key: str):
    if vote is None:
        return None
    return {"id": vote["id"], "kind": vote["kind"], "open": vote["open"], "ended": vote["ended"],
            "winner": vote["winner"], "games": [dict(game) for game in vote["games"]],
            "counts": [min(count, COUNT_MAX) for count in tally(vote)],
            "mine": vote["ballots"].get(key, -1)}


def _player(seat_index: int, seat: dict) -> dict:
    return {"seat": seat_index, "name": seat["name"], "pic": seat.get("pic", ""), "gone": False}


def ttt_new(match: int = 0) -> dict:
    return {"match": match, "board": [-1] * TTT_CELLS, "players": [], "turn": 0, "end": "", "winner": -1, "line": []}


def c4_new(match: int = 0) -> dict:
    return {"match": match, "board": [-1] * (C4_COLUMNS * C4_ROWS), "players": [], "started": False, "turn": 0,
            "end": "", "winner": -1, "line": []}


def rev_new(match: int = 0) -> dict:
    board = [-1] * REV_CELLS
    for cell, slot in REV_START.items():
        board[cell] = slot
    return {"match": match, "board": board, "players": [], "started": False, "turn": 0, "end": "", "winner": -1,
            "passed": -1, "line": []}


def _slot(state: dict, seat_index: int) -> int:
    return next((slot for slot, player in enumerate(state["players"])
                 if player["seat"] == seat_index and not player["gone"]), -1)


def ttt_move(state: dict, seat_index: int, seat: dict, cell: int) -> str:
    if state["end"]:
        return MATCH_OVER
    players = state["players"]
    slot = _slot(state, seat_index)
    if not players:
        state["match"] += 1
        players.append(_player(seat_index, seat))
        state["board"][cell] = 0
        state["turn"] = 1
        return ""
    if len(players) == 1:
        if slot == 0:
            return TTT_WAITING
        if state["board"][cell] >= 0:
            return SQUARE_TAKEN
        players.append(_player(seat_index, seat))
        state["board"][cell] = 1
        state["turn"] = 0
        return _ttt_settle(state)
    if slot < 0:
        return TTT_TWO
    if slot != state["turn"]:
        return NOT_YOUR_TURN
    if state["board"][cell] >= 0:
        return SQUARE_TAKEN
    state["board"][cell] = slot
    state["turn"] = 1 - slot
    return _ttt_settle(state)


def _ttt_settle(state: dict) -> str:
    board = state["board"]
    for line in TTT_LINES:
        mark = board[line[0]]
        if mark >= 0 and all(board[cell] == mark for cell in line):
            state.update(end="win", winner=mark, line=list(line))
            return ""
    if all(mark >= 0 for mark in board):
        state["end"] = "draw"
    return ""


def c4_act(state: dict, seat_index: int, seat: dict, act: str, column: int) -> str:
    if act == "start":
        return _c4_start(state, seat_index)
    if state["end"]:
        return MATCH_OVER
    slot = _slot(state, seat_index)
    if not state["started"]:
        if slot >= 0:
            active = [player for player in state["players"] if not player["gone"]]
            if active[0]["seat"] == seat_index:
                return C4_NEED_TWO if len(active) < 2 else C4_START_READY
            return C4_WAITING
        if len(state["players"]) >= C4_PLAYERS:
            return C4_FULL
        if not state["players"]:
            state["match"] += 1
        state["players"].append(_player(seat_index, seat))
        if len(state["players"]) == C4_PLAYERS:
            state.update(started=True, turn=0)
        return ""
    if slot < 0:
        return C4_FULL
    if slot != state["turn"]:
        return NOT_YOUR_TURN
    board = state["board"]
    row = next((row for row in range(C4_ROWS - 1, -1, -1) if board[row * C4_COLUMNS + column] < 0), -1)
    if row < 0:
        return COLUMN_FULL
    board[row * C4_COLUMNS + column] = slot
    line = _c4_line(board, row, column, slot)
    if line:
        state.update(end="win", winner=slot, line=line)
    elif all(mark >= 0 for mark in board):
        state["end"] = "draw"
    else:
        state["turn"] = _next_turn(state, slot)
    return ""


def _c4_start(state: dict, seat_index: int) -> str:
    if state["started"] or state["end"]:
        return MATCH_OVER
    active = [player for player in state["players"] if not player["gone"]]
    if not active or active[0]["seat"] != seat_index:
        return C4_WAITING
    if len(active) < 2:
        return C4_NEED_TWO
    state.update(started=True, turn=state["players"].index(active[0]))
    return ""


def _next_turn(state: dict, slot: int) -> int:
    count = len(state["players"])
    for step in range(1, count + 1):
        candidate = (slot + step) % count
        if not state["players"][candidate]["gone"]:
            return candidate
    return slot


def rev_flips(board: list, slot: int, cell: int) -> list:
    if board[cell] >= 0:
        return []
    row, column = divmod(cell, REV_SIDE)
    flips = []
    for d_row, d_column in REV_DIRECTIONS:
        run = []
        r, c = row + d_row, column + d_column
        while 0 <= r < REV_SIDE and 0 <= c < REV_SIDE and board[r * REV_SIDE + c] == 1 - slot:
            run.append(r * REV_SIDE + c)
            r, c = r + d_row, c + d_column
        if run and 0 <= r < REV_SIDE and 0 <= c < REV_SIDE and board[r * REV_SIDE + c] == slot:
            flips.extend(run)
    return flips


def rev_legal(board: list, slot: int) -> list:
    return [cell for cell in range(REV_CELLS) if rev_flips(board, slot, cell)]


def rev_act(state: dict, seat_index: int, seat: dict, act: str, cell: int) -> str:
    if state["end"]:
        return MATCH_OVER
    players = state["players"]
    slot = _slot(state, seat_index)
    if act == "join":
        if state["started"] or len(players) >= 2:
            return TTT_TWO
        if slot >= 0:
            return C4_NEED_TWO
        players.append(_player(seat_index, seat))
        if len(players) == 2:
            if random.random() < 0.5:
                players.reverse()
            state.update(started=True, turn=0, match=state["match"] + 1)
        return ""
    if not state["started"]:
        return C4_NEED_TWO if slot >= 0 else C4_JOIN
    if slot < 0:
        return TTT_TWO
    if slot != state["turn"]:
        return NOT_YOUR_TURN
    board = state["board"]
    flips = rev_flips(board, slot, cell)
    if not flips:
        return REV_ILLEGAL
    board[cell] = slot
    for flipped in flips:
        board[flipped] = slot
    state["passed"] = -1
    if rev_legal(board, 1 - slot):
        state["turn"] = 1 - slot
    elif rev_legal(board, slot):
        state["passed"] = 1 - slot
    else:
        _rev_end(state)
    return ""


def _rev_end(state: dict) -> None:
    counts = [state["board"].count(0), state["board"].count(1)]
    if counts[0] == counts[1]:
        state["end"] = "draw"
    else:
        state.update(end="win", winner=0 if counts[0] > counts[1] else 1)


def _c4_line(board: list, row: int, column: int, slot: int) -> list:
    for d_row, d_column in ((0, 1), (1, 0), (1, 1), (1, -1)):
        cells = [(row, column)]
        for sign in (1, -1):
            r, c = row + sign * d_row, column + sign * d_column
            while 0 <= r < C4_ROWS and 0 <= c < C4_COLUMNS and board[r * C4_COLUMNS + c] == slot:
                cells.append((r, c))
                r, c = r + sign * d_row, c + sign * d_column
        if len(cells) >= 4:
            return sorted(r * C4_COLUMNS + c for r, c in cells)
    return []


def seat_left(lounge: dict, seat_index: int) -> bool:
    changed = False
    ttt = lounge["ttt"]
    if _slot(ttt, seat_index) >= 0:
        lounge["ttt"] = ttt_new(ttt["match"])
        changed = True
    rev = lounge["rev"]
    if _slot(rev, seat_index) >= 0:
        lounge["rev"] = rev_new(rev["match"])
        changed = True
    c4 = lounge["c4"]
    slot = _slot(c4, seat_index)
    if slot >= 0:
        changed = True
        if not c4["started"]:
            del c4["players"][slot]
            if not c4["players"]:
                lounge["c4"] = c4_new(c4["match"])
        elif c4["end"]:
            c4["players"][slot]["gone"] = True
        else:
            c4["players"][slot]["gone"] = True
            if sum(1 for player in c4["players"] if not player["gone"]) < 2:
                lounge["c4"] = c4_new(c4["match"])
            elif c4["turn"] == slot:
                c4["turn"] = _next_turn(c4, slot)
    return changed


def clear(lounge: dict, game: str) -> None:
    if game == "ttt":
        lounge["ttt"] = ttt_new(lounge["ttt"]["match"])
    elif game == "rev":
        lounge["rev"] = rev_new(lounge["rev"]["match"])
    else:
        lounge["c4"] = c4_new(lounge["c4"]["match"])


def new_lounge() -> dict:
    return {"ttt": ttt_new(), "c4": c4_new(), "rev": rev_new()}


def lounge_view(lounge: dict) -> dict:
    ttt, c4, rev = lounge["ttt"], lounge["c4"], lounge["rev"]
    return {
        "ttt": {"match": ttt["match"], "board": "".join("." if mark < 0 else str(mark) for mark in ttt["board"]),
                "players": [dict(player) for player in ttt["players"]], "turn": ttt["turn"], "end": ttt["end"],
                "winner": ttt["winner"], "line": list(ttt["line"])},
        "c4": {"match": c4["match"], "board": "".join("." if mark < 0 else str(mark) for mark in c4["board"]),
               "players": [dict(player) for player in c4["players"]], "started": c4["started"], "turn": c4["turn"],
               "end": c4["end"], "winner": c4["winner"], "line": list(c4["line"])},
        "rev": {"match": rev["match"], "board": "".join("." if mark < 0 else str(mark) for mark in rev["board"]),
                "players": [dict(player) for player in rev["players"]], "started": rev["started"],
                "turn": rev["turn"], "end": rev["end"], "winner": rev["winner"], "passed": rev["passed"],
                "line": []},
    }
