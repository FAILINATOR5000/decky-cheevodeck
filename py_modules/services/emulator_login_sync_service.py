"""
Writes a RetroAchievements login straight into the emulators' own config
files, so the user doesn't have to sign into each one by hand after switching
accounts.

There are two jobs here, both synchronous and both local file I/O.

detect_running_emulators scans /proc and reports which supported emulators are
up right now. The switch path calls it before it flips anything, because
writing a login into a config that a running emulator has already read does
nothing useful; the emulator has to be closed for the new credentials to take
on its next launch.

inject writes the login (username, token, the RA master-enable flag, and the
account's hardcore preference) into every supported emulator config that
resolves on disk.

Supported emulators are RetroArch, Dolphin, and PCSX2, the ones that keep the
RA token in their config as-is. DuckStation is deliberately not here: it
encrypts the token locally before storing it (see achievements.cpp), so a raw
token written into its settings.ini decrypts to garbage and gets rejected as
invalid. Reproducing its cipher would be fragile, and impossible if the key is
machine-derived, so DuckStation stays a manual one-time login, the same call
we made for PPSSPP.

Nothing here touches RetroAchievements, so nothing takes an RA semaphore slot.
Callers serialise us instead: inject runs inside the switch commit's trickle
lock, and the self-reinject path runs one at a time, so the service keeps no
lock of its own.

The rule that matters more than any other: every write is surgical. We touch
only the managed keys for a given emulator and leave every other byte of the
file exactly as we found it. These files hold controller binds, GPU settings,
sound config, and duplicate keys within a single section that a dict-backed INI
parser would silently collapse. So we never parse and reserialise, we edit
lines in place, and every write is diffed against the pre-write bytes to prove
only the managed lines moved. If that proof fails we raise and leave the file
untouched rather than risk corrupting someone's emulator setup.
"""

import os
from collections import Counter
from pathlib import Path

import decky


RETROARCH = "RetroArch"
DOLPHIN = "Dolphin"
PCSX2 = "PCSX2"

OUTCOME_WRITTEN = "written"
OUTCOME_SKIPPED = "skipped-not-found"
OUTCOME_ERROR = "error"

_RETROARCH_OVERRIDE_STRIP_KEYS = ("cheevos_token", "cheevos_password")


class _Adapter:
    """Static description of one emulator's config: where it lives, what shape
    it's in, and which keys we're allowed to touch.

    It's a plain object rather than a dataclass to match the rest of the
    backend, which doesn't use dataclasses anywhere. The two emulators with
    genuinely special write logic (PCSX2's two-file split, RetroArch's flat
    format plus override sweep) carry a fmt the service branches on; the two
    ordinary sectioned-INI emulators share one writer.
    """

    def __init__(
        self,
        name,
        fmt,
        path_candidates,
        process_tokens,
        section=None,
        key_username=None,
        key_token=None,
        key_enable=None,
        key_hardcore=None,
        bool_true=None,
        bool_false=None,
        creatable=False,
        create_defaults=(),
    ):
        self.name = name
        self.fmt = fmt
        self.path_candidates = path_candidates
        self.process_tokens = process_tokens
        self.section = section
        self.key_username = key_username
        self.key_token = key_token
        self.key_enable = key_enable
        self.key_hardcore = key_hardcore
        self.bool_true = bool_true
        self.bool_false = bool_false
        self.creatable = creatable
        self.create_defaults = create_defaults

    def managed_ini_keys(self):
        """The four keys this INI adapter is allowed to change, as a set."""
        return {self.key_username, self.key_token, self.key_enable, self.key_hardcore}


_ADAPTERS = [
    _Adapter(
        name=RETROARCH,
        fmt="flat",
        path_candidates=[
            ".var/app/org.libretro.RetroArch/config/retroarch/retroarch.cfg",
            ".config/retroarch/retroarch.cfg",
        ],
        process_tokens=["org.libretro.RetroArch", "retroarch"],
        key_username="cheevos_username",
        key_token="cheevos_token",
        key_enable="cheevos_enable",
        key_hardcore="cheevos_hardcore_mode_enable",
        bool_true="true",
        bool_false="false",
    ),
    _Adapter(
        name=DOLPHIN,
        fmt="ini",
        path_candidates=[
            ".var/app/org.DolphinEmu.dolphin-emu/config/dolphin-emu/RetroAchievements.ini",
            ".config/dolphin-emu/RetroAchievements.ini",
        ],
        process_tokens=["org.DolphinEmu.dolphin-emu", "dolphin-emu"],
        section="[Achievements]",
        key_username="Username",
        key_token="ApiToken",
        key_enable="Enabled",
        key_hardcore="HardcoreEnabled",
        bool_true="True",
        bool_false="False",
        creatable=True,
        create_defaults=(
            ("ChallengeIndicatorsEnabled", True),
            ("DiscordPresenceEnabled", False),
            ("EncoreEnabled", False),
            ("LeaderboardTrackerEnabled", True),
            ("ProgressEnabled", False),
            ("SpectatorEnabled", False),
            ("UnofficialEnabled", False),
        ),
    ),
    _Adapter(
        name=PCSX2,
        fmt="ini",
        path_candidates=[
            ".config/PCSX2/inis/PCSX2.ini",
            ".var/app/net.pcsx2.PCSX2/config/PCSX2/inis/PCSX2.ini",
        ],
        process_tokens=["net.pcsx2.PCSX2", "pcsx2-qt", "PCSX2"],
        section="[Achievements]",
        key_username="Username",
        key_token="Token",
        key_enable="Enabled",
        key_hardcore="ChallengeMode",
        bool_true="true",
        bool_false="false",
    ),
]


def _flat_key_of(line):
    """The key on a flat-cfg line (key = "value"), or "" if it isn't one.

    Whole-key, so anchoring on cheevos_enable never matches inside
    cheevos_leaderboards_enable: we compare the full text left of the first =,
    stripped, against the target key.
    """
    if "=" not in line:
        return ""
    return line.split("=", 1)[0].strip()


def _ini_key_of(line):
    """The key on a sectioned-INI line (Key = value), or "" if it isn't a key
    line (blank, comment, or section header)."""
    stripped = line.strip()
    if not stripped or stripped.startswith("[") or stripped.startswith(";") or stripped.startswith("#"):
        return ""
    if "=" not in line:
        return ""
    return line.split("=", 1)[0].strip()


def _is_section_header(line):
    stripped = line.strip()
    return stripped.startswith("[") and stripped.endswith("]")


def _append_preserving_newline(lines, new_line):
    """Append new_line after the last real line, keeping the file's trailing
    newline intact instead of leaving a blank line before it."""
    if lines and lines[-1] == "":
        lines.insert(len(lines) - 1, new_line)
    else:
        lines.append(new_line)


def _set_flat_value(text, key, quoted_value):
    """Set key = quoted_value in a flat cfg, in place if present, else
    appended. quoted_value is the full right-hand side including its quotes."""
    lines = text.split("\n")
    new_line = f"{key} = {quoted_value}"
    for i, line in enumerate(lines):
        if _flat_key_of(line) == key:
            lines[i] = new_line
            return "\n".join(lines)
    _append_preserving_newline(lines, new_line)
    return "\n".join(lines)


def _set_ini_value(text, section, key, value):
    """Set key = value under section in a sectioned INI.

    Three modes, all surgical: edit in place if the key is present in the
    section; insert right below the section header if the section exists but
    the key doesn't; append a fresh [section] block at the end if the section
    is absent entirely.
    """
    lines = text.split("\n")
    new_line = f"{key} = {value}"

    header_index = -1
    for i, line in enumerate(lines):
        if _is_section_header(line) and line.strip() == section:
            header_index = i
            break

    if header_index == -1:
        _append_preserving_newline(lines, section)
        _append_preserving_newline(lines, new_line)
        return "\n".join(lines)

    end_index = len(lines)
    for i in range(header_index + 1, len(lines)):
        if _is_section_header(lines[i]):
            end_index = i
            break

    for i in range(header_index + 1, end_index):
        if _ini_key_of(lines[i]) == key:
            lines[i] = new_line
            return "\n".join(lines)

    lines.insert(header_index + 1, new_line)
    return "\n".join(lines)


def _ini_section_has_key(text, section, key):
    """True if key already appears as a line under section."""
    lines = text.split("\n")
    in_section = False
    for line in lines:
        if _is_section_header(line):
            in_section = line.strip() == section
            continue
        if in_section and _ini_key_of(line) == key:
            return True
    return False


class InjectionVerifyError(Exception):
    """Raised when a proposed write would change something it shouldn't. The
    caller catches it per emulator and records an error outcome without ever
    writing the file."""
    pass


def _assert_only_allowed_lines_changed(before_text, after_text, is_managed_line):
    """Prove after_text differs from before_text only in lines that
    is_managed_line(line) accepts.

    The comparison is multiset-based rather than positional, so an inserted key
    (which shifts every line after it) doesn't read as a hundred spurious
    changes. Every line that was added and every line that was removed has to
    be a managed line, or we raise and abandon the write.
    """
    before = Counter(before_text.split("\n"))
    after = Counter(after_text.split("\n"))
    added = after - before
    removed = before - after
    for line in list(added.elements()) + list(removed.elements()):
        if not is_managed_line(line):
            raise InjectionVerifyError(f"unmanaged line would change: {line!r}")


_chown_warned = False


def _chown_best_effort(path, owner):
    """Hand a path to an (uid, gid) pair, swallowing failures.

    Same best-effort contract as utils.chown_to_data_owner: an emulator config
    living on an exFAT SD card carries no Unix ownership at all and chown fails
    there harmlessly, which must never propagate up a write path.
    """
    global _chown_warned

    try:
        os.chown(path, owner[0], owner[1])
    except OSError as exc:
        if not _chown_warned:
            _chown_warned = True
            decky.logger.warning(
                "inject: chown back to the user failed (%s: %s) for %s; "
                "further failures this session stay quiet",
                type(exc).__name__,
                exc,
                path,
            )


def _atomic_write_text(path, text, *, owner=None):
    """Write via a sibling .tmp then rename into place, so a crash mid-write
    can't leave a half-written config. Same shape as utils.save_json_file, kept
    local because that one is JSON-specific.

    ``owner`` is the (uid, gid) the finished file should belong to. It lands on
    the temp file before the rename rather than on the real path afterwards, so
    the config is never briefly visible root-owned and a chown that fails can't
    strand it that way. Same ordering save_json_file uses, for the same reason.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    if owner is not None:
        _chown_best_effort(tmp, owner)
    tmp.replace(path)


class EmulatorLoginSyncService:
    """Detects running emulators and injects a RA login into their configs.

    See the module docstring for the surgical-write contract. main.py builds
    one of these and calls it from the switch commit path; the home_dir
    override exists only so the writer/diff tests can point the whole
    resolution machinery at a scratch tree of copied real configs.
    """

    def __init__(self, *, debug_logging_provider=None, home_dir=None):
        self._debug_logging_provider = debug_logging_provider
        self._home = Path(home_dir) if home_dir else Path.home()

    def _debug_logging_on(self):
        if self._debug_logging_provider is None:
            return False
        return bool(self._debug_logging_provider())

    def _debug_log(self, message, *args):
        if self._debug_logging_on():
            decky.logger.info("inject: " + message, *args)

    def _write_atomic(self, path, text):
        owner = None
        try:
            if os.geteuid() == 0:
                st = self._home.stat()
                owner = (st.st_uid, st.st_gid)
        except OSError:
            pass

        _atomic_write_text(path, text, owner=owner)

        if owner is not None:
            _chown_best_effort(path.parent, owner)

    def detect_running_emulators(self):
        """Return the display names of every supported emulator with a live
        process, by substring-matching /proc/<pid>/cmdline.

        Dependency-free on purpose, since pgrep isn't guaranteed on PATH in the
        Decky runtime. A pid that vanishes mid-scan, or a cmdline we can't
        read, is just skipped.
        """
        running = []
        proc = Path("/proc")
        cmdlines = []
        try:
            entries = list(proc.iterdir())
        except OSError:
            return running

        for entry in entries:
            if not entry.name.isdigit():
                continue
            try:
                raw = (entry / "cmdline").read_bytes()
            except OSError:
                continue
            cmdlines.append(raw.replace(b"\x00", b" ").decode("utf-8", "ignore"))

        for adapter in _ADAPTERS:
            if any(self._process_running(adapter, line) for line in cmdlines):
                running.append(adapter.name)
                self._debug_log("running: %s", adapter.name)
        return running

    def is_dolphin_running(self):
        """True if a Dolphin process (flatpak or AppImage) is live. The Dolphin
        mapper checks this before applying a mapping: Dolphin reads its
        controller configs at launch and rewrites them on exit, so a write while
        it's up is ignored or clobbered. Reuses the same /proc scan, narrowed to
        Dolphin's tokens."""
        return DOLPHIN in self.detect_running_emulators()

    def _process_running(self, adapter, cmdline):
        haystack = cmdline.lower()
        return any(token.lower() in haystack for token in adapter.process_tokens)

    def inject(self, username, token, hardcore):
        """Write the login into every supported emulator that resolves.

        Returns {"ok": bool, "results": [ {emulator, outcome, detail}, ... ]}.
        One emulator failing (a permission error, a verify tripping) records an
        error row and moves on; it never aborts the others. ok is False if any
        row errored, so the caller can decide whether to surface a problem.
        """
        results = []
        for adapter in _ADAPTERS:
            try:
                outcome, detail = self._inject_one(adapter, username, token, bool(hardcore))
            except Exception as exc:
                decky.logger.exception("inject: %s failed (%s)", adapter.name, exc)
                results.append({"emulator": adapter.name, "outcome": OUTCOME_ERROR, "detail": str(exc)})
                continue
            results.append({"emulator": adapter.name, "outcome": outcome, "detail": detail})
            self._debug_log("%s -> %s (%s)", adapter.name, outcome, detail)

        ok = not any(row["outcome"] == OUTCOME_ERROR for row in results)
        return {"ok": ok, "results": results}

    def _inject_one(self, adapter, username, token, hardcore):
        paths = self._resolve_all_existing(adapter)
        if not paths:
            if not adapter.creatable:
                return OUTCOME_SKIPPED, "no config file found"
            path = self._home / adapter.path_candidates[0]
            return OUTCOME_WRITTEN, self._create_sectioned(adapter, path, username, token, hardcore)

        wrote_any = False
        details = []
        for path in paths:
            try:
                details.append(self._inject_at(adapter, path, username, token, hardcore))
                wrote_any = True
            except Exception as exc:
                decky.logger.exception("inject: %s at %s failed (%s)", adapter.name, path, exc)
                details.append(f"{path.name}: error ({exc})")
        return (OUTCOME_WRITTEN if wrote_any else OUTCOME_ERROR), "; ".join(details)

    def _inject_at(self, adapter, path, username, token, hardcore):
        if adapter.fmt == "flat":
            return self._inject_retroarch(adapter, path, username, token, hardcore)
        if adapter.name == PCSX2:
            return self._inject_pcsx2(adapter, path, username, token, hardcore)
        return self._inject_sectioned(adapter, path, username, token, hardcore)

    def _resolve_all_existing(self, adapter):
        """Every candidate path that exists on disk, de-duplicated by real path
        so a symlinked-together pair (EmuDeck does this sometimes) is only
        written once."""
        found = []
        seen = set()
        for candidate in adapter.path_candidates:
            path = self._home / candidate
            if not path.exists():
                continue
            real = path.resolve()
            if real in seen:
                continue
            seen.add(real)
            found.append(path)
        return found

    def _inject_sectioned(self, adapter, path, username, token, hardcore):
        before = path.read_text(encoding="utf-8")

        if not before.strip():
            return self._create_sectioned(adapter, path, username, token, hardcore)

        after = self._apply_sectioned_values(adapter, before, username, token, hardcore)
        managed = adapter.managed_ini_keys()
        _assert_only_allowed_lines_changed(
            before,
            after,
            lambda line: _ini_key_of(line) in managed or line.strip() == "",
        )
        self._write_atomic(path, after)
        return f"edited {path}"

    def _create_sectioned(self, adapter, path, username, token, hardcore):
        hardcore_value = adapter.bool_true if hardcore else adapter.bool_false
        lines = [
            adapter.section,
            f"{adapter.key_enable} = {adapter.bool_true}",
            f"{adapter.key_hardcore} = {hardcore_value}",
            f"{adapter.key_username} = {username}",
            f"{adapter.key_token} = {token}",
        ]
        for key, enabled in adapter.create_defaults:
            lines.append(f"{key} = {adapter.bool_true if enabled else adapter.bool_false}")
        lines.append("")
        self._write_atomic(path, "\n".join(lines))
        return f"created {path}"

    def _apply_sectioned_values(self, adapter, text, username, token, hardcore):
        hardcore_value = adapter.bool_true if hardcore else adapter.bool_false
        text = _set_ini_value(text, adapter.section, adapter.key_enable, adapter.bool_true)
        text = _set_ini_value(text, adapter.section, adapter.key_hardcore, hardcore_value)
        text = _set_ini_value(text, adapter.section, adapter.key_username, username)
        text = _set_ini_value(text, adapter.section, adapter.key_token, token)
        return text

    def _inject_pcsx2(self, adapter, path, username, token, hardcore):
        hardcore_value = adapter.bool_true if hardcore else adapter.bool_false
        before = path.read_text(encoding="utf-8")

        after = _set_ini_value(before, adapter.section, adapter.key_enable, adapter.bool_true)
        after = _set_ini_value(after, adapter.section, adapter.key_hardcore, hardcore_value)
        after = _set_ini_value(after, adapter.section, adapter.key_username, username)

        token_in_main = _ini_section_has_key(before, adapter.section, adapter.key_token)
        if token_in_main:
            after = _set_ini_value(after, adapter.section, adapter.key_token, token)
            main_managed = {adapter.key_username, adapter.key_enable, adapter.key_hardcore, adapter.key_token}
        else:
            main_managed = {adapter.key_username, adapter.key_enable, adapter.key_hardcore}

        _assert_only_allowed_lines_changed(
            before,
            after,
            lambda line: _ini_key_of(line) in main_managed or line.strip() == "",
        )
        self._write_atomic(path, after)

        if token_in_main:
            return f"edited {path} (legacy inline token)"

        secrets_path = path.parent / "secrets.ini"
        detail = self._write_pcsx2_secrets(adapter, secrets_path, token)
        return f"edited {path}; {detail}"

    def _write_pcsx2_secrets(self, adapter, secrets_path, token):
        if not secrets_path.exists():
            created = "\n".join([adapter.section, f"{adapter.key_token} = {token}", ""])
            self._write_atomic(secrets_path, created)
            return f"created {secrets_path}"

        before = secrets_path.read_text(encoding="utf-8")
        after = _set_ini_value(before, adapter.section, adapter.key_token, token)
        _assert_only_allowed_lines_changed(
            before,
            after,
            lambda line: _ini_key_of(line) == adapter.key_token or line.strip() == "",
        )
        self._write_atomic(secrets_path, after)
        return f"edited {secrets_path}"

    def _inject_retroarch(self, adapter, path, username, token, hardcore):
        hardcore_bool = adapter.bool_true if hardcore else adapter.bool_false
        hardcore_value = f'"{hardcore_bool}"'
        before = path.read_text(encoding="utf-8")

        after = _set_flat_value(before, adapter.key_username, f'"{username}"')
        after = _set_flat_value(after, adapter.key_token, f'"{token}"')
        after = _set_flat_value(after, adapter.key_enable, f'"{adapter.bool_true}"')
        after = _set_flat_value(after, adapter.key_hardcore, hardcore_value)
        after = _set_flat_value(after, "cheevos_password", '""')

        managed = {
            adapter.key_username,
            adapter.key_token,
            adapter.key_enable,
            adapter.key_hardcore,
            "cheevos_password",
        }
        _assert_only_allowed_lines_changed(
            before,
            after,
            lambda line: _flat_key_of(line) in managed or line.strip() == "",
        )
        self._write_atomic(path, after)

        swept = self._sweep_retroarch_overrides(path)
        detail = f"edited {path}"
        if swept:
            detail += f"; swept {swept} override(s)"
        return detail

    def _sweep_retroarch_overrides(self, main_cfg_path):
        """Strip cheevos_token/cheevos_password out of any per-core or per-game
        override cfg so a stale value there can't shadow the main cfg. Returns
        how many override files were changed.

        Overrides live under <config_root>/config/**/*.cfg next to the main
        retroarch.cfg. We only rewrite a file that actually carries one of the
        two keys, and we remove only those lines.
        """
        overrides_root = main_cfg_path.parent / "config"
        if not overrides_root.is_dir():
            return 0

        changed = 0
        for cfg in overrides_root.rglob("*.cfg"):
            try:
                before = cfg.read_text(encoding="utf-8")
            except OSError:
                continue
            kept = [
                line for line in before.split("\n")
                if _flat_key_of(line) not in _RETROARCH_OVERRIDE_STRIP_KEYS
            ]
            after = "\n".join(kept)
            if after == before:
                continue
            _assert_only_allowed_lines_changed(
                before,
                after,
                lambda line: _flat_key_of(line) in _RETROARCH_OVERRIDE_STRIP_KEYS or line.strip() == "",
            )
            self._write_atomic(cfg, after)
            changed += 1
            self._debug_log("swept override %s", cfg)
        return changed
