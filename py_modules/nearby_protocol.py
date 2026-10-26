import hashlib
import hmac
import json
import re
import struct

PORT = 49731

KIND = "cheevodeck.nearby"
VERSION = 1

MAX_FRAME_BYTES = 4096

CLOCK_SKEW_SECONDS = 120

MAX_HELD_BYTES = 4 * 1024 * 1024

_MEMORY_ID_MAX = 64

MAX_BUNDLE_BYTES = 1 << 40

MAX_DATA_BYTES = 8 * 1024 * 1024

DATA_KINDS = ("tracked", "notes", "milestones")

_TITLE_MAX = 64
_TIER = re.compile(r"[a-z]{1,16}")

_KEY_LABEL = b"cheevodeck-nearby-v1|"

_NONCE = re.compile(r"[0-9a-f]{32}")
_TAG = re.compile(r"[0-9a-f]{64}")
_DEVICE_ID = re.compile(r"[0-9a-f]{16}")

_LENGTH = struct.Struct("!I")

_MODEL_MAX = 32
_HOST_MAX = 64

_PRODUCTS = {
    "Jupiter": "Steam Deck LCD",
    "Galileo": "Steam Deck OLED",
    "Fremont": "Steam Machine",
}

DEFAULT_HOST = "steamdeck"


class FrameError(Exception):
    pass


def session_key(web_api_key: str, ulid: str):
    key = str(web_api_key or "").strip()
    owner = str(ulid or "").strip().upper()
    if not key or not owner:
        return None
    return hmac.new(key.encode("utf-8"), _KEY_LABEL + owner.encode("utf-8"), hashlib.sha256).digest()


def sign(key: bytes, *parts: str) -> str:
    return hmac.new(key, "|".join(parts).encode("utf-8"), hashlib.sha256).hexdigest()


def verify(key: bytes, tag, *parts: str) -> bool:
    if not is_tag(tag):
        return False
    return hmac.compare_digest(tag, sign(key, *parts))


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def is_nonce(value) -> bool:
    return isinstance(value, str) and _NONCE.fullmatch(value) is not None


def is_tag(value) -> bool:
    return isinstance(value, str) and _TAG.fullmatch(value) is not None


def is_device_id(value) -> bool:
    return isinstance(value, str) and _DEVICE_ID.fullmatch(value) is not None


def _is_count(value) -> bool:
    return type(value) is int and 0 <= value <= MAX_BUNDLE_BYTES


def _clean_text(value, limit: int):
    if not isinstance(value, str):
        return None
    kept = "".join(ch for ch in value if ch.isprintable())
    return kept.strip()[:limit]


def _ours(message) -> bool:
    return (
        isinstance(message, dict)
        and message.get("k") == KIND
        and type(message.get("v")) is int
        and message.get("v") == VERSION
    )


def decode(raw: bytes):
    if not isinstance(raw, (bytes, bytearray)) or len(raw) > MAX_FRAME_BYTES:
        return None
    try:
        value = json.loads(bytes(raw).decode("utf-8"), parse_constant=_refuse_constant)
    except (ValueError, RecursionError):
        return None
    return value if isinstance(value, dict) else None


def _refuse_constant(_name):
    raise ValueError("not a number")


def encode(message: dict) -> bytes:
    body = canonical(message).encode("ascii")
    if len(body) > MAX_FRAME_BYTES:
        raise FrameError()
    return body


def frame(message: dict) -> bytes:
    body = encode(message)
    return _LENGTH.pack(len(body)) + body


def frame_length(head: bytes) -> int:
    if len(head) != _LENGTH.size:
        raise FrameError()
    (length,) = _LENGTH.unpack(head)
    if length <= 0 or length > MAX_FRAME_BYTES:
        raise FrameError()
    return length


def frame_body(raw: bytes) -> dict:
    message = decode(raw)
    if message is None:
        raise FrameError()
    return message


async def read_frame(reader) -> dict:
    length = frame_length(await reader.readexactly(_LENGTH.size))
    return frame_body(await reader.readexactly(length))


def recv_exactly(sock, count: int) -> bytes:
    buffer = bytearray()
    while len(buffer) < count:
        chunk = sock.recv(count - len(buffer))
        if not chunk:
            raise ConnectionError("closed")
        buffer += chunk
    return bytes(buffer)


def recv_frame(sock) -> dict:
    length = frame_length(recv_exactly(sock, _LENGTH.size))
    return frame_body(recv_exactly(sock, length))


def make_who(key: bytes, nonce: str, now: int) -> bytes:
    return encode({
        "k": KIND,
        "v": VERSION,
        "op": "who",
        "n": nonce,
        "ts": now,
        "t": sign(key, "who", nonce, str(now)),
    })


def read_who(key: bytes, message, now: float):
    if not _ours(message) or message.get("op") != "who":
        return None
    nonce = message.get("n")
    stamp = message.get("ts")
    if not is_nonce(nonce) or type(stamp) is not int:
        return None
    if abs(stamp - now) > CLOCK_SKEW_SECONDS:
        return None
    if not verify(key, message.get("t"), "who", nonce, str(stamp)):
        return None
    return nonce


def make_here(key: bytes, nonce: str, info: dict) -> bytes:
    body = {
        "k": KIND,
        "v": VERSION,
        "op": "here",
        "n": nonce,
        "id": info["id"],
        "model": info["model"],
        "host": info["host"],
        "port": info["port"],
        "memories": info["memories"],
        "memoriesNoVideos": info["memoriesNoVideos"],
        "bytes": info["bytes"],
        "bytesNoVideos": info["bytesNoVideos"],
        "videos": info["videos"],
    }
    body["t"] = sign(key, "here", canonical(body))
    return encode(body)


def read_here(key: bytes, message, nonce: str):
    if not _ours(message) or message.get("op") != "here" or message.get("n") != nonce:
        return None
    body = {name: value for name, value in message.items() if name != "t"}
    if not verify(key, message.get("t"), "here", canonical(body)):
        return None

    port = message.get("port")
    model = _clean_text(message.get("model"), _MODEL_MAX)
    host = _clean_text(message.get("host"), _HOST_MAX)
    counts = [message.get(name) for name in ("memories", "memoriesNoVideos", "bytes", "bytesNoVideos")]
    if (
        not is_device_id(message.get("id"))
        or type(port) is not int
        or not 0 < port < 65536
        or model is None
        or host is None
        or not all(_is_count(value) for value in counts)
        or type(message.get("videos")) is not bool
    ):
        return None
    return {
        "id": message["id"],
        "model": model,
        "host": host,
        "port": port,
        "memories": counts[0],
        "memoriesNoVideos": counts[1],
        "bytes": counts[2],
        "bytesNoVideos": counts[3],
        "videos": message["videos"],
    }


def read_pull(message):
    if not isinstance(message, dict) or message.get("op") != "pull":
        return None
    version = message.get("v")
    if type(version) is not int or version != VERSION:
        return None
    nonce = message.get("nc")
    return nonce if is_nonce(nonce) else None


def held_block(held) -> bytes:
    return "\n".join(sorted(str(memory_id) for memory_id in held)).encode("utf-8")


def pull_params(include_videos: bool, model: str, host: str, block: bytes) -> dict:
    return {
        "includeVideos": bool(include_videos),
        "model": model,
        "host": host,
        "heldBytes": len(block),
        "heldSha256": hashlib.sha256(block).hexdigest(),
    }


def read_params(raw):
    if not isinstance(raw, dict) or type(raw.get("includeVideos")) is not bool:
        return None
    model = _clean_text(raw.get("model"), _MODEL_MAX)
    host = _clean_text(raw.get("host"), _HOST_MAX)
    held = raw.get("heldBytes")
    digest = raw.get("heldSha256")
    if model is None or host is None:
        return None
    if type(held) is not int or not 0 <= held <= MAX_HELD_BYTES or not is_tag(digest):
        return None
    return {
        "includeVideos": raw["includeVideos"],
        "model": model,
        "host": host,
        "heldBytes": held,
        "heldSha256": digest,
    }


def read_held(block: bytes, digest: str):
    if not hmac.compare_digest(hashlib.sha256(block).hexdigest(), digest):
        return None
    try:
        text = block.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return frozenset(line for line in text.split("\n") if line and len(line) <= _MEMORY_ID_MAX)


def pull_tag(key: bytes, nc: str, ns: str, params: dict) -> str:
    return sign(key, "pull", nc, ns, canonical(params))


def ok_tag(key: bytes, nc: str, ns: str) -> str:
    return sign(key, "ok", ns, nc)


def bundle_tag(key: bytes, nc: str, ns: str, size: int) -> str:
    return sign(key, "bundle", nc, ns, str(size))


def end_tag(key: bytes, nc: str, ns: str, size: int, digest: str) -> str:
    return sign(key, "end", nc, ns, str(size), digest)


def got_tag(key: bytes, nc: str, ns: str, digest: str) -> str:
    return sign(key, "got", nc, ns, digest)


def bundle_size(message):
    if not isinstance(message, dict) or message.get("op") != "bundle":
        return None
    size = message.get("size")
    if type(size) is not int or not 0 < size <= MAX_BUNDLE_BYTES:
        return None
    return size


def make_seek(key: bytes, nonce: str, now: int) -> bytes:
    return encode({
        "k": KIND,
        "v": VERSION,
        "op": "seek",
        "n": nonce,
        "ts": now,
        "t": sign(key, "seek", nonce, str(now)),
    })


def read_seek(key: bytes, message, now: float):
    if not _ours(message) or message.get("op") != "seek":
        return None
    nonce = message.get("n")
    stamp = message.get("ts")
    if not is_nonce(nonce) or type(stamp) is not int:
        return None
    if abs(stamp - now) > CLOCK_SKEW_SECONDS:
        return None
    if not verify(key, message.get("t"), "seek", nonce, str(stamp)):
        return None
    return nonce


def make_offer(key: bytes, nonce: str, info: dict) -> bytes:
    body = {
        "k": KIND,
        "v": VERSION,
        "op": "offer",
        "n": nonce,
        "id": info["id"],
        "model": info["model"],
        "host": info["host"],
        "port": info["port"],
        "gameId": info["gameId"],
        "title": info["title"],
        "tracked": info["tracked"],
        "notes": info["notes"],
        "milestones": info["milestones"],
    }
    body["t"] = sign(key, "offer", canonical(body))
    return encode(body)


def _is_game_id(value) -> bool:
    return type(value) is int and 0 < value < 2 ** 31


def _milestones_summary(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"xp", "claims", "tier", "step"}:
        return False
    tier = value["tier"]
    step = value["step"]
    if (
        not _is_count(value["xp"])
        or not _is_count(value["claims"])
        or not isinstance(tier, str)
        or _TIER.fullmatch(tier) is None
        or type(step) is not int
        or not 1 <= step <= 4
    ):
        return False
    return dict(value)


def read_offer(key: bytes, message, nonce: str):
    if not _ours(message) or message.get("op") != "offer" or message.get("n") != nonce:
        return None
    body = {name: value for name, value in message.items() if name != "t"}
    if not verify(key, message.get("t"), "offer", canonical(body)):
        return None

    port = message.get("port")
    model = _clean_text(message.get("model"), _MODEL_MAX)
    host = _clean_text(message.get("host"), _HOST_MAX)
    game_id = message.get("gameId")
    title = message.get("title")
    counts = [message.get(name) for name in ("tracked", "notes")]
    milestones = _milestones_summary(message.get("milestones"))
    if (
        not is_device_id(message.get("id"))
        or type(port) is not int
        or not 0 < port < 65536
        or model is None
        or host is None
        or (game_id is not None and not _is_game_id(game_id))
        or (title is not None and not isinstance(title, str))
        or not all(value is None or _is_count(value) for value in counts)
        or milestones is False
    ):
        return None
    return {
        "id": message["id"],
        "model": model,
        "host": host,
        "port": port,
        "gameId": game_id,
        "title": None if title is None else _clean_text(title, _TITLE_MAX),
        "tracked": counts[0],
        "notes": counts[1],
        "milestones": milestones,
    }


def clean_title(value):
    return _clean_text(value, _TITLE_MAX) if isinstance(value, str) else None


def read_fetch(message):
    if not isinstance(message, dict) or message.get("op") != "fetch":
        return None
    version = message.get("v")
    if type(version) is not int or version != VERSION:
        return None
    nonce = message.get("nc")
    return nonce if is_nonce(nonce) else None


def fetch_params(kind: str, game_id, model: str, host: str) -> dict:
    return {"kind": kind, "gameId": game_id, "model": model, "host": host}


def read_fetch_params(raw):
    if not isinstance(raw, dict) or raw.get("kind") not in DATA_KINDS:
        return None
    game_id = raw.get("gameId")
    if game_id is not None and not _is_game_id(game_id):
        return None
    model = _clean_text(raw.get("model"), _MODEL_MAX)
    host = _clean_text(raw.get("host"), _HOST_MAX)
    if model is None or host is None:
        return None
    return {"kind": raw["kind"], "gameId": game_id, "model": model, "host": host}


def fetch_tag(key: bytes, nc: str, ns: str, params: dict) -> str:
    return sign(key, "fetch", nc, ns, canonical(params))


def data_tag(key: bytes, nc: str, ns: str, kind: str, size: int, digest: str) -> str:
    return sign(key, "data", nc, ns, kind, str(size), digest)


def read_data_header(key: bytes, message, nc: str, ns: str, kind: str):
    if not isinstance(message, dict) or message.get("op") != "data" or message.get("kind") != kind:
        return None
    size = message.get("size")
    digest = message.get("sha256")
    if type(size) is not int or not 0 < size <= MAX_DATA_BYTES or not is_tag(digest):
        return None
    if not verify(key, message.get("tag"), "data", nc, ns, kind, str(size), digest):
        return None
    return size, digest


def committed_tag(key: bytes, nc: str, ns: str, digest: str) -> str:
    return sign(key, "committed", nc, ns, digest)


def cleared_tag(key: bytes, nc: str, ns: str, digest: str) -> str:
    return sign(key, "cleared", nc, ns, digest)


def read_receipt(key: bytes, message, op: str, nc: str, ns: str, digest: str) -> bool:
    if not isinstance(message, dict) or message.get("op") != op:
        return False
    return verify(key, message.get("tag"), op, nc, ns, digest)


def device_label(model: str, host: str, address: str) -> str:
    name = _PRODUCTS.get(model, "SteamOS Device")
    if host and host != DEFAULT_HOST:
        return f"{name} · {host}"
    return f"{name} · {address}" if address else name
