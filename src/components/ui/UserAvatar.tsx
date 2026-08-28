import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
    getCachedUserAvatarDataUri,
    isUserAvatarBatchPending,
    resolveUserAvatar,
    subscribeToUserAvatar
} from "../../api";
import { FadeImage } from "./FadeImage";
import { logError } from "../../utils/errors";

export type UserAvatarProps = {
    username: string;
    size: number;
    fontSize: number;
    wrapperStyle?: CSSProperties;
    letterStyle?: CSSProperties;
};

function letterFor(username: string): string {
    const trimmed = username.trim();
    if (!trimmed) {
        return "?";
    }
    return trimmed.slice(0, 1).toUpperCase();
}

export function UserAvatar(props: UserAvatarProps) {
    const {
        username,
        size,
        fontSize,
        wrapperStyle,
        letterStyle
    } = props;
    const trimmedUsername = String(username || "").trim();
    const lowered = trimmedUsername.toLowerCase();

    const [resolvedDataUri, setResolvedDataUri] = useState<string | null>(() =>
        getCachedUserAvatarDataUri(lowered)
    );
    const wasWarmAtMount = useRef(resolvedDataUri !== null);

    useEffect(() => {
        if (!lowered) {
            return;
        }

        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let firedFallback = false;

        async function fetchOnce(): Promise<string | null> {
            try {
                const result = await resolveUserAvatar(trimmedUsername);
                if (cancelled) {
                    return null;
                }
                if (result?.dataUri) {
                    setResolvedDataUri(result.dataUri);
                    return result.dataUri;
                }
                return null;
            }
            catch (e) {
                logError("UserAvatar resolveUserAvatar", e);
                return null;
            }
        }

        function kickFallback() {
            if (cancelled || firedFallback) {
                return;
            }
            firedFallback = true;
            void (async () => {
                const got = await fetchOnce();
                if (got || cancelled) {
                    return;
                }
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    void fetchOnce();
                }, 1500);
            })();
        }

        const unsubscribe = subscribeToUserAvatar(lowered, (dataUri) => {
            if (cancelled) {
                return;
            }
            if (dataUri) {
                setResolvedDataUri(dataUri);
                return;
            }
            kickFallback();
        });

        const cached = getCachedUserAvatarDataUri(lowered);
        if (cached) {
            setResolvedDataUri(cached);
            return () => {
                cancelled = true;
                unsubscribe();
                if (retryTimer !== null) {
                    clearTimeout(retryTimer);
                }
            };
        }

        if (isUserAvatarBatchPending(lowered)) {
            return () => {
                cancelled = true;
                unsubscribe();
                if (retryTimer !== null) {
                    clearTimeout(retryTimer);
                }
            };
        }

        kickFallback();

        return () => {
            cancelled = true;
            unsubscribe();
            if (retryTimer !== null) {
                clearTimeout(retryTimer);
            }
        };
    }, [lowered, trimmedUsername]);

    const displayedSrc = resolvedDataUri || "";

    return (
        <div
            style={{
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: "7px",
                overflow: "hidden",
                flexShrink: 0,
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: `${fontSize}px`,
                fontWeight: 800,
                ...wrapperStyle
            }}
        >
            {displayedSrc ? (
                <FadeImage
                    src={displayedSrc}
                    fadeOnLoad={!wasWarmAtMount.current}
                    decoding="async"
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block"
                    }}
                />
            ) : letterStyle ? (
                <div style={letterStyle}>{letterFor(trimmedUsername)}</div>
            ) : (
                letterFor(trimmedUsername)
            )}
        </div>
    );
}
