import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DialogButton, Focusable } from "@decky/ui";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaList, FaTag, FaThumbtack } from "react-icons/fa";
import { ButtonPrompt } from "../ui/ButtonPrompt";
import { ClaimedRow } from "./ClaimedRow";
import { EventRow, type EventRowList } from "./EventRow";
import { EventsFilterModal } from "./EventsFilterModal";
import {
    EVENTS_FILTER_FOCUS_KEY,
    EVENTS_LIST_TOGGLE_FOCUS_KEY,
    EventsListHead,
    EventsListStatus,
    useEventsRestore,
    type EventsListProps
} from "./EventsListParts";
import { TrackedEventsList } from "./TrackedEventsList";
import { useEvents } from "./EventsContext";
import { prefetchGameIcons } from "../../api";
import { useFocusClaim } from "../../hooks/useFocusClaim";
import { useWindowedList } from "../../hooks/useWindowedList";
import { t, type LanguageCode } from "../../locales";
import type { EventCompletion, EventListRow, EventsListView } from "../../types";
import { parseNoteTag, trackedColorHex } from "../../utils/achievements";
import {
    eventCompletion,
    eventsClickActionLabel,
    eventsPrefsSummary,
    matchesShow,
    matchesType,
    nextEventsClickAction,
    sortEvents
} from "../../utils/events";
import { armEventsFocusKey, armEventsRowReturn, type EventsFocusReturn } from "../../utils/eventsFocusReturn";
import { showManagedModal } from "../../utils/modalRegistry";
import { playOkSound } from "../../utils/navSound";
import { orderedTagsByRecency } from "../../utils/tags";
import { achievementUiMetrics, smallTextStyle } from "../../utils/style";
import { textSize } from "../../utils/scale";

const EVENTS_AOTW_FOCUS_KEY = "events:header:aotw";
const EVENTS_APPLY_TAG_FOCUS_KEY = "events:header:applytag";

const HEADER_CLAIM_SLOTS: Record<string, number> = {
    [EVENTS_LIST_TOGGLE_FOCUS_KEY]: -3,
    [EVENTS_AOTW_FOCUS_KEY]: -4
};

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function MedalIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M223.75 130.75L154.62 15.54A31.997 31.997 0 0 0 127.18 0H16.03C3.08 0-4.5 14.57 2.92 25.18l111.27 158.96c29.72-27.77 67.52-46.83 109.56-53.39zM495.97 0H384.82c-11.24 0-21.66 5.9-27.44 15.54l-69.13 115.21c42.04 6.56 79.84 25.62 109.56 53.38L509.08 25.18C516.5 14.57 508.92 0 495.97 0zM256 160c-97.2 0-176 78.8-176 176s78.8 176 176 176 176-78.8 176-176-78.8-176-176-176zm92.52 157.26l-37.93 36.96 8.97 52.22c1.6 9.36-8.26 16.51-16.65 12.09L256 393.88l-46.9 24.65c-8.4 4.45-18.25-2.74-16.65-12.09l8.97-52.22-37.93-36.96c-6.82-6.64-3.05-18.23 6.35-19.59l52.43-7.64 23.43-47.52c2.11-4.28 6.19-6.39 10.28-6.39 4.11 0 8.22 2.14 10.33 6.39l23.43 47.52 52.43 7.64c9.4 1.36 13.17 12.95 6.35 19.59z" />
        </svg>
    );
}


export type EventsTabBodyProps = {
    language: LanguageCode;
    restore: EventsFocusReturn | null;
    onRestoreSettled: (abandoned?: boolean) => void;
    onOpenEvent?: (eventGameId: number) => void;
    onOpenAotw?: () => void;
    onRequestFocus: (focusKey: string) => void;
    onListEmptied: () => void;
};

export function EventsTabBody(props: EventsTabBodyProps) {
    const { language, restore } = props;
    const { state, actions, settings } = useEvents();
    const listView: EventsListView = state.user?.prefs.listView ?? "all";

    useEffect(() => {
        actions.enter();
    }, [actions.enter]);

    const headerSlot = restore !== null && restore.eventGameId === null
        ? HEADER_CLAIM_SLOTS[restore.focusKey]
        : undefined;
    const listRestore = headerSlot === undefined ? restore : null;
    const headerClaim = useFocusClaim();
    const headerFiredRef = useRef(false);
    useEffect(() => {
        if (headerSlot === undefined || headerFiredRef.current || restore === null) {
            return;
        }
        headerFiredRef.current = true;
        headerClaim.claimSlot(headerSlot);
        props.onRequestFocus(restore.focusKey);
    }, [headerSlot]);
    const headerSpent = headerFiredRef.current && (headerClaim.claim?.token ?? 0) > 0 && !headerClaim.claim?.armed;
    useEffect(() => {
        if (headerSpent) {
            props.onRestoreSettled();
        }
    }, [headerSpent]);

    function openAotw() {
        if (!props.onOpenAotw) {
            return;
        }
        armEventsFocusKey(EVENTS_AOTW_FOCUS_KEY, listView);
        props.onOpenAotw();
    }

    function openFilter() {
        const user = state.user;
        if (user === null) {
            return;
        }
        armEventsFocusKey(EVENTS_FILTER_FOCUS_KEY, listView);
        showManagedModal((close) => (
            <EventsFilterModal
                view={listView}
                prefs={user.prefs[listView]}
                showUnscanned={(state.events ?? []).some((row) => !row.hasSiteData)}
                language={language}
                onChange={(change) => actions.setViewPrefs(listView, change)}
                close={close}
            />
        ));
    }

    function toggleListView() {
        playOkSound();
        actions.setListView(listView === "all" ? "tracked" : "all");
    }

    function openEvent(row: EventListRow, focusKey: string) {
        if (!props.onOpenEvent) {
            return;
        }
        armEventsRowReturn(row.gameId, listView, focusKey, state.owner);
        props.onOpenEvent(row.gameId);
    }

    const filterValue = state.user ? eventsPrefsSummary(state.user.prefs[listView], language) : "";

    const items = state.user?.tracked.items;
    const lastTag = useMemo(() => orderedTagsByRecency(
        Object.values(items ?? {}).map((entry) => ({ tag: parseNoteTag(entry.note).tag, at: entry.noteEditedAt }))
    )[0] ?? null, [items]);
    const [tagMarks, setTagMarks] = useState<ReadonlySet<number>>(() => new Set<number>());
    const [applyingTag, setApplyingTag] = useState(false);
    const markedIds = [...tagMarks].filter((id) => items?.[String(id)] !== undefined);
    const canApplyTag = listView === "tracked" && lastTag !== null && markedIds.length > 0 && !applyingTag;

    function toggleTagMark(eventGameId: number) {
        setTagMarks((current) => {
            const next = new Set(current);
            if (next.has(eventGameId)) {
                next.delete(eventGameId);
            }
            else {
                next.add(eventGameId);
            }
            return next;
        });
    }

    async function applyTag() {
        if (!canApplyTag || lastTag === null) {
            return;
        }
        playOkSound();
        setApplyingTag(true);
        await actions.bulkTag(markedIds, lastTag);
        setTagMarks(new Set<number>());
        setApplyingTag(false);
    }

    const [focusedHeaderKey, setFocusedHeaderKey] = useState<string | null>(null);

    function headerCaption(): ReactNode {
        switch (focusedHeaderKey) {
            case EVENTS_LIST_TOGGLE_FOCUS_KEY:
                return listView === "tracked" ? t(language, "View All Events") : t(language, "View Tracked Events");
            case EVENTS_AOTW_FOCUS_KEY:
                return t(language, "Achievement of the Week");
            case EVENTS_APPLY_TAG_FOCUS_KEY:
                if (lastTag === null) {
                    return t(language, "Give an event a tag first");
                }
                if (markedIds.length === 0) {
                    return (
                        <ButtonPrompt
                            language={language}
                            textKey="Mark events with {{button}} first"
                            button="l1"
                            fontSize={12}
                        />
                    );
                }
                return t(language, "Apply {{tag}} ({{count}})", { tag: lastTag, count: markedIds.length });
            default:
                return null;
        }
    }
    const caption = headerCaption();

    function renderHeaderButton(focusKey: string, icon: ReactNode, onClick: () => void, dimmed = false) {
        const focused = focusedHeaderKey === focusKey;
        return (
            <div data-focus-key={focusKey} style={{ display: "flex" }}>
                <DialogButton
                    onClick={onClick}
                    disabled={state.user === null}
                    onGamepadFocus={() => setFocusedHeaderKey(focusKey)}
                    onGamepadBlur={() => setFocusedHeaderKey((current) => current === focusKey ? null : current)}
                    onMouseEnter={() => setFocusedHeaderKey(focusKey)}
                    onMouseLeave={() => setFocusedHeaderKey((current) => current === focusKey ? null : current)}
                    style={{
                        minWidth: 0,
                        width: "30px",
                        height: "30px",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: dimmed ? 0.35 : focused ? 1 : 0.8,
                        boxShadow: focused
                            ? "0 0 0 2px rgba(255, 255, 255, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)"
                            : undefined
                    }}
                >
                    {icon}
                </DialogButton>
            </div>
        );
    }

    return (
        <>
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    margin: "6px 0 4px 0"
                }}
            >
                <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 800 }}>
                    {listView === "tracked" ? t(language, "Tracked Events") : t(language, "Events")}
                </div>
                <Focusable flow-children="row" style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    {listView === "tracked" && !settings.mouseKeyboardMode && renderHeaderButton(
                        EVENTS_APPLY_TAG_FOCUS_KEY,
                        <FaTag size={16} />,
                        () => void applyTag(),
                        !canApplyTag
                    )}
                    <ClaimedRow claim={headerClaim} slotIndex={HEADER_CLAIM_SLOTS[EVENTS_LIST_TOGGLE_FOCUS_KEY]}>
                        {renderHeaderButton(
                            EVENTS_LIST_TOGGLE_FOCUS_KEY,
                            listView === "tracked" ? <FaList size={16} /> : <FaThumbtack size={16} />,
                            toggleListView
                        )}
                    </ClaimedRow>
                    {props.onOpenAotw && (
                        <ClaimedRow claim={headerClaim} slotIndex={HEADER_CLAIM_SLOTS[EVENTS_AOTW_FOCUS_KEY]}>
                            {renderHeaderButton(EVENTS_AOTW_FOCUS_KEY, <MedalIcon size={16} />, openAotw)}
                        </ClaimedRow>
                    )}
                </Focusable>
            </div>
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
            <Focusable key={`events:list:${listView}`} style={{ width: "100%" }}>
                {listView === "all" ? (
                    <AllEventsList
                        language={language}
                        restore={listRestore}
                        filterValue={filterValue}
                        onOpenFilter={openFilter}
                        onOpenEvent={openEvent}
                        onRestoreSettled={props.onRestoreSettled}
                        onRequestFocus={props.onRequestFocus}
                    />
                ) : (
                    <TrackedEventsList
                        language={language}
                        lastTag={lastTag}
                        tagMarks={tagMarks}
                        onToggleTagMark={toggleTagMark}
                        restore={listRestore}
                        filterValue={filterValue}
                        onOpenFilter={openFilter}
                        onOpenEvent={openEvent}
                        onRestoreSettled={props.onRestoreSettled}
                        onRequestFocus={props.onRequestFocus}
                        onListEmptied={props.onListEmptied}
                    />
                )}
            </Focusable>
        </>
    );
}

function AllEventsList(props: EventsListProps) {
    const { language } = props;
    const { state, actions, settings } = useEvents();
    const prefs = state.user?.prefs.all ?? { show: "all", type: "all", sort: "latest" };
    const events = state.events;
    const user = state.user;

    const completions = useMemo(() => {
        const map = new Map<number, EventCompletion>();
        for (const row of events ?? []) {
            map.set(row.gameId, eventCompletion(row, user));
        }
        return map;
    }, [events, user]);

    const sorted = useMemo(() => {
        if (events === null) {
            return null;
        }
        const now = Date.now();
        const kept = events.filter((row) =>
            matchesShow(row, prefs.show, completions.get(row.gameId) ?? null, state.newestSiteGameId, now)
            && matchesType(row, prefs.type)
        );
        return sortEvents(kept, events, prefs.sort, user, completions, null);
    }, [events, user, completions, prefs.show, prefs.type, prefs.sort, state.newestSiteGameId]);

    const rowClaim = useFocusClaim();
    const filterClaim = useFocusClaim();
    const sortedIds = useMemo(() => (sorted === null ? null : sorted.map((row) => row.gameId)), [sorted]);
    const seedRows = useEventsRestore({
        restore: props.restore,
        listView: "all",
        ready: user !== null,
        ids: sortedIds,
        rowStep: settings.dynamicRowStep,
        rowKeyPrefix: "events:row:",
        rowClaim,
        filterClaim,
        onSettled: props.onRestoreSettled,
        onRequestFocus: props.onRequestFocus
    });

    const { mountedItems, markerRef, onItemFocus } = useWindowedList({
        items: sorted ?? [],
        dynamicLoading: settings.dynamicLoading,
        initialRows: settings.dynamicInitialRows,
        rowStep: settings.dynamicRowStep,
        prefetchDistance: settings.dynamicPrefetchDistance,
        sentinelRootMargin: `${settings.dynamicSentinelRootMargin}px 0px`,
        resetKey: `${prefs.show}|${prefs.type}|${prefs.sort}|all`,
        seedRows
    });

    useEffect(function prefetchEventIcons() {
        if (!settings.showIcons || mountedItems.length === 0) {
            return;
        }
        void prefetchGameIcons(mountedItems.map((row) => ({ gameId: row.gameId, imageIcon: row.imageIcon })));
    }, [mountedItems, settings.showIcons]);

    const clickAction = settings.showClickRow ? settings.clickAction : "open";
    const gamepad = !settings.mouseKeyboardMode;

    const openRef = useRef(props.onOpenEvent);
    openRef.current = props.onOpenEvent;
    const clickRef = useRef(clickAction);
    clickRef.current = clickAction;
    const focusRef = useRef(onItemFocus);
    focusRef.current = onItemFocus;
    const toggleRef = useRef(actions.toggleTracked);
    toggleRef.current = actions.toggleTracked;

    const metrics = useMemo(() => achievementUiMetrics(settings.uiSize), [settings.uiSize]);
    const list = useMemo<EventRowList>(() => ({
        language,
        showIcons: settings.showIcons,
        metrics,
        trackedBarColor: trackedColorHex(settings.trackedColor),
        newestSiteGameId: state.newestSiteGameId,
        focusKeyPrefix: "events:row:",
        onFocusIndex: (index) => focusRef.current(index),
        onClick: (row) => {
            if (clickRef.current === "track" && !gamepad) {
                toggleRef.current(row.gameId);
                return;
            }
            openRef.current(row, `events:row:${row.gameId}`);
        },
        onSecondary: gamepad ? (row) => toggleRef.current(row.gameId) : undefined
    }), [language, settings.showIcons, metrics, settings.trackedColor, state.newestSiteGameId, gamepad]);

    const trackedItems = user?.tracked.items ?? {};

    return (
        <>
            <EventsListHead
                language={language}
                filterValue={props.filterValue}
                onOpenFilter={props.onOpenFilter}
                filterClaim={filterClaim}
                clickRow={settings.showClickRow
                    ? {
                        value: eventsClickActionLabel(settings.clickAction, language),
                        onCycle: () => void settings.saveClickAction(nextEventsClickAction(settings.clickAction))
                    }
                    : null}
                hints={[
                    { button: "a", label: t(language, "View Info") },
                    { button: "x", label: t(language, "Track") }
                ]}
            />
            <EventsListStatus
                language={language}
                empty={sorted !== null && sorted.length === 0}
                emptyText={t(language, "No events match these filters.")}
            />
            {mountedItems.map((row, index) => (
                <ClaimedRow key={`events:slot:${index}`} claim={rowClaim} slotIndex={index}>
                    <EventRow
                        row={row}
                        index={index}
                        list={list}
                        marked={Boolean(trackedItems[String(row.gameId)])}
                        completion={completions.get(row.gameId) ?? null}
                        progress={user?.activity[String(row.gameId)]?.lastProgress ?? null}
                        noteText=""
                        isReorderTarget={false}
                    />
                </ClaimedRow>
            ))}
            {sorted !== null && mountedItems.length < sorted.length && (
                <div ref={markerRef} style={{ height: "1px" }} />
            )}
        </>
    );
}
