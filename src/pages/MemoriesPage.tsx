import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
// Font Awesome Free icon, CC BY 4.0. See ATTRIBUTIONS.md.
import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { PageHelpButton, PageNavStrip } from "../components/ui/PageNavStrip";
import { SectionTitle } from "../components/ui/SectionTitle";
import { LabeledRow } from "../components/ui/LabeledRow";
import { FadeImage } from "../components/ui/FadeImage";
import { useResilientGameIcon } from "../hooks/useResilientGameIcon";
import { ButtonHints } from "../components/ui/ButtonHints";
import { ToggleRow } from "../components/ui/ToggleRow";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { FocusClaim } from "../components/ui/FocusClaim";
import { FocusTarget } from "../components/ui/FocusTarget";
import { GridIcon } from "../components/ui/GridIcon";
import { UsersIcon } from "../components/ui/UsersIcon";
import { openSharedMemories } from "../components/browser/discordShare";
import { ArrowDownWideShortIcon, ArrowUpShortWideIcon } from "../components/ui/SortOrderIcons";
import { MemoryCard, type MemoryCardListProps } from "../components/memories/MemoryCard";
import { MemoryGamePickerModal } from "../components/memories/MemoryGamePickerModal";
import { MemoryTagFilterModal } from "../components/memories/MemoryTagFilterModal";
import { MemoryViewerModal } from "../components/memories/MemoryViewerModal";
import { MemoryEditorModal } from "../components/memories/MemoryEditorModal";
import { MemoryMoveModal } from "../components/memories/MemoryMoveModal";
import { MemoryShareModal } from "../components/memories/MemoryShareModal";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { showManagedModal } from "../utils/modalRegistry";
import { requestJumpToTop } from "../utils/jumpToTop";
import { saveMemoryToFolder } from "../utils/saveMemoryMedia";
import { forgetNavAxisMemory, type NavAxisRef } from "../utils/navAxisMemory";
import { playOkSound } from "../utils/navSound";
import { ALL_GAMES_ID, MISC_GAME_ID, mediaFilterKey, memoryRemovalLanding } from "../utils/memories";
import { noteBodyColor } from "../utils/achievements";
import { bodyTextStyle, regularButtonSpacingStyle, smallTextStyle } from "../utils/style";
import { textSize } from "../utils/scale";
import { BUTTON_SECONDARY, BUTTON_OPTIONS, BUTTON_BUMPER_LEFT, BUTTON_BUMPER_RIGHT, BUTTON_TRIGGER_RIGHT } from "../utils/gamepadButtons";
import { t, type LanguageCode } from "../locales";
import type { MemoriesControllerActions, MemoriesControllerState } from "../hooks/useMemoriesController";
import type { ButtonSpacing, ControllerGlyphStyle, NoteColor, ViewKey } from "../types";
import { overrideRecord, topEntryId, usePageLanding } from "../focusRecords";
import { skipWhileHidden } from "../components/panel/skipWhileHidden";

function MemoryGameValue(props: { gameId: number | null; label: string; imageIcon: string; showIcons: boolean }) {
    const { gameId, label, imageIcon, showIcons } = props;
    const realGame = gameId !== null && gameId !== ALL_GAMES_ID && gameId !== MISC_GAME_ID;
    const { iconDataUri } = useResilientGameIcon(
        realGame && showIcons ? gameId : null,
        imageIcon || null,
        "MemoryGameValue getGameIconCached"
    );

    if (!iconDataUri && !(realGame && showIcons)) {
        return <>{label}</>;
    }
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <span
                style={{
                    width: `${textSize(22)}px`,
                    height: `${textSize(22)}px`,
                    borderRadius: "5px",
                    overflow: "hidden",
                    flexShrink: 0,
                    display: "inline-flex"
                }}
            >
                {iconDataUri && (
                    <FadeImage
                        src={iconDataUri}
                        fadeOnLoad={false}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                )}
            </span>
            <span
                style={{
                    minWidth: 0,
                    whiteSpace: "normal",
                    overflowWrap: "break-word",
                    wordBreak: "break-word",
                    textAlign: "left"
                }}
            >
                {label}
            </span>
        </span>
    );
}

function PageArrowIcon(props: { size: number; back: boolean }) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={props.size}
            height={props.size}
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                d={props.back ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
            />
        </svg>
    );
}

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const BOTTOM_HEADROOM_PX = 80;

const GRID_COLUMN_CHOICES = [1, 2, 3];

type PageStripPlace = "top" | "bottom";

const NAV_ENTER_FIRST = 0;

let lastGameRow: { ulid: string; gameId: number | null; label: string; imageIcon: string } | null = null;

let lastList: { ulid: string; gameId: number | null; pageIndex: number; totalPages: number; empty: boolean } | null = null;

type MemoriesPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    glyphStyle: ControllerGlyphStyle;
    mouseKeyboardMode: boolean;
    showIcons: boolean;
    showRetroPoints: boolean;
    autoCapture: boolean;
    activeUlid: string;
    memories: MemoriesControllerState;
};

type MemoriesPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onRequestFocus: (focusKey: string) => void;
    onEnableCapture: (value: boolean) => void | Promise<unknown>;
    memories: MemoriesControllerActions;
};

type MemoriesPageProps = {
    state: MemoriesPageState;
    actions: MemoriesPageActions;
};

function MemoriesPage(props: MemoriesPageProps) {
    const { state, actions } = props;
    const {
        view,
        language,
        buttonSpacing,
        glyphStyle,
        mouseKeyboardMode,
        showIcons,
        showRetroPoints,
        autoCapture,
        activeUlid,
        memories
    } = state;
    const gameKnown = memories.ready && memories.indexLoaded;
    usePageLanding({
        view: "memories",
        active: view === "memories",
        subject: memories.gameId,
        subjectSettled: gameKnown,
        defaultKey: "memories:back",
        ready: gameKnown && memories.loadedForGameId === memories.gameId && !memories.loading
    });

    const rowClaim = useFocusClaim();
    const [backClaimToken, setBackClaimToken] = useState(0);
    const [focusedToggleKey, setFocusedToggleKey] = useState<string | null>(null);

    const active = view === "memories";

    const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language, {
        day: "numeric",
        month: "numeric",
        year: "numeric"
    }), [language]);

    const openViewerRef = useRef<(memoryId: string) => void>(() => { });

    const gridNavRef = useRef(null) as NavAxisRef;

    const cardList = useMemo<MemoryCardListProps>(() => ({
        columns: memories.gridColumns,
        dateFormatter,
        onFocused: (memoryId: string) => {
            // Clears the column Steam imported from the toolbar above; see utils/navAxisMemory.
            forgetNavAxisMemory(gridNavRef);
            actions.memories.setFocusedMemoryId(memoryId);
        },
        onBlurred: actions.memories.blurMemory,
        onOpen: (memoryId: string) => {
            openViewerRef.current(memoryId);
        }
    }), [
        memories.gridColumns,
        dateFormatter,
        actions.memories.setFocusedMemoryId,
        actions.memories.blurMemory
    ]);

    const firstRun = memories.ready
        && memories.indexLoaded
        && !autoCapture
        && memories.indexedGameCount === 0;

    const sawFirstRunRef = useRef(false);
    useEffect(function landAfterFirstRun() {
        if (!active) {
            sawFirstRunRef.current = false;
            return;
        }
        if (firstRun) {
            sawFirstRunRef.current = true;
            return;
        }
        if (!sawFirstRunRef.current) {
            return;
        }
        sawFirstRunRef.current = false;
        requestJumpToTop();
        actions.onRequestFocus("memories:back");
    }, [active, firstRun, actions.onRequestFocus]);

    if (!active) {
        return null;
    }

    function gameRowFor(gameId: number | null) {
        const game = memories.games.find((row) => row.gameId === gameId) ?? null;
        let label = t(language, "All Games");
        if (gameId !== ALL_GAMES_ID && game !== null) {
            label = game.gameId === MISC_GAME_ID
                ? t(language, "Uncategorized")
                : (game.gameTitle || t(language, "Unknown game"));
        }
        return { ulid: activeUlid, gameId, label, imageIcon: game?.imageIcon || "" };
    }

    let gameRow = { ulid: activeUlid, gameId: memories.gameId, label: "", imageIcon: "" };
    if (memories.ready && memories.indexLoaded) {
        gameRow = gameRowFor(memories.gameId);
        lastGameRow = gameRow;
    }
    else if (lastGameRow?.ulid === activeUlid) {
        gameRow = lastGameRow;
    }

    const listPending = !memories.ready
        || !memories.indexLoaded
        || memories.loadedForGameId !== memories.gameId;
    let list = {
        ulid: activeUlid,
        gameId: memories.gameId,
        pageIndex: memories.pageIndex,
        totalPages: memories.totalPages,
        empty: memories.pageMemories.length === 0
    };
    if (!listPending) {
        lastList = list;
    }
    else if (lastList?.ulid === activeUlid && lastList.gameId === gameRow.gameId) {
        list = lastList;
    }

    const filterRuleColor = memories.colorFilter
        ? (noteBodyColor(memories.colorFilter as NoteColor) ?? "rgba(255, 255, 255, 0.45)")
        : undefined;

    const mediaKey = mediaFilterKey(memories.mediaFilter);
    const filterParts = [memories.tagFilter, mediaKey ? t(language, mediaKey) : ""];
    let filterValue = "";
    if (memories.ready) {
        filterValue = filterParts.filter(Boolean).join(" \u00b7 ")
            || t(language, memories.colorFilter ? "Filtered" : "All");
    }

    function openGamePicker() {
        const entryId = topEntryId();
        showManagedModal((close) => (
            <MemoryGamePickerModal
                games={memories.games}
                selected={memories.gameId}
                language={language}
                showIcons={showIcons}
                onSelect={(gameId) => {
                    lastGameRow = gameRowFor(gameId);
                    actions.memories.selectGame(gameId);
                    overrideRecord(entryId, { focusKey: "memories:game", subject: String(gameId) });
                }}
                close={close}
            />
        ));
    }

    function openTagFilter() {
        showManagedModal((close) => (
            <MemoryTagFilterModal
                tags={memories.tags}
                selected={memories.tagFilter}
                selectedColor={memories.colorFilter}
                selectedMedia={memories.mediaFilter}
                sort={memories.tagSort}
                language={language}
                onSelect={actions.memories.selectTag}
                onSelectColor={actions.memories.selectColor}
                onSelectMedia={actions.memories.selectMedia}
                onChangeSort={actions.memories.selectTagSort}
                onClearFilters={actions.memories.clearFilters}
                close={close}
            />
        ));
    }

    openViewerRef.current = openViewer;

    function openViewer(memoryId: string) {
        const memory = memories.pageMemories.find((row) => row.id === memoryId);
        if (!memory) {
            return;
        }
        showManagedModal((close) => (
            <MemoryViewerModal
                memory={memory}
                gameId={memory.gameId}
                thumbDataUri={memories.thumbs[memory.path] ?? null}
                language={language}
                mouseKeyboardMode={mouseKeyboardMode}
                showRetroPoints={showRetroPoints}
                allTags={memories.allTags}
                close={close}
            />
        ));
    }

    function openEditor(memoryId: string) {
        const memory = memories.pageMemories.find((row) => row.id === memoryId);
        if (!memory) {
            return;
        }
        showManagedModal((close) => (
            <MemoryEditorModal
                memory={memory}
                gameId={memory.gameId}
                language={language}
                allTags={memories.allTags}
                close={close}
            />
        ));
    }

    function handlePageButtonDown(evt: { detail?: { button?: number } }) {
        const focused = memories.focusedMemoryId;
        if (!focused) {
            return;
        }
        if (evt?.detail?.button === BUTTON_SECONDARY) {
            if (memories.armedDeleteId !== focused) {
                actions.memories.armDelete(focused);
                return;
            }
            playOkSound();
            handleDelete(focused);
            return;
        }
        if (evt?.detail?.button === BUTTON_OPTIONS) {
            playOkSound();
            openEditor(focused);
            return;
        }
        if (evt?.detail?.button === BUTTON_BUMPER_LEFT) {
            playOkSound();
            openMove(focused);
            return;
        }
        if (evt?.detail?.button === BUTTON_BUMPER_RIGHT) {
            playOkSound();
            saveMedia(focused);
            return;
        }
        if (evt?.detail?.button === BUTTON_TRIGGER_RIGHT) {
            playOkSound();
            openShare(focused);
        }
    }

    function openShare(memoryId: string) {
        const memory = memories.pageMemories.find((row) => row.id === memoryId);
        if (!memory) {
            return;
        }
        showManagedModal((close) => (
            <MemoryShareModal
                memory={memory}
                gameId={memory.gameId}
                language={language}
                thumbDataUri={memories.thumbs[memory.path] ?? null}
                mouseKeyboardMode={mouseKeyboardMode}
                close={close}
            />
        ));
    }

    function openMove(memoryId: string) {
        const memory = memories.pageMemories.find((row) => row.id === memoryId);
        if (!memory) {
            return;
        }
        showManagedModal((close) => (
            <MemoryMoveModal
                memory={memory}
                gameId={memory.gameId}
                games={memories.games}
                loadedGameId={memories.loadedGameId}
                language={language}
                showIcons={showIcons}
                close={close}
            />
        ));
    }

    function saveMedia(memoryId: string) {
        const memory = memories.pageMemories.find((row) => row.id === memoryId);
        if (!memory) {
            return;
        }
        void saveMemoryToFolder(memory.gameId, memoryId, language);
    }

    function handleDelete(memoryId: string) {
        const wasLastOnPage = memories.pageMemories.length === 1;
        const wasLastPage = memories.pageIndex === memories.totalPages - 1;
        const fallbackId = wasLastOnPage && wasLastPage && memories.pageIndex > 0
            ? actions.memories.lastIdOnPage(memories.pageIndex - 1)
            : null;

        const landingId = memoryRemovalLanding(memories.pageMemories, memoryId);
        const landingSlot = landingId === null
            ? -1
            : memories.pageMemories
                .filter((memory) => memory.id !== memoryId)
                .findIndex((memory) => memory.id === landingId);

        void actions.memories.removeMemory(memoryId);
        if (!wasLastOnPage || !wasLastPage) {
            if (landingId !== null && landingSlot >= 0) {
                rowClaim.claimSlot(landingSlot);
                actions.onRequestFocus(`memories:tile:${landingId}`);
            }
            return;
        }
        if (fallbackId) {
            actions.memories.turnPage(-1);
            rowClaim.claimSlot(memories.perPage - 1);
            actions.onRequestFocus(`memories:tile:${fallbackId}`);
            return;
        }
        setBackClaimToken((current) => current + 1);
        actions.onRequestFocus("memories:back");
    }

    function turnPage(delta: number, place: PageStripPlace) {
        const nextIndex = memories.pageIndex + delta;
        if (nextIndex < 0 || nextIndex >= memories.totalPages) {
            return;
        }
        playOkSound();
        actions.memories.turnPage(delta);
        if (place === "bottom") {
            actions.onRequestFocus(delta < 0 ? "memories:page:prev" : "memories:page:next");
        }
    }


    function headerCaption(): string {
        switch (focusedToggleKey) {
            case "memories:order":
                return t(language, "Toggle Newest / Oldest");
            case "memories:columns":
                return t(language, "Grid Size");
            case "memories:shared":
                return t(language, "Shared Memories");
            default:
                return "";
        }
    }
    const caption = headerCaption();

    function renderToggleButton(focusKey: string, icon: ReactNode, onClick: () => void) {
        return (
            <FocusTarget focusKey={focusKey} style={{ display: "flex" }}>
                <DialogButton
                    onClick={onClick}
                    onGamepadFocus={() => setFocusedToggleKey(focusKey)}
                    onGamepadBlur={() => setFocusedToggleKey((current) => current === focusKey ? null : current)}
                    onMouseEnter={() => setFocusedToggleKey(focusKey)}
                    onMouseLeave={() => setFocusedToggleKey((current) => current === focusKey ? null : current)}
                    style={{
                        minWidth: 0,
                        width: "30px",
                        height: "30px",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: focusedToggleKey === focusKey ? 1 : 0.8,
                        boxShadow: focusedToggleKey === focusKey
                            ? "0 0 0 2px rgba(255, 255, 255, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)"
                            : undefined
                    }}
                >
                    {icon}
                </DialogButton>
            </FocusTarget>
        );
    }

    function renderPageArrow(place: PageStripPlace, key: string, delta: number) {
        const focusKey = place === "top"
            ? `memories:page:${key}`
            : `memories:page:bottom:${key}`;
        const fallback = place === "top"
            ? ["memories:filter"]
            : [`memories:page:${key}`, "memories:filter"];
        return (
            <FocusTarget focusKey={focusKey} focusFallback={fallback} style={{ display: "flex" }}>
                <DialogButton
                    onClick={() => turnPage(delta, place)}
                    onGamepadFocus={() => {
                        forgetNavAxisMemory(gridNavRef);
                        setFocusedToggleKey(focusKey);
                    }}
                    onGamepadBlur={() => setFocusedToggleKey((current) => current === focusKey ? null : current)}
                    onMouseEnter={() => setFocusedToggleKey(focusKey)}
                    onMouseLeave={() => setFocusedToggleKey((current) => current === focusKey ? null : current)}
                    style={{
                        minWidth: 0,
                        width: "44px",
                        height: "22px",
                        flexGrow: 0,
                        flexShrink: 0,
                        padding: "0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: focusedToggleKey === focusKey ? 1 : 0.8,
                        boxShadow: focusedToggleKey === focusKey
                            ? "0 0 0 2px rgba(255, 255, 255, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)"
                            : undefined
                    }}
                >
                    <PageArrowIcon size={12} back={delta < 0} />
                </DialogButton>
            </FocusTarget>
        );
    }

    function pageStripContent(place: PageStripPlace, pageIndex: number, totalPages: number) {
        return (
            <>
                {renderPageArrow(place, "prev", -1)}
                <span
                    style={{
                        fontSize: `${textSize(11)}px`,
                        opacity: 0.8,
                        whiteSpace: "nowrap",
                        minWidth: "52px",
                        textAlign: "center"
                    }}
                >
                    {`${pageIndex + 1} / ${totalPages}`}
                </span>
                {renderPageArrow(place, "next", 1)}
            </>
        );
    }

    const bottomStripShown = memories.totalPages > 1
        && memories.pageMemories.length >= memories.perPage;

    function renderPageStrip() {
        if (list.totalPages <= 1) {
            return null;
        }
        return (
            <PanelSectionRow>
                <Focusable
                    flow-children="row"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}
                >
                    {pageStripContent("top", list.pageIndex, list.totalPages)}
                </Focusable>
            </PanelSectionRow>
        );
    }

    function renderGrid() {
        if (memories.pageMemories.length === 0 && (listPending || memories.loading)) {
            return null;
        }
        if (memories.pageMemories.length === 0) {
            return (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {memories.tagFilter || memories.colorFilter || memories.mediaFilter
                            ? t(language, "No memories match the filter.")
                            : t(language, "No memories yet. With this game loaded in CheevoDeck, simply press Steam's currently configured screenshot or record/stop buttons to begin saving memories. See the help button (?) above for a complete guide on how this feature works.")}
                    </div>
                </PanelSectionRow>
            );
        }

        return (
            <PanelSectionRow>
                <Focusable
                    navRef={gridNavRef}
                    resetNavOnEntry
                    flow-children="grid"
                    navEntryPreferPosition={NAV_ENTER_FIRST}
                    style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${memories.gridColumns}, 1fr)`,
                        gap: "8px",
                        width: "100%"
                    }}
                >
                    {memories.pageMemories.map((memory, index) => {
                        const card = (
                            <MemoryCard
                                memory={memory}
                                thumbDataUri={memories.thumbs[memory.path] ?? null}
                                cold={memories.coldPaths.has(memory.path)}
                                armed={memories.armedDeleteId === memory.id}
                                focused={memories.focusedMemoryId === memory.id}
                                nextId={memories.pageMemories[index + 1]?.id ?? null}
                                prevId={memories.pageMemories[index - 1]?.id ?? null}
                                list={cardList}
                            />
                        );
                        const claim = rowClaim.claim;
                        if (!claim || claim.slotIndex !== index) {
                            return <div key={index}>{card}</div>;
                        }
                        return (
                            <FocusClaim
                                key={index}
                                token={claim.token}
                                armed={claim.armed}
                                onSpent={rowClaim.spend}
                            >
                                {card}
                            </FocusClaim>
                        );
                    })}
                    {bottomStripShown && (
                        <div
                            style={{
                                gridColumn: "1 / -1",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "10px",
                                marginTop: "4px"
                            }}
                        >
                            {pageStripContent("bottom", memories.pageIndex, memories.totalPages)}
                        </div>
                    )}
                </Focusable>
            </PanelSectionRow>
        );
    }

    return (
        <Focusable onButtonDown={handlePageButtonDown}>
            <PanelSection key="memories:view">
                <PageNavStrip
                    title={t(language, "Memories")}
                    buttonSpacing={buttonSpacing}
                    onHome={actions.onHome}
                    help={<PageHelpButton focusKey="memories:guide" guide="memories" />}
                />
                <BackButton
                    label={t(language, "Back")}
                    focusKey="memories:back"
                    navAutoFocus
                    reclaim={backClaimToken > 0}
                    buttonSpacing={buttonSpacing}
                    onClick={actions.onBack}
                    scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
                />

                {firstRun ? (
                    <PanelSectionRow>
                        <ToggleRow
                            focusKey="memories:toggle:autoCapture"
                            label={t(language, "Enable Memories")}
                            value={autoCapture}
                            onChange={(next) => void actions.onEnableCapture(next)}
                            help={t(language, "help_memories_first_run")}
                            bottomSeparator="none"
                        />
                    </PanelSectionRow>
                ) : (
                    <>
                        <LabeledRow
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="memories:game"
                            label={t(language, "Game")}
                            value={(
                                <MemoryGameValue
                                    key={String(gameRow.gameId)}
                                    gameId={gameRow.gameId}
                                    label={gameRow.label}
                                    imageIcon={gameRow.imageIcon}
                                    showIcons={showIcons}
                                />
                            )}
                            onClick={openGamePicker}
                            bottomSeparator="none"
                        />
                        <LabeledRow
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="memories:filter"
                            label={t(language, "Filter")}
                            value={filterValue}
                            underlineColor={filterRuleColor}
                            onClick={openTagFilter}
                            bottomSeparator="none"
                        />

                        {!list.empty && (
                            <div style={{ visibility: memories.pageMemories.length > 0 ? "visible" : "hidden" }}>
                                <ButtonHints
                                    style={glyphStyle}
                                    hints={[
                                        { button: "a", label: t(language, "View") },
                                        { button: "y", label: t(language, "Edit") },
                                        { button: "x", label: t(language, "Delete") },
                                        { button: "l1", label: t(language, "Move") },
                                        { button: "r1", label: t(language, "Save Media") },
                                        { button: "r2", label: t(language, "share_memory_action") }
                                    ]}
                                />
                            </div>
                        )}

                        {renderPageStrip()}

                        <SectionTitle
                            align="start"
                            scaled={false}
                            label={t(language, "Memories ({{count}})", { count: memories.visibleCount })}
                            action={(
                                <Focusable
                                    flow-children="row"
                                    style={{ display: "flex", gap: "6px", flexShrink: 0 }}
                                >
                                    {renderToggleButton(
                                        "memories:shared",
                                        <UsersIcon size={16} />,
                                        () => {
                                            openSharedMemories(language);
                                        }
                                    )}
                                    {renderToggleButton(
                                        "memories:order",
                                        memories.dateOrder === "desc"
                                            ? <ArrowDownWideShortIcon size={16} />
                                            : <ArrowUpShortWideIcon size={16} />,
                                        () => actions.memories.toggleDateOrder()
                                    )}
                                    {renderToggleButton(
                                        "memories:columns",
                                        <GridIcon size={16} />,
                                        () => {
                                            const next = GRID_COLUMN_CHOICES[
                                                (GRID_COLUMN_CHOICES.indexOf(memories.gridColumns) + 1)
                                                % GRID_COLUMN_CHOICES.length
                                            ];
                                            actions.memories.selectColumns(next);
                                        }
                                    )}
                                </Focusable>
                            )}
                        />
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontWeight: 700,
                                minHeight: "17px",
                                marginBottom: "2px",
                                textAlign: "center",
                                whiteSpace: "nowrap",
                                opacity: caption ? 0.95 : 0
                            }}
                        >
                            {caption}
                        </div>

                        {memories.truncated > 0 && memories.gameId === ALL_GAMES_ID ? (
                            <div style={{ ...smallTextStyle(), opacity: 0.7, marginBottom: "4px" }}>
                                {t(
                                    language,
                                    memories.dateOrder === "desc"
                                        ? "Showing the newest {{count}}. Filters only search these."
                                        : "Showing the oldest {{count}}. Filters only search these.",
                                    { count: memories.memories.length }
                                )}
                            </div>
                        ) : null}

                        {renderGrid()}

                        {memories.pageMemories.length === 0 ? (
                            <BottomFocusAnchor
                                focusKey="memories:bottom:anchor"
                                headroomPx={BOTTOM_HEADROOM_PX}
                            />
                        ) : (
                            <div style={{ height: `${BOTTOM_HEADROOM_PX}px` }} />
                        )}
                    </>
                )}
            </PanelSection>
        </Focusable>
    );
}

export default skipWhileHidden(MemoriesPage, (props) => props.state.view === "memories");
