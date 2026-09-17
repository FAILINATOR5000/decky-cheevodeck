import { routerHook } from "@decky/api";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { CompositionHold, hasCompositionHold } from "../ui/compositionHold";
import { FadeImage } from "../ui/FadeImage";
import { logFocusDebug } from "../../api";
import { logError } from "../../utils/errors";

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

type FullscreenPicture = {
    thumb: string | null;
    full: string | null;
};

let shown: FullscreenPicture | null = null;

let shownToken = 0;

const listeners = new Set<(picture: FullscreenPicture | null) => void>();

function samePicture(a: FullscreenPicture | null, b: FullscreenPicture | null) {
    if (a === b) {
        return true;
    }
    return Boolean(a && b && a.thumb === b.thumb && a.full === b.full);
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

function MemoryFullscreen() {
    const picture = useShown();
    const fullBoxRef = useRef<HTMLDivElement | null>(null);
    const full = picture?.full ?? null;

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
export function showMemoryFullscreen(thumb: string | null, full: string | null): () => void {
    shownToken += 1;
    const token = shownToken;
    setShown({ thumb, full });
    return () => {
        if (shownToken === token) {
            setShown(null);
        }
    };
}
