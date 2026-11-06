import threading
from pathlib import Path

import decky

from utils import (
    NewerSchemaFile,
    is_newer_schema,
    load_json_file,
    refuse_newer_file,
    report_newer_schema,
    save_json_file,
)


CURRENT_SCHEMA_VERSION = 1
FILENAME = "stream_play.json"


class StreamStore:
    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()

    def _path(self) -> Path:
        return self._base_dir / FILENAME

    def _read(self) -> dict:
        raw = load_json_file(self._path(), {})
        if is_newer_schema(raw, CURRENT_SCHEMA_VERSION):
            report_newer_schema(self._path())
            return {}
        return raw if isinstance(raw, dict) else {}

    def get(self) -> dict:
        with self._lock:
            raw = self._read()
        version = raw.get("sunshineVersion")
        path = raw.get("sunshinePath")
        appid = raw.get("moonlightAppid")
        return {
            "sunshineVersion": version if isinstance(version, str) else "",
            "sunshinePath": path if isinstance(path, str) else "",
            "moonlightAppid": appid if type(appid) is int and appid > 0 else 0,
        }

    def moonlight_ours(self) -> bool:
        with self._lock:
            return self._read().get("moonlightOurs") is True

    def update(self, **fields) -> bool:
        with self._lock:
            current = self._read()
            row = {
                "sunshineVersion": current.get("sunshineVersion", ""),
                "sunshinePath": current.get("sunshinePath", ""),
                "moonlightAppid": current.get("moonlightAppid", 0),
                "moonlightOurs": current.get("moonlightOurs") is True,
            }
            for key, value in fields.items():
                if key in row:
                    row[key] = value
            try:
                refuse_newer_file(self._path(), CURRENT_SCHEMA_VERSION)
                save_json_file(self._path(), {"schemaVersion": CURRENT_SCHEMA_VERSION, **row}, compact=True)
            except NewerSchemaFile:
                return False
            except OSError as e:
                decky.logger.warning("stream: couldn't save the install record (%s)", type(e).__name__)
                return False
            return True

    def clear(self) -> None:
        with self._lock:
            try:
                self._path().unlink(missing_ok=True)
            except OSError as e:
                decky.logger.warning("stream: couldn't clear the install record (%s)", type(e).__name__)
