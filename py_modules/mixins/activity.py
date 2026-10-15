import asyncio
import re

from local_days import day_of, is_month, this_month, today
from mixins._context import PluginContext
from services.activity_service import day_counts, quartiles
from utils import frontend_error


_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def _display_rows(rows):
    best = {}
    for row in rows:
        day = day_of(row["ts"])
        key = (day, row["achievementId"])
        current = best.get(key)
        if current is None or (row["hardcore"] and not current["hardcore"]):
            best[key] = dict(row, day=day)
    return sorted(best.values(), key=lambda row: (row["ts"], row["achievementId"]), reverse=True)


class ActivityMixin(PluginContext):

    async def get_activity_month(self, ulid="", month="", force=False, saved_only=False):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        active = str(cfg.get("activeUlid") or "").strip()
        subject = str(ulid or "").strip().upper()
        if not _ULID_RE.match(subject):
            return {"ok": False, "error": "Couldn't load this month's activity."}
        if not is_month(month) or month > this_month():
            month = this_month()
        own = subject == active

        rows = None
        from_cache = False
        if own and not force and month < this_month():
            rows = await asyncio.to_thread(self.activity_service.saved_month, month)
            from_cache = rows is not None
        if rows is None and saved_only:
            return {"ok": False, "notSaved": True}
        if rows is None:
            if not web_api_key:
                return {"ok": False, "needsSettings": True}
            finished = month < this_month()
            try:
                async with self._ra_slot():
                    rows = await asyncio.to_thread(self.activity_service.fetch_month, subject, web_api_key, month)
            except Exception as e:
                return {"ok": False, "error": frontend_error("Couldn't load this month's activity.", e)}
            if own and finished:
                await asyncio.to_thread(self._save_own_month, subject, month, rows)

        counts = day_counts(rows)
        return {
            "ok": True,
            "ulid": subject,
            "month": month,
            "today": today(),
            "currentMonth": this_month(),
            "rows": _display_rows(rows),
            "dayCounts": counts,
            "quartiles": quartiles(counts),
            "fromCache": from_cache,
        }

    def _save_own_month(self, ulid, month, rows):
        with self._account_switch_lock:
            if str(self.settings_store.load_config().get("activeUlid") or "") == ulid:
                self.activity_service.save_month(month, rows)

    async def save_activity_cache_months(self, activity_cache_months: int = 60):
        value = self.settings_store.update_activity_cache_months(activity_cache_months)
        self.milestones_service.activity_cache_changed()
        return {"ok": True, "activityCacheMonths": value}

    async def clear_activity_cache(self):
        removed = await asyncio.to_thread(self.activity_store.clear)
        await asyncio.to_thread(self.milestones_service.activity_cache_cleared)
        return {"ok": True, "removed": removed}
