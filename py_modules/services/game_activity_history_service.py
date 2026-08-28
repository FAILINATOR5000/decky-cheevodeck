import time
from datetime import datetime, timezone

from utils import norm_game_id


MAX_EVENTS_PER_GAME = 500


class GameActivityHistoryService:
    """Per-game activity history that outlives the rolling global feed.

    The global activity cache (``social_activity_cache.json``) is a rolling
    window — old events get purged once the file passes its size/age caps.
    For the Now Playing tab's Activity sub-tab we want a longer history,
    so this service keeps a separate per-game history that holds events
    indefinitely (until the user clears it).

    Storage is one file per game, owned by ``GameActivityHistoryStore``
    (``<ULID>/game_activity_history/<gameId>.json``). It used to be a single
    flat per-user file keyed by gameId inside; the per-game split means a
    write only touches the game it's for and a read only pulls the current
    game.

    Two write paths feed it:
      * ``record_event`` — called by the trickle service for events from
        starred friends, regardless of whether the user has opened the
        Now Playing tab for that game. This is what makes the history
        "continuous" for starred friends.
      * ``snapshot_for_game`` — called when the user opens the Now Playing
        tab for a game. Pulls every event currently in the global cache
        for that game (any friend, starred or not) and merges them in.
        This is the "on-demand" path for non-starred friends, and also
        catches up any starred-friend events that landed before this
        history existed.

    The read path (``get_events_for_game``) returns the per-game list
    sorted newest-first, capped at MAX_EVENTS_PER_GAME.

    The per-game files are wiped by ``GameActivityHistoryStore.clear_all_games``
    — reached through the ``gameActivity`` clear group and folded into the
    Clear-All sweep in main.py.
    """

    def __init__(self, *, store):
        self._store = store

    def _now(self):
        return int(time.time())

    def _now_iso(self):
        return datetime.fromtimestamp(self._now(), tz=timezone.utc).isoformat().replace("+00:00", "Z")

    def _parse_timestamp(self, value):
        text = str(value or "").strip()
        if not text:
            return None

        candidates = [text]
        if text.endswith("Z"):
            candidates.append(text[:-1] + "+00:00")
        if " " in text and "T" not in text:
            candidates.append(text.replace(" ", "T"))
            candidates.append(text.replace(" ", "T") + "+00:00")

        for candidate in candidates:
            try:
                parsed = datetime.fromisoformat(candidate)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return int(parsed.timestamp())
            except (ValueError, TypeError):
                pass

        return None

    def _event_sort_timestamp(self, event):
        timestamp = self._parse_timestamp(event.get("timestamp"))
        if timestamp is not None:
            return timestamp
        return self._parse_timestamp(event.get("discoveredAt")) or 0

    def _load_entry(self, game_id):
        raw = self._store.load_for_game(game_id)
        if not isinstance(raw, dict):
            return {"events": [], "lastWriteAt": None}

        events = raw.get("events")
        if not isinstance(events, list):
            events = []

        return {
            "events": [event for event in events if isinstance(event, dict)],
            "lastWriteAt": raw.get("lastWriteAt"),
        }

    def _normalise_events(self, events):
        kept = []
        seen_ids = set()
        for event in events or []:
            if not isinstance(event, dict):
                continue
            event_id = str(event.get("id") or "").strip()
            if not event_id or event_id in seen_ids:
                continue
            seen_ids.add(event_id)
            kept.append(event)

        kept.sort(key=self._event_sort_timestamp, reverse=True)
        return kept[:MAX_EVENTS_PER_GAME]

    def _game_key(self, game_id):
        normalised = norm_game_id(game_id)
        if normalised is None:
            return None
        return str(normalised)

    def record_event(self, event):
        """Add a single event (typically from a starred friend) to its game's file.

        Silently drops events that don't have a usable gameId or id —
        the trickle hands us well-formed events, but defensive parsing
        keeps a malformed event from poisoning the file.
        """
        if not isinstance(event, dict):
            return

        event_id = str(event.get("id") or "").strip()
        if not event_id:
            return

        game_key = self._game_key(event.get("gameId"))
        if not game_key:
            return

        with self._store.lock_for_game(game_key):
            entry = self._load_entry(game_key)
            existing = entry["events"]

            for existing_event in existing:
                if str(existing_event.get("id") or "").strip() == event_id:
                    return

            existing.append(event)
            entry["events"] = self._normalise_events(existing)
            entry["lastWriteAt"] = self._now_iso()
            self._store.save_for_game(game_key, entry)

    def snapshot_for_game(self, game_id, global_events):
        """Merge the current global feed's events for ``game_id`` into the file.

        Called when the user opens the Now Playing tab for a game.
        Catches non-starred friends (whose events never go through
        ``record_event``) and any starred-friend events that landed
        before this history existed.
        """
        game_key = self._game_key(game_id)
        if not game_key:
            return

        scoped_events = []
        for event in global_events or []:
            if not isinstance(event, dict):
                continue
            if self._game_key(event.get("gameId")) == game_key:
                scoped_events.append(event)

        if not scoped_events:
            return

        with self._store.lock_for_game(game_key):
            entry = self._load_entry(game_key)
            merged = list(entry["events"]) + scoped_events
            entry["events"] = self._normalise_events(merged)
            entry["lastWriteAt"] = self._now_iso()
            self._store.save_for_game(game_key, entry)

    def get_events_for_game(self, game_id):
        """Return the cached events for one game, newest-first, capped."""
        game_key = self._game_key(game_id)
        if not game_key:
            return []

        entry = self._load_entry(game_key)
        return self._normalise_events(entry["events"])
