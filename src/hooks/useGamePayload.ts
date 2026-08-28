import { useCallback, useEffect, useRef, useState } from "react";
import { getGamePayload, getUserGamePayload } from "../api";
import type { Payload } from "../types";

export type UseGamePayloadOptions = {
    isActive: boolean;
    viewedUsername: string | null;
    viewedUserRef?: string | null;
    gameId: number | null;
    seedPayload?: Payload | null;
    seedIsProvisional?: boolean;
};

type LoadTarget = {
    gameId: number;
    viewedUsername: string | null;
    viewedUserRef: string | null;
};

function sameTarget(a: LoadTarget | null, b: LoadTarget | null): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b) {
        return false;
    }
    return a.gameId === b.gameId && a.viewedUsername === b.viewedUsername;
}

export function useGamePayload(options: UseGamePayloadOptions) {
    const { isActive, viewedUsername, viewedUserRef, gameId, seedPayload, seedIsProvisional } = options;

    const [payload, setPayload] = useState<Payload | null>(null);
    const [loadedGameId, setLoadedGameId] = useState<number | null>(null);
    const [loadedViewedUsername, setLoadedViewedUsername] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const revalidatedKeyRef = useRef<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [needsSettings, setNeedsSettings] = useState(false);

    const runIdRef = useRef(0);
    const inFlightRef = useRef<LoadTarget | null>(null);

    const targetRef = useRef<LoadTarget | null>(null);
    targetRef.current = gameId == null ? null : { gameId, viewedUsername, viewedUserRef: viewedUserRef ?? null };

    const doLoad = useCallback(async (force: boolean) => {
        const target = targetRef.current;
        if (target == null) {
            return;
        }
        const runId = runIdRef.current + 1;
        runIdRef.current = runId;
        inFlightRef.current = target;
        setLoading(true);
        setError(null);
        setNeedsSettings(false);

        try {
            if (target.viewedUsername == null) {
                const result = await getGamePayload(target.gameId, force);
                if (runIdRef.current !== runId) {
                    return;
                }
                if (result.needsSettings) {
                    setNeedsSettings(true);
                    setLoading(false);
                    inFlightRef.current = null;
                    return;
                }
                if (result.error && !result.payload) {
                    setError(result.error);
                    setLoading(false);
                    inFlightRef.current = null;
                    return;
                }
                if (result.payload) {
                    setPayload(result.payload);
                    setLoadedGameId(target.gameId);
                    setLoadedViewedUsername(null);
                }
                if (result.error) {
                    setError(result.error);
                }
                setLoading(false);
                inFlightRef.current = null;
                return;
            }

            const result = await getUserGamePayload(target.viewedUserRef || target.viewedUsername, target.gameId, force);
            if (runIdRef.current !== runId) {
                return;
            }
            if (result.needsSettings) {
                setNeedsSettings(true);
                setLoading(false);
                inFlightRef.current = null;
                return;
            }
            const innerPayload = result.payload ?? null;
            if (result.error && !innerPayload) {
                setError(result.error);
                setLoading(false);
                inFlightRef.current = null;
                return;
            }
            if (innerPayload) {
                setPayload(innerPayload);
                setLoadedGameId(target.gameId);
                setLoadedViewedUsername(target.viewedUsername);
            }
            if (result.error) {
                setError(result.error);
            }
            setLoading(false);
            inFlightRef.current = null;
        }
        catch (e: any) {
            if (runIdRef.current !== runId) {
                return;
            }
            setError(String(e?.message || e || "Couldn't load this game."));
            setLoading(false);
            inFlightRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        if (gameId == null) {
            return;
        }
        if (needsSettings) {
            return;
        }
        const target: LoadTarget = { gameId, viewedUsername, viewedUserRef: viewedUserRef ?? null };
        const seedKey = `${gameId}:${viewedUsername ?? ""}`;

        if (
            seedPayload
            && seedPayload.gameId === gameId
            && revalidatedKeyRef.current !== seedKey
        ) {
            if (payload !== seedPayload || loadedGameId !== gameId || loadedViewedUsername !== viewedUsername) {
                runIdRef.current = runIdRef.current + 1;
                inFlightRef.current = null;
                setPayload(seedPayload);
                setLoadedGameId(gameId);
                setLoadedViewedUsername(viewedUsername);
                setError(null);
                setLoading(false);
            }
            if (seedIsProvisional) {
                revalidatedKeyRef.current = seedKey;
                void doLoad(true);
            }
            return;
        }

        if (payload && loadedGameId === gameId && loadedViewedUsername === viewedUsername) {
            return;
        }

        if (sameTarget(inFlightRef.current, target)) {
            return;
        }

        if (inFlightRef.current != null) {
            runIdRef.current = runIdRef.current + 1;
            inFlightRef.current = null;
        }
        if (payload || loadedGameId != null || loadedViewedUsername != null || error) {
            setPayload(null);
            setLoadedGameId(null);
            setLoadedViewedUsername(null);
            setError(null);
        }
        void doLoad(false);
    }, [
        isActive,
        gameId,
        viewedUsername,
        seedPayload,
        payload,
        loadedGameId,
        loadedViewedUsername,
        needsSettings,
        error,
        doLoad
    ]);

    const reload = useCallback(async () => {
        await doLoad(true);
    }, [doLoad]);

    return {
        payload,
        loading,
        error,
        needsSettings,
        reload
    };
}
