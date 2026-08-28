import React, { useEffect, useMemo, useRef } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import type { SavedCommentGame, SavedCommentsFilter } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { FocusableItem } from "../ui/FocusableItem";
import { FadeImage } from "../ui/FadeImage";
import { useGameIcon } from "../../hooks/useGameIcon";
import { useWindowedList } from "../../hooks/useWindowedList";
import { prefetchGameIcons } from "../../api";
import { modalSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES } from "../../utils/style";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const GAMES_INITIAL_ROWS = 30;
const GAMES_ROW_STEP = 50;
const GAMES_SENTINEL_ROOT_MARGIN = "300px";

export type SavedCommentsFilterModalProps = {
    games: SavedCommentGame[];
    selected: SavedCommentsFilter;
    language: LanguageCode;
    showIcons: boolean;
    onSelect: (filter: SavedCommentsFilter) => void;
    close: () => void;
};

function OptionRow(props: {
    label: string;
    focusKey: string;
    selected: boolean;
    onSelect: () => void;
}) {
    const { label, focusKey, selected, onSelect } = props;
    return (
        <FocusableItem focusKey={focusKey} onClick={onSelect}>
            <div
                style={{
                    width: "100%",
                    padding: "6px 0",
                    fontSize: `${modalSize(15)}px`,
                    fontWeight: selected ? 800 : 600
                }}
            >
                {label}
            </div>
        </FocusableItem>
    );
}

type GameRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    iconSize: number;
    onSelect: (gameId: number) => void;
};

type GameRowProps = {
    game: SavedCommentGame;
    selected: boolean;
    list: GameRowListProps;
};

const GameRow = React.memo(function GameRow(props: GameRowProps) {
    const { game, selected, list } = props;
    const { language, showIcons } = list;
    const { iconDataUri, cold } = useGameIcon(
        showIcons ? game.gameId : null,
        game.imageIcon || null,
        "SavedCommentsFilterModal useGameIcon"
    );
    const size = list.iconSize;

    function handleSelect() {
        list.onSelect(game.gameId);
    }

    return (
        <FocusableItem focusKey={`savedfilter:game:${game.gameId}`} onClick={handleSelect}>
            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "4px 0" }}>
                {showIcons && (
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
                            justifyContent: "center"
                        }}
                    >
                        {iconDataUri ? (
                            <FadeImage
                                src={iconDataUri}
                                fadeOnLoad={cold}
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                        ) : null}
                    </div>
                )}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span
                        style={{
                            fontSize: `${modalSize(15)}px`,
                            fontWeight: selected ? 800 : 600,
                            wordBreak: "break-word"
                        }}
                    >
                        {game.title || t(language, "Unknown game")}
                    </span>
                </div>
                <span style={{ fontSize: `${modalSize(13)}px`, opacity: 0.7, fontWeight: 700, flexShrink: 0 }}>
                    {game.count}
                </span>
            </div>
        </FocusableItem>
    );
});

export function SavedCommentsFilterModal(props: SavedCommentsFilterModalProps) {
    const { games, selected, language, showIcons, onSelect, close } = props;

    const { mountedItems: visibleGames, markerRef: gamesMarkerRef } = useWindowedList({
        items: games,
        dynamicLoading: true,
        initialRows: GAMES_INITIAL_ROWS,
        rowStep: GAMES_ROW_STEP,
        prefetchDistance: 8,
        sentinelRootMargin: GAMES_SENTINEL_ROOT_MARGIN,
        resetKey: "savedfilter"
    });

    useEffect(() => {
        if (!showIcons || visibleGames.length === 0) {
            return;
        }
        void prefetchGameIcons(visibleGames.map((game) => ({ gameId: game.gameId, imageIcon: game.imageIcon || null })));
    }, [visibleGames, showIcons]);

    function pick(filter: SavedCommentsFilter) {
        onSelect(filter);
        close();
    }

    const pickRef = useRef(pick);
    pickRef.current = pick;

    const rowList = useMemo<GameRowListProps>(() => ({
        language,
        showIcons,
        iconSize: modalSize(28),
        onSelect: (gameId) => {
            pickRef.current(gameId);
        }
    }), [language, showIcons]);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "12px" }}>
                {t(language, "Filter")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <OptionRow
                    label={t(language, "All")}
                    focusKey="savedfilter:all"
                    selected={selected === "all"}
                    onSelect={() => pick("all")}
                />
                <OptionRow
                    label={t(language, "Achievement")}
                    focusKey="savedfilter:achievement"
                    selected={selected === "achievement"}
                    onSelect={() => pick("achievement")}
                />
                <OptionRow
                    label={t(language, "Wall Posts")}
                    focusKey="savedfilter:wall"
                    selected={selected === "wall"}
                    onSelect={() => pick("wall")}
                />
                {games.length > 0 && (
                    <div
                        style={{
                            height: "1px",
                            background: "rgba(255,255,255,0.14)",
                            margin: "6px 0"
                        }}
                    />
                )}
                {visibleGames.map((game) => (
                    <GameRow
                        key={game.gameId}
                        game={game}
                        selected={selected === game.gameId}
                        list={rowList}
                    />
                ))}
                {visibleGames.length < games.length && (
                    <div ref={gamesMarkerRef} style={{ height: "1px" }} />
                )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
                <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
                    <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
                </Focusable>
            </div>
        </ModalRoot>
    );
}

