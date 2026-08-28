import { type ReactNode } from "react";
import { useGameIcon } from "../../hooks/useGameIcon";
import { FadeImage } from "../ui/FadeImage";

export type SetMosaicEntry = {
    gameId: number;
    imageIcon: string | null;
};

const GRID_TILE_COUNT = 4;

export type SetMosaicBannerProps = {
    entries: SetMosaicEntry[];
    mosaicSize?: number;
    children: ReactNode;
};

function MosaicTile(props: { entry: SetMosaicEntry; radius: number }) {
    const { entry, radius } = props;
    const { iconDataUri, cold } = useGameIcon(entry.gameId, entry.imageIcon, "getGameIconCached (set mosaic tile)");

    return (
        <div
            style={{
                width: "100%",
                height: "100%",
                borderRadius: `${radius}px`,
                overflow: "hidden",
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.12)"
            }}
        >
            {iconDataUri && (
                <FadeImage
                    src={iconDataUri}
                    fadeOnLoad={cold}
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block"
                    }}
                />
            )}
        </div>
    );
}

export function SetMosaicSquare(props: { entries: SetMosaicEntry[]; size: number }) {
    const { entries, size } = props;
    const showGrid = entries.length >= GRID_TILE_COUNT;

    return (
        <div
            style={{
                width: `${size}px`,
                height: `${size}px`,
                flexShrink: 0
            }}
        >
            {showGrid ? (
                <div
                    style={{
                        width: "100%",
                        height: "100%",
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gridTemplateRows: "1fr 1fr",
                        gap: "2px"
                    }}
                >
                    {entries.slice(0, GRID_TILE_COUNT).map((entry) => (
                        <MosaicTile key={`g:${entry.gameId}`} entry={entry} radius={4} />
                    ))}
                </div>
            ) : (
                <MosaicTile key={`g:${entries[0].gameId}`} entry={entries[0]} radius={7} />
            )}
        </div>
    );
}

export function SetMosaicBanner(props: SetMosaicBannerProps) {
    const { entries, mosaicSize = 44, children } = props;
    const hasMosaic = entries.length > 0;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                width: "100%",
                textAlign: "left"
            }}
        >
            {hasMosaic && (
                <SetMosaicSquare entries={entries} size={mosaicSize} />
            )}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                {children}
            </div>
        </div>
    );
}
