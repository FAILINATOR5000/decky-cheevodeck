import type { ShortcutAction, ShortcutButton } from "../types";
import { SHORTCUT_BUTTON_BY_CODE } from "./gamepadButtons";

let boundButton: ShortcutButton | null = null;

export function setSnapshotHotkey(bindings: Record<ShortcutButton, ShortcutAction>): void {
    boundButton = null;
    for (const button of Object.keys(bindings) as ShortcutButton[]) {
        if (bindings[button] === "snapshot") {
            boundButton = button;
            return;
        }
    }
}

export function isSnapshotPress(code: number): boolean {
    return boundButton !== null && SHORTCUT_BUTTON_BY_CODE[code] === boundButton;
}
