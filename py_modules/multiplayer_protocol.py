import hashlib
import hmac
import re
import socket

from nearby_protocol import canonical, encode, is_nonce, is_tag, sign, verify

PORT = 49732

KIND = "cheevodeck.play"
VERSION = 1

CLOCK_SKEW_SECONDS = 120

MODES = ("link", "couch")
STATES = ("lobby", "starting", "playing")

MAX_SEATS = 4

RETROARCH_NETPLAY_PORT = 55435
GAMBATTE_LINK_PORT = 56400
PPSSPP_ADHOC_SERVER_PORT = 27312

_KEY_LABEL = b"cheevodeck-play-v1|"

_ROOM_ID = re.compile(r"[0-9a-f]{16}")
_CODE = re.compile(r"[0-9]{4}")
_HASH = re.compile(r"[0-9a-f]{32}")
_CRC = re.compile(r"[0-9a-f]{8}")
_BUILD = re.compile(r"[0-9a-f]{16}")
_CORE = re.compile(r"[a-z0-9_+.-]{1,48}")

_USER_MAX = 32
_TITLE_MAX = 64
_CORE_NAME_MAX = 48
_VERSION_MAX = 32

TAGGED_OPS = ("status", "launched", "leave")


def _clean(value, limit: int):
    if not isinstance(value, str):
        return None
    kept = "".join(ch for ch in value if ch.isprintable())
    return kept.strip()[:limit]


def clean_user(value) -> str:
    return _clean(value, _USER_MAX) or ""


def is_room_id(value) -> bool:
    return isinstance(value, str) and _ROOM_ID.fullmatch(value) is not None


def is_code(value) -> bool:
    return isinstance(value, str) and _CODE.fullmatch(value) is not None


def is_ipv4(value) -> bool:
    if not isinstance(value, str) or value.count(".") != 3:
        return False
    parts = value.split(".")
    if not all(part.isdigit() and len(part) <= 3 for part in parts):
        return False
    if any(int(part) > 255 for part in parts):
        return False
    try:
        socket.inet_aton(value)
    except OSError:
        return False
    return True


def room_key(code: str, room: str) -> bytes:
    return hmac.new(code.encode("ascii"), _KEY_LABEL + room.encode("ascii"), hashlib.sha256).digest()


def seat_key(key: bytes, nc: str, ns: str) -> bytes:
    return hmac.new(key, f"seat|{nc}|{ns}".encode("ascii"), hashlib.sha256).digest()


def game_port(mode: str, emulator: str, core: str) -> int:
    if mode == "couch":
        return RETROARCH_NETPLAY_PORT
    if emulator == "retroarch" and core == "gambatte":
        return GAMBATTE_LINK_PORT
    return PPSSPP_ADHOC_SERVER_PORT


def make_seek(nonce: str, now: int) -> bytes:
    return encode({"k": KIND, "v": VERSION, "op": "seek", "n": nonce, "ts": now})


def read_seek(message, now: float):
    if not _ours(message) or message.get("op") != "seek":
        return None
    nonce = message.get("n")
    stamp = message.get("ts")
    if not is_nonce(nonce) or type(stamp) is not int:
        return None
    if abs(stamp - now) > CLOCK_SKEW_SECONDS:
        return None
    return nonce


def _ours(message) -> bool:
    return (
        isinstance(message, dict)
        and message.get("k") == KIND
        and type(message.get("v")) is int
        and message.get("v") == VERSION
    )


def room_body(room: dict) -> dict:
    return {
        "k": KIND,
        "v": VERSION,
        "op": "room",
        "room": room["id"],
        "user": room["user"],
        "title": room["title"],
        "gameId": room["gameId"],
        "systemId": room["systemId"],
        "mode": room["mode"],
        "emulator": room["emulator"],
        "core": room["core"],
        "coreName": room["coreName"],
        "emuVersion": room["emuVersion"],
        "hash": room["hash"],
        "crc": room["crc"],
        "coreBuild": room["coreBuild"],
        "hardcore": room["hardcore"],
        "private": room["private"],
        "seats": [seat["name"] if seat else "" for seat in room["seats"]],
        "max": room["max"],
        "state": "lobby" if room["state"] == "lobby" else "playing",
        "pv": room["pv"],
    }


def make_room(room: dict, nonce=None) -> bytes:
    body = room_body(room)
    if nonce is not None:
        body["n"] = nonce
    return encode(body)


def read_room(message, nonce=None):
    if not _ours(message) or message.get("op") != "room":
        return None
    if nonce is not None and message.get("n") != nonce:
        return None

    seats = message.get("seats")
    count = message.get("max")
    game_id = message.get("gameId")
    system_id = message.get("systemId")
    user = _clean(message.get("user"), _USER_MAX)
    title = _clean(message.get("title"), _TITLE_MAX)
    core = message.get("core")
    build = message.get("coreBuild")
    if not _optional(build, _BUILD):
        build = ""
    if (
        not is_room_id(message.get("room"))
        or not user
        or title is None
        or type(game_id) is not int
        or not 0 < game_id < 2 ** 31
        or type(system_id) is not int
        or not 0 < system_id < 1000
        or message.get("mode") not in MODES
        or message.get("state") not in ("lobby", "playing")
        or type(message.get("hardcore")) is not bool
        or type(message.get("private")) is not bool
        or type(count) is not int
        or not 2 <= count <= MAX_SEATS
        or not isinstance(seats, list)
        or len(seats) != count
        or not all(isinstance(seat, str) for seat in seats)
        or not isinstance(core, str)
        or (core and _CORE.fullmatch(core) is None)
        or not _optional(message.get("hash"), _HASH)
        or not _optional(message.get("crc"), _CRC)
    ):
        return None
    return {
        "room": message["room"],
        "user": user,
        "title": title,
        "gameId": game_id,
        "systemId": system_id,
        "mode": message["mode"],
        "emulator": _clean(message.get("emulator"), _VERSION_MAX) or "",
        "core": core,
        "coreName": _clean(message.get("coreName"), _CORE_NAME_MAX) or "",
        "emuVersion": _clean(message.get("emuVersion"), _VERSION_MAX) or "",
        "hash": message["hash"],
        "crc": message["crc"],
        "coreBuild": build,
        "hardcore": message["hardcore"],
        "private": message["private"],
        "seats": [_clean(seat, _USER_MAX) or "" for seat in seats],
        "max": count,
        "state": message["state"],
        "pv": _clean(message.get("pv"), _VERSION_MAX) or "",
    }


def _optional(value, pattern) -> bool:
    return isinstance(value, str) and (value == "" or pattern.fullmatch(value) is not None)


def join_params(user: str, hash_: str, crc: str, core: str, emu_version: str) -> dict:
    return {"user": user, "hash": hash_, "crc": crc, "core": core, "emuVersion": emu_version}


def read_join_params(raw):
    if not isinstance(raw, dict):
        return None
    user = _clean(raw.get("user"), _USER_MAX)
    core = raw.get("core")
    if (
        not user
        or not isinstance(core, str)
        or (core and _CORE.fullmatch(core) is None)
        or not _optional(raw.get("hash"), _HASH)
        or not _optional(raw.get("crc"), _CRC)
    ):
        return None
    return {
        "user": user,
        "hash": raw["hash"],
        "crc": raw["crc"],
        "core": core,
        "emuVersion": _clean(raw.get("emuVersion"), _VERSION_MAX) or "",
    }


def join_tag(key: bytes, nc: str, ns: str, room: str, params: dict) -> str:
    return sign(key, "join", nc, ns, room, canonical(params))


def joined_tag(key: bytes, nc: str, ns: str, seat: int, ip: str) -> str:
    return sign(key, "joined", nc, ns, str(seat), ip)


def read_hello(message):
    if not isinstance(message, dict):
        return None
    version = message.get("v")
    if type(version) is not int or version != VERSION:
        return None
    op = message.get("op")
    if op == "info":
        return op, None
    if op == "join":
        nonce = message.get("nc")
        return (op, nonce) if is_nonce(nonce) else None
    if op in TAGGED_OPS:
        return op, None
    return None


def make_tagged(key: bytes, op: str, room: str, seat: int, nonce: str, now: int) -> dict:
    return {
        "op": op,
        "v": VERSION,
        "room": room,
        "seat": seat,
        "n": nonce,
        "ts": now,
        "t": sign(key, op, room, str(seat), nonce, str(now)),
    }


def read_tagged(message):
    room = message.get("room")
    seat = message.get("seat")
    nonce = message.get("n")
    stamp = message.get("ts")
    if (
        not is_room_id(room)
        or type(seat) is not int
        or not 1 <= seat < MAX_SEATS
        or not is_nonce(nonce)
        or type(stamp) is not int
        or not is_tag(message.get("t"))
    ):
        return None
    return room, seat, nonce, stamp


def tagged_ok(key: bytes, message, now: float) -> bool:
    if abs(message["ts"] - now) > CLOCK_SKEW_SECONDS:
        return False
    return verify(
        key, message["t"], message["op"], message["room"], str(message["seat"]), message["n"], str(message["ts"])
    )


def status_reply(key: bytes, nonce: str, body: dict) -> dict:
    return {**body, "t": sign(key, "state", nonce, canonical(body))}


def read_status_reply(key: bytes, message, nonce: str):
    if not isinstance(message, dict) or message.get("ok") is not True:
        return None
    body = {name: value for name, value in message.items() if name != "t"}
    if not verify(key, message.get("t"), "state", nonce, canonical(body)):
        return None
    members = message.get("members")
    if (
        message.get("state") not in STATES
        or type(message.get("hardcore")) is not bool
        or not is_ipv4(message.get("ip"))
        or not isinstance(members, list)
        or len(members) > MAX_SEATS
        or not all(isinstance(name, str) for name in members)
    ):
        return None
    return {
        "state": message["state"],
        "hardcore": message["hardcore"],
        "ip": message["ip"],
        "members": [_clean(name, _USER_MAX) or "" for name in members],
    }
