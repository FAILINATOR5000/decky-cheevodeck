import { useEffect, useRef, type RefObject } from "react";

import type { ShortcutAction, ShortcutButton } from "../types";
import { MENU_COMBO_BY_CODE, MENU_HOLD_LIMIT_MS, SHORTCUT_BUTTON_BY_CODE } from "../utils/gamepadButtons";

type ButtonEvent = CustomEvent<{ button?: number; is_repeat?: boolean }>;

export function useMenuCombos(
    rootRef: RefObject<HTMLElement | null>,
    bindings: Record<ShortcutButton, ShortcutAction>,
    run: (action: ShortcutAction) => void
): void {
    const latest = useRef({ bindings, run });
    latest.current = { bindings, run };

    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        let hold: { downAt: number; comboUsed: boolean } | null = null;

        const onDown = (evt: Event) => {
            const detail = (evt as ButtonEvent).detail;
            const code = detail?.button;
            if (code === undefined) {
                return;
            }
            const current = latest.current;
            if (SHORTCUT_BUTTON_BY_CODE[code] === "menu") {
                if (!detail.is_repeat) {
                    hold = { downAt: Date.now(), comboUsed: false };
                }
                const menuAction = current.bindings.menu;
                if (menuAction && menuAction !== "none") {
                    evt.stopPropagation();
                }
                return;
            }
            const combo = MENU_COMBO_BY_CODE[code];
            if (!combo || !hold || Date.now() - hold.downAt >= MENU_HOLD_LIMIT_MS) {
                return;
            }
            hold.comboUsed = true;
            const action = current.bindings[combo];
            if (!action || action === "none") {
                return;
            }
            evt.stopPropagation();
            if (!detail.is_repeat) {
                current.run(action);
            }
        };

        const onUp = (evt: Event) => {
            const code = (evt as ButtonEvent).detail?.button;
            if (code === undefined || SHORTCUT_BUTTON_BY_CODE[code] !== "menu") {
                return;
            }
            const released = hold;
            hold = null;
            const action = latest.current.bindings.menu;
            if (!released || released.comboUsed || !action || action === "none") {
                return;
            }
            latest.current.run(action);
        };

        root.addEventListener("vgp_onbuttondown", onDown, true);
        root.addEventListener("vgp_onbuttonup", onUp, true);
        return () => {
            root.removeEventListener("vgp_onbuttondown", onDown, true);
            root.removeEventListener("vgp_onbuttonup", onUp, true);
        };
    }, [rootRef]);
}
