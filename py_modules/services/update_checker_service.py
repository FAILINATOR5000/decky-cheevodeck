from pathlib import Path
from urllib.parse import urlparse

import json
import re
import threading
import time
import urllib.error
import urllib.request

import decky

from services._tick_common import GenerationFence
from notifications import emit_notification, is_type_enabled
from ra_client import build_user_agent
from utils import chown_to_data_owner


GITHUB_OWNER = "FAILINATOR5000"
GITHUB_REPO = "decky-cheevodeck"

LATEST_RELEASE_URL = "https://api.github.com/repos/%s/%s/releases/latest" % (GITHUB_OWNER, GITHUB_REPO)

CHECK_INTERVAL_SECONDS = 12 * 60 * 60

TICK_SECONDS = 15 * 60

STARTUP_DELAY_SECONDS = 20.0

MANUAL_COOLDOWN_SECONDS = 10

FETCH_TIMEOUT_SECONDS = 15

ERROR_UNREACHABLE = "unreachable"

RELEASE_DOWNLOAD_HOSTS = ("github.com", "githubusercontent.com")

DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024

DOWNLOAD_TIMEOUT_SECONDS = 120

DOWNLOAD_BAD_FOLDER = "bad_folder"
DOWNLOAD_TOO_BIG = "too_big"
DOWNLOAD_FAILED = "failed"

UPDATER_SCRIPT_URL = "https://raw.githubusercontent.com/%s/%s/main/update-cheevodeck.sh" % (
    GITHUB_OWNER,
    GITHUB_REPO,
)

LAUNCHER_FILE_NAME = "Install or Update CheevoDeck.desktop"

LAUNCHER_NO_DESKTOP = "no_desktop"
LAUNCHER_FAILED = "launcher_failed"

LAUNCHER_TEXT = """#!/usr/bin/env xdg-open
[Desktop Entry]
Name=Install/Update CheevoDeck
Comment=Install CheevoDeck, or update it to the latest version
Exec=sh -c 'rm -f /tmp/update-cheevodeck.sh; if curl -fsL --connect-timeout 60 -o /tmp/update-cheevodeck.sh %s && head -n 1 /tmp/update-cheevodeck.sh | grep -q "^#!"; then bash /tmp/update-cheevodeck.sh; else echo "Could not download the updater. Check your connection and try again."; read -r _; fi'
Icon=system-software-update
Terminal=true
Type=Application
StartupNotify=false
""" % UPDATER_SCRIPT_URL


_generation_fence = GenerationFence()


def display_version(raw):
    """Strip a tag down to the bare number for anything the user reads.

    The installed version comes from package.json, which has no "v" on it, so
    a v-prefixed tag printed raw gives you "Version v0.9.0 available." sitting
    directly under "Version 0.8.0" — the same number written two ways, in two
    lines that are meant to be compared. Tag however you like; the "v" stops
    at the display boundary.
    """
    text = str(raw or "").strip()
    if text[:1] in ("v", "V"):
        text = text[1:]
    return text


def parse_version(raw):
    """Turn "v0.5.0" into (0, 5, 0), or None if it isn't a plain number tag.

    Deliberately unforgiving about anything that isn't digits-and-dots: a tag
    we can't read comes back None, and every caller reads None as "not newer".
    That's what keeps a hand-cut tag ("nightly", "0.5.0-rc1") from painting a
    phantom update banner.
    """
    text = display_version(raw)
    if not text:
        return None

    parts = []
    for chunk in text.split("."):
        if not chunk.isdigit():
            return None
        parts.append(int(chunk))
    return tuple(parts) if parts else None


def release_asset_name(tag):
    """The zip's filename for a tag: v0.8.1 gives CheevoDeck-0.8.1.zip.

    The name carries the version so consecutive downloads sit side by side in
    the user's folder instead of overwriting each other, and so it's obvious
    which one is about to be installed. It also has to agree with what's
    actually attached to the release, because that agreement is the only thing
    standing between a mistyped upload and a release nobody is ever told about.

    Empty for a tag that isn't digits and dots, which is the same answer every
    other version function here gives to a tag it can't read.
    """
    number = display_version(tag)
    if parse_version(number) is None:
        return ""
    return "CheevoDeck-%s.zip" % number


def release_install_url(tag):
    """Where that zip lives, pinned to its own release rather than to latest.

    /releases/latest/download/<asset> would be shorter, and it used to be what
    this was, but it points at whatever is newest at the moment it's followed:
    copy the link, wait for the next release, paste it, and you quietly install
    a version you never asked for. The per-release path can only ever hand back
    the build the About page was talking about.

    Built here rather than read off the API's browser_download_url so the URL
    stays one of ours. It also survives a round trip through the settings
    store, which keeps only the tag, the page URL and the timestamp.

    Safe to interpolate without escaping: parse_version accepts nothing but an
    optional v and digits and dots, so a tag that reaches this line has no
    separator in it to climb out of the path with.
    """
    name = release_asset_name(tag)
    if not name:
        return ""
    return "https://github.com/%s/%s/releases/download/%s/%s" % (
        GITHUB_OWNER,
        GITHUB_REPO,
        str(tag or "").strip(),
        name,
    )


def is_newer_version(candidate, installed):
    left = parse_version(candidate)
    right = parse_version(installed)
    if left is None or right is None:
        return False
    return left > right


def installed_version():
    return str(getattr(decky, "DECKY_PLUGIN_VERSION", "") or "").strip()


class UpdateCheckerService:
    """Background daemon that watches GitHub for a newer CheevoDeck release.

    One tick every TICK_SECONDS, and each tick asks the same question the
    "Check now" button on the About page asks -- has enough time passed, and
    if so, what does GitHub say. When a release lands that's newer than what's
    installed, and that we haven't already interrupted the user about, we push
    a "system" notification and cache the release so the About page can offer
    the install link and the patch notes.

    Nothing here touches RetroAchievements, so nothing here takes an RA
    semaphore slot. Taking one would mean a version check could block a
    user-initiated RA task behind a GitHub call, which is exactly backwards.

    Threading: the tick runs on its own OS thread and the "Check now" RPC
    arrives on the asyncio loop, so main.py bounces it off-loop with
    asyncio.to_thread and every caller ends up on the thread side. One
    threading.Lock guards the whole check-and-write section -- the gate test
    and the last-checked stamp have to be in the same held section, or two
    ticks can both read "yes, it's been 12 hours" before either stamps.

    Install stays manual by design. The user copies the release zip URL and
    pastes it into Decky's Install from URL. Reaching into Decky's own
    install_plugin is an undocumented API on an independently-updating
    project, with a self-overwrite wrinkle on top.
    """

    def __init__(self, *, settings_store, ssl_context, user_home, notifications_store=None):
        self._settings_store = settings_store
        self._ssl_context = ssl_context
        self._user_home = Path(user_home)

        self._notifications = notifications_store

        self._thread = None
        self._stop_event = threading.Event()
        self._lifecycle_lock = threading.Lock()

        self._check_lock = threading.Lock()

        self._generation = -1

        self._debug_logging = False

        self._held_tag = ""

        self._event_loop = None

    def _debug_log(self, message, *args):
        if self._debug_logging:
            decky.logger.info(message, *args)

    def set_event_loop(self, loop):
        self._event_loop = loop

    def start(self):
        with self._lifecycle_lock:
            if self._thread is not None and self._thread.is_alive():
                return

            self._stop_event.clear()
            self._generation = _generation_fence.claim()
            thread = threading.Thread(
                target=self._run_loop,
                name="update-checker",
                daemon=True,
            )
            self._thread = thread

        thread.start()
        decky.logger.info(
            "update: thread started (generation %d)",
            self._generation,
        )

    def stop(self):
        self._stop_event.set()
        decky.logger.info("update: stop requested")

    def _run_loop(self):
        my_generation = self._generation
        if self._stop_event.wait(STARTUP_DELAY_SECONDS):
            return

        while not self._stop_event.is_set():
            if not _generation_fence.is_live(my_generation):
                self._debug_log(
                    "update: gen=%d superseded, exiting tid=%d",
                    my_generation,
                    threading.get_ident(),
                )
                return

            try:
                self.check()
            except Exception as exc:
                decky.logger.exception(
                    "update: tick crashed: %s (%s)",
                    type(exc).__name__,
                    exc,
                )

            if self._stop_event.wait(TICK_SECONDS):
                return

    def check(self, force=False):
        """Poll GitHub if the caller's gate allows it, and return the status.

        force is the "Check now" button: it skips the 12-hour gate but still
        honours the short cooldown, so a mash can't turn into a run of HTTP
        calls. Either way the answer that comes back is the current status,
        so a press that lands inside the cooldown reports the freshly fetched
        result rather than doing nothing visible.
        """
        with self._check_lock:
            try:
                cfg = self._settings_store.load_config()
                self._debug_logging = self._settings_store.get_debug_logging(cfg)
            except Exception:
                cfg = None

            state = self._settings_store.load_update_check_state(cfg)
            now = int(time.time())
            last_checked = state["lastCheckedAt"]

            if last_checked > now:
                last_checked = 0

            gate = MANUAL_COOLDOWN_SECONDS if force else CHECK_INTERVAL_SECONDS
            if last_checked and now - last_checked < gate:
                self._debug_log(
                    "update: gate closed, %ds since last check (force=%s)",
                    now - last_checked,
                    force,
                )
                self._maybe_notify(state)
                return self._status_for(state)

            try:
                release = self._fetch_latest_release()
            except Exception as exc:
                self._debug_log(
                    "update: fetch failed: %s (%s)",
                    type(exc).__name__,
                    exc,
                )
                return self._status_for(state, error=ERROR_UNREACHABLE)

            if release is None:
                return self._status_for(state, error=ERROR_UNREACHABLE)

            self._settings_store.save_update_release(release, now)

            state = {
                "release": release,
                "lastCheckedAt": now,
                "lastNotifiedTag": state["lastNotifiedTag"],
            }
            self._maybe_notify(state)

            return self._status_for(state)

    def get_status(self):
        """The cached answer, with no poll. What the About page reads on open."""
        state = self._settings_store.load_update_check_state()
        return self._status_for(state)

    def download_release(self, dest_dir):
        """Save the release zip into the folder the user picked.

        The second of the two install routes the About page offers. The first
        one hands Decky the URL and lets it do the fetching; this one puts the
        file on disk so the user can install it from the ZIP picker instead,
        keep a copy to go back to, or carry it to a second device.

        Runs as root against a path that came out of the file picker, so the
        same posture as the patch downloader: the URL is ours, built here from
        the tag rather than taken off the API response, the
        redirect it lands on is re-checked against RELEASE_DOWNLOAD_HOSTS, the
        read is bounded, and the file gets chowned back afterwards or the user
        can't touch what we just wrote for them.
        """
        folder = Path(str(dest_dir or "").strip())
        if not folder.is_dir():
            return {"ok": False, "error": DOWNLOAD_BAD_FOLDER}

        state = self._settings_store.load_update_check_state()
        release = state["release"]
        tag = release.get("tag", "") if release else ""
        name = release_asset_name(tag)
        url = release_install_url(tag)
        if not name or not url:
            decky.logger.error("update: cached release has no usable tag (%r)", tag)
            return {"ok": False, "error": DOWNLOAD_FAILED}

        try:
            data = self._fetch_release_zip(url)
        except urllib.error.HTTPError as exc:
            decky.logger.error("update download failed with HTTP %s", exc.code)
            return {"ok": False, "error": DOWNLOAD_FAILED}
        except Exception as exc:
            decky.logger.error("update download failed (%s: %s)", type(exc).__name__, exc)
            return {"ok": False, "error": DOWNLOAD_FAILED}
        if data is None:
            return {"ok": False, "error": DOWNLOAD_TOO_BIG}

        path = folder / name
        try:
            path.write_bytes(data)
        except OSError as exc:
            decky.logger.error("couldn't write the update to %s (%s)", path, exc)
            return {"ok": False, "error": DOWNLOAD_BAD_FOLDER}

        chown_to_data_owner(path)
        decky.logger.info("update saved to %s (%d bytes)", path, len(data))
        return {"ok": True, "path": str(path), "name": path.name}

    def place_desktop_launcher(self):
        """Put the one-click updater on the user's desktop.

        The launcher holds a URL, not a copy of the script: it downloads
        update-cheevodeck.sh into /tmp each time it runs. That way a fix to the
        script reaches everyone who already has the launcher, and nothing
        stale is left lying around between runs.

        Runs as root, so the file lands root-owned and unreadable to the person
        who asked for it unless it gets chowned back. It also needs the execute
        bit or KDE refuses to launch it and opens a text editor instead.
        """
        desktop = self._desktop_dir()
        if desktop is None:
            decky.logger.error("update: no desktop folder under %s", self._user_home)
            return {"ok": False, "error": LAUNCHER_NO_DESKTOP}

        path = desktop / LAUNCHER_FILE_NAME
        try:
            path.write_text(LAUNCHER_TEXT, encoding="utf-8")
            path.chmod(0o755)
        except OSError as exc:
            decky.logger.error("couldn't write the updater launcher to %s (%s)", path, exc)
            return {"ok": False, "error": LAUNCHER_FAILED}

        chown_to_data_owner(path)
        decky.logger.info("updater launcher written to %s", path)
        return {"ok": True, "path": str(path), "name": path.name}

    def _desktop_dir(self):
        """Where the user's desktop actually is.

        Reading user-dirs.dirs rather than running xdg-user-dir, because this
        process is root and the tool would answer for root's home instead of
        theirs. The folder is localised on a non-English install, so ~/Desktop
        is the fallback and not the first guess.
        """
        config = self._user_home / ".config" / "user-dirs.dirs"
        try:
            for line in config.read_text(encoding="utf-8", errors="replace").splitlines():
                match = re.match(r'\s*XDG_DESKTOP_DIR\s*=\s*"(.*)"\s*$', line)
                if match:
                    raw = match.group(1).replace("$HOME", str(self._user_home))
                    candidate = Path(raw)
                    if candidate.is_dir():
                        return candidate
        except OSError:
            pass

        fallback = self._user_home / "Desktop"
        return fallback if fallback.is_dir() else None

    def _fetch_release_zip(self, url):
        request = urllib.request.Request(
            url,
            headers={"User-Agent": build_user_agent()},
        )
        with urllib.request.urlopen(
            request,
            context=self._ssl_context,
            timeout=DOWNLOAD_TIMEOUT_SECONDS,
        ) as response:
            final = response.geturl()
            if not self._allowed_download_host(final):
                raise ValueError(
                    "release download redirected to %s" % (urlparse(final).hostname or "?")
                )
            data = response.read(DOWNLOAD_MAX_BYTES + 1)
        return None if len(data) > DOWNLOAD_MAX_BYTES else data

    def _allowed_download_host(self, url):
        host = (urlparse(str(url or "")).hostname or "").lower()
        return any(
            host == allowed or host.endswith("." + allowed)
            for allowed in RELEASE_DOWNLOAD_HOSTS
        )

    def _status_for(self, state, error=None):
        release = state["release"]
        tag = release.get("tag", "") if release else ""
        current = installed_version()
        return {
            "ok": True,
            "installedVersion": current,
            "latestVersion": display_version(tag),
            "updateAvailable": is_newer_version(tag, current),
            "patchNotesUrl": release.get("htmlUrl", "") if release else "",
            "installUrl": release_install_url(tag),
            "publishedAt": release.get("publishedAt", "") if release else "",
            "lastCheckedAt": state["lastCheckedAt"],
            "error": error,
        }

    def _fetch_latest_release(self):
        request = urllib.request.Request(
            LATEST_RELEASE_URL,
            headers={
                "User-Agent": build_user_agent(),
                "Accept": "application/vnd.github+json",
            },
        )
        with urllib.request.urlopen(
            request,
            timeout=FETCH_TIMEOUT_SECONDS,
            context=self._ssl_context,
        ) as response:
            raw = json.loads(response.read().decode("utf-8"))

        if not isinstance(raw, dict):
            return None

        tag = str(raw.get("tag_name") or "").strip()
        if not tag:
            return None

        wanted = release_asset_name(tag)
        if not wanted or not self._has_install_asset(raw, wanted):
            decky.logger.warning(
                "update: release %s has no %s asset, ignoring",
                tag,
                wanted or "version-stamped zip",
            )
            return None

        return {
            "tag": tag,
            "htmlUrl": str(raw.get("html_url") or "").strip(),
            "publishedAt": str(raw.get("published_at") or "").strip(),
        }

    def _has_install_asset(self, raw, wanted):
        assets = raw.get("assets")
        if not isinstance(assets, list):
            return False
        for asset in assets:
            if isinstance(asset, dict) and str(asset.get("name") or "").strip() == wanted:
                return True
        return False

    def _maybe_notify(self, state):
        release = state["release"]
        if not isinstance(release, dict):
            return

        tag = release.get("tag", "")
        if not is_newer_version(tag, installed_version()):
            return
        if tag == state["lastNotifiedTag"]:
            return

        if not str(self._settings_store.load_config().get("activeUlid") or "").strip():
            if tag != self._held_tag:
                self._held_tag = tag
                decky.logger.info("update: %s is newer, holding until an account exists", tag)
            return

        self._held_tag = ""

        self._settings_store.save_update_notified_tag(tag)

        decky.logger.info("update: %s is newer than %s, notifying", tag, installed_version())

        if self._notifications is not None and is_type_enabled("system", self._settings_store):
            self._notifications.append({
                "type": "system",
                "kind": "actionable",
                "iconSource": "none",
                "title": "CheevoDeck Update Available",
                "body": "Version %s available." % display_version(tag),
                "source": "notifications",
                "target": {
                    "view": "external",
                    "url": release.get("htmlUrl", ""),
                },
                "meta": {
                    "version": display_version(tag),
                },
            })

        emit_notification(
            ntype="system",
            title_key="CheevoDeck Update Available",
            line_key="Version {{version}} available.",
            template_vars={"version": display_version(tag)},
            settings_store=self._settings_store,
            event_loop=self._event_loop,
        )
