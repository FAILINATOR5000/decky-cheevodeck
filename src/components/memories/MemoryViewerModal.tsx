import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { transportLabel } from "./transportLabel";
import { toaster } from "@decky/api";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
// Font Awesome Free icon, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaTrophy } from "react-icons/fa";
import {
    addMemoryBookmark,
    cacheAchievementIcons,
    deleteMemory,
    getAchievementIcons,
    getCachedAchievementIcons,
    loadMemoryFull,
    removeMemoryBookmark,
    renameMemoryBookmark,
    saveMemoriesMuted
} from "../../api";
import { armMemoriesFocusKey, armMemoriesFocusReturn } from "../../utils/memoriesFocusReturn";
import { ActionLink } from "../ui/ActionLink";
import { BookmarkNameModal } from "../ui/BookmarkNameModal";
import { ColumnsIcon } from "../ui/ColumnsIcon";
import { FadeImage } from "../ui/FadeImage";
import { ScissorsIcon } from "../ui/ScissorsIcon";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { PencilIcon } from "../ui/PencilIcon";
import { TrashIcon } from "../ui/TrashIcon";
import { AwardStamp } from "../achievements/AwardStamp";
import { HardcoreBadge } from "../achievements/HardcoreBadge";
import { POINTS_LABEL_STYLES, PointsLabel } from "../achievements/PointsLabel";
import { UnlockStamp } from "../achievements/UnlockStamp";
import { MemoryEditorModal } from "./MemoryEditorModal";
import {
    announceMemoryBookmark,
    beginMemorySeek,
    endMemorySeek,
    memoryPlaybackMediaTime,
    nudgeMemoryTransport,
    seekMemoryPlayback,
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
import { BOOKMARK_FLASH_MS, formatClipLength } from "../../utils/memories";
import { playCaptureSound } from "../../utils/navSound";
import { saveBookmarkSnippetToFolder } from "../../utils/saveMemoryMedia";
import { getDeviceIsSteamMachine, modalSize } from "../../utils/scale";
import { errorRed } from "../../utils/style";
import { t, type LanguageCode } from "../../locales";
import type { AchievementRow, MemoryBookmark, MemoryRecord, ShortcutButton } from "../../types";

const BOOKMARK_TOAST_MS = 3000;

const BOOKMARK_STEP_SECONDS = 0.25;

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

const RAIL_EDGE_COLOR = "rgba(255, 255, 255, 0.35)";

const RAIL_BOTTOM_CLEARANCE = 72;

const RAIL_CARD_GAP = 6;

const RAIL_FILLER_LIMIT = 40;

const RAIL_FILLER_MIN = 10;

const RAIL_INNER_PAD = 2;

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

    const [bookmarks, setBookmarks] = useState<MemoryBookmark[]>(memory.bookmarks);
    const [armedBookmark, setArmedBookmark] = useState<string | null>(null);
    const [flash, setFlash] = useState<{ name: string; token: number } | null>(null);
    const [flashOn, setFlashOn] = useState(false);
    const rowNavs = useRef(new Map<string, { current: any }>());

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
    const pendingSeekRef = useRef<number | null>(null);
    const hasRunRef = useRef(false);
    const pictureTopRef = useRef(0);
    const pictureNavRef = useRef<any>(null);
    const captionNavRef = useRef<any>(null);
    const bookmarkCountRef = useRef(memory.bookmarks.length);
    const pictureFocusedRef = useRef(false);
    const railRef = useRef<HTMLDivElement | null>(null);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
    const alignedRef = useRef(false);
    const [posterRatio, setPosterRatio] = useState(0);
    const [railCap, setRailCap] = useState(0);
    const [railFiller, setRailFiller] = useState({ count: 0, height: 0, tail: 0 });

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
        const box = imageBoxRef.current;
        const view = box?.ownerDocument.defaultView;
        if (!box || !view) {
            return;
        }
        const measure = () => {
            const top = box.getBoundingClientRect().top;
            pictureTopRef.current = top;
            setRailCap(Math.max(view.innerHeight - top - RAIL_BOTTOM_CLEARANCE, 0));
        };
        measure();
        const observer = new view.ResizeObserver(measure);
        observer.observe(box);
        return () => {
            observer.disconnect();
        };
    }, [fullscreen, timeline, bookmarks.length]);

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
        const startAt = pendingSeekRef.current;
        pendingSeekRef.current = null;
        return showMemoryFullscreen(thumbDataUri, fullSrc, language, clipSource, startAt);
    }, [fullscreen, fullSrc, thumbDataUri, language, clipSource]);

    useEffect(() => {
        const element = videoRef.current;
        if (!timeline || !clipSource || !element) {
            return;
        }
        const handle = playClip(element, clipSource);
        playbackRef.current = handle;
        hasRunRef.current = false;
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        let landed = target === null;
        const unsubscribe = handle.subscribe((next) => {
            if (!next.paused) {
                hasRunRef.current = true;
            }
            if (!landed && !next.paused) {
                landed = true;
                handle.seekTo(target as number);
            }
            setClipState(next);
        });
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

    useEffect(() => {
        const box = imageBoxRef.current;
        const win = box?.ownerDocument.defaultView;
        if (!box || !win || bookmarkCountRef.current === bookmarks.length) {
            return;
        }
        bookmarkCountRef.current = bookmarks.length;
        if (!pictureFocusedRef.current) {
            return;
        }
        const frame = win.requestAnimationFrame(() => {
            pictureNavRef.current?.Node?.()?.ForceMeasureFocusRing?.();
        });
        return () => {
            win.cancelAnimationFrame(frame);
        };
    }, [bookmarks.length]);

    useEffect(() => {
        if (!flash) {
            return;
        }
        setFlashOn(true);
        const hold = setTimeout(() => setFlashOn(false), BOOKMARK_FLASH_MS);
        return () => clearTimeout(hold);
    }, [flash]);

    function rowNav(id: string) {
        const held = rowNavs.current;
        if (!held.has(id)) {
            held.set(id, { current: null });
        }
        return held.get(id) as { current: any };
    }

    function focusBookmarkRow(id: string | null) {
        const win = imageBoxRef.current?.ownerDocument.defaultView;
        if (!win) {
            return;
        }
        win.requestAnimationFrame(() => {
            const nav = id === null ? captionNavRef : rowNavs.current.get(id);
            nav?.current?.TakeFocus(true);
        });
    }

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

    function pressPicture() {
        if (timeline && !clipState?.ended) {
            playbackRef.current?.togglePause();
            return;
        }
        pressFullscreen();
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

    function momentOnScreen(): number {
        if (fullscreen) {
            const live = memoryPlaybackMediaTime();
            if (live !== null) {
                return live;
            }
        }
        else if (clipState) {
            return clipState.mediaTime;
        }
        return clipSource ? clipSource.startMs / 1000 : 0;
    }

    function captureBookmark() {
        if (!clipSource) {
            return;
        }
        void addMemoryBookmark(gameId, memory.id, momentOnScreen()).then((result) => {
            if (!result.ok || !result.bookmark) {
                toaster.toast({
                    title: t(language, "Couldn't Add Bookmark"),
                    body: result.error === "too_many"
                        ? t(language, "This clip is holding as many bookmarks as it can.")
                        : "",
                    duration: BOOKMARK_TOAST_MS
                });
                return;
            }
            const added = result.bookmark;
            setBookmarks((current) => [...current, added]
                .sort((first, second) => first.mediaTime - second.mediaTime));
            playCaptureSound();
        }).catch((e) => {
            logError("memories: couldn't bookmark a clip", e);
        });
    }

    function focusPicture() {
        const win = imageBoxRef.current?.ownerDocument.defaultView;
        if (!win) {
            return;
        }
        win.requestAnimationFrame(() => {
            pictureNavRef.current?.TakeFocus(true);
        });
    }

    function stepBookmark(direction: 1 | -1): boolean {
        if (bookmarks.length === 0) {
            return false;
        }
        const from = momentOnScreen();
        const target = direction > 0
            ? bookmarks.find((row) => row.mediaTime > from + BOOKMARK_STEP_SECONDS)
            : [...bookmarks].reverse().find((row) => row.mediaTime < from - BOOKMARK_STEP_SECONDS);
        if (!target) {
            return false;
        }
        const named = target.name.trim();
        if (fullscreen) {
            seekMemoryPlayback(target.mediaTime);
            if (named) {
                announceMemoryBookmark(named);
            }
            return true;
        }
        alignedRef.current = false;
        playbackRef.current?.seekTo(target.mediaTime);
        if (named) {
            setFlash((current) => ({ name: named, token: (current?.token ?? 0) + 1 }));
        }
        return true;
    }

    function selectBookmark(bookmark: MemoryBookmark) {
        pendingSeekRef.current = bookmark.mediaTime;
        setTimeline(false);
        setFullscreen(true);
    }

    function timelineBookmark(bookmark: MemoryBookmark) {
        if (!timelineOffered) {
            return;
        }
        if (timeline) {
            playbackRef.current?.seekTo(bookmark.mediaTime);
            if (clipState?.paused) {
                playbackRef.current?.togglePause();
            }
            alignedRef.current = false;
            focusPicture();
            return;
        }
        pendingSeekRef.current = bookmark.mediaTime;
        setVideoMissing(false);
        setTimeline(true);
        focusPicture();
    }

    function renameBookmarkRow(bookmark: MemoryBookmark) {
        if (timeline && clipState && !clipState.paused) {
            playbackRef.current?.togglePause();
        }
        showManagedModal((closeModal) => (
            <BookmarkNameModal
                language={language}
                initialName={bookmark.name}
                onSubmit={(name) => {
                    void renameMemoryBookmark(gameId, memory.id, bookmark.id, name).then((result) => {
                        if (!result.ok || !result.bookmark) {
                            return;
                        }
                        const saved = result.bookmark;
                        setBookmarks((current) => current.map(
                            (row) => (row.id === saved.id ? saved : row)
                        ));
                    }).catch((e) => {
                        logError("memories: couldn't rename a bookmark", e);
                    });
                }}
                close={() => {
                    closeModal();
                    focusBookmarkRow(bookmark.id);
                }}
            />
        ));
    }

    function deleteBookmarkRow(bookmark: MemoryBookmark) {
        if (armedBookmark !== bookmark.id) {
            setArmedBookmark(bookmark.id);
            return;
        }
        setArmedBookmark(null);

        const at = bookmarks.findIndex((row) => row.id === bookmark.id);
        void removeMemoryBookmark(gameId, memory.id, bookmark.id).then((result) => {
            if (!result.ok) {
                return;
            }
            setBookmarks((current) => current.filter((row) => row.id !== bookmark.id));
            rowNavs.current.delete(bookmark.id);
            const remaining = bookmarks.filter((row) => row.id !== bookmark.id);
            focusBookmarkRow(
                remaining.length > 0 ? remaining[Math.min(at, remaining.length - 1)].id : null
            );
        }).catch((e) => {
            logError("memories: couldn't delete a bookmark", e);
        });
    }

    function snippetFromBookmark(bookmark: MemoryBookmark) {
        setTimeline(false);
        void saveBookmarkSnippetToFolder(gameId, memory.id, bookmark.id, language);
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
    const clipStartSeconds = clipSource ? clipSource.startMs / 1000 : 0;
    const timelineOffered = Boolean(clipSource)
        && offsets.some((offset) => offset !== null && offset >= 0 && offset <= clipSeconds);

    const position = clipState?.position ?? 0;

    const captured = new Date(
        (memory.capturedAt + (timeline ? Math.floor(position) : 0)) * 1000
    );

    const gainedCap = timeline ? position : clipSeconds;
    const gainedInClip = offsets.filter(
        (offset) => offset !== null && offset > 0 && offset <= gainedCap
    ).length;
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
        if (!rail) {
            return;
        }
        const first = cardRefs.current[lit[0] ?? -1];
        const last = cardRefs.current[lit[lit.length - 1] ?? -1];
        if (!first || !last) {
            alignedRef.current = false;
            rail.scrollTo({ top: 0, behavior: "auto" });
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

    useEffect(() => {
        const rail = railRef.current;
        const first = cardRefs.current[0];
        const last = cardRefs.current[railCards.length - 1];
        if (!timeline || !rail || !first || !last) {
            setRailFiller({ count: 0, height: 0, tail: 0 });
            return;
        }
        const height = first.offsetHeight;
        const free = rail.clientHeight - (last.offsetTop + last.offsetHeight);
        const step = height + RAIL_CARD_GAP;
        const whole = height > 0
            ? Math.min(Math.max(Math.floor((free - RAIL_CARD_GAP) / step), 0), RAIL_FILLER_LIMIT)
            : 0;
        const rest = free - whole * step - RAIL_CARD_GAP;
        setRailFiller({
            count: whole,
            height,
            tail: rest >= RAIL_FILLER_MIN ? rest : 0
        });
    }, [timeline, railCap, railCards.length]);

    const framedButtons = useMemo(() => {
        const map: Record<number, ReactNode> = {};
        if (clipSource) {
            map[BUTTON_SELECT] = muted
                ? transportLabel(language, "Unmute", "\u266a")
                : transportLabel(language, "Mute", "\u2298");
        }
        return map;
    }, [clipSource, muted, language]);

    const heldStill = clipState?.paused && hasRunRef.current;
    const pictureAction = useMemo(() => {
        if (timeline && !clipState?.ended) {
            return heldStill
                ? transportLabel(language, "Resume", "\u25b6")
                : transportLabel(language, "Pause", "\u2016");
        }
        return clipSource
            ? transportLabel(language, "Play", "\u25b6")
            : t(language, "Fullscreen");
    }, [timeline, clipState?.ended, heldStill, clipSource, language]);

    const videoButtons = useMemo(() => {
        const map: Record<number, ReactNode> = { ...framedButtons };
        if (timelineOffered) {
            if (timeline && clipState?.ended) {
                map[BUTTON_BUMPER_RIGHT] = transportLabel(language, "Restart", "\u21bb");
            }
            else if (timeline) {
                map[BUTTON_BUMPER_RIGHT] = transportLabel(language, "Stop", "\u25a0");
            }
            else {
                map[BUTTON_BUMPER_RIGHT] = t(language, "Timeline");
            }
        }
        return map;
    }, [framedButtons, timelineOffered, timeline, clipState?.ended, language]);

    const reservedButtons = clipSource ? (["view", "menu"] as ShortcutButton[]) : undefined;

    const fullscreenButtons = useMemo(() => {
        if (!clipSource) {
            return undefined;
        }
        const map: Record<number, ReactNode> = {
            [BUTTON_TRIGGER_LEFT]: transportLabel(language, "Rewind", "\u00ab"),
            [BUTTON_TRIGGER_RIGHT]: transportLabel(language, "Forward", "\u00bb"),
            [BUTTON_BUMPER_LEFT]: transportLabel(language, "Skip Back", "\u2039"),
            [BUTTON_BUMPER_RIGHT]: transportLabel(language, "Skip Forward", "\u203a")
        };
        return map;
    }, [clipSource, language]);

    const bookmarkRowButtons = useMemo(() => {
        const map: Record<number, ReactNode> = {
            [BUTTON_BUMPER_LEFT]: t(language, "Snippet")
        };
        if (timelineOffered) {
            map[BUTTON_BUMPER_RIGHT] = t(language, "Timeline");
        }
        return map;
    }, [timelineOffered, language]);

    const bookmarkIconButtonStyle: CSSProperties = {
        minWidth: 0,
        width: `${modalSize(26)}px`,
        height: `${modalSize(26)}px`,
        padding: "2px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    };

    if (fullscreen) {
        return (
            <ModalRoot
                onCancel={handleCancel}
                onEscKeypress={handleCancel}
                className="cheevo-memory-full"
                modalClassName="cheevo-memory-fullpos"
            >
                <SnapshotHotkey language={language} reservedButtons={reservedButtons} />
                <style>{MEMORY_DIALOG_CSS}</style>
                <Focusable
                    onActivate={clipSource
                        ? () => toggleMemoryPlayback()
                        : () => setFullscreen(false)}
                    onOKActionDescription={clipSource
                        ? transportLabel(language, "Pause", "\u2016")
                        : t(language, "Shrink")}
                    onMenuButton={clipSource ? captureBookmark : undefined}
                    onMenuActionDescription={clipSource
                                ? transportLabel(language, "Bookmark", "\u2605")
                                : undefined}
                    onMoveLeft={clipSource ? () => stepBookmark(-1) : undefined}
                    onMoveRight={clipSource ? () => stepBookmark(1) : undefined}
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
                    actionDescriptionMap={fullscreenButtons}
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
            >
                <SnapshotHotkey language={language} reservedButtons={reservedButtons} />
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
                        <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
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
                                        opacity: 0.75,
                                        fontVariantNumeric: "tabular-nums"
                                    }}
                                >
                                    <FaTrophy style={{ flexShrink: 0 }} />
                                    <span>
                                        {t(language, "{{awarded}}/{{possible}} Achievements", {
                                            awarded: progress.unlocked + gainedInClip,
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
                            navRef={pictureNavRef}
                            onGamepadFocus={() => {
                                pictureFocusedRef.current = true;
                            }}
                            onGamepadBlur={() => {
                                pictureFocusedRef.current = false;
                            }}
                            onActivate={pressPicture}
                            fnScrollIntoViewHandler={() => {
                                imageBoxRef.current?.scrollIntoView({ block: "start" });
                                return true;
                            }}
                            onOKActionDescription={pictureAction}
                            onSecondaryButton={pressDelete}
                            onSecondaryActionDescription={t(language, "Delete")}
                            onOptionsButton={openEditor}
                            onOptionsActionDescription={t(language, "Edit")}
                            onMenuButton={clipSource ? captureBookmark : undefined}
                            onMenuActionDescription={clipSource
                                ? transportLabel(language, "Bookmark", "\u2605")
                                : undefined}
                            onMoveLeft={timeline ? () => stepBookmark(-1) : undefined}
                            onMoveRight={timeline ? () => stepBookmark(1) : undefined}
                            onButtonDown={clipSource
                                ? (event: { detail?: { button?: number; is_repeat?: boolean } }) => {
                                    if (event?.detail?.is_repeat) {
                                        return;
                                    }
                                    const button = event?.detail?.button;
                                    if (button === BUTTON_BUMPER_RIGHT && timelineOffered) {
                                        pressTimeline();
                                    }
                                }
                                : undefined}
                            actionDescriptionMap={clipSource ? videoButtons : undefined}
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
                                            {flash ? (
                                                <div
                                                    style={{
                                                        position: "absolute",
                                                        top: `${modalSize(6)}px`,
                                                        left: 0,
                                                        right: 0,
                                                        textAlign: "center",
                                                        opacity: flashOn ? 1 : 0,
                                                        transition: "opacity 220ms ease"
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            display: "inline-block",
                                                            maxWidth: "80%",
                                                            padding: `${modalSize(3)}px ${modalSize(10)}px`,
                                                            borderRadius: "4px",
                                                            background: "rgba(0, 0, 0, 0.55)",
                                                            color: "rgba(255, 255, 255, 0.92)",
                                                            fontSize: `${modalSize(13)}px`,
                                                            fontWeight: 700,
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                            whiteSpace: "nowrap"
                                                        }}
                                                    >
                                                        {flash.name}
                                                    </span>
                                                </div>
                                            ) : null}
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
                            <Focusable
                                navRef={captionNavRef}
                                flow-children="row"
                                style={{ display: "flex", flexShrink: 0 }}
                            >
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
                                {mouseKeyboardMode && timelineOffered && (
                                    <DialogButton
                                        onClick={pressTimeline}
                                        style={{
                                            minWidth: 0,
                                            width: `${modalSize(34)}px`,
                                            height: `${modalSize(34)}px`,
                                            padding: "4px",
                                            marginLeft: "6px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: timeline ? "#4ea1ff" : undefined
                                        }}
                                    >
                                        <ColumnsIcon size={modalSize(16)} />
                                    </DialogButton>
                                )}
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

                        {clipSource && bookmarks.length > 0 ? (
                            <div style={{ marginTop: "12px" }}>
                                <div
                                    style={{
                                        textAlign: "center",
                                        fontSize: `${modalSize(13)}px`,
                                        fontWeight: 700,
                                        opacity: 0.75,
                                        marginBottom: "4px"
                                    }}
                                >
                                    {t(language, "Bookmarks")}
                                </div>
                                <Focusable
                                    flow-children="column"
                                    style={{ display: "flex", flexDirection: "column", gap: "2px" }}
                                >
                                    {bookmarks.map((row) => (
                                        <Focusable
                                            key={row.id}
                                            navRef={rowNav(row.id)}
                                            flow-children="row"
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "4px",
                                                padding: "3px",
                                                borderRadius: "6px",
                                                boxShadow: armedBookmark === row.id
                                                    ? `0 0 0 2px ${errorRed}`
                                                    : undefined
                                            }}
                                        >
                                            <ActionLink
                                                block
                                                onActivate={() => selectBookmark(row)}
                                                onOKActionDescription={t(language, "Play")}
                                                onOptionsButton={() => renameBookmarkRow(row)}
                                                onOptionsActionDescription={t(language, "Rename")}
                                                onSecondaryButton={() => deleteBookmarkRow(row)}
                                                onSecondaryActionDescription={t(language, "Delete")}
                                                onButtonDown={(event) => {
                                                    if (event?.detail?.is_repeat) {
                                                        return;
                                                    }
                                                    const button = event?.detail?.button;
                                                    if (button === BUTTON_BUMPER_RIGHT) {
                                                        timelineBookmark(row);
                                                        return;
                                                    }
                                                    if (button === BUTTON_BUMPER_LEFT) {
                                                        snippetFromBookmark(row);
                                                    }
                                                }}
                                                actionDescriptionMap={bookmarkRowButtons}
                                                onGamepadBlur={() => setArmedBookmark(
                                                    (current) => (current === row.id ? null : current)
                                                )}
                                            >
                                                {`${formatClipLength(
                                                    Math.max(row.mediaTime - clipStartSeconds, 0)
                                                )} \u2014 ${row.name || t(language, "Untitled")}`}
                                            </ActionLink>
                                            {mouseKeyboardMode && (
                                                <DialogButton
                                                    onClick={() => renameBookmarkRow(row)}
                                                    style={bookmarkIconButtonStyle}
                                                >
                                                    <PencilIcon size={modalSize(13)} />
                                                </DialogButton>
                                            )}
                                            {mouseKeyboardMode && (
                                                <DialogButton
                                                    onClick={() => snippetFromBookmark(row)}
                                                    style={bookmarkIconButtonStyle}
                                                >
                                                    <ScissorsIcon size={modalSize(13)} />
                                                </DialogButton>
                                            )}
                                            {mouseKeyboardMode && (
                                                <DialogButton
                                                    onClick={() => deleteBookmarkRow(row)}
                                                    style={{
                                                        ...bookmarkIconButtonStyle,
                                                        color: armedBookmark === row.id
                                                            ? errorRed
                                                            : undefined
                                                    }}
                                                >
                                                    <TrashIcon size={modalSize(13)} />
                                                </DialogButton>
                                            )}
                                        </Focusable>
                                    ))}
                                </Focusable>
                            </div>
                        ) : null}

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
                                alignSelf: timeline ? "stretch" : undefined,
                                maxHeight: timeline && railCap > 0
                                    ? `${railCap}px`
                                    : undefined,
                                border: `2px solid ${timeline ? RAIL_EDGE_COLOR : "transparent"}`,
                                borderRadius: "6px",
                                padding: `${RAIL_INNER_PAD}px`,
                                boxSizing: "border-box"
                            }}
                        >
                        <div
                            ref={railRef}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                                position: timeline ? "absolute" : "relative",
                                inset: timeline ? `${RAIL_INNER_PAD}px` : undefined,
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
                            {Array.from({ length: railFiller.count }, (_, slot) => (
                                <div
                                    key={`rail-filler-${slot}`}
                                    style={{
                                        height: `${railFiller.height}px`,
                                        boxSizing: "border-box",
                                        borderRadius: "6px",
                                        background: "rgba(255,255,255,0.06)",
                                        flexShrink: 0,
                                        borderLeft: `${RAIL_EDGE_WIDTH}px solid transparent`
                                    }}
                                />
                            ))}
                            {railFiller.tail > 0 ? (
                                <div
                                    style={{
                                        height: `${railFiller.tail}px`,
                                        boxSizing: "border-box",
                                        borderRadius: "6px",
                                        background: "rgba(255,255,255,0.06)",
                                        flexShrink: 0,
                                        borderLeft: `${RAIL_EDGE_WIDTH}px solid transparent`
                                    }}
                                />
                            ) : null}
                        </div>
                        </div>
                    )}
                </div>
            </Focusable>
        </ModalRoot>
    );
}
