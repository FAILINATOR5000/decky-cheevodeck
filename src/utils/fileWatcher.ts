import { t, type LanguageCode } from "../locales";
import type {
    FileWatcherBucket,
    FileWatcherExcludedRow,
    FileWatcherFindingBucket,
    FileWatcherFinding,
    FileWatcherRoot,
    FileWatcherSchedule,
    FileWatcherSpeed,
    FileWatcherState,
    FileWatcherWindow
} from "../types";
import { achievementGreen, errorRed, faultViolet, warnAmber } from "./style";

export function sortWatchedRoots(roots: FileWatcherRoot[], language: LanguageCode): FileWatcherRoot[] {
    return [...roots].sort((a, b) => a.path.localeCompare(b.path, language, { sensitivity: "base" }));
}

export const FILE_WATCHER_BUCKETS: FileWatcherFindingBucket[] = [
    "corrupted",
    "unreadable",
    "replaced",
    "missing",
    "skipped",
    "added",
    "verified"
];

export function bucketLabel(bucket: FileWatcherBucket, language: LanguageCode): string {
    if (bucket === "corrupted") {
        return t(language, "Corrupted");
    }
    if (bucket === "unreadable") {
        return t(language, "Unreadable");
    }
    if (bucket === "replaced") {
        return t(language, "Replaced");
    }
    if (bucket === "missing") {
        return t(language, "Missing");
    }
    if (bucket === "skipped") {
        return t(language, "Skipped");
    }
    if (bucket === "added") {
        return t(language, "Added");
    }
    if (bucket === "excluded") {
        return t(language, "Excluded");
    }
    return t(language, "Verified");
}

export function bucketColor(bucket: FileWatcherBucket): string | undefined {
    if (bucket === "corrupted" || bucket === "unreadable") {
        return errorRed;
    }
    if (bucket === "replaced" || bucket === "missing") {
        return warnAmber;
    }
    if (bucket === "skipped") {
        return faultViolet;
    }
    if (bucket === "verified") {
        return achievementGreen;
    }
    return undefined;
}

export function bucketAction(bucket: FileWatcherBucket): "accept" | "forget" | null {
    if (bucket === "corrupted" || bucket === "replaced") {
        return "accept";
    }
    if (bucket === "missing" || bucket === "unreadable") {
        return "forget";
    }
    return null;
}

export function bucketPrompt(bucket: FileWatcherBucket, language: LanguageCode): string {
    if (bucket === "corrupted") {
        return t(language, "Press A to confirm this file is fine");
    }
    if (bucket === "replaced") {
        return t(language, "Press A to accept this file as correct");
    }
    if (bucket === "missing") {
        return t(language, "Press A to confirm you deleted this file");
    }
    if (bucket === "unreadable") {
        return t(language, "Press A to stop watching this file");
    }
    return "";
}

export function bucketConfirm(bucket: FileWatcherBucket, language: LanguageCode): string {
    if (bucket === "corrupted") {
        return t(language, "Press again to overwrite the known-good record");
    }
    if (bucket === "replaced") {
        return t(language, "Press again to accept this file");
    }
    if (bucket === "missing") {
        return t(language, "Press again to stop watching it");
    }
    if (bucket === "unreadable") {
        return t(language, "Press again to stop watching it");
    }
    return "";
}

export function errorLine(code: string): string {
    if (code === "duplicate_root") {
        return "That directory is already being watched.";
    }
    if (code === "overlapping_root") {
        return "That directory sits inside one you're already watching, or contains one. Pick another.";
    }
    if (code === "not_a_directory") {
        return "Couldn't open that directory.";
    }
    if (code === "too_many_roots") {
        return "That's as many directories as this can watch.";
    }
    if (code === "pass_running") {
        return "Cancel the scan first, then change the directories.";
    }
    if (code === "no_roots") {
        return "Add a directory first.";
    }
    if (code === "already_running") {
        return "A scan is already running.";
    }
    if (code === "unavailable") {
        return "File Watcher couldn't start up. Check the log, then try Remove File Watcher Data in Options.";
    }
    return "Something Went Wrong";
}

export function skipReasonLabel(reason: string, language: LanguageCode): string {
    if (reason === "empty") {
        return t(language, "came back empty");
    }
    return t(language, "unreachable");
}

export function fileWatcherSpeedLabel(speed: FileWatcherSpeed, language: LanguageCode): string {
    if (speed === "full") {
        return t(language, "Full Speed");
    }
    if (speed === "balanced") {
        return t(language, "Balanced");
    }
    return t(language, "Gentle");
}

export const EVERY_WEEKS_OPTIONS = [1, 2, 4, 8, 13, 26, 52];

export function everyWeeksLabel(weeks: number, language: LanguageCode): string {
    if (weeks === 4) {
        return t(language, "Every 4 weeks (about monthly)");
    }
    if (weeks === 13) {
        return t(language, "Every 13 weeks (about quarterly)");
    }
    if (weeks === 52) {
        return t(language, "Every 52 weeks (about yearly)");
    }
    return t(language, "Every {{count}} weeks", { count: weeks });
}

export function passEtaLabel(seconds: number, language: LanguageCode): string {
    if (seconds < 90) {
        const step = Math.min(90, Math.max(15, Math.round(seconds / 15) * 15));
        return t(language, "About {{count}} seconds left", { count: step });
    }
    if (seconds < 600) {
        return t(language, "About {{count}} minutes left", { count: Math.max(2, Math.round(seconds / 60)) });
    }
    if (seconds < 5400) {
        return t(language, "About {{count}} minutes left", { count: Math.round(seconds / 300) * 5 });
    }
    return t(language, "About {{count}} hours left", { count: Math.max(2, Math.round(seconds / 3600)) });
}

export function weekdayLabel(weekday: number, language: LanguageCode): string {
    const names = [
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
    ];
    return t(language, names[weekday] ?? "Sunday");
}

export function clockLabel(hour: number, minute: number): string {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function scheduleIsBlacked(schedule: FileWatcherSchedule, window: FileWatcherWindow): boolean {
    if (!schedule.enabled || !window.enabled) {
        return false;
    }
    const start = schedule.hour * 60 + schedule.minute;
    const low = window.blockFrom[0] * 60 + window.blockFrom[1];
    const high = window.blockTo[0] * 60 + window.blockTo[1];
    if (low === high) {
        return false;
    }
    if (low < high) {
        return start >= low && start < high;
    }
    return start >= low || start < high;
}

export function formatDateTime(timestamp: number, language: LanguageCode): string {
    const localeTag = language === "en" ? undefined : language;
    const when = new Date(timestamp * 1000);
    return `${when.toLocaleDateString(localeTag)}, ${when.toLocaleTimeString(localeTag, {
        hour: "2-digit",
        minute: "2-digit"
    })}`;
}

export const REPORTED_BUCKETS: FileWatcherBucket[] = ["corrupted", "unreadable", "replaced", "missing"];

type FileWatcherReportInput = {
    watcher: FileWatcherState;
    rows: Partial<Record<FileWatcherBucket, FileWatcherFinding[]>>;
    excluded: FileWatcherExcludedRow[];
    language: LanguageCode;
};

export function buildFileWatcherReport(input: FileWatcherReportInput): string {
    const { watcher, rows, excluded, language } = input;
    const lines: string[] = [];

    lines.push(t(language, "File Watcher"));
    lines.push(watcher.lastCompletedAt
        ? t(language, "Last verified: {{date}}", { date: formatDateTime(watcher.lastCompletedAt, language) })
        : t(language, "Never verified"));
    lines.push("");

    lines.push(t(language, "Watched"));
    for (const root of sortWatchedRoots(watcher.roots, language)) {
        const stats = watcher.rootStats?.[String(root.id)];
        lines.push(`  ${root.label} — ${root.path}`);
        lines.push(`    ${t(language, "{{count}} files hashed", { count: stats?.files ?? 0 })}`);
        if (root.excludes.length) {
            lines.push(`    ${t(language, "Ignore")}: ${root.excludes.join(", ")}`);
        }
    }
    lines.push("");

    lines.push(t(language, "Results"));
    for (const bucket of FILE_WATCHER_BUCKETS) {
        lines.push(`  ${bucketLabel(bucket, language)}: ${watcher.counts?.[bucket] ?? 0}`);
    }
    lines.push("");

    for (const bucket of REPORTED_BUCKETS) {
        const found = rows[bucket] ?? [];
        if (!found.length) {
            continue;
        }
        lines.push(`${bucketLabel(bucket, language)} (${found.length})`);
        for (const row of found) {
            lines.push(`  ${labelForRootId(watcher.roots, row.rootId)}/${row.relPath}`);
        }
        lines.push("");
    }

    if (excluded.length) {
        lines.push(`${bucketLabel("excluded", language)} (${excluded.length})`);
        for (const row of excluded) {
            const path = `  ${labelForRootId(watcher.roots, row.rootId)}/${row.relPath}`;
            lines.push(row.isDir
                ? `${path}  (${t(language, "folder, contents not scanned")})`
                : path);
        }
        lines.push("");
    }

    if (watcher.skipped.length) {
        lines.push(t(language, "Skipped"));
        for (const row of watcher.skipped) {
            lines.push(`  ${labelForRootId(watcher.roots, row.rootId)} — ${skipReasonLabel(row.reason, language)} — ${t(language, "{{count}} files", { count: row.fileCount })}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

function labelForRootId(roots: FileWatcherRoot[], rootId: number): string {
    return roots.find((root) => root.id === rootId)?.label ?? String(rootId);
}

export function verifiedAgoLabel(timestamp: number, language: LanguageCode): string {
    if (!timestamp) {
        return t(language, "never verified");
    }
    const days = Math.floor((Date.now() / 1000 - timestamp) / 86400);
    if (days <= 0) {
        return t(language, "verified today");
    }
    if (days === 1) {
        return t(language, "verified yesterday");
    }
    return t(language, "verified {{count}} days ago", { count: days });
}
