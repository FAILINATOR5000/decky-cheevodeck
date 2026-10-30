"""Reading a cartridge image's own header to find out whether it was trimmed.

Trimming is cutting the blank padding off the end of a dump to save space. The
game data is untouched, so an emulator and RetroAchievements both read a trimmed
file exactly as they read a full one, but every published catalogue hashes the
full cart dump, so a trimmed file can never match one. Saying "doesn't match"
about those without saying why would be the feature's single biggest source of
false alarm.

Nothing here guesses. All three formats state their own full size in a header
field, so the answer is a comparison rather than a heuristic.

* **Nintendo DS** puts its cart size at 0x14, as a shift, and its used bytes
  at 0x80.
* **Nintendo 3DS** carries NCSD magic at 0x100, with the media size sitting at
  0x104 in 0x200 units.
* **Switch XCI** carries HEAD magic at 0x100, with the end of valid data at
  0x118 in 0x200 pages.

Test on the cart size, never on the used size. Both trimmed DS files this was
built against sit a little above their used figure, one of them carrying 320 KB
of padding past its data, so "file size equals used size" misses them and "file
size is under the cart size" does not.

Same discipline as `chd_reader`: stdlib only, no decky import, no logging, so it
stays drivable from a terminal. Every read is bounds-checked and every failure is
None, which the caller reads as "could not tell" rather than as a fault.
"""

import struct
import zipfile


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

    Unlike the other two this is not the cart size, it is where the data stops.
    A trimmed XCI ends exactly here; an untrimmed one carries padding out to
    the nominal 4 GB or 8 GB cart size beyond it.
    """
    if data is None or len(data) < _XCI_VALID_END_OFFSET + 4:
        return None
    if data[_XCI_MAGIC_OFFSET:_XCI_MAGIC_OFFSET + 4] != b"HEAD":
        return None
    pages = _u32(data, _XCI_VALID_END_OFFSET)
    return (pages + 1) * _MEDIA_UNIT if pages else None


def is_trimmed(path, suffix, size):
    """Whether this image had its padding cut off, or None when there is no
    telling.

    None is a real answer and separate from False: a file whose header cannot
    be read has not been shown to be full, and the caller has to keep the two
    apart.
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


_CODE_AT = {
    5: (0xAC, (".gba", ".agb", ".bin")),
    18: (0x0C, (".nds", ".srl")),
}

_DS_UNIT_OFFSET = 0x12
_DSI_ONLY = 0x03


def _rom_bytes(path, suffixes, count):
    if str(path).lower().endswith(".zip"):
        try:
            with zipfile.ZipFile(path) as archive:
                members = [info for info in archive.infolist()
                           if not info.is_dir() and info.filename.lower().endswith(suffixes)]
                if len(members) != 1:
                    return None
                with archive.open(members[0]) as handle:
                    return handle.read(count)
        except (OSError, zipfile.BadZipFile, NotImplementedError, RuntimeError):
            return None
    if not str(path).lower().endswith(suffixes):
        return None
    try:
        with open(path, "rb") as handle:
            return handle.read(count)
    except OSError:
        return None


def game_code(path, system_id):
    found = _CODE_AT.get(system_id)
    if found is None:
        return ""
    offset, suffixes = found
    data = _rom_bytes(path, suffixes, offset + 4)
    if data is None or len(data) < offset + 4:
        return ""
    code = data[offset:offset + 4]
    if not all(chr(byte).isupper() or chr(byte).isdigit() for byte in code):
        return ""
    return code.decode("ascii")


def dsi_only(path):
    data = _rom_bytes(path, _CODE_AT[18][1], _DS_UNIT_OFFSET + 1)
    return data is not None and len(data) > _DS_UNIT_OFFSET and data[_DS_UNIT_OFFSET] == _DSI_ONLY


_DISC_ID_AT = {b"RVZ\x01": 0x58, b"WIA\x01": 0x58, b"CISO": 0x8000}
_WBFS_MAGIC = b"WBFS"
_WBFS_SHIFT_OFFSET = 8
_DISC_ID_LENGTH = 6


def disc_game_id(path):
    suffix = str(path).lower().rsplit(".", 1)[-1]
    if suffix not in ("iso", "gcm", "rvz", "wia", "wbfs", "ciso"):
        return ""
    try:
        with open(path, "rb") as handle:
            head = handle.read(_WBFS_SHIFT_OFFSET + 1)
            offset = _DISC_ID_AT.get(head[:4], 0)
            if head[:4] == _WBFS_MAGIC and len(head) > _WBFS_SHIFT_OFFSET:
                offset = 1 << head[_WBFS_SHIFT_OFFSET]
            handle.seek(offset)
            found = handle.read(_DISC_ID_LENGTH)
    except OSError:
        return ""
    if len(found) != _DISC_ID_LENGTH or not all(chr(byte).isupper() or chr(byte).isdigit() for byte in found):
        return ""
    return found.decode("ascii")
