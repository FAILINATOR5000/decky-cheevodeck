import time

import decky
from utils import WalkBusy, WalkYieldedForClear, to_int

from mixins._context import PluginContext


class CompletionWalkMixin(PluginContext):
    def _walk_completion(self, user: str, web_api_key: str, abort_check=None, wait_for_walk=True, requested_at=None) -> dict:
        if requested_at is None:
            requested_at = time.monotonic()
        if not self._completion_walk_lock.acquire(blocking=wait_for_walk):
            raise WalkBusy()
        try:
            last = self._last_completion_walk
            if last is not None and last[0] == user and last[1] >= requested_at:
                return last[2]

            gen0 = self.games_list_cache_store.current_generation()
            started_at = time.monotonic()
            rows, truncated = self._gather_completion_progress(user, web_api_key, abort_check=abort_check)
            payload = self.friends_service.build_friend_all_games_payload(user, rows)
            self._feed_games_list_cache(user, payload, truncated, gen0)
            self._last_completion_walk = None if truncated else (user, started_at, payload)
            return payload
        finally:
            self._completion_walk_lock.release()

    def _completion_results(self, user: str, web_api_key: str, abort_check=None, wait_for_walk=True) -> dict:
        payload = self._walk_completion(user, web_api_key, abort_check=abort_check, wait_for_walk=wait_for_walk)
        results = {}
        for row in payload.get("results") or []:
            game_id = to_int(row.get("gameId"), 0)
            if game_id <= 0:
                continue
            results[str(game_id)] = {
                "numAwarded": to_int(row.get("numAwarded"), 0),
                "maxPossible": to_int(row.get("maxPossible"), 0),
                "highestAward": row.get("highestAwardKind"),
            }
        return results

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
        truncated = False
        while True:
            if abort_check is not None and abort_check():
                raise WalkYieldedForClear()
            payload = self.ra.get_user_completion_progress(
                user,
                web_api_key,
                count=page_size,
                offset=offset,
            )
            results = (payload or {}).get("Results", []) if isinstance(payload, dict) else []
            if not isinstance(results, list) or not results:
                break
            rows.extend(results)
            if len(results) < page_size:
                break
            offset += page_size
            if offset >= page_size * 20:
                truncated = True
                break
        return rows, truncated
