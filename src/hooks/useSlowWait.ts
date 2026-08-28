import { useEffect, useState } from "react";

export const SLOW_WAIT_MS = 1500;

export const NETWORK_WAIT_MS = 400;

export function useSlowWait(active: boolean, afterMs: number = SLOW_WAIT_MS): boolean {
    const [slow, setSlow] = useState(false);
    useEffect(() => {
        if (!active) {
            setSlow(false);
            return;
        }
        const timer = setTimeout(() => setSlow(true), afterMs);
        return () => clearTimeout(timer);
    }, [active, afterMs]);
    return slow;
}
