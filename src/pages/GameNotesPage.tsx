import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { BackButton } from "../components/ui/BackButton";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { InfoText } from "../components/ui/InfoText";
import { NoteCard, type NoteCardListProps } from "../components/notes/NoteCard";
import { ReorderStrip } from "../components/ui/ReorderStrip";
import { ButtonHints } from "../components/ui/ButtonHints";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    ControllerGlyphStyle,
    GameNote,
    GameNoteAButtonMode,
    GameNoteSortMode,
    Payload,
    ReorderDirection,
    UiSize,
    ViewKey
} from "../types";
import { parseNoteTag } from "../utils/achievements";
import { achievementUiMetrics, smallTextStyle, bodyTextStyle } from "../utils/style";
import { useWindowedList } from "../hooks/useWindowedList";

type GameNotesPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    uiSize: UiSize;
    focusScopeResetToken: number;
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
    dynamicSentinelRootMargin: number;
    gameIconDataUri: string | null;
    gameIconCold: boolean;
    showIcons: boolean;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
};

type GameNotesPageActions = {
    onBack: () => void | Promise<void>;
    onAddNote: () => void;
    onEditNote: (note: GameNote) => void;
    onSortModeChange: (next: GameNoteSortMode) => void | Promise<unknown>;
    onAButtonModeChange: (next: GameNoteAButtonMode) => void | Promise<unknown>;
    onReorderSwap: (pressedId: string, sectionIds: string[] | null, allowSwap?: boolean) => void | Promise<unknown>;
    onReorderMove: (direction: ReorderDirection, sectionIds?: string[] | null) => void | Promise<unknown>;
    onCardFocused: (noteId: string) => void | Promise<unknown>;
    onHome: () => void | Promise<void>;
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

function PencilIcon({ size = 18 }: StripIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 481.2C-1.5 489.7 .8 498.8 7 505s15.3 8.5 23.7 6.1l120.3-35.4c14.1-4.2 27-11.8 37.4-22.2L421.7 220.3 291.7 90.3z" />
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

function ArrowDownWideShortIcon({ size = 18 }: StripIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M151.6 469.6c-4.2 4.2-10 6.6-16 6.6s-11.8-2.4-16-6.6l-128-128c-8.8-8.8-8.8-23.2 0-32s23.2-8.8 32 0L112 397.3V64c0-12.5 10.7-23 23.2-23s23.2 10.5 23.2 23l1.4 333.4 88.4-87.8c8.8-8.8 23.2-8.8 32 0s8.8 23.2 0 32l-128 128zM320 480c-17.7 0-32-14.3-32-32s14.3-32 32-32h32c17.7 0 32 14.3 32 32s-14.3 32-32 32H320zm0-128c-17.7 0-32-14.3-32-32s14.3-32 32-32H448c17.7 0 32 14.3 32 32s-14.3 32-32 32H320zm0-128c-17.7 0-32-14.3-32-32s14.3-32 32-32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H320zm0-128c-17.7 0-32-14.3-32-32s14.3-32 32-32h64c17.7 0 32 14.3 32 32s-14.3 32-32 32H320z" />
        </svg>
    );
}

function ArrowUpShortWideIcon({ size = 18 }: StripIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M151.6 42.4c-4.2-4.2-10-6.6-16-6.6s-11.8 2.4-16 6.6l-128 128c-8.8 8.8-8.8 23.2 0 32s23.2 8.8 32 0L112 114.5V448c0 12.5 10.7 23 23.2 23s23.2-10.5 23.2-23l1.4-333.4 88.4 87.8c8.8 8.8 23.2 8.8 32 0s8.8-23.2 0-32l-128-128zM320 96c-17.7 0-32-14.3-32-32s14.3-32 32-32h32c17.7 0 32 14.3 32 32s-14.3 32-32 32H320zm0 128c-17.7 0-32-14.3-32-32s14.3-32 32-32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H320zm0 128c-17.7 0-32-14.3-32-32s14.3-32 32-32H448c17.7 0 32 14.3 32 32s-14.3 32-32 32H320zm0 128c-17.7 0-32-14.3-32-32s14.3-32 32-32h64c17.7 0 32 14.3 32 32s-14.3 32-32 32H320z" />
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

type NoteSection = {
    tag: string | null;
    tagKey: string | null;
    orderedNotes: GameNote[];
    isCompleted?: boolean;
};

function buildNoteSections(notes: GameNote[], sortMode: GameNoteSortMode): NoteSection[] {
    const byKey = new Map<string, NoteSection>();
    const untagged: NoteSection = {
        tag: null,
        tagKey: null,
        orderedNotes: []
    };
    const completed: NoteSection = {
        tag: null,
        tagKey: null,
        orderedNotes: [],
        isCompleted: true
    };

    for (const note of notes) {
        if (note.completedAt !== null) {
            completed.orderedNotes.push(note);
            continue;
        }
        const parsed = parseNoteTag(note.body);
        if (parsed.tagKey === null) {
            untagged.orderedNotes.push(note);
            continue;
        }
        let section = byKey.get(parsed.tagKey);
        if (!section) {
            section = {
                tag: parsed.tag,
                tagKey: parsed.tagKey,
                orderedNotes: []
            };
            byKey.set(parsed.tagKey, section);
        }
        section.orderedNotes.push(note);
    }

    function sortWithin(list: GameNote[]) {
        if (sortMode === "manual") {
            list.sort((a, b) => a.manualOrder - b.manualOrder);
            return;
        }
        if (sortMode === "oldest") {
            list.sort((a, b) => a.createdAt - b.createdAt);
            return;
        }
        list.sort((a, b) => b.createdAt - a.createdAt);
    }

    sortWithin(untagged.orderedNotes);
    for (const section of byKey.values()) {
        sortWithin(section.orderedNotes);
    }
    completed.orderedNotes.sort((a, b) => {
        const aAt = a.completedAt ?? 0;
        const bAt = b.completedAt ?? 0;
        return bAt - aAt;
    });

    function sectionRank(section: NoteSection): number {
        if (section.orderedNotes.length === 0) {
            return Number.POSITIVE_INFINITY;
        }
        if (sortMode === "manual") {
            return section.orderedNotes[0].manualOrder;
        }
        if (sortMode === "oldest") {
            return section.orderedNotes[0].createdAt;
        }
        return -section.orderedNotes[0].createdAt;
    }

    const taggedSections = Array.from(byKey.values()).filter(
        (s) => s.orderedNotes.length > 0
    );
    taggedSections.sort((a, b) => sectionRank(a) - sectionRank(b));

    const ordered: NoteSection[] = taggedSections;
    if (untagged.orderedNotes.length > 0) {
        ordered.push(untagged);
    }
    if (completed.orderedNotes.length > 0) {
        ordered.push(completed);
    }
    return ordered;
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
        focusScopeResetToken,
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
        dynamicSentinelRootMargin,
        gameIconDataUri,
        gameIconCold,
        showIcons,
        mouseKeyboardMode,
        controllerGlyphStyle
    } = state;

    const gameId = gameNotesGameId ?? payload?.gameId ?? null;

    const sections = useMemo(
        () => buildNoteSections(notes, sortMode),
        [notes, sortMode]
    );

    const flatOrderedIds = useMemo(() => {
        const ids: string[] = [];
        for (const section of sections) {
            for (const note of section.orderedNotes) {
                ids.push(note.id);
            }
        }
        return ids;
    }, [sections]);

    const sentinelRootMargin = `${Math.max(0, dynamicSentinelRootMargin)}px 0px`;

    const {
        mountedItems: mountedNoteIds,
        markerRef: loadMoreMarkerRef
    } = useWindowedList({
        items: flatOrderedIds,
        dynamicLoading,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: 0,
        sentinelRootMargin,
        resetKey: `${gameId}|${sortMode}`
    });

    const mountedIdSet = useMemo(() => {
        if (!dynamicLoading) {
            return null;
        }
        return new Set(mountedNoteIds);
    }, [dynamicLoading, mountedNoteIds]);

    const cardClickRef = useRef(handleCardClick);
    cardClickRef.current = handleCardClick;
    const cardFocusedRef = useRef(actions.onCardFocused);
    cardFocusedRef.current = actions.onCardFocused;
    const cardNewNoteRef = useRef(actions.onAddNote);
    cardNewNoteRef.current = actions.onAddNote;
    const cardReorderPickRef = useRef(handleCardReorderPick);
    cardReorderPickRef.current = handleCardReorderPick;
    const cardReorderNudgeRef = useRef(handleStripMove);
    cardReorderNudgeRef.current = handleStripMove;

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
        onNewNote: gamepadCardActions
            ? () => {
                cardNewNoteRef.current();
            }
            : undefined,
        onReorderPick: gamepadCardActions && reorderAvailable
            ? (note) => {
                cardReorderPickRef.current(note);
            }
            : undefined,
        onReorderNudge: gamepadCardActions && reorderAvailable
            ? (direction) => {
                cardReorderNudgeRef.current(direction);
            }
            : undefined
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

    function handleStripMove(direction: ReorderDirection) {
        const sectionIds = sectionIdsForReorderTarget(sections, reorderTargetId);
        void actions.onReorderMove(direction, sectionIds);
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

        return (
            <div ref={cardListRef}>
                {sections.map((section) => {
                    const cards = mountedIdSet
                        ? section.orderedNotes.filter((n) => mountedIdSet.has(n.id))
                        : section.orderedNotes;
                    if (cards.length === 0) {
                        return null;
                    }

                    const sectionKey = section.isCompleted
                        ? "_completed_"
                        : (section.tagKey ?? "_untagged_");
                    const sectionTitle = section.isCompleted
                        ? t(language, "Completed")
                        : section.tagKey === null
                            ? t(language, "Notes")
                            : (section.tag ?? "");

                    return (
                        <PanelSection key={`gn:section:${sectionKey}`} title={sectionTitle}>
                            {cards.map((note, index) => (
                                <NoteCard
                                    key={index}
                                    note={note}
                                    focusKey={`gn:card:${note.id}`}
                                    isReorderTarget={reorderTargetId === note.id}
                                    firing={note.showFiredDot}
                                    list={cardList}
                                />
                            ))}
                        </PanelSection>
                    );
                })}
                {dynamicLoading && mountedNoteIds.length < flatOrderedIds.length && (
                    <div ref={loadMoreMarkerRef} style={{ height: "1px" }} />
                )}
            </div>
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

    return (
        <>
            <PanelSection
                key={`game-notes:view:${focusScopeResetToken}`}
            >
                <PageNavStrip
                    title={t(language, "Game Notes")}
                    buttonSpacing={buttonSpacing}
                    onHome={actions.onHome}
                />
                <BackButton
                    label={t(language, "← Back to Main")}
                    focusKey="gn:back"
                    navAutoFocus
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
                                                    boxShadow: isSelected
                                                        ? "0 0 0 2px rgba(120, 200, 255, 0.85), 0 2px 8px rgba(0,0,0,0.35)"
                                                        : isPreviewed
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
                {gamepadCardActions && sections.length > 0 && (
                    <PanelSectionRow>
                        <ButtonHints
                            style={controllerGlyphStyle}
                            hints={[
                                { button: "a", label: t(language, "gn_strip_edit") },
                                { button: "y", label: t(language, "gn_new_note") },
                                ...(reorderAvailable
                                    ? [{ button: "r1" as const, label: t(language, "Reorder") }]
                                    : [])
                            ]}
                        />
                    </PanelSectionRow>
                )}
                {
}
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
        </>
    );
}

