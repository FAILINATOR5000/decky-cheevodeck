import { useEffect, useRef, useState } from "react";

import { getCachedGameIconDataUri, getGameIconCached, subscribeToGameIcon } from "../api";
import { logError } from "../utils/errors";

export function useGameIcon(
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

        async function fetchOnce() {
            try {
                const result = await getGameIconCached(gameId, imageIcon);
                if (!cancelled && result?.dataUri) {
                    coldRef.current = true;
                    setIconDataUri(result.dataUri);
                }
            } catch (e) {
                logError(errorTag, e);
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
            void fetchOnce();
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [gameId, imageIcon]);

    return { iconDataUri, cold: coldRef.current };
}
