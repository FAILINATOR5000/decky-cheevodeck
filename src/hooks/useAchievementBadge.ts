import { useEffect, useState } from "react";

import { getAchievementIcons, getCachedAchievementIcons } from "../api";
import { logError } from "../utils/errors";

export function useAchievementBadge(
    gameId: number | null,
    badgeName: string | null | undefined,
    errorTag: string
): string | null {
    const name = (badgeName || "").trim();

    const [dataUri, setDataUri] = useState<string | null>(() => {
        if (gameId == null || !name) {
            return null;
        }
        return getCachedAchievementIcons(gameId, [name])[name] ?? null;
    });

    useEffect(() => {
        if (gameId == null || !name) {
            setDataUri(null);
            return;
        }
        const cached = getCachedAchievementIcons(gameId, [name])[name];
        if (cached) {
            setDataUri(cached);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const result = await getAchievementIcons(gameId, [name]);
                const resolved = result?.icons?.[name];
                if (!cancelled && resolved) {
                    setDataUri(resolved);
                }
            } catch (e) {
                logError(errorTag, e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [gameId, name]);

    return dataUri;
}
