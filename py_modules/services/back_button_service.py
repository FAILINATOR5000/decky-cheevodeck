from pathlib import Path

import os
import select
import socket
import threading
import time

import decky

from freeze_capture import write_capture
from utils import kill_steamwebhelper

BACK_BUTTON_EVENT = "cheevodeck_back_button"

NETLINK_KOBJECT_UEVENT = 15

VALVE_VENDOR_ID = 0x28DE

DECK_FORMAT = "deck"
CONTROLLER_FORMAT = "controller"
ALLY_FORMAT = "ally"

_PRODUCT_FORMATS = {
    0x1205: DECK_FORMAT,
    0x12FD: ALLY_FORMAT,
    0x1302: CONTROLLER_FORMAT,
    0x1304: CONTROLLER_FORMAT,
    0x1305: CONTROLLER_FORMAT,
}

_BUTTON_BITS = {
    DECK_FORMAT: (
        ("l4", 13, 0x02),
        ("r4", 13, 0x04),
        ("l5", 9, 0x80),
        ("r5", 10, 0x01),
    ),
    ALLY_FORMAT: (
        ("l4", 13, 0x02),
        ("r4", 13, 0x04),
        ("m1", 9, 0x80),
        ("m2", 10, 0x01),
    ),
    CONTROLLER_FORMAT: (
        ("l4", 4, 0x02),
        ("r4", 2, 0x80),
        ("l5", 4, 0x04),
        ("r5", 3, 0x01),
    ),
}

SUMMON_ACTIONS = (
    "browser",
    "calculator",
    "currentGuide",
    "memories",
    "lastMemory",
    "snapshot",
    "doNotDisturb",
    "batterySaver",
    "notifications",
    "socialActivity",
    "profile",
    "socialhub",
    "news",
    "aotw",
    "events",
    "newsets",
    "subscribeddiscussions",
    "savedcomments",
    "trackedsets",
    "dolphinMapper",
)

_SUMMON_BUTTONS = ("l4", "r4", "l5", "r5")

_MENU_COMBO_BITS = {
    DECK_FORMAT: (
        ("menu", 9, 0x40),
        ("up", 9, 0x01),
        ("down", 9, 0x08),
        ("left", 9, 0x04),
        ("right", 9, 0x02),
        ("l1", 8, 0x08),
        ("r1", 8, 0x04),
    ),
    ALLY_FORMAT: (
        ("menu", 9, 0x40),
        ("up", 9, 0x01),
        ("down", 9, 0x08),
        ("left", 9, 0x04),
        ("right", 9, 0x02),
        ("l1", 8, 0x08),
        ("r1", 8, 0x04),
    ),
    CONTROLLER_FORMAT: (
        ("menu", 2, 0x40),
        ("up", 3, 0x20),
        ("down", 3, 0x04),
        ("left", 3, 0x10),
        ("right", 3, 0x08),
        ("l1", 4, 0x08),
        ("r1", 3, 0x02),
    ),
}

_MENU_COMBO_KEYS = {
    "up": "menuUp",
    "down": "menuDown",
    "left": "menuLeft",
    "right": "menuRight",
    "l1": "menuL1",
    "r1": "menuR1",
}

_CHORD_BITS = {
    DECK_FORMAT: ((8, 0xFF), (9, 0x7F), (10, 0x46), (11, 0x04), (14, 0x04)),
    ALLY_FORMAT: ((8, 0xFF), (9, 0xFF), (10, 0x47), (11, 0x04), (14, 0x04)),
    CONTROLLER_FORMAT: ((2, 0x7F), (3, 0xFE), (4, 0x89), (5, 0x0C)),
}

_RECOVERY_COMBOS = {
    DECK_FORMAT: ("l4", "l5", "r4", "r5"),
    ALLY_FORMAT: ("m1", "m2"),
    CONTROLLER_FORMAT: ("l4", "l5", "r4", "r5"),
}

COMBO_HOLD_SECONDS = 3.0
COMBO_COOLDOWN_SECONDS = 30.0

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
    if fmt in (DECK_FORMAT, ALLY_FORMAT):
        return len(data) == 64 and data[0] == 0x01 and data[2] == 0x09
    return len(data) == 54 and data[0] == 0x42


def button_state(fmt: str, data: bytes) -> int:
    state = 0
    for index, (_button, byte, mask) in enumerate(_BUTTON_BITS[fmt]):
        if data[byte] & mask:
            state |= 1 << index
    return state


def buttons_mask(fmt: str, buttons) -> int:
    mask = 0
    for index, (button, _byte, _mask) in enumerate(_BUTTON_BITS[fmt]):
        if button in buttons:
            mask |= 1 << index
    if mask.bit_count() != len(buttons):
        return 0
    return mask


def combo_mask(fmt: str) -> int:
    combo = _RECOVERY_COMBOS.get(fmt)
    if not combo:
        return 0
    return buttons_mask(fmt, combo)


def other_button_held(fmt: str, data: bytes) -> bool:
    return any(data[byte] & mask for byte, mask in _CHORD_BITS[fmt])


def held_summon_buttons(fmt: str, state: int) -> int:
    held = 0
    for index, (button, _byte, _mask) in enumerate(_BUTTON_BITS[fmt]):
        if button in _SUMMON_BUTTONS and state & (1 << index):
            held += 1
    return held


def menu_combo_state(fmt: str, data: bytes) -> int:
    state = 0
    for index, (_button, byte, mask) in enumerate(_MENU_COMBO_BITS[fmt]):
        if data[byte] & mask:
            state |= 1 << index
    return state


def menu_combo_pressed(fmt: str, before: int, after: int):
    went_down = after & ~before
    menu_held = False
    partners_held = 0
    pressed = None
    for index, (button, _byte, _mask) in enumerate(_MENU_COMBO_BITS[fmt]):
        bit = 1 << index
        if button == "menu":
            menu_held = bool(before & bit) and bool(after & bit)
            continue
        if after & bit:
            partners_held += 1
            if went_down & bit:
                pressed = button
    if not menu_held or pressed is None or partners_held != 1:
        return None
    return pressed


def menu_combo_bit(fmt: str, button: str) -> int:
    for index, (name, _byte, _mask) in enumerate(_MENU_COMBO_BITS[fmt]):
        if name == button:
            return 1 << index
    return 0


def other_button_beside_menu_combo(fmt: str, data: bytes) -> bool:
    for byte, mask in _CHORD_BITS[fmt]:
        for _button, combo_byte, combo_mask in _MENU_COMBO_BITS[fmt]:
            if combo_byte == byte:
                mask &= ~combo_mask
        if data[byte] & mask:
            return True
    return False


def pressed_buttons(fmt: str, before: int, after: int) -> list[str]:
    went_down = after & ~before
    return [
        button
        for index, (button, _byte, _mask) in enumerate(_BUTTON_BITS[fmt])
        if went_down & (1 << index) and button in _SUMMON_BUTTONS
    ]


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
        self.menu_state = 0
        self.menu_armed = None
        self.combo_since = None
        self.combo_spent = False


class BackButtonService:
    def __init__(self, *, settings_store, debug_logging, emit, user_home, game_mode, incidents):
        self._settings_store = settings_store
        self._incidents = incidents
        self._debug_logging = debug_logging
        self._emit = emit
        self._user_home = user_home
        self._game_mode = game_mode
        self._combo_enabled = False
        self._recovery_logs = False
        self._combo_fired_at = None
        self._generation = 0
        self._lock = threading.Lock()
        self._thread = None
        self._stop_w = None
        self._sync_lock = threading.Lock()

    def sync(self) -> None:
        with self._sync_lock:
            cfg = self._settings_store.load_config()
            self._combo_enabled = bool(cfg.get("recoveryButtonCombo", False))
            self._recovery_logs = bool(cfg.get("recoveryLogs", False))
            wanted = cfg.get("backButtonsGlobal", False) or cfg.get("browserSnapshot", False) or self._combo_enabled
            if wanted and self._game_mode():
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
                timeout = RESCAN_RETRY_SECONDS if retries else self._combo_time_left(nodes)
                ready, _, _ = select.select(watched, [], [], timeout)

                if stop_r in ready:
                    break

                if not ready:
                    if retries:
                        failed = self._rescan(nodes)
                        watched = self._watch_list(stop_r, netlink, nodes)
                        retries = retries - 1 if failed else 0
                        if failed and not retries:
                            decky.logger.warning("back buttons: gave up opening %d controller node(s)", failed)
                    self._check_combo(nodes)
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

                self._check_combo(nodes)
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
        state = button_state(node.fmt, data)
        self._decode_menu_combo(node, data, state)
        if state == node.state:
            return
        pressed = pressed_buttons(node.fmt, node.state, state)
        node.state = state
        self._track_combo(node)
        if self._combo_enabled and held_summon_buttons(node.fmt, state) > 1:
            if pressed and self._debug_logging():
                decky.logger.info("back buttons: %s on %s held back (combo chord)", ",".join(pressed), node.name)
            return
        if pressed and other_button_held(node.fmt, data):
            if self._debug_logging():
                decky.logger.info("back buttons: %s on %s held back (other button held)", ",".join(pressed), node.name)
            return
        for button in pressed:
            self._on_press(node, button)

    def _decode_menu_combo(self, node: _OpenNode, data: bytes, paddles: int) -> None:
        menu_state = menu_combo_state(node.fmt, data)
        if menu_state == node.menu_state:
            return
        before = node.menu_state
        node.menu_state = menu_state
        armed = node.menu_armed
        if armed is not None and not menu_state & menu_combo_bit(node.fmt, armed):
            node.menu_armed = None
            self._on_menu_combo(node, _MENU_COMBO_KEYS[armed])
            return
        partner = menu_combo_pressed(node.fmt, before, menu_state)
        if partner is None:
            return
        if paddles or other_button_beside_menu_combo(node.fmt, data):
            if self._debug_logging():
                decky.logger.info("back buttons: %s on %s held back (other button held)", _MENU_COMBO_KEYS[partner], node.name)
            return
        node.menu_armed = partner

    def _track_combo(self, node: _OpenNode) -> None:
        mask = combo_mask(node.fmt)
        if not mask or node.state & mask != mask:
            if node.combo_since is not None and self._recovery_logs:
                decky.logger.info(
                    "back buttons: recovery combo on %s let go after %.1fs",
                    node.name,
                    time.monotonic() - node.combo_since,
                )
            node.combo_since = None
            node.combo_spent = False
            return
        if self._combo_enabled and not node.combo_spent and node.combo_since is None:
            node.combo_since = time.monotonic()
            if self._recovery_logs:
                decky.logger.info("back buttons: recovery combo held on %s, firing in %.0fs", node.name, COMBO_HOLD_SECONDS)

    def _combo_time_left(self, nodes: dict):
        left = None
        now = time.monotonic()
        for node in nodes.values():
            if node.combo_since is None:
                continue
            remaining = max(0.0, COMBO_HOLD_SECONDS - (now - node.combo_since))
            if left is None or remaining < left:
                left = remaining
        return left

    def _check_combo(self, nodes: dict) -> None:
        now = time.monotonic()
        for node in nodes.values():
            if node.combo_since is None or now - node.combo_since < COMBO_HOLD_SECONDS:
                continue
            node.combo_since = None
            node.combo_spent = True
            if not self._combo_enabled:
                continue
            self._fire_combo(node, now)

    def _fire_combo(self, node: _OpenNode, now: float) -> None:
        if self._combo_fired_at is not None and now - self._combo_fired_at < COMBO_COOLDOWN_SECONDS:
            decky.logger.info(
                "back buttons: recovery combo held on %s, ignored (fired %ds ago)",
                node.name,
                now - self._combo_fired_at,
            )
            return
        self._combo_fired_at = now
        capture = "off"
        logs_on = self._recovery_logs
        if logs_on:
            capture = write_capture(
                source="combo",
                summary=(
                    f"Recovery Button Combo held {COMBO_HOLD_SECONDS:.0f}s on {node.name} ({node.fmt}) "
                    f"at {time.strftime('%Y-%m-%d %H:%M:%S')}"
                ),
                user_home=self._user_home,
            )
        killed = kill_steamwebhelper()
        decky.logger.info(
            "back buttons: recovery combo held %.0fs on %s (%s), killed %d steamwebhelper processes, capture %s",
            COMBO_HOLD_SECONDS,
            node.name,
            node.fmt,
            killed,
            capture,
        )
        self._incidents.add_manual(controller=node.fmt, killed=killed, capture=capture if logs_on else None)

    def _on_menu_combo(self, node: _OpenNode, key: str) -> None:
        cfg = self._settings_store.load_config()
        action = None
        if cfg.get("backButtonsGlobal", False):
            action = self._settings_store.get_shortcut_bindings(cfg).get(key)
        if action not in SUMMON_ACTIONS:
            if self._debug_logging():
                decky.logger.info("back buttons: %s on %s has nothing to send", key, node.name)
            return
        if self._debug_logging():
            decky.logger.info("back buttons: %s on %s sent action=%s", key, node.name, action)
        self._emit({"action": action, "browserSnapshot": False})

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
