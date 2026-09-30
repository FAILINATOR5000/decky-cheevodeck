import asyncio
import gzip
import io
import json
import time
import urllib.error
import urllib.request

import decky

from events_cache_store import clean_site_doc
from mixins._context import PluginContext
from ra_client import build_user_agent
from services.update_checker_service import GITHUB_OWNER, GITHUB_REPO
from utils import frontend_error, norm_game_id, to_int


EVENTS_CONSOLE_ID = 101

SITE_URL = "https://raw.githubusercontent.com/%s/%s/main/events/events.json" % (GITHUB_OWNER, GITHUB_REPO)
SITE_FETCH_TIMEOUT_SECONDS = 15
SITE_MAX_AGE_SECONDS = 24 * 60 * 60
SITE_RETRY_SECONDS = 60 * 60
SITE_MAX_WIRE_BYTES = 4 * 1024 * 1024
SITE_MAX_BYTES = 16 * 1024 * 1024

LIST_MAX_AGE_SECONDS = 60 * 60

def _read_site_bytes(ssl_context) -> bytes:
    request = urllib.request.Request(
        SITE_URL,
        headers={"User-Agent": build_user_agent(), "Accept-Encoding": "gzip"},
    )
    with urllib.request.urlopen(request, timeout=SITE_FETCH_TIMEOUT_SECONDS, context=ssl_context) as response:
        body = response.read(SITE_MAX_WIRE_BYTES + 1)
        encoding = str(response.headers.get("Content-Encoding") or "").lower()
    if len(body) > SITE_MAX_WIRE_BYTES:
        raise ValueError("oversize")
    if encoding == "gzip":
        with gzip.GzipFile(fileobj=io.BytesIO(body)) as stream:
            body = stream.read(SITE_MAX_BYTES + 1)
    if len(body) > SITE_MAX_BYTES:
        raise ValueError("oversize")
    return body


def _shape_event_list(raw, icon_url) -> list:
    events = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        game_id = norm_game_id(entry.get("ID"))
        if game_id is None or game_id <= 0:
            continue
        events.append({
            "gameId": game_id,
            "title": str(entry.get("Title") or "").strip(),
            "imageIcon": icon_url(entry.get("ImageIcon")) or "",
            "numAchievements": to_int(entry.get("NumAchievements"), 0),
        })
    return events


def _event_awards(payload) -> tuple:
    by_event_id = {}
    by_title = {}
    results = payload.get("results") if isinstance(payload, dict) else None
    for row in results if isinstance(results, list) else []:
        if not isinstance(row, dict) or str(row.get("awardType") or "").lower() != "event":
            continue
        awarded_at = row.get("awardedAt") or ""
        event_id = to_int(row.get("awardData"), 0)
        if event_id > 0:
            by_event_id[event_id] = awarded_at
        title = str(row.get("title") or "").strip().lower()
        if title:
            by_title[title] = awarded_at
    return by_event_id, by_title


class EventsMixin(PluginContext):

    async def open_events_tab(self, force: bool = False):
        cfg = self.settings_store.load_config()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        ulid = str(cfg.get("activeUlid") or "").strip()
        username = str(cfg.get("username", "")).strip()
        award_minutes = max(1, int(self.settings_store.get_awards_list_cache_minutes(cfg)))
        error = None

        async with self._events_tab_lock:
            cached_list = await asyncio.to_thread(self.events_cache_store.load_list)
            list_stale = (
                bool(force)
                or cached_list is None
                or int(time.time()) - cached_list["fetchedAt"] > LIST_MAX_AGE_SECONDS
            )
            awards_fresh = {"hit": False}
            if ulid:
                awards_fresh = await asyncio.to_thread(self.awards_list_cache_store.load, ulid, award_minutes * 60)
            awards_stale = bool(ulid) and not awards_fresh.get("hit")

            if web_api_key and (list_stale or awards_stale):
                async with self._ra_slot():
                    if list_stale:
                        list_error = await asyncio.to_thread(self._refresh_event_list, web_api_key)
                        error = error or list_error
                    if awards_stale:
                        awards_error = await asyncio.to_thread(self._refresh_self_awards, username, ulid, web_api_key)
                        error = error or awards_error

        response = await asyncio.to_thread(self._build_events_tab, ulid)
        response["error"] = error
        response["needsSettings"] = not web_api_key
        return response

    def _refresh_event_list(self, web_api_key):
        gen0 = self.events_cache_store.current_generation()
        try:
            raw = self.ra.get_game_list(EVENTS_CONSOLE_ID, web_api_key)
        except Exception as e:
            return frontend_error("Couldn't refresh the event list.", e)
        events = _shape_event_list(raw, self.icon_service.game_icon_url)
        if not events:
            return None
        try:
            self.events_cache_store.save_list(events, gen0)
        except Exception as e:
            decky.logger.warning("events: list cache save failed: %s", type(e).__name__)
        return None

    def _refresh_self_awards(self, username, ulid, web_api_key):
        gen0 = self.awards_list_cache_store.current_generation()
        result = self.friends_service.get_user_awards(web_api_key, username, ulid)
        if result.get("error") or not result.get("payload"):
            return result.get("error")
        if ulid:
            try:
                self.awards_list_cache_store.save(ulid, result["payload"], gen0)
            except Exception as e:
                decky.logger.warning("events: awards cache save failed: %s", type(e).__name__)
        return None

    def _build_events_tab(self, ulid):
        cached_list = self.events_cache_store.load_list()
        site = self.events_cache_store.load_site()["doc"] or {"events": {}}
        site_events = site["events"]

        awards = {"hit": False}
        if ulid:
            awards = self.awards_list_cache_store.load(ulid, 10 ** 9)
        by_event_id, by_title = _event_awards(awards.get("payload") if awards.get("hit") else None)

        if cached_list is not None:
            base_rows = cached_list["events"]
        else:
            base_rows = [
                {
                    "gameId": record["gameId"],
                    "title": record["title"],
                    "imageIcon": self.icon_service.game_icon_url(record["imageIcon"]) or "",
                    "numAchievements": None,
                }
                for record in site_events.values()
            ]

        events = []
        for row in base_rows:
            record = site_events.get(str(row["gameId"]))
            if record is None and (
                str(row["title"]).startswith("~Z~") or row["numAchievements"] == 0
            ):
                continue
            event_id = record["eventId"] if record else None
            if event_id is not None:
                earned_at = by_event_id.get(event_id)
            else:
                earned_at = by_title.get(str(row["title"]).strip().lower())
            events.append({
                "gameId": row["gameId"],
                "title": row["title"] or (record["title"] if record else ""),
                "imageIcon": row["imageIcon"],
                "numAchievements": row["numAchievements"],
                "hasSiteData": record is not None,
                "eventId": event_id,
                "kind": record["kind"] if record else None,
                "state": record["state"] if record else None,
                "evergreen": record["evergreen"] if record else False,
                "activeFrom": record["activeFrom"] if record else None,
                "activeThrough": record["activeThrough"] if record else None,
                "activeUntil": record["activeUntil"] if record else None,
                "createdAt": record.get("createdAt") if record else None,
                "forumTopicId": record["forumTopicId"] if record else None,
                "checklistTarget": record["checklist"]["rule"]["target"] if record and record["checklist"] else None,
                "earnedAt": earned_at,
            })

        newest_site = max((int(key) for key in site_events), default=0)
        return {
            "ok": True,
            "events": events,
            "newestSiteGameId": newest_site,
            "user": self.events_store.load(),
            "owner": ulid,
        }

    async def refresh_events_site(self):
        async with self._events_site_lock:
            now = time.time()
            fetched_at = await asyncio.to_thread(lambda: self.events_cache_store.load_site()["fetchedAt"])
            if now - fetched_at < SITE_MAX_AGE_SECONDS:
                return {"ok": True, "updated": False}
            if now - self._events_site_attempt_at < SITE_RETRY_SECONDS:
                return {"ok": True, "updated": False}
            self._events_site_attempt_at = now
            return await asyncio.to_thread(self._refresh_events_site_sync)

    def _refresh_events_site_sync(self):
        gen0 = self.events_cache_store.current_generation()
        try:
            body = _read_site_bytes(self._ssl_ctx)
            doc = clean_site_doc(json.loads(body.decode("utf-8")))
        except urllib.error.HTTPError as e:
            decky.logger.warning("events: site data fetch returned http %s", e.code)
            return {"ok": False, "updated": False}
        except Exception as e:
            decky.logger.warning("events: site data fetch failed: %s", type(e).__name__)
            return {"ok": False, "updated": False}
        if doc is None:
            decky.logger.warning("events: site data failed validation, keeping the cached copy")
            return {"ok": False, "updated": False}
        previous = self.events_cache_store.load_site()["doc"]
        try:
            saved = self.events_cache_store.save_site(doc, gen0)
        except Exception as e:
            decky.logger.warning("events: site data save failed: %s", type(e).__name__)
            return {"ok": False, "updated": False}
        changed = saved and (previous is None or previous["generatedAt"] != doc["generatedAt"])
        self._events_site_attempt_at = 0.0
        return {"ok": True, "updated": bool(changed)}

    async def get_event_detail(self, event_game_id=None):
        key = norm_game_id(event_game_id)
        if key is None:
            return {"ok": False, "error": "invalid_event"}
        return await asyncio.to_thread(self._get_event_detail_sync, key)

    def _get_event_detail_sync(self, key):
        site = self.events_cache_store.load_site()["doc"]
        record = site["events"].get(str(key)) if site else None
        if record is None:
            return {"ok": True, "event": None, "games": {}}
        wanted = [source["gameId"] for source in record["sources"].values()]
        if record["checklist"]:
            for section in record["checklist"]["sections"]:
                wanted.extend(section["gameIds"])
        games = {}
        for game_id in wanted:
            game = site["games"].get(str(game_id))
            if game is not None and str(game_id) not in games:
                games[str(game_id)] = dict(game, imageIcon=self.icon_service.game_icon_url(game["imageIcon"]) or "")
        event = dict(record, imageIcon=self.icon_service.game_icon_url(record["imageIcon"]) or "")
        return {"ok": True, "event": event, "games": games}

    async def get_checklist_progress(self, event_game_id=None, force: bool = False):
        key = norm_game_id(event_game_id)
        if key is None:
            return {"ok": False, "error": "invalid_event", "games": {}}
        cfg = self.settings_store.load_config()
        ulid = str(cfg.get("activeUlid") or "").strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        minutes = max(1, int(self.settings_store.get_games_list_cache_minutes(cfg)))

        site = await asyncio.to_thread(lambda: self.events_cache_store.load_site()["doc"])
        record = site["events"].get(str(key)) if site else None
        wanted = set()
        if record and record["checklist"]:
            for section in record["checklist"]["sections"]:
                wanted.update(section["gameIds"])
        if not wanted:
            return {"ok": True, "games": {}, "refreshedAt": None, "error": None}

        payload = None
        error = None
        if ulid and not force:
            cached = await asyncio.to_thread(self.games_list_cache_store.load, ulid, minutes * 60)
            payload = cached.get("payload") if cached.get("hit") else None
        if payload is None and ulid and web_api_key:
            requested_at = time.monotonic()
            try:
                async with self._ra_slot():
                    if not force:
                        cached = await asyncio.to_thread(self.games_list_cache_store.load, ulid, minutes * 60)
                        payload = cached.get("payload") if cached.get("hit") else None
                    if payload is None:
                        payload = await asyncio.to_thread(
                            self._walk_completion, self._active_ra_user(cfg), web_api_key,
                            None, True, requested_at,
                        )
            except Exception as e:
                error = frontend_error("Couldn't refresh your game progress.", e)
        if payload is None and ulid:
            stale = await asyncio.to_thread(self.games_list_cache_store.load, ulid, 10 ** 9)
            payload = stale.get("payload") if stale.get("hit") else None

        games = {}
        for row in (payload or {}).get("results") or []:
            game_id = norm_game_id(row.get("gameId"))
            if game_id not in wanted:
                continue
            games[str(game_id)] = {
                "numAwarded": to_int(row.get("numAwarded"), 0),
                "numAwardedHardcore": to_int(row.get("numAwardedHardcore"), 0),
                "maxPossible": to_int(row.get("maxPossible"), 0),
                "highestAwardKind": row.get("highestAwardKind"),
                "highestAwardDate": row.get("highestAwardDate"),
            }
        return {
            "ok": True,
            "games": games,
            "refreshedAt": (payload or {}).get("refreshedAt"),
            "error": error,
        }

    async def save_show_a_button_mode_events(self, show_a_button_mode_events: bool):
        value = self.settings_store.update_show_a_button_mode_events(show_a_button_mode_events)
        return {"ok": True, "showAButtonModeEvents": value}

    async def save_events_click_action(self, events_click_action: str):
        value = self.settings_store.update_events_click_action(events_click_action)
        return {"ok": True, "eventsClickAction": value}

    async def save_tracked_events_click_action(self, tracked_events_click_action: str):
        value = self.settings_store.update_tracked_events_click_action(tracked_events_click_action)
        return {"ok": True, "trackedEventsClickAction": value}

    async def save_tracked_events_header_style(self, tracked_events_header_style: str):
        value = self.settings_store.update_tracked_events_header_style(tracked_events_header_style)
        return {"ok": True, "trackedEventsHeaderStyle": value}

    async def toggle_tracked_event(self, ulid="", event_game_id=None):
        return await asyncio.to_thread(self.events_store.toggle_tracked, ulid, event_game_id)

    async def save_tracked_event_order(self, ulid="", order=None):
        return await asyncio.to_thread(self.events_store.save_order, ulid, order)

    async def save_tracked_event_note(self, ulid="", event_game_id=None, note="", color="default"):
        return await asyncio.to_thread(self.events_store.save_note, ulid, event_game_id, note, color)

    async def bulk_tag_tracked_events(self, ulid="", event_game_ids=None, tag=""):
        return await asyncio.to_thread(self.events_store.bulk_tag, ulid, event_game_ids, tag)

    async def save_tracked_events_collapsed_tags(self, ulid="", keys=None):
        return await asyncio.to_thread(self.events_store.save_collapsed, ulid, keys)

    async def save_events_prefs(self, ulid="", prefs=None):
        return await asyncio.to_thread(self.events_store.save_prefs, ulid, prefs)

    async def set_event_completed(self, ulid="", event_game_id=None, completed=False):
        return await asyncio.to_thread(self.events_store.set_completed, ulid, event_game_id, bool(completed))

    async def set_checklist_tick(self, ulid="", event_game_id=None, game_id=None, value=None):
        return await asyncio.to_thread(self.events_store.set_checklist_tick, ulid, event_game_id, game_id, value)

    async def save_checklist_view(self, ulid="", event_game_id=None, view="", filter_value=""):
        return await asyncio.to_thread(self.events_store.save_checklist_view, ulid, event_game_id, view, filter_value)

    async def touch_event_opened(self, ulid="", event_game_id=None, progress=None):
        return await asyncio.to_thread(self.events_store.touch_opened, ulid, event_game_id, progress)
