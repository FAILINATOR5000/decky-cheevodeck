import { useInsertionEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { logFocusDebug } from "./api";
import { isCovered, setCover, subscribeCovers } from "./covers";
import { armKeyClaim, claimSpentWithin, disarmKeyClaims, heirClaimExpected, onKeyClaimSpent, withdrawKeyClaim } from "./focusClaims";
import { initialNav, rehydrateNav, settleNav, type NavIntent, type NavState, type Route } from "./nav";
import type { ViewKey } from "./types";
import { LANDING_TIMING, PRESS_GUARD_CEILING_MS, type LandingTiming } from "./utils/landingTiming";
import { consumeModalCloseArm, modalEchoPending } from "./utils/modalRegistry";

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

type PageRegistration = {
    subject: string | null;
    tabPath: string[];
    placeholderKey: string | null;
    defaultKey: string | null;
    timing: Partial<LandingTiming> | null;
};

type LandingKind = "pop" | "remount" | "forward";

type Echo = { button: number; at: number } | "modal" | null;

type PendingLanding = {
    seq: number;
    entryId: number;
    view: ViewKey;
    kind: LandingKind;
    record: FocusRecord;
    echo: Echo;
    placeholderKey: string | null;
    claimedKey: string | null;
    claimToken: number | null;
    claimSpent: boolean;
    revealedEarly: boolean;
};

type LandingOutcome = { entryId: number; how: "settled" | "canceled" | "dropped"; held?: boolean };

type OwnLanding = { entryId: number; pending: boolean; settled: boolean };

type Resolved = { focusKey: string | null; fallbacks: string[] };

const LANDING_VIEWS: ReadonlySet<ViewKey> = new Set<ViewKey>([
    "achievements",
    "utils",
    "trackedSets",
    "trackedSetOpen",
    "social",
    "eventViewer",
    "friendGame",
    "friendAllGames",
    "badges",
    "wantToPlay",
    "followedRanking",
    "friendCompare",
    "unlockHistory",
    "comparePicker",
    "gameOverview",
    "achievementOverview",
    "tracked",
    "gameNotes",
    "leaderboards",
    "leaderboardDetail",
    "guides",
    "dolphinMapper",
    "cheevoCheck",
    "smbShares",
    "fileWatcher",
    "memoriesTransfer",
    "memories",
    "options",
    "about",
    "qamGuard"
]);
const RECOVERY_OWNER = -1;
const CLAIM_SETTLE_MS = 250;
const CLAIM_SETTLE_FRAMES = 20;

let trail: NavState | null = null;
let entries = new Map<Route, TrailEntry>();
let nextEntryId = 1;

let generation = 0;
let restoredGeneration = 0;
let liveGeneration = 0;
let preRestore: NavState = initialNav("achievements");
let mountedFromModal = false;
let mountReason: MountReason | null = null;
let panelEntryMarked = false;

let rootElement: HTMLElement | null = null;
let accountUlid = "";
let setupShowing = false;
let pending: PendingLanding | null = null;
let ownedEntryId: number | null = null;
let lastOutcome: LandingOutcome | null = null;
let unlandedEntryId: number | null = null;
let ownLanding: OwnLanding | null = null;
let lastPress: { button: number; at: number } | null = null;
let landingSeq = 0;
let landingVersion = 0;
const landingListeners = new Set<() => void>();

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
    if (entry.id === unlandedEntryId) {
        unlandedEntryId = null;
    }
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
    if (entry.id === unlandedEntryId || pending?.entryId === entry.id) {
        logFocusDebug("record", `freeze-${why}`, `${nameEntry(entry)} kept ${describeRecord(topRecord(entry))} landing not done`);
        return;
    }
    const last = topRecord(entry);
    let found: Resolved | null = last ? { focusKey: last.focusKey, fallbacks: last.fallbacks } : null;
    let seen = "(not read)";
    if (writerLive() && pending?.entryId !== entry.id && rootElement) {
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
    const record = topRecord(entry);
    if (!LANDING_VIEWS.has(entry.view) || !record) {
        return;
    }
    const kind: LandingKind = why === "qamOpen" || why === "modalReturn" ? "remount" : "pop";
    const echo: Echo = why === "modalReturn" ? "modal" : why === "qamOpen" ? null : recentPress();
    startLanding(entry, kind, { ...record, fallbacks: [...record.fallbacks], tabPath: [...record.tabPath] }, echo);
}

function notifyLanding() {
    landingVersion += 1;
    queueMicrotask(() => {
        for (const listener of landingListeners) {
            listener();
        }
    });
}

function nudgeLanding(frames: number) {
    const view = rootElement?.ownerDocument.defaultView;
    if (!view || frames <= 0 || !pending) {
        return;
    }
    view.requestAnimationFrame(() => {
        notifyLanding();
        nudgeLanding(frames - 1);
    });
}

function subscribeLanding(listener: () => void): () => void {
    landingListeners.add(listener);
    return () => {
        landingListeners.delete(listener);
    };
}

function readLandingVersion(): number {
    return landingVersion;
}

function recentPress(): Echo {
    if (!lastPress || Date.now() - lastPress.at > PRESS_GUARD_CEILING_MS) {
        return null;
    }
    return { ...lastPress };
}

function startLanding(entry: TrailEntry, kind: LandingKind, record: FocusRecord, echo: Echo) {
    if (pending) {
        endLanding(pending.entryId, "dropped", "superseded");
    }
    const placeholderKey = pages.get(entry.view)?.placeholderKey ?? null;
    landingSeq += 1;
    pending = { seq: landingSeq, entryId: entry.id, view: entry.view, kind, record, echo, placeholderKey, claimedKey: null, claimToken: null, claimSpent: false, revealedEarly: false };
    ownedEntryId = entry.id;
    lastOutcome = null;
    logFocusDebug("landing", "pending", `${kind} ${nameEntry(entry)} ${describeRecord(record)} placeholder=${placeholderKey ?? "(none)"}`
        + ` echo=${echo === null ? "none" : echo === "modal" ? "modal" : echo.button}`);
    if (placeholderKey) {
        armKeyClaim(placeholderKey, entry.id);
    }
    notifyLanding();
}

function endLanding(entryId: number, how: LandingOutcome["how"], why: string, held = false) {
    if (!pending || pending.entryId !== entryId) {
        return;
    }
    pending = null;
    lastOutcome = { entryId, how, held };
    if (how === "dropped" && why === "unmount") {
        unlandedEntryId = entryId;
    }
    else if (unlandedEntryId === entryId) {
        unlandedEntryId = null;
    }
    disarmKeyClaims(entryId);
    logFocusDebug("landing", how === "canceled" ? "cancel" : how === "dropped" ? "drop" : "settled", `${entryId} ${why}`);
    notifyLanding();
}

function notePress(button: number) {
    const now = Date.now();
    if (pending) {
        const echo = pending.echo;
        if (echo === "modal" && modalEchoPending()) {
            logFocusDebug("landing", "echo", `${pending.entryId} button=${button} modal`);
        }
        else if (echo && echo !== "modal" && echo.button === button && now - echo.at < curtainTiming().pressGuardCeilingMs) {
            logFocusDebug("landing", "echo", `${pending.entryId} button=${button} after=${now - echo.at}ms`);
        }
        else {
            endLanding(pending.entryId, "canceled", `press ${button}`);
        }
    }
    lastPress = { button, at: now };
}

function escapeKey(key: string): string {
    return key.replace(/["\\]/g, "\\$&");
}

function keyedElement(key: string): HTMLElement | null {
    return rootElement?.querySelector(`[data-focus-key="${escapeKey(key)}"]`) as HTMLElement | null;
}

function keyedDisabled(element: HTMLElement): boolean {
    const control = (element.querySelector("button, [tabindex]") as HTMLElement | null) ?? element;
    return control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true";
}

function cursorIn(element: HTMLElement): boolean {
    const active = element.ownerDocument.activeElement;
    return Boolean(active && element.contains(active));
}

function nothingFocused(): boolean {
    if (!rootElement) {
        return false;
    }
    const active = rootElement.ownerDocument.activeElement;
    return !active || active === rootElement.ownerDocument.body;
}

function claimVanished(entryId: number, key: string) {
    if (!pending || pending.entryId !== entryId || pending.claimedKey !== key) {
        return;
    }
    if (pending.claimToken !== null) {
        withdrawKeyClaim(key, pending.claimToken, "vanished");
    }
    pending.claimedKey = null;
    pending.claimToken = null;
    pending.claimSpent = false;
    logFocusDebug("landing", "candidate", `${entryId} ${key} vanished`);
    notifyLanding();
}

function watchClaim(entryId: number, key: string) {
    const view = rootElement?.ownerDocument.defaultView;
    if (!view) {
        return;
    }
    view.requestAnimationFrame(() => {
        if (pending?.entryId !== entryId || pending.claimedKey !== key || pending.claimSpent) {
            return;
        }
        if (!keyedElement(key)) {
            claimVanished(entryId, key);
            return;
        }
        watchClaim(entryId, key);
    });
}

function holdLanded(entryId: number, key: string, since: number) {
    const view = rootElement?.ownerDocument.defaultView;
    if (!view) {
        return;
    }
    view.requestAnimationFrame(() => {
        if (pending?.entryId !== entryId || pending.claimedKey !== key) {
            return;
        }
        if (!keyedElement(key)) {
            claimVanished(entryId, key);
            return;
        }
        if (pending.revealedEarly || Date.now() - since >= curtainTiming().revealGraceMs) {
            endLanding(entryId, "settled", `landed ${key}`, !pending.revealedEarly);
            return;
        }
        holdLanded(entryId, key, since);
    });
}

function confirmLanded(entryId: number, key: string, tries: number) {
    const view = rootElement?.ownerDocument.defaultView;
    if (!view) {
        return;
    }
    view.requestAnimationFrame(() => {
        if (pending?.entryId !== entryId || pending.claimedKey !== key) {
            return;
        }
        const element = keyedElement(key);
        if (!element) {
            claimVanished(entryId, key);
            return;
        }
        if (cursorIn(element)) {
            if (pending.revealedEarly) {
                endLanding(entryId, "settled", `landed ${key}`);
            }
            else {
                holdLanded(entryId, key, Date.now());
            }
            return;
        }
        if (tries >= 4) {
            endLanding(entryId, "settled", `unlanded ${key} active=${describeActive()}`);
            return;
        }
        confirmLanded(entryId, key, tries + 1);
    });
}

function describeActive(): string {
    const active = rootElement?.ownerDocument.activeElement;
    if (!active || !rootElement) {
        return "(nothing)";
    }
    const keyed = active.closest("[data-focus-key]");
    return keyed ? (keyed.getAttribute("data-focus-key") ?? "?") : active.tagName.toLowerCase();
}

onKeyClaimSpent((key) => {
    if (pending && pending.claimedKey === key) {
        pending.claimSpent = true;
        confirmLanded(pending.entryId, key, 0);
    }
});

function recoverLostCursor(why: string, frames = 0) {
    const entry = topEntry();
    if (!entry || pending || isCovered() || !LANDING_VIEWS.has(entry.view) || !nothingFocused()) {
        return;
    }
    const view = rootElement?.ownerDocument.defaultView;
    if (view && ((frames < CLAIM_SETTLE_FRAMES && claimSpentWithin(CLAIM_SETTLE_MS)) || heirClaimExpected())) {
        view.requestAnimationFrame(() => recoverLostCursor(why, frames + 1));
        return;
    }
    const key = pages.get(entry.view)?.placeholderKey;
    if (!key || !keyedElement(key)) {
        return;
    }
    logFocusDebug("lost", "recover", `${nameEntry(entry)} ${key} ${why}`);
    armKeyClaim(key, RECOVERY_OWNER, true);
}

export function landingOwnsTop(): boolean {
    return ownedEntryId !== null && ownedEntryId === topEntry()?.id;
}

export function useLandingPendingEntry(): number | null {
    useSyncExternalStore(subscribeLanding, readLandingVersion);
    return pending?.entryId ?? null;
}

export function pendingLandingKey(view: ViewKey): string | null {
    return takeablePending(view)?.record.focusKey ?? null;
}

export function topEntryId(): number | null {
    return topEntry()?.id ?? null;
}

export function subPopWouldLand(view: ViewKey, depth: number): boolean {
    const entry = topEntry();
    if (!entry || entry.view !== view || !LANDING_VIEWS.has(view) || entry.sub.length <= depth) {
        return false;
    }
    return Boolean(depth === 0 ? entry.record : entry.sub[depth - 1].record);
}

export function subLandingAhead(view: ViewKey, depth: number): boolean {
    const entry = topEntry();
    if (!entry || entry.view !== view) {
        return false;
    }
    return pending?.entryId === entry.id || subPopWouldLand(view, depth);
}

let landOnArrivalAt: { view: ViewKey; focusKey: string } | null = null;

export function landOnArrival(view: ViewKey, focusKey: string) {
    landOnArrivalAt = { view, focusKey };
}

export function landOnTop(view: ViewKey, focusKey: string) {
    const top = topEntry();
    if (!top || top.view !== view || !LANDING_VIEWS.has(view)) {
        return;
    }
    startLanding(top, "forward", { accountUlid, subject: null, tabPath: [], focusKey, fallbacks: [] }, recentPress());
}

export function overrideRecord(entryId: number | null, target: { focusKey: string; fallbacks?: string[]; subject?: string }) {
    const entry = [...entries.values()].find((candidate) => candidate.id === entryId);
    if (!entry) {
        logFocusDebug("record", "override-gone", `${entryId} ${target.focusKey}`);
        return;
    }
    if (pending?.entryId === entry.id) {
        if (pending.claimedKey !== null) {
            logFocusDebug("record", "override-late", `${nameEntry(entry)} ${target.focusKey}`);
            return;
        }
        const record = {
            ...pending.record,
            focusKey: target.focusKey,
            fallbacks: target.fallbacks ?? pending.record.fallbacks,
            subject: target.subject ?? pending.record.subject
        };
        pending.record = record;
        store(entry, record);
        logFocusDebug("record", "override-pending", `${nameEntry(entry)} ${describeRecord(record)}`);
        notifyLanding();
        return;
    }
    const record = topRecord(entry) ?? recordFor(entry.view, { focusKey: null, fallbacks: [] });
    store(entry, {
        ...record,
        focusKey: target.focusKey,
        fallbacks: target.fallbacks ?? record.fallbacks,
        subject: target.subject ?? record.subject
    });
    logFocusDebug("record", "override", `${nameEntry(entry)} ${describeRecord(topRecord(entry))}`);
}

export function curtainEntryAtMount(): { entryId: number | null; armed: boolean } {
    const entryId = topEntry()?.id ?? null;
    return { entryId, armed: entryId !== null && pending?.entryId === entryId };
}

export function curtainState(entryId: number | null): { own: boolean; settled: boolean; canceled: boolean; held: boolean } {
    const own = entryId !== null && ownLanding?.entryId === entryId && (ownLanding.pending || ownLanding.settled);
    if (own && ownLanding) {
        return { own, settled: ownLanding.settled, canceled: false, held: false };
    }
    const outcome = lastOutcome && lastOutcome.entryId === entryId ? lastOutcome : null;
    const how = outcome?.how ?? null;
    return { own: false, settled: how === "settled" || how === "dropped", canceled: how === "canceled", held: Boolean(outcome?.held) };
}

export function curtainTiming(): LandingTiming {
    const view = topEntry()?.view;
    const own = view ? pages.get(view)?.timing : null;
    return own ? { ...LANDING_TIMING, ...own } : LANDING_TIMING;
}

export function useLandingVersion(): number {
    return useSyncExternalStore(subscribeLanding, readLandingVersion);
}

export function markCurtainRevealed(entryId: number | null) {
    if (pending && pending.entryId === entryId) {
        pending.revealedEarly = true;
        logFocusDebug("landing", "revealed-early", `${entryId}`);
    }
}

export function beginRootMount(): { generation: number; fromModal: boolean } {
    generation += 1;
    liveGeneration = generation;
    preRestore = initialNav("achievements");
    pending = null;
    ownedEntryId = null;
    ownLanding = null;
    mountReason = null;
    mountedFromModal = consumeModalCloseArm();
    return { generation, fromModal: mountedFromModal };
}

export function rootMountReason(): MountReason | null {
    return mountReason;
}

export function markPanelEntry() {
    panelEntryMarked = true;
}

export function restoreTrail(
    rootGeneration: number,
    saved: ViewKey[] | null,
    landed: ViewKey,
    forward: { panelEntry: boolean; routeOverride: boolean; pushOpener: boolean; land?: string | null }
): NavState {
    const reason: MountReason = forward.panelEntry || panelEntryMarked
        ? "panelEntry"
        : mountedFromModal ? "modalReturn" : trail ? "qamOpen" : "boot";
    panelEntryMarked = false;
    mountReason = reason;
    restoredGeneration = rootGeneration;
    const top = topEntry();
    logFocusDebug("record", "mount", `${reason} gen=${rootGeneration} landed=${landed}`);

    ownedEntryId = null;
    if (trail && top && top.view === landed && saved !== null && reason !== "panelEntry" && !forward.routeOverride) {
        const state: NavState = { stack: trail.stack, step: { view: landed, intent: "restore", agreed: true } };
        const list = adopt(state);
        logFocusDebug("record", "restore-hit", `depth=${list.length} ${describeTrail(list)}`);
        landingWouldTake(top, reason);
        return state;
    }
    if (trail && top && forward.pushOpener && reason !== "panelEntry" && saved !== null
        && saved[saved.length - 1] === top.view && top.view !== landed) {
        const pushed = settleNav(trail, { view: landed }, "push");
        const list = adopt(pushed);
        logFocusDebug("record", "restore-push", `route-override depth=${list.length} ${describeTrail(list)}`);
        return pushed;
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
    const landedEntry = list[list.length - 1];
    if ((reason === "panelEntry" || forward.routeOverride) && forward.land && landedEntry && LANDING_VIEWS.has(landedEntry.view)) {
        startLanding(landedEntry, "forward", { accountUlid, subject: null, tabPath: [], focusKey: forward.land, fallbacks: [] }, mountedFromModal ? "modal" : null);
    }
    return state;
}

export function settleTrail(rootGeneration: number, next: ViewKey, intent: NavIntent, land?: string): NavState | null {
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
    if (pending && pending.entryId !== top.id) {
        endLanding(pending.entryId, "dropped", "superseded");
    }
    if (ownedEntryId !== top.id) {
        ownedEntryId = null;
    }

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
    const arrival = landOnArrivalAt;
    landOnArrivalAt = null;
    const landKey = land ?? (arrival && arrival.view === next ? arrival.focusKey : undefined);
    if (landKey) {
        startLanding(top, "forward", { accountUlid, subject: null, tabPath: [], focusKey: landKey, fallbacks: [] }, recentPress());
    }
    return settled;
}

export function rebuildTrailFresh(why: string, nextUlid?: string) {
    const top = nextUlid ? topEntry() : null;
    const dropped = countRecords([...entries.values()].filter((entry) => entry !== top));
    for (const [route, entry] of entries) {
        if (entry !== top) {
            entries.set(route, freshEntry(route));
        }
    }
    if (top && nextUlid) {
        for (const record of [top.record, ...top.sub.map((level) => level.record)]) {
            if (record) {
                record.accountUlid = nextUlid;
            }
        }
    }
    if (pending) {
        endLanding(pending.entryId, "dropped", "account-switch");
    }
    ownedEntryId = null;
    unlandedEntryId = null;
    logFocusDebug("record", "rebuild-fresh", `${why} dropped=${dropped} kept=${top ? nameEntry(top) : "(none)"} ${describeTrail([...entries.values()])}`);
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
    if (pending?.entryId === entry.id) {
        const key = found?.focusKey ?? null;
        if (pending.revealedEarly && key !== null && key !== pending.placeholderKey && key !== pending.claimedKey) {
            endLanding(pending.entryId, "canceled", `moved to ${key}`);
        }
        else {
            logFocusDebug("record", "skip-pending", `${nameEntry(entry)} ${keyName(found)}`);
            return;
        }
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
        const doc = root.ownerDocument;
        function onFocus(event: Event) {
            write(rootGeneration, root as HTMLElement, event.target as Element);
        }
        function onButtonDown(event: Event) {
            const button = (event as CustomEvent<{ button?: number }>).detail?.button;
            if (typeof button === "number") {
                notePress(button);
            }
        }
        function onPointerDown() {
            if (pending) {
                endLanding(pending.entryId, "canceled", "pointer");
            }
        }
        function onFocusOut(event: Event) {
            if ((event as FocusEvent).relatedTarget) {
                return;
            }
            doc.defaultView?.requestAnimationFrame(() => recoverLostCursor("focusout"));
        }
        let wasCovered = isCovered();
        const stopCovers = subscribeCovers(() => {
            const covered = isCovered();
            if (wasCovered && !covered) {
                doc.defaultView?.requestAnimationFrame(() => recoverLostCursor("cover-lift"));
            }
            wasCovered = covered;
        });
        root.addEventListener("vgp_onfocus", onFocus);
        root.addEventListener("focusout", onFocusOut);
        root.addEventListener("pointerdown", onPointerDown, true);
        doc.addEventListener("vgp_onbuttondown", onButtonDown, true);
        return () => {
            root.removeEventListener("vgp_onfocus", onFocus);
            root.removeEventListener("focusout", onFocusOut);
            root.removeEventListener("pointerdown", onPointerDown, true);
            doc.removeEventListener("vgp_onbuttondown", onButtonDown, true);
            stopCovers();
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

type ActiveLanding = {
    seq: number;
    entryId: number;
    kind: LandingKind;
    record: FocusRecord;
    candidates: string[];
    next: number;
    opened: Map<string, number>;
    revealed: Set<string>;
    commits: number;
    checked: boolean;
    claimed: boolean;
    done: boolean;
    waitLogged: string | null;
};

function takeablePending(view: ViewKey): PendingLanding | null {
    const top = topEntry();
    return pending && top && pending.view === view && pending.entryId === top.id ? pending : null;
}

function candidatesFor(record: FocusRecord, defaultKey: string): string[] {
    const candidates: string[] = [];
    for (const key of [record.focusKey, ...record.fallbacks, defaultKey]) {
        if (key && !candidates.includes(key)) {
            candidates.push(key);
        }
    }
    return candidates;
}

function activeFrom(landing: PendingLanding, defaultKey: string): ActiveLanding {
    const candidates = candidatesFor(landing.record, defaultKey);
    logFocusDebug("landing", "take", `${landing.kind} ${landing.entryId} ${landing.view} candidates=${candidates.join(",")}`);
    return {
        seq: landing.seq,
        entryId: landing.entryId,
        kind: landing.kind,
        record: landing.record,
        candidates,
        next: 0,
        opened: new Map(),
        revealed: new Set(),
        commits: 0,
        checked: false,
        claimed: false,
        done: false,
        waitLogged: null
    };
}

function noSubscribe(): () => void {
    return () => {};
}

function noVersion(): number {
    return 0;
}

function noCover(): boolean {
    return false;
}

export type LandingWindows = { holds: (key: string) => boolean; open: (key: string) => void };

type PageLanding = {
    defaultKey?: string;
    placeholderKey?: string;
    ready?: boolean;
    subjectSettled?: boolean;
    restoreTabPath?: (tabPath: string[]) => boolean;
    holds?: (key: string) => boolean;
    open?: (key: string) => void;
    reveal?: (key: string) => boolean;
    cover?: boolean;
    timing?: Partial<LandingTiming>;
    ownLanding?: { pending: boolean; settled: boolean };
};

export function usePageLanding(registration: {
    view: ViewKey;
    subject?: string | number | null;
    tabPath?: (string | null | undefined)[];
    sub?: SubView[];
} & PageLanding) {
    const { view, subject, tabPath, sub, defaultKey, ready = true, subjectSettled = true, restoreTabPath, holds, open, reveal, cover, timing, ownLanding: own } = registration;
    const adopted = defaultKey !== undefined;
    const placeholderKey = registration.placeholderKey ?? defaultKey ?? null;

    const [atMount] = useState(() => {
        const landing = adopted && defaultKey ? takeablePending(view) : null;
        return landing && defaultKey ? activeFrom(landing, defaultKey) : null;
    });
    const activeRef = useRef<ActiveLanding | null>(atMount);
    const ownAtMountRef = useRef<boolean | null>(null);
    const ownEntryRef = useRef<number | null>(null);
    useSyncExternalStore(adopted ? subscribeLanding : noSubscribe, adopted ? readLandingVersion : noVersion);
    useSyncExternalStore(adopted ? subscribeCovers : noSubscribe, adopted ? isCovered : noCover);

    useInsertionEffect(() => {
        pages.set(view, {
            subject: subject == null ? null : String(subject),
            tabPath: (tabPath ?? []).filter((tab): tab is string => typeof tab === "string" && tab !== ""),
            placeholderKey: adopted ? placeholderKey : null,
            defaultKey: defaultKey ?? null,
            timing: timing ?? null
        });
        if (sub) {
            syncSubViews(view, sub);
        }
        const top = topEntry();
        const onTop = Boolean(top && top.view === view);
        if (cover !== undefined) {
            setCover(`page:${view}`, cover && onTop);
        }
        if (own && !onTop && ownAtMountRef.current !== null) {
            if (ownAtMountRef.current && ownLanding && ownLanding.entryId === ownEntryRef.current) {
                ownLanding = null;
            }
            ownAtMountRef.current = null;
        }
        if (own && top && onTop) {
            if (ownAtMountRef.current === null) {
                ownAtMountRef.current = own.pending;
                ownEntryRef.current = top.id;
                if (own.pending) {
                    ownedEntryId = top.id;
                    const active = activeRef.current;
                    if (active && !active.done) {
                        active.done = true;
                        endLanding(active.entryId, "dropped", "own landing");
                    }
                }
            }
            if (ownAtMountRef.current) {
                const next: OwnLanding = { entryId: top.id, pending: own.pending, settled: own.settled };
                if (!ownLanding || ownLanding.entryId !== next.entryId || ownLanding.pending !== next.pending || ownLanding.settled !== next.settled) {
                    ownLanding = next;
                    logFocusDebug("landing", "own", `${top.id} pending=${next.pending} settled=${next.settled}`);
                    notifyLanding();
                }
            }
        }
    });

    useLayoutEffect(() => {
        if (!adopted || !defaultKey) {
            return;
        }
        let active = activeRef.current;
        const live = takeablePending(view);
        if (live && (!active || active.seq !== live.seq) && ownAtMountRef.current !== true) {
            active = activeFrom(live, defaultKey);
            activeRef.current = active;
        }
        if (!active || active.done) {
            return;
        }
        if (pending?.seq !== active.seq) {
            active.done = true;
            return;
        }
        if (!active.claimed && active.record !== pending.record) {
            active.record = pending.record;
            active.candidates = candidatesFor(pending.record, defaultKey);
            active.next = 0;
            active.opened.clear();
            active.revealed.clear();
            logFocusDebug("landing", "retarget", `${active.entryId} candidates=${active.candidates.join(",")}`);
        }
        if (active.claimed) {
            if (pending.claimedKey !== null) {
                return;
            }
            active.claimed = false;
            active.next += 1;
        }
        active.commits += 1;
        const landing: PendingLanding = pending;

        if (!active.claimed && placeholderKey && landing.placeholderKey !== placeholderKey) {
            logFocusDebug("landing", "placeholder", `${active.entryId} ${placeholderKey} was=${landing.placeholderKey ?? "(none)"}`);
            landing.placeholderKey = placeholderKey;
            armKeyClaim(placeholderKey, active.entryId);
        }

        const wait = (why: string) => {
            if (active && active.waitLogged !== why) {
                active.waitLogged = why;
                logFocusDebug("landing", "wait", `${active.entryId} ${why}`);
            }
        };
        if (!active.checked && !subjectSettled) {
            wait("subject");
            return;
        }
        const target = active.record.focusKey;
        const targetElement = active.next === 0 && target && target === active.candidates[0] ? keyedElement(target) : null;
        const targetHere = Boolean(targetElement && !keyedDisabled(targetElement));
        if (!ready && !targetHere) {
            wait("ready");
            return;
        }
        if (!active.checked) {
            active.checked = true;
            const record = active.record;
            const page = pages.get(view);
            if (active.kind !== "forward" && record.subject !== null && page?.subject !== record.subject) {
                logFocusDebug("landing", "drop", `${active.entryId} subject ${record.subject} now ${page?.subject ?? "(none)"}`);
                active.candidates = [defaultKey];
            }
            else if (active.kind !== "forward" && record.accountUlid && accountUlid && record.accountUlid !== accountUlid) {
                logFocusDebug("landing", "drop", `${active.entryId} account`);
                active.candidates = [defaultKey];
            }
            else if (record.tabPath.length > 0 && restoreTabPath && restoreTabPath(record.tabPath)) {
                logFocusDebug("landing", "tabs", `${active.entryId} ${record.tabPath.join("/")}`);
                return;
            }
            logFocusDebug("landing", "ready", `${active.entryId} after ${active.commits} commit(s)`);
        }

        while (active.next < active.candidates.length) {
            const key = active.candidates[active.next];
            const element = keyedElement(key);
            if (element) {
                if (keyedDisabled(element)) {
                    if (isCovered()) {
                        wait(`disabled ${key} under a cover`);
                        return;
                    }
                    logFocusDebug("landing", "candidate", `${active.entryId} ${key} disabled`);
                    active.next += 1;
                    continue;
                }
                active.claimed = true;
                landing.claimedKey = key;
                if (key === landing.placeholderKey && cursorIn(element)) {
                    active.done = true;
                    endLanding(active.entryId, "settled", `already on ${key}`);
                    return;
                }
                logFocusDebug("landing", "candidate", `${active.entryId} ${key} claimed`);
                landing.claimToken = armKeyClaim(key, active.entryId);
                watchClaim(active.entryId, key);
                return;
            }
            const askedAt = active.opened.get(key);
            if (askedAt === undefined && holds?.(key) && open) {
                active.opened.set(key, active.commits);
                logFocusDebug("landing", "candidate", `${active.entryId} ${key} opened`);
                open(key);
                nudgeLanding(3);
                return;
            }
            if (askedAt !== undefined && active.commits - askedAt < 3) {
                wait(`open ${key}`);
                return;
            }
            if (reveal && !active.revealed.has(key)) {
                active.revealed.add(key);
                if (reveal(key)) {
                    logFocusDebug("landing", "candidate", `${active.entryId} ${key} revealed`);
                    return;
                }
            }
            logFocusDebug("landing", "candidate", `${active.entryId} ${key} missing`);
            active.next += 1;
        }
        active.done = true;
        endLanding(active.entryId, "settled", "no candidate");
    });

    useLayoutEffect(() => () => {
        const active = activeRef.current;
        if (active && !active.done) {
            active.done = true;
            endLanding(active.entryId, "dropped", "unmount");
        }
        if (cover !== undefined) {
            setCover(`page:${view}`, false);
        }
    }, []);
}
