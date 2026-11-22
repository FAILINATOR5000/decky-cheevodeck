import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { DialogButton, Focusable, TextField } from "@decky/ui";

import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import { highestAwardLabel } from "../../pages/AllGamesPage";
import type { MyGame, TrackedSetConsole, TrackedSetPickerGame } from "../../types";
import { formatInteger } from "../../utils/format";
import { fetchMyGames, myGamesLoading, rememberMyGamesSystem, useMyGames } from "../../utils/myGames";
import { requestRoute } from "../../utils/pendingPanelEntry";
import { getCurrentModalScale } from "../../utils/scale";
import { searchKey } from "../../utils/searchText";
import { compactButtonStyle, modalBodyStyle } from "../../utils/style";
import { ErrorText } from "../ui/ErrorText";
import { FocusTarget } from "../ui/FocusTarget";
import { InlineSpinner } from "../ui/InlineSpinner";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { ConsoleRow, type ConsoleRowListProps } from "./PickerConsoleRow";
import {
    PickerGameRow,
    pickerDetailStyle,
    pickerRowMetrics,
    pickerStrongStyle,
    useWarmWindowIcons,
    type PickerGameRowListProps
} from "./PickerGameRow";
import { RecentConsoleSection } from "./RecentConsoleSection";

const ALL = "all";
const ALL_ID = -1;
const NAV_ENTER_MAINTAIN_Y = 3;
const INITIAL_ROWS = 40;
const ROW_STEP = 40;
const ROW_LOAD_AHEAD = 12;
const SENTINEL_ROOT_MARGIN_PX = 600;

const NO_GAMES: MyGame[] = [];
const NO_ROWS: TrackedSetPickerGame[] = [];

type SystemEntry = { key: string; id: number; name: string; count: number };

type MyGamesIndex = {
    systems: SystemEntry[];
    rowsBySystem: Map<string, TrackedSetPickerGame[]>;
    titleKeys: Map<number, string>;
    progress: Map<number, NonNullable<MyGame["progress"]>>;
    elsewhere: Set<number>;
};

function systemKeyOf(game: MyGame): string {
    return game.systemId > 0 ? String(game.systemId) : `name:${game.system}`;
}

function indexMyGames(games: MyGame[]): MyGamesIndex {
    const all: TrackedSetPickerGame[] = [];
    const rowsBySystem = new Map<string, TrackedSetPickerGame[]>();
    const names = new Map<string, { id: number; name: string }>();
    const titleKeys = new Map<number, string>();
    const progress = new Map<number, NonNullable<MyGame["progress"]>>();
    const elsewhere = new Set<number>();
    for (const game of games) {
        const row = {
            gameId: game.gameId,
            title: game.title,
            imageIcon: game.imageIcon,
            consoleName: game.system,
            maxPossible: game.progress?.maxPossible ?? 0
        };
        all.push(row);
        const key = systemKeyOf(game);
        const list = rowsBySystem.get(key);
        if (list) {
            list.push(row);
        }
        else {
            rowsBySystem.set(key, [row]);
            names.set(key, { id: Math.max(0, game.systemId), name: game.system });
        }
        titleKeys.set(game.gameId, searchKey(game.title));
        if (game.progress) {
            progress.set(game.gameId, game.progress);
        }
        if (!game.onDevice) {
            elsewhere.add(game.gameId);
        }
    }
    const systems: SystemEntry[] = [];
    for (const [key, system] of names) {
        systems.push({ key, id: system.id, name: system.name, count: rowsBySystem.get(key)?.length ?? 0 });
    }
    rowsBySystem.set(ALL, all);
    return { systems: [{ key: ALL, id: ALL_ID, name: "", count: all.length }, ...systems], rowsBySystem, titleKeys, progress, elsewhere };
}

type MyGamesSearchProps = {
    language: LanguageCode;
    showIcons: boolean;
    canLoad: boolean;
    consoles: TrackedSetConsole[];
    stepBackRef: MutableRefObject<() => boolean>;
    onPick: (game: TrackedSetPickerGame) => void;
    close: () => void;
};

export function MyGamesSearch(props: MyGamesSearchProps) {
    const { language, showIcons, onPick, close } = props;
    const myGames = useMyGames();
    const { listing, fetching, failure } = myGames;

    const [systemKey, setSystemKey] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [refreshNote, setRefreshNote] = useState<"" | "asked" | "done">("");
    const [recentSystemId, setRecentSystemId] = useState<number | null>(null);

    const rootRef = useRef<HTMLDivElement | null>(null);
    const pendingFocusRef = useRef<string | null>(null);

    const games = listing?.games ?? NO_GAMES;
    const index = useMemo(() => indexMyGames(games), [games]);

    const nothingToShow = listing !== null && !listing.scanned && !listing.cached;
    useEffect(function loadWithNothingToShow() {
        if (nothingToShow && props.canLoad) {
            fetchMyGames(true);
        }
    }, [nothingToShow, props.canLoad]);

    useEffect(function noteRefreshAnswered() {
        if (refreshNote === "asked" && fetching === "") {
            setRefreshNote("done");
        }
    }, [refreshNote, fetching]);

    useLayoutEffect(function focusPendingRow() {
        const key = pendingFocusRef.current;
        const root = rootRef.current;
        if (!key || !root) {
            return;
        }
        const target = root.querySelector(
            `[data-focus-key="${key}"] button, [data-focus-key="${key}"] [tabindex]`
        ) as HTMLElement | null;
        if (!target) {
            return;
        }
        pendingFocusRef.current = null;
        target.focus();
    });

    function openSystem(key: string) {
        const id = index.systems.find((entry) => entry.key === key)?.id ?? 0;
        if (id > 0) {
            rememberMyGamesSystem(id);
        }
        pendingFocusRef.current = "mygames:back";
        setQuery("");
        setRefreshNote("");
        setSystemKey(key);
    }

    function backToSystems() {
        const id = index.systems.find((entry) => entry.key === systemKey)?.id ?? 0;
        if (id > 0) {
            setRecentSystemId(id);
        }
        pendingFocusRef.current = `mygames:system:${systemKey !== null && index.rowsBySystem.has(systemKey) ? systemKey : ALL}`;
        setQuery("");
        setRefreshNote("");
        setSystemKey(null);
    }

    props.stepBackRef.current = () => {
        if (systemKey === null) {
            return false;
        }
        backToSystems();
        return true;
    };

    function refresh() {
        if (fetching === "loud") {
            return;
        }
        setRefreshNote("asked");
        fetchMyGames(true);
    }

    function runCheevoCheck() {
        requestRoute({ kind: "cheevoCheck" });
        close();
    }

    if (listing === null) {
        return <div ref={rootRef} />;
    }

    const failureText = failure === "needsSettings"
        ? t(language, "Please enter your RetroAchievements username and Web API key.")
        : t(language, "Couldn't load your games.");
    const waiting = myGamesLoading(myGames);
    const failedFirst = nothingToShow && failure !== "";

    const refreshRow = (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <Focusable
                style={{ display: "flex", flexDirection: "row", gap: "8px", alignItems: "center", flexWrap: "wrap" }}
                flow-children="grid"
            >
                <FocusTarget focusKey="mygames:refresh">
                    <DialogButton onClick={refresh} disabled={fetching === "loud"} style={compactButtonStyle}>
                        {fetching === "loud" ? t(language, "Refreshing...") : t(language, "Refresh list")}
                    </DialogButton>
                </FocusTarget>
                {fetching === "loud" && <InlineSpinner />}
                {fetching === "" && refreshNote === "done" && !failure && (
                    <span style={modalBodyStyle()}>{t(language, "Updated")}</span>
                )}
            </Focusable>
            {fetching === "" && refreshNote === "done" && failure && <ErrorText modal>{failureText}</ErrorText>}
        </div>
    );

    const selectedRows = systemKey !== null ? index.rowsBySystem.get(systemKey) ?? NO_ROWS : NO_ROWS;
    const selectedEntry = index.systems.find((entry) => entry.key === systemKey);
    const selectedName = systemKey === ALL
        ? t(language, "All Systems")
        : props.consoles.find((item) => item.id === selectedEntry?.id)?.name || selectedEntry?.name || t(language, "Unknown console");

    return (
        <div ref={rootRef} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {!listing.scanned && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={modalBodyStyle()}>
                        {t(language, "Currently showing games that RetroAchievements reports you have played. To populate this with your other RA-supported games in your local library, run a Cheevo Check scan.")}
                    </div>
                    <FocusTarget focusKey="mygames:scan">
                        <DialogButton onClick={runCheevoCheck} style={compactButtonStyle}>
                            {t(language, "Run Cheevo Check Scan")}
                        </DialogButton>
                    </FocusTarget>
                </div>
            )}

            {waiting && (
                <div style={{ display: "flex", flexDirection: "row", gap: "8px", alignItems: "center" }}>
                    <InlineSpinner />
                    <span style={modalBodyStyle()}>{t(language, "Loading games...")}</span>
                </div>
            )}

            {failedFirst && <ErrorText modal>{failureText}</ErrorText>}

            {!waiting && !failedFirst && systemKey === null && (
                <Focusable key="mygames:systems">
                    <MyGamesSystems
                        systems={index.systems}
                        consoles={props.consoles}
                        recentSystemId={recentSystemId ?? listing.recentSystemId ?? 0}
                        language={language}
                        showIcons={showIcons}
                        openFirst={pendingFocusRef.current ?? undefined}
                        onOpen={openSystem}
                    />
                    {refreshRow}
                </Focusable>
            )}

            {!waiting && !failedFirst && systemKey !== null && (
                <Focusable key={`mygames:games:${systemKey}`}>
                    <MyGamesGameList
                        systemKey={systemKey}
                        systemName={selectedName}
                        rows={selectedRows}
                        titleKeys={index.titleKeys}
                        progress={index.progress}
                        elsewhere={index.elsewhere}
                        query={query}
                        onQueryChange={setQuery}
                        language={language}
                        showIcons={showIcons}
                        onPick={onPick}
                        onBack={backToSystems}
                    />
                    {refreshRow}
                </Focusable>
            )}
        </div>
    );
}

type MyGamesSystemsProps = {
    systems: SystemEntry[];
    consoles: TrackedSetConsole[];
    recentSystemId: number;
    language: LanguageCode;
    showIcons: boolean;
    openFirst?: string;
    onOpen: (key: string) => void;
};

type SystemRow = { entry: SystemEntry; item: TrackedSetConsole };

function MyGamesSystems(props: MyGamesSystemsProps) {
    const { systems, consoles, recentSystemId, language, showIcons, onOpen } = props;

    const rows = useMemo(() => {
        const catalog = new Map(consoles.map((item) => [item.id, item]));
        const built: SystemRow[] = systems.map((entry) => {
            const known = entry.id > 0 ? catalog.get(entry.id) : undefined;
            const name = entry.key === ALL ? t(language, "All Systems") : known?.name || entry.name;
            return { entry, item: { id: entry.id, name, iconUrl: known?.iconUrl ?? "", active: true } };
        });
        const [all, ...rest] = built;
        rest.sort((a, b) => a.item.name.localeCompare(b.item.name));
        return { all, rest };
    }, [systems, consoles, language]);

    const recent = recentSystemId > 0 ? rows.rest.find((row) => row.entry.id === recentSystemId) ?? null : null;
    const listed = useMemo(() => (recent ? rows.rest.filter((row) => row !== recent) : rows.rest), [rows, recent]);

    const systemWindow = useSlidingWindow({
        items: listed,
        itemKey: (row) => row.entry.key,
        focusKeyFor: (row) => `mygames:system:${row.entry.key}`,
        windowId: "mygames:systems",
        heightScope: ["mygames:systems", getCurrentModalScale(), showIcons, language].join("|"),
        dynamicLoading: true,
        initialRows: INITIAL_ROWS,
        rowStep: ROW_STEP,
        fullSteps: true,
        prefetchDistance: ROW_LOAD_AHEAD,
        sentinelRootMarginPx: SENTINEL_ROOT_MARGIN_PX,
        resetKey: `mygames:systems:${listed.length > 0}`,
        openFirst: props.openFirst
    });

    const openRef = useRef(onOpen);
    openRef.current = onOpen;
    const focusRef = useRef(systemWindow.onItemFocus);
    focusRef.current = systemWindow.onItemFocus;
    const keysRef = useRef(new Map<TrackedSetConsole, string>());
    keysRef.current = new Map([rows.all, ...rows.rest].map((row) => [row.item, row.entry.key]));

    const rowList = useMemo<ConsoleRowListProps>(() => ({
        language,
        showIcons,
        metrics: pickerRowMetrics(),
        onPick: (item) => {
            const key = keysRef.current.get(item);
            if (key) {
                openRef.current(key);
            }
        },
        keyPrefix: "mygames:system:",
        onRowFocus: (index) => {
            focusRef.current(index);
        }
    }), [language, showIcons]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
            <div style={{ ...modalBodyStyle(), fontWeight: 700 }}>
                {t(language, "Pick a system")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <ConsoleRow
                    item={rows.all.item}
                    dimmed={false}
                    list={rowList}
                    rowKey={ALL}
                    count={rows.all.entry.count}
                    allSystems
                />
                {recent && (
                    <RecentConsoleSection language={language}>
                        <ConsoleRow
                            item={recent.item}
                            dimmed={false}
                            list={rowList}
                            rowKey={recent.entry.key}
                            count={recent.entry.count}
                        />
                    </RecentConsoleSection>
                )}
                <Focusable
                    flow-children="column"
                    resetNavOnEntry
                    navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}
                    style={{ display: "flex", flexDirection: "column" }}
                >
                    <SlidingWindowRows list={systemWindow}>
                        {systemWindow.mountedItems.map((row, i) => (
                            <div key={row.entry.key} style={{ paddingBottom: "4px" }}>
                                <ConsoleRow
                                    item={row.item}
                                    dimmed={false}
                                    list={rowList}
                                    rowKey={row.entry.key}
                                    count={row.entry.count}
                                    index={systemWindow.start + i}
                                    onGamepadDirection={systemWindow.guardTopRow(systemWindow.start + i)}
                                />
                            </div>
                        ))}
                    </SlidingWindowRows>
                </Focusable>
            </div>
        </div>
    );
}

type MyGamesGameListProps = {
    systemKey: string;
    systemName: string;
    rows: TrackedSetPickerGame[];
    titleKeys: Map<number, string>;
    progress: MyGamesIndex["progress"];
    elsewhere: Set<number>;
    query: string;
    onQueryChange: (next: string) => void;
    language: LanguageCode;
    showIcons: boolean;
    onPick: (game: TrackedSetPickerGame) => void;
    onBack: () => void;
};

function MyGamesGameList(props: MyGamesGameListProps) {
    const { systemKey, systemName, rows, titleKeys, progress, elsewhere, query, onQueryChange, language, showIcons, onPick, onBack } = props;
    const showSystem = systemKey === ALL;

    const filtered = useMemo(() => {
        const wanted = searchKey(query.trim());
        if (!wanted) {
            return rows;
        }
        return rows.filter((row) => (titleKeys.get(row.gameId) ?? "").includes(wanted));
    }, [rows, titleKeys, query]);

    const gameWindow = useSlidingWindow({
        items: filtered,
        itemKey: (game) => String(game.gameId),
        focusKeyFor: (game) => `mygames:game:${game.gameId}`,
        windowId: `mygames:games:${systemKey}`,
        heightScope: ["mygames:games", getCurrentModalScale(), showIcons, language, showSystem].join("|"),
        dynamicLoading: true,
        initialRows: INITIAL_ROWS,
        rowStep: ROW_STEP,
        fullSteps: true,
        prefetchDistance: ROW_LOAD_AHEAD,
        sentinelRootMarginPx: SENTINEL_ROOT_MARGIN_PX,
        resetKey: `mygames:${systemKey}:${query}:${filtered.length > 0}`
    });
    const mountedGames = gameWindow.mountedItems;

    useWarmWindowIcons(mountedGames, showIcons);

    const pickRef = useRef(onPick);
    pickRef.current = onPick;
    const focusRef = useRef(gameWindow.onItemFocus);
    focusRef.current = gameWindow.onItemFocus;

    const rowList = useMemo<PickerGameRowListProps>(() => {
        const metrics = pickerRowMetrics();
        return {
            keyPrefix: "mygames:game:",
            showIcons,
            metrics,
            onPick: (game) => {
                pickRef.current(game);
            },
            onRowFocus: (index) => {
                focusRef.current(index);
            },
            detail: (game) => {
                const counts = progress.get(game.gameId);
                return (
                    <>
                        {showSystem && (
                            <div style={pickerDetailStyle(metrics)}>{game.consoleName || t(language, "Unknown console")}</div>
                        )}
                        {counts && (
                            <div style={pickerDetailStyle(metrics)}>
                                {counts.maxPossible > 0
                                    ? t(language, "Completion: {{earned}} / {{total}}", {
                                        earned: formatInteger(counts.numAwarded),
                                        total: formatInteger(counts.maxPossible)
                                    })
                                    : t(language, "No awards yet.")}
                            </div>
                        )}
                        {counts && (
                            <div style={pickerStrongStyle(metrics)}>
                                {t(language, "Status: {{status}}", {
                                    status: highestAwardLabel(counts.highestAwardKind, language)
                                })}
                            </div>
                        )}
                        {elsewhere.has(game.gameId) && (
                            <div style={{ ...pickerDetailStyle(metrics), opacity: 0.7 }}>{t(language, "Not on this device")}</div>
                        )}
                    </>
                );
            }
        };
    }, [language, showIcons, progress, elsewhere, showSystem]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "10px" }}>
            <Focusable
                style={{ display: "flex", flexDirection: "row", gap: "8px", alignItems: "center" }}
                flow-children="row"
            >
                <FocusTarget focusKey="mygames:back">
                    <DialogButton onClick={onBack} style={compactButtonStyle}>
                        {t(language, "← Systems")}
                    </DialogButton>
                </FocusTarget>
                <div style={{ fontWeight: 700, minWidth: 0, wordBreak: "break-word" }}>
                    {systemName}
                </div>
            </Focusable>

            <div data-focus-key="mygames:filter">
                <TextField
                    value={query}
                    onChange={(e: any) => onQueryChange(e?.target?.value ?? "")}
                />
            </div>

            {query.trim() !== "" && filtered.length === 0 && (
                <div style={modalBodyStyle()}>{t(language, "No games match that search.")}</div>
            )}

            {filtered.length > 0 && (
                <Focusable
                    flow-children="column"
                    resetNavOnEntry
                    navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}
                    style={{ display: "flex", flexDirection: "column" }}
                >
                    <SlidingWindowRows list={gameWindow}>
                        {mountedGames.map((game, i) => (
                            <div key={`mygames:game:${game.gameId}`} style={{ paddingBottom: "4px" }}>
                                <PickerGameRow
                                    game={game}
                                    index={gameWindow.start + i}
                                    list={rowList}
                                    onGamepadDirection={gameWindow.guardTopRow(gameWindow.start + i)}
                                />
                            </div>
                        ))}
                    </SlidingWindowRows>
                </Focusable>
            )}
        </div>
    );
}
