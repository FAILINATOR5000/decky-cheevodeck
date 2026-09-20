import type { MemoriesTransferMode } from "../types";

let includeVideos = true;

let mode: MemoriesTransferMode = "merge";

export function currentIncludeVideos(): boolean {
    return includeVideos;
}

export function rememberIncludeVideos(next: boolean): void {
    includeVideos = next;
}

export function currentTransferMode(): MemoriesTransferMode {
    return mode;
}

export function rememberTransferMode(next: MemoriesTransferMode): void {
    mode = next;
}

export function forgetTransferChoices(): void {
    includeVideos = true;
    mode = "merge";
}
