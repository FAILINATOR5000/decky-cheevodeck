import type { AotwComment, CheevoNotification, GameComment, NotificationIconSource, NotificationKind, NotificationType } from "../types";
import {
    achievementCommentSource,
    gameCommentSource,
    wallCommentSource,
    type SavedCommentSourceInput
} from "../utils/savedComments";

export type NotificationNav = {
    openGameNotes: (gameId: number, noteId: string) => void;
    openGameOverview?: (gameId: number, viewedUsername?: string, viewedUserRef?: string) => void;
    openAchievementOverview?: (gameId: number, achievementId: number, viewedUsername?: string, viewedUserRef?: string) => void;
    openTrackedSet?: (setId: string) => void;
    openAbout?: () => void;
    openCheevoCheck?: () => void;
    openFileWatcher?: () => void;
    openChangelog?: (body: string) => void;
    openMessage?: (body: string) => void;
    openExternalUrl?: (url: string) => void;
    openMultipath?: (ctx: NotificationMultipathContext) => void;
};

type NotificationMultipathContext = {
    kind: "bucketA" | "bucketB";
    gameId: number;
    achievementId?: number;
    username: string;
    ulid?: string;
    comment: AotwComment | GameComment | null;
    externalUrl: string | null;
    iconSource: NotificationIconSource;
    badgeName?: string;
    commentSource?: SavedCommentSourceInput;
    gameImageIcon?: string;
};

type NotificationTypeEntry = {
    labelKey: string;
    kind: NotificationKind;
    onClick?: (n: CheevoNotification, nav: NotificationNav) => void;
};

function commentFromMeta(meta: Record<string, unknown> | null): AotwComment {
    const rawUser = meta?.username;
    const rawUlid = meta?.ulid;
    const rawSubmitted = meta?.submitted;
    const rawText = meta?.commentText;
    return {
        user: typeof rawUser === "string" ? rawUser : "",
        ulid: typeof rawUlid === "string" ? rawUlid : "",
        submitted: typeof rawSubmitted === "string" ? rawSubmitted : "",
        commentText: typeof rawText === "string" ? rawText : "",
    };
}

function readText(meta: Record<string, unknown> | null, key: string): string {
    const raw = meta?.[key];
    return typeof raw === "string" ? raw : "";
}

function threadCommentSource(n: CheevoNotification): SavedCommentSourceInput {
    const gameId = n.target?.gameId ?? null;
    const title = readText(n.meta, "threadTitle");
    const icon = readText(n.meta, "iconUrl");
    if (readText(n.meta, "kind") !== "achievement") {
        return gameCommentSource(gameId, title, icon);
    }
    const rawAchievementId = n.meta?.achievementId;
    return achievementCommentSource(
        typeof rawAchievementId === "number" ? rawAchievementId : null,
        title,
        icon,
        readText(n.meta, "badgeName"),
        gameId,
        readText(n.meta, "gameTitle"),
        ""
    );
}

export const NOTIFICATION_REGISTRY: Record<NotificationType, NotificationTypeEntry> = {
    noteReminder: {
        labelKey: "Note Reminder Notifications",
        kind: "actionable",
        onClick: (n, nav) => {
            const target = n.target;
            if (target && target.gameId != null && target.noteId) {
                nav.openGameNotes(target.gameId, target.noteId);
            }
        },
    },
    trackedSet: {
        labelKey: "Mastery Goal Notifications",
        kind: "actionable",
        onClick: (n, nav) => {
            const target = n.target;
            if (target && target.setId && nav.openTrackedSet) {
                nav.openTrackedSet(target.setId);
            }
        },
    },
    commentTracker: {
        labelKey: "Comment Tracker Notifications",
        kind: "actionable",
        onClick: (n, nav) => {
            const rawUrl = n.meta?.url;
            const url = (typeof rawUrl === "string" ? rawUrl : n.target?.url) ?? null;
            if (n.meta?.bulk === true) {
                if (url && nav.openExternalUrl) {
                    nav.openExternalUrl(url);
                }
                return;
            }
            const comment = commentFromMeta(n.meta);
            if (comment.ulid && nav.openMultipath) {
                nav.openMultipath({
                    kind: "bucketB",
                    gameId: n.target?.gameId ?? 0,
                    username: comment.user,
                    ulid: comment.ulid || undefined,
                    comment,
                    externalUrl: url,
                    iconSource: n.iconSource,
                    commentSource: threadCommentSource(n)
                });
            }
        },
    },
    wall: {
        labelKey: "Wall Notifications",
        kind: "actionable",
        onClick: (n, nav) => {
            const rawUrl = n.meta?.url;
            const url = (typeof rawUrl === "string" ? rawUrl : n.target?.url) ?? null;
            if (n.meta?.bulk === true) {
                if (url && nav.openExternalUrl) {
                    nav.openExternalUrl(url);
                }
                return;
            }
            const comment = commentFromMeta(n.meta);
            if (comment.ulid && nav.openMultipath) {
                nav.openMultipath({
                    kind: "bucketB",
                    gameId: n.target?.gameId ?? 0,
                    username: comment.user,
                    ulid: comment.ulid || undefined,
                    comment,
                    externalUrl: url,
                    iconSource: n.iconSource,
                    commentSource: wallCommentSource(readText(n.meta, "wallUser"))
                });
            }
        },
    },
    system: {
        labelKey: "System Notifications",
        kind: "actionable",
        onClick: (n, nav) => {
            if (n.target?.view === "cheevoCheck" && nav.openCheevoCheck) {
                nav.openCheevoCheck();
                return;
            }
            if (n.target?.view === "fileWatcher" && nav.openFileWatcher) {
                nav.openFileWatcher();
                return;
            }
            if (n.target?.view === "message" && nav.openMessage) {
                nav.openMessage(n.body);
                return;
            }
            if (n.target?.view === "changelog" && nav.openChangelog) {
                nav.openChangelog(n.body);
                return;
            }
            if (nav.openAbout) {
                nav.openAbout();
            }
        },
    },
    tracked: {
        labelKey: "Tracked Achievement Notifications",
        kind: "actionable",
        onClick: (n, nav) => {
            const target = n.target;
            if (target && target.gameId != null && target.achievementId != null && nav.openAchievementOverview) {
                nav.openAchievementOverview(target.gameId, target.achievementId);
            }
        },
    },
    social: {
        labelKey: "Social Activity Notifications",
        kind: "actionable",
        onClick: (n, nav) => {
            const target = n.target;
            const rawUsername = n.meta?.username;
            const username = typeof rawUsername === "string" ? rawUsername : "";
            const rawUlid = n.meta?.ulid;
            const ulid = typeof rawUlid === "string" ? rawUlid : "";
            const rawBadge = n.meta?.badgeName;
            const badgeName = typeof rawBadge === "string" ? rawBadge : "";
            const rawGameIcon = n.meta?.gameImageIcon;
            const gameImageIcon = typeof rawGameIcon === "string" ? rawGameIcon : "";
            if (target && target.gameId != null && target.achievementId != null && username && nav.openMultipath) {
                nav.openMultipath({
                    kind: "bucketA",
                    gameId: target.gameId,
                    achievementId: target.achievementId,
                    username,
                    ulid: ulid || undefined,
                    comment: null,
                    externalUrl: null,
                    iconSource: n.iconSource,
                    badgeName: badgeName || undefined,
                    gameImageIcon: gameImageIcon || undefined
                });
            }
        },
    },
    nearYou: {
        labelKey: "Players Near You Notifications",
        kind: "actionable",
        onClick: (n, nav) => {
            const target = n.target;
            const rawUsername = n.meta?.username;
            const username = typeof rawUsername === "string" ? rawUsername : "";
            const rawUlid = n.meta?.ulid;
            const ulid = typeof rawUlid === "string" ? rawUlid : "";
            const rawBadge = n.meta?.badgeName;
            const badgeName = typeof rawBadge === "string" ? rawBadge : "";
            const rawGameIcon = n.meta?.gameImageIcon;
            const gameImageIcon = typeof rawGameIcon === "string" ? rawGameIcon : "";
            if (target && target.gameId != null && target.achievementId != null && username && nav.openMultipath) {
                nav.openMultipath({
                    kind: "bucketA",
                    gameId: target.gameId,
                    achievementId: target.achievementId,
                    username,
                    ulid: ulid || undefined,
                    comment: null,
                    externalUrl: null,
                    iconSource: n.iconSource,
                    badgeName: badgeName || undefined,
                    gameImageIcon: gameImageIcon || undefined
                });
            }
        },
    },
    debug: {
        labelKey: "Debug Notifications",
        kind: "info",
    },
};
