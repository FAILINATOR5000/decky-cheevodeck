"""Reference hashes for one system, read out of the bundled catalogue index.

The data comes from libretro-database (CC BY-SA 4.0), which mirrors the No-Intro,
Redump and TOSEC catalogues. What ships is a compacted form of it: a game name,
a rom name where it differs, and one [size, crc] pair per rom. The pinned upstream
commit and the per-file checksums live in `defaults/dats/PROVENANCE.md`.

Deliberately plain: stdlib only, no decky import, no settings and no logging, so
it can be driven from a terminal against a real index the way `chd_reader` can.
Everything it can be handed is a file somebody else wrote, so nothing in here
raises past `load` — a truncated download, JSON that turns out to be a
dictionary, a CRC that is not hex, all of it degrades to "no reference data for
this system", which the service turns into Can't Verify.
"""

from pathlib import Path

import gzip
import json
import re


_APOSTROPHES = re.compile("['\u2018\u2019\u02bc]")
_PUNCTUATION = re.compile(r"[^a-z0-9]+")

_PART_TAG = re.compile(
    r"\s*\((?:side|disk|disc|tape|part)\s*[0-9a-z]+\)", re.IGNORECASE
)

_TRACK_TAG = re.compile(r"\(track\s*\d+\)\s*$", re.IGNORECASE)

_CRC_RE = re.compile(r"^[0-9a-f]{8}$")


def norm_full(name) -> str:
    """A name flattened for comparison, with its region and revision tags intact.

    Keeping the tags is the point. Stripping them looks tidier and is wrong: it
    lets a fan translation match an unrelated revision of the same game that
    happens to be the same size, and an early pass that did exactly that produced
    391 false suspects against 18 real ones.
    """
    text = _APOSTROPHES.sub("", str(name or "").lower())
    text = _PART_TAG.sub("", text)
    return _PUNCTUATION.sub(" ", text).strip()


def file_stem(name) -> str:
    """A filename with its extension off, for comparing against a catalogue name.

    A second suffix comes off when it names a *format* rather than part of the
    title: "Panzer Dragoon Orta (USA).xiso.iso" is that release and not a
    different one, and leaving the marker on means it matches nothing.
    """
    head, dot, tail = str(name or "").rpartition(".")
    if not (dot and 1 <= len(tail) <= 5 and tail.isalnum()):
        return str(name or "")
    return head[:-5] if head.lower().endswith(".xiso") else head


class Entry:
    """One catalogue row: a release, and the hashes it is known by."""

    __slots__ = ("crc", "name", "size", "track_only")

    def __init__(self, name, size, crc, track_only):
        self.name = name
        self.size = size
        self.crc = crc
        self.track_only = track_only


class Index:
    """One system's catalogue, queryable two ways.

    By CRC, which answers "is this a known dump", and by normalised name, which
    is what rule 2 needs to spot a file claiming to be a release it does not
    hash like.
    """

    __slots__ = ("_by_crc", "_by_name", "key")

    def __init__(self, key, entries):
        self.key = key
        self._by_crc = {}
        self._by_name = {}
        for entry in entries:
            self._by_crc.setdefault(entry.crc, entry)
            self._by_name.setdefault(norm_full(entry.name), []).append(entry)

    def __len__(self) -> int:
        return len(self._by_crc)

    def by_crc(self, crc):
        """The release this CRC belongs to, or None."""
        return self._by_crc.get(str(crc or "").lower())

    def rebuilt(self, name, size):
        """The release this file is named after but is SMALLER than.

        Which is the signature of an image somebody rebuilt to save room. Every
        Redump Xbox entry is 7,825,162,240 bytes, the whole DVD, and a real
        library's copies come in at a third of that — the padding is gone. Same
        story as a trimmed cartridge, and the same consequence: it can never
        match, and saying so is far more use than "nothing has a record of this".

        Only smaller counts. A file LARGER than its catalogue entry is something
        else entirely and gets no opinion from here.
        """
        wanted = norm_full(file_stem(name))
        if not wanted or size <= 0:
            return None
        for entry in self._by_name.get(wanted, ()):
            if size < entry.size:
                return entry
        return None

    def claims(self, name, size):
        """The release a file of this name and this exact size claims to be.

        Both have to agree. Name alone catches every renamed hack in the
        library; size alone catches nothing at all. Together they mean the file
        is presenting itself as one specific dump, which is the only footing
        solid enough to call a CRC difference worth looking at.
        """
        wanted = norm_full(file_stem(name))
        if not wanted:
            return None
        for entry in self._by_name.get(wanted, ()):
            if entry.size == size:
                return entry
        return None


def _entries_from(rows) -> list:
    """Turn the decoded index into Entry objects, skipping anything malformed.

    Skipping rather than raising, one row at a time. A single bad row in a
    catalogue of eleven thousand should cost that row and nothing else.
    """
    entries = []
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 3:
            continue
        game_name, rom_stem, tracks = row[0], row[1], row[2]
        if not isinstance(game_name, str) or not isinstance(tracks, (list, tuple)):
            continue
        track_only = bool(_TRACK_TAG.search(rom_stem)) if isinstance(rom_stem, str) else False
        for track in tracks[:1]:
            if not isinstance(track, (list, tuple)) or len(track) < 2:
                continue
            size, crc = track[0], track[1]
            if not isinstance(size, int) or size <= 0:
                continue
            if not isinstance(crc, str) or not _CRC_RE.match(crc.lower()):
                continue
            entries.append(Entry(game_name, size, crc.lower(), track_only))
            if isinstance(rom_stem, str) and rom_stem and rom_stem != game_name:
                entries.append(Entry(rom_stem, size, crc.lower(), track_only))
    return entries


def _read(path: Path):
    try:
        with gzip.open(path, "rb") as handle:
            rows = json.loads(handle.read().decode("utf-8"))
    except Exception:
        return None
    return rows if isinstance(rows, list) else None


def load(key, *, bundled_dir: Path, data_dir=None):
    """One system's index, or None if there is no usable catalogue for it.

    The refreshed copy in the data directory wins when it reads cleanly, and the
    bundled one is the fallback for **any** failure — bad gzip, a truncated
    write, JSON that decodes to something that is not a list. That is why
    "Update Dump Lists" needs no button to undo it: a download that went
    wrong self-heals on the next scan rather than leaving the plugin with no
    reference data at all.
    """
    if not key:
        return None

    name = f"{key}.json.gz"
    rows = None
    if data_dir is not None:
        rows = _read(Path(data_dir) / name)
    if rows is None:
        rows = _read(Path(bundled_dir) / name)
    if rows is None:
        return None

    entries = _entries_from(rows)
    return Index(key, entries) if entries else None
