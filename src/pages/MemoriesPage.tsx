import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { SectionTitle } from "../components/ui/SectionTitle";
import { LabeledRow } from "../components/ui/LabeledRow";
import { FadeImage } from "../components/ui/FadeImage";
import { useResilientGameIcon } from "../hooks/useResilientGameIcon";
import { ButtonHints } from "../components/ui/ButtonHints";
import { ToggleRow } from "../components/ui/ToggleRow";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { FocusClaim } from "../components/ui/FocusClaim";
import type { FocusClaimController } from "../hooks/useFocusClaim";
import { GridIcon } from "../components/ui/GridIcon";
import { ArrowDownWideShortIcon, ArrowUpShortWideIcon } from "../components/ui/SortOrderIcons";
import { MemoryCard, type MemoryCardListProps } from "../components/memories/MemoryCard";
import { MemoryGamePickerModal } from "../components/memories/MemoryGamePickerModal";
import { MemoryTagFilterModal } from "../components/memories/MemoryTagFilterModal";
import { MemoryViewerModal } from "../components/memories/MemoryViewerModal";
import { MemoryEditorModal } from "../components/memories/MemoryEditorModal";
import { MemoryMoveModal } from "../components/memories/MemoryMoveModal";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { showManagedModal } from "../utils/modalRegistry";
import { armMemoriesFocusKey, armMemoriesFocusReturn } from "../utils/memoriesFocusReturn";
import { requestJumpToTop } from "../utils/jumpToTop";
import { saveMemoryToFolder } from "../utils/saveMemoryMedia";
import { forgetNavAxisMemory, type NavAxisRef } from "../utils/navAxisMemory";
import { playOkSound } from "../utils/navSound";
import { logFocusDebug } from "../api";
import { ALL_GAMES_ID, MISC_GAME_ID, mediaFilterKey, memoryRemovalLanding } from "../utils/memories";
import { noteBodyColor } from "../utils/achievements";
import { bodyTextStyle, regularButtonSpacingStyle } from "../utils/style";
import { textSize } from "../utils/scale";
import { BUTTON_SECONDARY, BUTTON_OPTIONS, BUTTON_BUMPER_LEFT, BUTTON_BUMPER_RIGHT } from "../utils/gamepadButtons";
import { t, type LanguageCode } from "../locales";
import type { MemoriesControllerActions, MemoriesControllerState } from "../hooks/useMemoriesController";
import type { ButtonSpacing, ControllerGlyphStyle, NoteColor, ViewKey } from "../types";

function MemoryGameValue(props: { gameId: number | null; label: string; imageIcon: string; showIcons: boolean }) {
    const { gameId, label, imageIcon, showIcons } = props;
    const realGame = gameId !== null && gameId !== ALL_GAMES_ID && gameId !== MISC_GAME_ID;
    const { iconDataUri } = useResilientGameIcon(
        realGame && showIcons ? gameId : null,
        imageIcon || null,
        "MemoryGameValue getGameIconCached"
    );

    if (!iconDataUri) {
        return <>{label}</>;
    }
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <span
                style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "5px",
                    overflow: "hidden",
                    flexShrink: 0,
                    display: "inline-flex"
                }}
            >
                <FadeImage
                    src={iconDataUri}
                    fadeOnLoad={false}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
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

function ClaimedRow(props: { claim: FocusClaimController; slotIndex: number; children: ReactNode }) {
    const { claim, spend } = props.claim;
    const mine = claim && claim.slotIndex === props.slotIndex ? claim : null;

    return (
        <FocusClaim
            token={mine ? mine.token : 0}
            armed={mine !== null && mine.armed}
            onSpent={spend}
        >
            {props.children}
        </FocusClaim>
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

const GAME_CLAIM_SLOT = -2;
const FILTER_CLAIM_SLOT = -3;

const CONTROL_CLAIM_SLOTS: Record<string, number> = {
    "memories:game": GAME_CLAIM_SLOT,
    "memories:filter": FILTER_CLAIM_SLOT
};

type MemoriesPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    glyphStyle: ControllerGlyphStyle;
    mouseKeyboardMode: boolean;
    showIcons: boolean;
    showRetroPoints: boolean;
    panelOverlayVisible: boolean;
    autoCapture: boolean;
    activeUlid: string;
    restoreMemoryId: string | null;
    restoreFocusKey: string | null;
    restoreGameId: number | null;
    restoreUlid: string | null;
    restorePending: boolean;
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
        focusScopeResetToken,
        language,
        buttonSpacing,
        glyphStyle,
        mouseKeyboardMode,
        showIcons,
        showRetroPoints,
        panelOverlayVisible,
        autoCapture,
        activeUlid,
        restoreMemoryId,
        restoreFocusKey,
        restoreGameId,
        restoreUlid,
        restorePending,
        memories
    } = state;

    const restoreClaim = useFocusClaim();
    const restoreFiredRef = useRef(false);
    const [restoreAbandoned, setRestoreAbandoned] = useState(false);
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

    const restoreIndex = useMemo(() => {
        if (!restoreMemoryId) {
            return -1;
        }
        return memories.pageMemories.findIndex((memory) => memory.id === restoreMemoryId);
    }, [restoreMemoryId, memories.pageMemories]);

    useEffect(function landRestoredCursor() {
        if (!active || !restorePending || restoreFiredRef.current) {
            return;
        }
        if (restoreFocusKey === "memories:back") {
            restoreFiredRef.current = true;
            setBackClaimToken((current) => current + 1);
            actions.onRequestFocus(restoreFocusKey);
            return;
        }
        if (restoreFocusKey) {
            restoreFiredRef.current = true;
            const slot = CONTROL_CLAIM_SLOTS[restoreFocusKey];
            if (slot === undefined) {
                setRestoreAbandoned(true);
            } else {
                restoreClaim.claimSlot(slot);
            }
            actions.onRequestFocus(restoreFocusKey);
            return;
        }
        if (!memories.ready || memories.loading || memories.loadedForGameId === null) {
            return;
        }
        const mismatched = restoreUlid !== activeUlid
            || (restoreGameId !== null
                && memories.gameId !== ALL_GAMES_ID
                && restoreGameId !== memories.gameId);
        if (mismatched || restoreIndex < 0) {
            restoreFiredRef.current = true;
            setRestoreAbandoned(true);
            logFocusDebug("memory-restore", restoreMemoryId ?? "(none)", "no match on the far side");
            actions.onRequestFocus("memories:back");
            return;
        }
        restoreFiredRef.current = true;
        restoreClaim.claimSlot(restoreIndex);
        actions.onRequestFocus(`memories:tile:${restoreMemoryId}`);
    }, [
        active,
        restorePending,
        restoreIndex,
        restoreMemoryId,
        restoreFocusKey,
        restoreGameId,
        restoreUlid,
        activeUlid,
        memories.ready,
        memories.loading,
        memories.loadedForGameId,
        memories.gameId,
        restoreClaim.claimSlot,
        actions.onRequestFocus
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

    const selectedGame = memories.games.find((row) => row.gameId === memories.gameId) ?? null;
    const gameLabel = memories.gameId === ALL_GAMES_ID || selectedGame === null
        ? t(language, "All Games")
        : (selectedGame.gameId === MISC_GAME_ID
            ? t(language, "Uncategorized")
            : (selectedGame.gameTitle || t(language, "Unknown game")));

    const filterRuleColor = memories.colorFilter
        ? (noteBodyColor(memories.colorFilter as NoteColor) ?? "rgba(255, 255, 255, 0.45)")
        : undefined;

    const mediaKey = mediaFilterKey(memories.mediaFilter);
    const filterParts = [memories.tagFilter, mediaKey ? t(language, mediaKey) : ""];
    const filterValue = filterParts.filter(Boolean).join(" \u00b7 ") || t(language, "All");

    function openGamePicker() {
        armFocusKey("memories:game");
        showManagedModal((close) => (
            <MemoryGamePickerModal
                games={memories.games}
                selected={memories.gameId}
                language={language}
                showIcons={showIcons}
                onSelect={actions.memories.selectGame}
                close={close}
            />
        ));
    }

    function openTagFilter() {
        armFocusKey("memories:filter");
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
                close={close}
            />
        ));
    }

    function armFocusKey(focusKey: string) {
        armMemoriesFocusKey(focusKey);
    }

    openViewerRef.current = openViewer;

    function openViewer(memoryId: string) {
        const memory = memories.pageMemories.find((row) => row.id === memoryId);
        if (!memory) {
            return;
        }
        armMemoriesFocusReturn(memory.gameId, memoryId, activeUlid);
        showManagedModal((close) => (
            <MemoryViewerModal
                memory={memory}
                gameId={memory.gameId}
                thumbDataUri={memories.thumbs[memory.path] ?? null}
                language={language}
                mouseKeyboardMode={mouseKeyboardMode}
                showRetroPoints={showRetroPoints}
                allTags={memories.allTags}
                activeUlid={activeUlid}
                tagFilter={memories.tagFilter}
                removalLandingId={memoryRemovalLanding(memories.pageMemories, memoryId)}
                close={close}
            />
        ));
    }

    function openEditor(memoryId: string) {
        const memory = memories.pageMemories.find((row) => row.id === memoryId);
        if (!memory) {
            return;
        }
        armMemoriesFocusReturn(memory.gameId, memoryId, activeUlid);
        showManagedModal((close) => (
            <MemoryEditorModal
                memory={memory}
                gameId={memory.gameId}
                language={language}
                allTags={memories.allTags}
                activeUlid={activeUlid}
                tagFilter={memories.tagFilter}
                removalLandingId={memoryRemovalLanding(memories.pageMemories, memoryId)}
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
        }
    }

    function openMove(memoryId: string) {
        const memory = memories.pageMemories.find((row) => row.id === memoryId);
        if (!memory) {
            return;
        }
        armMemoriesFocusReturn(memory.gameId, memoryId, activeUlid);
        showManagedModal((close) => (
            <MemoryMoveModal
                memory={memory}
                gameId={memory.gameId}
                games={memories.games}
                loadedGameId={memories.loadedGameId}
                language={language}
                showIcons={showIcons}
                activeUlid={activeUlid}
                removalLandingId={memoryRemovalLanding(memories.pageMemories, memoryId)}
                close={close}
            />
        ));
    }

    function saveMedia(memoryId: string) {
        const memory = memories.pageMemories.find((row) => row.id === memoryId);
        if (!memory) {
            return;
        }
        armMemoriesFocusReturn(memory.gameId, memoryId, activeUlid);
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
                restoreClaim.claimSlot(landingSlot);
                actions.onRequestFocus(`memories:tile:${landingId}`);
            }
            return;
        }
        if (fallbackId) {
            actions.memories.turnPage(-1);
            restoreClaim.claimSlot(memories.perPage - 1);
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


    const restoreSettledRef = useRef(false);
    if (restoreAbandoned || ((restoreClaim.claim?.token ?? 0) > 0 && !restoreClaim.claim?.armed)) {
        restoreSettledRef.current = true;
    }
    const restoreSettled = restoreSettledRef.current;

    function renderToggleButton(focusKey: string, icon: ReactNode, onClick: () => void) {
        return (
            <div data-focus-key={focusKey} style={{ display: "flex" }}>
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
            </div>
        );
    }

    function renderPageArrow(place: PageStripPlace, key: string, delta: number) {
        const focusKey = place === "top"
            ? `memories:page:${key}`
            : `memories:page:bottom:${key}`;
        return (
            <div data-focus-key={focusKey} style={{ display: "flex" }}>
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
            </div>
        );
    }

    function pageStripContent(place: PageStripPlace) {
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
                    {`${memories.pageIndex + 1} / ${memories.totalPages}`}
                </span>
                {renderPageArrow(place, "next", 1)}
            </>
        );
    }

    const bottomStripShown = memories.totalPages > 1
        && memories.pageMemories.length >= memories.perPage;

    function renderPageStrip() {
        if (memories.totalPages <= 1) {
            return null;
        }
        return (
            <PanelSectionRow>
                <Focusable
                    flow-children="row"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}
                >
                    {pageStripContent("top")}
                </Focusable>
            </PanelSectionRow>
        );
    }

    function renderGrid() {
        if (memories.loading && memories.pageMemories.length === 0) {
            return (
                <PanelSectionRow>
                    <InlineSpinner />
                </PanelSectionRow>
            );
        }
        if (memories.pageMemories.length === 0) {
            return (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {memories.tagFilter
                            ? t(language, "No memories with that tag.")
                            : t(language, "No memories yet. Press the default Steam screenshot or record button combo to either take pictures or record a clip. When recording be sure to press it again when done.")}
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
                                list={cardList}
                            />
                        );
                        const claim = restoreClaim.claim;
                        if (!claim || claim.slotIndex !== index) {
                            return <div key={index}>{card}</div>;
                        }
                        return (
                            <FocusClaim
                                key={index}
                                token={claim.token}
                                armed={claim.armed}
                                onSpent={restoreClaim.spend}
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
                            {pageStripContent("bottom")}
                        </div>
                    )}
                </Focusable>
            </PanelSectionRow>
        );
    }

    const page = (
        <Focusable onButtonDown={handlePageButtonDown}>
            <PanelSection key={`memories:view:${focusScopeResetToken}`}>
                <PageNavStrip
                    title={t(language, "Memories")}
                    buttonSpacing={buttonSpacing}
                    onHome={actions.onHome}
                />
                <BackButton
                    label={t(language, "Back")}
                    focusKey="memories:back"
                    navAutoFocus={!restorePending || backClaimToken > 0}
                    buttonSpacing={buttonSpacing}
                    onClick={actions.onBack}
                    scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
                />

                {firstRun ? (
                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Enable Memories")}
                            value={autoCapture}
                            onChange={(next) => void actions.onEnableCapture(next)}
                            help={t(language, "help_memories_first_run")}
                            bottomSeparator="none"
                        />
                    </PanelSectionRow>
                ) : (
                    <>
                        <ClaimedRow claim={restoreClaim} slotIndex={GAME_CLAIM_SLOT}>
                        <LabeledRow
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="memories:game"
                            label={t(language, "Game")}
                            value={(
                                <MemoryGameValue
                                    gameId={memories.gameId}
                                    label={gameLabel}
                                    imageIcon={selectedGame?.imageIcon || ""}
                                    showIcons={showIcons}
                                />
                            )}
                            onClick={openGamePicker}
                            bottomSeparator="none"
                        />
                        </ClaimedRow>
                        <ClaimedRow claim={restoreClaim} slotIndex={FILTER_CLAIM_SLOT}>
                        <LabeledRow
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="memories:filter"
                            label={t(language, "Filter")}
                            value={filterValue}
                            underlineColor={filterRuleColor}
                            onClick={openTagFilter}
                            bottomSeparator="none"
                        />
                        </ClaimedRow>

                        {memories.pageMemories.length > 0 && (
                            <ButtonHints
                                style={glyphStyle}
                                hints={[
                                    { button: "a", label: t(language, "View") },
                                    { button: "y", label: t(language, "Edit") },
                                    { button: "x", label: t(language, "Delete") },
                                    { button: "l1", label: t(language, "Move") },
                                    { button: "r1", label: t(language, "Save Media") }
                                ]}
                            />
                        )}

                        {renderPageStrip()}

                        <SectionTitle
                            align="start"
                            scaled={false}
                            label={t(language, "Memories ({{count}})", { count: memories.visibleCount })}
                            action={(
                                <Focusable flow-children="row" style={{ display: "flex", gap: "6px" }}>
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

                        {renderGrid()}

                        <div style={{ height: `${BOTTOM_HEADROOM_PX}px` }} />
                    </>
                )}
            </PanelSection>
        </Focusable>
    );

    return (
        <RestoreCurtain
            armed={restorePending}
            settled={restoreSettled}
            covered={panelOverlayVisible}
        >
            {page}
        </RestoreCurtain>
    );
}

export default MemoriesPage;
