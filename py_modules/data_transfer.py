import json

KINDS = ("tracked", "notes", "milestones")
MODES = ("merge", "replace")

TAG_VOCAB_LIMIT = 20

MAX_TRACKED_IDS = 5000
MAX_NOTES = 5000
MAX_TAGS = 200
NOTE_ID_MAX = 64

_TRACKED_MAPS = ("notes", "notesColor", "notesLastEditedAt")


def encode(payload) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def decode(raw: bytes):
    try:
        value = json.loads(bytes(raw).decode("utf-8"), parse_constant=_refuse_constant)
    except (ValueError, RecursionError):
        return None
    return value if isinstance(value, dict) else None


def _refuse_constant(_name):
    raise ValueError("not a number")


def _is_id(value) -> bool:
    return type(value) is int and 0 < value < 2 ** 31


def _id_key(value) -> bool:
    if not isinstance(value, str) or not 0 < len(value) <= 10 or not (value.isascii() and value.isdigit()):
        return False
    return value == str(int(value)) and _is_id(int(value))


def _text_list(value, limit):
    if not isinstance(value, list) or len(value) > limit:
        return None
    if not all(isinstance(item, str) for item in value):
        return None
    return list(value)


def tracked_payload(game_id: int, tracked: dict) -> dict:
    return {
        "gameId": game_id,
        "achievementIds": list(tracked.get("achievementIds") or []),
        "notes": dict(tracked.get("notes") or {}),
        "notesColor": dict(tracked.get("notesColor") or {}),
        "notesLastEditedAt": dict(tracked.get("notesLastEditedAt") or {}),
        "tagVocabulary": list(tracked.get("tagVocabulary") or []),
    }


def read_tracked(raw, game_id: int):
    if not isinstance(raw, dict) or not _is_id(raw.get("gameId")) or raw["gameId"] != game_id:
        return None
    ids = raw.get("achievementIds")
    if not isinstance(ids, list) or len(ids) > MAX_TRACKED_IDS or not all(_is_id(value) for value in ids):
        return None
    out = {"gameId": game_id, "achievementIds": list(dict.fromkeys(ids))}
    for name in _TRACKED_MAPS:
        entries = raw.get(name)
        if not isinstance(entries, dict) or len(entries) > MAX_TRACKED_IDS:
            return None
        for key, value in entries.items():
            if not _id_key(key):
                return None
            if name == "notesLastEditedAt":
                if type(value) is not int or value < 0:
                    return None
            elif not isinstance(value, str):
                return None
        out[name] = dict(entries)
    vocab = _text_list(raw.get("tagVocabulary"), MAX_TAGS)
    if vocab is None:
        return None
    out["tagVocabulary"] = vocab
    return out


def filter_tracked(incoming: dict, earned, known):
    kept = []
    unlocked = 0
    for achievement_id in incoming["achievementIds"]:
        if achievement_id not in known:
            continue
        if achievement_id in earned:
            unlocked += 1
            continue
        kept.append(achievement_id)
    keys = {str(achievement_id) for achievement_id in kept}
    out = dict(incoming, achievementIds=kept)
    for name in _TRACKED_MAPS:
        out[name] = {key: value for key, value in incoming[name].items() if key in keys}
    return out, unlocked


def merge_vocab(dest, source):
    out = list(dest)
    seen = {tag.lower() for tag in out}
    for tag in source:
        if tag.lower() not in seen:
            seen.add(tag.lower())
            out.append(tag)
    return out[:TAG_VOCAB_LIMIT]


def merge_tracked(dest: dict, incoming: dict):
    ids = list(dest["achievementIds"])
    have = set(ids)
    out = {name: dict(dest[name]) for name in _TRACKED_MAPS}
    added = 0
    existing = 0
    updated = 0
    for achievement_id in incoming["achievementIds"]:
        key = str(achievement_id)
        if achievement_id in have:
            mine = (out["notes"].get(key), out["notesColor"].get(key))
            theirs = (incoming["notes"].get(key), incoming["notesColor"].get(key))
            if mine == theirs:
                existing += 1
                continue
            for name in _TRACKED_MAPS:
                if key in incoming[name]:
                    out[name][key] = incoming[name][key]
                else:
                    out[name].pop(key, None)
            updated += 1
            continue
        have.add(achievement_id)
        ids.append(achievement_id)
        added += 1
        for name in _TRACKED_MAPS:
            if key in incoming[name]:
                out[name][key] = incoming[name][key]
    out["achievementIds"] = ids
    out["tagVocabulary"] = merge_vocab(dest["tagVocabulary"], incoming["tagVocabulary"])
    return out, added, existing, updated


def replace_tracked(incoming: dict) -> dict:
    return {
        "achievementIds": list(incoming["achievementIds"]),
        **{name: dict(incoming[name]) for name in _TRACKED_MAPS},
        "tagVocabulary": list(incoming["tagVocabulary"])[:TAG_VOCAB_LIMIT],
    }


def notes_payload(game_id: int, entry: dict) -> dict:
    return {
        "gameId": game_id,
        "schemaVersion": entry["schemaVersion"],
        "notes": list(entry["notes"]),
        "tagVocabulary": list(entry["tagVocabulary"]),
    }


def read_notes(raw, game_id: int, schema: int):
    bad = (None, "payload_mismatch")
    if not isinstance(raw, dict) or not _is_id(raw.get("gameId")) or raw["gameId"] != game_id:
        return bad
    version = raw.get("schemaVersion")
    if type(version) is not int or version < 1:
        return bad
    if version > schema:
        return None, "newer_schema"
    notes = raw.get("notes")
    if not isinstance(notes, list) or len(notes) > MAX_NOTES:
        return bad
    seen = set()
    for note in notes:
        if not isinstance(note, dict):
            return bad
        note_id = note.get("id")
        if not isinstance(note_id, str) or not 0 < len(note_id) <= NOTE_ID_MAX or note_id in seen:
            return bad
        seen.add(note_id)
    vocab = _text_list(raw.get("tagVocabulary"), MAX_TAGS)
    if vocab is None:
        return bad
    return {"gameId": game_id, "schemaVersion": version, "notes": list(notes), "tagVocabulary": vocab}, ""


def imported_note(note: dict, now: int, skew: int) -> dict:
    out = dict(note, showFiredDot=False)
    fired = out.get("reminderLastFiredAt")
    if type(fired) is int and fired > now + skew:
        out["reminderLastFiredAt"] = now
    return out


def _repacked(notes):
    out = []
    for index, note in enumerate(notes):
        out.append(dict(note, manualOrder=index))
    return out


_NOTE_FIELDS = ("title", "body", "tag", "color", "completedAt",
                "reminderMode", "reminderEveryMinutes", "reminderEveryValue", "reminderEveryUnit")
_REMINDER_FIELDS = ("reminderMode", "reminderEveryMinutes", "reminderEveryValue", "reminderEveryUnit")


def _note_differs(mine, theirs) -> bool:
    return any(mine.get(field) != theirs.get(field) for field in _NOTE_FIELDS)


def merge_notes(dest_notes, incoming):
    theirs = {note["id"]: note for note in incoming}
    kept = []
    updated = 0
    for note in sorted(dest_notes, key=lambda note: note["manualOrder"]):
        other = theirs.get(note["id"])
        if other is None or not _note_differs(note, other):
            kept.append(note)
            continue
        merged = dict(other, manualOrder=note["manualOrder"], showFiredDot=note.get("showFiredDot", False))
        if all(note.get(field) == other.get(field) for field in _REMINDER_FIELDS):
            merged["reminderLastFiredAt"] = note.get("reminderLastFiredAt")
        kept.append(merged)
        updated += 1
    have = {note["id"] for note in dest_notes}
    added = [note for note in incoming if note["id"] not in have]
    existing = len(incoming) - len(added) - updated
    return _repacked(kept + added), len(added), existing, updated


def replace_notes(incoming):
    return _repacked(incoming)


def milestones_payload(milestones: dict, sealed) -> dict:
    return {"milestones": milestones, "sealed": sealed}


def read_milestones(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("milestones"), dict):
        return None
    sealed = raw.get("sealed")
    if sealed is not None and not isinstance(sealed, dict):
        return None
    return {"milestones": raw["milestones"], "sealed": sealed}
