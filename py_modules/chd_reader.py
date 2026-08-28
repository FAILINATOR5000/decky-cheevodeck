"""
Just enough of the CHD v5 container to read sectors out of a data track.

This exists because RAHasher mis-locates the boot sector on a handful of discs
(see cheevo_check_service._needs_pregap_recovery), and the only way to get it a
correct answer is to hand it the track as a plain cue+bin. chdman would do that,
but it is a 4.6 MB binary that links libSDL2 and would drag a third-party licence
obligation in with it — for a job that amounts to decompressing a few hunks. The
format is documented and the two codecs that matter are both in the stdlib, so it
lives here instead.

Nothing plugin-shaped in here on purpose: no decky import, no settings, no
logging. That keeps it drivable straight from a terminal harness.

Deliberately partial. FLAC hunks are refused rather than decoded, because only
audio uses FLAC and no hash reads an audio track. A data track can still tip into
a FLAC hunk where it shares one with the audio ahead of it, and the caller has to
treat that as "read as far as I could" rather than an error — the read stops, and
what came back is still usable under the rules in the recipe's §6.
"""

from pathlib import Path

import lzma
import struct
import zlib


CD_FRAME_SIZE = 2448
CD_SECTOR_DATA = 2352
USER_DATA_SIZE = 2048

(_TYPE_0, _TYPE_1, _TYPE_2, _TYPE_3, _NONE, _SELF, _PARENT,
 _RLE_SMALL, _RLE_LARGE, _SELF_0, _SELF_1,
 _PARENT_SELF, _PARENT_0, _PARENT_1) = range(14)

_USER_OFFSET = {
    "MODE1": 0,
    "MODE1_RAW": 16,
    "MODE2_FORM1": 0,
    "MODE2_FORM1_RAW": 24,
    "MODE2_RAW": 24,
}

_TRACK_PADDING = 4


class ChdError(Exception):
    """This file isn't a CHD we can read. Never a reason to fail a scan — the
    caller falls back to whatever it would have reported without us."""


class _BitReader:
    """MSB first, matching MAME's bitstream_in."""

    def __init__(self, data):
        self._data = data
        self._pos = 0
        self._bits = 0
        self._acc = 0

    def read(self, count: int) -> int:
        while self._bits < count:
            byte = self._data[self._pos] if self._pos < len(self._data) else 0
            self._pos += 1
            self._acc = (self._acc << 8) | byte
            self._bits += 8
        self._bits -= count
        value = (self._acc >> self._bits) & ((1 << count) - 1)
        self._acc &= (1 << self._bits) - 1
        return value


class _Huffman:
    """MAME's huffman_decoder<16, 8>, RLE tree import and canonical codes.

    Small enough to be worth having rather than depending on anything: sixteen
    codes, eight bits, and the tree arrives run-length encoded ahead of the map.
    """

    def __init__(self, numcodes: int = 16, maxbits: int = 8):
        self._numcodes = numcodes
        self._maxbits = maxbits
        self._numbits = [0] * numcodes
        self._codes = [0] * numcodes

    def import_tree_rle(self, bits: _BitReader) -> None:
        width = 5 if self._maxbits >= 16 else (4 if self._maxbits >= 8 else 3)
        index = 0
        while index < self._numcodes:
            length = bits.read(width)
            if length != 1:
                self._numbits[index] = length
                index += 1
                continue
            length = bits.read(width)
            if length == 1:
                self._numbits[index] = 1
                index += 1
                continue
            repeat = bits.read(width) + 3
            while repeat and index < self._numcodes:
                self._numbits[index] = length
                index += 1
                repeat -= 1
        self._assign_canonical()

    def _assign_canonical(self) -> None:
        histogram = [0] * (self._maxbits + 1)
        for length in self._numbits:
            histogram[length] += 1
        start = 0
        for length in range(self._maxbits, 0, -1):
            following = (start + histogram[length]) >> 1
            if length != 1 and (following << 1) != (start + histogram[length]):
                raise ChdError("huffman tree doesn't add up")
            histogram[length] = start
            start = following
        for index in range(self._numcodes):
            length = self._numbits[index]
            if length:
                self._codes[index] = histogram[length]
                histogram[length] += 1

    def decode_one(self, bits: _BitReader) -> int:
        code = 0
        length = 0
        while length < self._maxbits:
            code = (code << 1) | bits.read(1)
            length += 1
            for index in range(self._numcodes):
                if self._numbits[index] == length and self._codes[index] == code:
                    return index
        raise ChdError("no huffman code matched")


def shape_tags(path) -> set:
    """Which metadata tags a CHD carries, whatever shape of disc it holds.

    The one thing that says what is actually in there: CHT2/CHTR is a CD, "DVD "
    is a DVD, CHGD is a GD-ROM. Anything unpacking a CHD has to dispatch on this
    and never on the console — chdman's extractcd and extractdvd both exit 0 on
    the wrong kind of image and just hand back a different number of bytes, so
    there is no error to catch and trial-and-error cannot resolve it.

    Separate from ChdFile on purpose. ChdFile refuses anything that isn't CD
    framed, which is right for it — every method on it reads 2448-byte frames —
    but it means asking *it* what shape a disc is answers "not a CD image" for
    every DVD, which is not the same statement as "this file is damaged". This
    reads the header and the metadata chain and asserts nothing about framing.

    Returns an empty set for anything it cannot read, which callers must treat as
    "we could not tell" rather than as a fault.
    """
    try:
        with open(path, "rb") as handle:
            head = handle.read(124)
            if len(head) < 124 or head[:8] != b"MComprHD":
                return set()
            if struct.unpack(">I", head[12:16])[0] != 5:
                return set()
            offset = struct.unpack(">Q", head[48:56])[0]
            tags = set()
            for _ in range(256):
                if not offset:
                    break
                handle.seek(offset)
                entry = handle.read(16)
                if len(entry) < 16:
                    break
                tags.add(entry[0:4])
                offset = struct.unpack(">Q", entry[8:16])[0]
            return tags
    except OSError:
        return set()


class ChdFile:
    """One CHD, opened for reading sectors. Use as a context manager."""

    def __init__(self, path: Path):
        self._path = Path(path)
        self._file = open(self._path, "rb")
        try:
            self._read_header()
        except Exception:
            self._file.close()
            raise
        self._map = None
        self._hunks = {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self) -> None:
        try:
            self._file.close()
        except OSError:
            pass

    def _read_header(self) -> None:
        head = self._file.read(124)
        if len(head) < 124 or head[:8] != b"MComprHD":
            raise ChdError("not a CHD")
        version = struct.unpack(">I", head[12:16])[0]
        if version != 5:
            raise ChdError(f"CHD v{version} is not supported")
        self._compressors = [head[16 + i * 4:20 + i * 4] for i in range(4)]
        self.logical_bytes, self._map_offset, self._meta_offset = struct.unpack(">QQQ", head[32:56])
        self.hunk_bytes, self.unit_bytes = struct.unpack(">II", head[56:64])
        if not self.hunk_bytes or self.hunk_bytes % CD_FRAME_SIZE:
            raise ChdError("not a CD image")
        self._hunk_count = (self.logical_bytes + self.hunk_bytes - 1) // self.hunk_bytes

    def _metadata(self):
        entries = []
        offset = self._meta_offset
        for _ in range(256):
            if not offset:
                break
            self._file.seek(offset)
            head = self._file.read(16)
            if len(head) < 16:
                break
            tag = head[0:4]
            length = int.from_bytes(head[5:8], "big")
            offset = struct.unpack(">Q", head[8:16])[0]
            entries.append((tag, self._file.read(length).rstrip(b"\x00")))
        return entries

    def tracks(self) -> list:
        """The track table, each entry carrying where it starts in the CHD."""
        rows = []
        for tag, data in self._metadata():
            if tag not in (b"CHT2", b"CHTR"):
                continue
            fields = {}
            for part in data.decode("latin1", "replace").split():
                if ":" in part:
                    key, value = part.split(":", 1)
                    fields[key] = value.rstrip(".")
            rows.append(fields)

        tracks = []
        start = 0
        for fields in rows:
            frames = _to_int(fields.get("FRAMES"))
            pregap = _to_int(fields.get("PREGAP"))
            pgtype = fields.get("PGTYPE", "")
            tracks.append({
                "track": _to_int(fields.get("TRACK")),
                "type": fields.get("TYPE", ""),
                "frames": frames,
                "pregap": pregap,
                "pgtype": pgtype,
                "pregap_in_file": bool(pregap) and pgtype.startswith("V"),
                "start": start,
            })
            start += frames + ((_TRACK_PADDING - (frames % _TRACK_PADDING)) % _TRACK_PADDING)
        return tracks

    def first_data_track(self):
        for track in self.tracks():
            if track["type"].startswith("MODE"):
                return track
        return None

    def _read_map(self):
        if self._map is not None:
            return self._map
        self._file.seek(self._map_offset)
        head = self._file.read(16)
        if len(head) < 16:
            raise ChdError("truncated map header")
        map_bytes = struct.unpack(">I", head[0:4])[0]
        first_offset = int.from_bytes(head[4:10], "big")
        length_bits, self_bits, parent_bits = head[12], head[13], head[14]
        if map_bytes < 16:
            raise ChdError("bad map length")
        bits = _BitReader(self._file.read(map_bytes - 16))

        huffman = _Huffman()
        huffman.import_tree_rle(bits)

        types = [0] * self._hunk_count
        last = 0
        repeat = 0
        for index in range(self._hunk_count):
            if repeat > 0:
                types[index] = last
                repeat -= 1
                continue
            value = huffman.decode_one(bits)
            if value == _RLE_SMALL:
                types[index] = last
                repeat = 2 + huffman.decode_one(bits)
            elif value == _RLE_LARGE:
                types[index] = last
                repeat = 2 + 16 + (huffman.decode_one(bits) << 4)
                repeat += huffman.decode_one(bits)
            else:
                types[index] = last = value

        entries = []
        offset_cursor = first_offset
        last_self = 0
        last_parent = 0
        for index in range(self._hunk_count):
            kind = types[index]
            offset = offset_cursor
            length = 0
            if kind in (_TYPE_0, _TYPE_1, _TYPE_2, _TYPE_3):
                length = bits.read(length_bits)
                offset_cursor += length
                bits.read(16)
            elif kind == _NONE:
                length = self.hunk_bytes
                offset_cursor += length
                bits.read(16)
            elif kind == _SELF:
                offset = last_self = bits.read(self_bits)
            elif kind == _PARENT:
                offset = last_parent = bits.read(parent_bits)
            elif kind in (_SELF_0, _SELF_1):
                if kind == _SELF_1:
                    last_self += 1
                kind = _SELF
                offset = last_self
            elif kind == _PARENT_SELF:
                kind = _PARENT
                last_parent = offset = (index * self.hunk_bytes) // self.unit_bytes
            elif kind in (_PARENT_0, _PARENT_1):
                if kind == _PARENT_1:
                    last_parent += self.hunk_bytes // self.unit_bytes
                kind = _PARENT
                offset = last_parent
            entries.append((kind, offset, length))
        self._map = entries
        return entries

    def _read_hunk(self, index: int, _depth: int = 0):
        cached = self._hunks.get(index)
        if cached is not None:
            return cached
        entries = self._read_map()
        if index >= len(entries):
            raise ChdError("hunk past the end of the map")
        kind, offset, length = entries[index]
        if kind == _SELF:
            if _depth > 8:
                raise ChdError("self-reference loop")
            return self._read_hunk(offset, _depth + 1)
        if kind == _PARENT:
            raise ChdError("parent CHDs are not supported")

        self._file.seek(offset)
        raw = self._file.read(length)
        data = raw if kind == _NONE else self._decompress(self._compressors[kind], raw)

        self._hunks[index] = data
        if len(self._hunks) > 8:
            self._hunks.pop(next(iter(self._hunks)))
        return data

    def _decompress(self, codec: bytes, raw: bytes) -> bytes:
        frames = self.hunk_bytes // CD_FRAME_SIZE
        ecc_bytes = (frames + 7) // 8
        length_bytes = 2 if self.hunk_bytes < 65536 else 3
        if len(raw) < ecc_bytes + length_bytes:
            raise ChdError("truncated hunk")
        base_length = (raw[ecc_bytes] << 8) | raw[ecc_bytes + 1]
        if length_bytes > 2:
            base_length = (base_length << 8) | raw[ecc_bytes + 2]
        start = ecc_bytes + length_bytes
        payload = raw[start:start + base_length]
        wanted = frames * CD_SECTOR_DATA

        if codec == b"cdzl":
            data = zlib.decompressobj(-zlib.MAX_WBITS).decompress(payload, wanted)
        elif codec == b"cdlz":
            data = self._decompress_lzma(payload, wanted)
        else:
            raise ChdError(f"codec {codec.decode('latin1', 'replace')} not supported")

        if len(data) < wanted:
            data = data + bytes(wanted - len(data))
        return data

    def _decompress_lzma(self, payload: bytes, wanted: int) -> bytes:
        dict_size = 1 << 12
        for shift in range(11, 31):
            if self.hunk_bytes <= (2 << shift):
                dict_size = 2 << shift
                break
            if self.hunk_bytes <= (3 << shift):
                dict_size = 3 << shift
                break
        filters = [{
            "id": lzma.FILTER_LZMA1,
            "dict_size": dict_size,
            "lc": 3,
            "lp": 0,
            "pb": 2,
        }]
        decoder = lzma.LZMADecompressor(format=lzma.FORMAT_RAW, filters=filters)
        return decoder.decompress(payload, max_length=wanted)

    def user_data(self, frame: int, track_type: str = "MODE1_RAW") -> bytes:
        """The 2048 user bytes of one frame, addressed in CHD frame space."""
        per_hunk = self.hunk_bytes // CD_FRAME_SIZE
        hunk = self._read_hunk(frame // per_hunk)
        within = frame % per_hunk
        sector = hunk[within * CD_SECTOR_DATA:(within + 1) * CD_SECTOR_DATA]
        offset = _USER_OFFSET.get(track_type, 16)
        return sector[offset:offset + USER_DATA_SIZE]


def _to_int(value) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return 0
