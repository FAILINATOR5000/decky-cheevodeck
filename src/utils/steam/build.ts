import { logSteamEvent } from "../../api";

export type SteamUiKind = "webpack" | "vite";

let kind: SteamUiKind | null = null;

function steamUiKind(): SteamUiKind {
    if (!kind) {
        kind = (window as any).webpackChunksteamui ? "webpack" : "vite";
    }
    return kind;
}

export function logSteamUiKind() {
    let extra = "";
    if (steamUiKind() === "vite") {
        const chunks = performance.getEntriesByType("resource")
            .filter((entry) => entry.name.includes("/chunk~"))
            .length;
        extra = `${chunks} chunks loaded`;
    }
    void logSteamEvent(`ui is ${steamUiKind()}`, extra).catch(() => { });
}
