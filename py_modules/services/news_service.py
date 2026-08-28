import email.utils
import re
import time
from datetime import timezone

import decky

from utils import frontend_error


class NewsService:
    """Fetches and caches the RetroAchievements news feed.

    Source is the public RSS feed at /rss-news. We pull a small fixed
    number of entries (the feed itself returns 20), normalise the
    fields the frontend cares about, and keep a 1-hour TTL on disk so
    the News tab feels instant the second time it's opened. The news
    feed is blog-cadence -- new posts arrive infrequently -- so an
    hour-long cache window doesn't really make stale content visible.

    No thumbnails: the RSS feed doesn't carry them. Each news card
    on the frontend uses a static newspaper SVG instead. Clicking a
    card sends the user to the article on retroachievements.org
    where the real images live.
    """

    _RSS_URL = "https://retroachievements.org/rss-news"
    _MAX_ENTRIES = 20
    _CACHE_TTL_SECONDS = 60 * 60

    _ITEM_RE = re.compile(r"<item\b[^>]*>(.*?)</item>", re.DOTALL | re.IGNORECASE)
    _TAG_PATTERNS = {
        "title":       re.compile(r"<title\b[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))</title>", re.DOTALL | re.IGNORECASE),
        "link":        re.compile(r"<link\b[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))</link>", re.DOTALL | re.IGNORECASE),
        "description": re.compile(r"<description\b[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))</description>", re.DOTALL | re.IGNORECASE),
        "pubDate":     re.compile(r"<pubDate\b[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))</pubDate>", re.DOTALL | re.IGNORECASE),
        "guid":        re.compile(r"<guid\b[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))</guid>", re.DOTALL | re.IGNORECASE),
    }

    def __init__(self, *, ra, cache_store):
        self._ra = ra
        self._cache_store = cache_store

    def _parse_published_at(self, raw_pub_date):
        text = (raw_pub_date or "").strip()
        if not text:
            return None
        try:
            dt = email.utils.parsedate_to_datetime(text)
            if dt is None:
                return None
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            return None

    def _parse_news_id(self, raw_guid):
        text = (raw_guid or "").strip()
        if not text:
            return None
        try:
            return int(text.rsplit(":", 1)[-1])
        except (ValueError, IndexError):
            return None

    def _extract_tag(self, item_xml: str, tag_name: str) -> str:
        pattern = self._TAG_PATTERNS.get(tag_name)
        if pattern is None:
            return ""
        match = pattern.search(item_xml)
        if match is None:
            return ""
        return (match.group(1) or match.group(2) or "").strip()

    def _parse_rss_entries(self, xml_text: str) -> list:
        entries = []
        for item_match in self._ITEM_RE.finditer(xml_text or ""):
            item_xml = item_match.group(1)

            title = self._extract_tag(item_xml, "title")
            link = self._extract_tag(item_xml, "link")
            summary = self._extract_tag(item_xml, "description")
            published_at = self._parse_published_at(self._extract_tag(item_xml, "pubDate"))
            news_id = self._parse_news_id(self._extract_tag(item_xml, "guid"))

            if not title or not link:
                continue

            entries.append({
                "id": news_id,
                "title": title,
                "link": link,
                "summary": summary,
                "publishedAt": published_at,
            })

            if len(entries) >= self._MAX_ENTRIES:
                break

        return entries

    def _cache_is_fresh(self, cached_meta) -> bool:
        refreshed_at = cached_meta.get("refreshedAt") if isinstance(cached_meta, dict) else None
        try:
            refreshed_at = int(refreshed_at) if refreshed_at is not None else 0
        except (ValueError, TypeError, OverflowError):
            refreshed_at = 0
        if refreshed_at <= 0:
            return False
        return (int(time.time()) - refreshed_at) < self._CACHE_TTL_SECONDS

    def get_news_feed(self) -> dict:
        """Return the news feed, hitting cache when it's still fresh.

        Returns {"payload": [...], "fromCache": bool} on success,
        or a dict with an "error" key (and stale payload if we have
        one) on network failure.
        """
        cached_wrapper = self._cache_store.load_news()
        cached_payload = cached_wrapper.get("payload")
        cached_meta = cached_wrapper.get("meta", {})

        if isinstance(cached_payload, list) and self._cache_is_fresh(cached_meta):
            return {
                "payload": cached_payload,
                "fromCache": True,
            }

        try:
            xml_text = self._ra.get_rss_text(self._RSS_URL)
            entries = self._parse_rss_entries(xml_text)

            with self._cache_store.news_lock():
                self._cache_store.save_news(
                    entries,
                    {"refreshedAt": int(time.time())},
                )

            return {
                "payload": entries,
                "fromCache": False,
            }
        except Exception as e:
            decky.logger.warning("news_service: fetch failed: %s", e)
            return {
                "payload": cached_payload if isinstance(cached_payload, list) else [],
                "fromCache": True,
                "error": frontend_error("Couldn't load the news feed right now.", e),
            }
