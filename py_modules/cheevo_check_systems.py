"""
Which console a ROM belongs to, and what RetroAchievements calls it.

The ID and key columns come from RAHasher's own ``--help`` output (1.8.3, captured
alongside the recipe) — that's the upstream authority on which hash algorithm goes
with which number, and it prints roughly seventy systems. The folder aliases and
extension lists are ours, and that's deliberate: the aliases that matter on a Deck
are EmuDeck's directory names, which no upstream list knows about. ES-DE uses the
same names, so they're a de facto standard rather than one launcher's habit —
which is why folder detection is trusted ahead of the extension.

Not every system RAHasher prints is here. This is the set worth answering
confidently for; anything missing simply doesn't get scanned, which is a far
better failure than a wrong verdict. What stays out is the consoles RAHasher
lists with a blank group, which its own help text says RA does not support yet.

Arcade used to be out too, and it's worth saying why it isn't any more. RA
identifies an arcade game by its *filename* with the extension taken off —
md5("progolf") and nothing else — so an arcade zip is the one file in a library
whose contents have no bearing on which game it is. That's the opposite of every
other row here, which is what ra_hash="name" says, and it's why the zip
introspection that saves Wrecking Crew '98 would tear a MAME set apart looking
for a ROM that was never in there. Arcade gets its own path through the scanner
instead, and its container is opened only to prove that it opens.
"""


class System:
    """One console: how to hash it, what to call it, where its ROMs live."""

    __slots__ = (
        "console_id", "dat_files", "dat_key", "extensions", "folders", "hasher_key",
        "name", "needs_dolphin", "ra_hash", "self_check",
    )

    def __init__(self, console_id, hasher_key, name, *, folders, extensions,
                 needs_dolphin=False, dat_key=None, dat_files=(), ra_hash="partial",
                 self_check=None):
        self.console_id = console_id
        self.hasher_key = hasher_key
        self.name = name
        self.folders = folders
        self.extensions = extensions
        self.needs_dolphin = needs_dolphin
        self.dat_key = dat_key
        self.dat_files = dat_files
        self.ra_hash = ra_hash
        self.self_check = self_check


RAW_DISC_EXTENSIONS = (".iso", ".gcm")

SYSTEMS = (
    System(7, "NES", "NES/Famicom",
           folders=("nes", "famicom", "fc", "nintendoentertainmentsystem"),
           extensions=(".nes", ".unf", ".unif"),
           dat_key="nes",
           dat_files=(
               ("no-intro", "Nintendo - Nintendo Entertainment System.dat"),
               ("tosec", "Nintendo - Nintendo Entertainment System.dat"),
           ),
           ra_hash="ines_header",
    ),
    System(81, "FDS", "Famicom Disk System",
           folders=("fds", "famicomdisksystem"),
           extensions=(".fds",),
           dat_key="fds",
           dat_files=(("no-intro", "Nintendo - Family Computer Disk System.dat"),),
           ra_hash="ines_header",
    ),
    System(3, "SNES", "SNES/Super Famicom",
           folders=("snes", "sfc", "superfamicom", "supernintendo",
                    "supernintendoentertainmentsystem", "supernes", "snesmsu1"),
           extensions=(".sfc", ".smc", ".swc", ".fig"),
           dat_key="snes",
           dat_files=(
               ("no-intro", "Nintendo - Super Nintendo Entertainment System.dat"),
               ("tosec", "Nintendo - Super Nintendo Entertainment System.dat"),
           ),
           ra_hash="copier_header",
    ),
    System(2, "N64", "Nintendo 64",
           folders=("n64", "nintendo64"),
           extensions=(".n64", ".z64", ".v64", ".ndd"),
           dat_key="n64",
           dat_files=(("no-intro", "Nintendo - Nintendo 64.dat"),),
           ra_hash="full",
    ),
    System(16, "GC", "GameCube",
           folders=("gc", "gamecube", "ngc", "dolphin"),
           extensions=(".iso", ".gcm", ".rvz", ".gcz", ".ciso", ".wia", ".nkit"),
           needs_dolphin=True,
           dat_key="gamecube",
           dat_files=(("redump", "Nintendo - GameCube.dat"),),
    ),
    System(19, "Wii", "Wii",
           folders=("wii", "wiiware"),
           extensions=(".iso", ".wbfs", ".rvz", ".gcz", ".ciso", ".wia", ".nkit", ".wad"),
           needs_dolphin=True,
           dat_key="wii",
           dat_files=(("redump", "Nintendo - Wii.dat"),),
    ),
    System(4, "GB", "Game Boy",
           folders=("gb", "gameboy"),
           extensions=(".gb",),
           dat_key="gb",
           dat_files=(
               ("no-intro", "Nintendo - Game Boy.dat"),
               ("tosec", "Nintendo - Game Boy.dat"),
           ),
           ra_hash="full",
    ),
    System(6, "GBC", "Game Boy Color",
           folders=("gbc", "gameboycolor", "gameboycolour"),
           extensions=(".gbc",),
           dat_key="gbc",
           dat_files=(
               ("no-intro", "Nintendo - Game Boy Color.dat"),
               ("tosec", "Nintendo - Game Boy Color.dat"),
           ),
           ra_hash="full",
    ),
    System(5, "GBA", "Game Boy Advance",
           folders=("gba", "gameboyadvance"),
           extensions=(".gba",),
           dat_key="gba",
           dat_files=(
               ("no-intro", "Nintendo - Game Boy Advance.dat"),
               ("tosec", "Nintendo - Game Boy Advance.dat"),
           ),
           ra_hash="full",
    ),
    System(18, "DS", "Nintendo DS",
           folders=("nds", "ds", "nintendods"),
           extensions=(".nds", ".srl"),
           dat_key="nds",
           dat_files=(("no-intro", "Nintendo - Nintendo DS.dat"),),
    ),
    System(78, "DSi", "Nintendo DSi",
           folders=("dsi", "nintendodsi"),
           extensions=(".dsi",),
           dat_key="dsi",
           dat_files=(("no-intro", "Nintendo - Nintendo DSi.dat"),),
    ),
    System(24, "MINI", "Pokemon Mini",
           folders=("pokemini", "pokemonmini"),
           extensions=(".min",),
           dat_key="pokemini",
           dat_files=(("no-intro", "Nintendo - Pokemon Mini.dat"),),
    ),
    System(28, "VB", "Virtual Boy",
           folders=("virtualboy", "vb"),
           extensions=(".vb", ".vboy"),
           dat_key="virtualboy",
           dat_files=(("no-intro", "Nintendo - Virtual Boy.dat"),),
           ra_hash="full",
    ),
    System(60, "G&W", "Game & Watch",
           folders=("gameandwatch", "gw"),
           extensions=(".mgw",)),
    System(12, "PS1", "PlayStation",
           folders=("psx", "ps1", "playstation", "playstation1", "playstationone", "psone"),
           extensions=(".cue", ".chd", ".pbp", ".ccd", ".toc", ".iso", ".bin"),
           dat_key="psx",
           dat_files=(("redump", "Sony - PlayStation.dat"),),
    ),
    System(21, "PS2", "PlayStation 2",
           folders=("ps2", "playstation2"),
           extensions=(".iso", ".chd", ".cue", ".bin", ".cso", ".zso"),
           dat_key="ps2",
           dat_files=(("redump", "Sony - PlayStation 2.dat"),),
    ),
    System(41, "PSP", "PlayStation Portable",
           folders=("psp", "playstationportable"),
           extensions=(".iso", ".cso", ".chd", ".pbp"),
           dat_key="psp",
           dat_files=(("redump", "Sony - PlayStation Portable.dat"),),
    ),
    System(40, "DC", "Dreamcast",
           folders=("dreamcast", "dc"),
           extensions=(".gdi", ".chd", ".cdi", ".cue"),
           dat_key="dreamcast",
           dat_files=(("redump", "Sega - Dreamcast.dat"),),
    ),
    System(39, "SAT", "Saturn",
           folders=("saturn", "segasaturn", "ss"),
           extensions=(".cue", ".chd", ".ccd", ".iso", ".bin", ".mds"),
           dat_key="saturn",
           dat_files=(("redump", "Sega - Saturn.dat"),),
    ),
    System(9, "SCD", "Sega CD",
           folders=("segacd", "megacd", "scd", "mega-cd"),
           extensions=(".cue", ".chd", ".ccd", ".iso", ".bin"),
           dat_key="segacd",
           dat_files=(("redump", "Sega - Mega-CD - Sega CD.dat"),),
    ),
    System(10, "32X", "32X",
           folders=("sega32x", "32x", "mega32x", "megadrive32x", "genesis32x"),
           extensions=(".32x",),
           dat_key="sega32x",
           dat_files=(
               ("no-intro", "Sega - 32X.dat"),
               ("tosec", "Sega - 32X.dat"),
           ),
           ra_hash="full",
    ),
    System(1, "MD", "Genesis/Mega Drive",
           folders=("genesis", "megadrive", "genesismegadrive", "megadrivegenesis",
                    "md", "gen", "gendesktop"),
           extensions=(".md", ".gen", ".smd", ".bin"),
           dat_key="genesis",
           dat_files=(
               ("no-intro", "Sega - Mega Drive - Genesis.dat"),
               ("tosec", "Sega - Mega Drive - Genesis.dat"),
           ),
           ra_hash="full",
    ),
    System(11, "SMS", "Master System",
           folders=("mastersystem", "sms", "segamastersystem"),
           extensions=(".sms",),
           dat_key="mastersystem",
           dat_files=(
               ("no-intro", "Sega - Master System - Mark III.dat"),
               ("tosec", "Sega - Master System - Mark III.dat"),
           ),
           ra_hash="full",
    ),
    System(15, "GG", "Game Gear",
           folders=("gamegear", "gg"),
           extensions=(".gg",),
           dat_key="gamegear",
           dat_files=(
               ("no-intro", "Sega - Game Gear.dat"),
               ("tosec", "Sega - Game Gear.dat"),
           ),
           ra_hash="full",
    ),
    System(33, "SG1K", "SG-1000",
           folders=("sg1000", "sg-1000"),
           extensions=(".sg",),
           dat_key="sg1000",
           dat_files=(
               ("no-intro", "Sega - SG-1000.dat"),
               ("tosec", "Sega - SG-1000.dat"),
           ),
    ),
    System(8, "PCE", "PC Engine/TurboGrafx-16",
           folders=("pcengine", "pce", "tg16", "turbografx16", "supergrafx", "sgx"),
           extensions=(".pce", ".sgx"),
           dat_key="pcengine",
           dat_files=(
               ("no-intro", "NEC - PC Engine - TurboGrafx 16.dat"),
               ("no-intro", "NEC - PC Engine SuperGrafx.dat"),
           ),
           ra_hash="full",
    ),
    System(76, "PCCD", "PC Engine CD/TurboGrafx-CD",
           folders=("pcenginecd", "pcecd", "tg16cd", "turbografxcd"),
           extensions=(".cue", ".chd", ".ccd"),
           dat_key="pcenginecd",
           dat_files=(("redump", "NEC - PC Engine CD - TurboGrafx-CD.dat"),),
    ),
    System(47, "80/88", "PC-8000/8800",
           folders=("pc88", "pc8800", "pc8000", "pc-8800", "pc-8000"),
           extensions=(".d88",),
           dat_key="pc88",
           dat_files=(("tosec", "NEC - PC-88.dat"),),
           ra_hash="full",
    ),
    System(49, "PC-FX", "PC-FX",
           folders=("pcfx", "pc-fx"),
           extensions=(".cue", ".chd", ".ccd"),
           dat_key="pcfx",
           dat_files=(("redump", "NEC - PC-FX.dat"),),
    ),
    System(14, "NGP", "Neo Geo Pocket",
           folders=("ngp", "ngpc", "neogeopocket", "neogeopocketcolor"),
           extensions=(".ngp", ".ngc"),
           dat_key="neogeopocket",
           dat_files=(
               ("no-intro", "SNK - Neo Geo Pocket.dat"),
               ("no-intro", "SNK - Neo Geo Pocket Color.dat"),
           ),
           ra_hash="full",
    ),
    System(56, "NGCD", "Neo Geo CD",
           folders=("neogeocd", "ngcd"),
           extensions=(".cue", ".chd"),
           dat_key="neogeocd",
           dat_files=(("redump", "SNK - Neo Geo CD.dat"),),
    ),
    System(25, "2600", "Atari 2600",
           folders=("atari2600", "2600"),
           extensions=(".a26",),
           dat_key="atari2600",
           dat_files=(
               ("no-intro", "Atari - 2600.dat"),
               ("tosec", "Atari - 2600.dat"),
           ),
           ra_hash="full",
    ),
    System(51, "7800", "Atari 7800",
           folders=("atari7800", "7800"),
           extensions=(".a78",),
           dat_key="atari7800",
           dat_files=(
               ("no-intro", "Atari - 7800.dat"),
               ("tosec", "Atari - 7800.dat"),
               ("headered", "Atari - 7800.dat"),
           ),
           ra_hash="full",
    ),
    System(13, "Lynx", "Atari Lynx",
           folders=("atarilynx", "lynx"),
           extensions=(".lnx", ".lyx"),
           dat_key="atarilynx",
           dat_files=(
               ("no-intro", "Atari - Lynx.dat"),
               ("tosec", "Atari - Lynx.dat"),
               ("headered", "Atari - Lynx.dat"),
           ),
           ra_hash="full",
    ),
    System(17, "JAG", "Atari Jaguar",
           folders=("atarijaguar", "jaguar"),
           extensions=(".j64", ".jag"),
           dat_key="atarijaguar",
           dat_files=(
               ("no-intro", "Atari - Jaguar.dat"),
               ("tosec", "Atari - Jaguar.dat"),
           ),
           ra_hash="full",
    ),
    System(77, "JCD", "Atari Jaguar CD",
           folders=("atarijaguarcd", "jaguarcd"),
           extensions=(".cue", ".chd", ".cdi"),
           dat_key="atarijaguarcd",
           dat_files=(("redump", "Atari - Jaguar CD.dat"),),
    ),
    System(43, "3DO", "3DO Interactive Multiplayer",
           folders=("3do", "panasonic3do"),
           extensions=(".cue", ".chd", ".iso"),
           dat_key="3do",
           dat_files=(("redump", "The 3DO Company - 3DO.dat"),),
    ),
    System(44, "CV", "ColecoVision",
           folders=("coleco", "colecovision"),
           extensions=(".col",),
           dat_key="colecovision",
           dat_files=(("no-intro", "Coleco - ColecoVision.dat"),),
           ra_hash="full",
    ),
    System(45, "INTV", "Intellivision",
           folders=("intellivision", "intv"),
           extensions=(".int",),
           dat_key="intellivision",
           dat_files=(
               ("no-intro", "Mattel - Intellivision.dat"),
               ("tosec", "Mattel - Intellivision.dat"),
           ),
    ),
    System(23, "MO2", "Magnavox Odyssey 2",
           folders=("odyssey2", "videopac", "magnavoxodyssey2"),
           extensions=(".o2",),
           dat_key="odyssey2",
           dat_files=(
               ("no-intro", "Magnavox - Odyssey2.dat"),
               ("no-intro", "Philips - Videopac+.dat"),
           ),
    ),
    System(29, "MSX", "MSX",
           folders=("msx", "msx1", "msx2"),
           extensions=(".rom", ".mx1", ".mx2", ".dsk"),
           dat_key="msx",
           dat_files=(
               ("no-intro", "Microsoft - MSX.dat"),
               ("no-intro", "Microsoft - MSX2.dat"),
           ),
           ra_hash="full",
    ),
    System(46, "VECT", "Vectrex",
           folders=("vectrex",),
           extensions=(".vec",),
           dat_key="vectrex",
           dat_files=(("no-intro", "GCE - Vectrex.dat"),),
    ),
    System(53, "WS", "WonderSwan",
           folders=("wonderswan", "wonderswancolor", "ws", "wsc"),
           extensions=(".ws", ".wsc"),
           dat_key="wonderswan",
           dat_files=(
               ("no-intro", "Bandai - WonderSwan.dat"),
               ("no-intro", "Bandai - WonderSwan Color.dat"),
           ),
           ra_hash="full",
    ),
    System(57, "CHF", "Fairchild Channel F",
           folders=("channelf", "fairchildchannelf"),
           extensions=(".chf",),
           dat_key="channelf",
           dat_files=(("no-intro", "Fairchild - Channel F.dat"),),
    ),
    System(63, "WSV", "Watara Supervision",
           folders=("watarasupervision", "supervision"),
           extensions=(".sv",),
           dat_key="supervision",
           dat_files=(("no-intro", "Watara - Supervision.dat"),),
    ),
    System(80, "UZE", "Uzebox",
           folders=("uzebox",),
           extensions=(".uze",)),
    System(71, "ARD", "Arduboy",
           folders=("arduboy",),
           extensions=(".hex",),
           dat_key="arduboy",
           dat_files=(("no-intro", "Arduboy Inc - Arduboy.dat"),),
    ),
    System(72, "WASM4", "WASM-4",
           folders=("wasm4",),
           extensions=(".wasm",)),
    System(69, "DUCK", "Mega Duck",
           folders=("megaduck", "cougarboy"),
           extensions=(".bin",),
           dat_key="megaduck",
           ra_hash="full",
    ),
    System(37, "CPC", "Amstrad CPC",
           folders=("amstradcpc", "cpc"),
           extensions=(".dsk", ".cdt"),
           dat_key="amstradcpc",
           dat_files=(("tosec", "Amstrad - CPC.dat"),),
    ),
    System(38, "A2", "Apple II",
           folders=("appleii", "apple2"),
           extensions=(".dsk", ".do", ".po", ".woz", ".2mg"),
           dat_key="apple2",
           dat_files=(("tosec", "Apple - II.dat"),),
    ),
    System(73, "A2001", "Arcadia 2001",
           folders=("arcadia2001", "arcadia", "emersonarcadia2001"),
           extensions=(".bin",),
           dat_key="arcadia2001",
           dat_files=(("no-intro", "Emerson - Arcadia 2001.dat"),),
    ),
    System(74, "VC4000", "Interton VC 4000",
           folders=("vc4000", "intertonvc4000"),
           extensions=(".bin",),
           dat_key="vc4000",
           dat_files=(("no-intro", "Interton - VC 4000.dat"),),
    ),
    System(75, "ELEK", "Elektor TV Games Computer",
           folders=("elektor", "elektortvgamescomputer"),
           extensions=(".bin", ".pgm")),
    System(27, "ARC", "Arcade",
           folders=("arcade", "mame", "mameadvmame", "mamemame4all",
                    "fbneo", "fba", "neogeo",
                    "cps", "cps1", "cps2", "cps3",
                    "atomiswave", "naomi", "naomi2", "naomigd",
                    "model2", "model3"),
           extensions=(".zip", ".7z"),
           ra_hash="name",
           self_check="arcade_zip",
    ),
)

VERIFY_ONLY_SYSTEMS = (
    System(0, "3DS", "Nintendo 3DS",
           folders=("n3ds", "3ds", "nintendo3ds"),
           extensions=(".3ds", ".cci", ".cxi"),
           dat_key="n3ds",
           dat_files=(
               ("no-intro", "Nintendo - Nintendo 3DS.dat"),
               ("no-intro", "Nintendo - New Nintendo 3DS.dat"),
           )),
    System(0, "PS3", "PlayStation 3",
           folders=("ps3", "playstation3"),
           extensions=(".iso",),
           dat_key="ps3",
           dat_files=(("redump", "Sony - PlayStation 3.dat"),)),
    System(0, "XBOX", "Xbox",
           folders=("xbox", "microsoftxbox"),
           extensions=(".iso", ".xiso"),
           dat_key="xbox",
           dat_files=(("redump", "Microsoft - Xbox.dat"),)),
    System(0, "X360", "Xbox 360",
           folders=("xbox360", "microsoftxbox360"),
           extensions=(".iso", ".xiso"),
           dat_key="xbox360",
           dat_files=(("redump", "Microsoft - Xbox 360.dat"),)),
    System(0, "Switch", "Nintendo Switch",
           folders=("switch", "nintendoswitch", "nsw"),
           extensions=(".xci", ".nsp", ".xcz", ".nsz"),
           self_check="switch"),
)


def _fold(value) -> str:
    """Squash a folder name down to letters and digits.

    "Mega-CD", "mega cd" and "MEGACD" are one directory as far as anyone naming
    them is concerned, so the alias lists above only carry the squashed form.
    """
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


UNSUPPORTED_FOLDERS = frozenset(_fold(name) for name in (
    "amiga", "amigacd32", "atarist", "atari5200", "c64", "commodore64", "vic20",
    "cdimono1", "cdi", "philipscdi", "dos", "msdos", "fmtowns", "n3ds", "3ds",
    "ngage", "oric", "pc98", "pc9800", "pc6000", "segapico", "ti83", "tic80",
    "x1", "x68000", "xbox", "xbox360", "zeebo", "zx81", "zxspectrum", "wiiu",
    "ps3", "playstation3",
))

_BY_FOLDER = {}
for _system in SYSTEMS:
    for _alias in _system.folders:
        _BY_FOLDER.setdefault(_fold(_alias), _system)

ZIP_EXTENSION = ".zip"
EXTRACT_EXTENSIONS = (".7z", ".rar")

CONTAINER_EXTENSIONS = frozenset((ZIP_EXTENSION,)) | frozenset(EXTRACT_EXTENSIONS)

_BY_EXTENSION = {}
for _system in SYSTEMS:
    for _extension in _system.extensions:
        if _extension in CONTAINER_EXTENSIONS:
            continue
        _BY_EXTENSION.setdefault(_extension, []).append(_system)

_BY_CONSOLE_ID = {system.console_id: system for system in SYSTEMS}

_VERIFY_BY_FOLDER = {}
for _system in VERIFY_ONLY_SYSTEMS:
    for _alias in _system.folders:
        _VERIFY_BY_FOLDER.setdefault(_fold(_alias), _system)

DAT_SYSTEMS = tuple(
    system for system in SYSTEMS + VERIFY_ONLY_SYSTEMS if system.dat_key and system.dat_files
)

ROM_EXTENSIONS = frozenset(_BY_EXTENSION)

JUNK_EXTENSIONS = frozenset((
    ".txt", ".url", ".nfo", ".diz", ".md5", ".sfv", ".dat", ".xml", ".log", ".cfg",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".pdf", ".html", ".htm", ".sbi", ".db",
))


_RELATED_PAIRS = (
    (18, 78),
    (16, 19),
    (4, 6),
    (7, 81),
)

RELATED_CONSOLE_IDS = {}
for _left, _right in _RELATED_PAIRS:
    RELATED_CONSOLE_IDS[_left] = RELATED_CONSOLE_IDS.get(_left, ()) + (_right,)
    RELATED_CONSOLE_IDS[_right] = RELATED_CONSOLE_IDS.get(_right, ()) + (_left,)


def ra_covers_whole_file(system, inner_size=None) -> bool:
    """Whether RetroAchievements' hash vouches for every byte of this file.

    The question the two buckets actually ask. A file RA recognises on a system
    it hashes whole is a copy of something somebody registered, byte for byte,
    and there is nothing left for a catalogue to be right about. Where RA skips a
    header, that much less is vouched for — the skipped bytes are mapper flags
    and copier metadata rather than game data, but they are still bytes we cannot
    speak for, so those files get the weaker of the two answers.

    inner_size is the ROM's own size, not the archive's. Left out when nothing
    has been read yet, which only happens on systems that ship no catalogue at
    all, and none of those carry a copier header.
    """
    if system.ra_hash == "full":
        return True
    if system.ra_hash == "copier_header":
        return inner_size is None or inner_size % 1024 != 512
    return False


def hashes_the_name(system) -> bool:
    """Whether RA's hash for this system is computed from the filename alone.

    Arcade and only arcade, but asked by name rather than by console number so
    the scanner never has to carry 27 around. Every branch that skips hashing,
    skips looking inside the archive, or picks the verification path turns on
    this, and they all mean the same thing: opening this file would tell us
    nothing about which game it is.
    """
    return system.ra_hash == "name"


def is_arcade_set_folder(name) -> bool:
    """Whether a directory name is a MAME short name rather than a game's title.

    Arcade comes in two shapes. Most of it is one zip per machine, named after
    the machine. The GD-ROM boards are a directory named after the machine with
    a disc image inside it, and there RA hashes the *directory* — md5("cvs2"),
    not md5("gdl-0008").

    Telling that apart from somebody's per-game disc folder is what this is for,
    and MAME's own naming does the work: short names are lower-case, ASCII,
    alphanumeric and at most eight characters, which is the DOS-era limit MAME
    still keeps. "cvs2" and "monkeyba" pass; "Shenmue (Europe) (En,Fr,De,Es)"
    and "BrainDead 13 (USA)" fail on every count. Measured across a library of
    both: 8 hits, all of them real GD-ROM sets, and 14 misses, all of them real
    disc folders.

    A directory that names a console is not a game directory however short it
    is, which is what keeps arcade/cps2/ from reading as a machine called cps2.
    """
    text = str(name or "")
    if not (1 <= len(text) <= 8) or not text.isascii() or not text.isalnum():
        return False
    if text != text.lower():
        return False
    return by_folder_name(text) is None


def related_console_ids(console_id):
    return RELATED_CONSOLE_IDS.get(console_id, ())


def describe_systems() -> str:
    """The whole table as plain text, for the in-app guide.

    Rendered rather than written out, because a copy of fifty-odd systems and
    their folder names in a document is a second list to keep in step with this
    one, and it would be wrong within a session — `.cdi` moved consoles twice in
    the afternoon this was added.
    """
    lines = []
    for system in sorted(SYSTEMS + VERIFY_ONLY_SYSTEMS, key=lambda item: item.name.lower()):
        lines.append(system.name)
        lines.append("  Folder names:  " + ", ".join(system.folders))
        lines.append("  File types:    " + " ".join(system.extensions))
        if system.needs_dolphin:
            lines.append("  Note:          needs Dolphin installed for anything but .iso/.gcm")
        if system.console_id <= 0:
            lines.append("  Note:          Dump Check only — RetroAchievements has no sets for this")
        lines.append("")
    return "\n".join(lines).rstrip()


def describe_verification() -> str:
    """What verification can say about each system, for the in-app guide.

    Generated for the same reason describe_systems is: verification adds two
    more facts per console — whether a catalogue ships for it and how much of
    the file RA's own hash covers — and both of those move as systems get
    probed. A hand-typed copy would be stale by the end of the session that
    wrote it.
    """
    lines = []
    for system in sorted(SYSTEMS + VERIFY_ONLY_SYSTEMS, key=lambda item: item.name.lower()):
        if system.dat_key and system.dat_files:
            reference = "yes"
        elif system.dat_key:
            reference = "none bundled — a slot is left for one"
        elif system.self_check == "arcade_zip":
            reference = "not needed — the archive checks itself"
        elif system.self_check:
            reference = "not needed — the dump checks itself"
        else:
            reference = "none published"
        if system.console_id <= 0:
            covers = "no RetroAchievements sets"
        elif system.ra_hash == "full":
            covers = "the whole file"
        elif system.ra_hash == "ines_header":
            covers = "the whole file apart from its 16-byte header"
        elif system.ra_hash == "copier_header":
            covers = "the whole file, less a 512-byte copier header where there is one"
        elif system.ra_hash == "name":
            covers = "none of the file — the name alone"
        else:
            covers = "part of the file"
        lines.append(f"{system.name}")
        lines.append(f"  Dump list:              {reference}")
        lines.append(f"  RetroAchievements hash: {covers}")
        lines.append("")
    return "\n".join(lines).rstrip()


def describe_related_pairs() -> str:
    """The consoles that get checked against each other, for the guide."""
    lines = []
    for left, right in _RELATED_PAIRS:
        first, second = by_console_id(left), by_console_id(right)
        if first is not None and second is not None:
            lines.append(f"  {first.name} and {second.name}")
    return "\n".join(lines)


def describe_unsupported_folders() -> str:
    """The folder names that are skipped on sight, same reasoning as above."""
    return ", ".join(sorted(UNSUPPORTED_FOLDERS))


def by_console_id(console_id):
    return _BY_CONSOLE_ID.get(console_id)


_MAKER_PREFIXES = (
    "sega", "nintendo", "sony", "atari", "nec", "snk", "panasonic", "microsoft",
    "commodore", "philips", "coleco", "mattel", "magnavox", "bandai", "watara",
)


def _without_maker(folded: str):
    """Each way of reading ``folded`` with a maker's name taken off the front."""
    for maker in _MAKER_PREFIXES:
        if folded.startswith(maker) and len(folded) > len(maker):
            yield folded[len(maker):]


def folder_is_unsupported(name) -> bool:
    folded = _fold(name)
    if folded in UNSUPPORTED_FOLDERS:
        return True
    return any(rest in UNSUPPORTED_FOLDERS for rest in _without_maker(folded))


def by_folder_name(name):
    """The system a directory named ``name`` holds, or None."""
    folded = _fold(name)
    found = _BY_FOLDER.get(folded)
    if found is not None:
        return found
    for rest in _without_maker(folded):
        found = _BY_FOLDER.get(rest)
        if found is not None:
            return found
    return None


_CONTAINER_DUMP_MARKERS = frozenset(("PS3_GAME", "PS3_DISC.SFB"))


def is_container_dump(entry_names) -> bool:
    """Whether this directory is one game's internals.

    Takes the names already read out of it, so asking costs nothing beyond the
    scandir the walk was doing anyway.
    """
    return any(str(name).upper() in _CONTAINER_DUMP_MARKERS for name in entry_names)


def verify_only_by_folder_name(name):
    """The verify-only system a directory named ``name`` holds, or None.

    Asked before folder_is_unsupported, since both of these are in that list on
    purpose — the scan has to keep skipping them.
    """
    folded = _fold(name)
    found = _VERIFY_BY_FOLDER.get(folded)
    if found is not None:
        return found
    for rest in _without_maker(folded):
        found = _VERIFY_BY_FOLDER.get(rest)
        if found is not None:
            return found
    return None


FOLDER_ONLY_EXTENSIONS = frozenset((".wad",))


def by_extension(extension):
    """Every system a file with this suffix could belong to.

    Usually one. The overlap is all discs — a bare .chd or .cue could be any of
    eight consoles — which is why the folder name gets asked first and this is
    the fallback.
    """
    suffix = str(extension or "").lower()
    if suffix in FOLDER_ONLY_EXTENSIONS:
        return ()
    return tuple(_BY_EXTENSION.get(suffix, ()))
