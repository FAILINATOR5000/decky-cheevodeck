import type { AchievementRow, Payload } from "../types";
import type { AchievementSort, FriendAchievementFilter, LeaderboardAudience, MainAchievementFilter, NoteColor, TrackedAchievementAction, TrackedAchievementSort, TrackedColor, TrackedSetAButtonMode, TrackedSetFilter, TrackedSetGameSort, TrackedSetSelectorSort, TrackedSetViewMode } from "../types";
import { formatInteger } from "./format";
import { type LanguageCode, DEFAULT_LANGUAGE, t } from "../locales";

export function earned(a: AchievementRow) {
    return Boolean(a.dateEarned || a.dateEarnedHardcore);
}

export function achievementUnlockDate(a: AchievementRow) {
    return a.dateEarnedHardcore ?? a.dateEarned ?? null;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(localeTag: string | undefined, options: Intl.DateTimeFormatOptions) {
    const key = [
        localeTag ?? "",
        options.month,
        options.day,
        options.hour,
        options.minute,
        options.year ?? ""
    ].join("|");

    const cached = dateFormatters.get(key);
    if (cached) {
        return cached;
    }

    if (dateFormatters.size > 64) {
        dateFormatters.clear();
    }

    const formatter = new Intl.DateTimeFormat(localeTag, options);
    dateFormatters.set(key, formatter);
    return formatter;
}

export function formatUnlockDate(
    value: string | null | undefined,
    options: { includeYear?: boolean; numericDate?: boolean; shortYear?: boolean; dateOnly?: boolean } = {},
    language: LanguageCode = DEFAULT_LANGUAGE
) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        return "";
    }

    const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized);
    const date = new Date(hasZone ? normalized : `${normalized}Z`);
    if (Number.isNaN(date.getTime())) {
        return trimmed;
    }

    const callerPinnedFormat = options.includeYear === true || options.numericDate === true;
    const isPreviousYear = !callerPinnedFormat && date.getFullYear() !== new Date().getFullYear();
    const useNumericDate = options.numericDate === true || isPreviousYear;
    const useIncludeYear = options.includeYear === true || isPreviousYear;

    const formatOptions: Intl.DateTimeFormatOptions = {
        month: useNumericDate ? "numeric" : "short",
        day: "numeric"
    };
    if (options.dateOnly !== true) {
        formatOptions.hour = "numeric";
        formatOptions.minute = "2-digit";
    }
    if (useIncludeYear) {
        formatOptions.year = options.shortYear === true ? "2-digit" : "numeric";
    }

    const localeTag = language === "en" ? undefined : language;

    const formatted = dateFormatter(localeTag, formatOptions)
        .format(date)
        .replace(/\.,(\s)/g, ".$1");
    return formatted.replace(/\s(AM|PM)$/i, "\u00a0$1");
}

export function unlockDateLabel(a: AchievementRow, language: LanguageCode = DEFAULT_LANGUAGE) {
    return formatUnlockDate(achievementUnlockDate(a), { includeYear: true, numericDate: true, shortYear: true }, language);
}

export function isMissable(a: AchievementRow) {
    return (a.type ?? "").toLowerCase().includes("missable");
}

export function unlockedHardcore(a: AchievementRow) {
    return Boolean(a.dateEarnedHardcore);
}

export function unlockedSoftcore(a: AchievementRow) {
    return Boolean(a.dateEarned) && !a.dateEarnedHardcore;
}

export type PointsLabel =
    | { kind: "single"; text: string }
    | { kind: "split"; points: string; retroPoints: string };

export function pointsLabel(
    a: AchievementRow,
    showRetroPoints: boolean,
    language: LanguageCode = DEFAULT_LANGUAGE
): PointsLabel {
    const points = Math.max(0, Number(a.points ?? 0));
    const retroPoints = Math.max(0, Number(a.trueRatio ?? 0));

    if (showRetroPoints && retroPoints > 0) {
        return {
            kind: "split",
            points: String(points),
            retroPoints: `(${retroPoints})`
        };
    }

    if (points === 1) {
        return {
            kind: "single",
            text: t(language, "{{value}} pt", { value: points })
        };
    }

    return {
        kind: "single",
        text: t(language, "{{value}} pts", { value: points })
    };
}

export function communityCompletionLabel(
    a: AchievementRow,
    playerCount: number,
    language: LanguageCode = DEFAULT_LANGUAGE
) {
    const numerator = Math.max(0, a.numAwarded);
    const denominator = Math.max(0, Number(playerCount ?? 0));

    if (!numerator || !denominator) {
        return null;
    }

    const safeNumerator = Math.min(numerator, denominator);
    const rawPercent = (safeNumerator / denominator) * 100;
    const [whole, decimals] = rawPercent.toFixed(2).split(".");
    const tenths = decimals[0];
    const percent = tenths === "0" ? whole : `${whole}.${tenths}`;

    return t(language, "Earned by {{percent}}% of players", { percent });
}

export function payloadAchievementSummaryLabel(payload: Payload, language: LanguageCode = DEFAULT_LANGUAGE) {
    const achievementCount = Math.max(0, Number(payload.numAchievements ?? payload.achievements?.length ?? 0));
    const totalPoints = (payload.achievements ?? []).reduce(
        (sum, achievement) => sum + Math.max(0, Number(achievement.points ?? 0)),
        0
    );

    return t(language, "{{count}} Achievements • Worth {{points}} points", {
        count: formatInteger(achievementCount),
        points: formatInteger(totalPoints)
    });
}

export function mainAchievementFilterLabel(value: MainAchievementFilter, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "locked") {
        return t(language, "Locked");
    }
    if (value === "unlocked-hardcore") {
        return t(language, "Unlocked: Hardcore");
    }
    if (value === "unlocked-softcore") {
        return t(language, "Unlocked: Softcore");
    }
    if (value === "missable") {
        return t(language, "Missable");
    }
    return t(language, "All");
}

export function nextMainAchievementFilter(current: MainAchievementFilter) {
    const order: MainAchievementFilter[] = ["all", "locked", "unlocked-hardcore", "unlocked-softcore", "missable"];
    const currentIndex = order.indexOf(current);

    return order[(currentIndex + 1) % order.length];
}

export function leaderboardAudienceLabel(value: LeaderboardAudience, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "friends") {
        return t(language, "Friends");
    }
    return t(language, "All");
}

export function nextLeaderboardAudience(current: LeaderboardAudience) {
    const order: LeaderboardAudience[] = ["all", "friends"];
    const currentIndex = order.indexOf(current);

    return order[(currentIndex + 1) % order.length];
}

export function nextFriendAchievementFilter(current: FriendAchievementFilter) {
    const order: FriendAchievementFilter[] = ["all", "locked", "unlocked-hardcore", "unlocked-softcore", "missable"];
    const currentIndex = order.indexOf(current);

    return order[(currentIndex + 1) % order.length];
}

export function metricSortComparator(
    sort: AchievementSort | TrackedAchievementSort
): ((a: AchievementRow, b: AchievementRow) => number) | null {
    if (sort === "mostPoints") {
        return (a, b) => (b.points - a.points) || (a.id - b.id);
    }
    if (sort === "fewestPoints") {
        return (a, b) => (a.points - b.points) || (a.id - b.id);
    }
    if (sort === "rarest") {
        return (a, b) => (a.numAwarded - b.numAwarded) || (a.id - b.id);
    }
    if (sort === "mostCommon") {
        return (a, b) => (b.numAwarded - a.numAwarded) || (a.id - b.id);
    }

    return null;
}

export function achievementSortLabel(value: AchievementSort, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "absolute") {
        return t(language, "List Order");
    }
    if (value === "mostPoints") {
        return t(language, "Most Points");
    }
    if (value === "fewestPoints") {
        return t(language, "Fewest Points");
    }
    if (value === "rarest") {
        return t(language, "Rarest");
    }
    if (value === "mostCommon") {
        return t(language, "Most Common");
    }
    return t(language, "Up Next");
}

export function nextAchievementSort(current: AchievementSort): AchievementSort {
    const order: AchievementSort[] = ["upNext", "absolute", "mostPoints", "fewestPoints", "rarest", "mostCommon"];
    const currentIndex = order.indexOf(current);

    return order[(currentIndex + 1) % order.length];
}

export function trackedAchievementSortLabel(value: TrackedAchievementSort, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "manual") {
        return t(language, "Manual");
    }
    if (value === "mostPoints") {
        return t(language, "Most Points");
    }
    if (value === "fewestPoints") {
        return t(language, "Fewest Points");
    }
    if (value === "rarest") {
        return t(language, "Rarest");
    }
    if (value === "mostCommon") {
        return t(language, "Most Common");
    }
    return t(language, "Up Next");
}

export function nextTrackedAchievementSort(current: TrackedAchievementSort): TrackedAchievementSort {
    const order: TrackedAchievementSort[] = ["upNext", "manual", "mostPoints", "fewestPoints", "rarest", "mostCommon"];
    const currentIndex = order.indexOf(current);

    return order[(currentIndex + 1) % order.length];
}

export function trackedAchievementActionLabel(value: TrackedAchievementAction, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "info") {
        return t(language, "View Info");
    }
    if (value === "editNote") {
        return t(language, "Note & Tag");
    }
    if (value === "reorder") {
        return t(language, "Reorder");
    }
    return t(language, "Untrack");
}

export function nextTrackedAchievementAction(
    current: TrackedAchievementAction,
    sort: TrackedAchievementSort,
    trackedCount: number
): TrackedAchievementAction {
    const reorderAvailable = sort === "manual" && trackedCount >= 2;

    if (current === "untrack") {
        return "info";
    }
    if (current === "info") {
        return "editNote";
    }
    if (current === "editNote") {
        return reorderAvailable ? "reorder" : "untrack";
    }
    return "untrack";
}

export type ParsedNote = {
    tag: string | null;
    tagKey: string | null;
    body: string;
};

const TAG_PATTERN = /^\s*\[([^\]\n]{1,24})\]\s*/;

const RESERVED_TAG_KEYS: ReadonlySet<string> = new Set(["completed"]);

export function parseNoteTag(note: string | null | undefined): ParsedNote {
    const source = (note ?? "").toString();
    const match = source.match(TAG_PATTERN);
    if (!match) {
        return { tag: null, tagKey: null, body: source };
    }
    const raw = match[1].trim();
    if (!raw) {
        return { tag: null, tagKey: null, body: source.slice(match[0].length) };
    }
    const key = raw.toLowerCase();
    if (RESERVED_TAG_KEYS.has(key)) {
        return { tag: null, tagKey: null, body: source.slice(match[0].length) };
    }
    return {
        tag: raw,
        tagKey: key,
        body: source.slice(match[0].length)
    };
}

export function applyTagToNoteBody(body: string, tag: string | null): string {
    const parsed = parseNoteTag(body);
    if (tag === null) {
        return parsed.body;
    }
    const cleanTag = tag.trim();
    if (!cleanTag) {
        return parsed.body;
    }
    return `[${cleanTag}]${parsed.body}`;
}

export const NOTE_COLOR_OPTIONS: readonly NoteColor[] = [
    "default",
    "green",
    "amber",
    "orange",
    "red",
    "pink",
    "purple",
    "blue",
    "sky",
    "cyan",
    "teal",
    "lime",
    "gray",
    "indigo",
    "rose",
    "fuchsia",
    "violet",
    "emerald",
    "yellow",
    "brown",
    "slate",
    "crimson",
    "mint",
    "coral",
    "gold",
    "steel"
];

const NOTE_COLOR_HEX: Record<Exclude<NoteColor, "default">, string> = {
    green: "#22c55e",
    amber: "#f59e0b",
    orange: "#f97316",
    red: "#ef4444",
    pink: "#ec4899",
    purple: "#a855f7",
    blue: "#3b82f6",
    sky: "#0ea5e9",
    cyan: "#06b6d4",
    teal: "#14b8a6",
    lime: "#a3e635",
    gray: "#9ca3af",
    indigo: "#6366f1",
    rose: "#f43f5e",
    fuchsia: "#d946ef",
    violet: "#8b5cf6",
    emerald: "#10b981",
    yellow: "#eab308",
    brown: "#a16207",
    slate: "#64748b",
    crimson: "#be123c",
    mint: "#34d399",
    coral: "#fb7185",
    gold: "#ca8a04",
    steel: "#475569"
};

export function noteBodyColor(key: NoteColor | null | undefined): string | undefined {
    if (!key || key === "default") {
        return undefined;
    }
    return NOTE_COLOR_HEX[key];
}

export function noteColorIsTransparent(key: NoteColor | null | undefined): boolean {
    return !key || key === "default";
}

const TRACKED_COLOR_OPTIONS: readonly TrackedColor[] = [
    "default",
    "red",
    "orange",
    "amber",
    "green",
    "teal",
    "cyan",
    "purple",
    "pink",
    "white"
];

const TRACKED_COLOR_HEX: Record<TrackedColor, string> = {
    default: "#4a90e2",
    red: "#ef4444",
    orange: "#f97316",
    amber: "#f59e0b",
    green: "#22c55e",
    teal: "#14b8a6",
    cyan: "#06b6d4",
    purple: "#a855f7",
    pink: "#ec4899",
    white: "#f3f4f6"
};

export function trackedColorHex(key: TrackedColor | null | undefined): string {
    if (!key) {
        return TRACKED_COLOR_HEX.default;
    }
    return TRACKED_COLOR_HEX[key] ?? TRACKED_COLOR_HEX.default;
}

export function trackedColorLabelKey(key: TrackedColor): string {
    return key.charAt(0).toUpperCase() + key.slice(1);
}

export function nextTrackedColor(current: TrackedColor): TrackedColor {
    const currentIndex = TRACKED_COLOR_OPTIONS.indexOf(current);
    return TRACKED_COLOR_OPTIONS[(currentIndex + 1) % TRACKED_COLOR_OPTIONS.length];
}

export function trackedSetSelectorSortLabel(value: TrackedSetSelectorSort, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "recent") {
        return t(language, "Recent");
    }
    if (value === "oldest") {
        return t(language, "Oldest");
    }
    if (value === "completionDesc") {
        return t(language, "Most Completed");
    }
    if (value === "completionAsc") {
        return t(language, "Least Completed");
    }
    if (value === "gameCountDesc") {
        return t(language, "Most Games");
    }
    if (value === "gameCountAsc") {
        return t(language, "Least Games");
    }
    return t(language, "A–Z");
}

export function nextTrackedSetSelectorSort(current: TrackedSetSelectorSort): TrackedSetSelectorSort {
    const order: TrackedSetSelectorSort[] = [
        "alphabetical",
        "recent",
        "oldest",
        "completionDesc",
        "completionAsc",
        "gameCountDesc",
        "gameCountAsc"
    ];
    return order[(order.indexOf(current) + 1) % order.length];
}

export function trackedSetGameSortLabel(value: TrackedSetGameSort, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "recent") {
        return t(language, "Recently Added");
    }
    if (value === "oldest") {
        return t(language, "Oldest Added");
    }
    return t(language, "Manual");
}

export function nextTrackedSetGameSort(current: TrackedSetGameSort): TrackedSetGameSort {
    const order: TrackedSetGameSort[] = ["manual", "recent", "oldest"];
    return order[(order.indexOf(current) + 1) % order.length];
}

export function trackedSetViewModeLabel(value: TrackedSetViewMode, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "system") {
        return t(language, "System (By Console)");
    }
    if (value === "systemYear") {
        return t(language, "System (Year)");
    }
    if (value === "retroHistory") {
        return "RetroHistory (Year)";
    }
    if (value === "retroHistoryAlpha") {
        return "RetroHistory (By Console)";
    }
    return t(language, "Regular");
}

export function gamesCountLabel(language: LanguageCode, count: number, pct?: number): string {
    if (pct === undefined) {
        return t(language, count === 1 ? "{{count}} game" : "{{count}} games", { count });
    }
    return t(
        language,
        count === 1 ? "{{count}} game \u00b7 {{pct}}%" : "{{count}} games \u00b7 {{pct}}%",
        { count, pct }
    );
}

export function nextTrackedSetViewMode(current: TrackedSetViewMode): TrackedSetViewMode {
    const order: TrackedSetViewMode[] = ["all", "system", "systemYear", "retroHistoryAlpha", "retroHistory"];
    return order[(order.indexOf(current) + 1) % order.length];
}

export function trackedSetFilterLabel(value: TrackedSetFilter, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (value === "completed") {
        return t(language, "Completed");
    }
    if (value === "incomplete") {
        return t(language, "Incomplete");
    }
    return t(language, "All");
}

export function nextTrackedSetFilter(current: TrackedSetFilter): TrackedSetFilter {
    const order: TrackedSetFilter[] = ["all", "completed", "incomplete"];
    return order[(order.indexOf(current) + 1) % order.length];
}

export function trackedSetAButtonModeLabel(
    value: TrackedSetAButtonMode,
    language: LanguageCode = DEFAULT_LANGUAGE
) {
    if (value === "info") {
        return t(language, "View Info");
    }
    if (value === "reorder") {
        return t(language, "Reorder");
    }
    return t(language, "Note");
}

export function nextTrackedSetAButtonMode(
    current: TrackedSetAButtonMode,
    sort: TrackedSetGameSort,
    gameCount: number
): TrackedSetAButtonMode {
    const reorderAvailable = sort === "manual" && gameCount >= 2;

    if (current === "info") {
        return "editNote";
    }
    if (current === "editNote") {
        return reorderAvailable ? "reorder" : "info";
    }
    return "info";
}
