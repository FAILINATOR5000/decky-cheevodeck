from contextlib import AbstractAsyncContextManager
from pathlib import Path

import ssl
import asyncio
import threading

from cache_store import CacheStore
from ra_client import RetroAchievementsClient
from services.cheevo_check_service import CheevoCheckService
from services.current_game_service import CurrentGameService
from services.file_watcher_service import FileWatcherService
from services.friends_service import FriendsService
from services.friends_roster_service import FriendsRosterService
from services.game_activity_history_service import GameActivityHistoryService
from services.icon_service import IconService
from services.leaderboards_service import LeaderboardsService
from services.social_activity_cache_service import SocialActivityCacheService
from services.social_activity_trickle_service import SocialActivityTrickleService
from services.players_near_you_service import PlayersNearYouService
from services.smb_mount_service import SmbMountService
from services.notes_reminder_service import NotesReminderService
from services.news_service import NewsService
from services.aotw_service import AotwService
from services.game_comments_service import GameCommentsService
from services.game_hashes_service import GameHashesService
from services.comments_service import CommentsService
from services.new_sets_service import NewSetsService
from services.tracked_sets_monitor_service import TrackedSetsMonitorService
from guides_store import GuidesStore
from notes_store import NotesStore
from players_near_you_store import PlayersNearYouStore
from games_list_cache_store import GamesListCacheStore
from awards_list_cache_store import AwardsListCacheStore
from want_to_play_cache_store import WantToPlayCacheStore
from tracked_sets_store import TrackedSetsStore
from subscriptions_store import SubscriptionsStore
from saved_comments_store import SavedCommentsStore
from comment_baselines_store import CommentBaselinesStore
from resolved_avatar_store import ResolvedAvatarStore
from cheevo_check_store import CheevoCheckStore
from file_watcher_store import FileWatcherStore
from dolphin_mappings_store import DolphinMappingsStore
from smb_shares_store import SmbSharesStore
from settings_store import SettingsStore
from notifications import NotificationsStore


class PluginContext:
    ra: RetroAchievementsClient
    awards_list_cache_store: AwardsListCacheStore
    cache_store: CacheStore
    cheevo_check_store: CheevoCheckStore
    file_watcher_store: FileWatcherStore
    comment_baselines_store: CommentBaselinesStore
    games_list_cache_store: GamesListCacheStore
    guides_store: GuidesStore
    notes_store: NotesStore
    notifications_store: NotificationsStore
    players_near_you_store: PlayersNearYouStore
    resolved_avatar_store: ResolvedAvatarStore
    want_to_play_cache_store: WantToPlayCacheStore
    settings_store: SettingsStore
    subscriptions_store: SubscriptionsStore
    saved_comments_store: SavedCommentsStore
    tracked_sets_store: TrackedSetsStore
    dolphin_mappings_store: DolphinMappingsStore
    smb_shares_store: SmbSharesStore
    _ssl_ctx: ssl.SSLContext
    dolphin_defaults_dir: Path
    help_dir: Path
    runtime_dir: Path
    user_home: Path
    aotw_service: AotwService
    cheevo_check_service: CheevoCheckService
    comments_service: CommentsService
    current_game_service: CurrentGameService
    file_watcher_service: FileWatcherService
    friends_roster_service: FriendsRosterService
    friends_service: FriendsService
    game_activity_history_service: GameActivityHistoryService
    game_comments_service: GameCommentsService
    game_hashes_service: GameHashesService
    icon_service: IconService
    leaderboards_service: LeaderboardsService
    new_sets_service: NewSetsService
    news_service: NewsService
    notes_reminder_service: NotesReminderService
    players_near_you_service: PlayersNearYouService
    smb_mount_service: SmbMountService
    social_activity_cache_service: SocialActivityCacheService
    social_activity_trickle_service: SocialActivityTrickleService
    tracked_sets_monitor_service: TrackedSetsMonitorService
    _asyncio_loop: asyncio.AbstractEventLoop | None
    _comments_cache: dict
    _comments_cache_lock: threading.Lock
    _debug_logging: bool
    _friend_fetch_lock: asyncio.Lock
    _ipc_slow_threshold_ms: int
    _validate_friends_roster: bool

    def _ra_slot(self, wait_for_game_check: bool = True) -> AbstractAsyncContextManager[None]: ...
    def _image_slot(self) -> AbstractAsyncContextManager[None]: ...
    def _game_check_slot(self) -> AbstractAsyncContextManager[None]: ...
    def _active_ra_user(self, cfg: dict) -> str: ...
    def _run_clear_under_trickle_lock(self, clear_fn): ...
