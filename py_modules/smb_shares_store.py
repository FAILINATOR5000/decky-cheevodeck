from pathlib import Path

import re
import threading
import time
import unicodedata
import uuid

from utils import ensure_dir, load_json_file, save_json_file, to_int


NAME_MAX_LEN = 64
SHARE_MAX_LEN = 80
SERVER_MAX_LEN = 255
USERNAME_MAX_LEN = 128
PASSWORD_MAX_LEN = 128
DOMAIN_MAX_LEN = 128

SLUG_MAX_LEN = 48

MAX_SHARES = 64

ALLOWED_SMB_VERSIONS = ("auto", "3.1.1", "3.0", "2.1", "2.0", "1.0")

CURRENT_SCHEMA_VERSION = 1

_SLUG_STRIP_RE = re.compile(r"[^a-z0-9_]+")

_IPV4_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")
_IPV6_RE = re.compile(r"^[0-9A-Fa-f:]{2,}$")
_HOSTNAME_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$")

_SHARE_RE = re.compile(r"^[A-Za-z0-9._$ -]+$")


def _has_control_chars(value: str) -> bool:
    return any(ord(ch) < 32 or ord(ch) == 127 for ch in value)


def slugify(name: str) -> str:
    """Turn a display name into the identity that every filesystem path hangs off.

    Generated once at creation and then immutable, which is the single most
    important rule in this store: the slug is what
    /run/media/cheevodeck/<slug> and both unit filenames are built from, so a
    slug that tracked the name would silently move a live mount out from under
    every RetroArch playlist and Kodi source pointing at it.

    Returns "" when the name has nothing usable in it — an all-emoji or all-CJK
    name is entirely realistic across eight locales — and the caller falls back
    to a numbered slug.
    """
    lowered = str(name or "").strip().lower()
    folded = unicodedata.normalize("NFKD", lowered)
    ascii_only = folded.encode("ascii", "ignore").decode("ascii")
    collapsed = _SLUG_STRIP_RE.sub("_", ascii_only)
    return collapsed.strip("_")[:SLUG_MAX_LEN].strip("_")


def unique_slug(base: str, taken) -> str:
    """Settle a slug against the ones already in use.

    Two different names can slugify identically ("Movies NAS" and "movies-nas"
    both land on movies_nas), so a collision gets a _2, _3 suffix. An empty base
    means slugify found nothing usable, and we fall back to mount_<n>.

    The caller is expected to feed `taken` from the store *and* from whatever is
    actually on disk, so a stale unit file left behind by a previous install
    can't be silently adopted.
    """
    taken = set(taken)
    if not base:
        index = 1
        while f"mount_{index}" in taken:
            index += 1
        return f"mount_{index}"

    if base not in taken:
        return base

    index = 2
    while True:
        suffix = f"_{index}"
        candidate = f"{base[:SLUG_MAX_LEN - len(suffix)]}{suffix}"
        if candidate not in taken:
            return candidate
        index += 1


def validate_name(value) -> str:
    if not isinstance(value, str):
        return "name_required"
    name = value.strip()
    if not name:
        return "name_required"
    if len(name) > NAME_MAX_LEN:
        return "name_too_long"
    if _has_control_chars(name):
        return "name_invalid"
    return None


def validate_server(value) -> str:
    if not isinstance(value, str):
        return "server_required"
    server = value.strip()
    if not server:
        return "server_required"
    if len(server) > SERVER_MAX_LEN:
        return "server_too_long"
    if _has_control_chars(server):
        return "server_invalid"
    if any(ch in server for ch in ',/\\ "\''):
        return "server_invalid"
    if _IPV4_RE.match(server):
        if any(int(part) > 255 for part in server.split(".")):
            return "server_invalid"
        return None
    if ":" in server:
        return None if _IPV6_RE.match(server) else "server_invalid"
    return None if _HOSTNAME_RE.match(server) else "server_invalid"


def validate_share(value) -> str:
    if not isinstance(value, str):
        return "share_required"
    share = value.strip()
    if not share:
        return "share_required"
    if len(share) > SHARE_MAX_LEN:
        return "share_too_long"
    if _has_control_chars(share):
        return "share_invalid"
    return None if _SHARE_RE.match(share) else "share_invalid"


def validate_credential_field(value, *, kind: str, max_len: int) -> str:
    """Shared rules for username and domain.

    Both land in the credentials file as `key=value` lines, which is where the
    newline rule comes from: a username of "bob\\npassword=whatever" would inject
    a line and silently swap the password out from under us. This is the
    validation rule most likely to be skipped, so it lives in one place that
    both fields go through.
    """
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        return f"{kind}_invalid"
    if len(value) > max_len:
        return f"{kind}_too_long"
    if _has_control_chars(value):
        return f"{kind}_invalid"
    if "," in value:
        return f"{kind}_invalid"
    return None


def validate_username(value) -> str:
    return validate_credential_field(value, kind="username", max_len=USERNAME_MAX_LEN)


def validate_domain(value) -> str:
    return validate_credential_field(value, kind="domain", max_len=DOMAIN_MAX_LEN)


def validate_password(value) -> str:
    """The password never reaches the store — it goes straight to the .cred file
    — but it validates here so the whole of 6.6 reads in one place.

    Commas are fine, unlike every other field: this value only ever lands in the
    credentials file, never on a comma-separated options line. Newlines and
    control characters are not, for the injection reason in
    validate_credential_field.
    """
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        return "password_invalid"
    if len(value) > PASSWORD_MAX_LEN:
        return "password_too_long"
    if _has_control_chars(value):
        return "password_invalid"
    return None


def validate_vers(value) -> str:
    return None if value in ALLOWED_SMB_VERSIONS else "vers_invalid"


def is_safe_slug(value) -> bool:
    """Last gate before a slug reaches a path or a unit filename.

    Belt and braces: slugs are generated here and never accepted from the
    frontend, so this should always pass. It runs anyway because the one place
    it could fail — a hand-edited smb_shares.json, or a sidecar rebuilt from
    disk — is exactly the place a bad value would turn into a path.
    """
    if not isinstance(value, str) or not value:
        return False
    if len(value) > SLUG_MAX_LEN:
        return False
    return bool(re.fullmatch(r"[a-z0-9_]+", value))


class SmbSharesStore:
    """The configured SMB shares for the SMB Shares utility.

    One JSON file (smb_shares.json) holding every record. Like the Dolphin
    mappings store this one is global rather than per-ULID — mounts are
    hardware and network config, not RA content — so main.py builds it once and
    leaves it out of _apply_user_scope.

    The important thing to know before touching this: **the file is a cache, not
    the source of truth.** Every record is mirrored to a sidecar at
    /etc/cheevodeck/smb/<slug>.json, and the store rebuilds from those. That's
    what keeps a factory reset (which empties runtime_dir) from orphaning live
    mounts, and what lets a reinstalled plugin re-adopt mounts it created in a
    previous life. Any code that treats smb_shares.json as authoritative is
    wrong.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def _path(self) -> Path:
        return self._base_dir / "smb_shares.json"

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "shares": [],
        }

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()

        schema = to_int(raw.get("schemaVersion", 0), 0)
        if schema != CURRENT_SCHEMA_VERSION:
            return self._empty_file()

        return self._normalize_file(raw)

    def _save_raw(self, data: dict) -> None:
        save_json_file(self._path(), data, compact=True)

    def _normalize_file(self, raw: dict) -> dict:
        raw_shares = raw.get("shares")
        if not isinstance(raw_shares, list):
            raw_shares = []

        shares = []
        seen_slugs = set()
        for entry in raw_shares[:MAX_SHARES]:
            cleaned = self._clean_share(entry)
            if cleaned is None:
                continue
            if cleaned["slug"] in seen_slugs:
                continue
            seen_slugs.add(cleaned["slug"])
            shares.append(cleaned)

        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "shares": shares,
        }

    def _clean_share(self, raw) -> dict:
        """Tolerant read-back, unlike the strict validation the write paths run.

        A field we can coerce gets coerced; a record we can't build a safe path
        from gets dropped entirely. That asymmetry is deliberate — a bad
        display name is cosmetic, a bad slug is a path.
        """
        if not isinstance(raw, dict):
            return None

        slug = raw.get("slug")
        if not is_safe_slug(slug):
            return None

        server = raw.get("server")
        share = raw.get("share")
        if validate_server(server) or validate_share(share):
            return None

        share_id = raw.get("id")
        if not isinstance(share_id, str) or not share_id:
            share_id = self._new_share_id()

        name = raw.get("name")
        if not isinstance(name, str) or not name.strip():
            name = slug
        name = name.strip()[:NAME_MAX_LEN]

        vers = raw.get("vers")
        if vers not in ALLOWED_SMB_VERSIONS:
            vers = "auto"

        username = raw.get("username")
        if not isinstance(username, str) or validate_username(username):
            username = ""
        domain = raw.get("domain")
        if not isinstance(domain, str) or validate_domain(domain):
            domain = ""

        now = int(time.time())
        return {
            "id": share_id,
            "slug": slug,
            "name": name,
            "server": str(server).strip(),
            "share": str(share).strip(),
            "username": username.strip(),
            "hasPassword": bool(raw.get("hasPassword", False)),
            "domain": domain.strip(),
            "vers": vers,
            "softMount": bool(raw.get("softMount", True)),
            "createdAt": to_int(raw.get("createdAt", now), now),
        }

    def _new_share_id(self) -> str:
        return f"smb_{uuid.uuid4().hex}"

    def _find(self, data: dict, share_id: str):
        for item in data["shares"]:
            if item["id"] == share_id:
                return item
        return None

    def load_all(self) -> dict:
        with self._lock:
            return self._load_raw()

    def list_shares(self) -> list:
        return self.load_all()["shares"]

    def get_by_id(self, share_id: str):
        if not isinstance(share_id, str) or not share_id:
            return None
        with self._lock:
            data = self._load_raw()
            found = self._find(data, share_id)
        return dict(found) if found is not None else None

    def validate_new(self, payload, *, extra_taken_slugs=None) -> dict:
        """Check an add payload and settle its slug, without writing anything.

        Split out from `add` so the mount service can render units and write the
        credentials file for a share that doesn't exist in the store yet — the
        store entry is written last, once the system state has actually taken.
        """
        if not isinstance(payload, dict):
            return {"ok": False, "error": "invalid_payload"}

        for field, checker in (
            ("name", validate_name),
            ("server", validate_server),
            ("share", validate_share),
            ("username", validate_username),
            ("domain", validate_domain),
        ):
            error = checker(payload.get(field))
            if error:
                return {"ok": False, "error": error, "field": field}

        error = validate_vers(payload.get("vers", "auto"))
        if error:
            return {"ok": False, "error": error, "field": "vers"}

        error = validate_password(payload.get("password"))
        if error:
            return {"ok": False, "error": error, "field": "password"}

        name = str(payload["name"]).strip()

        with self._lock:
            data = self._load_raw()
            if len(data["shares"]) >= MAX_SHARES:
                return {"ok": False, "error": "too_many_shares"}
            for item in data["shares"]:
                if item["name"].casefold() == name.casefold():
                    return {"ok": False, "error": "duplicate_name", "field": "name"}
            taken = {item["slug"] for item in data["shares"]}

        taken |= set(extra_taken_slugs or ())
        slug = unique_slug(slugify(name), taken)
        if not is_safe_slug(slug):
            return {"ok": False, "error": "slug_failed", "field": "name"}

        username = str(payload.get("username") or "").strip()
        password = str(payload.get("password") or "")
        return {
            "ok": True,
            "share": {
                "id": self._new_share_id(),
                "slug": slug,
                "name": name,
                "server": str(payload["server"]).strip(),
                "share": str(payload["share"]).strip(),
                "username": username,
                "hasPassword": bool(password),
                "domain": str(payload.get("domain") or "").strip(),
                "vers": payload.get("vers", "auto"),
                "softMount": bool(payload.get("softMount", True)),
                "createdAt": int(time.time()),
            },
        }

    def validate_update(self, existing: dict, payload) -> dict:
        """Check an edit payload against the record it's editing.

        Name and slug are immutable, so a payload carrying a name is rejected
        rather than quietly ignored — silently dropping a field the caller
        clearly meant to change is how a frontend bug goes unnoticed. Everything
        else is editable, and none of it moves the mount point, so an edit can
        never break a ROM path pointing at this share.
        """
        if not isinstance(payload, dict):
            return {"ok": False, "error": "invalid_payload"}
        if "name" in payload and str(payload["name"]).strip() != existing["name"]:
            return {"ok": False, "error": "name_immutable", "field": "name"}
        if "slug" in payload and payload["slug"] != existing["slug"]:
            return {"ok": False, "error": "slug_immutable", "field": "slug"}

        for field, checker in (
            ("server", validate_server),
            ("share", validate_share),
            ("username", validate_username),
            ("domain", validate_domain),
        ):
            error = checker(payload.get(field, existing[field]))
            if error:
                return {"ok": False, "error": error, "field": field}

        vers = payload.get("vers", existing["vers"])
        error = validate_vers(vers)
        if error:
            return {"ok": False, "error": error, "field": "vers"}

        password = payload.get("password")
        error = validate_password(password)
        if error:
            return {"ok": False, "error": error, "field": "password"}

        updated = dict(existing)
        updated["server"] = str(payload.get("server", existing["server"])).strip()
        updated["share"] = str(payload.get("share", existing["share"])).strip()
        updated["username"] = str(payload.get("username", existing["username"]) or "").strip()
        updated["domain"] = str(payload.get("domain", existing["domain"]) or "").strip()
        updated["vers"] = vers
        updated["softMount"] = bool(payload.get("softMount", existing["softMount"]))
        return {"ok": True, "share": updated}

    def put(self, share: dict) -> dict:
        """Insert or replace a record wholesale.

        Deliberately dumb: the system side has already succeeded by the time
        this runs, so this is the last step of a create or an edit rather than
        the thing that decides whether one is allowed.
        """
        cleaned = self._clean_share(share)
        if cleaned is None:
            return {"ok": False, "error": "invalid_share"}

        with self._lock:
            data = self._load_raw()
            existing = self._find(data, cleaned["id"])
            if existing is not None:
                cleaned["createdAt"] = existing.get("createdAt", cleaned["createdAt"])
                for index, item in enumerate(data["shares"]):
                    if item["id"] == cleaned["id"]:
                        data["shares"][index] = cleaned
                        break
            else:
                if len(data["shares"]) >= MAX_SHARES:
                    return {"ok": False, "error": "too_many_shares"}
                data["shares"].append(cleaned)
            self._save_raw(data)

        return {"ok": True, "share": cleaned}

    def delete(self, share_id: str) -> dict:
        if not isinstance(share_id, str) or not share_id:
            return {"ok": False, "error": "invalid_share_id"}

        with self._lock:
            data = self._load_raw()
            before = len(data["shares"])
            data["shares"] = [s for s in data["shares"] if s["id"] != share_id]
            if len(data["shares"]) == before:
                return {"ok": False, "error": "not_found"}
            self._save_raw(data)

        return {"ok": True}

    def replace_all(self, shares) -> dict:
        """Overwrite the whole file. This is the rehydrate path.

        The mount service calls it after rebuilding records from the sidecars in
        /etc/cheevodeck/smb/, which is the one situation where the file on disk
        is provably less trustworthy than what it's being replaced with.
        """
        cleaned = []
        seen_slugs = set()
        for entry in list(shares)[:MAX_SHARES]:
            item = self._clean_share(entry)
            if item is None or item["slug"] in seen_slugs:
                continue
            seen_slugs.add(item["slug"])
            cleaned.append(item)

        with self._lock:
            self._save_raw({
                "schemaVersion": CURRENT_SCHEMA_VERSION,
                "shares": cleaned,
            })

        return {"ok": True, "shares": cleaned}
