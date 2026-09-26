from pathlib import Path

import os
import select
import socket
import threading

import decky

BACK_BUTTON_EVENT = "cheevodeck_back_button"

NETLINK_KOBJECT_UEVENT = 15

VALVE_VENDOR_ID = 0x28DE

DECK_FORMAT = "deck"
CONTROLLER_FORMAT = "controller"

_PRODUCT_FORMATS = {
    0x1205: DECK_FORMAT,
    0x1302: CONTROLLER_FORMAT,
    0x1304: CONTROLLER_FORMAT,
    0x1305: CONTROLLER_FORMAT,
}

_PADDLE_BITS = {
    DECK_FORMAT: (
        ("l4", 13, 0x02),
        ("r4", 13, 0x04),
        ("l5", 9, 0x80),
        ("r5", 10, 0x01),
    ),
    CONTROLLER_FORMAT: (
        ("l4", 4, 0x02),
        ("r4", 2, 0x80),
        ("l5", 4, 0x04),
        ("r5", 3, 0x01),
    ),
}

SUMMON_ACTIONS = ("browser", "calculator", "currentGuide", "memories", "lastMemory")

BROWSER_SNAPSHOT_BUTTON = "r4"

HIDRAW_CLASS_DIR = Path("/sys/class/hidraw")

READ_SIZE = 128
NETLINK_READ_SIZE = 8192

RESCAN_RETRY_SECONDS = 1.0
RESCAN_RETRY_PASSES = 5


def format_from_uevent(text: str):
    for line in text.splitlines():
        if not line.startswith("HID_ID="):
            continue
        parts = line[len("HID_ID="):].split(":")
        if len(parts) != 3:
            return None
        try:
            vendor = int(parts[1], 16)
            product = int(parts[2], 16)
        except ValueError:
            return None
        if vendor != VALVE_VENDOR_ID:
            return None
        return _PRODUCT_FORMATS.get(product)
    return None


def is_input_report(fmt: str, data: bytes) -> bool:
    if fmt == DECK_FORMAT:
        return len(data) == 64 and data[0] == 0x01 and data[2] == 0x09
    return len(data) == 54 and data[0] == 0x42


def paddle_state(fmt: str, data: bytes) -> int:
    state = 0
    for index, (_button, byte, mask) in enumerate(_PADDLE_BITS[fmt]):
        if data[byte] & mask:
            state |= 1 << index
    return state


def pressed_buttons(fmt: str, before: int, after: int) -> list[str]:
    went_down = after & ~before
    return [button for index, (button, _byte, _mask) in enumerate(_PADDLE_BITS[fmt]) if went_down & (1 << index)]


def is_hidraw_hotplug(message: bytes) -> bool:
    fields = message.split(b"\0")
    if b"SUBSYSTEM=hidraw" not in fields:
        return False
    return b"ACTION=add" in fields or b"ACTION=remove" in fields


def matching_nodes() -> dict:
    found = {}
    try:
        names = sorted(os.listdir(HIDRAW_CLASS_DIR))
    except OSError:
        return found
    for name in names:
        try:
            text = (HIDRAW_CLASS_DIR / name / "device" / "uevent").read_text()
        except OSError:
            continue
        fmt = format_from_uevent(text)
        if fmt:
            found[name] = fmt
    return found


class _OpenNode:
    def __init__(self, name: str, fmt: str):
        self.name = name
        self.fmt = fmt
        self.state = 0


class BackButtonService:
    def __init__(self, *, settings_store, debug_logging, emit):
        self._settings_store = settings_store
        self._debug_logging = debug_logging
        self._emit = emit
        self._generation = 0
        self._lock = threading.Lock()
        self._thread = None
        self._stop_w = None

    def sync(self) -> None:
        cfg = self._settings_store.load_config()
        if cfg.get("backButtonsGlobal", False) or cfg.get("browserSnapshot", False):
            self.start()
        else:
            self.stop()

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            if self._stop_w is not None:
                os.close(self._stop_w)
                self._stop_w = None
            self._generation += 1
            generation = self._generation
            stop_r, stop_w = os.pipe()
            os.set_blocking(stop_r, False)
            os.set_blocking(stop_w, False)
            self._stop_w = stop_w
            thread = threading.Thread(
                target=self._run,
                args=(stop_r,),
                name="back-buttons",
                daemon=True,
            )
            self._thread = thread
        thread.start()
        decky.logger.info("back buttons: thread started (generation %d)", generation)

    def stop(self) -> None:
        with self._lock:
            stop_w = self._stop_w
            if stop_w is None:
                return
            self._stop_w = None
            self._thread = None
            try:
                os.write(stop_w, b"x")
            except OSError:
                pass
            os.close(stop_w)
        decky.logger.info("back buttons: stop requested")

    def _run(self, stop_r: int) -> None:
        nodes = {}
        netlink = None
        try:
            try:
                netlink = socket.socket(socket.AF_NETLINK, socket.SOCK_DGRAM, NETLINK_KOBJECT_UEVENT)
                netlink.bind((0, 1))
            except OSError as exc:
                decky.logger.warning("back buttons: no hotplug, netlink unavailable (%s: %s)", type(exc).__name__, exc)
                if netlink is not None:
                    netlink.close()
                netlink = None

            retries = RESCAN_RETRY_PASSES if self._rescan(nodes) else 0
            watched = self._watch_list(stop_r, netlink, nodes)

            while True:
                timeout = RESCAN_RETRY_SECONDS if retries else None
                ready, _, _ = select.select(watched, [], [], timeout)

                if stop_r in ready:
                    break

                if not ready:
                    failed = self._rescan(nodes)
                    watched = self._watch_list(stop_r, netlink, nodes)
                    retries = retries - 1 if failed else 0
                    if failed and not retries:
                        decky.logger.warning("back buttons: gave up opening %d controller node(s)", failed)
                    continue

                if netlink is not None and netlink in ready:
                    try:
                        message = netlink.recv(NETLINK_READ_SIZE)
                    except OSError:
                        message = b""
                    if is_hidraw_hotplug(message):
                        retries = RESCAN_RETRY_PASSES if self._rescan(nodes) else 0
                        watched = self._watch_list(stop_r, netlink, nodes)

                dropped = False
                for fd in ready:
                    node = nodes.get(fd)
                    if node is None:
                        continue
                    try:
                        data = os.read(fd, READ_SIZE)
                    except BlockingIOError:
                        continue
                    except OSError as exc:
                        self._drop(nodes, fd, f"{type(exc).__name__}: {exc}")
                        dropped = True
                        continue
                    self._decode(node, data)

                if dropped:
                    retries = RESCAN_RETRY_PASSES if self._rescan(nodes) else 0
                    watched = self._watch_list(stop_r, netlink, nodes)
        except Exception as exc:
            decky.logger.warning("back buttons: thread failed (%s: %s)", type(exc).__name__, exc)
        finally:
            for fd in list(nodes):
                os.close(fd)
            if netlink is not None:
                netlink.close()
            os.close(stop_r)
            decky.logger.info("back buttons: thread exiting")

    def _watch_list(self, stop_r: int, netlink, nodes: dict) -> list:
        watched = [stop_r, *nodes]
        if netlink is not None:
            watched.append(netlink)
        return watched

    def _rescan(self, nodes: dict) -> int:
        wanted = matching_nodes()
        for fd, node in list(nodes.items()):
            if wanted.get(node.name) != node.fmt:
                self._drop(nodes, fd, "removed")

        open_names = {node.name for node in nodes.values()}
        failed = 0
        for name, fmt in wanted.items():
            if name in open_names:
                continue
            try:
                fd = os.open(f"/dev/{name}", os.O_RDONLY | os.O_NONBLOCK)
            except OSError:
                failed += 1
                continue
            nodes[fd] = _OpenNode(name, fmt)
            decky.logger.info("back buttons: opened %s (%s)", name, fmt)
        return failed

    def _drop(self, nodes: dict, fd: int, reason: str) -> None:
        node = nodes.pop(fd)
        try:
            os.close(fd)
        except OSError:
            pass
        decky.logger.info("back buttons: dropped %s (%s)", node.name, reason)

    def _decode(self, node: _OpenNode, data: bytes) -> None:
        if not is_input_report(node.fmt, data):
            return
        state = paddle_state(node.fmt, data)
        if state == node.state:
            return
        pressed = pressed_buttons(node.fmt, node.state, state)
        node.state = state
        for button in pressed:
            self._on_press(node, button)

    def _on_press(self, node: _OpenNode, button: str) -> None:
        cfg = self._settings_store.load_config()
        snapshot = button == BROWSER_SNAPSHOT_BUTTON and bool(cfg.get("browserSnapshot", False))
        action = None
        if cfg.get("backButtonsGlobal", False):
            action = self._settings_store.get_shortcut_bindings(cfg).get(button)
        if action not in SUMMON_ACTIONS:
            action = None
        if action is None and not snapshot:
            if self._debug_logging():
                decky.logger.info("back buttons: %s on %s has nothing to send", button, node.name)
            return
        if self._debug_logging():
            decky.logger.info("back buttons: %s on %s sent action=%s snapshot=%s", button, node.name, action, snapshot)
        self._emit({"action": action, "browserSnapshot": snapshot})
