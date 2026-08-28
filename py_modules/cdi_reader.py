"""
Just enough of the DiscJuggler container to lay a .cdi back out as cue+bin.

RAHasher reads a .cdi only when its tracks are already sitting on disk as a cue
and its bins; handed the bare container it stops at "Could not open track". The
tracks are all in there uncompressed and in order, with a descriptor at the end
of the file saying where each one starts and how big its sectors are, so the job
is reading that table and copying the tracks back out under names a cue sheet can
point at. cdirip does exactly this, but it is another binary to bundle and
another licence to carry for what amounts to a table walk.

Nothing plugin-shaped in here on purpose: no decky import, no settings, no
logging. That keeps it drivable straight from a terminal harness, same as
chd_reader.

Deliberately partial. Nothing is decoded or rebuilt — sectors come back exactly
as DiscJuggler stored them, at whatever size the descriptor declares, which is
what lets this skip the sync headers and ECC a real image builder would have to
synthesise. A container whose track table doesn't account for the file is refused
outright rather than trimmed to fit: a layout that is wrong by one sector still
hands RAHasher a confident wrong answer, so there is no safe way to publish a
guess.
"""

from pathlib import Path

import struct


CDI_V2 = 0x80000004
CDI_V3 = 0x80000005
CDI_V35 = 0x80000006

TRACK_START_MARK = bytes((0, 0, 0x01, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF))

SECTOR_SIZES = {0: 2048, 1: 2336, 2: 2352}

TRACK_MODES = {0: "AUDIO", 1: "MODE1", 2: "MODE2"}

SILENCE_SEARCH_SECTORS = 150

MAX_SESSIONS = 32
MAX_TRACKS = 200

_COPY_CHUNK = 1 << 20


class CdiError(Exception):
    """This file isn't a .cdi we can lay out. Never a reason to fail a scan —
    the caller falls back to whatever it would have reported without us."""


class _Walk:
    """A cursor over the descriptor, so the field walk reads in the order the
    format is documented in rather than as a pile of struct offsets."""

    def __init__(self, data):
        self._data = data
        self.pos = 0

    def u16(self) -> int:
        return self._read("<H", 2)

    def u32(self) -> int:
        return self._read("<I", 4)

    def byte(self) -> int:
        return self._read("<B", 1)

    def _read(self, fmt: str, width: int) -> int:
        if self.pos + width > len(self._data):
            raise CdiError("descriptor ended mid-field")
        value = struct.unpack_from(fmt, self._data, self.pos)[0]
        self.pos += width
        return value

    def skip(self, count: int) -> None:
        self.pos += count

    def take(self, count: int) -> bytes:
        if self.pos + count > len(self._data):
            raise CdiError("descriptor ended mid-field")
        chunk = self._data[self.pos:self.pos + count]
        self.pos += count
        return chunk


class CdiFile:
    """One .cdi, opened for copying tracks out. Use as a context manager."""

    def __init__(self, path: Path):
        self._path = Path(path)
        self._file = open(self._path, "rb")
        try:
            self._read_descriptor()
        except Exception:
            self._file.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self) -> None:
        try:
            self._file.close()
        except OSError:
            pass

    def _read_descriptor(self) -> None:
        self.size = self._path.stat().st_size
        if self.size < 8:
            raise CdiError("too short to be a .cdi")

        self._file.seek(self.size - 8)
        version, header_offset = struct.unpack("<II", self._file.read(8))
        if version not in (CDI_V2, CDI_V3, CDI_V35):
            raise CdiError(f"descriptor version 0x{version:08x} is not supported")
        if not header_offset or header_offset > self.size:
            raise CdiError("descriptor offset points outside the file")

        self.version = version
        self.data_bytes = self.size - header_offset if version == CDI_V35 else header_offset
        self._file.seek(self.data_bytes)
        walk = _Walk(self._file.read(self.size - self.data_bytes))

        sessions = walk.u16()
        if not sessions or sessions > MAX_SESSIONS:
            raise CdiError(f"{sessions} sessions is not a disc")

        tracks = []
        offset = 0
        for session in range(1, sessions + 1):
            count = walk.u16()
            if count > MAX_TRACKS:
                raise CdiError(f"{count} tracks is not a session")
            for _ in range(count):
                track = self._read_track(walk)
                track["session"] = session
                track["number"] = len(tracks) + 1
                track["offset"] = offset
                offset += track["total_length"] * track["sector_size"]
                tracks.append(track)
            walk.skip(12 if self.version == CDI_V2 else 13)

        if offset != self.data_bytes:
            raise CdiError(f"track table covers {offset} of {self.data_bytes} bytes")
        if not tracks:
            raise CdiError("no tracks")
        self._tracks = tracks

    def _read_track(self, walk: _Walk) -> dict:
        """One track record, walked in the order DiscJuggler wrote it.

        The skips are the format: most of a track record is fields nothing here
        needs, and naming them would be inventing detail this has no way to
        check. The two that are read and thrown away are read because what they
        contain decides how much comes next.
        """
        if walk.u32() != 0:
            walk.skip(8)

        if walk.take(10) != TRACK_START_MARK or walk.take(10) != TRACK_START_MARK:
            raise CdiError("lost the track start mark")

        walk.skip(4)
        walk.skip(walk.byte())

        walk.skip(19)
        if walk.u32() == 0x80000000:
            walk.skip(8)
        walk.skip(2)
        pregap = walk.u32()
        length = walk.u32()
        walk.skip(6)
        mode = walk.u32()
        walk.skip(12)
        start_lba = walk.u32()
        total_length = walk.u32()
        walk.skip(16)
        sector_size = walk.u32()

        if mode not in TRACK_MODES:
            raise CdiError(f"track mode {mode}")
        if sector_size not in SECTOR_SIZES:
            raise CdiError(f"sector size {sector_size}")
        if total_length != pregap + length:
            raise CdiError(f"track of {total_length} isn't {pregap} + {length}")

        walk.skip(29)
        if self.version != CDI_V2:
            walk.skip(5)
            if walk.u32() == 0xFFFFFFFF:
                walk.skip(78)

        return {
            "pregap": pregap,
            "length": length,
            "mode": mode,
            "start_lba": start_lba,
            "total_length": total_length,
            "sector_size": SECTOR_SIZES[sector_size],
        }

    def tracks(self) -> list:
        """Every track, in disc order, numbered across sessions the way a cue
        sheet numbers them."""
        return list(self._tracks)

    def content_start(self, track: dict) -> int:
        """Which sector of this track actually holds something.

        Normally the declared pregap, and that is where the search starts —
        a gap is only ever understated, so this never moves a track's content
        earlier than the descriptor says. But one Jaguar CD disc measured here
        declares 150 silent sectors and carries 151, which is enough to make a
        hasher read a sector of nothing and decide the disc isn't the console it
        plainly is. The same shape of lie as the CHD pregap bug, from a different
        container.

        Only worth asking about a track something is going to be read out of.
        Leading silence in an audio track is the recording, not a bad gap, and
        the first track of these discs routinely has tens of empty sectors.
        """
        for sector in range(track["pregap"], min(
            track["pregap"] + SILENCE_SEARCH_SECTORS, track["total_length"]
        )):
            self._file.seek(track["offset"] + sector * track["sector_size"])
            if any(self._file.read(track["sector_size"])):
                return sector
        return track["pregap"]

    def gap_after(self, track: dict) -> int:
        """How many sectors this track occupies on the disc before the next one
        begins, or 0 for the last track.

        Not the same as its length. Sessions are separated by a lead-out and a
        lead-in that hold no data and are in no container, so a disc whose second
        session starts at sector 24153 has a hole in the middle of it that the
        addresses inside the tracks are still counted through.
        """
        index = self._tracks.index(track)
        if index + 1 >= len(self._tracks):
            return 0
        return self._tracks[index + 1]["start_lba"] - track["start_lba"]

    def emit_size(self) -> int:
        """Scratch a full lay-out will take, which is more than the image.

        The gaps get written as silence, because a cue sheet has no way to say
        "and then nothing for eleven thousand sectors" — position in a cue is
        the sum of what came before it.
        """
        total = 0
        for track in self._tracks:
            sectors = max(track["length"], self.gap_after(track))
            total += sectors * track["sector_size"]
        return total

    def copy_track(self, track: dict, out, skip_sectors: int = 0, cancel=None) -> int:
        """Copy one track's sectors into an open file, returning how many.

        Copied rather than decoded because there is nothing to decode: what's in
        the container is what a cue sheet expects to point at.
        """
        sectors = track["total_length"] - skip_sectors
        if sectors <= 0:
            return 0
        remaining = sectors * track["sector_size"]
        self._file.seek(track["offset"] + skip_sectors * track["sector_size"])
        while remaining > 0:
            if cancel is not None and cancel.is_set():
                return 0
            chunk = self._file.read(min(_COPY_CHUNK, remaining))
            if not chunk:
                raise CdiError(f"track {track['number']} ran short")
            out.write(chunk)
            remaining -= len(chunk)
        return sectors
