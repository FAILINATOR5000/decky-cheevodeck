import { useEffect, useRef, useState } from "react";

import { getCachedGameIconDataUri, getGameIconCached, isGameIconBatchPending, subscribeToGameIcon } from "../api";
import { logError } from "../utils/errors";

export function useResilientGameIcon(
    gameId: number | null,
    imageIcon: string | null | undefined,
    errorTag: string
): { iconDataUri: string | null; cold: boolean } {
    const [iconDataUri, setIconDataUri] = useState<string | null>(() => getCachedGameIconDataUri(gameId));
    const coldRef = useRef(false);

    useEffect(() => {
        if (gameId == null) {
            coldRef.current = false;
            setIconDataUri(null);
            return;
        }
        const cached = getCachedGameIconDataUri(gameId);
        if (cached) {
            coldRef.current = false;
            setIconDataUri(cached);
            return;
        }
        let cancelled = false;
        let backupTimer: ReturnType<typeof setTimeout> | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const url = imageIcon ?? null;

        async function fetchOnce() {
            try {
                const result = await getGameIconCached(gameId, url);
                if (cancelled) {
                    return null;
                }
                if (result?.dataUri) {
                    coldRef.current = true;
                    setIconDataUri(result.dataUri);
                    return result.dataUri;
                }
                return null;
            } catch (e) {
                logError(errorTag, e);
                return null;
            }
        }

        const unsubscribe = subscribeToGameIcon(gameId, (dataUri) => {
            if (cancelled) {
                return;
            }
            if (dataUri) {
                coldRef.current = true;
                setIconDataUri(dataUri);
                return;
            }
            void (async () => {
                const got = await fetchOnce();
                if (got || cancelled || !url) {
                    return;
                }
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    void fetchOnce();
                }, 1500);
            })();
        });

        backupTimer = setTimeout(() => {
            backupTimer = null;
            if (cancelled) {
                return;
            }
            const warmed = getCachedGameIconDataUri(gameId);
            if (warmed) {
                coldRef.current = true;
                setIconDataUri(warmed);
                return;
            }
            if (isGameIconBatchPending(gameId)) {
                return;
            }
            void (async () => {
                const first = await fetchOnce();
                if (first || cancelled || !url) {
                    return;
                }
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    void fetchOnce();
                }, 1500);
            })();
        }, 500);

        return () => {
            cancelled = true;
            unsubscribe();
            if (backupTimer !== null) {
                clearTimeout(backupTimer);
            }
            if (retryTimer !== null) {
                clearTimeout(retryTimer);
            }
        };
    }, [gameId, imageIcon]);

    return { iconDataUri, cold: coldRef.current };
}
