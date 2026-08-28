import type { ViewKey } from "../types";

export function getSmbSharesResumeFocusKey(savedView: ViewKey | null | undefined): string | null {
    if (savedView !== "smbShares") {
        return null;
    }
    return "smbShares:back";
}
