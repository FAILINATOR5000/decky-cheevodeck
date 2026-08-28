import asyncio
import socket
import time

from mixins._context import PluginContext


class GuidesMixin(PluginContext):

    async def load_game_guides(self, game_id=None):
        return self.guides_store.get_game_guides(game_id)

    async def save_guide_mapping(
        self,
        game_id=None,
        platform_slug: str = "",
        game_url: str = "",
        product_name: str = "",
    ):
        return self.guides_store.save_mapping(game_id, platform_slug, game_url, product_name)

    async def save_guide_type_filter(self, game_id=None, value: str = "all"):
        return self.guides_store.save_type_filter(game_id, value)

    async def clear_guide_mapping(self, game_id=None):
        return self.guides_store.clear_mapping(game_id)

    async def upsert_guide_meta(
        self,
        game_id=None,
        faq_id: str = "",
        title: str = "",
        author: str = "",
        type: str = "",
        version: str = "",
        kind: str = "",
    ):
        return self.guides_store.upsert_guide_meta(
            game_id,
            faq_id,
            title=title,
            author=author,
            type=type,
            version=version,
            kind=kind,
        )

    async def save_guide_position(
        self,
        game_id=None,
        faq_id: str = "",
        last_page=0,
        last_anchor: str = "",
        last_scroll=0.0,
        page_count=0,
        kind: str = "",
    ):
        return self.guides_store.save_position(
            game_id,
            faq_id,
            last_page=last_page,
            last_anchor=last_anchor,
            last_scroll=last_scroll,
            page_count=page_count,
            kind=kind,
        )

    async def add_guide_bookmark(
        self,
        game_id=None,
        faq_id: str = "",
        name: str = "",
        page=0,
        anchor: str = "",
        scroll=0.0,
    ):
        return self.guides_store.add_bookmark(
            game_id,
            faq_id,
            name,
            page=page,
            anchor=anchor,
            scroll=scroll,
        )

    async def remove_guide_bookmark(self, game_id=None, faq_id: str = "", bookmark_id: str = ""):
        return self.guides_store.remove_bookmark(game_id, faq_id, bookmark_id)

    async def rename_guide_bookmark(self, game_id=None, faq_id: str = "", bookmark_id: str = "", name: str = ""):
        return self.guides_store.rename_bookmark(game_id, faq_id, bookmark_id, name)

    def _guides_frozen(self) -> bool:
        return self.settings_store.get_keep_guides_offline(self.settings_store.load_config())

    def _restart_guide_clock_if_thawed(self, was_frozen: bool) -> None:
        """Call after anything that might have turned the freeze off.

        While Truly Offline Guides is on nothing rewrites an mtime, so the whole
        cache ages in place and un-freezing hands every file at once to a sweep
        that deletes anything past thirty days. Stamping them to now gives the
        user a clean thirty days of normal policy instead of a cliff.

        There are three doors into that transition, not one: the toggle itself,
        Reset Settings, and a setup-profile commit with preserve off. The first
        is the obvious one and the other two are the ones that get missed, which
        is why the check lives in a method rather than at the toggle.
        """
        if was_frozen and not self._guides_frozen():
            self.guides_store.touch_cache()

    async def get_cached_guide_page(self, game_id=None, faq_id: str = "", page: str = "0", allow_stale: bool = False):
        return self.guides_store.get_cached_guide_page(game_id, faq_id, page, bool(allow_stale), self._guides_frozen())

    async def save_cached_guide_page(self, game_id=None, faq_id: str = "", html: str = "", page: str = "0", section_slugs=None):
        return self.guides_store.save_cached_guide_page(game_id, faq_id, html, page, section_slugs)

    async def begin_guide_revalidate(self, game_id=None, faq_id: str = "", page: str = "0"):
        if self._guides_frozen():
            return {"ok": True, "allowed": False, "generation": 0, "why": "offline-guides-on"}
        return self.guides_store.begin_revalidate(game_id, faq_id, page)

    async def finish_guide_revalidate(self, game_id=None, faq_id: str = "", html: str = "", page: str = "0", generation: int = -1, section_slugs=None):
        return self.guides_store.finish_revalidate(game_id, faq_id, html, page, generation, section_slugs)

    async def get_cached_guide_list(self, game_id=None, allow_stale: bool = False):
        return self.guides_store.get_cached_faqlist(game_id, bool(allow_stale), self._guides_frozen())

    async def save_cached_guide_list(self, game_id=None, entries=None):
        if entries is None:
            entries = []
        return self.guides_store.save_cached_faqlist(game_id, entries)

    async def prune_guide_cache_to(self, game_id=None, faq_id: str = "", pages=None):
        if pages is None:
            pages = []
        return self.guides_store.prune_guide_to(game_id, faq_id, pages)

    async def get_cached_guide_pages(self, game_id=None, faq_id: str = "", pages=None):
        if pages is None:
            pages = []
        return self.guides_store.cached_guide_pages(game_id, faq_id, pages)

    async def get_offline_guides(self, game_id=None):
        cfg = self.settings_store.load_config()
        if not self.settings_store.get_keep_guides_offline(cfg):
            return {"ok": True, "guides": []}
        return self.guides_store.offline_guides(game_id)

    async def clear_guide_cache(self):
        return self.guides_store.clear_cache()

    async def clear_all_guide_data(self):
        return self.guides_store.clear_all_guide_data()

    async def probe_gamefaqs_reachable(self, timeout: float = 4.0):
        return await asyncio.to_thread(self._probe_gamefaqs_sync, timeout)

    _PROBE_DEFINITIVE_MS = 1500

    def _probe_gamefaqs_sync(self, timeout: float):
        started = time.monotonic()
        try:
            with socket.create_connection(("gamefaqs.gamespot.com", 443), timeout=timeout):
                return {"ok": True, "reachable": True}
        except socket.timeout:
            return {"ok": True, "reachable": None, "why": "timeout"}
        except OSError as e:
            waited = (time.monotonic() - started) * 1000
            if waited > self._PROBE_DEFINITIVE_MS:
                return {"ok": True, "reachable": None, "why": f"slow failure after {int(waited)}ms: {e}"}
            return {"ok": True, "reachable": False, "why": str(e)}
