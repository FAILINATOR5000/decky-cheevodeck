import asyncio
import time
from utils import norm_game_id

from mixins._context import PluginContext


class CommentsMixin(PluginContext):

    async def save_comments_service_tick_minutes(self, comments_service_tick_minutes: int):
        value = self.settings_store.update_comments_service_tick_minutes(comments_service_tick_minutes)

        return {
            "ok": True,
            "commentsServiceTickMinutes": value,
        }

    async def save_comments_service_fetch_amount(self, comments_service_fetch_amount: int):
        value = self.settings_store.update_comments_service_fetch_amount(comments_service_fetch_amount)

        return {
            "ok": True,
            "commentsServiceFetchAmount": value,
        }

    async def save_comments_service_wall_check(self, comments_service_wall_check: bool):
        value = self.settings_store.update_comments_service_wall_check(comments_service_wall_check)

        return {
            "ok": True,
            "commentsServiceWallCheck": value,
        }

    async def get_subscriptions(self):
        return self.subscriptions_store.list_all()

    async def add_subscription(self, entry=None):
        if entry is None:
            entry = {}
        result = self.subscriptions_store.add(entry)
        if result.get("ok") and not result.get("alreadySubscribed"):
            subscription = result.get("subscription") or {}
            section_key_value = subscription.get("key")
            if section_key_value:
                seed_comments = entry.get("seedComments") if isinstance(entry, dict) else None
                seed_sort = str(entry.get("seedSort") or "") if isinstance(entry, dict) else ""
                seed_loaded = bool(entry.get("seedLoaded")) if isinstance(entry, dict) else False
                self.comments_service.seed_baseline_if_unseen(
                    section_key_value,
                    seed_comments or [],
                    trusted=(seed_loaded and (seed_sort == "newest" or not seed_comments)),
                    sort=seed_sort,
                )
        return result

    async def remove_subscription(self, kind: str = "", target_id=None):
        result = self.subscriptions_store.remove(kind, target_id)
        if isinstance(result, dict) and result.get("ok") and result.get("key"):
            self.comment_baselines_store.remove(result["key"])
        return result

    async def get_saved_comment_keys(self):
        return self.saved_comments_store.list_keys()

    async def get_saved_comments(self):
        return self.saved_comments_store.list_all()

    async def save_comment(self, record=None):
        if record is None:
            record = {}
        return self.saved_comments_store.add(record)

    async def unsave_comment(self, comment_id=""):
        return self.saved_comments_store.remove(comment_id)

    async def touch_saved_comment_opened(self, comment_id=""):
        return self.saved_comments_store.touch_opened(comment_id)

    async def clear_saved_comments(self):
        return self.saved_comments_store.clear()

    def _is_cacheable_comments_result(self, result):
        if not isinstance(result, dict):
            return False
        if result.get("needsSettings"):
            return False
        if result.get("error"):
            return False
        return True

    def _comments_cache_get(self, key):
        now = time.monotonic()
        with self._comments_cache_lock:
            entry = self._comments_cache.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at <= now:
                return None
            return value

    def _comments_cache_put(self, key, value):
        now = time.monotonic()
        expires_at = now + self.COMMENTS_CACHE_TTL_SECONDS
        with self._comments_cache_lock:
            stale = [k for k, (exp, _) in self._comments_cache.items() if exp <= now]
            for k in stale:
                del self._comments_cache[k]
            self._comments_cache[key] = (expires_at, value)
            while len(self._comments_cache) > self.COMMENTS_CACHE_MAX_ENTRIES:
                soonest = min(self._comments_cache, key=lambda k: self._comments_cache[k][0])
                del self._comments_cache[soonest]

    async def get_game_comments(self, game_id, sort: str = "newest", offset: int = 0, count: int = 10):
        async with self._ra_slot():
            return await asyncio.to_thread(
                self._get_game_comments_sync, game_id, sort, offset, count
            )

    def _get_game_comments_sync(self, game_id, sort, offset, count):
        cfg = self.settings_store.load_config()
        username = str(cfg.get("username", "")).strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()

        if not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "comments": [],
                "avatars": {},
                "total": None,
            }

        cache_key = f"game:{norm_game_id(game_id)}:{sort}:{offset}:{count}"
        cached = self._comments_cache_get(cache_key)
        if cached is not None:
            return cached

        result = self.game_comments_service.get_game_comments(
            username, web_api_key, game_id, sort, offset, count,
        )
        if self._is_cacheable_comments_result(result):
            self._comments_cache_put(cache_key, result)
        return result

    async def get_achievement_comments(self, achievement_id, sort: str = "newest", offset: int = 0, count: int = 10):
        async with self._ra_slot():
            return await asyncio.to_thread(
                self._get_achievement_comments_sync, achievement_id, sort, offset, count
            )

    def _get_achievement_comments_sync(self, achievement_id, sort, offset, count):
        cfg = self.settings_store.load_config()
        username = str(cfg.get("username", "")).strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()

        if not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "comments": [],
                "avatars": {},
                "total": None,
            }

        cache_key = f"ach:{achievement_id}:{sort}:{offset}:{count}"
        cached = self._comments_cache_get(cache_key)
        if cached is not None:
            return cached

        result = self.game_comments_service.get_achievement_comments(
            username, web_api_key, achievement_id, sort, offset, count,
        )
        if self._is_cacheable_comments_result(result):
            self._comments_cache_put(cache_key, result)
        return result

    async def get_user_comments(self, target_username, sort: str = "newest", offset: int = 0, count: int = 10):
        async with self._ra_slot():
            return await asyncio.to_thread(
                self._get_user_comments_sync, target_username, sort, offset, count
            )

    def _get_user_comments_sync(self, target_username, sort, offset, count):
        cfg = self.settings_store.load_config()
        username = str(cfg.get("username", "")).strip()
        web_api_key = str(cfg.get("webApiKey", "")).strip()
        target_username = str(target_username or "").strip()

        if not web_api_key:
            return {
                "needsSettings": True,
                "error": "Please enter your RetroAchievements username and Web API key.",
                "comments": [],
                "avatars": {},
                "total": None,
            }

        cache_key = f"wall:{target_username.lower()}:{sort}:{offset}:{count}"
        cached = self._comments_cache_get(cache_key)
        if cached is not None:
            return cached

        result = self.game_comments_service.get_user_comments(
            username, web_api_key, target_username, sort, offset, count,
        )
        if self._is_cacheable_comments_result(result):
            self._comments_cache_put(cache_key, result)
        return result
