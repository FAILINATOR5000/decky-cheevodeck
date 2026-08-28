import type { ViewKey } from "../types";

export function getOptionsResumeFocusKey(
    savedView: ViewKey | null | undefined,
    savedFocusKey?: string | null
): string | null {
    if (savedView !== "options") {
        return null;
    }
    const focusKey = String(savedFocusKey || "").trim();
    return focusKey || "options:back";
}
