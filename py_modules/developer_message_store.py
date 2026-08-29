import threading
from pathlib import Path

from utils import ensure_dir, load_json_file, save_json_file, to_int


CURRENT_SCHEMA_VERSION = 1

DEVELOPER_MESSAGE_FILENAME = "developer_message.json"


class DeveloperMessageStore:
    """What this device knows about the developer's broadcast message.

    The message itself lives on the GitHub repo and is polled; this is
    where the answer is remembered between ticks. Four things:

      - messageId  — the id parsed from the file, which is what "is this
                     new?" compares on. Either the token from the `#id`
                     line or a hash of the body when there isn't one.
      - body       — what the current message says. Nothing reads it back:
                     the card carries its own copy, so an archived card
                     keeps the message that was archived rather than
                     whatever is current. Kept because it is the honest
                     record of the cached message, and because reading
                     this file is how you find out on device what the
                     plugin currently thinks the message is.
      - seeded     — has this install ever completed a fetch? The first
                     one records and stays quiet, so a new install is
                     never greeted by a message that has been sitting on
                     the repo for months.
      - lastCheckedAt — the poll gate.

    Global rather than per-account: the directory sits at the runtime_dir
    root and never repoints, so there is deliberately no repoint() here
    for _apply_user_scope to call. A message from the developer is
    addressed to the person holding the device, not to an RA account.

    Re-reads from disk on every call rather than holding the file in
    memory. That is what lets it survive a factory reset mid-session:
    the reset empties runtime_dir, and the next read simply finds
    nothing and returns the empty file rather than serving a stale
    handle.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def _path(self) -> Path:
        return self._base_dir / DEVELOPER_MESSAGE_FILENAME

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "messageId": "",
            "body": "",
            "seeded": False,
            "lastCheckedAt": 0,
        }

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()
        if to_int(raw.get("schemaVersion", 0), 0) != CURRENT_SCHEMA_VERSION:
            return self._empty_file()
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "messageId": str(raw.get("messageId") or "").strip(),
            "body": str(raw.get("body") or ""),
            "seeded": bool(raw.get("seeded", False)),
            "lastCheckedAt": to_int(raw.get("lastCheckedAt"), 0),
        }

    def load(self) -> dict:
        with self._lock:
            return self._load_raw()

    def record(self, message_id: str, body: str, checked_at: int) -> None:
        """Cache a message and mark the install seeded.

        Seeding and recording are the same write on purpose: the first
        successful fetch takes this path too, and the only difference
        is that its caller doesn't go on to raise a notification.
        """
        with self._lock:
            save_json_file(self._path(), {
                "schemaVersion": CURRENT_SCHEMA_VERSION,
                "messageId": str(message_id or "").strip(),
                "body": str(body or ""),
                "seeded": True,
                "lastCheckedAt": to_int(checked_at, 0),
            }, compact=True)

    def touch_checked(self, checked_at: int) -> None:
        with self._lock:
            data = self._load_raw()
            data["lastCheckedAt"] = to_int(checked_at, 0)
            save_json_file(self._path(), data, compact=True)

    def clear(self) -> None:
        with self._lock:
            save_json_file(self._path(), self._empty_file(), compact=True)
