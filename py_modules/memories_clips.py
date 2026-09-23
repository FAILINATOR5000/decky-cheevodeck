"""Turning one of Steam's saved clips into a memory: locate, measure, poster.

Local and synchronous, the same contract memories_capture works to. The caller
hands over the summary Steam's own notification carried and nothing here goes
near the network.

A clip is MPEG-DASH on disk rather than a video file: a session.mpd, an
init segment and three-second chunks, inside a bg_ or fg_ directory named after
the recording session it came out of. A copy is those same files, carried across
unchanged: no remux, no transcode, and the player reads the copy exactly the way
it reads Steam's.
"""

import json
import re
import shutil
import struct
from pathlib import Path

import decky
import subprocess_util

from utils import chown_to_data_owner, ensure_dir


FFMPEG = "/usr/bin/ffmpeg"
FFPROBE = "/usr/bin/ffprobe"

POSTER_QUALITY = 90

POSTER_CANDIDATE_FRAMES = 100

_PROBE_TIMEOUT_SECONDS = 20
_POSTER_TIMEOUT_SECONDS = 120

_REMUX_TIMEOUT_SECONDS = 300

CLIP_NAME = "clip.mp4"
CLIP_INDEX_NAME = "clip.json"

_FRAGMENT_MICROSECONDS = 1000000

_NON_SYNC_SAMPLE = 0x00010000

_TFHD_DEFAULT_BASE_IS_MOOF = 0x020000

USERDATA_RELATIVE = ".local/share/Steam/userdata"

RECORDINGS_DIR_NAME = "gamerecordings"

_ID_SAFE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,120}$")

# xml.etree is not in Decky's bundled runtime, so the manifest is read the same
# way the RSS in news_service is.
_PERIOD_START_PATTERN = re.compile(r"<Period\b[^>]*?\bstart=\"([^\"]*)\"")
_PRESENTATION_PATTERN = re.compile(r"\bmediaPresentationDuration=\"([^\"]*)\"")
_CODECS_PATTERN = re.compile(r"\bcodecs=\"([^\"]*)\"")
_ISO_DURATION_PATTERN = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?([\d.]+)S$")

_RECORD_PATH_PATTERN = re.compile(r'"BackgroundRecordPath"\s+"([^"]*)"')

_SEGMENT_NAME_PATTERN = re.compile(
    r"^(?:clip\.mp4|clip\.json|session\.mpd|init-stream\d{1,2}\.m4s|chunk-stream\d{1,2}-\d{1,9}\.m4s)$"
)


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


def in_point_ms(period_start_ms) -> int:
    """Where the clip begins, in the media's own milliseconds.

    The manifest's Period start, which is the only figure measured in the same
    clock as the segments. Steam writes it alongside a presentation duration
    equal to the clip's own length, so the two together describe exactly the
    footage that was cut.

    The summary's ``start_offset_ms`` looks like the same number and is not: it
    counts from the start of the timeline rather than the session, and the two
    begin within a second or so of each other. Measured 808 ms apart on one clip
    and 409 ms on another, which is the length of the opening that goes missing
    if it is used here.
    """
    return max(int(period_start_ms or 0), 0)


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


def _boxes(raw: bytes, start: int, end: int):
    """Walk one level of the MP4 box tree, yielding ``(offset, size, kind, body)``.

    Stops rather than raising on a length that cannot be right, so a truncated
    or unexpected file ends the walk instead of taking the caller down with it.
    """
    offset = start
    while offset + 8 <= end:
        size = struct.unpack_from(">I", raw, offset)[0]
        kind = raw[offset + 4:offset + 8].decode("latin-1")
        header = 8
        if size == 1:
            if offset + 16 > end:
                return
            size = struct.unpack_from(">Q", raw, offset + 8)[0]
            header = 16
        if size < header or offset + size > end:
            return
        yield (offset, size, kind, offset + header)
        offset += size


def _decode_time(raw: bytes, body: int) -> int:
    """The baseMediaDecodeTime out of a tfdt box, either width."""
    version = raw[body]
    if version == 1:
        return struct.unpack_from(">Q", raw, body + 4)[0]
    return struct.unpack_from(">I", raw, body + 4)[0]


def _opens_on_keyframe(raw: bytes, start: int, end: int) -> bool:
    """Whether a track fragment's first sample is one playback can start on.

    The flags can arrive in either of two places: trun carries them for the
    first sample when it wants to say something different from the default, and
    tfhd carries the default for everything else. Later wins, which is the order
    they appear in.
    """
    flags = None
    for _offset, _size, kind, body in _boxes(raw, start, end):
        if kind == "tfhd":
            present = struct.unpack_from(">I", raw, body)[0] & 0xFFFFFF
            cursor = body + 8
            for bit, width in ((0x000001, 8), (0x000002, 4), (0x000008, 4), (0x000010, 4)):
                if present & bit:
                    cursor += width
            if present & 0x000020:
                flags = struct.unpack_from(">I", raw, cursor)[0]
        elif kind == "trun":
            present = struct.unpack_from(">I", raw, body)[0] & 0xFFFFFF
            cursor = body + 8
            if present & 0x000001:
                cursor += 4
            if present & 0x000004:
                flags = struct.unpack_from(">I", raw, cursor)[0]
    return flags is not None and (flags & _NON_SYNC_SAMPLE) == 0


def _video_timescale(raw: bytes, moov: tuple) -> int:
    """The first track's timescale, which is the one the fragment times use."""
    offset, size, _kind, body = moov
    for toff, tsize, tkind, tbody in _boxes(raw, body, offset + size):
        if tkind != "trak":
            continue
        for moff, msize, mkind, mbody in _boxes(raw, tbody, toff + tsize):
            if mkind != "mdia":
                continue
            for _hoff, _hsize, hkind, hbody in _boxes(raw, mbody, moff + msize):
                if hkind == "mdhd":
                    version = raw[hbody]
                    return struct.unpack_from(">I", raw, hbody + (20 if version == 1 else 12))[0]
    return 0


def _top_level_boxes(handle, total: int):
    """Walk a file's outermost boxes, reading headers rather than contents.

    Yields ``(offset, size, kind, header length)``. A fragmented 4K recording
    runs to gigabytes, so nothing here holds more than sixteen bytes of it at a
    time and the caller reads only the boxes it actually needs.
    """
    offset = 0
    while offset + 8 <= total:
        handle.seek(offset)
        head = handle.read(8)
        if len(head) < 8:
            return
        size = struct.unpack(">I", head[:4])[0]
        kind = head[4:8].decode("latin-1")
        header = 8
        if size == 1:
            wide = handle.read(8)
            if len(wide) < 8:
                return
            size = struct.unpack(">Q", wide)[0]
            header = 16
        if size < header or offset + size > total:
            return
        yield (offset, size, kind, header)
        offset += size


def _read_box(handle, offset: int, size: int) -> bytes:
    handle.seek(offset)
    return handle.read(size)


def _moof_relative(raw: bytes, start: int, end: int) -> bool:
    """Whether a track fragment's samples are addressed from its own header."""
    for _offset, _size, kind, body in _boxes(raw, start, end):
        if kind == "tfhd":
            return bool(struct.unpack_from(">I", raw, body)[0] & _TFHD_DEFAULT_BASE_IS_MOOF)
    return False


def build_clip_index(path: Path, mime: str) -> dict:
    """Map a fragmented MP4's timeline onto its byte ranges.

    Returns the header length, where the media data stops, and one row per
    fragment of ``[start in ms, byte offset, opens on a keyframe]``. That is
    what lets the player ask for the second it wants instead of reading from the
    beginning, and what lets every range it asks for end on a fragment boundary
    so the decoder is never handed half of one.

    Only the headers are ever read. The moov and each moof are a few hundred
    bytes and the sample data between them is skipped over, so indexing a three
    gigabyte recording costs about as much as indexing a small one.

    A fragment whose header still carries an absolute offset into the file is
    rejected on arrival by the decoder, so that is checked here rather than
    discovered at playback: an index is only returned for a file whose fragments
    can be read one at a time.

    Returns an empty dict when the file is not shaped like one, which is the
    signal to keep the plain copy instead.
    """
    fragments = []
    relocatable = True
    with path.open("rb") as handle:
        total = handle.seek(0, 2)
        media_end = total
        init_bytes = 0
        timescale = 0

        for offset, size, kind, header in _top_level_boxes(handle, total):
            if kind == "moov":
                raw = _read_box(handle, offset, size)
                timescale = _video_timescale(raw, (0, size, kind, header))
                init_bytes = offset + size
                continue
            if kind == "mfra":
                media_end = min(media_end, offset)
                continue
            if kind != "moof":
                continue

            raw = _read_box(handle, offset, size)
            trafs = [box for box in _boxes(raw, header, size) if box[2] == "traf"]
            if not trafs:
                continue
            toff, tsize, _tkind, tbody = trafs[0]
            if not _moof_relative(raw, tbody, toff + tsize):
                relocatable = False
                break
            start = 0
            for _aoff, _asize, akind, abody in _boxes(raw, tbody, toff + tsize):
                if akind == "tfdt":
                    start = _decode_time(raw, abody)
            fragments.append([
                round(start * 1000 / timescale) if timescale > 0 else 0,
                offset,
                _opens_on_keyframe(raw, tbody, toff + tsize),
            ])

    if timescale <= 0 or init_bytes <= 0 or not fragments or not relocatable:
        if not relocatable:
            decky.logger.warning(
                "memories: %s addresses its samples from the start of the file, so it "
                "cannot be played a fragment at a time", path.name
            )
        return {}
    return {
        "mime": mime,
        "init": init_bytes,
        "mediaEnd": media_end,
        "size": total,
        "fragments": fragments,
    }


def media_start_ms(session_path: Path) -> int:
    """When the copied footage begins, in the clock the manifest's Period uses.

    A remux rebases its output to zero, so this is what the in-point has to be
    measured against afterwards. Read out of the first video chunk's own
    baseMediaDecodeTime rather than probed, which costs nothing.
    """
    try:
        chunks = sorted(session_path.glob("chunk-stream0-*.m4s"))
        if not chunks:
            return 0

        timescale = 0
        with (session_path / "init-stream0.m4s").open("rb") as handle:
            total = handle.seek(0, 2)
            for offset, size, kind, header in _top_level_boxes(handle, total):
                if kind == "moov":
                    raw = _read_box(handle, offset, size)
                    timescale = _video_timescale(raw, (0, size, kind, header))
                    break
        if timescale <= 0:
            return 0

        with chunks[0].open("rb") as handle:
            total = handle.seek(0, 2)
            for offset, size, kind, header in _top_level_boxes(handle, total):
                if kind != "moof":
                    continue
                raw = _read_box(handle, offset, size)
                for toff, tsize, tkind, tbody in _boxes(raw, header, size):
                    if tkind != "traf":
                        continue
                    for _aoff, _asize, akind, abody in _boxes(raw, tbody, toff + tsize):
                        if akind == "tfdt":
                            return round(_decode_time(raw, abody) * 1000 / timescale)
    except OSError:
        return 0
    return 0


def manifest_mime(session_path: Path) -> str:
    """The MSE type string for a clip, built from what the manifest declares.

    Both tracks land in one file after a remux, so they are named in one string
    and the player opens a single SourceBuffer for the pair.
    """
    try:
        text = (session_path / "session.mpd").read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    codecs = _CODECS_PATTERN.findall(text)
    if not codecs:
        return ""
    return 'video/mp4; codecs="' + ",".join(codecs) + '"'


def remux_session(session_path: Path, destination: Path) -> dict:
    """Rewrite one clip's segments as a single fragmented MP4 with an index.

    Returns ``{"ok", "bytes", "mediaStartMs"}``. The audio and video are passed
    through untouched, frame for frame: the work is rewriting box headers, which
    runs at about a gigabyte a second and cannot change a pixel or a sample.

    What it buys is addressing. Steam writes three-second segments, and reading
    one costs half a second at 2160p60 before anything can be shown; the output
    carries a fragment per second and an index saying where each one starts, so
    playback asks for the part it needs.

    Every failure leaves nothing behind and returns not ok, and the caller falls
    back to copying the segments as they are.
    """
    if not _tools_available():
        return {"ok": False, "bytes": 0, "mediaStartMs": 0}

    video = segment_source(session_path, 0)
    audio = segment_source(session_path, 1)
    mime = manifest_mime(session_path)
    if not video or not mime:
        return {"ok": False, "bytes": 0, "mediaStartMs": 0}

    target = destination / CLIP_NAME
    command = [FFMPEG, "-y", "-v", "error", "-copyts", "-i", video]
    if audio:
        command += ["-i", audio, "-map", "0:v:0", "-map", "1:a:0"]
    command += [
        "-c", "copy",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-frag_duration", str(_FRAGMENT_MICROSECONDS),
        str(target),
    ]

    try:
        ensure_dir(destination)
        code, stdout, stderr = subprocess_util.run_command(
            command, timeout=_REMUX_TIMEOUT_SECONDS
        )
    except OSError as e:
        decky.logger.warning("memories: the remux could not run (%s)", type(e).__name__)
        return {"ok": False, "bytes": 0, "mediaStartMs": 0}

    if code != 0:
        decky.logger.warning(
            "memories: remuxing %s failed (rc=%s): %s",
            session_path.name, code, f"{stdout}{stderr}".strip()[:300],
        )
        _discard_remux(destination)
        return {"ok": False, "bytes": 0, "mediaStartMs": 0}

    try:
        index = build_clip_index(target, mime)
    except (OSError, struct.error, IndexError) as e:
        decky.logger.warning("memories: the remux could not be indexed (%s)", type(e).__name__)
        index = {}
    if not index:
        _discard_remux(destination)
        return {"ok": False, "bytes": 0, "mediaStartMs": 0}

    try:
        (destination / CLIP_INDEX_NAME).write_text(
            json.dumps(index, separators=(",", ":")), encoding="utf-8"
        )
        chown_to_data_owner(destination / CLIP_INDEX_NAME)
        chown_to_data_owner(target)
    except OSError as e:
        decky.logger.warning("memories: the clip index could not be written (%s)", type(e).__name__)
        _discard_remux(destination)
        return {"ok": False, "bytes": 0, "mediaStartMs": 0}

    decky.logger.info(
        "memories: remuxed %s into %s fragments, %s MB",
        session_path.name, len(index["fragments"]), round(index["size"] / (1024 * 1024), 1),
    )
    return {"ok": True, "bytes": index["size"], "mediaStartMs": media_start_ms(session_path)}


def trim_clip(video: str, audio: str, target: Path, start_seconds: float, span_seconds: float) -> dict:
    if not _tools_available() or not video or span_seconds <= 0:
        return {"ok": False, "bytes": 0}

    # -ss is measured from the container's own start time, and a clip cut out
    # of a background session carries that session's clock rather than starting
    # at zero. Each input is measured on its own so the two stay in step.
    base = _media_start_seconds(video)
    if base is None:
        return {"ok": False, "bytes": 0}

    command = [FFMPEG, "-y", "-v", "error"]
    command += ["-noaccurate_seek", "-ss", f"{max(start_seconds - base, 0.0):.3f}", "-i", video]
    if audio:
        audio_base = _media_start_seconds(audio)
        if audio_base is None:
            return {"ok": False, "bytes": 0}
        command += [
            "-noaccurate_seek", "-ss", f"{max(start_seconds - audio_base, 0.0):.3f}", "-i", audio,
            "-map", "0:v:0", "-map", "1:a:0",
        ]
    command += [
        "-t", f"{span_seconds:.3f}",
        "-c", "copy",
        "-movflags", "+faststart",
        str(target),
    ]

    try:
        ensure_dir(target.parent)
        code, stdout, stderr = subprocess_util.run_command(
            command, timeout=_REMUX_TIMEOUT_SECONDS
        )
    except OSError as e:
        decky.logger.warning("memories: the snippet could not be cut (%s)", type(e).__name__)
        return {"ok": False, "bytes": 0}

    if code != 0:
        decky.logger.warning(
            "memories: cutting a snippet failed (rc=%s): %s",
            code, f"{stdout}{stderr}".strip()[:300],
        )
        _discard_file(target)
        return {"ok": False, "bytes": 0}

    try:
        written = target.stat().st_size
    except OSError:
        written = 0
    if written <= 0:
        decky.logger.warning("memories: the snippet came out empty")
        _discard_file(target)
        return {"ok": False, "bytes": 0}

    chown_to_data_owner(target)
    return {"ok": True, "bytes": written}


def _discard_file(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


def _discard_remux(destination: Path) -> None:
    """Remove a half-made remux so the fallback copy starts from nothing."""
    for name in (CLIP_NAME, CLIP_INDEX_NAME):
        try:
            (destination / name).unlink()
        except OSError:
            pass


def session_files(session_path: Path) -> list:
    """Every file that makes up one clip: the manifest, the inits, the chunks.

    Sorted, so a copy and a verify walk them in the same order. Returns an empty
    list when the manifest is missing, which is the one file the player cannot
    do without.
    """
    try:
        if not (session_path / "session.mpd").is_file():
            return []
        found = [p for p in session_path.iterdir() if p.is_file() and p.suffix in (".mpd", ".m4s")]
    except OSError:
        return []
    return sorted(found, key=lambda p: p.name)


def copy_session(session_path: Path, destination: Path) -> dict:
    """Copy one clip's manifest and segments into ``destination``.

    Returns ``{"ok", "bytes", "files"}``. A partial copy is removed before
    returning, so the destination either holds a whole clip or nothing: a
    half-copied session plays for a few seconds and then stops, which reads as a
    corrupt memory rather than a failed copy.

    Every file is compared by size afterwards. That catches a full disk, which
    is the failure this actually has to survive, and it is what the caller must
    see succeed before it is allowed to touch Steam's own copy.
    """
    sources = session_files(session_path)
    if not sources:
        decky.logger.warning("memories: %s holds no clip files to copy", session_path.name)
        return {"ok": False, "bytes": 0, "files": 0}

    copied = 0
    total = 0
    try:
        ensure_dir(destination)
        for source in sources:
            target = destination / source.name
            shutil.copyfile(source, target)
            chown_to_data_owner(target)
            size = source.stat().st_size
            if target.stat().st_size != size:
                raise OSError(f"{source.name} came out short")
            copied += 1
            total += size
    except OSError as e:
        decky.logger.error(
            "memories: copying %s failed after %s of %s files (%s)",
            session_path.name, copied, len(sources), type(e).__name__,
        )
        discard_copy(destination)
        return {"ok": False, "bytes": 0, "files": 0}

    return {"ok": True, "bytes": total, "files": copied}


def discard_copy(destination: Path) -> None:
    """Remove a copy directory and whatever is in it, best effort."""
    try:
        shutil.rmtree(destination)
    except OSError:
        pass


def is_segment_name(name) -> bool:
    """Whether ``name`` is one of the files a clip directory legitimately holds."""
    return isinstance(name, str) and bool(_SEGMENT_NAME_PATTERN.match(name))


def tools_available() -> bool:
    """Whether the ffmpeg and ffprobe this module shells out to are installed."""
    return _tools_available()


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
