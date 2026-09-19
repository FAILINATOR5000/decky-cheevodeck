import { routerHook } from "@decky/api";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { CompositionHold, hasCompositionHold } from "../ui/compositionHold";
import { FadeImage } from "../ui/FadeImage";
import { ButtonPrompt } from "../ui/ButtonPrompt";
import { playClip, type ClipPlayback, type ClipPlaybackState, type ClipSource } from "./clipPlayer";
import { useClipMuted } from "./clipMute";
import { formatClipLength } from "../../utils/memories";
import { debugLoggingEnabled, logFocusDebug } from "../../api";
import { logError } from "../../utils/errors";
import { modalSize } from "../../utils/scale";
import { t, type LanguageCode } from "../../locales";

const GLOBAL_COMPONENT = "CheevoDeckMemoryFullscreen";

const OVERLAY_Z_INDEX = 65001;

const LAYER_STYLE: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block"
};

const TRANSPORT_VISIBLE_MS = 2500;

type FullscreenPicture = {
    thumb: string | null;
    full: string | null;
    clip: ClipSource | null;
    language: LanguageCode;
};

let shown: FullscreenPicture | null = null;

let playback: ClipPlayback | null = null;

const transportNudges = new Set<() => void>();


function nudgeTransport() {
    transportNudges.forEach((listener) => listener());
}

let shownToken = 0;

const listeners = new Set<(picture: FullscreenPicture | null) => void>();

function samePicture(a: FullscreenPicture | null, b: FullscreenPicture | null) {
    if (a === b) {
        return true;
    }
    return Boolean(
        a && b
        && a.thumb === b.thumb
        && a.full === b.full
        && a.language === b.language
        && a.clip?.clipId === b.clip?.clipId
        && a.clip?.sessionId === b.clip?.sessionId
        && a.clip?.startMs === b.clip?.startMs
        && a.clip?.durationMs === b.clip?.durationMs
    );
}

function playKey(state: ClipPlaybackState): string {
    if (state.ended) {
        return "{{button}} Restart";
    }
    return state.paused ? "{{button}} Play" : "{{button}} Pause";
}



function setShown(picture: FullscreenPicture | null) {
    if (samePicture(shown, picture)) {
        return;
    }
    shown = picture;
    listeners.forEach((listener) => listener(picture));
}

function useShown(): FullscreenPicture | null {
    const [picture, setPicture] = useState(shown);

    useEffect(() => {
        listeners.add(setPicture);
        setPicture(shown);
        return () => {
            listeners.delete(setPicture);
        };
    }, []);

    return picture;
}

function ClipLayer(props: { clip: ClipSource; language: LanguageCode }) {
    const { clip, language } = props;
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [state, setState] = useState<ClipPlaybackState>({
        position: 0,
        duration: clip.durationMs / 1000,
        paused: true,
        ended: false,
        unavailable: false,
        scanning: false,
        ready: false
    });
    const [visible, setVisible] = useState(true);
    const [reveal, setReveal] = useState(0);
    const muted = useClipMuted();

    // Teardown lives here rather than in the dialog's cleanup. This component is
    // registered at the router and outlives the panel, so closing the QAM
    // unmounts nothing out here and a decoder left running is battery as well as
    // memory.
    useEffect(() => {
        const element = videoRef.current;
        if (!element) {
            return;
        }
        const handle = playClip(element, clip);
        playback = handle;
        const unsubscribe = handle.subscribe(setState);
        return () => {
            unsubscribe();
            handle.destroy();
            if (playback === handle) {
                playback = null;
            }
        };
    }, [clip]);

    useEffect(() => {
        const element = videoRef.current;
        if (element) {
            element.muted = muted;
        }
    }, [muted]);

    useEffect(() => {
        const bump = () => setReveal((count) => count + 1);
        transportNudges.add(bump);
        return () => {
            transportNudges.delete(bump);
        };
    }, []);

    useEffect(() => {
        setVisible(true);
        const timer = setTimeout(() => setVisible(false), TRANSPORT_VISIBLE_MS);
        return () => clearTimeout(timer);
    }, [reveal]);

    const showing = visible || state.ended || state.scanning;
    const fraction = state.duration > 0 ? Math.min(state.position / state.duration, 1) : 0;

    return (
        <>
            <video ref={videoRef} playsInline style={LAYER_STYLE} />
            {state.unavailable ? (
                <div
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        padding: "16px 24px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        alignItems: "center",
                        background: "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))"
                    }}
                >
                    <div style={{ fontSize: `${modalSize(16)}px`, fontWeight: 700 }}>
                        {t(language, "This clip's video is missing")}
                    </div>
                    <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.85 }}>
                        {t(language, "The picture, caption and achievements are safe.")}
                    </div>
                    <div style={{ fontSize: `${modalSize(14)}px`, opacity: 0.9, marginTop: "4px" }}>
                        <ButtonPrompt language={language} textKey="{{button}} Back" button="b"
                            fontSize={modalSize(14)} />
                    </div>
                </div>
            ) : (
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: "16px 24px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    background: "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))",
                    opacity: showing ? 1 : 0,
                    transition: "opacity 220ms ease"
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                        style={{
                            flex: 1,
                            height: "4px",
                            borderRadius: "2px",
                            background: "rgba(255,255,255,0.28)",
                            overflow: "hidden"
                        }}
                    >
                        <div
                            style={{
                                width: `${fraction * 100}%`,
                                height: "100%",
                                background: "#ffffff"
                            }}
                        />
                    </div>
                    <span style={{ fontVariantNumeric: "tabular-nums", fontSize: `${modalSize(14)}px` }}>
                        {`${formatClipLength(state.ended ? state.duration : Math.floor(state.position))} / ${formatClipLength(state.duration)}`}
                    </span>
                </div>
                <div style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px 18px",
                    fontSize: `${modalSize(14)}px`,
                    opacity: 0.9
                }}>
                    <ButtonPrompt
                        language={language}
                        textKey={playKey(state)}
                        button="a"
                        fontSize={modalSize(14)}
                    />
                    <ButtonPrompt language={language} textKey="{{button}} Rewind" button="l2" fontSize={modalSize(14)} />
                    <ButtonPrompt language={language} textKey="{{button}} Forward" button="r2" fontSize={modalSize(14)} />
                    <ButtonPrompt language={language} textKey="{{button}} Skip" button={["l1", "r1"]}
                        fontSize={modalSize(14)} />
                    <ButtonPrompt
                        language={language}
                        textKey={muted ? "{{button}} Unmute" : "{{button}} Mute"}
                        button="view"
                        fontSize={modalSize(14)}
                    />
                    <ButtonPrompt language={language} textKey="{{button}} Back" button="b" fontSize={modalSize(14)} />
                </div>
            </div>
            )}
        </>
    );
}

function MemoryFullscreen() {
    const picture = useShown();
    const fullBoxRef = useRef<HTMLDivElement | null>(null);
    const clip = picture?.clip ?? null;
    const full = clip ? null : (picture?.full ?? null);

    useEffect(() => {
        const box = fullBoxRef.current;
        if (!box || !full) {
            return;
        }
        const image = box.querySelector("img");
        if (!image) {
            return;
        }
        let reported = false;
        function report() {
            if (reported || !image) {
                return;
            }
            reported = true;
            if (image.naturalWidth === 0) {
                logError("memories: the fullscreen overlay couldn't load the picture", full);
                return;
            }
            if (!debugLoggingEnabled()) {
                return;
            }
            const rect = image.getBoundingClientRect();
            const doc = image.ownerDocument;
            logFocusDebug(
                "memories-fullscreen",
                `${Math.round(rect.width)}x${Math.round(rect.height)}`,
                `source=${image.naturalWidth}x${image.naturalHeight} `
                + `dpr=${doc.defaultView?.devicePixelRatio ?? 0} `
                + `path=${doc.location?.pathname ?? "?"} `
                + `focused=${doc.hasFocus()}`
            );
        }
        if (image.complete) {
            report();
            return;
        }
        image.addEventListener("load", report);
        image.addEventListener("error", report);
        return () => {
            image.removeEventListener("load", report);
            image.removeEventListener("error", report);
        };
    }, [full]);

    if (!picture) {
        return null;
    }

    return (
        <>
            {hasCompositionHold() && <CompositionHold owner={GLOBAL_COMPONENT} />}
            <div
                style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    width: "100vw",
                    height: "100vh",
                    background: "#000000",
                    zIndex: OVERLAY_Z_INDEX,
                    pointerEvents: "none"
                }}
            >
                {picture.thumb ? (
                    <FadeImage
                        src={picture.thumb}
                        fadeOnLoad={false}
                        decoding="async"
                        style={LAYER_STYLE}
                    />
                ) : null}
                {full ? (
                    <div ref={fullBoxRef} style={{ position: "absolute", inset: 0 }}>
                        <FadeImage
                            src={full}
                            fadeOnLoad
                            decoding="async"
                            style={LAYER_STYLE}
                        />
                    </div>
                ) : null}
                {clip ? <ClipLayer clip={clip} language={picture!.language} /> : null}
            </div>
        </>
    );
}

export function registerMemoryFullscreen() {
    routerHook.addGlobalComponent(GLOBAL_COMPONENT, MemoryFullscreen);
}

export function unregisterMemoryFullscreen() {
    setShown(null);
    routerHook.removeGlobalComponent(GLOBAL_COMPONENT);
}

// Shows the picture full screen and returns the call that takes it back down.
export function showMemoryFullscreen(
    thumb: string | null,
    full: string | null,
    language: LanguageCode,
    clip: ClipSource | null = null
): () => void {
    shownToken += 1;
    const token = shownToken;
    setShown({ thumb, full, clip, language });
    return () => {
        if (shownToken === token) {
            setShown(null);
        }
    };
}

export function nudgeMemoryTransport(): void {
    nudgeTransport();
}

export function toggleMemoryPlayback(): void {
    if (!playback) {
        return;
    }
    playback.togglePause();
    nudgeTransport();
}

// A press scans for as long as the trigger is held, so a scan only ends when
// endMemorySeek sees the release or the watchdog fires.
export function beginMemorySeek(direction: 1 | -1): void {
    if (!playback) {
        return;
    }
    playback.beginSeek(direction);
    nudgeTransport();
}

export function endMemorySeek(): void {
    if (!playback) {
        return;
    }
    playback.endSeek();
    nudgeTransport();
}

export function skipMemoryPlayback(direction: 1 | -1): void {
    if (!playback) {
        return;
    }
    playback.skip(direction);
    nudgeTransport();
}
