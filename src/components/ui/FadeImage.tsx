import { useRef, useState, type AnimationEvent, type CSSProperties } from "react";

const FADE_MS = 250;

export type FadeImageProps = {
    src?: string | null;
    alt?: string;
    fadeOnLoad?: boolean;
    fadeMs?: number;
    decoding?: "async" | "sync" | "auto";
    style?: CSSProperties;
};

export function FadeImage(props: FadeImageProps) {
    const { src, alt, fadeOnLoad, fadeMs, decoding, style } = props;
    const shouldFade = useRef<boolean | null>(src ? fadeOnLoad === true : null);
    if (shouldFade.current === null && src) {
        shouldFade.current = fadeOnLoad === true;
    }
    const [fadeDone, setFadeDone] = useState(false);
    const fading = shouldFade.current === true && !fadeDone && !!src;

    function handleAnimationEnd(event: AnimationEvent<HTMLImageElement>) {
        if (event.animationName === "da-fade-in") {
            setFadeDone(true);
        }
    }

    return (
        <img
            src={src || undefined}
            alt={alt || ""}
            decoding={decoding}
            className={fading ? "da-fade-image" : undefined}
            style={{
                ...style,
                animation: fading
                    ? `da-fade-in ${fadeMs ?? FADE_MS}ms ease-out`
                    : undefined
            }}
            onAnimationEnd={fading ? handleAnimationEnd : undefined}
        />
    );
}
