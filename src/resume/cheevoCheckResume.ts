import type { ViewKey } from "../types";

export function getCheevoCheckResumeFocusKey(savedView: ViewKey | null | undefined): string | null {
    if (savedView !== "cheevoCheck") {
        return null;
    }
    return "cheevocheck:back";
}
