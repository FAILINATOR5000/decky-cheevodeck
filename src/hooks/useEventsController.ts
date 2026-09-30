import { useCallback, useEffect, useRef, useState } from "react";
import {
    openEventsTab,
    refreshEventsSite,
    saveEventsPrefs,
    saveTrackedEventNote,
    saveTrackedEventOrder,
    saveTrackedEventsCollapsedTags,
    bulkTagTrackedEvents,
    saveChecklistView,
    setChecklistTick,
    setEventCompleted,
    toggleTrackedEvent,
    touchEventOpened
} from "../api";
import { logError } from "../utils/errors";
import type { ChecklistTick, ChecklistViewPrefs, EventsPrefs, EventsTabResponse, EventsUserState, EventsViewPrefs } from "../types";

const ORDER_WRITE_SETTLE_MS = 250;

let lastResponse: EventsTabResponse | null = null;

export type UseEventsControllerOptions = {
    isActive: boolean;
    activeUlid: string;
};

export function useEventsController(options: UseEventsControllerOptions) {
    const { isActive, activeUlid } = options;

    const [data, setData] = useState<EventsTabResponse | null>(() =>
        lastResponse !== null && (activeUlid === "" || lastResponse.owner === activeUlid) ? lastResponse : null
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mountedRef = useRef(true);
    const runRef = useRef(0);
    const pendingOrderRef = useRef<{ owner: string; order: string[] } | null>(null);
    const orderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    function publish(next: EventsTabResponse | null) {
        lastResponse = next;
        if (mountedRef.current) {
            setData(next);
        }
    }

    function patchUser(owner: string, change: (user: EventsUserState) => EventsUserState) {
        if (lastResponse === null || lastResponse.owner !== owner) {
            return;
        }
        publish({ ...lastResponse, user: change(lastResponse.user) });
    }

    const reload = useCallback(async (force: boolean) => {
        const run = ++runRef.current;
        setLoading(true);
        try {
            const result = await openEventsTab(force);
            if (run !== runRef.current) {
                return;
            }
            publish(result);
            if (mountedRef.current) {
                setError(result.error ?? null);
            }
        }
        catch (e) {
            logError("open events tab", e);
            if (run === runRef.current && mountedRef.current) {
                setError("Couldn't load events.");
            }
        }
        finally {
            if (run === runRef.current && mountedRef.current) {
                setLoading(false);
            }
        }

        try {
            const site = await refreshEventsSite();
            if (site.updated && run === runRef.current && mountedRef.current) {
                const refreshed = await openEventsTab(false);
                if (run === runRef.current) {
                    publish(refreshed);
                }
            }
        }
        catch (e) {
            logError("refresh events site data", e);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            flushOrder();
        };
    }, []);

    useEffect(() => {
        if (activeUlid !== "" && lastResponse !== null && lastResponse.owner !== activeUlid) {
            publish(null);
            if (isActive) {
                void reload(false);
            }
        }
    }, [activeUlid]);

    const enter = useCallback(() => {
        if (!isActive) {
            return;
        }
        void reload(false);
    }, [isActive, reload]);

    function ownerNow(): string {
        return lastResponse?.owner ?? activeUlid;
    }

    function recover(label: string, result: { ok: boolean; error?: string }) {
        if (!result.ok) {
            logError(label, result.error);
            void reload(false);
        }
    }

    function failed(label: string, e: unknown) {
        logError(label, e);
        void reload(false);
    }

    function flushOrder() {
        if (orderTimerRef.current !== null) {
            clearTimeout(orderTimerRef.current);
            orderTimerRef.current = null;
        }
        const pending = pendingOrderRef.current;
        pendingOrderRef.current = null;
        if (pending === null) {
            return;
        }
        saveTrackedEventOrder(pending.owner, pending.order)
            .then((result) => recover("save tracked event order", result))
            .catch((e) => failed("save tracked event order", e));
    }

    function toggleTracked(eventGameId: number) {
        const owner = ownerNow();
        const key = String(eventGameId);
        patchUser(owner, (user) => {
            const items = { ...user.tracked.items };
            let order = user.tracked.order;
            if (items[key]) {
                delete items[key];
                order = order.filter((id) => id !== key);
            }
            else {
                items[key] = { trackedAt: Date.now(), note: "", noteColor: "", noteEditedAt: 0 };
                order = [...order, key];
            }
            return { ...user, tracked: { ...user.tracked, items, order } };
        });
        toggleTrackedEvent(owner, eventGameId)
            .then((result) => {
                if (result.ok) {
                    patchUser(owner, (user) => ({ ...user, tracked: result.state }));
                }
                recover("toggle tracked event", result);
            })
            .catch((e) => failed("toggle tracked event", e));
    }

    function saveOrder(order: string[]) {
        const owner = ownerNow();
        patchUser(owner, (user) => ({ ...user, tracked: { ...user.tracked, order } }));
        pendingOrderRef.current = { owner, order };
        if (orderTimerRef.current !== null) {
            clearTimeout(orderTimerRef.current);
        }
        orderTimerRef.current = setTimeout(flushOrder, ORDER_WRITE_SETTLE_MS);
    }

    async function saveNote(eventGameId: number, note: string, color: string) {
        const owner = ownerNow();
        const key = String(eventGameId);
        patchUser(owner, (user) => {
            const item = user.tracked.items[key];
            if (!item) {
                return user;
            }
            const text = note.trim();
            const next = {
                ...item,
                note: text,
                noteColor: (text && color !== "default" ? color : "") as typeof item.noteColor,
                noteEditedAt: text ? Date.now() : 0
            };
            return { ...user, tracked: { ...user.tracked, items: { ...user.tracked.items, [key]: next } } };
        });
        try {
            const result = await saveTrackedEventNote(owner, eventGameId, note, color);
            if (result.ok) {
                patchUser(owner, (user) => ({ ...user, tracked: result.state }));
            }
            recover("save tracked event note", result);
        }
        catch (e) {
            failed("save tracked event note", e);
        }
    }

    function toggleCollapsed(key: string) {
        if (lastResponse === null) {
            return;
        }
        const owner = lastResponse.owner;
        const current = lastResponse.user.tracked.collapsedTags;
        const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
        patchUser(owner, (user) => ({ ...user, tracked: { ...user.tracked, collapsedTags: next } }));
        saveTrackedEventsCollapsedTags(owner, next)
            .then((result) => recover("save tracked events collapsed tags", result))
            .catch((e) => failed("save tracked events collapsed tags", e));
    }

    function setViewPrefs(view: "all" | "tracked", change: Partial<EventsViewPrefs>) {
        const owner = ownerNow();
        patchUser(owner, (user) => ({
            ...user,
            prefs: { ...user.prefs, [view]: { ...user.prefs[view], ...change } }
        }));
        saveEventsPrefs(owner, { [view]: change })
            .then((result) => {
                if (result.ok) {
                    patchUser(owner, (user) => ({ ...user, prefs: result.prefs }));
                }
                recover("save events prefs", result);
            })
            .catch((e) => failed("save events prefs", e));
    }

    function setListView(listView: EventsPrefs["listView"]) {
        const owner = ownerNow();
        patchUser(owner, (user) => ({ ...user, prefs: { ...user.prefs, listView } }));
        saveEventsPrefs(owner, { listView })
            .then((result) => recover("save events list view", result))
            .catch((e) => failed("save events list view", e));
    }

    async function setCompleted(eventGameId: number, completed: boolean) {
        const owner = ownerNow();
        const key = String(eventGameId);
        patchUser(owner, (user) => {
            const marks = { ...user.completed };
            let order = user.tracked.order;
            if (completed) {
                marks[key] = { at: Date.now() };
            }
            else {
                delete marks[key];
                if (order.includes(key)) {
                    order = [...order.filter((id) => id !== key), key];
                }
            }
            return { ...user, completed: marks, tracked: { ...user.tracked, order } };
        });
        try {
            const result = await setEventCompleted(owner, eventGameId, completed);
            if (result.ok) {
                patchUser(owner, (user) => ({ ...user, completed: result.completed, tracked: result.state }));
            }
            recover("set event completed", result);
        }
        catch (e) {
            failed("set event completed", e);
        }
    }

    function setTick(eventGameId: number, gameId: number, value: ChecklistTick | null) {
        const owner = ownerNow();
        const key = String(eventGameId);
        patchUser(owner, (user) => {
            const games = { ...(user.checklistTicks[key] ?? {}) };
            if (value === null) {
                delete games[String(gameId)];
            }
            else {
                games[String(gameId)] = value;
            }
            const ticks = { ...user.checklistTicks, [key]: games };
            if (Object.keys(games).length === 0) {
                delete ticks[key];
            }
            return { ...user, checklistTicks: ticks };
        });
        setChecklistTick(owner, eventGameId, gameId, value)
            .then((result) => recover("set checklist tick", result))
            .catch((e) => failed("set checklist tick", e));
    }

    async function bulkTag(eventGameIds: number[], tag: string) {
        const owner = ownerNow();
        try {
            const result = await bulkTagTrackedEvents(owner, eventGameIds, tag);
            if (result.ok) {
                patchUser(owner, (user) => ({ ...user, tracked: result.state }));
            }
            recover("bulk tag tracked events", result);
        }
        catch (e) {
            failed("bulk tag tracked events", e);
        }
    }

    function setChecklistView(eventGameId: number, prefs: ChecklistViewPrefs) {
        const owner = ownerNow();
        patchUser(owner, (user) => ({ ...user, checklistViews: { ...user.checklistViews, [String(eventGameId)]: prefs } }));
        saveChecklistView(owner, eventGameId, prefs.view, prefs.filter)
            .then((result) => recover("save checklist view", result))
            .catch((e) => failed("save checklist view", e));
    }

    function touchOpened(eventGameId: number, progress: { earned: number; total: number; points: number | null } | null) {
        const owner = ownerNow();
        touchEventOpened(owner, eventGameId, progress)
            .then((result) => {
                if (result.ok) {
                    patchUser(owner, (user) => ({
                        ...user,
                        activity: { ...user.activity, [String(eventGameId)]: result.activity }
                    }));
                }
            })
            .catch((e) => logError("touch event opened", e));
    }

    const state = {
        events: data?.events ?? null,
        newestSiteGameId: data?.newestSiteGameId ?? 0,
        user: data?.user ?? null,
        owner: data?.owner ?? activeUlid,
        needsSettings: data?.needsSettings ?? false,
        loading,
        error
    };

    const actions = {
        enter,
        reload,
        toggleTracked,
        saveOrder,
        saveNote,
        toggleCollapsed,
        setViewPrefs,
        setListView,
        setCompleted,
        setTick,
        setChecklistView,
        bulkTag,
        touchOpened
    };

    return { state, actions };
}
