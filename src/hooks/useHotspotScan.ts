import { useEffect, useState } from "react";

import { hotspotScan, type HotspotRow } from "../api";
import { logError } from "../utils/errors";

const SCAN_MS = 5000;

export function useHotspotScan(on: boolean, label: string): HotspotRow[] | null {
    const [found, setFound] = useState<HotspotRow[] | null>(null);

    useEffect(() => {
        if (!on) {
            return;
        }
        let alive = true;
        let previous: HotspotRow[] | null = null;
        async function scan() {
            try {
                const result = await hotspotScan();
                if (!alive || !result.ok) {
                    return;
                }
                const missed = (previous ?? []).filter((row) => !result.hotspots.some((now) => now.ssid === row.ssid));
                const shown = [...result.hotspots, ...missed].sort((a, b) => a.ssid.localeCompare(b.ssid));
                if (shown.length > 0 || previous !== null) {
                    setFound(shown);
                }
                previous = result.hotspots;
            }
            catch (e) {
                logError(label, e);
            }
        }
        void scan();
        const timer = setInterval(() => void scan(), SCAN_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [on, label]);

    return found;
}
