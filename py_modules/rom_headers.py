"""Reading a cartridge image's own header to find out whether it was trimmed.

Trimming is cutting the blank padding off the end of a dump to save space. The
game data is untouched, so an emulator and RetroAchievements both read a trimmed
file exactly as they read a full one — but every published catalogue hashes the
*full* cart dump, so a trimmed file can never match one. Saying "doesn't match"
about those without saying why would be the feature's single biggest source of
false alarm.

Nothing here guesses. All three formats state their own full size in a header
field, so the answer is a comparison rather than a heuristic:

* **Nintendo DS** — cart size at 0x14 as a shift, used bytes at 0x80.
* **Nintendo 3DS** — NCSD magic at 0x100, media size at 0x104 in 0x200 units.
* **Switch XCI** — HEAD magic at 0x100, valid-data end at 0x118 in 0x200 pages.

Test on the CART size, never on the used size. Both trimmed DS files this was
built against sit a little above their used figure — one carries 320 KB of
padding past its data — so "file size equals used size" misses them and
"file size is under the cart size" does not.

Same discipline as `chd_reader`: stdlib only, no decky import, no logging, so it
stays drivable from a terminal. Every read is bounds-checked and every failure is
None, which the caller reads as "we could not tell" rather than as a fault.
"""

import struct


_DS_CAPACITY_OFFSET = 0x14
_DS_USED_OFFSET = 0x80
_DS_BASE_SIZE = 128 * 1024
_DS_MAX_SHIFT = 13

_NCSD_MAGIC_OFFSET = 0x100
_NCSD_SIZE_OFFSET = 0x104
_XCI_MAGIC_OFFSET = 0x100
_XCI_VALID_END_OFFSET = 0x118

_MEDIA_UNIT = 0x200

_HEADER_BYTES = 0x200


def _head(path):
    try:
        with open(path, "rb") as handle:
            return handle.read(_HEADER_BYTES)
    except OSError:
        return None


def _u32(data, offset):
    if len(data) < offset + 4:
        return None
    return struct.unpack_from("<I", data, offset)[0]


def nds_full_size(data):
    """The cart size a DS header declares, or None if it does not declare one."""
    if data is None or len(data) <= _DS_USED_OFFSET + 4:
        return None
    shift = data[_DS_CAPACITY_OFFSET]
    if shift > _DS_MAX_SHIFT:
        return None
    used = _u32(data, _DS_USED_OFFSET)
    if not used:
        return None
    full = _DS_BASE_SIZE << shift
    return full if used <= full else None


def ncsd_full_size(data):
    """The image size a 3DS NCSD header declares, or None."""
    if data is None or len(data) < _NCSD_SIZE_OFFSET + 4:
        return None
    if data[_NCSD_MAGIC_OFFSET:_NCSD_MAGIC_OFFSET + 4] != b"NCSD":
        return None
    units = _u32(data, _NCSD_SIZE_OFFSET)
    return units * _MEDIA_UNIT if units else None


def xci_full_size(data):
    """The end of an XCI's real data, in bytes, or None.

    Unlike the other two this is not the cart size — it is where the data stops.
    A trimmed XCI ends exactly here; an untrimmed one carries padding out to the
    nominal 4 GB or 8 GB cart size beyond it.
    """
    if data is None or len(data) < _XCI_VALID_END_OFFSET + 4:
        return None
    if data[_XCI_MAGIC_OFFSET:_XCI_MAGIC_OFFSET + 4] != b"HEAD":
        return None
    pages = _u32(data, _XCI_VALID_END_OFFSET)
    return (pages + 1) * _MEDIA_UNIT if pages else None


def is_trimmed(path, suffix, size):
    """Whether this image had its padding cut off, or None when we cannot tell.

    None is a real answer and separate from False: a file whose header we cannot
    read has not been shown to be full, and §2's rule points both ways.
    """
    suffix = str(suffix or "").lower()
    if suffix not in (".nds", ".srl", ".3ds", ".cci", ".xci"):
        return None

    data = _head(path)
    if data is None:
        return None

    if suffix in (".nds", ".srl"):
        full = nds_full_size(data)
    elif suffix in (".3ds", ".cci"):
        full = ncsd_full_size(data)
    else:
        end = xci_full_size(data)
        return None if end is None else size == end

    if not full:
        return None
    return size < full
