"""Turning one of Steam's saved clips into a memory: locate, measure, poster.

Local and synchronous, the same contract memories_capture works to. The caller
hands over the summary Steam's own notification carried and nothing here goes
near the network.

A clip is MPEG-DASH on disk rather than a video file: a session.mpd, an
init segment and three-second chunks, inside a bg_ or fg_ directory named after
the recording session it came out of. Nothing here ever writes a copy of the
video; the only file it produces is one still frame.
"""

import re
from pathlib import Path

import decky
import subprocess_util

from utils import chown_to_data_owner


FFMPEG = "/usr/bin/ffmpeg"
FFPROBE = "/usr/bin/ffprobe"

POSTER_QUALITY = 90

POSTER_CANDIDATE_FRAMES = 100

_PROBE_TIMEOUT_SECONDS = 20
_POSTER_TIMEOUT_SECONDS = 120

USERDATA_RELATIVE = ".local/share/Steam/userdata"

RECORDINGS_DIR_NAME = "gamerecordings"

_ID_SAFE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,120}$")

# xml.etree is not in Decky's bundled runtime, so the manifest is read the same
# way the RSS in news_service is.
_PERIOD_START_PATTERN = re.compile(r"<Period\b[^>]*?\bstart=\"([^\"]*)\"")
_PRESENTATION_PATTERN = re.compile(r"\bmediaPresentationDuration=\"([^\"]*)\"")
_ISO_DURATION_PATTERN = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?([\d.]+)S$")

_RECORD_PATH_PATTERN = re.compile(r'"BackgroundRecordPath"\s+"([^"]*)"')


def _iso_duration_ms(raw):
    """Milliseconds out of an ISO-8601 duration like ``PT25.619S``, or None."""
    match = _ISO_DURATION_PATTERN.match(str(raw or "").strip())
    if match is None:
        return None
    hours, minutes, seconds = match.groups()
    total = float(seconds) + int(minutes or 0) * 60 + int(hours or 0) * 3600
    return int(round(total * 1000))


def appid_from_game_id(game_id):
    """The shortcut appid packed into a clip's ``game_id``, or 0.

    Steam reports a clip's game as a 64-bit CGameID whose top half is the appid.
    A non-Steam shortcut keeps its full width here, unlike the instant-clip
    request path, so this is enough on its own to say which game was running.
    """
    try:
        packed = int(str(game_id).strip())
    except (TypeError, ValueError):
        return 0
    if packed <= 0:
        return 0
    return packed >> 32


def _configured_record_path(config: Path):
    try:
        text = config.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    match = _RECORD_PATH_PATTERN.search(text)
    if match is None:
        return None
    value = match.group(1).strip()
    return Path(value) if value else None


def recording_roots(home=None) -> list:
    """Every directory a clip could be sitting under.

    A user who moved their recordings has a path in their own localconfig, and
    both that and the default are returned: the setting can change after clips
    exist, which leaves some in each place.
    """
    base = Path(home) if home else Path.home()
    try:
        accounts = sorted(p for p in (base / USERDATA_RELATIVE).iterdir() if p.is_dir())
    except OSError:
        return []

    roots = []
    for account in accounts:
        override = _configured_record_path(account / "config" / "localconfig.vdf")
        if override is not None:
            roots.append(override)
        roots.append(account / RECORDINGS_DIR_NAME)
    return roots


def clip_dir(clip_id, home=None):
    """The directory Steam wrote this clip into, or None.

    Found by looking for it rather than by trusting one configured location, so
    clips made before the recording path was changed are still reachable.
    """
    if not isinstance(clip_id, str) or not _ID_SAFE_PATTERN.match(clip_id):
        return None
    for root in recording_roots(home):
        candidate = root / "clips" / clip_id
        try:
            if candidate.is_dir():
                return candidate
        except OSError:
            continue
    return None


def session_dir(clip_path: Path):
    """The bg_ or fg_ directory holding this clip's manifest and segments.

    Read off disk rather than rebuilt from the summary. A clip recorded on
    demand carries a start_timeline_id stamped seconds before its own session
    directory, so the name cannot be derived from it, and the loopback route
    the player uses answers 404 to a directory listing.
    """
    try:
        entries = sorted(p for p in (clip_path / "video").iterdir() if p.is_dir())
    except OSError:
        return None
    return entries[0] if entries else None


def manifest_timing(session_path: Path):
    """``(period_start_ms, presentation_ms)`` out of the clip's own manifest.

    Either value is None when the manifest does not carry it.
    """
    try:
        text = (session_path / "session.mpd").read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return (None, None)
    period = _PERIOD_START_PATTERN.search(text)
    presentation = _PRESENTATION_PATTERN.search(text)
    return (
        _iso_duration_ms(period.group(1)) if period else None,
        _iso_duration_ms(presentation.group(1)) if presentation else None,
    )


def in_point_ms(period_start_ms, start_offset_ms, duration_ms) -> int:
    """Where the clip begins, in the media's own milliseconds.

    ``start_offset_ms`` is an offset into the timeline the clip was cut from.
    That is the media clock for a clip taken out of a background session and is
    not for one recorded on demand, where it points well past the end of a file
    beginning at zero. The lead-in tells them apart: a fraction of a second
    means both clocks agree, anything longer than the clip means they do not.
    """
    period = max(int(period_start_ms or 0), 0)
    offset = max(int(start_offset_ms or 0), 0)
    span = max(int(duration_ms or 0), 0)
    lead_in = offset - period
    if 0 <= lead_in <= span:
        return offset
    return period


def poster_name(clip_id: str) -> str:
    """The poster's filename, built from the clip's own date and time."""
    parts = str(clip_id or "").split("_")
    stamp = "_".join(parts[-2:]) if len(parts) >= 3 else str(clip_id or "clip")
    return f"{stamp}.webp"


def segment_source(session_path: Path, stream: int = 0) -> str:
    """ffmpeg's ``concat:`` argument for one stream's init plus every segment.

    Read in place rather than through a temporary file: a long clip runs to
    hundreds of megabytes and /tmp here is a RAM disk. Returns an empty string
    when the session holds nothing for that stream.
    """
    init = session_path / f"init-stream{stream}.m4s"
    try:
        if not init.is_file():
            return ""
        chunks = sorted(session_path.glob(f"chunk-stream{stream}-*.m4s"))
    except OSError:
        return ""
    if not chunks:
        return ""
    return "concat:" + "|".join([str(init)] + [str(chunk) for chunk in chunks])


def _tools_available() -> bool:
    try:
        return Path(FFMPEG).is_file() and Path(FFPROBE).is_file()
    except OSError:
        return False


def _media_start_seconds(source: str):
    code, stdout, _stderr = subprocess_util.run_command([
        FFPROBE, "-v", "error",
        "-show_entries", "format=start_time",
        "-of", "csv=p=0",
        "-i", source,
    ], timeout=_PROBE_TIMEOUT_SECONDS)
    if code != 0:
        return None
    for line in stdout.splitlines():
        try:
            return float(line.strip())
        except ValueError:
            continue
    return None


def make_poster(session_path: Path, start_ms, duration_ms, destination: Path) -> bool:
    """Write one representative frame of a clip as a full-size WebP.

    Scores a hundred frames from inside the clip's own window and keeps the
    most representative, rather than taking the first: people start clipping on
    the black frame between cutscenes.

    Returns False when no frame landed. ffmpeg exits 0 after writing an empty
    file if the seek ran past the end, so the result is checked rather than the
    return code.
    """
    if not _tools_available():
        decky.logger.warning("memories: %s is missing, a clip cannot get a poster", FFMPEG)
        return False

    source = segment_source(session_path, 0)
    if not source:
        decky.logger.warning("memories: %s holds no video segments", session_path.name)
        return False

    # ffmpeg's -ss is measured from the container's own start time, and a clip
    # cut out of a background session carries that session's clock rather than
    # starting at zero. Seeking to the absolute figure runs off the end.
    base = _media_start_seconds(source)
    if base is None:
        decky.logger.warning("memories: couldn't read the timing of %s", session_path.name)
        return False

    seek = max((max(int(start_ms or 0), 0) / 1000.0) - base, 0.0)
    span = max(int(duration_ms or 0), 0) / 1000.0 or 1.0

    code, stdout, stderr = subprocess_util.run_command([
        FFMPEG, "-y", "-v", "error",
        "-ss", f"{seek:.3f}",
        "-t", f"{span:.3f}",
        "-i", source,
        "-vf", f"thumbnail={POSTER_CANDIDATE_FRAMES}",
        "-frames:v", "1",
        "-c:v", "libwebp",
        "-q:v", str(POSTER_QUALITY),
        str(destination),
    ], timeout=_POSTER_TIMEOUT_SECONDS)

    if code != 0:
        decky.logger.warning(
            "memories: the poster for %s failed (rc=%s): %s",
            session_path.name, code, f"{stdout}{stderr}".strip()[:300],
        )
        return False

    try:
        landed = destination.stat().st_size > 0
    except OSError:
        landed = False
    if not landed:
        decky.logger.warning("memories: the poster for %s came out empty", session_path.name)
        try:
            destination.unlink()
        except OSError:
            pass
        return False

    chown_to_data_owner(destination)
    return True
