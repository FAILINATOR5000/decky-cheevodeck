from pathlib import Path

import shutil
import threading
import zipfile

import decky
import memories_clips
import memories_transfer

from memories_store import CURRENT_SCHEMA_VERSION

from notifications import emit_notification
from utils import ensure_dir, to_int


FREE_SPACE_MARGIN_BYTES = 256 * 1024 * 1024

_MEGABYTE = 1024 * 1024

_GIGABYTE = 1024 * 1024 * 1024

ERROR_BUSY = "busy"
ERROR_NOT_RUNNING = "not_running"
ERROR_BAD_TARGET = "bad_target"
ERROR_NOT_WRITABLE = "not_writable"
ERROR_NO_SPACE = "no_space"
ERROR_NOTHING_TO_EXPORT = "nothing_to_export"
ERROR_WRITE_FAILED = "write_failed"
ERROR_IMPORT_FAILED = "import_failed"
ERROR_NO_ACCOUNT = "no_account"
ERROR_STASH_PENDING = "stash_pending"
ERROR_STASH_FAILED = "stash_failed"
ERROR_NOTHING_STASHED = "nothing_stashed"

MODE_MERGE = "merge"
MODE_REPLACE = "replace"

_RUNNING_STATES = ("scanning", "writing", "validating", "importing", "finishing")


def _size_label(count: int) -> str:
    if count <= 0:
        return "0 MB"
    if count >= _GIGABYTE:
        return f"{count / _GIGABYTE:.1f} GB"
    return f"{max(1, round(count / _MEGABYTE))} MB"


def _fallback_body(importing: bool, nothing_new: bool, files: int, skipped: int, count: int) -> str:
    if nothing_new:
        return "Every memory in that export was already here."
    verb = "Imported" if importing else "Exported"
    body = f"{verb} {files} files at around {_size_label(count)} in size."
    if importing and skipped > 0:
        return f"{body} {skipped} were already here."
    return body


def _free_bytes(path: Path) -> int:
    probe = path
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    try:
        return shutil.disk_usage(probe).free
    except OSError:
        return -1


class MemoriesTransferService:

    def __init__(self, *, store, settings_store, notifications_store, home: Path, scratch_dir: Path):
        self._store = store
        self._settings_store = settings_store
        self._notifications = notifications_store
        self._home = home
        self._scratch_dir = scratch_dir
        self._event_loop = None
        self._lock = threading.Lock()
        self._thread = None
        self._stop = threading.Event()
        self._reset("idle")

    def set_event_loop(self, loop) -> None:
        self._event_loop = loop

    def _reset(self, state: str) -> None:
        with self._lock:
            self._state = state
            self._direction = ""
            self._mode = ""
            self._error = ""
            self._copied = 0
            self._records = 0
            self._total_records = 0
            self._bytes = 0
            self._total_bytes = 0
            self._target = ""
            self._result = None

    def status(self) -> dict:
        stashed = bool(self._store.stashed_trees())
        with self._lock:
            return {
                "ok": True,
                "state": self._state,
                "direction": self._direction,
                "mode": self._mode,
                "error": self._error,
                "copied": self._copied,
                "records": self._records,
                "totalRecords": self._total_records,
                "bytes": self._bytes,
                "totalBytes": self._total_bytes,
                "target": self._target,
                "stashed": stashed,
            }

    def running(self) -> bool:
        with self._lock:
            return self._state in _RUNNING_STATES

    def cancel(self) -> dict:
        if not self.running():
            return {"ok": False, "error": ERROR_NOT_RUNNING, "running": False}
        self._stop.set()
        decky.logger.info("memories: the transfer was canceled")
        return {"ok": True, "running": True}

    def _stopped(self) -> bool:
        return self._stop.is_set()

    def _bump_bytes(self, count: int) -> None:
        with self._lock:
            self._bytes += count

    def _fail(self, code: str) -> None:
        with self._lock:
            self._state = "failed"
            self._error = code
            direction = self._direction
        decky.logger.error("memories: the transfer failed (%s)", code)
        self._notify_failure(direction, code)

    def _notify_failure(self, direction: str, code: str) -> None:
        title = "Memories Transfer Failed"

        if self._notifications is not None:
            try:
                self._notifications.append({
                    "type": "system",
                    "kind": "actionable",
                    "iconSource": "none",
                    "title": title,
                    "body": f"The transfer stopped: {code}",
                    "source": "notifications",
                    "target": {"view": "memoriesTransfer"},
                    "meta": {"transfer": "failed", "direction": direction, "reason": code},
                })
            except Exception as e:
                decky.logger.warning(
                    "memories: the failure notification could not be filed (%s)", type(e).__name__
                )

        emit_notification(
            ntype="system",
            title_key=title,
            line_key="The transfer didn't finish",
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            force_toast=True,
        )

    def _canceled(self) -> None:
        with self._lock:
            self._state = "canceled"
            self._error = ""

    def _settle(self, result: dict) -> None:
        with self._lock:
            self._state = "done"
            self._error = ""
            self._result = result
        self._notify(result)

    def _notify(self, result: dict) -> None:
        importing = "inserted" in result
        files = result["inserted"] if importing else result["memories"]
        skipped = to_int(result.get("skipped"), 0)
        nothing_new = importing and files <= 0 and skipped > 0

        if not importing:
            title = "Memories Exported"
            line_key = "Exported {{name}}"
            line_vars = {"name": result["bundle"]}
        elif nothing_new:
            title = "Nothing New to Import"
            line_key = "Every memory was already here"
            line_vars = None
        else:
            title = "Memories Imported"
            line_key = "Imported {{count}} memories"
            line_vars = {"count": files}

        if self._notifications is not None:
            try:
                self._notifications.append({
                    "type": "system",
                    "kind": "actionable",
                    "iconSource": "none",
                    "title": title,
                    "body": _fallback_body(importing, nothing_new, files, skipped,
                                           result.get("bytes", 0)),
                    "source": "notifications",
                    "target": {"view": "memoriesTransfer"},
                    "meta": {
                        "transfer": "import" if importing else "export",
                        "files": files,
                        "skipped": skipped,
                        "bytes": result.get("bytes", 0),
                    },
                })
            except Exception as e:
                decky.logger.warning(
                    "memories: the transfer notification could not be filed (%s)", type(e).__name__
                )

        emit_notification(
            ntype="system",
            title_key=title,
            line_key=line_key,
            template_vars=line_vars,
            settings_store=self._settings_store,
            event_loop=self._event_loop,
            force_toast=True,
        )

    def counts(self) -> dict:
        games = self._store.games_with_memories()["games"]
        return {
            "ok": True,
            "games": len(games),
            "memories": sum(to_int(row.get("count"), 0) for row in games),
        }

    def weigh(self) -> dict:
        entries = self._store.all_entries()
        pictures = 0
        picture_bytes = 0
        clips = 0
        clip_bytes = 0
        missing_clips = 0
        missing_pictures = 0

        for entry in entries.values():
            for memory in entry["memories"]:
                source = self._store.picture_path(memory["path"])
                try:
                    picture_bytes += source.stat().st_size
                except OSError:
                    missing_pictures += 1
                    continue
                pictures += 1
                video = memory.get("video") or {}
                if not video:
                    continue
                size = self._clip_size(memory)
                if size < 0:
                    missing_clips += 1
                    continue
                clips += 1
                clip_bytes += size

        return {
            "ok": True,
            "games": len(entries),
            "memories": pictures,
            "missingPictures": missing_pictures,
            "clips": clips,
            "missingClips": missing_clips,
            "bytes": picture_bytes + clip_bytes,
            "bytesNoVideos": picture_bytes,
        }

    def _clip_size(self, memory: dict) -> int:
        video = memory.get("video") or {}
        owned = video.get("path") or ""
        if owned:
            folder = self._store.video_path(owned)
            try:
                return sum(p.stat().st_size for p in folder.iterdir() if p.is_file())
            except OSError:
                return -1

        session = self._steam_session(video.get("clipId") or "")
        if session is None:
            return -1
        return sum(p.stat().st_size for p in memories_clips.session_files(session))

    def _steam_session(self, clip_id: str):
        if not clip_id:
            return None
        folder = memories_clips.clip_dir(clip_id, self._home)
        if folder is None:
            return None
        return memories_clips.session_dir(folder)

    def start_export(self, folder: str, include_videos: bool) -> dict:
        if self.running():
            return {"ok": False, "error": ERROR_BUSY}

        destination = Path(str(folder or "").strip())
        if not destination.is_dir():
            return {"ok": False, "error": ERROR_BAD_TARGET}

        estimated = self.weigh()
        if estimated["memories"] <= 0:
            return {"ok": False, "error": ERROR_NOTHING_TO_EXPORT}

        needed = estimated["bytes"] if include_videos else estimated["bytesNoVideos"]
        free = _free_bytes(destination)
        if free >= 0 and free < needed + FREE_SPACE_MARGIN_BYTES:
            return {"ok": False, "error": ERROR_NO_SPACE, "needed": needed}

        self._stop.clear()
        self._reset("scanning")
        with self._lock:
            self._direction = "export"
            self._total_records = estimated["memories"]
            self._total_bytes = needed
            self._target = str(destination)
            self._thread = threading.Thread(
                target=self._run,
                args=(self._export, (destination, bool(include_videos))),
                name="memories-export",
                daemon=True,
            )
            self._thread.start()
        return {"ok": True, "estimate": estimated}

    def start_import(self, bundle: str, mode: str) -> dict:
        if self.running():
            return {"ok": False, "error": ERROR_BUSY}

        source = Path(str(bundle or "").strip())
        if not source.is_file():
            return {"ok": False, "error": ERROR_BAD_TARGET}

        wanted = MODE_REPLACE if mode == MODE_REPLACE else MODE_MERGE
        if wanted == MODE_REPLACE:
            if not self._store.account_key():
                return {"ok": False, "error": ERROR_NO_ACCOUNT}
            if self._store.stashed_trees():
                return {"ok": False, "error": ERROR_STASH_PENDING}

        found = memories_transfer.probe(source)
        if not found["ok"]:
            return {"ok": False, "error": found["error"]}

        sizes = memories_transfer.bundle_sizes(source)
        for root, needed in (
            (self._store.pictures_root(), sizes["pictures"]),
            (self._store.videos_root(), sizes["videos"]),
        ):
            if needed <= 0:
                continue
            free = _free_bytes(root)
            if free >= 0 and free < needed + FREE_SPACE_MARGIN_BYTES:
                return {"ok": False, "error": ERROR_NO_SPACE, "needed": needed}

        self._stop.clear()
        self._reset("validating")
        with self._lock:
            self._direction = "import"
            self._mode = wanted
            self._total_records = found["manifest"]["total"]
            self._total_bytes = sizes["total"]
            self._target = str(source)
            self._thread = threading.Thread(
                target=self._run,
                args=(self._import, (source, wanted)),
                name="memories-import",
                daemon=True,
            )
            self._thread.start()
        return {"ok": True, "manifest": found["manifest"]}

    def recover_stashed(self) -> dict:
        if self.running():
            return {"ok": False, "error": ERROR_BUSY}
        moved = self._store.stashed_trees()
        if not moved:
            return {"ok": False, "error": ERROR_NOTHING_STASHED}
        restored = self._store.restore_account_trees(moved)
        self._store.clear_thumbs()
        decky.logger.info("memories: put %s folders back after an unfinished restore", restored)
        return {"ok": True, "restored": restored}

    def discard_stashed(self) -> dict:
        if self.running():
            return {"ok": False, "error": ERROR_BUSY}
        moved = self._store.stashed_trees()
        if not moved:
            return {"ok": False, "error": ERROR_NOTHING_STASHED}
        removed = self._store.discard_stashed_trees(moved)
        decky.logger.info("memories: dropped %s folders left by an unfinished restore", removed)
        return {"ok": True, "removed": removed}

    def _run(self, work, args) -> None:
        try:
            work(*args)
        except Exception as e:
            decky.logger.exception(
                "memories: the transfer thread stopped (%s: %s)", type(e).__name__, e
            )
            self._fail(ERROR_WRITE_FAILED)

    def _export(self, destination: Path, include_videos: bool) -> None:
        account = self._store.account_key()
        entries = self._store.all_entries()
        scratch = self._scratch_dir / "export"
        writer = memories_transfer.BundleWriter(destination / memories_transfer.bundle_name(0))

        try:
            writer.open()
        except OSError:
            self._fail(ERROR_NOT_WRITABLE)
            return

        with self._lock:
            self._state = "writing"

        games = []
        total = 0
        videos = 0
        missing_videos = 0
        missing_pictures = 0

        try:
            for key, entry in sorted(entries.items(), key=lambda pair: int(pair[0])):
                if self._stopped():
                    writer.abandon()
                    self._canceled()
                    return

                bundled = []
                for memory in entry["memories"]:
                    picture = self._store.picture_path(memory["path"])
                    if not picture.is_file():
                        missing_pictures += 1
                        continue

                    record = memories_transfer.portable_record(memory, account)
                    tail = memories_transfer.safe_tail(record["path"])
                    if not tail:
                        missing_pictures += 1
                        continue
                    if not writer.add_file(
                        memories_transfer.picture_arcname(tail),
                        picture,
                        on_bytes=self._bump_bytes,
                        should_stop=self._stopped,
                    ):
                        writer.abandon()
                        self._canceled()
                        return
                    with self._lock:
                        self._copied += 1
                        self._records += 1

                    landed = self._export_video(writer, memory, record, scratch, include_videos)
                    if landed is None:
                        writer.abandon()
                        self._canceled()
                        return
                    if landed["missing"]:
                        missing_videos += 1
                    elif landed["tail"]:
                        videos += 1
                    record["video"] = landed["video"]

                    bundled.append(record)
                    total += 1

                if not bundled:
                    continue
                writer.add_json(memories_transfer.records_arcname(key), {
                    "gameId": entry["gameId"],
                    "schemaVersion": entry["schemaVersion"],
                    "gameTitle": entry["gameTitle"],
                    "consoleName": entry["consoleName"],
                    "imageIcon": entry["imageIcon"],
                    "tagVocabulary": list(entry["tagVocabulary"]),
                    "memories": bundled,
                })
                games.append({
                    "gameId": entry["gameId"],
                    "gameTitle": entry["gameTitle"],
                    "count": len(bundled),
                })
        except OSError as e:
            decky.logger.error("memories: writing the bundle stopped (%s)", type(e).__name__)
            writer.abandon()
            memories_clips.discard_copy(scratch)
            self._fail(ERROR_WRITE_FAILED)
            return
        finally:
            memories_clips.discard_copy(scratch)

        with self._lock:
            self._state = "finishing"
            written_bytes = self._bytes

        writer.add_json(memories_transfer.MANIFEST_NAME, memories_transfer.build_manifest(
            ulid=account,
            schema_version=CURRENT_SCHEMA_VERSION,
            games=games,
            total=total,
            videos=videos,
            media_bytes=written_bytes,
            include_videos=include_videos,
        ))

        try:
            landed = writer.finish()
        except OSError as e:
            decky.logger.error("memories: the bundle would not close (%s)", type(e).__name__)
            writer.abandon()
            self._fail(ERROR_WRITE_FAILED)
            return

        decky.logger.info(
            "memories: exported %s memories across %s games to %s", total, len(games), landed.name
        )
        self._settle({
            "bundle": landed.name,
            "path": str(landed),
            "memories": total,
            "games": len(games),
            "videos": videos,
            "missingVideos": missing_videos,
            "missingPictures": missing_pictures,
            "bytes": written_bytes,
        })

    def _export_video(self, writer, memory: dict, record: dict, scratch: Path, include_videos: bool):
        video = record.get("video")
        if not isinstance(video, dict):
            return {"video": None, "tail": "", "missing": False}

        without = {"video": {**video, "path": ""}, "tail": "", "missing": False}
        absent = {"video": {**video, "path": ""}, "tail": "", "missing": True}
        if not include_videos:
            return without

        owned = memories_transfer.safe_tail(video.get("path"))
        if owned:
            source = self._store.video_path((memory.get("video") or {}).get("path") or "")
            placed = self._add_clip_files(writer, source, owned, video)
            return self._settled_clip(placed, absent)

        session = self._steam_session(video.get("clipId") or "")
        if session is None:
            return absent

        staged = scratch / video["clipId"]
        memories_clips.discard_copy(staged)
        try:
            ensure_dir(staged)
        except OSError:
            return absent

        built = memories_clips.remux_session(session, staged)
        kind = "mp4"
        if not built["ok"]:
            built = memories_clips.copy_session(session, staged)
            kind = "dash"
        if not built["ok"]:
            memories_clips.discard_copy(staged)
            return absent

        tail = f"{self._store.folder_for_game(memory['gameId'])}/{video['clipId']}"
        placed = self._add_clip_files(writer, staged, tail, video, kind=kind)
        memories_clips.discard_copy(staged)
        return self._settled_clip(placed, absent)

    def _settled_clip(self, placed, absent):
        if placed is not None:
            return placed
        return None if self._stopped() else absent

    def _add_clip_files(self, writer, folder: Path, tail: str, video: dict, kind: str = ""):
        try:
            sources = sorted(p for p in folder.iterdir() if p.is_file())
        except OSError:
            return None
        if not sources:
            return None

        prefix = memories_transfer.video_prefix(tail)
        for source in sources:
            if not writer.add_file(
                prefix + source.name,
                source,
                on_bytes=self._bump_bytes,
                should_stop=self._stopped,
            ):
                return None
            with self._lock:
                self._copied += 1

        landed = {**video, "path": tail}
        if kind:
            landed["kind"] = kind
        return {"video": landed, "tail": tail, "missing": False}

    def _import(self, source: Path, mode: str) -> None:
        checked = memories_transfer.validate(
            source, on_bytes=self._bump_bytes, should_stop=self._stopped
        )
        if checked.get("canceled"):
            self._canceled()
            return
        if not checked["ok"]:
            self._fail(checked["error"])
            return

        manifest = checked["manifest"]
        moved = []
        if mode == MODE_REPLACE:
            stashed = self._store.stash_account_trees()
            if not stashed["ok"]:
                self._fail(
                    ERROR_STASH_PENDING if stashed["error"] == "stash_pending" else ERROR_STASH_FAILED
                )
                return
            moved = stashed["moved"]
            decky.logger.info("memories: moved %s folders aside for a restore", len(moved))

        with self._lock:
            self._state = "importing"
            self._bytes = 0
            self._total_bytes = manifest["bytes"] or self._total_bytes

        account = self._store.account_key()
        held = self._store.memory_ids()
        inserted = 0
        skipped = 0
        videos = 0
        missing_videos = 0
        games = 0
        placed_records = []
        loose_files = []

        try:
            with zipfile.ZipFile(source) as archive:
                names = set(archive.namelist())
                for key, entry in sorted(checked["entries"].items(), key=lambda pair: int(pair[0])):
                    if self._stopped():
                        self._undo_import(mode, moved, placed_records, loose_files)
                        return

                    arriving = []
                    media_for = {}
                    for memory in entry.get("memories", []) or []:
                        if not isinstance(memory, dict):
                            skipped += 1
                            continue
                        if memory.get("id") in held:
                            skipped += 1
                            continue

                        for_record = []
                        placed = self._place_media(archive, names, memory, for_record)
                        loose_files.extend(for_record)
                        if placed is None:
                            self._undo_import(mode, moved, placed_records, loose_files)
                            return
                        if not placed["picture"]:
                            skipped += 1
                            self._drop_files(for_record)
                            continue
                        if placed["missingVideo"]:
                            missing_videos += 1
                        elif placed["video"]:
                            videos += 1

                        landed = memories_transfer.landed_record(
                            memory, account,
                            picture_tail=placed["picture"],
                            video_tail=placed["video"],
                        )
                        arriving.append(landed)
                        media_for[landed["id"]] = for_record
                        with self._lock:
                            self._records += 1

                    if not arriving:
                        continue
                    game_id = entry.get("gameId", int(key))
                    written = self._store.insert_memories(
                        game_id, arriving, entry.get("tagVocabulary")
                    )
                    landed_ids = set(written["insertedIds"])
                    if not written["ok"]:
                        decky.logger.error(
                            "memories: game %s out of the bundle would not write, skipping it", key
                        )
                    for memory_id, paths in media_for.items():
                        if memory_id not in landed_ids:
                            self._drop_files(paths)
                    inserted += written["inserted"]
                    skipped += written["skipped"]
                    if landed_ids:
                        games += 1
                    loose_files.clear()
                    for memory_id in landed_ids:
                        held.add(memory_id)
                        placed_records.append((game_id, memory_id))
        except (OSError, zipfile.BadZipFile) as e:
            decky.logger.error("memories: the import stopped (%s)", type(e).__name__)
            self._undo_import(mode, moved, placed_records, loose_files)
            self._fail(ERROR_IMPORT_FAILED)
            return

        with self._lock:
            self._state = "finishing"
            landed_bytes = self._bytes

        self._store.clear_thumbs()

        if mode == MODE_REPLACE:
            landed = len(self._store.memory_ids())
            if landed != inserted:
                decky.logger.error(
                    "memories: the restore wrote %s records and reads back %s, putting it back",
                    inserted, landed,
                )
                self._store.restore_account_trees(moved)
                self._store.clear_thumbs()
                self._fail(ERROR_IMPORT_FAILED)
                return
            self._store.discard_stashed_trees(moved)

        decky.logger.info(
            "memories: imported %s memories across %s games, %s already here",
            inserted, games, skipped,
        )
        self._settle({
            "mode": mode,
            "bytes": landed_bytes,
            "inserted": inserted,
            "skipped": skipped,
            "games": games,
            "videos": videos,
            "missingVideos": missing_videos,
            "bundleUlid": manifest["ulid"],
            "sameAccount": bool(account) and manifest["ulid"] == account,
        })

    def _place_media(self, archive, names: set, memory: dict, loose_files: list):
        tail = memories_transfer.safe_tail(memory.get("path"))
        arcname = memories_transfer.picture_arcname(tail)
        if not tail or arcname not in names:
            return {"picture": "", "video": "", "missingVideo": False}

        target = memories_transfer.free_path(self._store.account_picture_root() / tail)
        try:
            if not memories_transfer.extract_entry(
                archive, arcname, target, on_bytes=self._bump_bytes, should_stop=self._stopped
            ):
                loose_files.append(target)
                return None
        except (OSError, zipfile.BadZipFile) as e:
            decky.logger.error("memories: %s would not land (%s)", target.name, type(e).__name__)
            try:
                target.unlink()
            except OSError:
                pass
            return {"picture": "", "video": "", "missingVideo": False}
        loose_files.append(target)
        with self._lock:
            self._copied += 1

        picture_tail = target.relative_to(self._store.account_picture_root()).as_posix()
        video = memory.get("video") or {}
        owned = memories_transfer.safe_tail(video.get("path"))
        if not owned:
            return {"picture": picture_tail, "video": "", "missingVideo": bool(video.get("clipId"))}

        prefix = memories_transfer.video_prefix(owned)
        sources = sorted(name for name in names if name.startswith(prefix))
        if not sources:
            return {"picture": picture_tail, "video": "", "missingVideo": True}

        folder = memories_transfer.free_path(self._store.account_video_root() / owned)
        for name in sources:
            landing = folder / Path(name).name
            try:
                if not memories_transfer.extract_entry(
                    archive, name, landing, on_bytes=self._bump_bytes, should_stop=self._stopped
                ):
                    loose_files.append(landing)
                    return None
            except (OSError, zipfile.BadZipFile) as e:
                decky.logger.error("memories: %s would not land (%s)", name, type(e).__name__)
                return {"picture": picture_tail, "video": "", "missingVideo": True}
            loose_files.append(landing)
            with self._lock:
                self._copied += 1

        return {
            "picture": picture_tail,
            "video": folder.relative_to(self._store.account_video_root()).as_posix(),
            "missingVideo": False,
        }

    def _drop_files(self, paths) -> None:
        for path in paths:
            try:
                path.unlink()
            except OSError:
                pass

    def _undo_import(self, mode: str, moved: list, placed_records: list, loose_files: list) -> None:
        self._drop_files(loose_files)

        if mode == MODE_REPLACE:
            restored = self._store.restore_account_trees(moved)
            self._store.clear_thumbs()
            decky.logger.info("memories: the restore stopped and put %s folders back", restored)
            self._canceled()
            return

        for game_id, memory_id in reversed(placed_records):
            self._store.delete_memory(game_id, memory_id)
        decky.logger.info(
            "memories: the import stopped and took %s records back out", len(placed_records)
        )
        self._canceled()
