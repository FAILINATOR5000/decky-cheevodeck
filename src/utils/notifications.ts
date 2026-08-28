import type { ArchiveBucket, ArchiveSort, ArchivedNotification, NotificationType } from "../types";
import { type LanguageCode, DEFAULT_LANGUAGE, t } from "../locales";

const BUCKET_BY_TYPE: Record<NotificationType, Exclude<ArchiveBucket, "all">> = {
    tracked: "unlocks",
    social: "unlocks",
    nearYou: "unlocks",
    commentTracker: "commentPosts",
    wall: "commentPosts",
    system: "system",
    debug: "system",
    noteReminder: "reminders",
    trackedSet: "masteryGoals"
};

function archiveBucketOf(type: NotificationType): Exclude<ArchiveBucket, "all"> {
    return BUCKET_BY_TYPE[type] ?? "system";
}

function matchesArchiveBucket(notification: ArchivedNotification, bucket: ArchiveBucket): boolean {
    if (bucket === "all") {
        return true;
    }
    return archiveBucketOf(notification.type) === bucket;
}

export function archiveBucketLabel(value: ArchiveBucket, language: LanguageCode = DEFAULT_LANGUAGE): string {
    if (value === "unlocks") {
        return t(language, "Unlocks");
    }
    if (value === "commentPosts") {
        return t(language, "Comment Posts");
    }
    if (value === "system") {
        return t(language, "System");
    }
    if (value === "reminders") {
        return t(language, "Reminders");
    }
    if (value === "masteryGoals") {
        return t(language, "Mastery Goals");
    }
    return t(language, "All");
}

export function nextArchiveBucket(current: ArchiveBucket): ArchiveBucket {
    const order: ArchiveBucket[] = ["all", "unlocks", "commentPosts", "system", "reminders", "masteryGoals"];
    return order[(order.indexOf(current) + 1) % order.length];
}

export function archiveSortLabel(value: ArchiveSort, language: LanguageCode = DEFAULT_LANGUAGE): string {
    if (value === "archivedAsc") {
        return t(language, "Oldest Archived");
    }
    if (value === "createdDesc") {
        return t(language, "Newest Notified");
    }
    if (value === "createdAsc") {
        return t(language, "Oldest Notified");
    }
    return t(language, "Newest Archived");
}

export function nextArchiveSort(current: ArchiveSort): ArchiveSort {
    const order: ArchiveSort[] = ["archivedDesc", "archivedAsc", "createdDesc", "createdAsc"];
    return order[(order.indexOf(current) + 1) % order.length];
}

export function filterAndSortArchived(
    items: ArchivedNotification[],
    bucket: ArchiveBucket,
    sort: ArchiveSort
): ArchivedNotification[] {
    const filtered = items.filter((item) => matchesArchiveBucket(item, bucket));
    const key: keyof ArchivedNotification = sort === "createdDesc" || sort === "createdAsc" ? "createdAt" : "archivedAt";
    const ascending = sort === "archivedAsc" || sort === "createdAsc";
    return filtered.slice().sort((a, b) => {
        const aValue = Number(a[key]) || 0;
        const bValue = Number(b[key]) || 0;
        if (aValue !== bValue) {
            return ascending ? aValue - bValue : bValue - aValue;
        }
        return ascending ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
    });
}
