import hashlib
import threading
import time
import urllib.error
import urllib.request

import decky

from services._tick_common import GenerationFence
from services.update_checker_service import GITHUB_OWNER, GITHUB_REPO
from notifications import emit_notification, is_type_enabled
from ra_client import build_user_agent


MESSAGE_URL = "https://raw.githubusercontent.com/%s/%s/main/broadcast/message.txt" % (GITHUB_OWNER, GITHUB_REPO)

CHECK_INTERVAL_SECONDS = 55 * 60

TICK_SECONDS = 15 * 60

STARTUP_DELAY_SECONDS = 20.0

FETCH_TIMEOUT_SECONDS = 15

MESSAGE_MAX_BYTES = 16 * 1024

ID_PREFIX = "#id "


_generation_fence = GenerationFence()


class FetchFailure(Exception):
    """Nothing usable came back. Never surfaced to the user."""


def parse_message(raw_bytes):
    """Split the fetched file into (message_id, body).

    Leading lines beginning with "#" are metadata: the first one shaped
    like "#id token" names the message, the rest are comments for
    whoever is editing the file. Only leading ones — a "#" further down
    is ordinary text.

    Falling back to a hash of the body when there is no id line means a
    malformed or comment-free file still settles instead of looking new
    on every single poll.
    """
    text = raw_bytes.decode("utf-8", errors="replace")
    if text.startswith("﻿"):
        text = text[1:]

    lines = text.split("\n")
    index = 0
    message_id = ""
    while index < len(lines) and lines[index].startswith("#"):
        if not message_id and lines[index].startswith(ID_PREFIX):
            message_id = lines[index][len(ID_PREFIX):].strip()
        index += 1

    body = "\n".join(lines[index:]).strip()

    if not message_id and body:
        message_id = hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]

    return message_id, body


class DeveloperMessageService:
    """Polls the repo for a message from the developer and announces it.

    The mirror image of the update checker: same tick shape, same
    generation fence, same two-lock split, but it reads one small text
    file off the CDN rather than the releases API, and its answer is
    "here is something you should know" rather than "you can update".

    Two locks for the same reason the update checker has two: the gate
    test and the lastCheckedAt stamp have to happen in one held section,
    or two ticks both read "yes, the gate is open" before either stamps.
    Measured, not assumed — four simultaneous ticks make four fetches
    unlocked and one locked.
    """

    def __init__(self, *, settings_store, message_store, ssl_context, notifications_store=None):
        self._settings_store = settings_store
        self._messages = message_store
        self._ssl_context = ssl_context
        self._notifications = notifications_store

        self._thread = None
        self._stop_event = threading.Event()
        self._lifecycle_lock = threading.Lock()
        self._check_lock = threading.Lock()
        self._generation = -1
        self._debug_logging = False
        self._event_loop = None

    def _debug_log(self, message, *args):
        if self._debug_logging:
            decky.logger.info(message, *args)

    def set_event_loop(self, event_loop):
        self._event_loop = event_loop

    def start(self):
        with self._lifecycle_lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._stop_event.clear()
            self._generation = _generation_fence.claim()
            thread = threading.Thread(
                target=self._run_loop,
                name="developer-message",
                daemon=True,
            )
            self._thread = thread

        thread.start()
        decky.logger.info(
            "message: thread started (generation %d)",
            self._generation,
        )

    def stop(self):
        self._stop_event.set()
        decky.logger.info("message: stop requested")

    def _run_loop(self):
        my_generation = self._generation
        if self._stop_event.wait(STARTUP_DELAY_SECONDS):
            return

        while not self._stop_event.is_set():
            if not _generation_fence.is_live(my_generation):
                self._debug_log(
                    "message: gen=%d superseded, exiting tid=%d",
                    my_generation,
                    threading.get_ident(),
                )
                return

            try:
                self.check()
            except Exception as exc:
                decky.logger.exception(
                    "message: tick crashed: %s (%s)",
                    type(exc).__name__,
                    exc,
                )

            if self._stop_event.wait(TICK_SECONDS):
                return

    def check(self):
        """One poll. Silent about everything except an actual message.

        There is no About-page surface for this and nothing the user
        could do about a failure, so a failure produces no card, no
        toast and no stored state — just a debug line and a retry on
        the next tick.
        """
        with self._check_lock:
            try:
                cfg = self._settings_store.load_config()
                self._debug_logging = self._settings_store.get_debug_logging(cfg)
            except Exception:
                cfg = None

            state = self._messages.load()
            now = int(time.time())

            last_checked = state["lastCheckedAt"]
            if last_checked > now:
                last_checked = 0

            if last_checked and now - last_checked < CHECK_INTERVAL_SECONDS:
                self._debug_log(
                    "message: gate closed, %ds since last check",
                    now - last_checked,
                )
                return

            try:
                raw = self._fetch_message()
            except FetchFailure as exc:
                self._debug_log("message: fetch failed: %s", exc)
                return

            message_id, body = parse_message(raw)

            if not state["seeded"]:
                # First fetch on this install is ALWAYS silent. Do not swap this
                # for viewedIntro: that flips during setup, so a fast setup can
                # beat the fetch and land a months-old message on a new user.
                self._messages.record(message_id, body, now)
                decky.logger.info("message: seeded quietly on first fetch")
                return

            if message_id == state["messageId"]:
                self._messages.touch_checked(now)
                return

            # Record BEFORE the notification is gated, matching _maybe_notify.
            # The cache is what the user has been TOLD about, and that must not
            # depend on whether notifications happened to be switched on, or
            # enabling them later replays a long-dead broadcast.
            self._messages.record(message_id, body, now)

            if not body:
                decky.logger.info("message: withdrawn upstream, nothing to show")
                return

            decky.logger.info("message: new message %s, notifying", message_id)
            self._announce(body, message_id, cfg)

    def _announce(self, body, message_id, cfg):
        if self._notifications is not None and is_type_enabled("system", self._settings_store, cfg):
            self._notifications.append({
                "type": "system",
                "kind": "actionable",
                "iconSource": "none",
                "title": "Message from FAILINATOR5000",
                "body": body,
                "source": "notifications",
                "target": {"view": "message"},
                "meta": {"messageId": message_id},
            })

        emit_notification(
            ntype="system",
            title_key="Message from FAILINATOR5000",
            line_key="View in Notifications",
            settings_store=self._settings_store,
            event_loop=self._event_loop,
        )

    def _fetch_message(self):
        """The message file's bytes. Empty means there is no message."""
        try:
            request = urllib.request.Request(
                MESSAGE_URL,
                headers={"User-Agent": build_user_agent()},
            )
            with urllib.request.urlopen(
                request,
                timeout=FETCH_TIMEOUT_SECONDS,
                context=self._ssl_context,
            ) as response:
                data = response.read(MESSAGE_MAX_BYTES + 1)
        except urllib.error.HTTPError as exc:
            # A 404 is "no message", not a failure. Treating it as an error
            # would leave the feature dead until the file exists, and deleting
            # the file is how a message gets withdrawn.
            if exc.code == 404:
                return b""
            raise FetchFailure("http %s" % exc.code) from exc
        except Exception as exc:
            raise FetchFailure("%s" % type(exc).__name__) from exc

        if len(data) > MESSAGE_MAX_BYTES:
            raise FetchFailure("oversize")

        return data
