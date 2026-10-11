import { useInsertionEffect, useLayoutEffect, type RefObject } from "react";
import { logFocusDebug } from "./api";
import { initialNav, rehydrateNav, settleNav, type NavIntent, type NavState, type Route } from "./nav";
import type { ViewKey } from "./types";
import { consumeModalCloseArm } from "./utils/modalRegistry";

type FocusRecord = {
    accountUlid: string;
    subject: string | null;
    tabPath: string[];
    focusKey: string | null;
    fallbacks: string[];
};

type SubView = { kind: string; subject: string | null };

type SubEntry = SubView & { record: FocusRecord | null };

type TrailEntry = { id: number; view: ViewKey; record: FocusRecord | null; sub: SubEntry[] };

type MountReason = "modalReturn" | "qamOpen" | "panelEntry" | "boot";

type PageRegistration = { subject: string | null; tabPath: string[] };

type Resolved = { focusKey: string | null; fallbacks: string[] };

const LANDING_VIEWS: ReadonlySet<ViewKey> = new Set<ViewKey>();

let trail: NavState | null = null;
let entries = new Map<Route, TrailEntry>();
let nextEntryId = 1;

let generation = 0;
let restoredGeneration = 0;
let liveGeneration = 0;
let preRestore: NavState = initialNav("achievements");
let mountedFromModal = false;
let panelEntryMarked = false;

let rootElement: HTMLElement | null = null;
let accountUlid = "";
let setupShowing = false;
let pendingEntryId: number | null = null;

const pages = new Map<ViewKey, PageRegistration>();

function freshEntry(route: Route): TrailEntry {
    const entry: TrailEntry = { id: nextEntryId, view: route.view, record: null, sub: [] };
    nextEntryId += 1;
    return entry;
}

function adopt(state: NavState): TrailEntry[] {
    const next = new Map<Route, TrailEntry>();
    const list = state.stack.map((route) => {
        const entry = entries.get(route) ?? freshEntry(route);
        next.set(route, entry);
        return entry;
    });
    entries = next;
    trail = state;
    return list;
}

function topEntry(): TrailEntry | null {
    if (!trail) {
        return null;
    }
    const route = trail.stack[trail.stack.length - 1];
    return route ? entries.get(route) ?? null : null;
}

function nameEntry(entry: TrailEntry): string {
    const level = entry.sub[entry.sub.length - 1];
    return level ? `${entry.id}:${entry.view}/${level.kind}` : `${entry.id}:${entry.view}`;
}

function topRecord(entry: TrailEntry): FocusRecord | null {
    const level = entry.sub[entry.sub.length - 1];
    return level ? level.record : entry.record;
}

function describeRecord(record: FocusRecord | null): string {
    if (!record) {
        return "(none)";
    }
    const parts = [record.focusKey ?? "(keyless)"];
    if (record.fallbacks.length > 0) {
        parts.push(`fallbacks=${record.fallbacks.join(",")}`);
    }
    if (record.subject != null) {
        parts.push(`subject=${record.subject}`);
    }
    if (record.tabPath.length > 0) {
        parts.push(`tab=${record.tabPath.join("/")}`);
    }
    if (record.accountUlid !== accountUlid) {
        parts.push(`account=${record.accountUlid || "(none)"}`);
    }
    return parts.join(" ");
}

function describeTrail(list: TrailEntry[]): string {
    return list.map(nameEntry).join(" > ");
}

function countRecords(list: Iterable<TrailEntry>): number {
    let count = 0;
    for (const entry of list) {
        if (entry.record) {
            count += 1;
        }
        count += entry.sub.filter((level) => level.record).length;
    }
    return count;
}

function resolve(element: Element, root: HTMLElement): Resolved | null {
    const off = element.closest("[data-focus-record=\"off\"]");
    if (off && root.contains(off)) {
        return null;
    }
    const as = element.closest("[data-focus-record-as]");
    if (as && root.contains(as)) {
        return { focusKey: as.getAttribute("data-focus-record-as"), fallbacks: [] };
    }
    const keyed = element.closest("[data-focus-key]");
    if (!keyed || !root.contains(keyed)) {
        return { focusKey: null, fallbacks: [] };
    }
    const chain = keyed.getAttribute("data-focus-fallback");
    return {
        focusKey: keyed.getAttribute("data-focus-key"),
        fallbacks: chain ? JSON.parse(chain) as string[] : []
    };
}

function keyName(found: Resolved | null): string {
    return found ? (found.focusKey ?? "(keyless)") : "(off)";
}

function recordFor(view: ViewKey, found: Resolved): FocusRecord {
    const page = pages.get(view);
    return {
        accountUlid,
        subject: page?.subject ?? null,
        tabPath: page?.tabPath ?? [],
        focusKey: found.focusKey,
        fallbacks: found.fallbacks
    };
}

function store(entry: TrailEntry, record: FocusRecord) {
    const level = entry.sub[entry.sub.length - 1];
    if (level) {
        level.record = record;
    }
    else {
        entry.record = record;
    }
}

function writerLive(): boolean {
    return restoredGeneration === generation && !setupShowing;
}

function freeze(entry: TrailEntry, why: string) {
    const last = topRecord(entry);
    let found: Resolved | null = last ? { focusKey: last.focusKey, fallbacks: last.fallbacks } : null;
    let seen = "(not read)";
    if (writerLive() && pendingEntryId !== entry.id && rootElement) {
        const active = rootElement.ownerDocument.activeElement;
        if (active && rootElement.contains(active)) {
            const now = resolve(active, rootElement);
            seen = keyName(now);
            if (now && now.focusKey !== null) {
                found = now;
            }
        }
        else {
            seen = active ? `outside:${active.tagName.toLowerCase()}` : "(nothing)";
        }
    }
    if (found || pages.has(entry.view)) {
        store(entry, recordFor(entry.view, found ?? { focusKey: null, fallbacks: [] }));
    }
    logFocusDebug("record", `freeze-${why}`, `${nameEntry(entry)} ${describeRecord(topRecord(entry))} active=${seen}`);
}

function landingWouldTake(entry: TrailEntry, why: string) {
    logFocusDebug("record", "would-land", `${nameEntry(entry)} ${describeRecord(topRecord(entry))} via=${why}`);
    if (LANDING_VIEWS.has(entry.view) && topRecord(entry)) {
        pendingEntryId = entry.id;
    }
}

export function beginRootMount(): { generation: number; fromModal: boolean } {
    generation += 1;
    liveGeneration = generation;
    preRestore = initialNav("achievements");
    pendingEntryId = null;
    mountedFromModal = consumeModalCloseArm();
    return { generation, fromModal: mountedFromModal };
}

export function markPanelEntry() {
    panelEntryMarked = true;
}

export function restoreTrail(
    rootGeneration: number,
    saved: ViewKey[] | null,
    landed: ViewKey,
    forward: { panelEntry: boolean; routeOverride: boolean }
): NavState {
    const reason: MountReason = forward.panelEntry || panelEntryMarked
        ? "panelEntry"
        : mountedFromModal ? "modalReturn" : trail ? "qamOpen" : "boot";
    panelEntryMarked = false;
    restoredGeneration = rootGeneration;
    const top = topEntry();
    logFocusDebug("record", "mount", `${reason} gen=${rootGeneration} landed=${landed}`);

    if (trail && top && top.view === landed && saved !== null && reason !== "panelEntry" && !forward.routeOverride) {
        const state: NavState = { stack: trail.stack, step: { view: landed, intent: "restore", agreed: true } };
        const list = adopt(state);
        logFocusDebug("record", "restore-hit", `depth=${list.length} ${describeTrail(list)}`);
        landingWouldTake(top, reason);
        return state;
    }

    const why = trail === null
        ? "empty"
        : reason === "panelEntry" ? "panel-entry"
            : forward.routeOverride ? "route-override"
                : saved === null ? "no-saved-trail" : "top-differs";
    const dropped = countRecords(entries.values());
    const state = rehydrateNav(saved, landed);
    const list = adopt(state);
    logFocusDebug("record", "restore-fresh", `${why} dropped=${dropped} ${describeTrail(list)}`);
    return state;
}

export function settleTrail(rootGeneration: number, next: ViewKey, intent: NavIntent): NavState | null {
    if (rootGeneration !== generation || rootGeneration !== liveGeneration) {
        logFocusDebug("record", "ignore-dead-root", `${intent} ${next} gen=${rootGeneration} live=${generation}`);
        return null;
    }
    if (restoredGeneration !== rootGeneration || !trail) {
        preRestore = settleNav(preRestore, { view: next }, intent);
        return preRestore;
    }
    const before = trail;
    const settled = settleNav(before, { view: next }, intent);
    if (settled === before) {
        return before;
    }
    const oldTopRoute = before.stack[before.stack.length - 1];
    const oldTop = entries.get(oldTopRoute);
    const covered = oldTop && settled.stack.indexOf(oldTopRoute) >= 0 && settled.stack[settled.stack.length - 1] !== oldTopRoute;
    if (oldTop && covered) {
        freeze(oldTop, "cover");
    }
    const previous = new Set(entries.values());
    const list = adopt(settled);
    const kept = new Set(list);
    const dropped = countRecords([...previous].filter((entry) => !kept.has(entry)));
    const top = list[list.length - 1];

    if (intent === "push") {
        logFocusDebug("record", "push", `${nameEntry(top)} depth=${list.length}`);
    }
    else if (intent === "back" && settled.step.agreed) {
        logFocusDebug("record", next === "achievements" ? "unwind" : "pop", `${nameEntry(top)} dropped=${dropped} depth=${list.length}`);
        landingWouldTake(top, next === "achievements" ? "unwind" : "pop");
    }
    else if (intent === "back") {
        logFocusDebug("record-drop", "resync", `${next} dropped=${dropped} ${describeTrail(list)}`);
    }
    else {
        logFocusDebug("record", `drop-${intent}`, `dropped=${dropped} ${describeTrail(list)}`);
    }
    return settled;
}

export function rebuildTrailFresh(why: string) {
    const dropped = countRecords(entries.values());
    for (const [route] of entries) {
        entries.set(route, freshEntry(route));
    }
    pendingEntryId = null;
    logFocusDebug("record", "rebuild-fresh", `${why} dropped=${dropped} ${describeTrail([...entries.values()])}`);
}

function pushSubEntry(entry: TrailEntry, view: SubView) {
    const parent = topRecord(entry);
    entry.sub.push({ ...view, record: null });
    logFocusDebug("record", "sub-push", `${nameEntry(entry)} subject=${view.subject ?? "(none)"} under=${describeRecord(parent)}`);
}

function popSubEntry(entry: TrailEntry) {
    const gone = entry.sub.pop();
    logFocusDebug("record", "sub-pop", `${gone?.kind ?? "?"} -> ${nameEntry(entry)}`);
    landingWouldTake(entry, "sub-pop");
}

function syncSubViews(view: ViewKey, shown: SubView[]) {
    const entry = topEntry();
    if (!entry || entry.view !== view || !writerLive()) {
        return;
    }
    const same = (a: SubView, b: SubView) => a.kind === b.kind && a.subject === b.subject;
    let common = 0;
    while (common < entry.sub.length && common < shown.length && same(entry.sub[common], shown[common])) {
        common += 1;
    }
    if (common < entry.sub.length && common < shown.length) {
        const dropped = entry.sub.slice(common).filter((level) => level.record).length;
        entry.sub.length = common;
        logFocusDebug("record", "sub-rebuild", `${nameEntry(entry)} dropped=${dropped}`);
    }
    while (entry.sub.length > shown.length) {
        popSubEntry(entry);
    }
    while (entry.sub.length < shown.length) {
        pushSubEntry(entry, shown[entry.sub.length]);
    }
}

function write(rootGeneration: number, root: HTMLElement, target: Element) {
    const entry = topEntry();
    const found = resolve(target, root);
    if (rootGeneration !== generation || restoredGeneration !== rootGeneration || !entry) {
        logFocusDebug("record", "skip-inert", keyName(found));
        return;
    }
    if (setupShowing) {
        logFocusDebug("record", "skip-setup", keyName(found));
        return;
    }
    if (pendingEntryId === entry.id) {
        logFocusDebug("record", "skip-pending", nameEntry(entry));
        return;
    }
    if (!found) {
        logFocusDebug("record", "skip-off", nameEntry(entry));
        return;
    }
    if (found.focusKey === null) {
        logFocusDebug("record", "keyless", entry.view);
    }
    store(entry, recordFor(entry.view, found));
    logFocusDebug("record", "write", `${nameEntry(entry)} ${describeRecord(topRecord(entry))}`);
}

export function useFocusRecordWriter(
    rootRef: RefObject<HTMLDivElement | null>,
    rootGeneration: number,
    settingsMode: boolean,
    activeUlid: string
) {
    useInsertionEffect(() => {
        setupShowing = settingsMode;
        if (activeUlid) {
            accountUlid = activeUlid;
        }
    }, [settingsMode, activeUlid]);

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        rootElement = root;
        function onFocus(event: Event) {
            write(rootGeneration, root as HTMLElement, event.target as Element);
        }
        root.addEventListener("vgp_onfocus", onFocus);
        return () => {
            root.removeEventListener("vgp_onfocus", onFocus);
            const entry = topEntry();
            if (entry && rootGeneration === generation && restoredGeneration === rootGeneration) {
                freeze(entry, "unmount");
            }
            if (rootElement === root) {
                rootElement = null;
            }
            if (liveGeneration === rootGeneration) {
                liveGeneration = 0;
            }
        };
    }, [rootGeneration]);
}

export function usePageLanding(registration: {
    view: ViewKey;
    subject?: string | number | null;
    tabPath?: (string | null | undefined)[];
    sub?: SubView[];
}) {
    const { view, subject, tabPath, sub } = registration;
    useInsertionEffect(() => {
        pages.set(view, {
            subject: subject == null ? null : String(subject),
            tabPath: (tabPath ?? []).filter((tab): tab is string => typeof tab === "string" && tab !== "")
        });
        if (sub) {
            syncSubViews(view, sub);
        }
    });
}
