import json

KINDS = ("all", "tracked", "notes", "guides", "events", "milestones")

ALL_PARTS = ("tracked", "notes", "guides")
MODES = ("merge", "replace")

TAG_VOCAB_LIMIT = 20

MAX_TRACKED_IDS = 5000
MAX_NOTES = 5000
MAX_TAGS = 200
NOTE_ID_MAX = 64
MAX_EVENTS = 5000
MAX_GUIDES = 500
MAX_BOOKMARKS = 2000
_TEXT_MAX = 4000

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


_EVENT_ITEM = {"trackedAt": int, "note": str, "noteColor": str, "noteEditedAt": int}
_TICK_LEVELS = ("beaten", "mastered")


def events_payload(state: dict) -> dict:
    return {
        "tracked": {"order": list(state["tracked"]["order"]), "items": dict(state["tracked"]["items"])},
        "completed": dict(state["completed"]),
        "checklistTicks": {key: dict(value) for key, value in state["checklistTicks"].items()},
    }


def _short_text(value) -> bool:
    return isinstance(value, str) and len(value) <= _TEXT_MAX


def _count_value(value) -> bool:
    return type(value) is int and value >= 0


def _tick_value(value) -> bool:
    return isinstance(value, bool) or value in _TICK_LEVELS


def read_events(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("tracked"), dict):
        return None
    items = raw["tracked"].get("items")
    order = raw["tracked"].get("order")
    if not isinstance(items, dict) or len(items) > MAX_EVENTS or not isinstance(order, list):
        return None
    clean_items = {}
    for key, item in items.items():
        if not _id_key(key) or not isinstance(item, dict):
            return None
        for field, kind in _EVENT_ITEM.items():
            value = item.get(field)
            if kind is int and not _count_value(value):
                return None
            if kind is str and not _short_text(value):
                return None
        clean_items[key] = {field: item[field] for field in _EVENT_ITEM}
    if len(order) != len(set(order)) or any(key not in clean_items for key in order) or len(order) != len(clean_items):
        return None
    completed = raw.get("completed")
    ticks = raw.get("checklistTicks")
    if not isinstance(completed, dict) or len(completed) > MAX_EVENTS or not isinstance(ticks, dict) or len(ticks) > MAX_EVENTS:
        return None
    clean_completed = {}
    for key, mark in completed.items():
        if not _id_key(key) or not isinstance(mark, dict) or not _count_value(mark.get("at")):
            return None
        clean_completed[key] = {"at": mark["at"]}
    clean_ticks = {}
    for key, games in ticks.items():
        if not _id_key(key) or not isinstance(games, dict) or len(games) > MAX_EVENTS:
            return None
        for game, flag in games.items():
            if not _id_key(game) or not _tick_value(flag):
                return None
        clean_ticks[key] = dict(games)
    return {"tracked": {"order": list(order), "items": clean_items}, "completed": clean_completed,
            "checklistTicks": clean_ticks}


def merge_events(dest: dict, incoming: dict):
    order = list(dest["tracked"]["order"])
    items = {key: dict(item) for key, item in dest["tracked"]["items"].items()}
    completed = {key: dict(mark) for key, mark in dest["completed"].items()}
    ticks = {key: dict(games) for key, games in dest["checklistTicks"].items()}
    added = 0
    existing = 0
    updated = 0
    for key in incoming["tracked"]["order"]:
        theirs = incoming["tracked"]["items"][key]
        if key not in items:
            items[key] = dict(theirs)
            order.append(key)
            added += 1
            changed = None
        else:
            mine = items[key]
            changed = (mine["note"], mine["noteColor"]) != (theirs["note"], theirs["noteColor"])
            if changed:
                items[key] = dict(theirs)
        mark = incoming["completed"].get(key)
        if completed.get(key) != mark:
            if mark is None:
                completed.pop(key, None)
            else:
                completed[key] = dict(mark)
            changed = changed if changed is None else True
        for game, flag in incoming["checklistTicks"].get(key, {}).items():
            if ticks.get(key, {}).get(game) != flag:
                ticks.setdefault(key, {})[game] = flag
                changed = changed if changed is None else True
        if changed is True:
            updated += 1
        elif changed is False:
            existing += 1
    for key, mark in incoming["completed"].items():
        if key not in incoming["tracked"]["items"] and key not in completed:
            completed[key] = dict(mark)
    for key, games in incoming["checklistTicks"].items():
        if key in incoming["tracked"]["items"]:
            continue
        for game, flag in games.items():
            ticks.setdefault(key, {}).setdefault(game, flag)
    return {"order": order, "items": items, "completed": completed, "checklistTicks": ticks}, added, existing, updated


def replace_events(incoming: dict) -> dict:
    return {
        "order": list(incoming["tracked"]["order"]),
        "items": {key: dict(item) for key, item in incoming["tracked"]["items"].items()},
        "completed": {key: dict(mark) for key, mark in incoming["completed"].items()},
        "checklistTicks": {key: dict(games) for key, games in incoming["checklistTicks"].items()},
    }


GUIDE_META = ("title", "author", "type", "version", "gameUrl", "kind", "pageCount")
_BOOKMARK_FIELDS = ("name", "page", "anchor", "scroll")


def guides_payload(game_id: int, record: dict) -> dict:
    guides = {}
    for faq_id, guide in record["guides"].items():
        entry = {field: guide[field] for field in GUIDE_META}
        entry["bookmarks"] = [dict(bookmark) for bookmark in guide["bookmarks"]]
        guides[faq_id] = entry
    return {"gameId": game_id, "gamefaqs": record["gamefaqs"], "guides": guides}


def _scroll_value(value) -> bool:
    return type(value) in (int, float) and value == value and 0 <= value <= 1


def read_guides(raw, game_id: int):
    if not isinstance(raw, dict) or not _is_id(raw.get("gameId")) or raw["gameId"] != game_id:
        return None
    mapping = raw.get("gamefaqs")
    if mapping is not None and not (isinstance(mapping, dict) and all(_short_text(v) for v in mapping.values())):
        return None
    guides = raw.get("guides")
    if not isinstance(guides, dict) or len(guides) > MAX_GUIDES:
        return None
    clean = {}
    bookmarks_seen = 0
    for faq_id, guide in guides.items():
        if not _id_key(faq_id) or not isinstance(guide, dict):
            return None
        entry = {}
        for field in GUIDE_META:
            value = guide.get(field)
            if field == "pageCount":
                if not _count_value(value):
                    return None
            elif not _short_text(value):
                return None
            entry[field] = value
        bookmarks = guide.get("bookmarks")
        if not isinstance(bookmarks, list):
            return None
        bookmarks_seen += len(bookmarks)
        if bookmarks_seen > MAX_BOOKMARKS:
            return None
        ids = set()
        for bookmark in bookmarks:
            if not isinstance(bookmark, dict):
                return None
            bookmark_id = bookmark.get("id")
            if (not isinstance(bookmark_id, str) or not 0 < len(bookmark_id) <= NOTE_ID_MAX or bookmark_id in ids
                    or not _short_text(bookmark.get("name")) or not _count_value(bookmark.get("page"))
                    or not _short_text(bookmark.get("anchor")) or not _scroll_value(bookmark.get("scroll"))
                    or not _count_value(bookmark.get("createdAt"))):
                return None
            ids.add(bookmark_id)
        entry["bookmarks"] = [dict(bookmark) for bookmark in bookmarks]
        clean[faq_id] = entry
    return {"gameId": game_id, "gamefaqs": mapping, "guides": clean}


def _bookmark_order(bookmark):
    return (bookmark["page"], bookmark["scroll"])


def merge_guides(dest: dict, incoming: dict, blank: dict):
    mapping = dest["gamefaqs"]
    if incoming["gamefaqs"] is not None and incoming["gamefaqs"] != mapping:
        mapping = incoming["gamefaqs"]
    guides = {faq_id: dict(guide, bookmarks=[dict(b) for b in guide["bookmarks"]])
              for faq_id, guide in dest["guides"].items()}
    added = 0
    existing = 0
    updated = 0
    for faq_id, theirs in incoming["guides"].items():
        guide = guides.get(faq_id) or dict(blank, bookmarks=[])
        for field in GUIDE_META:
            guide[field] = theirs[field]
        mine = {bookmark["id"]: bookmark for bookmark in guide["bookmarks"]}
        for bookmark in theirs["bookmarks"]:
            current = mine.get(bookmark["id"])
            if current is None:
                guide["bookmarks"].append(dict(bookmark))
                added += 1
            elif any(current.get(field) != bookmark.get(field) for field in _BOOKMARK_FIELDS):
                current.update({field: bookmark[field] for field in _BOOKMARK_FIELDS})
                updated += 1
            else:
                existing += 1
        guide["bookmarks"].sort(key=_bookmark_order)
        guides[faq_id] = guide
    return {"gamefaqs": mapping, "guides": guides}, added, existing, updated


def replace_guides(dest: dict, incoming: dict, blank: dict) -> dict:
    mapping = incoming["gamefaqs"] if incoming["gamefaqs"] is not None else dest["gamefaqs"]
    guides = {faq_id: dict(guide, bookmarks=[]) for faq_id, guide in dest["guides"].items()}
    for faq_id, theirs in incoming["guides"].items():
        guide = guides.get(faq_id) or dict(blank, bookmarks=[])
        for field in GUIDE_META:
            guide[field] = theirs[field]
        guide["bookmarks"] = sorted((dict(b) for b in theirs["bookmarks"]), key=_bookmark_order)
        guides[faq_id] = guide
    return {"gamefaqs": mapping, "guides": guides}


def all_payload(game_id: int, parts: dict) -> dict:
    return {"gameId": game_id, **{kind: parts.get(kind) for kind in ALL_PARTS}}


def read_all(raw, game_id: int, notes_schema: int):
    bad = (None, "payload_mismatch")
    if not isinstance(raw, dict) or raw.get("gameId") != game_id:
        return bad
    out = {}
    for kind in ALL_PARTS:
        section = raw.get(kind)
        if section is None:
            out[kind] = None
            continue
        if kind == "tracked":
            out[kind] = read_tracked(section, game_id)
        elif kind == "guides":
            out[kind] = read_guides(section, game_id)
        else:
            notes, error = read_notes(section, game_id, notes_schema)
            if notes is None:
                return None, error
            out[kind] = notes
        if out[kind] is None:
            return bad
    if all(section is None for section in out.values()):
        return bad
    return out, ""
