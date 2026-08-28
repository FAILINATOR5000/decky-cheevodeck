from pathlib import Path

import asyncio
import gzip
import json
import re
import time
import urllib.parse
import urllib.request

import decky

from mixins._context import PluginContext
from utils import chown_to_data_owner, ensure_dir


EMUDECK_ROMS_DIR = "Emulation/roms"

REFERENCE_DATA_BASE = "https://raw.githubusercontent.com/libretro/libretro-database/master"
REFERENCE_FETCH_TIMEOUT = 120

_DAT_GAME_RE = re.compile(r"^game\s*\(", re.MULTILINE)
_DAT_NAME_RE = re.compile(r'^\s*name\s+"([^"]*)"', re.MULTILINE)
_DAT_ROM_RE = re.compile(r'\brom\s*\(\s*name\s+"([^"]*)"\s+size\s+(\d+)\s+crc\s+([0-9A-Fa-f]+)')


def _dat_stem(name: str) -> str:
    head, dot, tail = name.rpartition(".")
    if dot and 1 <= len(tail) <= 5 and tail.isalnum():
        return head
    return name


class CheevoCheckMixin(PluginContext):
    """IPC surface for the Cheevo Check utility.

    Thin on purpose, same shape as the SMB mixin: the store owns persistence, the
    service owns the scan, and this only sequences the two and stays off the
    event loop. Nothing here takes an _ra_slot() — Jameson's call. The scan never
    waits on plugin state and never blocks it, and the politeness that would have
    bought is handled inside the service instead, by fetching sequentially with a
    gap.
    """

    def _cheevo_check_start_dir(self) -> str:
        """What the folder picker should open on.

        The directory scanned last time first, because a second scan is nearly
        always the same library.
        """
        results = self.cheevo_check_store.load_results()
        previous = str((results or {}).get("root") or "").strip()
        if previous and Path(previous).is_dir():
            return previous

        emudeck = self.user_home / EMUDECK_ROMS_DIR
        return str(emudeck if emudeck.is_dir() else self.user_home)

    async def get_cheevo_check_state(self):
        """Everything the page paints, in one call.

        Reading the results off disk is fast enough that the page doesn't need a
        loading state for it, but the RA database is megabytes and the page only
        ever asks it two questions, so ra_data_summary answers those without
        parsing the hashes.
        """
        state = await asyncio.to_thread(self._read_cheevo_check_state)
        return state

    def _read_cheevo_check_state(self) -> dict:
        summary = self.cheevo_check_store.ra_data_summary()
        status = self.cheevo_check_service.status()
        return {
            "running": status["running"],
            "error": status["error"],
            "progress": status["progress"],
            "results": self.cheevo_check_store.load_results(),
            "verifyResults": self.cheevo_check_store.load_verify_results(),
            "dataAvailable": summary["available"],
            "dataBuiltAt": summary["builtAt"],
            "hasLocalHashCache": self.cheevo_check_store.has_hash_cache(),
            "startDir": self._cheevo_check_start_dir(),
        }

    async def cancel_cheevo_check_scan(self):
        """Ask the running scan to stop. Sets an event and returns — the worker
        notices at its next check point, so the page finds out the same way it
        finds out about anything else, on its next status poll."""
        return self.cheevo_check_service.cancel()

    async def get_cheevo_check_scan_status(self):
        """The three fields that move while a scan runs, and nothing else.

        The page asks this every few seconds for the progress bar, and the full
        state above carries the whole results blob — a disk read, a JSON parse
        and a serialise of everything the last scan found, for a bar. This one
        reads a couple of in-memory values, so it doesn't go through a thread.
        """
        return self.cheevo_check_service.status()

    async def start_cheevo_check_scan(self, root, offline: bool = False):
        cfg = self.settings_store.load_config()
        started = await asyncio.to_thread(
            self.cheevo_check_service.start,
            root=str(root or ""),
            offline=bool(offline),
            web_api_key=str(cfg.get("webApiKey", "")).strip(),
        )
        if started.get("ok"):
            decky.logger.info(
                "cheevocheck: scan started (offline=%s) on %s", bool(offline), root
            )
        return started

    async def save_cheevo_check_report(self, dest_dir, content):
        """Write the results report where the user pointed.

        The text arrives already built by the page rather than being assembled
        here, which is what keeps it translated: every heading in it is a locale
        key the page already owns, and none of that wording exists in Python.
        This end only picks the filename and writes the bytes.
        """
        return await asyncio.to_thread(self._write_cheevo_check_report, dest_dir, content)

    def _write_cheevo_check_report(self, dest_dir, content) -> dict:
        folder = Path(str(dest_dir or "").strip())
        if not folder.is_dir():
            return {"ok": False, "error": "bad_folder"}

        text = str(content or "")
        if not text.strip():
            return {"ok": False, "error": "empty"}

        path = folder / f"cheevocheck_report_{time.strftime('%Y-%m-%d')}.txt"
        try:
            path.write_text(text, encoding="utf-8")
        except OSError as exc:
            decky.logger.error("couldn't write the report to %s (%s)", path, exc)
            return {"ok": False, "error": "bad_folder"}

        chown_to_data_owner(path)
        decky.logger.info("cheevocheck: report saved to %s (%d bytes)", path, len(text))
        return {"ok": True, "name": path.name, "path": str(path)}

    async def save_cheevo_check_cache_hashes(self, value: bool):
        return {
            "ok": True,
            "cheevoCheckCacheHashes": self.settings_store.update_cheevo_check_cache_hashes(value),
        }

    async def save_cheevo_check_extract_to_ram(self, value: bool):
        return {
            "ok": True,
            "cheevoCheckExtractToRam": self.settings_store.update_cheevo_check_extract_to_ram(value),
        }

    async def save_cheevo_check_verify_hashes(self, value: bool):
        return {
            "ok": True,
            "cheevoCheckVerifyHashes": self.settings_store.update_cheevo_check_verify_hashes(value),
        }

    async def save_cheevo_check_skip_disc_verify(self, value: bool):
        return {
            "ok": True,
            "cheevoCheckSkipDiscVerify":
                self.settings_store.update_cheevo_check_skip_disc_verify(value),
        }

    async def save_cheevo_check_skip_cart_verify(self, value: bool):
        return {
            "ok": True,
            "cheevoCheckSkipCartVerify":
                self.settings_store.update_cheevo_check_skip_cart_verify(value),
        }

    async def save_cheevo_check_verify_speed(self, value: str):
        return {
            "ok": True,
            "cheevoCheckVerifySpeed": self.settings_store.update_cheevo_check_verify_speed(value),
        }

    async def save_cheevo_check_scan_collapsed(self, value: bool):
        return {
            "ok": True,
            "cheevoCheckScanCollapsed": self.settings_store.update_cheevo_check_scan_collapsed(value),
        }

    async def save_cheevo_check_results_collapsed(self, value: bool):
        return {
            "ok": True,
            "cheevoCheckResultsCollapsed": self.settings_store.update_cheevo_check_results_collapsed(value),
        }

    async def save_cheevo_check_verify_collapsed(self, value: bool):
        return {
            "ok": True,
            "cheevoCheckVerifyCollapsed": self.settings_store.update_cheevo_check_verify_collapsed(value),
        }

    async def save_cheevo_check_options_collapsed(self, value: bool):
        return {
            "ok": True,
            "cheevoCheckOptionsCollapsed": self.settings_store.update_cheevo_check_options_collapsed(value),
        }

    async def update_cheevo_check_reference_data(self):
        """Fetch newer catalogues than the ones bundled with the plugin.

        Optional throughout. The plugin ships with a full set, so this only ever
        adds newer data — and every failure leaves the bundled copy in place,
        because a system is only written once its download has been parsed and
        found to hold entries. There is no way for this to end with less
        reference data than it started with, which is why it needs no undo.
        """
        return await asyncio.to_thread(self._update_cheevo_check_reference_data)

    def _update_cheevo_check_reference_data(self) -> dict:
        import cheevo_check_systems as systems
        import dat_index

        target = self.runtime_dir / "cheevo_check" / "dats"
        updated = []
        failed = []
        for system in systems.DAT_SYSTEMS:
            rows = self._fetch_reference_index(system)
            if rows is None:
                failed.append(system.name)
                continue
            path = target / f"{system.dat_key}.json.gz"
            try:
                ensure_dir(target)
                tmp = path.with_suffix(".tmp")
                with gzip.open(tmp, "wb", compresslevel=9) as out:
                    out.write(json.dumps(rows, separators=(",", ":")).encode("utf-8"))
                tmp.replace(path)
                chown_to_data_owner(path)
            except OSError as exc:
                decky.logger.warning(
                    "cheevocheck: couldn't write the refreshed catalogue for %s (%s)",
                    system.name, exc,
                )
                failed.append(system.name)
                continue
            if dat_index.load(system.dat_key, bundled_dir=target) is None:
                try:
                    path.unlink()
                except OSError:
                    pass
                failed.append(system.name)
                continue
            updated.append(system.name)

        decky.logger.info(
            "cheevocheck: reference data refresh updated %d system(s), %d failed",
            len(updated), len(failed),
        )
        return {"ok": bool(updated), "updated": len(updated), "failed": len(failed)}

    def _fetch_reference_index(self, system):
        """One system's catalogues, re-parsed into the bundled index shape.

        The same clrmamepro parse the generator does, against the same pinned
        commit's directory layout but at whatever master holds now — that is the
        entire point of the button. A rename upstream shows up as a system in the
        failed count rather than as silently missing data, because the bundled
        copy is what keeps being used.
        """
        rows = []
        seen = set()
        for kind, name in system.dat_files:
            url = f"{REFERENCE_DATA_BASE}/{urllib.parse.quote(f'metadat/{kind}/{name}')}"
            try:
                with urllib.request.urlopen(
                    url, timeout=REFERENCE_FETCH_TIMEOUT, context=self._ssl_ctx
                ) as response:
                    text = response.read().decode("utf-8", "replace")
            except Exception as exc:
                decky.logger.warning(
                    "cheevocheck: couldn't fetch %s for %s (%s)", name, system.name, exc
                )
                return None
            for block in _DAT_GAME_RE.split(text)[1:]:
                title = _DAT_NAME_RE.search(block)
                if title is None:
                    continue
                roms = _DAT_ROM_RE.findall(block)
                if not roms:
                    continue
                tracks = [[int(size), crc.lower().zfill(8)] for _rom, size, crc in roms]
                stem = _dat_stem(roms[0][0]) if len(roms) == 1 else ""
                key = (title.group(1), stem, tuple(crc for _size, crc in tracks))
                if key in seen:
                    continue
                seen.add(key)
                rows.append([title.group(1), "" if stem == title.group(1) else stem, tracks])
        return rows or None

    async def clear_cheevo_check_hash_cache(self):
        cleared = await asyncio.to_thread(self.cheevo_check_store.clear_hash_cache)
        return {"ok": True, "cleared": len(cleared)}

    async def get_cheevo_check_last_system_id(self):
        return {
            "ok": True,
            "cheevoCheckLastSystemId": self.settings_store.get_cheevo_check_last_system_id(),
        }

    async def save_cheevo_check_last_system_id(self, system_id):
        return {
            "ok": True,
            "cheevoCheckLastSystemId": self.settings_store.update_cheevo_check_last_system_id(system_id),
        }
