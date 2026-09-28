import { useEffect, useRef, useState } from "react";
import { getSetConsoleList } from "../api";
import type { TrackedSetConsole } from "../types";

export function useConsoleIcons(enabled: boolean): (consoleName: string) => string {
    const [icons, setIcons] = useState<Map<string, string>>(() => new Map());
    const requestedRef = useRef(false);

    useEffect(() => {
        if (!enabled || requestedRef.current) {
            return;
        }
        requestedRef.current = true;
        let cancelled = false;
        void getSetConsoleList()
            .then((res) => {
                if (cancelled || !res || !res.ok) {
                    return;
                }
                const next = new Map<string, string>();
                for (const item of res.consoles as TrackedSetConsole[]) {
                    if (item.iconUrl) {
                        next.set(item.name.trim().toLowerCase(), item.iconUrl);
                    }
                }
                setIcons(next);
            })
            .catch(() => {
                requestedRef.current = false;
            });
        return () => {
            cancelled = true;
        };
    }, [enabled]);

    return (consoleName: string) => icons.get(consoleName.trim().toLowerCase()) ?? "";
}
