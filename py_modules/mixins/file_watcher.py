import asyncio
import os
import time
from pathlib import Path

import decky

from mixins._context import PluginContext
from services.file_watcher_service import default_start_dir
from utils import chown_to_data_owner


FINDINGS_PAGE_SIZE = 200


class FileWatcherMixin(PluginContext):
    """IPC surface for the File Watcher utility.

    Thin like the SMB and Cheevo Check mixins: the store owns persistence and
    validation, the service owns the schedule and the pass, and this only
    sequences the two and stays off the event loop. Every call here touches
    either a JSON file or SQLite, so they all go through asyncio.to_thread —
    a findings query against a database on a cold SD card is not something to
    do on the loop.

    No _ra_slot() anywhere. This feature makes no RetroAchievements calls at
    all, so there is nothing to be polite about and nothing to serialize
    against.
    """

    async def get_file_watcher_state(self):
        """Everything the page paints, in one call."""
        return await asyncio.to_thread(self._read_file_watcher_state)

    def _read_file_watcher_state(self) -> dict:
        config = self.file_watcher_store.load()
        clocks = self.file_watcher_service.clocks()
        return {
            "roots": config["roots"],
            "schedule": config["schedule"],
            "window": config["window"],
            "lastCompletedAt": clocks["lastCompletedAt"],
            "nextDueAt": clocks["nextDueAt"],
            "counts": self.file_watcher_store.bucket_counts(),
            "hasReport": self.file_watcher_store.has_report(),
            "skipped": self.file_watcher_store.skipped_rows(),
            "rootStats": self.file_watcher_store.root_stats(),
            "excludedTotal": self.file_watcher_store.excluded_total(),
            "startDir": default_start_dir(self.user_home, config["roots"], config["startDir"]),
            "pass": self.file_watcher_service.status()["pass"],
        }

    async def get_file_watcher_pass_status(self):
        """The one call that fires every second while a pass runs.

        Deliberately the cheap one, same as Cheevo Check's equivalent: a lock, a
        dict copy, no disk and no thread hop. The state call above reads the
        whole database and has no business on a per-second timer.
        """
        return self.file_watcher_service.status()

    async def start_file_watcher_pass(self):
        return await asyncio.to_thread(self.file_watcher_service.request_start)

    async def cancel_file_watcher_pass(self):
        return self.file_watcher_service.request_cancel()

    async def add_file_watcher_root(self, path):
        if self.file_watcher_service.pass_owns_data():
            return {"ok": False, "error": "pass_running"}
        return await asyncio.to_thread(self._add_file_watcher_root, str(path or ""))

    def _add_file_watcher_root(self, path: str) -> dict:
        self.file_watcher_store.set_start_dir(os.path.dirname(str(path or "").rstrip("/")))
        return self.file_watcher_store.add_root(path)

    async def remove_file_watcher_root(self, root_id):
        if self.file_watcher_service.pass_owns_data():
            return {"ok": False, "error": "pass_running"}
        return await asyncio.to_thread(self.file_watcher_store.remove_root, root_id)

    async def update_file_watcher_root(self, root_id, label=None, excludes=None):
        if self.file_watcher_service.pass_owns_data():
            return {"ok": False, "error": "pass_running"}
        return await asyncio.to_thread(
            self.file_watcher_store.update_root, root_id, label, excludes
        )

    async def forget_file_watcher_root_hashes(self, root_id):
        if self.file_watcher_service.pass_owns_data():
            return {"ok": False, "error": "pass_running"}
        return await asyncio.to_thread(self._forget_file_watcher_root_hashes, root_id)

    def _forget_file_watcher_root_hashes(self, root_id) -> dict:
        result = self.file_watcher_store.forget_root_hashes(root_id)
        if result.get("remaining") == 0:
            self.file_watcher_store.set_clocks(last_completed_at=0)
            self._note_file_watcher_clocks({"ok": True})
        return result

    async def update_file_watcher_schedule(self, enabled, every_weeks, weekday, hour, minute):
        saved = await asyncio.to_thread(
            self.file_watcher_store.set_schedule,
            enabled=bool(enabled),
            every_weeks=every_weeks,
            weekday=weekday,
            hour=hour,
            minute=minute,
        )
        return await asyncio.to_thread(self._note_file_watcher_clocks, saved)

    async def update_file_watcher_window(self, enabled, block_from, block_to):
        saved = await asyncio.to_thread(
            self.file_watcher_store.set_window,
            enabled=bool(enabled),
            block_from=block_from,
            block_to=block_to,
        )
        return await asyncio.to_thread(self._note_file_watcher_clocks, saved)

    def _note_file_watcher_clocks(self, saved: dict) -> dict:
        self.file_watcher_service.note_schedule_changed(self.file_watcher_store.load())
        payload = dict(saved)
        payload.update(self.file_watcher_service.clocks())
        return payload

    async def clear_file_watcher_run_times(self):
        """Forget when the watcher last ran — both clocks and the next-run time.

        Lives in Options rather than on the page because of what the second
        clock does. Only a *scheduled* pass arms the half-period guard in
        next_due_after, and while it's armed no slot inside half a cycle is
        taken — three and a half days on the weekly setting. That is correct for
        a real library and miserable for anyone trying the schedule twice in one
        evening, and there was no way to clear it short of editing the config
        by hand.
        """
        if self.file_watcher_service.pass_owns_data():
            return {"ok": False, "error": "pass_running"}
        return await asyncio.to_thread(self._clear_file_watcher_run_times)

    def _clear_file_watcher_run_times(self) -> dict:
        self.file_watcher_store.set_clocks(
            last_completed_at=0, last_scheduled_at=0, next_due_at=0
        )
        payload = self._note_file_watcher_clocks({"ok": True})
        decky.logger.info("filewatcher: run times cleared, next run %s", payload["nextDueAt"])
        return payload

    async def save_file_watcher_run_during_games(self, value):
        stored = self.settings_store.update_file_watcher_run_during_games(bool(value))
        self.file_watcher_service.note_gates_changed()
        return {"ok": True, "fileWatcherRunDuringGames": stored}

    async def save_file_watcher_speed(self, value):
        return {
            "ok": True,
            "fileWatcherSpeed": self.settings_store.update_file_watcher_speed(value),
        }

    async def get_file_watcher_finding_roots(self, bucket):
        """Which roots this bucket has findings in.

        The findings modal's category step is conditional on this: one root
        means it opens straight to the flat list, because three Corrupted files
        should never cost a press through a list of one.
        """
        rows = await asyncio.to_thread(self.file_watcher_store.findings_roots, str(bucket or ""))
        return {"ok": True, "roots": rows}

    async def get_file_watcher_findings(self, bucket, limit=FINDINGS_PAGE_SIZE, root_id=None,
                                        after_root_id=0, after_rel_path=""):
        """One page of rows. Paged because Added really is forty thousand on a
        first run against a real library, and that does not belong in one IPC
        payload.

        The caller hands back the last row it saw rather than a running count,
        so dismissing a row mid-walk can't shift the page boundary and drop the
        one after it.
        """
        rows = await asyncio.to_thread(
            self.file_watcher_store.findings_page,
            str(bucket or ""),
            limit,
            root_id,
            after_root_id,
            after_rel_path,
        )
        return {"ok": True, "rows": rows}

    async def get_file_watcher_excluded_roots(self):
        """Which roots ignored something, split into folders and files.

        Same conditional-category-step contract as the findings pair above, so
        the one modal can drive both off one loop.
        """
        rows = await asyncio.to_thread(self.file_watcher_store.excluded_roots)
        return {"ok": True, "roots": rows}

    async def get_file_watcher_excluded(self, limit=FINDINGS_PAGE_SIZE, root_id=None,
                                        after_root_id=0, after_rel_path=""):
        """One page of ignored paths.

        The argument list is get_file_watcher_findings' minus its leading
        bucket, on purpose: the modal picks one of the two at the top and runs
        the same paging loop over whichever it got.
        """
        rows = await asyncio.to_thread(
            self.file_watcher_store.excluded_page,
            limit,
            root_id,
            after_root_id,
            after_rel_path,
        )
        return {"ok": True, "rows": rows}

    async def dismiss_file_watcher_finding(self, root_id, rel_path, action):
        return await asyncio.to_thread(
            self.file_watcher_store.dismiss_finding, root_id, str(rel_path or ""), str(action or "")
        )

    async def save_file_watcher_report(self, dest_dir, content):
        """Write the page's report into a folder the user picked.

        Same split as Cheevo Check's: the frontend builds the text, because
        that is where the translated headings live, and the backend only
        decides the filename and hands the file back to the user.
        """
        return await asyncio.to_thread(self._write_file_watcher_report, dest_dir, content)

    def _write_file_watcher_report(self, dest_dir, content) -> dict:
        folder = Path(str(dest_dir or "").strip())
        if not folder.is_dir():
            return {"ok": False, "error": "bad_folder"}

        text = str(content or "")
        if not text.strip():
            return {"ok": False, "error": "empty"}

        path = folder / f"filewatcher_report_{time.strftime('%Y-%m-%d')}.txt"
        try:
            path.write_text(text, encoding="utf-8")
        except OSError as exc:
            decky.logger.error("couldn't write the report to %s (%s)", path, exc)
            return {"ok": False, "error": "bad_folder"}

        chown_to_data_owner(path)
        decky.logger.info("filewatcher: report saved to %s (%d bytes)", path, len(text))
        return {"ok": True, "name": path.name, "path": str(path)}

    async def clear_file_watcher_report(self):
        cleared = await asyncio.to_thread(self.file_watcher_store.clear_report)
        decky.logger.info("filewatcher: last report cleared")
        return {"ok": True, "cleared": len(cleared)}

    async def clear_file_watcher_map(self):
        if self.file_watcher_service.pass_owns_data():
            return {"ok": False, "error": "pass_running"}
        cleared = await asyncio.to_thread(self._clear_file_watcher_map)
        decky.logger.info("filewatcher: recorded hashes cleared")
        return {"ok": True, "cleared": len(cleared)}

    def _clear_file_watcher_map(self) -> list:
        cleared = self.file_watcher_store.clear_map()
        self.file_watcher_store.set_clocks(last_completed_at=0)
        self._note_file_watcher_clocks({"ok": True})
        return cleared

    async def clear_file_watcher_everything(self):
        await asyncio.to_thread(self.file_watcher_service.quiesce)
        cleared = await asyncio.to_thread(self.file_watcher_store.clear_everything)
        await asyncio.to_thread(self.file_watcher_service.prepare)
        self.file_watcher_service.start()
        decky.logger.info("filewatcher: all data removed (%d files)", len(cleared))
        return {"ok": True, "cleared": len(cleared)}
