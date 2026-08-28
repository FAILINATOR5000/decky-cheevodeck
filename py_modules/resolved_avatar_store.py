import threading
from pathlib import Path
from typing import Optional

from utils import ensure_dir, load_json_file, save_json_file, to_int


CURRENT_SCHEMA_VERSION = 1

RESOLVED_AVATARS_FILENAME = "resolved_avatars.json"

VERDICT_TTL_SECONDS = 7 * 24 * 60 * 60


class ResolvedAvatarStore:
    """ULID-keyed record of "we already figured out this friend's avatar".

    The friend-pic healer makes at most one paced profile call per
    renamed friend to learn where their real avatar actually lives,
    then never wants to ask again until a TTL lapses. This is where it
    remembers the answer. Keyed by ULID rather than username because RA
    usernames are not stable -- a rename keeps the same ULID, so a
    verdict filed under it survives the rename that caused the problem
    in the first place.

    Each verdict is:
      - userPic    -- the avatar path RA's profile returned for this
                      user, e.g. "/UserPic/Andrey199650.png". An EMPTY
                      string is a real verdict too: "checked, this user
                      is genuinely avatarless, the default joystick is
                      their correct picture." Both cases mean "stop
                      asking", which is the whole point of the cooldown.
      - checkedAt  -- epoch seconds the verdict was recorded, for the
                      TTL the healer gates on.
      - mode       -- "fast" or "accurate": which path settled this
                      verdict. The fast path trusts any real picture
                      sitting at the user's convention file; the accurate
                      path asks their profile where the picture actually
                      lives, which is the only way to catch a friend who
                      renamed INTO a name somebody else had already
                      uploaded a picture under. The healer's gate reads
                      this so that turning Verify on puts the friends it
                      settled fast back in the queue, while an accurate
                      verdict satisfies a friend who only needs fast.
                      A verdict written before this field existed has no
                      mode and reads as "fast", which is simply true.

    Same shape as CommentBaselinesStore on purpose: its own little JSON
    file under the runtime dir, one threading.Lock around the whole
    read-modify-write since the healer writes from its own thread, and
    a forgiving load so a missing or corrupt file just means "no
    verdicts yet" instead of crashing a background tick.

    The same file also carries two side tables the healer leans on:

      - names    -- a username->userPic routing index. Verdicts are
                    keyed by ULID (stable across renames), but the fetch
                    path only ever has a username. When the healer
                    settles a renamed friend, it drops a username->path
                    line here so a later avatar fetch can route straight
                    to the real picture without re-profiling. Only
                    renamed friends land in here; avatarless and
                    living-at-their-own-name friends don't need a route.
      - probeHash -- the last-good sha256 of RA's default joystick
                    avatar, learned from the two-name sentinel probe.
                    Persisted so a fresh boot starts from the last known
                    answer instead of an empty fingerprint set while the
                    first probe runs.

    Kept deliberately out of CacheStore (typed load_*/save_* methods,
    no free-form key-value) and out of the normal cache wipe -- a
    "clear image cache" has no business throwing away verdicts that are
    tiny, self-correcting, and expensive to rebuild.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def _path(self) -> Path:
        return self._base_dir / RESOLVED_AVATARS_FILENAME

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "verdicts": {},
            "names": {},
            "probeHash": "",
            "self": {"name": "", "checkedAt": 0},
        }

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return self._empty_file()
        verdicts = raw.get("verdicts")
        if not isinstance(verdicts, dict):
            verdicts = {}
        names = raw.get("names")
        if not isinstance(names, dict):
            names = {}
        probe_hash = raw.get("probeHash")
        if not isinstance(probe_hash, str):
            probe_hash = ""
        self_entry = raw.get("self")
        if not isinstance(self_entry, dict):
            self_entry = {}
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "verdicts": verdicts,
            "names": names,
            "probeHash": probe_hash,
            "self": {
                "name": str(self_entry.get("name") or "").strip().lower(),
                "checkedAt": to_int(self_entry.get("checkedAt"), 0),
            },
        }

    def get(self, ulid: str) -> Optional[dict]:
        key = str(ulid or "")
        if not key:
            return None
        with self._lock:
            data = self._load_raw()
        entry = data["verdicts"].get(key)
        if not isinstance(entry, dict):
            return None
        mode = str(entry.get("mode") or "").strip().lower()
        if mode != "accurate":
            mode = "fast"
        return {
            "userPic": str(entry.get("userPic") or ""),
            "checkedAt": to_int(entry.get("checkedAt"), 0),
            "mode": mode,
        }

    def set(self, ulid: str, user_pic: str, checked_at: int, username: str = "", mode: str = "fast") -> None:
        key = str(ulid or "")
        if not key:
            return
        pic = str(user_pic or "")
        name_key = str(username or "").strip().lower()
        mode_key = "accurate" if str(mode or "").strip().lower() == "accurate" else "fast"
        with self._lock:
            data = self._load_raw()
            data["verdicts"][key] = {
                "userPic": pic,
                "checkedAt": to_int(checked_at, 0),
                "mode": mode_key,
            }
            if name_key and pic:
                data["names"][name_key] = pic
            elif name_key:
                data["names"].pop(name_key, None)
            save_json_file(self._path(), data, compact=True)

    def prune(self, live_friends) -> tuple:
        live_ulids = set()
        live_names = set()
        for ulid, username in live_friends:
            key = str(ulid or "").strip()
            if key:
                live_ulids.add(key)
            name_key = str(username or "").strip().lower()
            if name_key:
                live_names.add(name_key)

        with self._lock:
            data = self._load_raw()
            verdicts = data["verdicts"]
            names = data["names"]

            dead_ulids = [u for u in verdicts if u not in live_ulids]
            dead_names = [n for n in names if n not in live_names]
            if not dead_ulids and not dead_names:
                return (0, 0)

            for u in dead_ulids:
                del verdicts[u]
            for n in dead_names:
                del names[n]
            save_json_file(self._path(), data, compact=True)
            return (len(dead_ulids), len(dead_names))

    def clear(self) -> dict:
        with self._lock:
            data = self._load_raw()
            verdicts_cleared = len(data["verdicts"])
            routes_cleared = len(data["names"])
            save_json_file(self._path(), self._empty_file(), compact=True)
            return {
                "verdicts": verdicts_cleared,
                "routes": routes_cleared,
            }

    def clear_verdicts(self) -> dict:
        with self._lock:
            data = self._load_raw()
            verdicts_cleared = len(data["verdicts"])
            data["verdicts"] = {}
            data["self"] = {"name": "", "checkedAt": 0}
            save_json_file(self._path(), data, compact=True)
            return {"verdicts": verdicts_cleared}

    def get_user_pics_for_usernames(self, usernames) -> dict:
        wanted = set()
        for raw in usernames or []:
            name_key = str(raw or "").strip().lower()
            if name_key:
                wanted.add(name_key)
        if not wanted:
            return {}
        with self._lock:
            data = self._load_raw()
        names = data["names"]
        routes = {}
        for name_key in wanted:
            pic = names.get(name_key)
            if isinstance(pic, str) and pic:
                routes[name_key] = pic
        return routes

    def get_self(self) -> dict:
        with self._lock:
            data = self._load_raw()
        entry = data.get("self")
        if not isinstance(entry, dict):
            return {"name": "", "checkedAt": 0}
        return {
            "name": str(entry.get("name") or "").strip().lower(),
            "checkedAt": to_int(entry.get("checkedAt"), 0),
        }

    def set_self(self, name: str, user_pic: str, checked_at: int) -> None:
        name_key = str(name or "").strip().lower()
        pic = str(user_pic or "")
        with self._lock:
            data = self._load_raw()
            data["self"] = {"name": name_key, "checkedAt": to_int(checked_at, 0)}
            if name_key and pic:
                data["names"][name_key] = pic
            elif name_key:
                data["names"].pop(name_key, None)
            save_json_file(self._path(), data, compact=True)

    def get_probe_hash(self) -> Optional[str]:
        with self._lock:
            data = self._load_raw()
        probe_hash = data.get("probeHash")
        if not isinstance(probe_hash, str) or not probe_hash:
            return None
        return probe_hash

    def set_probe_hash(self, probe_hash: str) -> None:
        value = str(probe_hash or "").strip()
        if not value:
            return
        with self._lock:
            data = self._load_raw()
            data["probeHash"] = value
            save_json_file(self._path(), data, compact=True)
