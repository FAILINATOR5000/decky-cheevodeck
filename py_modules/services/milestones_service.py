import asyncio
import contextlib
import hashlib
import random
import threading
import time
import urllib.error
from datetime import datetime, timezone

import decky

from local_days import (
    add_days,
    day_of,
    day_start_ts,
    month_of,
    months_between,
    next_month,
    parse_day,
    previous_month,
    this_month,
    this_week,
    today,
    week_of_day,
    week_start_day,
)
from milestones_defs import COUNTER_KINDS, MAIN_TABS, rank_index
from milestones_store import empty_sealed, normalize
from services._tick_common import TickServiceBase
from services.activity_service import _row_key, normalize_ra_rows, unique_unlocks
from services.back_button_service import matching_nodes
from notifications import emit_notification, is_type_enabled
from settings_store import _default_quick_menu_shortcuts, _default_shortcut_bindings
from utils import to_int


MILESTONES_EVENT = "cheevodeck_milestones"

RA_JOB_MIN_GAP_SECONDS = 60

BOOT_DELAY_SECONDS = 120

DAILY_CHECK_DELAY_SECONDS = 120

DAILY_CHECK_POLL_SECONDS = 10 * 60

EVENT_SETTLE_SECONDS = 0.4

MISSING_MONTHS_PER_JOB = 2

RA_JOB_TIMEOUT_SECONDS = 180
RATE_LIMIT_BACKOFF_SECONDS = 15 * 60
SERVICE_UNAVAILABLE_BACKOFF_SECONDS = 30 * 60

MAX_PENDING_EVENTS = 500

MOVE_HOLD_SECONDS = 60

MAX_TOASTS_PER_PASS = 3

_NUMERALS = ("I", "II", "III", "IV")

_PADDLES_BY_FORMAT = {
    "deck": ("l4", "l5", "r4", "r5"),
    "controller": ("l4", "l5", "r4", "r5"),
    "ally": ("l4", "l5", "r4", "r5"),
}

_BEATEN_TYPES = ("game beaten",)
_MASTERED_TYPES = ("mastery/completion",)


def counter_total(data, kinds):
    total = 0
    for tally in data["counters"].values():
        for kind in kinds:
            total += tally.get(kind, 0)
    return total


def tabs_visited(data):
    seen = set()
    for tabs in data["tabsVisited"].values():
        seen.update(tabs)
    return seen


def total_xp(data):
    return (
        sum(claim["xp"] for claim in data["claims"].values())
        + sum(entry["xp"] for entry in data["dailyDone"].values())
        + sum(entry["xp"] for entry in data["weeklyDone"].values())
        + sum(entry["xp"] for entry in data["bonusDone"].values())
        + data["combo"]["xpEarned"]
    )


def pad_supported(data, facts):
    return bool(facts["supported"] or data["padSeen"].get(data["deviceId"]))


def available_milestones(defs, supported):
    return [m for m in defs["milestones"] if supported or not m["needsGlobalButtons"]]


def combo_view(combo, day):
    last = combo["lastDay"]
    yesterday = add_days(day, -1)
    alive = last is not None and (last == day or last == yesterday)
    return {
        "length": combo["length"] if alive else 0,
        "activeToday": last == day,
        "alive": alive,
    }


def walk_combo(combo, active_days, first_day, day, per_day, cap_day, until=None):
    last = combo["lastDay"]
    length = combo["length"]
    if last is not None and length <= 0:
        length = rebuild_combo_length(last, active_days)
    xp = combo["xpEarned"]
    paid = 0
    peak = length if combo_view(dict(combo, length=length), day)["alive"] else 0
    cursor = add_days(last, 1) if last else first_day
    end = day if until is None or until > day else until
    while cursor is not None and cursor <= end:
        if cursor in active_days:
            if last is not None and add_days(last, 1) == cursor and length > 0:
                length += 1
            else:
                length = 1
            bonus = min(length, cap_day) * per_day
            xp += bonus
            paid += bonus
            last = cursor
            peak = max(peak, length)
        cursor = add_days(cursor, 1)
    return {"length": length, "lastDay": last, "xpEarned": xp}, paid, peak


def rebuild_combo_length(last_day, active_days):
    length = 0
    cursor = last_day
    while cursor in active_days:
        length += 1
        cursor = add_days(cursor, -1)
    return length


def _seed(text):
    return int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")


def pick_quest(pool, seed_text, exclude=None):
    ids = sorted(q["id"] for q in pool if q["id"] != exclude)
    if not ids:
        return None
    return random.Random(_seed(seed_text)).choice(ids)


def eligible_quests(quests, needs):
    return [q for q in quests if q["needs"] is None or needs.get(q["needs"])]


def _new_period(name, key, quest):
    return {name: key, "quest": quest, "rerolled": False, "progress": 0, "actions": {}}


def roll_periods(data, defs, ulid, needs, day, week):
    changed = False
    daily = data["daily"]
    if daily is None or daily["date"] < day:
        quest = pick_quest(eligible_quests(defs["dailyQuests"], needs), day + ulid)
        if quest is not None:
            data["daily"] = _new_period("date", day, quest)
            changed = True
    weekly = data["weekly"]
    if weekly is None or weekly["week"] < week:
        quest = pick_quest(eligible_quests(defs["weeklyQuests"], needs), week + ulid)
        if quest is not None:
            data["weekly"] = _new_period("week", week, quest)
            changed = True
    return changed


def bonus_xp(defs, quest):
    return quest.get("xp", defs["bonusQuest"]["xp"])


def carried_combo(combo, day):
    view = combo_view(combo, day)
    return max(0, view["length"] - 1) if view["activeToday"] else view["length"]


def bonus_chance(odds, carried):
    return min(odds["baseChance"] + odds["perComboDay"] * carried, odds["maxChance"])


def roll_bonus(data, defs, ulid, needs, day, outcome):
    rolled = data["bonusRolled"]
    if rolled is not None and rolled >= day:
        return False
    data["bonusRolled"] = day
    chance = bonus_chance(defs["bonusQuest"], carried_combo(data["combo"], day))
    if random.Random(_seed(day + ulid + "bonus")).random() * 100 < chance:
        quest = pick_quest(eligible_quests(defs["bonusQuests"], needs), day + ulid + "bonus-quest")
        if quest is not None:
            data["bonus"] = _new_period("date", day, quest)
            daily = data["daily"]
            if daily is not None and daily["date"] == day:
                data["bonus"]["actions"] = dict(daily["actions"])
            outcome["bonusAppeared"] = quest
    return True


def _quest_def(defs, period, quest_id):
    quests = {"daily": defs["dailyQuests"], "weekly": defs["weeklyQuests"], "bonus": defs["bonusQuests"]}[period]
    for quest in quests:
        if quest["id"] == quest_id:
            return quest
    return None


def quest_progress(quest, record, period_start_ts, period_end_ts, data, facts):
    rule = quest["rule"]
    kind = rule["type"]
    if kind == "action":
        return sum(record["actions"].get(k, 0) for k in rule["kinds"])
    if kind == "daily_done":
        week = record.get("week")
        return (sum(1 for day in data["dailyDone"] if week_of_day(day) == week)
                + sum(1 for day in data["bonusDone"] if week_of_day(day) == week))
    rows = facts.get("periodRows")
    if rows is None:
        if kind == "award" and facts.get("awards") is not None:
            return sum(1 for _kind, ts in facts["awards"] if period_start_ts <= ts < period_end_ts)
        return None
    in_period = [row for row in rows if period_start_ts <= row["ts"] < period_end_ts]
    rows = unique_unlocks(in_period)
    if kind == "unlocks":
        floor = rule.get("minPoints") or 0
        return sum(1 for row in rows if row["points"] >= floor)
    if kind == "points":
        return sum(row["points"] for row in rows)
    if kind == "games":
        return len({row["gameId"] for row in rows})
    if kind == "goal_unlocks":
        goal_games = facts.get("goalGames") or set()
        return sum(1 for row in rows if row["gameId"] in goal_games)
    if kind == "active_days":
        return len({day_of(row["ts"]) for row in in_period})
    if kind == "award":
        awards = facts.get("awards") or []
        return sum(1 for _kind, ts in awards if period_start_ts <= ts < period_end_ts)
    return None


def _update_quest(data, defs, facts, period, outcome):
    record = data[period]
    if record is None:
        return False
    quest = _quest_def(defs, period, record["quest"])
    if quest is None:
        return False
    if period in ("daily", "bonus"):
        key = record["date"]
        start_ts = day_start_ts(key)
        end_ts = day_start_ts(add_days(key, 1))
        done = data["dailyDone"] if period == "daily" else data["bonusDone"]
        xp = defs["dailyXp"] if period == "daily" else bonus_xp(defs, quest)
    else:
        key = record["week"]
        start_ts = day_start_ts(week_start_day(key))
        end_ts = day_start_ts(add_days(week_start_day(key), 7))
        done = data["weeklyDone"]
        xp = quest["xp"]
    if start_ts is None or end_ts is None:
        return False
    changed = False
    progress = quest_progress(quest, record, start_ts, end_ts, data, facts)
    if progress is not None:
        progress = max(progress, record["progress"])
    if progress is not None and progress != record["progress"]:
        record["progress"] = progress
        changed = True
    if key not in done and record["progress"] >= quest["target"]:
        done[key] = {"quest": quest["id"], "xp": xp}
        outcome[period] = quest["id"]
        changed = True
    return changed


def milestone_progress(milestone, data, facts, claimed, available_ids):
    rule = milestone["rule"]
    kind = rule["type"]
    derived = data["derived"]
    if kind == "counter":
        return counter_total(data, rule["kinds"])
    if kind == "all_kinds":
        return sum(1 for one in rule["kinds"] if counter_total(data, [one]) > 0)
    if kind == "tabs":
        return len(tabs_visited(data) & set(rule["tabs"]))
    if kind == "state":
        return 1 if facts["states"].get(rule["key"]) else 0
    if kind == "unlocks":
        return derived.get("hardcore" if rule["hardcoreOnly"] else "unlocks", 0)
    if kind == "award":
        return 1 if derived.get("beatenAt" if rule["award"] == "beaten" else "masteredAt") else 0
    if kind == "combo":
        return max(facts.get("comboPeak", 0), combo_view(data["combo"], facts["today"])["length"])
    if kind == "active_days":
        return derived.get("activeDays", 0)
    if kind == "daily_done":
        return len(data["dailyDone"]) + len(data["bonusDone"])
    if kind == "weekly_done":
        return len(data["weeklyDone"])
    if kind == "finish_category":
        members = [mid for mid in available_ids if facts["categoryOf"][mid] == rule["category"]]
        return sum(1 for mid in members if mid in claimed)
    if kind == "completionist":
        others = [mid for mid in available_ids if mid != milestone["id"]]
        return sum(1 for mid in others if mid in claimed)
    if kind == "unlock_hour":
        started = data["startedAt"]
        for row in facts.get("periodRows") or []:
            if row["ts"] >= started and rule["from"] <= datetime.fromtimestamp(row["ts"]).hour < rule["to"]:
                return 1
        return 0
    if kind == "unlock_points":
        started = data["startedAt"]
        for row in facts.get("periodRows") or []:
            if row["ts"] >= started and row["points"] == rule["points"]:
                return 1
        return 0
    if kind == "games_one_day":
        started = data["startedAt"]
        games_by_day = {}
        for row in facts.get("periodRows") or []:
            if row["ts"] >= started:
                games_by_day.setdefault(day_of(row["ts"]), set()).add(row["gameId"])
        return max((len(games) for games in games_by_day.values()), default=0)
    if kind == "weekend":
        days = (facts.get("ra") or {}).get("activeDays") or set()
        for day in days:
            parsed = parse_day(day)
            if parsed is not None and parsed.weekday() == 5 and add_days(day, 1) in days:
                return 1
        return 0
    if kind == "month_points":
        ra = facts.get("ra")
        return ra["monthPoints"] if ra is not None else facts.get("monthPoints", 0)
    if kind == "perfect_month":
        days = (facts.get("ra") or {}).get("activeDays") or set()
        for month in {day[:7] for day in days}:
            cursor = month + "-01"
            while cursor is not None and cursor[:7] == month and cursor in days:
                cursor = add_days(cursor, 1)
            if cursor is not None and cursor[:7] != month:
                return 1
        return 0
    return 0


def milestone_target(milestone, facts, available_ids):
    rule = milestone["rule"]
    if rule["type"] == "finish_category":
        return len([mid for mid in available_ids if facts["categoryOf"][mid] == rule["category"]])
    if rule["type"] == "completionist":
        return len(available_ids) - 1
    return milestone["target"]


def claim_milestones(data, defs, facts, now, outcome):
    available = available_milestones(defs, facts["supported"])
    available_ids = [m["id"] for m in available]
    facts.setdefault("categoryOf", {m["id"]: m["category"] for m in defs["milestones"]})
    changed = False
    while True:
        claimed = data["claims"]
        newly = []
        for milestone in available:
            if milestone["id"] in claimed:
                continue
            target = milestone_target(milestone, facts, available_ids)
            if target <= 0:
                continue
            if milestone_progress(milestone, data, facts, claimed, available_ids) >= target:
                newly.append(milestone)
        if not newly:
            return changed
        for milestone in newly:
            claimed[milestone["id"]] = {"at": now, "xp": milestone["xp"]}
            outcome["milestones"].append(milestone["id"])
        changed = True


def live_from_month(current, week_start, since=None):
    candidates = [previous_month(current)]
    if week_start:
        candidates.append(week_start[:7])
    if since:
        candidates.append(since[:7])
    return min(candidates)


def months_wanted(started_at, current, week_start, *, since=None, sealed_through=None):
    first_unsealed = next_month(sealed_through) if sealed_through else month_of(started_at)
    return months_between(min(first_unsealed, live_from_month(current, week_start, since)), current)


def _fold(sealed, rows, started_at):
    for row in rows:
        if row["ts"] < started_at:
            continue
        sealed["ids"].add(row["achievementId"])
        if row["hardcore"]:
            sealed["hardcoreIds"].add(row["achievementId"])
        sealed["days"].add(day_of(row["ts"]))


def seal_months(sealed, months, started_at, start_month, live_from):
    out = {
        "sealedThrough": sealed["sealedThrough"],
        "ids": set(sealed["ids"]),
        "hardcoreIds": set(sealed["hardcoreIds"]),
        "days": set(sealed["days"]),
    }
    cursor = next_month(out["sealedThrough"]) if out["sealedThrough"] else start_month
    while cursor < live_from:
        rows = months.get(cursor)
        if rows is None:
            break
        _fold(out, rows, started_at)
        out["sealedThrough"] = cursor
        cursor = next_month(cursor)
    return out


def stored_periods_start(data):
    days = []
    if data["daily"] is not None:
        days.append(data["daily"]["date"])
    if data["bonus"] is not None:
        days.append(data["bonus"]["date"])
    if data["weekly"] is not None:
        days.append(week_start_day(data["weekly"]["week"]))
    days = [day for day in days if day]
    return min(days) if days else None


def month_points(rows, started_at):
    points = {}
    for row in rows:
        if row["ts"] >= started_at:
            points[row["achievementId"]] = row["points"]
    return sum(points.values())


def ra_facts(months, started_at, week_start, since=None, *, sealed=None):
    rows = []
    for month_rows in months.values():
        rows.extend(month_rows)
    first_day = add_days(week_start, -7) if week_start else None
    if since and (first_day is None or since < first_day):
        first_day = since
    week_from = (day_start_ts(first_day) or 0) if first_day else 0
    totals = empty_sealed() if sealed is None else {
        "ids": set(sealed["ids"]),
        "hardcoreIds": set(sealed["hardcoreIds"]),
        "days": set(sealed["days"]),
    }
    _fold(totals, rows, started_at)
    return {
        "startedAt": started_at,
        "ids": totals["ids"],
        "hardcoreIds": totals["hardcoreIds"],
        "activeDays": totals["days"],
        "periodRows": sorted((row for row in rows if row["ts"] >= week_from), key=lambda row: (row["ts"], row["achievementId"])),
        "monthPoints": max((month_points(month_rows, started_at) for month_rows in months.values()), default=0),
    }


def _apply_ra(data, facts, now):
    ra = facts["ra"]
    derived = data["derived"]
    old = dict(derived)
    unlocks = len(ra["ids"])
    hardcore = len(ra["hardcoreIds"])
    active = len(ra["activeDays"])
    if not ra["complete"]:
        unlocks = max(unlocks, old.get("unlocks", 0))
        hardcore = max(hardcore, old.get("hardcore", 0))
        active = max(active, old.get("activeDays", 0))
    beaten = old.get("beatenAt")
    mastered = old.get("masteredAt")
    if facts.get("awards") is not None:
        started = data["startedAt"]
        beaten_times = [ts for kind, ts in facts["awards"] if kind in ("beaten", "mastered") and ts >= started]
        mastered_times = [ts for kind, ts in facts["awards"] if kind == "mastered" and ts >= started]
        beaten = beaten or (min(beaten_times) if beaten_times else None)
        mastered = mastered or (min(mastered_times) if mastered_times else None)
    data["derived"] = {
        "at": now,
        "unlocks": unlocks,
        "hardcore": hardcore,
        "activeDays": active,
        "beatenAt": beaten,
        "masteredAt": mastered,
    }
    return {k: v for k, v in data["derived"].items() if k != "at"} != {k: v for k, v in old.items() if k != "at"}


def evaluate(data, defs, ulid, facts, now, events=(), after_roll=None):
    outcome = {"changed": False, "milestones": [], "daily": None, "weekly": None, "bonus": None, "bonusAppeared": None,
               "rankUp": None, "comboPaid": 0}
    day = facts["today"]
    week = week_of_day(day)
    xp_before = total_xp(data)
    changed = False
    device = data["deviceId"]
    if facts["supported"] and not data["padSeen"].get(device):
        data["padSeen"][device] = True
        changed = True
    facts["supported"] = pad_supported(data, facts)

    if data["daily"] is not None and data["daily"]["date"] < day:
        changed = _update_quest(data, defs, facts, "daily", outcome) or changed
    if data["bonus"] is not None and data["bonus"]["date"] < day:
        changed = _update_quest(data, defs, facts, "bonus", outcome) or changed
    if data["weekly"] is not None and data["weekly"]["week"] < week:
        changed = _update_quest(data, defs, facts, "weekly", outcome) or changed
    changed = roll_periods(data, defs, ulid, facts["needs"], day, week) or changed
    for kind, detail, count in events:
        changed = apply_event(data, kind, detail, count) or changed
    if after_roll is not None:
        changed = bool(after_roll(data, facts)) or changed

    if facts.get("ra") is not None:
        changed = _apply_ra(data, facts, now) or changed
        bonus = defs["comboBonus"]
        first_day = day_of(data["startedAt"])
        combo, paid, peak = walk_combo(data["combo"], facts["ra"]["activeDays"], first_day, day,
                                       bonus["perDay"], bonus["capDay"], until=facts["ra"].get("walkUntil"))
        facts["comboPeak"] = peak
        if combo != data["combo"]:
            data["combo"] = combo
            outcome["comboPaid"] = paid
            changed = True
        until = facts["ra"].get("walkUntil")
        if until is None or until >= day:
            changed = roll_bonus(data, defs, ulid, facts["needs"], day, outcome) or changed

    if data["daily"] is not None and data["daily"]["date"] == day:
        changed = _update_quest(data, defs, facts, "daily", outcome) or changed
    if data["bonus"] is not None and data["bonus"]["date"] == day:
        changed = _update_quest(data, defs, facts, "bonus", outcome) or changed
    if data["weekly"] is not None and data["weekly"]["week"] == week:
        changed = _update_quest(data, defs, facts, "weekly", outcome) or changed

    changed = claim_milestones(data, defs, facts, now, outcome) or changed

    rank = rank_index(defs["ranks"], total_xp(data))
    seen = data["rankSeen"].get(device)
    if seen is None:
        seen = rank_index(defs["ranks"], xp_before)
        data["rankSeen"][device] = seen
        changed = True
    if rank > seen:
        data["rankSeen"][device] = rank
        outcome["rankUp"] = rank
        changed = True
    outcome["changed"] = changed
    return outcome


def needed_kinds(data, defs):
    kinds = set()
    claims = data["claims"]
    for milestone in defs["milestones"]:
        if milestone["id"] in claims:
            continue
        rule = milestone["rule"]
        if rule["type"] in ("counter", "all_kinds"):
            kinds.update(rule["kinds"])
        elif rule["type"] == "tabs":
            kinds.add("main_tab")
    for period, done_key, key_name in (("daily", "dailyDone", "date"), ("weekly", "weeklyDone", "week"),
                                       ("bonus", "bonusDone", "date")):
        record = data[period]
        if record is None or record[key_name] in data[done_key]:
            continue
        quest = _quest_def(defs, period, record["quest"])
        if quest is not None and quest["rule"]["type"] == "action":
            kinds.update(quest["rule"]["kinds"])
    return sorted(kinds)


def _quest_state(data, defs, period, day):
    record = data[period]
    if record is None:
        return None
    quest = _quest_def(defs, period, record["quest"])
    if quest is None:
        return None
    if period in ("daily", "bonus"):
        key = record["date"]
        done = data["dailyDone" if period == "daily" else "bonusDone"].get(key)
        current = key == day
        xp = defs["dailyXp"] if period == "daily" else bonus_xp(defs, quest)
    else:
        key = record["week"]
        done = data["weeklyDone"].get(key)
        current = key == week_of_day(day)
        xp = quest["xp"]
    return {
        "key": key,
        "quest": quest["id"],
        "progress": min(record["progress"], quest["target"]) if done is None else quest["target"],
        "target": quest["target"],
        "xp": done["xp"] if done is not None else xp,
        "done": done is not None,
        "rerolled": record["rerolled"],
        "canReroll": current and done is None and not record["rerolled"] and period != "bonus",
        "ruleType": quest["rule"]["type"],
    }


def build_state(data, defs, facts):
    supported = pad_supported(data, facts)
    day = facts["today"]
    available = available_milestones(defs, supported)
    available_ids = [m["id"] for m in available]
    facts = dict(facts)
    facts.setdefault("categoryOf", {m["id"]: m["category"] for m in defs["milestones"]})
    claims = data["claims"]
    progress = {}
    targets = {}
    for milestone in defs["milestones"]:
        target = milestone_target(milestone, facts, available_ids)
        targets[milestone["id"]] = target
        if milestone["id"] in claims:
            progress[milestone["id"]] = target
        else:
            progress[milestone["id"]] = min(target, milestone_progress(milestone, data, facts, claims, available_ids))
    xp = total_xp(data)
    ranks = defs["ranks"]
    rank = rank_index(ranks, xp)
    device = data["deviceId"]
    seen_at = data["lastSeenAt"].get(device, 0)
    new_ids = [mid for mid, claim in claims.items() if claim["at"] > seen_at and mid in targets]
    combo = combo_view(data["combo"], day)
    bonus = defs["comboBonus"]
    if combo["activeToday"]:
        combo["bonusToday"] = min(combo["length"], bonus["capDay"]) * bonus["perDay"]
    else:
        combo["bonusToday"] = min(combo["length"] + 1, bonus["capDay"]) * bonus["perDay"]
    return {
        "ok": True,
        "today": day,
        "startedAt": data["startedAt"],
        "categories": defs["categories"],
        "milestones": [
            {
                "id": m["id"],
                "category": m["category"],
                "xp": m["xp"],
                "ruleType": m["rule"]["type"],
                "binding": m["binding"],
                "buttons": m["buttons"],
                "needsGlobalButtons": m["needsGlobalButtons"],
            }
            for m in defs["milestones"]
        ],
        "claims": claims,
        "progress": progress,
        "targets": targets,
        "available": available_ids,
        "xp": xp,
        "rank": rank,
        "ranks": ranks,
        "rankXp": ranks[rank]["xp"],
        "nextRankXp": ranks[rank + 1]["xp"] if rank + 1 < len(ranks) else None,
        "combo": combo,
        "daily": _quest_state(data, defs, "daily", day),
        "weekly": _quest_state(data, defs, "weekly", day),
        "bonus": _quest_state(data, defs, "bonus", day) if data["bonus"] is not None and data["bonus"]["date"] == day else None,
        "newIds": new_ids,
        "collapsed": data["collapsed"].get(device, []),
        "supported": supported,
        "paddles": facts.get("paddles", []),
        "neededKinds": needed_kinds(data, defs),
        "countsLoaded": data["derived"].get("at") is not None,
    }


def apply_event(data, kind, detail, count):
    device = data["deviceId"]
    if kind == "main_tab":
        tabs = data["tabsVisited"].setdefault(device, [])
        if detail in tabs:
            return False
        tabs.append(detail)
        return True
    tally = data["counters"].setdefault(device, {})
    tally[kind] = tally.get(kind, 0) + count
    day = today()
    for period, key_name, key in (("daily", "date", day), ("weekly", "week", week_of_day(day)), ("bonus", "date", day)):
        record = data[period]
        if record is not None and record[key_name] == key:
            record["actions"][kind] = record["actions"].get(kind, 0) + count
    return True


def parse_award_time(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def _numeral(step):
    return _NUMERALS[step - 1] if 1 <= step <= len(_NUMERALS) else str(step)


def awards_from_payload(payload):
    out = []
    results = payload.get("results") if isinstance(payload, dict) else None
    for row in results if isinstance(results, list) else []:
        if not isinstance(row, dict):
            continue
        award_type = str(row.get("awardType") or "").strip().lower()
        if award_type in _BEATEN_TYPES:
            kind = "beaten"
        elif award_type in _MASTERED_TYPES:
            kind = "mastered"
        else:
            continue
        ts = parse_award_time(row.get("awardedAt"))
        if ts is not None:
            out.append((kind, ts))
    return out


class MilestonesService(TickServiceBase):
    def __init__(self, *, store, defs, activity_service, activity_store, settings_store,
                 tracked_sets_store=None, cache_store=None, awards_cache_store=None,
                 notifications_store=None, plugin=None):
        super().__init__(
            settings_store=settings_store,
            plugin=plugin,
            thread_name="milestones",
            log_label="milestones",
            rate_limit_backoff_seconds=RATE_LIMIT_BACKOFF_SECONDS,
        )
        self._store = store
        self._defs = defs
        self._activity = activity_service
        self._activity_store = activity_store
        self._tracked_sets_store = tracked_sets_store
        self._cache_store = cache_store
        self._awards_cache_store = awards_cache_store
        self._notifications = notifications_store

        self._wake = threading.Event()
        self._queue_lock = threading.Lock()
        self._events = []
        self._ra_requested = False
        self._ra_reason = ""
        self._apply_requested = False
        self._state_requested = False
        self._last_job_at = 0.0
        self._not_before = 0.0
        self._daily_day = None
        self._started_at = time.monotonic()

        self._month_cache = None
        self._offline_requested = False
        self._prune_requested = False

        self._period_cache = None

        self._announcer = self._notify

        self._moving_until = 0.0
        self._move_token = 0
        self._quiet_pass = False

    @property
    def defs(self):
        return self._defs

    def record_event(self, kind, detail=None, count=1):
        if kind == "main_tab":
            if detail not in MAIN_TABS:
                return False
        elif kind not in COUNTER_KINDS:
            return False
        count = to_int(count, 0)
        if count <= 0:
            return False
        ulid = self._store.ulid
        if not ulid or self._defs is None:
            return False
        with self._queue_lock:
            if len(self._events) >= MAX_PENDING_EVENTS:
                return False
            self._events.append((ulid, kind, detail, count))
        self._wake.set()
        return True

    def request_check(self, reason="panel"):
        if self._defs is None:
            return
        with self._queue_lock:
            self._ra_requested = True
            if reason == "panel" or not self._ra_reason:
                self._ra_reason = reason
            if reason == "panel":
                self._apply_requested = True
        self._wake.set()

    def note_unlocks(self, ulid, recent_items):
        if self._defs is None or not ulid:
            return
        current = this_month()
        rows = normalize_ra_rows(recent_items)
        with self._queue_lock:
            cache = self._month_cache
            if cache is None or cache["ulid"] != ulid or cache["month"] != current:
                return
            known = {_row_key(row) for row in cache["rows"]}
            new = []
            for row in rows:
                key = _row_key(row)
                if month_of(row["ts"]) != current or row["ts"] < cache["startedAt"] or key in known:
                    continue
                known.add(key)
                new.append(row)
            if not new:
                return
            cache["rows"] = cache["rows"] + new
            self._offline_requested = True
        self._debug_log("milestones: %d new unlock(s) noted, offline pass queued", len(new))
        self._wake.set()

    def account_changed(self):
        self._period_cache = None
        self._quiet_pass = False
        with self._queue_lock:
            self._month_cache = None
        self._emit_changed()

    def stop(self):
        self._stop_event.set()
        self._wake.set()
        self._log_stop_requested()

    def start_with_boot_check(self):
        self._not_before = time.monotonic() + BOOT_DELAY_SECONDS
        self._daily_day = today()
        self.request_check("boot")
        self.start()

    def settings_changed(self):
        self._wake.set()

    def state_changed(self):
        if self._defs is None:
            return
        with self._queue_lock:
            self._apply_requested = True
            self._state_requested = True
        self._wake.set()

    def _background_blocked(self, cfg):
        settings = self._settings_store
        if not settings.get_milestones_service_enabled(cfg):
            return "the service is off"
        if settings.get_battery_saver(cfg) and settings.get_battery_saver_disables_milestones(cfg):
            return "Standby is on"
        return None

    def _check_tick(self, now, cfg):
        if self._background_blocked(cfg) is not None:
            return None
        with self._queue_lock:
            if self._ra_requested:
                return None
        due = max(self._last_job_at, self._started_at) + self._settings_store.get_milestones_tick_minutes(cfg) * 60
        if now >= due:
            self.request_check("tick")
            return None
        return due - now

    def _check_daily(self, now):
        day = day_of(now)
        if self._daily_day is None or day < self._daily_day:
            self._daily_day = day
        due_day = day if day > self._daily_day else add_days(day, 1)
        due_at = day_start_ts(due_day) + DAILY_CHECK_DELAY_SECONDS
        if now >= due_at:
            self._daily_day = day
            with self._queue_lock:
                cache = self._month_cache
                fetched_today = (cache is not None and cache["ulid"] == self._store.ulid
                                 and cache["fetchedDay"] == day)
            if not fetched_today:
                self.request_check("daily")
            due_at = day_start_ts(add_days(day, 1)) + DAILY_CHECK_DELAY_SECONDS
        return min(max(0.0, due_at - now), DAILY_CHECK_POLL_SECONDS)

    def _run_loop(self):
        my_generation = self._generation
        self._log_loop_entered(my_generation)
        while not self._stop_event.is_set():
            if not self._generation_fence.is_live(my_generation):
                return
            timeout = self._check_daily(time.time())
            tick_wait = self._check_tick(time.monotonic(), self._settings_store.load_config())
            if tick_wait is not None:
                timeout = min(timeout, tick_wait)
            with self._queue_lock:
                waiting_ra = self._ra_requested
                ra_reason = self._ra_reason
            if waiting_ra:
                due = self._ra_due(ra_reason)
                timeout = min(timeout, max(0.0, due - time.monotonic()))
            if self._holding():
                timeout = min(timeout, max(0.0, self._moving_until - time.monotonic()) + 0.05)
            self._wake.wait(timeout=timeout)
            if self._stop_event.is_set():
                return
            self._wake.clear()
            try:
                with self._queue_lock:
                    has_events = bool(self._events)
                    idle = not (has_events or self._ra_requested or self._apply_requested
                                or self._offline_requested or self._prune_requested)
                if idle:
                    continue
                if has_events and self._stop_event.wait(EVENT_SETTLE_SECONDS):
                    return
                self._pass()
            except Exception as exc:
                self._log_tick_crashed(exc)

    def _ra_due(self, reason):
        gap = self._last_job_at + RA_JOB_MIN_GAP_SECONDS
        return gap if reason == "panel" else max(self._not_before, gap)

    def _pass(self):
        if self._holding():
            return
        with self._queue_lock:
            events = self._events
            self._events = []
            run_ra = self._ra_requested and time.monotonic() >= self._ra_due(self._ra_reason)
            reason = self._ra_reason
            apply_now = self._apply_requested
            self._apply_requested = False
            after_press = self._state_requested
            self._state_requested = False
            offline = self._offline_requested
            self._offline_requested = False
            prune_now = self._prune_requested
            self._prune_requested = False
            if run_ra:
                self._ra_requested = False
                self._ra_reason = ""
        cfg = self._settings_store.load_config()
        self._debug_logging = self._settings_store.get_debug_logging(cfg)
        ulid = str(cfg.get("activeUlid") or "").strip()
        if not ulid or ulid != self._store.ulid:
            return
        events = [event for event in events if event[0] == ulid]

        if prune_now:
            with self._switch_lock():
                stored = self._store.load()
                if stored is not None:
                    live = live_from_month(this_month(), week_start_day(this_week()), stored_periods_start(stored))
                    self._prune_activity(cfg, self._store.load_sealed(stored["startedAt"])["sealedThrough"], live)

        ra = None
        if run_ra:
            self._last_job_at = time.monotonic()
            blocked = self._background_blocked(cfg) if reason != "panel" else None
            if blocked is not None:
                self._debug_log("milestones: %s, skipping the %s check", blocked, reason)
            else:
                ra = self._run_ra_job(cfg, ulid, background=reason != "panel")
        if ra is None and offline:
            ra = self._offline_facts(ulid)
        if not events and ra is None and not run_ra and not apply_now:
            return
        self.apply(ulid, events=events, ra=ra, after_press=after_press)

    def live_facts(self, cfg=None):
        if cfg is None:
            cfg = self._settings_store.load_config()
        settings = self._settings_store
        goal_games = set()
        goal_exists = False
        if self._tracked_sets_store is not None:
            try:
                for tracked_set in self._tracked_sets_store.load_all().get("sets") or []:
                    games = tracked_set.get("games") or []
                    if games:
                        goal_exists = True
                    for game in games:
                        game_id = to_int(game.get("gameId"), 0)
                        if game_id > 0:
                            goal_games.add(game_id)
            except Exception as e:
                decky.logger.warning("milestones: couldn't read Mastery Goals: %s", type(e).__name__)
        try:
            tracked_nonempty = bool(settings.get_all_tracked_games())
        except Exception:
            tracked_nonempty = False
        memories_on = bool(settings.get_memories_auto_capture(cfg))
        states = {
            "global_buttons_on": bool(cfg.get("backButtonsGlobal", False)),
            "developer_options_on": bool(settings.get_show_developer_options(cfg)),
            "memories_on": memories_on,
            "quick_menu_customized": set(settings.get_quick_menu_shortcuts(cfg)) != set(_default_quick_menu_shortcuts()),
            "binding_changed": settings.get_shortcut_bindings(cfg) != _default_shortcut_bindings(),
            "has_friend": self._has_friend(),
        }
        formats = self._pad_formats()
        paddles = set()
        for fmt in formats:
            paddles.update(_PADDLES_BY_FORMAT.get(fmt, ()))
        return {
            "today": today(),
            "states": states,
            "supported": bool(formats),
            "paddles": sorted(paddles),
            "needs": {
                "tracked_nonempty": tracked_nonempty,
                "goal_exists": goal_exists,
                "memories_on": memories_on,
            },
            "goalGames": goal_games,
        }

    def _has_friend(self):
        if self._cache_store is None:
            return False
        try:
            payload = self._cache_store.load_friends().get("payload") or {}
        except Exception:
            return False
        rows = payload.get("friends") if isinstance(payload, dict) else None
        return any(isinstance(row, dict) and not row.get("isSelf") for row in rows or [])

    def _pad_formats(self):
        try:
            return set(matching_nodes().values())
        except Exception:
            return set()

    def global_buttons_supported(self):
        return bool(self._pad_formats())

    def apply(self, ulid, *, events=(), ra=None, extra=None, after_press=False):
        if self._defs is None:
            return None, None
        cfg = self._settings_store.load_config()
        facts = self.live_facts(cfg)
        if ra is not None:
            facts["ra"] = ra
            facts["periodRows"] = ra["periodRows"]
            facts["awards"] = ra["awards"]
            self._period_cache = (ulid, ra["periodRows"], ra["awards"])
        elif self._period_cache is not None and self._period_cache[0] == ulid:
            facts["periodRows"] = self._period_cache[1]
            facts["awards"] = self._period_cache[2]
        now = int(time.time())
        outcome_box = {}

        def change(data):
            changed = False
            if ra is not None and ra.get("startedAt") != data["startedAt"]:
                facts.pop("ra", None)
            outcome = evaluate(data, self._defs, ulid, facts, now,
                               events=[(kind, detail, count) for _ulid, kind, detail, count in events],
                               after_roll=extra)
            outcome_box["outcome"] = outcome
            return changed or outcome["changed"]

        with self._switch_lock():
            if str(self._settings_store.load_config().get("activeUlid") or "") != ulid:
                return None, None
            if self._holding():
                self._defer(events, ra)
                return None, None
            data, changed = self._store.mutate(change, ulid=ulid)
            if data is None:
                return None, None
            outcome = outcome_box.get("outcome") or {}
            if after_press:
                outcome["afterPress"] = True
            if ra is not None:
                self._save_months(ra.get("fetchedMonths") or {})
            if ra is not None and not ra.get("offline", False) and ra.get("startedAt") == data["startedAt"]:
                self._keep_sealed(cfg, data["startedAt"], ra)
            announced = outcome
            if self._quiet_pass:
                self._quiet_pass = False
                announced = dict(outcome, milestones=[
                    mid for mid in outcome.get("milestones") or []
                    if (self._milestone(mid) or {}).get("rule", {}).get("type") != "state"
                ])
            self._announce(data, announced)
        offline = ra is not None and ra.get("offline", False)
        if changed:
            self._emit_changed(ra=ra is not None and not offline)
        self._debug_log(
            "milestones: pass events=%d ra=%s claimed=%s daily=%s bonus=%s appeared=%s weekly=%s rank=%s combo+%s",
            len(events), "offline" if offline else ra is not None, outcome.get("milestones"), outcome.get("daily"),
            outcome.get("bonus"), outcome.get("bonusAppeared"), outcome.get("weekly"), outcome.get("rankUp"),
            outcome.get("comboPaid"),
        )
        return data, outcome

    def state(self):
        if self._defs is None:
            return {"ok": False, "error": "definitions"}
        facts = self.live_facts()
        with self._switch_lock():
            data = self._store.load()
        if data is None:
            return {"ok": False, "error": "account" if not self._store.ulid else "unreadable"}
        with self._queue_lock:
            cache = self._month_cache
            if (cache is not None and cache["ulid"] == self._store.ulid and cache["month"] == this_month()
                    and cache["startedAt"] == data["startedAt"]):
                facts["monthPoints"] = month_points(cache["rows"], cache["startedAt"])
        period = self._period_cache
        if period is not None and period[0] == self._store.ulid:
            facts["periodRows"] = period[1]
        return build_state(data, self._defs, facts)

    def mark_seen(self):
        def change(data):
            data["lastSeenAt"][data["deviceId"]] = int(time.time())
            return True

        with self._switch_lock():
            if self._holding():
                return False
            data, _result = self._store.mutate(change)
        return data is not None

    def save_collapsed(self, categories):
        known = {category["id"] for category in self._defs["categories"]} if self._defs else set()
        picked = []
        for category in categories if isinstance(categories, list) else []:
            if category in known and category not in picked:
                picked.append(category)

        def change(data):
            if data["collapsed"].get(data["deviceId"]) == picked:
                return False
            data["collapsed"][data["deviceId"]] = picked
            return True

        with self._switch_lock():
            if self._holding():
                return None
            data, _result = self._store.mutate(change)
        return picked if data is not None else None

    def clear_progress(self):
        with self._switch_lock():
            if self._holding():
                return False
            cleared = self._store.clear()
        self._period_cache = None
        with self._queue_lock:
            self._month_cache = None
        if cleared:
            self.request_check("panel")
        return cleared

    def reroll(self, period):
        if period not in ("daily", "weekly") or self._defs is None or self._holding():
            return False
        ulid = self._store.ulid
        if not ulid:
            return False
        rolled = {"ok": False}

        def change(data, facts):
            day = facts["today"]
            key_name, key, quests, done = (
                ("date", day, self._defs["dailyQuests"], data["dailyDone"]) if period == "daily"
                else ("week", week_of_day(day), self._defs["weeklyQuests"], data["weeklyDone"])
            )
            record = data[period]
            if record is None or record[key_name] != key or record["rerolled"] or key in done:
                return False
            quest = pick_quest(eligible_quests(quests, facts["needs"]), key + ulid + "reroll", exclude=record["quest"])
            if quest is None:
                return False
            record["quest"] = quest
            record["rerolled"] = True
            record["progress"] = 0
            rolled["ok"] = True
            return True

        self.apply(ulid, extra=change)
        return rolled["ok"]

    def _holding(self):
        return time.monotonic() < self._moving_until

    def _defer(self, events, ra):
        with self._queue_lock:
            self._events = list(events) + self._events
            self._apply_requested = True
            if ra is not None and not ra.get("offline", False):
                self._ra_requested = True
                self._ra_reason = self._ra_reason or "panel"
            elif ra is not None:
                self._offline_requested = True
        self._wake.set()

    def begin_move(self):
        ulid = self._store.ulid
        if not ulid or self._defs is None:
            return {"ok": False, "error": "nothing"}
        with self._queue_lock:
            events = self._events
            self._events = []
        if events:
            self.apply(ulid, events=[event for event in events if event[0] == ulid])
        with self._switch_lock():
            if self._holding():
                return {"ok": False, "error": "busy"}
            files = self._store.read_files()
            if files is None:
                return {"ok": False, "error": "nothing"}
            data = normalize(files[0])
            if not data["claims"] and total_xp(data) <= 0:
                return {"ok": False, "error": "nothing"}
            self._move_token += 1
            self._moving_until = time.monotonic() + MOVE_HOLD_SECONDS
            token = self._move_token
            until = self._moving_until
        decky.logger.info("milestones: holding writes while they move to another device")
        return {"ok": True, "milestones": files[0], "sealed": files[1], "token": token, "until": until}

    def end_move(self, token, committed, aside_to=None, stamp=0):
        cleared = False
        with self._switch_lock():
            if token != self._move_token or not self._holding():
                return False
            if committed:
                cleared = self._store.set_aside_moved(aside_to, stamp)
                self._quiet_pass = cleared
            self._moving_until = 0.0
        if cleared:
            decky.logger.info("milestones: moved to another device, starting over at zero")
            self._period_cache = None
            with self._queue_lock:
                self._month_cache = None
            self._emit_changed()
            self.request_check("panel")
        else:
            decky.logger.info("milestones: the move didn't finish, keeping everything here")
        self._wake.set()
        return cleared

    def adopt(self, milestones_raw, sealed_raw, backup):
        with self._switch_lock():
            if self._holding():
                return "busy"
            mine = self._store.peek()
            if mine is not None and total_xp(mine) > total_xp(normalize(milestones_raw)):
                return "more_here"
            error = self._store.adopt(milestones_raw, sealed_raw, backup=backup)
        if not error:
            self.adopted()
        return error

    def adopted(self):
        self._period_cache = None
        with self._queue_lock:
            self._month_cache = None
        self._emit_changed()
        self.request_check("panel")

    def move_summary(self):
        data = self._store.peek()
        if data is None or self._defs is None:
            return None
        xp = total_xp(data)
        rank = self._defs["ranks"][rank_index(self._defs["ranks"], xp)]
        return {"xp": xp, "claims": len(data["claims"]), "tier": rank["tier"], "step": rank["step"]}

    def _switch_lock(self):
        plugin = self._plugin
        lock = getattr(plugin, "_account_switch_lock", None) if plugin is not None else None
        return lock if lock is not None else contextlib.nullcontext()

    def _keep_sealed(self, cfg, started_at, ra):
        sealed = ra.get("sealed")
        if sealed is None:
            return
        if ra.get("sealedChanged") and not self._store.save_sealed(sealed, started_at):
            return
        self._prune_activity(cfg, sealed["sealedThrough"], ra.get("liveFrom"))

    def _prune_activity(self, cfg, sealed_through, live_from):
        if sealed_through is None or live_from is None:
            return
        protect_after = min(sealed_through, previous_month(live_from))
        keep = self._settings_store.get_activity_cache_months(cfg)
        removed = self._activity_store.prune(keep, protect_after)
        if removed:
            self._debug_log("milestones: Activity cache trimmed by %d month(s), keeping the newest %d", removed, keep)

    def activity_cache_cleared(self):
        self._store.clear_sealed()

    def activity_cache_changed(self):
        with self._queue_lock:
            self._prune_requested = True
        self._wake.set()

    def _save_months(self, months):
        current = this_month()
        for month, rows in months.items():
            if month < current:
                self._activity_store.save_month(month, rows)

    def _announce(self, data, outcome):
        if self._announcer is not None:
            self._announcer(data, outcome)

    def set_announcer(self, announcer):
        self._announcer = announcer

    def _notify(self, data, outcome):
        milestones = [self._milestone(mid) for mid in outcome.get("milestones") or []]
        milestones = [m for m in milestones if m is not None]
        daily = outcome.get("daily")
        weekly = outcome.get("weekly")
        bonus = outcome.get("bonus")
        appeared = outcome.get("bonusAppeared")
        rank = outcome.get("rankUp")
        if not milestones and daily is None and weekly is None and bonus is None and appeared is None and rank is None:
            return
        rank_def = self._defs["ranks"][rank] if rank is not None else None
        if self._notifications is not None and is_type_enabled("milestones", self._settings_store):
            for milestone in milestones:
                self._append_row("milestone", "Milestone Complete",
                                 {"view": "milestones", "milestoneId": milestone["id"]},
                                 {"id": milestone["id"], "category": milestone["category"],
                                  "xp": data["claims"].get(milestone["id"], {}).get("xp", milestone["xp"])})
            if appeared is not None:
                self._append_row("bonusAppeared", "Bonus Daily Quest", {"view": "milestones", "quest": "bonus"},
                                 {"id": appeared, "xp": bonus_xp(self._defs, _quest_def(self._defs, "bonus", appeared) or {})})
            titles = {"daily": "Daily Quest Complete", "bonus": "Bonus Daily Quest Complete", "weekly": "Weekly Quest Complete"}
            for period, quest_id in (("daily", daily), ("bonus", bonus), ("weekly", weekly)):
                if quest_id is None:
                    continue
                done = data[{"daily": "dailyDone", "bonus": "bonusDone", "weekly": "weeklyDone"}[period]]
                xp = 0
                for entry in done.values():
                    if entry["quest"] == quest_id:
                        xp = entry["xp"]
                self._append_row(period, titles[period], {"view": "milestones", "quest": period}, {"id": quest_id, "xp": xp})
            if rank_def is not None:
                self._append_row("rankUp", "Rank Up", {"view": "milestones", "rank": rank},
                                 {"rank": rank, "tier": rank_def["tier"], "step": rank_def["step"]})

        toasts = []
        if rank_def is not None:
            toasts.append(("Rank Up", "rank_tier_%s" % rank_def["tier"], {"numeral": _numeral(rank_def["step"])}))
        if appeared is not None:
            toasts.append(("Bonus Daily Quest", "q_%s_name" % appeared, None))
        if daily is not None:
            toasts.append(("Daily Quest Complete", "q_%s_name" % daily, None))
        if bonus is not None:
            toasts.append(("Bonus Daily Quest Complete", "q_%s_name" % bonus, None))
        if weekly is not None:
            toasts.append(("Weekly Quest Complete", "q_%s_name" % weekly, None))
        ordered = sorted(milestones, key=lambda m: m["xp"], reverse=True)
        room = MAX_TOASTS_PER_PASS - len(toasts)
        if ordered and room > 0:
            alone = ordered if len(ordered) <= room else ordered[:room - 1]
            for milestone in alone:
                toasts.append(("Milestone Complete", "ms_%s_name" % milestone["id"], None))
            rest = ordered[len(alone):]
            if rest:
                toasts.append(("{{count}} Milestones Complete", "ms_%s_name" % rest[0]["id"], {"count": len(rest)}))
        for title_key, line_key, template_vars in toasts:
            emit_notification(
                ntype="milestones",
                title_key=title_key,
                line_key=line_key,
                template_vars=template_vars,
                settings_store=self._settings_store,
                event_loop=self._event_loop,
                after_press=bool(outcome.get("afterPress")),
            )

    def _append_row(self, sub, title, target, meta):
        self._notifications.append({
            "type": "milestones",
            "kind": "actionable",
            "iconSource": "none",
            "title": title,
            "body": "",
            "source": "notifications",
            "target": target,
            "meta": dict(meta, sub=sub),
        })

    def _milestone(self, milestone_id):
        for milestone in self._defs["milestones"]:
            if milestone["id"] == milestone_id:
                return milestone
        return None

    def _emit_changed(self, ra=False):
        loop = self._event_loop
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(decky.emit(MILESTONES_EVENT, {"ra": ra}), loop)
        except Exception as exc:
            decky.logger.warning("milestones: change event failed (%s)", type(exc).__name__)

    def _run_ra_job(self, cfg, ulid, background=False):
        web_api_key = str(cfg.get("webApiKey") or "").strip()
        username = str(cfg.get("username") or "").strip()
        plugin = self._plugin
        loop = self._event_loop
        if not web_api_key or plugin is None or loop is None or self._is_in_backoff():
            return None
        data = self._store.load()
        if data is None:
            return None

        current = this_month()
        week_start = week_start_day(this_week())
        week_month = week_start[:7] if week_start else current
        started = data["startedAt"]
        since = stored_periods_start(data)
        sealed = self._store.load_sealed(started)
        through = sealed["sealedThrough"]
        wanted = months_wanted(started, current, week_start, since=since, sealed_through=through)
        saved = {}
        missing = []
        for month in wanted:
            if month == current:
                continue
            rows = self._activity_store.load_month(month)
            if rows is None:
                missing.append(month)
            else:
                saved[month] = rows
        urgent = [m for m in missing if m >= min(week_month, previous_month(current))]
        combo_month = (data["combo"]["lastDay"] or day_of(data["startedAt"]))[:7]
        rest = sorted((m for m in missing if m not in urgent), key=lambda m: (m < combo_month, m))
        to_fetch = [current] + urgent + rest[:MISSING_MONTHS_PER_JOB]
        complete = len(rest) <= MISSING_MONTHS_PER_JOB
        gaps = [m for m in rest[MISSING_MONTHS_PER_JOB:] if m >= combo_month and (through is None or m > through)]
        walk_until = add_days(min(gaps) + "-01", -1) if gaps else None

        awards = None
        awards_needed = self._awards_needed(data)
        if awards_needed and self._awards_cache_store is not None:
            minutes = max(1, to_int(self._settings_store.get_awards_list_cache_minutes(cfg), 60))
            cached = self._awards_cache_store.load(ulid, minutes * 60)
            if cached.get("hit"):
                awards = awards_from_payload(cached["payload"])
                awards_needed = False

        if background:
            plugin.wait_for_ra_quiet(self._stop_event)
            if self._stop_event.is_set():
                return None

        fetched_day = today()
        try:
            future = asyncio.run_coroutine_threadsafe(
                plugin.run_ra_call_for_trickle(
                    self._fetch_job, ulid, web_api_key, username, to_fetch, awards_needed,
                ),
                loop,
            )
            fetched, fetched_awards = future.result(timeout=RA_JOB_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as exc:
            self._handle_http_error(exc)
            return None
        except Exception as exc:
            decky.logger.warning("milestones: RA job failed: %s (%s)", type(exc).__name__, exc)
            return None
        if fetched_awards is not None:
            awards = fetched_awards

        all_months = dict(saved)
        all_months.update(fetched)
        all_months[current] = self._keep_month(ulid, current, started, fetched.get(current) or [], fetched_day,
                                                complete, walk_until, awards)
        counted_at = time.perf_counter()
        new_sealed = seal_months(sealed, all_months, started, month_of(started),
                                 live_from_month(current, week_start, since))
        facts = ra_facts(all_months, started, week_start, since=since, sealed=new_sealed)
        self._debug_log(
            "milestones: RA job months=%s fetched=%s sealed=%s unlocks=%d week=%d awards=%s counted in %dms",
            sorted(all_months), sorted(fetched), new_sealed["sealedThrough"], len(facts["ids"]), len(facts["periodRows"]),
            None if awards is None else len(awards), (time.perf_counter() - counted_at) * 1000,
        )
        facts.update(
            awards=awards,
            complete=complete,
            walkUntil=walk_until,
            fetchedMonths={m: r for m, r in fetched.items() if m != current},
            sealed=new_sealed,
            sealedChanged=new_sealed["sealedThrough"] != through,
            liveFrom=live_from_month(current, week_start, since),
        )
        return facts

    def _keep_month(self, ulid, month, started_at, rows, fetched_day, complete, walk_until, awards):
        with self._queue_lock:
            old = self._month_cache
            rows = list(rows)
            if old is not None and (old["ulid"], old["month"], old["startedAt"]) == (ulid, month, started_at):
                known = {_row_key(row) for row in rows}
                rows.extend(row for row in old["rows"] if _row_key(row) not in known)
            self._month_cache = {
                "ulid": ulid,
                "month": month,
                "startedAt": started_at,
                "rows": rows,
                "fetchedDay": fetched_day,
                "complete": complete,
                "walkUntil": walk_until,
                "awards": awards,
            }
            return list(rows)

    def _offline_facts(self, ulid):
        with self._queue_lock:
            cache = self._month_cache
            if cache is None or cache["ulid"] != ulid or cache["month"] != this_month():
                return None
            cache = dict(cache, rows=list(cache["rows"]))
        data = self._store.load()
        if data is None or data["startedAt"] != cache["startedAt"]:
            return None
        current = cache["month"]
        week_start = week_start_day(this_week())
        since = stored_periods_start(data)
        sealed = self._store.load_sealed(cache["startedAt"])
        months = {current: cache["rows"]}
        complete = cache["complete"]
        for month in months_wanted(cache["startedAt"], current, week_start, since=since,
                                   sealed_through=sealed["sealedThrough"]):
            if month == current:
                continue
            rows = self._activity_store.load_month(month)
            if rows is None:
                complete = False
            else:
                months[month] = rows
        fetched_day = cache["fetchedDay"]
        fresh = fetched_day == today()
        walk_until = cache["walkUntil"]
        if not fresh:
            walk_until = min(walk_until, fetched_day) if walk_until else fetched_day
        facts = ra_facts(months, cache["startedAt"], week_start, since=since, sealed=sealed)
        facts.update(
            awards=cache["awards"],
            complete=complete,
            walkUntil=walk_until,
            fetchedMonths={},
            offline=True,
        )
        return facts

    def _fetch_job(self, ulid, web_api_key, username, months, awards_needed):
        fetched = {}
        for month in months:
            fetched[month] = self._activity.fetch_month(ulid, web_api_key, month)
        awards = None
        if awards_needed:
            friends_service = getattr(self._plugin, "friends_service", None)
            if friends_service is not None:
                gen0 = self._awards_cache_store.current_generation() if self._awards_cache_store is not None else None
                result = friends_service.get_user_awards(web_api_key, username, ulid)
                payload = result.get("payload")
                if payload:
                    awards = awards_from_payload(payload)
                    if self._awards_cache_store is not None:
                        try:
                            self._awards_cache_store.save(ulid, payload, gen0)
                        except Exception as e:
                            decky.logger.warning("milestones: awards cache save failed: %s", type(e).__name__)
        return fetched, awards

    def _awards_needed(self, data):
        supported = self.global_buttons_supported()
        for milestone in available_milestones(self._defs, supported):
            if milestone["rule"]["type"] == "award" and milestone["id"] not in data["claims"]:
                return True
        weekly = data["weekly"]
        if weekly is not None and weekly["week"] not in data["weeklyDone"]:
            quest = _quest_def(self._defs, "weekly", weekly["quest"])
            if quest is not None and quest["rule"]["type"] == "award":
                return True
        return False

    def _handle_http_error(self, exc):
        status = getattr(exc, "code", None)
        if status == 429:
            decky.logger.warning("milestones: HTTP 429; backing off for %ss", RATE_LIMIT_BACKOFF_SECONDS)
            self._enter_backoff(RATE_LIMIT_BACKOFF_SECONDS)
        elif status == 503:
            decky.logger.warning("milestones: HTTP 503; RA looks unwell, backing off for %ss",
                                 SERVICE_UNAVAILABLE_BACKOFF_SECONDS)
            self._enter_backoff(SERVICE_UNAVAILABLE_BACKOFF_SECONDS)
        else:
            decky.logger.warning("milestones: RA job HTTP %s", status)

    def repair_combo(self):
        data = self._store.load()
        if data is None:
            return False
        combo = data["combo"]
        last = combo["lastDay"]
        if last is None or combo["length"] > 0:
            return False
        started = data["startedAt"]
        sealed = self._store.load_sealed(started)
        days = set(sealed["days"])
        month = last[:7]
        while True:
            if month >= this_month():
                return False
            rows = self._activity_store.load_month(month)
            if rows is not None:
                days |= {day_of(row["ts"]) for row in rows if row["ts"] >= started}
            elif sealed["sealedThrough"] is None or month > sealed["sealedThrough"]:
                return False
            length = rebuild_combo_length(last, days)
            if length == 0:
                return False
            before = add_days(last, -length)
            if before[:7] >= month:
                break
            month = previous_month(month)

        def change(stored):
            if stored["combo"]["lastDay"] != last or stored["combo"]["length"] > 0:
                return False
            stored["combo"]["length"] = length
            return True

        _data, result = self._store.mutate(change)
        return bool(result)
