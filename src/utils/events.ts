import { t, type LanguageCode } from "../locales";
import { formatUnlockDate, parseNoteTag } from "./achievements";
import type {
    ChecklistGameProgress,
    ChecklistTick,
    EventChecklist,
    EventChecklistRule,
    EventCompletion,
    EventListRow,
    EventsClickAction,
    EventsShow,
    EventsSort,
    EventsType,
    EventsUserState,
    EventsViewPrefs,
    TrackedEventsClickAction
} from "../types";

export const EVENTS_UNTAGGED_KEY = "__UNTAGGED__";
export const EVENTS_COMPLETED_KEY = "__COMPLETED__";

export const EVENTS_CONSOLE_NAME = "Events";

export function isEventConsole(consoleName: string | null | undefined): boolean {
    return consoleName === EVENTS_CONSOLE_NAME;
}

function eventTime(value: string | null | undefined): number | null {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        return null;
    }
    const iso = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    const zoned = /([zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`;
    const ms = Date.parse(zoned);
    return Number.isNaN(ms) ? null : ms;
}

export function eventCompletion(row: EventListRow, user: EventsUserState | null): EventCompletion {
    if (row.earnedAt) {
        return { kind: "earned", at: eventTime(row.earnedAt) ?? 0 };
    }
    const mark = user?.completed[String(row.gameId)];
    return mark ? { kind: "marked", at: mark.at } : null;
}

export function canMarkComplete(row: Pick<EventListRow, "kind" | "earnedAt">): boolean {
    return (row.kind === "checklist" || row.kind === "spreadsheet") && !row.earnedAt;
}

function phase(row: EventListRow, newestSiteGameId: number, now: number): "active" | "evergreen" | "ended" | null {
    const until = eventTime(row.activeUntil);
    if (until !== null && until <= now) {
        return "ended";
    }
    if (row.state === "active") {
        return "active";
    }
    if (row.state === "evergreen") {
        return "evergreen";
    }
    if (row.state === "concluded") {
        return "ended";
    }
    if (!row.hasSiteData) {
        return row.gameId > newestSiteGameId ? "active" : null;
    }
    if (row.evergreen) {
        return "evergreen";
    }
    return "active";
}

export function eventPhaseLabel(row: EventListRow, newestSiteGameId: number, language: LanguageCode): string {
    const value = phase(row, newestSiteGameId, Date.now());
    if (value === "active") {
        return t(language, "Active");
    }
    if (value === "evergreen") {
        return t(language, "Evergreen");
    }
    if (value === "ended") {
        return t(language, "Ended");
    }
    return "";
}

const FIRST_EVENT_YEAR = 2012;

function eventYear(row: Pick<EventListRow, "title" | "createdAt">): number | null {
    const created = eventTime(row.createdAt);
    const latest = created !== null ? new Date(created).getUTCFullYear() : new Date().getUTCFullYear();
    const years = [...row.title.matchAll(/(?<!\d)(\d{4})(?!\d)/g)]
        .map((match) => Number(match[1]))
        .filter((year) => year >= FIRST_EVENT_YEAR && year <= latest);
    if (years.length > 0) {
        return Math.max(...years);
    }
    return created !== null ? new Date(created).getUTCFullYear() : null;
}

export function eventDatesLabel(
    row: Pick<EventListRow, "title" | "activeFrom" | "activeUntil" | "activeThrough" | "createdAt">,
    language: LanguageCode
): string {
    const from = formatUnlockDate(row.activeFrom, { includeYear: true, dateOnly: true }, language);
    const until = formatUnlockDate(row.activeUntil ?? row.activeThrough, { includeYear: true, dateOnly: true }, language);
    if (from && until) {
        return t(language, "{{from}} to {{until}}", { from, until });
    }
    if (from) {
        return t(language, "Since {{from}}", { from });
    }
    const year = eventYear(row);
    return year !== null ? String(year) : "";
}

export function eventKindLabel(row: Pick<EventListRow, "kind">, language: LanguageCode): string {
    switch (row.kind) {
        case "automated":
            return t(language, "Automated");
        case "checklist":
            return t(language, "Checklist");
        case "spreadsheet":
            return t(language, "Spreadsheet");
        case "paused":
            return t(language, "Paused");
        default:
            return "";
    }
}

export function matchesShow(
    row: EventListRow,
    show: EventsShow,
    completion: EventCompletion,
    newestSiteGameId: number,
    now: number
): boolean {
    if (show === "all") {
        return true;
    }
    if (show === "completed") {
        return completion !== null;
    }
    if (completion !== null) {
        return false;
    }
    return phase(row, newestSiteGameId, now) === show;
}

export function matchesTrackedShow(row: EventListRow, show: EventsShow, newestSiteGameId: number, now: number): boolean {
    if (show === "all" || show === "completed") {
        return true;
    }
    return phase(row, newestSiteGameId, now) === show;
}

export function matchesType(row: EventListRow, type: EventsType): boolean {
    if (type === "all") {
        return true;
    }
    if (type === "unscanned") {
        return !row.hasSiteData;
    }
    if (type === "other") {
        return row.hasSiteData && row.kind !== "automated" && row.kind !== "checklist" && row.kind !== "spreadsheet";
    }
    return row.kind === type;
}

function eventProgressFraction(row: EventListRow, user: EventsUserState | null): number | null {
    const progress = user?.activity[String(row.gameId)]?.lastProgress;
    if (!progress) {
        return null;
    }
    if (row.kind === "checklist") {
        if (progress.points === null || !row.checklistTarget) {
            return null;
        }
        return Math.min(1, progress.points / row.checklistTarget);
    }
    return progress.total > 0 ? progress.earned / progress.total : null;
}

function activityTime(row: EventListRow, user: EventsUserState | null): number {
    const activity = user?.activity[String(row.gameId)];
    if (!activity) {
        return 0;
    }
    return Math.max(activity.lastOpenedAt, activity.lastEarnedSeenAt);
}

function latestKeys(rows: EventListRow[]): Map<number, number> {
    const newestSite = rows.reduce((most, row) => (row.hasSiteData ? Math.max(most, row.gameId) : most), 0);
    const keys = new Map<number, number>();
    for (const row of rows) {
        const start = eventTime(row.activeFrom);
        if (start !== null) {
            keys.set(row.gameId, start);
            continue;
        }
        if (!row.hasSiteData && row.gameId > newestSite) {
            keys.set(row.gameId, Number.MAX_SAFE_INTEGER);
            continue;
        }
        const year = eventYear(row);
        keys.set(row.gameId, year === null ? 0 : Date.UTC(year, 0, 1) - 1);
    }
    return keys;
}

export function sortEvents(
    rows: EventListRow[],
    allRows: EventListRow[],
    sort: EventsSort,
    user: EventsUserState | null,
    completions: Map<number, EventCompletion>,
    manualOrder: string[] | null
): EventListRow[] {
    const latest = latestKeys(allRows);
    const byLatest = (left: EventListRow, right: EventListRow) =>
        (latest.get(right.gameId) ?? 0) - (latest.get(left.gameId) ?? 0) || right.gameId - left.gameId;
    const sorted = rows.slice();

    if (sort === "manual" && manualOrder !== null) {
        const index = new Map(manualOrder.map((id, position) => [Number(id), position]));
        sorted.sort((left, right) => (index.get(left.gameId) ?? Infinity) - (index.get(right.gameId) ?? Infinity));
        return sorted;
    }
    if (sort === "name") {
        sorted.sort((left, right) => left.title.localeCompare(right.title) || byLatest(left, right));
        return sorted;
    }
    if (sort === "activity") {
        sorted.sort((left, right) => activityTime(right, user) - activityTime(left, user) || byLatest(left, right));
        return sorted;
    }
    if (sort === "progress") {
        const rank = (row: EventListRow) => {
            if (completions.get(row.gameId)) {
                return 2;
            }
            return eventProgressFraction(row, user) === null ? 1 : 0;
        };
        sorted.sort((left, right) => {
            const byRank = rank(left) - rank(right);
            if (byRank !== 0) {
                return byRank;
            }
            if (rank(left) === 2) {
                return (completions.get(right.gameId)?.at ?? 0) - (completions.get(left.gameId)?.at ?? 0);
            }
            const fraction = (eventProgressFraction(right, user) ?? 0) - (eventProgressFraction(left, user) ?? 0);
            return fraction || byLatest(left, right);
        });
        return sorted;
    }
    sorted.sort(byLatest);
    return sorted;
}

export function eventTagKey(note: string | null | undefined): string {
    return parseNoteTag(note).tagKey ?? EVENTS_UNTAGGED_KEY;
}

export function eventsPrefsSummary(prefs: EventsViewPrefs, language: LanguageCode): string {
    return [
        eventsShowLabel(prefs.show, language),
        eventsTypeLabel(prefs.type, language),
        eventsSortLabel(prefs.sort, language)
    ].join(" · ");
}

export function eventsShowLabel(value: EventsShow, language: LanguageCode): string {
    switch (value) {
        case "active":
            return t(language, "Active");
        case "evergreen":
            return t(language, "Evergreen");
        case "ended":
            return t(language, "Ended");
        case "completed":
            return t(language, "Completed");
        default:
            return t(language, "All");
    }
}

export function eventsTypeLabel(value: EventsType, language: LanguageCode): string {
    switch (value) {
        case "automated":
            return t(language, "Automated");
        case "checklist":
            return t(language, "Checklist");
        case "spreadsheet":
            return t(language, "Spreadsheet");
        case "other":
            return t(language, "Other");
        case "unscanned":
            return t(language, "Pending");
        default:
            return t(language, "All types");
    }
}

export function eventsSortLabel(value: EventsSort, language: LanguageCode): string {
    switch (value) {
        case "manual":
            return t(language, "Manual");
        case "activity":
            return t(language, "My Activity");
        case "name":
            return t(language, "Name");
        case "progress":
            return t(language, "My Progress");
        default:
            return t(language, "Latest");
    }
}

export function eventsClickActionLabel(value: EventsClickAction, language: LanguageCode): string {
    return value === "track" ? t(language, "Track") : t(language, "View Info");
}

export function nextEventsClickAction(value: EventsClickAction): EventsClickAction {
    return value === "open" ? "track" : "open";
}

export function trackedEventsClickActionLabel(value: TrackedEventsClickAction, language: LanguageCode): string {
    switch (value) {
        case "untrack":
            return t(language, "Untrack");
        case "note":
            return t(language, "Note & Tag");
        case "reorder":
            return t(language, "Reorder");
        default:
            return t(language, "View Info");
    }
}

export function nextTrackedEventsClickAction(
    value: TrackedEventsClickAction,
    reorderAvailable: boolean
): TrackedEventsClickAction {
    const cycle: TrackedEventsClickAction[] = reorderAvailable
        ? ["untrack", "open", "note", "reorder"]
        : ["untrack", "open", "note"];
    const index = cycle.indexOf(value);
    return cycle[(index + 1) % cycle.length];
}

export type ChecklistLevel = 0 | 1 | 2;

export type ChecklistCard = {
    gameId: number;
    sectionLabel: string;
    auto: ChecklistLevel;
    level: ChecklistLevel;
    ticked: boolean;
    beforeEvent: boolean;
    raLevel: ChecklistLevel;
};

function tickLevel(tick: ChecklistTick | undefined, card: { auto: ChecklistLevel; raLevel: ChecklistLevel }, masterAll: boolean): ChecklistLevel {
    if (tick === undefined) {
        return card.auto;
    }
    if (tick === false) {
        return 0;
    }
    if (tick === true) {
        return card.raLevel;
    }
    return tick === "mastered" && !masterAll ? 2 : 1;
}

export function checklistTickFor(card: ChecklistCard, level: ChecklistLevel): ChecklistTick | null {
    if (level === card.auto) {
        return null;
    }
    if (level === 0) {
        return false;
    }
    if (level === card.raLevel) {
        return true;
    }
    return level === 2 ? "mastered" : "beaten";
}

export function checklistMasteryMarkable(rule: EventChecklistRule): boolean {
    return rule.kind === "points" && (rule.masteryBonus ?? 0) > 0;
}

export function checklistCards(
    checklist: EventChecklist,
    progress: Record<string, ChecklistGameProgress> | null,
    ticks: Record<string, ChecklistTick>,
    activeFrom: string | null
): ChecklistCard[] {
    const start = eventTime(activeFrom);
    const masterAll = checklist.rule.kind === "masterAll";
    const seen = new Set<number>();
    const cards: ChecklistCard[] = [];
    for (const section of checklist.sections) {
        for (const gameId of section.gameIds) {
            if (seen.has(gameId)) {
                continue;
            }
            seen.add(gameId);
            const kind = progress?.[String(gameId)]?.highestAwardKind ?? null;
            const mastered = kind === "mastered";
            const qualifies = masterAll ? mastered : (mastered || kind === "beaten-hardcore");
            const awardedAt = eventTime(progress?.[String(gameId)]?.highestAwardDate);
            const beforeEvent = qualifies && start !== null && awardedAt !== null && awardedAt < start;
            const raLevel: ChecklistLevel = mastered && !masterAll ? 2 : 1;
            const auto: ChecklistLevel = qualifies && !beforeEvent ? raLevel : 0;
            const level = tickLevel(ticks[String(gameId)], { auto, raLevel }, masterAll);
            cards.push({
                gameId,
                sectionLabel: section.label,
                auto,
                level,
                ticked: level > 0,
                beforeEvent,
                raLevel
            });
        }
    }
    return cards;
}

export function checklistPoints(cards: ChecklistCard[], rule: EventChecklistRule): number | null {
    if (!rule.kind || !rule.target) {
        return null;
    }
    const ticked = cards.filter((card) => card.ticked);
    if (rule.kind === "masterAll") {
        return ticked.length;
    }
    const bonus = rule.masteryBonus ?? 0;
    return ticked.reduce((total, card) => total + 1 + (card.level === 2 ? bonus : 0), 0);
}
