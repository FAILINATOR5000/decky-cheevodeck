import type { ViewKey } from "../types";

export function getMemoriesResumeFocusKey(savedView: ViewKey | null | undefined): string | null {
    if (savedView !== "memories") {
        return null;
    }
    return "memories:back";
}
