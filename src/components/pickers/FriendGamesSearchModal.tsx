import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import {
    getSetConsoleList,
    prefetchGameIcons
} from "../../api";
import { useResilientGameIcon } from "../../hooks/useResilientGameIcon";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { t, type LanguageCode } from "../../locales";
import type { FriendAllGameRow } from "../../types";
import { logError } from "../../utils/errors";
import { formatInteger } from "../../utils/format";
import { modalBodyStyle, smallTextStyle, compactButtonStyle, FADE_IN_KEYFRAMES } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { searchKey } from "../../utils/searchText";
import {
    gameMatchesStatusFilter,
    highestAwardLabel,
    nextAllGamesStatusFilter,
    statusFilterLabel
} from "../../pages/AllGamesPage";
import type { AllGamesStatusFilter } from "../../types";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

export type FriendGamesSearchModalProps = {
    language: LanguageCode;
    showIcons: boolean;
    games: FriendAllGameRow[];
    consoleIcons?: Record<number, string>;
    onPick: (gameId: number) => void;
    close: () => void;
};

type Step = "console" | "games";

type ConsoleGroup = {
    id: number;
    name: string;
    count: number;
};

const ALL_CONSOLES_ID = -1;

function AllSystemsIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
        >
            <rect x="3" y="3" width="8" height="8" rx="1.5" />
            <rect x="13" y="3" width="8" height="8" rx="1.5" />
            <rect x="3" y="13" width="8" height="8" rx="1.5" />
            <rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>
    );
}

export function FriendGamesSearchModal(props: FriendGamesSearchModalProps) {
    const { language, showIcons, games, consoleIcons, onPick, close } = props;

    const [step, setStep] = useState<Step>("console");
    const [selectedConsole, setSelectedConsole] = useState<ConsoleGroup | null>(null);

    const [query, setQuery] = useState("");

    const [statusFilter, setStatusFilter] = useState<AllGamesStatusFilter>("all");

    const [catalogIconsById, setCatalogIconsById] = useState<Record<number, string>>({});

    useEffect(() => {
        if (!showIcons) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const result = await getSetConsoleList();
                if (cancelled) {
                    return;
                }
                const map: Record<number, string> = {};
                for (const item of result.consoles ?? []) {
                    if (item.iconUrl) {
                        map[item.id] = item.iconUrl;
                    }
                }
                setCatalogIconsById(map);
            } catch (e) {
                logError("getSetConsoleList (friend search)", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [showIcons]);

    const resolvedConsoleIcons = useMemo(() => {
        return { ...catalogIconsById, ...(consoleIcons ?? {}) };
    }, [catalogIconsById, consoleIcons]);

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const focusedTopForStepRef = useRef<Step | null>(null);

    const consoleGroups = useMemo(() => {
        const byId = new Map<number, ConsoleGroup>();
        for (const game of games) {
            const id = game.consoleId ?? 0;
            const existing = byId.get(id);
            if (existing) {
                existing.count += 1;
            } else {
                byId.set(id, {
                    id,
                    name: game.consoleName || t(language, "Unknown console"),
                    count: 1
                });
            }
        }
        const sorted = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
        if (sorted.length === 0) {
            return sorted;
        }
        const allEntry: ConsoleGroup = {
            id: ALL_CONSOLES_ID,
            name: t(language, "All systems"),
            count: games.length
        };
        return [allEntry, ...sorted];
    }, [games, language]);

    const consoleGames = useMemo(() => {
        if (!selectedConsole) {
            return [];
        }
        if (selectedConsole.id === ALL_CONSOLES_ID) {
            return games;
        }
        return games.filter((game) => (game.consoleId ?? 0) === selectedConsole.id);
    }, [games, selectedConsole]);

    useEffect(function focusTopOfListWhenReady() {
        if (focusedTopForStepRef.current === step) {
            return;
        }
        const root = bodyRef.current;
        if (!root) {
            return;
        }
        const prefix = step === "console" ? "searchconsole:" : "searchgame:";
        const firstRow = root.querySelector(
            `[data-focus-key^="${prefix}"] button, [data-focus-key^="${prefix}"] [tabindex]`
        ) as HTMLElement | null;
        if (!firstRow) {
            return;
        }
        focusedTopForStepRef.current = step;
        firstRow.focus();
    }, [step, consoleGroups, consoleGames]);

    function handlePickConsole(item: ConsoleGroup) {
        setSelectedConsole(item);
        setStep("games");
        setQuery("");
        setStatusFilter("all");
    }

    function handleCycleStatusFilter() {
        setStatusFilter((current) => nextAllGamesStatusFilter(current));
    }

    function handleBackToConsoles() {
        setStep("console");
        setSelectedConsole(null);
        setQuery("");
    }

    function handlePickGame(game: FriendAllGameRow) {
        onPick(game.gameId);
    }

    const titleKeys = useMemo(() => consoleGames.map((game) => searchKey(game.title)), [consoleGames]);

    const filteredGames = useMemo(() => {
        const trimmed = searchKey(query.trim());
        return consoleGames.filter((game, index) => {
            if (trimmed && !titleKeys[index].includes(trimmed)) {
                return false;
            }
            return gameMatchesStatusFilter(game, statusFilter);
        });
    }, [consoleGames, titleKeys, query, statusFilter]);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Select a Game")}
            </div>

            <div ref={bodyRef}>
                {step === "console" && (
                    <ConsoleStep
                        consoles={consoleGroups}
                        consoleIcons={resolvedConsoleIcons}
                        language={language}
                        showIcons={showIcons}
                        onPick={handlePickConsole}
                    />
                )}

                {step === "games" && selectedConsole && (
                    <GameStep
                        consoleName={selectedConsole.name}
                        games={filteredGames}
                        query={query}
                        onQueryChange={setQuery}
                        statusFilter={statusFilter}
                        onCycleStatusFilter={handleCycleStatusFilter}
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
                    {t(language, "Cancel")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

type ConsoleStepProps = {
    consoles: ConsoleGroup[];
    consoleIcons?: Record<number, string>;
    language: LanguageCode;
    showIcons: boolean;
    onPick: (item: ConsoleGroup) => void;
};

function ConsoleStep(props: ConsoleStepProps) {
    const { consoles, consoleIcons, language, showIcons, onPick } = props;

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
                {consoles.map((item) => (
                    <ConsoleRow
                        key={`searchconsole:${item.id}`}
                        item={item}
                        iconUrl={consoleIcons?.[item.id] ?? null}
                        list={rowList}
                    />
                ))}
            </div>
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
    onPick: (item: ConsoleGroup) => void;
};

type ConsoleRowProps = {
    item: ConsoleGroup;
    iconUrl: string | null;
    list: ConsoleRowListProps;
};

const ConsoleRow = React.memo(function ConsoleRow(props: ConsoleRowProps) {
    const { item, iconUrl, list } = props;
    const { language, showIcons, metrics } = list;

    const fallbackLetter = item.name.trim().charAt(0).toUpperCase() || "?";

    function handleClick() {
        list.onPick(item);
    }

    return (
        <FocusableItem
            focusKey={`searchconsole:${item.id}`}
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
                            fontWeight: 800
                        }}
                    >
                        {item.id === ALL_CONSOLES_ID ? (
                            <AllSystemsIcon size={Math.round(metrics.iconSize * 0.55)} />
                        ) : iconUrl ? (
                            <img
                                src={iconUrl}
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
                        {item.name || t(language, "Unknown console")}
                    </div>
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.bodyFontSize}px`,
                            lineHeight: metrics.bodyLineHeight,
                            opacity: 1,
                            minWidth: 0
                        }}
                    >
                        {t(language, "{{count}} games", { count: item.count })}
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});

type GameStepProps = {
    consoleName: string;
    games: FriendAllGameRow[];
    query: string;
    onQueryChange: (next: string) => void;
    statusFilter: AllGamesStatusFilter;
    onCycleStatusFilter: () => void;
    language: LanguageCode;
    showIcons: boolean;
    onPickGame: (game: FriendAllGameRow) => void;
    onBack: () => void;
};

function GameStep(props: GameStepProps) {
    const {
        consoleName,
        games,
        query,
        onQueryChange,
        statusFilter,
        onCycleStatusFilter,
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
    }, [query, statusFilter, games.length]);

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
    const desiredIconGamesRef = useRef<FriendAllGameRow[] | null>(null);

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
            />

            <FocusableItem
                focusKey="searchgame:statusfilter"
                onClick={onCycleStatusFilter}
                outerStyle={{ width: "100%", minWidth: 0 }}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "8px"
                    }}
                >
                    <span style={{ fontWeight: 700 }}>{t(language, "Filter")}</span>
                    <span style={{ ...modalBodyStyle(), whiteSpace: "nowrap" }}>
                        {statusFilterLabel(statusFilter, language)}
                    </span>
                </div>
            </FocusableItem>

            {games.length === 0 && (
                <div style={modalBodyStyle()}>
                    {t(language, "Not found. The game may not have achievements yet, or may be listed under a different console.")}
                </div>
            )}

            {games.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {mountedGames.map((game, index) => (
                        <PickerGameRow
                            key={`searchgame:${game.gameId}`}
                            game={game}
                            index={index}
                            list={gameRowList}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

type PickerGameRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: PickerRowMetrics;
    onPick: (game: FriendAllGameRow) => void;
    onRowFocus: (index: number) => void;
};

type PickerGameRowProps = {
    game: FriendAllGameRow;
    index: number;
    list: PickerGameRowListProps;
};

const PickerGameRow = React.memo(function PickerGameRow(props: PickerGameRowProps) {
    const { game, list } = props;
    const { language, showIcons, metrics } = list;

    const { iconDataUri, cold } = useResilientGameIcon(game.gameId, game.imageIcon, "getGameIconCached (friend search picker row)");

    const fallbackLetter = game.title.trim().charAt(0).toUpperCase() || "?";

    function handleClick() {
        list.onPick(game);
    }

    function handleFocus() {
        list.onRowFocus(props.index);
    }

    return (
        <FocusableItem
            focusKey={`searchgame:${game.gameId}`}
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
                            fontSize: `${metrics.bodyFontSize}px`,
                            lineHeight: metrics.bodyLineHeight,
                            opacity: 1,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {(game.maxPossible ?? 0) > 0
                            ? t(language, "Completion: {{earned}} / {{total}}", {
                                earned: formatInteger(game.numAwarded),
                                total: formatInteger(game.maxPossible)
                            })
                            : t(language, "No awards yet.")}
                    </div>
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.pointsFontSize}px`,
                            lineHeight: metrics.pointsLineHeight,
                            opacity: 1,
                            fontWeight: 800,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {t(language, "Status: {{status}}", {
                            status: highestAwardLabel(game.highestAwardKind, language)
                        })}
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});
