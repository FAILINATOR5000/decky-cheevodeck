"""Starter Dolphin controller mappings.

Seeded into DolphinMappingsStore the first time the user opens the Dolphin
Mapper page (gated by the global dolphinMappingsSeeded flag). The point is to
hand the user a full, ready-to-apply library instead of an empty page: every
supported controller gets the same battery of GameCube and Wii layouts, grouped
under its own [Tag] headline, plus a handful of mixed-controller multiplayer
setups, and a tag of its own for the real Wii Remote, which shares none of that
battery. The two built-in pads are the other exception — see
_BUILT_IN_CONTROLLERS.

These dicts are intentionally partial — no id, no timestamps. The store's
_clean_mapping mints those and normalizes every field, so what we build here is
exactly the shape the modal hands to save_dolphin_mapping: name, body, system,
optional wiiStyle, and a players list of newSlot-shaped slots. Edit this table
and the seed changes; nothing else has to move.
"""

from dolphin_ini import (
    IR_AUTO_HIDE_DEFAULT,
    IR_DEADZONE_DEFAULT,
    IR_OFFSET_DEFAULT,
    IR_PITCH_DEFAULT,
    IR_RELATIVE_INPUT_DEFAULT,
    IR_YAW_DEFAULT,
    is_nintendo_style,
)


_SINGLE_PLAYER_TAGS = (
    ("Built-In A: Steam Deck", "steamdeck"),
    ("Built-In B: ROG Ally", "rogally"),
    ("DualSense", "dualsense"),
    ("Switch Pro", "switchpro"),
    ("PlayStation 4", "ps4"),
    ("Steam Controller (2026)", "steamcontroller"),
    ("Xbox One", "xboxone"),
    ("Xbox Series X", "xbox"),
)

_REAL_WIIMOTE_TAG = "Wii-Mote (Real)"
_REAL_WIIMOTE_TITLES = ("Single Player", "2 Players", "3 Players", "4 Players")

_MIXED_TAG = "Mixed Multiplayer"
_MIXED_NOTE = "P1 + P2 are Steam Controllers while P3 + P4 are Xbox One Controllers"
_MIXED_CONTROLLERS = ("steamcontroller", "steamcontroller", "xboxone", "xboxone")

_WII_MULTIPLAYER_FACE = "standard"

_BUILT_IN_CONTROLLERS = ("steamdeck", "rogally")


def _aa_face(controller_type):
    return "standard" if is_nintendo_style(controller_type) else "literal"


def _face_title(face, nintendo):
    if nintendo:
        return "Standard (A = A)" if face == "standard" else "Swapped (Xbox)"
    return "Standard (Nintendo)" if face == "standard" else "Literal (A = A)"


def _slot(controller_type, *, invert_x=False, invert_y=False, face="standard", swap=False):
    return {
        "controllerType": controller_type,
        "wireless": True,
        "invertCamX": invert_x,
        "invertCamY": invert_y,
        "faceLayout": face,
        "triggerSwap": swap,
        "rumbleStrength": 100,
        "rumbleMotor": "both",
        "leftStickDeadzone": 0,
        "rightStickDeadzone": 0,
        "sidewaysDirections": "both",
        "irDeadzone": IR_DEADZONE_DEFAULT,
        "irTotalYaw": IR_YAW_DEFAULT,
        "irTotalPitch": IR_PITCH_DEFAULT,
        "irVerticalOffset": IR_OFFSET_DEFAULT,
        "irRelativeInput": IR_RELATIVE_INPUT_DEFAULT,
        "irAutoHide": IR_AUTO_HIDE_DEFAULT,
    }


def _single_player_mappings(tag, controller):
    prefix = f"[{tag}]"
    nintendo = is_nintendo_style(controller)
    aa = _aa_face(controller)
    swapped = "literal" if aa == "standard" else "standard"
    multiplayer = controller not in _BUILT_IN_CONTROLLERS

    def classic(face, trigger):
        title = f"Wii: Classic Controller - {_face_title(face, nintendo)}"
        if trigger:
            title += " - Triggers Swapped"
        return {
            "name": f"{prefix}{title}",
            "body": "",
            "system": "wii",
            "wiiStyle": "classic",
            "players": [_slot(controller, face=face, swap=trigger)],
        }

    cards = [
        {
            "name": f"{prefix}GCN: Standard",
            "body": "",
            "system": "gamecube",
            "players": [_slot(controller, face=aa)],
        },
        {
            "name": f"{prefix}GCN: Reversed C-Stick X",
            "body": "",
            "system": "gamecube",
            "players": [_slot(controller, invert_x=True, face=aa)],
        },
        {
            "name": f"{prefix}GCN: Reversed C-Stick Y",
            "body": "",
            "system": "gamecube",
            "players": [_slot(controller, invert_y=True, face=aa)],
        },
        {
            "name": f"{prefix}GCN: Reversed C-Stick XY",
            "body": "",
            "system": "gamecube",
            "players": [_slot(controller, invert_x=True, invert_y=True, face=aa)],
        },
    ]
    if multiplayer:
        cards.append({
            "name": f"{prefix}GCN: Multiplayer Standard",
            "body": "",
            "system": "gamecube",
            "players": [_slot(controller, face=aa) for _ in range(4)],
        })
    cards.extend([
        classic(aa, False),
        classic(swapped, False),
        classic(aa, True),
        classic(swapped, True),
        {
            "name": f"{prefix}Wii: Wiimote & Nunchuk",
            "body": "",
            "system": "wii",
            "wiiStyle": "wiimote_nunchuk",
            "players": [_slot(controller, face=aa)],
        },
        {
            "name": f"{prefix}Wii: Wiimote (Sideways)",
            "body": "",
            "system": "wii",
            "wiiStyle": "wiimote_sideways",
            "players": [_slot(controller, face=aa)],
        },
    ])
    if multiplayer:
        cards.extend([
            {
                "name": f"{prefix}Wii: Multiplayer Classic Controller",
                "body": "",
                "system": "wii",
                "wiiStyle": "classic",
                "players": [_slot(controller, face=_WII_MULTIPLAYER_FACE) for _ in range(4)],
            },
            {
                "name": f"{prefix}Wii: Multiplayer Wiimote & Nunchuk",
                "body": "",
                "system": "wii",
                "wiiStyle": "wiimote_nunchuk",
                "players": [_slot(controller, face=_WII_MULTIPLAYER_FACE) for _ in range(4)],
            },
            {
                "name": f"{prefix}Wii: Multiplayer Wiimote (Sideways)",
                "body": "",
                "system": "wii",
                "wiiStyle": "wiimote_sideways",
                "players": [_slot(controller, face=_WII_MULTIPLAYER_FACE) for _ in range(4)],
            },
        ])
    return cards


def _real_wiimote_mappings():
    prefix = f"[{_REAL_WIIMOTE_TAG}]"
    return [
        {
            "name": f"{prefix}{title}",
            "body": "",
            "system": "wii",
            "wiiStyle": "wiimote_sideways",
            "players": [_slot("realwiimote") for _ in range(count)],
        }
        for count, title in enumerate(_REAL_WIIMOTE_TITLES, start=1)
    ]


def _mixed_mappings():
    prefix = f"[{_MIXED_TAG}]"
    return [
        {
            "name": f"{prefix}GCN: Standard",
            "body": _MIXED_NOTE,
            "system": "gamecube",
            "players": [_slot(c, face=_aa_face(c)) for c in _MIXED_CONTROLLERS],
        },
        {
            "name": f"{prefix}Wii: Classic Controller - Standard (Nintendo)",
            "body": _MIXED_NOTE,
            "system": "wii",
            "wiiStyle": "classic",
            "players": [_slot(c, face=_WII_MULTIPLAYER_FACE) for c in _MIXED_CONTROLLERS],
        },
        {
            "name": f"{prefix}Wii: Wiimote & Nunchuk",
            "body": _MIXED_NOTE,
            "system": "wii",
            "wiiStyle": "wiimote_nunchuk",
            "players": [_slot(c, face=_WII_MULTIPLAYER_FACE) for c in _MIXED_CONTROLLERS],
        },
        {
            "name": f"{prefix}Wii: Wiimote (Sideways)",
            "body": _MIXED_NOTE,
            "system": "wii",
            "wiiStyle": "wiimote_sideways",
            "players": [_slot(c, face=_WII_MULTIPLAYER_FACE) for c in _MIXED_CONTROLLERS],
        },
    ]


def build_seed_mappings():
    mappings = []
    for tag, controller in _SINGLE_PLAYER_TAGS:
        mappings.extend(_single_player_mappings(tag, controller))
    mappings.extend(_real_wiimote_mappings())
    mappings.extend(_mixed_mappings())
    return mappings
