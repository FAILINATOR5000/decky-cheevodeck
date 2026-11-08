import type { FriendProfileBackSource, MilestonesTab, NewsEventsSubView, SocialView } from "../types";

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
    | { kind: "milestones"; tab: MilestonesTab }
    | { kind: "profile"; username: string; ulid: string | null }
    | { kind: "about" | "cheevoCheck" | "fileWatcher" | "memoriesTransfer" | "dataTransfer" | "offlineHotspot" | "emulators" | "multiplayer" };

type PanelEntryRequest = { entry: PanelEntry; land: string | null };

let pendingEntry: PanelEntryRequest | null = null;

export function requestPanelEntry(entry: PanelEntry, options?: { land?: string }): void {
    pendingEntry = { entry, land: options?.land ?? null };
}

export function takePanelEntry(): PanelEntryRequest | null {
    const requested = pendingEntry;
    pendingEntry = null;
    return requested;
}

export type PanelRoute =
    | { kind: "profile"; username: string; ulid: string; backSource: FriendProfileBackSource }
    | { kind: "cheevoCheck" };

let pendingRoute: PanelRoute | null = null;

export function requestRoute(route: PanelRoute): void {
    pendingRoute = route;
}

export function takeRoute(): PanelRoute | null {
    const requested = pendingRoute;
    pendingRoute = null;
    return requested;
}
