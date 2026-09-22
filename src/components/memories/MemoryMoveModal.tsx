import React, { useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { FocusableItem } from "../ui/FocusableItem";
import { FadeImage } from "../ui/FadeImage";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { GameSearchModal } from "../pickers/GameSearchModal";
import { useResilientGameIcon } from "../../hooks/useResilientGameIcon";
import { useWindowedList } from "../../hooks/useWindowedList";
import { moveMemory, prefetchGameIcons } from "../../api";
import { showManagedModal } from "../../utils/modalRegistry";
import { armMemoriesFocusKey, armMemoriesFocusReturn } from "../../utils/memoriesFocusReturn";
import { logError } from "../../utils/errors";
import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES } from "../../utils/style";
import { MISC_GAME_ID } from "../../utils/memories";
import { searchKey } from "../../utils/searchText";
import { consoleInlineName, consoleSearchName } from "../../utils/consoles";
import type { MemoryGameRow, MemoryRecord } from "../../types";

const GAMES_INITIAL_ROWS = 30;
const GAMES_ROW_STEP = 50;
const GAMES_SENTINEL_ROOT_MARGIN = "300px";

const SEARCH_THRESHOLD = 12;

export type MemoryMoveModalProps = {
    memory: MemoryRecord;
    gameId: number;
    games: MemoryGameRow[];
    loadedGameId: number | null;
    language: LanguageCode;
    showIcons: boolean;
    activeUlid: string;
    removalLandingId: string | null;
    close: () => void;
};

type MoveTarget = {
    gameId: number;
    gameTitle: string;
    consoleName: string;
    imageIcon: string;
};

type RowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    iconSize: number;
    onSelect: (target: MoveTarget) => void;
    onRowFocus: (index: number) => void;
};

function rowTitle(language: LanguageCode, game: MemoryGameRow): string {
    if (game.gameId === MISC_GAME_ID) {
        return t(language, "Uncategorized");
    }
    return game.gameTitle || t(language, "Unknown game");
}

const DestinationRow = React.memo(function DestinationRow(props: {
    game: MemoryGameRow;
    index: number;
    list: RowListProps;
}) {
    const { game, index, list } = props;
    const iconGameId = list.showIcons && game.gameId !== MISC_GAME_ID ? game.gameId : null;
    const { iconDataUri, cold } = useResilientGameIcon(iconGameId, game.imageIcon || null, "MemoryMoveModal getGameIconCached");
    const size = list.iconSize;

    const title = rowTitle(list.language, game);
    const system = game.gameId === MISC_GAME_ID ? "" : consoleInlineName(game.consoleName || "");

    return (
        <FocusableItem
            focusKey={`memories:move:${game.gameId}`}
            onClick={() => list.onSelect({
                gameId: game.gameId,
                gameTitle: game.gameTitle || "",
                consoleName: game.consoleName || "",
                imageIcon: game.imageIcon || ""
            })}
            onFocus={() => list.onRowFocus(index)}
            onGamepadFocus={() => list.onRowFocus(index)}
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
                    <span style={{ fontSize: `${modalSize(15)}px`, fontWeight: 600, wordBreak: "break-word" }}>
                        {title}
                    </span>
                    {system ? (
                        <span style={{ fontSize: `${modalSize(12)}px`, opacity: 0.7, wordBreak: "break-word" }}>
                            {system}
                        </span>
                    ) : null}
                </div>
            </div>
        </FocusableItem>
    );
});

export function MemoryMoveModal(props: MemoryMoveModalProps) {
    const {
        memory,
        gameId,
        games,
        loadedGameId,
        language,
        showIcons,
        activeUlid,
        removalLandingId,
        close
    } = props;

    const [query, setQuery] = useState("");

    const closeRef = useRef(close);
    closeRef.current = close;

    const candidates = useMemo(() => {
        const rest = games.filter((game) => game.gameId !== gameId && game.gameId !== loadedGameId);
        const pinned = loadedGameId !== null && loadedGameId !== gameId
            ? games.filter((game) => game.gameId === loadedGameId)
            : [];
        return [...pinned, ...rest];
    }, [games, gameId, loadedGameId]);

    const pinnedCount = candidates.length > 0 && candidates[0].gameId === loadedGameId ? 1 : 0;

    const searchShown = candidates.length > SEARCH_THRESHOLD;

    const titleKeys = useMemo(
        () => candidates.map((game) => searchKey(
            rowTitle(language, game) + " " + consoleSearchName(game.consoleName || "")
        )),
        [candidates, language]
    );

    const filtered = useMemo(() => {
        const wanted = searchKey(query.trim());
        if (!wanted) {
            return candidates;
        }
        return candidates.filter((_game, index) => titleKeys[index].includes(wanted));
    }, [candidates, titleKeys, query]);

    const { mountedItems: visibleGames, markerRef, onItemFocus } = useWindowedList({
        items: filtered,
        dynamicLoading: true,
        initialRows: GAMES_INITIAL_ROWS,
        rowStep: GAMES_ROW_STEP,
        prefetchDistance: 8,
        sentinelRootMargin: GAMES_SENTINEL_ROOT_MARGIN,
        resetKey: `memoriesmove:${query}`
    });

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

    async function applyMove(target: MoveTarget) {
        if (target.gameId === gameId) {
            return;
        }
        try {
            await moveMemory(
                gameId,
                memory.id,
                target.gameId,
                target.gameTitle,
                target.consoleName,
                target.imageIcon
            );
        }
        catch (e) {
            logError("memories: couldn't move a memory", e);
        }
        if (removalLandingId === null) {
            armMemoriesFocusKey("memories:back");
        } else {
            armMemoriesFocusReturn(gameId, removalLandingId, activeUlid);
        }
    }

    const applyRef = useRef(applyMove);
    applyRef.current = applyMove;

    const focusRef = useRef(onItemFocus);
    focusRef.current = onItemFocus;

    const rowList = useMemo<RowListProps>(() => ({
        language,
        showIcons,
        iconSize: modalSize(28),
        onSelect: (target) => {
            void applyRef.current(target).then(closeRef.current);
        },
        onRowFocus: (index) => {
            focusRef.current(index);
        }
    }), [language, showIcons]);

    function openSearch() {
        showManagedModal((closeSearch) => (
            <GameSearchModal
                language={language}
                showIcons={showIcons}
                onPick={(game) => {
                    void applyRef.current({
                        gameId: game.gameId,
                        gameTitle: game.title,
                        consoleName: game.consoleName,
                        imageIcon: game.imageIcon
                    }).then(() => {
                        closeSearch();
                        closeRef.current();
                    });
                }}
                close={closeSearch}
            />
        ));
    }

    const miscOffered = gameId !== MISC_GAME_ID && !candidates.some((game) => game.gameId === MISC_GAME_ID);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "4px" }}>
                {t(language, "Move to Another Game")}
            </div>
            <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.75, marginBottom: "12px" }}>
                {t(language, "Pick the game this memory should belong to.")}
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
                {!query && (
                    <>
                        <FocusableItem
                            focusKey="memories:move:search"
                            onClick={openSearch}
                            autoFocus={!searchShown}
                        >
                            <div style={{ width: "100%", padding: "6px 0", fontSize: `${modalSize(15)}px`, fontWeight: 600 }}>
                                {t(language, "Search all games…")}
                            </div>
                        </FocusableItem>
                        {miscOffered && (
                            <FocusableItem
                                focusKey="memories:move:misc"
                                onClick={() => void applyRef.current({
                                    gameId: MISC_GAME_ID,
                                    gameTitle: "",
                                    consoleName: "",
                                    imageIcon: ""
                                }).then(closeRef.current)}
                            >
                                <div style={{ width: "100%", padding: "6px 0", fontSize: `${modalSize(15)}px`, fontWeight: 600 }}>
                                    {t(language, "Uncategorized")}
                                </div>
                            </FocusableItem>
                        )}
                        {filtered.length > 0 && (
                            <div style={{ height: "1px", background: "rgba(255,255,255,0.14)", margin: "6px 0" }} />
                        )}
                    </>
                )}
                {query && filtered.length === 0 && (
                    <div style={{ padding: "8px 0", fontSize: `${modalSize(13)}px`, opacity: 0.75 }}>
                        {t(language, "No games match that search.")}
                    </div>
                )}
                {visibleGames.map((game, index) => (
                    <React.Fragment key={game.gameId}>
                        <DestinationRow game={game} index={index} list={rowList} />
                        {pinnedCount === 1 && index === 0 && !query && (
                            <div style={{ height: "1px", background: "rgba(255,255,255,0.14)", margin: "6px 0" }} />
                        )}
                    </React.Fragment>
                ))}
                {visibleGames.length < filtered.length && (
                    <div ref={markerRef} style={{ height: "1px" }} />
                )}
            </div>
            <Focusable style={{ display: "flex", marginTop: "14px" }}>
                <DialogButton onClick={close} style={{ width: "100%" }}>
                    {t(language, "Cancel")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}
