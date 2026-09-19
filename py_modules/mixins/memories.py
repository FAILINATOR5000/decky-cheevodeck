import asyncio
import base64
import time
from pathlib import Path

import decky
import memories_capture
import memories_clips
import memories_resolver
import memories_thumbs

from services import memories_video_service

from memories_store import ALL_GAMES_ID, MISC_GAME_ID
from mixins._context import PluginContext
from utils import norm_game_id, to_int


_RESOLVE_COOLDOWN_SECONDS = 5

FULL_IMAGE_MAX_BYTES = 6 * 1024 * 1024


def _read_slice(path: Path, offset: int, limit: int):
    """Bytes ``offset`` onwards from ``path``, at most ``limit`` of them.

    Returns the bytes and the file's whole size, so a caller reading in pieces
    knows when it has them all without a second call. A limit of zero reads to
    the end.
    """
    with path.open("rb") as handle:
        size = handle.seek(0, 2)
        handle.seek(offset)
        return handle.read(limit) if limit > 0 else handle.read(), size


def _boot_seconds() -> float:
    return time.clock_gettime(time.CLOCK_BOOTTIME)


class MemoriesMixin(PluginContext):

    async def save_memories_auto_capture(self, value: bool):
        return {
            "ok": True,
            "memoriesAutoCapture": self.settings_store.update_memories_auto_capture(value),
        }

    async def save_memories_delete_source(self, value: bool):
        return {
            "ok": True,
            "memoriesDeleteSource": self.settings_store.update_memories_delete_source(value),
        }

    async def save_memories_per_page(self, value):
        return {
            "ok": True,
            "memoriesPerPage": self.settings_store.update_memories_per_page(value),
        }

    async def save_memories_video(self, value: bool):
        return {
            "ok": True,
            "memoriesVideo": self.settings_store.update_memories_video(value),
        }

    async def save_memories_remux(self, value: bool):
        return {
            "ok": True,
            "memoriesRemux": self.settings_store.update_memories_remux(value),
        }

    async def save_memories_delete_steam_clip(self, value: bool):
        return {
            "ok": True,
            "memoriesDeleteSteamClip": self.settings_store.update_memories_delete_steam_clip(value),
        }

    async def start_memories_video_move(self, value):
        """Move the clip copies to a directory the user picked.

        The setting is not written here. It is flipped by the service once every
        file has landed and been checked, so a move that fails leaves both the
        old files and the old setting exactly as they were. An empty value moves
        them back to the default location, which is the same journey in reverse
        rather than a separate path.
        """
        picked = str(value or "").strip()

        def settled(root):
            self.settings_store.update_memories_video_path(picked)
            self.memories_store.set_videos_root(root)

        current = self.settings_store.get_memories_video_path(self.settings_store.load_config())
        return self.memories_video_service.start(
            self.memories_store.videos_root(), current != "", picked, settled
        )

    async def memories_video_move_status(self):
        """How far the move has got, and where the copies live now.

        The location travels with the progress because the move flips the
        setting itself, so this is the only thing that can tell the panel the
        files have landed somewhere new. ``rootAvailable`` is false when the
        drive holding them is not mounted, which is not the same as the videos
        being gone.
        """
        picked = self.settings_store.get_memories_video_path(self.settings_store.load_config())
        root = self.memories_store.videos_root()
        return {
            **self.memories_video_service.status(),
            "picked": picked,
            "root": str(root),
            "rootAvailable": memories_video_service.root_available(root, picked != ""),
        }

    async def cancel_memories_video_move(self):
        """Stop a move in flight and put back whatever it had copied.

        The setting and the original files are untouched by a cancel, so the
        answer to one is the state the user was already in.
        """
        return self.memories_video_service.cancel()

    async def read_memory_clip_part(self, game_id, memory_id: str, name: str, offset=0, limit=0):
        """Part of one file out of a memory's own copy of a clip, base64 encoded.

        The panel cannot open a local path and nothing serves this tree over
        HTTP, so playback of an owned clip goes through here. ``offset`` and
        ``limit`` cut a piece out of the middle of a segment; a limit of zero
        reads the whole file, which is what the manifest and the init segments
        want. The reply always carries ``size``, the length of the whole file,
        because the player uses it to tell a piece that ends a segment from one
        that has more behind it.

        This route carries about twenty megabytes a second, so a 4K segment is
        half a second on its own. That is the reason for the pieces: the player
        can start on the first of them rather than on all ten megabytes.
        """
        if not memories_clips.is_segment_name(name):
            return {"ok": False, "error": "bad_name"}

        folder = await asyncio.to_thread(
            self.memories_store.video_source_for, game_id, str(memory_id or "")
        )
        if folder is None:
            return {"ok": False, "error": "not_found", "rootAvailable": True}

        start = max(to_int(offset, 0), 0)
        span = max(to_int(limit, 0), 0)
        try:
            raw, size = await asyncio.to_thread(_read_slice, folder / name, start, span)
        except OSError as e:
            picked = self.settings_store.get_memories_video_path(self.settings_store.load_config())
            available = memories_video_service.root_available(
                self.memories_store.videos_root(), picked != ""
            )
            if not available or not isinstance(e, FileNotFoundError):
                decky.logger.warning(
                    "memories: couldn't read %s for memory %s (%s)",
                    name, memory_id, type(e).__name__,
                )
            return {"ok": False, "error": "unreadable", "rootAvailable": available}

        return {"ok": True, "data": base64.b64encode(raw).decode("ascii"), "size": size}

    async def load_memories(self, game_id=None):
        """Every memory for one game, newest first.

        Unchunked, unlike the thumbnails: the page needs the whole filtered list
        to count it, sort it and page through it, so handing it back in pieces
        would only move the assembly.

        The All Games sentinel asks for every game at once instead, which is the
        one read in the feature that lists anything.
        """
        if to_int(game_id, ALL_GAMES_ID) == ALL_GAMES_ID:
            return await asyncio.to_thread(self.memories_store.load_all)
        return await asyncio.to_thread(self.memories_store.load_for_game, game_id)

    async def load_memory_games(self):
        """Every game this account has memories for, with its count."""
        return await asyncio.to_thread(self.memories_store.games_with_memories)

    async def load_memory_thumbs(self, items=None):
        """Grid tiles for a page of memories, as data URIs.

        ``items`` is a list of ``{"gameId": n, "path": s}``. Each carries its own
        game id because an All Games page mixes them, and the thumbnail tree is
        keyed per game.

        Chunked by the caller at twelve rather than the plugin's usual
        twenty-four, because a thumbnail is around 15 KB where an icon is 2 KB
        and a full page would otherwise be the largest message the plugin moves.
        Anything missing a tile is generated here, four at a time.
        """
        return await asyncio.to_thread(self._load_memory_thumbs_sync, items or [])

    def _load_memory_thumbs_sync(self, items):
        jobs = []
        games = set()
        for item in items:
            if not isinstance(item, dict):
                continue
            relative = item.get("path")
            if not isinstance(relative, str) or not relative:
                continue
            game_id = norm_game_id(item.get("gameId"))
            if game_id is None:
                game_id = MISC_GAME_ID
            games.add(game_id)
            jobs.append((
                relative,
                self.memories_store.picture_path(relative),
                self.memories_store.thumb_path(game_id, relative),
            ))
        if not jobs:
            return {"ok": True, "thumbs": {}}

        for game_id in games:
            try:
                self.memories_store.ensure_thumb_dir(game_id)
            except OSError as e:
                decky.logger.warning("memories: couldn't prepare the thumbnail folder (%s)", type(e).__name__)

        made = memories_thumbs.fill_missing(jobs)
        thumbs = {}
        for relative, _source, _destination in jobs:
            landed = made.get(relative)
            thumbs[relative] = memories_thumbs.read_as_data_uri(landed) if landed else None
        return {"ok": True, "thumbs": thumbs}

    async def load_memory_full(self, game_id=None, path: str = ""):
        """One memory at full size, for the viewer.

        The largest message this plugin moves. Past the cap the tile is served
        instead of the picture: a slightly soft image beats a modal that never
        opens.
        """
        return await asyncio.to_thread(self._load_memory_full_sync, game_id, path)

    def _load_memory_full_sync(self, game_id, path):
        if not isinstance(path, str) or not path:
            return {"ok": False, "dataUri": None}

        picture = self.memories_store.picture_path(path)
        try:
            size = picture.stat().st_size
        except OSError:
            return {"ok": False, "dataUri": None}

        if size > FULL_IMAGE_MAX_BYTES:
            thumb = self.memories_store.thumb_path(game_id, path)
            return {
                "ok": True,
                "downscaled": True,
                "dataUri": memories_thumbs.read_as_data_uri(thumb) if thumb.exists() else None,
            }

        return {"ok": True, "downscaled": False, "dataUri": memories_thumbs.read_as_data_uri(picture)}

    async def update_memory(self, game_id=None, memory_id: str = "", caption=None, tag=None, color=None):
        return await asyncio.to_thread(
            self.memories_store.update_memory,
            game_id,
            memory_id,
            caption=caption,
            tag=tag,
            color=color,
        )

    async def delete_memory(self, game_id=None, memory_id: str = ""):
        return await asyncio.to_thread(self.memories_store.delete_memory, game_id, memory_id)

    async def delete_all_memories(self):
        """Remove every memory for the active account, pictures included.

        The only bulk destructive path in the feature, and the only thing in the
        plugin that removes files from the user's Pictures folder in one go.
        """
        result = await asyncio.to_thread(self.memories_store.delete_all)
        decky.logger.info("memories: deleted all %s for this account", result.get("removed", 0))
        return result

    async def load_memory_view_prefs(self):
        return await asyncio.to_thread(self.memories_store.load_view_prefs)

    async def save_memory_view_prefs(
        self,
        grid_columns=None,
        date_order=None,
        last_game_id=None,
        seeded_for_game_id=None,
        last_tag_filter=None,
        last_color_filter=None,
        last_media_filter=None,
        tag_sort=None,
    ):
        return await asyncio.to_thread(
            self._save_view_prefs_sync,
            grid_columns,
            date_order,
            last_game_id,
            seeded_for_game_id,
            last_tag_filter,
            last_color_filter,
            last_media_filter,
            tag_sort,
        )

    def _save_view_prefs_sync(
        self,
        grid_columns,
        date_order,
        last_game_id,
        seeded_for_game_id,
        last_tag_filter,
        last_color_filter,
        last_media_filter,
        tag_sort,
    ):
        return self.memories_store.save_view_prefs(
            grid_columns=grid_columns,
            date_order=date_order,
            last_game_id=last_game_id,
            seeded_for_game_id=seeded_for_game_id,
            last_tag_filter=last_tag_filter,
            last_color_filter=last_color_filter,
            last_media_filter=last_media_filter,
            tag_sort=tag_sort,
        )

    async def adopt_screenshot(self, path: str = "", app_id=0, created_at=0, screenshot_game_id: str = ""):
        """File one of Steam's screenshots as a memory.

        Called from the screenshot notification with everything already in hand:
        the absolute path Steam resolved, the appid of the app that was running,
        the capture time, and the id off the event itself. Nothing is inferred
        and nothing is polled.

        ``screenshot_game_id`` is the event's own id, which is the running
        appid's low 24 bits and is lossy. It is used only to address Steam's
        uncompressed copy, never to identify the game.

        Returns ``{"ok": False, "error": ...}`` for every decline, which the
        caller treats as "no memory" rather than as a failure. ``deleteSource``
        on a successful reply says whether the caller may remove Steam's copy.
        """
        async with self._memories_adopt_lock:
            result = await asyncio.to_thread(
                self._adopt_screenshot_sync, path, app_id, created_at, screenshot_game_id
            )
        if result.get("ok"):
            self._schedule_memory_resolve(result.get("gameId"))
        return result

    async def adopt_clip(
        self,
        clip_id: str = "",
        game_id: str = "",
        recorded_at=0,
        duration_ms=0,
        file_size=0,
    ):
        """File one of Steam's saved clips as a memory.

        Called from the clip notification with the summary it carried.
        ``game_id`` is Steam's packed CGameID and ``recorded_at`` is the clip's
        own first frame.

        Two things land on disk: one poster frame in the pictures tree, and a
        copy of the clip's manifest and segments in the video tree. The record
        points at the copy, so it keeps working after Steam loses its own.

        Returns ``{"ok": False, "error": ...}`` for every decline, which the
        caller treats as "no memory" rather than as a failure.
        """
        async with self._memories_adopt_lock:
            result = await asyncio.to_thread(
                self._adopt_clip_sync, clip_id, game_id, recorded_at,
                duration_ms, file_size,
            )
        if result.get("ok"):
            self._schedule_memory_resolve(
                result.get("gameId"), forward_seconds=to_int(duration_ms, 0) // 1000
            )
        return result

    def _schedule_memory_resolve(self, game_id, forward_seconds: int = 0) -> None:
        """Ask for the context behind a fresh capture, twice over.

        A forced game check runs straight away unless one just did, because the
        unlock the picture is of may not have reached the plugin yet. A second
        check is scheduled for the far edge of the capture's forward window, so
        an achievement popping eight seconds after the shutter still lands. A
        later capture pushes that pending check out rather than queueing another,
        which is what keeps a burst of ten screenshots to two checks.
        """
        if game_id is None:
            return

        now = _boot_seconds()
        if now - self._memories_last_resolve_at >= _RESOLVE_COOLDOWN_SECONDS:
            self._memories_last_resolve_at = now
            self._spawn_background_task(self._memories_check_and_resolve(game_id))

        pending = self._memories_deferred_resolve
        if pending is not None and not pending.done():
            pending.cancel()
        self._memories_deferred_resolve = self._spawn_background_task(
            self._memories_deferred_check(game_id, forward_seconds)
        )

    async def _memories_deferred_check(self, game_id, forward_seconds: int = 0) -> None:
        delay = (
            memories_resolver.FORWARD_SKEW_SECONDS
            + memories_resolver.SETTLE_SLACK_SECONDS
            + max(int(forward_seconds or 0), 0)
            + 1
        )
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        self._memories_last_resolve_at = _boot_seconds()
        await self._memories_check_and_resolve(game_id)

    async def _memories_check_and_resolve(self, game_id) -> None:
        try:
            await self.check_current_game()
        except Exception as e:
            decky.logger.warning("memories: game check for the resolver failed (%s)", type(e).__name__)
        await self.resolve_pending_memories(game_id)

    async def resolve_pending_memories(self, game_id=None):
        """Fill in progress and bound achievements for one game's memories.

        Safe to call at any time and from any path: it walks whatever is still
        pending, binds what the achievement list supports, and leaves the rest
        alone. Running it twice changes nothing.
        """
        try:
            return await asyncio.to_thread(self._resolve_pending_sync, game_id)
        except Exception as e:
            decky.logger.warning("memories: resolving context failed (%s)", type(e).__name__)
            return {"ok": False, "updated": 0}

    def _resolve_pending_sync(self, game_id):
        wanted = norm_game_id(game_id)
        if wanted is None:
            return {"ok": True, "updated": 0}

        pending = self.memories_store.pending_memories(wanted)
        if not pending:
            return {"ok": True, "updated": 0}

        payload = (self.cache_store.load_payload() or {}).get("payload") or {}
        if norm_game_id(payload.get("gameId")) != wanted:
            return {"ok": True, "updated": 0}

        achievements = payload.get("achievements") or []
        now = int(time.time())
        resolved = {
            memory["id"]: memories_resolver.resolve(
                achievements,
                memory["capturedAt"],
                now=now,
                forward=self._memory_forward_window(memory),
            )
            for memory in pending
        }

        if not resolved:
            return {"ok": True, "updated": 0}
        return self.memories_store.apply_resolution(wanted, resolved)

    def _memory_forward_window(self, memory) -> int:
        """How far past its own moment a memory still binds an unlock.

        A screenshot is one instant and gets the skew alone. A clip runs for its
        whole length, so an achievement popping in the middle of it belongs to
        it just as much as one popping on the first frame.
        """
        video = memory.get("video") or {}
        span = to_int(video.get("durationMs"), 0) // 1000
        return memories_resolver.FORWARD_SKEW_SECONDS + max(span, 0)

    def _adopt_screenshot_sync(self, path: str, app_id, created_at, screenshot_game_id=""):
        cfg = self.settings_store.load_config()
        if not self.settings_store.get_memories_auto_capture(cfg):
            return {"ok": False, "error": "disabled"}
        if (self.settings_store.get_battery_saver(cfg)
                and self.settings_store.get_battery_saver_disables_memories(cfg)):
            return {"ok": False, "error": "battery_saver"}

        indexed = Path(str(path or "").strip())
        if not indexed.is_absolute() or not indexed.is_file():
            return {"ok": False, "error": "no_source"}

        twin = memories_capture.uncompressed_twin(indexed, screenshot_game_id)
        source = twin if twin is not None and memories_capture.looks_complete(twin) else indexed

        running = to_int(app_id, 0)
        if not running:
            decky.logger.warning(
                "memories: a screenshot arrived with no running appid, so there is nothing to file it under"
            )
            return {"ok": False, "error": "no_app"}
        if not memories_capture.is_non_steam_shortcut(running, self.user_home):
            return {"ok": False, "error": "steam_game"}

        payload = (self.cache_store.load_payload() or {}).get("payload") or {}
        game_id = norm_game_id(payload.get("gameId"))
        title = memories_capture.resolve_title(running, payload.get("title"), self.user_home)
        console_name = str(payload.get("consoleName") or "").strip()
        image_icon = str(payload.get("imageIcon") or "").strip()
        if game_id is None:
            game_id = MISC_GAME_ID

        try:
            folder = self.memories_store.ensure_picture_dir(game_id)
        except OSError as e:
            decky.logger.error("memories: couldn't prepare the picture folder (%s)", type(e).__name__)
            return {"ok": False, "error": "write_failed"}

        destination = memories_capture.copy_into(source, folder)
        if destination is None:
            return {"ok": False, "error": "write_failed"}

        final = self._transcode_if_png(destination)

        root = self.memories_store.pictures_root()
        try:
            relative = str(final.relative_to(root))
        except ValueError:
            return {"ok": False, "error": "write_failed"}

        added = self.memories_store.add_memory(
            game_id,
            path=relative,
            captured_at=to_int(created_at, 0),
            app_id=running,
            game_title=title,
            console_name=console_name,
            image_icon=image_icon,
            source="steam",
        )
        if not added.get("ok"):
            return added

        memory = added["memory"]
        self._thumbnail_for(game_id, memory["path"], final)

        delete_source = (
            self.settings_store.get_memories_delete_source(cfg)
            and memories_capture.looks_complete(final)
        )
        if delete_source and twin is not None:
            try:
                twin.unlink()
            except OSError as e:
                decky.logger.warning(
                    "memories: couldn't remove the uncompressed copy (%s)", type(e).__name__
                )

        decky.logger.info("memories: filed %s under game %s", final.name, game_id)
        return {
            "ok": True,
            "gameId": game_id,
            "memory": memory,
            "deleteSource": delete_source,
        }

    def _adopt_clip_sync(self, clip_id, game_id, recorded_at, duration_ms, file_size):
        cfg = self.settings_store.load_config()
        if not self.settings_store.get_memories_auto_capture(cfg):
            return {"ok": False, "error": "disabled"}
        if not self.settings_store.get_memories_video(cfg):
            return {"ok": False, "error": "video_disabled"}
        if (self.settings_store.get_battery_saver(cfg)
                and self.settings_store.get_battery_saver_disables_memories(cfg)):
            return {"ok": False, "error": "battery_saver"}

        running = memories_clips.appid_from_game_id(game_id)
        if not running:
            return {"ok": False, "error": "no_app"}
        if not memories_capture.is_non_steam_shortcut(running, self.user_home):
            return {"ok": False, "error": "steam_game"}

        clip_path = memories_clips.clip_dir(clip_id, self.user_home)
        if clip_path is None:
            decky.logger.warning("memories: clip %s is not under any recording folder", clip_id)
            return {"ok": False, "error": "no_source"}

        session = memories_clips.session_dir(clip_path)
        if session is None:
            return {"ok": False, "error": "no_source"}

        period_start_ms, _presentation_ms = memories_clips.manifest_timing(session)
        span_ms = to_int(duration_ms, 0)
        start_ms = memories_clips.in_point_ms(period_start_ms)

        payload = (self.cache_store.load_payload() or {}).get("payload") or {}
        ra_game_id = norm_game_id(payload.get("gameId"))
        title = memories_capture.resolve_title(running, payload.get("title"), self.user_home)
        console_name = str(payload.get("consoleName") or "").strip()
        image_icon = str(payload.get("imageIcon") or "").strip()
        if ra_game_id is None:
            ra_game_id = MISC_GAME_ID

        try:
            folder = self.memories_store.ensure_picture_dir(ra_game_id)
        except OSError as e:
            decky.logger.error("memories: couldn't prepare the picture folder (%s)", type(e).__name__)
            return {"ok": False, "error": "write_failed"}

        destination = memories_capture.unique_destination(folder, memories_clips.poster_name(clip_id))
        if not memories_clips.make_poster(session, start_ms, span_ms, destination):
            return {"ok": False, "error": "no_poster"}

        root = self.memories_store.pictures_root()
        try:
            relative = str(destination.relative_to(root))
        except ValueError:
            return {"ok": False, "error": "write_failed"}

        owned = self._copy_clip_sync(
            ra_game_id, clip_id, session, self.settings_store.get_memories_remux(cfg)
        )
        if not owned["ok"]:
            try:
                destination.unlink()
            except OSError:
                pass
            return {"ok": False, "error": "copy_failed"}

        video_start_ms = start_ms
        if owned["kind"] == "mp4":
            video_start_ms = max(start_ms - owned["mediaStartMs"], 0)

        added = self.memories_store.add_memory(
            ra_game_id,
            path=relative,
            captured_at=to_int(recorded_at, 0),
            app_id=running,
            game_title=title,
            console_name=console_name,
            image_icon=image_icon,
            source="steam",
            video={
                "clipId": clip_id,
                "sessionId": session.name,
                "path": owned["path"],
                "startMs": video_start_ms,
                "durationMs": span_ms,
                "sizeBytes": owned["bytes"] or to_int(file_size, 0),
                "kind": owned["kind"],
            },
        )
        if not added.get("ok"):
            memories_clips.discard_copy(owned["folder"])
            return added

        memory = added["memory"]
        self._thumbnail_for(ra_game_id, memory["path"], destination)

        decky.logger.info(
            "memories: filed clip %s under game %s, %s MB copied",
            clip_id, ra_game_id, round(owned["bytes"] / (1024 * 1024), 1),
        )
        return {
            "ok": True,
            "gameId": ra_game_id,
            "memory": memory,
            "deleteClip": self.settings_store.get_memories_delete_steam_clip(cfg),
        }

    def _copy_clip_sync(self, game_id, clip_id: str, session: Path, remux: bool = True) -> dict:
        """Take a clip into this account's video tree, remuxing it if it can.

        Returns ``{"ok", "path", "folder", "bytes", "kind", "mediaStartMs"}``.
        ``path`` is relative to the video root, so the files travel with the
        root rather than being pinned to the home directory they were written
        under, and ``kind`` says which of the two shapes landed.

        The remux is one fragmented MP4 with an index, which is what lets
        playback ask for a second of video rather than a whole segment. It moves
        no pixels and no samples, so the only thing at stake is addressing, and
        anything at all going wrong falls back to copying Steam's own files
        across unchanged. A clip is never lost to a remux that would not run.

        ``remux`` False takes that same fallback deliberately, which is what the
        setting is for: both shapes play, so turning it off costs startup time
        rather than the clip.
        """
        try:
            folder = self.memories_store.ensure_video_dir(game_id, clip_id)
        except (OSError, ValueError) as e:
            decky.logger.error("memories: couldn't prepare the video folder (%s)", type(e).__name__)
            return {"ok": False, "path": "", "folder": None, "bytes": 0, "kind": "", "mediaStartMs": 0}

        remuxed = (
            memories_clips.remux_session(session, folder)
            if remux
            else {"ok": False, "bytes": 0, "mediaStartMs": 0}
        )
        result = remuxed if remuxed["ok"] else memories_clips.copy_session(session, folder)
        if not result["ok"]:
            return {"ok": False, "path": "", "folder": folder, "bytes": 0, "kind": "", "mediaStartMs": 0}

        try:
            relative = str(folder.relative_to(self.memories_store.videos_root()))
        except ValueError:
            memories_clips.discard_copy(folder)
            decky.logger.error("memories: the clip copy landed outside the video root")
            return {"ok": False, "path": "", "folder": folder, "bytes": 0, "kind": "", "mediaStartMs": 0}

        return {
            "ok": True,
            "path": relative,
            "folder": folder,
            "bytes": result["bytes"],
            "kind": "mp4" if remuxed["ok"] else "dash",
            "mediaStartMs": result.get("mediaStartMs", 0),
        }

    def _transcode_if_png(self, destination: Path) -> Path:
        """Re-encode a freshly copied PNG as lossless WebP, or leave it alone.

        Returns the path the record should name. Every failure returns the
        original, so the picture is always on disk under the path handed back.
        """
        if destination.suffix.lower() not in memories_capture.TRANSCODE_SUFFIXES:
            return destination

        converted = destination.with_suffix(".webp")
        if converted.exists():
            return destination
        if not memories_thumbs.transcode_lossless(destination, converted):
            return destination
        if not memories_capture.looks_complete(converted):
            try:
                converted.unlink()
            except OSError:
                pass
            return destination

        try:
            destination.unlink()
        except OSError:
            pass
        return converted

    def _thumbnail_for(self, game_id, relative: str, source: Path) -> None:
        try:
            self.memories_store.ensure_thumb_dir(game_id)
        except OSError as e:
            decky.logger.warning("memories: couldn't prepare the thumbnail folder (%s)", type(e).__name__)
            return
        memories_thumbs.make_thumbnail(source, self.memories_store.thumb_path(game_id, relative))
