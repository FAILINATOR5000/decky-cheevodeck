from pathlib import Path

import array
import fcntl
import os
import select
import socket
import struct
import threading
import time

import decky

from freeze_capture import write_capture
from utils import kill_steamwebhelper

BACK_BUTTON_EVENT = "cheevodeck_back_button"

NETLINK_KOBJECT_UEVENT = 15

VALVE_VENDOR_ID = 0x28DE
SONY_VENDOR_ID = 0x054C
MICROSOFT_VENDOR_ID = 0x045E
NINTENDO_VENDOR_ID = 0x057E

BUS_BLUETOOTH = 0x0005

DECK_FORMAT = "deck"
CONTROLLER_FORMAT = "controller"
ALLY_FORMAT = "ally"

DUALSENSE_DEVICE = "dualsense"
DUALSHOCK4_DEVICE = "dualshock4"
XBOX_DEVICE = "xbox"
SWITCH_PRO_DEVICE = "switchpro"

DUALSENSE_BT_FORMAT = "dualsense_bt"
DUALSENSE_USB_FORMAT = "dualsense_usb"
DUALSHOCK4_BT_FORMAT = "dualshock4_bt"
XBOX_BT_FORMAT = "xbox_bt"
SWITCH_PRO_SIMPLE_FORMAT = "switchpro_simple"
SWITCH_PRO_FULL_FORMAT = "switchpro_full"
XBOX_USB_FORMAT = "xbox_usb"

_DEVICES = {
    (VALVE_VENDOR_ID, 0x1205): DECK_FORMAT,
    (VALVE_VENDOR_ID, 0x12FD): ALLY_FORMAT,
    (VALVE_VENDOR_ID, 0x1302): CONTROLLER_FORMAT,
    (VALVE_VENDOR_ID, 0x1304): CONTROLLER_FORMAT,
    (VALVE_VENDOR_ID, 0x1305): CONTROLLER_FORMAT,
    (SONY_VENDOR_ID, 0x0CE6): DUALSENSE_DEVICE,
    (SONY_VENDOR_ID, 0x05C4): DUALSHOCK4_DEVICE,
    (SONY_VENDOR_ID, 0x09CC): DUALSHOCK4_DEVICE,
    (MICROSOFT_VENDOR_ID, 0x0B13): XBOX_DEVICE,
    (NINTENDO_VENDOR_ID, 0x2009): SWITCH_PRO_DEVICE,
}

_BLUETOOTH_ONLY = (DUALSHOCK4_DEVICE,)

_REPORT_FORMATS = {
    (DUALSENSE_DEVICE, 0x31, 78): DUALSENSE_BT_FORMAT,
    (DUALSENSE_DEVICE, 0x01, 64): DUALSENSE_USB_FORMAT,
    (DUALSHOCK4_DEVICE, 0x11, 78): DUALSHOCK4_BT_FORMAT,
    (XBOX_DEVICE, 0x01, 17): XBOX_BT_FORMAT,
    (SWITCH_PRO_DEVICE, 0x3F, 12): SWITCH_PRO_SIMPLE_FORMAT,
    (SWITCH_PRO_DEVICE, 0x30, 49): SWITCH_PRO_FULL_FORMAT,
    (SWITCH_PRO_DEVICE, 0x30, 64): SWITCH_PRO_FULL_FORMAT,
}

_EVDEV_DEVICES = {
    (MICROSOFT_VENDOR_ID, 0x0B12): XBOX_USB_FORMAT,
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
        ("l5", 9, 0x80),
        ("r5", 10, 0x01),
    ),
    CONTROLLER_FORMAT: (
        ("l4", 4, 0x02),
        ("r4", 2, 0x80),
        ("l5", 4, 0x04),
        ("r5", 3, 0x01),
    ),
    DUALSENSE_BT_FORMAT: (),
    DUALSENSE_USB_FORMAT: (),
    DUALSHOCK4_BT_FORMAT: (),
    XBOX_BT_FORMAT: (),
    XBOX_USB_FORMAT: (),
    SWITCH_PRO_SIMPLE_FORMAT: (),
    SWITCH_PRO_FULL_FORMAT: (),
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
    "darkenScreen",
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
    "milestones",
    "dolphinMapper",
    "stormbreaker",
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
        ("l3", 10, 0x40),
        ("r3", 11, 0x04),
    ),
    ALLY_FORMAT: (
        ("menu", 9, 0x40),
        ("up", 9, 0x01),
        ("down", 9, 0x08),
        ("left", 9, 0x04),
        ("right", 9, 0x02),
        ("l1", 8, 0x08),
        ("r1", 8, 0x04),
        ("l3", 10, 0x40),
        ("r3", 11, 0x04),
    ),
    CONTROLLER_FORMAT: (
        ("menu", 2, 0x40),
        ("up", 3, 0x20),
        ("down", 3, 0x04),
        ("left", 3, 0x10),
        ("right", 3, 0x08),
        ("l1", 4, 0x08),
        ("r1", 3, 0x02),
        ("l3", 3, 0x80),
        ("r3", 2, 0x20),
    ),
    DUALSENSE_BT_FORMAT: (
        ("menu", 10, 0x20),
        ("up", 78, 0x01),
        ("down", 78, 0x02),
        ("left", 78, 0x04),
        ("right", 78, 0x08),
        ("l1", 10, 0x01),
        ("r1", 10, 0x02),
        ("l3", 10, 0x40),
        ("r3", 10, 0x80),
    ),
    DUALSENSE_USB_FORMAT: (
        ("menu", 9, 0x20),
        ("up", 64, 0x01),
        ("down", 64, 0x02),
        ("left", 64, 0x04),
        ("right", 64, 0x08),
        ("l1", 9, 0x01),
        ("r1", 9, 0x02),
        ("l3", 9, 0x40),
        ("r3", 9, 0x80),
    ),
    DUALSHOCK4_BT_FORMAT: (
        ("menu", 8, 0x20),
        ("up", 78, 0x01),
        ("down", 78, 0x02),
        ("left", 78, 0x04),
        ("right", 78, 0x08),
        ("l1", 8, 0x01),
        ("r1", 8, 0x02),
        ("l3", 8, 0x40),
        ("r3", 8, 0x80),
    ),
    XBOX_BT_FORMAT: (
        ("menu", 15, 0x08),
        ("up", 17, 0x01),
        ("down", 17, 0x02),
        ("left", 17, 0x04),
        ("right", 17, 0x08),
        ("l1", 14, 0x40),
        ("r1", 14, 0x80),
        ("l3", 15, 0x20),
        ("r3", 15, 0x40),
    ),
    XBOX_USB_FORMAT: (
        ("menu", 0, 0x01),
        ("up", 2, 0x01),
        ("down", 2, 0x02),
        ("left", 2, 0x04),
        ("right", 2, 0x08),
        ("l1", 1, 0x10),
        ("r1", 1, 0x20),
        ("l3", 0, 0x10),
        ("r3", 0, 0x20),
    ),
    SWITCH_PRO_SIMPLE_FORMAT: (
        ("menu", 2, 0x02),
        ("up", 12, 0x01),
        ("down", 12, 0x02),
        ("left", 12, 0x04),
        ("right", 12, 0x08),
        ("l1", 1, 0x10),
        ("r1", 1, 0x20),
        ("l3", 2, 0x04),
        ("r3", 2, 0x08),
    ),
    SWITCH_PRO_FULL_FORMAT: (
        ("menu", 4, 0x02),
        ("up", 5, 0x02),
        ("down", 5, 0x01),
        ("left", 5, 0x08),
        ("right", 5, 0x04),
        ("l1", 5, 0x40),
        ("r1", 3, 0x40),
        ("l3", 4, 0x08),
        ("r3", 4, 0x04),
    ),
}

_MENU_COMBO_KEYS = {
    "up": "menuUp",
    "down": "menuDown",
    "left": "menuLeft",
    "right": "menuRight",
    "l1": "menuL1",
    "r1": "menuR1",
    "l3": "menuL3",
    "r3": "menuR3",
}

_CHORD_BITS = {
    DECK_FORMAT: ((8, 0xFF), (9, 0x7F), (10, 0x46), (11, 0x04), (14, 0x04)),
    ALLY_FORMAT: ((8, 0xFF), (9, 0x7F), (10, 0x46), (11, 0x04), (14, 0x04)),
    CONTROLLER_FORMAT: ((2, 0x7F), (3, 0xFE), (4, 0x89), (5, 0x0C)),
    DUALSENSE_BT_FORMAT: ((9, 0xF0), (10, 0xFF), (11, 0x07)),
    DUALSENSE_USB_FORMAT: ((8, 0xF0), (9, 0xFF), (10, 0x07)),
    DUALSHOCK4_BT_FORMAT: ((7, 0xF0), (8, 0xFF), (9, 0x03)),
    XBOX_BT_FORMAT: ((14, 0xDB), (15, 0x7C), (16, 0x01), (17, 0x30)),
    XBOX_USB_FORMAT: ((0, 0x3F), (1, 0x3F), (2, 0x30)),
    SWITCH_PRO_SIMPLE_FORMAT: ((1, 0xFF), (2, 0x3F)),
    SWITCH_PRO_FULL_FORMAT: ((3, 0xCF), (4, 0x3F), (5, 0xCF)),
}

_ADDED_UP = 0x01
_ADDED_DOWN = 0x02
_ADDED_LEFT = 0x04
_ADDED_RIGHT = 0x08
_ADDED_LT = 0x10
_ADDED_RT = 0x20

_HAT_DPADS = {
    DUALSENSE_BT_FORMAT: (9, 0),
    DUALSENSE_USB_FORMAT: (8, 0),
    DUALSHOCK4_BT_FORMAT: (7, 0),
    XBOX_BT_FORMAT: (13, 1),
    SWITCH_PRO_SIMPLE_FORMAT: (3, 0),
}

_HAT_DIRECTIONS = (
    _ADDED_UP,
    _ADDED_UP | _ADDED_RIGHT,
    _ADDED_RIGHT,
    _ADDED_RIGHT | _ADDED_DOWN,
    _ADDED_DOWN,
    _ADDED_DOWN | _ADDED_LEFT,
    _ADDED_LEFT,
    _ADDED_LEFT | _ADDED_UP,
)

XBOX_TRIGGER_HELD = 100

_RECOVERY_COMBOS = {
    DECK_FORMAT: ("l4", "l5", "r4", "r5"),
    ALLY_FORMAT: ("l5", "r5"),
    CONTROLLER_FORMAT: ("l4", "l5", "r4", "r5"),
}

COMBO_HOLD_SECONDS = 3.0
COMBO_COOLDOWN_SECONDS = 30.0

BROWSER_SNAPSHOT_BUTTON = "r4"

HIDRAW_CLASS_DIR = Path("/sys/class/hidraw")
EVDEV_CLASS_DIR = Path("/sys/class/input")

READ_SIZE = 128
NETLINK_READ_SIZE = 8192

INPUT_EVENT = struct.Struct("llHHi")
EVDEV_READ_SIZE = INPUT_EVENT.size * 64

EV_SYN = 0x00
EV_KEY = 0x01
EV_ABS = 0x03
SYN_REPORT = 0
SYN_DROPPED = 3
ABS_Z = 0x02
ABS_RZ = 0x05
ABS_HAT0X = 0x10
ABS_HAT0Y = 0x11
ABS_MAX = 0x3F
_EVDEV_AXES = (ABS_Z, ABS_RZ, ABS_HAT0X, ABS_HAT0Y)

KEY_RECORD = 0x0A7
BTN_SOUTH = 0x130
BTN_EAST = 0x131
BTN_NORTH = 0x133
BTN_WEST = 0x134
BTN_TL = 0x136
BTN_TR = 0x137
BTN_SELECT = 0x13A
BTN_START = 0x13B
BTN_MODE = 0x13C
BTN_THUMBL = 0x13D
BTN_THUMBR = 0x13E

_EVDEV_KEYS = {
    BTN_START: (0, 0x01),
    BTN_SELECT: (0, 0x02),
    KEY_RECORD: (0, 0x04),
    BTN_MODE: (0, 0x08),
    BTN_THUMBL: (0, 0x10),
    BTN_THUMBR: (0, 0x20),
    BTN_SOUTH: (1, 0x01),
    BTN_EAST: (1, 0x02),
    BTN_NORTH: (1, 0x04),
    BTN_WEST: (1, 0x08),
    BTN_TL: (1, 0x10),
    BTN_TR: (1, 0x20),
}
EVDEV_REPORT_SIZE = 3


def _evdev_ioctl(direction: int, number: int, size: int) -> int:
    return direction << 30 | size << 16 | ord("E") << 8 | number


EVDEV_KEY_BYTES = 96
EVIOCGKEY = _evdev_ioctl(2, 0x18, EVDEV_KEY_BYTES)
EVIOCSMASK = _evdev_ioctl(1, 0x93, 16)
ABSINFO = struct.Struct("6i")


def _eviocgabs(code: int) -> int:
    return _evdev_ioctl(2, 0x40 + code, ABSINFO.size)

RESCAN_RETRY_SECONDS = 1.0
RESCAN_RETRY_PASSES = 5

BATCH_SECONDS = 0.01


def device_from_uevent(text: str):
    for line in text.splitlines():
        if not line.startswith("HID_ID="):
            continue
        parts = line[len("HID_ID="):].split(":")
        if len(parts) != 3:
            return None
        try:
            bus = int(parts[0], 16)
            vendor = int(parts[1], 16)
            product = int(parts[2], 16)
        except ValueError:
            return None
        device = _DEVICES.get((vendor, product))
        if device in _BLUETOOTH_ONLY and bus != BUS_BLUETOOTH:
            return None
        return device
    return None


def report_format(device: str, data: bytes):
    if not data:
        return None
    if device in (DECK_FORMAT, ALLY_FORMAT):
        if len(data) == 64 and data[0] == 0x01 and data[2] == 0x09:
            return device
        return None
    if device == CONTROLLER_FORMAT:
        if len(data) == 54 and data[0] == 0x42:
            return device
        return None
    if device == XBOX_USB_FORMAT:
        return device
    return _REPORT_FORMATS.get((device, data[0], len(data)))


def xbox_trigger_pull(data: bytes, low: int) -> int:
    return data[low] | (data[low + 1] & 0x03) << 8


def with_added_byte(fmt: str, data: bytes) -> bytes:
    hat = _HAT_DPADS.get(fmt)
    if hat is None:
        return data
    byte, up = hat
    added = 0
    step = (data[byte] & 0x0F) - up
    if 0 <= step < len(_HAT_DIRECTIONS):
        added = _HAT_DIRECTIONS[step]
    if fmt == XBOX_BT_FORMAT:
        if xbox_trigger_pull(data, 9) >= XBOX_TRIGGER_HELD:
            added |= _ADDED_LT
        if xbox_trigger_pull(data, 11) >= XBOX_TRIGGER_HELD:
            added |= _ADDED_RT
    return data + bytes((added,))


def apply_evdev_axis(report: bytearray, code: int, value: int) -> None:
    if code == ABS_HAT0X:
        report[2] &= ~(_ADDED_LEFT | _ADDED_RIGHT) & 0xFF
        if value < 0:
            report[2] |= _ADDED_LEFT
        elif value > 0:
            report[2] |= _ADDED_RIGHT
    elif code == ABS_HAT0Y:
        report[2] &= ~(_ADDED_UP | _ADDED_DOWN) & 0xFF
        if value < 0:
            report[2] |= _ADDED_UP
        elif value > 0:
            report[2] |= _ADDED_DOWN
    elif code in (ABS_Z, ABS_RZ):
        bit = _ADDED_LT if code == ABS_Z else _ADDED_RT
        if value >= XBOX_TRIGGER_HELD:
            report[2] |= bit
        else:
            report[2] &= ~bit & 0xFF


def apply_evdev_key(report: bytearray, code: int, down: bool) -> None:
    place = _EVDEV_KEYS.get(code)
    if place is None:
        return
    byte, mask = place
    if down:
        report[byte] |= mask
    else:
        report[byte] &= ~mask & 0xFF


def evdev_report(fd: int) -> bytearray:
    keys = bytearray(EVDEV_KEY_BYTES)
    fcntl.ioctl(fd, EVIOCGKEY, keys)
    report = bytearray(EVDEV_REPORT_SIZE)
    for code in _EVDEV_KEYS:
        apply_evdev_key(report, code, bool(keys[code // 8] >> (code % 8) & 1))
    for code in _EVDEV_AXES:
        info = bytearray(ABSINFO.size)
        fcntl.ioctl(fd, _eviocgabs(code), info)
        apply_evdev_axis(report, code, ABSINFO.unpack(info)[0])
    return report


def mask_evdev_axes(fd: int) -> None:
    codes = array.array("B", bytes((ABS_MAX + 1) // 8))
    for code in _EVDEV_AXES:
        codes[code // 8] |= 1 << (code % 8)
    address, length = codes.buffer_info()
    fcntl.ioctl(fd, EVIOCSMASK, struct.pack("IIQ", EV_ABS, length, address))


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


def is_controller_hotplug(message: bytes) -> bool:
    fields = message.split(b"\0")
    if b"SUBSYSTEM=hidraw" not in fields and b"SUBSYSTEM=input" not in fields:
        return False
    return b"ACTION=add" in fields or b"ACTION=remove" in fields


def evdev_device(name: str):
    ids = EVDEV_CLASS_DIR / name / "device" / "id"
    try:
        vendor = int((ids / "vendor").read_text(), 16)
        product = int((ids / "product").read_text(), 16)
    except (OSError, ValueError):
        return None
    return _EVDEV_DEVICES.get((vendor, product))


def matching_nodes() -> dict:
    found = {}
    try:
        names = sorted(os.listdir(HIDRAW_CLASS_DIR))
    except OSError:
        names = []
    for name in names:
        try:
            text = (HIDRAW_CLASS_DIR / name / "device" / "uevent").read_text()
        except OSError:
            continue
        device = device_from_uevent(text)
        if device:
            found[name] = device
    try:
        names = sorted(name for name in os.listdir(EVDEV_CLASS_DIR) if name.startswith("event"))
    except OSError:
        names = []
    for name in names:
        device = evdev_device(name)
        if device:
            found[name] = device
    return found


def is_evdev_node(name: str) -> bool:
    return name.startswith("event")


class _OpenNode:
    def __init__(self, name: str, device: str):
        self.name = name
        self.device = device
        self.evdev = is_evdev_node(name)
        self.report = bytearray(EVDEV_REPORT_SIZE)
        self.dropping = False
        self.unknown_logged = False
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

                time.sleep(BATCH_SECONDS)
                ready, _, _ = select.select(watched, [], [], 0)
                if stop_r in ready:
                    break

                if netlink is not None and netlink in ready:
                    try:
                        message = netlink.recv(NETLINK_READ_SIZE)
                    except OSError:
                        message = b""
                    if is_controller_hotplug(message):
                        retries = RESCAN_RETRY_PASSES if self._rescan(nodes) else 0
                        watched = self._watch_list(stop_r, netlink, nodes)

                dropped = False
                for fd in ready:
                    node = nodes.get(fd)
                    if node is None:
                        continue
                    try:
                        if node.evdev:
                            self._read_evdev(fd, node)
                        else:
                            self._read_hidraw(fd, node)
                    except OSError as exc:
                        self._drop(nodes, fd, f"{type(exc).__name__}: {exc}")
                        dropped = True

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
            if wanted.get(node.name) != node.device:
                self._drop(nodes, fd, "removed")

        open_names = {node.name for node in nodes.values()}
        failed = 0
        for name, device in wanted.items():
            if name in open_names:
                continue
            path = f"/dev/input/{name}" if is_evdev_node(name) else f"/dev/{name}"
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError:
                failed += 1
                continue
            node = _OpenNode(name, device)
            if node.evdev and not self._open_evdev(fd, node):
                os.close(fd)
                failed += 1
                continue
            nodes[fd] = node
            decky.logger.info("back buttons: opened %s (%s)", name, device)
        return failed

    def _open_evdev(self, fd: int, node: _OpenNode) -> bool:
        try:
            mask_evdev_axes(fd)
        except OSError as exc:
            decky.logger.info("back buttons: %s refused the axis mask (%s), reading every event", node.name, exc)
        try:
            node.report = evdev_report(fd)
        except OSError as exc:
            decky.logger.info("back buttons: could not read %s's state (%s)", node.name, exc)
            return False
        self._decode(node, bytes(node.report))
        return True

    def _read_hidraw(self, fd: int, node: _OpenNode) -> None:
        while True:
            try:
                data = os.read(fd, READ_SIZE)
            except BlockingIOError:
                return
            if not data:
                return
            self._decode(node, data)

    def _read_evdev(self, fd: int, node: _OpenNode) -> None:
        while True:
            try:
                data = os.read(fd, EVDEV_READ_SIZE)
            except BlockingIOError:
                return
            if not data:
                return
            self._read_evdev_events(fd, node, data)

    def _read_evdev_events(self, fd: int, node: _OpenNode, data: bytes) -> None:
        for offset in range(0, len(data) - INPUT_EVENT.size + 1, INPUT_EVENT.size):
            _sec, _usec, ev_type, code, value = INPUT_EVENT.unpack_from(data, offset)
            if ev_type == EV_SYN and code == SYN_DROPPED:
                node.menu_armed = None
                node.dropping = True
                continue
            if node.dropping:
                if ev_type == EV_SYN and code == SYN_REPORT:
                    node.dropping = False
                    node.report = evdev_report(fd)
                    self._decode(node, bytes(node.report))
                continue
            if ev_type == EV_SYN and code == SYN_REPORT:
                self._decode(node, bytes(node.report))
            elif ev_type == EV_KEY and value != 2:
                apply_evdev_key(node.report, code, bool(value))
            elif ev_type == EV_ABS:
                apply_evdev_axis(node.report, code, value)

    def _drop(self, nodes: dict, fd: int, reason: str) -> None:
        node = nodes.pop(fd)
        try:
            os.close(fd)
        except OSError:
            pass
        decky.logger.info("back buttons: dropped %s (%s)", node.name, reason)

    def _decode(self, node: _OpenNode, data: bytes) -> None:
        fmt = report_format(node.device, data)
        if fmt is None:
            if not node.unknown_logged and node.device not in (DECK_FORMAT, ALLY_FORMAT, CONTROLLER_FORMAT):
                node.unknown_logged = True
                decky.logger.info(
                    "back buttons: %s (%s) sent a report it isn't read for (id 0x%02x, %d bytes); logged once",
                    node.name,
                    node.device,
                    data[0] if data else 0,
                    len(data),
                )
            return
        data = with_added_byte(fmt, data)
        state = button_state(fmt, data)
        self._decode_menu_combo(node, fmt, data, state)
        if state == node.state:
            return
        pressed = pressed_buttons(fmt, node.state, state)
        node.state = state
        self._track_combo(node, fmt)
        if self._combo_enabled and held_summon_buttons(fmt, state) > 1:
            if pressed and self._debug_logging():
                decky.logger.info("back buttons: %s on %s held back (combo chord)", ",".join(pressed), node.name)
            return
        if pressed and other_button_held(fmt, data):
            if self._debug_logging():
                decky.logger.info("back buttons: %s on %s held back (other button held)", ",".join(pressed), node.name)
            return
        for button in pressed:
            self._on_press(node, button)

    def _decode_menu_combo(self, node: _OpenNode, fmt: str, data: bytes, paddles: int) -> None:
        menu_state = menu_combo_state(fmt, data)
        if menu_state == node.menu_state:
            return
        before = node.menu_state
        node.menu_state = menu_state
        armed = node.menu_armed
        if armed is not None and not menu_state & menu_combo_bit(fmt, armed):
            node.menu_armed = None
            self._on_menu_combo(node, _MENU_COMBO_KEYS[armed])
            return
        partner = menu_combo_pressed(fmt, before, menu_state)
        if partner is None:
            return
        if paddles or other_button_beside_menu_combo(fmt, data):
            if self._debug_logging():
                decky.logger.info("back buttons: %s on %s held back (other button held)", _MENU_COMBO_KEYS[partner], node.name)
            return
        node.menu_armed = partner

    def _track_combo(self, node: _OpenNode, fmt: str) -> None:
        mask = combo_mask(fmt)
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
                    f"Recovery Button Combo held {COMBO_HOLD_SECONDS:.0f}s on {node.name} ({node.device}) "
                    f"at {time.strftime('%Y-%m-%d %H:%M:%S')}"
                ),
                user_home=self._user_home,
            )
        killed = kill_steamwebhelper()
        decky.logger.info(
            "back buttons: recovery combo held %.0fs on %s (%s), killed %d steamwebhelper processes, capture %s",
            COMBO_HOLD_SECONDS,
            node.name,
            node.device,
            killed,
            capture,
        )
        self._incidents.add_manual(controller=node.device, killed=killed, capture=capture if logs_on else None)

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
