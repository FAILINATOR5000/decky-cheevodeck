import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PanelSectionRow } from "@decky/ui";
import {
    getCachedGameIconDataUri,
    getGameIconCached,
    isGameIconBatchPending,
    subscribeToGameIcon
} from "../../api";
import { FadeImage } from "../ui/FadeImage";
import { logError } from "../../utils/errors";
import { bannerSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES } from "../../utils/style";

export type GameContextBannerProps = {
    gameId: number | null;
    title: string | null | undefined;
    imageIcon: string | null | undefined;
    showIcons: boolean;
};

function bannerMetrics(): { iconSize: number; labelSize: number } {
    return {
        iconSize: bannerSize(24),
        labelSize: bannerSize(13)
    };
}

export function GameContextBanner(props: GameContextBannerProps) {
    const { gameId, title, imageIcon, showIcons } = props;

    const trimmedTitle = String(title || "").trim();

    const [iconDataUri, setIconDataUri] = useState<string | null>(() =>
        getCachedGameIconDataUri(gameId)
    );

    const hadIconAtMount = useRef(iconDataUri !== null);

    useEffect(() => {
        if (!showIcons || gameId == null) {
            setIconDataUri(null);
            return;
        }

        let cancelled = false;
        let firedFallback = false;

        function kickFallback() {
            if (cancelled || firedFallback || gameId == null) {
                return;
            }
            firedFallback = true;
            void (async () => {
                try {
                    const result = await getGameIconCached(gameId, imageIcon ?? null);
                    if (!cancelled && result?.dataUri) {
                        setIconDataUri(result.dataUri);
                    }
                }
                catch (e) {
                    logError("GameContextBanner getGameIconCached", e);
                }
            })();
        }

        const unsubscribe = subscribeToGameIcon(gameId, (dataUri) => {
            if (cancelled) {
                return;
            }
            if (dataUri) {
                setIconDataUri(dataUri);
                return;
            }
            kickFallback();
        });

        const cached = getCachedGameIconDataUri(gameId);
        if (cached) {
            setIconDataUri(cached);
            return () => {
                cancelled = true;
                unsubscribe();
            };
        }

        if (isGameIconBatchPending(gameId)) {
            return () => {
                cancelled = true;
                unsubscribe();
            };
        }

        kickFallback();

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [gameId, imageIcon, showIcons]);

    if (!trimmedTitle) {
        return null;
    }

    const metrics = bannerMetrics();

    const wrapperStyle: CSSProperties = {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "8px",
        padding: "10px 0 4px"
    };

    const labelStyle: CSSProperties = {
        flex: 1,
        minWidth: 0,
        fontSize: `${metrics.labelSize}px`,
        opacity: 0.9,
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
        textAlign: "left"
    };

    const iconBoxStyle: CSSProperties = {
        width: `${metrics.iconSize}px`,
        height: `${metrics.iconSize}px`,
        borderRadius: "7px",
        overflow: "hidden",
        flexShrink: 0,
        background: "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    };

    return (
        <PanelSectionRow>
            <div style={wrapperStyle}>
                <style>{FADE_IN_KEYFRAMES}</style>
                {showIcons ? (
                    <div style={iconBoxStyle}>
                        {iconDataUri ? (
                            <FadeImage
                                src={iconDataUri}
                                fadeOnLoad={!hadIconAtMount.current}
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block"
                                }}
                            />
                        ) : null}
                    </div>
                ) : null}
                <span style={labelStyle}>{trimmedTitle}</span>
            </div>
        </PanelSectionRow>
    );
}

