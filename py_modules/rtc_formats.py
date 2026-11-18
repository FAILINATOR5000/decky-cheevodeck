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
    if high & 0x80:
        counter += DAYS * DAY
    if not high & 0x40:
        counter += max(0, now - struct.unpack("<Q", data[16:24])[0])
    return counter


def _sameboy(counter: int, now: int) -> bytes:
    days, rest = divmod(counter, DAY)
    carry = 0x80 if days >= DAYS else 0
    days %= DAYS
    registers = bytes([rest % 60, rest % 3600 // 60, rest // 3600, days & 0xFF, days >> 8 | carry])
    return registers + registers + bytes(6) + struct.pack("<Q", now) + bytes(8)


EARLIEST = 946684800
SLACK = DAY


def _plausible(seconds: int, now: int) -> bool:
    return EARLIEST <= seconds <= now + SLACK


def _registers_fit(registers: bytes) -> bool:
    seconds, minutes, hours = registers[0:3]
    return seconds < 60 and minutes < 60 and hours < 24


def valid(core: str, data, now: int) -> bool:
    if not fits(core, data):
        return False
    if core == GAMBATTE:
        return _plausible(struct.unpack("<Q", data)[0], now)
    return _registers_fit(data[0:5]) and _registers_fit(data[5:10]) \
        and _plausible(struct.unpack("<Q", data[16:24])[0], now)


def misread_gambatte(data, now: int):
    if not fits(SAMEBOY, data) or _registers_fit(data[0:5]):
        return None
    base = int.from_bytes(data[0:5], "little")
    return base if _plausible(base, now) else None


def gambatte_clock(base: int) -> bytes:
    return struct.pack("<Q", base)


def overflowed(core: str, now: int) -> bytes:
    if core == GAMBATTE:
        return struct.pack("<Q", now - DAYS * DAY)
    registers = bytes([0, 0, 0, 0, 0x80])
    return registers + registers + bytes(6) + struct.pack("<Q", now) + bytes(8)
