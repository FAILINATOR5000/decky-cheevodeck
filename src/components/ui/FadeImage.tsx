import { useRef, useState, type AnimationEvent, type CSSProperties } from "react";

const FADE_MS = 250;

export type FadeImageProps = {
    src: string;
    alt?: string;
    fadeOnLoad?: boolean;
    decoding?: "async" | "sync" | "auto";
    style?: CSSProperties;
};

export function FadeImage(props: FadeImageProps) {
    const { src, alt, fadeOnLoad, decoding, style } = props;
    const shouldFade = useRef(fadeOnLoad === true);
    const [fadeDone, setFadeDone] = useState(false);
    const fading = shouldFade.current && !fadeDone;

    function handleAnimationEnd(event: AnimationEvent<HTMLImageElement>) {
        if (event.animationName === "da-fade-in") {
            setFadeDone(true);
        }
    }

    return (
        <img
            src={src}
            alt={alt || ""}
            decoding={decoding}
            className={fading ? "da-fade-image" : undefined}
            style={{
                ...style,
                animation: fading
                    ? `da-fade-in ${FADE_MS}ms ease-out`
                    : undefined
            }}
            onAnimationEnd={fading ? handleAnimationEnd : undefined}
        />
    );
}
