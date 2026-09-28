import { useEffect, useState } from "react";
import { getChecklistProgress, getEventDetail, getGameComments } from "../api";
import type { ChecklistGameProgress, EventChecklistGame, EventDetail, Payload } from "../types";
import { logError } from "../utils/errors";
import { useGameCommentsController } from "./useGameCommentsController";
import { useGamePayload } from "./useGamePayload";

export type UseEventViewerControllerOptions = {
    isActive: boolean;
    eventGameId: number | null;
    owner: string;
    commentsActive: boolean;
    dynamicComments: boolean;
    dynamicCommentsInitialRows: number;
    dynamicCommentsRowStep: number;
    legacyCommentsLoading: boolean;
};

type LastShown = {
    owner: string;
    eventGameId: number;
    detail: EventDetail | null;
    games: Record<string, EventChecklistGame>;
    payload: Payload | null;
    checklistProgress: Record<string, ChecklistGameProgress> | null;
};
let lastShown: LastShown | null = null;

export function useEventViewerController(options: UseEventViewerControllerOptions) {
    const { isActive, eventGameId, owner } = options;

    const [seed] = useState(() =>
        lastShown !== null && lastShown.eventGameId === eventGameId && (owner === "" || lastShown.owner === owner)
            ? lastShown
            : null
    );
    const [detail, setDetail] = useState<EventDetail | null>(seed?.detail ?? null);
    const [games, setGames] = useState<Record<string, EventChecklistGame>>(seed?.games ?? {});
    const [detailLoaded, setDetailLoaded] = useState(seed !== null);

    useEffect(() => {
        if (!isActive || eventGameId === null) {
            return;
        }
        let cancelled = false;
        if (seed === null) {
            setDetailLoaded(false);
        }
        getEventDetail(eventGameId)
            .then((result) => {
                if (cancelled) {
                    return;
                }
                setDetail(result.ok ? result.event : null);
                setGames(result.ok ? result.games : {});
                setDetailLoaded(true);
            })
            .catch((e) => {
                logError("get event detail", e);
                if (!cancelled) {
                    setDetailLoaded(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [isActive, eventGameId]);

    const isChecklist = detail?.kind === "checklist" && detail.checklist !== null;
    const payload = useGamePayload({
        isActive: isActive && detailLoaded && !isChecklist,
        viewedUsername: null,
        viewedUserRef: null,
        gameId: detailLoaded && !isChecklist ? eventGameId : null,
        seedPayload: seed?.payload ?? null,
        seedRevalidate: true
    });

    const [checklistProgress, setChecklistProgress] = useState<Record<string, ChecklistGameProgress> | null>(
        seed?.checklistProgress ?? null
    );
    const [checklistLoading, setChecklistLoading] = useState(false);
    const [checklistError, setChecklistError] = useState<string | null>(null);
    useEffect(() => {
        if (!isActive || !isChecklist || eventGameId === null) {
            return;
        }
        let cancelled = false;
        setChecklistLoading(true);
        getChecklistProgress(eventGameId, false)
            .then((result) => {
                if (cancelled) {
                    return;
                }
                setChecklistProgress(result.games ?? {});
                setChecklistError(result.error ?? null);
            })
            .catch((e) => {
                logError("get checklist progress", e);
                if (!cancelled) {
                    setChecklistProgress({});
                    setChecklistError("Couldn't refresh your game progress.");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setChecklistLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [isActive, isChecklist, eventGameId]);

    useEffect(() => {
        if (eventGameId === null || !detailLoaded) {
            return;
        }
        const kept = lastShown !== null && lastShown.eventGameId === eventGameId ? lastShown.payload : null;
        lastShown = {
            owner: owner || lastShown?.owner || "",
            eventGameId,
            detail,
            games,
            payload: payload.payload && payload.payload.gameId === eventGameId ? payload.payload : kept,
            checklistProgress
        };
    }, [owner, eventGameId, detailLoaded, detail, games, payload.payload, checklistProgress]);

    const comments = useGameCommentsController({
        isActive: isActive && options.commentsActive,
        id: eventGameId,
        ipc: getGameComments,
        dynamicComments: options.dynamicComments,
        dynamicCommentsInitialRows: options.dynamicCommentsInitialRows,
        dynamicCommentsRowStep: options.dynamicCommentsRowStep,
        surfaceKey: "comments:event",
        legacyLoading: options.legacyCommentsLoading,
        loadErrorMessage: "Couldn't load this event's comments.",
        loadMoreErrorMessage: "Couldn't load more comments."
    });

    return {
        detail,
        games,
        detailLoaded,
        isChecklist,
        checklistProgress,
        checklistLoading,
        checklistError,
        payload: payload.payload,
        payloadLoading: payload.loading,
        payloadError: payload.error,
        needsSettings: payload.needsSettings,
        comments
    };
}
