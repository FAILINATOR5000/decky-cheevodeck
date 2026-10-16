import base64
import binascii
import json
import re
from pathlib import Path

import decky
import subprocess_util

from memories_clips import FFMPEG, FFPROBE, media_start_seconds

TARGET_BYTES = 8_245_000

CEILING_BYTES = 9_500_000

MAX_PART_SECONDS = 30.0

AUDIO_KBPS = 128

KEYFRAME_TOLERANCE_SECONDS = 0.1

_KEYFRAME_ROUNDING_SECONDS = 0.002

_KEYFRAME_SEARCH_SECONDS = 4.0

PRESETS = {"medium": "medium", "high": "slow", "best": "slower"}

_PROBE_TIMEOUT_SECONDS = 20
_PICTURE_TIMEOUT_SECONDS = 60
_ENCODE_TIMEOUT_SECONDS = 300

_SCALE_FILTER = (
    "fps=30,scale=w='min(1280,iw)':h='min(800,ih)'"
    ":force_original_aspect_ratio=decrease:force_divisible_by=2"
)

PILL_HEIGHT_SHARE = 0.065
PILL_MARGIN_SHARE = 0.025
PILL_SIDE_MARGIN_SHARE = 0.0125

DISCORD_CARD_ASPECT = 1.5

_PILL_MAX_CHARS = 2_000_000

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

NICE = "/usr/bin/nice"
IONICE = "/usr/bin/ionice"


def _priority_prefix(low: bool) -> list:
    if not low:
        return []
    prefix = []
    if Path(NICE).is_file():
        prefix += [NICE, "-n", "19"]
    if Path(IONICE).is_file():
        prefix += [IONICE, "-c", "3"]
    return prefix


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _discard(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


def probe(source: str):
    code, stdout, _stderr = subprocess_util.run_command([
        FFPROBE, "-v", "error",
        "-show_entries", "stream=codec_type,codec_name:format=duration",
        "-of", "json",
        "-i", source,
    ], timeout=_PROBE_TIMEOUT_SECONDS, as_data_owner=True)
    if code != 0:
        return None
    try:
        info = json.loads(stdout)
    except ValueError:
        return None

    video = ""
    audio = ""
    for stream in info.get("streams") or []:
        kind = stream.get("codec_type")
        if kind == "video" and not video:
            video = str(stream.get("codec_name") or "")
        elif kind == "audio" and not audio:
            audio = str(stream.get("codec_name") or "")
    try:
        duration = float((info.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    return {"video": video, "audio": audio, "duration": duration}


def frame_size(source: str):
    code, stdout, _stderr = subprocess_util.run_command([
        FFPROBE, "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json",
        "-i", source,
    ], timeout=_PROBE_TIMEOUT_SECONDS, as_data_owner=True)
    if code != 0:
        return None
    try:
        stream = (json.loads(stdout).get("streams") or [{}])[0]
        width, height = int(stream["width"]), int(stream["height"])
    except (ValueError, KeyError, TypeError, IndexError):
        return None
    if width <= 0 or height <= 0:
        return None
    return width, height


def decode_pill(text) -> bytes | None:
    text = str(text or "")
    if not text:
        return b""
    if len(text) > _PILL_MAX_CHARS:
        return None
    try:
        data = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        return None
    return data if data.startswith(_PNG_SIGNATURE) else None


def picture_area(source_args: list, size: tuple) -> tuple:
    whole = (0.0, 0.0, 1.0, 1.0)
    code, stdout, stderr = subprocess_util.run_command(
        [FFMPEG, "-v", "info", "-hide_banner", *source_args,
         "-vf", "cropdetect=round=2:skip=0", "-an", "-f", "null", "-"],
        timeout=_PROBE_TIMEOUT_SECONDS, as_data_owner=True,
    )
    found = re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", f"{stdout}{stderr}")
    if code != 0 or not found:
        return None
    width, height = size
    w, h, x, y = (int(part) for part in found[-1])
    if w < width / 2 or h < height / 2:
        return whole

    def bar(gap, whole_length):
        return gap if whole_length * 0.005 <= gap <= whole_length * 0.25 else 0

    left, top = bar(x, width), bar(y, height)
    right, bottom = bar(width - x - w, width), bar(height - y - h, height)
    return left / width, top / height, 1 - right / width, 1 - bottom / height


def _pill_graph(base: str, pill_input: int, frame_size: tuple, area: tuple, blend: str) -> str:
    width, height = frame_size
    card_width = min(width, height * DISCORD_CARD_ASPECT)
    card_height = min(height, width / DISCORD_CARD_ASPECT)
    card_left = (width - card_width) / 2
    card_top = (height - card_height) / 2
    right = min(card_left + card_width, area[2] * width)
    top = max(card_top, area[1] * height)
    bottom = min(card_top + card_height, area[3] * height)
    shown_height = max(bottom - top, 2)
    pill_height = max(2, round(shown_height * PILL_HEIGHT_SHARE))
    margin = round(shown_height * PILL_MARGIN_SHARE)
    side_margin = round(shown_height * PILL_SIDE_MARGIN_SHARE)
    x = f"{int(right) - side_margin}-w"
    y = f"{int(top) + margin}"
    return (
        f"{base}[base];"
        f"[{pill_input}:v]scale=w=-1:h={pill_height}:flags=lanczos[pill];"
        f"[base][pill]overlay=x={x}:y={y}:format={blend}"
    )


def _shared_size(width: int, height: int) -> tuple:
    factor = min(min(1280, width) / width, min(800, height) / height, 1.0)
    return max(2, int(width * factor) // 2 * 2), max(2, int(height * factor) // 2 * 2)


def plays_as_is(video_codec: str, audio_codec: str) -> bool:
    return video_codec == "h264" and audio_codec in ("aac", "")


def source_plays_as_is(video_input: str, audio_input: str) -> bool:
    info = probe(video_input)
    if info is None:
        return False
    audio = info["audio"]
    if audio_input:
        separate = probe(audio_input)
        audio = separate["audio"] if separate is not None else "unknown"
    return plays_as_is(info["video"], audio)


def original_up_to(size_bytes: int, seconds: float) -> float:
    if size_bytes <= 0 or seconds <= 0:
        return 0.0
    return TARGET_BYTES / (size_bytes / seconds)


def frame_at(video_input: str, start_s: float) -> float:
    window_end = start_s + _KEYFRAME_ROUNDING_SECONDS
    code, stdout, _stderr = subprocess_util.run_command([
        FFPROBE, "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "packet=pts_time",
        "-of", "csv=p=0",
        "-read_intervals", f"{max(start_s - 0.2, 0.0):.3f}%{window_end:.3f}",
        "-i", video_input,
    ], timeout=_PROBE_TIMEOUT_SECONDS, as_data_owner=True)
    if code != 0:
        return start_s
    found = None
    for line in stdout.splitlines():
        try:
            seconds = float(line.strip().rstrip(","))
        except ValueError:
            continue
        if seconds <= window_end and (found is None or seconds > found):
            found = seconds
    if found is None or start_s - found > 0.2:
        return start_s
    return found


def keyframe_at(video_input: str, start_s: float):
    window_start = max(start_s - _KEYFRAME_SEARCH_SECONDS, 0.0)
    window_end = start_s + _KEYFRAME_ROUNDING_SECONDS
    code, stdout, _stderr = subprocess_util.run_command([
        FFPROBE, "-v", "error",
        "-select_streams", "v:0",
        "-skip_frame", "nokey",
        "-show_entries", "frame=pts_time",
        "-of", "csv=p=0",
        "-read_intervals", f"{window_start:.3f}%{window_end:.3f}",
        "-i", video_input,
    ], timeout=_PROBE_TIMEOUT_SECONDS, as_data_owner=True)
    if code != 0:
        return None

    found = None
    for line in stdout.splitlines():
        try:
            seconds = float(line.strip().rstrip(","))
        except ValueError:
            continue
        if seconds <= window_end and (found is None or seconds > found):
            found = seconds
    if found is None:
        return None
    lead = start_s - found
    if -_KEYFRAME_ROUNDING_SECONDS <= lead <= KEYFRAME_TOLERANCE_SECONDS:
        return found
    return None


def shrink_picture(source: Path, target: Path, low_priority: bool, cancel) -> dict:
    for quality in ("2", "4"):
        command = _priority_prefix(low_priority) + [
            FFMPEG, "-y", "-v", "error",
            "-i", str(source),
            "-frames:v", "1",
            "-q:v", quality,
            str(target),
        ]
        code, stdout, stderr = subprocess_util.run_command(
            command, timeout=_PICTURE_TIMEOUT_SECONDS, cancel=cancel, as_data_owner=True
        )
        if cancel.is_set():
            _discard(target)
            return {"ok": False, "error": "cancelled"}
        if code != 0:
            decky.logger.warning(
                "memories: converting a picture to share failed (rc=%s): %s",
                code, f"{stdout}{stderr}".strip()[:300],
            )
            _discard(target)
            return {"ok": False, "error": "encode_failed"}
        size = _size(target)
        if 0 < size <= TARGET_BYTES:
            return {"ok": True, "bytes": size}

    _discard(target)
    return {"ok": False, "error": "too_big"}


def stamp_picture(source: Path, pill: Path, target_for, low_priority: bool, cancel) -> dict:
    size = frame_size(str(source))
    if size is None:
        return {"ok": False, "error": "encode_failed"}
    area = picture_area(["-i", str(source), "-frames:v", "1"], size) or (0.0, 0.0, 1.0, 1.0)
    graph = _pill_graph("[0:v]null", 1, size, area, "auto")
    attempts = []
    if source.suffix.lower() == ".webp":
        attempts.append((target_for(".webp"), ["-c:v", "libwebp", "-lossless", "1", "-compression_level", "4"]))
    attempts.append((target_for(".png"), []))
    attempts += [(target_for(".jpg"), ["-q:v", quality]) for quality in ("2", "4")]
    for target, quality in attempts:
        command = _priority_prefix(low_priority) + [
            FFMPEG, "-y", "-v", "error",
            "-i", str(source),
            "-i", str(pill),
            "-filter_complex", graph,
            "-frames:v", "1",
            *quality,
            str(target),
        ]
        code, stdout, stderr = subprocess_util.run_command(
            command, timeout=_PICTURE_TIMEOUT_SECONDS, cancel=cancel, as_data_owner=True
        )
        if cancel.is_set():
            _discard(target)
            return {"ok": False, "error": "cancelled"}
        if code != 0:
            decky.logger.warning(
                "memories: stamping a picture to share failed (rc=%s): %s",
                code, f"{stdout}{stderr}".strip()[:300],
            )
            _discard(target)
            return {"ok": False, "error": "encode_failed"}
        written = _size(target)
        if 0 < written <= TARGET_BYTES:
            return {"ok": True, "bytes": written, "path": target}
        _discard(target)

    return {"ok": False, "error": "too_big"}


def part_source(video_input: str, audio_input: str, start_s: float, span_s: float, pill: Path | None = None):
    base = media_start_seconds(video_input)
    if base is None:
        return None
    seek = start_s - 0.0005
    source = ["-ss", f"{max(seek - base, 0.0):.6f}", "-i", video_input]
    maps = []
    if audio_input:
        audio_base = media_start_seconds(audio_input)
        if audio_base is None:
            return None
        source += ["-ss", f"{max(seek - audio_base, 0.0):.6f}", "-i", audio_input]
        maps = ["-map", "0:v:0", "-map", "1:a:0"]
    if pill is not None:
        source += ["-i", str(pill)]
        maps = ["-map", "[v]", "-map", "1:a:0" if audio_input else "0:a:0?"]
    return source + maps + ["-t", f"{span_s:.6f}"]


def encode_part(video_input: str, audio_input: str, start_s: float, span_s: float, target: Path, scratch: Path, preset: str, low_priority: bool, cancel, pill: Path | None = None) -> dict:
    source = part_source(video_input, audio_input, start_s, span_s, pill)
    if source is None:
        return {"ok": False, "error": "encode_failed"}
    video_filter = ["-vf", _SCALE_FILTER]
    if pill is not None:
        size = frame_size(video_input)
        if size is None:
            return {"ok": False, "error": "encode_failed"}
        pill_input = 2 if audio_input else 1
        scan = part_source(video_input, "", start_s, span_s)
        area = None
        if scan:
            area = picture_area(["-skip_frame", "nokey", *scan], size) or picture_area([*scan, "-frames:v", "1"], size)
        area = area or (0.0, 0.0, 1.0, 1.0)
        graph = _pill_graph(f"[0:v]{_SCALE_FILTER}", pill_input, _shared_size(*size), area, "yuv420")
        video_filter = ["-filter_complex", graph + "[v]"]

    video_kbps = int(TARGET_BYTES * 8 / span_s / 1000) - AUDIO_KBPS
    for kbps in (video_kbps, int(video_kbps * 0.85)):
        result = _two_pass(source, video_filter, target, scratch, kbps, preset, low_priority, cancel)
        if not result["ok"] or result["bytes"] <= CEILING_BYTES:
            return result
        decky.logger.warning(
            "memories: a share came out at %s bytes at %sk, trying again smaller",
            result["bytes"], kbps,
        )

    _discard(target)
    return {"ok": False, "error": "too_big"}


def _two_pass(source: list, video_filter: list, target: Path, scratch: Path, kbps: int, preset: str, low_priority: bool, cancel) -> dict:
    prefix = _priority_prefix(low_priority)
    passlog = str(scratch / "x264")
    shared = [
        *video_filter,
        "-c:v", "libx264",
        "-preset", preset,
        "-b:v", f"{kbps}k",
    ]
    first = prefix + [
        FFMPEG, "-y", "-v", "error", *source, *shared,
        "-pass", "1", "-passlogfile", passlog,
        "-an", "-f", "mp4", "/dev/null",
    ]
    second = prefix + [
        FFMPEG, "-y", "-v", "error", *source, *shared,
        "-pass", "2", "-passlogfile", passlog,
        "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k",
        "-movflags", "+faststart",
        str(target),
    ]

    for command in (first, second):
        code, stdout, stderr = subprocess_util.run_command(
            command, timeout=_ENCODE_TIMEOUT_SECONDS, cancel=cancel, as_data_owner=True
        )
        if cancel.is_set():
            _discard(target)
            return {"ok": False, "error": "cancelled"}
        if code != 0:
            decky.logger.warning(
                "memories: encoding a share failed (rc=%s): %s",
                code, f"{stdout}{stderr}".strip()[:300],
            )
            _discard(target)
            return {"ok": False, "error": "encode_failed"}

    size = _size(target)
    if size <= 0:
        decky.logger.warning("memories: the share encode came out empty")
        _discard(target)
        return {"ok": False, "error": "encode_failed"}
    return {"ok": True, "bytes": size}
