"""The two containers a Nintendo Switch dump arrives in, read far enough to
find the content files inside them.

Switch is the one system here that can answer for itself. Nobody publishes a
catalogue we can use — No-Intro's Switch sets are not mirrored by libretro and
state no licence, the same wall Mega Duck hit — but the format does not need
one. **Every NCA is named after the first sixteen bytes of its own SHA-256**,
so hashing the content and comparing it to the name it is filed under is a
complete integrity check that needs no reference data and no keys at all.

Measured against a real library before this was written: three NSPs gave 12 of
12 NCAs matching, and a 2.56 GB NCA inside an XCI matched as well.

Two containers, both simple:

  NSP   a PFS0 archive. 16-byte header, then one 24-byte entry per file, then
        the string table, then the data.
  XCI   an "HEAD" card header at 0x100 whose root HFS0 partition holds the
        four sub-partitions (update / logo / normal / secure), each itself an
        HFS0. The NCAs live in secure. HFS0 entries are 64 bytes and carry a
        SHA-256 of their own first `hash_size` bytes — which is *not* worth
        checking: it is 512 bytes of a multi-gigabyte file, 0.0001% of the
        content, and reading it as verification would be a false comfort.
        The NCA name is the real check on both containers.

Nothing here decrypts anything. The NCAs stay encrypted and unread beyond
being hashed, which is why no keys are needed.
"""

import struct
from pathlib import Path

PFS0_MAGIC = b"PFS0"
HFS0_MAGIC = b"HFS0"
XCI_MAGIC = b"HEAD"

XCI_MAGIC_OFFSET = 0x100
XCI_ROOT_OFFSET = 0x130

_PFS0_ENTRY = 24
_HFS0_ENTRY = 64

MAX_ENTRIES = 4096
MAX_STRING_TABLE = 1 << 20


class Entry:
    """One file inside a container: what it's called and where its bytes are."""

    __slots__ = ("name", "offset", "size")

    def __init__(self, name, offset, size):
        self.name = name
        self.offset = offset
        self.size = size


def _read_table(handle, base, magic, entry_size):
    """One PFS0/HFS0 partition's entries, or None if it isn't one.

    Both formats share a shape — magic, count, string table size, four bytes
    the format doesn't use, then fixed-size entries and a string table — so one
    reader covers them and only the stride differs.
    """
    try:
        handle.seek(base)
        header = handle.read(16)
    except OSError:
        return None
    if len(header) < 16 or header[:4] != magic:
        return None
    count, string_bytes, _unused = struct.unpack("<III", header[4:16])
    if count > MAX_ENTRIES or string_bytes > MAX_STRING_TABLE:
        return None

    try:
        raw = handle.read(entry_size * count)
        names = handle.read(string_bytes)
    except OSError:
        return None
    if len(raw) < entry_size * count or len(names) < string_bytes:
        return None

    data_start = base + 16 + entry_size * count + string_bytes
    out = []
    for index in range(count):
        chunk = raw[entry_size * index:entry_size * index + 20]
        offset, size, name_offset = struct.unpack("<QQI", chunk)
        if name_offset >= len(names):
            continue
        end = names.find(b"\0", name_offset)
        if end < 0:
            end = len(names)
        name = names[name_offset:end].decode("utf-8", "replace")
        out.append(Entry(name, data_start + offset, size))
    return out


def content_entries(path):
    """Every content file in a Switch container, or None if it isn't one.

    None means "this is not a shape we know", which the caller must not read as
    a fault: an .nsp that fails here has told us nothing about itself.
    """
    path = Path(path)
    try:
        file_size = path.stat().st_size
    except OSError:
        return None

    try:
        with path.open("rb") as handle:
            head = handle.read(4)
            if head == PFS0_MAGIC:
                return _read_table(handle, 0, PFS0_MAGIC, _PFS0_ENTRY)

            handle.seek(XCI_MAGIC_OFFSET)
            if handle.read(4) != XCI_MAGIC:
                return None
            handle.seek(XCI_ROOT_OFFSET)
            raw = handle.read(8)
            if len(raw) < 8:
                return None
            root_offset = struct.unpack("<Q", raw)[0]
            if root_offset >= file_size:
                return None
            root = _read_table(handle, root_offset, HFS0_MAGIC, _HFS0_ENTRY)
            if root is None:
                return None
            found = []
            for partition in root:
                inner = _read_table(handle, partition.offset, HFS0_MAGIC, _HFS0_ENTRY)
                if inner:
                    found.extend(inner)
            return found
    except OSError:
        return None


def named_hash(name):
    """The SHA-256 prefix an NCA's filename claims, or None if it claims none.

    "3e1d6097fa7d9cc0dd0675bf3d2eb654.nca" is the whole mechanism: that is the
    first sixteen bytes of the file's own digest, written down by whoever built
    it. Anything else in the container — the ticket, the certificate — is named
    by title id and has nothing to check.
    """
    text = str(name or "")
    if not text.lower().endswith(".nca"):
        return None
    stem = text.split(".")[0].lower()
    if len(stem) != 32:
        return None
    try:
        int(stem, 16)
    except ValueError:
        return None
    return stem
