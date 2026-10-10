import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { InfoText } from "../components/ui/InfoText";
import { NoteCard, type NoteCardListProps } from "../components/notes/NoteCard";
import { FocusClaim } from "../components/ui/FocusClaim";
import { CollapsibleTitle } from "../components/ui/CollapsibleTitle";
import { SectionHeaderRow } from "../components/ui/SectionHeaderRow";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { ReorderStrip } from "../components/ui/ReorderStrip";
import { ButtonHints } from "../components/ui/ButtonHints";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { PencilIcon } from "../components/ui/PencilIcon";
import { ArrowDownWideShortIcon, ArrowUpShortWideIcon } from "../components/ui/SortOrderIcons";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { useWhenHeld } from "../hooks/useWhenHeld";
import { logFocusDebug } from "../api";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    ControllerGlyphStyle,
    GameNote,
    GameNoteAButtonMode,
    GameNoteSortMode,
    HeaderStyle,
    Payload,
    ReorderDirection,
    UiSize,
    ViewKey
} from "../types";
import {
    buildNoteSections,
    noteSectionCollapseKey,
    type NoteSection
} from "../utils/noteSections";
import { achievementUiMetrics, smallTextStyle, bodyTextStyle } from "../utils/style";
import { BUTTON_OPTIONS } from "../utils/gamepadButtons";
import { playOkSound } from "../utils/navSound";

type GameNotesPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    uiSize: UiSize;
    notesHeaderStyle: HeaderStyle;
    payload: Payload | null;
    gameNotesGameId?: number | null;
    notes: GameNote[];
    sortMode: GameNoteSortMode;
    aButtonMode: GameNoteAButtonMode;
    reorderTargetId: string | null;
    reorderViaSwap?: boolean;
    validating: boolean;
    loadedForGameId: number | null;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    gameIconDataUri: string | null;
    gameIconCold: boolean;
    showIcons: boolean;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    restoreNoteId: string | null;
    restorePending: boolean;
    panelOverlayVisible: boolean;
    collapsedTags: string[];
};

type GameNotesPageActions = {
    onBack: () => void | Promise<void>;
    onAddNote: () => void;
    onEditNote: (note: GameNote) => void;
    onSortModeChange: (next: GameNoteSortMode) => void | Promise<unknown>;
    onAButtonModeChange: (next: GameNoteAButtonMode) => void | Promise<unknown>;
    onReorderSwap: (pressedId: string, sectionIds: string[] | null, allowSwap?: boolean) => void | Promise<unknown>;
    onReorderToward: (landedNoteId: string, sectionIds: string[] | null) => void;
    onReorderMove: (direction: ReorderDirection, sectionIds?: string[] | null) => void | Promise<unknown>;
    onCardFocused: (noteId: string) => void | Promise<unknown>;
    onHome: () => void | Promise<void>;
    onRequestFocus: (focusKey: string) => void;
    onToggleCollapsedTag: (key: string) => void;
};

export type GameNotesPageProps = {
    state: GameNotesPageState;
    actions: GameNotesPageActions;
};

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
type StripIconProps = { size?: number };

function PlusIcon({ size = 18 }: StripIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32V224H48c-17.7 0-32 14.3-32 32s14.3 32 32 32H192V432c0 17.7 14.3 32 32 32s32-14.3 32-32V288H400c17.7 0 32-14.3 32-32s-14.3-32-32-32H256V80z" />
        </svg>
    );
}

function ArrowsUpDownIcon({ size = 18 }: StripIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 320 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M137.4 41.4c12.5-12.5 32.8-12.5 45.3 0l128 128c9.2 9.2 11.9 22.9 6.9 34.9s-16.6 19.8-29.6 19.8H32c-12.9 0-24.6-7.8-29.6-19.8s-2.2-25.7 6.9-34.9l128-128zm0 429.3l-128-128c-9.2-9.2-11.9-22.9-6.9-34.9s16.6-19.8 29.6-19.8H288c12.9 0 24.6 7.8 29.6 19.8s2.2 25.7-6.9 34.9l-128 128c-12.5 12.5-32.8 12.5-45.3 0z" />
        </svg>
    );
}

function HandPointerIcon({ size = 18 }: StripIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M160 64c0-8.8 7.2-16 16-16s16 7.2 16 16V200c0 10.3 6.6 19.5 16.4 22.8s20.6-.1 26.8-8.3c3-3.9 7.6-6.5 13-6.5c8.8 0 16 7.2 16 16v40c0 10.3 6.6 19.5 16.4 22.8s20.6-.1 26.8-8.3c3-3.9 7.6-6.5 13-6.5c7.8 0 14.3 5.6 15.7 13c1.6 8.2 7.3 15.1 15.1 18s16.7 1.6 23.3-3.6c2.7-2.1 6.1-3.4 9.9-3.4c8.8 0 16 7.2 16 16V400c0 44.2-35.8 80-80 80H272 211.6c-32.5 0-63.5-13.2-86-36.5L18.6 330.5C7 318.4 0 302.2 0 285.4C0 250.3 28.3 222 63.4 222h1.5c11.6 0 23 3.1 33 9.1L160 268.3V64zm16-64C140.7 0 112 28.7 112 64V194.9l-21.5-12.9c-17.4-10.4-37.4-16-57.7-16C14.7 166 0 180.7 0 198.8H0c0-12.9 5.1-25.3 14.3-34.4L97.2 81.5C108.2 70.5 124 64 140.5 64H176z" />
        </svg>
    );
}

type StripEntryKind = "action" | "aButton" | "sort";

type StripEntryDef = {
    focusKey: string;
    kind: StripEntryKind;
    aButtonValue?: GameNoteAButtonMode;
    sortValue?: GameNoteSortMode;
    Icon: ComponentType<StripIconProps>;
    labelKey: string;
    dividerAfter?: boolean;
};

const NOTE_STRIP_ENTRIES: StripEntryDef[] = [
    { focusKey: "gn:strip:add", kind: "action", Icon: PlusIcon, labelKey: "+ Add Note" },
    { focusKey: "gn:strip:editNote", kind: "aButton", aButtonValue: "editNote", Icon: PencilIcon, labelKey: "gn_strip_edit" },
    { focusKey: "gn:strip:reorder", kind: "aButton", aButtonValue: "moveNote", Icon: ArrowsUpDownIcon, labelKey: "Reorder", dividerAfter: true },
    { focusKey: "gn:strip:manual", kind: "sort", sortValue: "manual", Icon: HandPointerIcon, labelKey: "Manual" },
    { focusKey: "gn:strip:newest", kind: "sort", sortValue: "newest", Icon: ArrowDownWideShortIcon, labelKey: "Newest" },
    { focusKey: "gn:strip:oldest", kind: "sort", sortValue: "oldest", Icon: ArrowUpShortWideIcon, labelKey: "Oldest" }
];

const GAMEPAD_STRIP_ENTRIES: StripEntryDef[] = NOTE_STRIP_ENTRIES
    .filter((entry) => entry.kind !== "aButton")
    .map((entry) => (entry.kind === "action" ? { ...entry, dividerAfter: true } : entry));

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

type NoteHeading = { heading: NoteSection; collapseKey: string; collapsed: boolean };
type NoteEntry = NoteHeading | GameNote;

function isNoteHeading(entry: NoteEntry): entry is NoteHeading {
    return "heading" in entry;
}

function noteEntryKey(entry: NoteEntry): string {
    return isNoteHeading(entry) ? `section:${entry.collapseKey}` : entry.id;
}

function noteEntryFocusKey(entry: NoteEntry): string {
    return isNoteHeading(entry) ? `gn:section:${entry.collapseKey}` : `gn:card:${entry.id}`;
}

function sectionIdsForReorderTarget(sections: NoteSection[], targetId: string | null): string[] | null {
    if (targetId === null) {
        return null;
    }
    for (const section of sections) {
        if (section.isCompleted) {
            continue;
        }
        if (section.orderedNotes.some((n) => n.id === targetId)) {
            return section.orderedNotes.map((n) => n.id);
        }
    }
    return null;
}

function largestReorderableSection(sections: NoteSection[]): number {
    let largest = 0;
    for (const section of sections) {
        if (section.isCompleted) {
            continue;
        }
        largest = Math.max(largest, section.orderedNotes.length);
    }
    return largest;
}

export function GameNotesPage(props: GameNotesPageProps) {
    const { state, actions } = props;
    const {
        language,
        buttonSpacing,
        uiSize,
        notesHeaderStyle,
        payload,
        gameNotesGameId,
        notes,
        sortMode,
        aButtonMode,
        reorderTargetId,
        reorderViaSwap,
        validating,
        loadedForGameId,
        dynamicLoading,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicPrefetchDistance,
        dynamicSentinelRootMargin,
        gameIconDataUri,
        gameIconCold,
        showIcons,
        mouseKeyboardMode,
        controllerGlyphStyle,
        restoreNoteId,
        restorePending,
        panelOverlayVisible,
        collapsedTags
    } = state;

    const gameId = gameNotesGameId ?? payload?.gameId ?? null;

    const sections = useMemo(
        () => buildNoteSections(notes, sortMode, language),
        [notes, sortMode, language]
    );

    const collapsedSet = useMemo(() => new Set(collapsedTags), [collapsedTags]);

    const restoreClaim = useFocusClaim();

    const restoreSlot = useMemo(() => {
        if (restoreNoteId === null) {
            return null;
        }
        for (const section of sections) {
            const indexInSection = section.orderedNotes.findIndex((note) => note.id === restoreNoteId);
            if (indexInSection >= 0) {
                return { collapseKey: noteSectionCollapseKey(section), indexInSection };
            }
        }
        return null;
    }, [restoreNoteId, sections]);

    const entries = useMemo(() => {
        const out: NoteEntry[] = [];
        for (const section of sections) {
            const collapseKey = noteSectionCollapseKey(section);
            const collapsed = collapsedSet.has(collapseKey);
            out.push({ heading: section, collapseKey, collapsed });
            if (!collapsed) {
                out.push(...section.orderedNotes);
            }
        }
        return out;
    }, [sections, collapsedSet]);

    const noteWindow = useSlidingWindow({
        items: entries,
        itemKey: noteEntryKey,
        focusKeyFor: noteEntryFocusKey,
        windowId: "notes:entries",
        heightScope: ["notes:entries", language, uiSize, showIcons, notesHeaderStyle].join("|"),
        dynamicLoading,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMarginPx: dynamicSentinelRootMargin,
        resetKey: `${gameId}|${sortMode}`,
        debugLabel: "notes:entries"
    });
    const whenNoteHeld = useWhenHeld(noteWindow, entries, noteEntryFocusKey);

    const noteClaim = restoreClaim.claim;
    const noteClaimOvertaken = noteClaim !== null && noteClaim.armed
        && (noteClaim.slotIndex < noteWindow.start
            || noteClaim.slotIndex >= noteWindow.start + noteWindow.mountedItems.length);
    useEffect(function dropOvertakenClaim() {
        if (noteClaimOvertaken) {
            restoreClaim.spend();
        }
    }, [noteClaimOvertaken, restoreClaim.spend]);

    const cardSlots = useMemo(() => {
        const slots: number[] = [];
        let card = 0;
        for (const entry of entries) {
            if (isNoteHeading(entry)) {
                slots.push(-1);
                continue;
            }
            slots.push(card);
            card += 1;
        }
        return slots;
    }, [entries]);
    const onItemFocus = noteWindow.onItemFocus;

    const cardClickRef = useRef(handleCardClick);
    cardClickRef.current = handleCardClick;
    const cardFocusedRef = useRef(actions.onCardFocused);
    cardFocusedRef.current = actions.onCardFocused;
    const cardFollowRef = useRef(handleReorderFollow);
    cardFollowRef.current = handleReorderFollow;
    const cardReorderPickRef = useRef(handleCardReorderPick);
    cardReorderPickRef.current = handleCardReorderPick;
    const itemFocusRef = useRef(onItemFocus);
    itemFocusRef.current = onItemFocus;

    const notesReady = gameId !== null && loadedForGameId === gameId;
    const reorderAvailable = sortMode === "manual" && largestReorderableSection(sections) >= 2;
    const gamepadCardActions = !mouseKeyboardMode && notesReady;

    const cardList = useMemo<NoteCardListProps>(() => ({
        language,
        metrics: achievementUiMetrics(uiSize),
        gameIconDataUri,
        gameIconCold,
        showIcons,
        onClick: (note) => {
            cardClickRef.current(note);
        },
        onCardFocused: (noteId) => {
            void cardFocusedRef.current(noteId);
        },
        onCardGamepadFocused: (noteId) => {
            cardFollowRef.current(noteId);
        },
        onFocusIndex: (index) => {
            itemFocusRef.current(index);
        },
        onReorderPick: gamepadCardActions && reorderAvailable
            ? (note) => {
                cardReorderPickRef.current(note);
            }
            : undefined,
    }), [language, uiSize, gameIconDataUri, gameIconCold, showIcons, gamepadCardActions, reorderAvailable]);

    const cardListRef = useRef<HTMLDivElement | null>(null);

    const [focusedStripKey, setFocusedStripKey] = useState<string | null>(null);
    const [hoveredStripKey, setHoveredStripKey] = useState<string | null>(null);

    useEffect(function scrollReorderTargetIntoView() {
        if (state.view !== "gameNotes") {
            return;
        }
        if (reorderTargetId === null) {
            return;
        }
        if (reorderViaSwap) {
            return;
        }
        const searchRoot = cardListRef.current;
        if (!searchRoot) {
            return;
        }
        const row = searchRoot.querySelector(
            `[data-focus-key="gn:card:${reorderTargetId}"]`
        ) as HTMLElement | null;
        if (!row) {
            return;
        }
        row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [state.view, reorderTargetId, notes, reorderViaSwap]);

    const restoreFiredRef = useRef(false);

    const restoreUnfoldedRef = useRef(false);

    const entryAtRef = useRef(performance.now());

    const [restoreAbandoned, setRestoreAbandoned] = useState(false);

    useEffect(function landRestoredCursor() {
        if (state.view !== "gameNotes") {
            return;
        }
        if (!restorePending || restoreFiredRef.current) {
            return;
        }
        if (gameId === null) {
            return;
        }
        if (restoreNoteId === null) {
            restoreFiredRef.current = true;
            setRestoreAbandoned(true);
            logFocusDebug("note-restore", "(none)", `game=${gameId} no match on the far side`);
            actions.onRequestFocus("gn:back");
            return;
        }
        if (!notesReady) {
            return;
        }
        if (restoreSlot === null) {
            restoreFiredRef.current = true;
            setRestoreAbandoned(true);
            logFocusDebug("note-restore", restoreNoteId, `total=${notes.length} -- gone from the list`);
            actions.onRequestFocus("gn:back");
            return;
        }
        if (collapsedSet.has(restoreSlot.collapseKey)) {
            if (!restoreUnfoldedRef.current) {
                restoreUnfoldedRef.current = true;
                logFocusDebug("note-restore", restoreNoteId, `unfolding ${restoreSlot.collapseKey}`);
                actions.onToggleCollapsedTag(restoreSlot.collapseKey);
                return;
            }
            restoreFiredRef.current = true;
            setRestoreAbandoned(true);
            logFocusDebug(
                "note-restore",
                restoreNoteId,
                `${restoreSlot.collapseKey} would not unfold`
            );
            actions.onRequestFocus("gn:back");
            return;
        }
        restoreFiredRef.current = true;
        const key = `gn:card:${restoreNoteId}`;
        const openStartedAt = performance.now();
        whenNoteHeld(key, (slot) => {
            logFocusDebug(
                "note-restore",
                restoreNoteId,
                `section=${restoreSlot.collapseKey} inSection=${restoreSlot.indexInSection} slot=${slot}`
                + ` total=${notes.length}`
                + ` notes=${Math.round(openStartedAt - entryAtRef.current)}ms`
                + ` held=${Math.round(performance.now() - openStartedAt)}ms`
            );
            restoreClaim.claimSlot(slot);
            actions.onRequestFocus(key);
        });
    }, [
        state.view,
        restorePending,
        restoreNoteId,
        gameId,
        notesReady,
        restoreSlot,
        collapsedSet,
        notes.length,
        restoreClaim.claimSlot,
        actions.onRequestFocus,
        actions.onToggleCollapsedTag
    ]);

    if (state.view !== "gameNotes") {
        return null;
    }

    const totalNotes = notes.length;

    const effectiveAButtonMode: GameNoteAButtonMode = mouseKeyboardMode ? aButtonMode : "editNote";

    const reorderStripEnabled =
        sortMode === "manual" && effectiveAButtonMode === "moveNote" && totalNotes >= 2;

    function handleStripClick(entry: StripEntryDef) {
        if (entry.kind === "action") {
            actions.onAddNote();
            return;
        }
        if (entry.kind === "aButton") {
            const next = entry.aButtonValue!;
            if (next === aButtonMode) {
                return;
            }
            void actions.onAButtonModeChange(next);
            return;
        }
        const next = entry.sortValue!;
        if (next === sortMode) {
            return;
        }
        void actions.onSortModeChange(next);
    }

    function handleCardClick(note: GameNote) {
        if (reorderStripEnabled) {
            if (note.completedAt !== null) {
                actions.onEditNote(note);
                return;
            }
            const sectionIds = sectionIdsForReorderTarget(sections, reorderTargetId);
            void actions.onReorderSwap(note.id, sectionIds);
            return;
        }
        actions.onEditNote(note);
    }

    function handleReorderFollow(landedNoteId: string) {
        if (reorderTargetId === null) {
            return;
        }
        actions.onReorderToward(landedNoteId, sectionIdsForReorderTarget(sections, reorderTargetId));
    }

    function handleStripMove(direction: ReorderDirection) {
        const sectionIds = sectionIdsForReorderTarget(sections, reorderTargetId);
        void actions.onReorderMove(direction, sectionIds);
    }

    function handlePageButtonDown(evt: { detail?: { button?: number } }) {
        if (evt?.detail?.button !== BUTTON_OPTIONS || !gamepadCardActions) {
            return;
        }
        playOkSound();
        actions.onAddNote();
    }

    function handleCardReorderPick(note: GameNote) {
        if (note.completedAt !== null) {
            return;
        }
        const sectionIds = sectionIdsForReorderTarget(sections, reorderTargetId);
        void actions.onReorderSwap(note.id, sectionIds, false);
    }

    function renderBody() {
        if (gameId === null) {
            return (
                <PanelSection>
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, "No current game. Open a game to write notes here.")}
                        </div>
                    </PanelSectionRow>
                </PanelSection>
            );
        }

        if (validating && !notesReady) {
            return (
                <PanelSectionRow>
                    <InlineSpinner />
                </PanelSectionRow>
            );
        }

        if (sections.length === 0) {
            return (
                <PanelSection>
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, "No notes yet. Tap Add Note above to start.")}
                        </div>
                    </PanelSectionRow>
                </PanelSection>
            );
        }

        const claim = restoreClaim.claim;

        return (
            <PanelSection>
                <div ref={cardListRef}>
                    <SlidingWindowRows list={noteWindow}>
                        {noteWindow.mountedItems.map((entry, index) => {
                            const slot = noteWindow.start + index;
                            if (isNoteHeading(entry)) {
                                return renderHeading(entry, slot);
                            }
                            const cardKey = `slot:${cardSlots[slot]}`;
                            const card = (
                                <NoteCard
                                    key={cardKey}
                                    note={entry}
                                    rowIndex={slot}
                                    focusKey={`gn:card:${entry.id}`}
                                    isReorderTarget={reorderTargetId === entry.id}
                                    firing={entry.showFiredDot}
                                    list={cardList}
                                    onGamepadDirection={noteWindow.guardTopRow(slot)}
                                />
                            );
                            if (claim && claim.slotIndex === slot) {
                                return (
                                    <FocusClaim
                                        key={cardKey}
                                        token={claim.token}
                                        armed={claim.armed && !noteClaimOvertaken}
                                        onSpent={restoreClaim.spend}
                                    >
                                        {card}
                                    </FocusClaim>
                                );
                            }
                            return card;
                        })}
                    </SlidingWindowRows>
                </div>
            </PanelSection>
        );
    }

    function renderHeading(entry: NoteHeading, slot: number) {
        const section = entry.heading;
        const sectionCount = section.orderedNotes.length;
        const sectionTitle = section.isCompleted
            ? t(language, "Completed ({{count}})", { count: sectionCount })
            : section.tagKey === null
                ? t(language, "Notes ({{count}})", { count: sectionCount })
                : `${section.tag ?? ""} (${sectionCount})`;
        return (
            <SectionHeaderRow key={`section:${entry.collapseKey}`} first={slot === 0}>
                <CollapsibleTitle
                    label={sectionTitle}
                    collapsed={entry.collapsed}
                    focusKey={`gn:section:${entry.collapseKey}`}
                    disabled={reorderTargetId !== null}
                    preserveCase={notesHeaderStyle === "typed"}
                    onToggle={() => actions.onToggleCollapsedTag(entry.collapseKey)}
                    onGamepadFocus={() => onItemFocus(slot)}
                    onGamepadDirection={noteWindow.guardTopRow(slot)}
                />
            </SectionHeaderRow>
        );
    }

    const stripDisabled = !notesReady;
    const addDisabled = gameId === null;

    const reorderDisabled = sortMode !== "manual";

    function stripEntryDisabled(entry: StripEntryDef): boolean {
        if (entry.kind === "action") {
            return addDisabled;
        }
        if (entry.aButtonValue === "moveNote" && reorderDisabled) {
            return true;
        }
        return stripDisabled;
    }

    function stripEntrySelected(entry: StripEntryDef): boolean {
        if (entry.kind === "action") {
            return false;
        }
        if (entry.kind === "aButton") {
            return entry.aButtonValue === aButtonMode;
        }
        return entry.sortValue === sortMode;
    }

    const stripEntries = mouseKeyboardMode ? NOTE_STRIP_ENTRIES : GAMEPAD_STRIP_ENTRIES;

    const previewStripKey = hoveredStripKey ?? focusedStripKey;
    const previewEntry = stripEntries.find((entry) => entry.focusKey === previewStripKey);
    const stripPreviewLabel = previewEntry ? t(language, previewEntry.labelKey) : "";

    const restoreSettled = restoreAbandoned
        || ((restoreClaim.claim?.token ?? 0) > 0 && !restoreClaim.claim?.armed);
    const page = (
        <Focusable
            flow-children="column"
            onButtonDown={handlePageButtonDown}
        >
            <PanelSection
                key="game-notes:view"
            >
                <PageNavStrip
                    title={t(language, "Game Notes")}
                    buttonSpacing={buttonSpacing}
                    onHome={actions.onHome}
                />
                <BackButton
                    label={t(language, "← Back to Main")}
                    focusKey="gn:back"
                    navAutoFocus={!restorePending}
                    buttonSpacing={buttonSpacing}
                    onClick={actions.onBack}
                    scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
                />
                <PanelSectionRow>
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "6px",
                            padding: "14px 0 0 0"
                        }}
                    >
                        <Focusable
                            flow-children="row"
                            style={{
                                display: "flex",
                                gap: "8px",
                                width: "100%",
                                justifyContent: "center"
                            }}
                        >
                            {stripEntries.map((entry) => {
                                const isSelected = stripEntrySelected(entry);
                                const isPreviewed = previewStripKey === entry.focusKey;
                                const isDisabled = stripEntryDisabled(entry);
                                const Icon = entry.Icon;

                                const divider = entry.dividerAfter ? (
                                    <div
                                        key={`${entry.focusKey}:divider`}
                                        style={{
                                            width: "1px",
                                            height: "26px",
                                            background: "rgba(255, 255, 255, 0.22)",
                                            alignSelf: "center",
                                            margin: "0 2px"
                                        }}
                                    />
                                ) : null;

                                const buttonOpacity = isDisabled
                                    ? 0.35
                                    : isSelected || isPreviewed
                                        ? 1
                                        : 0.7;

                                return (
                                    <Fragment key={entry.focusKey}>
                                        <div
                                            data-focus-key={entry.focusKey}
                                            onMouseEnter={() => {
                                                if (isDisabled) {
                                                    return;
                                                }
                                                setHoveredStripKey(entry.focusKey);
                                            }}
                                            onMouseLeave={() => setHoveredStripKey((current) => current === entry.focusKey ? null : current)}
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                width: "38px"
                                            }}
                                        >
                                            <DialogButton
                                                onClick={() => handleStripClick(entry)}
                                                onGamepadFocus={() => setFocusedStripKey(entry.focusKey)}
                                                onGamepadBlur={() => setFocusedStripKey((current) => current === entry.focusKey ? null : current)}
                                                disabled={isDisabled}
                                                style={{
                                                    minWidth: 0,
                                                    width: "38px",
                                                    height: "38px",
                                                    padding: "4px 2px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    opacity: buttonOpacity,
                                                    outline: isSelected ? "1px solid rgba(255,255,255,0.65)" : undefined,
                                                    boxShadow: isPreviewed
                                                        ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                                                        : undefined
                                                }}
                                            >
                                                <Icon size={18} />
                                            </DialogButton>
                                        </div>
                                        {divider}
                                    </Fragment>
                                );
                            })}
                        </Focusable>
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontWeight: 700,
                                textAlign: "center",
                                whiteSpace: "nowrap",
                                height: "16px",
                                opacity: 0.92
                            }}
                        >
                            {stripPreviewLabel}
                        </div>
                    </div>
                </PanelSectionRow>
                {gamepadCardActions && (
                    <PanelSectionRow>
                        <ButtonHints
                            style={controllerGlyphStyle}
                            hints={[
                                ...(sections.length > 0
                                    ? [{ button: "a" as const, label: t(language, "gn_strip_edit") }]
                                    : []),
                                { button: "y", label: t(language, "gn_new_note") },
                                ...(reorderAvailable
                                    ? [{ button: "r1" as const, label: t(language, "Reorder") }]
                                    : [])
                            ]}
                        />
                    </PanelSectionRow>
                )}
                {reorderStripEnabled && notesReady && (
                    <div style={{ marginTop: "8px" }}>
                        <ReorderStrip
                            targetId={reorderTargetId}
                            onMove={handleStripMove}
                            focusKeyPrefix="notes"
                        />
                        <div style={{ marginTop: "8px" }}>
                            <InfoText>{t(language, "reorder_help_notes")}</InfoText>
                        </div>
                    </div>
                )}
            </PanelSection>
            {renderBody()}
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

