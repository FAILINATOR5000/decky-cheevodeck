import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    DialogButton,
    Focusable,
    ModalRoot,
    PanelSection,
    PanelSectionRow,
    TextField
} from "@decky/ui";
import {
    getSetConsoleList,
    logFocusDebug,
    prefetchGameIcons,
    saveTrackedSetsSelectorFilter,
    saveTrackedSetsSelectorSort
} from "../api";
import { useGameIcon } from "../hooks/useGameIcon";
import { useWindowedList } from "../hooks/useWindowedList";
import { AddGameToSetModal } from "../components/pickers/AddGameToSetModal";
import { ButtonHints } from "../components/ui/ButtonHints";
import { ErrorText } from "../components/ui/ErrorText";
import { FadeImage } from "../components/ui/FadeImage";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { FocusableItem } from "../components/ui/FocusableItem";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ReorderStrip } from "../components/ui/ReorderStrip";
import { SetGameNoteEditModal } from "../components/notes/SetGameNoteEditModal";
import { SetMosaicBanner, type SetMosaicEntry } from "../components/mastery/SetMosaicBanner";
import { SystemHeader } from "../components/mastery/SystemHeader";
import type {
    AddTrackedSetGamePayload,
    AddTrackedSetGameResponse,
    ButtonSpacing,
    ControllerGlyphStyle,
    NoteColor,
    ReorderDirection,
    TrackedSet,
    TrackedSetAButtonMode,
    TrackedSetAward,
    TrackedSetConsole,
    TrackedSetFilter,
    TrackedSetGame,
    TrackedSetGameSort,
    TrackedSetSelectorSort,
    TrackedSetViewMode,
    UiSize,
    ViewKey
} from "../types";
import { localizeRuntimeText, t, type LanguageCode } from "../locales";
import {
    gamesCountLabel,
    nextTrackedSetAButtonMode,
    nextTrackedSetFilter,
    nextTrackedSetGameSort,
    nextTrackedSetSelectorSort,
    nextTrackedSetViewMode,
    noteBodyColor,
    trackedSetAButtonModeLabel,
    trackedSetFilterLabel,
    trackedSetGameSortLabel,
    trackedSetSelectorSortLabel,
    trackedSetViewModeLabel
} from "../utils/achievements";
import { compareConsolesByName, compareConsolesByYear } from "../utils/consoles";
import {
    BUTTON_BUMPER_RIGHT,
    BUTTON_DIR_DOWN,
    BUTTON_DIR_UP,
    BUTTON_OPTIONS
} from "../utils/gamepadButtons";
import { showManagedModal } from "../utils/modalRegistry";
import { playOkSound } from "../utils/navSound";
import { achievementUiMetrics, type AchievementUiMetrics, regularButtonSpacingStyle, smallTextStyle, bodyTextStyle, achievementGreen, FADE_IN_KEYFRAMES } from "../utils/style";
import { modalSize } from "../utils/scale";
import { SaveOnStart } from "../components/ui/SaveOnStart";
import { SnapshotHotkey } from "../components/ui/SnapshotHotkey";


type DeleteFocusPlan =
    | { kind: "claim"; slotIndex: number }
    | { kind: "back" };

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function TrashIcon({ size = 16 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M170.5 51.6L151.5 80l145 0-19-28.4c-1.5-2.2-4-3.6-6.7-3.6l-93.7 0c-2.7 0-5.2 1.3-6.7 3.6zm147-26.6L354.2 80 368 80l48 0 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-8 0 0 304c0 44.2-35.8 80-80 80l-224 0c-44.2 0-80-35.8-80-80l0-304-8 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l8 0 48 0 13.8 0 36.7-55c10.4-15.6 27.9-25 46.7-25l93.7 0c18.7 0 36.2 9.4 46.7 25zM80 128l0 304c0 17.7 14.3 32 32 32l224 0c17.7 0 32-14.3 32-32l0-304L80 128zm80 64l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16z" />
        </svg>
    );
}


type TrackedSetsPageProps = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    uiSize: UiSize;
    dynamicTrackedSetsListLoading: boolean;
    dynamicTrackedSetsListInitialRows: number;
    dynamicTrackedSetsListRowStep: number;
    dynamicTrackedSetsListPrefetchDistance: number;
    dynamicTrackedSetsListSentinelRootMargin: number;
    sets: TrackedSet[];
    setsLoading: boolean;
    setsError: string | null;
    openSet: TrackedSet | null;
    openSetId: string | null;
    checkLoading: boolean;
    checkError: string | null;
    selectorSort: TrackedSetSelectorSort;
    setSelectorSort: (next: TrackedSetSelectorSort) => void;
    selectorFilter: TrackedSetFilter;
    setSelectorFilter: (next: TrackedSetFilter) => void;
    aButtonMode: TrackedSetAButtonMode;
    onChangeAButtonMode: (next: TrackedSetAButtonMode) => void | Promise<unknown>;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    onRequestFocus: (focusKey: string) => void;
    onOpenSet: (setId: string) => void | Promise<void>;
    onCloseSet: () => void;
    onChangeGameFilter: (setId: string, filter: TrackedSetFilter) => Promise<boolean>;
    onCreateSet: (name: string) => Promise<TrackedSet | null>;
    onRenameSet: (setId: string, name: string) => Promise<boolean>;
    onRemoveSet: (setId: string) => Promise<boolean>;
    onAddGame: (setId: string, game: AddTrackedSetGamePayload) => Promise<AddTrackedSetGameResponse | { ok: false }>;
    onRemoveGame: (setId: string, gameId: number) => Promise<boolean>;
    onSaveGameNote: (setId: string, gameId: number, note: string, color: NoteColor) => Promise<boolean>;
    onReorderGames: (setId: string, orderedIds: (string | number)[], order: TrackedSetViewMode) => Promise<boolean>;
    onChangeGameSort: (setId: string, sort: TrackedSetGameSort) => Promise<boolean>;
    onChangeViewMode: (setId: string, viewMode: TrackedSetViewMode) => Promise<boolean>;
    onRunCheck: (setId: string) => void | Promise<void>;
    onOpenGameOverview: (gameId: number) => void;
    onBack: () => void | Promise<void>;
    backToMain: boolean;
    onHome: () => void | Promise<void>;
};


function isGameDone(game: TrackedSetGame): boolean {
    return (
        game.maxPossible !== null
        && game.maxPossible > 0
        && game.numAwarded !== null
        && game.numAwarded >= game.maxPossible
    );
}

function sumSetProgress(set: TrackedSet): { awarded: number; possible: number; anyChecked: boolean } {
    let awarded = 0;
    let possible = 0;
    let anyChecked = false;
    for (const game of set.games) {
        if (game.numAwarded !== null) {
            anyChecked = true;
            awarded += game.numAwarded;
        }
        if (game.maxPossible !== null && game.maxPossible > 0) {
            possible += game.maxPossible;
        }
    }
    return { awarded, possible, anyChecked };
}

function weightedPercent(set: TrackedSet): number | null {
    const { awarded, possible, anyChecked } = sumSetProgress(set);
    if (!anyChecked || possible === 0) {
        return null;
    }
    return Math.floor((awarded / possible) * 100);
}

function isSetCompleted(set: TrackedSet): boolean {
    const { awarded, possible, anyChecked } = sumSetProgress(set);
    return anyChecked && possible > 0 && awarded >= possible;
}

function orderFieldForView(view: TrackedSetViewMode): "manualOrder" | "systemOrder" | "systemYearOrder" | "retroOrder" | "retroAlphaOrder" {
    if (view === "system") {
        return "systemOrder";
    }
    if (view === "systemYear") {
        return "systemYearOrder";
    }
    if (view === "retroHistory") {
        return "retroOrder";
    }
    if (view === "retroHistoryAlpha") {
        return "retroAlphaOrder";
    }
    return "manualOrder";
}

function orderGamesByField(
    games: TrackedSetGame[],
    gameSort: TrackedSetGameSort,
    field: "manualOrder" | "systemOrder" | "systemYearOrder" | "retroOrder" | "retroAlphaOrder"
): TrackedSetGame[] {
    const ordered = [...games];
    if (gameSort === "recent") {
        ordered.sort((a, b) => b[field] - a[field]);
    } else {
        ordered.sort((a, b) => a[field] - b[field]);
    }
    return ordered;
}

type ConsoleGroup = { consoleName: string; games: TrackedSetGame[] };

function groupGamesByConsole(
    games: TrackedSetGame[],
    view: TrackedSetViewMode,
    gameSort: TrackedSetGameSort
): ConsoleGroup[] {
    const buckets = new Map<string, TrackedSetGame[]>();
    for (const game of games) {
        const key = game.consoleName || "";
        const bucket = buckets.get(key);
        if (bucket) {
            bucket.push(game);
        } else {
            buckets.set(key, [game]);
        }
    }
    const compare = (view === "systemYear" || view === "retroHistory") ? compareConsolesByYear : compareConsolesByName;
    const names = [...buckets.keys()].sort(compare);
    const field = orderFieldForView(view);
    return names.map((name) => ({
        consoleName: name,
        games: orderGamesByField(buckets.get(name) || [], gameSort, field)
    }));
}

function gamesInSameGroup(set: TrackedSet, gameId: number): TrackedSetGame[] {
    const field = orderFieldForView(set.viewMode);
    if (set.viewMode === "all") {
        return orderGamesByField(set.games, set.gameSort, field);
    }
    const target = set.games.find((g) => g.gameId === gameId);
    const key = target ? (target.consoleName || "") : "";
    const sameConsole = set.games.filter((g) => (g.consoleName || "") === key);
    return orderGamesByField(sameConsole, set.gameSort, field);
}

const MOSAIC_TILE_COUNT = 4;

function firstGamesForMosaic(set: TrackedSet): TrackedSetGame[] {
    if (set.viewMode === "all") {
        return orderGamesByField(set.games, set.gameSort, orderFieldForView(set.viewMode)).slice(0, MOSAIC_TILE_COUNT);
    }
    const flat: TrackedSetGame[] = [];
    for (const group of groupGamesByConsole(set.games, set.viewMode, set.gameSort)) {
        for (const game of group.games) {
            flat.push(game);
        }
    }
    return flat.slice(0, MOSAIC_TILE_COUNT);
}

function mosaicEntriesForSet(set: TrackedSet): SetMosaicEntry[] {
    return firstGamesForMosaic(set).map((game) => ({ gameId: game.gameId, imageIcon: game.imageIcon }));
}


function TrackedSetsPage(props: TrackedSetsPageProps) {
    if (props.view !== "trackedSets" && props.view !== "trackedSetOpen") {
        return null;
    }

    const {
        language,
        buttonSpacing,
        showIcons,
        uiSize,
        dynamicTrackedSetsListLoading,
        dynamicTrackedSetsListInitialRows,
        dynamicTrackedSetsListRowStep,
        dynamicTrackedSetsListPrefetchDistance,
        dynamicTrackedSetsListSentinelRootMargin,
        sets,
        setsLoading,
        setsError,
        openSet,
        openSetId,
        checkLoading,
        checkError,
        selectorSort,
        setSelectorSort,
        selectorFilter,
        setSelectorFilter,
        aButtonMode,
        onChangeAButtonMode,
        mouseKeyboardMode,
        controllerGlyphStyle,
        onRequestFocus,
        onOpenSet,
        onCloseSet,
        onChangeGameFilter,
        onCreateSet,
        onRenameSet,
        onRemoveSet,
        onAddGame,
        onRemoveGame,
        onSaveGameNote,
        onReorderGames,
        onChangeGameSort,
        onChangeViewMode,
        onRunCheck,
        onOpenGameOverview,
        onBack,
        onHome,
    } = props;

    const buttonOuterStyle = regularButtonSpacingStyle(buttonSpacing);

    const [defaultNoteColor, setDefaultNoteColor] = useState<NoteColor>("default");

    const [backClaimToken, setBackClaimToken] = useState(0);

    const [reorderTargetId, setReorderTargetId] = useState<number | null>(null);

    const [reorderViaSwap, setReorderViaSwap] = useState(false);

    const showingSelector = props.view === "trackedSets" || openSet === null;

    const openSetResolving =
        props.view === "trackedSetOpen" && openSet === null && openSetId !== null && setsLoading;

    useEffect(() => {
        logFocusDebug(
            "trackedset-resolving",
            openSetResolving ? "(resolving)" : "(resolved)",
            `view=${props.view} openSetId=${openSetId ?? "(none)"} hasSet=${openSet !== null} setsLoading=${setsLoading}`
        );
    }, [openSetResolving, props.view, openSetId, openSet, setsLoading]);

    function handleCycleSelectorSort() {
        const next = nextTrackedSetSelectorSort(selectorSort);
        setSelectorSort(next);
        void saveTrackedSetsSelectorSort(next).catch(() => {
        });
    }

    function handleCycleSelectorFilter() {
        const next = nextTrackedSetFilter(selectorFilter);
        setSelectorFilter(next);
        void saveTrackedSetsSelectorFilter(next).catch(() => {
        });
    }

    function openCreateSetModal() {
        showManagedModal((close) => (
            <NameSetModal
                title={t(language, "New Goal")}
                initialName=""
                language={language}
                onSubmit={async (name) => {
                    const created = await onCreateSet(name);
                    return created !== null;
                }}
                close={close}
            />
        ));
    }

    function openRenameModal(set: TrackedSet) {
        showManagedModal((close) => (
            <NameSetModal
                title={t(language, "Rename Goal")}
                initialName={set.name}
                language={language}
                onSubmit={(name) => onRenameSet(set.id, name)}
                close={close}
            />
        ));
    }

    function openAddGameModal(set: TrackedSet) {
        showManagedModal((close) => (
            <AddGameToSetModal
                setName={set.name}
                language={language}
                showIcons={showIcons}
                onAddGame={(game) => onAddGame(set.id, game)}
                close={close}
            />
        ));
    }

    function openNoteModal(set: TrackedSet, game: TrackedSetGame) {
        showManagedModal((close) => (
            <SetGameNoteEditModal
                gameTitle={game.title}
                currentNote={game.note}
                currentColor={game.color}
                saveNote={(note, color) => onSaveGameNote(set.id, game.gameId, note, color)}
                close={close}
                language={language}
                defaultNoteColor={defaultNoteColor}
                setDefaultNoteColor={setDefaultNoteColor}
            />
        ));
    }

    function handleChangeGameSort(set: TrackedSet) {
        const next = nextTrackedSetGameSort(set.gameSort);
        if (next !== "manual") {
            setReorderTargetId(null);
        }
        void onChangeGameSort(set.id, next);
    }

    function handleChangeViewMode(set: TrackedSet) {
        setReorderTargetId(null);
        void onChangeViewMode(set.id, nextTrackedSetViewMode(set.viewMode));
    }

    function handleChangeGameFilter(set: TrackedSet) {
        void onChangeGameFilter(set.id, nextTrackedSetFilter(set.gameFilter));
    }

    function handleCycleAButtonMode(set: TrackedSet) {
        const next = nextTrackedSetAButtonMode(aButtonMode, set.gameSort, set.games.length);
        if (next !== "reorder") {
            setReorderTargetId(null);
        }
        void onChangeAButtonMode(next);
    }

    function handlePickOrSwap(set: TrackedSet, gameId: number, allowSwap = true) {
        if (reorderTargetId === null) {
            setReorderViaSwap(false);
            setReorderTargetId(gameId);
            return;
        }
        if (reorderTargetId === gameId) {
            setReorderTargetId(null);
            return;
        }
        if (!allowSwap) {
            setReorderViaSwap(false);
            setReorderTargetId(gameId);
            return;
        }
        const ordered = gamesInSameGroup(set, reorderTargetId).map((g) => g.gameId);
        const from = ordered.indexOf(reorderTargetId);
        const to = ordered.indexOf(gameId);
        if (from < 0 || to < 0) {
            setReorderTargetId(null);
            return;
        }
        const movedId = reorderTargetId;
        const swapped = ordered.slice();
        swapped[from] = gameId;
        swapped[to] = movedId;
        setReorderViaSwap(true);
        setReorderTargetId(movedId);
        void onReorderGames(set.id, swapped, set.viewMode);
    }

    function handleReorderMove(set: TrackedSet, direction: ReorderDirection) {
        if (reorderTargetId === null) {
            return;
        }
        const ordered = gamesInSameGroup(set, reorderTargetId).map((g) => g.gameId);
        const from = ordered.indexOf(reorderTargetId);
        if (from < 0) {
            return;
        }
        let to = from;
        if (direction === "up") {
            to = from - 1;
        } else if (direction === "down") {
            to = from + 1;
        } else if (direction === "top") {
            to = 0;
        } else if (direction === "bottom") {
            to = ordered.length - 1;
        }
        if (to < 0 || to >= ordered.length || to === from) {
            return;
        }
        ordered.splice(from, 1);
        ordered.splice(to, 0, reorderTargetId);
        setReorderViaSwap(false);
        void onReorderGames(set.id, ordered, set.viewMode);
    }

    return (
        <>
            <style>{FADE_IN_KEYFRAMES}</style>
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Mastery Goals")}
                    buttonSpacing={buttonSpacing}
                    onHome={onHome}
                />
                <BackButton
                    key={`back:${backClaimToken}`}
                    label={props.view === "trackedSets"
                        ? t(language, props.backToMain ? "← Back to Main" : "← Back to Profile")
                        : t(language, "← Back to Goals")}
                    focusKey={props.view === "trackedSets" ? "trackedsets:back" : "trackedsetopen:back"}
                    navAutoFocus
                    buttonSpacing={buttonSpacing}
                    onClick={props.view === "trackedSets" ? onBack : onCloseSet}
                />

                {setsError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, setsError)}</ErrorText>
                    </PanelSectionRow>
                )}

                {
}
                {showingSelector && !openSetResolving && (
                    <PanelSectionRow>
                        <FocusableItem
                            outerStyle={buttonOuterStyle}
                            focusKey="trackedsets:addset"
                            onClick={openCreateSetModal}
                        >
                            {t(language, "New Goal")}
                        </FocusableItem>
                    </PanelSectionRow>
                )}

                {openSetResolving && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>{t(language, "Loading...")}</div>
                    </PanelSectionRow>
                )}

                {!openSetResolving && !showingSelector && (
                    <OpenSetView
                        set={openSet as TrackedSet}
                        aButtonMode={aButtonMode}
                        checkLoading={checkLoading}
                        checkError={checkError}
                        reorderTargetId={reorderTargetId}
                        reorderViaSwap={reorderViaSwap}
                        language={language}
                        showIcons={showIcons}
                        uiSize={uiSize}
                        buttonOuterStyle={buttonOuterStyle}
                        mouseKeyboardMode={mouseKeyboardMode}
                        controllerGlyphStyle={controllerGlyphStyle}
                        dynamicLoading={dynamicTrackedSetsListLoading}
                        dynamicInitialRows={dynamicTrackedSetsListInitialRows}
                        dynamicRowStep={dynamicTrackedSetsListRowStep}
                        dynamicPrefetchDistance={dynamicTrackedSetsListPrefetchDistance}
                        dynamicSentinelRootMargin={dynamicTrackedSetsListSentinelRootMargin}
                        onClaimBack={() => {
                            setBackClaimToken((token) => token + 1);
                            onRequestFocus("trackedsetopen:back");
                        }}
                        onChangeGameFilter={handleChangeGameFilter}
                        onRunCheck={() => openSetId && onRunCheck(openSetId)}
                        onRename={openRenameModal}
                        onRemove={onRemoveSet}
                        onAddGame={openAddGameModal}
                        onChangeGameSort={handleChangeGameSort}
                        onChangeViewMode={handleChangeViewMode}
                        onCycleAButtonMode={handleCycleAButtonMode}
                        onPickOrSwap={handlePickOrSwap}
                        onReorderMove={handleReorderMove}
                        onEditNote={openNoteModal}
                        onOpenGameOverview={onOpenGameOverview}
                        onRemoveGame={onRemoveGame}
                    />
                )}
            </PanelSection>

            {!openSetResolving && showingSelector && (
                <SelectorView
                    sets={sets}
                    setsLoading={setsLoading}
                    selectorSort={selectorSort}
                    selectorFilter={selectorFilter}
                    language={language}
                    showIcons={showIcons}
                    uiSize={uiSize}
                    buttonOuterStyle={buttonOuterStyle}
                    dynamicLoading={dynamicTrackedSetsListLoading}
                    dynamicInitialRows={dynamicTrackedSetsListInitialRows}
                    dynamicRowStep={dynamicTrackedSetsListRowStep}
                    dynamicPrefetchDistance={dynamicTrackedSetsListPrefetchDistance}
                    dynamicSentinelRootMargin={dynamicTrackedSetsListSentinelRootMargin}
                    onOpenSet={onOpenSet}
                    onCycleSelectorSort={handleCycleSelectorSort}
                    onCycleSelectorFilter={handleCycleSelectorFilter}
                />
            )}
        </>
    );
}


type SelectorViewProps = {
    sets: TrackedSet[];
    setsLoading: boolean;
    selectorSort: TrackedSetSelectorSort;
    selectorFilter: TrackedSetFilter;
    language: LanguageCode;
    showIcons: boolean;
    uiSize: UiSize;
    buttonOuterStyle: React.CSSProperties;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    onOpenSet: (setId: string) => void | Promise<void>;
    onCycleSelectorSort: () => void;
    onCycleSelectorFilter: () => void;
};

function SelectorView(props: SelectorViewProps) {
    const {
        sets,
        setsLoading,
        selectorSort,
        selectorFilter,
        language,
        showIcons,
        uiSize,
        buttonOuterStyle,
        dynamicLoading,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        onOpenSet,
        onCycleSelectorSort,
        onCycleSelectorFilter
    } = props;

    const rowMosaicSize = achievementUiMetrics(uiSize).iconSize;

    const orderedSets = useMemo(() => {
        let list = [...sets];
        if (selectorFilter === "completed") {
            list = list.filter((set) => isSetCompleted(set));
        } else if (selectorFilter === "incomplete") {
            list = list.filter((set) => !isSetCompleted(set));
        }
        const byName = (a: TrackedSet, b: TrackedSet) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        if (selectorSort === "recent") {
            list.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
        } else if (selectorSort === "oldest") {
            list.sort((a, b) => (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0));
        } else if (selectorSort === "completionDesc") {
            list.sort((a, b) => {
                const diff = (weightedPercent(b) ?? -1) - (weightedPercent(a) ?? -1);
                return diff !== 0 ? diff : byName(a, b);
            });
        } else if (selectorSort === "completionAsc") {
            list.sort((a, b) => {
                const diff = (weightedPercent(a) ?? -1) - (weightedPercent(b) ?? -1);
                return diff !== 0 ? diff : byName(a, b);
            });
        } else if (selectorSort === "gameCountDesc") {
            list.sort((a, b) => {
                const diff = b.games.length - a.games.length;
                return diff !== 0 ? diff : byName(a, b);
            });
        } else if (selectorSort === "gameCountAsc") {
            list.sort((a, b) => {
                const diff = a.games.length - b.games.length;
                return diff !== 0 ? diff : byName(a, b);
            });
        } else {
            list.sort(byName);
        }
        return list;
    }, [sets, selectorSort, selectorFilter]);

    const setsDynamicLoading = dynamicLoading ?? true;
    const setsInitialRows = Math.max(1, dynamicInitialRows ?? 10);
    const setsRowStep = Math.max(1, dynamicRowStep ?? 10);
    const setsPrefetchDistance = Math.max(1, dynamicPrefetchDistance ?? 12);
    const setsSentinelRootMargin = `${Math.max(0, dynamicSentinelRootMargin ?? 600)}px 0px`;

    const {
        mountedItems: mountedSets,
        markerRef: loadMoreSetsMarkerRef,
        onItemFocus: handleSetFocus
    } = useWindowedList({
        items: orderedSets,
        dynamicLoading: setsDynamicLoading,
        initialRows: setsInitialRows,
        rowStep: setsRowStep,
        prefetchDistance: setsPrefetchDistance,
        sentinelRootMargin: setsSentinelRootMargin,
        resetKey: `${selectorSort}|${selectorFilter}`
    });

    const openSetRef = useRef(onOpenSet);
    openSetRef.current = onOpenSet;
    const rowFocusRef = useRef(handleSetFocus);
    rowFocusRef.current = handleSetFocus;

    const rowList = useMemo<TrackedSetRowListProps>(() => ({
        language,
        showIcons,
        mosaicSize: rowMosaicSize,
        buttonOuterStyle,
        onRowFocus: (index) => {
            rowFocusRef.current(index);
        },
        onOpenSet: (setId) => {
            void openSetRef.current(setId);
        }
    }), [language, showIcons, rowMosaicSize, buttonOuterStyle]);

    useEffect(function prefetchMountedMosaicIcons() {
        if (!showIcons || mountedSets.length === 0) {
            return;
        }
        const entries: SetMosaicEntry[] = [];
        for (const set of mountedSets) {
            for (const entry of mosaicEntriesForSet(set)) {
                entries.push(entry);
            }
        }
        void prefetchGameIcons(entries);
    }, [mountedSets, showIcons]);

    return (
        <>
            {(sets.length > 1 || selectorFilter !== "all") && (
                <PanelSection title={t(language, "View Options")}>
                    {sets.length > 1 && (
                        <LabeledRow
                            outerStyle={buttonOuterStyle}
                            focusKey="trackedsets:selectorsort"
                            onClick={onCycleSelectorSort}
                            label={t(language, "Sort")}
                            value={trackedSetSelectorSortLabel(selectorSort, language)}
                        />
                    )}
                    {
}
                    {(sets.length > 1 || selectorFilter !== "all") && (
                        <LabeledRow
                            outerStyle={buttonOuterStyle}
                            focusKey="trackedsets:selectorfilter"
                            onClick={onCycleSelectorFilter}
                            label={t(language, "Filter")}
                            value={trackedSetFilterLabel(selectorFilter, language)}
                        />
                    )}
                </PanelSection>
            )}

            {
}
            {sets.length === 0 && (
                <PanelSection>
                    {setsLoading ? (
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>{t(language, "Loading your goals...")}</div>
                        </PanelSectionRow>
                    ) : (
                        <>
                            <PanelSectionRow>
                                <div style={bodyTextStyle()}>
                                    {t(language, "No goals yet. Create your first goal to start grouping games.")}
                                </div>
                            </PanelSectionRow>
                            <BottomFocusAnchor focusKey="trackedsets:bottom:anchor" />
                        </>
                    )}
                </PanelSection>
            )}

            {
}
            {sets.length > 0 && (
                <PanelSection title={t(language, "Your Goals ({{count}})", { count: sets.length })}>
                    {!setsLoading && orderedSets.length === 0 && (
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                {t(language, "No goals match this filter.")}
                            </div>
                        </PanelSectionRow>
                    )}

                    {mountedSets.map((set, index) => (
                        <TrackedSetRow
                            key={`trackedset:${set.id}`}
                            set={set}
                            index={index}
                            list={rowList}
                        />
                    ))}

                    {setsDynamicLoading && mountedSets.length < orderedSets.length && (
                        <div ref={loadMoreSetsMarkerRef} style={{ height: "1px" }} />
                    )}
                </PanelSection>
            )}
        </>
    );
}


type TrackedSetRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    mosaicSize: number;
    buttonOuterStyle: React.CSSProperties;
    onRowFocus: (index: number) => void;
    onOpenSet: (setId: string) => void;
};

type TrackedSetRowProps = {
    set: TrackedSet;
    index: number;
    list: TrackedSetRowListProps;
};

const TrackedSetRow = React.memo(function TrackedSetRow(props: TrackedSetRowProps) {
    const { set, list } = props;
    const pct = weightedPercent(set);

    let sub: string;
    if (set.games.length === 0) {
        sub = gamesCountLabel(list.language, 0, 0);
    } else if (pct === null) {
        sub = gamesCountLabel(list.language, set.games.length);
    } else {
        sub = gamesCountLabel(list.language, set.games.length, pct);
    }

    const mosaicEntries = list.showIcons ? mosaicEntriesForSet(set) : [];

    function handleFocus() {
        list.onRowFocus(props.index);
    }

    function handleClick() {
        list.onOpenSet(set.id);
    }

    return (
        <FocusableItem
            outerStyle={list.buttonOuterStyle}
            focusKey={`trackedset:${set.id}`}
            onClick={handleClick}
            onFocus={handleFocus}
        >
            <SetMosaicBanner entries={mosaicEntries} mosaicSize={list.mosaicSize}>
                <span style={{ fontWeight: 800 }}>{set.name}</span>
                <span style={bodyTextStyle()}>{sub}</span>
            </SetMosaicBanner>
        </FocusableItem>
    );
});


type OpenSetViewProps = {
    set: TrackedSet;
    aButtonMode: TrackedSetAButtonMode;
    checkLoading: boolean;
    checkError: string | null;
    reorderTargetId: number | null;
    reorderViaSwap: boolean;
    language: LanguageCode;
    showIcons: boolean;
    uiSize: UiSize;
    buttonOuterStyle: React.CSSProperties;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    onClaimBack: () => void;
    onChangeGameFilter: (set: TrackedSet) => void;
    onRunCheck: () => void;
    onRename: (set: TrackedSet) => void;
    onRemove: (setId: string) => Promise<boolean>;
    onAddGame: (set: TrackedSet) => void;
    onChangeGameSort: (set: TrackedSet) => void;
    onChangeViewMode: (set: TrackedSet) => void;
    onCycleAButtonMode: (set: TrackedSet) => void;
    onPickOrSwap: (set: TrackedSet, gameId: number, allowSwap?: boolean) => void;
    onReorderMove: (set: TrackedSet, direction: ReorderDirection) => void;
    onEditNote: (set: TrackedSet, game: TrackedSetGame) => void;
    onOpenGameOverview: (gameId: number) => void;
    onRemoveGame: (setId: string, gameId: number) => Promise<boolean>;
};

type StripButtonKey = "addgame" | "check" | "rename" | "delete";

function FitText(props: { text: string; maxFontSize: number; minFontSize: number }) {
    const { text, maxFontSize, minFontSize } = props;
    const ref = useRef<HTMLSpanElement | null>(null);
    const [fontSize, setFontSize] = useState(maxFontSize);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        let size = maxFontSize;
        el.style.fontSize = `${size}px`;
        while (size > minFontSize && el.scrollWidth > el.clientWidth) {
            size -= 1;
            el.style.fontSize = `${size}px`;
        }
        setFontSize(size);
    }, [text, maxFontSize, minFontSize]);

    return (
        <span
            ref={ref}
            style={{
                display: "block",
                width: "100%",
                fontSize: `${fontSize}px`
            }}
        >
            {text}
        </span>
    );
}


function OpenSetView(props: OpenSetViewProps) {
    const {
        set,
        aButtonMode,
        checkLoading,
        checkError,
        reorderTargetId,
        reorderViaSwap,
        language,
        showIcons,
        uiSize,
        buttonOuterStyle,
        mouseKeyboardMode,
        controllerGlyphStyle,
        dynamicLoading,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        onClaimBack,
        onChangeGameFilter,
        onRunCheck,
        onRename,
        onRemove,
        onAddGame,
        onChangeGameSort,
        onChangeViewMode,
        onCycleAButtonMode,
        onPickOrSwap,
        onReorderMove,
        onEditNote,
        onOpenGameOverview,
        onRemoveGame
    } = props;

    const pct = weightedPercent(set);
    const filter = set.gameFilter;

    const reorderHonored = set.gameSort === "manual" && set.games.length >= 2;
    let effectiveAButtonMode: TrackedSetAButtonMode = aButtonMode;
    if (!mouseKeyboardMode) {
        effectiveAButtonMode = "info";
    }
    else if (aButtonMode === "reorder" && !reorderHonored) {
        effectiveAButtonMode = "editNote";
    }
    const reorderMode = effectiveAButtonMode === "reorder";

    const gamepadCardActions = !mouseKeyboardMode;

    const visibleGames = useMemo(() => {
        const ordered = orderGamesByField(set.games, set.gameSort, orderFieldForView(set.viewMode));
        if (filter === "completed") {
            return ordered.filter((g) => isGameDone(g));
        }
        if (filter === "incomplete") {
            return ordered.filter((g) => !isGameDone(g));
        }
        return ordered;
    }, [set, filter]);

    const visibleGroups = useMemo(() => {
        if (set.viewMode === "all") {
            return [] as ConsoleGroup[];
        }
        return groupGamesByConsole(visibleGames, set.viewMode, set.gameSort);
    }, [visibleGames, set.viewMode, set.gameSort]);

    const visualOrder = useMemo(() => {
        if (set.viewMode === "all") {
            return visibleGames;
        }
        const flat: TrackedSetGame[] = [];
        for (const group of visibleGroups) {
            for (const game of group.games) {
                flat.push(game);
            }
        }
        return flat;
    }, [set.viewMode, visibleGames, visibleGroups]);

    const flatIndexById = useMemo(() => {
        const map = new Map<number, number>();
        visualOrder.forEach((game, index) => {
            map.set(game.gameId, index);
        });
        return map;
    }, [visualOrder]);

    const largestReorderableGroup = useMemo(() => {
        if (set.viewMode === "all") {
            return set.games.length;
        }
        let largest = 0;
        for (const group of groupGamesByConsole(set.games, set.viewMode, set.gameSort)) {
            if (group.games.length > largest) {
                largest = group.games.length;
            }
        }
        return largest;
    }, [set.games, set.viewMode, set.gameSort]);
    const gamepadReorderAvailable = gamepadCardActions
        && set.gameSort === "manual"
        && largestReorderableGroup >= 2;

    const [consoleIcons, setConsoleIcons] = useState<Map<string, string>>(() => new Map());
    const consolesRequestedRef = useRef(false);

    useEffect(function loadConsoleIconsForGroupedViews() {
        if (set.viewMode === "all" || !showIcons || consolesRequestedRef.current) {
            return;
        }
        consolesRequestedRef.current = true;
        let cancelled = false;
        void getSetConsoleList()
            .then((res) => {
                if (cancelled || !res || !res.ok) {
                    return;
                }
                const next = new Map<string, string>();
                for (const item of res.consoles as TrackedSetConsole[]) {
                    if (item.iconUrl) {
                        next.set(item.name.trim().toLowerCase(), item.iconUrl);
                    }
                }
                setConsoleIcons(next);
            })
            .catch(() => {
                consolesRequestedRef.current = false;
            });
        return () => {
            cancelled = true;
        };
    }, [set.viewMode, showIcons]);

    function consoleIconFor(name: string): string {
        return consoleIcons.get(name.trim().toLowerCase()) ?? "";
    }

    const [deleteArmed, setDeleteArmed] = useState(false);

    const [focusedStripKey, setFocusedStripKey] = useState<StripButtonKey | null>(null);

    const [armedTrashGameId, setArmedTrashGameId] = useState<number | null>(null);

    const [cardClaim, setCardClaim] = useState<{ slotIndex: number; token: number } | null>(null);

    const [reorderNudgeSeq, setReorderNudgeSeq] = useState(0);

    const listRef = useRef<HTMLDivElement | null>(null);

    const {
        mountedItems: warmBand,
        markerRef: warmBandMarkerRef,
        onItemFocus: warmMoreFromFocus
    } = useWindowedList({
        items: visualOrder,
        dynamicLoading,
        initialRows: Math.max(1, dynamicInitialRows ?? 10),
        rowStep: Math.max(1, dynamicRowStep ?? 10),
        prefetchDistance: Math.max(1, dynamicPrefetchDistance ?? 12),
        sentinelRootMargin: `${Math.max(0, dynamicSentinelRootMargin ?? 600)}px 0px`,
        resetKey: `${set.id}|${set.viewMode}|${set.gameSort}|${filter}`
    });

    useEffect(function prefetchSetIcons() {
        if (!showIcons || warmBand.length === 0) {
            return;
        }
        void prefetchGameIcons(
            warmBand.map((game) => ({ gameId: game.gameId, imageIcon: game.imageIcon }))
        );
    }, [warmBand, showIcons]);

    useEffect(() => {
        logFocusDebug(
            "trackedset-cards",
            `set:${set.id}`,
            `visible=${visibleGames.length} total=${set.games.length}`
        );
    }, [set.id, visibleGames.length, set.games.length]);

    useEffect(function scrollReorderTargetIntoView() {
        if (reorderTargetId == null || reorderViaSwap) {
            return;
        }
        const root = listRef.current;
        if (!root) {
            return;
        }
        const row = root.querySelector(
            `[data-focus-key="trackedsetgame:${reorderTargetId}"]`
        ) as HTMLElement | null;
        if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, [reorderNudgeSeq, reorderTargetId, reorderViaSwap]);

    function handleDeletePress() {
        if (deleteArmed) {
            setDeleteArmed(false);
            void onRemove(set.id);
            return;
        }
        setDeleteArmed(true);
    }

    function handleTrashBlur(gameId: number) {
        setArmedTrashGameId((armed) => (armed === gameId ? null : armed));
    }

    function deleteFocusPlan(gameId: number): DeleteFocusPlan {
        const removedIndex = visualOrder.findIndex((game) => game.gameId === gameId);
        const remaining = visualOrder.filter((game) => game.gameId !== gameId);
        if (remaining.length === 0) {
            return { kind: "back" };
        }
        return { kind: "claim", slotIndex: Math.min(Math.max(removedIndex, 0), remaining.length - 1) };
    }

    async function handleTrashPress(gameId: number) {
        if (armedTrashGameId !== gameId) {
            setArmedTrashGameId(gameId);
            return;
        }
        setArmedTrashGameId(null);
        const plan = deleteFocusPlan(gameId);
        const removed = await onRemoveGame(set.id, gameId);
        if (!removed) {
            return;
        }
        if (plan.kind === "back") {
            onClaimBack();
            return;
        }
        window.setTimeout(() => {
            setCardClaim((current) => ({ slotIndex: plan.slotIndex, token: (current?.token ?? 0) + 1 }));
        }, 0);
    }

    function handleCardReorderNudge(direction: ReorderDirection) {
        setReorderNudgeSeq((seq) => seq + 1);
        onReorderMove(set, direction);
    }

    function renderStripButton(key: StripButtonKey, label: string, onClick: () => void, disabled: boolean) {
        const focused = focusedStripKey === key;
        return (
            <div
                style={{ display: "flex", flex: 1, minWidth: 0 }}
            >
                <DialogButton
                    onClick={onClick}
                    onGamepadFocus={() => setFocusedStripKey(key)}
                    onGamepadBlur={() => {
                        setFocusedStripKey((current) => (current === key ? null : current));
                        if (key === "delete") {
                            setDeleteArmed(false);
                        }
                    }}
                    disabled={disabled}
                    style={{
                        minWidth: 0,
                        width: "100%",
                        padding: "8px 4px",
                        fontWeight: 700,
                        textAlign: "center",
                        opacity: disabled ? 0.5 : focused ? 1 : 0.82,
                        boxShadow: focused
                            ? "0 0 0 2px rgba(120, 200, 255, 0.85), 0 2px 8px rgba(0,0,0,0.35)"
                            : undefined
                    }}
                >
                    <FitText text={label} maxFontSize={12} minFontSize={9} />
                </DialogButton>
            </div>
        );
    }

    const openSetSetRef = useRef(set);
    openSetSetRef.current = set;
    const pickOrSwapRef = useRef(onPickOrSwap);
    pickOrSwapRef.current = onPickOrSwap;
    const editNoteRef = useRef(onEditNote);
    editNoteRef.current = onEditNote;
    const openOverviewRef = useRef(onOpenGameOverview);
    openOverviewRef.current = onOpenGameOverview;
    const trashPressRef = useRef(handleTrashPress);
    trashPressRef.current = handleTrashPress;
    const trashBlurRef = useRef(handleTrashBlur);
    trashBlurRef.current = handleTrashBlur;
    const reorderNudgeRef = useRef(handleCardReorderNudge);
    reorderNudgeRef.current = handleCardReorderNudge;
    const warmFocusRef = useRef(warmMoreFromFocus);
    warmFocusRef.current = warmMoreFromFocus;

    const cardList = useMemo<GameCardListProps>(() => ({
        aButtonMode: effectiveAButtonMode,
        reorderMode,
        language,
        showIcons,
        metrics: achievementUiMetrics(uiSize),
        buttonOuterStyle,
        onPickOrSwap: (gameId) => {
            pickOrSwapRef.current(openSetSetRef.current, gameId);
        },
        onEditNote: (game) => {
            editNoteRef.current(openSetSetRef.current, game);
        },
        onOpenGameOverview: (gameId) => {
            openOverviewRef.current(gameId);
        },
        onTrashPress: (gameId) => {
            void trashPressRef.current(gameId);
        },
        onTrashBlur: (gameId) => {
            trashBlurRef.current(gameId);
        },
        onCardFocus: (slotIndex) => {
            warmFocusRef.current(slotIndex);
        },
        onCardNote: gamepadCardActions
            ? (game: TrackedSetGame) => {
                editNoteRef.current(openSetSetRef.current, game);
            }
            : undefined,
        onCardReorderPick: gamepadReorderAvailable
            ? (gameId: number) => {
                pickOrSwapRef.current(openSetSetRef.current, gameId, false);
            }
            : undefined,
        onCardReorderNudge: gamepadReorderAvailable
            ? (direction: ReorderDirection) => {
                reorderNudgeRef.current(direction);
            }
            : undefined
    }), [
        effectiveAButtonMode,
        reorderMode,
        language,
        showIcons,
        uiSize,
        buttonOuterStyle,
        gamepadCardActions,
        gamepadReorderAvailable
    ]);

    function renderCard(game: TrackedSetGame, slotIndex: number) {
        return (
            <GameCard
                key={`trackedsetslot:${slotIndex}`}
                game={game}
                done={isGameDone(game)}
                slotIndex={slotIndex}
                isReorderTarget={reorderTargetId === game.gameId}
                trashArmed={armedTrashGameId === game.gameId}
                claimToken={cardClaim?.slotIndex === slotIndex ? cardClaim.token : 0}
                list={cardList}
            />
        );
    }

    return (
        <>
            <PanelSectionRow>
                <div style={{ padding: "4px 0", width: "100%" }}>
                    <SetMosaicBanner
                        entries={showIcons ? mosaicEntriesForSet(set) : []}
                        mosaicSize={achievementUiMetrics(uiSize).iconSize + 12}
                    >
                        <span style={{ fontWeight: 800, fontSize: "17px" }}>{set.name}</span>
                        <span style={bodyTextStyle()}>
                            {gamesCountLabel(language, set.games.length)}
                        </span>
                        {pct !== null && (
                            <span style={bodyTextStyle()}>{t(language, "{{pct}}% complete", { pct })}</span>
                        )}
                    </SetMosaicBanner>
                </div>
            </PanelSectionRow>

            <PanelSectionRow>
                <div
                    style={{ width: "100%", padding: "10px 0 0 0" }}
                >
                    <Focusable
                        flow-children="row"
                        style={{ display: "flex", gap: "6px", width: "100%" }}
                    >
                        {renderStripButton("addgame", t(language, "Add Game"), () => onAddGame(set), false)}
                        {renderStripButton(
                            "check",
                            checkLoading ? t(language, "Checking...") : t(language, "Check"),
                            onRunCheck,
                            checkLoading
                        )}
                        {renderStripButton("rename", t(language, "Rename Goal"), () => onRename(set), false)}
                        {renderStripButton(
                            "delete",
                            deleteArmed ? t(language, "Confirm?") : t(language, "Delete Goal"),
                            handleDeletePress,
                            false
                        )}
                    </Focusable>
                </div>
            </PanelSectionRow>

            {checkError && (
                <PanelSectionRow>
                    <ErrorText>{localizeRuntimeText(language, checkError)}</ErrorText>
                </PanelSectionRow>
            )}

            {
}
            <LabeledRow
                outerStyle={buttonOuterStyle}
                focusKey="trackedset:open:viewmode"
                onClick={() => onChangeViewMode(set)}
                label={t(language, "View")}
                value={trackedSetViewModeLabel(set.viewMode, language)}
            />
            <LabeledRow
                outerStyle={buttonOuterStyle}
                focusKey="trackedset:open:gamesort"
                onClick={() => onChangeGameSort(set)}
                label={t(language, "Sort")}
                value={trackedSetGameSortLabel(set.gameSort, language)}
            />
            <LabeledRow
                outerStyle={buttonOuterStyle}
                focusKey="trackedset:open:filter"
                onClick={() => onChangeGameFilter(set)}
                label={t(language, "Filter")}
                value={trackedSetFilterLabel(filter, language)}
                bottomSeparator={gamepadCardActions ? "none" : "standard"}
            />
            {mouseKeyboardMode && (
                <LabeledRow
                    outerStyle={buttonOuterStyle}
                    focusKey="trackedset:open:abutton"
                    onClick={() => onCycleAButtonMode(set)}
                    label={t(language, "Click")}
                    value={trackedSetAButtonModeLabel(effectiveAButtonMode, language)}
                />
            )}

            {
}
            {gamepadCardActions && (
                <PanelSectionRow>
                    <ButtonHints
                        style={controllerGlyphStyle}
                        hints={[
                            { button: "a", label: t(language, "View Info") },
                            { button: "y", label: t(language, "Note") },
                            ...(gamepadReorderAvailable
                                ? [{ button: "r1" as const, label: t(language, "Reorder") }]
                                : [])
                        ]}
                    />
                </PanelSectionRow>
            )}

            {
}
            {reorderMode && (
                <ReorderStrip
                    targetId={reorderTargetId}
                    onMove={(direction) => {
                        setReorderNudgeSeq((seq) => seq + 1);
                        onReorderMove(set, direction);
                    }}
                    focusKeyPrefix="trackedset"
                />
            )}

            {set.games.length === 0 && (
                <>
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, "No games in this goal yet. Add one to get started.")}
                        </div>
                    </PanelSectionRow>
                    <BottomFocusAnchor focusKey="trackedsetopen:bottom:anchor" />
                </>
            )}

            {set.games.length > 0 && visibleGames.length === 0 && (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {t(language, "No games match this filter.")}
                    </div>
                </PanelSectionRow>
            )}

            <div ref={listRef}>
                {set.viewMode === "all"
                    ? visibleGames.map((game, index) => renderCard(game, index))
                    : visibleGroups.map((group) => (
                        <Fragment key={`trackedsetgroup:${group.consoleName}`}>
                            <SystemHeader
                                viewMode={set.viewMode}
                                consoleName={group.consoleName}
                                count={group.games.length}
                                iconUrl={consoleIconFor(group.consoleName)}
                                language={language}
                                showIcons={showIcons}
                                metrics={cardList.metrics}
                            />
                            {group.games.map((game) =>
                                renderCard(game, flatIndexById.get(game.gameId) ?? 0)
                            )}
                        </Fragment>
                    ))}
                {
}
                {warmBand.length < visualOrder.length && (
                    <div ref={warmBandMarkerRef} style={{ width: "100%", height: "1px" }} />
                )}
            </div>
        </>
    );
}


type GameCardListProps = {
    aButtonMode: TrackedSetAButtonMode;
    reorderMode: boolean;
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    buttonOuterStyle: React.CSSProperties;
    onPickOrSwap: (gameId: number) => void;
    onEditNote: (game: TrackedSetGame) => void;
    onOpenGameOverview: (gameId: number) => void;
    onTrashPress: (gameId: number) => void;
    onTrashBlur: (gameId: number) => void;
    onCardFocus: (slotIndex: number) => void;
    onCardNote?: (game: TrackedSetGame) => void;
    onCardReorderPick?: (gameId: number) => void;
    onCardReorderNudge?: (direction: ReorderDirection) => void;
};

type GameCardProps = {
    game: TrackedSetGame;
    done: boolean;
    slotIndex: number;
    isReorderTarget: boolean;
    trashArmed: boolean;
    claimToken: number;
    list: GameCardListProps;
};

const GameCard = React.memo(function GameCard(props: GameCardProps) {
    const { game, done, slotIndex, isReorderTarget, trashArmed, claimToken, list } = props;
    const { aButtonMode, reorderMode, language, showIcons, metrics, buttonOuterStyle } = list;

    const { iconDataUri, cold } = useGameIcon(game.gameId, game.imageIcon ?? null, "getGameIconCached (tracked set card)");

    const fallbackLetter = game.title.trim().charAt(0).toUpperCase() || "?";
    const noteColor = noteBodyColor(game.color);

    function handleCardClick() {
        if (reorderMode) {
            list.onPickOrSwap(game.gameId);
            return;
        }
        if (aButtonMode === "info") {
            list.onOpenGameOverview(game.gameId);
            return;
        }
        list.onEditNote(game);
    }

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;

        if (button === BUTTON_OPTIONS && list.onCardNote) {
            playOkSound();
            list.onCardNote(game);
            return;
        }

        if (button === BUTTON_BUMPER_RIGHT && list.onCardReorderPick) {
            playOkSound();
            list.onCardReorderPick(game.gameId);
            return;
        }

        if (isReorderTarget && list.onCardReorderNudge) {
            if (button === BUTTON_DIR_UP) {
                list.onCardReorderNudge("up");
            }
            else if (button === BUTTON_DIR_DOWN) {
                list.onCardReorderNudge("down");
            }
        }
    }

    const progressText = game.numAwarded !== null && game.maxPossible !== null
        ? t(language, "{{awarded}} / {{total}}", { awarded: game.numAwarded, total: game.maxPossible })
        : null;

    function awardLabel(award: TrackedSetAward | null): string {
        if (award === "mastered") {
            return t(language, "Mastered");
        }
        if (award === "completed") {
            return t(language, "Completed");
        }
        if (award === "beaten-hardcore") {
            return t(language, "Beaten Hardcore");
        }
        if (award === "beaten-softcore") {
            return t(language, "Beaten Softcore");
        }
        return t(language, "Unfinished");
    }

    const progressLine = progressText !== null
        ? `${progressText} · ${awardLabel(game.highestAward)}`
        : null;

    function handleTrashPress() {
        list.onTrashPress(game.gameId);
    }

    const [trashFocused, setTrashFocused] = useState(false);

    function handleTrashFocus() {
        setTrashFocused(true);
    }

    function handleTrashBlur() {
        setTrashFocused(false);
        list.onTrashBlur(game.gameId);
    }

    const card = (
        <Focusable
            flow-children="row"
            style={{ position: "relative", display: "flex", alignItems: "stretch", width: "100%" }}
        >
            <FocusableItem
                outerStyle={{
                    ...buttonOuterStyle,
                    width: "100%",
                    minWidth: 0,
                    outline: isReorderTarget ? `2px solid ${achievementGreen}` : undefined,
                    borderRadius: isReorderTarget ? "6px" : undefined
                }}
                focusKey={`trackedsetgame:${game.gameId}`}
                onClick={handleCardClick}
                onGamepadFocus={() => list.onCardFocus(slotIndex)}
                onButtonDown={handleButtonDown}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                        alignItems: "flex-start",
                        minWidth: 0,
                        opacity: done ? 0.55 : 1
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
                            textAlign: "left",
                            paddingRight: "24px"
                        }}
                    >
                        <div
                            style={{
                                fontSize: `${metrics.titleFontSize}px`,
                                lineHeight: metrics.titleLineHeight,
                                fontWeight: 700,
                                minWidth: 0,
                                wordBreak: "break-word",
                                textDecoration: done ? "line-through" : undefined
                            }}
                        >
                            {game.title}
                        </div>
                        {game.note.trim() && (
                            <div
                                style={{
                                    fontSize: `${metrics.bodyFontSize}px`,
                                    lineHeight: metrics.bodyLineHeight,
                                    minWidth: 0,
                                    wordBreak: "break-word",
                                    color: noteColor
                                }}
                            >
                                {game.note}
                            </div>
                        )}
                        {
}
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
                        {progressLine && (
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.pointsFontSize}px`,
                                    lineHeight: metrics.pointsLineHeight,
                                    opacity: 1,
                                    minWidth: 0
                                }}
                            >
                                {progressLine}
                            </div>
                        )}
                    </div>
                </div>
            </FocusableItem>

            <div
                data-focus-key={`trackedsetgame:trash:${game.gameId}`}
                style={{
                    position: "absolute",
                    top: "17px",
                    right: "8px",
                    zIndex: 2,
                    width: "32px",
                    height: "32px",
                    display: "flex"
                }}
            >
                <DialogButton
                    onClick={handleTrashPress}
                    onGamepadFocus={handleTrashFocus}
                    onGamepadBlur={handleTrashBlur}
                    style={{
                        minWidth: 0,
                        width: "32px",
                        height: "32px",
                        padding: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: trashArmed
                            ? "rgba(255,255,255,0.98)"
                            : trashFocused
                                ? "rgba(24,24,24,0.98)"
                                : "rgba(255,255,255,0.92)",
                        background: trashArmed
                            ? "rgba(220,38,38,0.92)"
                            : trashFocused
                                ? "rgba(255,255,255,0.96)"
                                : "rgba(24,24,24,0.78)",
                        border: trashArmed
                            ? "1px solid rgba(255,255,255,0.9)"
                            : trashFocused
                                ? "1px solid rgba(255,255,255,1)"
                                : "1px solid rgba(255,255,255,0.36)",
                        boxShadow: trashFocused
                            ? "0 0 0 2px rgba(255,255,255,0.78), 0 2px 8px rgba(0,0,0,0.45)"
                            : trashArmed
                                ? "0 0 0 2px rgba(220,38,38,0.65), 0 2px 8px rgba(0,0,0,0.45)"
                                : "0 2px 6px rgba(0,0,0,0.35)",
                        transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease"
                    }}
                >
                    <TrashIcon size={15} />
                </DialogButton>
            </div>
        </Focusable>
    );

    if (claimToken <= 0) {
        return card;
    }

    return (
        <Focusable key={`claim:${claimToken}`} autoFocus>
            {card}
        </Focusable>
    );
});


type NameSetModalProps = {
    title: string;
    initialName: string;
    language: LanguageCode;
    onSubmit: (name: string) => Promise<boolean>;
    close: () => void;
};

function NameSetModal(props: NameSetModalProps) {
    const { title, initialName, language, onSubmit, close } = props;
    const [name, setName] = useState(initialName);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const trimmed = name.trim();
    const canSave = trimmed.length > 0 && !saving;

    async function handleSave() {
        if (!canSave) {
            return;
        }
        setSaving(true);
        setError(null);
        const ok = await onSubmit(trimmed);
        if (ok) {
            close();
            return;
        }
        setSaving(false);
        setError(t(language, "Couldn't save. Try a different name."));
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={canSave}
                label={t(language, "Save")}
                onSave={handleSave}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {title}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ fontSize: `${modalSize(13)}px`, fontWeight: 700, opacity: 0.7 }}>
                        {t(language, "Goal name:")}
                    </div>
                    <TextField
                        value={name}
                        onChange={(e: any) => setName(e?.target?.value ?? "")}
                        disabled={saving}
                    />
                    {error && <ErrorText>{localizeRuntimeText(language, error)}</ErrorText>}
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
                    <DialogButton onClick={handleSave} disabled={!canSave}>
                        {saving ? t(language, "Saving...") : t(language, "Save")}
                    </DialogButton>
                    <DialogButton onClick={close} disabled={saving}>
                        {t(language, "Cancel")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

export default TrackedSetsPage;
