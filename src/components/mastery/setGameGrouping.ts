import type { TrackedSetGame, TrackedSetGameSort, TrackedSetViewMode } from "../../types";
import { compareConsolesByName, compareConsolesByYear } from "../../utils/consoles";

export function orderFieldForView(view: TrackedSetViewMode): "manualOrder" | "systemOrder" | "systemYearOrder" | "retroOrder" | "retroAlphaOrder" {
    if (view === "system") {
        return "systemOrder";
    }
    if (view === "systemYear") {
        return "systemYearOrder";
    }
    if (view === "retroHistory") {
        return "retroOrder";
    }
    if (view === "retroHistoryAlpha") {
        return "retroAlphaOrder";
    }
    return "manualOrder";
}

export function orderGamesByField(
    games: TrackedSetGame[],
    gameSort: TrackedSetGameSort,
    field: "manualOrder" | "systemOrder" | "systemYearOrder" | "retroOrder" | "retroAlphaOrder"
): TrackedSetGame[] {
    const ordered = [...games];
    if (gameSort === "recent") {
        ordered.sort((a, b) => b[field] - a[field]);
    } else {
        ordered.sort((a, b) => a[field] - b[field]);
    }
    return ordered;
}

export type ConsoleGroup = { consoleName: string; games: TrackedSetGame[] };

export function groupGamesByConsole(
    games: TrackedSetGame[],
    view: TrackedSetViewMode,
    gameSort: TrackedSetGameSort
): ConsoleGroup[] {
    const buckets = new Map<string, TrackedSetGame[]>();
    for (const game of games) {
        const key = game.consoleName || "";
        const bucket = buckets.get(key);
        if (bucket) {
            bucket.push(game);
        } else {
            buckets.set(key, [game]);
        }
    }
    const compare = (view === "systemYear" || view === "retroHistory") ? compareConsolesByYear : compareConsolesByName;
    const names = [...buckets.keys()].sort(compare);
    const field = orderFieldForView(view);
    return names.map((name) => ({
        consoleName: name,
        games: orderGamesByField(buckets.get(name) || [], gameSort, field)
    }));
}
