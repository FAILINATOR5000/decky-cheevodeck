import type { ViewKey } from "../types";

export function getDolphinMapperResumeFocusKey(
    savedView: ViewKey | null | undefined,
    savedFocusKey?: string | null
): string | null {
    if (savedView !== "dolphinMapper") {
        return null;
    }
    const focusKey = String(savedFocusKey || "").trim();
    return focusKey || "dolphinMapper:back";
}
