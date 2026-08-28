"""Dynamic Dolphin controller-config generation for the Dolphin Mapper utility.

Everything the mapper does comes down to string assembly over a small set of
shipped master profiles. The masters are Steam Deck SDL solo profiles; because
SDL normalizes tokens across every controller, switching controller type is only
a device-NAME swap on the `Device` line, never a binding change. Per-player
indexing, section relabeling and the handful of GameCube camera transforms all
happen here so the mixin stays a thin IPC layer.

Kept stdlib-only and free of decky imports so it can be exercised in isolation.
"""

import re

from pathlib import Path


DOLPHIN_FLATPAK_APP_ID = "org.DolphinEmu.dolphin-emu"

SDL_DEVICE_NAMES = {
    "steamdeck": "Steam Deck Controller",
    "rogally": "Asus Rog Ally Controller",
    "steamcontroller": "Steam Controller",
    "xbox": "Xbox Series X Controller",
    "xboxone": "Xbox One controller",
    "dualsense": "DualSense Wireless Controller",
    "ps4": "PlayStation 4 Controller",
    "switchpro": "Nintendo Switch Pro Controller",
}

REAL_WIIMOTE = "realwiimote"


def is_real_wiimote(system, slot):
    return system == "wii" and slot.get("controllerType") == REAL_WIIMOTE

GC_MASTER = "GCPad/nintendo_layout_p1_steamdeck.ini"

WII_SIDEWAYS_MASTER = "Wiimote/bases/wii_p1_steamdeck.ini"
WII_NUNCHUK_MASTER = "Wiimote/bases/wii_and_nunchuck_p1_steamdeck.ini"

WII_CLASSIC_MASTERS = {
    ("standard", False): "Wiimote/bases/classic_controller_p1_steamdeck.ini",
    ("standard", True): "Wiimote/bases/classic_controller_p1_steamdeck_trigger_swap.ini",
    ("literal", False): "Wiimote/bases/classic_controller_xbox_p1_steamdeck.ini",
    ("literal", True): "Wiimote/bases/classic_controller_xbox_p1_steamdeck_trigger_swap.ini",
}

POINTER_DEVICE = "XInput2/0/Virtual core pointer"

RUMBLE_MOTOR_TERMS = {
    "both": "Motor",
    "left": "`Motor L`",
    "right": "`Motor R`",
}

RUMBLE_RANGE_KEY = "Rumble/Motor/Range"


def rumble_motor_term(motor):
    """The Dolphin expression for a semantic motor value, backticked if it
    needs to be. Unknown values fall back to the combined output."""
    return RUMBLE_MOTOR_TERMS.get(motor, RUMBLE_MOTOR_TERMS["both"])


DEADZONE_MAX = 50


def _number_line(raw, *, default, maximum):
    """Dolphin writes every numeric setting with a trailing period (`90.`, `0.`),
    so match that byte for byte. Anything unusable falls back to the default.
    Percentages, degrees and centimetres all serialize the same way, and none of
    them go below zero here."""
    try:
        value = int(raw)
    except (ValueError, TypeError, OverflowError):
        value = default
    return "{}.".format(max(0, min(maximum, value)))


def rumble_range_value(strength):
    return _number_line(strength, default=100, maximum=100)


def deadzone_value(percent):
    return _number_line(percent, default=0, maximum=DEADZONE_MAX)


def deadzone_keys(system, wii_style):
    """The (left stick, right stick) Dead Zone keys a profile has, either of
    which is None where that stick has nothing a deadzone can apply to.

    The key belongs to whatever group the physical stick is bound INTO, which on
    Wii means the emulated attachment rather than the bare Wiimote: the Nunchuk's
    stick, or the Classic's own two. On the Wii side an attachment is the ONLY
    thing that offers a deadzone (confirmed in Dolphin's UI), which is what rules
    Sideways out entirely: it has no attachment, and its left stick rides on
    the Wiimote D-Pad, a Buttons group with no numeric settings at all. A stick
    bound to a digital direction there flips it at a fixed ~50% deflection, so
    it already ignores far more travel than any deadzone would ask for.

    Nunchuk and Sideways put the right stick on the IR pointer, so neither has a
    plain stick deadzone on that side. On Nunchuk the pointer's own `IR/Dead
    Zone` covers it instead — see _apply_ir_settings below — and Sideways is left
    with nothing, which is the whole reason its Map Directions row exists."""
    if system == "gamecube":
        return "Main Stick/Dead Zone", "C-Stick/Dead Zone"
    if wii_style == "classic":
        return "Classic/Left Stick/Dead Zone", "Classic/Right Stick/Dead Zone"
    if wii_style == "wiimote_nunchuk":
        return "Nunchuk/Stick/Dead Zone", None
    return None, None


IR_YAW_MAX = 90
IR_PITCH_MAX = 90
IR_OFFSET_MAX = 30

IR_DEADZONE_DEFAULT = 10
IR_YAW_DEFAULT = 25
IR_PITCH_DEFAULT = 20
IR_OFFSET_DEFAULT = 10
IR_AUTO_HIDE_DEFAULT = False
IR_RELATIVE_INPUT_DEFAULT = True


def has_ir_settings(system, wii_style):
    return system == "wii" and wii_style == "wiimote_nunchuk"


def _bool_line(raw, default):
    value = default if raw is None else bool(raw)
    return "True" if value else "False"


def _apply_ir_settings(body, slot):
    _rewrite_value(body, "IR/Dead Zone", deadzone_value(
        slot.get("irDeadzone", IR_DEADZONE_DEFAULT)))
    _rewrite_value(body, "IR/Total Yaw", _number_line(
        slot.get("irTotalYaw", IR_YAW_DEFAULT), default=IR_YAW_DEFAULT, maximum=IR_YAW_MAX))
    _rewrite_value(body, "IR/Total Pitch", _number_line(
        slot.get("irTotalPitch", IR_PITCH_DEFAULT), default=IR_PITCH_DEFAULT, maximum=IR_PITCH_MAX))
    _rewrite_value(body, "IR/Vertical Offset", _number_line(
        slot.get("irVerticalOffset", IR_OFFSET_DEFAULT), default=IR_OFFSET_DEFAULT,
        maximum=IR_OFFSET_MAX))
    _rewrite_value(body, "IR/Relative Input", _bool_line(
        slot.get("irRelativeInput"), IR_RELATIVE_INPUT_DEFAULT))
    _rewrite_value(body, "IR/Auto-Hide", _bool_line(
        slot.get("irAutoHide"), IR_AUTO_HIDE_DEFAULT))

_SIDEWAYS_DPAD_KEYS = ("D-Pad/Up", "D-Pad/Down", "D-Pad/Left", "D-Pad/Right")
_STICK_TERM_RE = re.compile(r"Axis \d")


def _apply_sideways_directions(body, source):
    """Keep only the pad half or only the stick half of the OR'd D-Pad lines."""
    if source not in ("dpad", "stick"):
        return
    want_stick = source == "stick"
    for key in _SIDEWAYS_DPAD_KEYS:
        value = _get_value(body, key)
        if value is None:
            continue
        terms = [term for term in value.split("|") if term]
        kept = [term for term in terms if bool(_STICK_TERM_RE.search(term)) == want_stick]
        if kept:
            _rewrite_value(body, key, "|".join(kept))

_FACE_POSITION_SWAP = {"S": "E", "E": "S", "N": "W", "W": "N"}

_AB_POSITION_SWAP = {"S": "E", "E": "S"}

_XY_POSITION_SWAP = {"N": "W", "W": "N"}

_FACE_BUTTON_RE = re.compile(r"Button ([SENW])\b")

NINTENDO_STYLE_CONTROLLERS = frozenset({"switchpro"})


def is_nintendo_style(controller_type):
    return controller_type in NINTENDO_STYLE_CONTROLLERS


def _effective_face_layout(slot):
    """The layout a slot actually generates.

    Both half-swaps ask for one pair where Nintendo puts it and the other on the
    pad's own labels. On a Nintendo-labelled pad those are the same place, so
    both goals collapse onto "standard" and the half-swaps could only cross the
    pair they were meant to leave alone. The modal doesn't offer them on those
    pads; this folds them back for a slot retyped to one afterwards."""
    layout = slot.get("faceLayout") or "standard"
    if layout in ("swap_ab", "swap_xy") and is_nintendo_style(slot.get("controllerType")):
        return "standard"
    return layout


def sdl_device_name(controller_type):
    """Resolve a controller type to its SDL device name, defaulting to the Deck."""
    return SDL_DEVICE_NAMES.get(controller_type, SDL_DEVICE_NAMES["steamdeck"])


def _master_rel_path(system, wii_style, slot):
    if system == "gamecube":
        return GC_MASTER
    if wii_style == "wiimote_nunchuk":
        return WII_NUNCHUK_MASTER
    if wii_style == "classic":
        face = "standard" if _effective_face_layout(slot) == "standard" else "literal"
        swap = bool(slot.get("triggerSwap"))
        return WII_CLASSIC_MASTERS[(face, swap)]
    return WII_SIDEWAYS_MASTER


def _load_master_body(defaults_dir, rel_path):
    """Read a master profile and return its body lines with the [Profile]
    header stripped. The first surviving line is the Device line."""
    text = Path(defaults_dir, rel_path).read_text(encoding="utf-8")
    lines = text.splitlines()
    body = [ln for ln in lines if ln.strip() and ln.strip() != "[Profile]"]
    return body


def _split_kv(line):
    """Split a `Key = Value` INI line, preserving the exact key text. Returns
    (key, value) or (None, None) for non-assignment lines."""
    if "=" not in line:
        return None, None
    key, _, value = line.partition("=")
    return key.strip(), value.strip()


def _rewrite_value(body, target_key, new_value):
    for i, line in enumerate(body):
        key, _ = _split_kv(line)
        if key == target_key:
            body[i] = "{} = {}".format(target_key, new_value)
            return True
    return False


def _get_value(body, target_key):
    for line in body:
        key, value = _split_kv(line)
        if key == target_key:
            return value
    return None


def _swap_values(body, key_a, key_b):
    """Swap the right-hand values of two keys in place (used for camera invert)."""
    idx_a = idx_b = None
    val_a = val_b = None
    for i, line in enumerate(body):
        key, value = _split_kv(line)
        if key == key_a:
            idx_a, val_a = i, value
        elif key == key_b:
            idx_b, val_b = i, value
    if idx_a is None or idx_b is None:
        return
    body[idx_a] = "{} = {}".format(key_a, val_b)
    body[idx_b] = "{} = {}".format(key_b, val_a)


def _swap_face_positions(body, swaps):
    """Move face buttons around in place, per a position table. Letters the
    table doesn't mention stay where they are."""
    for i, line in enumerate(body):
        body[i] = _FACE_BUTTON_RE.sub(
            lambda m: "Button " + swaps.get(m.group(1), m.group(1)), line
        )


def _face_swap_table(system, wii_style, slot):
    """Which face-position table this slot's layout needs, or None to leave the
    master's face buttons where they are.

    Sideways is excluded outright: its 1/2 layout is a fixed comfort mapping
    that ignores faceLayout, the same call slotShowsFaceLayout makes on the
    frontend. Beyond that, the full diagonal swap only serves the two styles
    that ship a single Xbox-physical master; Classic picks its standard body off
    disk instead. The A/B-only layout is a transform everywhere, always applied
    to an Xbox-physical body."""
    if system == "wii" and wii_style not in ("classic", "wiimote_nunchuk"):
        return None
    layout = _effective_face_layout(slot)
    if layout == "swap_ab":
        return _AB_POSITION_SWAP
    if layout == "swap_xy":
        return _XY_POSITION_SWAP
    if layout == "standard" and wii_style != "classic":
        return _FACE_POSITION_SWAP
    return None


def _build_body(defaults_dir, system, wii_style, slot, device):
    rel = _master_rel_path(system, wii_style, slot)
    body = _load_master_body(defaults_dir, rel)

    _rewrite_value(body, "Device", device)

    _rewrite_value(body, "Rumble/Motor", rumble_motor_term(slot.get("rumbleMotor")))
    _rewrite_value(body, RUMBLE_RANGE_KEY, rumble_range_value(slot.get("rumbleStrength", 100)))

    left_key, right_key = deadzone_keys(system, wii_style)
    if left_key:
        _rewrite_value(body, left_key, deadzone_value(slot.get("leftStickDeadzone", 0)))
    if right_key:
        _rewrite_value(body, right_key, deadzone_value(slot.get("rightStickDeadzone", 0)))

    if system == "wii" and wii_style == "wiimote_sideways":
        _apply_sideways_directions(body, slot.get("sidewaysDirections"))

    if has_ir_settings(system, wii_style):
        _apply_ir_settings(body, slot)

    swaps = _face_swap_table(system, wii_style, slot)
    if swaps:
        _swap_face_positions(body, swaps)

    if system == "gamecube":
        if slot.get("invertCamX"):
            _swap_values(body, "C-Stick/Left", "C-Stick/Right")
        if slot.get("invertCamY"):
            _swap_values(body, "C-Stick/Up", "C-Stick/Down")
    elif wii_style == "classic":
        classic_a = _get_value(body, "Classic/Buttons/A")
        classic_b = _get_value(body, "Classic/Buttons/B")
        classic_x = _get_value(body, "Classic/Buttons/X")
        classic_y = _get_value(body, "Classic/Buttons/Y")
        if classic_a is not None:
            _rewrite_value(body, "Buttons/A", classic_a)
        if classic_b is not None:
            _rewrite_value(body, "Buttons/B", classic_b)
        if classic_y is not None:
            _rewrite_value(body, "Buttons/1", classic_y)
        if classic_x is not None:
            _rewrite_value(body, "Buttons/2", classic_x)

    if system == "wii":
        for i, line in enumerate(body):
            if _split_kv(line)[0] == "Device":
                body.insert(i + 1, "Source = 1")
                break

    return body


def _balance_board_section(enabled):
    return "[BalanceBoard]\nSource = {}".format("2" if enabled else "0")


def _unused_section(system, port):
    if system == "wii":
        return "[Wiimote{}]\nDevice = {}\nSource = 0".format(port, POINTER_DEVICE)
    return "[GCPad{}]\nDevice = {}".format(port, POINTER_DEVICE)


def generate_ini(defaults_dir, mapping, *, balance_board=False):
    """Assemble a full GCPadNew.ini / WiimoteNew.ini body for a mapping.

    Ports are assigned in player-list order. Duplicate controller names get
    incrementing SDL indices (SDL/0, SDL/1, ...) exactly as Dolphin expects;
    which physical pad lands on which port is power-on order, by design.

    balance_board is the page-level toggle rather than anything the mapping
    carries: the board isn't a player slot, it's a fifth section this file owns,
    and re-emitting it here is what stops an apply from wiping a board the user
    switched on.
    """
    system = mapping.get("system")
    wii_style = mapping.get("wiiStyle")
    players = mapping.get("players") or []
    is_wii = system == "wii"
    header = "Wiimote" if is_wii else "GCPad"

    sections = []
    name_counts = {}
    for i, slot in enumerate(players[:4]):
        if is_real_wiimote(system, slot):
            sections.append("[{}{}]\nSource = 2".format(header, i + 1))
            continue

        name = sdl_device_name(slot.get("controllerType"))
        index = name_counts.get(name, 0)
        name_counts[name] = index + 1
        device = "SDL/{}/{}".format(index, name)
        body = _build_body(defaults_dir, system, wii_style, slot, device)
        sections.append("[{}{}]\n{}".format(header, i + 1, "\n".join(body)))

    for port in range(len(players[:4]) + 1, 5):
        sections.append(_unused_section(system, port))

    if is_wii:
        sections.append(_balance_board_section(balance_board))

    return "\n".join(sections) + "\n"


def generate_empty_ini(system):
    """All four ports blanked for a system. Written over the OTHER system's
    config on every apply: some games (e.g. Arc Rise Fantasia) glitch their
    controls when both a Wii and a GameCube controller are configured at once,
    so applying one system's mapping clears the other.

    This is the whole story for Wii (Source = 0 turns the port off) but only
    half of it for GameCube, where the port itself is switched in Dolphin.ini.
    gc_si_devices() carries the other half.

    The Balance Board goes off with the ports, whatever the toggle says: this
    runs when a GameCube mapping is applied, and a board can't do anything for a
    GameCube game. The toggle keeps its value and the next Wii apply arms it
    again, the same way the mapping's own players come back."""
    sections = [_unused_section(system, port) for port in range(1, 5)]
    if system == "wii":
        sections.append(_balance_board_section(False))
    return "\n".join(sections) + "\n"


SI_DEVICE_NONE = "0"
SI_DEVICE_STANDARD_PAD = "6"


def gc_si_devices(mapping):
    """The four [Core] SIDevice values a mapping implies, port 1 to 4.

    GameCube ports are switched on in Dolphin.ini, not GCPadNew.ini -- the pad
    file only carries bindings. So blanking GCPadNew.ini drops the mappings and
    leaves the pad plugged in, and a port with no SIDevice key at all reads as
    Standard Controller, because that's Dolphin's default and it only persists
    values that differ from it. Turning a port off has to be written out.

    Same rule Source already follows on the Wii side: the ports the mapping
    actually uses are on, everything else is off. A Wii mapping turns all four
    off, which is the point -- that's the GameCube half of the cross-system
    clear that generate_empty_ini() can't express."""
    if mapping.get("system") != "gamecube":
        return [SI_DEVICE_NONE] * 4
    mapped = len((mapping.get("players") or [])[:4])
    return [
        SI_DEVICE_STANDARD_PAD if port < mapped else SI_DEVICE_NONE
        for port in range(4)
    ]


def other_system(system):
    return "gamecube" if system == "wii" else "wii"


def output_filename(system):
    return "WiimoteNew.ini" if system == "wii" else "GCPadNew.ini"
