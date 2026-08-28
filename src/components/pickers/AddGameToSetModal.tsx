import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import {
    getLastConsoleId,
    getSetConsoleList,
    getSetGameList,
    prefetchGameIcons,
    saveLastConsoleId
} from "../../api";
import { useResilientGameIcon } from "../../hooks/useResilientGameIcon";
import { ErrorText } from "../ui/ErrorText";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { InlineSpinner } from "../ui/InlineSpinner";
import { consolesWithoutRecent, RecentConsoleSection, resolveRecentConsole } from "./RecentConsoleSection";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type {
    AddTrackedSetGamePayload,
    AddTrackedSetGameResponse,
    TrackedSetConsole,
    TrackedSetPickerGame
} from "../../types";
import { logError } from "../../utils/errors";
import { modalBodyStyle, smallTextStyle, compactButtonStyle, FADE_IN_KEYFRAMES } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { searchKey } from "../../utils/searchText";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

type AddGameToSetFn = (
    game: AddTrackedSetGamePayload
) => Promise<AddTrackedSetGameResponse | { ok: false }>;

export type AddGameToSetModalProps = {
    setName: string;
    language: LanguageCode;
    showIcons: boolean;
    onAddGame: AddGameToSetFn;
    close: () => void;
};

type Step = "console" | "games";

export function AddGameToSetModal(props: AddGameToSetModalProps) {
    const { setName, language, showIcons, onAddGame, close } = props;

    const [step, setStep] = useState<Step>("console");

    const [consoles, setConsoles] = useState<TrackedSetConsole[]>([]);
    const [consolesLoading, setConsolesLoading] = useState(true);
    const [consolesError, setConsolesError] = useState<string | null>(null);

    const [selectedConsole, setSelectedConsole] = useState<TrackedSetConsole | null>(null);
    const [games, setGames] = useState<TrackedSetPickerGame[]>([]);
    const [gamesLoading, setGamesLoading] = useState(false);
    const [gamesError, setGamesError] = useState<string | null>(null);

    const [query, setQuery] = useState("");

    const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "updated" | "nonew">("idle");

    const [addedGameIds, setAddedGameIds] = useState<Set<number>>(new Set());

    const [recentConsoleId, setRecentConsoleId] = useState(0);

    const gamesRunIdRef = useRef(0);

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const focusedTopForStepRef = useRef<Step | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const result = await getSetConsoleList();
                if (cancelled) {
                    return;
                }
                setConsoles(result.consoles ?? []);
                setConsolesError(null);
            } catch (e) {
                logError("getSetConsoleList", e);
                if (cancelled) {
                    return;
                }
                setConsolesError("Couldn't load the console list.");
            } finally {
                if (!cancelled) {
                    setConsolesLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const result = await getLastConsoleId();
                if (!cancelled) {
                    setRecentConsoleId(result?.lastConsoleId ?? 0);
                }
            } catch (e) {
                logError("getLastConsoleId (addtoset)", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(function focusTopOfListWhenReady() {
        if (focusedTopForStepRef.current === step) {
            return;
        }
        const root = bodyRef.current;
        if (!root) {
            return;
        }
        const prefix = step === "console" ? "setsconsole:" : "setsgame:";
        const firstRow = root.querySelector(
            `[data-focus-key^="${prefix}"] button, [data-focus-key^="${prefix}"] [tabindex]`
        ) as HTMLElement | null;
        if (!firstRow) {
            return;
        }
        focusedTopForStepRef.current = step;
        firstRow.focus();
    }, [step, consoles, games]);

    const loadGames = async (consoleId: number, refresh: boolean) => {
        const runId = gamesRunIdRef.current + 1;
        gamesRunIdRef.current = runId;
        if (refresh) {
            setRefreshState("refreshing");
        } else {
            setGamesLoading(true);
            setGamesError(null);
        }
        try {
            const before = games.length;
            const result = await getSetGameList(consoleId, refresh);
            if (gamesRunIdRef.current !== runId) {
                return;
            }
            const next = result.games ?? [];
            setGames(next);
            if (refresh) {
                setRefreshState(next.length > before ? "updated" : "nonew");
            } else {
                setStep("games");
            }
        } catch (e) {
            logError("getSetGameList", e);
            if (gamesRunIdRef.current !== runId) {
                return;
            }
            if (refresh) {
                setRefreshState("idle");
            } else {
                setGamesError("Couldn't load games for this console.");
                setStep("games");
            }
        } finally {
            if (gamesRunIdRef.current === runId && !refresh) {
                setGamesLoading(false);
            }
        }
    };

    function handlePickConsole(item: TrackedSetConsole) {
        if (gamesLoading) {
            return;
        }
        void saveLastConsoleId(item.id).catch((e) => logError("saveLastConsoleId (addtoset)", e));
        setSelectedConsole(item);
        setQuery("");
        setGames([]);
        setRefreshState("idle");
        setAddedGameIds(new Set());
        void loadGames(item.id, false);
    }

    function handleBackToConsoles() {
        if (selectedConsole) {
            setRecentConsoleId(selectedConsole.id);
        }
        focusedTopForStepRef.current = null;
        setStep("console");
        setSelectedConsole(null);
        setGames([]);
        setGamesError(null);
        setQuery("");
        setRefreshState("idle");
    }

    function handleRefresh() {
        if (!selectedConsole || refreshState === "refreshing") {
            return;
        }
        void loadGames(selectedConsole.id, true);
    }

    async function handlePickGame(game: TrackedSetPickerGame) {
        if (addedGameIds.has(game.gameId)) {
            return;
        }
        const result = await onAddGame({
            gameId: game.gameId,
            title: game.title,
            imageIcon: game.imageIcon,
            consoleName: game.consoleName,
            maxPossible: game.maxPossible
        });
        if (result.ok) {
            setAddedGameIds((prev) => {
                const next = new Set(prev);
                next.add(game.gameId);
                return next;
            });
        }
    }

    const titleKeys = useMemo(() => games.map((game) => searchKey(game.title)), [games]);

    const filteredGames = useMemo(() => {
        const trimmed = searchKey(query.trim());
        if (!trimmed) {
            return games;
        }
        return games.filter((_game, index) => titleKeys[index].includes(trimmed));
    }, [games, titleKeys, query]);

    const modalTitle = t(language, "Add Game to {{name}}", { name: setName });

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {modalTitle}
            </div>

            <div ref={bodyRef}>
                {step === "console" && (
                    <ConsoleStep
                        consoles={consoles}
                        loading={consolesLoading}
                        error={consolesError}
                        loadingConsoleId={gamesLoading ? selectedConsole?.id ?? null : null}
                        recentConsoleId={recentConsoleId}
                        language={language}
                        showIcons={showIcons}
                        onPick={handlePickConsole}
                    />
                )}

                {step === "games" && selectedConsole && (
                    <GameStep
                        consoleName={selectedConsole.name}
                        games={filteredGames}
                        totalGames={games.length}
                        loading={gamesLoading}
                        error={gamesError}
                        query={query}
                        onQueryChange={setQuery}
                        refreshState={refreshState}
                        onRefresh={handleRefresh}
                        addedGameIds={addedGameIds}
                        language={language}
                        showIcons={showIcons}
                        onPickGame={handlePickGame}
                        onBack={handleBackToConsoles}
                    />
                )}
            </div>

            <Focusable
                style={{
                    display: "flex",
                    justifyContent: "flex-start",
                    gap: "8px",
                    marginTop: "16px"
                }}
                flow-children="row"
            >
                <DialogButton onClick={close}>
                    {t(language, "Done")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

type ConsoleStepProps = {
    consoles: TrackedSetConsole[];
    loading: boolean;
    error: string | null;
    loadingConsoleId: number | null;
    recentConsoleId: number;
    language: LanguageCode;
    showIcons: boolean;
    onPick: (item: TrackedSetConsole) => void;
};

function ConsoleStep(props: ConsoleStepProps) {
    const { consoles, loading, error, loadingConsoleId, recentConsoleId, language, showIcons, onPick } = props;

    const consolePickRef = useRef(onPick);
    consolePickRef.current = onPick;

    const rowList = useMemo<ConsoleRowListProps>(() => ({
        language,
        showIcons,
        metrics: pickerRowMetrics(),
        onPick: (item) => {
            consolePickRef.current(item);
        }
    }), [language, showIcons]);

    const recentConsole = resolveRecentConsole(consoles, recentConsoleId);
    const listedConsoles = consolesWithoutRecent(consoles, recentConsole);

    if (loading && consoles.length === 0) {
        return (
            <div style={modalBodyStyle()}>{t(language, "Loading consoles...")}</div>
        );
    }
    if (error) {
        return <ErrorText>{localizeRuntimeText(language, error)}</ErrorText>;
    }
    if (consoles.length === 0) {
        return (
            <div style={modalBodyStyle()}>{t(language, "No consoles available.")}</div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {recentConsole && (
                <RecentConsoleSection language={language}>
                    <ConsoleRow
                        key={`setsconsole:recent:${recentConsole.id}`}
                        item={recentConsole}
                        dimmed={loadingConsoleId !== null && recentConsole.id !== loadingConsoleId}
                        list={rowList}
                    />
                </RecentConsoleSection>
            )}
            {listedConsoles.map((item) => (
                <ConsoleRow
                    key={`setsconsole:${item.id}`}
                    item={item}
                    dimmed={loadingConsoleId !== null && item.id !== loadingConsoleId}
                    list={rowList}
                />
            ))}
        </div>
    );
}

function pickerRowMetrics() {
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

type PickerRowMetrics = ReturnType<typeof pickerRowMetrics>;

type ConsoleRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: PickerRowMetrics;
    onPick: (item: TrackedSetConsole) => void;
};

type ConsoleRowProps = {
    item: TrackedSetConsole;
    dimmed: boolean;
    list: ConsoleRowListProps;
};

const ConsoleRow = React.memo(function ConsoleRow(props: ConsoleRowProps) {
    const { item, dimmed, list } = props;
    const { language, showIcons, metrics } = list;

    const fallbackLetter = item.name.trim().charAt(0).toUpperCase() || "?";

    function handleClick() {
        list.onPick(item);
    }

    return (
        <FocusableItem
            focusKey={`setsconsole:${item.id}`}
            onClick={handleClick}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "center",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    minWidth: 0,
                    opacity: dimmed ? 0.5 : 1
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
                            fontWeight: 800
                        }}
                    >
                        {item.iconUrl ? (
                            <img
                                src={item.iconUrl}
                                alt=""
                                decoding="async"
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                    display: "block"
                                }}
                            />
                        ) : (
                            fallbackLetter
                        )}
                    </div>
                )}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: `${metrics.titleFontSize}px`,
                        lineHeight: metrics.titleLineHeight,
                        fontWeight: 800,
                        textAlign: "left",
                        wordBreak: "break-word"
                    }}
                >
                    {item.name || t(language, "Unknown console")}
                </div>
            </div>
        </FocusableItem>
    );
});

type GameStepProps = {
    consoleName: string;
    games: TrackedSetPickerGame[];
    totalGames: number;
    loading: boolean;
    error: string | null;
    query: string;
    onQueryChange: (next: string) => void;
    refreshState: "idle" | "refreshing" | "updated" | "nonew";
    onRefresh: () => void;
    addedGameIds: Set<number>;
    language: LanguageCode;
    showIcons: boolean;
    onPickGame: (game: TrackedSetPickerGame) => void;
    onBack: () => void;
};

function GameStep(props: GameStepProps) {
    const {
        consoleName,
        games,
        totalGames,
        loading,
        error,
        query,
        onQueryChange,
        refreshState,
        onRefresh,
        addedGameIds,
        language,
        showIcons,
        onPickGame,
        onBack
    } = props;

    const INITIAL_GAME_ROWS = 40;
    const GAME_ROW_STEP = 40;
    const GAME_ROW_LOAD_AHEAD = 12;

    const [mountedCount, setMountedCount] = useState(function getInitialMountedCount() {
        return Math.min(INITIAL_GAME_ROWS, games.length);
    });

    useEffect(function resetMountedRowsOnListChange() {
        setMountedCount(Math.min(INITIAL_GAME_ROWS, games.length));
    }, [query, games.length]);

    const loadMoreGames = function loadMoreGames() {
        setMountedCount(function updateMountedCount(current) {
            if (current >= games.length) {
                return current;
            }
            return Math.min(current + GAME_ROW_STEP, games.length);
        });
    };

    const mountedGames = useMemo(() => {
        return games.slice(0, mountedCount);
    }, [games, mountedCount]);

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

    const gamePickRef = useRef(onPickGame);
    gamePickRef.current = onPickGame;
    const gameFocusRef = useRef(handleGameFocus);
    gameFocusRef.current = handleGameFocus;

    const gameRowList = useMemo<PickerGameRowListProps>(() => ({
        language,
        showIcons,
        metrics: pickerRowMetrics(),
        onPick: (game) => {
            gamePickRef.current(game);
        },
        onRowFocus: (index) => {
            gameFocusRef.current(index);
        }
    }), [language, showIcons]);

    function handleGameFocus(index: number) {
        if (index < mountedCount - GAME_ROW_LOAD_AHEAD) {
            return;
        }
        loadMoreGames();
    }

    const refreshRow = (
        <Focusable
            style={{
                display: "flex",
                flexDirection: "row",
                gap: "8px",
                alignItems: "center",
                flexWrap: "wrap"
            }}
            flow-children="grid"
        >
            <div data-focus-key="setsgame:refresh">
                <DialogButton
                    onClick={onRefresh}
                    disabled={refreshState === "refreshing"}
                    style={compactButtonStyle}
                >
                    {refreshState === "refreshing"
                        ? t(language, "Refreshing...")
                        : t(language, "Refresh list")}
                </DialogButton>
            </div>
            {refreshState === "refreshing" && <InlineSpinner />}
            {refreshState === "updated" && (
                <span style={modalBodyStyle()}>{t(language, "Updated")}</span>
            )}
            {refreshState === "nonew" && (
                <span style={modalBodyStyle()}>{t(language, "No new games found")}</span>
            )}
        </Focusable>
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <Focusable
                style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: "8px",
                    alignItems: "center"
                }}
                flow-children="row"
            >
                <div data-focus-key="setsgame:back-to-consoles">
                    <DialogButton
                        onClick={onBack}
                        style={compactButtonStyle}
                    >
                        {t(language, "← Consoles")}
                    </DialogButton>
                </div>
                <div style={{ fontWeight: 700, minWidth: 0, wordBreak: "break-word" }}>
                    {consoleName}
                </div>
            </Focusable>

            <TextField
                value={query}
                onChange={(e: any) => onQueryChange(e?.target?.value ?? "")}
                disabled={loading}
            />

            {loading && totalGames === 0 && (
                <div style={modalBodyStyle()}>{t(language, "Loading games...")}</div>
            )}

            {error && <ErrorText>{localizeRuntimeText(language, error)}</ErrorText>}

            {!loading && !error && games.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={modalBodyStyle()}>
                        {t(language, "Not found. The game may not have achievements yet, or may be listed under a different console.")}
                    </div>
                    {refreshRow}
                </div>
            )}

            {games.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {mountedGames.map((game, index) => (
                        <PickerGameRow
                            key={`setsgame:${game.gameId}`}
                            game={game}
                            added={addedGameIds.has(game.gameId)}
                            index={index}
                            list={gameRowList}
                        />
                    ))}
                    {refreshRow}
                </div>
            )}
        </div>
    );
}

type PickerGameRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: PickerRowMetrics;
    onPick: (game: TrackedSetPickerGame) => void;
    onRowFocus: (index: number) => void;
};

type PickerGameRowProps = {
    game: TrackedSetPickerGame;
    added: boolean;
    index: number;
    list: PickerGameRowListProps;
};

const PickerGameRow = React.memo(function PickerGameRow(props: PickerGameRowProps) {
    const { game, added, list } = props;
    const { language, showIcons, metrics } = list;

    const { iconDataUri, cold } = useResilientGameIcon(game.gameId, game.imageIcon, "getGameIconCached (set picker row)");

    const fallbackLetter = game.title.trim().charAt(0).toUpperCase() || "?";

    function handleClick() {
        if (added) {
            return;
        }
        list.onPick(game);
    }

    function handleFocus() {
        list.onRowFocus(props.index);
    }

    return (
        <FocusableItem
            focusKey={`setsgame:${game.gameId}`}
            onClick={handleClick}
            onFocus={handleFocus}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "flex-start",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    minWidth: 0,
                    opacity: added ? 0.6 : 1
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
                            fontWeight: 800
                        }}
                    >
                        {iconDataUri ? (
                            <FadeImage
                                src={iconDataUri}
                                fadeOnLoad={cold}
                                decoding="async"
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block"
                                }}
                            />
                        ) : (
                            fallbackLetter
                        )}
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
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.bodyFontSize}px`,
                            lineHeight: metrics.bodyLineHeight,
                            opacity: 1,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {game.consoleName || ""}
                    </div>
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.pointsFontSize}px`,
                            lineHeight: metrics.pointsLineHeight,
                            opacity: 1,
                            fontWeight: 800,
                            minWidth: 0
                        }}
                    >
                        {added
                            ? t(language, "Added")
                            : t(language, "{{count}} achievements", { count: game.maxPossible })}
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});
