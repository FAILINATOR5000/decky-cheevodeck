import json
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


def part_source(video_input: str, audio_input: str, start_s: float, span_s: float):
    base = media_start_seconds(video_input)
    if base is None:
        return None
    seek = start_s - 0.0005
    source = ["-ss", f"{max(seek - base, 0.0):.6f}", "-i", video_input]
    if audio_input:
        audio_base = media_start_seconds(audio_input)
        if audio_base is None:
            return None
        source += [
            "-ss", f"{max(seek - audio_base, 0.0):.6f}", "-i", audio_input,
            "-map", "0:v:0", "-map", "1:a:0",
        ]
    return source + ["-t", f"{span_s:.6f}"]


def encode_part(video_input: str, audio_input: str, start_s: float, span_s: float, target: Path, scratch: Path, preset: str, low_priority: bool, cancel) -> dict:
    source = part_source(video_input, audio_input, start_s, span_s)
    if source is None:
        return {"ok": False, "error": "encode_failed"}

    video_kbps = int(TARGET_BYTES * 8 / span_s / 1000) - AUDIO_KBPS
    for kbps in (video_kbps, int(video_kbps * 0.85)):
        result = _two_pass(source, target, scratch, kbps, preset, low_priority, cancel)
        if not result["ok"] or result["bytes"] <= CEILING_BYTES:
            return result
        decky.logger.warning(
            "memories: a share came out at %s bytes at %sk, trying again smaller",
            result["bytes"], kbps,
        )

    _discard(target)
    return {"ok": False, "error": "too_big"}


def _two_pass(source: list, target: Path, scratch: Path, kbps: int, preset: str, low_priority: bool, cancel) -> dict:
    prefix = _priority_prefix(low_priority)
    passlog = str(scratch / "x264")
    shared = [
        "-vf", _SCALE_FILTER,
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
