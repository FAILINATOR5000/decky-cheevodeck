import { useEffect, useState } from "react";

import { getCachedGameImageDataUri, getGameImageCached } from "../../api";
import { AwardStatusBadge } from "../achievements/AwardStatusBadge";
import { FadeImage } from "../ui/FadeImage";
import { t, type LanguageCode } from "../../locales";
import { consoleInlineName } from "../../utils/consoles";
import { logError } from "../../utils/errors";
import { bannerSize, headerSize, textSize } from "../../utils/scale";
import { bodyTextStyle } from "../../utils/style";

type GameHeaderArt = {
    iconUri: string | null;
    iconCold: boolean;
    ingameUri: string | null;
    ingameCold: boolean;
};

export function useGameHeaderArt(
    gameId: number | null,
    iconUrl: string | null | undefined,
    ingameUrl: string | null | undefined,
    enabled: boolean
): GameHeaderArt {
    const [art, setArt] = useState<GameHeaderArt>(() => {
        const iconUri = getCachedGameImageDataUri(gameId, "icon");
        const ingameUri = getCachedGameImageDataUri(gameId, "ingame");
        return { iconUri, iconCold: iconUri === null, ingameUri, ingameCold: ingameUri === null };
    });

    useEffect(() => {
        if (!enabled || gameId === null) {
            setArt({ iconUri: null, iconCold: false, ingameUri: null, ingameCold: false });
            return;
        }
        const iconUri = getCachedGameImageDataUri(gameId, "icon");
        const ingameUri = getCachedGameImageDataUri(gameId, "ingame");
        setArt({ iconUri, iconCold: iconUri === null, ingameUri, ingameCold: ingameUri === null });
        let cancelled = false;
        for (const kind of ["icon", "ingame"] as const) {
            const url = kind === "icon" ? iconUrl : ingameUrl;
            void (async () => {
                try {
                    const result = await getGameImageCached(gameId, kind, url ?? null);
                    if (!cancelled && result?.dataUri) {
                        const dataUri = result.dataUri;
                        setArt((from) => kind === "icon" ? { ...from, iconUri: dataUri } : { ...from, ingameUri: dataUri });
                    }
                }
                catch (e) {
                    logError("GameHeaderCard getGameImageCached", e);
                }
            })();
        }
        return () => {
            cancelled = true;
        };
    }, [gameId, iconUrl, ingameUrl, enabled]);

    return art;
}

type GameHeaderCardProps = GameHeaderArt & {
    title: string | null;
    consoleName: string | null;
    completion: string | null;
    highestAwardKind: string | null | undefined;
    language: LanguageCode;
};

export function GameHeaderCard(props: GameHeaderCardProps) {
    const { language, iconUri, ingameUri } = props;
    const artHeight = bannerSize(64);
    const gap = textSize(8);
    const imageStyle = {
        height: `${artHeight}px`,
        borderRadius: `${textSize(8)}px`,
        display: "block",
        flexShrink: 0
    };
    return (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: `${textSize(6)}px`, alignItems: "flex-start" }}>
            {(iconUri || ingameUri) && (
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: `${gap}px`, minWidth: 0 }}>
                    {iconUri && (
                        <FadeImage
                            src={iconUri}
                            fadeOnLoad={props.iconCold}
                            style={{ ...imageStyle, width: `${artHeight}px`, objectFit: "cover" }}
                        />
                    )}
                    {iconUri && ingameUri && (
                        <div style={{ width: "1px", alignSelf: "stretch", background: "rgba(255,255,255,0.18)", flexShrink: 0 }} />
                    )}
                    {ingameUri && (
                        <FadeImage
                            src={ingameUri}
                            fadeOnLoad={props.ingameCold}
                            style={{ ...imageStyle, width: "auto", objectFit: "contain" }}
                        />
                    )}
                </div>
            )}
            <div
                style={{
                    fontSize: `${headerSize(18)}px`,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    textAlign: "left",
                    wordBreak: "break-word"
                }}
            >
                {props.title ?? t(language, "No game found")}
            </div>
            <AwardStatusBadge language={language} kind={props.highestAwardKind} />
            <div style={{ ...bodyTextStyle(), textAlign: "left" }}>
                {props.consoleName ? consoleInlineName(props.consoleName) : ""}
                {props.consoleName && props.completion ? " • " : ""}
                {props.completion ? t(language, "Completion: {{value}}", { value: props.completion }) : ""}
                {!props.consoleName && !props.completion ? "\u00a0" : ""}
            </div>
        </div>
    );
}
