import hashlib
import hmac
import re
import secrets
import socket

import nearby_protocol
from milestones_defs import RANK_TIERS
from nearby_protocol import canonical, is_device_id, is_nonce, is_tag, sign, verify

PORT = 49732

KIND = "cheevodeck.play"
VERSION = 4

MAX_FRAME_BYTES = 16384

CLOCK_SKEW_SECONDS = 120

MODES = ("link", "couch", "stream")
STATES = ("lobby", "starting", "playing")
SEAT_STATES = ("", "setup", "never")

MAX_SEATS = 10
DEFAULT_SEATS = 4

STATUSES = ("", "chill", "casual", "competitive", "achievements", "fun", "party", "watch")
WHERES = ("local", "online")

NAME_MAX = 24
PASSWORD_MAX = 32
PASSWORD_ROUNDS = 600_000

RETROARCH_NETPLAY_PORT = 55435
GAMBATTE_LINK_PORT = 56400
PPSSPP_ADHOC_SERVER_PORT = 27312
DOLPHIN_NETPLAY_PORT = 2626

NETPACKET_CORES = ("gpsp", "melondsds")

_KEY_LABEL = b"cheevodeck-play-v1|"
_PASS_SECONDS = 600
_PASSWORD_LABEL = b"cheevodeck-play-v2|"

_ROOM_ID = re.compile(r"[0-9a-f]{16}")
_STATUS = re.compile(r"[a-z_]{0,16}")
_HASH = re.compile(r"[0-9a-f]{32}")
_CRC = re.compile(r"[0-9a-f]{8}")
_BUILD = re.compile(r"[0-9a-f]{16}")
_GAME_CODE = re.compile(r"[A-Z0-9]{4}")
_ULID = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")
_PIC = re.compile(r"/UserPic/[A-Za-z0-9_]{1,32}\.png")
_HEX64 = re.compile(r"[0-9a-f]{64}")
_DEVICE_KEY = re.compile(r"[0-9a-f]{32}")
_DH_HEX = re.compile(r"[0-9a-f]{512}")

DH_PRIME = int(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510"
    "15728E5A8AACAA68FFFFFFFFFFFFFFFF", 16)
DH_GENERATOR = 2
_CORE = re.compile(r"[a-z0-9_+.-]{1,48}")

_USER_MAX = 32
_TITLE_MAX = 64
_CORE_NAME_MAX = 48
_VERSION_MAX = 32

TAGGED_OPS = ("status", "launched", "leave", "ready", "say", "friend", "pass", "voice", "vote", "lounge")

CHAT_MAX = 120
CHAT_KEPT = 50
CHAT_REPLY_BYTES = 1800
REPLY_BYTES = MAX_FRAME_BYTES - 200

_REASON = re.compile(r"[a-z0-9_]{0,32}")

VOICE_KINDS = ("offer", "answer", "bye")
VOICE_SDP_MAX = 6000
VOICE_REPLY_BYTES = 9000
VOICE_INBOX_MAX = 12
_SDP = re.compile(r"v=0\r?\n[\x20-\x7e\r\n]*")
_TURN_USER = re.compile(r"[0-9]{1,12}:[0-9a-f]{16}:[0-9]{1,3}")
_TURN_PASS = re.compile(r"[A-Za-z0-9+/]{27}=")
_TURN_WRAPPED = re.compile(r"[0-9a-f]{56}")


def _clean(value, limit: int):
    if not isinstance(value, str):
        return None
    kept = "".join(ch for ch in value if ch.isprintable())
    return kept.strip()[:limit]


def clean_user(value) -> str:
    kept = _clean(value, _USER_MAX)
    return "".join(ch for ch in kept if " " <= ch <= "~").strip() if kept else ""


def is_room_id(value) -> bool:
    return isinstance(value, str) and _ROOM_ID.fullmatch(value) is not None


def clean_room_name(value) -> str:
    return _clean(value, NAME_MAX) or ""


def is_password(value) -> bool:
    return isinstance(value, str) and 0 < len(value) <= PASSWORD_MAX


def is_reason(value) -> bool:
    return isinstance(value, str) and _REASON.fullmatch(value) is not None


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


def room_key(password: str, room: str) -> bytes:
    if not password:
        return hmac.new(b"", _KEY_LABEL + room.encode("ascii"), hashlib.sha256).digest()
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _PASSWORD_LABEL + room.encode("ascii"),
                               PASSWORD_ROUNDS)


def seat_key(key: bytes, nc: str, ns: str, shared: bytes) -> bytes:
    return hmac.new(key, f"seat|{nc}|{ns}|".encode("ascii") + shared, hashlib.sha256).digest()


def dh_private() -> int:
    return secrets.randbits(256) | (1 << 255)


def dh_public(private: int) -> str:
    return format(pow(DH_GENERATOR, private, DH_PRIME), "0512x")


def read_dh(value):
    if not isinstance(value, str) or _DH_HEX.fullmatch(value) is None:
        return None
    number = int(value, 16)
    return number if 2 <= number <= DH_PRIME - 2 else None


def dh_shared(private: int, other: int) -> bytes:
    return pow(other, private, DH_PRIME).to_bytes(256, "big")


def is_ulid(value) -> bool:
    return isinstance(value, str) and _ULID.fullmatch(value) is not None


def is_key(value) -> bool:
    return isinstance(value, str) and _HEX64.fullmatch(value) is not None


def is_device_key(value) -> bool:
    return isinstance(value, str) and _DEVICE_KEY.fullmatch(value) is not None


def clean_pic(value) -> str:
    return value if isinstance(value, str) and _PIC.fullmatch(value) is not None else ""


def wrap(key: bytes, label: str, nonce: str, secret: bytes) -> str:
    mask = hmac.new(key, f"wrap|{label}|{nonce}".encode("ascii"), hashlib.sha256).digest()
    return bytes(a ^ b for a, b in zip(secret, mask, strict=True)).hex()


def unwrap(key: bytes, label: str, nonce: str, wrapped):
    if not isinstance(wrapped, str) or _HEX64.fullmatch(wrapped) is None:
        return None
    mask = hmac.new(key, f"wrap|{label}|{nonce}".encode("ascii"), hashlib.sha256).digest()
    return bytes(a ^ b for a, b in zip(bytes.fromhex(wrapped), mask, strict=True))


def pass_key(key: bytes, room: str, ulid: str, expires: int) -> bytes:
    return hmac.new(key, f"pass|{room}|{ulid}|{expires}".encode("ascii"), hashlib.sha256).digest()


def friend_key(pair: bytes, room: str) -> bytes:
    return hmac.new(pair, f"friend|{room}".encode("ascii"), hashlib.sha256).digest()


def read_pass(raw, now: float):
    if not isinstance(raw, dict):
        return None
    ulid = raw.get("ulid")
    expires = raw.get("exp")
    if not is_ulid(ulid) or type(expires) is not int or not now < expires <= now + _PASS_SECONDS:
        return None
    return ulid, expires


def pass_expiry(now: float) -> int:
    return int(now) + _PASS_SECONDS


def game_port(mode: str, emulator: str, core: str) -> int:
    if mode == "couch" or (emulator == "retroarch" and core in NETPACKET_CORES):
        return RETROARCH_NETPLAY_PORT
    if emulator == "retroarch" and core == "gambatte":
        return GAMBATTE_LINK_PORT
    return PPSSPP_ADHOC_SERVER_PORT


def tunnel_ports(mode: str, emulator: str, core: str) -> list:
    if mode == "stream":
        return []
    if emulator == "dolphin":
        return [("udp", DOLPHIN_NETPLAY_PORT)] if mode == "couch" else []
    if emulator != "retroarch":
        return []
    if mode == "couch" or core in NETPACKET_CORES:
        return [("tcp", RETROARCH_NETPLAY_PORT)]
    if core == "gambatte":
        return [("tcp", GAMBATTE_LINK_PORT)]
    return []


def tunnel_token(key: bytes, port: int) -> str:
    return hmac.new(key, f"tunnel|{port}".encode("ascii"), hashlib.sha256).hexdigest()


def encode(message: dict) -> bytes:
    return nearby_protocol.encode(message, MAX_FRAME_BYTES)


def decode(raw: bytes):
    return nearby_protocol.decode(raw, MAX_FRAME_BYTES)


def frame(message: dict) -> bytes:
    return nearby_protocol.frame(message, MAX_FRAME_BYTES)


async def read_frame(reader) -> dict:
    return await nearby_protocol.read_frame(reader, MAX_FRAME_BYTES)


def make_seek(nonce: str, now: int, ulid: str = "") -> bytes:
    message = {"k": KIND, "v": VERSION, "op": "seek", "n": nonce, "ts": now}
    if ulid:
        message["u"] = ulid
    return encode(message)


def seek_asker(message) -> str:
    ulid = message.get("u") if isinstance(message, dict) else None
    return ulid if is_ulid(ulid) else ""


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


def room_body(room: dict, reveal: bool = False) -> dict:
    hidden = room["private"] and not reveal
    return {
        "k": KIND,
        "v": VERSION,
        "op": "room",
        "room": room["id"],
        "user": room["user"],
        "name": room["name"],
        "status": room["status"],
        "where": room["where"],
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
        "gameCode": room["gameCode"],
        "hostState": room["hostState"],
        "hardcore": room["hardcore"],
        "private": room["private"],
        "friends": room.get("friends", False),
        "owner": room.get("owner", ""),
        "share": room["share"],
        "watch": room.get("watch", False),
        "voice": room.get("voice", False),
        "seats": [("?" if hidden and index > 0 else seat["name"]) if seat else ""
                  for index, seat in enumerate(room["seats"])],
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
    return _room_fields(message)


def room_fields(room: dict) -> dict:
    return {name: value for name, value in room_body(room, reveal=True).items() if name not in ("k", "v", "op")}


def status_room_fields(room: dict) -> dict:
    return {name: value for name, value in room_fields(room).items() if name != "seats"}


def _room_fields(message):
    if not isinstance(message, dict):
        return None
    seats = message.get("seats")
    count = message.get("max")
    game_id = message.get("gameId")
    system_id = message.get("systemId")
    user = _clean(message.get("user"), _USER_MAX)
    title = _clean(message.get("title"), _TITLE_MAX)
    status = message.get("status")
    if not isinstance(status, str) or _STATUS.fullmatch(status) is None:
        status = ""
    where = message.get("where") if message.get("where") in WHERES else "local"
    core = message.get("core")
    build = message.get("coreBuild")
    if not _optional(build, _BUILD):
        build = ""
    game_code = message.get("gameCode")
    if not _optional(game_code, _GAME_CODE):
        game_code = ""
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
        or (message.get("friends") is True and not is_ulid(message.get("owner")))
        or type(message.get("share")) is not bool
        or type(count) is not int
        or not 2 <= count <= MAX_SEATS
        or not isinstance(seats, list)
        or len(seats) != count
        or not all(isinstance(seat, str) for seat in seats)
        or not isinstance(core, str)
        or (core and _CORE.fullmatch(core) is None)
        or not _optional(message.get("hash"), _HASH)
        or not _optional(message.get("crc"), _CRC)
        or message.get("hostState") not in SEAT_STATES
    ):
        return None
    return {
        "room": message["room"],
        "user": user,
        "name": _clean(message.get("name"), NAME_MAX) or "Room",
        "status": status,
        "where": where,
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
        "gameCode": game_code,
        "hostState": message["hostState"],
        "hardcore": message["hardcore"],
        "private": message["private"],
        "friends": message.get("friends") is True,
        "owner": message["owner"] if message.get("friends") is True else "",
        "share": message["share"],
        "watch": message.get("watch") is True,
        "voice": message.get("voice") is True,
        "seats": [_clean(seat, _USER_MAX) or "" for seat in seats],
        "max": count,
        "state": message["state"],
        "pv": _clean(message.get("pv"), _VERSION_MAX) or "",
    }


def _optional(value, pattern) -> bool:
    return isinstance(value, str) and (value == "" or pattern.fullmatch(value) is not None)


def clean_rank(value):
    if not isinstance(value, dict) or value.get("tier") not in RANK_TIERS:
        return None
    step = value.get("step")
    if type(step) is not int or not 1 <= step <= 4:
        return None
    return {"tier": value["tier"], "step": step}


def join_params(user: str, hash_: str, crc: str, core: str, emu_version: str, device: str, ulid: str,
                pic: str, rank=None) -> dict:
    params = {"user": user, "hash": hash_, "crc": crc, "core": core, "emuVersion": emu_version, "device": device,
              "ulid": ulid, "pic": pic}
    if rank is not None:
        params["rank"] = rank
    return params


def read_join_params(raw):
    if not isinstance(raw, dict):
        return None
    user = clean_user(raw.get("user"))
    core = raw.get("core")
    if (
        not user
        or not isinstance(core, str)
        or (core and _CORE.fullmatch(core) is None)
        or not _optional(raw.get("hash"), _HASH)
        or not _optional(raw.get("crc"), _CRC)
        or not is_device_id(raw.get("device"))
        or not (raw.get("ulid") == "" or is_ulid(raw.get("ulid")))
    ):
        return None
    return {
        "user": user,
        "device": raw["device"],
        "ulid": raw["ulid"],
        "pic": clean_pic(raw.get("pic")),
        "hash": raw["hash"],
        "crc": raw["crc"],
        "core": core,
        "emuVersion": _clean(raw.get("emuVersion"), _VERSION_MAX) or "",
        "rank": clean_rank(raw.get("rank")),
    }


def join_tag(key: bytes, nc: str, ns: str, room: str, params: dict, ga: str, gb: str) -> str:
    return sign(key, "join", nc, ns, room, ga, gb, canonical(params))


def joined_tag(key: bytes, nc: str, ns: str, seat: int, ip: str, ga: str, gb: str) -> str:
    return sign(key, "joined", nc, ns, str(seat), ip, ga, gb)


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
        ga = read_dh(message.get("ga"))
        if not is_nonce(nonce) or ga is None:
            return None
        friend = message.get("friend")
        return op, {"nc": nonce, "ga": ga, "pass": message.get("pass"), "friend": friend if is_ulid(friend) else ""}
    if op in TAGGED_OPS:
        return op, None
    return None


def make_tagged(key: bytes, op: str, room: str, seat: int, nonce: str, now: int, payload=None) -> dict:
    payload = payload or {}
    return {
        "op": op,
        "v": VERSION,
        "room": room,
        "seat": seat,
        "n": nonce,
        "ts": now,
        "p": payload,
        "t": sign(key, op, room, str(seat), nonce, str(now), canonical(payload)),
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
        or not isinstance(message.get("p", {}), dict)
        or not is_tag(message.get("t"))
    ):
        return None
    return room, seat, nonce, stamp


def tagged_ok(key: bytes, message, now: float) -> bool:
    if abs(message["ts"] - now) > CLOCK_SKEW_SECONDS:
        return False
    return verify(
        key, message["t"], message["op"], message["room"], str(message["seat"]), message["n"], str(message["ts"]),
        canonical(message.get("p", {})),
    )


def report(*, seq: int, ready: bool, rev: int, round_: int, can: bool, reason: str, game_id: int, title: str,
           launched: bool, hardcore: bool, seat_state: str = "", st: str = "", kb: int = 0, rank=None) -> dict:
    body = {"seq": seq, "ready": ready, "rev": rev, "round": round_, "can": can, "reason": reason,
            "gameId": game_id, "title": title[:_TITLE_MAX], "launched": launched, "hardcore": hardcore,
            "seatState": seat_state}
    if rank is not None:
        body["rank"] = rank
    if st:
        body["st"] = st
    if kb:
        body["kb"] = kb
    return body


def clean_chat(value) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join("".join(ch if ch.isprintable() else " " for ch in value).split())


def chat_since(raw) -> int:
    since = raw.get("since") if isinstance(raw, dict) else None
    return since if type(since) is int and 0 <= since < 2 ** 31 else 0


def chat_page(chat: list, since: int, limit: int = CHAT_REPLY_BYTES) -> list:
    page, size = [], 0
    for message in chat:
        if message["seq"] <= since:
            continue
        size += len(canonical(message)) + 1
        if page and size > min(limit, CHAT_REPLY_BYTES):
            break
        page.append(message)
    return page


def _chat_ok(message) -> bool:
    return (
        isinstance(message, dict)
        and type(message.get("seq")) is int
        and isinstance(message.get("name"), str)
        and isinstance(message.get("text"), str)
    )


def read_report(raw):
    if not isinstance(raw, dict) or not raw:
        return None
    numbers = ("seq", "rev", "round", "gameId")
    flags = ("ready", "can", "launched", "hardcore")
    if (
        any(type(raw.get(name)) is not int or not 0 <= raw[name] < 2 ** 31 for name in numbers)
        or any(type(raw.get(name)) is not bool for name in flags)
        or not isinstance(raw.get("reason"), str)
        or _REASON.fullmatch(raw["reason"]) is None
        or not isinstance(raw.get("title"), str)
        or raw.get("seatState") not in SEAT_STATES
    ):
        return None
    kb = raw.get("kb", 0)
    return {**{name: raw[name] for name in (*numbers, *flags, "reason", "seatState")},
            "title": _clean(raw["title"], _TITLE_MAX),
            "st": stream_state(raw.get("st")), "kb": kb if type(kb) is int and 0 <= kb <= 100000 else 0,
            "rank": clean_rank(raw.get("rank"))}


def status_reply(key: bytes, nonce: str, body: dict) -> dict:
    return {**body, "t": sign(key, "state", nonce, canonical(body))}


def read_status_reply(key: bytes, message, nonce: str):
    if not isinstance(message, dict) or message.get("ok") is not True:
        return None
    body = {name: value for name, value in message.items() if name != "t"}
    if not verify(key, message.get("t"), "state", nonce, canonical(body)):
        return None
    members = message.get("members")
    seats = message.get("seats")
    last = message.get("lastStart")
    sent = message.get("room")
    room = _room_fields({**sent, "seats": members}) if isinstance(sent, dict) and isinstance(members, list) else None
    vote = read_vote(message.get("vote"))
    lounge = read_lounge(message.get("lounge"))
    if (
        room is None
        or (message.get("vote") is not None and vote is None)
        or lounge is None
        or message.get("state") not in STATES
        or type(message.get("hardcore")) is not bool
        or not is_ipv4(message.get("ip"))
        or not isinstance(members, list)
        or len(members) > MAX_SEATS
        or not all(isinstance(name, str) for name in members)
        or any(type(message.get(name)) is not int or not 0 <= message[name] < 2 ** 31
               for name in ("rev", "round", "port", "players"))
        or type(message.get("start")) is not bool
        or not isinstance(seats, list)
        or len(seats) != len(members)
        or not all(_seat_ok(seat) for seat in seats)
        or not (last is None or _last_start_ok(last))
        or not isinstance(message.get("chat"), list)
        or not all(_chat_ok(entry) for entry in message["chat"])
        or not isinstance(message.get("ids"), list)
        or len(message["ids"]) != len(members)
        or not all(isinstance(entry, dict) for entry in message["ids"])
        or not isinstance(message.get("inbox"), list)
        or len(message["inbox"]) > INBOX_MAX
        or not isinstance(message.get("voice", []), list)
        or len(message.get("voice", [])) > VOICE_INBOX_MAX
    ):
        return None
    return {
        "state": message["state"],
        "hardcore": message["hardcore"],
        "ip": message["ip"],
        "members": [_clean(name, _USER_MAX) or "" for name in members],
        "rev": message["rev"],
        "round": message["round"],
        "start": message["start"],
        "port": message["port"],
        "players": message["players"],
        "seats": [{"ready": seat["ready"], "can": seat["can"], "launched": seat["launched"],
                   "playing": seat["playing"], "title": _clean(seat["title"], _TITLE_MAX),
                   "seatState": seat["seatState"],
                   "vc": seat.get("vc") is True, "vs": _stamp(seat.get("vs")),
                   "st": stream_state(seat.get("st"))} for seat in seats],
        "lastStart": None if last is None else {"round": last["round"], "ok": last["ok"], "error": last["error"]},
        "room": room,
        "chat": [{"seq": entry["seq"], "name": _clean(entry["name"], _USER_MAX) or "",
                  "text": clean_chat(entry["text"])[:CHAT_MAX]} for entry in message["chat"]],
        "ids": [{"ulid": entry["ulid"] if is_ulid(entry.get("ulid")) else "", "pic": clean_pic(entry.get("pic")),
                 "rank": clean_rank(entry.get("rank"))}
                for entry in message["ids"]],
        "inbox": [item for item in (read_inbox_item(raw) for raw in message["inbox"]) if item is not None],
        "voice": [item for item in (read_voice_item(raw) for raw in message.get("voice", [])) if item is not None],
        "turn": read_turn(message.get("turn")),
        "vote": vote,
        "lounge": lounge,
        "stream": read_stream(message.get("stream")),
        "pipe": read_pipe(message.get("pipe")),
        "rmg": message["rmg"] if type(message.get("rmg")) is int and 0 < message["rmg"] < 2 ** 31 else 0,
        "chatTop": message["chatTop"] if type(message.get("chatTop")) is int and 0 <= message["chatTop"] < 2 ** 31 else -1,
    }


FRIEND_ACTS = ("ask", "accept", "decline")
INBOX_MAX = 8


def read_inbox_item(raw):
    if (
        not isinstance(raw, dict)
        or type(raw.get("seq")) is not int
        or not 0 < raw["seq"] < 2 ** 31
        or type(raw.get("from")) is not int
        or not 0 <= raw["from"] < MAX_SEATS
        or raw.get("act") not in FRIEND_ACTS
    ):
        return None
    if raw["act"] == "ask" and (not is_nonce(raw.get("n")) or not isinstance(raw.get("k"), str)):
        return None
    if not is_ulid(raw.get("ulid")):
        return None
    return {"seq": raw["seq"], "from": raw["from"], "ulid": raw["ulid"], "act": raw["act"], "n": raw.get("n", ""),
            "k": raw.get("k", "")}


def read_friend_ask(raw):
    if not isinstance(raw, dict) or raw.get("act") not in FRIEND_ACTS:
        return None
    to = raw.get("to")
    if type(to) is not int or not 0 <= to < MAX_SEATS:
        return None
    if raw["act"] == "ask" and (not is_nonce(raw.get("n")) or not isinstance(raw.get("k"), str)):
        return None
    return {"act": raw["act"], "to": to, "n": raw.get("n", ""), "k": raw.get("k", "")}


def inbox_since(raw) -> int:
    since = raw.get("fsince") if isinstance(raw, dict) else None
    return since if type(since) is int and 0 <= since < 2 ** 31 else 0


STREAM_STATES = ("pairing", "connecting", "streaming", "relay", "failed")
_PIN = re.compile(r"[0-9]{4}")
_OCCUPANT = re.compile(r"[0-9a-f]{8,32}")


def wrap_pin(key: bytes, nonce: str, pin: str) -> str:
    return wrap(key, "spin", nonce, pin.encode("ascii").ljust(32, b"\0"))


def unwrap_pin(key: bytes, nonce: str, wrapped):
    raw = unwrap(key, "spin", nonce, wrapped)
    if raw is None:
        return None
    try:
        pin = raw.rstrip(b"\0").decode("ascii")
    except UnicodeDecodeError:
        return None
    return pin if _PIN.fullmatch(pin) else None


def stream_state(value) -> str:
    return value if value in STREAM_STATES else ""


def read_stream(raw):
    if not isinstance(raw, dict):
        return None
    nonce, cap = raw.get("n"), raw.get("cap")
    if not is_nonce(nonce) or type(cap) is not int or not 0 <= cap <= 100000 or type(raw.get("full")) is not bool:
        return None
    for name in ("pin", "token"):
        if raw.get(name) != "" and (not isinstance(raw.get(name), str) or _HEX64.fullmatch(raw[name]) is None):
            return None
    occupant = raw.get("occ", "")
    if not isinstance(occupant, str) or _OCCUPANT.fullmatch(occupant) is None:
        return None
    low, half = raw.get("low", False), raw.get("half", False)
    return {"pin": raw["pin"], "token": raw["token"], "n": nonce, "cap": cap, "full": raw["full"], "occ": occupant,
            "low": low is True, "half": half is True, "hs": _host_size(raw.get("hs"))}


def _host_size(raw):
    if (isinstance(raw, list) and len(raw) == 2 and all(type(value) is int and 0 < value <= 8192 for value in raw)):
        return (raw[0], raw[1])
    return None


def read_pipe(raw):
    if not isinstance(raw, dict):
        return None
    nonce, occupant = raw.get("n"), raw.get("occ")
    if (not is_nonce(nonce) or not isinstance(raw.get("token"), str) or _HEX64.fullmatch(raw["token"]) is None
            or not isinstance(occupant, str) or _OCCUPANT.fullmatch(occupant) is None):
        return None
    return {"token": raw["token"], "n": nonce, "occ": occupant}


def _seat_ok(seat) -> bool:
    return (
        isinstance(seat, dict)
        and all(type(seat.get(name)) is bool for name in ("ready", "can", "launched", "playing"))
        and isinstance(seat.get("title"), str)
        and seat.get("seatState") in SEAT_STATES
    )


def _last_start_ok(last) -> bool:
    return (
        isinstance(last, dict)
        and type(last.get("round")) is int
        and type(last.get("ok")) is bool
        and isinstance(last.get("error"), str)
        and _REASON.fullmatch(last["error"]) is not None
    )


def _stamp(value) -> int:
    return value if type(value) is int and 0 <= value < 2 ** 31 else 0


def _voice_sdp_ok(kind: str, sdp) -> bool:
    if not isinstance(sdp, str):
        return False
    if kind == "bye":
        return sdp == ""
    return len(sdp) <= VOICE_SDP_MAX and _SDP.fullmatch(sdp) is not None


def read_voice_send(raw):
    item = raw.get("voice") if isinstance(raw, dict) else None
    if not isinstance(item, dict):
        return None
    to, kind, gen = item.get("to"), item.get("kind"), item.get("gen")
    if (
        type(to) is not int or not 0 <= to < MAX_SEATS
        or kind not in VOICE_KINDS
        or type(gen) is not int or not 0 <= gen < 2 ** 31
        or not _voice_sdp_ok(kind, item.get("sdp"))
    ):
        return None
    return {"to": to, "kind": kind, "sdp": item["sdp"], "gen": gen}


def read_voice_item(raw):
    if not isinstance(raw, dict):
        return None
    n, sender, kind, gen = raw.get("n"), raw.get("from"), raw.get("kind"), raw.get("gen")
    if (
        type(n) is not int or not 0 < n < 2 ** 31
        or type(sender) is not int or not 0 <= sender < MAX_SEATS
        or kind not in VOICE_KINDS
        or type(gen) is not int or not 0 <= gen < 2 ** 31
        or not _voice_sdp_ok(kind, raw.get("sdp"))
    ):
        return None
    return {"n": n, "from": sender, "vs": _stamp(raw.get("vs")), "kind": kind, "sdp": raw["sdp"], "gen": gen}


def voice_since(raw) -> int:
    since = raw.get("vsince") if isinstance(raw, dict) else None
    return since if type(since) is int and 0 <= since < 2 ** 31 else 0


def voice_wanted(raw) -> bool:
    return isinstance(raw, dict) and raw.get("vc") is True


def voice_page(queue: list, limit: int) -> list:
    page, size = [], 0
    for item in queue:
        size += len(canonical(item)) + 1
        if size > min(limit, VOICE_REPLY_BYTES):
            break
        page.append(item)
    return page


def wrap_turn(key: bytes, nonce: str, password: str) -> str:
    raw = password.encode("ascii")
    mask = hmac.new(key, f"wrap|turn|{nonce}".encode("ascii"), hashlib.sha256).digest()
    return bytes(a ^ b for a, b in zip(raw, mask[:len(raw)], strict=True)).hex()


def unwrap_turn(key: bytes, nonce: str, wrapped):
    if not isinstance(wrapped, str) or _TURN_WRAPPED.fullmatch(wrapped) is None:
        return None
    mask = hmac.new(key, f"wrap|turn|{nonce}".encode("ascii"), hashlib.sha256).digest()
    try:
        password = bytes(a ^ b for a, b in zip(bytes.fromhex(wrapped), mask[:28], strict=True)).decode("ascii")
    except UnicodeDecodeError:
        return None
    return password if _TURN_PASS.fullmatch(password) else None


def is_turn_user(value) -> bool:
    return isinstance(value, str) and _TURN_USER.fullmatch(value) is not None


def is_turn_password(value) -> bool:
    return isinstance(value, str) and _TURN_PASS.fullmatch(value) is not None


def read_turn(raw):
    if not isinstance(raw, dict):
        return None
    ttl, nonce = raw.get("ttl"), raw.get("n")
    if not is_turn_user(raw.get("u")) or type(ttl) is not int or not 0 < ttl < 2 ** 31 or not is_nonce(nonce):
        return None
    if not isinstance(raw.get("p"), str):
        return None
    return {"u": raw["u"], "p": raw["p"], "ttl": ttl, "n": nonce}


VOTE_KINDS = ("vote", "pick")
VOTE_ENDS = ("", "won", "canceled", "started")
VOTE_GAMES_MAX = 4
_ICON = re.compile(r"/Images/[0-9A-Za-z_]{1,32}\.(png|jpg)")
_TTT_BOARD = re.compile(r"[.01]{9}")
_C4_BOARD = re.compile(r"[.0-3]{42}")
_REV_BOARD = re.compile(r"[.01]{64}")
LOUNGE_ENDS = ("", "win", "draw")
LOUNGE_GAMES = ("ttt", "c4", "rev")
LOUNGE_ACTS = ("move", "start", "clear", "join")
_LOUNGE_CELLS = {"ttt": 9, "c4": 7, "rev": 64}


def _small_int(value, low: int, high: int) -> bool:
    return type(value) is int and low <= value <= high


def _vote_game(raw):
    if not isinstance(raw, dict):
        return None
    title = _clean(raw.get("title"), _TITLE_MAX)
    icon = raw.get("icon")
    if (
        not title
        or not _small_int(raw.get("gameId"), 1, 2 ** 31 - 1)
        or not _small_int(raw.get("systemId"), 1, 999)
        or not isinstance(icon, str)
        or (icon and _ICON.fullmatch(icon) is None)
    ):
        return None
    return {"gameId": raw["gameId"], "systemId": raw["systemId"], "title": title, "icon": icon}


def clean_title(value) -> str:
    return _clean(value, _TITLE_MAX) or ""


def clean_icon(value) -> str:
    return value if isinstance(value, str) and _ICON.fullmatch(value) is not None else ""


def read_vote(raw):
    if not isinstance(raw, dict):
        return None
    games = raw.get("games")
    counts = raw.get("counts")
    if (
        not _small_int(raw.get("id"), 1, 2 ** 31 - 1)
        or raw.get("kind") not in VOTE_KINDS
        or type(raw.get("open")) is not bool
        or raw.get("ended") not in VOTE_ENDS
        or not isinstance(games, list)
        or not 2 <= len(games) <= VOTE_GAMES_MAX
        or not isinstance(counts, list)
        or len(counts) != len(games)
        or not all(_small_int(count, 0, MAX_SEATS * 4) for count in counts)
        or not _small_int(raw.get("winner"), -1, len(games) - 1)
        or not _small_int(raw.get("mine"), -1, len(games) - 1)
    ):
        return None
    read = [_vote_game(game) for game in games]
    if any(game is None for game in read):
        return None
    return {"id": raw["id"], "kind": raw["kind"], "open": raw["open"], "ended": raw["ended"], "winner": raw["winner"],
            "games": read, "counts": list(counts), "mine": raw["mine"]}


def _lounge_players(raw, most: int):
    if not isinstance(raw, list) or len(raw) > most:
        return None
    players = []
    for entry in raw:
        if (
            not isinstance(entry, dict)
            or not _small_int(entry.get("seat"), 0, MAX_SEATS - 1)
            or not _clean(entry.get("name"), _USER_MAX)
            or type(entry.get("gone")) is not bool
        ):
            return None
        players.append({"seat": entry["seat"], "name": _clean(entry["name"], _USER_MAX), "pic": clean_pic(entry.get("pic")),
                        "gone": entry["gone"]})
    return players


def _lounge_board(raw, pattern, players_most: int, cells: int):
    if not isinstance(raw, dict):
        return None
    players = _lounge_players(raw.get("players"), players_most)
    line = raw.get("line")
    if (
        players is None
        or not isinstance(raw.get("board"), str)
        or pattern.fullmatch(raw["board"]) is None
        or not _small_int(raw.get("match"), 0, 2 ** 31 - 1)
        or not _small_int(raw.get("turn"), 0, players_most - 1)
        or raw.get("end") not in LOUNGE_ENDS
        or not _small_int(raw.get("winner"), -1, players_most - 1)
        or not isinstance(line, list)
        or len(line) > 8
        or not all(_small_int(cell, 0, cells - 1) for cell in line)
    ):
        return None
    return {"match": raw["match"], "board": raw["board"], "players": players, "turn": raw["turn"], "end": raw["end"],
            "winner": raw["winner"], "line": list(line)}


def read_lounge(raw):
    if not isinstance(raw, dict):
        return None
    ttt = _lounge_board(raw.get("ttt"), _TTT_BOARD, 2, 9)
    c4 = _lounge_board(raw.get("c4"), _C4_BOARD, 4, 42)
    rev = _lounge_board(raw.get("rev"), _REV_BOARD, 2, 64)
    if (
        ttt is None
        or c4 is None
        or rev is None
        or type(raw["c4"].get("started")) is not bool
        or type(raw["rev"].get("started")) is not bool
        or not _small_int(raw["rev"].get("passed"), -1, 1)
    ):
        return None
    c4["started"] = raw["c4"]["started"]
    rev.update(started=raw["rev"]["started"], passed=raw["rev"]["passed"])
    return {"ttt": ttt, "c4": c4, "rev": rev}


def read_vote_press(raw):
    if not isinstance(raw, dict) or not _small_int(raw.get("vote"), 1, 2 ** 31 - 1) \
            or not _small_int(raw.get("pick"), 0, VOTE_GAMES_MAX - 1):
        return None
    return raw["vote"], raw["pick"]


def read_lounge_press(raw):
    if not isinstance(raw, dict) or raw.get("game") not in LOUNGE_GAMES or raw.get("act") not in LOUNGE_ACTS:
        return None
    cell = raw.get("cell", 0)
    if not _small_int(cell, 0, _LOUNGE_CELLS[raw["game"]] - 1):
        return None
    return raw["game"], raw["act"], cell
