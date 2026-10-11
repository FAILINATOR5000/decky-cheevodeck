import { getSetConsoleList } from "../api";
import type { TrackedSetConsole } from "../types";
import { logError } from "./errors";

let consoles: TrackedSetConsole[] | null = null;
let pending: Promise<TrackedSetConsole[]> | null = null;
let lastConsoleId = 0;

export function cachedConsoles(): TrackedSetConsole[] | null {
    return consoles;
}

function sameConsoles(a: TrackedSetConsole[], b: TrackedSetConsole[]) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        const x = a[i];
        const y = b[i];
        if (x.id !== y.id || x.name !== y.name || x.iconUrl !== y.iconUrl || x.active !== y.active) {
            return false;
        }
    }
    return true;
}

export function loadConsoles(): Promise<TrackedSetConsole[]> {
    if (pending) {
        return pending;
    }
    pending = getSetConsoleList()
        .then((result) => {
            const list = result?.consoles ?? [];
            if (!result?.ok || list.length === 0) {
                return list;
            }
            if (consoles && sameConsoles(consoles, list)) {
                return consoles;
            }
            consoles = list;
            return list;
        })
        .finally(() => {
            pending = null;
        });
    return pending;
}

export function warmConsoleCatalog(): void {
    loadConsoles().catch((e) => {
        logError("consoleCatalog: couldn't warm the console list", e);
    });
}

export function getCurrentLastConsoleId(): number {
    return lastConsoleId;
}

export function setCurrentLastConsoleId(id: number): void {
    lastConsoleId = id;
}
