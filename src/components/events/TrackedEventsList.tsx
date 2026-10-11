import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanelSectionRow } from "@decky/ui";
import { CollapsibleTitle } from "../ui/CollapsibleTitle";
import { InfoText } from "../ui/InfoText";
import { ReorderStrip } from "../ui/ReorderStrip";
import { ClaimedRow } from "./ClaimedRow";
import { EventNoteEditModal } from "./EventNoteEditModal";
import { EventRow, type EventRowList } from "./EventRow";
import { useEvents } from "./EventsContext";
import { EVENTS_FILTER_FOCUS_KEY, EVENTS_LIST_TOGGLE_FOCUS_KEY, EventsListHead, EventsListStatus, type EventsListProps } from "./EventsListParts";
import { prefetchGameIcons } from "../../api";
import { useFocusClaim } from "../../hooks/useFocusClaim";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { t } from "../../locales";
import type { EventCompletion, EventListRow, NoteColor, ReorderDirection } from "../../types";
import { noteBodyColor, parseNoteTag, trackedColorHex } from "../../utils/achievements";
import {
    EVENTS_COMPLETED_KEY,
    EVENTS_UNTAGGED_KEY,
    canMarkComplete,
    eventCompletion,
    eventTagKey,
    matchesTrackedShow,
    matchesType,
    nextTrackedEventsClickAction,
    sortEvents,
    trackedEventsClickActionLabel
} from "../../utils/events";
import { showManagedModal } from "../../utils/modalRegistry";
import { landOn, orderAfterGroupMove, stepTo } from "../../utils/reorderOrder";
import { orderedTagsByRecency } from "../../utils/tags";
import { achievementUiMetrics } from "../../utils/style";

const ROW_KEY_PREFIX = "events:tracked:";

const GROUP_TITLE_STYLE: React.CSSProperties = {
    width: "100%",
    padding: "24px 0 8px",
    fontSize: "16px",
    fontWeight: 600,
    lineHeight: "22px",
    letterSpacing: ".5px",
    color: "rgba(255, 255, 255, 0.7)"
};

type Section = {
    key: string;
    title: string;
    rows: EventListRow[];
    completed: boolean;
};

type FlatRow = { row: EventListRow; section: Section; indexInSection: number };

type TrackedEntry = { header: Section } | FlatRow;

function entryKey(entry: TrackedEntry): string {
    return "header" in entry ? `group:${entry.header.key}` : String(entry.row.gameId);
}

function entryFocusKey(entry: TrackedEntry): string {
    return "header" in entry ? `events:group:${entry.header.key}` : `${ROW_KEY_PREFIX}${entry.row.gameId}`;
}

const HEADER_FALLBACK = [EVENTS_FILTER_FOCUS_KEY];

export function TrackedEventsList(props: EventsListProps & {
    onListEmptied: () => void;
    lastTag: string | null;
    tagMarks: ReadonlySet<number>;
    onToggleTagMark: (eventGameId: number) => void;
}) {
    const { language } = props;
    const { state, actions, settings } = useEvents();
    const user = state.user;
    const events = state.events;
    const prefs = user?.prefs.tracked ?? { show: "all", type: "all", sort: "manual" };
    const order = user?.tracked.order ?? [];
    const items = user?.tracked.items ?? {};
    const collapsed = useMemo(() => new Set(user?.tracked.collapsedTags ?? []), [user?.tracked.collapsedTags]);

    const [heldId, setHeldId] = useState<number | null>(null);

    const completions = useMemo(() => {
        const map = new Map<number, EventCompletion>();
        for (const row of events ?? []) {
            map.set(row.gameId, eventCompletion(row, user));
        }
        return map;
    }, [events, user]);

    const sections = useMemo<Section[] | null>(() => {
        if (events === null || user === null) {
            return null;
        }
        const now = Date.now();
        const tracked = events.filter((row) =>
            user.tracked.items[String(row.gameId)] !== undefined
            && matchesType(row, prefs.type)
            && (completions.get(row.gameId) !== null || matchesTrackedShow(row, prefs.show, state.newestSiteGameId, now))
        );
        const sorted = sortEvents(tracked, events, prefs.sort, user, completions, user.tracked.order);

        const byTag = new Map<string, Section>();
        const untagged: Section = { key: EVENTS_UNTAGGED_KEY, title: "", rows: [], completed: false };
        const done: Section = { key: EVENTS_COMPLETED_KEY, title: "", rows: [], completed: true };
        for (const row of sorted) {
            if (completions.get(row.gameId)) {
                done.rows.push(row);
                continue;
            }
            const note = user.tracked.items[String(row.gameId)]?.note ?? "";
            const key = eventTagKey(note);
            if (key === EVENTS_UNTAGGED_KEY) {
                untagged.rows.push(row);
                continue;
            }
            let section = byTag.get(key);
            if (!section) {
                section = { key, title: parseNoteTag(note).tag ?? key, rows: [], completed: false };
                byTag.set(key, section);
            }
            section.rows.push(row);
        }
        const result = [...byTag.values()].sort((left, right) => left.title.localeCompare(right.title));
        if (untagged.rows.length > 0) {
            result.push(untagged);
        }
        done.rows.sort((left, right) => (completions.get(right.gameId)?.at ?? 0) - (completions.get(left.gameId)?.at ?? 0));
        if (done.rows.length > 0) {
            result.push(done);
        }
        for (const section of result) {
            if (section.key === EVENTS_UNTAGGED_KEY) {
                section.title = t(language, "Tracked ({{count}})", { count: section.rows.length });
            }
            else if (section.completed) {
                section.title = t(language, "Completed ({{count}})", { count: section.rows.length });
            }
            else {
                section.title = `${section.title} (${section.rows.length})`;
            }
        }
        return result;
    }, [events, user, completions, prefs.show, prefs.type, prefs.sort, state.newestSiteGameId, language]);

    const flat = useMemo<FlatRow[] | null>(() => {
        if (sections === null) {
            return null;
        }
        const out: FlatRow[] = [];
        for (const section of sections) {
            if (collapsed.has(section.key)) {
                continue;
            }
            section.rows.forEach((row, indexInSection) => out.push({ row, section, indexInSection }));
        }
        return out;
    }, [sections, collapsed]);

    const rowClaim = useFocusClaim();

    const entries = useMemo<TrackedEntry[]>(() => {
        const out: TrackedEntry[] = [];
        for (const section of sections ?? []) {
            out.push({ header: section });
            if (!collapsed.has(section.key)) {
                section.rows.forEach((row, indexInSection) => out.push({ row, section, indexInSection }));
            }
        }
        return out;
    }, [sections, collapsed]);

    const rowSlots = useMemo(() => {
        const slots: number[] = [];
        let slot = 0;
        for (const entry of entries) {
            slots.push("header" in entry ? -1 : slot);
            if (!("header" in entry)) {
                slot += 1;
            }
        }
        return slots;
    }, [entries]);

    const rowFallbacks = useMemo(() => {
        const bySection = new Map<string, string[]>();
        for (const section of sections ?? []) {
            bySection.set(section.key, [`events:group:${section.key}`, EVENTS_LIST_TOGGLE_FOCUS_KEY]);
        }
        return bySection;
    }, [sections]);

    const trackedWindow = useSlidingWindow({
        items: entries,
        itemKey: entryKey,
        focusKeyFor: entryFocusKey,
        windowId: "events:tracked",
        heightScope: ["events:tracked", settings.uiSize, settings.showIcons, language].join("|"),
        dynamicLoading: settings.dynamicLoading,
        initialRows: settings.dynamicInitialRows,
        rowStep: settings.dynamicRowStep,
        prefetchDistance: settings.dynamicPrefetchDistance,
        sentinelRootMarginPx: settings.dynamicSentinelRootMargin,
        resetKey: `${prefs.show}|${prefs.type}|${prefs.sort}|tracked`,
        debugLabel: "events:tracked"
    });
    const mountedItems = useMemo(
        () => trackedWindow.mountedItems.filter((entry): entry is FlatRow => !("header" in entry)),
        [trackedWindow.mountedItems]
    );
    props.landingWindowsRef.current = {
        holds: (key) => entries.some((entry) => entryFocusKey(entry) === key),
        open: (key) => trackedWindow.openAt(key)
    };

    useEffect(function prefetchEventIcons() {
        if (!settings.showIcons || mountedItems.length === 0) {
            return;
        }
        void prefetchGameIcons(mountedItems.map((entry) => ({ gameId: entry.row.gameId, imageIcon: entry.row.imageIcon })));
    }, [mountedItems, settings.showIcons]);

    const largestGroup = (sections ?? [])
        .filter((section) => !section.completed)
        .reduce((most, section) => Math.max(most, section.rows.length), 0);
    const reorderAvailable = prefs.sort === "manual" && largestGroup >= 2;

    const savedClick = settings.showClickRow ? settings.trackedClickAction : "open";
    const clickAction = savedClick === "reorder" && !reorderAvailable ? "note" : savedClick;
    const gamepad = !settings.mouseKeyboardMode;

    const holdPossible = reorderAvailable && (gamepad || clickAction === "reorder");
    useEffect(() => {
        if (!holdPossible && heldId !== null) {
            setHeldId(null);
        }
    }, [holdPossible, heldId]);

    function groupIdsFor(eventGameId: number): string[] | null {
        const section = sections?.find((entry) => !entry.completed && entry.rows.some((row) => row.gameId === eventGameId));
        return section ? section.rows.map((row) => String(row.gameId)) : null;
    }

    function moveHeld(destination: (groupOrder: string[], fromIndex: number) => number) {
        if (heldId === null) {
            return;
        }
        const groupIds = groupIdsFor(heldId);
        if (groupIds === null) {
            return;
        }
        const next = orderAfterGroupMove(order, groupIds, String(heldId), destination);
        if (next !== null) {
            actions.saveOrder(next);
        }
    }

    function untrack(row: EventListRow) {
        const position = flat?.findIndex((entry) => entry.row.gameId === row.gameId) ?? -1;
        const remaining = (flat ?? []).filter((entry) => entry.row.gameId !== row.gameId);
        if (heldId === row.gameId) {
            setHeldId(null);
        }
        actions.toggleTracked(row.gameId);
        if (remaining.length === 0) {
            props.onListEmptied();
            return;
        }
        if (position < 0) {
            return;
        }
        const removed = flat![position];
        const safe = Math.min(position, remaining.length - 1);
        const leavesGroup = safe > 0
            && removed.section.rows.length > 1
            && remaining[safe].section.key !== removed.section.key;
        const landing = leavesGroup ? safe - 1 : safe;
        if (landing !== position || removed.indexInSection === removed.section.rows.length - 1) {
            rowClaim.claimSlot(landing);
            props.onRequestFocus(`${ROW_KEY_PREFIX}${remaining[landing].row.gameId}`);
        }
    }

    function openNote(row: EventListRow) {
        const item = items[String(row.gameId)];
        if (!item) {
            return;
        }
        const allTags = orderedTagsByRecency(
            Object.values(items).map((entry) => ({ tag: parseNoteTag(entry.note).tag, at: entry.noteEditedAt }))
        );
        const completion = completions.get(row.gameId) ?? null;
        showManagedModal((close) => (
            <EventNoteEditModal
                eventTitle={row.title}
                note={item.note}
                color={item.noteColor}
                allTags={allTags}
                completed={canMarkComplete(row) ? completion?.kind === "marked" : null}
                saveNote={(note: string, color: NoteColor) => actions.saveNote(row.gameId, note, color)}
                setCompleted={(next: boolean) => actions.setCompleted(row.gameId, next)}
                close={close}
                language={language}
                defaultNoteColor={settings.defaultNoteColor}
                setDefaultNoteColor={settings.setDefaultNoteColor}
            />
        ));
    }

    function pickReorder(row: EventListRow) {
        if (!reorderAvailable || completions.get(row.gameId)) {
            return;
        }
        setHeldId((current) => (current === row.gameId ? null : row.gameId));
    }

    function handleClick(row: EventListRow) {
        if (gamepad || clickAction === "open") {
            props.onOpenEvent(row);
            return;
        }
        if (clickAction === "untrack") {
            untrack(row);
            return;
        }
        if (clickAction === "note") {
            openNote(row);
            return;
        }
        pickReorder(row);
    }

    function handleFollow(row: EventListRow) {
        if (heldId === null || heldId === row.gameId) {
            return;
        }
        moveHeld(landOn(String(row.gameId)));
    }

    const clickRef = useRef(handleClick);
    clickRef.current = handleClick;
    const untrackRef = useRef(untrack);
    untrackRef.current = untrack;
    const noteRef = useRef(openNote);
    noteRef.current = openNote;
    const pickRef = useRef(pickReorder);
    pickRef.current = pickReorder;
    const markRef = useRef(props.onToggleTagMark);
    markRef.current = props.onToggleTagMark;
    const followRef = useRef(handleFollow);
    followRef.current = handleFollow;
    const focusRef = useRef(trackedWindow.onItemFocus);
    focusRef.current = trackedWindow.onItemFocus;

    const metrics = useMemo(() => achievementUiMetrics(settings.uiSize), [settings.uiSize]);
    const list = useMemo<EventRowList>(() => ({
        language,
        showIcons: settings.showIcons,
        metrics,
        trackedBarColor: trackedColorHex(settings.trackedColor),
        newestSiteGameId: state.newestSiteGameId,
        focusKeyPrefix: ROW_KEY_PREFIX,
        secondaryUntracks: true,
        onFocusIndex: (index) => focusRef.current(index),
        onClick: (row) => clickRef.current(row),
        onSecondary: gamepad ? (row) => untrackRef.current(row) : undefined,
        onOptions: gamepad ? (row) => noteRef.current(row) : undefined,
        onReorderPick: gamepad && reorderAvailable ? (row) => pickRef.current(row) : undefined,
        onReorderToward: gamepad && reorderAvailable ? (row) => followRef.current(row) : undefined,
        onTagMark: gamepad && props.lastTag !== null ? (row) => markRef.current(row.gameId) : undefined
    }), [language, settings.showIcons, metrics, settings.trackedColor, state.newestSiteGameId, gamepad, reorderAvailable, props.lastTag]);

    const clickRow = settings.showClickRow
        ? {
            value: trackedEventsClickActionLabel(clickAction, language),
            onCycle: () => void settings.saveTrackedClickAction(
                nextTrackedEventsClickAction(clickAction, reorderAvailable)
            )
        }
        : null;

    const rendered = trackedWindow.mountedItems.map((entry, offset) => {
        const index = trackedWindow.start + offset;
        if ("header" in entry) {
            const section = entry.header;
            return (
                <PanelSectionRow key={`events:section:${section.key}`}>
                    <div style={GROUP_TITLE_STYLE}>
                        <CollapsibleTitle
                            label={section.title}
                            collapsed={collapsed.has(section.key)}
                            focusKey={`events:group:${section.key}`}
                            focusFallback={HEADER_FALLBACK}
                            disabled={heldId !== null}
                            preserveCase={settings.trackedHeaderStyle === "typed"}
                            onToggle={() => actions.toggleCollapsed(section.key)}
                            onGamepadFocus={() => focusRef.current(index)}
                            onGamepadDirection={trackedWindow.guardTopRow(index)}
                        />
                    </div>
                </PanelSectionRow>
            );
        }
        const { row, section } = entry;
        const slot = rowSlots[index];
        const item = items[String(row.gameId)];
        const parsed = parseNoteTag(item?.note ?? "");
        const noteText = section.completed ? (item?.note ?? "") : parsed.body.trim();
        return (
            <ClaimedRow key={`events:tracked:slot:${slot}`} claim={rowClaim} slotIndex={slot}>
                <EventRow
                    row={row}
                    index={index}
                    list={list}
                    marked={false}
                    completion={completions.get(row.gameId) ?? null}
                    progress={user?.activity[String(row.gameId)]?.lastProgress ?? null}
                    noteText={noteText}
                    noteColor={item?.noteColor ? noteBodyColor(item.noteColor) : undefined}
                    isReorderTarget={heldId === row.gameId}
                    isTagMarked={props.tagMarks.has(row.gameId)}
                    focusFallback={rowFallbacks.get(section.key)}
                    onGamepadDirection={trackedWindow.guardTopRow(index)}
                />
            </ClaimedRow>
        );
    });

    const reordering = !gamepad && clickAction === "reorder" && reorderAvailable;

    return (
        <>
            <EventsListHead
                language={language}
                filterValue={props.filterValue}
                onOpenFilter={props.onOpenFilter}
                clickRow={clickRow}
                hints={[
                    { button: "a", label: t(language, "View Info") },
                    { button: "x", label: t(language, "Untrack") },
                    { button: "y", label: t(language, "Note & Tag") },
                    ...(reorderAvailable ? [{ button: "r1" as const, label: t(language, "Reorder") }] : []),
                    ...(props.lastTag !== null ? [{ button: "l1" as const, label: props.lastTag }] : [])
                ]}
            />
            {reordering && (
                <div style={{ marginTop: "8px", marginBottom: "16px" }}>
                    <ReorderStrip
                        targetId={heldId}
                        focusKeyPrefix="events"
                        onMove={(direction: ReorderDirection) => moveHeld(stepTo<string>(direction))}
                    />
                    <PanelSectionRow>
                        <div style={{ marginTop: "8px" }}>
                            <InfoText>{t(language, "reorder_help_events")}</InfoText>
                        </div>
                    </PanelSectionRow>
                </div>
            )}
            <EventsListStatus
                language={language}
                empty={sections !== null && sections.length === 0}
                emptyText={Object.keys(items).length === 0
                    ? t(language, "No tracked events yet.")
                    : t(language, "No events match these filters.")}
            />
            <SlidingWindowRows list={trackedWindow}>{rendered}</SlidingWindowRows>
        </>
    );
}
