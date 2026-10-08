import type { NewsEventsSubView, SocialView } from "../types";

export type PanelEntry =
    | { kind: "guides" }
    | { kind: "memories" }
    | { kind: "dolphinMapper" }
    | { kind: "stormbreaker" }
    | { kind: "socialTab"; tab: SocialView | null; newsSub?: NewsEventsSubView }
    | { kind: "aotw" }
    | { kind: "trackedSets" }
    | { kind: "gameNotes"; gameId: number }
    | { kind: "achievement"; gameId: number; achievementId: number; viewedUsername: string | null; viewedUserRef: string | null }
    | { kind: "game"; gameId: number; viewedUsername: string | null; viewedUserRef: string | null }
    | { kind: "trackedSet"; setId: string }
    | { kind: "profile"; username: string; ulid: string | null }
    | { kind: "about" | "cheevoCheck" | "fileWatcher" | "memoriesTransfer" };

let pendingEntry: PanelEntry | null = null;

export function requestPanelEntry(entry: PanelEntry): void {
    pendingEntry = entry;
}

export function takePanelEntry(): PanelEntry | null {
    const requested = pendingEntry;
    pendingEntry = null;
    return requested;
}
