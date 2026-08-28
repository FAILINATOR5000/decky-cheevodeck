import { logCommentsDebug } from "../api";
import type { AchievementOfTheWeekResponse, CommentSurfaceKey, GameComment } from "../types";
import type { CommentsSort } from "../hooks/useGameCommentsController";

export type CommentsSnapshot = {
    surfaceKey: CommentSurfaceKey;
    threadId: number | string;
    ulid: string;
    comments: GameComment[];
    sort: CommentsSort;
    offset: number;
    seen: Set<string>;
    hasMore: boolean;
    total: number | null;
    restricted: boolean;
    focusIndex: number;
    windowStart: number;
    spacerPx: number;
};

let snapshot: CommentsSnapshot | null = null;

let currentUlid = "";

export function setCommentsSnapshotUser(ulid: string): void {
    if (!ulid) {
        return;
    }
    currentUlid = ulid;
}

export function putCommentsSnapshot(next: CommentsSnapshot): void {
    logCommentsDebug(
        "snapshot-put",
        next.threadId,
        `surface=${next.surfaceKey} n=${next.comments.length} sort=${next.sort} offset=${next.offset} focus=${next.focusIndex}`
    );
    snapshot = next;
}

export function takeCommentsSnapshot(
    surfaceKey: CommentSurfaceKey,
    threadId: number | string
): CommentsSnapshot | null {
    if (!snapshot || snapshot.surfaceKey !== surfaceKey) {
        return null;
    }
    const held = snapshot;
    snapshot = null;
    if (held.threadId !== threadId || held.ulid !== currentUlid) {
        logCommentsDebug(
            "snapshot-drop",
            threadId,
            `surface=${surfaceKey} heldThread=${held.threadId} heldUlid=${held.ulid || "(none)"} currentUlid=${currentUlid || "(none)"}`
        );
        return null;
    }
    return held;
}

export function hasCommentsSnapshotFor(
    surfaceKey: CommentSurfaceKey,
    threadId: number | string
): boolean {
    if (!snapshot || snapshot.surfaceKey !== surfaceKey) {
        return false;
    }
    return snapshot.threadId === threadId && snapshot.ulid === currentUlid;
}

export function clearCommentsSnapshot(): CommentsSnapshot | null {
    const held = snapshot;
    snapshot = null;
    return held;
}

let aotwCarry: { response: AchievementOfTheWeekResponse; ulid: string } | null = null;

export function putAotwCarry(response: AchievementOfTheWeekResponse | null, ulid: string): void {
    if (!response) {
        aotwCarry = null;
        return;
    }
    logCommentsDebug("aotw-carry-put", response.payload?.achievement?.id ?? "none", `ulid=${ulid || "(none)"}`);
    aotwCarry = { response, ulid };
}

export function clearAotwCarry(): void {
    aotwCarry = null;
}

export function takeAotwCarry(): AchievementOfTheWeekResponse | null {
    const held = aotwCarry;
    aotwCarry = null;
    if (!held) {
        return null;
    }
    if (held.ulid !== currentUlid) {
        logCommentsDebug("aotw-carry-drop", held.response.payload?.achievement?.id ?? "none", `heldUlid=${held.ulid || "(none)"} currentUlid=${currentUlid || "(none)"}`);
        return null;
    }
    if (!hasCommentsRestoreForSurface("comments:aotw")) {
        logCommentsDebug("aotw-carry-drop", held.response.payload?.achievement?.id ?? "none", "no restore waiting");
        return null;
    }
    logCommentsDebug("aotw-carry-take", held.response.payload?.achievement?.id ?? "none", "");
    return held.response;
}

let postReturn: { surfaceKey: CommentSurfaceKey; threadId: number | string; ulid: string } | null = null;

export function putCommentsPostReturn(
    surfaceKey: CommentSurfaceKey,
    threadId: number | string,
    ulid: string
): void {
    logCommentsDebug("post-return-put", threadId, `surface=${surfaceKey}`);
    postReturn = { surfaceKey, threadId, ulid };
}

export function clearCommentsRestoreForSurface(surfaceKey: CommentSurfaceKey): void {
    if (snapshot && snapshot.surfaceKey === surfaceKey) {
        logCommentsDebug("snapshot-drop", snapshot.threadId, `surface=${surfaceKey} walked in forwards`);
        snapshot = null;
    }
    if (postReturn && postReturn.surfaceKey === surfaceKey) {
        postReturn = null;
    }
}

export function hasCommentsRestoreForSurface(surfaceKey: CommentSurfaceKey): boolean {
    if (snapshot && snapshot.surfaceKey === surfaceKey && snapshot.ulid === currentUlid) {
        return true;
    }
    return Boolean(postReturn && postReturn.surfaceKey === surfaceKey && postReturn.ulid === currentUlid);
}

export function hasCommentsPostReturnFor(
    surfaceKey: CommentSurfaceKey,
    threadId: number | string
): boolean {
    if (!postReturn || postReturn.surfaceKey !== surfaceKey) {
        return false;
    }
    return postReturn.threadId === threadId && postReturn.ulid === currentUlid;
}

export function takeCommentsPostReturn(
    surfaceKey: CommentSurfaceKey,
    threadId: number | string
): boolean {
    if (!postReturn || postReturn.surfaceKey !== surfaceKey) {
        return false;
    }
    const held = postReturn;
    postReturn = null;
    return held.threadId === threadId && held.ulid === currentUlid;
}
