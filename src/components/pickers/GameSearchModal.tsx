import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";

import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import {
    getLastConsoleId,
    getSetGameList,
    saveLastConsoleId
} from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { useModalBack } from "../../hooks/useModalBack";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { ErrorText } from "../ui/ErrorText";
import { SubTabButton } from "../ui/SubTabButton";
import { MyGamesSearch } from "./MyGamesSearch";
import { InlineSpinner } from "../ui/InlineSpinner";
import {
    PickerGameRow,
    pickerDetailStyle,
    pickerRowMetrics,
    pickerStrongStyle,
    useWarmWindowIcons,
    type PickerGameRowListProps
} from "./PickerGameRow";
import { ConsoleRow, type ConsoleRowListProps } from "./PickerConsoleRow";
import { consolesWithoutRecent, RecentConsoleSection, resolveRecentConsole } from "./RecentConsoleSection";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type {
    MyGamesList,
    TrackedSetConsole,
    TrackedSetPickerGame
} from "../../types";
import { cachedConsoles, getCurrentLastConsoleId, loadConsoles, setCurrentLastConsoleId } from "../../utils/consoleCatalog";
import { logError } from "../../utils/errors";
import { fetchMyGames, myGamesLoading, readMyGames, rememberSearchTab, useMyGames } from "../../utils/myGames";
import { modalBodyStyle, compactButtonStyle, FADE_IN_KEYFRAMES } from "../../utils/style";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
import { searchKey } from "../../utils/searchText";

export type GameSearchModalProps = {
    language: LanguageCode;
    showIcons: boolean;
    onPick: (game: TrackedSetPickerGame) => void;
    close: () => void;
};

type Step = "console" | "games";

type SearchTab = MyGamesList["searchTab"];

const NAV_ENTER_MAINTAIN_Y = 3;

function openingTab(listing: MyGamesList | null): SearchTab | null {
    if (listing === null) {
        return null;
    }
    return listing.searchTab === "all" ? "all" : "mine";
}

export function GameSearchModal(props: GameSearchModalProps) {
    const { language, showIcons, onPick, close } = props;

    const myGames = useMyGames();
    const [tab, setTab] = useState<SearchTab | null>(() => openingTab(myGames.listing));
    const [tabFromOpen, setTabFromOpen] = useState(true);
    const myGamesStepBackRef = useRef<() => boolean>(() => false);
    const [openSettled, setOpenSettled] = useState(false);

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

    const [recentConsoleId, setRecentConsoleId] = useState(getCurrentLastConsoleId);

    const gamesRunIdRef = useRef(0);

    const tabsRef = useRef<HTMLDivElement | null>(null);
    const tabFocusedRef = useRef(false);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const focusedTopForStepRef = useRef<Step | null>("console");
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
                logError("getSetConsoleList (search)", e);
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
            const listing = await readMyGames();
            if (cancelled) {
                return;
            }
            setOpenSettled(true);
            setTab((current) => current ?? openingTab(listing) ?? "mine");
            if (listing?.stale && (listing.scanned || listing.cached)) {
                fetchMyGames(false);
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
                logError("getLastConsoleId (search)", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useLayoutEffect(function focusActiveTabOnOpen() {
        if (tab === null || tabFocusedRef.current) {
            return;
        }
        const button = tabsRef.current?.querySelector(
            `[data-focus-key="mygames:tab:${tab}"] button, [data-focus-key="mygames:tab:${tab}"] [tabindex]`
        ) as HTMLElement | null;
        if (!button) {
            return;
        }
        tabFocusedRef.current = true;
        button.focus();
    }, [tab]);

    useLayoutEffect(function focusTopOfListWhenReady() {
        if (tab !== "all" || focusedTopForStepRef.current === step) {
            return;
        }
        const root = bodyRef.current;
        if (!root) {
            return;
        }
        const prefix = step === "console" ? "searchconsole:" : "searchgame:";
        const back = step === "console" ? returnKeyRef.current : null;
        const firstRow = ((back && root.querySelector(`[data-focus-key="${back}"] button, [data-focus-key="${back}"] [tabindex]`))
            || root.querySelector(`[data-focus-key^="${prefix}"] button, [data-focus-key^="${prefix}"] [tabindex]`)) as HTMLElement | null;
        if (!firstRow) {
            return;
        }
        focusedTopForStepRef.current = step;
        returnKeyRef.current = null;
        firstRow.focus();
    }, [tab, step, consoles, games]);

    function handlePickTab(next: SearchTab) {
        if (next === tab) {
            return;
        }
        rememberSearchTab(next);
        focusedTopForStepRef.current = step;
        setTabFromOpen(false);
        setTab(next);
    }

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
            logError("getSetGameList (search)", e);
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
        void saveLastConsoleId(item.id).catch((e) => logError("saveLastConsoleId (search)", e));
        setSelectedConsole(item);
        setQuery("");
        setGames([]);
        setRefreshState("idle");
        void loadGames(item.id, false);
    }

    function handleBackToConsoles() {
        returnKeyRef.current = selectedConsole ? `searchconsole:${selectedConsole.id}` : null;
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
        if (tab === "all" && step === "games") {
            handleBackToConsoles();
            return true;
        }
        return tab === "mine" && myGamesStepBackRef.current();
    }

    const handleCancel = useModalBack(stepBack, close);

    function handleRefresh() {
        if (!selectedConsole || refreshState === "refreshing") {
            return;
        }
        void loadGames(selectedConsole.id, true);
    }

    function handlePickGame(game: TrackedSetPickerGame) {
        onPick(game);
    }

    const titleKeys = useMemo(() => games.map((game) => searchKey(game.title)), [games]);

    const filteredGames = useMemo(() => {
        const trimmed = searchKey(query.trim());
        if (!trimmed) {
            return games;
        }
        return games.filter((_game, index) => titleKeys[index].includes(trimmed));
    }, [games, titleKeys, query]);

    const listReady = tab === "all"
        ? !(consolesLoading && consoles.length === 0)
        : tab === "mine" && openSettled && !myGamesLoading(myGames);

    return (
        <ModalRoot onCancel={handleCancel} onEscKeypress={handleCancel}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Select a Game")}
            </div>

            <Focusable ref={tabsRef} flow-children="row" style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
                <SubTabButton
                    label={t(language, "My Games")}
                    active={tab === "mine"}
                    onClick={() => handlePickTab("mine")}
                    focusKey="mygames:tab:mine"
                />
                <SubTabButton
                    label={t(language, "All Games")}
                    active={tab === "all"}
                    onClick={() => handlePickTab("all")}
                    focusKey="mygames:tab:all"
                />
            </Focusable>

            <div ref={bodyRef}>
                {tab === "mine" && (
                    <Focusable key="gamesearch:tab:mine">
                        <MyGamesSearch
                            language={language}
                            showIcons={showIcons}
                            canLoad={openSettled || !tabFromOpen}
                            consoles={consoles}
                            stepBackRef={myGamesStepBackRef}
                            onPick={onPick}
                            close={close}
                        />
                    </Focusable>
                )}

                {tab === "all" && (
                    <Focusable key="gamesearch:tab:all">
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
                                language={language}
                                showIcons={showIcons}
                                onPickGame={handlePickGame}
                                onBack={handleBackToConsoles}
                            />
                        )}
                    </Focusable>
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
                <DialogButton onClick={close} focusable={listReady}>
                    {t(language, "Cancel")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

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
        focusKeyFor: (item) => `searchconsole:${item.id}`,
        windowId: "gamesearch:consoles",
        heightScope: ["gamesearch:consoles", getCurrentModalScale(), showIcons, language].join("|"),
        dynamicLoading: true,
        initialRows: INITIAL_CONSOLE_ROWS,
        rowStep: CONSOLE_ROW_STEP,
        fullSteps: true,
        prefetchDistance: CONSOLE_ROW_LOAD_AHEAD,
        sentinelRootMarginPx: CONSOLE_SENTINEL_ROOT_MARGIN_PX,
        resetKey: `searchconsole:${listedConsoles.length > 0}`
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
        keyPrefix: "searchconsole:",
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
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ ...modalBodyStyle(), fontWeight: 700 }}>
                {t(language, "Pick a system")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {recentConsole && (
                    <RecentConsoleSection language={language}>
                        <ConsoleRow
                            key={`searchconsole:recent:${recentConsole.id}`}
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
                            <div key={`searchconsole:${item.id}`} style={{ paddingBottom: "4px" }}>
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
        </div>
    );
}

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
        language,
        showIcons,
        onPickGame,
        onBack
    } = props;

    const gameWindow = useSlidingWindow({
        items: games,
        itemKey: (game) => String(game.gameId),
        focusKeyFor: (game) => `searchgame:${game.gameId}`,
        windowId: "gamesearch:games",
        heightScope: ["gamesearch:games", getCurrentModalScale(), showIcons, language].join("|"),
        dynamicLoading: true,
        initialRows: INITIAL_GAME_ROWS,
        rowStep: GAME_ROW_STEP,
        fullSteps: true,
        prefetchDistance: GAME_ROW_LOAD_AHEAD,
        sentinelRootMarginPx: GAME_SENTINEL_ROOT_MARGIN_PX,
        resetKey: `searchgame:${query}:${games.length > 0}`,
        debugLabel: "gamesearch:games"
    });
    const mountedGames = gameWindow.mountedItems;

    useWarmWindowIcons(mountedGames, showIcons);

    const gamePickRef = useRef(onPickGame);
    gamePickRef.current = onPickGame;
    const gameFocusRef = useRef(gameWindow.onItemFocus);
    gameFocusRef.current = gameWindow.onItemFocus;

    const gameRowList = useMemo<PickerGameRowListProps>(() => {
        const metrics = pickerRowMetrics();
        return {
            keyPrefix: "searchgame:",
            showIcons,
            metrics,
            onPick: (game) => {
                gamePickRef.current(game);
            },
            onRowFocus: (index) => {
                gameFocusRef.current(index);
            },
            detail: (game) => (
                <>
                    <div style={pickerDetailStyle(metrics)}>{game.consoleName || ""}</div>
                    <div style={pickerStrongStyle(metrics)}>
                        {t(language, "{{count}} achievements", { count: game.maxPossible })}
                    </div>
                </>
            )
        };
    }, [language, showIcons]);

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
            <div data-focus-key="searchgame:refresh">
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
                <div data-focus-key="searchgame:back-to-consoles">
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
                    <SlidingWindowRows list={gameWindow}>
                        {mountedGames.map((game, index) => (
                            <div key={`searchgame:${game.gameId}`} style={{ paddingBottom: "4px" }}>
                                <PickerGameRow
                                    game={game}
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
