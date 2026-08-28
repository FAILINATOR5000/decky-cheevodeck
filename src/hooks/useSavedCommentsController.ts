import { useCallback, useEffect, useMemo, useState } from "react";

import {
    getSavedCommentKeys,
    getSavedComments as getSavedCommentsIpc,
    saveComment as saveCommentIpc,
    touchSavedCommentOpened as touchSavedCommentOpenedIpc,
    unsaveComment as unsaveCommentIpc
} from "../api";
import { distinctSavedGames, savedCommentMatchKey } from "../utils/savedComments";
import { logError } from "../utils/errors";
import type { SaveCommentPayload, SaveCommentResponse, SavedComment } from "../types";

type SavedCommentsArgs = {
    activeUlid: string;
    listActive: boolean;
};

export function useSavedCommentsController(args: SavedCommentsArgs) {
    const { activeUlid, listActive } = args;

    const [savedKeys, setSavedKeys] = useState<Map<string, string>>(() => new Map());

    const refreshSavedKeys = useCallback(async () => {
        try {
            const result = await getSavedCommentKeys();
            const next = new Map<string, string>();
            for (const entry of result?.keys ?? []) {
                if (entry?.matchKey) {
                    next.set(entry.matchKey, entry.id);
                }
            }
            setSavedKeys(next);
        } catch (e) {
            logError("useSavedCommentsController refreshSavedKeys", e);
        }
    }, []);

    useEffect(() => {
        void refreshSavedKeys();
    }, [activeUlid, refreshSavedKeys]);

    const [savedComments, setSavedComments] = useState<SavedComment[]>([]);
    const [savedCommentsLoading, setSavedCommentsLoading] = useState(false);
    const [savedCommentsLoaded, setSavedCommentsLoaded] = useState(false);
    const [savedCommentsError, setSavedCommentsError] = useState<string | null>(null);

    useEffect(() => {
        setSavedComments([]);
        setSavedCommentsLoaded(false);
    }, [activeUlid]);

    useEffect(() => {
        if (!listActive || savedCommentsLoaded) {
            return;
        }
        let cancelled = false;
        setSavedCommentsLoading(true);
        setSavedCommentsError(null);
        void (async () => {
            try {
                const result = await getSavedCommentsIpc();
                if (cancelled) {
                    return;
                }
                setSavedComments(result?.comments ?? []);
                setSavedCommentsLoaded(true);
            } catch (e) {
                if (!cancelled) {
                    logError("useSavedCommentsController loadSavedComments", e);
                    setSavedCommentsError("load_failed");
                }
            } finally {
                if (!cancelled) {
                    setSavedCommentsLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [listActive, savedCommentsLoaded, activeUlid]);

    const isSavedByMatchKey = (matchKey: string | null): boolean => {
        return matchKey != null && savedKeys.has(matchKey);
    };

    const savedIdForMatchKey = (matchKey: string | null): string | null => {
        if (matchKey == null) {
            return null;
        }
        return savedKeys.get(matchKey) ?? null;
    };

    const saveComment = async (payload: SaveCommentPayload): Promise<SaveCommentResponse> => {
        let result: SaveCommentResponse;
        try {
            result = await saveCommentIpc(payload);
        } catch (e) {
            logError("useSavedCommentsController saveComment", e);
            return { ok: false, error: "ipc_failed" };
        }
        if (result?.ok && result.record) {
            const record = result.record;
            const matchKey = savedCommentMatchKey(
                record.source.kind, record.source.sourceId, record.ulid, record.submitted
            );
            setSavedKeys((prev) => {
                const next = new Map(prev);
                next.set(matchKey, record.id);
                return next;
            });
            setSavedComments((prev) => [record, ...prev.filter((entry) => entry.id !== record.id)]);
        }
        return result;
    };

    const unsaveComment = async (commentId: string): Promise<boolean> => {
        try {
            const result = await unsaveCommentIpc(commentId);
            const gone = Boolean(result?.ok) || result?.error === "not_found";
            if (gone) {
                setSavedKeys((prev) => {
                    const next = new Map(prev);
                    for (const [key, id] of next) {
                        if (id === commentId) {
                            next.delete(key);
                        }
                    }
                    return next;
                });
                setSavedComments((prev) => prev.filter((entry) => entry.id !== commentId));
            }
            return gone;
        } catch (e) {
            logError("useSavedCommentsController unsaveComment", e);
            return false;
        }
    };

    const markOpened = (commentId: string) => {
        const id = String(commentId || "").trim();
        if (!id) {
            return;
        }
        const openedAt = Math.floor(Date.now() / 1000);
        setSavedComments((prev) => prev.map((entry) => (
            entry.id === id ? { ...entry, openedAt } : entry
        )));
        void touchSavedCommentOpenedIpc(id).catch((e) => {
            logError("useSavedCommentsController markOpened", e);
        });
    };

    const savedGames = useMemo(() => distinctSavedGames(savedComments), [savedComments]);

    const resetAfterClear = () => {
        setSavedKeys(new Map());
        setSavedComments([]);
        setSavedCommentsLoaded(false);
    };

    return {
        savedKeys,
        refreshSavedKeys,
        isSavedByMatchKey,
        savedIdForMatchKey,
        saveComment,
        unsaveComment,
        markOpened,
        savedComments,
        savedCommentsLoading,
        savedCommentsLoaded,
        savedCommentsError,
        savedGames,
        resetAfterClear
    };
}
