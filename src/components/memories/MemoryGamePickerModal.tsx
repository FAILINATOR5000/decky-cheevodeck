import React, { useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { FocusableItem } from "../ui/FocusableItem";
import { FadeImage } from "../ui/FadeImage";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { useGameIcon } from "../../hooks/useGameIcon";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { prefetchGameIcons } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES } from "../../utils/style";
import { ALL_GAMES_ID, MISC_GAME_ID } from "../../utils/memories";
import { searchKey } from "../../utils/searchText";
import { consoleInlineName, consoleSearchName } from "../../utils/consoles";
import type { MemoryGameRow } from "../../types";

const GAMES_INITIAL_ROWS = 30;
const GAMES_ROW_STEP = 50;
const GAMES_SENTINEL_ROOT_MARGIN_PX = 600;

const SEARCH_THRESHOLD = 12;

export type MemoryGamePickerModalProps = {
    games: MemoryGameRow[];
    selected: number | null;
    language: LanguageCode;
    showIcons: boolean;
    onSelect: (gameId: number) => void;
    close: () => void;
};

type GameRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    iconSize: number;
    onSelect: (gameId: number) => void;
    onRowFocus: (index: number) => void;
};

const GameRow = React.memo(function GameRow(props: {
    game: MemoryGameRow;
    index: number;
    selected: boolean;
    list: GameRowListProps;
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
}) {
    const { game, index, selected, list } = props;
    const iconGameId = list.showIcons && game.gameId !== MISC_GAME_ID ? game.gameId : null;
    const { iconDataUri, cold } = useGameIcon(iconGameId, game.imageIcon || null, "MemoryGamePickerModal useGameIcon");
    const size = list.iconSize;

    const title = game.gameId === MISC_GAME_ID
        ? t(list.language, "Uncategorized")
        : (game.gameTitle || t(list.language, "Unknown game"));

    const system = game.gameId === MISC_GAME_ID ? "" : consoleInlineName(game.consoleName || "");

    return (
        <FocusableItem
            focusKey={`memories:game:${game.gameId}`}
            onClick={() => list.onSelect(game.gameId)}
            onFocus={() => list.onRowFocus(index)}
            onGamepadFocus={() => list.onRowFocus(index)}
            onGamepadDirection={props.onGamepadDirection}
        >
            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "4px 0" }}>
                {list.showIcons && (
                    <div
                        style={{
                            width: `${size}px`,
                            height: `${size}px`,
                            borderRadius: "7px",
                            overflow: "hidden",
                            flexShrink: 0,
                            background: "rgba(255,255,255,0.10)",
                            border: "1px solid rgba(255,255,255,0.12)"
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
                        {title}
                    </span>
                    {system ? (
                        <span
                            style={{
                                fontSize: `${modalSize(12)}px`,
                                opacity: 0.7,
                                wordBreak: "break-word"
                            }}
                        >
                            {system}
                        </span>
                    ) : null}
                </div>
                <span style={{ fontSize: `${modalSize(13)}px`, opacity: 0.7, fontWeight: 700, flexShrink: 0 }}>
                    {game.count}
                </span>
            </div>
        </FocusableItem>
    );
});

export function MemoryGamePickerModal(props: MemoryGamePickerModalProps) {
    const { games, selected, language, showIcons, onSelect, close } = props;

    const [query, setQuery] = useState("");

    const searchShown = games.length > SEARCH_THRESHOLD;

    const titleKeys = useMemo(
        () => games.map((game) => searchKey(
            (game.gameId === MISC_GAME_ID ? t(language, "Uncategorized") : game.gameTitle)
            + " " + consoleSearchName(game.consoleName || "")
        )),
        [games, language]
    );

    const filteredGames = useMemo(() => {
        const wanted = searchKey(query.trim());
        if (!wanted) {
            return games;
        }
        return games.filter((_game, index) => titleKeys[index].includes(wanted));
    }, [games, titleKeys, query]);

    const gameWindow = useSlidingWindow({
        items: filteredGames,
        itemKey: (game) => String(game.gameId),
        focusKeyFor: (game) => `memories:game:${game.gameId}`,
        windowId: "memories:gamepicker",
        heightScope: ["memories:gamepicker", getCurrentModalScale(), showIcons, language].join("|"),
        dynamicLoading: true,
        initialRows: GAMES_INITIAL_ROWS,
        rowStep: GAMES_ROW_STEP,
        prefetchDistance: 8,
        sentinelRootMarginPx: GAMES_SENTINEL_ROOT_MARGIN_PX,
        resetKey: `memoriesgame:${query}`,
        debugLabel: "memories:gamepicker"
    });
    const visibleGames = gameWindow.mountedItems;
    const onItemFocus = gameWindow.onItemFocus;

    useEffect(() => {
        if (!showIcons || visibleGames.length === 0) {
            return;
        }
        void prefetchGameIcons(
            visibleGames
                .filter((game) => game.gameId !== MISC_GAME_ID)
                .map((game) => ({ gameId: game.gameId, imageIcon: game.imageIcon || null }))
        );
    }, [visibleGames, showIcons]);

    function pick(gameId: number) {
        onSelect(gameId);
        close();
    }

    const pickRef = useRef(pick);
    pickRef.current = pick;

    const focusRef = useRef(onItemFocus);
    focusRef.current = onItemFocus;

    const rowList = useMemo<GameRowListProps>(() => ({
        language,
        showIcons,
        iconSize: modalSize(28),
        onSelect: (gameId) => {
            pickRef.current(gameId);
        },
        onRowFocus: (index) => {
            focusRef.current(index);
        }
    }), [language, showIcons]);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "12px" }}>
                {t(language, "Game")}
            </div>
            {searchShown && (
                <Focusable style={{ marginBottom: "10px" }} autoFocus>
                    <TextField
                        value={query}
                        placeholder={t(language, "Search")}
                        onChange={(e: { target: { value: string } }) => setQuery(e.target.value)}
                    />
                </Focusable>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <FocusableItem
                    focusKey="memories:game:all"
                    onClick={() => pick(ALL_GAMES_ID)}
                    autoFocus={!searchShown}
                >
                    <div
                        style={{
                            width: "100%",
                            padding: "6px 0",
                            fontSize: `${modalSize(15)}px`,
                            fontWeight: selected === ALL_GAMES_ID ? 800 : 600
                        }}
                    >
                        {t(language, "All Games")}
                    </div>
                </FocusableItem>
                {filteredGames.length > 0 && (
                    <div style={{ height: "1px", background: "rgba(255,255,255,0.14)", margin: "6px 0" }} />
                )}
                {query && filteredGames.length === 0 && (
                    <div style={{ padding: "8px 0", fontSize: `${modalSize(13)}px`, opacity: 0.75 }}>
                        {t(language, "No games match that search.")}
                    </div>
                )}
                <SlidingWindowRows list={gameWindow}>
                    {visibleGames.map((game, index) => (
                        <div key={game.gameId} style={{ paddingBottom: "2px" }}>
                            <GameRow
                                game={game}
                                index={gameWindow.start + index}
                                selected={selected === game.gameId}
                                list={rowList}
                                onGamepadDirection={gameWindow.guardTopRow(gameWindow.start + index)}
                            />
                        </div>
                    ))}
                </SlidingWindowRows>
            </div>
            <Focusable style={{ display: "flex", marginTop: "14px" }}>
                <DialogButton onClick={close} style={{ width: "100%" }}>
                    {t(language, "Close")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}
