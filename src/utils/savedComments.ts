import type {
    GameComment,
    SaveCommentPayload,
    SavedComment,
    SavedCommentGame,
    SavedCommentSource,
    SavedCommentSourceKind,
    SavedCommentsFilter,
    SavedCommentsSort
} from "../types";

export type SavedCommentSourceInput = Omit<SavedCommentSource, "sourceId">;

type CommentLike = Pick<GameComment, "user" | "ulid" | "submitted" | "commentText">;

function savedCommentSourceId(source: SavedCommentSourceInput): string | null {
    if (source.kind === "game") {
        return source.gameId == null ? null : String(source.gameId);
    }
    if (source.kind === "achievement") {
        return source.achievementId == null ? null : String(source.achievementId);
    }
    if (source.kind === "userWall") {
        const wall = (source.wallUser || "").trim();
        return wall || null;
    }
    return null;
}

export function savedCommentMatchKey(
    kind: SavedCommentSourceKind,
    sourceId: string,
    ulid: string,
    submitted: string
): string {
    return `${kind}:${sourceId}:${(ulid || "").trim()}:${(submitted || "").trim()}`;
}

export function matchKeyForComment(
    comment: Pick<GameComment, "ulid" | "submitted">,
    source: SavedCommentSourceInput
): string | null {
    const sourceId = savedCommentSourceId(source);
    if (sourceId == null) {
        return null;
    }
    return savedCommentMatchKey(source.kind, sourceId, comment.ulid, comment.submitted);
}

export function gameCommentSource(
    gameId: number | null,
    gameTitle: string | null | undefined,
    gameImageIcon: string | null | undefined
): SavedCommentSourceInput {
    return {
        kind: "game",
        gameId,
        gameTitle: (gameTitle || "").trim(),
        gameImageIcon: (gameImageIcon || "").trim(),
        achievementId: null,
        achievementTitle: "",
        achievementImageIcon: "",
        achievementBadgeName: "",
        wallUser: ""
    };
}

export function achievementCommentSource(
    achievementId: number | null,
    achievementTitle: string | null | undefined,
    achievementImageIcon: string | null | undefined,
    achievementBadgeName: string | null | undefined,
    gameId: number | null,
    gameTitle: string | null | undefined,
    gameImageIcon: string | null | undefined
): SavedCommentSourceInput {
    return {
        kind: "achievement",
        gameId,
        gameTitle: (gameTitle || "").trim(),
        gameImageIcon: (gameImageIcon || "").trim(),
        achievementId,
        achievementTitle: (achievementTitle || "").trim(),
        achievementImageIcon: (achievementImageIcon || "").trim(),
        achievementBadgeName: (achievementBadgeName || "").trim(),
        wallUser: ""
    };
}

export function wallCommentSource(wallUser: string | null | undefined): SavedCommentSourceInput {
    return {
        kind: "userWall",
        gameId: null,
        gameTitle: "",
        gameImageIcon: "",
        achievementId: null,
        achievementTitle: "",
        achievementImageIcon: "",
        achievementBadgeName: "",
        wallUser: (wallUser || "").trim()
    };
}

export function buildSaveCommentPayload(
    comment: CommentLike,
    source: SavedCommentSourceInput
): SaveCommentPayload {
    return {
        user: (comment.user || "").trim(),
        ulid: (comment.ulid || "").trim(),
        submitted: (comment.submitted || "").trim(),
        commentText: (comment.commentText || "").trim(),
        source
    };
}

export function nextSavedSort(sort: SavedCommentsSort): SavedCommentsSort {
    if (sort === "recent") {
        return "oldest";
    }
    if (sort === "oldest") {
        return "opened";
    }
    return "recent";
}

export function filterAndSortSavedComments(
    comments: SavedComment[],
    sort: SavedCommentsSort,
    filter: SavedCommentsFilter
): SavedComment[] {
    let out = comments;
    if (filter === "achievement") {
        out = out.filter((entry) => entry.source.kind === "achievement");
    }
    else if (filter === "wall") {
        out = out.filter((entry) => entry.source.kind === "userWall");
    }
    else if (filter !== "all") {
        out = out.filter((entry) => entry.source.gameId === filter);
    }
    const key = sort === "opened"
        ? (entry: SavedComment) => entry.openedAt || entry.savedAt
        : (entry: SavedComment) => entry.savedAt;
    const sorted = [...out].sort((a, b) => key(a) - key(b));
    if (sort !== "oldest") {
        sorted.reverse();
    }
    return sorted;
}

export function distinctSavedGames(comments: SavedComment[]): SavedCommentGame[] {
    const byId = new Map<number, SavedCommentGame>();
    for (const entry of comments) {
        const gameId = entry.source.gameId;
        if (gameId == null) {
            continue;
        }
        const existing = byId.get(gameId);
        if (existing) {
            existing.count += 1;
            if (!existing.title && entry.source.gameTitle) {
                existing.title = entry.source.gameTitle;
            }
            if (!existing.imageIcon && entry.source.gameImageIcon) {
                existing.imageIcon = entry.source.gameImageIcon;
            }
        }
        else {
            byId.set(gameId, {
                gameId,
                title: entry.source.gameTitle,
                imageIcon: entry.source.gameImageIcon,
                count: 1
            });
        }
    }
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}
