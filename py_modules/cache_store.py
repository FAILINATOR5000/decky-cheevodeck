import hashlib
import string
import threading
import time
from pathlib import Path

from utils import ensure_dir, load_json_file, norm_game_id, save_json_file, to_int

_SAFE_CACHE_NAME_CHARS = frozenset(string.ascii_lowercase + string.digits + "_-")


class CacheStore:
    """Owns all cache file I/O for the plugin.

    Each feature gets a named load/save pair so callers never hold raw
    file paths and the cache layout is one place to change.
    """

    def __init__(
        self,
        *,
        cache_file: Path,
        friends_cache_file: Path,
        friend_games_dir: Path,
        friend_game_payloads_dir: Path,
        game_icons_dir: Path,
        leaderboards_cache_file: Path,
        leaderboard_icons_cache_file: Path,
        social_activity_cache_file: Path,
        news_cache_file: Path,
        aotw_cache_file: Path,
        new_sets_cache_file: Path,
        user_avatars_dir: Path,
        award_icons_dir: Path,
        sets_list_cache_file: Path,
        stale_full_refresh_seconds: int,
    ):
        self._cache_file = cache_file
        self._friends_cache_file = friends_cache_file
        self._friend_games_dir = friend_games_dir
        self._friend_game_payloads_dir = friend_game_payloads_dir
        self._game_icons_dir = game_icons_dir
        self._leaderboards_cache_file = leaderboards_cache_file
        self._leaderboard_icons_cache_file = leaderboard_icons_cache_file
        self._social_activity_cache_file = social_activity_cache_file
        self._news_cache_file = news_cache_file
        self._aotw_cache_file = aotw_cache_file
        self._new_sets_cache_file = new_sets_cache_file
        self._user_avatars_dir = user_avatars_dir
        self._award_icons_dir = award_icons_dir
        self._sets_list_cache_file = sets_list_cache_file
        self._stale_full_refresh_seconds = stale_full_refresh_seconds

        self._payload_lock = threading.Lock()
        self._friends_lock = threading.Lock()
        self._leaderboards_lock = threading.Lock()
        self._leaderboard_icons_lock = threading.Lock()
        self._social_activity_lock = threading.Lock()
        self._news_lock = threading.Lock()
        self._aotw_lock = threading.Lock()
        self._new_sets_lock = threading.Lock()
        self._sets_list_lock = threading.Lock()

        self._game_bundle_locks: dict = {}
        self._game_bundle_locks_mutex = threading.Lock()
        self._game_bundle_fallback_lock = threading.Lock()

        self._user_avatar_locks: dict = {}
        self._user_avatar_locks_mutex = threading.Lock()
        self._user_avatar_fallback_lock = threading.Lock()

        self._award_icon_locks: dict = {}
        self._award_icon_locks_mutex = threading.Lock()
        self._award_icon_fallback_lock = threading.Lock()

        self._friend_game_locks: dict = {}
        self._friend_game_locks_mutex = threading.Lock()
        self._friend_game_fallback_lock = threading.Lock()

        self._friend_game_payload_locks: dict = {}
        self._friend_game_payload_locks_mutex = threading.Lock()
        self._friend_game_payload_fallback_lock = threading.Lock()

    def load_payload(self) -> dict:
        raw = load_json_file(self._cache_file, {"payload": None, "meta": {}})
        if isinstance(raw, dict) and "payload" in raw:
            raw.setdefault("meta", {})
            return raw
        return {"payload": raw, "meta": {}}

    def save_payload(self, payload, meta=None):
        save_json_file(
            self._cache_file,
            {
                "payload": payload,
                "meta": meta or {},
            },
        )

    def is_payload_stale_for_full_refresh(self, cached_meta) -> bool:
        refreshed_at = to_int((cached_meta or {}).get("refreshFinishedAt"), 0)
        if refreshed_at <= 0:
            return True
        return (int(time.time()) - refreshed_at) >= self._stale_full_refresh_seconds

    def load_friends(self) -> dict:
        raw = load_json_file(self._friends_cache_file, {"payload": None, "meta": {}})
        if isinstance(raw, dict) and "payload" in raw:
            raw.setdefault("meta", {})
            return raw
        return {"payload": raw, "meta": {}}

    def save_friends(self, payload, meta=None):
        save_json_file(
            self._friends_cache_file,
            {
                "payload": payload,
                "meta": meta or {},
            },
        )

    def get_cached_friend_row(self, friend_username: str):
        friend_key = str(friend_username or "").strip().lower()
        if not friend_key:
            return None

        cached = self.load_friends()
        cached_payload = cached.get("payload") or {}

        for row in cached_payload.get("friends", []):
            row_username = str(row.get("username") or "").strip()
            if row_username.lower() == friend_key:
                return row

        return None

    def _friend_game_stem(self, key):
        mapped = str(key or "").strip().replace(":", "_")
        return self._safe_cache_filename(mapped)

    def _friend_game_path(self, key):
        stem = self._friend_game_stem(key)
        if stem is None:
            return None
        return self._friend_games_dir / f"{stem}.json"

    def load_friend_game(self, key) -> dict:
        path = self._friend_game_path(key)
        if path is None:
            return {}
        raw = load_json_file(path, {})
        return raw if isinstance(raw, dict) else {}

    def save_friend_game(self, key, payload):
        path = self._friend_game_path(key)
        if path is None:
            return
        ensure_dir(self._friend_games_dir)
        save_json_file(path, payload)

    def friend_game_lock(self, key) -> threading.Lock:
        return self._get_or_create_key_lock(
            self._friend_game_locks, self._friend_game_locks_mutex,
            self._friend_game_fallback_lock, self._friend_game_stem(key),
        )

    def snapshot_active_friend_game_keys(self) -> set:
        return self._snapshot_lock_keys(
            self._friend_game_locks, self._friend_game_locks_mutex,
        )

    def _friend_game_payload_stem(self, key):
        mapped = str(key or "").strip().replace(":", "_")
        return self._safe_cache_filename(mapped)

    def _friend_game_payload_path(self, key):
        stem = self._friend_game_payload_stem(key)
        if stem is None:
            return None
        return self._friend_game_payloads_dir / f"{stem}.json"

    def load_friend_game_payload(self, key) -> dict:
        path = self._friend_game_payload_path(key)
        if path is None:
            return {}
        raw = load_json_file(path, {})
        return raw if isinstance(raw, dict) else {}

    def save_friend_game_payload(self, key, entry):
        path = self._friend_game_payload_path(key)
        if path is None:
            return
        ensure_dir(self._friend_game_payloads_dir)
        save_json_file(path, entry)

    def friend_game_payload_lock(self, key) -> threading.Lock:
        return self._get_or_create_key_lock(
            self._friend_game_payload_locks, self._friend_game_payload_locks_mutex,
            self._friend_game_payload_fallback_lock, self._friend_game_payload_stem(key),
        )

    def snapshot_active_friend_game_payload_keys(self) -> set:
        return self._snapshot_lock_keys(
            self._friend_game_payload_locks, self._friend_game_payload_locks_mutex,
        )

    def _game_bundle_path(self, game_id):
        game_id_int = norm_game_id(game_id)
        if game_id_int is None:
            return None
        return self._game_icons_dir / f"{game_id_int}.json"

    def load_game_bundle(self, game_id) -> dict:
        path = self._game_bundle_path(game_id)
        if path is None:
            return {}
        raw = load_json_file(path, {})
        return raw if isinstance(raw, dict) else {}

    def save_game_bundle(self, game_id, payload):
        path = self._game_bundle_path(game_id)
        if path is None:
            return
        ensure_dir(self._game_icons_dir)
        save_json_file(path, payload)

    def game_bundle_lock(self, game_id) -> threading.Lock:
        return self._get_or_create_key_lock(
            self._game_bundle_locks, self._game_bundle_locks_mutex,
            self._game_bundle_fallback_lock, norm_game_id(game_id),
        )

    def snapshot_active_game_bundle_ids(self) -> set:
        return self._snapshot_lock_keys(
            self._game_bundle_locks, self._game_bundle_locks_mutex,
        )

    def load_leaderboards(self) -> dict:
        raw = load_json_file(self._leaderboards_cache_file, {})
        return raw if isinstance(raw, dict) else {}

    def save_leaderboards(self, payload):
        save_json_file(self._leaderboards_cache_file, payload)

    def load_leaderboard_icons(self) -> dict:
        raw = load_json_file(self._leaderboard_icons_cache_file, {})
        return raw if isinstance(raw, dict) else {}

    def save_leaderboard_icons(self, payload):
        save_json_file(self._leaderboard_icons_cache_file, payload)


    def load_social_activity(self) -> dict:
        raw = load_json_file(self._social_activity_cache_file, {})
        return raw if isinstance(raw, dict) else {}

    def save_social_activity(self, payload):
        save_json_file(self._social_activity_cache_file, payload)

    def clear_pending_game_ticker_event(self):
        """Drop the pending game ticker slot. Leaves the watermarks alone.

        Called by current_game_service on a genuine game change — last
        session's armed nudge is for the wrong game now and shouldn't get a
        chance to fire if the user swings back, so we null the slot.

        We deliberately do NOT touch lastShownGameTickerTimestampByGame.
        It's the per-game record of what we've already shown the user, and
        each game keeps its own. The old version wiped it here, which
        re-opened the already-shown guard and re-flashed a friend's unlock
        every time the user reloaded that game (Issue 9). Now a return visit
        stays suppressed, while a brand-new game has no key yet so its fresh
        activity still surfaces. Doesn't touch events, friendState, or
        anything else in the file.

        Holds the social_activity lock for the load-modify-save so a
        concurrent trickle tick or frontend clear can't interleave with
        this and lose one of the writes.
        """
        with self._social_activity_lock:
            raw = load_json_file(self._social_activity_cache_file, {})
            if not isinstance(raw, dict):
                return
            if raw.get("pendingGameTickerEvent") is None:
                return
            raw["pendingGameTickerEvent"] = None
            save_json_file(self._social_activity_cache_file, raw)

    def load_news(self) -> dict:
        raw = load_json_file(self._news_cache_file, {"payload": None, "meta": {}})
        if isinstance(raw, dict) and "payload" in raw:
            raw.setdefault("meta", {})
            return raw
        return {"payload": raw, "meta": {}}

    def save_news(self, payload, meta=None):
        save_json_file(
            self._news_cache_file,
            {
                "payload": payload,
                "meta": meta or {},
            },
        )

    def load_aotw(self) -> dict:
        raw = load_json_file(self._aotw_cache_file, {"payload": None, "meta": {}})
        if isinstance(raw, dict) and "payload" in raw:
            raw.setdefault("meta", {})
            return raw
        return {"payload": raw, "meta": {}}

    def save_aotw(self, payload, meta=None):
        save_json_file(
            self._aotw_cache_file,
            {
                "payload": payload,
                "meta": meta or {},
            },
        )

    def load_new_sets(self) -> dict:
        raw = load_json_file(self._new_sets_cache_file, {"payload": None, "meta": {}})
        if isinstance(raw, dict) and "payload" in raw:
            raw.setdefault("meta", {})
            return raw
        return {"payload": raw, "meta": {}}

    def save_new_sets(self, payload, meta=None):
        save_json_file(
            self._new_sets_cache_file,
            {
                "payload": payload,
                "meta": meta or {},
            },
        )

    def _safe_cache_filename(self, key):
        text = str(key or "").strip()
        if not text:
            return None
        if all(ch in _SAFE_CACHE_NAME_CHARS for ch in text):
            return text
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def _get_or_create_key_lock(self, locks_dict, mutex, fallback, safe_key):
        if safe_key is None:
            return fallback
        with mutex:
            lock = locks_dict.get(safe_key)
            if lock is None:
                lock = threading.Lock()
                locks_dict[safe_key] = lock
            return lock

    def _snapshot_lock_keys(self, locks_dict, mutex) -> set:
        with mutex:
            return set(locks_dict.keys())

    def _user_avatar_path(self, key):
        safe = self._safe_cache_filename(key)
        if safe is None:
            return None
        return self._user_avatars_dir / f"{safe}.json"

    def load_user_avatar(self, key) -> dict:
        path = self._user_avatar_path(key)
        if path is None:
            return {}
        raw = load_json_file(path, {})
        return raw if isinstance(raw, dict) else {}

    def save_user_avatar(self, key, entry):
        path = self._user_avatar_path(key)
        if path is None:
            return
        ensure_dir(self._user_avatars_dir)
        save_json_file(path, entry)

    def user_avatar_lock(self, key) -> threading.Lock:
        return self._get_or_create_key_lock(
            self._user_avatar_locks, self._user_avatar_locks_mutex,
            self._user_avatar_fallback_lock, self._safe_cache_filename(key),
        )

    def snapshot_active_user_avatar_keys(self) -> set:
        return self._snapshot_lock_keys(
            self._user_avatar_locks, self._user_avatar_locks_mutex,
        )

    def _award_icon_path(self, key):
        safe = self._safe_cache_filename(key)
        if safe is None:
            return None
        return self._award_icons_dir / f"{safe}.json"

    def load_award_icon(self, key) -> dict:
        path = self._award_icon_path(key)
        if path is None:
            return {}
        raw = load_json_file(path, {})
        return raw if isinstance(raw, dict) else {}

    def save_award_icon(self, key, entry):
        path = self._award_icon_path(key)
        if path is None:
            return
        ensure_dir(self._award_icons_dir)
        save_json_file(path, entry)

    def award_icon_lock(self, key) -> threading.Lock:
        return self._get_or_create_key_lock(
            self._award_icon_locks, self._award_icon_locks_mutex,
            self._award_icon_fallback_lock, self._safe_cache_filename(key),
        )

    def snapshot_active_award_icon_keys(self) -> set:
        return self._snapshot_lock_keys(
            self._award_icon_locks, self._award_icon_locks_mutex,
        )

    def load_sets_list(self) -> dict:
        raw = load_json_file(self._sets_list_cache_file, {})
        if not isinstance(raw, dict):
            return {"consoles": [], "gameLists": {}}
        consoles = raw.get("consoles")
        game_lists = raw.get("gameLists")
        return {
            "consoles": consoles if isinstance(consoles, list) else [],
            "gameLists": game_lists if isinstance(game_lists, dict) else {},
        }

    def get_cached_consoles(self):
        data = self.load_sets_list()
        consoles = data.get("consoles") or []
        return consoles if consoles else None

    def save_consoles(self, consoles):
        with self._sets_list_lock:
            data = self.load_sets_list()
            data["consoles"] = consoles if isinstance(consoles, list) else []
            save_json_file(self._sets_list_cache_file, data)

    def get_cached_game_list(self, console_id):
        data = self.load_sets_list()
        return data.get("gameLists", {}).get(str(console_id))

    def save_game_list(self, console_id, games):
        with self._sets_list_lock:
            data = self.load_sets_list()
            data["gameLists"][str(console_id)] = games if isinstance(games, list) else []
            save_json_file(self._sets_list_cache_file, data)

    def payload_lock(self) -> threading.Lock:
        return self._payload_lock

    def friends_lock(self) -> threading.Lock:
        return self._friends_lock

    def leaderboards_lock(self) -> threading.Lock:
        return self._leaderboards_lock

    def leaderboard_icons_lock(self) -> threading.Lock:
        return self._leaderboard_icons_lock

    def social_activity_lock(self) -> threading.Lock:
        return self._social_activity_lock

    def news_lock(self) -> threading.Lock:
        return self._news_lock

    def aotw_lock(self) -> threading.Lock:
        return self._aotw_lock

    def new_sets_lock(self) -> threading.Lock:
        return self._new_sets_lock

    def _delete_files(self, paths) -> list:
        """Helper for the clear_* methods. Walks the given paths, unlinks
        each one that exists, and returns the names that actually went
        away. Missing files are silently skipped — same behaviour the old
        clear_all had inline.
        """
        cleared = []
        for path in paths:
            try:
                if path.exists():
                    path.unlink()
                    cleared.append(path.name)
            except FileNotFoundError:
                pass
        return cleared

    def _delete_keyed_cache_dir(self, cache_dir, lock_for_stem) -> list:
        """Shared wipe for the per-key file caches (game bundles, user
        avatars, award icons, friend games, friend game payloads). Returns
        each removed file's name, same shape as _delete_files.

        Only real "<stem>.json" files go -- skipping everything else leaves
        a writer's in-flight "<stem>.json.tmp" alone, since deleting that
        out from under save_json_file's tempfile+rename would make the
        rename throw. Each file is unlinked under its own per-stem lock (the
        same lock a write takes, handed in as lock_for_stem), so a delete
        can't land mid load -> mutate -> save and get undone by the save
        re-creating it. Only one lock is held at a time, so there's no
        lock-ordering deadlock. A missing dir just means there's nothing to
        clear.
        """
        cleared = []
        if not cache_dir.exists():
            return cleared
        for entry in cache_dir.iterdir():
            if not entry.is_file() or entry.suffix != ".json":
                continue
            with lock_for_stem(entry.stem):
                try:
                    entry.unlink()
                    cleared.append(entry.name)
                except FileNotFoundError:
                    pass
        return cleared

    def _delete_game_bundles(self) -> list:
        """Wipe every per-game icon bundle under the gameicons dir. The dir
        is left in place -- the next save_game_bundle mkdirs it anyway, but
        keeping it means a quick `ls gameicons/` confirms the wipe worked."""
        return self._delete_keyed_cache_dir(
            self._game_icons_dir, self.game_bundle_lock,
        )

    def _delete_user_avatars(self) -> list:
        """Wipe every per-user avatar file under the user_avatars dir."""
        return self._delete_keyed_cache_dir(
            self._user_avatars_dir, self.user_avatar_lock,
        )

    def _delete_award_icons(self) -> list:
        """Wipe every per-award badge-art file under the award_icons dir."""
        return self._delete_keyed_cache_dir(
            self._award_icons_dir, self.award_icon_lock,
        )

    def _delete_friend_games(self) -> list:
        """Wipe every per-friend game file under the friend_games dir."""
        return self._delete_keyed_cache_dir(
            self._friend_games_dir, self.friend_game_lock,
        )

    def _delete_friend_game_payloads(self) -> list:
        """Wipe every per-(user, game) payload file. Goes wherever
        _delete_friend_games goes — these hold the same RA progress data,
        so a clear that leaves them behind would serve a wiped account."""
        return self._delete_keyed_cache_dir(
            self._friend_game_payloads_dir, self.friend_game_payload_lock,
        )

    def clear_game_data(self) -> list:
        """RA progress data: the user's payload, per-friend game progress,
        and the per-game leaderboard lists. These are the things to wipe
        when achievements look stale."""
        cleared = []
        for lock, path in (
            (self._payload_lock, self._cache_file),
            (self._leaderboards_lock, self._leaderboards_cache_file),
        ):
            with lock:
                cleared.extend(self._delete_files((path,)))
        cleared.extend(self._delete_friend_games())
        cleared.extend(self._delete_friend_game_payloads())
        return cleared

    def clear_friends(self) -> list:
        """Just the friends roster + their avatars + their recent games.
        Per-friend per-game progress lives in the game-data group."""
        with self._friends_lock:
            return self._delete_files((
                self._friends_cache_file,
            ))

    def clear_images(self) -> list:
        """Both image caches in one go: the per-game icon bundles (game
        icon, title/ingame/boxart images, achievement badges) and the
        separate leaderboard-icons file. Splitting these further isn't
        useful — when a user wants to bust an icon it's almost always
        all of them.

        The AOTW cache file goes too. That used to be because the payload
        carried the achievement badge as a data URI inside its own blob,
        which this button would otherwise have left standing; the badge
        moved to lazy resolution on the frontend and the field went with
        it (see aotw_service._cache_has_phase75_fields), so the reason now
        is the weaker one: the payload still carries the game's imageIcon,
        and dropping it alongside the bundles keeps "clear the images" from
        meaning two different things depending on which surface you're on.

        Non-friend user avatars get wiped here as well -- they're
        image data caching the same way the rest is.
        """
        cleared = self._delete_game_bundles()
        cleared.extend(self._delete_user_avatars())
        for lock, path in (
            (self._leaderboard_icons_lock, self._leaderboard_icons_cache_file),
            (self._aotw_lock, self._aotw_cache_file),
        ):
            with lock:
                cleared.extend(self._delete_files((path,)))
        return cleared

    def clear_social_activity(self) -> list:
        """Just the rolling global activity feed shown in the Social Hub.
        Leaves the per-game activity history alone — useful when you
        want to force the trickle to refill the global feed without
        also losing the long-lived per-game snapshots."""
        with self._social_activity_lock:
            return self._delete_files((
                self._social_activity_cache_file,
            ))

    def clear_sets_list_cache(self) -> list:
        """Just the tracked-sets add-game catalog: the cached console list
        and every per-console game list. This is the game-LOOKUP data, not
        the user's saved sets -- wiping it only means the picker re-fetches
        console/game lists fresh on next use. The user's tracked_sets.json
        is a separate store and is untouched here. Backs the "Clear Sets
        List Cache" button, which is deliberately kept distinct from the
        destructive "Delete All Mastery Goals" action."""
        with self._sets_list_lock:
            return self._delete_files((
                self._sets_list_cache_file,
            ))

    def clear_leaderboards(self) -> list:
        """Just the per-game leaderboard standings cache for the active
        account. Separate from the game-data group so a user can bust stale
        leaderboards without also dropping their payload and friend games."""
        with self._leaderboards_lock:
            return self._delete_files((
                self._leaderboards_cache_file,
            ))

    def clear_friend_game_payloads(self) -> list:
        """Just the per-(user, game) achievement payloads another player's
        Game Overview paints from. Its own button as well as riding along in
        the game-data group, because this is the one cache that answers "why
        am I looking at yesterday's progress for this person" — your own
        current game is never in here, and every entry rebuilds from
        RetroAchievements the next time the page opens. The per-pair wipe
        guards itself per-key inside the helper, so there's no flat lock."""
        return self._delete_friend_game_payloads()

    def clear_award_icons(self) -> list:
        """Just the cached badge art for site / event awards. Backs the
        dedicated "Clear Other Icons" button (the Badges "Other" filter is
        where these awards live). Kept out of clear_images on purpose -- a
        user busting game icons rarely means to drop their award art too, and
        Jameson wanted these on their own button. The per-award wipe guards
        itself per-key inside the helper, so there's no flat lock to take
        here."""
        return self._delete_award_icons()

    def repoint_user_scope(self, base_dir: Path) -> None:
        """Re-point only the per-account cache files onto a new per-user base.

        A switch hands us the incoming account's dir; we move the
        account-specific files over to it. Each swap is done under the same
        lock that guards writes to that file, so a CurrentGameService payload
        save or a trickle feed write can't straddle the swap and land the
        outgoing account's bytes under the incoming account's path.

        Friends belongs in this set: a follow list differs per account, so
        leaving it global let a fresh trickle tick read the outgoing account's
        roster right after a switch and fire a feed notification for a friend
        the new account doesn't even have. Swapping it here means the new
        account's roster (or an empty one) is the only thing a post-switch
        tick can see.

        The genuinely-global caches (friend-games, icons, avatars, award icons,
        news, aotw, new-sets, sets-list, leaderboard icons) stay put -- they're
        identical across accounts or get rebuilt by the roster refresh that runs
        right after a switch. There's no in-memory cache to flush here either: every
        getter loads on demand off these fields, so swapping the field is the
        whole job.
        """
        ensure_dir(base_dir)
        with self._payload_lock:
            self._cache_file = base_dir / "last_payload.json"
        with self._social_activity_lock:
            self._social_activity_cache_file = base_dir / "social_activity_cache.json"
        with self._leaderboards_lock:
            self._leaderboards_cache_file = base_dir / "leaderboards_cache.json"
        with self._friends_lock:
            self._friends_cache_file = base_dir / "friends_cache.json"

    def clear_all(self) -> list:
        """Delete every cache file that currently exists on disk.

        Returns the list of filenames that were actually removed so the
        caller can report back to the frontend.

        Each file is deleted while holding its own cache lock, so a clear
        can't land in the middle of an in-flight load -> mutate -> save and
        get undone by the save re-creating the file right after. We take
        one lock at a time and release it before the next, so there's no
        lock-ordering deadlock no matter what a writer is doing. Writes
        are atomic (tempfile + rename), so the lock is about that stale
        resurrection, never a half-written file. The per-file dirs (game-icon
        bundles, user avatars, award icons, friend games) come last and guard
        themselves per-key inside their own delete helpers.
        """
        cleared = []
        guarded = (
            (self._payload_lock, self._cache_file),
            (self._friends_lock, self._friends_cache_file),
            (self._leaderboards_lock, self._leaderboards_cache_file),
            (self._leaderboard_icons_lock, self._leaderboard_icons_cache_file),
            (self._social_activity_lock, self._social_activity_cache_file),
            (self._news_lock, self._news_cache_file),
            (self._aotw_lock, self._aotw_cache_file),
            (self._new_sets_lock, self._new_sets_cache_file),
            (self._sets_list_lock, self._sets_list_cache_file),
        )
        for lock, path in guarded:
            with lock:
                cleared.extend(self._delete_files((path,)))
        cleared.extend(self._delete_game_bundles())
        cleared.extend(self._delete_user_avatars())
        cleared.extend(self._delete_award_icons())
        cleared.extend(self._delete_friend_games())
        cleared.extend(self._delete_friend_game_payloads())
        return cleared
