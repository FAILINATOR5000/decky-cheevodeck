import re

import decky

from utils import load_json_file, to_int


CATEGORY_ICONS = ("flag", "dpad", "padlock", "pushpin", "people", "megaphone", "camera", "compass", "globe", "flame", "egg")

COUNTER_KINDS = frozenset((
    "profile_from_avatar", "quick_menu_open", "notifications_open", "game_loaded",
    "search_game_info", "game_info_chevron", "achievement_info", "track", "options_open",
    "page_help", "back_b", "home", "shortcut_pageUp", "shortcut_notifications",
    "shortcut_search", "menu_combo", "tracked_tag", "tracked_note", "tracked_reorder",
    "tracked_unlocked", "note_created", "note_reminder", "note_completed", "goal_with_game",
    "goal_completed", "profile_open", "friend_favorite", "compare", "ranking_open", "pny_mode",
    "feed_game", "subscribe", "comment_saved", "post", "news_open", "event_tracked", "set_feed",
    "leaderboard_open", "memory_screenshot", "memory_clip", "memory_moment", "memory_moment_multi", "memory_moment_triple", "timeline",
    "memory_edited", "memory_shared", "guide_open", "guide_bookmark", "guide_search",
    "guide_large", "browser_open", "cheevo_check_done", "night_on", "dnd_on", "standby_on",
    "unlock_history", "awards_open", "activity_open", "global_browser", "global_memories",
    "global_last_memory", "global_last_guide", "bootcat_preview", "check_updates",
    "bootcat_line_1", "bootcat_line_2", "bootcat_line_3",
))

MAIN_TABS = frozenset(("comments", "activity", "compare"))

STATE_KEYS = frozenset((
    "global_buttons_on", "memories_on", "quick_menu_customized", "binding_changed", "has_friend",
    "developer_options_on",
))

AWARD_KINDS = frozenset(("beaten", "mastered"))

_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")

QUEST_NEEDS = frozenset(("tracked_nonempty", "goal_exists", "memories_on"))

RANK_TIERS = ("tracker", "hunter", "expert", "master", "legend")

GLYPH_BUTTONS = frozenset((
    "a", "b", "x", "y", "l1", "r1", "l2", "r2", "dpad", "dpadUp", "dpadDown", "dpadLeft",
    "dpadRight", "menu", "view", "l3", "r3", "l4", "l5", "r4", "r5",
))

BINDING_ACTIONS = frozenset((
    "notifications", "pageUp", "home", "currentGuide", "search", "memories", "lastMemory", "browser",
))

_MILESTONE_RULES = frozenset((
    "counter", "tabs", "state", "unlocks", "award", "combo", "active_days", "daily_done",
    "weekly_done", "finish_category", "completionist", "unlock_hour", "weekend", "all_kinds",
    "games_one_day",
))

_QUEST_RULES = frozenset((
    "unlocks", "points", "games", "goal_unlocks", "action", "award", "active_days", "daily_done",
))


def _clean_buttons(raw):
    if raw is None:
        return None
    if not isinstance(raw, list) or not raw:
        raise ValueError("buttons")
    out = []
    for entry in raw:
        group = entry if isinstance(entry, list) else [entry]
        if not group or any(button not in GLYPH_BUTTONS for button in group):
            raise ValueError("buttons")
        out.append(list(group))
    return out


def _counter_kinds(rule):
    kinds = rule.get("kinds")
    if kinds is None and "kind" in rule:
        kinds = [rule.get("kind")]
    if not isinstance(kinds, list) or not kinds or any(kind not in COUNTER_KINDS for kind in kinds):
        raise ValueError("kind")
    return list(kinds)


def _clean_milestone_rule(rule, category_ids):
    if not isinstance(rule, dict) or rule.get("type") not in _MILESTONE_RULES:
        raise ValueError("rule")
    kind = rule["type"]
    out = {"type": kind}
    if kind in ("counter", "all_kinds"):
        out["kinds"] = _counter_kinds(rule)
    elif kind == "tabs":
        tabs = rule.get("tabs")
        if not isinstance(tabs, list) or not tabs or any(tab not in MAIN_TABS for tab in tabs):
            raise ValueError("tabs")
        out["tabs"] = list(tabs)
    elif kind == "state":
        if rule.get("key") not in STATE_KEYS:
            raise ValueError("state")
        out["key"] = rule["key"]
    elif kind == "unlocks":
        out["hardcoreOnly"] = bool(rule.get("hardcoreOnly"))
    elif kind == "award":
        if rule.get("award") not in AWARD_KINDS:
            raise ValueError("award")
        out["award"] = rule["award"]
    elif kind == "finish_category":
        if rule.get("category") not in category_ids:
            raise ValueError("category")
        out["category"] = rule["category"]
    elif kind == "unlock_hour":
        start = rule.get("from")
        end = rule.get("to")
        if (not isinstance(start, int) or not isinstance(end, int) or isinstance(start, bool) or isinstance(end, bool)
                or not 0 <= start < end <= 24):
            raise ValueError("hours")
        out["from"] = start
        out["to"] = end
    return out


def _clean_quest_rule(rule):
    if not isinstance(rule, dict) or rule.get("type") not in _QUEST_RULES:
        raise ValueError("rule")
    kind = rule["type"]
    out = {"type": kind}
    if kind == "unlocks" and rule.get("minPoints") is not None:
        min_points = to_int(rule.get("minPoints"), 0)
        if min_points <= 0:
            raise ValueError("minPoints")
        out["minPoints"] = min_points
    elif kind == "action":
        out["kinds"] = _counter_kinds(rule)
    return out


def _positive(raw, name):
    value = to_int(raw, 0)
    if isinstance(raw, bool) or value <= 0:
        raise ValueError(name)
    return value


def _clean_category(raw):
    if not isinstance(raw, dict):
        raise ValueError("category")
    cat_id = raw.get("id")
    if not isinstance(cat_id, str) or not _ID_RE.match(cat_id):
        raise ValueError("id")
    if raw.get("icon") not in CATEGORY_ICONS:
        raise ValueError("icon")
    return {"id": cat_id, "icon": raw["icon"]}


def _clean_milestone(raw, category_ids):
    if not isinstance(raw, dict):
        raise ValueError("row")
    ms_id = raw.get("id")
    if not isinstance(ms_id, str) or not _ID_RE.match(ms_id):
        raise ValueError("id")
    if raw.get("category") not in category_ids:
        raise ValueError("category")
    out = {
        "id": ms_id,
        "category": raw["category"],
        "rule": _clean_milestone_rule(raw.get("rule"), category_ids),
        "target": _positive(raw.get("target"), "target"),
        "xp": _positive(raw.get("xp"), "xp"),
        "needsGlobalButtons": bool(raw.get("needsGlobalButtons")),
        "binding": None,
        "buttons": _clean_buttons(raw.get("buttons")),
    }
    binding = raw.get("binding")
    if binding is not None:
        if binding not in BINDING_ACTIONS:
            raise ValueError("binding")
        out["binding"] = binding
    return out


def _clean_quest(raw, with_xp):
    if not isinstance(raw, dict):
        raise ValueError("row")
    quest_id = raw.get("id")
    if not isinstance(quest_id, str) or not _ID_RE.match(quest_id):
        raise ValueError("id")
    needs = raw.get("needs")
    if needs is not None and needs not in QUEST_NEEDS:
        raise ValueError("needs")
    out = {
        "id": quest_id,
        "rule": _clean_quest_rule(raw.get("rule")),
        "target": _positive(raw.get("target"), "target"),
        "needs": needs,
    }
    if with_xp:
        out["xp"] = _positive(raw.get("xp"), "xp")
    return out


def _clean_bonus_quest(raw):
    out = _clean_quest(raw, False)
    if raw.get("xp") is not None:
        out["xp"] = _positive(raw.get("xp"), "xp")
    return out


def _clean_rows(rows, label, cleaner):
    out = []
    seen = set()
    if not isinstance(rows, list):
        decky.logger.warning("milestones: definitions have no %s list", label)
        return out
    for index, raw in enumerate(rows):
        try:
            row = cleaner(raw)
        except ValueError as e:
            decky.logger.warning("milestones: skipping %s row %d (bad %s)", label, index, e)
            continue
        if row["id"] in seen:
            decky.logger.warning("milestones: skipping %s row %d (duplicate id %s)", label, index, row["id"])
            continue
        seen.add(row["id"])
        out.append(row)
    return out


def _clean_ranks(rows):
    out = []
    if not isinstance(rows, list):
        return out
    for raw in rows:
        if not isinstance(raw, dict) or raw.get("tier") not in RANK_TIERS:
            break
        xp = to_int(raw.get("xp"), -1)
        step = to_int(raw.get("step"), 0)
        if xp < 0 or not 1 <= step <= 4 or (out and xp <= out[-1]["xp"]) or (not out and xp != 0):
            break
        out.append({"xp": xp, "tier": raw["tier"], "step": step})
    return out


def load_definitions(path):
    raw = load_json_file(path, None)
    if not isinstance(raw, dict):
        decky.logger.warning("milestones: definitions unreadable at %s", path)
        return None
    categories = _clean_rows(raw.get("categories"), "category", _clean_category)
    category_ids = {category["id"] for category in categories}
    milestones = _clean_rows(raw.get("milestones"), "milestone", lambda row: _clean_milestone(row, category_ids))
    ranks = _clean_ranks(raw.get("ranks"))
    daily = _clean_rows(raw.get("dailyQuests"), "daily quest", lambda row: _clean_quest(row, False))
    weekly = _clean_rows(raw.get("weeklyQuests"), "weekly quest", lambda row: _clean_quest(row, True))
    bonus = _clean_rows(raw.get("bonusQuests"), "bonus quest", _clean_bonus_quest)
    combo = raw.get("comboBonus") if isinstance(raw.get("comboBonus"), dict) else {}
    odds = raw.get("bonusQuest") if isinstance(raw.get("bonusQuest"), dict) else {}
    if not categories or not milestones or not ranks:
        decky.logger.warning("milestones: definitions at %s are missing categories, milestones or ranks", path)
        return None
    return {
        "version": to_int(raw.get("version"), 1),
        "categories": categories,
        "milestones": milestones,
        "ranks": ranks,
        "dailyQuests": daily,
        "weeklyQuests": weekly,
        "bonusQuests": bonus,
        "dailyXp": max(0, to_int(raw.get("dailyXp"), 0)),
        "bonusQuest": {
            "baseChance": min(100, max(0, to_int(odds.get("baseChance"), 0))),
            "perComboDay": min(100, max(0, to_int(odds.get("perComboDay"), 0))),
            "maxChance": min(100, max(0, to_int(odds.get("maxChance"), 0))),
            "xp": max(0, to_int(odds.get("xp"), 0)),
        },
        "comboBonus": {
            "perDay": max(0, to_int(combo.get("perDay"), 0)),
            "capDay": max(1, to_int(combo.get("capDay"), 1)),
        },
    }


def rank_index(ranks, xp):
    index = 0
    for i, rank in enumerate(ranks):
        if rank["xp"] <= xp:
            index = i
    return index
