import React, { useCallback, useEffect, useRef, type ReactNode } from "react";

import { prefetchGameIcons } from "../../api";
import { useResilientGameIcon } from "../../hooks/useResilientGameIcon";
import type { TrackedSetPickerGame } from "../../types";
import { modalSize } from "../../utils/scale";
import { smallTextStyle } from "../../utils/style";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";

export function pickerRowMetrics() {
    return {
        iconSize: modalSize(44),
        iconGap: modalSize(7),
        rowPaddingY: modalSize(2),
        contentGap: modalSize(3),
        titleFontSize: modalSize(15.5),
        titleLineHeight: 1.2,
        bodyFontSize: modalSize(11.5),
        bodyLineHeight: 1.31,
        pointsFontSize: modalSize(11),
        pointsLineHeight: 1.12
    };
}

export type PickerRowMetrics = ReturnType<typeof pickerRowMetrics>;

export function pickerDetailStyle(metrics: PickerRowMetrics): React.CSSProperties {
    return {
        ...smallTextStyle(),
        fontSize: `${metrics.bodyFontSize}px`,
        lineHeight: metrics.bodyLineHeight,
        opacity: 1,
        minWidth: 0,
        wordBreak: "break-word"
    };
}

export function pickerStrongStyle(metrics: PickerRowMetrics): React.CSSProperties {
    return {
        ...smallTextStyle(),
        fontSize: `${metrics.pointsFontSize}px`,
        lineHeight: metrics.pointsLineHeight,
        opacity: 1,
        fontWeight: 800,
        minWidth: 0
    };
}

export function useWarmWindowIcons(mountedGames: TrackedSetPickerGame[], showIcons: boolean) {
    const warmedGameIdsRef = useRef<Set<number>>(new Set());

    const iconFetchInFlightRef = useRef(false);
    const desiredIconGamesRef = useRef<TrackedSetPickerGame[] | null>(null);

    const kickIconPrefetch = useCallback(async function kickIconPrefetch() {
        if (iconFetchInFlightRef.current) {
            return;
        }
        iconFetchInFlightRef.current = true;
        try {
            while (desiredIconGamesRef.current) {
                const target = desiredIconGamesRef.current;
                desiredIconGamesRef.current = null;
                const warmed = warmedGameIdsRef.current;
                const freshRows: Array<{ gameId: number; imageIcon: string | null }> = [];
                for (const game of target) {
                    if (warmed.has(game.gameId)) {
                        continue;
                    }
                    warmed.add(game.gameId);
                    freshRows.push({ gameId: game.gameId, imageIcon: game.imageIcon ?? null });
                }
                if (freshRows.length === 0) {
                    continue;
                }
                await prefetchGameIcons(freshRows);
            }
        } finally {
            iconFetchInFlightRef.current = false;
        }
    }, []);

    useEffect(function prefetchMountedWindowIcons() {
        if (!showIcons || mountedGames.length === 0) {
            return;
        }
        desiredIconGamesRef.current = mountedGames;
        void kickIconPrefetch();
    }, [mountedGames, showIcons, kickIconPrefetch]);
}

export type PickerGameRowListProps = {
    keyPrefix: string;
    showIcons: boolean;
    metrics: PickerRowMetrics;
    onPick: (game: TrackedSetPickerGame) => void;
    onRowFocus: (index: number) => void;
    detail: (game: TrackedSetPickerGame) => ReactNode;
};

type PickerGameRowProps = {
    game: TrackedSetPickerGame;
    index: number;
    list: PickerGameRowListProps;
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
};

export const PickerGameRow = React.memo(function PickerGameRow(props: PickerGameRowProps) {
    const { game, list } = props;
    const { showIcons, metrics } = list;

    const { iconDataUri, cold } = useResilientGameIcon(game.gameId, game.imageIcon, "getGameIconCached (search picker row)");

    const fallbackLetter = game.title.trim().charAt(0).toUpperCase() || "?";

    function handleClick() {
        list.onPick(game);
    }

    function handleFocus() {
        list.onRowFocus(props.index);
    }

    return (
        <FocusableItem
            focusKey={`${list.keyPrefix}${game.gameId}`}
            onClick={handleClick}
            onFocus={handleFocus}
            onGamepadFocus={handleFocus}
            onGamepadDirection={props.onGamepadDirection}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "flex-start",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    minWidth: 0
                }}
            >
                {showIcons && (
                    <div
                        style={{
                            width: `${metrics.iconSize}px`,
                            height: `${metrics.iconSize}px`,
                            borderRadius: "7px",
                            overflow: "hidden",
                            flexShrink: 0,
                            background: "rgba(255,255,255,0.10)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: `${Math.max(16, metrics.iconSize * 0.42)}px`,
                            fontWeight: 800,
                            position: "relative"
                        }}
                    >
                        {iconDataUri ? null : fallbackLetter}
                        <FadeImage
                            src={iconDataUri}
                            fadeOnLoad={cold}
                            decoding="async"
                            style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                display: "block"
                            }}
                        />
                    </div>
                )}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: `${Math.max(2, metrics.contentGap - 1)}px`,
                        textAlign: "left"
                    }}
                >
                    <div
                        style={{
                            fontSize: `${metrics.titleFontSize}px`,
                            lineHeight: metrics.titleLineHeight,
                            fontWeight: 800,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {game.title}
                    </div>
                    {list.detail(game)}
                </div>
            </div>
        </FocusableItem>
    );
});
