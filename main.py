import asyncio
import contextlib
import functools
import shutil
import threading
import time
from pathlib import Path

import decky
import snapshot

from cache_store import CacheStore
from ra_client import RetroAchievementsClient
from services.cache_maintenance_service import CacheMaintenanceService
from services.cheevo_check_service import CheevoCheckService
from services.file_watcher_service import FileWatcherService
from services.current_game_service import CurrentGameService
from services.friends_service import FriendsService
from services.friends_roster_service import FriendsRosterService
from services.game_activity_history_service import GameActivityHistoryService
from services.icon_service import IconService
from services.leaderboards_service import LeaderboardsService
from services.social_activity_cache_service import SocialActivityCacheService
from services.social_activity_trickle_service import SocialActivityTrickleService
from services.players_near_you_service import PlayersNearYouService
from services.notes_reminder_service import NotesReminderService
from services.news_service import NewsService
from services.aotw_service import AotwService
from services.game_comments_service import GameCommentsService
from services.game_hashes_service import GameHashesService
from services.smb_mount_service import SmbMountService
from services.comments_service import CommentsService
from services.new_sets_service import NewSetsService
from services.tracked_sets_monitor_service import TrackedSetsMonitorService
from services.update_checker_service import UpdateCheckerService, installed_version
from services.developer_message_service import DeveloperMessageService
from services.repair_service import RepairService
from services.emulator_login_sync_service import EmulatorLoginSyncService
from notes_store import NotesStore
from guides_store import GuidesStore
from players_near_you_store import PlayersNearYouStore
from games_list_cache_store import GamesListCacheStore
from awards_list_cache_store import AwardsListCacheStore
from want_to_play_cache_store import WantToPlayCacheStore
from game_activity_history_store import GameActivityHistoryStore
from tracked_sets_store import TrackedSetsStore
from subscriptions_store import SubscriptionsStore
from saved_comments_store import SavedCommentsStore
from comment_baselines_store import CommentBaselinesStore
from resolved_avatar_store import ResolvedAvatarStore
from developer_message_store import DeveloperMessageStore
from cheevo_check_store import CheevoCheckStore
from file_watcher_store import FileWatcherStore
from dolphin_mappings_store import DolphinMappingsStore
from smb_shares_store import SmbSharesStore
from settings_store import SettingsStore
from notifications import NotificationsStore, NotificationsArchiveStore, NOTIFICATION_EVENT, emit_notification, is_type_enabled
from utils import chown_to_data_owner, ensure_dir, init_data_owner, is_network_error, ssl_context

from mixins.notifications import NotificationsMixin
from mixins.notes import NotesMixin
from mixins.tracked_achievements import TrackedAchievementsMixin
from mixins.tracked_sets import TrackedSetsMixin
from mixins.comments import CommentsMixin
from mixins.leaderboards import LeaderboardsMixin
from mixins.friends_social import FriendsSocialMixin
from mixins.players_near_you import PlayersNearYouMixin
from mixins.icons_media import IconsMediaMixin
from mixins.news_events import NewsEventsMixin
from mixins.games_achievements import GamesAchievementsMixin
from mixins.hashes import GameHashesMixin
from mixins.options import OptionsMixin
from mixins.dolphin_mapper import DolphinMapperMixin
from mixins.smb_shares import SmbSharesMixin
from mixins.cheevo_check import CheevoCheckMixin
from mixins.file_watcher import FileWatcherMixin
from mixins.guides import GuidesMixin
from mixins.library_badge import LibraryBadgeMixin


DEFAULT_IPC_SLOW_THRESHOLD_MS = 250


def _timed_ipc(method):
    @functools.wraps(method)
    async def wrapper(self, *args, **kwargs):
        if not getattr(self, "_debug_logging", False):
            return await method(self, *args, **kwargs)
        start = time.monotonic()
        try:
            return await method(self, *args, **kwargs)
        finally:
            elapsed_ms = (time.monotonic() - start) * 1000.0
            threshold = getattr(self, "_ipc_slow_threshold_ms", DEFAULT_IPC_SLOW_THRESHOLD_MS)
            if elapsed_ms >= threshold:
                decky.logger.warning(
                    "ipc slow: %s took %.0fms",
                    method.__name__,
                    elapsed_ms,
                )
    return wrapper


class CredentialError(Exception):
    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


class Plugin(
    NotificationsMixin,
    NotesMixin,
    TrackedAchievementsMixin,
    TrackedSetsMixin,
    CommentsMixin,
    LeaderboardsMixin,
    FriendsSocialMixin,
    PlayersNearYouMixin,
    IconsMediaMixin,
    NewsEventsMixin,
    GamesAchievementsMixin,
    GameHashesMixin,
    OptionsMixin,
    DolphinMapperMixin,
    SmbSharesMixin,
    CheevoCheckMixin,
    FileWatcherMixin,
    GuidesMixin,
    LibraryBadgeMixin,
):
    DEFAULT_LANGUAGE = "en"
    RECENT_UNLOCK_LOOKBACK_MINUTES = 1440
    RECENT_UNLOCK_HISTORY_DAYS = -1
    STALE_CACHE_FULL_REFRESH_SECONDS = 24 * 60 * 60
    FRIENDS_ROSTER_REFRESH_MAX_AGE_SECONDS = 5 * 60
    FRIENDS_PAGE_SIZE = 500
    FRIEND_GAME_CACHE_MAX_AGE_SECONDS = 10 * 60
    RECENT_GAMES_COUNT = 25
    FRIENDS_ROW_REFRESH_RECENT_COUNT = 5
    GAME_CHECK_GATE_WAIT_SECONDS = 15.0
    BACKGROUND_RA_MIN_GAP_SECONDS = 1.5
    RA_QUIET_WAIT_CAP_SECONDS = 10
    ACHIEVEMENT_ICON_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
    ACHIEVEMENT_ICON_MAX_WORKERS = 6
    USER_AVATAR_MAX_WORKERS = 4
    GAME_ICON_MAX_WORKERS = 6
    LEADERBOARD_ICON_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
    LEADERBOARDS_CACHE_MAX_AGE_SECONDS = 3 * 24 * 60 * 60
    GAME_ICON_MAX_AGE_SECONDS = 60 * 24 * 60 * 60
    GAME_IMAGE_MAX_AGE_SECONDS = 60 * 24 * 60 * 60
    USER_AVATAR_MAX_AGE_SECONDS = 48 * 60 * 60

    GAME_BUNDLE_DISK_LIMIT = 2048
    USER_AVATAR_DISK_LIMIT = 2048
    AWARD_ICON_DISK_LIMIT = 1024
    FRIEND_GAME_CACHE_LIMIT = 100
    FRIEND_GAME_PAYLOAD_CACHE_LIMIT = 60
    GAMES_LIST_CACHE_DISK_LIMIT = 16
    AWARDS_LIST_CACHE_DISK_LIMIT = 16
    WANT_TO_PLAY_CACHE_DISK_LIMIT = 16

    COMMENTS_CACHE_TTL_SECONDS = 5.0
    COMMENTS_CACHE_MAX_ENTRIES = 64

    def __init__(self):
        self.settings_dir = Path(
            getattr(
                decky,
                "DECKY_PLUGIN_SETTINGS_DIR",
                "/home/deck/homebrew/settings/decky-cheevodeck",
            )
        )
        self.runtime_dir = Path(
            getattr(
                decky,
                "DECKY_PLUGIN_RUNTIME_DIR",
                "/home/deck/homebrew/data/decky-cheevodeck",
            )
        )
        self.settings_dir.mkdir(parents=True, exist_ok=True)
        self.runtime_dir.mkdir(parents=True, exist_ok=True)

        self.config_file = self.settings_dir / "settings.json"
        self.tracked_dir = self.runtime_dir / "tracked"
        self.favorites_file = self.runtime_dir / "favorites.json"
        self.notes_dir = self.runtime_dir / "notes"
        self.guides_dir = self.runtime_dir / "guides"
        self.tracked_sets_dir = self.runtime_dir
        self.dolphin_mappings_dir = self.runtime_dir
        self.smb_shares_dir = self.runtime_dir
        self.cheevo_check_dir = self.runtime_dir
        self.cheevo_check_scratch_dir = self.runtime_dir / "scan-temp"
        self.cheevo_check_ram_scratch_dir = Path("/run/cheevodeck-scan-temp")
        self.file_watcher_dir = self.runtime_dir
        self.plugin_dir = Path(
            getattr(decky, "DECKY_PLUGIN_DIR", str(Path(__file__).resolve().parent))
        )
        self.user_home = Path(getattr(decky, "DECKY_USER_HOME", "/home/deck"))

        init_data_owner(self.runtime_dir, self.settings_dir, self.user_home)
        chown_to_data_owner(self.settings_dir)
        chown_to_data_owner(self.runtime_dir)

        self.dolphin_defaults_dir = self.plugin_dir / "dolphin"
        if not self.dolphin_defaults_dir.exists():
            self.dolphin_defaults_dir = self.plugin_dir / "defaults" / "dolphin"
        self.help_dir = self.plugin_dir / "help"
        if not self.help_dir.exists():
            self.help_dir = self.plugin_dir / "defaults" / "help"
        self.cache_file = self.runtime_dir / "last_payload.json"
        self.friends_cache_file = self.runtime_dir / "friends_cache.json"
        self.game_icons_dir = self.runtime_dir / "gameicons"
        self.user_avatars_dir = self.runtime_dir / "user_avatars"
        self.award_icons_dir = self.runtime_dir / "award_icons"
        self.friend_games_dir = self.runtime_dir / "friend_games"
        self.friend_game_payloads_dir = self.runtime_dir / "friend_game_payloads"
        self.leaderboards_cache_file = self.runtime_dir / "leaderboards_cache.json"
        self.leaderboard_icons_cache_file = self.runtime_dir / "leaderboard_icons_cache.json"
        self.social_activity_cache_file = self.runtime_dir / "social_activity_cache.json"
        self.players_near_you_dir = self.runtime_dir / "players_near_you"
        self.game_activity_history_dir = self.runtime_dir / "game_activity_history"
        self.games_list_cache_dir = self.runtime_dir / "games_list_cache"
        self.awards_lists_dir = self.runtime_dir / "awards_lists"
        self.want_to_play_dir = self.runtime_dir / "want_to_play"
        self.news_cache_file = self.runtime_dir / "news_cache.json"
        self.aotw_cache_file = self.runtime_dir / "aotw_cache.json"
        self.new_sets_cache_file = self.runtime_dir / "new_sets_cache.json"
        self.user_avatars_cache_file = self.runtime_dir / "user_avatars_cache.json"
        self.friend_games_cache_file = self.runtime_dir / "friend_games_cache.json"
        self.sets_list_cache_file = self.runtime_dir / "sets_list_cache.json"

        try:
            self.user_avatars_cache_file.unlink()
        except FileNotFoundError:
            pass
        except OSError as e:
            decky.logger.warning(
                "startup: could not remove legacy avatar cache: %s",
                type(e).__name__,
            )

        try:
            self.friend_games_cache_file.unlink()
        except FileNotFoundError:
            pass
        except OSError as e:
            decky.logger.warning(
                "startup: could not remove legacy friend games cache: %s",
                type(e).__name__,
            )

        self._ssl_ctx = ssl_context()
        self.ra = RetroAchievementsClient(self._ssl_ctx)
        self.settings_store = SettingsStore(
            config_file=self.config_file,
            tracked_dir=self.tracked_dir,
            favorites_file=self.favorites_file,
            default_language=self.DEFAULT_LANGUAGE,
            recent_unlock_lookback_minutes=self.RECENT_UNLOCK_LOOKBACK_MINUTES,
            recent_unlock_history_days=self.RECENT_UNLOCK_HISTORY_DAYS,
        )
        self.notes_store = NotesStore(
            notes_dir=self.notes_dir,
        )
        self.guides_store = GuidesStore(
            guides_dir=self.guides_dir,
        )
        self.players_near_you_store = PlayersNearYouStore(
            store_dir=self.players_near_you_dir,
        )
        self.games_list_cache_store = GamesListCacheStore(
            store_dir=self.games_list_cache_dir,
        )
        self.awards_list_cache_store = AwardsListCacheStore(
            store_dir=self.awards_lists_dir,
        )
        self.want_to_play_cache_store = WantToPlayCacheStore(
            store_dir=self.want_to_play_dir,
        )
        self.game_activity_history_store = GameActivityHistoryStore(
            store_dir=self.game_activity_history_dir,
        )
        self.tracked_sets_store = TrackedSetsStore(
            base_dir=self.tracked_sets_dir,
        )
        self.dolphin_mappings_store = DolphinMappingsStore(
            base_dir=self.dolphin_mappings_dir,
        )
        self.smb_shares_store = SmbSharesStore(
            base_dir=self.smb_shares_dir,
        )
        self.cheevo_check_store = CheevoCheckStore(
            base_dir=self.cheevo_check_dir,
        )
        self.file_watcher_store = FileWatcherStore(
            base_dir=self.file_watcher_dir,
        )
        self.subscriptions_store = SubscriptionsStore(
            base_dir=self.runtime_dir,
        )
        self.saved_comments_store = SavedCommentsStore(
            base_dir=self.runtime_dir,
        )
        self.notifications_store = NotificationsStore(
            base_dir=self.runtime_dir,
        )
        self.notifications_archive_store = NotificationsArchiveStore(
            base_dir=self.runtime_dir,
        )
        self.comment_baselines_store = CommentBaselinesStore(
            base_dir=self.runtime_dir,
        )
        self.resolved_avatar_store = ResolvedAvatarStore(
            base_dir=self.runtime_dir,
        )
        self.developer_message_store = DeveloperMessageStore(
            base_dir=self.runtime_dir,
        )
        self.cache_store = CacheStore(
            cache_file=self.cache_file,
            friends_cache_file=self.friends_cache_file,
            friend_games_dir=self.friend_games_dir,
            friend_game_payloads_dir=self.friend_game_payloads_dir,
            game_icons_dir=self.game_icons_dir,
            leaderboards_cache_file=self.leaderboards_cache_file,
            leaderboard_icons_cache_file=self.leaderboard_icons_cache_file,
            social_activity_cache_file=self.social_activity_cache_file,
            news_cache_file=self.news_cache_file,
            aotw_cache_file=self.aotw_cache_file,
            new_sets_cache_file=self.new_sets_cache_file,
            user_avatars_dir=self.user_avatars_dir,
            award_icons_dir=self.award_icons_dir,
            sets_list_cache_file=self.sets_list_cache_file,
            stale_full_refresh_seconds=self.STALE_CACHE_FULL_REFRESH_SECONDS,
        )
        self.leaderboards_service = LeaderboardsService(
            ra=self.ra,
            cache_store=self.cache_store,
            leaderboards_cache_max_age_seconds=self.LEADERBOARDS_CACHE_MAX_AGE_SECONDS,
        )
        try:
            _startup_cfg = self.settings_store.load_config()
            achievement_icon_max_workers = self.settings_store.get_max_icon_workers(_startup_cfg)
            user_avatar_max_workers = self.settings_store.get_avatar_workers(_startup_cfg)
            game_icon_workers = self.settings_store.get_game_icon_workers(_startup_cfg)
            game_bundle_disk_limit = self.settings_store.get_game_art_cache_cap(_startup_cfg) * 2
            user_avatar_disk_limit = self.settings_store.get_avatar_cache_cap(_startup_cfg) * 2
        except Exception:
            _startup_cfg = {}
            achievement_icon_max_workers = self.ACHIEVEMENT_ICON_MAX_WORKERS
            user_avatar_max_workers = self.USER_AVATAR_MAX_WORKERS
            game_icon_workers = self.GAME_ICON_MAX_WORKERS
            game_bundle_disk_limit = self.GAME_BUNDLE_DISK_LIMIT
            user_avatar_disk_limit = self.USER_AVATAR_DISK_LIMIT
        self._apply_user_scope(self._user_dir_key(_startup_cfg))
        self.icon_service = IconService(
            ra=self.ra,
            cache_store=self.cache_store,
            achievement_icon_max_age_seconds=self.ACHIEVEMENT_ICON_MAX_AGE_SECONDS,
            achievement_icon_max_workers=achievement_icon_max_workers,
            leaderboard_icon_max_age_seconds=self.LEADERBOARD_ICON_MAX_AGE_SECONDS,
            game_icon_max_age_seconds=self.GAME_ICON_MAX_AGE_SECONDS,
            game_image_max_age_seconds=self.GAME_IMAGE_MAX_AGE_SECONDS,
            user_avatar_max_age_seconds=self.USER_AVATAR_MAX_AGE_SECONDS,
            user_avatar_max_workers=user_avatar_max_workers,
            game_icon_max_workers=game_icon_workers,
            resolved_avatar_store=self.resolved_avatar_store,
            debug_logging_provider=lambda: getattr(self, "_debug_logging", False),
        )
        self.current_game_service = CurrentGameService(
            ra=self.ra,
            cache_store=self.cache_store,
            settings_store=self.settings_store,
            icon_service=self.icon_service,
            notifications_store=self.notifications_store,
        )
        self.tracked_sets_monitor_service = TrackedSetsMonitorService(
            tracked_sets_store=self.tracked_sets_store,
            settings_store=self.settings_store,
            notifications_store=self.notifications_store,
            plugin=self,
        )
        self.current_game_service.set_tracked_sets_monitor(self.tracked_sets_monitor_service)
        self.social_activity_cache_service = SocialActivityCacheService(
            ra=self.ra,
            cache_store=self.cache_store,
            settings_store=self.settings_store,
        )
        self.game_activity_history_service = GameActivityHistoryService(
            store=self.game_activity_history_store,
        )
        self.social_activity_trickle_service = SocialActivityTrickleService(
            social_activity_cache_service=self.social_activity_cache_service,
            game_activity_history_service=self.game_activity_history_service,
            settings_store=self.settings_store,
            plugin=self,
            notifications_store=self.notifications_store,
        )
        self.players_near_you_service = PlayersNearYouService(
            ra=self.ra,
            cache_store=self.cache_store,
            settings_store=self.settings_store,
            players_near_you_store=self.players_near_you_store,
            plugin=self,
            notifications_store=self.notifications_store,
        )
        self.notes_reminder_service = NotesReminderService(
            notes_store=self.notes_store,
            cache_store=self.cache_store,
            settings_store=self.settings_store,
            notifications_store=self.notifications_store,
            plugin=self,
        )
        self.update_checker_service = UpdateCheckerService(
            settings_store=self.settings_store,
            ssl_context=self._ssl_ctx,
            user_home=self.user_home,
            notifications_store=self.notifications_store,
        )
        self.repair_service = RepairService(
            update_checker_service=self.update_checker_service,
        )
        self.developer_message_service = DeveloperMessageService(
            settings_store=self.settings_store,
            message_store=self.developer_message_store,
            ssl_context=self._ssl_ctx,
            notifications_store=self.notifications_store,
        )
        self.emulator_login_sync_service = EmulatorLoginSyncService(
            debug_logging_provider=lambda: getattr(self, "_debug_logging", False),
            home_dir=self.user_home,
        )
        self.friends_service = FriendsService(
            ra=self.ra,
            cache_store=self.cache_store,
            current_game_service=self.current_game_service,
            icon_service=self.icon_service,
            friends_page_size=self.FRIENDS_PAGE_SIZE,
            friends_roster_refresh_max_age_seconds=self.FRIENDS_ROSTER_REFRESH_MAX_AGE_SECONDS,
            friends_row_refresh_recent_count=self.FRIENDS_ROW_REFRESH_RECENT_COUNT,
            friend_game_cache_max_age_seconds=self.FRIEND_GAME_CACHE_MAX_AGE_SECONDS,
            recent_games_count=self.RECENT_GAMES_COUNT,
            debug_logging_provider=lambda: getattr(self, "_debug_logging", False),
            validate_friends_roster_provider=lambda: getattr(self, "_validate_friends_roster", True),
            self_ulid_provider=lambda: str(self.settings_store.load_config().get("activeUlid") or ""),
        )
        self.friends_roster_service = FriendsRosterService(
            friends_service=self.friends_service,
            cache_store=self.cache_store,
            settings_store=self.settings_store,
            resolved_avatar_store=self.resolved_avatar_store,
            ra=self.ra,
            icon_service=self.icon_service,
            plugin=self,
            notifications_store=self.notifications_store,
        )
        self.news_service = NewsService(
            ra=self.ra,
            cache_store=self.cache_store,
        )
        self.aotw_service = AotwService(
            ra=self.ra,
            cache_store=self.cache_store,
            icon_service=self.icon_service,
            debug_logging_provider=lambda: getattr(self, "_debug_logging", False),
        )
        self.new_sets_service = NewSetsService(
            ra=self.ra,
            cache_store=self.cache_store,
            icon_service=self.icon_service,
        )
        self.game_comments_service = GameCommentsService(
            ra=self.ra,
            icon_service=self.icon_service,
        )
        self.game_hashes_service = GameHashesService(
            ra=self.ra,
        )
        self.smb_mount_service = SmbMountService(
            debug_logging=lambda: getattr(self, "_debug_logging", False),
        )
        cheevo_check_bin = self.plugin_dir / "bin"
        if not cheevo_check_bin.exists():
            cheevo_check_bin = self.plugin_dir / "defaults" / "bin"
        cheevo_check_dats = self.plugin_dir / "dats"
        if not cheevo_check_dats.exists():
            cheevo_check_dats = self.plugin_dir / "defaults" / "dats"
        self.cheevo_check_service = CheevoCheckService(
            ra=self.ra,
            store=self.cheevo_check_store,
            settings_store=self.settings_store,
            notifications_store=self.notifications_store,
            hasher_path=cheevo_check_bin / "RAHasher",
            chdman_path=cheevo_check_bin / "chdman",
            dats_dir=cheevo_check_dats,
            data_dats_dir=self.runtime_dir / "cheevo_check" / "dats",
            scratch_dir=self.cheevo_check_scratch_dir,
            ram_scratch_dir=self.cheevo_check_ram_scratch_dir,
            user_home=self.user_home,
            debug_logging=lambda: getattr(self, "_debug_logging", False),
        )
        self.file_watcher_service = FileWatcherService(
            store=self.file_watcher_store,
            settings_store=self.settings_store,
            notifications_store=self.notifications_store,
            debug_logging=lambda: getattr(self, "_debug_logging", False),
        )
        self.comments_service = CommentsService(
            game_comments_service=self.game_comments_service,
            subscriptions_store=self.subscriptions_store,
            comment_baselines_store=self.comment_baselines_store,
            settings_store=self.settings_store,
            plugin=self,
            notifications_store=self.notifications_store,
        )
        self.cache_maintenance_service = CacheMaintenanceService(
            cache_store=self.cache_store,
            game_icons_dir=self.game_icons_dir,
            user_avatars_dir=self.user_avatars_dir,
            award_icons_dir=self.award_icons_dir,
            friend_games_dir=self.friend_games_dir,
            friend_game_payloads_dir=self.friend_game_payloads_dir,
            games_list_cache_dir=self.games_list_cache_dir,
            awards_lists_dir=self.awards_lists_dir,
            want_to_play_dir=self.want_to_play_dir,
            runtime_dir=self.runtime_dir,
            games_list_cache_store=self.games_list_cache_store,
            awards_list_cache_store=self.awards_list_cache_store,
            want_to_play_cache_store=self.want_to_play_cache_store,
            game_bundle_disk_limit=game_bundle_disk_limit,
            user_avatar_disk_limit=user_avatar_disk_limit,
            award_icon_disk_limit=self.AWARD_ICON_DISK_LIMIT,
            friend_game_cache_limit=self.FRIEND_GAME_CACHE_LIMIT,
            friend_game_payload_cache_limit=self.FRIEND_GAME_PAYLOAD_CACHE_LIMIT,
            games_list_cache_disk_limit=self.GAMES_LIST_CACHE_DISK_LIMIT,
            awards_list_cache_disk_limit=self.AWARDS_LIST_CACHE_DISK_LIMIT,
            want_to_play_cache_disk_limit=self.WANT_TO_PLAY_CACHE_DISK_LIMIT,
            settings_store=self.settings_store,
        )

        try:
            cfg = self.settings_store.load_config()
            self._debug_logging = self.settings_store.get_debug_logging(cfg)
            self._ipc_slow_threshold_ms = self.settings_store.get_ipc_slow_threshold_ms(cfg)
            parallel_ra_calls = self.settings_store.get_parallel_ra_calls(cfg)
            parallel_cdn_fetches = self.settings_store.get_parallel_cdn_fetches(cfg)
            self._validate_friends_roster = self.settings_store.get_validate_friends_roster(cfg)
        except Exception:
            self._debug_logging = False
            self._ipc_slow_threshold_ms = DEFAULT_IPC_SLOW_THRESHOLD_MS
            parallel_ra_calls = 4
            parallel_cdn_fetches = 5
            self._validate_friends_roster = True

        self._ra_semaphore = asyncio.Semaphore(parallel_ra_calls)
        self._ra_slots_in_use = 0
        self._ra_slots_lock = threading.Lock()

        self._image_semaphore = asyncio.Semaphore(parallel_cdn_fetches)

        self._bg_ra_pace_lock = asyncio.Lock()
        self._bg_ra_next_allowed = 0.0

        self._friend_fetch_lock = asyncio.Lock()

        self._game_check_gate = asyncio.Event()
        self._game_check_gate.set()

        self._trickle_tick_lock = threading.Lock()

        self._clear_waiting = 0
        self._clear_waiting_lock = threading.Lock()

        self._comments_cache = {}
        self._comments_cache_lock = threading.Lock()

        self._asyncio_loop = None

        self._background_tasks = set()

    @contextlib.asynccontextmanager
    async def _ra_slot(self, wait_for_game_check=True):
        if wait_for_game_check and not self._game_check_gate.is_set():
            try:
                await asyncio.wait_for(
                    self._game_check_gate.wait(),
                    self.GAME_CHECK_GATE_WAIT_SECONDS,
                )
            except asyncio.TimeoutError:
                pass
        async with self._ra_semaphore:
            with self._ra_slots_lock:
                self._ra_slots_in_use += 1
            try:
                yield
            finally:
                with self._ra_slots_lock:
                    self._ra_slots_in_use -= 1

    @contextlib.asynccontextmanager
    async def _game_check_slot(self):
        self._game_check_gate.clear()
        try:
            async with self._ra_slot(wait_for_game_check=False):
                yield
        finally:
            self._game_check_gate.set()

    @contextlib.asynccontextmanager
    async def _image_slot(self):
        async with self._image_semaphore:
            yield

    def ra_is_quiet(self):
        with self._ra_slots_lock:
            return self._ra_slots_in_use == 0

    def wait_for_ra_quiet(self, stop_event):
        waited = 0.0
        while waited < self.RA_QUIET_WAIT_CAP_SECONDS:
            if self.ra_is_quiet():
                return True
            if stop_event.wait(5.0):
                return False
            waited += 5.0
        return False

    async def run_ra_call_for_trickle(self, fn, *args, **kwargs):
        await self._await_background_ra_pacing()
        async with self._ra_slot():
            return await asyncio.to_thread(fn, *args, **kwargs)

    async def _await_background_ra_pacing(self):
        async with self._bg_ra_pace_lock:
            wait = self._bg_ra_next_allowed - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._bg_ra_next_allowed = time.monotonic() + self.BACKGROUND_RA_MIN_GAP_SECONDS

    def _spawn_background_task(self, coro):
        task = asyncio.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task

    async def _main(self):
        self._asyncio_loop = asyncio.get_running_loop()

        try:
            await asyncio.to_thread(self.repair_service.run_startup_repairs)
        except Exception as e:
            decky.logger.warning(
                "repair: startup repairs dispatch failed: %s",
                type(e).__name__,
            )

        self.current_game_service.set_event_loop(self._asyncio_loop)

        self.social_activity_trickle_service.set_event_loop(self._asyncio_loop)
        self.social_activity_trickle_service.start()
        self.players_near_you_service.set_event_loop(self._asyncio_loop)
        self.players_near_you_service.start()
        self.friends_roster_service.set_event_loop(self._asyncio_loop)
        self.friends_roster_service.start()
        self.comments_service.set_event_loop(self._asyncio_loop)
        self.comments_service.start()
        self.notes_reminder_service.set_event_loop(asyncio.get_running_loop())
        self.notes_reminder_service.start()

        self.tracked_sets_monitor_service.set_event_loop(self._asyncio_loop)
        self.tracked_sets_monitor_service.start()

        self.update_checker_service.set_event_loop(self._asyncio_loop)
        self.update_checker_service.start()
        self.developer_message_service.set_event_loop(self._asyncio_loop)
        self.developer_message_service.start()

        self.cheevo_check_service.set_event_loop(self._asyncio_loop)
        try:
            await asyncio.to_thread(self.cheevo_check_service.prepare)
        except Exception as e:
            decky.logger.warning(
                "cheevocheck: load-time prepare failed: %s",
                type(e).__name__,
            )

        self.file_watcher_service.set_event_loop(self._asyncio_loop)
        try:
            await asyncio.to_thread(self.file_watcher_service.prepare)
            self.file_watcher_service.start()
        except Exception as e:
            decky.logger.warning(
                "filewatcher: load-time prepare failed: %s",
                type(e).__name__,
            )

        try:
            cfg = self.settings_store.load_config()
            if self.settings_store.get_auto_purge_service(cfg):
                await asyncio.to_thread(self.cache_maintenance_service.run_startup_sweep)
        except Exception as e:
            decky.logger.warning(
                "cache_maintenance: startup sweep dispatch failed: %s",
                type(e).__name__,
            )

        self._spawn_background_task(self._delayed_startup_roster_check())

        await self._announce_changelog()

    async def _announce_changelog(self) -> None:
        version = installed_version()
        if not version or version == "unknown":
            return

        cfg = self.settings_store.load_config()
        if version == self.settings_store.get_changelog_version(cfg):
            return

        if not self.settings_store.get_viewed_intro(cfg):
            self.settings_store.save_changelog_version(version)
            return

        document = await self.load_help_document("changelog")
        text = str(document.get("text") or "").strip()
        if not text:
            return

        self.settings_store.save_changelog_version(version)
        decky.logger.info("changelog: first load on %s, announcing", version)

        if not is_type_enabled("system", self.settings_store, cfg):
            return

        self.notifications_store.append({
            "type": "system",
            "kind": "actionable",
            "iconSource": "none",
            "title": "What's New in CheevoDeck",
            "body": text,
            "source": "notifications",
            "target": {"view": "changelog"},
            "meta": {"version": version},
        })

    def _heal_active_username_from_ra(self, cfg: dict) -> None:
        active_ulid = str(cfg.get("activeUlid") or "").strip()
        web_api_key = str(cfg.get("webApiKey") or "").strip()
        slot_name = str(cfg.get("username") or "").strip()
        if not active_ulid or not web_api_key:
            return

        try:
            profile = self.ra.get_user_profile(active_ulid, web_api_key)
        except Exception as exc:
            decky.logger.info(
                "boot username heal skipped (%s): %s",
                type(exc).__name__,
                exc,
            )
            return

        canonical = str((profile or {}).get("User") or (profile or {}).get("user") or "").strip()
        returned_ulid = str((profile or {}).get("ULID") or (profile or {}).get("ulid") or "").strip()
        if not canonical or returned_ulid != active_ulid:
            return
        if canonical == slot_name:
            return

        self.settings_store.heal_active_username(canonical)
        decky.logger.info("boot username heal: %s -> %s", slot_name, canonical)

    async def _delayed_startup_roster_check(self):
        try:
            await asyncio.sleep(10)
            cfg = self.settings_store.load_config()
            username = str(cfg.get("username", "")).strip()
            web_api_key = str(cfg.get("webApiKey", "")).strip()
            if not username or not web_api_key:
                return
            async with self._ra_slot():
                await asyncio.to_thread(self._heal_active_username_from_ra, cfg)
                cfg = self.settings_store.load_config()
                username = str(cfg.get("username", "")).strip()

                if self.settings_store.get_battery_saver(cfg):
                    return

                await asyncio.to_thread(
                    self.friends_service.refresh_friends,
                    username,
                    web_api_key,
                    False,
                )
        except Exception as exc:
            decky.logger.warning(
                "startup roster check failed: %s (%s)",
                type(exc).__name__,
                exc,
            )

    async def _unload(self):
        self.social_activity_trickle_service.stop()
        self.players_near_you_service.stop()
        self.friends_roster_service.stop()
        self.comments_service.stop()
        self.notes_reminder_service.stop()
        self.tracked_sets_monitor_service.stop()
        self.update_checker_service.stop()
        self.developer_message_service.stop()
        self.file_watcher_service.stop()
        self._restore_deck_controller_safe()

    def _validate_credentials_or_raise(self, username: str, web_api_key: str, *, expected_ulid: str = "", skip_name_match: bool = False):
        username = str(username or "").strip()
        web_api_key = str(web_api_key or "").strip()
        expected_ulid = str(expected_ulid or "").strip()
        if not username or not web_api_key:
            raise CredentialError("Please enter your RetroAchievements username and Web API key.", "missing_fields")

        query_user = expected_ulid or username
        try:
            profile = self.ra.get_user_profile(query_user, web_api_key)
        except Exception as e:
            if is_network_error(e):
                decky.logger.exception("credential validation hit a network error: %s (%s)", type(e).__name__, e)
                raise CredentialError("Could not reach RetroAchievements. Please try again.", "network_error")
            decky.logger.warning("credential validation rejected (%s)", type(e).__name__)
            raise CredentialError("Invalid RetroAchievements username or Web API key. Please try again.", "invalid_credentials")

        profile_user = str((profile or {}).get("User") or (profile or {}).get("user") or "").strip()
        enforce_name_match = not expected_ulid and not skip_name_match
        if enforce_name_match and (not profile_user or profile_user.lower() != username.lower()):
            raise CredentialError("Invalid RetroAchievements username or Web API key. Please try again.", "invalid_credentials")

        raw_ulid = (profile or {}).get("ULID", (profile or {}).get("ulid"))
        ulid = str(raw_ulid or "").strip()
        if not ulid:
            raise CredentialError(
                "RetroAchievements didn't return a stable account ID for these credentials, so they can't be used. Please try again.",
                "no_stable_ulid",
            )

        if expected_ulid and ulid != expected_ulid:
            decky.logger.warning("credential validation rejected: account id mismatch")
            raise CredentialError("Invalid RetroAchievements username or Web API key. Please try again.", "invalid_credentials")

        return profile_user, ulid

    def _is_safe_user_dir_key(self, key: str) -> bool:
        if not key:
            return False
        return all(c in "0123456789ABCDEFGHJKMNPQRSTVWXYZ" for c in key)

    def _user_dir_key(self, cfg: dict) -> str:
        return str(cfg.get("activeUlid") or "")

    def _active_ra_user(self, cfg: dict) -> str:
        active_ulid = str(cfg.get("activeUlid") or "").strip()
        return active_ulid or str(cfg.get("username", "")).strip()

    def _apply_user_scope(self, user_key: str) -> None:
        if user_key and not self._is_safe_user_dir_key(user_key):
            decky.logger.warning("user dir key failed the safety check, using runtime_dir: %r", user_key)
            user_key = ""
        base = (self.runtime_dir / user_key) if user_key else self.runtime_dir
        if user_key:
            ensure_dir(base)

        try:
            self.settings_store.set_tracked_dir(base / "tracked")
            self.settings_store.set_favorites_file(base / "favorites.json")
            self.notes_store.repoint(base / "notes")
            self.guides_store.repoint(base / "guides")
            self.players_near_you_store.repoint(base / "players_near_you")
            self.game_activity_history_store.repoint(base / "game_activity_history")
            self.tracked_sets_store.repoint(base)
            self.subscriptions_store.repoint(base)
            self.saved_comments_store.repoint(base)
            self.comment_baselines_store.repoint(base)
            self.notifications_store.repoint(base)
            self.notifications_archive_store.repoint(base)
            self.cache_store.repoint_user_scope(base)
        except Exception:
            decky.logger.exception(
                "user scope repoint FAILED partway through for base=%s — the per-account "
                "stores may now be split across two accounts. Reload the plugin to re-point "
                "them together; background services that compare two stores will sit out "
                "until you do.",
                base,
            )
            raise

    async def get_settings(self):
        cfg = self.settings_store.load_config()

        response = self.settings_store.settings_response(cfg)
        response["isSteamMachine"] = self._is_steam_machine()
        return response

    def _is_steam_machine(self) -> bool:
        cached = getattr(self, "_is_steam_machine_cached", None)
        if cached is not None:
            return cached
        try:
            name = Path("/sys/class/dmi/id/product_name").read_text(
                encoding="utf-8", errors="ignore"
            ).strip()
        except OSError:
            name = ""
        result = name.lower() == "fremont"
        self._is_steam_machine_cached = result
        return result

    async def save_settings(self, username: str, webApiKey: str):
        cfg = self.settings_store.load_config()
        next_username = str(username or "").strip()
        next_key = str(webApiKey or "").strip()
        current_key = str(cfg.get("webApiKey", "") or "").strip()
        current_username = str(cfg.get("username", "") or "").strip()
        key_to_validate = next_key or current_key
        active_ulid = str(cfg.get("activeUlid") or "").strip()

        canonical, validated_ulid = self._validate_credentials_or_raise(
            next_username,
            key_to_validate,
            skip_name_match=bool(active_ulid),
        )

        is_first_time_setup = (not current_username) and (not current_key)

        if is_first_time_setup or not active_ulid:
            self.settings_store.add_user(canonical, key_to_validate, validated_ulid)
            cfg = self.settings_store.activate_user(canonical, validated_ulid)
            self._apply_user_scope(self._user_dir_key(cfg))

        elif validated_ulid == active_ulid:
            cfg = self.settings_store.update_credentials(canonical, key_to_validate)

        else:
            raise ValueError(
                "These credentials are for a different RetroAchievements account. Edit Credentials only updates your current account -- to add or switch to another account, use Add User in Options."
            )

        self._spawn_background_task(self._post_credentials_roster_check(
            next_username,
            next_key or current_key,
        ))

        return {
            "ok": True,
            **self.settings_store.settings_response(cfg),
        }

    def _run_clear_under_trickle_lock(self, clear_fn):
        with self._clear_waiting_lock:
            self._clear_waiting += 1
        try:
            with self._trickle_tick_lock:
                return clear_fn()
        finally:
            with self._clear_waiting_lock:
                self._clear_waiting -= 1

    async def _post_credentials_roster_check(self, username: str, web_api_key: str):
        try:
            await asyncio.sleep(3)
            async with self._ra_slot():
                await asyncio.to_thread(
                    self.friends_service.refresh_friends,
                    username,
                    web_api_key,
                    True,
                )
            try:
                self.friends_roster_service.wake_now()
            except Exception:
                pass
        except Exception as exc:
            decky.logger.warning(
                "post-credentials roster check failed: %s (%s)",
                type(exc).__name__,
                exc,
            )

    async def add_user(self, username: str, webApiKey: str):
        async with self._ra_slot():
            _canonical, validated_ulid = await asyncio.to_thread(
                self._validate_credentials_or_raise, username, webApiKey
            )
        users = await asyncio.to_thread(self.settings_store.add_user, username, webApiKey, validated_ulid)

        return {"ok": True, "users": users}

    async def remove_user(self, username: str):
        users = await asyncio.to_thread(self.settings_store.remove_user, username)

        return {"ok": True, "users": users}

    async def switch_user(self, username: str):
        target = str(username or "").strip()
        if not target:
            raise Exception("No account selected to switch to.")

        stored_key = await asyncio.to_thread(self.settings_store.get_user_key, target)
        if not stored_key:
            raise Exception("That account is no longer saved. Add it again and retry.")
        saved_ulid = await asyncio.to_thread(self.settings_store.get_user_ulid, target)

        try:
            async with self._ra_slot():
                canonical, validated_ulid = await asyncio.to_thread(
                    self._validate_credentials_or_raise,
                    target,
                    stored_key,
                    expected_ulid=saved_ulid,
                )
        except CredentialError as e:
            if e.code == "network_error":
                return {"ok": False, "error": "network_error"}

            rejected_cfg = await asyncio.to_thread(
                self._switch_commit_under_trickle_lock, target, target, saved_ulid
            )

            inject_result = None
            inject_enabled = await asyncio.to_thread(self._inject_enabled_now)
            connect_token, connect_hardcore = await asyncio.to_thread(
                self.settings_store.get_user_connect_login, target
            )
            if inject_enabled and connect_token:
                running = await asyncio.to_thread(self.emulator_login_sync_service.detect_running_emulators)
                if not running:
                    inject_result = await asyncio.to_thread(
                        self._inject_under_trickle_lock, target, connect_token, connect_hardcore
                    )

            await decky.emit(NOTIFICATION_EVENT, {"toast": False})
            return {
                "ok": True,
                "credentialsRejected": True,
                "inject": inject_result,
                **self.settings_store.settings_response(rejected_cfg),
            }

        inject_enabled = await asyncio.to_thread(self._inject_enabled_now)
        connect_token, connect_hardcore = await asyncio.to_thread(
            self.settings_store.get_user_connect_login, target
        )
        want_inject = inject_enabled and bool(connect_token)
        if want_inject:
            running = await asyncio.to_thread(self.emulator_login_sync_service.detect_running_emulators)
            if running:
                return {"ok": False, "error": "emulator-running", "emulators": running}

        cfg = await asyncio.to_thread(self._switch_commit_under_trickle_lock, target, canonical, validated_ulid)

        inject_result = None
        if want_inject:
            inject_result = await asyncio.to_thread(
                self._inject_under_trickle_lock, canonical, connect_token, connect_hardcore
            )

        await decky.emit(NOTIFICATION_EVENT, {"toast": False})

        active_name = str(cfg.get("username") or "")
        active_key = str(cfg.get("webApiKey") or "")
        self._spawn_background_task(self._post_credentials_roster_check(active_name, active_key))

        return {
            "ok": True,
            "inject": inject_result,
            **self.settings_store.settings_response(cfg),
        }

    def _switch_commit_under_trickle_lock(self, username: str, canonical: str, ulid: str):
        with self._trickle_tick_lock:
            cfg = self.settings_store.activate_user(username, ulid)

            slot_name = str(cfg.get("username") or "").strip()
            if canonical and canonical != slot_name:
                cfg = self.settings_store.heal_active_username(canonical)

            self._apply_user_scope(self._user_dir_key(cfg))
            self.notes_reminder_service.reset_pending()

            return cfg

    def _inject_enabled_now(self) -> bool:
        return self.settings_store.get_inject_emulator_login(self.settings_store.load_config())

    def _inject_under_trickle_lock(self, username: str, token: str, hardcore: bool):
        with self._trickle_tick_lock:
            return self.emulator_login_sync_service.inject(username, token, hardcore)

    async def generate_connect_token(self, username: str, password: str, hardcore: bool):
        target = str(username or "").strip()
        if not target:
            return {"ok": False, "error": "missing_fields"}

        try:
            async with self._ra_slot():
                token = await asyncio.to_thread(self.ra.fetch_connect_token, target, password)
        except RuntimeError as e:
            return {"ok": False, "error": "invalid_credentials", "message": str(e)}
        except Exception as e:
            if is_network_error(e):
                return {"ok": False, "error": "network_error"}
            raise

        users = await asyncio.to_thread(
            self.settings_store.set_connect_login, target, token, bool(hardcore)
        )
        return {"ok": True, "users": users}

    async def clear_connect_login(self, username: str):
        target = str(username or "").strip()
        users = await asyncio.to_thread(self.settings_store.clear_connect_login, target)

        return {"ok": True, "users": users}

    def _log_inject_debug(self, stage, extra=""):
        if not getattr(self, "_debug_logging", False):
            return
        text = str(extra or "").strip()
        if text:
            decky.logger.info("inject: %s %s", stage, text)
        else:
            decky.logger.info("inject: %s", stage)

    async def reinject_active_login(self):
        self._log_inject_debug("reinject", "start")
        cfg = await asyncio.to_thread(self.settings_store.load_config)
        if not self.settings_store.get_inject_emulator_login(cfg):
            self._log_inject_debug("reinject-skip", "inject toggle off")
            return {"ok": True, "outcome": "disabled"}

        active_name = str(cfg.get("username") or "").strip()
        connect_token, connect_hardcore = await asyncio.to_thread(
            self.settings_store.get_user_connect_login, active_name
        )
        if not active_name or not connect_token:
            self._log_inject_debug(
                "reinject-skip",
                "no token for name=%s (token=%s)" % (active_name or "(none)", "yes" if connect_token else "no"),
            )
            return {"ok": True, "outcome": "no-token"}

        running = await asyncio.to_thread(self.emulator_login_sync_service.detect_running_emulators)
        if running:
            self._log_inject_debug("reinject-skip", "emulator running: %s" % ", ".join(running))
            return {"ok": False, "error": "emulator-running", "emulators": running}

        result = await asyncio.to_thread(
            self._inject_under_trickle_lock, active_name, connect_token, connect_hardcore
        )
        return {"ok": True, "outcome": "injected", "inject": result}

    async def log_comments_debug_event(self, stage=None, target_id=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        id_text = str(target_id or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("comments: %s %s %s", stage_text, id_text, extra_text)
        else:
            decky.logger.info("comments: %s %s", stage_text, id_text)
        return {"ok": True}

    async def log_wanttoplay_debug_event(self, stage=None, username=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        user_text = str(username or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("wtp: %s %s %s", stage_text, user_text, extra_text)
        else:
            decky.logger.info("wtp: %s %s", stage_text, user_text)
        return {"ok": True}

    async def log_friend_fetch_debug_event(self, stage=None, friend=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        friend_text = str(friend or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("ffetch: %s %s %s", stage_text, friend_text, extra_text)
        else:
            decky.logger.info("ffetch: %s %s", stage_text, friend_text)
        return {"ok": True}

    async def log_inject_debug_event(self, stage=None, who=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        who_text = str(who or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("inject: %s %s %s", stage_text, who_text, extra_text)
        else:
            decky.logger.info("inject: %s %s", stage_text, who_text)
        return {"ok": True}

    async def log_sort_debug_event(self, stage=None, who=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        who_text = str(who or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("sort: %s %s %s", stage_text, who_text, extra_text)
        else:
            decky.logger.info("sort: %s %s", stage_text, who_text)
        return {"ok": True}

    async def log_nav_debug_event(self, stage=None, view=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        view_text = str(view or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("nav: %s %s %s", stage_text, view_text, extra_text)
        else:
            decky.logger.info("nav: %s %s", stage_text, view_text)
        return {"ok": True}

    async def log_focus_debug_event(self, stage=None, key=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        key_text = str(key or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("focus: %s %s %s", stage_text, key_text, extra_text)
        else:
            decky.logger.info("focus: %s %s", stage_text, key_text)
        return {"ok": True}

    async def log_guides_debug_event(self, stage=None, key=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        key_text = str(key or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("guides: %s %s %s", stage_text, key_text, extra_text)
        else:
            decky.logger.info("guides: %s %s", stage_text, key_text)
        return {"ok": True}

    async def log_notifications_debug(self, stage=None, key=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        key_text = str(key or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("notifications-debug: %s %s %s", stage_text, key_text, extra_text)
        else:
            decky.logger.info("notifications-debug: %s %s", stage_text, key_text)
        return {"ok": True}

    async def log_sysview_debug_event(self, stage=None, console_name=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        console_text = str(console_name or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("sysview: %s %s %s", stage_text, console_text, extra_text)
        else:
            decky.logger.info("sysview: %s %s", stage_text, console_text)
        return {"ok": True}

    async def log_cardcorner_debug_event(self, stage=None, key=None, extra=None):
        if not getattr(self, "_debug_logging", False):
            return {"ok": True}
        stage_text = str(stage or "").strip() or "?"
        key_text = str(key or "").strip() or "?"
        extra_text = str(extra or "").strip()
        if extra_text:
            decky.logger.info("corner: %s %s %s", stage_text, key_text, extra_text)
        else:
            decky.logger.info("corner: %s %s", stage_text, key_text)
        return {"ok": True}

    async def reset_option_settings(self):
        was_frozen = self._guides_frozen()
        cfg = self.settings_store.reset_option_settings()
        self._restart_guide_clock_if_thawed(was_frozen)
        self.players_near_you_service.wake_for_reschedule()
        self.social_activity_trickle_service.wake_for_reschedule()

        return {
            "ok": True,
            **self.settings_store.settings_response(cfg),
        }

    async def apply_setup_profile(self, profile: str, preserve_other_settings: bool = False):
        was_frozen = self._guides_frozen()
        cfg = self.settings_store.apply_setup_profile(profile, preserve_other_settings)
        self._restart_guide_clock_if_thawed(was_frozen)
        self.players_near_you_service.wake_for_reschedule()
        self.social_activity_trickle_service.wake_for_reschedule()

        return {
            "ok": True,
            **self.settings_store.settings_response(cfg),
        }

    async def mark_intro_viewed(self):
        self.settings_store.update_viewed_intro(True)

        return {
            "ok": True,
            "viewedIntro": True,
        }

    async def announce_welcome(self):
        """The greeting, posted when the last of the intro modals closes."""
        document = await self.load_help_document("welcome")
        text = str(document.get("text") or "").strip()
        if not text:
            return {"ok": True, "announced": False}

        cfg = self.settings_store.load_config()
        decky.logger.info("welcome: intro finished, announcing")

        if is_type_enabled("system", self.settings_store, cfg):
            self.notifications_store.append({
                "type": "system",
                "kind": "actionable",
                "iconSource": "none",
                "title": "Message from FAILINATOR5000",
                "body": text,
                "source": "notifications",
                "target": {"view": "message"},
                "meta": {"welcome": True},
            })

        emit_notification(
            ntype="system",
            title_key="Message from FAILINATOR5000",
            line_key="View in Notifications",
            settings_store=self.settings_store,
            event_loop=self._asyncio_loop,
        )

        return {"ok": True, "announced": True}

    async def clear_api_key(self):
        self.settings_store.clear_api_key()

        return {
            "ok": True,
        }

    async def clear_cache(self):
        def _clear_everything():
            cleared = self.cache_store.clear_all()
            cleared += self.players_near_you_store.clear_all_games()
            cleared += self.game_activity_history_store.clear_all_games()
            cleared += self.games_list_cache_store.clear_all()
            cleared += self.awards_list_cache_store.clear_all()
            cleared += self.want_to_play_cache_store.clear_all()
            cleared += self.guides_store.clear_cache().get("removed", [])
            cleared += self.cheevo_check_store.clear_hash_cache()
            cleared += self.cheevo_check_store.clear_ra_data()
            return cleared

        self.players_near_you_service.note_cache_cleared()
        cleared = await asyncio.to_thread(
            self._run_clear_under_trickle_lock,
            _clear_everything,
        )
        return {
            "ok": True,
            "cleared": cleared,
        }

    UNTICKED_CLEAR_GROUPS = frozenset((
        "cheevoCheckResults",
        "cheevoCheckHashes",
        "cheevoCheckRaData",
    ))

    async def clear_cache_group(self, group=None):
        group_key = str(group or "").strip()
        dispatch = {
            "gameData": self.cache_store.clear_game_data,
            "leaderboards": self.cache_store.clear_leaderboards,
            "friendGamePayloads": self.cache_store.clear_friend_game_payloads,
            "friends": self.cache_store.clear_friends,
            "images": self.cache_store.clear_images,
            "awardIcons": self.cache_store.clear_award_icons,
            "socialActivity": self.cache_store.clear_social_activity,
            "gameActivity": self.game_activity_history_store.clear_all_games,
            "playersNearYou": self.players_near_you_store.clear_all_games,
            "gamesList": self.games_list_cache_store.clear_all,
            "awardsList": self.awards_list_cache_store.clear_all,
            "wantToPlayList": self.want_to_play_cache_store.clear_all,
            "setsList": self.cache_store.clear_sets_list_cache,
            "cheevoCheckResults": self.cheevo_check_store.clear_results,
            "cheevoCheckHashes": self.cheevo_check_store.clear_hash_cache,
            "cheevoCheckRaData": self.cheevo_check_store.clear_ra_data,
        }
        clear_fn = dispatch.get(group_key)
        if clear_fn is None:
            return {
                "ok": False,
                "error": f"Unknown cache group '{group_key}'.",
                "cleared": [],
            }
        if group_key == "playersNearYou":
            self.players_near_you_service.note_cache_cleared()
        if group_key in self.UNTICKED_CLEAR_GROUPS:
            cleared = await asyncio.to_thread(clear_fn)
        else:
            cleared = await asyncio.to_thread(
                self._run_clear_under_trickle_lock,
                clear_fn,
            )
        if getattr(self, "_debug_logging", False):
            decky.logger.info(
                "cache clear: group=%s removed=%s sample=%s",
                group_key,
                len(cleared),
                cleared[:5],
            )
            if group_key == "gameActivity":
                decky.logger.info(
                    "cache clear: gameActivity dir=%s",
                    self.game_activity_history_store.store_dir,
                )
        return {
            "ok": True,
            "group": group_key,
            "cleared": cleared,
        }

    async def clear_resolved_avatars(self):
        counts = await asyncio.to_thread(
            self._run_clear_under_trickle_lock,
            self.resolved_avatar_store.clear,
        )
        return {
            "ok": True,
            **counts,
        }

    def _sweep_orphan_user_dirs(self) -> int:
        cfg = self.settings_store.load_config()

        keep = {
            str(record.get("ulid") or "").strip()
            for record in (cfg.get("users") or [])
        }
        keep.add(str(cfg.get("activeUlid") or "").strip())
        keep.discard("")

        removed = 0
        for entry in self.runtime_dir.iterdir():
            if not entry.is_dir():
                continue
            if not self._is_safe_user_dir_key(entry.name):
                continue
            if entry.name in keep:
                continue
            try:
                shutil.rmtree(entry)
                removed += 1
            except FileNotFoundError:
                pass
        return removed

    async def cleanup_user_directories(self):
        removed = await asyncio.to_thread(
            self._run_clear_under_trickle_lock,
            self._sweep_orphan_user_dirs,
        )
        return {"ok": True, "removed": removed}

    def _empty_dir_contents(self, target: Path) -> None:
        if not target.exists():
            return
        for entry in target.iterdir():
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry, ignore_errors=True)
            else:
                try:
                    entry.unlink()
                except FileNotFoundError:
                    pass

    def _run_factory_reset_locked(self) -> None:
        with self._trickle_tick_lock:
            def _wipe():
                self._empty_dir_contents(self.runtime_dir)
                self._empty_dir_contents(self.settings_dir)

                version = installed_version()
                if version and version != "unknown":
                    self.settings_store.save_changelog_version(version)

            self.settings_store.run_under_config_lock(_wipe)

            self._apply_user_scope("")
            self.notes_reminder_service.reset_pending()
            self.file_watcher_service.prepare()
            self.file_watcher_service.start()

    async def factory_reset(self):
        self.players_near_you_service.note_cache_cleared()

        await asyncio.to_thread(self.file_watcher_service.quiesce)

        await asyncio.to_thread(self._run_factory_reset_locked)
        return {"ok": True}

    async def get_cached_payload(self):
        cached = self.cache_store.load_payload()
        return {"payload": cached.get("payload")}

    async def get_plugin_version(self):
        version = getattr(decky, "DECKY_PLUGIN_VERSION", "") or "unknown"
        return {"version": version}

    async def take_snapshot(self):
        return await asyncio.to_thread(snapshot.capture)

    async def get_update_status(self):
        return await asyncio.to_thread(self.update_checker_service.get_status)

    async def check_for_update_now(self):
        return await asyncio.to_thread(self.update_checker_service.check, True)

    async def download_update_zip(self, dest_dir):
        return await asyncio.to_thread(
            self.update_checker_service.download_release, dest_dir
        )

    async def place_desktop_updater(self):
        return await asyncio.to_thread(
            self.update_checker_service.place_desktop_launcher
        )

    async def get_resume_state(self):
        return {
            "ok": True,
            "resumeState": self.settings_store.load_resume_state(),
        }

    async def save_resume_state(self, resume_state=None):
        return {
            "ok": True,
            "resumeState": self.settings_store.save_resume_state(resume_state),
        }

    async def clear_resume_state(self):
        self.settings_store.save_resume_state(None)
        return {"ok": True}


for _name in dir(Plugin):
    _attr = getattr(Plugin, _name)
    if asyncio.iscoroutinefunction(_attr):
        setattr(Plugin, _name, _timed_ipc(_attr))
