import React, { useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import type { SavedCommentGame, SavedCommentsFilter } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { FocusableItem } from "../ui/FocusableItem";
import { SubTabButton } from "../ui/SubTabButton";
import { FadeImage } from "../ui/FadeImage";
import { useGameIcon } from "../../hooks/useGameIcon";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { prefetchGameIcons } from "../../api";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES } from "../../utils/style";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { searchKey } from "../../utils/searchText";
import { consoleInlineName, consoleSearchName } from "../../utils/consoles";
import { isEventConsole } from "../../utils/events";

const GAMES_INITIAL_ROWS = 30;
const GAMES_ROW_STEP = 50;
const GAMES_SENTINEL_ROOT_MARGIN_PX = 600;

const SEARCH_THRESHOLD = 12;

type ListTab = "games" | "events";

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
    onRowFocus: (index: number) => void;
};

type GameRowProps = {
    game: SavedCommentGame;
    index: number;
    selected: boolean;
    list: GameRowListProps;
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
};

const GameRow = React.memo(function GameRow(props: GameRowProps) {
    const { game, index, selected, list } = props;
    const { language, showIcons } = list;
    const { iconDataUri, cold } = useGameIcon(
        showIcons ? game.gameId : null,
        game.imageIcon || null,
        "SavedCommentsFilterModal useGameIcon"
    );
    const size = list.iconSize;

    const isEvent = isEventConsole(game.consoleName);
    const system = isEvent ? "" : consoleInlineName(game.consoleName || "");

    function handleSelect() {
        list.onSelect(game.gameId);
    }

    return (
        <FocusableItem
            focusKey={`savedfilter:game:${game.gameId}`}
            onClick={handleSelect}
            onFocus={() => list.onRowFocus(index)}
            onGamepadFocus={() => list.onRowFocus(index)}
            onGamepadDirection={props.onGamepadDirection}
        >
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
                        {game.title || (isEvent ? t(language, "Unknown event") : t(language, "Unknown game"))}
                    </span>
                    {system ? (
                        <span style={{ fontSize: `${modalSize(12)}px`, opacity: 0.7, wordBreak: "break-word" }}>
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

export function SavedCommentsFilterModal(props: SavedCommentsFilterModalProps) {
    const { games, selected, language, showIcons, onSelect, close } = props;

    const [query, setQuery] = useState("");

    const gameRows = useMemo(() => games.filter((game) => !isEventConsole(game.consoleName)), [games]);
    const eventRows = useMemo(() => games.filter((game) => isEventConsole(game.consoleName)), [games]);
    const [tab, setTab] = useState<ListTab>(() => {
        if (selected === "events") {
            return "events";
        }
        const current = games.find((game) => game.gameId === selected);
        if (current) {
            return isEventConsole(current.consoleName) ? "events" : "games";
        }
        return games.some((game) => !isEventConsole(game.consoleName)) ? "games" : "events";
    });
    const tabRows = tab === "events" ? eventRows : gameRows;

    function switchTab(next: ListTab) {
        setTab(next);
        setQuery("");
    }

    const searchShown = tabRows.length > SEARCH_THRESHOLD;

    const gameKeys = useMemo(
        () => tabRows.map((game) => searchKey(
            (game.title || "") + " " + consoleSearchName(game.consoleName || "")
        )),
        [tabRows]
    );

    const filteredGames = useMemo(() => {
        const wanted = searchKey(query.trim());
        if (!wanted) {
            return tabRows;
        }
        return tabRows.filter((_game, index) => gameKeys[index].includes(wanted));
    }, [tabRows, gameKeys, query]);

    const gameWindow = useSlidingWindow({
        items: filteredGames,
        itemKey: (game) => String(game.gameId),
        focusKeyFor: (game) => `savedfilter:game:${game.gameId}`,
        windowId: "savedfilter:games",
        heightScope: ["savedfilter:games", getCurrentModalScale(), showIcons, language].join("|"),
        dynamicLoading: true,
        initialRows: GAMES_INITIAL_ROWS,
        rowStep: GAMES_ROW_STEP,
        prefetchDistance: 8,
        sentinelRootMarginPx: GAMES_SENTINEL_ROOT_MARGIN_PX,
        resetKey: `savedfilter:${tab}:${query}`,
        debugLabel: "savedfilter:games"
    });
    const visibleGames = gameWindow.mountedItems;
    const onItemFocus = gameWindow.onItemFocus;

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
                <OptionRow
                    label={t(language, "Events")}
                    focusKey="savedfilter:events"
                    selected={selected === "events"}
                    onSelect={() => pick("events")}
                />
                {eventRows.length > 0 && (
                    <Focusable flow-children="row" style={{ display: "flex", gap: "6px", margin: "8px 0 2px" }}>
                        <SubTabButton
                            label={t(language, "Games")}
                            active={tab === "games"}
                            onClick={() => switchTab("games")}
                            focusKey="savedfilter:tab:games"
                        />
                        <SubTabButton
                            label={t(language, "Events")}
                            active={tab === "events"}
                            onClick={() => switchTab("events")}
                            focusKey="savedfilter:tab:events"
                        />
                    </Focusable>
                )}
                {searchShown && (
                    <div style={{ margin: "8px 0 2px" }}>
                        <TextField
                            value={query}
                            placeholder={t(language, "Search")}
                            onChange={(e: { target: { value: string } }) => setQuery(e.target.value)}
                        />
                    </div>
                )}
                {query && filteredGames.length === 0 && (
                    <div style={{ padding: "8px 0", fontSize: `${modalSize(13)}px`, opacity: 0.75 }}>
                        {tab === "events" ? t(language, "No events match that search.") : t(language, "No games match that search.")}
                    </div>
                )}
                {filteredGames.length > 0 && (
                    <div
                        style={{
                            height: "1px",
                            background: "rgba(255,255,255,0.14)",
                            margin: "6px 0"
                        }}
                    />
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

