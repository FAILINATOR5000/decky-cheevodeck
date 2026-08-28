import type { ResumeState } from "../types";

export function getSavedGameNotesGameId(savedState: ResumeState): number | null {
    const raw = savedState.gameNotesGameId;
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
    }
    return null;
}
