import { useEffect, useRef, useState } from "react";
import { PanelSectionRow } from "@decky/ui";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import {
    cacheAchievementIcons,
    getAchievementIcons,
    getCachedAchievementIcons,
    getCachedGameIconDataUri,
    getGameIconCached
} from "../../api";
import type { AchievementOfTheWeekPayload, UiSize } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { formatInteger } from "../../utils/format";
import { formatUnlockDate } from "../../utils/achievements";
import { achievementUiMetrics, smallTextStyle, achievementGreen, skyBlue } from "../../utils/style";
import { logError } from "../../utils/errors";

export type AotwHeaderProps = {
    payload: AchievementOfTheWeekPayload;
    currentUserHasUnlocked: boolean;
    language: LanguageCode;
    uiSize: UiSize;
    showIcons: boolean;
    onClickGameTitle?: () => void | Promise<void>;
};

export function AotwHeader(props: AotwHeaderProps) {
    const { payload, currentUserHasUnlocked, language, uiSize, showIcons, onClickGameTitle } = props;
    const metrics = achievementUiMetrics(uiSize);

    const gameId = payload.game?.id ?? null;
    const badgeName = String(payload.achievement?.badgeName || "").trim();
    const [gameIconDataUri, setGameIconDataUri] = useState<string | null>(() =>
        getCachedGameIconDataUri(gameId)
    );
    const [badgeDataUri, setBadgeDataUri] = useState<string | null>(() => {
        if (gameId == null || !badgeName) {
            return null;
        }
        const cached = getCachedAchievementIcons(gameId, [badgeName]);
        return cached[badgeName] || null;
    });
    const gameIconWasWarmAtMount = useRef(gameIconDataUri !== null);
    const badgeWasWarmAtMount = useRef(badgeDataUri !== null);

    useEffect(() => {
        if (!showIcons || gameId == null) {
            setGameIconDataUri(null);
            return;
        }

        const cached = getCachedGameIconDataUri(gameId);
        if (cached) {
            setGameIconDataUri(cached);
        }
        else {
            setGameIconDataUri(null);
        }

        let cancelled = false;
        void (async () => {
            try {
                const result = await getGameIconCached(gameId, payload.game?.imageIcon ?? null);
                if (cancelled) {
                    return;
                }
                if (result?.dataUri) {
                    setGameIconDataUri(result.dataUri);
                }
            }
            catch (e) {
                logError("AotwHeader getGameIconCached", e);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [gameId, showIcons]);

    useEffect(() => {
        if (!showIcons || gameId == null || !badgeName) {
            setBadgeDataUri(null);
            return;
        }

        const cached = getCachedAchievementIcons(gameId, [badgeName]);
        if (cached[badgeName]) {
            setBadgeDataUri(cached[badgeName]);
            return;
        }
        setBadgeDataUri(null);

        let cancelled = false;
        void (async () => {
            try {
                const result = await getAchievementIcons(gameId, [badgeName]);
                if (cancelled) {
                    return;
                }
                const icons = result?.icons ?? {};
                if (Object.keys(icons).length > 0) {
                    cacheAchievementIcons(gameId, icons);
                }
                const dataUri = icons[badgeName];
                if (dataUri) {
                    setBadgeDataUri(dataUri);
                }
            }
            catch (e) {
                logError("AotwHeader getAchievementIcons", e);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [gameId, badgeName, showIcons]);

    const badgeSrc = String(badgeDataUri || payload.achievement?.badgeUrl || "").trim();
    const achievementTitle = String(payload.achievement?.title || "").trim();
    const achievementDescription = String(payload.achievement?.description || "").trim();
    const gameTitle = String(payload.game?.title || "").trim();
    const consoleTitle = String(payload.console?.title || "").trim();
    const startedAt = formatUnlockDate(payload.startAt, { includeYear: true }, language);

    const totalPlayers = formatInteger(payload.totalPlayers);
    const unlocksCount = payload.unlocksCount >= 500
        ? `${formatInteger(500)}+`
        : formatInteger(payload.unlocksCount);

    const badgeSize = Math.round(metrics.iconSize * 1.6);
    const gameIconSize = Math.round(metrics.iconSize * 0.9);

    return (
        <>
            <PanelSectionRow>
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        gap: `${Math.max(10, metrics.iconGap)}px`,
                        alignItems: "flex-start",
                        padding: "4px 0",
                        minWidth: 0
                    }}
                >
                    {showIcons && (
                        <div
                            style={{
                                width: `${badgeSize}px`,
                                height: `${badgeSize}px`,
                                borderRadius: "8px",
                                overflow: "hidden",
                                flexShrink: 0,
                                background: "rgba(255,255,255,0.10)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                        >
                            {badgeSrc ? (
                                <FadeImage
                                    src={badgeSrc}
                                    fadeOnLoad={!badgeWasWarmAtMount.current}
                                    style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        display: "block"
                                    }}
                                />
                            ) : null}
                        </div>
                    )}
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: `${Math.max(3, metrics.contentGap)}px`,
                            textAlign: "left"
                        }}
                    >
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.pointsFontSize}px`,
                                lineHeight: metrics.pointsLineHeight,
                                opacity: 0.85,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.04em"
                            }}
                        >
                            {t(language, "Achievement of the Week")}
                        </div>
                        <div
                            style={{
                                fontSize: `${metrics.titleFontSize}px`,
                                lineHeight: metrics.titleLineHeight,
                                fontWeight: 800,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {achievementTitle}
                        </div>
                        {achievementDescription && (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.bodyFontSize}px`,
                                    lineHeight: metrics.bodyLineHeight,
                                    opacity: 0.9,
                                    minWidth: 0,
                                    wordBreak: "break-word"
                                }}
                            >
                                {achievementDescription}
                            </div>
                        )}
                        {currentUserHasUnlocked && (
                            <div
                                style={{
                                    alignSelf: "flex-start",
                                    fontSize: `${metrics.pointsFontSize}px`,
                                    lineHeight: metrics.pointsLineHeight,
                                    fontWeight: 800,
                                    padding: "2px 8px",
                                    borderRadius: "10px",
                                    background: "rgba(34, 197, 94, 0.18)",
                                    border: "1px solid rgba(34, 197, 94, 0.45)",
                                    color: achievementGreen
                                }}
                            >
                                {t(language, "Unlocked")}
                            </div>
                        )}
                    </div>
                </div>
            </PanelSectionRow>
            <PanelSectionRow>
                {(() => {
                    const rowBody = (
                        <div
                            style={{
                                width: "100%",
                                display: "flex",
                                gap: `${Math.max(8, metrics.iconGap)}px`,
                                alignItems: "center",
                                padding: "2px 0",
                                minWidth: 0
                            }}
                        >
                            {showIcons && (
                                <div
                                    style={{
                                        width: `${gameIconSize}px`,
                                        height: `${gameIconSize}px`,
                                        borderRadius: "6px",
                                        overflow: "hidden",
                                        flexShrink: 0,
                                        background: "rgba(255,255,255,0.08)",
                                        border: "1px solid rgba(255,255,255,0.10)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center"
                                    }}
                                >
                                    {gameIconDataUri ? (
                                        <FadeImage
                                            src={gameIconDataUri}
                                            fadeOnLoad={!gameIconWasWarmAtMount.current}
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                                objectFit: "cover",
                                                display: "block"
                                            }}
                                        />
                                    ) : null}
                                </div>
                            )}
                            <div
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "2px",
                                    textAlign: "left"
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: `${metrics.bodyFontSize + 1}px`,
                                        lineHeight: metrics.bodyLineHeight,
                                        fontWeight: 700,
                                        color: skyBlue,
                                        minWidth: 0,
                                        wordBreak: "break-word"
                                    }}
                                >
                                    {gameTitle}
                                </div>
                                {consoleTitle && (
                                    <div
                                        style={{
                                            ...smallTextStyle(),
                                            fontSize: `${metrics.pointsFontSize}px`,
                                            lineHeight: metrics.pointsLineHeight,
                                            opacity: 0.85
                                        }}
                                    >
                                        {consoleTitle}
                                    </div>
                                )}
                            </div>
                        </div>
                    );

                    if (onClickGameTitle) {
                        return (
                            <FocusableItem
                                focusKey="aotw:header:gameTitle"
                                onClick={onClickGameTitle}
                            >
                                {rowBody}
                            </FocusableItem>
                        );
                    }
                    return rowBody;
                })()}
            </PanelSectionRow>
            <PanelSectionRow>
                <div
                    style={{
                        ...smallTextStyle(),
                        width: "100%",
                        fontSize: `${metrics.pointsFontSize}px`,
                        lineHeight: metrics.pointsLineHeight,
                        opacity: 0.9,
                        textAlign: "left",
                        padding: "2px 0"
                    }}
                >
                    {t(language, "{{players}} players · {{unlocks}} unlocks", {
                        players: totalPlayers,
                        unlocks: unlocksCount
                    })}
                    {startedAt && (
                        <>
                            {" · "}
                            {t(language, "Started {{date}}", { date: startedAt })}
                        </>
                    )}
                </div>
            </PanelSectionRow>
        </>
    );
}
