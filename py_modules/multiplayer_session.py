import hashlib
import os
import re
import shlex
import zipfile
import zlib
from pathlib import Path, PurePosixPath

from multiplayer_protocol import NETPACKET_CORES

RETROARCH_CONFIGS = (
    ".var/app/org.libretro.RetroArch/config/retroarch/retroarch.cfg",
    ".config/retroarch/retroarch.cfg",
)
PPSSPP_CONFIGS = (
    ".var/app/org.ppsspp.PPSSPP/config/ppsspp/PSP/SYSTEM/ppsspp.ini",
    ".config/ppsspp/PSP/SYSTEM/ppsspp.ini",
)
EMUDECK_SETTINGS = (".config/EmuDeck/settings.sh", "emudeck/settings.sh")

RETROARCH_FLATPAK = "org.libretro.RetroArch"
PPSSPP_FLATPAK = "org.ppsspp.PPSSPP"

PPSSPP_STANDALONE = "ppsspp-standalone"
GAMBATTE = "gambatte"
PPSSPP_CORE = "ppsspp"
GPSP = "gpsp"

NES_SYSTEM = 7
GB_SYSTEMS = (4, 6)
GBA_SYSTEM = 5
PSP_SYSTEM = 41

LINK_CORES = {4: GAMBATTE, 6: GAMBATTE, GBA_SYSTEM: GPSP, PSP_SYSTEM: PPSSPP_CORE}

GBA_LINK_CODES = frozenset((
    "AW2E", "AW2P", "AWRE", "AWRP", "AXPD", "AXPE", "AXPF", "AXPI", "AXPJ", "AXPS",
    "AXVD", "AXVE", "AXVF", "AXVI", "AXVJ", "AXVS", "B2WE", "B3AE", "B4UE", "B4UP",
    "B85A", "B85P", "BDGE", "BDGP", "BG3E", "BKRJ", "BMGD", "BMGE", "BMGF", "BMGI",
    "BMGJ", "BMGP", "BMGS", "BMGU", "BPED", "BPEE", "BPEF", "BPEI", "BPEJ", "BPES",
    "BPGD", "BPGE", "BPGF", "BPGI", "BPGJ", "BPGS", "BPRD", "BPRE", "BPRF", "BPRI",
    "BPRJ", "BPRS", "BR5E", "BR6E", "BRBE", "BRKE", "BTME", "BTMJ", "BTMP",
))

GEN3_POKEMON_CODES = ("AXV", "AXP", "BPR", "BPG", "BPE")

GEN3_POKEMON_GAMES = frozenset((790, 791, 515, 788, 668))

SESSION_CFG_KEYS = (
    "config_save_on_exit",
    "remap_save_on_exit",
    "cheevos_hardcore_mode_enable",
    "netplay_public_announce",
    "netplay_nat_traversal",
    "netplay_use_mitm_server",
    "netplay_max_connections",
    "netplay_start_as_spectator",
    "game_specific_options",
    "global_core_options",
    "core_options_path",
) + tuple(f"netplay_request_device_p{n}" for n in range(1, 17))

DATABASES = {
    1: ("Sega - Mega Drive - Genesis",),
    2: ("Nintendo - Nintendo 64",),
    3: ("Nintendo - Super Nintendo Entertainment System",),
    4: ("Nintendo - Game Boy",),
    5: ("Nintendo - Game Boy Advance",),
    6: ("Nintendo - Game Boy Color",),
    7: ("Nintendo - Nintendo Entertainment System",),
    8: ("NEC - PC Engine - TurboGrafx 16", "NEC - PC Engine SuperGrafx"),
    9: ("Sega - Mega-CD - Sega CD",),
    10: ("Sega - 32X",),
    11: ("Sega - Master System - Mark III",),
    12: ("Sony - PlayStation",),
    13: ("Atari - Lynx",),
    14: ("SNK - Neo Geo Pocket", "SNK - Neo Geo Pocket Color"),
    15: ("Sega - Game Gear",),
    17: ("Atari - Jaguar",),
    18: ("Nintendo - Nintendo DS",),
    23: ("Magnavox - Odyssey2",),
    24: ("Nintendo - Pokemon Mini",),
    25: ("Atari - 2600",),
    28: ("Nintendo - Virtual Boy",),
    29: ("Microsoft - MSX", "Microsoft - MSX2"),
    33: ("Sega - SG-1000",),
    39: ("Sega - Saturn",),
    40: ("Sega - Dreamcast",),
    41: ("Sony - PlayStation Portable",),
    43: ("The 3DO Company - 3DO",),
    44: ("Coleco - ColecoVision",),
    45: ("Mattel - Intellivision",),
    46: ("GCE - Vectrex",),
    47: ("NEC - PC-8001 - PC-8801",),
    49: ("NEC - PC-FX",),
    51: ("Atari - 7800",),
    53: ("Bandai - WonderSwan", "Bandai - WonderSwan Color"),
    56: ("SNK - Neo Geo CD",),
    57: ("Fairchild - Channel F",),
    63: ("Watara - Supervision",),
    69: ("Welback - Mega Duck",),
    71: ("Arduboy Inc - Arduboy",),
    76: ("NEC - PC Engine CD - TurboGrafx-CD",),
    77: ("Atari - Jaguar",),
    78: ("Nintendo - Nintendo DSi",),
    80: ("Uzebox",),
    81: ("Nintendo - Family Computer Disk System",),
}

MULTITAP = {
    "snes9x": {"devices": {2: "257"}},
    "genesis_plus_gx": {"devices": {1: "1025", 2: "1025"}},
    "picodrive": {"options": {"picodrive_input1": "4way play", "picodrive_input2": "4way play"}},
    "mednafen_pce": {"options": {"pce_multitap": "enabled"}},
    "mednafen_psx_hw": {"options": {"beetle_psx_hw_enable_multitap_port1": "enabled"}},
    "mednafen_psx": {"options": {"beetle_psx_enable_multitap_port1": "enabled"}},
    "pcsx_rearmed": {"options": {"pcsx_rearmed_multitap": "port 1"}},
}

_STANDALONE_NAMES = (
    ("ppsspp", ("ppsspp", "ppsspp.sh", "org.ppsspp.ppsspp", "ppssppsdl", "ppssppqt")),
    ("dolphin", ("dolphin", "dolphin-flatpak", "dolphin-emu", "dolphin-emu.sh", "dolphin-emu-wrapper",
                 "org.dolphinemu.dolphin-emu")),
    ("duckstation", ("duckstation", "duckstation.sh", "org.duckstation.duckstation")),
    ("pcsx2", ("pcsx2", "pcsx2-qt", "pcsx2-qt.sh", "net.pcsx2.pcsx2")),
    ("melonds", ("melonds", "melonds.sh", "net.kuribo64.melonds")),
)
_CPU_FLAGS = {0: "-i", 1: "-j", 2: "-r", 3: "-J"}
_CFG_LINE = re.compile(r'^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$')
_INI_LINE = re.compile(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$")


def read_cfg(path) -> dict:
    out = {}
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if line.lstrip().startswith("#"):
                    continue
                found = _CFG_LINE.match(line)
                if found:
                    out[found.group(1)] = found.group(2)
    except OSError:
        pass
    return out


def read_cfg_lines(path) -> list:
    pairs = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                found = _CFG_LINE.match(line)
                if found and not line.lstrip().startswith("#"):
                    pairs.append((found.group(1), found.group(2)))
    except OSError:
        pass
    return pairs


def write_cfg(pairs) -> str:
    return "".join(f'{key} = "{value}"\n' for key, value in pairs)


def _expand(value: str, home: Path, base: Path):
    if not value or value == "default":
        return None
    if value.startswith("~"):
        return home / value[1:].lstrip("/")
    if value.startswith(":"):
        return base / value[1:].lstrip("/")
    return Path(value)


class RetroArch:
    def __init__(self, home):
        self.home = Path(home)
        self.cfg_path = None
        for relative in RETROARCH_CONFIGS:
            candidate = self.home / relative
            if candidate.is_file():
                self.cfg_path = candidate
                break
        self.cfg = read_cfg(self.cfg_path) if self.cfg_path else {}
        base = self.cfg_path.parent if self.cfg_path else self.home
        self.base = base
        self.config_dir = self._dir("rgui_config_directory", base / "config")
        self.info_dir = self._dir("libretro_info_path", base / "info")
        self.cores_dir = self._dir("libretro_directory", base / "cores")
        self.remap_dir = self._dir("input_remapping_directory", self.config_dir / "remaps")
        self.save_dir = self._dir("savefile_directory", None)
        self._info = {}

    def _dir(self, key: str, fallback):
        found = _expand(self.cfg.get(key, ""), self.home, self.base)
        return found if found is not None else fallback

    @property
    def found(self) -> bool:
        return self.cfg_path is not None

    def info(self, core: str):
        if core not in self._info:
            path = self.info_dir / f"{core}_libretro.info"
            self._info[core] = read_cfg(path) if path.is_file() else None
        return self._info[core]

    def core_path(self, core: str) -> Path:
        return self.cores_dir / f"{core}_libretro.so"

    def installed(self, core: str) -> bool:
        return self.core_path(core).is_file() and self.info(core) is not None

    def installed_cores(self) -> list:
        try:
            names = sorted(os.listdir(self.cores_dir))
        except OSError:
            return []
        cores = []
        for name in names:
            if name.endswith("_libretro.so"):
                core = name[: -len("_libretro.so")]
                if self.info(core) is not None:
                    cores.append(core)
        return cores

    def core_name(self, core: str) -> str:
        info = self.info(core) or {}
        return info.get("corename") or core

    def version(self, core: str) -> str:
        version = (self.info(core) or {}).get("display_version") or ""
        return "" if version.lower() == "git" else version

    def runs_system(self, core: str, system_id: int) -> bool:
        wanted = DATABASES.get(system_id)
        if not wanted:
            return False
        listed = {name.strip() for name in ((self.info(core) or {}).get("database") or "").split("|")}
        return any(name in listed for name in wanted)

    def can_couch(self, core: str) -> bool:
        features = ((self.info(core) or {}).get("savestate_features") or "").strip()
        return features in ("", "deterministic")

    def sorts_saves_by_core(self, core: str, rom: Path) -> bool:
        value = self.cfg.get("sort_savefiles_enable", "false")
        for key, found in self.override_pairs(core, rom):
            if key == "sort_savefiles_enable":
                value = found
        return value == "true"

    def _core_dir(self, core: str) -> Path:
        return self.config_dir / self.core_name(core)

    def override_files(self, core: str, rom: Path) -> list:
        folder = self._core_dir(core)
        name = self.core_name(core)
        return [folder / f"{name}.cfg", folder / f"{rom.parent.name}.cfg", folder / f"{rom.stem}.cfg"]

    def override_pairs(self, core: str, rom: Path) -> list:
        pairs = []
        for path in self.override_files(core, rom):
            pairs.extend(read_cfg_lines(path))
        return pairs

    def overriding_key(self, core: str, rom: Path):
        for key, _value in self.override_pairs(core, rom):
            if key in SESSION_CFG_KEYS:
                return key
        return None

    def remap_sets_device(self, core: str, rom: Path) -> bool:
        folder = self.remap_dir / self.core_name(core)
        for path in (folder / f"{rom.stem}.rmp", folder / f"{rom.parent.name}.rmp",
                     folder / f"{self.core_name(core)}.rmp"):
            for key, _value in read_cfg_lines(path):
                if key.startswith("input_libretro_device_p"):
                    return True
        return False

    def effective_options(self, core: str, rom: Path) -> list:
        folder = self._core_dir(core)
        for path in (folder / f"{rom.stem}.opt", folder / f"{rom.parent.name}.opt",
                     folder / f"{self.core_name(core)}.opt"):
            if path.is_file():
                return read_cfg_lines(path)
        if self.cfg_path is not None:
            return read_cfg_lines(self.cfg_path.parent / "retroarch-core-options.cfg")
        return []

    def save_paths(self, core: str, rom: Path) -> list:
        folder = self.save_dir
        for key, value in self.override_pairs(core, rom):
            if key == "savefile_directory":
                folder = _expand(value, self.home, self.base)
        if folder is None:
            folder = rom.parent
        else:
            if self.cfg.get("sort_savefiles_by_content_enable", "false") == "true":
                folder = folder / rom.parent.name
            if self.sorts_saves_by_core(core, rom):
                folder = folder / self.core_name(core)
        return [folder / f"{rom.stem}{suffix}" for suffix in (".srm", ".rtc")]


def detect(exe, launch_options):
    tokens = []
    for field in (exe, launch_options):
        if field:
            try:
                tokens.extend(shlex.split(field, posix=True))
            except ValueError:
                tokens.extend(field.split())
    core = None
    for index, token in enumerate(tokens):
        value = None
        if token in ("-L", "--libretro") and index + 1 < len(tokens):
            value = tokens[index + 1]
        elif token.startswith("--libretro="):
            value = token.split("=", 1)[1]
        if value:
            name = PurePosixPath(value).name
            if name.endswith("_libretro.so"):
                name = name[: -len("_libretro.so")]
            elif name.endswith(".so"):
                name = name[:-3]
            if name:
                core = name
    if core:
        return {"emulator": "retroarch", "core": core}
    for token in tokens[:3]:
        name = PurePosixPath(token).name.lower()
        for emulator, names in _STANDALONE_NAMES:
            if name in names or (name.endswith(".appimage") and emulator in name):
                return {"emulator": emulator, "core": f"{emulator}-standalone"}
    return None


def core_build(path) -> str:
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            while True:
                block = handle.read(1 << 20)
                if not block:
                    break
                digest.update(block)
    except OSError:
        return ""
    return digest.hexdigest()[:16]


def gpsp_has_cable(path) -> bool:
    try:
        data = Path(path).read_bytes()
    except OSError:
        return False
    return b"mul_poke" in data


def compose_launch_options(original: str, args: str) -> str:
    original = original or ""
    if "%command%" in original:
        at = original.index("%command%") + len("%command%")
        return original[:at] + " " + args + original[at:]
    return f"{original} {args}".strip()


def quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def ip_digits(address: str) -> str:
    return "".join(f"{int(part):03d}" for part in address.split("."))


def rom_crc(path) -> str:
    path = Path(path)
    if path.suffix.lower() == ".zip":
        try:
            with zipfile.ZipFile(path) as archive:
                members = [info for info in archive.infolist() if not info.is_dir()]
                if len(members) == 1:
                    return f"{members[0].CRC:08x}"
        except (OSError, zipfile.BadZipFile):
            return ""
    crc = 0
    try:
        with open(path, "rb") as handle:
            while True:
                chunk = handle.read(1 << 20)
                if not chunk:
                    break
                crc = zlib.crc32(chunk, crc)
    except OSError:
        return ""
    return f"{crc & 0xFFFFFFFF:08x}"


def emudeck_netplay_on(home) -> bool:
    for relative in EMUDECK_SETTINGS:
        try:
            with open(Path(home) / relative, "r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    found = re.match(r"^\s*netPlay\s*=\s*['\"]?([A-Za-z]+)", line)
                    if found:
                        return found.group(1).lower() == "true"
        except OSError:
            continue
    return False


def ppsspp_cpu_flag(home) -> str:
    for relative in PPSSPP_CONFIGS:
        path = Path(home) / relative
        if not path.is_file():
            continue
        section = ""
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    stripped = line.strip()
                    if stripped.startswith("["):
                        section = stripped
                        continue
                    found = _INI_LINE.match(line)
                    if section == "[CPU]" and found and found.group(1) == "CPUCore":
                        try:
                            return _CPU_FLAGS.get(int(found.group(2)), "-j")
                        except ValueError:
                            return "-j"
        except OSError:
            pass
        break
    return "-j"


def retroarch_session(ra, *, core: str, rom: Path, mode: str, role: str, hardcore: bool, opt_path: Path,
                      guests: int, seat: int, host_ip: str, players: int, game_code: str = ""):
    cfg = [
        ("config_save_on_exit", "false"),
        ("remap_save_on_exit", "false"),
        ("cheevos_hardcore_mode_enable", "true" if hardcore else "false"),
        ("netplay_public_announce", "false"),
        ("netplay_nat_traversal", "false"),
        ("netplay_use_mitm_server", "false"),
        ("netplay_start_as_spectator", "false"),
        ("game_specific_options", "false"),
        ("global_core_options", "true"),
        ("core_options_path", str(opt_path)),
    ]
    if role == "host" and (mode == "couch" or core in NETPACKET_CORES):
        cfg.append(("netplay_max_connections", str(max(1, guests))))
    if mode == "couch":
        for number in range(1, 17):
            wanted = role == "guest" and number == seat + 1
            cfg.append((f"netplay_request_device_p{number}", "true" if wanted else "false"))
    taps = MULTITAP.get(core, {}) if mode == "couch" and role == "host" and players > 2 else {}
    for port, device in taps.get("devices", {}).items():
        cfg.append((f"input_libretro_device_p{port}", device))

    options = dict(ra.effective_options(core, rom))
    if mode == "link" and core == GAMBATTE:
        options["gambatte_gb_link_mode"] = "Network Server" if role == "host" else "Network Client"
        options["gambatte_gb_link_network_port"] = "56400"
        for index, digit in enumerate(ip_digits(host_ip) if role == "guest" else "0" * 12, start=1):
            options[f"gambatte_gb_link_network_server_ip_{index}"] = digit
    if mode == "link" and core == PPSSPP_CORE:
        options["ppsspp_enable_wlan"] = "enabled"
        options["ppsspp_enable_builtin_pro_ad_hoc_server"] = "enabled" if role == "host" else "disabled"
        options["ppsspp_change_pro_ad_hoc_server_address"] = "IP address"
        for index, digit in enumerate(ip_digits(host_ip), start=1):
            options[f"ppsspp_pro_ad_hoc_server_address{index:02d}"] = digit
        options["ppsspp_port_offset"] = "10000"
    if mode == "link" and core == GPSP and game_code[:3] in GEN3_POKEMON_CODES:
        options["gpsp_serial"] = "mul_poke"
    options.update(taps.get("options", {}))
    return write_cfg(cfg), write_cfg(options.items())


def retroarch_args(*, mode: str, role: str, host_ip: str, nick: str, cfg_path: Path, core_path, core: str) -> str:
    parts = []
    if core_path is not None:
        parts += ["-L", quote(str(core_path))]
    netplay = mode == "couch" or core in NETPACKET_CORES
    if netplay and role == "host":
        parts += ["--host", "--port", "55435", "--nick", quote(nick)]
    elif netplay:
        parts += ["--connect", host_ip, "--port", "55435", "--nick", quote(nick)]
    parts += ["--appendconfig", quote(str(cfg_path))]
    return " ".join(parts)


def ppsspp_session(*, role: str, host_ip: str, nick: str, hardcore: bool) -> str:
    return (
        "[Network]\n"
        "EnableWlan = True\n"
        f"EnableAdhocServer = {'True' if role == 'host' else 'False'}\n"
        f"proAdhocServer = {host_ip}\n"
        "PortOffset = 10000\n"
        "AdhocServerRelayMode = 2\n"
        "[SystemParam]\n"
        f"NickName = {nick}\n"
        "[Achievements]\n"
        f"AchievementsChallengeMode = {'True' if hardcore else 'False'}\n"
    )


def ppsspp_args(*, home, ini_path: Path) -> str:
    return f"{ppsspp_cpu_flag(home)} {quote('--appendconfig=' + str(ini_path))}"
