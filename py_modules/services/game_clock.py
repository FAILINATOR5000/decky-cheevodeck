import threading
import time
from pathlib import Path

import decky
import rtc_formats
from services.round_saves import _write_real
from services.wii_saves import running
from utils import load_json_file, save_json_file

RECORD = "clock_returns.json"
CURRENT_SCHEMA_VERSION = 1
EXIT_WAIT_SECONDS = 30
EXIT_POLL_SECONDS = 1
RETROARCH = (b"retroarch",)


class GameClock:

    def __init__(self, *, runtime_dir):
        self._record = Path(runtime_dir) / RECORD
        self._lock = threading.Lock()

    def check(self, path: Path, aim: str, title: str, before_convert=None, reset: bool = True) -> str:
        if aim not in rtc_formats.SIZES:
            return ""
        data = _read(path)
        if data is None:
            return ""
        now = int(time.time())
        if rtc_formats.valid(aim, data, now):
            return ""
        name = _CORE_NAMES[aim]
        other = next(core for core in rtc_formats.SIZES if core != aim)
        try:
            if rtc_formats.valid(other, data, now):
                if before_convert is not None:
                    before_convert()
                _write_real(path, rtc_formats.convert(data, other, aim, now))
                decky.logger.info("clock: converted %s's clock file from %s's format to %s's", title,
                                  _CORE_NAMES[other], name)
                return "converted"
            base = rtc_formats.misread_gambatte(data, now)
            if base is not None:
                clock = rtc_formats.convert(rtc_formats.gambatte_clock(base), rtc_formats.GAMBATTE, aim, now)
                if before_convert is not None:
                    before_convert()
                _write_real(path, clock)
                decky.logger.info("clock: %s's clock file was a Gambatte clock SameBoy had misread, rebuilt it "
                                  "for %s", title, name)
                return "recovered"
            if reset and len(data) in rtc_formats.SIZES.values():
                if before_convert is not None:
                    before_convert()
                _write_real(path, rtc_formats.overflowed(aim, now))
                decky.logger.info("clock: %s's clock file holds a time no core can run, replaced it with one the "
                                  "game will ask to set (%s)", title, name)
                return "reset"
        except OSError as e:
            decky.logger.warning("clock: couldn't fix %s's clock file (%s)", title, type(e).__name__)
        return ""

    def hold(self, path: Path, launched: str, owner: str, title: str) -> None:
        with self._lock:
            returns = [row for row in self._load() if row["path"] != str(path)]
            returns.append({"path": str(path), "launched": launched, "owner": owner, "title": title,
                            "at": time.time()})
            self._save(returns)

    def held(self) -> bool:
        return bool(self._load())

    def put_back(self, wait: float = 0) -> bool:
        if not self.held():
            return False
        began = time.time()
        until = time.monotonic() + wait
        while running(RETROARCH):
            if time.monotonic() >= until:
                decky.logger.info("clock: RetroArch is still running, the clock goes back to its own format later")
                return False
            time.sleep(EXIT_POLL_SECONDS)
        with self._lock:
            returns = self._load()
            due = [row for row in returns if row["at"] <= began]
            for row in due:
                self.check(Path(row["path"]), row["owner"], row["title"], reset=False)
            self._save([row for row in returns if row["at"] > began])
        return bool(due)

    def _load(self) -> list:
        raw = load_json_file(self._record, None)
        if not isinstance(raw, dict) or not isinstance(raw.get("returns"), list):
            return []
        return [row for row in raw["returns"] if _valid(row)]

    def _save(self, returns: list) -> None:
        try:
            if returns:
                save_json_file(self._record, {"schemaVersion": CURRENT_SCHEMA_VERSION, "returns": returns})
            else:
                self._record.unlink(missing_ok=True)
        except OSError as e:
            decky.logger.warning("clock: couldn't write %s (%s)", RECORD, type(e).__name__)


_CORE_NAMES = {rtc_formats.GAMBATTE: "Gambatte", rtc_formats.SAMEBOY: "SameBoy"}


def _valid(row) -> bool:
    return isinstance(row, dict) and isinstance(row.get("path"), str) and row["path"].startswith("/") \
        and row.get("launched") in rtc_formats.SIZES and row.get("owner") in rtc_formats.SIZES \
        and row["launched"] != row["owner"] and isinstance(row.get("title"), str) \
        and type(row.get("at")) in (int, float)


def _read(path: Path):
    try:
        return path.read_bytes()
    except OSError:
        return None
