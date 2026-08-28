import type { ViewKey } from "../types";

export function getAboutResumeFocusKey(
    savedView: ViewKey | null | undefined,
    savedFocusKey?: string | null
): string | null {
    if (savedView !== "about") {
        return null;
    }
    const focusKey = String(savedFocusKey || "").trim();
    return focusKey || "about:back";
}
