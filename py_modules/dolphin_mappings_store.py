from pathlib import Path

import re
import threading
import time
import uuid

from utils import ensure_dir, load_json_file, save_json_file, to_int


MAPPING_NAME_MAX_LEN = 100
MAPPING_BODY_MAX_LEN = 2000

MAX_MAPPINGS = 500

ALLOWED_SYSTEMS = ("gamecube", "wii")
ALLOWED_WII_STYLES = ("wiimote_sideways", "wiimote_nunchuk", "classic")
ALLOWED_CONTROLLER_TYPES = ("steamdeck", "rogally", "steamcontroller", "xbox", "xboxone", "dualsense", "ps4", "switchpro", "realwiimote")
ALLOWED_FACE_LAYOUTS = ("standard", "literal", "swap_ab", "swap_xy")

ALLOWED_RUMBLE_MOTORS = ("both", "left", "right")

ALLOWED_SIDEWAYS_DIRECTIONS = ("both", "dpad", "stick")

RUMBLE_STRENGTH_MIN = 0
RUMBLE_STRENGTH_MAX = 100
RUMBLE_STRENGTH_DEFAULT = 100

DEADZONE_MIN = 0
DEADZONE_MAX = 50
DEADZONE_DEFAULT = 0

IR_YAW_MIN = 0
IR_YAW_MAX = 90
IR_YAW_DEFAULT = 25
IR_PITCH_MIN = 0
IR_PITCH_MAX = 90
IR_PITCH_DEFAULT = 20
IR_OFFSET_MIN = 0
IR_OFFSET_MAX = 30
IR_OFFSET_DEFAULT = 10
IR_DEADZONE_DEFAULT = 10
IR_AUTO_HIDE_DEFAULT = False
IR_RELATIVE_INPUT_DEFAULT = True

MAX_PLAYERS = 4

UNTAGGED_COLLAPSE_KEY = "__UNTAGGED__"
COLLAPSE_KEY_MAX_LEN = 64
MAX_COLLAPSED_KEYS = 400

_TAG_PREFIX_PATTERN = re.compile(r"^\s*\[([^\]\n]{1,24})\]\s*")
_RESERVED_TAG_KEYS = frozenset({"completed"})

CURRENT_SCHEMA_VERSION = 1


def _collapse_key(name) -> str:
    if not isinstance(name, str):
        return UNTAGGED_COLLAPSE_KEY
    match = _TAG_PREFIX_PATTERN.match(name)
    if not match:
        return UNTAGGED_COLLAPSE_KEY
    key = match.group(1).strip().lower()
    if not key or key in _RESERVED_TAG_KEYS:
        return UNTAGGED_COLLAPSE_KEY
    return key


def _live_collapse_keys(mappings) -> set:
    return {_collapse_key(mapping.get("name")) for mapping in mappings}


class DolphinMappingsStore:
    """User-defined Dolphin controller mappings for the Dolphin Mapper utility.

    One JSON file (dolphin_mappings.json) holding every mapping in list order,
    which is also the on-screen order. Unlike the per-account stores this one is
    global: mappings are hardware setups, not RA content, so every plugin
    account shares the same file. That's why main.py builds it once and leaves
    it out of _apply_user_scope -- it never repoints.
    """

    def __init__(self, *, base_dir: Path):
        self._base_dir = base_dir
        self._lock = threading.Lock()
        ensure_dir(self._base_dir)

    def _path(self) -> Path:
        return self._base_dir / "dolphin_mappings.json"

    def _load_raw(self) -> dict:
        raw = load_json_file(self._path(), {})
        if not isinstance(raw, dict):
            return self._empty_file()

        schema = to_int(raw.get("schemaVersion", 0), 0)
        if schema != CURRENT_SCHEMA_VERSION:
            return self._empty_file()

        return self._normalize_file(raw)

    def _save_raw(self, data: dict) -> None:
        data["collapsedTags"] = self._sanitize_collapsed(
            data.get("collapsedTags") or [],
            _live_collapse_keys(data["mappings"]),
        )
        save_json_file(self._path(), data, compact=True)

    def _empty_file(self) -> dict:
        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "mappings": [],
            "collapsedTags": [],
        }

    def _normalize_file(self, raw: dict) -> dict:
        raw_mappings = raw.get("mappings")
        if not isinstance(raw_mappings, list):
            raw_mappings = []

        mappings = []
        for entry in raw_mappings[:MAX_MAPPINGS]:
            cleaned = self._clean_mapping(entry)
            if cleaned is not None:
                mappings.append(cleaned)

        raw_collapsed = raw.get("collapsedTags")
        if not isinstance(raw_collapsed, list):
            raw_collapsed = []
        collapsed = self._sanitize_collapsed(raw_collapsed, _live_collapse_keys(mappings))

        return {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "mappings": mappings,
            "collapsedTags": collapsed,
        }

    def _sanitize_collapsed(self, raw, live_keys: set) -> list:
        out = []
        seen = set()
        for entry in raw:
            if not isinstance(entry, str):
                continue
            key = entry.strip()
            if not key or len(key) > COLLAPSE_KEY_MAX_LEN or key in seen:
                continue
            if key not in live_keys:
                continue
            seen.add(key)
            out.append(key)
            if len(out) >= MAX_COLLAPSED_KEYS:
                break
        return out

    def _new_mapping_id(self) -> str:
        return f"dmap_{uuid.uuid4().hex}"

    def _clean_name(self, value) -> str:
        if not isinstance(value, str):
            return ""
        return value.strip()[:MAPPING_NAME_MAX_LEN]

    def _clean_body(self, value) -> str:
        if not isinstance(value, str):
            return ""
        return value.strip()[:MAPPING_BODY_MAX_LEN]

    def _clean_player(self, raw, system) -> dict:
        if not isinstance(raw, dict):
            raw = {}

        controller_type = raw.get("controllerType")
        if controller_type not in ALLOWED_CONTROLLER_TYPES:
            controller_type = "steamdeck"
        if controller_type == "realwiimote" and system != "wii":
            controller_type = "steamdeck"

        face_layout = raw.get("faceLayout")
        if face_layout not in ALLOWED_FACE_LAYOUTS:
            face_layout = "standard"

        rumble_motor = raw.get("rumbleMotor")
        if rumble_motor not in ALLOWED_RUMBLE_MOTORS:
            rumble_motor = "both"

        sideways_directions = raw.get("sidewaysDirections")
        if sideways_directions not in ALLOWED_SIDEWAYS_DIRECTIONS:
            sideways_directions = "both"

        rumble_strength = to_int(raw.get("rumbleStrength"), RUMBLE_STRENGTH_DEFAULT)
        rumble_strength = max(RUMBLE_STRENGTH_MIN, min(RUMBLE_STRENGTH_MAX, rumble_strength))

        left_deadzone = to_int(raw.get("leftStickDeadzone"), DEADZONE_DEFAULT)
        left_deadzone = max(DEADZONE_MIN, min(DEADZONE_MAX, left_deadzone))
        right_deadzone = to_int(raw.get("rightStickDeadzone"), DEADZONE_DEFAULT)
        right_deadzone = max(DEADZONE_MIN, min(DEADZONE_MAX, right_deadzone))

        ir_deadzone = to_int(raw.get("irDeadzone"), IR_DEADZONE_DEFAULT)
        ir_deadzone = max(DEADZONE_MIN, min(DEADZONE_MAX, ir_deadzone))
        ir_yaw = to_int(raw.get("irTotalYaw"), IR_YAW_DEFAULT)
        ir_yaw = max(IR_YAW_MIN, min(IR_YAW_MAX, ir_yaw))
        ir_pitch = to_int(raw.get("irTotalPitch"), IR_PITCH_DEFAULT)
        ir_pitch = max(IR_PITCH_MIN, min(IR_PITCH_MAX, ir_pitch))
        ir_offset = to_int(raw.get("irVerticalOffset"), IR_OFFSET_DEFAULT)
        ir_offset = max(IR_OFFSET_MIN, min(IR_OFFSET_MAX, ir_offset))

        return {
            "controllerType": controller_type,
            "wireless": bool(raw.get("wireless", True)),
            "invertCamX": bool(raw.get("invertCamX", False)),
            "invertCamY": bool(raw.get("invertCamY", False)),
            "faceLayout": face_layout,
            "triggerSwap": bool(raw.get("triggerSwap", False)),
            "rumbleStrength": rumble_strength,
            "rumbleMotor": rumble_motor,
            "leftStickDeadzone": left_deadzone,
            "rightStickDeadzone": right_deadzone,
            "sidewaysDirections": sideways_directions,
            "irDeadzone": ir_deadzone,
            "irTotalYaw": ir_yaw,
            "irTotalPitch": ir_pitch,
            "irVerticalOffset": ir_offset,
            "irRelativeInput": bool(raw.get("irRelativeInput", IR_RELATIVE_INPUT_DEFAULT)),
            "irAutoHide": bool(raw.get("irAutoHide", IR_AUTO_HIDE_DEFAULT)),
        }

    def _clean_mapping(self, raw) -> dict:
        if not isinstance(raw, dict):
            return None

        system = raw.get("system")
        if system not in ALLOWED_SYSTEMS:
            system = "gamecube"

        wii_style = None
        if system == "wii":
            wii_style = raw.get("wiiStyle")
            if wii_style not in ALLOWED_WII_STYLES:
                wii_style = "wiimote_sideways"

        raw_players = raw.get("players")
        if not isinstance(raw_players, list):
            raw_players = []
        players = [self._clean_player(p, system) for p in raw_players[:MAX_PLAYERS]]
        if not players:
            players = [self._clean_player({}, system)]

        mapping_id = raw.get("id")
        if not isinstance(mapping_id, str) or not mapping_id:
            mapping_id = self._new_mapping_id()

        now = int(time.time())
        created_at = to_int(raw.get("createdAt", now), now)
        updated_at = to_int(raw.get("updatedAt", now), now)

        cleaned = {
            "id": mapping_id,
            "name": self._clean_name(raw.get("name")),
            "body": self._clean_body(raw.get("body")),
            "system": system,
            "players": players,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }
        if wii_style is not None:
            cleaned["wiiStyle"] = wii_style
        return cleaned

    def _find(self, data: dict, mapping_id: str):
        for item in data["mappings"]:
            if item["id"] == mapping_id:
                return item
        return None

    def load_all(self) -> dict:
        with self._lock:
            data = self._load_raw()
        return data

    def upsert(self, mapping) -> dict:
        cleaned = self._clean_mapping(mapping)
        if cleaned is None:
            return {"ok": False, "error": "invalid_mapping"}

        with self._lock:
            data = self._load_raw()
            now = int(time.time())

            existing = self._find(data, cleaned["id"])
            if existing is not None:
                cleaned["createdAt"] = existing.get("createdAt", cleaned["createdAt"])
                cleaned["updatedAt"] = now
                for index, item in enumerate(data["mappings"]):
                    if item["id"] == cleaned["id"]:
                        data["mappings"][index] = cleaned
                        break
                old_key = _collapse_key(existing.get("name"))
                new_key = _collapse_key(cleaned["name"])
                if old_key != new_key and old_key in data["collapsedTags"]:
                    if new_key not in data["collapsedTags"]:
                        data["collapsedTags"].append(new_key)
            else:
                if len(data["mappings"]) >= MAX_MAPPINGS:
                    return {"ok": False, "error": "too_many_mappings"}
                cleaned["createdAt"] = now
                cleaned["updatedAt"] = now
                data["mappings"].append(cleaned)

            self._save_raw(data)

        return {"ok": True, "mapping": cleaned}

    def delete(self, mapping_id: str) -> dict:
        if not isinstance(mapping_id, str) or not mapping_id:
            return {"ok": False, "error": "invalid_mapping_id"}

        with self._lock:
            data = self._load_raw()
            before = len(data["mappings"])
            data["mappings"] = [m for m in data["mappings"] if m["id"] != mapping_id]
            if len(data["mappings"]) == before:
                return {"ok": False, "error": "not_found"}
            self._save_raw(data)

        return {"ok": True}

    def set_collapsed_tags(self, tags) -> dict:
        if not isinstance(tags, list):
            tags = []

        with self._lock:
            data = self._load_raw()
            data["collapsedTags"] = self._sanitize_collapsed(tags, _live_collapse_keys(data["mappings"]))
            self._save_raw(data)

        return {"ok": True, "collapsedTags": data["collapsedTags"]}

    def reorder(self, ordered_ids) -> dict:
        if not isinstance(ordered_ids, list):
            return {"ok": False, "error": "invalid_order"}

        with self._lock:
            data = self._load_raw()
            by_id = {m["id"]: m for m in data["mappings"]}

            new_order = []
            seen = set()
            for raw_id in ordered_ids:
                if not isinstance(raw_id, str) or raw_id in seen:
                    continue
                item = by_id.get(raw_id)
                if item is None:
                    continue
                seen.add(raw_id)
                new_order.append(item)

            leftovers = [m for m in data["mappings"] if m["id"] not in seen]
            new_order.extend(leftovers)

            data["mappings"] = new_order
            self._save_raw(data)

        return {"ok": True, "mappings": data["mappings"]}

    def seed(self, mappings) -> dict:
        """One-shot starter seed: write the given mappings, but only onto an
        empty store. If the user already has any mappings (a returning user, or
        one mid-way through building their own), we leave the file untouched and
        report that nothing was seeded -- the caller still flags seeding done so
        we never reconsider. Mappings go through the same _clean_mapping the
        modal's saves do, so a bad seed entry can't corrupt the file.
        """
        with self._lock:
            data = self._load_raw()
            if data["mappings"]:
                return {"ok": True, "seeded": False, "count": len(data["mappings"])}

            cleaned = []
            for entry in list(mappings)[:MAX_MAPPINGS]:
                item = self._clean_mapping(entry)
                if item is not None:
                    cleaned.append(item)

            data["mappings"] = cleaned
            data["collapsedTags"] = sorted(_live_collapse_keys(cleaned))
            self._save_raw(data)

        return {"ok": True, "seeded": True, "count": len(cleaned)}

    def clear_all(self) -> dict:
        with self._lock:
            try:
                self._path().unlink()
            except FileNotFoundError:
                pass
        return {"ok": True}
