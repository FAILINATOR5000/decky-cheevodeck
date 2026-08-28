import threading
import time
from pathlib import Path
from typing import Any, Optional

from utils import ensure_dir, load_json_file, save_json_file, to_int


CURRENT_SCHEMA_VERSION = 1

BASELINES_FILENAME = "comment_baselines.json"


class CommentBaselinesStore:
    """Per-section "what had we already seen" watermarks for the Comments Service.

    The Comments Service polls a handful of followed comment threads (and the
    user's own wall) every few minutes and needs to know which comments it has
    already notified about. That's all this holds: one watermark per section,
    keyed the same way the subscriptions store keys a thread ("<kind>:<id>")
    plus a single "wall:<ulid>" key for the wall pass. ULID, not username:
    keying the wall on a name meant a self-rename pointed at a fresh key with
    no watermark. Name is still the fallback for a legacy account with no ULID
    stored, so both shapes can appear in an old file.

    Each watermark is:
      - ts            -- the newest comment timestamp seen on that section.
                         RA hands these back as "YYYY-MM-DD HH:MM:SS" (UTC);
                         we store the canonical form as-is.
      - fingerprints  -- the "(user, text)" identities of every comment
                         sitting at exactly ts. Comments can share a second,
                         so the timestamp alone can't tell a brand-new
                         same-second post from one we already counted; the
                         fingerprint set is the tie-breaker.

    Deliberately NOT shoehorned into CacheStore: that store is typed (named
    load_*/save_* methods, no generic key-value), so a free-form watermark map
    doesn't belong there. This is its own little JSON file under the runtime
    dir, exactly like subscriptions.json, guarded by one lock for the whole
    read-modify-write -- same threading.Lock reasoning the subscriptions and
    tracked-sets stores use, since the service writes from its own thread.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def repoint(self, base_dir: Path) -> None:
        with self._lock:
            self._base_dir = base_dir
            ensure_dir(self._base_dir)

    def base_dir(self) -> Path:
        with self._lock:
            return self._base_dir

    def _path(self) -> Path:
        return self._base_dir / BASELINES_FILENAME

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "baselines": {},
        }

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return self._empty_file()
        baselines = raw.get("baselines")
        if not isinstance(baselines, dict):
            return self._empty_file()
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "baselines": baselines,
        }

    def get(self, key: str) -> Optional[dict]:
        with self._lock:
            data = self._load_raw()
        entry = data["baselines"].get(key)
        if not isinstance(entry, dict):
            return None
        return {
            "ts": str(entry.get("ts") or ""),
            "fingerprints": list(entry.get("fingerprints") or []),
            "createdAt": to_int(entry.get("createdAt", 0), 0),
        }

    def set(self, key: str, ts: str, fingerprints: Any) -> None:
        clean_fingerprints = [str(fingerprint) for fingerprint in (fingerprints or [])]
        with self._lock:
            data = self._load_raw()
            data["baselines"][key] = {
                "ts": str(ts or ""),
                "fingerprints": clean_fingerprints,
                "createdAt": int(time.time()),
            }
            save_json_file(self._path(), data, compact=True)

    def set_if_absent(self, key: str, ts: str, fingerprints: Any) -> bool:
        clean_fingerprints = [str(fingerprint) for fingerprint in (fingerprints or [])]
        with self._lock:
            data = self._load_raw()
            if isinstance(data["baselines"].get(key), dict):
                return False
            data["baselines"][key] = {
                "ts": str(ts or ""),
                "fingerprints": clean_fingerprints,
                "createdAt": int(time.time()),
            }
            save_json_file(self._path(), data, compact=True)
            return True

    def keys(self) -> list:
        with self._lock:
            data = self._load_raw()
        return list(data["baselines"].keys())

    def remove(self, key: str) -> bool:
        with self._lock:
            data = self._load_raw()
            if key not in data["baselines"]:
                return False
            del data["baselines"][key]
            save_json_file(self._path(), data, compact=True)
            return True

    def clear(self) -> int:
        with self._lock:
            data = self._load_raw()
            count = len(data["baselines"])
            save_json_file(self._path(), self._empty_file(), compact=True)
            return count
