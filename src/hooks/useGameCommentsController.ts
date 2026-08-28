import { useCallback, useEffect, useRef, useState } from "react";
import { logCommentsDebug } from "../api";
import { useFocusClaim } from "./useFocusClaim";
import type { RestoredCommentsWindow } from "./useCommentsWindow";
import { clearCommentsSnapshot, takeCommentsPostReturn, takeCommentsSnapshot } from "../utils/commentsSnapshot";
import { commentIdentity } from "../utils/commentIdentity";
import type { AotwComment, CommentSurfaceKey, GameComment } from "../types";

export type CommentsSort = "newest" | "oldest";

const STATIC_COMMENTS_PAGE_SIZE = 20;

type CommentsIpcResult = {
    comments?: GameComment[] | null;
    total?: number | null;
    nextOffset?: number | null;
    hasMore?: boolean | null;
    error?: string | null;
    needsSettings?: boolean | null;
    restricted?: boolean | null;
};

type CommentsIpc<TId extends number | string = number> = (
    id: TId,
    sort: CommentsSort,
    offset: number,
    limit: number
) => Promise<CommentsIpcResult>;

export type UseGameCommentsControllerOptions<TId extends number | string = number> = {
    isActive: boolean;
    id: TId | null;
    ipc: CommentsIpc<TId>;
    dynamicComments: boolean;
    dynamicCommentsInitialRows: number;
    dynamicCommentsRowStep: number;
    surfaceKey: CommentSurfaceKey;
    loadErrorMessage: string;
    loadMoreErrorMessage: string;
    legacyLoading?: boolean;
};

export function useGameCommentsController<TId extends number | string = number>(
    options: UseGameCommentsControllerOptions<TId>
) {
    const {
        isActive,
        id,
        ipc,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        surfaceKey,
        loadErrorMessage,
        loadMoreErrorMessage,
        legacyLoading = false
    } = options;

    const [comments, setComments] = useState<GameComment[]>([]);
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
    const [commentsError, setCommentsError] = useState<string | null>(null);
    const [commentsTotal, setCommentsTotal] = useState<number | null>(null);
    const [commentsHasMore, setCommentsHasMore] = useState(true);
    const [commentsSort, setCommentsSort] = useState<CommentsSort>("newest");
    const [commentsNeedsSettings, setCommentsNeedsSettings] = useState(false);
    const [commentsRestricted, setCommentsRestricted] = useState(false);
    const commentsOffsetRef = useRef(0);
    const [commentsForId, setCommentsForId] = useState<TId | null>(null);
    const [commentsWindow, setCommentsWindow] = useState<RestoredCommentsWindow | null>(null);

    const commentsRunIdRef = useRef(0);

    const seenCommentsRef = useRef<Set<string>>(new Set());

    const seededSortRef = useRef<CommentsSort | null>(null);

    const seededForIdRef = useRef<TId | null>(null);

    const cardClaim = useFocusClaim();

    const postClaim = useFocusClaim();

    const deferredClaimRef = useRef<{ kind: "card" | "post"; slot: number; forId: TId } | null>(null);

    function claimWhenReady(next: { kind: "card" | "post"; slot: number; forId: TId }) {
        if (!isActive) {
            deferredClaimRef.current = next;
            return;
        }
        if (next.kind === "card") {
            cardClaim.claimSlot(next.slot);
            return;
        }
        postClaim.claimSlot(next.slot);
    }

    function resetCommentsSlice() {
        setComments([]);
        setCommentsTotal(null);
        setCommentsHasMore(true);
        setCommentsError(null);
        setCommentsForId(null);
        setCommentsRestricted(false);
        setCommentsLoadingMore(false);
        setCommentsWindow(null);
        commentsOffsetRef.current = 0;
        seenCommentsRef.current = new Set();
    }

    useEffect(() => {
        if (id === commentsForId) {
            return;
        }
        if (deferredClaimRef.current && deferredClaimRef.current.forId !== id) {
            deferredClaimRef.current = null;
        }
        const restored = id == null || legacyLoading ? null : takeCommentsSnapshot(surfaceKey, id);
        if (id != null && restored) {
            logCommentsDebug(
                "seed",
                restored.threadId,
                `surface=${surfaceKey} got=${restored.comments.length} sort=${restored.sort} offset=${restored.offset} hasMore=${restored.hasMore} focus=${restored.focusIndex}`
            );
            commentsRunIdRef.current += 1;
            seededForIdRef.current = id;
            seededSortRef.current = restored.sort;
            commentsOffsetRef.current = restored.offset;
            seenCommentsRef.current = new Set(restored.seen);
            setComments(restored.comments);
            setCommentsWindow({ start: restored.windowStart, spacerPx: restored.spacerPx });
            setCommentsForId(id);
            setCommentsSort(restored.sort);
            setCommentsTotal(restored.total);
            setCommentsHasMore(restored.hasMore);
            setCommentsRestricted(restored.restricted);
            setCommentsError(null);
            setCommentsNeedsSettings(false);
            setCommentsLoadingMore(false);
            setCommentsLoading(false);
            if (restored.focusIndex >= 0) {
                claimWhenReady({ kind: "card", slot: restored.focusIndex, forId: id });
            }
            return;
        }
        if (id != null && !legacyLoading && takeCommentsPostReturn(surfaceKey, id)) {
            logCommentsDebug("post-return", id, `surface=${surfaceKey} active=${isActive}`);
            claimWhenReady({ kind: "post", slot: 0, forId: id });
        }
        seededForIdRef.current = null;
        resetCommentsSlice();
        setCommentsNeedsSettings(false);
    }, [id, commentsForId, surfaceKey, isActive, legacyLoading, cardClaim.claimSlot, postClaim.claimSlot]);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        const waiting = deferredClaimRef.current;
        if (!waiting) {
            return;
        }
        if (waiting.forId !== id) {
            deferredClaimRef.current = null;
            return;
        }
        deferredClaimRef.current = null;
        logCommentsDebug("claim-deferred", id ?? "null", `surface=${surfaceKey} kind=${waiting.kind} slot=${waiting.slot}`);
        if (waiting.kind === "card") {
            cardClaim.claimSlot(waiting.slot);
            return;
        }
        postClaim.claimSlot(waiting.slot);
    }, [isActive, id, surfaceKey, cardClaim.claimSlot, postClaim.claimSlot]);

    const loadFirstCommentsPage = useCallback(async () => {
        if (id == null) {
            return;
        }
        const targetId = id;
        const runId = commentsRunIdRef.current + 1;
        commentsRunIdRef.current = runId;
        const owned = () => commentsRunIdRef.current === runId;

        logCommentsDebug(
            "first-start",
            targetId,
            `surface=${surfaceKey} sort=${commentsSort} runId=${runId}`
        );

        setCommentsLoading(true);
        setCommentsError(null);
        setComments([]);
        setCommentsTotal(null);
        setCommentsHasMore(true);
        setCommentsRestricted(false);
        commentsOffsetRef.current = 0;

        const requested = dynamicComments ? dynamicCommentsInitialRows : STATIC_COMMENTS_PAGE_SIZE;
        try {
            const result = await ipc(targetId, commentsSort, 0, requested);
            if (!owned()) {
                logCommentsDebug(
                    "first-stale",
                    targetId,
                    `surface=${surfaceKey} runId=${runId} currentRunId=${commentsRunIdRef.current}`
                );
                return;
            }
            clearCommentsSnapshot();
            if (result.needsSettings) {
                setCommentsNeedsSettings(true);
                return;
            }
            setCommentsRestricted(Boolean(result.restricted));
            const pageComments = result.comments ?? [];
            const seen = new Set<string>();
            for (const c of pageComments) {
                const key = commentIdentity(c);
                if (key) {
                    seen.add(key);
                }
            }
            seenCommentsRef.current = seen;
            setComments(pageComments);
            setCommentsForId(targetId);
            commentsOffsetRef.current = result.nextOffset != null
                ? result.nextOffset
                : pageComments.length;
            setCommentsTotal(result.total ?? null);
            let moreAvailable: boolean;
            if (typeof result.hasMore === "boolean") {
                moreAvailable = result.hasMore;
            } else {
                const totalKnown = result.total != null;
                const reachedTotal = totalKnown && pageComments.length >= (result.total as number);
                const emptyPage = pageComments.length === 0;
                moreAvailable = totalKnown ? !reachedTotal : !emptyPage;
            }
            setCommentsHasMore(dynamicComments && moreAvailable);
            logCommentsDebug(
                "first-ok",
                targetId,
                `surface=${surfaceKey} got=${pageComments.length} total=${result.total ?? "null"} nextOffset=${result.nextOffset ?? "null"} backendHasMore=${result.hasMore ?? "null"} seenSize=${seen.size} hasMore=${dynamicComments && moreAvailable}`
            );
            if (result.error) {
                setCommentsError(result.error);
            }
        } catch (error: any) {
            if (!owned()) {
                return;
            }
            setCommentsError(String(error?.message || error || loadErrorMessage));
        } finally {
            if (owned()) {
                setCommentsLoading(false);
            }
        }
    }, [id, commentsSort, dynamicComments, dynamicCommentsInitialRows, ipc, loadErrorMessage, surfaceKey]);

    const loadMoreComments = async () => {
        logCommentsDebug(
            "more-enter",
            id ?? "null",
            `surface=${surfaceKey} dynamicComments=${dynamicComments} loading=${commentsLoading} loadingMore=${commentsLoadingMore} hasMore=${commentsHasMore} commentsForId=${commentsForId}`
        );
        if (id == null) {
            return;
        }
        if (!dynamicComments) {
            logCommentsDebug("more-skip-static", id, `surface=${surfaceKey}`);
            return;
        }
        if (commentsLoading || commentsLoadingMore) {
            logCommentsDebug(
                "more-skip-busy",
                id,
                `surface=${surfaceKey} loading=${commentsLoading} loadingMore=${commentsLoadingMore}`
            );
            return;
        }
        if (!commentsHasMore) {
            logCommentsDebug("more-skip-nomore", id, `surface=${surfaceKey}`);
            return;
        }
        if (commentsForId !== id) {
            logCommentsDebug(
                "more-skip-not-loaded",
                id,
                `surface=${surfaceKey} commentsForId=${commentsForId}`
            );
            return;
        }
        const targetId = id;
        const runId = commentsRunIdRef.current + 1;
        commentsRunIdRef.current = runId;
        const owned = () => commentsRunIdRef.current === runId;

        const startingOffset = commentsOffsetRef.current;
        setCommentsLoadingMore(true);

        logCommentsDebug(
            "more-start",
            targetId,
            `surface=${surfaceKey} sort=${commentsSort} offset=${startingOffset} runId=${runId}`
        );

        const requested = dynamicCommentsRowStep;
        try {
            const result = await ipc(targetId, commentsSort, startingOffset, requested);
            if (!owned()) {
                logCommentsDebug(
                    "more-stale",
                    targetId,
                    `surface=${surfaceKey} runId=${runId} currentRunId=${commentsRunIdRef.current}`
                );
                return;
            }
            const pageComments = result.comments ?? [];
            const seen = seenCommentsRef.current;
            const seenSizeBefore = seen.size;
            const freshComments: GameComment[] = [];
            for (const c of pageComments) {
                const key = commentIdentity(c);
                if (!key || seen.has(key)) {
                    continue;
                }
                seen.add(key);
                freshComments.push(c);
            }
            if (freshComments.length > 0) {
                setComments((prev) => [...prev, ...freshComments]);
            }
            const newOffset = result.nextOffset != null
                ? result.nextOffset
                : startingOffset + pageComments.length;
            commentsOffsetRef.current = newOffset;
            if (result.total != null) {
                setCommentsTotal(result.total);
            }
            let moreAvailable: boolean;
            if (typeof result.hasMore === "boolean") {
                moreAvailable = result.hasMore && freshComments.length > 0;
            } else {
                const totalForCheck = result.total ?? commentsTotal;
                const totalKnown = totalForCheck != null;
                const reachedTotal = totalKnown && newOffset >= (totalForCheck as number);
                const nothingNew = freshComments.length === 0;
                moreAvailable = totalKnown ? !reachedTotal && !nothingNew : !nothingNew;
            }
            setCommentsHasMore(moreAvailable);
            logCommentsDebug(
                "more-ok",
                targetId,
                `surface=${surfaceKey} got=${pageComments.length} fresh=${freshComments.length} total=${result.total ?? "null"} backendHasMore=${result.hasMore ?? "null"} seenBefore=${seenSizeBefore} seenAfter=${seen.size} newOffset=${newOffset} hasMore=${moreAvailable}`
            );
            if (result.error) {
                setCommentsError(result.error);
            }
        } catch (error: any) {
            if (!owned()) {
                return;
            }
            setCommentsError(String(error?.message || error || loadMoreErrorMessage));
        } finally {
            if (owned()) {
                setCommentsLoadingMore(false);
            }
        }
    };

    const captureComments = (pressed: AotwComment | GameComment) => {
        if (legacyLoading) {
            return null;
        }
        return {
            comments,
            sort: commentsSort,
            offset: commentsOffsetRef.current,
            seen: new Set(seenCommentsRef.current),
            hasMore: commentsHasMore,
            total: commentsTotal,
            restricted: commentsRestricted,
            focusIndex: comments.findIndex((c) => c === pressed)
        };
    };

    useEffect(() => {
        if (!isActive) {
            return;
        }
        if (id == null) {
            return;
        }
        if (commentsLoading || commentsLoadingMore) {
            return;
        }
        if (commentsForId === id) {
            return;
        }
        if (seededForIdRef.current === id) {
            return;
        }
        if (commentsError) {
            return;
        }
        if (commentsNeedsSettings) {
            return;
        }
        void loadFirstCommentsPage();
    }, [
        isActive,
        id,
        commentsForId,
        commentsLoading,
        commentsLoadingMore,
        commentsError,
        commentsNeedsSettings,
        loadFirstCommentsPage
    ]);

    const wasActiveRef = useRef(false);
    useEffect(() => {
        if (!isActive) {
            wasActiveRef.current = false;
            return;
        }
        if (wasActiveRef.current) {
            return;
        }
        wasActiveRef.current = true;
        if (seededForIdRef.current === id) {
            seededForIdRef.current = null;
            return;
        }
        if (id == null || commentsForId !== id) {
            return;
        }
        logCommentsDebug("entry-refetch", id, `surface=${surfaceKey}`);
        deferredClaimRef.current = null;
        resetCommentsSlice();
    }, [isActive, id, commentsForId, surfaceKey]);

    const previousSortRef = useRef<CommentsSort>(commentsSort);
    useEffect(() => {
        if (seededSortRef.current !== null) {
            previousSortRef.current = commentsSort;
            if (seededSortRef.current === commentsSort) {
                seededSortRef.current = null;
            }
            return;
        }
        if (previousSortRef.current === commentsSort) {
            return;
        }
        const prevSort = previousSortRef.current;
        previousSortRef.current = commentsSort;
        if (commentsForId == null) {
            logCommentsDebug(
                "sort-flip-skip",
                id ?? "null",
                `surface=${surfaceKey} prev=${prevSort} next=${commentsSort} (no list to wipe)`
            );
            return;
        }
        logCommentsDebug(
            "sort-flip-wipe",
            commentsForId,
            `surface=${surfaceKey} prev=${prevSort} next=${commentsSort} runId=${commentsRunIdRef.current}`
        );
        seededForIdRef.current = null;
        deferredClaimRef.current = null;
        resetCommentsSlice();
    }, [commentsSort, commentsForId, id, surfaceKey]);

    return {
        state: {
            comments,
            commentsLoading,
            commentsLoadingMore,
            commentsError,
            commentsTotal,
            commentsHasMore,
            commentsSort,
            commentsNeedsSettings,
            commentsRestricted,
            commentsLoaded: commentsForId === id,
            commentsCardClaim: cardClaim.claim,
            commentsPostClaim: postClaim.claim,
            commentsWindow
        },
        actions: {
            setCommentsSort,
            loadFirstCommentsPage,
            loadMoreComments,
            captureComments,
            spendCommentsCardClaim: cardClaim.spend,
            spendCommentsPostClaim: postClaim.spend
        }
    };
}
