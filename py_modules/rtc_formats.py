import struct

GAMBATTE = "gambatte"
SAMEBOY = "sameboy"
SIZES = {GAMBATTE: 8, SAMEBOY: 32}
DAY = 86400
DAYS = 0x200


def fits(core: str, data) -> bool:
    return data is not None and core in SIZES and len(data) == SIZES[core]


def convert(data: bytes, source: str, target: str, now: int) -> bytes:
    if not fits(source, data) or target not in SIZES:
        raise ValueError(f"not a {source} clock file")
    if source == target:
        return data
    counter = _counter(source, data, now)
    if target == GAMBATTE:
        return struct.pack("<Q", max(0, now - counter))
    return _sameboy(counter, now)


def _counter(core: str, data: bytes, now: int) -> int:
    if core == GAMBATTE:
        return max(0, now - struct.unpack("<Q", data)[0])
    seconds, minutes, hours, days_low, high = data[0:5]
    counter = seconds + 60 * minutes + 3600 * hours + DAY * (days_low | (high & 1) << 8)
    if not high & 0x40:
        counter += max(0, now - struct.unpack("<Q", data[16:24])[0])
    return counter


def _sameboy(counter: int, now: int) -> bytes:
    days, rest = divmod(counter, DAY)
    carry = 0x80 if days >= DAYS else 0
    days %= DAYS
    registers = bytes([rest % 60, rest % 3600 // 60, rest // 3600, days & 0xFF, days >> 8 | carry])
    return registers + registers + bytes(6) + struct.pack("<Q", now) + bytes(8)
