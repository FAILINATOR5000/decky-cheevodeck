import gzip
import io
import threading
import time
import urllib.error
import urllib.request

import decky

from services._tick_common import GenerationFence
from services.update_checker_service import GITHUB_OWNER, GITHUB_REPO
from ra_client import build_user_agent
from video_filter_store import MAX_FILE_BYTES, parse_video_filters


FILTER_URL = "https://raw.githubusercontent.com/%s/%s/main/filters/v1/video.json" % (GITHUB_OWNER, GITHUB_REPO)

CHECK_INTERVAL_SECONDS = 12 * 60 * 60

RETRY_SECONDS = 60 * 60

TICK_SECONDS = 15 * 60

STARTUP_DELAY_SECONDS = 20.0

FETCH_TIMEOUT_SECONDS = 15

MAX_WIRE_BYTES = 64 * 1024


_generation_fence = GenerationFence()


class FetchFailure(Exception):
    pass


def read_filter_bytes(ssl_context) -> bytes:
    request = urllib.request.Request(
        FILTER_URL,
        headers={"User-Agent": build_user_agent(), "Accept-Encoding": "gzip"},
    )
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS, context=ssl_context) as response:
            body = response.read(MAX_WIRE_BYTES + 1)
            encoding = str(response.headers.get("Content-Encoding") or "").lower()
    except urllib.error.HTTPError as exc:
        raise FetchFailure("http %s" % exc.code) from exc
    except Exception as exc:
        raise FetchFailure(type(exc).__name__) from exc
    if len(body) > MAX_WIRE_BYTES:
        raise FetchFailure("oversize")
    if encoding == "gzip":
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(body)) as stream:
                body = stream.read(MAX_FILE_BYTES + 1)
        except (OSError, EOFError) as exc:
            raise FetchFailure("bad gzip") from exc
    if len(body) > MAX_FILE_BYTES:
        raise FetchFailure("oversize")
    return body


class VideoFilterService:
    def __init__(self, *, settings_store, browser_store, filter_store, ssl_context):
        self._settings_store = settings_store
        self._browser_store = browser_store
        self._filters = filter_store
        self._ssl_context = ssl_context

        self._thread = None
        self._stop_event = threading.Event()
        self._lifecycle_lock = threading.Lock()
        self._check_lock = threading.Lock()
        self._generation = -1
        self._debug_logging = False

    def _debug_log(self, message, *args):
        if self._debug_logging:
            decky.logger.info(message, *args)

    def start(self):
        with self._lifecycle_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._generation = _generation_fence.claim()
            thread = threading.Thread(target=self._run_loop, name="video-filters", daemon=True)
            self._thread = thread
        thread.start()
        decky.logger.info("video filters: thread started (generation %d)", self._generation)

    def stop(self):
        self._stop_event.set()
        decky.logger.info("video filters: stop requested")

    def poke(self):
        threading.Thread(target=self._safe_check, name="video-filters-poke", daemon=True).start()

    def _run_loop(self):
        my_generation = self._generation
        if self._stop_event.wait(STARTUP_DELAY_SECONDS):
            return
        while not self._stop_event.is_set():
            if not _generation_fence.is_live(my_generation):
                self._debug_log("video filters: gen=%d superseded, exiting", my_generation)
                return
            self._safe_check()
            if self._stop_event.wait(TICK_SECONDS):
                return

    def _safe_check(self):
        try:
            self.check()
        except Exception as exc:
            decky.logger.exception("video filters: check crashed: %s (%s)", type(exc).__name__, exc)

    def _wanted(self) -> bool:
        return self._browser_store.list_settings()["blockYouTubeAds"] is True

    def check(self):
        with self._check_lock:
            try:
                self._debug_logging = self._settings_store.get_debug_logging(self._settings_store.load_config())
            except Exception:
                self._debug_logging = False

            if not self._wanted():
                self._debug_log("video filters: setting off, no poll")
                return "off"

            state = self._filters.load()
            now = int(time.time())
            fetched = state["fetchedAt"] if state["fetchedAt"] <= now else 0
            attempted = state["attemptAt"] if state["attemptAt"] <= now else 0
            if fetched and now - fetched < CHECK_INTERVAL_SECONDS:
                self._debug_log("video filters: gate closed, %ds since last fetch", now - fetched)
                return "gated"
            if attempted > fetched and now - attempted < RETRY_SECONDS:
                self._debug_log("video filters: retry gate closed, %ds since a failed attempt", now - attempted)
                return "gated"

            try:
                raw = read_filter_bytes(self._ssl_context)
            except FetchFailure as exc:
                self._filters.note_attempt(now)
                self._debug_log("video filters: fetch failed: %s", exc)
                return "failed"

            doc = parse_video_filters(raw)
            if doc is None:
                self._filters.note_attempt(now)
                decky.logger.warning("video filters: fetched file failed validation, keeping revision %d", state["revision"])
                return "invalid"

            outcome = self._filters.accept(doc, now)
            if outcome == "stale":
                self._filters.note_attempt(now)
                self._debug_log("video filters: fetched revision %d is below %d, ignored", doc["revision"], state["revision"])
            elif outcome == "new":
                decky.logger.info(
                    "video filters: revision %d applied (enabled=%s, %d disguises, hold %ss)",
                    doc["revision"], doc["enabled"], len(doc["disguises"]), doc["holdSeconds"],
                )
            else:
                self._debug_log("video filters: revision %d is current", doc["revision"])
            return outcome
