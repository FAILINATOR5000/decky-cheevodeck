import os
import re
import shlex
import struct
from pathlib import Path, PurePosixPath

import multiplayer_session as session


RETROARCH = "retroarch"

CATALOG = (
    {"kind": RETROARCH, "name": "RetroArch", "flatpak": session.RETROARCH_FLATPAK, "repo": "", "tag": "",
     "asset": "", "fileName": "", "systems": (), "achievements": True, "via": "flatpak"},
    {"kind": "dolphin", "name": "Dolphin", "flatpak": session.DOLPHIN_FLATPAK,
     "repo": "pkgforge-dev/Dolphin-emu-AppImage", "tag": "", "asset": "Dolphin_Emulator-*-anylinux-x86_64.AppImage",
     "fileName": "Dolphin_Emulator.AppImage", "systems": (16, 19), "achievements": True, "via": "flatpak"},
    {"kind": "pcsx2", "name": "PCSX2", "flatpak": "net.pcsx2.PCSX2", "repo": "PCSX2/pcsx2", "tag": "",
     "asset": "pcsx2-v*-linux-appimage-x64-Qt.AppImage", "fileName": "pcsx2-Qt.AppImage", "systems": (21,),
     "achievements": True, "via": "appimage"},
    {"kind": "duckstation", "name": "DuckStation", "flatpak": "org.duckstation.DuckStation",
     "repo": "stenzek/duckstation", "tag": "latest", "asset": "DuckStation-x64.AppImage",
     "fileName": "DuckStation.AppImage", "systems": (12,), "achievements": True, "via": "appimage"},
    {"kind": "ppsspp", "name": "PPSSPP", "flatpak": session.PPSSPP_FLATPAK, "repo": "hrydgard/ppsspp", "tag": "",
     "asset": "PPSSPP-v*-anylinux-x86_64.AppImage", "fileName": "PPSSPP.AppImage", "systems": (41,),
     "achievements": True, "via": "flatpak"},
    {"kind": "rmg", "name": "RMG", "flatpak": session.RMG_FLATPAK, "repo": "Rosalie241/RMG", "tag": "",
     "asset": "RMG-Portable-Linux64-v*.AppImage", "fileName": "RMG.AppImage", "systems": (2,),
     "achievements": False, "via": "flatpak"},
    {"kind": "melonds", "name": "melonDS", "flatpak": "net.kuribo64.melonDS", "repo": "melonDS-emu/melonDS",
     "tag": "", "asset": "melonDS-*-appimage-x86_64.zip", "fileName": "melonDS.AppImage", "systems": (18, 78),
     "achievements": False, "via": "flatpak"},
)
BY_KIND = {row["kind"]: row for row in CATALOG}
STANDALONES = tuple(row["kind"] for row in CATALOG if row["kind"] != RETROARCH)

SYSTEM_DATABASES = {
    **session.DATABASES,
    16: ("Nintendo - GameCube",),
    19: ("Nintendo - Wii",),
    21: ("Sony - PlayStation 2",),
}
RECOMMENDED_CORES = {
    **{system: core for system, core in session.LINK_CORES.items() if not core.endswith("-standalone")},
    **session.COUCH_CORES,
    78: session.MELONDS_DS,
    16: "dolphin",
    19: "dolphin",
    21: "pcsx2",
}

KNOWN_REPOS = {
    "pkgforge-dev/dolphin-emu-appimage": "dolphin",
    "pkgforge-dev/melonds-appimage-enhanced": "melonds",
}

_NAMES = (
    ("dolphin", re.compile(r"dolphin", re.I)),
    ("pcsx2", re.compile(r"pcsx2", re.I)),
    ("duckstation", re.compile(r"duckstation", re.I)),
    ("ppsspp", re.compile(r"ppsspp", re.I)),
    ("rmg", re.compile(r"(^|[^a-z])rmg([^a-z]|$)|rosalie|mupen", re.I)),
    ("melonds", re.compile(r"melon[ _-]?ds", re.I)),
)
_NOT_THESE = re.compile(r"primehack", re.I)
_SKIPPED = re.compile(r"\.bak|\.old$|\.zsync$", re.I)
_ASSIGN = re.compile(r"^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(\S.*)$", re.M)
_IMAGE = re.compile(r"[^\s\"'()|;&<>=]*\.appimage\b", re.I)
_SECTION = re.compile(r"^launch_([a-z0-9]+)\(\)\s*\{(.*?)^\}", re.S | re.M)
_VARIABLE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)")
_FILE_VERSION = re.compile(r"(?<![a-z0-9])v?(\d+(?:\.\d+)+)", re.I)

SCRIPT_MAX = 512 * 1024
SEARCH_FOLDERS = ("Applications", ".local/bin", "bin", "AppImages")


def kind_by_name(name: str) -> str:
    if _NOT_THESE.search(name):
        return ""
    for kind, pattern in _NAMES:
        if pattern.search(name):
            return kind
    return ""


def is_candidate(name: str) -> bool:
    return name.lower().endswith(".appimage") and not _SKIPPED.search(name[: -len(".appimage")])


def version_from_name(name: str) -> str:
    found = _FILE_VERSION.search(name)
    return found.group(1) if found else ""


def update_info(path) -> str:
    try:
        with open(path, "rb") as handle:
            head = handle.read(64)
            if len(head) < 64 or head[:4] != b"\x7fELF" or head[4] != 2 or head[5] != 1:
                return ""
            table_at, = struct.unpack_from("<Q", head, 0x28)
            size, count, names_index = struct.unpack_from("<HHH", head, 0x3A)
            if size < 64 or not 0 < count <= 512 or names_index >= count:
                return ""
            handle.seek(table_at)
            table = handle.read(size * count)
            if len(table) < size * count:
                return ""

            def section(index):
                name, _kind, _flags, _addr, offset, length = struct.unpack_from("<IIQQQQ", table, index * size)
                return name, offset, length

            _name, offset, length = section(names_index)
            if length > 65536:
                return ""
            handle.seek(offset)
            names = handle.read(length)
            for index in range(count):
                name, offset, length = section(index)
                if names[name:names.find(b"\0", name)] != b".upd_info":
                    continue
                if length > 4096:
                    return ""
                handle.seek(offset)
                return handle.read(length).split(b"\0", 1)[0].decode("utf-8", "replace").strip()
    except (OSError, struct.error):
        return ""
    return ""


def update_source(info: str) -> dict:
    parts = info.split("|")
    if len(parts) < 5 or parts[0] != "gh-releases-zsync" or not parts[1] or not parts[2]:
        return {}
    asset = parts[4][: -len(".zsync")] if parts[4].endswith(".zsync") else parts[4]
    return {"repo": f"{parts[1]}/{parts[2]}", "tag": parts[3] if parts[3] != "latest" else "", "asset": asset}


def kind_by_repo(repo: str) -> str:
    known = KNOWN_REPOS.get(repo.lower())
    if known:
        return known
    return kind_by_name(repo.split("/", 1)[-1])


def under_desktop(path, home) -> bool:
    desktop = os.path.join(str(home), "Desktop")
    for form in (os.path.abspath(str(path)), os.path.realpath(str(path))):
        if form == desktop or form.startswith(desktop + "/"):
            return True
    return False


def _expand(text: str, values: dict) -> str:
    return _VARIABLE.sub(lambda found: values.get(found.group(1) or found.group(2), found.group(0)), text)


def _absolute(token: str, values: dict, home: Path):
    path = _expand(token, values)
    if path.startswith("~"):
        path = str(home) + path[1:]
    return path if path.startswith("/") and "$" not in path else None


def script_images(path, home, kind: str = "") -> list:
    home = Path(home)
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read(SCRIPT_MAX)
    except OSError:
        return []
    values = {"HOME": str(home)}
    for name, raw in _ASSIGN.findall(text):
        value = raw.strip().replace('"', "").replace("'", "")
        if name in values or "$(" in value or "`" in value or " " in value:
            continue
        values[name] = _expand(value, values)
    sections = _SECTION.findall(text)
    if not sections:
        sections = [(kind, text)]
    found = []
    for section_kind, body in sections:
        for token in _IMAGE.findall(body):
            image = _absolute(token, values, home)
            if image is None:
                continue
            image_kind = section_kind if section_kind in STANDALONES else kind_by_name(PurePosixPath(image).name)
            if image_kind:
                found.append((image_kind, image))
    return found


def command_images(exe, launch_options, home) -> list:
    home = Path(home)
    tokens = []
    for field in (exe, launch_options):
        if field:
            try:
                tokens.extend(shlex.split(field, posix=True))
            except ValueError:
                tokens.extend(field.split())
    kind = session.emulator_kind(exe, launch_options)
    found = []
    for token in tokens[:3]:
        if token.lower().endswith(".appimage"):
            image = _absolute(token, {"HOME": str(home)}, home)
            if image is not None and kind in STANDALONES:
                found.append((kind, image))
    for token in tokens[:2]:
        if token.endswith(".sh"):
            script = _absolute(token, {"HOME": str(home)}, home)
            if script is not None:
                found.extend(script_images(script, home, kind if kind in STANDALONES else ""))
    return found


def emudeck_paths(home) -> dict:
    home = Path(home)
    paths = {"emulationPath": home / "Emulation", "toolsPath": home / "Emulation" / "tools"}
    for relative in session.EMUDECK_SETTINGS:
        try:
            text = (home / relative).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for key in paths:
            found = re.search(rf"^{key}=(.+)$", text, re.M)
            if found:
                value = _absolute(found.group(1).strip().replace('"', "").replace("'", ""), {"HOME": str(home)}, home)
                if value is not None:
                    paths[key] = Path(value)
        break
    return paths


def core_databases(info) -> set:
    return {name.strip() for name in ((info or {}).get("database") or "").split("|") if name.strip()}


def runs_system(databases: set, system_id: int) -> bool:
    return any(name in databases for name in SYSTEM_DATABASES.get(system_id, ()))


_INFO_LINE = re.compile(r'^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$')
PACK_MEMBER = re.compile(r"^RetroArch-Linux-x86_64/RetroArch-Linux-x86_64\.AppImage\.home/\.config/retroarch/cores/"
                         r"([A-Za-z0-9_+.-]+)_libretro\.so$")


def parse_info(text: str) -> dict:
    info = {}
    for line in text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        found = _INFO_LINE.match(line)
        if found:
            info[found.group(1)] = found.group(2)
    return info


def pack_listing(text: str) -> dict:
    cores = {}
    for block in text.split("\n\n"):
        fields = {}
        for line in block.splitlines():
            key, sep, value = line.partition(" = ")
            if sep:
                fields[key.strip()] = value.strip()
        found = PACK_MEMBER.match(fields.get("Path", ""))
        crc = fields.get("CRC", "").lower()
        if found and re.fullmatch(r"[0-9a-f]{8}", crc) and fields.get("Size", "").isdigit():
            cores[found.group(1)] = {"crc": crc, "size": int(fields["Size"])}
    return cores


def seven_zip_number(data: bytes, index: int):
    first = data[index]
    index += 1
    mask = 0x80
    value = 0
    for shift in range(8):
        if first & mask == 0:
            return value | ((first & (mask - 1)) << (8 * shift)), index
        value |= data[index] << (8 * shift)
        index += 1
        mask >>= 1
    return value, index


def stable_versions(listing: str) -> list:
    found = set()
    for raw in re.findall(r'href="/stable/(\d+(?:\.\d+)+)/"', listing):
        found.add(tuple(int(part) for part in raw.split(".")))
    return [".".join(str(part) for part in version) for version in sorted(found)]


_PRERELEASE = re.compile(r"(?i)nightly|dev|alpha|beta|rc\d*$|preview")
_REPO = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
_VERSION_TOKEN = re.compile(r"\d+|[a-z]+")


def version_key(version: str):
    tokens = _VERSION_TOKEN.findall((version or "").lower().lstrip("v"))
    if not any(token.isdigit() for token in tokens):
        return None
    return tuple((0, int(token), "") if token.isdigit() else (1, 0, token) for token in tokens)


def tag_version(tag: str) -> str:
    return tag.split("@", 1)[0].lstrip("vV")


def stable_tag(tag: str) -> bool:
    return bool(tag) and not _PRERELEASE.search(tag)


def valid_repo(repo: str) -> bool:
    return bool(_REPO.match(repo or "")) and ".." not in repo


def flatpak_size(text: str) -> int:
    found = re.match(r"^\s*([\d.]+)\s*([kKMG]?B)", text or "")
    if found is None:
        return 0
    scale = {"B": 1, "kB": 1000, "KB": 1000, "MB": 1000 ** 2, "GB": 1000 ** 3}.get(found.group(2), 1)
    return int(float(found.group(1)) * scale)


def script_runs_flatpak(path, kind: str, flatpak_id: str) -> bool:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read(SCRIPT_MAX)
    except OSError:
        return False
    sections = dict(_SECTION.findall(text))
    body = sections.get(kind, "") if sections else text
    return re.search(rf"flatpak\s+run\s+(?:--\S+\s+)*{re.escape(flatpak_id)}\b", body, re.I) is not None


def shortcut_install(kind: str, exe: str, launch_options: str, home):
    flatpak_id = BY_KIND[kind]["flatpak"]
    tokens = []
    for field in (exe, launch_options):
        if field:
            try:
                tokens.extend(shlex.split(field, posix=True))
            except ValueError:
                tokens.extend(field.split())
    if any(token.lower() == flatpak_id.lower() for token in tokens):
        return "flatpak", ""
    for found_kind, image in command_images(exe, launch_options, home):
        if found_kind == kind:
            return "appimage", image
    for token in tokens[:2]:
        if token.endswith(".sh"):
            script = _absolute(token, {"HOME": str(home)}, Path(home))
            if script is not None and script_runs_flatpak(script, kind, flatpak_id):
                return "flatpak", ""
    return "", ""
