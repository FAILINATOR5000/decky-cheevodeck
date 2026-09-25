import { useEffect, type RefObject } from "react";

const RECHECK_DELAY_MS = 200;

export function useFocusPaintWake(ref: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const root = ref.current;
        const win = root?.ownerDocument.defaultView;
        if (!root || !win) {
            return;
        }
        const wake = () => {
            root.dispatchEvent(new win.FocusEvent("focusin", { bubbles: true }));
        };
        wake();
        const timer = window.setTimeout(() => {
            if (root.ownerDocument.querySelectorAll('[class*="gpfocus"]').length > 0) {
                return;
            }
            wake();
        }, RECHECK_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [ref]);
}
