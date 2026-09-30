from pathlib import Path

import base64
import json
import os
import socket
import struct
import threading
import time
import urllib.request

import decky

from freeze_capture import (
    CLOCK_TICKS,
    age_seconds,
    browser_process,
    steam_log_dir,
    uptime_seconds,
    webhelper_processes,
    write_capture,
)
from utils import kill_steamwebhelper

CDP_HOST = "127.0.0.1"
CDP_PORT = 8080
TARGET_TITLE = "SharedJSContext"

TICK_SECONDS = 1.0
PING_INTERVAL = 2.0
PING_TIMEOUT = 3.0
CONNECT_RETRY = 5.0
STEP_TIMEOUT = 3.0

KILL_SCORE = 30
MIN_SILENCE = 10.0
CONFIRM_POINTS = 10
FRESH_RETRY = 5.0
CPU_BUSY_CORES = 0.8
CPU_WINDOW = 10.0
RSS_GROWTH_MB = 200
FOCUS_PHRASE = b"Trying to change focus to already selected tab"
FOCUS_BURST = 10
SUSPECT_LOG_AT = 5.0

HELPER_MIN_AGE = 60.0
UNARMED_GIVE_UP = 30.0
BLIND_SILENCE = 60.0
RESUME_GRACE = 20.0
SUSPEND_JUMP = 1.0

HEALTHY_TO_REARM = 120.0
KILL_CAP = 4
KILL_CAP_WINDOW = 1800.0

STACK_TIMEOUT = 3.0
SOURCE_TIMEOUT = 3.0
SOURCE_SCRIPTS = 3
SNIPPET_CHARS = 400
SCRIPT_HEAD_CHARS = 300
ASYNC_STACK_DEPTH = 8
SCRIPTS_KEPT = 5000
BASELINE_EVERY = 60.0

MAX_LOOP_FAILURES = 5

MB = 1024 * 1024

KNOWN_FREEZE_SCRIPT = "library.js"
KNOWN_FREEZE_CALL = "OnDeactivate("
KNOWN_FREEZE_WINDOW = 80


class CdpSocket:
    def __init__(self, sock: socket.socket):
        self._sock = sock
        self._buffer = bytearray()
        self._fragments = None
        self._last_id = 0

    @classmethod
    def connect(cls, path: str, timeout: float):
        sock = socket.create_connection((CDP_HOST, CDP_PORT), timeout=timeout)
        try:
            key = base64.b64encode(os.urandom(16)).decode()
            request = (
                f"GET {path} HTTP/1.1\r\n"
                f"Host: {CDP_HOST}:{CDP_PORT}\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n"
            )
            sock.sendall(request.encode())
            deadline = time.monotonic() + timeout
            head = bytearray()
            while b"\r\n\r\n" not in head:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("handshake timed out")
                sock.settimeout(remaining)
                chunk = sock.recv(4096)
                if not chunk:
                    raise ConnectionError("closed during the handshake")
                head += chunk
                if len(head) > 65536:
                    raise ConnectionError("handshake reply too long")
            status_line = bytes(head).split(b"\r\n", 1)[0]
            if b" 101 " not in status_line + b" ":
                raise ConnectionError(f"handshake refused: {status_line[:80]!r}")
            conn = cls(sock)
            conn._buffer += head[head.index(b"\r\n\r\n") + 4:]
            return conn
        except BaseException:
            sock.close()
            raise

    def send(self, method: str, params: dict | None = None) -> int:
        self._last_id += 1
        payload = json.dumps({"id": self._last_id, "method": method, "params": params or {}}).encode()
        self._send_frame(0x1, payload)
        return self._last_id

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        mask = os.urandom(4)
        header += mask
        masked = bytes(byte ^ mask[index & 3] for index, byte in enumerate(payload))
        self._sock.settimeout(STEP_TIMEOUT)
        self._sock.sendall(bytes(header) + masked)

    def read_message(self, deadline: float):
        while True:
            frame = self._take_frame()
            if frame is not None:
                message = self._handle_frame(*frame)
                if message is not None:
                    return message
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            self._sock.settimeout(remaining)
            try:
                chunk = self._sock.recv(65536)
            except TimeoutError:
                return None
            if not chunk:
                raise ConnectionError("closed by the other end")
            self._buffer += chunk

    def _take_frame(self):
        buffer = self._buffer
        if len(buffer) < 2:
            return None
        fin = bool(buffer[0] & 0x80)
        opcode = buffer[0] & 0x0F
        masked = bool(buffer[1] & 0x80)
        length = buffer[1] & 0x7F
        offset = 2
        if length == 126:
            if len(buffer) < 4:
                return None
            length = struct.unpack_from(">H", buffer, 2)[0]
            offset = 4
        elif length == 127:
            if len(buffer) < 10:
                return None
            length = struct.unpack_from(">Q", buffer, 2)[0]
            offset = 10
        mask = b""
        if masked:
            if len(buffer) < offset + 4:
                return None
            mask = bytes(buffer[offset:offset + 4])
            offset += 4
        if len(buffer) < offset + length:
            return None
        payload = bytes(buffer[offset:offset + length])
        del buffer[:offset + length]
        if masked:
            payload = bytes(byte ^ mask[index & 3] for index, byte in enumerate(payload))
        return fin, opcode, payload

    def _handle_frame(self, fin: bool, opcode: int, payload: bytes):
        if opcode == 0x8:
            raise ConnectionError("closed by the other end")
        if opcode == 0x9:
            self._send_frame(0xA, payload)
            return None
        if opcode == 0x1:
            self._fragments = bytearray(payload)
        elif opcode == 0x0 and self._fragments is not None:
            self._fragments += payload
        else:
            return None
        if not fin:
            return None
        text = bytes(self._fragments)
        self._fragments = None
        try:
            return json.loads(text)
        except ValueError:
            return None

    def close(self) -> None:
        try:
            self._sock.close()
        except OSError:
            pass


def find_target_path(timeout: float):
    url = f"http://{CDP_HOST}:{CDP_PORT}/json/list"
    with urllib.request.urlopen(url, timeout=timeout) as response:
        targets = json.loads(response.read())
    marker = f"{CDP_HOST}:{CDP_PORT}"
    for target in targets:
        if target.get("title") != TARGET_TITLE:
            continue
        address = str(target.get("webSocketDebuggerUrl") or "")
        for host in (marker, f"localhost:{CDP_PORT}"):
            if host in address:
                return address.split(host, 1)[1]
    return None


def ping(conn: CdpSocket) -> int:
    return conn.send("Runtime.evaluate", {"expression": "1", "returnByValue": True})


def stack_verdict(stack: dict) -> str:
    if stack.get("error"):
        return f"not captured ({stack['error']})"
    frames = (stack.get("paused") or {}).get("callFrames") or []
    if not frames:
        return "not captured (the pause never landed)"
    top = frames[0]
    script = top.get("script") or {}
    where = script.get("embedderName") or script.get("url") or top.get("url") or "an unknown script"
    around = ((stack.get("sources") or {}).get(top.get("scriptId")) or {}).get("around")
    if not around:
        return "not identified (no source was read for the paused frame)"
    near = around[0].get("before", "")[-KNOWN_FREEZE_WINDOW:] + around[0].get("after", "")[:KNOWN_FREEZE_WINDOW]
    if KNOWN_FREEZE_SCRIPT in where and KNOWN_FREEZE_CALL in near:
        return "matches the known Steam focus-navigation freeze (blur handler, OnDeactivate, library.js)"
    return "a different freeze: %s in %s at line %s column %s" % (
        top.get("functionName") or "an anonymous function",
        where,
        top.get("lineNumber"),
        top.get("columnNumber"),
    )


class _Episode:
    def __init__(self, *, silence_start: float, focus_offset: int, blind: bool):
        self.silence_start = silence_start
        self.blind = blind
        self.suspect_logged = False
        self.blocked_logged = False
        self.peak_score = 0
        self.fresh = "untried"
        self.fresh_failed = False
        self.fresh_next_at = 0.0
        self.cpu_samples = {}
        self.busiest_cores = 0.0
        self.busiest_pid = 0
        self.rss_base = None
        self.rss_now = 0
        self.focus_offset = focus_offset
        self.focus_lines = 0
        self.score = 0
        self.timeline = []

    def silence(self, now: float) -> float:
        return now - self.silence_start

    def rss_growth_mb(self) -> int:
        if self.rss_base is None:
            return 0
        return (self.rss_now - self.rss_base) // MB

    def stats(self) -> str:
        return "fresh=%s, busiest helper %.2f cores pid %d, biggest helper %dMB %+dMB, focus lines %d%s" % (
            self.fresh,
            self.busiest_cores,
            self.busiest_pid,
            self.rss_now // MB,
            self.rss_growth_mb(),
            self.focus_lines,
            ", no socket" if self.blind else "",
        )


class _Watch:
    def __init__(self, service, stop_event: threading.Event):
        self.service = service
        self.stop_event = stop_event
        self.conn = None
        self.armed = False
        self.debugger_on = False
        self.scripts = {}
        self.connected_at = 0.0
        self.outstanding = None
        self.silent_logged = None
        self.next_ping_at = 0.0
        self.next_connect_at = 0.0
        self.connect_error = None
        self.grace_until = 0.0
        self.last_answer_at = None
        self.episode = None
        self.clocks = (time.clock_gettime(time.CLOCK_BOOTTIME), time.monotonic())
        self.baseline_at = time.monotonic() + BASELINE_EVERY
        self.baseline_worst_ping = 0.0
        self.baseline_ticks = None

    def debug(self, message: str, *args) -> None:
        self.service.debug(message, *args)

    def run(self) -> None:
        failures = 0
        while not self.stop_event.is_set():
            try:
                self.step()
                failures = 0
            except Exception as exc:
                failures += 1
                decky.logger.warning(
                    "freeze watchdog: loop failed (%s: %s), %d in a row",
                    type(exc).__name__,
                    exc,
                    failures,
                )
                self.drop_connection()
                self.episode = None
                if failures >= MAX_LOOP_FAILURES:
                    decky.logger.warning("freeze watchdog: giving up after %d failures in a row", failures)
                    break
                self.stop_event.wait(CONNECT_RETRY)
        self.drop_connection()
        decky.logger.info("freeze watchdog: stopped")

    def step(self) -> None:
        now = time.monotonic()
        self.check_suspend(now)

        if self.conn is None and now >= self.next_connect_at:
            self.connect(now)

        if self.conn is not None and self.outstanding is None and now >= self.next_ping_at:
            try:
                self.outstanding = (ping(self.conn), time.monotonic())
            except OSError as exc:
                self.debug("ping could not be sent (%s: %s)", type(exc).__name__, exc)
                self.drop_connection()

        self.wait()
        if self.stop_event.is_set():
            return

        now = time.monotonic()
        if self.outstanding is not None and now - self.outstanding[1] >= PING_TIMEOUT:
            self.on_silent(now)
        if self.episode is None:
            self.check_blind(now)
        if self.episode is not None:
            self.score_episode(now)
        if self.service.recovery_logs() and now >= self.baseline_at:
            self.log_baseline(now)

    def wait(self) -> None:
        now = time.monotonic()
        if self.episode is not None:
            wake_at = now + TICK_SECONDS
        elif self.outstanding is not None:
            wake_at = self.outstanding[1] + PING_TIMEOUT
            if wake_at <= now:
                wake_at = now + TICK_SECONDS
        elif self.conn is not None:
            wake_at = self.next_ping_at
        else:
            wake_at = self.next_connect_at
            if self.last_answer_at is not None:
                wake_at = min(wake_at, now + TICK_SECONDS)
        wake_at = max(wake_at, now + 0.05)

        if self.conn is None or self.outstanding is None:
            self.stop_event.wait(wake_at - now)
            return
        try:
            while not self.stop_event.is_set():
                message = self.conn.read_message(wake_at)
                if message is None:
                    return
                if message.get("method") == "Debugger.scriptParsed":
                    self.remember_script(message.get("params") or {})
                    continue
                if message.get("id") != self.outstanding[0]:
                    continue
                if "result" in message:
                    self.on_answer(time.monotonic())
                else:
                    self.debug("ping #%d got an error reply: %s", self.outstanding[0], message.get("error"))
                return
        except OSError as exc:
            self.debug("socket lost (%s: %s)", type(exc).__name__, exc)
            self.drop_connection()
            self.close_episode("lost its DevTools socket")

    def connect(self, now: float) -> None:
        try:
            path = find_target_path(STEP_TIMEOUT)
            if path is None:
                raise ConnectionError("no SharedJSContext target listed")
            self.conn = CdpSocket.connect(path, STEP_TIMEOUT)
        except Exception as exc:
            self.next_connect_at = now + CONNECT_RETRY
            reason = f"{type(exc).__name__}: {exc}"
            if reason != self.connect_error:
                self.connect_error = reason
                self.debug("not connected (%s), retrying every %.0fs", reason, CONNECT_RETRY)
            return
        self.connect_error = None
        self.armed = False
        self.debugger_on = False
        self.scripts = {}
        self.connected_at = time.monotonic()
        self.outstanding = None
        self.next_ping_at = now
        self.debug("connected to %s, arming on the first answer", TARGET_TITLE)

    def drop_connection(self) -> None:
        if self.conn is not None:
            self.conn.close()
        self.conn = None
        self.armed = False
        self.debugger_on = False
        self.scripts = {}
        self.outstanding = None
        self.next_connect_at = time.monotonic() + CONNECT_RETRY

    def on_answer(self, now: float) -> None:
        ping_id, sent = self.outstanding
        latency = (now - sent) * 1000
        self.outstanding = None
        self.next_ping_at = sent + PING_INTERVAL
        self.last_answer_at = now
        self.baseline_worst_ping = max(self.baseline_worst_ping, latency)
        if not self.armed:
            self.armed = True
            self.debug("armed: first answer in %.1fms", latency)
        self.debug("ping #%d answered in %.1fms", ping_id, latency)
        self.service.note_healthy(now)
        self.sync_debugger()
        if self.episode is not None:
            self.close_episode(f"answered again after {self.episode.silence(now):.0f}s")

    def sync_debugger(self) -> None:
        want = self.service.recovery_logs()
        if want == self.debugger_on or self.conn is None:
            return
        try:
            if want:
                self.conn.send("Debugger.enable")
                self.conn.send("Debugger.setBreakpointsActive", {"active": False})
                self.conn.send("Debugger.setAsyncCallStackDepth", {"maxDepth": ASYNC_STACK_DEPTH})
            else:
                self.conn.send("Debugger.disable")
                self.scripts = {}
        except OSError as exc:
            self.debug("debugger switch failed (%s: %s)", type(exc).__name__, exc)
            self.drop_connection()
            return
        self.debugger_on = want
        self.debug("debugger %s for the capture's JS stack", "on" if want else "off")

    def remember_script(self, params: dict) -> None:
        script_id = params.get("scriptId")
        if not script_id:
            return
        self.scripts[script_id] = {
            "url": params.get("url"),
            "hash": params.get("hash"),
            "length": params.get("length"),
            "endLine": params.get("endLine"),
            "embedderName": params.get("embedderName"),
            "sourceMapURL": params.get("sourceMapURL"),
        }
        if len(self.scripts) > SCRIPTS_KEPT:
            del self.scripts[next(iter(self.scripts))]

    def on_silent(self, now: float) -> None:
        ping_id, sent = self.outstanding
        self.service.note_unhealthy()
        if self.episode is not None:
            return
        if self.silent_logged != ping_id:
            self.silent_logged = ping_id
            self.debug(
                "ping #%d unanswered after %.1fs (armed=%s, grace %.0fs left)",
                ping_id,
                now - sent,
                self.armed,
                max(0.0, self.grace_until - now),
            )
        if not self.armed:
            if now - self.connected_at >= UNARMED_GIVE_UP:
                self.debug("no answer since connecting %.0fs ago, reconnecting", now - self.connected_at)
                self.drop_connection()
            return
        if now < self.grace_until:
            return
        self.open_episode(max(sent, self.grace_until), blind=False)

    def check_blind(self, now: float) -> None:
        if self.last_answer_at is None or now < self.grace_until:
            return
        if self.conn is not None and self.armed:
            return
        if now - self.last_answer_at < BLIND_SILENCE:
            return
        self.debug("no answer on any socket for %.0fs", now - self.last_answer_at)
        self.open_episode(max(self.last_answer_at, self.grace_until), blind=True)

    def open_episode(self, silence_start: float, *, blind: bool) -> None:
        self.episode = _Episode(
            silence_start=silence_start,
            focus_offset=self.js_log_size(),
            blind=blind,
        )

    def close_episode(self, why: str) -> None:
        episode = self.episode
        if episode is None:
            return
        self.episode = None
        now = time.monotonic()
        if episode.suspect_logged:
            decky.logger.info(
                "freeze watchdog: Steam UI %s, no action (peak score %d, busiest helper %.2f cores, biggest helper %+dMB)",
                why,
                episode.peak_score,
                episode.busiest_cores,
                episode.rss_growth_mb(),
            )
        else:
            self.debug("stall over, Steam UI %s after %.1fs (peak score %d)", why, episode.silence(now), episode.peak_score)

    def score_episode(self, now: float) -> None:
        episode = self.episode
        silence = episode.silence(now)

        helpers = webhelper_processes()
        browser = browser_process(helpers)
        if browser is None:
            self.close_episode("has no webhelper running (Steam is closed or restarting)")
            self.last_answer_at = None
            return
        age = age_seconds(browser, uptime_seconds())
        if age < HELPER_MIN_AGE:
            self.close_episode(f"was restarted by Steam {age:.0f}s ago")
            self.grace_until = now + (HELPER_MIN_AGE - age)
            return
        self.sample_helpers(episode, helpers, now)
        self.count_focus_lines(episode)

        if not episode.fresh_failed and now >= episode.fresh_next_at:
            self.fresh_check(episode, now)
            if self.episode is None:
                return
            now = time.monotonic()
            silence = episode.silence(now)

        cpu_hit = episode.busiest_cores >= CPU_BUSY_CORES
        rss_hit = episode.rss_growth_mb() >= RSS_GROWTH_MB
        focus_hit = episode.focus_lines >= FOCUS_BURST
        episode.score = (
            int(silence)
            + (CONFIRM_POINTS if episode.fresh_failed else 0)
            + (CONFIRM_POINTS if cpu_hit else 0)
            + (CONFIRM_POINTS if rss_hit else 0)
            + (CONFIRM_POINTS if focus_hit else 0)
        )
        episode.peak_score = max(episode.peak_score, episode.score)
        stats = episode.stats()
        episode.timeline.append(f"{silence:6.1f}s score={episode.score} {stats}")
        self.debug("silent %.1fs, score %d, %s", silence, episode.score, stats)

        if silence >= SUSPECT_LOG_AT and not episode.suspect_logged:
            episode.suspect_logged = True
            decky.logger.info(
                "freeze watchdog: Steam UI stopped answering %.0fs ago (score %d: %s)",
                silence,
                episode.score,
                stats,
            )

        if episode.score < KILL_SCORE or silence < MIN_SILENCE:
            return
        blocked = self.service.kill_blocked_reason()
        if blocked is not None:
            if not episode.blocked_logged:
                episode.blocked_logged = True
                decky.logger.info(
                    "freeze watchdog: Steam UI silent %.0fs (score %d) but not killing: %s",
                    silence,
                    episode.score,
                    blocked,
                )
            return
        self.recover(episode, now)

    def sample_helpers(self, episode: _Episode, helpers: list, now: float) -> None:
        biggest = max((info.rss_bytes for info in helpers), default=0)
        if episode.rss_base is None:
            episode.rss_base = biggest
        episode.rss_now = biggest

        live = set()
        busiest_cores = 0.0
        busiest_pid = 0
        for info in helpers:
            live.add(info.pid)
            samples = episode.cpu_samples.setdefault(info.pid, [])
            samples.append((now, info.cpu_ticks))
            while len(samples) > 2 and now - samples[1][0] >= CPU_WINDOW:
                samples.pop(0)
            first_time, first_ticks = samples[0]
            span = now - first_time
            if span < CPU_WINDOW:
                continue
            cores = (info.cpu_ticks - first_ticks) / CLOCK_TICKS / span
            if cores > busiest_cores:
                busiest_cores = cores
                busiest_pid = info.pid
        for pid in list(episode.cpu_samples):
            if pid not in live:
                del episode.cpu_samples[pid]
        episode.busiest_cores = busiest_cores
        episode.busiest_pid = busiest_pid

    def js_log_path(self) -> Path:
        return steam_log_dir(self.service.user_home) / "webhelper_js.txt"

    def js_log_size(self) -> int:
        try:
            return self.js_log_path().stat().st_size
        except OSError:
            return 0

    def count_focus_lines(self, episode: _Episode) -> None:
        path = self.js_log_path()
        try:
            size = path.stat().st_size
            if size < episode.focus_offset:
                episode.focus_offset = 0
            if size == episode.focus_offset:
                return
            with path.open("rb") as handle:
                handle.seek(episode.focus_offset)
                added = handle.read(size - episode.focus_offset)
        except OSError:
            return
        cut = added.rfind(b"\n") + 1
        episode.focus_offset += cut
        episode.focus_lines += added[:cut].count(FOCUS_PHRASE)

    def fresh_check(self, episode: _Episode, now: float) -> None:
        episode.fresh_next_at = now + FRESH_RETRY
        conn = None
        try:
            path = find_target_path(STEP_TIMEOUT)
            if path is None:
                raise ConnectionError("no SharedJSContext target listed")
            conn = CdpSocket.connect(path, STEP_TIMEOUT)
            ping_id = ping(conn)
            deadline = time.monotonic() + STEP_TIMEOUT
            while True:
                message = conn.read_message(deadline)
                if message is None:
                    raise TimeoutError("no answer on a fresh socket")
                if message.get("id") != ping_id:
                    continue
                if "result" not in message:
                    raise ConnectionError(f"error reply on a fresh socket: {message.get('error')}")
                break
        except Exception as exc:
            if conn is not None:
                conn.close()
            episode.fresh_failed = True
            episode.fresh = f"failed ({type(exc).__name__}: {exc})"
            self.debug("fresh connection %s", episode.fresh)
            return
        self.debug("fresh connection answered, so the held socket was stale; switching to it")
        if self.conn is not None:
            self.conn.close()
        answered_at = time.monotonic()
        self.conn = conn
        self.armed = True
        self.connected_at = answered_at
        self.outstanding = None
        self.next_ping_at = answered_at + PING_INTERVAL
        self.last_answer_at = answered_at
        self.service.note_healthy(answered_at)
        self.close_episode("answered on a fresh connection")

    def recover(self, episode: _Episode, now: float) -> None:
        silence = episode.silence(now)
        line = "Steam UI silent %.0fs, score %d (%s)" % (silence, episode.score, episode.stats())
        capture = "off"
        verdict = "not captured (Save Recovery Logs is off)"
        if self.service.recovery_logs():
            stack = self.grab_stack()
            verdict = stack_verdict(stack)
            summary = "\n".join(
                [
                    f"Automatic Recovery at {time.strftime('%Y-%m-%d %H:%M:%S')}",
                    line,
                    f"Stack: {verdict}",
                    "",
                    "Timeline, seconds since the first unanswered ping:",
                    *episode.timeline,
                ]
            )
            capture = write_capture(
                source="auto",
                summary=summary,
                user_home=self.service.user_home,
                extra_files={"js_stack.json": json.dumps(stack, indent=1) + "\n"},
            )
        killed = kill_steamwebhelper()
        decky.logger.info(
            "freeze watchdog: %s, stack %s, killed %d steamwebhelper processes, capture %s",
            line,
            verdict,
            killed,
            capture,
        )
        self.episode = None
        self.last_answer_at = None
        self.drop_connection()
        self.service.note_kill(now)

    def grab_stack(self) -> dict:
        result = {"pause": None, "paused": None, "sources": {}, "heap": None, "error": None}
        if self.conn is None:
            result["error"] = "no held socket"
            return result
        if not self.debugger_on:
            result["error"] = "the debugger was not on before the freeze (it is only switched on with Save Recovery Logs)"
            return result
        try:
            pause_id = self.conn.send("Debugger.pause")
            deadline = time.monotonic() + STACK_TIMEOUT
            params = None
            while True:
                message = self.conn.read_message(deadline)
                if message is None:
                    break
                if message.get("method") == "Debugger.scriptParsed":
                    self.remember_script(message.get("params") or {})
                elif message.get("id") == pause_id:
                    result["pause"] = message.get("error") or "ok"
                elif message.get("method") == "Debugger.paused":
                    params = message.get("params") or {}
                    break
            if params is None:
                return result
            frames = [self.describe_frame(frame) for frame in params.get("callFrames") or []]
            result["paused"] = {
                "reason": params.get("reason"),
                "callFrames": frames,
                "asyncStackTrace": self.describe_async(params.get("asyncStackTrace")),
            }
            self.read_sources(frames, result["sources"])
            heap = self.request("Runtime.getHeapUsage", {}, time.monotonic() + SOURCE_TIMEOUT)
            if heap is not None:
                result["heap"] = heap.get("result") or heap.get("error")
        except Exception as exc:
            result["error"] = f"{type(exc).__name__}: {exc}"
        return result

    def describe_frame(self, frame: dict) -> dict:
        location = frame.get("location") or {}
        script_id = location.get("scriptId")
        return {
            "functionName": frame.get("functionName"),
            "url": frame.get("url"),
            "scriptId": script_id,
            "lineNumber": location.get("lineNumber"),
            "columnNumber": location.get("columnNumber"),
            "script": self.scripts.get(script_id),
        }

    def describe_async(self, trace) -> list:
        parts = []
        while trace and len(parts) < ASYNC_STACK_DEPTH:
            parts.append(
                {
                    "description": trace.get("description"),
                    "callFrames": [
                        {
                            "functionName": frame.get("functionName"),
                            "url": frame.get("url"),
                            "scriptId": frame.get("scriptId"),
                            "lineNumber": frame.get("lineNumber"),
                            "columnNumber": frame.get("columnNumber"),
                        }
                        for frame in trace.get("callFrames") or []
                    ],
                }
            )
            trace = trace.get("parent")
        return parts

    def read_sources(self, frames: list, sources: dict) -> None:
        deadline = time.monotonic() + SOURCE_TIMEOUT
        for frame in frames:
            script_id = frame.get("scriptId")
            if not script_id or script_id in sources:
                continue
            if len(sources) >= SOURCE_SCRIPTS:
                break
            reply = self.request("Debugger.getScriptSource", {"scriptId": script_id}, deadline)
            if reply is None:
                sources[script_id] = {"error": "no answer"}
                break
            source = (reply.get("result") or {}).get("scriptSource")
            if source is None:
                sources[script_id] = {"error": reply.get("error")}
                continue
            lines = source.split("\n")
            around = []
            for other in frames:
                if other.get("scriptId") != script_id:
                    continue
                line_number = other.get("lineNumber") or 0
                column = other.get("columnNumber") or 0
                text = lines[line_number] if line_number < len(lines) else ""
                around.append(
                    {
                        "lineNumber": line_number,
                        "columnNumber": column,
                        "before": text[max(0, column - SNIPPET_CHARS):column],
                        "after": text[column:column + SNIPPET_CHARS],
                    }
                )
            sources[script_id] = {
                "length": len(source),
                "lines": len(lines),
                "head": source[:SCRIPT_HEAD_CHARS],
                "around": around,
            }

    def request(self, method: str, params: dict, deadline: float):
        request_id = self.conn.send(method, params)
        while True:
            message = self.conn.read_message(deadline)
            if message is None:
                return None
            if message.get("method") == "Debugger.scriptParsed":
                self.remember_script(message.get("params") or {})
            elif message.get("id") == request_id:
                return message

    def check_suspend(self, now: float) -> None:
        boot = time.clock_gettime(time.CLOCK_BOOTTIME)
        last_boot, last_mono = self.clocks
        self.clocks = (boot, now)
        slept = (boot - last_boot) - (now - last_mono)
        if slept < SUSPEND_JUMP:
            return
        self.debug("the device slept for %.0fs, holding off for %.0fs", slept, RESUME_GRACE)
        self.grace_until = now + RESUME_GRACE
        self.outstanding = None
        self.next_ping_at = now
        self.episode = None

    def log_baseline(self, now: float) -> None:
        helpers = webhelper_processes()
        ticks = {info.pid: info.cpu_ticks for info in helpers}
        busiest = 0.0
        if self.baseline_ticks is not None:
            span = now - self.baseline_ticks[0]
            for pid, count in ticks.items():
                before = self.baseline_ticks[1].get(pid)
                if before is not None and span > 0:
                    busiest = max(busiest, (count - before) / CLOCK_TICKS / span)
        biggest = max((info.rss_bytes for info in helpers), default=0)
        self.debug(
            "last %.0fs worst ping %.1fms, biggest helper %dMB, busiest helper %.2f cores, armed=%s, %s",
            BASELINE_EVERY,
            self.baseline_worst_ping,
            biggest // MB,
            busiest,
            self.armed,
            self.service.kill_blocked_reason() or "ready to recover",
        )
        self.baseline_ticks = (now, ticks)
        self.baseline_worst_ping = 0.0
        self.baseline_at = now + BASELINE_EVERY


class FreezeWatchdogService:
    def __init__(self, *, settings_store, user_home):
        self._settings_store = settings_store
        self.user_home = Path(user_home)
        self._recovery_logs = False
        self._lock = threading.Lock()
        self._generation = 0
        self._thread = None
        self._stop_event = None
        self._kill_times = []
        self._stood_down = False
        self._rearmed = True
        self._healthy_since = None

    def sync(self) -> None:
        cfg = self._settings_store.load_config()
        self._recovery_logs = bool(cfg.get("recoveryLogs", False))
        if cfg.get("automaticRecovery", True):
            self.start()
        else:
            self.stop()

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._generation += 1
            generation = self._generation
            stop_event = threading.Event()
            self._stop_event = stop_event
            watch = _Watch(self, stop_event)
            thread = threading.Thread(target=watch.run, name="freeze-watchdog", daemon=True)
            self._thread = thread
        thread.start()
        decky.logger.info("freeze watchdog: started (generation %d)", generation)

    def stop(self) -> None:
        with self._lock:
            stop_event = self._stop_event
            if stop_event is None:
                return
            self._stop_event = None
            self._thread = None
            stop_event.set()
        decky.logger.info("freeze watchdog: stop requested")

    def recovery_logs(self) -> bool:
        return self._recovery_logs

    def debug(self, message: str, *args) -> None:
        if self._recovery_logs:
            decky.logger.info("freeze watchdog: " + message, *args)

    def note_healthy(self, now: float) -> None:
        if self._healthy_since is None:
            self._healthy_since = now
        if not self._rearmed and now - self._healthy_since >= HEALTHY_TO_REARM:
            self._rearmed = True
            self.debug("re-armed after %.0fs of answers since the last recovery", now - self._healthy_since)

    def note_unhealthy(self) -> None:
        self._healthy_since = None

    def kill_blocked_reason(self):
        if self._stood_down:
            return "stood down"
        if not self._rearmed:
            return f"not healthy for {HEALTHY_TO_REARM / 60:.0f} minutes since the last recovery"
        return None

    def note_kill(self, now: float) -> None:
        self._rearmed = False
        self._healthy_since = None
        self._kill_times = [stamp for stamp in self._kill_times if now - stamp < KILL_CAP_WINDOW]
        self._kill_times.append(now)
        if len(self._kill_times) >= KILL_CAP and not self._stood_down:
            self._stood_down = True
            decky.logger.info(
                "freeze watchdog: %d recoveries in the last %.0f minutes, no more kills until the plugin reloads",
                len(self._kill_times),
                KILL_CAP_WINDOW / 60,
            )
