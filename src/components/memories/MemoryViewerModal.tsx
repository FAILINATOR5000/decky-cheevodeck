import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
// Font Awesome Free icon, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaTrophy } from "react-icons/fa";
import {
    cacheAchievementIcons,
    deleteMemory,
    getAchievementIcons,
    getCachedAchievementIcons,
    loadMemoryFull,
    saveMemoriesMuted
} from "../../api";
import { armMemoriesFocusKey, armMemoriesFocusReturn } from "../../utils/memoriesFocusReturn";
import { FadeImage } from "../ui/FadeImage";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { PencilIcon } from "../ui/PencilIcon";
import { TrashIcon } from "../ui/TrashIcon";
import { AwardStamp } from "../achievements/AwardStamp";
import { HardcoreBadge } from "../achievements/HardcoreBadge";
import { POINTS_LABEL_STYLES, PointsLabel } from "../achievements/PointsLabel";
import { UnlockStamp } from "../achievements/UnlockStamp";
import { MemoryEditorModal } from "./MemoryEditorModal";
import {
    beginMemorySeek,
    endMemorySeek,
    nudgeMemoryTransport,
    showMemoryFullscreen,
    skipMemoryPlayback,
    toggleMemoryPlayback
} from "./memoryFullscreen";
import { playClip, type ClipPlayback, type ClipPlaybackState, type ClipSource } from "./clipPlayer";
import { getClipMuted, setClipMuted, useClipMuted } from "./clipMute";
import {
    BUTTON_BUMPER_LEFT,
    BUTTON_BUMPER_RIGHT,
    BUTTON_SELECT,
    BUTTON_TRIGGER_LEFT,
    BUTTON_TRIGGER_RIGHT
} from "../../utils/gamepadButtons";
import { showManagedModal } from "../../utils/modalRegistry";
import { logError } from "../../utils/errors";
import { formatUnlockDate, noteBodyColor } from "../../utils/achievements";
import { formatClipLength } from "../../utils/memories";
import { getDeviceIsSteamMachine, modalSize } from "../../utils/scale";
import { errorRed } from "../../utils/style";
import { t, type LanguageCode } from "../../locales";
import type { AchievementRow, MemoryRecord } from "../../types";

const MEMORY_DIALOG_CSS = `
.cheevo-memory-dialog.DialogContent, .cheevo-memory-dialog {
    width: min(86vw, 1100px);
    max-width: min(86vw, 1100px);
}
.cheevo-memory-full.DialogContent, .cheevo-memory-full {
    width: 100vw;
    max-width: 100vw;
    padding: 0;
    border: none;
    background: transparent;
}
.cheevo-memory-fullpos .ModalPosition_Content {
    max-width: 100vw;
    max-height: 100vh;
    box-shadow: none;
}
.cheevo-memory-full [class*="gpfocus"],
.cheevo-memory-full [class*="GPFocus"],
.cheevo-memory-full *:focus,
.cheevo-memory-full *:focus-visible {
    outline: none !important;
    box-shadow: none !important;
    border-color: transparent !important;
}
.cheevo-memory-full [class*="gpfocus"]::before,
.cheevo-memory-full [class*="gpfocus"]::after,
.cheevo-memory-full [class*="GPFocus"]::before,
.cheevo-memory-full [class*="GPFocus"]::after {
    display: none !important;
}
`;

const RAIL_CARD_LIMIT = 3;

const RAIL_SCROLL_MARGIN = 0.5;

const RAIL_EDGE_WIDTH = 3;

const RAIL_LIT_EDGE = "rgba(255, 215, 100, 1)";
const RAIL_LIT_GLOW = "inset 14px 0 20px -12px rgba(255, 215, 100, 0.95), "
    + "inset 0 0 10px 0 rgba(245, 200, 50, 0.22)";

function timelineOffsets(cards: MemoryRecord["achievements"], capturedAt: number): (number | null)[] {
    return cards.map((card) => (card.unlockedAt === null ? null : card.unlockedAt - capturedAt));
}

function litIndices(offsets: (number | null)[], position: number): number[] {
    let best: number | null = null;
    for (const offset of offsets) {
        if (offset === null || offset > position) {
            continue;
        }
        if (best === null || offset > best) {
            best = offset;
        }
    }
    if (best === null) {
        return [];
    }
    const lit: number[] = [];
    offsets.forEach((offset, index) => {
        if (offset === best) {
            lit.push(index);
        }
    });
    return lit;
}

function MutedIcon(props: { size: number }) {
    return (
        <svg viewBox="0 0 100 100" style={{ width: `${props.size}px`, height: `${props.size}px`, display: "block" }}>
            <polygon points="10,38 30,38 52,18 52,82 30,62 10,62" fill="currentColor" />
            <line x1="62" y1="34" x2="90" y2="66" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
            <line x1="90" y1="34" x2="62" y2="66" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        </svg>
    );
}

const IMAGE_LAYER_STYLE: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block"
};

export type MemoryViewerModalProps = {
    memory: MemoryRecord;
    gameId: number;
    thumbDataUri: string | null;
    language: LanguageCode;
    showRetroPoints: boolean;
    mouseKeyboardMode: boolean;
    allTags: string[];
    activeUlid: string;
    tagFilter: string;
    removalLandingId: string | null;
    close: () => void;
};

export function MemoryViewerModal(props: MemoryViewerModalProps) {
    const { memory, gameId, thumbDataUri, language, showRetroPoints, mouseKeyboardMode, allTags, activeUlid, tagFilter, removalLandingId, close } = props;

    const [caption, setCaption] = useState(memory.caption);
    const [tag, setTag] = useState(memory.tag);
    const [color, setColor] = useState(memory.color);

    const [knownTags, setKnownTags] = useState(allTags);

    const [fullSrc, setFullSrc] = useState<string | null>(null);
    const [downscaled, setDownscaled] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [badges, setBadges] = useState<Record<string, string>>({});
    const [armedDelete, setArmedDelete] = useState(false);

    const [timeline, setTimeline] = useState(false);
    const [clipState, setClipState] = useState<ClipPlaybackState | null>(null);
    const [videoMissing, setVideoMissing] = useState(false);
    const muted = useClipMuted();

    const blobUrlRef = useRef<string | null>(null);
    const imageBoxRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const playbackRef = useRef<ClipPlayback | null>(null);
    const railRef = useRef<HTMLDivElement | null>(null);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
    const alignedRef = useRef(false);
    const [posterRatio, setPosterRatio] = useState(0);

    const clipSource = useMemo<ClipSource | null>(() => {
        const video = memory.video;
        if (!video || !video.clipId || !video.sessionId) {
            return null;
        }
        return {
            clipId: video.clipId,
            sessionId: video.sessionId,
            startMs: video.startMs,
            durationMs: video.durationMs,
            gameId: memory.gameId,
            memoryId: memory.id,
            owned: video.path !== "",
            remuxed: video.path !== "" && video.kind === "mp4"
        };
    }, [memory.video, memory.gameId, memory.id]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const result = await loadMemoryFull(gameId, memory.path);
                if (cancelled || !result?.dataUri) {
                    return;
                }
                setDownscaled(Boolean(result.downscaled));
                const comma = result.dataUri.indexOf(",");
                const header = result.dataUri.slice(5, result.dataUri.indexOf(";"));
                const binary = atob(result.dataUri.slice(comma + 1));
                const bytes = new Uint8Array(binary.length);
                for (let index = 0; index < binary.length; index += 1) {
                    bytes[index] = binary.charCodeAt(index);
                }
                const url = URL.createObjectURL(new Blob([bytes], { type: header }));
                blobUrlRef.current = url;
                setFullSrc(url);
            } catch (error) {
                logError("memories: couldn't read a memory at full size", error);
            }
        })();

        return () => {
            cancelled = true;
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
                blobUrlRef.current = null;
            }
        };
    }, [gameId, memory.path]);

    useEffect(() => {
        const box = imageBoxRef.current;
        if (!box) {
            return;
        }
        const image = box.querySelector("img");
        if (!image) {
            return;
        }
        function measure() {
            if (!image || !image.naturalHeight) {
                return;
            }
            setPosterRatio(image.naturalWidth / image.naturalHeight);
        }
        if (image.complete) {
            measure();
            return;
        }
        image.addEventListener("load", measure);
        return () => {
            image.removeEventListener("load", measure);
        };
    }, [thumbDataUri, fullSrc]);

    useEffect(() => {
        const names = memory.achievements.map((card) => card.badgeName).filter(Boolean);
        if (names.length === 0) {
            return;
        }
        const cached = getCachedAchievementIcons(gameId, names);
        setBadges(cached);
        const missing = names.filter((name) => !cached[name]);
        if (missing.length === 0) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const result = await getAchievementIcons(gameId, missing);
                if (cancelled || !result?.icons) {
                    return;
                }
                cacheAchievementIcons(gameId, result.icons);
                setBadges((current) => ({ ...current, ...result.icons }));
            } catch (error) {
                logError("memories: couldn't read achievement badges", error);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [gameId, memory.achievements]);

    useEffect(() => {
        if (!fullscreen) {
            return;
        }
        if (!fullSrc && !thumbDataUri) {
            return;
        }
        return showMemoryFullscreen(thumbDataUri, fullSrc, language, clipSource);
    }, [fullscreen, fullSrc, thumbDataUri, language, clipSource]);

    useEffect(() => {
        const element = videoRef.current;
        if (!timeline || !clipSource || !element) {
            return;
        }
        const handle = playClip(element, clipSource);
        playbackRef.current = handle;
        const unsubscribe = handle.subscribe(setClipState);
        return () => {
            unsubscribe();
            handle.destroy();
            playbackRef.current = null;
            setClipState(null);
        };
    }, [timeline, clipSource]);

    useEffect(() => {
        const element = videoRef.current;
        if (element) {
            element.muted = muted;
        }
    }, [muted, timeline]);

    useEffect(() => {
        if (!clipState?.unavailable) {
            return;
        }
        setVideoMissing(true);
        setTimeline(false);
    }, [clipState?.unavailable]);

    const handleCancel = useCallback(() => {
        if (fullscreen) {
            setFullscreen(false);
            return;
        }
        close();
    }, [fullscreen, close]);

    function pressTimeline() {
        if (!timelineOffered) {
            return;
        }
        if (!timeline) {
            setVideoMissing(false);
            setTimeline(true);
            return;
        }
        if (clipState?.ended) {
            alignedRef.current = false;
            railRef.current?.scrollTo({ top: 0, behavior: "auto" });
            playbackRef.current?.togglePause();
            return;
        }
        setTimeline(false);
    }

    function pressMute() {
        const next = !getClipMuted();
        setClipMuted(next);
        void saveMemoriesMuted(next).catch((e) => {
            logError("memories: couldn't save the clip mute setting", e);
        });
    }

    function pressFullscreen() {
        setTimeline(false);
        setFullscreen((current) => !current);
    }

    function pressDelete() {
        if (!armedDelete) {
            setTimeline(false);
            setArmedDelete(true);
            return;
        }
        void deleteMemory(gameId, memory.id).catch((e) => {
            logError("memories: couldn't delete a memory", e);
        });
        if (removalLandingId === null) {
            armMemoriesFocusKey("memories:back");
        } else {
            armMemoriesFocusReturn(gameId, removalLandingId, activeUlid);
        }
        close();
    }

    function openEditor() {
        setTimeline(false);
        showManagedModal((closeEditor) => (
            <MemoryEditorModal
                memory={{ ...memory, caption, tag, color }}
                gameId={gameId}
                language={language}
                allTags={knownTags}
                activeUlid={activeUlid}
                tagFilter={tagFilter}
                removalLandingId={removalLandingId}
                onSaved={(next) => {
                    setCaption(next.caption);
                    setTag(next.tag);
                    setColor(next.color);
                    setKnownTags((current) => {
                        const applied = (next.tag ?? "").trim();
                        if (!applied) {
                            return current;
                        }
                        const lower = applied.toLowerCase();
                        return [applied, ...current.filter((entry) => entry.trim().toLowerCase() !== lower)];
                    });
                }}
                close={closeEditor}
            />
        ));
    }

    const stampFormatter = useMemo(() => new Intl.DateTimeFormat(language, {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }), [language]);

    const captured = new Date(memory.capturedAt * 1000);
    const progress = memory.progress;
    const rule = noteBodyColor(color);
    const imageMaxVh = getDeviceIsSteamMachine() ? 70 : 55;

    const sortedCards = useMemo(() => [...memory.achievements]
        .sort((first, second) => (first.unlockedAt ?? Infinity) - (second.unlockedAt ?? Infinity)),
        [memory.achievements]);
    const railCards = timeline ? sortedCards : sortedCards.slice(0, RAIL_CARD_LIMIT);
    const overflow = Math.max(0, memory.achievementCount - railCards.length);

    const offsets = useMemo(
        () => timelineOffsets(sortedCards, memory.capturedAt),
        [sortedCards, memory.capturedAt]
    );

    const clipSeconds = clipSource ? clipSource.durationMs / 1000 : 0;
    const timelineOffered = Boolean(clipSource)
        && offsets.some((offset) => offset !== null && offset >= 0 && offset <= clipSeconds);

    const position = clipState?.position ?? 0;
    const lit = useMemo(
        () => (timeline ? litIndices(offsets, position) : []),
        [timeline, offsets, position]
    );
    const litSet = useMemo(() => new Set(lit), [lit]);
    const litKey = lit.join(",");

    useEffect(() => {
        if (!timeline) {
            alignedRef.current = false;
            railRef.current?.scrollTo({ top: 0, behavior: "auto" });
            return;
        }
        const rail = railRef.current;
        const first = cardRefs.current[lit[0] ?? -1];
        const last = cardRefs.current[lit[lit.length - 1] ?? -1];
        if (!rail || !first || !last) {
            return;
        }
        if (!alignedRef.current) {
            alignedRef.current = true;
            rail.scrollTop = first.offsetTop;
            return;
        }
        const margin = last.offsetHeight * RAIL_SCROLL_MARGIN;
        const bottom = last.offsetTop + last.offsetHeight;
        if (bottom + margin > rail.scrollTop + rail.clientHeight) {
            rail.scrollTop = bottom + margin - rail.clientHeight;
            return;
        }
        if (first.offsetTop < rail.scrollTop) {
            rail.scrollTop = first.offsetTop;
        }
    }, [timeline, litKey]);

    const framedButtons: Record<number, string> = {};
    if (clipSource) {
        framedButtons[BUTTON_SELECT] = muted ? t(language, "Unmute") : t(language, "Mute");
    }
    if (timelineOffered) {
        if (timeline && clipState?.ended) {
            framedButtons[BUTTON_BUMPER_RIGHT] = t(language, "Restart");
        }
        else if (timeline) {
            framedButtons[BUTTON_BUMPER_RIGHT] = t(language, "Stop");
        }
        else {
            framedButtons[BUTTON_BUMPER_RIGHT] = t(language, "Timeline Play");
        }
    }

    if (fullscreen) {
        return (
            <ModalRoot
                onCancel={handleCancel}
                onEscKeypress={handleCancel}
                className="cheevo-memory-full"
                modalClassName="cheevo-memory-fullpos"
            >
                <SnapshotHotkey language={language} reservedButtons={clipSource ? ["view"] : undefined} />
                <style>{MEMORY_DIALOG_CSS}</style>
                <Focusable
                    onActivate={clipSource
                        ? () => toggleMemoryPlayback()
                        : () => setFullscreen(false)}
                    onOKActionDescription={clipSource
                        ? t(language, "Pause")
                        : t(language, "Shrink")}
                    onButtonDown={clipSource
                        ? (event: { detail?: { button?: number; is_repeat?: boolean } }) => {
                            const button = event?.detail?.button;
                            nudgeMemoryTransport();
                            if (button === BUTTON_SELECT && !event?.detail?.is_repeat) {
                                pressMute();
                                return;
                            }
                            const seeking = button === BUTTON_TRIGGER_LEFT || button === BUTTON_TRIGGER_RIGHT;
                            const skipping = button === BUTTON_BUMPER_LEFT || button === BUTTON_BUMPER_RIGHT;
                            if (!seeking && !skipping) {
                                return;
                            }
                            if (event?.detail?.is_repeat) {
                                return;
                            }
                            if (skipping) {
                                skipMemoryPlayback(button === BUTTON_BUMPER_RIGHT ? 1 : -1);
                                return;
                            }
                            beginMemorySeek(button === BUTTON_TRIGGER_RIGHT ? 1 : -1);
                        }
                        : undefined}
                    onButtonUp={clipSource
                        ? (event: { detail?: { button?: number } }) => {
                            const button = event?.detail?.button;
                            if (button === BUTTON_TRIGGER_LEFT || button === BUTTON_TRIGGER_RIGHT) {
                                endMemorySeek();
                            }
                        }
                        : undefined}
                    actionDescriptionMap={clipSource
                        ? {
                            [BUTTON_TRIGGER_LEFT]: t(language, "Rewind"),
                            [BUTTON_TRIGGER_RIGHT]: t(language, "Forward"),
                            [BUTTON_BUMPER_LEFT]: t(language, "Skip Back"),
                            [BUTTON_BUMPER_RIGHT]: t(language, "Skip Forward")
                        }
                        : undefined}
                    style={{ display: "block", width: "100%" }}
                >
                    <FadeImage
                        src={fullSrc ?? thumbDataUri ?? ""}
                        fadeOnLoad={false}
                        decoding="async"
                        style={{
                            width: "100%",
                            maxHeight: "calc(100vh - 110px)",
                            objectFit: "contain",
                            display: "block"
                        }}
                    />
                </Focusable>
            </ModalRoot>
        );
    }

    return (
        <ModalRoot
            onCancel={handleCancel}
            onEscKeypress={handleCancel}
            className="cheevo-memory-dialog"
        >
            <Focusable
                onSecondaryButton={pressDelete}
                onSecondaryActionDescription={t(language, "Delete")}
                onOptionsButton={openEditor}
                onOptionsActionDescription={t(language, "Edit")}
                onButtonDown={clipSource
                    ? (event: { detail?: { button?: number; is_repeat?: boolean } }) => {
                        const button = event?.detail?.button;
                        if (event?.detail?.is_repeat) {
                            return;
                        }
                        if (button === BUTTON_SELECT) {
                            pressMute();
                            return;
                        }
                        if (button === BUTTON_BUMPER_RIGHT) {
                            pressTimeline();
                            return;
                        }
                        if (!timeline) {
                            return;
                        }
                        if (button === BUTTON_TRIGGER_LEFT || button === BUTTON_TRIGGER_RIGHT) {
                            playbackRef.current?.beginSeek(button === BUTTON_TRIGGER_RIGHT ? 1 : -1);
                        }
                    }
                    : undefined}
                onButtonUp={clipSource
                    ? (event: { detail?: { button?: number } }) => {
                        const button = event?.detail?.button;
                        if (button === BUTTON_TRIGGER_LEFT || button === BUTTON_TRIGGER_RIGHT) {
                            playbackRef.current?.endSeek();
                        }
                    }
                    : undefined}
                actionDescriptionMap={clipSource ? framedButtons : undefined}
            >
                <SnapshotHotkey language={language} reservedButtons={clipSource ? ["view"] : undefined} />
                <style>{MEMORY_DIALOG_CSS}</style>
                <style>{POINTS_LABEL_STYLES}</style>

                <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "10px",
                            fontSize: `${modalSize(14)}px`
                        }}
                    >
                        <span style={{ fontWeight: 700 }}>
                            <AwardStamp date={stampFormatter.format(captured)} />
                        </span>
                        {progress ? (
                            <>
                                <span style={{ opacity: 0.55 }}>{"\u00b7"}</span>
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.35em",
                                        opacity: 0.75
                                    }}
                                >
                                    <FaTrophy style={{ flexShrink: 0 }} />
                                    <span>
                                        {t(language, "{{awarded}}/{{possible}} Achievements", {
                                            awarded: progress.unlocked,
                                            possible: progress.total
                                        })}
                                    </span>
                                </span>
                            </>
                        ) : null}
                        {downscaled ? (
                            <span style={{ marginLeft: "auto", opacity: 0.7, fontSize: `${modalSize(12)}px` }}>
                                {t(language, "Preview quality")}
                            </span>
                        ) : null}
                    </div>

                <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Focusable
                            onActivate={pressFullscreen}
                            onOKActionDescription={clipSource
                                ? t(language, "Play")
                                : t(language, "Fullscreen")}
                            style={{ display: "block" }}
                        >
                            <div
                                ref={imageBoxRef}
                                style={{
                                    position: "relative",
                                    width: "100%",
                                    aspectRatio: "16 / 9",
                                    maxHeight: `${imageMaxVh}vh`,
                                    background: "rgba(255,255,255,0.06)",
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    boxShadow: armedDelete ? `0 0 0 2px ${errorRed}` : undefined
                                }}
                            >
                                {thumbDataUri ? (
                                    <FadeImage
                                        src={thumbDataUri}
                                        fadeOnLoad={false}
                                        decoding="async"
                                        style={IMAGE_LAYER_STYLE}
                                    />
                                ) : null}
                                {fullSrc ? (
                                    <FadeImage
                                        src={fullSrc}
                                        fadeOnLoad
                                        decoding="async"
                                        style={IMAGE_LAYER_STYLE}
                                    />
                                ) : null}
                                {timeline ? (
                                    <video ref={videoRef} playsInline style={IMAGE_LAYER_STYLE} />
                                ) : null}
                                {clipSource ? (
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
                                                width: posterRatio > 0 ? "auto" : "100%",
                                                height: "100%",
                                                aspectRatio: posterRatio > 0 ? `${posterRatio}` : undefined,
                                                maxWidth: "100%",
                                                maxHeight: "100%"
                                            }}
                                        >
                                            {muted ? (
                                                <div
                                                    style={{
                                                        position: "absolute",
                                                        bottom: `${modalSize(6)}px`,
                                                        left: `${modalSize(6)}px`,
                                                        padding: `${modalSize(2)}px ${modalSize(4)}px`,
                                                        borderRadius: "3px",
                                                        background: "rgba(0, 0, 0, 0.35)",
                                                        color: "rgba(255, 255, 255, 0.88)",
                                                        display: "flex",
                                                        alignItems: "center"
                                                    }}
                                                >
                                                    <MutedIcon size={modalSize(17)} />
                                                </div>
                                            ) : null}
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
                                                    fontVariantNumeric: "tabular-nums"
                                                }}
                                            >
                                                {timeline
                                                    ? `${formatClipLength(Math.floor(position))} / ${formatClipLength(clipSeconds)}`
                                                    : formatClipLength(clipSeconds)}
                                            </div>
                                            {timeline ? (
                                                <div
                                                    style={{
                                                        position: "absolute",
                                                        left: 0,
                                                        right: 0,
                                                        bottom: 0,
                                                        height: "2px",
                                                        background: "rgba(255, 255, 255, 0.28)"
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: `${clipSeconds > 0
                                                                ? Math.min(position / clipSeconds, 1) * 100
                                                                : 0}%`,
                                                            height: "100%",
                                                            background: "#ffffff"
                                                        }}
                                                    />
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : null}
                                {clipSource && !timeline ? (
                                    <div
                                        style={{
                                            position: "absolute",
                                            left: "50%",
                                            top: "50%",
                                            transform: "translate(-50%, -50%)",
                                            width: "16%",
                                            aspectRatio: "1 / 1",
                                            borderRadius: "50%",
                                            background: "rgba(0, 0, 0, 0.45)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center"
                                        }}
                                    >
                                        <svg
                                            viewBox="0 0 100 100"
                                            style={{ width: "42%", height: "42%", display: "block" }}
                                        >
                                            <polygon
                                                points="20,8 88,50 20,92"
                                                fill="rgba(255, 255, 255, 0.92)"
                                            />
                                        </svg>
                                    </div>
                                ) : null}
                                {videoMissing ? (
                                    <div
                                        style={{
                                            position: "absolute",
                                            left: 0,
                                            right: 0,
                                            bottom: 0,
                                            padding: `${modalSize(10)}px ${modalSize(14)}px`,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "4px",
                                            alignItems: "center",
                                            background: "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))"
                                        }}
                                    >
                                        <div style={{ fontSize: `${modalSize(14)}px`, fontWeight: 700 }}>
                                            {t(language, "This clip's video is missing")}
                                        </div>
                                        <div style={{ fontSize: `${modalSize(12)}px`, opacity: 0.85 }}>
                                            {t(language, "The picture, caption and achievements are safe.")}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </Focusable>

                        {rule ? (
                            <div style={{ height: "2px", borderRadius: "1px", background: rule, margin: "10px 0 6px" }} />
                        ) : null}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginTop: "8px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: `${modalSize(15)}px`, wordBreak: "break-word" }}>
                                    {caption}
                                </div>
                                {tag ? (
                                    <div style={{ fontSize: `${modalSize(12)}px`, opacity: 0.75, marginTop: "4px" }}>
                                        {t(language, "Tag: {{tag}}", { tag })}
                                    </div>
                                ) : null}
                            </div>
                            <Focusable flow-children="row" style={{ display: "flex", flexShrink: 0 }}>
                                <DialogButton
                                    onClick={openEditor}
                                    style={{
                                        minWidth: 0,
                                        width: `${modalSize(34)}px`,
                                        height: `${modalSize(34)}px`,
                                        padding: "4px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center"
                                    }}
                                >
                                    <PencilIcon size={modalSize(16)} />
                                </DialogButton>
                                {mouseKeyboardMode && (
                                    <DialogButton
                                        onClick={pressDelete}
                                        style={{
                                            minWidth: 0,
                                            width: `${modalSize(34)}px`,
                                            height: `${modalSize(34)}px`,
                                            padding: "4px",
                                            marginLeft: "6px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: armedDelete ? errorRed : undefined
                                        }}
                                    >
                                        <TrashIcon size={modalSize(16)} />
                                    </DialogButton>
                                )}
                            </Focusable>
                        </div>

                        <Focusable style={{ display: "flex", marginTop: "12px" }}>
                            <DialogButton onClick={close} style={{ width: "100%" }}>
                                {t(language, "Close")}
                            </DialogButton>
                        </Focusable>
                    </div>

                    {railCards.length > 0 && (
                        <div
                            style={{
                                width: `${modalSize(200)}px`,
                                // The scroller inside is absolutely positioned, so
                                // this has to be its containing block.
                                position: "relative",
                                alignSelf: timeline ? "stretch" : undefined
                            }}
                        >
                        <div
                            ref={railRef}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                                position: timeline ? "absolute" : "relative",
                                inset: timeline ? 0 : undefined,
                                overflowY: timeline ? "auto" : undefined,
                                scrollBehavior: "smooth"
                            }}
                        >
                            {railCards.map((card, index) => (
                                <div
                                    key={card.id}
                                    ref={(node) => {
                                        cardRefs.current[index] = node;
                                    }}
                                    style={{
                                        display: "flex",
                                        gap: "8px",
                                        alignItems: "flex-start",
                                        padding: "8px",
                                        borderRadius: "6px",
                                        background: "rgba(255,255,255,0.06)",
                                        flexShrink: 0,
                                        borderLeft: `${RAIL_EDGE_WIDTH}px solid ${
                                            litSet.has(index) ? RAIL_LIT_EDGE : "transparent"}`,
                                        boxShadow: litSet.has(index) ? RAIL_LIT_GLOW : undefined
                                    }}
                                >
                                    <div
                                        style={{
                                            width: `${modalSize(40)}px`,
                                            flexShrink: 0,
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            gap: "2px"
                                        }}
                                    >
                                        <div style={{ width: "100%", height: `${modalSize(40)}px` }}>
                                            {badges[card.badgeName] ? (
                                                <FadeImage
                                                    src={badges[card.badgeName]}
                                                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                                                />
                                            ) : null}
                                        </div>
                                        <div
                                            style={{
                                                width: "100%",
                                                textAlign: "center",
                                                fontSize: `${modalSize(11)}px`,
                                                lineHeight: 1.2,
                                                opacity: 0.9
                                            }}
                                        >
                                            <div>
                                                <PointsLabel
                                                    achievement={{
                                                        points: card.points,
                                                        trueRatio: card.trueRatio
                                                    } as AchievementRow}
                                                    showRetroPoints={showRetroPoints}
                                                    language={language}
                                                />
                                            </div>
                                            {card.hardcore ? (
                                                <HardcoreBadge
                                                    language={language}
                                                    fontSize={modalSize(11)}
                                                    short
                                                    style={{ marginTop: "2px" }}
                                                />
                                            ) : null}
                                        </div>
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                                        <span style={{ fontSize: `${modalSize(13)}px`, fontWeight: 700, wordBreak: "break-word" }}>
                                            {card.title}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: `${modalSize(12)}px`,
                                                lineHeight: 1.3,
                                                opacity: 0.82,
                                                wordBreak: "break-word"
                                            }}
                                        >
                                            {card.description}
                                            {card.type === "missable" ? (
                                                <>
                                                    {" "}
                                                    <span style={{ color: errorRed }}>
                                                        {t(language, "(missable)")}
                                                    </span>
                                                </>
                                            ) : null}
                                        </span>
                                        {card.unlockedAt ? (
                                            <span style={{ fontSize: `${modalSize(11)}px`, opacity: 0.6 }}>
                                                <UnlockStamp
                                                    date={formatUnlockDate(
                                                        new Date(card.unlockedAt * 1000).toISOString(),
                                                        { includeYear: true, numericDate: true, shortYear: true },
                                                        language
                                                    )}
                                                />
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                            {overflow > 0 && (
                                <div style={{ fontSize: `${modalSize(12)}px`, opacity: 0.7, textAlign: "center" }}>
                                    {t(language, "+{{count}} more", { count: overflow })}
                                </div>
                            )}
                        </div>
                        </div>
                    )}
                </div>
            </Focusable>
        </ModalRoot>
    );
}
