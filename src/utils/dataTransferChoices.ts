import type { DataKind, DataTransferMode } from "../types";

let kind: DataKind = "all";

let mode: DataTransferMode = "merge";

export function currentDataKind(): DataKind {
    return kind;
}

export function rememberDataKind(next: DataKind): void {
    kind = next;
}

export function currentDataMode(): DataTransferMode {
    return mode;
}

export function rememberDataMode(next: DataTransferMode): void {
    mode = next;
}

export function forgetDataChoices(): void {
    kind = "all";
    mode = "merge";
}

const KIND_ORDER: DataKind[] = ["all", "tracked", "notes", "guides", "events", "milestones"];

export function nextDataKind(current: DataKind): DataKind {
    return KIND_ORDER[(KIND_ORDER.indexOf(current) + 1) % KIND_ORDER.length];
}
