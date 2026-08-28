import type { ViewKey } from "../types";

export function getUtilsResumeFocusKey(
    savedView: ViewKey | null | undefined,
    savedFocusKey?: string | null
): string | null {
    if (savedView !== "utils") {
        return null;
    }
    const focusKey = String(savedFocusKey || "").trim();
    return focusKey || "utils:back";
}
