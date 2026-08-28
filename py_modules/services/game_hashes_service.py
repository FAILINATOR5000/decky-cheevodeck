from pathlib import Path
from urllib.parse import unquote, urlparse

import os
import re
import urllib.error
import urllib.request

import decky

from ra_client import build_user_agent
from utils import chown_to_data_owner, frontend_error, ssl_context


PATCH_HOSTS = ("github.com", "raw.githubusercontent.com", "retroachievements.org")

PATCH_MAX_BYTES = 64 * 1024 * 1024
PATCH_TIMEOUT_SECONDS = 60

PATCH_BAD_LINK = "bad_link"
PATCH_BAD_FOLDER = "bad_folder"
PATCH_TOO_BIG = "too_big"
PATCH_EXISTS = "exists"
PATCH_FAILED = "failed"

_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._ ()\[\]+-]")


class GameHashesService:
    """Fetches the supported-hash set for a single game.

    The Game Overview "Supported Hashes" tab lists which ROM dumps are
    linked to a game, the tags RA files them under (no-intro, redump,
    rapatches, ...), and -- for translations and hacks -- a link to the
    compatibility patch. It's a single RA call with no pagination, so
    this stays a thin wrapper: fetch, reshape the rows for the frontend,
    hand back a dict. Game-keyed, so there's no user identity in here at
    all.

    There is intentionally no cache and no store. The set is small and
    the tab gets opened rarely, so a fresh fetch each time is cheaper
    than a cache we'd have to keep warm and sweep.
    """

    def __init__(self, *, ra):
        self._ra = ra

    def get_game_hashes(self, web_api_key: str, game_id) -> dict:
        try:
            raw = self._ra.get_game_hashes(game_id, web_api_key)
        except Exception as exc:
            return {
                "results": [],
                "error": frontend_error("Couldn't load supported hashes.", exc),
            }

        raw_rows = []
        if isinstance(raw, dict):
            raw_rows = raw.get("Results") or raw.get("results") or []

        results = []
        for row in raw_rows:
            normalised = self._normalize_row(row)
            if normalised is not None:
                results.append(normalised)

        return {"results": results}

    def download_patch(self, url, dest_dir) -> dict:
        """Fetch one patch into a directory the user picked.

        The Hashes tab used to hand these links to the in-client browser, where
        the download simply never landed — the browser is sandboxed enough that
        the file grab fails. Pulling it here instead is the whole reason the tab
        stops being read-only.

        Everything below runs as root against a URL that came out of RA's API
        and a path that came out of the file picker, so both are treated as
        untrusted: host allowlist, no redirect off the allowlist, a size
        ceiling, and a filename scrubbed of anything that could climb out of the
        directory it's being written to.
        """
        target = self._checked_url(url)
        if target is None:
            return {"ok": False, "error": PATCH_BAD_LINK}

        folder = Path(str(dest_dir or "").strip())
        if not folder.is_dir():
            return {"ok": False, "error": PATCH_BAD_FOLDER}

        name = self._filename_for(target)
        try:
            data = self._fetch(target)
        except urllib.error.HTTPError as exc:
            decky.logger.error("patch download failed with HTTP %s: %s", exc.code, target)
            return {"ok": False, "error": PATCH_FAILED}
        except Exception as exc:
            decky.logger.error("patch download failed (%s: %s)", type(exc).__name__, exc)
            return {"ok": False, "error": PATCH_FAILED}
        if data is None:
            return {"ok": False, "error": PATCH_TOO_BIG}

        path = folder / name
        if path.exists():
            return {"ok": False, "error": PATCH_EXISTS}
        try:
            path.write_bytes(data)
        except OSError as exc:
            decky.logger.error("couldn't write the patch to %s (%s)", path, exc)
            return {"ok": False, "error": PATCH_BAD_FOLDER}

        chown_to_data_owner(path)
        decky.logger.info("patch saved to %s (%d bytes)", path, len(data))
        return {"ok": True, "path": str(path), "name": path.name}

    def _checked_url(self, url):
        text = str(url or "").strip()
        if not text:
            return None
        parsed = urlparse(text)
        if parsed.scheme != "https" or parsed.hostname is None:
            return None
        host = parsed.hostname.lower()
        if not any(host == allowed or host.endswith("." + allowed) for allowed in PATCH_HOSTS):
            decky.logger.warning("refused a patch link pointing at %s", host)
            return None
        return text

    def _filename_for(self, url) -> str:
        raw = unquote(urlparse(url).path).rsplit("/", 1)[-1]
        cleaned = _UNSAFE_NAME.sub("_", os.path.basename(raw)).strip(". ")
        return cleaned or "patch.zip"

    def _fetch(self, url):
        request = urllib.request.Request(url, headers={"User-Agent": build_user_agent()})
        with urllib.request.urlopen(
            request, context=ssl_context(), timeout=PATCH_TIMEOUT_SECONDS
        ) as response:
            if self._checked_url(response.geturl()) is None:
                return None
            data = response.read(PATCH_MAX_BYTES + 1)
        return None if len(data) > PATCH_MAX_BYTES else data

    def _normalize_row(self, row):
        if not isinstance(row, dict):
            return None

        md5 = str(row.get("MD5", row.get("md5", "")) or "").strip()
        if not md5:
            return None

        name = str(row.get("Name", row.get("name", "")) or "").strip()

        raw_labels = row.get("Labels", row.get("labels")) or []
        labels = []
        if isinstance(raw_labels, list):
            for label in raw_labels:
                text = str(label or "").strip()
                if text:
                    labels.append(text)

        patch_url = str(row.get("PatchUrl", row.get("patchUrl")) or "").strip() or None

        return {
            "md5": md5,
            "name": name,
            "labels": labels,
            "patchUrl": patch_url,
        }
