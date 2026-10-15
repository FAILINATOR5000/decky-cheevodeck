import decky

from activity_store import clean_rows
from local_days import day_of, month_bounds, this_month
from services.friends_service import _parse_ra_utc_timestamp
from utils import norm_game_id, to_int


RA_PAGE_SIZE = 500

MAX_PAGES_PER_MONTH = 40


def normalize_ra_rows(raw):
    out = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        ts = _parse_ra_utc_timestamp(item.get("Date"))
        out.append({
            "achievementId": to_int(item.get("AchievementID"), 0),
            "gameId": norm_game_id(item.get("GameID")) or 0,
            "gameTitle": item.get("GameTitle"),
            "consoleName": item.get("ConsoleName"),
            "title": item.get("Title"),
            "description": item.get("Description"),
            "points": item.get("Points"),
            "badgeName": item.get("BadgeName"),
            "hardcore": to_int(item.get("HardcoreMode"), 0) == 1,
            "ts": ts or 0,
        })
    return clean_rows(out)


def _row_key(row):
    return (row["achievementId"], row["ts"], row["hardcore"])


def unique_unlocks(rows):
    best = {}
    hardcore = set()
    for row in rows:
        achievement_id = row["achievementId"]
        if row["hardcore"]:
            hardcore.add(achievement_id)
        current = best.get(achievement_id)
        if current is None or row["ts"] < current["ts"]:
            best[achievement_id] = row
    out = []
    for achievement_id, row in best.items():
        if achievement_id in hardcore and not row["hardcore"]:
            row = dict(row, hardcore=True)
        out.append(row)
    out.sort(key=lambda row: (row["ts"], row["achievementId"]))
    return out


def day_counts(rows):
    seen = set()
    counts = {}
    for row in rows:
        day = day_of(row["ts"])
        key = (day, row["achievementId"])
        if key in seen:
            continue
        seen.add(key)
        counts[day] = counts.get(day, 0) + 1
    return counts


def quartiles(counts):
    values = sorted(count for count in counts.values() if count > 0)
    if not values:
        return [0, 0, 0]
    out = []
    for percent in (25, 50, 75):
        rank = max(1, -(-percent * len(values) // 100))
        out.append(values[rank - 1])
    return out


class ActivityService:
    def __init__(self, *, ra, activity_store):
        self._ra = ra
        self._store = activity_store

    def fetch_month(self, ra_user, web_api_key, month):
        bounds = month_bounds(month)
        if bounds is None:
            return []
        start, end = bounds
        rows = []
        seen = set()
        cursor = start
        for _page in range(MAX_PAGES_PER_MONTH):
            raw = self._ra.get_achievements_earned_between(ra_user, web_api_key, cursor, end - 1)
            if not isinstance(raw, list):
                raise ValueError("RA sent %s instead of a list of unlocks" % type(raw).__name__)
            page = normalize_ra_rows(raw)
            fresh = 0
            for row in page:
                key = _row_key(row)
                if key in seen or not start <= row["ts"] < end:
                    continue
                seen.add(key)
                rows.append(row)
                fresh += 1
            if len(raw) < RA_PAGE_SIZE or not page:
                break
            last = max(row["ts"] for row in page)
            if fresh == 0 or last <= cursor:
                break
            cursor = last
        else:
            decky.logger.warning("activity: %s still had more after %d pages, showing what came", month, MAX_PAGES_PER_MONTH)
        rows.sort(key=lambda row: (row["ts"], row["achievementId"]))
        return rows

    def is_finished(self, month):
        return month < this_month()

    def saved_month(self, month):
        return self._store.load_month(month)

    def save_month(self, month, rows):
        if self.is_finished(month):
            self._store.save_month(month, rows)

    def month(self, ra_user, web_api_key, month, *, own, force=False):
        if own and self.is_finished(month) and not force:
            saved = self._store.load_month(month)
            if saved is not None:
                return saved, True
        return self.fetch_month(ra_user, web_api_key, month), False
