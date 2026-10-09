import asyncio
import time

import decky
from utils import WalkBusy, WalkYieldedForClear, to_int

from mixins._context import PluginContext


COMPLETION_WALK_MAX_PAGES = 40


class CompletionWalkMixin(PluginContext):
    def _walk_completion(self, user: str, web_api_key: str, abort_check=None, wait_for_walk=True, requested_at=None) -> dict:
        return self._walk_library(user, web_api_key, abort_check, wait_for_walk, requested_at)[0]

    def _walk_library(self, user: str, web_api_key: str, abort_check=None, wait_for_walk=True, requested_at=None) -> tuple:
        if requested_at is None:
            requested_at = time.monotonic()
        if not self._completion_walk_lock.acquire(blocking=wait_for_walk):
            raise WalkBusy()
        try:
            gen0 = self.games_list_cache_store.current_generation()

            requested_wall = int(time.time() - (time.monotonic() - requested_at))
            last = self._last_completion_walk
            if (
                last is not None
                and last[0] == user
                and last[1] >= requested_at
                and to_int(last[2].get("refreshedAt"), 0) >= requested_wall
                and last[3] == gen0
            ):
                return last[2], False

            started_at = time.monotonic()
            as_of = int(time.time())
            rows, total, truncated = self._gather_completion_progress(user, web_api_key, abort_check=abort_check)
            payload = self.friends_service.build_friend_all_games_payload(user, rows, total=total)
            payload["refreshedAt"] = as_of
            if total is not None and payload["count"] < total:
                truncated = True
            self._feed_games_list_cache(user, payload, truncated, gen0)
            self._last_completion_walk = None if truncated else (user, started_at, payload, gen0)
            return payload, truncated
        finally:
            self._completion_walk_lock.release()

    def _completion_results(self, user: str, web_api_key: str, abort_check=None, wait_for_walk=True, requested_at=None) -> tuple:
        payload, truncated = self._walk_library(user, web_api_key, abort_check, wait_for_walk, requested_at)
        return self._results_from_payload(payload), to_int(payload.get("refreshedAt"), 0), not truncated

    def _results_from_payload(self, payload) -> dict:
        results = {}
        for row in payload.get("results") or []:
            game_id = to_int(row.get("gameId"), 0)
            if game_id <= 0:
                continue
            results[str(game_id)] = {
                "numAwarded": to_int(row.get("numAwarded"), 0),
                "maxPossible": to_int(row.get("maxPossible"), 0),
                "highestAward": row.get("highestAwardKind"),
                "title": row.get("title"),
            }
        return results

    def _usable_games_payload(self, payload) -> bool:
        if not isinstance(payload, dict):
            return False
        results = payload.get("results")
        if not isinstance(results, list) or not results:
            return False
        if to_int(payload.get("refreshedAt"), 0) <= 0:
            return False
        return to_int(payload.get("count"), len(results)) >= to_int(payload.get("total"), 0)

    async def _cached_completion_results(self, cfg: dict, web_api_key: str) -> tuple:
        ulid = str(cfg.get("activeUlid") or "").strip()
        window = max(1, int(self.settings_store.get_games_list_cache_minutes(cfg))) * 60

        if ulid:
            cached = await asyncio.to_thread(self.games_list_cache_store.load, ulid, window)
            if cached.get("hit") and self._usable_games_payload(cached["payload"]):
                payload = cached["payload"]
                return self._results_from_payload(payload), to_int(payload.get("refreshedAt"), 0), True

        async with self._ra_slot():
            if ulid:
                cached = await asyncio.to_thread(self.games_list_cache_store.load, ulid, window)
                if cached.get("hit") and self._usable_games_payload(cached["payload"]):
                    payload = cached["payload"]
                    return self._results_from_payload(payload), to_int(payload.get("refreshedAt"), 0), True
            return await asyncio.to_thread(
                self._completion_results,
                self._active_ra_user(cfg),
                web_api_key,
                None,
                True,
                time.monotonic() - window,
            )

    def _feed_games_list_cache(self, user, payload, truncated, gen0):
        if truncated:
            if bool(getattr(self, "_debug_logging", False)):
                decky.logger.info(
                    "tracked sets monitor: walk hit the page safety stop, skipping the games-list cache feed"
                )
            return
        if not payload.get("results"):
            return
        try:
            self.games_list_cache_store.save(user, payload, gen0)
        except Exception as e:
            decky.logger.warning("tracked sets games-list cache feed failed: %s", type(e).__name__)
        if bool(getattr(self, "_debug_logging", False)):
            decky.logger.info(
                "tracked sets monitor: games-list cache fed off the walk (%d games)",
                len(payload["results"]),
            )

    def _gather_completion_progress(self, user: str, web_api_key: str, abort_check=None) -> tuple:
        page_size = 500
        offset = 0
        rows = []
        total = None
        pages = 0
        cut_short = False
        while True:
            if abort_check is not None and abort_check():
                raise WalkYieldedForClear()
            payload = self.ra.get_user_completion_progress(
                user,
                web_api_key,
                count=page_size,
                offset=offset,
            )
            results = payload.get("Results") if isinstance(payload, dict) else None
            if pages == 0:
                if not isinstance(results, list):
                    raise ValueError("completion progress page 1 came back malformed")
                if payload.get("Total") is not None:
                    total = to_int(payload.get("Total"), 0)
            elif not isinstance(results, list):
                results = []
                cut_short = True
            pages += 1
            rows.extend(results)
            if len(results) < page_size:
                break
            offset += page_size
            if pages >= COMPLETION_WALK_MAX_PAGES:
                cut_short = True
                break
        truncated = cut_short or (total is not None and len(rows) < total)
        return rows, total, truncated
