import os
from pathlib import Path

import decky
import multiplayer_session as session
from services.emulator_login_sync_service import (
    _append_preserving_newline,
    _assert_only_allowed_lines_changed,
    _atomic_write_text,
    _flat_key_of,
)
from services.emulator_service import running

COMBO_KEY = "input_quit_gamepad_combo"
CONFIRM_KEY = "quit_press_twice"
START_SELECT = "4"

COMBOS = {
    "1": (["dpadDown", "y", "l1", "r1"], False),
    "2": (["l3", "r3"], False),
    "3": (["l1", "r1", "menu", "view"], False),
    "4": (["menu", "view"], False),
    "5": (["l3", "r1"], False),
    "6": (["l1", "r1"], False),
    "7": (["menu"], True),
    "8": (["view"], True),
    "9": (["dpadDown", "view"], False),
    "10": (["l2", "r2"], False),
}

SDL_BUTTONS = {
    "0": "a", "1": "b", "2": "x", "3": "y", "4": "view", "6": "menu", "7": "l3", "8": "r3",
    "9": "l1", "10": "r1", "11": "dpadUp", "12": "dpadDown", "13": "dpadLeft", "14": "dpadRight",
    "h0up": "dpadUp", "h0down": "dpadDown", "h0left": "dpadLeft", "h0right": "dpadRight",
}
SDL_AXES = {"+4": "l2", "+5": "r2"}


def _combo_on(value: str) -> bool:
    return bool(value) and value != "0"


def _bind(values: dict, name: str):
    button = values.get(f"{name}_btn") or "nul"
    axis = values.get(f"{name}_axis") or "nul"
    if button != "nul":
        return SDL_BUTTONS.get(button)
    if axis != "nul":
        return SDL_AXES.get(axis)
    return ""


def _binds_note(values: dict):
    if values.get("input_joypad_driver") != "sdl2":
        return None
    exit_button = _bind(values, "input_exit_emulator")
    enable = _bind(values, "input_enable_hotkey")
    if not exit_button or enable is None:
        return None
    return {"kind": "binds", "buttons": [enable, exit_button] if enable else [exit_button]}


def _status(values: dict, record: dict) -> dict:
    current = values.get(COMBO_KEY) or "0"
    on = _combo_on(current)
    if on:
        shown = current
    elif _combo_on(record["comboLast"]):
        shown = record["comboLast"]
    else:
        shown = START_SELECT
    known = COMBOS.get(shown)
    combo = {"buttons": known[0], "hold": known[1]} if known else None

    others = []
    binds = _binds_note(values)
    if binds and not (on and combo and set(binds["buttons"]) == set(combo["buttons"])):
        others.append(binds)
    key = values.get("input_exit_emulator") or "escape"
    if key not in ("nul", "escape"):
        others.append({"kind": "keyboard", "key": key})

    return {"found": True, "on": on, "combo": combo, "others": others}


def status(home, record: dict) -> dict:
    path = session.retroarch(home).cfg_path
    if path is None:
        return {"found": False, "on": False, "combo": None, "others": []}
    return _status(session.cfg_first_values(path), record)


def _set_every(text: str, key: str, value: str) -> str:
    lines = text.split("\n")
    line = f'{key} = "{value}"'
    found = False
    for index, old in enumerate(lines):
        if _flat_key_of(old) == key:
            lines[index] = line
            found = True
    if not found:
        _append_preserving_newline(lines, line)
    return "\n".join(lines)


def _write(path: Path, text: str, home) -> None:
    owner = None
    try:
        if os.geteuid() == 0:
            st = Path(home).stat()
            owner = (st.st_uid, st.st_gid)
    except OSError:
        pass
    _atomic_write_text(path, text, owner=owner)


def set_quit_hotkey(home, on: bool, record: dict):
    path = session.retroarch(home).cfg_path
    if path is None:
        return {"ok": False, "error": "no_config"}, record
    if running("retroarch"):
        return {"ok": False, "error": "running"}, record
    try:
        before = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return {"ok": False, "error": "unreadable"}, record

    values = session.cfg_first_values(path)
    current = values.get(COMBO_KEY) or "0"
    if on == _combo_on(current):
        return {"ok": True, **_status(values, record)}, record

    record = dict(record)
    if on:
        combo = record["comboLast"] if _combo_on(record["comboLast"]) else START_SELECT
        if not record["confirmSet"]:
            record["confirmBefore"] = values.get(CONFIRM_KEY, "")
            record["confirmSet"] = True
        changes = {COMBO_KEY: combo, CONFIRM_KEY: "true"}
        told = f'retroarch: quit combo on ("{combo}", confirm on; confirm was "{record["confirmBefore"]}")'
    else:
        record["comboLast"] = current
        changes = {COMBO_KEY: "0"}
        if record["confirmSet"]:
            changes[CONFIRM_KEY] = record["confirmBefore"] or "false"
            record["confirmSet"] = False
            record["confirmBefore"] = ""
            told = f'retroarch: quit combo off (was "{current}", confirm put back to "{changes[CONFIRM_KEY]}")'
        else:
            told = f'retroarch: quit combo off (was "{current}", confirm left as is)'

    after = before
    for key, value in changes.items():
        after = _set_every(after, key, value)
    _assert_only_allowed_lines_changed(before, after, lambda line: _flat_key_of(line) in changes or line.strip() == "")
    _write(path, after, home)
    decky.logger.info(told)
    return {"ok": True, **_status(session.cfg_first_values(path), record)}, record
