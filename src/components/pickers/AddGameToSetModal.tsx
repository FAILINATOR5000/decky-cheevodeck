import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import {
    getLastConsoleId,
    getSetGameList,
    prefetchGameIcons,
    saveLastConsoleId
} from "../../api";
import { useResilientGameIcon } from "../../hooks/useResilientGameIcon";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { useModalBack } from "../../hooks/useModalBack";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { ErrorText } from "../ui/ErrorText";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { InlineSpinner } from "../ui/InlineSpinner";
import { ConsoleRow, type ConsoleRowListProps } from "./PickerConsoleRow";
import { consolesWithoutRecent, RecentConsoleSection, resolveRecentConsole } from "./RecentConsoleSection";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type {
    AddTrackedSetGamePayload,
    AddTrackedSetGameResponse,
    TrackedSetConsole,
    TrackedSetPickerGame
} from "../../types";
import { cachedConsoles, getCurrentLastConsoleId, loadConsoles, setCurrentLastConsoleId } from "../../utils/consoleCatalog";
import { logError } from "../../utils/errors";
import { modalBodyStyle, smallTextStyle, compactButtonStyle, FADE_IN_KEYFRAMES } from "../../utils/style";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
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

    const [consoles, setConsoles] = useState<TrackedSetConsole[]>(() => cachedConsoles() ?? []);
    const [consolesLoading, setConsolesLoading] = useState(() => cachedConsoles() === null);
    const [consolesError, setConsolesError] = useState<string | null>(null);

    const [selectedConsole, setSelectedConsole] = useState<TrackedSetConsole | null>(null);
    const [games, setGames] = useState<TrackedSetPickerGame[]>([]);
    const [gamesLoading, setGamesLoading] = useState(false);
    const [gamesError, setGamesError] = useState<string | null>(null);

    const [query, setQuery] = useState("");

    const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "updated" | "nonew">("idle");

    const [addedGameIds, setAddedGameIds] = useState<Set<number>>(new Set());

    const [recentConsoleId, setRecentConsoleId] = useState(getCurrentLastConsoleId);

    const gamesRunIdRef = useRef(0);

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const focusedTopForStepRef = useRef<Step | null>(null);
    const returnKeyRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await loadConsoles();
                if (cancelled) {
                    return;
                }
                setConsoles(list);
                setConsolesError(null);
            } catch (e) {
                logError("getSetConsoleList", e);
                if (cancelled || cachedConsoles() !== null) {
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

    useLayoutEffect(function focusTopOfListWhenReady() {
        if (focusedTopForStepRef.current === step) {
            return;
        }
        const root = bodyRef.current;
        if (!root) {
            return;
        }
        const prefix = step === "console" ? "setsconsole:" : "setsgame:";
        const back = step === "console" ? returnKeyRef.current : null;
        const firstRow = ((back && root.querySelector(`[data-focus-key="${back}"] button, [data-focus-key="${back}"] [tabindex]`))
            || root.querySelector(`[data-focus-key^="${prefix}"] button, [data-focus-key^="${prefix}"] [tabindex]`)) as HTMLElement | null;
        if (!firstRow) {
            return;
        }
        focusedTopForStepRef.current = step;
        returnKeyRef.current = null;
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
        setCurrentLastConsoleId(item.id);
        void saveLastConsoleId(item.id).catch((e) => logError("saveLastConsoleId (addtoset)", e));
        setSelectedConsole(item);
        setQuery("");
        setGames([]);
        setRefreshState("idle");
        setAddedGameIds(new Set());
        void loadGames(item.id, false);
    }

    function handleBackToConsoles() {
        returnKeyRef.current = selectedConsole ? `setsconsole:${selectedConsole.id}` : null;
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

    function stepBack(): boolean {
        if (step !== "games") {
            return false;
        }
        handleBackToConsoles();
        return true;
    }

    const handleCancel = useModalBack(stepBack, close);

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
        <ModalRoot onCancel={handleCancel} onEscKeypress={handleCancel}>
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

const NAV_ENTER_MAINTAIN_Y = 3;
const INITIAL_CONSOLE_ROWS = 40;
const CONSOLE_ROW_STEP = 40;
const CONSOLE_ROW_LOAD_AHEAD = 12;
const CONSOLE_SENTINEL_ROOT_MARGIN_PX = 600;

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

    const recentConsole = resolveRecentConsole(consoles, recentConsoleId);
    const listedConsoles = useMemo(() => consolesWithoutRecent(consoles, recentConsole), [consoles, recentConsole]);

    const consoleWindow = useSlidingWindow({
        items: listedConsoles,
        itemKey: (item) => String(item.id),
        focusKeyFor: (item) => `setsconsole:${item.id}`,
        windowId: "setsconsole:consoles",
        heightScope: ["setsconsole:consoles", getCurrentModalScale(), showIcons, language].join("|"),
        dynamicLoading: true,
        initialRows: INITIAL_CONSOLE_ROWS,
        rowStep: CONSOLE_ROW_STEP,
        fullSteps: true,
        prefetchDistance: CONSOLE_ROW_LOAD_AHEAD,
        sentinelRootMarginPx: CONSOLE_SENTINEL_ROOT_MARGIN_PX,
        resetKey: `setsconsole:${listedConsoles.length > 0}`
    });

    const consolePickRef = useRef(onPick);
    consolePickRef.current = onPick;
    const consoleFocusRef = useRef(consoleWindow.onItemFocus);
    consoleFocusRef.current = consoleWindow.onItemFocus;

    const rowList = useMemo<ConsoleRowListProps>(() => ({
        language,
        showIcons,
        metrics: pickerRowMetrics(),
        onPick: (item) => {
            consolePickRef.current(item);
        },
        keyPrefix: "setsconsole:",
        onRowFocus: (index) => {
            consoleFocusRef.current(index);
        }
    }), [language, showIcons]);

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
            <Focusable
                flow-children="column"
                resetNavOnEntry
                navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}
                style={{ display: "flex", flexDirection: "column" }}
            >
                <SlidingWindowRows list={consoleWindow}>
                    {consoleWindow.mountedItems.map((item, i) => (
                        <div key={`setsconsole:${item.id}`} style={{ paddingBottom: "4px" }}>
                            <ConsoleRow
                                item={item}
                                dimmed={loadingConsoleId !== null && item.id !== loadingConsoleId}
                                list={rowList}
                                index={consoleWindow.start + i}
                                onGamepadDirection={consoleWindow.guardTopRow(consoleWindow.start + i)}
                            />
                        </div>
                    ))}
                </SlidingWindowRows>
            </Focusable>
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

const INITIAL_GAME_ROWS = 40;
const GAME_ROW_STEP = 40;
const GAME_ROW_LOAD_AHEAD = 12;
const GAME_SENTINEL_ROOT_MARGIN_PX = 600;

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

    const gameWindow = useSlidingWindow({
        items: games,
        itemKey: (game) => String(game.gameId),
        focusKeyFor: (game) => `setsgame:${game.gameId}`,
        windowId: "addgame:games",
        heightScope: ["addgame:games", getCurrentModalScale(), showIcons, language].join("|"),
        dynamicLoading: true,
        initialRows: INITIAL_GAME_ROWS,
        rowStep: GAME_ROW_STEP,
        fullSteps: true,
        prefetchDistance: GAME_ROW_LOAD_AHEAD,
        sentinelRootMarginPx: GAME_SENTINEL_ROOT_MARGIN_PX,
        resetKey: `${query}|${games.length > 0}`,
        debugLabel: "addgame:games"
    });
    const mountedGames = gameWindow.mountedItems;

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
    const gameFocusRef = useRef(gameWindow.onItemFocus);
    gameFocusRef.current = gameWindow.onItemFocus;

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
                        {totalGames === 0
                            ? t(language, "Nothing found for this system. It seems this system has no games with RetroAchievements yet.")
                            : t(language, "Not found. The game may not have achievements yet, or may be listed under a different console.")}
                    </div>
                    {refreshRow}
                </div>
            )}

            {games.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <SlidingWindowRows list={gameWindow}>
                        {mountedGames.map((game, index) => (
                            <div key={`setsgame:${game.gameId}`} style={{ paddingBottom: "4px" }}>
                                <PickerGameRow
                                    game={game}
                                    added={addedGameIds.has(game.gameId)}
                                    index={gameWindow.start + index}
                                    list={gameRowList}
                                    onGamepadDirection={gameWindow.guardTopRow(gameWindow.start + index)}
                                />
                            </div>
                        ))}
                    </SlidingWindowRows>
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
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
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
