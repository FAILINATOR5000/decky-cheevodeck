import { toaster } from "@decky/api";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
    cancelMemoryShare,
    markNextValidationSkipped,
    prepareMemoryShare,
    probeMemoryShare,
    saveMemoriesMuted
} from "../../api";
import { BrowserViewHost } from "../browser/browserViewHost";
import { startDiscordShare } from "../browser/discordShare";
import { FadeImage } from "../ui/FadeImage";
import { InlineSpinner } from "../ui/InlineSpinner";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { ToggleRow } from "../ui/ToggleRow";
import { clipSourceFor, playClip, type ClipPlayback, type ClipPlaybackState } from "./clipPlayer";
import { getClipMuted, setClipMuted, useClipMuted } from "./clipMute";
import { watchRightStick } from "./rightStick";
import { SharePartBar } from "./SharePartBar";
import { transportLabel } from "./transportLabel";
import { consoleForumTag } from "../../utils/consoles";
import { logError } from "../../utils/errors";
import {
    BUTTON_BUMPER_LEFT,
    BUTTON_BUMPER_RIGHT,
    BUTTON_SELECT,
    BUTTON_TRIGGER_LEFT,
    BUTTON_TRIGGER_RIGHT
} from "../../utils/gamepadButtons";
import { formatClipLength } from "../../utils/memories";
import { getDeviceIsSteamMachine, modalSize } from "../../utils/scale";
import {
    DISCORD_MESSAGE_MAX,
    MAX_SHARE_MEMORY_TAGS,
    shareCreditLine,
    shareMessage,
    sharePostTitle
} from "../../utils/sharedMemories";
import { compactButtonStyle, FADE_IN_KEYFRAMES, warnAmber } from "../../utils/style";
import { MEMORY_TAG_SEEDS } from "../../utils/tags";
import { t, type LanguageCode } from "../../locales";
import type { MemoryRecord, ShortcutButton } from "../../types";

const MAX_PART_SECONDS = 30;

const MIN_PART_SECONDS = 1;

const VIDEO_FADE_MS = 250;

const STICK_STEP_SECONDS = 1;

const TALL_SCREEN_PX = 760;
const TALL_SCREEN_VIDEO_VH = 60;

const PIN_NOTICE_MS = 7000;

const KEYFRAME_TOLERANCE_SECONDS = 0.1;
const KEYFRAME_ROUNDING_SECONDS = 0.002;

const SHARE_CLIP_CSS = `
.cheevo-share-clip.DialogContent, .cheevo-share-clip {
    width: min(86vw, 1100px);
    max-width: min(86vw, 1100px);
}
`;

const VIDEO_LAYER_STYLE: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block"
};

export type ShareRange = { start: number; end: number };

function defaultShareRange(memory: MemoryRecord): ShareRange | undefined {
    const video = memory.video;
    if (!video) {
        return undefined;
    }
    const start = video.startMs / 1000;
    return { start, end: Math.min(start + video.durationMs / 1000, start + MAX_PART_SECONDS) };
}

export type MemoryShareModalProps = {
    memory: MemoryRecord;
    gameId: number;
    language: LanguageCode;
    thumbDataUri: string | null;
    mouseKeyboardMode: boolean;
    range?: ShareRange;
    onHandOff?: () => void;
    close: () => void;
};

type Probe = { username: string; consoleName: string; originalUpTo: number };

export function MemoryShareModal(props: MemoryShareModalProps) {
    const { memory, gameId, language, thumbDataUri, mouseKeyboardMode, onHandOff, close } = props;
    const video = memory.video && (memory.video.clipId || memory.video.path) ? memory.video : null;
    const clipStart = video ? video.startMs / 1000 : 0;
    const clipEnd = video ? clipStart + video.durationMs / 1000 : 0;
    const clip = useMemo(() => clipSourceFor(memory), []);

    const [opening] = useState(() => {
        const asked = props.range ?? defaultShareRange(memory);
        if (!asked) {
            return { start: 0, end: 0 };
        }
        const start = Math.min(Math.max(asked.start, clipStart), Math.max(clipEnd - MIN_PART_SECONDS, clipStart));
        const end = Math.min(asked.end, clipEnd, start + MAX_PART_SECONDS);
        return { start, end: end - start < MIN_PART_SECONDS ? Math.min(start + MAX_PART_SECONDS, clipEnd) : end };
    });

    const [probe, setProbe] = useState<Probe | null>(null);
    const [caption, setCaption] = useState((memory.caption ?? "").slice(0, DISCORD_MESSAGE_MAX));
    const [credit, setCredit] = useState(true);
    const [memoryTags, setMemoryTags] = useState<string[]>(() => {
        const own = (memory.tag ?? "").trim().toLowerCase();
        const seed = MEMORY_TAG_SEEDS.find((row) => row.tag.toLowerCase() === own);
        return seed ? [seed.tag] : [];
    });
    const [preparing, setPreparing] = useState(false);
    const [previewFocused, setPreviewFocused] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [green, setGreen] = useState(opening.start);
    const [red, setRed] = useState(opening.end);
    const [clipState, setClipState] = useState<ClipPlaybackState | null>(null);
    const [keyframes, setKeyframes] = useState<number[]>([]);
    const [revealed, setRevealed] = useState(false);
    const [fadeDone, setFadeDone] = useState(false);
    const [videoRatio, setVideoRatio] = useState(0);
    const [tallScreen, setTallScreen] = useState(false);
    const muted = useClipMuted();
    const closedRef = useRef(false);
    const preparingRef = useRef(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const playbackRef = useRef<ClipPlayback | null>(null);
    const landedRef = useRef(false);
    const previewFrameRef = useRef<number | null>(null);
    const stopStickRef = useRef<(() => void) | null>(null);
    const [pinNotice, setPinNotice] = useState<string | null>(null);
    const pinNoticeTimerRef = useRef<number | null>(null);

    useEffect(() => () => {
        if (!closedRef.current && preparingRef.current) {
            void cancelMemoryShare();
        }
        closedRef.current = true;
        stopStickRef.current?.();
        stopStickRef.current = null;
    }, []);

    useEffect(() => {
        let live = true;
        probeMemoryShare(gameId, memory.id)
            .then((result) => {
                if (live) {
                    setProbe({
                        username: String(result?.username ?? ""),
                        consoleName: String(result?.consoleName ?? ""),
                        originalUpTo: Number(result?.originalUpTo ?? 0)
                    });
                }
            })
            .catch((e) => {
                logError("memories: couldn't look a memory over for sharing", e);
                if (live) {
                    setProbe({ username: "", consoleName: "", originalUpTo: 0 });
                }
            });
        return () => {
            live = false;
        };
    }, [gameId, memory.id]);

    useEffect(() => {
        if (!preparing) {
            return;
        }
        const started = Date.now();
        setElapsed(0);
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, [preparing]);

    useLayoutEffect(() => {
        const height = videoRef.current?.ownerDocument?.defaultView?.innerHeight ?? 0;
        setTallScreen(height >= TALL_SCREEN_PX);
    }, []);

    useEffect(() => {
        const element = videoRef.current;
        if (!clip || !element) {
            return;
        }
        element.muted = true;
        const onMetadata = () => {
            if (element.videoWidth > 0 && element.videoHeight > 0) {
                setVideoRatio(element.videoWidth / element.videoHeight);
            }
        };
        element.addEventListener("loadedmetadata", onMetadata);
        const handle = playClip(element, clip);
        playbackRef.current = handle;
        let revealTimer: number | null = null;
        const reveal = () => {
            if (revealTimer !== null) {
                window.clearTimeout(revealTimer);
                revealTimer = null;
            }
            element.removeEventListener("seeked", reveal);
            setRevealed(true);
        };
        const unsubscribe = handle.subscribe((next) => {
            if (!landedRef.current && !next.paused) {
                landedRef.current = true;
                element.addEventListener("seeked", reveal);
                revealTimer = window.setTimeout(reveal, 1500);
                handle.togglePause();
                handle.seekTo(opening.start);
                element.muted = getClipMuted();
                return;
            }
            setClipState(next);
            setKeyframes((current) => (current.length > 0 ? current : handle.keyframeTimes()));
        });
        return () => {
            element.removeEventListener("loadedmetadata", onMetadata);
            if (revealTimer !== null) {
                window.clearTimeout(revealTimer);
            }
            element.removeEventListener("seeked", reveal);
            stopPreview();
            unsubscribe();
            handle.destroy();
            playbackRef.current = null;
        };
    }, [clip]);

    useEffect(() => {
        const element = videoRef.current;
        if (element && landedRef.current) {
            element.muted = muted;
        }
    }, [muted]);

    useEffect(() => () => {
        if (pinNoticeTimerRef.current !== null) {
            window.clearTimeout(pinNoticeTimerRef.current);
        }
    }, []);

    const username = probe?.username ?? "";
    const captionMax = DISCORD_MESSAGE_MAX - (credit && username ? shareCreditLine(username).length + 1 : 0);
    const systemTag = consoleForumTag(probe?.consoleName ?? "");
    const mediaTag = video ? "Clip" : "Screenshot";

    const partStart = green;
    const partEnd = red;

    const originalQuality = Boolean(probe)
        && partEnd - partStart <= (probe?.originalUpTo ?? 0)
        && keyframes.some((keyframe) => {
            const lead = partStart - keyframe;
            return lead >= -KEYFRAME_ROUNDING_SECONDS && lead <= KEYFRAME_TOLERANCE_SECONDS;
        });

    function toggleCredit(next: boolean) {
        setCredit(next);
        if (next && username) {
            setCaption((current) => current.slice(0, DISCORD_MESSAGE_MAX - shareCreditLine(username).length - 1));
        }
    }

    function toggleTag(tag: string) {
        setMemoryTags((current) => {
            if (current.includes(tag)) {
                return current.filter((entry) => entry !== tag);
            }
            return current.length < MAX_SHARE_MEMORY_TAGS ? [...current, tag] : current;
        });
    }

    function frameOnScreen(): number | null {
        const element = videoRef.current;
        if (!element || !landedRef.current) {
            return null;
        }
        return element.currentTime;
    }

    function showPinNotice(key: string | null) {
        if (pinNoticeTimerRef.current !== null) {
            window.clearTimeout(pinNoticeTimerRef.current);
            pinNoticeTimerRef.current = null;
        }
        setPinNotice(key);
        if (key) {
            pinNoticeTimerRef.current = window.setTimeout(() => {
                pinNoticeTimerRef.current = null;
                setPinNotice(null);
            }, PIN_NOTICE_MS);
        }
    }

    function pinStart() {
        const at = frameOnScreen();
        if (at === null || preparing) {
            return;
        }
        stopPreview();
        const next = Math.min(Math.max(at, clipStart), Math.max(clipEnd - MIN_PART_SECONDS, clipStart));
        if (red - next > MAX_PART_SECONDS) {
            setRed(next + MAX_PART_SECONDS);
            showPinNotice("share_end_moved_max");
        }
        else if (red - next < MIN_PART_SECONDS) {
            setRed(Math.min(next + MAX_PART_SECONDS, clipEnd));
            showPinNotice("share_end_moved_order");
        }
        else {
            showPinNotice(null);
        }
        setGreen(next);
    }

    function pinEnd() {
        const at = frameOnScreen();
        if (at === null || preparing) {
            return;
        }
        stopPreview();
        const next = Math.max(Math.min(at, clipEnd), Math.min(clipStart + MIN_PART_SECONDS, clipEnd));
        if (next - green > MAX_PART_SECONDS) {
            setGreen(next - MAX_PART_SECONDS);
            showPinNotice("share_start_moved_max");
        }
        else if (next - green < MIN_PART_SECONDS) {
            setGreen(Math.max(next - MAX_PART_SECONDS, clipStart));
            showPinNotice("share_start_moved_order");
        }
        else {
            showPinNotice(null);
        }
        setRed(next);
    }

    function stopPreview() {
        const element = videoRef.current;
        const win = element?.ownerDocument?.defaultView;
        if (previewFrameRef.current !== null && win) {
            win.cancelAnimationFrame(previewFrameRef.current);
        }
        previewFrameRef.current = null;
    }

    function playPreview() {
        const handle = playbackRef.current;
        const element = videoRef.current;
        const win = element?.ownerDocument?.defaultView;
        if (!handle || !element || !win || preparing || !landedRef.current) {
            return;
        }
        stopPreview();
        const stopAt = partEnd;
        handle.seekTo(partStart);
        if (element.paused) {
            handle.togglePause();
        }
        const watch = () => {
            if (element.paused) {
                previewFrameRef.current = null;
                return;
            }
            if (element.ended || element.currentTime >= stopAt) {
                previewFrameRef.current = null;
                if (!element.paused) {
                    handle.togglePause();
                }
                return;
            }
            previewFrameRef.current = win.requestAnimationFrame(watch);
        };
        previewFrameRef.current = win.requestAnimationFrame(watch);
    }

    function pressPlay() {
        if (preparing || !landedRef.current) {
            return;
        }
        stopPreview();
        playbackRef.current?.togglePause();
    }

    function stickStep(direction: 1 | -1) {
        const element = videoRef.current;
        if (preparingRef.current || !landedRef.current || !element) {
            return;
        }
        stopPreview();
        playbackRef.current?.seekTo(element.currentTime + direction * STICK_STEP_SECONDS);
    }

    function watchStick(on: boolean) {
        stopStickRef.current?.();
        stopStickRef.current = on ? watchRightStick(stickStep) : null;
    }

    function skip(direction: 1 | -1): boolean {
        if (!preparing && landedRef.current) {
            stopPreview();
            playbackRef.current?.skip(direction);
        }
        return true;
    }

    function seekBar(mediaTime: number) {
        if (preparing || !landedRef.current) {
            return;
        }
        stopPreview();
        playbackRef.current?.seekTo(mediaTime);
    }

    function pressMute() {
        const next = !getClipMuted();
        setClipMuted(next);
        void saveMemoriesMuted(next).catch((e) => {
            logError("memories: couldn't save the clip mute setting", e);
        });
    }

    function finish() {
        closedRef.current = true;
        markNextValidationSkipped();
        close();
    }

    function leave() {
        if (preparing) {
            void cancelMemoryShare();
        }
        finish();
    }

    async function post() {
        if (preparing || !probe) {
            return;
        }
        if (!BrowserViewHost.isAvailable()) {
            toaster.toast({
                title: t(language, "Shared Memories"),
                body: t(language, "Sharing needs CheevoDeck's web browser, which isn't available right now.")
            });
            return;
        }
        stopPreview();
        const element = videoRef.current;
        if (element && !element.paused) {
            playbackRef.current?.togglePause();
        }
        setPreparing(true);
        preparingRef.current = true;
        try {
            const result = await prepareMemoryShare(gameId, memory.id, partStart, partEnd);
            preparingRef.current = false;
            if (closedRef.current) {
                return;
            }
            setPreparing(false);
            if (!result?.ok || !result.path) {
                if (result?.error !== "cancelled") {
                    toaster.toast({
                        title: t(language, "Shared Memories"),
                        body: result?.error === "no_source"
                            ? t(language, "This memory's file is missing.")
                            : t(language, "Couldn't prepare this memory for sharing.")
                    });
                }
                return;
            }
            const filePath = result.path;
            finish();
            onHandOff?.();
            startDiscordShare(language, {
                filePath,
                title: sharePostTitle(memory.gameTitle, probe.consoleName),
                message: shareMessage(caption, username, credit),
                tags: [systemTag, mediaTag, ...memoryTags]
            });
        }
        catch (e) {
            preparingRef.current = false;
            logError("memories: couldn't prepare a share", e);
            if (!closedRef.current) {
                setPreparing(false);
            }
        }
    }

    const playing = Boolean(clipState && !clipState.paused);

    const playerButtons = useMemo(() => {
        const map: Record<number, ReactNode> = {
            [BUTTON_BUMPER_LEFT]: t(language, "Set Start"),
            [BUTTON_BUMPER_RIGHT]: t(language, "Set End"),
            [BUTTON_SELECT]: muted
                ? transportLabel(language, "Unmute", "♪")
                : transportLabel(language, "Mute", "⊘")
        };
        return map;
    }, [muted, language]);

    const playAction = useMemo(
        () => (playing
            ? transportLabel(language, "Pause", "‖")
            : transportLabel(language, "Play", "▶")),
        [playing, language]
    );

    const reservedButtons = clip ? (["view"] as ShortcutButton[]) : undefined;

    const labelStyle = { fontSize: `${modalSize(13)}px`, opacity: 0.8, marginBottom: "4px" };
    const title = probe ? sharePostTitle(memory.gameTitle, probe.consoleName) : memory.gameTitle;
    const titleStyle: CSSProperties = {
        minWidth: 0,
        fontSize: `${modalSize(14)}px`,
        fontWeight: 700,
        wordBreak: "break-word",
        visibility: probe ? "visible" : "hidden"
    };
    const videoMaxVh = tallScreen ? TALL_SCREEN_VIDEO_VH : getDeviceIsSteamMachine() ? 50 : 46;

    return (
        <ModalRoot onCancel={leave} onEscKeypress={leave} className={clip ? "cheevo-share-clip" : undefined}>
            <Focusable
                flow-children="column"
                onButtonDown={clip
                    ? (event: { detail?: { button?: number; is_repeat?: boolean } }) => {
                        if (!event?.detail?.is_repeat && event?.detail?.button === BUTTON_SELECT) {
                            pressMute();
                        }
                    }
                    : undefined}
                onButtonUp={clip
                    ? (event: { detail?: { button?: number } }) => {
                        const button = event?.detail?.button;
                        if (button === BUTTON_TRIGGER_LEFT || button === BUTTON_TRIGGER_RIGHT) {
                            playbackRef.current?.endSeek();
                        }
                    }
                    : undefined}
            >
                <SnapshotHotkey language={language} reservedButtons={reservedButtons} />
                {clip ? <style>{SHARE_CLIP_CSS + FADE_IN_KEYFRAMES}</style> : null}
                <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "12px" }}>
                    {t(language, "Share Memory")}
                </div>

                {clip ? (
                    <>
                        <Focusable
                            focusable
                            noFocusRing
                            onGamepadFocus={() => {
                                setPreviewFocused(true);
                                watchStick(true);
                            }}
                            onGamepadBlur={() => {
                                setPreviewFocused(false);
                                watchStick(false);
                            }}
                            onActivate={pressPlay}
                            onOKActionDescription={playAction}
                            onOptionsButton={playPreview}
                            onOptionsActionDescription={t(language, "Preview")}
                            onMoveLeft={() => skip(-1)}
                            onMoveRight={() => skip(1)}
                            onButtonDown={(event: { detail?: { button?: number; is_repeat?: boolean } }) => {
                                if (event?.detail?.is_repeat || preparing || !landedRef.current) {
                                    return;
                                }
                                const button = event?.detail?.button;
                                if (button === BUTTON_BUMPER_LEFT) {
                                    pinStart();
                                    return;
                                }
                                if (button === BUTTON_BUMPER_RIGHT) {
                                    pinEnd();
                                    return;
                                }
                                if (button === BUTTON_TRIGGER_LEFT || button === BUTTON_TRIGGER_RIGHT) {
                                    stopPreview();
                                    playbackRef.current?.beginSeek(button === BUTTON_TRIGGER_RIGHT ? 1 : -1);
                                }
                            }}
                            actionDescriptionMap={playerButtons}
                            style={{
                                display: "block",
                                marginBottom: "6px",
                                padding: "4px",
                                borderRadius: "6px",
                                boxShadow: previewFocused ? "0 0 0 2px rgba(255, 255, 255, 0.55)" : undefined
                            }}
                        >
                            <div
                                style={{
                                    position: "relative",
                                    width: "100%",
                                    aspectRatio: "16 / 9",
                                    maxHeight: `${videoMaxVh}vh`,
                                    background: "rgba(255, 255, 255, 0.06)",
                                    borderRadius: "6px",
                                    overflow: "hidden"
                                }}
                            >
                                <video
                                    ref={videoRef}
                                    playsInline
                                    className={revealed && !fadeDone ? "da-fade-image" : undefined}
                                    onAnimationEnd={(event) => {
                                        if (event.animationName === "da-fade-in") {
                                            setFadeDone(true);
                                        }
                                    }}
                                    style={{
                                        ...VIDEO_LAYER_STYLE,
                                        opacity: revealed ? 1 : 0,
                                        animation: revealed && !fadeDone
                                            ? `da-fade-in ${VIDEO_FADE_MS}ms ease-out`
                                            : undefined
                                    }}
                                />
                                {revealed ? (
                                    <div
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            pointerEvents: "none"
                                        }}
                                    >
                                        <div
                                            style={{
                                                position: "relative",
                                                width: videoRatio > 0 ? "auto" : "100%",
                                                height: "100%",
                                                aspectRatio: videoRatio > 0 ? `${videoRatio}` : undefined,
                                                maxWidth: "100%",
                                                maxHeight: "100%"
                                            }}
                                        >
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    bottom: `${modalSize(6)}px`,
                                                    right: `${modalSize(6)}px`,
                                                    padding: `${modalSize(1)}px ${modalSize(5)}px`,
                                                    borderRadius: "3px",
                                                    background: "rgba(0, 0, 0, 0.35)",
                                                    color: "rgba(255, 255, 255, 0.88)",
                                                    fontSize: `${modalSize(12)}px`,
                                                    fontWeight: 600,
                                                    fontVariantNumeric: "tabular-nums",
                                                    animation: !fadeDone
                                                        ? `da-fade-in ${VIDEO_FADE_MS}ms ease-out`
                                                        : undefined
                                                }}
                                            >
                                                {`${formatClipLength(Math.floor(clipState?.position ?? 0))} / ${formatClipLength(clipEnd - clipStart)}`}
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                            <SharePartBar
                                clipStart={clipStart}
                                clipEnd={clipEnd}
                                playhead={clipState?.mediaTime ?? opening.start}
                                green={green}
                                red={red}
                                onSeek={mouseKeyboardMode ? seekBar : undefined}
                            />
                            <div
                                style={{
                                    fontSize: `${modalSize(12)}px`,
                                    lineHeight: `${modalSize(12) + 4}px`,
                                    minHeight: `${modalSize(12) + 4}px`,
                                    marginTop: "2px",
                                    color: pinNotice ? warnAmber : undefined,
                                    opacity: pinNotice ? 1 : 0.75
                                }}
                            >
                                {pinNotice
                                    ? t(language, pinNotice)
                                    : originalQuality ? t(language, "Original quality") : "\u00a0"}
                            </div>
                        </Focusable>
                        {mouseKeyboardMode ? (
                            <Focusable
                                flow-children="grid"
                                style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}
                            >
                                <div>
                                    <DialogButton style={compactButtonStyle} disabled={preparing} onClick={pressPlay}>
                                        {t(language, playing ? "Pause" : "Play")}
                                    </DialogButton>
                                </div>
                                <div>
                                    <DialogButton style={compactButtonStyle} disabled={preparing} onClick={pinStart}>
                                        {t(language, "Set Start")}
                                    </DialogButton>
                                </div>
                                <div>
                                    <DialogButton style={compactButtonStyle} disabled={preparing} onClick={pinEnd}>
                                        {t(language, "Set End")}
                                    </DialogButton>
                                </div>
                                <div>
                                    <DialogButton style={compactButtonStyle} disabled={preparing} onClick={playPreview}>
                                        {t(language, "Preview")}
                                    </DialogButton>
                                </div>
                                <div>
                                    <DialogButton style={compactButtonStyle} onClick={pressMute}>
                                        {t(language, muted ? "Unmute" : "Mute")}
                                    </DialogButton>
                                </div>
                            </Focusable>
                        ) : null}
                        <div style={{ ...titleStyle, marginBottom: "10px" }}>{title}</div>
                    </>
                ) : (
                    <Focusable
                        focusable
                        noFocusRing
                        onGamepadFocus={() => setPreviewFocused(true)}
                        onGamepadBlur={() => setPreviewFocused(false)}
                        style={{
                            display: "flex",
                            gap: "12px",
                            alignItems: "flex-start",
                            marginBottom: "10px",
                            padding: "4px",
                            borderRadius: "6px",
                            boxShadow: previewFocused ? "0 0 0 2px rgba(255, 255, 255, 0.55)" : undefined
                        }}
                    >
                        {thumbDataUri ? (
                            <FadeImage
                                src={thumbDataUri}
                                fadeOnLoad={false}
                                style={{ width: `${modalSize(150)}px`, borderRadius: "4px", flexShrink: 0, display: "block" }}
                            />
                        ) : null}
                        <div style={titleStyle}>{title}</div>
                    </Focusable>
                )}

                <div style={{ marginBottom: "10px" }}>
                    <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between" }}>
                        <span>{t(language, "Caption")}</span>
                        <span>{`${caption.length} / ${captionMax}`}</span>
                    </div>
                    <TextField
                        value={caption}
                        disabled={preparing}
                        onChange={(e: { target: { value: string } }) => setCaption(e.target.value.slice(0, captionMax))}
                    />
                    <div style={{ display: "flex", marginTop: "6px" }}>
                        <div data-focus-key="memories:share:clear-caption">
                            <DialogButton style={compactButtonStyle} disabled={preparing} onClick={() => setCaption("")}>
                                {t(language, "Clear Caption")}
                            </DialogButton>
                        </div>
                    </div>
                </div>

                <div style={{ marginBottom: "10px" }}>
                    <div style={labelStyle}>
                        {`${t(language, "Memory Tags")} ${memoryTags.length}/${MAX_SHARE_MEMORY_TAGS}`}
                    </div>
                    <Focusable
                        flow-children="grid"
                        style={{ display: "flex", flexDirection: "row", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
                    >
                        {MEMORY_TAG_SEEDS.map((seed) => {
                            const selected = memoryTags.includes(seed.tag);
                            return (
                                <div key={seed.tag} data-focus-key={`memories:share:tag:${seed.tag}`}>
                                    <DialogButton
                                        disabled={preparing}
                                        onClick={() => toggleTag(seed.tag)}
                                        style={{
                                            ...compactButtonStyle,
                                            fontWeight: selected ? 800 : 500,
                                            outline: selected ? "1px solid rgba(255,255,255,0.65)" : undefined
                                        }}
                                    >
                                        {t(language, seed.key)}
                                    </DialogButton>
                                </div>
                            );
                        })}
                    </Focusable>
                </div>

                <ToggleRow
                    label={t(language, "Include my RetroAchievements name")}
                    value={credit}
                    onChange={toggleCredit}
                    disabled={preparing || !username}
                    bottomSeparator="none"
                />

                {preparing ? (
                    <div style={{ marginTop: "12px" }}>
                        <InlineSpinner label={t(language, "Preparing… {{seconds}} s", { seconds: elapsed })} />
                    </div>
                ) : null}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
                    <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
                        <DialogButton disabled={preparing || !probe} onClick={() => void post()}>
                            {t(language, "Post")}
                        </DialogButton>
                        <DialogButton onClick={preparing ? () => void cancelMemoryShare() : leave}>
                            {t(language, "Cancel")}
                        </DialogButton>
                    </Focusable>
                </div>
            </Focusable>
        </ModalRoot>
    );
}
