type PanelEntry = "guides" | "memories";

let pendingEntry: PanelEntry | null = null;

export function requestPanelEntry(entry: PanelEntry): void {
    pendingEntry = entry;
}

export function takePanelEntry(): PanelEntry | null {
    const requested = pendingEntry;
    pendingEntry = null;
    return requested;
}
